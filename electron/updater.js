"use strict";
/* Uygulama kodu güncelleyicisi.
 *
 * GitHub'daki depoda (main dalı) bulunan src/ dosyalarının git blob SHA'larını, uygulamanın şu an
 * kullandığı dosyalarla karşılaştırır. Fark varsa yalnızca değişen dosyaları indirir, her birinin
 * SHA'sını doğrular ve ~/.config/zaman-planlayici/app-src klasörüne yazar. Uygulama bundan sonra
 * arayüz kodunu oradan yükler. Electron kabuğu (electron/*.js) bu yolla güncellenemez; o değiştiyse
 * yeni AppImage kurmak gerekir ve kullanıcıya söylenir.
 */
const { net } = require("electron");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const REPO = "ahmtrntsdln/zaman-planlayici";
const BRANCH = "main";
const HEADERS = { "User-Agent": "zaman-planlayici-desktop", Accept: "application/vnd.github+json" };

// Git'in dosya parmak izi: sha1("blob <boyut>\0" + içerik). GitHub ağacındaki SHA ile birebir karşılaştırılabilir.
const blobSha = (buf) => crypto.createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");

// asar arşivinin içinde de çalışsın diye yalnızca readdirSync/statSync/readFileSync kullanılır.
function walk(dir, base = dir, out = {}) {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (fs.statSync(abs).isDirectory()) walk(abs, base, out);
    else out[path.relative(base, abs).split(path.sep).join("/")] = abs;
  }
  return out;
}
function shaMap(dir) {
  const out = {};
  for (const [rel, abs] of Object.entries(walk(dir))) out[rel] = blobSha(fs.readFileSync(abs));
  return out;
}
function copyDir(from, to) {
  for (const [rel, abs] of Object.entries(walk(from))) {
    const dest = path.join(to, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, fs.readFileSync(abs));
  }
}
function safeJoin(root, rel) {
  const p = path.resolve(root, rel);
  if (p !== root && !p.startsWith(root + path.sep)) throw new Error("Geçersiz dosya yolu: " + rel);
  return p;
}

async function getJson(url) {
  let res;
  try { res = await net.fetch(url, { headers: HEADERS }); }
  catch (e) { throw new Error("GitHub'a bağlanılamadı. İnternet bağlantını kontrol et."); }
  if (res.status === 403 || res.status === 429) throw new Error("GitHub şu an çok fazla istek aldı; biraz sonra tekrar dene.");
  if (!res.ok) throw new Error("GitHub yanıtı beklenmedik: " + res.status);
  return res.json();
}
async function getBuffer(url) {
  const res = await net.fetch(url, { headers: { "User-Agent": HEADERS["User-Agent"] } });
  if (!res.ok) throw new Error("Dosya indirilemedi (" + res.status + "): " + url);
  return Buffer.from(await res.arrayBuffer());
}

