/**
 * CAD-03 against the real database: what a decided quote does to a live cadence.
 *
 * ── WHY THE CLOSING EVENTS ARE INSERTED BY HAND HERE ────────────────────────
 *
 * The `quote_opened` half of this suite drives `markChaseEligible` for real,
 * because that is the production emitter and the tracer suite already proved the
 * shape it writes. The four CLOSING events have a different emitter — Phase 2's
 * sync path, which produces them only when ServiceM8 reports a status change on
 * a live connection — and reproducing that here would mean faking an upstream
 * API response to test a consumer. So they are written straight into the outbox
 * through the repository, which is the same table, the same columns and the same
 * CHECK constraints the sync path writes through.
 *
 * ── THE CURSOR IS GLOBAL, AND THIS SUITE PARKS IT AND REWINDS IT ────────────
 *
 * `event_consumer_cursors` holds ONE row for the cadence engine across every
 * client (see the tracer suite's header). This suite parks it at the outbox head
 * in `beforeAll` so it acts only on its own events, and rewinds it deliberately
 * to prove replay safety — the thing the outbox contract makes legal and
 * therefore the thing every consumer must survive.
 *
 * ── ORDERED, AND THAT IS LOAD-BEARING ───────────────────────────────────────
 *
 * These `it` blocks share one tenant and one cursor and run in file order.
 * `vitest.config.mts` disables file parallelism and vitest runs a file's tests
 * sequentially, so each test may assume the cursor is where the previous one
 * left it.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';

import { consumeQuoteEvents } from '../src/core/cadence/consume-events';
import { CADENCE_CONSUMER } from '../src/core/cadence/constants';
import { normalizeAuMobile } from '../src/core/cadence/primary-contact';
import { hasApprovedTemplateSet } from '../src/core/drafting/onboarding-gate';
import { markChaseEligible } from '../src/core/sync/eligibility';
import { closeDb, forTenant, readConsumerCursor } from '../src/db/repository';
import { ONBOARDING_PAUSE_REASON } from '../src/db/schema';

import {
  admin,
  seedApprovedTemplateSet,
  seedAttestation,
  seedConnection,
  seedQuoteContacts,
  seedQuotes,
  seedSuppression,
  seedTenant,
  teardownTenants,
} from './helpers/seed';

type EventType = 'won' | 'lost' | 'removed' | 'reopened';

let tenantId: string;
let quotes: Array<{ id: string; sm8_job_uuid: string }>;

/** The quote seeded with NO contacts — its cadence is born stopped (D-04). */
const NO_CONTACT_QUOTE = 6;
/** The quote whose live cadence is stopped by a `won` before its event replays. */
const RE_CHASE_QUOTE = 7;
/** The quote whose mirror row is purged and then re-synced under a NEW uuid. */
const PURGED_QUOTE = 8;

/** Move the cursor by hand — including BACKWARDS, which no production path can. */
async function setCursor(lastEventId: number): Promise<void> {
  const { error } = await admin
    .from('event_consumer_cursors')
    .upsert(
      { consumer: CADENCE_CONSUMER, last_event_id: lastEventId },
      { onConflict: 'consumer' },
    );
  if (error) throw new Error(`Setting the cadence cursor failed: ${error.message}`);
}

/**
 * Every `cadence_touches` id this tenant holds, sorted.
 *
 * Read straight through the admin client rather than per-cadence through the
 * repository, because the question it answers is about the touches NOT hanging
 * off a cadence the caller already knows about: a duplicate cadence is only
 * dangerous because of the five touches it brings with it.
 */
async function allTenantTouchIds(): Promise<string[]> {
  const { data, error } = await admin
    .from('cadence_touches')
    .select('id')
    .eq('tenant_id', tenantId);
  if (error) throw new Error(`Reading the tenant's touches failed: ${error.message}`);
  return (data ?? []).map((row) => row.id as string).sort();
}

/** Park the shared cursor at the newest event, i.e. "caught up". */
async function parkCursorAtHead(): Promise<void> {
  const { data, error } = await admin
    .from('quote_status_events')
    .select('id')
    .order('id', { ascending: false })
    .limit(1);
  if (error) throw new Error(`Reading the outbox head failed: ${error.message}`);

  await setCursor((data?.[0]?.id as number | undefined) ?? 0);
}

/**
 * The ServiceM8 status pair each closing event carries.
 *
 * Written out rather than defaulted because `from_status`/`to_status` are the
 * audit trail: a `removed` row saying `Quote → Quote` is the honest record of a
 * deletion, since the status did not change — only `active` did.
 */
const STATUS_PAIR: Readonly<Record<EventType, { from: string; to: string }>> = {
  won: { from: 'Quote', to: 'Work Order' },
  lost: { from: 'Quote', to: 'Unsuccessful' },
  removed: { from: 'Quote', to: 'Quote' },
  reopened: { from: 'Unsuccessful', to: 'Quote' },
};

/** Append one closing event to the outbox and return its id. */
async function emit(eventType: EventType, quoteIndex: number): Promise<number> {
  const before = (await readConsumerCursor(CADENCE_CONSUMER)) ?? 0;
  const pair = STATUS_PAIR[eventType];

  const written = await forTenant(tenantId).events.insertMany([
    {
      quoteId: quotes[quoteIndex].id,
      sm8JobUuid: quotes[quoteIndex].sm8_job_uuid,
      fromStatus: pair.from,
      toStatus: pair.to,
      eventType,
      occurredAt: null,
    },
  ]);
  expect(written).toBe(1);

  const emitted = await forTenant(tenantId).events.since(before);
  const row = emitted.find((e) => e.eventType === eventType && e.quoteId === quotes[quoteIndex].id);
  if (!row) throw new Error(`The ${eventType} event was not written to the outbox.`);
  return row.id;
}

