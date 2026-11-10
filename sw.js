// Service worker: l'app funziona anche offline dopo la prima apertura (modello e WebAssembly in cache).
const VERSION = 'gasa-v3';
const CORE = [
  './', './index.html', './css/app.css', './manifest.webmanifest', './assets/icon.svg', './assets/icon-180.png', './assets/icon-512.png',
  './js/app.js', './js/biomech.js', './js/draw.js', './js/overlay.js', './js/tools.js', './js/export.js', './js/pose.js', './js/reel.js',
  './vendor/mediapipe/vision_bundle.mjs', './vendor/mediapipe/wasm/vision_wasm_internal.js', './vendor/mediapipe/wasm/vision_wasm_internal.wasm',
  './models/pose_landmarker_full.task',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // codice: rete prima (aggiornamenti immediati), cache come riserva; modelli/wasm: cache prima
  const heavy = /\.(task|wasm)$/.test(url.pathname) || url.pathname.includes('/vendor/');
  if (heavy) {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((resp) => {
      const copy = resp.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); return resp;
    })));
  } else {
    e.respondWith(fetch(e.request).then((resp) => {
      const copy = resp.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); return resp;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))));
  }
});
