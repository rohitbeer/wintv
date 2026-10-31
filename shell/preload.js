'use strict';
// The home screen's only bridge to the machine: sixteen calls, six events.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wintv', {
  getState: () => ipcRenderer.invoke('wintv:state'),
  launch: (id) => ipcRenderer.invoke('wintv:launch', id),
  quit: (id) => ipcRenderer.invoke('wintv:quit', id),
  power: (action) => ipcRenderer.invoke('wintv:power', action),
  setProfile: (id) => ipcRenderer.invoke('wintv:profile', id),
  system: (op, args) => ipcRenderer.invoke('wintv:system', op, args),
  updates: (action, arg) => ipcRenderer.invoke('wintv:updates', action, arg),
  setPref: (key, value) => ipcRenderer.invoke('wintv:pref', key, value),
  weather: () => ipcRenderer.invoke('wintv:weather'),
  places: (name) => ipcRenderer.invoke('wintv:places', name),
  keyboard: (on) => ipcRenderer.invoke('wintv:keyboard', on),
  apps: () => ipcRenderer.invoke('wintv:apps'),
  device: (kind) => ipcRenderer.invoke('wintv:device', kind),
  pointer: (on) => ipcRenderer.invoke('wintv:pointer', on),
  admin: (op, args) => ipcRenderer.invoke('wintv:admin', op, args),
  files: (op, args) => ipcRenderer.invoke('wintv:files', op, args),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onHome: (cb) => ipcRenderer.on('home', () => cb()),
  onLock: (cb) => ipcRenderer.on('lock', () => cb()),
  onPicker: (cb) => ipcRenderer.on('picker', () => cb()),
  onPrefs: (cb) => ipcRenderer.on('prefs', (_e, p) => cb(p)),
  onDevice: (cb) => ipcRenderer.on('device', (_e, kind) => cb(kind)),
});
