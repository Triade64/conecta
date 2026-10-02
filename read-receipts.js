(() => {
  const receipts = new Map(), recorded = new Map(), busy = new Set();let timer, generation = 0;
  const active = () => typeof contacts !== 'undefined' ? contacts[typeof selectedContact !== 'undefined' ? selectedContact : -1] : null;
  const user = () => window.conectaCurrentUser || window.conectaFirebase?.auth?.currentUser;
  const style=document.createElement('style');style.textContent='.message-read-receipt{display:inline-block;margin-left:7px;font-size:14px;font-weight:750;letter-spacing:-4px;padding-right:4px;line-height:1;color:#84918a}.message-read-receipt.is-read{color:#168bcc}.bubble small:has(.message-read-receipt){opacity:1}.message-read-receipt.is-read{font-weight:800}';document.head.append(style);
  const paint = () => {
    const conversation=active();if(conversation?.kind!=='direct')return;
    const otherRead=(receipts.get(conversation.firestoreId)||[]).find(r=>r.user_id===conversation.directUserId)?.last_read_at;
    const watermark=Date.parse(otherRead || '');
    document.querySelectorAll('#chatMessages .message-row.mine .bubble').forEach(bubble=>{
      if(!bubble.dataset.messageId || bubble.dataset.deleted==='true' || !bubble.dataset.createdAt)return;
      const time=bubble.querySelector('small');if(!time)return;
      let mark=time.querySelector('.message-read-receipt');if(!mark){mark=document.createElement('span');mark.className='message-read-receipt';mark.textContent='✓✓';time.append(mark);}
      const read=Number.isFinite(watermark)&&Date.parse(bubble.dataset.createdAt)<=watermark;
      mark.classList.toggle('is-read',read);mark.title=read?'Visualizada pelo destinatário':'Enviada • ainda sem confirmação de leitura';mark.setAttribute('aria-label',read?'Mensagem visualizada':'Mensagem enviada');
    });
  };
  const recordVisible = async () => {
    const conversation=active(), owner=user(), box=document.getElementById('chatMessages');
    if(!conversation?.firestoreId || !owner?.id || !box || !document.querySelector('#viewPanel.show') || document.visibilityState!=='visible' || !document.hasFocus())return;
    const bounds=box.getBoundingClientRect();if(bounds.height<=0)return;
    let cutoff=null;
    box.querySelectorAll('.bubble[data-created-at]').forEach(bubble=>{if(bubble.dataset.deleted==='true')return;const r=bubble.getBoundingClientRect(),at=bubble.dataset.createdAt;if(r.bottom>bounds.top+4&&r.top<bounds.bottom-4&&Number.isFinite(Date.parse(at))&&(!cutoff||Date.parse(at)>Date.parse(cutoff)))cutoff=at;});
    const key=owner.id+':'+conversation.firestoreId;
    if(!cutoff || busy.has(key) || Date.parse(recorded.get(key)||'')>=Date.parse(cutoff) || !window.conectaFirebase?.markConversationRead)return;
    busy.add(key);const token=generation;
    try{await window.conectaFirebase.markConversationRead(owner,conversation.firestoreId,cutoff);if(token===generation)recorded.set(key,cutoff);}
    catch(error){console.warn('Could not record visible messages',error);}
    finally{busy.delete(key);if(token===generation && recorded.has(key))schedule();}
  };
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(()=>{paint();void recordVisible();},200);};
  new MutationObserver(records=>{if(records.some(r=>[...r.addedNodes].some(n=>n.nodeType===1&&(n.matches('.message-row,.conversation-chat')||n.querySelector('.message-row,.conversation-chat')))))schedule();}).observe(document.body,{childList:true,subtree:true});
  window.addEventListener('conecta-read-receipts-sync',event=>{const d=event.detail||{};if(!d.conversationId)return;receipts.set(d.conversationId,d.reads||[]);paint();});
  window.addEventListener('focus',()=>{const id=active()?.firestoreId;if(id)void window.conectaFirebase?.loadReadReceipts?.(id);schedule();});
  document.addEventListener('visibilitychange',schedule);document.addEventListener('scroll',schedule,true);document.addEventListener('focusin',schedule);
  window.addEventListener('conecta-auth-session-reset',()=>{generation++;clearTimeout(timer);receipts.clear();recorded.clear();busy.clear();});
  schedule();
})();
