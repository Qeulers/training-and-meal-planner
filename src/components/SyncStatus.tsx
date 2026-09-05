/*
 * The one place sync status is rendered (REL-05). Used by both shells — the
 * wide sidebar and the phone/tablet header — so they can never disagree.
 *
 * The label always states the status in words; the dot is decoration, so nothing
 * here depends on colour perception (A11Y-01). Announcements are polite and only
 * fire on states worth interrupting for, keeping screen readers quiet during the
 * normal fetch churn.
 */
import { useSyncStatus } from '@/features/shared/useSyncStatus';
import { useSync } from '@/data/sync/SyncProvider';
import type { SyncState, SyncTone } from '@/features/shared/syncState';

const DOT: Record<SyncTone, string> = {
  ok: 'bg-success',
  busy: 'bg-text-dim',
  warn: 'bg-warning',
  danger: 'bg-danger',
};

export function SyncStatusView({ state, className = '' }: { state: SyncState; className?: string }) {
  const text = state.detail ? `${state.label} · ${state.detail}` : state.label;
  return (
    <p
      // The visible text is itself the live region — a separate sr-only copy
      // would make screen readers say everything twice. Liveness is switched
      // off for states not worth interrupting for, so the constant "Syncing…"
      // churn stays silent while offline/failed/synced still announce.
      role="status"
      aria-live={state.announce ? 'polite' : 'off'}
      className={`flex items-center gap-1.5 text-meta text-text-dim ${className}`}
      data-sync-kind={state.kind}
    >
      <span aria-hidden className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${DOT[state.tone]}`} />
      <span>{text}</span>
    </p>
  );
}

/**
 * Warns when this browser will not keep work across a reload — private mode,
 * blocked site data, a database this build cannot read. The app still works for
 * the session, but nothing may claim to be saved on the device (REL-01).
 */
export function StorageWarning({ className = '' }: { className?: string }) {
  const { ready, durable, quarantined } = useSync();
  if (!ready || durable) return null;
  return (
    <p
      role="status"
      className={`rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-meta text-text-muted ${className}`}
    >
      {quarantined
        ? 'This browser holds data from a newer version of the app. It has been left untouched; changes made now will not be kept after you close the tab.'
        : 'This browser is not letting the app store data. Changes will not be kept after you close the tab.'}
    </p>
  );
}

export function SyncStatus({ className = '' }: { className?: string }) {
  return (
    <>
      <SyncStatusView state={useSyncStatus()} className={className} />
      <StorageWarning className={className} />
    </>
  );
}
