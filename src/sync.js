/* Zaman Planlayıcı · bulut senkronu (Firebase Auth + Firestore)
 *
 * Veri modeli: users/{uid}/{tür}/{id}; türler: events, categories, tasks (görevler), notes (notlar).
 * events ve categories "çekirdek" türlerdir: ilk eşitleme onların bulut yanıtını bekler. tasks ve notes
 * sonradan eklendi; bulut kuralları onlara henüz izin vermiyorsa yalnızca o türler cihazda kalır
 * (çekirdek senkron etkilenmez) ve kurallar güncellenince bir sonraki açılışta buluta gönderilir.
 * Her belge bir öğedir + updatedAt (ms) + deleted (silinenler için iz kaydı).
 * Çakışma kuralı öğe bazında "son değişiklik kazanır": iki cihaz farklı öğeleri
 * değiştirirse ikisi de korunur; aynı öğeyi değiştirirlerse en son yapılan geçerli olur.
 *
 * Sayfa (index.html) window.ZP üzerinden durum ve yardımcıları verir;
 * bu modül window.ZPSync'i yayınlar.
 */
import config from "./firebase-config.js";

const ZP = window.ZP;
const KINDS = ["events", "categories", "tasks", "notes"];
const CORE = ["events", "categories"];
const BASE_KEY = uid => "zaman-planlayici-sync-base-" + uid;

const listeners = new Set();
let manualOffline = false;
const api = {
  configured: !!config,
  user: null,
  status: config ? "signed-out" : "off",   // off | signed-out | connecting | synced | pending | offline | error
  error: "",
  warn: "",                                 // çekirdek dışı türler eşitlenemiyorsa açıklama
  onChange(fn){ listeners.add(fn); return () => listeners.delete(fn); },
  push: () => {},
  signIn: async () => { throw new Error("Senkron yapılandırılmadı."); },
  signUp: async () => { throw new Error("Senkron yapılandırılmadı."); },
  resetPassword: async () => { throw new Error("Senkron yapılandırılmadı."); },
  signOut: async () => {}
};
window.ZPSync = api;

function emit(){ for (const fn of listeners) { try { fn(api); } catch (e) {} } }
function setStatus(s, err){ api.status = s; api.error = err || ""; emit(); }

if (config) start().catch(e => { console.error("Senkron başlatılamadı", e); setStatus("error", "Senkron başlatılamadı."); });
else emit();

async function start(){
  const fb = await import("./vendor/firebase.js");
  const app = fb.initializeApp(config);
  const auth = fb.initializeAuth(app, { persistence: [fb.indexedDBLocalPersistence, fb.browserLocalPersistence] });
  const db = fb.initializeFirestore(app, {
    ignoreUndefinedProperties: true,
    localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() })
  });
  // "demo-" ile başlayan proje kimliği yalnızca bilgisayardaki test sunucusunda (emulator) kullanılır.
  if (String(config.projectId || "").startsWith("demo-")) {
    fb.connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    fb.connectFirestoreEmulator(db, "127.0.0.1", 8080);
  }

  let session = null;

  api.signIn = (email, pw) => fb.signInWithEmailAndPassword(auth, email, pw).catch(e => { throw friendly(e); });
  api.signUp = (email, pw) => fb.createUserWithEmailAndPassword(auth, email, pw).catch(e => { throw friendly(e); });
  api.resetPassword = (email) => fb.sendPasswordResetEmail(auth, email).catch(e => { throw friendly(e); });
  api.signOut = () => fb.signOut(auth);
  api.push = () => { if (session) session.push(); };
  // Bulut bağlantısını elle kesip açar (ör. test ya da ileride "senkronu duraklat"). Kapalıyken değişiklikler kuyrukta bekler.
  api.setNetwork = async (on) => {
    manualOffline = !on;
    await (on ? fb.enableNetwork(db) : fb.disableNetwork(db));
    if (session) session.refresh();
  };

  fb.onAuthStateChanged(auth, user => {
    if (session) { session.stop(); session = null; }
    api.user = user ? { uid: user.uid, email: user.email } : null;
    api.warn = "";
    if (!user) { setStatus("signed-out"); return; }
    session = openSession(fb, db, user.uid);
  });

  addEventListener("online", () => session && session.refresh());
  addEventListener("offline", () => session && session.refresh());
}

