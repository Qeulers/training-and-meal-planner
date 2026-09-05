/*
 * Date helpers — the whole app anchors dates at LOCAL MIDDAY.
 *
 * `new Date('2027-07-30T12:00:00')` sidesteps DST/timezone drift: parsing a bare
 * date string as UTC midnight can roll back a day in negative offsets, which
 * silently shifts phase boundaries. Every date operation in the domain goes
 * through here. Ported verbatim from the legacy app (index.html).
 *
 * Dates are represented as `YYYY-MM-DD` strings throughout the domain layer.
 */

export type DateStr = string; // 'YYYY-MM-DD'

/** Parse a `YYYY-MM-DD` string to a Date anchored at local midday. */
export function parseLocalDate(dateStr: DateStr): Date {
  return new Date(dateStr + 'T12:00:00');
}

/** Format a Date back to a `YYYY-MM-DD` string (local components). */
export function formatDate(d: Date): DateStr {
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

/** Add `n` days (may be negative) to a date string, returning a date string. */
export function addDays(dateStr: DateStr, n: number): DateStr {
  const d = parseLocalDate(dateStr);
  d.setDate(d.getDate() + n);
  return formatDate(d);
}

/**
 * Day of week, `0 = Sunday … 6 = Saturday` (JavaScript `Date.getDay()`).
 * Load-bearing across scheduling and seed data — do NOT switch to ISO.
 */
export function dayOfWeek(dateStr: DateStr): number {
  return parseLocalDate(dateStr).getDay();
}

/** Whole-day difference `b - a` (positive when b is later). */
export function daysBetween(a: DateStr, b: DateStr): number {
  return Math.round(
    (parseLocalDate(b).getTime() - parseLocalDate(a).getTime()) / 86_400_000,
  );
}

/**
 * Add `n` calendar months (may be negative), clamping to the destination
 * month's last day: 2027-01-31 + 1 month is 2027-02-28, not 2027-03-02.
 *
 * `Date.setMonth` overflows instead of clamping, so the day is set to 1 first
 * and restored afterwards against the real length of the target month.
 */
export function addMonths(dateStr: DateStr, n: number): DateStr {
  const d = parseLocalDate(dateStr);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  // Day 0 of the following month = the last day of this one.
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return formatDate(d);
}

/** Add `n` calendar years (may be negative). 29 Feb clamps to 28 Feb. */
export function addYears(dateStr: DateStr, n: number): DateStr {
  return addMonths(dateStr, n * 12);
}
