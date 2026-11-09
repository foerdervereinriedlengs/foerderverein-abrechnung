// Service Worker für 100% Offline-Fähigkeit
const CACHE_NAME = 'fv-abrechnung-v1.3.3';
const LOCAL_ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './js/core.js',
  './js/pdf_engine.js',
  './js/app.js'
];
const OPTIONAL_ASSETS_TO_CACHE = [
  'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',
  'https://cdn.tailwindcss.com'
];

async function cacheOptionalAsset(cache, asset) {
  try {
    await cache.add(asset);
  } catch (err) {
    try {
      const response = await fetch(new Request(asset, { mode: 'no-cors' }));
      if (response.type !== 'opaque' && !response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      await cache.put(asset, response);
    } catch (fallbackError) {
      console.warn(`Optionales Offline-Asset konnte nicht vorgeladen werden: ${asset}`, fallbackError);
    }
  }
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(LOCAL_ASSETS_TO_CACHE);
      await Promise.all(OPTIONAL_ASSETS_TO_CACHE.map(asset => cacheOptionalAsset(cache, asset)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((k) => {
          if (k.startsWith('fv-abrechnung-') && k !== CACHE_NAME) {
            return caches.delete(k);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cachedResponse = await cache.match(e.request);
      if (cachedResponse) {
        return cachedResponse;
      }
      try {
        const networkResponse = await fetch(e.request);
        if (networkResponse.ok && new URL(e.request.url).origin === self.location.origin) {
          await cache.put(e.request, networkResponse.clone());
        }
        return networkResponse;
      } catch (err) {
        if (e.request.mode === 'navigate') {
          const fallback = await cache.match('./index.html');
          if (fallback) return fallback;
        }
        throw err;
      }
    })()
  );
});
