/**
 * RPT-01 — ONE CLIENT'S BAD ROW MUST NOT WEDGE FOURTEEN, AND THE LOG MUST NOT
 * CARRY A CLIENT'S DATA.
 *
 * ── WHY THIS SUITE IS MOCKED WHILE `attribution-consume.test.ts` IS NOT ─────
 *
 * The same rationale `cadence-dispatch-isolation.test.ts` gives. The throws that
 * matter here — a deadlock, a statement timeout, a pooler reset landing on ONE
 * tenant's run transaction — are exactly the ones hosted Postgres will not
 * produce on demand, and faking them by corrupting a row tests a different
 * failure. So the repository seam is mocked to reject for one tenant, and
 * everything downstream of it (`contiguousRuns`, the head-of-line loop, the
 * decision, the accounting) is the real code.
 *
 * ── THE THREE PROPERTIES, AND WHY EACH ONE IS EXPENSIVE TO GET WRONG ───────
 *
 *   1. THE CURSOR IS HELD, NOT STEPPED OVER. Advancing past a run that failed
 *      would strand its `won` events behind a position that has already passed
 *      them, and no later tick would ever look at them again. That is a
 *      recovered job silently absent from every invoice from then on — the
 *      quietest possible failure of the thing this product is sold on.
 *
 *   2. LATER TENANTS STILL RUN. `event_consumer_cursors` holds ONE position
 *      across every client, so "stop the cursor" used to mean "stop the scan"
 *      and one client's broken row would freeze billing for the other fourteen.
 *      Those runs commit WITHOUT advancing, which is only safe because
 *      `quote_attributions_one_per_quote` makes the re-read next tick a
 *      sequence of zero-row claims. This suite asserts both halves: tenant B's
 *      claim happens, tenant B's advance does not.
 *
 *   3. THE CAUGHT VALUE IS NEVER LOGGED. A driver error carries the failing
 *      statement, and this statement's parameters are a client's job
 *      description, their customer's reply labels and a dollar figure. Vercel's
 *      log is not a place a mistake can be deleted from.
 *
 * PURE. No database, no `ALLOW_REMOTE_TESTS`, runs on bare `npm test`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { QuoteStatusEvent } from '@/db/schema';

/** The callback `forTenant(id).transaction` runs, as this suite intercepts it. */
type TxWork = (tx: unknown) => Promise<unknown>;

const registerCursor = vi.fn<(consumer: string) => Promise<number>>();
const pendingEvents = vi.fn<(afterId: number, limit: number) => Promise<QuoteStatusEvent[]>>();
const runTransaction = vi.fn<(tenantId: string, work: TxWork) => Promise<unknown>>();
const claim = vi.fn<(tenantId: string, row: unknown) => Promise<Array<{ id: string }>>>();
const advanceTo = vi.fn<(tenantId: string, consumer: string, to: number) => Promise<number>>();
const listEscalations = vi.fn<(tenantId: string, quoteId: string) => Promise<unknown[]>>();

/** The ledger row every mocked tenant returns: one QUALIFYING touch (D-02). */
const QUALIFYING_TOUCH = {
  id: '3f1d2c44-0000-4000-8000-000000000001',
  cadenceId: '3f1d2c44-0000-4000-8000-000000000002',
  touchNumber: 1,
  channel: 'sms',
  // NOT 'stub', outcome 'sent', no receipt yet. All three are load-bearing: any
  // one of them flipped makes `decideAttribution` answer `unqualified`, and the
  // claim assertions below would then pass for the wrong reason.
  sender: 'clicksend',
  outcome: 'sent',
  deliveryStatus: null,
  claimedAt: new Date('2026-08-20T02:00:00.000Z'),
};

vi.mock('@/db/repository', () => ({
  registerConsumerCursor: (consumer: string) => registerCursor(consumer),
  forAllTenants_pendingQuoteEvents: (afterId: number, limit: number) =>
    pendingEvents(afterId, limit),
  listEscalationsForQuote: (tenantId: string, quoteId: string) =>
    listEscalations(tenantId, quoteId),
  forTenant: (tenantId: string) => ({
    transaction: (work: TxWork) => runTransaction(tenantId, work),
  }),
}));

