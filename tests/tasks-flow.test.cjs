const { test } = require('node:test');
const assert = require('node:assert/strict');
const flow = require('../tasks-flow.js');

const steps = [{ sector: 'Atendimento' }, { sector: 'Fiscal' }, { sector: 'Contábil' }];
const mk = (over = {}) => ({
  id: 't', client_id: 'c1', title: 'Abertura', description: '', template_name: 'Abertura de empresa', priority: 'normal',
  due_date: null, steps, current_step: 0, status: 'open', sector_keys: ['atendimento', 'fiscal', 'contabil'],
  created_by: 'u-atend', updated_at: '2026-11-09T10:00:00Z', ...over
});
const atend = { userId: 'u-atend', sector: 'Atendimento', admin: false };
const fiscal = { userId: 'u-fiscal', sector: 'fiscal ', admin: false };
const admin = { userId: 'u-admin', sector: 'Administração', admin: true };

test('sectorKey ignora acentos, caixa e espaços', () => {
  assert.equal(flow.sectorKey('  Contábil '), 'contabil');
  assert.equal(flow.sectorKey('Departamento Pessoal'), 'pessoal');
  assert.equal(flow.sectorKey(null), '');
});

test('sectorKey trata Dpto./Departamento e Administrador como o mesmo setor', () => {
  for (const s of ['Dpto. Contábil', 'Depto Contabil', 'Departamento Contábil', 'Departamento de Contábil', 'contábil']) assert.equal(flow.sectorKey(s), 'contabil');
  assert.equal(flow.sectorKey('Dpto. Pessoal'), flow.sectorKey('Departamento Pessoal'));
  assert.equal(flow.sectorKey('Administrador'), flow.sectorKey('Administração'));
  assert.equal(flow.sectorKey('Atendimento'), 'atendimento');
});

test('apenas o setor da etapa atual pode repassar; admin sempre pode', () => {
  const task = mk();
  assert.equal(flow.can(task, atend).advance, true);
  assert.equal(flow.can(task, fiscal).advance, false);
  assert.equal(flow.can(task, admin).advance, true);
});

test('devolver exige não estar na primeira etapa', () => {
  assert.equal(flow.can(mk(), atend).return, false);
  assert.equal(flow.can(mk({ current_step: 1 }), fiscal).return, true);
});

test('cancelar é do criador ou admin, e só em tarefas abertas', () => {
  assert.equal(flow.can(mk(), atend).cancel, true);
  assert.equal(flow.can(mk(), fiscal).cancel, false);
  assert.equal(flow.can(mk(), admin).cancel, true);
  const closed = flow.can(mk({ status: 'done' }), admin);
  assert.deepEqual([closed.advance, closed.return, closed.cancel], [false, false, false]);
});

test('visões: caixa, setor, enviadas e todas', () => {
  const tasks = [mk({ id: 'a' }), mk({ id: 'b', current_step: 1 }), mk({ id: 'c', created_by: 'x', current_step: 2, sector_keys: ['contabil'] })];
  const ids = (view, ctx) => flow.filterTasks(tasks, { view, status: 'open' }, ctx, new Map(), '2026-11-09').map(t => t.id).sort();
  assert.deepEqual(ids('inbox', atend), []);               // ninguém assumiu
  assert.deepEqual(ids('turn', atend), ['a']);
  assert.deepEqual(ids('turn', fiscal), ['b']);
  assert.deepEqual(ids('sector', fiscal), ['b', 'c']);    // 'a' ainda não chegou ao Fiscal; 'c' já passou
  assert.deepEqual(ids('sector', atend), ['a', 'b', 'c']); // 'b' e 'c' já passaram pelo Atendimento
  assert.deepEqual(ids('sent', atend), ['a', 'b']);
  assert.deepEqual(ids('all', fiscal), []);
  assert.deepEqual(ids('all', admin), ['a', 'b', 'c']);
});

