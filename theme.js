(() => {
  const key = 'conecta-theme';
  const root = document.documentElement;
  let theme = 'light';
  try { if (localStorage.getItem(key) === 'dark') theme = 'dark'; } catch (_) {}
  function apply(value) {
    theme = value === 'dark' ? 'dark' : 'light';
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? '#141c18' : '#223e2a';
    const button = document.getElementById('themeToggle');
    if (button) {
      button.textContent = theme === 'dark' ? '☀' : '☾';
      button.title = theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro';
      button.setAttribute('aria-label', button.title);
      button.setAttribute('aria-pressed', String(theme === 'dark'));
    }
  }
  apply(theme);
  document.addEventListener('DOMContentLoaded', () => {
    const actions = document.querySelector('.top-actions');
    if (!actions) return;
    const button = document.createElement('button');
    button.id = 'themeToggle'; button.type = 'button'; button.className = 'icon-btn theme-toggle';
    button.onclick = () => {
      apply(theme === 'dark' ? 'light' : 'dark');
      try { localStorage.setItem(key, theme); } catch (_) {}
    };
    actions.prepend(button);
    apply(theme);
  });
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) apply(event.newValue);
  });
})();
