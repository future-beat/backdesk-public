/**
 * THE RPT-01 TRACER: a real `won` event on the hosted database becomes EXACTLY
 * ONE attribution row with a self-describing evidence chain — and nothing else.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHAT THIS SUITE IS ACTUALLY PROTECTING. `quote_attributions` is the      │
 * │ table a client is BILLED from, and `forTenant().attributions` exposes no │
 * │ update method and no delete method — by design, and neither may ever be  │
 * │ added. So every row this consumer writes is permanent. A duplicate is a  │
 * │ job billed twice; a missing one is revenue the service recovered and     │
 * │ cannot prove; a row written from a test tick is a real client invoiced   │
 * │ for history nobody chased.                                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Six behaviours, each of which would compile and pass a type check while being
 * wrong:
 *
 *   * ONE ROW PER QUALIFYING WIN, with the frozen gross and conservative
 *     figures, the baseline it was computed under, and the chain.
 *   * REPLAY IS A ZERO-ROW NO-OP. The cursor is rewound by hand — which no
 *     production path can do and every crash-and-restart effectively does — and
 *     the stored row must be byte-for-byte the one that was already there.
 *   * A SECOND WIN (reopen → won again) IS ALSO A NO-OP, decided by
 *     `quote_attributions_one_per_quote` rather than by a read the consumer
 *     performed a moment earlier.
 *   * AN UNQUALIFIED WIN WRITES NOTHING AND STILL ADVANCES. Most wins are jobs
 *     the tradie closed himself; a consumer that credited them produces a
 *     report the client disproves from their own books.
 *   * A VANISHED QUOTE MIRROR RECORDS `value_source = 'missing'` and never
 *     holds the cursor (RESEARCH Pitfall 8). The touches happened; the dollar
 *     figure is unknown; inventing one is the only unacceptable answer.
 *   * THE TICK SEAM. `runCadenceTick` with no `attribution` option must not
 *     register, scan or advance ANYTHING — the property that keeps every other
 *     remote suite in this repository from draining fifteen real clients' won
 *     history into a production table.
 *
 * ── THE CURSOR IS GLOBAL, AND THIS SUITE PARKS IT BEFORE IT SEEDS ANYTHING ──
 *
 * `event_consumer_cursors` holds ONE row per consumer across every client. A
 * suite that rewound the `'attribution'` cursor to 0 — or that simply let a
 * brand-new consumer register at 0 — would replay every real client's `won`
 * history into `quote_attributions` (RESEARCH Pitfall 11). So `beforeAll` parks
 * the attribution cursor at the outbox head BEFORE the first seed, and every
 * rewind below goes to one of THIS suite's own event ids, never to zero.
 *
 * And the cadence engine's cursor is asserted UNTOUCHED: two consumers, two
 * positions, and the attribution pass reading or moving the other one would
 * make a wedged cadence engine silently stop the billing.
 *
 * ── ORDERED, AND THAT IS LOAD-BEARING ───────────────────────────────────────
 *
 * These `it` blocks share one tenant and one cursor and run in file order.
 * `vitest.config.mts` disables file parallelism and vitest runs a file's tests
 * sequentially, so each test may assume the cursor is where the previous one
 * left it.
 *
 * REMOTE. It seeds and tears down against the hosted Sydney project, so it runs
 * only under `npm run test:remote`.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { consumeWonEvents } from '../src/core/attribution/consume-wins';
import { ATTRIBUTION_CONSUMER, CADENCE_CONSUMER } from '../src/core/cadence/constants';
import { runCadenceTick } from '../src/core/cadence/run-tick';
import { closeDb, forTenant, readConsumerCursor } from '../src/db/repository';

import {
  admin,
  seedCadence,
  seedConnection,
  seedInbound,
  seedLedgerRow,
  seedQuotes,
  seedTenant,
  teardownTenants,
} from './helpers/seed';

const DAY_MS = 86_400_000;

/** The two source files whose SELECT LISTS are the privacy boundary (T-7-15). */
const FOR_TENANT_SOURCE = 'src/db/repository/for-tenant.ts';
const ESCALATIONS_SOURCE = 'src/db/repository/escalations.ts';
/** The consumer itself, read as text for the two-cursors gate. */
const CONSUMER_SOURCE = 'src/core/attribution/consume-wins.ts';

