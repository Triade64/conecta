(() => {
  // Melhorias das conversas: separadores por dia, agrupamento, marcador de novas mensagens,
  // "digitando…", menções com @, reações, mensagens fixadas, busca na conversa, respostas em
  // fio, lembrete e tarefa a partir da mensagem, cartão de tarefa e horário na lista.
  // Tudo é aplicado sobre o DOM já desenhado por renderConversations (features.js).
  const db = () => window.conectaTasksApi?.client();
  const me = () => window.conectaCurrentUser?.id || '';
  const dir = () => window.conectaDirectory || [];
  const myName = () => window.conectaCurrentProfile?.name || dir().find(p => p.id === me())?.name || '';
  const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = t => typeof showToast === 'function' && showToast(t);
  const current = () => { try { return contacts[selectedContact] || null; } catch { return null; } };
  const box = () => document.getElementById('chatMessages');
  const REACTIONS = ['👍', '✅', '👀', '❤️', '😂', '🙏'];
  const EMOJI_GROUPS = [
    ["Rostos", [["😀","sorriso feliz"],["😄","riso feliz"],["😅","alivio suor"],["🤣","rolando rindo"],["😊","sorriso timido"],["😍","apaixonado amor"],["😘","beijo"],["😎","legal oculos"],["🤔","pensando duvida"],["🤨","desconfiado"],["😐","neutro"],["🙄","revirando olhos"],["😴","sono dormindo"],["😮","surpreso uau"],["😱","susto medo"],["😢","triste choro"],["😭","chorando"],["😡","bravo raiva"],["🤯","explodindo mente"],["🥳","festa comemoracao"],["😬","tenso constrangido"],["🤐","segredo boca fechada"],["🤗","abraco"],["🫡","continencia ok"],["🙃","de cabeca para baixo ironia"]]],
    ["Gestos", [["👍","joinha positivo"],["👎","negativo"],["👏","palmas parabens"],["🙌","maos para cima viva"],["🙏","obrigado por favor"],["👌","ok perfeito"],["✌️","paz vitoria"],["🤞","dedos cruzados sorte"],["💪","forca"],["👋","ola tchau"],["🤝","acordo aperto de mao"],["👀","olhando vendo"],["🫶","coracao maos carinho"]]],
    ["Símbolos", [["✅","feito concluido ok"],["☑️","marcado"],["❌","erro nao"],["⚠️","atencao alerta"],["❗","importante"],["❓","pergunta duvida"],["❤️","coracao amor"],["💙","coracao azul"],["💯","cem perfeito"],["🔥","fogo top"],["⭐","estrela"],["✨","brilho"],["🎉","festa parabens"],["🚀","foguete rapido"],["⏰","alarme prazo"],["⏳","aguardando tempo"],["📌","fixado"],["📎","anexo clipe"],["📄","documento"],["📊","grafico relatorio"],["💰","dinheiro"],["🧾","nota recibo"],["📅","calendario data"],["☕","cafe"],["🍕","pizza"]]]
  ];
  const TASK_LINK = /#tarefa\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  const dayKey = iso => iso ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso)) : '';
  const dayLabel = key => {
    const today = dayKey(new Date().toISOString()), y = new Date(); y.setDate(y.getDate() - 1);
    if (key === today) return 'Hoje';
    if (key === dayKey(y.toISOString())) return 'Ontem';
    const [a, m, d] = key.split('-').map(Number);
    return new Date(a, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: a === new Date().getFullYear() ? undefined : 'numeric' });
  };
  const shortTime = iso => {
    if (!iso) return '';
    const d = new Date(iso);
    return dayKey(iso) === dayKey(new Date().toISOString()) ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  };
  const jump = (conversationId, messageId) => {
    if (window.conectaOpenFavoriteConversation?.(conversationId, messageId)) return true;
    toast('Conversa não disponível para você.'); return false;
  };

  // ---------- menções ----------
  const mentions = (text, userId) => {
    const t = fold(text);
    if (/(^|\s)@todos(\s|$|[.,!?])/.test(t)) return true;
    const person = dir().find(p => p.id === userId);
    const name = person?.name || (userId === me() ? myName() : '');
    return !!name && t.includes('@' + fold(name));
  };
  window.conectaMentions = { mentions };
  const markMentions = bubble => {
    const names = [...new Set(dir().map(p => p.name).filter(Boolean))].sort((a, b) => b.length - a.length);
    const pattern = new RegExp('@(' + ['todos', ...names].map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
    const walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement.closest('a,small,button,.chat-mention,.reply-quote') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const text = node.textContent; if (!text.includes('@')) continue;
      const frag = document.createDocumentFragment(); let at = 0, hit = false;
      for (const m of text.matchAll(pattern)) {
        frag.append(text.slice(at, m.index));
        const span = document.createElement('span'); span.className = 'chat-mention'; span.textContent = m[0];
        if (fold(m[1]) === 'todos' || fold(m[1]) === fold(myName())) span.classList.add('me');
        frag.append(span); at = m.index + m[0].length; hit = true;
      }
      if (hit) { frag.append(text.slice(at)); node.replaceWith(frag); }
    }
  };
  // Sugestões ao digitar "@" no campo de mensagem.
  let picker = null, pickerItems = [], pickerIndex = 0, pickerCtx = null;
  const closePicker = () => { picker?.remove(); picker = null; pickerCtx = null; };
  const mentionQuery = () => {
    const input = document.getElementById('chatInput'), sel = getSelection();
    if (!input || !sel.rangeCount || !sel.isCollapsed) return null;
    const node = sel.anchorNode; if (!node || node.nodeType !== 3 || !input.contains(node)) return null;
    const before = node.textContent.slice(0, sel.anchorOffset), m = /(?:^|\s)@([^\s@]{0,30})$/.exec(before);
    return m ? { node, end: sel.anchorOffset, query: m[1], input } : null;
  };
  const choose = item => {
    const c = pickerCtx; if (!c) return;
    const range = document.createRange(); range.setStart(c.node, c.end - c.query.length - 1); range.setEnd(c.node, c.end);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    if (!document.execCommand('insertText', false, '@' + item + ' ')) { range.deleteContents(); range.insertNode(document.createTextNode('@' + item + ' ')); }
    closePicker(); c.input.focus();
  };
  const paintPicker = () => {
    const q = mentionQuery(); if (!q) return closePicker();
    const f = fold(q.query);
    pickerItems = [...dir().filter(p => p.id !== me() && p.name && fold(p.name).includes(f)).slice(0, 6).map(p => ({ value: p.name, hint: p.sector || '' })),
      ...('todos'.startsWith(f) ? [{ value: 'todos', hint: 'avisa todos da conversa' }] : [])];
    if (!pickerItems.length) return closePicker();
    pickerCtx = q; pickerIndex = Math.min(pickerIndex, pickerItems.length - 1);
    const host = q.input.closest('.conversation-chat'); if (!host) return;
    if (!picker) { picker = document.createElement('div'); picker.className = 'chat-mention-picker'; picker.setAttribute('role', 'listbox'); host.append(picker); }
    picker.innerHTML = pickerItems.map((it, i) => `<button type="button" role="option" class="${i === pickerIndex ? 'active' : ''}" data-i="${i}">@${esc(it.value)}<small>${esc(it.hint)}</small></button>`).join('');
    picker.querySelectorAll('button').forEach(b => b.onmousedown = e => { e.preventDefault(); choose(pickerItems[+b.dataset.i].value); });
  };
  document.addEventListener('input', e => { if (e.target?.id === 'chatInput') { paintPicker(); sendTyping(); } }, true);
  document.addEventListener('keydown', e => {
    if (!picker || e.target?.id !== 'chatInput') return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); pickerIndex = (pickerIndex + (e.key === 'ArrowDown' ? 1 : -1) + pickerItems.length) % pickerItems.length; paintPicker(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); choose(pickerItems[pickerIndex].value); }
    else if (e.key === 'Escape') { e.preventDefault(); closePicker(); }
  }, true);
  document.addEventListener('click', e => { if (picker && !picker.contains(e.target)) closePicker(); });

  // ---------- "digitando…" (Realtime broadcast; nada é gravado) ----------
  let typingChannel = null, typingConv = '', lastTypingSent = 0;
  const typers = new Map();
  function ensureTyping(convId) {
    if (typingConv === convId) return;
    if (typingChannel) db()?.removeChannel(typingChannel);
    typingChannel = null; typingConv = convId; typers.clear(); paintTyping();
    if (!convId || !db()) return;
    typingChannel = db().channel('typing-' + convId, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (!payload?.id || payload.id === me()) return;
        typers.set(payload.id, { name: String(payload.name || 'Alguém').slice(0, 60), at: Date.now() }); paintTyping();
      })
      .on('broadcast', { event: 'stop' }, ({ payload }) => { typers.delete(payload?.id); paintTyping(); })
      .subscribe();
  }
  function sendTyping() {
    const text = document.getElementById('chatInput')?.textContent.trim();
    if (!typingChannel || !text || Date.now() - lastTypingSent < 2500) return;
    lastTypingSent = Date.now();
    void typingChannel.send({ type: 'broadcast', event: 'typing', payload: { id: me(), name: myName() } });
  }
  document.addEventListener('submit', e => {
    if (e.target?.id !== 'composer') return;
    newCount = 0;
    if (!typingChannel) return;
    lastTypingSent = 0; void typingChannel.send({ type: 'broadcast', event: 'stop', payload: { id: me() } });
  }, true);
  function paintTyping() {
    for (const [id, t] of typers) if (Date.now() - t.at > 5000) typers.delete(id);
    const chat = document.querySelector('.conversation-chat'), composer = chat?.querySelector('#composer');
    let el = chat?.querySelector('.chat-typing');
    if (!composer) return;
    if (!el) { el = document.createElement('div'); el.className = 'chat-typing'; el.setAttribute('aria-live', 'polite'); composer.before(el); }
    const names = [...typers.values()].map(t => t.name.split(' ')[0]);
    el.textContent = !names.length ? '' : names.length === 1 ? names[0] + ' está digitando…' : names.slice(0, -1).join(', ') + ' e ' + names.at(-1) + ' estão digitando…';
  }
  setInterval(() => { if (typers.size) paintTyping(); }, 1500);

  // ---------- reações e fixadas ----------
  let extrasConv = '', extrasChannel = null, reactions = new Map(), pins = [], loadSeq = 0;
  // Guarda reações/fixadas por conversa por 5 min para não buscar de novo a cada troca.
  const extrasCache = new Map();
  async function loadExtras() {
    const convId = extrasConv, seq = ++loadSeq, api = db(); if (!api || !convId) return;
    const [r, p] = await Promise.all([
      api.from('message_reactions').select('message_id,user_id,emoji').eq('conversation_id', convId).order('created_at').limit(3000),
      api.from('message_pins').select('message_id,pinned_by,created_at,messages(text,author_name,deleted_at,attachment_name)').eq('conversation_id', convId).order('created_at', { ascending: false })
    ]);
    if (seq !== loadSeq || convId !== extrasConv) return;
    reactions = new Map();
    for (const row of r.error ? [] : r.data) { if (!reactions.has(row.message_id)) reactions.set(row.message_id, []); reactions.get(row.message_id).push(row); }
    pins = p.error ? [] : p.data.filter(x => !x.messages?.deleted_at);
    if (!r.error && !p.error) extrasCache.set(convId, { at: Date.now(), reactions, pins });
    decorate(true);
  }
  function ensureExtras(convId) {
    if (extrasConv === convId) return;
    if (extrasChannel) db()?.removeChannel(extrasChannel);
    extrasChannel = null; extrasConv = convId; reactions = new Map(); pins = []; closePanel();
    if (!convId || !db()) return;
    let timer = null; const later = () => { clearTimeout(timer); timer = setTimeout(() => void loadExtras(), 200); };
    extrasChannel = db().channel('chat-extras-' + convId);
    for (const table of ['message_reactions', 'message_pins']) extrasChannel.on('postgres_changes', { event: '*', schema: 'public', table, filter: 'conversation_id=eq.' + convId }, later);
    extrasChannel.subscribe();
    const cached = extrasCache.get(convId);
    if (cached && Date.now() - cached.at < 5 * 60_000) { reactions = cached.reactions; pins = cached.pins; requestAnimationFrame(() => decorate(true)); }
    else void loadExtras();
  }
  async function toggleReaction(messageId, emoji) {
    const api = db(), mine = (reactions.get(messageId) || []).some(r => r.user_id === me() && r.emoji === emoji);
    const { error } = mine
      ? await api.from('message_reactions').delete().match({ message_id: messageId, user_id: me(), emoji })
      : await api.from('message_reactions').insert({ message_id: messageId, conversation_id: extrasConv, user_id: me(), emoji });
    if (error) { toast('Não foi possível registrar a reação.'); return; }
    await loadExtras();
  }
  async function togglePin(messageId) {
    const api = db(), pinned = pins.some(p => p.message_id === messageId);
    const { error } = pinned
      ? await api.from('message_pins').delete().eq('message_id', messageId)
      : await api.from('message_pins').insert({ message_id: messageId, conversation_id: extrasConv, pinned_by: me() });
    if (error) { toast('Não foi possível ' + (pinned ? 'desafixar' : 'fixar') + ' a mensagem.'); return; }
    toast(pinned ? 'Mensagem desafixada.' : 'Mensagem fixada no topo da conversa.');
    await loadExtras();
  }
  const nameOf = id => id === me() ? 'Você' : dir().find(p => p.id === id)?.name || 'Colaborador';

  // ---------- painel lateral (fixadas, busca, respostas) ----------
  let panelKind = '';
  function closePanel() { document.querySelector('.chat-side-panel')?.remove(); panelKind = ''; }
  function openPanel(kind, title, html) {
    const chat = document.querySelector('.conversation-chat'); if (!chat) return null;
    closePanel(); panelKind = kind;
    const panel = document.createElement('aside'); panel.className = 'chat-side-panel'; panel.dataset.kind = kind;
    panel.innerHTML = `<header><strong>${esc(title)}</strong><button type="button" class="text-btn" aria-label="Fechar">✕</button></header><div class="chat-side-body">${html}</div>`;
    panel.querySelector('header button').onclick = closePanel;
    chat.append(panel); return panel;
  }
  const snippet = (text, attachment) => esc(String(text || (attachment ? '📎 ' + attachment : '')).replace(/\s+/g, ' ').slice(0, 160));
  function showPins() {
    const conv = current(); if (!conv) return;
    const panel = openPanel('pins', 'Mensagens fixadas', pins.length ? '<ul class="chat-side-list">' + pins.map(p => `<li><button type="button" class="chat-side-item" data-msg="${esc(p.message_id)}"><b>${esc(p.messages?.author_name || 'Colaborador')}</b>${snippet(p.messages?.text, p.messages?.attachment_name)}<small>Fixada por ${esc(nameOf(p.pinned_by))} · ${shortTime(p.created_at)}</small></button><button type="button" class="text-btn" data-unpin="${esc(p.message_id)}" title="Desafixar">✕</button></li>`).join('') + '</ul>' : '<p class="chat-side-empty">Nenhuma mensagem fixada. Use o menu ⋯ de uma mensagem e escolha “Fixar”.</p>');
    panel?.querySelectorAll('[data-msg]').forEach(b => b.onclick = () => jump(conv.firestoreId, b.dataset.msg));
    panel?.querySelectorAll('[data-unpin]').forEach(b => b.onclick = async () => { await togglePin(b.dataset.unpin); showPins(); });
  }
  function showSearch() {
    const conv = current(); if (!conv) return;
    const panel = openPanel('search', 'Buscar nesta conversa', `<form class="chat-search-form"><input type="search" placeholder="Texto da mensagem…" aria-label="Buscar nesta conversa" maxlength="80"><button class="secondary" type="submit">Buscar</button></form><button type="button" class="text-btn chat-mine-mentions">@ Mensagens que mencionam você (todas as conversas)</button><div class="chat-search-results"></div>`);
    if (!panel) return;
    const input = panel.querySelector('input'), out = panel.querySelector('.chat-search-results'); input.focus();
    const show = (rows, all) => {
      out.innerHTML = rows.length ? '<ul class="chat-side-list">' + rows.map(r => `<li><button type="button" class="chat-side-item" data-conv="${esc(r.conversation_id)}" data-msg="${esc(r.id)}"><b>${esc(r.author_name || 'Colaborador')}${all ? ' · ' + esc(contacts.find(c => c.firestoreId === r.conversation_id)?.name || 'conversa') : ''}</b>${snippet(r.text, r.attachment_name)}<small>${new Date(r.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</small></button></li>`).join('') + '</ul>' : '<p class="chat-side-empty">Nada encontrado.</p>';
      out.querySelectorAll('[data-msg]').forEach(b => b.onclick = () => jump(b.dataset.conv, b.dataset.msg));
    };
    const run = async (term, all) => {
      out.innerHTML = '<p class="chat-side-empty">Buscando…</p>';
      let q = db().from('messages').select('id,conversation_id,author_name,text,attachment_name,created_at').is('deleted_at', null).ilike('text', '%' + term.replace(/[%_\\]/g, m => '\\' + m) + '%').order('created_at', { ascending: false }).limit(40);
      if (!all) q = q.eq('conversation_id', conv.firestoreId);
      const { data, error } = await q;
      if (panelKind !== 'search') return;
      if (error) { out.innerHTML = '<p class="chat-side-empty">Não foi possível buscar agora.</p>'; return; }
      // Administradores leem tudo para moderação; na busca, só conversas da pessoa.
      show(data.filter(r => !all || contacts.some(c => c.firestoreId === r.conversation_id)), all);
    };
    panel.querySelector('form').onsubmit = e => { e.preventDefault(); const t = input.value.trim(); if (t.length < 2) { out.innerHTML = '<p class="chat-side-empty">Digite pelo menos 2 letras.</p>'; return; } void run(t, false); };
    panel.querySelector('.chat-mine-mentions').onclick = () => { if (!myName()) return; void run('@' + myName(), true); };
  }
  function showThread(parentId) {
    const conv = current(); if (!conv) return;
    const all = conv.messages || [], parent = all.find(m => m.id === parentId), replies = all.filter(m => m.replyTo === parentId);
    const item = m => `<li class="chat-thread-msg${m.mine ? ' mine' : ''}"><b>${esc(m.mine ? 'Você' : m.authorName || 'Colaborador')}</b><span>${m.deletedAt ? 'Mensagem apagada' : snippet(m.text, m.attachmentName)}</span><small>${esc(m.time || '')}</small></li>`;
    const panel = openPanel('thread', 'Respostas', `<ul class="chat-side-list chat-thread">${parent ? item(parent) : ''}${replies.map(item).join('')}</ul><button type="button" class="primary chat-thread-reply">Responder</button>`);
    panel?.querySelector('.chat-thread-reply')?.addEventListener('click', () => {
      conv.replyTarget = { id: parentId, text: parent?.text || '', authorName: parent?.mine ? 'Você' : parent?.authorName || 'Colaborador' };
      closePanel(); renderConversations(undefined, false); document.getElementById('chatInput')?.focus();
    });
  }

  // ---------- lembrete a partir da mensagem ----------
  function remindDialog(message) {
    const d = document.createElement('dialog'); d.className = 'chat-remind-dialog';
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 0, 0, 0);
    const local = dt => new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    d.innerHTML = `<form method="dialog"><h2>Lembrar desta mensagem</h2><p>${snippet(message.text, message.attachmentName)}</p>
      <div class="field"><label>Quando</label><select data-when><option value="60">Em 1 hora</option><option value="180">Em 3 horas</option><option value="tomorrow" selected>Amanhã às 9h</option><option value="custom">Escolher data e hora…</option></select></div>
      <div class="field" data-custom hidden><input type="datetime-local" value="${local(tomorrow)}"></div>
      <div class="modal-actions"><button class="secondary" value="cancel">Cancelar</button><button class="primary" value="ok">Criar lembrete</button></div></form>`;
    document.body.append(d); d.showModal();
    const when = d.querySelector('[data-when]'); when.onchange = () => { d.querySelector('[data-custom]').hidden = when.value !== 'custom'; };
    d.addEventListener('close', async () => {
      const ok = d.returnValue === 'ok', custom = d.querySelector('input').value; d.remove(); if (!ok) return;
      const due = when.value === 'tomorrow' ? tomorrow : when.value === 'custom' ? new Date(custom) : new Date(Date.now() + Number(when.value) * 60000);
      if (Number.isNaN(due.getTime())) { toast('Data inválida.'); return; }
      const who = message.mine ? 'sua mensagem' : (message.authorName || 'Colaborador');
      const title = ('Mensagem de ' + who + ': ' + String(message.text || message.attachmentName || '').replace(/\s+/g, ' ')).slice(0, 140);
      const { error } = await db().from('reminders').insert({ title, due_at: due.toISOString(), owner_id: me() });
      toast(error ? 'Não foi possível criar o lembrete.' : 'Lembrete criado para ' + due.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) + '.');
    });
  }

  // ---------- desenho ----------
  let lastConv = '', newCount = 0;
  function addMenuItems(row, message, conv) {
    const menu = row.querySelector('.message-action-menu');
    if (!menu || menu.dataset.extras || !message?.id || message.deletedAt) return;
    menu.dataset.extras = '1';
    const add = (label, fn, first) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
      b.addEventListener('click', e => { e.stopPropagation(); menu.hidden = true; fn(); });
      first ? menu.prepend(b) : menu.append(b);
    };
    const pinned = pins.some(p => p.message_id === message.id);
    add('☑ Criar tarefa', () => window.conectaTasks?.openNew({ title: String(message.text || message.attachmentName || 'Tarefa do chat').replace(/\s+/g, ' ').slice(0, 80), description: `Mensagem de ${message.mine ? 'você' : message.authorName || 'Colaborador'} em ${conv.name} (${message.time || ''}):\n${message.text || ''}` }));
    add('⏰ Lembrar desta mensagem', () => remindDialog(message));
    add(pinned ? '📌 Desafixar' : '📌 Fixar no topo', () => void togglePin(message.id));
    const bar = document.createElement('div'); bar.className = 'chat-react-row';
    for (const emoji of REACTIONS) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = emoji; b.title = 'Reagir com ' + emoji;
      b.addEventListener('click', e => { e.stopPropagation(); menu.hidden = true; void toggleReaction(message.id, emoji); });
      bar.append(b);
    }
    const more = document.createElement("button"); more.type = "button"; more.textContent = "＋"; more.title = "Mais emojis"; more.className = "chat-react-more";
    more.addEventListener("click", e => { e.stopPropagation(); menu.hidden = true; emojiPicker(more.closest(".message-row") || row, emoji => void toggleReaction(message.id, emoji)); });
    bar.append(more);
    menu.prepend(bar);
  }
  function emojiPicker(anchor, onPick) {
    document.querySelector(".chat-emoji-picker")?.remove();
    const box = document.createElement("div"); box.className = "chat-emoji-picker";
    box.innerHTML = "<input type=\"search\" placeholder=\"Buscar emoji…\" aria-label=\"Buscar emoji\">";
    const grid = document.createElement("div"); grid.className = "chat-emoji-grid"; box.append(grid);
    const paint = term => {
      grid.innerHTML = "";
      for (const [group, list] of EMOJI_GROUPS) {
        const items = list.filter(([, words]) => !term || words.includes(term));
        if (!items.length) continue;
        const h = document.createElement("small"); h.textContent = group; grid.append(h);
        for (const [emoji, words] of items) {
          const b = document.createElement("button"); b.type = "button"; b.textContent = emoji; b.title = words.split(" ")[0];
          b.onclick = e => { e.stopPropagation(); close(); onPick(emoji); }; grid.append(b);
        }
      }
      if (!grid.children.length) grid.innerHTML = "<small>Nenhum emoji encontrado.</small>";
    };
    const input = box.querySelector("input");
    input.oninput = () => paint(input.value.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""));
    const close = () => { box.remove(); document.removeEventListener("mousedown", outside, true); document.removeEventListener("keydown", esc, true); };
    const outside = e => { if (!box.contains(e.target)) close(); };
    const esc = e => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.body.append(box); paint("");
    const r = anchor.getBoundingClientRect(), w = box.offsetWidth, h = box.offsetHeight;
    box.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + "px";
    box.style.top = Math.max(8, Math.min(innerHeight - h - 8, r.top - h - 6 < 8 ? r.bottom + 6 : r.top - h - 6)) + "px";
    setTimeout(() => { document.addEventListener("mousedown", outside, true); document.addEventListener("keydown", esc, true); input.focus(); });
  }
  function paintReactions(row, message) {
    const stack = row.querySelector('.message-stack'); if (!stack) return;
    stack.querySelector('.chat-reactions')?.remove();
    const list = reactions.get(message.id) || []; if (!list.length) return;
    const groups = new Map(); for (const r of list) { if (!groups.has(r.emoji)) groups.set(r.emoji, []); groups.get(r.emoji).push(r.user_id); }
    const wrap = document.createElement('div'); wrap.className = 'chat-reactions';
    for (const [emoji, users] of groups) {
      const b = document.createElement('button'); b.type = 'button'; b.className = users.includes(me()) ? 'mine' : '';
      b.textContent = emoji + ' ' + users.length; b.title = users.map(nameOf).join(', ');
      b.onclick = () => void toggleReaction(message.id, emoji); wrap.append(b);
    }
    stack.append(wrap);
  }
  function paintTaskCards(bubble) {
    bubble.parentElement?.querySelectorAll(':scope > .chat-task-card').forEach(x => x.remove());
    const seen = new Set();
    bubble.querySelectorAll('a').forEach(a => {
      const m = TASK_LINK.exec(a.href); if (!m) return;
      a.removeAttribute('target'); a.onclick = e => { e.preventDefault(); window.conectaTasks?.open(m[1]); };
      a.textContent = '🔗 link da tarefa'; if (seen.has(m[1])) return; seen.add(m[1]);
      const info = window.conectaTasks?.info(m[1]);
      const card = document.createElement('button'); card.type = 'button'; card.className = 'chat-task-card';
      card.innerHTML = info
        ? `<span class="chat-task-ico">☑</span><span><b>${esc(info.client)} · ${esc(info.title)}</b><small>${info.open ? `Etapa ${info.step}/${info.total} · ${esc(info.sector)}${info.label ? ': ' + esc(info.label) : ''}${info.due ? ' · até ' + esc(info.due) : ''}${info.late ? ' · atrasada' : ''}` : esc(info.status)}${info.competence ? ' · Comp. ' + esc(info.competence) : ''}</small></span>`
        : '<span class="chat-task-ico">☑</span><span><b>Tarefa</b><small>Clique para abrir</small></span>';
      if (info?.late) card.classList.add('late');
      card.onclick = () => window.conectaTasks?.open(m[1]);
      bubble.after(card);
    });
  }
  function paintHead(conv) {
    const head = document.querySelector('.conversation-chat .chat-head'); if (!head) return;
    let tools = head.querySelector('.chat-head-tools');
    if (!tools) {
      tools = document.createElement('span'); tools.className = 'chat-head-tools';
      tools.innerHTML = '<button type="button" data-tool="search" title="Buscar nesta conversa" aria-label="Buscar nesta conversa">🔍</button><button type="button" data-tool="pins" title="Mensagens fixadas" aria-label="Mensagens fixadas">📌 <span></span></button>';
      tools.querySelector('[data-tool=search]').onclick = () => panelKind === 'search' ? closePanel() : showSearch();
      tools.querySelector('[data-tool=pins]').onclick = () => panelKind === 'pins' ? closePanel() : showPins();
      head.append(tools);
    }
    tools.querySelector('[data-tool=pins] span').textContent = pins.length ? String(pins.length) : '';
    let strip = document.querySelector('.conversation-chat .chat-pin-strip');
    if (!pins.length) { strip?.remove(); return; }
    if (!strip) { strip = document.createElement('button'); strip.type = 'button'; strip.className = 'chat-pin-strip'; head.after(strip); }
    const top = pins[0];
    strip.innerHTML = `📌 <b>${esc(top.messages?.author_name || 'Colaborador')}:</b> ${snippet(top.messages?.text, top.messages?.attachment_name)}${pins.length > 1 ? ` <small>+${pins.length - 1}</small>` : ''}`;
    strip.onclick = () => pins.length > 1 ? showPins() : jump(conv.firestoreId, top.message_id);
  }
  function paintList() {
    document.querySelectorAll('.conversation-list .conv-item').forEach(b => {
      const item = contacts[Number(b.dataset.contact)]; const name = b.querySelector('.chat-name'); if (!item || !name) return;
      let t = name.querySelector('.chat-list-time');
      const label = shortTime(item.updated_at);
      if (!label) { t?.remove(); return; }
      if (!t) { t = document.createElement('small'); t.className = 'chat-list-time'; name.append(t); }
      t.textContent = label;
    });
  }
  function decorate(force) {
    const conv = current(), list = box();
    paintList();
    if (!conv || !list) return;
    if (conv.firestoreId !== lastConv) { lastConv = conv.firestoreId; newCount = Number(conv.unreadCount) || 0; }
    ensureTyping(conv.firestoreId); ensureExtras(conv.firestoreId);
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    list.querySelectorAll(':scope > .chat-day, :scope > .chat-new-marker').forEach(x => x.remove());
    const rows = [...list.querySelectorAll(':scope > .message-row')], msgs = conv.messages || [];
    const replyCount = new Map(); for (const m of msgs) if (m.replyTo) replyCount.set(m.replyTo, (replyCount.get(m.replyTo) || 0) + 1);
    let prevDay = '', prevAuthor = '', prevAt = 0;
    const othersFromEnd = []; // índices das últimas mensagens de outras pessoas, para o marcador de novas
    rows.forEach((row, i) => {
      const m = msgs[i], bubble = row.querySelector('.bubble'); if (!m || !bubble) return;
      const at = bubble.dataset.createdAt, day = dayKey(at);
      if (day && day !== prevDay) { const sep = document.createElement('div'); sep.className = 'chat-day'; sep.innerHTML = `<span>${esc(dayLabel(day))}</span>`; row.before(sep); prevAuthor = ''; }
      const t = at ? new Date(at).getTime() : 0;
      row.classList.toggle('chat-grouped', !!m.authorId && m.authorId === prevAuthor && t - prevAt < 5 * 60000);
      prevDay = day || prevDay; prevAuthor = m.authorId; prevAt = t;
      if (!m.mine) othersFromEnd.push(i);
      if (!m.deletedAt && !bubble.dataset.extrasDone) { bubble.dataset.extrasDone = '1'; markMentions(bubble); }
      if (!m.deletedAt) paintTaskCards(bubble);
      bubble.classList.toggle('chat-mentions-me', !m.mine && !m.deletedAt && mentions(m.text, me()));
      row.classList.toggle('chat-pinned', pins.some(p => p.message_id === m.id));
      paintReactions(row, m);
      const stack = row.querySelector('.message-stack'); stack?.querySelector('.chat-thread-link')?.remove();
      const n = replyCount.get(m.id);
      if (n && stack) { const b = document.createElement('button'); b.type = 'button'; b.className = 'chat-thread-link'; b.textContent = '↳ ' + n + (n === 1 ? ' resposta' : ' respostas'); b.onclick = () => showThread(m.id); stack.append(b); }
      if (force) { const menu = row.querySelector('.message-action-menu'); if (menu?.dataset.extras) { menu.querySelectorAll(':scope > .chat-react-row').forEach(x => x.remove()); [...menu.children].filter(b => /^(☑|⏰|📌) /.test(b.textContent)).forEach(b => b.remove()); delete menu.dataset.extras; } }
      addMenuItems(row, m, conv);
    });
    if (newCount > 0 && othersFromEnd.length) {
      const idx = othersFromEnd[Math.max(0, othersFromEnd.length - newCount)], row = rows[idx];
      if (row) { const mark = document.createElement('div'); mark.className = 'chat-new-marker'; mark.innerHTML = `<span>${newCount === 1 ? '1 nova mensagem' : newCount + ' novas mensagens'}</span>`; (row.previousElementSibling?.classList.contains('chat-day') ? row.previousElementSibling : row).before(mark); }
    }
    paintHead(conv); paintTyping();
    if (nearBottom) list.scrollTop = list.scrollHeight;
  }
  let frame = 0;
  const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => decorate(false)); };
  new MutationObserver(records => {
    if (records.some(r => [...r.addedNodes].some(n => n.nodeType === 1 && (n.matches('.message-row,.conversation-chat,.conv-item') || n.querySelector?.('.message-row,.conversation-chat,.conv-item'))))) schedule();
  }).observe(document.body, { childList: true, subtree: true });
  schedule();
  // Sai da conversa: encerra os canais.
  setInterval(() => { if (!box() && (typingConv || extrasConv)) { ensureTyping(''); ensureExtras(''); lastConv = ''; } }, 3000);
  window.addEventListener('conecta-auth-session-reset', () => { ensureTyping(''); ensureExtras(''); lastConv = ''; });
  window.conectaChatExtras = { jump, mentions };
})();
