/**
 * The inbound-message repository — the one family here that is NOT tenant-scoped
 * because its rows may legitimately belong to nobody.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY THIS IS NOT A `forTenant()` NAMESPACE, AND WHY THAT IS NOT AN ESCAPE │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `forTenant(id)` closes over a tenant id and exposes no method that accepts
 * one, because forgetting a `WHERE tenant_id` is a cross-tenant leak. That
 * mechanism cannot express this table: an inbound message arrives BEFORE we know
 * whose it is, and the whole point of `inbound_messages` is that a reply we
 * could not place is recorded anyway with `tenant_id = NULL` (see the schema
 * header). A scoped insert would have to invent an owner for it.
 *
 * So this is the same shape of exception the prospect family (D-01/D-03) and the
 * consumer-cursor family (03-02) already are: its own file, its own line in the
 * barrel, no method that takes a `tenantId` as a scope. What it owes in return is
 * that it reads and writes ONE table and joins nothing — there is no accessor
 * here that can reach `cadences`, `quotes` or `suppressed_contacts`, so nothing
 * in this file can turn "an unattributed reply" into a cross-tenant read of
 * customer data.
 *
 * Service-role, so RLS is bypassed by design; the policy on the table is
 * defence-in-depth for the console's authenticated reads.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';

import { inboundMessages } from '@/db/schema';
import type { InboundMessage, NewInboundMessage } from '@/db/schema';

import { getDb } from './client';

/**
 * One inbound row as a caller supplies it.
 *
 * `id`, `receivedAt` and `createdAt` are omitted rather than optional: they are
 * the database's to decide, and a caller-supplied `received_at` would let a
 * forged or replayed callback claim to have arrived at a time it did not — on
 * the one column an operator reads as "how long has this been sitting here".
 */
export type InboundMessageInsert = Omit<
  NewInboundMessage,
  'id' | 'receivedAt' | 'createdAt'
>;

/**
 * Record an inbound message. THE ONLY INSERT PATH.
 *
 * Returns the id and nothing else — the caller already holds everything it
 * wrote, and returning the whole row would put a customer's body and address
 * into a result that Phase 4's route handlers serialize into responses.
 */
export async function insertInboundMessage(
  row: InboundMessageInsert,
): Promise<{ id: string }> {
  const [written] = await getDb()
    .insert(inboundMessages)
    .values({
      ...row,
      // Phase 13 (D-06): the door's deterministic emergency-keyword hit, the
      // ONLY writer of `keyword_hot`. Optional for every caller that predates
      // it, and false unless the door says otherwise — classification never
      // writes this column, and its own `is_hot` cannot overwrite it.
      keywordHot: row.keywordHot ?? false,
    })
    .returning({ id: inboundMessages.id });

  return written;
}

/**
 * The rows carrying a given provider message id — the reconciliation dedupe key
 * (plan 04-04).
 *
 * RETURNS AN ARRAY, NOT A SINGLE ROW, and deliberately so. There is no unique
 * index on `provider_message_id`: it is a third party's identifier, it is
 * NULLABLE for anything that did not arrive with one, and a uniqueness
 * assumption about somebody else's id space is exactly the kind of thing that
 * turns a duplicated provider callback into a 23505 at the webhook boundary —
 * where the provider's response to an error is to retry for 72 hours. The
 * caller decides what more-than-one means; this function only reports it.
 *
 * Newest first, so a caller taking `[0]` gets the most recent record rather than
 * whichever row the planner happened to return.
 */
export async function findInboundByProviderMessageId(
  providerMessageId: string,
): Promise<InboundMessage[]> {
  return getDb()
    .select()
    .from(inboundMessages)
    .where(eq(inboundMessages.providerMessageId, providerMessageId))
    .orderBy(desc(inboundMessages.receivedAt), desc(inboundMessages.id));
}

/**
 * The attributions that need a human — everything the algorithm could not place.
 *
 * `threaded` is deliberately absent: a reply that matched exactly one live
 * cadence already paused it (04-02), so the system has acted and there is
 * nothing to decide. It re-enters the queue only via `is_stop` below, and that
 * exception is the point — a THREADED stop is compliance evidence, and the
 * operator seeing it is how "somebody asked us to stop" reaches a human rather
 * than only a suppression row.
 *
 * Declared as a const array rather than inlined in the predicate for the reason
 * every closed vocabulary in this schema is: this list and the triage screen's
 * badge labels describe the same set, and two spellings is how a fifth
 * attribution added later renders as a blank badge on a row nobody can explain.
 */
