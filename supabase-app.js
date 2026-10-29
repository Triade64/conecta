import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = window.conectaConfig.supabaseUrl;
const SUPABASE_KEY = window.conectaConfig.supabasePublishableKey;
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
const signedUrlCache = window.conectaSync.createUrlCache();
const giphyUrlCache = new Map();
let giphyRetryAfter = 0;
let activeHistory = null, dataQueue = null, dataOwner = null, dataEpoch = 0;
let dataState = {};
const personalGroups = ["statuses", "favorites", "calendar", "hidden"];
const allGroups = ["profile", "notices", "reminders", "conversations", "users", "directory", "unread", "announcements", "photos", ...personalGroups];
const signedUrl = (bucket, path, seconds, options) => {
  const owner = window.conectaCurrentUser?.id;
  const key = JSON.stringify([owner, bucket, path, options]);
  return signedUrlCache.get(key, (seconds - 120) * 1000, async () => {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, seconds, options);
    if (error) { console.warn("Could not sign private attachment", error); return ""; }
    return data?.signedUrl || "";
  });
};

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
  return Promise.all(rows.map(async row => ({ ...row, image_url: row.image_path ? await signedUrl("global-announcements", row.image_path, 12 * 60 * 60) : "" })));
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

async function loadPersonalData(user, groups = personalGroups) { return loadData(user, groups); }

async function publishAnnouncements(epoch = dataEpoch) {
  const now = Date.now();
  const rows = (dataState.announcements || []).filter(item => item.is_active && Date.parse(item.starts_at) <= now && (!item.ends_at || Date.parse(item.ends_at) > now));
  const visible = await withGlobalAnnouncementImages(rows);
  if (epoch === dataEpoch) dispatch("conecta-global-announcement-sync", visible);
}

