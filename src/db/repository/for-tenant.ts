/**
 * `forTenant(tenantId)` — the ONLY sanctioned path from service-role code to
 * tenant data (ONB-05, 01-RESEARCH.md Pattern 3).
 *
 * The design rule that makes this work: **the tenant is closed over at
 * construction and no method ever accepts a `tenantId` parameter.** A per-call
 * parameter reintroduces exactly the bug shape this layer exists to remove —
 * a caller who forgets an argument, or passes the wrong one, in one of the
 * hundreds of queries later phases will write. Here, forgetting is not
 * expressible: there is no query surface that is not already scoped.
 *
 * Cross-tenant work (the Phase 3 cadence tick claiming due rows across every
 * client) does NOT belong here. It gets explicitly-named exports of the form
 * `forAllTenants_<operation>()` so a reviewer can grep one string and see every
 * cross-tenant touchpoint in the codebase. None exist in Phase 1.
 */
import {
  and,
  desc,
  eq,
  exists,
  getTableColumns,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notExists,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';

// THE SAME ARRAY THE QUEUE IS POPULATED FROM (`APPROVAL_QUEUE_STATUSES` in
// `for-all-tenants.ts` is an alias of this constant). `skipPendingWhere` may
// move EXACTLY what the queue may show — one array, so a widened queue and a
// widened skip cannot come apart. See that method's header for why the guard is
// equality on the source statuses rather than `notInArray(TERMINAL_…)`.
import { STALLABLE_TOUCH_STATUSES } from '@/core/aging/stall-policy';
// TYPE ONLY, and the direction is deliberate: `ledger.listForQuote` below
// returns exactly the columns the attribution rule is allowed to read, so the
// select list and the rule's `Pick` are ONE declaration rather than two that
// can drift. The import erases at build time, so no runtime dependency runs
// from the repository into `src/core` — the same shape as
// `STALLABLE_TOUCH_STATUSES` above, one degree stricter.
import type { LedgerTouchFields } from '@/core/attribution/qualify';
// 07-05, RPT-03: the first-touch window and the onboarding-gate attestation
// kind, read from the ONE place each is written — the same two imports
// `for-all-tenants.ts` makes, because the two metric reads must apply the same
// rule and a `24` typed into either SQL body would be a second definition.
import { FIRST_TOUCH_HOURS } from '@/core/audit/constants';
import { PSEUDONYMISE_AFTER_DAYS } from '@/core/leads/constants';
import { SM8_AUTOMATION_ATTESTATION_KIND } from '@/core/drafting/onboarding-gate';
import type { FeeRow } from '@/core/reporting/fees';
import type { TenantMetricCounts } from '@/core/reporting/metrics';
import type { MissedCallCounts } from '@/core/reporting/missed-call-figures';
import type { Period } from '@/core/reporting/period';

import {
  cadences,
  cadenceSettings,
  cadenceTouches,
  cadenceTouchTemplates,
  escalations,
  eventConsumerCursors,
  inboundMessages,
  leads,
  LEAD_CONVERSION_REASONS,
  messageTemplates,
  missedCalls,
  monthlyReports,
  quoteAttributions,
  quoteContacts,
  quotes,
  quoteStatusEvents,
  ONBOARDING_PAUSE_REASON,
  sendLedger,
  sm8Connections,
  suppressedContacts,
  syncRuns,
  tenantAttestations,
  tenantDivertNumbers,
  tenantFees,
  tenantNeverTextNumbers,
  tenantProofs,
  tenants,
  TEXT_BACK_VARIANTS,
  textBackTemplates,
  touchDrafts,
  type Cadence,
  type CadenceKind,
  type CadencePauseReason,
  type CadenceSettings,
  type CadenceStopReason,
  type CadenceTouch,
  type CadenceTouchTemplate,
  type Lead,
  type LeadClosedReason,
  type LeadJobErrorKind,
  type LeadLabel,
  type MessageTemplate,
  type MessageTemplateKind,
  type MissedCall,
  type MonthlyReport,
  type NewCadence,
  type NewCadenceTouch,
  type NewQuote,
  type NewMonthlyReport,
  type NewQuoteAttribution,
  type NewQuoteContact,
  type NewQuoteStatusEvent,
  type NewSendLedgerRow,
  type NewSm8Connection,
  type NewSuppressedContact,
  type NewSyncRun,
  type NewTenantFee,
  type NewTouchDraft,
  type Quote,
  type QuoteAttribution,
  type QuoteStatusEvent,
  type SendLedgerOutcome,
  type SendLedgerRow,
  type Sm8Connection,
  type SuppressedContact,
  type SuppressionChannel,
  type SyncRun,
  type Tenant,
  type TenantAttestation,
  type TenantAttestationKind,
  type TenantDivertNumber,
  type TenantFee,
  type NeverTextKind,
  type TenantNeverTextNumber,
  type TenantProof,
  type TenantProofKind,
  type TouchChannel,
  type TextBackRoute,
  type TextBackSkipReason,
  type TextBackTemplate,
  type TextBackVariant,
  type TouchDraft,
  type UpgradablePauseReason,
  type TouchSkipReason,
} from '@/db/schema';

import { getDb, type RepositoryDb } from './client';

/**
 * Mutable tenant fields. `id` is deliberately not patchable — repointing a row's
 * primary key would move data between tenants, the precise outcome this module
 * exists to make impossible. `createdAt` is history, not state.
 *
 * This type is the compile-time half only; `update()` enforces the same rule at
 * runtime (see `IMMUTABLE_KEYS`), because a patch parsed from JSON carries no
 * types with it.
 */
export type TenantPatch = Partial<Omit<Tenant, 'id' | 'createdAt'>>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Keys `update()` refuses at RUNTIME, not merely in the type.
 *
 * `TenantPatch` erases at compile time, and drizzle's `.set(patch)` maps every
 * key present on the object to its column — so `update(JSON.parse(body))`
 * carrying an `id` would emit `UPDATE tenants SET id = $1 WHERE id = $2` and
 * move the row to another tenant. That is the exact outcome this module's header
 * says it exists to make impossible, so it is enforced the same way the
 * constructor enforces `tenantId`: loudly, before Postgres sees anything.
 */
const IMMUTABLE_KEYS: ReadonlySet<string> = new Set(['id', 'createdAt', 'created_at']);

/**
 * Every remaining column of `tenants`, read from the schema rather than listed by
 * hand so a column added in a later phase is patchable without editing this file
 * — and so a typo'd key is rejected instead of being silently dropped.
 */
const MUTABLE_KEYS: ReadonlySet<string> = new Set(
  Object.keys(getTableColumns(tenants)).filter((k) => !IMMUTABLE_KEYS.has(k)),
);

/**
 * The connection fields a caller may set. `tenantId` is absent by construction —
 * it comes from the closure, which is the whole point of this module.
 */
export type ConnectionUpsert = Omit<NewSm8Connection, 'tenantId' | 'id' | 'createdAt'>;

/** A partial write to the connection row — cursors, pause flags, counters. */
export type ConnectionPatch = Partial<ConnectionUpsert>;

/** Likewise for a quote row: the tenant is not the caller's to supply. */
export type QuoteUpsert = Omit<NewQuote, 'tenantId' | 'id' | 'createdAt' | 'updatedAt'>;

/** A mirrored job contact. */
export type QuoteContactUpsert = Omit<
  NewQuoteContact,
  'tenantId' | 'id' | 'createdAt' | 'updatedAt'
>;

/**
 * An outbox row. `id` and `detectedAt` are the database's to assign — a
 * caller-supplied `id` would break the monotonic ordering every consumer
 * cursors on, and a caller-supplied `detectedAt` would let a clock skew reorder
 * the record of when we noticed.
 */
export type QuoteStatusEventInsert = Omit<
  NewQuoteStatusEvent,
  'tenantId' | 'id' | 'detectedAt'
>;

/** A cycle's health-log row. */
export type SyncRunInsert = Omit<NewSyncRun, 'tenantId' | 'id' | 'createdAt'>;

/**
 * A new cadence. The tenant comes from the closure; `status`, `pause_reason`
 * and `stop_reason` are omitted deliberately — creation only ever produces the
 * default `'active'`, and every other state is reached through the guarded
 * transitions below rather than by writing a status directly.
 *
 * The exception is D-04's no-usable-contact case, which must land already
 * stopped so the event is consumed exactly once. That is a `create` followed by
 * `stopWhereLive` in one transaction, not a status the caller may invent.
 */
export type CadenceCreate = Omit<
  NewCadence,
  | 'tenantId'
  | 'id'
  | 'status'
  | 'pauseReason'
  | 'stopReason'
  | 'createdAt'
  | 'updatedAt'
  | 'createdByEventId'
> & {
  /**
   * REQUIRED, though the column is nullable (G-3-2). The column accepts NULL so
   * that rows written before migration 0021 stay legal; a CALLER may not choose
   * NULL, because `created_by_event_id` is what makes a replayed `quote_opened`
   * conflict instead of creating a duplicate cadence. Optional here would let a
   * future caller silently decline the replay guarantee and only find out in
   * production, on a held cursor.
   */
  createdByEventId: number;
};

/**
 * A LEAD cadence as `cadences.createLead` takes it (Phase 12, D-04/D-19).
 *
 * Deliberately NOT `CadenceCreate` with optional quote fields: the kind, both
 * quote columns and the event id are fixed by the method itself, so no caller
 * can create a lead cadence that carries a quote, or a quote cadence without
 * its replay key (the widened `cadences_replay_key_present` admits a lead row
 * with no event because it IS a lead row).
 */
export interface LeadCadenceCreate {
  leadId: string;
  /** The caller, normalised `+614…`. The contact snapshot (D-04). */
  contactMobile: string;
  /** Day 0 — the moment the text-back was decided. */
  anchorAt: Date;
}

/** What `leads.openOrCreate` takes: the call that opens the lead. */
export interface LeadOpen {
  contactMobile: string;
  firstMissedCallId: string;
  afterHours: boolean;
  at: Date;
}

/**
 * The closing facts of a caller's NEWEST lead at this client (Phase 13, D-12),
 * as `leads.latestForMobile` reads them for the 90-day negative cool-off and
 * (Phase 15, D-08b) the one-day recent conversion. `closedReason`/`closedAt`
 * are NULL only while the lead is `open`: they are written for `converted`
 * too (`leads_closed_iff_reason`, 0041).
 */
export interface LeadCloseFacts {
  status: string;
  closedReason: string | null;
  closedAt: Date | null;
}

/**
 * An OPEN lead whose lead cadence has ended (Phase 13, D-01/D-14), as
 * `leads.listOpenWithEndedCadence` reads it for the reconciling sweep. Ids and
 * two vocabulary values only — no number, no body.
 */
export interface LeadWithEndedCadence {
  leadId: string;
  /** `completed`, `expired` or `stopped`. */
  cadenceStatus: string;
  /** One of CADENCE_STOP_REASONS when stopped, else NULL. */
  stopReason: string | null;
}

/**
 * What `leads.claimJobCreation` hands back when THIS tap won the claim (Phase
 * 14, D-04): the uuids a previous attempt already persisted, which the retry
 * reconciles on before it creates anything, and the description digest it
 * adopts an orphaned job by (checker W1). Zero rows means the claim was lost.
 */
export interface LeadJobClaim {
  id: string;
  sm8CompanyUuid: string | null;
  sm8JobUuid: string | null;
  sm8JobContactUuid: string | null;
  sm8JobDescriptionSha256: string | null;
}

/**
 * The refusal read after a zero-row claim (Phase 14, D-04) — which answer the
 * second tap gets: `already_in_progress`, `already_created` or `not_open`.
 * (Named `…Facts` so it does not shadow the schema's `LeadJobState` union.)
 */
export interface LeadJobStateFacts {
  status: string;
  /** One of LEAD_JOB_STATES. */
  sm8JobState: string;
  sm8JobUuid: string | null;
  /** One of LEAD_JOB_ERROR_KINDS, or NULL. */
  sm8JobErrorKind: string | null;
  sm8JobAttemptCount: number;
}

/**
 * The per-step persist of `leads.setJobLinkage` (Phase 14, D-04): each uuid is
 * written the moment ServiceM8 answers with it, so a crash between steps leaves
 * the retry something to reconcile on rather than a second blind create.
 */
export interface LeadJobLinkagePatch {
  companyUuid?: string;
  /** `null` clears a persisted job the tradie has since deleted (14-REVIEW WR-01). */
  jobUuid?: string | null;
  /** `null` clears that deleted job's contact uuid with it. */
  contactUuid?: string | null;
  /** `null` clears an adopt key that named another lead's job (14-REVIEW WR-02). */
  descriptionSha256?: string | null;
}

/**
 * One lead's job linkage for the inbox row (Phase 14, D-09): the lead's state
 * and reason, and the mirrored job's status and number when the job is in the
 * quotes mirror. No number, no body.
 */
export interface LeadJobLinkage {
  leadId: string;
  status: string;
  closedReason: string | null;
  sm8JobUuid: string | null;
  sm8JobState: string;
  sm8JobErrorKind: string | null;
  sm8JobAttemptCount: number;
  /** The mirror's `quotes.status` for the linked job, or NULL when not mirrored. */
  jobStatus: string | null;
  /** The mirror's `quotes.generated_job_id`, or NULL. */
  jobGeneratedId: string | null;
}

/**
 * The ONE read the confirm sheet's preview and the create path both build the
 * job description from (Phase 14, D-01) — so a posted preview is never trusted.
 * CARRIES THE CALLER'S MOBILE AND THEIR WORDS: see `leads.jobSheetFacts` for
 * its two permitted callers.
 */
export interface LeadJobSheetFacts {
  id: string;
  status: string;
  /** Normalised `+614…`. NEVER PRINTED. */
  contactMobile: string;
  firstMissedAt: Date;
  afterHours: boolean;
  sm8JobState: string;
  sm8CompanyUuid: string | null;
  sm8JobUuid: string | null;
  sm8JobContactUuid: string | null;
  sm8JobErrorKind: string | null;
  sm8JobAttemptCount: number;
  /** The newest lead cadence's `contact_name`, or NULL when none. */
  contactName: string | null;
  /**
   * This lead's threaded, non-STOP replies, OLDEST FIRST. The newest reply's
   * `id` is what the thread-changed check compares (checker W3).
   */
  replies: Array<{ id: string; body: string; receivedAt: Date; urgency: string | null }>;
}

/**
 * One `/leads` card's PERSONAL facts (Phase 15, D-01) — the half of the queue
 * the cross-tenant read (`listOpenLeadsForQueue`, the lead family) refuses to
 * carry. CARRIES THE CALLER'S MOBILE AND THEIR WORDS: see `leads.queueCards`
 * for its one permitted caller.
 */
export interface LeadQueueCardFacts {
  leadId: string;
  /** Normalised `+614…`. Rendered on the operator-only card; NEVER LOGGED. */
  contactMobile: string;
  /** The lead's NEWEST threaded, non-STOP reply, or NULL when it has none. */
  reply: {
    id: string;
    body: string;
    label: string | null;
    labelConfidence: string | null;
    urgency: string | null;
    isHot: boolean;
    receivedAt: Date;
  } | null;
}

/**
 * One row of the client page's missed-call log (Phase 15, D-02) — every column
 * NAMED, never `select()` star into a page. CARRIES THE CALLER'S NUMBER
 * (`callerE164`, NULL for a withheld caller): see `missedCalls.listForLog` for
 * its one permitted caller.
 */
export interface MissedCallLogRow {
  id: string;
  /** Arrival — the keyset's first column. */
  startedAt: Date;
  afterHours: boolean;
  callerKind: string;
  /** Normalised E.164, NULL iff withheld. Rendered for the operator; NEVER LOGGED. */
  callerE164: string | null;
  textBackStatus: string | null;
  textBackSkipReason: string | null;
  textBackRoute: string | null;
  textBackDecidedAt: Date | null;
  leadId: string | null;
  cadenceId: string | null;
  textBackLedgerId: string | null;
  /** Set once the privacy pass replaced this row's numbers (D-06). */
  pseudonymisedAt: Date | null;
  /** The ledger's delivery verdict for the text-back, or NULL (no ledger row / no receipt). */
  deliveryStatus: string | null;
  /** The lead's status and reason, when the call opened or joined one. */
  leadStatus: string | null;
  leadClosedReason: string | null;
  /** The quote of a `quote`-route call, through its cadence. */
  quoteId: string | null;
}

/** The keyset cursor of the missed-call log: the last row of the previous page. */
export interface MissedCallLogCursor {
  startedAt: Date;
  id: string;
}

/**
 * What one lead's pseudonymisation changed (Phase 15, D-06): rows touched per
 * table. `leads` is 1 when the lead was hashed and stamped, 0 when the guard
 * refused it (open, already stamped, or not this tenant's).
 */
export interface PseudonymiseLeadCounts {
  leads: number;
  inboundRows: number;
  /**
   * 15-REVIEW WR-01: replies from the lead's number we could not place
   * (`unmatched`/`ambiguous`, no lead, no quote), hashed with the lead.
   */
  inboundRowsNoLead: number;
  cadenceRows: number;
  ledgerRows: number;
}

/**
 * One unstamped missed call of a lead, as the privacy pass reads it (Phase 15,
 * D-06). CARRIES THE RAW CALLER STRINGS — the pass hashes them in memory and
 * writes the hashes back through `missedCalls.pseudonymise`. NEVER LOGGED.
 */
export interface MissedCallRawStrings {
  id: string;
  callerE164: string | null;
  callerRaw: string | null;
  forwardedFromRaw: string | null;
}

/**
 * The three hashes a missed call's caller columns take — each NULL exactly
 * where the stored value is NULL (a withheld call keeps `caller_e164` NULL:
 * `missed_calls_withheld_has_no_number`).
 */
export interface MissedCallHashes {
  callerE164: string | null;
  callerRaw: string | null;
  forwardedFromRaw: string | null;
}

/** An open lead the sync may match to a tradie's own job (Phase 14, D-07). */
export interface LeadJobMatchCandidate {
  id: string;
  /** Normalised `+614…`. NEVER PRINTED. */
  contactMobile: string;
  firstMissedAt: Date;
}

/** A lead of this tenant linked to a given ServiceM8 job (Phase 14, D-06). */
export interface LeadLinkedToJob {
  leadId: string;
  sm8JobState: string;
  closedReason: string | null;
}

/** A mirrored, active job dated inside a window (Phase 14, D-07). */
export interface ActiveJobInRange {
  sm8JobUuid: string;
  companyUuid: string | null;
  dateRaw: string | null;
  status: string;
}

/** A mirrored job contact's numbers, for the tradie-booked match (Phase 14, D-07). */
export interface JobContactMobile {
  sm8JobUuid: string;
  mobile: string | null;
  phone: string | null;
  sm8Active: boolean;
}

/**
 * A mirrored contact whose mobile or phone ends with the caller's last three
 * digits, with the company of its job (Phase 14, D-02 tier (i)). A COARSE
 * prefilter: equality is decided in TypeScript by `normalizeAuMobile`.
 * `sm8Active` is the CONTACT's flag.
 */
export interface CompanyCandidate {
  mobile: string | null;
  phone: string | null;
  companyUuid: string | null;
  dateRaw: string | null;
  sm8Active: boolean;
}

/** One default lead wording row, as `templates.ensureLeadDefaults` seeds it. */
export interface LeadTemplateDefault {
  touchNumber: number;
  body: string;
}

/**
 * What `templates.insertVersion` takes: one new, UNAPPROVED wording version.
 *
 * `kind` (Phase 13, D-02) defaults to 'quote' — every Phase 5 caller writes
 * quote wording and passes nothing. Plan 13-02's lead default seed passes
 * 'lead' and uses the same insert, so the version arithmetic is per
 * `(kind, touch, channel)` in one place.
 */
export interface TemplateVersionInsert {
  touchNumber: number;
  channel: TouchChannel;
  body: string;
  subject?: string | null;
  kind?: MessageTemplateKind;
}

/**
 * The labels that END a lead when the classifier writes them at high
 * confidence (Phase 13, D-11). The four "open" labels (`new_enquiry`,
 * `callback_request`, `question`, `other`) need no action — the reply already
 * paused the cadence at the door.
 */
const LEAD_CLOSING_LABELS = [
  'existing_job',
  'complaint',
  'not_a_lead',
  'already_sorted',
  'spam',
  'opt_out',
] as const satisfies readonly LeadLabel[];
export type LeadClosingLabel = (typeof LEAD_CLOSING_LABELS)[number];

/** One row of `inbound.closingLabelRowsForOpenLeads` — ids and a label only. */
export interface ClosingLabelRow {
  inboundMessageId: string;
  leadId: string;
  label: LeadClosingLabel;
}

/**
 * What `inbound.byIdForEscalation` returns: the reply's words and sender, for
 * a held escalation's release only. See the method's header.
 */
export interface InboundForEscalation {
  body: string;
  fromAddress: string;
  cadenceId: string | null;
  leadId: string | null;
}

/**
 * The text-back decision as `missedCalls.setTextBackDecision` writes it.
 * Every field is explicit so a skip cannot carry a route and a send cannot
 * carry a reason by omission (`missed_calls_skip_reason_iff_skipped`).
 */
export type TextBackDecisionPatch =
  | {
      status: 'skipped';
      skipReason: TextBackSkipReason;
      /**
       * Phase 13, D-07 — the ring-twice keys. A `recent_text` or `lead_open`
       * skip for a caller who already has an open lead records WHICH lead the
       * call joined and that lead's live cadence, so the ring-twice
       * escalation pass (plan 13-06) can find the second call without a join
       * on a caller's number. Absent on every other skip, and on a skip for a
       * caller with no open lead — those rows write neither id, as before.
       */
      leadId?: string;
      cadenceId?: string;
    }
  /**
   * The ONE skip that names a route (12-05, D-08/D-16): a repeat call from a
   * customer whose quote cadence already had its about-quote text. No text,
   * but the call is attached to the quote cadence so the quote-call
   * escalation still tells the tradie.
   */
  | { status: 'skipped'; skipReason: 'quote_open'; route: 'quote'; cadenceId: string }
  | {
      status: 'claimed';
      route: TextBackRoute;
      leadId: string | null;
      cadenceId: string;
      ledgerId: string;
    };

/**
 * One text-back wording save (Phase 12, D-02). No `version` (computed inside
 * the INSERT) and no attestation column (a save is never an attestation), so
 * neither can be supplied by a caller.
 */
export interface TextBackTemplateInsert {
  variant: TextBackVariant;
  /** The validator's normalised body — the literal bytes that will be sent. */
  body: string;
  /** Segments as the shared GSM-7 counter measured the body (1 or 2). */
  segments: number;
  /** The operator's Supabase user id, from `requireOperatorId()`. */
  createdBy: string;
}

/** One never-text entry as `neverText.add` takes it (Phase 12, D-06). */
export interface NeverTextAdd {
  /** Normalised E.164 `+61…` — the column CHECK's shape. NEVER PRINTED. */
  numberE164: string;
  kind: NeverTextKind;
  /** The operator's short note, at most 60 characters (column CHECK). */
  label: string | null;
  /** The operator's Supabase user id. */
  createdBy: string;
}

/**
 * How many DETERMINISTIC drafting refusals one touch may collect before
 * `listNeedsDraft` stops offering it.
 *
 * ── WHY THIS IS NOT `MAX_DRAFT_ATTEMPTS` ────────────────────────────────────
 *
 * That one counts `touch_drafts` rows — evidence of what the model WROTE. A
 * 400/401/403 produces no row, so it cannot move that ceiling, and a touch whose
 * input makes every request a 400 would be re-attempted twice a minute until
 * D-12 expires the cadence six weeks later. Two counters because they bound two
 * genuinely different things: output the validator rejected, and requests the
 * API refused to answer at all.
 *
 * Five, matching `MAX_CLASSIFY_ATTEMPTS`, and the cap lives in the read's
 * predicate for the same stated reason: the burn is cross-tick, and a
 * caller-side check has already paid for the call it was meant to prevent.
 */
export const MAX_DRAFT_FAILURES = 5;

/** A materialized touch row. `status` defaults to `'scheduled'`. */
export type CadenceTouchInsert = Omit<
  NewCadenceTouch,
  'tenantId' | 'id' | 'status' | 'skipReason' | 'createdAt' | 'updatedAt'
>;

/**
 * The claim written BEFORE the sender is invoked.
 *
 * `outcome` and `providerMessageId` are absent by construction: they are not
 * known at claim time, and a caller who could supply them at insert would be
 * recording a result for a send that has not happened. They arrive later
 * through `setOutcome`.
 */
export type SendLedgerClaim = Omit<
  NewSendLedgerRow,
  'tenantId' | 'id' | 'outcome' | 'providerMessageId' | 'claimedAt'
>;

/**
 * One recorded generation attempt (AI-04).
 *
 * `approvedAt` and `editDistance` are absent BY CONSTRUCTION, for the reason
 * `SendLedgerClaim` omits `outcome`: neither is known when a draft is written,
 * and a caller who could supply them at insert would be recording a human's
 * approval for a draft no human has seen. They arrive later, through
 * `drafts.approve`, which is the whole D-12 gate.
 *
 * `status` stays REQUIRED, unlike `CadenceTouchInsert`'s: a draft is inserted as
 * `generated` or as `validator_failed` depending on what the validator said, and
 * a default would pick one of those two on the caller's behalf — silently
 * recording a refused draft as a good one.
 */
export type TouchDraftInsert = Omit<
  NewTouchDraft,
  'tenantId' | 'id' | 'approvedAt' | 'editDistance' | 'createdAt'
>;

/**
 * The D-05 voice profile, as ONE exhaustive patch over all six columns.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ EVERY FIELD IS REQUIRED IN THE OBJECT AND NULLABLE IN THE VALUE.         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `Partial` was the obvious shape and is the wrong one. This profile is edited
 * on one form that submits every field at once, so an absent key means the
 * operator CLEARED that field — and a partial patch would silently keep the old
 * value, leaving a banned phrase the client has since withdrawn sitting in the
 * drafting prompt with a screen that says it is gone. Same argument
 * `upsertChannelConfig`'s exhaustive SET clause makes about a cleared
 * from-address.
 *
 * The arrays are `string[] | null` rather than `string[]`, because an empty
 * array and "not stated" are different facts about a tradie's voice and the
 * column is nullable to hold both.
 */
export interface VoiceProfilePatch {
  greetingStyle: string | null;
  signOff: string | null;
  formality: string | null;
  bannedPhrases: string[] | null;
  exampleMessages: string[] | null;
  voiceNotes: string | null;
}

/**
 * A THREADED REPLY AS THE EVIDENCE CHAIN IS ALLOWED TO SEE IT (RPT-01, T-7-15).
 *
 * WRITTEN OUT RATHER THAN `Pick<InboundMessage, …>`, unlike the ledger shape one
 * type over. A `Pick` names the columns to KEEP, and the danger on this table is
 * the columns to DROP: `body`, `from_address`, `normalized_from`, `raw_payload`
 * and `to_address` are five different ways to put a stranger's words or their
 * mobile number into a jsonb column that outlives every retention rule that
 * governed the row it was copied from. An explicit interface makes adding one a
 * decision somebody typed, not a `Pick` somebody widened.
 *
 * `isStop` is here and the opt-out ADDRESS is not: "this conversation ended in a
 * STOP" is a fact the evidence chain should carry; which number sent it is not.
 */
export interface ThreadedInboundEvidence {
  id: string;
  cadenceId: string | null;
  quoteId: string | null;
  channel: string;
  label: string | null;
  isHot: boolean;
  isStop: boolean;
  receivedAt: Date;
}

/** A suppression entry. Insert-only — see the schema header (D-06/D-15). */
export type SuppressionInsert = Omit<
  NewSuppressedContact,
  'tenantId' | 'id' | 'createdAt'
>;

/**
 * ONE ATTRIBUTION CLAIM — the row the consumer writes when a win qualifies.
 *
 * `tenantId` is absent because the closure supplies it. `attributedAt` is absent
 * for the `tenant_attestations.attestedAt` reason: the moment we recorded the
 * claim is the DATABASE's `defaultNow()`, never a caller's, so a replayed event
 * cannot backdate an attribution to look like it was made at the time.
 *
 * Every other column is REQUIRED, including `evidence`, `windowDays`,
 * `baselineRateBp` and `baselineSource`. Nothing here is optional, and that is
 * the point: an attribution row whose evidence chain or whose window was left
 * unstated is an assertion, and this table exists precisely so that no figure on
 * an invoice is an assertion (D-05).
 */
export type AttributionClaim = Omit<
  NewQuoteAttribution,
  'tenantId' | 'id' | 'attributedAt'
>;

/**
 * ONE GENERATED REPORT, minus the two fields the database owns.
 *
 * `version` is absent BY CONSTRUCTION and cannot be supplied. It is computed
 * inside the INSERT from `COALESCE(MAX(version), 0) + 1`, so two concurrent
 * generates cannot both compute "2" from a read taken before either wrote — the
 * unique index arbitrates and the loser raises 23505 at the write. A caller who
 * could pass a version could overwrite the sequence, which is the one thing
 * D-11's freeze depends on.
 *
 * `generatedAt` is absent for the same reason `attributedAt` is: the moment a
 * document was produced is ours.
 */
export type ReportInsert = Omit<
  NewMonthlyReport,
  'tenantId' | 'id' | 'version' | 'generatedAt'
>;

/**
 * ONE FEE-SCHEDULE ENTRY. Append-only — there is no patch type here and there
 * must never be one (D-13).
 *
 * `effectiveFrom` is REQUIRED and has no default anywhere in the stack, per the
 * schema header: a price change starts on a day an operator SAYS, and a
 * defaulted `now()` would silently backdate or forward-date it depending on when
 * the form was submitted.
 */
export type FeeInsert = Omit<NewTenantFee, 'tenantId' | 'id' | 'createdAt'>;

/**
 * How many report rows the list page renders. Ten years of monthly versions.
 *
 * Not expected to bind — a founding-cohort client generates one or two versions
 * a month — but an unbounded select is a query whose size the data decides, and
 * the five jsonb documents on this table are the largest rows in the schema.
 * The read is ORDERED BEFORE IT IS LIMITED (the QUOTE_LIMIT / ACTIVITY_LIMIT
 * rule), so if the cap ever binds what it drops is the oldest month rather than
 * the report the operator just generated.
 */
export const REPORT_LIST_LIMIT = 120;

/**
 * A report row WITHOUT its five frozen documents.
 *
 * The list page renders a month, a version and a date per row; pulling
 * `figures`, `lines`, `baseline`, `constants` and `fees` for every report to
 * render none of them would move the whole of a client's reporting history over
 * the wire to draw a table of links. `reports.byId` fetches the documents, once,
 * for the one report actually being read.
 *
 * A distinct TYPE rather than a comment, so a caller that reaches for
 * `summary.figures` fails to compile rather than reading `undefined`.
 */
export interface MonthlyReportSummary {
  id: string;
  periodStart: string;
  periodEnd: string;
  timezone: string;
  version: number;
  generatedAt: Date;
}

/** A channel/address pair to test against the suppression list. */
export interface SuppressionProbe {
  channel: SuppressionChannel;
  address: string;
}

/**
 * One touch claimed for sending, carrying the cadence facts dispatch needs.
 *
 * The contact fields are the cadence's SNAPSHOT (D-04), not a join to
 * `quote_contacts`: the mirror re-syncs and the row a cadence selected can
 * change its number between materialization and send. Whoever the cadence
 * decided to talk to is who it keeps talking to, and the ledger records that
 * address as evidence.
 */
export interface ClaimedTouch {
  id: string;
  cadenceId: string;
  /**
   * NULL on a lead touch (Phase 13). Phase 12 typed these two as `string`
   * because `claimDue` admitted quote cadences only; both kinds are claimed
   * now, and the kind-identity CHECK makes a quote row's pair NOT NULL and a
   * lead row's pair NULL. `kind` says which, and dispatch switches on it.
   */
  quoteId: string | null;
  sm8JobUuid: string | null;
  /** One of CADENCE_KINDS — the branch `dispatchOne` takes first. */
  kind: CadenceKind;
  /** The lead this touch chases; NULL on a quote touch. */
  leadId: string | null;
  touchNumber: number;
  /** One of TOUCH_CHANNELS. */
  channel: string;
  scheduledAt: Date;
  contactName: string | null;
  contactMobile: string | null;
  contactEmail: string | null;
}

/**
 * The touch statuses that are NOT terminal. A touch in any of these can still
 * be rescheduled, promoted or skipped; `sent` and `skipped` cannot.
 *
 * Written as the complement of the terminal pair rather than as a list of the
 * live ones, so a status added to TOUCH_STATUSES in a later phase is treated as
 * live by default. The failure direction matters: a new status wrongly treated
 * as terminal makes touches silently unreachable, whereas one wrongly treated
 * as live shows up immediately in a test.
 */
const TERMINAL_TOUCH_STATUSES = ['sent', 'skipped'] as const;

/**
 * The statuses `promoteDue` may promote FROM. ONE. And that is the point.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ D-12: NOTHING IN THIS FILE CAN MOVE A TOUCH TO `approved`.               │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Phase 3 wrote this list with all three promotable statuses, because it
 * auto-passed both D-14 gates: a touch went `scheduled → approved` in one
 * statement, THROUGH `needs_draft` and `pending_approval` without stopping. The
 * header there promised Phase 5 would "replace this one method with real gates".
 * This is that edit.
 *
 * Now `promoteDue` does exactly one thing: `scheduled → needs_draft`. It makes a
 * touch VISIBLE TO THE DRAFTING PASS and nothing more. The two statuses it used
 * to accept as sources are gone from this list deliberately rather than left in
 * as a kindness — accepting `pending_approval` here would let a touch a human
 * has not yet read be re-promoted by the next tick, which is the auto-pass with
 * one extra step.
 *
 * The ONLY path to `approved` is now `drafts.approve` + `touches.approveWhere`,
 * which require an approved draft row to exist. CON-01 (full review) is the
 * product default; relaxing it is a v2 graduated-autonomy decision (V2-01) gated
 * on the AI-04 edit-distance evidence, not something a widened array can do by
 * accident.
 */
const PROMOTABLE_TOUCH_STATUSES = ['scheduled'] as const;

/** The cadence statuses that count as live — the partial unique index's predicate. */
const LIVE_CADENCE_STATUSES = ['active', 'paused'] as const;

/** The stored state `run-sync` diffs a freshly-fetched job against. */
export interface StoredQuoteState {
  id: string;
  sm8JobUuid: string;
  status: string;
  sm8Active: boolean;
  chaseEligibility: string;
}

export interface TenantScopedRepository {
  tenant: {
    /**
     * The tenant's own row. Always an array: `[]` when no such tenant exists —
     * never `null`, never a throw, and never another tenant's row.
     */
    get(): Promise<Tenant[]>;
    /** Update this tenant's row. Returns the updated rows (`[]` if none matched). */
    update(patch: TenantPatch): Promise<Tenant[]>;
  };

  connection: {
    /** This tenant's ServiceM8 connection. `[]` or exactly one row — never more. */
    get(): Promise<Sm8Connection[]>;
    /**
     * Create or replace this tenant's connection.
     *
     * ON CONFLICT against the UNIQUE `tenant_id`, which is what makes a
     * double-submitted connect form (and the 02-04 re-key flow) produce one row
     * instead of two — decided by Postgres rather than by a check-then-insert
     * that two concurrent requests can both pass (ONB-02).
     */
    upsert(values: ConnectionUpsert): Promise<Sm8Connection[]>;
    /**
     * `SELECT ... FOR UPDATE` — the SYNC-03 concurrency guarantee.
     *
     * ONLY MEANINGFUL INSIDE `transaction()`: a row lock is released at the end
     * of the statement outside one, so calling this on the pool locks nothing
     * and returns a row that anybody may already be changing. Called first
     * inside a sync cycle's transaction, it serialises overlapping runs — a
     * webhook hint arriving mid-poll waits rather than racing the poll to emit
     * the same event twice.
     */
    lock(): Promise<Sm8Connection[]>;
    /** Patch the connection row — cursors, pause flags, failure counters. */
    update(patch: ConnectionPatch): Promise<Sm8Connection[]>;
  };

  quotes: {
    /** Every mirrored quote for this tenant, newest edit first. */
    list(): Promise<Quote[]>;
    /** Open quotes only — status 'Quote', not deleted upstream. */
    listOpen(): Promise<Quote[]>;
    /**
     * The stored state for a set of ServiceM8 job uuids — what `run-sync` diffs
     * a freshly-fetched page against to decide which events to emit. Returns
     * only the columns that participate in that decision, because selecting the
     * whole row would invite a caller to make the decision on something else.
     */
    stateFor(sm8JobUuids: string[]): Promise<StoredQuoteState[]>;

    /**
     * One quote row by OUR id, or `[]`. The drafting pass's merge-fact read.
     *
     * A WHOLE ROW, unlike `stateFor`'s five-column projection: drafting needs
     * `job_description`, `total_invoice_amount` and `quote_date_utc`, which that
     * projection deliberately omits because the sync diff has no use for them.
     * Two readers with different questions get two accessors rather than one
     * widened projection that makes the sync path carry columns it never reads.
     *
     * Tenant-scoped like everything here, so a cadence pointing at another
     * tenant's quote id reads `[]` and the draft is deferred rather than
     * assembled from a stranger's job.
     */
    byId(quoteId: string): Promise<Quote[]>;
    /**
     * Upsert on `(tenant_id, sm8_job_uuid)` — the dedupe key that turns the
     * cursor's deliberate overlap re-fetch into updates rather than duplicates.
     * Returns the number of rows written.
     */
    upsertMany(rows: QuoteUpsert[]): Promise<number>;
    /**
     * The same upsert, returning each row's id paired with its ServiceM8 uuid.
     *
     * `run-sync` needs OUR id to write `quote_status_events.quote_id`, and it
     * needs it for rows that were UPDATED as well as inserted — which is why
     * this is the upsert's own RETURNING rather than a second SELECT that a
     * concurrent delete could come up short on.
     */
    upsertManyReturning(
      rows: QuoteUpsert[],
    ): Promise<Array<{ id: string; sm8JobUuid: string }>>;
    /**
     * The D-15 triage flip: `needs_review` → `eligible`, for the named quotes
     * only.
     *
     * THE WHERE CLAUSE IS THE IDEMPOTENCE MECHANISM, and that is why this is a
     * repository method rather than a read-then-write in the caller. Postgres
     * evaluates `chase_eligibility = 'needs_review'` inside the same statement
     * that performs the update, so two concurrent saves of the same form — a
     * double-tap on a phone, a retried POST — cannot both see `needs_review`
     * and both flip. Exactly one wins and the other matches zero rows.
     *
     * A read-then-write in the caller has a window between the two, and the
     * cost of losing that race is a second `quote_opened` for a quote already
     * being chased: the customer gets texted twice about the same job.
     *
     * Also narrowed to `status = 'Quote'` and `sm8_active`: eligibility is a
     * question that only exists for a live open quote, and a caller that passed
     * a won job's id must get nothing rather than a chase-eligible completed
     * job.
     *
     * RETURNS THE ROWS THAT ACTUALLY FLIPPED — the only correct basis for the
     * event emission that follows, because it is the set Postgres decided on
     * rather than the set the caller hoped for.
     */
    updateEligibilityWhereNeedsReview(
      quoteIds: readonly string[],
    ): Promise<Array<{ id: string; sm8JobUuid: string; quoteDateUtc: Date | null }>>;

    /**
     * The D-08 reopen triage write: `eligible` → `needs_review`, the exact
     * inverse of the flip above and driven by an EVENT rather than by a human.
     *
     * A `reopened` event means the tradie went back into ServiceM8 and put the
     * job back to Quote — which in practice means they are actively negotiating
     * it. D-08 therefore says a reopen is NOT a restart: the live cadence stops
     * and the quote returns to the operator's triage queue. If the operator
     * decides it should be chased again, ticking it re-runs
     * `updateEligibilityWhereNeedsReview`, which emits a fresh `quote_opened`
     * and a NEW cadence starts from a new anchor.
     *
     * THIS IS THE ONLY WRITER OF THIS TRANSITION, AND THAT IS WHY IT SURVIVES
     * RE-SYNC. `chase_eligibility` is deliberately excluded from the quotes
     * upsert set (see `upsertManyReturning`), so the next poll touching this job
     * cannot revert the triage flag back to `eligible` — the column holds a
     * decision, and only decision-makers write it.
     *
     * Narrowed to `status = 'Quote' AND sm8_active` for the same reason the
     * forward flip is: eligibility is a question that only exists for a live
     * open quote. RETURNS THE ROWS THAT ACTUALLY CHANGED, so a replayed
     * `reopened` event flips nothing twice.
     */
    flagNeedsReviewOnReopen(
      quoteIds: readonly string[],
    ): Promise<Array<{ id: string; sm8JobUuid: string }>>;

    /**
     * ACTIVE mirrored jobs whose `date_raw` calendar date lies in
     * `[fromYmd, toYmd]`, both `YYYY-MM-DD` and BOTH ENDS INCLUSIVE, any status
     * (Phase 14, D-07) — the tradie-booked match's candidate jobs. A job
     * already won is the strongest proof of a booking, so status is not
     * filtered. `date_raw` is ServiceM8's naive `YYYY-MM-DD 00:00:00`.
     */
    listActiveByDateRange(fromYmd: string, toYmd: string): Promise<ActiveJobInRange[]>;
  };

  /**
   * D-02 — the per-tenant cadence shape. See src/db/schema/cadence-templates.ts
   * for why this is configuration data rather than a code constant.
   */
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THIS NAMESPACE SPANS TWO TABLES. THEY ARE NOT THE SAME KIND OF TEMPLATE. │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   *   `cadence_touch_templates`  — TIMING. When touch 3 goes out (offset days,
   *                                channel). Read by materialization.
   *                                Methods: `list`, `ensureDefaults`.
   *   `message_templates`        — WORDING. What touch 3 says, as append-only
   *                                approved versions. Read by DRAFTING.
   *                                Methods: `latestApproved`.
   *
   * They live under one namespace because both answer "what is touch N for this
   * tenant", and the method names are the disambiguator: anything mentioning a
   * VERSION or an APPROVAL is the wording table, because only wording is
   * versioned and only wording is attested to. Nothing reads both in one query
   * and the two never join.
   */
  templates: {
    /** This tenant's touch TIMING templates, in cadence order. */
    list(): Promise<CadenceTouchTemplate[]>;

    /**
     * The newest APPROVED message-template version for one touch and channel,
     * or `[]` when this tenant has none.
     *
     * MAX(version) WHERE `approved_at IS NOT NULL`, and both halves matter. An
     * unapproved edit sitting at version+1 must not change what customers
     * receive — it is a draft of a template, and the D-06 attestation is what
     * turns it into words we will send. Returning the newest APPROVED one means
     * an operator can edit freely without arming anything.
     *
     * `[]` rather than a throw is the ONB-03 belt: a tenant with no approved
     * templates is not misconfigured, it is not finished onboarding. The
     * drafting pass counts `no_approved_template` and leaves the touch in
     * `needs_draft`, where it waits for words rather than inventing them.
     *
     * QUOTE WORDING ONLY (Phase 13): carries `kind = 'quote'`, so a lead
     * touch 2 can never be drafted from as a quote touch 2.
     */
    latestApproved(touchNumber: number, channel: TouchChannel): Promise<MessageTemplate[]>;

    /**
     * THE SAME RULE, FOR EVERY TOUCH AT ONCE — one row per touch number that has
     * an approved version, newest approved version each, ascending by touch.
     *
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ EXISTS BECAUSE THE DRAFTING PREFIX IS PER TENANT, NOT PER TOUCH.     │
     * └──────────────────────────────────────────────────────────────────────┘
     *
     * `buildDraftPrompt` puts the whole approved set in the system block so a
     * tenant's batch shares ONE byte-identical cacheable prefix (D-09). Calling
     * `latestApproved` once per touch produces a prefix that is both too short
     * to reach Sonnet 5's ~1024-token minimum and different for every touch —
     * 05-01 measured a live call at 753 input tokens with a cold cache, and
     * 05-02 recorded that the caller half of the fix was still missing. This is
     * that half.
     *
     * `[]` means the tenant has approved no wording at all — the ONB-03 read,
     * same as `latestApproved`'s empty return, and the drafting pass counts it
     * rather than inventing words.
     *
     * The de-duplication is done in TypeScript over an `ORDER BY touch_number,
     * version DESC` rather than in a `DISTINCT ON`: the row set here is one per
     * (touch, version) for one tenant — tens of rows — and the loop is
     * inspectable by anyone reading it, where `DISTINCT ON`'s correctness
     * depends on an ORDER BY prefix that a later edit can silently break.
     *
     * PER KIND (Phase 13, D-02): `kind` defaults to 'quote', which is what
     * every Phase 5 caller means; the lead drafting branch asks for 'lead'.
     * The two sets never mix — a quote prompt must not carry lead wording.
     */
    latestApprovedSet(channel: TouchChannel, kind?: MessageTemplateKind): Promise<MessageTemplate[]>;

    /**
     * Append the NEXT version of one touch's wording, UNAPPROVED.
     *
     * `version` is `MAX(version) + 1` for this `(kind, touch_number, channel)`,
     * starting at 1, computed INSIDE the INSERT rather than by a read the caller
     * did a moment earlier. Two operators saving the same touch at once then
     * collide on `message_templates_tenant_kind_touch_channel_version_uniq` and one
     * gets a 23505 — Postgres decides, which is the same reason `cadences.create`
     * leans on its index rather than on a check-then-insert.
     *
     * NEVER APPROVED BY THIS WRITE. Editing wording and attesting to it are two
     * steps of one decision (the table header), and a single method that did both
     * would make "save" arm a client's messaging. `approveWhereUnapproved` is the
     * second step and it is a separate, deliberate act.
     */
    insertVersion(row: TemplateVersionInsert): Promise<MessageTemplate[]>;

    /**
     * THE WRITE-ONCE ATTESTATION (D-06). Stamps `approved_at` + `approval_note`
     * on ONE version, guarded on it not already being approved.
     *
     * `WHERE approved_at IS NULL` is the whole of the write-once rule, and it is
     * a WHERE clause rather than a check in the caller for the usual reason: an
     * attestation that can be overwritten is not evidence of anything, because
     * the version somebody approved and the version recorded as approved could
     * differ with no trace. Zero rows back means "already approved" (or no such
     * version) and the caller must report that rather than assume it landed.
     */
    approveWhereUnapproved(
      versionId: string,
      note: string,
      at: Date,
    ): Promise<MessageTemplate[]>;

    /**
     * Every QUOTE wording version this tenant has, newest first within each
     * touch/channel. `kind = 'quote'` (Phase 13): the drafting console's
     * version history is the quote cadence's; lead defaults are not edited
     * there.
     */
    listVersions(touchNumber?: number, channel?: TouchChannel): Promise<MessageTemplate[]>;

    /**
     * ONE ROW PER SMS TOUCH THE TENANT'S CADENCE SHAPE DEFINES, each saying
     * whether an approved wording exists for it.
     *
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ DRIVEN FROM `cadence_touch_templates`, NOT FROM `message_templates`. │
     * └──────────────────────────────────────────────────────────────────────┘
     *
     * The question ONB-03 asks is "is every touch this client will actually send
     * covered by approved words", and only the TIMING table knows which touches
     * exist. Reading the wording table instead would answer "is every wording
     * they happen to have approved, approved" — vacuously true for a tenant with
     * none, which is exactly the tenant the gate exists to stop. The completion
     * sweep learned the same lesson about `EXISTS(touch)` beside its `NOT EXISTS`
     * (see `completeWhereAllTouchesDone`); this is that lesson one table over.
     *
     * SMS ONLY (D-04). Phase 5 drafts SMS, and onboarding requires exactly the
     * five SMS templates; an email timing row must not hold a client's activation
     * hostage to wording nothing will send.
     *
     * `[]` therefore means "this tenant has no cadence shape yet" — NOT "fully
     * approved". Callers must treat the empty read as unapproved; see
     * `hasApprovedTemplateSet`, which is where that decision is made once.
     *
     * Also powers the console's partial-progress view: which touch numbers are
     * still missing an approved SMS version.
     *
     * QUOTE WORDING ONLY (Phase 13, research Pitfall 2): the EXISTS carries
     * `kind = 'quote'`. Without it, the pre-approved LEAD defaults for touches
     * 2 and 3 would satisfy this gate's touches 2 and 3 for a client who never
     * approved quote wording for them.
     */
    approvedSetStatus(): Promise<Array<{ touchNumber: number; approved: boolean }>>;
    /**
     * Lazily seed the defaults, idempotently. Returns the rows actually
     * INSERTED — `[]` on every call after the first.
     *
     * THE OFFSETS ARE A PARAMETER, NOT AN IMPORT, and deliberately so: the
     * repository layer must not depend on `src/core/cadence/constants.ts`. The
     * caller passes `DEFAULT_TOUCH_OFFSET_DAYS`; `touch_number` is the array
     * position plus one, so the ordering of the argument IS the cadence order.
     *
     * `ON CONFLICT (tenant_id, touch_number) DO NOTHING` is what makes this
     * safe to call on every cadence creation forever — Postgres decides, rather
     * than a check-then-insert two concurrent ticks can both pass.
     */
    ensureDefaults(offsetDays: readonly number[]): Promise<CadenceTouchTemplate[]>;

    /**
     * Seed this client's LEAD wording (Phase 13, D-02), idempotently. Returns
     * the rows actually INSERTED — `[]` on every call after the first.
     *
     * Rows go in as `kind = 'lead'`, `channel = 'sms'`, `version = 1`,
     * PRE-APPROVED (`approved_at = now()`, `approval_note = note`): the
     * template is the model's input, rewritten in the client's voice, and the
     * operator approves every DRAFT made from it — never the template. The
     * wording and the note are parameters, not imports, for `ensureDefaults`'
     * reason: the repository does not depend on `src/core`.
     *
     * `ON CONFLICT DO NOTHING` targeted on the kind-widened unique index
     * `(tenant_id, kind, touch_number, channel, version)`: Postgres decides,
     * so two ticks seeding at once insert one set. The quote reads all carry
     * `kind = 'quote'`, so these rows can never satisfy the quote onboarding
     * gate (research Pitfall 2).
     */
    ensureLeadDefaults(
      rows: readonly LeadTemplateDefault[],
      note: string,
    ): Promise<MessageTemplate[]>;
  };

  /**
   * AI-04 — the drafts the model wrote. See src/db/schema/touch-drafts.ts.
   *
   * EVERY WRITE HERE IS SERVICE-ROLE. `authenticated` holds SELECT only
   * (migration 0028), so the console's approve action reaches this namespace
   * through a server action rather than through a direct UPDATE — which is what
   * keeps "at most one approved draft per touch" a guarantee rather than a race
   * between the console and the tick.
   */
  drafts: {
    /**
     * Record ONE generation attempt. Insert-only; nothing here is ever UPDATEd
     * except by `approve`, and rows are never deleted.
     *
     * The caller supplies `attempt`, `model`, `templateId`, `templateVersion`
     * and `promptVersion` — all five are AI-04 evidence and all five are
     * required FROM THE FIRST ATTEMPT, because the question they answer
     * ("what produced this text") cannot be reconstructed later from a row that
     * omitted them.
     */
    insertAttempt(row: TouchDraftInsert): Promise<TouchDraft[]>;

    /**
     * The `final_body` of this touch's approved draft, or `null`.
     *
     * THE BYTES DISPATCH SENDS. Read inside the claim transaction, before the
     * ledger claim: a null here is `no_approved_draft` and the send is refused
     * (D-10). It returns the STORED column and never recomposes the body —
     * approval and dispatch must agree byte for byte, and a body recomposed at
     * send time is a body no human read (research Pitfall 6).
     *
     * Single-valued rather than a list because the unique partial index makes it
     * single-valued; if that index were ever dropped, this signature would be
     * the lie that hid it.
     */
    approvedFinalBody(touchId: string): Promise<string | null>;

    /**
     * THE APPROVE WRITE — one of the two halves of the only path to `approved`.
     *
     * Flips ONE draft row to `status = 'approved'`, stamping `approved_at`, the
     * operator's possibly-edited `finalBody`, and the AI-04 `editDistance`
     * (0 when approved unchanged). Guarded on the row not already being
     * approved; the unique partial index refuses a SECOND approved draft for the
     * same touch with 23505, so a double-tapped approve is decided by Postgres
     * rather than by whichever request arrived first.
     *
     * Returns the rows actually approved — `[]` means somebody else got there.
     */
    approve(
      draftId: string,
      patch: { finalBody: string; editDistance: string; approvedAt: Date },
    ): Promise<TouchDraft[]>;

    /** This touch's attempts, newest first. The approval screen's read. */
    latestForTouch(touchId: string): Promise<TouchDraft[]>;

    /**
     * Mark ONE rejected attempt as replaced by a later one (D-11).
     *
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ NOT A DELETE, AND NOT AN UPDATE OF THE BODY. The rejected draft stays │
     * │ exactly as the model wrote it.                                       │
     * └──────────────────────────────────────────────────────────────────────┘
     *
     * `superseded` is what makes the approval screen show one draft while the
     * evidence table still answers "how often does the validator reject a first
     * attempt, and for which rule" — the AI-04 measurement. Deleting the loser
     * would make a prompt regression invisible in exactly the way the attempt
     * counter exists to prevent.
     *
     * Guarded on `validator_failed`: only a REJECTED attempt can be superseded.
     * A `generated` row is a draft awaiting a human and an `approved` one has
     * been read by one, and quietly relabelling either would remove a draft from
     * somebody's queue. Returns the rows actually moved — zero means the guard
     * held, which the caller may ignore because the regeneration succeeded
     * either way.
     */
    markSuperseded(draftId: string): Promise<TouchDraft[]>;

    /**
     * The bodies ALREADY SENT on this cadence, in touch order — D-02's "do not
     * repeat touch 1's angle in touch 3".
     *
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ SENT, not merely approved. The filter is on the TOUCH's status.      │
     * └──────────────────────────────────────────────────────────────────────┘
     *
     * A draft approved an hour ago and not yet dispatched has not reached the
     * customer, and telling the model "you already said this" about a message
     * nobody received would make touch 3 write around a gap the customer cannot
     * see. Worse, an approved-but-later-suppressed touch never goes out at all —
     * its body would then permanently constrain every later touch of that
     * cadence for no reason a human could reconstruct.
     *
     * `final_body`, not `generated_body`: what the customer actually read
     * includes the compliance line. The model is told not to write that line,
     * and seeing it on every prior message is a stronger demonstration of that
     * rule than the instruction alone.
     *
     * Returns bare strings because that is what `buildDraftPrompt` takes. There
     * is no id here for anyone to key on, deliberately — this list is prompt
     * input, not a record of anything.
     */
    sentBodiesForCadence(cadenceId: string): Promise<string[]>;
  };

  /** D-03/D-06 — one row per tenant. See src/db/schema/cadence-settings.ts. */
  settings: {
    /**
     * This tenant's settings row if it exists, `[]` if it does not.
     *
     * SEPARATE FROM `ensure()` BECAUSE DISPATCH MUST NOT WRITE. The D-06 pause
     * is re-read just-in-time inside the claim transaction (CAD-05), and a read
     * that lazily inserts would have the send path creating configuration rows
     * for tenants it is about to decline to send to — a write on the refusal
     * path, in a transaction whose whole purpose is to decide whether to act.
     */
    get(): Promise<CadenceSettings[]>;
    /**
     * This tenant's settings row, creating the default if it is absent.
     * Always exactly one row — never `[]`, unlike the read-only accessors.
     */
    ensure(): Promise<CadenceSettings>;
    /**
     * Set or clear the D-06 per-client pause. `null` resumes.
     *
     * Clearing this field does NOT itself resume anything: the caller must also
     * run the D-07 re-window for this tenant's live cadences, because every
     * touch that fell due during the pause is now overdue and would otherwise
     * dispatch as a burst on the next tick. That is the failure CAD-02 exists to
     * prevent, and it is why the console never writes this column directly.
     */
    setPausedAt(pausedAt: Date | null): Promise<CadenceSettings[]>;

    /**
     * Write the D-05 voice profile, creating the settings row if it is absent.
     *
     * UPSERT rather than `ensure()`-then-update, and the difference from
     * `ensure()` is deliberate: `ensure()` is `DO NOTHING` because it must never
     * overwrite an operator's configuration, whereas overwriting the voice
     * columns is the entire purpose of this method. The conflict SET names those
     * six columns and nothing else, so a save here can never disturb
     * `preferred_send_time` or — far more importantly — `paused_at`, the D-06
     * kill switch that happens to share this row.
     *
     * Exhaustive over the six: see `VoiceProfilePatch`.
     */
    updateVoiceProfile(patch: VoiceProfilePatch): Promise<CadenceSettings[]>;
  };

  cadences: {
    /**
     * Create a cadence, refusing silently if a live one already exists for the
     * quote. Returns the created row, or `[]` when the partial unique index
     * refused it.
     *
     * ZERO ROWS IS AN ANSWER, NOT A FAILURE. The outbox this is driven from is
     * replayable by contract ("REPLAY IS LEGAL … Idempotence is the consumer's
     * job"), so the same `quote_opened` WILL arrive twice. `[]` means "you are
     * the replay; a live cadence already exists" — decided by Postgres inside
     * the INSERT, not by a read the caller performed a moment earlier.
     */
    create(values: CadenceCreate): Promise<Cadence[]>;

    /**
     * Create a LEAD cadence (Phase 12, D-19) — the ONLY writer of a
     * `kind = 'lead'` row. `[]` means a live cadence already exists for this
     * lead.
     *
     * TARGETED, unlike `create`: it names `cadences_one_live_per_lead` as its
     * arbiter, so a conflict on any OTHER unique index raises instead of being
     * read as "already open". A lead row has NULL in every column the other
     * three arbiters key on, so the only conflict that can legitimately occur
     * is the one named.
     */
    createLead(values: LeadCadenceCreate): Promise<Cadence[]>;

    /**
     * The newest LIVE QUOTE cadence at this client whose contact snapshot is
     * this normalised mobile, or `[]` (Phase 12, D-08). Tenant-scoped: an open
     * quote at ANOTHER client does not make this caller "about a quote" here.
     */
    liveQuoteCadenceForMobile(contactMobile: string): Promise<Cadence[]>;

    /**
     * The LIVE lead cadence of this lead, or `[]` (Phase 13, D-14). At most
     * one row: `cadences_one_live_per_lead` is the arbiter. `closeLeadInTx`
     * reads it to stop (or expire) the cadence before it closes the lead.
     */
    liveForLead(leadId: string): Promise<Cadence[]>;

    /** Every cadence this quote has ever had, newest first. */
    getByQuoteId(quoteId: string): Promise<Cadence[]>;

    /**
     * One cadence by its own id. `[]` when it does not exist OR belongs to
     * another tenant — the two are deliberately indistinguishable, exactly as
     * `tenant.get()` makes them.
     *
     * The console's control surface (D-16) is keyed on a cadence id that arrived
     * in a request body, so this is the read a forged POST hits. Returning `[]`
     * rather than a row from another tenant is what makes the caller's "no such
     * cadence" answer true for both cases without it having to know which.
     */
    getById(cadenceId: string): Promise<Cadence[]>;

    /**
     * Active or paused — the ones the tick still has work for.
     *
     * OF ONE KIND, DEFAULT `'quote'` (Phase 12, D-19). Every caller that
     * existed before Phase 12 — the tick's progress pass and 42-day expiry, the
     * client pause and resume, the onboarding gate, the reconnect — was written
     * for quote cadences and keeps reading exactly those. A lead cadence's
     * touches 2 and 3 must not be re-windowed or expired before Phase 13 owns
     * them; a caller that wants leads says so.
     *
     * Phase 13: the tick's expiry and rewindow loops now pass each kind
     * explicitly with its own policy. `applyResumeRewindow` (resume.ts) stays
     * on this quote default BY DESIGN — its gap-preserving resume exists for
     * three-week quote cadences; a lead paused by a reply and later resumed is
     * repaired by the per-tick lead rewindow within a minute, under the lead
     * policy.
     */
    listLive(kind?: CadenceKind): Promise<Cadence[]>;

    /**
     * Terminal stop, guarded on the cadence still being live.
     *
     * `WHERE status IN ('active','paused')` is the idempotence mechanism, and
     * it is also what makes the stop honest: a cadence already stopped as `won`
     * must not be re-stopped as `removed` by a replayed event and lose the
     * reason Phase 7 attributes revenue on. Returns the rows that ACTUALLY
     * stopped, which is the correct basis for the follow-up work (skipping the
     * unsent touches).
     */
    stopWhereLive(
      cadenceIds: readonly string[],
      stopReason: CadenceStopReason,
    ): Promise<Cadence[]>;

    /**
     * The same guarded stop, keyed by QUOTE id.
     *
     * Event consumption knows the quote a `won`/`lost`/`removed` refers to and
     * not the cadence, and looking the cadence up first would open a window
     * between the read and the write. This closes it: one statement, the same
     * guard, the same RETURNING-drives-what-happens-next idiom.
     */
    stopWhereLiveByQuoteIds(
      quoteIds: readonly string[],
      stopReason: CadenceStopReason,
    ): Promise<Cadence[]>;

    /** Pause an ACTIVE cadence. An already-paused one is left alone. */
    pauseWhereActive(
      cadenceIds: readonly string[],
      pauseReason: CadencePauseReason,
    ): Promise<Cadence[]>;

    /**
     * THE PAUSE UPGRADE (D-05) — change WHY a cadence is paused, never THAT it
     * is. The write `pauseWhereActive` deliberately cannot perform.
     *
     * The matrix has always prescribed `paused(client_paused)` +
     * `customer_reply` → `paused(customer_reply)` (transitions.ts note 3), and
     * until 04-02 nothing could write it: `pauseWhereActive` pauses only from
     * `active`, precisely so that re-pausing can never DOWNGRADE a reply pause
     * to a client one. Widening that method would have removed the guard the
     * whole asymmetry rests on, so the upgrade gets its own statement with its
     * own, narrower guard.
     *
     * What it was costing while it did not exist: a client who had paused their
     * own messaging, whose customer then wrote back, could tap "resume
     * messaging" and restart the machine mid-conversation — because the row
     * still said `client_paused`, which is exactly the reason a client resume
     * is allowed to lift.
     *
     * ── THE `from` REASON IS PART OF THE GUARD, AND IS NULLABLE ─────────────
     *
     * `WHERE status = 'paused' AND pause_reason IS NOT DISTINCT FROM $from` —
     * the caller states which pause it believes it is upgrading, and a row that
     * has moved since the read is simply not returned. Without the reason
     * predicate this would collapse to "re-label any paused cadence", which is
     * the downgrade shape `pauseWhereActive` refuses to be.
     *
     * `from` accepts NULL for the row `transitions.ts` note 6 describes: a
     * `paused` cadence carrying no reason at all. The schema permits it, no
     * writer here produces it, and the matrix still answers — `customer_reply`
     * "should record the reason it now knows". A guard that could only express
     * `= $from` would silently skip that row and leave a pause nothing can
     * explain.
     *
     * `RETURNING id` is the proof, in the house idiom: zero rows means the
     * guard refused, which the caller must report honestly rather than assume.
     *
     * ── `to` EXCLUDES `onboarding`, AT THE TYPE LEVEL (05-03) ───────────────
     *
     * The stickiness order in `transitions.ts` note 7 runs one way, and this is
     * the write that could break it. Relabelling a `customer_reply` pause down
     * to `onboarding` would hand it to the next template approval, which resumes
     * every onboarding-paused cadence of a tenant in one statement — a live
     * conversation restarted by paperwork. `UpgradablePauseReason` makes that
     * call not compile, rather than making it a rule somebody has to remember.
     *
     * `from` stays the FULL vocabulary plus null: upgrading AWAY from
     * `onboarding` is exactly what 05-03 added (`pauseForReply`, `pauseClient`).
     */
    upgradePauseReason(
      cadenceIds: readonly string[],
      change: { from: CadencePauseReason | null; to: UpgradablePauseReason },
    ): Promise<Array<{ id: string }>>;

    /**
     * Resume a paused cadence — but ONLY one paused for the expected reason.
     *
     * ┌────────────────────────────────────────────────────────────────────┐
     * │ THE D-05/D-06 ASYMMETRY LIVES IN THIS GUARD, AND NOWHERE ELSE.     │
     * └────────────────────────────────────────────────────────────────────┘
     *
     * A client un-pause (`client_paused`) must NOT lift a pause that exists
     * because the customer wrote back (`customer_reply`). D-05 is explicit: no
     * automated resume after a live conversation — a human decides. If the
     * reason were not part of the WHERE clause, a tradie tapping "resume
     * messaging" would silently restart a cadence at somebody who is mid-
     * conversation with them, which reads as the service ignoring the reply.
     *
     * Expressed as a WHERE clause rather than a check in the caller because it
     * is the kind of rule that gets forgotten at the second call site. Rows that
     * do not match come back as absent, not as an error.
     */
    resumeWherePaused(
      cadenceIds: readonly string[],
      expectedPauseReason: CadencePauseReason,
    ): Promise<Cadence[]>;

    /**
     * THE OPERATOR RESUME (D-05) — the only write that lifts a pause without
     * naming the reason it is lifting.
     *
     * `resumeWherePaused` above exists because a CLIENT-level resume must not
     * lift a `customer_reply` pause. This one is its deliberate complement: D-05
     * says only a human may end a pause a conversation created, and this method
     * IS that human's act, reached from one confirmed tap in the console. Making
     * the operator's resume reason-matched too would mean the console had to
     * read the reason, decide which method to call, and get it right — three
     * places for the D-05 asymmetry to live instead of one.
     *
     * It also reaches the row `transitions.ts` note 6 describes: a `paused`
     * cadence with NO recorded reason. The schema permits it, no writer here
     * produces it, and the matrix answers that only an operator may resume it —
     * which no `WHERE pause_reason = …` predicate can express, since the column
     * is null.
     *
     * Still guarded on `status = 'paused'`: an active cadence has no pause to
     * lift, and a terminal one must never be revived.
     *
     * ── AND IT REFUSES `onboarding`, THE ONE PAUSE A HUMAN CANNOT LIFT ──────
     *
     * ONB-03/T-5-10. An `onboarding` pause is not a judgement to overrule; it
     * records that this client has NO approved template set, so resuming would
     * activate a cadence whose every touch parks unsent in `needs_draft` while
     * the console reads "running". Approving the templates is the only unlock
     * (`approveTemplateVersion`), and this predicate is what makes that a
     * property of the database rather than of a disabled button.
     *
     * `pause_reason IS DISTINCT FROM 'onboarding'` rather than `<> 'onboarding'`
     * or `IS NULL OR <>`: a plain `<>` is NULL for a NULL column and the row is
     * not matched, which would silently take the note-6 row — the ONE row this
     * method exists to reach — back out of scope. That is the same shape as the
     * `= NULL` trap `upgradePauseReason` documents, arriving from the other
     * direction, and its symptom would be a paused cadence nothing on earth can
     * resume.
     */
    operatorResumeWherePaused(cadenceIds: readonly string[]): Promise<Cadence[]>;

    /**
     * D-14 / CAD-03 — CLOSE THE CADENCES WHOSE EVERY TOUCH IS TERMINAL.
     *
     * This is the production driver for the `all_touches_done` event, and it is
     * ONE STATEMENT for the usual reason: the set is computed by the same
     * `WHERE` that performs the write, so a touch dispatched by a concurrent
     * tick between a read and a write cannot produce a cadence completed while
     * a send was in flight. Nothing is passed in — the database decides which
     * cadences qualify.
     *
     * ── THE GUARD IS `status = 'active'`, NOT "live" ────────────────────────
     *
     * A PAUSED cadence is deliberately NOT completed, even when every touch is
     * terminal. That is `transitions.ts` note 5 applied: completing it would
     * clear it off the operator's queue and discard the fact that a human still
     * owes it an answer — a customer replied, or the client pulled the handbrake,
     * and "we ran out of touches" is not the resolution of either. The pause
     * outlives the schedule. (This is why it does not reuse the `LIVE_CADENCE_
     * STATUSES` guard the stop and expiry writes use: they are events about the
     * QUOTE and about TIME, which do dominate a pause; this one is about the
     * schedule, which does not.)
     *
     * ── A CADENCE WITH NO TOUCHES AT ALL IS NOT "DONE" ──────────────────────
     *
     * Hence the `EXISTS` alongside the `NOT EXISTS`. Vacuous truth is the whole
     * bug here: "every touch is terminal" is trivially TRUE of a cadence with
     * zero touches, and such a row is one whose materialization failed or has
     * not happened yet. Completing it would retire a quote that was never
     * chased even once, silently, and it would look exactly like success.
     *
     * Returns the rows that ACTUALLY completed — the count the tick reports.
     */
    completeWhereAllTouchesDone(): Promise<Cadence[]>;
    /** D-12 — outlived its expiry window from the anchor. */
    markExpired(cadenceIds: readonly string[]): Promise<Cadence[]>;
  };

  touches: {
    /** Materialize a schedule. Returns the inserted rows. */
    insertMany(rows: CadenceTouchInsert[]): Promise<CadenceTouch[]>;
    /** Every touch for a cadence, in cadence order. */
    listForCadence(cadenceId: string): Promise<CadenceTouch[]>;
    /** Touches that have not reached `sent` or `skipped`, in cadence order. */
    listUnsentForCadence(cadenceId: string): Promise<CadenceTouch[]>;

    /**
     * Move a single touch to a new slot — the D-07/D-09 re-window write.
     *
     * Guarded on the touch not being terminal: rescheduling a `sent` touch
     * would claim the message had not gone out.
     */
    reschedule(touchId: string, scheduledAt: Date): Promise<CadenceTouch[]>;

    /**
     * Promote touches due within the lead window `scheduled → needs_draft`.
     *
     * THE REAL D-12 GATE. This method used to move a touch all the way to
     * `approved`; it now moves it exactly one step, onto the drafting queue.
     * See PROMOTABLE_TOUCH_STATUSES for why the source list is a single status
     * and why nothing here may reach `approved`.
     *
     * Only touches on ACTIVE cadences are promoted — a paused cadence's touches
     * stay where they are, which is what makes the D-07 re-window on resume
     * possible rather than a race against a promotion that already happened.
     *
     * `leadMs` is the D-14 draft lead time: touches surface AHEAD of their slot
     * so drafting AND approval have time to happen (this is what feeds CON-04
     * draft aging). Returns the rows actually promoted — the drafting pass
     * consumes that RETURNING rather than re-querying, so a touch promoted by
     * this tick is drafted by this tick.
     */
    promoteDue(now: Date, leadMs: number): Promise<CadenceTouch[]>;

    /**
     * EVERY touch of this tenant currently waiting to be drafted — the drafting
     * queue, oldest first.
     *
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ THIS IS THE ANTI-STARVATION READ. `promoteDue`'s RETURNING carries    │
     * │ only the touches promoted THIS MINUTE; a touch whose draft failed at  │
     * │ 09:01 is not in any later tick's RETURNING and would never be looked  │
     * │ at again.                                                            │
     * └──────────────────────────────────────────────────────────────────────┘
     *
     * The tracer fed the drafting pass the promotion RETURNING alone, which is
     * correct exactly once per touch and then silently abandons it. Anthropic
     * being unreachable for one minute would otherwise park a customer's
     * follow-up forever, with the tick reporting a clean zero every minute
     * afterwards — the failure looks identical to there being no work.
     *
     * ACTIVE CADENCES ONLY, by the same subquery `promoteDue` uses and for the
     * same reason: a cadence paused between promotion and this read must not be
     * drafted for. Both sides of the comparison carry `tenant_id`, as everywhere
     * else that touches `cadences`.
     *
     * ORDER BY `scheduled_at`, then `id` — `claimDue`'s tie-break, deliberately
     * mirrored: two ticks walking the same backlog visit it in the same order
     * rather than one the planner may vary, and the oldest-first direction is
     * what makes the caller's batch cap bounded rather than arbitrary.
     *
     * `limit` is required, not optional. An unbounded read here would hand the
     * drafting pass a list it cannot finish inside the tick, and a default would
     * be this file choosing the caller's cost ceiling.
     */
    listNeedsDraft(limit: number): Promise<CadenceTouch[]>;

    /**
     * CLAIM SOME OF THAT QUEUE FOR THIS TICK. Returns the ids actually won.
     *
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ `listNeedsDraft` is a READ, and a read claims nothing. This is the    │
     * │ write that decides which of two overlapping ticks owns a touch —      │
     * │ drafting's answer to what `FOR UPDATE SKIP LOCKED` does for           │
     * │ `claimDue`, in a shape that survives outside a transaction.           │
     * └──────────────────────────────────────────────────────────────────────┘
     *
     * pg_cron fires every 60s without waiting for the response and a full
     * drafting batch can occupy the function's whole 300s budget, so two ticks
     * reading the same `needs_draft` queue is the ordinary case rather than the
     * exotic one. Unclaimed, both draft it: two paid Sonnet calls for one
     * message, and two `touch_drafts` rows racing for one `attempt` number.
     *
     * ── WHY THIS IS ATOMIC WITHOUT A TRANSACTION ────────────────────────────
     *
     * A single UPDATE takes a row lock per row it touches. Under READ COMMITTED
     * a second UPDATE that blocks on the same row RE-EVALUATES its WHERE against
     * the committed new version — which now has `drafting_started_at` set — so
     * the guard fails and the row is not returned. Exactly one caller sees each
     * id in its RETURNING. That is the whole mechanism; there is no window.
     *
     * ── THE STALENESS ARM IS CRASH RECOVERY, NOT A TIMEOUT ──────────────────
     *
     * The drafting pass RELEASES its claim on every path that leaves a touch in
     * `needs_draft`, so an ordinary failure is retried by the very next tick.
     * `staleBefore` only re-opens a claim held by a function that was killed
     * between claiming and releasing — without it, a single OOM would strand a
     * customer's follow-up permanently, which is a worse failure than the
     * duplicate draft the claim exists to prevent.
     *
     * Guarded on `status = 'needs_draft'` as well, so a touch approved or
     * skipped between the caller's read and this write is not claimed at all.
     */
    claimForDrafting(
      touchIds: readonly string[],
      now: Date,
      staleBefore: Date,
    ): Promise<{ id: string }[]>;

    /**
     * Give a claim back. The counterpart of `claimForDrafting`, and the reason
     * its staleness window never fires in normal operation.
     *
     * UNCONDITIONAL on `drafting_started_at` and on `status`: this is called with
     * ids this pass claimed moments ago, and a release that refused to run
     * because the touch had meanwhile moved would leave a stale claim on a row
     * for no benefit — the column means nothing once the touch has left
     * `needs_draft`.
     */
    releaseDraftingClaim(touchIds: readonly string[]): Promise<unknown>;

    /**
     * `draft_failures += 1` — a deterministic (400/401/403) drafting refusal.
     *
     * THE TERMINATOR THE ATTEMPT LEDGER CANNOT BE. `MAX_DRAFT_ATTEMPTS` counts
     * `touch_drafts` rows, and a 400 produces no row — so without this a touch
     * that only ever 400s is re-attempted twice a minute for six weeks. Same
     * mechanism and same reasoning as `bumpClassifyAttempts` one family over.
     */
    bumpDraftFailures(touchId: string): Promise<unknown>;

    /**
     * `needs_draft → pending_approval` — written when a draft has been generated,
     * validated and recorded, in the same pass as the `touch_drafts` insert.
     *
     * GUARDED ON `needs_draft`. A touch that is already `pending_approval` has a
     * draft awaiting a human, and re-marking it would be harmless; a touch that
     * is `approved` or terminal must NOT be dragged backwards by a late-arriving
     * draft from a pass that raced. The guard makes the second case impossible
     * rather than unlikely. Returns the rows actually moved.
     */
    markPendingApproval(touchIds: readonly string[]): Promise<CadenceTouch[]>;

    /**
     * `pending_approval → approved` — THE ONLY PATH TO `approved` IN THIS FILE.
     *
     * Called by the approve write, beside `drafts.approve`, and never by a tick.
     * The pairing is the D-12 invariant: a touch reaches `approved` only when a
     * human has attributed themselves to a specific draft, and dispatch then
     * refuses anything without an approved draft row (`no_approved_draft`), so
     * the two halves check each other.
     *
     * Guarded on `pending_approval` so an approve cannot resurrect a skipped
     * touch or re-approve a sent one. Returns the rows actually approved.
     */
    approveWhere(touchIds: readonly string[]): Promise<CadenceTouch[]>;

    /**
     * CAD-04/CAD-05 — CLAIM THE DUE TOUCHES OF ONE TENANT FOR THIS TICK.
     *
     * ┌────────────────────────────────────────────────────────────────────┐
     * │ `FOR UPDATE OF cadence_touches SKIP LOCKED` — the Postgres          │
     * │ queue-claim primitive, and the reason this query lives here rather  │
     * │ than in the dispatcher.                                            │
     * └────────────────────────────────────────────────────────────────────┘
     *
     * Postgres' own words: "With SKIP LOCKED, any selected rows that cannot be
     * immediately locked are skipped… can be used to avoid lock contention with
     * multiple consumers accessing a queue-like table." Two overlapping ticks
     * therefore claim DISJOINT sets and neither waits on the other. That is
     * liveness only — correctness comes from `send_ledger`'s unique index, which
     * still arbitrates if SKIP LOCKED is bypassed entirely (a second
     * deployment, a manual invocation, a cron that fired twice).
     *
     * `OF cadence_touches` is load-bearing: a bare `FOR UPDATE` across the join
     * would also lock the `cadences` row, so a console kill switch would block
     * behind a tick that is merely reading the cadence for its contact snapshot.
     *
     * ONLY MEANINGFUL INSIDE `transaction()`. Row locks are released at the end
     * of the statement outside one, so calling this on the pool claims nothing
     * and hands back rows another tick may already own.
     *
     * ORDER BY `scheduled_at`, then `id`: oldest work first, with a tie-break so
     * two ticks claiming from the same backlog walk it in the same order rather
     * than one the planner may vary.
     *
     * NOTE WHAT THIS DOES *NOT* CHECK: quote status, suppression, the pause
     * flags, the contact window. Those are CAD-05's just-in-time revalidation
     * and they are the dispatcher's, re-read inside this same transaction —
     * folding them in here would make the refusal reasons invisible to the
     * caller that has to record them.
     */
    claimDue(now: Date, limit: number): Promise<ClaimedTouch[]>;

    /**
     * Mark touches `sent` — written AFTER the ledger claim is won and BEFORE
     * the sender is invoked, in the claim's own transaction.
     *
     * Guarded on the touch not already being terminal, so a replayed claim
     * cannot re-mark a skipped touch as sent. Returns the rows actually marked.
     */
    markSent(touchIds: readonly string[]): Promise<CadenceTouch[]>;

    /** Skip named touches, guarded on their not being terminal already. */
    skipWhere(
      touchIds: readonly string[],
      skipReason: TouchSkipReason,
    ): Promise<CadenceTouch[]>;

    /**
     * THE OPERATOR'S OWN SKIP (CON-01, D-02) — guarded on EQUALITY with the two
     * statuses that mean "still waiting on a human", never on "not terminal".
     *
     * Not `skipWhere` with a different reason, and it must never be collapsed
     * into it: `approved` is not terminal, so the not-terminal guard would let a
     * stale queue card un-approve a touch a colleague had already cleared. Takes
     * no reason — it records `operator_skipped` and nothing else. Zero rows is
     * an answer the caller reports honestly, not a failure. See the
     * implementation's header for the whole argument.
     */
    skipPendingWhere(touchIds: readonly string[]): Promise<CadenceTouch[]>;

    /**
     * The two columns the honest zero-row report is chosen from. `null` when the
     * touch is not this tenant's — the same answer as "does not exist", so the
     * refusal is not an existence oracle over another client's schedule.
     */
    statusOf(touchId: string): Promise<{ status: string; skipReason: string | null } | null>;

    /**
     * Skip every unsent touch of the named cadences — the write that follows a
     * stop, in the same transaction as it.
     *
     * A stopped cadence whose touches are still `scheduled` is the state that
     * makes a killed cadence keep sending, so these two writes must never be
     * separable. Returns the rows actually skipped.
     */
    skipUnsentForCadences(
      cadenceIds: readonly string[],
      skipReason: TouchSkipReason,
    ): Promise<CadenceTouch[]>;
  };

  ledger: {
    /**
     * CAD-04 — CLAIM A TOUCH BEFORE SENDING IT.
     *
     * `INSERT … ON CONFLICT (cadence_id, touch_number) DO NOTHING RETURNING id`.
     * ZERO ROWS MEANS ANOTHER PROCESS ALREADY OWNS THIS TOUCH, and the caller
     * must refuse silently rather than send. That is the whole never-twice
     * guarantee, and it is why this returns an array the caller branches on
     * instead of a row it can assume.
     *
     * Postgres arbitrates. `FOR UPDATE SKIP LOCKED` gives liveness; this index
     * gives correctness even when SKIP LOCKED is bypassed entirely — a second
     * deployment, a manual invocation, a cron that fired twice.
     */
    insertClaim(row: SendLedgerClaim): Promise<Array<{ id: string }>>;

    /**
     * Record what the provider said, after the fact.
     *
     * Separate from the claim on purpose: between the two there is legitimately
     * no outcome, and a row left in that state means "we do not know whether
     * this went out" — surfaced to the operator, never auto-resent. See the
     * schema header for why that NULL is the safe direction.
     */
    setOutcome(
      ledgerId: string,
      outcome: SendLedgerOutcome,
      providerMessageId: string | null,
    ): Promise<SendLedgerRow[]>;

    /** Everything claimed for a cadence, oldest first. Phase 7's evidence. */
    listForCadence(cadenceId: string): Promise<SendLedgerRow[]>;

    /**
     * RPT-01 — EVERY TOUCH EVER CLAIMED FOR A QUOTE, ACROSS ALL ITS CADENCES.
     *
     * BY QUOTE, NOT BY CADENCE, and the difference is the whole reason this
     * exists beside `listForCadence`: a reopened quote gets a SECOND cadence
     * (`cadences.getByQuoteId` returns them all), and the D-01 window is
     * measured against the win — not against whichever chase happened to be
     * running. A per-cadence read would silently drop the first chase's touches
     * from the evidence chain of a job the first chase actually recovered.
     *
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ AN EXPLICIT SELECT LIST, AND `to_address` IS NOT IN IT (T-7-15).     │
     * │ `listForCadence` above returns the whole row, which is correct for a │
     * │ caller that dies with the cadence. THIS read feeds                   │
     * │ `quote_attributions.evidence` — a jsonb column that OUTLIVES the     │
     * │ ledger row, the cadence and the retention rules that governed them.  │
     * │ A customer's mobile number reaching it becomes permanent by          │
     * │ accident, in a column nobody re-reads.                               │
     * └──────────────────────────────────────────────────────────────────────┘
     *
     * The return type is `LedgerTouchFields` — the SAME `Pick` the attribution
     * rule declares (`src/core/attribution/qualify.ts`) — so widening this
     * select list without widening that type is a compile error, and widening
     * that type is a review somebody has to have.
     *
     * Ordered `claimed_at ASC, touch_number ASC`, served by
     * `send_ledger_tenant_quote_idx` (07-01). `claimed_at` IS the sent moment:
     * `send_ledger` has no `sent_at` column.
     */
    listForQuote(quoteId: string): Promise<LedgerTouchFields[]>;

    /**
     * RPT-02 — HOW MANY QUOTES WE CHASED IN A PERIOD. The report's denominator.
     *
     * `COUNT(DISTINCT quote_id)` over rows satisfying the D-02 qualifying-touch
     * predicate whose sent (claimed) moment falls in `[start, end)`. DISTINCT is
     * the whole point: a quote chased with five touches is ONE quote chased, and
     * counting rows would inflate the headline figure by the cadence length.
     *
     * THE PREDICATE IS `qualifiesAsTouch` WRITTEN IN SQL, and it is written here
     * only because a count of a million rows must not be dragged into node to be
     * filtered by the TypeScript copy. The forms must stay identical
     * (`src/core/attribution/qualify.ts`) — and note the third clause:
     * `delivery_status IS DISTINCT FROM 'undelivered'`, never
     * `delivery_status <> 'undelivered'`. The plain inequality is NULL, and
     * therefore false, for every email touch and every SMS whose receipt has not
     * arrived — which is most of the qualifying rows in the table.
     *
     * HALF-OPEN `[start, end)`, the `listForPeriod` rule: a touch claimed at
     * exactly local midnight belongs to one month, not to two.
     */
    countQuotesChasedInPeriod(start: Date, end: Date): Promise<number>;
  };

  /**
   * RPT-01 — THE REPLY HALF OF THE EVIDENCE CHAIN. ONE KEYED READ, NOTHING ELSE.
   *
   * A namespace with exactly one member, deliberately. The inbound family
   * otherwise lives OUTSIDE `forTenant()` (`src/db/repository/inbound.ts`)
   * because a reply arrives carrying a phone number and no client — there is
   * nothing to construct a scope from. This read is the opposite case: the
   * attribution consumer already knows whose quote it is, and asking the
   * question inside a tenant scope is what makes the answer unable to name
   * somebody else's customer.
   */
  inbound: {
    /**
     * The THREADED replies on this quote, oldest first — ids, labels and flags.
     *
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ NO `body`, NO `from_address`, NO `normalized_from`, NO `raw_payload`.│
     * │ The evidence chain records THAT a customer replied and how it was    │
     * │ labelled, never what they wrote or the number they wrote from        │
     * │ (T-7-15). Everything omitted here is omitted on purpose.             │
     * └──────────────────────────────────────────────────────────────────────┘
     *
     * `attribution = 'threaded'` only: an `ambiguous` row matched two live
     * cadences and its `quote_id` is a guess, so crediting it as evidence for
     * THIS job would put a stranger's reply in a client's invoice pack.
     *
     * THE TENANT PREDICATE IS LOAD-BEARING AND NOT DECORATION.
     * `inbound_messages.tenant_id` IS NULLABLE (it means "unattributed" — see
     * the schema header), so this is the one evidence read where the scope
     * column can legitimately be absent from a row in the table. Filtering on
     * it is what keeps an unattributed reply, or one threaded to another
     * client, out of the answer.
     */
    listThreadedForQuote(quoteId: string): Promise<ThreadedInboundEvidence[]>;

    /**
     * RPT-02 — HOW MANY REPLIES CAME BACK IN A PERIOD. A count, and nothing else.
     *
     * `attribution = 'threaded'` only, for `listThreadedForQuote`'s reason: an
     * `ambiguous` row matched two live cadences and its `quote_id` is a guess, so
     * counting it credits this client with a reply that may belong to another.
     *
     * THE TENANT PREDICATE IS LOAD-BEARING AND NOT DECORATION.
     * `inbound_messages.tenant_id` IS NULLABLE — it means "unattributed" — so
     * this is the one count where the scope column can legitimately be absent
     * from a row in the table, and omitting the predicate would sum every
     * client's replies into one client's report.
     *
     * HALF-OPEN `[start, end)` on `received_at`.
     */
    countThreadedInPeriod(start: Date, end: Date): Promise<number>;

    /**
     * The newest THREADED reply body on this lead, or `null` (Phase 13, D-13).
     *
     * THE ONE READ IN THIS NAMESPACE THAT RETURNS A BODY, and it has exactly
     * one permitted caller: drafting, which hands the caller's own words to
     * the model as an untrusted fact (`sanitizeUntrusted`, capped, inside the
     * data fence) so a lead follow-up answers what they said. It never reaches
     * a log line, a count or the evidence chain. Tenant-scoped on the
     * NULLABLE `tenant_id`, threaded only, like its siblings.
     *
     * Phase 14: `leads.jobSheetFacts` is the SECOND read on the repository
     * that returns lead reply bodies. Its two callers are the confirm sheet
     * (an operator reading the caller's words before they go into the
     * tradie's ServiceM8) and `createJobForLead` (which writes them there) —
     * never a log, a count or the evidence chain.
     *
     * Phase 15 (2026-10, 15-03): `leads.queueCards` is the THIRD. Its one
     * caller is the `/leads` page behind `requireOperator()`, where the
     * newest reply is read by the one human allowed to read it — never a log,
     * a count, a digest or the evidence chain.
     */
    latestForLead(leadId: string): Promise<string | null>;

    /**
     * The HIGH-confidence closing labels on this client's OPEN leads (Phase
     * 13, D-11) — `{ inboundMessageId, leadId, label }`, oldest first.
     *
     * The read behind plan 13-04's `applyLeadLabelEffects` pass: each row is a
     * lead reply whose label ends the lead (`existing_job`, `complaint`,
     * `not_a_lead`, `already_sorted`, `spam`, `opt_out`). High confidence
     * only — a low-confidence `spam` would refuse a real caller a text-back
     * for 90 days (D-12, T-13-09).
     *
     * SELF-HEALING, SO NO MARKER COLUMN EXISTS: the join keeps only leads whose
     * status is still `open`, so a lead the pass closed leaves the set on its
     * own and a pass that died half way is finished by the next one. Bounded
     * by `inbound_messages_lead_label_idx` (0040). Ids and a vocabulary value
     * only — no body, no number.
     */
    closingLabelRowsForOpenLeads(): Promise<ClosingLabelRow[]>;

    /**
     * One reply's escalation facts — `{ body, fromAddress, cadenceId, leadId }`
     * — scoped to this client, or `[]` (Phase 13, D-08).
     *
     * THE ONE NUMBER-AND-BODY-BEARING READ FOR A HELD ESCALATION'S RELEASE
     * (plan 13-06): the hold stored only ids, so the release reads the words
     * and the sender here, after its claim, to build the tradie's text. Its
     * permitted caller is the core release pass; no console page, server
     * action or script may import it, and nothing it returns may reach a log
     * line.
     */
    byIdForEscalation(inboundMessageId: string): Promise<InboundForEscalation[]>;
  };

  /**
   * D-06/D-15 — INSERT AND READ ONLY. There is no update method and no delete
   * method on this namespace, and neither may ever be added: see the header of
   * src/db/schema/suppressed-contacts.ts. The absent grant in migration 0017
   * enforces the same rule for the console role.
   */
  suppression: {
    /** Add entries, ignoring ones already present. Returns rows inserted. */
    insertMany(rows: SuppressionInsert[]): Promise<number>;
    /**
     * Which of these channel/address pairs are suppressed — the dispatch-time
     * gate (CAD-05).
     *
     * Returns the MATCHED pairs rather than a boolean so a caller checking a
     * contact's mobile and email at once learns which of the two is blocked,
     * and can skip the right channel instead of the whole touch.
     */
    existsFor(pairs: readonly SuppressionProbe[]): Promise<SuppressionProbe[]>;
    /** The whole list for this tenant, newest first. */
    listAll(): Promise<SuppressedContact[]>;
  };

  /**
   * ONB-04 — what an operator SAW, and said so. APPEND AND READ ONLY.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THERE IS NO UPDATE METHOD AND NO DELETE METHOD, AND NEITHER MAY EVER BE  │
   * │ ADDED. The absent method IS the append-only rule.                        │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * The same shape, and the same reasoning, as `suppression` above: a surface
   * that cannot express the write is a stronger guarantee than a convention
   * asking callers not to make it. Migration 0032 grants `authenticated` SELECT
   * only, so the console reaches this namespace through a server action rather
   * than through an UPDATE of its own.
   *
   * WHY APPEND-ONLY RATHER THAN WRITE-ONCE (which is what `message_templates`
   * attestations are): the fact being attested can DRIFT — a client can switch
   * ServiceM8's native Quote Follow Up back on months later — so D-15 nags at
   * ~30 days and needs the HISTORY to nag from. An updatable row would erase
   * exactly the trail the staleness policy reads. See the schema header.
   */
  attestations: {
    /**
     * Record ONE attestation. INSERT only.
     *
     * `note` is required at the TYPE level and has no default, because
     * `tenant_attestations.note` is `NOT NULL` with no default for the reason
     * T-5-12 states: typing HOW you verified it IS the deliberation. A
     * signature that accepted `note?: string` would put the checkbox back.
     *
     * `attested_at` IS NOT A PARAMETER. It is the column's `defaultNow()`, so
     * the moment is the DATABASE's rather than a caller's — an attestation
     * whose timestamp a caller could choose is a date somebody could type, and
     * the whole value of this row is that the moment is ours.
     */
    append(row: {
      kind: TenantAttestationKind;
      note: string;
    }): Promise<TenantAttestation[]>;

    /**
     * The NEWEST attestation of one kind for this tenant, or `[]`.
     *
     * `[]` is the ONLY answer for a tenant nobody has attested for, and callers
     * must read it as "not attested" — never as "nothing to worry about". That
     * is the T-5-13 vacuous-truth direction, one table over; the decision is
     * made once, in `hasSm8AutomationAttestation`.
     *
     * An ordered LIMIT 1 rather than an aggregate, and served by
     * `tenant_attestations_latest_idx` — the caller needs the whole row
     * (`attested_at` for the staleness derivation, `note` for the attested
     * line the console renders).
     */
    latest(kind: TenantAttestationKind): Promise<TenantAttestation[]>;
  };

  /**
   * D-02 — WHAT WE PROVED WORKED ON PRODUCTION, WITH THE ARTEFACT TO SHOW FOR
   * IT. APPEND AND READ-LATEST ONLY.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THE SAME SURFACE AS `attestations` ABOVE, AND THE ABSENCE OF AN UPDATE   │
   * │ OR A DELETE IS THE SAME GUARANTEE: a proof is recorded once and stands.  │
   * │ Migration 0036 grants `authenticated` SELECT only, so the console reaches │
   * │ this namespace through a server action rather than a write of its own.   │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * WHY IT IS NOT TWO MORE ATTESTATION KINDS. An attestation is "a human looked
   * and says so"; a proof is "the system did it, and here is the row that proves
   * it" — checkable months later by somebody who was not there. The table makes
   * that the DATABASE's rule: `artefact_id` is NOT NULL with a length CHECK of
   * 8..128, and `recorded_by` is NOT NULL. See `src/db/schema/tenant-proofs.ts`.
   *
   * APPEND-ONLY AND LATEST-WINS, for the reason attestations are: re-proving a
   * channel is a NEW ROW, and the history is what a later reader needs to answer
   * "when did this last actually work" rather than "did it ever".
   */
  proofs: {
    /**
     * Record ONE proof. INSERT only.
     *
     * `artefactId` is required at the TYPE level and has no default, because
     * the artefact IS the claim — the escalation row id whose outcome is `sent`,
     * the Resend message id whose `last_event` is `delivered`. A signature that
     * accepted `artefactId?: string` would put the checkbox back that D-02
     * exists to remove, and the column's CHECK would then refuse the write with
     * a constraint error instead of a sentence.
     *
     * `artefactDetail` holds IDS, STATUSES, DOMAINS AND TIMESTAMPS ONLY — never
     * a customer address, a handset number or a message body (T-10-20). It is
     * the same evidence-family rule `escalations` follows one table over.
     *
     * `recordedBy` is the operator's Supabase user id, from `requireOperatorId()`
     * — never a form field, which here would mean the caller's claim about
     * themselves.
     *
     * `recorded_at` IS NOT A PARAMETER. It is the column's `defaultNow()`, so
     * the moment is the DATABASE's: a proof whose date somebody could type is a
     * date, not a proof.
     */
    append(row: {
      kind: TenantProofKind;
      artefactId: string;
      artefactDetail: Record<string, unknown>;
      note: string;
      recordedBy: string;
    }): Promise<TenantProof[]>;

    /**
     * The NEWEST proof of one kind for this tenant, or `[]`.
     *
     * `[]` is the ONLY answer for a channel nobody has proven, and callers must
     * read it as "not proven" — never as "nothing to worry about". That is the
     * T-5-13 vacuous-truth direction again, and the decision is made once, in
     * `readGoLiveChecklist`'s `live` derivation.
     *
     * An ordered LIMIT 1 rather than an aggregate, and served by
     * `tenant_proofs_latest_idx` — the caller needs the whole row (`recordedAt`
     * for the "recorded on {date}" line, `artefactId` for the id beside it).
     */
    latest(kind: TenantProofKind): Promise<TenantProof[]>;
  };

  /**
   * CAP-01/D-08 — THIS CLIENT'S BACKDESK DIVERT NUMBER. ONE ROW, AT MOST.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ NO DELETE. NO RELEASE. The absent method IS the rule (D-08), the way     │
   * │ `proofs` has no delete: a number released while the client is active is │
   * │ a number their phone keeps diverting to after Twilio sells it to         │
   * │ somebody else. Migration 0038 grants `authenticated` SELECT only, so the │
   * │ console reaches this namespace through a server action.                  │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * CLAIM-THEN-BUY (plan 11-04): `claim` inserts the `pending` row FIRST, so the
   * `tenant_id` UNIQUE refuses a second concurrent click before anything is
   * bought; `activate` fills the purchased number; `fail` records a refused
   * purchase with our closed code. A retry is `activate` on the failed row —
   * never a second INSERT.
   */
  divertNumber: {
    /** This client's row, or `[]`. */
    get(): Promise<TenantDivertNumber[]>;

    /**
     * INSERT the `pending` claim. A second claim for the same client raises
     * 23505 on `tenant_divert_numbers_tenant_uniq`, and that error PROPAGATES —
     * the caller maps it to "already provisioned" rather than this method
     * guessing.
     *
     * `createdBy` is the operator's Supabase user id from `requireOperatorId()`.
     */
    claim(row: { spokenName: string; createdBy: string }): Promise<TenantDivertNumber[]>;

    /**
     * The purchase succeeded: fill the number and flip to `active`. Guarded on
     * `status IN ('pending', 'failed')`, so an already-active number cannot be
     * silently repointed at a different one by a replayed call.
     */
    activate(row: {
      providerNumberSid: string;
      numberE164: string;
      locality: string | null;
      purchasedAt: Date;
      /**
       * WR-09: `bundle_unattached` when Twilio does not report the AU bundle on
       * the number after the attach-and-read-back, so the console shows it.
       * Omitted / `null` clears any earlier code. Fits the column CHECK.
       */
      failureCode?: string | null;
    }): Promise<TenantDivertNumber[]>;

    /** The purchase refused. Guarded on `status = 'pending'`. */
    fail(row: { failureCode: string }): Promise<TenantDivertNumber[]>;

    /**
     * THE PURCHASE'S OUTCOME IS UNKNOWN (CR-01): a timeout, a reset or a 5xx
     * after the create left. The row STAYS `pending` — it may own a number we
     * cannot see yet — and carries the hold code so the console can say so and
     * the next attempt looks the number up before buying. `updated_at` restarts
     * the wait. Guarded on `status = 'pending'`.
     */
    hold(row: { failureCode: string }): Promise<TenantDivertNumber[]>;

    /**
     * RE-CLAIM A PENDING ROW NOBODY IS STILL BUYING ON (CR-01/WR-07): a held or
     * abandoned claim whose `updated_at` is older than `before`. Clears the
     * code, refreshes the spoken name and restarts the clock, guarded on
     * `status = 'pending' AND updated_at < before` — so two retries race like
     * two claims, and `[]` means somebody else took it.
     */
    reclaimStale(spokenName: string, before: Date): Promise<TenantDivertNumber[]>;

    /**
     * RE-CLAIM A FAILED ROW for a retry (plan 11-05): `failed` → `pending`, the
     * spoken name refreshed and the old failure code cleared, guarded on
     * `status = 'failed'`. `[]` means somebody else re-claimed it first — the
     * retry twin of `claim`'s 23505, so a double click on "Buy" after a failed
     * purchase still cannot buy twice. And because the row is `pending` again,
     * a second refusal lands through `fail` like the first one did.
     */
    reclaim(spokenName: string): Promise<TenantDivertNumber[]>;

    /** What the greeting says after "you've reached". */
    setSpokenName(spokenName: string): Promise<TenantDivertNumber[]>;
  };

  /**
   * CAP-03/D-09 — THIS CLIENT'S CAPTURED CALLS. READ ONLY.
   *
   * Every WRITE to `missed_calls` goes through `src/db/repository/missed-calls.ts`
   * (the webhooks and the reconcile), because a call arrives before its tenant
   * is known. What a scoped reader needs is the latest one — "days since last
   * diverted call" on the checklist.
   */
  missedCalls: {
    /** The newest call for this client (`started_at DESC, id DESC`), or `[]`. */
    latest(): Promise<MissedCall[]>;

    /*
     * ── THE TEXT-BACK DECISION (Phase 12) ───────────────────────────────────
     *
     * The one exception to "every WRITE goes through missed-calls.ts": these
     * write the text-back columns only, never a call fact, and they must run
     * on the SAME transaction handle as the ledger claim.
     */

    /**
     * THE ARBITER. A guarded UPDATE on `text_back_status IS NULL` that sets
     * `claimed` and the decision time. `[]` means another caller (a second
     * callback delivery, the tick sweep) already decided this call — do
     * nothing at all.
     */
    claimForTextBack(id: string, at: Date): Promise<Array<{ id: string }>>;

    /** Record the decision on a row this caller claimed. */
    setTextBackDecision(id: string, patch: TextBackDecisionPatch): Promise<Array<{ id: string }>>;

    /**
     * Record the provider's answer: `sent` or `failed`, with a CHECK-safe code.
     * Guarded on `claimed`, so a late second answer cannot bury the first.
     */
    setTextBackOutcome(
      id: string,
      status: 'sent' | 'failed',
      detail: string | null,
    ): Promise<Array<{ id: string }>>;

    /**
     * Was this caller texted (claimed or sent) for this client since `since`?
     * The row being decided is excluded from its own answer. Failed sends do
     * not count (D-06, docs/commercial-assumptions.md §8).
     */
    existsTextBackToCallerSince(caller: string, since: Date, excludeId: string): Promise<boolean>;

    /**
     * How many text-backs (claimed or sent) this client has had since `since`,
     * excluding the row being decided — the D-07 daily cap's count.
     */
    countTextBacksSince(since: Date, excludeId: string): Promise<number>;

    /*
     * ── THE MISSED-CALL LOG (Phase 15, 2026-10, 15-03; D-02) ────────────────
     */

    /**
     * This client's diverted calls, NEWEST FIRST over `(started_at DESC, id
     * DESC)` — `missed_calls_tenant_started_idx` — `limit` rows, strictly
     * older than `before` when given (a KEYSET cursor, never OFFSET: a call
     * arriving while the operator pages cannot shift a row onto two pages or
     * off both). Each row carries the ledger's delivery verdict, the lead's
     * status and reason and the quote id of a quote-route call, every join
     * tenant-scoped on both sides. Dead letters (`tenant_id` NULL) never
     * appear: the tenant predicate excludes them.
     *
     * THE FIRST SCOPED READ THAT RETURNS `caller_e164` FOR A LIST. Its one
     * permitted caller is the client page's missed-calls section behind
     * `requireOperator()` (plan 15-05); the number goes into that row's props
     * and nowhere else — never a log, a count or the evidence chain.
     */
    listForLog(input: { before?: MissedCallLogCursor; limit: number }): Promise<MissedCallLogRow[]>;

    /**
     * How many of this client's calls arrived at or after `since` — the log's
     * state line ("{n} calls in the last 30 days"). A count, nothing else.
     */
    countInWindow(since: Date): Promise<number>;

    /*
     * ── THE PRIVACY PASS (Phase 15, 2026-10, 15-03; D-06) ───────────────────
     *
     * IDEMPOTENT AT THE ROW: every write is guarded on `pseudonymised_at IS
     * NULL`, so a crash mid-batch re-selects only unstamped rows next night
     * and a second run changes nothing. The pepper never enters this file —
     * hashes arrive as arguments. The suppression table is in no statement,
     * by design: a STOP is kept for as long as it is needed so that it keeps
     * working.
     */

    /**
     * This tenant's UNSTAMPED calls of one lead, oldest first, with the three
     * raw caller strings — the pass's read inside the lead's transaction.
     * RETURNS RAW NUMBERS; its one caller is the pass (plan 15-07).
     */
    listRawForLead(leadId: string): Promise<MissedCallRawStrings[]>;

    /**
     * Replace one call's three caller strings with `hashes` and stamp it, in
     * ONE guarded UPDATE (`tenant_id`, `id`, `pseudonymised_at IS NULL`).
     * RETURNING id: `[]` means already stamped or not this tenant's.
     */
    pseudonymise(id: string, hashes: MissedCallHashes, at: Date): Promise<Array<{ id: string }>>;
  };

  /**
   * THE LEADS A MISSED CALL OPENS (Phase 12, D-05/D-22). No delete; nothing in
   * Phase 12 closes a lead.
   */
  leads: {
    /**
     * Open a lead for this caller, or `[]` when an OPEN lead already exists —
     * the `leads_one_open_per_mobile` arbiter, targeted.
     */
    openOrCreate(row: LeadOpen): Promise<Lead[]>;
    /** A repeat call joined the open lead: advance its last call and count. */
    noteRepeatCall(contactMobile: string, at: Date): Promise<Array<{ id: string }>>;
    /** One lead by id, or `[]`. */
    byId(id: string): Promise<Lead[]>;
    /**
     * The closing facts of this caller's NEWEST lead at this client, whatever
     * its status, or `[]` when they have never been a lead here (Phase 13,
     * D-12). Newest by `created_at` — the lead that matters for the 90-day
     * negative cool-off is the last one, not any negative one ever. Served by
     * `leads_tenant_mobile_created_idx`.
     */
    latestForMobile(contactMobile: string): Promise<LeadCloseFacts[]>;

    /**
     * Close an OPEN lead, once (Phase 13, D-14). One guarded UPDATE: status
     * `expired` when the reason is `expired`, otherwise `closed`, with
     * `closed_reason`, `closed_at` and `updated_at` — WHERE the lead is this
     * tenant's and still `open`. RETURNING id: zero rows is an answer ("already
     * closed, or not ours"), not an error. Only `closeLeadInTx` calls this.
     */
    close(leadId: string, reason: LeadClosedReason, at: Date): Promise<Array<{ id: string }>>;

    /**
     * OPEN leads whose lead cadence has ended — `completed`, `expired` or
     * `stopped` (Phase 13, D-01/D-14). The reconciling sweep's read: every
     * way a lead cadence can end closes its lead by a scan rather than by an
     * edit in each Phase 4 writer that can end a cadence.
     */
    listOpenWithEndedCadence(): Promise<LeadWithEndedCadence[]>;

    // ── Phase 14: the ServiceM8 job linkage (D-04, D-07, D-09) ──────────────

    /**
     * THE ONLY TRANSITION INTO `creating` (D-04). One guarded UPDATE: state
     * `creating`, attempt count + 1, `sm8_job_attempted_at`, the error kind
     * cleared — WHERE the lead is this tenant's, `open`, and in `none` or
     * `failed`. RETURNING the uuids a previous attempt persisted. ZERO ROWS IS
     * AN ANSWER decided by Postgres under row locking: the second of two taps
     * gets `[]` and reads `jobStateFor` to say why.
     */
    claimJobCreation(leadId: string, at: Date): Promise<LeadJobClaim[]>;
    /** The refusal read after a zero-row claim, or `[]` for no such lead. */
    jobStateFor(leadId: string): Promise<LeadJobStateFacts[]>;
    /**
     * Persist one step's uuid(s) the moment ServiceM8 answers, guarded
     * `sm8_job_state = 'creating'` (a lead no longer being created takes no
     * linkage). RETURNING id; an empty patch writes nothing and returns `[]`.
     */
    setJobLinkage(leadId: string, patch: LeadJobLinkagePatch): Promise<Array<{ id: string }>>;
    /**
     * `creating` → `created`, with the job and contact uuids, the moment and
     * the operator, guarded `sm8_job_state = 'creating'`. RETURNING id: zero
     * rows means the lead left `creating` under us — the caller's transaction
     * throws rather than lose a job that now exists in the tradie's account.
     *
     * NOT guarded on `status = 'open'`, deliberately (14-REVIEW IN-07): a STOP,
     * a DONE or the sweep can close the lead while the ServiceM8 calls are in
     * flight. The job was created while the lead was open, so it is recorded
     * `created` and the lead stays `closed` with its original reason (no
     * `job_created`, no chip) — legal under every CHECK, counted by the
     * digest's jobs-created line, and lead-born for attribution (WR-03).
     */
    recordJobCreated(
      leadId: string,
      input: { jobUuid: string; contactUuid: string; createdBy: string; at: Date },
    ): Promise<Array<{ id: string }>>;
    /**
     * `creating` → `failed` with the kind, guarded `creating`. The persisted
     * uuids are KEPT — the retry reconciles on them. RETURNING id.
     */
    recordJobFailure(leadId: string, kind: LeadJobErrorKind, at: Date): Promise<Array<{ id: string }>>;
    /**
     * The inbox rows' linkage (D-09): `leads` LEFT JOIN the quotes mirror on
     * `(tenant_id, sm8_job_uuid)`. Tenant-scoped; `[]` for an empty list. The
     * page makes one call per tenant — `listInboundNeedingTriage` may not join
     * (tests/inbox-authorization.test.ts).
     */
    jobLinkageFor(leadIds: readonly string[]): Promise<LeadJobLinkage[]>;
    /**
     * The confirm sheet's facts (D-01), or `null` for no such lead: the lead
     * row, the newest lead cadence's `contact_name`, and the lead's THREADED,
     * non-STOP replies oldest first.
     *
     * RETURNS THE CALLER'S MOBILE AND THEIR WORDS. Two permitted callers: the
     * confirm sheet (an operator reading the caller's words before they go
     * into the tradie's ServiceM8) and `createJobForLead` (which writes them
     * there). Never a log, a count or the evidence chain.
     *
     * Phase 15 (2026-10, 15-03): `queueCards` below is the THIRD read on the
     * repository that returns a lead reply body — the same rule, one more
     * caller.
     */
    jobSheetFacts(leadId: string): Promise<LeadJobSheetFacts | null>;
    /**
     * THE `/leads` CARDS' PERSONAL FACTS (Phase 15, D-01), for the leads of
     * THIS tenant among `leadIds`: the caller's mobile, and the lead's NEWEST
     * threaded, non-STOP reply (`received_at DESC, id DESC`) with its label,
     * confidence, urgency and hot flag — or `reply: null`. `[]` for an empty
     * list, without a query; another tenant's lead id matches nothing.
     *
     * The other half of the queue's two-authority split: the cross-tenant read
     * (`listOpenLeadsForQueue`) returns ids and instants only, and the page
     * calls this once per tenant — the inbox's `jobLinkageFor` shape.
     *
     * RETURNS THE CALLER'S MOBILE AND THEIR WORDS — the THIRD read on the
     * repository that returns lead reply bodies, after `inbound.latestForLead`
     * and `jobSheetFacts`. ONE permitted caller: the `/leads` page behind
     * `requireOperator()`, where the reply is read by the one human allowed
     * to read it. Never a log, a count, a digest or the evidence chain.
     */
    queueCards(leadIds: readonly string[]): Promise<LeadQueueCardFacts[]>;
    /**
     * Every lead of this tenant linked to this ServiceM8 job — our creation or
     * a tradie-booked match (D-06's attribution exclusion read, plan 14-03).
     */
    linkedToJob(sm8JobUuid: string): Promise<LeadLinkedToJob[]>;
    /**
     * OPEN leads still at `sm8_job_state = 'none'` (D-07), oldest call first.
     * A lead in `creating`/`created`/`failed` is the operator's and is not a
     * match candidate.
     */
    listOpenForJobMatch(): Promise<LeadJobMatchCandidate[]>;
    /**
     * Record the tradie's job a match found (D-07): `sm8_job_uuid` set, state
     * stays `none` (the partial unique is scoped to `created`), guarded
     * `status = 'open' AND sm8_job_state = 'none'`. RETURNING id.
     */
    setMatchedJob(leadId: string, jobUuid: string, at: Date): Promise<Array<{ id: string }>>;
    /**
     * Release every ABANDONED claim (plan 14-03): `creating` → `failed` with
     * kind `stale_claim`, guarded `sm8_job_state = 'creating' AND
     * sm8_job_attempted_at < cutoff` (strictly older; `staleJobClaimCutoff`
     * computes it). The persisted uuids are KEPT — the retry reconciles on
     * them. Idempotent: a released lead is no longer `creating`. RETURNING id.
     */
    failStaleJobClaims(cutoff: Date, at: Date): Promise<Array<{ id: string }>>;
    /**
     * Which of these ServiceM8 job uuids a lead of this tenant has recorded, in
     * ANY state (plan 14-03, the SM8-02 first-sight guard): the sync asks it
     * of the jobs it has never seen, inside its own transaction, so the orphan
     * of a lead's failed attempt lands `needs_review` / `lead` and emits no
     * event. Distinct uuids; `[]` for an empty list, without a query.
     */
    jobUuidsLinkedAmong(sm8JobUuids: readonly string[]): Promise<string[]>;

    // ── Phase 15 (2026-10, 15-03): the privacy pass (D-06) ──────────────────

    /**
     * REPLACE ONE CLOSED LEAD'S CALLER NUMBER WITH `contactHash`, EVERYWHERE
     * THIS TENANT HOLDS IT FOR THE LEAD, UNDER THE LEAD'S STAMP (D-06).
     *
     * FOUR guarded UPDATEs on the caller's handle — meaningful inside
     * `transaction()`, where they commit or roll back together:
     *
     *   1. `inbound_messages` — `from_address` and `normalized_from` take the
     *      hash and the row is stamped; the words the caller sent stay with
     *      the business's records and are never written here.
     *   1b. (15-REVIEW WR-01) the replies from the lead's number that we
     *      COULD NOT PLACE — `unmatched`, or `ambiguous` with this tenant
     *      among the candidates; no lead, no quote, no cadence, no tenant —
     *      received from the lead's first call onward and either within
     *      PSEUDONYMISE_AFTER_DAYS of its close or already older than that.
     *      The common one is the late "thanks, all sorted" after the lead's
     *      cadence stopped: attribution only threads to a LIVE cadence, so it
     *      lands with `lead_id` NULL and no other statement reaches it. The
     *      ONE statement here that touches tenant-less rows, and only through
     *      an EXISTS binding them to this tenant's due lead by its own raw
     *      number. Same hash, same stamp, words untouched. The hash depends
     *      on the number alone, so which client's lead reaches a shared row
     *      first changes nothing about what it holds.
     *   2. `cadences` (the lead's `kind = 'lead'` cadences) — `contact_mobile`.
     *   3. `send_ledger` (the lead's rows) — `to_address`.
     *   4. LAST, `leads` — `contact_mobile` AND `pseudonymised_at` in ONE
     *      statement, so the widened `leads_contact_mobile_e164` CHECK admits
     *      the hash (a hash cannot land without its stamp).
     *
     * EVERY statement is guarded on the lead being THIS tenant's, NOT OPEN and
     * UNSTAMPED — statements 1–3 through an EXISTS on the lead row, statement
     * 4 directly — so an open lead is never hashed, a stamped lead is never
     * hashed twice, and a refused lead leaves its children untouched too. No
     * fourth stamp: `cadences` and `send_ledger` ride the lead's. The lead's
     * missed calls are hashed beside this through `missedCalls.pseudonymise`.
     */
    pseudonymise(
      leadId: string,
      input: { contactHash: string; at: Date },
    ): Promise<PseudonymiseLeadCounts>;
  };

  /**
   * This client's never-text list (Phase 12, D-06, IN-07). The numbers are the
   * client's own and the people they name; NONE IS EVER PRINTED — callers log
   * ids and counts only.
   */
  neverText: {
    list(): Promise<TenantNeverTextNumber[]>;

    /**
     * Add one number. `ON CONFLICT DO NOTHING` on
     * `tenant_never_text_tenant_number_uniq`, TARGETED: `[]` means "already on
     * this client's list" and is an answer, not a failure. A conflict on any
     * other index (the primary key) raises rather than being read as a
     * duplicate.
     */
    add(row: NeverTextAdd): Promise<TenantNeverTextNumber[]>;

    /**
     * Remove ONE entry by id, with the tenant in the predicate — another
     * client's id removes nothing and returns `[]`. The "never empty the
     * own-line list of an armed client" rule (IN-07) is the caller's
     * (`src/core/leads/never-text.ts`), because it needs the arming read.
     */
    remove(id: string): Promise<TenantNeverTextNumber[]>;

    /** Is this exact normalised number on this client's list? */
    has(numberE164: string): Promise<boolean>;

    /**
     * How many `own_line` rows this client has — the `neverTextOwnNumber`
     * checklist item and the IN-07 last-line guard. An integer (`::int`).
     */
    countOwnLines(): Promise<number>;
  };

  /**
   * This client's text-back wording (Phase 12, D-02). VERSIONED AND
   * WRITE-ONCE ATTESTED, the `messageTemplates` mould.
   *
   * ┌──────────────────────────────────────────────────────────────────────┐
   * │ THERE IS NO UPDATE OF A BODY, NO DELETE AND NO UN-ATTEST, AND NONE   │
   * │ MAY BE ADDED. An attested version is the evidence of what a member   │
   * │ of the public was sent; an edit is a new version, and the send path  │
   * │ reads only the newest ATTESTED one.                                  │
   * └──────────────────────────────────────────────────────────────────────┘
   */
  textBackTemplates: {
    /**
     * The newest version of this variant whose attestation is recorded, or
     * `[]`. An unattested later edit is ignored: what goes out is what was
     * attested.
     */
    latestAttested(variant: TextBackVariant): Promise<TextBackTemplate[]>;

    /**
     * Save a new version of one variant, UNATTESTED. `version` is
     * `MAX(version) + 1` for this `(tenant, variant)`, computed INSIDE the
     * INSERT (the `messageTemplates.insertVersion` sub-select), so two
     * concurrent saves compute the same number and one loses on
     * `text_back_templates_tenant_variant_version_uniq` (23505) — Postgres
     * decides. A save is never an attestation.
     */
    insertVersion(row: TextBackTemplateInsert): Promise<TextBackTemplate[]>;

    /**
     * THE WRITE-ONCE ATTESTATION (D-02). Stamps all three attestation columns
     * on ONE version of this tenant, guarded on `attested_at IS NULL`. `[]`
     * means "already attested, or no such version of this client's" — the
     * caller reports it and never assumes it landed. A second call changes
     * nothing.
     */
    attestWhereUnattested(
      versionId: string,
      note: string,
      attestedBy: string,
      at: Date,
    ): Promise<TextBackTemplate[]>;

    /**
     * The newest version of this variant, attested OR NOT, or `[]` — what the
     * wording form shows. Never what the send path reads.
     */
    latestForVariant(variant: TextBackVariant): Promise<TextBackTemplate[]>;

    /**
     * ONE version by id, scoped to this tenant, or `[]` — what attestation
     * re-validates before it stamps.
     */
    byId(versionId: string): Promise<TextBackTemplate[]>;

    /**
     * ONE BOOLEAN PER MEMBER OF `TEXT_BACK_VARIANTS`: does an attested version
     * of it exist? DRIVEN FROM THE VOCABULARY, NOT FROM THE ROWS — a tenant
     * with no rows reads all `false`, and a variant added to the vocabulary
     * later reads `false` until it is attested, rather than being absent from
     * the answer (the `latestApprovedStatus` argument).
     */
    attestedSetStatus(): Promise<Record<TextBackVariant, boolean>>;
  };

  /**
   * RPT-01 — WHAT WE RECOVERED, AND THE PROOF. CLAIM AND READ ONLY.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THERE IS NO UPDATE METHOD AND NO DELETE METHOD, AND NEITHER MAY EVER BE  │
   * │ ADDED. An attribution is written once and stands. The absent method IS   │
   * │ the rule — the `suppression` / `attestations` posture, for the most      │
   * │ expensive reason in this codebase: these rows are what the client is     │
   * │ BILLED from.                                                             │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * An UPDATE method would edit a dollar figure after it had been reported; a
   * DELETE method would free the D-04 never-twice claim, so the next replayed
   * `won` event bills the same job a second time. Migration 0033 grants
   * `authenticated` SELECT only, so the console reaches nothing here except by
   * reading.
   */
  attributions: {
    /**
     * D-04 — CLAIM A QUOTE'S ATTRIBUTION, AT MOST ONCE, EVER.
     *
     * Targetless `INSERT … ON CONFLICT DO NOTHING RETURNING id`.
     * ZERO ROWS MEANS THIS QUOTE IS ALREADY ATTRIBUTED — a replayed `won`
     * event, a reopen→win cycle, or a second overlapping tick — and the caller
     * records nothing and reports it as an outcome rather than a failure. That
     * is the whole never-twice guarantee, and it is why this returns an array
     * the caller branches on instead of a row it can assume.
     *
     * TARGETLESS on purpose, the `cadences.create` argument (cadences.ts:95-101):
     * naming `quote_attributions_one_per_quote` as the arbiter would make a
     * conflict on any OTHER index raise 23505 inside the consumer's transaction,
     * which the consumer reads as a blocked run — and a blocked run holds the
     * shared attribution cursor for every tenant.
     *
     * Postgres arbitrates. Not a `SELECT` then an `INSERT`, which two ticks
     * running a second apart both pass.
     */
    claim(row: AttributionClaim): Promise<Array<{ id: string }>>;

    /**
     * Every attribution whose win was DETECTED inside `[start, end)` — ONE
     * client, ONE calendar month, the whole input to one monthly report (D-10).
     *
     * HALF-OPEN AT BOTH ENDS, and that is the assertion the suite makes rather
     * than the comment: a closed upper bound puts a win detected at exactly
     * midnight-local into two months, so the same job appears on two invoices.
     *
     * Ordered `won_detected_at ASC, quote_id ASC` — the order the report's lines
     * print in. The quote id is the tie-break because a batch of wins consumed
     * in one tick shares a `detected_at` to the microsecond, and two renders of
     * one frozen report must not order a tie differently.
     *
     * Served by `quote_attributions_tenant_won_idx`. Full rows: this table
     * carries no addresses and no message bodies, so there is nothing here a
     * select list would be protecting.
     */
    listForPeriod(start: Date, end: Date): Promise<QuoteAttribution[]>;

    /**
     * This quote's attribution, or `[]`. AT MOST ONE ROW BY CONSTRUCTION —
     * `quote_attributions_one_per_quote` is what makes that true, and the array
     * is what makes the "not attributed" answer expressible without a null the
     * caller might read as "attributed for nothing".
     */
    byQuote(quoteId: string): Promise<QuoteAttribution[]>;
  };

  /**
   * RPT-02 — THE DOCUMENTS A CLIENT WAS SENT. INSERT AND READ ONLY.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THERE IS NO UPDATE METHOD AND NO DELETE METHOD, AND NEITHER MAY EVER BE  │
   * │ ADDED. A report row is the record of what was handed over (D-11).        │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * A CORRECTION IS A NEW VERSION, not an edit. That is not a style preference:
   * the product's promise is that the PDF stapled to an invoice is reproducible
   * months later, and an editable row makes the document and the record diverge
   * with no trace.
   */
  reports: {
    /**
     * Freeze one month's report as the NEXT version, in ONE statement.
     *
     * `version` is computed inside the INSERT — `COALESCE(MAX(version), 0) + 1`
     * over this tenant's rows for this `period_start` — rather than read first
     * and passed in, because two operators generating at the same moment would
     * both read the same maximum and both compute the same next number.
     *
     * `monthly_reports_version_uniq` is the arbiter. The loser gets SQLSTATE
     * 23505 AT THE WRITE, and THE CALLER maps it to "a report for this month was
     * just generated — reload to see it" (the `approveDraft` precedent,
     * touch-drafts.ts:31-39). A raise here is strictly better than a silent
     * overwrite: the only alternative that does not raise is one generate
     * quietly replacing the other's document.
     *
     * Returns the new row's id and version — the caller redirects to it.
     */
    insertVersion(row: ReportInsert): Promise<Array<{ id: string; version: number }>>;

    /**
     * This client's reports, newest month first and newest version first within
     * a month — WITHOUT the five frozen documents (see `MonthlyReportSummary`).
     *
     * EVERY VERSION STAYS VISIBLE (D-11). A list that showed only the latest
     * would hide the document a client was actually sent the moment a correction
     * was generated, which is the one row somebody asking about their invoice
     * needs to see.
     *
     * Ordered BEFORE it is limited, capped at `REPORT_LIST_LIMIT`.
     */
    list(): Promise<MonthlyReportSummary[]>;

    /**
     * The highest version number this client has for ONE month, or `[]`.
     *
     * A TARGETED READ, BECAUSE `list()` IS CAPPED (07 WR-05). The "a newer
     * version of this month exists" banner used to be derived by scanning
     * `list()`, which returns at most `REPORT_LIST_LIMIT` rows: once the cap
     * binds, an old month falls off, the scan finds nothing, and the banner
     * silently stops firing on exactly the superseded reports it exists for.
     * A question about one month should not be answered by reading ten years.
     */
    latestVersionOf(periodStart: string): Promise<Array<{ id: string; version: number }>>;

    /**
     * ONE report, in full, or `[]`.
     *
     * `tenant_id` is pinned from the closure ALONGSIDE the id, so a report id
     * belonging to another client returns the empty answer rather than the
     * document (T-7-04). Denial and absence stay indistinguishable — a report id
     * is a uuid in a URL, and "this exists but is not yours" is a fact worth
     * nothing to a legitimate caller and worth a great deal to anyone else.
     */
    byId(reportId: string): Promise<MonthlyReport[]>;
  };

  /**
   * D-13 — WHAT THIS CLIENT PAYS US. APPEND AND READ ONLY.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THERE IS NO UPDATE METHOD AND NO DELETE METHOD, AND NEITHER MAY EVER BE  │
   * │ ADDED. A price change is a NEW ROW with a later `effective_from`.        │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * The `attestations` shape, for a billing reason. These rows are the
   * DENOMINATOR of the 3× guarantee: editing an amount after a report has quoted
   * a multiple against it retroactively changes what the client was told they
   * got for their money, and deleting one erases the answer to "what were we
   * charging them in August" for every month not yet reported.
   */
  fees: {
    /** Record ONE fee-schedule entry. INSERT only. Returns the row written. */
    append(row: FeeInsert): Promise<TenantFee[]>;

    /**
     * The whole schedule, `effective_from DESC, created_at DESC`.
     *
     * THE SECOND ORDERING KEY IS THE D-13 RULE, not a tidiness preference. Two
     * rows can share an `effective_from` — an operator enters $597, notices it
     * should have been $997 from the same date, and appends the correction — and
     * LATEST-INSERTED WINS. Ordering on `effective_from` alone leaves that tie to
     * the planner, which means the mistake could win and a client could be
     * billed, and reported against, the wrong retainer.
     *
     * `feesInForce` reads this order directly. Both `kind`s come back together;
     * the pure function separates them, because "which fee applied on this day"
     * is a rule with tests behind it and not a WHERE clause.
     */
    list(): Promise<TenantFee[]>;
  };

  /**
   * RPT-03 — THIS CLIENT'S ROLLING-WINDOW COUNTS. READ-ONLY.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THE SAME EIGHT STATEMENTS `forAllTenants_reportMetrics` RUNS, PINNED TO  │
   * │ ONE TENANT. A change to ANY predicate here must be made there too, and   │
   * │ vice versa — `tests/report-metrics.test.ts` asserts the two results are  │
   * │ field-for-field equal for the same window, so the pair cannot drift      │
   * │ silently. That test is the reason the duplication is acceptable.         │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * WHY IT IS DUPLICATED RATHER THAN SHARED. The cross-tenant file's
   * reachability is PINNED by `tests/sync-upsert.test.ts` against its own
   * import block: a table it can query is a table it imports. Moving these
   * statements into a module both files call would empty that import block and
   * make the pin — the thing that notices a new cross-tenant read — pass while
   * asserting nothing. Two readable copies and one equality test beat one copy
   * and a tripwire that has stopped working.
   *
   * The detail page reads THIS one. It already knows whose page it is, and
   * asking a cross-tenant accessor for one client's row would mean the page
   * held every client's numbers to render one client's.
   */
  metrics: {
    /**
     * Everything `computeTenantMetrics` needs, for `[window.start, window.end]`.
     *
     * CLOSED AT BOTH ENDS, matching `inRolling` and NOT the half-open calendar
     * reads beside it: a rolling window's end is "now", and an event happening
     * this instant is inside the last 30 days by any reading.
     *
     * Returns ZEROS rather than throwing for a tenant with no activity, and
     * `tenantName` / `timezone` come from the `tenants` row — the page renders
     * the name it already read through RLS, but the SHAPE has to match the
     * cross-tenant accessor's or the parity test could not compare them.
     */
    windowCounts(window: Period): Promise<TenantMetricCounts>;

    /**
     * THE MISSED-CALL FIGURE COUNTS (Phase 15, 2026-10, 15-03; D-03, D-10) —
     * everything `computeMissedCallFigures` needs for the calendar `period`
     * (`[start, end)`, half-open: a report month), with the hour and weekday
     * splits computed IN SQL in `timezone` (the tenant's IANA zone, validated
     * by `tenants_validate_timezone_trg`, bound as a parameter and never
     * interpolated).
     *
     * THE ONE READ BOTH THE FREEZE (`generate.ts`, plan 15-06) AND THE LIVE
     * MONTH-TO-DATE PAGE CALL, so the frozen row and the live block cannot
     * disagree. COUNTS ONLY cross the boundary — integers, the fixed-length
     * bucket arrays and one whole-second duration per delivered text-back. No
     * rate, no median, no percentile is computed here; no number, no body,
     * no id is returned. Tenant-scoped and HTTP-free.
     */
    missedCallCounts(period: Period, timezone: string): Promise<MissedCallCounts>;
  };

  quoteContacts: {
    /** Every mirrored contact for this tenant. */
    list(): Promise<Array<typeof quoteContacts.$inferSelect>>;
    /**
     * The contacts of ONE job — D-04's input, served by
     * `quote_contacts_tenant_job_idx`.
     *
     * Returns INACTIVE contacts too. Exclusion is `selectPrimaryContact`'s
     * decision and it is a documented rule with a test behind it; filtering
     * here would move half of that rule into a query where nothing asserts it,
     * and would make "why was nobody selected" answerable only by re-running
     * the read.
     */
    listForJob(sm8JobUuid: string): Promise<Array<typeof quoteContacts.$inferSelect>>;
    /** Upsert on `(tenant_id, sm8_contact_uuid)`. Returns rows written. */
    upsertMany(rows: QuoteContactUpsert[]): Promise<number>;

    /**
     * The mirrored contacts of these jobs — numbers and the active flag only
     * (Phase 14, D-07). Inactive contacts included; the matcher decides. `[]`
     * for an empty list.
     */
    forJobs(sm8JobUuids: readonly string[]): Promise<JobContactMobile[]>;
    /**
     * Tier (i) of the create path's company match (Phase 14, D-02): mirrored
     * contacts whose `mobile` or `phone` ENDS WITH `tail` — the last three
     * digits of a CHECK-validated E.164 — joined to their job's company,
     * newest `date_raw` first. A coarse, parameterised prefilter; equality is
     * `normalizeAuMobile` in TypeScript, never SQL string munging. A tail
     * that is not exactly three digits returns `[]` without a query.
     */
    companyCandidatesByMobileTail(tail: string): Promise<CompanyCandidate[]>;
  };

  /**
   * ┌────────────────────────────────────────────────────────────────────────┐
   * │ NOT TENANT DATA, AND HERE ON PURPOSE — read this before adding to it.  │
   * └────────────────────────────────────────────────────────────────────────┘
   *
   * `event_consumer_cursors` carries no `tenant_id` at all (its RLS policy is
   * `is_operator()`, not `has_tenant_access(...)`), so nothing about it is
   * scoped by the closure this file is built on. It appears on the tenant-scoped
   * repository for exactly ONE reason: the outbox contract requires the cursor
   * advance to commit in the SAME transaction as the actions taken on the events
   * it covers — "Advancing separately is how a consumer skips work after a
   * crash" (src/db/schema/quote-events.ts) — and those actions are tenant-scoped.
   * A `forTenant(id).transaction()` handle is the only thing that can be inside
   * that transaction, so the advance has to be reachable from one.
   *
   * Registration and the pre-scan read live in `./consumer-cursor.ts`, which is
   * where a reader should start; they run before any tenant is known.
   *
   * THIS IS THE ONLY NON-TENANT-SCOPED NAMESPACE IN THIS FILE AND MUST STAY THE
   * ONLY ONE. Every method takes the consumer key explicitly and touches no
   * tenant column, so nothing here can be mistaken for a scoped read.
   */
  consumerCursor: {
    /**
     * Move a consumer's cursor forward, never backward.
     *
     * `WHERE last_event_id < $to` is the never-rewind guard: a slow tick
     * finishing after a faster one must not drag the cursor back and replay
     * work that already committed. Returns the rows actually moved — zero means
     * somebody else was further ahead, which is an answer, not a failure.
     */
    advanceTo(consumer: string, toEventId: number): Promise<number>;
  };

  events: {
    /**
     * Append to the outbox. Called inside the SAME transaction as the quote
     * upsert that justifies the rows — that co-commit is the whole guarantee
     * (SYNC-02). Returns rows written.
     */
    insertMany(rows: QuoteStatusEventInsert[]): Promise<number>;
    /**
     * The consumer's read, scoped to this tenant: everything past `afterId`, in
     * id order. Phase 3 reads across tenants and will do so through its own
     * explicitly-named cross-tenant accessor; this exists for the console
     * timeline and for tests.
     */
    since(afterId: number): Promise<QuoteStatusEvent[]>;

    /**
     * RPT-02 — HOW MANY QUOTES THIS CLIENT WON IN A PERIOD, FULL STOP.
     *
     * Printed on the report BESIDE the number we claim, deliberately (D-13): a
     * document that said "jobs won 4" while the client's own account showed
     * eleven would be read as a lie about their business rather than as a claim
     * about ours. `of {t} won in the month` is the sentence this number serves.
     *
     * `COUNT(DISTINCT quote_id)` because the outbox can carry more than one
     * `won` event for a quote — a reopen and a re-win emit a second one — and a
     * client does not win the same job twice.
     *
     * Bucketed on `detected_at` (WHEN WE SAW IT), never `occurred_at`, which is
     * the D-10 rule the whole report rests on: a month never changes after it
     * is reported, and a late-arriving ServiceM8 edit date would rewrite one.
     *
     * Served by `quote_status_events_tenant_quote_idx`. Half-open `[start, end)`.
     */
    countWonQuotesInPeriod(start: Date, end: Date): Promise<number>;
  };

  syncRuns: {
    /** One row per cycle, success or failure. Never skipped — see the schema. */
    insert(row: SyncRunInsert): Promise<SyncRun[]>;
    /** Most recent first — the health derivation's input (D-07). */
    recent(limit?: number): Promise<SyncRun[]>;
  };

  /**
   * Run several scoped writes atomically.
   *
   * The callback receives a repository bound to the SAME tenant and to the
   * transaction, so nothing inside can accidentally escape to the outer
   * connection — the isolation guarantee survives the transaction boundary
   * rather than being suspended for its duration.
   */
  transaction<T>(fn: (repo: TenantScopedRepository) => Promise<T>): Promise<T>;
}

/** Any drizzle handle: the pool, or a transaction bound to one connection. */
type DbLike = RepositoryDb | Parameters<Parameters<RepositoryDb['transaction']>[0]>[0];

function build(tenantId: string, db: DbLike): TenantScopedRepository {
  return {
    tenant: {
      get: () => db.select().from(tenants).where(eq(tenants.id, tenantId)),

      update: (patch: TenantPatch) => {
        const keys = Object.keys(patch ?? {});
        if (keys.length === 0) {
          throw new Error('forTenant().tenant.update() called with an empty patch.');
        }

        const immutable = keys.filter((k) => IMMUTABLE_KEYS.has(k));
        if (immutable.length > 0) {
          throw new Error(
            `forTenant().tenant.update() cannot patch ${immutable.join(', ')}. ` +
              'Repointing a row’s primary key would move data between tenants.',
          );
        }

        // Anything not a column of `tenants` is a caller mistake — a typo silently
        // dropped by the driver is a write that looks applied and is not.
        const unknown = keys.filter((k) => !MUTABLE_KEYS.has(k));
        if (unknown.length > 0) {
          throw new Error(
            `forTenant().tenant.update() received unknown field(s): ${unknown.join(', ')}.`,
          );
        }

        return db
          .update(tenants)
          .set(patch)
          .where(eq(tenants.id, tenantId))
          .returning();
      },
    },

    connection: {
      get: () =>
        db.select().from(sm8Connections).where(eq(sm8Connections.tenantId, tenantId)),

      upsert: (values: ConnectionUpsert) =>
        db
          .insert(sm8Connections)
          .values({ ...values, tenantId })
          .onConflictDoUpdate({
            target: sm8Connections.tenantId,
            set: values,
          })
          .returning(),

      lock: () =>
        db
          .select()
          .from(sm8Connections)
          .where(eq(sm8Connections.tenantId, tenantId))
          .for('update'),

      update: (patch: ConnectionPatch) => {
        if (Object.keys(patch ?? {}).length === 0) {
          throw new Error('forTenant().connection.update() called with an empty patch.');
        }
        return db
          .update(sm8Connections)
          .set(patch)
          .where(eq(sm8Connections.tenantId, tenantId))
          .returning();
      },
    },

    quotes: {
      list: () =>
        db
          .select()
          .from(quotes)
          .where(eq(quotes.tenantId, tenantId))
          .orderBy(sql`${quotes.editDateRaw} DESC`),

      byId: (quoteId: string) =>
        db
          .select()
          .from(quotes)
          .where(and(eq(quotes.tenantId, tenantId), eq(quotes.id, quoteId)))
          .limit(1),

      listOpen: () =>
        db
          .select()
          .from(quotes)
          .where(
            sql`${quotes.tenantId} = ${tenantId} AND ${quotes.status} = 'Quote' AND ${quotes.sm8Active} = true`,
          )
          .orderBy(sql`${quotes.quoteDateRaw} DESC NULLS LAST`),

      stateFor: async (sm8JobUuids: string[]) => {
        if (sm8JobUuids.length === 0) return [];

        return db
          .select({
            id: quotes.id,
            sm8JobUuid: quotes.sm8JobUuid,
            status: quotes.status,
            sm8Active: quotes.sm8Active,
            chaseEligibility: quotes.chaseEligibility,
          })
          .from(quotes)
          .where(
            sql`${quotes.tenantId} = ${tenantId} AND ${inArray(quotes.sm8JobUuid, sm8JobUuids)}`,
          );
      },

      upsertMany: async (rows: QuoteUpsert[]) => {
        const written = await build(tenantId, db).quotes.upsertManyReturning(rows);
        return written.length;
      },

      upsertManyReturning: async (rows: QuoteUpsert[]) => {
        if (rows.length === 0) return [];

        return db
          .insert(quotes)
          .values(rows.map((row) => ({ ...row, tenantId })))
          .onConflictDoUpdate({
            target: [quotes.tenantId, quotes.sm8JobUuid],
            set: {
              status: sql`excluded.status`,
              sm8Active: sql`excluded.sm8_active`,
              generatedJobId: sql`excluded.generated_job_id`,
              jobAddress: sql`excluded.job_address`,
              jobDescription: sql`excluded.job_description`,
              companyUuid: sql`excluded.company_uuid`,
              totalInvoiceAmount: sql`excluded.total_invoice_amount`,
              quoteSent: sql`excluded.quote_sent`,
              editDateRaw: sql`excluded.edit_date_raw`,
              editDateUtc: sql`excluded.edit_date_utc`,
              dateRaw: sql`excluded.date_raw`,
              quoteDateRaw: sql`excluded.quote_date_raw`,
              quoteDateUtc: sql`excluded.quote_date_utc`,
              workOrderDateRaw: sql`excluded.work_order_date_raw`,
              workOrderDateUtc: sql`excluded.work_order_date_utc`,
              completionDateRaw: sql`excluded.completion_date_raw`,
              completionDateUtc: sql`excluded.completion_date_utc`,
              unsuccessfulDateRaw: sql`excluded.unsuccessful_date_raw`,
              unsuccessfulDateUtc: sql`excluded.unsuccessful_date_utc`,
              quoteSentStampRaw: sql`excluded.quote_sent_stamp_raw`,
              quoteSentStampUtc: sql`excluded.quote_sent_stamp_utc`,
              // STICKY `lead` (Phase 14, SM8-02; research Pitfall 1): a lead-born
              // row records its provenance once, and the next poll must not
              // turn it into 'poll'. No existing row holds 'lead', so every
              // sync suite observes exactly the old behaviour. The D-06
              // attribution exclusion keys on the lead linkage, never on this
              // string.
              syncSource: sql`CASE WHEN ${quotes.syncSource} = 'lead' THEN 'lead' ELSE excluded.sync_source END`,
              updatedAt: sql`now()`,
              // chase_eligibility is DELIBERATELY ABSENT from this set.
              //
              // It is the one column on this table that holds a HUMAN decision
              // rather than mirrored ServiceM8 state. An operator who reviewed a
              // backfilled quote and marked it eligible must not have that
              // decision silently reverted to 'needs_review' by the next sync
              // touching the same job — nor, worse, the reverse: a quote the
              // operator excluded from chasing must never become eligible again
              // because ServiceM8 changed an address field (D-15).
            },
          })
          .returning({ id: quotes.id, sm8JobUuid: quotes.sm8JobUuid });
      },

      // Phase 14 (D-07). Inclusive both ends; parameterised strings.
      listActiveByDateRange: (fromYmd: string, toYmd: string) =>
        db
          .select({
            sm8JobUuid: quotes.sm8JobUuid,
            companyUuid: quotes.companyUuid,
            dateRaw: quotes.dateRaw,
            status: quotes.status,
          })
          .from(quotes)
          .where(
            and(
              eq(quotes.tenantId, tenantId),
              eq(quotes.sm8Active, true),
              isNotNull(quotes.dateRaw),
              sql`substr(${quotes.dateRaw}, 1, 10) BETWEEN ${fromYmd} AND ${toYmd}`,
            ),
          )
          .orderBy(quotes.dateRaw, quotes.sm8JobUuid),

      updateEligibilityWhereNeedsReview: async (quoteIds: readonly string[]) => {
        if (quoteIds.length === 0) return [];

        return db
          .update(quotes)
          .set({ chaseEligibility: 'eligible', updatedAt: sql`now()` })
          .where(
            // `tenantId` from the closure, ANDed with everything else — a quote
            // id belonging to another client matches nothing here no matter how
            // it reached this call.
            sql`${quotes.tenantId} = ${tenantId}
                AND ${inArray(quotes.id, [...quoteIds])}
                AND ${quotes.status} = 'Quote'
                AND ${quotes.sm8Active} = true
                AND ${quotes.chaseEligibility} = 'needs_review'`,
          )
          .returning({
            id: quotes.id,
            sm8JobUuid: quotes.sm8JobUuid,
            quoteDateUtc: quotes.quoteDateUtc,
          });
      },

      flagNeedsReviewOnReopen: async (quoteIds: readonly string[]) => {
        if (quoteIds.length === 0) return [];

        return db
          .update(quotes)
          .set({ chaseEligibility: 'needs_review', updatedAt: sql`now()` })
          .where(
            // Same shape as the forward flip, and for the same reasons: the
            // closure's tenantId is ANDed with everything, and the narrowing to
            // a live open quote means a caller who passed a won job's id gets
            // nothing rather than a re-triaged completed job.
            sql`${quotes.tenantId} = ${tenantId}
                AND ${inArray(quotes.id, [...quoteIds])}
                AND ${quotes.status} = 'Quote'
                AND ${quotes.sm8Active} = true
                AND ${quotes.chaseEligibility} = 'eligible'`,
          )
          .returning({ id: quotes.id, sm8JobUuid: quotes.sm8JobUuid });
      },
    },

    templates: {
      list: () =>
        db
          .select()
          .from(cadenceTouchTemplates)
          .where(eq(cadenceTouchTemplates.tenantId, tenantId))
          .orderBy(cadenceTouchTemplates.touchNumber),

      ensureDefaults: async (offsetDays: readonly number[]) => {
        if (offsetDays.length === 0) return [];

        return db
          .insert(cadenceTouchTemplates)
          .values(
            offsetDays.map((days, i) => ({
              tenantId,
              // Array position IS the cadence order — see the interface.
              touchNumber: i + 1,
              offsetDays: days,
              channel: 'sms',
            })),
          )
          .onConflictDoNothing({
            target: [cadenceTouchTemplates.tenantId, cadenceTouchTemplates.touchNumber],
          })
          .returning();
      },

      ensureLeadDefaults: async (rows: readonly LeadTemplateDefault[], note: string) => {
        if (rows.length === 0) return [];

        return db
          .insert(messageTemplates)
          .values(
            rows.map((row) => ({
              tenantId,
              kind: 'lead' as const,
              touchNumber: row.touchNumber,
              channel: 'sms' as const,
              version: 1,
              body: row.body,
              subject: null,
              // PRE-APPROVED by construction (D-02) — see the interface.
              approvedAt: sql`now()`,
              approvalNote: note,
            })),
          )
          // TARGETED on the kind-widened unique index — see the interface.
          .onConflictDoNothing({
            target: [
              messageTemplates.tenantId,
              messageTemplates.kind,
              messageTemplates.touchNumber,
              messageTemplates.channel,
              messageTemplates.version,
            ],
          })
          .returning();
      },

      // ── message_templates from here down. See the interface header. ────────

      latestApproved: (touchNumber: number, channel: TouchChannel) =>
        db
          .select()
          .from(messageTemplates)
          .where(
            and(
              eq(messageTemplates.tenantId, tenantId),
              // Quote wording only (Phase 13) — see the interface.
              eq(messageTemplates.kind, 'quote'),
              eq(messageTemplates.touchNumber, touchNumber),
              eq(messageTemplates.channel, channel),
              // The approval half of the rule. An unapproved version+1 sitting
              // in the table must not change what goes out — see the interface.
              isNotNull(messageTemplates.approvedAt),
            ),
          )
          // MAX(version) expressed as an ordered LIMIT 1 rather than an
          // aggregate, because the caller needs the whole ROW (id and body),
          // and `MAX(version)` would need a second query to fetch it.
          .orderBy(desc(messageTemplates.version))
          .limit(1),

      latestApprovedSet: async (channel: TouchChannel, kind: MessageTemplateKind = 'quote') => {
        const rows = await db
          .select()
          .from(messageTemplates)
          .where(
            and(
              eq(messageTemplates.tenantId, tenantId),
              // One kind's set only (Phase 13) — see the interface.
              eq(messageTemplates.kind, kind),
              eq(messageTemplates.channel, channel),
              // The approval half, identical to `latestApproved`'s — an
              // unapproved version+1 must not reach a prompt any more than it
              // may reach a customer.
              isNotNull(messageTemplates.approvedAt),
            ),
          )
          // Ascending by touch so the caller's cache prefix is stable, DESC by
          // version so the FIRST row of each touch group is the newest approved
          // one. The dedupe below depends on exactly this ordering.
          .orderBy(messageTemplates.touchNumber, desc(messageTemplates.version));

        const latest: MessageTemplate[] = [];
        for (const row of rows) {
          if (latest[latest.length - 1]?.touchNumber === row.touchNumber) continue;
          latest.push(row);
        }
        return latest;
      },

      insertVersion: (row: TemplateVersionInsert) => {
        const kind: MessageTemplateKind = row.kind ?? 'quote';
        return db
          .insert(messageTemplates)
          .values({
            tenantId,
            kind,
            touchNumber: row.touchNumber,
            channel: row.channel,
            body: row.body,
            subject: row.subject ?? null,
            // COMPUTED INSIDE THE INSERT — see the interface comment. Written as
            // a correlated sub-select against this same table, which Postgres
            // evaluates against the pre-statement snapshot: two concurrent saves
            // therefore compute the SAME next version and one loses on the
            // unique index, rather than both silently succeeding.
            version: sql<number>`(
              SELECT COALESCE(MAX(${messageTemplates.version}), 0) + 1
              FROM ${messageTemplates}
              WHERE ${messageTemplates.tenantId} = ${tenantId}
                AND ${messageTemplates.kind} = ${kind}
                AND ${messageTemplates.touchNumber} = ${row.touchNumber}
                AND ${messageTemplates.channel} = ${row.channel}
            )`,
            // `approved_at` and `approval_note` are deliberately ABSENT: a save
            // is not an attestation. See the interface comment.
          })
          .returning();
      },

      approveWhereUnapproved: (versionId: string, note: string, at: Date) =>
        db
          .update(messageTemplates)
          .set({ approvedAt: at, approvalNote: note })
          .where(
            and(
              eq(messageTemplates.tenantId, tenantId),
              eq(messageTemplates.id, versionId),
              // THE WRITE-ONCE GUARD (D-06). See the interface comment.
              isNull(messageTemplates.approvedAt),
            ),
          )
          .returning(),

      listVersions: (touchNumber?: number, channel?: TouchChannel) =>
        db
          .select()
          .from(messageTemplates)
          .where(
            and(
              eq(messageTemplates.tenantId, tenantId),
              // Quote wording only (Phase 13) — see the interface.
              eq(messageTemplates.kind, 'quote'),
              touchNumber === undefined
                ? undefined
                : eq(messageTemplates.touchNumber, touchNumber),
              channel === undefined ? undefined : eq(messageTemplates.channel, channel),
            ),
          )
          .orderBy(
            messageTemplates.touchNumber,
            messageTemplates.channel,
            desc(messageTemplates.version),
          ),

      approvedSetStatus: () =>
        db
          .select({
            touchNumber: cadenceTouchTemplates.touchNumber,
            // `.mapWith(Boolean)` because drizzle types a bare `exists()` as
            // `SQL<unknown>` and the driver's answer would arrive un-narrowed —
            // and an `unknown` flowing into `hasApprovedTemplateSet` is a
            // truthiness test on whatever pg returned, which is how the string
            // 'false' becomes an approved template set.
            approved: exists(
              db
                .select({ one: sql`1` })
                .from(messageTemplates)
                .where(
                  and(
                    eq(messageTemplates.tenantId, tenantId),
                    // CORRELATED on the timing row's touch number — this is what
                    // makes the answer "every touch that will be sent", rather
                    // than "every wording that happens to exist".
                    eq(messageTemplates.touchNumber, cadenceTouchTemplates.touchNumber),
                    // THE VACUOUS-TRUTH TRAP (Phase 13, research Pitfall 2).
                    // Lead defaults for touches 2 and 3 are seeded PRE-APPROVED;
                    // without this predicate they would answer "approved" for
                    // the quote cadence's touches 2 and 3, the onboarding gate
                    // would read complete, and born-paused quote cadences would
                    // resume onto wording nobody approved for a quote.
                    eq(messageTemplates.kind, 'quote'),
                    eq(messageTemplates.channel, 'sms'),
                    isNotNull(messageTemplates.approvedAt),
                  ),
                ),
            ).mapWith(Boolean),
          })
          .from(cadenceTouchTemplates)
          .where(
            and(
              eq(cadenceTouchTemplates.tenantId, tenantId),
              // D-04: SMS only. See the interface comment.
              eq(cadenceTouchTemplates.channel, 'sms'),
            ),
          )
          .orderBy(cadenceTouchTemplates.touchNumber),
    },

    drafts: {
      insertAttempt: (row: TouchDraftInsert) =>
        db
          .insert(touchDrafts)
          .values({ ...row, tenantId })
          .returning(),

      approvedFinalBody: async (touchId: string) => {
        const rows = await db
          .select({ finalBody: touchDrafts.finalBody })
          .from(touchDrafts)
          .where(
            and(
              eq(touchDrafts.tenantId, tenantId),
              eq(touchDrafts.touchId, touchId),
              eq(touchDrafts.status, 'approved'),
            ),
          )
          .limit(1);

        // `null`, not `''`. An empty string is a body, and dispatch would send
        // it; the absence of an approved draft is a refusal (D-10).
        return rows[0]?.finalBody ?? null;
      },

      approve: (
        draftId: string,
        patch: { finalBody: string; editDistance: string; approvedAt: Date },
      ) =>
        db
          .update(touchDrafts)
          .set({
            status: 'approved',
            finalBody: patch.finalBody,
            editDistance: patch.editDistance,
            approvedAt: patch.approvedAt,
          })
          .where(
            and(
              eq(touchDrafts.tenantId, tenantId),
              eq(touchDrafts.id, draftId),
              // Write-once: an already-approved row is not re-approved, so the
              // recorded `approved_at` stays the moment the human actually acted.
              ne(touchDrafts.status, 'approved'),
            ),
          )
          .returning(),

      latestForTouch: (touchId: string) =>
        db
          .select()
          .from(touchDrafts)
          .where(
            and(eq(touchDrafts.tenantId, tenantId), eq(touchDrafts.touchId, touchId)),
          )
          // A TOTAL ORDER, not just `attempt`. `touch_drafts_touch_attempt_uniq`
          // should make an `attempt` tie impossible, but this query and the quote
          // page's own ordering are what have to AGREE about which row is
          // "latest" — and if they ever disagree the approve action refuses a
          // draft the page is rendering, on every tap, forever ("reload the page
          // to see it", showing the same row again). Two independent guarantees
          // for a failure whose symptom is an unapprovable touch is the right
          // number; leaving the tie-break to the planner's row order is not.
          .orderBy(desc(touchDrafts.attempt), desc(touchDrafts.createdAt), desc(touchDrafts.id)),

      markSuperseded: (draftId: string) =>
        db
          .update(touchDrafts)
          .set({ status: 'superseded' })
          .where(
            and(
              eq(touchDrafts.tenantId, tenantId),
              eq(touchDrafts.id, draftId),
              // ONLY a rejected attempt — see the interface comment.
              eq(touchDrafts.status, 'validator_failed'),
            ),
          )
          .returning(),

      sentBodiesForCadence: async (cadenceId: string) => {
        const rows = await db
          .select({ finalBody: touchDrafts.finalBody })
          .from(touchDrafts)
          .where(
            and(
              eq(touchDrafts.tenantId, tenantId),
              eq(touchDrafts.cadenceId, cadenceId),
              eq(touchDrafts.status, 'approved'),
              // A SUBQUERY rather than a join, for the reason the evidence
              // tables give everywhere else: `touch_drafts` has no foreign key
              // to `cadence_touches` and must not start behaving as though it
              // did. This asks a question ABOUT the touch; it does not return
              // any of its columns, so nothing here can drift into reading the
              // touch row.
              inArray(
                touchDrafts.touchId,
                db
                  .select({ id: cadenceTouches.id })
                  .from(cadenceTouches)
                  .where(
                    and(
                      eq(cadenceTouches.tenantId, tenantId),
                      eq(cadenceTouches.cadenceId, cadenceId),
                      // SENT. See the interface comment — approved-not-yet-sent
                      // is a message the customer has not read.
                      eq(cadenceTouches.status, 'sent'),
                    ),
                  ),
              ),
            ),
          )
          // The draft's own denormalized touch number, so the ordering needs
          // nothing from the subquery.
          .orderBy(touchDrafts.touchNumber);

        return rows.map((row) => row.finalBody);
      },
    },

    settings: {
      get: () =>
        db.select().from(cadenceSettings).where(eq(cadenceSettings.tenantId, tenantId)),

      ensure: async () => {
        // Insert-then-select rather than an upsert with RETURNING: an upsert
        // that DID something would have to choose what to overwrite, and the
        // answer is nothing — this row holds the operator's own configuration.
        // DO NOTHING plus a read is the honest shape for "make sure it exists".
        await db
          .insert(cadenceSettings)
          .values({ tenantId })
          .onConflictDoNothing({ target: cadenceSettings.tenantId });

        const [row] = await db
          .select()
          .from(cadenceSettings)
          .where(eq(cadenceSettings.tenantId, tenantId));

        if (!row) {
          // Unreachable unless the row was deleted between the two statements,
          // which no code path does. Loud rather than a silent `undefined` that
          // would surface as a null-property read three layers up.
          throw new Error(
            `forTenant().settings.ensure() found no row after insert for tenant ${tenantId}.`,
          );
        }
        return row;
      },

      setPausedAt: (pausedAt: Date | null) =>
        db
          .update(cadenceSettings)
          .set({ pausedAt, updatedAt: sql`now()` })
          .where(eq(cadenceSettings.tenantId, tenantId))
          .returning(),

      updateVoiceProfile: (patch: VoiceProfilePatch) =>
        db
          .insert(cadenceSettings)
          .values({ tenantId, ...patch })
          .onConflictDoUpdate({
            target: cadenceSettings.tenantId,
            // NAMED, NOT SPREAD. Six columns, all of them voice, and neither
            // `paused_at` nor `preferred_send_time` appears — writing a voice
            // profile must not be able to lift a client's D-06 pause.
            set: {
              greetingStyle: patch.greetingStyle,
              signOff: patch.signOff,
              formality: patch.formality,
              bannedPhrases: patch.bannedPhrases,
              exampleMessages: patch.exampleMessages,
              voiceNotes: patch.voiceNotes,
              updatedAt: sql`now()`,
            },
          })
          .returning(),
    },

    cadences: {
      create: (values: CadenceCreate) =>
        db
          .insert(cadences)
          .values({ ...values, tenantId })
          // TARGETLESS ON PURPOSE, AND THIS IS THE LOAD-BEARING LINE (G-3-2).
          //
          // Three unique indexes now guard creation:
          // `cadences_one_live_per_quote` and `cadences_one_live_per_job` (never
          // two LIVE cadences for one quote row, and never two for one
          // ServiceM8 job even across a mirror rebuild — concurrency), and
          // `cadences_one_per_opened_event` (never two cadences from the SAME
          // consumed event — replay). Naming an arbiter picks ONE of them: a
          // conflict on the other would raise 23505 instead of returning zero
          // rows, and `consume-events` reads a throw as a blocked run — which
          // holds the SHARED cursor for every tenant, forever. Targetless
          // `ON CONFLICT DO NOTHING` no-ops on ANY unique violation.
          //
          // Zero rows returned therefore means: a live cadence already exists
          // for this quote or for this ServiceM8 job, OR this exact event
          // already produced its cadence (whatever status it has since
          // reached). Either way, you are the replay.
          //
          // ── THE CONSTRAINT SET IS PART OF THIS STATEMENT'S CONTRACT (WR-06) ─
          //
          // "Either way" is true of the arbiters that exist today and becomes
          // FALSE the moment a fourth is added. Targetless means this absorbs
          // every unique index, unique constraint, exclusion constraint and the
          // primary key on `cadences` — so a new unique index (say
          // `(tenant_id, quote_id, touch_generation)` in Phase 4 or 7) would be
          // swallowed here: zero rows, `createCadenceForQuoteOpened` returns
          // 'replayed', the event is consumed, and NO CADENCE EXISTS. A quote
          // that is never chased, with no error and no counter.
          //
          // ADDING A UNIQUE INDEX TO `cadences` THEREFORE REQUIRES A DECISION
          // ABOUT THIS BRANCH, not just a migration. `tests/rls-coverage.test.ts`
          // pins the arbiter set against the migrated database so the decision
          // is forced rather than remembered.
          //
          // THE FOURTH ARBITER, AND THE DECISION (Phase 12, migration 0039):
          // `cadences_one_live_per_lead` on `(lead_id) WHERE lead_id IS NOT
          // NULL AND status IN ('active','paused')`. It CANNOT fire here: this
          // statement only ever creates quote cadences, every quote row has
          // `lead_id` NULL (`cadences_kind_identity`), and the index excludes
          // NULL keys by its own predicate. So "zero rows" keeps exactly the
          // meaning above. Lead cadences are created by `createLead`, which
          // names that index as its arbiter — the opposite choice, made there
          // because a lead conflict on any OTHER index is a bug to surface.
          //
          // (The primary key is guarded only by `CadenceCreate` omitting `id` —
          // TypeScript-only enforcement, the same shape as the hole CR-01 closed
          // for `created_by_event_id`. It stays that way because a random uuid
          // collision is not a failure mode worth designing against.)
          .onConflictDoNothing()
          .returning(),

      createLead: (values: LeadCadenceCreate) =>
        db
          .insert(cadences)
          .values({
            tenantId,
            kind: 'lead',
            leadId: values.leadId,
            quoteId: null,
            sm8JobUuid: null,
            contactMobile: values.contactMobile,
            anchorAt: values.anchorAt,
          })
          // TARGETED on the partial index — see the interface. The `where`
          // must repeat the index predicate for Postgres to infer it.
          .onConflictDoNothing({
            target: cadences.leadId,
            where: sql`lead_id IS NOT NULL AND status IN ('active', 'paused')`,
          })
          .returning(),

      liveQuoteCadenceForMobile: (contactMobile: string) =>
        db
          .select()
          .from(cadences)
          .where(
            and(
              eq(cadences.tenantId, tenantId),
              eq(cadences.kind, 'quote'),
              eq(cadences.contactMobile, contactMobile),
              inArray(cadences.status, [...LIVE_CADENCE_STATUSES]),
            ),
          )
          .orderBy(desc(cadences.createdAt), desc(cadences.id))
          .limit(1),

      liveForLead: (leadId: string) =>
        db
          .select()
          .from(cadences)
          .where(
            and(
              eq(cadences.tenantId, tenantId),
              eq(cadences.kind, 'lead'),
              eq(cadences.leadId, leadId),
              inArray(cadences.status, [...LIVE_CADENCE_STATUSES]),
            ),
          )
          .limit(1),

      getByQuoteId: (quoteId: string) =>
        db
          .select()
          .from(cadences)
          .where(and(eq(cadences.tenantId, tenantId), eq(cadences.quoteId, quoteId)))
          .orderBy(sql`${cadences.createdAt} DESC`),

      getById: (cadenceId: string) =>
        db
          .select()
          .from(cadences)
          .where(and(eq(cadences.tenantId, tenantId), eq(cadences.id, cadenceId))),

      listLive: (kind: CadenceKind = 'quote') =>
        db
          .select()
          .from(cadences)
          .where(
            and(
              eq(cadences.tenantId, tenantId),
              inArray(cadences.status, [...LIVE_CADENCE_STATUSES]),
              // D-19 — see the interface. The default is `'quote'`.
              eq(cadences.kind, kind),
            ),
          )
          .orderBy(cadences.createdAt),

      stopWhereLive: async (
        cadenceIds: readonly string[],
        stopReason: CadenceStopReason,
      ) => {
        if (cadenceIds.length === 0) return [];

        return db
          .update(cadences)
          .set({
            status: 'stopped',
            stopReason,
            // A stop clears the pause: "paused, and also stopped" is a state
            // with two answers to "why is nothing being sent".
            pauseReason: null,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(cadences.tenantId, tenantId),
              inArray(cadences.id, [...cadenceIds]),
              inArray(cadences.status, [...LIVE_CADENCE_STATUSES]),
            ),
          )
          .returning();
      },

      stopWhereLiveByQuoteIds: async (
        quoteIds: readonly string[],
        stopReason: CadenceStopReason,
      ) => {
        if (quoteIds.length === 0) return [];

        return db
          .update(cadences)
          .set({
            status: 'stopped',
            stopReason,
            pauseReason: null,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(cadences.tenantId, tenantId),
              inArray(cadences.quoteId, [...quoteIds]),
              inArray(cadences.status, [...LIVE_CADENCE_STATUSES]),
            ),
          )
          .returning();
      },

      pauseWhereActive: async (
        cadenceIds: readonly string[],
        pauseReason: CadencePauseReason,
      ) => {
        if (cadenceIds.length === 0) return [];

        return db
          .update(cadences)
          .set({ status: 'paused', pauseReason, updatedAt: sql`now()` })
          .where(
            and(
              eq(cadences.tenantId, tenantId),
              inArray(cadences.id, [...cadenceIds]),
              // Only from 'active'. Re-pausing an already-paused cadence would
              // overwrite `customer_reply` with `client_paused` and quietly
              // convert a pause only a human may lift into one a client can.
              eq(cadences.status, 'active'),
            ),
          )
          .returning();
      },

      upgradePauseReason: async (
        cadenceIds: readonly string[],
        change: { from: CadencePauseReason | null; to: UpgradablePauseReason },
      ) => {
        if (cadenceIds.length === 0) return [];

        return db
          .update(cadences)
          // The STATUS IS NOT IN THE SET CLAUSE. This write changes why a
          // cadence is paused and nothing else; a `status` here would make it
          // possible for an upgrade to also move a cadence, which is the one
          // thing a customer writing back must never do.
          .set({ pauseReason: change.to, updatedAt: sql`now()` })
          .where(
            and(
              eq(cadences.tenantId, tenantId),
              inArray(cadences.id, [...cadenceIds]),
              // An active cadence has no pause to upgrade and a terminal one
              // must never be relabelled — see the interface comment.
              eq(cadences.status, 'paused'),
              // THE REASON PREDICATE IS THE GUARD. `isNull` rather than
              // `eq(col, null)`: drizzle renders `= NULL`, which matches
              // nothing, so the note-6 row would be skipped in silence.
              change.from === null
                ? isNull(cadences.pauseReason)
                : eq(cadences.pauseReason, change.from),
            ),
          )
          .returning({ id: cadences.id });
      },

      resumeWherePaused: async (
        cadenceIds: readonly string[],
        expectedPauseReason: CadencePauseReason,
      ) => {
        if (cadenceIds.length === 0) return [];

        return db
          .update(cadences)
          .set({ status: 'active', pauseReason: null, updatedAt: sql`now()` })
          .where(
            and(
              eq(cadences.tenantId, tenantId),
              inArray(cadences.id, [...cadenceIds]),
              eq(cadences.status, 'paused'),
              // THE D-05/D-06 ASYMMETRY. See the interface comment.
              eq(cadences.pauseReason, expectedPauseReason),
            ),
          )
          .returning();
      },

      operatorResumeWherePaused: async (cadenceIds: readonly string[]) => {
        if (cadenceIds.length === 0) return [];

        return db
          .update(cadences)
          .set({ status: 'active', pauseReason: null, updatedAt: sql`now()` })
          .where(
            and(
              eq(cadences.tenantId, tenantId),
              inArray(cadences.id, [...cadenceIds]),
              // No EQUALITY predicate on `pause_reason`: the operator's resume
              // is the explicit human act D-05 reserves, and it must reach a
              // `customer_reply` pause, a `client_paused` one, and a paused row
              // whose reason is NULL alike.
              eq(cadences.status, 'paused'),
              // THE ONE EXCLUSION (ONB-03 / T-5-10). `IS DISTINCT FROM` is
              // load-bearing: `<>` would be NULL for the null-reason row and
              // quietly drop it. See the interface comment.
              sql`${cadences.pauseReason} IS DISTINCT FROM ${ONBOARDING_PAUSE_REASON}`,
            ),
          )
          .returning();
      },

      completeWhereAllTouchesDone: async () => {
        return db
          .update(cadences)
          .set({ status: 'completed', updatedAt: sql`now()` })
          .where(
            and(
              eq(cadences.tenantId, tenantId),
              // NOT `LIVE_CADENCE_STATUSES` — a paused cadence stays paused.
              // See the interface comment; this asymmetry is the matrix's.
              eq(cadences.status, 'active'),
              // Has at least one touch: "all terminal" is vacuously true of a
              // cadence with none, and that row is un-materialized, not done.
              //
              // Built with the query builder rather than a `sql` template so
              // the status vocabulary routes through the COLUMN's own mapper —
              // the same trap `promoteDue` documents, where a hand-written
              // `NOT IN ${array}` binds one array parameter instead of a tuple
              // and matches nothing.
              exists(
                db
                  .select({ one: sql`1` })
                  .from(cadenceTouches)
                  .where(
                    and(
                      eq(cadenceTouches.cadenceId, cadences.id),
                      eq(cadenceTouches.tenantId, cadences.tenantId),
                    ),
                  ),
              ),
              // ...and not one of them is still live.
              notExists(
                db
                  .select({ one: sql`1` })
                  .from(cadenceTouches)
                  .where(
                    and(
                      eq(cadenceTouches.cadenceId, cadences.id),
                      eq(cadenceTouches.tenantId, cadences.tenantId),
                      notInArray(cadenceTouches.status, [...TERMINAL_TOUCH_STATUSES]),
                    ),
                  ),
              ),
            ),
          )
          .returning();
      },

      markExpired: async (cadenceIds: readonly string[]) => {
        if (cadenceIds.length === 0) return [];

        return db
          .update(cadences)
          .set({ status: 'expired', updatedAt: sql`now()` })
          .where(
            and(
              eq(cadences.tenantId, tenantId),
              inArray(cadences.id, [...cadenceIds]),
              inArray(cadences.status, [...LIVE_CADENCE_STATUSES]),
            ),
          )
          .returning();
      },
    },

    touches: {
      insertMany: async (rows: CadenceTouchInsert[]) => {
        if (rows.length === 0) return [];

        return db
          .insert(cadenceTouches)
          .values(rows.map((row) => ({ ...row, tenantId })))
          // Materialization is driven by a replayable event stream, so running
          // it twice must produce one schedule rather than two.
          .onConflictDoNothing({
            target: [cadenceTouches.cadenceId, cadenceTouches.touchNumber],
          })
          .returning();
      },

      listForCadence: (cadenceId: string) =>
        db
          .select()
          .from(cadenceTouches)
          .where(
            and(
              eq(cadenceTouches.tenantId, tenantId),
              eq(cadenceTouches.cadenceId, cadenceId),
            ),
          )
          .orderBy(cadenceTouches.touchNumber),

      listUnsentForCadence: (cadenceId: string) =>
        db
          .select()
          .from(cadenceTouches)
          .where(
            and(
              eq(cadenceTouches.tenantId, tenantId),
              eq(cadenceTouches.cadenceId, cadenceId),
              notInArray(cadenceTouches.status, [...TERMINAL_TOUCH_STATUSES]),
            ),
          )
          .orderBy(cadenceTouches.touchNumber),

      reschedule: (touchId: string, scheduledAt: Date) =>
        db
          .update(cadenceTouches)
          .set({ scheduledAt, updatedAt: sql`now()` })
          .where(
            and(
              eq(cadenceTouches.tenantId, tenantId),
              eq(cadenceTouches.id, touchId),
              // Rescheduling a `sent` touch would claim the message had not
              // gone out; rescheduling a `skipped` one would silently un-skip a
              // decision the min-gap or staleness rule already made.
              notInArray(cadenceTouches.status, [...TERMINAL_TOUCH_STATUSES]),
            ),
          )
          .returning(),

      promoteDue: (now: Date, leadMs: number) => {
        const dueBefore = new Date(now.getTime() + leadMs);

        return db
          .update(cadenceTouches)
          // `needs_draft`, NOT `approved` — see PROMOTABLE_TOUCH_STATUSES.
          .set({ status: 'needs_draft', updatedAt: sql`now()` })
          .where(
            and(
              eq(cadenceTouches.tenantId, tenantId),
              inArray(cadenceTouches.status, [...PROMOTABLE_TOUCH_STATUSES]),
              // `lte(...)`, NOT sql`${col} <= ${date}`. A raw Date interpolated
              // into a sql template is bound as an untyped parameter and the
              // postgres.js driver throws at Bind time ("The string argument
              // must be of type string… Received an instance of Date"). The
              // operator helpers route the value through the COLUMN's own
              // mapper, which is what knows this is a timestamptz. Nothing in
              // the type system distinguishes the two forms — it fails only
              // when the query actually runs.
              lte(cadenceTouches.scheduledAt, dueBefore),
              // The cadence must still be ACTIVE. A subquery rather than a
              // join because Postgres evaluates it inside the same statement
              // that performs the update — a paused cadence cannot be promoted
              // by a tick that read its status a moment before the pause landed.
              //
              // BOTH KINDS (Phase 13, D-01). Phase 12 held lead cadences out
              // here with a `kind = 'quote'` predicate (D-19) because nothing
              // downstream could draft or dispatch a lead touch. Drafting now
              // branches on the cadence's kind and `dispatchOne`'s FIRST statement
              // is the lead branch, so promotion is kind-blind: `scheduled →
              // needs_draft` inside the same draft lead time for both kinds.
              sql`${cadenceTouches.cadenceId} IN (
                    SELECT ${cadences.id} FROM ${cadences}
                     WHERE ${cadences.tenantId} = ${tenantId}
                       AND ${cadences.status} = 'active'
                  )`,
            ),
          )
          .returning();
      },

      listNeedsDraft: (limit: number) =>
        db
          .select()
          .from(cadenceTouches)
          .where(
            and(
              eq(cadenceTouches.tenantId, tenantId),
              eq(cadenceTouches.status, 'needs_draft'),
              // The same active-cadence subquery `promoteDue` uses, verbatim in
              // shape: a cadence paused since the promotion must not be drafted
              // for, and expressing it as a subquery keeps the tenant predicate
              // on BOTH sides of the comparison. Both kinds, for the reason
              // `promoteDue` gives (Phase 13, D-01): `draftTouches` chooses the
              // template set, the facts and the instructions by the cadence's kind.
              sql`${cadenceTouches.cadenceId} IN (
                    SELECT ${cadences.id} FROM ${cadences}
                     WHERE ${cadences.tenantId} = ${tenantId}
                       AND ${cadences.status} = 'active'
                  )`,
              // THE CAP LIVES IN THE PREDICATE, exactly as `listUnclassified`
              // puts `classify_attempts < MAX_CLASSIFY_ATTEMPTS` in its own: the
              // burn it bounds is the cross-tick one, and a caller-side check
              // would still have spent the model call to discover it.
              lt(cadenceTouches.draftFailures, MAX_DRAFT_FAILURES),
            ),
          )
          // `claimDue`'s tie-break, mirrored deliberately — see the interface.
          .orderBy(cadenceTouches.scheduledAt, cadenceTouches.id)
          .limit(limit),

      claimForDrafting: async (
        touchIds: readonly string[],
        now: Date,
        staleBefore: Date,
      ) => {
        if (touchIds.length === 0) return [];
        return await db
          .update(cadenceTouches)
          .set({ draftingStartedAt: now, updatedAt: now })
          .where(
            and(
              eq(cadenceTouches.tenantId, tenantId),
              inArray(cadenceTouches.id, [...touchIds]),
              // Still on the drafting queue. A touch that moved between the
              // caller's read and this write is not ours to claim.
              eq(cadenceTouches.status, 'needs_draft'),
              // THE ARBITER. Under READ COMMITTED a concurrent UPDATE that
              // blocks here re-checks this predicate against the committed row,
              // sees the winner's timestamp, and drops the row from its own
              // RETURNING. See the interface comment.
              //
              // BUILDERS, NOT A `sql` TEMPLATE — the Phase 3 trap, hit again
              // here. A bare `${staleBefore}` inside sql`` interpolates a raw JS
              // Date as an untyped parameter, and postgres.js throws
              // ERR_INVALID_ARG_TYPE at Bind rather than at build time: the
              // query typechecks, lints, and passes every pure test (which fake
              // the repository), then fails on the first real connection.
              // `lt`/`isNull` route the value through the COLUMN MAPPER, which
              // is what knows a `timestamp with time zone` wants an ISO string.
              or(
                isNull(cadenceTouches.draftingStartedAt),
                lt(cadenceTouches.draftingStartedAt, staleBefore),
              ),
            ),
          )
          .returning({ id: cadenceTouches.id });
      },

      bumpDraftFailures: async (touchId: string) =>
        await db
          .update(cadenceTouches)
          .set({ draftFailures: sql`${cadenceTouches.draftFailures} + 1` })
          .where(
            and(eq(cadenceTouches.tenantId, tenantId), eq(cadenceTouches.id, touchId)),
          )
          .returning({ id: cadenceTouches.id }),

      releaseDraftingClaim: async (touchIds: readonly string[]) => {
        if (touchIds.length === 0) return [];
        return await db
          .update(cadenceTouches)
          .set({ draftingStartedAt: null })
          .where(
            and(
              eq(cadenceTouches.tenantId, tenantId),
              inArray(cadenceTouches.id, [...touchIds]),
            ),
          )
          .returning({ id: cadenceTouches.id });
      },

      claimDue: (now: Date, limit: number) =>
        db
          .select({
            id: cadenceTouches.id,
            cadenceId: cadenceTouches.cadenceId,
            // NOT NARROWED (Phase 13). Phase 12 narrowed these two to
            // `string` because its WHERE admitted quote cadences only. Both
            // kinds are claimed now, and a lead row carries NULL in both
            // (the kind-identity CHECK), so they are typed as they are
            // stored. `kind` and `leadId` ride along so `dispatchOne` can
            // switch on the kind BEFORE any quote mirror read.
            quoteId: cadences.quoteId,
            sm8JobUuid: cadences.sm8JobUuid,
            // Typed by the kind CHECK on this table (it admits exactly
            // CADENCE_KINDS), the narrowing the column type cannot express.
            kind: sql<CadenceKind>`${cadences.kind}`,
            leadId: cadences.leadId,
            touchNumber: cadenceTouches.touchNumber,
            channel: cadenceTouches.channel,
            scheduledAt: cadenceTouches.scheduledAt,
            contactName: cadences.contactName,
            contactMobile: cadences.contactMobile,
            contactEmail: cadences.contactEmail,
          })
          .from(cadenceTouches)
          .innerJoin(cadences, eq(cadences.id, cadenceTouches.cadenceId))
          .where(
            and(
              eq(cadenceTouches.tenantId, tenantId),
              // BOTH SIDES OF THE JOIN CARRY THE TENANT, as they do in
              // `completeWhereAllTouchesDone` and `promoteDue`. Nothing at the
              // schema layer enforces `cadence_touches.tenant_id =
              // cadences.tenant_id` — neither column has a `.references()`, for
              // reasons documented on `cadences` — so without this predicate the
              // only thing standing between a mis-set `tenant_id` and one
              // tenant's dispatcher reading another tenant's `contact_mobile`
              // straight into a SendRequest is that every writer happens to take
              // the value from the same closure. Free: `cadences` is already
              // joined and indexed on (tenant_id, status).
              eq(cadences.tenantId, tenantId),
              // Only `approved`. The D-14 gates are auto-passed by `promoteDue`
              // in Phase 3 and become real gates in Phases 5/6 — dispatch reads
              // the same column either way and needs no edit.
              eq(cadenceTouches.status, 'approved'),
              // `lte(...)`, NOT a sql template with a raw Date in it — see the
              // note on `promoteDue`, which this repeats because the failure is
              // invisible to typecheck and lint both.
              lte(cadenceTouches.scheduledAt, now),
              eq(cadences.status, 'active'),
              // BOTH KINDS (Phase 13, D-01). Phase 12's `kind = 'quote'`
              // predicate is gone: `dispatchOne` switches on `touch.kind` as
              // its first statement, so a lead touch never reaches the quote
              // mirror read whose failure arm is the irreversible
              // `mirror_missing` stop.
            ),
          )
          .orderBy(cadenceTouches.scheduledAt, cadenceTouches.id)
          .limit(limit)
          .for('update', { of: cadenceTouches, skipLocked: true }),

      markPendingApproval: async (touchIds: readonly string[]) => {
        if (touchIds.length === 0) return [];

        return db
          .update(cadenceTouches)
          .set({ status: 'pending_approval', updatedAt: sql`now()` })
          .where(
            and(
              eq(cadenceTouches.tenantId, tenantId),
              inArray(cadenceTouches.id, [...touchIds]),
              // The guard is EQUALITY on the source status, not merely
              // "not terminal": a late draft must not drag an already-approved
              // touch backwards out of the queue a human already cleared.
              eq(cadenceTouches.status, 'needs_draft'),
            ),
          )
          .returning();
      },

      /**
       * THE OPERATOR'S OWN SKIP (CON-01, D-02) — terminal, per touch, guarded on
       * the two statuses that mean "still waiting on a human".
       *
       * ┌────────────────────────────────────────────────────────────────────┐
       * │ THIS IS NOT `skipWhere` WITH A DIFFERENT REASON, AND IT MUST NEVER │
       * │ BECOME IT. `skipWhere` is guarded `notInArray(TERMINAL_…)`, which  │
       * │ is right for the ENGINE's skips (a rule fires against whatever the │
       * │ touch happens to be) and wrong for a HUMAN's: `approved` is not    │
       * │ terminal, so a queue card rendered ninety seconds ago could skip a │
       * │ touch a colleague approved in between — silently un-approving a    │
       * │ message somebody had already read and cleared.                     │
       * └────────────────────────────────────────────────────────────────────┘
       *
       * So the guard is EQUALITY on the SOURCE statuses, exactly as
       * `markPendingApproval` and `approveWhere` are: `markPendingApproval`
       * refuses to drag an approved touch backwards, `approveWhere` refuses to
       * approve anything that is not pending, and this refuses to skip anything
       * that is not still unapproved. Same rationale, one status sideways.
       *
       * The reason is written HERE rather than taken as a parameter. That makes
       * the method mean one thing — a person decided this particular message
       * would not send — and makes it impossible for a caller to record an
       * engine rule's vocabulary through the human-guarded write. Phase 7 reads
       * the difference between "a rule skipped it" and "the operator did".
       *
       * ZERO ROWS IS AN ANSWER, NOT A FAILURE. The caller re-reads the touch
       * and reports what is actually true ("This one was already approved.")
       * rather than pretending the skip landed.
       */
      skipPendingWhere: async (touchIds: readonly string[]) => {
        if (touchIds.length === 0) return [];

        return db
          .update(cadenceTouches)
          .set({
            status: 'skipped',
            skipReason: 'operator_skipped',
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(cadenceTouches.tenantId, tenantId),
              inArray(cadenceTouches.id, [...touchIds]),
              inArray(cadenceTouches.status, [...STALLABLE_TOUCH_STATUSES]),
            ),
          )
          .returning();
      },

      /**
       * The honest re-read behind a zero-row write: what IS this touch now?
       *
       * Two columns and nothing else — no body, no contact, no slot. The only
       * question it answers is which sentence the operator should read when the
       * card they tapped had already moved underneath them.
       */
      statusOf: async (touchId: string) => {
        const [row] = await db
          .select({ status: cadenceTouches.status, skipReason: cadenceTouches.skipReason })
          .from(cadenceTouches)
          .where(and(eq(cadenceTouches.tenantId, tenantId), eq(cadenceTouches.id, touchId)))
          .limit(1);
        return row ?? null;
      },

      approveWhere: async (touchIds: readonly string[]) => {
        if (touchIds.length === 0) return [];

        return db
          .update(cadenceTouches)
          .set({ status: 'approved', updatedAt: sql`now()` })
          .where(
            and(
              eq(cadenceTouches.tenantId, tenantId),
              inArray(cadenceTouches.id, [...touchIds]),
              // Same equality guard, same reason, one status later. This is the
              // ONLY statement in this file that writes `approved` (D-12).
              eq(cadenceTouches.status, 'pending_approval'),
            ),
          )
          .returning();
      },

      markSent: async (touchIds: readonly string[]) => {
        if (touchIds.length === 0) return [];

        return db
          .update(cadenceTouches)
          .set({ status: 'sent', updatedAt: sql`now()` })
          .where(
            and(
              eq(cadenceTouches.tenantId, tenantId),
              inArray(cadenceTouches.id, [...touchIds]),
              notInArray(cadenceTouches.status, [...TERMINAL_TOUCH_STATUSES]),
            ),
          )
          .returning();
      },

      skipWhere: async (touchIds: readonly string[], skipReason: TouchSkipReason) => {
        if (touchIds.length === 0) return [];

        return db
          .update(cadenceTouches)
          .set({ status: 'skipped', skipReason, updatedAt: sql`now()` })
          .where(
            and(
              eq(cadenceTouches.tenantId, tenantId),
              inArray(cadenceTouches.id, [...touchIds]),
              notInArray(cadenceTouches.status, [...TERMINAL_TOUCH_STATUSES]),
            ),
          )
          .returning();
      },

      skipUnsentForCadences: async (
        cadenceIds: readonly string[],
        skipReason: TouchSkipReason,
      ) => {
        if (cadenceIds.length === 0) return [];

        return db
          .update(cadenceTouches)
          .set({ status: 'skipped', skipReason, updatedAt: sql`now()` })
          .where(
            and(
              eq(cadenceTouches.tenantId, tenantId),
              inArray(cadenceTouches.cadenceId, [...cadenceIds]),
              notInArray(cadenceTouches.status, [...TERMINAL_TOUCH_STATUSES]),
            ),
          )
          .returning();
      },
    },

    ledger: {
      insertClaim: (row: SendLedgerClaim) =>
        db
          .insert(sendLedger)
          .values({ ...row, tenantId })
          .onConflictDoNothing({
            target: [sendLedger.cadenceId, sendLedger.touchNumber],
          })
          // `id` only: the caller's decision is binary — did I win the claim —
          // and returning the whole row invites branching on something else.
          .returning({ id: sendLedger.id }),

      setOutcome: (
        ledgerId: string,
        outcome: SendLedgerOutcome,
        providerMessageId: string | null,
      ) =>
        db
          .update(sendLedger)
          .set({ outcome, providerMessageId })
          .where(and(eq(sendLedger.tenantId, tenantId), eq(sendLedger.id, ledgerId)))
          .returning(),

      listForCadence: (cadenceId: string) =>
        db
          .select()
          .from(sendLedger)
          .where(
            and(eq(sendLedger.tenantId, tenantId), eq(sendLedger.cadenceId, cadenceId)),
          )
          .orderBy(sendLedger.claimedAt),

      // THE SELECT LIST IS THE PRIVACY BOUNDARY (T-7-15). `to_address` and
      // `provider_message_id` are absent by decision, not by oversight — see
      // the interface. Eight columns, and `LedgerTouchFields` is what says so.
      listForQuote: (quoteId: string) =>
        db
          .select({
            id: sendLedger.id,
            cadenceId: sendLedger.cadenceId,
            touchNumber: sendLedger.touchNumber,
            channel: sendLedger.channel,
            sender: sendLedger.sender,
            outcome: sendLedger.outcome,
            claimedAt: sendLedger.claimedAt,
            deliveryStatus: sendLedger.deliveryStatus,
          })
          .from(sendLedger)
          .where(and(eq(sendLedger.tenantId, tenantId), eq(sendLedger.quoteId, quoteId)))
          .orderBy(sendLedger.claimedAt, sendLedger.touchNumber),

      // THE D-02 PREDICATE IN SQL. `IS DISTINCT FROM`, never `<>` — see the
      // interface. `::int` because `COUNT()` is a bigint and postgres.js hands
      // bigints back as STRINGS: without the cast this returns '7' and every
      // arithmetic use of it silently concatenates.
      countQuotesChasedInPeriod: async (start: Date, end: Date) => {
        const [row] = await db
          .select({ n: sql<number>`COUNT(DISTINCT ${sendLedger.quoteId})::int` })
          .from(sendLedger)
          .where(
            and(
              eq(sendLedger.tenantId, tenantId),
              ne(sendLedger.sender, 'stub'),
              eq(sendLedger.outcome, 'sent'),
              sql`${sendLedger.deliveryStatus} IS DISTINCT FROM 'undelivered'`,
              gte(sendLedger.claimedAt, start),
              lt(sendLedger.claimedAt, end),
            ),
          );

        return row?.n ?? 0;
      },
    },

    inbound: {
      // Eight columns, and the four that are NOT here (`body`, `from_address`,
      // `normalized_from`, `raw_payload`) are the reason this read exists at
      // all rather than the console's. The tenant predicate is load-bearing:
      // `inbound_messages.tenant_id` is NULLABLE.
      listThreadedForQuote: (quoteId: string) =>
        db
          .select({
            id: inboundMessages.id,
            cadenceId: inboundMessages.cadenceId,
            quoteId: inboundMessages.quoteId,
            channel: inboundMessages.channel,
            label: inboundMessages.label,
            isHot: inboundMessages.isHot,
            isStop: inboundMessages.isStop,
            receivedAt: inboundMessages.receivedAt,
          })
          .from(inboundMessages)
          .where(
            and(
              eq(inboundMessages.tenantId, tenantId),
              eq(inboundMessages.quoteId, quoteId),
              // `threaded` only. An `ambiguous` row's `quote_id` is a guess.
              eq(inboundMessages.attribution, 'threaded'),
            ),
          )
          .orderBy(inboundMessages.receivedAt),

      // The tenant predicate is load-bearing on a NULLABLE column — see the
      // interface. `::int` for the bigint-as-string reason above.
      countThreadedInPeriod: async (start: Date, end: Date) => {
        const [row] = await db
          .select({ n: sql<number>`COUNT(*)::int` })
          .from(inboundMessages)
          .where(
            and(
              eq(inboundMessages.tenantId, tenantId),
              eq(inboundMessages.attribution, 'threaded'),
              gte(inboundMessages.receivedAt, start),
              lt(inboundMessages.receivedAt, end),
            ),
          );

        return row?.n ?? 0;
      },

      // The one body this namespace returns — drafting's, and only drafting's.
      // See the interface. Tenant predicate load-bearing on a NULLABLE column.
      latestForLead: async (leadId: string) => {
        const [row] = await db
          .select({ body: inboundMessages.body })
          .from(inboundMessages)
          .where(
            and(
              eq(inboundMessages.tenantId, tenantId),
              eq(inboundMessages.leadId, leadId),
              eq(inboundMessages.attribution, 'threaded'),
            ),
          )
          .orderBy(desc(inboundMessages.receivedAt), desc(inboundMessages.id))
          .limit(1);

        return row?.body ?? null;
      },

      // D-11. Self-healing: a closed lead leaves the join, so no marker
      // column. Both sides carry the tenant; `inbound_messages.tenant_id` is
      // NULLABLE, so its predicate is load-bearing.
      closingLabelRowsForOpenLeads: async () => {
        const rows = await db
          .select({
            inboundMessageId: inboundMessages.id,
            leadId: leads.id,
            label: inboundMessages.label,
          })
          .from(inboundMessages)
          .innerJoin(
            leads,
            and(eq(leads.id, inboundMessages.leadId), eq(leads.tenantId, inboundMessages.tenantId)),
          )
          .where(
            and(
              eq(inboundMessages.tenantId, tenantId),
              eq(leads.tenantId, tenantId),
              inArray(inboundMessages.label, [...LEAD_CLOSING_LABELS]),
              eq(inboundMessages.labelConfidence, 'high'),
              eq(leads.status, 'open'),
            ),
          )
          .orderBy(inboundMessages.receivedAt, inboundMessages.id);

        // The IN list above is LEAD_CLOSING_LABELS, so the narrowing is the
        // predicate's, not a guess.
        return rows.map((row) => ({
          inboundMessageId: row.inboundMessageId,
          leadId: row.leadId,
          label: row.label as LeadClosingLabel,
        }));
      },

      // The ONE number-and-body read for a held escalation's release — see the
      // interface. Tenant predicate load-bearing on a NULLABLE column.
      byIdForEscalation: (inboundMessageId: string) =>
        db
          .select({
            body: inboundMessages.body,
            fromAddress: inboundMessages.fromAddress,
            cadenceId: inboundMessages.cadenceId,
            leadId: inboundMessages.leadId,
          })
          .from(inboundMessages)
          .where(
            and(eq(inboundMessages.tenantId, tenantId), eq(inboundMessages.id, inboundMessageId)),
          )
          .limit(1),
    },

    suppression: {
      insertMany: async (rows: SuppressionInsert[]) => {
        if (rows.length === 0) return 0;

        const written = await db
          .insert(suppressedContacts)
          .values(rows.map((row) => ({ ...row, tenantId })))
          // A second kill on the same contact is a no-op, not an error: the
          // operator tapping twice, or an SMS STOP arriving after a manual
          // kill, must not fail. The row already there is already correct.
          .onConflictDoNothing({
            target: [
              suppressedContacts.tenantId,
              suppressedContacts.channel,
              suppressedContacts.address,
            ],
          })
          .returning({ id: suppressedContacts.id });

        return written.length;
      },

      existsFor: async (pairs: readonly SuppressionProbe[]) => {
        if (pairs.length === 0) return [];

        const matches = await db
          .select({
            channel: suppressedContacts.channel,
            address: suppressedContacts.address,
          })
          .from(suppressedContacts)
          .where(
            and(
              eq(suppressedContacts.tenantId, tenantId),
              // An OR of exact pairs rather than two INs: `channel IN (...) AND
              // address IN (...)` would match a suppressed EMAIL address
              // against an unsuppressed MOBILE probe and refuse a send nobody
              // asked to block. The pair count here is one or two.
              or(
                ...pairs.map((pair) =>
                  and(
                    eq(suppressedContacts.channel, pair.channel),
                    eq(suppressedContacts.address, pair.address),
                  ),
                ),
              ),
            ),
          );

        return matches.map((row) => ({
          channel: row.channel as SuppressionChannel,
          address: row.address,
        }));
      },

      listAll: () =>
        db
          .select()
          .from(suppressedContacts)
          .where(eq(suppressedContacts.tenantId, tenantId))
          .orderBy(sql`${suppressedContacts.createdAt} DESC`),
    },

    attestations: {
      // INSERT, and nothing else. `attestedAt` is deliberately NOT set here —
      // the column's `defaultNow()` is what makes the moment the database's.
      append: (row: { kind: TenantAttestationKind; note: string }) =>
        db.insert(tenantAttestations).values({ tenantId, ...row }).returning(),

      latest: (kind: TenantAttestationKind) =>
        db
          .select()
          .from(tenantAttestations)
          .where(
            and(
              eq(tenantAttestations.tenantId, tenantId),
              eq(tenantAttestations.kind, kind),
            ),
          )
          // MAX(attested_at) as an ordered LIMIT 1, because the caller needs
          // the whole ROW. `id DESC` is the tiebreak: two attestations written
          // in one transaction share `now()` to the microsecond, and a stable
          // answer matters more than which of two identical instants wins.
          .orderBy(desc(tenantAttestations.attestedAt), desc(tenantAttestations.id))
          .limit(1),
    },

    proofs: {
      // INSERT, and nothing else. `recordedAt` is deliberately NOT set here —
      // the column's `defaultNow()` is what makes the moment the database's,
      // exactly as `attestations.append` above.
      append: (row: {
        kind: TenantProofKind;
        artefactId: string;
        artefactDetail: Record<string, unknown>;
        note: string;
        recordedBy: string;
      }) => db.insert(tenantProofs).values({ tenantId, ...row }).returning(),

      latest: (kind: TenantProofKind) =>
        db
          .select()
          .from(tenantProofs)
          .where(and(eq(tenantProofs.tenantId, tenantId), eq(tenantProofs.kind, kind)))
          // MAX(recorded_at) as an ordered LIMIT 1, because the caller needs the
          // whole ROW — `recorded_at` for the date on the checklist row and
          // `artefact_id` for the id beside it. `id DESC` is the tiebreak: two
          // proofs written in one transaction share `now()` to the microsecond,
          // and a stable answer matters more than which instant wins.
          .orderBy(desc(tenantProofs.recordedAt), desc(tenantProofs.id))
          .limit(1),
    },

    divertNumber: {
      get: () =>
        db.select().from(tenantDivertNumbers).where(eq(tenantDivertNumbers.tenantId, tenantId)),

      // INSERT the pending claim. A 23505 propagates — see the interface.
      claim: (row: { spokenName: string; createdBy: string }) =>
        db
          .insert(tenantDivertNumbers)
          .values({ tenantId, spokenName: row.spokenName, createdBy: row.createdBy, status: 'pending' })
          .returning(),

      activate: (row: {
        providerNumberSid: string;
        numberE164: string;
        locality: string | null;
        purchasedAt: Date;
        failureCode?: string | null;
      }) =>
        db
          .update(tenantDivertNumbers)
          .set({
            providerNumberSid: row.providerNumberSid,
            numberE164: row.numberE164,
            locality: row.locality,
            purchasedAt: row.purchasedAt,
            status: 'active',
            failureCode: row.failureCode ?? null,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(tenantDivertNumbers.tenantId, tenantId),
              inArray(tenantDivertNumbers.status, ['pending', 'failed']),
            ),
          )
          .returning(),

      fail: (row: { failureCode: string }) =>
        db
          .update(tenantDivertNumbers)
          .set({ status: 'failed', failureCode: row.failureCode, updatedAt: sql`now()` })
          .where(
            and(
              eq(tenantDivertNumbers.tenantId, tenantId),
              eq(tenantDivertNumbers.status, 'pending'),
            ),
          )
          .returning(),

      hold: (row: { failureCode: string }) =>
        db
          .update(tenantDivertNumbers)
          .set({ failureCode: row.failureCode, updatedAt: sql`now()` })
          .where(
            and(
              eq(tenantDivertNumbers.tenantId, tenantId),
              eq(tenantDivertNumbers.status, 'pending'),
            ),
          )
          .returning(),

      reclaim: (spokenName: string) =>
        db
          .update(tenantDivertNumbers)
          .set({ status: 'pending', failureCode: null, spokenName, updatedAt: sql`now()` })
          .where(
            and(
              eq(tenantDivertNumbers.tenantId, tenantId),
              eq(tenantDivertNumbers.status, 'failed'),
            ),
          )
          .returning(),

      reclaimStale: (spokenName: string, before: Date) =>
        db
          .update(tenantDivertNumbers)
          .set({ failureCode: null, spokenName, updatedAt: sql`now()` })
          .where(
            and(
              eq(tenantDivertNumbers.tenantId, tenantId),
              eq(tenantDivertNumbers.status, 'pending'),
              lt(tenantDivertNumbers.updatedAt, before),
            ),
          )
          .returning(),

      setSpokenName: (spokenName: string) =>
        db
          .update(tenantDivertNumbers)
          .set({ spokenName, updatedAt: sql`now()` })
          .where(eq(tenantDivertNumbers.tenantId, tenantId))
          .returning(),
      // NO delete, NO release — D-08. See the interface.
    },

    missedCalls: {
      latest: () =>
        db
          .select()
          .from(missedCalls)
          .where(eq(missedCalls.tenantId, tenantId))
          // `id DESC` is the tiebreak, the `proofs.latest` rule: a stable answer
          // matters more than which of two identical instants wins.
          .orderBy(desc(missedCalls.startedAt), desc(missedCalls.id))
          .limit(1),

      // BUILDERS, never a raw Date inside a sql`` template — the postgres.js
      // Bind-time trap `promoteDue` documents.
      claimForTextBack: (id: string, at: Date) =>
        db
          .update(missedCalls)
          .set({ textBackStatus: 'claimed', textBackDecidedAt: at, updatedAt: at })
          .where(
            and(
              eq(missedCalls.tenantId, tenantId),
              eq(missedCalls.id, id),
              // THE ARBITER. Under READ COMMITTED a concurrent claimant blocks
              // on the row lock, re-checks this against the committed row and
              // drops out of RETURNING.
              isNull(missedCalls.textBackStatus),
            ),
          )
          .returning({ id: missedCalls.id }),

      setTextBackDecision: (id: string, patch: TextBackDecisionPatch) =>
        db
          .update(missedCalls)
          .set(
            patch.status === 'skipped'
              ? 'route' in patch
                ? {
                    textBackStatus: 'skipped',
                    textBackSkipReason: patch.skipReason,
                    textBackRoute: patch.route,
                    cadenceId: patch.cadenceId,
                    updatedAt: sql`now()`,
                  }
                : {
                    textBackStatus: 'skipped',
                    textBackSkipReason: patch.skipReason,
                    textBackRoute: null,
                    // D-07: the ring-twice keys, only when the core passed
                    // them (an open lead's `recent_text`/`lead_open` skip).
                    // Spread, never `undefined`: a skip without them leaves
                    // both columns exactly as the row already had them.
                    ...(patch.leadId !== undefined ? { leadId: patch.leadId } : {}),
                    ...(patch.cadenceId !== undefined ? { cadenceId: patch.cadenceId } : {}),
                    updatedAt: sql`now()`,
                  }
              : {
                  textBackStatus: 'claimed',
                  textBackSkipReason: null,
                  textBackRoute: patch.route,
                  leadId: patch.leadId,
                  cadenceId: patch.cadenceId,
                  textBackLedgerId: patch.ledgerId,
                  updatedAt: sql`now()`,
                },
          )
          .where(
            and(
              eq(missedCalls.tenantId, tenantId),
              eq(missedCalls.id, id),
              // Only the claimant decides: a row is claimed before any decision.
              eq(missedCalls.textBackStatus, 'claimed'),
            ),
          )
          .returning({ id: missedCalls.id }),

      setTextBackOutcome: (id: string, status: 'sent' | 'failed', detail: string | null) =>
        db
          .update(missedCalls)
          .set({ textBackStatus: status, textBackDetail: detail, updatedAt: sql`now()` })
          .where(
            and(
              eq(missedCalls.tenantId, tenantId),
              eq(missedCalls.id, id),
              eq(missedCalls.textBackStatus, 'claimed'),
            ),
          )
          .returning({ id: missedCalls.id }),

      existsTextBackToCallerSince: async (caller: string, since: Date, excludeId: string) => {
        const rows = await db
          .select({ id: missedCalls.id })
          .from(missedCalls)
          .where(
            and(
              eq(missedCalls.tenantId, tenantId),
              eq(missedCalls.callerE164, caller),
              ne(missedCalls.id, excludeId),
              inArray(missedCalls.textBackStatus, ['claimed', 'sent']),
              gte(missedCalls.textBackDecidedAt, since),
            ),
          )
          .limit(1);
        return rows.length > 0;
      },

      countTextBacksSince: async (since: Date, excludeId: string) => {
        const [row] = await db
          // `::int` — Postgres returns count(*) as bigint, which postgres.js
          // hands back as a STRING (the `countQuotesChasedInPeriod` note).
          .select({ count: sql<number>`count(*)::int` })
          .from(missedCalls)
          .where(
            and(
              eq(missedCalls.tenantId, tenantId),
              ne(missedCalls.id, excludeId),
              inArray(missedCalls.textBackStatus, ['claimed', 'sent']),
              gte(missedCalls.textBackDecidedAt, since),
            ),
          );
        return row?.count ?? 0;
      },

      // ── THE MISSED-CALL LOG (Phase 15, D-02). See the interface. ──────────
      listForLog: (input: { before?: MissedCallLogCursor; limit: number }) => {
        const before = input.before;
        return (
          db
            .select({
              id: missedCalls.id,
              startedAt: missedCalls.startedAt,
              afterHours: missedCalls.afterHours,
              callerKind: missedCalls.callerKind,
              callerE164: missedCalls.callerE164,
              textBackStatus: missedCalls.textBackStatus,
              textBackSkipReason: missedCalls.textBackSkipReason,
              textBackRoute: missedCalls.textBackRoute,
              textBackDecidedAt: missedCalls.textBackDecidedAt,
              leadId: missedCalls.leadId,
              cadenceId: missedCalls.cadenceId,
              textBackLedgerId: missedCalls.textBackLedgerId,
              pseudonymisedAt: missedCalls.pseudonymisedAt,
              deliveryStatus: sendLedger.deliveryStatus,
              leadStatus: leads.status,
              leadClosedReason: leads.closedReason,
              quoteId: cadences.quoteId,
            })
            .from(missedCalls)
            // Every join carries the tenant on BOTH sides — the ledger join is
            // `getTextBackEvidenceForTenant`'s, the lead and cadence joins the
            // same shape.
            .leftJoin(
              sendLedger,
              and(
                eq(sendLedger.id, missedCalls.textBackLedgerId),
                eq(sendLedger.tenantId, tenantId),
              ),
            )
            .leftJoin(leads, and(eq(leads.id, missedCalls.leadId), eq(leads.tenantId, tenantId)))
            .leftJoin(
              cadences,
              and(eq(cadences.id, missedCalls.cadenceId), eq(cadences.tenantId, tenantId)),
            )
            .where(
              and(
                eq(missedCalls.tenantId, tenantId),
                // THE KEYSET: `(started_at, id) < (before.startedAt, before.id)`,
                // written with the comparison BUILDERS so the Date binds
                // through the column's own mapper (the `promoteDue` Bind-time
                // trap) — strictly older, the tie on the instant broken by id.
                before === undefined
                  ? undefined
                  : or(
                      lt(missedCalls.startedAt, before.startedAt),
                      and(eq(missedCalls.startedAt, before.startedAt), lt(missedCalls.id, before.id)),
                    ),
              ),
            )
            .orderBy(desc(missedCalls.startedAt), desc(missedCalls.id))
            .limit(input.limit)
        );
      },

      countInWindow: async (since: Date) => {
        const [row] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(missedCalls)
          .where(and(eq(missedCalls.tenantId, tenantId), gte(missedCalls.startedAt, since)));
        return row?.count ?? 0;
      },

      // ── THE PRIVACY PASS (Phase 15, D-06). See the interface. ─────────────
      listRawForLead: (leadId: string) =>
        db
          .select({
            id: missedCalls.id,
            callerE164: missedCalls.callerE164,
            callerRaw: missedCalls.callerRaw,
            forwardedFromRaw: missedCalls.forwardedFromRaw,
          })
          .from(missedCalls)
          .where(
            and(
              eq(missedCalls.tenantId, tenantId),
              eq(missedCalls.leadId, leadId),
              isNull(missedCalls.pseudonymisedAt),
            ),
          )
          .orderBy(missedCalls.startedAt, missedCalls.id),

      pseudonymise: (id: string, hashes: MissedCallHashes, at: Date) =>
        db
          .update(missedCalls)
          .set({
            callerE164: hashes.callerE164,
            callerRaw: hashes.callerRaw,
            forwardedFromRaw: hashes.forwardedFromRaw,
            pseudonymisedAt: at,
            updatedAt: at,
          })
          .where(
            and(
              eq(missedCalls.tenantId, tenantId),
              eq(missedCalls.id, id),
              // THE STAMP GUARD: a stamped row is never written again.
              isNull(missedCalls.pseudonymisedAt),
            ),
          )
          .returning({ id: missedCalls.id }),
    },

    leads: {
      openOrCreate: (row: LeadOpen) =>
        db
          .insert(leads)
          .values({
            tenantId,
            contactMobile: row.contactMobile,
            firstMissedCallId: row.firstMissedCallId,
            firstMissedAt: row.at,
            lastMissedAt: row.at,
            afterHours: row.afterHours,
          })
          // TARGETED on the partial open index: zero rows means an open lead
          // for this caller exists. A conflict on the primary key raises.
          .onConflictDoNothing({
            target: [leads.tenantId, leads.contactMobile],
            where: sql`status = 'open'`,
          })
          .returning(),

      noteRepeatCall: (contactMobile: string, at: Date) =>
        db
          .update(leads)
          .set({
            lastMissedAt: at,
            missedCallCount: sql`${leads.missedCallCount} + 1`,
            updatedAt: at,
          })
          .where(
            and(
              eq(leads.tenantId, tenantId),
              eq(leads.contactMobile, contactMobile),
              eq(leads.status, 'open'),
            ),
          )
          .returning({ id: leads.id }),

      byId: (id: string) =>
        db
          .select()
          .from(leads)
          .where(and(eq(leads.tenantId, tenantId), eq(leads.id, id))),

      latestForMobile: (contactMobile: string) =>
        db
          .select({
            status: leads.status,
            closedReason: leads.closedReason,
            closedAt: leads.closedAt,
          })
          .from(leads)
          .where(and(eq(leads.tenantId, tenantId), eq(leads.contactMobile, contactMobile)))
          // The NEWEST lead, by `leads_tenant_mobile_created_idx`; `id` breaks
          // a same-instant tie deterministically.
          .orderBy(desc(leads.createdAt), desc(leads.id))
          .limit(1),

      close: (leadId: string, reason: LeadClosedReason, at: Date) =>
        db
          .update(leads)
          .set({
            // THREE-WAY (Phase 14, D-07). The two conversion reasons make a
            // `converted` lead and nothing else does (`leads_converted_reason`,
            // `leads_conversion_reason_only_converted`); `expired` is the ONLY
            // reason an expired lead may carry, and the only reason that makes
            // one (`leads_expired_reason`); every other reason closes.
            status: (LEAD_CONVERSION_REASONS as readonly string[]).includes(reason)
              ? 'converted'
              : reason === 'expired'
                ? 'expired'
                : 'closed',
            closedReason: reason,
            closedAt: at,
            updatedAt: at,
          })
          .where(
            and(
              eq(leads.tenantId, tenantId),
              eq(leads.id, leadId),
              // THE IDEMPOTENCE GUARD: a closed lead is never re-closed and its
              // first reason is never overwritten (D-14).
              eq(leads.status, 'open'),
            ),
          )
          .returning({ id: leads.id }),

      listOpenWithEndedCadence: () =>
        db
          .select({
            leadId: leads.id,
            cadenceStatus: cadences.status,
            stopReason: cadences.stopReason,
          })
          .from(leads)
          .innerJoin(
            cadences,
            and(
              eq(cadences.leadId, leads.id),
              // Both sides of the join carry the tenant, as everywhere else.
              eq(cadences.tenantId, leads.tenantId),
              eq(cadences.kind, 'lead'),
            ),
          )
          .where(
            and(
              eq(leads.tenantId, tenantId),
              eq(leads.status, 'open'),
              inArray(cadences.status, ['completed', 'expired', 'stopped']),
            ),
          )
          .orderBy(leads.createdAt, leads.id),

      // ── Phase 14: the ServiceM8 job linkage ─────────────────────────────
      // Every predicate carries the tenant. See the interface for each.

      claimJobCreation: (leadId: string, at: Date) =>
        db
          .update(leads)
          .set({
            sm8JobState: 'creating',
            sm8JobAttemptCount: sql`${leads.sm8JobAttemptCount} + 1`,
            sm8JobAttemptedAt: at,
            sm8JobErrorKind: null,
            updatedAt: at,
          })
          .where(
            and(
              eq(leads.tenantId, tenantId),
              eq(leads.id, leadId),
              eq(leads.status, 'open'),
              // THE DOUBLE-TAP ARBITER: decided by Postgres, never check-then-act.
              inArray(leads.sm8JobState, ['none', 'failed']),
            ),
          )
          .returning({
            id: leads.id,
            sm8CompanyUuid: leads.sm8CompanyUuid,
            sm8JobUuid: leads.sm8JobUuid,
            sm8JobContactUuid: leads.sm8JobContactUuid,
            sm8JobDescriptionSha256: leads.sm8JobDescriptionSha256,
          }),

      jobStateFor: (leadId: string) =>
        db
          .select({
            status: leads.status,
            sm8JobState: leads.sm8JobState,
            sm8JobUuid: leads.sm8JobUuid,
            sm8JobErrorKind: leads.sm8JobErrorKind,
            sm8JobAttemptCount: leads.sm8JobAttemptCount,
          })
          .from(leads)
          .where(and(eq(leads.tenantId, tenantId), eq(leads.id, leadId))),

      setJobLinkage: async (leadId: string, patch: LeadJobLinkagePatch) => {
        const set: Partial<typeof leads.$inferInsert> = {};
        if (patch.companyUuid !== undefined) set.sm8CompanyUuid = patch.companyUuid;
        if (patch.jobUuid !== undefined) set.sm8JobUuid = patch.jobUuid;
        if (patch.contactUuid !== undefined) set.sm8JobContactUuid = patch.contactUuid;
        if (patch.descriptionSha256 !== undefined) {
          set.sm8JobDescriptionSha256 = patch.descriptionSha256;
        }
        if (Object.keys(set).length === 0) return [];

        return db
          .update(leads)
          .set({ ...set, updatedAt: sql`now()` })
          .where(
            and(
              eq(leads.tenantId, tenantId),
              eq(leads.id, leadId),
              eq(leads.sm8JobState, 'creating'),
            ),
          )
          .returning({ id: leads.id });
      },

      recordJobCreated: (
        leadId: string,
        input: { jobUuid: string; contactUuid: string; createdBy: string; at: Date },
      ) =>
        db
          .update(leads)
          .set({
            sm8JobState: 'created',
            sm8JobUuid: input.jobUuid,
            sm8JobContactUuid: input.contactUuid,
            sm8JobErrorKind: null,
            sm8JobCreatedAt: input.at,
            sm8JobCreatedBy: input.createdBy,
            updatedAt: input.at,
          })
          .where(
            and(
              eq(leads.tenantId, tenantId),
              eq(leads.id, leadId),
              eq(leads.sm8JobState, 'creating'),
            ),
          )
          .returning({ id: leads.id }),

      recordJobFailure: (leadId: string, kind: LeadJobErrorKind, at: Date) =>
        db
          .update(leads)
          // The uuids are KEPT: the retry reconciles on them.
          .set({ sm8JobState: 'failed', sm8JobErrorKind: kind, updatedAt: at })
          .where(
            and(
              eq(leads.tenantId, tenantId),
              eq(leads.id, leadId),
              eq(leads.sm8JobState, 'creating'),
            ),
          )
          .returning({ id: leads.id }),

      jobLinkageFor: async (leadIds: readonly string[]) => {
        if (leadIds.length === 0) return [];

        return db
          .select({
            leadId: leads.id,
            status: leads.status,
            closedReason: leads.closedReason,
            sm8JobUuid: leads.sm8JobUuid,
            sm8JobState: leads.sm8JobState,
            sm8JobErrorKind: leads.sm8JobErrorKind,
            sm8JobAttemptCount: leads.sm8JobAttemptCount,
            jobStatus: quotes.status,
            jobGeneratedId: quotes.generatedJobId,
          })
          .from(leads)
          .leftJoin(
            quotes,
            and(
              // Both sides of the join carry the tenant, as everywhere else.
              eq(quotes.tenantId, leads.tenantId),
              eq(quotes.sm8JobUuid, leads.sm8JobUuid),
            ),
          )
          .where(and(eq(leads.tenantId, tenantId), inArray(leads.id, [...leadIds])))
          .orderBy(leads.id);
      },

      jobSheetFacts: async (leadId: string) => {
        const [lead] = await db
          .select({
            id: leads.id,
            status: leads.status,
            contactMobile: leads.contactMobile,
            firstMissedAt: leads.firstMissedAt,
            afterHours: leads.afterHours,
            sm8JobState: leads.sm8JobState,
            sm8CompanyUuid: leads.sm8CompanyUuid,
            sm8JobUuid: leads.sm8JobUuid,
            sm8JobContactUuid: leads.sm8JobContactUuid,
            sm8JobErrorKind: leads.sm8JobErrorKind,
            sm8JobAttemptCount: leads.sm8JobAttemptCount,
          })
          .from(leads)
          .where(and(eq(leads.tenantId, tenantId), eq(leads.id, leadId)));
        if (lead === undefined) return null;

        const [cadence] = await db
          .select({ contactName: cadences.contactName })
          .from(cadences)
          .where(
            and(
              eq(cadences.tenantId, tenantId),
              eq(cadences.leadId, leadId),
              eq(cadences.kind, 'lead'),
            ),
          )
          .orderBy(desc(cadences.createdAt), desc(cadences.id))
          .limit(1);

        // The caller's words — see the interface for the two permitted
        // callers. Tenant predicate load-bearing on a NULLABLE column.
        const replies = await db
          .select({
            id: inboundMessages.id,
            body: inboundMessages.body,
            receivedAt: inboundMessages.receivedAt,
            urgency: inboundMessages.urgency,
          })
          .from(inboundMessages)
          .where(
            and(
              eq(inboundMessages.tenantId, tenantId),
              eq(inboundMessages.leadId, leadId),
              eq(inboundMessages.attribution, 'threaded'),
              eq(inboundMessages.isStop, false),
            ),
          )
          .orderBy(inboundMessages.receivedAt, inboundMessages.id);

        return { ...lead, contactName: cadence?.contactName ?? null, replies };
      },

      queueCards: async (leadIds: readonly string[]) => {
        if (leadIds.length === 0) return [];

        const leadRows = await db
          .select({ leadId: leads.id, contactMobile: leads.contactMobile })
          .from(leads)
          .where(and(eq(leads.tenantId, tenantId), inArray(leads.id, [...leadIds])))
          .orderBy(leads.id);
        if (leadRows.length === 0) return [];

        // The NEWEST threaded, non-STOP reply per lead — `jobSheetFacts`'s
        // predicate, one row per lead by DISTINCT ON. The caller's words: see
        // the interface for the one permitted caller. Tenant predicate
        // load-bearing on a NULLABLE column; the lead ids are the ones the
        // statement above already scoped to this tenant.
        const replies = await db
          .selectDistinctOn([inboundMessages.leadId], {
            leadId: inboundMessages.leadId,
            id: inboundMessages.id,
            body: inboundMessages.body,
            label: inboundMessages.label,
            labelConfidence: inboundMessages.labelConfidence,
            urgency: inboundMessages.urgency,
            isHot: inboundMessages.isHot,
            receivedAt: inboundMessages.receivedAt,
          })
          .from(inboundMessages)
          .where(
            and(
              eq(inboundMessages.tenantId, tenantId),
              inArray(
                inboundMessages.leadId,
                leadRows.map((row) => row.leadId),
              ),
              eq(inboundMessages.attribution, 'threaded'),
              eq(inboundMessages.isStop, false),
            ),
          )
          .orderBy(
            inboundMessages.leadId,
            desc(inboundMessages.receivedAt),
            desc(inboundMessages.id),
          );

        const newest = new Map(replies.map((row) => [row.leadId, row]));
        return leadRows.map((row) => {
          const reply = newest.get(row.leadId);
          return {
            leadId: row.leadId,
            contactMobile: row.contactMobile,
            reply:
              reply === undefined
                ? null
                : {
                    id: reply.id,
                    body: reply.body,
                    label: reply.label,
                    labelConfidence: reply.labelConfidence,
                    urgency: reply.urgency,
                    isHot: reply.isHot,
                    receivedAt: reply.receivedAt,
                  },
          };
        });
      },

      linkedToJob: (sm8JobUuid: string) =>
        db
          .select({
            leadId: leads.id,
            sm8JobState: leads.sm8JobState,
            closedReason: leads.closedReason,
          })
          .from(leads)
          .where(and(eq(leads.tenantId, tenantId), eq(leads.sm8JobUuid, sm8JobUuid)))
          .orderBy(leads.createdAt, leads.id),

      listOpenForJobMatch: () =>
        db
          .select({
            id: leads.id,
            contactMobile: leads.contactMobile,
            firstMissedAt: leads.firstMissedAt,
          })
          .from(leads)
          .where(
            and(
              eq(leads.tenantId, tenantId),
              eq(leads.status, 'open'),
              eq(leads.sm8JobState, 'none'),
            ),
          )
          .orderBy(leads.firstMissedAt, leads.id),

      setMatchedJob: (leadId: string, jobUuid: string, at: Date) =>
        db
          .update(leads)
          // State stays `none`: the partial unique is scoped to `created`.
          .set({ sm8JobUuid: jobUuid, updatedAt: at })
          .where(
            and(
              eq(leads.tenantId, tenantId),
              eq(leads.id, leadId),
              eq(leads.status, 'open'),
              eq(leads.sm8JobState, 'none'),
            ),
          )
          .returning({ id: leads.id }),

      failStaleJobClaims: (cutoff: Date, at: Date) =>
        db
          .update(leads)
          // The uuids are KEPT, as `recordJobFailure` keeps them.
          .set({ sm8JobState: 'failed', sm8JobErrorKind: 'stale_claim', updatedAt: at })
          .where(
            and(
              eq(leads.tenantId, tenantId),
              eq(leads.sm8JobState, 'creating'),
              lt(leads.sm8JobAttemptedAt, cutoff),
            ),
          )
          .returning({ id: leads.id }),

      jobUuidsLinkedAmong: async (sm8JobUuids: readonly string[]) => {
        if (sm8JobUuids.length === 0) return [];

        const rows = await db
          .selectDistinct({ sm8JobUuid: leads.sm8JobUuid })
          .from(leads)
          .where(
            and(eq(leads.tenantId, tenantId), inArray(leads.sm8JobUuid, [...sm8JobUuids])),
          );
        return rows.flatMap((row) => (row.sm8JobUuid === null ? [] : [row.sm8JobUuid]));
      },

      // ── Phase 15 (D-06): the privacy pass. See the interface. ─────────────
      pseudonymise: async (leadId: string, input: { contactHash: string; at: Date }) => {
        // The lead is THIS tenant's, NOT OPEN and UNSTAMPED — the guard on
        // every statement below. 1–3 carry it as an EXISTS on the lead row, so
        // a refused lead leaves its children untouched.
        const leadIsDue = and(
          eq(leads.tenantId, tenantId),
          eq(leads.id, leadId),
          ne(leads.status, 'open'),
          isNull(leads.pseudonymisedAt),
        );
        const dueLead = () =>
          exists(db.select({ one: sql`1` }).from(leads).where(leadIsDue));

        const inboundRows = await db
          .update(inboundMessages)
          .set({
            fromAddress: input.contactHash,
            normalizedFrom: input.contactHash,
            pseudonymisedAt: input.at,
          })
          .where(
            and(
              eq(inboundMessages.tenantId, tenantId),
              eq(inboundMessages.leadId, leadId),
              isNull(inboundMessages.pseudonymisedAt),
              dueLead(),
            ),
          )
          .returning({ id: inboundMessages.id });

        // 1b (15-REVIEW WR-01) — see the interface. Bound to THIS due lead by
        // its raw number (read before statement 4 replaces it), from its first
        // call, and up to its close + PSEUDONYMISE_AFTER_DAYS or the pass's
        // own boundary, whichever is later.
        const boundary = new Date(input.at.getTime() - PSEUDONYMISE_AFTER_DAYS * 86_400_000);
        const lateReplyOfDueLead = () =>
          exists(
            db
              .select({ one: sql`1` })
              .from(leads)
              .where(
                and(
                  leadIsDue,
                  eq(leads.contactMobile, inboundMessages.normalizedFrom),
                  gte(inboundMessages.receivedAt, leads.firstMissedAt),
                  or(
                    lte(inboundMessages.receivedAt, boundary),
                    sql`${inboundMessages.receivedAt} <= ${leads.closedAt} + make_interval(days => ${sql.raw(String(PSEUDONYMISE_AFTER_DAYS))})`,
                  ),
                ),
              ),
          );

        const lateReplyRows = await db
          .update(inboundMessages)
          .set({
            fromAddress: input.contactHash,
            normalizedFrom: input.contactHash,
            pseudonymisedAt: input.at,
          })
          .where(
            and(
              isNull(inboundMessages.tenantId),
              isNull(inboundMessages.leadId),
              isNull(inboundMessages.quoteId),
              isNull(inboundMessages.cadenceId),
              or(
                eq(inboundMessages.attribution, 'unmatched'),
                and(
                  eq(inboundMessages.attribution, 'ambiguous'),
                  sql`${tenantId}::uuid = any(${inboundMessages.candidateTenantIds})`,
                ),
              ),
              isNull(inboundMessages.pseudonymisedAt),
              lateReplyOfDueLead(),
            ),
          )
          .returning({ id: inboundMessages.id });

        const cadenceRows = await db
          .update(cadences)
          .set({ contactMobile: input.contactHash, updatedAt: input.at })
          .where(
            and(
              eq(cadences.tenantId, tenantId),
              eq(cadences.leadId, leadId),
              eq(cadences.kind, 'lead'),
              dueLead(),
            ),
          )
          .returning({ id: cadences.id });

        const ledgerRows = await db
          .update(sendLedger)
          .set({ toAddress: input.contactHash })
          .where(and(eq(sendLedger.tenantId, tenantId), eq(sendLedger.leadId, leadId), dueLead()))
          .returning({ id: sendLedger.id });

        // LAST: the hash and the stamp in ONE statement, under the same guard.
        const leadRows = await db
          .update(leads)
          .set({
            contactMobile: input.contactHash,
            pseudonymisedAt: input.at,
            updatedAt: input.at,
          })
          .where(leadIsDue)
          .returning({ id: leads.id });

        return {
          leads: leadRows.length,
          inboundRows: inboundRows.length,
          inboundRowsNoLead: lateReplyRows.length,
          cadenceRows: cadenceRows.length,
          ledgerRows: ledgerRows.length,
        };
      },
    },

    neverText: {
      list: () =>
        db
          .select()
          .from(tenantNeverTextNumbers)
          .where(eq(tenantNeverTextNumbers.tenantId, tenantId))
          .orderBy(tenantNeverTextNumbers.createdAt, tenantNeverTextNumbers.id),

      add: (row: NeverTextAdd) =>
        db
          .insert(tenantNeverTextNumbers)
          .values({
            tenantId,
            numberE164: row.numberE164,
            kind: row.kind,
            label: row.label,
            createdBy: row.createdBy,
          })
          // TARGETED on the (tenant, number) arbiter — see the interface.
          .onConflictDoNothing({
            target: [tenantNeverTextNumbers.tenantId, tenantNeverTextNumbers.numberE164],
          })
          .returning(),

      remove: (id: string) =>
        db
          .delete(tenantNeverTextNumbers)
          // The tenant in the PREDICATE: another client's id matches nothing.
          .where(
            and(eq(tenantNeverTextNumbers.tenantId, tenantId), eq(tenantNeverTextNumbers.id, id)),
          )
          .returning(),

      has: async (numberE164: string) => {
        const rows = await db
          .select({ id: tenantNeverTextNumbers.id })
          .from(tenantNeverTextNumbers)
          .where(
            and(
              eq(tenantNeverTextNumbers.tenantId, tenantId),
              eq(tenantNeverTextNumbers.numberE164, numberE164),
            ),
          )
          .limit(1);
        return rows.length > 0;
      },

      countOwnLines: async () => {
        const [row] = await db
          // `::int` — Postgres returns count(*) as bigint, which postgres.js
          // hands back as a STRING (the `countQuotesChasedInPeriod` note).
          .select({ count: sql<number>`count(*)::int` })
          .from(tenantNeverTextNumbers)
          .where(
            and(
              eq(tenantNeverTextNumbers.tenantId, tenantId),
              eq(tenantNeverTextNumbers.kind, 'own_line'),
            ),
          );
        return row?.count ?? 0;
      },
    },

    textBackTemplates: {
      latestAttested: (variant: TextBackVariant) =>
        db
          .select()
          .from(textBackTemplates)
          .where(
            and(
              eq(textBackTemplates.tenantId, tenantId),
              eq(textBackTemplates.variant, variant),
              isNotNull(textBackTemplates.attestedAt),
            ),
          )
          .orderBy(desc(textBackTemplates.version))
          .limit(1),

      insertVersion: (row: TextBackTemplateInsert) =>
        db
          .insert(textBackTemplates)
          .values({
            tenantId,
            variant: row.variant,
            body: row.body,
            segments: row.segments,
            createdBy: row.createdBy,
            // COMPUTED INSIDE THE INSERT, the `messageTemplates.insertVersion`
            // sub-select: evaluated against the pre-statement snapshot, so two
            // concurrent saves compute the SAME next version and one loses on
            // the unique index rather than both silently succeeding.
            version: sql<number>`(
              SELECT COALESCE(MAX(${textBackTemplates.version}), 0) + 1
              FROM ${textBackTemplates}
              WHERE ${textBackTemplates.tenantId} = ${tenantId}
                AND ${textBackTemplates.variant} = ${row.variant}
            )`,
            // The three attestation columns are deliberately ABSENT: a save is
            // not an attestation (D-02).
          })
          .returning(),

      attestWhereUnattested: (versionId: string, note: string, attestedBy: string, at: Date) =>
        db
          .update(textBackTemplates)
          .set({ attestedAt: at, attestedBy, attestationNote: note })
          .where(
            and(
              eq(textBackTemplates.tenantId, tenantId),
              eq(textBackTemplates.id, versionId),
              // THE WRITE-ONCE GUARD (D-02). See the interface comment.
              isNull(textBackTemplates.attestedAt),
            ),
          )
          .returning(),

      latestForVariant: (variant: TextBackVariant) =>
        db
          .select()
          .from(textBackTemplates)
          .where(
            and(eq(textBackTemplates.tenantId, tenantId), eq(textBackTemplates.variant, variant)),
          )
          .orderBy(desc(textBackTemplates.version))
          .limit(1),

      byId: (versionId: string) =>
        db
          .select()
          .from(textBackTemplates)
          .where(and(eq(textBackTemplates.tenantId, tenantId), eq(textBackTemplates.id, versionId)))
          .limit(1),

      attestedSetStatus: async () => {
        const rows = await db
          .selectDistinct({ variant: textBackTemplates.variant })
          .from(textBackTemplates)
          .where(
            and(eq(textBackTemplates.tenantId, tenantId), isNotNull(textBackTemplates.attestedAt)),
          );
        const attested = new Set(rows.map((r) => r.variant));
        // DRIVEN FROM THE VOCABULARY — see the interface. A row whose variant
        // is not in it (the CHECK refuses one) could not add a key here.
        return Object.fromEntries(
          TEXT_BACK_VARIANTS.map((variant) => [variant, attested.has(variant)]),
        ) as Record<TextBackVariant, boolean>;
      },
    },

    attributions: {
      // TARGETLESS `ON CONFLICT DO NOTHING` — see the interface. Zero rows is
      // the answer "already attributed", not a failure to record.
      claim: (row: AttributionClaim) =>
        db
          .insert(quoteAttributions)
          .values({ ...row, tenantId })
          .onConflictDoNothing()
          // `id` only: the consumer's decision is binary — did I win the claim —
          // and returning the whole row invites branching on something else.
          .returning({ id: quoteAttributions.id }),

      // HALF-OPEN: `>= start AND < end`. `lt` on the upper bound, never `lte`.
      listForPeriod: (start: Date, end: Date) =>
        db
          .select()
          .from(quoteAttributions)
          .where(
            and(
              eq(quoteAttributions.tenantId, tenantId),
              gte(quoteAttributions.wonDetectedAt, start),
              lt(quoteAttributions.wonDetectedAt, end),
            ),
          )
          .orderBy(quoteAttributions.wonDetectedAt, quoteAttributions.quoteId),

      byQuote: (quoteId: string) =>
        db
          .select()
          .from(quoteAttributions)
          .where(
            and(
              eq(quoteAttributions.tenantId, tenantId),
              eq(quoteAttributions.quoteId, quoteId),
            ),
          ),
    },

    reports: {
      // ONE STATEMENT. The version subquery runs inside the INSERT so it cannot
      // be separated from the write by another generate landing between them.
      // `generatedAt` is deliberately NOT set here — the column's `defaultNow()`
      // is what makes the moment the database's.
      insertVersion: (row: ReportInsert) =>
        db
          .insert(monthlyReports)
          .values({
            ...row,
            tenantId,
            version: sql`(SELECT COALESCE(MAX(version), 0) + 1 FROM monthly_reports WHERE tenant_id = ${tenantId} AND period_start = ${row.periodStart})`,
          })
          .returning({ id: monthlyReports.id, version: monthlyReports.version }),

      // An EXPLICIT select list, and the five jsonb columns are the point of it.
      list: () =>
        db
          .select({
            id: monthlyReports.id,
            periodStart: monthlyReports.periodStart,
            periodEnd: monthlyReports.periodEnd,
            timezone: monthlyReports.timezone,
            version: monthlyReports.version,
            generatedAt: monthlyReports.generatedAt,
          })
          .from(monthlyReports)
          .where(eq(monthlyReports.tenantId, tenantId))
          // Ordered BEFORE it is limited, so a bound cap drops the oldest month
          // rather than the report just generated.
          .orderBy(desc(monthlyReports.periodStart), desc(monthlyReports.version))
          .limit(REPORT_LIST_LIMIT),

      // ONE ROW, BY DEFINITION — `period_start DESC, version DESC` limited to 1,
      // on the same index the unique constraint already maintains. Both
      // predicates are tenant-pinned from the closure.
      latestVersionOf: (periodStart: string) =>
        db
          // The ID TOO, because the caller's banner links to it. An explicit
          // select list still: the five jsonb documents stay out of it.
          .select({ id: monthlyReports.id, version: monthlyReports.version })
          .from(monthlyReports)
          .where(
            and(
              eq(monthlyReports.tenantId, tenantId),
              eq(monthlyReports.periodStart, periodStart),
            ),
          )
          .orderBy(desc(monthlyReports.version))
          .limit(1),

      // `tenant_id` AND `id`. The id alone never selects across tenants (T-7-04).
      byId: (reportId: string) =>
        db
          .select()
          .from(monthlyReports)
          .where(
            and(eq(monthlyReports.tenantId, tenantId), eq(monthlyReports.id, reportId)),
          ),
    },

    fees: {
      // INSERT, and nothing else. `createdAt` is the column's `defaultNow()`:
      // it is the latest-inserted-wins tie-break for two rows sharing an
      // `effective_from`, and a caller-supplied value could invert it.
      append: (row: FeeInsert) =>
        db.insert(tenantFees).values({ ...row, tenantId }).returning(),

      // `created_at DESC` is the LATEST-INSERTED-WINS tie-break, not decoration.
      list: () =>
        db
          .select()
          .from(tenantFees)
          .where(eq(tenantFees.tenantId, tenantId))
          .orderBy(desc(tenantFees.effectiveFrom), desc(tenantFees.createdAt)),
    },

    metrics: {
      // ┌────────────────────────────────────────────────────────────────────┐
      // │ THE TENANT-PINNED TWIN OF `forAllTenants_reportMetrics`. Every     │
      // │ predicate below appears there too, and the two are asserted        │
      // │ field-for-field equal in `tests/report-metrics.test.ts`. CHANGE    │
      // │ BOTH, OR THE TEST FAILS — which is the point of it existing.       │
      // └────────────────────────────────────────────────────────────────────┘
      //
      // Runs its statements ONE AT A TIME for the reason the cross-tenant twin
      // does: more in-flight queries than `getDb()` has connections deadlocks
      // against the transaction pooler (see client.ts). This one shares a page
      // render with three other reads, so the headroom matters more here.
      windowCounts: async (window: Period): Promise<TenantMetricCounts> => {
        // The D-02 qualifying-send predicate, in the window, pinned to this
        // tenant. `IS DISTINCT FROM`, never `<>` — see `ledger.listForQuote`.
        // QUOTE FOLLOW-UPS ONLY (12-REVIEW WR-03): a lead-route text-back
        // (`quote_id` NULL) is not one — the twin's comment says why.
        const sentInWindow = and(
          eq(sendLedger.tenantId, tenantId),
          isNotNull(sendLedger.quoteId),
          ne(sendLedger.sender, 'stub'),
          eq(sendLedger.outcome, 'sent'),
          sql`${sendLedger.deliveryStatus} IS DISTINCT FROM 'undelivered'`,
          gte(sendLedger.claimedAt, window.start),
          lte(sendLedger.claimedAt, window.end),
        );

        // The D-18 onboarding instant: the LATER of first-templates-approved
        // and first-attested, and NULL when either is missing. One row or none,
        // rather than the twin's grouped subqueries — the scope is one tenant,
        // so the aggregate has nothing to group by.
        const [approvedRow] = await db
          .select({ at: sql<Date | null>`min(${messageTemplates.approvedAt})` })
          .from(messageTemplates)
          .where(
            and(
              eq(messageTemplates.tenantId, tenantId),
              isNotNull(messageTemplates.approvedAt),
            ),
          );

        const [attestedRow] = await db
          .select({ at: sql<Date | null>`min(${tenantAttestations.attestedAt})` })
          .from(tenantAttestations)
          .where(
            and(
              eq(tenantAttestations.tenantId, tenantId),
              eq(tenantAttestations.kind, SM8_AUTOMATION_ATTESTATION_KIND),
            ),
          );

        const templatesAt = approvedRow?.at ?? null;
        const attestedAt = attestedRow?.at ?? null;
        // Both or nothing. A client who has not cleared both gates has no
        // onboarding instant and EVERY quote is excluded — the null arm, and
        // the twin expresses it as an INNER JOIN that drops the tenant.
        const onboarded =
          templatesAt === null || attestedAt === null
            ? null
            : new Date(Math.max(new Date(templatesAt).getTime(), new Date(attestedAt).getTime()));

        const [tenantRow] = await db
          .select({ name: tenants.name, timezone: tenants.timezone })
          .from(tenants)
          .where(eq(tenants.id, tenantId));

        // Quotes opened after onboarding, and how many were first-touched in
        // time. The LEFT JOIN's ON clause IS the service level: a matched row
        // is a qualifying touch 1 inside the window after the quote was seen.
        // COUNT DISTINCT on the event id, because a reopened quote has a second
        // cadence and therefore a second touch 1.
        const openedRows = onboarded === null
          ? []
          : await db
              .select({
                quotesOpened: sql<number>`count(DISTINCT ${quoteStatusEvents.id})::int`,
                quotesFirstTouch24h: sql<number>`count(DISTINCT ${quoteStatusEvents.id}) FILTER (WHERE ${sendLedger.id} IS NOT NULL)::int`,
              })
              .from(quoteStatusEvents)
              .leftJoin(
                sendLedger,
                and(
                  eq(sendLedger.tenantId, quoteStatusEvents.tenantId),
                  eq(sendLedger.quoteId, quoteStatusEvents.quoteId),
                  eq(sendLedger.touchNumber, 1),
                  ne(sendLedger.sender, 'stub'),
                  eq(sendLedger.outcome, 'sent'),
                  sql`${sendLedger.deliveryStatus} IS DISTINCT FROM 'undelivered'`,
                  sql`${sendLedger.claimedAt} >= ${quoteStatusEvents.detectedAt}`,
                  sql`${sendLedger.claimedAt} <= ${quoteStatusEvents.detectedAt} + make_interval(hours => ${FIRST_TOUCH_HOURS})`,
                ),
              )
              .where(
                and(
                  eq(quoteStatusEvents.tenantId, tenantId),
                  eq(quoteStatusEvents.eventType, 'quote_opened'),
                  gte(quoteStatusEvents.detectedAt, window.start),
                  lte(quoteStatusEvents.detectedAt, window.end),
                  gte(quoteStatusEvents.detectedAt, onboarded),
                ),
              );

        // Cadences and contacts, DISTINCT: a quote chased with five touches is
        // one conversation and one contact, not five of either. The address is
        // COUNTED, never selected.
        const [ledgerRow] = await db
          .select({
            cadencesTouched: sql<number>`count(DISTINCT ${sendLedger.cadenceId})::int`,
            contactsTouched: sql<number>`count(DISTINCT (${sendLedger.channel}, ${sendLedger.toAddress}))::int`,
          })
          .from(sendLedger)
          .where(sentInWindow);

        // Replies: a JOIN rather than a correlated EXISTS, because drizzle
        // renders columns in a raw `sql` fragment UNQUALIFIED for a single-table
        // query — which turns `im.cadence_id = sl.cadence_id` into
        // `cadence_id = cadence_id`, true for every row.
        const [repliedRow] = await db
          .select({
            cadencesReplied: sql<number>`count(DISTINCT ${inboundMessages.cadenceId})::int`,
          })
          .from(inboundMessages)
          .innerJoin(
            sendLedger,
            and(
              eq(sendLedger.tenantId, inboundMessages.tenantId),
              eq(sendLedger.cadenceId, inboundMessages.cadenceId),
            ),
          )
          .where(
            and(
              eq(inboundMessages.tenantId, tenantId),
              // `threaded` only: an `ambiguous` row's cadence is a guess.
              eq(inboundMessages.attribution, 'threaded'),
              gte(inboundMessages.receivedAt, window.start),
              lte(inboundMessages.receivedAt, window.end),
              sentInWindow,
            ),
          );

        // Opt-outs RESTRICTED to contacts we messaged (A6) — the join IS the
        // restriction, and without it the D-03 STOP fan-out would alarm every
        // client at once because one stranger texted the shared number.
        const [optOutRow] = await db
          .select({
            contactsOptedOut: sql<number>`count(DISTINCT (${suppressedContacts.channel}, ${suppressedContacts.address}))::int`,
          })
          .from(suppressedContacts)
          .innerJoin(
            sendLedger,
            and(
              eq(sendLedger.tenantId, suppressedContacts.tenantId),
              eq(sendLedger.channel, suppressedContacts.channel),
              eq(sendLedger.toAddress, suppressedContacts.address),
            ),
          )
          .where(
            and(
              eq(suppressedContacts.tenantId, tenantId),
              gte(suppressedContacts.createdAt, window.start),
              lte(suppressedContacts.createdAt, window.end),
              sentInWindow,
            ),
          );

        // The human-edit load (D-17). `edit_distance > 0` is NULL-safe: a NULL
        // distance is not `> 0`, so it counts as unedited.
        const [draftRow] = await db
          .select({
            draftsApproved: sql<number>`count(*)::int`,
            draftsEdited: sql<number>`count(*) FILTER (WHERE ${touchDrafts.editDistance} > 0)::int`,
            editDistanceSum: sql<string>`COALESCE(sum(${touchDrafts.editDistance}), 0)::numeric`,
          })
          .from(touchDrafts)
          .where(
            and(
              eq(touchDrafts.tenantId, tenantId),
              eq(touchDrafts.status, 'approved'),
              gte(touchDrafts.approvedAt, window.start),
              lte(touchDrafts.approvedAt, window.end),
            ),
          );

        // Bucketed by when the win was DETECTED — the same column a frozen
        // monthly report buckets by, so the rolling figure and the invoiced one
        // describe the same events.
        const [moneyRow] = await db
          .select({
            conservativeCents: sql<string>`COALESCE(sum(${quoteAttributions.conservativeCents}), 0)::bigint`,
          })
          .from(quoteAttributions)
          .where(
            and(
              eq(quoteAttributions.tenantId, tenantId),
              gte(quoteAttributions.wonDetectedAt, window.start),
              lte(quoteAttributions.wonDetectedAt, window.end),
            ),
          );

        // Whole minutes, as integers, so `escalationSpeed` takes the median of
        // the same values the page prints. `outcome = 'sent'` only: a failed
        // escalation has no latency, and a zero would flatter the metric.
        const [latencyRow] = await db
          .select({
            minutes: sql<
              number[]
            >`array_agg(round(EXTRACT(EPOCH FROM (${escalations.sentAt} - ${inboundMessages.receivedAt})) / 60)::int ORDER BY ${escalations.sentAt})`,
          })
          .from(escalations)
          .innerJoin(inboundMessages, eq(inboundMessages.id, escalations.inboundMessageId))
          .where(
            and(
              eq(escalations.tenantId, tenantId),
              eq(escalations.outcome, 'sent'),
              gte(escalations.sentAt, window.start),
              lte(escalations.sentAt, window.end),
            ),
          );

        // The schedule WHOLE and unfiltered: `feesInForce` pro-rates by local
        // day, and the row usually being charged predates the window. Ordered
        // ASCENDING to match the twin — `monthlyFeeInForceOn` scans for the
        // greatest `effective_from` and does not depend on the direction, but
        // the parity test compares these arrays.
        const feeRows = await db
          .select({
            kind: tenantFees.kind,
            amountCents: tenantFees.amountCents,
            effectiveFrom: tenantFees.effectiveFrom,
            createdAt: tenantFees.createdAt,
          })
          .from(tenantFees)
          .where(eq(tenantFees.tenantId, tenantId))
          .orderBy(tenantFees.effectiveFrom, tenantFees.createdAt);

        // 2026-10 (Phase 15, RPT-04): the window's diverted calls and whether
        // the client is diverting at all — the twin's (10) and (11), pinned to
        // this tenant. One table each, counted, never selected.
        const [callRow] = await db
          .select({
            missedCalls: sql<number>`count(*)::int`,
            missedCallsAfterHours: sql<number>`(count(*) FILTER (WHERE ${missedCalls.afterHours}))::int`,
          })
          .from(missedCalls)
          .where(
            and(
              eq(missedCalls.tenantId, tenantId),
              gte(missedCalls.startedAt, window.start),
              lte(missedCalls.startedAt, window.end),
            ),
          );

        const divertRows = await db
          .select({ id: tenantDivertNumbers.id })
          .from(tenantDivertNumbers)
          .where(
            and(
              eq(tenantDivertNumbers.tenantId, tenantId),
              eq(tenantDivertNumbers.status, 'active'),
            ),
          )
          .limit(1);

        return {
          tenantId,
          tenantName: tenantRow?.name ?? '',
          timezone: tenantRow?.timezone ?? 'Australia/Perth',
          quotesOpened: openedRows[0]?.quotesOpened ?? 0,
          quotesFirstTouch24h: openedRows[0]?.quotesFirstTouch24h ?? 0,
          cadencesTouched: ledgerRow?.cadencesTouched ?? 0,
          cadencesReplied: repliedRow?.cadencesReplied ?? 0,
          contactsTouched: ledgerRow?.contactsTouched ?? 0,
          contactsOptedOut: optOutRow?.contactsOptedOut ?? 0,
          draftsApproved: draftRow?.draftsApproved ?? 0,
          draftsEdited: draftRow?.draftsEdited ?? 0,
          editDistanceSum: draftRow?.editDistanceSum ?? '0',
          // THE ONE `Number()` on the cents total — `::bigint` arrives as text.
          conservativeCents: Number(moneyRow?.conservativeCents ?? 0),
          // `array_agg` over an empty group is NULL, not `[]`.
          escalationLatencyMinutes: latencyRow?.minutes ?? [],
          fees: feeRows.map((row) => ({
            kind: row.kind as FeeRow['kind'],
            amountCents: row.amountCents,
            effectiveFrom: row.effectiveFrom,
            createdAt: row.createdAt,
          })),
          missedCalls: callRow?.missedCalls ?? 0,
          missedCallsAfterHours: callRow?.missedCallsAfterHours ?? 0,
          hasDivertNumber: divertRows.length > 0,
        };
      },

      // ┌────────────────────────────────────────────────────────────────────┐
      // │ THE MISSED-CALL FIGURE COUNTS (Phase 15, D-03/D-10). COUNTS ONLY.  │
      // │ `computeMissedCallFigures` is the one derivation; nothing here     │
      // │ divides, takes a median or a percentile.                           │
      // └────────────────────────────────────────────────────────────────────┘
      //
      // SIX statements, ONE AT A TIME — the `windowCounts` pool rule. The
      // period is HALF-OPEN (`[start, end)`, a calendar month), through the
      // comparison builders so every Date binds through its column's mapper.
      missedCallCounts: async (period: Period, timezone: string): Promise<MissedCallCounts> => {
        const callInPeriod = and(
          eq(missedCalls.tenantId, tenantId),
          gte(missedCalls.startedAt, period.start),
          lt(missedCalls.startedAt, period.end),
        );
        // A lead-route text-back the provider accepted. A quote-route one is
        // the quote engine's touch 0 and reports with the quote figures.
        const sentLeadTextBack = and(
          eq(missedCalls.textBackStatus, 'sent'),
          eq(missedCalls.textBackRoute, 'lead'),
        );

        // (1) The four call-level counts.
        const [totals] = await db
          .select({
            captured: sql<number>`count(*)::int`,
            withheld: sql<number>`(count(*) FILTER (WHERE ${eq(missedCalls.callerKind, 'withheld')}))::int`,
            afterHours: sql<number>`(count(*) FILTER (WHERE ${missedCalls.afterHours}))::int`,
            textBacksSent: sql<number>`(count(*) FILTER (WHERE ${sentLeadTextBack}))::int`,
          })
          .from(missedCalls)
          .where(callInPeriod);

        // (2) THE HOUR AND WEEKDAY SPLIT, IN THE TENANT'S ZONE, IN SQL. One
        // grouped statement; `GROUP BY 1, 2` (positional) because the zone is
        // a bound parameter, and a parameter written twice is two parameters
        // that Postgres will not match as one grouping expression. ISO
        // weekday: 1 = Monday … 7 = Sunday.
        const buckets = await db
          .select({
            hour: sql<number>`extract(hour FROM ${missedCalls.startedAt} AT TIME ZONE ${timezone}::text)::int`,
            isoWeekday: sql<number>`extract(isodow FROM ${missedCalls.startedAt} AT TIME ZONE ${timezone}::text)::int`,
            calls: sql<number>`count(*)::int`,
            afterHours: sql<number>`(count(*) FILTER (WHERE ${missedCalls.afterHours}))::int`,
          })
          .from(missedCalls)
          .where(callInPeriod)
          .groupBy(sql`1`, sql`2`);

        const byHour = Array.from({ length: 24 }, () => 0);
        const byIsoWeekday = Array.from({ length: 7 }, () => 0);
        const afterHoursByIsoWeekday = Array.from({ length: 7 }, () => 0);
        for (const bucket of buckets) {
          const hour = Number(bucket.hour);
          const day = Number(bucket.isoWeekday) - 1;
          // Out-of-range is impossible from `extract`; guarded so a surprise
          // cannot grow an array past the length the derivation asserts.
          if (hour >= 0 && hour < 24) byHour[hour]! += bucket.calls;
          if (day >= 0 && day < 7) {
            byIsoWeekday[day]! += bucket.calls;
            afterHoursByIsoWeekday[day]! += bucket.afterHours;
          }
        }

        // (3) THE DELIVERED SET: lead-route text-backs whose ledger row the
        // provider's receipt marked `delivered`. One row each, carrying the
        // whole seconds from arrival (`started_at`, ours) to the receipt
        // instant (`send_ledger.delivered_at`, the provider's), CLAMPED AT
        // ZERO in SQL — provider clock skew (research Pitfall 7). A delivered
        // row with no receipt instant is counted and carries no duration.
        const deliveredJoin = and(
          eq(sendLedger.id, missedCalls.textBackLedgerId),
          eq(sendLedger.tenantId, tenantId),
        );
        const delivered = await db
          .select({
            seconds: sql<number | null>`CASE WHEN ${sendLedger.deliveredAt} IS NULL THEN NULL ELSE greatest(0, extract(epoch FROM (${sendLedger.deliveredAt} - ${missedCalls.startedAt})))::int END`,
          })
          .from(missedCalls)
          .innerJoin(sendLedger, deliveredJoin)
          .where(and(callInPeriod, sentLeadTextBack, eq(sendLedger.deliveryStatus, 'delivered')));

        // (4) LEADS THAT REPLIED, on the delivered set — lead-level, so a
        // chatty caller counts once; the denominator is the delivered count.
        const [replied] = await db
          .select({ leads: sql<number>`count(DISTINCT ${missedCalls.leadId})::int` })
          .from(missedCalls)
          .innerJoin(sendLedger, deliveredJoin)
          .where(
            and(
              callInPeriod,
              sentLeadTextBack,
              eq(sendLedger.deliveryStatus, 'delivered'),
              exists(
                db
                  .select({ one: sql`1` })
                  .from(inboundMessages)
                  .where(
                    and(
                      eq(inboundMessages.tenantId, tenantId),
                      eq(inboundMessages.leadId, missedCalls.leadId),
                      eq(inboundMessages.attribution, 'threaded'),
                    ),
                  ),
              ),
            ),
          );

        // (5) THE FUNNEL over leads OPENED in the period (`first_missed_at`):
        // created by the operator's tap, booked by the tradie — the digest's
        // two predicates verbatim.
        const leadInPeriod = and(
          eq(leads.tenantId, tenantId),
          gte(leads.firstMissedAt, period.start),
          lt(leads.firstMissedAt, period.end),
        );
        const [funnel] = await db
          .select({
            leads: sql<number>`count(*)::int`,
            jobsCreated: sql<number>`(count(*) FILTER (WHERE ${eq(leads.sm8JobState, 'created')}))::int`,
            bookedByTradie: sql<number>`(count(*) FILTER (WHERE ${eq(leads.closedReason, 'booked_by_tradie')}))::int`,
          })
          .from(leads)
          .where(leadInPeriod);

        // (6) OF THE CREATED JOBS, THOSE WON IN THE MIRROR — a COUNT, never
        // cents (D-03). The correlated EXISTS is in the WHERE, where the
        // builder qualifies both sides.
        const [won] = await db
          .select({ jobsWon: sql<number>`count(*)::int` })
          .from(leads)
          .where(
            and(
              leadInPeriod,
              eq(leads.sm8JobState, 'created'),
              exists(
                db
                  .select({ one: sql`1` })
                  .from(quotes)
                  .where(
                    and(
                      eq(quotes.tenantId, tenantId),
                      eq(quotes.tenantId, leads.tenantId),
                      eq(quotes.sm8JobUuid, leads.sm8JobUuid),
                      inArray(quotes.status, ['Work Order', 'Completed']),
                    ),
                  ),
              ),
            ),
          );

        return {
          captured: totals?.captured ?? 0,
          withheld: totals?.withheld ?? 0,
          afterHours: totals?.afterHours ?? 0,
          byHour,
          byIsoWeekday,
          afterHoursByIsoWeekday,
          textBacksSent: totals?.textBacksSent ?? 0,
          textBacksDelivered: delivered.length,
          deliveredSeconds: delivered
            .map((row) => row.seconds)
            .filter((seconds): seconds is number => seconds !== null)
            .map(Number),
          repliedLeadsOnDelivered: replied?.leads ?? 0,
          leads: funnel?.leads ?? 0,
          jobsCreated: funnel?.jobsCreated ?? 0,
          jobsWon: won?.jobsWon ?? 0,
          bookedByTradie: funnel?.bookedByTradie ?? 0,
        };
      },
    },

    quoteContacts: {
      list: () =>
        db.select().from(quoteContacts).where(eq(quoteContacts.tenantId, tenantId)),

      listForJob: (sm8JobUuid: string) =>
        db
          .select()
          .from(quoteContacts)
          .where(
            and(
              eq(quoteContacts.tenantId, tenantId),
              eq(quoteContacts.sm8JobUuid, sm8JobUuid),
            ),
          )
          // Deterministic, because `selectPrimaryContact`'s final tie-break is
          // the lowest uuid and a caller reading a LOG of this result should see
          // the same order the selection saw.
          .orderBy(quoteContacts.sm8ContactUuid),

      upsertMany: async (rows: QuoteContactUpsert[]) => {
        if (rows.length === 0) return 0;

        const written = await db
          .insert(quoteContacts)
          .values(rows.map((row) => ({ ...row, tenantId })))
          .onConflictDoUpdate({
            target: [quoteContacts.tenantId, quoteContacts.sm8ContactUuid],
            set: {
              sm8JobUuid: sql`excluded.sm8_job_uuid`,
              first: sql`excluded.first`,
              last: sql`excluded.last`,
              phone: sql`excluded.phone`,
              mobile: sql`excluded.mobile`,
              email: sql`excluded.email`,
              contactType: sql`excluded.contact_type`,
              sm8Active: sql`excluded.sm8_active`,
              editDateRaw: sql`excluded.edit_date_raw`,
              updatedAt: sql`now()`,
              // Unlike `quotes`, EVERY column here is mirrored ServiceM8 state,
              // so every one of them belongs in the conflict set. There is no
              // human decision on this table to protect from being overwritten.
            },
          })
          .returning({ id: quoteContacts.id });

        return written.length;
      },

      // Phase 14 (D-07). Numbers and the flag only.
      forJobs: async (sm8JobUuids: readonly string[]) => {
        if (sm8JobUuids.length === 0) return [];

        return db
          .select({
            sm8JobUuid: quoteContacts.sm8JobUuid,
            mobile: quoteContacts.mobile,
            phone: quoteContacts.phone,
            sm8Active: quoteContacts.sm8Active,
          })
          .from(quoteContacts)
          .where(
            and(
              eq(quoteContacts.tenantId, tenantId),
              inArray(quoteContacts.sm8JobUuid, [...sm8JobUuids]),
            ),
          )
          .orderBy(quoteContacts.sm8JobUuid, quoteContacts.sm8ContactUuid);
      },

      // Phase 14 (D-02 tier (i)). A coarse, PARAMETERISED suffix prefilter —
      // the tail is three digits, so it carries no LIKE metacharacter; the
      // equality is `normalizeAuMobile` in TypeScript.
      companyCandidatesByMobileTail: async (tail: string) => {
        if (!/^[0-9]{3}$/.test(tail)) return [];

        return db
          .select({
            mobile: quoteContacts.mobile,
            phone: quoteContacts.phone,
            companyUuid: quotes.companyUuid,
            dateRaw: quotes.dateRaw,
            sm8Active: quoteContacts.sm8Active,
          })
          .from(quoteContacts)
          .innerJoin(
            quotes,
            and(
              eq(quotes.tenantId, quoteContacts.tenantId),
              eq(quotes.sm8JobUuid, quoteContacts.sm8JobUuid),
            ),
          )
          .where(
            and(
              eq(quoteContacts.tenantId, tenantId),
              or(
                sql`${quoteContacts.mobile} LIKE '%' || ${tail}`,
                sql`${quoteContacts.phone} LIKE '%' || ${tail}`,
              ),
            ),
          )
          .orderBy(sql`${quotes.dateRaw} DESC NULLS LAST`, quoteContacts.sm8ContactUuid);
      },
    },

    events: {
      insertMany: async (rows: QuoteStatusEventInsert[]) => {
        if (rows.length === 0) return 0;

        const written = await db
          .insert(quoteStatusEvents)
          .values(rows.map((row) => ({ ...row, tenantId })))
          .returning({ id: quoteStatusEvents.id });

        return written.length;
      },

      since: (afterId: number) =>
        db
          .select()
          .from(quoteStatusEvents)
          .where(
            sql`${quoteStatusEvents.tenantId} = ${tenantId} AND ${quoteStatusEvents.id} > ${afterId}`,
          )
          // `id`, never `detected_at`: a batch of events written in one
          // transaction shares a `now()` to the microsecond, so ordering on the
          // timestamp is ordering on a tie.
          .orderBy(quoteStatusEvents.id),

      // `detected_at`, never `occurred_at` (D-10), and DISTINCT on the quote
      // because a reopen-and-re-win emits a second `won` event for one job.
      countWonQuotesInPeriod: async (start: Date, end: Date) => {
        const [row] = await db
          .select({ n: sql<number>`COUNT(DISTINCT ${quoteStatusEvents.quoteId})::int` })
          .from(quoteStatusEvents)
          .where(
            and(
              eq(quoteStatusEvents.tenantId, tenantId),
              eq(quoteStatusEvents.eventType, 'won'),
              gte(quoteStatusEvents.detectedAt, start),
              lt(quoteStatusEvents.detectedAt, end),
            ),
          );

        return row?.n ?? 0;
      },
    },

    consumerCursor: {
      advanceTo: async (consumer: string, toEventId: number) => {
        const moved = await db
          .update(eventConsumerCursors)
          .set({ lastEventId: toEventId, updatedAt: sql`now()` })
          .where(
            and(
              eq(eventConsumerCursors.consumer, consumer),
              // THE NEVER-REWIND GUARD, expressed as a WHERE clause rather than
              // a read-then-write in the caller, for the same reason the
              // eligibility flip is: two ticks can both read the old value.
              lt(eventConsumerCursors.lastEventId, toEventId),
            ),
          )
          .returning({ lastEventId: eventConsumerCursors.lastEventId });

        return moved.length;
      },
    },

    syncRuns: {
      insert: (row: SyncRunInsert) =>
        db
          .insert(syncRuns)
          .values({ ...row, tenantId })
          .returning(),

      recent: (limit = 20) =>
        db
          .select()
          .from(syncRuns)
          .where(eq(syncRuns.tenantId, tenantId))
          .orderBy(sql`${syncRuns.startedAt} DESC`)
          .limit(limit),
    },

    transaction: <T,>(fn: (repo: TenantScopedRepository) => Promise<T>): Promise<T> =>
      // Nested transactions become savepoints in drizzle, so calling this from
      // inside an existing transaction is correct rather than a deadlock.
      db.transaction((tx) => fn(build(tenantId, tx))),
  };
}

export function forTenant(tenantId: string): TenantScopedRepository {
  // Fail loudly at construction rather than handing Postgres a value it will
  // reject as `22P02`, or — worse for an `undefined` — letting the driver build
  // a predicate nobody intended. A bad tenant id is a programming error and must
  // never degrade into a silently wrong result set.
  if (typeof tenantId !== 'string' || !UUID_PATTERN.test(tenantId)) {
    throw new Error(
      `forTenant() requires a tenant uuid; received ${JSON.stringify(tenantId)}.`,
    );
  }

  return build(tenantId, getDb());
}
