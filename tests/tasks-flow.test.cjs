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
  assert.deepEqual(ids('inbox', atend), ['a']);
  assert.deepEqual(ids('inbox', fiscal), ['b']);
  assert.deepEqual(ids('sector', fiscal), ['a', 'b']);
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