let tenantId: string;
let quotes: Array<{ id: string; sm8_job_uuid: string }>;
/** Where the CADENCE engine's cursor stood before this suite ran. */
let cadenceCursorBefore: number | null;
/**
 * Where the ATTRIBUTION cursor stood before this suite ran — `null` meaning the
 * consumer had NEVER RUN against this database, which is a different fact from
 * "it is at 0". See the `afterAll` restore.
 */
let attributionCursorBefore: number | null;

/** The first `won`, its id and the moment the database says we detected it. */
let wonId1: number;
let detectedAt1: Date;
/** The second `won` for the SAME quote, after a `reopened`. */
let wonId2: number;
/** The `won` for the quote whose only touches are a stub and an undelivered. */
let wonId3: number;
/** The `won` for a quote id that has no mirror row at all. */
let wonId4: number;
let orphanQuoteId: string;
/** The `won` reserved for the tick-seam case. */
let wonId5: number;

const CONTACT_NAME = 'Marlee Kowalczyk-Rios';
const JOB_DESCRIPTION = 'Bathroom reno, Scarborough — regrout and new vanity';

/**
 * Move the ATTRIBUTION cursor by hand — including BACKWARDS, which no
 * production path can. Never to 0: see the header.
 */
async function setCursor(lastEventId: number): Promise<void> {
  const { error } = await admin
    .from('event_consumer_cursors')
    .upsert(
      { consumer: ATTRIBUTION_CONSUMER, last_event_id: lastEventId },
      { onConflict: 'consumer' },
    );
  if (error) throw new Error(`Setting the attribution cursor failed: ${error.message}`);
}

/** Park the shared attribution cursor at the newest event, i.e. "caught up". */
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
 * Append one closing event to the outbox and return its id AND the
 * `detected_at` the DATABASE assigned it.
 *
 * `detected_at` is deliberately not settable through the repository — "a
 * caller-supplied `detectedAt` would let a clock skew reorder the record of
 * when we noticed" — so this suite reads back what was committed and anchors
 * every seeded touch to THAT instant. The window is therefore measured against
 * the same value production measures it against, rather than against a fixture
 * the test invented.
 */
async function emitWon(
  quoteId: string,
  sm8JobUuid: string,
): Promise<{ id: number; detectedAt: Date }> {
  const before = (await readConsumerCursor(ATTRIBUTION_CONSUMER)) ?? 0;

  const written = await forTenant(tenantId).events.insertMany([
    {
      quoteId,
      sm8JobUuid,
      fromStatus: 'Quote',
      toStatus: 'Work Order',
      eventType: 'won',
      occurredAt: null,
    },
  ]);
  expect(written).toBe(1);

  const emitted = await forTenant(tenantId).events.since(before);
  const row = emitted.find((e) => e.eventType === 'won' && e.quoteId === quoteId);
  if (!row) throw new Error(`The won event for quote ${quoteId} was not written.`);
  return { id: row.id, detectedAt: row.detectedAt };
}

/** The one attribution row for a quote, or `null`. Read through the admin client. */
async function attributionFor(quoteId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await admin
    .from('quote_attributions')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('quote_id', quoteId);
  if (error) throw new Error(`Reading the attribution failed: ${error.message}`);

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  expect(rows.length, `quote ${quoteId} must have at most one attribution`).toBeLessThan(2);
  return rows[0] ?? null;
}

