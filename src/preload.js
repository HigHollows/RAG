'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('app', {
  call: (method, ...args) => ipcRenderer.invoke('api', method, args),
  on: (cb) => { const h = (_e, type, payload) => cb(type, payload); ipcRenderer.on('event', h); return () => ipcRenderer.removeListener('event', h); },
  pickFolder: () => ipcRenderer.invoke('pickFolder'),
  saveFile: (name, content, b64) => ipcRenderer.invoke('saveFile', name, content, !!b64),
  openFile: (filters) => ipcRenderer.invoke('openFile', filters),
  openExternal: (url) => ipcRenderer.invoke('openExternal', url),
  showItem: (p) => ipcRenderer.invoke('showItem', p),
  info: () => ipcRenderer.invoke('appInfo'),
});
