// nothing-link: a tiny IOBluetooth bridge for Nothing Island on macOS.
//
// Speaks newline-delimited JSON on stdin/stdout so the Electron main process
// owns all protocol logic and this helper only moves bytes.
//
// stdin  {"op":"devices"}                        -> emit paired device list
//        {"op":"connect","address":"AA:BB:.."}   -> SDP lookup + open RFCOMM
//        {"op":"write","hex":"5560..."}           -> write bytes to open channel
//        {"op":"close"}                           -> close channel
//        {"op":"connectDevice","address":".."}    -> bring up the audio link
//        {"op":"disconnectDevice","address":".."} -> drop it
// stdout {"ev":"devices","list":[...]}  {"ev":"open","channel":15}
//        {"ev":"data","hex":"..."}       {"ev":"closed"}  {"ev":"error","msg":"..."}

import Foundation
import IOBluetooth

// Nothing's vendor control service ("NT link")
let serviceUUID = IOBluetoothSDPUUID(bytes: [
    0xAE, 0xAC, 0x4A, 0x03, 0xDF, 0xF5, 0x49, 0x8F,
    0x84, 0x3A, 0x34, 0x48, 0x7C, 0xF1, 0x33, 0xEB,
] as [UInt8], length: 16)

// Channels seen in the wild when SDP doesn't answer.
let fallbackChannels: [BluetoothRFCOMMChannelID] = [15, 16]

func emit(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj),
          let line = String(data: data, encoding: .utf8) else { return }
    FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
}

func hex(_ bytes: UnsafeRawBufferPointer) -> String {
    bytes.map { String(format: "%02x", $0) }.joined()
}

func bytes(fromHex s: String) -> [UInt8] {
    var out: [UInt8] = []
    var i = s.startIndex
    while i < s.endIndex, let j = s.index(i, offsetBy: 2, limitedBy: s.endIndex) {
        if let b = UInt8(s[i..<j], radix: 16) { out.append(b) }
        i = j
    }
    return out
}

final class Link: NSObject, IOBluetoothRFCOMMChannelDelegate {
    var device: IOBluetoothDevice?
    var channel: IOBluetoothRFCOMMChannel?
    var pending: [BluetoothRFCOMMChannelID] = []
    var notifications: [IOBluetoothUserNotification] = []

    // MARK: device list + live connect/disconnect notifications

