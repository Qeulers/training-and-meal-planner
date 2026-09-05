import type { ReactNode } from 'react';
import type React from 'react';
import type { UseQueryResult } from '@tanstack/react-query';

/** Surface card — the primary content container. */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-lg border border-border bg-surface p-4 ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * Small uppercase eyebrow label — accent-green by default, matching the design.
 * `bullet` prefixes a small filled square (the design's section marker); `meta`
 * renders muted, right-aligned trailing text (e.g. "~55 min · 8 moves").
 */
export function Eyebrow({
  children,
  tone = 'accent',
  bullet = false,
  meta,
  className = '',
}: {
  children: ReactNode;
  tone?: 'accent' | 'muted';
  bullet?: boolean;
  meta?: ReactNode;
  className?: string;
}) {
  const color = tone === 'accent' ? 'text-accent' : 'text-text-dim';
  return (
    <p
      className={`flex items-center gap-1.5 font-display text-label font-semibold uppercase tracking-label ${color} ${className}`}
    >
      {bullet && <span aria-hidden className="inline-block h-2 w-2 rounded-[2px] bg-accent" />}
      <span>{children}</span>
      {meta != null && (
        <span className="ml-auto font-normal normal-case tracking-normal text-text-dim">{meta}</span>
      )}
    </p>
  );
}

/** Bordered chip used for exercise prescriptions on Today (the design's chip row). */
export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-md border border-border bg-surface-raised px-2 py-1 text-body-sm text-text-muted">
      {children}
    </span>
  );
}

/**
 * Segmented control (Food panes). The active segment is a raised surface chip,
 * not a green fill, exactly as the mockups render the Fuel/Recipes/Planner/Shop
 * switch — unlike the round `Pill` filter.
 *
 * Real tab semantics (A11Y-01).
 *
 * It already carried `role="tablist"` and `role="tab"`, but not the behaviour
 * those roles promise: every tab was in the tab order, arrow keys did nothing,
 * and no tab pointed at the panel it controls. A screen-reader user was told
 * "tab" and then found none of the interaction a tab affords.
 *
 * Roving tabindex: exactly one tab is focusable, and arrows move between them.
 * `panelId` wires up `aria-controls`; the panel itself carries `role="tabpanel"`
 * via `TabPanel` below.
 */
export function Segmented<K extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  panelId,
}: {
  options: { key: K; label: string }[];
  value: K;
  onChange: (k: K) => void;
  ariaLabel?: string;
  panelId?: string;
}) {
  const move = (delta: number) => {
    const i = options.findIndex((o) => o.key === value);
    if (i < 0) return;
    // Wraps, as the tab pattern expects.
    const next = options[(i + delta + options.length) % options.length];
    onChange(next.key);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const handlers: Record<string, () => void> = {
      ArrowRight: () => move(1),
      ArrowLeft: () => move(-1),
      Home: () => onChange(options[0].key),
      End: () => onChange(options[options.length - 1].key),
    };
    const handler = handlers[e.key];
    if (!handler) return;
    e.preventDefault();
    handler();
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className="flex gap-1 rounded-lg border border-border bg-surface p-1"
    >
      {options.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            role="tab"
            id={panelId ? `${panelId}-tab-${o.key}` : undefined}
            aria-selected={active}
            aria-controls={panelId}
            // Roving tabindex: Tab reaches the group, arrows move within it.
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.key)}
            className={[
              'min-h-tap flex-1 rounded-md px-3 py-1.5 text-body-sm font-display uppercase tracking-label transition-colors duration-fast ease-brand',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              active
                ? 'bg-surface-raised text-text shadow-sm ring-1 ring-border-strong'
                : 'text-text-dim hover:text-text',
            ].join(' ')}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** The panel a `Segmented` controls. Pairs with its `panelId`. */
export function TabPanel({
  id,
  tabKey,
  children,
  className = '',
}: {
  id: string;
  tabKey: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      id={id}
      role="tabpanel"
      aria-labelledby={`${id}-tab-${tabKey}`}
      tabIndex={0}
      className={className}
    >
      {children}
    </div>
  );
}

/** Section heading in Archivo Narrow bold (the design's card/section titles). */
export function Heading({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={`font-display text-data font-bold leading-tight text-text ${className}`}>
      {children}
    </h2>
  );
}

type BtnVariant = 'primary' | 'ghost';
export function Button({
  children,
  onClick,
  variant = 'primary',
  full = false,
  type = 'button',
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: BtnVariant;
  full?: boolean;
  type?: 'button' | 'submit';
  disabled?: boolean;
}) {
  const base =
    'inline-flex min-h-tap items-center justify-center gap-2 rounded-md px-4 font-body text-body font-bold transition-opacity duration-fast ease-brand disabled:opacity-50';
  const variants: Record<BtnVariant, string> = {
    primary: 'bg-accent text-accent-ink hover:opacity-90',
    ghost: 'border border-border bg-surface text-text-muted hover:text-text',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${variants[variant]} ${full ? 'w-full' : ''}`}
    >
      {children}
    </button>
  );
}

type BadgeTone = 'neutral' | 'accent' | 'food' | 'warning' | 'danger';
const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-raised text-text-muted border-border',
  accent: 'bg-surface-raised text-accent border-border',
  food: 'bg-surface-raised text-food border-border',
  warning: 'bg-surface-raised text-warning border-border',
  danger: 'bg-surface-raised text-danger border-border',
};

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: BadgeTone }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-meta ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** A pill toggle used for filter bars (Moves categories, Recipe filters). */
export function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={[
        'min-h-tap whitespace-nowrap rounded-full border px-3 py-1.5 text-body-sm font-display uppercase tracking-label transition-colors duration-fast ease-brand',
        active
          ? 'border-accent bg-accent text-accent-ink'
          : 'border-border bg-surface text-text-muted hover:text-text',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <p role="status" className="py-8 text-center text-body-sm text-text-dim">
      {label}
    </p>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <Card className="border-danger">
      <p className="text-body-sm text-danger">Could not load data: {msg}</p>
    </Card>
  );
}

/**
 * Render one or more queries, showing a spinner/error until all have data.
 * Keeps feature components free of loading boilerplate.
 */
export function QueryBoundary<T extends UseQueryResult[]>({
  queries,
  children,
}: {
  queries: [...T];
  children: (data: { [K in keyof T]: NonNullable<T[K]['data']> }) => ReactNode;
}) {
  const err = queries.find((q) => q.isError);
  if (err) return <ErrorState error={err.error} />;
  if (queries.some((q) => q.isPending)) return <Spinner />;
  return <>{children(queries.map((q) => q.data) as never)}</>;
}
