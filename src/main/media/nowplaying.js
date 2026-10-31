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
  // Browsers: only the active tab, and only when it is a YouTube watch page.
  ...['Google Chrome', 'Arc', 'Brave Browser', 'Microsoft Edge'].map((app) => ({
    process: app,
    source: `YouTube · ${app.replace(' Browser', '')}`,
    script: `tell application "${app}"
      if (count of windows) > 0 then
        set t to active tab of front window
        if (URL of t) contains "youtube.com/watch" then return "unknown${SEP}" & (title of t) & "${SEP}"
      end if
    end tell`,
  })),
  {
    process: 'Safari',
    source: 'YouTube · Safari',
    script: `tell application "Safari"
      if (count of windows) > 0 then
        set t to current tab of front window
        if (URL of t) contains "youtube.com/watch" then return "unknown${SEP}" & (name of t) & "${SEP}"
      end if
    end tell`,
  },
];

function run(cmd, args, timeout = 4000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
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
        const [status, title, artist] = out.split(SEP);
        const t = { status, title, artist, source: p.source };
        if (/playing/i.test(status)) { best = t; break; } // a playing player wins
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

module.exports = { NowPlaying, cleanYouTubeTitle, normalise };
