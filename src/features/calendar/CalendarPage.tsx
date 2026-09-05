import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TabScaffold } from '@/components/TabScaffold';
import { Icon } from '@/components/Icon';
import {
  Card,
  Eyebrow,
  Heading,
  Button,
  Badge,
  Segmented,
  QueryBoundary,
} from '@/components/ui';
import {
  usePhases,
  useSessionTemplates,
  useSessionItems,
  useSaunaSchedule,
  useSaunaTypes,
  useExercises,
} from '@/data/reference';
import {
  useRaces,
  useUserSettings,
  useWorkoutLogs,
  useSaunaLogs,
  type WorkoutLog,
  type SaunaLog,
} from '@/data/user';
import {
  formatDate,
  addDays,
  addMonths,
  addYears,
  parseLocalDate,
  dayOfWeek,
  daysBetween,
} from '@/domain/dates';
import { sessionsFor, type SessionTemplate } from '@/domain/schedule';
import { saunaFor } from '@/domain/sauna';
import { WorkoutLogger } from '../today/WorkoutLogger';
import { inHeatBlock, heatBlock } from '@/domain/heatBlock';
import { phase, type PhaseOverride, type PhaseSlug } from '@/domain/phase';
import type { Phase, SessionItem, Exercise, SaunaType } from '@/data/reference';
import type { Tables } from '@/data/database.types';
type Race = Tables<'races'>;

type View = 'week' | 'month' | 'year';

// monCol: Mon=0 … Sun=6 (for Mon-anchored grid)
const monCol = (dateStr: string) => (dayOfWeek(dateStr) + 6) % 7;
const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Bucket log rows by their `logged_on` date for O(1) per-day lookup. */
function groupByDate<T extends { logged_on: string }>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const list = m.get(r.logged_on);
    if (list) list.push(r);
    else m.set(r.logged_on, [r]);
  }
  return m;
}

type SessionStatus = 'done' | 'missed' | 'today' | 'upcoming';

interface Ctx {
  templates: SessionTemplate[];
  schedule: import('@/domain/sauna').SaunaScheduleRow[];
  raceDate: string | null;
  override: PhaseOverride | null;
  /** Actual logs keyed by their logged_on date. */
  workoutLogsByDate: Map<string, WorkoutLog[]>;
  saunaLogsByDate: Map<string, SaunaLog[]>;
  today: string;
}

type PlannedSession = SessionTemplate & { status: SessionStatus };
type PlannedSlot = ReturnType<typeof saunaFor>[number] & { done: boolean };

function activityFor(dateStr: string, ctx: Ctx) {
  const planned = sessionsFor(dateStr, {
    raceDate: ctx.raceDate,
    templates: ctx.templates,
    override: ctx.override,
  });
  const plannedSlots = saunaFor(dateStr, {
    raceDate: ctx.raceDate,
    schedule: ctx.schedule,
    override: ctx.override,
  });
  const wlogs = ctx.workoutLogsByDate.get(dateStr) ?? [];
  const slogs = ctx.saunaLogsByDate.get(dateStr) ?? [];

  // Planned strength sessions, tagged with completion / timing status.
  const plannedKeys = new Set(planned.map((s) => s.session_key));
  const sessions: PlannedSession[] = planned.map((s) => {
    const done = wlogs.some((l) => l.session_key === s.session_key);
    const status: SessionStatus = done
      ? 'done'
      : dateStr < ctx.today
        ? 'missed'
        : dateStr === ctx.today
          ? 'today'
          : 'upcoming';
    return { ...s, status };
  });
  // Workouts logged on this day that aren't one of today's planned sessions
  // (a session done on a different day, or an unplanned/ad-hoc session).
  const loggedSessions = wlogs.filter((l) => !plannedKeys.has(l.session_key));

  // Planned sauna slots, tagged done when a matching log exists that day.
  const plannedTypes = new Set(plannedSlots.map((s) => s.sauna_type_slug));
  const slots: PlannedSlot[] = plannedSlots.map((slot) => ({
    ...slot,
    done: slogs.some((l) => l.sauna_type_slug === slot.sauna_type_slug),
  }));
  // Saunas logged on this day with no matching planned slot (ad-hoc).
  const loggedSaunas = slogs.filter((l) => !plannedTypes.has(l.sauna_type_slug));

  return {
    sessions,
    loggedSessions,
    slots,
    loggedSaunas,
    heat: inHeatBlock(dateStr, ctx.raceDate),
    race: dateStr === ctx.raceDate,
  };
}

// ─── Week helpers ────────────────────────────────────────────────────────────

const weekStart = (anchor: string) => addDays(anchor, -monCol(anchor));

