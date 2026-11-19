"use strict";
const { contextBridge, ipcRenderer } = require("electron");

// Sayfanın erişebildiği tek masaüstü API'si.
contextBridge.exposeInMainWorld("desktop", {
  platform: "linux",
  saveFile: (filename, text, ext) => ipcRenderer.invoke("save-file", filename, text, ext),
  show: () => ipcRenderer.send("show-window"),
  // Tam ekran (F11)
  isFullScreen: () => ipcRenderer.invoke("win:get-fullscreen"),
  setFullScreen: (on) => ipcRenderer.send("win:set-fullscreen", on),
  onFullScreen: (cb) => { ipcRenderer.on("win:fullscreen", (_e, on) => cb(on)); },
  // Güncelleme: depodaki kodla karşılaştır, farklıysa indirip uygula.
  updateInfo: () => ipcRenderer.invoke("update:info"),
  checkUpdate: () => ipcRenderer.invoke("update:check"),
  applyUpdate: () => ipcRenderer.invoke("update:apply"),
  onUpdateStatus: (cb) => { ipcRenderer.on("update:status", (_e, sum) => cb(sum)); }
});
