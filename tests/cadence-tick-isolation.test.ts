/**
 * CR-01 — the consume pass may fail; the tick may not.
 *
 * ── WHY THIS SUITE IS MOCKED AND `cadence-tick.test.ts` IS NOT ──────────────
 *
 * The property under test is what happens when the FIRST pass throws, and the
 * throws that matter are the ones the real database will not produce on demand:
 * a deadlock, a statement timeout, a connection reset inside one tenant's run
 * transaction. Seeding those against hosted Postgres is not possible and faking
 * them by corrupting a row would test a different failure. So the repository
 * seam is stubbed here to reject, and everything downstream of it is the real
 * code.
 *
 * Two levels, because the isolation is two-layered and either one alone leaves
 * the hole open:
 *
 *   1. `consumeQuoteEvents` must turn a throwing RUN into a blocked scan rather
 *      than a rejected promise — otherwise the guard in `runCadenceTick` fires
 *      on every transient hiccup and the whole batch is abandoned.
 *   2. `runCadenceTick` must still reach dispatch when consumption throws
 *      anyway — because `consumeQuoteEvents` reads the cursor and the tenant
 *      list BEFORE the loop, and those two calls are outside any per-run guard.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TouchSender } from '@/core/cadence/sender';
import { TEXT_BACK_GRACE_SECONDS, TEXT_BACK_MAX_AGE_MINUTES } from '@/core/leads/constants';
import type { CadenceTickTenant } from '@/db/repository';
import type { QuoteStatusEvent } from '@/db/schema';

/** The callback `forTenant(id).transaction` runs, as this suite intercepts it. */
type TxWork = (tx: unknown) => Promise<unknown>;

const registerConsumerCursor = vi.fn();
const pendingQuoteEvents = vi.fn();
const cadenceTickTenants = vi.fn();
const runTransaction = vi.fn<(tenantId: string, work: TxWork) => Promise<unknown>>();
const listPendingTextBacks = vi.fn<(...args: unknown[]) => Promise<unknown>>(() => {
  throw new Error('the text-back sweep must not run in this suite');
});
const markStaleTextBacks = vi.fn<(...args: unknown[]) => Promise<unknown>>(() => {
  throw new Error('the text-back sweep must not run in this suite');
});

