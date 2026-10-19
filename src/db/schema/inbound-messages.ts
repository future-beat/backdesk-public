/**
 * Every inbound message we received, and what we decided it was. EVIDENCE.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ EVERY INBOUND IS RECORDED, INCLUDING THE ONES WE COULD NOT PLACE.        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The reason this table exists rather than a `last_reply_at` column on
 * `cadences`: a reply we cannot attribute is the single most important row in
 * the system and the one a column cannot hold. A customer texting STOP from a
 * number we have never seen — a spouse's phone, a work mobile, a number that
 * changed since the quote — has exercised a Spam Act right, and the only
 * acceptable outcome is that a human sees it. Dropping it (or worse, throwing at
 * the webhook boundary so the provider retries for 72 hours and then gives up)
 * turns a compliance event into silence.
 *
 * So the write is UNCONDITIONAL and the ATTRIBUTION IS HONEST. `attribution`
 * says how confident we are, `matched_cadence_count` says what we found, and
 * `candidate_tenant_ids` says who it could have been. None of those are
 * derivable after the fact: by the time an operator looks, the cadence that
 * would have matched may have stopped.
 *
 * ── NULLABLE `tenant_id`, AND THAT IS THE WHOLE DESIGN ──────────────────────
 *
 * A tenant-scoped table cannot hold a row belonging to nobody, and "belonging to
 * nobody" is exactly the state an unattributed reply is in. NULL means
 * unattributed — visible to the OPERATOR ONLY, via `is_operator()` in the policy
 * below, because showing an unplaced reply to a client would show them a message
 * that may be another client's customer.
 *
 * NO FOREIGN KEY AND NO CASCADE from `tenants`, the rule the whole evidence
 * family follows (see quote-events.ts, send-ledger.ts, suppressed-contacts.ts):
 * a client who disconnects must not take the record of what their customers
 * asked for with them. `cadence_id` and `quote_id` are denormalized for
 * correlation and carry no reference either — a reply outlives the cadence it
 * was threaded to.
 *
 * ── REPLIES THREAD AGAINST THE CADENCE SNAPSHOT, NEVER `quote_contacts` ─────
 *
 * `quote_contacts` rows are PER-JOB MIRRORS that re-sync: the row a cadence
 * selected can change its number, lose `sm8_active`, or be replaced wholesale by
 * the next poll. `cadences.contact_mobile` is the normalized snapshot taken at
 * creation (see cadences.ts, "THE CONTACT SNAPSHOT"), it is the string
 * suppression and dispatch already probe on, and it is therefore the ONLY thing
 * an inbound may be matched against. Threading on the mirror would mean a reply
 * matching or not matching depending on when the last sync ran.
 *
 * `normalized_from` is `normalizeAuMobile(from_address)` — the SAME normalizer
 * the snapshot was built with, so `0412 345 678` and `+61412345678` are one
 * human and one lookup key. `from_address` keeps the raw provider string beside
 * it because when normalization FAILS (null), the raw value is the only thing an
 * operator has to triage with.
 *
 * ── TWO LABEL VOCABULARIES, CHOSEN BY `lead_id` (Phase 13, D-05) ────────────
 *
 * A reply threaded to a LEAD cadence (`lead_id` set) is labelled in
 * LEAD_LABELS, with an `urgency`; every other row is labelled in the quote
 * vocabulary INBOUND_LABELS, with no urgency. `inbound_messages_label_known`
 * enforces the pairing by `lead_id`, because this table has no `kind` column
 * and `lead_id` is exactly "this conversation is a lead". Unmatched and
 * ambiguous rows have `lead_id` NULL and so fall under the QUOTE arm — harmlessly,
 * because they are never classified (only threaded rows reach the classifier),
 * so they never carry a label of either kind.
 *
 * ── THE BODY IS STORED HERE AND LOGGED NOWHERE (T-2-02, T-4-02) ─────────────
 *
 * `body` and `from_address` are customer content behind RLS. Nothing that
 * handles an inbound may write either to a platform log — ids and counts only.
 * The distinction is deliberate: a row in this table is readable by whoever the
 * policy admits, while a Vercel log line is readable by anyone with project
 * access, forever, and is not deletable per-customer.
 *
 * ── PSEUDONYMISATION (Phase 15, D-06/D-07) ───────────────────────────────────
 *
 * A LEAD row's `from_address` and `normalized_from` are replaced by keyed
 * hashes when its lead is pseudonymised, and `pseudonymised_at` is stamped;
 * `body` is untouched. `cadences.contact_mobile` and `send_ledger.to_address`
 * are hashed on the SAME pass under the lead's stamp and carry no stamp of
 * their own (D-07: three stamp columns, no more).
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgPolicy,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

/**
 * How confident we are about WHOSE conversation this message belongs to.
 *
 * A CLOSED VOCABULARY, CHECK-constrained below rather than merely typed, for the
 * reason migration 0017 gives about every other vocabulary in this schema: the
 * writer is service-role code and the union erases before the INSERT is built,
 * so a typo would produce a row that no `attribution = …` predicate ever matches
 * — a reply that is in the table and invisible to the triage screen that exists
 * to find it.
 *
 *  threaded    — exactly ONE live cadence matched the normalized sender. This is
 *                the only value that permits an automatic write (suppression,
 *                pause) against a cadence.
 *  ambiguous   — more than one live cadence matched, across one or more tenants.
 *                `candidate_tenant_ids` holds who. NOTHING is written
 *                automatically: acting on a guess would pause or suppress the
 *                wrong client's customer, and the D-06 suppression is one-way.
 *  unmatched   — zero live cadences matched, or the sender could not be
 *                normalized at all. Not an error; the ordinary case for a stale
 *                number, a wrong number, or a reply arriving after the cadence
 *                stopped.
 *  dead_letter — the payload itself could not be understood (shape rejected at
 *                the boundary). `raw_payload` holds what arrived, so a provider
 *                changing its callback shape is a diagnosable event rather than
 *                a silent gap in the record.
 */