async function refreshDataGroups(user, groups, epoch) {
  const current = () => epoch === dataEpoch && window.conectaCurrentUser?.id === user.id;
  if (!current()) return;
  if (groups.includes("profile")) {
    const profile = await ensureUserProfile(user);
    if (!current()) return;
    dataState.profile = profile;
    const previous = window.conectaCurrentProfile;
    window.conectaCurrentProfile = { ...previous, ...profile };
    if (previous?.role !== profile.role || previous?.active !== profile.active) dispatch("conecta-profile-ready", window.conectaCurrentProfile);
  }
  const queries = {
    notices: () => supabase.from("notices").select("id,title,body,sector,tag,author_id,created_at").order("created_at", { ascending: false }),
    reminders: () => supabase.from("reminders").select("id,title,due_at,done,owner_id,created_at").eq("owner_id", user.id).order("created_at", { ascending: false }),
    conversations: () => supabase.from("conversations").select("id,kind,name,sector,created_by,direct_recipient_id,managed_channel,member_ids,updated_at,last_message").order("updated_at", { ascending: false }),
    users: () => (dataState.profile || window.conectaCurrentProfile)?.role === "admin" ? supabase.from("profiles").select("id,name,email,role,sector,active").order("name") : Promise.resolve({data:[]}),
    directory: () => supabase.rpc("list_team_directory"),
    unread: () => supabase.rpc("get_unread_counts"),
    announcements: () => supabase.from("global_announcements").select("id,title,body,is_active,starts_at,ends_at,image_path,updated_at").order("starts_at", { ascending: true }),
    photos: () => supabase.from("profile_photos").select("user_id,path"),
    statuses: () => supabase.from("team_status").select("user_id,status,note,updated_at"),
    favorites: () => supabase.from("message_favorites").select("message_id,created_at,message:messages(id,conversation_id,text,author_id,author_name,created_at,deleted_at,attachment_name,attachment_path)").eq("user_id", user.id).order("created_at", { ascending: false }),
    calendar: () => supabase.from("kitchen_calendar").select("config,version").eq("id", true).maybeSingle(),
    hidden: () => supabase.from("message_hidden_for").select("message_id").eq("user_id", user.id)
  };
  const keys = [...new Set(groups)].filter(key => queries[key]);
  const results = await Promise.all(keys.map(key => queries[key]()));
  if (!current()) return;
  const changed = new Set();
  results.forEach((result,index) => {
    if (result.error) { console.warn("Could not refresh " + keys[index], result.error); return; }
    dataState[keys[index]] = result.data ?? (keys[index] === "calendar" ? null : []); changed.add(keys[index]);
  });
  if (changed.has("photos")) {
    dataState.photoUrls = await withProfilePhotoUrls(dataState.photos);
    if (!current()) return;
    const avatar = dataState.photoUrls.get(user.id) || "";
    if (window.conectaCurrentProfile) window.conectaCurrentProfile.avatar_url = avatar;
    dispatch("conecta-profile-photo-sync", { id:user.id, avatar_url:avatar });
  }
  const colleagues = (dataState.directory || []).map(person => ({...person,avatar_url:dataState.photoUrls?.get(person.id)||""}));
  const people = new Map(colleagues.map(person => [person.id,person]));
  const unreadCounts = new Map((dataState.unread || []).map(row => [row.conversation_id,Number(row.unread_count)||0]));
  if (changed.has("notices")) dispatch("conecta-notices-sync",dataState.notices.map(x=>({...x,text:x.body,time:syncDate(x.created_at)})));
  if (changed.has("reminders")) dispatch("conecta-reminders-sync",dataState.reminders.map(x=>({...x,time:syncDate(x.due_at||x.created_at),done:x.done})));
  if (changed.has("directory")||changed.has("photos")) dispatch("conecta-directory-sync",colleagues);
  if(changed.has("conversations")&&activeHistory&&!dataState.conversations.some(row=>row.id===activeHistory.id)) {
    const previous=activeHistory;stopMessageSync();previous.callback([]);
  }
  if (["conversations","directory","unread","photos"].some(key=>changed.has(key))) {
    dispatch("conecta-conversations-sync",(dataState.conversations||[]).map(x=>{
      const otherId=x.kind==="direct"?(x.created_by===user.id?x.direct_recipient_id:x.created_by):null,other=people.get(otherId);
      return {...x,firestoreId:x.id,name:x.kind==="direct"?(other?.name||"Conversa individual"):x.name,directUserId:otherId,directSector:other?.sector||"",avatar_url:other?.avatar_url||"",unreadCount:unreadCounts.get(x.id)||0,lastMessage:x.last_message};
    }));
  }
  if (changed.has("unread")) dispatch("conecta-unread-sync",Object.fromEntries(unreadCounts));
  if (changed.has("statuses")) dispatch("conecta-team-status-sync",dataState.statuses);
  if (changed.has("favorites")||changed.has("hidden")) {
    const hidden=new Set((dataState.hidden||[]).map(row=>row.message_id));
    dispatch("conecta-favorites-sync",(dataState.favorites||[]).filter(row=>row.message&&!hidden.has(row.message_id)));
  }
  if (changed.has("calendar")) dispatch("conecta-kitchen-config-sync",dataState.calendar);
  if (changed.has("users")&&(dataState.profile||window.conectaCurrentProfile)?.role==="admin") dispatch("conecta-users-sync",dataState.users);
  if (changed.has("announcements")) await publishAnnouncements(epoch);
}

function loadData(user, groups = allGroups, immediate = true) {
  if (window.conectaCurrentUser?.id !== user.id) return Promise.resolve();
  if (dataOwner !== user.id || !dataQueue) {
    dataQueue?.stop(); dataOwner=user.id; dataState={}; const epoch=++dataEpoch;
    dataQueue=window.conectaSync.createQueue(keys=>refreshDataGroups(user,keys,epoch));
  }
  return dataQueue.request(groups,immediate);
}

