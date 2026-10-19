/**
 * EVERY CALL A CLIENT DIVERTED TO THEIR BACKDESK NUMBER — ONE ROW PER CALL,
 * WHATEVER HAPPENED (Phase 11, CAP-03, D-06/D-07).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ONE ARBITER, THREE WRITERS. `UNIQUE (provider, provider_call_id)` is the │
 * │ whole idempotency story: the arrival webhook INSERTs … ON CONFLICT DO    │
 * │ NOTHING, the status callback UPDATEs by exact match (never inserts from  │
 * │ a hint), and the nightly call-log reconcile UPSERTs filling only what a  │
 * │ dropped callback left NULL. A replayed, reordered or lost delivery       │
 * │ converges on one row per CallSid.                                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * NO AUDIO, NO TRANSCRIPT, EVER (D-04). There is no column that could hold one,
 * and `tests/telephony-greeting.test.ts` fails if any telephony source reaches
 * for a recording verb or API. The WA Surveillance Devices Act stays out of
 * scope because nothing heard is retained.
 *
 * `tenant_id` NULL MEANS A DEAD LETTER — the `inbound_messages` posture. A call
 * to a number no tenant owns (a number released by mistake, a Twilio test call,
 * a misconfigured divert), or a request we could not parse, is STORED rather than
 * dropped, with `dead_letter_reason` saying why and `raw_payload` holding at most
 * 8 000 characters of what arrived. The two-arm policy below is what lets an
 * operator see those rows at all: `has_tenant_access(NULL)` admits nobody.
 *
 * WHAT IS STORED IS D-07, AND NOTHING ELSE:
 *
 *   caller_e164 / caller_kind / caller_withheld — the classification Phase 12's
 *     gate reads. Withheld (`anonymous`, `+266696687`, anything that is not a
 *     number) is `caller_kind = 'withheld'`, `caller_e164 NULL`. Landlines and
 *     international callers ARE stored as numbers (`other_number`) — capture
 *     records every call; the gate, not capture, decides who is texted (D-06).
 *   caller_raw / forwarded_from_raw — the raw strings Twilio sent, EVIDENCE for
 *     the live divert spike (S2/S3: does the CLI survive the divert, does
 *     ForwardedFrom arrive at all). Handset numbers: never printed by any log,
 *     script or console surface.
 *   started_at — UTC, server receipt time (the arrival webhook carries no
 *     timestamp). Perth wall-clock is a READ-PATH derivation from the tenant's
 *     zone; nothing here stores local time.
 *   after_hours — computed ONCE at arrival from the tenant's contact window and
 *     stored as a fact. Re-deriving it later from a window the operator has
 *     since edited would rewrite history.
 *
 * No FK on either `tenant_id` or `divert_number_id`, and no cascade: the
 * evidence family (tenant-proofs.ts). A client who leaves must not take the
 * record of the calls we captured for them.
 *
 * PSEUDONYMISATION (Phase 15, D-06/D-07): past PSEUDONYMISE_AFTER_DAYS the
 * nightly pass replaces `caller_e164` (when not NULL), `caller_raw` and
 * `forwarded_from_raw` with keyed hashes and stamps `pseudonymised_at` — on a
 * lead's calls with the lead, and on a lead-less call by its own age. A
 * withheld row keeps `caller_e164` NULL, so `missed_calls_withheld_has_no_number`
 * still holds. `cadences.contact_mobile` and `send_ledger.to_address` are
 * hashed on the SAME pass under the lead's stamp and carry no stamp of their
 * own (D-07: three stamp columns, no more).
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

/** How the caller was classified at arrival (`src/core/telephony/caller.ts`). */
export const CALLER_KINDS = ['mobile', 'other_number', 'withheld'] as const;
export type CallerKind = (typeof CALLER_KINDS)[number];

