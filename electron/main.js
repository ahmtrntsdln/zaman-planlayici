"use strict";
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, dialog, nativeTheme, session, shell, screen } = require("electron");
const path = require("path");
const fs = require("fs");

const APP_NAME = "Zaman Planlayıcı";
const SRC = path.join(__dirname, "..", "src");
const BUILD = SRC; // icon.png ve tray.png src/ içinde paketlenir

// Veriler ~/.config/zaman-planlayici altında dursun (Türkçe karaktersiz klasör adı).
// ZP_USER_DATA yalnızca testlerde gerçek verilere dokunmamak için kullanılır.
app.setPath("userData", process.env.ZP_USER_DATA || path.join(app.getPath("appData"), "zaman-planlayici"));
app.setName(APP_NAME);

const { createUpdater } = require("./updater");
const updater = createUpdater({ bundledSrc: SRC, shellDir: __dirname, userData: app.getPath("userData") });
const UPDATE_EVERY = 6 * 60 * 60 * 1000;
let notifiedCommit = null;
let pendingUpdate = null;   // { commit, message, files, shellChanged } — tepsi menüsünde gösterilir

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let win = null;
let tray = null;
let quitting = false;
let hideNoticeShown = false;
const startHidden = process.argv.includes("--hidden");

/* ---------- otomatik başlatma (~/.config/autostart) ---------- */
const autostartFile = path.join(app.getPath("home"), ".config", "autostart", "zaman-planlayici.desktop");
function launchCommand() {
  // AppImage içinden çalışırken APPIMAGE değişkeni AppImage dosyasının yolunu verir.
  if (process.env.APPIMAGE) return `"${process.env.APPIMAGE}"`;
  return app.isPackaged ? `"${process.execPath}"` : `"${process.execPath}" "${path.join(__dirname, "..")}"`;
}
const isAutostart = () => fs.existsSync(autostartFile);
function setAutostart(on) {
  if (on) {
    fs.mkdirSync(path.dirname(autostartFile), { recursive: true });
    fs.writeFileSync(autostartFile, [
      "[Desktop Entry]", "Type=Application", `Name=${APP_NAME}`,
      `Exec=${launchCommand()} --hidden`, "X-GNOME-Autostart-enabled=true", "Terminal=false", ""
    ].join("\n"));
  } else if (isAutostart()) {
    fs.unlinkSync(autostartFile);
  }
}

/* ---------- pencere durumu (boyut, konum, tam ekran) ---------- */
const STATE_FILE = path.join(app.getPath("userData"), "window.json");
function loadWinState() {
  try {
    const st = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    // Kaydedilen konum artık bağlı bir ekranda değilse yalnızca boyutu kullan.
    if (Number.isFinite(st.x) && Number.isFinite(st.y)) {
      const visible = screen.getAllDisplays().some(d => { const a = d.workArea; return st.x >= a.x - 50 && st.y >= a.y - 50 && st.x < a.x + a.width - 100 && st.y < a.y + a.height - 100; });
      if (!visible) { delete st.x; delete st.y; }
    }
    return st;
  } catch (e) { return {}; }
}
let saveTimer = null;
function saveWinState() {
  if (!win) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!win) return;
    const full = win.isFullScreen(), max = win.isMaximized();
    let prev = {}; try { prev = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch (e) {}
    const b = (full || max) ? prev : win.getBounds();   // tam ekran/büyütülmüşken normal boyutu koru
    try { fs.writeFileSync(STATE_FILE, JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: max, fullscreen: full })); } catch (e) {}
  }, 400);
}
function setFullScreen(on) {
  if (!win) return;
  if (!win.isVisible()) showWindow();
  win.setFullScreen(typeof on === "boolean" ? on : !win.isFullScreen());
}

