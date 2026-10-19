/**
 * The tracer: an eligible quote reaching a ledger-recorded send, through the
 * real path, against the real database (CAD-01, CAD-04, CAD-05).
 *
 * ── WHY THIS SUITE DRIVES `markChaseEligible` RATHER THAN INSERTING AN EVENT ─
 *
 * The event source is Phase 2's, and it is the half of the contract this phase
 * consumes. Seeding a `quote_status_events` row by hand would test the cadence
 * engine against a row shaped the way THIS suite imagines one, which is exactly
 * the assumption most worth catching: `occurred_at` carrying a months-old
 * ServiceM8 issue date, `detected_at` being the only honest anchor, `quote_id`
 * pointing at our row rather than the job uuid. So the flip runs for real and
 * the outbox row is the one production writes.
 *
 * ── THE CURSOR IS GLOBAL, AND THIS SUITE PARKS IT DELIBERATELY ──────────────
 *
 * `event_consumer_cursors` holds ONE row for the cadence engine across every
 * client — that is the design, not a limitation (per-tenant cursors could not
 * answer "have I processed everything up to id N"). A suite that started from 0
 * would therefore act on every other suite's leftover events. So the first test
 * asserts the registration contract explicitly, then parks the cursor at the
 * current maximum, which is also what a real consumer's position looks like.
 *
 * ── ORDERED, AND THAT IS LOAD-BEARING ───────────────────────────────────────
 *
 * These `it` blocks share one tenant and one cursor and run in file order: the
 * replay test rewinds a cursor the happy path advanced, and the zero-work test
 * asserts a quiet tick BEFORE the last test makes work for one. Vitest runs a
 * file's tests sequentially, and `vitest.config.mts` disables file parallelism.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';

import { CADENCE_CONSUMER } from '../src/core/cadence/constants';
import { runCadenceTick } from '../src/core/cadence/run-tick';
import type { DraftClient } from '../src/core/drafting/draft-touches';
import { nextAllowedSlot, type ContactWindow } from '../src/core/cadence/window';
import { markChaseEligible } from '../src/core/sync/eligibility';
import { closeDb, forTenant, readConsumerCursor, registerConsumerCursor } from '../src/db/repository';

import {
  admin,
  seedApprovedTemplateSet,
  seedAttestation,
  seedConnection,
  seedQuoteContacts,
  seedQuotes,
  seedApprovedDraft,
  seedSuppression,
  seedTenant,
  teardownTenants,
} from './helpers/seed';

const TENANT_ZONE = 'Australia/Perth';

/**
 * The window `beforeAll` widens this tenant to: always open, every day.
 *
 * Declared here as well so the helper below can ask the engine's own slot
 * chooser the same question dispatch will ask it. The window math itself is
 * proven exhaustively in `tests/cadence-window.test.ts` with pinned instants.
 */
const TENANT_WINDOW: ContactWindow = {
  timezone: TENANT_ZONE,
  contactHoursStart: '00:00:00',
  contactHoursEnd: '23:59:00',
  contactDays: [1, 2, 3, 4, 5, 6, 7],
};

/**
 * A draft that passes the validator: no digit and no date word the caller did
 * not supply, plain ASCII, one segment.
 */
const DRAFTED_BODY = 'Hi Ivy, just checking in on that quote. Any questions?';

/** The one seam that is faked in this suite. See the AI-01 test at the end. */
function fakeDraftClient(body: string): DraftClient & { calls: number } {
  const client = {
    calls: 0,
    messages: {
      parse: async () => {
        client.calls += 1;
        return {
          parsed_output: { body },
          stop_reason: 'end_turn',
          usage: { input_tokens: 1180, output_tokens: 38, cache_read_input_tokens: 0 },
        };
      },
    },
  };
  return client;
}

let tenantId: string;
let quotes: Array<{ id: string; sm8_job_uuid: string }>;

/**
 * The first moment after `after` at which this tenant may actually be contacted.
 *
 * TWO EDGES LIVE IN HERE, and both are properties of the engine rather than of
 * this suite:
 *
 *   THE HALF-OPEN BOUNDARY. `[start, end)` means 23:59 is outside a 00:00–23:59
 *   window — correctly, and permanently. Without this, the dispatch tests would
 *   fail for roughly one run in fourteen hundred, at midnight.
 *
 *   THE D-09 SAME-DAY MARGIN. The tick's re-window pass (03-04) will only leave
 *   an overdue touch where it is when at least `SAME_DAY_MARGIN_MINUTES` of the
 *   window remain — a touch coming due at knock-off is moved to tomorrow rather
 *   than sent. On an always-open window that is the last hour of the day, so a
 *   suite run at 23:15 Perth would watch its touch get re-windowed and then
 *   assert, mystifyingly, that nothing was dispatched.
 *
 * Both are answered by asking the engine's own slot chooser: `nextAllowedSlot`
 * returns its argument unchanged exactly when that moment is contactable, and
 * the next contactable moment otherwise. Asking it means this helper cannot
 * drift from the rule it is compensating for.
 */
