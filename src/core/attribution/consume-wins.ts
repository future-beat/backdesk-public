/**
 * The SECOND outbox consumer: `quote_status_events` → `quote_attributions`
 * (RPT-01).
 *
 * FRAMEWORK-FREE ON PURPOSE, like the cadence engine's consumer next door.
 * Nothing here imports from `next/*`, and the repository is reached ONLY through
 * the `@/db/repository` barrel — the raw client is banned by ESLint and the ban
 * is what keeps every read on this path tenant-scoped by construction.
 *
 * ── TWO CONSUMERS, ONE STREAM, TWO CURSORS ──────────────────────────────────
 *
 * `event_consumer_cursors` is keyed by consumer NAME, and `registerConsumerCursor`
 * / `advanceTo` have always been name-parameterised: the outbox contract in
 * `src/db/schema/quote-events.ts` was written for a second reader. So this module
 * rides the same ordered stream as `consume-events.ts` at its own pace, under the
 * name `ATTRIBUTION_CONSUMER`.
 *
 * THE TWO CURSORS ARE INDEPENDENT AND MUST STAY SO. The cadence engine can be
 * head-of-line blocked for a week on one client's uninterpretable contact window
 * while attribution keeps billing every other client correctly — and the reverse.
 * THE CADENCE ENGINE'S CONSUMER NAME IS NOT IMPORTED, NOT REFERENCED AND NOT
 * SPELLED ANYWHERE IN THIS FILE — `tests/attribution-consume.test.ts` greps the
 * source for its identifier and requires zero occurrences, so this paragraph
 * describes the constant without naming it on purpose. Sharing a cursor between
 * two consumers does not fail loudly; each would silently skip the events the
 * other consumed, and the skipped ones here are recovered jobs that never reach
 * an invoice.
 *
 * ── THE CONSUMPTION CONTRACT, FOLLOWED CLAUSE BY CLAUSE ─────────────────────
 *
 *   1. REGISTER. `INSERT … ON CONFLICT DO NOTHING` at 0, because "a consumer
 *      that does not exist yet must not silently appear to be up to date". A
 *      brand-new attribution consumer therefore re-reads the whole history —
 *      which is legal and cheap here, because every `won` it re-reads lands on
 *      the D-04 unique index and writes nothing.
 *   2. SCAN FORWARD by `id`, never by `detected_at` or `occurred_at`. A batch of
 *      events written in one transaction shares `now()` to the microsecond, so
 *      ordering on a timestamp is ordering on a tie.
 *   3. ACT AND ADVANCE IN ONE TRANSACTION. The claim and the cursor move commit
 *      together, per contiguous same-tenant run. Advancing separately is how a
 *      consumer skips work after a crash — and a skipped `won` is a recovered
 *      job that never reaches an invoice.
 *
 * ── REPLAY IS LEGAL, AND POSTGRES IS WHAT MAKES IT SAFE ─────────────────────
 *
 * `attributions.claim` is a TARGETLESS `INSERT … ON CONFLICT DO NOTHING
 * RETURNING id` against `quote_attributions_one_per_quote` — the `send_ledger` /
 * `escalations` never-twice shape. Zero rows back means "this quote is already
 * attributed", which is an ANSWER: a rewound cursor, two overlapping ticks, or a
 * reopen → won → reopen → won cycle. The event is still consumed and the cursor
 * still advances. A rewind therefore costs work, not a double-billed job.
 *
 * The claim is TARGETLESS rather than naming the index, following
 * `cadences.create` (03-08, G-3-2): naming the arbiter makes a conflict on any
 * OTHER unique index raise 23505 inside this transaction, which this module
 * reads as a blocked run — and a blocked run holds the shared attribution cursor
 * for every tenant.
 *
 * ── ATTRIBUTION KEYS ON THE EVENT, NEVER ON `cadences.stop_reason` ───────────
 *
 * A win is a `won` row in the outbox. It is NOT "the cadence whose stop_reason
 * is 'won'", and the difference is not academic: the cadence engine is a
 * separate consumer with a separate cursor, so when this pass sees the win the
 * cadence may not have been stopped yet — or may never be, if that tenant's
 * cadence consumption is head-of-line blocked. Keying on `stop_reason` would
 * make attribution silently inherit the cadence engine's outages. The stop
 * reason rides along in `evidence.cadences[].stopReason` as CONTEXT, and nothing
 * branches on it.
 *
 * ── WHAT IT REFUSES TO CREDIT ───────────────────────────────────────────────
 *
 * A `won` with no qualifying touch inside the D-01 window writes NO ROW and
 * advances the cursor: `attributionsUnqualified`. Most wins are jobs the tradie
 * closed themselves, and claiming those is exactly how a recovered-revenue
 * report becomes a document the client disproves from their own books.
 *
 * A win the outbox never emitted cannot be attributed at all — there is no other
 * path to a row. That is what keeps the 90-day connect-time backfill (which
 * emits no events, by design) out of the first invoice.
 *
 * ── HEAD-OF-LINE: ONE CLIENT'S BAD ROW MUST NOT WEDGE FOURTEEN ──────────────
 *
 * The cursor is ONE number over a stream that interleaves tenants, while every
 * write is tenant-scoped. So "act and advance together" can only mean: advance
 * to the last event of a run whose writes all just committed. Events are walked
 * in `id` order and chunked into maximal same-tenant runs; each run is one
 * transaction ending in one advance.
 *
 * A RUN THAT THROWS STOPS THE CURSOR RATHER THAN BEING SKIPPED. Advancing past
 * a failed run would strand its `won` events behind a position that has already
 * passed them, and no later tick would ever look at them again — a recovered
 * job silently absent from every invoice thereafter. But "stop the cursor" and
 * "stop the scan" are two different statements here:
 *
 *   THE CURSOR STOPS. Once any run throws, `cursorHeld` is set and no later run
 *   advances the shared position. Nothing is ever stepped over.
 *
 *   THE BLOCKED TENANT'S OWN LATER RUNS ARE SKIPPED ENTIRELY, because their
 *   events sit behind a position that cannot move past the failure anyway.
 *
 *   THE SCAN CONTINUES FOR OTHER TENANTS. Their runs commit their attributions
 *   with NO advance, so this minute's wins are recorded now and the same events
 *   are simply re-read next tick. AND THAT IS ONLY SAFE BECAUSE OF THE UNIQUE
 *   INDEX: a re-read run is a sequence of zero-row claims, so the cost is
 *   repeated work rather than a second row on a second invoice. Head-of-line
 *   tolerance and never-twice are the same mechanism seen from two directions.
 *
 * ── PITFALL 7, ACCEPTED BY DESIGN: DELIVERY STATE IS FROZEN AT CONSUMPTION ───
 *
 * `qualifiesAsTouch` counts a touch whose delivery receipt has not arrived yet
 * (D-02: "an SMS with a pending receipt counts"), and this pass runs within a
 * minute of the win while carrier receipts arrive minutes to hours later. So a
 * touch counted as qualifying here CAN be reported `undelivered` two seconds
 * afterwards — and the row stands.
 *
 * That is a decision, not an oversight. The evidence chain records
 * `evidence.ledger[].deliveryStatus` exactly as it stood at consumption; the
 * report's methodology footnote says "delivery as known at the time of
 * attribution"; and there is NO re-check and NO update path anywhere in this
 * codebase — `forTenant().attributions` exposes no `update` and no `delete`,
 * and neither may ever be added. A pending receipt that later reports
 * `undelivered` does not reopen the row.
 *
 * The alternative is a row whose value changes after a client has been invoiced
 * from it, which is strictly worse than a row that is occasionally generous by
 * one touch in a way its own evidence chain admits to out loud.
 *
 * ── WHAT THE LOG MAY SAY, AND IT IS TWO SENTENCES ───────────────────────────
 *
 * There are exactly TWO error logs in this file. One interpolates a tenant id
 * (the blocked run), the other an event id (the quarantined decision). THE
 * CAUGHT VALUE IS NEVER LOGGED in either — not its message, not its stack, not
 * its `code`. A driver error carries the failing statement, and this
 * statement's parameters are a client's job description, their customer's reply
 * labels and a dollar figure. An id is enough to find the row and nothing
 * more, and Vercel's log is not a place a mistake can be deleted from.
 *
 * ── TRANSIENT HOLDS THE CURSOR; DETERMINISTIC IS QUARANTINED ────────────────
 *
 * The head-of-line design above answers a TRANSIENT failure — a deadlock, a
 * statement timeout, a pooler reset — and its answer is correct: hold, retry
 * next tick. It has no answer for a failure that will recur identically no
 * matter how often it is retried, and `decideAttribution` is pure, so a throw
 * from it is exactly that. Retrying one forever holds the shared cursor for
 * every tenant behind it, permanently, while looking indistinguishable from a
 * quiet month.
 *
 * So the two are separated at the narrowest boundary that can tell them apart:
 * the pure decision is wrapped, and ONLY the pure decision. The six reads that
 * feed it and the claim that follows it stay outside, keeping their existing
 * hold-the-cursor behaviour. A quarantined event is consumed WITHOUT a row —
 * nothing is billed from a decision that could not be made — and counted as
 * `attributionsPoisoned`, which the 06:30 digest names out loud so the
 * quarantine is a signal and not a silent drop.
 *
 * ── WHAT THE CALLER MUST STILL DO ───────────────────────────────────────────
 *
 * Authorize, and DECIDE TO RUN AT ALL. `runCadenceTick` defaults its
 * `attribution` seam to `'skip'`, because this function is reachable from every
 * remote suite against the hosted Sydney database and a first registration at 0
 * would drain every real client's won history into `quote_attributions`. The
 * route is the composition root that passes `'run'`.
 */