/**
 * The id of the `quote_opened` a quote's cadence was created from.
 *
 * Read back out of the outbox rather than guessed, because it is the value the
 * cadence row now records (`created_by_event_id`) and the thing the rewind tests
 * below have to position the cursor BEHIND.
 */
async function openedEventIdFor(quoteIndex: number, since: number): Promise<number> {
  const emitted = await forTenant(tenantId).events.since(since);
  const row = emitted.find(
    (e) => e.eventType === 'quote_opened' && e.quoteId === quotes[quoteIndex].id,
  );
  if (!row) throw new Error(`No quote_opened was emitted for quote index ${quoteIndex}.`);
  return row.id;
}

/** Flip a quote eligible and consume, returning the cadence that was created. */
async function startCadence(quoteIndex: number): Promise<{ id: string; touchIds: string[] }> {
  const flip = await markChaseEligible(tenantId, [quotes[quoteIndex].id]);
  expect(flip).toEqual({ flipped: 1, eventsEmitted: 1 });

  const result = await consumeQuoteEvents({ jitterMinutes: () => 0 });
  expect(result.cadencesCreated).toBe(1);

  const repo = forTenant(tenantId);
  const [cadence] = await repo.cadences.getByQuoteId(quotes[quoteIndex].id);
  expect(cadence.status).toBe('active');

  const touches = await repo.touches.listForCadence(cadence.id);
  expect(touches).toHaveLength(5);
  expect(touches.every((t) => t.status === 'scheduled')).toBe(true);

  return { id: cadence.id, touchIds: touches.map((t) => t.id) };
}

/**
 * Rewind the cursor behind one event and consume it again, asserting that
 * NOTHING moved.
 *
 * The proof is `updated_at`. A guarded `UPDATE … WHERE status IN
 * ('active','paused')` that matches zero rows cannot touch the column; an
 * unguarded one would rewrite it even when setting identical values. So
 * comparing the timestamps distinguishes "the write was refused" from "the write
 * happened and produced the same result", which a status assertion alone cannot.
 */
async function expectReplayIsANoOp(
  eventId: number,
  cadenceId: string,
  quoteIndex: number,
): Promise<void> {
  const repo = forTenant(tenantId);
  const [before] = await repo.cadences.getByQuoteId(quotes[quoteIndex].id);
  const touchesBefore = await repo.touches.listForCadence(cadenceId);

  await setCursor(eventId - 1);
  const replay = await consumeQuoteEvents({ jitterMinutes: () => 0 });

  // The event IS consumed again — replay is legal, and the cursor moves.
  expect(replay.eventsConsumed).toBeGreaterThanOrEqual(1);
  // And it changed nothing: the guarded UPDATE matched zero rows.
  expect(replay.cadencesStopped).toBe(0);
  expect(replay.cadencesCreated).toBe(0);
  expect(replay.quotesFlaggedForReview).toBe(0);

  const [after] = await repo.cadences.getByQuoteId(quotes[quoteIndex].id);
  expect(after.status).toBe(before.status);
  expect(after.stopReason).toBe(before.stopReason);
  expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());

  const touchesAfter = await repo.touches.listForCadence(cadenceId);
  expect(touchesAfter.map((t) => t.id)).toEqual(touchesBefore.map((t) => t.id));
  expect(touchesAfter.map((t) => t.status)).toEqual(touchesBefore.map((t) => t.status));
  expect(touchesAfter.map((t) => t.skipReason)).toEqual(
    touchesBefore.map((t) => t.skipReason),
  );
  expect(touchesAfter.map((t) => t.updatedAt.getTime())).toEqual(
    touchesBefore.map((t) => t.updatedAt.getTime()),
  );

  expect(await readConsumerCursor(CADENCE_CONSUMER)).toBe(eventId);
}

beforeAll(async () => {
  tenantId = await seedTenant('Cadence Stops');

  // An always-open window, so these assertions are about stopping rather than
  // about what time of day CI runs. The window math is proven exhaustively with
  // pinned instants in tests/cadence-window.test.ts.
  const { error } = await admin
    .from('tenants')
    .update({
      contact_hours_start: '00:00',
      contact_hours_end: '23:59',
      contact_days: [1, 2, 3, 4, 5, 6, 7],
    })
    .eq('id', tenantId);
  if (error) throw new Error(`Widening the contact window failed: ${error.message}`);

  await seedConnection(tenantId);

  // THE ACTIVATION GATE HAS TWO CONDITIONS (ONB-03 05-03, ONB-04 06-04), AND
  // MISSING EITHER ONE MAKES EVERY CADENCE THIS SUITE CREATES BORN
  // `paused(onboarding)`:
  //
  //   ONB-03 — an APPROVED TEMPLATE SET, so there are words to send.
  //   ONB-04 — an `sm8_automation_off` ATTESTATION, so ours is not the second
  //            voice chasing one customer beside ServiceM8's own follow-up.
  //
  // That gate is the correct behaviour and it is asserted in its own block at
  // the foot of this file against its OWN tenant. Every block above it is about
  // stopping, replay and cursor movement — questions that have nothing to do
  // with the gate — so this tenant is given BOTH conditions and those blocks
  // keep asserting `active` for the reason they always did.
  await seedApprovedTemplateSet(tenantId);
  await seedAttestation(tenantId);

  quotes = await seedQuotes(tenantId, [
    { job_description: 'stops: won' },
    { job_description: 'stops: lost' },
    { job_description: 'stops: removed' },
    { job_description: 'stops: reopened' },
    { job_description: 'stops: closed with no cadence' },
    { job_description: 'stops: batch ordering' },
    { job_description: 'replay: created already-stopped, no contact' },
    { job_description: 'replay: worst case, stopped mid-batch by a win' },
    { job_description: 'purge: mirror row deleted, then re-synced under a new uuid' },
  ]);

  // EVERY QUOTE BUT `NO_CONTACT_QUOTE` GETS A CONTACT. That one is seeded
  // deliberately bare so `selectPrimaryContact` returns null and its cadence is
  // created ALREADY STOPPED (`no_contact`, D-04) — the state the partial live
  // index cannot see and which G-3-2 is about.
  await seedQuoteContacts(
    tenantId,
    quotes
      .map((quote, i) => ({
        sm8_job_uuid: quote.sm8_job_uuid,
        first: 'Chase',
        last: `Customer ${i}`,
        mobile: `04005550${String(i).padStart(2, '0')}`,
        contact_type: 'JOB',
      }))
      .filter((_, i) => i !== NO_CONTACT_QUOTE),
  );

  await parkCursorAtHead();
});

