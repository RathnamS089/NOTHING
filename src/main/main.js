const path = require('path');
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, session } = require('electron');
const { Detector } = require('./detector');
const { Store } = require('./store');
const { Bridge } = require('./nt/bridge');
const { Controller } = require('./nt/controller');
const { NowPlaying } = require('./media/nowplaying');

const isMac = process.platform === 'darwin';
const RENDERER = path.join(__dirname, '..', 'renderer');
// Renderers only ever see the narrow `nx` bridge from preload.js: no Node, no
// direct IPC, sandboxed, and isolated from the preload's own context.
const SECURE_PREFS = {
  preload: path.join(__dirname, '..', 'preload.js'),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  spellcheck: false,
};
const ISLAND_W = 520;
const ISLAND_H = 320;

const DEMO_DEVICE = {
  name: 'CMF Buds 2a',
  address: '2C:BE:EE:00:00:2A',
  battery: { left: 86, right: 81, case: 64, main: null },
  firmware: '1.0.1.66',
  model: require('./devices').identify('CMF Buds 2a'),
};

let island, appWin, tray, store, detector;
let bridge, controller;
const nowPlaying = new NowPlaying();
let demoTrackTimer = null;
const DEMO_TRACKS = [
  { title: 'Glass Animals Interlude', artist: 'Demo Artist', source: 'Spotify', status: 'playing' },
  { title: 'Midnight Transparency', artist: 'CMF Sessions', source: 'Apple Music', status: 'playing' },
  { title: 'Lo-fi beats to build apps to', artist: '', source: 'YouTube · Chrome', status: 'unknown' },
];
let demo = false;
let switching = null; // address being switched to
let demoTimer = null;

// Linux compositors need this for the island's transparent window.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-transparent-visuals');
  // Wayland (default on Ubuntu and Fedora GNOME) won't let apps place their own
  // windows or keep them on top, so the island runs under XWayland instead.
  // The packaged launcher passes the same flag (build.linux.executableArgs).
  app.commandLine.appendSwitch('ozone-platform', 'x11');
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => openApp());

function state() {
  const device = detector?.current || null;
  return {
    device,
    settings: device ? store.device(device.address) : null,
    prefs: store.prefs(),
    demo,
    live: !!controller?.open,
    bridge: !!bridge?.available,
    paired: demo ? [{ ...DEMO_DEVICE, connected: true }] : detector?.paired || [],
    track: store.prefs().media?.enabled ? publicTrack(nowPlaying.track) : null,
    switching,
  };
}

// What renderers may see of a track: no URLs or cover sources, just text and dot levels.
function publicTrack(t) {
  if (!t) return null;
  const { art, cover, ...rest } = t;
  return store.prefs().media?.covers === false || !cover ? rest : { ...rest, cover };
}

function broadcast() {
  const s = state();
  for (const w of [island, appWin]) if (w && !w.isDestroyed()) w.webContents.send('state', s);
  updateTray();
}

function placeIsland() {
  const { bounds } = screen.getPrimaryDisplay();
  // Sit flush with the top edge so the pill grows out of the notch / menu bar.
  island.setBounds({ x: Math.round(bounds.x + (bounds.width - ISLAND_W) / 2), y: bounds.y, width: ISLAND_W, height: ISLAND_H });
}

function createIsland() {
  island = new BrowserWindow({
    width: ISLAND_W,
    height: ISLAND_H,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    alwaysOnTop: true,
    enableLargerThanScreen: true,
    ...(isMac ? { type: 'panel' } : { type: 'toolbar' }),
    webPreferences: SECURE_PREFS,
  });
  island.setAlwaysOnTop(true, 'screen-saver');
  island.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  island.setIgnoreMouseEvents(true, { forward: true });
  placeIsland();
  island.loadFile(path.join(RENDERER, 'island', 'index.html'));
  screen.on('display-metrics-changed', placeIsland);
  screen.on('display-added', placeIsland);
  screen.on('display-removed', placeIsland);
}