function createUpdater({ bundledSrc, shellDir, userData }) {
  const OVERRIDE = path.join(userData, "app-src");
  const META_FILE = path.join(userData, "app-src.json");
  let bundleIdCache = null;
  let last = null;      // son kontrolün ayrıntıları
  let busy = null;      // aynı anda tek işlem

  // Paketteki src'nin kimliği: yeni bir AppImage kurulunca değişir ve eski indirilmiş kod devre dışı kalır.
  function bundleId() {
    if (!bundleIdCache) {
      const m = shaMap(bundledSrc);
      bundleIdCache = crypto.createHash("sha1").update(Object.keys(m).sort().map(k => k + ":" + m[k]).join("\n")).digest("hex");
    }
    return bundleIdCache;
  }
  function readMeta() { try { return JSON.parse(fs.readFileSync(META_FILE, "utf8")); } catch (e) { return null; } }
  function buildInfo() { try { return JSON.parse(fs.readFileSync(path.join(shellDir, "build-info.json"), "utf8")); } catch (e) { return {}; } }

  function activeDir() {
    const meta = readMeta();
    if (meta && meta.bundleId === bundleId() && fs.existsSync(path.join(OVERRIDE, "index.html"))) return OVERRIDE;
    if (meta || fs.existsSync(OVERRIDE)) {
      // Daha yeni bir AppImage kurulmuş ya da indirme yarım kalmış: paketteki koda dön.
      try { fs.rmSync(OVERRIDE, { recursive: true, force: true }); fs.rmSync(META_FILE, { force: true }); } catch (e) {}
    }
    return bundledSrc;
  }

  function info() {
    const meta = readMeta(), dir = activeDir(), b = buildInfo();
    const fromUpdate = dir === OVERRIDE;
    return {
      source: fromUpdate ? "update" : "bundled",
      commit: fromUpdate ? meta.commit.slice(0, 7) : (b.commit || "?"),
      date: fromUpdate ? meta.date : (b.date || null),
      message: fromUpdate ? meta.message : null,
      updatedAt: fromUpdate ? meta.updatedAt : null,
      lastCheck: last ? { at: last.at, available: last.available, commit: last.sha.slice(0, 7) } : null
    };
  }

  async function check() {
    if (busy) return busy;
    busy = (async () => {
      const head = await getJson(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`);
      const sha = head.sha;
      const tree = await getJson(`https://api.github.com/repos/${REPO}/git/trees/${sha}?recursive=1`);
      const remote = {}, shell = {};
      for (const e of tree.tree || []) {
        if (e.type !== "blob") continue;
        if (e.path.startsWith("src/")) remote[e.path.slice(4)] = e.sha;
        else if (e.path.startsWith("electron/")) shell[e.path.slice(9)] = e.sha;
      }
      if (!remote["index.html"]) throw new Error("Depoda uygulama kodu (src/index.html) bulunamadı.");
      const local = shaMap(activeDir());
      const changed = Object.keys(remote).filter(rel => local[rel] !== remote[rel]);
      const removed = Object.keys(local).filter(rel => !(rel in remote));
      const shellChanged = Object.entries(shell).some(([rel, s]) => {
        try { return blobSha(fs.readFileSync(path.join(shellDir, rel))) !== s; } catch (e) { return true; }
      });
      last = {
        at: Date.now(), sha, remote, changed, removed, shellChanged,
        available: changed.length + removed.length > 0,
        message: String(head.commit && head.commit.message || "").split("\n")[0],
        date: head.commit && head.commit.committer && head.commit.committer.date
      };
      return summary();
    })();
    try { return await busy; } finally { busy = null; }
  }

  function summary() {
    if (!last) return null;
    return {
      available: last.available,
      commit: last.sha.slice(0, 7),
      message: last.message,
      date: last.date,
      files: last.changed.length + last.removed.length,
      changed: last.changed.slice(0, 50),
      removed: last.removed.slice(0, 50),
      shellChanged: last.shellChanged
    };
  }

  async function apply() {
    if (!last || Date.now() - last.at > 10 * 60 * 1000) await check();
    if (!last.available) return { ok: true, commit: last.sha.slice(0, 7), nothing: true };
    if (busy) await busy.catch(() => {});
    const { sha, remote, changed, removed } = last;
    const staging = OVERRIDE + ".new", old = OVERRIDE + ".old";
    fs.rmSync(staging, { recursive: true, force: true });
    try {
      copyDir(activeDir(), staging);
      for (const rel of changed) {
        const url = `https://raw.githubusercontent.com/${REPO}/${sha}/src/${rel.split("/").map(encodeURIComponent).join("/")}`;
        const buf = await getBuffer(url);
        if (blobSha(buf) !== remote[rel]) throw new Error("İndirilen dosya doğrulanamadı: " + rel);
        const dest = safeJoin(staging, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buf);
      }
      for (const rel of removed) fs.rmSync(safeJoin(staging, rel), { force: true });
      // Son kontrol: klasör artık depodaki src/ ile birebir aynı olmalı.
      const after = shaMap(staging);
      const mismatch = Object.keys(remote).filter(rel => after[rel] !== remote[rel]).concat(Object.keys(after).filter(rel => !(rel in remote)));
      if (mismatch.length) throw new Error("Güncelleme doğrulanamadı: " + mismatch.slice(0, 3).join(", "));
    } catch (e) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw e;
    }
    fs.rmSync(old, { recursive: true, force: true });
    if (fs.existsSync(OVERRIDE)) fs.renameSync(OVERRIDE, old);
    fs.renameSync(staging, OVERRIDE);
    fs.rmSync(old, { recursive: true, force: true });
    fs.writeFileSync(META_FILE, JSON.stringify({ commit: sha, date: last.date, message: last.message, bundleId: bundleId(), updatedAt: new Date().toISOString() }, null, 2));
    last = Object.assign({}, last, { available: false, changed: [], removed: [] });
    return { ok: true, commit: sha.slice(0, 7), shellChanged: last.shellChanged };
  }

  function reset() {
    fs.rmSync(OVERRIDE, { recursive: true, force: true });
    fs.rmSync(META_FILE, { force: true });
    last = null;
  }

  return { activeDir, info, check, apply, reset, summary };
}

module.exports = { createUpdater, blobSha };
