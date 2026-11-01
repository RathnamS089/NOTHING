// Declarative map of what the buds can do, in the app's own vocabulary.
//
// Each feature names the command it is read with (`read`) and written with
// (`write`), and translates between wire payloads and the values the UI and
// settings store use. The controller never deals in raw bytes beyond this file,
// and any incoming frame whose command matches a `read` id (a reply *or* a
// push from the buds) updates that feature, so pinching the buds to change ANC
// updates the app without polling.

// Noise control: the app splits it into a mode plus a level; the buds use one byte.
const ANC_WIRE = { high: 0x01, mid: 0x02, low: 0x03, adaptive: 0x04, off: 0x05, transparency: 0x07 };
const ANC_FROM_WIRE = Object.fromEntries(Object.entries(ANC_WIRE).map(([k, v]) => [v, k]));

// EQ preset bytes differ per product family.
const EQ_FAMILIES = {
  standard: { balanced: 0, bass: 1, treble: 2, voice: 3, custom: 4 },
  'cmf-buds-2': { balanced: 0, rock: 1, electronic: 2, pop: 3, vocals: 4, classical: 5, custom: 6 },
};

// Custom EQ is three filters; on the wire they are ordered mid, treble, bass and
// each carries its own filter type, centre frequency and Q.
const EQ_BANDS = [
  { key: 'mid', type: 0x01, freq: 980, q: 0.66 },
  { key: 'treble', type: 0x02, freq: 3500, q: 1.0 },
  { key: 'bass', type: 0x00, freq: 140, q: 0.8 },
];
const EQ_BAND_SIZE = 13; // type u8 + gain f32 + freq f32 + q f32
const EQ_PAYLOAD_SIZE = 53;

const BATTERY_PART = { 0x01: 'both', 0x02: 'left', 0x03: 'right', 0x04: 'case', 0x06: 'main' };

const GESTURE_TYPE = { double: 0x02, triple: 0x03, hold: 0x07 };
const GESTURE_ACTION = {
  none: 0x01, prev: 0x08, next: 0x09, noise_control: 0x0a,
  voice_assistant: 0x0b, volume_up: 0x12, volume_down: 0x13,
};
const SIDE = { both: 0x01, left: 0x02, right: 0x03 };

const lastByte = (p) => p[p.length - 1];

const FEATURES = {
  battery: {
    read: 0x07,
    decode(p) {
      const out = { left: null, right: null, case: null, main: null, charging: {} };
      for (let i = 1; i + 1 < p.length && (i - 1) / 2 < p[0]; i += 2) {
        const part = BATTERY_PART[p[i]];
        const level = p[i + 1] & 0x7f;
        if (!part || level > 100) continue;
        const charging = (p[i + 1] & 0x80) !== 0;
        for (const k of part === 'both' ? ['left', 'right'] : [part]) {
          out[k] = level;
          out.charging[k] = charging;
        }
      }
      return out;
    },
  },

  anc: {
    read: 0x1e,
    write: 0x0f,
    push: 0x03, // sent by the buds when ANC changes on them (pinch)
    decode(p) {
      // Replies list [0x01, mode, ...] records; take the first noise-control record.
      for (let i = 0; i + 1 < p.length; i += 3) if (p[i] === 0x01) return split(ANC_FROM_WIRE[p[i + 1]]);
      return p.length > 1 ? split(ANC_FROM_WIRE[p[1]]) : null;
    },
    encode: ({ anc, ancLevel }) => [0x01, ANC_WIRE[anc === 'anc' ? ancLevel : anc] ?? ANC_WIRE.high, 0x00],
  },

  eqPreset: {
    read: (m) => (m.eqFamily === 'cmf-buds-2' ? 0x50 : 0x1f),
    write: (m) => (m.eqFamily === 'cmf-buds-2' ? 0x1d : 0x10),
    decode(p, m) {
      const table = EQ_FAMILIES[m.eqFamily] || EQ_FAMILIES.standard;
      return Object.keys(table).find((k) => table[k] === p[0]) ?? null;
    },
    encode: (preset, m) => [(EQ_FAMILIES[m.eqFamily] || EQ_FAMILIES.standard)[preset] ?? 0, 0x00],
  },

  eqCustom: {
    read: 0x44,
    write: 0x41,
    // Replies list bands in their own order, so identify each by its filter-type byte.
    decode(p) {
      const count = p[0];
      if (!count || p.length < 5 + count * EQ_BAND_SIZE) return null;
      const gains = {};
      for (let i = 0; i < count; i++) {
        const at = 5 + i * EQ_BAND_SIZE;
        const band = EQ_BANDS.find((b) => b.type === p[at]);
        if (band) gains[band.key] = Math.round(p.readFloatLE(at + 1));
      }
      return ['bass', 'mid', 'treble'].every((k) => k in gains) ? [gains.bass, gains.mid, gains.treble] : null;
    },
    encode([bass, mid, treble]) {
      const gain = { bass, mid, treble };
      const buf = Buffer.alloc(EQ_PAYLOAD_SIZE);
      buf[0] = EQ_BANDS.length;
      // Pre-gain: pull the whole curve down by the largest boost to avoid clipping.
      buf.writeFloatLE(-Math.max(0, bass, mid, treble) || -0, 1);
      EQ_BANDS.forEach((b, i) => {
        const at = 5 + i * EQ_BAND_SIZE;
        buf[at] = b.type;
        buf.writeFloatLE(clamp(gain[b.key], -12, 12), at + 1);
        buf.writeFloatLE(b.freq, at + 5);
        buf.writeFloatLE(b.q, at + 9);
      });
      return [...buf];
    },
  },

  bass: {
    read: 0x4e,
    write: 0x51,
    decode: (p) => (p.length >= 2 ? { on: p[0] === 1, level: clamp(Math.round(p[1] / 2), 1, 5) } : null),
    encode: ({ on, level }) => [on ? 1 : 0, clamp(level, 1, 5) * 2],
  },

  lowLag: {
    read: 0x41,
    write: 0x40,
    decode: (p) => p[0] === 1,
    encode: (on) => [on ? 1 : 2, 0x00],
  },

  inEar: {
    read: 0x0e,
    write: 0x04,
    // Expected [0x01, state] or [0x02, 0x01, state]; some CMF firmware answers this
    // command with an unrelated list, which must not be read as "off".
    decode: (p) => (p.length >= 2 && p.length <= 4 ? lastByte(p.subarray(0, Math.min(p.length, 3))) === 1 : null),
    encode: (on) => [0x01, 0x01, on ? 1 : 0],
  },

  firmware: {
    read: 0x42,
    decode: (p) => p.toString('ascii').replace(/\0/g, '').trim() || null,
  },
};

// Commands that don't map to a stored setting.
const ACTIONS = {
  // Ring and stop are addressed per bud: a stop for one side leaves the other ringing.
  ring: { write: 0x02, encode: (side, on = true) => [SIDE[side] ?? SIDE.both, on ? 1 : 0] },
  gesture: {
    write: 0x03,
    encode: (side, type, action) => [0x01, SIDE[side], 0x01, GESTURE_TYPE[type], GESTURE_ACTION[action]],
    supports: (type, action) => GESTURE_TYPE[type] != null && GESTURE_ACTION[action] != null,
  },
};

function split(mode) {
  if (!mode) return null;
  return mode === 'off' || mode === 'transparency' ? { anc: mode } : { anc: 'anc', ancLevel: mode };
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, Number(v) || 0));
}

const resolve = (id, model) => (typeof id === 'function' ? id(model) : id);

module.exports = { FEATURES, ACTIONS, EQ_FAMILIES, GESTURE_ACTION, resolve };
