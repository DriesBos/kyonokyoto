const CACHE_NAME = "kyo-no-kyoto-v1";
const APP_SHELL = [
  "/",
  "/site.webmanifest",
  "/favicon.svg",
  "/favicon-32x32.png",
  "/favicon-16x16.png",
  "/favicon.ico",
  "/apple-touch-icon.png",
  "/android-chrome-192x192.png",
  "/android-chrome-512x512.png",
  "/android-chrome-192x192-maskable.png",
  "/android-chrome-512x512-maskable.png",
  "/fonts/GT-Walsheim-Regular.woff2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(APP_SHELL);
      self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, response.clone());
          return response;
        } catch {
          return (await caches.match(request)) ?? (await caches.match("/")) ?? Response.error();
        }
      })(),
    );
    return;
  }

  if (["style", "script", "font", "image"].includes(request.destination)) {
    event.respondWith(
      (async () => {
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
          return cachedResponse;
        }

        try {
          const response = await fetch(request);
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, response.clone());
          return response;
        } catch {
          return cachedResponse ?? Response.error();
        }
      })(),
    );
  }
});