beforeAll(async () => {
  // ── FIRST, BEFORE ANY SEED. RESEARCH Pitfall 11. ──────────────────────────
  //
  // The attribution consumer has never run against this database, so its cursor
  // row may not exist — and `registerConsumerCursor` would create it AT ZERO and
  // walk every `won` event fifteen real clients have ever produced into
  // `quote_attributions`, a table nothing in this codebase can delete a row
  // from. Parking at the head first is what makes this suite act only on events
  // it wrote itself.
  //
  // READ IT BEFORE PARKING IT, because `null` ("never run") and 0 ("registered,
  // at the start of history") are different facts and `afterAll` has to restore
  // whichever one was true. See the restore for why leaving a parked cursor
  // behind would be a production change made by a test.
  attributionCursorBefore = await readConsumerCursor(ATTRIBUTION_CONSUMER);
  await parkCursorAtHead();

  // Read AFTER the park and BEFORE any consumption, so the "untouched" assertion
  // below compares against the position the cadence engine actually held when
  // this suite started.
  cadenceCursorBefore = await readConsumerCursor(CADENCE_CONSUMER);

  tenantId = await seedTenant('Attribution Consume');

  // THE CONNECT-TIME BASELINE, and a real one: 10 wins in 40 quotes = 25%, well
  // above `BASELINE_MIN_QUOTES`, so `resolveBaseline` must answer 2500 bp from
  // `'connect'` rather than falling back to the deliberately HIGH 7000 default.
  // A suite that seeded no baseline would prove the default path and quietly
  // assert nothing about the branch a real client is billed on.
  await seedConnection(tenantId, {
    baseline_win_rate: '0.2500',
    baseline_quotes_issued: 40,
    baseline_window_start: '2026-05-01',
    baseline_window_end: '2026-07-31',
  });

  quotes = await seedQuotes(tenantId, [
    {
      total_invoice_amount: '2450.00',
      generated_job_id: 'JOB-4417',
      job_description: JOB_DESCRIPTION,
    },
    // The unqualified quote: a real job with a real price whose only touches
    // never actually went out. It must NOT be credited, and giving it a price
    // is what makes the absence of a row meaningful.
    { total_invoice_amount: '1800.00', generated_job_id: 'JOB-4418' },
    // The tick-seam quote.
    { total_invoice_amount: '990.00', generated_job_id: 'JOB-4419' },
  ]);

  const cadenceId = await seedCadence(tenantId, quotes[0].id, {
    contact_name: CONTACT_NAME,
  });

  // The win, first — every touch below is anchored to the instant the database
  // assigned it.
  const won = await emitWon(quotes[0].id, quotes[0].sm8_job_uuid);
  wonId1 = won.id;
  detectedAt1 = won.detectedAt;

  const at = (daysBefore: number): string =>
    new Date(detectedAt1.getTime() - daysBefore * DAY_MS).toISOString();

  // TWO QUALIFYING TOUCHES, ten days and two days before the win. Both inside
  // the 30-day window; touch 2 carries no delivery receipt, which QUALIFIES
  // (D-02: a pending receipt counts).
  await seedLedgerRow(tenantId, {
    cadenceId,
    quoteId: quotes[0].id,
    touchNumber: 1,
    claimedAt: at(10),
  });
  await seedLedgerRow(tenantId, {
    cadenceId,
    quoteId: quotes[0].id,
    touchNumber: 2,
    claimedAt: at(2),
  });
  // AND TWO THAT MUST NOT COUNT, on the same quote: a Phase 3 stub row (excluded
  // forever by the `sender` column) and one the carrier reported undelivered.
  // Without these the qualifying count would be right for the wrong reason.
  await seedLedgerRow(tenantId, {
    cadenceId,
    quoteId: quotes[0].id,
    touchNumber: 3,
    claimedAt: at(5),
    sender: 'stub',
    outcome: 'stub_sent',
  });
  await seedLedgerRow(tenantId, {
    cadenceId,
    quoteId: quotes[0].id,
    touchNumber: 4,
    claimedAt: at(4),
    deliveryStatus: 'undelivered',
  });

  // One threaded reply, between the two qualifying touches.
  await seedInbound(tenantId, {
    cadenceId,
    quoteId: quotes[0].id,
    receivedAt: at(6),
    label: 'question',
  });
}, 60_000);

