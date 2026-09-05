# Sync contract

**Status:** design gate for slice 2 (REL-03). Written before the outbox exists, so
the rules are decided rather than discovered. Supplements SPEC §3.2.

This document says, per entity, what happens when the same account edits from two
places and the edits meet. It is deliberately narrow: it covers only the seven
user tables. Reference data is immutable at runtime and never participates.

---

## 1. The two decisions everything else follows from

### 1.1 Client clocks are never used to resolve conflicts

SPEC §3.2 says last-write-wins by `updated_at`. That is not sufficient on its
own, for two reasons: `updated_at` is generated when the *server* receives the
write, so it reflects reconnection order rather than the order the user actually
made the edits; and a client-supplied timestamp cannot be trusted, because a
phone whose clock is a day fast would win every conflict forever.

The resolution is to stop depending on wall-clock comparison altogether:

- **Within one device**, order is the outbox sequence number — a monotonic
  counter persisted alongside the intents. Intents drain in strict `seq` order,
  so a user's own edit order is preserved exactly, however long they were
  offline.
- **Across devices**, order is server arrival order. The device that reconnects
  last wins the field it touched.
- `client_ts` is recorded on every intent for display and diagnosis. **It is
  never compared to decide an outcome.** Clock skew therefore cannot affect
  correctness — there is no code path in which it can.

The cost is stated plainly: if the phone edits Tuesday's dinner at 09:00 offline
and the laptop edits it at 17:00 online, and the phone reconnects at 20:00, the
phone's 09:00 value wins. This is accepted. Making it come out the other way
would require trusting a client clock, which is worse. Where the outcome
actually matters, §3 uses merge semantics instead of last-write-wins so the
question does not arise.

### 1.2 Intents carry operations, never snapshots

