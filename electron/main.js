"use strict";
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, dialog, nativeTheme, session, shell } = require("electron");
const path = require("path");
const fs = require("fs");

const APP_NAME = "Zaman Planlayıcı";
const SRC = path.join(__dirname, "..", "src");
const BUILD = SRC; // icon.png ve tray.png src/ içinde paketlenir

// Veriler ~/.config/zaman-planlayici altında dursun (Türkçe karaktersiz klasör adı).
app.setPath("userData", path.join(app.getPath("appData"), "zaman-planlayici"));
app.setName(APP_NAME);

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

/* ---------- pencere ---------- */
function showWindow() {
  if (!win) return createWindow(true);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow(show) {
  win = new BrowserWindow({
    width: 480,
    height: 860,
    minWidth: 360,
    minHeight: 520,
    show: false,
    title: APP_NAME,
    icon: path.join(BUILD, "icon.png"),
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#11141b" : "#f3f4f7",
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

  win.loadFile(path.join(SRC, "index.html"));
  if (show) win.once("ready-to-show", () => win.show());

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
  const rebuild = () => tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Göster", click: showWindow },
    { type: "separator" },
    {
      label: "Oturum açılınca başlat", type: "checkbox", checked: isAutostart(),
      click: (item) => { try { setAutostart(item.checked); } catch (err) { dialog.showErrorBox(APP_NAME, String(err)); } rebuild(); }
    },
    { type: "separator" },
    { label: "Çıkış", click: () => { quitting = true; app.quit(); } }
  ]));
  rebuild();
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
        { role: "toggleDevTools", label: "Geliştirici araçları" }
      ]
    }
  ]));
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
});
