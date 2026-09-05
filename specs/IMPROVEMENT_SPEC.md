# Training & Meal Planner — Improvement Requirements

**Date:** 2026-09-05  
**Status:** Proposed implementation specification; product decisions in §13 await approval.  
**Authority:** Supplements [SPEC.md](SPEC.md), using its section numbering. Original domain and product requirements remain binding unless an explicit exception is approved and recorded. This document authorises neither dependency installation nor deployed schema changes.

## 1. Context and evidence

The React application, not the archived vanilla implementation, is the improvement target. The stack remains React, Vite, TypeScript, Tailwind, Supabase and TanStack Query.

Review baseline: `npm test` passed **96 tests in nine files**; typecheck and lint passed. Coverage is domain/seed only: authenticated E2E and live RLS remain unverified. Sign-in and DEV `/preview` layouts were checked at 390/768/1440 px, not authenticated journeys or physical phones. Responsive adaptation works there; mobile overflow is not established. Source findings and passing checks do not guarantee runtime correctness.

## 2. Goals, priorities and boundaries

- **P0 — Reliability:** durable offline work, truthful sync, identity isolation, atomic aggregates and independent shopping checks.
- **P1 — Journeys:** recoverable workouts, correct calendar navigation, connected food planning, actionable account states and accessibility.
- **P2 — Statistics:** understandable, accessible progress and history exploration after reliable capture.

Priorities order this improvement programme; they do not downgrade existing SPEC requirements, including basic history. Preserve the six-section information architecture, dinner-only planner and existing reference content. Exclude running-plan management, wearables, native apps, AI, household sharing, recipe/exercise editors and wholesale visual redesign. Do not introduce medical recommendations, arbitrary medical-safe input limits or unreviewed nutrition rules.

## 3. Architecture and offline contract

### 3.1 Current state

[queryClient.ts](../src/data/queryClient.ts) configures an in-memory client and disables focus/reconnect refetch globally. [user.ts](../src/data/user.ts) performs online mutations directly. [SideNav.tsx](../src/components/SideNav.tsx) displays static “Synced”. IndexedDB and query-persistence packages are installed but unused. Existing user query keys are identity-scoped; this review establishes no RLS bypass.

### 3.2 P0 requirements

**REL-01 — Durable local acceptance.** Persist reference snapshots, identity-scoped user data and an outbox in IndexedDB. Commit each local user-state change and corresponding intent atomically before displaying “Saved on device”. A transient optimistic preview must remain distinguishable from durable success. Storage denial, quota exhaustion or failed transactions must retain recoverable input and explain that saving failed; never silently fall back to volatile success.

**REL-02 — Replay protocol.** Persist a stable operation UUID before any network attempt. Every intent includes owner, operation type, entity identifiers, payload, ordering/dependency metadata and retry state. Replay only for the matching authenticated identity, in dependency order. Retry transient failures with bounded backoff; authentication failures block pending work for reauthentication. Retain actionable permanent failures with Retry, correction or explicitly confirmed discard. A crash after server acknowledgement must replay the same operation without duplicate effects.

**REL-03 — Conflict contract.** Before implementation, document server revisions, stale-write detection, accepted ordering, deletion semantics and conflict outcomes per entity. Preserve SPEC §3.2 last-write-wins intent unless an exception is approved. Server-generated `updated_at` alone does not preserve offline edit order. Define clock-skew and same-entity concurrent-edit behaviour; expose unresolved conflicts rather than silently dropping work. Shopping checks merge individual check/uncheck intents, never a wholesale stale snapshot. Rebase pending intents over refreshed server state so reads cannot clobber local writes.

**REL-04 — Reopen and refresh.** Cache versioned app-shell assets for offline cold reopen after the first successful online load and completed priming. An unprimed first visit cannot work offline; explain this limitation. Keep authentication tokens and API response bodies out of service-worker caches; user records belong in scoped data storage. On visibility/reconnect, refresh appropriate user queries and drain eligible intents, without indiscriminately refetching immutable reference data. Connectivity signals alone do not establish server reachability.

