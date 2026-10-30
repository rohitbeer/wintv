'use strict';
// The home screen's only bridge to the machine: six calls, four events.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wintv', {
  getState: () => ipcRenderer.invoke('wintv:state'),
  launch: (id) => ipcRenderer.invoke('wintv:launch', id),
  quit: (id) => ipcRenderer.invoke('wintv:quit', id),
  power: (action) => ipcRenderer.invoke('wintv:power', action),
  setProfile: (id) => ipcRenderer.invoke('wintv:profile', id),
  system: (op, args) => ipcRenderer.invoke('wintv:system', op, args),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onHome: (cb) => ipcRenderer.on('home', () => cb()),
  onLock: (cb) => ipcRenderer.on('lock', () => cb()),
  onPicker: (cb) => ipcRenderer.on('picker', () => cb()),
});
