import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://fmyenjfzdwizpgretpkk.supabase.co";
const SUPABASE_KEY = "sb_publishable_XsK59ORoIfm8uC-LopD43A_GvodDocS";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const accountClient = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
let stopDataSync = () => {};
let stopMessageSync = () => {};
let activeMessageChannel = null;
let messageWatchGeneration = 0;

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

async function loadData(user) {
  const profile = await ensureUserProfile(user);
  let remindersQuery = supabase.from("reminders").select("*").order("created_at", { ascending: false });
  if (profile.role !== "admin" || profile.active !== true) remindersQuery = remindersQuery.eq("owner_id", user.id);
  const [{ data: notices }, { data: reminders }, { data: conversations }, { data: users }, { data: directory }, { data: unreadRows }] = await Promise.all([
    supabase.from("notices").select("*").order("created_at", { ascending: false }),
    remindersQuery,
    supabase.from("conversations").select("*").order("updated_at", { ascending: false }),
    supabase.from("profiles").select("*").order("name"),
    supabase.rpc("list_team_directory"),
    supabase.rpc("get_unread_counts")
  ]);
  const colleagues = directory || [];
  const people = new Map(colleagues.map(person => [person.id, person]));
  const unreadCounts = new Map((unreadRows || []).map(row => [row.conversation_id, Number(row.unread_count) || 0]));
  dispatch("conecta-notices-sync", (notices || []).map(x => ({ ...x, text: x.body, time: syncDate(x.created_at) })));
  dispatch("conecta-reminders-sync", (reminders || []).map(x => ({ ...x, title: x.title, time: syncDate(x.due_at || x.created_at), done: x.done })));
  dispatch("conecta-directory-sync", colleagues);
  dispatch("conecta-conversations-sync", (conversations || []).map(x => {
    const otherId = x.kind === "direct" ? (x.created_by === user.id ? x.direct_recipient_id : x.created_by) : null;
    const other = otherId ? people.get(otherId) : null;
    return { ...x, firestoreId: x.id, name: x.kind === "direct" ? (other?.name || "Conversa individual") : x.name, directUserId: otherId, directSector: other?.sector || "", unreadCount: unreadCounts.get(x.id) || 0, kind: x.kind, lastMessage: x.last_message };
  }));
  dispatch("conecta-unread-sync", Object.fromEntries(unreadCounts));
  if (profile.role === "admin" && profile.active === true) dispatch("conecta-users-sync", (users || []).map(x => ({ ...x, email: x.email })));
}

function startDataSync(user) {
  stopDataSync();
  loadData(user);
  const channel = supabase.channel("conecta-live").on("postgres_changes", { event: "*", schema: "public", table: "notices" }, () => loadData(user)).on("postgres_changes", { event: "*", schema: "public", table: "reminders" }, () => loadData(user)).on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => loadData(user)).on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => loadData(user)).on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => loadData(user)).subscribe();
  stopDataSync = () => {
    supabase.removeChannel(channel);
    messageWatchGeneration++;
    const messageChannel = activeMessageChannel;
    activeMessageChannel = null;
    stopMessageSync = () => {};
    if (messageChannel) supabase.removeChannel(messageChannel);
  };
}

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
    callback(visible.map(x => ({ id: x.id, ...x, text: x.text, createdAt: x.created_at, replyTo: x.reply_to, editedAt: x.edited_at, deletedAt: x.deleted_at })));
    if (userId && generation === messageWatchGeneration) {
      const { error: readError } = await supabase.from("conversation_reads").upsert({ conversation_id: conversationId, user_id: userId, last_read_at: new Date().toISOString() }, { onConflict: "conversation_id,user_id" });
      if (readError) console.error("Could not mark conversation as read", readError);
      else {
        const { data: unread, error: unreadError } = await supabase.rpc("get_unread_counts");
        if (!unreadError && generation === messageWatchGeneration) dispatch("conecta-unread-sync", Object.fromEntries((unread || []).map(row => [row.conversation_id, Number(row.unread_count) || 0])));
      }
    }
  };
  try { await refresh(); } catch (error) { console.error("Could not load conversation messages", error); return; }
  if (generation !== messageWatchGeneration) return;
  const refreshSafely = () => refresh().catch(error => console.error("Could not refresh conversation messages", error));
  const channel = supabase.channel("messages-" + conversationId)
    .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: "conversation_id=eq." + conversationId }, refreshSafely)
    .on("postgres_changes", { event: "*", schema: "public", table: "message_hidden_for", filter: "user_id=eq." + userId }, refreshSafely)
    .subscribe();
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
  app: supabase, auth: authCompat, db: supabase, config: { projectId: "fmyenjfzdwizpgretpkk" },
  signInWithEmailAndPassword: (_auth, email, password) => supabase.auth.signInWithPassword({ email, password }),
  sendPasswordResetEmail: (_auth, email) => supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin }),
  signOut: _auth => supabase.auth.signOut(), startDataSync, ensureUserProfile,
  createUser: async (_admin, data) => {
    const { data: result, error } = await accountClient.auth.signUp({ email: data.email, password: data.password, options: { data: { name: data.name } } });
    if (error) throw error;
    if (result.user) { const { error: profileError } = await supabase.from("profiles").upsert({ id: result.user.id, name: data.name, email: data.email, role: data.role, sector: data.sector, active: true }); if (profileError) throw profileError; }
    return result.user;
  },
  addNotice: async (user, data) => { const { error } = await supabase.from("notices").insert({ title: data.title, sector: data.sector, tag: data.tag || "NOVO", body: data.text, author_id: user.id }); if (error) throw error; },
  updateNotice: async (id, data) => { const { error } = await supabase.from("notices").update({ title: data.title, body: data.text, sector: data.sector }).eq("id", id); if (error) throw error; },
  deleteNotice: async id => { const { data, error } = await supabase.from("notices").delete().eq("id", id).select("id").maybeSingle(); if (error) throw error; if (!data) throw new Error("O aviso não pode ser excluído."); },
  addReminder: async (user, data) => { const { error } = await supabase.from("reminders").insert({ title: data.title, due_at: data.due_at || new Date().toISOString(), done: !!data.done, owner_id: user.id }); if (error) throw error; },
  updateReminder: async (id, data) => { const { error } = await supabase.from("reminders").update({ title: data.title, due_at: data.due_at }).eq("id", id); if (error) throw error; },
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
  markConversationRead: async (user, conversationId) => {
    const { error } = await supabase.from("conversation_reads").upsert({ conversation_id: conversationId, user_id: user.id, last_read_at: new Date().toISOString() }, { onConflict: "conversation_id,user_id" });
    if (error) throw error;
    const { data, error: unreadError } = await supabase.rpc("get_unread_counts");
    if (unreadError) throw unreadError;
    dispatch("conecta-unread-sync", Object.fromEntries((data || []).map(row => [row.conversation_id, Number(row.unread_count) || 0])));
  },
  watchMessages,
  sendMessage: async (user, conversationId, text, replyTo = null) => {
    const { error } = await supabase.from("messages").insert({ conversation_id: conversationId, text, author_id: user.id, reply_to: replyTo });
    if (error) throw error;
    const { error: updateError } = await supabase.from("conversations").update({ updated_at: new Date().toISOString(), last_message: text }).eq("id", conversationId);
    if (updateError) throw updateError;
  }
};

supabase.auth.onAuthStateChange(async (_event, session) => {
  const user = session?.user;
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