function insideContactWindow(after: Date): Date {
  return nextAllowedSlot(
    new Date(after.getTime() + 60_000),
    TENANT_WINDOW,
    '00:00',
    () => 0,
  );
}

/** Park the shared cursor at the newest event, i.e. "caught up". */
async function parkCursorAtHead(): Promise<number> {
  const { data, error } = await admin
    .from('quote_status_events')
    .select('id')
    .order('id', { ascending: false })
    .limit(1);
  if (error) throw new Error(`Reading the outbox head failed: ${error.message}`);

  const head = (data?.[0]?.id as number | undefined) ?? 0;
  await setCursor(head);
  return head;
}

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

beforeAll(async () => {
  tenantId = await seedTenant('Cadence Tracer');

  // An ALWAYS-OPEN window, so the assertions are about the pipeline rather than
  // about what time of day CI happens to run. The window math itself is proven
  // exhaustively in tests/cadence-window.test.ts with pinned instants.
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

  // THE TWO-CONDITION ACTIVATION GATE (ONB-03 05-03, ONB-04 06-04): a tenant
  // missing EITHER an approved template set OR an `sm8_automation_off`
  // attestation has every cadence BORN `paused(onboarding)`. This suite is the
  // Phase 3 pipeline tracer — its subject is materialize → promote → dispatch,
  // which cannot run behind the activation gate. So this tracer tenant is given
  // BOTH conditions, which together are the true precondition for the pipeline
  // it asserts. The gate itself is proven in
  // tests/cadence-consume-events.test.ts and tests/onboarding-gate.test.ts.
  await seedApprovedTemplateSet(tenantId);
  await seedAttestation(tenantId);

  quotes = await seedQuotes(tenantId, [
    { job_description: 'tracer: reachable customer' },
    { job_description: 'tracer: already suppressed at creation' },
    { job_description: 'tracer: no usable contact' },
    { job_description: 'tracer: suppressed after approval' },
    { job_description: 'tracer: drafted inside the same tick' },
  ]);

  await seedQuoteContacts(tenantId, [
    {
      sm8_job_uuid: quotes[0].sm8_job_uuid,
      first: 'Dana',
      last: 'Reeve',
      mobile: '0400 123 456',
      contact_type: 'JOB',
    },
    {
      sm8_job_uuid: quotes[1].sm8_job_uuid,
      first: 'Sam',
      last: 'Okoro',
      mobile: '0400222333',
      contact_type: 'JOB',
    },
    {
      // A landline and nothing else: `normalizeAuMobile` refuses it and there is
      // no email, so D-04 has no reachable human and must say so.
      sm8_job_uuid: quotes[2].sm8_job_uuid,
      first: 'Lee',
      last: 'Nguyen',
      mobile: null,
      phone: '08 9321 4455',
      email: null,
      contact_type: 'JOB',
    },
    {
      sm8_job_uuid: quotes[3].sm8_job_uuid,
      first: 'Mo',
      last: 'Farrell',
      mobile: '0400444555',
      contact_type: 'JOB',
    },
    {
      sm8_job_uuid: quotes[4].sm8_job_uuid,
      first: 'Ivy',
      last: 'Nolan',
      mobile: '0400555666',
      contact_type: 'JOB',
    },
  ]);
});

afterAll(async () => {
  await teardownTenants([tenantId]);
  await closeDb();
});

it('registers its own cursor at 0 rather than finding one seeded (outbox contract)', async () => {
  const { error } = await admin
    .from('event_consumer_cursors')
    .delete()
    .eq('consumer', CADENCE_CONSUMER);
  if (error) throw new Error(`Clearing the cadence cursor failed: ${error.message}`);

  // ABSENT, not zero. The contract turns on that distinction: "a consumer that
  // does not exist yet must not silently appear to be up to date."
  expect(await readConsumerCursor(CADENCE_CONSUMER)).toBeNull();

  expect(await registerConsumerCursor(CADENCE_CONSUMER)).toBe(0);
  // ON CONFLICT DO NOTHING: two ticks starting at once produce one row at 0,
  // not an error and not a rewind of a consumer that is mid-batch.
  expect(await registerConsumerCursor(CADENCE_CONSUMER)).toBe(0);
  expect(await readConsumerCursor(CADENCE_CONSUMER)).toBe(0);

  await parkCursorAtHead();
});

