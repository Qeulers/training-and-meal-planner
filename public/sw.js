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

// Injected at build time: every hashed asset the shell needs. Precaching these
// means ONE online visit is enough to work offline. Relying on the fetch
// handler to fill the cache lazily needs two, because the first load's
// sub-resources are requested before the worker has claimed the page.
// eslint-disable-next-line no-undef -- substituted at build time
const PRECACHE = __PRECACHE__;

// Sub-resources worth caching. Navigations are handled separately and are NOT
// filtered by this — see the fetch handler.
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
      .then((cache) => cache.addAll(['/', '/index.html', ...PRECACHE]))
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
  if (url.origin !== self.location.origin) return; // never touch cross-origin

  /*
   * Navigations are handled FIRST and for every in-app path.
   *
   * They used to be filtered through `isShellAsset` along with everything else,
   * which meant only "/" qualified: a reload of /today, /food or any other
   * route fell through to the network and failed offline with the browser's
   * own error page. That is every route the app actually uses.
   *
   * Network first, so a deploy is picked up immediately, falling back to the
   * cached shell when the server cannot be reached. The SPA router takes the
   * path from the URL, so one cached index.html serves every route.
   */
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE);
          const hit =
            (await cache.match('/index.html', { ignoreVary: true })) ??
            (await cache.match('/', { ignoreVary: true }));
          return hit ?? Response.error();
        }),
    );
    return;
  }

  // Sub-resources: only the shell's own files are cached.
  if (!isShellAsset(url)) return;

  /*
   * Hashed build assets are immutable: serve from cache, fill on first use.
   *
   * `ignoreVary` and the pathname fallback are both load-bearing. Cache.match
   * keys on request identity, not just URL: Vite marks its module script and
   * stylesheet `crossorigin`, so the browser requests them in CORS mode, and a
   * strict match against entries stored by `cache.addAll` (which builds its
   * requests from plain URL strings) missed every time. The result was a shell
   * that served index.html from cache and then failed to load its own
   * JavaScript — a blank page, offline, with no error the user could act on.
   */
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request, { ignoreVary: true });
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok) void cache.put(request, response.clone());
        return response;
      } catch (err) {
        // Unreachable and not matched by request identity: try the URL alone.
        const byPath = await cache.match(new URL(request.url).pathname, { ignoreVary: true });
        if (byPath) return byPath;
        throw err;
      }
    })(),
  );
});
