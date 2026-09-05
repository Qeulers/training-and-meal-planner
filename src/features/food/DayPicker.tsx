/*
 * Dinner-only day picker (FOOD-01).
 *
 * `RecipesPane` already rendered a "Plan for a day" button but was never given
 * a handler, so it did nothing. This is what it now opens.
 *
 * Dinner-only by design (SPEC §6.5): the planner assigns one dinner per day and
 * nothing else, so offering breakfast or lunch slots here would imply a feature
 * the rest of the app does not have.
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useRecipes } from '@/data/reference';
import { useMealPlan, useSetMealPlan } from '@/data/user';
import { addDays, formatDate, parseLocalDate } from '@/domain/dates';

/** Two weeks from today, so "next Tuesday" is reachable without paging. */
const HORIZON_DAYS = 14;

export function DayPicker({
  recipeSlug,
  onClose,
  onPlanned,
}: {
  recipeSlug: string;
  onClose: () => void;
  onPlanned: (date: string) => void;
}) {
  const recipes = useRecipes();
  const plan = useMealPlan();
  const setDay = useSetMealPlan();
  const [error, setError] = useState<unknown>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnTo.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector('button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      returnTo.current?.focus();
    };
  }, [onClose]);

  const recipe = recipes.data?.find((r) => r.slug === recipeSlug);
  const byDate = new Map((plan.data ?? []).map((e) => [e.plan_date, e.recipe_slug]));
  const bySlug = new Map((recipes.data ?? []).map((r) => [r.slug, r]));

  const today = formatDate(new Date());
  const days = Array.from({ length: HORIZON_DAYS }, (_, i) => addDays(today, i));

  const choose = async (date: string) => {
    setError(null);
    try {
      await setDay.mutateAsync({ plan_date: date, recipe_slug: recipeSlug });
      onPlanned(date);
    } catch (err) {
      // The intent could not be stored, so nothing is planned. Say so.
      setError(err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-bg/80 backdrop-blur sm:items-center sm:p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="daypicker-title"
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-t-lg border border-border bg-surface sm:rounded-lg"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <h2 id="daypicker-title" className="font-display text-data font-bold text-text">
              Plan a dinner
            </h2>
            <p className="mt-1 truncate text-body-sm text-text-muted">
              {recipe?.name ?? recipeSlug}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close day picker"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-text-dim transition-colors hover:text-text"
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <ul className="divide-y divide-border">
            {days.map((date) => {
              const takenSlug = byDate.get(date);
              const taken = takenSlug ? bySlug.get(takenSlug) : undefined;
              const label = parseLocalDate(date).toLocaleDateString(undefined, {
                weekday: 'long',
                day: 'numeric',
                month: 'short',
              });
              return (
                <li key={date}>
                  <button
                    type="button"
                    onClick={() => void choose(date)}
                    disabled={setDay.isPending}
                    // The existing dinner is named in the label, so replacing
                    // one is a deliberate act rather than a surprise.
                    aria-label={
                      taken
                        ? `${label} — replace ${taken.name}`
                        : `${label} — currently free`
                    }
                    className="flex min-h-tap w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-raised disabled:opacity-50"
                  >
                    <span className="w-28 shrink-0 text-body-sm text-text">
                      {label}
                      {date === today && (
                        <span className="ml-1 text-meta text-accent">today</span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-meta text-text-dim">
                      {taken ? `replaces ${taken.name}` : 'free'}
                    </span>
                    <Icon name="chevron_right" size={16} className="shrink-0 text-text-dim" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {error != null && (
          <p role="alert" className="border-t border-border px-4 py-2 text-body-sm text-danger">
            Could not plan that day. Nothing was changed — try again.
          </p>
        )}

        <div className="border-t border-border p-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
