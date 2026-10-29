(() => {
  const api=()=>window.conectaFirebase;
  const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
  window.conectaHistoryUI={mount(box,id){
    const state=api()?.getMessageHistoryState?.(id);
    if(!state||(!state.hasMore&&!state.context))return;
    const bar=document.createElement('div');bar.className='message-history-controls';
    if(state.context){const label=document.createElement('span');label.textContent='Histórico da mensagem selecionada';bar.append(label);
      const latest=document.createElement('button');latest.type='button';latest.className='text-btn';latest.textContent='Voltar às mensagens recentes';
      latest.onclick=async()=>{latest.disabled=true;try{await api().loadLatestMessages(id);await frame();if(api().getMessageHistoryState(id)) {const current=document.getElementById('chatMessages');if(current)current.scrollTop=current.scrollHeight;}}catch(error){showToast(error.message||'Não foi possível carregar as mensagens.');latest.disabled=false;}};
      bar.append(latest);
    }
    if(state.hasMore){const button=document.createElement('button');button.type='button';button.className='text-btn';button.textContent='Carregar mensagens anteriores';
      button.onclick=async()=>{
        const bounds=box.getBoundingClientRect();const anchor=[...box.querySelectorAll('.bubble[data-message-id]')].find(node=>node.getBoundingClientRect().bottom>bounds.top);
        const anchorId=anchor?.dataset.messageId,offset=anchor?anchor.getBoundingClientRect().top-bounds.top:0;
        const previousHeight=box.scrollHeight,previousTop=box.scrollTop;
        button.disabled=true;button.textContent='Carregando…';
        try{await api().loadOlderMessages(id);await frame();if(!api().getMessageHistoryState(id))return;
          const current=document.getElementById('chatMessages');if(!current)return;
          const target=[...current.querySelectorAll('.bubble[data-message-id]')].find(node=>node.dataset.messageId===anchorId);
          if(target)current.scrollTop+=target.getBoundingClientRect().top-current.getBoundingClientRect().top-offset;
          else current.scrollTop=previousTop+current.scrollHeight-previousHeight;
        }catch(error){showToast(error.message||'Não foi possível carregar o histórico.');button.disabled=false;button.textContent='Tentar carregar anteriores';}
      };bar.append(button);
    }
    box.prepend(bar);
  }};
})();
