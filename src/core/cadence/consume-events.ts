/**
 * The outbox consumer: `quote_status_events` → cadences (CAD-01).
 *
 * FRAMEWORK-FREE ON PURPOSE. Nothing here imports from `next/*`. The rule this
 * module encodes is a fact about the business — a triaged quote gets chased —
 * not about a request handler, and the tick route is only one of the places that
 * will drive it.
 *
 * ── THE CONSUMPTION CONTRACT, FOLLOWED LITERALLY ────────────────────────────
 *
 * `src/db/schema/quote-events.ts` states it and this file obeys it clause by
 * clause:
 *
 *   1. REGISTER. `INSERT INTO event_consumer_cursors (consumer, last_event_id)
 *      VALUES ('cadence-engine', 0) ON CONFLICT DO NOTHING` — no row is seeded
 *      upstream, because "a consumer that does not exist yet must not silently
 *      appear to be up to date". The statement itself lives in
 *      `src/db/repository/consumer-cursor.ts` (the raw client is banned here by
 *      ESLint); the ON CONFLICT is what makes two ticks starting at once produce
 *      one cursor at 0 rather than an error.
 *   2. SCAN FORWARD by `id`, never by a timestamp, bounded by a batch limit.
 *   3. ACT AND ADVANCE IN ONE TRANSACTION. The cursor moves in the SAME
 *      transaction as the writes it accounts for, so a crash rolls back both.
 *      Advancing separately is how a consumer skips work after a crash.
 *
 * REPLAY IS LEGAL, so every action here is idempotent by construction rather
 * than by care: cadence creation is TARGETLESS `ON CONFLICT DO NOTHING` against
 * BOTH unique indexes on `cadences` — `cadences_one_live_per_quote` (partial,
 * refuses a second LIVE cadence for the quote) and
 * `cadences_one_per_opened_event` (plain, refuses a second cadence from the SAME
 * consumed event, at any status) — and returns zero rows when either refuses;
 * touch materialization is `ON CONFLICT DO NOTHING` on
 * `(cadence_id, touch_number)`; the cursor advance refuses to move backwards.
 * A rewound cursor therefore costs work, not correctness.
 *
 * BOTH indexes are load-bearing and neither subsumes the other (G-3-2). Under
 * the head-of-line rule below the shared cursor HOLDS, so the same
 * `quote_opened` is re-read every tick — and by then its cadence may have left
 * live state, where the partial index covers nothing. Without the event-id
 * unique that replay created a duplicate cadence per tick, worst case an ACTIVE
 * one that re-chases the customer from touch 1. A FRESH `quote_opened` (new
 * bigserial id, from the reopen → re-triage flow) still creates, which is the
 * sequential-cadence history `cadences.ts` deliberately permits.
 *
 * ── THE UNIT OF WORK IS A CONTIGUOUS SAME-TENANT RUN ────────────────────────
 *
 * The cursor is ONE number over a stream that interleaves tenants, while the
 * actions are tenant-scoped — so "act and advance together" can only mean:
 * advance to the last event of a run whose actions all just committed. Events
 * are therefore walked in `id` order and chunked into maximal runs of the same
 * tenant; each run is one transaction ending in one advance. In the ordinary
 * case (a batch from one client) that is a single transaction. What it never is
 * is an advance past an event some other transaction still owes work for.
 *
 * A run that fails STOPS THE CURSOR rather than being skipped. Head-of-line
 * blocking is the correct behaviour for an ordered position: advancing past a
 * failed run would strand its events behind a cursor that has already passed
 * them, and no later tick would ever look at them again.
 *
 * ── BUT THE CURSOR IS SHARED, AND ONE CLIENT MAY NOT WEDGE FOURTEEN ─────────
 *
 * `event_consumer_cursors` holds ONE position across every client, so "stop the
 * cursor" and "stop the scan" used to be the same statement — and that made one
 * tenant's uninterpretable contact window halt `won`, `lost`, `removed` and
 * `reopened` consumption for everybody, indefinitely. A `won` that cannot be
 * consumed is a cadence that keeps chasing a job the tradie already got, which
 * is the single worst message this product can send.
 *
 * They are now two different statements:
 *
 *   THE CURSOR STOPS. Once any run blocks, no later run advances the shared
 *   position. Nothing is ever stepped over — the blocked events are still ahead
 *   of the cursor and the next tick re-reads them.
 *
 *   THE SCAN CONTINUES, for OTHER tenants. Their runs commit their writes with
 *   no advance, so the stops land now and the same events are simply re-read
 *   next tick. That costs repeated work and no correctness: replay is legal
 *   here by construction (see above), so a re-read run is a sequence of
 *   zero-row no-ops.
 *
 *   THE BLOCKED TENANT'S OWN LATER RUNS ARE SKIPPED, and that is not an
 *   optimisation. Order within a tenant carries meaning — consuming a `won`
 *   while the `quote_opened` before it is still unconsumed would let the next
 *   tick create the cadence the stop was supposed to end.
 *
 * ── THE FULL FIVE-EVENT VOCABULARY, AS OF PLAN 03-03 ────────────────────────
 *
 * The tracer (03-02) handled `quote_opened` only, and STOPPED the scan at the
 * first event of any other type rather than advancing past a signal that stops a
 * cadence. That guard — `HANDLED_EVENT_TYPES` and the prefix loop — IS GONE FROM
 * THIS COMMIT. All five members of `QUOTE_EVENT_TYPES` are now acted on and the
 * cursor advances through every one of them:
 *
 *   quote_opened → create a cadence (four shapes, all of them consuming)
 *   won / lost   → stop the live cadence with that reason, skip its unsent
 *                  touches `quote_closed`
 *   removed      → the same shape, stop reason `removed` (D-08)
 *   reopened     → stop the live cadence AND return the quote to operator
 *                  triage, in ONE transaction (D-08)
 *
 * THE STOPS ARE DERIVED FROM `transitions.ts`, NOT RESTATED HERE. The stop
 * reason for each closing event is what `cadenceTransition` prescribes, resolved
 * once at module load; the matrix suite proves the same answer comes back from
 * `active` and from both pauses, which is what makes a single guarded UPDATE
 * over every live cadence correct without first reading each row's status.
 *
 * REPLAY OF A STOP IS A ZERO-ROW NO-OP, by the same mechanism as everything else
 * here: `WHERE status IN ('active','paused')` on the UPDATE. A re-consumed `won`
 * matches nothing, so it cannot overwrite the reason a cadence actually stopped
 * for — the column Phase 7 attributes recovered revenue on.
 *
 * ── WHAT THE CALLER MUST STILL DO ───────────────────────────────────────────
 *
 * Authorize. This function is service-role code driven by a protected route; it
 * has no opinion about who invoked it. And note what it does NOT do: it never
 * sends anything. The outbox "says what happened, not whether we may act" — every
 * permission question belongs to `dispatch.ts`, re-asked inside the claim.
 */
