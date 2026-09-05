/*
 * Outbox and replay (REL-01, REL-02, REL-06). Rules: docs/sync-contract.md.
 */
import { describe, it, expect } from 'vitest';
import { createMemoryStore } from '@/data/local/memoryStore';
import {
  enqueue,
  drain,
  listIntents,
  countIntents,
  retryIntent,
  discardIntent,
  type Intent,
  type SendFn,
  type SendOutcome,
} from '@/data/local/outbox';
import { backoffMs, MAX_ATTEMPTS } from '@/data/local/backoff';
import { LocalStoreError } from '@/data/local/types';

const OWNER = 'user-a';
const OTHER = 'user-b';

const input = (over: Partial<Parameters<typeof enqueue>[1]> = {}) => ({
  owner: OWNER,
  op: 'toggle_check',
  entity: 'shopping_checks',
  entity_id: 'eggs|P',
  payload: { checked: true },
  ...over,
});

/** A send that records what it saw and replies from a script. */
function scriptedSend(script: SendOutcome[] | ((i: Intent) => SendOutcome)) {
  const seen: Intent[] = [];
  const fn: SendFn = async (intent) => {
    seen.push(intent);
    if (typeof script === 'function') return script(intent);
    return script.shift() ?? { kind: 'ok' };
  };
  return { fn, seen };
}

describe('enqueue — durability before acknowledgement (REL-01)', () => {
  it('mints a stable operation_id before anything is sent', async () => {
    const store = createMemoryStore();
    const intent = await enqueue(store, input());
    expect(intent.operation_id).toBeTruthy();
    const [stored] = await listIntents(store, OWNER);
    expect(stored.operation_id).toBe(intent.operation_id);
  });

  it('commits the local state change and the intent together', async () => {
    const store = createMemoryStore();
    await enqueue(store, input(), {
      extraStores: ['drafts'],
      alsoWrite: (tx) => tx.put('drafts', 'draft-1', { reps: 5 }),
    });
    const draft = await store.read(['drafts'], (tx) => tx.get('drafts', 'draft-1'));
    expect(draft).toEqual({ reps: 5 });
    expect(await listIntents(store, OWNER)).toHaveLength(1);
  });

  it('records neither half when the local state change throws', async () => {
    const store = createMemoryStore();
    await expect(
      enqueue(store, input(), {
        extraStores: ['drafts'],
        alsoWrite: async () => {
          throw new Error('draft write failed');
        },
      }),
    ).rejects.toThrow('draft write failed');

    expect(await listIntents(store, OWNER)).toHaveLength(0);
  });

  it('throws rather than silently degrading when storage is denied', async () => {
    const store = createMemoryStore({ fail: (op) => (op === 'put' ? 'quota' : null) });
    // The caller must surface this: reporting "Saved on device" here is exactly
    // the silent fallback REL-01 forbids.
    await expect(enqueue(store, input())).rejects.toBeInstanceOf(LocalStoreError);
  });

  it('numbers intents monotonically in creation order', async () => {
    const store = createMemoryStore();
    await enqueue(store, input({ entity_id: 'a' }));
    await enqueue(store, input({ entity_id: 'b' }));
    await enqueue(store, input({ entity_id: 'c' }));
    expect((await listIntents(store, OWNER)).map((i) => i.entity_id)).toEqual(['a', 'b', 'c']);
  });

  it('records client_ts but never uses it for ordering', async () => {
    const store = createMemoryStore();
    // A device with a badly skewed clock still queues behind earlier work.
    await enqueue(store, input({ entity_id: 'first' }), { now: () => 5_000_000 });
    await enqueue(store, input({ entity_id: 'second' }), { now: () => 1 });
    const [a, b] = await listIntents(store, OWNER);
    expect([a.entity_id, b.entity_id]).toEqual(['first', 'second']);
    expect(a.client_ts).toBeGreaterThan(b.client_ts);
  });
});

