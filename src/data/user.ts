/*
 * User data — read + write (SPEC §4.3). Owner scoping is enforced by RLS; every
 * insert carries the session user_id and a client-generated UUID so offline
 * inserts do not need a round trip.
 *
 * Multi-row operations do NOT go through the table API. A workout header and its
 * sets, and any change to which race is the target, are single transactional
 * RPCs (migration 0009, TXN-01) — see `rpc.ts`. Writing them as sequential
 * statements, as this file used to, leaves the server in a half-applied state
 * when the second one fails: a workout with no sets, or an account with no
 * target race at all.
 *
 * Every such call carries a client-minted operation_id, so retrying an
 * operation the server already applied is a no-op rather than a duplicate.
 *
 * All writes go through the outbox (`useOutboxMutation`): the intent is
 * committed to durable local storage BEFORE the network is touched, so a write
 * made offline survives a reload and replays on reconnect.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { useAuth } from './AuthProvider';
import { useOutboxMutation } from './sync/useOutboxMutation';
import type { Tables, TablesInsert } from './database.types';

export type Race = Tables<'races'>;
export type WorkoutLog = Tables<'workout_logs'>;
export type WorkoutLogSet = Tables<'workout_log_sets'>;
export type SaunaLog = Tables<'sauna_logs'>;
export type MealPlanEntry = Tables<'meal_plan_entries'>;
export type BasketItem = Tables<'basket_items'>;
export type ShoppingCheck = Tables<'shopping_checks'>;
export type UserSettings = Tables<'user_settings'>;

const uuid = () => crypto.randomUUID();

/** Current user id from the session; throws if called while signed out. */
export function useUserId(): string {
  const { session } = useAuth();
  const id = session?.user.id;
  if (!id) throw new Error('Not authenticated');
  return id;
}

// User data changes, so it must be considered stale (the global default is
// staleTime: Infinity for immutable reference data).
//
// Reconnect and focus refetching are re-enabled HERE rather than globally:
// reference data is immutable at runtime, so refetching all of it every time a
// phone wakes up would burn a mobile connection for no new information
// (REL-04).
const userQ = {
  staleTime: 0,
  refetchOnReconnect: true,
  refetchOnWindowFocus: true,
} as const;

// ---- Races -----------------------------------------------------------------