vi.mock('@/db/repository', () => ({
  registerConsumerCursor: (...args: unknown[]) => registerConsumerCursor(...args),
  forAllTenants_pendingQuoteEvents: (...args: unknown[]) => pendingQuoteEvents(...args),
  forAllTenants_cadenceTick: (...args: unknown[]) => cadenceTickTenants(...args),
  forTenant: (tenantId: string) => ({
    transaction: (work: TxWork) => runTransaction(tenantId, work),
  }),
  // ── THE 05-06 CLASSIFICATION TRIO ───────────────────────────────────────
  //
  // `run-tick.ts` now imports the classification pass, which binds these three
  // at module load to build its default repository. They must RESOLVE or the
  // mock fails at import; they must never be REACHED, because every tick in
  // this suite passes `classifyClient: null` and the pass returns before
  // touching the database. Throwing bodies say both things at once — a silent
  // no-op would let a future omitted `classifyClient` read the real hosted
  // `inbound_messages` and look like a passing test.
  CLASSIFY_BATCH_SIZE: 20,
  listUnclassified: () => {
    throw new Error('classification must not run in the isolation suite');
  },
  writeClassification: () => {
    throw new Error('classification must not run in the isolation suite');
  },
  bumpClassifyAttempts: () => {
    throw new Error('classification must not run in the isolation suite');
  },
  // ── THE PHASE 12 TEXT-BACK SWEEP (12-04) ────────────────────────────────
  //
  // `run-tick.ts` imports the sweep, which binds these at module load. They
  // must RESOLVE; they must never be REACHED, because no tick here passes a
  // `textBackSender` and the sweep returns before touching the database.
  //
  // Recorders that THROW by default; only the WR-01 clock case below passes a
  // `textBackSender` and gives them a one-shot answer.
  listPendingTextBacks: (...args: unknown[]) => listPendingTextBacks(...args),
  markStaleTextBacks: (...args: unknown[]) => markStaleTextBacks(...args),
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

const dispatchDueTouches = vi.fn();

// `contactWindowOf` is re-exported verbatim: `run-tick.ts` imports it from this
// module and a mock that dropped it would fail at import rather than at the
// assertion, which is a confusing way to learn the module surface changed.
vi.mock('@/core/cadence/dispatch', async () => {
  const actual = await vi.importActual<typeof import('@/core/cadence/dispatch')>(
    '@/core/cadence/dispatch',
  );
  return {
    ...actual,
    dispatchDueTouches: (...args: unknown[]) => dispatchDueTouches(...args),
  };
});

const { consumeQuoteEvents } = await import('@/core/cadence/consume-events');
const { runCadenceTick } = await import('@/core/cadence/run-tick');

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

/** One outbox row. Only `id`, `tenantId` and `eventType` are read before the
 *  stubbed transaction decides the run's fate. */
function event(id: number, tenantId: string): QuoteStatusEvent {
  return {
    id,
    tenantId,
    quoteId: '33333333-3333-4333-8333-333333333333',
    sm8JobUuid: '44444444-4444-4444-8444-444444444444',
    fromStatus: 'Quote',
    toStatus: 'Work Order',
    eventType: 'won',
    occurredAt: null,
    detectedAt: new Date('2026-08-28T01:00:00.000Z'),
  };
}

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

beforeEach(() => {
  vi.clearAllMocks();
  registerConsumerCursor.mockResolvedValue(0);
  pendingQuoteEvents.mockResolvedValue([]);
  cadenceTickTenants.mockResolvedValue([]);
  dispatchDueTouches.mockResolvedValue({ dispatched: 0, refused: 0, refusals: {} });
});

describe('consumeQuoteEvents — a throwing run blocks the scan, it does not reject', () => {
  it('resolves when one tenant’s run transaction rejects', async () => {
    pendingQuoteEvents.mockResolvedValue([event(1, TENANT_A), event(2, TENANT_A)]);
    cadenceTickTenants.mockResolvedValue([tenant(TENANT_A)]);
    runTransaction.mockRejectedValue(new Error('deadlock detected'));

    // The assertion is the absence of a rejection: an unguarded `await` here is
    // what took the whole tick down.
    await expect(consumeQuoteEvents()).resolves.toMatchObject({ eventsConsumed: 0 });
  });

  it('does not log the caught value — a driver error carries the statement', async () => {
    pendingQuoteEvents.mockResolvedValue([event(1, TENANT_A)]);
    cadenceTickTenants.mockResolvedValue([tenant(TENANT_A)]);
    runTransaction.mockRejectedValue(new Error('SECRET-0400-000000 not-a-real-number'));

    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await consumeQuoteEvents();

    for (const call of logged.mock.calls) {
      expect(call.join(' ')).not.toContain('SECRET-0400-000000');
    }
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe('consumeQuoteEvents — one tenant’s block must not wedge the others (CR-02)', () => {
  /** Every cursor id the real `consumeRun` tried to advance to, in order. */
  let advances: number[];
  /** Whether the run reached for the rows only a `quote_opened` needs (WR-09). */
  let seeded: string[];

  /**
   * The repository surface one `won` run touches. Narrow on purpose: a fake wide
   * enough to serve the whole vocabulary would be a second implementation of the
   * repository, and the DB suites already own that ground.
   */
  function fakeTx() {
    return {
      templates: {
        ensureDefaults: async () => {
          seeded.push('templates.ensureDefaults');
          return [];
        },
        list: async () => [],
      },
      settings: {
        ensure: async () => {
          seeded.push('settings.ensure');
          return { preferredSendTime: '09:30:00' };
        },
      },
      cadences: { stopWhereLiveByQuoteIds: async () => [{ id: 'cadence-1' }] },
      touches: { skipUnsentForCadences: async () => [] },
      consumerCursor: {
        advanceTo: async (_consumer: string, lastEventId: number) => {
          advances.push(lastEventId);
        },
      },
    };
  }

  beforeEach(() => {
    advances = [];
    seeded = [];
    cadenceTickTenants.mockResolvedValue([tenant(TENANT_A), tenant(TENANT_B)]);
    // A blocks; B is healthy. Event 3 is A's again, BEHIND its own block.
    pendingQuoteEvents.mockResolvedValue([
      event(1, TENANT_A),
      event(2, TENANT_B),
      event(3, TENANT_A),
    ]);
    runTransaction.mockImplementation(async (tenantId, work) => {
      if (tenantId === TENANT_A) throw new Error('deadlock detected');
      return work(fakeTx());
    });
  });

  /**
   * The shared cursor is ONE position, so it must not move past tenant A's
   * unconsumed event — but tenant B's `won` must still be applied, because an
   * unconsumed `won` is a cadence still chasing a job the tradie already got.
   */
  it('applies the other tenant’s stop WITHOUT advancing the held cursor', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await consumeQuoteEvents();
    logged.mockRestore();

    // B's run was attempted and its stop landed...
    expect(runTransaction.mock.calls.map((call) => call[0])).toContain(TENANT_B);
    expect(result.cadencesStopped).toBe(1);

    // ...and not one cursor advance was written, at either layer.
    expect(advances).toEqual([]);
    expect(result.cursorAt).toBe(0);
    expect(result.tenantsBlocked).toBe(1);
  });

  it('skips a blocked tenant’s LATER runs — order within a tenant carries meaning', async () => {
    // Consuming event 3 now would apply a stop ahead of the event at 1 that the
    // next tick will still re-read and act on.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await consumeQuoteEvents();
    logged.mockRestore();

    expect(runTransaction.mock.calls.filter((call) => call[0] === TENANT_A)).toHaveLength(1);
  });

  it('advances normally when nothing blocks', async () => {
    pendingQuoteEvents.mockResolvedValue([event(1, TENANT_B), event(2, TENANT_B)]);

    const result = await consumeQuoteEvents();

    expect(advances).toEqual([2]);
    expect(result.cursorAt).toBe(2);
    expect(result.tenantsBlocked).toBe(0);
  });

  /**
   * WR-09 — a run of closing events must not SEED anything.
   *
   * `templates.ensureDefaults` and `settings.ensure` both write. Running them
   * for a `won`-only run created a `cadence_settings` row for a tenant that has
   * never had a cadence, and that row changes the meaning of "no settings row"
   * for `forAllTenants_cadenceTick`, for `resume.ts` and for the console's
   * "client paused" read.
   */
  it('seeds no templates and no settings row for a run of closing events', async () => {
    pendingQuoteEvents.mockResolvedValue([event(1, TENANT_B), event(2, TENANT_B)]);

    await consumeQuoteEvents();

    expect(seeded).toEqual([]);
  });
});

describe('runCadenceTick — consumption failing must not cost anyone their sends', () => {
  it('still dispatches when the consume pass throws outright', async () => {
    // Made to throw at the point BEFORE any per-run guard can catch it: the
    // cursor registration that opens the pass.
    registerConsumerCursor.mockRejectedValue(new Error('connection reset'));

    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    // `draftClient: null` EXPLICITLY. Omitting it builds the real Anthropic
    // client from the environment, and 05-04's drafting pass reads the whole
    // `needs_draft` backlog rather than only what this tick promoted — so a
    // suite about consumption isolation would make billed API calls on any
    // machine that has a key.
    //
    // `classifyClient: null` for the SAME reason, one pass later (05-06): the
    // classification pass scans `inbound_messages` GLOBALLY, so an omitted
    // client here would read real replies off the hosted database and send a
    // stranger's words to the API from any machine with a key.
    const result = await runCadenceTick({
      draftClient: null,
      classifyClient: null,
      now: new Date('2026-08-28T01:30:00.000Z'),
    });
    logged.mockRestore();

    expect(dispatchDueTouches).toHaveBeenCalledTimes(1);
    expect(result.eventsConsumed).toBe(0);
    expect(result.cadencesCreated).toBe(0);
    expect(result.cadencesStopped).toBe(0);
  });

  it('dispatches tenant B even though tenant A’s consumption blocked the scan', async () => {
    pendingQuoteEvents.mockResolvedValue([event(1, TENANT_A), event(2, TENANT_B)]);
    cadenceTickTenants.mockResolvedValue([tenant(TENANT_A), tenant(TENANT_B)]);
    runTransaction.mockRejectedValue(new Error('statement timeout'));

    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runCadenceTick({
      draftClient: null,
      classifyClient: null,
      now: new Date('2026-08-28T01:30:00.000Z'),
    });
    logged.mockRestore();

    expect(dispatchDueTouches).toHaveBeenCalledTimes(1);
  });
});

describe('runCadenceTick — the text-back sweep reads its own clock (12-REVIEW WR-01, D-20)', () => {
  const MS_PER_MINUTE = 60_000;
  const SENDER: TouchSender = {
    provider: 'clicksend',
    send: async () => ({ kind: 'sent', provider: 'clicksend', providerMessageId: null }),
  };

  it('after three minutes of earlier passes, the window and the stale mark are judged at the sweep, not at tick start', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const tickStart = new Date('2026-10-07T02:30:00.000Z');
      const sweepAt = new Date(tickStart.getTime() + 3 * MS_PER_MINUTE);
      vi.setSystemTime(tickStart);
      // The drafting/dispatch passes take three minutes of wall clock.
      dispatchDueTouches.mockImplementationOnce(async () => {
        vi.setSystemTime(sweepAt);
        return { dispatched: 0, refused: 0, refusals: {} };
      });
      listPendingTextBacks.mockResolvedValueOnce([]);
      markStaleTextBacks.mockResolvedValueOnce(0);

      await runCadenceTick({ draftClient: null, classifyClient: null, textBackSender: SENDER });

      expect(listPendingTextBacks).toHaveBeenCalledTimes(1);
      expect(listPendingTextBacks).toHaveBeenCalledWith({
        olderThan: new Date(sweepAt.getTime() - TEXT_BACK_GRACE_SECONDS * 1000),
        newerThan: new Date(sweepAt.getTime() - TEXT_BACK_MAX_AGE_MINUTES * MS_PER_MINUTE),
        limit: expect.any(Number),
      });
      expect(markStaleTextBacks).toHaveBeenCalledWith(
        new Date(sweepAt.getTime() - TEXT_BACK_MAX_AGE_MINUTES * MS_PER_MINUTE),
        sweepAt,
      );
    } finally {
      logged.mockRestore();
      vi.useRealTimers();
    }
  });

  it('an injected tick clock is still the sweep clock, so the pinned suites keep their window', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pinned = new Date('2026-10-07T02:30:00.000Z');
    listPendingTextBacks.mockResolvedValueOnce([]);
    markStaleTextBacks.mockResolvedValueOnce(0);

    await runCadenceTick({ draftClient: null, classifyClient: null, textBackSender: SENDER, now: pinned });
    logged.mockRestore();

    expect(markStaleTextBacks).toHaveBeenCalledWith(
      new Date(pinned.getTime() - TEXT_BACK_MAX_AGE_MINUTES * MS_PER_MINUTE),
      pinned,
    );
  });
});
