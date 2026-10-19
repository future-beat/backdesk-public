/**
 * Every dollar we claim we recovered, and the proof it was ours. EVIDENCE.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS TABLE IS THE INVOICE'S EVIDENCE. RPT-01's whole claim is that the   │
 * │ monthly bill arrives stapled to proof it paid for itself. A recovered-   │
 * │ revenue figure with no per-quote row behind it is a marketing sentence;  │
 * │ these rows are what let a tradie point at ONE job and see which of our   │
 * │ follow-ups preceded the win, when each went out, and what the figure was │
 * │ computed from.                                                           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── THE EVIDENCE FAMILY RULES, RESTATED (escalations.ts, send-ledger.ts) ────
 *
 *   * `tenant_id` is a COLUMN, not a foreign key, and there is NO CASCADE from
 *     `tenants`. A client who disconnects must not take the record of what we
 *     recovered on their behalf with them — the same rule `quote_status_events`,
 *     `send_ledger`, `suppressed_contacts`, `inbound_messages`, `touch_drafts`
 *     and `escalations` all follow. `quote_id`, `sm8_job_uuid` and
 *     `won_event_id` are denormalized for correlation and carry no foreign key
 *     either: an attribution outlives the quote mirror row, the cadence and the
 *     touches it was computed from (D-05).
 *   * RLS is authored HERE, as a `pgPolicy`, so a new table cannot ship
 *     unprotected by omission (the Phase 1 rule).
 *   * READ-ONLY to `authenticated`; every write is service-role. The console
 *     never inserts here — the attribution consumer does, inside the tick that
 *     read the `won` event. Migration 0033 grants SELECT only, and the argument
 *     is written there: A CONSOLE-WRITTEN ROW IS FABRICATED BILLED REVENUE.
 *
 * ── UNIQUE (tenant_id, quote_id) IS THE NEVER-TWICE CLAIM (D-04) ────────────
 *
 * ONE QUOTE IS ATTRIBUTED AT MOST ONCE, EVER — decided by POSTGRES rather than
 * by a check-then-insert two overlapping ticks can both pass. The first
 * qualifying win wins; a later reopen→win cycle on the same quote, a second
 * sequential cadence, and a replayed `won` event all produce ZERO rows rather
 * than a second one. The failure this prevents is specific and expensive: the
 * same job billed to the client twice, in a document whose entire value is that
 * the client can check it against their own ServiceM8 account.
 *
 * It is tenant-scoped, not global, for the `quotes_tenant_job_uniq` reason
 * (quotes.ts:11-17): two clients could in principle be handed the same job uuid
 * by a shared ServiceM8 account, and one tenant's win must never consume
 * another tenant's claim.
 *
 * The claim is made the `send_ledger` / `escalations` way — targetless
 * `INSERT … ON CONFLICT DO NOTHING RETURNING id`, and zero rows is a MEANINGFUL
 * ANSWER the consumer reports rather than an error it retries. Targetless
 * because a named arbiter turns a conflict on another index into a 23505 raised
 * inside the run transaction, which the consumer reads as a blocked run and
 * which holds the shared cursor for every tenant (cadences.ts:95-101).
 *
 * ── THE ROW IS A SNAPSHOT, AND EVERY INPUT IS FROZEN INTO IT (D-03/D-05) ────
 *
 * `gross_cents` is `quotes.total_invoice_amount` AS IT STOOD at consumption,
 * copied in rather than joined. ServiceM8 lets a tradie edit a job's value after
 * the fact; a report that re-read the mirror would silently restate a figure a
 * client was already sent. `baseline_rate_bp`, `baseline_source`,
 * `baseline_sample` and `window_days` are here for the same reason — the whole
 * arithmetic must be reproducible from THIS ROW after the cadence, the touches
 * and the quote mirror are gone.
 *
 * `window_days` in particular is D-01's reversibility escape hatch: changing
 * `ATTRIBUTION_WINDOW_DAYS` later leaves months computed under two rules, and
 * this column is what tells them apart afterwards.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  integer,
  jsonb,
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
 * WHERE the money figure came from, AS WE DECIDED IT.
 *
 *  mirror  — `quotes.total_invoice_amount` was present and parsed; `gross_cents`
 *            is that value.
 *  missing — the quote mirror row was GONE when the win arrived (an ops purge
 *            plus a re-sync under a fresh job uuid does this), so there was no
 *            value to snapshot. `gross_cents` is 0 and the report renders the
 *            line as "value unavailable" so an operator can raise it by hand.
 *
 * RECORDED RATHER THAN SKIPPED, and this is the point of the vocabulary: a
 * zero-dollar attribution and an attribution whose dollar figure we could not
 * read are different facts with different operator responses, and a bare
 * `gross_cents = 0` cannot tell them apart. The claim is still made either way —
 * the `won` event is consumed exactly once, and holding the cursor for a missing
 * mirror row would stall every other client's attribution behind it.
 *
 * CHECK-constrained in migration 0033 (the house rule from 0004/0008/0011/0017):
 * the writer is service-role and the TypeScript union erases before the INSERT
 * is built, so the constraint is what catches a typo.
 */
