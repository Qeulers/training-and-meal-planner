/*
 * Workout draft storage (WORK-01). The hook's React behaviour is covered by the
 * logger component tests; this covers the storage contract and, above all,
 * identity scoping.
 */
import { describe, it, expect } from 'vitest';
import { createMemoryStore } from '@/data/local/memoryStore';
import { draftKey, readDraft, type WorkoutDraft } from '@/data/sync/drafts';

const OWNER = 'user-a';
const OTHER = 'user-b';

const draft = (over: Partial<WorkoutDraft> = {}): WorkoutDraft => ({
  owner: OWNER,
  session_key: 'strength_a',
  session_name: 'Strength A',
  phase_slug: 'p1',
  logged_on: '2027-01-05',
  notes: '',
  sets: { backsquat: [{ weight: 60, reps: 5, done: true }] },
  updated_at: 1,
  ...over,
});

describe('draftKey', () => {
  it('scopes a draft to an account, a session and a date', () => {
    expect(draftKey(OWNER, 'strength_a', '2027-01-05')).toBe(
      'workout:user-a:strength_a:2027-01-05',
    );
  });

  it('gives two accounts different keys for the same session and date', () => {
    expect(draftKey(OWNER, 's', '2027-01-05')).not.toBe(draftKey(OTHER, 's', '2027-01-05'));
  });

  it('gives the same session on two dates different keys', () => {
    expect(draftKey(OWNER, 's', '2027-01-05')).not.toBe(draftKey(OWNER, 's', '2027-01-06'));
  });
});

describe('readDraft', () => {
  it('round-trips a draft', async () => {
    const store = createMemoryStore();
    const key = draftKey(OWNER, 'strength_a', '2027-01-05');
    await store.write(['drafts'], (tx) => tx.put('drafts', key, draft()));

    const found = await readDraft(store, key, OWNER);
    expect(found?.sets.backsquat).toEqual([{ weight: 60, reps: 5, done: true }]);
  });

  it('returns null when there is nothing saved', async () => {
    const store = createMemoryStore();
    expect(await readDraft(store, draftKey(OWNER, 's', '2027-01-05'), OWNER)).toBeNull();
  });

  it('refuses to hand one account another account’s draft, whatever the key holds', async () => {
    const store = createMemoryStore();
    // A key that looks like A's, but the record inside is owned by B.
    const key = draftKey(OWNER, 'strength_a', '2027-01-05');
    await store.write(['drafts'], (tx) => tx.put('drafts', key, draft({ owner: OTHER })));

    expect(await readDraft(store, key, OWNER)).toBeNull();
  });

  it('keeps two accounts’ drafts for the same session independent', async () => {
    const store = createMemoryStore();
    const aKey = draftKey(OWNER, 's', '2027-01-05');
    const bKey = draftKey(OTHER, 's', '2027-01-05');
    await store.write(['drafts'], (tx) => tx.put('drafts', aKey, draft({ notes: 'mine' })));
    await store.write(['drafts'], (tx) =>
      tx.put('drafts', bKey, draft({ owner: OTHER, notes: 'theirs' })),
    );

    expect((await readDraft(store, aKey, OWNER))?.notes).toBe('mine');
    expect((await readDraft(store, bKey, OTHER))?.notes).toBe('theirs');
  });

  it('carries submitted_as, which is what blocks a duplicate save', async () => {
    const store = createMemoryStore();
    const key = draftKey(OWNER, 's', '2027-01-05');
    await store.write(['drafts'], (tx) =>
      tx.put('drafts', key, draft({ submitted_as: 'op-123' })),
    );
    expect((await readDraft(store, key, OWNER))?.submitted_as).toBe('op-123');
  });

  it('survives in storage independently of the outbox', async () => {
    // Clearing queued writes must not take drafts with it, and vice versa.
    const store = createMemoryStore();
    const key = draftKey(OWNER, 's', '2027-01-05');
    await store.write(['drafts'], (tx) => tx.put('drafts', key, draft()));
    await store.write(['outbox'], (tx) => tx.clear('outbox'));

    expect(await readDraft(store, key, OWNER)).not.toBeNull();
  });
});
