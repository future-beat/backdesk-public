/**
 * The local mirror of ServiceM8 jobs — the cadence engine's source of truth.
 *
 * WHY MIRROR AT ALL rather than querying ServiceM8 live: the cadence tick runs
 * every five minutes across every client and ServiceM8 allows 180 requests per
 * minute per account. More fundamentally, a follow-up decision needs to know
 * what changed SINCE last time, and an API that only reports current state
 * cannot answer that. The mirror is what makes "this quote went quiet" a
 * question we can ask.
 *
 * `(tenant_id, sm8_job_uuid)` UNIQUE is the upsert/dedupe key (RESEARCH
 * Pattern 1). The cursor deliberately re-fetches an overlap window, so the same
 * job arrives repeatedly by design; the constraint is what turns those repeats
 * into updates instead of duplicates. It is scoped by tenant rather than global
 * because two clients could in principle be handed the same job uuid by a
 * shared ServiceM8 account, and cross-tenant collision must be impossible
 * rather than unlikely.
 *
 * RAW + NORMALIZED TIMESTAMP PAIRS (SYNC-03): every ServiceM8 timestamp is
 * stored twice — the verbatim string, and a UTC instant computed by
 * interpreting that string in the tenant's IANA zone. The raw column is the
 * cursor basis and the audit trail; the UTC column is for display and grace
 * math. They are separate because reinterpreting a raw value later, after we
 * learn more about the account's real offset (A3), must not require re-fetching
 * from ServiceM8 — and because a normalization bug must never be able to
 * corrupt the cursor.
 *
 * ALL FOUR STATUSES ARE PERSISTED (D-16), not just open quotes. Win/loss
 * history is what the baseline (D-14) and the monthly recovered-revenue report
 * are computed from — dropping non-Quote rows would leave the product unable to
 * prove it worked.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  numeric,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

import { tenants } from './tenants';

/**
 * Verbatim from the ServiceM8 job reference — "Valid values: Quote, Work Order,
 * Unsuccessful, Completed". The lifecycle is fixed and cannot be customised per
 * account, which is why this is a closed vocabulary rather than free text.
 */
export const QUOTE_STATUSES = ['Quote', 'Work Order', 'Unsuccessful', 'Completed'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

/**
 * D-15. A quote pulled from the 90-day backfill has been sitting untouched for
 * up to three months; the client may have already spoken to that customer, or
 * written them off, or fallen out with them. Chasing it unreviewed is how the
 * service embarrasses a client in week one. `needs_review` is therefore the
 * DEFAULT and `eligible` is something an operator (or a fresh post-connect
 * arrival) grants deliberately.
 */
export const CHASE_ELIGIBILITIES = ['needs_review', 'eligible'] as const;
export type ChaseEligibility = (typeof CHASE_ELIGIBILITIES)[number];

/**
 * Which path put a quote row here. `lead` (Phase 14, D-05): pre-inserted by the
 * operator's create-job tap, inside the same unit of work as the job's
 * read-back, at `needs_review` — so the sync's first-sight rule finds a known
 * row and opens no quote cadence. It is STICKY in the upsert's conflict set
 * (plan 14-01 Task 2): the next poll must not turn it into `poll`. The spelling
 * matches `quotes_sync_source_known` below byte for byte.
 */
export const SYNC_SOURCES = ['backfill', 'poll', 'lead'] as const;
export type SyncSource = (typeof SYNC_SOURCES)[number];

export const quotes = pgTable(
  'quotes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sm8JobUuid: uuid('sm8_job_uuid').notNull(),

    /** One of QUOTE_STATUSES. */
    status: text('status').notNull(),
    /**
     * ServiceM8's `active` flag inverted into a boolean. 0 means DELETED, and a
     * deleted job must be visible to us as deleted rather than merely absent —
     * silently dropping it would leave a cadence chasing a job that no longer
     * exists (RESEARCH Pitfall 6).
     */
    sm8Active: boolean('sm8_active').notNull().default(true),

    generatedJobId: text('generated_job_id'),
    jobAddress: text('job_address'),
    jobDescription: text('job_description'),
    companyUuid: uuid('company_uuid'),

    /**
     * `numeric`, never a float. ServiceM8 sends money as a string and it is
     * parsed with integer-cents string math — binary floating point cannot
     * represent 0.10 and a quote total is the number the invoice is written
     * against (RESEARCH Pitfall 4).
     */
    totalInvoiceAmount: numeric('total_invoice_amount', { precision: 12, scale: 2 }),
    quoteSent: boolean('quote_sent'),

    /** The cursor basis. Verbatim, never reinterpreted. */
    editDateRaw: text('edit_date_raw').notNull(),
    editDateUtc: timestamp('edit_date_utc', { withTimezone: true }),

    dateRaw: text('date_raw'),

    quoteDateRaw: text('quote_date_raw'),
    quoteDateUtc: timestamp('quote_date_utc', { withTimezone: true }),

    /** The WON timestamp. */
    workOrderDateRaw: text('work_order_date_raw'),
    workOrderDateUtc: timestamp('work_order_date_utc', { withTimezone: true }),

    completionDateRaw: text('completion_date_raw'),
    completionDateUtc: timestamp('completion_date_utc', { withTimezone: true }),

    /** The LOST timestamp. */
    unsuccessfulDateRaw: text('unsuccessful_date_raw'),
    unsuccessfulDateUtc: timestamp('unsuccessful_date_utc', { withTimezone: true }),

    quoteSentStampRaw: text('quote_sent_stamp_raw'),
    quoteSentStampUtc: timestamp('quote_sent_stamp_utc', { withTimezone: true }),

    /** One of CHASE_ELIGIBILITIES — see the D-15 note above. */
    chaseEligibility: text('chase_eligibility').notNull().default('needs_review'),
    /** One of SYNC_SOURCES. Which path put this row here. */
    syncSource: text('sync_source').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('quotes_tenant_job_uniq').on(table.tenantId, table.sm8JobUuid),
    /**
     * Hand-written in 0008 and invisible to drizzle until Phase 14 put it here,
     * so the spelling is pinned beside SYNC_SOURCES (0040's
     * `cadences_stop_reason_known` treatment). 0041 widens it by hand as
     * DROP CONSTRAINT IF EXISTS then ADD — the generator would emit a bare ADD
     * that fails on the existing constraint (research Pitfall 8).
     */
    check('quotes_sync_source_known', sql`sync_source IN ('backfill', 'poll', 'lead')`),
    pgPolicy('quotes_member_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`has_tenant_access(tenant_id)`,
      withCheck: sql`has_tenant_access(tenant_id)`,
    }),
  ],
);

export type Quote = typeof quotes.$inferSelect;
export type NewQuote = typeof quotes.$inferInsert;
