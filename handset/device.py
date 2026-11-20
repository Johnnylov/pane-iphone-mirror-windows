"""Status and identity reads for a plugged-in iPhone."""

from __future__ import annotations

import asyncio
import socket
import subprocess
from pathlib import Path

from handset.mux import MuxError, list_devices, lockdown_request, open_lockdown

INFO_KEYS = (
    "DeviceName",
    "DeviceClass",
    "ProductType",
    "ProductVersion",
    "BuildVersion",
    "HardwareModel",
    "ModelNumber",
    "UniqueDeviceID",
    "SerialNumber",
    "PasswordProtected",
    "ActivationState",
    "TelephonyCapability",
)

DRIVER_PATHS = (
    Path(r"C:\Program Files\Common Files\Apple\Mobile Device Support"),
    Path(r"C:\Program Files (x86)\Common Files\Apple\Mobile Device Support"),
)


def driver_status() -> dict:
    found = [str(path) for path in DRIVER_PATHS if path.exists()]
    service = _service_state("Apple Mobile Device Service")
    mux = _mux_listening()
    ready = bool(found) or service == "RUNNING" or mux
    if ready:
        detail = "Apple USB 服务已就绪。请连接 iPhone，解锁后点按「信任」。"
    else:
        detail = (
            "Windows 尚未安装 Apple USB 驱动，无法识别 iPhone。"
            "请从 Microsoft Store 安装「Apple 设备」，重新连接手机并点按「信任」。"
        )
    return {"ready": ready, "paths": found, "service": service, "detail": detail}


def snapshot() -> dict:
    driver = driver_status()
    devices: list[dict] = []
    error = None
    try:
        devices = list_devices()
    except MuxError as exc:
        error = str(exc)
    developer_mode = developer_mode_enabled(devices[0]["udid"]) if len(devices) == 1 else None
    return {
        "library": {"ready": True, "version": "usbmux"},
        "driver": driver,
        "devices": devices,
        "developerMode": developer_mode,
        "error": error,
    }


def product_version(udid: str) -> str | None:
    """Read ProductVersion over USB lockdown, or None if unavailable."""
    try:
        data = read_handset(udid)
    except MuxError:
        return None
    if data.get("error") or not isinstance(data.get("info"), dict):
        return None
    value = data["info"].get("ProductVersion")
    return str(value).strip() if value is not None else None


def read_handset(udid: str) -> dict:
    match = next((device for device in list_devices() if device["udid"] == udid), None)
    if match is None:
        raise MuxError("这台 iPhone 尚未连接。")
    with open_lockdown(int(match["deviceId"])) as sock:
        kind = lockdown_request(sock, "QueryType")
        if kind.get("Type") != "com.apple.mobile.lockdown":
            raise MuxError("iPhone 上的 lockdown 服务未正常响应。")
        result = lockdown_request(sock, "GetValue")
    if result.get("Error"):
        return {"udid": udid, "paired": False, "info": {}, "error": _lockdown_error(str(result["Error"]))}
    values = result.get("Value") if isinstance(result.get("Value"), dict) else {}
    info = {key: values.get(key) for key in INFO_KEYS if key in values}
    return {"udid": udid, "paired": True, "info": info}


def _lockdown_error(code: str) -> str:
    messages = {
        "InvalidHostID": "这台电脑尚未与 iPhone 配对。请解锁手机并点按「信任」。",
        "PairingDialogResponsePending": "请在 iPhone 上点按「信任」。",
        "UserDeniedPairing": "iPhone 已拒绝信任这台电脑。",
        "PasswordProtected": "请解锁 iPhone 后重试。",
    }
    return messages.get(code, code)


def developer_mode_enabled(udid: str) -> bool | None:
    async def check() -> bool:
        from pymobiledevice3.lockdown import create_using_usbmux

        lockdown = await create_using_usbmux(serial=udid, autopair=False)
        try:
            return bool(await lockdown.get_developer_mode_status())
        finally:
            await lockdown.close()

    try:
        return asyncio.run(check())
    except Exception:
        return None


def _mux_listening() -> bool:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(0.4)
    try:
        sock.connect(("127.0.0.1", 27015))
        return True
    except OSError:
        return False
    finally:
        sock.close()


def _service_state(name: str) -> str | None:
    try:
        completed = subprocess.run(
            ["sc", "query", name],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    for line in completed.stdout.splitlines():
        if "STATE" in line:
            parts = line.split()
            if parts:
                return parts[-1]
    return None
