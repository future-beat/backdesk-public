/**
 * Every hot-lead alert we sent a tradie, and what became of it. EVIDENCE.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS TABLE IS THE PROOF THAT "WITHIN MINUTES" IS TRUE. CON-03's whole    │
 * │ claim is that an interested reply reaches the tradie's hand fast enough  │
 * │ to call the customer back while they are warm. A claim with no recorded  │
 * │ timestamps is a marketing sentence; these rows are what let Phase 7 say  │
 * │ how many minutes it actually took, per client, per month.                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── THE EVIDENCE FAMILY RULES, VERBATIM (inbound-messages.ts, send-ledger.ts) ─
 *
 *   * `tenant_id` is a COLUMN, not a foreign key, and there is NO CASCADE from
 *     `tenants`. A client who disconnects must not take the record of what we
 *     did on their behalf with them — the same rule `quote_status_events`,
 *     `send_ledger`, `suppressed_contacts` and `inbound_messages` all follow.
 *     `cadence_id`, `quote_id` and `inbound_message_id` are denormalized for
 *     correlation and carry no reference either: an escalation outlives the
 *     cadence it was raised from.
 *   * RLS is authored HERE, as a `pgPolicy`, so a new table cannot ship
 *     unprotected by omission (the Phase 1 rule).
 *   * READ-ONLY to `authenticated`; every write is service-role. The console
 *     never inserts here — the escalation module does, inside the tick that set
 *     `is_hot`.
 *
 * ── WHY THE ESCALATION PATH BYPASSES DISPATCH, AND WHY THAT NEEDS A TABLE ───
 *
 * D-05: a hot-lead SMS goes to the TRADIE, directly through the ClickSend
 * client, skipping every customer-protection gate — no contact hours (a hot lead
 * at 7pm reaches them at 7pm), no approval gate, no suppression check (the
 * tradie is not a chased contact). Because it never touches `send_ledger`, which
 * is for cadence touches to customers, its evidence has nowhere else to live.
 * Writing it into the ledger would put a message to the business owner in the
 * table Phase 7 bills recovered revenue from.
 *
 * ── UNIQUE (inbound_message_id) IS THE NEVER-TWICE CLAIM (D-08) ─────────────
 *
 * One SMS per hot inbound message, decided by POSTGRES rather than by a
 * check-then-insert two overlapping ticks can both pass. The per-minute tick can
 * legitimately re-run over the same rows — pg_cron fires without waiting for the
 * previous response — and the failure this constraint prevents is specific: a
 * tradie's phone buzzing repeatedly about ONE customer reply, which is exactly
 * the noise that teaches them to ignore the next one.
 *
 * It is deliberately the same SHAPE as `send_ledger_cadence_touch_uniq`: claim
 * the row first, then send, so a crash between the two leaves a claimed row with
 * a NULL outcome rather than a second message.
 *
 * ── `outcome` IS NULLABLE, AND NULL MEANS "CLAIMED, OUTCOME UNKNOWN" ────────
 *
 * The 03-01 rule, restated because it is the one a later contributor is most
 * likely to "fix". A NOT NULL column with a `'failed'` default would reclassify
 * an unknown as a definite non-delivery — and the obvious response to a definite
 * non-delivery is a retry, which is how the tradie gets texted twice about one
 * lead. Values are bounded refusal/outcome CODES, never provider prose: an error
 * string from a third party can quote the request, and the request carries a
 * customer's mobile.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

/**
 * What became of one escalation attempt, AS DECIDED BY US.
 *
 *  sent                 — the provider accepted it from us
 *  no_escalation_number — the client has no escalation mobile on file (or the
 *                         one on file is not a textable AU mobile), so there
 *                         was nobody to alert. Recorded rather than skipped
 *                         silently: an operator needs to see that a hot lead
 *                         went nowhere, and the fix is a phone number they can
 *                         go and add.
 *  sms_not_configured   — no ENABLED `messaging_config` sms row applies to this
 *                         client, so the deployment is disarmed for them. The
 *                         refusal is recorded with ZERO provider calls, which
 *                         is what stops a test run — or a disarmed production —
 *                         paging a tradie about seeded data (D-04, Pitfall 2).
 *  cooldown_suppressed  — we already texted this tradie about this conversation
 *                         inside `ESCALATION_COOLDOWN_MINUTES`. Evidence, not a
 *                         silence: Phase 7 computes reach latency from these
 *                         rows and cannot distinguish a suppressed alert from a
 *                         missing one after the fact (D-08).
 *
 * ── AND ONE VALUE THAT IS NOT IN THIS LIST, DELIBERATELY ───────────────────
 *
 * A PROVIDER REFUSAL writes the bounded, redacted token `codeOf` produces from
 * ClickSend's own reason — `INVALID_RECIPIENT`, `INSUFFICIENT_CREDIT` — rather
 * than a flat `failed`. That is why the column carries no CHECK (migration 0032
 * says so in its own words: a provider adding a status must not raise a 23514
 * inside the tick that is trying to tell a tradie about a hot lead), and it is
 * why the two vocabularies are distinguishable by SHAPE: everything WE decide
 * is lower_snake_case, and everything a provider decided arrives UPPERCASE from
 * `codeOf`. A reader never has to guess which side of the boundary a value came
 * from.
 *
 *  lead_closed          — Phase 13 (D-09): a HELD escalation (`hold_until`) was
 *                         released for a lead that is no longer open — closed
 *                         by a label, expired, or lost to a quote cadence while
 *                         it waited for the contact window. Nothing is sent; the
 *                         row records why. Like the others this column carries
 *                         no CHECK, so the member needs no migration statement.
 *
 * NULL is not in this list and is not a member — see the header.
 */
