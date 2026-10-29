/**
 * Rahabar Alumni — Progressive Web App Service Worker (v1)
 * 
 * Architecture & Invariants:
 * - App Shell caching for static resources (HTML, CSS, JS, branding icons).
 * - Offline navigation fallback to cached index.html shell.
 * - Dynamic scope and base-path awareness (handles GitHub Pages /rahabar-alumni/ seamlessly).
 * - STRICT PRIVACY GUARDS: Zero caching of auth tokens, sensitive user profiles,
 *   protected API endpoints (/api/*), Supabase tokens, or OAuth callbacks.
 * - Zero writeback simulation: Offline mutations are rejected, never falsely claiming success.
 */

const CACHE_NAME = 'rahabar-alumni-shell-v2-canonical';

// Static assets to pre-cache on install
const PRECACHE_ASSETS = [
  './',
  'manifest.webmanifest',
  'ruet-logo.svg',
  'pwa-192x192.png',
  'pwa-512x512.png',
  'pwa-maskable-512x512.png',
  'apple-touch-icon.png',
  'favicon.svg',
];

// Install Event: Pre-cache static shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      const scopeUrl = self.registration.scope;
      const urlsToCache = PRECACHE_ASSETS.map((asset) => new URL(asset, scopeUrl).href);
      return cache.addAll(urlsToCache).catch((err) => {
        console.warn('[PWA SW] Pre-cache partial notice:', err.message);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate Event: Clean up legacy caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('rahabar-alumni-shell-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// Helper: Determine if a request is sensitive and MUST NOT be cached
function isProtectedOrSensitive(request) {
  // Only GET requests can ever be cached
  if (request.method !== 'GET') {
    return true;
  }

  const url = new URL(request.url);

  // Exclude private backend APIs, auth handlers, and external database endpoints
  if (
    url.pathname.includes('/api/') ||
    url.pathname.includes('/auth/') ||
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('google.com') ||
    url.searchParams.has('code') ||
    url.searchParams.has('access_token') ||
    url.searchParams.has('refresh_token')
  ) {
    return true;
  }

  // Exclude requests bearing Authorization headers
  if (request.headers.get('Authorization')) {
    return true;
  }

  return false;
}

// Fetch Event: Network-first for navigation, Stale-while-revalidate for static assets
self.addEventListener('fetch', (event) => {
  const request = event.request;
  // Vite source modules must never be served from a development shell cache.
  const requestUrl = new URL(request.url);
  if (requestUrl.hostname === 'localhost' || requestUrl.hostname === '127.0.0.1') return;

  // 1. Strict Privacy & Security Check: Pass through directly without caching
  if (isProtectedOrSensitive(request)) {
    return;
  }

  // 2. Navigation Requests (HTML Pages / App Shell)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Offline fallback: serve cached root / index.html shell
          const scopeUrl = self.registration.scope;
          return caches.match(new URL('./', scopeUrl).href).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            return caches.match(request);
          });
        })
    );
    return;
  }

  // 3. Static Assets (CSS, JS, Images, Fonts, Manifest)
  const url = new URL(request.url);
  const isStaticAsset =
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'image' ||
    request.destination === 'font' ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.webmanifest');

  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        const fetchPromise = fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const responseClone = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, responseClone);
              });
            }
            return networkResponse;
          })
          .catch(() => {
            // Silently swallow fetch errors when offline for static assets
          });

        return cachedResponse || fetchPromise;
      })
    );
  }
});
