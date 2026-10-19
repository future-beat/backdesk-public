/**
 * The Quote Leakage Audit's data model — a PROSPECT is not a tenant (D-01).
 *
 * ── WHY A SEPARATE TABLE RATHER THAN A `tenants` ROW WITH A FLAG (D-01) ──────
 *
 * A tenant carries contact hours, contact days, an escalation phone and a
 * ServiceM8 connection, because every one of those is required before a single
 * follow-up may be sent. A prospect has none of them and must never acquire
 * them by accident: they have not signed, their customers have not consented to
 * anything, and the only thing we are entitled to do with their data is count
 * it. Modelling a prospect as a tenant would mean every cadence query in the
 * product — now and in Phase 3, 4, 7 — carries the burden of excluding rows
 * that look exactly like clients apart from one boolean. One forgotten
 * `WHERE is_prospect = false` is a text message sent to a stranger's customer
 * on behalf of a business that never hired us.
 *
 * Reversibility is COSTLY and was human-locked in discuss-phase: merging the
 * two later means a data migration plus rewriting every audit query and the
 * conversion flow. Recorded here so the argument does not have to be rebuilt.
 *
 * ── THE PROHIBITION THIS FILE EXISTS TO ENFORCE (D-03) ───────────────────────
 *
 * **Prospect rows are analysis-only.** They never flow into `quotes`,
 * `quote_contacts` or `quote_status_events`, they never become cadence
 * candidates, and a prospect who converts to a client starts a FRESH sync — the
 * audit lines do not migrate. The structural guarantee is that there is no
 * foreign key, no shared uniqueness key and no repository method connecting the
 * two families of table: `forTenant()` cannot reach a prospect and
 * `prospectRepository()` cannot reach a tenant.
 *
 * `tenants.prospect_id` is the ONE link, and it points the safe way round: the
 * tenant references the prospect it came from, so Phase 7 can read the baseline
 * snapshot through it. Nothing about that column lets prospect quote lines
 * become chaseable.
 *
 * ── RETENTION IS A COLUMN, NOT A POLICY DOCUMENT (D-04, threat T-2-07) ───────
 *
 * `prospect_quote_lines` holds names, phone numbers, email addresses and job
 * descriptions belonging to the customers of a business that is not our client
 * and may never be. That is the highest-sensitivity data in this phase and the
 * least justified by any ongoing purpose. Every line therefore carries
 * `purge_after`, set at insert to 30 days out, and a daily pg_cron job deletes
 * the expired ones (migration 0014). Conversion sets `purge_after` to NULL,
 * which is the ONLY way a line survives past 30 days.
 *
 * The aggregate figures on `prospects` persist indefinitely and are safe to:
 * they are counts and dollar totals about the BUSINESS, carrying nothing about
 * any individual. The audit therefore stays provable long after the raw PII
 * behind it is gone — which is the whole point of splitting the two tables.
 *
 * ── PII MINIMIZATION (V8) ────────────────────────────────────────────────────
 *
 * The line table stores only the fields the report renders or the aggregation
 * consumes. There is deliberately no address, no company record, no note text,
 * no staff data — a field that is not stored cannot be leaked, cannot be
 * subpoenaed, and cannot be forgotten about when the purge runs.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

/** D-12: the two ways a prospect's quote history can reach us. */
export const PROSPECT_SOURCES = ['api_key', 'csv'] as const;
export type ProspectSource = (typeof PROSPECT_SOURCES)[number];

/**
 * Which path produced one line. Distinct from `PROSPECT_SOURCES` on purpose:
 * the prospect-level value records how they were ONBOARDED, the line-level
 * value records where THAT ROW came from, and the report's methodology footnote
 * depends on the second (a CSV line has no note/activity history behind it, so
 * "never followed up" degrades to status-change-only detection).
 */
export const PROSPECT_LINE_SOURCES = ['api', 'csv'] as const;
export type ProspectLineSource = (typeof PROSPECT_LINE_SOURCES)[number];

/** Days of raw-line retention before the daily purge takes them (D-04). */
export const PROSPECT_LINE_RETENTION_DAYS = 30;

/**
 * Hours an unconfirmed CSV upload may sit in `prospects.csv_staging` (CR-03).
 *
 * Much shorter than the 30-day line window because staging is a WORKSPACE, not
 * a record: it exists to survive the round trip from upload to the operator
 * confirming seven dropdowns, which is minutes. 24 hours is chosen to be
 * forgiving of a sales call that gets interrupted and resumed the next morning,
 * and to be well short of "I forgot about this prospect".
 *
 * Enforced by the `prospect-staging-sweep` cron job in migration 0015 — the
 * sweep is the enforcement, this constant is what the write path stamps.
 */
