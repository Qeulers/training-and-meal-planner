/*
 * Which previous sets to prefill a logger with (WORK-01).
 *
 * The rule is "the most recent workout OCCURRENCE that contained this exercise",
 * not "every set for this exercise on the most recent date". Those differ
 * whenever two workouts are logged on one day — a morning lift and an evening
 * accessory session, or a session redone after a bad first attempt — and the
 * old date-only rule merged them into one impossible-looking set list.
 *
 * History is deliberately NOT restricted to the current template: an exercise
 * that appears in two sessions should prefill from whichever one you did last.
 *
 * Ordering is total, so the answer never depends on the order rows arrive from
 * the server: date, then when the log was created, then its id as a final
 * tiebreak.
 */
import type { DateStr } from './dates';

export interface LoggedSet {
  workout_log_id: string;
  exercise_slug: string;
  set_no: number;
  weight_kg: number;
  reps: number;
  logged_on: DateStr;
  /** `workout_logs.created_at`. Separates two workouts logged on one date. */
  log_created_at: string;
}

/** Rank two occurrences; the greater one is the more recent. */
function compareOccurrence(a: LoggedSet, b: LoggedSet): number {
  if (a.logged_on !== b.logged_on) return a.logged_on < b.logged_on ? -1 : 1;
  if (a.log_created_at !== b.log_created_at) return a.log_created_at < b.log_created_at ? -1 : 1;
  return a.workout_log_id < b.workout_log_id ? -1 : a.workout_log_id > b.workout_log_id ? 1 : 0;
}

/**
 * The sets this exercise was last done with, in set order.
 * Returns `[]` when there is no history for it.
 */
export function lastOccurrence(exerciseSlug: string, sets: readonly LoggedSet[]): LoggedSet[] {
  let best: LoggedSet | null = null;
  for (const s of sets) {
    if (s.exercise_slug !== exerciseSlug) continue;
    if (!best || compareOccurrence(s, best) > 0) best = s;
  }
  if (!best) return [];
  const winner = best;
  return sets
    .filter((s) => s.exercise_slug === exerciseSlug && s.workout_log_id === winner.workout_log_id)
    .sort((a, b) => a.set_no - b.set_no);
}
