// node --test test/
const test = require('node:test');
const assert = require('node:assert');
const { encode, Decoder, crc16, KIND } = require('../src/main/nt/frame');
const { FEATURES } = require('../src/main/nt/features');

test('crc16/arc check value', () => {
  // CRC-16/MODBUS-style init 0xFFFF over "123456789" is 0x4B37
  assert.strictEqual(crc16(Buffer.from('123456789')), 0x4b37);
});

test('encode then decode round-trips, across split chunks and noise', () => {
  const a = encode(0x07, KIND.GET, [], 3);
  const b = encode(0x0f, KIND.SET, [1, 7, 0], 4);
  assert.deepStrictEqual([...a.subarray(0, 8)], [0x55, 0x60, 0x01, 0x07, 0xc0, 0x00, 0x00, 0x03]);
  const stream = Buffer.concat([Buffer.from([0x00, 0x55, 0x12]), a, b]);
  const d = new Decoder();
  const got = [...d.push(stream.subarray(0, 9)), ...d.push(stream.subarray(9))];
  assert.deepStrictEqual(got.map((f) => [f.command, f.kind, f.seq, [...f.payload]]), [[0x07, 0xc0, 3, []], [0x0f, 0xf0, 4, [1, 7, 0]]]);
});

test('corrupted frame is dropped', () => {
  const a = encode(0x07, KIND.GET, [9], 1);
  a[8] ^= 0xff;
  assert.strictEqual(new Decoder().push(a).length, 0);
});

test('battery decode with charging case', () => {
  const p = Buffer.from([3, 0x02, 86, 0x03, 81, 0x04, 0x80 | 64]);
  const b = FEATURES.battery.decode(p);
  assert.deepStrictEqual([b.left, b.right, b.case, b.charging.case], [86, 81, 64, true]);
});

test('anc encode/decode', () => {
  assert.deepStrictEqual(FEATURES.anc.encode({ anc: 'anc', ancLevel: 'mid' }), [1, 2, 0]);
  assert.deepStrictEqual(FEATURES.anc.encode({ anc: 'transparency' }), [1, 7, 0]);
  assert.deepStrictEqual(FEATURES.anc.decode(Buffer.from([1, 4, 0])), { anc: 'anc', ancLevel: 'adaptive' });
});

test('custom eq layout: flat curve and round trip', () => {
  const flat = Buffer.from(FEATURES.eqCustom.encode([0, 0, 0]));
  assert.strictEqual(flat.length, 53);
  assert.deepStrictEqual([...flat.subarray(0, 18)],
    [0x03, 0x00, 0x00, 0x00, 0x80, 0x01, 0, 0, 0, 0, 0x00, 0x00, 0x75, 0x44, 0xc3, 0xf5, 0x28, 0x3f]);
  const curve = Buffer.from(FEATURES.eqCustom.encode([4, -2, 3]));
  assert.deepStrictEqual(FEATURES.eqCustom.decode(curve), [4, -2, 3]);
  assert.strictEqual(curve.readFloatLE(1), -4);
});

test('real CMF Buds 2a battery reply (payload-only CRC)', () => {
  const [f] = new Decoder().push(Buffer.from('556001074005000102026403641cbc', 'hex'));
  assert.ok(f, 'frame decoded');
  assert.strictEqual(f.kind, KIND.REPLY);
  const b = FEATURES.battery.decode(f.payload);
  assert.deepStrictEqual([b.left, b.right, b.case], [100, 100, null]);
});

test('real CMF Buds 2a custom EQ reply is decoded by band type', () => {
  const p = Buffer.from('030000c0c000000000000000000000000000010000c0c00000000000000000020000c0400000000000000000', 'hex');
  assert.deepStrictEqual(FEATURES.eqCustom.decode(p), [0, -6, 6]);
});

test('real CMF Buds 2a in-ear reply (unrelated list) is ignored', () => {
  assert.strictEqual(FEATURES.inEar.decode(Buffer.from('08070009000a000c000e000f0015001600', 'hex')), null);
});

test('ring stop is addressed to the requested bud', () => {
  const { ACTIONS } = require('../src/main/nt/features');
  assert.deepStrictEqual(ACTIONS.ring.encode('left', true), [0x02, 1]);
  assert.deepStrictEqual(ACTIONS.ring.encode('left', false), [0x02, 0]);
  assert.deepStrictEqual(ACTIONS.ring.encode('right', false), [0x03, 0]);
});
