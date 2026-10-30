// Polls the OS Bluetooth stack for connected Nothing / CMF audio devices.
// macOS: system_profiler (no extra permissions needed).
// Windows: PnP device properties via PowerShell (IsConnected + battery level).

const { execFile } = require('child_process');
const { EventEmitter } = require('events');
const { isNothingDevice, identify, normaliseAddress } = require('./devices');

const POLL_MS = 3000;

function run(cmd, args, timeout = 8000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      resolve(err ? null : stdout);
    });
  });
}

const pct = (v) => {
  const n = parseInt(String(v ?? '').replace('%', ''), 10);
  return Number.isFinite(n) ? n : null;
};

async function scanMac() {
  const out = await run('system_profiler', ['SPBluetoothDataType', '-json']);
  if (!out) return [];
  let data;
  try { data = JSON.parse(out); } catch { return []; }
  const devices = [];
  for (const ctrl of data.SPBluetoothDataType || []) {
    for (const entry of ctrl.device_connected || []) {
      const [name, props] = Object.entries(entry)[0];
      devices.push({
        name,
        address: normaliseAddress(props.device_address),
        battery: {
          left: pct(props.device_batteryLevelLeft),
          right: pct(props.device_batteryLevelRight),
          case: pct(props.device_batteryLevelCase),
          main: pct(props.device_batteryLevelMain ?? props.device_batteryLevel),
        },
        firmware: props.device_firmwareVersion || null,
      });
    }
  }
  return devices;
}

// DEVPKEY_Device_IsConnected / DEVPKEY_Bluetooth_Battery
const WIN_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$out = @()
Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like 'BTHENUM\\*' -or $_.InstanceId -like 'BTHLE*' -or $_.Class -eq 'Bluetooth' } | ForEach-Object {
  $c = (Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName '{83DA6326-97A6-4088-9453-A1923F573B29} 15').Data
  $b = (Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2').Data
  $out += [pscustomobject]@{ name = $_.FriendlyName; id = $_.InstanceId; connected = $c; battery = $b }
}
$out | ConvertTo-Json -Compress
`;

async function scanWindows() {
  const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_SCRIPT], 15000);
  if (!out || !out.trim()) return [];
  let rows;
  try { rows = JSON.parse(out); } catch { return []; }
  if (!Array.isArray(rows)) rows = [rows];

  // One headset shows up as several PnP nodes (A2DP, HFP, AVRCP...). Merge them by MAC.
  const byAddr = new Map();
  for (const r of rows) {
    const mac = (r.id || '').match(/([0-9A-F]{12})(?:_|\\|$)/i)?.[1];
    if (!mac || !r.name) continue;
    const address = normaliseAddress(mac);
    const prev = byAddr.get(address) || { name: r.name, address, connected: false, battery: { left: null, right: null, case: null, main: null } };
    if (r.connected === true) prev.connected = true;
    if (r.battery != null) prev.battery.main = pct(r.battery);
    if (r.name.length < prev.name.length) prev.name = r.name; // shortest is usually the product name
    byAddr.set(address, prev);
  }
  return [...byAddr.values()].filter((d) => d.connected);
}

class Detector extends EventEmitter {
  constructor() {
    super();
    this.current = null;
    this.timer = null;
    this.busy = false;
  }

  start() {
    this.tick();
    this.timer = setInterval(() => this.tick(), POLL_MS);
  }

  stop() {
    clearInterval(this.timer);
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const all = process.platform === 'darwin' ? await scanMac()
        : process.platform === 'win32' ? await scanWindows()
        : [];
      const found = all.find((d) => isNothingDevice(d.name, d.address));
      const next = found ? { ...found, model: identify(found.name) } : null;
      this.update(next);
    } finally {
      this.busy = false;
    }
  }

  update(next) {
    const prev = this.current;
    this.current = next;
    if (!prev && next) this.emit('connected', next);
    else if (prev && !next) this.emit('disconnected', prev);
    else if (prev && next && prev.address !== next.address) {
      this.emit('disconnected', prev);
      this.emit('connected', next);
    } else if (next && JSON.stringify(prev) !== JSON.stringify(next)) this.emit('updated', next);
  }
}

module.exports = { Detector };