it('carries an eligible quote to an active cadence with five ordered touches', async () => {
  const before = await readConsumerCursor(CADENCE_CONSUMER);
  expect(before).not.toBeNull();

  const flip = await markChaseEligible(tenantId, [quotes[0].id]);
  expect(flip).toEqual({ flipped: 1, eventsEmitted: 1 });

  const [event] = await forTenant(tenantId).events.since(before!);
  expect(event.eventType).toBe('quote_opened');

  // Pinned a second BEFORE the anchor, so this tick materializes and promotes
  // but does not yet dispatch — the send is the next test's assertion.
  const result = await runCadenceTick({
    draftClient: null,
    classifyClient: null,
    now: new Date(event.detectedAt.getTime() - 1_000),
    jitterMinutes: () => 0,
  });

  expect(result.eventsConsumed).toBe(1);
  expect(result.cadencesCreated).toBe(1);
  expect(result.cadencesStopped).toBe(0);
  expect(result.dispatched).toBe(0);

  const repo = forTenant(tenantId);
  const [cadence] = await repo.cadences.getByQuoteId(quotes[0].id);
  expect(cadence.status).toBe('active');
  // D-04: the SNAPSHOT is normalized, not the raw '0400 123 456' upstream.
  expect(cadence.contactMobile).toBe('+61400123456');
  expect(cadence.contactName).toBe('Dana Reeve');
  // D-01: Day 0 is the eligibility moment we detected, never ServiceM8's issue
  // date — which for this backfilled quote is `occurred_at`, and is not this.
  expect(cadence.anchorAt.getTime()).toBe(event.detectedAt.getTime());

  const touches = await repo.touches.listForCadence(cadence.id);
  expect(touches.map((t) => t.touchNumber)).toEqual([1, 2, 3, 4, 5]);
  expect(touches.map((t) => t.originalOffsetDays)).toEqual([0, 3, 7, 14, 21]);
  // Never born overdue, whatever the anchor's time of day.
  expect(touches[0].scheduledAt.getTime()).toBeGreaterThanOrEqual(
    cadence.anchorAt.getTime(),
  );
  // Strictly increasing: the cadence's sequence is a property of its numbering.
  for (let i = 1; i < touches.length; i++) {
    expect(touches[i].scheduledAt.getTime()).toBeGreaterThan(
      touches[i - 1].scheduledAt.getTime(),
    );
  }

  // THE D-14 GATES ARE REAL NOW (05-01 / D-12). The touch inside the draft lead
  // window is promoted to `needs_draft` and STOPS THERE — it is not auto-passed
  // to `approved`, and this tenant has no approved message template, so the
  // drafting pass leaves it parked (the ONB-03 belt). `needs_draft` is the
  // honest new state: cleared to be drafted, not cleared to be sent.
  expect(touches[0].status).toBe('needs_draft');
  expect(touches[1].status).toBe('scheduled');

  expect(await readConsumerCursor(CADENCE_CONSUMER)).toBe(event.id);
});

it('sends touch one exactly once, recorded as a stub in the ledger (CAD-04, D-13)', async () => {
  const repo = forTenant(tenantId);
  const [cadence] = await repo.cadences.getByQuoteId(quotes[0].id);
  const [touchOne] = await repo.touches.listForCadence(cadence.id);

  // ── 05-01: STAND IN FOR THE HUMAN, EXPLICITLY. ─────────────────────────────
  //
  // The previous tick parked this touch at `needs_draft`. This suite is about
  // DISPATCH MECHANICS — one ledger row, the stub sender, the never-twice
  // constraint — so it seeds the approved draft and moves the touch to
  // `approved` directly, which is exactly the state a real approval leaves
  // behind. The full needs_draft → pending_approval → approved journey through
  // the model and the validator is proven end to end in draft-pipeline.test.ts;
  // re-proving it here would make this test fail for two unrelated reasons.
  //
  // The write is through `admin` rather than the repository because
  // `touches.approveWhere` is guarded on `pending_approval` (D-12) and this
  // touch never passed through drafting — the guard is doing its job, and this
  // is the seam that says so.
  const approvedBody = await seedApprovedDraft(
    tenantId,
    cadence.id,
    touchOne.id,
    touchOne.touchNumber,
  );
  await admin.from('cadence_touches').update({ status: 'approved' }).eq('id', touchOne.id);

  const result = await runCadenceTick({
    draftClient: null,
    classifyClient: null,
    now: insideContactWindow(touchOne.scheduledAt),
    jitterMinutes: () => 0,
  });

  expect(result.dispatched).toBe(1);
  expect(result.refused).toBe(0);

  const ledger = await repo.ledger.listForCadence(cadence.id);
  expect(ledger).toHaveLength(1);
  expect(ledger[0].touchNumber).toBe(1);
  expect(ledger[0].channel).toBe('sms');
  expect(ledger[0].toAddress).toBe('+61400123456');
  // The Phase 7 exclusion key. A stub send must never be countable as a
  // delivered touch, because the invoice's proof would be a lie.
  expect(ledger[0].sender).toBe('stub');
  expect(ledger[0].outcome).toBe('stub_sent');
  expect(ledger[0].providerMessageId).toBeNull();

  const touches = await repo.touches.listForCadence(cadence.id);
  expect(touches[0].status).toBe('sent');
  expect(touches[0].skipReason).toBeNull();
  expect(touches.slice(1).every((t) => t.status !== 'sent')).toBe(true);

  // 05-01 / D-10 — the ledger records a send whose body was the approved
  // draft's. Dispatch composed nothing; `stubTouchBody` is no longer on this
  // path at all.
  expect(approvedBody).toContain('Reply STOP to opt out.');
});