export const INBOUND_ATTRIBUTIONS = [
  'threaded',
  'ambiguous',
  'unmatched',
  'dead_letter',
] as const;
export type InboundAttribution = (typeof INBOUND_ATTRIBUTIONS)[number];

/**
 * WHAT the customer said (AI-02, Phase 5) — as distinct from `attribution`,
 * which is whose conversation it belongs to. The two are independent: an
 * unattributable reply still has a meaning, and a perfectly threaded one may be
 * unclassifiable.
 *
 * UNDERSCORE SPELLING THROUGHOUT — `not_interested`, `opt_out`. Decided once,
 * here, because this vocabulary has to be BYTE-IDENTICAL in three places that
 * cannot check each other: this const, the CHECK constraint below, and the zod
 * enum the model's structured output is parsed against
 * (src/core/classification/schema.ts). A hyphen in one of them produces a label
 * the model returns, zod accepts, and Postgres rejects at 3am — or worse, one
 * Postgres accepts and no `label = …` predicate matches.
 *
 *  interested     — wants to proceed, or is asking to book
 *  question       — needs information before deciding
 *  objection      — price, timing, or scope is the obstacle
 *  not_interested — a soft no. NOT an opt-out: they declined this quote, they
 *                   did not withdraw consent to be contacted about others.
 *  opt_out        — withdrawal of consent. NOTE this is the SEMANTIC label, and
 *                   it is NOT what honours a STOP: `is_stop` above is set by the
 *                   deterministic `isStopMessage()` matcher at the webhook, before
 *                   any model runs, and THAT is what writes suppression. A model
 *                   is not permitted to be the thing standing between a customer
 *                   and their Spam Act right — this label exists so an opt-out
 *                   phrased as a sentence reaches a human, not so an LLM can
 *                   decide a compliance question.
 *  other          — none of the above, including gibberish and wrong numbers.
 */
export const INBOUND_LABELS = [
  'interested',
  'question',
  'objection',
  'not_interested',
  'opt_out',
  'other',
] as const;
export type InboundLabel = (typeof INBOUND_LABELS)[number];

/**
 * How sure the classifier was. Three buckets rather than a float, because the
 * only consumer is a human triage queue asking "must I look at this myself",
 * and a 0.73 invites a threshold nobody can justify.
 */
