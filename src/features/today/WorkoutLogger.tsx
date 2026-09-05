import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Button, Eyebrow, Chip } from '@/components/ui';
import { parseHold, prescribedSets } from '@/domain/prescription';
import { formatDate, parseLocalDate } from '@/domain/dates';
import { lastOccurrence } from '@/domain/prefill';
import { embedUrl } from '@/domain/youtube';
import {
  useAllSets,
  useSaveWorkout,
  useUserSettings,
  useSetRestOverride,
  useUserId,
  type SetWithDate,
  type RestOverrides,
} from '@/data/user';
import { useWorkoutDraft } from '@/data/sync/drafts';
import type { SessionItem, Exercise } from '@/data/reference';
import type { SessionTemplate } from '@/domain/schedule';
import { CountdownTimer } from './CountdownTimer';
import { SetKeypad, type EditField } from './SetKeypad';
import { useWakeLock } from './useWakeLock';

interface Props {
  session: SessionTemplate;
  items: SessionItem[];
  exercises: Exercise[];
  phaseSlug: string;
  onClose: () => void;
  /**
   * The date this session is logged under. Defaults to today.
   *
   * Calendar carryover deliberately records a session done from another day as
   * done TODAY (WORK-03); the difference is now disclosed in the header rather
   * than being silent. Backdating is a separate decision (D-05).
   */
  loggedOn?: string;
}

interface Row {
  weight: number;
  reps: number;
  done: boolean;
}

/**
 * Rows to open an exercise with: the sets from the last workout that actually
 * contained it, or `blankRows` empty rows when there is no history — seeded from
 * the prescribed set count so a fresh exercise opens with the right number of
 * sets (SPEC §6.1). The user can still add more.
 *
 * `lastOccurrence` picks a single workout rather than a date, so two sessions
 * logged on one day no longer merge into a set list that never happened.
 */
function prefill(slug: string, allSets: SetWithDate[], blankRows: number): Row[] {
  const rows = lastOccurrence(slug, allSets).map((s) => ({
    weight: Number(s.weight_kg),
    reps: s.reps,
    done: false,
  }));
  if (rows.length) return rows;
  return Array.from({ length: Math.max(1, blankRows) }, () => ({ weight: 0, reps: 0, done: false }));
}

const REST_FALLBACK = 90;
// `nonce` forces a fresh <CountdownTimer> mount for every rest/hold so it always
// autostarts from the top — without it a second rest reuses the finished timer's
// state and appears stuck until manually restarted.
type Timer =
  | { kind: 'rest'; seconds: number; nonce: number; exerciseSlug?: string }
  | { kind: 'hold'; seconds: number; perSide: boolean; nonce: number };

/**
 * Scroll to a section, honouring the OS reduced-motion setting (A11Y-01).
 * A smooth scroll mid-workout is exactly the kind of movement that triggers
 * vestibular symptoms, and the CSS duration tokens cannot reach this API.
 */
function scrollToSection(el: Element | null | undefined) {
  if (!el) return;
  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
}