function openApp(section) {
  if (!appWin || appWin.isDestroyed()) {
    appWin = new BrowserWindow({
      width: 440,
      height: 820,
      minWidth: 360,
      minHeight: 560,
      show: false,
      backgroundColor: '#000000',
      title: 'Nothing Island',
      ...(isMac
        ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 } }
        : { frame: false }),
      webPreferences: SECURE_PREFS,
    });
    appWin.loadFile(path.join(RENDERER, 'app', 'index.html'), section ? { hash: section } : undefined);
    appWin.once('ready-to-show', () => appWin.show());
    appWin.on('show', () => isMac && app.dock.show());
    appWin.on('closed', () => {
      appWin = null;
      if (isMac) app.dock.hide();
    });
  } else {
    if (section) appWin.webContents.send('navigate', section);
    appWin.show();
    appWin.focus();
  }
}

// Start or stop reading the player according to the user's preference.
function syncMedia() {
  nowPlaying.covers = store.prefs().media?.covers !== false;
  if (demo) return;
  if (store.prefs().media?.enabled) nowPlaying.start();
  else nowPlaying.stop();
}

function islandEvent(type, device, track) {
  if (!island || !store.prefs().island.enabled) return;
  if (type === 'track') {
    if (island.isVisible()) island.webContents.send('island', { type, device, track });
    return;
  }
  if (type === 'connected') {
    island.showInactive();
    island.webContents.send('island', { type, device });
  } else if (type === 'disconnected') {
    island.webContents.send('island', { type, device });
  }
}

function updateTray() {
  if (!tray) return;
  const d = detector.current;
  const b = d?.battery;
  const level = b ? [b.left, b.right].filter((v) => v != null) : [];
  const batt = level.length ? `${Math.min(...level)}%` : b?.main != null ? `${b.main}%` : '';
  tray.setToolTip(d ? `${d.name}${batt ? ' · ' + batt : ''}` : 'Nothing Island · no buds connected');
  if (isMac) tray.setTitle(batt ? ` ${batt}` : '', { fontType: 'monospacedDigit' });

  const prefs = store.prefs();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: d ? `${d.name} connected` : 'No Nothing buds connected', enabled: false },
    { type: 'separator' },
    { label: 'Open Nothing Island…', click: () => openApp() },
    { label: 'Show island', enabled: !!d, click: () => islandEvent('connected', d) },
    {
      label: 'Switch to',
      enabled: !demo && bridge?.available && detector.paired.length > 1,
      submenu: (detector.paired.length ? detector.paired : [{ name: 'No other Nothing devices', address: '' }]).map((p) => ({
        label: p.name, type: 'radio', checked: !!p.connected, enabled: !!p.address,
        click: () => p.address && !p.connected && ipcMain.emit('tray-switch', null, p.address),
      })),
    },
    {
      label: 'Island enabled', type: 'checkbox', checked: prefs.island.enabled,
      click: (i) => { store.setPrefs({ island: { ...prefs.island, enabled: i.checked } }); if (!i.checked) island.hide(); broadcast(); },
    },
    { type: 'separator' },
    { label: 'Simulate CMF Buds 2a', type: 'checkbox', checked: demo, click: (i) => setDemo(i.checked) },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' },
  ]));
}

function setDemo(on) {
  demo = on;
  clearInterval(demoTimer);
  clearInterval(demoTrackTimer);
  if (on) {
    detector.stop();
    detector.update(structuredClone(DEMO_DEVICE));
    // Slow drain so the battery UI visibly moves.
    demoTimer = setInterval(() => {
      const cur = structuredClone(detector.current);
      cur.battery.left = Math.max(5, cur.battery.left - 1);
      cur.battery.right = Math.max(5, cur.battery.right - 1);
      detector.update(cur);
    }, 30000);
    // Rotate a few fake tracks so the glyphs can be seen without a player.
    if (store.prefs().media?.enabled) {
      let i = 0;
      nowPlaying.stop();
      demoTrackTimer = setInterval(() => nowPlaying.set(DEMO_TRACKS[i++ % DEMO_TRACKS.length]), 12000);
      setTimeout(() => demo && nowPlaying.set(DEMO_TRACKS[i++ % DEMO_TRACKS.length]), 6500);
    }
  } else {
    nowPlaying.set(null);
    syncMedia();
    detector.update(null);
    if (bridge.available) bridge.listDevices();
    else detector.start();
  }
  broadcast();
}

