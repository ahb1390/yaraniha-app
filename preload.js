// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('offlineApp', {
  retry: () => ipcRenderer.send('retry-online'),
  onRetryResult: (callback) => {
    if (typeof callback !== 'function') return;
    const listener = (_event, result) => callback(result);
    ipcRenderer.on('retry-result', listener);
    return () => ipcRenderer.removeListener('retry-result', listener);
  }
});