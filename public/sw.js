// CP Share service worker: caches the whole app on first visit so it opens with no internet.
// Never touches /api or /socket.io (online pairing needs the network). Offline QR mode needs none.
// Bump CACHE whenever files change so phones pick up the new version.
const CACHE = 'cpshare-v3';
const ASSETS = [
  "/",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
  "/assets/icon-maskable-512.png",
  "/assets/logo.svg",
  "/css/app.css",
  "/js/app.js",
  "/js/currency.js",
  "/js/lib/filename.js",
  "/js/lib/format.js",
  "/js/lib/offline-codec.js",
  "/js/lib/qr.js",
  "/js/lib/sha256.js",
  "/js/pages/core.js",
  "/js/pages/misc.js",
  "/js/pages/offline.js",
  "/js/pages/rewards.js",
  "/js/rtc.js",
  "/js/scanner.js",
  "/js/session.js",
  "/js/signaling.js",
  "/js/storage.js",
  "/js/store.js",
  "/js/transfer.js",
  "/js/ui.js",
  "/manifest.webmanifest"
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Cache first (fast, works offline), refreshed in the background for next time.
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api') || u.pathname.startsWith('/socket.io')) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => {
    const net = fetch(e.request).then((r) => { if (r.ok) caches.open(CACHE).then((c) => c.put(e.request, r.clone())); return r; }).catch(() => hit || caches.match('/'));
    return hit || net;
  }));
});
