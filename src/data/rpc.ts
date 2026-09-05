/*
 * Typed wrappers for the transactional endpoints in migration 0009 (TXN-01).
 *
 * The argument names are checked against the generated `Functions` types, so a
 * signature change in a later migration breaks the build here rather than at
 * runtime. Return shapes are still declared by hand: the functions return jsonb,
 * which the generator can only describe as `Json`.
 */
import { supabase } from './supabase';
import type { Database } from './database.types';

type Fns = Database['public']['Functions'];
/** Compile-time check that a wrapper's arguments match the deployed function. */
type ArgsOf<K extends keyof Fns> = Fns[K]['Args'];

/** Every endpoint reports whether this operation_id had already been applied. */
export interface RpcResult {
  duplicate: boolean;
}

export interface SaveWorkoutArgs extends ArgsOf<'save_workout'> {
  p_operation_id: string;
  p_log: {
    id?: string;
    logged_on: string;
    session_key: string;
    session_name: string;
    phase_slug: string;
    notes: string | null;
  };
  p_sets: { exercise_slug: string; set_no: number; weight_kg: number; reps: number }[];
}
export interface SaveWorkoutResult extends RpcResult {
  workout_log_id: string;
}

export interface AddRaceArgs extends ArgsOf<'add_race'> {
  p_operation_id: string;
  p_race: {
    id?: string;
    name: string;
    race_date: string;
    location: string | null;
    distance: number | null;
    unit: string | null;
    notes: string | null;
  };
  p_as_target: boolean;
}
export interface AddRaceResult extends RpcResult {
  race_id: string;
  is_target: boolean;
}

export interface SetTargetRaceArgs extends ArgsOf<'set_target_race'> {
  p_operation_id: string;
  p_race_id: string;
}
export interface SetTargetRaceResult extends RpcResult {
  race_id: string;
}

export interface SetRestOverrideArgs extends ArgsOf<'set_rest_override'> {
  p_operation_id: string;
  p_exercise_slug: string;
  p_seconds: number;
}
export interface SetRestOverrideResult extends RpcResult {
  exercise_slug: string;
  seconds: number;
}

/** The single place the jsonb return value is given a shape. */
async function call<K extends keyof Fns, T>(name: K, args: ArgsOf<K>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args as never);
  if (error) throw error;
  return data as T;
}

export const saveWorkoutRpc = (args: SaveWorkoutArgs) =>
  call<'save_workout', SaveWorkoutResult>('save_workout', args);

export const addRaceRpc = (args: AddRaceArgs) => call<'add_race', AddRaceResult>('add_race', args);

export const setTargetRaceRpc = (args: SetTargetRaceArgs) =>
  call<'set_target_race', SetTargetRaceResult>('set_target_race', args);

export const setRestOverrideRpc = (args: SetRestOverrideArgs) =>
  call<'set_rest_override', SetRestOverrideResult>('set_rest_override', args);