import {
  forAllTenants_cadenceTick,
  forAllTenants_pendingQuoteEvents,
  forTenant,
  registerConsumerCursor,
  type CadenceTickTenant,
  type SuppressionProbe,
  type TenantScopedRepository,
} from '@/db/repository';
import type { QuoteStatusEvent } from '@/db/schema';
import type { TouchChannel } from '@/db/schema/cadence-templates';
import type { TouchSkipReason } from '@/db/schema/cadence-touches';
import {
  ONBOARDING_PAUSE_REASON,
  type CadenceStopReason,
} from '@/db/schema/cadences';
import { QUOTE_EVENT_TYPES, type QuoteEventType } from '@/db/schema/quote-events';
import {
  onboardingComplete,
  readOnboardingConditions,
} from '@/core/drafting/onboarding-gate';

import {
  CADENCE_CONSUMER,
  DEFAULT_PREFERRED_SEND_TIME,
  DEFAULT_TOUCH_OFFSET_DAYS,
} from './constants';
import { randomJitterMinutes } from './jitter';
import { materializeCadenceSchedule, type MaterializeTemplate } from './materialize';
import { selectPrimaryContact, type PrimaryContact } from './primary-contact';
import { cadenceTransition, type CadenceEvent } from './transitions';
import {
  InvalidContactWindowError,
  NoAllowedContactDayError,
  type ContactWindow,
} from './window';

/**
 * How many events one tick consumes.
 *
 * NOT A PERFORMANCE KNOB (the accessor's own header says so): it bounds the work
 * of a single transaction, so a consumer registering for the first time against
 * months of history makes steady progress instead of opening one enormous
 * transaction that rolls back in full on any error.
 */
export const CONSUME_BATCH_LIMIT = 200;

/** The four outbox events that close a live cadence. `quote_opened` opens one. */
type ClosingEventType = Exclude<QuoteEventType, 'quote_opened'>;

/**
 * The cadence-machine event each closing outbox event means.
 *
 * WRITTEN OUT RATHER THAN PASSED THROUGH, even though the four names are
 * identical on both sides. That identity is a design decision recorded in
 * `CADENCE_EVENTS` (the vocabularies were deliberately aligned), not a
 * coincidence to lean on: a rename on either side must break the build here
 * rather than quietly stop matching and therefore quietly stop nothing.
 */
const CADENCE_EVENT_FOR: Readonly<Record<ClosingEventType, CadenceEvent>> = {
  won: 'won',
  lost: 'lost',
  removed: 'removed',
  reopened: 'reopened',
};

/**
 * Ask the state machine, once, at module load.
 *
 * RESOLVED HERE AND NOT PER EVENT so that a matrix which ever stopped
 * prescribing a stop for one of these events fails at import — in CI, in a
 * deploy, in a test run — rather than inside a transaction with a real customer
 * at the other end of it. The stop reason is never restated as a literal in this
 * file: `transitions.ts` is the single place the answer lives, and
 * `tests/cadence-transitions.test.ts` is where each answer was decided.
 */
function stopReasonFor(eventType: ClosingEventType): CadenceStopReason {
  const outcome = cadenceTransition(
    { status: 'active', pauseReason: null },
    CADENCE_EVENT_FOR[eventType],
  );

  if (outcome.kind !== 'move' || outcome.stopReason === null) {
    throw new Error(
      `cadenceTransition prescribes no stop for '${eventType}'; the cadence engine ` +
        'cannot consume closing events safely and must not start.',
    );
  }

  return outcome.stopReason;
}

