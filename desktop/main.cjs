'use strict';
const { app, BrowserWindow, Menu, Tray, ipcMain, shell, dialog, Notification } = require('electron');
const path = require('node:path');
const { SITE_URL, trustedUrl, validSender, validAttentionSender, bringForward } = require('./attention.cjs');
const { notificationOptions, showNativeNotification } = require('./notifications.cjs');
const activeNotifications = new Map();
let mainWindow, tray, quitting = false, lastAttention = 0;
app.setAppUserModelId('br.com.triade.conecta');
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => bringForward(mainWindow));
  app.on('before-quit', () => { quitting = true; });
  app.whenReady().then(createWindow).catch(error => {
    dialog.showErrorBox('Conecta', error.message || 'Não foi possível abrir o Conecta.');
    app.quit();
  });
}
function openExternal(url) {
  try { const parsed = new URL(url); if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) shell.openExternal(parsed.href).catch(() => {}); }
  catch { /* Unsupported links stay blocked. */ }
}
async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240, height: 850, minWidth: 700, minHeight: 550, show: false,
    title: 'Conecta — Tríade', backgroundColor: '#f4f5f2', icon: path.join(__dirname, 'assets/icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false,
      contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: false }
  });
  const contents = mainWindow.webContents;
  contents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(webContents === contents && permission === 'notifications' && trustedUrl(details.requestingUrl || webContents.getURL()));
  });
  contents.session.setPermissionCheckHandler((webContents, permission, origin) => {
    return webContents === contents && permission === 'notifications' && trustedUrl(origin);
  });
  contents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  contents.on('will-navigate', (event, url) => { if (!trustedUrl(url)) { event.preventDefault(); openExternal(url); } });
  contents.on('will-redirect', (event, url) => { if (!trustedUrl(url)) event.preventDefault(); });
  contents.on('will-attach-webview', event => event.preventDefault());
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('focus', () => mainWindow.flashFrame(false));
  mainWindow.on('close', event => { if (!quitting) { event.preventDefault(); mainWindow.hide(); } });
  ipcMain.handle('conecta:attention', (event, id) => {
    if (!validAttentionSender(event, mainWindow, id)) return { ok: false };
    if (Date.now() - lastAttention < 15000) return { ok: false };
    lastAttention = Date.now();
    return { ok: bringForward(mainWindow) };
  });
  ipcMain.handle('conecta:notify', (event, payload) => {
    if (!validSender(event, mainWindow)) return { ok: false, error: 'Origem não autorizada.' };
    const options = notificationOptions(payload);
    if (!options) return { ok: false, error: 'Notificação inválida.' };
    return showNativeNotification(Notification, { ...options, icon: path.join(__dirname, 'assets/icon.png') }, () => {
      bringForward(mainWindow);
      if (!contents.isDestroyed() && trustedUrl(contents.getURL())) contents.send('conecta:notification-click', payload.tag);
    }, activeNotifications, payload.tag);
  });
  const open = () => bringForward(mainWindow);
  tray = new Tray(path.join(__dirname, 'assets/icon.png'));
  tray.setToolTip('Conecta — Tríade');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir Conecta', click: open },
    { label: 'Atualizar', click: () => { open(); contents.reload(); } },
    { type: 'separator' }, { label: 'Sair do Conecta', click: () => app.quit() }
  ]));
  tray.on('double-click', open);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Conecta', submenu: [
      { label: 'Atualizar', accelerator: 'CmdOrCtrl+R', click: () => contents.reload() },
      { label: 'Sair do Conecta', click: () => app.quit() }
    ] },
    { label: 'Editar', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'Exibir', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] }
  ]));
  try { await mainWindow.loadURL(SITE_URL); }
  catch { mainWindow.show(); dialog.showMessageBox(mainWindow, { type: 'error', title: 'Conecta', message: 'Não foi possível conectar ao Conecta.', detail: 'Confira sua conexão e use Conecta → Atualizar para tentar novamente.' }); }
}
