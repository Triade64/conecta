(() => {
  let online = new Set(), ready = false, dialog = null;
  const currentId = () => window.conectaCurrentUser?.id || window.conectaFirebase?.auth?.currentUser?.id || window.conectaFirebase?.auth?.currentUser?.uid;
  const people = () => (window.conectaDirectory || []).filter(p => p.id !== currentId()).slice().sort((a,b) => Number(online.has(b.id)) - Number(online.has(a.id)) || (a.name || '').localeCompare(b.name || '', 'pt-BR'));
  const status = id => !ready ? 'Verificando…' : online.has(id) ? 'Online' : 'Offline';
  const style = document.createElement('style');
  style.textContent = '.presence-badge{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:500;white-space:nowrap;color:#7a8179}.presence-badge::before{content:"";width:7px;height:7px;border-radius:50%;background:#a5aaa3}.presence-badge.is-online{color:#287246}.presence-badge.is-online::before{background:#32a566}.chat-head>.presence-badge{margin-top:5px}.presence-team-button{white-space:nowrap}.presence-dialog{width:min(480px,calc(100vw - 28px));max-height:85dvh;border:1px solid var(--line);border-radius:16px;padding:20px;color:var(--ink);overflow:auto}.presence-dialog::backdrop{background:#17251b99}.presence-dialog-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.presence-dialog h2{font-size:19px;margin:0}.presence-dialog p{color:var(--muted);font-size:12px}.presence-person{width:100%;display:flex;align-items:center;gap:12px;padding:12px 6px;border:0;border-bottom:1px solid var(--line);background:transparent;text-align:left;color:inherit;font:inherit}.presence-person:hover{background:#eef3ed}.presence-person-info{flex:1;min-width:0}.presence-person-info strong,.presence-person-info small{display:block;overflow-wrap:anywhere}.presence-person-info small{font-size:11px;color:var(--muted);margin-top:4px}.presence-person .presence-badge{font-size:12px}.conv-item .chat-name{flex-wrap:wrap}.view-toolbar:has(.presence-team-button){flex-wrap:wrap}';
  document.head.append(style);
  const badge = (parent,id) => {
    if (!parent || !id) return;
    let node = parent.querySelector(':scope > .presence-badge');
    if (!node) {node = document.createElement('span');node.className = 'presence-badge';parent.append(node);}
    const label = status(id), klass = 'presence-badge' + (ready && online.has(id) ? ' is-online' : '');
    if (node.textContent !== label) node.textContent = label;
    if (node.className !== klass) node.className = klass;
    node.title = ready ? 'Conexão no Conecta: '+label : 'Aguardando conexão com a equipe';
  };
  const updateDestinations = () => {
    const select = document.getElementById('destination');
    if (!select) return;
    const group = [...select.querySelectorAll('optgroup')].find(g => g.label === 'Conversa individual');
    if (!group) return;
    const selected = select.value;
    const options = new Map([...group.querySelectorAll('option')].map(o=>[o.value,o]));
    for (const person of people()) {
      const option = options.get('user:'+person.id);if (!option) continue;
      const label = `${person.name || 'Colaborador'} — ${status(person.id)} · ${person.sector || person.role || 'Equipe'}`;
      if (option.textContent !== label) option.textContent = label;
      group.append(option);
    }
    select.value = selected;
  };
  const renderPeople = () => {
    if (!dialog?.open) return;
    const list = dialog.querySelector('.presence-people');list.replaceChildren();
    const directory = people();
    dialog.querySelector('.presence-summary').textContent = ready ? `${directory.filter(p=>online.has(p.id)).length} colega(s) online. Clique em uma pessoa para conversar.` : 'Conectando ao status da equipe…';
    for (const person of directory) {
      const button = document.createElement('button');button.type = 'button';button.className = 'presence-person';
      const info = document.createElement('span');info.className = 'presence-person-info';
      const name = document.createElement('strong');name.textContent = person.name || 'Colaborador';
      const sector = document.createElement('small');sector.textContent = person.sector || 'Equipe';info.append(name,sector);button.append(info);badge(button,person.id);
      button.onclick = () => {
        dialog.close();
        const conversation = typeof contacts !== 'undefined' ? contacts.find(c=>c.kind==='direct' && c.directUserId===person.id) : null;
        if (conversation && window.conectaOpenNudgeConversation?.(conversation.firestoreId)) return;
        window.openModal('message');
        const destination = document.getElementById('destination');if (destination) destination.value = 'user:'+person.id;
        document.getElementById('message')?.focus();
      };
      list.append(button);
    }
    if (!directory.length) list.textContent = 'Nenhum colega disponível no momento.';
  };
  const openTeam = () => {
    if (!dialog) {
      dialog = document.createElement('dialog');dialog.className = 'presence-dialog';dialog.setAttribute('aria-label','Status da equipe');
      dialog.innerHTML = '<div class="presence-dialog-head"><h2>Status da equipe</h2><button class="secondary" type="button">Fechar</button></div><p class="presence-summary"></p><div class="presence-people"></div>';
      dialog.querySelector('button').onclick=()=>dialog.close();document.body.append(dialog);
    }
    if (!dialog.open) dialog.showModal();renderPeople();
  };
  const paint = () => {
    if (typeof contacts !== 'undefined') {
      document.querySelectorAll('.conversation-list .conv-item').forEach(button => {const c=contacts[Number(button.dataset.contact)];if (c?.kind==='direct' && c.directUserId) badge(button.querySelector('.chat-name'),c.directUserId);});
      const active = contacts[typeof selectedContact !== 'undefined' ? selectedContact : -1];
      if (active?.kind==='direct' && active.directUserId) badge(document.querySelector('.chat-head'),active.directUserId);
    }
    const toolbar = document.querySelector('#viewPanel .view-toolbar');
    if (toolbar && document.querySelector('.conversation-layout') && !toolbar.querySelector('.presence-team-button')) {
      const button=document.createElement('button');button.className='secondary presence-team-button';button.type='button';button.textContent='Equipe online';button.onclick=openTeam;toolbar.append(button);
    }
    const count = document.getElementById('onlineCount')?.closest('.stat');
    if (count && !count.querySelector('.presence-team-button')) {const button=document.createElement('button');button.type='button';button.className='text-btn presence-team-button';button.textContent='Ver quem está online →';button.onclick=openTeam;count.append(button);}
    updateDestinations();renderPeople();
  };
  let scheduled=false;
  const schedule=()=>{if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;paint();});};
  new MutationObserver(records=>{if(records.some(r=>[...r.addedNodes].some(n=>n.nodeType===1 && (n.matches('.conv-item,.conversation-chat,.view-toolbar,#destination') || n.querySelector('.conv-item,.conversation-chat,.view-toolbar,#destination')))))schedule();}).observe(document.body,{childList:true,subtree:true});
  window.addEventListener('conecta-presence-sync',event=>{online=new Set(event.detail?.userIds || []);ready=!!event.detail?.ready;schedule();});
  window.addEventListener('conecta-directory-sync',schedule);
  window.addEventListener('conecta-auth-session-reset',()=>{online.clear();ready=false;dialog?.close();schedule();});
  paint();
})();
