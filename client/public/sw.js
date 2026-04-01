/**
 * Voice Report — Service Worker
 * Network-first strategy: always serves the latest version when online.
 * Falls back to cache when offline so the UI still loads.
 * AI features (Whisper, Claude, TTS) always require internet.
 */

const CACHE_NAME = 'voice-report-v3';

// App shell — pre-cached on install for offline fallback
const APP_SHELL = [
  '/',
  '/manifest.json',
  '/favicon.ico',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

// Install — pre-cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL);
    })
  );
  self.skipWaiting();
});

// Activate — clean old caches, claim all clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => {
      return self.clients.matchAll({ type: 'window' });
    }).then((clients) => {
      clients.forEach((client) => {
        client.postMessage({ type: 'SW_UPDATED' });
      });
    })
  );
  self.clients.claim();
});

// Listen for skip-waiting message from the app
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Fetch — network first, cache fallback
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API calls — always network, never cache
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Everything else — try network first, fall back to cache
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Got a fresh response — update the cache for offline use
        if (response.ok && (
          url.pathname.endsWith('.js') ||
          url.pathname.endsWith('.css') ||
          url.pathname.endsWith('.png') ||
          url.pathname.endsWith('.ico') ||
          url.pathname === '/'
        )) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Offline — serve from cache
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          // Last resort for navigation — serve cached index.html
          if (event.request.mode === 'navigate') {
            return caches.match('/');
          }
        });
      })
  );
});
