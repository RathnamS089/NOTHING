// What's playing right now, per OS. Emits 'track' with
//   { title, artist, source, status: 'playing' | 'paused' | 'unknown' } or null.
//
// Privacy: titles are only held in memory to draw the glyph. They are never
// written to disk, logged or sent anywhere, and the feature can be switched off.
//
// macOS   Apple locked the system Now Playing API to Apple processes in 15.4, so
//         we ask the players directly with AppleScript: Music, Spotify, and the
//         active YouTube tab in Safari / Chromium browsers. macOS asks the user
//         once per app before allowing this ("Nothing Island wants to control…").
// Windows The system media session (GlobalSystemMediaTransportControls), which
//         browsers also report to, so YouTube works in Edge/Chrome.
// Linux   MPRIS via `playerctl`, which browsers also implement.

const { execFile, spawn } = require('child_process');
const { EventEmitter } = require('events');

const MAC_POLL_MS = 2500;
const SEP = '\u001f'; // unit separator: can't appear in a title

const MUSIC_URLS = ['youtube.com/watch', 'open.spotify.com', 'music.apple.com'];

function browserScript(app, activeTab, titleProp) {
  const isMusic = MUSIC_URLS.map((u) => `(u contains "${u}")`).join(' or ');
  return `on isMusic(u)
    return ${isMusic}
  end isMusic
  tell application "${app}"
    if (count of windows) = 0 then return ""
    set t to ${activeTab} of front window
    if my isMusic(URL of t) then return (URL of t) & "${SEP}" & (${titleProp} of t)
    repeat with w in windows
      repeat with t in tabs of w
        if my isMusic(URL of t) then return (URL of t) & "${SEP}" & (${titleProp} of t)
      end repeat
    end repeat
  end tell`;
}

const MAC_PLAYERS = [
  {
    process: 'Music',
    source: 'Apple Music',
    script: `tell application "Music"
      if player state is playing or player state is paused then
        return (player state as text) & "${SEP}" & (name of current track) & "${SEP}" & (artist of current track)
      end if
    end tell`,
  },
  {
    process: 'Spotify',
    source: 'Spotify',
    script: `tell application "Spotify"
      if player state is playing or player state is paused then
        return (player state as text) & "${SEP}" & (name of current track) & "${SEP}" & (artist of current track)
      end if
    end tell`,
  },
  // Browsers: the active tab if it is a music page, otherwise the first music tab
  // anywhere (music usually plays in the background). URLs are matched inside
  // the AppleScript, so titles of other tabs never leave the browser.
  ...['Google Chrome', 'Arc', 'Brave Browser', 'Microsoft Edge'].map((app) => ({
    process: app,
    browser: app.replace(' Browser', '').replace('Google ', '').replace('Microsoft ', ''),
    script: browserScript(app, 'active tab', 'title'),
  })),
  { process: 'Safari', browser: 'Safari', script: browserScript('Safari', 'current tab', 'name') },
];