import { ATTRIBUTION_CONSUMER } from '@/core/cadence/constants';
import {
  forAllTenants_pendingQuoteEvents,
  forTenant,
  listEscalationsForQuote,
  registerConsumerCursor,
  type EscalationEvidence,
  type TenantScopedRepository,
} from '@/db/repository';
import type { QuoteStatusEvent } from '@/db/schema';

import { decideAttribution } from './decide';
import { isLeadBornJob } from './lead-born';

/**
 * How many events one attribution pass consumes.
 *
 * NOT A PERFORMANCE KNOB, exactly as `CONSUME_BATCH_LIMIT` is not: it bounds the
 * work of a single transaction, so a consumer registering for the first time
 * against months of history makes steady progress instead of opening one
 * enormous transaction that rolls back in full on any error. The number matches
 * the cadence engine's on purpose — two consumers walking one stream at
 * different batch sizes would make "how far behind is attribution" a question
 * with two different units.
 */
export const ATTRIBUTION_BATCH_LIMIT = 200;

/**
 * Counts and one position — no client names, no quote ids, no dollar figures.
 *
 * This result is enumerated into the tick route's HTTP response, which reaches
 * `cron.job_run_details` and the Vercel log: surfaces that are lower-trust than
 * the database and that nobody can delete a row out of (T-3-24, T-7-14).
 */
