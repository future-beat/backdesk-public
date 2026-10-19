/**
 * The public audit request — the ONE table a stranger on the internet can cause
 * a write to (Phase 9, LAND-02/LAND-03, D-10/D-11/D-12).
 *
 * ── WHY THIS IS NOT A `prospects` ROW (D-11) ────────────────────────────────
 *
 * A `prospects` row is an AUDIT: it carries a credential envelope, quote-line
 * aggregates, a window and a generated document, and every one of those is
 * created by an operator who has already talked to the business. An
 * `audit_requests` row is a STRANGER'S CLAIM about themselves, typed into a
 * public form by somebody nobody has met, unverified in every field. Modelling
 * the claim as an audit would mean the audits list — the founder's actual
 * pipeline of work — filled with rows that have no data behind them, and it
 * would mean the public action holding an insert path into the table that also
 * holds API-key ciphertext.
 *
 * The two are joined the safe way round and only after a human decides:
 * `audit_requests.converted_prospect_id` points at the prospect the operator
 * created FROM the request. Nothing points back, and nothing in this file or
 * its repository can reach a tenant, a cadence or a quote.
 *
 * ── TENANT-INDEPENDENT, ON PURPOSE ──────────────────────────────────────────
 *
 * There is no `tenant_id` here and there must never be one. A request belongs
 * to no client: it arrives before any relationship exists. That is the same
 * shape `prospects` has, so it takes the same `is_operator()` policy and the
 * same repository discipline (no closure, every id shape-checked).
 *
 * ── RETENTION IS A COLUMN (D-11, threat T-9-05) ─────────────────────────────
 *
 * An attached Job List export is a stranger's CUSTOMERS' names, phone numbers
 * and email addresses — the same class of data as `prospect_quote_lines`, and
 * even less justified because the business it belongs to has not signed
 * anything. `csv_purge_after` is stamped 30 days out by the repository at
 * attach time and the object is deleted by the daily purge (09-03). The request
 * row itself persists: it is the sales record, and after the purge it carries
 * nothing about any of that business's customers.
 *
 * ── WHAT IS DELIBERATELY NOT STORED (V8, T-9-05) ────────────────────────────
 *
 * No raw IP and no request body. `ip_hash` is a salted SHA-256 of the address
 * (IPv6 truncated to the /64) and exists for exactly one purpose: keying the
 * per-hour throttle counter. `user_agent` is capped at 512 characters by the
 * repository. A field that is not stored cannot leak.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

import { prospects } from './prospects';

/**
 * The nine trades the form offers (D-10). A CLOSED vocabulary rather than free
 * text because the console list, the operator email and the 09-06 pre-fill all
 * render a label for it, and three spellings of "HVAC" is three bugs.
 */
export const AUDIT_REQUEST_TRADES = [
  'electrical',
  'plumbing',
  'hvac',
  'solar',
  'patios_outdoor',
  'painting',
  'landscaping',
  'small_builder',
  'other',
] as const;
export type AuditRequestTrade = (typeof AUDIT_REQUEST_TRADES)[number];

/**
 * Quotes a month, in bands (D-10).
 *
 * BANDS, NOT A NUMBER, and the reason is the answer's honesty: nobody knows
 * their exact monthly quote count, so a number field collects a guess dressed
 * as a measurement. The band is what the audit actually needs — is this a
 * business the service can pay for itself at.
 */
export const AUDIT_REQUEST_BANDS = ['lt8', '8_15', '16_30', 'gt30'] as const;
export type AuditRequestBand = (typeof AUDIT_REQUEST_BANDS)[number];

/** Where the request is up to, operator-set (D-15). */
export const AUDIT_REQUEST_STATUSES = ['new', 'contacted', 'audited', 'declined'] as const;
export type AuditRequestStatus = (typeof AUDIT_REQUEST_STATUSES)[number];

/**
 * What happened to each of the two operator notifications (D-13).
 *
 * `not_configured` is separated from `failed` for the reason
 * `OperatorAlertResult` separates them: the first means every future
 * notification is also lost (a deployment problem), the second means this one
 * was (a provider problem). The console badge reads the difference.
 */
