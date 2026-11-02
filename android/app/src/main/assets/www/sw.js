/* КРАЙ / Edge Push — service worker офлайн-PWA.
 * Версия кэша синхронизирована с package.json / android versionName через npm run version:bump.
 * В нативном Android-приложении этот SW НЕ регистрируется: там ассеты уже внутри APK,
 * а страница открывается с ?native=1 (см. index.html). */
'use strict';

const CACHE_PREFIX = 'edge-push-v';
const CACHE_NAME = CACHE_PREFIX + '1.0.0';

/* Всё, что нужно для игры и исследовательского отчёта офлайн.
 * Пути относительны к scope, поэтому PWA работает и из корня, и из подпапки. */
const ASSET_PATHS = [
  './',
  './index.html',
  './manifest.json',
  './sw.js',
  './favicon.svg',
  './apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './store/screenshots/01-board.png',
  './store/screenshots/02-difficulty.png',
  './store/screenshots/03-legend.png',
  './store/privacy-policy.html',
  './.well-known/assetlinks.json',
  './ai/index.html',
  './ai/difficulty.json',
  './ai/mastery.json',
  './ai/results.json',
  './ai/replay.json',
  './ai/training.json',
  './README.md'
];
const ASSET_URLS = ASSET_PATHS.map(p => new URL(p, self.registration.scope).href);
const FALLBACK_URL = new URL('./index.html', self.registration.scope).href;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSET_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
        .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  /* HTML: сеть первая (обновления подхватываются), офлайн — кэш. */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match(FALLBACK_URL)))
    );
    return;
  }

  /* Статика: кэш первый, при промахе — сеть с дозаписью. */
  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(res => {
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(req, copy));
      }
      return res;
    }))
  );
});
