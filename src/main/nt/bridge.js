// Spawns the per-OS Bluetooth helper and speaks its JSON-lines protocol.
//
// Every helper implements the same ops, so the rest of the app is OS-agnostic:
//   devices                 -> {"ev":"devices","list":[{name,address,connected}]}
//   connect {address}       -> {"ev":"open"} | {"ev":"error"}   (RFCOMM control channel)
//   write {hex} / close
//   connectDevice {address} -> {"ev":"device","address","ok"}   (audio link, for switching)
//   disconnectDevice {address}

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

function nativeDir() {
  // Packaged builds ship helpers under resources/native (see "extraResources" in package.json).
  const packaged = process.resourcesPath && path.join(process.resourcesPath, 'native');
  return packaged && fs.existsSync(packaged) ? packaged : path.join(__dirname, '..', '..', '..', 'native');
}

function helperCommand() {
  const dir = nativeDir();
  if (process.platform === 'darwin') {
    const bin = path.join(dir, 'bin', 'nothing-link');
    return fs.existsSync(bin) ? [bin, []] : null;
  }
  if (process.platform === 'linux') {
    const script = path.join(dir, 'linux', 'nothing_link.py');
    // Absolute interpreter path so a `python3` earlier on PATH can't stand in for it.
    const python = ['/usr/bin/python3', '/bin/python3'].find((p) => fs.existsSync(p));
    return python && fs.existsSync(script) ? [python, ['-I', '-u', script]] : null;
  }
  return null; // Windows bridge not written yet; detection falls back to polling.
}

class Bridge extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.devices = [];
    this.restarts = 0;
  }

  get available() {
    return !!this.proc;
  }

  start() {
    const cmd = helperCommand();
    if (!cmd) return false;
    const proc = spawn(cmd[0], cmd[1], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;
    let buf = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) this.onLine(line);
      }
    });
    proc.stderr.on('data', (d) => process.env.NOTHING_DEBUG && process.stderr.write(`[bridge] ${d}`));
    proc.on('exit', (code, signal) => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.emit('closed');
      this.emit('exit', { code, signal });
      // Keep the helper alive, but don't spin if it keeps dying (e.g. Bluetooth permission denied).
      if (!this.stopping && this.restarts++ < 3) setTimeout(() => this.start(), 2000);
    });
    return true;
  }

  stop() {
    this.stopping = true;
    this.proc?.kill();
    this.proc = null;
  }

  onLine(line) {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (process.env.NOTHING_DEBUG && msg.ev !== 'devices') console.log('[bridge]', line.slice(0, 200));
    switch (msg.ev) {
      case 'devices': this.devices = msg.list || []; this.emit('devices', this.devices); break;
      case 'data': this.emit('data', Buffer.from(msg.hex, 'hex')); break;
      default: this.emit(msg.ev, msg);
    }
  }

  send(op, extra = {}) {
    if (!this.proc) return false;
    this.proc.stdin.write(JSON.stringify({ op, ...extra }) + '\n');
    return true;
  }

  listDevices() { return this.send('devices'); }
  openChannel(address) { return this.send('connect', { address }); }
  write(buf) { return this.send('write', { hex: buf.toString('hex') }); }
  closeChannel() { return this.send('close'); }
  connectDevice(address) { return this.send('connectDevice', { address }); }
  disconnectDevice(address) { return this.send('disconnectDevice', { address }); }
}

module.exports = { Bridge };
