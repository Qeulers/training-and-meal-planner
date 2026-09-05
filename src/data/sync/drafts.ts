/*
 * Durable workout drafts (WORK-01).
 *
 * The logger kept in-progress sets in `useState`, so a phone that backgrounded
 * mid-session and got reclaimed lost the whole workout. Drafts now live in the
 * local database, identity-scoped, and are restored on reopen.
 *
 * Three boundaries worth stating:
 *
 *   - A draft is NOT a log. It is unsent work in progress and never appears in
 *     history or stats.
 *   - A draft is not the save intent either. Saving enqueues an intent and marks
 *     the draft `submitted_as` that operation id, which is what stops a second
 *     tap creating a second workout.
 *   - Timers are excluded on purpose: they are wall-clock derived and meaningless
 *     once restored, so persisting them would resurrect a rest countdown that
 *     finished hours ago.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSync } from './SyncProvider';
import type { LocalStore } from '../local/types';

export interface DraftRow {
  weight: number;
  reps: number;
  done: boolean;
}

export interface WorkoutDraft {
  owner: string;
  session_key: string;
  session_name: string;
  phase_slug: string;
  /** The date this will be logged under. */
  logged_on: string;
  notes: string;
  /** Rows per exercise slug. */
  sets: Record<string, DraftRow[]>;
  updated_at: number;
  /**
   * Set once the draft has been handed to the outbox. Its presence means "a save
   * is already queued for this work" and blocks a duplicate submission.
   */
  submitted_as?: string;
}

/** One draft per account, session and date. */
export const draftKey = (owner: string, sessionKey: string, loggedOn: string) =>
  `workout:${owner}:${sessionKey}:${loggedOn}`;

export async function readDraft(
  store: LocalStore,
  key: string,
  owner: string,
): Promise<WorkoutDraft | null> {
  const draft = await store.read(['drafts'], (tx) => tx.get<WorkoutDraft>('drafts', key));
  // Belt and braces over the key's own scoping: never hand back another
  // account's work, whatever is on disk.
  return draft && draft.owner === owner ? draft : null;
}

export interface DraftHandle {
  /** null while loading, or when there is nothing saved. */
  draft: WorkoutDraft | null;
  loaded: boolean;
  /** True when the local database will not keep this across a reload. */
  durable: boolean;
  save: (patch: Partial<Omit<WorkoutDraft, 'owner'>>) => void;
  /**
   * Write any debounced edit immediately. Call before attempting a save: the
   * draft must be durable BEFORE the network is touched, so a failure leaves
   * the work on disk rather than only in memory (REL-01).
   */
  flushNow: () => Promise<void>;
  clear: () => Promise<void>;
  /** Errors are surfaced, not swallowed: a lost draft must not look saved. */
  error: unknown;
}

const SAVE_DEBOUNCE_MS = 400;

/**
 * Load, autosave and clear one workout draft.
 *
 * Writes are debounced — a set edit fires per keystroke on the keypad and every
 * one of those hitting IndexedDB would make the logger stutter mid-workout.
 */
export function useWorkoutDraft(
  owner: string | null,
  sessionKey: string,
  loggedOn: string,
): DraftHandle {
  const { store, durable } = useSync();
  const [draft, setDraft] = useState<WorkoutDraft | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const pending = useRef<number | null>(null);
  const latest = useRef<WorkoutDraft | null>(null);

  const key = owner ? draftKey(owner, sessionKey, loggedOn) : null;

  useEffect(() => {
    let cancelled = false;
    if (!store || !key || !owner) {
      setLoaded(store != null);
      return;
    }
    readDraft(store, key, owner)
      .then((found) => {
        if (cancelled) return;
        setDraft(found);
        latest.current = found;
        setLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [store, key, owner]);

  // Write any debounced edit now. Also runs on unmount, so closing the logger
  // cannot drop the last edit.
  const flushNow = useCallback(async () => {
    if (pending.current != null) {
      window.clearTimeout(pending.current);
      pending.current = null;
    }
    const value = latest.current;
    if (!store || !key || !value) return;
    try {
      await store.write(['drafts'], (tx) => tx.put('drafts', key, value));
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [store, key]);

  useEffect(
    () => () => {
      void flushNow().catch(() => undefined);
    },
    [flushNow],
  );

  const save = useCallback(
    (patch: Partial<Omit<WorkoutDraft, 'owner'>>) => {
      if (!store || !key || !owner) return;
      const next: WorkoutDraft = {
        session_key: sessionKey,
        session_name: patch.session_name ?? latest.current?.session_name ?? sessionKey,
        phase_slug: patch.phase_slug ?? latest.current?.phase_slug ?? '',
        logged_on: loggedOn,
        notes: '',
        sets: {},
        ...latest.current,
        ...patch,
        owner,
        updated_at: Date.now(),
      };
      latest.current = next;
      setDraft(next);
      if (pending.current != null) window.clearTimeout(pending.current);
      pending.current = window.setTimeout(() => {
        pending.current = null;
        store.write(['drafts'], (tx) => tx.put('drafts', key, next)).catch(setError);
      }, SAVE_DEBOUNCE_MS);
    },
    [store, key, owner, sessionKey, loggedOn],
  );

  const clear = useCallback(async () => {
    if (pending.current != null) {
      window.clearTimeout(pending.current);
      pending.current = null;
    }
    latest.current = null;
    setDraft(null);
    if (store && key) await store.write(['drafts'], (tx) => tx.del('drafts', key));
  }, [store, key]);

  return { draft, loaded, durable, save, flushNow, clear, error };
}
