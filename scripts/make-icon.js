// Generates the tray icons (a 3x3 dot-matrix "buds" glyph) as PNGs with no dependencies.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, rgb, draw) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const a = draw(x, y);
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = rgb[0]; raw[i + 1] = rgb[1]; raw[i + 2] = rgb[2]; raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Two dot-matrix stems: dots at columns 1 and 3 (of 5), rows 0..3, plus heads.
const GRID = [
  '.#.#.',
  '##.##',
  '.#.#.',
  '.#.#.',
  '.#.#.',
];

function glyph(size) {
  const cell = size / 5;
  const r = cell * 0.36;
  return (x, y) => {
    const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
    if (GRID[gy]?.[gx] !== '#') return 0;
    const cx = (gx + 0.5) * cell, cy = (gy + 0.5) * cell;
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    return d <= r ? 255 : d <= r + 1 ? Math.round(255 * (r + 1 - d)) : 0;
  };
}

const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'trayTemplate.png'), png(16, [0, 0, 0], glyph(16)));
fs.writeFileSync(path.join(out, 'trayTemplate@2x.png'), png(32, [0, 0, 0], glyph(32)));
fs.writeFileSync(path.join(out, 'tray-win.png'), png(32, [255, 255, 255], glyph(32)));
console.log('icons written to', out);
