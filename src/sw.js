/* Zaman Planlayıcı service worker: uygulama dosyalarını önbelleğe alır, internetsiz de açılır.
   Dosyaları değiştirip yayınladığında VERSION'ı artır ki telefonlar yeni sürümü alsın. */
"use strict";
const VERSION = "v13";
const CACHE = "zaman-planlayici-" + VERSION;
const ASSETS = [
  "./",
  "./index.html",
  "./fonts.css",
  "./manifest.webmanifest",
  "./sync.js",
  "./firebase-config.js",
  "./vendor/firebase.js",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./icons/favicon-32.png",
  "./icons/ttech-logo.png",
  "./fonts/ibm-plex-sans-latin-400-normal.woff2",
  "./fonts/ibm-plex-sans-latin-ext-400-normal.woff2",
  "./fonts/ibm-plex-sans-latin-500-normal.woff2",
  "./fonts/ibm-plex-sans-latin-ext-500-normal.woff2",
  "./fonts/ibm-plex-sans-latin-600-normal.woff2",
  "./fonts/ibm-plex-sans-latin-ext-600-normal.woff2",
  "./fonts/ibm-plex-mono-latin-500-normal.woff2",
  "./fonts/ibm-plex-mono-latin-ext-500-normal.woff2"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("zaman-planlayici-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  // Sayfanın kendisi: önce ağ (güncel sürüm), internet yoksa önbellek.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put("./index.html", copy)); return res; })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }
  // Fontlar, simgeler vb.: önce önbellek.
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});

// Bildirime dokununca uygulamayı öne getir.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if ("focus" in c) return c.focus();
      return self.clients.openWindow("./");
    })
  );
});