const STOP_REASON_FOR: Readonly<Record<ClosingEventType, CadenceStopReason>> = {
  won: stopReasonFor('won'),
  lost: stopReasonFor('lost'),
  removed: stopReasonFor('removed'),
  reopened: stopReasonFor('reopened'),
};

/**
 * Why the stopped cadence's unsent touches were skipped — and the two answers
 * are not interchangeable, because Phase 7 reads this column as evidence.
 *
 * `quote_closed` says the QUOTE stopped being an open, chase-eligible Quote,
 * which is exactly what a won or lost job did.
 *
 * `cadence_stopped` says the CADENCE reached a terminal state first, which is
 * the honest description for the other two: a `reopened` quote is still very
 * much an open `Quote` row (that is the whole point of a reopen), so
 * `quote_closed` would be a false statement; and a `removed` job did not close,
 * it ceased to exist upstream. Writing a reason that did not decide the skip
 * merely to reuse a nicer-sounding label is the thing 03-02 refused to do and
 * this file will not start doing.
 */
const SKIP_REASON_FOR: Readonly<Record<ClosingEventType, TouchSkipReason>> = {
  won: 'quote_closed',
  lost: 'quote_closed',
  removed: 'cadence_stopped',
  reopened: 'cadence_stopped',
};

/**
 * Is this a member of the outbox vocabulary at all?
 *
 * UNREACHABLE BY CONSTRUCTION — `quote_status_events.event_type` is
 * CHECK-constrained to `QUOTE_EVENT_TYPES`. It exists so that a SIXTH event type
 * added by a later phase and not wired in here stops the scan loudly instead of
 * being consumed by falling off the end of a switch. Note the difference from
 * the tracer guard this replaces: that one blocked on types this build KNEW
 * about and had not implemented, which was a planned, temporary state. This one
 * can only fire on a type nothing in this codebase has ever heard of.
 */
function isKnownEventType(eventType: string): eventType is QuoteEventType {
  return (QUOTE_EVENT_TYPES as readonly string[]).includes(eventType);
}

/**
 * NOTE WHAT IS ABSENT: a clock.
 *
 * Every other entry point in this engine takes an injectable `now`, and this one
 * deliberately does not, because there is nothing here for it to pin. D-01's
 * anchor is the EVENT's own `detected_at` — a value already committed by the
 * sync path — so a caller-supplied `now` could only be used to overrule the
 * database's record of when we noticed, which is the exact mistake Pitfall 1
 * describes from the other direction. Dispatch is where the clock matters,
 * because "is this touch due" is a question about the present.
 */
export interface ConsumeQuoteEventsOptions {
  batchLimit?: number;
  /** Injected RNG (minutes). Defaults to a draw in [0, JITTER_MAX_MINUTES]. */
  jitterMinutes?: () => number;
}

/**
 * Counts only — no client names, no quote descriptions, no addresses. This
 * result is rendered into the tick route's HTTP response, which is the one
 * output of this system that is not behind RLS.
 */
export interface ConsumeQuoteEventsResult {
  eventsConsumed: number;
  cadencesCreated: number;
  /** Cadences that reached `stopped` in this pass — at creation or by an event. */
  cadencesStopped: number;
  /** D-08 reopen triage: quotes returned to the operator's review queue. */
  quotesFlaggedForReview: number;
  /** Events whose tenant has no connection row — see `consumeRun`. */
  eventsSkipped: number;
  /**
   * Tenants whose consumption could not finish this pass — a contact-hours
   * configuration the engine refuses to interpret, an event type nothing has
   * heard of, or a run transaction that threw.
   *
   * A NON-ZERO VALUE MEANS THE SHARED CURSOR DID NOT ADVANCE. It is the one
   * number that tells a wedged tick apart from a quiet one: without it the
   * response body reads `eventsConsumed: 0` and every other counter at zero,
   * which is exactly what a minute with nothing to do looks like.
   */
  tenantsBlocked: number;
  /** Where the cursor stands after this pass. */
  cursorAt: number;
}

const ZERO_RESULT = (cursorAt: number): ConsumeQuoteEventsResult => ({
  eventsConsumed: 0,
  cadencesCreated: 0,
  cadencesStopped: 0,
  quotesFlaggedForReview: 0,
  eventsSkipped: 0,
  tenantsBlocked: 0,
  cursorAt,
});

/**
 * What a consume pass that could not run AT ALL reports.
 *
 * Exported so the tick's guard around this pass reports the shape rather than
 * inventing one — a second literal here is a second place a field added to
 * `ConsumeQuoteEventsResult` can be forgotten. `cursorAt: 0` is not a claim that
 * the cursor sits at zero; it is the absence of a reading, which is exactly what
 * a pass that threw before it could take one has.
 */
export const NO_CONSUMPTION: ConsumeQuoteEventsResult = Object.freeze(ZERO_RESULT(0));

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

/**
 * The channel a touch can actually be delivered on, given who we picked.
 *
 * THE TEMPLATE SAYS HOW WE PREFER TO REACH THEM; THE CONTACT SAYS HOW WE CAN.
 * D-04 deliberately allows an email-only contact to be selected (a usable mobile
 * merely OUTRANKS email inside a tier), and every Phase 3 template is `sms`. So
 * without this fallback an email-only customer would get five sms touches
 * addressed to a mobile number that does not exist — touches dispatch could
 * never send and would re-examine every minute forever.
 *
 * Returns `null` only for a contact with neither address, which cannot reach
 * here: `selectPrimaryContact` returns null for that case and the cadence is
 * created already stopped as `no_contact`.
 */
