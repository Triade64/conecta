(() => {
  const labels = { available: 'Disponível', busy: 'Ocupado', meeting: 'Em reunião', away: 'Ausente' };
  const user = () => window.conectaCurrentUser || window.conectaFirebase?.auth?.currentUser;
  const api = () => window.conectaFirebase;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  let statuses = new Map(), favorites = [], favoritesReady = false, calendar = null, statusDialog = null;
  const pending = new Set();
  const statusOf = id => statuses.get(id) || { status: 'available', note: '' };
  window.conectaTeamStatus = {
    describe: id => { const s = statusOf(id); return `${labels[s.status] || labels.available}${s.note ? ' · ' + s.note : ''}`; },
    code: id => statusOf(id).status
  };
  const openStatus = () => {
    if (!user()) return;
    statusDialog?.remove();
    const s = statusOf(user().id), dialog = document.createElement('dialog');statusDialog = dialog;
    dialog.className = 'personal-status-dialog';dialog.setAttribute('aria-label', 'Meu status');
    dialog.innerHTML = `<h2>Meu status</h2><p>Informe sua disponibilidade para a equipe.</p><form><div class="field"><label for="personalStatus">Disponibilidade</label><select id="personalStatus">${Object.entries(labels).map(([key,label])=>`<option value="${key}" ${s.status===key?'selected':''}>${label}</option>`).join('')}</select></div><div class="field"><label for="personalStatusNote">Mensagem do status (opcional)</label><input id="personalStatusNote" maxlength="80" placeholder="Ex.: em atendimento até as 15h" value="${esc(s.note)}"></div><p class="personal-error" role="alert"></p><div class="modal-actions"><button class="secondary" type="button">Cancelar</button><button class="primary" type="submit">Salvar status</button></div></form>`;
    document.body.append(dialog);dialog.querySelector('.secondary').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>{dialog.remove();if(statusDialog===dialog)statusDialog=null;});
    dialog.querySelector('form').onsubmit=async event=>{
      event.preventDefault();const account=user(), submit=dialog.querySelector('[type="submit"]');if(submit.disabled)return;submit.disabled=true;
      try { await api().setTeamStatus(account,dialog.querySelector('select').value,dialog.querySelector('input').value); if(user()?.id===account.id){dialog.close();showToast('Status atualizado.');} }
      catch { dialog.querySelector('[role="alert"]').textContent='Não foi possível salvar o status. Tente novamente.'; }
      finally { submit.disabled=false; }
    };
    dialog.showModal();
  };
  const paintStatus = () => {
    const parent=document.querySelector('.profile-info');if(!parent)return;
    let button=parent.querySelector('.own-status');
    if(!button){button=document.createElement('button');button.type='button';button.className='own-status';button.onclick=openStatus;parent.append(button);}
    const account=user(), text=account?window.conectaTeamStatus.describe(account.id):'Meu status';
    if(button.textContent!==text)button.textContent=text;
    button.title='Alterar status: '+text;button.dataset.status=account?statusOf(account.id).status:'available';
    const area=document.querySelector('.profile-photo-controls');
    if(area&&!area.querySelector('.profile-status-button')){const edit=document.createElement('button');edit.type='button';edit.className='text-btn profile-status-button';edit.textContent='Alterar meu status';edit.onclick=openStatus;area.append(edit);}
  };
  const nav=document.createElement('button');nav.type='button';nav.dataset.view='Favoritos';nav.innerHTML='<span class="ico" aria-hidden="true">☆</span> Favoritos';
  document.querySelector('.nav [data-view="Conversas"]')?.after(nav);
  const visibleFavorites=()=>document.getElementById('crumb')?.textContent==='Favoritos';
  const toggleFavorite=async (id, value)=>{
    const account=user();if(!account||pending.has(id))return;
    pending.add(id);paintMessages();
    try {await api().setMessageFavorite(account,id,value);if(user()?.id===account.id)showToast(value?'Mensagem favoritada.':'Mensagem removida dos favoritos.');}
    catch {if(user()?.id===account.id)showToast('Não foi possível atualizar o favorito. Tente novamente.');}
    finally {pending.delete(id);paintMessages();if(visibleFavorites())paintFavoriteList();}
  };
  const paintMessages=()=>{
    const ids=new Set(favorites.map(f=>f.message_id));
    document.querySelectorAll('#chatMessages .bubble[data-message-id]').forEach(bubble=>{
      const id=bubble.dataset.messageId, menu=bubble.closest('.message-row')?.querySelector('.message-action-menu');
      if(!id||!menu)return;
      let button=menu.querySelector('.favorite-action');
      if(bubble.dataset.deleted==='true'){button?.remove();bubble.querySelector('.favorite-marker')?.remove();return;}
      if(!button){button=document.createElement('button');button.type='button';button.className='favorite-action';button.onclick=event=>{event.stopPropagation();menu.hidden=true;toggleFavorite(id,!favorites.some(f=>f.message_id===id));};menu.prepend(button);}
      const saved=ids.has(id);button.textContent=saved?'★ Remover dos favoritos':'☆ Favoritar';button.disabled=pending.has(id)||!favoritesReady;
      let marker=bubble.querySelector('.favorite-marker');
      if(saved&&!marker){marker=document.createElement('span');marker.className='favorite-marker';marker.textContent=' ★';marker.title='Favorita';marker.setAttribute('aria-label','Mensagem favorita');bubble.querySelector('small')?.append(marker);}
      if(!saved)marker?.remove();
    });
  };
  const conversationName=id=>typeof contacts!=='undefined'?contacts.find(c=>c.firestoreId===id)?.name||'Conversa':'Conversa';
  const paintFavoriteList=()=>{
    const list=document.querySelector('.favorite-list');if(!list||!visibleFavorites())return;
    const term=(document.getElementById('favoriteSearch')?.value||'').trim().toLocaleLowerCase('pt-BR');
    list.replaceChildren();
    const rows=favorites.filter(f=>{
      const m=f.message;return m&&[m.deleted_at?'Mensagem apagada':m.text,m.author_name,m.deleted_at?'':m.attachment_name,conversationName(m.conversation_id)].join(' ').toLocaleLowerCase('pt-BR').includes(term);
    });
    if(!rows.length){const empty=document.createElement('div');empty.className='empty';empty.textContent=!favoritesReady?'Carregando favoritos…':term?'Nenhum favorito encontrado.':'Você ainda não favoritou mensagens. Use o menu ⋯ de uma mensagem para favoritar.';list.append(empty);return;}
    for(const f of rows){
      const m=f.message,item=document.createElement('article');item.className='card favorite-item';
      const title=document.createElement('strong');title.textContent=conversationName(m.conversation_id)+' · '+(m.author_name||'Colaborador');
      const time=document.createElement('small');time.textContent=new Date(m.created_at).toLocaleString('pt-BR');
      const text=document.createElement('p');text.textContent=m.deleted_at?'Mensagem apagada':m.text|| (m.attachment_path?'Imagem / GIF':'Mensagem');
      item.append(title,time,text);
      if(m.attachment_name&&!m.deleted_at){const file=document.createElement('p');file.textContent='📎 '+m.attachment_name;item.append(file);}
      const actions=document.createElement('div');actions.className='favorite-item-actions';
      const open=document.createElement('button');open.type='button';open.className='text-btn';open.textContent='Abrir na conversa';open.onclick=()=>{if(!window.conectaOpenFavoriteConversation?.(m.conversation_id,m.id))showToast('Esta conversa não está disponível.');};
      const remove=document.createElement('button');remove.type='button';remove.className='text-btn';remove.textContent='Remover favorito';remove.disabled=pending.has(f.message_id);remove.onclick=()=>toggleFavorite(f.message_id,false);
      actions.append(open,remove);item.append(actions);list.append(item);
    }
  };
  const renderFavorites=()=>{
    document.getElementById('viewPanel').innerHTML='<div class="view-toolbar"><div><h2>Mensagens favoritas</h2><p>Suas mensagens e arquivos marcados, visíveis somente para você.</p></div></div><div class="field favorite-search"><label for="favoriteSearch">Pesquisar favoritos</label><input id="favoriteSearch" type="search" placeholder="Texto, pessoa, conversa ou arquivo"></div><div class="favorite-list"></div>';
    document.getElementById('favoriteSearch').oninput=paintFavoriteList;paintFavoriteList();
  };
  const previous=renderView;
  renderView=window.renderView=view=>{previous(view);if(view==='Favoritos')renderFavorites();};
  nav.onclick=()=>{document.querySelectorAll('.nav button,.channel').forEach(b=>b.classList.toggle('active',b===nav));renderView('Favoritos');};
  const paintScale=()=>{
    const parent=document.querySelector('.content>.grid>.right-col');if(!parent)return;
    let card=document.getElementById('dailyScale');
    if(!card){card=document.createElement('section');card.id='dailyScale';card.className='card daily-scale';card.innerHTML='<div class="card-head"><div><div class="card-title">Escala de hoje</div><div class="card-sub daily-scale-date"></div></div><button type="button" class="text-btn">Calendário →</button></div><div class="daily-scale-body" role="status"></div>';card.querySelector('button').onclick=()=>document.querySelector('.nav [data-view="Calendário"]')?.click();parent.prepend(card);}
    const stamp=date();card.querySelector('.daily-scale-date').textContent=new Date(stamp+'T12:00:00Z').toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'2-digit',timeZone:'UTC'});
    const body=card.querySelector('.daily-scale-body');let content;
    try{
      if(!calendar)content='<p class="daily-scale-empty">Carregando escala…</p>';
      else if(!calendar.config?.startDate||!Array.isArray(calendar.config.people)||calendar.config.people.length<2)content='<p class="daily-scale-empty">A escala ainda não foi configurada.</p>';
      else {
        const row=window.conectaKitchenRotation.generate(calendar.config,stamp)[stamp];
        const task=(label,name)=>`<div class="daily-task"><small>${label}</small><strong>${esc(name)}</strong></div>`;
        let items='';
        if(row?.dishes)items+=task('Lavar',row.wash||'Sem dupla disponível')+task('Secar',row.dry||'—');
        if(row?.sweep)items+=task('Varrer',row.sweeper||'Sem pessoa disponível');
        if(row?.coffee)items+=`<div class="daily-task daily-coffee"><small>Café · Turma ${row.coffeeGroup+1}</small><strong>${esc(row.coffeePeople.join(', '))}</strong></div>`;
        content=items?`<div class="daily-tasks">${items}</div>`:'<p class="daily-scale-empty">Sem tarefas programadas para hoje.</p>';
        if(row?.absent.length)content+=`<p class="daily-note">Ausentes: ${esc(row.absent.join(', '))}</p>`;
        if(row?.note)content+=`<p class="daily-note">${esc(row.note)}</p>`;
      }
    }catch{content='<p class="daily-scale-empty">Não foi possível calcular a escala. Confira o calendário.</p>';}
    if(body.innerHTML!==content)body.innerHTML=content;
  };
  let scheduled=false;
  const schedule=()=>{if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;paintStatus();paintMessages();paintScale();});};
  new MutationObserver(records=>{if(records.some(r=>[...r.addedNodes].some(n=>n.nodeType===1&&(n.matches('.message-row,.conversation-chat,.profile-grid')||n.querySelector('.message-row,.conversation-chat,.profile-grid')))))schedule();}).observe(document.body,{subtree:true,childList:true});
  window.addEventListener('conecta-team-status-sync',event=>{statuses=new Map((event.detail||[]).map(s=>[s.user_id,s]));schedule();});
  window.addEventListener('conecta-favorites-sync',event=>{favorites=event.detail||[];favoritesReady=true;paintMessages();if(visibleFavorites())paintFavoriteList();});
  window.addEventListener('conecta-kitchen-config-sync',event=>{calendar=event.detail;paintScale();});
  window.addEventListener('conecta-conversations-sync',()=>{if(visibleFavorites())paintFavoriteList();});
  window.addEventListener('conecta-profile-ready',schedule);
  window.addEventListener('conecta-auth-session-reset',()=>{statuses.clear();favorites=[];favoritesReady=false;calendar=null;pending.clear();statusDialog?.close();schedule();if(visibleFavorites())paintFavoriteList();});
  window.addEventListener('focus',()=>{paintScale();if(user())void api()?.loadPersonalData?.(user());});
  window.setInterval(paintScale,60_000);
  schedule();
})();