export const ESCALATION_OUTCOMES = [
  'sent',
  'no_escalation_number',
  'sms_not_configured',
  'cooldown_suppressed',
  'lead_closed',
] as const;
export type EscalationOutcome = (typeof ESCALATION_OUTCOMES)[number];

export const escalations = pgTable(
  'escalations',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * The inbound reply this alert is ABOUT — and the never-twice key.
     * No FK: `inbound_messages` is evidence too, and neither owns the other.
     *
     * NULL when the trigger is a missed call instead (Phase 12, D-08/D-16):
     * exactly one of `inbound_message_id` / `missed_call_id` is set
     * (`escalations_one_trigger`), and each has its own never-twice index.
     */
    inboundMessageId: uuid('inbound_message_id'),

    /**
     * The missed call this alert is ABOUT, when an open-quote customer rang
     * the client (Phase 12, D-16) — the never-twice key for that trigger
     * (`escalations_missed_call_uniq`). No FK, the evidence posture.
     */
    missedCallId: uuid('missed_call_id'),

    /** No FK, no cascade — see the header. */
    tenantId: uuid('tenant_id').notNull(),
    cadenceId: uuid('cadence_id').notNull(),
    /**
     * Denormalized so attribution can group by quote without a join. NULL when
     * the conversation is on a lead cadence (Phase 12, D-05/D-18), which has
     * no quote.
     */
    quoteId: uuid('quote_id'),
    /** The `leads.id` of a lead-cadence conversation (Phase 12); else NULL. */
    leadId: uuid('lead_id'),

    /**
     * The TRADIE's mobile as it stood when the alert was raised, stored rather
     * than joined: this is evidence of who was actually notified, and the
     * client's own settings row can change afterwards.
     *
     * NOT a customer address — that distinction is why this column is here at
     * all while the queue accessor two files over carries none.
     *
     * THE EMPTY STRING MEANS "THERE WAS NO NUMBER", and it is the only value
     * that is not a mobile. The column stays NOT NULL because an alert that was
     * actually sent must always name its recipient; the row that could not be
     * sent still has to exist (it consumed the never-twice claim), and its
     * `outcome = 'no_escalation_number'` is what tells the two apart. A
     * nullable column would have made "we did not record who" and "there was
     * nobody" the same value.
     */
    toAddress: text('to_address').notNull(),

    /** Segments as the shared counter measured them, for cost attribution. */
    bodySegments: integer('body_segments'),

    /** When the provider accepted it. NULL until then, and on a refusal. */
    sentAt: timestamp('sent_at', { withTimezone: true }),
    /** The provider's own id, for reconciling a delivery receipt later. */
    providerMessageId: text('provider_message_id'),

    /** One of ESCALATION_OUTCOMES, or NULL for "we do not know". */
    outcome: text('outcome'),

    /**
     * Phase 13 (D-09): a hot LEAD outside the client's contact hours, with the
     * after-hours switch off, is claimed with the start of the next contact
     * window here instead of being sent. Claiming it (rather than recomputing
     * "is it held?" every tick) takes it OUT of the unescalated set, so a held
     * backlog can never starve the hot scan. NULL for every alert sent at once.
     */
    holdUntil: timestamp('hold_until', { withTimezone: true }),
    /**
     * When the release pass acted on a held row — sent it, or recorded why not.
     * Only a held row can be released (`escalations_release_needs_hold`).
     */
    releasedAt: timestamp('released_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** THE NEVER-TWICE CLAIM (D-08). See the header. */
    uniqueIndex('escalations_inbound_message_uniq').on(table.inboundMessageId),

    /**
     * THE NEVER-TWICE CLAIM for a missed-call trigger (Phase 12, D-16). Partial
     * on NOT NULL for documentation: NULLs are distinct anyway, and every
     * reply-triggered row carries NULL here.
     */
    uniqueIndex('escalations_missed_call_uniq')
      .on(table.missedCallId)
      .where(sql`missed_call_id IS NOT NULL`),

    /** Exactly one trigger per alert (Phase 12, D-16). */
    check(
      'escalations_one_trigger',
      sql`(inbound_message_id IS NOT NULL) <> (missed_call_id IS NOT NULL)`,
    ),

    /** Phase 7's per-client, per-period read. */
    index('escalations_tenant_created_idx').on(table.tenantId, table.createdAt),
    /**
     * The D-08 cooldown lookup: "have we already texted this tradie about this
     * conversation in the last N minutes". Keyed on the cadence because that is
     * what a conversation IS here — one quote, one customer, one chase.
     */
    index('escalations_cadence_created_idx').on(table.cadenceId, table.createdAt),

    /** Phase 13 (D-09): only a held row can be released. */
    check('escalations_release_needs_hold', sql`released_at IS NULL OR hold_until IS NOT NULL`),
    /** The release pass's read: held rows not yet released, oldest window first. */
    index('escalations_held_idx')
      .on(table.holdUntil)
      .where(sql`hold_until IS NOT NULL AND released_at IS NULL`),
    /**
     * Phase 14 (D-08): the DONE read — the lead escalation most recently SENT
     * to the tradie's number that just texted DONE, inside DONE_LOOKBACK_HOURS.
     */
    index('escalations_lead_to_address_sent_idx')
      .on(table.toAddress, sql`${table.sentAt} DESC`)
      .where(sql`lead_id IS NOT NULL`),

    pgPolicy('escalations_member_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`has_tenant_access(tenant_id)`,
      withCheck: sql`has_tenant_access(tenant_id)`,
    }),
  ],
);

export type Escalation = typeof escalations.$inferSelect;
export type NewEscalation = typeof escalations.$inferInsert;
