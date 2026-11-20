"""Xcode's device screen, on Windows.

After Trust, iOS 17.4+ exposes CoreDeviceProxy over the USB service broker,
or RemotePairing over Wi-Fi once paired for it. Either tunnel carries a
display service. The phone then sends the screen as HEVC video. The browser
decodes it.
"""

from __future__ import annotations

import asyncio
import threading

from handset.device import developer_mode_enabled, product_version
from handset.mux import MuxError, list_devices
from handset.wifi import wifi_paired_udids, wifi_tunnel

DEVELOPER_MODE_MESSAGE = (
    "开发者模式已关闭，暂时无法显示画面。请在 iPhone 上打开"
    "「设置 → 隐私与安全性 → 开发者模式」，开启后按提示重启。"
    "重启后解锁手机，点按「打开」，再回到电脑点击「开始投屏」。"
)

MIN_IOS_MAJOR_FOR_VIDEO = 27

IOS_VIDEO_VERSION_MESSAGE = (
    "实时投屏需要 iOS 27 或更高版本。这台 iPhone 在旧版系统上无法输出实时画面。"
    "键鼠控制可能仍然可用，但预览会保持黑屏。"
    "要查看画面，请使用 iOS 27 或更高版本。"
)

VIEW_URL = "http://127.0.0.1:8766/"
_LOCK = threading.Lock()
_STATE = {
    "phase": "idle",
    "udid": None,
    "url": None,
    "error": None,
    "note": None,
    "transport": None,
    "productVersion": None,
    "iosMajor": None,
}


def screen_status() -> dict:
    with _LOCK:
        return dict(_STATE)


def restart_screen(udid: str | None = None) -> dict:
    """Nudge the device encoder and keep the HTTP stream on 8766 alive."""
    import http.client

    chosen = (udid or "").strip() or _STATE.get("udid") or _only_udid()
    nudged = False
    for path in ("/restart", "/pli"):
        try:
            conn = http.client.HTTPConnection("127.0.0.1", 8766, timeout=20)
            conn.request("POST", path, body=b"", headers={})
            response = conn.getresponse()
            response.read()
            conn.close()
            nudged = True
        except OSError:
            continue
    with _LOCK:
        running = _STATE.get("phase") == "running"
    if running:
        return _set(note="投屏已重启。如果仍然黑屏，请再次点击「重启投屏」。")
    if chosen:
        return start_screen(chosen, _STATE.get("transport") or "auto")
    return _set(error="请先连接 iPhone，再点击「开始投屏」。")


def start_screen(udid: str | None, transport: str = "auto") -> dict:
    usb = _usb_udids()
    wifi = wifi_paired_udids()
    chosen = (udid or "").strip() or _only_udid(usb, wifi, transport)
    if not chosen:
        if transport == "wifi":
            return _set(phase="idle", udid=None, url=None, error="请插入数据线，先完成一次 Wi-Fi 配对。")
        return _set(phase="idle", udid=None, url=None, error="请先连接 iPhone。")

    if transport == "auto":
        transport = "usb" if chosen in usb else "wifi"
    if transport == "usb" and chosen not in usb:
        return _set(phase="error", udid=chosen, url=None, error="未检测到有线连接。请插入数据线或选择 Wi-Fi。")
    if transport == "wifi" and chosen not in wifi:
        return _set(phase="error", udid=chosen, url=None, error="请插入数据线，先完成一次 Wi-Fi 配对。")
    if transport == "wifi" and chosen in usb:
        return _set(
            phase="error",
            udid=chosen,
            url=None,
            error=(
                "iPhone 仍通过数据线连接，尚未通过 Wi-Fi 广播。"
                "要有线投屏，请选择「数据线」并点击「开始投屏」。要使用 Wi-Fi，请拔下数据线，"
                "保持手机解锁并连接到与电脑相同的 Wi-Fi，然后重新开始投屏。"
            ),
            transport="wifi",
        )
    if transport == "usb" and developer_mode_enabled(chosen) is False:
        return _set(phase="error", udid=chosen, url=None, error=DEVELOPER_MODE_MESSAGE)

    product_ver = product_version(chosen) if chosen in usb else None
    ios_major = _parse_ios_major(product_ver)
    if ios_major is not None and ios_major < MIN_IOS_MAJOR_FOR_VIDEO:
        return _set(
            phase="error",
            udid=chosen,
            url=None,
            error=IOS_VIDEO_VERSION_MESSAGE,
            transport=transport,
            productVersion=product_ver,
            iosMajor=ios_major,
        )

    with _LOCK:
        if _STATE["phase"] in {"starting", "running"} and _STATE["udid"] == chosen:
            return dict(_STATE)
        note = "正在通过 Wi-Fi 查找 iPhone…" if transport == "wifi" else None
        _STATE.update(
            phase="starting",
            udid=chosen,
            url=None,
            error=None,
            note=note,
            transport=transport,
            productVersion=product_ver,
            iosMajor=ios_major,
        )
    threading.Thread(target=_run, args=(chosen, transport), name="handset-screen", daemon=True).start()
    return screen_status()