async function dispatchIncomingMessageNotification(payload, user) {
  const message = payload?.new;
  if (!message?.id || !message.author_id || message.author_id === user.id) return;
  const { data: visibleMessage, error } = await supabase.from("messages").select("id,conversation_id,author_id,text,deleted_at").eq("id", message.id).maybeSingle();
  if (error || !visibleMessage || visibleMessage.deleted_at || visibleMessage.author_id === user.id) return;
  const [{ data: conversation, error: conversationError }, { data: directory }] = await Promise.all([
    supabase.from("conversations").select("name,kind,created_by,direct_recipient_id,managed_channel,member_ids").eq("id", visibleMessage.conversation_id).maybeSingle(),
    typeof dataState !== "undefined" && dataOwner === user.id && dataState.directory ? Promise.resolve({data:dataState.directory}) : supabase.rpc("list_team_directory")
  ]);
  if (window.conectaCurrentUser?.id !== user.id || conversationError || !conversation) return;
  // Administrator read access for moderation does not make them a chat participant.
  if (conversation.kind === "direct" && conversation.created_by !== user.id && conversation.direct_recipient_id !== user.id) return;
  if (conversation.managed_channel && !conversation.member_ids?.includes(user.id)) return;
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
  let stopped=false, connected=false, lastRecovery=Date.now();
  const request = groups => { if (!stopped) void loadData(user,groups,false).catch(error=>console.warn("Data refresh failed",error)); };
  const recover = (force=false) => {
    if (stopped || (!force && Date.now()-lastRecovery < 60_000)) return;
    lastRecovery=Date.now(); request(allGroups);
    void activeHistory?.controller.recover().catch(error=>console.warn("Message recovery failed",error));
  };
  void loadData(user).catch(error=>console.warn("Initial data refresh failed",error));
  const channel=supabase.channel("conecta-live");
  const scopes={notices:["notices"],global_announcements:["announcements"],reminders:["reminders"],conversations:["conversations","unread"],profiles:allGroups,profile_photos:["photos"],team_status:["statuses"],message_favorites:["favorites"],kitchen_calendar:["calendar"],message_hidden_for:["hidden","favorites"]};
  for (const [table,groups]of Object.entries(scopes)) {
    const filter={event:"*",schema:"public",table};
    if (["reminders","message_favorites","message_hidden_for"].includes(table)) filter.filter=(table==="reminders"?"owner_id":"user_id")+"=eq."+user.id;
    channel.on("postgres_changes",filter,payload=>{
      if(table==="profile_photos")profilePhotoUrlCache.delete(payload.new?.path||payload.old?.path);
      request(groups);
    });
  }
  channel.on("postgres_changes",{event:"*",schema:"public",table:"messages"},payload=>{
    request(["conversations","unread"]);
    const id=payload.new?.id||payload.old?.id;
    if ((dataState.favorites||[]).some(row=>row.message_id===id)) request(["favorites"]);
    if(payload.eventType==="INSERT")void dispatchIncomingMessageNotification(payload,user).catch(error=>console.warn("Notification failed",error));
  }).subscribe(status=>{
    if(status==="SUBSCRIBED"){if(connected)recover(true);connected=true;}
    else if(["CHANNEL_ERROR","TIMED_OUT","CLOSED"].includes(status))lastRecovery=0;
  });
  // RLS hides future announcements from regular users. Check only IDs/versions
  // at the schedule boundary, fetching bodies only when the visible set changes.
  const announcementScheduleTimer=window.setInterval(async()=>{
    if(stopped)return;
    const epoch=dataEpoch;await publishAnnouncements(epoch);
    if((dataState.profile||window.conectaCurrentProfile)?.role!=="admin") {
      const {data,error}=await supabase.from("global_announcements").select("id,updated_at");
      if(stopped||epoch!==dataEpoch||error)return;
      const signature=rows=>JSON.stringify((rows||[]).map(row=>[row.id,row.updated_at]).sort((a,b)=>a[0].localeCompare(b[0])));
      if(signature(data)!==signature(dataState.announcements))request(["announcements"]);
    }
  },60_000);
  const recoveryTimer=window.setInterval(()=>{if(document.visibilityState==="visible")recover();},5*60_000);
  const onVisible=()=>{if(document.visibilityState==="visible")recover();};
  const onFocus=()=>recover(),onOnline=()=>recover(true);
  window.addEventListener("focus",onFocus);window.addEventListener("online",onOnline);document.addEventListener("visibilitychange",onVisible);
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
    stopped=true;
    window.clearInterval(announcementScheduleTimer);window.clearInterval(recoveryTimer);
    window.removeEventListener("focus",onFocus);window.removeEventListener("online",onOnline);document.removeEventListener("visibilitychange",onVisible);
    dataQueue?.stop();dataQueue=null;dataEpoch++;
    activeHistory=null;
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
  const owner=window.conectaCurrentUser?.id,generation=messageWatchGeneration;
  if(!owner)return;
  const { data, error } = await supabase.from("conversation_reads").select("user_id,last_read_at").eq("conversation_id", conversationId);
  if (error) { console.warn("Could not load read receipts", error); return; }
  if(owner!==window.conectaCurrentUser?.id||generation!==messageWatchGeneration)return;
  dispatch("conecta-read-receipts-sync", { conversationId, reads: data || [] });
};

