/*
 * The durable-storage seam (REL-01, MIG-01).
 *
 * Every durable write in the app goes through `LocalStore`. Two things follow
 * from that, and both are deliberate:
 *
 *  1. `write()` is atomic. A local state change and the intent that will
 *     eventually push it to the server commit together or not at all, so the
 *     app can never show "Saved on device" for a change whose intent was lost.
 *  2. The interface is narrow enough to implement in memory, which is how the
 *     outbox, replay ordering and upgrade behaviour get tested at all — jsdom
 *     has no IndexedDB.
 *
 * What the in-memory implementation CANNOT stand in for is real IndexedDB
 * failure: quota exhaustion, private-mode denial, an interrupted upgrade. Those
 * are manual test-script items, and the release notes must say so.
 */

export type StoreName = 'outbox' | 'drafts' | 'queries' | 'meta';

export const STORE_NAMES: readonly StoreName[] = ['outbox', 'drafts', 'queries', 'meta'];

/**
 * Why a durable write failed. The distinction matters at the UI: `quota` and
 * `unavailable` mean "your input is still here but it is not saved", whereas
 * `version` means "this browser has newer data than this code understands".
 */
export type LocalStoreFailure =
  | 'unavailable' // storage blocked or denied (private mode, blocked cookies)
  | 'quota' // out of space
  | 'aborted' // transaction rolled back
  | 'version'; // on-disk schema is newer than this build

export class LocalStoreError extends Error {
  /** The underlying DOMException, where there was one. */
  readonly cause?: unknown;

  constructor(
    readonly kind: LocalStoreFailure,
    message: string,
    options?: { cause?: unknown },
  ) {
    // `cause` is set by hand rather than passed to super(): the build targets
    // ES2020, whose Error constructor takes no options bag.
    super(message);
    this.name = 'LocalStoreError';
    this.cause = options?.cause;
  }
}

/** Handle valid only for the duration of one transaction. */
export interface StoreTx {
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  getAll<T>(store: StoreName): Promise<T[]>;
  keys(store: StoreName): Promise<string[]>;
  put(store: StoreName, key: string, value: unknown): Promise<void>;
  del(store: StoreName, key: string): Promise<void>;
  clear(store: StoreName): Promise<void>;
}

export interface LocalStore {
  /**
   * False when nothing written here will survive a reload — storage was denied,
   * or the on-disk data is quarantined. Callers MUST NOT report durable success
   * while this is false (REL-01).
   */
  readonly durable: boolean;
  /**
   * Set when an existing database could not be opened and was left untouched
   * rather than deleted. Unsynced work is still on the device; this build just
   * cannot read it (MIG-01).
   */
  readonly quarantined: boolean;
  read<T>(stores: readonly StoreName[], fn: (tx: StoreTx) => Promise<T>): Promise<T>;
  /** All-or-nothing. If `fn` throws, nothing it wrote is visible afterwards. */
  write<T>(stores: readonly StoreName[], fn: (tx: StoreTx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