test('filtros por cliente, prioridade, atraso e situação; ordenação por prazo', () => {
  const clients = new Map([['c1', { name: 'Padaria São João' }], ['c2', { name: 'Oficina Ágil' }]]);
  const tasks = [
    mk({ id: 'a', due_date: '2026-11-20' }),
    mk({ id: 'b', client_id: 'c2', due_date: '2026-11-01', priority: 'alta' }),
    mk({ id: 'c', status: 'done' })
  ];
  const run = f => flow.filterTasks(tasks, { view: 'sent', ...f }, atend, clients, '2026-11-09').map(t => t.id);
  assert.deepEqual(run({ status: 'open' }), ['b', 'a']);
  assert.deepEqual(run({ term: 'sao joao' }), ['a', 'c']);
  assert.deepEqual(run({ status: 'open', onlyLate: true }), ['b']);
  assert.deepEqual(run({ priority: 'alta' }), ['b']);
  assert.deepEqual(run({ status: 'done' }), ['c']);
});

test('dueState e progresso', () => {
  assert.equal(flow.dueState(mk({ due_date: '2026-11-08' }), '2026-11-09'), 'late');
  assert.equal(flow.dueState(mk({ due_date: '2026-11-09' }), '2026-11-09'), 'today');
  assert.equal(flow.dueState(mk({ due_date: '2026-11-10' }), '2026-11-09'), 'ok');
  assert.equal(flow.dueState(mk({ due_date: '2026-01-01', status: 'done' }), '2026-11-09'), 'none');
  assert.deepEqual(flow.progress(mk({ current_step: 2 })), { index: 2, total: 3, done: false, sector: 'Contábil', label: '' });
});

test('parseSteps e stepsToText são inversos e ignoram linhas vazias', () => {
  const parsed = flow.parseSteps('Atendimento | Coletar documentos\n\n  Fiscal  \nContábil | A | B');
  assert.deepEqual(parsed, [
    { sector: 'Atendimento', label: 'Coletar documentos' }, { sector: 'Fiscal', label: '' }, { sector: 'Contábil', label: 'A | B' }
  ]);
  assert.deepEqual(flow.parseSteps(flow.stepsToText(parsed)), parsed);
});

test('mensagens de erro traduzem os códigos do banco', () => {
  assert.match(flow.errorMessage({ message: 'task_version_conflict' }), /outra pessoa/);
  assert.match(flow.errorMessage({ message: 'xx task_wrong_sector yy' }), /setor da etapa atual/);
  assert.match(flow.errorMessage({ message: 'duplicate key value violates unique constraint' }), /Já existe/);
  assert.match(flow.errorMessage({ message: 'boom' }), /Não foi possível/);
});

test('contagem da caixa considera só tarefas abertas na vez do setor', () => {
  const tasks = [mk(), mk({ current_step: 1 }), mk({ status: 'done' })];
  assert.equal(flow.inboxCount(tasks, atend), 1);
  assert.equal(flow.inboxCount(tasks, fiscal), 1);
});

test('canonicalSector converte variações para o nome oficial e preserva os demais', () => {
  assert.equal(flow.canonicalSector('Fiscal'), 'Dpto. Fiscal');
  assert.equal(flow.canonicalSector('Departamento Contábil'), 'Dpto. Contábil');
  assert.equal(flow.canonicalSector('dpto pessoal'), 'Dpto. Pessoal');
  assert.equal(flow.canonicalSector('Administração'), 'Administrador');
  assert.equal(flow.canonicalSector(' Atendimento '), 'Atendimento');
});

test('assumir: setor da vez ou admin; liberar: responsável ou admin', () => {
  const ctxF = { userId: 'u-fiscal', sector: 'Dpto. Fiscal', admin: false };
  const t = mk({ current_step: 1 });
  assert.equal(flow.can(t, ctxF).claim, true);
  assert.equal(flow.can(t, atend).claim, false);
  const mineTask = mk({ current_step: 1, assigned_to: 'u-fiscal' });
  assert.equal(flow.can(mineTask, ctxF).claim, false);
  assert.equal(flow.can(mineTask, ctxF).release, true);
  assert.equal(flow.can(mk({ current_step: 1, assigned_to: 'outro' }), ctxF).release, false);
  assert.equal(flow.can(mk({ current_step: 1, assigned_to: 'outro' }), admin).release, true);
  assert.equal(flow.can(mk({ assigned_to: 'u-atend', status: 'done' }), atend).release, false);
});

