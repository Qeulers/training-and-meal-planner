/*
 * Accessible chart inspection, honest labels, drilldown and stated
 * denominators (STAT-01).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { loaded } from './fixtures';

let logs: unknown[] = [];
let sets: unknown[] = [];
let saunaLogs: unknown[] = [];

const TEMPLATES = [
  {
    slug: 'p4_tue', phase_slug: 'p4', session_key: 'lower_a', name: 'Lower A',
    day_of_week: 2, duration_label: '~55 min', brief: null, sort_order: 1,
  },
];
const EXERCISES = [
  { slug: 'backsquat', name: 'Back squat' },
  { slug: 'plank', name: 'Plank' },
];
const PHASES = [{ slug: 'p4', short_label: 'P4', name: 'General', sort_order: 5 }];

vi.mock('@/data/reference', () => ({
  useExercises: () => loaded(EXERCISES),
  usePhases: () => loaded(PHASES),
  useSessionTemplates: () => loaded(TEMPLATES),
}));

vi.mock('@/data/user', () => ({
  useWorkoutLogs: () => loaded(logs),
  useAllSets: () => loaded(sets),
  useSaunaLogs: () => loaded(saunaLogs),
  useRaces: () => loaded([]),
  useUserSettings: () => loaded(null),
}));

import { StatsPage } from '@/features/stats/StatsPage';

const log = (id: string, on: string, name = 'Lower A', notes: string | null = null) => ({
  id, user_id: 'u1', logged_on: on, session_key: 'lower_a', session_name: name,
  phase_slug: 'p4', notes,
});
const set = (
  logId: string, slug: string, no: number, weight: number, reps: number, on: string,
) => ({
  id: `${logId}-${slug}-${no}`, workout_log_id: logId, exercise_slug: slug, set_no: no,
  weight_kg: weight, reps, logged_on: on, log_created_at: `${on}T09:00:00Z`,
});

const renderStats = () => render(<MemoryRouter><StatsPage /></MemoryRouter>);

/**
 * Built with the same formatter the component uses: the app formats in the
 * viewer's locale, so hardcoding "5 Jan" fails outside en-GB.
 */
const shortDate = (d: string) =>
  new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2027-01-12T12:00:00'));
  logs = [];
  sets = [];
  saunaLogs = [];
});

describe('StatsPage — empty state', () => {
  it('explains what will appear rather than showing empty charts', () => {
    renderStats();
    expect(screen.getByText(/nothing logged yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /tonnage/i })).not.toBeInTheDocument();
  });
});

describe('StatsPage — the chart is inspectable by touch and keyboard', () => {
  beforeEach(() => {
    logs = [log('l1', '2027-01-05'), log('l2', '2027-01-12', 'Upper A')];
    sets = [
      set('l1', 'backsquat', 1, 80, 5, '2027-01-05'),
      set('l2', 'backsquat', 1, 90, 3, '2027-01-12'),
    ];
  });

  it('exposes each bar as a button carrying its own figures', () => {
    renderStats();
    // Previously these numbers lived in a `title` attribute: pointer-only.
    const bar = screen.getByRole('button', { name: new RegExp(`Lower A, ${shortDate('2027-01-05')}: 400 kg total`) });
    expect(bar).toBeInTheDocument();
  });

  it("shows the selected session's figures as text", async () => {
    const user = userEvent.setup();
    renderStats();

    await user.click(screen.getByRole('button', { name: /Lower A.*400 kg total/i }));

    const chart = screen.getByRole('group', { name: /tonnage/i }).parentElement!;
    expect(chart).toHaveTextContent('400 kg');
    expect(chart).toHaveTextContent('Lower A');
  });

  it('is reachable and selectable from the keyboard alone', async () => {
    const user = userEvent.setup();
    renderStats();

    const bar = screen.getByRole('button', { name: /Lower A.*400 kg total/i });
    bar.focus();
    expect(bar).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(bar).toHaveAttribute('aria-pressed', 'true');
  });

  it('explains that a taper reduces tonnage by design', () => {
    renderStats();
    expect(screen.getByText(/expect this to fall during the taper/i)).toBeInTheDocument();
  });
});

describe('StatsPage — honest labels', () => {
  beforeEach(() => {
    logs = [log('l1', '2027-01-05')];
    sets = [
      set('l1', 'backsquat', 1, 80, 5, '2027-01-05'),
      set('l1', 'backsquat', 2, 95, 3, '2027-01-05'),
    ];
  });

  it('calls it the heaviest logged set, not a personal best', () => {
    renderStats();
    expect(screen.getByText(/heaviest logged set/i)).toBeInTheDocument();
    expect(screen.queryByText(/personal best/i)).not.toBeInTheDocument();
  });

  it('disclaims any estimate of capability', () => {
    renderStats();
    expect(
      screen.getByText(/not a tested max or an estimate of what you could lift/i),
    ).toBeInTheDocument();
  });

  it('reports the heaviest set with its date', () => {
    renderStats();
    expect(screen.getByText(/95 kg/)).toBeInTheDocument();
  });
});