afterAll(async () => {
  await teardownTenants([tenantId]);

  // ── PUT THE ATTRIBUTION CURSOR BACK EXACTLY AS IT WAS FOUND. ──────────────
  //
  // `event_consumer_cursors` is NOT a tenant-scoped table, so `teardownTenants`
  // cannot reach it and the ordered teardown above leaves this row untouched.
  // That matters more than it sounds: this suite PARKED the cursor at the outbox
  // head, and a parked cursor left behind is a permanent, silent change to what
  // production does the first time the deployed route runs with
  // `attribution: 'run'` — it would start attributing from wherever this test
  // run happened to stop instead of from where the operator decided.
  //
  // `null` is restored as an ABSENT ROW, not as 0. The outbox contract turns on
  // that distinction: "a consumer that does not exist yet must not silently
  // appear to be up to date", and a row at 0 is a consumer that HAS registered.
  // Deleting is what leaves the first production tick free to register itself
  // and walk the history idempotently, which is the behaviour the operator is
  // told to expect at deploy.
  if (attributionCursorBefore === null) {
    const { error } = await admin
      .from('event_consumer_cursors')
      .delete()
      .eq('consumer', ATTRIBUTION_CONSUMER);
    if (error) {
      throw new Error(`Restoring the attribution cursor failed: ${error.message}`);
    }
  } else {
    await setCursor(attributionCursorBefore);
  }

  await closeDb();
});

it('records ONE attribution for a qualifying win, with the whole evidence chain', async () => {
  const result = await consumeWonEvents();

  expect(result.eventsConsumed).toBeGreaterThanOrEqual(1);
  expect(result.attributionsRecorded).toBe(1);
  expect(result.attributionsUnqualified).toBe(0);
  expect(result.attributionsValueMissing).toBe(0);
  expect(result.tenantsBlocked).toBe(0);

  const row = await attributionFor(quotes[0].id);
  expect(row, 'the qualifying win must have produced a row').not.toBeNull();

  // ── THE MONEY, AS INTEGER CENTS AND INTEGER BASIS POINTS ──────────────────
  //
  // $2,450.00 gross. The conservative figure takes the client's OWN 25% baseline
  // off the top — 245000 × 7500 ÷ 10000, floored TOWARD THE CLIENT — because a
  // quarter of their quotes convert without us. 183750 is the number the
  // guarantee is measured on, and it is exact rather than approximately right.
  expect(row!.gross_cents).toBe(245000);
  expect(row!.conservative_cents).toBe(183750);
  expect(row!.value_source).toBe('mirror');

  // The baseline came from the CONNECT-TIME columns, not the 7000 bp default.
  expect(row!.baseline_rate_bp).toBe(2500);
  expect(row!.baseline_source).toBe('connect');
  expect(row!.baseline_sample).toBe(40);

  // Recorded PER ROW, so a frozen report keeps saying what it actually did even
  // after D-01 is changed.
  expect(row!.window_days).toBe(30);
  expect(row!.qualifying_touch_count).toBe(2);
  expect(row!.won_event_id).toBe(wonId1);
  expect(row!.sm8_job_uuid).toBe(quotes[0].sm8_job_uuid);

  // ── THE CHAIN ─────────────────────────────────────────────────────────────
  const evidence = row!.evidence as {
    wonEventId: number;
    ledger: Array<{ touchNumber: number; deliveryStatus: string | null }>;
    inbound: Array<{ label: string | null; isHot: boolean }>;
    escalations: unknown[];
    cadences: unknown[];
    generatedJobId: string | null;
    jobDescription: string | null;
    contactFirstName: string | null;
    constants: { attributionWindowDays: number };
    baseline: { rateBp: number; source: string; windowStart: string | null };
  };

  expect(evidence.wonEventId).toBe(wonId1);
  // EXACTLY the two qualifying touches, ordered by touch number — the stub and
  // the undelivered one are absent, which is the D-02 predicate proven rather
  // than described.
  expect(evidence.ledger.map((t) => t.touchNumber)).toEqual([1, 2]);
  expect(evidence.inbound).toHaveLength(1);
  expect(evidence.inbound[0].label).toBe('question');
  expect(evidence.escalations).toEqual([]);
  expect(evidence.cadences).toHaveLength(1);
  expect(evidence.generatedJobId).toBe('JOB-4417');
  expect(evidence.jobDescription).toBe(JOB_DESCRIPTION);
  // FIRST NAME ONLY. The row outlives the cadence the name was copied from.
  expect(evidence.contactFirstName).toBe('Marlee');
  expect(evidence.constants.attributionWindowDays).toBe(30);
  expect(evidence.baseline.rateBp).toBe(2500);
  expect(evidence.baseline.source).toBe('connect');
  expect(evidence.baseline.windowStart).toBe('2026-05-01');

  // ── T-7-15, AS A PROPERTY OF THE WHOLE ROW ────────────────────────────────
  //
  // The seeded ledger and inbound rows carry an ACMA fiction mobile
  // (`+61491570…`), and every seeded email address in this repository carries an
  // `@`. Neither appears anywhere in the serialized attribution row — not in a
  // column, not at any depth of the jsonb. This is the assertion that would
  // catch a select list widened to `.select()` in six months' time, which no
  // per-field expectation above can.
  const serialized = JSON.stringify(row);
  expect(serialized).not.toContain('@');
  expect(serialized).not.toContain('+61');
});