afterAll(async () => {
  // `gatedTenantId` is seeded inside the ONB-03 block at the foot of this file,
  // so it is undefined when the suite is filtered down to an earlier test.
  await teardownTenants([tenantId, ...(gatedTenantId ? [gatedTenantId] : [])]);
  await closeDb();
});

/**
 * The headline: a job the tradie just won stops being chased, and every message
 * that was queued for it is retired with a reason.
 *
 * `quote_closed` and not `cadence_stopped`: the quote itself stopped being an
 * open, chase-eligible Quote, and Phase 7 reads this column as evidence of which
 * rule decided each unsent touch.
 */
it('stops a live cadence on `won` and retires its unsent touches as quote_closed', async () => {
  const cadence = await startCadence(0);
  const eventId = await emit('won', 0);

  const result = await consumeQuoteEvents({ jitterMinutes: () => 0 });
  expect(result.eventsConsumed).toBe(1);
  expect(result.cadencesStopped).toBe(1);
  expect(result.cadencesCreated).toBe(0);

  const repo = forTenant(tenantId);
  const [stopped] = await repo.cadences.getByQuoteId(quotes[0].id);
  expect(stopped.status).toBe('stopped');
  expect(stopped.stopReason).toBe('won');
  // A stop CLEARS the pause column: "paused, and also stopped" is a row with two
  // answers to "why is nothing being sent".
  expect(stopped.pauseReason).toBeNull();

  const touches = await repo.touches.listForCadence(cadence.id);
  expect(touches.map((t) => t.status)).toEqual([
    'skipped',
    'skipped',
    'skipped',
    'skipped',
    'skipped',
  ]);
  expect(touches.every((t) => t.skipReason === 'quote_closed')).toBe(true);

  // Consumed exactly once, and the cursor co-committed with the writes above.
  expect(await readConsumerCursor(CADENCE_CONSUMER)).toBe(eventId);

  await expectReplayIsANoOp(eventId, cadence.id, 0);
});

it('stops a live cadence on `lost`, with a reason distinct from `won`', async () => {
  const cadence = await startCadence(1);
  const eventId = await emit('lost', 1);

  const result = await consumeQuoteEvents({ jitterMinutes: () => 0 });
  expect(result.eventsConsumed).toBe(1);
  expect(result.cadencesStopped).toBe(1);

  const repo = forTenant(tenantId);
  const [stopped] = await repo.cadences.getByQuoteId(quotes[1].id);
  expect(stopped.status).toBe('stopped');
  // ONE BUCKET FOR THREE OUTCOMES WOULD DESTROY THE REPORT. Phase 7 computes
  // recovered revenue from this column, so a lost job must never be recorded
  // with the same reason as a won one.
  expect(stopped.stopReason).toBe('lost');

  const touches = await repo.touches.listForCadence(cadence.id);
  expect(touches.every((t) => t.status === 'skipped')).toBe(true);
  expect(touches.every((t) => t.skipReason === 'quote_closed')).toBe(true);

  expect(await readConsumerCursor(CADENCE_CONSUMER)).toBe(eventId);

  await expectReplayIsANoOp(eventId, cadence.id, 1);
});

/**
 * D-08 — the job no longer exists upstream.
 *
 * The skip reason is `cadence_stopped`, not `quote_closed`: the quote row still
 * says `status = 'Quote'` (only `sm8_active` flipped), so claiming the quote
 * closed would put a statement in Phase 7's evidence that the data does not
 * support. The operative fact for these touches is that their cadence stopped.
 */
it('stops a live cadence on `removed`, skipping touches as cadence_stopped', async () => {
  const cadence = await startCadence(2);
  const eventId = await emit('removed', 2);

  const result = await consumeQuoteEvents({ jitterMinutes: () => 0 });
  expect(result.eventsConsumed).toBe(1);
  expect(result.cadencesStopped).toBe(1);

  const repo = forTenant(tenantId);
  const [stopped] = await repo.cadences.getByQuoteId(quotes[2].id);
  expect(stopped.status).toBe('stopped');
  expect(stopped.stopReason).toBe('removed');

  const touches = await repo.touches.listForCadence(cadence.id);
  expect(touches.every((t) => t.status === 'skipped')).toBe(true);
  expect(touches.every((t) => t.skipReason === 'cadence_stopped')).toBe(true);

  expect(await readConsumerCursor(CADENCE_CONSUMER)).toBe(eventId);

  await expectReplayIsANoOp(eventId, cadence.id, 2);
});

