/*
 * Deterministic dinner suggestions (FOOD-02).
 *
 * What this replaces: `dinners[(i * 7 + d.charCodeAt(8)) % dinners.length]`.
 * That indexed into the recipe list using a character of the date string, which
 * meant it ignored the chicken/fish counts computed immediately above it, could
 * pick the same recipe several nights running, and changed its answer if the
 * recipe list was reordered.
 *
 * Rules, in order:
 *   1. Never touch a day that already has a dinner. Auto-fill fills gaps.
 *   2. Never exceed a tag's weekly maximum, counting dinners already assigned.
 *   3. Prefer a tag that is below its minimum — fish has a floor of two a week,
 *      not just a ceiling of three, and only a range can express that.
 *   4. Prefer variety: a recipe not already in the week beats a repeat.
 *   5. Break every remaining tie by `sort_order`, then slug, so the result is
 *      reproducible and independent of the order recipes arrive in.
 *
 * Nothing here is a medical rule and nothing blocks a manual choice: this only
 * decides what to *suggest*. When it cannot fill a day it says why, rather than
 * leaving a silent gap (FOOD-02).
 */
import type { DateStr } from './dates';
import { countByTag, type DietPrefs } from './dietPrefs';

export interface DinnerCandidate {
  slug: string;
  name: string;
  diet_tag: string;
  sort_order: number;
}

export interface SuggestInput {
  /** The week's dates, in order. */
  week: readonly DateStr[];
  /** Dinners already chosen, by date. These are never changed. */
  assigned: Readonly<Record<DateStr, string>>;
  candidates: readonly DinnerCandidate[];
  prefs: DietPrefs;
}

export interface SuggestResult {
  /** New assignments only — dates that already had a dinner are absent. */
  fill: Record<DateStr, string>;
  /** Dates left empty, each with the reason no recipe could be suggested. */
  unfilled: { date: DateStr; reason: string }[];
}

/** Rank candidates for one slot. Lower sorts first. */
function score(
  candidate: DinnerCandidate,
  used: readonly string[],
  tagsSoFar: readonly string[],
  prefs: DietPrefs,
): number | null {
  const range = prefs[candidate.diet_tag];
  const count = tagsSoFar.filter((t) => t === candidate.diet_tag).length;
  // Rule 2: at the weekly maximum, this candidate is out for this slot.
  if (range && count >= range.max) return null;

  const belowMin = range ? count < range.min : false;
  const repeat = used.includes(candidate.slug);
  // Rule 3 outranks rule 4: meeting a floor matters more than variety.
  return (belowMin ? 0 : 2) + (repeat ? 1 : 0);
}

export function suggestDinners({ week, assigned, candidates, prefs }: SuggestInput): SuggestResult {
  const fill: Record<DateStr, string> = {};
  const unfilled: { date: DateStr; reason: string }[] = [];

  const bySlug = new Map(candidates.map((c) => [c.slug, c]));
  // Deterministic order before anything else looks at the list.
  const ordered = [...candidates].sort(
    (a, b) => a.sort_order - b.sort_order || a.slug.localeCompare(b.slug),
  );

  // Running state includes days already assigned, so their tags count.
  const used: string[] = week.map((d) => assigned[d]).filter((s): s is string => !!s);
  const tags: string[] = used.map((slug) => bySlug.get(slug)?.diet_tag ?? '');

  for (const date of week) {
    if (assigned[date]) continue;

    if (ordered.length === 0) {
      unfilled.push({ date, reason: 'No dinner recipes available.' });
      continue;
    }

    let best: { candidate: DinnerCandidate; score: number } | null = null;
    for (const candidate of ordered) {
      const s = score(candidate, used, tags, prefs);
      if (s == null) continue;
      if (!best || s < best.score) best = { candidate, score: s };
    }

    if (!best) {
      // Every candidate is at its weekly maximum. Name which, so the message is
      // actionable rather than a shrug.
      const blocked = countByTag(tags, prefs)
        .filter((t) => t.atMax)
        .map((t) => `${t.tag} (${t.count}/${t.range.max})`)
        .join(', ');
      unfilled.push({
        date,
        reason: blocked
          ? `Every remaining recipe is at its weekly limit: ${blocked}.`
          : 'No suitable dinner found.',
      });
      continue;
    }

    fill[date] = best.candidate.slug;
    used.push(best.candidate.slug);
    tags.push(best.candidate.diet_tag);
  }

  return { fill, unfilled };
}