/* ---------- pencere ---------- */
function showWindow() {
  if (!win) return createWindow(true);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow(show) {
  const ws = loadWinState();
  win = new BrowserWindow({
    width: ws.width || 480,
    height: ws.height || 860,
    x: ws.x, y: ws.y,
    minWidth: 360,
    minHeight: 520,
    show: false,
    title: APP_NAME,
    icon: path.join(BUILD, "icon.png"),
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#090b10" : "#eef0f5",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Pencere gizliyken de hatırlatma zamanlayıcısı yavaşlamasın.
      backgroundThrottling: false,
      spellcheck: false
    }
  });

  win.loadFile(path.join(updater.activeDir(), "index.html"));
  win.once("ready-to-show", () => {
    if (ws.maximized) win.maximize();
    if (ws.fullscreen) win.setFullScreen(true);
    if (show) win.show();
  });
  for (const ev of ["resize", "move", "maximize", "unmaximize"]) win.on(ev, saveWinState);
  for (const ev of ["enter-full-screen", "leave-full-screen"]) win.on(ev, () => {
    saveWinState();
    if (win) win.webContents.send("win:fullscreen", win.isFullScreen());
  });

  // Kapat düğmesi uygulamayı kapatmaz, tepsiye gizler; hatırlatmalar sürer.
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (!hideNoticeShown && Notification.isSupported()) {
      hideNoticeShown = true;
      new Notification({
        title: APP_NAME,
        body: "Arka planda çalışmaya devam ediyor. Çıkmak için tepsi simgesini veya Ctrl+Q'yu kullan.",
        icon: path.join(BUILD, "icon.png")
      }).show();
    }
  });
  win.on("closed", () => { win = null; });

  // Uygulama içinde başka sayfaya gidilmesin; dış bağlantılar tarayıcıda açılsın.
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("file://")) { e.preventDefault(); shell.openExternal(url); }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
}

function createTray() {
  tray = new Tray(path.join(BUILD, "tray.png"));
  tray.setToolTip(APP_NAME);
  rebuildTray = () => tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Göster", click: showWindow },
    { type: "separator" },
    pendingUpdate
      ? { label: `Güncelleme var (${pendingUpdate.commit}) · Güncelle…`, click: () => interactiveCheck() }
      : { label: "Güncellemeleri kontrol et", click: () => interactiveCheck() },
    { type: "separator" },
    {
      label: "Oturum açılınca başlat", type: "checkbox", checked: isAutostart(),
      click: (item) => { try { setAutostart(item.checked); } catch (err) { dialog.showErrorBox(APP_NAME, String(err)); } rebuildTray(); }
    },
    { type: "separator" },
    { label: "Çıkış", click: () => { quitting = true; app.quit(); } }
  ]));
  rebuildTray();
  tray.on("click", () => (win && win.isVisible() && win.isFocused() ? win.hide() : showWindow()));
}

function createMenu() {
  // Menü çubuğu gizli; kısayollar çalışsın diye yine de tanımlı (Alt ile görünür).
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: "Dosya",
      submenu: [
        { label: "Pencereyi gizle", accelerator: "Ctrl+W", click: () => win && win.hide() },
        { label: "Çıkış", accelerator: "Ctrl+Q", click: () => { quitting = true; app.quit(); } }
      ]
    },
    {
      label: "Görünüm",
      submenu: [
        { role: "reload", label: "Yenile" },
        { role: "zoomIn", label: "Yakınlaştır" },
        { role: "zoomOut", label: "Uzaklaştır" },
        { role: "resetZoom", label: "Gerçek boyut" },
        { type: "separator" },
        { label: "Tam ekran", accelerator: "F11", click: () => setFullScreen() },
        { type: "separator" },
        { role: "toggleDevTools", label: "Geliştirici araçları" }
      ]
    },
    {
      label: "Yardım",
      submenu: [
        { label: "Güncellemeleri kontrol et", click: () => interactiveCheck() },
        { label: "Paketteki sürüme dön", click: () => resetToBundled() },
        { type: "separator" },
        { label: "Sürüm bilgisi", click: () => showVersion() }
      ]
    }
  ]));
}

