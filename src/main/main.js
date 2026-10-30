const path = require('path');
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage } = require('electron');
const { Detector } = require('./detector');
const { Store } = require('./store');
const { Protocol } = require('./protocol');

const isMac = process.platform === 'darwin';
const RENDERER = path.join(__dirname, '..', 'renderer');
const ISLAND_W = 520;
const ISLAND_H = 260;

const DEMO_DEVICE = {
  name: 'CMF Buds 2a',
  address: '2C:BE:EE:00:00:2A',
  battery: { left: 86, right: 81, case: 64, main: null },
  firmware: '1.0.1.66',
  model: require('./devices').identify('CMF Buds 2a'),
};

let island, appWin, tray, store, detector;
const protocol = new Protocol();
let demo = false;
let demoTimer = null;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => openApp());

function state() {
  const device = detector?.current || null;
  return {
    device,
    settings: device ? store.device(device.address) : null,
    prefs: store.prefs(),
    demo,
    live: protocol.connected,
  };
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
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js') },
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
      webPreferences: { preload: path.join(__dirname, '..', 'preload.js') },
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

function islandEvent(type, device) {
  if (!island || !store.prefs().island.enabled) return;
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
  } else {
    detector.update(null);
    detector.start();
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
  updateTray();
}

ipcMain.handle('state:get', () => state());

ipcMain.handle('device:set', async (_e, patch) => {
  const d = detector.current;
  if (!d) return state();
  const settings = store.setDevice(d.address, patch);
  await protocol.apply(d.address, settings);
  broadcast();
  return state();
});

ipcMain.handle('prefs:set', (_e, patch) => {
  store.setPrefs(patch);
  if (!store.prefs().island.enabled) island.hide();
  broadcast();
  return state();
});

ipcMain.handle('device:ring', (_e, side) => {
  const d = detector.current;
  return d ? protocol.ring(d.address, side) : { ok: false };
});

ipcMain.on('app:open', (_e, section) => openApp(section));

ipcMain.on('island:interactive', (_e, on) => {
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

app.whenReady().then(() => {
  if (isMac) app.dock.hide();
  store = new Store();
  detector = new Detector();
  detector.on('connected', (d) => { islandEvent('connected', d); broadcast(); });
  detector.on('disconnected', (d) => { islandEvent('disconnected', d); broadcast(); });
  detector.on('updated', broadcast);

  createIsland();
  createTray();

  if (process.env.NOTHING_DEMO) {
    island.webContents.once('did-finish-load', () => setTimeout(() => setDemo(true), 800));
  } else {
    detector.start();
  }
});

// Menu-bar utility: closing the companion window must not quit.
app.on('window-all-closed', (e) => e.preventDefault());
