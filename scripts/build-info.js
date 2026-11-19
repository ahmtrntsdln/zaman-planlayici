// Paketlemeden önce, AppImage'ın hangi commit'ten üretildiğini electron/build-info.json'a yazar.
const { execSync } = require("child_process");
const fs = require("fs"), path = require("path");
const git = (c) => { try { return execSync("git " + c, { encoding: "utf8" }).trim(); } catch (e) { return ""; } };
const info = {
  commit: git("rev-parse --short HEAD") || "?",
  dirty: git("status --porcelain -- src electron") !== "",
  date: new Date().toISOString()
};
fs.writeFileSync(path.join(__dirname, "..", "electron", "build-info.json"), JSON.stringify(info, null, 2) + "\n");
console.log("build-info:", info);
