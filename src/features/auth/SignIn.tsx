import { useAuth } from '@/data/AuthProvider';
import { ThemeToggle } from '@/components/ThemeToggle';

/**
 * Unauthenticated users see this and nothing else (SPEC §3.3).
 *
 * A failed or cancelled Google redirect used to land back here silently, with
 * no indication that anything had gone wrong; the reason is now shown with a
 * way to try again (UX-01).
 */
export function SignIn() {
  const { signInWithGoogle, phase, error, clearError } = useAuth();
  const busy = phase === 'signing-in';

  return (
    <main className="relative mx-auto flex min-h-screen max-w-content flex-col items-center justify-center px-4 text-center">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <h1 className="font-display text-display-xl text-text">Training &amp; Meal Planner</h1>
      <p className="mt-3 text-body text-text-muted">
        Strength, fuel and sauna — one plan, on every device.
      </p>

      {error && (
        <div
          role="alert"
          className="mt-6 w-full max-w-sm rounded-lg border border-danger/50 bg-danger/10 p-3 text-left"
        >
          <p className="text-body-sm font-bold text-text">Sign-in did not complete</p>
          <p className="mt-1 text-body-sm text-text-muted">{error}</p>
        </div>
      )}

      <button
        onClick={() => {
          clearError();
          void signInWithGoogle();
        }}
        disabled={busy}
        aria-busy={busy}
        className="mt-8 min-h-tap rounded-lg bg-accent px-6 py-3 font-display uppercase
                   tracking-wide text-accent-ink transition-opacity duration-fast ease-brand
                   hover:opacity-90 disabled:opacity-60"
      >
        {busy ? 'Opening Google…' : error ? 'Try again' : 'Sign in with Google'}
      </button>

      {busy && (
        <p role="status" className="mt-3 text-meta text-text-dim">
          Redirecting to Google. If nothing happens, check that pop-ups and redirects are
          allowed, then try again.
        </p>
      )}
    </main>
  );
}
