import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useWakeLock } from './useWakeLock';

/*
 * Rest / hold countdown (SPEC §6.1). Ephemeral UI — never persisted, never in
 * the outbox. Driven from a wall-clock TARGET time (not a tick count) so it stays
 * accurate while backgrounded, and holds a screen wake lock while live. A tone +
 * haptic pulse fire at zero with a 3s visual warning; cues respect the mute
 * toggle and prefers-reduced-motion.
 */

type Kind = 'rest' | 'hold';

interface Props {
  seconds: number;
  kind: Kind;
  perSide?: boolean;
  /** Larger, high-visibility layout — used for the active rest timer. */
  prominent?: boolean;
  /** Slim "LAST REST" layout (redesign frame 8): the handoff card owns the
   *  advance action, so the rest bar hides its full-width "Skip rest" button. */
  handoff?: boolean;
  onClose: () => void;
  /** Persist a new default rest for this exercise (rest timer only, on commit). */
  onDefaultChange?: (seconds: number) => void;
}

const fmt = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function beep() {
  try {
    const Ctx =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.42);
    osc.onended = () => ctx.close();
  } catch {
    /* audio unavailable — silent fallback */
  }
}

const MIN_REST = 15;

export function CountdownTimer({
  seconds,
  kind,
  perSide = false,
  prominent = false,
  handoff = false,
  onClose,
  onDefaultChange,
}: Props) {
  // Base rest duration. The redesigned bar drops the separate "Default" field;
  // instead ±15 tunes this and persists it via onDefaultChange, so a
  // per-exercise rest default can be set from the rest bar itself.
  const [duration, setDuration] = useState(seconds);
  const [side, setSide] = useState<1 | 2>(1);
  const [running, setRunning] = useState(kind === 'rest'); // rest autostarts
  const [remainingMs, setRemainingMs] = useState(seconds * 1000);
  const [muted, setMuted] = useState(false);

  const targetRef = useRef<number>(0);
  const firedRef = useRef(false);

  // Keep the screen awake while the timer is running.
  useWakeLock(running);

  const cue = useCallback(() => {
    if (muted) return;
    beep();
    if ('vibrate' in navigator) navigator.vibrate([120, 60, 120]);
  }, [muted]);

  // Wall-clock loop: remaining is always derived from the target, so a
  // backgrounded tab resumes at the correct time.
  useEffect(() => {
    if (!running) return;
    targetRef.current = Date.now() + remainingMs;
    firedRef.current = false;
    const tick = () => {
      const left = targetRef.current - Date.now();
      setRemainingMs(left);
      if (left <= 0 && !firedRef.current) {
        firedRef.current = true;
        cue();
        setRunning(false);
        if (kind === 'hold' && perSide && side === 1) {
          setSide(2);
          setRemainingMs(duration * 1000);
        }
      }
    };
    const id = window.setInterval(tick, 200);
    tick();
    return () => window.clearInterval(id);
    // remainingMs intentionally excluded: we snapshot it into the target on start
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, kind, perSide, side, duration, cue]);

  const adjust = (delta: number) => {
    const next = Math.max(0, Math.round(remainingMs / 1000 + delta));
    setRemainingMs(next * 1000);
    if (running) targetRef.current = Date.now() + next * 1000;
    // Shift the base rest duration too and persist it as this exercise's
    // default (no-op for holds / rests without an exercise slug).
    const nextDefault = Math.max(MIN_REST, duration + delta);
    setDuration(nextDefault);
    if (nextDefault !== duration) onDefaultChange?.(nextDefault);
  };

  const restart = () => {
    setRemainingMs(duration * 1000);
    firedRef.current = false;
    setRunning(true);
  };

  const done = remainingMs <= 0 && !running;
  const warning = running && remainingMs <= 3000;
  const reduce =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Rest bar (redesign frames 7 / 8) ──────────────────────────────────────
  // A stripped-back bar: REST label + big countdown, ±15, mute, and a
  // full-width Skip rest. The engine (wall-clock target, wake lock, cue, mute)
  // is unchanged — only the chrome differs from the hold card below.
  if (kind === 'rest') {
    return (
      <div
        role="timer"
        aria-live="off"
        className={[
          'px-4 py-3 transition-colors duration-fast ease-brand',
          warning && !reduce ? 'bg-warning/10' : '',
        ].join(' ')}
      >
        <div className="flex items-center gap-3">
          {/* Label + big time */}
          <div className="min-w-0">
            <p className="font-display text-label font-semibold uppercase tracking-label text-accent">
              {handoff ? 'Last rest' : 'Rest'}
            </p>
            <p
              className={`font-body font-bold leading-none tabular-nums ${
                prominent && !handoff ? 'text-[3rem]' : 'text-[2rem]'
              } ${warning ? 'text-warning' : 'text-text'}`}
            >
              {fmt(remainingMs)}
            </p>
          </div>

          {/* Adjust + mute */}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => adjust(-15)}
              aria-label="Subtract 15 seconds"
              className="flex h-11 min-w-[3.5rem] items-center justify-center rounded-md border border-border bg-surface font-body text-body-sm font-bold text-text-muted transition-colors hover:text-text"
            >
              −15s
            </button>
            <button
              type="button"
              onClick={() => adjust(15)}
              aria-label="Add 15 seconds"
              className="flex h-11 min-w-[3.5rem] items-center justify-center rounded-md border border-border bg-surface font-body text-body-sm font-bold text-text-muted transition-colors hover:text-text"
            >
              +15s
            </button>
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? 'Unmute timer' : 'Mute timer'}
              className="flex h-11 w-11 items-center justify-center rounded-md border border-border bg-surface text-text-dim transition-colors hover:text-text"
            >
              <Icon name={muted ? 'volume_off' : 'volume_up'} size={18} />
            </button>
          </div>
        </div>

        {/* Skip rest — the handoff card owns the advance action, so hide it there */}
        {!handoff && (
          <button
            type="button"
            onClick={onClose}
            className="mt-3 flex min-h-tap w-full items-center justify-center rounded-md bg-accent font-body text-body font-bold text-accent-ink transition-opacity hover:opacity-90"
          >
            Skip rest
          </button>
        )}
      </div>
    );
  }

  // ── Hold card (isometric holds — unchanged) ───────────────────────────────
  return (
    <div
      role="timer"
      aria-live="off"
      className={[
        'rounded-lg border transition-colors duration-fast ease-brand',
        warning && !reduce ? 'border-warning bg-warning/10' : 'border-border bg-surface-raised',
      ].join(' ')}
    >
      {/* Header row: label + mute + close */}
      <div className="flex items-center justify-between px-3 pt-3">
        <p className="font-display text-label font-semibold uppercase tracking-label text-text-dim">
          <Icon name="timer" size={13} className="mr-1 align-middle" />
          Hold
          {perSide ? ` · side ${side}/2` : ''}
        </p>
        <div className="flex items-center gap-1">
          {/* Mute toggle */}
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? 'Unmute timer' : 'Mute timer'}
            className="flex h-8 w-8 items-center justify-center rounded-md text-text-dim transition-colors hover:text-text"
          >
            <Icon name={muted ? 'volume_off' : 'volume_up'} size={18} />
          </button>
          {/* Close / skip */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close timer"
            className="flex h-8 w-8 items-center justify-center rounded-md text-text-dim transition-colors hover:text-text"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      </div>

      {/* Countdown display + controls */}
      <div className="flex items-center gap-3 px-3 pb-3 pt-1">
        {/* Time display */}
        <div className="flex flex-1 items-center justify-center gap-3">
          <p
            className={`font-body font-bold tabular-nums leading-none ${
              prominent ? 'text-[3.25rem]' : 'text-[2rem]'
            } ${warning ? 'text-warning' : 'text-text'}`}
          >
            {fmt(remainingMs)}
          </p>

          {/* Play / pause / restart */}
          {!running && !done && (
            <button
              type="button"
              onClick={() => setRunning(true)}
              aria-label="Start timer"
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink transition-opacity hover:opacity-80"
            >
              <Icon name="play_arrow" size={22} fill />
            </button>
          )}
          {running && (
            <button
              type="button"
              onClick={() => setRunning(false)}
              aria-label="Pause timer"
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-border bg-surface text-text-muted transition-colors hover:text-text"
            >
              {/* Pause: two vertical bars via text */}
              <span className="font-bold leading-none tracking-[-2px]">‖</span>
            </button>
          )}
          {done && (
            <button
              type="button"
              onClick={restart}
              aria-label={perSide && side === 1 ? 'Start next side' : 'Restart timer'}
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink transition-opacity hover:opacity-80"
            >
              <Icon name="refresh" size={20} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