function createTray() {
  const icon = isMac
    ? nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'trayTemplate.png'))
    : nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'tray-win.png'));
  if (isMac) icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.on('click', () => (isMac ? tray.popUpContextMenu() : openApp()));
  if (process.platform === 'linux') tray.setTitle?.('');
  updateTray();
}

ipcMain.handle('state:get', () => state());

// Every IPC payload is untrusted: the renderer shows text from Bluetooth device
// names and could be tricked, so only known keys with valid values get through.
const oneOf = (v, list) => (list.includes(v) ? v : undefined);
const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : undefined);
const bool = (v) => (typeof v === 'boolean' ? v : undefined);
const GESTURE_KEYS = ['double', 'triple', 'hold'];
const GESTURE_VALUES = ['play_pause', 'next', 'prev', 'volume_up', 'volume_down', 'noise_control', 'voice_assistant', 'none'];

function cleanDevicePatch(p) {
  if (!p || typeof p !== 'object') return {};
  const out = {
    anc: oneOf(p.anc, ['anc', 'transparency', 'off']),
    ancLevel: oneOf(p.ancLevel, ['high', 'mid', 'low', 'adaptive', 'light', 'max']),
    eqPreset: oneOf(p.eqPreset, ['balanced', 'bass', 'treble', 'voice', 'rock', 'electronic', 'pop', 'vocals', 'classical', 'custom']),
    eqCustom: Array.isArray(p.eqCustom) && p.eqCustom.length === 3 && p.eqCustom.every((v) => int(v, -6, 6) !== undefined) ? p.eqCustom : undefined,
    bass: p.bass && bool(p.bass.on) !== undefined && int(p.bass.level, 1, 5) !== undefined ? { on: p.bass.on, level: p.bass.level } : undefined,
    lowLag: bool(p.lowLag),
    inEar: bool(p.inEar),
    dual: bool(p.dual),
  };
  if (p.gestures && typeof p.gestures === 'object') {
    const g = {};
    for (const side of ['left', 'right']) {
      const src = p.gestures[side];
      if (!src || typeof src !== 'object') continue;
      g[side] = Object.fromEntries(GESTURE_KEYS.map((k) => [k, oneOf(src[k], GESTURE_VALUES)]).filter(([, v]) => v));
    }
    if (g.left && g.right) out.gestures = g;
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}

function cleanPrefsPatch(p) {
  if (!p || typeof p !== 'object') return {};
  const out = {};
  if (oneOf(p.theme, ['system', 'dark', 'light'])) out.theme = p.theme;
  if (p.island && bool(p.island.enabled) !== undefined) out.island = { ...store.prefs().island, enabled: p.island.enabled };
  if (p.media && typeof p.media === 'object') {
    const media = { ...store.prefs().media };
    if (bool(p.media.enabled) !== undefined) media.enabled = p.media.enabled;
    if (bool(p.media.covers) !== undefined) media.covers = p.media.covers;
    out.media = media;
  }
  return out;
}

ipcMain.handle('device:set', async (_e, rawPatch) => {
  const d = detector.current;
  const patch = cleanDevicePatch(rawPatch);
  if (!d || !Object.keys(patch).length) return state();
  const prev = store.device(d.address);
  const next = store.setDevice(d.address, patch);
  broadcast();
  if (controller.open) {
    const ok = await controller.applyDiff(prev, next);
    if (!ok) console.warn('[control] some settings were not acknowledged by the buds');
  }
  return state();
});

ipcMain.handle('prefs:set', (_e, rawPatch) => {
  store.setPrefs(cleanPrefsPatch(rawPatch));
  syncMedia();
  if (!store.prefs().island.enabled) island.hide();
  broadcast();
  return state();
});

ipcMain.handle('device:ring', (_e, side) => {
  const d = detector.current;
  if (!d || !controller.open) return { ok: false };
  if (side === 'stop') return controller.ring('both', false).then((ok) => ({ ok }));
  if (!['left', 'right', 'both'].includes(side)) return { ok: false };
  return controller.ring(side, true).then((ok) => ({ ok }));
});

// Quick switch: make `address` the only connected Nothing device.
ipcMain.on('tray-switch', (_e, address) => switchTo(address));
ipcMain.handle('device:switch', (_e, address) => switchTo(address));

async function switchTo(address) {
  // Only ever touch paired Nothing devices, never an arbitrary address from the renderer.
  if (!bridge.available || demo || switching || !detector.paired.some((d) => d.address === address)) return { ok: false };
  switching = address;
  broadcast();
  for (const d of detector.paired) if (d.connected && d.address !== address) bridge.disconnectDevice(d.address);
  const ok = await new Promise((resolve) => {
    const t = setTimeout(() => done(false), 20000);
    const done = (v) => { clearTimeout(t); bridge.off('device', onDev); resolve(v); };
    const onDev = (m) => m.address === address && done(!!m.ok);
    bridge.on('device', onDev);
    bridge.connectDevice(address);
  });
  switching = null;
  bridge.listDevices();
  broadcast();
  return { ok };
}

ipcMain.on('app:open', (_e, section) => openApp(typeof section === 'string' && /^[a-z]{1,20}$/.test(section) ? section : undefined));

ipcMain.on('island:interactive', (e, on) => {
  if (e.sender !== island?.webContents) return;
  if (!island) return;
  if (on) island.setIgnoreMouseEvents(false);
  else island.setIgnoreMouseEvents(true, { forward: true });
});

ipcMain.on('island:hidden', () => island?.hide());

ipcMain.on('win', (e, action) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w) return;
  if (action === 'close') w.close();
  if (action === 'minimize') w.minimize();
  if (action === 'maximize') (w.isMaximized() ? w.unmaximize() : w.maximize());
});