/**
 * The guarantee the outbox contract demands of EVERY consumer, and the reason
 * `cadences_one_live_per_quote` is a partial unique index rather than a check in
 * application code.
 *
 * The rewind here is deliberate and not exotic: replay is legal by contract, and
 * it happens for real after a crash between the actions and a cursor advance
 * that was not co-committed, after an operator resets a stuck consumer, and any
 * time two ticks overlap. What must not happen is a second live cadence — the
 * customer receiving two parallel chase sequences for one job.
 */
it('absorbs a replayed quote_opened into the one live cadence (CAD-01)', async () => {
  const repo = forTenant(tenantId);
  const opened = (await repo.events.since(0)).find((e) => e.quoteId === quotes[0].id)!;
  const [cadence] = await repo.cadences.getByQuoteId(quotes[0].id);
  const before = await repo.touches.listForCadence(cadence.id);

  await setCursor(opened.id - 1);

  const result = await runCadenceTick({
    draftClient: null,
    classifyClient: null,
    now: insideContactWindow(before[0].scheduledAt),
    jitterMinutes: () => 0,
  });

  // Consumed again — and creating NOTHING. The zero rows came back from the
  // INSERT itself, not from a read this code did first and could have lost a
  // race against.
  expect(result.eventsConsumed).toBe(1);
  expect(result.cadencesCreated).toBe(0);
  expect(result.cadencesStopped).toBe(0);
  expect(result.dispatched).toBe(0);

  expect(await repo.cadences.getByQuoteId(quotes[0].id)).toHaveLength(1);

  const after = await repo.touches.listForCadence(cadence.id);
  expect(after.map((t) => t.id)).toEqual(before.map((t) => t.id));
  expect(after.map((t) => t.scheduledAt.getTime())).toEqual(
    before.map((t) => t.scheduledAt.getTime()),
  );

  // The never-twice constraint, observed from the other end: a replay reached
  // the same touch and no second ledger row exists.
  expect(await repo.ledger.listForCadence(cadence.id)).toHaveLength(1);
  expect(await readConsumerCursor(CADENCE_CONSUMER)).toBe(opened.id);
});

/**
 * D-15 — suppression blocks a NEW quote at creation, not merely at dispatch.
 *
 * This is the case that justifies keying `suppressed_contacts` on the normalized
 * ADDRESS rather than on a contact uuid: `quote_contacts` rows are per-job
 * mirrors, so the same human arrives as a brand-new row with a brand-new uuid on
 * every new job. A suppression that only stopped the job they complained about
 * would cheerfully start a fresh cadence the next time they asked for a quote.
 */
it('creates a cadence already stopped when the chosen contact is suppressed', async () => {
  await seedSuppression(tenantId, [
    { channel: 'sms', address: '+61400222333', reason: 'asked us to stop' },
  ]);

  const before = await readConsumerCursor(CADENCE_CONSUMER);
  await markChaseEligible(tenantId, [quotes[1].id]);

  const repo = forTenant(tenantId);
  const [event] = await repo.events.since(before!);

  const result = await runCadenceTick({
    draftClient: null,
    classifyClient: null,
    now: new Date(event.detectedAt.getTime() - 1_000),
    jitterMinutes: () => 0,
  });

  expect(result.eventsConsumed).toBe(1);
  expect(result.cadencesCreated).toBe(0);
  expect(result.cadencesStopped).toBe(1);

  const [cadence] = await repo.cadences.getByQuoteId(quotes[1].id);
  expect(cadence.status).toBe('stopped');
  expect(cadence.stopReason).toBe('contact_suppressed');
  // Nothing was scheduled, so there is nothing that could later be promoted by
  // a tick that forgets to check the cadence's status.
  expect(await repo.touches.listForCadence(cadence.id)).toEqual([]);

  // CONSUMED EXACTLY ONCE. A refusal that left the cursor behind would re-decide
  // this every minute forever.
  expect(await readConsumerCursor(CADENCE_CONSUMER)).toBe(event.id);
});

/**
 * D-04 — no usable contact is an answer, and it goes to the operator.
 *
 * The seeded contact has a Perth landline in `phone` and nothing else.
 * `normalizeAuMobile` accepts only mobile shapes, so the `phone` fallback cannot
 * promote it, and every guess available here is expensive: an SMS to a landline
 * is silently discarded by the carrier and a message to the wrong human is the
 * mistake a design partner tells other tradies about.
 */