test('arrivals: avisa só quando a tarefa chega ao setor por outra pessoa', () => {
  const ctxF = { userId: 'u-fiscal', sector: 'Fiscal', admin: false };
  const before = [mk({ id: 'a' }), mk({ id: 'b', current_step: 1 })];
  const after = [
    mk({ id: 'a', current_step: 1, updated_by: 'u-atend' }),
    mk({ id: 'b', current_step: 1, updated_by: 'u-atend' }),
    mk({ id: 'c', current_step: 1, updated_by: null }),
    mk({ id: 'd', current_step: 1, updated_by: 'u-fiscal' })
  ];
  assert.deepEqual(flow.arrivals(before, after, ctxF).map(t => t.id), ['a', 'c']);
  assert.deepEqual(flow.arrivals(null, after, ctxF), []);
});

test('summary conta caixa, atrasadas, hoje e comigo', () => {
  const tasks = [
    mk({ id: 'a', due_date: '2026-11-01' }),
    mk({ id: 'b', due_date: '2026-11-09', assigned_to: 'u-atend' }),
    mk({ id: 'c' }),
    mk({ id: 'd', current_step: 1 })
  ];
  assert.deepEqual(flow.summary(tasks, atend, '2026-11-09'), { inbox: 3, late: 1, today: 1, mine: 1 });
});

test('mensagens de validação da tela aparecem como escritas', () => {
  assert.equal(flow.errorMessage({ userMessage: 'O dia precisa estar entre 1 e 28.' }), 'O dia precisa estar entre 1 e 28.');
});

test('stepDates: dia fixo por etapa, nunca antes da anterior, adiando fim de semana e feriado', () => {
  const holidays = new Set(['2026-11-20']);
  const steps = [{ sector: 'Dpto. Fiscal', due_day: 10 }, { sector: 'Dpto. Contábil', due_day: 5 }, { sector: 'Administrador' }, { sector: 'Dpto. Pessoal', due_day: 20 }];
  const out = flow.stepDates(steps, '2026-11-09', holidays);
  assert.equal(out[0].due_date, '2026-11-10');          // terça
  assert.equal(out[1].due_date, '2026-12-07');          // dia 5/12 é sábado → segunda 07/12
  assert.equal(out[2].due_date, undefined);             // etapa sem prazo
  assert.equal(out[3].due_date, '2026-12-21');          // 20/12 é domingo → 21/12
  assert.equal(flow.stepDates([{ sector: 'X', due_day: 20 }], '2026-11-09', holidays)[0].due_date, '2026-11-23'); // feriado sexta 20/11 → seg 23/11
  assert.equal(flow.stepDates([{ sector: 'X', due_day: 31 }], '2027-02-01')[0].due_date, '2027-03-01'); // 28/02/2027 é domingo → 01/03
  assert.equal(flow.stepDates([{ sector: 'X', due_day: 9 }], '2026-11-09')[0].due_date, '2026-11-09'); // o próprio dia vale
});

test('dueState usa o prazo da etapa atual', () => {
  const steps = [{ sector: 'Atendimento', due_date: '2026-11-05' }, { sector: 'Dpto. Fiscal', due_date: '2026-11-20' }];
  assert.equal(flow.dueState(mk({ steps, current_step: 0 }), '2026-11-09'), 'late');
  assert.equal(flow.dueState(mk({ steps, current_step: 1 }), '2026-11-09'), 'ok');
  assert.equal(flow.dueState(mk({ steps: [{ sector: 'A' }, { sector: 'B', due_date: '2026-11-01' }], due_date: '2026-11-01' }), '2026-11-09'), 'none');
});

