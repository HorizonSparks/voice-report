/**
 * Voice Report — Service Worker
 * Network-first strategy: always serves the latest version when online.
 * Falls back to cache when offline so the UI still loads.
 * AI features (Whisper, Claude, TTS) always require internet.
 */

const CACHE_NAME = 'voice-report-v1779390469';

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

// ── Web Push ─────────────────────────────────────────────────────────
// Payload sent by server/services/push.js is { title, body, url?, tag?, icon? }.
// We're tolerant of malformed payloads — show *something* rather than
// silently dropping a push that might be urgent.
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch { payload = { title: 'Horizon Sparks', body: event.data ? event.data.text() : '' }; }

  const title = payload.title || 'Horizon Sparks';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.tag,                  // collapses duplicates
    data: { url: payload.url || '/' }, // read in notificationclick
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Click → focus existing window if the app is already open at that URL,
// otherwise open a fresh one. Avoids opening N tabs for N notifications.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientsList) {
      if (client.url.includes(url) && 'focus' in client) return client.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});

// Fetch — network first, cache fallback
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);

  // API calls — always network, never cache
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Navigation requests: always fetch fresh HTML first.
  // If offline, fall back to cached app shell.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/', clone));
          }
          return response;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // Never cache JS/CSS bundles in the service worker.
  // Always go to network so deploys are visible immediately.
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
    return;
  }

  // Other static files — network first, cache fallback
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Got a fresh response — update the cache for offline use
        if (response.ok && (
          url.pathname.endsWith('.png') ||
          url.pathname.endsWith('.ico') ||
          url.pathname.endsWith('.svg') ||
          url.pathname.endsWith('.webp') ||
          url.pathname.endsWith('.json') ||
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
