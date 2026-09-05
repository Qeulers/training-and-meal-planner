/*
 * Planned versus completed (STAT-01).
 *
 * A "78% completed" figure is meaningless without saying what the denominator
 * counts, so this states it rather than leaving it to be inferred:
 *
 *   - The unit is a scheduled STRENGTH OCCURRENCE: one (date, session_key) pair
 *     that the schedule says should happen. A session template appearing twice
 *     in a week is two occurrences.
 *   - The range is explicit and passed in. The caller displays it. There is no
 *     implicit "all time", because a denominator that grows every day makes the
 *     percentage drift for reasons unconnected to training.
 *   - Deduplication: several logs for the same occurrence count ONCE. Logging a
 *     session twice by accident cannot push completion above 100%.
 *   - A log with no matching scheduled occurrence — an extra session, or one
 *     carried over from another day — is counted separately as `unplanned`. It
 *     never inflates `completed`, because it did not complete anything that was
 *     planned, and never reduces it either.
 *   - Sauna is EXCLUDED. Optional sessions in a compliance denominator would
 *     make skipping something optional look like failure. It is reported on its
 *     own terms by `saunaTally`.
 *
 * Taper is the reason the raw number needs context: phases 3 and 4 deliberately
 * schedule less work, so a falling tonnage is the plan working, not a lapse.
 * That is a display concern, but it is why this returns counts rather than a
 * bare percentage.
 */
import { addDays, type DateStr } from './dates';
import { sessionsFor, type SessionTemplate } from './schedule';
import type { PhaseOverride } from './phase';

export interface LoggedSession {
  logged_on: DateStr;
  session_key: string;
}

export interface CompletionInput {
  /** Inclusive start of the reported range. */
  from: DateStr;
  /** Inclusive end. */
  to: DateStr;
  templates: readonly SessionTemplate[];
  raceDate: DateStr | null;
  override?: PhaseOverride | null;
  logs: readonly LoggedSession[];
}

export interface CompletionResult {
  from: DateStr;
  to: DateStr;
  /** Scheduled strength occurrences in range — the denominator. */
  scheduled: number;
  /** Scheduled occurrences with at least one matching log. */
  completed: number;
  /** Logged sessions in range that match no scheduled occurrence. */
  unplanned: number;
  /** Scheduled occurrences with no log, up to and including today. */
  missed: number;
}

const key = (date: DateStr, sessionKey: string) => `${date}|${sessionKey}`;

/**
 * Count scheduled versus completed strength sessions over an explicit range.
 * `today` bounds `missed`: a session scheduled for next Thursday is not missed.
 */
export function completionOverRange(
  { from, to, templates, raceDate, override = null, logs }: CompletionInput,
  today: DateStr,
): CompletionResult {
  const scheduledKeys = new Set<string>();
  let missed = 0;

  const loggedKeys = new Set(logs.map((l) => key(l.logged_on, l.session_key)));

  for (let d = from; d <= to; d = addDays(d, 1)) {
    for (const s of sessionsFor(d, { raceDate, templates: [...templates], override })) {
      const k = key(d, s.session_key);
      scheduledKeys.add(k);
      if (!loggedKeys.has(k) && d <= today) missed += 1;
    }
  }

  // Deduplicated by construction: a Set of occurrence keys, not a count of logs.
  const inRange = logs.filter((l) => l.logged_on >= from && l.logged_on <= to);
  const matchedKeys = new Set(
    inRange.map((l) => key(l.logged_on, l.session_key)).filter((k) => scheduledKeys.has(k)),
  );
  const unplannedKeys = new Set(
    inRange.map((l) => key(l.logged_on, l.session_key)).filter((k) => !scheduledKeys.has(k)),
  );

  return {
    from,
    to,
    scheduled: scheduledKeys.size,
    completed: matchedKeys.size,
    unplanned: unplannedKeys.size,
    missed,
  };
}

export interface SaunaTally {
  from: DateStr;
  to: DateStr;
  /** Sauna sessions logged in range. Reported alone — never a denominator. */
  logged: number;
}

/**
 * Sauna is counted, not scored. It is optional, so a ratio would frame a
 * deliberate rest day as a failure.
 */
export function saunaTally(
  logs: readonly { logged_on: DateStr }[],
  from: DateStr,
  to: DateStr,
): SaunaTally {
  return {
    from,
    to,
    logged: logs.filter((l) => l.logged_on >= from && l.logged_on <= to).length,
  };
}
