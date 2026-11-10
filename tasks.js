(() => {
  // Aba "Tarefas": fluxo de tarefas por cliente entre setores. Regras no banco (supabase/tasks.sql).
  const flow = window.conectaTasksFlow;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const fmtDate = iso => iso ? iso.split('-').reverse().join('/') : '';
  const fmtTime = iso => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const SECTORS = flow.SECTORS;
  // Setores do filtro: os usados nos modelos e tarefas (um por chave), senão a lista padrão.
  const usedSectors = () => { const seen = new Map(); for (const x of [...templates, ...tasks]) for (const st of x.steps || []) { const k = flow.sectorKey(st.sector); if (k && !seen.has(k)) seen.set(k, st.sector); } return seen.size ? [...seen.values()].sort((a, b) => a.localeCompare(b, 'pt-BR')) : SECTORS; };
  const PRIORITY = { alta: 'Alta', normal: 'Normal', baixa: 'Baixa' };
  const STATUS = { open: 'Aberta', done: 'Concluída', cancelled: 'Cancelada' };
  const VIEW_LABEL = { inbox: 'Minha caixa', sector: 'Do meu setor', sent: 'Enviadas por mim', all: 'Todas' };
  const EVENT_LABEL = { created: 'Tarefa criada', advanced: 'Repassada', returned: 'Devolvida', completed: 'Concluída', cancelled: 'Cancelada', comment: 'Comentário', claimed: 'Assumida', released: 'Responsável liberado', completion_changed: 'Data de conclusão alterada' };

  let tasks = [], clients = [], templates = [], recurrences = [], holidays = [], ready = false, channel = null, timer = null, dueTimer = null, lastLoad = 0, generation = 0;
  let detail = null, detailEvents = [];
  const filters = { view: 'inbox', status: 'open', term: '', priority: '', sector: '', competence: '', onlyLate: false };
  const client = () => window.conectaTasksApi?.client();
  const ctx = () => {
    const p = window.conectaCurrentProfile || {}, u = window.conectaCurrentUser || {};
    return { userId: u.id, sector: p.sector || '', admin: p.role === 'admin' && p.active !== false };
  };
  const holidaySet = () => new Set(holidays.map(x => x.day));
  const clientsById = () => new Map(clients.map(c => [c.id, c]));
  const visible = () => document.getElementById('crumb')?.textContent === 'Tarefas';
  const toast = text => typeof showToast === 'function' ? showToast(text) : undefined;

  const nav = document.createElement('button');
  nav.type = 'button'; nav.dataset.view = 'Tarefas';
  nav.innerHTML = '<span class="ico" aria-hidden="true">☑</span> Tarefas <span class="count" id="taskNavCount">0</span>';
  (document.querySelector('.nav [data-view="Lembretes"]') || document.querySelector('.nav button:last-child'))?.after(nav);
  const paintNav = () => { const el = document.getElementById('taskNavCount'); if (el) el.textContent = String(ready ? flow.inboxCount(tasks, ctx()) : 0); paintSummary(); };

  async function load() {
    const api = client(); if (!api || !window.conectaCurrentUser) return;
    const mine = ++generation;
    const [t, c, m, r, h] = await Promise.all([
      api.from('tasks').select('*').order('updated_at', { ascending: false }).limit(500),
      api.from('task_clients').select('id,name,document,active').order('name'),
      api.from('task_templates').select('id,name,steps,active,created_by').order('name'),
      api.from('task_recurrences').select('*').order('day_of_month'),
      api.from('holidays').select('day,name').order('day')
    ]);
    if (mine !== generation) return;
    if (t.error || c.error || m.error) { console.warn('Tarefas: falha ao carregar', t.error || c.error || m.error); return; }
    const previous = ready ? tasks : null;
    tasks = t.data; clients = c.data; templates = m.data; recurrences = r.error ? [] : r.data; holidays = h.error ? [] : h.data; ready = true; lastLoad = Date.now();
    notifyArrivals(flow.arrivals(previous, tasks, ctx()));
    notifyDueSoon();
    if (detail) { detail = tasks.find(x => x.id === detail.id) || null; if (!detail) closeDetail(); }
    paintNav(); if (visible()) paintList();
    if (detail) paintDetail();
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => void load().catch(e => console.warn(e)), 250); };
  function start() {
    stop(); const api = client(); if (!api) return;
    channel = api.channel('tasks-live');
    for (const table of ['tasks', 'task_clients', 'task_templates', 'task_recurrences', 'holidays']) channel.on('postgres_changes', { event: '*', schema: 'public', table }, schedule);
    channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'task_events' }, payload => {
      if (detail && payload.new?.task_id === detail.id) void loadEvents();
    });
    channel.subscribe(status => { if (status === 'SUBSCRIBED') schedule(); });
    void load().catch(e => console.warn(e));
    dueTimer = setInterval(() => { if (ready) notifyDueSoon(); }, 60 * 60 * 1000);
  }
  function stop() {
    clearTimeout(timer); clearInterval(dueTimer); generation++;
    if (channel) { client()?.removeChannel(channel); channel = null; }
  }
  function reset() { stop(); tasks = []; clients = []; templates = []; recurrences = []; holidays = []; ready = false; detail = null; detailEvents = []; closeDialogs(); paintNav(); if (visible()) paintList(); }

  // ---------- avisos de chegada ----------
  function notifyArrivals(list) {
    if (!list.length) return;
    const map = clientsById(), c = ctx();
    const label = t => (map.get(t.client_id)?.name || 'Cliente') + ' · ' + t.title;
    const body = list.length === 1 ? label(list[0]) : list.length + ' tarefas chegaram para ' + (c.sector || 'o seu setor') + '.';
    const onClick = list.length === 1 ? () => openTaskFromOutside(list[0].id) : () => nav.click();
    const shown = window.conectaShowNotification?.('Nova tarefa para o seu setor', body, 'task-' + list[0].id + '-' + list[0].version, false, onClick);
    if (!shown && document.visibilityState === 'visible') toast('Nova tarefa para o seu setor: ' + body);
  }
  // Aviso de prazo próximo: uma vez por dia para cada tarefa (guardado no navegador).
  function notifyDueSoon() {
    const day = today();
    const list = flow.dueSoon(tasks, ctx(), day, holidaySet()).filter(t => {
      const key = 'conecta-task-due-' + t.id + '-' + flow.currentDue(t) + '-' + day;
      try { if (localStorage.getItem(key)) return false; localStorage.setItem(key, '1'); } catch {}
      return true;
    });
    if (!list.length) return;
    const map = clientsById();
    const when = t => flow.currentDue(t) === day ? 'vence hoje' : 'vence em ' + fmtDate(flow.currentDue(t));
    const body = list.length === 1 ? (map.get(list[0].client_id)?.name || 'Cliente') + ' · ' + list[0].title + ' — ' + when(list[0]) : list.length + ' tarefas com prazo vencendo hoje ou no próximo dia útil.';
    const onClick = list.length === 1 ? () => openTaskFromOutside(list[0].id) : () => nav.click();
    const shown = window.conectaShowNotification?.('Prazo próximo', body, 'task-due-' + day + '-' + list[0].id, false, onClick);
    if (!shown && document.visibilityState === 'visible') toast('Prazo próximo: ' + body);
  }
  function openTaskFromOutside(id) { nav.click(); openDetail(id); }

  // ---------- resumo na Visão geral ----------
  function paintSummary() {
    const stats = document.querySelector('.content>.stats'); if (!stats) return;
    let card = document.getElementById('taskSummary');
    if (!card) {
      card = document.createElement('section'); card.id = 'taskSummary'; card.className = 'card task-summary';
      stats.after(card);
      const sync = () => { card.hidden = stats.style.display === 'none'; };
      new MutationObserver(sync).observe(stats, { attributes: true, attributeFilter: ['style'] }); sync();
    }
    const c = ctx(), t = today();
    let html;
    if (!ready || !c.userId) html = '<div class="task-summary-head"><strong>Tarefas do seu setor</strong><span>Carregando…</span></div>';
    else {
      const s = flow.summary(tasks, c, t), map = clientsById();
      const next = flow.filterTasks(tasks, { view: 'turn', status: 'open' }, c, map, t).slice(0, 3);
      const pills = [`<span class="tasks-pill">${s.inbox} no setor</span>`];
      if (s.late) pills.push(`<span class="tasks-pill due-late">${s.late} atrasada${s.late > 1 ? 's' : ''}</span>`);
      if (s.today) pills.push(`<span class="tasks-pill due-today">${s.today} vence${s.today > 1 ? 'm' : ''} hoje</span>`);
      if (s.mine) pills.push(`<span class="tasks-pill">${s.mine} comigo</span>`);
      const items = next.map(x => {
        const late = flow.dueState(x, t);
        return `<li><button type="button" data-summary-task="${esc(x.id)}"><strong>${esc(map.get(x.client_id)?.name || 'Cliente')}</strong> ${esc(x.title)}${flow.currentDue(x) ? ` <small class="due-${late}">${fmtDate(flow.currentDue(x))}</small>` : ''}</button></li>`;
      }).join('');
      html = `<div class="task-summary-head"><strong>Tarefas do seu setor</strong>${pills.join('')}<button class="text-btn" type="button" data-summary-open>Ver tarefas →</button></div>`
        + (items ? `<ul class="task-summary-list">${items}</ul>` : '<p class="task-summary-empty">Nenhuma tarefa aguardando o seu setor.</p>');
    }
    if (card.innerHTML !== html) {
      card.innerHTML = html;
      card.querySelector('[data-summary-open]')?.addEventListener('click', () => nav.click());
      card.querySelectorAll('[data-summary-task]').forEach(b => { b.onclick = () => openTaskFromOutside(b.dataset.summaryTask); });
    }
  }
  setInterval(() => { if (ready) paintSummary(); }, 60_000);

  // ---------- diálogos ----------
  let dialogs = [];
  function closeDialogs() { dialogs.slice().forEach(d => d.close()); }
  function openDialog(html, wide) {
    const dialog = document.createElement('dialog');
    dialog.className = 'tasks-dialog' + (wide ? ' wide' : '');
    dialog.innerHTML = html; document.body.append(dialog); dialogs.push(dialog);
    dialog.addEventListener('close', () => { dialog.remove(); dialogs = dialogs.filter(d => d !== dialog); });
    dialog.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => dialog.close(); });
    dialog.showModal(); return dialog;
  }
  async function guarded(button, errorEl, action) {
    if (button.disabled) return false; button.disabled = true; errorEl.textContent = '';
    try { await action(); return true; }
    catch (error) { errorEl.textContent = flow.errorMessage(error); return false; }
    finally { button.disabled = false; }
  }
  const check = result => { if (result.error) throw result.error; return result.data; };

  function newTaskDialog(prefill) {
    prefill = prefill && typeof prefill.title === 'string' ? prefill : null;
    const active = templates.filter(t => t.active);
    if (!active.length) { toast('Cadastre um modelo de fluxo antes de criar tarefas.'); templatesDialog(); return; }
    const clientOptions = clients.filter(c => c.active).map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    const d = openDialog(`<h2>Nova tarefa</h2><form novalidate>
      <div class="field"><label for="ntClient">Cliente</label><div class="tasks-inline"><select id="ntClient" required><option value="">Selecione…</option>${clientOptions}</select><button class="secondary" type="button" id="ntNewClient">Novo cliente</button></div></div>
      <div class="field tasks-hidden" id="ntClientBox"><label for="ntClientName">Nome do novo cliente</label><input id="ntClientName" maxlength="160"><label for="ntClientDoc">CNPJ/CPF (opcional)</label><input id="ntClientDoc" maxlength="30"></div>
      <div class="field"><label for="ntTemplate">Fluxo</label><select id="ntTemplate">${active.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select><small id="ntSteps"></small></div>
      <div class="field"><label for="ntTitle">Título</label><input id="ntTitle" maxlength="160" placeholder="Ex.: Abertura de filial — competência 11/2026"></div>
      <div class="field"><label for="ntDesc">Descrição (opcional)</label><textarea id="ntDesc" rows="3" maxlength="4000"></textarea></div>
      <div class="tasks-inline">
      <div class="field"><label for="ntComp">Competência</label><input id="ntComp" type="month" value="${flow.previousMonth(today())}"></div>
      <div class="field"><label for="ntPriority">Prioridade</label><select id="ntPriority"><option value="normal">Normal</option><option value="alta">Alta</option><option value="baixa">Baixa</option></select></div></div>
      <p class="tasks-error" role="alert"></p>
      <div class="modal-actions"><button class="secondary" type="button" data-close>Cancelar</button><button class="primary" type="submit">Criar tarefa</button></div></form>`);
    const $ = id => d.querySelector('#' + id);
    if (prefill) { $('ntTitle').value = prefill.title.slice(0, 160); $('ntDesc').value = (prefill.description || '').slice(0, 4000); }
    const showSteps = () => { const t = templates.find(x => x.id === $('ntTemplate').value); $('ntSteps').textContent = t ? flow.stepDates(t.steps, flow.deadlineStart($('ntComp').value, today()), holidaySet()).map(s => s.sector + (s.due_date ? ' (até ' + fmtDate(s.due_date) + ')' : '')).join(' → ') : ''; };
    $('ntTemplate').onchange = showSteps; $('ntComp').oninput = $('ntComp').onchange = showSteps; showSteps();
    $('ntNewClient').onclick = () => { $('ntClientBox').classList.toggle('tasks-hidden'); $('ntClientName').focus(); };
    const error = d.querySelector('.tasks-error');
    d.querySelector('form').onsubmit = async event => {
      event.preventDefault();
      const submit = d.querySelector('[type=submit]');
      await guarded(submit, error, async () => {
        const api = client(); let clientId = $('ntClient').value;
        const newName = $('ntClientName').value.trim();
        if (!$('ntClientBox').classList.contains('tasks-hidden') && newName) {
          const existing = clients.find(c => flow.sectorKey(c.name) === flow.sectorKey(newName));
          if (existing) clientId = existing.id;
          else { const row = check(await api.from('task_clients').insert({ name: newName, document: $('ntClientDoc').value.trim() || null }).select('id,name,document,active').single()); clients.push(row); clientId = row.id; }
        }
        if (!clientId) throw { userMessage: 'Selecione ou cadastre o cliente.' };
        if ($('ntTitle').value.trim().length < 3) throw { userMessage: 'Informe um título com pelo menos 3 caracteres.' };
        check(await api.rpc('task_create', { p_client: clientId, p_template: $('ntTemplate').value, p_title: $('ntTitle').value, p_description: $('ntDesc').value, p_priority: $('ntPriority').value, p_due: null, p_competence: $('ntComp').value || null }));
        d.close(); toast('Tarefa criada.'); await load();
      });
    };
  }

  const stepTrack = task => (task.steps || []).map((s, i) => {
    const cls = task.status === 'done' || i < task.current_step ? 'done' : i === task.current_step && task.status === 'open' ? 'current' : '';
    const done = cls === 'done' && s.done_date;
    return `<li class="${cls}"><strong>${esc(s.sector)}</strong>${s.label ? `<small>${esc(s.label)}</small>` : ''}${s.due_date ? `<small class="${cls === 'current' && s.due_date < today() ? 'due-late' : ''}">até ${fmtDate(s.due_date)}</small>` : ''}${done ? `<small class="${s.due_date && s.done_date > s.due_date ? 'due-late' : 'step-done'}">feita em ${fmtDate(s.done_date)}</small>` : ''}</li>`;
  }).join('');

  function openDetail(id) {
    detail = tasks.find(t => t.id === id); if (!detail) return; detailEvents = [];
    document.querySelectorAll('dialog[data-detail]').forEach(old => { old.dataset.stale = '1'; if (old.open) old.close(); old.remove(); });
    const d = openDialog('<div class="tasks-detail"></div>', true);
    // O evento de fechamento chega depois; só limpa se ainda for esta tarefa (outra pode já ter sido aberta).
    d.addEventListener('close', () => { if (!d.dataset.stale && detail?.id === id) detail = null; });
    d.dataset.detail = '1'; paintDetail(); void loadEvents();
  }
  // ---------- ligação com as conversas ----------
  const taskLink = id => location.origin + location.pathname + '#tarefa/' + id;
  const chatMentions = new Map(); // task id -> { at, rows }
  async function paintChatMentions(host, task) {
    let box = host.querySelector('.tasks-chat-mentions');
    if (!box) { box = document.createElement('div'); box.className = 'tasks-chat-mentions'; host.querySelector('.tasks-track')?.after(box); }
    const cached = chatMentions.get(task.id);
    const draw = rows => {
      box.innerHTML = rows.length ? `<h3>No chat</h3><ul>${rows.map(r => `<li><button type="button" class="text-btn" data-chat="${esc(r.conversation_id)}" data-msg="${esc(r.id)}">${esc(r.author_name || 'Colaborador')} · ${fmtTime(r.created_at)}</button><small>${esc(String(r.text || '').replace(/\S*#tarefa\/[0-9a-f-]+/gi, '[tarefa]').slice(0, 140))}</small></li>`).join('')}</ul>` : '';
      box.querySelectorAll('[data-chat]').forEach(b => { b.onclick = () => { closeDetail(); window.conectaChatExtras?.jump(b.dataset.chat, b.dataset.msg); }; });
    };
    if (cached) draw(cached.rows);
    if (cached && Date.now() - cached.at < 30_000) return;
    const { data, error } = await client().from('messages').select('id,conversation_id,author_name,text,created_at').is('deleted_at', null).ilike('text', '%#tarefa/' + task.id + '%').order('created_at', { ascending: false }).limit(10);
    if (error) return;
    chatMentions.set(task.id, { at: Date.now(), rows: data });
    if (detail?.id === task.id) draw(data);
  }
  async function openFromLink(id) {
    for (let i = 0; i < 240 && !ready; i++) await new Promise(r => setTimeout(r, 250));
    if (!tasks.some(t => t.id === id)) { toast('Tarefa não encontrada ou sem acesso.'); return; }
    openTaskFromOutside(id);
  }
  const handleHash = () => {
    const m = /^#tarefa\/([0-9a-f-]{36})$/i.exec(location.hash);
    if (!m) return;
    history.replaceState(null, '', location.pathname + location.search);
    void openFromLink(m[1]);
  };
  window.addEventListener('hashchange', handleHash);
  window.conectaTasks = {
    link: taskLink,
    open: id => void openFromLink(id),
    openNew: prefill => { if (!ready) { toast('As tarefas ainda estão carregando. Tente de novo em instantes.'); return; } newTaskDialog(prefill); },
    info: id => {
      const t = tasks.find(x => x.id === id); if (!t) return null;
      const p = flow.progress(t);
      return { title: t.title, client: clientsById().get(t.client_id)?.name || 'Cliente', status: STATUS[t.status], open: flow.isOpen(t), sector: p.sector, label: p.label, step: p.index + 1, total: p.total, due: flow.currentDue(t) ? fmtDate(flow.currentDue(t)) : '', late: flow.dueState(t, today()) === 'late', competence: flow.fmtCompetence(t.competence) };
    }
  };
  function closeDetail() { document.querySelector('dialog[data-detail][open]')?.close(); }
  async function loadEvents() {
    if (!detail) return; const id = detail.id;
    const { data, error } = await client().from('task_events').select('id,kind,from_step,to_step,note,actor_name,created_at,done_on').eq('task_id', id).order('id');
    if (error || !detail || detail.id !== id) return; detailEvents = data; paintDetail();
  }
  function paintDetail() {
    const host = document.querySelector('dialog[data-detail][open] .tasks-detail'); if (!host || !detail) return;
    const task = detail, c = ctx(), allow = flow.can(task, c), p = flow.progress(task), cl = clientsById().get(task.client_id);
    const late = flow.dueState(task, today());
    const typed = host.querySelector('#tdNote')?.value || '', typedDone = host.querySelector('#tdStepDone')?.value || '';
    host.innerHTML = `<div class="tasks-head"><div><h2>${esc(task.title)}</h2><p>${esc(cl?.name || 'Cliente')} · ${esc(task.template_name)}</p></div><div class="tasks-head-actions"><button class="text-btn" type="button" data-copy-link title="Copiar link para colar no chat">🔗 Copiar link</button><button class="text-btn" type="button" data-close-detail aria-label="Fechar">✕</button></div></div>
      <div class="tasks-meta"><span class="tasks-pill status-${esc(task.status)}">${STATUS[task.status]}</span><span class="tasks-pill prio-${esc(task.priority)}">Prioridade ${PRIORITY[task.priority]}</span>${task.competence ? `<span class="tasks-pill">Competência ${flow.fmtCompetence(task.competence)}</span>` : ''}${flow.currentDue(task) && task.status === 'open' ? `<span class="tasks-pill due-${late}">Prazo do ${esc(p.sector)}: ${fmtDate(flow.currentDue(task))}${late === 'late' ? ' · atrasada' : late === 'today' ? ' · hoje' : ''}</span>` : ''}</div>
      ${task.status === 'open' ? `<div class="tasks-assignee"><span>${task.assigned_to ? `Responsável: <strong>${esc(task.assigned_name || 'Colaborador')}</strong>` : `Sem responsável no ${esc(p.sector)}`}</span>${allow.claim ? `<button class="secondary" type="button" data-act="claim">${task.assigned_to ? 'Assumir no lugar' : 'Assumir'}</button>` : ''}${allow.release ? '<button class="text-btn" type="button" data-act="release">Liberar</button>' : ''}</div>` : ''}
      ${task.status === 'done' ? `<div class="tasks-assignee"><span>Concluída em <strong>${task.completed_at ? fmtDate(flow.officeDate(task.completed_at)) : '—'}</strong></span>${allow.setCompleted ? `<input type="date" id="tdDoneDate" aria-label="Nova data de conclusão" value="${task.completed_at ? flow.officeDate(task.completed_at) : ''}" min="${flow.officeDate(task.created_at)}" max="${today()}"><button class="secondary" type="button" data-act="completed-at">Alterar data</button>` : ''}</div>` : ''}
      ${task.description ? `<p class="tasks-desc">${esc(task.description)}</p>` : ''}
      <ol class="tasks-track">${stepTrack(task)}</ol>
      <h3>Histórico</h3><ul class="tasks-events">${detailEvents.map(e => `<li class="ev-${esc(e.kind)}"><strong>${EVENT_LABEL[e.kind]}</strong>${e.kind === 'advanced' ? ` → ${esc(task.steps[e.to_step]?.sector || '')}` : e.kind === 'returned' ? ` → ${esc(task.steps[e.to_step]?.sector || '')}` : ''}${e.done_on && ['advanced', 'completed'].includes(e.kind) ? ` · etapa concluída em ${fmtDate(e.done_on)}` : ''}<small>${esc(e.actor_name || 'Colaborador')} · ${fmtTime(e.created_at)}</small>${e.note ? `<p>${esc(e.note)}</p>` : ''}</li>`).join('') || '<li><small>Carregando…</small></li>'}</ul>
      <div class="field"><label for="tdNote">Observação ${task.status === 'open' ? '(obrigatória para devolver ou cancelar)' : ''}</label><textarea id="tdNote" rows="2" maxlength="2000"></textarea></div>
      ${allow.advance ? `<div class="field tasks-step-done"><label for="tdStepDone">Etapa concluída em</label><input id="tdStepDone" type="date" value="${today()}" min="${flow.officeDate(task.created_at)}" max="${today()}"></div>` : ''}
      <p class="tasks-error" role="alert"></p>
      <div class="modal-actions tasks-actions"><button class="secondary" type="button" data-act="comment">Comentar</button>${allow.cancel ? '<button class="secondary danger" type="button" data-act="cancel">Cancelar tarefa</button>' : ''}${allow.return ? '<button class="secondary" type="button" data-act="return">Devolver</button>' : ''}${allow.advance ? `<button class="primary" type="button" data-act="advance">${p.index + 1 >= p.total ? 'Concluir tarefa' : 'Repassar para ' + esc(task.steps[p.index + 1]?.sector || '')}</button>` : ''}</div>
      ${task.status === 'open' && !allow.advance ? `<p class="tasks-wait">Aguardando o setor ${esc(p.sector)}.</p>` : ''}`;
    host.querySelector('#tdNote').value = typed;
    if (typedDone && host.querySelector('#tdStepDone')) host.querySelector('#tdStepDone').value = typedDone;
    host.querySelector('[data-close-detail]').onclick = closeDetail;
    host.querySelector('[data-copy-link]').onclick = async () => {
      try { await navigator.clipboard.writeText(taskLink(task.id)); toast('Link copiado. Cole numa conversa para mostrar o cartão da tarefa.'); }
      catch { prompt('Copie o link da tarefa:', taskLink(task.id)); }
    };
    paintChatMentions(host, task);
    const error = host.querySelector('.tasks-error');
    host.querySelectorAll('[data-act]').forEach(button => {
      button.onclick = () => void guarded(button, error, async () => {
        const note = host.querySelector('#tdNote').value, api = client(), v = task.version;
        const act = button.dataset.act;
        if (act === 'comment') check(await api.rpc('task_comment', { p_task: task.id, p_note: note }));
        if (act === 'completed-at') {
          const day = host.querySelector('#tdDoneDate').value;
          if (!day) throw { userMessage: 'Informe a data de conclusão.' };
          check(await api.rpc('task_set_completed_at', { p_task: task.id, p_version: v, p_date: day, p_note: note }));
        }
        if (act === 'claim' || act === 'release') check(await api.rpc('task_claim', { p_task: task.id, p_version: v, p_release: act === 'release' }));
        if (act === 'advance') {
          const doneOn = host.querySelector('#tdStepDone')?.value;
          if (!doneOn) throw { userMessage: 'Informe a data em que a etapa foi concluída.' };
          check(await api.rpc('task_advance', { p_task: task.id, p_version: v, p_note: note, p_done_on: doneOn }));
        }
        if (act === 'return') check(await api.rpc('task_return', { p_task: task.id, p_version: v, p_note: note }));
        if (act === 'cancel' && !confirm('Cancelar esta tarefa? A ação não pode ser desfeita.')) return;
        if (act === 'cancel') check(await api.rpc('task_cancel', { p_task: task.id, p_version: v, p_note: note }));
        host.querySelector('#tdNote').value = '';
        toast(act === 'comment' ? 'Comentário registrado.' : 'Tarefa atualizada.');
        await load(); await loadEvents();
      }).catch(() => {}).then(() => { if (error.textContent.includes('alterada por outra pessoa')) void load(); });
    });
  }

  // Listas recolhíveis: lembra a escolha por navegador (padrão: recolhida).
  const collapseKey = name => 'conecta-tasks-open:' + name;
  const collapseOpen = name => { try { return localStorage.getItem(collapseKey(name)) === '1'; } catch { return false; } };
  const bindCollapse = host => host.querySelectorAll('details[data-collapse]').forEach(d => {
    d.addEventListener('toggle', () => { try { localStorage.setItem(collapseKey(d.dataset.collapse), d.open ? '1' : '0'); } catch {} });
  });

  function templatesDialog() {
    const d = openDialog('<div class="tasks-detail"></div>', true);
    const copyName = name => { const taken = new Set(templates.map(t => flow.sectorKey(t.name))); let n = 1, out; do { out = 'Cópia de ' + name + (n > 1 ? ' (' + n + ')' : ''); n++; } while (taken.has(flow.sectorKey(out))); return out.slice(0, 120); };
    const paint = (editing, copyId) => {
      const host = d.querySelector('.tasks-detail');
      const item = editing && templates.find(t => t.id === editing);
      const source = !item && copyId && templates.find(t => t.id === copyId);
      const draft = item || (source ? { name: copyName(source.name), steps: source.steps } : null);
      host.innerHTML = `<div class="tasks-head"><div><h2>Modelos de fluxo</h2><p>Cada modelo define a sequência de setores de uma atividade.</p></div><button class="text-btn" type="button" data-close aria-label="Fechar">✕</button></div>
        <details class="tasks-collapse" data-collapse="templates"${collapseOpen('templates') ? ' open' : ''}><summary>Modelos cadastrados (${templates.length})</summary><ul class="tasks-templates">${templates.map(t => `<li><div><strong>${esc(t.name)}</strong>${t.active ? '' : ' <small>(inativo)</small>'}<small>${esc(t.steps.map(s => s.sector + (s.due_day ? ' (dia ' + s.due_day + ')' : '')).join(' → '))}</small></div><span class="tasks-template-actions"><button class="text-btn" type="button" data-copy="${esc(t.id)}">Duplicar</button>${ctx().admin || t.created_by === ctx().userId ? `<button class="text-btn" type="button" data-edit="${esc(t.id)}">Editar</button>` : ''}</span></li>`).join('') || '<li><small>Nenhum modelo cadastrado.</small></li>'}</ul></details>
        <form novalidate><h3>${item ? 'Editar modelo' : source ? 'Duplicar modelo: ' + esc(source.name) : 'Novo modelo'}</h3>
        <div class="field"><label for="tmName">Nome da atividade</label><input id="tmName" maxlength="120" value="${esc(draft?.name || '')}"></div>
        <div class="field"><span class="tasks-label">Etapas, na ordem do fluxo</span><ol class="tasks-step-rows" id="tmSteps"></ol><button class="text-btn" type="button" data-add-step>+ Adicionar etapa</button><small>Tarefas já criadas mantêm a sequência original.</small></div>
        ${item ? `<label class="tasks-check"><input id="tmActive" type="checkbox" ${item.active ? 'checked' : ''}> Modelo ativo</label>` : ''}
        <p class="tasks-error" role="alert"></p>
        <div class="modal-actions">${item || source ? '<button class="secondary" type="button" data-new>Novo modelo</button>' : ''}<button class="primary" type="submit">${item ? 'Salvar alterações' : 'Criar modelo'}</button></div></form>`;
      host.querySelector('[data-close]').onclick = () => d.close();
      const rows = host.querySelector('#tmSteps');
      const sectorOptions = current => { const list = SECTORS.includes(current) || !current ? SECTORS : [...SECTORS, current]; return list.map(s => `<option value="${esc(s)}"${s === current ? ' selected' : ''}>${esc(s)}${SECTORS.includes(s) ? '' : ' (fora do padrão)'}</option>`).join(''); };
      const addRow = (step = {}) => { const li = document.createElement('li'); const sector = step.sector ? flow.canonicalSector(step.sector) : ''; li.innerHTML = `<select aria-label="Setor da etapa" data-step-sector><option value="">Setor…</option>${sectorOptions(sector)}</select><input aria-label="Descrição da etapa (opcional)" data-step-label maxlength="80" placeholder="Descrição (opcional)" value="${esc(step.label || '')}"><input aria-label="Prazo: até o dia do mês" title="Prazo: até o dia do mês (1 a 31)" data-step-day type="number" min="1" max="31" placeholder="Dia" value="${step.due_day ?? ''}"><span class="tasks-step-buttons"><button class="text-btn" type="button" data-up title="Subir" aria-label="Subir etapa">↑</button><button class="text-btn" type="button" data-down title="Descer" aria-label="Descer etapa">↓</button><button class="text-btn" type="button" data-remove title="Remover" aria-label="Remover etapa">✕</button></span>`; li.querySelector('[data-up]').onclick = () => li.previousElementSibling?.before(li); li.querySelector('[data-down]').onclick = () => li.nextElementSibling?.after(li); li.querySelector('[data-remove]').onclick = () => { li.remove(); if (!rows.children.length) addRow(); }; rows.append(li); return li; };
      (draft?.steps?.length ? draft.steps : [{}]).forEach(st => addRow(st));
      host.querySelector('[data-add-step]').onclick = () => addRow().querySelector('select').focus();
      host.querySelectorAll('[data-edit]').forEach(b => { b.onclick = () => paint(b.dataset.edit); });
      bindCollapse(host);
      host.querySelectorAll('[data-copy]').forEach(b => { b.onclick = () => { paint(null, b.dataset.copy); const input = host.querySelector('#tmName'); input.focus(); input.select(); }; });
      host.querySelector('[data-new]')?.addEventListener('click', () => paint(null));
      const error = host.querySelector('.tasks-error');
      host.querySelector('form').onsubmit = async event => {
        event.preventDefault();
        await guarded(host.querySelector('[type=submit]'), error, async () => {
          const all = [...rows.children].map(li => ({ sector: li.querySelector('[data-step-sector]').value, label: li.querySelector('[data-step-label]').value.trim(), day: li.querySelector('[data-step-day]').value.trim() })), steps = all.filter(st => st.sector).map(({ day, ...st }) => (day ? { ...st, due_day: Number(day) } : st)), name = host.querySelector('#tmName').value.trim();
          if (name.length < 2) throw { userMessage: 'Informe o nome do modelo.' };
          if (all.some(st => !st.sector && st.label)) throw { userMessage: 'Escolha o setor de todas as etapas com descrição.' };
          if (!steps.length) throw { userMessage: 'Informe ao menos uma etapa.' };
          const api = client();
          if (item) check(await api.from('task_templates').update({ name, steps, active: host.querySelector('#tmActive').checked, updated_at: new Date().toISOString() }).eq('id', item.id));
          else check(await api.from('task_templates').insert({ name, steps }));
          await load(); toast(source ? 'Modelo duplicado.' : 'Modelo salvo.'); paint(null);
        });
      };
    };
    paint(null);
  }

  function recurrencesDialog() {
    const d = openDialog('<div class="tasks-detail"></div>', true);
    const paint = editing => {
      const host = d.querySelector('.tasks-detail'), map = clientsById();
      const item = editing && recurrences.find(r => r.id === editing);
      const activeTemplates = templates.filter(t => t.active || t.id === item?.template_id);
      const activeClients = clients.filter(c => c.active || c.id === item?.client_id);
      const opt = (list, selected) => list.map(x => `<option value="${esc(x.id)}"${x.id === selected ? ' selected' : ''}>${esc(x.name)}</option>`).join('');
      const tplName = id => templates.find(t => t.id === id)?.name || 'Modelo removido';
      host.innerHTML = `<div class="tasks-head"><div><h2>Tarefas recorrentes</h2><p>Criadas automaticamente todo mês, às 6h do dia escolhido. Os prazos vêm das etapas do fluxo.</p></div><button class="text-btn" type="button" data-close aria-label="Fechar">✕</button></div>
        <ul class="tasks-templates">${recurrences.map(r => `<li><div><strong>${esc(map.get(r.client_id)?.name || 'Cliente')} · ${esc(r.title)}</strong>${r.active ? '' : ' <small>(pausada)</small>'}<small>${esc(tplName(r.template_id))} · todo dia ${r.day_of_month} · competência: ${(r.competence_offset ?? -1) === 0 ? 'mês atual' : 'mês anterior'}${r.last_period ? ' · última: ' + esc(r.last_period.split('-').reverse().join('/')) : ''}</small></div><span class="tasks-template-actions"><button class="text-btn" type="button" data-edit="${esc(r.id)}">Editar</button></span></li>`).join('') || '<li><small>Nenhuma recorrência cadastrada por você.</small></li>'}</ul>
        <form novalidate><h3>${item ? 'Editar recorrência' : 'Nova recorrência'}</h3>
        <div class="tasks-inline"><div class="field"><label for="rcClient">Cliente</label><select id="rcClient"><option value="">Selecione…</option>${opt(activeClients, item?.client_id)}</select></div>
        <div class="field"><label for="rcTemplate">Fluxo</label><select id="rcTemplate"><option value="">Selecione…</option>${opt(activeTemplates, item?.template_id)}</select></div></div>
        <div class="field"><label for="rcTitle">Título</label><input id="rcTitle" maxlength="160" placeholder="Ex.: Fechamento {mes}" value="${esc(item?.title || '')}"><small>Use {mes} para incluir a competência, por exemplo "Pró-labore {mes}" criado em novembro vira "Pró-labore 10/2026" (competência do mês anterior).</small></div>
        <div class="field"><label for="rcDesc">Descrição (opcional)</label><textarea id="rcDesc" rows="2" maxlength="4000">${esc(item?.description || '')}</textarea></div>
        <div class="tasks-inline"><div class="field"><label for="rcDay">Criar no dia</label><input id="rcDay" type="number" min="1" max="28" value="${item?.day_of_month || 1}"></div>
        <div class="field"><label for="rcComp">Competência</label><select id="rcComp"><option value="-1"${(item?.competence_offset ?? -1) === -1 ? ' selected' : ''}>Mês anterior</option><option value="0"${item?.competence_offset === 0 ? ' selected' : ''}>Mês atual</option></select></div>
        <div class="field"><label for="rcPriority">Prioridade</label><select id="rcPriority">${Object.entries(PRIORITY).map(([k, v]) => `<option value="${k}"${(item?.priority || 'normal') === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div></div>
        ${item ? `<label class="tasks-check"><input id="rcActive" type="checkbox" ${item.active ? 'checked' : ''}> Recorrência ativa</label>` : '<small>Se o dia escolhido já passou neste mês, a primeira tarefa sai no próximo mês.</small>'}
        <p class="tasks-error" role="alert"></p>
        <div class="modal-actions">${item ? '<button class="secondary danger" type="button" data-delete>Excluir</button><button class="secondary" type="button" data-new>Nova recorrência</button>' : ''}<button class="primary" type="submit">${item ? 'Salvar alterações' : 'Criar recorrência'}</button></div></form>`;
      host.querySelector('[data-close]').onclick = () => d.close();
      host.querySelectorAll('[data-edit]').forEach(b => { b.onclick = () => paint(b.dataset.edit); });
      host.querySelector('[data-new]')?.addEventListener('click', () => paint(null));
      const error = host.querySelector('.tasks-error'), $ = id => host.querySelector('#' + id);
      host.querySelector('[data-delete]')?.addEventListener('click', event => void guarded(event.currentTarget, error, async () => {
        if (!confirm('Excluir esta recorrência? As tarefas já criadas continuam.')) return;
        check(await client().from('task_recurrences').delete().eq('id', item.id));
        await load(); toast('Recorrência excluída.'); paint(null);
      }));
      host.querySelector('form').onsubmit = async event => {
        event.preventDefault();
        await guarded(host.querySelector('[type=submit]'), error, async () => {
          const day = Number($('rcDay').value);
          const row = { client_id: $('rcClient').value, template_id: $('rcTemplate').value, title: $('rcTitle').value.trim(), description: $('rcDesc').value, priority: $('rcPriority').value, day_of_month: day, competence_offset: Number($('rcComp').value) };
          if (!row.client_id) throw { userMessage: 'Selecione o cliente.' };
          if (!row.template_id) throw { userMessage: 'Selecione o fluxo.' };
          if (row.title.length < 3) throw { userMessage: 'Informe um título com pelo menos 3 caracteres.' };
          if (!Number.isInteger(day) || day < 1 || day > 28) throw { userMessage: 'O dia precisa estar entre 1 e 28.' };
          const api = client();
          if (item) check(await api.from('task_recurrences').update({ ...row, active: $('rcActive').checked }).eq('id', item.id));
          else check(await api.from('task_recurrences').insert(row));
          await load(); toast('Recorrência salva.'); paint(null);
        });
      };
    };
    paint(null);
  }

  function holidaysDialog() {
    const d = openDialog('<div class="tasks-detail"></div>', true);
    const paint = () => {
      const host = d.querySelector('.tasks-detail'), now = today();
      const upcoming = holidays.filter(x => x.day >= now.slice(0, 4) + '-01-01');
      host.innerHTML = `<div class="tasks-head"><div><h2>Feriados</h2><p>Prazos que caem em fim de semana ou feriado passam para o próximo dia útil. Vale para tarefas criadas depois da alteração.</p></div><button class="text-btn" type="button" data-close aria-label="Fechar">✕</button></div>
        <ul class="tasks-templates">${upcoming.map(x => `<li><div><strong>${fmtDate(x.day)}</strong><small>${esc(x.name)}</small></div><span class="tasks-template-actions"><button class="text-btn" type="button" data-del="${esc(x.day)}">Excluir</button></span></li>`).join('') || '<li><small>Nenhum feriado cadastrado.</small></li>'}</ul>
        <form novalidate><h3>Adicionar feriado</h3><div class="tasks-inline"><div class="field"><label for="hdDay">Data</label><input id="hdDay" type="date"></div><div class="field"><label for="hdName">Nome</label><input id="hdName" maxlength="80" placeholder="Ex.: Carnaval, aniversário da cidade"></div></div>
        <p class="tasks-error" role="alert"></p><div class="modal-actions"><button class="primary" type="submit">Adicionar</button></div></form>`;
      host.querySelector('[data-close]').onclick = () => d.close();
      const error = host.querySelector('.tasks-error');
      host.querySelectorAll('[data-del]').forEach(b => { b.onclick = () => void guarded(b, error, async () => { check(await client().from('holidays').delete().eq('day', b.dataset.del)); await load(); paint(); }); });
      host.querySelector('form').onsubmit = async event => {
        event.preventDefault();
        await guarded(host.querySelector('[type=submit]'), error, async () => {
          const day = host.querySelector('#hdDay').value, name = host.querySelector('#hdName').value.trim();
          if (!day) throw { userMessage: 'Informe a data.' };
          if (name.length < 2) throw { userMessage: 'Informe o nome do feriado.' };
          check(await client().from('holidays').insert({ day, name }));
          await load(); toast('Feriado adicionado.'); paint();
        });
      };
    };
    paint();
  }

  // ---------- lista ----------
  function renderTasks() {
    const c = ctx(), views = flow.VIEWS.filter(v => v !== 'all' || c.admin);
    if (!views.includes(filters.view)) filters.view = 'inbox';
    document.getElementById('viewPanel').innerHTML = `<div class="view-toolbar"><div><h2>Tarefas entre setores</h2><p>Acompanhe o fluxo de cada cliente, de etapa em etapa.</p></div><div class="tasks-toolbar-actions"><button class="secondary" type="button" id="taskTemplatesBtn">Modelos de fluxo</button><button class="secondary" type="button" id="taskRecurBtn">Recorrências</button>${c.admin ? '<button class="secondary" type="button" id="taskHolidaysBtn">Feriados</button>' : ''}<button class="primary" type="button" id="taskNewBtn">+ Nova tarefa</button></div></div>
      <div class="tasks-tabs" role="tablist">${views.map(v => `<button type="button" role="tab" data-tview="${v}" aria-selected="${filters.view === v}">${VIEW_LABEL[v]} <span class="count" data-tcount="${v}"></span></button>`).join('')}</div>
      <div class="tasks-filters"><div class="field"><label for="tfTerm">Pesquisar</label><input id="tfTerm" type="search" placeholder="Cliente, título ou fluxo" value="${esc(filters.term)}"></div>
      <div class="field"><label for="tfStatus">Situação</label><select id="tfStatus"><option value="">Todas</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div class="field"><label for="tfSector">Etapa atual</label><select id="tfSector"><option value="">Todos os setores</option>${usedSectors().map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select></div>
      <div class="field"><label for="tfPriority">Prioridade</label><select id="tfPriority"><option value="">Todas</option>${Object.entries(PRIORITY).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div class="field"><label for="tfComp">Competência</label><select id="tfComp"></select></div>
      <label class="tasks-check"><input id="tfLate" type="checkbox"> Só atrasadas</label></div>
      <div class="tasks-list" id="taskList" aria-live="polite"></div>`;
    const $ = id => document.getElementById(id);
    $('tfStatus').value = filters.status; $('tfSector').value = filters.sector; $('tfPriority').value = filters.priority; $('tfLate').checked = filters.onlyLate;
    $('taskNewBtn').onclick = newTaskDialog; $('taskRecurBtn').onclick = recurrencesDialog; $('taskHolidaysBtn') && ($('taskHolidaysBtn').onclick = holidaysDialog);$('taskTemplatesBtn') && ($('taskTemplatesBtn').onclick = templatesDialog);
    document.querySelectorAll('[data-tview]').forEach(b => { b.onclick = () => { filters.view = b.dataset.tview; document.querySelectorAll('[data-tview]').forEach(x => x.setAttribute('aria-selected', String(x === b))); paintList(); }; });
    const bind = (id, key, prop = 'value') => { $(id).oninput = $(id).onchange = () => { filters[key] = $(id)[prop]; paintList(); }; };
    bind('tfTerm', 'term'); bind('tfStatus', 'status'); bind('tfSector', 'sector'); bind('tfPriority', 'priority'); bind('tfComp', 'competence'); bind('tfLate', 'onlyLate', 'checked');
    paintList();
  }
  function paintList() {
    const host = document.getElementById('taskList'); if (!host || !visible()) return;
    const c = ctx(), map = clientsById(), t = today();
    // Competências existentes, da mais recente para a mais antiga; mantém a escolhida mesmo sem tarefas.
    const compSelect = document.getElementById('tfComp');
    if (compSelect) {
      const comps = [...new Set(tasks.map(x => x.competence).filter(Boolean).concat(filters.competence && filters.competence !== '-' ? [filters.competence] : []))].sort().reverse();
      const compOptions = '<option value="">Todas</option>' + comps.map(v => `<option value="${esc(v)}">${flow.fmtCompetence(v)}</option>`).join('') + (tasks.some(x => !x.competence) ? '<option value="-">Sem competência</option>' : '');
      if (compSelect.innerHTML !== compOptions) compSelect.innerHTML = compOptions;
      compSelect.value = filters.competence || '';
    }
    const sectorSelect = document.getElementById('tfSector'), sectorOptions = '<option value="">Todos os setores</option>' + usedSectors().map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    if (sectorSelect && sectorSelect.innerHTML !== sectorOptions) { sectorSelect.innerHTML = sectorOptions; sectorSelect.value = [...sectorSelect.options].some(o => flow.sectorKey(o.value) === flow.sectorKey(filters.sector)) ? [...sectorSelect.options].find(o => flow.sectorKey(o.value) === flow.sectorKey(filters.sector)).value : ''; }
    document.querySelectorAll('[data-tcount]').forEach(el => { const v = el.dataset.tcount; el.textContent = String(tasks.filter(x => flow.isOpen(x) && flow.filterTasks([x], { view: v }, c, map, t).length).length); });
    const rows = flow.filterTasks(tasks, filters, c, map, t);
    if (!ready) { host.innerHTML = '<div class="empty">Carregando tarefas…</div>'; return; }
    if (!rows.length) { host.innerHTML = `<div class="empty">${filters.view === 'inbox' && tasks.length ? 'Você não assumiu nenhuma tarefa aberta. As tarefas na vez do seu setor ficam em “Do meu setor”: abra uma e clique em Assumir.' : tasks.length ? 'Nenhuma tarefa encontrada com estes filtros.' :'Nenhuma tarefa ainda. Use “+ Nova tarefa” para iniciar um fluxo.'}</div>`; return; }
    host.innerHTML = rows.map(task => {
      const p = flow.progress(task), late = flow.dueState(task, t), mine = flow.isMyTurn(task, c);
      return `<button type="button" class="card tasks-item${mine ? ' mine' : ''}" data-task="${esc(task.id)}"><div class="tasks-item-main"><strong>${esc(map.get(task.client_id)?.name || 'Cliente')}</strong><span>${esc(task.title)}</span><small>${task.competence ? 'Comp. ' + flow.fmtCompetence(task.competence) + ' · ' : ''}${esc(task.template_name)}${task.status === 'open' && task.assigned_to ? ` · com ${esc(task.assigned_name || 'colaborador')}` : ''}</small></div>
        <div class="tasks-item-side"><span class="tasks-pill status-${esc(task.status)}">${task.status === 'open' ? `Etapa ${p.index + 1}/${p.total} · ${esc(p.sector)}${p.label ? `: <strong>${esc(p.label)}</strong>` : ''}` : STATUS[task.status] + (task.status === 'done' && task.completed_at ? ' em ' + fmtDate(flow.officeDate(task.completed_at)) : '')}</span>${task.priority === 'alta' && flow.isOpen(task) ? '<span class="tasks-pill prio-alta">Alta</span>' : ''}${flow.currentDue(task) && flow.isOpen(task) ? `<span class="tasks-pill due-${late}" title="Prazo da etapa atual">até ${fmtDate(flow.currentDue(task))}${late === 'late' ? ' · atrasada' : ''}</span>` : ''}</div></button>`;
    }).join('');
    host.querySelectorAll('[data-task]').forEach(b => { b.onclick = () => openDetail(b.dataset.task); });
  }

  const previous = renderView;
  renderView = window.renderView = view => { previous(view); if (view === 'Tarefas') renderTasks(); };
  nav.onclick = () => { document.querySelectorAll('.nav button,.channel').forEach(b => b.classList.toggle('active', b === nav)); renderView('Tarefas'); if (ready && Date.now() - lastLoad > 10 * 60_000) schedule(); };
  window.addEventListener('conecta-profile-ready', () => { if (window.conectaCurrentProfile?.active !== false) start(); });
  window.addEventListener('conecta-auth-session-reset', reset);
  window.addEventListener('focus', () => { if (ready && Date.now() - lastLoad > 60_000) schedule(); });
  if (window.conectaCurrentUser && window.conectaCurrentProfile) start();
  handleHash();
})();
