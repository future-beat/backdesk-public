/**
 * Phase 15 (CON-05, D-01; T-15-02): `closeLeadFromQueue` proves entitlement
 * BEFORE it reaches the close core — and the ORDERING is the property.
 *
 * `closeLead` writes through the service-role repository, where RLS is inert
 * by design. An action that closed first and checked the caller afterwards
 * would still return the denial sentence — and would already have stopped a
 * stranger's cadence. So the denied cases assert the MOCKS' CALL COUNTS, the
 * only thing that fails on that mistake (the `reports-authorization` mould).
 *
 * PURE: the operator gate, Supabase's server client, the close core and
 * `next/cache` are mocked. No database, no network, no environment.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CloseLeadResult } from '@/core/leads/close';

const TENANT = '11111111-1111-4111-8111-111111111111';
const LEAD = '22222222-2222-4222-8222-222222222222';

let access: 'ok' | 'unauthenticated' | 'forbidden' = 'ok';
let member = true;

const closeLead = vi.fn<(...args: unknown[]) => Promise<CloseLeadResult>>(async () => ({
  kind: 'closed' as const,
}));
const revalidatePath = vi.fn();

vi.mock('@/app/(console)/_auth', () => ({
  requireOperator: async () => access,
  OPERATOR_DENIED_MESSAGE: {
    unauthenticated: 'Your session has expired. Sign in again.',
    forbidden: 'You do not have access to audits.',
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            table === 'tenants' && member
              ? {
                  data: { id: TENANT, name: 'Perth Sparks', timezone: 'Australia/Perth' },
                  error: null,
                }
              : { data: null, error: null },
        }),
      }),
    }),
  }),
}));

vi.mock('@/core/leads/close', () => ({
  closeLead: (...args: unknown[]) => closeLead(...args),
}));

vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => revalidatePath(path),
}));

const { closeLeadFromQueue } = await import('@/app/(console)/leads/actions');
const {
  LEAD_ALREADY_CLOSED_MESSAGE,
  LEAD_CLOSE_FAILED_MESSAGE,
  LEAD_CLOSED_MESSAGE,
} = await import('@/app/(console)/leads/action-state');
const { BAD_REQUEST_MESSAGE, BLANK_CONTROL_STATE, SESSION_EXPIRED_MESSAGE } = await import(
  '@/app/(console)/components/action-state'
);

function form(leadId: string = LEAD): FormData {
  const data = new FormData();
  data.set('lead_id', leadId);
  return data;
}

beforeEach(() => {
  access = 'ok';
  member = true;
  closeLead.mockClear();
  revalidatePath.mockClear();
});

describe('closeLeadFromQueue is gated before it reaches the core', () => {
  it('an expired session closes nothing and revalidates nothing', async () => {
    access = 'unauthenticated';
    const state = await closeLeadFromQueue(TENANT, BLANK_CONTROL_STATE, form());

    expect(state.error).toBe(SESSION_EXPIRED_MESSAGE);
    expect(closeLead).toHaveBeenCalledTimes(0);
    expect(revalidatePath).toHaveBeenCalledTimes(0);
  });

  it('a non-operator closes nothing and revalidates nothing', async () => {
    access = 'forbidden';
    const state = await closeLeadFromQueue(TENANT, BLANK_CONTROL_STATE, form());

    expect(state.error).toBe(BAD_REQUEST_MESSAGE);
    expect(closeLead).toHaveBeenCalledTimes(0);
    expect(revalidatePath).toHaveBeenCalledTimes(0);
  });

  it('a client the operator is not a member of closes nothing', async () => {
    member = false;
    const state = await closeLeadFromQueue(TENANT, BLANK_CONTROL_STATE, form());

    expect(state.error).toBe(BAD_REQUEST_MESSAGE);
    expect(closeLead).toHaveBeenCalledTimes(0);
    expect(revalidatePath).toHaveBeenCalledTimes(0);
  });

  it('a malformed tenant id is refused before the gate is asked', async () => {
    const state = await closeLeadFromQueue('not-a-uuid', BLANK_CONTROL_STATE, form());

    expect(state.error).toBe(BAD_REQUEST_MESSAGE);
    expect(closeLead).toHaveBeenCalledTimes(0);
  });

  it('a malformed lead id is a bad request and closes nothing', async () => {
    const state = await closeLeadFromQueue(TENANT, BLANK_CONTROL_STATE, form('not-a-uuid'));

    expect(state.error).toBe(BAD_REQUEST_MESSAGE);
    expect(state.settled).not.toBe(true);
    expect(closeLead).toHaveBeenCalledTimes(0);
  });
});

describe('closeLeadFromQueue reports what the core did', () => {
  it('closed: reason operator, settled, four paths revalidated', async () => {
    const state = await closeLeadFromQueue(TENANT, BLANK_CONTROL_STATE, form());

    expect(closeLead).toHaveBeenCalledTimes(1);
    expect(closeLead).toHaveBeenCalledWith(TENANT, LEAD, 'operator', expect.any(Date));
    expect(state.success).toBe(LEAD_CLOSED_MESSAGE);
    expect(state.error).toBeNull();
    expect(state.settled).toBe(true);
    expect(revalidatePath).toHaveBeenCalledTimes(4);
    expect(revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      '/leads',
      '/queue',
      '/inbox',
      `/clients/${TENANT}`,
    ]);
  });

  it('already closed: the honest sentence, settled, nothing revalidated', async () => {
    closeLead.mockResolvedValueOnce({ kind: 'already_closed' });
    const state = await closeLeadFromQueue(TENANT, BLANK_CONTROL_STATE, form());

    expect(state.success).toBe(LEAD_ALREADY_CLOSED_MESSAGE);
    expect(state.settled).toBe(true);
    expect(revalidatePath).toHaveBeenCalledTimes(0);
  });

  it('a throw: the fixed sentence, NOT settled, the caught value discarded', async () => {
    const secret = 'relation "leads" violates check on contact_mobile +61491570000';
    closeLead.mockRejectedValueOnce(new Error(secret));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const state = await closeLeadFromQueue(TENANT, BLANK_CONTROL_STATE, form());

    expect(state.error).toBe(LEAD_CLOSE_FAILED_MESSAGE);
    expect(state.settled).not.toBe(true);
    expect(revalidatePath).toHaveBeenCalledTimes(0);
    expect(logged).toHaveBeenCalledWith('[leads] close write failed');
    expect(JSON.stringify(logged.mock.calls)).not.toContain('+6149');
    expect(JSON.stringify(state)).not.toContain(secret);
    logged.mockRestore();
  });
});
