/*
 * The outbox — durable write intents and their replay (REL-01, REL-02).
 * Rules and rationale: docs/sync-contract.md.
 *
 * Two invariants carry the whole design:
 *
 *   1. An intent is committed to storage in the SAME transaction as the local
 *      state change it describes. There is no window in which the user has been
 *      told their work is saved but no intent exists to push it.
 *   2. `operation_id` is minted before any network attempt and never changes, so
 *      a crash after the server committed but before the acknowledgement arrived
 *      replays the same id and the server recognises it.
 *
 * Ordering is by `seq`, a per-device monotonic counter — never by wall clock.
 * A client clock cannot be trusted and a server timestamp records reconnection
 * order rather than the order the user made the edits.
 */
import { LocalStoreError, type LocalStore, type StoreName, type StoreTx } from './types';
import { backoffMs, MAX_ATTEMPTS, type BackoffOptions } from './backoff';

export type IntentState = 'pending' | 'failed';

export interface Intent {
  operation_id: string;
  /** Auth user id at creation. Stamped once, never rewritten. */
  owner: string;
  op: string;
  entity: string;
  entity_id: string;
  payload: unknown;
  /** Per-device monotonic drain order. */
  seq: number;
  /** operation_ids that must land first. */
  deps: string[];
  /** Diagnostics only — never used to resolve a conflict. */
  client_ts: number;
  attempts: number;
  state: IntentState;
  last_error?: string;
  /** Epoch ms before which this intent must not be retried. */
  next_attempt_at?: number;
}

export type IntentInput = Omit<
  Intent,
  'operation_id' | 'seq' | 'attempts' | 'state' | 'client_ts' | 'deps' | 'next_attempt_at'
> & { deps?: string[]; operation_id?: string; client_ts?: number };

const SEQ_KEY = 'outbox:seq';

/** How `send` classified an attempt. Keeps Supabase specifics out of here. */
export type SendOutcome =
  /** Applied, or already applied (a receipt was found). Both remove the intent. */
  | { kind: 'ok' }
  | { kind: 'duplicate' }
  /** Transient: network, timeout, 5xx. */
  | { kind: 'retry'; error?: string }
  /** Session expired. Parks the WHOLE queue — this is not a failure. */
  | { kind: 'auth'; error?: string }
  /** 4xx that retrying cannot fix. Dead-letters this one intent. */
  | { kind: 'permanent'; error: string };

export type SendFn = (intent: Intent) => Promise<SendOutcome>;

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `op-${Math.random().toString(36).slice(2)}-${Date.now()}`;

async function nextSeq(tx: StoreTx): Promise<number> {
  const current = (await tx.get<number>('meta', SEQ_KEY)) ?? 0;
  const next = current + 1;
  await tx.put('meta', SEQ_KEY, next);
  return next;
}

export interface EnqueueOptions {
  /** Extra stores the transaction may touch, for `alsoWrite`. */
  extraStores?: readonly StoreName[];
  /**
   * The local state change this intent describes. Runs inside the same
   * transaction: if it throws, no intent is recorded either, and the caller
   * must not report success.
   */
  alsoWrite?: (tx: StoreTx) => Promise<void>;
  now?: () => number;
}

/**
 * Record an intent, atomically with its local state change.
 *
 * Throws `LocalStoreError` if the write failed. Callers MUST let that propagate
 * to the UI rather than treating the in-memory optimistic update as success —
 * that is the silent-divergence failure REL-01 exists to prevent.
 */
export async function enqueue(
  store: LocalStore,
  input: IntentInput,
  options: EnqueueOptions = {},
): Promise<Intent> {
  const { extraStores = [], alsoWrite, now = Date.now } = options;
  const stores: StoreName[] = ['outbox', 'meta', ...extraStores];

  return store.write(stores, async (tx) => {
    const intent: Intent = {
      operation_id: input.operation_id ?? newId(),
      owner: input.owner,
      op: input.op,
      entity: input.entity,
      entity_id: input.entity_id,
      payload: input.payload,
      seq: await nextSeq(tx),
      deps: input.deps ?? [],
      client_ts: input.client_ts ?? now(),
      attempts: 0,
      state: 'pending',
    };
    await tx.put('outbox', intent.operation_id, intent);
    await alsoWrite?.(tx);
    return intent;
  });
}

/** Every intent for one owner, in drain order. Other owners' work is invisible. */
export async function listIntents(store: LocalStore, owner: string): Promise<Intent[]> {
  const all = await store.read(['outbox'], (tx) => tx.getAll<Intent>('outbox'));
  return all.filter((i) => i.owner === owner).sort((a, b) => a.seq - b.seq);
}

export interface OutboxCounts {
  pending: number;
  failed: number;
}

export async function countIntents(store: LocalStore, owner: string): Promise<OutboxCounts> {
  const mine = await listIntents(store, owner);
  return {
    pending: mine.filter((i) => i.state === 'pending').length,
    failed: mine.filter((i) => i.state === 'failed').length,
  };
}