**REL-05 — Honest status.** Mobile and desktop expose offline/online, pending count, last successful sync, authentication-needed and failure states. “Synced” requires no unresolved pending or failed operations and a successful server exchange. Announce meaningful status changes accessibly without noisy repeated messages.

**REL-06 — Identity lifecycle.** An expired token while offline permits the previously identified account to read its cache and queue edits for that same identity, consistent with SPEC §3.3; it does not authorise server writes. Explicit sign-out denies cached account access and warns about unsynced work. Allow cancelling sign-out or retaining inaccessible pending work for the same account; destructive discard requires separate explicit approval. Never silently delete drafts/outbox. Account switches must not display, send or reassign another account’s records.

**Acceptance REL-A:** After priming, disable network, edit a meal and tick shopping items, close all tabs, then reopen: shell, edits and pending count survive. Inject IndexedDB failure: no durable-success message appears. Restore network with acknowledgement loss: each operation applies once. Repeat with two devices, stale reads, expired credentials and account switching; pending work remains correctly owned and visible only to its owner.

## 4. Data model and atomic operations

**TXN-01 — Aggregate integrity.** [user.ts](../src/data/user.ts), lines 245–276, inserts workout headers and sets separately; target switching at lines 108–123 unsets then sets, and target creation is also nontransactional. Replace these sequences with authorised, owner-checked database transactions/RPCs for complete workout aggregates and race-target changes, including creation. Reject mixed-owner child records. Use operation receipts or an equivalent transactional idempotency mechanism. Preserve automatic first-race targeting and the single-target invariant.

**Acceptance TXN-A:** Inject failure between header/set writes and between target updates: server state remains entirely unchanged. Retry an acknowledged operation with its original UUID: exactly one aggregate/result exists. Unauthenticated and wrong-owner calls cannot read or alter protected records, including nested sets and replay receipts.

**MIG-01 — Compatibility.** Keep UUID user identifiers, stable reference slugs, foreign keys, sort order and existing RLS protections. Specify local database versions and restart-safe upgrades preserving drafts, queued operations and failures. Incompatible cache versions must not delete unsynced work. Define server/client compatibility before rollout. Remote schema migrations are forward-only, reviewed, tested locally from clean and populated databases, and applied remotely only with separate explicit approval. Never edit applied migrations. Regenerate database types from the approved schema rather than hand-authoring row types.

## 5. Reference data and validation

**DATA-01 — Preserve seed contracts.** Reference updates remain migration-driven. Retain seed validation for uniqueness, foreign keys, recipe ingredients/steps, contiguous step numbers, exercise video URLs and weekday range. `quantity_text` remains canonical display text; parsed quantity fields are for aggregation only. Do not change seed values or dietary content as an incidental UI fix. Keep reference cache invalidation compatible with SPEC’s schema-version contract.

## 6. Feature requirements

### 6.1 Today and workout recovery — P1

[WorkoutLogger.tsx](../src/features/today/WorkoutLogger.tsx) keeps draft rows in `useState` around line 86. Prefill around lines 40–50 gathers sets by latest date and can combine separate workouts.

**WORK-01:** Durably restore identity-scoped drafts with session identifier, date, phase, notes and sets after refresh/reopen. Drafts remain separate from saved logs and queued save operations. Select the most recent workout occurrence containing each exercise, ordering deterministically by date, `created_at`, then ID. Preserve useful exercise history across templates; do not restrict prefill to the current template. Timers remain ephemeral, wall-clock driven and outside server sync.

**WORK-02:** Show a pre-save review of included sets and logging date, and confirm partial sessions. Current `done || reps > 0` behaviour includes unconfirmed prefilled reps and matches SPEC §6.1’s textual rule, while its partial-set example needs clarification. Changing completion semantics requires D-01 approval; recommend explicit confirmation or clearly defined edited/completed eligibility. Do not zero prefilled reps by default. Saving failures retain drafts; successful local acceptance links the draft to its durable save intent, preventing duplicate submissions.

