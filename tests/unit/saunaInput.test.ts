import { describe, it, expect } from 'vitest';
import { parseSaunaLog } from '@/domain/saunaInput';

const ok = (input: Parameters<typeof parseSaunaLog>[0]) => parseSaunaLog(input);

describe('parseSaunaLog — optional fields (WORK-03)', () => {
  it('accepts an entirely blank form: one-tap logging stays the common case', () => {
    const { values, errors } = ok({});
    expect(errors).toEqual({});
    expect(values).toEqual({
      duration_min: null,
      temp_c: null,
      weight_before_kg: null,
      weight_after_kg: null,
    });
  });

  it('treats a blank field as absent, not as zero', () => {
    // "I did not weigh myself" is not "I weighed nothing" — Number('') gave 0.
    const { values } = ok({ duration_min: '20', weight_before_kg: '' });
    expect(values?.weight_before_kg).toBeNull();
    expect(values?.duration_min).toBe(20);
  });

  it('ignores surrounding whitespace', () => {
    expect(ok({ duration_min: '  20  ' }).values?.duration_min).toBe(20);
    expect(ok({ temp_c: ' ' }).values?.temp_c).toBeNull();
  });

  it('accepts decimals', () => {
    expect(ok({ weight_before_kg: '78.4' }).values?.weight_before_kg).toBe(78.4);
  });
});

describe('parseSaunaLog — rejects what used to reach the database', () => {
  it('rejects non-numeric text instead of storing NaN', () => {
    const { values, errors } = ok({ duration_min: 'twenty' });
    expect(values).toBeNull();
    expect(errors.duration_min).toMatch(/must be a number/i);
  });

  it('rejects a number with a unit stuck to it', () => {
    expect(ok({ weight_before_kg: '78kg' }).errors.weight_before_kg).toBeDefined();
  });

  it('rejects exponent notation, which is never a real entry here', () => {
    expect(ok({ duration_min: '1e5' }).errors.duration_min).toBeDefined();
  });

  it('rejects Infinity', () => {
    expect(ok({ temp_c: 'Infinity' }).errors.temp_c).toBeDefined();
  });
});

describe('parseSaunaLog — physical constraints, not medical ones', () => {
  it('rejects a zero or negative duration', () => {
    expect(ok({ duration_min: '0' }).errors.duration_min).toMatch(/greater than zero/i);
    expect(ok({ duration_min: '-5' }).errors.duration_min).toMatch(/greater than zero/i);
  });

  it('rejects a zero or negative bodyweight', () => {
    expect(ok({ weight_before_kg: '0' }).errors.weight_before_kg).toBeDefined();
    expect(ok({ weight_after_kg: '-1' }).errors.weight_after_kg).toBeDefined();
  });

  it('allows a negative temperature — °C is signed, and a cap would be arbitrary', () => {
    expect(ok({ temp_c: '-10' }).errors).toEqual({});
    expect(ok({ temp_c: '-10' }).values?.temp_c).toBe(-10);
  });

  it('imposes no upper bound on anything', () => {
    // Deliberately absurd but physically expressible: not the app's business.
    const { errors } = ok({ duration_min: '600', temp_c: '150', weight_before_kg: '300' });
    expect(errors).toEqual({});
  });

  it('does not judge weight gained across a session', () => {
    const { errors } = ok({ weight_before_kg: '78', weight_after_kg: '79' });
    expect(errors).toEqual({});
  });
});

describe('parseSaunaLog — all-or-nothing', () => {
  it('returns no values at all when any field is invalid', () => {
    const { values, errors } = ok({ duration_min: '20', temp_c: 'hot' });
    expect(values).toBeNull(); // never partially applied
    expect(errors.temp_c).toBeDefined();
    expect(errors.duration_min).toBeUndefined();
  });

  it('reports every invalid field at once, not just the first', () => {
    const { errors } = ok({ duration_min: 'x', temp_c: 'y', weight_before_kg: '-1' });
    expect(Object.keys(errors).sort()).toEqual(['duration_min', 'temp_c', 'weight_before_kg']);
  });
});
