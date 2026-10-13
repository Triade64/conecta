(() => {
  const admin = () => window.conectaCurrentProfile?.role === 'admin' && window.conectaCurrentProfile?.active === true;
  const user = () => window.conectaCurrentUser;
  let channels = [];
  let sessionGeneration = 0;
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const openChannel = id => {
    const index = contacts.findIndex(c => c.firestoreId === id);
    if (index < 0) return;
    renderView('Conversas');
    selectedContact = contacts.findIndex(c => c.firestoreId === id);
    renderConversations();
  };
  const sidebar = () => {
    document.getElementById('managedChannelNavigation')?.remove();
    if (!channels.length || !user()) return;
    const box = element('div', '', 'managed-channel-navigation');
    box.id = 'managedChannelNavigation';
    box.append(element('div', 'CANAIS PERSONALIZADOS', 'managed-channel-label'));
    channels.forEach(channel => {
      const button = element('button', '# ' + channel.name, 'channel');
      button.type = 'button';
      button.title = channel.name;
      button.onclick = () => openChannel(channel.id);
      box.append(button);
    });
    document.querySelector('.channels')?.append(box);
  };
  window.addEventListener('conecta-conversations-sync', event => {
    channels = (event.detail || []).filter(c => c.managed_channel && c.member_ids?.includes(user()?.id));
    sidebar();
  });
  window.addEventListener('conecta-profile-ready', sidebar);
  window.addEventListener('conecta-auth-session-reset', () => {
    sessionGeneration++; channels = []; sidebar();
    document.getElementById('channelMembersDialog')?.remove();
  });

  const editChannel = channel => {
    if (!admin()) return;
    document.getElementById('channelMembersDialog')?.remove();
    const actor = user(), generation = sessionGeneration;
    const directory = (window.conectaDirectory || []).filter(p => p.active !== false);
    if (!directory.some(p => p.id === actor.id)) directory.push({ id: actor.id, name: window.conectaCurrentProfile.name || 'Você' });
    const selected = new Set(channel?.member_ids || [actor.id]);
    const required = new Set([actor.id, channel?.created_by || actor.id]);
    required.forEach(id => selected.add(id));
    const dialog = element('dialog', '', 'channel-members-dialog');
    dialog.id = 'channelMembersDialog';
    dialog.setAttribute('aria-labelledby', 'channelMembersTitle');
    const form = element('form');
    const title = element('h2', channel ? 'Gerenciar canal' : 'Criar canal'); title.id = 'channelMembersTitle';
    const description = element('p', 'Escolha os membros que poderão acessar as mensagens. O criador permanece no canal.');
    const label = element('label', 'Nome do canal'); label.htmlFor = 'managedChannelName';
    const name = element('input'); name.id = 'managedChannelName'; name.required = true; name.minLength = 2; name.maxLength = 80; name.value = channel?.name || ''; name.placeholder = 'Ex.: Projeto de clientes';
    const search = element('input'); search.type = 'search'; search.placeholder = 'Buscar colaborador'; search.setAttribute('aria-label', 'Buscar colaborador');
    const list = element('div', '', 'channel-member-options');
    const summary = element('p', '', 'channel-member-summary');
    const drawMembers = () => {
      summary.textContent = `${selected.size} membro(s) selecionado(s)`;
      list.replaceChildren();
      const query = search.value.trim().toLocaleLowerCase('pt-BR');
      directory.slice().sort((a,b) => (a.name || '').localeCompare(b.name || '', 'pt-BR')).filter(p => (p.name || '').toLocaleLowerCase('pt-BR').includes(query)).forEach(person => {
        const row = element('label', '', 'channel-member-option');
        const checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.value = person.id;
        checkbox.checked = selected.has(person.id); checkbox.disabled = required.has(person.id);
        checkbox.onchange = () => { if (checkbox.checked) selected.add(person.id); else selected.delete(person.id); summary.textContent = `${selected.size} membro(s) selecionado(s)`; };
        row.append(checkbox, element('span', (person.name || 'Colaborador') + (person.id === actor.id ? ' (você)' : '')));
        list.append(row);
      });
      if (!list.children.length) list.append(element('p', 'Nenhum colaborador encontrado.'));
    };
    search.oninput = drawMembers;
    const feedback = element('p', '', 'channel-member-feedback'); feedback.setAttribute('role', 'status');
    const actions = element('div', '', 'modal-actions');
    const cancel = element('button', 'Cancelar', 'secondary'); cancel.type = 'button'; cancel.onclick = () => dialog.close();
    const submit = element('button', channel ? 'Salvar membros' : 'Criar canal', 'primary'); submit.type = 'submit';
    actions.append(cancel, submit);
    form.append(title, description, label, name, search, summary, list, feedback, actions); dialog.append(form); document.body.append(dialog);
    let busy = false;
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    form.onsubmit = async event => {
      event.preventDefault(); if (busy) return;
      if (!admin() || user()?.id !== actor.id || generation !== sessionGeneration) { feedback.textContent = 'Sua sessão mudou. Abra o canal novamente.'; return; }
      busy = true; submit.disabled = true; cancel.disabled = true; name.disabled = true; search.disabled = true;
      list.querySelectorAll('input').forEach(input => input.disabled = true); feedback.textContent = 'Salvando…';
      try {
        await window.conectaFirebase.saveManagedChannel(actor, { id: channel?.id || null, name: name.value, memberIds: [...selected] });
        if (generation !== sessionGeneration || user()?.id !== actor.id) return;
        dialog.close(); dialog.remove(); showToast(channel ? 'Canal e membros atualizados.' : 'Canal criado.');
        if (document.getElementById('crumb')?.textContent === 'Administração') await renderAdmin();
      } catch (error) {
        feedback.textContent = error.code === '23505' ? 'Já existe um canal com esse nome.' : (error.message || 'Não foi possível salvar o canal.');
      } finally {
        busy = false; submit.disabled = false; cancel.disabled = false; name.disabled = false; search.disabled = false;
        list.querySelectorAll('input').forEach(input => input.disabled = required.has(input.value));
      }
    };
    drawMembers(); dialog.showModal(); name.focus();
  };

  const baseAdmin = renderAdmin;
  renderAdmin = window.renderAdmin = async () => {
    await baseAdmin();
    const panel = document.getElementById('viewPanel');
    if (!admin() || !panel?.classList.contains('show') || document.getElementById('crumb')?.textContent !== 'Administração' || document.getElementById('channelManagementCard')) return;
    const actor = user(), generation = sessionGeneration;
    const card = element('section', '', 'card channel-management-card'); card.id = 'channelManagementCard';
    const heading = element('div', '', 'card-head');
    const copy = element('div'); copy.append(element('div', 'Canais e membros', 'card-title'), element('div', 'Crie canais e escolha os participantes.', 'card-sub'));
    const create = element('button', '＋ Criar canal', 'primary'); create.type = 'button'; create.onclick = () => editChannel(null);
    heading.append(copy, create); card.append(heading);
    const list = element('div', 'Carregando canais…', 'managed-channel-list'); card.append(list); panel.prepend(card);
    try {
      const rows = await window.conectaFirebase.listManagedChannels();
      if (!admin() || generation !== sessionGeneration || user()?.id !== actor.id || !card.isConnected) return;
      list.replaceChildren();
      const people = new Map((window.conectaDirectory || []).map(p => [p.id, p.name]));
      if (!rows.length) list.append(element('p', 'Nenhum canal personalizado.'));
      rows.forEach(channel => {
        const row = element('article', '', 'managed-channel-row');
        const info = element('div'); info.append(element('strong', '# ' + channel.name), element('p', channel.member_ids.map(id => people.get(id) || 'Colaborador').join(', ')));
        const button = element('button', 'Gerenciar membros', 'secondary'); button.type = 'button'; button.onclick = () => editChannel(channel);
        row.append(info, button); list.append(row);
      });
    } catch (error) { if (card.isConnected) list.textContent = error.message || 'Não foi possível carregar os canais.'; }
  };
})();
