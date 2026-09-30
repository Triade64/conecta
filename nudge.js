(() => {
  const NUDGE_TEXT = "🔔 Chamou sua atenção!";
  const COOLDOWN_MS = 30000;
  const seen = new Set();
  const cooldowns = new Map();
  let lastShake = 0;
  const userId = () => window.conectaCurrentUser?.id || window.conectaFirebase?.auth?.currentUser?.id;
  const key = conversationId => "conecta-nudge:" + userId() + ":" + conversationId;
  const lastSent = id => {
    let stored = 0;
    try { stored = Number(sessionStorage.getItem(key(id))) || 0; } catch {}
    return Math.max(cooldowns.get(key(id)) || 0, stored);
  };
  const markSent = id => {
    const time = Date.now();
    cooldowns.set(key(id), time);
    try { sessionStorage.setItem(key(id), String(time)); } catch {}
  };
  const installButton = () => {
    const composer = document.getElementById("composer");
    const conversation = contacts[selectedContact];
    if (!composer || conversation?.kind !== "direct" || !conversation.firestoreId || composer.querySelector(".nudge-button")) return;
    const id = conversation.firestoreId;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "nudge-button";
    button.textContent = "🔔";
    button.setAttribute("aria-label", "Chamar atenção");
    button.title = "Chamar atenção — estilo MSN";
    let busy = false, timer = null;
    const refresh = () => {
      if (!button.isConnected) { if (timer) clearInterval(timer); timer = null; return; }
      const seconds = Math.max(0, Math.ceil((COOLDOWN_MS - (Date.now() - lastSent(id))) / 1000));
      button.disabled = busy || seconds > 0;
      button.title = seconds ? "Aguarde " + seconds + " segundos para chamar novamente" : "Chamar atenção — estilo MSN";
      button.setAttribute("aria-label", seconds ? "Chamar atenção disponível em " + seconds + " segundos" : "Chamar atenção");
      if (!seconds && timer) { clearInterval(timer); timer = null; }
    };
    const startTimer = () => { refresh(); if (!timer && button.disabled) timer = setInterval(refresh, 1000); };
    button.addEventListener("click", async () => {
      const user = window.conectaFirebase?.auth?.currentUser;
      if (!user || !window.conectaFirebase?.sendMessage || busy || Date.now() - lastSent(id) < COOLDOWN_MS) return;
      busy = true; refresh();
      try {
        await window.conectaFirebase.sendMessage(user, id, NUDGE_TEXT);
        markSent(id);
        showToast("Você chamou a atenção de " + (conversation.name || "seu colega") + ".");
      } catch (error) {
        showToast(error?.message || "Não foi possível chamar atenção. Tente novamente.");
      } finally { busy = false; startTimer(); }
    });
    composer.insertBefore(button, composer.querySelector('button[type="submit"]'));
    startTimer();
  };
  const style = document.createElement("style");
  style.textContent = ".nudge-button{flex:0 0 auto;border:1px solid #dfe5dc;background:#fff;color:#315b3c;border-radius:8px;padding:7px 9px;font-size:18px;cursor:pointer}.nudge-button:hover{background:#edf2eb}.nudge-button:disabled{opacity:.45;cursor:default}";
  document.head.append(style);
  const previous = renderConversations;
  renderConversations = window.renderConversations = (...args) => { previous(...args); installButton(); };
  window.addEventListener("conecta-incoming-message-notification", event => {
    const detail = event.detail || {};
    if (!detail.isNudge || detail.conversationKind !== "direct" || !detail.id || detail.authorId === userId() || seen.has(detail.id)) return;
    seen.add(detail.id);
    if (seen.size > 200) seen.delete(seen.values().next().value);
    if (document.visibilityState !== "visible" || Date.now() - lastShake < 10000 || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const area = document.querySelector(".main");
    if (!area?.animate) return;
    lastShake = Date.now();
    area.animate([
      { transform: "translateX(0)" }, { transform: "translateX(-8px)" },
      { transform: "translateX(8px)" }, { transform: "translateX(-6px)" },
      { transform: "translateX(6px)" }, { transform: "translateX(-3px)" },
      { transform: "translateX(3px)" }, { transform: "translateX(0)" }
    ], { duration: 550, easing: "ease-in-out" });
  });
  window.addEventListener("conecta-auth-session-reset", () => { seen.clear(); cooldowns.clear(); lastShake = 0; });
  installButton();
})();