/* ---------- güncelleme ---------- */
let rebuildTray = () => {};
function setPending(sum) {
  pendingUpdate = sum && sum.available ? sum : null;
  tray && tray.setToolTip(pendingUpdate ? `${APP_NAME} · güncelleme var` : APP_NAME);
  rebuildTray();
  if (win) win.webContents.send("update:status", sum);
}
async function backgroundCheck() {
  try {
    const sum = await updater.check();
    setPending(sum);
    if (sum.available && sum.commit !== notifiedCommit && Notification.isSupported()) {
      notifiedCommit = sum.commit;
      const n = new Notification({ title: APP_NAME, body: `Yeni sürüm var: ${sum.message || sum.commit}. Güncellemek için tıkla.`, icon: path.join(BUILD, "icon.png") });
      n.on("click", () => interactiveCheck());
      n.show();
    }
  } catch (e) { /* arka planda sessizce geç; elle kontrol hatayı gösterir */ }
}
async function applyAndReload() {
  const res = await updater.apply();
  setPending(null);
  if (win) setTimeout(() => win && win.loadFile(path.join(updater.activeDir(), "index.html")), 300);
  return res;
}
async function interactiveCheck() {
  showWindow();
  let sum;
  try { sum = await updater.check(); }
  catch (e) { dialog.showMessageBox(win, { type: "error", title: APP_NAME, message: "Güncellemeler kontrol edilemedi", detail: e.message }); return; }
  setPending(sum);
  if (!sum.available) {
    const i = updater.info();
    dialog.showMessageBox(win, { type: "info", title: APP_NAME, message: "Uygulama güncel", detail: `Kullandığın kod depodaki son sürümle aynı (${sum.commit}).` + (sum.shellChanged ? "\n\nNot: Masaüstü kabuğunda değişiklik var; bunun için yeni AppImage kurman gerekir." : "") });
    return;
  }
  const { response } = await dialog.showMessageBox(win, {
    type: "question", title: APP_NAME, buttons: ["Güncelle", "Sonra"], defaultId: 0, cancelId: 1,
    message: "Yeni sürüm var",
    detail: `${sum.message || ""}\n\nDepodaki sürüm: ${sum.commit} · ${sum.files} dosya farklı.\nVerilerin etkilenmez; uygulama yeniden yüklenir.` +
      (sum.shellChanged ? "\n\nBu sürümde masaüstü kabuğunda da değişiklik var; onun için ayrıca yeni AppImage kurman gerekebilir." : "")
  });
  if (response !== 0) return;
  try { await applyAndReload(); }
  catch (e) { dialog.showMessageBox(win, { type: "error", title: APP_NAME, message: "Güncelleme yapılamadı", detail: e.message + "\n\nUygulama önceki sürümle çalışmaya devam ediyor." }); }
}
async function resetToBundled() {
  if (updater.info().source !== "update") { dialog.showMessageBox(win, { type: "info", title: APP_NAME, message: "Zaten paketteki sürümü kullanıyorsun." }); return; }
  const { response } = await dialog.showMessageBox(win, { type: "question", title: APP_NAME, buttons: ["Geri dön", "Vazgeç"], defaultId: 1, cancelId: 1, message: "İndirilen güncellemeyi kaldırıp paketteki sürüme dönülsün mü?", detail: "Verilerin etkilenmez." });
  if (response !== 0) return;
  updater.reset();
  if (win) win.loadFile(path.join(updater.activeDir(), "index.html"));
}
function showVersion() {
  const i = updater.info();
  dialog.showMessageBox(win, { type: "info", title: APP_NAME, message: `${APP_NAME} · ${i.commit}`,
    detail: (i.source === "update" ? `Depodan güncellendi: ${i.message || ""}\nGüncelleme zamanı: ${i.updatedAt}` : "Paketteki sürüm") + `\nElectron ${process.versions.electron}` });
}

/* ---------- köprü (renderer → ana süreç) ---------- */
const FILE_TYPES = {
  ics: { title: "Takvim dosyasını kaydet", filter: { name: "iCalendar", extensions: ["ics"] } },
  json: { title: "Yedeği kaydet", filter: { name: "Yedek (JSON)", extensions: ["json"] } }
};
ipcMain.handle("save-file", async (_e, filename, text, ext) => {
  const type = FILE_TYPES[ext];
  if (!type) throw new Error("Desteklenmeyen dosya türü");
  const safeName = String(filename || "dosya." + ext).replace(/[\\/]/g, "_");
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: type.title,
    defaultPath: path.join(app.getPath("documents"), safeName),
    filters: [type.filter]
  });
  if (canceled || !filePath) return { saved: false };
  await fs.promises.writeFile(filePath, String(text), "utf8");
  return { saved: true, path: filePath };
});
ipcMain.on("show-window", showWindow);
ipcMain.handle("win:get-fullscreen", () => !!(win && win.isFullScreen()));
ipcMain.on("win:set-fullscreen", (_e, on) => setFullScreen(on));
ipcMain.handle("update:info", () => Object.assign(updater.info(), { pending: updater.summary() }));
ipcMain.handle("update:check", async () => { const sum = await updater.check(); setPending(sum); return sum; });
ipcMain.handle("update:apply", () => applyAndReload());

/* ---------- yaşam döngüsü ---------- */
app.on("second-instance", showWindow);
app.on("before-quit", () => { quitting = true; });
app.on("window-all-closed", () => { /* tepside yaşamaya devam et */ });

app.whenReady().then(() => {
  // Sadece bildirim iznini ver; kamera, mikrofon vb. her şeyi reddet.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === "notifications"));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === "notifications");

  createMenu();
  createWindow(!startHidden);
  createTray();
  // Açılıştan kısa süre sonra ve sonra 6 saatte bir sessizce kontrol et.
  setTimeout(backgroundCheck, 15 * 1000);
  setInterval(backgroundCheck, UPDATE_EVERY);
});