it('creates a cadence stopped as no_contact when nobody is reachable', async () => {
  const before = await readConsumerCursor(CADENCE_CONSUMER);
  await markChaseEligible(tenantId, [quotes[2].id]);

  const repo = forTenant(tenantId);
  const [event] = await repo.events.since(before!);

  const result = await runCadenceTick({
    draftClient: null,
    classifyClient: null,
    now: new Date(event.detectedAt.getTime() - 1_000),
    jitterMinutes: () => 0,
  });

  expect(result.eventsConsumed).toBe(1);
  expect(result.cadencesCreated).toBe(0);
  expect(result.cadencesStopped).toBe(1);

  const [cadence] = await repo.cadences.getByQuoteId(quotes[2].id);
  expect(cadence.status).toBe('stopped');
  expect(cadence.stopReason).toBe('no_contact');
  expect(cadence.contactMobile).toBeNull();
  expect(cadence.contactEmail).toBeNull();
  // The selection is recorded as absent rather than as a best effort.
  expect(cadence.primaryContactSm8Uuid).toBeNull();
  expect(await repo.touches.listForCadence(cadence.id)).toEqual([]);

  expect(await readConsumerCursor(CADENCE_CONSUMER)).toBe(event.id);
});

/**
 * Most minutes have nothing to do, and that must be a clean zero rather than an
 * error, an empty-array crash or a write.
 */
