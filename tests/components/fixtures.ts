/*
 * Fixtures for component tests. Deliberately minimal — just enough reference
 * and user data to drive a screen — and shaped like the real rows so a schema
 * drift shows up as a type error here first.
 */
import type { SessionTemplate } from '@/domain/schedule';
import type { SaunaScheduleRow } from '@/domain/sauna';

/** A fake `useQuery` result that QueryBoundary treats as loaded. */
export const loaded = <T,>(data: T) =>
  ({ data, isPending: false, isError: false, isSuccess: true, error: null }) as never;

export const PHASES = [
  { slug: 'p1', short_label: 'P1', name: 'Base', sort_order: 1 },
  { slug: 'p2', short_label: 'P2', name: 'Build', sort_order: 2 },
  { slug: 'p3', short_label: 'P3', name: 'Peak', sort_order: 3 },
  { slug: 'recovery', short_label: 'Rec', name: 'Recovery', sort_order: 4 },
  { slug: 'p4', short_label: 'P4', name: 'Taper', sort_order: 5 },
];

/** Tuesday (2) strength session in every phase, so any week has one. */
export const TEMPLATES: SessionTemplate[] = PHASES.map((p, i) => ({
  slug: `${p.slug}_tue`,
  phase_slug: p.slug,
  session_key: 'strength_a',
  name: 'Strength A',
  day_of_week: 2,
  duration_label: '~55 min',
  brief: null,
  sort_order: i,
}));

/** Thursday (4) sauna slot in every phase. */
export const SAUNA_SCHEDULE: SaunaScheduleRow[] = PHASES.map((p, i) => ({
  phase_slug: p.slug,
  slot_key: `${p.slug}_thu`,
  day_of_week: 4,
  sauna_type_slug: 'finnish',
  is_optional: false,
  note: null,
  sort_order: i,
}));

export const SAUNA_TYPES = [
  { slug: 'finnish', name: 'Finnish', short_label: 'Finnish', protocol: '15 min', sort_order: 1 },
];

export const EXERCISES: unknown[] = [];
export const SESSION_ITEMS: unknown[] = [];

/**
 * The date half of a month cell's accessible name, built with the same
 * formatter the component uses — the app formats in the *viewer's* locale, so
 * hardcoding "5 January 2027" would make these tests fail outside en-GB.
 */
export const dayLabel = (dateStr: string): string =>
  new Date(dateStr + 'T12:00:00').toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
