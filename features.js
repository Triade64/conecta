(() => {
  const currentUserId = () => window.conectaCurrentUser?.id || window.conectaFirebase?.auth?.currentUser?.uid || null;
  const currentUser = () => window.conectaFirebase?.auth?.currentUser;
  const isActiveAdmin = () => window.conectaCurrentProfile?.role === "admin" && window.conectaCurrentProfile?.active === true;
  const byId = id => document.getElementById(id);
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
    const uid = currentUserId();
    const admin = isActiveAdmin();
    document.querySelectorAll("#reminders .reminder, #fullReminders .reminder").forEach((row, index) => {
      const box = row.closest("#fullReminders") ? byId("fullReminders") : byId("reminders");
      if (box?.id === "fullReminders") row.querySelector(".record-actions")?.remove();
      const listIndex = [...box.querySelectorAll(".reminder")].indexOf(row);
      const item = reminders[listIndex];
      if (!item?.id || (item.owner_id !== uid && !admin) || row.querySelector(".record-actions")) return;
      const actions = document.createElement("div");
      actions.className = "record-actions";
      if (item.owner_id === uid || admin) addButton(actions, "Editar", "record-action", () => {
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

  const baseRenderConversations = renderConversations;
  renderConversations = window.renderConversations = (filter, watch = true) => {
    baseRenderConversations(filter, watch);
    updateUnreadBadges();
    const conversation = contacts[selectedContact];
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
        mine: (source.authorId || source.author_id || message.authorId) === currentUserId()
      };
    });
    const rows = [...box.querySelectorAll(":scope > .message-row")];
    rows.forEach((row, index) => {
      const message = conversation.messages[index];
      const bubble = row.querySelector(".bubble");
      const stack = row.querySelector(".message-stack");
      if (!message || !bubble || !stack) return;
      bubble.dataset.messageId = message.id || "";
      if (message.deletedAt) {
        bubble.replaceChildren(document.createTextNode("Mensagem apagada"));
        const time = document.createElement("small");
        time.textContent = message.time || "";
        bubble.append(time);
      } else if (message.editedAt) {
        const time = bubble.querySelector("small");
        if (time && !time.textContent.includes("editada")) time.textContent += " · editada";
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
  const dashboardStyle = document.createElement("style");
  dashboardStyle.textContent = ".dashboard-conversation{width:100%;border:0;background:transparent;text-align:left;font:inherit;cursor:pointer}.dashboard-conversation:hover{background:#f8faf7;border-radius:10px}.dashboard-conversation .chat-name{display:block}.dashboard-conversation .chat-time{line-height:1.8}.dashboard-conversation .unread-badge{display:inline-flex;align-items:center;justify-content:center;min-width:19px;height:19px;padding:0 5px;border-radius:999px;background:#223e2a;color:white;font-size:10px;font-weight:700}";
  document.head.append(dashboardStyle);
  window.addEventListener("conecta-notices-sync", renderDashboardPanels);
  window.addEventListener("conecta-notices-sync", renderDashboardPanels);
  window.addEventListener("conecta-messages-sync", renderDashboardConversations);
  window.addEventListener("conecta-unread-sync", () => {
    renderDashboardConversations();
  });

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

  document.addEventListener("submit", async event => {
    const form = event.target;
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
})();
