const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nx', {
  platform: process.platform,
  getState: () => ipcRenderer.invoke('state:get'),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onIsland: (cb) => ipcRenderer.on('island', (_e, ev) => cb(ev)),
  setDevice: (patch) => ipcRenderer.invoke('device:set', patch),
  setPrefs: (patch) => ipcRenderer.invoke('prefs:set', patch),
  ring: (side) => ipcRenderer.invoke('device:ring', side),
  openApp: (section) => ipcRenderer.send('app:open', section),
  onNavigate: (cb) => ipcRenderer.on('navigate', (_e, section) => cb(section)),
  islandInteractive: (on) => ipcRenderer.send('island:interactive', on),
  islandHidden: () => ipcRenderer.send('island:hidden'),
  win: (action) => ipcRenderer.send('win', action),
});