export const TRIAGE_ATTRIBUTIONS = ['ambiguous', 'unmatched', 'dead_letter'] as const;

/**
 * ── THE CLASSIFICATION ARM OF THE QUEUE (D-13, D-15) ────────────────────────
 *
 * Phase 5 gave every inbound reply a label, and two kinds of label are a job for
 * a human that the attribution buckets above cannot see. Both are `threaded`
 * rows — replies the algorithm placed perfectly, which the attribution arm
 * therefore excludes, and which is exactly why this second arm exists.
 *
 *  A SOFT OPT-OUT (`label = 'opt_out'` with `is_stop = false`) is somebody
 *  asking to be left alone in a sentence the deterministic STOP regex does not
 *  match — "please stop texting me about this". NOTHING HAS BEEN SUPPRESSED.
 *  The reply-pause froze the cadence (04-02), so no further message goes out
 *  meanwhile, but the contact is not on the suppression list and D-13 says only
 *  an operator may put them there. This is the highest-priority row on the
 *  screen because it is the only one where a person has asked for something
 *  irreversible and the system has deliberately not done it.
 *
 *  A BELOW-HIGH-CONFIDENCE LABEL (`label IS NOT NULL AND label_confidence <>
 *  'high'`) is D-15: the model answered and said it was unsure. The guess is
 *  shown, nothing is acted on, and a human decides. `high` is the acting
 *  threshold and it is tunable from the recorded data without a schema change.
 *
 * ── WHY THIS ARM NEEDS NO `attribution = 'threaded'` PREDICATE ──────────────
 *
 * It would be redundant, not wrong. `attribution` has four values and the other
 * three are already in the queue unconditionally via `TRIAGE_ATTRIBUTIONS`, so
 * the only rows this arm can ADD are threaded ones. Writing the predicate anyway
 * would state a restriction the query does not depend on, and a later reader
 * would reasonably assume removing it changes the result set.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────
 *
 * `is_hot` is NOT a queue predicate. A hot lead is a high-confidence
 * `interested`/`question` on a threaded row — the system understood it, the
 * cadence is paused, and Phase 6's escalation is what acts on it (D-14). Putting
 * every hot row in the triage queue would fill the operator's one
 * needs-a-human screen with rows that do not.
 *
 * ── THE LEAD ARM (Phase 13, D-08/D-11; 13-REVIEW CR-01) ─────────────────────
 *
 * A reply threaded to a LEAD (`lead_id` set) has no quote page, and the quote
 * page's conversation thread is where a confident quote reply is read. So a
 * lead reply that is hot by NEITHER column (`is_hot = false AND keyword_hot =
 * false`) — every cold one, at any confidence, labelled or not — is this
 * screen's until Phase 15's lead queue exists. Without the arm a confident
 * `question` ("What area do you cover?") paused the lead and was shown nowhere
 * until expiry closed it. `label` is deliberately NOT required: a lead reply
 * the classifier gave up on (`MAX_CLASSIFY_ATTEMPTS`, label NULL) must reach a
 * human too. Hot ones are excluded because escalation already told the
 * tradie; `is_hot` there EXCLUDES a row, it never admits one, which is the
 * D-14 property above. No `threaded` predicate, for the reason the
 * classification arm gives: the other three attributions are already in.
 */

/**
 * The triage sort key, as three ranks. D-13 first, D-15 second, the rest third.
 *
 * ── WHY THE ORDER IS IN SQL AND NOT IN THE PAGE ─────────────────────────────
 *
 * The read is CAPPED at `TRIAGE_PAGE_SIZE`. A sort applied after the read orders
 * only the rows the cap admitted — so on a backlog of 400, a soft opt-out from
 * this morning would be cut off by a night of dead-letter callbacks and then
 * "sorted to the top" of a list it is not in. The priority has to be part of
 * what the LIMIT chooses.
 *
 * Written as a `CASE` rather than as three UNIONed queries because the family's
 * promise is one table and no joins, and three queries over one table is the
 * shape that eventually grows a join.
 */
const TRIAGE_PRIORITY = sql`
  CASE
    WHEN ${inboundMessages.label} = 'opt_out' AND ${inboundMessages.isStop} = false THEN 0
    WHEN ${inboundMessages.label} IS NOT NULL
     AND ${inboundMessages.labelConfidence} <> 'high' THEN 1
    ELSE 2
  END
`;

