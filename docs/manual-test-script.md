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
| Migration `0009` applied | **Done** — 2026-09-05, direct to production, no local rehearsal |
| RPC rollback, idempotency, target invariant, unauthenticated | **Passed** against the live database — see §3 |
| Negative RLS as a *second signed-in account* | **Not done** — needs a second real account, see §3 |
| Offline cold reopen | **Not done** — see §1 |
| Service worker + offline cold reopen | **Passed** 2026-09-05 against the production build — found and fixed two defects, see §1 |
| Real IndexedDB: atomicity, survive reopen, version quarantine | **Passed** 2026-09-05 in Chromium, see §1 |
| Viewport matrix 320–1440 px at 100% and 200% | **Passed** for the shell and sign-in; authenticated tabs pending, see §4 |
| Sign-out with pending work | Automated at the component level; end-to-end is §2 item 14 |

---

## 1. Durable storage and offline reopen (REL-01, REL-04)

### Results — 2026-09-05, Chromium via Playwright, production build (`vite preview`)

Run by priming with a single online visit, then **killing the server** so the
origin was genuinely unreachable — a harder test than DevTools offline mode,
which leaves the origin resolvable.

**Two real defects found and fixed.**

1. **Offline reopen failed for every route except `/`.** `sw.js` filtered *all*
   requests through `isShellAsset()`, and `/today` is not `/`, does not start
   with `/assets/` and does not end in `.html` — so navigations fell through to
   the network and produced the browser's own connection-refused page. `/today`
   is the default route, so this affected essentially every user. Navigations
   are now handled first and for every in-app path.
2. **The shell then loaded but rendered nothing.** With the navigation fixed,
   `index.html` came from cache but its own JavaScript did not:
   `Cache.match(request)` keys on request identity, and Vite marks its module
   script and stylesheet `crossorigin`, so the browser requests them in CORS
   mode and they never matched entries stored by `cache.addAll()` from plain
   URL strings. Result: a blank page, offline, with no error a user could act
   on. Lookups now pass `ignoreVary` and fall back to matching by pathname.

A third, smaller issue: the first online visit left the cache incomplete,
because a page's sub-resources are requested before the worker claims the
client, so offline reopen needed *two* visits. The build now injects the hashed
asset list and precaches it at install, and one visit is enough.

| # | Check | Result |
| --- | --- | --- |
| 1 | One online visit primes the shell | **Pass** — 35 entries cached, no shell file missing |
| 5 | Cold reopen of `/today`, origin unreachable | **Pass** — app boots, renders, zero console errors |
| 5b | Cold reopen of a route never visited (`/food?pane=shop`, `/stats`) | **Pass** |
| — | Real IndexedDB round trip via `openLocalStore()` | **Pass** — `durable: true` |
| — | Transaction that throws leaves nothing behind | **Pass** — prior value intact, partial write absent |
| — | Two queued intents survive close-and-reopen | **Pass** — order and sequence numbers preserved |
| — | Drain empties the queue on disk | **Pass** |
| — | One owner cannot see another's queued work | **Pass** |
| 10 | On-disk version newer than the build | **Pass** — refused with `VersionError`, and **the queued intent survived**; nothing deleted |

### Still not run

- **1b, storage denial.** Needs a private window or blocked site data, which the
  automation harness cannot enter. **This remains the single most important
  unverified check**: if IndexedDB is refused, nothing may claim to be saved on
  the device.
- **1c, quota exhaustion.** Deliberately not run: reaching a real browser quota
  means writing gigabytes to the developer's own disk. The mapping from
  `QuotaExceededError` to a `quota` failure is covered by unit tests through the
  in-memory store's fault injection, but the real `DOMException` path is
  unexercised.
- **1d, interrupted upgrade.** The version-refusal half is verified above;
  killing a tab mid-`onupgradeneeded` is not.

### Original procedure

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

Migration `0009` was applied straight to production on **2026-09-05** with
explicit approval and no local rehearsal. It is additive — one new table plus
five functions, no existing table altered — so the blast radius was small, but
the sequencing is recorded honestly: review, then apply, then verify.

Verification ran against the **live** database immediately afterwards, with a
real user id and JWT claim, inside blocks that raised at the end to force a
rollback. Confirmed afterwards: zero leftover rows in `workout_logs`, `races`,
`operation_receipts` and `user_settings`.

| # | Check | Result |
| --- | --- | --- |
| 16 | `save_workout` with a set referencing a non-existent `exercise_slug` | **Pass** — raised; zero orphan headers, so the FK violation rolled the header back too |
| 17 | `save_workout` twice with the same `p_operation_id` | **Pass** — first: `duplicate=false`, +1 log, 2 sets. Replay: `duplicate=true`, still +1 log total |
| 18 | `set_target_race` | **Pass** — exactly 1 `is_target` row afterwards |
| 19 | `add_race` with `p_as_target=false` while races already exist | **Pass** — `is_target=false`; it did not steal A-race status |
| 20 | Every RPC with no JWT claim | **Pass** — `save_workout` and `add_race` both raised `not authenticated` |
| 21 | `set_target_race` with an id the caller does not own | **Pass** — raised `race not found` |
| 23 | `set_rest_override` for two different exercises, separate calls | **Pass** — both keys present (`ex_one=120`, `ex_two=45`), so the `jsonb_set` merge does not clobber |
| 24 | `set_rest_override` with `-1` | **Pass** — rejected |

Also clean: `get_advisors(security)` reports no findings on the new table or
functions (the single pre-existing warning is leaked-password protection, which
is irrelevant to a Google-OAuth-only project).

### Still not verified

25. **Negative RLS from a second signed-in account** (original items 21–22 in
    full). The checks above prove the RPCs' own owner guards, but not that RLS
    refuses a *different authenticated user* — that needs a second real account.
    - *Expect:* user B calling `set_target_race` with user A's race id gets
      `race not found` and cannot tell whether the id exists; replaying A's
      `operation_id` never returns A's result.
26. **Concurrent `set_target_race`** from two sessions at once.
    - *Expect:* `races_one_target` never violated, never zero targets.

---

## 4. Accessibility and responsive (A11Y-01, UX-A)

### Results — 2026-09-05

| Check | Result |
| --- | --- |
| 320 / 390 / 768 / 1024 / 1440 px at 100% and 200% zoom | **Pass** — no horizontal overflow at any of the 10 combinations, on the shell and the sign-in screen |
| Authenticated tabs at those sizes | **Not run** — auth-gated; needs a signed-in session |
| Physical phone | **Not run** — emulated viewports are not evidence |
| Screen reader (VoiceOver) | **Not run** |

Contrast is now automated: `tests/unit/contrast.test.ts` asserts every
foreground/surface pair in both themes at 4.5:1 and cross-checks the palette
against `theme.css`. The items below are what automation cannot reach.


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
