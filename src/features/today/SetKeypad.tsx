import { useState } from 'react';
import { Icon } from '@/components/Icon';

/*
 * Custom numeric set editor (redesign frame 1c). Replaces the native
 * <input type="number"> in the session logger so the OS keyboard never opens and
 * the layout is identical on phone, tablet-portrait and the iPad two-pane shell.
 *
 * A ±step stepper bar sits above a self-contained digit pad. `next` advances
 * weight → reps → next set; `Done` commits and closes. The parent re-mounts this
 * with a fresh `key` per (set, field) so the draft always starts from the live
 * value.
 */

export type EditField = 'weight' | 'reps';

interface Props {
  /** Human label for the set being edited, e.g. "Set 3". */
  setLabel: string;
  field: EditField;
  value: number;
  /** Called on every edit (digit / backspace / stepper) with the new value. */
  onChange: (v: number) => void;
  /** Advance to the next field (weight → reps → next set). */
  onNext: () => void;
  /** Commit and close the editor. */
  onDone: () => void;
}

const STEP: Record<EditField, number> = { weight: 2.5, reps: 1 };

/** Trim a float for display: 75 not 75.0, but keep 72.5. */
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n);
}

export function SetKeypad({ setLabel, field, value, onChange, onNext, onDone }: Props) {
  // Draft string so multi-digit / decimal entry types naturally; committed to a
  // number on every keystroke via onChange.
  const [draft, setDraft] = useState(value ? fmt(value) : '');
  const step = STEP[field];
  const unit = field === 'weight' ? 'kg' : 'reps';
  const allowDecimal = field === 'weight';

  const commit = (next: string) => {
    setDraft(next);
    onChange(Number(next) || 0);
  };

  const press = (k: string) => {
    if (k === '.') {
      if (!allowDecimal || draft.includes('.')) return;
      commit(draft === '' ? '0.' : draft + '.');
      return;
    }
    // Replace a lone leading zero so "0" then "5" reads as "5", not "05".
    const base = draft === '0' ? '' : draft;
    commit(base + k);
  };

  const backspace = () => commit(draft.slice(0, -1));

  const stepBy = (delta: number) => {
    const next = Math.max(0, Math.round((value + delta) * 100) / 100);
    commit(fmt(next));
  };

  const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', allowDecimal ? '.' : '', '0', '⌫'];

  return (
    <div className="border-t border-border bg-surface-raised">
      {/* Editing bar: label + live value + steppers + Done */}
      <div className="mx-auto flex max-w-content items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="font-display text-label font-semibold uppercase tracking-label text-accent">
            Editing {setLabel}
          </p>
          <p className="font-body text-[2rem] font-bold leading-none tabular-nums text-text">
            {draft || '0'}
            <span className="ml-1.5 text-body-sm font-normal text-text-dim">{unit}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => stepBy(-step)}
          aria-label={`Subtract ${step}`}
          className="flex h-11 min-w-[3.5rem] items-center justify-center rounded-md border border-border bg-surface font-body text-body font-bold text-text-muted transition-colors hover:text-text"
        >
          −{step}
        </button>
        <button
          type="button"
          onClick={() => stepBy(step)}
          aria-label={`Add ${step}`}
          className="flex h-11 min-w-[3.5rem] items-center justify-center rounded-md border border-border bg-surface font-body text-body font-bold text-text-muted transition-colors hover:text-text"
        >
          +{step}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="flex h-11 items-center justify-center rounded-md bg-accent px-6 font-body text-body font-bold text-accent-ink transition-opacity hover:opacity-90"
        >
          Done
        </button>
      </div>

      {/* Digit pad */}
      <div className="mx-auto max-w-content px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="grid grid-cols-3 gap-2">
          {KEYS.map((k, i) =>
            k === '' ? (
              <span key={i} aria-hidden />
            ) : (
              <button
                key={i}
                type="button"
                onClick={() => (k === '⌫' ? backspace() : press(k))}
                aria-label={k === '⌫' ? 'Delete' : k}
                className="flex h-14 items-center justify-center rounded-md border border-border bg-surface font-body text-[1.375rem] font-bold text-text transition-colors hover:bg-surface-raised active:bg-border"
              >
                {k}
              </button>
            ),
          )}
        </div>
        <button
          type="button"
          onClick={onNext}
          className="mt-2 flex h-12 w-full items-center justify-center gap-1.5 rounded-md border border-border bg-surface font-body text-body font-bold text-text-muted transition-colors hover:text-text"
        >
          Next
          <Icon name="arrow_forward" size={18} />
        </button>
      </div>
    </div>
  );
}
