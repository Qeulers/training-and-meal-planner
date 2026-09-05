import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type AuthPhase =
  /** Checking for an existing session on boot. */
  | 'loading'
  /** No session; the sign-in screen is showing. */
  | 'signed-out'
  /** Redirecting to Google, or coming back from it. */
  | 'signing-in'
  | 'signed-in'
  | 'error';

interface AuthState {
  session: Session | null;
  loading: boolean;
  phase: AuthPhase;
  /** Set when sign-in failed. Shown with a Retry rather than a dead screen. */
  error: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Dismiss an error and return to the sign-in screen (UX-01). */
  clearError: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

/** OAuth failures come back on the URL fragment, not as a thrown error. */
function oauthErrorFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const search = new URLSearchParams(window.location.search);
  const description = hash.get('error_description') ?? search.get('error_description');
  const code = hash.get('error') ?? search.get('error');
  if (!description && !code) return null;
  return description ?? code;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // A failed or cancelled Google redirect returns here with the reason in the
    // URL. Without reading it the user lands back on a sign-in screen with no
    // hint that anything went wrong, and no idea whether to try again.
    const urlError = oauthErrorFromUrl();
    if (urlError) {
      setError(urlError);
      // Clear it from the address bar so a refresh does not re-show the error.
      window.history.replaceState({}, '', window.location.pathname);
    }

    supabase.auth
      .getSession()
      .then(({ data, error: err }) => {
        setSession(data.session);
        if (err) setError(err.message);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (next) {
        setSigningIn(false);
        setError(null);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    setError(null);
    setSigningIn(true);
    try {
      const { error: err } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      // A successful call navigates away, so reaching here with an error means
      // the redirect never happened.
      if (err) {
        setError(err.message);
        setSigningIn(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the sign-in service.');
      setSigningIn(false);
    }
  };

  const signOut = async () => {
    setError(null);
    try {
      await supabase.auth.signOut();
    } catch {
      // Offline sign-out cannot reach the server. Drop the local session anyway
      // so the account's cached data is not left on screen.
      setSession(null);
    }
  };

  const phase: AuthPhase = loading
    ? 'loading'
    : session
      ? 'signed-in'
      : error
        ? 'error'
        : signingIn
          ? 'signing-in'
          : 'signed-out';

  return (
    <AuthContext.Provider
      value={{
        session,
        loading,
        phase,
        error,
        signInWithGoogle,
        signOut,
        clearError: () => setError(null),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
