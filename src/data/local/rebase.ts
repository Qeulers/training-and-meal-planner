/*
 * Rebasing pending intents over refreshed server state (REL-03 §5).
 *
 * A refetch returns what the server knows, which by definition excludes writes
 * still sitting in the outbox. Rendering it raw produces the sequence: user
 * ticks an item, a refetch lands, the tick disappears, the intent drains, the
 * tick comes back. Worse, a user who re-ticks during that window generates a
 * contradictory intent.
 *
 * So server state is never rendered directly. Pending intents are replayed over
 * it in `seq` order first. Pure, and tested as such.
 */
import type { Intent } from './outbox';

/** Applies one intent to a projection of server state. Must not mutate `state`. */
export type IntentApplier<S> = (state: S, intent: Intent) => S;

/**
 * Replay `intents` over `serverState`, oldest first.
 *
 * Only `pending` intents apply. A dead-lettered intent is work the user has been
 * told did NOT save — continuing to show it as though it had would be the same
 * lie from the other direction.
 */
export function rebase<S>(serverState: S, intents: Intent[], apply: IntentApplier<S>): S {
  return intents
    .filter((i) => i.state === 'pending')
    .sort((a, b) => a.seq - b.seq)
    .reduce((state, intent) => apply(state, intent), serverState);
}

/**
 * Build an applier for a keyed row collection — the shape most user queries
 * take. `upsert` and `remove` intents are matched by `entity` so an applier for
 * one table ignores another's traffic.
 */
export function rowApplier<T>(
  entity: string,
  keyOf: (row: T) => string,
  rowFrom: (intent: Intent) => T | null,
): IntentApplier<T[]> {
  return (rows, intent) => {
    if (intent.entity !== entity) return rows;
    const next = rowFrom(intent);
    const without = rows.filter((r) => keyOf(r) !== intent.entity_id);
    return next ? [...without, next] : without;
  };
}
