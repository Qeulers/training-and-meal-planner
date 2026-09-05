/*
 * Live sync status (REL-05). Gathers connectivity, auth, query-client activity
 * and outbox state, and hands them to the pure reducer in `syncState.ts`.
 */
import { useEffect, useState } from 'react';
import { useIsFetching, useIsMutating, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/data/AuthProvider';
import { useSync } from '@/data/sync/SyncProvider';
import { deriveSyncState, type SyncState } from './syncState';

const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

/** Most recent successful fetch across the cache — a real server exchange. */
function latestSuccess(client: ReturnType<typeof useQueryClient>): number | null {
  let latest = 0;
  for (const q of client.getQueryCache().getAll()) {
    if (q.state.status === 'success' && q.state.dataUpdatedAt > latest) {
      latest = q.state.dataUpdatedAt;
    }
  }
  return latest || null;
}

export function useSyncStatus(): SyncState {
  const client = useQueryClient();
  const { session } = useAuth();
  const sync = useSync();
  const fetching = useIsFetching();
  const mutating = useIsMutating();

  const [online, setOnline] = useState(isOnline);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(() => latestSuccess(client));
  // Re-render on a timer so "synced 5 min ago" does not sit frozen at "just now".
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = client.getQueryCache().subscribe(() => {
      const next = latestSuccess(client);
      setLastSyncAt((prev) => (next != null && (prev == null || next > prev) ? next : prev));
    });
    return unsubscribe;
  }, [client]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  void tick;
  // A parked queue reports as needing auth even though the session object is
  // still present: the server has already refused it (sync contract §4).
  return deriveSyncState({
    online,
    authed: !!session && !sync.needsAuth,
    activeRequests: fetching + mutating,
    pending: sync.pending,
    failed: sync.failed,
    lastSyncAt: Math.max(lastSyncAt ?? 0, sync.lastSyncAt ?? 0) || null,
  });
}