export const LABEL_CONFIDENCES = ['high', 'medium', 'low'] as const;
export type LabelConfidence = (typeof LABEL_CONFIDENCES)[number];

/**
 * WHAT A CALLER SAID in reply to a lead message (Phase 13, D-05) — the lead
 * twin of INBOUND_LABELS, written only on a row whose `lead_id` is set.
 *
 * SAME BYTE-IDENTITY RULE as the quote vocabulary: this const, the lead arm of
 * `inbound_messages_label_known` below, and the zod enum the classifier's
 * structured output is parsed against must spell every member identically,
 * underscores throughout. `question`, `opt_out` and `other` appear in both
 * vocabularies with the same spelling and their own lead meanings.
 *
 *  new_enquiry      — wants work done: describes a job, asks for a quote or a visit
 *  callback_request — asks the tradie to ring them back
 *  question         — asks something (price, availability, area) before deciding
 *  existing_job     — about work the tradie already did or has booked
 *  complaint        — unhappy with the tradie or with a past job
 *  not_a_lead       — a wrong number, a supplier, a sales call: not a customer
 *  already_sorted   — found someone else, or the problem went away
 *  spam             — automated or junk content
 *  opt_out          — asks not to be contacted. SEMANTIC only, like the quote
 *                     label: the deterministic STOP matcher at the webhook is
 *                     what honours a STOP, never a model
 *  other            — none of the above
 */
export const LEAD_LABELS = [
  'new_enquiry',
  'callback_request',
  'question',
  'existing_job',
  'complaint',
  'not_a_lead',
  'already_sorted',
  'spam',
  'opt_out',
  'other',
] as const;
export type LeadLabel = (typeof LEAD_LABELS)[number];

/**
 * HOW SOON the caller needs the work (Phase 13, D-05), judged by the model on
 * a lead reply and stored beside its label. `emergency` makes a lead reply hot
 * at any label except `spam`, `opt_out` and `not_a_lead` (D-07).
 *
 *  emergency — something is failing now: water, gas, power, lock-out, danger
 *  this_week — wants it soon, but nothing is failing
 *  flexible  — no time pressure stated or implied
 *  unknown   — the reply says nothing about timing
 */
export const LEAD_URGENCIES = ['emergency', 'this_week', 'flexible', 'unknown'] as const;
export type LeadUrgency = (typeof LEAD_URGENCIES)[number];