/**
 * D-08's real subtlety: A REOPEN IS NOT A RESTART.
 *
 * The tradie went back into ServiceM8 and put the job back to Quote, which in
 * practice means they are actively renegotiating it — a new price, a changed
 * scope, a conversation the service knows nothing about. Automatically resuming
 * the chase there is the single most embarrassing thing this product could do.
 *
 * So the cadence stops AND the quote returns to the operator's triage queue, in
 * one transaction. Only a human ticking it again emits a fresh `quote_opened`,
 * and that starts a NEW cadence from a NEW anchor — the sequential-cadence
 * history the partial unique index on `cadences` deliberately permits.
 */
it('stops on `reopened` and returns the quote to operator triage in the same pass', async () => {
  const cadence = await startCadence(3);

  const { data: beforeRow } = await admin
    .from('quotes')
    .select('chase_eligibility')
    .eq('id', quotes[3].id)
    .single();
  expect((beforeRow as { chase_eligibility: string }).chase_eligibility).toBe('eligible');

  const eventId = await emit('reopened', 3);

  const result = await consumeQuoteEvents({ jitterMinutes: () => 0 });
  expect(result.eventsConsumed).toBe(1);
  expect(result.cadencesStopped).toBe(1);
  expect(result.quotesFlaggedForReview).toBe(1);

  const repo = forTenant(tenantId);
  const [stopped] = await repo.cadences.getByQuoteId(quotes[3].id);
  expect(stopped.status).toBe('stopped');
  expect(stopped.stopReason).toBe('reopened');

  const touches = await repo.touches.listForCadence(cadence.id);
  expect(touches.every((t) => t.status === 'skipped')).toBe(true);
  expect(touches.every((t) => t.skipReason === 'cadence_stopped')).toBe(true);

  // BOTH HALVES COMMITTED TOGETHER. A stopped cadence whose quote still reads
  // `eligible` is a quote nobody is chasing and nobody is being asked about.
  const { data: afterRow } = await admin
    .from('quotes')
    .select('chase_eligibility')
    .eq('id', quotes[3].id)
    .single();
  expect((afterRow as { chase_eligibility: string }).chase_eligibility).toBe('needs_review');

  expect(await readConsumerCursor(CADENCE_CONSUMER)).toBe(eventId);

  await expectReplayIsANoOp(eventId, cadence.id, 3);
});

/**
 * The other half of D-08: re-triage produces a SECOND cadence, and exactly one
 * of the two is live.
 *
 * This is what the partial unique index is partial FOR. A full unique index on
 * `quote_id` would forbid this legal history along with the illegal concurrency
 * it exists to prevent.
 *
 * IT IS ALSO THE GUARD AGAINST OVER-WIDENING THE G-3-2 FIX. `created_by_event_id`
 * dedupes on the EVENT, not on the quote: re-triage emits a FRESH `quote_opened`
 * with a new bigserial id, so this insert conflicts with neither index and the
 * second cadence is created. Had the fix been a blanket unique on `quote_id`, the
 * `toHaveLength(2)` below would fail — which is the point of asserting it.
 */
it('starts a fresh, second cadence when the operator re-triages a reopened quote', async () => {
  const flip = await markChaseEligible(tenantId, [quotes[3].id]);
  expect(flip).toEqual({ flipped: 1, eventsEmitted: 1 });

  const result = await consumeQuoteEvents({ jitterMinutes: () => 0 });
  expect(result.eventsConsumed).toBe(1);
  expect(result.cadencesCreated).toBe(1);

  const repo = forTenant(tenantId);
  const all = await repo.cadences.getByQuoteId(quotes[3].id);
  expect(all).toHaveLength(2);
  // DIFFERENT EVENTS, which is exactly why both rows are allowed to exist.
  expect(new Set(all.map((c) => c.createdByEventId)).size).toBe(2);

  const live = all.filter((c) => c.status === 'active' || c.status === 'paused');
  expect(live).toHaveLength(1);
  expect(live[0].stopReason).toBeNull();
  // A NEW ANCHOR, not the old one: D-01 measures from the moment we noticed this
  // quote became chaseable, and it became chaseable again just now.
  const stopped = all.find((c) => c.status === 'stopped')!;
  expect(live[0].anchorAt.getTime()).toBeGreaterThan(stopped.anchorAt.getTime());

  const touches = await repo.touches.listForCadence(live[0].id);
  expect(touches.map((t) => t.touchNumber)).toEqual([1, 2, 3, 4, 5]);
});

/**
 * A closing event for a quote that never had a cadence is CONSUMED, not stuck.
 *
 * It happens routinely: a job won before the client ever connected, a quote the
 * operator never ticked eligible, a cadence that already stopped for another
 * reason. Refusing to advance past these would wedge the single shared cursor on
 * an event that has nothing to do.
 */
it('consumes a closing event for a quote with no cadence, changing nothing', async () => {
  const eventId = await emit('won', 4);

  const result = await consumeQuoteEvents({ jitterMinutes: () => 0 });
  expect(result.eventsConsumed).toBe(1);
  expect(result.cadencesStopped).toBe(0);
  expect(result.cadencesCreated).toBe(0);

  expect(await forTenant(tenantId).cadences.getByQuoteId(quotes[4].id)).toEqual([]);
  expect(await readConsumerCursor(CADENCE_CONSUMER)).toBe(eventId);
});

/**
 * THE GUARD REMOVAL, ASSERTED FROM THE OUTSIDE.
 *
 * The tracer (03-02) consumed only the longest PREFIX of the batch it could act
 * on, stopping at the first event of an unhandled type. This batch is therefore
 * deliberately ordered with a `lost` FIRST and a `quote_opened` behind it: under
 * that guard the pass would have consumed ZERO events and the cursor would not
 * have moved at all. Both are consumed here, in one pass, in one transaction.
 */