/** Retry one dead-lettered intent: clears the failure and re-queues it in place. */
export async function retryIntent(store: LocalStore, operationId: string): Promise<void> {
  await store.write(['outbox'], async (tx) => {
    const intent = await tx.get<Intent>('outbox', operationId);
    if (!intent) return;
    await tx.put('outbox', operationId, {
      ...intent,
      state: 'pending',
      attempts: 0,
      next_attempt_at: undefined,
      last_error: undefined,
    });
  });
}

/**
 * Drop an intent permanently. Only ever call this behind an explicit
 * confirmation naming what is lost (REL-06) — never as cleanup.
 */
export async function discardIntent(store: LocalStore, operationId: string): Promise<void> {
  await store.write(['outbox'], (tx) => tx.del('outbox', operationId));
}

export interface DrainOptions extends BackoffOptions {
  now?: () => number;
  maxAttempts?: number;
}

export interface DrainResult {
  sent: number;
  /** Sent operations the server had already applied. Counted as success. */
  duplicates: number;
  /** Still queued: waiting on backoff, on a dependency, or on the next drain. */
  remaining: number;
  failed: number;
  /**
   * 'parked' means the session expired mid-drain. The queue is intact and
   * resumes on reauthentication — it has NOT failed, and must not be described
   * to the user as though it had.
   */
  status: 'idle' | 'drained' | 'parked' | 'storage-error';
  storageError?: LocalStoreError;
}

/**
 * Replay pending intents for one owner, in `seq` order.
 *
 * Stops immediately on an auth failure so a queue of writes is not burned
 * against an expired session. Dependencies hold an intent back rather than
 * reordering around it.
 */
export async function drain(
  store: LocalStore,
  owner: string,
  send: SendFn,
  options: DrainOptions = {},
): Promise<DrainResult> {
  const { now = Date.now, maxAttempts = MAX_ATTEMPTS, ...backoff } = options;
  const result: DrainResult = {
    sent: 0,
    duplicates: 0,
    remaining: 0,
    failed: 0,
    status: 'idle',
  };

  let queue: Intent[];
  try {
    queue = await listIntents(store, owner);
  } catch (err) {
    result.status = 'storage-error';
    if (err instanceof LocalStoreError) result.storageError = err;
    return result;
  }
  if (queue.length === 0) return { ...result, status: 'drained' };

  // Anything still in the outbox blocks whatever depends on it.
  const unresolved = new Set(queue.map((i) => i.operation_id));
  let parked = false;

  for (const intent of queue) {
    if (parked || intent.state === 'failed') continue;
    if (intent.next_attempt_at != null && intent.next_attempt_at > now()) continue;
    if (intent.deps.some((d) => unresolved.has(d))) continue;

    let outcome: SendOutcome;
    try {
      outcome = await send(intent);
    } catch (err) {
      outcome = { kind: 'retry', error: err instanceof Error ? err.message : String(err) };
    }

    try {
      switch (outcome.kind) {
        case 'ok':
        case 'duplicate': {
          await store.write(['outbox'], (tx) => tx.del('outbox', intent.operation_id));
          unresolved.delete(intent.operation_id);
          if (outcome.kind === 'duplicate') result.duplicates += 1;
          result.sent += 1;
          break;
        }
        case 'auth': {
          // Park the whole queue. Every later intent would fail identically.
          parked = true;
          break;
        }
        case 'retry': {
          const attempts = intent.attempts + 1;
          const exhausted = attempts >= maxAttempts;
          await store.write(['outbox'], (tx) =>
            tx.put('outbox', intent.operation_id, {
              ...intent,
              attempts,
              state: exhausted ? 'failed' : 'pending',
              last_error: exhausted
                ? `Gave up after ${attempts} attempts: ${outcome.error ?? 'network error'}`
                : outcome.error,
              next_attempt_at: exhausted ? undefined : now() + backoffMs(attempts, backoff),
            } satisfies Intent),
          );
          break;
        }
        case 'permanent': {
          await store.write(['outbox'], (tx) =>
            tx.put('outbox', intent.operation_id, {
              ...intent,
              attempts: intent.attempts + 1,
              state: 'failed',
              last_error: outcome.error,
              next_attempt_at: undefined,
            } satisfies Intent),
          );
          break;
        }
      }
    } catch (err) {
      // Storage failed mid-drain. Stop rather than re-sending operations whose
      // bookkeeping we could not record.
      result.status = 'storage-error';
      if (err instanceof LocalStoreError) result.storageError = err;
      break;
    }
  }

  if (result.status !== 'storage-error') result.status = parked ? 'parked' : 'drained';
  const after = await listIntents(store, owner).catch(() => [] as Intent[]);
  result.remaining = after.filter((i) => i.state === 'pending').length;
  result.failed = after.filter((i) => i.state === 'failed').length;
  return result;
}
