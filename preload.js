// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('offlineApp', {
  retry: () => ipcRenderer.send('retry-online')
});