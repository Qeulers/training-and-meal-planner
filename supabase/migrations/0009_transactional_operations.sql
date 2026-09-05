-- 0009: transactional, idempotent write endpoints (TXN-01) + replay receipts.
--
-- The client currently writes multi-row operations as separate statements with
-- no transaction:
--   * a workout header, then its sets — a failure between them leaves a session
--     with no sets, which reads as a completed-but-empty workout;
--   * starring a race unsets the old target, then sets the new one — a failure
--     between them leaves the user with NO target race, and the whole plan
--     silently falls back to the general block.
-- Each becomes one function call here, so it is one transaction.
--
-- Idempotency: every function takes a client-minted p_operation_id and records a
-- receipt in the same transaction as its effect. A replay after a lost
-- acknowledgement finds the receipt and returns the original result without
-- repeating the write (REL-02).
--
-- SECURITY INVOKER (the default) is deliberate: RLS then applies to every
-- statement inside these functions exactly as it does to a direct client write,
-- so the policies remain the single security boundary. search_path is pinned and
-- everything is schema-qualified, per the convention in 0001.
--
-- NOT APPLIED REMOTELY. Applying this to the live project is a separate,
-- explicitly approved step (spec §12).

begin;

-- ============================================================
-- Replay receipts
-- ============================================================

