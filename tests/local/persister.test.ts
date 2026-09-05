/*
 * Query-cache persistence (REL-01, REL-06). The rule that matters: one
 * account's cached records must never surface under another.
 */
import { describe, it, expect } from 'vitest';
import { createMemoryStore } from '@/data/local/memoryStore';
import { createLocalPersister } from '@/data/sync/persister';
import type { PersistedClient } from '@tanstack/react-query-persist-client';

const client = (label: string) =>
  ({
    timestamp: 1,
    buster: 'v1',
    clientState: { mutations: [], queries: [{ queryKey: [label] }] },
  }) as unknown as PersistedClient;

describe('local query persister', () => {
  it('round-trips a cache', async () => {
    const store = createMemoryStore();
    const persister = createLocalPersister(store, 'user-a');
    await persister.persistClient(client('races'));
    expect(await persister.restoreClient()).toMatchObject({ buster: 'v1' });
  });

  it('keeps each account’s cache separate', async () => {
    const store = createMemoryStore();
    const a = createLocalPersister(store, 'user-a');
    const b = createLocalPersister(store, 'user-b');

    await a.persistClient(client('a-data'));

    // B has never persisted anything and must not inherit A's.
    expect(await b.restoreClient()).toBeUndefined();
  });

  it('removing one account’s cache leaves the other’s alone', async () => {
    const store = createMemoryStore();
    const a = createLocalPersister(store, 'user-a');
    const b = createLocalPersister(store, 'user-b');
    await a.persistClient(client('a-data'));
    await b.persistClient(client('b-data'));

    await a.removeClient();

    expect(await a.restoreClient()).toBeUndefined();
    expect(await b.restoreClient()).toBeDefined();
  });

  it('never lets a storage failure break the app', async () => {
    const store = createMemoryStore({ fail: () => 'quota' });
    const persister = createLocalPersister(store, 'user-a');

    // Cached reads are a convenience; the outbox is what must not fail loudly.
    await expect(persister.persistClient(client('x'))).resolves.toBeUndefined();
    await expect(persister.restoreClient()).resolves.toBeUndefined();
    await expect(persister.removeClient()).resolves.toBeUndefined();
  });
});
