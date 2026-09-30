'use strict';
const SITE_URL = 'https://triadecontabilidade.vercel.app';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function trustedUrl(value) {
  try { const url = new URL(value); return url.origin === SITE_URL && !url.username && !url.password; }
  catch { return false; }
}
function validSender(event, window) {
  return !!window && !window.isDestroyed() && event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame && trustedUrl(event.senderFrame?.url);
}
function validAttentionSender(event, window, id) {
  return validSender(event, window) && typeof id === 'string' && UUID.test(id);
}
function bringForward(window) {
  if (!window || window.isDestroyed()) return false;
  if (window.isMinimized()) window.restore();
  window.show();
  window.moveTop();
  window.focus();
  // If Windows declines foreground focus, the taskbar still attracts attention.
  window.flashFrame(!window.isFocused());
  return true;
}
module.exports = { SITE_URL, trustedUrl, validSender, validAttentionSender, bringForward };
