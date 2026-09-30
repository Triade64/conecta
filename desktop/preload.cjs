'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('conectaDesktop', Object.freeze({
  requestAttention: conversationId => ipcRenderer.invoke('conecta:attention', conversationId)
}));