it('advanced its OWN cursor and left the cadence engine’s exactly where it was', async () => {
  expect(await readConsumerCursor(ATTRIBUTION_CONSUMER)).toBe(wonId1);

  // TWO CONSUMERS, TWO POSITIONS. If the attribution pass ever shared or moved
  // the cadence engine's row, a wedged cadence engine would silently stop the
  // billing — and a busy billing pass would silently skip cadence stops, which
  // means chasing a customer about a job the tradie already won.
  expect(await readConsumerCursor(CADENCE_CONSUMER)).toBe(cadenceCursorBefore);
});

it('REPLAY: a rewound cursor re-reads the win and writes nothing', async () => {
  const before = await attributionFor(quotes[0].id);
  expect(before).not.toBeNull();

  // Backwards by one — the thing no production path can do and every
  // crash-and-restart effectively does.
  await setCursor(wonId1 - 1);

  const replay = await consumeWonEvents();

  // The event IS consumed again. Replay is legal by contract; what must not
  // happen is a second row.
  expect(replay.eventsConsumed).toBeGreaterThanOrEqual(1);
  expect(replay.attributionsRecorded).toBe(0);
  expect(replay.attributionsUnqualified).toBe(0);

  const after = await attributionFor(quotes[0].id);
  // THE PROOF IS `id` AND `attributed_at`. An `INSERT … ON CONFLICT DO UPDATE`
  // would leave the same figures behind and pass a value assertion; only the
  // identity of the row distinguishes "the write was refused" from "the write
  // happened and produced the same result".
  expect(after!.id).toBe(before!.id);
  expect(after!.attributed_at).toBe(before!.attributed_at);
  expect(after!.gross_cents).toBe(before!.gross_cents);

  expect(await readConsumerCursor(ATTRIBUTION_CONSUMER)).toBe(wonId1);
});

it('A SECOND WIN after a reopen is a no-op decided by the database', async () => {
  const before = await attributionFor(quotes[0].id);

  await forTenant(tenantId).events.insertMany([
    {
      quoteId: quotes[0].id,
      sm8JobUuid: quotes[0].sm8_job_uuid,
      fromStatus: 'Work Order',
      toStatus: 'Quote',
      eventType: 'reopened',
      occurredAt: null,
    },
  ]);
  const second = await emitWon(quotes[0].id, quotes[0].sm8_job_uuid);
  wonId2 = second.id;

  const result = await consumeWonEvents();

  // BOTH events consumed — the `reopened` is walked past, the `won` is decided
  // and refused — and the cursor is past both.
  expect(result.eventsConsumed).toBeGreaterThanOrEqual(2);
  expect(result.attributionsRecorded).toBe(0);
  expect(await readConsumerCursor(ATTRIBUTION_CONSUMER)).toBe(wonId2);

  const after = await attributionFor(quotes[0].id);
  // ONE row still, and it is the FIRST one — with the figures and the event id
  // it was written with. A quote recovered twice is billed once.
  expect(after!.id).toBe(before!.id);
  expect(after!.won_event_id).toBe(wonId1);
});