/** Which writer created the row. */
export const MISSED_CALL_SOURCES = ['webhook', 'reconcile'] as const;
export type MissedCallSource = (typeof MISSED_CALL_SOURCES)[number];

/** Which writer completed it (NULL until the call has ended and we heard). */
export const MISSED_CALL_COMPLETIONS = ['callback', 'reconcile'] as const;
export type MissedCallCompletion = (typeof MISSED_CALL_COMPLETIONS)[number];

/**
 * Why a row has no tenant. A closed vocabulary so the ops probe can count them
 * by kind and the operator can tell "a number nobody owns rang" from "Twilio
 * changed their payload".
 */
export const DEAD_LETTER_REASONS = [
  'unknown_number',
  'unparseable',
  'not_inbound',
  'body_unreadable',
] as const;
export type DeadLetterReason = (typeof DEAD_LETTER_REASONS)[number];

/**
 * Twilio's nine `CallStatus` values, verbatim. Kept here (and mirrored by
 * `CALL_STATUSES` in the webhook parser) so the CHECK and the parser agree.
 */
export const MISSED_CALL_STATUSES = [
  'queued',
  'initiated',
  'ringing',
  'in-progress',
  'completed',
  'busy',
  'failed',
  'no-answer',
  'canceled',
] as const;
export type MissedCallStatus = (typeof MISSED_CALL_STATUSES)[number];

/**
 * WHAT BECAME OF THE TEXT-BACK FOR THIS CALL (Phase 12, D-04/D-06). NULL means
 * UNDECIDED — the only state the text-back claim (`claimForTextBack`, a guarded
 * UPDATE on `text_back_status IS NULL`) admits, so a second callback delivery,
 * the tick sweep and a redelivered arrival can never decide one call twice.
 *
 *  claimed — the claim committed together with the ledger claim; the provider's
 *            answer is not recorded yet. A row that stays here is an UNKNOWN
 *            outcome: the caller may have been texted, so nothing re-sends it.
 *  sent    — the provider accepted it (never a stub — D-15)
 *  failed  — the provider refused it, or the sender was a stub
 *  skipped — the gate refused; `text_back_skip_reason` says which rule
 */
export const TEXT_BACK_STATUSES = ['claimed', 'sent', 'failed', 'skipped'] as const;
export type TextBackStatus = (typeof TEXT_BACK_STATUSES)[number];

/**
 * Why a call was not texted. D-06's seven FIRST, in D-06's order — the gate
 * (`src/core/leads/gate.ts`) walks them in exactly this order and records the
 * first that fails — then the three this phase adds to the gate (D-20 `stale`,
 * D-15 `sms_not_armed`, D-02 `no_template`) and the two the send path records
 * after the gate passes (`lead_open`, D-22; `quote_open`, D-08).
 *
 * Phase 13 (D-12) inserts `recent_negative_close` directly AFTER `suppressed`:
 * the caller's newest lead here closed as not_a_lead / spam / complaint /
 * opt_out within LEAD_NEGATIVE_COOL_OFF_DAYS. It is a per-caller "must not
 * text" fact like suppression, so it sits beside it, and D-06's relative order
 * among the others is unchanged. The CHECK below lists it at the same position.
 *
 * Phase 15 (D-08b) inserts `recent_conversion` directly AFTER
 * `recent_negative_close`: the caller's newest lead here CONVERTED within
 * LEAD_RECENT_CONVERSION_HOURS — the same kind of per-caller fact. No other
 * member moves; the CHECK below and migration 0042 list it at the same
 * position.
 */
export const TEXT_BACK_SKIP_REASONS = [
  'not_armed',
  'own_number',
  'withheld',
  'not_mobile',
  'suppressed',
  'recent_negative_close',
  'recent_conversion', // 2026-10 (Phase 15, D-08b)
  'recent_text',
  'daily_cap',
  'stale',
  'sms_not_armed',
  'no_template',
  'lead_open',
  'quote_open',
] as const;
export type TextBackSkipReason = (typeof TEXT_BACK_SKIP_REASONS)[number];

