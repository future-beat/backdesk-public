/**
 * AN IMPOSSIBLE LEAD-ROUTE LEDGER CLAIM ROLLS BACK (12-REVIEW WR-04).
 *
 * `decideInTransaction` creates the lead cadence and claims its touch 1 in ONE
 * transaction, so `ledger.insertClaim` returning no row there cannot happen.
 * When it does anyway it must THROW — like every other impossible state in the
 * function — so the transaction (and the missed-call claim with it) rolls back
 * and the sweep retries. Returning `claim_lost` would commit a `claimed` call
 * with no ledger row, a live lead cadence and an approved draft for a text that
 * was never sent.
 *
 * PURE: the repository is replaced by recorders, and the transaction runs the
 * work against a fake handle. A throw out of the work is what a real rollback
 * looks like from `sendTextBack`'s side: `pre_claim_failed`, nothing decided.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TouchSender } from '@/core/cadence/sender';
import { defaultTextBackBody, validateTextBackTemplate } from '@/core/leads/template';

const getMissedCallForTextBack = vi.fn();
const isTextBackArmed = vi.fn();
const runTransaction = vi.fn();

vi.mock('@/db/repository', () => ({
  getMissedCallForTextBack: (...args: unknown[]) => getMissedCallForTextBack(...args),
  isTextBackArmed: (...args: unknown[]) => isTextBackArmed(...args),
  forTenant: () => ({ transaction: (work: (tx: unknown) => Promise<unknown>) => runTransaction(work) }),
}));

vi.mock('@/core/messaging/routing-sender', () => ({
  resolveSmsFrom: async () => '+61491570100',
}));

const { sendTextBack } = await import('@/core/leads/text-back');

const NOW = new Date('2026-10-07T02:30:00.000Z');
const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const CALL_ID = '22222222-2222-4222-8222-222222222222';
const NAME = 'Acme Plumbing';
const BODY = (() => {
  const validated = validateTextBackTemplate(defaultTextBackBody('business_hours', NAME), {
    businessName: NAME,
    variant: 'business_hours',
  });
  if (!validated.ok) throw new Error('the default wording must validate');
  return validated.normalizedBody;
})();

const SENDER: TouchSender = {
  provider: 'clicksend',
  send: vi.fn(async () => ({ kind: 'sent' as const, provider: 'clicksend', providerMessageId: 'm1' })),
};

/** A transaction handle on which every fact passes the gate, and the lead route is taken. */
function fakeTx(insertClaim: () => Promise<unknown[]>) {
  return {
    missedCalls: {
      claimForTextBack: vi.fn(async () => [{ id: CALL_ID }]),
      setTextBackDecision: vi.fn(async () => undefined),
      existsTextBackToCallerSince: vi.fn(async () => false),
      countTextBacksSince: vi.fn(async () => 0),
    },
    leads: {
      // 2026-10 (Phase 13, plan 13-03): the real read returns an ARRAY (the
      // open lead this call joined, or `[]`), and the decision now keeps that
      // row for the ring-twice ids. No open lead here.
      noteRepeatCall: vi.fn(async () => []),
      openOrCreate: vi.fn(async () => [{ id: 'lead-1' }]),
      // 2026-10 (Phase 13, found in 13-02): the D-12 cool-off read 13-01 added
      // to the decision. Never a lead here before, so the gate passes.
      latestForMobile: vi.fn(async () => []),
    },
    tenant: {
      get: vi.fn(async () => [
        {
          name: NAME,
          escalationPhone: null,
          timezone: 'Australia/Perth',
          contactHoursStart: '09:00:00',
          contactHoursEnd: '17:00:00',
          contactDays: [1, 2, 3, 4, 5],
        },
      ]),
    },
    neverText: { list: vi.fn(async () => []) },
    divertNumber: { get: vi.fn(async () => []) },
    suppression: { existsFor: vi.fn(async () => []) },
    cadences: {
      liveQuoteCadenceForMobile: vi.fn(async () => []),
      createLead: vi.fn(async () => [{ id: 'cadence-1' }]),
    },
    textBackTemplates: { latestAttested: vi.fn(async () => [{ body: BODY }]) },
    settings: { get: vi.fn(async () => []) },
    touches: {
      insertMany: vi.fn(async (rows: Array<{ touchNumber: number }>) =>
        rows.map((row, index) => ({ id: `touch-${index + 1}`, touchNumber: row.touchNumber })),
      ),
      markSent: vi.fn(async () => undefined),
    },
    drafts: {
      insertAttempt: vi.fn(async () => [{ id: 'draft-1' }]),
      approve: vi.fn(async () => undefined),
    },
    ledger: { insertClaim: vi.fn(insertClaim) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getMissedCallForTextBack.mockResolvedValue({
    id: CALL_ID,
    tenantId: TENANT_ID,
    callerE164: '+61491570156',
    callerKind: 'mobile',
    afterHours: false,
    startedAt: new Date(NOW.getTime() - 80_000),
    endedAt: new Date(NOW.getTime() - 60_000),
    forwardedFromRaw: null,
    textBackStatus: null,
  });
  isTextBackArmed.mockResolvedValue(true);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('the lead route: a zero-row ledger claim is a fault, not a lost race (WR-04)', () => {
  it('throws inside the transaction, so nothing is decided and the sweep retries', async () => {
    const tx = fakeTx(async () => []);
    runTransaction.mockImplementation(async (work: (handle: unknown) => Promise<unknown>) => work(tx));

    const result = await sendTextBack(CALL_ID, { now: NOW, getSender: async () => SENDER });

    // The rollback's face: the row stays undecided — NOT `claim_lost`, which
    // would have committed a `claimed` call with no ledger row.
    expect(result).toEqual({ kind: 'pre_claim_failed' });
    expect(tx.ledger.insertClaim).toHaveBeenCalledTimes(1);
    expect(tx.missedCalls.setTextBackDecision).not.toHaveBeenCalled();
    expect(tx.touches.markSent).not.toHaveBeenCalled();
    expect(SENDER.send).not.toHaveBeenCalled();
  });
});