/**
 * The default page size of the triage queue.
 *
 * A CAP, not a guess at how many rows there are. This read is rendered into a
 * server component's HTML payload, and the failure mode of an uncapped read is
 * not a slow query — it is a provider looping a broken callback overnight and
 * the operator's phone trying to render forty thousand message bodies. If the
 * queue is ever genuinely longer than this, the honest answer is that triage has
 * stopped happening, and that is a conversation rather than a scroll.
 */
export const TRIAGE_PAGE_SIZE = 200;

/**
 * Every inbound row still waiting on a human, newest first.
 *
 * ── WHY THIS DOES NOT JOIN `tenants`, THOUGH THE SCREEN SHOWS NAMES ─────────
 *
 * The header above states what this family owes in exchange for living outside
 * `forTenant()`: it reads and writes ONE table and joins nothing, so nothing
 * here can turn "an unattributed reply" into a cross-tenant read of customer
 * data. Resolving `candidate_tenant_ids` to business names here would be that
 * join, added for a label. The console page resolves names instead through the
 * operator's OWN JWT (`tenants` under RLS), which is both narrower — it can only
 * name clients that operator may already see — and honest about where the
 * authority for that read comes from.
 *
 * ── THE SELECT LIST IS EXPLICIT ────────────────────────────────────────────
 *
 * `raw_payload` is NOT in it. A dead-letter row's payload is whatever a provider
 * (or a token holder) sent us, unbounded in shape, and a page prop is serialised
 * into the HTML payload and the client router cache. The operator learns THAT a
 * payload was unparseable; reading it is a database question, not a phone one.
 */
export interface InboundTriageRow {
  id: string;
  receivedAt: Date;
  channel: string;
  tenantId: string | null;
  cadenceId: string | null;
  quoteId: string | null;
  fromAddress: string;
  normalizedFrom: string | null;
  body: string;
  attribution: string;
  isStop: boolean;
  matchedCadenceCount: number;
  candidateTenantIds: string[] | null;
  /**
   * The classification, as a GUESS (D-15). `null` on anything not yet labelled —
   * which includes every row that arrived before Phase 5, and every row the
   * classifier could not answer for. The page renders these as the model's
   * opinion, never as a finding.
   */
  label: string | null;
  labelConfidence: string | null;
  /**
   * Phase 13 (D-05; 13-REVIEW WR-03): the model's urgency on a LEAD reply —
   * `emergency | this_week | flexible | unknown` — and NULL on every quote reply
   * and every unlabelled row. Shown as a guess beside the label; the one field
   * that says whether this is a burst pipe or a fence.
   */
  urgency: string | null;
  /** D-14's flag. Displayed here; Phase 6's escalation is what consumes it. */
  isHot: boolean;
  /**
   * Phase 13: the lead this reply is threaded to, NULL on a quote reply or an
   * unplaced one. A lead row has no quote page, so the screen names the client
   * and says "missed-call lead" where a quote link would go.
   */
  leadId: string | null;
  /**
   * Phase 15 (15-REVIEW CR-01 / WR-04): set when the privacy pass (D-06)
   * replaced this row's sender with the caller pseudonym. The page renders the
   * retired label instead of `fromAddress` and offers no suppress control —
   * a hash is not an address.
   */
  pseudonymisedAt: Date | null;
}

