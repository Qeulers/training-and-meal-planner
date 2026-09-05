import { describe, it, expect } from 'vitest';
import { lastOccurrence, type LoggedSet } from '@/domain/prefill';

const set = (over: Partial<LoggedSet> & { workout_log_id: string; set_no: number }): LoggedSet => ({
  exercise_slug: 'backsquat',
  weight_kg: 60,
  reps: 5,
  logged_on: '2027-01-05',
  log_created_at: '2027-01-05T09:00:00Z',
  ...over,
});

describe('lastOccurrence (WORK-01)', () => {
  it('returns nothing when the exercise has never been logged', () => {
    expect(lastOccurrence('deadlift', [set({ workout_log_id: 'a', set_no: 1 })])).toEqual([]);
    expect(lastOccurrence('backsquat', [])).toEqual([]);
  });

  it('returns the sets of the single most recent workout', () => {
    const sets = [
      set({ workout_log_id: 'old', set_no: 1, logged_on: '2027-01-01', weight_kg: 50 }),
      set({ workout_log_id: 'new', set_no: 1, logged_on: '2027-01-08', weight_kg: 70 }),
      set({ workout_log_id: 'new', set_no: 2, logged_on: '2027-01-08', weight_kg: 70 }),
    ];
    expect(lastOccurrence('backsquat', sets).map((s) => s.weight_kg)).toEqual([70, 70]);
  });

  // The defect this function exists to fix.
  it('does NOT merge two workouts logged on the same date', () => {
    const sets = [
      set({
        workout_log_id: 'morning',
        set_no: 1,
        weight_kg: 60,
        log_created_at: '2027-01-05T07:00:00Z',
      }),
      set({
        workout_log_id: 'morning',
        set_no: 2,
        weight_kg: 60,
        log_created_at: '2027-01-05T07:00:00Z',
      }),
      set({
        workout_log_id: 'evening',
        set_no: 1,
        weight_kg: 80,
        log_created_at: '2027-01-05T19:00:00Z',
      }),
    ];

    const out = lastOccurrence('backsquat', sets);

    // The old date-only rule returned all three, describing a session that
    // never happened.
    expect(out).toHaveLength(1);
    expect(out[0].weight_kg).toBe(80);
    expect(out[0].workout_log_id).toBe('evening');
  });

  it('breaks a same-date, same-created_at tie deterministically by id', () => {
    const sets = [
      set({ workout_log_id: 'aaa', set_no: 1, weight_kg: 60 }),
      set({ workout_log_id: 'zzz', set_no: 1, weight_kg: 80 }),
    ];
    const forwards = lastOccurrence('backsquat', sets);
    const backwards = lastOccurrence('backsquat', [...sets].reverse());

    expect(forwards).toEqual(backwards); // order of arrival must not matter
    expect(forwards[0].workout_log_id).toBe('zzz');
  });

  it('keeps history across templates — the last time you did it, wherever', () => {
    const sets = [
      set({ workout_log_id: 'strength_a', set_no: 1, logged_on: '2027-01-01', weight_kg: 60 }),
      set({ workout_log_id: 'mobility', set_no: 1, logged_on: '2027-01-09', weight_kg: 40 }),
    ];
    expect(lastOccurrence('backsquat', sets)[0].weight_kg).toBe(40);
  });

  it('returns sets in set order regardless of input order', () => {
    const sets = [
      set({ workout_log_id: 'w', set_no: 3, weight_kg: 62 }),
      set({ workout_log_id: 'w', set_no: 1, weight_kg: 60 }),
      set({ workout_log_id: 'w', set_no: 2, weight_kg: 61 }),
    ];
    expect(lastOccurrence('backsquat', sets).map((s) => s.set_no)).toEqual([1, 2, 3]);
  });

  it('ignores other exercises in the same workout', () => {
    const sets = [
      set({ workout_log_id: 'w', set_no: 1, weight_kg: 60 }),
      set({ workout_log_id: 'w', set_no: 1, exercise_slug: 'rdl', weight_kg: 80 }),
    ];
    const out = lastOccurrence('backsquat', sets);
    expect(out).toHaveLength(1);
    expect(out[0].weight_kg).toBe(60);
  });

  it('does not mutate the array it was given', () => {
    const sets = [
      set({ workout_log_id: 'w', set_no: 2 }),
      set({ workout_log_id: 'w', set_no: 1 }),
    ];
    const snapshot = structuredClone(sets);
    lastOccurrence('backsquat', sets);
    expect(sets).toEqual(snapshot);
  });
});