export interface ConsumeWonEventsResult {
  /** Events walked past, of EVERY type — not just `won`. */
  eventsConsumed: number;
  /** Rows actually written. Zero-row claims (replay, second win) are excluded. */
  attributionsRecorded: number;
  /**
   * Wins with no qualifying touch inside the D-01 window — jobs the tradie
   * closed himself. THE HEALTHY MAJORITY, not an error rate: a number that
   * dropped to zero would mean the qualifying predicate had stopped filtering.
   */
  attributionsUnqualified: number;
  /**
   * Rows recorded with `value_source = 'missing'` (RESEARCH Pitfall 8) — the
   * quote mirror was gone or its total would not parse, so the touches are
   * evidence and the DOLLAR figure is unknown. Counted separately because the
   * operator has to price those lines by hand before the invoice goes out.
   */
  attributionsValueMissing: number;
  /**
   * Wins whose DECISION threw and were stepped over rather than retried forever.
   *
   * A DETERMINISTIC FAILURE IS A BUG, AND THIS IS HOW IT SURFACES. `decideAttribution`
   * is pure, so an event it threw on once it will throw on every tick; holding
   * the shared cursor for it stops attribution for every other client too. The
   * event is consumed without a row — nothing is billed from a decision that
   * could not be made — and this count is what the 06:30 digest names so the
   * quarantine is a signal rather than a silent drop.
   *
   * DISTINCT FROM `attributionsUnqualified`, which is the healthy majority: a
   * win with no qualifying touch is an answer, this is the absence of one.
   */
  attributionsPoisoned: number;
  /** Where the attribution cursor stands after this pass. */
  cursorAt: number;
  /**
   * Tenants whose run could not finish — a transaction that threw, or an
   * evidence chain that would not validate.
   *
   * A NON-ZERO VALUE MEANS THE SHARED ATTRIBUTION CURSOR DID NOT ADVANCE. It is
   * the one number that tells a wedged pass apart from a quiet one, which
   * otherwise look identical: all zeros.
   */
  tenantsBlocked: number;
}

