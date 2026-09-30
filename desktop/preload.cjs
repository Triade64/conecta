'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('conectaDesktop', Object.freeze({
  requestAttention: conversationId => ipcRenderer.invoke('conecta:attention', conversationId),
  notify: payload => ipcRenderer.invoke('conecta:notify', payload),
  onNotificationClick: callback => {
    if (typeof callback !== 'function') return;
    const listener = (_event, tag) => { if (typeof tag === 'string') callback(tag); };
    ipcRenderer.on('conecta:notification-click', listener);
    return () => ipcRenderer.removeListener('conecta:notification-click', listener);
  }
}));
