/**
 * CR-03 — a ledger write may fail; the send pass and the tick may not.
 *
 * ── WHY THIS SUITE IS MOCKED, AND `cadence-dispatch.test.ts` IS NOT ─────────
 *
 * The same rationale `cadence-tick-isolation.test.ts` gives, one layer down.
 * The throws that matter here — a pooler hiccup, a statement timeout, a
 * connection reset landing on ONE `setOutcome` — are exactly the ones hosted
 * Postgres will not produce on demand, and faking them by corrupting a row
 * tests a different failure. So the repository seam is mocked to reject at the
 * chosen call, and everything downstream of it (`performSends`,
 * `dispatchDueTouches`, the refusal accounting) is the real code.
 *
 * Two levels, because the isolation is two-layered and either alone leaves a
 * hole open:
 *
 *   1. PER SEND. `performSends` guarded `sender.send()` but not the ledger
 *      write that follows it. One rejected `setOutcome` threw out of the loop,
 *      so every remaining `PendingSend` — already marked `sent` and already
 *      claimed inside a COMMITTED transaction — was abandoned at
 *      `outcome IS NULL` forever. The file's at-most-once rule (D-07) means
 *      those are never auto-resent: the customer simply does not get the
 *      follow-up.
 *   2. PER TENANT. `dispatchDueTouches` called `performSends` OUTSIDE the
 *      try/catch that gives the loop its isolation, so the same throw also
 *      skipped every remaining tenant — contradicting the invariant the file
 *      states in its own words: "one client's broken configuration cannot stop
 *      the other fourteen from being followed up."
 *
 * The honest record after a failed ledger write is still NULL. Neither guard
 * retries, and that is deliberate: a retry here is how a customer gets messaged
 * twice for a message that did go out.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CadenceTickTenant } from '@/db/repository';

/** The callback `forTenant(id).transaction` runs, as this suite intercepts it. */
type TxWork = (tx: unknown) => Promise<unknown>;

const cadenceTickTenants = vi.fn();
const runTransaction = vi.fn<(tenantId: string, work: TxWork) => Promise<unknown>>();
const setOutcome = vi.fn<(...args: unknown[]) => Promise<unknown>>();

vi.mock('@/db/repository', () => ({
  forAllTenants_cadenceTick: (...args: unknown[]) => cadenceTickTenants(...args),
  forTenant: (tenantId: string) => ({
    transaction: (work: TxWork) => runTransaction(tenantId, work),
    ledger: {
      setOutcome: (...args: unknown[]) => setOutcome(tenantId, ...args),
    },
  }),
}));

const { dispatchDueTouches, DISPATCH_REFUSALS } = await import('@/core/cadence/dispatch');

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

/**
 * Copied from `cadence-tick-isolation.test.ts`, and complete on purpose:
 * `contactWindowOf` reads the four window columns BEFORE the transaction opens,
 * so a fixture missing them fails somewhere unrelated to what is under test.
 */
function tenant(tenantId: string): CadenceTickTenant {
  return {
    tenantId,
    name: 'Test Tenant',
    timezone: 'Australia/Perth',
    contactHoursStart: '09:00:00',
    contactHoursEnd: '17:00:00',
    contactDays: [1, 2, 3, 4, 5],
    connectionPausedAt: null,
    settingsPausedAt: null,
    preferredSendTime: '09:30:00',
  };
}

/** Zeros over the exported vocabulary, so a new refusal cannot silently drop out. */
function noRefusals(): Record<string, number> {
  return Object.fromEntries(DISPATCH_REFUSALS.map((reason) => [reason, 0]));
}

/**
 * One committed claim, as `claimForTenant` would have returned it.
 *
 * Addresses from the ACMA 0491 570 1xx fiction block — a plausible-looking
 * number in a fixture is a number somebody eventually sends to.
 */
function pendingSend(tenantId: string, ledgerId: string, address: string) {
  return {
    tenantId,
    ledgerId,
    request: {
      ledgerId,
      tenantId,
      quoteId: '33333333-3333-4333-8333-333333333333',
      cadenceId: '44444444-4444-4444-8444-444444444444',
      touchNumber: 1,
      channel: 'sms' as const,
      to: { address, contactName: 'Fixture Contact' },
      body: 'FIXTURE-BODY-SECRET',
    },
  };
}

/** A sender that records every request it was handed and always succeeds. */
function recordingSender() {
  const sent: string[] = [];
  return {
    provider: 'test',
    sent,
    send: vi.fn(async (request: { ledgerId: string }) => {
      sent.push(request.ledgerId);
      return { kind: 'sent' as const, provider: 'test', providerMessageId: 'PM-1' };
    }),
  };
}

const NOW = new Date('2026-08-28T03:30:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
  cadenceTickTenants.mockResolvedValue([]);
  setOutcome.mockResolvedValue(undefined);
});