it('walks the whole batch, whatever the event type of its first row', async () => {
  const closing = await emit('lost', 4);

  const flip = await markChaseEligible(tenantId, [quotes[5].id]);
  expect(flip).toEqual({ flipped: 1, eventsEmitted: 1 });

  const result = await consumeQuoteEvents({ jitterMinutes: () => 0 });

  expect(result.eventsConsumed).toBe(2);
  expect(result.cadencesCreated).toBe(1);
  expect(result.cadencesStopped).toBe(0);

  const repo = forTenant(tenantId);
  const [created] = await repo.cadences.getByQuoteId(quotes[5].id);
  expect(created.status).toBe('active');

  // Past BOTH events, not parked on the first one.
  expect(await readConsumerCursor(CADENCE_CONSUMER)).toBeGreaterThan(closing);
});

/**
 * G-3-2, CASE ONE: THE CADENCE THAT WAS BORN STOPPED.
 *
 * Every replay assertion above rewinds behind a CLOSING event, so all of them
 * exercise the guarded `UPDATE`. None of them rewinds behind a `quote_opened`
 * whose cadence is no longer live — and that is the case the shared cursor
 * actually produces: when any tenant's run blocks, the held position means every
 * later tick re-reads this same `quote_opened`.
 *
 * `cadences_one_live_per_quote` is partial on `status IN ('active','paused')`,
 * so against a cadence created already-stopped `no_contact` it covers NO row and
 * refuses NOTHING. Before `created_by_event_id` this replay inserted a SECOND
 * stopped cadence and counted `cadencesStopped: 1` — every tick, for as long as
 * the unrelated tenant stayed broken — polluting the table Phase 7 attributes
 * revenue from.
 */
it('refuses to re-create a cadence that was created already-stopped (G-3-2)', async () => {
  const repo = forTenant(tenantId);
  const before = (await readConsumerCursor(CADENCE_CONSUMER)) ?? 0;

  const flip = await markChaseEligible(tenantId, [quotes[NO_CONTACT_QUOTE].id]);
  expect(flip).toEqual({ flipped: 1, eventsEmitted: 1 });

  const first = await consumeQuoteEvents({ jitterMinutes: () => 0 });
  expect(first.eventsConsumed).toBe(1);
  // D-04's honest null: created, then stopped, in one transaction — so the
  // event is consumed exactly once and the operator can see the decision.
  expect(first.cadencesCreated).toBe(0);
  expect(first.cadencesStopped).toBe(1);

  const [created] = await repo.cadences.getByQuoteId(quotes[NO_CONTACT_QUOTE].id);
  expect(created.status).toBe('stopped');
  expect(created.stopReason).toBe('no_contact');
  expect(await repo.touches.listForCadence(created.id)).toEqual([]);

  const openedId = await openedEventIdFor(NO_CONTACT_QUOTE, before);
  expect(created.createdByEventId).toBe(openedId);

  // The hold, reproduced: the cursor sits behind the event again.
  await setCursor(openedId - 1);
  const replay = await consumeQuoteEvents({ jitterMinutes: () => 0 });

  expect(replay.eventsConsumed).toBeGreaterThanOrEqual(1);
  expect(replay.cadencesCreated).toBe(0);
  // PRE-FIX THIS WAS 1: a second stopped cadence, created and stopped again.
  expect(replay.cadencesStopped).toBe(0);

  const all = await repo.cadences.getByQuoteId(quotes[NO_CONTACT_QUOTE].id);
  // The claim is CONDITIONAL, and the condition is the point (WR-03): the
  // guarantee holds for an event whose id was RECORDED, which is what happened
  // here because this event created the cadence. An event refused by a LIVE
  // index instead has its id written nowhere — see the WR-03 section in
  // src/db/schema/cadences.ts and the tripwire in cadence-repository.test.ts.
  expect(
    all,
    'one consumed quote_opened may only ever produce one cadence, once its id has been recorded',
  ).toHaveLength(1);
  expect(all[0].id).toBe(created.id);
  expect(all[0].updatedAt.getTime()).toBe(created.updatedAt.getTime());

  expect(await readConsumerCursor(CADENCE_CONSUMER)).toBe(openedId);
});

/**
 * G-3-2, CASE TWO: THE WORST CASE — A DUPLICATE THAT RE-CHASES.
 *
 * Same hold, but the first cadence was ALIVE and was stopped by a `won`
 * consumed in the same batch. Rewinding behind the `quote_opened` replays BOTH
 * events: the `won` is a no-op against an already-stopped cadence, and the
 * `quote_opened` then found nothing live to conflict with.
 *
 * Pre-fix, that produced a brand-new ACTIVE cadence with five freshly scheduled
 * touches for a job the tradie had already won — the single worst message this
 * product can send, arriving on the next dispatch pass. The assertions below are
 * therefore about ABSENCE: one cadence, still stopped, byte-identical
 * `updated_at`, and not one touch back in `scheduled`.
 */
