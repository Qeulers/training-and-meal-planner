/*
 * Planned-versus-completed denominators (STAT-01). The rules being asserted are
 * stated in src/domain/completion.ts — this is where they are held to.
 */
import { describe, it, expect } from 'vitest';
import { completionOverRange, saunaTally } from '@/domain/completion';
import type { SessionTemplate } from '@/domain/schedule';

// Tuesday(2) and Thursday(4) strength. With no target race `autoPhase` returns
// 'p4' — the general block — so the templates are keyed to that phase.
const TEMPLATES: SessionTemplate[] = [
  {
    slug: 'p4_tue', phase_slug: 'p4', session_key: 'lower_a', name: 'Lower A',
    day_of_week: 2, duration_label: '~55 min', brief: null, sort_order: 1,
  },
  {
    slug: 'p4_thu', phase_slug: 'p4', session_key: 'upper_a', name: 'Upper A',
    day_of_week: 4, duration_label: '~45 min', brief: null, sort_order: 2,
  },
];

// Mon 4 Jan 2027 – Sun 10 Jan 2027: one Tuesday (5th), one Thursday (7th).
const FROM = '2027-01-04';
const TO = '2027-01-10';
const TODAY = '2027-01-10';

const run = (logs: { logged_on: string; session_key: string }[], today = TODAY) =>
  completionOverRange(
    { from: FROM, to: TO, templates: TEMPLATES, raceDate: null, logs },
    today,
  );

describe('completionOverRange — the denominator is scheduled occurrences', () => {
  it('counts one occurrence per scheduled (date, session)', () => {
    expect(run([]).scheduled).toBe(2);
  });

  it('reports the range it used, so the figure can be read honestly', () => {
    expect(run([])).toMatchObject({ from: FROM, to: TO });
  });

  it('counts a completed session against its occurrence', () => {
    const out = run([{ logged_on: '2027-01-05', session_key: 'lower_a' }]);
    expect(out).toMatchObject({ scheduled: 2, completed: 1, missed: 1, unplanned: 0 });
  });

  it('reaches full completion when everything scheduled was done', () => {
    const out = run([
      { logged_on: '2027-01-05', session_key: 'lower_a' },
      { logged_on: '2027-01-07', session_key: 'upper_a' },
    ]);
    expect(out).toMatchObject({ scheduled: 2, completed: 2, missed: 0 });
  });
});

describe('completionOverRange — deduplication', () => {
  it('counts a doubly-logged session once, so completion cannot exceed 100%', () => {
    const out = run([
      { logged_on: '2027-01-05', session_key: 'lower_a' },
      { logged_on: '2027-01-05', session_key: 'lower_a' },
    ]);
    expect(out.completed).toBe(1);
    expect(out.completed).toBeLessThanOrEqual(out.scheduled);
  });
});

describe('completionOverRange — unplanned sessions are separate', () => {
  it('does not let an extra session inflate completion', () => {
    const out = run([{ logged_on: '2027-01-06', session_key: 'lower_a' }]); // a Wednesday
    expect(out).toMatchObject({ scheduled: 2, completed: 0, unplanned: 1, missed: 2 });
  });

  it('counts a session carried over to another day as unplanned, not completed', () => {
    // Calendar carryover records as today, so a Tuesday session done Saturday
    // lands on a date the schedule knows nothing about.
    const out = run([{ logged_on: '2027-01-09', session_key: 'lower_a' }]);
    expect(out.completed).toBe(0);
    expect(out.unplanned).toBe(1);
  });

  it('ignores logs outside the range entirely', () => {
    const out = run([
      { logged_on: '2026-12-29', session_key: 'lower_a' },
      { logged_on: '2027-01-13', session_key: 'upper_a' },
    ]);
    expect(out).toMatchObject({ completed: 0, unplanned: 0 });
  });
});

describe('completionOverRange — the future is not missed', () => {
  it('does not count a session scheduled after today as missed', () => {
    // Mid-week: Tuesday has passed, Thursday has not.
    const out = run([], '2027-01-06');
    expect(out).toMatchObject({ scheduled: 2, missed: 1 });
  });

  it('counts nothing as missed at the very start of the range', () => {
    expect(run([], '2027-01-04').missed).toBe(0);
  });
});

describe('completionOverRange — edge cases', () => {
  it('handles a range with nothing scheduled', () => {
    const out = completionOverRange(
      { from: '2027-01-11', to: '2027-01-11', templates: TEMPLATES, raceDate: null, logs: [] },
      '2027-01-11',
    );
    // A Monday: no strength scheduled.
    expect(out).toMatchObject({ scheduled: 0, completed: 0, missed: 0 });
  });

  it('handles a single-day range', () => {
    const out = completionOverRange(
      {
        from: '2027-01-05', to: '2027-01-05', templates: TEMPLATES, raceDate: null,
        logs: [{ logged_on: '2027-01-05', session_key: 'lower_a' }],
      },
      '2027-01-05',
    );
    expect(out).toMatchObject({ scheduled: 1, completed: 1 });
  });

  it('handles no templates at all', () => {
    const out = completionOverRange(
      { from: FROM, to: TO, templates: [], raceDate: null, logs: [] },
      TODAY,
    );
    expect(out.scheduled).toBe(0);
  });
});

describe('saunaTally — counted, never scored', () => {
  it('counts sessions in range', () => {
    const out = saunaTally(
      [
        { logged_on: '2027-01-05' },
        { logged_on: '2027-01-07' },
        { logged_on: '2027-02-01' },
      ],
      FROM,
      TO,
    );
    expect(out).toEqual({ from: FROM, to: TO, logged: 2 });
  });

  it('reports zero without implying failure — there is no denominator', () => {
    const out = saunaTally([], FROM, TO);
    expect(out.logged).toBe(0);
    expect(Object.keys(out)).not.toContain('scheduled');
  });
});