it('completes a tick with no due work as an all-zero result (CAD-05)', async () => {
  const result = await runCadenceTick({ draftClient: null, classifyClient: null, now: new Date(), jitterMinutes: () => 0 });

  // EXHAUSTIVE `toEqual`, not a field-by-field check: this object becomes the
  // tick route's whole response body, so a field appearing without anyone
  // deciding it should — a client name, an error string, a count nobody reads —
  // fails here rather than in production logs.
  //
  // THREE fields carry `expect.any(Number)` here rather than a literal, for two
  // different reasons.
  //
  // `cursorAt` genuinely cannot be pinned: it is the shared outbox POSITION, and
  // every other suite in this run moves it. Nothing further is asserted about it.
  //
  // `draftingUnconfigured` cannot be pinned to an exact value either — it counts
  // TENANTS and every suite in this run seeds and deletes them — but it can
  // promise not to be zero, which is asserted after the object (see its own note
  // below).
  //
  // `escalationUnconfigured` is different again: its meaning IS pinned, exactly,
  // just below the object. It sits in the literal as `expect.any(Number)` only so
  // the reason for its value gets a paragraph instead of a trailing comment.
  //
  // In all three cases `expect.any(Number)` keeps the exhaustiveness — an extra
  // key still fails, and a string still fails — while the assertions after the
  // object say the things "any number" would otherwise admit away.
  expect(result).toEqual({
    eventsConsumed: 0,
    cadencesCreated: 0,
    cadencesStopped: 0,
    quotesFlaggedForReview: 0,
    eventsSkipped: 0,
    cursorAt: expect.any(Number),
    tenantsBlocked: 0,
    // ── THE ATTRIBUTION COUNTS (RPT-01, 07-03). ───────────────────────────────
    //
    // All zero — INCLUDING THE CURSOR POSITION, which is the one that needs the
    // argument. `cursorAt` two lines up is `expect.any(Number)` because the
    // cadence engine's cursor is a shared outbox POSITION that every other suite
    // in this run moves. `attributionCursorAt` is pinned to exactly 0 for the
    // opposite reason: this tick passed no `attribution` option, so the pass
    // defaulted to `'skip'` — and `'skip'` does not register a cursor, does not
    // scan and does not advance. It returns `NO_ATTRIBUTION`, whose `cursorAt: 0`
    // is the ABSENCE OF A READING rather than a claim that the cursor sits at
    // zero.
    //
    // So these six zeros are a property of THIS CALL, not of the shared
    // database's contents — the same argument the escalation block below makes,
    // and it matters more here. A pass that scanned would register the
    // attribution cursor at 0 and walk every `won` event on a production
    // database into `quote_attributions`, a table with no update method and no
    // delete method. If this pin ever goes red with a non-zero
    // `attributionCursorAt`, the default has stopped being `'skip'` and that is
    // the bug, not the assertion.
    attributionEventsConsumed: 0,
    attributionsRecorded: 0,
    attributionsUnqualified: 0,
    attributionsValueMissing: 0,
    attributionsPoisoned: 0,
    attributionCursorAt: 0,
    attributionTenantsBlocked: 0,
    cadencesExpired: 0,
    touchesRewindowed: 0,
    touchesSkipped: 0,
    touchesPromoted: 0,
    // 05-01/05-04 (AI-01). Present here because this assertion is EXHAUSTIVE by
    // design — a new count field that nobody decided to add fails this test
    // rather than appearing unannounced in the tick route's response body.
    touchesDrafted: 0,
    draftsNotOnboarded: 0,
    draftsValidatorFailed: 0,
    draftsRateLimited: 0,
    draftsDeferred: 0,
    draftsDeterministicFailed: 0,
    draftsAttemptsExhausted: 0,
    // NOT ZERO, and not pinnable either — see the assertion below the object.
    draftingUnconfigured: expect.any(Number),
    dispatched: 0,
    refused: 0,
    // The seven-way breakdown, all zero — and asserted member by member rather
    // than as `expect.any(Object)`, so a refusal reason added to the closed
    // vocabulary has to be acknowledged here too.
    refusals: {
      paused: 0,
      quote_closed: 0,
      mirror_missing: 0,
      suppressed: 0,
      outside_window: 0,
      claim_lost: 0,
      no_address: 0,
      no_approved_draft: 0,
      // added by 13-02 (2026-10, Phase 13): the lead dispatch branch's refusal.
      lead_closed: 0,
    },
    cadencesCompleted: 0,
    // added by 13-02 (2026-10, Phase 13): leads closed by the reconciling sweep.
    leadsClosed: 0,
    // added by 13-06 (2026-10): the 13-04 label-effects count, which that
    // plan added to the tick without acknowledging it in this exact-shape pin.
    // Zero on `leadsClosed`'s footing.
    leadsClosedByLabel: 0,
    // 05-06 (AI-02). The classification pass, and the one field here that is
    // deliberately NOT zero.
    inboundClassified: 0,
    inboundNeedsHuman: 0,
    inboundClassifyDeferred: 0,
    // ONE, because this tick passed `classifyClient: null` — and that is the
    // honest number rather than a blemish on an "all-zero" title. With no client
    // the pass does not read the queue at all (running that scan every minute to
    // rediscover a missing key is work that answers a question the environment
    // already answered), so it cannot report how many rows went unlabelled. It
    // reports instead that it did not run. A 0 here would be indistinguishable
    // from a healthy pass with nothing to do, which is exactly the confusion
    // D-10's separate `draftingUnconfigured` count exists to prevent one pass
    // over.
    classificationUnconfigured: 1,
    // ── THE ESCALATION COUNTS (CON-03, 06-05). ────────────────────────────────
    //
    // All zero because this tick supplied no `escalationSender`, so the pass did
    // not run and — the part that matters for a pinned zero — did not SCAN
    // either. Claiming an `escalations` row is what consumes the never-twice
    // right a hot reply gets (see `RunCadenceTickOptions.escalationSender`), so a
    // pass that declines to start cannot have spent one on another suite's row.
    // These zeros are therefore a property of this call, not of the shared
    // database's contents.
    hotEscalated: 0,
    escalationCooldownSuppressed: 0,
    escalationNoNumber: 0,
    escalationNotConfigured: 0,
    escalationSendFailed: 0,
    escalationDeferred: 0,
    // NOT ZERO, and — unlike the two above it — exactly pinnable. See the
    // assertion below the object.
    escalationUnconfigured: expect.any(Number),
    // 12-05 (D-16): the quote-call pass rides the same seam, so with no
    // escalation sender it did not scan either — zeros by construction.
    quoteCallEscalated: 0,
    quoteCallEscalationSuppressed: 0,
    quoteCallEscalationRefused: 0,
    quoteCallEscalationFailed: 0,
    // 13-06 (2026-10, D-07/D-09): the hot-lead pass did not scan (no
    // escalation sender), so nothing was held; ring-twice and the release ride
    // the same seam and did not scan either — zeros by construction.
    escalationHeld: 0,
    ringTwiceEscalated: 0,
    ringTwiceHeld: 0,
    ringTwiceSuppressed: 0,
    ringTwiceRefused: 0,
    ringTwiceFailed: 0,
    escalationReleased: 0,
    escalationReleaseRefused: 0,
    escalationReleaseFailed: 0,
    // ── THE TEXT-BACK SWEEP COUNTS (Phase 12, TXT-02). ───────────────────────
    //
    // All zero, and `textBackUnconfigured` exactly 1, because this tick supplied
    // no `textBackSender`: the sweep did not run, did not scan, claimed no
    // pending call and marked none stale. Like the escalation zeros above, these
    // are a property of this call, not of the shared database.
    textBackSwept: 0,
    textBackSent: 0,
    textBackSkipped: 0,
    textBackFailed: 0,
    textBackStale: 0,
    textBackUnconfigured: 1,
    // Zero because no `textBackOps` was supplied: the alert pass did not run
    // and claimed nothing.
    textBackAlerted: 0,
    textBackAlertFailed: 0,
    textBackPauseFailed: 0,
    // And the balance probe, behind the same seam: did not run.
    balanceProbed: 0,
    balanceProbeFailed: 0,
    balanceLowAlerted: 0,
    textBackAutoDisarmed: 0,
    // ── THE AGING COUNTS (CON-04, 06-02). ─────────────────────────────────────
    //
    // Zero on the opposite footing: the aging pass DID run (its sender is a
    // no-op, not absent). `forAllTenants_claimNewlyStalled` claims only touches
    // in a stallable status whose `scheduled_at` is already past and whose
    // `stall_alerted_at IS NULL`, and nothing this suite has seeded at this point
    // is any of those things — the same clean-shared-database stance the
    // `dispatched: 0` pin above already takes. With zero claims both alert flags
    // are 0 by the fields' own doc comments (`stallAlertSent` is 1 only when a
    // covering email left; `stallAlertFailed` only when touches were claimed and
    // it did not).
    touchesNewlyStalled: 0,
    stallAlertSent: 0,
    stallAlertFailed: 0,
  });

  // ── AND ONE FIELD THAT IS UNCONFIGURED-BUT-COUNTABLE (CON-03). ──────────────
  //
  // `escalationUnconfigured` reports the same kind of fact as the two notes
  // above — nothing is wired, so the pass did not run — but it is asserted with
  // strict equality where `draftingUnconfigured` gets `toBeGreaterThanOrEqual`,
  // and the difference is what each one counts.
  //
  // `draftingUnconfigured` counts TENANTS, so its value depends on what else is
  // in the shared database this minute. `escalationUnconfigured` is a 0/1 FLAG
  // about this call alone — "1 when no escalation sender was supplied" per its
  // own doc comment (run-tick.ts) — and this call supplied none. Nothing any
  // other suite does can move it. A `toBeGreaterThanOrEqual` here would be
  // borrowing looseness the field does not need, and would pass just as happily
  // if the flag were ever miscounted upward into a tally.
  //
  // 1 is the honest number rather than a blemish on the "all-zero" title, for
  // the reason the `classificationUnconfigured` note above gives at length: a 0
  // would be indistinguishable from an armed pass that found nothing, and those
  // two are read very differently at 3am.
  expect(result.escalationUnconfigured).toBe(1);

  // ── THE SAME HONESTY, ONE PASS OVER (WR-04). ──────────────────────────────
  //
  // This tick passed `draftClient: null`, so drafting could not run for ANY
  // tenant and must not report a clean zero — for exactly the reason the
  // `classificationUnconfigured` note above gives. It used to report 0 here,
  // because the count was `touches.length`: the touches promoted THIS MINUTE,
  // which on a quiet tick is none. So the field the comment above cites as the
  // precedent was itself the confusion it warns about.
  //
  // The number is TENANTS whose drafting could not run, so it cannot be pinned:
  // every suite in this run seeds and deletes tenants against the shared
  // database. What it can promise is that it is not zero.
  expect(result.draftingUnconfigured).toBeGreaterThanOrEqual(1);
});

