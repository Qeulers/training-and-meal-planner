/*
 * Workout drafts, pre-save review and save failure (WORK-01, WORK-02, WORK-03).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryStore } from '@/data/local/memoryStore';
import { draftKey, readDraft, type WorkoutDraft } from '@/data/sync/drafts';
import type { LocalStore } from '@/data/local/types';

const OWNER = 'user-a';
let store: LocalStore;
let durable = true;
const saveMutate = vi.fn(async (_input: unknown) => ({ operation_id: 'op-1' }));
let allSets: unknown[] = [];

vi.mock('@/data/user', () => ({
  useUserId: () => OWNER,
  useAllSets: () => ({ data: allSets }),
  useSaveWorkout: () => ({ mutateAsync: saveMutate, isPending: false }),
  useUserSettings: () => ({ data: { rest_overrides: {} } }),
  useSetRestOverride: () => ({ mutate: vi.fn() }),
}));

vi.mock('@/data/sync/SyncProvider', () => ({
  useSync: () => ({ store, durable }),
}));

// The rest timer owns wall-clock state and a wake lock; neither is under test.
vi.mock('@/features/today/CountdownTimer', () => ({ CountdownTimer: () => null }));
vi.mock('@/features/today/useWakeLock', () => ({ useWakeLock: () => {} }));

import { WorkoutLogger } from '@/features/today/WorkoutLogger';

const SESSION = {
  slug: 'p1_tue',
  phase_slug: 'p1',
  session_key: 'strength_a',
  name: 'Strength A',
  day_of_week: 2,
  duration_label: '~55 min',
  brief: null,
  sort_order: 1,
};

const ITEMS = [
  { id: 1, session_template_slug: 'p1_tue', exercise_slug: 'backsquat', prescription: '3×5', sort_order: 1 },
] as never;

const EXERCISES = [
  { slug: 'backsquat', name: 'Back squat', cues: [], video_url: 'https://youtu.be/x', rest_seconds: 120 },
] as never;

const renderLogger = (onClose = vi.fn()) =>
  render(
    <WorkoutLogger
      session={SESSION}
      items={ITEMS}
      exercises={EXERCISES}
      phaseSlug="p1"
      onClose={onClose}
      loggedOn="2027-01-05"
    />,
  );

beforeEach(() => {
  store = createMemoryStore();
  durable = true;
  allSets = [];
  saveMutate.mockClear();
  saveMutate.mockResolvedValue({ operation_id: 'op-1' });
});

describe('WorkoutLogger — durable drafts (WORK-01)', () => {
  it('restores a saved draft on open', async () => {
    const draft: WorkoutDraft = {
      owner: OWNER,
      session_key: 'strength_a',
      session_name: 'Strength A',
      phase_slug: 'p1',
      logged_on: '2027-01-05',
      notes: '',
      sets: { backsquat: [{ weight: 92.5, reps: 3, done: true }] },
      updated_at: 1,
    };
    await store.write(['drafts'], (tx) =>
      tx.put('drafts', draftKey(OWNER, 'strength_a', '2027-01-05'), draft),
    );

    const user = userEvent.setup();
    renderLogger();

    // Assert through the review sheet: it proves the restored rows are what
    // would actually be written, not merely that a number is on screen.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /S1 completed/i })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(screen.getByRole('dialog')).toHaveTextContent(/92\.5 kg × 3/);
  });

  it('writes the draft through as sets are edited', async () => {
    const user = userEvent.setup();
    renderLogger();

    await user.click(screen.getByRole('button', { name: /S1 mark done/i }));

    await waitFor(
      async () => {
        const saved = await readDraft(store, draftKey(OWNER, 'strength_a', '2027-01-05'), OWNER);
        expect(saved).not.toBeNull();
      },
      { timeout: 2000 },
    );
  });

  it('does not restore another account’s draft', async () => {
    await store.write(['drafts'], (tx) =>
      tx.put('drafts', draftKey(OWNER, 'strength_a', '2027-01-05'), {
        owner: 'someone-else',
        session_key: 'strength_a',
        session_name: 'Strength A',
        phase_slug: 'p1',
        logged_on: '2027-01-05',
        notes: '',
        sets: { backsquat: [{ weight: 999, reps: 9, done: true }] },
        updated_at: 1,
      }),
    );

    const user = userEvent.setup();
    renderLogger();

    // No history and no usable draft, so the row opens blank — not with 999.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /S1 mark done/i })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(screen.getByRole('dialog')).not.toHaveTextContent(/999/);
  });
});

describe('WorkoutLogger — the logging date is disclosed (WORK-03)', () => {
  it('says which date the session will be recorded under', () => {
    renderLogger();
    expect(screen.getByText(/logging as/i)).toBeInTheDocument();
  });
});

describe('WorkoutLogger — pre-save review (WORK-02)', () => {
  it('does not save straight from the Save button', async () => {
    const user = userEvent.setup();
    renderLogger();

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(saveMutate).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('lists what will be written, with the logging date', async () => {
    const user = userEvent.setup();
    renderLogger();
    await user.click(screen.getByRole('button', { name: /S1 mark done/i }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(/Back squat/);
    expect(dialog).toHaveTextContent(/January/);
  });

  it('lets a line be dropped, and saves only what remains', async () => {
    const user = userEvent.setup();
    renderLogger();
    await user.click(screen.getByRole('button', { name: /S1 mark done/i }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    const boxes = screen.getAllByRole('checkbox');
    await user.click(boxes[0]);

    // With everything dropped, there is nothing left to save.
    expect(screen.getByRole('button', { name: /^save 0 sets$/i })).toBeDisabled();
  });

  it('saves the reviewed sets under the given date and clears the draft', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderLogger(onClose);
    await user.click(screen.getByRole('button', { name: /S1 mark done/i }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    await user.click(screen.getByRole('button', { name: /^save 1 set$/i }));

    await waitFor(() => expect(saveMutate).toHaveBeenCalledOnce());
    expect(saveMutate.mock.calls[0][0]).toMatchObject({
      logged_on: '2027-01-05',
      session_key: 'strength_a',
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await readDraft(store, draftKey(OWNER, 'strength_a', '2027-01-05'), OWNER)).toBeNull();
  });

  it('can be backed out of without saving', async () => {
    const user = userEvent.setup();
    renderLogger();
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    await user.click(screen.getByRole('button', { name: /^back$/i }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(saveMutate).not.toHaveBeenCalled();
  });

  it('closes on Escape without saving', async () => {
    const user = userEvent.setup();
    renderLogger();
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(saveMutate).not.toHaveBeenCalled();
  });

  it('warns in the review sheet when the browser will not keep the work', async () => {
    durable = false;
    const user = userEvent.setup();
    renderLogger();
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(screen.getByRole('dialog')).toHaveTextContent(/will not keep the session/i);
  });
});

describe('WorkoutLogger — a failed save keeps the work (WORK-02)', () => {
  it('says the sets are still there and leaves the draft alone', async () => {
    saveMutate.mockRejectedValueOnce(new Error('disk full'));
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderLogger(onClose);

    await user.click(screen.getByRole('button', { name: /S1 mark done/i }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    await user.click(screen.getByRole('button', { name: /^save 1 set$/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/still here/i));
    expect(onClose).not.toHaveBeenCalled();
    const saved = await readDraft(store, draftKey(OWNER, 'strength_a', '2027-01-05'), OWNER);
    expect(saved).not.toBeNull();
  });
});
