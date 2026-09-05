import { describe, it, expect } from 'vitest';
import { suggestDinners, type DinnerCandidate } from '@/domain/suggestDinners';
import { DEFAULT_DIET_PREFS } from '@/domain/dietPrefs';

const WEEK = [
  '2027-01-04',
  '2027-01-05',
  '2027-01-06',
  '2027-01-07',
  '2027-01-08',
  '2027-01-09',
  '2027-01-10',
];

const c = (slug: string, diet_tag: string, sort_order: number): DinnerCandidate => ({
  slug,
  name: slug,
  diet_tag,
  sort_order,
});

const VEG = [c('dahl', 'veg', 1), c('tofu', 'veg', 2), c('paneer', 'veg', 3)];
const MIXED = [
  c('salmon', 'fish', 1),
  c('whitefish', 'fish', 2),
  c('teriyaki', 'fish', 3),
  c('lemongrass', 'chicken', 4),
  c('roast', 'chicken', 5),
  ...VEG.map((v, i) => c(v.slug, 'veg', 6 + i)),
];

const run = (over: Partial<Parameters<typeof suggestDinners>[0]> = {}) =>
  suggestDinners({
    week: WEEK,
    assigned: {},
    candidates: MIXED,
    prefs: DEFAULT_DIET_PREFS,
    ...over,
  });

describe('suggestDinners — preserves what is already there (FOOD-02)', () => {
  it('never changes or re-emits an assigned day', () => {
    const assigned = { '2027-01-05': 'roast', '2027-01-08': 'dahl' };
    const { fill } = run({ assigned });

    expect(fill['2027-01-05']).toBeUndefined();
    expect(fill['2027-01-08']).toBeUndefined();
    expect(Object.keys(fill).sort()).toEqual(
      WEEK.filter((d) => !(d in assigned)).sort(),
    );
  });

  it('counts assigned days towards the weekly limits', () => {
    // Two chicken already assigned puts chicken at its max of 2.
    const assigned = { '2027-01-04': 'roast', '2027-01-05': 'lemongrass' };
    const { fill } = run({ assigned });
    const chosen = Object.values(fill);
    const chickenAdded = chosen.filter((s) => ['roast', 'lemongrass'].includes(s));
    expect(chickenAdded).toEqual([]);
  });
});

describe('suggestDinners — respects the weekly ranges', () => {
  it('never exceeds a maximum', () => {
    const { fill } = run();
    const tagOf = (slug: string) => MIXED.find((m) => m.slug === slug)!.diet_tag;
    const tags = Object.values(fill).map(tagOf);
    expect(tags.filter((t) => t === 'fish').length).toBeLessThanOrEqual(3);
    expect(tags.filter((t) => t === 'chicken').length).toBeLessThanOrEqual(2);
  });

  it('meets a floor before optimising for variety', () => {
    // Fish has a minimum of two, so a week starting empty must get fish first.
    const { fill } = run();
    const first = fill[WEEK[0]];
    expect(MIXED.find((m) => m.slug === first)!.diet_tag).toBe('fish');
  });

  it('fills the whole week when the candidate pool allows it', () => {
    const { fill, unfilled } = run();
    expect(Object.keys(fill)).toHaveLength(7);
    expect(unfilled).toEqual([]);
  });

  it('honours a user-narrowed preference', () => {
    const { fill } = run({ prefs: { fish: { min: 0, max: 0 } } });
    const tags = Object.values(fill).map((s) => MIXED.find((m) => m.slug === s)!.diet_tag);
    expect(tags).not.toContain('fish');
  });
});

describe('suggestDinners — variety and determinism', () => {
  it('prefers a recipe not already in the week', () => {
    const { fill } = run({ candidates: VEG, prefs: {} });
    const chosen = WEEK.map((d) => fill[d]);
    // Three candidates over seven nights: the first three are all distinct.
    expect(new Set(chosen.slice(0, 3)).size).toBe(3);
  });

  it('repeats only once every candidate has been used', () => {
    const { fill, unfilled } = run({ candidates: VEG, prefs: {} });
    expect(unfilled).toEqual([]);
    expect(Object.keys(fill)).toHaveLength(7);
  });

  it('gives the same answer however the candidates are ordered', () => {
    const forwards = run();
    const backwards = run({ candidates: [...MIXED].reverse() });
    expect(forwards).toEqual(backwards);
  });

  it('is stable across repeated calls', () => {
    expect(run()).toEqual(run());
  });
});

describe('suggestDinners — explains an empty candidate set (FOOD-02)', () => {
  it('says so when there are no dinner recipes at all', () => {
    const { fill, unfilled } = run({ candidates: [] });
    expect(fill).toEqual({});
    expect(unfilled).toHaveLength(7);
    expect(unfilled[0].reason).toMatch(/no dinner recipes/i);
  });

  it('names the limit that blocked a day, rather than shrugging', () => {
    // Only fish exists, capped at 3, so nights four onwards cannot be filled.
    const { fill, unfilled } = run({
      candidates: MIXED.filter((m) => m.diet_tag === 'fish'),
    });

    expect(Object.keys(fill)).toHaveLength(3);
    expect(unfilled).toHaveLength(4);
    expect(unfilled[0].reason).toMatch(/weekly limit/i);
    expect(unfilled[0].reason).toMatch(/fish \(3\/3\)/);
  });

  it('leaves an unfillable day genuinely empty rather than guessing', () => {
    const { fill } = run({ candidates: MIXED.filter((m) => m.diet_tag === 'fish') });
    expect(fill[WEEK[3]]).toBeUndefined();
  });
});
