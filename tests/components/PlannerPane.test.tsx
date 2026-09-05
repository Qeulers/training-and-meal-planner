/*
 * Planner week navigation, gap filling and send reporting (FOOD-02).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { loaded } from './fixtures';

const setDayMutate = vi.fn();
const clearDayMutate = vi.fn();
const addManyAsync = vi.fn(async (_slugs: string[]) => undefined);
let planRows: { plan_date: string; recipe_slug: string }[] = [];

const RECIPES = [
  { slug: 'salmon', name: 'Salmon', meal_type: 'dinner', diet_tag: 'fish', sort_order: 1, time_minutes: 25, heat_level: 0 },
  { slug: 'whitefish', name: 'White fish', meal_type: 'dinner', diet_tag: 'fish', sort_order: 2, time_minutes: 20, heat_level: 0 },
  { slug: 'roast', name: 'Roast chicken', meal_type: 'dinner', diet_tag: 'chicken', sort_order: 3, time_minutes: 60, heat_level: 0 },
  { slug: 'dahl', name: 'Tarka dahl', meal_type: 'dinner', diet_tag: 'veg', sort_order: 4, time_minutes: 30, heat_level: 1 },
  { slug: 'tofu', name: 'Crispy tofu', meal_type: 'dinner', diet_tag: 'veg', sort_order: 5, time_minutes: 25, heat_level: 2 },
  { slug: 'paneer', name: 'Paneer curry', meal_type: 'dinner', diet_tag: 'veg', sort_order: 6, time_minutes: 35, heat_level: 2 },
  { slug: 'porridge', name: 'Porridge', meal_type: 'breakfast', diet_tag: 'veg', sort_order: 7, time_minutes: 5, heat_level: 0 },
];

vi.mock('@/data/reference', () => ({ useRecipes: () => loaded(RECIPES) }));

vi.mock('@/data/user', () => ({
  useMealPlan: () => loaded(planRows),
  useSetMealPlan: () => ({ mutate: setDayMutate, isPending: false }),
  useClearMealPlanDay: () => ({ mutate: clearDayMutate, isPending: false }),
  useAddManyToBasket: () => ({ mutateAsync: addManyAsync, mutate: vi.fn(), isPending: false }),
  useUserSettings: () => loaded(null),
}));

import { PlannerPane } from '@/features/food/PlannerPane';

function Probe() {
  return <span data-testid="loc">{useLocation().search}</span>;
}

const renderPlanner = (search = '') =>
  render(
    <MemoryRouter initialEntries={[`/food${search}`]}>
      <Routes>
        <Route
          path="/food"
          element={
            <>
              <PlannerPane />
              <Probe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );

const params = () => new URLSearchParams(screen.getByTestId('loc').textContent ?? '');

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  // A Tuesday. Its Monday is 2027-01-04.
  vi.setSystemTime(new Date('2027-01-05T12:00:00'));
  planRows = [];
  setDayMutate.mockClear();
  clearDayMutate.mockClear();
  addManyAsync.mockClear();
  addManyAsync.mockResolvedValue(undefined);
});

describe('PlannerPane — week navigation (FOOD-02)', () => {
  it('opens on the current week', () => {
    renderPlanner();
    expect(screen.getByText(/Mon 4/)).toBeInTheDocument();
  });

  it('moves to the next week and records it in the URL', async () => {
    const user = userEvent.setup();
    renderPlanner();

    await user.click(screen.getByRole('button', { name: /next week/i }));

    expect(params().get('week')).toBe('2027-01-11');
    expect(screen.getByText(/Mon 11/)).toBeInTheDocument();
  });

  it('moves to the previous week', async () => {
    const user = userEvent.setup();
    renderPlanner('?week=2027-01-11');

    await user.click(screen.getByRole('button', { name: /previous week/i }));

    expect(params().get('week')).toBe('2027-01-04');
  });

  it('restores the week from the URL, and normalises a mid-week date to its Monday', () => {
    renderPlanner('?week=2027-01-14');
    expect(screen.getByText(/Mon 11/)).toBeInTheDocument();
  });

  it('falls back to this week on a nonsense date rather than rendering NaN', () => {
    renderPlanner('?week=not-a-date');
    expect(screen.getByText(/Mon 4/)).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });
});

describe('PlannerPane — filling gaps (FOOD-02)', () => {
  it('fills every empty day without repeating a recipe unnecessarily', async () => {
    const user = userEvent.setup();
    renderPlanner();

    await user.click(screen.getByRole('button', { name: /fill the gaps/i }));

    expect(setDayMutate).toHaveBeenCalledTimes(7);
    const slugs = setDayMutate.mock.calls.map((c) => c[0].recipe_slug);
    expect(new Set(slugs).size).toBe(6); // six dinner recipes, one repeat
  });

  it('never suggests a non-dinner recipe', async () => {
    const user = userEvent.setup();
    renderPlanner();
    await user.click(screen.getByRole('button', { name: /fill the gaps/i }));

    expect(setDayMutate.mock.calls.map((c) => c[0].recipe_slug)).not.toContain('porridge');
  });

  it('leaves an already-planned day alone', async () => {
    planRows = [{ plan_date: '2027-01-06', recipe_slug: 'dahl' }];
    const user = userEvent.setup();
    renderPlanner();

    await user.click(screen.getByRole('button', { name: /fill the gaps/i }));

    const dates = setDayMutate.mock.calls.map((c) => c[0].plan_date);
    expect(dates).not.toContain('2027-01-06');
    expect(dates).toHaveLength(6);
  });

  it('respects the weekly maximum, counting what is already planned', async () => {
    planRows = [
      { plan_date: '2027-01-04', recipe_slug: 'roast' },
      { plan_date: '2027-01-05', recipe_slug: 'salmon' },
    ];
    const user = userEvent.setup();
    renderPlanner();
    await user.click(screen.getByRole('button', { name: /fill the gaps/i }));

    const added = setDayMutate.mock.calls.map((c) => c[0].recipe_slug);
    // chicken max is 2 and one is already planned, so at most one more.
    expect(added.filter((s) => s === 'roast').length).toBeLessThanOrEqual(1);
  });

  it('undoes only the days it filled', async () => {
    planRows = [{ plan_date: '2027-01-06', recipe_slug: 'dahl' }];
    const user = userEvent.setup();
    renderPlanner();

    await user.click(screen.getByRole('button', { name: /fill the gaps/i }));
    await user.click(screen.getByRole('button', { name: /undo fill/i }));

    const cleared = clearDayMutate.mock.calls.map((c) => c[0]);
    expect(cleared).toHaveLength(6);
    expect(cleared).not.toContain('2027-01-06'); // the pre-existing dinner survives
  });

  it('offers no undo before anything has been filled', () => {
    renderPlanner();
    expect(screen.queryByRole('button', { name: /undo fill/i })).not.toBeInTheDocument();
  });
});

describe('PlannerPane — the counter states the range, not a bare cap (D-04)', () => {
  it('shows fish out of 2–3, matching the guidance on the Fuel tab', () => {
    planRows = [{ plan_date: '2027-01-04', recipe_slug: 'salmon' }];
    renderPlanner();
    // Previously this read "fish 1/2", one portion below the reviewed guidance.
    expect(screen.getByText(/fish 1\/2–3/)).toBeInTheDocument();
  });

  it('shows chicken out of 1–2', () => {
    renderPlanner();
    expect(screen.getByText(/chicken 0\/1–2/)).toBeInTheDocument();
  });
});

describe('PlannerPane — sending to the shopping list (FOOD-02)', () => {
  it('sends one intent per dinner, so a partial failure is recoverable', async () => {
    planRows = [
      { plan_date: '2027-01-04', recipe_slug: 'salmon' },
      { plan_date: '2027-01-05', recipe_slug: 'dahl' },
    ];
    const user = userEvent.setup();
    renderPlanner();

    await user.click(screen.getByRole('button', { name: /send 2 dinners/i }));

    await waitFor(() => expect(addManyAsync).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('status')).toHaveTextContent(/2 dinners sent/i);
    expect(screen.getByRole('link', { name: /open shop/i })).toBeInTheDocument();
  });

  it('reports a partial failure honestly instead of claiming success', async () => {
    planRows = [
      { plan_date: '2027-01-04', recipe_slug: 'salmon' },
      { plan_date: '2027-01-05', recipe_slug: 'dahl' },
    ];
    addManyAsync.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    renderPlanner();

    await user.click(screen.getByRole('button', { name: /send 2 dinners/i }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/1 sent, 1 could not be sent/i),
    );
  });

  it('cannot be sent when the week is empty', () => {
    renderPlanner();
    expect(screen.getByRole('button', { name: /send 0 dinners/i })).toBeDisabled();
  });
});
