import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://fmyenjfzdwizpgretpkk.supabase.co";
const SUPABASE_KEY = "sb_publishable_XsK59ORoIfm8uC-LopD43A_GvodDocS";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const accountClient = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
let stopDataSync = () => {};
let stopMessageSync = () => {};
let activeMessageChannel = null;
let messageWatchGeneration = 0;
let presenceChannel = null;
let activeAuthUserId = null;
let personalDataGeneration = 0;
const profilePhotoUrlCache = new Map();

const dispatch = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
const normalize = (row, extra = {}) => ({ id: row.id, ...row, ...extra });
const syncDate = value => value ? new Date(value).toLocaleDateString("pt-BR") + " · " + new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";

async function ensureUserProfile(user) {
  let { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!profile) {
    ({ data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle());
  }
  return profile || { name: user.user_metadata?.name || user.email?.split("@")[0] || "Colaborador", email: user.email || "", role: "colaborador", sector: "Geral" };
}

async function withGlobalAnnouncementImages(rows = []) {
  return Promise.all(rows.map(async row => {
    if (!row.image_path) return { ...row, image_url: "" };
    const { data, error } = await supabase.storage.from("global-announcements").createSignedUrl(row.image_path, 12 * 60 * 60);
    if (error) console.error("Could not sign global announcement image", error);
    return { ...row, image_url: data?.signedUrl || "" };
  }));
}

async function withProfilePhotoUrls(rows = []) {
  const now = Date.now();
  const entries = await Promise.all(rows.map(async row => {
    if (!row.path || !row.user_id) return [row.user_id, ""];
    const cached = profilePhotoUrlCache.get(row.path);
    if (cached && cached.expiresAt > now + 10 * 60 * 1000) return [row.user_id, cached.url];
    const { data, error } = await supabase.storage.from("profile-photos").createSignedUrl(row.path, 12 * 60 * 60);
    if (error) { console.error("Could not sign profile photo", error); return [row.user_id, ""]; }
    const url = data?.signedUrl || "";
    profilePhotoUrlCache.set(row.path, { url, expiresAt: now + 11 * 60 * 60 * 1000 });
    return [row.user_id, url];
  }));
  return new Map(entries);
}

async function loadPersonalData(user) {
  const generation = ++personalDataGeneration;
  const results = await Promise.all([
    supabase.from("team_status").select("user_id,status,note,updated_at"),
    supabase.from("message_favorites").select("message_id,created_at,message:messages(id,conversation_id,text,author_id,author_name,created_at,deleted_at,attachment_name,attachment_path)").eq("user_id", user.id).order("created_at", { ascending: false }),
    supabase.from("kitchen_calendar").select("config,version").eq("id", true).maybeSingle(),
    supabase.from("message_hidden_for").select("message_id").eq("user_id", user.id)
  ]);
  if (window.conectaCurrentUser?.id !== user.id || generation !== personalDataGeneration) return;
  const [statuses, favorites, calendar, hidden] = results;
  if (!statuses.error) dispatch("conecta-team-status-sync", statuses.data || []);
  if (!favorites.error && !hidden.error) {
    const excluded = new Set((hidden.data || []).map(row => row.message_id));
    dispatch("conecta-favorites-sync", (favorites.data || []).filter(row => row.message && !excluded.has(row.message_id)));
  }
  if (!calendar.error) dispatch("conecta-kitchen-config-sync", calendar.data);
  if (results.some(result => result.error)) console.warn("Could not refresh personal features", results.filter(result => result.error).map(result => result.error));
}

async function loadData(user) {
  void loadPersonalData(user).catch(error => console.warn("Personal features refresh failed", error));
  const profile = await ensureUserProfile(user);
  // Reminders are private to their creator, including for administrator accounts.
  const remindersQuery = supabase.from("reminders").select("*").eq("owner_id", user.id).order("created_at", { ascending: false });
  const [{ data: notices }, { data: reminders }, { data: conversations }, { data: users }, { data: directory }, { data: unreadRows }, { data: announcements }, { data: photoRows }] = await Promise.all([
    supabase.from("notices").select("*").order("created_at", { ascending: false }),
    remindersQuery,
    supabase.from("conversations").select("*").order("updated_at", { ascending: false }),
    supabase.from("profiles").select("*").order("name"),
    supabase.rpc("list_team_directory"),
    supabase.rpc("get_unread_counts"),
    supabase.from("global_announcements").select("*").order("starts_at", { ascending: true }),
    supabase.from("profile_photos").select("user_id,path")
  ]);
  const photoUrls = await withProfilePhotoUrls(photoRows || []);
  const colleagues = (directory || []).map(person => ({ ...person, avatar_url: photoUrls.get(person.id) || "" }));
  if (window.conectaCurrentProfile && window.conectaCurrentUser?.id === user.id) {
    window.conectaCurrentProfile.avatar_url = photoUrls.get(user.id) || "";
    dispatch("conecta-profile-photo-sync", { id: user.id, avatar_url: window.conectaCurrentProfile.avatar_url });
  }
  const people = new Map(colleagues.map(person => [person.id, person]));
  const unreadCounts = new Map((unreadRows || []).map(row => [row.conversation_id, Number(row.unread_count) || 0]));
  dispatch("conecta-notices-sync", (notices || []).map(x => ({ ...x, text: x.body, time: syncDate(x.created_at) })));
  dispatch("conecta-reminders-sync", (reminders || []).map(x => ({ ...x, title: x.title, time: syncDate(x.due_at || x.created_at), done: x.done })));
  dispatch("conecta-directory-sync", colleagues);
  dispatch("conecta-conversations-sync", (conversations || []).map(x => {
    const otherId = x.kind === "direct" ? (x.created_by === user.id ? x.direct_recipient_id : x.created_by) : null;
    const other = otherId ? people.get(otherId) : null;
    return { ...x, firestoreId: x.id, name: x.kind === "direct" ? (other?.name || "Conversa individual") : x.name, directUserId: otherId, directSector: other?.sector || "", avatar_url: other?.avatar_url || "", unreadCount: unreadCounts.get(x.id) || 0, kind: x.kind, lastMessage: x.last_message };
  }));
  dispatch("conecta-unread-sync", Object.fromEntries(unreadCounts));
  const now = Date.now();
  const currentAnnouncements = (announcements || []).filter(item => item.is_active && new Date(item.starts_at).getTime() <= now && (!item.ends_at || new Date(item.ends_at).getTime() > now));
  dispatch("conecta-global-announcement-sync", await withGlobalAnnouncementImages(currentAnnouncements));
  if (profile.role === "admin" && profile.active === true) dispatch("conecta-users-sync", (users || []).map(x => ({ ...x, email: x.email })));
}

async function dispatchIncomingMessageNotification(payload, user) {
  const message = payload?.new;
  if (!message?.id || !message.author_id || message.author_id === user.id) return;
  const { data: visibleMessage, error } = await supabase.from("messages").select("id,conversation_id,author_id,text,deleted_at").eq("id", message.id).maybeSingle();
  if (error || !visibleMessage || visibleMessage.deleted_at || visibleMessage.author_id === user.id) return;
  const [{ data: conversation, error: conversationError }, { data: directory }] = await Promise.all([
    supabase.from("conversations").select("name,kind,created_by,direct_recipient_id").eq("id", visibleMessage.conversation_id).maybeSingle(),
    supabase.rpc("list_team_directory")
  ]);
  if (window.conectaCurrentUser?.id !== user.id || conversationError || !conversation) return;
  // Administrator read access for moderation does not make them a chat participant.
  if (conversation.kind === "direct" && conversation.created_by !== user.id && conversation.direct_recipient_id !== user.id) return;
  if (!["direct", "channel"].includes(conversation.kind)) return;
  const author = (directory || []).find(person => person.id === visibleMessage.author_id);
  dispatch("conecta-incoming-message-notification", {
    id: visibleMessage.id,
    conversationId: visibleMessage.conversation_id,
    authorId: visibleMessage.author_id,
    authorName: author?.name || "Um colaborador",
    isNudge: visibleMessage.text === "🔔 Chamou sua atenção!",
    conversationKind: conversation?.kind || null,
    conversationName: conversation?.kind === "channel" ? (conversation.name || "um canal") : "sua conversa individual"
  });
}

function startDataSync(user) {
  stopDataSync();
  loadData(user);
  const channel = supabase.channel("conecta-live").on("postgres_changes", { event: "*", schema: "public", table: "notices" }, () => loadData(user)).on("postgres_changes", { event: "*", schema: "public", table: "global_announcements" }, () => loadData(user)).on("postgres_changes", { event: "*", schema: "public", table: "reminders" }, () => loadData(user)).on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => loadData(user)).on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => loadData(user)).on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => loadData(user)).on("postgres_changes", { event: "*", schema: "public", table: "team_status" }, () => loadPersonalData(user)).on("postgres_changes", { event: "*", schema: "public", table: "message_favorites", filter: "user_id=eq." + user.id }, () => loadPersonalData(user)).on("postgres_changes", { event: "*", schema: "public", table: "kitchen_calendar" }, () => loadPersonalData(user)).on("postgres_changes", { event: "*", schema: "public", table: "message_hidden_for", filter: "user_id=eq." + user.id }, () => loadPersonalData(user)).on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, payload => dispatchIncomingMessageNotification(payload, user)).subscribe();
  const announcementScheduleTimer = window.setInterval(() => loadData(user), 60_000);
  const liveChannel = supabase.channel("conecta-presence", { config: { private: true, presence: { key: user.id } } })
    .on("presence", { event: "sync" }, () => {
      if (presenceChannel !== liveChannel) return;
      const userIds = Object.entries(liveChannel.presenceState()).filter(([,sessions]) => sessions.length > 0).map(([id]) => id);
      dispatch("conecta-online-count-sync", userIds.length);
      dispatch("conecta-presence-sync", { userIds, ready: true });
    })
    .subscribe(async status => {
      if (status === "SUBSCRIBED") {
        const result = await liveChannel.track({ userId: user.id });
        if (result !== "ok") console.error("Could not publish team presence", result);
      } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status) && presenceChannel === liveChannel) {
        dispatch("conecta-online-count-sync", 0);
        dispatch("conecta-presence-sync", { userIds: [], ready: false });
      }
    });
  presenceChannel = liveChannel;
  stopDataSync = () => {
    window.clearInterval(announcementScheduleTimer);
    supabase.removeChannel(channel);
    if (presenceChannel === liveChannel) presenceChannel = null;
    supabase.removeChannel(liveChannel);
    dispatch("conecta-online-count-sync", 0);
    dispatch("conecta-presence-sync", { userIds: [], ready: false });
    messageWatchGeneration++;
    const messageChannel = activeMessageChannel;
    activeMessageChannel = null;
    stopMessageSync = () => {};
    if (messageChannel) supabase.removeChannel(messageChannel);
  };
}