const { consumeWonEvents, NO_ATTRIBUTION, ATTRIBUTION_BATCH_LIMIT } = await import(
  '@/core/attribution/consume-wins'
);

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

/** The cursor position every scenario starts from. */
const CURSOR = 10;

/**
 * The repository a run's transaction callback sees.
 *
 * Every read answers EMPTY except the ledger, which answers with one qualifying
 * touch. An empty `quotes.byId` is a real production case (RESEARCH Pitfall 8 —
 * the mirror row is gone), so these runs produce `value_source = 'missing'`
 * attributions: real claims, real accounting, no fixture pretending to be a job.
 */
function txRepo(tenantId: string): unknown {
  return {
    ledger: { listForQuote: vi.fn(async () => [QUALIFYING_TOUCH]) },
    quotes: { byId: vi.fn(async () => []) },
    connection: { get: vi.fn(async () => []) },
    inbound: { listThreadedForQuote: vi.fn(async () => []) },
    cadences: { getByQuoteId: vi.fn(async () => []) },
    // Plan 14-03 (D-06): no lead is linked to these jobs, so none is lead-born.
    leads: { linkedToJob: vi.fn(async () => []) },
    attributions: { claim: (row: unknown) => claim(tenantId, row) },
    consumerCursor: {
      advanceTo: (consumer: string, to: number) => advanceTo(tenantId, consumer, to),
    },
  };
}

/** A `won` outbox row, complete enough for the real consumer to walk it. */
function wonEvent(id: number, tenantId: string): QuoteStatusEvent {
  return {
    id,
    tenantId,
    quoteId: `00000000-0000-4000-8000-00000000000${id}`,
    sm8JobUuid: `00000000-0000-4000-8000-00000000010${id}`,
    fromStatus: 'Quote',
    toStatus: 'Work Order',
    eventType: 'won',
    occurredAt: null,
    detectedAt: new Date('2026-08-25T02:00:00.000Z'),
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  registerCursor.mockResolvedValue(CURSOR);
  // TWO RUNS: tenant A holds events 11 and 12, tenant B holds 13. `contiguousRuns`
  // must chunk them that way, which is what makes "A blocks, B still runs" a
  // question this suite can ask at all.
  pendingEvents.mockResolvedValue([
    wonEvent(11, TENANT_A),
    wonEvent(12, TENANT_A),
    wonEvent(13, TENANT_B),
  ]);
  claim.mockResolvedValue([{ id: 'att-1' }]);
  advanceTo.mockResolvedValue(1);
  listEscalations.mockResolvedValue([]);
  runTransaction.mockImplementation(async (tenantId, work) => work(txRepo(tenantId)));
});

