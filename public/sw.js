/*
 * App-shell cache (REL-04).
 *
 * Without this, reopening the app offline shows the browser's offline error
 * page: a warm query cache is irrelevant if index.html itself cannot load.
 *
 * Scope is deliberately narrow. This caches the SHELL — the HTML, JS, CSS and
 * fonts Vite emits — and nothing else:
 *
 *   - API responses are NEVER cached here. User records belong in the scoped,
 *     identity-keyed IndexedDB store, not in a cache shared by every account
 *     that has used this browser.
 *   - Auth tokens are NEVER cached here, for the same reason.
 *
 * Anything that is not a same-origin GET for a shell asset goes straight to the
 * network, untouched.
 *
 * A first visit that has never been online cannot work offline: there is nothing
 * to serve. The app says so rather than appearing broken.
 */

// Rewritten at build time with the build id, so a deploy invalidates the whole
// shell instead of serving a mix of old and new chunks.
const CACHE = 'shell-__BUILD_ID__';

const isShellAsset = (url) =>
  url.origin === self.location.origin &&
  (url.pathname === '/' ||
    url.pathname.startsWith('/assets/') ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.ico') ||
    url.pathname.endsWith('.webmanifest'));

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(['/', '/index.html']))
      .catch(() => {}),
  );
  // Take over immediately; the cache name is versioned, so there is no
  // half-old, half-new state to protect.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!isShellAsset(url)) return; // API, auth, anything cross-origin: untouched.

  // Navigations: network first, so a deploy is picked up immediately, falling
  // back to the cached shell when there is no network.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html').then((hit) => hit ?? Response.error())),
    );
    return;
  }

  // Hashed build assets are immutable: serve from cache, fill on first use.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
