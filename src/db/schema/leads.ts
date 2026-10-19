/**
 * A PERSON WHO RANG A CLIENT AND WAS NOT ANSWERED — ONE ROW PER OPEN ENQUIRY
 * (Phase 12, D-05).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `leads_one_open_per_mobile` IS THE ARBITER. A caller who rings the same   │
 * │ client twice in ten minutes is ONE enquiry: the second call must join the │
 * │ open lead (advancing `last_missed_at` and `missed_call_count`), never     │
 * │ open a second one and text the caller again. Creation is `INSERT … ON     │
 * │ CONFLICT DO NOTHING RETURNING` targeted at this partial index, and ZERO   │
 * │ ROWS IS AN ANSWER: an open lead already exists for this caller.           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The lead is what a `kind = 'lead'` cadence chases (cadences.ts), what the
 * text-back's ledger row belongs to (`send_ledger.lead_id`) and what Phase 13's
 * lead follow-up and Phase 14's ServiceM8 job creation will act on. Nothing in
 * Phase 12 closes a lead (D-22): a repeat caller with an open lead is recorded
 * `lead_open` and not texted again until Phase 13/14 add closing.
 *
 * CLOSING (Phase 13, D-11/D-14): a lead leaves `open` exactly once, to `closed`
 * or `expired`, with `closed_reason` and `closed_at` written in the same UPDATE
 * (the consistency CHECKs below make a half-closed row impossible). Closing
 * EXITS `leads_one_open_per_mobile`, which is what lets a repeat caller open a
 * NEW lead (D-12) — no lead is ever reopened.
 *
 * `contact_mobile` is the normalised `+614…` the gate already proved to be an
 * AU mobile — a lead only exists for a caller the text-back could reach. It is
 * the caller's number: NEVER printed by any log, script or console surface
 * (T-11-04 carried).
 *
 * CONVERSION (Phase 14, D-04/D-07): a lead leaves `open` for `converted` when
 * it became a ServiceM8 job — `job_created` (the operator's tap created it) or
 * `booked_by_tradie` (the sync found the caller's mobile on a job the tradie
 * made himself). A `converted` lead carries exactly one of those two reasons in
 * `closed_reason`, through the same close as every other reason; no other
 * status may carry them. Converting EXITS `leads_one_open_per_mobile` like any
 * close, so a repeat caller opens a new lead (research Pitfall 7, accepted for
 * v1.2). Phase 15 (D-08b) adds the `recent_conversion` gate skip: a repeat
 * call within LEAD_RECENT_CONVERSION_HOURS of the conversion is not texted
 * and opens no lead; past it, the arbiter admits a new one.
 *
 * PSEUDONYMISATION (Phase 15, D-06/D-07): once a lead is past
 * PSEUDONYMISE_AFTER_DAYS (closed without converting, or converted with a
 * terminal job), the nightly pass replaces `contact_mobile` with a keyed hash
 * (64 lower-hex) and stamps `pseudonymised_at` in the same transaction. The
 * mobile CHECK admits the hash ONLY on a stamped row. The lead's cadence
 * (`cadences.contact_mobile`) and ledger rows (`send_ledger.to_address`) are
 * hashed on the same pass under THIS stamp and carry none of their own.
 *
 * THE JOB LINKAGE (Phase 14, D-04) lives HERE, on the lead, and never on the
 * lead cadence: `cadences_kind_identity` forbids a `lead` cadence carrying
 * `sm8_job_uuid` (14-PATTERNS Mismatch 12). `sm8_job_state` is the creation
 * state machine `none → creating → created | failed` (`failed → creating` on a
 * retry), and `leads_sm8_job_created_uniq` is its exactly-once arbiter. Every
 * linkage column is nullable or defaulted, so Phase 13 code meets the 0041
 * schema safely between the schema push and the code push (D-10).
 *
 * THE EVIDENCE FAMILY (missed-calls.ts, tenant-proofs.ts): no FK on
 * `tenant_id` or `first_missed_call_id`, and no cascade. A client who leaves
 * must not take the record of who rang them, and when, with them.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
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

/** Where a lead came from. One source in Phase 12; the CHECK keeps it closed. */
export const LEAD_SOURCES = ['missed_call'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

/**
 * The lead lifecycle. Only `open` is written in Phase 12 (D-22); the other
 * three are reserved so Phase 13/14 add writers, not a CHECK migration.
 *
 *  open      — the enquiry is live; repeat calls join it
 *  converted — it became a ServiceM8 job (Phase 14)
 *  closed    — the operator or the customer ended it
 *  expired   — it aged out without a reply
 */
export const LEAD_STATUSES = ['open', 'converted', 'closed', 'expired'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/**
 * Why a lead stopped being open (Phase 13, D-11). Written once, with
 * `closed_at`, by `closeLead`.
 *
 * The first ten are the LEAD_LABELS vocabulary (inbound-messages.ts), admitted
 * in full so this CHECK is the VOCABULARY and not the policy: which labels
 * close a lead (D-11) is code, and a policy change must never need a CHECK
 * migration. The last four are the closes no reply caused:
 *
 *  touches_exhausted  — touch 3 went (or was skipped) and the cadence completed
 *  expired            — the lead aged out under LEAD_EXPIRY_DAYS (D-15); the
 *                       ONLY reason an `expired` lead may carry
 *  operator           — the operator closed it by hand
 *  quote_cadence_wins — the caller is also on a live quote cadence at this
 *                       client; the quote conversation wins (D-10)
 *
 * `not_a_lead`, `spam`, `complaint` and `opt_out` are the NEGATIVE closes that
 * keep the caller from being texted for LEAD_NEGATIVE_COOL_OFF_DAYS (D-12).
 *
 * The last three are Phase 14's (D-07, D-08):
 *
 *  booked_by_tradie   — the sync found the caller's mobile on a ServiceM8 job
 *                       the tradie made within LEAD_JOB_MATCH_WINDOW_DAYS; a
 *                       `converted` reason
 *  job_created        — the operator's tap created the job; a `converted`
 *                       reason
 *  closed_by_tradie   — the tradie texted DONE from his own number; an
 *                       ordinary `closed`, and not negative
 *
 * `converted` carries exactly one of LEAD_CONVERSION_REASONS (Phase 14 rewrote
 * `leads_closed_iff_reason` and added `leads_converted_reason` and
 * `leads_conversion_reason_only_converted`).
 */
export const LEAD_CLOSED_REASONS = [
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
  'touches_exhausted',
  'expired',
  'operator',
  'quote_cadence_wins',
  'booked_by_tradie',
  'job_created',
  'closed_by_tradie',
] as const;
export type LeadClosedReason = (typeof LEAD_CLOSED_REASONS)[number];

/**
 * The two reasons a `converted` lead carries, and the only two that make one
 * (Phase 14, D-07). `leads.close` maps these to `status = 'converted'`; the
 * CHECKs `leads_converted_reason` and `leads_conversion_reason_only_converted`
 * hold the database to the same rule.
 */
export const LEAD_CONVERSION_REASONS = [
  'booked_by_tradie',
  'job_created',
] as const satisfies readonly LeadClosedReason[];
export type LeadConversionReason = (typeof LEAD_CONVERSION_REASONS)[number];

/**
 * The ServiceM8 job-creation state machine (Phase 14, D-04):
 *
 *  none     — no tap yet (a `booked_by_tradie` match also stays here)
 *  creating — claimed by one tap; the ServiceM8 calls are in flight
 *  created  — the job exists, was read back, and is linked
 *  failed   — the last attempt stopped with `sm8_job_error_kind`; retryable
 *
 * `claimJobCreation` is the ONLY writer of `creating`, a guarded UPDATE from
 * `none` or `failed`: the second of two taps gets zero rows.
 */
export const LEAD_JOB_STATES = ['none', 'creating', 'created', 'failed'] as const;
export type LeadJobState = (typeof LEAD_JOB_STATES)[number];

/**
 * Why the last creation attempt failed (Phase 14, D-04): the ServiceM8 write
 * enum (`Sm8WriteFailureKind`, src/core/servicem8/types.ts) plus three local
 * refusals — `connection_paused`, `not_connected` and `readback_mismatch` (a
 * 200 whose record did not read back as the job we asked for) — and
 * `stale_claim` (plan 14-03): a claim left in `creating` longer than
 * `LEAD_JOB_CLAIM_STALE_MINUTES`, its request presumed dead, released by the
 * sync's post-commit pass so the Retry comes back. The confirm sheet's
 * sentences are keyed on this list and plan 14-02 pins the key set; a new
 * member needs a sentence, a CHECK migration and that pin. (`stale_claim` was
 * added to 0041 itself, before 0041 was applied anywhere but a fresh CI
 * database.) `job_linked_elsewhere` (Phase 15, D-08a) lands by migration 0042
 * rewriting the CHECK — 0041 is applied in production, so no in-place edit.
 */
export const LEAD_JOB_ERROR_KINDS = [
  'auth_failed',
  'rate_limited',
  'server_error',
  'network_error',
  'parse_error',
  'bad_request',
  'connection_paused',
  'not_connected',
  'readback_mismatch',
  'stale_claim',
  // 2026-10 (Phase 15, D-08a; 14-REVIEW WR-02): the adopted job (by uuid or by
  // description digest) is already another lead's `created` job — the
  // unique-violation recovery clears the linkage and the retry creates fresh.
  'job_linked_elsewhere',
] as const;
export type LeadJobErrorKind = (typeof LEAD_JOB_ERROR_KINDS)[number];

export const leads = pgTable(
  'leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** No FK, no cascade — see the header. */
    tenantId: uuid('tenant_id').notNull(),

    /** Normalised `+614…`. NEVER PRINTED. */
    contactMobile: text('contact_mobile').notNull(),

    /** One of LEAD_SOURCES. */
    source: text('source').notNull().default('missed_call'),
    /** One of LEAD_STATUSES. */
    status: text('status').notNull().default('open'),

    /** The `missed_calls.id` that opened this lead. No FK. */
    firstMissedCallId: uuid('first_missed_call_id').notNull(),
    firstMissedAt: timestamp('first_missed_at', { withTimezone: true }).notNull(),
    /** Advanced by every repeat call while the lead is open. */
    lastMissedAt: timestamp('last_missed_at', { withTimezone: true }).notNull(),
    missedCallCount: integer('missed_call_count').notNull().default(1),

    /** The first call's `after_hours` fact, copied at creation. */
    afterHours: boolean('after_hours').notNull(),

    /**
     * One of LEAD_CLOSED_REASONS (Phase 13, D-11). NULL exactly while the lead
     * is `open`; written once, with `closed_at`, by the close. A `converted`
     * lead carries one of LEAD_CONVERSION_REASONS (Phase 14).
     */
    closedReason: text('closed_reason'),
    /** When the lead closed or expired. NULL exactly when `closed_reason` is. */
    closedAt: timestamp('closed_at', { withTimezone: true }),

    /** One of LEAD_JOB_STATES (Phase 14, D-04). */
    sm8JobState: text('sm8_job_state').notNull().default('none'),
    /** The ServiceM8 client (company) the job hangs off, persisted the moment it is matched or created. */
    sm8CompanyUuid: uuid('sm8_company_uuid'),
    /** Our created job, or the tradie's own job a `booked_by_tradie` match found. */
    sm8JobUuid: uuid('sm8_job_uuid'),
    /** The caller's job contact on that job. */
    sm8JobContactUuid: uuid('sm8_job_contact_uuid'),
    /** One of LEAD_JOB_ERROR_KINDS; set by a failed attempt, cleared by the next claim. */
    sm8JobErrorKind: text('sm8_job_error_kind'),
    /** How many times creation was claimed — shown on the sheet after a failure. */
    sm8JobAttemptCount: integer('sm8_job_attempt_count').notNull().default(0),
    /** When the latest claim was made. */
    sm8JobAttemptedAt: timestamp('sm8_job_attempted_at', { withTimezone: true }),
    /** When the job was read back and linked — the digest's "jobs created" read. */
    sm8JobCreatedAt: timestamp('sm8_job_created_at', { withTimezone: true }),
    /** The operator's `sub` from `requireOperatorId()` — never a form field. */
    sm8JobCreatedBy: uuid('sm8_job_created_by'),
    /**
     * SHA-256 hex of the job description composed at claim time — what a retry
     * adopts an orphaned job on, never a re-composed string (checker W1).
     */
    sm8JobDescriptionSha256: text('sm8_job_description_sha256'),

    /**
     * Set ONCE by the nightly pseudonymisation pass when this row's caller
     * number was replaced by a keyed hash (Phase 15, D-06). NULL means the row
     * still carries the number; never cleared. Gates the hash arm of
     * `leads_contact_mobile_e164`.
     */
    pseudonymisedAt: timestamp('pseudonymised_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** THE ARBITER. See the header. */
    uniqueIndex('leads_one_open_per_mobile')
      .on(table.tenantId, table.contactMobile)
      .where(sql`status = 'open'`),

    /** Phase 15's lead queue: newest first, per client. */
    index('leads_tenant_created_idx').on(table.tenantId, sql`${table.createdAt} DESC`),

    /**
     * The caller's newest lead at this client (Phase 13, D-12): the 90-day
     * negative cool-off read (`leads.latestForMobile`) and the D-10 tie-break.
     */
    index('leads_tenant_mobile_created_idx').on(
      table.tenantId,
      table.contactMobile,
      sql`${table.createdAt} DESC`,
    ),

    /**
     * EXACTLY ONCE (Phase 14, D-04): no ServiceM8 job is Backdesk's creation
     * for two leads. Scoped to OUR creates (`sm8_job_state = 'created'`) so two
     * callers who are both contacts on one tradie job may both resolve
     * `booked_by_tradie` to it without a 23505.
     */
    uniqueIndex('leads_sm8_job_created_uniq')
      .on(table.tenantId, table.sm8JobUuid)
      .where(sql`sm8_job_state = 'created'`),

    /**
     * Phase 15 (D-06; research Pitfall 2), rewritten by 0042 — WIDENING-only:
     * the first arm is the old CHECK verbatim, so every existing row passes it.
     * The hash arm (64 lower-hex) is admitted ONLY on a stamped row, so a hash
     * can never be written by a path that forgot the stamp.
     * `leads_one_open_per_mobile` is partial on `status = 'open'` and never
     * meets a hashed row (only closed or converted leads are hashed).
     */
    check(
      'leads_contact_mobile_e164',
      sql`contact_mobile ~ '^[+]614[0-9]{8}$' OR (pseudonymised_at IS NOT NULL AND contact_mobile ~ '^[0-9a-f]{64}$')`,
    ),
    check('leads_source_known', sql`source IN ('missed_call')`),
    check('leads_status_known', sql`status IN ('open', 'converted', 'closed', 'expired')`),
    check('leads_missed_call_count_positive', sql`missed_call_count >= 1`),

    /**
     * Phase 13 (D-11). The spelling must match LEAD_CLOSED_REASONS byte for
     * byte — the writer is service-role code, so a typo would be a row no
     * `closed_reason = …` predicate (the 90-day gate) ever matches.
     */
    check(
      'leads_closed_reason_known',
      sql`closed_reason IS NULL OR closed_reason IN ('new_enquiry', 'callback_request', 'question', 'existing_job', 'complaint', 'not_a_lead', 'already_sorted', 'spam', 'opt_out', 'other', 'touches_exhausted', 'expired', 'operator', 'quote_cadence_wins', 'booked_by_tradie', 'job_created', 'closed_by_tradie')`,
    ),
    /**
     * A closed, expired or converted lead says why; an open one does not.
     * Phase 14 added `converted` — widening only: no row was `converted` before.
     */
    check(
      'leads_closed_iff_reason',
      sql`(status IN ('closed', 'expired', 'converted')) = (closed_reason IS NOT NULL)`,
    ),
    /** A `converted` lead carries one of LEAD_CONVERSION_REASONS (Phase 14). */
    check(
      'leads_converted_reason',
      sql`status <> 'converted' OR closed_reason IN ('booked_by_tradie', 'job_created')`,
    ),
    /** …and those two reasons make nothing but a `converted` lead (Phase 14). */
    check(
      'leads_conversion_reason_only_converted',
      sql`closed_reason IS NULL OR closed_reason NOT IN ('booked_by_tradie', 'job_created') OR status = 'converted'`,
    ),
    /** The reason and its moment are written together, never one alone. */
    check('leads_closed_at_with_reason', sql`(closed_reason IS NULL) = (closed_at IS NULL)`),
    /** `expired` has exactly one reason (D-15). */
    check('leads_expired_reason', sql`status <> 'expired' OR closed_reason = 'expired'`),

    /** Phase 14 (D-04). The spelling matches LEAD_JOB_STATES byte for byte. */
    check(
      'leads_sm8_job_state_known',
      sql`sm8_job_state IN ('none', 'creating', 'created', 'failed')`,
    ),
    /**
     * Phase 14 (D-04). The spelling matches LEAD_JOB_ERROR_KINDS byte for byte.
     * 2026-10 (Phase 15, D-08a): `job_linked_elsewhere` appended, by 0042.
     */
    check(
      'leads_sm8_job_error_kind_known',
      sql`sm8_job_error_kind IS NULL OR sm8_job_error_kind IN ('auth_failed', 'rate_limited', 'server_error', 'network_error', 'parse_error', 'bad_request', 'connection_paused', 'not_connected', 'readback_mismatch', 'stale_claim', 'job_linked_elsewhere')`,
    ),
    /** A created job is linked. */
    check(
      'leads_sm8_job_created_has_uuid',
      sql`sm8_job_state <> 'created' OR sm8_job_uuid IS NOT NULL`,
    ),
    /** A failed attempt says why. */
    check(
      'leads_sm8_job_failed_has_kind',
      sql`sm8_job_state <> 'failed' OR sm8_job_error_kind IS NOT NULL`,
    ),
    check('leads_sm8_job_attempts_nonneg', sql`sm8_job_attempt_count >= 0`),
    /** A SHA-256 hex digest, or nothing. */
    check(
      'leads_sm8_job_description_sha256_len',
      sql`sm8_job_description_sha256 IS NULL OR length(sm8_job_description_sha256) = 64`,
    ),

    pgPolicy('leads_member_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`has_tenant_access(tenant_id)`,
      withCheck: sql`has_tenant_access(tenant_id)`,
    }),
  ],
);

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