describe('StatsPage — zero-load sets are counted, not dropped', () => {
  it('reports unloaded work by reps instead of omitting it', () => {
    logs = [log('l1', '2027-01-05')];
    sets = [set('l1', 'plank', 1, 0, 30, '2027-01-05')];
    renderStats();

    expect(screen.getByText(/bodyweight & unloaded work/i)).toBeInTheDocument();
    expect(screen.getByText(/30 reps across 1 session/i)).toBeInTheDocument();
    // It has no meaningful "heaviest", so it must not appear there.
    expect(screen.queryByText(/heaviest logged set/i)).not.toBeInTheDocument();
  });
});

describe('StatsPage — read-only drilldown (D-05)', () => {
  beforeEach(() => {
    logs = [log('l1', '2027-01-05', 'Lower A', 'Left knee grumbled on set 3.')];
    sets = [
      set('l1', 'backsquat', 1, 80, 5, '2027-01-05'),
      set('l1', 'backsquat', 2, 80, 5, '2027-01-05'),
    ];
  });

  it('starts collapsed', () => {
    renderStats();
    const row = screen.getByRole('button', { expanded: false });
    expect(row).toBeInTheDocument();
  });

  it('reveals the recorded sets and notes, and reconciles to the total', async () => {
    const user = userEvent.setup();
    renderStats();

    await user.click(screen.getByRole('button', { expanded: false }));

    expect(screen.getByText(/80×5\s+80×5/)).toBeInTheDocument();
    expect(screen.getByText(/left knee grumbled/i)).toBeInTheDocument();
    // 80*5 + 80*5 = 800, matching the row's tonnage.
    expect(screen.getAllByText(/800 kg/).length).toBeGreaterThan(0);
  });

  it('offers no way to edit or delete history', async () => {
    const user = userEvent.setup();
    renderStats();
    await user.click(screen.getByRole('button', { expanded: false }));

    expect(screen.queryByRole('button', { name: /edit|delete|remove/i })).not.toBeInTheDocument();
  });

  it('says so when a session was saved with no sets', async () => {
    sets = [];
    const user = userEvent.setup();
    renderStats();
    await user.click(screen.getByRole('button', { expanded: false }));

    expect(screen.getByText(/saved without any sets/i)).toBeInTheDocument();
  });
});

describe('StatsPage — planned versus completed states its denominator', () => {
  it('names the count, the range and the deduplication rule', () => {
    logs = [log('l1', '2027-01-05')];
    sets = [set('l1', 'backsquat', 1, 80, 5, '2027-01-05')];
    renderStats();

    // Tuesdays only, over a 28-day window ending 12 Jan: 4 occurrences.
    expect(screen.getByText(/of 4 scheduled sessions/i)).toBeInTheDocument();
    expect(screen.getByText(/counts each scheduled session once/i)).toBeInTheDocument();
  });

  it('reports sauna separately and says why it is not scored', () => {
    logs = [log('l1', '2027-01-05')];
    saunaLogs = [{ id: 's1', logged_on: '2027-01-06', sauna_type_slug: 'recov' }];
    renderStats();

    expect(screen.getByText(/sauna is not counted here/i)).toBeInTheDocument();
    expect(screen.getByText(/1 sauna session logged/i)).toBeInTheDocument();
  });

  it('counts a session logged off-schedule as extra, not as completed', () => {
    // A Saturday: nothing is scheduled then.
    logs = [log('l1', '2027-01-09')];
    renderStats();

    expect(screen.getByText(/0 of 4 scheduled sessions/i)).toBeInTheDocument();
    expect(screen.getByText(/1 extra session logged outside the schedule/i)).toBeInTheDocument();
  });
});

describe('StatsPage — history grouping and sauna log', () => {
  it('groups sessions by month', () => {
    logs = [log('l1', '2027-01-05'), log('l2', '2026-12-29')];
    renderStats();

    expect(screen.getByText(/January 2027 · 1 session/i)).toBeInTheDocument();
    expect(screen.getByText(/December 2026 · 1 session/i)).toBeInTheDocument();
  });

  it('lists sauna history with its detail, and the weight lost', () => {
    logs = [log('l1', '2027-01-05')];
    saunaLogs = [
      {
        id: 's1', logged_on: '2027-01-06', sauna_type_slug: 'recov',
        duration_min: 18, temp_c: 78, weight_before_kg: 78.5, weight_after_kg: 77.9,
      },
    ];
    renderStats();

    const section = screen.getByText(/sauna history/i).closest('section')!;
    expect(within(section).getByText(/18 min · 78 °C · 0\.6 kg lost/)).toBeInTheDocument();
  });

  it('says when no sauna has been logged', () => {
    logs = [log('l1', '2027-01-05')];
    renderStats();
    expect(screen.getByText(/no sauna sessions logged yet/i)).toBeInTheDocument();
  });
});