const ZERO_RESULT = (cursorAt: number): ConsumeWonEventsResult => ({
  eventsConsumed: 0,
  attributionsRecorded: 0,
  attributionsUnqualified: 0,
  attributionsValueMissing: 0,
  attributionsPoisoned: 0,
  cursorAt,
  tenantsBlocked: 0,
});

/**
 * What an attribution pass that could not run AT ALL reports.
 *
 * Exported so the tick's `'skip'` branch and its catch report the shape rather
 * than inventing one — a second literal is a second place a field added to
 * `ConsumeWonEventsResult` can be forgotten.
 *
 * `cursorAt: 0` IS NOT A CLAIM THAT THE CURSOR SITS AT ZERO. It is the absence
 * of a reading, which is exactly what a pass that declined to register has. That
 * distinction is what makes `attributionCursorAt: 0` pinnable in the tick's
 * all-zero test: the zero is a property of the CALL, not of the shared database.
 */
export const NO_ATTRIBUTION: ConsumeWonEventsResult = Object.freeze(ZERO_RESULT(0));

/** Maximal runs of consecutive events belonging to the same tenant. */
function contiguousRuns(events: readonly QuoteStatusEvent[]): QuoteStatusEvent[][] {
  const runs: QuoteStatusEvent[][] = [];

  for (const event of events) {
    const current = runs[runs.length - 1];
    if (current && current[0].tenantId === event.tenantId) {
      current.push(event);
    } else {
      runs.push([event]);
    }
  }

  return runs;
}

/** What one contiguous same-tenant run did. */
interface RunOutcome {
  consumed: number;
  recorded: number;
  unqualified: number;
  valueMissing: number;
  /** Events whose DECISION threw and can therefore never succeed. See `attributeWonEvent`. */
  poisoned: number;
  /** The last event id this run committed work for. 0 = nothing to advance to. */
  advancedTo: number;
}

/**
 * Decide and record ONE `won` event, inside the run's transaction.
 *
 * THE READS ARE ALL TENANT-PINNED, AND ALL FIVE GO THROUGH `tx` — so they see
 * this transaction's own view. The escalation evidence is NOT read here: it is
 * handed in, already fetched by the caller BEFORE the transaction opened.
 *
 * That hoist is 07 WR-02. `escalations` lives outside `forTenant()` (it carries
 * `tenant_id` as a column with no foreign key), so reading it took a SECOND
 * pool connection while this run already held one — and `max: 5` in
 * `src/db/repository/client.ts` is a ceiling on concurrency, not a hint. Two
 * connections per in-flight run against a five-connection pool shared with the
 * console and the per-minute tick is a starvation deadlock waiting for a quiet
 * afternoon. Reading it outside the transaction remains correct for the reason
 * it always was: nothing in this pass writes `escalations`, so there is no
 * write it could fail to see.
 *
 * THE CONTACT NAME COMES FROM THE NEWEST CADENCE. `cadences.getByQuoteId`
 * returns every cadence the quote has ever had, `created_at DESC` — a reopened
 * quote has more than one — and the newest is the chase that was running when
 * the win landed. `decideAttribution` applies `firstNameOf` to it; the full name
 * never enters the row.
 */
