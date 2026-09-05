-- 0010: shopping trip identity (SHOP-02 / decision D-02) and dietary
-- preferences (D-04).
--
-- Problem this solves. `shopping_checks` was a flat per-user set keyed by
-- item_key alone, with no notion of "this shop" versus "the next one":
--
--   * "Clear basket" removed the recipes but left every tick in place, so the
--     next shop started with items already crossed off;
--   * there was nowhere to record that a new trip had begun, so a phone that
--     ticked items offline and reconnected after the list was rebuilt would
--     resurrect ticks against a completely different shopping list.
--
-- A trip id fixes both without any merge heuristics. Ticks belong to a trip, so
-- a stale intent lands on the trip it was made in and is simply not shown.
-- Starting a new shop mints a new id; undo restores the previous one, which is
-- possible precisely because nothing was deleted.
--
-- Historical rows keep their state. They are backfilled to one 'legacy' trip
-- rather than discarded, and the ambiguous keys that predate the SHOP-01 fix
-- (where a recipe ingredient and a pantry staple of the same name shared
-- 'eggs|P') are left exactly as they are — which of the two the user actually
-- ticked is not knowable, and guessing is what the spec forbids.

begin;

-- ============================================================
-- Trip identity
-- ============================================================

-- A single well-known id for "everything ticked before trips existed". A shared
-- sentinel is safe because a trip is only ever meaningful alongside its user_id
-- (see the unique constraint below), and it is trivially expressible in both SQL
-- and TypeScript — a per-user hash would have to be recomputed in the browser
-- for no benefit.
--
-- Nullable, then backfilled, then not-null: an existing row cannot be given a
-- value and a constraint in one step.
alter table shopping_checks
  add column if not exists trip_id uuid;

update shopping_checks
   set trip_id = '00000000-0000-0000-0000-000000000001'::uuid
 where trip_id is null;

alter table shopping_checks
  alter column trip_id set not null;

-- The uniqueness that matters is now per trip: the same item may be ticked in
-- this trip and in a previous one, and both records are real.
alter table shopping_checks
  drop constraint if exists shopping_checks_user_id_item_key_key;
alter table shopping_checks
  add constraint shopping_checks_user_trip_item_key
  unique (user_id, trip_id, item_key);

create index if not exists shopping_checks_user_trip
  on shopping_checks (user_id, trip_id);

-- ============================================================
-- Which trip is current, and dietary preferences
-- ============================================================

-- Defaulted, so a settings row always names a trip and the client never has to
-- reason about a null one.
alter table user_settings
  add column if not exists current_trip_id uuid not null
    default '00000000-0000-0000-0000-000000000001'::uuid;

-- Undo for "Start new shop": the id that was current before, kept so the
-- previous trip's ticks can be restored rather than recreated.
alter table user_settings
  add column if not exists previous_trip_id uuid;

-- D-04. Ceilings are ranges, not caps, and they live here so a user can adjust
-- them. Defaults mirror the reviewed guidance already shown in Food -> Fuel:
-- chicken 1-2 per week, fish 2-3 per week. These are dietary preferences for
-- ordering suggestions, NOT medical limits, and nothing blocks a manual choice.
alter table user_settings
  add column if not exists diet_prefs jsonb not null default
    '{"chicken": {"min": 1, "max": 2}, "fish": {"min": 2, "max": 3}}'::jsonb;

-- Existing rows land on the legacy trip via the column default, so the list a
-- user is looking at right now does not change under them. A user with no
-- settings row at all is handled client-side by the same sentinel.

-- ============================================================
-- start_new_shop / undo_new_shop
-- ============================================================
-- Both are single transactions with a replay receipt, like every other write
-- endpoint (see 0009). Neither deletes a tick.

create or replace function start_new_shop(p_operation_id uuid, p_trip_id uuid default null)
returns jsonb language plpgsql set search_path = ''
as $$
declare
  v_uid      uuid := public.require_uid();
  v_result   jsonb;
  v_previous uuid;
  v_new      uuid;
begin
  select r.result into v_result
    from public.operation_receipts r
   where r.operation_id = p_operation_id and r.user_id = v_uid;
  if found then
    return v_result || jsonb_build_object('duplicate', true);
  end if;

  select s.current_trip_id into v_previous
    from public.user_settings s where s.user_id = v_uid;

  -- The client may supply the id so a retry reuses it rather than starting yet
  -- another trip.
  v_new := coalesce(p_trip_id, gen_random_uuid());

  insert into public.user_settings as us (user_id, current_trip_id, previous_trip_id)
  values (v_uid, v_new, v_previous)
  on conflict (user_id) do update
     set current_trip_id  = v_new,
         previous_trip_id = us.current_trip_id;

  v_result := jsonb_build_object('trip_id', v_new, 'previous_trip_id', v_previous);
  insert into public.operation_receipts (operation_id, user_id, op, result)
  values (p_operation_id, v_uid, 'start_new_shop', v_result);

  return v_result || jsonb_build_object('duplicate', false);
end;
$$;

create or replace function undo_new_shop(p_operation_id uuid)
returns jsonb language plpgsql set search_path = ''
as $$
declare
  v_uid      uuid := public.require_uid();
  v_result   jsonb;
  v_previous uuid;
  v_current  uuid;
begin
  select r.result into v_result
    from public.operation_receipts r
   where r.operation_id = p_operation_id and r.user_id = v_uid;
  if found then
    return v_result || jsonb_build_object('duplicate', true);
  end if;

  select s.current_trip_id, s.previous_trip_id into v_current, v_previous
    from public.user_settings s where s.user_id = v_uid;

  if v_previous is null then
    raise exception 'nothing to undo' using errcode = 'P0002';
  end if;

  -- Swap back. The abandoned trip's ticks stay on disk, so this is reversible
  -- too rather than a one-way door.
  update public.user_settings
     set current_trip_id = v_previous, previous_trip_id = v_current
   where user_id = v_uid;

  v_result := jsonb_build_object('trip_id', v_previous, 'previous_trip_id', v_current);
  insert into public.operation_receipts (operation_id, user_id, op, result)
  values (p_operation_id, v_uid, 'undo_new_shop', v_result);

  return v_result || jsonb_build_object('duplicate', false);
end;
$$;

commit;
