/*
 * The op table and sender (sync contract §3–4): how an intent reaches the
 * server, and how the answer is classified.
 */
import { describe, it, expect } from 'vitest';
import { makeSender } from '@/data/sync/operations';
import type { Intent } from '@/data/local/outbox';

const intent = (over: Partial<Intent> = {}): Intent => ({
  operation_id: 'op-1',
  owner: 'user-a',
  op: 'save_workout',
  entity: 'workout_logs',
  entity_id: 'w1',
  payload: { p_log: {}, p_sets: [] },
  seq: 1,
  deps: [],
  client_ts: 0,
  attempts: 0,
  state: 'pending',
  ...over,
});

describe('makeSender', () => {
  it('passes the intent’s operation_id to the handler, not a fresh one', async () => {
    const seen: Intent[] = [];
    const send = makeSender({
      save_workout: async (i) => {
        seen.push(i);
        return { duplicate: false };
      },
    });
    await send(intent({ operation_id: 'stable-id' }));
    expect(seen[0].operation_id).toBe('stable-id');
  });

  it('reports a server-side replay as a duplicate, not a fresh success', async () => {
    const send = makeSender({ save_workout: async () => ({ duplicate: true }) });
    expect(await send(intent())).toEqual({ kind: 'duplicate' });
  });

  it('reports a first application as ok', async () => {
    const send = makeSender({ save_workout: async () => ({ duplicate: false }) });
    expect(await send(intent())).toEqual({ kind: 'ok' });
  });

  it('treats a void handler (plain table write) as ok', async () => {
    const send = makeSender({ add_check: async () => {} });
    expect(await send(intent({ op: 'add_check' }))).toEqual({ kind: 'ok' });
  });

  it('classifies a thrown error rather than letting it escape', async () => {
    const send = makeSender({
      save_workout: async () => {
        throw { status: 503, message: 'upstream' };
      },
    });
    expect((await send(intent())).kind).toBe('retry');
  });

  it('parks on an expired session instead of dead-lettering the write', async () => {
    const send = makeSender({
      save_workout: async () => {
        throw { code: 'PGRST301', message: 'JWT expired' };
      },
    });
    expect((await send(intent())).kind).toBe('auth');
  });

  it('dead-letters an op this build does not know, keeping the payload visible', async () => {
    // An intent written by a newer deploy, replayed after a rollback. Retrying
    // forever would hide it; the dead letter surfaces it.
    const send = makeSender({});
    const out = await send(intent({ op: 'start_new_shop' }));
    expect(out.kind).toBe('permanent');
    expect(out.kind === 'permanent' && out.error).toMatch(/newer version/i);
  });
});