it('UNQUALIFIED: a win with no real touch writes nothing and still advances', async () => {
  const cadenceId = await seedCadence(tenantId, quotes[1].id, {
    contact_name: 'Desmond Ferreira',
  });

  const won = await emitWon(quotes[1].id, quotes[1].sm8_job_uuid);
  wonId3 = won.id;

  const at = (daysBefore: number): string =>
    new Date(won.detectedAt.getTime() - daysBefore * DAY_MS).toISOString();

  // Both inside the window, and neither is a message a customer received: one
  // was logged by the Phase 3 stub sender, one came back undelivered.
  await seedLedgerRow(tenantId, {
    cadenceId,
    quoteId: quotes[1].id,
    touchNumber: 1,
    claimedAt: at(9),
    sender: 'stub',
    outcome: 'stub_sent',
  });
  await seedLedgerRow(tenantId, {
    cadenceId,
    quoteId: quotes[1].id,
    touchNumber: 2,
    claimedAt: at(3),
    deliveryStatus: 'undelivered',
  });

  const result = await consumeWonEvents();

  expect(result.attributionsUnqualified).toBe(1);
  expect(result.attributionsRecorded).toBe(0);
  // NOTHING IS HELD. An unqualified win is an answer, not a failure — the
  // healthy majority of wins, in fact.
  expect(await readConsumerCursor(ATTRIBUTION_CONSUMER)).toBe(wonId3);
  expect(await attributionFor(quotes[1].id)).toBeNull();
});

it('MISSING MIRROR: a vanished quote row is recorded, not skipped and not priced', async () => {
  // A quote id with no `quotes` row — what an ops purge plus a re-sync under a
  // new ServiceM8 uuid leaves behind (RESEARCH Pitfall 8). The touches still
  // happened, so the evidence is real and the dollar figure is not.
  orphanQuoteId = randomUUID();
  const orphanJobUuid = randomUUID();
  const orphanCadenceId = randomUUID();

  const won = await emitWon(orphanQuoteId, orphanJobUuid);
  wonId4 = won.id;

  await seedLedgerRow(tenantId, {
    cadenceId: orphanCadenceId,
    quoteId: orphanQuoteId,
    touchNumber: 1,
    claimedAt: new Date(won.detectedAt.getTime() - 7 * DAY_MS).toISOString(),
  });

  const result = await consumeWonEvents();

  expect(result.attributionsRecorded).toBe(1);
  expect(result.attributionsValueMissing).toBe(1);
  expect(await readConsumerCursor(ATTRIBUTION_CONSUMER)).toBe(wonId4);

  const row = await attributionFor(orphanQuoteId);
  expect(row).not.toBeNull();
  expect(row!.value_source).toBe('missing');
  // ZERO, AND SAID OUT LOUD. `value_source` is what stops a report adding this
  // line into a headline as though the job were worth nothing.
  expect(row!.gross_cents).toBe(0);
  expect(row!.conservative_cents).toBe(0);
  expect(row!.sm8_job_uuid).toBeNull();
  expect(row!.qualifying_touch_count).toBe(1);
});

it('THE TICK SEAM: the default tick does not register, scan or advance', async () => {
  const cadenceId = await seedCadence(tenantId, quotes[2].id, {
    contact_name: 'Priya Raghunathan',
  });

  const won = await emitWon(quotes[2].id, quotes[2].sm8_job_uuid);
  wonId5 = won.id;

  await seedLedgerRow(tenantId, {
    cadenceId,
    quoteId: quotes[2].id,
    touchNumber: 1,
    claimedAt: new Date(won.detectedAt.getTime() - DAY_MS).toISOString(),
  });

  const cursorBefore = await readConsumerCursor(ATTRIBUTION_CONSUMER);
  expect(cursorBefore).toBe(wonId4);

  // ── THE DEFAULT. No `attribution` option — exactly what every other remote
  // suite in this repository does. ──────────────────────────────────────────
  const skipped = await runCadenceTick({
    now: new Date(),
    classifyClient: null,
    draftClient: null,
  });

  expect(skipped.attributionsRecorded).toBe(0);
  expect(skipped.attributionEventsConsumed).toBe(0);
  expect(skipped.attributionsUnqualified).toBe(0);
  expect(skipped.attributionsValueMissing).toBe(0);
  expect(skipped.attributionTenantsBlocked).toBe(0);
  // ZERO IS THE ABSENCE OF A READING, not the position of the cursor — the pass
  // declined to register, so it cannot have taken one.
  expect(skipped.attributionCursorAt).toBe(0);

  // AND THE DATABASE AGREES: the cursor did not move and no row appeared. This
  // is the assertion that keeps `runCadenceTick` callable from any suite.
  expect(await readConsumerCursor(ATTRIBUTION_CONSUMER)).toBe(cursorBefore);
  expect(await attributionFor(quotes[2].id)).toBeNull();

  // ── AND THE ROUTE'S CALL. ─────────────────────────────────────────────────
  const ran = await runCadenceTick({
    now: new Date(),
    classifyClient: null,
    draftClient: null,
    attribution: 'run',
  });

  expect(ran.attributionsRecorded).toBeGreaterThanOrEqual(1);
  expect(ran.attributionCursorAt).toBeGreaterThanOrEqual(wonId5);
  expect(await readConsumerCursor(ATTRIBUTION_CONSUMER)).toBeGreaterThanOrEqual(wonId5);

  const row = await attributionFor(quotes[2].id);
  expect(row).not.toBeNull();
  expect(row!.gross_cents).toBe(99000);
  expect(row!.won_event_id).toBe(wonId5);
}, 120_000);

