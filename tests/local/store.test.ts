/*
 * LocalStore contract (REL-01). These run against the in-memory implementation.
 * Real IndexedDB quota/denial/upgrade-interruption behaviour is NOT covered here
 * and is a manual test-script item — see docs/sync-contract.md.
 */
import { describe, it, expect } from 'vitest';
import { createMemoryStore } from '@/data/local/memoryStore';
import { LocalStoreError } from '@/data/local/types';

describe('LocalStore — atomicity', () => {
  it('rolls back every write in a transaction that throws', async () => {
    const store = createMemoryStore();
    await store.write(['meta'], (tx) => tx.put('meta', 'keep', 'original'));

    await expect(
      store.write(['meta', 'outbox'], async (tx) => {
        await tx.put('meta', 'keep', 'changed');
        await tx.put('outbox', 'op1', { id: 'op1' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    // Neither half of the transaction survived.
    await store.read(['meta', 'outbox'], async (tx) => {
      expect(await tx.get('meta', 'keep')).toBe('original');
      expect(await tx.get('outbox', 'op1')).toBeUndefined();
    });
  });

  it('sees its own writes inside a transaction', async () => {
    const store = createMemoryStore();
    const seen = await store.write(['meta'], async (tx) => {
      await tx.put('meta', 'k', 1);
      return tx.get<number>('meta', 'k');
    });
    expect(seen).toBe(1);
  });

  it('refuses to touch a store the transaction did not declare', async () => {
    const store = createMemoryStore();
    await expect(
      store.write(['meta'], (tx) => tx.put('outbox', 'x', 1)),
    ).rejects.toBeInstanceOf(LocalStoreError);
  });

  it('stores values by copy, so later mutation of the caller object is not visible', async () => {
    const store = createMemoryStore();
    const value = { nested: { n: 1 } };
    await store.write(['meta'], (tx) => tx.put('meta', 'k', value));
    value.nested.n = 99;
    const read = await store.read(['meta'], (tx) => tx.get<typeof value>('meta', 'k'));
    expect(read!.nested.n).toBe(1);
  });
});

describe('LocalStore — failure is reported, never swallowed', () => {
  it('propagates an injected quota failure', async () => {
    const store = createMemoryStore({ fail: (op) => (op === 'put' ? 'quota' : null) });
    await expect(store.write(['meta'], (tx) => tx.put('meta', 'k', 1))).rejects.toMatchObject({
      kind: 'quota',
    });
  });

  it('reports non-durable storage rather than pretending', () => {
    const store = createMemoryStore({ durable: false });
    expect(store.durable).toBe(false);
  });

  it('flags quarantined data instead of deleting it', () => {
    const store = createMemoryStore({ durable: false, quarantined: true });
    expect(store.quarantined).toBe(true);
  });

  it('rejects use after close', async () => {
    const store = createMemoryStore();
    await store.close();
    await expect(store.read(['meta'], (tx) => tx.get('meta', 'k'))).rejects.toBeInstanceOf(
      LocalStoreError,
    );
  });
});