/** Which cadence a text-back went out on: a new lead's, or an open quote's (D-08). */
export const TEXT_BACK_ROUTES = ['lead', 'quote'] as const;
export type TextBackRoute = (typeof TEXT_BACK_ROUTES)[number];

/**
 * `text_back_detail` on a SENT about-quote text whose quote cadence could not
 * be paused (12-05, D-08). Written by `src/core/leads/text-back.ts`, claimed
 * for the operator alert by `claimTextBackAlerts` (the third arm of the
 * `missed_calls_text_back_alert_idx` predicate) — one constant, so the writer
 * and the alert predicate cannot drift.
 */
export const TEXT_BACK_PAUSE_FAILED_DETAIL = 'pause_failed';

export const missedCalls = pgTable(
  'missed_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** NULL MEANS A DEAD LETTER — see the header. No FK, no cascade. */
    tenantId: uuid('tenant_id'),

    /** The `tenant_divert_numbers` row the call arrived on. No FK. */
    divertNumberId: uuid('divert_number_id'),

    /** Only Twilio today (D-01). Half of the arbiter. */
    provider: text('provider').notNull().default('twilio'),

    /**
     * Twilio's `CallSid` (`CA` + 32 hex). The other half of the arbiter. NULL
     * only on a dead letter whose request carried no usable CallSid — the table
     * CHECK below refuses a NULL anywhere else.
     */
    providerCallId: text('provider_call_id'),

    /**
     * The `To` the call arrived on — the tenant key (D-02). The EMPTY STRING
     * when the request carried none (the `inbound_messages.from_address = ''`
     * precedent): NOT NULL because every real call has one, and inventing one
     * would put a fabricated number on the triage surface.
     */
    calledNumberE164: text('called_number_e164').notNull(),

    /** E.164, or NULL for a withheld caller. NEVER PRINTED. */
    callerE164: text('caller_e164'),
    callerWithheld: boolean('caller_withheld').notNull().default(false),
    /** One of CALLER_KINDS. */
    callerKind: text('caller_kind').notNull(),
    /** The raw `From`, at most 64 characters. Evidence for S2. NEVER PRINTED. */
    callerRaw: text('caller_raw'),
    /** The raw `ForwardedFrom`, when a carrier sent one. Evidence only (D-02). */
    forwardedFromRaw: text('forwarded_from_raw'),
    /** Twilio's `FromCountry`, when present. */
    fromCountry: text('from_country'),

    /** UTC server receipt time. See the header. */
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    /** Computed once at arrival from the tenant's window. See the header. */
    afterHours: boolean('after_hours').notNull(),

    /** The latest `CallStatus` we heard. One of MISSED_CALL_STATUSES. */
    callStatus: text('call_status'),
    /** `CallDuration` from the completed callback / the call log. */
    durationSeconds: integer('duration_seconds'),
    endedAt: timestamp('ended_at', { withTimezone: true }),

    /** One of MISSED_CALL_SOURCES. */
    source: text('source').notNull(),
    /** One of MISSED_CALL_COMPLETIONS, or NULL. */
    completedVia: text('completed_via'),

    /** One of DEAD_LETTER_REASONS on a dead letter; NULL on every real row. */
    deadLetterReason: text('dead_letter_reason'),
    /** Dead letters only: at most 8 000 characters of what arrived. */
    rawPayload: jsonb('raw_payload'),

    /* ── The text-back decision (Phase 12). Every column nullable: a Phase 11
     *    arrival insert that never names them stays legal between the schema
     *    push and the code push, and the arrival door's insert TYPE omits them
     *    all, so the webhook cannot write an outcome. ───────────────────── */

    /** One of TEXT_BACK_STATUSES, or NULL for "undecided". See above. */
    textBackStatus: text('text_back_status'),
    /** One of TEXT_BACK_SKIP_REASONS exactly when the status is `skipped`. */
    textBackSkipReason: text('text_back_skip_reason'),
    /** One of TEXT_BACK_ROUTES once a send was claimed; else NULL. */
    textBackRoute: text('text_back_route'),
    /** When the claim was won (the 24-hour rule and daily cap count from it). */
    textBackDecidedAt: timestamp('text_back_decided_at', { withTimezone: true }),
    /**
     * A provider CODE or a fixed lower_snake_case marker — never provider prose
     * (the `failure_code` precedent in 0038): the CHECK refuses anything that
     * could carry a number or a sentence.
     */
    textBackDetail: text('text_back_detail'),
    /** When the operator was told about a failed / unknown text-back. */
    textBackAlertedAt: timestamp('text_back_alerted_at', { withTimezone: true }),
    /** The lead this call opened or joined. No FK. */
    leadId: uuid('lead_id'),
    /** The cadence the text-back went out on. No FK. */
    cadenceId: uuid('cadence_id'),
    /** The `send_ledger.id` of the text-back. No FK. */
    textBackLedgerId: uuid('text_back_ledger_id'),

    /**
     * Set ONCE by the nightly pseudonymisation pass when this row's caller
     * numbers were replaced by keyed hashes (Phase 15, D-06). NULL means the
     * row still carries them; never cleared. Nullable with no default, so
     * Phase 14 code meets the 0042 schema safely.
     */
    pseudonymisedAt: timestamp('pseudonymised_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * THE ARBITER (D-06). NULLs are distinct in a Postgres unique index, so dead
     * letters without a CallSid never collide with each other — and a real row
     * can never have a NULL call id (the table CHECK below).
     */
    uniqueIndex('missed_calls_provider_call_uniq').on(table.provider, table.providerCallId),

    /** "Latest call for this client" and the recent-calls list. */
    index('missed_calls_tenant_started_idx').on(
      table.tenantId,
      sql`${table.startedAt} DESC`,
      sql`${table.id} DESC`,
    ),

    check('missed_calls_provider_known', sql`provider IN ('twilio')`),
    check(
      'missed_calls_caller_kind_known',
      sql`caller_kind IN ('mobile', 'other_number', 'withheld')`,
    ),
    check(
      'missed_calls_call_status_known',
      sql`call_status IS NULL OR call_status IN ('queued', 'initiated', 'ringing', 'in-progress', 'completed', 'busy', 'failed', 'no-answer', 'canceled')`,
    ),
    check(
      'missed_calls_duration_nonnegative',
      sql`duration_seconds IS NULL OR duration_seconds >= 0`,
    ),
    check('missed_calls_source_known', sql`source IN ('webhook', 'reconcile')`),
    check(
      'missed_calls_completed_via_known',
      sql`completed_via IS NULL OR completed_via IN ('callback', 'reconcile')`,
    ),
    check(
      'missed_calls_dead_letter_reason_known',
      sql`dead_letter_reason IS NULL OR dead_letter_reason IN ('unknown_number', 'unparseable', 'not_inbound', 'body_unreadable')`,
    ),
    /**
     * A row with no CallSid is only legitimate as a dead letter. Without this,
     * a real arrival that lost its id would slip past the arbiter and every
     * redelivery would insert another copy.
     */
    check(
      'missed_calls_call_id_or_dead_letter',
      sql`dead_letter_reason IS NOT NULL OR provider_call_id IS NOT NULL`,
    ),

    /* ── Phase 12: the text-back columns ─────────────────────────────── */

    check(
      'missed_calls_text_back_status_known',
      sql`text_back_status IS NULL OR text_back_status IN ('claimed', 'sent', 'failed', 'skipped')`,
    ),
    check(
      'missed_calls_text_back_skip_reason_known',
      sql`text_back_skip_reason IS NULL OR text_back_skip_reason IN ('not_armed', 'own_number', 'withheld', 'not_mobile', 'suppressed', 'recent_negative_close', 'recent_conversion', 'recent_text', 'daily_cap', 'stale', 'sms_not_armed', 'no_template', 'lead_open', 'quote_open')`,
    ),
    check(
      'missed_calls_text_back_route_known',
      sql`text_back_route IS NULL OR text_back_route IN ('lead', 'quote')`,
    ),
    check(
      'missed_calls_text_back_detail_shape',
      sql`text_back_detail IS NULL OR text_back_detail ~ '^[A-Za-z0-9_]{1,48}$'`,
    ),
    /**
     * A reason exactly when skipped: a reason on a sent row would be a lie.
     * `coalesce` because a bare `text_back_status = 'skipped'` is NULL on an
     * undecided row, and a CHECK that evaluates to NULL passes — which would
     * admit a reason on a row nobody decided.
     */
    check(
      'missed_calls_skip_reason_iff_skipped',
      sql`(coalesce(text_back_status, '') = 'skipped') = (text_back_skip_reason IS NOT NULL)`,
    ),
    /** A dead letter has no tenant, so nobody's name could be on a text. */
    check(
      'missed_calls_no_text_back_on_dead_letter',
      sql`tenant_id IS NOT NULL OR text_back_status IS NULL`,
    ),

    /*
     * IN-04 (Phase 11 review): the consistency the writers already keep,
     * made structural. Pre-flighted against production with
     * `npm run missed-calls:invariants` before 0039 was written: all three
     * mismatch counts were zero, so all three are plain (validated) CHECKs.
     */
    check(
      'missed_calls_withheld_has_no_number',
      sql`(caller_kind = 'withheld') = (caller_e164 IS NULL)`,
    ),
    check(
      'missed_calls_withheld_flag_consistent',
      sql`caller_withheld = (caller_kind = 'withheld')`,
    ),
    check(
      'missed_calls_dead_letter_iff_no_tenant',
      sql`(tenant_id IS NULL) = (dead_letter_reason IS NOT NULL)`,
    ),

    /** The tick sweep (D-20): undecided calls of a real tenant, oldest first. */
    index('missed_calls_text_back_pending_idx')
      .on(table.startedAt)
      .where(sql`text_back_status IS NULL AND tenant_id IS NOT NULL`),
    /** The 24-hour rule and the daily cap (D-06/D-07). */
    index('missed_calls_text_back_caller_idx')
      .on(table.tenantId, table.callerE164, sql`${table.textBackDecidedAt} DESC`)
      .where(sql`text_back_status IN ('claimed', 'sent')`),
    /**
     * The failure alert claim (D-10). Widened beyond failed/claimed to the row
     * plan 12-05 writes when a quote cadence could not be paused
     * (`text_back_detail = 'pause_failed'`), so one claim finds both.
     */
    index('missed_calls_text_back_alert_idx')
      .on(table.textBackDecidedAt)
      .where(
        sql`text_back_alerted_at IS NULL AND (text_back_status IN ('failed', 'claimed') OR text_back_detail = 'pause_failed')`,
      ),

    /**
     * TWO ARMS, the `messaging_config_audit` shape: a member sees their own
     * client's calls, and only an operator sees a dead letter (tenant_id NULL),
     * which `has_tenant_access(NULL)` could never admit. References
     * `is_operator()` from migration 0009.
     */
    pgPolicy('missed_calls_member_or_operator_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`(tenant_id IS NOT NULL AND has_tenant_access(tenant_id)) OR (tenant_id IS NULL AND is_operator())`,
      withCheck: sql`(tenant_id IS NOT NULL AND has_tenant_access(tenant_id)) OR (tenant_id IS NULL AND is_operator())`,
    }),
  ],
);

export type MissedCall = typeof missedCalls.$inferSelect;
export type NewMissedCall = typeof missedCalls.$inferInsert;