create table operation_receipts (
  operation_id uuid primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  op           text not null,
  result       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index on operation_receipts (user_id, created_at desc);

-- Owner-only, like every other user table. A lookup for someone else's
-- operation_id must return nothing rather than revealing that it exists.
alter table operation_receipts enable row level security;
create policy own_rows on operation_receipts for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Receipts are retained 90 days: long enough for any realistic offline gap.
-- An intent still undrained after that is surfaced for the user to confirm
-- rather than replayed blindly. Schedule this (pg_cron or an edge function);
-- it is safe to run repeatedly and does nothing if there is nothing to prune.
create or replace function prune_operation_receipts()
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_deleted integer;
begin
  delete from public.operation_receipts where created_at < now() - interval '90 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke execute on function prune_operation_receipts() from public, anon, authenticated;

-- ============================================================
-- Shared guards
-- ============================================================

create or replace function require_uid()
returns uuid language plpgsql stable set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- ============================================================
-- save_workout — header and sets in one transaction
-- ============================================================

create or replace function save_workout(
  p_operation_id uuid,
  p_log          jsonb,
  p_sets         jsonb default '[]'::jsonb
)
returns jsonb language plpgsql set search_path = ''
as $$
declare
  v_uid    uuid := public.require_uid();
  v_result jsonb;
  v_log_id uuid;
begin
  select r.result into v_result
    from public.operation_receipts r
   where r.operation_id = p_operation_id and r.user_id = v_uid;
  if found then
    return v_result || jsonb_build_object('duplicate', true);
  end if;

  v_log_id := coalesce((p_log->>'id')::uuid, gen_random_uuid());

  -- user_id is taken from the session, never from the payload, so a client
  -- cannot write a log into someone else's account.
  insert into public.workout_logs
    (id, user_id, logged_on, session_key, session_name, phase_slug, notes)
  values
    (v_log_id, v_uid, (p_log->>'logged_on')::date, p_log->>'session_key',
     p_log->>'session_name', p_log->>'phase_slug', p_log->>'notes');

  -- Sets hang off the header just created, so a mixed-owner child is not
  -- rejected so much as unrepresentable: any workout_log_id in the payload is
  -- ignored.
  insert into public.workout_log_sets
    (id, workout_log_id, exercise_slug, set_no, weight_kg, reps)
  select
    coalesce((s->>'id')::uuid, gen_random_uuid()),
    v_log_id,
    s->>'exercise_slug',
    (s->>'set_no')::int,
    (s->>'weight_kg')::numeric,
    (s->>'reps')::int
  from jsonb_array_elements(coalesce(p_sets, '[]'::jsonb)) s;

  v_result := jsonb_build_object('workout_log_id', v_log_id);
  insert into public.operation_receipts (operation_id, user_id, op, result)
  values (p_operation_id, v_uid, 'save_workout', v_result);

  return v_result || jsonb_build_object('duplicate', false);
end;
$$;

-- ============================================================
-- set_target_race — respects races_one_target atomically
-- ============================================================

create or replace function set_target_race(p_operation_id uuid, p_race_id uuid)
returns jsonb language plpgsql set search_path = ''
as $$
declare
  v_uid    uuid := public.require_uid();
  v_result jsonb;
  v_owned  boolean;
begin
  select r.result into v_result
    from public.operation_receipts r
   where r.operation_id = p_operation_id and r.user_id = v_uid;
  if found then
    return v_result || jsonb_build_object('duplicate', true);
  end if;

  select exists (
    select 1 from public.races where id = p_race_id and user_id = v_uid
  ) into v_owned;
  if not v_owned then
    raise exception 'race not found' using errcode = 'P0002';
  end if;

  -- Unset then set, inside one transaction, so races_one_target never sees two
  -- targets and the user is never left with none.
  update public.races set is_target = false
   where user_id = v_uid and is_target and id <> p_race_id;
  update public.races set is_target = true
   where user_id = v_uid and id = p_race_id;

  v_result := jsonb_build_object('race_id', p_race_id);
  insert into public.operation_receipts (operation_id, user_id, op, result)
  values (p_operation_id, v_uid, 'set_target_race', v_result);

  return v_result || jsonb_build_object('duplicate', false);
end;
$$;

-- ============================================================
-- add_race — creation and targeting commit together
-- ============================================================

create or replace function add_race(
  p_operation_id uuid,
  p_race         jsonb,
  p_as_target    boolean default false
)
returns jsonb language plpgsql set search_path = ''
as $$
declare
  v_uid     uuid := public.require_uid();
  v_result  jsonb;
  v_race_id uuid;
  v_count   integer;
  v_target  boolean;
begin
  select r.result into v_result
    from public.operation_receipts r
   where r.operation_id = p_operation_id and r.user_id = v_uid;
  if found then
    return v_result || jsonb_build_object('duplicate', true);
  end if;

  select count(*) into v_count from public.races where user_id = v_uid;
  -- SPEC §6.3: the first race auto-targets; later ones only when asked.
  v_target := coalesce(p_as_target, false) or v_count = 0;
  v_race_id := coalesce((p_race->>'id')::uuid, gen_random_uuid());

  if v_target then
    update public.races set is_target = false where user_id = v_uid and is_target;
  end if;

  insert into public.races
    (id, user_id, name, race_date, location, distance, unit, is_target, notes)
  values
    (v_race_id, v_uid, p_race->>'name', (p_race->>'race_date')::date,
     p_race->>'location', (p_race->>'distance')::numeric,
     coalesce(p_race->>'unit', 'mi'), v_target, p_race->>'notes');

  v_result := jsonb_build_object('race_id', v_race_id, 'is_target', v_target);
  insert into public.operation_receipts (operation_id, user_id, op, result)
  values (p_operation_id, v_uid, 'add_race', v_result);

  return v_result || jsonb_build_object('duplicate', false);
end;
$$;

-- ============================================================
-- set_rest_override — field-level merge, not read-modify-write
-- ============================================================
-- The client reads the whole rest_overrides map, merges one key and writes it
-- back, so two devices setting different exercises lose one edit. jsonb_set
-- merges server-side instead (sync contract §1.2).

create or replace function set_rest_override(
  p_operation_id  uuid,
  p_exercise_slug text,
  p_seconds       integer
)
returns jsonb language plpgsql set search_path = ''
as $$
declare
  v_uid    uuid := public.require_uid();
  v_result jsonb;
begin
  select r.result into v_result
    from public.operation_receipts r
   where r.operation_id = p_operation_id and r.user_id = v_uid;
  if found then
    return v_result || jsonb_build_object('duplicate', true);
  end if;

  if p_seconds is null or p_seconds < 0 then
    raise exception 'rest seconds must be a non-negative integer'
      using errcode = '22023';
  end if;

  -- Aliased, because ON CONFLICT DO UPDATE refers to the existing row by table
  -- alias; a schema-qualified three-part name is not accepted there.
  insert into public.user_settings as us (user_id, rest_overrides)
  values (v_uid, jsonb_build_object(p_exercise_slug, to_jsonb(p_seconds)))
  on conflict (user_id) do update
    set rest_overrides =
      jsonb_set(
        coalesce(us.rest_overrides, '{}'::jsonb),
        array[p_exercise_slug],
        to_jsonb(p_seconds),
        true
      );

  v_result := jsonb_build_object('exercise_slug', p_exercise_slug, 'seconds', p_seconds);
  insert into public.operation_receipts (operation_id, user_id, op, result)
  values (p_operation_id, v_uid, 'set_rest_override', v_result);

  return v_result || jsonb_build_object('duplicate', false);
end;
$$;

commit;
