'use strict';
function notificationOptions(payload) {
  if (!payload || typeof payload !== 'object') return null;
  for (const [key, limit] of [['title',120],['body',500],['tag',200]]) {
    if (typeof payload[key] !== 'string' || !payload[key].trim() || payload[key].length > limit) return null;
  }
  if (typeof payload.silent !== 'boolean') return null;
  return { title: payload.title, body: payload.body, silent: payload.silent };
}
function showNativeNotification(Notification, options, onClick, active, tag, timers = globalThis) {
  if (!Notification.isSupported()) return Promise.resolve({ ok: false, error: 'Este Windows não oferece notificações para o Conecta.' });
  return new Promise(resolve => {
    let notification, timer, settled = false;
    const finish = result => { if (settled) return; settled = true; timers.clearTimeout(timer); resolve(result); };
    try {
      notification = new Notification(options);
      const previous = active.get(tag); if (previous) previous.close();
      active.set(tag, notification);
      if (active.size > 100) { const oldest = active.keys().next().value; active.get(oldest).close(); active.delete(oldest); }
      notification.once('show', () => finish({ ok: true }));
      notification.once('failed', (_event, error) => {
        if (active.get(tag) === notification) active.delete(tag);
        finish({ ok: false, error: String(error || 'O Windows recusou a notificação.').slice(0,300) });
      });
      notification.on('click', onClick);
      timer = timers.setTimeout(() => finish({ ok: false, error: 'O Windows não confirmou a notificação. Confira Configurações → Sistema → Notificações → Conecta e Não incomodar.' }), 5000);
      notification.show();
    } catch (error) {
      if (active.get(tag) === notification) active.delete(tag);
      finish({ ok: false, error: String(error.message || error).slice(0,300) });
    }
  });
}
module.exports = { notificationOptions, showNativeNotification };
