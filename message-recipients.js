(() => {
  const mount = select => {
    select.multiple = true;select.hidden = true;
    for (const option of select.options) option.selected = false;
    select.querySelector('option[value=""]')?.remove();
    const field=select.closest('.field'),oldLabel=field.querySelector('label');oldLabel.removeAttribute('for');
    const list=document.createElement('div');list.className='message-recipients';list.setAttribute('role','group');list.setAttribute('aria-label','Destinatários da mensagem');
    const note=document.createElement('small');note.className='recipient-summary';note.textContent='Selecione uma ou mais pessoas ou canais.';
    field.append(list,note);
    const refresh=()=>{
      const checks=new Map([...list.querySelectorAll('input')].map(check=>[check.value,check.closest('label')]));
      for(const group of select.querySelectorAll('optgroup')){
        let heading=list.querySelector('[data-group="'+group.label+'"]');
        if(!heading){heading=document.createElement('strong');heading.dataset.group=group.label;heading.className='recipient-group';heading.textContent=group.label;list.append(heading);}
        list.append(heading);
        for(const option of group.querySelectorAll('option')){
          if(!option.value || option.disabled)continue;
          let row=checks.get(option.value);
          if(!row){row=document.createElement('label');const check=document.createElement('input');check.type='checkbox';check.value=option.value;const text=document.createElement('span');row.append(check,text);check.onchange=()=>{option.selected=check.checked;refresh();};}
          row.querySelector('input').checked=option.selected;row.querySelector('input').disabled=select.disabled;
          row.querySelector('span').textContent=option.textContent;list.append(row);
        }
      }
      note.textContent=select.selectedOptions.length ? `${select.selectedOptions.length} destinatário(s) selecionado(s).` : 'Selecione uma ou mais pessoas ou canais.';
    };
    select.__refreshRecipients=refresh;select.addEventListener('change',refresh);refresh();
  };
  window.conectaRecipients={mount,refresh:()=>document.getElementById('destination')?.__refreshRecipients?.()};
  const style=document.createElement('style');style.textContent='.message-recipients{max-height:min(32vh,270px);overflow:auto;border:1px solid var(--line);border-radius:9px;padding:8px}.message-recipients label{display:flex;align-items:center;gap:9px;padding:8px 4px;cursor:pointer;font-size:12px;font-weight:400}.message-recipients input{width:16px;height:16px;min-height:0;flex:0 0 16px;accent-color:#285237}.recipient-group{display:block;color:var(--muted);font-size:10px;text-transform:uppercase;padding:7px 4px}.recipient-summary{font-size:11px;color:var(--muted)}';document.head.append(style);
})();
