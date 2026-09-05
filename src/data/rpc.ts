/*
 * Typed wrappers for the transactional endpoints in migration 0009 (TXN-01).
 *
 * `database.types.ts` is generated and currently declares no functions, because
 * 0009 has not been applied to the remote project — generating types from an
 * unapplied migration is not possible, and hand-editing the generated file is
 * forbidden (MIG-01). So the argument and result shapes are declared here, at a
 * single explicit cast boundary, mirroring the pattern `reference.ts` already
 * uses for its dynamic `from()` call.
 *
 * When 0009 is applied and `npm run gen:types` is re-run, the casts below become
 * redundant and should be deleted rather than left to rot.
 */
import { supabase } from './supabase';

/** Every endpoint reports whether this operation_id had already been applied. */
export interface RpcResult {
  duplicate: boolean;
}

export interface SaveWorkoutArgs {
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

export interface AddRaceArgs {
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

export interface SetTargetRaceArgs {
  p_operation_id: string;
  p_race_id: string;
}
export interface SetTargetRaceResult extends RpcResult {
  race_id: string;
}

export interface SetRestOverrideArgs {
  p_operation_id: string;
  p_exercise_slug: string;
  p_seconds: number;
}
export interface SetRestOverrideResult extends RpcResult {
  exercise_slug: string;
  seconds: number;
}

/** The single place untyped `rpc()` is called. */
async function call<T>(name: string, args: object): Promise<T> {
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) throw error;
  return data as T;
}

export const saveWorkoutRpc = (args: SaveWorkoutArgs) =>
  call<SaveWorkoutResult>('save_workout', args);

export const addRaceRpc = (args: AddRaceArgs) => call<AddRaceResult>('add_race', args);

export const setTargetRaceRpc = (args: SetTargetRaceArgs) =>
  call<SetTargetRaceResult>('set_target_race', args);

export const setRestOverrideRpc = (args: SetRestOverrideArgs) =>
  call<SetRestOverrideResult>('set_rest_override', args);
