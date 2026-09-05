/*
 * Statistics (STAT-01).
 *
 * What changed and why:
 *   - The tonnage chart carried its numbers in a `title` attribute, which is
 *     invisible to touch and to the keyboard. Every bar is now a button that
 *     reveals the same figures on tap, click or Enter.
 *   - "Personal bests" claimed more than the data supports. It is the heaviest
 *     SET ever logged for a lift, not a tested one-rep max or an estimate of
 *     capability, and it is now labelled as such.
 *   - Sets with zero load are real training (bodyweight, carries, holds) but
 *     have no meaningful "heaviest". They are counted by reps instead of being
 *     silently dropped.
 *   - Planned-versus-completed states its denominator and date range rather
 *     than presenting a bare percentage — see `src/domain/completion.ts`.
 *   - Falling tonnage in a taper is the plan working. The chart says so, so a
 *     downward trend is not read as a lapse.
 *
 * History is READ-ONLY. Editing, deleting and backdating are gated on D-05.
 */
import { useMemo, useState } from 'react';
import { TabScaffold } from '@/components/TabScaffold';
import { Card, Eyebrow, Badge, QueryBoundary } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useExercises, usePhases, useSessionTemplates } from '@/data/reference';
import {
  useWorkoutLogs,
  useAllSets,
  useSaunaLogs,
  useRaces,
  useUserSettings,
  type SaunaLog,
  type WorkoutLog,
  type SetWithDate,
} from '@/data/user';
import { addDays, formatDate, parseLocalDate } from '@/domain/dates';
import { completionOverRange, saunaTally } from '@/domain/completion';
import type { PhaseOverride, PhaseSlug } from '@/domain/phase';
import type { Exercise, Phase } from '@/data/reference';
import type { SessionTemplate } from '@/domain/schedule';

/** How far back the compliance figure looks. Stated in the UI, never implied. */
const WINDOW_DAYS = 28;

export function StatsPage() {
  const logs = useWorkoutLogs();
  const sets = useAllSets();
  const exercises = useExercises();
  const saunaLogs = useSaunaLogs();
  const templates = useSessionTemplates();
  const races = useRaces();
  const settings = useUserSettings();
  const phases = usePhases();

  return (
    <TabScaffold title="Stats">
      <QueryBoundary
        queries={[logs, sets, exercises, saunaLogs, templates, races, settings, phases]}
      >
        {([logList, setList, exerciseList, saunaList, templateList, raceList, userSettings, phaseList]) => (
          <StatsInner
            logs={logList}
            sets={setList}
            exercises={exerciseList}
            saunaLogs={saunaList}
            templates={templateList}
            raceDate={raceList.find((r) => r.is_target)?.race_date ?? null}
            override={
              userSettings?.phase_override && userSettings.phase_override_from
                ? {
                    phase: userSettings.phase_override as PhaseSlug,
                    from: userSettings.phase_override_from,
                  }
                : null
            }
            phases={phaseList}
          />
        )}
      </QueryBoundary>
    </TabScaffold>
  );
}