export const ATTRIBUTION_VALUE_SOURCES = ['mirror', 'missing'] as const;
export type AttributionValueSource = (typeof ATTRIBUTION_VALUE_SOURCES)[number];

/**
 * The column's `text` narrowed to the union it is CHECK-constrained to (WR-11).
 *
 * Drizzle types `value_source` as `string` because the vocabulary lives in a
 * constraint rather than a pg enum, so every reader has to narrow it — and the
 * report generator was doing so with an inline ternary at two call sites, which
 * is the closed vocabulary written out a third and fourth time. One function,
 * beside the constant it is derived from.
 *
 * ANYTHING UNRECOGNISED READS AS `mirror`, matching the ternary it replaces:
 * these rows are billing evidence and the constraint already makes the case
 * unreachable, so the narrowing must not introduce a throw on a frozen document's
 * read path.
 */
export function asAttributionValueSource(raw: string): AttributionValueSource {
  return raw === 'missing' ? 'missing' : 'mirror';
}

/**
 * WHICH baseline the conservative figure was netted against (D-06/D-08/D-09).
 *
 *  connect — the client's own pre-service win rate, measured at connect time
 *            over their real ServiceM8 history.
 *  default — the client had too little history to measure one, so the
 *            conservative published default stood in.
 *
 * Stored per row, not looked up at report time, because a client's measured
 * baseline is backfilled and re-measured — and a report already handed over must
 * keep saying what it actually said. `baseline_sample` beside it is what makes
 * "measured" auditable: a rate with no sample size is a number somebody chose.
 *
 * CHECK-constrained in migration 0033.
 */
export const BASELINE_SOURCES = ['connect', 'default'] as const;
export type BaselineSource = (typeof BASELINE_SOURCES)[number];

