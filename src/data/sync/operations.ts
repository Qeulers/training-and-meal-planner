/*
 * The op table: how each outbox intent reaches the server (sync contract §3).
 *
 * One entry per operation name. The outbox knows nothing about Supabase and this
 * file knows nothing about retries — the seam is `SendOutcome`.
 *
 * Additive-set operations (basket, shopping checks) are expressed one member at
 * a time on purpose. "Clear basket" fans out to one delete per member rather
 * than a single truncating delete, so a queued clear cannot remove a recipe that
 * was added on another device after the clear was made.
 */
import { supabase } from '../supabase';
import { classifyError } from '../classifyError';
import {
  addRaceRpc,
  saveWorkoutRpc,
  setRestOverrideRpc,
  setTargetRaceRpc,
  type AddRaceArgs,
  type RpcResult,
  type SaveWorkoutArgs,
  type SetRestOverrideArgs,
  type SetTargetRaceArgs,
} from '../rpc';
import type { Intent, SendFn, SendOutcome } from '../local/outbox';

/** Runs the operation; throwing is fine — the sender classifies it. */
type Handler = (intent: Intent) => Promise<RpcResult | void>;

const payloadOf = <T,>(intent: Intent) => intent.payload as T;

/**
 * Intent payloads never carry `p_operation_id`: the outbox owns that id, and
 * duplicating it invites the two copies to drift apart on a retry.
 */
type Args<T> = Omit<T, 'p_operation_id'>;

export const OPERATIONS: Record<string, Handler> = {
  save_workout: (i) =>
    saveWorkoutRpc({ ...payloadOf<Args<SaveWorkoutArgs>>(i), p_operation_id: i.operation_id }),

  add_race: (i) => addRaceRpc({ ...payloadOf<Args<AddRaceArgs>>(i), p_operation_id: i.operation_id }),

  set_target_race: (i) =>
    setTargetRaceRpc({ ...payloadOf<Args<SetTargetRaceArgs>>(i), p_operation_id: i.operation_id }),

  set_rest_override: (i) =>
    setRestOverrideRpc({ ...payloadOf<Args<SetRestOverrideArgs>>(i), p_operation_id: i.operation_id }),

  delete_race: async (i) => {
    const { error } = await supabase.from('races').delete().eq('id', i.entity_id);
    if (error) throw error;
  },

  add_sauna_log: async (i) => {
    const { error } = await supabase
      .from('sauna_logs')
      .upsert(payloadOf<never>(i), { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw error;
  },

  update_settings: async (i) => {
    const { error } = await supabase
      .from('user_settings')
      .upsert(payloadOf<never>(i), { onConflict: 'user_id' });
    if (error) throw error;
  },

  set_meal_plan: async (i) => {
    const { error } = await supabase
      .from('meal_plan_entries')
      .upsert(payloadOf<never>(i), { onConflict: 'user_id,plan_date' });
    if (error) throw error;
  },

  clear_meal_plan_day: async (i) => {
    const { user_id, plan_date } = payloadOf<{ user_id: string; plan_date: string }>(i);
    const { error } = await supabase
      .from('meal_plan_entries')
      .delete()
      .eq('user_id', user_id)
      .eq('plan_date', plan_date);
    if (error) throw error;
  },

  add_basket_item: async (i) => {
    const { error } = await supabase
      .from('basket_items')
      .upsert(payloadOf<never>(i), { onConflict: 'user_id,recipe_slug', ignoreDuplicates: true });
    if (error) throw error;
  },

  remove_basket_item: async (i) => {
    const { user_id, recipe_slug } = payloadOf<{ user_id: string; recipe_slug: string }>(i);
    const { error } = await supabase
      .from('basket_items')
      .delete()
      .eq('user_id', user_id)
      .eq('recipe_slug', recipe_slug);
    if (error) throw error;
  },

  add_check: async (i) => {
    const { error } = await supabase
      .from('shopping_checks')
      .upsert(payloadOf<never>(i), { onConflict: 'user_id,item_key', ignoreDuplicates: true });
    if (error) throw error;
  },

  remove_check: async (i) => {
    const { user_id, item_key } = payloadOf<{ user_id: string; item_key: string }>(i);
    const { error } = await supabase
      .from('shopping_checks')
      .delete()
      .eq('user_id', user_id)
      .eq('item_key', item_key);
    if (error) throw error;
  },
};

/**
 * Turn the op table into the outbox's `send`.
 *
 * An unknown op is permanent, not retried: it means the intent was written by a
 * newer build than the one now running. Retrying forever would hide it; the
 * dead letter makes it visible and keeps the payload.
 */
export function makeSender(operations: Record<string, Handler> = OPERATIONS): SendFn {
  return async (intent): Promise<SendOutcome> => {
    const handler = operations[intent.op];
    if (!handler) {
      return {
        kind: 'permanent',
        error: `Unknown operation "${intent.op}" — saved by a newer version of the app.`,
      };
    }
    try {
      const result = await handler(intent);
      // The RPCs report a replayed operation explicitly; table writes use
      // ignoreDuplicates and are naturally idempotent.
      return result && 'duplicate' in result && result.duplicate
        ? { kind: 'duplicate' }
        : { kind: 'ok' };
    } catch (err) {
      return classifyError(err);
    }
  };
}
