/*
 * Service-worker registration (REL-04).
 *
 * Production only. In development Vite serves modules unbundled and a shell
 * cache would serve stale ones, which looks exactly like a broken HMR session
 * and wastes an afternoon.
 *
 * Registration failing is not an error worth surfacing: it only means this
 * browser cannot reopen offline, which the sync status already communicates.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* no offline reopen on this browser; the app still works online */
    });
  });
}