function reachableChannel(
  preferred: TouchChannel,
  contact: PrimaryContact,
): TouchChannel | null {
  const has = (channel: TouchChannel) =>
    channel === 'sms' ? contact.mobile !== null : contact.email !== null;

  if (has(preferred)) return preferred;

  const fallback: TouchChannel = preferred === 'sms' ? 'email' : 'sms';
  return has(fallback) ? fallback : null;
}

/** The tenant's contact-hours configuration, as the pure core wants it. */
function windowOf(tenant: CadenceTickTenant): ContactWindow {
  return {
    timezone: tenant.timezone,
    contactHoursStart: tenant.contactHoursStart,
    contactHoursEnd: tenant.contactHoursEnd,
    contactDays: tenant.contactDays,
  };
}

type QuoteOpenedOutcome = 'created' | 'stopped' | 'replayed';

/**
 * D-01/D-02/D-04/D-15 — one `quote_opened` becomes one cadence, in one of four
 * shapes, and every one of them CONSUMES THE EVENT. That is the invariant this
 * function exists to hold: whatever we decide, the cursor may advance past this
 * event afterwards, because the decision is recorded in a row somebody can see.
 *
 *   a. a reachable, unsuppressed contact → a cadence with a materialized
 *      schedule, ACTIVE — or, when EITHER onboarding condition is unmet (no
 *      approved template set, or no ServiceM8-automation-off attestation),
 *      PAUSED `onboarding` in the same transaction (ONB-03/ONB-04/D-07/D-14;
 *      see below);
 *   b. a reachable but SUPPRESSED contact → a cadence created and immediately
 *      stopped `contact_suppressed`, with no touches (D-15: suppression blocks
 *      NEW quotes at creation, not merely at dispatch — the same human on a
 *      brand-new job is still the human who asked us to stop);
 *   c. NO usable contact → stopped `no_contact`, with no touches. Operator
 *      triage, never a guess (D-04);
 *   d. the creation returns zero rows → this is the replay. Nothing further
 *      happens, deliberately: inserting touches against the EXISTING cadence
 *      would be materializing a second schedule onto a cadence already partway
 *      through its first.
 *
 *      Zero rows covers TWO cases since G-3-2, not one: a LIVE cadence already
 *      exists for this quote (the partial index refused), or THIS EVENT already
 *      created its cadence and that cadence may since have stopped — created
 *      already-stopped `no_contact`/`contact_suppressed`, or stopped by a `won`
 *      later in the same held batch (`cadences_one_per_opened_event` refused).
 *      The second case is the one a partial-on-live index cannot see, and it is
 *      exactly what a held cursor re-reads on every tick.
 *
 * THE ANCHOR IS `detected_at` (D-01), NEVER `occurred_at`. `occurred_at` carries
 * the ServiceM8 issue date, which for a triaged backfilled quote can be months
 * old; anchoring there materializes five touches that are all already overdue,
 * the staleness cap skips every one of them, and the cadence expires without a
 * single message — indistinguishable from the outside from a cadence that ran.
 *
 * ── ONB-03 / ONB-04 / D-07 / D-14: WHY SHAPE (a) MAY END PAUSED ─────────────
 *
 * A tenant missing EITHER onboarding condition is not misconfigured, they are
 * not finished onboarding. The cadence is still created and the schedule is
 * still materialized — it PAUSES instead of sending. The two conditions share
 * one `pause_reason` deliberately (D-14): the state machine only ever needs to
 * know "not yet", and the precision an operator needs is in the REFUSAL, which
 * names the condition actually missing.
 *
 * WHY NOT REFUSE TO CREATE. The quote is genuinely live and the schedule is
 * genuinely correct; the only missing thing is wording, or a look at a settings
 * screen, that a human supplies in an hour. Refusing would mean re-deriving the schedule later from an anchor that
 * has since moved, and — worse — would leave NOTHING on any screen showing that
 * four quotes came in while the client was being set up. "No cadences" and "no
 * quotes" look identical from the outside. Four paused cadences carrying five
 * materialized touches each do not.
 *
 * WHY THE SAME TRANSACTION AS THE CREATE. It is the composition shapes (b) and
 * (c) already use — create, then decide, in one transaction — so the event is
 * consumed exactly once whatever the outcome. Committing the pause separately
 * would leave a window in which the cadence is active and unapproved, one tick
 * away from `promoteDue`; and a crash inside that window is indistinguishable
 * afterwards from a client who really was approved.
 *
 * WHY SUPPRESSION STILL WINS. Shapes (b) and (d) return BEFORE this point, so a
 * suppressed contact's cadence is STOPPED and never onboarding-paused, whatever
 * the template state. "This human asked us never to contact them" and "this
 * client has no words yet" are not on the same axis, and only the first is
 * terminal — recording the reversible one would park a permanently-off cadence
 * on the queue that the next template approval empties.
 */