export const AUDIT_NOTIFY_OUTCOMES = ['sent', 'failed', 'not_configured'] as const;
export type AuditNotifyOutcome = (typeof AUDIT_NOTIFY_OUTCOMES)[number];

/** Days an attached CSV survives before the purge takes it (D-11). */
export const AUDIT_UPLOAD_RETENTION_DAYS = 30;

/** Submissions permitted per hashed IP per hour before the form refuses (D-12). */
export const AUDIT_THROTTLE_LIMIT = 5;

export const auditRequests = pgTable(
  'audit_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    /** As typed. Trimmed and length-bounded by zod at the boundary, never here. */
    businessName: text('business_name').notNull(),
    contactName: text('contact_name').notNull(),
    /** E.164 — `normalizeAuMobile` ran before the insert, or the submit failed. */
    phone: text('phone').notNull(),
    /** Trimmed and lowercased by `normalizeEmail` before the insert. */
    email: text('email').notNull(),

    /** One of AUDIT_REQUEST_TRADES. */
    trade: text('trade').notNull(),
    /** Their own answer, unverified — the audit path depends on it (D-15). */
    servicem8User: boolean('servicem8_user').notNull(),
    /** One of AUDIT_REQUEST_BANDS. */
    quotesBand: text('quotes_band').notNull(),

    /**
     * ── The optional Job List export (D-10, 09-03 writes these four). ──
     *
     * All four are written and cleared together by the repository, always: a
     * path without a purge stamp is an object nothing will ever delete, and a
     * purge stamp without a path is a row the sweep re-examines forever to
     * delete nothing.
     */
    csvObjectPath: text('csv_object_path'),
    csvFilename: text('csv_filename'),
    csvBytes: integer('csv_bytes'),
    csvPurgeAfter: timestamp('csv_purge_after', { withTimezone: true }),

    /**
     * `sha256(salt:ip)`, never the address (T-9-05). Nullable because local
     * development and any direct server-side call have no client IP at all, and
     * a fabricated placeholder would collide every such request into one
     * throttle bucket.
     */
    ipHash: text('ip_hash'),
    /** Capped at 512 characters by the repository. Diagnostic only. */
    userAgent: text('user_agent'),

    /**
     * ── WHERE THE REQUEST CAME FROM (Cowork build request, 19 Sep 2026) ──
     *
     * Four nullable columns, and the nullability is the whole design. With
     * outreach email, the guide page, the Google Business Profile and Facebook
     * all pointing at `/audit`, the first real requests were going to be
     * impossible to attribute — and the M4 tripwire ("fewer than 5 positive
     * replies after the full list is touched twice") needs to know which
     * channel is doing the work.
     *
     * WHAT IS NOT HERE IS THE POINT (LAND-05). Not the full referrer URL — the
     * HOST only, so `www.google.com` is stored and the search terms, the
     * campaign ids and the page path in the query string are not. Not the query
     * string beyond the three utm keys. Not a cookie, a pixel, an analytics
     * script or any third-party request: the values are kept in the visitor's
     * own `sessionStorage` and travel back as ordinary form fields.
     *
     * ALL FOUR NULL IS A REAL AND COMMON STATE, not an error. Outreach emails
     * stay link-free (Gmail rewrites every link), so an email-sourced request
     * arrives with nothing at all and the console says "Unknown" — matched to a
     * person by email address against the target list instead. Nothing about a
     * request's success depends on these columns.
     *
     * Deliberately NOT a closed vocabulary and NOT a CHECK constraint: marketing
     * owns the tags and will invent new ones without asking, so a constraint
     * here would turn a new campaign into a `23514` on the one write path a
     * stranger can reach. The SHAPE is bounded instead, by the parser at the
     * boundary, which stores NULL for anything it does not like.
     */
    utmSource: text('utm_source'),
    utmMedium: text('utm_medium'),
    utmCampaign: text('utm_campaign'),
    /** A hostname and nothing else — never a path, a query or a scheme. */
    referrerHost: text('referrer_host'),

    /** One of AUDIT_REQUEST_STATUSES. */
    status: text('status').notNull().default('new'),

    /**
     * The prospect an operator created from this request (D-15). `set null` —
     * deleting a prospect must not delete the sales record of the request that
     * produced it.
     */
    convertedProspectId: uuid('converted_prospect_id').references(() => prospects.id, {
      onDelete: 'set null',
    }),

    /** One of AUDIT_NOTIFY_OUTCOMES, or NULL until the notify pass runs. */
    notifyEmail: text('notify_email'),
    notifySms: text('notify_sms'),
    /**
     * An error NAME or a provider reason CODE. Never prose, never a caught
     * message — the same rule the alert senders keep (T-9-05).
     */
    notifyDetail: text('notify_detail'),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
  },
  (table) => [
    check('audit_requests_trade_known', sql`trade IN ('electrical', 'plumbing', 'hvac', 'solar', 'patios_outdoor', 'painting', 'landscaping', 'small_builder', 'other')`),
    check('audit_requests_band_known', sql`quotes_band IN ('lt8', '8_15', '16_30', 'gt30')`),
    check('audit_requests_status_known', sql`status IN ('new', 'contacted', 'audited', 'declined')`),
    check(
      'audit_requests_notify_known',
      sql`(notify_email IS NULL OR notify_email IN ('sent', 'failed', 'not_configured')) AND (notify_sms IS NULL OR notify_sms IN ('sent', 'failed', 'not_configured'))`,
    ),
    index('audit_requests_created_idx').on(table.createdAt),
    index('audit_requests_status_idx').on(table.status),
    /**
     * OPERATOR-ONLY, VIA THE ALLOWLIST — the `prospects` policy verbatim, and
     * for the same reason.
     *
     * There is no `tenant_id` here to scope on, so `has_tenant_access()` is
     * inapplicable, and both tempting substitutes are wrong:
     *
     *  - `USING (true)` is RLS in name only; `tests/rls-coverage.test.ts` fails
     *    any policy whose qual is a literal true.
     *  - `EXISTS (SELECT 1 FROM tenant_members WHERE user_id = auth.uid())`
     *    LOOKS scoped and is the more dangerous: the v2 reports portal gives
     *    clients logins, a client login is a `tenant_members` row, and on that
     *    day every client could read this table — which is the list of every
     *    business that has asked the founder for an audit, handed to the
     *    businesses in it.
     */
    pgPolicy('audit_requests_operator_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`is_operator()`,
      withCheck: sql`is_operator()`,
    }),
  ],
);

