import { describe, it, expect } from 'vitest';
import { deriveSyncState, formatSyncAge, type SyncInputs } from '@/features/shared/syncState';

const NOW = Date.parse('2027-01-15T12:00:00Z');
const base: SyncInputs = {
  online: true,
  authed: true,
  activeRequests: 0,
  pending: 0,
  failed: 0,
  lastSyncAt: NOW - 10_000,
};
const at = (patch: Partial<SyncInputs>) => deriveSyncState({ ...base, ...patch }, NOW);

describe('deriveSyncState — "Synced" has to be earned (REL-05)', () => {
  it('says Synced only when online, idle, clean and a server exchange happened', () => {
    expect(at({}).kind).toBe('synced');
    expect(at({}).label).toBe('Synced');
  });

  it('never says Synced before the first successful exchange', () => {
    const s = at({ lastSyncAt: null });
    expect(s.kind).toBe('unknown');
    expect(s.label).not.toMatch(/^Synced/);
  });

  it('never says Synced while work is pending', () => {
    expect(at({ pending: 2 }).kind).toBe('pending');
    expect(at({ pending: 2 }).label).toBe('2 changes waiting');
  });

  it('never says Synced while work has failed', () => {
    expect(at({ failed: 1 }).kind).toBe('failed');
    expect(at({ failed: 1 }).label).toBe('1 change not saved');
  });

  it('singularises counts', () => {
    expect(at({ pending: 1 }).label).toBe('1 change waiting');
    expect(at({ failed: 3 }).label).toBe('3 changes not saved');
  });
});

describe('deriveSyncState — precedence by what the user can act on', () => {
  it('reauthentication outranks everything', () => {
    expect(at({ authed: false, online: false, failed: 5, activeRequests: 2 }).kind).toBe('needs-auth');
  });

  it('offline outranks failures, which the user cannot act on until back online', () => {
    expect(at({ online: false, failed: 5 }).kind).toBe('offline');
  });

  it('failures outrank in-flight requests', () => {
    expect(at({ failed: 1, activeRequests: 3 }).kind).toBe('failed');
  });

  it('in-flight requests outrank a pending queue', () => {
    expect(at({ activeRequests: 1, pending: 4 }).kind).toBe('syncing');
  });

  it('carries the pending count into the offline state', () => {
    expect(at({ online: false, pending: 3 }).detail).toBe('3 changes waiting');
  });
});

describe('deriveSyncState — announcements stay quiet during normal churn', () => {
  it('does not announce routine fetching', () => {
    expect(at({ activeRequests: 1 }).announce).toBe(false);
    expect(at({ lastSyncAt: null }).announce).toBe(false);
  });

  it('announces states the user needs to know about', () => {
    for (const patch of [{ online: false }, { authed: false }, { failed: 1 }, { pending: 1 }, {}]) {
      expect(at(patch).announce).toBe(true);
    }
  });
});

describe('formatSyncAge', () => {
  const cases: [number, string][] = [
    [0, 'just now'],
    [59_000, 'just now'],
    [90_000, '2 min ago'],
    [10 * 60_000, '10 min ago'],
    [3 * 3_600_000, '3 h ago'],
    [50 * 3_600_000, '2 d ago'],
  ];
  it.each(cases)('%i ms ago reads as %s', (delta, expected) => {
    expect(formatSyncAge(NOW - delta, NOW)).toBe(expected);
  });

  it('never renders a negative age when the clock skews', () => {
    expect(formatSyncAge(NOW + 60_000, NOW)).toBe('just now');
  });
});
