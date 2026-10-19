/**
 * Every cadence repository namespace, executed once against the real database.
 *
 * ── WHY THIS SUITE EXISTS, WRITTEN DOWN BECAUSE IT ALMOST DID NOT ──────────
 *
 * Plan 03-01 verified Task 2 with `typecheck && lint`. Both passed while
 * `promoteDue` was BROKEN: it interpolated a raw `Date` into a `sql` template,
 * which the postgres.js driver rejects at Bind time with "The string argument
 * must be of type string… Received an instance of Date". Nothing in the type
 * system distinguishes `sql\`${col} <= ${date}\`` from `lte(col, date)` — the
 * first fails only when the query actually runs, and the first caller would
 * have been a Wave-2 plan wiring the tick end to end.
 *
 * That is the shape of every bug this layer can have. The queries here are
 * written by hand for their SQL semantics, not for their TypeScript, and three
 * of them are load-bearing product guarantees expressed entirely in SQL:
 *
 *   * `cadences.create`'s ON CONFLICT must refuse against EVERY unique index on
 *     the table, and must do it by RETURNING ZERO ROWS rather than by raising.
 *     Since G-3-2 the statement is TARGETLESS: naming an arbiter picks one
 *     index, and a conflict on another then raises 23505, which
 *     `consume-events` reads as a blocked run and which holds the shared cursor
 *     for every tenant. The refusals are tested separately —
 *     `cadences_one_live_per_quote` with two DIFFERENT event ids (a second live
 *     cadence would mean two parallel chases), and
 *     `cadences_one_per_opened_event` by re-creating with the SAME event id
 *     after the first cadence has stopped (the replay the partial index cannot
 *     see). `cadences_one_live_per_job` (WR-02) is witnessed end-to-end in
 *     tests/cadence-consume-events.test.ts, where the purge-and-re-sync that
 *     reaches it can actually be staged, and the whole arbiter SET is pinned in
 *     tests/rls-coverage.test.ts (WR-06) because a targetless ON CONFLICT makes
 *     that set part of this statement's contract.
 *   * The DATABASE, not `CadenceCreate`'s type, refuses a cadence with no replay
 *     key (CR-01). A NULL `created_by_event_id` used to conflict with nothing
 *     and produce a silent duplicate chase.
 *   * `ledger.insertClaim` returning zero rows IS the CAD-04 never-twice
 *     guarantee. A version that returned the conflicting row instead would let
 *     both racers believe they had won the claim.
 *   * `resumeWherePaused`'s reason guard is the D-05/D-06 asymmetry. A client
 *     un-pause lifting a `customer_reply` pause is a message sent to somebody
 *     mid-conversation with the tradie.
 *
 * So each is exercised for its BEHAVIOUR — the refusal as much as the success —
 * rather than merely compiled. The deeper per-path suites (the concurrency race,
 * the JIT revalidation matrix, the transition matrix) belong to the later plans
 * that build those paths; this one is the standing guard that the data access
 * underneath them runs at all.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  closeDb,
  forAllTenants_cadenceTick,
  forAllTenants_pendingQuoteEvents,
  forTenant,
} from '../src/db/repository';

import { admin, seedConnection, seedQuotes, seedTenant, teardownTenants } from './helpers/seed';

let tenantId: string;
let quoteId: string;

/**
 * Every message in an error's cause chain, joined.
 *
 * drizzle re-wraps driver failures as `Failed query: <the SQL>`, whose own
 * message names the statement but never the rule that refused it — the same
 * wrapping `scripts/migrate.mjs` walks the chain for. Matching on the outer
 * message would accept ANY failed insert; the constraint name is the only thing
 * that says WHICH guarantee held, which is the entire content of the assertion.
 */
function refusalText(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 5; depth += 1) {
    messages.push(current.message);
    current = current.cause;
  }
  return messages.join(' | ');
}

beforeAll(async () => {
  tenantId = await seedTenant('Cadence Smoke');
  await seedConnection(tenantId);
  const [quote] = await seedQuotes(tenantId, [{ job_description: 'smoke' }]);
  quoteId = quote.id;
});

afterAll(async () => {
  await teardownTenants([tenantId]);
  await closeDb();
});