**WORK-03:** Preserve calendar carryover’s explicit “done today” logging behaviour; backdating is a separate decision. Offer saved-session detail; corrections require an agreed audit/date policy. Validate sauna inputs as finite numbers, nonnegative or positive according to field meaning and units; reject invalid submissions without arbitrary medical bounds. Guard pending sauna submissions against duplicates.

**Acceptance WORK-A:** Reload a partially edited draft under the same account and restore all fields; another account sees none. Two workouts on one date prefill from one deterministic occurrence per exercise. Review two-of-four sets under approved D-01 rules, fail saving, retry and obtain one correct aggregate. Carryover records today’s date as disclosed. Invalid sauna numbers remain unsaved with field feedback.

### 6.2 Calendar — P1

[CalendarPage.tsx](../src/features/calendar/CalendarPage.tsx), lines 194–196, steps months/years by 30/365 days; 2027-01-31 plus 30 days reaches 2027-03-02. Month cells around lines 936–985 are noninteractive `div` elements.

**CAL-01:** Step by calendar month/year, retain local-midday anchoring and clamp invalid destination days. Store selected date and view in the URL. Selecting a month day opens its week with that date selected; provide keyboard operation, visible focus and accessible labels. Distinguish scheduled and completed markers without colour alone.

**Acceptance CAL-A:** Next from 2027-01-31 selects 2027-02-28; next year from 2028-02-29 selects 2029-02-28. Test reverse steps, December/January, leap years and DST. Keyboard-select a day, refresh, then Back: date/view restore correctly and completion labels remain available.

### 6.3 Plan and first use — P1

**PLAN-01:** With no target race, offer an actionable Add race state without `NaN` or broken schedules. Explain calculated versus pinned phase, effective date and Clear pin. Target operations use TXN-01. Preserve SPEC’s sauna guidance and kit content.

### 6.4 Moves

Preserve existing filtering, reference detail and tap-to-load videos. Shared accessibility improvements apply; this programme does not redesign the exercise library.

### 6.5 Food — P0 shopping, P1 journeys

**SHOP-01 — Stable identity:** [shoppingList.ts](../src/domain/shoppingList.ts), lines 158–186, drops the staple prefix when emitting `item_key`, allowing separate eggs entries to share `eggs|P`. Preserve a stable namespace in emitted keys. Historical ambiguous keys require an approved migration: retain original state, surface unresolved mappings and never guess which item the user checked.

**SHOP-02 — Explicit lifecycle:** [user.ts](../src/data/user.ts), lines 415–424, clears basket items but leaves checks. Propose a separate **Start new shop** action with confirmation and undo, scoped to an agreed list/trip identity. D-02 gates schema design. Preserve historical intent across devices; stale offline checks must not recreate ticks in a new trip. Editing the basket must not clear unrelated ticks. Show selected recipe names/removal, remaining versus completed items and an optional pantry-staple distinction. Do not alter quantity aggregation. Repeated recipe nights currently collapse to unique slugs: retain deduplication until D-03 resolves batches, leftovers and servings.

**FOOD-01 — Connected navigation:** [TodayPage.tsx](../src/features/today/TodayPage.tsx), lines 301–324, links tonight’s meal to default `/food` rather than its recipe. Deep-link the exact recipe, preserving refresh and Back. Wire the unused `onPlanForDay` path in [RecipesPane.tsx](../src/features/food/RecipesPane.tsx), lines 189–198, to a dinner-only day picker. Add recipe-name/ingredient search to browsing and selection.

**FOOD-02 — Planning:** [PlannerPane.tsx](../src/features/food/PlannerPane.tsx), lines 32–34, anchors the current week. Add previous/next week and URL date state. Auto-fill around lines 64–70 ignores counts calculated at 54–62: replace it with deterministic non-AI suggestions respecting approved preferences, preserving assigned dinners, supporting undo and explaining empty candidate sets. Existing fish guidance differs between two and two-to-three; D-04 must reconcile reviewed guidance and settings. Do not establish a medical recommendation or hard-block manually selected meals. Sending meals to Shop shows success/partial failure, retained failed work and Open shop.