export const CSV_STAGING_RETENTION_HOURS = 24;

export const prospects = pgTable(
  'prospects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessName: text('business_name').notNull(),
    /** One of PROSPECT_SOURCES. */
    source: text('source').notNull(),

    /**
     * `enc:v1:<iv>:<tag>:<data>` — the SAME AES-256-GCM envelope as
     * `sm8_connections.api_key_ciphertext`, produced by the same
     * `encryptCredential`, and for the same reason (threat T-2-01). A
     * prospect's key is a third party's live credential; that it belongs to
     * someone who has not signed a contract makes it MORE sensitive, not less.
     *
     * Nullable because a CSV prospect never has one.
     */
    apiKeyCiphertext: text('api_key_ciphertext'),
    /** The only part of the key ever rendered (threat T-2-02). */
    keyLast4: text('key_last4'),

    /**
     * IANA identifier, never a UTC offset — the Phase 1 rule. The grace-period
     * math and the window boundaries are interpreted in this zone, so a Perth
     * prospect's "issued on day 90" means their day 90.
     */
    timezone: text('timezone').notNull().default('Australia/Perth'),

    /** ── The audit figures (AUD-01). Persist past the purge. ── */
    quotesIssued: integer('quotes_issued'),
    totalValue: numeric('total_value', { precision: 12, scale: 2 }),
    neverFollowedUpValue: numeric('never_followed_up_value', { precision: 12, scale: 2 }),
    recoverableEstimate: numeric('recoverable_estimate', { precision: 12, scale: 2 }),

    /**
     * ── The baseline snapshot (AUD-02). ──
     *
     * NULL MEANS "NO DATA", AND IT MUST NEVER BE WRITTEN AS 0. A prospect who
     * issued no quotes in the window has an UNDEFINED win rate, not a 0% one.
     * Phase 7 computes recovered revenue NET OF BASELINE: a stored 0 would tell
     * it the client won nothing before we arrived, and every win the client
     * would have made anyway gets invoiced as ours. That is the failure mode
     * that ends a client relationship, and it is one arithmetic shortcut away.
     */
    baselineWinRate: numeric('baseline_win_rate', { precision: 5, scale: 4 }),
    baselineQuotesIssued: integer('baseline_quotes_issued'),

    /** The window the figures above were computed over — dates, no times. */
    windowStart: date('window_start'),
    windowEnd: date('window_end'),
    auditGeneratedAt: timestamp('audit_generated_at', { withTimezone: true }),

    /**
     * D-10 honesty: a CSV export carries no notes and no activity records, so
     * "never followed up" degrades to status-change-only detection. The report
     * footnote is driven by this flag rather than by re-deriving it from the
     * source column, because a future third source would silently inherit the
     * wrong footnote.
     */
    csvNoteDegraded: boolean('csv_note_degraded').notNull().default(false),

    /**
     * The parsed-but-unconfirmed CSV upload, held between the mapping step and
     * the operator's confirmation (plan 02-07). CLEARED ON CONFIRM — it is a
     * workspace, not a record, and leaving it populated would keep a second
     * copy of every contact detail alive past the purge that empties the line
     * table.
     *
     * NOTE WHAT IS IN HERE: the ENTIRE parsed export, every column of every row
     * — not the seven mapped fields. For a real ServiceM8 Job List that means
     * job and billing addresses, both email columns, three phone columns and the
     * description of work: strictly MORE personal data than
     * `prospect_quote_lines`, which this file calls the highest-sensitivity data
     * in the phase.
     */
    csvStaging: jsonb('csv_staging'),

    /**
     * When the staging workspace above becomes garbage (CR-03).
     *
     * ── WHY A CLOCK AND NOT JUST THE CONFIRM-PATH CLEAR ─────────────────────
     *
     * `storeAuditResults` clears `csv_staging`, and for a while that was the
     * only thing that ever did — which meant the clear ran on exactly one path
     * through the mapping flow: a SUCCESSFUL confirmation. Every other exit left
     * a full copy of a stranger's customer list in the database forever:
     *
     *   - the operator uploads and navigates away (the likely case mid-sales-
     *     call, and the one nobody thinks of as an exit at all);
     *   - `confirmCsvMapping` returns `missing_columns`, `no_usable_rows`,
     *     `unknown_header` or `needs_acknowledgement` and the operator gives up;
     *   - the prospect never converts and is simply forgotten.
     *
     * A retention guarantee that depends on the user completing a flow is not a
     * retention guarantee. This column is the D-04 discipline applied to the
     * workspace: the row carries its own expiry, and a scheduled sweep enforces
     * it whether or not any code path remembered to.
     *
     * The window is 24 hours rather than the lines' 30 days because this is a
     * workspace measured in minutes — an abandoned upload is dead within the
     * meeting it came from. `MappingPage` already redirects to the report when
     * staging is absent, and `confirmCsvMapping`'s `no_staging` copy already
     * says "has already been used or has expired", so expiry degrades into
     * behaviour that was written for it before it existed.
     *
     * NULL means there is nothing staged. The two columns are written and
     * cleared together, always — see `createProspect` / `storeAuditResults`.
     */
    csvStagingExpiresAt: timestamp('csv_staging_expires_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    /**
     * OPERATOR-ONLY, VIA THE ALLOWLIST (T-2-08, D-01/D-03 separation).
     *
     * There is no `tenant_id` here to scope on, so `has_tenant_access()` is
     * inapplicable — and the two tempting substitutes are both wrong:
     *
     *  - `USING (true)` is RLS in name only; `tests/rls-coverage.test.ts`
     *    fails any policy whose qual is a literal true.
     *  - `EXISTS (SELECT 1 FROM tenant_members WHERE user_id = auth.uid())`
     *    LOOKS scoped and is the more dangerous of the two: the v2 reports
     *    portal gives clients logins, a client login is a tenant_members row,
     *    and on that day every client could read this table — which is a list
     *    of the founder's sales pipeline, handed to the businesses in it.
     *
     * `is_operator()` reads an explicit allowlist (see operators.ts) that
     * cannot be satisfied by accident.
     */
    pgPolicy('prospects_operator_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`is_operator()`,
      withCheck: sql`is_operator()`,
    }),
  ],
);

