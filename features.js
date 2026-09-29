(() => {
  const currentUserId = () => window.conectaCurrentUser?.id || window.conectaFirebase?.auth?.currentUser?.uid || null;
  const currentUser = () => window.conectaFirebase?.auth?.currentUser;
  const notificationPrefsKey = () => `conecta-browser-notifications:${currentUserId() || "guest"}`;
  const browserNotificationsEnabled = () => { try { return localStorage.getItem(notificationPrefsKey()) === "true"; } catch { return false; } };
  const showBrowserNotification = (title, body, tag) => {
    if (!browserNotificationsEnabled() || !("Notification" in window) || Notification.permission !== "granted") return false;
    try { new Notification(title, { body, tag,  }); return true; } catch { return false; }
  };
  const setProfileAvatar = (element, url, label = "") => {
    if (!element) return;
    element.setAttribute("aria-label", label || "Foto do perfil");
    element.style.backgroundImage = url ? `url("${url.replace(/["\\\\]/g, "")}")` : "";
    element.style.backgroundSize = url ? "cover" : "";
    element.style.backgroundPosition = url ? "center" : "";
    element.style.backgroundRepeat = url ? "no-repeat" : "";
    if (url) element.textContent = "";
  };
  const optimizeProfilePhoto = async file => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Escolha uma foto JPG, PNG ou WEBP.");
    if (file.size > 12 * 1024 * 1024) throw new Error("A foto original precisa ter até 12 MB.");
    const bitmap = await createImageBitmap(file);
    try {
      const edge = Math.min(bitmap.width, bitmap.height);
      const sx = Math.floor((bitmap.width - edge) / 2);
      const sy = Math.floor((bitmap.height - edge) / 2);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 512;
      canvas.getContext("2d").drawImage(bitmap, sx, sy, edge, edge, 0, 0, 512, 512);
      const encode = quality => new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Não foi possível tratar esta foto.")), "image/webp", quality));
      let blob = await encode(0.84);
      if (blob.size > 250 * 1024) blob = await encode(0.7);
      if (blob.size > 300 * 1024) throw new Error("Não foi possível reduzir esta foto ao limite permitido. Escolha outra imagem.");
      return new File([blob], "avatar.webp", { type: "image/webp", lastModified: Date.now() });
    } finally { bitmap.close?.(); }
  };
  const isActiveAdmin = () => window.conectaCurrentProfile?.role === "admin" && window.conectaCurrentProfile?.active === true;
  const byId = id => document.getElementById(id);
  const writeCount = (id, count) => { if (byId(id)) byId(id).textContent = String(count); };
  const plural = (count, one, many) => count === 1 ? one : many;
  const optimizeGlobalAnnouncementImage = async file => {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) throw new Error("Selecione uma imagem JPG, PNG ou WEBP.");
    if (file.size > 15 * 1024 * 1024) throw new Error("A imagem original precisa ter até 15 MB.");
    if (!window.createImageBitmap) throw new Error("Este navegador não permite otimizar a imagem. Atualize o navegador e tente novamente.");
    const bitmap = await createImageBitmap(file);
    try {
      if (bitmap.width * bitmap.height > 60_000_000) throw new Error("A resolução da imagem é muito alta. Reduza a imagem e tente novamente.");
      const makeCanvas = maxEdge => {
        const scale = Math.min(1, maxEdge / bitmap.width, maxEdge / bitmap.height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext("2d", { alpha: true }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return canvas;
      };
      const encode = (canvas, quality) => new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Não foi possível otimizar esta imagem.")), "image/webp", quality));
      let blob;
      for (const [edge, qualities] of [[1600, [0.82, 0.74, 0.66, 0.58, 0.5]], [1200, [0.68, 0.58, 0.48]], [1000, [0.48, 0.4]]]) {
        const canvas = makeCanvas(edge);
        for (const quality of qualities) {
          blob = await encode(canvas, quality);
          if (blob.type === "image/webp" && blob.size <= 900 * 1024) break;
        }
        canvas.width = 1; canvas.height = 1;
        if (blob?.type === "image/webp" && blob.size <= 900 * 1024) break;
      }
      if (!blob || blob.type !== "image/webp" || blob.size > 900 * 1024) throw new Error("Não foi possível reduzir a imagem para menos de 900 KB. Escolha outra imagem.");
      return new File([blob], `aviso-${Date.now()}.webp`, { type: "image/webp", lastModified: Date.now() });
    } finally { bitmap.close?.(); }
  };
  const unreadStyle = document.createElement("style");
  unreadStyle.textContent = ".conversation-list .chat-name{display:flex;align-items:center;justify-content:space-between;gap:8px}.conversation-list .unread-badge{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;min-width:21px;height:21px;padding:0 6px;border-radius:999px;background:#223e2a;color:#fff;font-size:11px;font-weight:700;line-height:1}.conversation-list .unread-badge[hidden]{display:none}";
  document.head.append(unreadStyle);
  const updateUnreadBadges = () => {
    document.querySelectorAll(".conversation-list .conv-item").forEach(button => {
      const contact = contacts[Number(button.dataset.contact)];
      const label = button.querySelector(".chat-name");
      if (!label || !contact) return;
      label.querySelector(".unread-badge")?.remove();
      const count = Number(contact.unreadCount) || 0;
      if (!count) return;
      const badge = document.createElement("span");
      badge.className = "unread-badge";
      badge.textContent = count > 99 ? "99+" : String(count);
      badge.setAttribute("aria-label", `${count} ${count === 1 ? "mensagem não lida" : "mensagens não lidas"}`);
      badge.title = badge.getAttribute("aria-label");
      label.append(badge);
    });
  };
  window.addEventListener("conecta-unread-sync", event => {
    const counts = event.detail || {};
    const totalUnread = Object.values(counts).reduce((sum, value) => sum + (Number(value) || 0), 0);
    writeCount("unreadCount", totalUnread);
    writeCount("conversationNavCount", totalUnread);
    writeNavCount("conversationNavCount", totalUnread);
    if (byId("unreadStatNote")) byId("unreadStatNote").textContent = totalUnread ? `${totalUnread} ${plural(totalUnread, "mensagem não lida", "mensagens não lidas")}` : "nenhuma pendência";
    contacts.forEach(contact => { contact.unreadCount = Number(counts[contact.firestoreId]) || 0; });
    updateUnreadBadges();
    if (typeof renderDashboardConversations === "function") renderDashboardConversations();
  });
  const addButton = (parent, label, className, onClick) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); onClick(); });
    parent.append(button);
    return button;
  };
  const badgeStyle = document.createElement("style");
  badgeStyle.textContent = ".nav .count.has-items{background:#223e2a;color:#fff;border-radius:999px;min-width:22px;text-align:center;font-weight:700;box-shadow:0 0 0 2px #e8eee7}";
  document.head.append(badgeStyle);
  const writeNavCount = (id, count) => {
    const badge = byId(id);
    if (!badge) return;
    const value = Number(count) || 0;
    badge.textContent = value > 99 ? "99+" : String(value);
    badge.classList.toggle("has-items", value > 0);
    badge.setAttribute("aria-label", value ? `${value} ${id === "noticeNavCount" ? plural(value, "aviso", "avisos") : id === "reminderNavCount" ? plural(value, "lembrete pendente", "lembretes pendentes") : plural(value, "mensagem não lida", "mensagens não lidas")}` : "Nenhuma pendência");
  };
  const reminderAlertStyle = document.createElement("style");
  reminderAlertStyle.textContent = ".reminder-alerts{position:fixed;right:22px;bottom:22px;z-index:9500;width:min(390px,calc(100vw - 32px));padding:16px;background:#fff;border:1px solid #e6d2aa;border-left:4px solid #d99a3e;border-radius:14px;box-shadow:0 16px 42px #18231929}.reminder-alerts[hidden]{display:none}.reminder-alert-head{display:flex;align-items:center;justify-content:space-between;gap:12px;font-weight:700}.reminder-alert-list{display:grid;gap:9px;margin:13px 0}.reminder-alert-item{font-size:13px}.reminder-alert-item small{display:block;color:#8a8e87;margin-top:3px}.reminder-alert-actions{display:flex;justify-content:space-between;align-items:center}.reminder-alert-close{border:0;background:transparent;color:#6d746d;font-size:19px}.reminder-alert-link{border:0;background:transparent;color:#315b3c;font-weight:700;padding:5px 0}";
  document.head.append(reminderAlertStyle);
  const getDismissedReminderAlerts = () => {
    try { return new Set(JSON.parse(sessionStorage.getItem(`conecta-dismissed-reminders:${currentUserId() || "guest"}`) || "[]")); }
    catch { return new Set(); }
  };
  const saveDismissedReminderAlerts = dismissed => {
    try { sessionStorage.setItem(`conecta-dismissed-reminders:${currentUserId() || "guest"}`, JSON.stringify([...dismissed])); }
    catch { /* session storage may be unavailable in private browsing */ }
  };
  const renderReminderAlerts = () => {
    let box = byId("reminderAlerts");
    if (!box) {
      box = document.createElement("aside");
      box.id = "reminderAlerts";
      box.className = "reminder-alerts";
      box.setAttribute("role", "status");
      box.setAttribute("aria-live", "polite");
      document.body.append(box);
    }
    const now = Date.now();
    const cutoff = now + 24 * 60 * 60 * 1000;
    const dismissed = getDismissedReminderAlerts();
    const due = (Array.isArray(reminders) ? reminders : [])
      .filter(item => !item.done && item.id && item.due_at)
      .map(item => ({ ...item, dueTime: new Date(item.due_at).getTime() }))
      .filter(item => Number.isFinite(item.dueTime) && item.dueTime <= cutoff && !dismissed.has(`${item.id}:${item.due_at}`))
      .sort((a, b) => a.dueTime - b.dueTime);
    if (document.visibilityState !== "visible" && browserNotificationsEnabled() && "Notification" in window && Notification.permission === "granted") {
      const key = `conecta-notified-reminders:${currentUserId() || "guest"}`;
      let sent = [];
      try { sent = JSON.parse(localStorage.getItem(key) || "[]"); } catch {}
      const sentSet = new Set(sent);
      due.forEach(item => {
        const reminderKey = `${item.id}:${item.due_at}`;
        if (sentSet.has(reminderKey)) return;
        showBrowserNotification("Lembrete próximo do vencimento", item.title || "Um lembrete vence nas próximas 24 horas.", reminderKey);
        sentSet.add(reminderKey);
      });
      try { localStorage.setItem(key, JSON.stringify([...sentSet].slice(-100))); } catch {}
    }
    if (!due.length) { box.hidden = true; return; }
    box.hidden = false;
    box.replaceChildren();
    const header = document.createElement("div");
    header.className = "reminder-alert-head";
    const title = document.createElement("span");
    title.textContent = "Lembretes próximos";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "reminder-alert-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "Dispensar avisos de lembretes");
    header.append(title, close);
    const list = document.createElement("div");
    list.className = "reminder-alert-list";
    due.slice(0, 4).forEach(item => {
      const row = document.createElement("div");
      row.className = "reminder-alert-item";
      const name = document.createElement("strong");
      name.textContent = item.title || "Lembrete";
      const time = document.createElement("small");
      const dueDate = new Date(item.dueTime);
      const when = dueDate.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
      time.textContent = item.dueTime < now ? `Atrasado · ${when}` : `Vence em breve · ${when}`;
      row.append(name, time);
      list.append(row);
    });
    const actions = document.createElement("div");
    actions.className = "reminder-alert-actions";
    const more = document.createElement("span");
    more.textContent = due.length > 4 ? `+${due.length - 4} outros` : "";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "reminder-alert-link";
    open.textContent = "Ver lembretes →";
    actions.append(more, open);
    const dismiss = () => {
      due.forEach(item => dismissed.add(`${item.id}:${item.due_at}`));
      saveDismissedReminderAlerts(dismissed);
      box.hidden = true;
    };
    close.onclick = dismiss;
    open.onclick = () => {
      dismiss();
      document.querySelector('[data-view="Lembretes"]')?.click();
    };
    box.append(header, list, actions);
  };
  window.addEventListener("conecta-incoming-message-notification", event => {
    const detail = event.detail || {};
    if (!detail.id) return;
    const body = `${detail.authorName || "Um colaborador"} enviou uma mensagem em ${detail.conversationName || "uma conversa"}.`;
    if (document.visibilityState === "visible") showToast(body);
    else showBrowserNotification("Nova mensagem", body, `message-${detail.id}`);
  });
  window.addEventListener("conecta-profile-photo-sync", event => {
    const detail = event.detail || {};
    if (detail.id === currentUserId()) setProfileAvatar(byId("currentUserInitials"), detail.avatar_url, "Sua foto de perfil");
    document.querySelectorAll(".message-row").forEach(row => {
      const messageId = row.querySelector(".bubble")?.dataset.messageId;
      const message = contacts[selectedContact]?.messages?.find(item => item.id === messageId);
      if (message?.authorId === detail.id) setProfileAvatar(row.querySelector(".message-avatar"), detail.avatar_url, message.authorName);
    });
  });
  window.addEventListener("conecta-profile-ready", event => {
    const profile = event.detail || {};
    if (profile.avatar_url) setProfileAvatar(byId("currentUserInitials"), profile.avatar_url, "Sua foto de perfil");
  });
  const showError = error => {
    console.error("Conecta action failed", error);
    showToast(error?.message || "Não foi possível concluir a ação.");
  };
  const refreshMessages = async conversation => {
    const fb = window.conectaFirebase;
    await fb.watchMessages(conversation.firestoreId, messages => {
      conversation.messages = messages.map(message => ({
        id: message.id,
        authorId: message.authorId || message.author_id,
        authorName: message.authorName || message.author_name || "",
        text: message.text,
        time: syncDate(message.createdAt || message.created_at) || "Agora",
        mine: (message.authorId || message.author_id) === currentUserId(),
        replyTo: message.replyTo || message.reply_to || null,
        editedAt: message.editedAt || message.edited_at || null,
        deletedAt: message.deletedAt || message.deleted_at || null
      }));
      renderConversations(undefined, false);
    });
  };

  const baseOpenModal = openModal;
  openModal = window.openModal = type => {
    baseOpenModal(type);
    const form = byId("form");
    delete form.dataset.featureAction;
    delete form.dataset.recordId;
    if (type === "message") {
      const destination = byId("destination");
      if (destination) {
        const directory = window.conectaDirectory || [];
        const people = directory.map(person => `<option value="user:${person.id}">${escapeHtml(person.name || "Colaborador")} — ${escapeHtml(person.sector || person.role || "Equipe")}</option>`).join("");
        const channels = allowedSectors().map(sector => `<option value="channel:${escapeHtml(sector)}">${escapeHtml(sector)}</option>`).join("");
        destination.innerHTML = `<option value="" disabled selected>Selecione um destino</option><optgroup label="Conversa individual">${people || '<option disabled>Nenhum colaborador disponível</option>'}</optgroup><optgroup label="Canais permitidos">${channels}</optgroup>`;
      }
      byId("modalDesc").textContent = "Inicie uma conversa individual com qualquer colaborador ou envie ao canal do seu setor.";
    }
  };

  const baseRenderNotices = renderNotices;
  renderNotices = window.renderNotices = () => {
    baseRenderNotices();
    const uid = currentUserId();
    const admin = isActiveAdmin();
    const filter = byId("noticeFilter")?.value || "Todos";
    const visible = filter === "Todos" ? notices : notices.filter(item => item.sector === filter);
    document.querySelectorAll(".notice-card").forEach((card, index) => {
      const item = visible[index];
      if (!item?.id || (item.author_id !== uid && !admin) || card.querySelector(".record-actions")) return;
      const actions = document.createElement("div");
      actions.className = "record-actions";
      if (item.author_id === uid || admin) addButton(actions, "Editar", "record-action", () => {
          openModal("notice");
          byId("modalTitle").textContent = "Editar aviso";
          byId("modalDesc").textContent = "Altere o conteúdo e o setor deste aviso.";
          byId("title").value = item.title || "";
          const sector = String(item.sector || "Geral").toLowerCase();
          byId("sector").value = sector.includes("fiscal") ? "Fiscal" : sector.includes("contáb") || sector.includes("contab") ? "Contábil" : sector.includes("pessoal") ? "Departamento Pessoal" : "Geral";
          byId("message").value = item.body || item.text || "";
          byId("form").dataset.featureAction = "edit-notice";
          byId("form").dataset.recordId = item.id;
        });
      addButton(actions, "Excluir", "record-action danger", async () => {
        if (!confirm("Excluir este aviso para todos que podem visualizá-lo?")) return;
        try {
          await window.conectaFirebase.deleteNotice(item.id);
          notices = notices.filter(row => row.id !== item.id);
          renderNotices();
          showToast("Aviso excluído.");
        } catch (error) { showError(error); }
      });
      card.append(actions);
    });
  };

  const baseRenderReminders = renderReminders;
  renderReminders = window.renderReminders = () => {
    baseRenderReminders();
    const pending = reminders.filter(reminder => !reminder.done).length;
    writeCount("remCount", pending);
    writeCount("reminderNavCount", pending);
    writeNavCount("reminderNavCount", pending);
    if (byId("reminderStatNote")) byId("reminderStatNote").textContent = pending ? `${pending} ${plural(pending, "lembrete pendente", "lembretes pendentes")}` : "nenhum lembrete pendente";
    renderReminderAlerts();
    const uid = currentUserId();
    // Completion must be persisted in Supabase; the legacy renderer only changed local state.
    document.querySelectorAll("#reminders .reminder, #fullReminders .reminder").forEach(row => {
      const box = row.closest("#fullReminders") ? byId("fullReminders") : byId("reminders");
      const listIndex = [...box.querySelectorAll(".reminder")].indexOf(row);
      const item = reminders[listIndex];
      const check = row.querySelector(".check");
      if (!check) return;
      check.onclick = async () => {
        if (!item?.id) {
          showToast("Este lembrete ainda não foi sincronizado.");
          return;
        }
        const done = !item.done;
        check.disabled = true;
        try {
          await window.conectaFirebase.updateReminder(item.id, { done });
          reminders = reminders.map(reminder => reminder.id === item.id ? { ...reminder, done } : reminder);
          save();
          renderReminders();
          if (byId("viewPanel")?.classList.contains("show") && byId("crumb")?.textContent === "Lembretes") renderView("Lembretes");
          showToast(done ? "Lembrete concluído." : "Lembrete reaberto.");
        } catch (error) {
          showError(error);
          check.disabled = false;
        }
      };
    });
    document.querySelectorAll("#reminders .reminder, #fullReminders .reminder").forEach((row, index) => {
      const box = row.closest("#fullReminders") ? byId("fullReminders") : byId("reminders");
      if (box?.id === "fullReminders") row.querySelector(".record-actions")?.remove();
      const listIndex = [...box.querySelectorAll(".reminder")].indexOf(row);
      const item = reminders[listIndex];
      if (!item?.id || item.owner_id !== uid || row.querySelector(".record-actions")) return;
      const actions = document.createElement("div");
      actions.className = "record-actions";
      addButton(actions, "Editar", "record-action", () => {
        openModal("reminder");
        byId("modalTitle").textContent = "Editar lembrete";
        byId("modalDesc").textContent = "Altere o título ou a data deste lembrete.";
        byId("title").value = item.title || "";
        if (item.due_at) {
          const due = new Date(item.due_at);
          byId("when").value = new Date(due.getTime() - due.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        }
        byId("form").dataset.featureAction = "edit-reminder";
        byId("form").dataset.recordId = item.id;
      });
      addButton(actions, "Excluir", "record-action danger", async () => {
        if (!confirm("Excluir este lembrete?")) return;
        try {
          await window.conectaFirebase.deleteReminder(item.id);
          reminders = reminders.filter(entry => entry.id !== item.id);
          renderReminders();
          showToast("Lembrete excluído.");
        } catch (error) { showError(error); }
      });
      row.append(actions);
    });
  };

  const baseRenderView = renderView;
  renderView = window.renderView = view => {
    baseRenderView(view);
    if (view === "Lembretes") renderReminders();
  };

  const addEmojiPicker = conversation => {
    const composer = byId("composer"), input = byId("chatInput");
    if (!composer || !input || composer.querySelector(".emoji-compose-tools")) return;
    const emojis = ["😀","😃","😄","😁","😅","😂","🤣","😊","😉","😍","🥰","😘","🤔","😮","😢","😭","😎","🥳","🙏","👏","👍","👎","❤️","💚","🔥","✨","🎉","✅","👀","🤝","💪","📌","💡","☕","📣","🙌"];
    const tools = document.createElement("div");
    tools.className = "emoji-compose-tools";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "emoji-toggle";
    toggle.textContent = "😀";
    toggle.setAttribute("aria-label", "Abrir seletor de emojis");
    toggle.setAttribute("aria-expanded", "false");
    const picker = document.createElement("div");
    picker.className = "emoji-picker";
    picker.hidden = true;
    picker.setAttribute("role", "group");
    picker.setAttribute("aria-label", "Emojis");
    let savedRange = null;
    const saveSelection = () => {
      const selection = window.getSelection();
      if (selection?.rangeCount && input.contains(selection.anchorNode)) savedRange = selection.getRangeAt(0).cloneRange();
    };
    input.addEventListener("keyup", saveSelection);
    input.addEventListener("click", saveSelection);
    input.addEventListener("input", saveSelection);
    emojis.forEach(emoji => {
      const choice = document.createElement("button");
      choice.type = "button";
      choice.className = "emoji-choice";
      choice.textContent = emoji;
      choice.setAttribute("aria-label", emoji);
      choice.addEventListener("pointerdown", event => { event.preventDefault(); saveSelection(); });
      choice.addEventListener("click", () => {
        input.focus();
        let range = savedRange?.cloneRange();
        if (!range || !input.contains(range.startContainer)) {
          range = document.createRange();
          range.selectNodeContents(input);
          range.collapse(false);
        }
        range.deleteContents();
        const node = document.createTextNode(emoji);
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        savedRange = range.cloneRange();
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      picker.append(choice);
    });
    toggle.addEventListener("click", () => {
      picker.hidden = !picker.hidden;
      toggle.setAttribute("aria-expanded", String(!picker.hidden));
    });
    tools.append(toggle, picker);
    composer.before(tools);
    composer.closest(".conversation-chat")?.addEventListener("click", event => {
      if (!tools.contains(event.target)) { picker.hidden = true; toggle.setAttribute("aria-expanded", "false"); }
    });
  };
  const emojiStyle = document.createElement("style");
  emojiStyle.textContent = ".emoji-compose-tools{position:relative;display:flex;justify-content:flex-end;padding:4px 10px 0}.emoji-toggle{border:0;background:transparent;border-radius:8px;padding:5px 8px;font-size:21px;cursor:pointer}.emoji-toggle:hover{background:#edf2eb}.emoji-picker{position:absolute;right:8px;bottom:42px;z-index:8;width:min(300px,calc(100vw - 60px));padding:8px;background:#fff;border:1px solid #dfe5dc;border-radius:12px;box-shadow:0 10px 28px #18231924;display:grid;grid-template-columns:repeat(6,1fr);gap:3px}.emoji-picker[hidden]{display:none}.emoji-choice{border:0;background:transparent;border-radius:7px;padding:6px 2px;font-size:21px;cursor:pointer}.emoji-choice:hover{background:#edf2eb}.composer .chat-rich-input{flex:1;min-height:40px;max-height:130px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:10px 12px;outline:none;white-space:pre-wrap;overflow-wrap:anywhere}.composer .chat-rich-input:focus{border-color:#9aaf9a;box-shadow:0 0 0 2px #e8eee7}.composer .chat-rich-input:empty:before{content:attr(data-placeholder);color:#8b928d}.chat-gif-preview{display:flex;align-items:center;gap:10px;padding:8px 12px;border-top:1px solid var(--line)}.chat-gif-preview[hidden]{display:none}.chat-gif-preview img{max-width:170px;max-height:110px;object-fit:contain;border-radius:8px}.chat-gif-preview button{border:0;background:transparent;border-radius:8px;padding:5px 8px;cursor:pointer}.bubble .message-attachment{display:block;max-width:min(240px,70vw);max-height:320px;border-radius:10px;object-fit:contain;margin-bottom:4px}.profile-photo-area{display:flex;align-items:center;gap:14px;margin:16px 0}.profile-photo-preview[hidden]{display:none!important}.profile-photo-preview{width:76px;height:76px;border-radius:50%;display:grid;place-items:center;flex:0 0 76px;background:#e8eee7;color:#223e2a;font-weight:700;font-size:22px;object-fit:cover}.profile-photo-controls{display:grid;gap:6px}.profile-photo-controls small,.notification-setting small{color:#6f746d}.notification-setting{display:grid;gap:12px}.profile-feedback{margin-top:8px}.profile-grid{align-items:start}";
  document.head.append(emojiStyle);

  const getChatDraftText = input => (input?.innerText || input?.textContent || "").replace(/\u00a0/g, " ").trim();
  const bindGifPaste = conversation => {
    const form = byId("composer"), input = byId("chatInput");
    if (!form || !input || form.dataset.gifPasteReady) return;
    form.dataset.gifPasteReady = "true";
    const preview = document.createElement("div");
    preview.className = "chat-gif-preview";
    preview.hidden = true;
    const image = document.createElement("img");
    image.alt = "GIF anexado";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remover GIF";
    remove.addEventListener("click", () => {
      delete form.dataset.attachmentPath;
      delete form.dataset.attachmentUrl;
      preview.hidden = true;
      image.removeAttribute("src");
    });
    preview.append(image, remove);
    form.before(preview);
    const attachRemoteGif = url => {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:" || !/\\.gif(?:$|[?#])/i.test(parsed.href)) return false;
        delete form.dataset.attachmentPath;
        form.dataset.attachmentUrl = parsed.href;
        image.src = parsed.href;
        preview.hidden = false;
        return true;
      } catch { return false; }
    };
    const attachGifFile = async file => {
      if (file.type !== "image/gif") return false;
      if (file.size > 8 * 1024 * 1024) throw new Error("O GIF precisa ter até 8 MB.");
      preview.hidden = false;
      image.src = URL.createObjectURL(file);
      const result = await window.conectaFirebase.uploadChatGif(currentUser(), file);
      form.dataset.attachmentPath = result.path;
      delete form.dataset.attachmentUrl;
      image.src = result.url;
      return true;
    };
    const handleClipboard = async event => {
      const clipboard = event.clipboardData;
      if (!clipboard) return;
      const gifItem = Array.from(clipboard.items || []).find(item => item.kind === "file" && item.type === "image/gif");
      const html = clipboard.getData("text/html");
      let source = "";
      if (html) {
        const doc = new DOMParser().parseFromString(html, "text/html");
        source = doc.querySelector("img")?.getAttribute("src") || "";
      }
      const uri = clipboard.getData("text/uri-list").split(/\\r?\\n/).find(line => line && !line.startsWith("#")) || "";
      const candidate = source || uri;
      if (gifItem || candidate.startsWith("data:image/gif")) {
        event.preventDefault();
        try {
          let file = gifItem?.getAsFile() || null;
          if (!file && candidate.startsWith("data:image/gif")) {
            const response = await fetch(candidate);
            file = await response.blob();
          }
          if (file) await attachGifFile(file);
          else if (!attachRemoteGif(candidate)) showToast("Não foi possível ler este GIF do painel do Windows.");
        } catch (error) { preview.hidden = true; showToast(error?.message || "Não foi possível anexar o GIF."); }
        return;
      }
      if (attachRemoteGif(candidate)) { event.preventDefault(); return; }
      const plain = clipboard.getData("text/plain").trim();
      if (attachRemoteGif(plain)) { event.preventDefault(); return; }
      if (plain) {
        event.preventDefault();
        document.execCommand("insertText", false, plain);
      }
    };
    input.addEventListener("paste", handleClipboard);
    input.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
      }
    });
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocorrect", "off");
    input.setAttribute("spellcheck", "false");
  };
  document.addEventListener("submit", async event => {
    const form = event.target;
    if (form?.id !== "composer") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const conversation = contacts[selectedContact];
    const user = currentUser();
    const input = byId("chatInput");
    const text = getChatDraftText(input);
    let attachmentPath = form.dataset.attachmentPath || null;
    let attachmentUrl = form.dataset.attachmentUrl || null;
    const inlineGif = input.querySelector("img[src]");
    if (!attachmentPath && !attachmentUrl && inlineGif) {
      try {
        const source = inlineGif.src;
        if (/^https:\/\//i.test(source) && /\.gif(?:$|[?#])/i.test(source)) attachmentUrl = source;
        else if (/^data:image\/gif/i.test(source)) {
          const blob = await fetch(source).then(response => response.blob());
          const uploaded = await window.conectaFirebase.uploadChatGif(user, blob);
          attachmentPath = uploaded.path;
          attachmentUrl = uploaded.url;
        }
      } catch (error) { showError(error); return; }
    }
    if (!conversation?.firestoreId || !user || (!text && !attachmentPath && !attachmentUrl)) return;
    const button = form.querySelector('button[type="submit"]');
    if (button) { button.disabled = true; button.textContent = "Enviando…"; }
    try {
      await window.conectaFirebase.sendMessage(user, conversation.firestoreId, text, conversation.replyTarget?.id || null, attachmentPath, attachmentUrl);
      conversation.replyTarget = null;
      input.replaceChildren();
      document.querySelectorAll(".chat-rich-input img").forEach(image => image.remove());
      delete form.dataset.attachmentPath;
      delete form.dataset.attachmentUrl;
      const preview = document.querySelector(".chat-gif-preview");
      if (preview) preview.hidden = true;
      await refreshMessages(conversation);
      showToast("Mensagem enviada.");
    } catch (error) { showError(error); }
    finally { if (button) { button.disabled = false; button.textContent = "Enviar"; } }
  }, true);

  const baseRenderConversations = renderConversations;
  renderConversations = window.renderConversations = (filter, watch = true) => {
    baseRenderConversations(filter, watch);
    updateUnreadBadges();
    const conversation = contacts[selectedContact];
    addEmojiPicker(conversation || {});
    bindGifPaste(conversation || {});
    document.querySelectorAll(".conversation-list .conv-item").forEach(button => {
      const item = contacts[Number(button.dataset.contact)];
      const avatar = button.querySelector(".person");
      const colleague = (window.conectaDirectory || []).find(person => person.id === item?.directUserId);
      if (avatar && colleague?.avatar_url) setProfileAvatar(avatar, colleague.avatar_url, colleague.name || item?.name);
    });
    const box = byId("chatMessages");
    if (!conversation || !box) return;
    const raw = window.conectaRawMessagesConversationId === conversation.firestoreId ? (window.conectaRawMessages || []) : [];
    conversation.messages = conversation.messages.map((message, index) => {
      const source = raw[index] || {};
      return {
        ...message,
        id: source.id || message.id,
        authorId: source.authorId || source.author_id || message.authorId,
        authorName: source.authorName || source.author_name || message.authorName,
        replyTo: source.replyTo || source.reply_to || message.replyTo,
        editedAt: source.editedAt || source.edited_at || message.editedAt,
        deletedAt: source.deletedAt || source.deleted_at || message.deletedAt,
        attachmentUrl: source.attachmentUrl || source.attachment_url || message.attachmentUrl || "",
        mine: (source.authorId || source.author_id || message.authorId) === currentUserId()
      };
    });
    const rows = [...box.querySelectorAll(":scope > .message-row")];
    rows.forEach((row, index) => {
      const message = conversation.messages[index];
      const bubble = row.querySelector(".bubble");
      const stack = row.querySelector(".message-stack");
      const avatar = row.querySelector(".message-avatar");
      const photo = message.authorId === currentUserId()
        ? window.conectaCurrentProfile?.avatar_url
        : (window.conectaDirectory || []).find(person => person.id === message.authorId)?.avatar_url;
      if (avatar && photo) setProfileAvatar(avatar, photo, message.authorName || "Foto do colaborador");
      if (!message || !bubble || !stack) return;
      bubble.dataset.messageId = message.id || "";
      if (message.deletedAt) {
        bubble.replaceChildren(document.createTextNode("Mensagem apagada"));
        const time = document.createElement("small");
        time.textContent = message.time || "";
        bubble.append(time);
      } else {
        if (message.attachmentUrl) {
          const attachment = document.createElement("img");
          attachment.className = "message-attachment";
          attachment.alt = "GIF animado";
          attachment.loading = "lazy";
          attachment.src = message.attachmentUrl;
          const time = bubble.querySelector("small");
          bubble.replaceChildren(attachment);
          if (message.text && message.text !== "GIF") bubble.append(document.createTextNode(message.text));
          if (time) bubble.append(time);
        }
        if (message.editedAt) {
          const time = bubble.querySelector("small");
          if (time && !time.textContent.includes("editada")) time.textContent += " · editada";
        }
      }

      if (message.replyTo && !stack.querySelector(".reply-quote")) {
        const parent = raw.find(row => row.id === message.replyTo);
        const quote = document.createElement("div");
        quote.className = "reply-quote";
        quote.textContent = parent
          ? `${parent.authorName || parent.author_name || "Colaborador"}: ${parent.deleted_at ? "Mensagem apagada" : parent.text}`
          : "Mensagem respondida";
        stack.insertBefore(quote, bubble);
      }

      if (row.querySelector(".message-actions") || !message.id) return;
      const actions = document.createElement("div");
      actions.className = "message-actions";
      const menu = document.createElement("div");
      menu.className = "message-action-menu";
      menu.hidden = true;
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "message-action-trigger";
      toggle.setAttribute("aria-label", "Ações da mensagem");
      toggle.textContent = "⋯";
      toggle.addEventListener("click", event => {
        event.stopPropagation();
        document.querySelectorAll(".message-action-menu").forEach(item => { if (item !== menu) item.hidden = true; });
        menu.hidden = !menu.hidden;
      });
      const menuAction = (label, action, danger = false) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = danger ? "danger" : "";
        button.textContent = label;
        button.addEventListener("click", async event => {
          event.stopPropagation();
          menu.hidden = true;
          try { await action(); } catch (error) { showError(error); }
        });
        menu.append(button);
      };
      if (!message.deletedAt) {
        menuAction("Responder", () => {
          conversation.replyTarget = {
            id: message.id,
            text: raw[index]?.text ?? message.text,
            authorName: message.authorName || (message.mine ? "Você" : "Colaborador")
          };
          renderConversations(undefined, false);
        });
      }
      if ((message.mine || isActiveAdmin()) && !message.deletedAt) {
        menuAction("Editar mensagem", () => {
          openModal("message");
          byId("modalTitle").textContent = "Editar mensagem";
          byId("modalDesc").textContent = message.mine
            ? "A mensagem editada será atualizada para todos."
            : "Como administrador, você pode editar esta mensagem para todos.";
          byId("destination")?.closest(".field")?.remove();
          byId("message").value = raw[index]?.text ?? message.text ?? "";
          byId("form").dataset.featureAction = "edit-message";
          byId("form").dataset.recordId = message.id;
          menu.hidden = true;
        });
      }
      if ((message.mine || isActiveAdmin()) && !message.deletedAt) menuAction("Apagar para todos", async () => {
        if (!confirm("Apagar esta mensagem para todos os participantes?")) return;
        await window.conectaFirebase.deleteMessageForEveryone(message.id);
        await refreshMessages(conversation);
      }, true);
      menuAction("Apagar para mim", async () => {
        await window.conectaFirebase.deleteMessageForMe(message.id, currentUser());
        await refreshMessages(conversation);
      }, true);
      actions.append(toggle, menu);
      row.append(actions);
    });

    const chat = box.closest(".conversation-chat");
    const composer = chat?.querySelector("#composer");
    chat?.querySelector(".reply-compose-preview")?.remove();
    if (conversation.replyTarget && composer) {
      const preview = document.createElement("div");
      preview.className = "reply-compose-preview";
      const text = document.createElement("span");
      text.textContent = `Respondendo a ${conversation.replyTarget.authorName}: ${conversation.replyTarget.text}`;
      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "×";
      close.setAttribute("aria-label", "Cancelar resposta");
      close.addEventListener("click", () => {
        conversation.replyTarget = null;
        renderConversations(undefined, false);
      });
      preview.append(text, close);
      chat.insertBefore(preview, composer);
    }
    box.scrollTop = box.scrollHeight;
  };

  window.addEventListener("conecta-firebase-ready", () => {
    const fb = window.conectaFirebase;
    if (!fb?.watchMessages || fb.__replyMetadataInstalled) return;
    fb.__replyMetadataInstalled = true;
    const watch = fb.watchMessages;
    fb.watchMessages = (conversationId, callback) => watch(conversationId, messages => {
      window.conectaRawMessagesConversationId = conversationId;
      callback(messages);
    });
  });

  window.addEventListener("conecta-directory-sync", event => {
    window.conectaDirectory = Array.isArray(event.detail) ? event.detail : [];
  });

  // Keep the dashboard panels in sync with the RLS-filtered Supabase data.
  const dashboardTime = value => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  };
  const renderDashboardNotices = () => {
    const feed = byId("feed");
    if (!feed) return;
    feed.replaceChildren();
    const recent = (Array.isArray(notices) ? notices : []).slice(0, 3);
    if (!recent.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "Nenhum aviso publicado ainda.";
      feed.append(empty);
      return;
    }
    recent.forEach((notice, index) => {
      const article = document.createElement("article");
      article.className = "post";
      const icon = document.createElement("div");
      icon.className = "post-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "▧";
      const body = document.createElement("div");
      const title = document.createElement("div");
      title.className = "post-title";
      title.textContent = notice.title || "Aviso";
      const tag = document.createElement("span");
      tag.className = `tag ${index === 1 ? "green" : index === 2 ? "purple" : ""}`.trim();
      tag.textContent = notice.sector || "Geral";
      title.append(tag);
      const meta = document.createElement("div");
      meta.className = "post-meta";
      meta.textContent = dashboardTime(notice.created_at || notice.createdAt) || notice.time || "";
      const text = document.createElement("p");
      text.textContent = notice.body || notice.text || "";
      body.append(title, meta, text);
      article.append(icon, body);
      feed.append(article);
    });
  };
  const renderDashboardConversations = () => {
    const box = document.querySelector(".chat-preview");
    if (!box) return;
    box.replaceChildren();
    const recent = (Array.isArray(contacts) ? contacts : [])
      .slice()
      .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))
      .slice(0, 4);
    if (!recent.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "Nenhuma conversa iniciada ainda.";
      box.append(empty);
      return;
    }
    recent.forEach((conversation, index) => {
      const entry = document.createElement("button");
      entry.type = "button";
      entry.className = "chat-entry dashboard-conversation";
      entry.setAttribute("aria-label", `Abrir conversa: ${conversation.name || "Conversa"}`);
      const avatar = document.createElement("span");
      avatar.className = `person ${["", "green", "orange"][index % 3]}`.trim();
      avatar.textContent = conversation.initials || (conversation.name || "?").split(/[ ._-]+/).map(part => part[0]).join("").slice(0, 2).toUpperCase();
      const info = document.createElement("span");
      info.className = "chat-info";
      const name = document.createElement("span");
      name.className = "chat-name";
      name.textContent = conversation.name || "Conversa";
      const snippet = document.createElement("span");
      snippet.className = "chat-snippet";
      snippet.textContent = conversation.lastMessage || conversation.last_message || "Nenhuma mensagem ainda";
      info.append(name, snippet);
      const time = document.createElement("span");
      time.className = "chat-time";
      time.textContent = dashboardTime(conversation.updated_at) || "";
      const unread = Number(conversation.unreadCount) || 0;
      if (unread) {
        const badge = document.createElement("span");
        badge.className = "unread-badge";
        badge.textContent = unread > 99 ? "99+" : String(unread);
        badge.title = `${unread} ${unread === 1 ? "mensagem não lida" : "mensagens não lidas"}`;
        time.append(document.createElement("br"), badge);
      }
      entry.append(avatar, info, time);
      entry.addEventListener("click", () => {
        selectedContact = contacts.findIndex(item => item.firestoreId === conversation.firestoreId);
        renderView("Conversas");
        selectedContact = contacts.findIndex(item => item.firestoreId === conversation.firestoreId);
        renderConversations();
      });
      box.append(entry);
    });
  };
  const renderDashboardPanels = () => {
    renderDashboardNotices();
    renderDashboardConversations();
  };
  const updateNoticeCounts = event => {
    const count = Array.isArray(event.detail) ? event.detail.length : 0;
    writeCount("noticeCount", count);
    writeCount("noticeNavCount", count);
    writeNavCount("noticeNavCount", count);
    if (byId("noticeStatNote")) byId("noticeStatNote").textContent = count ? `${count} ${plural(count, "aviso disponível", "avisos disponíveis")}` : "nenhum aviso publicado";
  };
  const dashboardStyle = document.createElement("style");
  dashboardStyle.textContent = ".dashboard-conversation{width:100%;border:0;background:transparent;text-align:left;font:inherit;cursor:pointer}.dashboard-conversation:hover{background:#f8faf7;border-radius:10px}.dashboard-conversation .chat-name{display:block}.dashboard-conversation .chat-time{line-height:1.8}.dashboard-conversation .unread-badge{display:inline-flex;align-items:center;justify-content:center;min-width:19px;height:19px;padding:0 5px;border-radius:999px;background:#223e2a;color:white;font-size:10px;font-weight:700}";
  document.head.append(dashboardStyle);
  window.addEventListener("conecta-notices-sync", event => { updateNoticeCounts(event); renderDashboardPanels(); });
  window.addEventListener("conecta-reminders-sync", renderReminderAlerts);
  window.addEventListener("conecta-messages-sync", renderDashboardConversations);
  window.addEventListener("conecta-unread-sync", () => {
    renderDashboardConversations();
  });
  window.addEventListener("conecta-online-count-sync", event => {
    const count = Number(event.detail) || 0;
    writeCount("onlineCount", count);
    if (byId("onlineStatNote")) byId("onlineStatNote").textContent = count ? `${count} ${plural(count, "pessoa conectada", "pessoas conectadas")}` : "nenhum usuário conectado";
  });
  let shownAnnouncementKeys = new Set();
  let scheduledAnnouncements = [];
  let adminAnnouncements = [];
  let pendingAnnouncements = [];
  let activeAnnouncement = null;
  const announcementStyle = document.createElement("style");
  announcementStyle.textContent = ".global-announcement{position:fixed;inset:0;z-index:12000;display:grid;place-items:center;padding:20px;background:#132217a8}.global-announcement[hidden]{display:none}.global-announcement-card{width:min(520px,100%);padding:28px;background:#fff;border-radius:20px;box-shadow:0 24px 80px #0004}.global-announcement-card h2{margin:0 0 12px;font-size:21px;color:#223e2a}.global-announcement-card p{white-space:pre-wrap;line-height:1.65;color:#596259;margin:0}.global-announcement-card .primary{display:block;margin:24px 0 0 auto}.global-announcement-admin{margin:18px 0}.global-announcement-admin .admin-form{padding:18px 20px}.global-announcement-admin .admin-actions{padding:4px 20px 20px;gap:10px}";
  document.head.append(announcementStyle);
  const renderNextGlobalAnnouncement = () => {
    if (activeAnnouncement || !pendingAnnouncements.length) return;
    activeAnnouncement = pendingAnnouncements.shift();
    const announcement = activeAnnouncement;
    const key = `${announcement.id}:${announcement.updated_at}`;
    shownAnnouncementKeys.add(key);
    let modal = byId("globalAnnouncementModal");
    if (!modal) {
      modal = document.createElement("div"); modal.id = "globalAnnouncementModal"; modal.className = "global-announcement";
      modal.setAttribute("role", "dialog"); modal.setAttribute("aria-modal", "true"); modal.setAttribute("aria-labelledby", "globalAnnouncementTitle"); document.body.append(modal);
    }
    modal.replaceChildren();
    const card = document.createElement("section"); card.className = "global-announcement-card";
    const title = document.createElement("h2"); title.id = "globalAnnouncementTitle"; title.textContent = announcement.title || "Aviso da administração";
    const body = document.createElement("p"); body.textContent = announcement.body || "";
    if (announcement.image_url) {
      const image = document.createElement("img"); image.src = announcement.image_url; image.alt = announcement.title ? `Imagem: ${announcement.title}` : "Imagem do aviso";
      image.style.cssText = "display:block;max-width:100%;max-height:280px;object-fit:contain;margin:0 auto 18px;border-radius:12px";
      card.append(image);
    }
    const confirm = document.createElement("button"); confirm.className = "primary";
    const closeCurrent = () => { modal.hidden = true; activeAnnouncement = null; renderNextGlobalAnnouncement(); };
    confirm.textContent = pendingAnnouncements.length ? `Próximo aviso (${pendingAnnouncements.length})` : "Entendi";
    confirm.addEventListener("click", closeCurrent);
    card.append(title, body, confirm); modal.append(card); modal.hidden = false; confirm.focus();
  };
  window.addEventListener("conecta-global-announcement-sync", event => {
    scheduledAnnouncements = Array.isArray(event.detail) ? event.detail : [];
    const visibleKeys = new Set(scheduledAnnouncements.map(item => `${item.id}:${item.updated_at}`));
    if (activeAnnouncement && !visibleKeys.has(`${activeAnnouncement.id}:${activeAnnouncement.updated_at}`)) {
      activeAnnouncement = null;
      if (byId("globalAnnouncementModal")) byId("globalAnnouncementModal").hidden = true;
    }
    pendingAnnouncements = pendingAnnouncements.filter(item => visibleKeys.has(`${item.id}:${item.updated_at}`));
    scheduledAnnouncements.forEach(item => {
      const key = `${item.id}:${item.updated_at}`;
      if (!shownAnnouncementKeys.has(key) && !pendingAnnouncements.some(queued => `${queued.id}:${queued.updated_at}` === key)) pendingAnnouncements.push(item);
    });
    renderNextGlobalAnnouncement();
  });
  window.addEventListener("conecta-auth-session-reset", () => {
    shownAnnouncementKeys = new Set(); pendingAnnouncements = []; activeAnnouncement = null;
    if (byId("globalAnnouncementModal")) byId("globalAnnouncementModal").hidden = true;
  });
  const baseRenderAdminForAnnouncement = renderAdmin;
  renderAdmin = async () => {
    await baseRenderAdminForAnnouncement();
    if (!isActiveAdmin() || !byId("viewPanel")?.classList.contains("show") || byId("crumb")?.textContent !== "Administração" || byId("globalAnnouncementAdmin")) return;
    const fb = window.conectaFirebase; const user = currentUser();
    try { adminAnnouncements = await fb.listGlobalAnnouncements(user); }
    catch (error) { console.error("Could not list global announcements", error); adminAnnouncements = []; }
    const panel = byId("viewPanel"); const card = document.createElement("section"); card.id = "globalAnnouncementAdmin"; card.className = "card global-announcement-admin";
    const heading = document.createElement("div"); heading.className = "card-head"; heading.innerHTML = '<div><div class="card-title">Avisos globais</div><div class="card-sub">Crie vários avisos, anexe imagem e programe a data e o horário de exibição.</div></div>';
    const form = document.createElement("form"); form.className = "admin-form"; form.id = "globalAnnouncementForm";
    form.innerHTML = '<input id="globalAnnouncementId" type="hidden"><div class="field full"><label for="globalAnnouncementTitleInput">Título</label><input id="globalAnnouncementTitleInput" maxlength="120" required placeholder="Ex.: Recesso de fim de ano"></div><div class="field full"><label for="globalAnnouncementBodyInput">Mensagem</label><textarea id="globalAnnouncementBodyInput" maxlength="4000" required placeholder="Escreva o aviso para a equipe"></textarea></div><div class="field"><label for="globalAnnouncementStartsAt">Exibir a partir de</label><input id="globalAnnouncementStartsAt" type="datetime-local" required></div><div class="field"><label for="globalAnnouncementEndsAt">Ocultar em (opcional)</label><input id="globalAnnouncementEndsAt" type="datetime-local"></div><div class="field full"><label for="globalAnnouncementImage">Imagem (JPG, PNG ou WEBP; otimizada para até 900 KB)</label><input id="globalAnnouncementImage" type="file" accept="image/jpeg,image/png,image/webp"><small id="globalAnnouncementImageInfo">Redimensionaremos a imagem e converteremos para WebP antes do envio. Arquivo original: até 15 MB.</small><img id="globalAnnouncementImagePreview" alt="Prévia da imagem otimizada do aviso" hidden style="max-width:min(100%,420px);max-height:220px;object-fit:contain;border-radius:10px;margin-top:8px"><label style="display:flex;align-items:center;gap:8px;font-weight:400"><input id="globalAnnouncementRemoveImage" type="checkbox" style="width:auto"> Remover imagem atual</label></div><div class="field full"><label style="display:flex;align-items:center;gap:8px;font-weight:400"><input id="globalAnnouncementActive" type="checkbox" checked style="width:auto"> Ativo (será exibido na data programada)</label></div><div class="admin-actions full"><button id="globalAnnouncementCancel" class="secondary" type="button" hidden>Cancelar edição</button><button id="globalAnnouncementSubmit" class="primary" type="submit">＋ Criar aviso</button></div></form>';
    const list = document.createElement("div"); list.id = "globalAnnouncementList"; list.style.cssText = "display:grid;gap:10px;padding:0 20px 20px";
    card.append(heading, form, list); panel.querySelector(".card")?.before(card);
    const localDateTime = value => { const date = value ? new Date(value) : new Date(Date.now() + 60_000); date.setMinutes(date.getMinutes() - date.getTimezoneOffset()); return date.toISOString().slice(0, 16); };
    const formatDateTime = value => value ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";
    const imageInput = byId("globalAnnouncementImage");
    let optimizedAnnouncementImage = null;
    let previewUrl = null;
    const showList = () => {
      list.replaceChildren();
      if (!adminAnnouncements.length) { const empty = document.createElement("div"); empty.className = "empty"; empty.textContent = "Nenhum aviso global cadastrado."; list.append(empty); return; }
      [...adminAnnouncements].sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at)).forEach(item => {
        const row = document.createElement("article"); row.style.cssText = "display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:12px;border:1px solid #e8ece7;border-radius:12px";
        if (item.image_url) { const image = document.createElement("img"); image.src = item.image_url; image.alt = ""; image.style.cssText = "width:72px;height:58px;object-fit:cover;border-radius:8px"; row.append(image); }
        const info = document.createElement("div"); info.style.cssText = "min-width:0;flex:1";
        const name = document.createElement("strong"); name.textContent = item.title;
        const time = document.createElement("small"); time.style.cssText = "display:block;color:#747b90;margin-top:4px";
        const state = !item.is_active ? "Desativado" : (new Date(item.starts_at) > new Date() ? "Agendado" : (item.ends_at && new Date(item.ends_at) <= new Date() ? "Encerrado" : "Publicado"));
        time.textContent = `${state} · ${formatDateTime(item.starts_at)}${item.ends_at ? ` até ${formatDateTime(item.ends_at)}` : ""}`;
        info.append(name, time); row.append(info);
        const edit = document.createElement("button"); edit.className = "secondary"; edit.type = "button"; edit.textContent = "Editar";
        edit.onclick = () => {
          byId("globalAnnouncementId").value = item.id; byId("globalAnnouncementTitleInput").value = item.title || ""; byId("globalAnnouncementBodyInput").value = item.body || "";
          byId("globalAnnouncementStartsAt").value = localDateTime(item.starts_at); byId("globalAnnouncementEndsAt").value = item.ends_at ? localDateTime(item.ends_at) : "";
          byId("globalAnnouncementActive").checked = item.is_active; byId("globalAnnouncementRemoveImage").checked = false; imageInput.value = ""; optimizedAnnouncementImage = null;
          byId("globalAnnouncementImageInfo").textContent = item.image_path ? `Imagem atual anexada${item.image_url ? "; selecione outra para substituir" : ""}.` : "";
          const preview = byId("globalAnnouncementImagePreview"); preview.src = item.image_url || ""; preview.hidden = !item.image_url;
          byId("globalAnnouncementSubmit").textContent = "Salvar alterações"; byId("globalAnnouncementCancel").hidden = false; byId("globalAnnouncementForm").scrollIntoView({ behavior: "smooth", block: "center" });
        };
        const toggle = document.createElement("button"); toggle.className = "secondary"; toggle.type = "button"; toggle.textContent = item.is_active ? "Desativar" : "Ativar";
        toggle.onclick = async () => { try { await fb.setGlobalAnnouncementActive(user, item.id, !item.is_active); adminAnnouncements = await fb.listGlobalAnnouncements(user); showList(); showToast(item.is_active ? "Aviso desativado" : "Aviso ativado"); } catch (error) { showError(error); } };
        const remove = document.createElement("button"); remove.className = "secondary"; remove.type = "button"; remove.textContent = "Excluir";
        remove.onclick = async () => { if (!confirm("Excluir este aviso global permanentemente?")) return; try { await fb.deleteGlobalAnnouncement(user, item.id); adminAnnouncements = await fb.listGlobalAnnouncements(user); showList(); showToast("Aviso excluído"); } catch (error) { showError(error); } };
        row.append(edit, toggle, remove); list.append(row);
      });
    };
    showList();
    imageInput.onchange = async () => {
      const file = imageInput.files?.[0]; const info = byId("globalAnnouncementImageInfo"); const preview = byId("globalAnnouncementImagePreview");
      optimizedAnnouncementImage = null;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = null;
      if (!file) { info.textContent = "Redimensionaremos a imagem e converteremos para WebP antes do envio. Arquivo original: até 15 MB."; return; }
      byId("globalAnnouncementSubmit").disabled = true; info.textContent = "Otimizando imagem…";
      try {
        optimizedAnnouncementImage = await optimizeGlobalAnnouncementImage(file);
        const originalSize = file.size; const compressedSize = optimizedAnnouncementImage.size;
        const reduction = Math.max(0, Math.round((1 - compressedSize / originalSize) * 100));
        info.textContent = `${(originalSize / 1024 / 1024).toFixed(2)} MB → ${(compressedSize / 1024).toFixed(0)} KB · WebP · redução de ${reduction}%`;
        previewUrl = URL.createObjectURL(optimizedAnnouncementImage); preview.src = previewUrl; preview.hidden = false;
      } catch (error) { imageInput.value = ""; info.textContent = error.message; preview.hidden = true; showToast(error.message); }
      finally { byId("globalAnnouncementSubmit").disabled = false; }
    };
    byId("globalAnnouncementRemoveImage").onchange = event => { if (event.target.checked && !imageInput.files?.length) byId("globalAnnouncementImagePreview").hidden = true; };
    byId("globalAnnouncementCancel").onclick = () => { form.reset(); byId("globalAnnouncementId").value = ""; byId("globalAnnouncementActive").checked = true; byId("globalAnnouncementStartsAt").value = localDateTime(); byId("globalAnnouncementImageInfo").textContent = "Redimensionaremos a imagem e converteremos para WebP antes do envio. Arquivo original: até 15 MB."; byId("globalAnnouncementImagePreview").removeAttribute("src"); byId("globalAnnouncementImagePreview").hidden = true; optimizedAnnouncementImage = null; if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null; byId("globalAnnouncementSubmit").textContent = "＋ Criar aviso"; byId("globalAnnouncementCancel").hidden = true; };
    byId("globalAnnouncementStartsAt").value = localDateTime();
    form.onsubmit = async event => {
      event.preventDefault();
      const starts = byId("globalAnnouncementStartsAt").value; const ends = byId("globalAnnouncementEndsAt").value;
      if (ends && new Date(ends) <= new Date(starts)) { showToast("A data para ocultar precisa ser posterior à data de exibição."); return; }
      const file = imageInput.files?.[0];
      if (file && !optimizedAnnouncementImage) { showToast("Aguarde a otimização da imagem terminar."); return; }
      try {
        await fb.saveGlobalAnnouncement(user, { id: byId("globalAnnouncementId").value || null, title: byId("globalAnnouncementTitleInput").value.trim(), body: byId("globalAnnouncementBodyInput").value.trim(), starts_at: new Date(starts).toISOString(), ends_at: ends ? new Date(ends).toISOString() : null, is_active: byId("globalAnnouncementActive").checked, imageFile: optimizedAnnouncementImage, removeImage: byId("globalAnnouncementRemoveImage").checked });
        adminAnnouncements = await fb.listGlobalAnnouncements(user); showList(); byId("globalAnnouncementCancel").click(); showToast("Aviso global salvo");
      } catch (error) { console.error(error); showToast(error.message || "Não foi possível salvar o aviso global"); }
    };
  };

  // Replace the legacy channel-only view with the RLS-filtered channel + 1:1 list.
  window.addEventListener("conecta-conversations-sync", event => {
    const people = window.conectaDirectory || [];
    contacts = (event.detail || []).filter(c => c.kind === "channel" || c.kind === "direct")
      .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))
      .map(c => ({ ...c, firestoreId: c.id, initials: (c.name || "? ").split(/[ ._-]+/).map(x => x[0]).join("").slice(0, 2).toUpperCase(), tone: "", type: c.kind === "direct" ? `Individual · ${c.directSector || "outro setor"}` : "Canal do setor", snippet: c.lastMessage || "Nenhuma mensagem ainda", messages: [] }));
    if (selectedContact >= contacts.length) selectedContact = 0;
    if (byId("viewPanel")?.classList.contains("show") && byId("crumb")?.textContent === "Conversas") renderConversations();
    renderDashboardConversations();
  });

  const roleNames = { admin: "Administrador", fiscal: "Dpto. Fiscal", contabil: "Dpto. Contábil", pessoal: "Dpto. Pessoal", colaborador: "Colaborador" };
  const profileNavigation = document.createElement("button");
  profileNavigation.type = "button";
  profileNavigation.dataset.view = "Meu perfil";
  profileNavigation.innerHTML = '<span class="ico" aria-hidden="true">♙</span> Meu perfil';
  const remindersNavigation = document.querySelector('.nav [data-view="Lembretes"]');
  if (remindersNavigation) remindersNavigation.after(profileNavigation);
  else document.querySelector(".nav")?.append(profileNavigation);

  const renderProfile = () => {
    const user = currentUser();
    if (!user) { showToast("Entre novamente para acessar seu perfil."); showDashboard(); return; }
    const profile = window.conectaCurrentProfile || {};
    const panel = byId("viewPanel");
    const values = [
      ["Nome", profile.name || user.user_metadata?.name || "Colaborador"],
      ["E-mail", user.email || profile.email || "—"],
      ["Setor", profile.sector || "—"],
      ["Acesso", roleNames[profile.role] || "Colaborador"]
    ];
    panel.innerHTML = '<div class="view-toolbar"><div><h2>Meu perfil</h2><p>Confira os dados da sua conta e atualize sua senha de acesso.</p></div></div><div class="profile-grid"><section class="card"><div class="card-head"><div><div class="card-title">Dados da conta</div><div class="card-sub">Informações vinculadas ao seu usuário.</div></div></div><div class="profile-photo-area"><img class="profile-photo-preview" id="profilePhotoPreview" alt="Foto do perfil" src="" style="display:none"><div class="profile-photo-preview" id="profilePhotoFallback"></div><div class="profile-photo-controls"><label class="text-btn" for="profilePhotoInput">Escolher foto</label><input id="profilePhotoInput" type="file" accept="image/jpeg,image/png,image/webp" hidden><small>JPG, PNG ou WEBP. A imagem é ajustada e otimizada automaticamente.</small><div class="profile-feedback" id="profilePhotoFeedback" role="status" aria-live="polite"></div></div></div><dl class="profile-details">' + values.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("") + '</dl></section><section class="card"><div class="card-head"><div><div class="card-title">Notificações</div><div class="card-sub">Novas mensagens e lembretes com vencimento nas próximas 24 horas.</div></div></div><div class="notification-setting"><button class="primary" id="browserNotificationToggle" type="button">Ativar notificações no navegador</button><small id="browserNotificationStatus" role="status"></small></div></section><section class="card"><div class="card-head"><div><div class="card-title">Trocar senha</div><div class="card-sub">Use a senha atual para definir uma nova.</div></div></div><form class="password-form" id="profilePasswordForm"><div class="field"><label for="profileCurrentPassword">Senha atual</label><input id="profileCurrentPassword" name="currentPassword" type="password" autocomplete="current-password" required></div><div class="field"><label for="profileNewPassword">Nova senha</label><input id="profileNewPassword" name="newPassword" type="password" autocomplete="new-password" minlength="8" required><small>Use pelo menos 8 caracteres.</small></div><div class="field"><label for="profileConfirmPassword">Confirme a nova senha</label><input id="profileConfirmPassword" name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required></div><div class="field profile-reauth-field" id="profileReauthField" hidden><label for="profileReauthCode">Código enviado ao seu e-mail</label><input id="profileReauthCode" name="nonce" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="12" placeholder="Digite o código de confirmação"></div><div class="profile-feedback" id="passwordChangeFeedback" role="status" aria-live="polite"></div><div class="profile-form-actions"><button class="primary" type="submit">Salvar nova senha</button></div></form></section></div>';
    const photoPreview = byId("profilePhotoPreview");
    const photoFallback = byId("profilePhotoFallback");
    const profileName = profile.name || user.user_metadata?.name || user.email || "?";
    photoFallback.textContent = profileName.split(/[ ._-]+/).map(part => part[0]).join("").slice(0,2).toUpperCase();
    if (profile.avatar_url) {
      photoPreview.src = profile.avatar_url;
      photoPreview.style.display = "block";
      photoFallback.hidden = true;
    }
    byId("profilePhotoInput")?.addEventListener("change", async event => {
      const input = event.currentTarget, file = input.files?.[0];
      if (!file) return;
      const feedback = byId("profilePhotoFeedback");
      feedback.className = "profile-feedback";
      feedback.textContent = "Otimizando e enviando…";
      try {
        const optimized = await optimizeProfilePhoto(file);
        const url = await window.conectaFirebase.uploadProfilePhoto(user, optimized);
        photoPreview.src = url;
        photoPreview.style.display = "block";
        photoFallback.hidden = true;
        feedback.classList.add("success");
        feedback.textContent = "Foto de perfil atualizada.";
      } catch (error) {
        console.error("Profile photo update failed", error);
        feedback.classList.add("error");
        feedback.textContent = error?.message || "Não foi possível atualizar a foto.";
      } finally { input.value = ""; }
    });
    const notificationButton = byId("browserNotificationToggle");
    const notificationStatus = byId("browserNotificationStatus");
    const refreshNotificationUi = () => {
      const supported = "Notification" in window;
      notificationButton.disabled = !supported;
      notificationButton.textContent = browserNotificationsEnabled() ? "Desativar notificações" : "Ativar notificações no navegador";
      notificationStatus.textContent = !supported
        ? "Este navegador não oferece notificações."
        : Notification.permission === "denied"
          ? "As notificações estão bloqueadas nas configurações do navegador."
          : browserNotificationsEnabled()
            ? "Ativas para novas mensagens e lembretes próximos."
            : "Os avisos dentro do aplicativo continuam ativos.";
    };
    refreshNotificationUi();
    notificationButton?.addEventListener("click", async () => {
      if (browserNotificationsEnabled()) {
        try { localStorage.removeItem(notificationPrefsKey()); } catch {}
        refreshNotificationUi();
        return;
      }
      if (!("Notification" in window)) return;
      const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (permission === "granted") {
        try { localStorage.setItem(notificationPrefsKey(), "true"); } catch {}
        refreshNotificationUi();
        showToast("Notificações ativadas.");
      } else notificationStatus.textContent = "Permissão não concedida. Confira as configurações do navegador.";
    });
  };

  const baseRenderViewForProfile = renderView;
  renderView = view => {
    if (view !== "Meu perfil") return baseRenderViewForProfile(view);
    document.querySelector(".welcome").style.display = "none";
    document.querySelector(".stats").style.display = "none";
    document.querySelector(".grid").style.display = "none";
    byId("viewPanel").classList.add("show");
    byId("backDashboard").classList.add("show");
    byId("crumb").textContent = "Meu perfil";
    renderProfile();
  };
  profileNavigation.addEventListener("click", () => {
    document.querySelectorAll(".nav button, .channel").forEach(button => button.classList.toggle("active", button === profileNavigation));
    renderView("Meu perfil");
  });

  document.addEventListener("submit", async event => {
    const form = event.target;
    if (form.id === "profilePasswordForm") {
      event.preventDefault();
      event.stopImmediatePropagation();
      const feedback = byId("passwordChangeFeedback");
      const currentPassword = byId("profileCurrentPassword").value;
      const newPassword = byId("profileNewPassword").value;
      const confirmation = byId("profileConfirmPassword").value;
      const nonce = byId("profileReauthCode").value.trim();
      feedback.className = "profile-feedback";
      feedback.textContent = "";
      if (newPassword !== confirmation) {
        feedback.classList.add("error");
        feedback.textContent = "A confirmação não corresponde à nova senha.";
        return;
      }
      if (newPassword === currentPassword) {
        feedback.classList.add("error");
        feedback.textContent = "A nova senha precisa ser diferente da senha atual.";
        return;
      }
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      submit.textContent = "Atualizando…";
      try {
        await window.conectaFirebase.changePassword({ currentPassword, newPassword, nonce });
        form.reset();
        byId("profileReauthField").hidden = true;
        feedback.classList.add("success");
        feedback.textContent = "Senha atualizada. Use a nova senha no próximo acesso.";
        showToast("Senha atualizada com sucesso.");
      } catch (error) {
        console.error("Password change failed", error);
        const message = String(error?.message || "").toLowerCase();
        if (error?.code === "reauthentication_required") {
          byId("profileReauthField").hidden = false;
          feedback.classList.add("success");
          feedback.textContent = "O Supabase exige uma confirmação extra. Digite o código que enviamos por e-mail e salve novamente.";
          byId("profileReauthCode").focus();
        } else {
          feedback.classList.add("error");
          feedback.textContent = message.includes("incorrect") || message.includes("invalid login") || message.includes("senha atual")
          ? "A senha atual está incorreta. Confira e tente novamente."
          : message.includes("weak") || message.includes("password should")
            ? "A nova senha não atende aos requisitos de segurança. Escolha outra com pelo menos 8 caracteres."
            : (message.includes("nonce") || message.includes("reauthentication"))
              ? "O código de confirmação está inválido ou expirou. Solicite outro e tente novamente."
            : "Não foi possível atualizar a senha. Confira os dados e tente novamente.";
        }
      } finally {
        submit.disabled = false;
        submit.textContent = "Salvar nova senha";
      }
      return;
    }
    if (form.id === "composer") {
      event.preventDefault();
      event.stopImmediatePropagation();
      const conversation = contacts[selectedContact];
      const user = currentUser();
      const text = byId("chatInput").value.trim();
      if (!conversation?.firestoreId || !user || !text) return;
      try {
        await window.conectaFirebase.sendMessage(user, conversation.firestoreId, text, conversation.replyTarget?.id || null);
        conversation.replyTarget = null;
        byId("chatInput").value = "";
        await refreshMessages(conversation);
        showToast("Mensagem enviada.");
      } catch (error) { showError(error); }
      return;
    }
    if (form.id !== "form") return;
    const action = form.dataset.featureAction;
    const type = form.dataset.type;
    if (!action && type !== "reminder" && type !== "message") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const fb = window.conectaFirebase;
    const id = form.dataset.recordId;
    try {
      if (action === "edit-notice") {
        const data = { title: byId("title").value.trim(), sector: byId("sector").value, text: byId("message").value.trim() };
        await fb.updateNotice(id, data);
        notices = notices.map(item => item.id === id ? { ...item, title: data.title, body: data.text, text: data.text, sector: data.sector } : item);
        renderNotices();
        showToast("Aviso atualizado.");
      } else if (action === "edit-reminder") {
        const data = { title: byId("title").value.trim(), due_at: new Date(byId("when").value).toISOString() };
        await fb.updateReminder(id, data);
        reminders = reminders.map(item => item.id === id ? { ...item, ...data, time: syncDate(data.due_at) } : item);
        renderReminders();
        showToast("Lembrete atualizado.");
      } else if (action === "edit-message") {
        await fb.editMessage(id, byId("message").value.trim());
        const conversation = contacts[selectedContact];
        if (conversation) await refreshMessages(conversation);
        showToast("Mensagem editada para todos.");
      } else if (type === "reminder") {
        const dueAt = new Date(byId("when").value).toISOString();
        await fb.addReminder(currentUser(), { title: byId("title").value.trim(), due_at: dueAt });
        showToast("Lembrete salvo.");
      } else if (type === "message") {
        const user = currentUser();
        const destination = byId("destination").value;
        const text = byId("message").value.trim();
        if (!user || !text || !destination) throw new Error("Escolha um destino e escreva a mensagem.");
        let conversationId;
        if (destination.startsWith("user:")) {
          const personId = destination.slice(5);
          conversationId = await fb.startDirectConversation(user, personId);
        } else if (destination.startsWith("channel:")) {
          conversationId = await fb.ensureChannel(user, destination.slice(8));
        } else {
          throw new Error("Destino inválido.");
        }
        await fb.sendMessage(user, conversationId, text);
        await new Promise(resolve => setTimeout(resolve, 100));
        const conversation = contacts.find(item => item.firestoreId === conversationId);
        byId("modalBack").classList.remove("show");
        showDashboard();
        renderView("Conversas");
        const refreshedConversation = contacts.find(item => item.firestoreId === conversationId) || conversation;
        if (refreshedConversation) {
          selectedContact = contacts.indexOf(refreshedConversation);
          renderConversations();
        }
        showToast("Mensagem enviada.");
        delete form.dataset.featureAction;
        return;
      } else return;
      delete form.dataset.featureAction;
      delete form.dataset.recordId;
      byId("modalBack").classList.remove("show");
    } catch (error) { showError(error); }
  }, true);

  // Small-screen drawer navigation: the existing sidebar remains the source of truth,
  // while the hamburger opens it as an accessible off-canvas menu.
  const mobileApp = document.querySelector(".app");
  const mobileMenuButton = document.querySelector(".mobile-menu");
  const mobileSidebar = document.querySelector(".sidebar");
  if (mobileApp && mobileMenuButton && mobileSidebar && !document.querySelector(".mobile-nav-backdrop")) {
    const backdrop = document.createElement("button");
    backdrop.type = "button";
    backdrop.className = "mobile-nav-backdrop";
    backdrop.setAttribute("aria-label", "Fechar menu");
    mobileApp.insertBefore(backdrop, mobileSidebar);
    mobileSidebar.id ||= "primaryNavigation";
    mobileMenuButton.setAttribute("aria-controls", mobileSidebar.id);
    mobileMenuButton.setAttribute("aria-expanded", "false");

    const setMenuOpen = open => {
      mobileApp.classList.toggle("mobile-nav-open", open);
      document.body.classList.toggle("mobile-nav-open", open);
      mobileMenuButton.setAttribute("aria-expanded", String(open));
      mobileMenuButton.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu");
      mobileMenuButton.textContent = open ? "×" : "☰";
      if (open) mobileSidebar.querySelector("[data-view]:not([hidden])")?.focus({ preventScroll: true });
      else mobileMenuButton.focus({ preventScroll: true });
    };

    mobileMenuButton.addEventListener("click", () => setMenuOpen(!mobileApp.classList.contains("mobile-nav-open")));
    backdrop.addEventListener("click", () => setMenuOpen(false));
    mobileSidebar.addEventListener("click", event => {
      if (event.target.closest("[data-view]:not([hidden])")) setMenuOpen(false);
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && mobileApp.classList.contains("mobile-nav-open")) setMenuOpen(false);
    });
    window.matchMedia("(min-width: 761px)").addEventListener("change", event => {
      if (event.matches) setMenuOpen(false);
    });
  }
})();