function run(cmd, args, timeout = 4000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

// Turn a music tab's URL + title into a track. Web players only expose the page
// title, so play state is unknown except where the title itself reveals it.
function parseBrowserTab(url, title, browser) {
  title = (title || '').trim();
  if (/open\.spotify\.com/.test(url)) {
    // Spotify titles the tab "Song • Artist" while playing, "Spotify – Web Player…" otherwise.
    const m = title.match(/^(.*?)\s+•\s+(.*)$/);
    if (m) return { title: m[1], artist: m[2], status: 'playing', source: `Spotify · ${browser}` };
    // Otherwise it's the page's own title, e.g.
    //   "Listen to death bed - Single by Powfu, beabadoobee | Spotify"
    //   "Song Name - song and lyrics by Artist | Spotify"
    const page = title.match(/^(?:Listen to\s+)?(.*?)(?:\s+-\s+(?:Single|EP|Album|song and lyrics|song))?\s+by\s+(.*?)\s*\|\s*Spotify$/i);
    return page ? { title: page[1], artist: page[2], status: 'unknown', source: `Spotify · ${browser}` } : null;
  }
  if (/music\.apple\.com/.test(url)) {
    const t = title.replace(/\s*[-–]\s*Apple Music.*$/i, '').replace(/^Apple Music.*$/i, '');
    const m = t.match(/^(.*?)\s+by\s+(.*)$/i);
    return t ? { title: m ? m[1] : t, artist: m ? m[2] : '', status: 'unknown', source: `Apple Music · ${browser}` } : null;
  }
  if (/youtube\.com\/watch/.test(url)) {
    const music = /music\.youtube\.com/.test(url);
    return { title, artist: '', status: 'unknown', source: `${music ? 'YouTube Music' : 'YouTube'} · ${browser}` };
  }
  return null;
}

// "Song name - YouTube" / "(12) Song name - YouTube" -> "Song name"
function cleanYouTubeTitle(t) {
  return t.replace(/^\(\d+\)\s*/, '').replace(/\s*[-–]\s*YouTube( Music)?$/i, '').trim();
}

function normalise(raw) {
  if (!raw || !raw.title) return null;
  // Spotify sometimes answers with raw AppleScript codes: kPSP playing, kPSp paused, kPSS stopped.
  const st = String(raw.status || '');
  const status = /play/i.test(st) || /kPSP/.test(st) ? 'playing'
    : /pause|stop/i.test(st) || /kPS[pS]/.test(st) ? 'paused'
    : 'unknown';
  const title = /youtube/i.test(raw.source || '') ? cleanYouTubeTitle(raw.title) : raw.title.trim();
  return title ? { title, artist: (raw.artist || '').trim(), source: raw.source || '', status } : null;
}

class NowPlaying extends EventEmitter {
  constructor() {
    super();
    this.track = null;
    this.timer = null;
    this.proc = null;
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    if (process.platform === 'darwin') {
      this.pollMac();
      this.timer = setInterval(() => this.pollMac(), MAC_POLL_MS);
    } else if (process.platform === 'win32') {
      this.followWindows();
    } else if (process.platform === 'linux') {
      this.followLinux();
    }
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
    this.proc?.kill();
    this.proc = null;
    this.set(null);
  }

  set(track) {
    const next = normalise(track);
    if (JSON.stringify(next) === JSON.stringify(this.track)) return;
    const changed = next?.title !== this.track?.title || next?.artist !== this.track?.artist;
    this.track = next;
    this.emit('track', next, { changed });
  }

  // ---- macOS ---------------------------------------------------------------

  async pollMac() {
    if (this.busy) return;
    this.busy = true;
    try {
      // Only script apps that are already running: never launch a player, and
      // never compile a script against an app that isn't installed.
      const ps = await run('ps', ['-axco', 'command']);
      const running = new Set(ps.split('\n').map((s) => s.trim()));
      let best = null;
      for (const p of MAC_PLAYERS) {
        if (!running.has(p.process)) continue;
        const out = (await run('osascript', ['-e', p.script])).trim();
        if (!out) continue;
        let t;
        if (p.browser) {
          const [url, title] = out.split(SEP);
          t = parseBrowserTab(url, title, p.browser);
          if (process.env.NOTHING_DEBUG) console.log('[media]', p.browser, t ? 'matched' : 'no track');
          if (!t) continue;
        } else {
          const [status, title, artist] = out.split(SEP);
          t = { status, title, artist, source: p.source };
        }
        if (/playing/i.test(t.status) || /kPSP/.test(t.status)) { best = t; break; } // a playing player wins
        best ||= t;
      }
      if (this.running) this.set(best);
    } finally {
      this.busy = false;
    }
  }

  // ---- Windows -------------------------------------------------------------

  followWindows() {
    const script = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, [Type]$t) { $asTask.MakeGenericMethod($t).Invoke($null, @($op)).GetAwaiter().GetResult() }
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$last = ''
while ($true) {
  $line = '{}'
  $s = $mgr.GetCurrentSession()
  if ($s) {
    $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    $line = [pscustomobject]@{ title = $p.Title; artist = $p.Artist; status = [string]$s.GetPlaybackInfo().PlaybackStatus; source = $s.SourceAppUserModelId } | ConvertTo-Json -Compress
  }
  if ($line -ne $last) { [Console]::Out.WriteLine($line); [Console]::Out.Flush(); $last = $line }
  Start-Sleep -Milliseconds 1000
}`;
    this.follow('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], (line) => {
      const j = JSON.parse(line);
      const app = (j.source || '').toLowerCase();
      const source = /chrome|msedge|firefox|brave|opera/.test(app) && /youtube/i.test(j.title || '') ? 'YouTube' : j.source || '';
      return j.title ? { ...j, source } : null;
    });
  }

  // ---- Linux ---------------------------------------------------------------

  followLinux() {
    const fmt = `{{status}}${SEP}{{title}}${SEP}{{artist}}${SEP}{{playerName}}${SEP}{{xesam:url}}`;
    this.follow('playerctl', ['--follow', 'metadata', '--format', fmt], (line) => {
      const [status, title, artist, player, url] = line.split(SEP);
      const source = /youtube\.com/.test(url || '') ? `YouTube · ${player}` : player;
      return title ? { status, title, artist, source } : null;
    });
  }

  follow(cmd, args, parse) {
    const proc = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    this.proc = proc;
    let buf = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        try { this.set(line ? parse(line) : null); } catch { /* malformed line */ }
      }
    });
    proc.on('error', () => {}); // player tool missing: feature just stays quiet
    proc.on('exit', () => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.set(null);
      // playerctl exits when no player is around on some versions; try again later.
      if (this.running) setTimeout(() => this.running && !this.proc && this.follow(cmd, args, parse), 10000);
    });
  }
}

module.exports = { NowPlaying, cleanYouTubeTitle, normalise, parseBrowserTab };