async function attributeWonEvent(
  tx: TenantScopedRepository,
  event: QuoteStatusEvent,
  escalations: readonly EscalationEvidence[],
  outcome: RunOutcome,
): Promise<void> {
  const ledger = await tx.ledger.listForQuote(event.quoteId);
  const [quote] = await tx.quotes.byId(event.quoteId);
  const [connection] = await tx.connection.get();
  const inbound = await tx.inbound.listThreadedForQuote(event.quoteId);
  const cadences = await tx.cadences.getByQuoteId(event.quoteId);
  // D-06 (Phase 14): a lead-born job is counted in leads-to-jobs and NEVER
  // billed in v1.2 — our tap created it, or the tradie booked the caller
  // himself. Asked HERE, a read beside the others and outside the quarantine,
  // and answered before the decision runs, whatever the ledger holds. Not in
  // `qualifyingTouches`: its SQL twins feed the live metrics and must stay
  // byte-equivalent to it. Keyed on the lead linkage, never on the mirror's
  // provenance column.
  const leadLinks = await tx.leads.linkedToJob(event.sm8JobUuid);
  if (isLeadBornJob(leadLinks)) {
    outcome.unqualified += 1;
    console.log(
      `[attribution] event ${String(event.id)} is on a lead-born job (lead_born); unqualified, nothing billed.`,
    );
    return;
  }

  // ── THE QUARANTINE, AND WHY IT IS EXACTLY THIS NARROW ──────────────────────
  //
  // `decideAttribution` is PURE. Given these same six reads it throws the same
  // way on every tick, forever — an evidence chain that will not validate, or a
  // baseline outside 0..100% making `conservativeCents` raise `InvalidMoneyError`.
  // Left to propagate, that throw reaches the run-level catch, which reads it as
  // a blocked run and holds the SHARED cursor behind it. The next tick re-reads
  // the same event and throws again. Nothing steps over it, so all attribution
  // for every tenant behind that position stops permanently — and the failure
  // looks exactly like a quiet month.
  //
  // So a deterministic failure is quarantined at the EVENT and the stream keeps
  // moving. Note what is deliberately OUTSIDE this try: the six reads above and
  // the `claim` write below. A deadlock, statement timeout or pooler reset is a
  // TRANSIENT failure that will succeed on retry, and those must keep their
  // existing head-of-line behaviour — hold the cursor, try again next tick.
  // Widening this catch to cover the write would step over a failed INSERT.
  //
  // THE CAUGHT VALUE IS NOT LOGGED, for the reason the run-level catch gives:
  // the inputs here are a client's job description and their customer's reply
  // labels. The count travels instead, and `attributionsPoisoned` is what the
  // 06:30 digest names.
  let decision: ReturnType<typeof decideAttribution>;
  try {
    decision = decideAttribution({
      // `detectedAt` — WHEN WE NOTICED, never `occurred_at` (what ServiceM8
      // claims about its own clock). D-01's window is anchored on our own
      // committed record, which is the only timestamp we can defend.
      event: { id: event.id, quoteId: event.quoteId, detectedAt: event.detectedAt },
      ledger,
      // `?? null` rather than the row: "no quote row" and "a total that would not
      // parse" are the same missing figure, and `decideAttribution` owns that call.
      quote: quote ?? null,
      connection: connection ?? null,
      inbound,
      escalations,
      cadences,
      contactName: cadences[0]?.contactName ?? null,
    });
  } catch {
    console.error(
      `[attribution] event ${String(event.id)} cannot be decided and was quarantined; ` +
        'the cursor advances past it. This is a bug to fix, not a transient fault.',
    );
    // Consumed, NOT recorded. No row is written, so nothing is billed from a
    // decision that could not be made — and the cursor is free to advance.
    outcome.poisoned += 1;
    return;
  }

  if (decision.kind === 'unqualified') {
    outcome.unqualified += 1;
    return;
  }

  const { row } = decision;

  // The 07-02 shape onto the 07-01 insert, field by field. NO SPREAD: a value
  // added to `AttributionRowValues` must be typed here before it can reach a
  // column, and a column added to the table must be given a value here before
  // this compiles. The two halves check each other.
  const inserted = await tx.attributions.claim({
    quoteId: row.quoteId,
    sm8JobUuid: row.sm8JobUuid,
    wonEventId: row.wonEventId,
    wonDetectedAt: row.wonDetectedAt,
    firstTouchClaimedAt: row.firstTouchClaimedAt,
    lastTouchClaimedAt: row.lastTouchClaimedAt,
    qualifyingTouchCount: row.qualifyingTouchCount,
    grossCents: row.grossCents,
    conservativeCents: row.conservativeCents,
    valueSource: row.valueSource,
    baselineRateBp: row.baselineRateBp,
    baselineSource: row.baselineSource,
    baselineSample: row.baselineSample,
    windowDays: row.windowDays,
    // Already validated by `attributionEvidenceSchema.parse` inside
    // `decideAttribution` — a chain that cannot describe itself throws there
    // rather than reaching a column an invoice is read from.
    evidence: row.evidence,
  });

  // ZERO ROWS IS AN ANSWER, NOT A FAILURE. Postgres refused because this quote
  // already has an attribution: a replayed event, an overlapping tick, or a
  // second `won` after a reopen. Consumed, not recorded — and the FIRST row
  // stands, with the figures and the evidence it was written with.
  if (inserted.length === 0) return;

  outcome.recorded += 1;
  if (row.valueSource === 'missing') outcome.valueMissing += 1;
}

