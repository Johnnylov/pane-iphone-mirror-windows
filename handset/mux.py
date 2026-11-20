"""usbmuxd plist client for the Apple mobile-device service on Windows.

The service listens on 127.0.0.1:27015 after Apple Devices or iTunes is installed.
Each packet is a little-endian length, then version, message type, tag, and an XML plist.
"""

from __future__ import annotations

import plistlib
import socket
import struct
import threading
from contextlib import contextmanager

USB_HOST = ("127.0.0.1", 27015)
LOCKDOWN_PORT = 62078
PLIST_VERSION = 1
PLIST_MESSAGE = 8
HEADER = struct.Struct("<III")
LENGTH = struct.Struct("<I")
BE_LENGTH = struct.Struct(">I")


class MuxError(ConnectionError):
    pass


def list_devices(address: tuple[str, int] = USB_HOST) -> list[dict]:
    with _session(address) as sock:
        response = _exchange(sock, {"MessageType": "ListDevices"}, tag=1)
    devices = []
    for item in response.get("DeviceList") or []:
        if item.get("MessageType") != "Attached":
            continue
        props = item.get("Properties") or {}
        devices.append(
            {
                "udid": props.get("SerialNumber") or "",
                "connection": props.get("ConnectionType") or "USB",
                "deviceId": item.get("DeviceID"),
            }
        )
    return [device for device in devices if device["udid"] and device["deviceId"] is not None]


@contextmanager
def open_lockdown(device_id: int, address: tuple[str, int] = USB_HOST):
    with _session(address) as sock:
        port = socket.htons(LOCKDOWN_PORT)
        result = _exchange(
            sock,
            {"MessageType": "Connect", "DeviceID": device_id, "PortNumber": port},
            tag=1,
        )
        if result.get("MessageType") != "Result" or result.get("Number") not in (0, None):
            number = result.get("Number")
            raise MuxError(_result_message(number))
        yield sock


def lockdown_request(sock: socket.socket, request: str, **options) -> dict:
    message = {"Label": "handset", "Request": request, "ProtocolVersion": "2"}
    message.update(options)
    payload = plistlib.dumps(message)
    sock.sendall(BE_LENGTH.pack(len(payload)) + payload)
    size = BE_LENGTH.unpack(_recv_exact(sock, 4))[0]
    if size > 8_000_000:
        raise MuxError("手机返回的数据包过大。")
    parsed = plistlib.loads(_recv_exact(sock, size))
    if not isinstance(parsed, dict):
        raise MuxError("无法解析手机返回的数据。")
    return parsed


def _exchange(sock: socket.socket, fields: dict, tag: int) -> dict:
    request = {
        "ClientVersionString": "handset",
        "ProgName": "handset",
        "kLibUSBMuxVersion": 3,
    }
    request.update(fields)
    payload = plistlib.dumps(request)
    body = HEADER.pack(PLIST_VERSION, PLIST_MESSAGE, tag) + payload
    sock.sendall(LENGTH.pack(4 + len(body)) + body)
    version, message, reply_tag, data = _recv_packet(sock)
    if version != PLIST_VERSION or message != PLIST_MESSAGE:
        raise MuxError("Apple 设备服务使用了 Pane 不支持的协议。")
    if reply_tag not in (tag, 0):
        raise MuxError("Apple 设备服务的响应与请求不匹配。")
    parsed = plistlib.loads(data)
    if not isinstance(parsed, dict):
        raise MuxError("Apple 设备服务返回了意外响应。")
    return parsed


def _recv_packet(sock: socket.socket) -> tuple[int, int, int, bytes]:
    length = LENGTH.unpack(_recv_exact(sock, 4))[0]
    if length < 16:
        raise MuxError("Apple 设备服务返回的数据包不完整。")
    rest = _recv_exact(sock, length - 4)
    version, message, tag = HEADER.unpack(rest[:12])
    return version, message, tag, rest[12:]


def _recv_exact(sock: socket.socket, size: int) -> bytes:
    chunks = []
    remaining = size
    while remaining:
        chunk = sock.recv(remaining)
        if not chunk:
            raise MuxError("Apple 设备服务已断开连接。")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


@contextmanager
def _session(address: tuple[str, int]):
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(4)
    try:
        try:
            sock.connect(address)
        except OSError as error:
            raise MuxError(
                "Apple 移动设备服务未运行。请从 Microsoft Store 安装「Apple 设备」，然后重新连接 iPhone。"
            ) from error
        yield sock
    finally:
        sock.close()


def _result_message(number: int | None) -> str:
    reasons = {
        2: "这台 iPhone 已断开连接。",
        3: "手机拒绝了连接。请解锁手机并保持数据线连接。",
        4: "请求的手机服务不可用。",
    }
    return reasons.get(number, "手机未接受连接。")


def self_check() -> None:
    """Speak the list request to a local stand-in and require one device back."""
    ready = threading.Event()
    holder: dict[str, int] = {}

    def serve() -> None:
        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server.bind(("127.0.0.1", 0))
        holder["port"] = server.getsockname()[1]
        server.listen(1)
        ready.set()
        conn, _ = server.accept()
        with conn:
            version, message, tag, data = _recv_packet(conn)
            assert version == PLIST_VERSION and message == PLIST_MESSAGE and tag == 1
            request = plistlib.loads(data)
            assert request["MessageType"] == "ListDevices"
            reply = plistlib.dumps(
                {
                    "DeviceList": [
                        {
                            "MessageType": "Attached",
                            "DeviceID": 7,
                            "Properties": {"SerialNumber": "TESTUDID", "ConnectionType": "USB"},
                        }
                    ]
                }
            )
            body = HEADER.pack(PLIST_VERSION, PLIST_MESSAGE, tag) + reply
            conn.sendall(LENGTH.pack(4 + len(body)) + body)
        server.close()

    thread = threading.Thread(target=serve)
    thread.start()
    ready.wait(2)
    found = list_devices(("127.0.0.1", holder["port"]))
    thread.join(2)
    if found != [{"udid": "TESTUDID", "connection": "USB", "deviceId": 7}]:
        raise AssertionError(found)
