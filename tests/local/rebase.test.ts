/*
 * Rebasing pending intents over refreshed server state (REL-03).
 * A refetch must never make a local write appear to vanish.
 */
import { describe, it, expect } from 'vitest';
import { rebase, rowApplier } from '@/data/local/rebase';
import type { Intent } from '@/data/local/outbox';

interface Check {
  item_key: string;
  trip_id: string;
}

const intent = (over: Partial<Intent>): Intent => ({
  operation_id: over.operation_id ?? `op-${over.seq ?? 0}`,
  owner: 'user-a',
  op: 'toggle_check',
  entity: 'shopping_checks',
  entity_id: 'eggs|P',
  payload: { checked: true, trip_id: 't1' },
  seq: 0,
  deps: [],
  client_ts: 0,
  attempts: 0,
  state: 'pending',
  ...over,
});

const checkApplier = rowApplier<Check>(
  'shopping_checks',
  (row) => row.item_key,
  (i) => {
    const payload = i.payload as { checked: boolean; trip_id: string };
    return payload.checked ? { item_key: i.entity_id, trip_id: payload.trip_id } : null;
  },
);

describe('rebase', () => {
  it('re-applies a pending tick the server has not seen yet', () => {
    const server: Check[] = [];
    const out = rebase(server, [intent({ seq: 1 })], checkApplier);
    expect(out).toEqual([{ item_key: 'eggs|P', trip_id: 't1' }]);
  });

  it('re-applies a pending untick over a server row that still shows it ticked', () => {
    const server: Check[] = [{ item_key: 'eggs|P', trip_id: 't1' }];
    const out = rebase(
      server,
      [intent({ seq: 1, payload: { checked: false, trip_id: 't1' } })],
      checkApplier,
    );
    expect(out).toEqual([]);
  });

  it('applies intents oldest-first regardless of the order they are handed over', () => {
    const server: Check[] = [];
    const out = rebase(
      server,
      [
        intent({ seq: 3, payload: { checked: true, trip_id: 't1' } }),
        intent({ seq: 1, payload: { checked: true, trip_id: 't1' } }),
        intent({ seq: 2, payload: { checked: false, trip_id: 't1' } }),
      ],
      checkApplier,
    );
    // tick, untick, tick -> ticked
    expect(out).toEqual([{ item_key: 'eggs|P', trip_id: 't1' }]);
  });

  it('leaves untouched server rows alone', () => {
    const server: Check[] = [
      { item_key: 'rice|N', trip_id: 't1' },
      { item_key: 'eggs|P', trip_id: 't1' },
    ];
    const out = rebase(
      server,
      [intent({ seq: 1, payload: { checked: false, trip_id: 't1' } })],
      checkApplier,
    );
    expect(out).toEqual([{ item_key: 'rice|N', trip_id: 't1' }]);
  });

  it('ignores intents for other entities', () => {
    const server: Check[] = [];
    const out = rebase(
      server,
      [intent({ seq: 1, entity: 'basket_items', entity_id: 'dahl' })],
      checkApplier,
    );
    expect(out).toEqual([]);
  });

  it('does NOT re-apply dead-lettered work the user was told did not save', () => {
    const server: Check[] = [];
    const out = rebase(server, [intent({ seq: 1, state: 'failed' })], checkApplier);
    expect(out).toEqual([]);
  });

  it('does not mutate the server array it was given', () => {
    const server: Check[] = [{ item_key: 'rice|N', trip_id: 't1' }];
    const snapshot = structuredClone(server);
    rebase(server, [intent({ seq: 1 })], checkApplier);
    expect(server).toEqual(snapshot);
  });

  it('is a no-op with an empty queue', () => {
    const server: Check[] = [{ item_key: 'rice|N', trip_id: 't1' }];
    expect(rebase(server, [], checkApplier)).toEqual(server);
  });

  it('distinguishes a staple from its recipe twin (SHOP-01 keys survive rebase)', () => {
    const server: Check[] = [{ item_key: 'eggs|P', trip_id: 't1' }];
    const out = rebase(
      server,
      [intent({ seq: 1, entity_id: 'staple:eggs|P', payload: { checked: true, trip_id: 't1' } })],
      checkApplier,
    );
    expect(out.map((c) => c.item_key).sort()).toEqual(['eggs|P', 'staple:eggs|P']);
  });
});
