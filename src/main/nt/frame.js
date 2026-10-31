// Wire framing for the Nothing control channel.
//
//   off  size  field
//   0    1     start-of-frame 0x55
//   1    2     flags (LE). 0x0160 on requests; bit 0x20 of the low byte = CRC present
//   3    1     command id
//   4    1     kind: what the frame is doing with that command (see KIND)
//   5    2     payload length (LE)
//   7    1     sequence number, echoed back by the buds in their reply
//   8    n     payload
//   8+n  2     CRC-16/ARC over bytes 0..8+n-1 (LE), only when the CRC flag is set

const SOF = 0x55;
const REQUEST_FLAGS = 0x0160;
const HEADER = 8;

const KIND = {
  GET: 0xc0, // read a value
  SET: 0xf0, // write a value
  REPLY: 0x40, // answer to GET
  ACK: 0x70, // answer to SET
  PUSH: 0xe0, // unsolicited event from the buds (battery change, ANC from a pinch...)
};

// CRC-16/ARC: reflected poly 0x8005 (0xA001), init 0xFFFF as the buds use it.
function crc16(buf, end = buf.length) {
  let crc = 0xffff;
  for (let i = 0; i < end; i++) {
    crc ^= buf[i];
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc;
}

function encode(command, kind, payload = [], seq = 1) {
  const body = Buffer.from(payload);
  const out = Buffer.alloc(HEADER + body.length + 2);
  out[0] = SOF;
  out.writeUInt16LE(REQUEST_FLAGS, 1);
  out[3] = command;
  out[4] = kind;
  out.writeUInt16LE(body.length, 5);
  out[7] = seq & 0xff;
  body.copy(out, HEADER);
  out.writeUInt16LE(crc16(out, HEADER + body.length), HEADER + body.length);
  return out;
}

// Incremental decoder: RFCOMM delivers arbitrary chunks, frames can span or share them.
class Decoder {
  constructor() {
    this.buf = Buffer.alloc(0);
  }

  push(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    const frames = [];
    for (;;) {
      const start = this.buf.indexOf(SOF);
      if (start < 0) { this.buf = Buffer.alloc(0); break; }
      if (start > 0) this.buf = this.buf.subarray(start);
      if (this.buf.length < HEADER) break;

      const hasCrc = (this.buf[1] & 0x20) !== 0;
      const len = this.buf.readUInt16LE(5);
      const total = HEADER + len + (hasCrc ? 2 : 0);
      // A real header has flags byte 2 == 0x01; anything else is a stray 0x55 inside data.
      if (this.buf[2] !== 0x01 || len > 1024) { this.buf = this.buf.subarray(1); continue; }
      if (this.buf.length < total) break;

      const raw = this.buf.subarray(0, total);
      if (hasCrc && raw.readUInt16LE(total - 2) !== crc16(raw, total - 2)) {
        this.buf = this.buf.subarray(1);
        continue;
      }
      frames.push({ command: raw[3], kind: raw[4], seq: raw[7], payload: Buffer.from(raw.subarray(HEADER, HEADER + len)) });
      this.buf = this.buf.subarray(total);
    }
    return frames;
  }
}

module.exports = { KIND, crc16, encode, Decoder };
