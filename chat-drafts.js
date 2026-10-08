(() => {
  const prefix = 'conecta-chat-draft:';
  const userId = () => window.conectaCurrentUser?.id || window.conectaFirebase?.auth?.currentUser?.id || window.conectaFirebase?.auth?.currentUser?.uid;
  const key = id => userId() && id ? prefix + userId() + ':' + id : null;
  const text = input => input && 'value' in input ? input.value : (input?.innerText ?? input?.textContent ?? '');
  const save = form => {
    const id = form?.dataset.draftConversationId, storageKey = key(id);
    if (!storageKey || form.dataset.draftUserId !== userId()) return;
    try { const value = text(form.querySelector('#chatInput')); if (value) sessionStorage.setItem(storageKey, value); else sessionStorage.removeItem(storageKey); } catch {}
  };
  const clear = id => { try { const storageKey = key(id); if (storageKey) sessionStorage.removeItem(storageKey); } catch {} };
  document.addEventListener('input', event => { if (event.target.id === 'chatInput') save(event.target.closest('#composer')); });
  window.addEventListener('pagehide', () => save(document.getElementById('composer')));
  window.addEventListener('conecta-auth-session-reset', () => {
    const form = document.getElementById('composer'); if (form) { delete form.dataset.draftConversationId; delete form.dataset.draftUserId; }
    try { for (const storageKey of Object.keys(sessionStorage)) if (storageKey.startsWith(prefix)) sessionStorage.removeItem(storageKey); } catch {}
  });
  window.conectaDrafts = {
    clear,
    beforeRender(id) {
      const form = document.getElementById('composer'); save(form);
      if (!form || form.dataset.draftUserId !== userId() || form.dataset.draftConversationId !== id || !id) return null;
      const chat = form.closest('.conversation-chat'), messages = chat?.querySelector('.chat-messages');
      // A hidden conversation has no usable scroll position when reopened.
      if (!messages || !messages.getClientRects().length || messages.clientHeight === 0) return null;
      const selection = window.getSelection(), focused = document.activeElement;
      const range = selection?.rangeCount && form.contains(selection.anchorNode) ? {anchor:selection.anchorNode,anchorOffset:selection.anchorOffset,focus:selection.focusNode,focusOffset:selection.focusOffset} : null;
      return {chat,focused:chat?.contains(focused) ? focused : null,range,scrollTop:messages?.scrollTop || 0,atBottom:!messages || messages.scrollHeight - messages.clientHeight - messages.scrollTop < 40};
    },
    retain(state) {
      const next = document.querySelector('.conversation-chat');
      if (!state?.chat || !next) return;
      for (const selector of ['.chat-head','.chat-messages']) {
        const incoming = next.querySelector(selector), old = state.chat.querySelector(selector);
        if (incoming && old) old.replaceWith(incoming);
      }
      next.replaceWith(state.chat);
    },
    afterRender(id,state) {
      const form = document.getElementById('composer'), input = document.getElementById('chatInput');
      if (!form || !input) return;
      const isNew = form.dataset.draftConversationId !== id;
      form.dataset.draftConversationId = id || '';
      form.dataset.draftUserId = userId() || '';
      if (isNew) {
        let draft = ''; try { draft = sessionStorage.getItem(key(id)) || ''; } catch {}
        if (draft) { if ('value' in input) input.value = draft; else input.textContent = draft; }
      }
      if (state?.focused?.isConnected) {
        state.focused.focus({preventScroll:true});
        if (state.range?.anchor.isConnected && state.range?.focus.isConnected) { window.getSelection().setBaseAndExtent(state.range.anchor,state.range.anchorOffset,state.range.focus,state.range.focusOffset); }
      }
      const messages = document.getElementById('chatMessages');
      if (!messages) return;
      if (state && !state.atBottom) { messages.scrollTop = state.scrollTop; return; }
      // Opening/reopening a conversation follows the latest messages after layout settles.
      messages.scrollTop = messages.scrollHeight;
      const expectedTop = messages.scrollTop;
      window.requestAnimationFrame(() => {
        if (messages.isConnected && form.dataset.draftConversationId === id && messages.scrollTop === expectedTop) messages.scrollTop = messages.scrollHeight;
      });
    }
  };
})();