async function decorateMessages(visible) {
  const apiKey=window.conectaGifConfig?.apiKey?.trim(),now=Date.now();
  const ids=[...new Set(visible.filter(row=>!row.deleted_at&&row.attachment_path?.startsWith("giphy:")).map(row=>row.attachment_path.slice(6)).filter(id=>!giphyUrlCache.has(id)||giphyUrlCache.get(id).expiresAt<=now))];
  if(apiKey&&Date.now()>=giphyRetryAfter)for(let offset=0;offset<ids.length;offset+=100){
    try{const params=new URLSearchParams({api_key:apiKey,ids:ids.slice(offset,offset+100).join(","),rating:"g"});
      const response=await fetch("https://api.giphy.com/v1/gifs?"+params);
      if(!response.ok){if(response.status===429)giphyRetryAfter=Date.now()+5*60_000;throw new Error("GIF unavailable");}
      for(const gif of (await response.json()).data||[])if(gif.images?.original?.url)giphyUrlCache.set(gif.id,{url:gif.images.original.url,expiresAt:Date.now()+60*60_000});
    }catch(error){console.warn(error);}
  }
  return Promise.all(visible.map(async x=>{
    let attachmentUrl=x.deleted_at?"":(x.attachment_url||"");const path=x.attachment_path;
    if(!x.deleted_at&&path?.startsWith("giphy:")) attachmentUrl=giphyUrlCache.get(path.slice(6))?.url||"";
    else if(!x.deleted_at&&path?.startsWith("file:")) attachmentUrl=await signedUrl("chat-files",path.slice(5),6*60*60,{download:x.attachment_name||"anexo"});
    else if(!x.deleted_at&&path)attachmentUrl=await signedUrl("chat-media",path,6*60*60);
    return {...x,attachmentUrl,createdAt:x.created_at,replyTo:x.reply_to,editedAt:x.edited_at,deletedAt:x.deleted_at};
  }));
}

