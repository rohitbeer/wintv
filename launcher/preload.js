'use strict';
// The only bridge between the UI and the machine: five calls, three events.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wintv', {
  getState: () => ipcRenderer.invoke('wintv:state'),
  launch: (id) => ipcRenderer.invoke('wintv:launch', id),
  quit: (id) => ipcRenderer.invoke('wintv:quit', id),
  power: (action) => ipcRenderer.invoke('wintv:power', action),
  setProfile: (id) => ipcRenderer.invoke('wintv:profile', id),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onHome: (cb) => ipcRenderer.on('home', () => cb()),
  onPicker: (cb) => ipcRenderer.on('picker', () => cb()),
});