export const prospectQuoteLines = pgTable(
  'prospect_quote_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    prospectId: uuid('prospect_id')
      .notNull()
      .references(() => prospects.id, { onDelete: 'cascade' }),

    /** Absent for CSV lines — an export has no uuid column to trust. */
    sm8JobUuid: uuid('sm8_job_uuid'),

    /** One of the four ServiceM8 statuses. The baseline is computed from it. */
    status: text('status').notNull(),

    /**
     * The verbatim string AND the resolved instant, the same pairing `quotes`
     * uses and for the same reason: the raw value is the audit trail, the UTC
     * value is what the window and grace-period math consume, and a
     * normalization bug must not be able to destroy the original.
     */
    quoteDateRaw: text('quote_date_raw'),
    quoteDateUtc: timestamp('quote_date_utc', { withTimezone: true }),

    /** `numeric`, never a float — parsed via integer-cents string math. */
    value: numeric('value', { precision: 12, scale: 2 }),

    description: text('description'),

    /** ── The PII the purge exists for. ── */
    contactName: text('contact_name'),
    contactPhone: text('contact_phone'),
    contactEmail: text('contact_email'),

    /**
     * D-10, decided AT INSERT rather than at render time.
     *
     * The evidence a follow-up happened — notes, job activities, the
     * quote-sent stamp — is fetched alongside the quote and then thrown away
     * (it is more PII we have no reason to keep). Storing the conclusion means
     * the report can still be re-rendered after the purge; storing the evidence
     * would mean keeping a stranger's communication history for the privilege
     * of recomputing a boolean.
     */
    followedUp: boolean('followed_up'),

    /** One of PROSPECT_LINE_SOURCES. */
    lineSource: text('line_source').notNull(),

    /**
     * D-04 — see the file header. Set by the application at insert to
     * `now() + 30 days`; the daily `prospect-line-purge` job (migration 0014)
     * deletes rows past it.
     *
     * NULL MEANS "KEEP", and it is reached exactly one way: the prospect
     * converted to a client (D-02). The purge's `purge_after IS NOT NULL`
     * predicate is what makes that so — a job that deleted on
     * `purge_after < now()` alone would already spare NULLs, but silently, and
     * "silently correct" is not a property anyone can test for on the day
     * somebody changes the predicate.
     */
    purgeAfter: timestamp('purge_after', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    /** Same gate as `prospects`, same reasoning — see that policy's comment. */
    pgPolicy('prospect_quote_lines_operator_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`is_operator()`,
      withCheck: sql`is_operator()`,
    }),
  ],
);

export type Prospect = typeof prospects.$inferSelect;
export type NewProspect = typeof prospects.$inferInsert;
export type ProspectQuoteLine = typeof prospectQuoteLines.$inferSelect;
export type NewProspectQuoteLine = typeof prospectQuoteLines.$inferInsert;