export async function listInboundNeedingTriage(
  limit: number = TRIAGE_PAGE_SIZE,
): Promise<InboundTriageRow[]> {
  return getDb()
    .select({
      id: inboundMessages.id,
      receivedAt: inboundMessages.receivedAt,
      channel: inboundMessages.channel,
      tenantId: inboundMessages.tenantId,
      cadenceId: inboundMessages.cadenceId,
      quoteId: inboundMessages.quoteId,
      fromAddress: inboundMessages.fromAddress,
      normalizedFrom: inboundMessages.normalizedFrom,
      body: inboundMessages.body,
      attribution: inboundMessages.attribution,
      isStop: inboundMessages.isStop,
      matchedCadenceCount: inboundMessages.matchedCadenceCount,
      candidateTenantIds: inboundMessages.candidateTenantIds,
      label: inboundMessages.label,
      labelConfidence: inboundMessages.labelConfidence,
      urgency: inboundMessages.urgency,
      isHot: inboundMessages.isHot,
      leadId: inboundMessages.leadId,
      pseudonymisedAt: inboundMessages.pseudonymisedAt,
    })
    .from(inboundMessages)
    .where(
      and(
        isNull(inboundMessages.triagedAt),
        or(
          inArray(inboundMessages.attribution, [...TRIAGE_ATTRIBUTIONS]),
          eq(inboundMessages.isStop, true),
          // The classification arm — see TRIAGE_PRIORITY's header for both
          // halves and for why no `threaded` predicate is needed.
          and(
            eq(inboundMessages.label, 'opt_out'),
            eq(inboundMessages.isStop, false),
          ),
          and(
            isNotNull(inboundMessages.label),
            ne(inboundMessages.labelConfidence, 'high'),
          ),
          // The lead arm — see THE LEAD ARM above. Every cold lead reply, any
          // confidence, labelled or not; hot ones were escalated.
          and(
            isNotNull(inboundMessages.leadId),
            eq(inboundMessages.isHot, false),
            eq(inboundMessages.keywordHot, false),
          ),
        ),
      ),
    )
    // PRIORITY FIRST, then arrival. `id` breaks the final tie: two callbacks
    // landing in the same millisecond must not swap places between renders, or a
    // mark-handled tap lands on the row that moved into the position the
    // operator was looking at.
    .orderBy(TRIAGE_PRIORITY, desc(inboundMessages.receivedAt), desc(inboundMessages.id))
    .limit(limit);
}

/**
 * Mark one row handled. THE ONLY WRITER of `triaged_at`.
 *
 * GUARD AS A WHERE CLAUSE, in the house style (`pauseWhereActive`,
 * `stopWhereLive`, `updateDeliveryWhereMatch`): `triaged_at IS NULL` is in the
 * predicate rather than in a pre-read, so two taps — or two operators, or a
 * double-submit from a phone on a bad connection — cannot overwrite the moment
 * the row was FIRST handled. That timestamp is the answer to "how long did this
 * customer wait for a human", and a second tap silently resetting it would make
 * every such row look freshly dealt with.
 *
 * `now()` rather than a JavaScript `Date` for the same reason `received_at` is
 * the database's: both are read as elapsed time against each other, and mixing a
 * serverless function's clock into that comparison can produce a row handled
 * before it arrived.
 *
 * Returns whether THIS call did the write, so the caller can tell "done" from
 * "already done" — both are successes, and only one of them is news.
 */