const watchMessages = async (conversationId, callback) => {
  const userId=window.conectaCurrentUser?.id;
  if(!userId)return;
  if(activeHistory?.id===conversationId&&activeHistory.userId===userId){activeHistory.callback=callback;await activeHistory.controller.publish();return;}
  const generation=++messageWatchGeneration;
  const previous=activeMessageChannel;activeMessageChannel=null;activeHistory=null;
  if(previous)await supabase.removeChannel(previous);
  if(generation!==messageWatchGeneration||window.conectaCurrentUser?.id!==userId)return;
  const current=()=>generation===messageWatchGeneration&&window.conectaCurrentUser?.id===userId;
  const history={id:conversationId,userId,callback,controller:null};activeHistory=history;
  const controller=window.conectaMessageHistory.createHistory({db:supabase,conversationId,userId,isCurrent:current,
    emit:async rows=>{const decorated=await decorateMessages(rows);if(current())history.callback(decorated);}
  });history.controller=controller;
  const pending=[];
  const changes=window.conectaSync.createQueue(async()=>{const batch=pending.splice(0);await controller.changes(batch);});
  let subscribed=false,initialized=false;
  const channel=supabase.channel("messages-"+conversationId)
    .on("postgres_changes",{event:"*",schema:"public",table:"messages",filter:"conversation_id=eq."+conversationId},payload=>{if(!current())return;pending.push(payload);void changes.request(["messages"]).catch(error=>console.warn("Message update failed",error));})
    .on("postgres_changes",{event:"*",schema:"public",table:"message_hidden_for",filter:"user_id=eq."+userId},()=>{if(current())void controller.hiddenChanged().catch(error=>console.warn(error));})
    .on("postgres_changes",{event:"*",schema:"public",table:"conversation_reads",filter:"conversation_id=eq."+conversationId},()=>{if(current())void loadReadReceipts(conversationId);})
    .subscribe(status=>{if(status==="SUBSCRIBED"&&current()){if(subscribed&&initialized)void controller.recover().catch(error=>console.warn(error));subscribed=true;void loadReadReceipts(conversationId);}});
  activeMessageChannel=channel;
  stopMessageSync=()=>{if(activeMessageChannel!==channel)return;messageWatchGeneration++;activeMessageChannel=null;activeHistory=null;changes.stop();return supabase.removeChannel(channel);};
  try{await controller.start();initialized=true;}catch(error){console.error("Could not load messages",error);}
};

const authCompat = {
  get currentUser() { return window.conectaCurrentUser || null; },
  getUser: () => supabase.auth.getUser(),
  signOut: () => supabase.auth.signOut()
};