async function createCadenceForQuoteOpened(
  tx: TenantScopedRepository,
  event: QuoteStatusEvent,
  tenant: CadenceTickTenant,
  creation: CreationInputs,
  jitterMinutes: () => number,
): Promise<QuoteOpenedOutcome> {
  const { templates, preferredSendTime } = creation;
  const contacts = await tx.quoteContacts.listForJob(event.sm8JobUuid);
  const primary = selectPrimaryContact(contacts);

  const [cadence] = await tx.cadences.create({
    quoteId: event.quoteId,
    sm8JobUuid: event.sm8JobUuid,
    // G-3-2 — the replay-dedupe key. Recording WHICH event created this cadence
    // is what makes a re-read of THIS event conflict even after the cadence it
    // created has stopped; the partial live index cannot see a stopped row.
    createdByEventId: event.id,
    // D-01. See the header of this function and of materialize.ts.
    anchorAt: event.detectedAt,
    primaryContactSm8Uuid: primary?.sm8ContactUuid ?? null,
    contactName: primary?.name ?? null,
    // The SNAPSHOT is normalized (D-04): `quote_contacts` re-syncs, and both
    // suppression matching and Phase 7 attribution key on the exact string.
    contactMobile: primary?.mobile ?? null,
    contactEmail: primary?.email ?? null,
  });

  // (d) An index refused. Postgres decided, inside the INSERT — not a read this
  // code did a moment earlier and could have lost a race against.
  //
  // WHICH index refused is NOT knowable from here, and the difference matters
  // (WR-03). If `cadences_one_per_opened_event` refused, THIS event's id is on
  // the existing row and a further replay of it is refused forever. If a LIVE
  // index refused — a cadence already exists for this quote or job, created by a
  // DIFFERENT event — then this event's id is recorded NOWHERE, and a replay of
  // it after that cadence stops would create a duplicate.
  //
  // The second case is unreachable today because no writer can emit a second
  // `quote_opened` while a cadence is live: `markChaseEligible` needs
  // `chase_eligibility = 'needs_review'`, and its only writer
  // (`flagNeedsReviewOnReopen`) runs in the same transaction as
  // `stopWhereLiveByQuoteIds`. That is a property of the EMITTERS, not of this
  // function — see the WR-03 section in src/db/schema/cadences.ts before adding
  // an eligibility writer, and note that stamping this event onto the existing
  // cadence cannot fix it: that row already carries the id of the event that
  // created it.
  if (!cadence) return 'replayed';

  // (c) D-04's honest null.
  if (!primary) {
    await tx.cadences.stopWhereLive([cadence.id], 'no_contact');
    return 'stopped';
  }

  // (b) D-15. Both channels are probed even though Phase 3 sends only sms: one
  // human asked not to be contacted, and honouring that on one channel while
  // using the other is a loophole, not compliance.
  const probes: SuppressionProbe[] = [];
  if (primary.mobile) probes.push({ channel: 'sms', address: primary.mobile });
  if (primary.email) probes.push({ channel: 'email', address: primary.email });

  const suppressed = await tx.suppression.existsFor(probes);
  if (suppressed.length > 0) {
    await tx.cadences.stopWhereLive([cadence.id], 'contact_suppressed');
    return 'stopped';
  }

  // (a) The live path.
  const schedule = materializeCadenceSchedule({
    anchor: event.detectedAt,
    templates: templates.map((template) => ({
      ...template,
      channel: reachableChannel(template.channel, primary) ?? template.channel,
    })),
    window: windowOf(tenant),
    preferredSendTime,
    jitterMinutes,
  });

  await tx.touches.insertMany(
    schedule.map((touch) => ({
      cadenceId: cadence.id,
      touchNumber: touch.touchNumber,
      channel: touch.channel,
      scheduledAt: touch.scheduledAt,
      originalOffsetDays: touch.originalOffsetDays,
    })),
  );

  // THE ONB-03 + ONB-04 GATE, AFTER MATERIALIZATION AND INSIDE THIS
  // TRANSACTION. The touches exist first on purpose: the operator must be able
  // to see exactly what is waiting, not merely that something is (D-07). See
  // the header.
  //
  // THE COMPOSED PREDICATE, NOT THE TEMPLATE HALF (D-14, Pitfall 6). Creation
  // is the question the gate exists for: a client whose templates were approved
  // BEFORE Phase 6 shipped has no attestation, and a creation path still asking
  // only about templates would keep birthing their cadences ACTIVE while both
  // resume paths refused — the gate never engaging for the one client it was
  // added for.
  if (!creation.onboardingComplete) {
    await tx.cadences.pauseWhereActive([cadence.id], ONBOARDING_PAUSE_REASON);
  }

  // Still `created` either way. A born-paused cadence IS a cadence this run
  // created; reporting it as `stopped` would tell the tick — and the operator
  // reading its counts — that a quote was declined, when it is waiting.
  return 'created';
}

/**
 * What a `quote_opened` needs and no other event does: the template shape to
 * materialize from, and the time of day to place it at.
 *
 * RESOLVED LAZILY (see `consumeRun`), because resolving it is not a read. Both
 * halves SEED — `ensureDefaults` is a five-row INSERT … ON CONFLICT and
 * `settings.ensure()` an INSERT … ON CONFLICT + SELECT — and doing that for a
 * run of pure `won` events would create a `cadence_settings` row for a tenant
 * that has never had a cadence, quietly changing what "no settings row" means
 * to `forAllTenants_cadenceTick`, to `resume.ts` and to the console.
 */
