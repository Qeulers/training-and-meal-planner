/*
 * Sauna log input validation (WORK-03).
 *
 * Every detail field is optional — one-tap logging with nothing filled in stays
 * the common case. But a field that IS filled in must be a real number, because
 * `Number('')`, `Number('abc')` and `Number('12kg')` gave 0, NaN and NaN
 * respectively, and all three reached the database silently.
 *
 * The constraints are physical, not medical: a duration must be positive
 * because a zero-minute sauna is not a sauna, and a bodyweight must be positive
 * because mass is. Temperature is only required to be finite — capping it would
 * be an arbitrary bound, which the spec rules out, and °C is signed anyway.
 *
 * Nothing here judges whether a session was sensible. That is not the app's job.
 */

export interface SaunaLogInput {
  duration_min: string;
  temp_c: string;
  weight_before_kg: string;
  weight_after_kg: string;
}

export type SaunaField = keyof SaunaLogInput;

export interface SaunaLogValues {
  duration_min: number | null;
  temp_c: number | null;
  weight_before_kg: number | null;
  weight_after_kg: number | null;
}

export type SaunaFieldErrors = Partial<Record<SaunaField, string>>;

export interface SaunaParseResult {
  /** Null when any field failed; never partially applied. */
  values: SaunaLogValues | null;
  errors: SaunaFieldErrors;
}

type Rule = { label: string; positive: boolean };

const RULES: Record<SaunaField, Rule> = {
  duration_min: { label: 'Duration', positive: true },
  temp_c: { label: 'Temperature', positive: false },
  weight_before_kg: { label: 'Weight before', positive: true },
  weight_after_kg: { label: 'Weight after', positive: true },
};

const FIELDS = Object.keys(RULES) as SaunaField[];

/**
 * Parse the form's raw strings. A blank field is omitted, not zero — the
 * difference between "I did not weigh myself" and "I weighed nothing".
 */
export function parseSaunaLog(input: Partial<SaunaLogInput>): SaunaParseResult {
  const errors: SaunaFieldErrors = {};
  const values = {} as SaunaLogValues;

  for (const field of FIELDS) {
    const raw = (input[field] ?? '').trim();
    if (raw === '') {
      values[field] = null;
      continue;
    }
    const rule = RULES[field];
    // Number() accepts whitespace and some surprising forms; require a plain
    // decimal so "12kg" and "1e5" are rejected rather than quietly coerced.
    const n = /^-?\d*\.?\d+$/.test(raw) ? Number(raw) : Number.NaN;
    if (!Number.isFinite(n)) {
      errors[field] = `${rule.label} must be a number.`;
      continue;
    }
    if (rule.positive && n <= 0) {
      errors[field] = `${rule.label} must be greater than zero.`;
      continue;
    }
    values[field] = n;
  }

  return { values: Object.keys(errors).length ? null : values, errors };
}
