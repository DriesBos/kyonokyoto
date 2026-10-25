const CACHE_NAME = 'kyo-no-kyoto-v5';
// Runtime entries live in their own capped caches so hashed assets and visited pages from old
// deploys cannot pile up forever. The oldest entries are evicted first.
const PAGE_CACHE_NAME = 'kyo-no-kyoto-pages-v1';
const ASSET_CACHE_NAME = 'kyo-no-kyoto-assets-v1';
const CACHE_LIMITS = { [PAGE_CACHE_NAME]: 24, [ASSET_CACHE_NAME]: 120 };
const CURRENT_CACHES = new Set([CACHE_NAME, PAGE_CACHE_NAME, ASSET_CACHE_NAME]);
const putCapped = async (cacheName, request, response) => {
  const cache = await caches.open(cacheName);
  await cache.put(request, response);
  const keys = await cache.keys();
  await Promise.all(
    keys
      .slice(0, Math.max(0, keys.length - CACHE_LIMITS[cacheName]))
      .map((key) => cache.delete(key)),
  );
};

const APP_SHELL = [
  '/site.webmanifest',
  '/favicon.svg',
  '/favicon-32x32.png',
  '/favicon-16x16.png',
  '/favicon.ico',
  '/apple-touch-icon.png',
  '/android-chrome-192x192.png',
  '/android-chrome-512x512.png',
  '/android-chrome-192x192-maskable.png',
  '/android-chrome-512x512-maskable.png',
  '/fonts/GT-Walsheim-Regular.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(APP_SHELL);
      self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((cacheName) => !CURRENT_CACHES.has(cacheName))
          .map((cacheName) => caches.delete(cacheName)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname === '/.netlify/images') {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (
            response.ok &&
            !response.redirected &&
            url.pathname !== '/' &&
            url.pathname !== '/map'
          ) {
            event.waitUntil(putCapped(PAGE_CACHE_NAME, request, response.clone()));
          }
          return response;
        } catch {
          return (
            (await caches.match(request)) ?? (await caches.match('/kyoto/en/')) ?? Response.error()
          );
        }
      })(),
    );
    return;
  }

  if (['style', 'script', 'font', 'image'].includes(request.destination)) {
    event.respondWith(
      (async () => {
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
          return cachedResponse;
        }

        try {
          const response = await fetch(request);
          if (response.ok) {
            event.waitUntil(putCapped(ASSET_CACHE_NAME, request, response.clone()));
          }
          return response;
        } catch {
          return cachedResponse ?? Response.error();
        }
      })(),
    );
  }
});