it('runs every cadence namespace, and refuses where it must', async () => {
  const repo = forTenant(tenantId);

  // templates
  const seeded = await repo.templates.ensureDefaults([0, 3, 7, 14, 21]);
  expect(seeded).toHaveLength(5);
  expect(await repo.templates.ensureDefaults([0, 3, 7, 14, 21])).toEqual([]);
  expect(await repo.templates.list()).toHaveLength(5);

  // settings
  const settings = await repo.settings.ensure();
  expect(settings.tenantId).toBe(tenantId);
  expect(await repo.settings.ensure()).toBeTruthy();
  const paused = await repo.settings.setPausedAt(new Date());
  expect(paused[0].pausedAt).not.toBeNull();
  await repo.settings.setPausedAt(null);

  // cadences — the partial-unique (LIVE) arbiter, specifically.
  //
  // The two creates below carry DIFFERENT `createdByEventId`s deliberately: with
  // the same id the second would conflict on `cadences_one_per_opened_event` and
  // this assertion would prove nothing about the live index it exists to test
  // (G-3-2 added a second unique; each needs its own witness). Fake bigints are
  // fine — the column has no FK, deliberately.
  const [cadence] = await repo.cadences.create({
    quoteId,
    sm8JobUuid: randomUUID(),
    anchorAt: new Date(),
    contactMobile: '+61400111222',
    createdByEventId: 900_000_001,
  });
  expect(cadence).toBeTruthy();

  const replay = await repo.cadences.create({
    quoteId,
    sm8JobUuid: randomUUID(),
    anchorAt: new Date(),
    createdByEventId: 900_000_002,
  });
  expect(replay, 'a replayed create must refuse, not duplicate').toEqual([]);

  expect(await repo.cadences.getByQuoteId(quoteId)).toHaveLength(1);
  expect(await repo.cadences.listLive()).toHaveLength(1);

  // touches
  const touches = await repo.touches.insertMany([
    {
      cadenceId: cadence.id,
      touchNumber: 1,
      channel: 'sms',
      scheduledAt: new Date(Date.now() - 60_000),
      originalOffsetDays: 0,
    },
    {
      cadenceId: cadence.id,
      touchNumber: 2,
      channel: 'sms',
      scheduledAt: new Date(Date.now() + 86_400_000 * 3),
      originalOffsetDays: 3,
    },
  ]);
  expect(touches).toHaveLength(2);
  expect(await repo.touches.listForCadence(cadence.id)).toHaveLength(2);
  expect(await repo.touches.listUnsentForCadence(cadence.id)).toHaveLength(2);

  const promoted = await repo.touches.promoteDue(new Date(), 0);
  expect(promoted.map((t) => t.touchNumber)).toEqual([1]);
  // 05-01 / D-12: `promoteDue` promotes to the DRAFTING QUEUE and stops. It used
  // to auto-pass both D-14 gates and land on `approved`; nothing in the
  // repository can write that status now except `touches.approveWhere`, guarded
  // on `pending_approval`.
  expect(promoted[0].status).toBe('needs_draft');

  const rescheduled = await repo.touches.reschedule(
    touches[1].id,
    new Date(Date.now() + 86_400_000 * 4),
  );
  expect(rescheduled).toHaveLength(1);

  // ledger — the CAD-04 claim
  const claim = await repo.ledger.insertClaim({
    cadenceId: cadence.id,
    quoteId,
    touchNumber: 1,
    channel: 'sms',
    toAddress: '+61400111222',
    sender: 'stub',
  });
  expect(claim).toHaveLength(1);

  const second = await repo.ledger.insertClaim({
    cadenceId: cadence.id,
    quoteId,
    touchNumber: 1,
    channel: 'sms',
    toAddress: '+61400111222',
    sender: 'stub',
  });
  expect(second, 'the never-twice constraint must refuse the second claim').toEqual([]);

  const outcome = await repo.ledger.setOutcome(claim[0].id, 'stub_sent', null);
  expect(outcome[0].outcome).toBe('stub_sent');
  expect(await repo.ledger.listForCadence(cadence.id)).toHaveLength(1);

  // suppression
  expect(
    await repo.suppression.insertMany([
      { channel: 'sms', address: '+61400111222', reason: 'smoke', source: 'operator_kill' },
    ]),
  ).toBe(1);
  expect(
    await repo.suppression.insertMany([
      { channel: 'sms', address: '+61400111222', reason: 'smoke', source: 'operator_kill' },
    ]),
    'a duplicate kill is a no-op',
  ).toBe(0);

  const hits = await repo.suppression.existsFor([
    { channel: 'sms', address: '+61400111222' },
    { channel: 'email', address: '+61400111222' },
  ]);
  expect(hits, 'the pair must match as a pair, not channel-then-address').toEqual([
    { channel: 'sms', address: '+61400111222' },
  ]);
  expect(await repo.suppression.listAll()).toHaveLength(1);

  // guarded transitions
  expect(await repo.cadences.pauseWhereActive([cadence.id], 'customer_reply')).toHaveLength(1);
  expect(
    await repo.cadences.resumeWherePaused([cadence.id], 'client_paused'),
    'a client un-pause must not lift a customer_reply pause',
  ).toEqual([]);
  expect(await repo.cadences.resumeWherePaused([cadence.id], 'customer_reply')).toHaveLength(1);

  const stopped = await repo.cadences.stopWhereLiveByQuoteIds([quoteId], 'won');
  expect(stopped).toHaveLength(1);
  expect(stopped[0].stopReason).toBe('won');
  expect(
    await repo.cadences.stopWhereLiveByQuoteIds([quoteId], 'removed'),
    'a replayed stop must not overwrite the reason',
  ).toEqual([]);

  // G-3-2 — the OTHER arbiter, and the only place it can be witnessed: the
  // cadence above is now STOPPED, so `cadences_one_live_per_quote` covers no row
  // and would refuse nothing. Re-creating with the SAME `createdByEventId` is
  // the held-cursor replay, and it must come back as ZERO ROWS — not a thrown
  // 23505, which `consume-events` would read as a blocked run and which would
  // hold the shared cursor for every tenant.
  expect(
    await repo.cadences.create({
      quoteId,
      sm8JobUuid: randomUUID(),
      anchorAt: new Date(),
      createdByEventId: 900_000_001,
    }),
    'a replayed quote_opened must refuse even once its cadence has stopped',
  ).toEqual([]);
  expect(await repo.cadences.getByQuoteId(quoteId)).toHaveLength(1);

  // CR-01 — THE REPLAY KEY IS ENFORCED BY THE DATABASE, NOT BY THE TYPE.
  //
  // `CadenceCreate` requires `createdByEventId`, so this cast is the only way to
  // express the writer this test exists to guard against: an ops backfill, a
  // psql session, a Phase 4 path that omits the key. Before migration 0023 that
  // insert SUCCEEDED — NULLS DISTINCT lets a unique index hold unlimited NULL
  // keys, so the row conflicted with nothing, `create` returned it, and the
  // consumer reported 'created'. A duplicate ACTIVE cadence re-chased the
  // customer from touch 1 with no 23505, no log line and no counter anywhere.
  //
  // It must now RAISE. A rejection is the whole difference between a guarantee
  // and a convention.
  const keyless = await repo.cadences
    .create({
      quoteId,
      sm8JobUuid: randomUUID(),
      anchorAt: new Date(),
      createdByEventId: null,
    } as unknown as Parameters<typeof repo.cadences.create>[0])
    .then(
      () => null,
      (error: unknown) => error,
    );

  expect(
    keyless,
    'a cadence created without its replay key must be refused by the database',
  ).not.toBeNull();
  expect(
    refusalText(keyless),
    'and refused BY THAT RULE — any other failure would pass a weaker test',
  ).toMatch(/cadences_replay_key_present/);

  expect(
    await repo.cadences.getByQuoteId(quoteId),
    'the refused insert must leave no row behind',
  ).toHaveLength(1);

  const skipped = await repo.touches.skipUnsentForCadences([cadence.id], 'cadence_stopped');
  expect(skipped.length).toBeGreaterThan(0);
  expect(await repo.touches.skipWhere([touches[0].id], 'stale')).toEqual([]);

  // quotes.flagNeedsReviewOnReopen — only flips an eligible, live quote
  expect(await repo.quotes.flagNeedsReviewOnReopen([quoteId])).toEqual([]);
  await repo.quotes.updateEligibilityWhereNeedsReview([quoteId]);
  expect(await repo.quotes.flagNeedsReviewOnReopen([quoteId])).toHaveLength(1);

  // transaction() must expose the same namespaces
  await repo.transaction(async (tx) => {
    expect(await tx.cadences.listLive()).toEqual([]);
    expect(await tx.suppression.listAll()).toHaveLength(1);
  });

  // cross-tenant accessors
  const tick = await forAllTenants_cadenceTick();
  const mine = tick.find((t) => t.tenantId === tenantId);
  expect(mine).toBeTruthy();
  expect(mine!.contactDays).toEqual([1, 2, 3, 4, 5]);
  expect(mine!.preferredSendTime).toBe('09:30:00');
  expect(mine!.settingsPausedAt).toBeNull();

  const events = await forAllTenants_pendingQuoteEvents(0, 5);
  expect(Array.isArray(events)).toBe(true);
  expect(events.length).toBeLessThanOrEqual(5);
});