export function useRaces() {
  const userId = useUserId();
  return useQuery({
    ...userQ,
    queryKey: ['races', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('races')
        .select('*')
        .order('race_date', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Race[];
    },
  });
}

/** The starred A race, or null. */
export function useTargetRace(): Race | null {
  const { data } = useRaces();
  return data?.find((r) => r.is_target) ?? null;
}

type AddRaceInput = Omit<TablesInsert<'races'>, 'id' | 'user_id' | 'is_target'> & {
  asTarget?: boolean;
};

/**
 * Add a race. Counting existing races, clearing the old target and inserting
 * happen in one transaction server-side: the first race auto-becomes the A race
 * and a later one only when ticked (SPEC §6.3), and a failure part-way through
 * cannot leave the user targetless.
 */
export function useAddRace() {
  const userId = useUserId();
  return useOutboxMutation<AddRaceInput>(userId, {
    op: 'add_race',
    entity: 'races',
    entityId: () => uuid(),
    payload: ({ asTarget, ...fields }) => ({
      p_race: {
        id: uuid(),
        name: fields.name,
        race_date: fields.race_date,
        location: fields.location ?? null,
        distance: fields.distance ?? null,
        unit: fields.unit ?? null,
        notes: fields.notes ?? null,
      },
      p_as_target: asTarget ?? false,
    }),
    invalidate: ({ userId: id }) => [['races', id]],
  });
}

export function useDeleteRace() {
  const userId = useUserId();
  return useOutboxMutation<string>(userId, {
    op: 'delete_race',
    entity: 'races',
    entityId: (id) => id,
    payload: (id) => ({ id }),
    invalidate: ({ userId: id }) => [['races', id]],
  });
}

/**
 * Star exactly one race. The `races_one_target` partial unique index means the
 * old target must be cleared and the new one set together — as two statements
 * this left no target at all if the second failed.
 */
export function useStarRace() {
  const userId = useUserId();
  return useOutboxMutation<string>(userId, {
    op: 'set_target_race',
    entity: 'races',
    entityId: (id) => id,
    payload: (id) => ({ p_race_id: id }),
    invalidate: ({ userId: id }) => [['races', id]],
  });
}

// ---- User settings (phase override, plan start) ----------------------------

export function useUserSettings() {
  const userId = useUserId();
  return useQuery({
    ...userQ,
    queryKey: ['user_settings', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as UserSettings | null;
    },
  });
}

type SettingsPatch = Partial<Omit<TablesInsert<'user_settings'>, 'user_id'>>;

export function useUpdateSettings() {
  const userId = useUserId();
  return useOutboxMutation<SettingsPatch>(userId, {
    op: 'update_settings',
    entity: 'user_settings',
    entityId: () => userId,
    payload: (patch, { userId: id }) => ({ user_id: id, ...patch }),
    invalidate: ({ userId: id }) => [['user_settings', id]],
  });
}

/** Per-exercise rest-duration overrides, keyed by exercise slug. */
export type RestOverrides = Record<string, number>;

/**
 * Persist a single per-exercise rest default.
 *
 * Merged server-side with `jsonb_set`, not read-modify-written here: two devices
 * setting rest for different exercises would otherwise each write a whole map
 * and the later one would silently drop the other's key (sync contract §1.2).
 */
export function useSetRestOverride() {
  const userId = useUserId();
  return useOutboxMutation<{ slug: string; seconds: number }>(userId, {
    op: 'set_rest_override',
    entity: 'user_settings',
    // Keyed per exercise, so two rest changes never collapse into one intent.
    entityId: ({ slug }) => `rest_overrides.${slug}`,
    payload: ({ slug, seconds }) => ({ p_exercise_slug: slug, p_seconds: seconds }),
    invalidate: ({ userId: id }) => [['user_settings', id]],
  });
}

// ---- Workout logs + sets ---------------------------------------------------

export function useWorkoutLogs() {
  const userId = useUserId();
  return useQuery({
    ...userQ,
    queryKey: ['workout_logs', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workout_logs')
        .select('*')
        .order('logged_on', { ascending: false });
      if (error) throw error;
      return (data ?? []) as WorkoutLog[];
    },
  });
}

/**
 * All of the user's sets with their log's date and creation time, for prefill
 * and stats.
 *
 * `log_created_at` is what separates two workouts logged on the SAME date —
 * without it, prefill cannot tell a morning session from an evening one and
 * merges them (WORK-01).
 */
export interface SetWithDate extends WorkoutLogSet {
  logged_on: string;
  log_created_at: string;
}
export function useAllSets() {
  const userId = useUserId();
  return useQuery({
    ...userQ,
    queryKey: ['workout_sets', userId],
    queryFn: async (): Promise<SetWithDate[]> => {
      const { data, error } = await supabase
        .from('workout_log_sets')
        .select('*, workout_logs!inner(logged_on, created_at)');
      if (error) throw error;
      return (data ?? []).map((r) => {
        const { workout_logs, ...set } = r as WorkoutLogSet & {
          workout_logs: { logged_on: string; created_at: string };
        };
        return {
          ...set,
          logged_on: workout_logs.logged_on,
          log_created_at: workout_logs.created_at,
        };
      });
    },
  });
}

export interface NewSet {
  exercise_slug: string;
  set_no: number;
  weight_kg: number;
  reps: number;
}
export interface NewWorkout {
  logged_on: string;
  session_key: string;
  session_name: string;
  phase_slug: string;
  notes?: string;
  sets: NewSet[];
}

/**
 * Save a whole workout as one aggregate. Header and sets commit together, so a
 * failure between them can no longer leave a logged session with no sets — which
 * reads as a completed-but-empty workout and silently corrupts tonnage stats.
 */
export function useSaveWorkout() {
  const userId = useUserId();
  return useOutboxMutation<NewWorkout>(userId, {
    op: 'save_workout',
    entity: 'workout_logs',
    entityId: () => uuid(),
    payload: (w) => ({
      p_log: {
        id: uuid(),
        logged_on: w.logged_on,
        session_key: w.session_key,
        session_name: w.session_name,
        phase_slug: w.phase_slug,
        notes: w.notes ?? null,
      },
      p_sets: w.sets,
    }),
    invalidate: ({ userId: id }) => [
      ['workout_logs', id],
      ['workout_sets', id],
    ],
  });
}

// ---- Sauna logs ------------------------------------------------------------

export function useSaunaLogs() {
  const userId = useUserId();
  return useQuery({
    ...userQ,
    queryKey: ['sauna_logs', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sauna_logs')
        .select('*')
        .order('logged_on', { ascending: false });
      if (error) throw error;
      return (data ?? []) as SaunaLog[];
    },
  });
}

type NewSaunaLog = Omit<TablesInsert<'sauna_logs'>, 'id' | 'user_id'>;

export function useAddSaunaLog() {
  const userId = useUserId();
  return useOutboxMutation<NewSaunaLog>(userId, {
    op: 'add_sauna_log',
    entity: 'sauna_logs',
    entityId: () => uuid(),
    // The row id is minted here and replayed unchanged, so a retry after a lost
    // acknowledgement upserts the same row rather than logging a second sauna.
    payload: (input, { userId: id }) => ({ ...input, id: uuid(), user_id: id }),
    invalidate: ({ userId: id }) => [['sauna_logs', id]],
  });
}

// ---- Meal plan -------------------------------------------------------------

export function useMealPlan() {
  const userId = useUserId();
  return useQuery({
    ...userQ,
    queryKey: ['meal_plan', userId],
    queryFn: async () => {
      const { data, error } = await supabase.from('meal_plan_entries').select('*');
      if (error) throw error;
      return (data ?? []) as MealPlanEntry[];
    },
  });
}

export function useSetMealPlan() {
  const userId = useUserId();
  return useOutboxMutation<{ plan_date: string; recipe_slug: string }>(userId, {
    op: 'set_meal_plan',
    entity: 'meal_plan_entries',
    // Keyed by date: two edits to the same day collapse to the later one, edits
    // to different days never interfere.
    entityId: ({ plan_date }) => plan_date,
    payload: ({ plan_date, recipe_slug }, { userId: id }) => ({
      id: uuid(),
      user_id: id,
      plan_date,
      recipe_slug,
    }),
    invalidate: ({ userId: id }) => [['meal_plan', id]],
  });
}

export function useClearMealPlanDay() {
  const userId = useUserId();
  return useOutboxMutation<string>(userId, {
    op: 'clear_meal_plan_day',
    entity: 'meal_plan_entries',
    entityId: (plan_date) => plan_date,
    payload: (plan_date, { userId: id }) => ({ user_id: id, plan_date }),
    invalidate: ({ userId: id }) => [['meal_plan', id]],
  });
}

// ---- Basket ----------------------------------------------------------------

export function useBasket() {
  const userId = useUserId();
  return useQuery({
    ...userQ,
    queryKey: ['basket', userId],
    queryFn: async () => {
      const { data, error } = await supabase.from('basket_items').select('*');
      if (error) throw error;
      return (data ?? []) as BasketItem[];
    },
  });
}

/**
 * The basket is an additive set: one intent per member, never a snapshot.
 * A queued whole-basket write would delete recipes added on another device
 * after it was queued (sync contract §3).
 */
export function useToggleBasket() {
  const add = useAddBasketItem();
  const remove = useRemoveBasketItem();
  return {
    mutate: ({ recipe_slug, inBasket }: { recipe_slug: string; inBasket: boolean }) =>
      inBasket ? remove.mutate(recipe_slug) : add.mutate(recipe_slug),
    isPending: add.isPending || remove.isPending,
  };
}

function useAddBasketItem() {
  const userId = useUserId();
  return useOutboxMutation<string>(userId, {
    op: 'add_basket_item',
    entity: 'basket_items',
    entityId: (recipe_slug) => recipe_slug,
    payload: (recipe_slug, { userId: id }) => ({ id: uuid(), user_id: id, recipe_slug }),
    invalidate: ({ userId: id }) => [['basket', id]],
  });
}

function useRemoveBasketItem() {
  const userId = useUserId();
  return useOutboxMutation<string>(userId, {
    op: 'remove_basket_item',
    entity: 'basket_items',
    entityId: (recipe_slug) => recipe_slug,
    payload: (recipe_slug, { userId: id }) => ({ user_id: id, recipe_slug }),
    invalidate: ({ userId: id }) => [['basket', id]],
  });
}

/**
 * Send several recipes to the basket. Each becomes its own intent, so a partial
 * failure leaves the ones that landed in place and retries only the rest
 * (FOOD-02's partial-send requirement).
 */
export function useAddManyToBasket() {
  const add = useAddBasketItem();
  return {
    mutate: (slugs: string[]) => slugs.forEach((slug) => add.mutate(slug)),
    mutateAsync: (slugs: string[]) => Promise.all(slugs.map((slug) => add.mutateAsync(slug))),
    isPending: add.isPending,
  };
}

/**
 * Empty the basket. Fans out to one removal per member rather than a single
 * `delete where user_id = …`: a queued blanket delete would also remove recipes
 * added elsewhere while it was waiting.
 */
export function useClearBasket() {
  const remove = useRemoveBasketItem();
  const { data: basket } = useBasket();
  return {
    mutate: () => (basket ?? []).forEach((b) => remove.mutate(b.recipe_slug)),
    isPending: remove.isPending,
  };
}

// ---- Shopping checks (additive set: presence = ticked) ---------------------

export function useShoppingChecks() {
  const userId = useUserId();
  return useQuery({
    ...userQ,
    queryKey: ['shopping_checks', userId],
    queryFn: async () => {
      const { data, error } = await supabase.from('shopping_checks').select('*');
      if (error) throw error;
      return (data ?? []) as ShoppingCheck[];
    },
  });
}

function useAddCheck() {
  const userId = useUserId();
  return useOutboxMutation<string>(userId, {
    op: 'add_check',
    entity: 'shopping_checks',
    entityId: (item_key) => item_key,
    payload: (item_key, { userId: id }) => ({ id: uuid(), user_id: id, item_key }),
    invalidate: ({ userId: id }) => [['shopping_checks', id]],
  });
}

function useRemoveCheck() {
  const userId = useUserId();
  return useOutboxMutation<string>(userId, {
    op: 'remove_check',
    entity: 'shopping_checks',
    entityId: (item_key) => item_key,
    payload: (item_key, { userId: id }) => ({ user_id: id, item_key }),
    invalidate: ({ userId: id }) => [['shopping_checks', id]],
  });
}

/**
 * Tick or untick one item.
 *
 * Each tick is its own intent against its own `item_key`, so a stale phone
 * reconnecting mid-shop can only affect the items it actually touched — it can
 * never clobber the list with a snapshot (SPEC §3.2, sync contract §3).
 */
export function useToggleCheck() {
  const add = useAddCheck();
  const remove = useRemoveCheck();
  return {
    mutate: ({ item_key, checked }: { item_key: string; checked: boolean }) =>
      checked ? remove.mutate(item_key) : add.mutate(item_key),
    isPending: add.isPending || remove.isPending,
  };
}
