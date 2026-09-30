(() => {
  const rotation = window.conectaKitchenRotation;
  const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const admin = () => window.conectaCurrentProfile?.active === true && window.conectaCurrentProfile?.role === 'admin';
  const db = () => window.conectaFirebase?.db;
  const defaultPairs = [['Gabriel', 'Gabriele'], ['Janice', 'Klarice'], ['Rose', 'Simone'], ['Vitoria', 'Chaiane']];
  const pairOptions = (pairs, selected, automatic = false) => (automatic ? '<option value="">Dupla do rodízio</option>' : '') + pairs.map((pair, index) => `<option value="${index}" ${index === selected ? 'selected' : ''}>${esc(pair.join(' e '))}</option>`).join('');
  let month = today().slice(0, 7), record = null, request = 0;
  const nav = document.createElement('button');
  nav.type = 'button'; nav.dataset.view = 'Calendário';
  nav.innerHTML = '<span class="ico" aria-hidden="true">▦</span> Calendário';
  document.querySelector('.nav [data-view="Lembretes"]')?.after(nav);
  const visible = () => document.getElementById('crumb')?.textContent === 'Calendário';
  const load = async () => {
    if (!db()) throw new Error('Entre novamente para acessar o calendário.');
    const { data, error } = await db().from('kitchen_calendar').select('*').eq('id', true).single();
    if (error) throw new Error('Não foi possível carregar a escala. Confira sua conexão e tente atualizar.');
    record = data;
  };
  const save = async (config, expectedVersion) => {
    if (!admin()) throw new Error('Somente administradores podem alterar a escala.');
    const { data, error } = await db().from('kitchen_calendar')
      .update({ config, version: expectedVersion + 1, updated_at: new Date().toISOString() })
      .eq('id', true).eq('version', expectedVersion).select('*').maybeSingle();
    if (error) throw new Error('Não foi possível salvar. Confira sua conexão e tente novamente.');
    if (!data) { await load(); throw new Error('Outra pessoa atualizou a escala. Feche esta janela, atualize o calendário e refaça a alteração.'); }
    record = data;
  };
  const options = (people, selected = '', automatic = false) => (automatic ? '<option value="">Automático</option>' : '') + people.map(p => `<option value="${esc(p)}" ${p === selected ? 'selected' : ''}>${esc(p)}</option>`).join('');
  const modal = (title, content, onSubmit) => {
    document.querySelector('.kitchen-dialog')?.remove();
    const dialog = document.createElement('dialog'); dialog.className = 'kitchen-dialog';
    dialog.innerHTML = `<h3>${esc(title)}</h3><form class="kitchen-form">${content}<p class="kitchen-error" role="alert"></p><div class="kitchen-actions"><button type="button" class="secondary" data-close>Cancelar</button><button type="submit" class="primary">Salvar</button></div></form>`;
    document.body.append(dialog);
    dialog.querySelector('[data-close]').onclick = () => dialog.close();
    dialog.addEventListener('close', () => dialog.remove());
    dialog.querySelector('form').onsubmit = async event => {
      event.preventDefault();
      const button = dialog.querySelector('[type="submit"]'); button.disabled = true;
      try { await onSubmit(new FormData(event.target)); dialog.close(); if (visible()) render(); showToast('Escala atualizada.'); }
      catch (error) { dialog.querySelector('[role="alert"]').textContent = error.message; }
      finally { button.disabled = false; }
    };
    dialog.showModal();
  };
  const settings = () => {
    const config = record.config || {}, people = rotation.sortedPeople(config.people || []);
    const pairs = config.sweepPairs || defaultPairs;
    const version = record.version;
    modal('Configurar rodízio', `
      <p class="kitchen-help">Na louça, a ordem é alfabética: quem seca passa a lavar no próximo dia; ausentes são pulados. Na varrição, as duplas são fixas e as faltas não alteram quem está escalado.</p>
      <label>Participantes da louça — um nome por linha<textarea name="people" required maxlength="8000">${esc(people.join('\n'))}</textarea></label>
      <label>Data de início<input name="startDate" type="date" required value="${esc(config.startDate || today())}"></label>
      <label>Primeira pessoa a lavar<input name="startWasher" required value="${esc(config.startWasher || people[0] || '')}" placeholder="Nome exatamente como na lista"></label>
      <label>Duplas para varrer — uma por linha, na ordem do rodízio<textarea name="sweepPairs" required maxlength="8000" placeholder="Gabriel; Gabriele">${esc(pairs.map(pair => pair.join('; ')).join('\n'))}</textarea></label>
      <label>Primeira dupla a varrer<select name="startSweepPair">${pairOptions(pairs, config.startSweepPair || 0)}</select></label>
      <small class="kitchen-help">Separe os dois nomes de cada dupla por ponto e vírgula. Se editar a lista, a dupla inicial será identificada pelos nomes selecionados; se ela for removida, começa a primeira dupla da nova lista.</small>
      <p class="kitchen-help">Mudar esta configuração recalcula a escala desde a data de início. Para faltas e feriados, use Ajustar dia. As alterações de dias já registradas serão mantidas.</p>`, async form => {
      const names = rotation.sortedPeople(String(form.get('people')).split(/\r?\n/));
      if (names.length < 2 || names.length > 100) throw new Error('Informe entre 2 e 100 participantes.');
      const startDate = String(form.get('startDate')); rotation.stamp(startDate);
      if (new Date(startDate + 'T12:00:00Z').getUTCDay() % 6 === 0) throw new Error('Escolha um dia de segunda a sexta para iniciar.');
      const startWasher = String(form.get('startWasher')).trim();
      if (!names.includes(startWasher)) throw new Error('O nome inicial precisa estar na lista da louça.');
      const sweepPairs = String(form.get('sweepPairs') || '').split(/\r?\n/).filter(line => line.trim()).map(line => line.split(';').map(name => name.trim()));
      if (!sweepPairs.length || sweepPairs.length > 100 || sweepPairs.some(pair => pair.length !== 2 || !pair[0] || !pair[1] || pair[0].toLocaleLowerCase('pt-BR') === pair[1].toLocaleLowerCase('pt-BR'))) throw new Error('Informe duas pessoas diferentes por dupla, separadas por ponto e vírgula.');
      const selectedPair = pairs[Number(form.get('startSweepPair')) || 0];
      const startSweepPair = Math.max(0, sweepPairs.findIndex(pair => JSON.stringify(pair) === JSON.stringify(selectedPair)));
      await save({ ...config, people: names, startDate, startWasher, sweepPairs, startSweepPair }, version);
    });
  };
  const editDay = (date, generated) => {
    const config = record.config, people = rotation.sortedPeople(config.people), edit = config.days?.[date] || {};
    const pairs = config.sweepPairs || [];
    const absenceNames = rotation.sortedPeople([...people, ...pairs.flat()]);
    const version = record.version;
    modal(`Ajustar ${new Date(date + 'T12:00:00Z').toLocaleDateString('pt-BR', {timeZone:'UTC'})}`, `
      <p class="kitchen-help">Na louça, as faltas alteram a sequência. Na varrição, a dupla permanece escalada mesmo se um integrante faltar. Feriados são ajustados manualmente.</p>
      <div class="kitchen-checks">${absenceNames.map(p => `<label><input type="checkbox" name="absent" value="${esc(p)}" ${(edit.absent || []).includes(p) ? 'checked' : ''}>${esc(p)}</label>`).join('')}</div>
      <label>Louça<select name="dishes"><option value="auto">Conforme o dia da semana</option><option value="yes" ${edit.dishes === true ? 'selected' : ''}>Realizar neste dia</option><option value="no" ${edit.dishes === false ? 'selected' : ''}>Sem louça — não avança o rodízio</option></select></label>
      <label>Varrer<select name="sweep"><option value="auto">Conforme o dia da semana</option><option value="yes" ${edit.sweep === true ? 'selected' : ''}>Realizar neste dia</option><option value="no" ${edit.sweep === false ? 'selected' : ''}>Sem varrição — não avança o rodízio</option></select></label>
      <label>Quem lava<select name="wash">${options(people, edit.wash, true)}</select></label>
      <label>Quem seca<select name="dry">${options(people, edit.dry, true)}</select></label>
      <label>Dupla para varrer<select name="sweepPair">${pairOptions(pairs, edit.sweepPair, true)}</select></label>
      <label>Observação<input name="note" maxlength="300" value="${esc(edit.note || '')}" placeholder="Ex.: feriado, troca de dia"></label>
      <label>Transferir as tarefas deste dia para outra data (opcional)<input name="moveTo" type="date" min="${esc(config.startDate)}"></label>
      <p class="kitchen-help">Ao transferir, as tarefas de origem ficam suspensas e substituem as mesmas tarefas no destino. A escala seguinte é recalculada.</p>`, async form => {
      const value = key => String(form.get(key) || '');
      const changed = { absent: form.getAll('absent'), note: value('note') };
      for (const key of ['dishes', 'sweep']) if (value(key) !== 'auto') changed[key] = value(key) === 'yes';
      for (const key of ['wash', 'dry']) if (value(key)) {
        if (changed.absent.includes(value(key))) throw new Error('Uma pessoa ausente não pode receber tarefa neste dia.');
        changed[key] = value(key);
      }
      if (value('sweepPair') !== '') changed.sweepPair = Number(value('sweepPair'));
      if (changed.wash && changed.wash === changed.dry) throw new Error('Escolha pessoas diferentes para lavar e secar.');
      const updated = structuredClone(config); updated.days ||= {}; updated.days[date] = changed;
      if (value('moveTo')) {
        const target = value('moveTo'); rotation.stamp(target);
        if (target <= date) throw new Error('Transfira para uma data posterior ao dia de origem.');
        const source = rotation.generate(updated, date)[date] || generated;
        if (!source?.wash && !source?.sweepers) throw new Error('Não há tarefas disponíveis para transferir.');
        const destination = { ...(updated.days[target] || {}) };
        if (source.wash) { changed.dishes = false; destination.dishes = true; destination.wash = source.wash; destination.dry = source.dry; }
        if (source.sweepers) { changed.sweep = false; destination.sweep = true; destination.sweepPair = source.sweepPair; }
        if ([destination.wash, destination.dry].some(p => p && destination.absent?.includes(p))) throw new Error('Uma pessoa escalada para a louça está ausente na data de destino. Ajuste essa data primeiro.');
        destination.note = `Transferido de ${date}${destination.note ? ' · ' + destination.note : ''}`;
        updated.days[target] = destination;
      }
      await save(updated, version);
    });
  };
  const render = async () => {
    const panel = document.getElementById('viewPanel'), token = ++request;
    panel.innerHTML = '<div class="kitchen-empty" role="status">Carregando calendário…</div>';
    try {
      await load();
      if (token !== request || !visible()) return;
      const config = record.config || {}, configured = config.people?.length >= 2 && config.startDate;
      const first = new Date(month + '-01T12:00:00Z');
      const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12));
      const assignments = configured ? rotation.generate(config, last.toISOString().slice(0, 10)) : {};
      const label = first.toLocaleDateString('pt-BR', { month:'long', year:'numeric', timeZone:'UTC' });
      let cells = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'].map(d => `<div class="kitchen-weekday">${d}</div>`).join('');
      cells += '<div class="kitchen-pad"></div>'.repeat((first.getUTCDay() + 6) % 7);
      for (let day = 1; day <= last.getUTCDate(); day++) {
        const date = `${month}-${String(day).padStart(2,'0')}`, row = assignments[date];
        const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
        cells += `<article class="kitchen-day ${date === today() ? 'is-today' : ''} ${weekday % 6 === 0 ? 'is-weekend' : ''}"><time datetime="${date}">${day} <small>${['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][weekday]}</small></time>
          ${row?.dishes ? `<span class="kitchen-task">Lavar: <strong>${esc(row.wash || 'Sem dupla disponível')}</strong></span><span class="kitchen-task">Secar: <strong>${esc(row.dry || '—')}</strong></span>` : `<span class="kitchen-task">${row ? 'Sem louça' : 'Antes do início da escala'}</span>`}
          ${row?.sweep ? `<span class="kitchen-task">Varrer: <strong>${esc(row.sweepers?.join(' e ') || 'Configure as duplas')}</strong></span>` : ''}
          ${row?.absent.length ? `<small class="kitchen-note">Ausentes: ${esc(row.absent.join(', '))}</small>` : ''}${row?.note ? `<small class="kitchen-note">${esc(row.note)}</small>` : ''}
          ${admin() && row ? `<button type="button" class="text-btn" data-day="${date}">Ajustar dia${row.changed ? ' •' : ''}</button>` : ''}</article>`;
      }
      panel.innerHTML = `<div class="view-toolbar"><div><h2>Calendário do escritório</h2><p>Louça de segunda a sexta • Varrição às quartas</p></div></div><div class="kitchen-toolbar"><div class="kitchen-month-nav"><button class="secondary" data-month="-1" aria-label="Mês anterior">‹</button><h3>${esc(label)}</h3><button class="secondary" data-month="1" aria-label="Próximo mês">›</button></div><div class="kitchen-actions"><button class="secondary" data-today>Hoje</button><button class="secondary" data-refresh>Atualizar</button>${admin() ? '<button class="primary" data-config>Configurar rodízio</button>' : ''}</div></div>
        <p class="kitchen-help">Louça: quem seca hoje lava no próximo dia; ausentes são pulados. Varrição: duplas fixas, sem substituição automática por faltas. Dias suspensos não avançam o rodízio.</p>
        ${configured ? `<div class="kitchen-grid">${cells}</div>` : '<div class="card kitchen-empty">A escala ainda não foi configurada. Um administrador deve informar os participantes, a data de início e quem começa.</div>'}`;
      panel.querySelectorAll('[data-month]').forEach(b => b.onclick = () => { const next = new Date(first); next.setUTCMonth(next.getUTCMonth() + Number(b.dataset.month)); month = next.toISOString().slice(0,7); render(); });
      panel.querySelector('[data-today]').onclick = () => { month = today().slice(0,7); render(); };
      panel.querySelector('[data-refresh]').onclick = render;
      const configure = panel.querySelector('[data-config]'); if (configure) configure.onclick = settings;
      panel.querySelectorAll('[data-day]').forEach(b => b.onclick = () => editDay(b.dataset.day, assignments[b.dataset.day]));
    } catch (error) {
      if (token !== request || !visible()) return;
      panel.innerHTML = `<div class="card kitchen-empty"><p role="alert">${esc(error.message)}</p><button type="button" class="secondary">Tentar novamente</button></div>`;
      panel.querySelector('button').onclick = render;
    }
  };
  const previous = renderView;
  renderView = window.renderView = view => { previous(view); if (view === 'Calendário') render(); else request++; };
  nav.onclick = () => { document.querySelectorAll('.nav button,.channel').forEach(b => b.classList.toggle('active', b === nav)); renderView('Calendário'); };
  window.addEventListener('conecta-profile-ready', () => { if (visible()) render(); });
})();