/**
 * WR-03 — THE TRIPWIRE ON THE EDGE OF THE REPLAY GUARANTEE.
 *
 * THIS TEST PINS A KNOWN GAP RATHER THAN A GUARANTEE, AND THAT IS DELIBERATE.
 *
 * `createCadenceForQuoteOpened` returns 'replayed' for BOTH conflict cases, and
 * the event is consumed either way — but only the event that actually CREATED a
 * row has its id recorded in `created_by_event_id`. An event refused by a LIVE
 * index (a cadence already exists for this quote/job, created by a DIFFERENT
 * event) is consumed with its id written nowhere, so replaying it after that
 * cadence stops finds no index covering the row and creates a duplicate.
 *
 * It cannot be closed by stamping the second event onto the first cadence: that
 * row already carries the id of the event that created it, and one column cannot
 * hold two. Closing it properly needs a consumed-event ledger.
 *
 * It is unreachable in production TODAY, and only because of two facts about the
 * EMITTERS, neither of which lives in this layer: `markChaseEligible` requires
 * `chase_eligibility = 'needs_review'`, whose only writer runs in the same
 * transaction as `stopWhereLiveByQuoteIds`; and `run-sync.ts` suppresses
 * `quote_opened` for a quote it already had a row for. Nothing in the code or
 * the other tests marked that dependency, so a Phase 4 eligibility writer could
 * make this real and every test would stay green.
 *
 * So: if this test goes RED, someone has closed the gap — good, delete it and
 * widen the claim in `cadences.ts` back to unconditional. If it stays green
 * while a new eligibility writer lands, the claim in `cadences.ts` is the one
 * that must be believed, not the shorter version.
 */