test('competência: mês anterior, exibição e busca', () => {
  assert.equal(flow.previousMonth('2026-11-10'), '2026-10');
  assert.equal(flow.previousMonth('2027-01-05'), '2026-12');
  assert.equal(flow.fmtCompetence('2026-10'), '10/2026');
  assert.equal(flow.fmtCompetence(null), '');
  const tasks = [mk({ id: 'a', competence: '2026-10' }), mk({ id: 'b', competence: '2026-09' })];
  assert.deepEqual(flow.filterTasks(tasks, { view: 'sent', term: '10/2026' }, atend, new Map(), '2026-11-10').map(t => t.id), ['a']);
});

test('filtro por competência, incluindo "sem competência"', () => {
  const tasks = [mk({ id: 'a', competence: '2026-10' }), mk({ id: 'b', competence: '2026-09' }), mk({ id: 'c' })];
  const run = competence => flow.filterTasks(tasks, { view: 'sent', competence }, atend, new Map(), '2026-11-10').map(t => t.id).sort();
  assert.deepEqual(run('2026-10'), ['a']);
  assert.deepEqual(run('-'), ['c']);
  assert.deepEqual(run(''), ['a', 'b', 'c']);
});

test('"Do meu setor": aparece ao chegar, continua depois de passar, concluídas contam todas as etapas', () => {
  const contab = { userId: 'u-c', sector: 'Dpto. Contábil', admin: false };
  const run = (task, ctx) => flow.filterTasks([task], { view: 'sector' }, ctx, new Map(), '2026-11-10').length === 1;
  assert.equal(run(mk({ current_step: 1 }), contab), false);
  assert.equal(run(mk({ current_step: 2 }), contab), true);
  assert.equal(run(mk({ current_step: 2, status: 'done' }), contab), true);
  assert.equal(run(mk({ current_step: 0, status: 'cancelled' }), contab), false);
});

test('prazos contam do mês seguinte à competência', () => {
  assert.equal(flow.deadlineStart('2026-10', '2026-11-10'), '2026-11-01');
  assert.equal(flow.deadlineStart('2026-12', '2026-11-10'), '2027-01-01');
  assert.equal(flow.deadlineStart('', '2026-11-10'), '2026-11-10');
  const holidays = new Set(['2026-11-15']);
  const steps = [{ sector: 'Dpto. Fiscal', due_day: 8 }, { sector: 'Dpto. Pessoal', due_day: 9 }, { sector: 'Dpto. Fiscal', due_day: 15 }, { sector: 'Dpto. Contábil', due_day: 30 }];
  assert.deepEqual(flow.stepDates(steps, flow.deadlineStart('2026-10', '2026-11-10'), holidays).map(s => s.due_date),
    ['2026-11-09', '2026-11-09', '2026-11-16', '2026-11-30']);
});

test('alterar data de conclusão: só em concluídas, pelo criador ou admin', () => {
  const done = mk({ status: 'done', created_by: 'u-atend' });
  assert.equal(flow.can(done, atend).setCompleted, true);
  assert.equal(flow.can(done, fiscal).setCompleted, false);
  assert.equal(flow.can(done, admin).setCompleted, true);
  assert.equal(flow.can(mk(), atend).setCompleted, false);
  assert.equal(flow.officeDate('2026-11-10T02:00:00Z'), '2026-11-09'); // 23h de 09/11 em Brasília
});

test('Minha caixa: só tarefas abertas assumidas por mim', () => {
  const ctxF = { userId: 'u-fiscal', sector: 'Dpto. Fiscal', admin: false };
  const tasks = [
    mk({ id: 'a', current_step: 1, assigned_to: 'u-fiscal' }),
    mk({ id: 'b', current_step: 1 }),
    mk({ id: 'c', current_step: 1, assigned_to: 'outro' }),
    mk({ id: 'd', status: 'done', assigned_to: 'u-fiscal' })
  ];
  assert.deepEqual(flow.filterTasks(tasks, { view: 'inbox' }, ctxF, new Map(), '2026-11-10').map(t => t.id), ['a']);
  assert.equal(flow.inboxCount(tasks, ctxF), 3); // contador do menu: tudo na vez do setor
});