def _run(udid: str, transport: str) -> None:
    try:
        asyncio.run(_serve(udid, transport))
        _set(phase="idle", udid=udid, url=None, error="投屏已停止。")
    except Exception as error:
        _set(phase="error", udid=udid, url=None, error=_plain(error))


DISPLAY_SERVICE = "com.apple.coredevice.displayservice"


def _open_tunnel(udid: str, transport: str):
    if transport == "wifi":
        return wifi_tunnel(udid)
    from pymobiledevice3.remote.rsd_tunnel import PreferredRsdTunnel

    return PreferredRsdTunnel(serial=udid, autopair=True)


async def _serve(udid: str, transport: str) -> None:
    from pymobiledevice3.remote.core_device.screen_stream import ScreenStreamServer
    from pymobiledevice3.services.mobile_image_mounter import auto_mount

    for attempt in range(2):
        async with _open_tunnel(udid, transport) as rsd:
            if DISPLAY_SERVICE in (rsd.peer_info or {}).get("Services", {}):
                await _stream(rsd, udid, ScreenStreamServer)
                return
            if attempt:
                raise RuntimeError(
                    "开发者映像已挂载，但 iPhone 尚未提供显示服务。"
                    "请重新插拔数据线，然后点击「开始投屏」。"
                )
            _set(note="正在 iPhone 上挂载开发者映像。首次使用需要下载映像。")
            await auto_mount(rsd)


async def _stream(rsd, udid: str, ScreenStreamServer) -> None:
    from pymobiledevice3.remote.core_device.display_service import is_media_in_use_error

    server = ScreenStreamServer(
        rsd,
        bind="127.0.0.1",
        http_port=8766,
        audio_default_on=False,
    )

    async def _eager_video_only() -> None:
        # Windows cannot decode AAC-ELD; skip eager audio so logs stay clean and
        # the display tunnel still comes up for /codec and /stream.bin.
        try:
            await server._ensure_fresh_stream(force=False)
        except Exception as error:
            if is_media_in_use_error(error):
                raise
            import logging

            logging.getLogger(__name__).warning(
                "eager video start failed (will retry on /codec)",
                exc_info=True,
            )

    server._eager_stream_start = _eager_video_only
    _set(phase="running", udid=udid, url=VIEW_URL, error=None, note=None)
    await server.serve()


def _usb_udids() -> list[str]:
    try:
        return [device["udid"] for device in list_devices()]
    except MuxError:
        return []


def _parse_ios_major(version: str | None) -> int | None:
    if not version:
        return None
    token = version.strip().split("-", 1)[0].split(" ", 1)[0]
    head = token.split(".", 1)[0]
    try:
        return int(head)
    except ValueError:
        return None


def _only_udid(usb: list[str] | None = None, wifi: list[str] | None = None, transport: str = "auto") -> str | None:
    usb = _usb_udids() if usb is None else usb
    wifi = wifi_paired_udids() if wifi is None else wifi
    if transport != "wifi" and len(usb) == 1:
        return usb[0]
    if transport != "usb" and len(wifi) == 1:
        return wifi[0]
    return None


def _set(**values) -> dict:
    with _LOCK:
        _STATE.update(values)
        return dict(_STATE)


def _plain(error: Exception) -> str:
    text = str(error).strip() or type(error).__name__
    name = type(error).__name__
    lower = text.lower()
    if "ios 27" in lower or "screen streaming isn't possible" in lower or "does not send" in lower:
        return IOS_VIDEO_VERSION_MESSAGE
    if name == "WifiNotFoundError":
        return text
    if name in {"ConnectionFailedToUsbmuxdError", "MuxError"} or "27015" in text or "usbmux" in text.lower():
        return "Apple 移动设备服务未运行。请安装「Apple 设备」，重新连接 iPhone 并点按「信任」。"
    if name == "UserspaceTunnelUnavailableError":
        return "无法建立显示通道。通道需要 iOS 17.4 或更高版本。请确认已信任电脑并开启开发者模式。"
    if "CoreDeviceProxy" in text or name == "InvalidServiceError":
        return "手机没有提供显示通道。请开启开发者模式，解锁手机并点按「信任」。"
    if name == "DeviceNotFoundError":
        return "未通过数据线检测到 iPhone。请连接并解锁手机，再点击「开始投屏」。"
    if name in {"DeveloperModeIsNotEnabledError", "DeveloperModeError"}:
        return DEVELOPER_MODE_MESSAGE
    if "PasswordProtected" in text or "locked" in text.lower():
        return "请解锁 iPhone 并保持解锁，再点击「开始投屏」。"
    if "PairingDialog" in text or "Trust" in text:
        return "请解锁 iPhone 并点按「信任」，再点击「开始投屏」。"
    return text