it('refuses to re-create a cadence whose quote was already won mid-batch (G-3-2)', async () => {
  const repo = forTenant(tenantId);
  const before = (await readConsumerCursor(CADENCE_CONSUMER)) ?? 0;

  const cadence = await startCadence(RE_CHASE_QUOTE);
  const openedId = await openedEventIdFor(RE_CHASE_QUOTE, before);

  const wonId = await emit('won', RE_CHASE_QUOTE);
  const stop = await consumeQuoteEvents({ jitterMinutes: () => 0 });
  expect(stop.cadencesStopped).toBe(1);
  expect(await readConsumerCursor(CADENCE_CONSUMER)).toBe(wonId);

  const [stopped] = await repo.cadences.getByQuoteId(quotes[RE_CHASE_QUOTE].id);
  expect(stopped.status).toBe('stopped');
  expect(stopped.stopReason).toBe('won');
  const touchesBefore = await repo.touches.listForCadence(cadence.id);
  // Every touch this TENANT holds, including the ones earlier tests in this file
  // created for other quotes. Captured so the replay can be checked for a touch
  // appearing ANYWHERE, not merely on the cadence already pinned below.
  const tenantTouchesBefore = await allTenantTouchIds();

  // Rewind behind the OPENED event, so the whole story replays.
  await setCursor(openedId - 1);
  const replay = await consumeQuoteEvents({ jitterMinutes: () => 0 });

  expect(replay.eventsConsumed).toBeGreaterThanOrEqual(2);
  // PRE-FIX THIS WAS 1: a second, ACTIVE cadence chasing from touch 1.
  expect(replay.cadencesCreated).toBe(0);
  expect(replay.cadencesStopped).toBe(0);

  const all = await repo.cadences.getByQuoteId(quotes[RE_CHASE_QUOTE].id);
  expect(all, 'a replayed quote_opened must not resurrect a won job').toHaveLength(1);
  expect(all[0].id).toBe(cadence.id);
  expect(all[0].status).toBe('stopped');
  expect(all[0].stopReason).toBe('won');
  expect(all[0].updatedAt.getTime()).toBe(stopped.updatedAt.getTime());

  const touchesAfter = await repo.touches.listForCadence(cadence.id);
  expect(touchesAfter.map((t) => t.id)).toEqual(touchesBefore.map((t) => t.id));
  expect(touchesAfter.some((t) => t.status === 'scheduled')).toBe(false);

  // AND NO TOUCHES ANYWHERE ELSE EITHER: a duplicate cadence would carry its own
  // five, and they are what would actually reach the customer.
  //
  // Asserted over the TENANT and across the replay, not over the cadence already
  // pinned above. The previous form re-read `listForCadence(all[0].id)` — the
  // same cadence `touchesAfter` had just been read from and compared id-by-id —
  // so it could not fail independently of the lines above it and tested nothing
  // about "anywhere else". This is the worst-case test in the G-3-2 pair (a
  // duplicate ACTIVE cadence re-chasing a job the tradie has already won), so a
  // decorative assertion here was false confidence at exactly the point it
  // matters most.
  //
  // A tenant-wide COUNT would be wrong too: this file's tests share one tenant
  // and run in order, so earlier quotes already hold touches. The honest
  // question is whether the replay ADDED one anywhere, which is a before/after
  // comparison of the whole set.
  expect(
    await allTenantTouchIds(),
    'a touch appearing anywhere in the tenant means a duplicate cadence was created and will send',
  ).toEqual(tenantTouchesBefore);

  expect(await readConsumerCursor(CADENCE_CONSUMER)).toBe(wonId);
});

/**
 * WR-02 — A PURGED MIRROR ROW MUST NOT BUY A SECOND LIVE CADENCE.
 *
 * `cadences_one_live_per_quote` is keyed on `quote_id`, OUR surrogate uuid.
 * Migration 0022 blessed "the quotes row is gone while its cadence survives" as
 * a reachable state, and that is what made the choice of key matter: a re-sync
 * after a purge writes a NEW `quotes` row with a NEW uuid, so `run-sync.ts` sees
 * `prev === undefined`, does NOT suppress the `quote_opened`, and the resulting
 * insert conflicts with neither index — different `quote_id`, different
 * `created_by_event_id`.
 *
 * Pre-fix that produced two live cadences for ONE ServiceM8 job: two parallel
 * chase sequences, both from touch 1, to the same customer. This test reaches
 * the state through the purge the migration text names (an ops-side delete)
 * rather than through a code path, which is why the fix is an index —
 * `cadences_one_live_per_job` (migration 0024), keyed on the upstream identity
 * that survives a mirror rebuild.
 *
 * The assertions are deliberately made about the JOB, not about either quote
 * row: the whole failure is that a job's two quote rows looked like two
 * different things to the database.
 */
it('refuses a second live cadence when a purged quote row is re-synced (WR-02)', async () => {
  const repo = forTenant(tenantId);
  const job = quotes[PURGED_QUOTE].sm8_job_uuid;

  const cadence = await startCadence(PURGED_QUOTE);

  // THE PURGE. Deleting the mirrored row directly is the ops-side action the
  // 0022 migration text names as a cause; there is no FK from `cadences`, so the
  // cadence survives it (that absence is deliberate — Phase 7 attribution must
  // outlive a client disconnect).
  const { error } = await admin.from('quotes').delete().eq('id', quotes[PURGED_QUOTE].id);
  if (error) throw new Error(`Purging the mirrored quote failed: ${error.message}`);

  // THE RE-SYNC. A new row for the SAME ServiceM8 job, with a new surrogate uuid
  // — which is exactly what `run-sync.ts` writes when it meets a job it has no
  // mirror row for.
  const [resynced] = await seedQuotes(tenantId, [
    { job_description: 'purge: re-synced', sm8_job_uuid: job },
  ]);
  expect(resynced.id).not.toBe(quotes[PURGED_QUOTE].id);

  const flip = await markChaseEligible(tenantId, [resynced.id]);
  expect(flip, 'the re-synced row is a fresh quote to triage, so it emits').toEqual({
    flipped: 1,
    eventsEmitted: 1,
  });

  const replay = await consumeQuoteEvents({ jitterMinutes: () => 0 });
  expect(replay.eventsConsumed).toBeGreaterThanOrEqual(1);
  // PRE-FIX THIS WAS 1: a second ACTIVE cadence chasing the same job from touch 1.
  expect(
    replay.cadencesCreated,
    'a live cadence already exists for this job — the second create must refuse',
  ).toBe(0);
  expect(replay.cadencesStopped).toBe(0);

  // No cadence for the new quote row at all, and the original is untouched.
  expect(await repo.cadences.getByQuoteId(resynced.id)).toEqual([]);

  const { data: forJob, error: readError } = await admin
    .from('cadences')
    .select('id, status')
    .eq('tenant_id', tenantId)
    .eq('sm8_job_uuid', job);
  if (readError) throw new Error(`Reading cadences for the job failed: ${readError.message}`);

  expect(
    (forJob ?? []).filter((row) => row.status === 'active' || row.status === 'paused'),
    'one ServiceM8 job may have at most one live cadence, whatever our mirror did',
  ).toHaveLength(1);
  expect((forJob ?? [])[0].id).toBe(cadence.id);

  // And the customer is not queued twice: still one schedule, the original.
  expect(await repo.touches.listForCadence(cadence.id)).toHaveLength(5);
});

