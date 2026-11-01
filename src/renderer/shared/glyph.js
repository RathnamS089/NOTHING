// Song glyphs: a dot-matrix mark generated from a track's title + artist.
//
// The same track always produces the same glyph; different tracks differ in
// motif, symmetry, density, tempo and accent dots. Motion is synthesised from
// the seed's tempo, not from the audio: nothing is recorded or analysed.

(() => {
  // FNV-1a: tiny, stable string hash.
  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  // mulberry32: deterministic PRNG from a 32-bit seed.
  function rng(seed) {
    let a = seed;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const MOTIFS = ['mirror', 'bars', 'ripple', 'wave'];

  // Everything about a track's look, derived once from its identity.
  function spec(track) {
    const key = `${(track?.title || '').toLowerCase()}\u0000${(track?.artist || '').toLowerCase()}`;
    const seed = hash(key);
    const r = rng(seed);
    const motif = MOTIFS[seed % MOTIFS.length];
    return {
      seed,
      motif,
      tempo: 72 + Math.floor(r() * 72), // 72–143 "bpm"
      density: 0.35 + r() * 0.35,
      freq: 0.6 + r() * 1.6,
      cx: 0.3 + r() * 0.4,
      cy: 0.3 + r() * 0.4,
      phases: Array.from({ length: 64 }, () => r()),
      bits: Array.from({ length: 64 }, () => r()),
      accents: [Math.floor(r() * 997), Math.floor(r() * 997)],
    };
  }

  const pulse = (x) => {
    const s = (Math.sin(x * Math.PI * 2) + 1) / 2;
    return s * s;
  };

  // Intensity 0..1 for cell (x, y) of a cols×rows grid at beat position `b`.
  function intensity(s, x, y, cols, rows, b) {
    const u = cols > 1 ? x / (cols - 1) : 0.5;
    const v = rows > 1 ? y / (rows - 1) : 0.5;
    switch (s.motif) {
      case 'mirror': {
        // Identicon-style: left half decides, right half mirrors.
        const mx = Math.min(x, cols - 1 - x);
        const i = (mx * 7 + y * 3) % 64;
        if (s.bits[i] > s.density) return 0;
        return 0.35 + 0.65 * pulse(b * 0.5 + s.phases[i]);
      }
      case 'bars': {
        const i = x % 64;
        const env = 0.35 + 0.65 * s.bits[i];
        const h = 0.15 + 0.85 * env * Math.abs(Math.sin(Math.PI * (b * 0.5 * (0.5 + s.phases[i]) + s.phases[(i + 7) % 64])));
        const level = 1 - v; // bottom row = 0
        return level <= h ? 0.45 + 0.55 * (1 - (h - level)) : 0;
      }
      case 'ripple': {
        const d = Math.hypot((u - s.cx) * (cols / rows), v - s.cy);
        return Math.max(0, pulse(b * 0.5 - d * s.freq) * 1.15 - 0.15);
      }
      case 'wave':
      default: {
        const y0 = 0.5 + 0.38 * Math.sin(Math.PI * 2 * (u * s.freq - b * 0.25)) * (0.6 + 0.4 * Math.sin(b * 0.5 + s.phases[0] * 6));
        const dist = Math.abs(v - y0) * rows;
        return Math.max(0, 1 - dist * 0.85);
      }
    }
  }

  class Glyph {
    constructor(canvas, { cols, rows, accent = '#d71921', on = '#ffffff', off = 'rgba(255,255,255,0.09)' } = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.cols = cols;
      this.rows = rows;
      this.colors = { accent, on, off };
      this.spec = null;
      this.status = 'paused';
      this.frame = 0;
      this.last = 0;
      this.t0 = performance.now();
      this.resize();
      this.loop = this.loop.bind(this);
      document.addEventListener('visibilitychange', () => this.kick());
    }

    resize() {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = this.canvas.getBoundingClientRect();
      this.w = width || this.canvas.width;
      this.h = height || this.canvas.height;
      this.canvas.width = Math.round(this.w * dpr);
      this.canvas.height = Math.round(this.h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    set(track, accent) {
      if (accent) this.colors.accent = accent;
      const next = track ? spec(track) : null;
      if (next?.seed !== this.spec?.seed) this.t0 = performance.now();
      this.spec = next;
      this.status = track?.status || 'paused';
      this.kick();
    }

    kick() {
      if (!this.frame && !this.destroyed && !document.hidden) this.frame = requestAnimationFrame(this.loop);
    }

    destroy() {
      this.destroyed = true;
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }

    loop(now) {
      this.frame = 0;
      // 30 fps is plenty for dots and halves the cost of a transparent window.
      if (now - this.last >= 33) {
        this.last = now;
        this.draw(now);
      }
      if (this.spec && this.status !== 'paused' && !this.destroyed && !document.hidden) this.frame = requestAnimationFrame(this.loop);
    }

    draw(now = performance.now()) {
      const { ctx, cols, rows, w, h, spec: s } = this;
      ctx.clearRect(0, 0, w, h);
      const cell = Math.min(w / cols, h / rows);
      const ox = (w - cell * cols) / 2;
      const oy = (h - cell * rows) / 2;
      // "unknown" (e.g. a YouTube tab we can't see the play state of) moves at half speed.
      const speed = this.status === 'playing' ? 1 : this.status === 'unknown' ? 0.5 : 0;
      const beat = s ? ((now - this.t0) / 1000) * (s.tempo / 60) * speed : 0;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          let k = s ? intensity(s, x, y, cols, rows, beat) : 0;
          if (this.status === 'paused') k *= 0.45;
          const idx = y * cols + x;
          const accent = s && k > 0.55 && s.accents.some((a) => a % (cols * rows) === idx);
          const r = cell * (0.17 + 0.17 * k);
          ctx.beginPath();
          ctx.arc(ox + (x + 0.5) * cell, oy + (y + 0.5) * cell, k > 0.04 ? r : cell * 0.14, 0, Math.PI * 2);
          if (k > 0.04) {
            ctx.globalAlpha = 0.3 + 0.7 * k;
            ctx.fillStyle = accent ? this.colors.accent : this.colors.on;
          } else {
            ctx.globalAlpha = 1;
            ctx.fillStyle = this.colors.off;
          }
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  window.NXGlyph = { Glyph, spec, hash };
})();