const loadReadReceipts = async conversationId => {
  const { data, error } = await supabase.from("conversation_reads").select("user_id,last_read_at").eq("conversation_id", conversationId);
  if (error) { console.warn("Could not load read receipts", error); return; }
  dispatch("conecta-read-receipts-sync", { conversationId, reads: data || [] });
};

const watchMessages = async (conversationId, callback) => {
  const generation = ++messageWatchGeneration;
  const previousChannel = activeMessageChannel;
  activeMessageChannel = null;
  if (previousChannel) await supabase.removeChannel(previousChannel);
  const userId = window.conectaCurrentUser?.id;
  const refresh = async () => {
    const [{ data, error }, { data: hidden, error: hiddenError }] = await Promise.all([
      supabase.from("messages").select("*").eq("conversation_id", conversationId).order("created_at"),
      supabase.from("message_hidden_for").select("message_id").eq("user_id", userId)
    ]);
    if (generation !== messageWatchGeneration) return;
    if (error) throw error;
    if (hiddenError) throw hiddenError;
    const hiddenIds = new Set((hidden || []).map(x => x.message_id));
    const visible = (data || []).filter(x => !hiddenIds.has(x.id));
    const gifIds = [...new Set(visible
      .filter(x => x.attachment_path?.startsWith("giphy:"))
      .map(x => x.attachment_path.slice("giphy:".length))
      .filter(Boolean))];
    const giphyUrls = new Map();
    const apiKey = window.conectaGifConfig?.apiKey?.trim();
    if (apiKey && gifIds.length) {
      for (let offset = 0; offset < gifIds.length; offset += 100) {
        const batch = gifIds.slice(offset, offset + 100);
        try {
          const params = new URLSearchParams({ api_key: apiKey, ids: batch.join(","), rating: "g" });
          const response = await fetch("https://api.giphy.com/v1/gifs?" + params.toString(), { cache: "no-store" });
          if (!response.ok) throw new Error("GIPHY returned " + response.status);
          const payload = await response.json();
          (payload.data || []).forEach(gif => {
            const url = gif.images?.original?.url;
            if (url) giphyUrls.set(gif.id, url);
          });
        } catch (error) { console.error("Could not resolve chat GIF batch", error); }
      }
    }
    const withAttachments = await Promise.all(visible.map(async x => {
      let attachmentUrl = x.attachment_url || "";
      if (x.attachment_path?.startsWith("giphy:")) {
        attachmentUrl = giphyUrls.get(x.attachment_path.slice("giphy:".length)) || "";
      } else if (x.attachment_path?.startsWith("file:")) {
        if (!x.deleted_at) {
          const path = x.attachment_path.slice(5);
          const { data: signed, error: signedError } = await supabase.storage.from("chat-files").createSignedUrl(path, 6 * 60 * 60, { download: x.attachment_name || "anexo" });
          if (signedError) console.warn("Attachment URL unavailable", signedError);
          attachmentUrl = signed?.signedUrl || "";
        }
      } else if (x.attachment_path) {
        const { data: signed, error: signedError } = await supabase.storage.from("chat-media").createSignedUrl(x.attachment_path, 6 * 60 * 60);
        if (signedError) console.error("Could not sign chat GIF", signedError);
        attachmentUrl = signed?.signedUrl || "";
      }
      return { id: x.id, ...x, text: x.text, attachmentUrl, createdAt: x.created_at, replyTo: x.reply_to, editedAt: x.edited_at, deletedAt: x.deleted_at };
    }));
    if (generation !== messageWatchGeneration) return;
    callback(withAttachments);

  };
  try { await refresh(); } catch (error) { console.error("Could not load conversation messages", error); return; }
  if (generation !== messageWatchGeneration) return;
  const refreshSafely = () => refresh().catch(error => console.error("Could not refresh conversation messages", error));
  const channel = supabase.channel("messages-" + conversationId)
    .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: "conversation_id=eq." + conversationId }, refreshSafely)
    .on("postgres_changes", { event: "*", schema: "public", table: "message_hidden_for", filter: "user_id=eq." + userId }, refreshSafely)
    .on("postgres_changes", { event: "*", schema: "public", table: "conversation_reads", filter: "conversation_id=eq." + conversationId }, () => loadReadReceipts(conversationId))
    .subscribe(status => { if (status === "SUBSCRIBED") void loadReadReceipts(conversationId); });
  void loadReadReceipts(conversationId);
  activeMessageChannel = channel;
  stopMessageSync = () => {
    if (activeMessageChannel !== channel) return;
    messageWatchGeneration++;
    activeMessageChannel = null;
    return supabase.removeChannel(channel);
  };
};