/* ---------- bir kullanıcının senkron oturumu ---------- */
function openSession(fb, db, uid){
  // base: buluttaki (bildiğimiz) hâl; id → öğenin JSON'u. Yerel durumla farkı bulmak için kullanılır.
  const base = Object.fromEntries(KINDS.map(k => [k, new Map()]));
  const hadKind = {};                       // bu tür için daha önce bulutla eşitlenmiş bir hâl var mı
  let hadBase = false;
  try {
    const saved = JSON.parse(localStorage.getItem(BASE_KEY(uid)) || "null");
    if (saved) {
      for (const k of KINDS) if (saved[k]) { hadKind[k] = true; for (const [id, j] of Object.entries(saved[k])) base[k].set(id, j); }
      hadBase = true;
    }
  } catch (e) {}
  const saveBase = () => {
    try {
      localStorage.setItem(BASE_KEY(uid), JSON.stringify(Object.fromEntries(KINDS.map(k => [k, Object.fromEntries(base[k])]))));
    } catch (e) {}
  };

  // İlk kez senkronlanan cihazda, buluttan gerçek (önbellek olmayan) yanıt gelmeden hiçbir şey yazma:
  // yoksa boş önbellek "bulut boş" sanılır ve yerel varsayılanlar buluttakilerin üstüne yazılır.
  const loaded = Object.fromEntries(KINDS.map(k => [k, false]));
  let ready = hadBase;
  const pendingByKind = Object.fromEntries(KINDS.map(k => [k, false]));
  const fromCacheByKind = Object.fromEntries(KINDS.map(k => [k, true]));
  const blocked = {};                       // bulut kurallarının izin vermediği (çekirdek dışı) türler
  const unsubs = [];
  // Bir tür yazılabilir mi: çekirdek türler ilk eşitlemeden sonra; diğerleri ayrıca kendi bulut yanıtı gelince.
  const kindReady = k => ready && !blocked[k] && (CORE.includes(k) || hadKind[k] || loaded[k]);
  function blockKind(kind){
    if (blocked[kind]) return;
    blocked[kind] = true;
    // Buluta ulaşmamış öğeler "gönderildi" sayılmasın: kurallar düzelince hepsi yeniden gönderilir.
    base[kind].clear(); hadKind[kind] = true; saveBase();
    api.warn = "Görevler ve notlar şimdilik yalnızca bu cihazda: Firebase güvenlik kurallarının güncellenmesi gerekiyor.";
    refresh(); emit();
  }

  setStatus("connecting");

  for (const kind of KINDS) {
    const col = fb.collection(db, "users", uid, kind);
    unsubs.push(fb.onSnapshot(col, { includeMetadataChanges: true }, snap => {
      pendingByKind[kind] = snap.metadata.hasPendingWrites;
      fromCacheByKind[kind] = snap.metadata.fromCache;
      const changes = snap.docChanges().filter(c => c.type !== "removed");
      if (changes.length) applyRemote(kind, changes.map(c => ({ id: c.doc.id, data: c.doc.data() })));
      const first = !snap.metadata.fromCache && !loaded[kind];
      if (!snap.metadata.fromCache) loaded[kind] = true;
      if (!ready && CORE.every(k => loaded[k])) { ready = true; firstSync(); }
      else if (ready && (changes.length || first)) push();
      refresh();
    }, err => {
      console.error("Firestore dinleme hatası", err);
      if (!CORE.includes(kind)) { blockKind(kind); return; }
      setStatus("error", err && err.code === "permission-denied" ? "Buluttaki veriye erişim izni yok (güvenlik kuralları)." : "Bulutla bağlantı kurulamadı.");
    }));
  }

  function itemJson(item){
    const { u, ...rest } = item;            // u: öğenin son değişim zamanı, karşılaştırmaya girmez
    return JSON.stringify(rest, Object.keys(rest).sort());
  }

  function applyRemote(kind, docs){
    const state = ZP.state();
    const list = state[kind] || (state[kind] = []);
    let changed = false;
    for (const { id, data } of docs) {
      const remoteAt = +data.updatedAt || 0;
      const idx = list.findIndex(x => x.id === id);
      const local = idx >= 0 ? list[idx] : null;
      const { updatedAt, deleted, ...item } = data;
      item.id = id;
      if (deleted) {
        base[kind].delete(id);
        if (local && (+local.u || 0) <= remoteAt) { list.splice(idx, 1); changed = true; }
        continue;
      }
      item.u = remoteAt;
      base[kind].set(id, itemJson(item));
      if (!local) { list.push(item); changed = true; }
      else if ((+local.u || 0) < remoteAt && itemJson(local) !== itemJson(item)) {
        // Yerindeki nesneyi güncelle ki açık bir düzenleme formu aynı nesneyi tutmaya devam etsin.
        for (const k of Object.keys(local)) if (!(k in item)) delete local[k];
        Object.assign(local, item);
        changed = true;
      } else if ((+local.u || 0) < remoteAt) {
        local.u = remoteAt;
      }
    }
    saveBase();
    if (changed) ZP.remoteChanged();
  }

  function firstSync(){
    const state = ZP.state();
    // Senkron açılınca örnek etkinlikler kaldırılır: buluta gitmezler, cihazlar arasında tutarsızlık yaratmasınlar.
    if (state.events.some(e => e.sample)) {
      state.events = state.events.filter(e => !e.sample);
      ZP.remoteChanged();
    }
    push();
  }

  function push(){
    if (!ready) return;
    const state = ZP.state();
    const now = Date.now();
    const writes = [];
    for (const kind of KINDS) {
      if (!kindReady(kind)) continue;
      const seen = new Set();
      for (const item of state[kind] || []) {
        if (!item || !item.id || item.sample) continue;   // örnek etkinlikler buluta gitmez
        seen.add(item.id);
        const j = itemJson(item);
        if (base[kind].get(item.id) === j) continue;
        // Yerel öğe buluttakinden farklı: yerel değişiklik say ve yaz.
        item.u = Math.max(now, (+item.u || 0) + 1);
        const { u, ...data } = item;
        writes.push([kind, item.id, Object.assign(JSON.parse(JSON.stringify(data)), { updatedAt: item.u, deleted: false })]);
        base[kind].set(item.id, j);
      }
      for (const id of [...base[kind].keys()]) {
        if (seen.has(id)) continue;
        writes.push([kind, id, { updatedAt: now, deleted: true }]);
        base[kind].delete(id);
      }
    }
    if (!writes.length) return;
    ZP.saveLocal();
    saveBase();
    // Türlere ayrı paketler: kuralların henüz izin vermediği bir tür, diğerlerinin yazılmasını engellemesin.
    for (const kind of KINDS) {
      const kw = writes.filter(w => w[0] === kind);
      for (let i = 0; i < kw.length; i += 400) {
        const batch = fb.writeBatch(db);
        for (const [, id, data] of kw.slice(i, i + 400)) batch.set(fb.doc(db, "users", uid, kind, id), data);
        // Çevrimdışıyken yazma kuyruğa alınır; bağlantı gelince Firestore kendisi gönderir.
        batch.commit().catch(e => {
          console.error("Bulut yazma hatası", kind, e);
          if (!CORE.includes(kind) && e && e.code === "permission-denied") { blockKind(kind); return; }
          setStatus("error", e && e.code === "permission-denied" ? "Buluta yazma izni yok (güvenlik kuralları)." : "Buluta yazılamadı.");
        });
      }
    }
    setStatus("pending");
  }

  function refresh(){
    if (api.status === "error") return;
    if (!ready) return setStatus(manualOffline || navigator.onLine === false ? "offline" : "connecting");
    const off = manualOffline || navigator.onLine === false;
    if (KINDS.some(k => !blocked[k] && pendingByKind[k])) return setStatus(off ? "offline" : "pending");
    if (off || fromCacheByKind.events || fromCacheByKind.categories) return setStatus("offline");
    setStatus("synced");
  }

  return {
    push,
    refresh,
    stop(){ unsubs.forEach(f => { try { f(); } catch (e) {} }); }
  };
}

function friendly(e){
  const code = (e && e.code) || "";
  const map = {
    "auth/invalid-email": "E-posta adresi geçersiz.",
    "auth/missing-password": "Şifre gir.",
    "auth/weak-password": "Şifre en az 6 karakter olmalı.",
    "auth/email-already-in-use": "Bu e-postayla zaten bir hesap var. “Giriş yap”ı dene.",
    "auth/invalid-credential": "E-posta ya da şifre yanlış.",
    "auth/wrong-password": "E-posta ya da şifre yanlış.",
    "auth/user-not-found": "Bu e-postayla bir hesap yok.",
    "auth/too-many-requests": "Çok fazla deneme yapıldı. Biraz bekleyip tekrar dene.",
    "auth/network-request-failed": "İnternet bağlantısı yok gibi görünüyor.",
    "auth/operation-not-allowed": "Firebase'de e-posta/şifre girişi açık değil."
  };
  const err = new Error(map[code] || ("İşlem başarısız" + (code ? " (" + code + ")" : "") + "."));
  err.code = code;
  return err;
}
