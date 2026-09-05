/*
 * Query-cache persistence to the local database (REL-01, REL-04).
 *
 * Without this, a reopen shows an empty app until the network answers — which
 * offline it never does. With it, the last known reference and user data are on
 * screen immediately.
 *
 * Written by hand rather than pulled from `@tanstack/query-async-storage-persister`,
 * which is not installed: the Persister interface is three methods and the
 * storage seam already exists.
 *
 * Two rules here are not negotiable:
 *
 *   - The cache is keyed by user id. Signing in as a different account cannot
 *     restore the previous one's records (REL-06).
 *   - The `buster` carries the app's data-shape version. A build that changes
 *     query shapes discards the cache rather than rehydrating rows it will
 *     misread — and discarding a cache is safe precisely because the outbox
 *     lives in a separate store that is never busted.
 */
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';
import type { LocalStore } from '../local/types';

/** Bump when the shape of cached query data changes. */
export const CACHE_BUSTER = 'v1';

/** Reference data may be stale but is immutable; a week is a safe ceiling. */
export const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const keyFor = (userId: string) => `queries:${userId}`;

export function createLocalPersister(store: LocalStore, userId: string): Persister {
  const key = keyFor(userId);
  return {
    persistClient: async (client: PersistedClient) => {
      // Never let a cache-write failure break the app; the data is a
      // convenience, whereas the outbox is not.
      try {
        await store.write(['queries'], (tx) => tx.put('queries', key, client));
      } catch {
        /* storage full or denied — the app still works, just not offline */
      }
    },
    restoreClient: async () => {
      try {
        return await store.read(['queries'], (tx) => tx.get<PersistedClient>('queries', key));
      } catch {
        return undefined;
      }
    },
    removeClient: async () => {
      try {
        await store.write(['queries'], (tx) => tx.del('queries', key));
      } catch {
        /* nothing to do */
      }
    },
  };
}
