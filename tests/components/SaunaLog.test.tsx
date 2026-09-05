/*
 * Sauna input validation and duplicate-submit guarding (WORK-03).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mutate = vi.fn();

vi.mock('@/data/user', () => ({
  useAddSaunaLog: () => ({ mutate, isPending: false }),
}));

import { AdHocSaunaLog, LogSaunaButton } from '@/features/today/SaunaLog';

const TYPES = [
  { slug: 'recov', name: 'Recovery sauna', duration_label: '15–20 min', temp_label: '70–80 °C' },
  { slug: 'ha', name: 'Heat-acclimation session', duration_label: '25–30 min', temp_label: '80–100 °C' },
] as never;

beforeEach(() => mutate.mockClear());

async function openDetail(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /log a sauna/i }));
  await user.click(screen.getByRole('button', { name: /add detail/i }));
}

describe('AdHocSaunaLog — one tap with no detail', () => {
  it('logs with every optional field absent rather than zero', async () => {
    const user = userEvent.setup();
    render(<AdHocSaunaLog types={TYPES} />);
    await user.click(screen.getByRole('button', { name: /log a sauna/i }));
    await user.click(screen.getByRole('button', { name: /^log sauna$/i }));

    expect(mutate).toHaveBeenCalledOnce();
    expect(mutate.mock.calls[0][0]).toMatchObject({
      sauna_type_slug: 'recov',
      duration_min: null,
      temp_c: null,
      weight_before_kg: null,
      weight_after_kg: null,
    });
  });

  it('does not log twice when the button is tapped twice quickly', async () => {
    const user = userEvent.setup();
    render(<AdHocSaunaLog types={TYPES} />);
    await user.click(screen.getByRole('button', { name: /log a sauna/i }));
    const log = screen.getByRole('button', { name: /^log sauna$/i });

    await user.click(log);
    await user.click(log);

    // isPending is still false at the second tap, so only the ref stops it.
    expect(mutate).toHaveBeenCalledOnce();
  });
});

describe('AdHocSaunaLog — invalid detail is refused, with field feedback', () => {
  it('refuses to save non-numeric text and says which field', async () => {
    const user = userEvent.setup();
    render(<AdHocSaunaLog types={TYPES} />);
    await openDetail(user);

    await user.type(screen.getByLabelText(/weight before/i), 'abc');
    await user.click(screen.getByRole('button', { name: /^log sauna$/i }));

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText(/weight before must be a number/i)).toBeInTheDocument();
  });

  it('refuses a zero duration', async () => {
    const user = userEvent.setup();
    render(<AdHocSaunaLog types={TYPES} />);
    await openDetail(user);

    await user.type(screen.getByLabelText(/duration/i), '0');
    await user.click(screen.getByRole('button', { name: /^log sauna$/i }));

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText(/duration must be greater than zero/i)).toBeInTheDocument();
  });

  it('ties the error to its input for assistive tech (A11Y-01)', async () => {
    const user = userEvent.setup();
    render(<AdHocSaunaLog types={TYPES} />);
    await openDetail(user);

    const input = screen.getByLabelText(/duration/i);
    await user.type(input, '-3');
    await user.click(screen.getByRole('button', { name: /^log sauna$/i }));

    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(/greater than zero/i);
  });

  it('writes nothing at all when one of several fields is invalid', async () => {
    const user = userEvent.setup();
    render(<AdHocSaunaLog types={TYPES} />);
    await openDetail(user);

    await user.type(screen.getByLabelText(/duration/i), '20');
    await user.type(screen.getByLabelText(/temp/i), 'hot');
    await user.click(screen.getByRole('button', { name: /^log sauna$/i }));

    expect(mutate).not.toHaveBeenCalled();
  });

  it('saves once corrected', async () => {
    const user = userEvent.setup();
    render(<AdHocSaunaLog types={TYPES} />);
    await openDetail(user);

    const duration = screen.getByLabelText(/duration/i);
    await user.type(duration, '0');
    await user.click(screen.getByRole('button', { name: /^log sauna$/i }));
    expect(mutate).not.toHaveBeenCalled();

    await user.clear(duration);
    await user.type(duration, '18');
    await user.click(screen.getByRole('button', { name: /^log sauna$/i }));

    expect(mutate).toHaveBeenCalledOnce();
    expect(mutate.mock.calls[0][0]).toMatchObject({ duration_min: 18 });
  });

  it('accepts a negative temperature — no arbitrary bound', async () => {
    const user = userEvent.setup();
    render(<AdHocSaunaLog types={TYPES} />);
    await openDetail(user);

    await user.type(screen.getByLabelText(/temp/i), '-5');
    await user.click(screen.getByRole('button', { name: /^log sauna$/i }));

    expect(mutate).toHaveBeenCalledOnce();
    expect(mutate.mock.calls[0][0]).toMatchObject({ temp_c: -5 });
  });
});

describe('LogSaunaButton — the slot-attached control', () => {
  it('shows nothing to log when the day is already done', () => {
    render(<LogSaunaButton saunaTypeSlug="recov" done />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('logs once on a double tap', async () => {
    const user = userEvent.setup();
    render(<LogSaunaButton saunaTypeSlug="recov" done={false} />);
    const log = screen.getByRole('button', { name: /log this sauna/i });

    await user.click(log);
    await user.click(log);

    expect(mutate).toHaveBeenCalledOnce();
  });

  it('refuses invalid detail here too', async () => {
    const user = userEvent.setup();
    render(<LogSaunaButton saunaTypeSlug="recov" done={false} />);
    await user.click(screen.getByRole('button', { name: /detail/i }));
    await user.type(screen.getByLabelText(/weight after/i), '-2');
    await user.click(screen.getByRole('button', { name: /log with detail/i }));

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText(/weight after must be greater than zero/i)).toBeInTheDocument();
  });
});