describe('a throwing run holds the cursor without wedging the other tenants', () => {
  beforeEach(() => {
    runTransaction.mockImplementation(async (tenantId, work) => {
      if (tenantId === TENANT_A) throw new Error('deadlock detected on quote 4417 for +61491570156');
      return work(txRepo(tenantId));
    });
  });

  it('blocks the failing tenant and reports it', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await consumeWonEvents();
    logged.mockRestore();

    expect(result.tenantsBlocked).toBe(1);
    // A's two events were NOT consumed — the run never got past the transaction.
    expect(result.eventsConsumed).toBe(1);
  });

  it('still records tenant B’s attribution — the scan continues', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await consumeWonEvents();
    logged.mockRestore();

    // THE HALF THAT MATTERS MOST. If a blocked tenant stopped the whole scan,
    // one client's deadlocked row would stop billing for every other client
    // until somebody noticed — and nothing about a wedge is loud.
    expect(claim).toHaveBeenCalledTimes(1);
    expect(claim.mock.calls[0][0]).toBe(TENANT_B);
  });

  it('WITHHOLDS tenant B’s cursor advance — nothing is stepped over', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await consumeWonEvents();
    logged.mockRestore();

    // B committed its writes and did NOT move the shared position. Advancing to
    // 13 here would put A's events 11 and 12 permanently behind the cursor: two
    // recovered jobs that no later tick ever looks at again.
    expect(advanceTo).not.toHaveBeenCalled();
    expect(result.cursorAt).toBe(CURSOR);
  });

  it('logs ONE fixed sentence naming the tenant and NOTHING the driver said', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await consumeWonEvents();

    expect(logged).toHaveBeenCalledTimes(1);
    const message = String(logged.mock.calls[0][0]);
    logged.mockRestore();

    expect(message).toContain('[attribution]');
    expect(message).toContain(TENANT_A);

    // THE REJECTION TEXT IS ABSENT, and the fixture is deliberately shaped like
    // a real driver error: it quotes the failing statement, which carries a job
    // number and a customer's mobile. Asserting on the substrings rather than on
    // the whole message is what makes this fail if somebody appends
    // `${String(error)}` "just for debugging".
    expect(message).not.toContain('deadlock');
    expect(message).not.toContain('4417');
    expect(message).not.toContain('+61491570156');
  });
});

describe('a DETERMINISTIC failure is quarantined rather than retried forever', () => {
  // The separation this suite exists to police, seen from the other side. The
  // block above is a TRANSIENT failure — a deadlock — and its answer is to hold
  // the cursor and retry. Here the decision itself cannot be made: tenant A's
  // newest cadence carries an id that is not a uuid, so `buildEvidence` produces
  // a chain `attributionEvidenceSchema` refuses, and `decideAttribution` throws.
  //
  // Retrying THAT next tick produces the same throw on the same event. Held
  // forever, it stops attribution for every tenant behind it while looking
  // exactly like a quiet month. So the event is stepped over, without a row.
  beforeEach(() => {
    runTransaction.mockImplementation(async (tenantId, work) => {
      if (tenantId !== TENANT_A) return work(txRepo(tenantId));

      const repo = txRepo(TENANT_A) as Record<string, unknown>;
      repo.cadences = {
        getByQuoteId: vi.fn(async () => [
          {
            id: 'not-a-uuid',
            createdByEventId: null,
            stopReason: null,
            contactName: null,
            createdAt: new Date('2026-08-19T02:00:00.000Z'),
          },
        ]),
      };
      return work(repo);
    });
  });

  it('counts the poisoned events and writes NO row for them', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await consumeWonEvents();
    logged.mockRestore();

    // Both of A's events fail the same way — it is the same broken cadence.
    expect(result.attributionsPoisoned).toBe(2);
    // NOTHING IS BILLED FROM A DECISION THAT COULD NOT BE MADE. Only B's claim
    // happens; a quarantine that wrote a partial row would be worse than a wedge.
    expect(claim).toHaveBeenCalledTimes(1);
    expect(claim.mock.calls[0][0]).toBe(TENANT_B);
    expect(result.attributionsRecorded).toBe(1);
  });

  it('does NOT block the tenant, and lets the shared cursor advance past it', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await consumeWonEvents();
    logged.mockRestore();

    // THE WHOLE POINT. A quarantined event is consumed, so nothing is held: the
    // cursor reaches 13 and the next tick reads NEW events instead of grinding
    // on the same unfixable one until somebody notices the invoices stopped.
    expect(result.tenantsBlocked).toBe(0);
    expect(result.eventsConsumed).toBe(3);
    expect(result.cursorAt).toBe(13);
    expect(advanceTo).toHaveBeenCalledTimes(2);
  });

  it('logs the EVENT id and nothing about the client', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await consumeWonEvents();
    const messages = logged.mock.calls.map((call) => String(call[0]));
    logged.mockRestore();

    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain('[attribution]');
    expect(messages[0]).toContain('11');
    // The zod message names the offending value, and the offending value is a
    // row from a client's account. Same rule as the blocked-run log next door.
    expect(messages[0]).not.toContain('not-a-uuid');
    expect(messages[0]).not.toContain('invalid');
  });
});