/**
 * Every `won` event's escalation evidence, keyed by quote — read on the POOL,
 * before the run's transaction opens (07 WR-02).
 *
 * SEQUENTIAL, NOT `Promise.all`. The pool ceiling is five and this loop is
 * unbounded in the length of a run; a parallel batch here would trade one
 * deadlock for another. Distinct quote ids only, because a reopened quote can
 * produce two `won` events in the same run and they share one answer.
 */
async function escalationsForRun(
  events: readonly QuoteStatusEvent[],
): Promise<Map<string, EscalationEvidence[]>> {
  const tenantId = events[0].tenantId;
  const byQuote = new Map<string, EscalationEvidence[]>();

  for (const event of events) {
    if (event.eventType !== 'won' || byQuote.has(event.quoteId)) continue;
    byQuote.set(event.quoteId, await listEscalationsForQuote(tenantId, event.quoteId));
  }

  return byQuote;
}

/**
 * One contiguous same-tenant run = one transaction ending in one advance.
 *
 * `advanceCursor` IS THE CALLER'S HEAD-OF-LINE FLOOR, and it is false for every
 * run that follows a blocked one. The run still commits its writes — those are
 * this tenant's attributions, and withholding them punishes the wrong client —
 * but the shared position stays behind the blocked events, so nothing is stepped
 * over and the next tick re-reads this run. Replay is a sequence of zero-row
 * claims by construction, so the cost is repeated work rather than repeated
 * effect. THAT IS THE WHOLE REASON THIS DESIGN IS SAFE, and it is why the
 * never-twice index has to be a database fact rather than a convention.
 *
 * EVERY EVENT ADVANCES, including the four types this consumer does nothing
 * with. `lost`, `removed`, `reopened` and `quote_opened` are not attribution
 * signals; walking past them is the correct action, and a consumer that stopped
 * at an event it has no work for would wedge on the first one.
 */
async function consumeRun(
  events: readonly QuoteStatusEvent[],
  advanceCursor: boolean,
  escalationsByQuote: ReadonlyMap<string, EscalationEvidence[]>,
): Promise<RunOutcome> {
  const tenantId = events[0].tenantId;

  return forTenant(tenantId).transaction(async (tx) => {
    const outcome: RunOutcome = {
      consumed: 0,
      recorded: 0,
      unqualified: 0,
      valueMissing: 0,
      poisoned: 0,
      advancedTo: 0,
    };

    for (const event of events) {
      if (event.eventType === 'won') {
        await attributeWonEvent(tx, event, escalationsByQuote.get(event.quoteId) ?? [], outcome);
      }

      outcome.consumed += 1;
      outcome.advancedTo = event.id;
    }

    // STILL IN THE SAME TRANSACTION AS THE WRITES IT ACCOUNTS FOR — the clause
    // of the consumption contract that survives everything else. `advanceCursor`
    // only ever withholds the advance; it never moves it independently, and the
    // repository's never-rewind guard (`WHERE last_event_id < $to`) refuses to
    // move backwards even if a slow pass finishes after a fast one.
    if (advanceCursor && outcome.advancedTo > 0) {
      await tx.consumerCursor.advanceTo(ATTRIBUTION_CONSUMER, outcome.advancedTo);
    }

    return outcome;
  });
}

