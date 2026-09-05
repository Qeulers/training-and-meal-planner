import { describe, it, expect } from 'vitest';
import { classifyError } from '@/data/classifyError';

describe('classifyError — an expired session is not a failure', () => {
  it('parks on 401/403', () => {
    expect(classifyError({ status: 401, message: 'Unauthorized' }).kind).toBe('auth');
    expect(classifyError({ status: 403, message: 'Forbidden' }).kind).toBe('auth');
  });

  it('parks on PostgREST JWT errors', () => {
    expect(classifyError({ code: 'PGRST301', message: 'JWT expired' }).kind).toBe('auth');
    expect(classifyError({ message: 'JWT expired' }).kind).toBe('auth');
  });

  it('parks on the insufficient-privilege code the RPCs raise when signed out', () => {
    expect(classifyError({ code: '42501', message: 'not authenticated' }).kind).toBe('auth');
  });
});

describe('classifyError — transient versus permanent', () => {
  it('retries network failures', () => {
    expect(classifyError(new TypeError('Failed to fetch')).kind).toBe('retry');
    expect(classifyError({ message: 'NetworkError when attempting to fetch' }).kind).toBe('retry');
  });

  it('retries 5xx, timeouts and rate limits', () => {
    for (const status of [500, 502, 503, 408, 429]) {
      expect(classifyError({ status, message: 'server' }).kind).toBe('retry');
    }
  });

  it('dead-letters constraint violations, which retrying cannot fix', () => {
    const out = classifyError({ code: '23505', message: 'races_one_target' });
    expect(out.kind).toBe('permanent');
    expect(out.kind === 'permanent' && out.error).toContain('races_one_target');
  });

  it('dead-letters bad input', () => {
    expect(classifyError({ code: '22023', message: 'must be non-negative' }).kind).toBe('permanent');
  });

  it('dead-letters other 4xx', () => {
    expect(classifyError({ status: 404, message: 'no function' }).kind).toBe('permanent');
  });

  it('retries the unrecognised, rather than discarding work on a guess', () => {
    expect(classifyError({ message: 'something odd' }).kind).toBe('retry');
    expect(classifyError(undefined).kind).toBe('retry');
  });
});