describe('drain — ordering and idempotency (REL-02)', () => {
  it('sends in seq order', async () => {
    const store = createMemoryStore();
    for (const id of ['a', 'b', 'c']) await enqueue(store, input({ entity_id: id }));
    const { fn, seen } = scriptedSend(() => ({ kind: 'ok' }));

    const result = await drain(store, OWNER, fn);

    expect(seen.map((i) => i.entity_id)).toEqual(['a', 'b', 'c']);
    expect(result).toMatchObject({ sent: 3, remaining: 0, failed: 0, status: 'drained' });
  });

  it('treats a duplicate as success — an acknowledged operation applies once', async () => {
    const store = createMemoryStore();
    const intent = await enqueue(store, input());
    // Server committed, the acknowledgement was lost, we replay the same id.
    const { fn, seen } = scriptedSend([{ kind: 'duplicate' }]);

    const result = await drain(store, OWNER, fn);

    expect(seen[0].operation_id).toBe(intent.operation_id);
    expect(result).toMatchObject({ sent: 1, duplicates: 1, remaining: 0 });
    expect(await listIntents(store, OWNER)).toHaveLength(0);
  });

  it('replays the same operation_id across attempts', async () => {
    const store = createMemoryStore();
    const intent = await enqueue(store, input());
    const { fn, seen } = scriptedSend([{ kind: 'retry' }, { kind: 'ok' }]);

    await drain(store, OWNER, fn, { now: () => 0, random: () => 0 });
    await drain(store, OWNER, fn, { now: () => 1_000_000 });

    expect(seen).toHaveLength(2);
    expect(new Set(seen.map((i) => i.operation_id))).toEqual(new Set([intent.operation_id]));
  });

  it('holds an intent back until its dependency lands', async () => {
    const store = createMemoryStore();
    const parent = await enqueue(store, input({ entity_id: 'parent' }));
    await enqueue(store, input({ entity_id: 'child', deps: [parent.operation_id] }));

    // Parent fails transiently, so the child must not overtake it.
    const first = scriptedSend((i) =>
      i.entity_id === 'parent' ? { kind: 'retry' } : { kind: 'ok' },
    );
    await drain(store, OWNER, first.fn, { now: () => 0, random: () => 0 });
    expect(first.seen.map((i) => i.entity_id)).toEqual(['parent']);

    const second = scriptedSend(() => ({ kind: 'ok' }));
    await drain(store, OWNER, second.fn, { now: () => 1_000_000 });
    expect(second.seen.map((i) => i.entity_id)).toEqual(['parent', 'child']);
  });
});

describe('drain — failure handling', () => {
  it('backs off transient failures instead of hammering', async () => {
    const store = createMemoryStore();
    await enqueue(store, input());
    const { fn } = scriptedSend(() => ({ kind: 'retry', error: 'ECONNRESET' }));

    await drain(store, OWNER, fn, { now: () => 1_000, random: () => 1 });
    const [intent] = await listIntents(store, OWNER);

    expect(intent.state).toBe('pending');
    expect(intent.attempts).toBe(1);
    expect(intent.next_attempt_at).toBeGreaterThan(1_000);
  });

  it('does not retry before the backoff window has passed', async () => {
    const store = createMemoryStore();
    await enqueue(store, input());
    const { fn, seen } = scriptedSend(() => ({ kind: 'retry' }));

    await drain(store, OWNER, fn, { now: () => 0, random: () => 1 });
    await drain(store, OWNER, fn, { now: () => 1, random: () => 1 });

    expect(seen).toHaveLength(1);
  });

  it('dead-letters after a bounded number of attempts', async () => {
    const store = createMemoryStore();
    await enqueue(store, input());
    const { fn } = scriptedSend(() => ({ kind: 'retry', error: 'still down' }));

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await drain(store, OWNER, fn, { now: () => i * 10_000_000, random: () => 0 });
    }

    const [intent] = await listIntents(store, OWNER);
    expect(intent.state).toBe('failed');
    expect(intent.last_error).toMatch(/Gave up after \d+ attempts/);
    expect(await countIntents(store, OWNER)).toEqual({ pending: 0, failed: 1 });
  });

  it('dead-letters a permanent failure immediately, with the reason', async () => {
    const store = createMemoryStore();
    await enqueue(store, input());
    const { fn } = scriptedSend(() => ({ kind: 'permanent', error: 'races_one_target' }));

    const result = await drain(store, OWNER, fn);

    expect(result.failed).toBe(1);
    const [intent] = await listIntents(store, OWNER);
    expect(intent.last_error).toBe('races_one_target');
  });

  it('keeps a failed intent instead of discarding the work', async () => {
    const store = createMemoryStore();
    await enqueue(store, input({ payload: { irreplaceable: true } }));
    const { fn } = scriptedSend(() => ({ kind: 'permanent', error: 'nope' }));

    await drain(store, OWNER, fn);

    const [intent] = await listIntents(store, OWNER);
    expect(intent.payload).toEqual({ irreplaceable: true });
  });

  it('skips a dead-lettered intent on later drains until it is retried', async () => {
    const store = createMemoryStore();
    const intent = await enqueue(store, input());
    await drain(store, OWNER, scriptedSend(() => ({ kind: 'permanent', error: 'x' })).fn);

    const after = scriptedSend(() => ({ kind: 'ok' }));
    await drain(store, OWNER, after.fn);
    expect(after.seen).toHaveLength(0);

    await retryIntent(store, intent.operation_id);
    const retried = scriptedSend(() => ({ kind: 'ok' }));
    await drain(store, OWNER, retried.fn);
    expect(retried.seen).toHaveLength(1);
    expect(await listIntents(store, OWNER)).toHaveLength(0);
  });

  it('discards only when explicitly told to', async () => {
    const store = createMemoryStore();
    const intent = await enqueue(store, input());
    await discardIntent(store, intent.operation_id);
    expect(await listIntents(store, OWNER)).toHaveLength(0);
  });

  it('stops mid-drain when storage fails, rather than sending work it cannot record', async () => {
    const store = createMemoryStore();
    await enqueue(store, input({ entity_id: 'a' }));
    await enqueue(store, input({ entity_id: 'b' }));
    await enqueue(store, input({ entity_id: 'c' }));

    // Storage goes bad once the queue is already built, so the failure lands on
    // the bookkeeping write that follows a successful send.
    const failAfter = 1;
    let writes = 0;
    const flaky: typeof store = {
      ...store,
      write: (stores, fn) => {
        if (writes++ >= failAfter) throw new LocalStoreError('quota', 'disk full');
        return store.write(stores, fn);
      },
    };

    const { fn, seen } = scriptedSend(() => ({ kind: 'ok' }));
    const result = await drain(flaky, OWNER, fn, { now: () => 0 });

    expect(result.status).toBe('storage-error');
    expect(result.storageError?.kind).toBe('quota');
    // 'a' was sent and recorded; 'b' was sent but its deletion failed, so the
    // drain stopped instead of pressing on to 'c'.
    expect(seen.map((i) => i.entity_id)).toEqual(['a', 'b']);
    expect((await listIntents(store, OWNER)).map((i) => i.entity_id)).toEqual(['b', 'c']);
  });
});

