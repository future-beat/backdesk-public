/**
 * THE CLAIM IS COMMITTED BEFORE THE EMAIL, SO A FAILED EMAIL MUST STILL REPORT
 * THE CLAIM (WR-07, CON-04, D-11).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `forAllTenants_claimNewlyStalled` FLIPS `stall_alerted_at` AND COMMITS.  │
 * │ The guard on that UPDATE is `stall_alerted_at IS NULL`, so a claimed     │
 * │ touch is never claimed again — by design (D-11: one alert per touch per  │
 * │ threshold crossing, because a per-minute re-alert is trained blindness). │
 * │                                                                          │
 * │ The pass used to wrap the claim, the tally and the send in ONE `try`.    │
 * │ Anything that threw after the claim therefore reported                   │
 * │ `{ 0, 0, 0 }` — and `stallAlertFailed`'s own field comment says it       │
 * │ exists because it "is the only way a lost alert is visible at all".      │
 * │ Those touches were claimed forever, alerted about never, and the tick    │
 * │ said nothing had happened.                                               │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── WHY MOCKED AND NOT SEEDED ───────────────────────────────────────────────
 *
 * `tests/stall-tick.test.ts` drives the claim against the real hosted database,
 * which is the right way to prove the guarded UPDATE does its job. It is the
 * wrong way to prove what happens when the SEND throws afterwards: provoking
 * that against a live stack means breaking the mail seam and then measuring the
 * breakage. The interesting event here is a control-flow one, so the repository
 * is mocked exactly as `tests/cadence-tick-classification.test.ts` mocks it, and
 * every other pass legitimately does nothing.
 *
 * PURE. No database, no network, no environment, and the clock is a literal.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

/** What the guarded UPDATE returned — i.e. what it has already committed. */
const claimNewlyStalled = vi.fn();

/**
 * No tenants and no pending events, so the passes above aging run for real and
 * correctly do nothing. Only the aging pass has anything to say in this suite.
 */
vi.mock('@/db/repository', () => ({
  forAllTenants_cadenceTick: async () => [],
  forAllTenants_pendingQuoteEvents: async () => [],
  readConsumerCursor: async () => 0,
  registerConsumerCursor: async () => 0,
  forAllTenants_claimNewlyStalled: (...args: unknown[]) => claimNewlyStalled(...args),
  forTenant: () => {
    throw new Error('no tenant should be reached in this suite');
  },
  CLASSIFY_BATCH_SIZE: 20,
  listUnclassified: () => {
    throw new Error('the real classification repository must not be reached here');
  },
  writeClassification: () => {
    throw new Error('the real classification repository must not be reached here');
  },
  bumpClassifyAttempts: () => {
    throw new Error('the real classification repository must not be reached here');
  },
  // ── THE PHASE 12 TEXT-BACK SWEEP (12-04) ────────────────────────────────
  //
  // `run-tick.ts` imports the sweep, which binds these at module load. They
  // must RESOLVE; they must never be REACHED, because no tick here passes a
  // `textBackSender` and the sweep returns before touching the database.
  listPendingTextBacks: () => {
    throw new Error('the text-back sweep must not run in this suite');
  },
  markStaleTextBacks: () => {
    throw new Error('the text-back sweep must not run in this suite');
  },
  // And the alert pass (12-04): no `textBackOps` here, so it claims nothing.
  claimTextBackAlerts: () => {
    throw new Error('the text-back alert pass must not run in this suite');
  },
  // And the balance probe (12-04), behind the same seam.
  listArmedTextBackTenantIds: () => {
    throw new Error('the balance probe must not run in this suite');
  },
  disarmChannelBySystem: () => {
    throw new Error('the balance probe must not run in this suite');
  },
  claimOperatorAlert: () => {
    throw new Error('the balance probe must not run in this suite');
  },
}));

const { runCadenceTick } = await import('@/core/cadence/run-tick');

const NOW = new Date('2026-08-31T02:30:00.000Z');

