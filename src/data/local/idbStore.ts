/*
 * IndexedDB-backed `LocalStore` (REL-01, MIG-01).
 *
 * Deliberately thin: key/value access and a transaction wrapper, no logic. All
 * the behaviour that matters — ordering, replay, rebase — lives above this seam
 * where it can be tested. Anything clever added here becomes untestable, so
 * don't.
 *
 * Upgrades create missing stores and never drop existing ones, so a version bump
 * cannot destroy queued work. If the on-disk version is NEWER than this build
 * understands (the user opened a newer deploy, then a rollback served them this
 * one), the database is left completely untouched and reported as quarantined —
 * deleting it would throw away unsynced work to fix a cosmetic problem.
 */
import { openDB, type IDBPDatabase, type IDBPTransaction } from 'idb';
import { createMemoryStore } from './memoryStore';
import {
  LocalStoreError,
  STORE_NAMES,
  type LocalStore,
  type StoreName,
  type StoreTx,
} from './types';

export const DB_NAME = 'tmp-local';
/** Bump when a store is added. Never renumber, never drop a store. */
export const DB_VERSION = 1;

const isQuotaError = (err: unknown) =>
  err instanceof DOMException &&
  (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED');

const isVersionError = (err: unknown) =>
  err instanceof DOMException && err.name === 'VersionError';

function wrapTx(tx: IDBPTransaction<unknown, StoreName[], 'readonly' | 'readwrite'>): StoreTx {
  const os = (store: StoreName) => tx.objectStore(store);
  return {
    get: async <T,>(store: StoreName, key: string) => (await os(store).get(key)) as T | undefined,
    getAll: async <T,>(store: StoreName) => (await os(store).getAll()) as T[],
    keys: async (store: StoreName) => (await os(store).getAllKeys()) as string[],
    put: async (store: StoreName, key: string, value: unknown) => {
      await (os(store) as never as { put(v: unknown, k: string): Promise<unknown> }).put(value, key);
    },
    del: async (store: StoreName, key: string) => {
      await (os(store) as never as { delete(k: string): Promise<void> }).delete(key);
    },
    clear: async (store: StoreName) => {
      await (os(store) as never as { clear(): Promise<void> }).clear();
    },
  };
}

function fromDb(db: IDBPDatabase): LocalStore {
  const run = async <T,>(
    stores: readonly StoreName[],
    fn: (tx: StoreTx) => Promise<T>,
    mode: 'readonly' | 'readwrite',
  ): Promise<T> => {
    const tx = db.transaction([...stores], mode) as IDBPTransaction<
      unknown,
      StoreName[],
      'readonly' | 'readwrite'
    >;
    try {
      const result = await fn(wrapTx(tx));
      // Awaiting `done` is what makes write() genuinely atomic: it resolves only
      // once the whole transaction has committed to disk.
      await tx.done;
      return result;
    } catch (err) {
      try {
        tx.abort();
      } catch {
        /* already settled */
      }
      if (err instanceof LocalStoreError) throw err;
      throw new LocalStoreError(
        isQuotaError(err) ? 'quota' : 'aborted',
        `local ${mode} failed`,
        { cause: err },
      );
    }
  };

  return {
    durable: true,
    quarantined: false,
    read: (stores, fn) => run(stores, fn, 'readonly'),
    write: (stores, fn) => run(stores, fn, 'readwrite'),
    close: async () => db.close(),
  };
}

export interface OpenResult {
  store: LocalStore;
  /** Why durable storage is unavailable, when it is. */
  reason?: 'unavailable' | 'version';
}

/**
 * Open the local database, falling back to volatile memory rather than throwing.
 * A caller that gets `durable: false` must not tell the user their work is saved.
 */
export async function openLocalStore(): Promise<OpenResult> {
  if (typeof indexedDB === 'undefined') {
    return { store: createMemoryStore({ durable: false }), reason: 'unavailable' };
  }
  try {
    const db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        for (const name of STORE_NAMES) {
          if (!database.objectStoreNames.contains(name)) database.createObjectStore(name);
        }
      },
      blocking() {
        // Another tab is upgrading. Release the connection so it can proceed;
        // this tab reopens on its next operation.
        db.close();
      },
    });
    return { store: fromDb(db) };
  } catch (err) {
    if (isVersionError(err)) {
      // Newer data on disk. Leave it alone — it may hold unsynced work.
      return {
        store: createMemoryStore({ durable: false, quarantined: true }),
        reason: 'version',
      };
    }
    return { store: createMemoryStore({ durable: false }), reason: 'unavailable' };
  }
}