export type AuditRequest = typeof auditRequests.$inferSelect;
export type NewAuditRequest = typeof auditRequests.$inferInsert;

/**
 * The per-IP-per-hour submission counter (D-12).
 *
 * A TABLE RATHER THAN A MEMORY CACHE because the console runs on serverless
 * functions: an in-process counter is per-instance, and a limit that resets
 * whenever the platform starts a new instance is not a limit. One atomic
 * `INSERT … ON CONFLICT DO UPDATE … RETURNING hits` per attempt is race-free
 * across every instance at once.
 *
 * The composite primary key IS the window: a row per (hash, hour). Rows older
 * than a day are swept — nothing here is a record, it is a counter.
 *
 * NO GRANTS TO anon OR authenticated (migration 0035). Nothing reads this
 * through PostgREST; the bump is service-role only. It still carries an
 * `is_operator()` policy because `tests/rls-coverage.test.ts` refuses an
 * RLS-enabled table with no policy, and a table with a policy nobody can reach
 * is the correct shape for "service role only".
 */
export const auditRequestThrottle = pgTable(
  'audit_request_throttle',
  {
    ipHash: text('ip_hash').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    hits: integer('hits').notNull(),
  },
  (table) => [
    primaryKey({
      name: 'audit_request_throttle_pkey',
      columns: [table.ipHash, table.windowStart],
    }),
    pgPolicy('audit_request_throttle_operator_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`is_operator()`,
      withCheck: sql`is_operator()`,
    }),
  ],
);

export type AuditRequestThrottleRow = typeof auditRequestThrottle.$inferSelect;