describe('with nothing throwing, each run advances to its own last event', () => {
  it('advances once per run, to that run’s last id', async () => {
    const result = await consumeWonEvents();

    expect(result.tenantsBlocked).toBe(0);
    expect(result.eventsConsumed).toBe(3);
    expect(result.attributionsRecorded).toBe(3);
    // Every mocked quote mirror is absent, so all three are honestly recorded
    // with no dollar figure rather than silently priced at zero.
    expect(result.attributionsValueMissing).toBe(3);
    expect(result.attributionsUnqualified).toBe(0);

    // TWO CALLS, NOT THREE. The advance is per RUN, not per event: A's run
    // covers 11 and 12 and advances once, to 12. An advance per event would be
    // three round trips inside one transaction for the same final position.
    expect(advanceTo).toHaveBeenCalledTimes(2);
    expect(advanceTo.mock.calls[0]).toEqual([TENANT_A, 'attribution', 12]);
    expect(advanceTo.mock.calls[1]).toEqual([TENANT_B, 'attribution', 13]);

    expect(result.cursorAt).toBe(13);
  });

  it('scans from the registered cursor, bounded by the batch limit', async () => {
    await consumeWonEvents();

    expect(registerCursor).toHaveBeenCalledWith('attribution');
    // NOT A PERFORMANCE KNOB: it bounds the work of a single transaction, so a
    // consumer registering for the first time against months of history makes
    // steady progress instead of opening one enormous transaction.
    expect(pendingEvents).toHaveBeenCalledWith(CURSOR, ATTRIBUTION_BATCH_LIMIT);
  });

  it('walks past the four event types it has no work for', async () => {
    pendingEvents.mockResolvedValue([
      { ...wonEvent(11, TENANT_A), eventType: 'reopened' },
      { ...wonEvent(12, TENANT_A), eventType: 'lost' },
      { ...wonEvent(13, TENANT_A), eventType: 'removed' },
    ]);

    const result = await consumeWonEvents();

    // CONSUMED AND ADVANCED, with no read and no claim. A consumer that stopped
    // at an event it has no work for would wedge on the first `lost` in the
    // outbox and never attribute anything again.
    expect(result.eventsConsumed).toBe(3);
    expect(result.attributionsRecorded).toBe(0);
    expect(result.attributionsUnqualified).toBe(0);
    expect(claim).not.toHaveBeenCalled();
    expect(advanceTo).toHaveBeenCalledWith(TENANT_A, 'attribution', 13);
  });
});

describe('the empty-pass literal', () => {
  it('is frozen and all-zero — a pass that did not run reports nothing', () => {
    // FROZEN because it is a shared module-level object that two call sites in
    // `run-tick.ts` spread. A mutation through one of them would silently change
    // what the other reports, and the values are billing counts.
    expect(Object.isFrozen(NO_ATTRIBUTION)).toBe(true);

    expect(NO_ATTRIBUTION).toEqual({
      eventsConsumed: 0,
      attributionsRecorded: 0,
      attributionsUnqualified: 0,
      attributionsValueMissing: 0,
      attributionsPoisoned: 0,
      // NOT a claim that the cursor sits at zero — the ABSENCE of a reading,
      // which is what a pass that declined to register has. That distinction is
      // what makes `attributionCursorAt: 0` pinnable in the tick's all-zero
      // assertion.
      cursorAt: 0,
      tenantsBlocked: 0,
    });
  });

  it('reports the registered cursor, not zero, when there is simply nothing pending', async () => {
    pendingEvents.mockResolvedValue([]);

    const result = await consumeWonEvents();

    // A QUIET PASS AND A SKIPPED PASS MUST NOT LOOK THE SAME. This one took a
    // reading and found the outbox drained; `NO_ATTRIBUTION` never took one.
    expect(result.cursorAt).toBe(CURSOR);
    expect(result.eventsConsumed).toBe(0);
    expect(advanceTo).not.toHaveBeenCalled();
  });
});