/**
 * ── THE SELECT LISTS ARE THE PRIVACY BOUNDARY, AND AN ABSENCE IS WHAT A
 *    BEHAVIOURAL TEST CANNOT SEE (T-7-15). ───────────────────────────────────
 *
 * The row assertion above proves no `@` and no `+61` reached the jsonb FOR THE
 * DATA THIS SUITE SEEDED. It would keep passing if the reads were widened to
 * `.select()` and a future fixture simply happened not to populate the
 * offending column. So the SOURCE is the assertion: each evidence read names
 * its columns, and the list is closed.
 */
describe('the three evidence reads select columns, never rows', () => {
  const forTenantSource = readFileSync(FOR_TENANT_SOURCE, 'utf8');
  const escalationsSource = readFileSync(ESCALATIONS_SOURCE, 'utf8');

  /** The keys of the `.select({ … })` object that follows `anchor`. */
  function selectKeys(source: string, anchor: string): string[] {
    const at = source.indexOf(anchor);
    expect(at, `${anchor} was not found — has the read been renamed?`).toBeGreaterThan(-1);

    const open = source.indexOf('.select({', at);
    expect(open, `${anchor} does not use an explicit select list.`).toBeGreaterThan(at);

    const close = source.indexOf('})', open);
    expect(close, `${anchor}'s select list is unterminated.`).toBeGreaterThan(open);

    const body = source.slice(open + '.select({'.length, close);
    return [...body.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]).sort();
  }

  it('ledger.listForQuote reads eight columns and no recipient address', () => {
    expect(selectKeys(forTenantSource, 'listForQuote: (quoteId: string) =>')).toEqual(
      [
        'cadenceId',
        'channel',
        'claimedAt',
        'deliveryStatus',
        'id',
        'outcome',
        'sender',
        'touchNumber',
      ].sort(),
    );
  });

  it('inbound.listThreadedForQuote reads no message text and no sender address', () => {
    expect(
      selectKeys(forTenantSource, 'listThreadedForQuote: (quoteId: string) =>'),
    ).toEqual(
      [
        'cadenceId',
        'channel',
        'id',
        'isHot',
        'isStop',
        'label',
        'quoteId',
        'receivedAt',
      ].sort(),
    );
  });

  it('listEscalationsForQuote reads no tradie mobile and no segment count', () => {
    expect(selectKeys(escalationsSource, 'export async function listEscalationsForQuote')).toEqual(
      ['cadenceId', 'createdAt', 'id', 'inboundMessageId', 'outcome', 'quoteId', 'sentAt'].sort(),
    );
  });

  it('the consumer never names the cadence engine’s cursor', () => {
    // A CONSTANT, NOT A STRING SEARCH FOR `'cadence-engine'`: the failure this
    // guards against is a copy-paste of the import, which is what would make
    // the two consumers silently share one position and each skip the events
    // the other consumed.
    const consumer = readFileSync(CONSUMER_SOURCE, 'utf8');
    expect(consumer).not.toContain('CADENCE_CONSUMER');
    expect(consumer).not.toContain('cadence-engine');
    expect(consumer).toContain('ATTRIBUTION_CONSUMER');
  });
});
