# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is right now

**The React port is built and is the app.** [SPEC.md](SPEC.md)'s target stack — React (Vite) + TypeScript + Tailwind + Supabase — is implemented under [src/](src/), [supabase/](supabase/) (schema + migrations + seed), and [tests/](tests/) (Vitest). Root [index.html](index.html) is the Vite entry (~35 lines); build/dev/test via `npm run dev | build | test`.

The original single-file vanilla-JS app is archived at [legacy/index.html](legacy/index.html) (~2,300 lines) as a behavioural reference — it is no longer the live app. The `data/*.json` files are seed data (one file per Supabase table), mirrored into [supabase/seed/](supabase/seed/); see [README.md](README.md) "Regenerating".

When asked to "work on the app," it means the React port under `src/` unless the legacy file is named explicitly.

## Domain logic — the load-bearing part

The value of this app is subtle date arithmetic and shopping-list aggregation. These rules live as pure functions in [src/domain/](src/domain/) (`phase.ts`, `heatBlock.ts`, `shoppingList.ts`, `prescription.ts`, `dates.ts`, `sauna.ts`, `schedule.ts`) with table-driven tests in [tests/unit/](tests/unit/), and are restated in **SPEC §7**. Changing their behaviour differently is a regression, not an improvement — keep the tests green.

- **Local-midday anchoring.** All date parsing uses `new Date(dateStr + 'T12:00:00')` to dodge DST/timezone drift. Keep this trick everywhere.
- **`day_of_week` is `0 = Sunday … 6 = Saturday`** (JS `Date.getDay()`), not ISO. Load-bearing across scheduling and seed data — never renumber.
- **Phase calculation** (SPEC §7.1): `p1 → p2 → p3 → recovery → p4` derived from the target race date, with a manual override. Known-good test vectors are in the spec.
- **Heat-acclimation block** (§7.2): 14-day window ending 3 days before race day; it *overrides* the normal sauna schedule rather than stacking.
- **Shopping-list aggregation** (§7.4): combine like units, keep unlike units separate, pluralise via `pluralisation_exceptions.json`, and pass unparseable quantities (`"to taste"`) through as text without breaking the sum. This feature has regressed before — cover it with table-driven tests.
- **Prescription hold parsing** (§7.6): `parseHold('2×45 sec / side')` → `{seconds:45, perSide:true}`; rep-based prescriptions return `null` and fall back to manual entry. Never throw, never guess a duration.

## Data conventions (seed JSON)

- **Slugs are primary keys** for all reference data, carried over unchanged from the app so existing user data maps cleanly.
- **Foreign keys use `*_slug`** naming (`recipe_slug`, `exercise_slug`, `phase_slug`).
- **`sort_order`** preserves original display order and is not derivable — preserve it.
- **Quantities** carry three fields: `quantity_text` (authoritative display string — always show this), plus parsed `quantity_value` / `quantity_unit` (used *only* for summing in the shopping list; `null` when not parseable).

## Validating the seed data

The seed JSON must satisfy the invariants in [README.md](README.md) "Validation performed" — unique slugs, every FK resolves, every recipe has ≥1 ingredient and ≥1 step, `step_no` contiguous from 1, well-formed unique YouTube URLs per exercise, all `day_of_week` in 0–6. These are covered by [tests/data/seed.test.ts](tests/data/seed.test.ts) — re-run `npm test` after any change to a seed JSON file. Reference data changes flow through Supabase migrations in [supabase/migrations/](supabase/migrations/).

## App structure (React port)

- **Routing / shell** — [src/App.tsx](src/App.tsx): six routes matching SPEC §6, with [BottomNav](src/components/BottomNav.tsx) (phone/tablet-portrait) and [SideNav](src/components/SideNav.tsx) (≥lg). Auth-gated via [AuthProvider](src/data/AuthProvider.tsx); `/preview` is a DEV-only no-auth visual harness ([src/features/dev/Preview.tsx](src/features/dev/Preview.tsx)).
- **Features** — one folder per tab under [src/features/](src/features/) (`today`, `calendar`, `plan`, `moves`, `food`, `stats`). The session logger lives in `today/WorkoutLogger.tsx` (+ `SetKeypad.tsx`, `CountdownTimer.tsx`); Food is a segmented set of panes (`FuelPane`, `RecipesPane`, `PlannerPane`, `ShopPane`).
- **Design tokens** — [src/theme/theme.css](src/theme/theme.css) is the single source (dark/light palette, Archivo / Archivo Narrow, self-hosted subset Material Symbols). Tailwind maps semantic utilities to these vars; components use `bg-surface` / `text-accent`, never raw hex. Shared primitives in [src/components/ui.tsx](src/components/ui.tsx).
- **Data** — reference tables via [src/data/reference.ts](src/data/reference.ts), user read/write via [src/data/user.ts](src/data/user.ts) (TanStack Query + Supabase). Slugs are PKs, FKs are `*_slug` (see below).

## Legacy app internals (legacy/index.html)

Only relevant when cross-checking original behaviour. Structure within the single archived file:

- Three `<script>` blocks. Data lives as JS consts (`EX`, `RECIPES*`, `STEPS*`, `SESSIONS`, `SAUNA`, `PHASE_META`); the render layer is a set of `render*()` functions dispatched by `renderAll()`.
- **Persistence** is `localStorage` with an in-memory fallback (the `store` object, ~line 521). All keys are prefixed **`fw_`** (`fw_races`, `fw_phaseOv`, `fw_planStart`, …); `store.wipe()` only clears `fw_`-prefixed keys.
- Six tabs (`data-tab`): `today`, `calendar`, `program` (Plan), `exercises` (Moves), `food`, `progress` (Stats), matching SPEC §6.
