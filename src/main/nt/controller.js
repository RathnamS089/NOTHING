// Owns the control channel to one pair of buds: opens it, reads their current
// state, writes setting changes, and turns pushes from the buds into updates.

const { EventEmitter } = require('events');
const { KIND, encode, Decoder } = require('./frame');
const { FEATURES, ACTIONS, resolve } = require('./features');

const REPLY_TIMEOUT_MS = 1500;
const OPEN_TIMEOUT_MS = 8000;
const RING_MAX_MS = 20000;

// Read order on connect: what the island needs first.
const SYNC_ORDER = ['battery', 'anc', 'eqPreset', 'eqCustom', 'bass', 'lowLag', 'inEar', 'firmware'];

class Controller extends EventEmitter {
  constructor(bridge) {
    super();
    this.bridge = bridge;
    this.decoder = new Decoder();
    this.device = null;
    this.open = false;
    this.seq = 0;
    this.waiting = []; // { command, kinds, resolve, timer }
    this.live = {};
    this.queue = Promise.resolve();

    bridge.on('data', (chunk) => this.decoder.push(chunk).forEach((f) => this.onFrame(f)));
    bridge.on('closed', () => this.markClosed());
  }

  get model() {
    return this.device?.model || {};
  }

  // ---- lifecycle --------------------------------------------------------

  async attach(device) {
    if (this.device?.address === device.address && this.open) return true;
    this.detach();
    this.device = device;
    this.live = {};
    const opened = await new Promise((resolve) => {
      const done = (ok) => { clearTimeout(t); this.bridge.off('open', onOpen); this.bridge.off('error', onErr); resolve(ok); };
      const onOpen = () => done(true);
      const onErr = (e) => { this.emit('log', `open failed: ${e.msg}`); done(false); };
      const t = setTimeout(() => done(false), OPEN_TIMEOUT_MS);
      this.bridge.once('open', onOpen);
      this.bridge.once('error', onErr);
      if (!this.bridge.openChannel(device.address)) done(false);
    });
    if (!opened || this.device?.address !== device.address) return false;
    this.open = true;
    this.emit('status', true);
    await this.sync();
    return true;
  }

  detach() {
    clearTimeout(this.ringTimer);
    if (this.open) this.bridge.closeChannel();
    this.markClosed();
    this.device = null;
  }

  markClosed() {
    const was = this.open;
    this.open = false;
    this.waiting.splice(0).forEach((w) => { clearTimeout(w.timer); w.resolve(null); });
    if (was) this.emit('status', false);
  }

  // ---- request / reply ----------------------------------------------------

  // Requests are serialised: the buds answer in order and some firmware drops
  // commands that arrive while another is in flight.
  request(command, kind, payload = []) {
    const run = () => new Promise((resolve) => {
      if (!this.open) return resolve(null);
      const seq = (this.seq = (this.seq % 250) + 1);
      const kinds = kind === KIND.GET ? [KIND.REPLY] : [KIND.ACK, KIND.REPLY];
      const entry = { command, kinds, resolve };
      entry.timer = setTimeout(() => { this.waiting = this.waiting.filter((w) => w !== entry); resolve(null); }, REPLY_TIMEOUT_MS);
      this.waiting.push(entry);
      this.bridge.write(encode(command, kind, payload, seq));
    });
    const p = this.queue.then(run);
    this.queue = p.catch(() => {});
    return p;
  }

  onFrame(frame) {
    const i = this.waiting.findIndex((w) => w.command === frame.command && w.kinds.includes(frame.kind));
    if (i >= 0) {
      const [w] = this.waiting.splice(i, 1);
      clearTimeout(w.timer);
      w.resolve(frame);
    }
    // Replies and pushes both carry fresh state for whichever feature reads that command.
    if (frame.kind === KIND.REPLY || frame.kind === KIND.PUSH) this.absorb(frame);
  }

  absorb(frame) {
    for (const [name, f] of Object.entries(FEATURES)) {
      if (resolve(f.read, this.model) !== frame.command) continue;
      let value;
      try { value = f.decode(frame.payload, this.model); } catch { value = null; }
      if (value == null) continue;
      this.live[name] = value;
      this.emit('live', { ...this.live });
    }
  }

  // ---- high-level ops -----------------------------------------------------

  async sync() {
    for (const name of SYNC_ORDER) {
      if (!this.supports(name)) continue;
      await this.request(resolve(FEATURES[name].read, this.model), KIND.GET);
    }
    this.emit('live', { ...this.live });
  }

  supports(name) {
    const f = this.model.features || {};
    if (name === 'anc') return !!f.anc;
    if (name === 'bass') return !!f.bass;
    if (name === 'lowLag') return !!f.lowLag;
    if (name === 'eqPreset' || name === 'eqCustom') return !!f.eq;
    return true;
  }

  async set(name, value) {
    const f = FEATURES[name];
    if (!f?.write || !this.supports(name)) return false;
    const ack = await this.request(resolve(f.write, this.model), KIND.SET, f.encode(value, this.model));
    if (ack) {
      // The buds don't always echo state after a SET; record what we wrote.
      this.live[name] = name === 'anc' ? { anc: value.anc, ...(value.anc === 'anc' ? { ancLevel: value.ancLevel } : {}) } : value;
      this.emit('live', { ...this.live });
    }
    return !!ack;
  }

  // Push only what changed between two settings snapshots.
  async applyDiff(prev, next) {
    const changed = (k) => JSON.stringify(prev?.[k]) !== JSON.stringify(next[k]);
    const writes = [];
    if (changed('anc') || changed('ancLevel')) writes.push(['anc', { anc: next.anc, ancLevel: next.ancLevel }]);
    for (const k of ['eqPreset', 'eqCustom', 'bass', 'lowLag', 'inEar']) if (changed(k)) writes.push([k, next[k]]);
    // Selecting "custom" only takes effect once the curve is on the buds too.
    if (changed('eqPreset') && next.eqPreset === 'custom') writes.push(['eqCustom', next.eqCustom]);
    if (changed('gestures')) {
      for (const side of ['left', 'right']) {
        for (const [type, action] of Object.entries(next.gestures[side])) {
          if (prev?.gestures?.[side]?.[type] === action || !ACTIONS.gesture.supports(type, action)) continue;
          writes.push(['gesture', [side, type, action]]);
        }
      }
    }
    const results = [];
    for (const [name, value] of writes) {
      if (name === 'gesture') {
        results.push(!!(await this.request(ACTIONS.gesture.write, KIND.SET, ACTIONS.gesture.encode(...value))));
      } else {
        results.push(await this.set(name, value));
      }
    }
    return results.every(Boolean);
  }

  // Ringing keeps going until told otherwise, so every ring arms an auto-stop,
  // and stopping always addresses each bud individually.
  async ring(side, on = true) {
    clearTimeout(this.ringTimer);
    if (!on) {
      const acks = [];
      for (const s of ['left', 'right', 'both']) acks.push(await this.request(ACTIONS.ring.write, KIND.SET, ACTIONS.ring.encode(s, false)));
      return acks.some(Boolean);
    }
    const ok = !!(await this.request(ACTIONS.ring.write, KIND.SET, ACTIONS.ring.encode(side, true)));
    if (ok) this.ringTimer = setTimeout(() => this.ring(side, false), RING_MAX_MS);
    return ok;
  }
}

module.exports = { Controller };
