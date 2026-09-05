/*
 * Retry pacing for outbox replay (REL-02). "Bounded" means two things: each
 * delay is capped, and the number of retries is finite — an operation that has
 * failed eight times is not going to succeed on the ninth, and leaving it
 * silently spinning is worse than showing the user an actionable failure.
 *
 * Full jitter (a uniform pick from [0, window]) rather than a fixed doubling:
 * with several intents draining together, fixed delays make them all wake up
 * and retry in lockstep.
 */
export interface BackoffOptions {
  baseMs?: number;
  capMs?: number;
  /** Injectable for deterministic tests. */
  random?: () => number;
}

export const DEFAULT_BASE_MS = 1_000;
export const DEFAULT_CAP_MS = 5 * 60_000;
/** Attempts after which an intent is dead-lettered for the user to decide on. */
export const MAX_ATTEMPTS = 8;

/** Delay before attempt number `attempts + 1`. `attempts` is 0-based. */
export function backoffMs(attempts: number, options: BackoffOptions = {}): number {
  const { baseMs = DEFAULT_BASE_MS, capMs = DEFAULT_CAP_MS, random = Math.random } = options;
  const exponent = Math.max(0, Math.min(attempts, 31));
  const window = Math.min(capMs, baseMs * 2 ** exponent);
  return Math.round(random() * window);
}
