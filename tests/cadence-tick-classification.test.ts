/**
 * The classification pass's PLACE IN THE TICK, proven behaviourally and purely.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE ONE CLAIM THIS FILE EXISTS FOR: a classification failure must never  │
 * │ cost anybody a send, a stop or a completed cadence. Everything else      │
 * │ about the pass is covered by `tests/classify-inbound.test.ts`; what      │
 * │ cannot be seen from there is what happens to the OTHER passes when this  │
 * │ one throws.                                                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── WHY THE REPOSITORY IS MOCKED RATHER THAN SEEDED ─────────────────────────
 *
 * `tests/cadence-tick.test.ts` drives the whole tick against the real hosted
 * database, which is the right way to prove that the passes DO their work. It is
 * the wrong way to prove what happens when one of them throws: provoking a throw
 * from inside `classifyInbound` against a live stack means breaking something
 * real, and the test would then be measuring the breakage rather than the
 * isolation.
 *
 * So: no tenants, no events, no touches. Every other pass legitimately does
 * nothing and reports zero, and the assertion is that the result is STILL a
 * complete, fully-populated `CadenceTickResult` after the last pass has thrown.
 * A tick that returned early, or that let the throw escape, fails here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const classifyInbound = vi.fn();
vi.mock('@/core/classification/classify-inbound', async (importOriginal) => {
  // The real `NO_CLASSIFICATIONS` is kept — the tick uses it as its zero, and a
  // hand-written stand-in here could drift from the real count vocabulary and
  // hide a field that stopped being reported.
  const actual = await importOriginal<
    typeof import('@/core/classification/classify-inbound')
  >();
  return { ...actual, classifyInbound: (...args: unknown[]) => classifyInbound(...args) };
});

/**
 * No tenants and no pending events. The three passes above classification then
 * run for real and correctly do nothing, which is exactly the quiet tick this
 * suite wants as its background.
 */
vi.mock('@/db/repository', () => ({
  forAllTenants_cadenceTick: async () => [],
  forAllTenants_pendingQuoteEvents: async () => [],
  readConsumerCursor: async () => 0,
  // Returns the cursor POSITION, not a row — the consume pass reports it as
  // `cursorAt`, and a mock returning the wrong shape reports `undefined` there.
  registerConsumerCursor: async () => 0,
  forTenant: () => {
    throw new Error('no tenant should be reached in this suite');
  },
  // `classify-inbound.ts` binds the real three at module load to build its
  // default repository. They are never reached here (the module's
  // `classifyInbound` is itself mocked above), but the import must resolve — and
  // a throwing body is better than a silent no-op, because reaching one of these
  // would mean the mock above stopped taking effect.
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

/** Every call the tick makes with no work to do, so a regression is visible. */
async function quietTick() {
  return runCadenceTick({
    now: NOW,
    // Explicit `null` at both seams: `undefined` means "build the real client
    // from the environment", and this machine has an `ANTHROPIC_API_KEY` in
    // `.env.local`. 05-04 fixed exactly this in three remote suites.
    draftClient: null,
    classifyClient: null,
  });
}

beforeEach(() => {
  classifyInbound.mockReset();
  classifyInbound.mockResolvedValue({
    classified: 0,
    needsHuman: 0,
    deferred: 0,
    unparseable: 0,
    deterministicFailed: 0,
    unconfigured: 0,
  });
});

describe('classification is isolated from the rest of the tick (D-16)', () => {
  it('a THROWING classification pass leaves every other count intact', async () => {
    classifyInbound.mockRejectedValue(new Error('anthropic exploded'));

    const result = await quietTick();

    // It did not escape.
    expect(result).toBeDefined();

    // Every other field is still reported. Asserted as the whole object rather
    // than field by field, because the failure this guards against is a pass
    // that returns EARLY — and an early return drops fields rather than
    // corrupting them.
    expect(result.dispatched).toBe(0);
    expect(result.refused).toBe(0);
    expect(result.cadencesCompleted).toBe(0);
    expect(result.eventsConsumed).toBe(0);
    expect(result.cursorAt).toBe(0);
    expect(Object.keys(result.refusals).length).toBeGreaterThan(0);

    // And the classification counts are an honest zero, not a missing key.
    expect(result.inboundClassified).toBe(0);
    expect(result.inboundNeedsHuman).toBe(0);
    expect(result.inboundClassifyDeferred).toBe(0);
    expect(result.classificationUnconfigured).toBe(0);
  });

  it('reports the pass’s counts when it succeeds, collapsing the three unlabelled arms', async () => {
    classifyInbound.mockResolvedValue({
      classified: 7,
      needsHuman: 3,
      deferred: 2,
      unparseable: 1,
      deterministicFailed: 4,
      unconfigured: 0,
    });

    const result = await quietTick();

    expect(result.inboundClassified).toBe(7);
    expect(result.inboundNeedsHuman).toBe(3);
    // 2 + 1 + 4. The three arms all mean "row left unlabelled, nothing for an
    // operator to do" — see the field comment on `CadenceTickResult`.
    expect(result.inboundClassifyDeferred).toBe(7);
    expect(result.classificationUnconfigured).toBe(0);
  });

  it('passes the tick’s pinned clock through, so classified_at is the tick’s moment', async () => {
    await quietTick();

    expect(classifyInbound).toHaveBeenCalledWith({ client: null, now: NOW });
  });

  it('surfaces the unconfigured flag rather than swallowing it (D-10)', async () => {
    classifyInbound.mockResolvedValue({
      classified: 0,
      needsHuman: 0,
      deferred: 0,
      unparseable: 0,
      deterministicFailed: 0,
      unconfigured: 1,
    });

    const result = await quietTick();

    // "No key" and "nothing to classify" are different facts, and a tick that
    // reported them identically would let a missing credential sit unnoticed
    // behind a queue that looks empty.
    expect(result.classificationUnconfigured).toBe(1);
    expect(result.inboundClassified).toBe(0);
  });
});
