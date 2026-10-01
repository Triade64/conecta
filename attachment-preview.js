(() => {
  let overlay = null, revoke = null, previousFocus = null;
  const style = document.createElement('style');
  style.textContent = '.attachment-preview-overlay{position:fixed;inset:0;z-index:2000;background:#17251bbd;display:grid;place-items:center;padding:20px}.attachment-preview-dialog{width:min(100%,1050px);height:min(88vh,850px);background:#fff;border-radius:14px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 12px 48px #0005}.attachment-preview-head{display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid #dfe5dc}.attachment-preview-name{flex:1;min-width:0;overflow-wrap:anywhere;font-weight:700}.attachment-preview-head button{border:1px solid #dfe5dc;background:#fff;color:#315b3c;border-radius:8px;padding:8px 12px;cursor:pointer}.attachment-preview-body{flex:1;min-height:0;overflow:auto;background:#f3f5f2;padding:12px;display:grid;place-items:center}.attachment-preview-body img{max-width:100%;max-height:100%;object-fit:contain}.attachment-preview-body iframe{width:100%;height:100%;min-height:55vh;border:0;background:#fff}.attachment-preview-body pre{margin:0;align-self:start;justify-self:stretch;white-space:pre-wrap;overflow-wrap:anywhere;max-width:100%;font:13px/1.6 monospace}.attachment-preview-open{border:0;background:transparent;text-decoration:underline;color:inherit;cursor:pointer;padding:4px 0;margin-right:12px;font-size:12px}.message-attachment.previewable{cursor:zoom-in}';
  document.head.append(style);
  const close = () => { if (revoke) revoke.abort(); revoke = null; overlay?.remove(); overlay = null; previousFocus?.focus?.(); };
  async function textPreview(url, signal) {
    const response = await fetch(url,{signal,credentials:'omit'});
    if (!response.ok) throw Error('Não foi possível carregar a prévia.');
    const reader = response.body.getReader(), chunks = []; let size = 0, truncated = false;
    try { while (size < 65536) { const next = await reader.read(); if (next.done) break; const chunk = next.value.slice(0,65536-size);chunks.push(chunk);size += chunk.length;if (next.value.length > chunk.length || size === 65536) { truncated = true; break; } } }
    finally { await reader.cancel(); }
    const data = new Uint8Array(size);let offset = 0;for (const chunk of chunks) {data.set(chunk,offset);offset += chunk.length;}
    return new TextDecoder().decode(data) + (truncated ? '\n\n[Prévia limitada aos primeiros 64 KB. Baixe para ver o arquivo completo.]' : '');
  }
  window.conectaAttachmentPreview = async attachment => {
    let url;
    try { url = new URL(window.conectaAttachments.previewUrl(attachment.url)); }
    catch (error) { showToast(error.message); return; }
    close(); previousFocus = document.activeElement;
    overlay = document.createElement('div');overlay.className = 'attachment-preview-overlay';
    const dialog = document.createElement('section');dialog.className = 'attachment-preview-dialog';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','Prévia de '+attachment.name);dialog.tabIndex = -1;
    const header = document.createElement('div');header.className = 'attachment-preview-head';
    const name = document.createElement('div');name.className = 'attachment-preview-name';name.textContent = attachment.name + ' · ' + window.conectaAttachments.formatSize(Number(attachment.size));
    const download = document.createElement('button');download.type = 'button';download.textContent = 'Baixar';
    download.onclick = async () => {
      download.disabled = true; download.textContent = 'Baixando…';
      try {
        if (typeof window.conectaDesktop?.download === 'function') {
          const result = await window.conectaDesktop.download({url:attachment.url,name:attachment.name});
          if (result?.ok) showToast('Arquivo salvo: '+(result.name || attachment.name));
          else if (!result?.cancelled) showToast(result?.error || 'Não foi possível baixar o arquivo.');
        } else { const link = document.createElement('a');link.href = attachment.url;link.download = attachment.name;link.target = '_blank';link.rel = 'noopener noreferrer';link.click(); }
      } catch { showToast('Não foi possível baixar o arquivo.'); }
      finally { download.disabled = false;download.textContent = 'Baixar'; }
    };
    const exit = document.createElement('button');exit.type = 'button';exit.textContent = 'Fechar';exit.onclick = close;
    const body = document.createElement('div');body.className = 'attachment-preview-body';header.append(name,download,exit);dialog.append(header,body);overlay.append(dialog);document.body.append(overlay);dialog.focus();
    overlay.onclick = event => { if (event.target === overlay) close(); };
    dialog.onkeydown = event => {
      if (event.key === 'Escape') { event.preventDefault();event.stopPropagation();close(); }
      if (event.key === 'Tab') { const buttons = [...dialog.querySelectorAll('button')].filter(x=>!x.disabled); if (event.shiftKey && (document.activeElement===buttons[0] || document.activeElement===dialog)) {event.preventDefault();buttons.at(-1)?.focus();}else if (!event.shiftKey && document.activeElement===buttons.at(-1)) {event.preventDefault();buttons[0]?.focus();} }
    };
    if (['image/jpeg','image/png','image/gif','image/webp'].includes(attachment.mime)) {
      const image = document.createElement('img');image.src = url.href;image.alt = attachment.name;image.onerror = () => {body.textContent = 'Não foi possível carregar a imagem. Recarregue a conversa e tente novamente.';};body.append(image);
    } else if (attachment.mime === 'application/pdf') {
      const frame = document.createElement('iframe');frame.src = url.href;frame.title = 'Prévia de '+attachment.name;frame.referrerPolicy = 'no-referrer';body.append(frame);
    } else if (['text/plain','text/csv'].includes(attachment.mime)) {
      body.textContent = 'Carregando prévia…'; const target = body; revoke = new AbortController();
      try { const content = await textPreview(url.href,revoke.signal); if (target.isConnected) {target.replaceChildren();const pre = document.createElement('pre');pre.textContent = content;target.append(pre);} }
      catch (error) { if (target.isConnected) target.textContent = error.message || 'Não foi possível carregar a prévia.'; }
    } else { const info = document.createElement('p');info.textContent = 'A prévia do conteúdo deste formato não está disponível. Use Baixar para abrir o arquivo no programa correspondente.';body.append(info); }
  };
  window.addEventListener('conecta-auth-session-reset',close);
})();
