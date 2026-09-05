import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, QueryBoundary } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useRecipes, type Recipe } from '@/data/reference';
import {
  useMealPlan,
  useSetMealPlan,
  useClearMealPlanDay,
  useAddManyToBasket,
  useUserSettings,
} from '@/data/user';
import { formatDate, addDays, dayOfWeek, parseLocalDate } from '@/domain/dates';
import { countByTag, formatTagCount, resolveDietPrefs } from '@/domain/dietPrefs';
import { suggestDinners } from '@/domain/suggestDinners';
import { matchesRecipeSearch } from '@/domain/recipeSearch';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HEAT_ICONS = ['', '🌶', '🌶🌶', '🌶🌶🌶'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const mondayOf = (dateStr: string) => addDays(dateStr, -((dayOfWeek(dateStr) + 6) % 7));

/** One dinner per day; tap a row to pick, fill the gaps, send the week to the
 *  basket. Dinner-only (SPEC §6.5, redesign frame 17). */
export function PlannerPane() {
  const recipes = useRecipes();
  const plan = useMealPlan();
  const setDay = useSetMealPlan();
  const clearDay = useClearMealPlanDay();
  const addToBasket = useAddManyToBasket();
  const settings = useUserSettings();

  // Which day the recipe picker is open for (null = closed).
  const [picking, setPicking] = useState<string | null>(null);
  // The last auto-fill, so it can be undone (FOOD-02).
  const [lastFill, setLastFill] = useState<string[] | null>(null);
  const [fillNote, setFillNote] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<
    { sent: number; failed: number } | null
  >(null);

  /*
   * The visible week lives in the URL (FOOD-02). It used to be pinned to
   * today's Monday with no way to reach next week at all, so a Sunday shop for
   * the week ahead was impossible.
   */
  const [params, setParams] = useSearchParams();
  const today = formatDate(new Date());
  const weekParam = params.get('week');
  const monday = mondayOf(
    weekParam && DATE_RE.test(weekParam) && !Number.isNaN(parseLocalDate(weekParam).getTime())
      ? weekParam
      : today,
  );
  const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  const goWeek = (delta: number) => {
    const next = new URLSearchParams(params);
    next.set('week', addDays(monday, delta * 7));
    setParams(next);
    setLastFill(null);
    setFillNote(null);
  };

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
    <QueryBoundary queries={[recipes, plan, settings]}>
      {([recipeList, planList, userSettings]) => {
        const dinners = recipeList.filter((r) => r.meal_type === 'dinner');
        const bySlug = new Map(recipeList.map((r) => [r.slug, r]));
        const byDate = new Map(planList.map((e) => [e.plan_date, e.recipe_slug]));
        const plannedSlugs = week.map((d) => byDate.get(d)).filter((s): s is string => !!s);

        // D-04: ranges from user settings, defaulting to the reviewed guidance.
        // Reported as a fact; nothing here blocks a manual choice.
        // `diet_prefs` lands with migration 0010; until that is applied the
        // generated row type has no such column, so it is read defensively and
        // falls back to DEFAULT_DIET_PREFS. Remove the cast once types are
        // regenerated.
        const prefs = resolveDietPrefs(
          (userSettings as { diet_prefs?: unknown } | null)?.diet_prefs,
        );
        const tagCounts = countByTag(
          plannedSlugs.map((slug) => bySlug.get(slug)?.diet_tag ?? ''),
          prefs,
        );

        /*
         * Deterministic gap filling (FOOD-02). The old version indexed the
         * recipe list by a character of the date string, so it ignored the
         * counts computed right above it and could repeat a recipe all week.
         */
        const autoFill = () => {
          const assigned: Record<string, string> = {};
          for (const d of week) {
            const slug = byDate.get(d);
            if (slug) assigned[d] = slug;
          }
          const { fill, unfilled } = suggestDinners({
            week,
            assigned,
            candidates: dinners,
            prefs,
          });
          const dates = Object.keys(fill);
          dates.forEach((d) => setDay.mutate({ plan_date: d, recipe_slug: fill[d] }));
          setLastFill(dates.length ? dates : null);
          setFillNote(
            unfilled.length
              ? `${unfilled.length} day${unfilled.length === 1 ? '' : 's'} left empty. ${unfilled[0].reason}`
              : null,
          );
          setSendResult(null);
        };

        /** Undo only the days this fill added — assigned dinners are untouched. */
        const undoFill = () => {
          lastFill?.forEach((d) => clearDay.mutate(d));
          setLastFill(null);
          setFillNote(null);
        };

        /*
         * Sending is one intent per recipe, so a partial failure leaves what
         * landed in place and only the rest needs retrying (FOOD-02).
         */
        const sendToBasket = async () => {
          setSendResult(null);
          const results = await Promise.allSettled(
            plannedSlugs.map((slug) => addToBasket.mutateAsync([slug])),
          );
          const failed = results.filter((r) => r.status === 'rejected').length;
          setSendResult({ sent: results.length - failed, failed });
        };

        return (
          <div className="space-y-3">
            {/* Header: week navigation (FOOD-02) */}
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => goWeek(-1)}
                aria-label="Previous week"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-text-dim transition-colors hover:text-text"
              >
                <Icon name="chevron_left" size={18} />
              </button>
              <div className="min-w-0 flex-1 text-center">
                <h2 className="font-display text-data font-bold leading-tight text-text">Dinners</h2>
                <p className="font-display text-label font-semibold uppercase tracking-label text-text-dim">
                  {rangeLabel}
                </p>
              </div>
              <button
                type="button"
                onClick={() => goWeek(1)}
                aria-label="Next week"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-text-dim transition-colors hover:text-text"
              >
                <Icon name="chevron_right" size={18} />
              </button>
            </div>

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={autoFill}
                disabled={setDay.isPending}
                className="flex shrink-0 items-center gap-1 text-body-sm font-bold text-accent transition-opacity hover:opacity-70 disabled:opacity-50"
              >
                <Icon name="add" size={16} />
                Fill the gaps
              </button>
              {lastFill && (
                <button
                  type="button"
                  onClick={undoFill}
                  className="shrink-0 text-body-sm font-bold text-text-dim transition-colors hover:text-text"
                >
                  Undo fill ({lastFill.length})
                </button>
              )}
            </div>

            {fillNote && (
              <p role="status" className="px-1 text-meta text-warning">
                {fillNote}
              </p>
            )}

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

            {/*
              * Weekly counts against the reviewed ranges (D-04). Stated as a
              * fact: the range shows the floor as well as the ceiling, and
              * nothing here blocks a choice.
              */}
            <p className="px-1 text-meta text-text-dim">
              {tagCounts.map((t, i) => (
                <span key={t.tag}>
                  {i > 0 && ' · '}
                  <span className={t.atMax ? 'text-warning' : t.belowMin ? 'text-text-muted' : ''}>
                    {formatTagCount(t)}
                  </span>
                </span>
              ))}
              {' this week'}
              {tagCounts.some((t) => t.atMax) ? ' — at the gout ceiling.' : '.'}
            </p>

            {/* Send to shopping list, with an honest partial-failure report */}
            <Button
              full
              onClick={() => void sendToBasket()}
              disabled={plannedSlugs.length === 0 || addToBasket.isPending}
            >
              {addToBasket.isPending
                ? 'Sending…'
                : `Send ${plannedSlugs.length} dinner${plannedSlugs.length === 1 ? '' : 's'} to shopping list`}
            </Button>

            {sendResult && (
              <div role="status" className="px-1 text-meta">
                {sendResult.failed === 0 ? (
                  <span className="text-text-dim">
                    {sendResult.sent} dinner{sendResult.sent === 1 ? '' : 's'} sent.{' '}
                    <Link to="/food?pane=shop" className="font-bold text-accent">
                      Open shop
                    </Link>
                  </span>
                ) : (
                  <span className="text-warning">
                    {sendResult.sent} sent, {sendResult.failed} could not be sent and are still
                    queued — they will retry.{' '}
                    <Link to="/food?pane=shop" className="font-bold text-accent">
                      Open shop
                    </Link>
                  </span>
                )}
              </div>
            )}

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
  // Searchable at the point of choosing, not only when browsing (FOOD-01).
  const [query, setQuery] = useState('');
  const shown = dinners.filter((r) =>
    matchesRecipeSearch({ name: r.name, ingredientNames: [] }, query),
  );

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
      <div className="border-b border-border px-4 py-2">
        <label className="block">
          <span className="sr-only">Search dinners</span>
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search dinners…"
            className="min-h-tap w-full rounded-md border border-border bg-surface px-3 text-body-sm text-text placeholder:text-text-dim"
          />
        </label>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-content divide-y divide-border">
          {shown.length === 0 && (
            <p className="px-4 py-3 text-body-sm text-text-dim">
              No dinner matches “{query}”.
            </p>
          )}
          {shown.map((r) => (
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