const authCompat = {
  get currentUser() { return window.conectaCurrentUser || null; },
  getUser: () => supabase.auth.getUser(),
  signOut: () => supabase.auth.signOut()
};

window.conectaFirebase = {
  loadPersonalData,
  setTeamStatus: async (user, status, note = "") => {
    if (!["available", "busy", "meeting", "away"].includes(status) || note.length > 80) throw new Error("Status inválido.");
    const { error } = await supabase.from("team_status").upsert({ user_id: user.id, status, note: note.trim(), updated_at: new Date().toISOString() });
    if (error) throw error;
    await loadPersonalData(user);
  },
  setMessageFavorite: async (user, messageId, favorite) => {
    const query = favorite
      ? supabase.from("message_favorites").upsert({ user_id: user.id, message_id: messageId }, { onConflict: "user_id,message_id", ignoreDuplicates: true })
      : supabase.from("message_favorites").delete().eq("user_id", user.id).eq("message_id", messageId);
    const { error } = await query;
    if (error) throw error;
    await loadPersonalData(user);
  },
  app: supabase, auth: authCompat, db: supabase, config: { projectId: "fmyenjfzdwizpgretpkk" },
  signInWithEmailAndPassword: (_auth, email, password) => supabase.auth.signInWithPassword({ email, password }),
  sendPasswordResetEmail: (_auth, email) => supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin }),
  signOut: _auth => supabase.auth.signOut(), startDataSync, ensureUserProfile,
  uploadProfilePhoto: async (user, file) => {
    if (!user?.id || !file || file.type !== "image/webp" || file.size > 300 * 1024) throw new Error("A foto otimizada ultrapassa o limite permitido.");
    const path = user.id + "/avatar.webp";
    const { error: uploadError } = await supabase.storage.from("profile-photos").upload(path, file, { contentType: "image/webp", cacheControl: "3600", upsert: true });
    if (uploadError) throw uploadError;
    const { error: recordError } = await supabase.from("profile_photos").upsert({ user_id: user.id, path, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (recordError) throw recordError;
    profilePhotoUrlCache.delete(path);
    const { data, error } = await supabase.storage.from("profile-photos").createSignedUrl(path, 12 * 60 * 60);
    if (error) throw error;
    const avatarUrl = data?.signedUrl || "";
    profilePhotoUrlCache.set(path, { url: avatarUrl, expiresAt: Date.now() + 11 * 60 * 60 * 1000 });
    if (window.conectaCurrentProfile) window.conectaCurrentProfile.avatar_url = avatarUrl;
    dispatch("conecta-profile-photo-sync", { id: user.id, avatar_url: avatarUrl });
    await loadData(user);
    return avatarUrl;
  },
  uploadChatFile: async (user, conversationId, file) => {
    if (!user?.id || !conversationId) throw new Error("Entre e selecione uma conversa.");
    const info = window.conectaAttachments.validate(file);
    const path = `${user.id}/${conversationId}/${crypto.randomUUID()}.${info.extension}`;
    const { error } = await supabase.storage.from("chat-files").upload(path, file, { contentType: info.mime, upsert: false });
    if (error) throw error;
    return { path: "file:" + path, info };
  },
  removePendingChatFile: async path => {
    if (path?.startsWith("file:")) await supabase.storage.from("chat-files").remove([path.slice(5)]);
  },
  uploadChatGif: async (user, file) => {
    if (!user?.id || file?.type !== "image/gif") throw new Error("Cole um arquivo GIF animado.");
    if (file.size > 8 * 1024 * 1024) throw new Error("O GIF precisa ter até 8 MB.");
    const path = user.id + "/" + crypto.randomUUID() + ".gif";
    const { error: uploadError } = await supabase.storage.from("chat-media").upload(path, file, { contentType: "image/gif", cacheControl: "3600", upsert: false });
    if (uploadError) throw uploadError;
    const { data, error } = await supabase.storage.from("chat-media").createSignedUrl(path, 6 * 60 * 60);
    if (error) throw error;
    return { path, url: data?.signedUrl || "" };
  },
  changePassword: async ({ currentPassword, newPassword, nonce = "" }) => {
    const signedInUser = window.conectaCurrentUser;
    if (!signedInUser?.id || !signedInUser.email) throw new Error("Sua sessão expirou. Entre novamente para trocar a senha.");

    // Verify the current credential on the isolated client so the main app session is not replaced.
    const { data: verified, error: verificationError } = await accountClient.auth.signInWithPassword({
      email: signedInUser.email,
      password: currentPassword
    });
    if (verificationError) throw new Error("A senha atual está incorreta.");
    if (verified.user?.id !== signedInUser.id) throw new Error("Não foi possível validar a conta conectada.");

    // Reuse the freshly verified session for the authenticated password update.
    if (verified.session && !nonce) {
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: verified.session.access_token,
        refresh_token: verified.session.refresh_token
      });
      if (sessionError) throw sessionError;
    }
    const update = {
      current_password: currentPassword,
      password: newPassword
    };
    if (nonce) update.nonce = nonce;
    const { data, error } = await supabase.auth.updateUser(update);
    if (error) {
      const authError = `${error.code || ""} ${error.message || ""}`.toLowerCase();
      if (!nonce && authError.includes("reauthentication")) {
        const { error: reauthError } = await supabase.auth.reauthenticate();
        if (reauthError) throw reauthError;
        const challenge = new Error("Foi enviado um código de confirmação para o e-mail da sua conta.");
        challenge.code = "reauthentication_required";
        throw challenge;
      }
      throw error;
    }
    return data.user;
  },
  createUser: async (_admin, data) => {
    const { data: result, error } = await accountClient.auth.signUp({ email: data.email, password: data.password, options: { data: { name: data.name } } });
    if (error) throw error;
    if (result.user) { const { error: profileError } = await supabase.from("profiles").upsert({ id: result.user.id, name: data.name, email: data.email, role: data.role, sector: data.sector, active: true }); if (profileError) throw profileError; }
    return result.user;
  },
  listGlobalAnnouncements: async () => {
    const { data, error } = await supabase.from("global_announcements").select("*").order("starts_at", { ascending: false });
    if (error) throw error;
    return withGlobalAnnouncementImages(data || []);
  },
  saveGlobalAnnouncement: async (user, data) => {
    const id = data.id || crypto.randomUUID();
    const { data: oldRow, error: oldError } = await supabase.from("global_announcements").select("image_path").eq("id", id).maybeSingle();
    if (oldError) throw oldError;
    let imagePath = data.removeImage ? null : (oldRow?.image_path || null);
    let uploadedPath = null;
    if (data.imageFile) {
      if (data.imageFile.type !== "image/webp" || data.imageFile.size > 900 * 1024) throw new Error("A imagem precisa estar otimizada em WebP e ter até 900 KB.");
      uploadedPath = `${id}/${crypto.randomUUID()}.webp`;
      const { error: uploadError } = await supabase.storage.from("global-announcements").upload(uploadedPath, data.imageFile, { contentType: data.imageFile.type, cacheControl: "3600", upsert: false });
      if (uploadError) throw uploadError;
      imagePath = uploadedPath;
    }
    const record = { id, title: data.title, body: data.body, is_active: data.is_active !== false, starts_at: data.starts_at, ends_at: data.ends_at || null, image_path: imagePath, updated_by: user.id, updated_at: new Date().toISOString() };
    const { error } = await supabase.from("global_announcements").upsert(record, { onConflict: "id" });
    if (error) {
      if (uploadedPath) await supabase.storage.from("global-announcements").remove([uploadedPath]);
      throw error;
    }
    if (oldRow?.image_path && oldRow.image_path !== imagePath) await supabase.storage.from("global-announcements").remove([oldRow.image_path]);
    await loadData(user);
  },
  setGlobalAnnouncementActive: async (user, id, isActive) => {
    const { error } = await supabase.from("global_announcements").update({ is_active: isActive, updated_by: user.id, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
    await loadData(user);
  },
  deleteGlobalAnnouncement: async (user, id) => {
    const { data: record, error: readError } = await supabase.from("global_announcements").select("image_path").eq("id", id).maybeSingle();
    if (readError) throw readError;
    const { error } = await supabase.from("global_announcements").delete().eq("id", id);
    if (error) throw error;
    if (record?.image_path) await supabase.storage.from("global-announcements").remove([record.image_path]);
    await loadData(user);
  },
  addNotice: async (user, data) => { const { error } = await supabase.from("notices").insert({ title: data.title, sector: data.sector, tag: data.tag || "NOVO", body: data.text, author_id: user.id }); if (error) throw error; },
  updateNotice: async (id, data) => { const { error } = await supabase.from("notices").update({ title: data.title, body: data.text, sector: data.sector }).eq("id", id); if (error) throw error; },
  deleteNotice: async id => { const { data, error } = await supabase.from("notices").delete().eq("id", id).select("id").maybeSingle(); if (error) throw error; if (!data) throw new Error("O aviso não pode ser excluído."); },
  addReminder: async (user, data) => { const { error } = await supabase.from("reminders").insert({ title: data.title, due_at: data.due_at || new Date().toISOString(), done: !!data.done, owner_id: user.id }); if (error) throw error; },
  updateReminder: async (id, data) => {
    const changes = {};
    if (Object.hasOwn(data, "title")) changes.title = data.title;
    if (Object.hasOwn(data, "due_at")) changes.due_at = data.due_at;
    if (Object.hasOwn(data, "done")) changes.done = !!data.done;
    if (!Object.keys(changes).length) return;
    const { data: updated, error } = await supabase.from("reminders").update(changes).eq("id", id).select("id").maybeSingle();
    if (error) throw error;
    if (!updated) throw new Error("O lembrete não foi atualizado. Verifique se ainda está ativo e se você tem acesso a ele.");
  },
  deleteReminder: async id => { const { data, error } = await supabase.from("reminders").delete().eq("id", id).select("id").maybeSingle(); if (error) throw error; if (!data) throw new Error("O lembrete não pode ser excluído."); },
  editMessage: async (id, text) => {
    const { data: previous, error: readError } = await supabase.from("messages").select("conversation_id,text").eq("id", id).maybeSingle();
    if (readError) throw readError;
    if (!previous) throw new Error("A mensagem não foi encontrada.");
    const { data, error } = await supabase.from("messages").update({ text }).eq("id", id).is("deleted_at", null).select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("A mensagem não pode mais ser editada.");
    await supabase.from("conversations").update({ last_message: text }).eq("id", previous.conversation_id).eq("last_message", previous.text);
  },
  deleteMessageForEveryone: async id => {
    const { data: previous, error: readError } = await supabase.from("messages").select("conversation_id,text").eq("id", id).maybeSingle();
    if (readError) throw readError;
    if (!previous) throw new Error("A mensagem não foi encontrada.");
    const { data, error } = await supabase.from("messages").update({ text: "Mensagem apagada", deleted_at: new Date().toISOString() }).eq("id", id).is("deleted_at", null).select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("A mensagem não pode mais ser apagada.");
    await supabase.from("conversations").update({ last_message: "Mensagem apagada" }).eq("id", previous.conversation_id).eq("last_message", previous.text);
  },
  deleteMessageForMe: async (id, user) => { const { error } = await supabase.from("message_hidden_for").insert({ message_id: id, user_id: user.id }); if (error && error.code !== "23505") throw error; },
  ensureChannel: async (user, name) => { let { data: existing } = await supabase.from("conversations").select("id").eq("name", name).maybeSingle(); if (existing) return existing.id; const { data } = await supabase.from("conversations").insert({ kind: "channel", name, sector: name, created_by: user.id }).select("id").single(); return data.id; },
  startDirectConversation: async (user, otherUserId) => {
    const { data, error } = await supabase.rpc("start_direct_conversation", { p_other_user_id: otherUserId });
    if (error) throw error;
    await loadData(user);
    return data;
  },
  loadReadReceipts,
  markConversationRead: async (user, conversationId, seenAt) => {
    if (!user?.id || !seenAt) return;
    const { error } = await supabase.rpc("mark_conversation_seen", { p_conversation_id: conversationId, p_seen_at: seenAt });
    if (error) throw error;
    const { data, error: unreadError } = await supabase.rpc("get_unread_counts");
    if (unreadError) throw unreadError;
    dispatch("conecta-unread-sync", Object.fromEntries((data || []).map(row => [row.conversation_id, Number(row.unread_count) || 0])));
  },
  watchMessages,
  searchMessages: async query => {
    const term = String(query || "").trim().slice(0, 120);
    if (term.length < 2) return [];
    const { data, error } = await supabase.from("messages")
      .select("id,conversation_id,text,author_id,created_at")
      .ilike("text", `%${term}%`)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(12);
    if (error) throw error;
    return data || [];
  },
  sendMessage: async (user, conversationId, text, replyTo = null, attachmentPath = null, attachmentUrl = null, attachmentInfo = null) => {
    const { error } = await supabase.from("messages").insert({
      conversation_id: conversationId, text: text || "", author_id: user.id, reply_to: replyTo,
      attachment_path: attachmentPath, attachment_url: attachmentUrl,
      ...(attachmentInfo ? { attachment_name: attachmentInfo.name, attachment_mime: attachmentInfo.mime, attachment_size: attachmentInfo.size } : {})
    });
    if (error) throw error;
    const { error: updateError } = await supabase.from("conversations").update({ updated_at: new Date().toISOString(), last_message: text || (attachmentInfo?.name ? "📎 " + attachmentInfo.name : attachmentPath || attachmentUrl ? "GIF" : "") }).eq("id", conversationId);
    if (updateError) console.warn("Conversation preview update failed", updateError);
  }
};

supabase.auth.onAuthStateChange(async (_event, session) => {
  const user = session?.user;
  if (activeAuthUserId !== (user?.id || null)) { personalDataGeneration++; dispatch("conecta-auth-session-reset"); }
  activeAuthUserId = user?.id || null;
  window.conectaCurrentUser = user || null;
  document.querySelector("#authScreen")?.classList.toggle("visible", !user);
  document.querySelector(".app")?.classList.toggle("authenticated", !!user);
  document.querySelector("#authLoading")?.classList.remove("visible");
  if (user) {
    const profile = await ensureUserProfile(user);
    window.conectaCurrentProfile = profile;
    dispatch("conecta-profile-ready", profile);
    startDataSync(user);
    const label = profile.name || user.user_metadata?.name || user.email?.split("@")[0] || "Colaborador";
    document.querySelector("#currentUserName")?.replaceChildren(document.createTextNode(label));
    const initials = label.split(/[ ._-]+/).map(x => x[0]).join("").slice(0, 2).toUpperCase();
    if (document.querySelector("#currentUserInitials")) document.querySelector("#currentUserInitials").textContent = initials;
    if (document.querySelector("#greeting")) document.querySelector("#greeting").textContent = `Olá, ${label} 👋`;
  } else { window.conectaCurrentProfile = null; stopDataSync(); }
});
window.dispatchEvent(new CustomEvent("conecta-firebase-ready"));
