#!/usr/bin/env python3
"""nothing-link for Linux (BlueZ).

Same newline-delimited JSON protocol as the macOS helper:
  stdin   devices | connect {address} | write {hex} | close
          connectDevice {address} | disconnectDevice {address}
  stdout  ready | devices {list} | open {channel} | data {hex} | closed
          device {address, ok} | error {msg}

Device state comes from `bluetoothctl`; the control channel is a plain RFCOMM
socket from the standard library, so nothing beyond Python 3 and BlueZ is needed.
"""

import json
import re
import shutil
import socket
import subprocess
import sys
import threading
import time

SERVICE_UUID = "aeac4a03-dff5-498f-843a-34487cf133eb"
FALLBACK_CHANNELS = [15, 16]
POLL_SECONDS = 2.0

out_lock = threading.Lock()


def emit(**msg):
    with out_lock:
        sys.stdout.write(json.dumps(msg) + "\n")
        sys.stdout.flush()


def ctl(*args, timeout=10):
    try:
        res = subprocess.run(["bluetoothctl", *args], capture_output=True, text=True, timeout=timeout)
        return res.stdout
    except (OSError, subprocess.TimeoutExpired):
        return ""


def paired_devices():
    # BlueZ >= 5.65 uses `devices Paired`; older releases have `paired-devices`.
    listing = ctl("devices", "Paired") or ctl("paired-devices")
    devices = []
    for line in listing.splitlines():
        m = re.match(r"Device ([0-9A-F:]{17}) (.+)", line.strip(), re.I)
        if not m:
            continue
        address, name = m.group(1).upper(), m.group(2)
        info = ctl("info", address, timeout=5)
        devices.append({"name": name, "address": address, "connected": "Connected: yes" in info})
    return devices


def sdp_channel(address):
    """Ask SDP for the vendor service's RFCOMM channel (needs the legacy sdptool)."""
    if not shutil.which("sdptool"):
        return None
    try:
        xml = subprocess.run(["sdptool", "browse", "--xml", address], capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.TimeoutExpired):
        return None
    for record in xml.split("<record>"):
        if SERVICE_UUID not in record.lower():
            continue
        # RFCOMM protocol descriptor: uuid 0x0003 followed by the channel number.
        m = re.search(r'value="0x0003"\s*/>\s*<uint8 value="0x([0-9a-f]+)"', record, re.I)
        if m:
            return int(m.group(1), 16)
    return None


class Link:
    def __init__(self):
        self.sock = None
        self.address = None
        self.last_devices = None

    # ---- device list -------------------------------------------------------

    def emit_devices(self, force=False):
        devices = paired_devices()
        if force or devices != self.last_devices:
            self.last_devices = devices
            emit(ev="devices", list=devices)
            if self.sock and not any(d["address"] == self.address and d["connected"] for d in devices):
                self.close()

    def watch(self):
        while True:
            self.emit_devices()
            time.sleep(POLL_SECONDS)

    # ---- control channel -----------------------------------------------------

    def connect(self, address):
        self.close()
        address = address.upper()
        found = sdp_channel(address)
        channels = ([found] if found else []) + [c for c in FALLBACK_CHANNELS if c != found]
        for channel in channels:
            sock = socket.socket(socket.AF_BLUETOOTH, socket.SOCK_STREAM, socket.BTPROTO_RFCOMM)
            sock.settimeout(6)
            try:
                sock.connect((address, channel))
            except OSError:
                sock.close()
                continue
            sock.settimeout(None)
            self.sock, self.address = sock, address
            emit(ev="open", channel=channel)
            threading.Thread(target=self.reader, args=(sock,), daemon=True).start()
            return
        emit(ev="error", msg="no control channel")

    def reader(self, sock):
        try:
            while True:
                data = sock.recv(1024)
                if not data:
                    break
                emit(ev="data", hex=data.hex())
        except OSError:
            pass
        if sock is self.sock:
            self.sock = None
            emit(ev="closed")

    def write(self, hex_string):
        if not self.sock:
            return emit(ev="error", msg="channel not open")
        try:
            self.sock.sendall(bytes.fromhex(hex_string))
        except OSError as e:
            emit(ev="error", msg=f"write failed: {e}")

    def close(self):
        sock, self.sock = self.sock, None
        if sock:
            try:
                sock.close()
            finally:
                emit(ev="closed")

    # ---- audio link (switching) -----------------------------------------------

    def connect_device(self, address):
        ok = "successful" in ctl("connect", address, timeout=20).lower()
        emit(ev="device", address=address.upper(), ok=ok)
        self.emit_devices(force=True)

    def disconnect_device(self, address):
        if address.upper() == self.address:
            self.close()
        ctl("disconnect", address, timeout=10)
        self.emit_devices(force=True)


def main():
    if not shutil.which("bluetoothctl"):
        emit(ev="error", msg="bluetoothctl not found (install bluez)")
    link = Link()
    emit(ev="ready")
    threading.Thread(target=link.watch, daemon=True).start()
    ops = {
        "devices": lambda m: link.emit_devices(force=True),
        "connect": lambda m: link.connect(m.get("address", "")),
        "write": lambda m: link.write(m.get("hex", "")),
        "close": lambda m: link.close(),
        # Slow (bluetoothctl waits for the profile), so keep stdin responsive.
        "connectDevice": lambda m: threading.Thread(target=link.connect_device, args=(m.get("address", ""),), daemon=True).start(),
        "disconnectDevice": lambda m: threading.Thread(target=link.disconnect_device, args=(m.get("address", ""),), daemon=True).start(),
    }
    for line in sys.stdin:
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        handler = ops.get(msg.get("op"))
        if handler:
            handler(msg)
        else:
            emit(ev="error", msg=f"unknown op {msg.get('op')}")
    link.close()


if __name__ == "__main__":
    main()
