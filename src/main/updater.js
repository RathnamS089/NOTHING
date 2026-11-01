// Keeps release builds current from this project's GitHub Releases.
//
// Windows and Linux: electron-updater downloads the new version in the
// background and installs it when the app quits (or on "Restart to update").
// macOS: the system only lets an app replace itself when it is Developer ID
// signed; ours is ad-hoc signed, so on Mac this only finds the newer release
// and offers its download page.
//
// The only requests go to github.com for the release list and files: no
// identifiers, nothing about the buds or what's playing.

const { EventEmitter } = require('events');
const { app, net } = require('electron');

const REPO = 'RathnamS089/NOTHING';
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases?per_page=10`;
const RELEASE_PAGE = new RegExp(`^https://github\\.com/${REPO}/releases/`);
const FIRST_CHECK_MS = 15 * 1000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

// Semver order, including pre-releases: 0.1.0-alpha.5 < 0.1.0-alpha.10 < 0.1.0.
function compareVersions(a, b) {
  const parse = (v) => {
    const [main, pre] = String(v).replace(/^v/, '').split('-', 2);
    return { nums: main.split('.').map((n) => parseInt(n, 10) || 0), pre: pre ? pre.split('.') : [] };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if ((x.nums[i] || 0) !== (y.nums[i] || 0)) return (x.nums[i] || 0) - (y.nums[i] || 0);
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined || q === undefined) return p === undefined ? -1 : 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) - Number(q);
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

class Updater extends EventEmitter {
  constructor() {
    super();
    // status: idle | checking | none | available | downloading | ready | error
    this.state = { status: 'idle', version: null, url: null, manual: process.platform === 'darwin' };
    this.timer = null;
    this.auto = null;
  }

  // Updates only make sense for installed builds; `npm start` runs from git.
  get supported() {
    return app.isPackaged;
  }

  setEnabled(on) {
    clearTimeout(this.first);
    clearInterval(this.timer);
    this.first = this.timer = null;
    if (!on || !this.supported) return;
    this.first = setTimeout(() => this.check(), FIRST_CHECK_MS);
    this.timer = setInterval(() => this.check(), CHECK_EVERY_MS);
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('state', this.state);
  }

  async check() {
    if (!this.supported || ['checking', 'downloading', 'ready'].includes(this.state.status)) return;
    this.set({ status: 'checking' });
    try {
      if (this.state.manual) await this.checkRelease();
      else await this.updater().checkForUpdates();
    } catch (e) {
      console.warn('[update] check failed:', e?.message || e);
      this.set({ status: 'error' });
    }
  }

  // macOS: compare against the newest published release on GitHub.
  async checkRelease() {
    const res = await net.fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const releases = (await res.json()).filter((r) => !r.draft && r.tag_name);
    const newest = releases.sort((a, b) => compareVersions(b.tag_name, a.tag_name))[0];
    if (newest && compareVersions(newest.tag_name, app.getVersion()) > 0 && RELEASE_PAGE.test(newest.html_url)) {
      this.set({ status: 'available', version: newest.tag_name.replace(/^v/, ''), url: newest.html_url });
    } else {
      this.set({ status: 'none' });
    }
  }

  // Windows / Linux: electron-updater, loaded on first use.
  updater() {
    if (this.auto) return this.auto;
    const { autoUpdater } = require('electron-updater');
    autoUpdater.allowPrerelease = true; // every release is a pre-release for now
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = null;
    autoUpdater.on('update-available', (i) => this.set({ status: 'downloading', version: i.version }));
    autoUpdater.on('update-not-available', () => this.set({ status: 'none' }));
    autoUpdater.on('update-downloaded', (i) => this.set({ status: 'ready', version: i.version }));
    autoUpdater.on('error', (e) => {
      console.warn('[update] failed:', e?.message || e);
      this.set({ status: 'error' });
    });
    this.auto = autoUpdater;
    return autoUpdater;
  }

  // "Restart to update" (Windows / Linux) once the download is ready.
  install() {
    if (this.state.status === 'ready' && this.auto) this.auto.quitAndInstall();
  }
}

module.exports = { Updater, compareVersions };