function weekRangeLabel(start: string): string {
  const s = parseLocalDate(start);
  const e = parseLocalDate(addDays(start, 6));
  const sDay = s.getDate();
  const eDay = e.getDate();
  const sMon = s.toLocaleDateString(undefined, { month: 'long' });
  const eMon = e.toLocaleDateString(undefined, { month: 'long' });
  const yr = e.getFullYear();
  if (s.getMonth() === e.getMonth()) {
    return `${sDay} – ${eDay} ${sMon} ${yr}`;
  }
  return `${sDay} ${sMon} – ${eDay} ${eMon} ${yr}`;
}

function weekSubline(
  start: string,
  ctx: Ctx,
  phaseList: Phase[],
): string {
  // Count strength sessions and sauna slots in the week
  let strength = 0;
  let sauna = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    const { sessions, slots } = activityFor(d, ctx);
    strength += sessions.length;
    sauna += slots.length;
  }
  // Phase label for the middle of the week
  const mid = addDays(start, 3);
  const ph = phase(mid, ctx.raceDate, ctx.override);
  const meta = phaseList.find((p) => p.slug === ph);
  const phLabel = meta?.short_label ?? ph;

  const parts: string[] = [phLabel];
  if (strength > 0) parts.push(`${strength} strength`);
  if (sauna > 0) parts.push(`${sauna} sauna`);
  return parts.join(' · ');
}

// ─── Month helpers ────────────────────────────────────────────────────────────

