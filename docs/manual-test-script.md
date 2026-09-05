# Manual test script

The automated suite runs entirely in Vitest against in-memory implementations.
That is a deliberate trade (no new test dependencies), and it leaves real gaps.
This script covers what the suite provably cannot, and **a release note must
record which of these were run, on what, and what happened** — including the ones
that were skipped.

Per spec §11: do not claim full offline readiness until §1 and §2 below have been
run and passed in the intended environment.

---

## 0. Before anything ships

| Gate | Status |
| --- | --- |
| `npm test` / `typecheck` / `lint` / `build` / `test:coverage` / `validate-seed` | Automated, in CI |
| Migration `0009` applied and verified locally | **Not done** — needs a local Supabase stack |
| RPC rollback and RLS negative cases | **Not done** — see §3 |
| Offline cold reopen | **Not done** — see §1 |

---

## 1. Durable storage and offline reopen (REL-01, REL-04)

Requires a real browser. Chrome DevTools → Application → Storage.

1. **Prime.** Sign in online, visit every tab so reference data caches, then
   confirm the sync line reads `Synced`.
2. **Go offline** (DevTools → Network → Offline, *not* by killing wifi — that
   also stops the dev server).
3. Edit a meal plan entry and tick three shopping items, including one staple
   and its recipe twin.
4. Confirm the sync line shows the pending count, and that it is not `Synced`.
5. **Close every tab.** Reopen the app, still offline.
   - *Expect:* the shell loads, the edits are present, the pending count is
     unchanged.
6. **Restore the network.** *Expect:* the queue drains, the count reaches zero,
   and only then does the line read `Synced`.

### 1b. Storage denial

7. Repeat steps 1–3 in a private window, or with site data blocked.
   - *Expect:* **no** message claiming the work is saved on the device. The input
     stays on screen and the failure is explained.
   - *This is the single most important check in this document.* An automated
     test cannot make IndexedDB refuse.

### 1c. Quota exhaustion

8. Fill origin storage (a loop writing large blobs to IndexedDB from the
   console), then make an edit.
   - *Expect:* an explained failure, recoverable input, nothing reported as saved.

### 1d. Interrupted upgrade

9. With pending intents queued, bump `DB_VERSION` in `idbStore.ts`, reload, and
   kill the tab during the upgrade. Reload again.
   - *Expect:* pending intents still present. Nothing deleted.
10. Open a build with a *higher* `DB_VERSION`, then go back to the current one.
    - *Expect:* the app reports non-durable/quarantined storage and leaves the
      database alone. It must not delete it.

---

## 2. Replay and identity (REL-02, REL-06)

11. **Acknowledgement loss.** Queue a workout save. In DevTools, block the
    response (Network → block request URL) *after* the request is sent. Restore,
    let it retry.
    - *Expect:* exactly one workout log and one set of sets. Check the row count
      directly, not the UI.
12. **Expired session.** Queue several edits offline, expire the JWT (clear the
    refresh token in localStorage), reconnect.
    - *Expect:* status reads "Sign in to sync". Nothing is dead-lettered, nothing
      is lost. After signing back in as the same account, the queue drains.
13. **Account switch.** With work queued for account A, sign out and sign in as
    account B.
    - *Expect:* B sees none of A's pending work, none of it is sent, and none of
      it is reassigned. Signing back in as A drains it.
14. **Sign-out with pending work.** *Expect:* a warning naming the count, with
    cancel / keep / discard, and discard requiring a second explicit
    confirmation.
15. **Two devices.** Tick different shopping items on each while one is offline.
    Reconnect.
    - *Expect:* both sets of ticks survive. Neither device's ticks are lost.

---

## 3. Server-side transactions and RLS (TXN-01)

**Blocked on a local Supabase stack.** Docker and the `supabase` CLI are both
installed on this machine but no local stack is initialised, so migration `0009`
has been reviewed but never executed. Until this section runs, the RPCs are
unverified code.

When a stack exists (`supabase init && supabase start && supabase db reset`):

16. **Rollback.** Call `save_workout` with a set referencing a non-existent
    `exercise_slug`.
    - *Expect:* the FK violation rolls back the header too. `workout_logs` gains
      no row.
17. **Idempotency.** Call `save_workout` twice with the same `p_operation_id`.
    - *Expect:* one log, one set of sets, second call returns `duplicate: true`.
18. **Target invariant.** Call `set_target_race` repeatedly and concurrently.
    - *Expect:* exactly one `is_target` row at all times; `races_one_target` is
      never violated and never leaves zero targets.
19. **First race auto-targets.** `add_race` with `p_as_target = false` on an
    empty account.
    - *Expect:* `is_target = true` (SPEC §6.3).
20. **Negative RLS — unauthenticated.** Call each RPC with the anon key.
    - *Expect:* `not authenticated`, no rows written.
21. **Negative RLS — wrong owner.** As user B, call `set_target_race` with user
    A's race id.
    - *Expect:* `race not found`. B must not learn whether the id exists.
22. **Receipt isolation.** As user B, replay user A's `operation_id`.
    - *Expect:* treated as a fresh operation for B (or refused), never returning
      A's result.
23. **Field-level merge.** Call `set_rest_override` for two different exercises
    from two sessions.
    - *Expect:* both keys present in `rest_overrides`.
24. **Rest validation.** `set_rest_override` with `-1`.
    - *Expect:* rejected, no row written.

---

## 4. Accessibility and responsive (A11Y-01, UX-A)

25. Both themes at 320 / 390 / 768 / 1024 / 1440 px and at 200% zoom.
    - *Expect:* no horizontal clipping; navigation and content reachable.
26. Keyboard only, whole app: visible focus everywhere, no traps, modals return
    focus on close, Escape closes.
27. Screen reader (VoiceOver): sync status changes announce once, not per fetch.
28. **On a physical phone.** Touch targets, the calendar month grid, the set
    keypad, chart inspection.
    - *Status: pending.* Emulated viewports are not evidence for this.

---

## Recording results

For each release, record: date, build SHA, browser and version, device, which
sections ran, and every failure. Sections not run are listed as **not run** —
never omitted, and never described as passing.