/**
 * Every member of `QUOTE_EVENT_TYPES` moves the cursor — the property the
 * removed guard was suppressing, stated directly.
 */
it('advances the cursor through all five outbox event types', async () => {
  const repo = forTenant(tenantId);
  const seen = new Set<string>();

  for (const event of await repo.events.since(0)) {
    seen.add(event.eventType);
  }

  expect([...seen].sort()).toEqual(['lost', 'quote_opened', 'removed', 'reopened', 'won']);

  // Nothing is left behind the cursor: a further pass has no work at all.
  const quiet = await consumeQuoteEvents({ jitterMinutes: () => 0 });
  expect(quiet.eventsConsumed).toBe(0);
  expect(quiet.cadencesCreated).toBe(0);
  expect(quiet.cadencesStopped).toBe(0);
  expect(quiet.quotesFlaggedForReview).toBe(0);
});

/* ------------------------------------------------------------------------- *
 * ONB-03 / D-07 — THE BORN-PAUSED CREATION PATH (05-03)
 *
 * Its own tenant, deliberately. Every block above asserts `active` because the
 * suite tenant satisfies BOTH gate conditions (an approved template set and an
 * `sm8_automation_off` attestation, ONB-04/06-04); the gate is about a tenant
 * who satisfies neither, and sharing one tenant would mean flipping that fact
 * mid-file — which is exactly the shape that makes an ordered suite unreadable.
 * ------------------------------------------------------------------------- */

let gatedTenantId: string;
let gatedQuotes: Array<{ id: string; sm8_job_uuid: string }>;
let gatedOpenedEventId: number;
let bornPausedCadenceId: string;

/** The quote whose contact is on `suppressed_contacts` before it is ever opened. */
const SUPPRESSED_QUOTE = 2;

it('BORN PAUSED: a tenant with no approved templates gets a paused cadence with a full schedule', async () => {
  gatedTenantId = await seedTenant('Onboarding Gate Consume');

  // Same always-open window as the suite tenant, for the same reason: these
  // assertions are about the gate, not about what time of day CI runs.
  const { error } = await admin
    .from('tenants')
    .update({
      contact_hours_start: '00:00',
      contact_hours_end: '23:59',
      contact_days: [1, 2, 3, 4, 5, 6, 7],
    })
    .eq('id', gatedTenantId);
  if (error) throw new Error(`Widening the gated tenant's window failed: ${error.message}`);

  await seedConnection(gatedTenantId);
  // NO `seedApprovedTemplateSet` HERE. That absence is the subject.

  gatedQuotes = await seedQuotes(gatedTenantId, [
    { job_description: 'onboarding: born paused' },
    { job_description: 'onboarding: opened after approval' },
    { job_description: 'onboarding: suppressed contact, gate irrelevant' },
  ]);
  await seedQuoteContacts(
    gatedTenantId,
    gatedQuotes.map((quote, i) => ({
      sm8_job_uuid: quote.sm8_job_uuid,
      first: 'Gated',
      last: `Customer ${i}`,
      mobile: `04005560${String(i).padStart(2, '0')}`,
      contact_type: 'JOB',
    })),
  );

  // D-15, seeded BEFORE the quote is ever opened. Normalized through the
  // production function rather than typed out: suppression matches the exact
  // stored string, so a hand-written `+61…` here would be a second answer to a
  // question `normalizeAuMobile` already answers.
  const suppressedMobile = normalizeAuMobile(
    `04005560${String(SUPPRESSED_QUOTE).padStart(2, '0')}`,
  );
  if (!suppressedMobile) throw new Error('the fixture mobile did not normalize');
  await seedSuppression(gatedTenantId, [{ channel: 'sms', address: suppressedMobile }]);

  const before = (await readConsumerCursor(CADENCE_CONSUMER)) ?? 0;
  const gatedRepo = forTenant(gatedTenantId);

  expect(await hasApprovedTemplateSet(gatedRepo)).toBe(false);

  expect(await markChaseEligible(gatedTenantId, [gatedQuotes[0].id])).toEqual({
    flipped: 1,
    eventsEmitted: 1,
  });

  const consumed = await consumeQuoteEvents({ jitterMinutes: () => 0 });
  // COUNTED AS CREATED, NOT STOPPED. A born-paused cadence is waiting, not
  // declined — reporting it as stopped would tell an operator reading the tick
  // counts that four quotes were turned away during onboarding.
  expect(consumed.cadencesCreated).toBe(1);
  expect(consumed.cadencesStopped).toBe(0);

  const [cadence] = await gatedRepo.cadences.getByQuoteId(gatedQuotes[0].id);
  bornPausedCadenceId = cadence.id;
  expect({ status: cadence.status, pauseReason: cadence.pauseReason }).toEqual({
    status: 'paused',
    pauseReason: ONBOARDING_PAUSE_REASON,
  });

  // ── THE SCHEDULE IS MATERIALIZED, WHICH IS HALF THE POINT OF D-07 ────────
  //
  // A pause with no touches would tell an operator that something is waiting.
  // A pause with five scheduled touches tells them WHAT is waiting and WHEN it
  // will go out once the words exist.
  const touches = await gatedRepo.touches.listForCadence(cadence.id);
  expect(touches).toHaveLength(5);
  expect(touches.every((touch) => touch.status === 'scheduled')).toBe(true);

  // ── THE PAUSE COMMITTED IN THE SAME TRANSACTION AS THE CREATE ────────────
  //
  // Postgres `now()` is `transaction_timestamp()`, not the wall clock: it is
  // FIXED for the whole transaction. `created_at` defaults to `now()` and
  // `pauseWhereActive` sets `updated_at` to `now()`, so the two columns are
  // equal if and only if the pause ran inside the transaction that created the
  // row. A pause committed separately — the shape that leaves a window where an
  // unapproved cadence is active and one tick from `promoteDue` — would leave
  // `updated_at` strictly later, and this assertion is what forbids it.
  expect(
    cadence.updatedAt.getTime(),
    'the onboarding pause did not commit in the same transaction as the create',
  ).toBe(cadence.createdAt.getTime());

  gatedOpenedEventId = (await gatedRepo.events.since(before)).find(
    (row) => row.eventType === 'quote_opened' && row.quoteId === gatedQuotes[0].id,
  )!.id;
  expect(cadence.createdByEventId).toBe(gatedOpenedEventId);
});