window.conectaFirebase = {
  loadPersonalData,
  getMessageHistoryState: id => activeHistory?.id===id ? activeHistory.controller.state() : null,
  loadOlderMessages: id => activeHistory?.id===id ? activeHistory.controller.older() : Promise.resolve(),
  loadLatestMessages: id => activeHistory?.id===id ? activeHistory.controller.latest() : Promise.resolve(),
  ensureConversationMessageLoaded: (id,messageId) => activeHistory?.id===id ? activeHistory.controller.reveal(messageId) : Promise.resolve(false),
  getReplyParent: (id,messageId) => activeHistory?.id===id ? activeHistory.controller.parent(messageId) : null,
  refreshConversationMessages: id => activeHistory?.id===id ? activeHistory.controller.refresh() : Promise.resolve(),
  setTeamStatus: async (user, status, note = "") => {
    if (!["available", "busy", "meeting", "away"].includes(status) || note.length > 80) throw new Error("Status inválido.");
    const { error } = await supabase.from("team_status").upsert({ user_id: user.id, status, note: note.trim(), updated_at: new Date().toISOString() });
    if (error) throw error;
    await loadPersonalData(user,["statuses"]);
  },
  setMessageFavorite: async (user, messageId, favorite) => {
    const query = favorite
      ? supabase.from("message_favorites").upsert({ user_id: user.id, message_id: messageId }, { onConflict: "user_id,message_id", ignoreDuplicates: true })
      : supabase.from("message_favorites").delete().eq("user_id", user.id).eq("message_id", messageId);
    const { error } = await query;
    if (error) throw error;
    await loadPersonalData(user,["favorites","hidden"]);
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
    await loadData(user,["photos"]);
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
    await loadData(user,["announcements"]);
  },
  setGlobalAnnouncementActive: async (user, id, isActive) => {
    const { error } = await supabase.from("global_announcements").update({ is_active: isActive, updated_by: user.id, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
    await loadData(user,["announcements"]);
  },
  deleteGlobalAnnouncement: async (user, id) => {
    const { data: record, error: readError } = await supabase.from("global_announcements").select("image_path").eq("id", id).maybeSingle();
    if (readError) throw readError;
    const { error } = await supabase.from("global_announcements").delete().eq("id", id);
    if (error) throw error;
    if (record?.image_path) await supabase.storage.from("global-announcements").remove([record.image_path]);
    await loadData(user,["announcements"]);
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
  listManagedChannels: async () => {
    const { data, error } = await supabase.from("conversations").select("id,name,member_ids,created_by").eq("managed_channel", true).order("name");
    if (error) throw error;
    return data || [];
  },
  saveManagedChannel: async (user, { id = null, name, memberIds }) => {
    if (!user?.id || window.conectaCurrentUser?.id !== user.id) throw new Error("Sua sessão mudou. Entre novamente.");
    const members = [...new Set([...(memberIds || []), user.id])];
    const values = { name: name.trim(), member_ids: members, updated_at: new Date().toISOString() };
    const query = id ? supabase.from("conversations").update(values).eq("id", id).eq("managed_channel", true)
      : supabase.from("conversations").insert({ ...values, kind: "channel", sector: "Geral", managed_channel: true, created_by: user.id });
    const { data, error } = await query.select("id").single();
    if (error) throw error;
    if (window.conectaCurrentUser?.id === user.id) await loadData(user,["conversations","unread"]).catch(error => console.warn("Channel saved; refresh pending", error));
    return data.id;
  },
  ensureChannel: async (user, name) => { let { data: existing } = await supabase.from("conversations").select("id").eq("kind", "channel").eq("managed_channel", false).eq("name", name).maybeSingle(); if (existing) return existing.id; const { data } = await supabase.from("conversations").insert({ kind: "channel", name, sector: name, created_by: user.id }).select("id").single(); return data.id; },
  startDirectConversation: async (user, otherUserId) => {
    const { data, error } = await supabase.rpc("start_direct_conversation", { p_other_user_id: otherUserId });
    if (error) throw error;
    await loadData(user,["conversations","unread"]);
    return data;
  },
  loadReadReceipts,
  markConversationRead: async (user, conversationId, seenAt) => {
    if (!user?.id || !seenAt) return;
    const { error } = await supabase.rpc("mark_conversation_seen", { p_conversation_id: conversationId, p_seen_at: seenAt });
    if (error) throw error;
    if(window.conectaCurrentUser?.id===user.id)await loadData(user,["unread"]);
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
  const changedAccount=activeAuthUserId !== (user?.id || null);
  if (changedAccount) {
    personalDataGeneration++;dataEpoch++;dataOwner=null;dataQueue?.stop();dataQueue=null;dataState={};
    signedUrlCache.clear();giphyUrlCache.clear();profilePhotoUrlCache.clear();
    stopDataSync();dispatch("conecta-auth-session-reset");
  }
  activeAuthUserId = user?.id || null;
  window.conectaCurrentUser = user || null;
  document.querySelector("#authScreen")?.classList.toggle("visible", !user);
  document.querySelector(".app")?.classList.toggle("authenticated", !!user);
  document.querySelector("#authLoading")?.classList.remove("visible");
  if (user) {
    const profile = await ensureUserProfile(user);
    if(window.conectaCurrentUser?.id!==user.id)return;
    window.conectaCurrentProfile = profile;
    dispatch("conecta-profile-ready", profile);
    if(changedAccount||!dataQueue)startDataSync(user);
    else void loadData(user,["profile","directory","users"]);
    const label = profile.name || user.user_metadata?.name || user.email?.split("@")[0] || "Colaborador";
    document.querySelector("#currentUserName")?.replaceChildren(document.createTextNode(label));
    const initials = label.split(/[ ._-]+/).map(x => x[0]).join("").slice(0, 2).toUpperCase();
    if (document.querySelector("#currentUserInitials")) document.querySelector("#currentUserInitials").textContent = initials;
    if (document.querySelector("#greeting")) document.querySelector("#greeting").textContent = `Olá, ${label} 👋`;
  } else { window.conectaCurrentProfile = null; stopDataSync(); }
});
window.dispatchEvent(new CustomEvent("conecta-firebase-ready"));