An intent says *what the user did* ("tick `eggs|P` on trip 7", "set Tuesday to
`teriyaki_fish`"), not *what the resulting state should be*. Sending a snapshot
is how a stale tab silently deletes work it never knew about.

This has one non-obvious consequence, called out because the current code
violates it: `useSetRestOverride` reads the whole `rest_overrides` map, merges
one key, and writes the whole map back. Two devices doing that concurrently lose
one edit. Map-valued columns get **field-level intents** applied server-side
with `jsonb_set`, so concurrent edits to different keys both survive.

---

## 2. The intent record

```ts
interface Intent {
  operation_id: string;   // client UUID, minted BEFORE the first network attempt
  owner: string;          // auth user id at the time of creation
  op: string;             // 'save_workout' | 'toggle_check' | …
  entity: string;         // table or aggregate name
  entity_id: string;      // primary key, or a synthetic key for set members
  payload: unknown;       // operation arguments, never a full-row snapshot
  seq: number;            // monotonic per device; drain order
  deps: string[];         // operation_ids that must land first
  client_ts: number;      // diagnostics only — never used to resolve conflicts
  attempts: number;
  state: 'pending' | 'inflight' | 'failed';
  last_error?: string;
}
```

`operation_id` is minted and **committed to local storage in the same
transaction as the local state change**, before any network call. That ordering
is what makes REL-02 possible: a crash between "user saw it saved" and "server
acknowledged" is recoverable, because the operation already has a stable
identity.

### Ownership

`owner` is stamped at creation and never rewritten. An intent replays only for a
matching authenticated identity. On account switch, the other account's intents
stay in storage, stay invisible, and are neither sent nor reassigned. Signing
back in as the original account makes them drain normally.

---

## 3. Per-entity rules

| Entity | Shape | Conflict rule | Deletion |
| --- | --- | --- | --- |
| `workout_logs` + `workout_log_sets` | Insert-only aggregate | None possible — every save is a new row with a client-generated id. Idempotent by `operation_id`. | Not offered (D-05). |
| `sauna_logs` | Insert-only | As above. | Not offered (D-05). |
| `shopping_checks` | Additive set, keyed `(user_id, item_key, trip_id)` | **Merge.** Each tick and untick is its own intent. A stale intent from another device affects only its own `item_key` on its own `trip_id`. | Untick is a row delete, not a flag. Idempotent. |
| `basket_items` | Additive set, keyed `(user_id, recipe_slug)` | **Merge**, as above. "Clear basket" expands to one delete intent per member, so it cannot remove a recipe added elsewhere after the clear was queued. | Idempotent delete. |
| `meal_plan_entries` | One row per `(user_id, plan_date)` | Last write wins per date, by §1.1 ordering. Different dates never conflict. | Clearing a day is a delete intent for that date only. |
| `races` | Row per race | Field-level last write wins. `is_target` is not a field but an operation — see below. | Delete wins over a concurrent edit to the same race. Deleting the target race clears the target; the next add re-targets per SPEC §6.3. |
| `user_settings` | One row per user | **Field-level** last write wins. Scalars (`plan_start`, `theme`, `phase_override`) replace. Map columns (`rest_overrides`, `diet_prefs`) merge per key via `jsonb_set`. | No deletion; clearing a pin writes null. |

### The single-target invariant

`races_one_target` is a partial unique index, so "star race B" cannot be an
update to B alone — it must unset A and set B together or the index rejects it.
Today the client does this as two sequential statements with no transaction, so
a failure between them leaves the user with no target race at all.

Target changes are therefore a **single server-side operation**, never two
intents. Same for adding a race that becomes the target: creation and targeting
commit together.

### Aggregates

A workout is one intent, not one-per-set. Sets have no independent existence and
must never be observable without their header. The server writes header and
children in one transaction and rejects children whose parent is owned by
another account.

---

## 4. Replay

Drain order is `seq`, filtered to the current `owner`, respecting `deps`.

| Outcome | Action |
| --- | --- |
| Success | Remove the intent. Record `lastSyncAt`. |
| Duplicate (receipt exists) | Treat exactly as success. |
| Network error / 5xx / timeout | Retry with bounded exponential backoff, full jitter, capped at 5 min. Count in `attempts`, keep `pending`. |
| 401 / 403 (expired session) | **Park the whole queue.** Do not retry, do not fail the intent. Status becomes "Sign in to sync". Draining resumes on reauthentication as the same identity. |
| 409 (constraint) | Permanent. Dead-letter with the constraint name, since retrying cannot help. |
| Other 4xx | Permanent. Dead-letter. |

A parked queue is not a failed queue. Conflating them is how offline apps end up
telling users their work was lost when it was only waiting.

### Idempotency

Every mutating RPC takes `operation_id` and writes a row to
`operation_receipts(operation_id primary key, user_id, op, result jsonb,
created_at)` inside the same transaction as its effect. A replay finds the
receipt and returns the original result without repeating the effect. This
covers the case REL-02 names: the server committed, the acknowledgement was lost,
the client retries.

Receipts are RLS'd exactly like every other user table. A receipt lookup for
another owner's `operation_id` returns nothing — it must not become an oracle
for whether someone else's operation exists.

**Receipt lifetime: 90 days.** Long enough that any realistic offline gap
replays safely. An intent still undrained after 90 days is not replayed blindly;
it is surfaced for the user to confirm or discard, because the world it was
created in no longer plausibly holds. Pruning is a scheduled delete of receipts
older than 90 days.

---

## 5. Reads must not clobber writes

When a query refetches, the server response is authoritative for everything
except entities with intents still in the outbox. Before the result reaches the
UI, pending intents are **rebased**: replayed in `seq` order over the fetched
data, in memory.

Without this, the sequence "tick item → refetch lands → item appears unticked →
intent drains → item ticks again" is visible to the user as a flicker, and if
they retick in that window they generate a contradictory intent.

Rebasing is a pure function of `(serverState, pendingIntents)` and is unit
tested as such.

---

## 6. What "Synced" means

Per REL-05, the word is only shown when **all** of:

1. A server exchange has succeeded at least once this session.
2. No intents are `pending` or `inflight`.
3. No intents are `failed`.

`navigator.onLine` reports link state, not server reachability, so it can never
be sufficient evidence on its own. It is used to *stop* claiming synced, never to
start.

---

## 7. Sign-out

Explicit sign-out with unsynced work presents the count and three choices:

- **Cancel** — stay signed in and let the queue drain.
- **Sign out and keep the work** — the outbox stays on the device, owned by that
  account, invisible to anyone else, and resumes when that account signs back in.
- **Discard** — requires a separate explicit confirmation naming what is lost.

There is no path in which drafts or queued intents are deleted without the user
choosing it in words. Token expiry is not sign-out: per SPEC §3.3 it leaves the
cache readable and keeps queueing for the same identity.

---

## 8. Deliberately out of scope

- Multi-tab replay leadership. Until it exists, a `seq`-ordered drain with
  idempotent receipts makes concurrent drains from two tabs safe but wasteful.
  Elect a leader via `BroadcastChannel` before that becomes a real cost.
- Field-level merge for text (notes). Whole-value last write wins.
- Undo across devices beyond the shopping trip reset (D-02).
