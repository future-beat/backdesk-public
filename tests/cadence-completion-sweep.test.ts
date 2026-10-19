/**
 * CAD-03 `all_touches_done` — the post-dispatch completion sweep (plan 03-06).
 *
 * ── THE GAP THIS CLOSES, AND WHY IT WAS INVISIBLE ───────────────────────────
 *
 * `transitions.ts` has prescribed `active + all_touches_done → completed` since
 * 03-03, and `tests/cadence-transitions.test.ts` has asserted that cell all
 * along. Nothing raised the event. A cadence whose five touches had all been
 * sent or skipped therefore sat at `active` — forever, as far as any operator
 * could tell — until D-12 expired it at 42 days and wrote `expired` on a
 * schedule that had actually run its course. The matrix was right and the
 * database disagreed with it, and no test could see that because every test
 * asked one of them and not the other.
 *
 * So this suite asks the DATABASE what the MATRIX prescribes: it drives the
 * real `runCadenceTick` and then reads the rows back.
 *
 * ── THE FOUR CASES, AND WHY THE LAST TWO ARE THE DANGEROUS ONES ─────────────
 *
 *   1. All touches terminal on an ACTIVE cadence → completed. The headline.
 *   2. One touch still live → left alone. The obvious guard.
 *   3. All touches terminal on a PAUSED cadence → LEFT PAUSED (matrix note 5).
 *      A paused cadence is one a human still owes an answer — a customer
 *      replied, or the client pulled the handbrake. Completing it because the
 *      schedule ran out clears it off the operator's queue and throws that
 *      obligation away silently. The naive implementation (reuse the existing
 *      `LIVE_CADENCE_STATUSES` guard the stop and expiry writes use) gets this
 *      exactly wrong, which is why the repository method has its own narrower
 *      guard and why this test exists to hold it there.
 *   4. A cadence with NO touches at all → left alone. Vacuous truth: "every
 *      touch is terminal" is trivially TRUE of the empty set, so the naive
 *      `NOT EXISTS (live touch)` completes cadences whose materialization
 *      failed or has not run yet — retiring a quote that was never chased once,
 *      and reporting it as a cadence that finished.
 *
 * Cases 3 and 4 both fail SILENTLY and both look like success in every count
 * this tick reports. They are the reason this is a suite rather than an
 * assertion.
 *
 * ── THE CONSUMER CURSOR IS GLOBAL, SO THIS SUITE PARKS IT ───────────────────
 *
 * `event_consumer_cursors` holds ONE row for the cadence engine across every
 * client. Parked at the outbox head in `beforeAll` so the tick this suite runs
 * consumes nothing another suite left behind.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';

import { CADENCE_CONSUMER } from '../src/core/cadence/constants';
import { runCadenceTick } from '../src/core/cadence/run-tick';
import { closeDb, forTenant } from '../src/db/repository';

import {
  admin,
  seedCadence,
  seedConnection,
  seedQuotes,
  seedTenant,
  seedTouches,
  teardownTenants,
} from './helpers/seed';

const MS_PER_DAY = 86_400_000;

let tenantId: string;

/**
 * Anchored 5 days back: comfortably inside D-12's 42-day expiry, so nothing
 * here is competing with the expiry sweep for the same rows. An expiring
 * cadence is a different case with a different answer, and it is 03-04's.
 */
const ANCHOR = new Date(Date.now() - 5 * MS_PER_DAY);

/**
 * A cadence with touches in the given terminal/live states.
 *
 * Slots are placed in the FUTURE so the re-window and dispatch passes have
 * nothing to say about them — this suite is about the sweep, and a touch that
 * dispatch could claim would make the assertions depend on contact hours.
 */
async function seedCadenceWith(
  label: string,
  touchStates: Array<Record<string, unknown>>,
  cadenceOverrides: Record<string, unknown> = {},
): Promise<string> {
  const [quote] = await seedQuotes(tenantId, [
    { job_description: `sweep: ${label}`, chase_eligibility: 'eligible' },
  ]);

  const cadenceId = await seedCadence(tenantId, quote.id, {
    sm8_job_uuid: quote.sm8_job_uuid,
    anchor_at: ANCHOR.toISOString(),
    ...cadenceOverrides,
  });

  if (touchStates.length > 0) {
    await seedTouches(
      cadenceId,
      tenantId,
      touchStates.map((state, i) => ({
        scheduled_at: new Date(Date.now() + (i + 5) * 3_600_000).toISOString(),
        ...state,
      })),
    );
  }

  return cadenceId;
}

async function statusOf(cadenceId: string): Promise<string> {
  const [row] = await forTenant(tenantId).cadences.getById(cadenceId);
  return row.status;
}

/** Park the global cadence cursor at the outbox head. */
async function parkCursorAtHead(): Promise<void> {
  const { data, error } = await admin
    .from('quote_status_events')
    .select('id')
    .order('id', { ascending: false })
    .limit(1);
  if (error) throw new Error(`Reading the outbox head failed: ${error.message}`);

  const { error: upsertError } = await admin
    .from('event_consumer_cursors')
    .upsert(
      { consumer: CADENCE_CONSUMER, last_event_id: (data?.[0]?.id as number | undefined) ?? 0 },
      { onConflict: 'consumer' },
    );
  if (upsertError) throw new Error(`Parking the cursor failed: ${upsertError.message}`);
}

