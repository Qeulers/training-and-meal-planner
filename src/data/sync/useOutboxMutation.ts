/*
 * The write path for user data (REL-01).
 *
 * Every mutation follows the same three steps, in this order:
 *
 *   1. Commit the intent durably. If this throws, nothing else happens and the
 *      caller sees the failure — the user is never told their work is saved
 *      when it is not.
 *   2. Update the query cache so the UI reflects the change immediately.
 *   3. Nudge a drain.
 *
 * Step 1 before step 2 is the whole point. Optimistic-update-then-persist leaves
 * a window where a refresh loses the work with no trace, which is precisely the
 * silent divergence SPEC §3.2 names as the failure mode to avoid.
 */
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useSync } from './SyncProvider';
import type { IntentInput } from '../local/outbox';

export interface OutboxMutationSpec<TInput> {
  /** Operation name; must exist in the op table (`operations.ts`). */
  op: string;
  entity: string;
  /** Stable identity of the thing being changed, for rebasing and dedup. */
  entityId: (input: TInput) => string;
  /** Arguments for the server call. Never includes `p_operation_id`. */
  payload: (input: TInput, ctx: { userId: string }) => unknown;
  /** Query keys to refresh once the change is durable. */
  invalidate?: (ctx: { userId: string }) => QueryKey[];
  /**
   * Immediate cache edit, applied after the intent is durable. Optional: for
   * inserts, invalidation alone is enough once online.
   */
  optimistic?: (
    input: TInput,
    ctx: { userId: string; queryClient: ReturnType<typeof useQueryClient> },
  ) => void;
}

export function useOutboxMutation<TInput>(userId: string, spec: OutboxMutationSpec<TInput>) {
  const queryClient = useQueryClient();
  const { enqueueOp } = useSync();

  return useMutation({
    mutationFn: async (input: TInput) => {
      const intent: Omit<IntentInput, 'owner'> = {
        op: spec.op,
        entity: spec.entity,
        entity_id: spec.entityId(input),
        payload: spec.payload(input, { userId }),
      };
      // Throws on storage failure — deliberately not caught.
      const queued = await enqueueOp(intent);
      spec.optimistic?.(input, { userId, queryClient });
      return queued;
    },
    onSuccess: () => {
      for (const key of spec.invalidate?.({ userId }) ?? []) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}