it('SUPPRESSION DOMINATES THE GATE: a suppressed contact is stopped, not onboarding-paused', async () => {
  // The precedence, pinned. "This human asked us never to contact them" is
  // terminal; "this client has no words yet" is a waiting room. Recording the
  // reversible one would park a permanently-off cadence on the queue that the
  // next template approval empties — and that approval would then resume it.
  expect(await markChaseEligible(gatedTenantId, [gatedQuotes[SUPPRESSED_QUOTE].id])).toEqual({
    flipped: 1,
    eventsEmitted: 1,
  });

  const consumed = await consumeQuoteEvents({ jitterMinutes: () => 0 });
  expect(consumed.cadencesCreated).toBe(0);
  expect(consumed.cadencesStopped).toBe(1);

  const gatedRepo = forTenant(gatedTenantId);
  const [cadence] = await gatedRepo.cadences.getByQuoteId(gatedQuotes[SUPPRESSED_QUOTE].id);
  expect(cadence.status).toBe('stopped');
  expect(cadence.stopReason).toBe('contact_suppressed');
  expect(cadence.pauseReason).toBeNull();
  expect(await gatedRepo.touches.listForCadence(cadence.id)).toHaveLength(0);
});

it('replay of the consumed quote_opened stays a no-op against a born-paused cadence (G-3-2)', async () => {
  // The G-3-2 contract must survive the new shape. `cadences_one_live_per_quote`
  // is partial on `status IN ('active','paused')`, so a PAUSED cadence is
  // covered by it — but `cadences_one_per_opened_event` is the guarantee being
  // asserted, and it is the one that holds after the cadence later stops.
  const gatedRepo = forTenant(gatedTenantId);
  const [before] = await gatedRepo.cadences.getById(bornPausedCadenceId);

  await setCursor(gatedOpenedEventId - 1);
  const replay = await consumeQuoteEvents({ jitterMinutes: () => 0 });
  expect(replay.cadencesCreated).toBe(0);
  expect(replay.cadencesStopped).toBe(0);

  const all = await gatedRepo.cadences.getByQuoteId(gatedQuotes[0].id);
  expect(all).toHaveLength(1);
  expect(all[0].id).toBe(bornPausedCadenceId);
  // Byte-identical: not re-paused, not re-materialized, not touched at all.
  expect(all[0].updatedAt.getTime()).toBe(before.updatedAt.getTime());
  expect(all[0].pauseReason).toBe(ONBOARDING_PAUSE_REASON);
  expect(await gatedRepo.touches.listForCadence(bornPausedCadenceId)).toHaveLength(5);
});

it('UNCHANGED BEHAVIOUR once the set is approved: the next quote opens ACTIVE', async () => {
  // The other half of the gate, in the same tenant, so the difference is the
  // two gate conditions being satisfied — the approved template set (ONB-03)
  // AND the `sm8_automation_off` attestation (ONB-04) — and nothing else about
  // the fixture.
  await seedApprovedTemplateSet(gatedTenantId);
  await seedAttestation(gatedTenantId);
  const gatedRepo = forTenant(gatedTenantId);
  expect(await hasApprovedTemplateSet(gatedRepo)).toBe(true);

  expect(await markChaseEligible(gatedTenantId, [gatedQuotes[1].id])).toEqual({
    flipped: 1,
    eventsEmitted: 1,
  });

  const consumed = await consumeQuoteEvents({ jitterMinutes: () => 0 });
  expect(consumed.cadencesCreated).toBe(1);

  const [cadence] = await gatedRepo.cadences.getByQuoteId(gatedQuotes[1].id);
  expect({ status: cadence.status, pauseReason: cadence.pauseReason }).toEqual({
    status: 'active',
    pauseReason: null,
  });
  expect(await gatedRepo.touches.listForCadence(cadence.id)).toHaveLength(5);

  // AND THE EARLIER CADENCE IS STILL PAUSED. Consumption does not retroactively
  // open the gate for cadences already born behind it — that is
  // `approveTemplateVersion`'s job, and it did not run here.
  const [stillGated] = await gatedRepo.cadences.getById(bornPausedCadenceId);
  expect(stillGated.pauseReason).toBe(ONBOARDING_PAUSE_REASON);
});
