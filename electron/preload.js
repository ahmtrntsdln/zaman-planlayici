"use strict";
const { contextBridge, ipcRenderer } = require("electron");

// Sayfanın erişebildiği tek masaüstü API'si.
contextBridge.exposeInMainWorld("desktop", {
  platform: "linux",
  saveFile: (filename, text, ext) => ipcRenderer.invoke("save-file", filename, text, ext),
  show: () => ipcRenderer.send("show-window")
});
