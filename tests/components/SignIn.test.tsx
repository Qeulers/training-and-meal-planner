/*
 * OAuth pending and failure states (UX-01). A cancelled or failed Google
 * redirect used to land back on an unchanged sign-in screen.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const signInWithGoogle = vi.fn();
const clearError = vi.fn();
let auth = { phase: 'signed-out' as string, error: null as string | null };

vi.mock('@/data/AuthProvider', () => ({
  useAuth: () => ({ ...auth, signInWithGoogle, clearError, session: null, loading: false }),
}));
vi.mock('@/components/ThemeToggle', () => ({ ThemeToggle: () => null }));

import { SignIn } from '@/features/auth/SignIn';

beforeEach(() => {
  signInWithGoogle.mockClear();
  clearError.mockClear();
  auth = { phase: 'signed-out', error: null };
});

describe('SignIn', () => {
  it('offers sign-in when idle', () => {
    render(<SignIn />);
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows progress and blocks a second tap while redirecting', () => {
    auth = { phase: 'signing-in', error: null };
    render(<SignIn />);

    const button = screen.getByRole('button', { name: /opening google/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent(/redirecting to google/i);
  });

  it('reports why sign-in failed instead of silently returning to the form', () => {
    auth = { phase: 'error', error: 'access_denied' };
    render(<SignIn />);

    expect(screen.getByRole('alert')).toHaveTextContent(/sign-in did not complete/i);
    expect(screen.getByRole('alert')).toHaveTextContent('access_denied');
  });

  it('offers a retry that clears the previous error first', async () => {
    auth = { phase: 'error', error: 'access_denied' };
    const user = userEvent.setup();
    render(<SignIn />);

    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(clearError).toHaveBeenCalledOnce();
    expect(signInWithGoogle).toHaveBeenCalledOnce();
  });
});