export const inboundMessages = pgTable(
  'inbound_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * NULL MEANS UNATTRIBUTED — see the header. No FK, no cascade.
     */
    tenantId: uuid('tenant_id'),
    /** The cadence this reply was threaded to, when exactly one matched. */
    cadenceId: uuid('cadence_id'),
    /** Denormalized from that cadence so triage can link without a join. */
    quoteId: uuid('quote_id'),
    /**
     * Denormalized from that cadence when it is a LEAD cadence (Phase 12): the
     * text-back's lead. NULL for a quote cadence and for an unthreaded reply.
     */
    leadId: uuid('lead_id'),

    /** `'sms'` today; `'email'` when the Phase 4 email arm lands. */
    channel: text('channel').notNull().default('sms'),

    /**
     * AS RECEIVED from the provider, never normalized. This is what a human
     * reads on the triage screen when `normalized_from` is NULL — i.e. exactly
     * when the normalizer refused it and the raw string is all there is.
     */
    fromAddress: text('from_address').notNull(),
    /**
     * `normalizeAuMobile(from_address)` — THE MATCHING KEY, and the one spelling
     * every lookup uses. NULL when normalization failed (a landline, a short
     * code, an international sender): such a message can never be threaded, and
     * a NULL here says so structurally rather than by an empty-string
     * convention that a `=` predicate would happily match against.
     */
    normalizedFrom: text('normalized_from'),
    /** Which of our numbers it arrived on. NULL until per-client numbers exist. */
    toAddress: text('to_address'),

    /**
     * The message text. DEFAULT '' rather than nullable: a provider can and does
     * deliver an empty-bodied SMS, and "" and "we do not know" are the same
     * useless fact here — unlike `send_ledger.outcome`, nothing branches on the
     * difference and no retry hangs off it.
     */
    body: text('body').notNull().default(''),
    /** The provider's own id — the reconciliation dedupe key (plan 04-04). */
    providerMessageId: text('provider_message_id'),

    /**
     * Whether `isStopMessage(body)` matched. STORED rather than recomputed:
     * the regex will change (new keywords, new edge cases), and a stored flag
     * records what we decided AT THE TIME, which is what a compliance question
     * months later is actually asking.
     */
    isStop: boolean('is_stop').notNull().default(false),

    /** One of INBOUND_ATTRIBUTIONS. CHECK-constrained below. */
    attribution: text('attribution').notNull(),
    /**
     * How many live cadences the normalized sender matched. 0 for unmatched,
     * 1 for threaded, ≥2 for ambiguous — recorded as a number rather than left
     * implicit in `attribution` because "two candidates" and "eleven" are
     * different triage problems.
     */
    matchedCadenceCount: smallint('matched_cadence_count').notNull().default(0),
    /**
     * Who it could have been, for an ambiguous row. The triage surface reads it.
     * NULL (not an empty array) when the question does not arise.
     */
    candidateTenantIds: uuid('candidate_tenant_ids').array(),

    /**
     * The unparseable callback, for `dead_letter` rows only. Kept OUT of the
     * happy path deliberately: storing every provider payload would duplicate
     * customer content into a jsonb blob nothing reads, and the retention story
     * for that is worse than the diagnostic value.
     */
    rawPayload: jsonb('raw_payload'),

    // --- Classification (AI-02, Phase 5) --------------------------------------
    //
    // ALL NULLABLE AND UNCLASSIFIED IS THE STARTING STATE. The webhook records
    // the message; a later tick pass classifies it. That ordering is deliberate:
    // the inbound path's one job is that nothing is dropped, and putting a model
    // call on it would make an Anthropic outage into replies we never recorded.

    /** One of INBOUND_LABELS. NULL = not yet classified. CHECK-constrained below. */
    label: text('label'),
    /** One of LABEL_CONFIDENCES. NULL with `label`. */
    labelConfidence: text('label_confidence'),
    /**
     * The escalation flag (D-15) — this one needs a human NOW. Stored rather
     * than derived from `label`, because what counts as hot is a product rule
     * that will change, and a derived view would retroactively rewrite what we
     * decided at the time about replies an operator has already worked.
     *
     * notNull with a default: unlike `label`, there is no useful "we do not
     * know" here. An unclassified reply is not hot until something says it is.
     */
    isHot: boolean('is_hot').notNull().default(false),

    /**
     * One of LEAD_URGENCIES (Phase 13, D-05). LEAD ROWS ONLY, and written with
     * the label: NULL while a lead row is unclassified and on every quote row.
     */
    urgency: text('urgency'),
    /**
     * The deterministic emergency-keyword hit (Phase 13, D-06), written at the
     * door before any model runs. ITS OWN COLUMN rather than a write to
     * `is_hot`, so classification — the single writer of `is_hot` — can never
     * overwrite a keyword hot with a cold verdict; the hot read is
     * `(is_hot OR keyword_hot)`. Lead rows only.
     */
    keywordHot: boolean('keyword_hot').notNull().default(false),
    /** When the classification was written. NULL with `label`. */
    classifiedAt: timestamp('classified_at', { withTimezone: true }),
    /**
     * How many times we have TRIED. Separate from `classified_at` being NULL,
     * which cannot distinguish "not reached yet" from "failed four times" —
     * and the second one is a row that must stop being retried and start being
     * shown to a human.
     */
    classifyAttempts: smallint('classify_attempts').notNull().default(0),

    /** Set when an operator marks the row handled (written by plan 04-06). */
    triagedAt: timestamp('triaged_at', { withTimezone: true }),

    /**
     * Set ONCE by the nightly pseudonymisation pass when this row's sender
     * number was replaced by a keyed hash (Phase 15, D-06). NULL means the row
     * still carries it; never cleared. Nullable with no default, so Phase 14
     * code meets the 0042 schema safely.
     */
    pseudonymisedAt: timestamp('pseudonymised_at', { withTimezone: true }),

    /**
     * When WE received it. Deliberately not the provider's own timestamp: that
     * is a claim by a third party about a clock we do not control, and this
     * column is the one an operator reads as "how long has this been sitting
     * here". A provider timestamp, if it ever matters, belongs in `raw_payload`.
     */
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** The threading lookup: every inbound asks "whose number is this?". */
    index('inbound_messages_normalized_from_idx').on(table.normalizedFrom),

    check(
      'inbound_messages_attribution_known',
      sql`attribution IN ('threaded', 'ambiguous', 'unmatched', 'dead_letter')`,
    ),

    /**
     * `IS NULL OR IN (…)` — unclassified is legal, misspelled is not. BY KIND
     * (Phase 13, D-05): a row with `lead_id` NULL takes the quote vocabulary,
     * whose spelling must match INBOUND_LABELS and the zod enum byte for byte;
     * a row with `lead_id` set takes the lead vocabulary, whose spelling must
     * match LEAD_LABELS and ITS zod enum byte for byte. See the vocabulary
     * comments above and the header's paragraph on unmatched rows.
     */
    check(
      'inbound_messages_label_known',
      sql`label IS NULL OR (lead_id IS NULL AND label IN ('interested', 'question', 'objection', 'not_interested', 'opt_out', 'other')) OR (lead_id IS NOT NULL AND label IN ('new_enquiry', 'callback_request', 'question', 'existing_job', 'complaint', 'not_a_lead', 'already_sorted', 'spam', 'opt_out', 'other'))`,
    ),
    check(
      'inbound_messages_label_confidence_known',
      sql`label_confidence IS NULL OR label_confidence IN ('high', 'medium', 'low')`,
    ),

    /** Phase 13 (D-05). The spelling must match LEAD_URGENCIES byte for byte. */
    check(
      'inbound_messages_urgency_known',
      sql`urgency IS NULL OR urgency IN ('emergency', 'this_week', 'flexible', 'unknown')`,
    ),
    /** Urgency is a lead fact: a quote reply never carries one. */
    check('inbound_messages_urgency_lead_only', sql`urgency IS NULL OR lead_id IS NOT NULL`),
    /** A labelled lead row always has its urgency; an unlabelled one has none. */
    check(
      'inbound_messages_lead_label_has_urgency',
      sql`lead_id IS NULL OR ((label IS NULL) = (urgency IS NULL))`,
    ),
    /** The keyword rule runs on lead replies only (D-06). */
    check('inbound_messages_keyword_hot_lead_only', sql`keyword_hot = false OR lead_id IS NOT NULL`),

    /** The label-effects pass (Phase 13, D-11): labelled lead replies by lead. */
    index('inbound_messages_lead_label_idx')
      .on(table.leadId, table.label)
      .where(sql`lead_id IS NOT NULL`),

    /**
     * TWO ARMS, AND THE SECOND ONE IS THE POINT (T-4-04).
     *
     * A tenant-scoped row is visible to that tenant's members, exactly like
     * every other table here. An UNATTRIBUTED row (`tenant_id IS NULL`) belongs
     * to nobody, so `has_tenant_access(NULL)` can never admit it — without the
     * `is_operator()` arm the rows that most need a human would be the only
     * rows no human could see.
     *
     * `is_operator()` reads an explicit allowlist (see operators.ts), NOT
     * "belongs to some tenant" — so a v2 client login can never satisfy it and
     * can never read another client's customer's message.
     */
    pgPolicy('inbound_messages_member_or_operator_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`(tenant_id IS NOT NULL AND has_tenant_access(tenant_id)) OR (tenant_id IS NULL AND is_operator())`,
      withCheck: sql`(tenant_id IS NOT NULL AND has_tenant_access(tenant_id)) OR (tenant_id IS NULL AND is_operator())`,
    }),
  ],
);

export type InboundMessage = typeof inboundMessages.$inferSelect;
export type NewInboundMessage = typeof inboundMessages.$inferInsert;
