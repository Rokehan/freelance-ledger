// Offline support: caches the app files. Bump VERSION on every release.
const VERSION = 'fl-1.5.1';
const FILES = ['./', './index.html', './manifest.webmanifest', './app.css',
  './app.js', './calc.js', './layout.js', './render.js', './pdf.js', './store.js', './drive.js', './email.js', './seed.js', './github.js', './unzip.js', './ocr.js', './receipt-parse.js',
  './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.endsWith('version.json') || url.pathname.endsWith('config.json')) return; // never touch Google traffic
  // network first (so updates arrive), cache as fallback when offline
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))));
});