describe('performSends — one failed ledger write must not cost the sends behind it', () => {
  beforeEach(() => {
    cadenceTickTenants.mockResolvedValue([tenant(TENANT_A)]);
    runTransaction.mockResolvedValue({
      pending: [
        pendingSend(TENANT_A, 'led-1', '+61491570156'),
        pendingSend(TENANT_A, 'led-2', '+61491570157'),
      ],
      refusals: noRefusals(),
    });
  });

  it('sends BOTH touches when the first outcome write rejects', async () => {
    setOutcome.mockRejectedValueOnce(new Error('statement timeout')).mockResolvedValue(undefined);
    const sender = recordingSender();

    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await dispatchDueTouches({ sender, now: NOW });
    logged.mockRestore();

    // The second touch was ALREADY marked sent and its ledger row ALREADY
    // claimed in a committed transaction. Abandoning it here strands it at
    // `outcome IS NULL` forever — D-07 means nothing ever picks it back up.
    expect(sender.sent).toEqual(['led-1', 'led-2']);
    expect(setOutcome).toHaveBeenCalledTimes(2);
    expect(result.dispatched).toBe(2);
  });

  it('leaves the failed row NULL rather than retrying it — D-07', async () => {
    setOutcome.mockRejectedValueOnce(new Error('statement timeout')).mockResolvedValue(undefined);
    const sender = recordingSender();

    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await dispatchDueTouches({ sender, now: NOW });
    logged.mockRestore();

    // Exactly one attempt per ledger row. A retry after a send that DID go out
    // is how a customer gets messaged twice for a message the provider took.
    const attempted = setOutcome.mock.calls.map((call) => call[1]);
    expect(attempted).toEqual(['led-1', 'led-2']);
    expect(sender.send).toHaveBeenCalledTimes(2);
  });
});

describe('performSends — one tenant’s total ledger failure must not cost another’s send', () => {
  beforeEach(() => {
    cadenceTickTenants.mockResolvedValue([tenant(TENANT_A), tenant(TENANT_B)]);
    runTransaction.mockImplementation(async (tenantId) => ({
      pending: [
        tenantId === TENANT_A
          ? pendingSend(TENANT_A, 'led-a', '+61491570156')
          : pendingSend(TENANT_B, 'led-b', '+61491570158'),
      ],
      refusals: noRefusals(),
    }));
  });

  it('performs and records tenant B’s send while every write for A rejects', async () => {
    setOutcome.mockImplementation(async (tenantId: unknown) => {
      if (tenantId === TENANT_A) throw new Error('connection reset');
      return undefined;
    });
    const sender = recordingSender();

    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await dispatchDueTouches({ sender, now: NOW });
    logged.mockRestore();

    expect(sender.sent).toEqual(['led-a', 'led-b']);
    expect(setOutcome).toHaveBeenCalledWith(TENANT_B, 'led-b', 'sent', 'PM-1');
    expect(result.dispatched).toBe(2);
  });
});

describe('dispatchDueTouches — a throw inside the send pass costs ONE tenant’s pass', () => {
  beforeEach(() => {
    cadenceTickTenants.mockResolvedValue([tenant(TENANT_A), tenant(TENANT_B)]);
    runTransaction.mockImplementation(async (tenantId) => {
      if (tenantId === TENANT_B) {
        return { pending: [pendingSend(TENANT_B, 'led-b', '+61491570158')], refusals: noRefusals() };
      }

      // A failure INSIDE `performSends` that no per-send guard can catch: the
      // claim resolved, its count was already added to the result, and the
      // send loop then throws before any individual send is reached. The
      // per-send guard is the wrong tool for this shape — only the per-tenant
      // one restores the documented invariant.
      return {
        pending: {
          length: 1,
          [Symbol.iterator]() {
            throw new Error('connection reset');
          },
        },
        refusals: noRefusals(),
      };
    });
  });

  it('still dispatches tenant B', async () => {
    const sender = recordingSender();

    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await dispatchDueTouches({ sender, now: NOW });
    logged.mockRestore();

    // "One client's broken configuration cannot stop the other fourteen from
    // being followed up" — the file says so at the top of the loop, and before
    // this guard existed it was false for anything the send pass could throw.
    expect(sender.sent).toEqual(['led-b']);
    expect(setOutcome).toHaveBeenCalledWith(TENANT_B, 'led-b', 'sent', 'PM-1');
    expect(result.dispatched).toBe(2);
  });
});

describe('the new catches log ids and nothing else (T-2-02)', () => {
  it('never lets a customer address, a body or a caught value reach a log line', async () => {
    cadenceTickTenants.mockResolvedValue([tenant(TENANT_A), tenant(TENANT_B)]);
    runTransaction.mockImplementation(async (tenantId) => {
      if (tenantId === TENANT_A) {
        return {
          pending: [pendingSend(TENANT_A, 'led-a', '+61491570156')],
          refusals: noRefusals(),
        };
      }
      return {
        pending: {
          length: 1,
          [Symbol.iterator]() {
            throw new Error('SECRET-0400-000000 not-a-real-number');
          },
        },
        refusals: noRefusals(),
      };
    });
    setOutcome.mockRejectedValue(new Error('SECRET-0400-000000 not-a-real-number'));

    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await dispatchDueTouches({ sender: recordingSender(), now: NOW });
    const lines = logged.mock.calls.map((call) => call.join(' '));
    logged.mockRestore();

    // A driver error can carry the statement, and this statement's parameters
    // include a customer's address; the same rule the surrounding catches in
    // this file already follow. Both catches must therefore DISCARD the caught
    // value rather than bind it.
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) {
      expect(line).not.toContain('SECRET-0400-000000');
      expect(line).not.toContain('+61491570156');
      expect(line).not.toContain('FIXTURE-BODY-SECRET');
    }

    // What they DO say: the id an operator needs to find the row.
    expect(lines.some((line) => line.includes('led-a'))).toBe(true);
    expect(lines.some((line) => line.includes(TENANT_B))).toBe(true);
  });
});
