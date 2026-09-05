import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SyncStatusView } from '@/components/SyncStatus';
import { deriveSyncState, type SyncInputs } from '@/features/shared/syncState';

const NOW = Date.parse('2027-01-15T12:00:00Z');
const state = (patch: Partial<SyncInputs>) =>
  deriveSyncState(
    {
      online: true,
      authed: true,
      activeRequests: 0,
      pending: 0,
      failed: 0,
      lastSyncAt: NOW - 10_000,
      ...patch,
    },
    NOW,
  );

describe('SyncStatusView (REL-05 / A11Y-01)', () => {
  it('states the status in words, so it does not rely on the dot colour', () => {
    render(<SyncStatusView state={state({ online: false, pending: 2 })} />);
    expect(screen.getByText(/Offline · 2 changes waiting/)).toBeInTheDocument();
  });

  it('shows how long ago the last successful sync was', () => {
    render(<SyncStatusView state={state({})} />);
    expect(screen.getByText(/Synced · just now/)).toBeInTheDocument();
  });

  it('announces meaningful states politely, without duplicating the text', () => {
    render(<SyncStatusView state={state({ failed: 1 })} />);
    const live = screen.getByRole('status');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveTextContent('1 change not saved · Tap to review');
    // Exactly one copy — an sr-only duplicate would be read out twice.
    expect(screen.getAllByText(/1 change not saved/)).toHaveLength(1);
  });

  it('stays silent during routine fetching', () => {
    render(<SyncStatusView state={state({ activeRequests: 1 })} />);
    expect(screen.getByText('Syncing…')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'off');
  });
});