interface CreationInputs {
  templates: MaterializeTemplate[];
  preferredSendTime: string;
  /**
   * ONB-03 AND ONB-04, COMPOSED. FALSE means every cadence this run creates is
   * born paused — whichever of the two conditions is the missing one.
   *
   * Resolved in `prepare` beside the two seeds, so it is asked ONCE per run per
   * tenant — a run with twenty `quote_opened` events checks once. Both halves
   * are per-TENANT facts (does this client have approved wording for every sms
   * touch; has anybody recorded ServiceM8's own follow-up as off) and neither
   * can change mid-run: nothing inside this transaction approves a template or
   * writes an attestation, and either landing concurrently is serialized
   * against it.
   *
   * Read AFTER `ensureDefaults` deliberately. That seed creates the very timing
   * rows the template half is measured against, and asking first would read a
   * tenant with no cadence shape — which `hasApprovedTemplateSet` correctly
   * calls `false`, but for the wrong reason and one that would flip a
   * millisecond later.
   */
  onboardingComplete: boolean;
}

/** What one event changed. Summed into the run, and then into the pass. */
interface AppliedEvent {
  created: number;
  stopped: number;
  flagged: number;
}

/**
 * CAD-03 — a decided quote stops being chased, in every state it could be in.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE GUARDED UPDATE *IS* THE IDEMPOTENCE MECHANISM.                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `stopWhereLiveByQuoteIds` carries `WHERE status IN ('active','paused')` and
 * returns the rows that ACTUALLY changed. A replayed `won` therefore matches
 * zero rows and does nothing at all — it cannot re-stop an already-stopped
 * cadence and overwrite the reason Phase 7 attributes revenue on, and it cannot
 * re-skip touches that a different rule already skipped for a different reason.
 * Everything downstream is driven by that RETURNING, which is the same idiom
 * `markChaseEligible` uses on the emitting side of this outbox.
 *
 * KEYED BY QUOTE, NOT BY CADENCE, and that is deliberate: the event names a
 * quote, and looking its cadence up first would open a window between the read
 * and the write in which a concurrent tick could stop it. One statement, no
 * window.
 *
 * THE SKIP IS NOT SEPARABLE FROM THE STOP. A stopped cadence whose touches are
 * still `scheduled` is precisely the state that makes a killed cadence keep
 * sending; both writes are in the caller's per-tenant transaction, which also
 * ends with the cursor advance.
 */
async function stopCadenceForClosingEvent(
  tx: TenantScopedRepository,
  event: QuoteStatusEvent,
  eventType: ClosingEventType,
): Promise<AppliedEvent> {
  const stopped = await tx.cadences.stopWhereLiveByQuoteIds(
    [event.quoteId],
    STOP_REASON_FOR[eventType],
  );

  if (stopped.length > 0) {
    await tx.touches.skipUnsentForCadences(
      stopped.map((cadence) => cadence.id),
      SKIP_REASON_FOR[eventType],
    );
  }

  // D-08 — A REOPEN IS TRIAGE, NOT A RESTART, AND IT RUNS EVEN WHEN NOTHING
  // STOPPED. The tradie has gone back into ServiceM8 and put the job back to
  // Quote, which in practice means they are renegotiating it. The quote returns
  // to the operator's review queue in THIS transaction, so "the cadence stopped"
  // and "the quote is awaiting review" can never be separately true. There is
  // usually no live cadence left by now (the earlier won or lost already stopped
  // it), which is exactly why the flip is unconditional: the triage decision is
  // about the quote, and does not depend on whether a cadence happened to
  // survive. Only a fresh operator tick re-emits `quote_opened`, and that starts
  // a NEW cadence from a NEW anchor — the sequential-cadence history the partial
  // unique index on `cadences` deliberately permits.
  const flagged =
    eventType === 'reopened'
      ? (await tx.quotes.flagNeedsReviewOnReopen([event.quoteId])).length
      : 0;

  return { created: 0, stopped: stopped.length, flagged };
}

/**
 * One outbox event, applied. Exhaustive over `QUOTE_EVENT_TYPES`.
 *
 * There is no `default` and no fallback: the switch covers the vocabulary, and
 * a member added to `QUOTE_EVENT_TYPES` without a branch here stops this file
 * compiling. Silence is the failure this consumer cannot afford — an ignored
 * `won` is a customer being chased about a job they already awarded.
 */
async function applyEvent(
  tx: TenantScopedRepository,
  event: QuoteStatusEvent,
  eventType: QuoteEventType,
  tenant: CadenceTickTenant,
  prepare: () => Promise<CreationInputs>,
  jitterMinutes: () => number,
): Promise<AppliedEvent> {
  switch (eventType) {
    case 'quote_opened': {
      // AWAITED HERE AND NOWHERE ELSE. `prepare` seeds the template rows and the
      // settings row and asks the composed onboarding question, and only this
      // branch has any
      // use for any of them.
      const result = await createCadenceForQuoteOpened(
        tx,
        event,
        tenant,
        await prepare(),
        jitterMinutes,
      );

      return {
        created: result === 'created' ? 1 : 0,
        stopped: result === 'stopped' ? 1 : 0,
        flagged: 0,
      };
    }

    case 'won':
    case 'lost':
    case 'removed':
    case 'reopened':
      return stopCadenceForClosingEvent(tx, event, eventType);
  }
}

