/*
 * Safe sign-out (REL-06). The rule under test: nothing queued is ever discarded
 * without the user choosing it in words.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const signOut = vi.fn();
const forgetCachedData = vi.fn(async () => {});
let syncState = { pending: 0, failed: 0 };

vi.mock('@/data/AuthProvider', () => ({
  useAuth: () => ({
    session: { user: { id: 'u1', email: 'frank@example.com' } },
    loading: false,
    signOut,
    signInWithGoogle: vi.fn(),
  }),
}));

vi.mock('@/data/sync/SyncProvider', () => ({
  useSync: () => ({ ...syncState, forgetCachedData }),
}));

import { AccountMenu } from '@/components/AccountMenu';

beforeEach(() => {
  signOut.mockClear();
  forgetCachedData.mockClear();
  syncState = { pending: 0, failed: 0 };
});

describe('AccountMenu', () => {
  it('names the account it will sign out of', () => {
    render(<AccountMenu />);
    expect(
      screen.getByRole('button', { name: /sign out of frank@example\.com/i }),
    ).toBeInTheDocument();
  });

  it('names the account even in the compact phone layout', () => {
    render(<AccountMenu compact />);
    expect(
      screen.getByRole('button', { name: /sign out of frank@example\.com/i }),
    ).toBeInTheDocument();
  });

  it('signs out immediately when there is nothing queued', async () => {
    const user = userEvent.setup();
    render(<AccountMenu />);
    await user.click(screen.getByRole('button', { name: /sign out/i }));
    expect(signOut).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('drops cached records but not queued writes', async () => {
    const user = userEvent.setup();
    render(<AccountMenu />);
    await user.click(screen.getByRole('button', { name: /sign out/i }));
    expect(forgetCachedData).toHaveBeenCalledOnce();
  });

  it('stops and names the count when work is unsynced', async () => {
    syncState = { pending: 3, failed: 0 };
    const user = userEvent.setup();
    render(<AccountMenu />);

    await user.click(screen.getByRole('button', { name: /sign out/i }));

    expect(signOut).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent('3 changes not yet synced');
  });

  it('counts failed work as unsynced and says it needs attention', async () => {
    syncState = { pending: 1, failed: 2 };
    const user = userEvent.setup();
    render(<AccountMenu />);

    await user.click(screen.getByRole('button', { name: /sign out/i }));

    expect(screen.getByRole('dialog')).toHaveTextContent('3 changes not yet synced');
    expect(screen.getByRole('dialog')).toHaveTextContent(/2 of them failed/i);
  });

  it('offers no destructive option — signing out keeps the work', async () => {
    syncState = { pending: 2, failed: 0 };
    const user = userEvent.setup();
    render(<AccountMenu />);
    await user.click(screen.getByRole('button', { name: /sign out/i }));

    expect(screen.getByRole('button', { name: /sign out and keep/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /discard|delete/i })).not.toBeInTheDocument();
  });

  it('cancels back to staying signed in', async () => {
    syncState = { pending: 2, failed: 0 };
    const user = userEvent.setup();
    render(<AccountMenu />);
    await user.click(screen.getByRole('button', { name: /sign out/i }));
    await user.click(screen.getByRole('button', { name: /stay signed in/i }));

    expect(signOut).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on Escape and returns focus to the trigger (A11Y-01)', async () => {
    syncState = { pending: 1, failed: 0 };
    const user = userEvent.setup();
    render(<AccountMenu />);
    const trigger = screen.getByRole('button', { name: /sign out/i });

    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('moves focus into the dialog on open', async () => {
    syncState = { pending: 1, failed: 0 };
    const user = userEvent.setup();
    render(<AccountMenu />);
    await user.click(screen.getByRole('button', { name: /sign out/i }));

    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });
});
