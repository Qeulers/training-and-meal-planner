/*
 * Owns durable local storage and the replay loop (REL-01, REL-02, REL-04).
 *
 * One store instance for the app. Mutations enqueue through `enqueueOp`, which
 * commits the intent durably before anything is reported as saved, then nudges
 * a drain. Drains also fire on reconnect and when the tab becomes visible,
 * because `navigator.onLine` going true means "a link exists", not "the server
 * is reachable" — the drain is what actually finds out.
 *
 * Deliberately NOT here: multi-tab leader election. Concurrent drains from two
 * tabs are safe (operation ids are idempotent server-side) but wasteful. See
 * docs/sync-contract.md §8.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { openLocalStore } from '../local/idbStore';
import {
  countIntents,
  drain,
  enqueue,
  listIntents,
  type DrainResult,
  type Intent,
  type IntentInput,
  type EnqueueOptions,
} from '../local/outbox';
import type { LocalStore } from '../local/types';
import { makeSender } from './operations';
import { useAuth } from '../AuthProvider';

export interface SyncContextValue {
  /** False while the store is still opening. */
  ready: boolean;
  /** False when writes will not survive a reload — never claim "saved" then. */
  durable: boolean;
  /** Existing local data could not be read and was left in place, not deleted. */
  quarantined: boolean;
  pending: number;
  failed: number;
  /** Pending intents for the signed-in owner, for rebasing reads over writes. */
  intents: Intent[];
  lastSyncAt: number | null;
  /** True while the queue is parked on an expired session. */
  needsAuth: boolean;
  enqueueOp: (input: Omit<IntentInput, 'owner'>, options?: EnqueueOptions) => Promise<Intent>;
  drainNow: () => Promise<DrainResult | null>;
}

const SyncContext = createContext<SyncContextValue | undefined>(undefined);

export function SyncProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const owner = session?.user.id ?? null;

  const [store, setStore] = useState<LocalStore | null>(null);
  // Opening IndexedDB is async, and a user can tap Save before it finishes.
  // Holding the promise lets `enqueueOp` wait rather than reject — the write
  // still lands durably, it just lands a few milliseconds later.
  const opening = useRef<Promise<LocalStore> | null>(null);
  const [durable, setDurable] = useState(false);
  const [quarantined, setQuarantined] = useState(false);
  const [intents, setIntents] = useState<Intent[]>([]);
  const [counts, setCounts] = useState({ pending: 0, failed: 0 });
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const draining = useRef(false);
  const send = useMemo(() => makeSender(), []);

  useEffect(() => {
    let cancelled = false;
    opening.current = openLocalStore().then(({ store: opened }) => {
      if (!cancelled) {
        setStore(opened);
        setDurable(opened.durable);
        setQuarantined(opened.quarantined);
      }
      return opened;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Re-read queue state for the current owner. Another account's work stays invisible. */
  const refresh = useCallback(async () => {
    if (!store || !owner) {
      setIntents([]);
      setCounts({ pending: 0, failed: 0 });
      return;
    }
    const [mine, next] = await Promise.all([
      listIntents(store, owner).catch(() => [] as Intent[]),
      countIntents(store, owner).catch(() => ({ pending: 0, failed: 0 })),
    ]);
    setIntents(mine);
    setCounts(next);
  }, [store, owner]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const drainNow = useCallback(async (): Promise<DrainResult | null> => {
    if (!store || !owner || draining.current) return null;
    draining.current = true;
    try {
      const result = await drain(store, owner, send);
      setNeedsAuth(result.status === 'parked');
      if (result.sent > 0) setLastSyncAt(Date.now());
      await refresh();
      return result;
    } finally {
      draining.current = false;
    }
  }, [store, owner, send, refresh]);

  // Drain when the store opens, on reconnect, and when the tab comes back.
  useEffect(() => {
    if (!store || !owner) return;
    void drainNow();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void drainNow();
    };
    window.addEventListener('online', drainNow);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', drainNow);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [store, owner, drainNow]);

  const enqueueOp = useCallback(
    async (input: Omit<IntentInput, 'owner'>, options?: EnqueueOptions) => {
      const ready = store ?? (await opening.current);
      if (!ready) throw new Error('Local storage is unavailable.');
      if (!owner) throw new Error('Not authenticated');
      // Throws on storage failure, and callers must let it: reporting success
      // for a change whose intent was never written is the exact failure REL-01
      // exists to prevent.
      const intent = await enqueue(ready, { ...input, owner }, options);
      await refresh();
      void drainNow();
      return intent;
    },
    [store, owner, refresh, drainNow],
  );

  const value = useMemo<SyncContextValue>(
    () => ({
      ready: store != null,
      durable,
      quarantined,
      pending: counts.pending,
      failed: counts.failed,
      intents,
      lastSyncAt,
      needsAuth,
      enqueueOp,
      drainNow,
    }),
    [store, durable, quarantined, counts, intents, lastSyncAt, needsAuth, enqueueOp, drainNow],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

/**
 * Fallback value so components render outside a provider (the DEV preview
 * harness, component tests). It is not durable and enqueueing throws, so
 * nothing can quietly believe it saved.
 */
const DETACHED: SyncContextValue = {
  ready: false,
  durable: false,
  quarantined: false,
  pending: 0,
  failed: 0,
  intents: [],
  lastSyncAt: null,
  needsAuth: false,
  enqueueOp: () => Promise.reject(new Error('No SyncProvider')),
  drainNow: () => Promise.resolve(null),
};

// eslint-disable-next-line react-refresh/only-export-components
export function useSync(): SyncContextValue {
  return useContext(SyncContext) ?? DETACHED;
}