export async function markInboundTriaged(id: string): Promise<{ triaged: boolean }> {
  const rows = await getDb()
    .update(inboundMessages)
    .set({ triagedAt: sql`now()` })
    .where(and(eq(inboundMessages.id, id), isNull(inboundMessages.triagedAt)))
    .returning({ id: inboundMessages.id });

  return { triaged: rows.length > 0 };
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE CLASSIFICATION SURFACE (AI-02, AI-03, plan 05-06)
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE THREE FUNCTIONS BELOW ARE THE ENTIRE WRITE SURFACE AVAILABLE TO      │
 * │ MODEL OUTPUT. Nothing a customer can type, and nothing Claude can        │
 * │ return, may reach any statement other than these — D-13.                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The classification pass (`src/core/classification/classify-inbound.ts`) takes
 * an attacker-controlled SMS body, hands it to a model, and writes what comes
 * back. The whole safety argument for doing that at all is that the blast radius
 * of a fully successful prompt injection is ONE MISLABELLED ROW A HUMAN STILL
 * REVIEWS — and that argument is only true if the write surface is this small.
 *
 * So the SET lists below are PINNED, by hand, and asserted by
 * `tests/classification-privilege.test.ts` rather than merely intended:
 *
 *   writeClassification  — label, label_confidence, is_hot, classified_at
 *   bumpClassifyAttempts — classify_attempts
 *
 * What is deliberately NOT reachable from here, and must never become so:
 * `suppressed_contacts` (D-06 suppression is one-way and grant-denied for a
 * reason), `cadences`, `cadence_touches`, `send_ledger`, `triaged_at`, or the
 * inbound row's own `attribution` / `is_stop` — those last two are the
 * DETERMINISTIC webhook's findings (04-01), and a model that could edit them
 * could rewrite the record of a STOP it was never allowed to decide.
 *
 * The family promise still holds: one table, no joins.
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * How many times one row may be ATTEMPTED before the scan stops offering it.
 *
 * The cap lives in the read's predicate rather than in the caller, because the
 * burn it bounds is the cross-tick one: a reply whose body makes the model emit
 * something the schema rejects will do so again next minute, and every minute
 * after that, forever. Five attempts is generous for a transient problem and
 * cheap for a permanent one.
 *
 * A row at the cap is not an error and is not retired — it simply stops being
 * fetched. It is still visible to the operator through the triage read above,
 * which is where an unlabelled reply belongs anyway.
 */
export const MAX_CLASSIFY_ATTEMPTS = 5;

/** How many rows one tick will classify. A CAP on model calls per minute. */
export const CLASSIFY_BATCH_SIZE = 20;

/**
 * One row as the classifier sees it — and the select list is the point.
 *
 * `from_address`, `normalized_from`, `tenant_id`, `cadence_id` and
 * `raw_payload` are all ABSENT. The classifier needs the words and the id; it
 * has no business knowing whose reply this is, and a field it cannot read is a
 * field it cannot put in a prompt.
 *
 * 2026-10 (Phase 13, plan 13-03): `lead_id` is selected — one more column from
 * the same table, still no join. It is the KIND PROXY the classifier selects
 * its vocabulary by (a lead reply is labelled in LEAD_LABELS with an urgency,
 * `inbound_messages_label_known` splits the CHECK on it); it says which
 * conversation shape this is, never whose.
 */
export interface UnclassifiedRow {
  id: string;
  body: string;
  receivedAt: Date;
  classifyAttempts: number;
  /** Set on a reply threaded to a LEAD cadence; NULL on every other row. */
  leadId: string | null;
}

/**
 * Every inbound reply still waiting on a label, oldest first.
 *
 * ── THE THREE PREDICATES, EACH FOR A DIFFERENT REASON ───────────────────────
 *
 *  `label IS NULL`              — this is the queue. A labelled row is done, and
 *                                 there is no re-classification path: a label is
 *                                 a record of what a model said at a moment, and
 *                                 quietly replacing it would destroy the only
 *                                 evidence of the first answer.
 *  `attribution <> 'dead_letter'` — a dead-letter row's `body` is whatever
 *                                 survived a payload we could not parse. There
 *                                 is no customer sentence in it to classify, and
 *                                 sending it to a model is spending a call to
 *                                 label our own parse failure.
 *  `classify_attempts < N`      — the poisoned-row stop; see the constant.
 *
 * OLDEST FIRST (`received_at`, `id` as the tie-break, the house rule), because
 * a reply that has been waiting eleven minutes matters more than one that
 * arrived during this tick, and because a batch whose order depends on the
 * planner is a batch nobody can reproduce.
 */
export async function listUnclassified(
  limit: number = CLASSIFY_BATCH_SIZE,
): Promise<UnclassifiedRow[]> {
  return getDb()
    .select({
      id: inboundMessages.id,
      body: inboundMessages.body,
      receivedAt: inboundMessages.receivedAt,
      classifyAttempts: inboundMessages.classifyAttempts,
      leadId: inboundMessages.leadId,
    })
    .from(inboundMessages)
    .where(
      and(
        isNull(inboundMessages.label),
        ne(inboundMessages.attribution, 'dead_letter'),
        lt(inboundMessages.classifyAttempts, MAX_CLASSIFY_ATTEMPTS),
      ),
    )
    .orderBy(asc(inboundMessages.receivedAt), asc(inboundMessages.id))
    .limit(limit);
}

/**
 * The FIVE columns a classification may set, and there is no sixth.
 *
 * 2026-10 (Phase 13, plan 13-03): `urgency` added — the model's D-05 judgement
 * on a LEAD reply, written with the label (`inbound_messages_lead_label_has_urgency`)
 * and NULL on every quote reply (`inbound_messages_urgency_lead_only`).
 * `keyword_hot` is deliberately NOT here: it is the door's column (D-06), and
 * a classification that could write it could overwrite a keyword hot with a
 * cold verdict.
 */
export interface ClassificationWrite {
  label: string;
  labelConfidence: string;
  isHot: boolean;
  /** One of LEAD_URGENCIES on a lead reply; `null` on a quote reply. */
  urgency: string | null;
  classifiedAt: Date;
}

/**
 * Record one classification. THE ONLY WRITER of `label`, `label_confidence`,
 * `is_hot`, `urgency` and `classified_at` — and the only write model output
 * can cause.
 *
 * GUARDED ON `label IS NULL`, in the house style (`markInboundTriaged`,
 * `pauseWhereActive`, `updateDeliveryWhereMatch`). Two ticks overlapping on one
 * row — a slow model call and a fast one, or a redeploy mid-pass — must not let
 * the second answer overwrite the first. The first label is the one an operator
 * may already have acted on, and a silent replacement would leave `is_hot`
 * flipping under a human's hands with nothing in the record to explain it.
 *
 * Returns whether THIS call did the write, so the caller can tell "labelled" from
 * "somebody else labelled it first" — both are fine, only one is news.
 */
export async function writeClassification(
  id: string,
  write: ClassificationWrite,
): Promise<{ classified: boolean }> {
  const rows = await getDb()
    .update(inboundMessages)
    // ── THE PINNED SET LIST. Five columns (2026-10, Phase 13: `urgency`
    //    added, plan 13-03). Adding a sixth here is adding a capability to
    //    model output, and `tests/classification-privilege.test.ts` is written
    //    to fail when this list changes. `keyword_hot` is NEVER in it (D-06).
    .set({
      label: write.label,
      labelConfidence: write.labelConfidence,
      isHot: write.isHot,
      urgency: write.urgency,
      classifiedAt: write.classifiedAt,
    })
    .where(and(eq(inboundMessages.id, id), isNull(inboundMessages.label)))
    .returning({ id: inboundMessages.id });

  return { classified: rows.length > 0 };
}

/**
 * Count one failed attempt. ONE COLUMN.
 *
 * Incremented in the database rather than read-modify-written in the caller, so
 * two overlapping ticks cannot both read 2 and both write 3 — which is precisely
 * how a cap that exists to bound a burn stops bounding it.
 *
 * Note what this does NOT do: it writes no label, so a row whose attempts are
 * being counted stays visibly unclassified to the operator. "We tried and could
 * not" and "we said `other`" are different facts and are recorded differently.
 */
export async function bumpClassifyAttempts(id: string): Promise<void> {
  await getDb()
    .update(inboundMessages)
    .set({ classifyAttempts: sql`${inboundMessages.classifyAttempts} + 1` })
    .where(eq(inboundMessages.id, id));
}

/** One client's count of cold lead replies — a tenant id and a number. */
export interface ColdLeadReplyCount {
  tenantId: string;
  count: number;
}

/**
 * HOW MANY COLD LEAD REPLIES ARE WAITING IN THE INBOX, PER CLIENT, SINCE
 * `since` (Phase 13, D-08) — the 06:30 digest's "cold lead replies" line.
 *
 * A reply is COLD when it is threaded to a lead (`lead_id` set), classified
 * (`label IS NOT NULL`), and hot by neither column (`is_hot = false` AND
 * `keyword_hot = false`): it reached nobody's handset, so the operator's digest
 * is where the tradie hears about it. Hot ones were escalated; unclassified
 * ones are not judged yet.
 *
 * WAITING means untriaged (`triaged_at IS NULL`; 13-REVIEW CR-01/IN-04): every
 * row counted here is a row `listInboundNeedingTriage`'s lead arm shows, so
 * "waiting in the inbox" is true when the operator opens it, and a reply marked
 * handled yesterday afternoon is not counted again this morning.
 *
 * COUNTS ONLY — no id, no body, no number leaves this read. It lives here, in
 * the inbound family, and NOT as a `forAllTenants_*` export: it reads this one
 * table and joins nothing, and the cross-tenant export count is pinned at
 * sixteen. Rows with no tenant (unattributed) cannot be threaded and so are
 * excluded by the `threaded` predicate.
 */
export async function countColdLeadRepliesSince(since: Date): Promise<ColdLeadReplyCount[]> {
  const rows = await getDb()
    .select({
      tenantId: inboundMessages.tenantId,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(inboundMessages)
    .where(
      and(
        eq(inboundMessages.attribution, 'threaded'),
        isNotNull(inboundMessages.tenantId),
        isNotNull(inboundMessages.leadId),
        gte(inboundMessages.receivedAt, since),
        isNotNull(inboundMessages.label),
        eq(inboundMessages.isHot, false),
        eq(inboundMessages.keywordHot, false),
        isNull(inboundMessages.triagedAt),
      ),
    )
    .groupBy(inboundMessages.tenantId)
    .orderBy(asc(inboundMessages.tenantId));

  // The predicate makes `tenantId` non-null; narrowed, not cast.
  return rows.flatMap((row) =>
    row.tenantId !== null ? [{ tenantId: row.tenantId, count: row.count }] : [],
  );
}