export const quoteAttributions = pgTable(
  'quote_attributions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** No foreign key, no cascade — see the header. */
    tenantId: uuid('tenant_id').notNull(),

    /**
     * OUR quote row id — and, with `tenant_id`, the never-twice key.
     *
     * No foreign key: `quotes` is a MIRROR that a purge-and-re-sync can replace,
     * and an attribution must survive that. See the header.
     */
    quoteId: uuid('quote_id').notNull(),

    /**
     * ServiceM8's own job uuid as it stood at attribution — what an operator
     * types into ServiceM8 to check the line. NULLABLE, and null means the
     * mirror row was already gone when the win arrived (`value_source =
     * 'missing'`): the absence of a job uuid is a fact worth recording, not a
     * value to invent.
     */
    sm8JobUuid: uuid('sm8_job_uuid'),

    /**
     * The `quote_status_events.id` of the `won` event this row was computed
     * from — the outbox entry that justifies the claim. No foreign key (the
     * outbox is evidence too, and neither owns the other).
     */
    wonEventId: bigint('won_event_id', { mode: 'number' }).notNull(),

    /**
     * The win's `detected_at`, NEVER its `occurred_at` — D-10's month key.
     *
     * `occurred_at` is ServiceM8's editable date and can move BACKWARDS relative
     * to detection (quote-events.ts:25-29), which would silently move a job
     * between months and change a closed report. `detected_at` is our clock and
     * cannot.
     */
    wonDetectedAt: timestamp('won_detected_at', { withTimezone: true }).notNull(),

    /**
     * The first and last QUALIFYING touch's `claimed_at` — the D-01 anchor and
     * the span the report prints per line.
     *
     * `claimed_at`, because `send_ledger` has no `sent_at`: the claim is won
     * immediately before the provider call, so it is the sent moment we have
     * (send-ledger.ts:155-156). Frozen here so the line survives the ledger
     * rows being gone.
     */
    firstTouchClaimedAt: timestamp('first_touch_claimed_at', {
      withTimezone: true,
    }).notNull(),
    lastTouchClaimedAt: timestamp('last_touch_claimed_at', {
      withTimezone: true,
    }).notNull(),

    /** How many ledger rows satisfied the D-02 predicate inside the window. */
    qualifyingTouchCount: smallint('qualifying_touch_count').notNull(),

    /**
     * INTEGER CENTS, in a `bigint` column read back as a JS number.
     *
     * NEVER a float column and never a float write (research A8): money that
     * rounds differently on two screens is a client ringing about their invoice.
     * `mode: 'number'` because postgres.js hands back `bigint` and `numeric` as
     * STRINGS otherwise, and core code should receive integers rather than
     * re-parse at every call site (Pitfall 10).
     *
     * `gross_cents` is the job's whole value; `conservative_cents` is that value
     * net of the client's own baseline win rate (D-07) — the figure the 3×
     * guarantee is measured against, and the smaller of the two by construction.
     * 0 for both when `value_source = 'missing'`.
     */
    grossCents: bigint('gross_cents', { mode: 'number' }).notNull(),
    conservativeCents: bigint('conservative_cents', { mode: 'number' }).notNull(),

    /** One of ATTRIBUTION_VALUE_SOURCES. CHECK-constrained in migration 0033. */
    valueSource: text('value_source').notNull(),

    /**
     * The baseline win rate in BASIS POINTS (integer), not a float ratio.
     * 1200 = 12.00%. Integers all the way through for the money reason above.
     */
    baselineRateBp: smallint('baseline_rate_bp').notNull(),
    /** One of BASELINE_SOURCES. CHECK-constrained in migration 0033. */
    baselineSource: text('baseline_source').notNull(),
    /**
     * How many historical quotes the measured baseline was computed over.
     * NULL when `baseline_source = 'default'` — there was no sample. NULL and 0
     * are different answers here and are never conflated.
     */
    baselineSample: integer('baseline_sample'),

    /**
     * The `ATTRIBUTION_WINDOW_DAYS` this row was computed under. See the header:
     * D-01's reversibility depends entirely on this column existing.
     */
    windowDays: smallint('window_days').notNull(),

    /**
     * The D-05 evidence chain: ledger row ids and touch numbers with their sent
     * moments, threaded inbound message ids with labels, the escalation id if
     * one fired, the cadence id(s), and the baseline and constants used.
     *
     * DELIBERATELY TYPED AS AN OPAQUE OBJECT HERE. The zod contract that gives
     * it shape lives in `src/core/attribution/evidence.ts`, and the schema stays
     * agnostic so the two modules do not have to cross-import. What matters at
     * this layer is that the column is `NOT NULL`: an attribution row with no
     * chain is an assertion, and this table exists so that nothing here is an
     * assertion.
     *
     * NO ADDRESSES AND NO MESSAGE BODIES, at any depth — the evidence schema
     * enforces that, and the reason is that this jsonb is rendered on a page and
     * copied into a frozen report a client receives.
     */
    evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull(),

    /** When WE recorded the claim — our clock, defaulted by the database. */
    attributedAt: timestamp('attributed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    /** THE NEVER-TWICE CLAIM (D-04). See the header. */
    uniqueIndex('quote_attributions_one_per_quote').on(table.tenantId, table.quoteId),

    /**
     * The D-10 calendar-month read: every attribution whose win was DETECTED
     * inside `[start, end)` for one client, which is exactly what one monthly
     * report is computed from.
     */
    index('quote_attributions_tenant_won_idx').on(table.tenantId, table.wonDetectedAt),

    pgPolicy('quote_attributions_member_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`has_tenant_access(tenant_id)`,
      withCheck: sql`has_tenant_access(tenant_id)`,
    }),
  ],
);

export type QuoteAttribution = typeof quoteAttributions.$inferSelect;
export type NewQuoteAttribution = typeof quoteAttributions.$inferInsert;