/** Two touches, two clients — the shape one covering email is built from. */
const TWO_CLAIMED = {
  claimed: [
    { touchId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tenantId: TENANT_A },
    { touchId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', tenantId: TENANT_B },
  ],
  perTenant: [
    { tenantId: TENANT_A, tenantName: 'Acme Plumbing', count: 1 },
    { tenantId: TENANT_B, tenantName: 'Bright Sparks', count: 1 },
  ],
};

async function tickWith(stallAlertSender: unknown) {
  return runCadenceTick({
    now: NOW,
    // Explicit `null` at both model seams: `undefined` means "build the real
    // client from the environment", and this machine has a key in `.env.local`.
    draftClient: null,
    classifyClient: null,
    stallAlertSender: stallAlertSender as never,
  });
}

beforeEach(() => {
  claimNewlyStalled.mockReset();
  claimNewlyStalled.mockResolvedValue(TWO_CLAIMED);
});

describe('a post-claim failure still reports the claim (WR-07)', () => {
  it('a THROWING sender reports the claim and one lost alert, never three zeroes', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await tickWith(() => {
      throw new Error('resend exploded');
    });

    // THE ASSERTION. `stall_alerted_at` is committed for both touches and can
    // never be re-claimed; reporting `touchesNewlyStalled: 0` here would make
    // two permanently-unalerted touches invisible in the one place a number
    // about them exists.
    expect(result.touchesNewlyStalled).toBe(2);
    expect(result.stallAlertSent).toBe(0);
    // The SAME shape a `{ ok: false }` send produces — from the operator's side
    // a throw and a refusal are the same event: no email arrived.
    expect(result.stallAlertFailed).toBe(1);

    logged.mockRestore();
  });

  it('an ASYNC rejection is treated identically to a synchronous throw', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await tickWith(async () => {
      throw new Error('smtp timeout');
    });

    expect(result.touchesNewlyStalled).toBe(2);
    expect(result.stallAlertFailed).toBe(1);

    logged.mockRestore();
  });

  it('does not leak the failure detail into the log (T-2-16 house rule)', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    await tickWith(() => {
      throw new Error('connection to Acme Plumbing row failed');
    });

    // The caught value is discarded, never logged: a driver error carries the
    // statement and the statement's parameters are tenants' data.
    for (const call of logged.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('Acme');
      expect(JSON.stringify(call)).not.toContain('connection to');
    }

    logged.mockRestore();
  });

  it('the tick as a whole still returns a complete result', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await tickWith(() => {
      throw new Error('resend exploded');
    });

    // A pass that returned early or let the throw escape drops fields rather
    // than corrupting them, so the neighbours are what fail on it.
    expect(result).toBeDefined();
    expect(result.dispatched).toBe(0);
    expect(result.refused).toBe(0);
    expect(result.eventsConsumed).toBe(0);

    logged.mockRestore();
  });
});

describe('the claim itself is still isolated, and zero is honest there', () => {
  it('a claim that THROWS reports three zeroes — nothing was committed', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    claimNewlyStalled.mockRejectedValue(new Error('pool exhausted'));

    const sender = vi.fn();
    const result = await tickWith(sender);

    // The guarded UPDATE either returned rows or did not run. Nothing to report.
    expect(result.touchesNewlyStalled).toBe(0);
    expect(result.stallAlertSent).toBe(0);
    expect(result.stallAlertFailed).toBe(0);
    // AND NO EMAIL WAS ATTEMPTED. An alert about a claim that did not happen
    // would name clients whose touches are still unclaimed and still due to be
    // alerted about on the next tick.
    expect(sender).not.toHaveBeenCalled();

    logged.mockRestore();
  });

  it('sends nothing, and reports nothing, when the claim moved no rows', async () => {
    claimNewlyStalled.mockResolvedValue({ claimed: [], perTenant: [] });

    const sender = vi.fn();
    const result = await tickWith(sender);

    expect(result.touchesNewlyStalled).toBe(0);
    expect(result.stallAlertFailed).toBe(0);
    expect(sender).not.toHaveBeenCalled();
  });
});

describe('the ordinary path is unchanged', () => {
  it('reports the claim and one sent alert when the send succeeds', async () => {
    const sender = vi.fn().mockResolvedValue({ ok: true });

    const result = await tickWith(sender);

    expect(result.touchesNewlyStalled).toBe(2);
    expect(result.stallAlertSent).toBe(1);
    expect(result.stallAlertFailed).toBe(0);
    // ONE covering email for every newly-stalled client, not one per client —
    // fifteen emails a minute is the shape D-11 forbids by name.
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it('reports a REFUSED send the same way a thrown one is reported', async () => {
    const sender = vi.fn().mockResolvedValue({ ok: false });

    const result = await tickWith(sender);

    expect(result.touchesNewlyStalled).toBe(2);
    expect(result.stallAlertSent).toBe(0);
    expect(result.stallAlertFailed).toBe(1);
  });
});