it('pins the gap: an event refused by a LIVE index has its id recorded nowhere (WR-03)', async () => {
  const repo = forTenant(tenantId);
  const [quote] = await seedQuotes(tenantId, [{ job_description: 'wr-03 tripwire' }]);

  // The same ServiceM8 job throughout, because that is what production does and
  // because `cadences_one_live_per_job` keys on it.
  const job = randomUUID();
  const firstEvent = 900_100_001;
  const secondEvent = 900_100_002;

  const [first] = await repo.cadences.create({
    quoteId: quote.id,
    sm8JobUuid: job,
    anchorAt: new Date(),
    contactMobile: '+61400333444',
    createdByEventId: firstEvent,
  });
  expect(first).toBeTruthy();

  // A SECOND `quote_opened` for the same quote, arriving while the first cadence
  // is LIVE. Refused — by `cadences_one_live_per_quote` / `_per_job`, not by the
  // event index, since this event id has never been seen.
  expect(
    await repo.cadences.create({
      quoteId: quote.id,
      sm8JobUuid: job,
      anchorAt: new Date(),
      createdByEventId: secondEvent,
    }),
    'a live cadence exists, so the second create must refuse',
  ).toEqual([]);

  // AND HERE IS THE GAP: the refusal recorded nothing about `secondEvent`.
  const [afterRefusal] = await repo.cadences.getByQuoteId(quote.id);
  expect(
    afterRefusal.createdByEventId,
    'the refused event id is not recorded — this is the gap, not an accident',
  ).toBe(firstEvent);

  // The first cadence leaves live state, exactly as a `won` in the same held
  // batch would do.
  expect(await repo.cadences.stopWhereLiveByQuoteIds([quote.id], 'won')).toHaveLength(1);

  // Replaying the SECOND event now finds no index covering it: both live indexes
  // are partial on status and the event index has never seen this id. A duplicate
  // cadence is created — the documented edge of the guarantee.
  const duplicate = await repo.cadences.create({
    quoteId: quote.id,
    sm8JobUuid: job,
    anchorAt: new Date(),
    createdByEventId: secondEvent,
  });
  expect(
    duplicate,
    'if this is now [] the gap has been CLOSED — widen the claim in cadences.ts and delete this test',
  ).toHaveLength(1);

  expect(await repo.cadences.getByQuoteId(quote.id)).toHaveLength(2);
});

