/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CAD-04. THE STRUCTURAL NEVER-TWICE. This table's unique index is the      │
 * │ product guarantee that a customer is never messaged twice for the same    │
 * │ touch — not a promise application code makes, a fact Postgres enforces.   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The uniqueness constraint IS the concurrency guarantee — the same argument
 * `sm8_connections.tenant_id` makes, applied to the one place where losing the
 * race is visible to a real customer.
 *
 * Dispatch CLAIMS BEFORE IT SENDS:
 *
 *     INSERT INTO send_ledger (cadence_id, touch_number, …)
 *     ON CONFLICT (cadence_id, touch_number) DO NOTHING
 *     RETURNING id;
 *
 * Zero rows returned is a MEANINGFUL ANSWER, not an error: another process
 * already owns this touch, so this one refuses silently. `FOR UPDATE SKIP
 * LOCKED` gives liveness (overlapping ticks skip rather than block); this index
 * gives correctness even when SKIP LOCKED is bypassed entirely — a second
 * deployment, a manual invocation, a cron that fired twice. Application-level
 * "check if we already sent it" is a TOCTOU by construction, and the cost of
 * losing that race is the tradie's customer getting the same follow-up twice.
 *
 * ── WHY `outcome` IS NULLABLE, AND WHY THAT IS THE SAFE DIRECTION (D-13) ────
 *
 * The row is written BEFORE the sender is invoked, so between the claim and the
 * provider's reply there is legitimately no outcome. If the process dies in
 * that window the row survives with `outcome IS NULL`, and that state means
 * exactly one thing: WE DO NOT KNOW WHETHER THIS WENT OUT.
 *
 * Such a row is SURFACED TO THE OPERATOR AND NEVER AUTO-RESENT. That is the
 * whole reason the column is nullable rather than defaulting to 'failed': a
 * default would let an unknown be silently reclassified as a definite
 * non-delivery, and the obvious follow-up action for a definite non-delivery is
 * to retry — which is precisely how a customer gets messaged twice. "A late or
 * duplicate touch is worse than a skipped touch" is the product rule; an
 * honest NULL is how it survives a crash.
 *
 * ── NO FOREIGN KEYS, NO CASCADE (Phase 7 attribution evidence) ─────────────
 *
 * Same rationale as `quote_status_events.tenant_id`, verbatim: this is the
 * ledger the recovered-revenue report is computed from, and a disconnected
 * client must not take their own attribution history with them. Isolation is
 * enforced by the policy below, not by the reference.
 *
 * ── `sender` KEEPS STUB SENDS DISTINGUISHABLE FOREVER (D-13) ───────────────
 *
 * Phase 3 ships a stub sender: `sender = 'stub'`, `outcome = 'stub_sent'`.
 * Phase 4 writes `'clicksend'` / `'resend'`. Phase 7 MUST be able to exclude
 * stub rows from attribution, and it must still be able to do so years later
 * against rows written today — so the distinction lives in the data rather than
 * in a date range someone has to remember.
 *
 * ── DELIVERY IS A NEW FACT, NOT A NEW OUTCOME (plan 04-03) ──────────────────
 *
 * The four `delivery_*` columns record what the PROVIDER later said happened to
 * a message it had already accepted. They arrive asynchronously, minutes to
 * hours after `outcome` is already `'sent'`, on a callback we do not control.
 *
 * A DELIVERY RECEIPT NEVER WRITES `outcome`. The two columns answer different
 * questions and only one of them is ours to answer:
 *
 *   `outcome`         — did the provider ACCEPT this message from us?
 *   `delivery_status` — did the carrier get it to the handset?
 *
 * Folding an `undelivered` receipt back into `outcome = 'failed'` would erase
 * the fact that we did send it, and the obvious follow-up action for a `failed`
 * send is to try again — which is precisely how a customer gets messaged twice
 * for a message that a carrier merely could not confirm. Same argument as the
 * nullable `outcome` above, one boundary further out.
 *
 * `delivery_status IS NULL` means NO RECEIPT HAS ARRIVED — the ledger's own
 * NULL-means-unknown philosophy again, and the ordinary state of a row for the
 * first few seconds of its life and forever for a stub send. `'unknown'` is a
 * different claim: a receipt DID arrive and said something we could not map.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgPolicy,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

/**
 * What became of a claimed send.
 *
 *  stub_sent — Phase 3's stub sender logged instead of sending (D-13)
 *  sent      — a real provider accepted it
 *  failed    — a real provider refused it, and said so
 *
 * NULL is not in this list and is not a fourth value: it is the ABSENCE of an
 * answer. See the header.
 */
export const SEND_LEDGER_OUTCOMES = ['stub_sent', 'sent', 'failed'] as const;
export type SendLedgerOutcome = (typeof SEND_LEDGER_OUTCOMES)[number];

/**
 * What a delivery receipt told us, NORMALIZED across providers.
 *
 *  delivered   — the carrier confirmed it reached the handset / inbox
 *  undelivered — the carrier confirmed it did NOT, and said so
 *  unknown     — a receipt arrived carrying a status we could not map
 *
 * NULL is not in this list and is not a fourth value: it is the ABSENCE of a
 * receipt. `'unknown'` means one CAME and was unreadable, which is a different
 * fact and a different operator response (look at `delivery_detail`) from "none
 * has arrived yet". See the header.
 *
 * Three values rather than a per-provider passthrough because the operator's
 * screen and Phase 7's attribution both read this column, and neither should
 * have to know ClickSend's status vocabulary. The provider's own word survives
 * verbatim beside it in `delivery_detail`.
 */