**Acceptance FOOD-A:** Open tonight’s recipe, refresh, go Back, plan a searched dinner next week, fill gaps and undo without changing existing dinners, then send and open Shop. Inject a partial send failure and retry without duplicates. Recipe and staple eggs remain independently checkable after restart. Reset a trip while another device is offline: old intents remain attributable and cannot tick the new trip; undo follows approved D-02 semantics.

### 6.6 Statistics — P2

**STAT-01:** Provide tap/keyboard numeric chart inspection, empty and zero/bodyweight states, sets/notes drilldown, weekly/monthly history grouping and sauna history. Label maxima precisely as “heaviest logged set”, not estimated capability or medical progress. Explain phase context, including expected taper-volume reduction, without implying a diagnosis. Define planned-versus-completed denominators before display: scheduled strength occurrences, a stated date range and deduplication rule; exclude optional sauna and report sauna separately. Corrections remain gated by D-05.

**Acceptance STAT-A:** Keyboard and touch expose the same numeric values as pointer inspection. Empty data, zero-load sets and repeated logs produce defined labels and denominators. Drilldown reconciles totals to recorded sets, notes, date and phase.

## 7. Domain guardrails

**DOM-01:** Preserve [SPEC §7](SPEC.md#7-domain-logic--port-exactly): local-midday dates; Sunday 0 through Saturday 6; exact phase/taper boundaries and manual override; fourteen-day heat block ending race minus three days, overriding rather than stacking sauna schedules. Preserve scheduling exclusions and prescription parsing. Keep tested like-unit sums, unlike-unit separation, fractional/compound quantities, pluralisation and unparseable text. Identity fixes must not silently change quantities. Any behavioural exception requires approval plus explicit updated fixtures, not merely changed expected values.

## 8. Account, accessibility and responsive behaviour

**UX-01 — Account/recovery:** Show account identity and safe sign-out. Synchronise the existing local-only theme preference via user settings, retaining local first-paint mirroring. Provide OAuth pending/failure feedback and recoverable Retry states. Load/error-bound Today sections independently so meal failures do not hide training.

**A11Y-01:** Meet WCAG AA contrast and SPEC’s 44 px targets. Verify actual semantic combinations: calculated dim-on-light-background contrast of 4.08 and dark danger-on-surface of 4.03 fall below the 4.5 normal-text threshold. Implement tab/panel associations and roving focus; modal focus trapping, Escape and focus return; visible focus, accessible calendar, live sync statuses, non-colour-only meaning, touch charts and reduced-motion support. Keep Food segments reachable and sticky below the header.

**Acceptance UX-A:** Test both themes at 320/390/768/1024/1440 px and 200% zoom, using keyboard and touch. Confirm navigation/content remain reachable without clipping, dialogs restore focus and OAuth errors permit recovery. Record actual-phone checks separately; they remain pending. Core identity and offline accessibility ship with reliability, not later polish.

## 9. Implementation boundaries

Keep pure algorithms in [src/domain](../src/domain/), persistence/replay/auth coordination in [src/data](../src/data/), journeys in [src/features](../src/features/) and shared primitives/tokens in [components](../src/components/) and [theme](../src/theme/). Reuse installed libraries first. Specify local transaction ownership, replay leadership across tabs, cache hydration and auth-transition ordering before wiring mutations. RLS remains the server security boundary; local scoping is additional isolation, not its replacement.

## 10. Test matrix and release gates

| Requirements            | Required evidence and executable scenarios                                                                                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REL-01–06, MIG-01       | Local DB tests: atomic failure, quota denial, upgrade interruption; authenticated E2E: offline cold reopen, acknowledgement loss, retry/backoff, reauth, wrong identity and sign-out with pending drafts. |
| REL-03, SHOP-01–02      | Two-device tests: stale check/uncheck, pending-intent rebase, reset conflict, historical ambiguous keys and undo. Assert converged state without lost unrelated checks.                                   |
| TXN-01                  | Local Supabase integration: rollback, duplicate operation, target creation/switch; negative RLS/RPC tests for unauthenticated/wrong-owner reads and writes.                                               |
| WORK-01–03              | Component/local DB tests for partial sets, same-date prefill, draft recovery, review/error retention, carryover and sauna validation.                                                                     |
| CAL-01, DOM-01, DATA-01 | Unit vectors for month/year/leap/DST, phase/heat/scheduling/quantities; seed validation and unchanged display contracts.                                                                                  |
| FOOD-01–02, PLAN-01     | Component and authenticated E2E: no race, recipe deep link, next-week picker/search, suggestions/undo, partial send and shopping completion.                                                              |
| UX-01, A11Y-01, STAT-01 | OAuth/error isolation, contrast measurements, keyboard/modal/tab checks, viewport/zoom matrix, real touch interaction and chart/history reconciliation.                                                   |

Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:coverage` and `node scripts/validate-seed.mjs`. Maintain the configured 90% domain coverage floor. Add component, persistence, integration and E2E coverage where missing; do not describe E2E as existing infrastructure. New dependencies require permission, including test tooling. Release evidence must identify environment, fixtures, actual commands, failures and untested cases. Unit success alone cannot certify offline sync or live RLS.

## 11. Delivery controls

Use reviewed PRs and existing CI conventions. Require mapped tests, regression commands and demonstrated recovery. Claim full offline readiness only after primed reopen, idempotent replay, reconciliation and identity isolation are demonstrated in the intended environment. No destructive production testing is authorised.

## 12. Migration and rollout safety

Test populated local-cache and local-Supabase upgrades first. Preserve operation IDs and unresolved shopping mappings; report unsupported records without discarding them. Document interrupted-upgrade recovery and client compatibility. The original importer does not authorise resetting current data. Remote application requires separate approval after local evidence.

## 13. Product decisions pending approval

| Decision                 | Proposed direction / unresolved detail                                                                                               | Blocks                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| D-01 Completion          | Explicit confirmation versus edited/completed sets; reconcile prefilled reps and partial-save expectations without zeroing defaults. | Changed workout inclusion semantics.                        |
| D-02 Shopping lifecycle  | Trip/list identity, reset/undo across devices and user resolution of historical ambiguous keys.                                      | Reset schema, check migration and lifecycle conflict rules. |
| D-03 Repeated meals      | Distinguish cooking batches, leftovers and servings; retain current slug deduplication meanwhile.                                    | Quantity multiplication and repeated-night semantics.       |
| D-04 Dietary preferences | Harmonise reviewed guidance, fish ceilings and configurable suggestion preferences without medical claims or manual-meal blocking.   | Preference-constrained auto-fill and guidance changes.      |
| D-05 History/date policy | Correction audit, deletion, effective date and backdating; keep disclosed carryover-as-today meanwhile.                              | History correction and date-changing controls.              |

Technical design gates also require review: revision/conflict protocol, sign-out retention presentation, replay receipt lifetime and planned/completed denominators. They must not silently decide the product exceptions above.

## 14. Dependency-aware delivery slices

1. **Fixes/harness:** add missing tests, calendar stepping, honest status and shopping-key fixtures without guessing migrations.
2. **Reliability:** reviewed transactional endpoints → local migrations → cache/outbox → shell priming/reopen → reconciliation. Include identity isolation, safe sign-out and accessible statuses. Full readiness requires this entire slice; D-02 gates affected portions.
3. **Workouts:** drafts, prefill, save review and sauna validation on durable operations; D-01 gates completion changes.
4. **Food:** recipe/day/week routes, search, sending and shopping lifecycle; respect D-02–04.
5. **Account/accessibility:** theme sync, first-use guidance, section errors and responsive/assistive checks; do not defer slice-two protections.
6. **Statistics:** accessible exploration and defined comparisons over reliable records; D-05 gates corrections.

Release slices only after dependencies and mapped gates pass; label unfinished capabilities honestly.
