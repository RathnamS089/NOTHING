// Tiny JSON settings store in the user-data folder, keyed per device address.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULT_DEVICE = {
  anc: 'anc', // 'anc' | 'transparency' | 'off'
  ancLevel: 'high',
  eqPreset: 'balanced',
  eqCustom: [0, 0, 0, 0, 0, 0, 0, 0],
  bass: { on: false, level: 2 },
  lowLag: false,
  inEar: true,
  dual: true,
  gestures: {
    left: { double: 'play_pause', triple: 'prev', hold: 'noise_control' },
    right: { double: 'play_pause', triple: 'next', hold: 'noise_control' },
  },
};

const DEFAULT_PREFS = {
  island: { enabled: true, autoCollapseMs: 5000 },
  theme: 'system', // 'system' | 'dark' | 'light'
};

class Store {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'settings.json');
    this.data = { prefs: DEFAULT_PREFS, devices: {} };
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = { prefs: { ...DEFAULT_PREFS, ...saved.prefs }, devices: saved.devices || {} };
    } catch {}
  }

  device(address) {
    return structuredClone({ ...DEFAULT_DEVICE, ...(this.data.devices[address] || {}) });
  }

  setDevice(address, patch) {
    this.data.devices[address] = { ...this.device(address), ...patch };
    this.save();
    return this.device(address);
  }

  prefs() {
    return structuredClone(this.data.prefs);
  }

  setPrefs(patch) {
    this.data.prefs = { ...this.data.prefs, ...patch };
    this.save();
    return this.prefs();
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }
}

module.exports = { Store };
