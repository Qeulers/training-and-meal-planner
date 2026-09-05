/*
 * Weekly dietary preferences (decision D-04).
 *
 * Two screens disagreed. Food -> Fuel states the reviewed guidance — chicken
 * 1-2 portions a week, fish 2-3 — while the planner hard-coded
 * `{ chicken: 2, fish: 2 }` and displayed "fish 2/2", claiming a ceiling one
 * portion lower than the guidance on the next tab. Both now read from here.
 *
 * These are PREFERENCES, used to order suggestions and to state a count. They
 * are not medical limits and they never block a manual choice: the app reports
 * what the week looks like and leaves the decision to the person.
 *
 * A range, not a single number, because "2-3 fish meals" is the actual
 * guidance and flattening it to a cap loses the fact that two is a floor.
 */

export interface DietRange {
  min: number;
  max: number;
}

/** Keyed by `recipes.diet_tag`. Tags with no entry are unconstrained. */
export type DietPrefs = Record<string, DietRange>;

/** Mirrors the reviewed guidance in FuelPane and the 0010 column default. */
export const DEFAULT_DIET_PREFS: DietPrefs = {
  chicken: { min: 1, max: 2 },
  fish: { min: 2, max: 3 },
};

/** Read stored preferences, falling back to the defaults for anything absent. */
export function resolveDietPrefs(stored: unknown): DietPrefs {
  const out: DietPrefs = { ...DEFAULT_DIET_PREFS };
  if (!stored || typeof stored !== 'object') return out;
  for (const [tag, value] of Object.entries(stored as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const { min, max } = value as { min?: unknown; max?: unknown };
    // Ignore anything malformed rather than throwing: a bad stored preference
    // must not break the planner.
    if (typeof min !== 'number' || typeof max !== 'number') continue;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min) continue;
    out[tag] = { min, max };
  }
  return out;
}

export interface TagCount {
  tag: string;
  count: number;
  range: DietRange;
  /** At or above the top of the range. */
  atMax: boolean;
  /** Below the bottom of the range — relevant for fish, which has a floor. */
  belowMin: boolean;
}

/** Count the week's meals per constrained tag. */
export function countByTag(tags: readonly string[], prefs: DietPrefs): TagCount[] {
  return Object.entries(prefs).map(([tag, range]) => {
    const count = tags.filter((t) => t === tag).length;
    return {
      tag,
      count,
      range,
      atMax: count >= range.max,
      belowMin: count < range.min,
    };
  });
}

/** "chicken 2/1–2" — states the range, so the floor is not hidden. */
export function formatTagCount({ tag, count, range }: TagCount): string {
  const target = range.min === range.max ? `${range.max}` : `${range.min}–${range.max}`;
  return `${tag} ${count}/${target}`;
}