/**
 * THE CAD-05 HEADLINE: approved yesterday, suppressed this morning, not sent.
 *
 * A touch is approved ahead of its slot (D-14's draft lead), so between approval
 * and dispatch there is a real window in which the customer can ask to be left
 * alone. Everything the schedule assumed is therefore re-read INSIDE the claim
 * transaction — a check performed before it would be a TOCTOU with a real
 * customer at the end of it.
 */
it('refuses a due, approved touch whose recipient was suppressed after approval', async () => {
  const before = await readConsumerCursor(CADENCE_CONSUMER);
  await markChaseEligible(tenantId, [quotes[3].id]);

  const repo = forTenant(tenantId);
  const [event] = await repo.events.since(before!);

  const created = await runCadenceTick({
    draftClient: null,
    classifyClient: null,
    now: new Date(event.detectedAt.getTime() - 1_000),
    jitterMinutes: () => 0,
  });
  expect(created.cadencesCreated).toBe(1);

  const [cadence] = await repo.cadences.getByQuoteId(quotes[3].id);
  const touches = await repo.touches.listForCadence(cadence.id);
  expect(cadence.status).toBe('active');
  // 05-01: promoted to the drafting queue, not to `approved` (D-12).
  expect(touches[0].status).toBe('needs_draft');

  // Stand in for the human, as in the send test above — this test is about
  // SUPPRESSION BEATING AN APPROVAL, so the touch has to genuinely be approved
  // and genuinely have a draft. Otherwise it would refuse `no_approved_draft`
  // and pass for the wrong reason, which is the failure mode that matters here:
  // the assertion below counts ONE refusal, and either bug produces one.
  await seedApprovedDraft(tenantId, cadence.id, touches[0].id, touches[0].touchNumber);
  await admin
    .from('cadence_touches')
    .update({ status: 'approved' })
    .eq('id', touches[0].id);

  // ── The customer asks to be left alone, after the touch was cleared to send.
  await seedSuppression(tenantId, [
    { channel: 'sms', address: '+61400444555', reason: 'replied STOP', source: 'sms_stop' },
  ]);

  const result = await runCadenceTick({
    draftClient: null,
    classifyClient: null,
    now: insideContactWindow(touches[0].scheduledAt),
    jitterMinutes: () => 0,
  });

  expect(result.dispatched).toBe(0);
  expect(result.refused).toBe(1);
  // The refusal is SUPPRESSION, not a missing draft. Pinned explicitly because
  // both produce `refused: 1` and only one of them is what this test claims.
  expect(result.refusals.suppressed).toBe(1);
  expect(result.refusals.no_approved_draft).toBe(0);

  // NOTHING WAS CLAIMED. The ledger is the record of what was sent, and a
  // refused touch must leave no trace in it at all.
  expect(await repo.ledger.listForCadence(cadence.id)).toEqual([]);

  const after = await repo.touches.listForCadence(cadence.id);
  expect(after[0].status).toBe('skipped');
  expect(after[0].skipReason).toBe('suppressed');
  // The stop and the skipping of the remaining touches are one transaction: a
  // stopped cadence whose touches are still scheduled is the state that makes a
  // killed cadence keep sending.
  expect(after.slice(1).map((t) => t.status)).toEqual(['skipped', 'skipped', 'skipped', 'skipped']);
  expect(after.slice(1).every((t) => t.skipReason === 'cadence_stopped')).toBe(true);

  const [stopped] = await repo.cadences.getByQuoteId(quotes[3].id);
  expect(stopped.status).toBe('stopped');
  expect(stopped.stopReason).toBe('contact_suppressed');
});

