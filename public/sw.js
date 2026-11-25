const CACHE_NAME = 'symmetryx-cache-v1';
const FILES_TO_CACHE = [
  '/',
  '/index.html',
  '/Flux.html',
  '/love.html',
  '/logo.png',
  '/favicon.png',
  '/app-icon.ico',
  '/ball.gif',
  '/music.mp3'
];

// Install service worker and cache assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(FILES_TO_CACHE);
    })
  );
});

// Serve cached files when offline
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
