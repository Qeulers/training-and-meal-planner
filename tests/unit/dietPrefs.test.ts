import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DIET_PREFS,
  countByTag,
  formatTagCount,
  resolveDietPrefs,
} from '@/domain/dietPrefs';

describe('DEFAULT_DIET_PREFS — resolves the two-screen contradiction (D-04)', () => {
  it('matches the reviewed guidance: chicken 1–2, fish 2–3', () => {
    // The planner previously hard-coded fish max 2 and displayed "fish 2/2",
    // one portion below the guidance shown on the Fuel tab.
    expect(DEFAULT_DIET_PREFS).toEqual({
      chicken: { min: 1, max: 2 },
      fish: { min: 2, max: 3 },
    });
  });
});

describe('resolveDietPrefs', () => {
  it('falls back to the defaults when nothing is stored', () => {
    expect(resolveDietPrefs(null)).toEqual(DEFAULT_DIET_PREFS);
    expect(resolveDietPrefs(undefined)).toEqual(DEFAULT_DIET_PREFS);
    expect(resolveDietPrefs('nonsense')).toEqual(DEFAULT_DIET_PREFS);
  });

  it('overrides only the tags that are stored', () => {
    const out = resolveDietPrefs({ fish: { min: 1, max: 1 } });
    expect(out.fish).toEqual({ min: 1, max: 1 });
    expect(out.chicken).toEqual({ min: 1, max: 2 });
  });

  it('accepts a new tag', () => {
    expect(resolveDietPrefs({ beef: { min: 0, max: 1 } }).beef).toEqual({ min: 0, max: 1 });
  });

  it('ignores malformed entries rather than throwing', () => {
    // A bad stored preference must not break the planner.
    for (const bad of [
      { fish: 'lots' },
      { fish: { min: 'a', max: 2 } },
      { fish: { min: 3, max: 1 } },
      { fish: { min: -1, max: 2 } },
      { fish: { min: 1 } },
      { fish: { min: Number.NaN, max: 2 } },
    ]) {
      expect(resolveDietPrefs(bad).fish).toEqual(DEFAULT_DIET_PREFS.fish);
    }
  });
});

describe('countByTag', () => {
  it('counts a week and reports position within the range', () => {
    const out = countByTag(['fish', 'fish', 'chicken', 'veg'], DEFAULT_DIET_PREFS);
    const fish = out.find((t) => t.tag === 'fish')!;
    const chicken = out.find((t) => t.tag === 'chicken')!;

    expect(fish).toMatchObject({ count: 2, atMax: false, belowMin: false });
    expect(chicken).toMatchObject({ count: 1, atMax: false, belowMin: false });
  });

  it('flags below the floor, which a bare ceiling could not express', () => {
    const fish = countByTag(['chicken'], DEFAULT_DIET_PREFS).find((t) => t.tag === 'fish')!;
    expect(fish).toMatchObject({ count: 0, belowMin: true, atMax: false });
  });

  it('flags at and beyond the maximum', () => {
    const three = countByTag(['fish', 'fish', 'fish'], DEFAULT_DIET_PREFS);
    expect(three.find((t) => t.tag === 'fish')).toMatchObject({ count: 3, atMax: true });
    const four = countByTag(['fish', 'fish', 'fish', 'fish'], DEFAULT_DIET_PREFS);
    expect(four.find((t) => t.tag === 'fish')).toMatchObject({ count: 4, atMax: true });
  });

  it('ignores tags with no preference', () => {
    expect(countByTag(['veg', 'veg'], DEFAULT_DIET_PREFS).map((t) => t.tag).sort()).toEqual([
      'chicken',
      'fish',
    ]);
  });
});

describe('formatTagCount — states the range, not just a cap', () => {
  it('shows a range', () => {
    const fish = countByTag(['fish', 'fish'], DEFAULT_DIET_PREFS).find((t) => t.tag === 'fish')!;
    expect(formatTagCount(fish)).toBe('fish 2/2–3');
  });

  it('collapses a range whose ends are equal', () => {
    const [only] = countByTag(['x'], { x: { min: 2, max: 2 } });
    expect(formatTagCount(only)).toBe('x 1/2');
  });
});
