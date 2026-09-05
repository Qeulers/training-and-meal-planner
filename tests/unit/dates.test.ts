import { describe, it, expect } from 'vitest';
import {
  parseLocalDate,
  formatDate,
  addDays,
  addMonths,
  addYears,
  dayOfWeek,
  daysBetween,
} from '@/domain/dates';

describe('date helpers — local-midday anchoring (SPEC §7)', () => {
  it('parses at local midday, not UTC midnight', () => {
    const d = parseLocalDate('2027-07-30');
    expect(d.getHours()).toBe(12);
    expect(d.getFullYear()).toBe(2027);
    expect(d.getMonth()).toBe(6); // July
    expect(d.getDate()).toBe(30);
  });

  it('round-trips through formatDate', () => {
    expect(formatDate(parseLocalDate('2026-01-05'))).toBe('2026-01-05');
    expect(formatDate(parseLocalDate('2027-12-31'))).toBe('2027-12-31');
  });

  it('addDays crosses month and year boundaries', () => {
    expect(addDays('2027-01-31', 1)).toBe('2027-02-01');
    expect(addDays('2027-12-31', 1)).toBe('2028-01-01');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
  });

  it('addDays is DST-safe (spring forward, US + EU)', () => {
    expect(addDays('2027-03-13', 1)).toBe('2027-03-14');
    expect(addDays('2027-03-14', 1)).toBe('2027-03-15');
    expect(addDays('2027-03-27', 1)).toBe('2027-03-28');
  });

  it('dayOfWeek uses 0=Sunday…6=Saturday', () => {
    expect(dayOfWeek('2027-06-06')).toBe(0); // Sunday
    expect(dayOfWeek('2027-06-01')).toBe(2); // Tuesday
    expect(dayOfWeek('2027-07-31')).toBe(6); // Saturday
  });

  it('daysBetween returns signed whole-day difference', () => {
    expect(daysBetween('2027-07-14', '2027-07-27')).toBe(13);
    expect(daysBetween('2027-07-30', '2027-07-30')).toBe(0);
    expect(daysBetween('2027-07-30', '2027-07-28')).toBe(-2);
  });
});

describe('addMonths / addYears — calendar stepping (CAL-01)', () => {
  // [start, n, expected]
  const MONTHS: [string, number, string][] = [
    // Month-end clamping — the bug that made "next" from 31 Jan land in March.
    ['2027-01-31', 1, '2027-02-28'],
    ['2027-01-31', 2, '2027-03-31'],
    ['2027-03-31', -1, '2027-02-28'],
    ['2027-05-31', 1, '2027-06-30'],
    ['2028-01-31', 1, '2028-02-29'], // leap year clamps to 29, not 28
    ['2028-03-31', -1, '2028-02-29'],
    // Ordinary steps keep the day.
    ['2027-06-15', 1, '2027-07-15'],
    ['2027-06-15', -1, '2027-05-15'],
    // December <-> January.
    ['2027-12-15', 1, '2028-01-15'],
    ['2028-01-15', -1, '2027-12-15'],
    ['2027-12-31', 1, '2028-01-31'],
    ['2027-01-01', -1, '2026-12-01'],
    // Multi-year spans.
    ['2027-06-15', 12, '2028-06-15'],
    ['2027-06-15', -18, '2025-12-15'],
    ['2027-06-15', 0, '2027-06-15'],
  ];

  it.each(MONTHS)('addMonths(%s, %i) === %s', (start, n, expected) => {
    expect(addMonths(start, n)).toBe(expected);
  });

  it('is reversible except where clamping loses the day', () => {
    expect(addMonths(addMonths('2027-06-15', 1), -1)).toBe('2027-06-15');
    // 31 Jan -> 28 Feb -> 28 Jan: clamping is lossy by design, not a bug.
    expect(addMonths(addMonths('2027-01-31', 1), -1)).toBe('2027-01-28');
  });

  const YEARS: [string, number, string][] = [
    ['2028-02-29', 1, '2029-02-28'], // leap day clamps
    ['2028-02-29', -1, '2027-02-28'],
    ['2028-02-29', 4, '2032-02-29'], // back onto a leap year
    ['2027-07-30', 1, '2028-07-30'],
    ['2027-07-30', -2, '2025-07-30'],
    ['2027-12-31', 1, '2028-12-31'],
    ['2027-07-30', 0, '2027-07-30'],
  ];

  it.each(YEARS)('addYears(%s, %i) === %s', (start, n, expected) => {
    expect(addYears(start, n)).toBe(expected);
  });

  it('keeps local-midday anchoring across DST boundaries', () => {
    // Stepping into and out of DST must not shift the day (EU + US transitions).
    expect(addMonths('2027-02-28', 1)).toBe('2027-03-28');
    expect(addMonths('2027-04-14', -1)).toBe('2027-03-14');
    expect(addMonths('2027-10-31', 1)).toBe('2027-11-30');
    expect(addMonths('2027-11-07', -1)).toBe('2027-10-07');
    expect(parseLocalDate(addMonths('2027-03-14', 0)).getHours()).toBe(12);
  });
});
