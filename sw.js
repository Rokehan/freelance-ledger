// Offline support: caches the app files. Bump VERSION on every release.
const VERSION = 'fl-1.0.0';
const FILES = ['./', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/calc.js', './js/layout.js', './js/render.js', './js/pdf.js', './js/store.js', './js/drive.js', './js/email.js', './js/seed.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // never touch Google traffic
  // network first (so updates arrive), cache as fallback when offline
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))));
});
