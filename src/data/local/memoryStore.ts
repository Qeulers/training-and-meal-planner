/*
 * In-memory `LocalStore`. Two jobs:
 *
 *  - the test double for everything durable (jsdom has no IndexedDB);
 *  - the runtime fallback when IndexedDB is denied, so the app keeps working
 *    for the current session while telling the truth via `durable: false`.
 *
 * Atomicity is by snapshot-and-restore: cheap at this data volume, and it gives
 * read-your-writes inside a transaction for free.
 */
import {
  LocalStoreError,
  STORE_NAMES,
  type LocalStore,
  type LocalStoreFailure,
  type StoreName,
  type StoreTx,
} from './types';

export interface MemoryStoreOptions {
  /** Report as durable. False models a browser that refused persistent storage. */
  durable?: boolean;
  quarantined?: boolean;
  /**
   * Fault injection. Return a failure kind to make the operation throw — used
   * to prove the app never reports durable success on a failed write.
   */
  fail?: (op: 'get' | 'getAll' | 'keys' | 'put' | 'del' | 'clear', store: StoreName, key?: string)
    => LocalStoreFailure | null | undefined;
}

const clone = <T>(v: T): T => (v === undefined ? v : (structuredClone(v) as T));

export function createMemoryStore(options: MemoryStoreOptions = {}): LocalStore {
  const { durable = true, quarantined = false, fail } = options;
  const data = new Map<StoreName, Map<string, unknown>>(
    STORE_NAMES.map((n) => [n, new Map<string, unknown>()]),
  );
  let closed = false;

  const guard = (
    op: 'get' | 'getAll' | 'keys' | 'put' | 'del' | 'clear',
    store: StoreName,
    key?: string,
  ) => {
    const kind = fail?.(op, store, key);
    if (kind) throw new LocalStoreError(kind, `injected ${kind} failure on ${op} ${store}`);
  };

  const bucket = (store: StoreName) => {
    const b = data.get(store);
    if (!b) throw new LocalStoreError('unavailable', `unknown store ${store}`);
    return b;
  };

  const makeTx = (allowed: readonly StoreName[]): StoreTx => {
    const check = (store: StoreName) => {
      if (!allowed.includes(store)) {
        throw new LocalStoreError('aborted', `store ${store} is not in this transaction`);
      }
    };
    return {
      async get<T>(store: StoreName, key: string) {
        check(store);
        guard('get', store, key);
        return clone(bucket(store).get(key)) as T | undefined;
      },
      async getAll<T>(store: StoreName) {
        check(store);
        guard('getAll', store);
        return [...bucket(store).values()].map((v) => clone(v)) as T[];
      },
      async keys(store: StoreName) {
        check(store);
        guard('keys', store);
        return [...bucket(store).keys()];
      },
      async put(store: StoreName, key: string, value: unknown) {
        check(store);
        guard('put', store, key);
        bucket(store).set(key, clone(value));
      },
      async del(store: StoreName, key: string) {
        check(store);
        guard('del', store, key);
        bucket(store).delete(key);
      },
      async clear(store: StoreName) {
        check(store);
        guard('clear', store);
        bucket(store).clear();
      },
    };
  };

  const run = async <T>(
    stores: readonly StoreName[],
    fn: (tx: StoreTx) => Promise<T>,
    atomic: boolean,
  ): Promise<T> => {
    if (closed) throw new LocalStoreError('unavailable', 'store is closed');
    // Snapshot only the stores this transaction can touch.
    const snapshot = atomic
      ? stores.map((n) => [n, new Map(bucket(n))] as const)
      : null;
    try {
      return await fn(makeTx(stores));
    } catch (err) {
      if (snapshot) for (const [n, m] of snapshot) data.set(n, m);
      throw err;
    }
  };

  return {
    durable,
    quarantined,
    read: (stores, fn) => run(stores, fn, false),
    write: (stores, fn) => run(stores, fn, true),
    async close() {
      closed = true;
    },
  };
}
