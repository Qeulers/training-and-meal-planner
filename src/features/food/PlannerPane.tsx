import { useState } from 'react';
import { Button, QueryBoundary } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useRecipes, type Recipe } from '@/data/reference';
import {
  useMealPlan,
  useSetMealPlan,
  useClearMealPlanDay,
  useAddManyToBasket,
} from '@/data/user';
import { formatDate, addDays, dayOfWeek, parseLocalDate } from '@/domain/dates';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HEAT_ICONS = ['', '🌶', '🌶🌶', '🌶🌶🌶'];

// Gout ceiling (SPEC §7 / FuelPane amber guidance): chicken 1–2×/week, fish
// 2–3×/week. Surfaced as a fact, never a blocking dialog.
const CEILING = { chicken: 2, fish: 2 } as const;

/** One dinner per day for the current week; tap a row to pick, auto-fill the
 *  gaps, send the week to the basket. Dinner-only (SPEC §6.5, redesign frame 17). */
export function PlannerPane() {
  const recipes = useRecipes();
  const plan = useMealPlan();
  const setDay = useSetMealPlan();
  const clearDay = useClearMealPlanDay();
  const addToBasket = useAddManyToBasket();

  // Which day the recipe picker is open for (null = closed).
  const [picking, setPicking] = useState<string | null>(null);

  const today = formatDate(new Date());
  const monday = addDays(today, -((dayOfWeek(today) + 6) % 7));
  const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  const rangeLabel = (() => {
    const s = parseLocalDate(monday);
    const e = parseLocalDate(addDays(monday, 6));
    const sMon = s.toLocaleDateString(undefined, { month: 'short' });
    const eMon = e.toLocaleDateString(undefined, { month: 'short' });
    return s.getMonth() === e.getMonth()
      ? `${DOW[0]} ${s.getDate()} – ${DOW[6]} ${e.getDate()} ${eMon}`
      : `${DOW[0]} ${s.getDate()} ${sMon} – ${DOW[6]} ${e.getDate()} ${eMon}`;
  })();

  return (
    <QueryBoundary queries={[recipes, plan]}>
      {([recipeList, planList]) => {
        const dinners = recipeList.filter((r) => r.meal_type === 'dinner');
        const bySlug = new Map(recipeList.map((r) => [r.slug, r]));
        const byDate = new Map(planList.map((e) => [e.plan_date, e.recipe_slug]));
        const plannedSlugs = week.map((d) => byDate.get(d)).filter((s): s is string => !!s);

        // Gout counters — derived from diet_tag on the week's planned dinners.
        const counts = { chicken: 0, fish: 0 };
        for (const slug of plannedSlugs) {
          const tag = bySlug.get(slug)?.diet_tag;
          if (tag === 'chicken') counts.chicken++;
          else if (tag === 'fish') counts.fish++;
        }
        const atCeiling =
          counts.chicken >= CEILING.chicken || counts.fish >= CEILING.fish;

        const autoFill = () => {
          week.forEach((d, i) => {
            if (byDate.get(d)) return;
            const pick = dinners[(i * 7 + d.charCodeAt(8)) % dinners.length];
            if (pick) setDay.mutate({ plan_date: d, recipe_slug: pick.slug });
          });
        };

        return (
          <div className="space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-display text-data font-bold leading-tight text-text">Dinners</h2>
                <p className="font-display text-label font-semibold uppercase tracking-label text-text-dim">
                  {rangeLabel}
                </p>
              </div>
              <button
                type="button"
                onClick={autoFill}
                className="flex shrink-0 items-center gap-1 text-body-sm font-bold text-accent transition-opacity hover:opacity-70"
              >
                <Icon name="add" size={16} />
                Auto-fill gaps
              </button>
            </div>

            {/* Day rows */}
            <div className="space-y-2">
              {week.map((d) => {
                const slug = byDate.get(d);
                const recipe = slug ? bySlug.get(slug) : undefined;
                const isToday = d === today;
                return (
                  <DayRow
                    key={d}
                    dow={DOW[(dayOfWeek(d) + 6) % 7]}
                    date={parseLocalDate(d).getDate()}
                    isToday={isToday}
                    recipe={recipe}
                    onPick={() => setPicking(d)}
                    onClear={slug ? () => clearDay.mutate(d) : undefined}
                  />
                );
              })}
            </div>

            {/* Gout ceiling fact line */}
            <p className="px-1 text-meta text-text-dim">
              <span className={counts.chicken >= CEILING.chicken ? 'text-warning' : ''}>
                chicken {counts.chicken}/{CEILING.chicken}
              </span>
              {' · '}
              <span className={counts.fish >= CEILING.fish ? 'text-warning' : ''}>
                fish {counts.fish}/{CEILING.fish}
              </span>
              {' this week'}
              {atCeiling ? ' — at the gout ceiling.' : '.'}
            </p>

            {/* Send to shopping list */}
            <Button
              full
              onClick={() => addToBasket.mutate(plannedSlugs)}
              disabled={plannedSlugs.length === 0 || addToBasket.isPending}
            >
              {addToBasket.isPending
                ? 'Sending…'
                : `Send ${plannedSlugs.length} dinner${plannedSlugs.length === 1 ? '' : 's'} to shopping list`}
            </Button>

            {/* Recipe picker overlay */}
            {picking && (
              <RecipePicker
                dinners={dinners}
                onSelect={(recipe_slug) => {
                  setDay.mutate({ plan_date: picking, recipe_slug });
                  setPicking(null);
                }}
                onClose={() => setPicking(null)}
              />
            )}
          </div>
        );
      }}
    </QueryBoundary>
  );
}