/**
 * PHASE 12 — THE LEAD CADENCE (D-05/D-19, migration 0039), 2026-10.
 *
 * `createLead` is the ONLY writer of a `kind = 'lead'` row, and three
 * properties are database facts rather than conventions:
 *
 *   1. it needs NO replay key: the widened `cadences_replay_key_present`
 *      admits a lead row (a missed call is not a consumed `quote_opened`) —
 *      while a QUOTE cadence with no event id is still refused, above;
 *   2. `cadences_one_live_per_lead` is its arbiter, NAMED in the statement:
 *      a second live cadence for the same lead inserts nothing (`[]`);
 *   3. `cadences_kind_identity` refuses a lead row that carries a quote.
 */
it('creates a lead cadence with no event id, once per lead, and never with a quote (D-19)', async () => {
  const repo = forTenant(tenantId);
  const leadId = randomUUID();
  const anchorAt = new Date();

  const [lead] = await repo.cadences.createLead({
    leadId,
    contactMobile: '+61491570171',
    anchorAt,
  });
  expect(lead, 'createLead with no created_by_event_id must succeed').toBeTruthy();
  expect(lead.kind).toBe('lead');
  expect(lead.leadId).toBe(leadId);
  expect(lead.quoteId).toBeNull();
  expect(lead.sm8JobUuid).toBeNull();
  expect(lead.createdByEventId).toBeNull();
  expect(lead.status).toBe('active');

  // A SECOND live cadence for the same lead: the named arbiter answers [].
  expect(
    await repo.cadences.createLead({ leadId, contactMobile: '+61491570171', anchorAt }),
    'a live lead cadence exists, so the second createLead must insert nothing',
  ).toEqual([]);

  // A lead cadence is never a "live quote cadence" for the D-08 lookup.
  expect(await repo.cadences.liveQuoteCadenceForMobile('+61491570171')).toEqual([]);

  // And listLive() — the tick's quote reads — does not see it (D-19)…
  expect((await repo.cadences.listLive()).some((c) => c.id === lead.id)).toBe(false);
  // …while an explicit lead read does.
  expect((await repo.cadences.listLive('lead')).some((c) => c.id === lead.id)).toBe(true);

  // The quote path is untouched: a keyless QUOTE create is still refused by
  // the replay key (the CR-01 assertion above, restated beside its widening).
  const keylessQuote = await repo.cadences
    .create({
      quoteId,
      sm8JobUuid: randomUUID(),
      anchorAt: new Date(),
      createdByEventId: null,
    } as unknown as Parameters<typeof repo.cadences.create>[0])
    .then(
      () => null,
      (error: unknown) => error,
    );
  expect(refusalText(keylessQuote)).toMatch(/cadences_replay_key_present/);
});

it('the database refuses a lead cadence that carries a quote (cadences_kind_identity)', async () => {
  const { error } = await admin.from('cadences').insert({
    tenant_id: tenantId,
    kind: 'lead',
    lead_id: randomUUID(),
    quote_id: quoteId,
    sm8_job_uuid: null,
    status: 'stopped',
    stop_reason: 'operator_closed',
    anchor_at: new Date().toISOString(),
  });

  expect(error?.code).toBe('23514');
  expect(error?.message).toContain('cadences_kind_identity');
});

it('finds the newest LIVE QUOTE cadence on a mobile, tenant-scoped (D-08 lookup)', async () => {
  const repo = forTenant(tenantId);
  const [quote] = await seedQuotes(tenantId, [{ job_description: 'd-08 lookup' }]);
  const mobile = '+61491570172';

  expect(await repo.cadences.liveQuoteCadenceForMobile(mobile)).toEqual([]);

  const [created] = await repo.cadences.create({
    quoteId: quote.id,
    sm8JobUuid: randomUUID(),
    anchorAt: new Date(),
    contactMobile: mobile,
    createdByEventId: 900_200_001,
  });
  const [found] = await repo.cadences.liveQuoteCadenceForMobile(mobile);
  expect(found?.id).toBe(created.id);

  await repo.cadences.stopWhereLiveByQuoteIds([quote.id], 'won');
  expect(await repo.cadences.liveQuoteCadenceForMobile(mobile)).toEqual([]);
});
