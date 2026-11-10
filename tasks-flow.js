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
      setCompleted: task.status === 'done' && (task.created_by === ctx.userId || !!ctx.admin),
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
  // Competência 'AAAA-MM': mês anterior a uma data 'AAAA-MM-DD' e formato de exibição MM/AAAA.
  const previousMonth = day => { const [y, m] = day.split('-').map(Number); return m === 1 ? (y - 1) + '-12' : y + '-' + String(m - 1).padStart(2, '0'); };
  // Início da contagem dos prazos: 1º dia do mês seguinte à competência, ou hoje (igual a private.task_deadline_start).
  const deadlineStart = (comp, today) => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(comp || '')) return today;
    const [y, m] = comp.split('-').map(Number);
    return m === 12 ? (y + 1) + '-01-01' : y + '-' + String(m + 1).padStart(2, '0') + '-01';
  };
  // Data (AAAA-MM-DD) de um instante no horário de Brasília.
  const officeDate = ts => ts ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date(ts)) : '';
  const fmtCompetence = comp => comp ? comp.slice(5, 7) + '/' + comp.slice(0, 4) : '';
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
  const reachedSector = (task, ctx) => {
    const key = sectorKey(ctx.sector), last = task.status === 'done' ? (task.steps || []).length - 1 : task.current_step;
    return (task.steps || []).some((s, i) => i <= last && sectorKey(s.sector) === key);
  };
  const VIEWS = ['inbox', 'sector', 'sent', 'all'];
  const inView = (task, view, ctx) => {
    // Minha caixa: só tarefas abertas que eu assumi. "turn" (uso interno): na vez do meu setor.
    if (view === 'inbox') return isOpen(task) && !!ctx.userId && task.assigned_to === ctx.userId;
    if (view === 'turn') return isMyTurn(task, ctx);
    // Só tarefas que já chegaram ao setor: etapa atual dele ou etapas dele já percorridas.
    if (view === 'sector') return reachedSector(task, ctx);
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
      if (filters.competence && (filters.competence === '-' ? !!task.competence : task.competence !== filters.competence)) return false;
      if (filters.sector && sectorKey(currentStep(task)?.sector) !== sectorKey(filters.sector)) return false;
      if (filters.onlyLate && dueState(task, today) !== 'late') return false;
      if (term) {
        const hay = fold([task.title, task.description, task.template_name, clientsById?.get(task.client_id)?.name, fmtCompetence(task.competence)].join(' '));
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
  // Tarefas na vez do usuário cujo prazo da etapa vence hoje ou até o próximo dia útil.
  // Com responsável, só ele é avisado; sem responsável, todo o setor.
  const dueSoon = (tasks, ctx, today, holidays = new Set()) => {
    const next = parse(today); next.setUTCDate(next.getUTCDate() + 1);
    const limit = iso(businessDay(next, holidays));
    return tasks.filter(t => {
      if (!isMyTurn(t, ctx) || (t.assigned_to && t.assigned_to !== ctx.userId)) return false;
      const due = currentDue(t);
      return !!due && due >= today && due <= limit;
    });
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
    task_competence_invalid: 'Informe a competência no formato mês/ano.',
    task_not_done: 'Só é possível alterar a data de tarefas concluídas.',
    task_completion_date_invalid: 'A data de conclusão não pode ser futura nem anterior à criação da tarefa.',
    task_step_done_date_invalid: 'A data da etapa não pode ser futura nem anterior à criação da tarefa.',
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
  const api = { dueSoon, officeDate, deadlineStart, previousMonth, fmtCompetence, currentDue, stepDates, arrivals, summary, SECTORS, canonicalSector, sectorKey, currentStep, progress, isOpen, isMyTurn, can, dueState, filterTasks, inboxCount, parseSteps, stepsToText, errorMessage, VIEWS };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.conectaTasksFlow = api;
})(globalThis);
