(() => {
  window.conectaPositionMessageMenu = (menu, trigger, container) => {
    const anchor = trigger.getBoundingClientRect();
    const area = container.getBoundingClientRect();
    const left = Math.max(8, area.left + 6), right = Math.min(innerWidth - 8, area.right - 6);
    const top = Math.max(8, area.top + 6), bottom = Math.min(innerHeight - 8, area.bottom - 6);
    const availableWidth = Math.max(1, right - left), availableHeight = Math.max(1, bottom - top);
    Object.assign(menu.style, {
      position: 'fixed', bottom: 'auto', right: 'auto', top: '0px', left: '0px',
      minWidth: Math.min(150, availableWidth) + 'px', maxWidth: availableWidth + 'px',
      maxHeight: availableHeight + 'px', overflowY: 'auto', zIndex: '100'
    });
    const size = menu.getBoundingClientRect();
    const desiredTop = anchor.top - size.height - 5 >= top ? anchor.top - size.height - 5 : anchor.bottom + 5;
    menu.style.top = Math.max(top, Math.min(desiredTop, bottom - size.height)) + 'px';
    menu.style.left = Math.max(left, Math.min(anchor.right - size.width, right - size.width)) + 'px';
  };
  const close = () => document.querySelectorAll('.message-action-menu:not([hidden])').forEach(menu => { menu.hidden = true; });
  document.addEventListener('scroll', event => {
    if (event.target?.closest?.('.message-action-menu')) return;
    close();
  }, true);
  window.addEventListener('resize', close);
  document.addEventListener('click', event => {
    if (!event.target.closest('.message-actions')) close();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
})();