    func watch() {
        if let n = IOBluetoothDevice.register(forConnectNotifications: self, selector: #selector(deviceConnected(_:device:))) {
            notifications.append(n)
        }
        for d in (IOBluetoothDevice.pairedDevices() as? [IOBluetoothDevice]) ?? [] where d.isConnected() {
            d.register(forDisconnectNotification: self, selector: #selector(deviceDisconnected(_:device:)))
        }
    }

    @objc func deviceConnected(_ n: IOBluetoothUserNotification, device: IOBluetoothDevice) {
        device.register(forDisconnectNotification: self, selector: #selector(deviceDisconnected(_:device:)))
        emitDevices()
    }

    @objc func deviceDisconnected(_ n: IOBluetoothUserNotification, device: IOBluetoothDevice) {
        n.unregister()
        if device.addressString == self.device?.addressString { closeChannel() }
        // The stack flips isConnected slightly after the notification fires.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self.emitDevices() }
    }

    func emitDevices() {
        let list = ((IOBluetoothDevice.pairedDevices() as? [IOBluetoothDevice]) ?? []).map { d -> [String: Any] in
            ["name": d.name ?? "", "address": (d.addressString ?? "").uppercased().replacingOccurrences(of: "-", with: ":"), "connected": d.isConnected()]
        }
        emit(["ev": "devices", "list": list])
    }

    // MARK: audio link (device switching)

    func connectDevice(_ address: String) {
        guard let d = IOBluetoothDevice(addressString: address) else {
            return emit(["ev": "device", "address": address, "ok": false])
        }
        if d.isConnected() { return emit(["ev": "device", "address": address, "ok": true]) }
        let r = d.openConnection(self)
        if r != kIOReturnSuccess { emit(["ev": "device", "address": address, "ok": false]) }
    }

    @objc func connectionComplete(_ d: IOBluetoothDevice!, status: IOReturn) {
        emit(["ev": "device", "address": (d.addressString ?? "").uppercased().replacingOccurrences(of: "-", with: ":"), "ok": status == kIOReturnSuccess])
    }

    func disconnectDevice(_ address: String) {
        guard let d = IOBluetoothDevice(addressString: address) else { return }
        if d.addressString == device?.addressString { closeChannel() }
        if d.isConnected() { d.closeConnection() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { self.emitDevices() }
    }

    // MARK: RFCOMM

    func connect(_ address: String) {
        closeChannel()
        guard let d = IOBluetoothDevice(addressString: address) else {
            return emit(["ev": "error", "msg": "unknown device \(address)"])
        }
        device = d
        if !d.isConnected() {
            return emit(["ev": "error", "msg": "device not connected"])
        }
        let r = d.performSDPQuery(self, uuids: [serviceUUID])
        if r != kIOReturnSuccess { sdpQueryComplete(d, status: r) }
    }

    @objc func sdpQueryComplete(_ d: IOBluetoothDevice!, status: IOReturn) {
        var id: BluetoothRFCOMMChannelID = 0
        if let rec = d.getServiceRecord(for: serviceUUID), rec.getRFCOMMChannelID(&id) == kIOReturnSuccess {
            pending = [id] + fallbackChannels.filter { $0 != id }
        } else {
            pending = fallbackChannels
        }
        openNext()
    }

    func openNext() {
        guard let d = device, !pending.isEmpty else {
            return emit(["ev": "error", "msg": "no control channel"])
        }
        let id = pending.removeFirst()
        var ch: IOBluetoothRFCOMMChannel?
        let r = d.openRFCOMMChannelAsync(&ch, withChannelID: id, delegate: self)
        if r != kIOReturnSuccess { openNext() }
    }

    func rfcommChannelOpenComplete(_ ch: IOBluetoothRFCOMMChannel!, status error: IOReturn) {
        if error == kIOReturnSuccess {
            channel = ch
            emit(["ev": "open", "channel": Int(ch.getID())])
        } else {
            openNext()
        }
    }

    func rfcommChannelData(_ ch: IOBluetoothRFCOMMChannel!, data ptr: UnsafeMutableRawPointer!, length: Int) {
        emit(["ev": "data", "hex": hex(UnsafeRawBufferPointer(start: ptr, count: length))])
    }

    func rfcommChannelClosed(_ ch: IOBluetoothRFCOMMChannel!) {
        if ch == channel {
            channel = nil
            emit(["ev": "closed"])
        }
    }

    func write(_ hexString: String) {
        guard let ch = channel else { return emit(["ev": "error", "msg": "channel not open"]) }
        var buf = bytes(fromHex: hexString)
        let r = buf.withUnsafeMutableBytes { ch.writeSync($0.baseAddress, length: UInt16($0.count)) }
        if r != kIOReturnSuccess { emit(["ev": "error", "msg": "write failed \(r)"]) }
    }

    func closeChannel() {
        if let ch = channel {
            channel = nil
            ch.close()
            emit(["ev": "closed"])
        }
    }
}

// macOS attributes Bluetooth privacy checks to the "responsible" app, which is
// whatever launched us (Electron, a terminal...). Re-spawn ourselves with the
// responsibility disclaimed so the check uses this binary's own Info.plist.
@_silgen_name("responsibility_spawnattrs_setdisclaim")
func responsibility_spawnattrs_setdisclaim(_ attrs: UnsafeMutablePointer<posix_spawnattr_t?>, _ disclaim: Int32) -> Int32

func disclaimResponsibility() {
    if getenv("NOTHING_LINK_DISCLAIMED") != nil { return }
    guard let exe = Bundle.main.executablePath else { return }
    var attr: posix_spawnattr_t?
    posix_spawnattr_init(&attr)
    defer { posix_spawnattr_destroy(&attr) }
    _ = responsibility_spawnattrs_setdisclaim(&attr, 1)
    setenv("NOTHING_LINK_DISCLAIMED", "1", 1)
    var argv: [UnsafeMutablePointer<CChar>?] = CommandLine.arguments.map { strdup($0) } + [nil]
    var pid: pid_t = 0
    guard posix_spawn(&pid, exe, nil, &attr, &argv, environ) == 0 else { return }
    signal(SIGTERM) { _ in exit(0) } // child exits on its own when stdin closes
    var status: Int32 = 0
    waitpid(pid, &status, 0)
    exit((status >> 8) & 0xff)
}

disclaimResponsibility()

let link = Link()

func handle(_ line: String) {
    guard let data = line.data(using: .utf8),
          let msg = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let op = msg["op"] as? String else { return }
    switch op {
    case "devices": link.emitDevices()
    case "connect": link.connect(msg["address"] as? String ?? "")
    case "write": link.write(msg["hex"] as? String ?? "")
    case "close": link.closeChannel()
    case "connectDevice": link.connectDevice(msg["address"] as? String ?? "")
    case "disconnectDevice": link.disconnectDevice(msg["address"] as? String ?? "")
    default: emit(["ev": "error", "msg": "unknown op \(op)"])
    }
}

var stdinBuffer = Data()
FileHandle.standardInput.readabilityHandler = { h in
    let chunk = h.availableData
    if chunk.isEmpty { exit(0) } // parent went away
    stdinBuffer.append(chunk)
    while let nl = stdinBuffer.firstIndex(of: 0x0A) {
        let line = String(data: stdinBuffer[stdinBuffer.startIndex..<nl], encoding: .utf8) ?? ""
        stdinBuffer.removeSubrange(stdinBuffer.startIndex...nl)
        DispatchQueue.main.async { handle(line) }
    }
}

link.watch()
emit(["ev": "ready"])
link.emitDevices()
RunLoop.main.run()