interface RunOutcome {
  consumed: number;
  created: number;
  stopped: number;
  flagged: number;
  skipped: number;
  advancedTo: number;
  /** A configuration problem stopped this run partway. See `consumeRun`. */
  blocked: boolean;
}

/**
 * One contiguous same-tenant run, in ONE transaction that ends with the cursor.
 *
 * A TENANT WITH NO CONNECTION ROW IS SKIPPED, NOT STUCK. `forAllTenants_cadenceTick`
 * inner-joins `sm8_connections`, so a tenant that has been deleted leaves its
 * events behind (they carry no foreign key, deliberately — they are Phase 7's
 * evidence) with no metadata to materialize a schedule from. Refusing to advance
 * would wedge the single shared cursor for every other client, forever, over a
 * client who no longer exists. So those events are consumed with no action and
 * counted separately, which is the difference between "nothing to do" and
 * "nothing happened".
 *
 * A CONTACT-WINDOW CONFIGURATION ERROR STOPS THE RUN AT THAT EVENT. An overnight
 * or zero-width window is an operator-facing configuration problem, not a
 * transient failure to retry (see window.ts), and this consumer must not guess
 * which reading was meant. The events BEFORE it commit with their advance; the
 * offending event stays unconsumed. Loud, and recoverable by fixing the tenant
 * row.
 *
 * `advanceCursor` IS THE CALLER'S HEAD-OF-LINE FLOOR, and it is false for every
 * run that follows a blocked one. The run still commits its writes — those are
 * this tenant's stops, and withholding them punishes the wrong client — but the
 * shared position stays behind the blocked events, so nothing is stepped over
 * and the next tick re-reads this run. Replay is legal here by construction, so
 * the cost is repeated work rather than repeated effect.
 */
async function consumeRun(
  events: readonly QuoteStatusEvent[],
  tenant: CadenceTickTenant | undefined,
  jitterMinutes: () => number,
  advanceCursor: boolean,
): Promise<RunOutcome> {
  const tenantId = events[0].tenantId;

  return forTenant(tenantId).transaction(async (tx) => {
    const outcome: RunOutcome = {
      consumed: 0,
      created: 0,
      stopped: 0,
      flagged: 0,
      skipped: 0,
      advancedTo: 0,
      blocked: false,
    };

    // RESOLVED ON FIRST USE, NOT ON ENTRY. Both statements below SEED rows, and
    // a run of pure `won` / `lost` / `removed` / `reopened` events needs
    // neither: `stopCadenceForClosingEvent` reads no template and no send time.
    // Running them unconditionally cost four extra statements per tenant per
    // tick forever, and — worse — a single `won` CREATED a `cadence_settings`
    // row for a tenant that has never had a cadence. That row then joins into
    // `forAllTenants_cadenceTick`'s `settingsPausedAt` and the console's "client
    // paused" read, changing the meaning of "no settings row" that
    // `CadenceTickTenant.preferredSendTime` and `resume.ts` both depend on. It
    // also sat awkwardly beside for-tenant.ts's rule that read paths must not
    // lazily insert configuration rows.
    //
    // Memoized, so a run with twenty `quote_opened` events still seeds once.
    let prepared: CreationInputs | null = null;

    const prepare = async (): Promise<CreationInputs> => {
      if (prepared) return prepared;

      // The 03-01 seam: the repository takes the offsets as a PARAMETER and
      // imports no policy. This caller is the one that passes the constant in.
      await tx.templates.ensureDefaults(DEFAULT_TOUCH_OFFSET_DAYS);
      const rows = await tx.templates.list();

      // `ensure()` rather than the tick's snapshot: the row is seeded lazily, so
      // a tenant's first cadence is exactly the case where the snapshot is null.
      const settings = await tx.settings.ensure();

      // ONB-03 + ONB-04, asked once per run per tenant and AFTER the seed above
      // — see `CreationInputs.onboardingComplete`. Asked through `tx`, so it
      // reads the timing rows `ensureDefaults` just wrote in this same
      // transaction. The conjunction itself is `onboardingComplete`'s, never
      // re-spelled here: creation and both resume writers ask ONE predicate.
      const conditions = await readOnboardingConditions(tx);

      prepared = {
        onboardingComplete: onboardingComplete(conditions),
        templates: rows.map((row) => ({
          touchNumber: row.touchNumber,
          offsetDays: row.offsetDays,
          channel: row.channel as TouchChannel,
        })),
        // `??`, matching `run-tick.ts` and `resume.ts` — one question, one
        // answer. `||` additionally coerced an empty string to the default,
        // which sounds harmless and is not: `preferred_send_time` is `time NOT
        // NULL`, so the two forms agree today, and the day they stop agreeing
        // the `||` form would silently swallow the exact value
        // `parseTimeOfDay` exists to reject.
        preferredSendTime: settings.preferredSendTime ?? DEFAULT_PREFERRED_SEND_TIME,
      };

      return prepared;
    };

    for (const event of events) {
      if (!tenant) {
        outcome.skipped += 1;
        outcome.advancedTo = event.id;
        continue;
      }

      if (!isKnownEventType(event.eventType)) {
        // See `isKnownEventType`: unreachable while the CHECK constraint holds.
        console.error(
          `[cadence] event ${event.id} carries an event type this build has never ` +
            'heard of; consumption stopped rather than advancing past a signal ' +
            'nothing has interpreted.',
        );
        outcome.blocked = true;
        break;
      }

      try {
        const applied = await applyEvent(
          tx,
          event,
          event.eventType,
          tenant,
          prepare,
          jitterMinutes,
        );

        outcome.created += applied.created;
        outcome.stopped += applied.stopped;
        outcome.flagged += applied.flagged;

        outcome.consumed += 1;
        outcome.advancedTo = event.id;
      } catch (error) {
        if (
          error instanceof InvalidContactWindowError ||
          error instanceof NoAllowedContactDayError
        ) {
          // Named, so this branch cannot silently widen to "any error".
          console.error(
            `[cadence] tenant ${tenantId} has a contact-hours configuration this ` +
              `engine refuses to interpret (${error.name}); consumption stopped at ` +
              `event ${event.id}.`,
          );
          outcome.blocked = true;
          break;
        }
        throw error;
      }
    }

    // STILL IN THE SAME TRANSACTION AS THE WRITES IT ACCOUNTS FOR — the clause
    // of the consumption contract that survives everything else. `advanceCursor`
    // only ever withholds the advance; it never moves it independently.
    if (advanceCursor && outcome.advancedTo > 0) {
      await tx.consumerCursor.advanceTo(CADENCE_CONSUMER, outcome.advancedTo);
    }

    return outcome;
  });
}