/**
 * AI-01 — PROMOTED AND DRAFTED INSIDE ONE TICK, against the real database.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ The only fake is the MODEL. Everything else is the production path:      │
 * │ consume → materialize → promote → draft → `touch_drafts` row.            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `tests/draft-touches.test.ts` proves the batch shape and the failure matrix
 * purely; this proves the wiring — that `runProgressPass` actually reaches the
 * drafting pass, that the counts it returns arrive in the tick result under the
 * right names, and that a real `cadence_settings` row exists by the time
 * drafting runs (it does, because `consume-events` calls `settings.ensure()`
 * when it creates the cadence).
 */
it('promotes and drafts a touch in the same tick, reporting it in the counts (AI-01)', async () => {
  const before = await readConsumerCursor(CADENCE_CONSUMER);
  await markChaseEligible(tenantId, [quotes[4].id]);

  const repo = forTenant(tenantId);
  const [event] = await repo.events.since(before!);

  const client = fakeDraftClient(DRAFTED_BODY);
  const result = await runCadenceTick({
    draftClient: client,
    classifyClient: null,
    // A second before the anchor: materialize and promote, but do not dispatch.
    now: new Date(event.detectedAt.getTime() - 1_000),
    jitterMinutes: () => 0,
  });

  expect(result.cadencesCreated).toBe(1);
  expect(result.touchesPromoted).toBe(1);
  expect(result.touchesDrafted).toBe(1);
  // EVERY OTHER DRAFTING COUNT IS ZERO, asserted one by one. A success that
  // also incremented a failure counter is a mapping bug, and the whole point of
  // splitting the old lump was to be able to see one.
  expect(result.draftsNotOnboarded).toBe(0);
  expect(result.draftsValidatorFailed).toBe(0);
  expect(result.draftsRateLimited).toBe(0);
  expect(result.draftsDeferred).toBe(0);
  expect(result.draftsDeterministicFailed).toBe(0);
  expect(result.draftsAttemptsExhausted).toBe(0);
  expect(result.draftingUnconfigured).toBe(0);

  // ONE call for one touch. The other four touches of this cadence are days
  // out and outside the 24h draft lead, so they are not promoted and not paid
  // for — a batch that drafted the whole schedule up front would.
  expect(client.calls).toBe(1);

  const [cadence] = await repo.cadences.getByQuoteId(quotes[4].id);
  const touches = await repo.touches.listForCadence(cadence.id);
  expect(touches[0].status).toBe('pending_approval');
  expect(touches.slice(1).every((t) => t.status === 'scheduled')).toBe(true);

  const [draft] = await repo.drafts.latestForTouch(touches[0].id);
  expect(draft.status).toBe('generated');
  expect(draft.attempt).toBe(1);
  expect(draft.generatedBody).toBe(DRAFTED_BODY);
  // The Spam Act line is OURS, appended mechanically — the fake model never
  // produced it, and the tenant name in it carries digits from `seedTenant`,
  // which the validator must not read as an invented number.
  expect(draft.finalBody.startsWith(DRAFTED_BODY)).toBe(true);
  expect(draft.finalBody.endsWith('Reply STOP to opt out.')).toBe(true);

  // NOT SENT. The whole D-12 point: a draft is a thing awaiting a human.
  expect(result.dispatched).toBe(0);
  expect(await repo.ledger.listForCadence(cadence.id)).toEqual([]);
});
