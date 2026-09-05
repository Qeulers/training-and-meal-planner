/*
 * Maps a Supabase/PostgREST failure onto the outbox's retry policy
 * (sync contract §4). Kept out of `src/data/local` so the outbox stays free of
 * backend specifics and testable on its own.
 *
 * The distinction that matters most is `auth` versus `permanent`. An expired
 * session is not a failure — the work is fine, it just cannot be sent until the
 * user signs in again. Treating it as permanent would dead-letter a whole
 * queue of good writes and tell the user their work was lost.
 */
import type { SendOutcome } from './local/outbox';

interface MaybePostgrestError {
  code?: string;
  status?: number;
  message?: string;
  name?: string;
}

/** Postgres classes that cannot succeed on retry, whatever we do. */
const PERMANENT_PG_CLASSES = [
  '22', // data exception — bad input
  '23', // integrity constraint violation
  '42', // syntax / access rule violation
];

const AUTH_CODES = new Set(['PGRST301', '42501']);

export function classifyError(error: unknown): SendOutcome {
  const err = (error ?? {}) as MaybePostgrestError;
  const message = err.message ?? String(error);
  const code = err.code ?? '';
  const status = err.status ?? 0;

  // Session expired or RLS refused. Park; do not consume a retry.
  if (status === 401 || status === 403 || AUTH_CODES.has(code) || /jwt|token/i.test(message)) {
    return { kind: 'auth', error: message };
  }

  // The browser could not reach the server at all.
  if (err.name === 'TypeError' || /failed to fetch|networkerror|load failed/i.test(message)) {
    return { kind: 'retry', error: message };
  }

  if (status >= 500 || status === 408 || status === 429) {
    return { kind: 'retry', error: message };
  }

  if (code && PERMANENT_PG_CLASSES.includes(code.slice(0, 2))) {
    return { kind: 'permanent', error: `${code}: ${message}` };
  }

  if (status >= 400 && status < 500) {
    return { kind: 'permanent', error: message };
  }

  // Unrecognised. Retry rather than dead-letter: a bounded retry that ends in a
  // visible failure is recoverable, whereas discarding work is not.
  return { kind: 'retry', error: message };
}