describe('drain — an expired session parks the queue, it does not fail it (REL-02)', () => {
  it('stops at the first auth failure and leaves everything queued', async () => {
    const store = createMemoryStore();
    for (const id of ['a', 'b', 'c']) await enqueue(store, input({ entity_id: id }));
    const { fn, seen } = scriptedSend(() => ({ kind: 'auth', error: 'JWT expired' }));

    const result = await drain(store, OWNER, fn);

    // One attempt, not three — the rest would fail identically.
    expect(seen).toHaveLength(1);
    expect(result.status).toBe('parked');
    expect(result.failed).toBe(0);
    expect(result.remaining).toBe(3);
  });

  it('drains normally once the session is restored', async () => {
    const store = createMemoryStore();
    await enqueue(store, input());
    await drain(store, OWNER, scriptedSend(() => ({ kind: 'auth' })).fn);

    const result = await drain(store, OWNER, scriptedSend(() => ({ kind: 'ok' })).fn);
    expect(result.status).toBe('drained');
    expect(await listIntents(store, OWNER)).toHaveLength(0);
  });

  it('does not burn a retry attempt while parked', async () => {
    const store = createMemoryStore();
    await enqueue(store, input());
    await drain(store, OWNER, scriptedSend(() => ({ kind: 'auth' })).fn);
    const [intent] = await listIntents(store, OWNER);
    expect(intent.attempts).toBe(0);
    expect(intent.state).toBe('pending');
  });
});

describe('identity isolation (REL-06)', () => {
  it('never sends another account’s intents', async () => {
    const store = createMemoryStore();
    await enqueue(store, input({ owner: OWNER, entity_id: 'mine' }));
    await enqueue(store, input({ owner: OTHER, entity_id: 'theirs' }));

    const { fn, seen } = scriptedSend(() => ({ kind: 'ok' }));
    await drain(store, OWNER, fn);

    expect(seen.map((i) => i.entity_id)).toEqual(['mine']);
  });

  it('never shows or counts another account’s pending work', async () => {
    const store = createMemoryStore();
    await enqueue(store, input({ owner: OTHER }));
    expect(await listIntents(store, OWNER)).toHaveLength(0);
    expect(await countIntents(store, OWNER)).toEqual({ pending: 0, failed: 0 });
  });

  it('leaves the other account’s work intact and replayable after a switch back', async () => {
    const store = createMemoryStore();
    await enqueue(store, input({ owner: OTHER, entity_id: 'theirs' }));
    await drain(store, OWNER, scriptedSend(() => ({ kind: 'ok' })).fn);

    const back = scriptedSend(() => ({ kind: 'ok' }));
    await drain(store, OTHER, back.fn);
    expect(back.seen.map((i) => i.entity_id)).toEqual(['theirs']);
  });

  it('never rewrites an intent’s owner', async () => {
    const store = createMemoryStore();
    const intent = await enqueue(store, input({ owner: OTHER }));
    await retryIntent(store, intent.operation_id);
    const [stored] = await listIntents(store, OTHER);
    expect(stored.owner).toBe(OTHER);
  });
});

describe('backoffMs', () => {
  it('grows with attempts and stays within the window', () => {
    expect(backoffMs(0, { random: () => 1, baseMs: 1000 })).toBe(1000);
    expect(backoffMs(1, { random: () => 1, baseMs: 1000 })).toBe(2000);
    expect(backoffMs(4, { random: () => 1, baseMs: 1000 })).toBe(16000);
  });

  it('caps the delay', () => {
    expect(backoffMs(30, { random: () => 1, baseMs: 1000, capMs: 300_000 })).toBe(300_000);
  });

  it('jitters, so parallel intents do not retry in lockstep', () => {
    expect(backoffMs(5, { random: () => 0 })).toBe(0);
    expect(backoffMs(5, { random: () => 0.5, baseMs: 1000 })).toBe(16000);
  });

  it('does not overflow on an absurd attempt count', () => {
    expect(Number.isFinite(backoffMs(1e6, { random: () => 1 }))).toBe(true);
  });
});
