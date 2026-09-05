/*
 * Calendar navigation (CAL-01 / CAL-A).
 *
 * The reference and user data hooks are mocked at the module boundary: this
 * exercises the page's own routing, stepping and interaction, not Supabase.
 * The fixtures put a strength session on every Tuesday and a sauna slot on
 * every Thursday, so any rendered month has both kinds of marker.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import {
  loaded,
  dayLabel,
  PHASES,
  TEMPLATES,
  SAUNA_SCHEDULE,
  SAUNA_TYPES,
  EXERCISES,
  SESSION_ITEMS,
} from './fixtures';

vi.mock('@/data/reference', () => ({
  usePhases: () => loaded(PHASES),
  useSessionTemplates: () => loaded(TEMPLATES),
  useSessionItems: () => loaded(SESSION_ITEMS),
  useSaunaSchedule: () => loaded(SAUNA_SCHEDULE),
  useSaunaTypes: () => loaded(SAUNA_TYPES),
  useExercises: () => loaded(EXERCISES),
}));

vi.mock('@/data/user', () => ({
  useRaces: () => loaded([]),
  useUserSettings: () => loaded(null),
  useWorkoutLogs: () => loaded([]),
  useSaunaLogs: () => loaded([]),
}));

// The logger pulls in wake-lock and timers; the calendar tests never open it.
vi.mock('@/features/today/WorkoutLogger', () => ({ WorkoutLogger: () => null }));

import { CalendarPage } from '@/features/calendar/CalendarPage';

function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="loc">{loc.pathname + loc.search}</output>;
}

function renderCalendar(initialEntry = '/calendar?view=month&anchor=2027-01-31&day=2027-01-31') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/calendar"
          element={
            <>
              <CalendarPage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const search = () => new URLSearchParams(screen.getByTestId('loc').textContent!.split('?')[1]);

// Anchor "today" so `formatDate(new Date())` is stable across runs.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2027-01-15T12:00:00'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('CalendarPage — stepping (CAL-01)', () => {
  it('steps a month at a time, clamping the day', async () => {
    const user = userEvent.setup();
    renderCalendar('/calendar?view=month&anchor=2027-01-31&day=2027-01-31');

    await user.click(screen.getByRole('button', { name: /next/i }));

    // 2027-01-31 + 30 days was 2027-03-02. A calendar month is 2027-02-28.
    expect(search().get('anchor')).toBe('2027-02-28');
    expect(screen.getByRole('heading', { level: 1, name: /February 2027/i })).toBeInTheDocument();
  });

  it('steps a year at a time, clamping a leap day', async () => {
    const user = userEvent.setup();
    renderCalendar('/calendar?view=year&anchor=2028-02-29&day=2028-02-29');

    await user.click(screen.getByRole('button', { name: /next/i }));

    expect(search().get('anchor')).toBe('2029-02-28');
  });

  it('steps a week at a time in week view', async () => {
    const user = userEvent.setup();
    renderCalendar('/calendar?view=week&anchor=2027-01-31&day=2027-01-31');

    await user.click(screen.getByRole('button', { name: /next/i }));
    expect(search().get('anchor')).toBe('2027-02-07');

    await user.click(screen.getByRole('button', { name: /prev/i }));
    expect(search().get('anchor')).toBe('2027-01-31');
  });

  it('reverses a month step back to where it started', async () => {
    const user = userEvent.setup();
    renderCalendar('/calendar?view=month&anchor=2027-06-15&day=2027-06-15');

    await user.click(screen.getByRole('button', { name: /next/i }));
    expect(search().get('anchor')).toBe('2027-07-15');
    await user.click(screen.getByRole('button', { name: /prev/i }));
    expect(search().get('anchor')).toBe('2027-06-15');
  });
});

describe('CalendarPage — URL state (CAL-A)', () => {
  it('restores view and selected day from the URL on mount', () => {
    renderCalendar('/calendar?view=month&anchor=2027-03-10&day=2027-03-10');
    expect(screen.getByRole('heading', { level: 1, name: /March 2027/i })).toBeInTheDocument();
  });

  it('falls back to today rather than rendering an invalid date', () => {
    renderCalendar('/calendar?view=month&anchor=not-a-date&day=2027-13-99');
    expect(screen.getByRole('heading', { level: 1, name: /January 2027/i })).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it('ignores an unknown view instead of blanking the page', () => {
    renderCalendar('/calendar?view=decade&anchor=2027-03-10&day=2027-03-10');
    // Week is the default; its heading is a date range, not a month name.
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });
});

describe('CalendarPage — month grid is operable (CAL-01 / A11Y-01)', () => {
  it('names the selected day as selected, rather than mislabelling it a toggle', () => {
    renderCalendar('/calendar?view=month&anchor=2027-01-15&day=2027-01-05');
    const cell = screen.getByRole('button', { name: new RegExp(dayLabel('2027-01-05')) });
    expect(cell).toHaveAccessibleName(/selected$/i);
    expect(cell).not.toHaveAttribute('aria-pressed');
  });

  it('exposes each day as a button labelled with its date and activity', () => {
    renderCalendar('/calendar?view=month&anchor=2027-01-15&day=2027-01-15');

    // Tuesday 5 January 2027 carries a scheduled strength session.
    const cell = screen.getByRole('button', { name: new RegExp(dayLabel('2027-01-05')) });
    expect(cell).toHaveAccessibleName(/strength scheduled/i);

    // Wednesday has neither, and says so rather than being silently blank.
    expect(
      screen.getByRole('button', { name: new RegExp(dayLabel('2027-01-06')) }),
    ).toHaveAccessibleName(/nothing scheduled/i);
  });

  it('opens the selected day in week view when a month cell is activated', async () => {
    const user = userEvent.setup();
    renderCalendar('/calendar?view=month&anchor=2027-01-15&day=2027-01-15');

    await user.click(screen.getByRole('button', { name: new RegExp(dayLabel('2027-01-05')) }));

    const params = search();
    expect(params.get('view')).toBe('week');
    expect(params.get('day')).toBe('2027-01-05');
    expect(params.get('anchor')).toBe('2027-01-05');
  });

  it('is reachable and activatable from the keyboard alone', async () => {
    const user = userEvent.setup();
    renderCalendar('/calendar?view=month&anchor=2027-01-15&day=2027-01-15');

    const cell = screen.getByRole('button', { name: new RegExp(dayLabel('2027-01-05')) });
    cell.focus();
    expect(cell).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(search().get('day')).toBe('2027-01-05');
  });

  it('distinguishes completed from scheduled without relying on colour', () => {
    renderCalendar('/calendar?view=month&anchor=2027-01-15&day=2027-01-15');

    const scheduled = screen.getByRole('button', { name: new RegExp(dayLabel('2027-01-05')) });
    // Outlined marker: stroked, not filled.
    const marker = scheduled.querySelector('rect')!;
    expect(marker).toHaveAttribute('stroke', 'currentColor');
    expect(marker).toHaveAttribute('fill', 'none');

    // ...and the state is spelled out in the accessible name too.
    expect(scheduled).toHaveAccessibleName(/strength scheduled/i);

    const legend = screen.getByText(/solid = done/i);
    expect(legend).toBeInTheDocument();
  });

  it('marks a logged session as completed, in shape and in words', async () => {
    vi.resetModules();
    vi.doMock('@/data/user', () => ({
      useRaces: () => loaded([]),
      useUserSettings: () => loaded(null),
      useWorkoutLogs: () =>
        loaded([
          {
            id: 'l1',
            user_id: 'u1',
            logged_on: '2027-01-05',
            session_key: 'strength_a',
            session_name: 'Strength A',
            phase_slug: 'p1',
            notes: null,
          },
        ]),
      useSaunaLogs: () => loaded([]),
    }));
    const { CalendarPage: Fresh } = await import('@/features/calendar/CalendarPage');
    render(
      <MemoryRouter initialEntries={['/calendar?view=month&anchor=2027-01-15&day=2027-01-15']}>
        <Routes>
          <Route path="/calendar" element={<Fresh />} />
        </Routes>
      </MemoryRouter>,
    );

    const cell = screen.getAllByRole('button', { name: new RegExp(dayLabel('2027-01-05')) })[0];
    expect(cell).toHaveAccessibleName(/strength completed/i);
    expect(within(cell).getByText('5')).toBeInTheDocument();
    expect(cell.querySelector('rect')).toHaveAttribute('fill', 'currentColor');
  });
});