export interface ConsumeWonEventsOptions {
  /** Events scanned per pass; see `ATTRIBUTION_BATCH_LIMIT`. */
  batchLimit?: number;
}

/**
 * Read the cursor, attribute what is past it, advance it — once per tick.
 *
 * NOTE WHAT IS ABSENT: a clock. D-01's anchor is each EVENT's own `detected_at`,
 * a value already committed by the sync path, so a caller-supplied `now` could
 * only be used to overrule the database's record of when we noticed — which is
 * the one thing a window this bills on must never be relative to.
 */
export async function consumeWonEvents(
  options: ConsumeWonEventsOptions = {},
): Promise<ConsumeWonEventsResult> {
  const { batchLimit = ATTRIBUTION_BATCH_LIMIT } = options;

  const cursor = await registerConsumerCursor(ATTRIBUTION_CONSUMER);
  const pending = await forAllTenants_pendingQuoteEvents(cursor, batchLimit);
  if (pending.length === 0) return ZERO_RESULT(cursor);

  const result = ZERO_RESULT(cursor);

  /** Tenants whose run could not finish. Their LATER runs are not attempted. */
  const blockedTenants = new Set<string>();
  /** Once true, the shared position is frozen: no later run may advance it. */
  let cursorHeld = false;

  for (const run of contiguousRuns(pending)) {
    const tenantId = run[0].tenantId;

    // ORDER WITHIN A TENANT CARRIES MEANING, even here where every action is
    // idempotent: this tenant already has an unconsumed event ahead of these,
    // and the cursor cannot be advanced past it, so acting on these now would
    // be work the next tick has to redo anyway.
    if (blockedTenants.has(tenantId)) continue;

    // A THROW IS A BLOCKED RUN, NOT A FAILED PASS. Everything reachable here is
    // reachable in production: a deadlock or statement timeout inside the run
    // transaction, a pooler reset, or `attributionEvidenceSchema.parse`
    // refusing a chain that cannot describe itself. Left unguarded, any one of
    // them propagates out of the whole tick.
    //
    // THE CAUGHT VALUE IS DELIBERATELY NOT LOGGED, and this is the sharpest
    // instance of that rule in the codebase: a driver error carries the failing
    // statement, and this statement's parameters are a client's job description,
    // their customer's reply labels and a dollar figure. The tenant id is the
    // only variable in the message — enough to find the row, and nothing more.
    let outcome: RunOutcome;
    try {
      // BEFORE THE TRANSACTION OPENS, AND IN SEQUENCE (07 WR-02). `escalations`
      // lives outside `forTenant()`, so reading it per-event inside the run
      // used to take a second pool connection while the run already held one.
      // Against `max: 5`, shared with the console and the per-minute tick, that
      // is a starvation deadlock. Same number of round trips, none of them
      // overlapping a held transaction.
      //
      // INSIDE THE TRY on purpose: a failed escalation read is a transient
      // database fault, and the correct answer to one is still to hold the
      // cursor and retry next tick.
      const escalationsByQuote = await escalationsForRun(run);
      outcome = await consumeRun(run, !cursorHeld, escalationsByQuote);
    } catch {
      console.error(
        `[attribution] consumption threw for tenant ${tenantId}; the cursor is held ` +
          'behind this run and this tenant is skipped for the rest of the pass.',
      );
      outcome = {
        consumed: 0,
        recorded: 0,
        unqualified: 0,
        valueMissing: 0,
        poisoned: 0,
        advancedTo: 0,
      };
      blockedTenants.add(tenantId);
      cursorHeld = true;
      result.tenantsBlocked = blockedTenants.size;
    }

    result.eventsConsumed += outcome.consumed;
    result.attributionsRecorded += outcome.recorded;
    result.attributionsUnqualified += outcome.unqualified;
    result.attributionsValueMissing += outcome.valueMissing;
    result.attributionsPoisoned += outcome.poisoned;
    if (!cursorHeld && outcome.advancedTo > 0) result.cursorAt = outcome.advancedTo;
  }

  return result;
}