function monthCells(anchor: string): string[] {
  const d = parseLocalDate(anchor);
  const firstOfMonth = formatDate(new Date(d.getFullYear(), d.getMonth(), 1));
  const gridStart = addDays(firstOfMonth, -monCol(firstOfMonth));
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

// ─── Page ────────────────────────────────────────────────────────────────────

const VIEWS: View[] = ['week', 'month', 'year'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Calendar position lives in the URL (`?view=&anchor=&day=`) so a refresh, a
 * shared link and the browser Back button all land where the user was (CAL-01).
 * Unparseable values fall back to today's week rather than rendering NaN.
 */
function useCalendarState() {
  const [params, setParams] = useSearchParams();
  const today = formatDate(new Date());

  const readDate = (key: string) => {
    const v = params.get(key);
    return v && DATE_RE.test(v) && !Number.isNaN(parseLocalDate(v).getTime()) ? v : today;
  };
  const view = (VIEWS.find((v) => v === params.get('view')) ?? 'week') as View;
  const anchor = readDate('anchor');
  const selectedDay = readDate('day');

  const patch = (next: Partial<{ view: View; anchor: string; day: string }>) =>
    setParams(
      {
        view: next.view ?? view,
        anchor: next.anchor ?? anchor,
        day: next.day ?? selectedDay,
      },
      // Push, so Back returns to the previous week/day (CAL-A).
      { replace: false },
    );

  return { view, anchor, selectedDay, patch };
}

export function CalendarPage() {
  const { view, anchor, selectedDay, patch } = useCalendarState();
  const setView = (v: View) => patch({ view: v });
  const setSelectedDay = (d: string) => patch({ day: d });
  const [logging, setLogging] = useState<SessionTemplate | null>(null);

  const phases = usePhases();
  const templates = useSessionTemplates();
  const items = useSessionItems();
  const schedule = useSaunaSchedule();
  const saunaTypes = useSaunaTypes();
  const exercises = useExercises();
  const races = useRaces();
  const settings = useUserSettings();
  const workoutLogs = useWorkoutLogs();
  const saunaLogs = useSaunaLogs();

  // Step by real calendar units. Stepping by 30/365 days drifted: a month on
  // from 2027-01-31 landed in March. addMonths/addYears clamp instead (CAL-01).
  const step = (dir: number) => {
    const next =
      view === 'week'
        ? addDays(anchor, dir * 7)
        : view === 'month'
          ? addMonths(anchor, dir)
          : addYears(anchor, dir);
    patch({ anchor: next });
  };

  const goToday = () => {
    const today = formatDate(new Date());
    patch({ anchor: today, day: today });
  };

  const VIEW_OPTIONS: { key: View; label: string }[] = [
    { key: 'week', label: 'Week' },
    { key: 'month', label: 'Month' },
    { key: 'year', label: 'Year' },
  ];

  return (
    <TabScaffold title="Calendar" wide hideTitle>
      <QueryBoundary
        queries={[
          phases,
          templates,
          items,
          schedule,
          saunaTypes,
          exercises,
          races,
          settings,
          workoutLogs,
          saunaLogs,
        ]}
      >
        {([
          phaseList,
          templateList,
          itemList,
          scheduleList,
          typeList,
          exerciseList,
          raceList,
          userSettings,
          workoutLogList,
          saunaLogList,
        ]) => {
          const target = raceList.find((r) => r.is_target) ?? null;
          const override: PhaseOverride | null =
            userSettings?.phase_override && userSettings.phase_override_from
              ? {
                  phase: userSettings.phase_override as PhaseSlug,
                  from: userSettings.phase_override_from,
                }
              : null;
          const workoutLogsByDate = groupByDate(workoutLogList);
          const saunaLogsByDate = groupByDate(saunaLogList);
          const ctx: Ctx = {
            templates: templateList,
            schedule: scheduleList,
            raceDate: target?.race_date ?? null,
            override,
            workoutLogsByDate,
            saunaLogsByDate,
            today: formatDate(new Date()),
          };
          const typeBy = new Map(typeList.map((t: SaunaType) => [t.slug, t]));
          const exBy = new Map(exerciseList.map((e: Exercise) => [e.slug, e]));

          // Doing a session from another day (e.g. a missed one) — the logger
          // records it as done today (WorkoutLogger uses today's date on save).
          if (logging) {
            return (
              <WorkoutLogger
                session={logging}
                items={itemList.filter((i) => i.session_template_slug === logging.slug)}
                exercises={exerciseList}
                phaseSlug={logging.phase_slug}
                onClose={() => setLogging(null)}
              />
            );
          }

          const wStart = weekStart(anchor);

          // Derive the week title and subline
          const rangeLabel =
            view === 'week'
              ? weekRangeLabel(wStart)
              : view === 'month'
                ? parseLocalDate(anchor).toLocaleDateString(undefined, {
                    month: 'long',
                    year: 'numeric',
                  })
                : String(parseLocalDate(anchor).getFullYear());

          const subline =
            view === 'week' ? weekSubline(wStart, ctx, phaseList) : null;

          return (
            <div className="flex min-h-0 flex-col">
              {/* ── Top bar ── */}
              <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                {/* Left: title + subline */}
                <div className="min-w-0">
                  <h1 className="font-display text-data font-bold leading-tight text-text lg:text-[26px]">
                    {rangeLabel}
                  </h1>
                  {subline && (
                    <p className="mt-0.5 font-display text-label font-semibold uppercase tracking-label text-text-dim">
                      {subline}
                    </p>
                  )}
                </div>

                {/* Right: segmented control + nav */}
                <div className="flex shrink-0 items-center gap-2">
                  <Segmented<View>
                    options={VIEW_OPTIONS}
                    value={view}
                    onChange={setView}
                    ariaLabel="Calendar view"
                  />
                  <div className="flex items-center gap-1">
                    <NavBtn onClick={() => step(-1)} label="Previous week">
                      <Icon name="chevron_left" size={20} />
                    </NavBtn>
                    <button
                      onClick={goToday}
                      className="flex min-h-tap items-center gap-1 rounded-md bg-surface-raised px-3 text-body-sm font-display uppercase tracking-label text-text-muted transition-colors duration-fast ease-brand hover:text-text"
                    >
                      <Icon name="today" size={16} className="text-accent" />
                      Today
                    </button>
                    <NavBtn onClick={() => step(1)} label="Next week">
                      <Icon name="chevron_right" size={20} />
                    </NavBtn>
                  </div>
                </div>
              </div>

              {/* ── View bodies ── */}
              {view === 'week' && (
                <WeekView
                  anchor={anchor}
                  ctx={ctx}
                  typeBy={typeBy}
                  exBy={exBy}
                  itemList={itemList}
                  phaseList={phaseList}
                  selectedDay={selectedDay}
                  onSelectDay={setSelectedDay}
                  onStartSession={setLogging}
                />
              )}
              {view === 'month' && (
                <MonthView
                  anchor={anchor}
                  ctx={ctx}
                  selectedDay={selectedDay}
                  onSelectDay={(d) => patch({ view: 'week', anchor: d, day: d })}
                />
              )}
              {view === 'year' && <YearView anchor={anchor} ctx={ctx} raceList={raceList} />}
            </div>
          );
        }}
      </QueryBoundary>
    </TabScaffold>
  );
}

// ─── NavBtn ──────────────────────────────────────────────────────────────────

function NavBtn({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="flex h-tap w-tap items-center justify-center rounded-md bg-surface-raised text-text-muted transition-colors duration-fast ease-brand hover:text-text"
    >
      {children}
    </button>
  );
}

// ─── WeekView ────────────────────────────────────────────────────────────────

interface WeekViewProps {
  anchor: string;
  ctx: Ctx;
  typeBy: Map<string, SaunaType>;
  exBy: Map<string, Exercise>;
  itemList: SessionItem[];
  phaseList: Phase[];
  selectedDay: string;
  onSelectDay: (d: string) => void;
  onStartSession: (s: SessionTemplate) => void;
}

function WeekView({
  anchor,
  ctx,
  typeBy,
  exBy,
  itemList,
  selectedDay,
  onSelectDay,
  onStartSession,
}: WeekViewProps) {
  const start = weekStart(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const today = formatDate(new Date());

  // Ensure selectedDay is within visible week
  const effectiveSelected = days.includes(selectedDay) ? selectedDay : days[0];

  const selectedActivity = useMemo(
    () => activityFor(effectiveSelected, ctx),
    [effectiveSelected, ctx],
  );

  return (
    // Two-pane at lg+: left=list, right=detail
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:gap-4">
      {/* ── Left: day list ── */}
      <div className="space-y-1.5">
        {days.map((d) => {
          const { sessions, slots, heat, race, loggedSessions, loggedSaunas } = activityFor(d, ctx);
          const isToday = d === today;
          const isSelected = d === effectiveSelected;
          const isRunningDay =
            sessions.length === 0 &&
            slots.length === 0 &&
            loggedSessions.length === 0 &&
            loggedSaunas.length === 0 &&
            !race;

          return (
            <button
              key={d}
              onClick={() => onSelectDay(d)}
              className={[
                'group w-full rounded-lg border text-left transition-colors duration-fast ease-brand',
                isSelected
                  ? 'border-accent bg-surface'
                  : race
                    ? 'border-success/50 bg-surface hover:border-success'
                    : heat
                      ? 'border-danger/30 bg-danger/5 hover:border-danger/50'
                      : 'border-border bg-surface hover:border-border-strong',
              ].join(' ')}
            >
              <div className="flex items-stretch">
                {/* Selected accent bar */}
                <div
                  className={[
                    'w-0.5 flex-none rounded-l-lg transition-colors duration-fast ease-brand',
                    isSelected ? 'bg-accent' : 'bg-transparent',
                  ].join(' ')}
                />

                <div className="flex min-w-0 flex-1 items-start gap-3 px-3 py-3">
                  {/* Date stamp */}
                  <div className="w-12 shrink-0 text-left">
                    <p
                      className={[
                        'font-display text-label font-semibold uppercase tracking-label',
                        isToday ? 'text-accent' : 'text-text-dim',
                      ].join(' ')}
                    >
                      {DOW_LABELS[monCol(d)]}
                    </p>
                    <p
                      className={[
                        'font-display text-data font-bold leading-tight',
                        isToday
                          ? 'text-accent'
                          : isSelected
                            ? 'text-text'
                            : 'text-text-muted',
                      ].join(' ')}
                    >
                      {parseLocalDate(d).getDate()}
                    </p>
                  </div>

                  {/* Activity rows */}
                  <div className="min-w-0 flex-1 space-y-1">
                    {race && (
                      <DayRow
                        shape="circle"
                        color="text-success"
                        tone="success"
                        label="Race day"
                        bold
                      />
                    )}
                    {sessions.map((s) => (
                      <DayRow
                        key={s.slug}
                        shape="square"
                        color="text-accent"
                        tone="accent"
                        label={s.name}
                        meta={s.duration_label}
                        done={s.status === 'done'}
                        missed={s.status === 'missed'}
                      />
                    ))}
                    {loggedSessions.map((l) => (
                      <DayRow
                        key={l.id}
                        shape="square"
                        color="text-accent"
                        tone="accent"
                        label={l.session_name}
                        done
                      />
                    ))}
                    {slots.map((slot) => {
                      const t = typeBy.get(slot.sauna_type_slug);
                      return (
                        <DayRow
                          key={slot.slot_key}
                          shape="triangle"
                          color="text-warning"
                          tone="warning"
                          label={t?.name ?? 'Sauna'}
                          meta={slot.is_optional ? 'optional' : undefined}
                          dim={slot.is_optional && !slot.done}
                          done={slot.done}
                        />
                      );
                    })}
                    {loggedSaunas.map((l) => {
                      const t = typeBy.get(l.sauna_type_slug);
                      return (
                        <DayRow
                          key={l.id}
                          shape="triangle"
                          color="text-warning"
                          tone="warning"
                          label={t?.name ?? 'Sauna'}
                          done
                        />
                      );
                    })}
                    {isRunningDay && (
                      <p className="text-body-sm text-text-dim">Running day</p>
                    )}
                  </div>

                  {/* Right badges */}
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {heat && (
                      <Badge tone="danger">
                        <Icon name="local_fire_department" size={11} fill />
                        heat
                      </Badge>
                    )}
                    {isToday && !isSelected && <Badge tone="accent">today</Badge>}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Right: detail pane — stacks below list on mobile, side-by-side at lg+ ── */}
      <div>
        <DayDetail
          dateStr={effectiveSelected}
          activity={selectedActivity}
          ctx={ctx}
          typeBy={typeBy}
          exBy={exBy}
          itemList={itemList}
          onStartSession={onStartSession}
        />
      </div>
    </div>
  );
}

// ─── DayRow (shape + label inside list cells) ─────────────────────────────────

function DayRow({
  shape,
  color,
  tone,
  label,
  meta,
  bold = false,
  dim = false,
  done = false,
  missed = false,
}: {
  shape: 'circle' | 'square' | 'triangle';
  color: string;
  tone: Tone;
  label: string;
  meta?: string;
  bold?: boolean;
  dim?: boolean;
  done?: boolean;
  missed?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 ${dim ? 'opacity-60' : ''}`}>
      <ActivityShape shape={shape} tone={tone} size="sm" />
      <span
        className={`truncate text-body-sm ${
          bold ? 'font-bold text-text' : missed && !done ? 'text-danger' : color
        }`}
      >
        {label}
      </span>
      {done ? (
        <Icon name="check_circle" size={14} fill className="ml-auto shrink-0 text-accent" />
      ) : missed ? (
        <span className="ml-auto shrink-0 text-meta font-semibold uppercase tracking-label text-danger">
          missed
        </span>
      ) : (
        meta && <span className="ml-auto shrink-0 text-meta text-text-dim">{meta}</span>
      )}
    </div>
  );
}

// ─── ActivityShape: ● ■ ▲ for a11y ────────────────────────────────────────────

type Tone = 'success' | 'accent' | 'warning';
// Full literal class names — Tailwind cannot see interpolated ones.
const TONE_TEXT: Record<Tone, string> = {
  success: 'text-success',
  accent: 'text-accent',
  warning: 'text-warning',
};

/**
 * Activity marker. `variant` carries meaning that colour alone must not
 * (A11Y-01): a solid shape is completed, an outlined one is only scheduled.
 * Drawn as SVG so the triangle can be outlined like the other two.
 */
function ActivityShape({
  shape,
  tone,
  size = 'sm',
  variant = 'filled',
}: {
  shape: 'circle' | 'square' | 'triangle';
  tone: Tone;
  size?: 'sm' | 'md';
  variant?: 'filled' | 'outline';
}) {
  const px = size === 'md' ? 10 : 8;
  const filled = variant === 'filled';
  const paint = filled
    ? { fill: 'currentColor', stroke: 'none' }
    : { fill: 'none', stroke: 'currentColor', strokeWidth: 2 };
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 12 12"
      className={`shrink-0 ${TONE_TEXT[tone]}`}
      aria-hidden
      focusable="false"
    >
      {shape === 'circle' && <circle cx="6" cy="6" r="5" {...paint} />}
      {shape === 'square' && <rect x="1" y="1" width="10" height="10" rx="1.5" {...paint} />}
      {shape === 'triangle' && <polygon points="6,1 11,11 1,11" {...paint} />}
    </svg>
  );
}

// ─── DayDetail (right pane / mobile below) ────────────────────────────────────

interface DayDetailProps {
  dateStr: string;
  activity: ReturnType<typeof activityFor>;
  ctx: Ctx;
  typeBy: Map<string, SaunaType>;
  exBy: Map<string, Exercise>;
  itemList: SessionItem[];
  onStartSession: (s: SessionTemplate) => void;
}

function DayDetail({ dateStr, activity, ctx, typeBy, exBy, itemList, onStartSession }: DayDetailProps) {
  const { sessions, slots, heat, race, loggedSessions, loggedSaunas } = activity;
  const today = formatDate(new Date());
  const isToday = dateStr === today;

  const longLabel = parseLocalDate(dateStr)
    .toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })
    .toUpperCase();

  const noActivity =
    sessions.length === 0 &&
    slots.length === 0 &&
    loggedSessions.length === 0 &&
    loggedSaunas.length === 0 &&
    !race;

  return (
    <div className="space-y-4">
      {/* Eyebrow date + badges */}
      <div>
        <Eyebrow
          tone="muted"
          meta={
            <span className="flex items-center gap-1.5">
              {isToday && <Badge tone="accent">today</Badge>}
              {heat && (
                <Badge tone="danger">
                  <Icon name="local_fire_department" size={11} fill />
                  heat block
                </Badge>
              )}
            </span>
          }
        >
          {longLabel}
        </Eyebrow>
      </div>

      {/* Race day card */}
      {race && (
        <Card className="border-success/50 bg-success/5">
          <div className="flex items-center gap-2">
            <ActivityShape shape="circle" tone="success" size="md" />
            <Heading>Race Day</Heading>
          </div>
          {ctx.raceDate && (
            <p className="mt-1 text-body-sm text-text-muted">
              {daysBetween(today, ctx.raceDate) === 0
                ? "It's race day — go!"
                : `${Math.abs(daysBetween(today, ctx.raceDate))} days ${daysBetween(today, ctx.raceDate) > 0 ? 'to go' : 'ago'}`}
            </p>
          )}
        </Card>
      )}

      {/* Strength sessions */}
      {sessions.map((s) => {
        const exs = itemList.filter((i) => i.session_template_slug === s.slug);
        return (
          <Card key={s.slug}>
            <Eyebrow bullet meta={`${s.duration_label} · ${exs.length} moves`}>
              Strength
            </Eyebrow>
            <div className="mt-2 flex items-center gap-2">
              <Heading>{s.name}</Heading>
              <SessionStatusBadge status={s.status} />
            </div>
            {s.brief && (
              <p className="mt-1 text-body-sm text-text-muted">{s.brief}</p>
            )}

            {exs.length > 0 && (
              <ol className="mt-3 space-y-1.5">
                {exs.map((item, idx) => {
                  const ex = exBy.get(item.exercise_slug);
                  return (
                    <li key={item.id} className="flex items-baseline gap-2.5">
                      <span className="w-5 shrink-0 font-display text-label font-semibold text-text-dim">
                        {idx + 1}
                      </span>
                      <span className="flex-1 text-body-sm text-text">
                        {ex?.name ?? item.exercise_slug}
                      </span>
                      <span className="shrink-0 text-meta text-text-dim">
                        {item.prescription}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}

            <div className="mt-4">
              <Button
                full
                variant={s.status === 'done' ? 'ghost' : 'primary'}
                onClick={() => onStartSession(s)}
              >
                {s.status === 'done' ? 'Log again' : 'Start session'}{' '}
                <Icon name="play_arrow" size={18} fill />
              </Button>
              {!isToday && s.status !== 'done' && (
                <p className="mt-1.5 text-center text-meta text-text-dim">
                  Logs as done today
                </p>
              )}
            </div>
          </Card>
        );
      })}

      {/* Sessions actually logged this day that weren't on the plan (moved / ad-hoc) */}
      {loggedSessions.map((l) => (
        <Card key={l.id}>
          <div className="flex items-center justify-between">
            <Eyebrow bullet>Strength</Eyebrow>
            <Badge tone="accent">
              <Icon name="check_circle" size={11} fill />
              logged
            </Badge>
          </div>
          <Heading className="mt-2">{l.session_name}</Heading>
          <p className="mt-1 text-body-sm text-text-muted">Logged on this day.</p>
        </Card>
      ))}

      {/* Sauna slots */}
      {slots.map((slot) => {
        const t = typeBy.get(slot.sauna_type_slug);
        return (
          <Card key={slot.slot_key}>
            <div className="flex items-start gap-3">
              <Icon
                name="local_fire_department"
                size={24}
                fill
                className="mt-0.5 shrink-0 text-warning"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Heading>{t?.name ?? 'Sauna'}</Heading>
                  {slot.done ? (
                    <Badge tone="accent">
                      <Icon name="check_circle" size={11} fill />
                      done
                    </Badge>
                  ) : slot.is_optional ? (
                    <Badge tone="warning">optional</Badge>
                  ) : (
                    <Badge tone="accent">planned</Badge>
                  )}
                  {slot.is_block && <Badge tone="danger">heat block</Badge>}
                </div>
                {t && (
                  <p className="mt-0.5 text-body-sm text-text-muted">
                    {t.duration_label} · {t.temp_label}
                  </p>
                )}
                {slot.note && (
                  <p className="mt-1 text-meta text-text-dim">{slot.note}</p>
                )}
              </div>
            </div>
          </Card>
        );
      })}

      {/* Ad-hoc saunas logged this day (no matching planned slot) */}
      {loggedSaunas.map((l) => {
        const t = typeBy.get(l.sauna_type_slug);
        return (
          <Card key={l.id}>
            <div className="flex items-start gap-3">
              <Icon
                name="local_fire_department"
                size={24}
                fill
                className="mt-0.5 shrink-0 text-warning"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Heading>{t?.name ?? 'Sauna'}</Heading>
                  <Badge tone="accent">
                    <Icon name="check_circle" size={11} fill />
                    logged
                  </Badge>
                </div>
                <p className="mt-0.5 text-body-sm text-text-muted">
                  {[
                    l.duration_min != null ? `${l.duration_min} min` : t?.duration_label,
                    l.temp_c != null ? `${l.temp_c} °C` : t?.temp_label,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
            </div>
          </Card>
        );
      })}

      {/* Running / rest day */}
      {noActivity && (
        <Card>
          <p className="text-body-sm text-text-muted">
            Running or rest day — no strength or sauna scheduled.
          </p>
        </Card>
      )}
    </div>
  );
}

function SessionStatusBadge({ status }: { status: SessionStatus }) {
  if (status === 'done')
    return (
      <Badge tone="accent">
        <Icon name="check_circle" size={11} fill />
        done
      </Badge>
    );
  if (status === 'missed') return <Badge tone="danger">missed</Badge>;
  if (status === 'today') return <Badge tone="accent">today</Badge>;
  return <Badge tone="neutral">upcoming</Badge>;
}

// ─── MonthView ────────────────────────────────────────────────────────────────

interface MonthViewProps {
  anchor: string;
  ctx: Ctx;
  selectedDay: string;
  onSelectDay: (dateStr: string) => void;
}

function MonthView({ anchor, ctx, selectedDay, onSelectDay }: MonthViewProps) {
  const cells = monthCells(anchor);
  const month = parseLocalDate(anchor).getMonth();
  const today = formatDate(new Date());
  const hb = heatBlock(ctx.raceDate);

  // Heat-block summary (redesign frame 12): count strength sessions and the
  // weekdays with no strength/sauna across the block window.
  let blockSessions = 0;
  const restCols = new Set<number>();
  if (hb) {
    for (let d = hb.start; d <= hb.end; d = addDays(d, 1)) {
      const { sessions, slots } = activityFor(d, ctx);
      blockSessions += sessions.length;
      if (sessions.length === 0 && slots.length === 0) restCols.add(monCol(d));
    }
  }
  const restLabel = [...restCols]
    .sort((a, b) => a - b)
    .map((c) => DOW_LABELS[c])
    .join(' & ');
  const fmtShort = (s: string) =>
    parseLocalDate(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  return (
    <div>
      {/* Legend top-right — shape carries the activity, fill carries completion. */}
      <div className="mb-3 flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
        <MonthLegendItem shape="circle" tone="success" label="race" />
        <MonthLegendItem shape="square" tone="accent" label="strength" />
        <MonthLegendItem shape="triangle" tone="warning" label="sauna" />
        <span className="text-meta text-text-dim">solid = done · outline = scheduled</span>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-px">
        {DOW_LABELS.map((l) => (
          <div
            key={l}
            className="py-1 text-center font-display text-label font-semibold uppercase tracking-label text-text-dim"
          >
            {l}
          </div>
        ))}

        {cells.map((d) => {
          const inMonth = parseLocalDate(d).getMonth() === month;
          const isToday = d === today;
          const isSelected = d === selectedDay;
          const { sessions, slots, heat, race, loggedSessions, loggedSaunas } = activityFor(d, ctx);

          // Scheduled vs completed are distinguished by fill, not colour, and
          // spelled out in the label for screen readers (CAL-01 / A11Y-01).
          const strengthDone = loggedSessions.length > 0 || sessions.some((x) => x.status === 'done');
          const strengthPlanned = sessions.length > 0;
          const saunaDone = loggedSaunas.length > 0;
          const saunaPlanned = slots.length > 0;

          const notes: string[] = [];
          if (race) notes.push('race day');
          if (strengthDone) notes.push('strength completed');
          else if (strengthPlanned) notes.push('strength scheduled');
          if (saunaDone) notes.push('sauna completed');
          else if (saunaPlanned) notes.push('sauna scheduled');
          if (heat) notes.push('heat block');
          const label = [
            parseLocalDate(d).toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            }),
            notes.length ? notes.join(', ') : 'nothing scheduled',
            // Selection is stated in words: these buttons navigate rather than
            // toggle, so aria-pressed would misdescribe them.
            isSelected ? 'selected' : null,
          ]
            .filter(Boolean)
            .join('. ');

          return (
            <button
              key={d}
              type="button"
              onClick={() => onSelectDay(d)}
              aria-label={label}
              aria-current={isToday ? 'date' : undefined}
              className={[
                'flex aspect-square flex-col items-center justify-between rounded-md border p-1',
                'transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2',
                'focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg',
                race
                  ? 'border-success/60 bg-success/20 text-text'
                  : heat && inMonth
                    ? 'border-danger/30 bg-danger/10 text-text'
                    : inMonth
                      ? 'border-border bg-surface text-text hover:border-border-strong'
                      : 'border-transparent text-text-dim hover:border-border',
                isSelected ? 'ring-2 ring-inset ring-accent' : '',
                isToday && !isSelected ? 'ring-1 ring-inset ring-accent' : '',
                !inMonth ? 'opacity-40' : '',
              ].join(' ')}
            >
              <span className="self-start text-meta leading-none">
                {parseLocalDate(d).getDate()}
              </span>
              {/* Shape markers bottom — solid = done, outline = scheduled. */}
              <span className="flex items-center gap-0.5">
                {race && <ActivityShape shape="circle" tone="success" />}
                {(strengthDone || strengthPlanned) && (
                  <ActivityShape
                    shape="square"
                    tone="accent"
                    variant={strengthDone ? 'filled' : 'outline'}
                  />
                )}
                {(saunaDone || saunaPlanned) && (
                  <ActivityShape
                    shape="triangle"
                    tone="warning"
                    variant={saunaDone ? 'filled' : 'outline'}
                  />
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* Heat-block summary bar */}
      {hb && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2">
          <ActivityShape shape="circle" tone="success" size="md" />
          <p className="text-body-sm text-text-muted">
            Heat block {fmtShort(hb.start)} – {fmtShort(hb.end)}
            {blockSessions > 0 ? ` · ${blockSessions} sessions` : ''}
            {restLabel ? ` · rest ${restLabel}` : ''}
            {ctx.raceDate ? `. Race day ${fmtShort(ctx.raceDate)}` : ''}
          </p>
        </div>
      )}
    </div>
  );
}

function MonthLegendItem({
  shape,
  tone,
  label,
}: {
  shape: 'circle' | 'square' | 'triangle';
  tone: Tone;
  label: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <ActivityShape shape={shape} tone={tone} size="sm" />
      <span className="font-display text-label uppercase tracking-label text-text-dim">
        {label}
      </span>
    </span>
  );
}

// ─── YearView ────────────────────────────────────────────────────────────────

function YearView({ anchor, ctx, raceList }: { anchor: string; ctx: Ctx; raceList: Race[] }) {
  const year = parseLocalDate(anchor).getFullYear();
  const today = formatDate(new Date());

  const upcoming = raceList
    .filter((r) => r.race_date >= today)
    .sort((a, b) => (a.race_date < b.race_date ? -1 : 1));

  return (
    <div>
      {/* 12 mini-month grids */}
      <div className="grid grid-cols-3 gap-4 narrow:grid-cols-2">
        {Array.from({ length: 12 }, (_, m) => {
          const monthAnchor = formatDate(new Date(year, m, 15));
          const cells = monthCells(monthAnchor);
          const label = parseLocalDate(monthAnchor).toLocaleDateString(undefined, {
            month: 'short',
          });
          // Detect if this month contains a heat block or race
          const hasRace = cells.some(
            (d) => parseLocalDate(d).getMonth() === m && d === ctx.raceDate,
          );

          return (
            <div key={m} className="rounded-lg border border-border bg-surface p-3">
              <p
                className={[
                  'mb-2 font-display text-label font-semibold uppercase tracking-label',
                  hasRace ? 'text-success' : 'text-text-dim',
                ].join(' ')}
              >
                {label}
              </p>
              <div className="grid grid-cols-7 gap-px">
                {cells.map((d) => {
                  const inMonth = parseLocalDate(d).getMonth() === m;
                  const { sessions, slots, heat, race, loggedSessions, loggedSaunas } =
                    activityFor(d, ctx);
                  const active =
                    sessions.length > 0 ||
                    slots.length > 0 ||
                    loggedSessions.length > 0 ||
                    loggedSaunas.length > 0;
                  return (
                    <i
                      key={d}
                      className={[
                        'aspect-square rounded-[1px]',
                        !inMonth
                          ? 'bg-transparent'
                          : race
                            ? 'bg-success'
                            : heat
                              ? 'bg-danger/60'
                              : active
                                ? 'bg-accent/70'
                                : 'bg-surface-raised',
                      ].join(' ')}
                      aria-hidden
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Coming up races */}
      {upcoming.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 font-display text-label font-semibold uppercase tracking-label text-text-dim">
            Coming up
          </p>
          <div className="space-y-2">
            {upcoming.map((r) => {
              const daysLeft = daysBetween(today, r.race_date);
              return (
                <div
                  key={r.race_date}
                  className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3"
                >
                  {r.is_target && (
                    <Icon
                      name="star"
                      size={18}
                      fill
                      className="shrink-0 text-success"
                      label="Target race"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-body-sm font-bold text-text">
                      {r.name}
                    </p>
                    <p className="text-meta text-text-dim">
                      {parseLocalDate(r.race_date).toLocaleDateString(undefined, {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                      {r.distance != null && r.unit
                        ? ` · ${r.distance} ${r.unit}`
                        : r.distance != null
                          ? ` · ${r.distance}`
                          : ''}
                    </p>
                  </div>
                  <span className="shrink-0 font-display text-data font-bold text-text-muted">
                    {daysLeft}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