function StatsInner({
  logs,
  sets,
  exercises,
  saunaLogs,
  templates,
  raceDate,
  override,
  phases,
}: {
  logs: WorkoutLog[];
  sets: SetWithDate[];
  exercises: Exercise[];
  saunaLogs: SaunaLog[];
  templates: SessionTemplate[];
  raceDate: string | null;
  override: PhaseOverride | null;
  phases: Phase[];
}) {
  const nameBy = useMemo(() => new Map(exercises.map((e) => [e.slug, e.name])), [exercises]);
  const phaseLabel = (slug: string) => phases.find((p) => p.slug === slug)?.short_label ?? slug;

  const today = formatDate(new Date());
  const windowStart = addDays(today, -(WINDOW_DAYS - 1));

  const setsByLog = useMemo(() => {
    const m = new Map<string, SetWithDate[]>();
    for (const s of sets) (m.get(s.workout_log_id) ?? m.set(s.workout_log_id, []).get(s.workout_log_id)!).push(s);
    for (const list of m.values()) list.sort((a, b) => a.set_no - b.set_no);
    return m;
  }, [sets]);

  const tonnageByLog = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sets) m.set(s.workout_log_id, (m.get(s.workout_log_id) ?? 0) + Number(s.weight_kg) * s.reps);
    return m;
  }, [sets]);

  /** Heaviest single logged set per lift, and separately the zero-load work. */
  const { loaded, bodyweight } = useMemo(() => {
    const best = new Map<string, { weight: number; reps: number; on: string }>();
    const reps = new Map<string, { reps: number; sessions: Set<string> }>();
    for (const s of sets) {
      const w = Number(s.weight_kg);
      if (w > 0) {
        const cur = best.get(s.exercise_slug);
        if (!cur || w > cur.weight) best.set(s.exercise_slug, { weight: w, reps: s.reps, on: s.logged_on });
      } else {
        // Zero load is real training, not missing data.
        const cur = reps.get(s.exercise_slug) ?? { reps: 0, sessions: new Set<string>() };
        cur.reps += s.reps;
        cur.sessions.add(s.workout_log_id);
        reps.set(s.exercise_slug, cur);
      }
    }
    return {
      loaded: [...best.entries()].sort((a, b) => b[1].weight - a[1].weight),
      bodyweight: [...reps.entries()].sort((a, b) => b[1].reps - a[1].reps),
    };
  }, [sets]);

  const completion = useMemo(
    () =>
      completionOverRange(
        { from: windowStart, to: today, templates, raceDate, override, logs },
        today,
      ),
    [windowStart, today, templates, raceDate, override, logs],
  );
  const sauna = useMemo(
    () => saunaTally(saunaLogs, windowStart, today),
    [saunaLogs, windowStart, today],
  );

  const [openLog, setOpenLog] = useState<string | null>(null);

  if (logs.length === 0) {
    return (
      <Card>
        <p className="text-body-sm text-text-muted">
          Nothing logged yet. Your first session writes the first line of the story — session
          history, heaviest sets and weekly tonnage all land here.
        </p>
      </Card>
    );
  }

  const recent = [...logs].sort((a, b) => a.logged_on.localeCompare(b.logged_on)).slice(-10);
  const maxTon = Math.max(1, ...recent.map((l) => tonnageByLog.get(l.id) ?? 0));
  const byMonth = groupByMonth(logs);
  const fmtRange = `${short(windowStart)} – ${short(today)}`;

  return (
    <div className="space-y-5">
      <TonnageChart
        logs={recent}
        tonnageByLog={tonnageByLog}
        maxTon={maxTon}
        phaseLabel={phaseLabel}
      />

      {/* Planned vs completed — denominator and range both stated */}
      <section>
        <Eyebrow>Strength sessions · last {WINDOW_DAYS} days</Eyebrow>
        <Card className="mt-1">
          {completion.scheduled === 0 ? (
            <p className="text-body-sm text-text-muted">
              No strength sessions were scheduled between {fmtRange}.
            </p>
          ) : (
            <>
              <p className="font-display text-data font-bold text-text">
                {completion.completed} of {completion.scheduled} scheduled sessions
              </p>
              <p className="mt-1 text-meta text-text-dim">
                {fmtRange}. Counts each scheduled session once, however many times it was
                logged.
                {completion.unplanned > 0 &&
                  ` ${completion.unplanned} extra session${completion.unplanned === 1 ? '' : 's'} logged outside the schedule, counted separately.`}
              </p>
            </>
          )}
          <p className="mt-2 text-meta text-text-dim">
            Sauna is not counted here — it is optional, so a rest day is not a miss.{' '}
            {sauna.logged} sauna session{sauna.logged === 1 ? '' : 's'} logged in the same
            period.
          </p>
        </Card>
      </section>

      {/* Heaviest logged sets */}
      {loaded.length > 0 && (
        <section>
          <Eyebrow>Heaviest logged set</Eyebrow>
          <Card className="mt-1 divide-y divide-border p-0">
            {loaded.slice(0, 12).map(([slug, v]) => (
              <div key={slug} className="flex items-center justify-between gap-3 p-3">
                <span className="min-w-0 flex-1 truncate text-body-sm text-text">
                  {nameBy.get(slug) ?? slug}
                </span>
                <span className="shrink-0 font-display text-data font-bold text-text">
                  {v.weight} kg{' '}
                  <span className="text-meta font-normal text-text-dim">
                    × {v.reps} · {short(v.on)}
                  </span>
                </span>
              </div>
            ))}
          </Card>
          <p className="mt-1 px-1 text-meta text-text-dim">
            The heaviest single set recorded, not a tested max or an estimate of what you could
            lift.
          </p>
        </section>
      )}

      {/* Zero-load work, which has no "heaviest" */}
      {bodyweight.length > 0 && (
        <section>
          <Eyebrow>Bodyweight &amp; unloaded work</Eyebrow>
          <Card className="mt-1 divide-y divide-border p-0">
            {bodyweight.slice(0, 8).map(([slug, v]) => (
              <div key={slug} className="flex items-center justify-between gap-3 p-3">
                <span className="min-w-0 flex-1 truncate text-body-sm text-text">
                  {nameBy.get(slug) ?? slug}
                </span>
                <span className="shrink-0 text-body-sm text-text-muted">
                  {v.reps} reps across {v.sessions.size} session{v.sessions.size === 1 ? '' : 's'}
                </span>
              </div>
            ))}
          </Card>
          <p className="mt-1 px-1 text-meta text-text-dim">
            Logged without added load, so counted by reps rather than weight.
          </p>
        </section>
      )}

      {/* History, grouped by month */}
      <section>
        <Eyebrow>Session history</Eyebrow>
        {byMonth.map(([month, monthLogs]) => (
          <div key={month} className="mt-3">
            <p className="px-1 font-display text-label font-semibold uppercase tracking-label text-text-dim">
              {month} · {monthLogs.length} session{monthLogs.length === 1 ? '' : 's'}
            </p>
            <div className="mt-1 space-y-2">
              {monthLogs.map((l) => (
                <SessionRow
                  key={l.id}
                  log={l}
                  tonnage={tonnageByLog.get(l.id) ?? 0}
                  sets={setsByLog.get(l.id) ?? []}
                  nameBy={nameBy}
                  phaseLabel={phaseLabel}
                  open={openLog === l.id}
                  onToggle={() => setOpenLog(openLog === l.id ? null : l.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* Sauna history */}
      <section>
        <Eyebrow>Sauna history</Eyebrow>
        <Card className="mt-1 divide-y divide-border p-0">
          {saunaLogs.length === 0 ? (
            <p className="p-3 text-body-sm text-text-muted">No sauna sessions logged yet.</p>
          ) : (
            [...saunaLogs]
              .sort((a, b) => b.logged_on.localeCompare(a.logged_on))
              .slice(0, 20)
              .map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-3 p-3">
                  <span className="text-body-sm text-text">{short(s.logged_on)}</span>
                  <span className="text-meta text-text-dim">
                    {[
                      s.duration_min != null ? `${s.duration_min} min` : null,
                      s.temp_c != null ? `${s.temp_c} °C` : null,
                      s.weight_before_kg != null && s.weight_after_kg != null
                        ? `${(Number(s.weight_before_kg) - Number(s.weight_after_kg)).toFixed(1)} kg lost`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'logged'}
                  </span>
                </div>
              ))
          )}
        </Card>
      </section>
    </div>
  );
}

/* ── Tonnage chart ────────────────────────────────────────────────────────── */

/**
 * The numbers used to live in a `title` attribute: pointer-only, so a phone and
 * a keyboard both got nothing. Each bar is a button now, and the selected
 * figures are rendered as text (A11Y-01, STAT-01).
 */
function TonnageChart({
  logs,
  tonnageByLog,
  maxTon,
  phaseLabel,
}: {
  logs: WorkoutLog[];
  tonnageByLog: Map<string, number>;
  maxTon: number;
  phaseLabel: (slug: string) => string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const shown = logs.find((l) => l.id === selected) ?? logs[logs.length - 1] ?? null;
  const shownTonnage = shown ? (tonnageByLog.get(shown.id) ?? 0) : 0;

  return (
    <section>
      <Eyebrow>Session tonnage · last {logs.length}</Eyebrow>
      <Card className="mt-1">
        <div className="flex h-32 items-end gap-1" role="group" aria-label="Session tonnage">
          {logs.map((l) => {
            const v = tonnageByLog.get(l.id) ?? 0;
            const isSelected = shown?.id === l.id;
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => setSelected(l.id)}
                aria-pressed={isSelected}
                aria-label={`${l.session_name}, ${short(l.logged_on)}: ${v.toLocaleString()} kg total`}
                className={[
                  'flex flex-1 items-end rounded-t-sm transition-colors duration-fast',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  isSelected ? 'bg-accent' : 'bg-accent/50 hover:bg-accent/80',
                ].join(' ')}
                style={{ height: `${Math.max(3, (v / maxTon) * 100)}%` }}
              />
            );
          })}
        </div>

        {shown && (
          <p className="mt-2 text-body-sm text-text">
            <span className="font-display font-bold">{shownTonnage.toLocaleString()} kg</span>{' '}
            <span className="text-text-dim">
              · {shown.session_name} · {short(shown.logged_on)} · {phaseLabel(shown.phase_slug)}
            </span>
          </p>
        )}
        <p className="mt-1 text-meta text-text-dim">
          Total kg per session (weight × reps). Tap a bar for its figures. Expect this to fall
          during the taper — that is the plan working, not a lapse.
        </p>
      </Card>
    </section>
  );
}

/* ── History row with read-only drilldown ─────────────────────────────────── */

function SessionRow({
  log,
  tonnage,
  sets,
  nameBy,
  phaseLabel,
  open,
  onToggle,
}: {
  log: WorkoutLog;
  tonnage: number;
  sets: SetWithDate[];
  nameBy: Map<string, string>;
  phaseLabel: (slug: string) => string;
  open: boolean;
  onToggle: () => void;
}) {
  const byExercise = useMemo(() => {
    const m = new Map<string, SetWithDate[]>();
    for (const s of sets) (m.get(s.exercise_slug) ?? m.set(s.exercise_slug, []).get(s.exercise_slug)!).push(s);
    return [...m.entries()];
  }, [sets]);

  return (
    <Card className="p-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      >
        <span className="min-w-0">
          <span className="block font-display text-data font-bold text-text">
            {log.session_name}
          </span>
          <span className="block text-meta text-text-dim">
            {parseLocalDate(log.logged_on).toLocaleDateString(undefined, {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
            })}
            {sets.length > 0 ? ` · ${sets.length} set${sets.length === 1 ? '' : 's'}` : ''}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <Badge>{phaseLabel(log.phase_slug)}</Badge>
          <span className="text-body-sm text-text-muted">{tonnage.toLocaleString()} kg</span>
          <Icon name={open ? 'expand_less' : 'expand_more'} size={18} className="text-text-dim" />
        </span>
      </button>

      {open && (
        <div className="border-t border-border p-4 pt-3">
          {byExercise.length === 0 ? (
            <p className="text-body-sm text-text-dim">
              This session was saved without any sets.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {byExercise.map(([slug, rows]) => (
                <li key={slug} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 flex-1 truncate text-body-sm text-text-muted">
                    {nameBy.get(slug) ?? slug}
                  </span>
                  <span className="shrink-0 text-body-sm tabular-nums text-text">
                    {rows.map((r) => `${r.weight_kg}×${r.reps}`).join('  ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {log.notes && (
            <p className="mt-3 border-t border-border pt-3 text-body-sm text-text-muted">
              {log.notes}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

/* ── helpers ──────────────────────────────────────────────────────────────── */

const short = (dateStr: string) =>
  parseLocalDate(dateStr).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** Newest month first, newest session first within it. */
function groupByMonth(logs: WorkoutLog[]): [string, WorkoutLog[]][] {
  const m = new Map<string, WorkoutLog[]>();
  for (const l of [...logs].sort((a, b) => b.logged_on.localeCompare(a.logged_on))) {
    const label = parseLocalDate(l.logged_on).toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    });
    (m.get(label) ?? m.set(label, []).get(label)!).push(l);
  }
  return [...m.entries()];
}