beforeAll(async () => {
  tenantId = await seedTenant('Completion Sweep');
  // REQUIRED, and not obviously so: `forAllTenants_cadenceTick()` INNER JOINs
  // `sm8_connections`, so a tenant without one is invisible to every pass of
  // the tick. Without this the sweep simply never runs for this tenant and all
  // five tests below pass — four of them for the wrong reason.
  await seedConnection(tenantId);
  await parkCursorAtHead();
}, 60_000);

afterAll(async () => {
  await teardownTenants([tenantId]);
  await closeDb();
}, 60_000);

it('completes an ACTIVE cadence whose every touch is terminal, through the real tick', async () => {
  const done = await seedCadenceWith('all done', [
    { status: 'sent' },
    { status: 'skipped', skip_reason: 'min_gap' },
    { status: 'sent' },
  ]);

  expect(await statusOf(done)).toBe('active');

  // THE REAL PRODUCTION PATH, not the repository method. What is under test is
  // that the sweep is actually wired into the tick after dispatch — a correct
  // method nobody calls is exactly the state this plan inherited.
  //
  // `draftClient: null` EXPLICITLY, here and in every tick below. Omitting it
  // builds the real Anthropic client from the environment, and 05-04's drafting
  // pass reads the whole `needs_draft` backlog rather than only what this tick
  // promoted — so a suite with no interest in drafting would make billed API
  // calls on any machine that has a key. `undefined` means "build one"; `null`
  // means "there is no client", and that distinction exists for exactly this.
  //
  // `classifyClient: null` carries the same warning one pass later (05-06), and
  // a sharper one: the classification scan is GLOBAL rather than per tenant, so
  // an omitted client would read real inbound replies off the hosted database
  // and put a stranger's words into a billed request.
  const result = await runCadenceTick({
    draftClient: null,
    classifyClient: null,
    now: new Date(),
    jitterMinutes: () => 0,
  });

  expect(await statusOf(done)).toBe('completed');
  expect(result.cadencesCompleted).toBeGreaterThanOrEqual(1);
});

it('leaves a cadence with one still-live touch alone', async () => {
  const partial = await seedCadenceWith('one live', [
    { status: 'sent' },
    { status: 'skipped', skip_reason: 'min_gap' },
    // Still scheduled: there is a message left to send.
    { status: 'scheduled' },
  ]);

  await runCadenceTick({
    draftClient: null,
    classifyClient: null,
    now: new Date(),
    jitterMinutes: () => 0,
  });

  expect(await statusOf(partial)).toBe('active');
});

it('THE MATRIX NOTE 5 ASSERTION: a PAUSED cadence stays paused, touches or not', async () => {
  // A customer replied. Every remaining touch was then retired, so by the
  // schedule's own reckoning this cadence is finished — and it must NOT be
  // completed, because a human still owes this conversation an answer and
  // completing it would take it off the operator's queue.
  const paused = await seedCadenceWith(
    'paused, all done',
    [
      { status: 'sent' },
      { status: 'skipped', skip_reason: 'cadence_stopped' },
    ],
    { status: 'paused', pause_reason: 'customer_reply' },
  );

  await runCadenceTick({
    draftClient: null,
    classifyClient: null,
    now: new Date(),
    jitterMinutes: () => 0,
  });

  const [row] = await forTenant(tenantId).cadences.getById(paused);
  expect(row.status).toBe('paused');
  // The reason survives too — a sweep that cleared it would leave a paused row
  // nobody can explain, which `transitions.ts` note 6 then has to guess about.
  expect(row.pauseReason).toBe('customer_reply');
});

it('THE VACUOUS-TRUTH ASSERTION: a cadence with NO touches is not "done"', async () => {
  // Materialization has not run, or it failed. "Every touch is terminal" is
  // trivially true of zero touches, and completing this row would retire a
  // quote that was never chased even once — reported as a cadence that
  // finished, which is the same word the successful case uses.
  const bare = await seedCadenceWith('no touches', []);

  expect(await forTenant(tenantId).touches.listForCadence(bare)).toEqual([]);

  await runCadenceTick({
    draftClient: null,
    classifyClient: null,
    now: new Date(),
    jitterMinutes: () => 0,
  });

  expect(await statusOf(bare)).toBe('active');
});

it('is idempotent — a second tick completes nothing further', async () => {
  // Every qualifying cadence in this tenant was completed by the tests above,
  // so the guard (`status = 'active'`) is what makes this zero rather than a
  // repeated write. A sweep that re-completed would also re-report, and the
  // count is what an operator reads to know the engine is alive.
  const before = await forTenant(tenantId).cadences.listLive();

  const result = await runCadenceTick({
    draftClient: null,
    classifyClient: null,
    now: new Date(),
    jitterMinutes: () => 0,
  });

  const after = await forTenant(tenantId).cadences.listLive();
  expect(after.map((c) => c.id).sort()).toEqual(before.map((c) => c.id).sort());
  expect(result.cadencesCompleted).toBe(0);
});
