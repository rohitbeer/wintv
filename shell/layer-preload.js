'use strict';
// The system layer's only bridge: what it may show, the keys it is sent, the
// household's settings (text size, sounds…), and three calls back (type,
// press a key, do one of main.js's LAYER_ACTIONS).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wintvLayer', {
  onShow: (cb) => ipcRenderer.on('show', (_e, s) => cb(s)),
  onHide: (cb) => ipcRenderer.on('hide', (_e, name) => cb(name)),
  onKey: (cb) => ipcRenderer.on('key', (_e, k) => cb(k)),
  onPrefs: (cb) => ipcRenderer.on('prefs', (_e, p) => cb(p)),
  onClick: (cb) => ipcRenderer.on('click', () => cb()),
  pointer: (on) => ipcRenderer.send('layer:pointer', on === true),
  close: (name) => ipcRenderer.send('layer:close', name),
  type: (text) => ipcRenderer.invoke('layer:type', text),
  key: (name) => ipcRenderer.invoke('layer:key', name),
  action: (name, arg) => ipcRenderer.invoke('layer:action', name, arg),
});
