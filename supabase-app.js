import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://fmyenjfzdwizpgretpkk.supabase.co";
const SUPABASE_KEY = "sb_publishable_XsK59ORoIfm8uC-LopD43A_GvodDocS";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const accountClient = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
let stopDataSync = () => {};
let stopMessageSync = () => {};

const dispatch = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
const normalize = (row, extra = {}) => ({ id: row.id, ...row, ...extra });
const syncDate = value => value ? new Date(value).toLocaleDateString("pt-BR") + " · " + new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";

async function ensureUserProfile(user) {
  await supabase.rpc("bootstrap_first_admin");
  let { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!profile) {
    ({ data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle());
  }
  return profile || { name: user.user_metadata?.name || user.email?.split("@")[0] || "Colaborador", email: user.email || "", role: "colaborador", sector: "Geral" };
}

async function loadData(user) {
  const [{ data: notices }, { data: reminders }, { data: conversations }, { data: users }] = await Promise.all([
    supabase.from("notices").select("*").order("created_at", { ascending: false }),
    supabase.from("reminders").select("*").eq("owner_id", user.id).order("created_at", { ascending: false }),
    supabase.from("conversations").select("*").order("updated_at", { ascending: false }),
    supabase.from("profiles").select("*").order("name")
  ]);
  dispatch("conecta-notices-sync", (notices || []).map(x => ({ ...x, text: x.body, time: syncDate(x.created_at) })));
  dispatch("conecta-reminders-sync", (reminders || []).map(x => ({ ...x, title: x.title, time: syncDate(x.due_at || x.created_at), done: x.done })));
  dispatch("conecta-conversations-sync", (conversations || []).map(x => ({ ...x, firestoreId: x.id, name: x.name, kind: x.kind, lastMessage: x.last_message })));
  if ((await ensureUserProfile(user)).role === "admin") dispatch("conecta-users-sync", (users || []).map(x => ({ ...x, email: x.email })));
}

function startDataSync(user) {
  stopDataSync();
  loadData(user);
  const channel = supabase.channel("conecta-live").on("postgres_changes", { event: "*", schema: "public", table: "notices" }, () => loadData(user)).on("postgres_changes", { event: "*", schema: "public", table: "reminders" }, () => loadData(user)).on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => loadData(user)).on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => loadData(user)).subscribe();
  stopDataSync = () => { supabase.removeChannel(channel); stopMessageSync(); };
}

const watchMessages = async (conversationId, callback) => {
  stopMessageSync();
  const refresh = async () => { const { data } = await supabase.from("messages").select("*").eq("conversation_id", conversationId).order("created_at"); callback((data || []).map(x => ({ id: x.id, ...x, text: x.text, createdAt: x.created_at }))); };
  await refresh();
  const channel = supabase.channel("messages-" + conversationId).on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: "conversation_id=eq." + conversationId }, refresh).subscribe();
  stopMessageSync = () => supabase.removeChannel(channel);
};

window.conectaFirebase = {
  app: supabase, auth: supabase.auth, db: supabase, config: { projectId: "fmyenjfzdwizpgretpkk" },
  signInWithEmailAndPassword: (_auth, email, password) => supabase.auth.signInWithPassword({ email, password }),
  sendPasswordResetEmail: (_auth, email) => supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin }),
  signOut: _auth => supabase.auth.signOut(), startDataSync, ensureUserProfile,
  createUser: async (_admin, data) => {
    const { data: result, error } = await accountClient.auth.signUp({ email: data.email, password: data.password, options: { data: { name: data.name } } });
    if (error) throw error;
    if (result.user) { const { error: profileError } = await supabase.from("profiles").upsert({ id: result.user.id, name: data.name, email: data.email, role: data.role, sector: data.sector, active: true }); if (profileError) throw profileError; }
    return result.user;
  },
  addNotice: (user, data) => supabase.from("notices").insert({ title: data.title, sector: data.sector, tag: data.tag || "NOVO", body: data.text, author_id: user.id }),
  addReminder: (user, data) => supabase.from("reminders").insert({ title: data.title, due_at: new Date().toISOString(), done: !!data.done, owner_id: user.id }),
  ensureChannel: async (user, name) => { let { data: existing } = await supabase.from("conversations").select("id").eq("name", name).maybeSingle(); if (existing) return existing.id; const { data } = await supabase.from("conversations").insert({ kind: "channel", name, sector: name, created_by: user.id }).select("id").single(); return data.id; },
  watchMessages,
  sendMessage: async (user, conversationId, text) => { await supabase.from("messages").insert({ conversation_id: conversationId, text, author_id: user.id }); await supabase.from("conversations").update({ updated_at: new Date().toISOString(), last_message: text }).eq("id", conversationId); }
};

supabase.auth.onAuthStateChange(async (_event, session) => {
  const user = session?.user;
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