// Nothing in this app loads remote content: block navigation, popups and
// every permission (camera, mic, notifications, geolocation...).
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (e) => e.preventDefault());
  contents.on('will-attach-webview', (e) => e.preventDefault());
});

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  if (isMac) app.dock.hide();
  store = new Store();
  detector = new Detector();
  bridge = new Bridge();
  controller = new Controller(bridge);

  detector.on('connected', (d) => {
    islandEvent('connected', d);
    broadcast();
    if (!demo && bridge.available) controller.attach(d).then(broadcast);
  });
  detector.on('disconnected', (d) => {
    islandEvent('disconnected', d);
    if (controller.device?.address === d.address) controller.detach();
    broadcast();
  });
  detector.on('updated', broadcast);
  detector.on('paired', broadcast);

  // The buds are the source of truth: fold what they report into the store and device.
  controller.on('live', (live) => {
    const d = detector.current;
    if (!d || controller.device?.address !== d.address) return;
    const { battery, firmware, ...settings } = live;
    const patch = {};
    if (settings.anc) Object.assign(patch, settings.anc);
    for (const k of ['eqPreset', 'eqCustom', 'bass', 'lowLag', 'inEar']) if (settings[k] != null) patch[k] = settings[k];
    if (Object.keys(patch).length) store.setDevice(d.address, patch);
    detector.patch({ ...(battery ? { battery } : {}), ...(firmware ? { firmware } : {}) });
    broadcast();
  });
  controller.on('status', broadcast);

  nowPlaying.on('track', (track, { changed }) => {
    broadcast();
    if (changed && track && detector.current && store.prefs().media?.enabled) islandEvent('track', detector.current, publicTrack(track));
  });
  syncMedia();
  controller.on('log', (m) => process.env.NOTHING_DEBUG && console.log('[control]', m));

  bridge.on('devices', (list) => !demo && detector.fromBridgeList(list));
  bridge.on('exit', ({ code, signal }) => {
    console.warn(`[bridge] helper exited (${signal || code}); falling back to polling`);
    if (!demo && !bridge.available) detector.start();
  });

  createIsland();
  createTray();

  if (process.env.NOTHING_DEMO) {
    island.webContents.once('did-finish-load', () => setTimeout(() => setDemo(true), 800));
  } else if (!bridge.start()) {
    detector.start(); // no native helper for this OS/build: poll the OS instead
  }
  if (process.env.NOTHING_DEMO) bridge.start();
});

// Never leave a bud ringing after the app goes away.
app.on('before-quit', () => {
  nowPlaying.stop();
  if (controller?.open) controller.ring('both', false);
  setTimeout(() => bridge?.stop(), 300);
});

// Menu-bar utility: closing the companion window must not quit.
app.on('window-all-closed', (e) => e.preventDefault());
