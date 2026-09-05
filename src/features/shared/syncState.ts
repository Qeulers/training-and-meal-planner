/*
 * Sync status — the pure part (REL-05).
 *
 * The sidebar used to render a hardcoded "Synced", which is the exact failure
 * mode SPEC §3.2 calls out: silent divergence. The rule here is that "Synced"
 * is earned — it requires a successful server exchange AND nothing pending or
 * failed. Every other state names itself in words, so meaning never rests on
 * the colour of the dot alone (A11Y-01).
 *
 * Kept free of React and of storage so the whole state machine is unit-testable;
 * `useSyncStatus` supplies the inputs.
 */

export type SyncKind =
  | 'needs-auth'
  | 'offline'
  | 'failed'
  | 'syncing'
  | 'pending'
  | 'synced'
  | 'unknown';

export interface SyncInputs {
  /** `navigator.onLine`. Note this reports link state, not server reachability. */
  online: boolean;
  /** False once the session has expired and writes can no longer be authorised. */
  authed: boolean;
  /** In-flight queries + mutations. */
  activeRequests: number;
  /** Outbox intents awaiting replay. Always 0 until the outbox lands (slice 2). */
  pending: number;
  /** Dead-lettered intents needing a user decision. */
  failed: number;
  /** Epoch ms of the last successful server exchange, or null if there has been none. */
  lastSyncAt: number | null;
}

export type SyncTone = 'ok' | 'busy' | 'warn' | 'danger';

export interface SyncState {
  kind: SyncKind;
  tone: SyncTone;
  /** Short status text. Carries the meaning on its own — never colour-only. */
  label: string;
  /** Optional trailing detail (counts, last-sync time). */
  detail: string | null;
  pending: number;
  failed: number;
  lastSyncAt: number | null;
  /** True when the change is worth announcing to assistive tech. */
  announce: boolean;
}

/** "just now" / "6 min ago" / "3 h ago" / "2 d ago". */
export function formatSyncAge(lastSyncAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - lastSyncAt) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Reduce raw inputs to a single state. Precedence is by what the user can act
 * on: reauthentication first, then connectivity, then failures, then progress.
 */
export function deriveSyncState(input: SyncInputs, now: number = Date.now()): SyncState {
  const { online, authed, activeRequests, pending, failed, lastSyncAt } = input;
  const base = { pending, failed, lastSyncAt };
  const age = lastSyncAt != null ? `synced ${formatSyncAge(lastSyncAt, now)}` : null;
  const waiting = pending > 0 ? plural(pending, 'change waiting', 'changes waiting') : null;

  if (!authed) {
    return {
      ...base,
      kind: 'needs-auth',
      tone: 'warn',
      label: 'Sign in to sync',
      detail: waiting,
      announce: true,
    };
  }
  if (!online) {
    return {
      ...base,
      kind: 'offline',
      tone: 'warn',
      label: 'Offline',
      detail: waiting ?? age,
      announce: true,
    };
  }
  if (failed > 0) {
    return {
      ...base,
      kind: 'failed',
      tone: 'danger',
      label: plural(failed, 'change not saved', 'changes not saved'),
      detail: 'Tap to review',
      announce: true,
    };
  }
  if (activeRequests > 0) {
    return { ...base, kind: 'syncing', tone: 'busy', label: 'Syncing…', detail: null, announce: false };
  }
  if (pending > 0) {
    return { ...base, kind: 'pending', tone: 'warn', label: waiting!, detail: age, announce: true };
  }
  if (lastSyncAt != null) {
    return {
      ...base,
      kind: 'synced',
      tone: 'ok',
      label: 'Synced',
      detail: formatSyncAge(lastSyncAt, now),
      announce: true,
    };
  }
  // Online and idle, but nothing has come back from the server yet. Saying
  // "Synced" here would be a lie.
  return { ...base, kind: 'unknown', tone: 'busy', label: 'Not synced yet', detail: null, announce: false };
}
