// Earbud control channel.
//
// Nothing / CMF buds take ANC, EQ and gesture commands over a vendor RFCOMM
// (Serial Port Profile) channel, not over anything the OS exposes. Talking to
// it needs a native bridge (IOBluetooth on macOS, Windows.Devices.Bluetooth.Rfcomm
// on Windows). Until that bridge exists, `send` only records the intended state
// so the UI and settings stay consistent; swap this module for the real link.

class Protocol {
  constructor() {
    this.connected = false; // true once a real RFCOMM link is open
  }

  async apply(address, settings) {
    if (process.env.NOTHING_DEBUG) console.log('[protocol] apply', address, JSON.stringify(settings));
    return { ok: true, live: this.connected };
  }

  async ring(address, side) {
    if (process.env.NOTHING_DEBUG) console.log('[protocol] ring', address, side);
    return { ok: true, live: this.connected };
  }
}

module.exports = { Protocol };