/** Format elapsed seconds as M:SS */
function fmtElapsed(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function WorkoutLogger({
  session,
  items,
  exercises,
  phaseSlug,
  onClose,
  loggedOn,
}: Props) {
  const allSets = useAllSets();
  const save = useSaveWorkout();
  const userId = useUserId();
  const today = formatDate(new Date());
  const logDate = loggedOn ?? today;
  const nameBy = useMemo(() => new Map(exercises.map((e) => [e.slug, e.name])), [exercises]);
  const exBy = useMemo(() => new Map(exercises.map((e) => [e.slug, e])), [exercises]);
  // Prescribed set count per exercise — seeds blank rows for a fresh exercise.
  const prescribedBy = useMemo(
    () => new Map(items.map((it) => [it.exercise_slug, prescribedSets(it.prescription)])),
    [items],
  );
  const blankRowsFor = (slug: string) => prescribedBy.get(slug) ?? 3;

  // Effective rest for an exercise: the user's saved override wins over the
  // shared reference default, then a hard fallback.
  const settings = useUserSettings();
  const setRestOverride = useSetRestOverride();
  const restOverrides = (settings.data?.rest_overrides ?? {}) as RestOverrides;
  const restFor = (slug: string) =>
    restOverrides[slug] ?? exBy.get(slug)?.rest_seconds ?? REST_FALLBACK;

  // Durable draft: the logger used to hold sets in state alone, so a phone that
  // backgrounded mid-session and got reclaimed lost the workout (WORK-01).
  const draft = useWorkoutDraft(userId, session.session_key, logDate);
  const [sets, setSets] = useState<Record<string, Row[]>>({});
  const [reviewing, setReviewing] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [timer, setTimer] = useState<Timer | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [nextExpanded, setNextExpanded] = useState(false);
  // Which set/field the custom keypad is editing (frame 1c); null = keypad closed.
  const [editing, setEditing] = useState<{ slug: string; row: number; field: EditField } | null>(
    null,
  );
  // The "set up while you rest" handoff (frame 8) — set only on a lift's final
  // rest, pointing at the next exercise. Cleared when the timer clears.
  const [handoff, setHandoff] = useState<{ nextIdx: number } | null>(null);
  const startRef = useRef(Date.now());
  const nonceRef = useRef(0);
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);
  const finishRef = useRef<HTMLDivElement | null>(null);

  // Keep the screen awake for the whole session, not just while a timer runs.
  useWakeLock(true);

  const startRest = (seconds: number, exerciseSlug?: string) =>
    setTimer({ kind: 'rest', seconds, exerciseSlug, nonce: ++nonceRef.current });
  const startHold = (seconds: number, perSide: boolean) =>
    setTimer({ kind: 'hold', seconds, perSide, nonce: ++nonceRef.current });
  const clearTimer = () => {
    setTimer(null);
    setHandoff(null);
  };
  // next → advance the keypad: weight → reps → next set's weight → close.
  const advanceEditing = () =>
    setEditing((e) => {
      if (!e) return e;
      if (e.field === 'weight') return { ...e, field: 'reps' };
      const rows = rowsFor(e.slug);
      if (e.row + 1 < rows.length) return { slug: e.slug, row: e.row + 1, field: 'weight' };
      return null;
    });
  const goNow = (nextIdx: number) => {
    clearTimer();
    scrollToSection(sectionRefs.current[nextIdx]);
  };

  // Wall-clock elapsed ticker
  useEffect(() => {
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  // Restore a saved draft once, on open. Runs only when the draft store has
  // finished loading, so it cannot race the first edit.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !draft.loaded) return;
    restored.current = true;
    if (draft.draft) setSets(draft.draft.sets);
  }, [draft.loaded, draft.draft]);

  /** Apply a change to the rows and persist it. */
  const writeSets = (next: (prev: Record<string, Row[]>) => Record<string, Row[]>) =>
    setSets((prev) => {
      const value = next(prev);
      draft.save({
        session_name: session.name,
        phase_slug: phaseSlug,
        sets: value,
      });
      return value;
    });

  const rowsFor = (slug: string): Row[] =>
    sets[slug] ?? prefill(slug, allSets.data ?? [], blankRowsFor(slug));
  const update = (slug: string, i: number, patch: Partial<Row>) =>
    writeSets((prev) => {
      const rows = [...(prev[slug] ?? prefill(slug, allSets.data ?? [], blankRowsFor(slug)))];
      rows[i] = { ...rows[i], ...patch };
      return { ...prev, [slug]: rows };
    });
  const addSet = (slug: string) =>
    writeSets((prev) => {
      const rows = prev[slug] ?? prefill(slug, allSets.data ?? [], blankRowsFor(slug));
      const last = rows[rows.length - 1] ?? { weight: 0, reps: 0 };
      return { ...prev, [slug]: [...rows, { weight: last.weight, reps: 0, done: false }] };
    });

  /*
   * Which sets will be written. Eligibility is unchanged — `done || reps > 0`,
   * matching SPEC §6.1 — because changing completion semantics needs a product
   * decision (D-01), and zeroing prefilled reps by default is explicitly ruled
   * out. Instead the review sheet shows exactly what is about to be saved, and
   * `excluded` lets the user drop a line they did not actually do.
   */
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const lineId = (slug: string, i: number) => `${slug}#${i}`;

  const eligible = items.flatMap((it) =>
    rowsFor(it.exercise_slug)
      .map((r, i) => ({ slug: it.exercise_slug, index: i, row: r }))
      .filter(({ row }) => row.done || row.reps > 0),
  );
  const included = eligible.filter(({ slug, index }) => !excluded.has(lineId(slug, index)));

  const onSave = async () => {
    setSaveError(null);
    // Durable first, network second. Without this the draft is only in memory
    // for up to the debounce interval, and a failure right here would lose it.
    try {
      await draft.flushNow();
    } catch {
      /* reported through draft.error; the save below still surfaces failure */
    }
    // The draft records the queued operation id, so a second tap cannot create
    // a second workout (WORK-02).
    if (draft.draft?.submitted_as) {
      onClose();
      return;
    }
    const byExercise = new Map<string, number>();
    const out = included.map(({ slug, row }) => {
      const n = (byExercise.get(slug) ?? 0) + 1;
      byExercise.set(slug, n);
      return { exercise_slug: slug, set_no: n, weight_kg: row.weight, reps: row.reps };
    });
    try {
      const intent = await save.mutateAsync({
        logged_on: logDate,
        session_key: session.session_key,
        session_name: session.name,
        phase_slug: phaseSlug,
        sets: out,
      });
      // Durably accepted. Link the draft to its save, then drop it.
      draft.save({ submitted_as: intent.operation_id });
      await draft.clear();
      onClose();
    } catch (err) {
      // Saving failed, so the draft stays exactly as it was (WORK-02).
      setSaveError(err);
      setReviewing(false);
    }
  };

  // Any work worth confirming-before-discard?
  const anyLogged = items.some((it) =>
    rowsFor(it.exercise_slug).some((r) => r.done || r.reps > 0),
  );
  const handleDiscard = async () => {
    if (anyLogged && !window.confirm('Discard this session? Logged sets will not be saved.')) return;
    await draft.clear();
    onClose();
  };

  // Mark every set of an exercise done and advance to the next move (or the
  // finish block on the last one).
  const completeExercise = (slug: string, itemIdx: number) => {
    writeSets((prev) => {
      const rows = (prev[slug] ?? prefill(slug, allSets.data ?? [], blankRowsFor(slug))).map((r) => ({
        ...r,
        done: true,
      }));
      return { ...prev, [slug]: rows };
    });
    const target = sectionRefs.current[itemIdx + 1] ?? finishRef.current;
    scrollToSection(target);
  };

  // Determine which exercise is "current" (first one that isn't fully done)
  const currentIdx = useMemo(() => {
    for (let i = 0; i < items.length; i++) {
      const rows = rowsFor(items[i].exercise_slug);
      if (rows.some((r) => !r.done)) return i;
    }
    return items.length - 1;
    // rowsFor depends on sets; intentional
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sets, items]);

  // Last logged sets for the current exercise, for "LAST TIME" bar
  const lastTimeFor = (slug: string): string | null => {
    if (!allSets.data) return null;
    const forEx = allSets.data.filter((s) => s.exercise_slug === slug);
    if (!forEx.length) return null;
    const latest = forEx.reduce((a, b) => (b.logged_on > a.logged_on ? b : a)).logged_on;
    const rows = forEx
      .filter((s) => s.logged_on === latest)
      .sort((a, b) => a.set_no - b.set_no);
    if (!rows.length) return null;
    const weight = rows[0].weight_kg;
    const repsStr = rows.map((r) => r.reps).join(', ');
    const dateLabel = new Date(latest + 'T12:00:00').toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
    });
    return `${weight} kg × ${repsStr} · ${dateLabel}`;
  };

  return (
    <div className="fixed inset-0 z-30 flex flex-col overflow-hidden bg-bg">
      {/* ── Sticky top bar ── */}
      <div className="z-40 border-b border-border bg-bg/95 backdrop-blur">
        <div className="mx-auto flex max-w-content items-center px-3 py-2">
          {/* Left: ✕ Discard */}
          <button
            type="button"
            onClick={handleDiscard}
            aria-label="Discard workout"
            className="flex items-center gap-1 text-text-dim transition-opacity hover:opacity-70"
          >
            <Icon name="close" size={18} />
            <span className="font-body text-body-sm font-bold uppercase tracking-label">
              Discard
            </span>
          </button>

          {/* Center: session name, elapsed, and the date this will be logged
              under — carryover from another day records as today (WORK-03). */}
          <div className="flex-1 text-center">
            <p className="font-display text-label font-semibold uppercase tracking-label text-text-dim">
              {session.name}&ensp;·&ensp;{fmtElapsed(elapsed)} elapsed
            </p>
            <p className="text-meta text-text-dim">
              Logging as {logDate === today ? 'today' : ''}
              {logDate === today ? ', ' : ''}
              {parseLocalDate(logDate).toLocaleDateString(undefined, {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
              })}
            </p>
          </div>

          {/* Right: Save — opens a review of exactly what will be written. */}
          <button
            type="button"
            onClick={() => setReviewing(true)}
            disabled={save.isPending}
            className="font-body text-body-sm font-bold text-accent transition-opacity hover:opacity-70 disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>

        {/* Multi-segment progress bar */}
        {items.length > 0 && (
          <div className="flex h-[3px] w-full gap-px overflow-hidden">
            {items.map((it, i) => {
              const rows = rowsFor(it.exercise_slug);
              const doneCount = rows.filter((r) => r.done).length;
              const total = rows.length;
              const isCompleted = doneCount === total && total > 0;
              const isCurrent = i === currentIdx;
              const progress = isCurrent && total > 0 ? doneCount / total : 0;

              return (
                <div key={it.id} className="relative flex-1 bg-border">
                  <div
                    className="absolute inset-y-0 left-0 bg-accent transition-all duration-base ease-brand"
                    style={{ width: isCompleted ? '100%' : `${progress * 100}%` }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Scrollable body ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-content px-4 pb-40 pt-5">
          {allSets.isPending ? (
            <p className="text-body-sm text-text-dim">Loading history…</p>
          ) : (
            <div className="space-y-6">
              {items.map((it, itemIdx) => {
                const rows = rowsFor(it.exercise_slug);
                const hold = parseHold(it.prescription);
                const ex = exBy.get(it.exercise_slug);
                const exName = nameBy.get(it.exercise_slug) ?? it.exercise_slug;
                const lastTime = lastTimeFor(it.exercise_slug);
                const nextItem = items[itemIdx + 1];
                const nextName = nextItem ? (nameBy.get(nextItem.exercise_slug) ?? nextItem.exercise_slug) : null;
                const isActive = itemIdx === currentIdx;

                // Derive a short prescription summary for next row
                const nextPrescription = nextItem?.prescription ?? '';
                // Extract set×rep from prescription like "W1–2: 3×8 mod · then 4×4–6 heavy" → "3×8"
                const nextSummaryMatch = nextPrescription.match(/(\d+×\d+[–-]?\d*)/);
                const nextSummary = nextSummaryMatch ? nextSummaryMatch[1] : nextPrescription.slice(0, 10);

                return (
                  <section
                    key={it.id}
                    aria-label={exName}
                    ref={(el) => {
                      sectionRefs.current[itemIdx] = el;
                    }}
                    className="scroll-mt-24"
                  >
                    {/* Eyebrow + exercise name */}
                    <Eyebrow tone="muted" className="mb-1">
                      Move {itemIdx + 1} of {items.length}
                    </Eyebrow>
                    <h2 className="font-display text-[22px] font-bold leading-tight text-text">
                      {exName}
                    </h2>
                    {/* Green prescription line */}
                    <p className="mt-0.5 font-display text-body-sm font-semibold text-accent">
                      {it.prescription}
                    </p>
                    {/* Coaching / cue */}
                    {ex?.cues && ex.cues.length > 0 && (
                      <p className="mt-1 text-body-sm text-text-dim">{ex.cues[0]}</p>
                    )}

                    {/* Watch demo row */}
                    {ex?.video_url && (
                      <WatchDemoRow
                        videoUrl={ex.video_url}
                        cues={ex.cues ?? []}
                      />
                    )}

                    {/* Set rows */}
                    <div className="mt-3 space-y-2">
                      {rows.map((r, i) => {
                        const isActiveRow = isActive && !r.done && rows.slice(0, i).every((prev) => prev.done);
                        const editingField =
                          editing?.slug === it.exercise_slug && editing.row === i
                            ? editing.field
                            : null;
                        return (
                          <SetRow
                            key={i}
                            index={i}
                            row={r}
                            isActive={isActiveRow}
                            editingField={editingField}
                            onEditWeight={() =>
                              setEditing({ slug: it.exercise_slug, row: i, field: 'weight' })
                            }
                            onEditReps={() =>
                              setEditing({ slug: it.exercise_slug, row: i, field: 'reps' })
                            }
                            onDone={() => {
                              const willBeDone = !r.done;
                              update(it.exercise_slug, i, { done: willBeDone });
                              if (!willBeDone) return;
                              // Close the keypad if it was editing this set.
                              if (editing?.slug === it.exercise_slug && editing.row === i)
                                setEditing(null);
                              // Start rest (per-exercise override ?? default), and
                              // auto-expand the handoff only on a lift's final rest.
                              const rowsAfter = rows.map((rr, idx) =>
                                idx === i ? { ...rr, done: true } : rr,
                              );
                              const allDone = rowsAfter.every((rr) => rr.done);
                              const hasNext = itemIdx + 1 < items.length;
                              startRest(restFor(it.exercise_slug), it.exercise_slug);
                              setHandoff(allDone && hasNext ? { nextIdx: itemIdx + 1 } : null);
                            }}
                          />
                        );
                      })}
                    </div>

                    {/* + Add set */}
                    <button
                      type="button"
                      onClick={() => addSet(it.exercise_slug)}
                      className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border py-2.5 text-body-sm font-bold text-text-dim transition-colors hover:border-border-strong hover:text-text-muted"
                    >
                      <Icon name="add" size={16} />
                      Add set
                    </button>

                    {/* Last time info bar */}
                    {lastTime && (
                      <div className="mt-2 rounded-md bg-surface-raised px-3 py-2">
                        <span className="font-display text-label font-semibold uppercase tracking-label text-text-dim">
                          Last time&ensp;
                        </span>
                        <span className="text-body-sm text-text-muted">{lastTime}</span>
                      </div>
                    )}

                    {/* Hold timer trigger (for isometric holds) */}
                    {hold && (
                      <button
                        type="button"
                        onClick={() => startHold(hold.seconds, hold.perSide)}
                        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-surface py-2.5 text-body-sm font-bold text-text-muted transition-colors hover:text-text"
                      >
                        <Icon name="timer" size={16} />
                        Hold {hold.seconds}s{hold.perSide ? ' / side' : ''}
                      </button>
                    )}

                    {/* NEXT exercise collapsible */}
                    {nextName && itemIdx === currentIdx && (
                      <NextExerciseRow
                        name={nextName}
                        summary={nextSummary}
                        expanded={nextExpanded}
                        onToggle={() => setNextExpanded((v) => !v)}
                      />
                    )}

                    {/* Complete this exercise → next */}
                    <button
                      type="button"
                      onClick={() => completeExercise(it.exercise_slug, itemIdx)}
                      className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent py-3 font-body text-body-sm font-bold text-accent-ink transition-opacity hover:opacity-90"
                    >
                      <Icon name="check_circle" size={18} fill />
                      {nextName ? 'Complete exercise' : 'Complete last exercise'}
                      <Icon name="arrow_downward" size={16} />
                    </button>
                  </section>
                );
              })}

              {/* Finish & save — the prominent primary action, in the flow after the last move */}
              <div ref={finishRef} className="scroll-mt-24 border-t border-border pt-6">
                <Button full onClick={onSave} disabled={save.isPending}>
                  <Icon name="check_circle" size={18} fill />
                  {save.isPending ? 'Saving…' : 'Finish & save session'}
                </Button>
                <button
                  type="button"
                  onClick={handleDiscard}
                  className="mt-3 w-full py-2 text-center font-body text-body-sm font-bold text-text-dim transition-opacity hover:opacity-70"
                >
                  Discard without saving
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Saving failed: the draft is intact, so say so rather than implying loss. */}
      {saveError != null && (
        <div
          role="alert"
          className="fixed inset-x-0 bottom-20 z-40 mx-auto max-w-content px-4"
        >
          <p className="rounded-md border border-danger/50 bg-danger/10 px-3 py-2 text-body-sm text-text">
            Could not save this session. Your sets are still here — try again.
          </p>
        </div>
      )}

      {reviewing && (
        <ReviewSheet
          logDate={logDate}
          isToday={logDate === today}
          sessionName={session.name}
          lines={eligible.map(({ slug, index, row }) => ({
            id: lineId(slug, index),
            exerciseName: nameBy.get(slug) ?? slug,
            setNo: index + 1,
            weight: row.weight,
            reps: row.reps,
            included: !excluded.has(lineId(slug, index)),
          }))}
          saving={save.isPending}
          notDurable={!draft.durable}
          onToggle={(id) =>
            setExcluded((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onCancel={() => setReviewing(false)}
          onConfirm={onSave}
        />
      )}

      {/* ── Sticky bottom bar ── */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg/95 backdrop-blur">
        <div className="mx-auto max-w-content">
          {editing ? (
            /* Custom set editor (frame 1c) — the OS keyboard never opens. */
            <SetKeypad
              key={`${editing.slug}-${editing.row}-${editing.field}`}
              setLabel={`Set ${editing.row + 1}`}
              field={editing.field}
              value={rowsFor(editing.slug)[editing.row]?.[editing.field] ?? 0}
              onChange={(v) =>
                update(
                  editing.slug,
                  editing.row,
                  editing.field === 'weight' ? { weight: v } : { reps: v },
                )
              }
              onNext={advanceEditing}
              onDone={() => setEditing(null)}
            />
          ) : (
            <>
              {/* "Set up while you rest" handoff — only on a lift's final rest. */}
              {handoff && timer?.kind === 'rest' && (
                <HandoffCard
                  index={handoff.nextIdx}
                  total={items.length}
                  name={nameBy.get(items[handoff.nextIdx].exercise_slug) ?? items[handoff.nextIdx].exercise_slug}
                  prescription={items[handoff.nextIdx].prescription}
                  lastTime={lastTimeFor(items[handoff.nextIdx].exercise_slug)}
                  cues={exBy.get(items[handoff.nextIdx].exercise_slug)?.cues ?? []}
                  onGoNow={() => goNow(handoff.nextIdx)}
                  onCollapse={() => setHandoff(null)}
                />
              )}
              {timer && (
                <div className={timer.kind === 'hold' ? 'px-4 py-3' : ''}>
                  <CountdownTimer
                    key={timer.nonce}
                    seconds={timer.seconds}
                    kind={timer.kind}
                    perSide={timer.kind === 'hold' ? timer.perSide : false}
                    prominent={timer.kind === 'rest'}
                    handoff={timer.kind === 'rest' && !!handoff}
                    onClose={clearTimer}
                    onDefaultChange={
                      timer.kind === 'rest' && timer.exerciseSlug
                        ? (seconds) =>
                            setRestOverride.mutate({ slug: timer.exerciseSlug!, seconds })
                        : undefined
                    }
                  />
                </div>
              )}
              {!timer && (
                <div className="flex items-center justify-between px-4 py-3">
                  <p className="text-body-sm text-text-dim">Mark a set done to start rest</p>
                  <button
                    type="button"
                    onClick={() => startHold(30, false)}
                    className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-4 py-2 font-body text-body-sm font-bold text-text transition-colors hover:border-border-strong"
                  >
                    <Icon name="timer" size={16} />
                    Hold timer
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────────────────────── */

interface ReviewLine {
  id: string;
  exerciseName: string;
  setNo: number;
  weight: number;
  reps: number;
  included: boolean;
}

/**
 * Pre-save review (WORK-02).
 *
 * Eligibility is still SPEC §6.1's `done || reps > 0`, which includes prefilled
 * reps the user never confirmed. Rather than change that rule — a product
 * decision (D-01) — or zero the prefill, which is explicitly ruled out, this
 * shows every line that is about to be written and lets one be dropped. The
 * logging date is stated here too, because a session carried over from another
 * day records as today.
 */
function ReviewSheet({
  logDate,
  isToday,
  sessionName,
  lines,
  saving,
  notDurable,
  onToggle,
  onCancel,
  onConfirm,
}: {
  logDate: string;
  isToday: boolean;
  sessionName: string;
  lines: ReviewLine[];
  saving: boolean;
  notDurable: boolean;
  onToggle: (id: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnTo.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector('button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      returnTo.current?.focus();
    };
  }, [onCancel]);

  const includedCount = lines.filter((l) => l.included).length;
  const dateLabel = parseLocalDate(logDate).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-bg/80 p-0 backdrop-blur sm:items-center sm:p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-title"
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-t-lg border border-border bg-surface sm:rounded-lg"
      >
        <div className="border-b border-border p-4">
          <h2 id="review-title" className="font-display text-data font-bold text-text">
            Save {includedCount} set{includedCount === 1 ? '' : 's'}
          </h2>
          <p className="mt-1 text-body-sm text-text-muted">
            {sessionName} · logged as {isToday ? 'today, ' : ''}
            {dateLabel}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {lines.length === 0 ? (
            <p className="p-4 text-body-sm text-text-muted">
              Nothing to save yet — mark a set done, or enter some reps.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {lines.map((l) => (
                <li key={l.id}>
                  <label className="flex min-h-tap cursor-pointer items-center gap-3 px-4 py-2">
                    <input
                      type="checkbox"
                      checked={l.included}
                      onChange={() => onToggle(l.id)}
                      className="h-4 w-4 shrink-0 accent-[color:var(--color-accent)]"
                    />
                    <span
                      className={`min-w-0 flex-1 truncate text-body-sm ${
                        l.included ? 'text-text' : 'text-text-dim line-through'
                      }`}
                    >
                      {l.exerciseName}
                    </span>
                    <span className="shrink-0 text-body-sm text-text-muted">
                      set {l.setNo} · {l.weight} kg × {l.reps}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        {notDurable && (
          <p className="border-t border-border px-4 py-2 text-meta text-warning">
            This browser will not keep the session if you close the tab before it syncs.
          </p>
        )}

        <div className="flex gap-2 border-t border-border p-4">
          <Button variant="ghost" onClick={onCancel}>
            Back
          </Button>
          <div className="flex-1">
            <Button full onClick={onConfirm} disabled={saving || includedCount === 0}>
              {saving ? 'Saving…' : `Save ${includedCount} set${includedCount === 1 ? '' : 's'}`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** "Watch demo" (inline embed) + Cues disclosure row */
function WatchDemoRow({ videoUrl, cues }: { videoUrl: string; cues: string[] }) {
  const [cuesOpen, setCuesOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const src = embedUrl(videoUrl, { autoplay: true });

  return (
    <div className="mt-3 rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-3 px-3 py-2.5">
        {/* Green circular play / close button — embeds inline rather than leaving the app */}
        {src ? (
          <button
            type="button"
            onClick={() => setPlaying((v) => !v)}
            aria-label={playing ? 'Hide exercise demo' : 'Watch exercise demo'}
            aria-expanded={playing}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink transition-opacity hover:opacity-80"
          >
            <Icon name={playing ? 'close' : 'play_arrow'} size={18} fill={!playing} />
          </button>
        ) : (
          <a
            href={videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Watch exercise demo"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink transition-opacity hover:opacity-80"
          >
            <Icon name="play_arrow" size={18} fill />
          </a>
        )}
        <span className="flex-1 text-body-sm font-bold text-text">Watch demo</span>
        {cues.length > 1 && (
          <button
            type="button"
            onClick={() => setCuesOpen((v) => !v)}
            className="flex items-center gap-0.5 text-body-sm text-text-dim transition-colors hover:text-text"
          >
            Cues
            <Icon name={cuesOpen ? 'expand_less' : 'expand_more'} size={16} />
          </button>
        )}
      </div>
      {playing && src && (
        <div className="border-t border-border p-3">
          <div className="aspect-video overflow-hidden rounded-md">
            <iframe
              className="h-full w-full"
              src={src}
              title="Exercise demo"
              loading="lazy"
              allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
          <a
            href={videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-meta text-text-dim transition-colors hover:text-text"
          >
            Open in YouTube
            <Icon name="north_east" size={13} />
          </a>
        </div>
      )}
      {cuesOpen && cues.length > 1 && (
        <ul className="space-y-1 border-t border-border px-3 py-2.5">
          {cues.slice(1).map((cue, i) => (
            <li key={i} className="flex gap-2 text-body-sm text-text-dim">
              <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-text-dim" aria-hidden />
              {cue}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * A single set row. A completed set collapses to a read-only line
 * (`72.5 kg × 5` + green check, frame 7); an editable set shows tappable
 * weight / reps value boxes that open the custom keypad (frame 1c) — no native
 * inputs, so the OS keyboard never opens.
 */
function SetRow({
  index,
  row,
  isActive,
  editingField,
  onEditWeight,
  onEditReps,
  onDone,
}: {
  index: number;
  row: Row;
  isActive: boolean;
  editingField: EditField | null;
  onEditWeight: () => void;
  onEditReps: () => void;
  onDone: () => void;
}) {
  const label = `S${index + 1}`;

  // ── Completed: compact read-only line ──
  if (row.done) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 opacity-80">
        <span className="w-7 flex-shrink-0 text-center font-display text-label font-semibold uppercase tracking-label text-text-dim">
          {label}
        </span>
        <span className="font-body text-body font-bold tabular-nums text-text-muted">
          {row.weight || '—'}
          <span className="mx-1 text-body-sm font-normal text-text-dim">kg ×</span>
          {row.reps || '—'}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onDone}
          aria-label={`${label} completed — tap to undo`}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-accent text-accent-ink transition-opacity hover:opacity-80"
        >
          <Icon name="check_circle" size={20} fill />
        </button>
      </div>
    );
  }

  // ── Editable: tappable value boxes ──
  const box = (active: boolean) =>
    [
      'min-h-tap rounded-md border px-2 text-center font-body text-body font-bold transition-colors duration-fast ease-brand',
      active ? 'border-accent text-text' : 'border-border bg-bg text-text hover:border-border-strong',
    ].join(' ');

  return (
    <div
      className={[
        'flex items-center gap-2 rounded-lg border p-2 transition-colors duration-fast ease-brand',
        isActive ? 'border-accent' : 'border-border bg-surface',
      ].join(' ')}
    >
      <span className="w-7 flex-shrink-0 text-center font-display text-label font-semibold uppercase tracking-label text-text-dim">
        {label}
      </span>

      <button
        type="button"
        onClick={onEditWeight}
        aria-label={`${label} weight in kg${row.weight ? `, ${row.weight}` : ''}`}
        className={`${box(editingField === 'weight')} w-[4.5rem]`}
      >
        {row.weight || '—'}
      </button>

      <span className="flex-shrink-0 text-body-sm text-text-dim">kg ×</span>

      <button
        type="button"
        onClick={onEditReps}
        aria-label={`${label} reps${row.reps ? `, ${row.reps}` : ''}`}
        className={`${box(editingField === 'reps')} w-14`}
      >
        {row.reps || '—'}
      </button>

      <div className="flex-1" />

      <button
        type="button"
        onClick={onDone}
        aria-label={`${label} mark done`}
        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md border border-border bg-surface text-text-dim transition-colors duration-fast ease-brand hover:border-accent hover:text-accent"
      >
        <Icon name="check_circle" size={20} />
      </button>
    </div>
  );
}

/**
 * "Set up while you rest" handoff (frame 8). Auto-expands on a lift's final rest
 * with the next exercise's details; "Go now" jumps to it, the chevron collapses
 * back to the plain rest bar. Setup chips are the exercise's own cues — no new
 * data field.
 */
function HandoffCard({
  index,
  total,
  name,
  prescription,
  lastTime,
  cues,
  onGoNow,
  onCollapse,
}: {
  index: number;
  total: number;
  name: string;
  prescription: string;
  lastTime: string | null;
  cues: string[];
  onGoNow: () => void;
  onCollapse: () => void;
}) {
  return (
    <div className="border-b border-border px-4 pt-3">
      <div className="rounded-lg border border-accent bg-surface-raised p-3">
        <div className="flex items-center justify-between">
          <Eyebrow tone="accent">Set up while you rest</Eyebrow>
          <span className="font-display text-label font-semibold uppercase tracking-label text-text-dim">
            {index + 1} of {total}
          </span>
        </div>
        <h3 className="mt-1 font-display text-[20px] font-bold leading-tight text-text">{name}</h3>
        <p className="mt-0.5 font-display text-body-sm font-semibold text-accent">
          {prescription}
          {lastTime && (
            <span className="ml-1 font-normal text-text-dim">· last time {lastTime}</span>
          )}
        </p>
        {cues.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {cues.slice(0, 3).map((cue, i) => (
              <Chip key={i}>{cue}</Chip>
            ))}
          </div>
        )}
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onGoNow}
            className="flex flex-1 min-h-tap items-center justify-center gap-1.5 rounded-md bg-accent font-body text-body font-bold text-accent-ink transition-opacity hover:opacity-90"
          >
            Go now
            <Icon name="north_east" size={18} />
          </button>
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Collapse handoff"
            className="flex min-h-tap w-12 items-center justify-center rounded-md border border-border bg-surface text-text-dim transition-colors hover:text-text"
          >
            <Icon name="arrow_downward" size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** "NEXT Exercise · prescription" collapsible footer row */
function NextExerciseRow({
  name,
  summary,
  expanded,
  onToggle,
}: {
  name: string;
  summary: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="mt-3 flex w-full items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:bg-surface-raised"
    >
      <span className="font-display text-label font-semibold uppercase tracking-label text-text-dim">
        Next
      </span>
      <span className="flex-1 text-body-sm font-bold text-text">
        {name}
        {summary && (
          <span className="ml-2 font-normal text-text-muted">· {summary}</span>
        )}
      </span>
      <Icon
        name={expanded ? 'expand_less' : 'expand_more'}
        size={18}
        className="flex-shrink-0 text-text-dim"
      />
    </button>
  );
}
