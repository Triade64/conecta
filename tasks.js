(() => {
  // Aba "Tarefas": fluxo de tarefas por cliente entre setores. Regras no banco (supabase/tasks.sql).
  const flow = window.conectaTasksFlow;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const fmtDate = iso => iso ? iso.split('-').reverse().join('/') : '';
  const fmtTime = iso => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const SECTORS = ['Dpto. Fiscal', 'Dpto. Contábil', 'Dpto. Pessoal', 'Administração'];
  // Setores do filtro: os usados nos modelos e tarefas (um por chave), senão a lista padrão.
  const usedSectors = () => { const seen = new Map(); for (const x of [...templates, ...tasks]) for (const st of x.steps || []) { const k = flow.sectorKey(st.sector); if (k && !seen.has(k)) seen.set(k, st.sector); } return seen.size ? [...seen.values()].sort((a, b) => a.localeCompare(b, 'pt-BR')) : SECTORS; };
  const PRIORITY = { alta: 'Alta', normal: 'Normal', baixa: 'Baixa' };
  const STATUS = { open: 'Aberta', done: 'Concluída', cancelled: 'Cancelada' };
  const VIEW_LABEL = { inbox: 'Minha caixa', sector: 'Do meu setor', sent: 'Enviadas por mim', all: 'Todas' };
  const EVENT_LABEL = { created: 'Tarefa criada', advanced: 'Repassada', returned: 'Devolvida', completed: 'Concluída', cancelled: 'Cancelada', comment: 'Comentário' };

  let tasks = [], clients = [], templates = [], ready = false, channel = null, timer = null, lastLoad = 0, generation = 0;
  let detail = null, detailEvents = [];
  const filters = { view: 'inbox', status: 'open', term: '', priority: '', sector: '', onlyLate: false };
  const client = () => window.conectaTasksApi?.client();
  const ctx = () => {
    const p = window.conectaCurrentProfile || {}, u = window.conectaCurrentUser || {};
    return { userId: u.id, sector: p.sector || '', admin: p.role === 'admin' && p.active !== false };
  };
  const clientsById = () => new Map(clients.map(c => [c.id, c]));
  const visible = () => document.getElementById('crumb')?.textContent === 'Tarefas';
  const toast = text => typeof showToast === 'function' ? showToast(text) : undefined;

  const nav = document.createElement('button');
  nav.type = 'button'; nav.dataset.view = 'Tarefas';
  nav.innerHTML = '<span class="ico" aria-hidden="true">☑</span> Tarefas <span class="count" id="taskNavCount">0</span>';
  (document.querySelector('.nav [data-view="Lembretes"]') || document.querySelector('.nav button:last-child'))?.after(nav);
  const paintNav = () => { const el = document.getElementById('taskNavCount'); if (el) el.textContent = String(ready ? flow.inboxCount(tasks, ctx()) : 0); };

  async function load() {
    const api = client(); if (!api || !window.conectaCurrentUser) return;
    const mine = ++generation;
    const [t, c, m] = await Promise.all([
      api.from('tasks').select('*').order('updated_at', { ascending: false }).limit(500),
      api.from('task_clients').select('id,name,document,active').order('name'),
      api.from('task_templates').select('id,name,steps,active').order('name')
    ]);
    if (mine !== generation) return;
    if (t.error || c.error || m.error) { console.warn('Tarefas: falha ao carregar', t.error || c.error || m.error); return; }
    tasks = t.data; clients = c.data; templates = m.data; ready = true; lastLoad = Date.now();
    if (detail) { detail = tasks.find(x => x.id === detail.id) || null; if (!detail) closeDetail(); }
    paintNav(); if (visible()) paintList();
    if (detail) paintDetail();
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => void load().catch(e => console.warn(e)), 250); };
  function start() {
    stop(); const api = client(); if (!api) return;
    channel = api.channel('tasks-live');
    for (const table of ['tasks', 'task_clients', 'task_templates']) channel.on('postgres_changes', { event: '*', schema: 'public', table }, schedule);
    channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'task_events' }, payload => {
      if (detail && payload.new?.task_id === detail.id) void loadEvents();
    });
    channel.subscribe(status => { if (status === 'SUBSCRIBED') schedule(); });
    void load().catch(e => console.warn(e));
  }
  function stop() {
    clearTimeout(timer); generation++;
    if (channel) { client()?.removeChannel(channel); channel = null; }
  }
  function reset() { stop(); tasks = []; clients = []; templates = []; ready = false; detail = null; detailEvents = []; closeDialogs(); paintNav(); if (visible()) paintList(); }

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

  function newTaskDialog() {
    const active = templates.filter(t => t.active);
    if (!active.length) { toast(ctx().admin ? 'Cadastre um modelo de fluxo antes de criar tarefas.' : 'Nenhum modelo de fluxo cadastrado. Peça a um administrador.'); if (ctx().admin) templatesDialog(); return; }
    const clientOptions = clients.filter(c => c.active).map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    const d = openDialog(`<h2>Nova tarefa</h2><form novalidate>
      <div class="field"><label for="ntClient">Cliente</label><div class="tasks-inline"><select id="ntClient" required><option value="">Selecione…</option>${clientOptions}</select><button class="secondary" type="button" id="ntNewClient">Novo cliente</button></div></div>
      <div class="field tasks-hidden" id="ntClientBox"><label for="ntClientName">Nome do novo cliente</label><input id="ntClientName" maxlength="160"><label for="ntClientDoc">CNPJ/CPF (opcional)</label><input id="ntClientDoc" maxlength="30"></div>
      <div class="field"><label for="ntTemplate">Fluxo</label><select id="ntTemplate">${active.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select><small id="ntSteps"></small></div>
      <div class="field"><label for="ntTitle">Título</label><input id="ntTitle" maxlength="160" placeholder="Ex.: Abertura de filial — competência 11/2026"></div>
      <div class="field"><label for="ntDesc">Descrição (opcional)</label><textarea id="ntDesc" rows="3" maxlength="4000"></textarea></div>
      <div class="tasks-inline"><div class="field"><label for="ntDue">Prazo (opcional)</label><input id="ntDue" type="date"></div>
      <div class="field"><label for="ntPriority">Prioridade</label><select id="ntPriority"><option value="normal">Normal</option><option value="alta">Alta</option><option value="baixa">Baixa</option></select></div></div>
      <p class="tasks-error" role="alert"></p>
      <div class="modal-actions"><button class="secondary" type="button" data-close>Cancelar</button><button class="primary" type="submit">Criar tarefa</button></div></form>`);
    const $ = id => d.querySelector('#' + id);
    const showSteps = () => { const t = templates.find(x => x.id === $('ntTemplate').value); $('ntSteps').textContent = t ? t.steps.map(s => s.sector).join(' → ') : ''; };
    $('ntTemplate').onchange = showSteps; showSteps();
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
        if (!clientId) throw { message: 'Selecione ou cadastre o cliente.' };
        if ($('ntTitle').value.trim().length < 3) throw { message: 'Informe um título com pelo menos 3 caracteres.' };
        check(await api.rpc('task_create', { p_client: clientId, p_template: $('ntTemplate').value, p_title: $('ntTitle').value, p_description: $('ntDesc').value, p_priority: $('ntPriority').value, p_due: $('ntDue').value || null }));
        d.close(); toast('Tarefa criada.'); await load();
      });
    };
  }

  const stepTrack = task => (task.steps || []).map((s, i) => {
    const cls = task.status === 'done' || i < task.current_step ? 'done' : i === task.current_step && task.status === 'open' ? 'current' : '';
    return `<li class="${cls}"><strong>${esc(s.sector)}</strong>${s.label ? `<small>${esc(s.label)}</small>` : ''}</li>`;
  }).join('');

  function openDetail(id) {
    detail = tasks.find(t => t.id === id); if (!detail) return; detailEvents = [];
    const d = openDialog('<div class="tasks-detail"></div>', true);
    d.addEventListener('close', () => { detail = null; });
    d.dataset.detail = '1'; paintDetail(); void loadEvents();
  }
  function closeDetail() { document.querySelector('dialog[data-detail]')?.close(); }
  async function loadEvents() {
    if (!detail) return; const id = detail.id;
    const { data, error } = await client().from('task_events').select('id,kind,from_step,to_step,note,actor_name,created_at').eq('task_id', id).order('id');
    if (error || !detail || detail.id !== id) return; detailEvents = data; paintDetail();
  }
  function paintDetail() {
    const host = document.querySelector('dialog[data-detail] .tasks-detail'); if (!host || !detail) return;
    const task = detail, c = ctx(), allow = flow.can(task, c), p = flow.progress(task), cl = clientsById().get(task.client_id);
    const late = flow.dueState(task, today());
    const typed = host.querySelector('#tdNote')?.value || '';
    host.innerHTML = `<div class="tasks-head"><div><h2>${esc(task.title)}</h2><p>${esc(cl?.name || 'Cliente')} · ${esc(task.template_name)}</p></div><button class="text-btn" type="button" data-close-detail aria-label="Fechar">✕</button></div>
      <div class="tasks-meta"><span class="tasks-pill status-${esc(task.status)}">${STATUS[task.status]}</span><span class="tasks-pill prio-${esc(task.priority)}">Prioridade ${PRIORITY[task.priority]}</span>${task.due_date ? `<span class="tasks-pill due-${late}">Prazo ${fmtDate(task.due_date)}${late === 'late' ? ' · atrasada' : late === 'today' ? ' · hoje' : ''}</span>` : ''}</div>
      ${task.description ? `<p class="tasks-desc">${esc(task.description)}</p>` : ''}
      <ol class="tasks-track">${stepTrack(task)}</ol>
      <h3>Histórico</h3><ul class="tasks-events">${detailEvents.map(e => `<li class="ev-${esc(e.kind)}"><strong>${EVENT_LABEL[e.kind]}</strong>${e.kind === 'advanced' ? ` → ${esc(task.steps[e.to_step]?.sector || '')}` : e.kind === 'returned' ? ` → ${esc(task.steps[e.to_step]?.sector || '')}` : ''}<small>${esc(e.actor_name || 'Colaborador')} · ${fmtTime(e.created_at)}</small>${e.note ? `<p>${esc(e.note)}</p>` : ''}</li>`).join('') || '<li><small>Carregando…</small></li>'}</ul>
      <div class="field"><label for="tdNote">Observação ${task.status === 'open' ? '(obrigatória para devolver ou cancelar)' : ''}</label><textarea id="tdNote" rows="2" maxlength="2000"></textarea></div>
      <p class="tasks-error" role="alert"></p>
      <div class="modal-actions tasks-actions"><button class="secondary" type="button" data-act="comment">Comentar</button>${allow.cancel ? '<button class="secondary danger" type="button" data-act="cancel">Cancelar tarefa</button>' : ''}${allow.return ? '<button class="secondary" type="button" data-act="return">Devolver</button>' : ''}${allow.advance ? `<button class="primary" type="button" data-act="advance">${p.index + 1 >= p.total ? 'Concluir tarefa' : 'Repassar para ' + esc(task.steps[p.index + 1]?.sector || '')}</button>` : ''}</div>
      ${task.status === 'open' && !allow.advance ? `<p class="tasks-wait">Aguardando o setor ${esc(p.sector)}.</p>` : ''}`;
    host.querySelector('#tdNote').value = typed;
    host.querySelector('[data-close-detail]').onclick = closeDetail;
    const error = host.querySelector('.tasks-error');
    host.querySelectorAll('[data-act]').forEach(button => {
      button.onclick = () => void guarded(button, error, async () => {
        const note = host.querySelector('#tdNote').value, api = client(), v = task.version;
        const act = button.dataset.act;
        if (act === 'comment') check(await api.rpc('task_comment', { p_task: task.id, p_note: note }));
        if (act === 'advance') check(await api.rpc('task_advance', { p_task: task.id, p_version: v, p_note: note }));
        if (act === 'return') check(await api.rpc('task_return', { p_task: task.id, p_version: v, p_note: note }));
        if (act === 'cancel' && !confirm('Cancelar esta tarefa? A ação não pode ser desfeita.')) return;
        if (act === 'cancel') check(await api.rpc('task_cancel', { p_task: task.id, p_version: v, p_note: note }));
        host.querySelector('#tdNote').value = '';
        toast(act === 'comment' ? 'Comentário registrado.' : 'Tarefa atualizada.');
        await load(); await loadEvents();
      }).catch(() => {}).then(() => { if (error.textContent.includes('alterada por outra pessoa')) void load(); });
    });
  }

  function templatesDialog() {
    const d = openDialog('<div class="tasks-detail"></div>', true);
    const paint = (editing) => {
      const host = d.querySelector('.tasks-detail');
      const item = editing && templates.find(t => t.id === editing);
      host.innerHTML = `<div class="tasks-head"><div><h2>Modelos de fluxo</h2><p>Cada modelo define a sequência de setores de uma atividade.</p></div><button class="text-btn" type="button" data-close aria-label="Fechar">✕</button></div>
        <ul class="tasks-templates">${templates.map(t => `<li><div><strong>${esc(t.name)}</strong>${t.active ? '' : ' <small>(inativo)</small>'}<small>${esc(t.steps.map(s => s.sector).join(' → '))}</small></div><button class="text-btn" type="button" data-edit="${esc(t.id)}">Editar</button></li>`).join('') || '<li><small>Nenhum modelo cadastrado.</small></li>'}</ul>
        <form novalidate><h3>${item ? 'Editar modelo' : 'Novo modelo'}</h3>
        <div class="field"><label for="tmName">Nome da atividade</label><input id="tmName" maxlength="120" value="${esc(item?.name || '')}"></div>
        <div class="field"><label for="tmSteps">Etapas, uma por linha: setor | descrição opcional</label><textarea id="tmSteps" rows="5" placeholder="Dpto. Fiscal | Apurar impostos\nDpto. Contábil | Fechamento">${esc(item ? flow.stepsToText(item.steps) : '')}</textarea><small>Setores usuais: ${SECTORS.join(', ')}. O nome precisa ser igual ao setor cadastrado no perfil dos colaboradores. Tarefas já criadas mantêm a sequência original.</small></div>
        ${item ? `<label class="tasks-check"><input id="tmActive" type="checkbox" ${item.active ? 'checked' : ''}> Modelo ativo</label>` : ''}
        <p class="tasks-error" role="alert"></p>
        <div class="modal-actions">${item ? '<button class="secondary" type="button" data-new>Novo modelo</button>' : ''}<button class="primary" type="submit">${item ? 'Salvar alterações' : 'Criar modelo'}</button></div></form>`;
      host.querySelector('[data-close]').onclick = () => d.close();
      host.querySelectorAll('[data-edit]').forEach(b => { b.onclick = () => paint(b.dataset.edit); });
      host.querySelector('[data-new]')?.addEventListener('click', () => paint(null));
      const error = host.querySelector('.tasks-error');
      host.querySelector('form').onsubmit = async event => {
        event.preventDefault();
        await guarded(host.querySelector('[type=submit]'), error, async () => {
          const steps = flow.parseSteps(host.querySelector('#tmSteps').value), name = host.querySelector('#tmName').value.trim();
          if (name.length < 2) throw { message: 'Informe o nome do modelo.' };
          if (!steps.length) throw { message: 'Informe ao menos uma etapa.' };
          const api = client();
          if (item) check(await api.from('task_templates').update({ name, steps, active: host.querySelector('#tmActive').checked, updated_at: new Date().toISOString() }).eq('id', item.id));
          else check(await api.from('task_templates').insert({ name, steps }));
          await load(); toast('Modelo salvo.'); paint(null);
        });
      };
    };
    paint(null);
  }

  // ---------- lista ----------
  function renderTasks() {
    const c = ctx(), views = flow.VIEWS.filter(v => v !== 'all' || c.admin);
    if (!views.includes(filters.view)) filters.view = 'inbox';
    document.getElementById('viewPanel').innerHTML = `<div class="view-toolbar"><div><h2>Tarefas entre setores</h2><p>Acompanhe o fluxo de cada cliente, de etapa em etapa.</p></div><div class="tasks-toolbar-actions">${c.admin ? '<button class="secondary" type="button" id="taskTemplatesBtn">Modelos de fluxo</button>' : ''}<button class="primary" type="button" id="taskNewBtn">+ Nova tarefa</button></div></div>
      <div class="tasks-tabs" role="tablist">${views.map(v => `<button type="button" role="tab" data-tview="${v}" aria-selected="${filters.view === v}">${VIEW_LABEL[v]} <span class="count" data-tcount="${v}"></span></button>`).join('')}</div>
      <div class="tasks-filters"><div class="field"><label for="tfTerm">Pesquisar</label><input id="tfTerm" type="search" placeholder="Cliente, título ou fluxo" value="${esc(filters.term)}"></div>
      <div class="field"><label for="tfStatus">Situação</label><select id="tfStatus"><option value="">Todas</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div class="field"><label for="tfSector">Etapa atual</label><select id="tfSector"><option value="">Todos os setores</option>${usedSectors().map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select></div>
      <div class="field"><label for="tfPriority">Prioridade</label><select id="tfPriority"><option value="">Todas</option>${Object.entries(PRIORITY).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <label class="tasks-check"><input id="tfLate" type="checkbox"> Só atrasadas</label></div>
      <div class="tasks-list" id="taskList" aria-live="polite"></div>`;
    const $ = id => document.getElementById(id);
    $('tfStatus').value = filters.status; $('tfSector').value = filters.sector; $('tfPriority').value = filters.priority; $('tfLate').checked = filters.onlyLate;
    $('taskNewBtn').onclick = newTaskDialog; $('taskTemplatesBtn') && ($('taskTemplatesBtn').onclick = templatesDialog);
    document.querySelectorAll('[data-tview]').forEach(b => { b.onclick = () => { filters.view = b.dataset.tview; document.querySelectorAll('[data-tview]').forEach(x => x.setAttribute('aria-selected', String(x === b))); paintList(); }; });
    const bind = (id, key, prop = 'value') => { $(id).oninput = $(id).onchange = () => { filters[key] = $(id)[prop]; paintList(); }; };
    bind('tfTerm', 'term'); bind('tfStatus', 'status'); bind('tfSector', 'sector'); bind('tfPriority', 'priority'); bind('tfLate', 'onlyLate', 'checked');
    paintList();
  }
  function paintList() {
    const host = document.getElementById('taskList'); if (!host || !visible()) return;
    const c = ctx(), map = clientsById(), t = today();
    const sectorSelect = document.getElementById('tfSector'), sectorOptions = '<option value="">Todos os setores</option>' + usedSectors().map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    if (sectorSelect && sectorSelect.innerHTML !== sectorOptions) { sectorSelect.innerHTML = sectorOptions; sectorSelect.value = [...sectorSelect.options].some(o => flow.sectorKey(o.value) === flow.sectorKey(filters.sector)) ? [...sectorSelect.options].find(o => flow.sectorKey(o.value) === flow.sectorKey(filters.sector)).value : ''; }
    document.querySelectorAll('[data-tcount]').forEach(el => { const v = el.dataset.tcount; el.textContent = String(tasks.filter(x => flow.isOpen(x) && flow.filterTasks([x], { view: v }, c, map, t).length).length); });
    const rows = flow.filterTasks(tasks, filters, c, map, t);
    if (!ready) { host.innerHTML = '<div class="empty">Carregando tarefas…</div>'; return; }
    if (!rows.length) { host.innerHTML = `<div class="empty">${tasks.length ? 'Nenhuma tarefa encontrada com estes filtros.' : 'Nenhuma tarefa ainda. Use “+ Nova tarefa” para iniciar um fluxo.'}</div>`; return; }
    host.innerHTML = rows.map(task => {
      const p = flow.progress(task), late = flow.dueState(task, t), mine = flow.isMyTurn(task, c);
      return `<button type="button" class="card tasks-item${mine ? ' mine' : ''}" data-task="${esc(task.id)}"><div class="tasks-item-main"><strong>${esc(map.get(task.client_id)?.name || 'Cliente')}</strong><span>${esc(task.title)}</span><small>${esc(task.template_name)}</small></div>
        <div class="tasks-item-side"><span class="tasks-pill status-${esc(task.status)}">${task.status === 'open' ? `Etapa ${p.index + 1}/${p.total} · ${esc(p.sector)}` : STATUS[task.status]}</span>${task.priority === 'alta' && flow.isOpen(task) ? '<span class="tasks-pill prio-alta">Alta</span>' : ''}${task.due_date && flow.isOpen(task) ? `<span class="tasks-pill due-${late}">${fmtDate(task.due_date)}${late === 'late' ? ' · atrasada' : ''}</span>` : ''}</div></button>`;
    }).join('');
    host.querySelectorAll('[data-task]').forEach(b => { b.onclick = () => openDetail(b.dataset.task); });
  }

  const previous = renderView;
  renderView = window.renderView = view => { previous(view); if (view === 'Tarefas') renderTasks(); };
  nav.onclick = () => { document.querySelectorAll('.nav button,.channel').forEach(b => b.classList.toggle('active', b === nav)); renderView('Tarefas'); if (ready && Date.now() - lastLoad > 60_000) schedule(); };
  window.addEventListener('conecta-profile-ready', () => { if (window.conectaCurrentProfile?.active !== false) start(); });
  window.addEventListener('conecta-auth-session-reset', reset);
  window.addEventListener('focus', () => { if (ready && Date.now() - lastLoad > 60_000) schedule(); });
  if (window.conectaCurrentUser && window.conectaCurrentProfile) start();
})();
