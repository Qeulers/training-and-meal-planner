/*
 * Account identity and safe sign-out (UX-01, REL-06).
 *
 * Signing out with unsynced work is the one place this app can destroy
 * something irrecoverable, so it is the one place that stops and asks. The
 * dialog names the count, and the destructive option is a second, separate
 * confirmation — never the default, never a single tap away.
 *
 * "Sign out and keep it" leaves the queue on the device, still owned by that
 * account, invisible to anyone else, and draining when they sign back in.
 */
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/data/AuthProvider';
import { useSync } from '@/data/sync/SyncProvider';

/**
 * `compact` is for the phone header, where there is no room for the address.
 * It still reaches assistive tech through the accessible name — a sign-out
 * control that does not say which account it signs out of is a trap.
 */
export function AccountMenu({
  className = '',
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const { session, signOut } = useAuth();
  const { pending, failed, forgetCachedData } = useSync();
  const [confirming, setConfirming] = useState(false);
  const email = session?.user.email ?? 'Signed in';
  const unsynced = pending + failed;

  const doSignOut = async () => {
    // Cached records go; queued writes stay (REL-06).
    await forgetCachedData();
    await signOut();
  };

  if (!session) return null;

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => (unsynced > 0 ? setConfirming(true) : void doSignOut())}
        aria-label={`Sign out of ${email}`}
        className={
          compact
            ? 'flex min-h-tap shrink-0 items-center rounded-md px-2 font-display text-label uppercase tracking-label text-text-dim transition-colors hover:text-text'
            : 'flex min-h-tap w-full items-center gap-2 rounded-md px-2 text-left text-meta text-text-dim transition-colors hover:text-text'
        }
      >
        {/* No icon: the Material Symbols font is subset to the ~29 glyphs the
            app uses, and one sign-out row does not justify regenerating it. */}
        {!compact && <span className="min-w-0 flex-1 truncate">{email}</span>}
        <span className="shrink-0 font-display uppercase tracking-label">Sign out</span>
      </button>

      {confirming && (
        <SignOutDialog
          unsynced={unsynced}
          failed={failed}
          onCancel={() => setConfirming(false)}
          onSignOut={() => {
            setConfirming(false);
            void doSignOut();
          }}
        />
      )}
    </div>
  );
}

function SignOutDialog({
  unsynced,
  failed,
  onCancel,
  onSignOut,
}: {
  unsynced: number;
  failed: number;
  onCancel: () => void;
  onSignOut: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  // Focus moves in on open and back to the trigger on close (A11Y-01).
  useEffect(() => {
    returnTo.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector('button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      returnTo.current?.focus();
    };
  }, [onCancel]);

  const noun = unsynced === 1 ? 'change' : 'changes';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 p-4 backdrop-blur">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="signout-title"
        className="w-full max-w-sm rounded-lg border border-border bg-surface p-4"
      >
        <h2 id="signout-title" className="font-display text-data font-bold text-text">
          {unsynced} {noun} not yet synced
        </h2>
        <p className="mt-2 text-body-sm text-text-muted">
          {failed > 0
            ? `${failed} of them failed to save and need attention. `
            : 'They are saved on this device and will sync when you are back online. '}
          Signing out hides them until you sign back in with this account.
        </p>

        <div className="mt-4 space-y-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-tap w-full rounded-md bg-accent px-4 font-body text-body font-bold text-accent-ink transition-opacity hover:opacity-90"
          >
            Stay signed in
          </button>
          <button
            type="button"
            onClick={onSignOut}
            className="min-h-tap w-full rounded-md border border-border bg-surface px-4 font-body text-body font-bold text-text-muted transition-colors hover:text-text"
          >
            Sign out and keep the {noun}
          </button>
        </div>

        <p className="mt-3 text-meta text-text-dim">
          Nothing is deleted. To discard unsynced work you have to do it deliberately, from the
          sync status, while signed in.
        </p>
      </div>
    </div>
  );
}