/**
 * Read the cursor, act on what is past it, advance it — once per tick.
 */
export async function consumeQuoteEvents(
  options: ConsumeQuoteEventsOptions = {},
): Promise<ConsumeQuoteEventsResult> {
  const { batchLimit = CONSUME_BATCH_LIMIT, jitterMinutes = randomJitterMinutes } = options;

  const cursor = await registerConsumerCursor(CADENCE_CONSUMER);
  const pending = await forAllTenants_pendingQuoteEvents(cursor, batchLimit);
  if (pending.length === 0) return ZERO_RESULT(cursor);

  const tenantsById = new Map(
    (await forAllTenants_cadenceTick()).map((tenant) => [tenant.tenantId, tenant]),
  );

  const result = ZERO_RESULT(cursor);

  /** Tenants whose run could not finish. Their LATER runs are not attempted. */
  const blockedTenants = new Set<string>();
  /** Once true, the shared position is frozen: no later run may advance it. */
  let cursorHeld = false;

  // THE WHOLE BATCH, not a prefix of it. The tracer's stop-at-unhandled guard is
  // gone (see the header); every pending event has a handler, so the cursor
  // walks the outbox without ever needing to step around a type.
  for (const run of contiguousRuns(pending)) {
    const tenantId = run[0].tenantId;

    // ORDER WITHIN A TENANT CARRIES MEANING. This tenant already has an
    // unconsumed event ahead of these, so acting on these would apply a `won`
    // before the `quote_opened` it closes — and the next tick, re-reading the
    // blocked event, would then create the cadence the stop was meant to end.
    if (blockedTenants.has(tenantId)) continue;

    // A THROW IS A BLOCKED RUN, NOT A FAILED TICK. `consumeRun`'s own catch is
    // deliberately narrow — it names the two contact-window errors and rethrows
    // everything else — and everything else is reachable: a deadlock or
    // statement timeout inside the run transaction, a RangeError out of
    // materialization, a seeding failure in `settings.ensure()`. Left
    // unguarded, any one of them propagates out of the whole tick and the
    // progress, dispatch and completion passes never run FOR ANYBODY that
    // minute; a deterministic one does so every minute thereafter, because the
    // cursor can never get past the offending event. Treating it as a block
    // means this tenant's consumption stops — which is what the head-of-line
    // rule already prescribes — rather than the engine stopping.
    //
    // The caught value is deliberately not logged: a driver error carries the
    // statement, whose parameters are this tenant's data. Same rule as the
    // window errors inside `consumeRun`, and as every catch in `run-tick.ts`.
    let outcome: RunOutcome;
    try {
      outcome = await consumeRun(run, tenantsById.get(tenantId), jitterMinutes, !cursorHeld);
    } catch {
      console.error(
        `[cadence] consumption threw for tenant ${tenantId}; the cursor is held ` +
          'behind this run and this tenant is skipped for the rest of the pass.',
      );
      outcome = {
        consumed: 0,
        created: 0,
        stopped: 0,
        flagged: 0,
        skipped: 0,
        advancedTo: 0,
        blocked: true,
      };
    }

    result.eventsConsumed += outcome.consumed;
    result.cadencesCreated += outcome.created;
    result.cadencesStopped += outcome.stopped;
    result.quotesFlaggedForReview += outcome.flagged;
    result.eventsSkipped += outcome.skipped;
    if (!cursorHeld && outcome.advancedTo > 0) result.cursorAt = outcome.advancedTo;

    // Head-of-line by design: the cursor is one ordered position, so a run that
    // could not finish must not be stepped over by the runs behind it. The SCAN
    // carries on for other tenants — see the header — with the position frozen
    // where it stands, which is what makes those runs re-readable next tick.
    if (outcome.blocked) {
      blockedTenants.add(tenantId);
      cursorHeld = true;
      result.tenantsBlocked = blockedTenants.size;
    }
  }

  return result;
}
