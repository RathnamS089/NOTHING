// Album covers, reduced to a grid of dot brightness levels.
//
// Privacy rules:
//  - A cover is only ever requested from the service already playing the
//    track (Apple Music locally; Spotify / YouTube for their own content).
//    No third-party lookups.
//  - Only a fixed allowlist of hosts can be contacted, without cookies or
//    redirects, with a size cap and timeout.
//  - The image is decoded here in the main process and reduced to GRID×GRID
//    numbers. Renderers never receive the image or its URL, and nothing is
//    written to disk.

const { execFile } = require('child_process');
const fs = require('fs');
const { nativeImage } = require('electron');

const GRID = 24;
const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 5000;
const CACHE_SIZE = 30;

// host -> allowed path prefix
const ALLOWED = {
  'i.scdn.co': '/image/', // Spotify cover art
  'image-cdn-ak.spotifycdn.com': '/image/', // Spotify cover art (current CDN)
  'image-cdn-fa.spotifycdn.com': '/image/',
  'i.ytimg.com': '/vi/', // YouTube thumbnails
  'open.spotify.com': '/oembed', // Spotify's embed metadata (gives the cover URL)
  'lh3.googleusercontent.com': '/', // YouTube Music art reported by Linux MPRIS
};

const cache = new Map();

function allowed(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ALLOWED[u.hostname] && u.pathname.startsWith(ALLOWED[u.hostname]);
  } catch {
    return false;
  }
}

async function fetchBytes(url) {
  if (!allowed(url)) return null;
  const res = await fetch(url, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok || Number(res.headers.get('content-length') || 0) > MAX_BYTES) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length <= MAX_BYTES ? buf : null;
}

// Apple Music hands the artwork over directly; no network involved.
function appleMusicArtwork() {
  const script = `tell application "Music"
    try
      return raw data of artwork 1 of current track
    end try
  end tell`;
  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], { timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (err, out) => {
      const hex = !err && String(out).match(/«data \w{4}([0-9A-Fa-f]+)»/)?.[1];
      resolve(hex ? Buffer.from(hex, 'hex') : null);
    });
  });
}

async function resolveBytes(art) {
  switch (art?.kind) {
    case 'applemusic':
      return appleMusicArtwork();
    case 'url':
      return fetchBytes(art.url);
    case 'youtube':
      return /^[\w-]{11}$/.test(art.id) ? fetchBytes(`https://i.ytimg.com/vi/${art.id}/mqdefault.jpg`) : null;
    case 'spotify-page': {
      // The web player's page URL -> Spotify's own oEmbed -> its cover image.
      const page = new URL(art.url);
      if (page.hostname !== 'open.spotify.com') return null;
      const meta = await fetchBytes(`https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com${page.pathname}`)}`);
      const thumb = meta && JSON.parse(meta.toString('utf8')).thumbnail_url;
      return thumb ? fetchBytes(thumb) : null;
    }
    case 'file': {
      // Linux players (e.g. Firefox) cache art locally. Decoded as an image only.
      const path = decodeURIComponent(new URL(art.url).pathname);
      const st = await fs.promises.stat(path).catch(() => null);
      return st?.isFile() && st.size <= MAX_BYTES ? fs.promises.readFile(path) : null;
    }
    default:
      return null;
  }
}

// Centre-crop to a square, shrink to GRID×GRID, and turn each pixel into a
// 0..1 level with the contrast stretched so dark covers still read.
function toLevels(bytes) {
  let img = nativeImage.createFromBuffer(bytes);
  if (img.isEmpty()) return null;
  const { width, height } = img.getSize();
  const side = Math.min(width, height);
  img = img.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side });
  const px = img.resize({ width: GRID, height: GRID, quality: 'best' }).toBitmap(); // BGRA
  const lum = [];
  for (let i = 0; i < GRID * GRID; i++) {
    const b = px[i * 4], g = px[i * 4 + 1], r = px[i * 4 + 2];
    lum.push((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255);
  }
  const sorted = [...lum].sort((a, z) => a - z);
  const lo = sorted[Math.floor(sorted.length * 0.05)];
  const hi = sorted[Math.floor(sorted.length * 0.95)];
  const span = Math.max(0.08, hi - lo);
  return lum.map((v) => Math.round(Math.min(1, Math.max(0, (v - lo) / span)) ** 0.9 * 100) / 100);
}

async function coverFor(key, art) {
  if (!art) return null;
  if (cache.has(key)) return cache.get(key);
  let cover = null;
  try {
    const bytes = await resolveBytes(art);
    const levels = bytes && toLevels(bytes);
    cover = levels ? { grid: GRID, levels } : null;
  } catch {
    cover = null; // network/parse failure: the generated glyph is used instead
  }
  cache.set(key, cover);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
  return cover;
}

module.exports = { coverFor, allowed, GRID };
