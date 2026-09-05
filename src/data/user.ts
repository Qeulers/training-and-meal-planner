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
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { useAuth } from './AuthProvider';
import { addRaceRpc, saveWorkoutRpc, setRestOverrideRpc, setTargetRaceRpc } from './rpc';
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
const userQ = { staleTime: 0 } as const;

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
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ asTarget, ...fields }: AddRaceInput) =>
      addRaceRpc({
        p_operation_id: uuid(),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['races', userId] }),
  });
}

export function useDeleteRace() {
  const userId = useUserId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('races').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['races', userId] }),
  });
}

/**
 * Star exactly one race. The `races_one_target` partial unique index means the
 * old target must be cleared and the new one set together — as two statements
 * this left no target at all if the second failed.
 */
export function useStarRace() {
  const userId = useUserId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      setTargetRaceRpc({ p_operation_id: uuid(), p_race_id: id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['races', userId] }),
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

export function useUpdateSettings() {
  const userId = useUserId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Omit<TablesInsert<'user_settings'>, 'user_id'>>) => {
      const { error } = await supabase
        .from('user_settings')
        .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user_settings', userId] }),
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
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ slug, seconds }: { slug: string; seconds: number }) =>
      setRestOverrideRpc({
        p_operation_id: uuid(),
        p_exercise_slug: slug,
        p_seconds: seconds,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user_settings', userId] }),
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

/** All of the user's sets with their log's date, for prefill + stats. */
export interface SetWithDate extends WorkoutLogSet {
  logged_on: string;
}
export function useAllSets() {
  const userId = useUserId();
  return useQuery({
    ...userQ,
    queryKey: ['workout_sets', userId],
    queryFn: async (): Promise<SetWithDate[]> => {
      const { data, error } = await supabase
        .from('workout_log_sets')
        .select('*, workout_logs!inner(logged_on)');
      if (error) throw error;
      return (data ?? []).map((r) => {
        const { workout_logs, ...set } = r as WorkoutLogSet & {
          workout_logs: { logged_on: string };
        };
        return { ...set, logged_on: workout_logs.logged_on };
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
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (w: NewWorkout) =>
      saveWorkoutRpc({
        p_operation_id: uuid(),
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workout_logs', userId] });
      qc.invalidateQueries({ queryKey: ['workout_sets', userId] });
    },
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

export function useAddSaunaLog() {
  const userId = useUserId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<TablesInsert<'sauna_logs'>, 'id' | 'user_id'>) => {
      const row: TablesInsert<'sauna_logs'> = { ...input, id: uuid(), user_id: userId };
      const { error } = await supabase.from('sauna_logs').insert(row);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sauna_logs', userId] }),
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
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ plan_date, recipe_slug }: { plan_date: string; recipe_slug: string }) => {
      const { error } = await supabase
        .from('meal_plan_entries')
        .upsert(
          { id: uuid(), user_id: userId, plan_date, recipe_slug },
          { onConflict: 'user_id,plan_date' },
        );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meal_plan', userId] }),
  });
}

export function useClearMealPlanDay() {
  const userId = useUserId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (plan_date: string) => {
      const { error } = await supabase
        .from('meal_plan_entries')
        .delete()
        .eq('user_id', userId)
        .eq('plan_date', plan_date);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meal_plan', userId] }),
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

export function useToggleBasket() {
  const userId = useUserId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ recipe_slug, inBasket }: { recipe_slug: string; inBasket: boolean }) => {
      if (inBasket) {
        const { error } = await supabase
          .from('basket_items')
          .delete()
          .eq('user_id', userId)
          .eq('recipe_slug', recipe_slug);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('basket_items')
          .upsert(
            { id: uuid(), user_id: userId, recipe_slug },
            { onConflict: 'user_id,recipe_slug' },
          );
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['basket', userId] }),
  });
}

export function useAddManyToBasket() {
  const userId = useUserId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (slugs: string[]) => {
      if (!slugs.length) return;
      const rows = slugs.map((recipe_slug) => ({ id: uuid(), user_id: userId, recipe_slug }));
      const { error } = await supabase
        .from('basket_items')
        .upsert(rows, { onConflict: 'user_id,recipe_slug', ignoreDuplicates: true });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['basket', userId] }),
  });
}

export function useClearBasket() {
  const userId = useUserId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('basket_items').delete().eq('user_id', userId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['basket', userId] }),
  });
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

export function useToggleCheck() {
  const userId = useUserId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ item_key, checked }: { item_key: string; checked: boolean }) => {
      if (checked) {
        const { error } = await supabase
          .from('shopping_checks')
          .delete()
          .eq('user_id', userId)
          .eq('item_key', item_key);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('shopping_checks')
          .upsert({ id: uuid(), user_id: userId, item_key }, { onConflict: 'user_id,item_key' });
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shopping_checks', userId] }),
  });
}
