const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();
const INITIAL_ADMIN_UID = "BXSiWSO0qvXErauBVwitC8Pe0mL2";

exports.createUser = onCall(async request => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Login obrigatório.");
  const adminProfile = await db.doc(`users/${request.auth.uid}`).get();
  if (!adminProfile.exists || adminProfile.data().role !== "admin") throw new HttpsError("permission-denied", "Somente administradores podem cadastrar usuários.");
  const { name, email, password, role, sector } = request.data || {};
  if (!name || !email || !password || !["admin", "fiscal", "contabil", "pessoal"].includes(role) || password.length < 6) throw new HttpsError("invalid-argument", "Dados de cadastro inválidos.");
  let created;
  try { created = await getAuth().createUser({ email, password, displayName: name }); }
  catch (error) { if (error.code === "auth/email-already-exists") throw new HttpsError("already-exists", "E-mail já cadastrado."); throw new HttpsError("internal", "Não foi possível criar a conta."); }
  await db.doc(`users/${created.uid}`).set({ name, email, role, sector: sector || role, active: true, createdBy: request.auth.uid, createdAt: FieldValue.serverTimestamp() });
  return { uid: created.uid };
});

exports.bootstrapAdmin = onCall(async request => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Login obrigatório.");
  if (request.auth.uid === INITIAL_ADMIN_UID) {
    const user = await getAuth().getUser(request.auth.uid);
    await db.doc(`users/${request.auth.uid}`).set({ name: user.displayName || user.email.split("@")[0], email: user.email, role: "admin", sector: "Administração", active: true, createdAt: FieldValue.serverTimestamp() }, { merge: true });
    return { role: "admin" };
  }
  const existing = await db.collection("users").limit(1).get();
  if (!existing.empty) return { role: "colaborador" };
  const user = await getAuth().getUser(request.auth.uid);
  await db.doc(`users/${request.auth.uid}`).set({ name: user.displayName || user.email.split("@")[0], email: user.email, role: "admin", sector: "Administração", active: true, createdAt: FieldValue.serverTimestamp() });
  return { role: "admin" };
});