export const DELIVERY_STATUSES = ['delivered', 'undelivered', 'unknown'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const sendLedger = pgTable(
  'send_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** No FK, no cascade — see the header. */
    tenantId: uuid('tenant_id').notNull(),
    cadenceId: uuid('cadence_id').notNull(),
    /**
     * The quote this send chased, for a quote cadence; NULL for a lead
     * cadence's text-back (Phase 12). Exactly one of `quote_id` / `lead_id` is
     * set (`send_ledger_one_owner`). Attribution groups by quote, and a NULL
     * never equals a quote id, so a text-back can never be counted as a touch
     * on somebody's quote.
     */
    quoteId: uuid('quote_id'),
    /**
     * The `leads.id` a text-back belongs to (Phase 12, D-04); NULL on every
     * quote send. No FK, the evidence posture.
     */
    leadId: uuid('lead_id'),

    touchNumber: smallint('touch_number').notNull(),
    /** One of TOUCH_CHANNELS ('sms' | 'email'). */
    channel: text('channel').notNull(),

    /**
     * The NORMALIZED recipient as it stood at claim time, stored rather than
     * joined: this is evidence of who was actually messaged, and the contact
     * mirror it came from re-syncs.
     */
    toAddress: text('to_address').notNull(),

    /** 'stub' now; 'clicksend' / 'resend' from Phase 4. See the header. */
    sender: text('sender').notNull(),

    /** One of SEND_LEDGER_OUTCOMES, or NULL for "we do not know". */
    outcome: text('outcome'),
    /** The provider's own id, for reconciling delivery receipts. NULL for stub. */
    providerMessageId: text('provider_message_id'),

    /** When the claim was won — i.e. when this row came into existence. */
    claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * The NORMALIZED delivery verdict. One of DELIVERY_STATUSES, or NULL for
     * "no receipt has arrived". See the header — this column NEVER feeds back
     * into `outcome`.
     *
     * Deliberately NOT check-constrained, unlike every other vocabulary in this
     * schema. The values are derived from a third party's status codes on a
     * callback whose shape is LOW-confidence research, and a CHECK here would
     * turn a provider adding a status into a 23514 raised inside the DLR route —
     * where the provider's response to an error is to retry for 72 hours. The
     * mapping is closed in TypeScript (plan 04-04 owns it) and `'unknown'`
     * exists precisely so an unmappable code has an honest home rather than
     * needing a new one.
     */
    deliveryStatus: text('delivery_status'),

    /**
     * The provider's own status or error CODE, verbatim — e.g. `'Delivered'`,
     * `'Undelivered'`, an error number. A CODE ONLY, NEVER PROVIDER PROSE: an
     * error message from a third party is free text we do not control, it can
     * quote the request (which carries a customer's mobile), and this column is
     * rendered on the operator's screen. Same rule the ServiceM8 client and the
     * operator-alert path already follow — names and codes cross the boundary,
     * messages do not.
     */
    deliveryDetail: text('delivery_detail'),

    /**
     * When the CARRIER says it reached the handset. Set only for a
     * `'delivered'` verdict; NULL otherwise, including for an undelivered one —
     * "when did the non-delivery happen" is not a fact this column can hold
     * without lying about what it means.
     */
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),

    /**
     * When WE processed a receipt for this row. Deliberately separate from
     * `delivered_at` and deliberately our clock, not theirs: this is the column
     * that answers "have we heard anything back yet, and how long ago", which is
     * the operator's question, and a third party's timestamp cannot answer it.
     * Also the idempotence witness — a re-delivered callback moves this and
     * changes nothing else.
     */
    deliveryUpdatedAt: timestamp('delivery_updated_at', { withTimezone: true }),
  },
  (table) => [
    /** THE never-twice constraint (CAD-04). See the header. */
    uniqueIndex('send_ledger_cadence_touch_uniq').on(table.cadenceId, table.touchNumber),

    /** Phase 7's per-client, per-period attribution read. */
    index('send_ledger_tenant_claimed_idx').on(table.tenantId, table.claimedAt),

    /** Phase 7 reads the ledger BY QUOTE — the evidence chain and report line. */
    index('send_ledger_tenant_quote_idx').on(table.tenantId, table.quoteId),

    /** Phase 15 reads text-backs by lead — the lead queue and its report line. */
    index('send_ledger_tenant_lead_idx').on(table.tenantId, table.leadId),

    /**
     * EXACTLY ONE OWNER (Phase 12, D-05). Every pre-0039 row has a quote id and
     * no lead id, so this holds over existing data by construction.
     */
    check('send_ledger_one_owner', sql`(quote_id IS NOT NULL) <> (lead_id IS NOT NULL)`),

    pgPolicy('send_ledger_member_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`has_tenant_access(tenant_id)`,
      withCheck: sql`has_tenant_access(tenant_id)`,
    }),
  ],
);

export type SendLedgerRow = typeof sendLedger.$inferSelect;
export type NewSendLedgerRow = typeof sendLedger.$inferInsert;
