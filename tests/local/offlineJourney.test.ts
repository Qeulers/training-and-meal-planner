/*
 * The journey REL-A describes, end to end through the real outbox: edit while
 * offline, survive a reload, replay exactly once on reconnect.
 *
 * Storage is the in-memory LocalStore, so "survives a reload" is modelled as a
 * fresh drain against the same store rather than an actual browser restart.
 * A real cold reopen with all tabs closed is manual-script §1.
 */
import { describe, it, expect } from 'vitest';
import { createMemoryStore } from '@/data/local/memoryStore';
import { enqueue, drain, countIntents, listIntents } from '@/data/local/outbox';
import { makeSender } from '@/data/sync/operations';
import { rebase, rowApplier } from '@/data/local/rebase';

const OWNER = 'user-a';

interface CheckRow {
  item_key: string;
}

const checkApplier = rowApplier<CheckRow>(
  'shopping_checks',
  (r) => r.item_key,
  (i) => (i.op === 'add_check' ? { item_key: i.entity_id } : null),
);

const tick = (item_key: string) => ({
  op: 'add_check',
  entity: 'shopping_checks',
  entity_id: item_key,
  owner: OWNER,
  payload: { id: `row-${item_key}`, user_id: OWNER, item_key },
});

describe('offline shopping journey (REL-A)', () => {
  it('keeps ticks queued while offline and shows them over stale server state', async () => {
    const store = createMemoryStore();

    // Offline: tick a recipe ingredient and the pantry staple with the same name.
    await enqueue(store, tick('eggs|P'));
    await enqueue(store, tick('staple:eggs|P'));

    expect(await countIntents(store, OWNER)).toEqual({ pending: 2, failed: 0 });

    // A refetch lands showing neither tick. Rebasing must not lose them.
    const fromServer: CheckRow[] = [];
    const shown = rebase(fromServer, await listIntents(store, OWNER), checkApplier);
    expect(shown.map((r) => r.item_key).sort()).toEqual(['eggs|P', 'staple:eggs|P']);
  });

  it('applies each queued operation exactly once on reconnect', async () => {
    const store = createMemoryStore();
    await enqueue(store, tick('eggs|P'));
    await enqueue(store, tick('rice|N'));

    const applied: string[] = [];
    const seenIds = new Set<string>();
    const server = makeSender({
      add_check: async (i) => {
        // Model the server's receipt table: a replayed id is a no-op.
        if (seenIds.has(i.operation_id)) return { duplicate: true };
        seenIds.add(i.operation_id);
        applied.push(i.entity_id);
        return { duplicate: false };
      },
    });

    const result = await drain(store, OWNER, server);

    expect(result.status).toBe('drained');
    expect(applied).toEqual(['eggs|P', 'rice|N']);
    expect(await countIntents(store, OWNER)).toEqual({ pending: 0, failed: 0 });
  });

  it('survives a lost acknowledgement without ticking anything twice', async () => {
    const store = createMemoryStore();
    await enqueue(store, tick('eggs|P'));

    const applied: string[] = [];
    const seenIds = new Set<string>();
    let dropAck = true;
    const flakyServer = makeSender({
      add_check: async (i) => {
        if (seenIds.has(i.operation_id)) return { duplicate: true };
        seenIds.add(i.operation_id);
        applied.push(i.entity_id);
        if (dropAck) {
          dropAck = false;
          // Committed server-side, but the response never arrived.
          throw { status: 503, message: 'gateway timeout' };
        }
        return { duplicate: false };
      },
    });

    await drain(store, OWNER, flakyServer, { now: () => 0, random: () => 0 });
    // Still queued, because as far as the client knows it never landed.
    expect(await countIntents(store, OWNER)).toEqual({ pending: 1, failed: 0 });

    const second = await drain(store, OWNER, flakyServer, { now: () => 1_000_000 });

    expect(second.duplicates).toBe(1);
    expect(applied).toEqual(['eggs|P']); // applied once, not twice
    expect(await listIntents(store, OWNER)).toHaveLength(0);
  });

  it('holds the queue through an expired session and drains it after signing back in', async () => {
    const store = createMemoryStore();
    await enqueue(store, tick('eggs|P'));
    await enqueue(store, tick('rice|N'));

    let signedIn = false;
    const server = makeSender({
      add_check: async () => {
        if (!signedIn) throw { status: 401, message: 'JWT expired' };
        return { duplicate: false };
      },
    });

    const parked = await drain(store, OWNER, server);
    expect(parked.status).toBe('parked');
    expect(parked.failed).toBe(0);
    expect(await countIntents(store, OWNER)).toEqual({ pending: 2, failed: 0 });

    signedIn = true;
    const resumed = await drain(store, OWNER, server);
    expect(resumed.status).toBe('drained');
    expect(await countIntents(store, OWNER)).toEqual({ pending: 0, failed: 0 });
  });

  it('never sends one account’s queued ticks under another account', async () => {
    const store = createMemoryStore();
    await enqueue(store, tick('eggs|P'));
    await enqueue(store, { ...tick('rice|N'), owner: 'user-b' });

    const sentBy: Record<string, string[]> = { 'user-a': [], 'user-b': [] };
    const senderFor = (who: string) =>
      makeSender({
        add_check: async (i) => {
          sentBy[who].push(i.entity_id);
          return { duplicate: false };
        },
      });

    await drain(store, OWNER, senderFor('user-a'));
    expect(sentBy['user-a']).toEqual(['eggs|P']);
    // B's tick is untouched and still theirs.
    expect(await countIntents(store, 'user-b')).toEqual({ pending: 1, failed: 0 });

    await drain(store, 'user-b', senderFor('user-b'));
    expect(sentBy['user-b']).toEqual(['rice|N']);
  });
});
