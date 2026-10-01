'use strict';
const path = require('node:path');
const EXTENSIONS = 'jpg|jpeg|png|gif|webp|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|zip|odt|ods';
function downloadRequest(payload) {
  try {
    if (typeof payload?.url !== 'string' || payload.url.length > 4096) return null;
    const url = new URL(payload.url);
    if (url.origin !== 'https://fmyenjfzdwizpgretpkk.supabase.co' || url.username || url.password || !url.searchParams.get('token')) return null;
    const match = url.pathname.match(new RegExp('^/storage/v1/object/sign/chat-files/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\\.(' + EXTENSIONS + ')$', 'i'));
    if (!match) return null;
    let name = String(payload.name || 'anexo').split(/[\\/]/).pop().replace(/[<>:"|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,200) || 'anexo';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
    if (!name.toLowerCase().endsWith('.' + match[1].toLowerCase())) name += '.' + match[1].toLowerCase();
    return { url: url.href, name };
  } catch { return null; }
}
function createDownloads({ contents, session, getWindow, downloadsPath, timers = globalThis }) {
  const pending = new Map();
  session.on('will-download', (event, item, sender) => {
    const chain = item.getURLChain(), request = [...pending.values()].find(row => chain.includes(row.url));
    if (sender !== contents || !request || !chain.every(url => downloadRequest({url,name:request.name}))) { event.preventDefault(); if (request) request.finish({ok:false,error:'O destino do download não foi autorizado.'}); return; }
    timers.clearTimeout(request.timer);
    if (item.getTotalBytes() > 20 * 1024 * 1024) { event.preventDefault(); request.finish({ok:false,error:'O arquivo excede o limite de 20 MB.'}); return; }
    item.setSaveDialogOptions({ title: 'Salvar anexo do Conecta', defaultPath: path.join(downloadsPath,request.name), buttonLabel: 'Salvar' });
    request.timer = timers.setTimeout(() => { request.finish({ok:false,error:'O download demorou demais. Confira a conexão e tente novamente.'}); item.cancel(); }, 10 * 60 * 1000);
    item.on('updated', (_event, state) => {
      const window = getWindow(); if (window?.isDestroyed()) return;
      const total = item.getTotalBytes(); window?.setProgressBar(state === 'progressing' && total ? Math.min(1,item.getReceivedBytes()/total) : 2);
    });
    item.once('done', (_event, state) => request.finish(state === 'completed'
      ? {ok:true,name:path.basename(item.getSavePath())}
      : state === 'cancelled' ? {ok:false,cancelled:true} : {ok:false,error:'Não foi possível concluir o download. Confira a conexão e tente novamente.'}));
  });
  const download = payload => {
    const request = downloadRequest(payload);
    if (!request) return Promise.resolve({ok:false,error:'Este anexo não é um download autorizado do Conecta.'});
    if (pending.size) return Promise.resolve({ok:false,error:'Aguarde o download atual terminar.'});
    return new Promise(resolve => {
      let settled = false;
      request.finish = result => {
        if (settled) return; settled = true; timers.clearTimeout(request.timer); pending.delete(request.url);
        const window = getWindow(); if (window && !window.isDestroyed()) window.setProgressBar(-1);
        resolve(result);
      };
      pending.set(request.url,request);
      request.timer = timers.setTimeout(() => request.finish({ok:false,error:'Não foi possível iniciar o download. Recarregue a conversa e tente novamente.'}), 30000);
      try { contents.downloadURL(request.url); }
      catch { request.finish({ok:false,error:'Não foi possível iniciar o download.'}); }
    });
  };
  return { download };
}
module.exports = { downloadRequest, createDownloads };
