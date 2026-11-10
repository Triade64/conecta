(function (root) {
  // Lógica pura do fluxo de tarefas: sem DOM e sem rede, para ser testada em Node.
  // As regras definitivas ficam no banco (supabase/tasks.sql); aqui só decidimos
  // o que mostrar e quais botões habilitar.
  const FROM = 'áàâãäéèêëíìîïóòôõöúùûüç', TO = 'aaaaaeeeeiiiiooooouuuuc';
  const sectorKey = value => { const k = String(value ?? '').trim().toLowerCase().replace(/./g, c => { const i = FROM.indexOf(c); return i < 0 ? c : TO[i]; }).replace(/^(departamento|dpto|depto|dep)\.?\s*(de\s+)?/, '').trim(); return ['administrador', 'administracao', 'adm'].includes(k) ? 'administracao' : k; };
  // Setores oficiais: os mesmos que o cadastro de colaboradores grava a partir do papel.
  const SECTORS = ['Dpto. Fiscal', 'Dpto. Contábil', 'Dpto. Pessoal', 'Administrador'];
  const canonicalSector = value => SECTORS.find(s => sectorKey(s) === sectorKey(value)) || String(value ?? '').trim();
  const stepAt = (task, index) => (task.steps || [])[index] || null;
  const currentStep = task => stepAt(task, task.current_step);
  const progress = task => ({
    index: task.current_step, total: (task.steps || []).length,
    done: task.status === 'done', sector: currentStep(task)?.sector || '', label: currentStep(task)?.label || ''
  });
  const isOpen = task => task.status === 'open';
  const isMyTurn = (task, ctx) => isOpen(task) && sectorKey(currentStep(task)?.sector) === sectorKey(ctx.sector);
  // Mesmas regras das funções task_* do banco.
  const can = (task, ctx) => {
    const open = isOpen(task), turn = isMyTurn(task, ctx) || (open && !!ctx.admin);
    return {
      advance: turn,
      return: turn && task.current_step > 0,
      cancel: open && (task.created_by === ctx.userId || !!ctx.admin),
      comment: true,
      claim: turn && task.assigned_to !== ctx.userId,
      release: open && !!task.assigned_to && (task.assigned_to === ctx.userId || !!ctx.admin)
    };
  };
  // Prazo que vale agora: o da etapa atual; tarefas antigas sem prazo por etapa usam o da tarefa.
  const currentDue = task => currentStep(task)?.due_date || ((task.steps || []).some(s => s.due_date) ? '' : task.due_date || '');
  const dueState = (task, today) => {
    const due = currentDue(task);
    if (!due || !isOpen(task)) return 'none';
    if (due < today) return 'late';
    return due === today ? 'today' : 'ok';
  };
  // Mesmo cálculo de private.task_step_dates (banco). Datas em 'AAAA-MM-DD'.
  const iso = d => d.toISOString().slice(0, 10);
  const parse = s => new Date(s + 'T00:00:00Z');
  const dayInMonth = (base, day) => { const y = base.getUTCFullYear(), m = base.getUTCMonth(), last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); return new Date(Date.UTC(y, m, Math.min(day, last))); };
  const businessDay = (date, holidays) => { const d = new Date(date); while ([0, 6].includes(d.getUTCDay()) || holidays.has(iso(d))) d.setUTCDate(d.getUTCDate() + 1); return d; };
  const stepDates = (steps, start, holidays = new Set()) => {
    let prev = parse(start);
    return (steps || []).map(step => {
      const { due_date, ...rest } = step;
      const day = Number(step.due_day);
      if (!Number.isInteger(day) || day < 1 || day > 31) return rest;
      let raw = dayInMonth(prev, day);
      if (raw < prev) raw = dayInMonth(new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth() + 1, 1)), day);
      const due = businessDay(raw, holidays); prev = due;
      return { ...rest, due_date: iso(due) };
    });
  };
  const VIEWS = ['inbox', 'sector', 'sent', 'all'];
  const inView = (task, view, ctx) => {
    if (view === 'inbox') return isMyTurn(task, ctx);
    if (view === 'sector') return (task.sector_keys || []).includes(sectorKey(ctx.sector));
    if (view === 'sent') return task.created_by === ctx.userId;
    return !!ctx.admin;
  };
  const fold = text => sectorKey(text);
  // filters: { view, status: 'open'|'done'|'cancelled'|'', term, priority, sector, onlyLate }
  const filterTasks = (tasks, filters, ctx, clientsById, today) => {
    const term = fold(filters.term || '');
    const rows = tasks.filter(task => {
      if (!inView(task, filters.view || 'inbox', ctx)) return false;
      if (filters.status && task.status !== filters.status) return false;
      if (filters.priority && task.priority !== filters.priority) return false;
      if (filters.sector && sectorKey(currentStep(task)?.sector) !== sectorKey(filters.sector)) return false;
      if (filters.onlyLate && dueState(task, today) !== 'late') return false;
      if (term) {
        const hay = fold([task.title, task.description, task.template_name, clientsById?.get(task.client_id)?.name].join(' '));
        if (!hay.includes(term)) return false;
      }
      return true;
    });
    const weight = { alta: 0, normal: 1, baixa: 2 };
    return rows.sort((a, b) =>
      (currentDue(a) || '9999-12-31').localeCompare(currentDue(b) || '9999-12-31') ||
      (weight[a.priority] - weight[b.priority]) ||
      String(b.updated_at).localeCompare(String(a.updated_at)));
  };
  // Tarefas que acabaram de chegar à vez do setor do usuário, por ação de outra pessoa
  // (ou da recorrência automática). prev = lista anterior; null na primeira carga.
  const arrivals = (prev, next, ctx) => {
    if (!prev) return [];
    const before = new Map(prev.map(t => [t.id, t]));
    return next.filter(t => {
      if (!isMyTurn(t, ctx) || (t.updated_by && t.updated_by === ctx.userId)) return false;
      const old = before.get(t.id);
      return !old || !isMyTurn(old, ctx);
    });
  };
  // Resumo para o painel: caixa do setor, atrasadas e que vencem hoje.
  const summary = (tasks, ctx, today) => {
    const inbox = tasks.filter(t => isMyTurn(t, ctx));
    return { inbox: inbox.length, late: inbox.filter(t => dueState(t, today) === 'late').length, today: inbox.filter(t => dueState(t, today) === 'today').length, mine: inbox.filter(t => t.assigned_to === ctx.userId).length };
  };
  const inboxCount = (tasks, ctx) => tasks.filter(task => isMyTurn(task, ctx)).length;
  // Normaliza a lista digitada no editor de modelos: "Setor | descrição opcional", um por linha.
  const parseSteps = text => String(text || '').split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const [sector, ...rest] = line.split('|');
    return { sector: sector.trim(), label: rest.join('|').trim() };
  });
  const stepsToText = steps => (steps || []).map(s => s.label ? s.sector + ' | ' + s.label : s.sector).join('\n');
  const ERRORS = {
    task_forbidden: 'Você não tem permissão para esta ação.',
    task_not_found: 'Tarefa não encontrada ou sem acesso.',
    task_closed: 'Esta tarefa já foi encerrada.',
    task_version_conflict: 'A tarefa foi alterada por outra pessoa. Os dados foram atualizados; confira e tente novamente.',
    task_wrong_sector: 'Somente o setor da etapa atual pode movimentar esta tarefa.',
    task_first_step: 'A tarefa já está na primeira etapa.',
    task_note_required: 'Informe um motivo ou texto.',
    task_template_unavailable: 'O modelo de fluxo não está disponível.',
    task_client_unavailable: 'O cliente não está disponível.',
    task_not_assigned: 'Esta tarefa não tem responsável.',
    task_already_yours: 'Você já é o responsável por esta tarefa.'
  };
  const errorMessage = error => {
    if (error?.userMessage) return error.userMessage;
    const text = String(error?.message || '');
    const code = Object.keys(ERRORS).find(key => text.includes(key));
    if (code) return ERRORS[code];
    if (/duplicate key|unique/i.test(text)) return 'Já existe um registro com esse nome.';
    return 'Não foi possível concluir a ação. Tente novamente.';
  };
  const api = { currentDue, stepDates, arrivals, summary, SECTORS, canonicalSector, sectorKey, currentStep, progress, isOpen, isMyTurn, can, dueState, filterTasks, inboxCount, parseSteps, stepsToText, errorMessage, VIEWS };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.conectaTasksFlow = api;
})(globalThis);