/** Recipe meta line: "25 min · veg 🌶🌶". */
function recipeMeta(r: Recipe): string {
  const heat = r.heat_level > 0 ? ` ${HEAT_ICONS[r.heat_level]}` : '';
  return `${r.time_minutes} min · ${r.diet_tag}${heat}`;
}

function DayRow({
  dow,
  date,
  isToday,
  recipe,
  onPick,
  onClear,
}: {
  dow: string;
  date: number;
  isToday: boolean;
  recipe: Recipe | undefined;
  onPick: () => void;
  onClear?: () => void;
}) {
  const stamp = (
    <div className="w-10 shrink-0 text-center">
      <p
        className={`font-display text-label font-semibold uppercase tracking-label ${
          isToday ? 'text-accent' : 'text-text-dim'
        }`}
      >
        {dow}
      </p>
      <p
        className={`font-display text-data font-bold leading-tight ${
          isToday ? 'text-accent' : 'text-text-muted'
        }`}
      >
        {date}
      </p>
    </div>
  );

  // Empty day — dashed tappable slot.
  if (!recipe) {
    return (
      <button
        type="button"
        onClick={onPick}
        className="flex w-full items-center gap-3 rounded-lg border border-dashed border-border bg-surface px-3 py-3 text-left transition-colors hover:border-border-strong"
      >
        {stamp}
        <span className="flex-1 text-body-sm text-text-dim">Tap to plan a dinner</span>
        <Icon name="add" size={18} className="shrink-0 text-text-dim" />
      </button>
    );
  }

  // Planned day.
  return (
    <div
      className={[
        'flex items-center gap-3 rounded-lg border bg-surface px-3 py-3',
        isToday ? 'border-accent' : 'border-border',
      ].join(' ')}
    >
      {stamp}
      <button type="button" onClick={onPick} className="min-w-0 flex-1 text-left">
        <p className="truncate font-display text-body font-bold text-text">{recipe.name}</p>
        <p className="text-meta text-text-dim">{recipeMeta(recipe)}</p>
      </button>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          aria-label={`Clear ${recipe.name}`}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-text-dim transition-colors hover:text-danger"
        >
          <Icon name="close" size={18} />
        </button>
      )}
    </div>
  );
}

function RecipePicker({
  dinners,
  onSelect,
  onClose,
}: {
  dinners: Recipe[];
  onSelect: (slug: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-bg/95 backdrop-blur">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="font-display text-data font-bold text-text">Pick a dinner</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close picker"
          className="flex h-9 w-9 items-center justify-center rounded-md text-text-dim transition-colors hover:text-text"
        >
          <Icon name="close" size={20} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-content divide-y divide-border">
          {dinners.map((r) => (
            <button
              key={r.slug}
              type="button"
              onClick={() => onSelect(r.slug)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-raised"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-body font-bold text-text">{r.name}</p>
                <p className="text-meta text-text-dim">{recipeMeta(r)}</p>
              </div>
              <Icon name="add" size={18} className="shrink-0 text-text-dim" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
