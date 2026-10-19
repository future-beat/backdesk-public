/**
 * The missed-call repository (Phase 11, CAP-03, D-06) — the one table here whose
 * rows may belong to nobody, written by the telephony webhooks and the call-log
 * reconcile.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY THIS IS NOT A `forTenant()` NAMESPACE — the `inbound_messages`       │
 * │ argument, one channel over. A call arrives BEFORE we know whose it is:   │
 * │ the voice webhook resolves the tenant from the called number, and a call │
 * │ to a number nobody owns is recorded anyway with `tenant_id = NULL`. A    │
 * │ scoped insert would have to invent an owner for it.                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * So this is the same shape of exception the inbound, delivery-receipt and
 * escalation families already are: its own file, its own block in the barrel,
 * and no method that takes a `tenantId` as a SCOPE. What it owes in return is
 * that it reads and writes ONE table and joins nothing — with ONE argued
 * exception, `getTextBackEvidenceForTenant`, whose header says why.
 *
 * THREE WRITERS, ONE ARBITER — `missed_calls_provider_call_uniq` on
 * `(provider, provider_call_id)`:
 *
 *   insertMissedCallArrival — the arrival webhook. `ON CONFLICT DO NOTHING`, so
 *     a second delivery of the same CallSid writes nothing and says so (`null`).
 *   completeMissedCall      — the status callback. An UPDATE with an exact-match
 *     predicate and NEVER an insert: a callback is a HINT (the delivery-receipt
 *     rule), so an unknown CallSid touches nothing and a forgery cannot invent a
 *     call.
 *   upsertMissedCallFromLog — the nightly reconcile. Inserts a call the webhook
 *     never saw, or fills ONLY what a dropped callback left NULL on one it did —
 *     never `started_at`, `after_hours` or a caller column of an ATTRIBUTED
 *     row, because those were computed at arrival and are stored facts. The one
 *     exception is a DEAD LETTER (`tenant_id` NULL): it holds no caller facts at
 *     all, so once the reconcile can resolve the owner from `To` it adopts the
 *     row whole (WR-06).
 *
 * AND TWO READS — `getMissedCallForTenant`, the verification-call proof's
 * artefact check: one row by id, the tenant in the PREDICATE, and none of the
 * three caller-number columns in the select list; and (Phase 12)
 * `getMissedCallForTextBack`, the one read that selects a caller's number, for
 * the text-back path alone — see its own header.
 *
 * PHASE 12 ADDS THE TICK'S THREE (12-02) and the proof's one:
 *
 *   listPendingTextBacks  — the sweep's read (D-20): ids of undecided calls of
 *     a real tenant inside the age window. Ids only.
 *   markStaleTextBacks    — the sweep's other half: an undecided call past the
 *     ceiling becomes `skipped` / `stale`, explicitly, so it is never texted
 *     hours late and never sits undecided forever.
 *   claimTextBackAlerts   — the D-10 alert claim: failed, stuck and
 *     pause-failed rows are stamped `text_back_alerted_at` once; the stamp IS
 *     the decision to alert.
 *   getTextBackEvidenceForTenant — the `text_back_proof` artefact check. THE
 *     ONE STATEMENT IN THIS FILE THAT JOINS, and its header argues why.
 *
 * None of the four selects a caller's number: ids, statuses, counts and
 * timestamps only (T-12-07).
 *
 * The text-back DECISION writes (claim, decision, outcome) are tenant-scoped
 * and live on `forTenant().missedCalls`, because they must run on the same
 * transaction handle as the ledger claim.
 *
 * Service-role, so RLS is bypassed by design; the policy on the table is
 * defence-in-depth for the console's authenticated reads.
 */
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import {
  messagingConfig,
  missedCalls,
  sendLedger,
  TEXT_BACK_CHANNEL,
  TEXT_BACK_PAUSE_FAILED_DETAIL,
} from '@/db/schema';
import type { NewMissedCall, TextBackSkipReason } from '@/db/schema';

import { getDb } from './client';
import type { RepositoryDb } from './client';

/**
 * The text-back decision columns (Phase 12). Their ONLY writers are the
 * text-back path's guarded claim, decision and outcome writes (and the 0039
 * data statement): no door that records a CALL may record a text-back outcome
 * with it, so every insert type in this file omits them.
 */
type TextBackOutcomeColumns =
  | 'textBackStatus'
  | 'textBackSkipReason'
  | 'textBackRoute'
  | 'textBackDecidedAt'
  | 'textBackDetail'
  | 'textBackAlertedAt'
  | 'leadId'
  | 'cadenceId'
  | 'textBackLedgerId';

/**
 * One arrival as the voice webhook supplies it.
 *
 * `id`, `createdAt` and `updatedAt` are the database's. `completedVia`,
 * `durationSeconds` and `endedAt` are omitted because an ARRIVAL cannot know how
 * the call ended — the callback and the reconcile own those columns. Every
 * text-back column is omitted because the arrival door cannot decide a text.
 */
export type MissedCallArrivalInsert = Omit<
  NewMissedCall,
  | 'id'
  | 'createdAt'
  | 'updatedAt'
  | 'completedVia'
  | 'durationSeconds'
  | 'endedAt'
  | TextBackOutcomeColumns
>;

/**
 * Record a call's arrival. `null` MEANS "ALREADY RECORDED" — a redelivery of a
 * CallSid we hold — and is an answer, not a failure.
 *
 * TARGETED `ON CONFLICT` on the arbiter, so a conflict on any OTHER unique index
 * (there is none today) would raise rather than be silently swallowed as a
 * duplicate.
 */
export async function insertMissedCallArrival(
  row: MissedCallArrivalInsert,
): Promise<{ id: string } | null> {
  const rows = await getDb()
    .insert(missedCalls)
    .values(row)
    .onConflictDoNothing({ target: [missedCalls.provider, missedCalls.providerCallId] })
    .returning({ id: missedCalls.id });

  return rows[0] ?? null;
}

/** What a completed-status callback may set. There is no fifth column. */
export interface MissedCallCompletion {
  providerCallId: string;
  callStatus: string;
  durationSeconds: number | null;
  endedAt: Date | null;
}

/**
 * What a completion matched. `id` and `tenantId` are the ROW's, from RETURNING
 * — never anything the callback said — and both are `null` when nothing
 * matched. `tenantId` is `null` too on a matched dead letter (no owner).
 */
export interface MissedCallCompletionResult {
  completed: boolean;
  id: string | null;
  tenantId: string | null;
}

/**
 * Complete a call from its status callback. UPDATE ONLY, exact match on the
 * CallSid — see the header. `completed: false` means no row carries that id
 * (the reconcile will create it if the call was real).
 *
 * Phase 12: returns the matched row's id and tenant so the status door can
 * hand the text-back path a ROW ID — the send path then reads the caller from
 * the row the signed ARRIVAL door wrote, never from this callback (T-12-01).
 */
export async function completeMissedCall(
  input: MissedCallCompletion,
): Promise<MissedCallCompletionResult> {
  const rows = await getDb()
    .update(missedCalls)
    .set({
      callStatus: input.callStatus,
      durationSeconds: input.durationSeconds,
      endedAt: input.endedAt,
      completedVia: 'callback',
      updatedAt: sql`now()`,
    })
    .where(
      and(eq(missedCalls.provider, 'twilio'), eq(missedCalls.providerCallId, input.providerCallId)),
    )
    .returning({ id: missedCalls.id, tenantId: missedCalls.tenantId });

  const row = rows[0];
  return row
    ? { completed: true, id: row.id, tenantId: row.tenantId }
    : { completed: false, id: null, tenantId: null };
}

/**
 * One call as the reconcile reconstructs it from Twilio's call log. The full row
 * shape, because a call the webhook never saw must be insertable whole.
 */
export type MissedCallFromLog = Omit<
  NewMissedCall,
  'id' | 'createdAt' | 'updatedAt' | TextBackOutcomeColumns
>;

/**
 * For a DEAD LETTER (the stored row's `tenant_id` is NULL) take the log's value;
 * for an attributed row keep the stored fact. Every SET expression in an
 * `ON CONFLICT DO UPDATE` reads the OLD row, so `tenant_id IS NULL` here is the
 * row as the dead letter wrote it, whichever column this assigns.
 */
function adoptIfDeadLetter(column: SQL | AnyPgColumn, excluded: string): SQL {
  return sql`CASE WHEN ${missedCalls.tenantId} IS NULL THEN ${sql.raw(`excluded.${excluded}`)} ELSE ${column} END`;
}

/**
 * The reconcile's convergent write.
 *
 *   `inserted`  — the webhook never recorded this CallSid.
 *   `updated`   — it did, and this write actually MOVED something: it filled a
 *                 completion a dropped callback left NULL, or it ADOPTED a dead
 *                 letter (WR-06) by filling its tenant, divert row and caller
 *                 classification from the log.
 *   `unchanged` — the row was already attributed and complete; the guard
 *                 (`setWhere`) matched nothing and NOTHING was written. Not a
 *                 recovery, so the reconcile does not count it.
 *
 * `call_status` is `coalesce(excluded, stored)` (IN-03): a status outside the
 * nine the log could not map arrives as NULL and must not erase a stored one.
 *
 * `xmax = 0` is Postgres's own answer to "did this ON CONFLICT statement insert
 * or update": a freshly inserted tuple has no deleting transaction.
 */
export async function upsertMissedCallFromLog(
  row: MissedCallFromLog,
): Promise<{ kind: 'inserted' | 'updated' | 'unchanged' }> {
  const [written] = await getDb()
    .insert(missedCalls)
    .values(row)
    .onConflictDoUpdate({
      target: [missedCalls.provider, missedCalls.providerCallId],
      set: {
        // ── WR-06: A DEAD LETTER IS ADOPTED WHOLE ──────────────────────────
        // Only when the stored row has no tenant: then it carries no caller
        // facts (the dead letter writes none), and the log's are the only ones.
        tenantId: sql`coalesce(${missedCalls.tenantId}, excluded.tenant_id)`,
        divertNumberId: adoptIfDeadLetter(missedCalls.divertNumberId, 'divert_number_id'),
        calledNumberE164: adoptIfDeadLetter(missedCalls.calledNumberE164, 'called_number_e164'),
        callerE164: adoptIfDeadLetter(missedCalls.callerE164, 'caller_e164'),
        callerWithheld: adoptIfDeadLetter(missedCalls.callerWithheld, 'caller_withheld'),
        callerKind: adoptIfDeadLetter(missedCalls.callerKind, 'caller_kind'),
        callerRaw: adoptIfDeadLetter(missedCalls.callerRaw, 'caller_raw'),
        forwardedFromRaw: adoptIfDeadLetter(missedCalls.forwardedFromRaw, 'forwarded_from_raw'),
        fromCountry: adoptIfDeadLetter(missedCalls.fromCountry, 'from_country'),
        afterHours: adoptIfDeadLetter(missedCalls.afterHours, 'after_hours'),
        // An adopted row is no longer a dead letter, and keeps no raw payload
        // (an attributed arrival never stores one).
        deadLetterReason: adoptIfDeadLetter(missedCalls.deadLetterReason, 'dead_letter_reason'),
        rawPayload: adoptIfDeadLetter(missedCalls.rawPayload, 'raw_payload'),

        // ── THE COMPLETION — only what is NULL moves ───────────────────────
        callStatus: sql`coalesce(excluded.call_status, ${missedCalls.callStatus})`,
        durationSeconds: sql`coalesce(${missedCalls.durationSeconds}, excluded.duration_seconds)`,
        endedAt: sql`coalesce(${missedCalls.endedAt}, excluded.ended_at)`,
        completedVia: sql`coalesce(${missedCalls.completedVia}, 'reconcile')`,
        updatedAt: sql`now()`,
      },
      // WRITE ONLY WHEN THERE IS SOMETHING TO WRITE — so a returned row means
      // a real recovery, and an already-complete, attributed row is left alone.
      setWhere: sql`${missedCalls.tenantId} IS NULL
        OR ${missedCalls.completedVia} IS NULL
        OR (${missedCalls.durationSeconds} IS NULL AND excluded.duration_seconds IS NOT NULL)
        OR (${missedCalls.endedAt} IS NULL AND excluded.ended_at IS NOT NULL)`,
    })
    .returning({ id: missedCalls.id, inserted: sql<boolean>`(xmax = 0)` });

  if (written === undefined) return { kind: 'unchanged' };
  return { kind: written.inserted ? 'inserted' : 'updated' };
}

/**
 * What the verification-call proof may read about one call. NO CALLER NUMBER:
 * the proof records ids, statuses and flags only (T-10-20's evidence rule), so
 * `caller_e164`, `caller_raw` and `forwarded_from_raw` are not selectable here —
 * `forwardedFromPresent` answers the S3 question without the number.
 */
export interface MissedCallEvidence {
  id: string;
  providerCallId: string | null;
  callStatus: string | null;
  durationSeconds: number | null;
  afterHours: boolean;
  callerKind: string;
  callerWithheld: boolean;
  /**
   * WR-02: did the call arrive WITH a caller number? A boolean computed in SQL
   * (`caller_e164 IS NOT NULL`), so the proof can require the caller's CLI
   * survived the divert without the number ever leaving the database.
   */
  callerPresent: boolean;
  forwardedFromPresent: boolean;
  startedAt: Date;
  endedAt: Date | null;
  divertNumberId: string | null;
  completedVia: string | null;
}

/**
 * ONE call by id, with the tenant in the PREDICATE — `null` for an unknown id
 * AND for another client's call, indistinguishably. The `getEscalationForTenant`
 * shape: a read that fetched first and compared the tenant afterwards is one
 * early return away from proving another client's divert for this one.
 */
export async function getMissedCallForTenant(
  tenantId: string,
  id: string,
): Promise<MissedCallEvidence | null> {
  const rows = await getDb()
    .select({
      id: missedCalls.id,
      providerCallId: missedCalls.providerCallId,
      callStatus: missedCalls.callStatus,
      durationSeconds: missedCalls.durationSeconds,
      afterHours: missedCalls.afterHours,
      callerKind: missedCalls.callerKind,
      callerWithheld: missedCalls.callerWithheld,
      callerPresent: sql<boolean>`(${missedCalls.callerE164} IS NOT NULL)`,
      forwardedFromPresent: sql<boolean>`(${missedCalls.forwardedFromRaw} IS NOT NULL)`,
      startedAt: missedCalls.startedAt,
      endedAt: missedCalls.endedAt,
      divertNumberId: missedCalls.divertNumberId,
      completedVia: missedCalls.completedVia,
    })
    .from(missedCalls)
    .where(and(eq(missedCalls.tenantId, tenantId), eq(missedCalls.id, id)))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * What the text-back path reads about ONE call before it decides (Phase 12).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE ONE READ IN THIS REPOSITORY THAT SELECTS A CALLER'S NUMBER FOR        │
 * │ SENDING. It exists for `src/core/leads/text-back.ts` alone: NO CONSOLE    │
 * │ PAGE, ACTION, SCRIPT OR ROUTE MAY IMPORT IT. Every other reader of this   │
 * │ table reduces the number to a boolean inside SQL (`getMissedCallFor-      │
 * │ Tenant`, the ops scripts), so a number never reaches a surface that       │
 * │ prints. The text-back needs the number because it is the address the     │
 * │ text goes to — the one legitimate use, and the reason it is fetched by    │
 * │ the row id the completion UPDATE returned rather than by anything a       │
 * │ request carried (T-12-01).                                               │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Phase 13 (13-06, D-07) adds exactly two more readers, both core tick
 * passes that text the TRADIE, never the caller: `src/core/escalation/
 * ring-twice.ts` and `src/core/escalation/release-held.ts` read the number of
 * a ring-twice call they have already CLAIMED, for the `Call them:` line of
 * the tradie's alert and nothing else. Still no console page, action, script
 * or route.
 *
 * Tenant-less on purpose: the caller learns the tenant FROM the row (a dead
 * letter has none, and the text-back path refuses it). `null` for an unknown
 * id. Callers must never log any field of the result.
 */
export interface MissedCallForTextBack {
  id: string;
  tenantId: string | null;
  callerE164: string | null;
  callerKind: string;
  afterHours: boolean;
  startedAt: Date;
  endedAt: Date | null;
  forwardedFromRaw: string | null;
  textBackStatus: string | null;
}

export async function getMissedCallForTextBack(id: string): Promise<MissedCallForTextBack | null> {
  const rows = await getDb()
    .select({
      id: missedCalls.id,
      tenantId: missedCalls.tenantId,
      callerE164: missedCalls.callerE164,
      callerKind: missedCalls.callerKind,
      afterHours: missedCalls.afterHours,
      startedAt: missedCalls.startedAt,
      endedAt: missedCalls.endedAt,
      forwardedFromRaw: missedCalls.forwardedFromRaw,
      textBackStatus: missedCalls.textBackStatus,
    })
    .from(missedCalls)
    .where(eq(missedCalls.id, id))
    .limit(1);

  return rows[0] ?? null;
}

/* ------------------------------------------------------------------------- *
 * THE TICK'S READS AND CLAIMS (Phase 12, D-10/D-20) — and the proof's read
 * ------------------------------------------------------------------------- */

/**
 * THE REFERENCE INSTANT of a call: `coalesce(ended_at, started_at)` — when the
 * call ENDED if we know, else when it began (a dropped callback leaves
 * `ended_at` NULL until the reconcile fills it).
 *
 * Spelled as two column comparisons rather than `coalesce(...) <= $1` in a sql
 * template so the bound Date is encoded by a COLUMN — never a raw Date inside
 * a sql`` template (the postgres.js Bind-time trap `promoteDue` documents).
 * The two arms are exhaustive and exclusive, so this is exactly the coalesce.
 */
function referenceInstant(
  op: typeof lte | typeof lt | typeof gte,
  bound: Date,
): SQL {
  return or(
    and(isNotNull(missedCalls.endedAt), op(missedCalls.endedAt, bound)),
    and(isNull(missedCalls.endedAt), op(missedCalls.startedAt, bound)),
  ) as SQL;
}

/** The sweep's window. Both bounds inclusive; `limit` bounds one tick's work. */
export interface PendingTextBackWindow {
  /** The youngest a call may be: its reference instant is at or before this. */
  olderThan: Date;
  /** The oldest a call may be: its reference instant is at or after this. */
  newerThan: Date;
  limit: number;
}

/**
 * THE SWEEP'S READ (D-20). Undecided calls of a REAL tenant whose reference
 * instant lies inside `[newerThan, olderThan]`, oldest first.
 *
 * IDS ONLY. The sweep hands each id to `sendTextBack`, which reads the caller
 * from the row through `getMissedCallForTextBack` — so no number, and no
 * tenant, travels through the tick from here (T-12-07).
 *
 * `tenant_id IS NOT NULL` keeps dead letters out: a call to a number nobody
 * owns has nobody whose text-back it could be. A decided row
 * (`text_back_status` set) is never returned, so a call the status door already
 * texted is not offered again. Served by `missed_calls_text_back_pending_idx`.
 */
export async function listPendingTextBacks(
  window: PendingTextBackWindow,
): Promise<Array<{ id: string }>> {
  return getDb()
    .select({ id: missedCalls.id })
    .from(missedCalls)
    .where(
      and(
        isNotNull(missedCalls.tenantId),
        isNull(missedCalls.textBackStatus),
        referenceInstant(lte, window.olderThan),
        referenceInstant(gte, window.newerThan),
      ),
    )
    .orderBy(asc(missedCalls.startedAt), asc(missedCalls.id))
    .limit(window.limit);
}

/**
 * MARK UNDECIDED CALLS PAST THE CEILING AS `skipped` / `stale` (D-20, T-12-20).
 * Returns how many rows it marked.
 *
 * One guarded UPDATE: a real tenant's row, still undecided, whose reference
 * instant is STRICTLY before `before`. The `text_back_status IS NULL` guard is
 * the same arbiter `claimForTextBack` uses, so a row the status door claims a
 * moment earlier drops out of this statement instead of being overwritten — a
 * decided row is never touched.
 *
 * `at` is the decision time written to `text_back_decided_at`; the tick passes
 * its pinned clock, and the default is the database's own `now()` (a column
 * default, not a bound Date). A stale skip counts towards nothing — the 24-hour
 * rule and the daily cap count `claimed` / `sent` only.
 */
export async function markStaleTextBacks(before: Date, at?: Date): Promise<number> {
  const rows = await getDb()
    .update(missedCalls)
    .set({
      textBackStatus: 'skipped',
      textBackSkipReason: 'stale',
      textBackDecidedAt: at ?? sql`now()`,
      updatedAt: at ?? sql`now()`,
    })
    .where(
      and(
        isNotNull(missedCalls.tenantId),
        isNull(missedCalls.textBackStatus),
        referenceInstant(lt, before),
      ),
    )
    .returning({ id: missedCalls.id });

  return rows.length;
}

/** One claimed alert row: who, and what state — never which caller. */
export interface ClaimedTextBackAlert {
  tenantId: string;
  /**
   * `failed`, `claimed` (outcome unknown past the stuck bound), `sent`
   * (with detail `pause_failed`: the quote cadence did not pause), or
   * `skipped` (12-REVIEW WR-02: an ARMED client's call refused for a
   * configuration reason — see `skipReason`).
   */
  status: string;
  /** The provider code or fixed marker, CHECK-bounded; never prose. */
  detail: string | null;
  /**
   * `no_template` or `sms_not_armed` on a `skipped` row (WR-02); `null` on
   * every other arm. A closed code, CHECK-bounded.
   */
  skipReason: string | null;
  /**
   * `skipped` rows only (WR-02): this client already had a configuration
   * alert claimed EARLIER this Perth day, so the row is stamped but not
   * emailed again — one configuration email per client per Perth day.
   * Always `false` on the other arms.
   */
  repeatToday: boolean;
}

/**
 * The two skips that are the ARMED CLIENT'S configuration failing, not the
 * caller's circumstances (12-REVIEW WR-02): the attested wording no longer
 * validates against the client's current name (`no_template`), or SMS is not
 * armed / has no identity for the client (`sms_not_armed`). The gate checks
 * `not_armed` first, so either one on a row means text-back WAS armed when
 * the call was decided — the client's callers are silently going untexted.
 */
const TEXT_BACK_CONFIG_SKIP_REASONS: TextBackSkipReason[] = ['no_template', 'sms_not_armed'];

/** The configuration arm's bounds (12-REVIEW WR-02). */
export interface TextBackConfigSkipAlertWindow {
  /**
   * Only calls that STARTED at or after this are claimed: a client re-armed
   * weeks later must not be emailed about skips from an earlier armed spell
   * that predate this alarm.
   */
  since: Date;
  /**
   * The start of the current Perth day. A client with a configuration alert
   * claimed at or after this (and before `now`) gets `repeatToday: true`.
   */
  dayStart: Date;
}

/** The pool or a transaction handle — the `messaging-config.ts` idiom. */
type DbLike = RepositoryDb | Parameters<Parameters<RepositoryDb['transaction']>[0]>[0];

/**
 * THE D-10 ALERT CLAIM. Stamps `text_back_alerted_at = now` on every row that
 * the operator must hear about and has not yet, and returns them.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE STAMP IS THE DECISION TO ALERT. Claim-then-send: two overlapping     │
 * │ ticks run this guarded UPDATE, and Postgres gives each row to exactly    │
 * │ one of them. A row returned here is never returned again, so the email   │
 * │ that reports it is sent at most once — and a send that fails AFTER the   │
 * │ claim is reported by the caller as a failed alert, never as "nothing".   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Three arms: the provider refused (`failed`); the outcome is still unknown
 * (`claimed`) with a decision older than `stuckBefore` — the send-ledger rule
 * that a NULL outcome is never resent, only reported; or (12-05, D-08) the
 * about-quote text was SENT but its quote cadence could not be paused
 * (`sent` with detail `pause_failed`), which the operator must pause by hand.
 * All three are served by `missed_calls_text_back_alert_idx`, whose 0039
 * predicate already names the third.
 *
 * THE FOURTH ARM (12-REVIEW WR-02), only when `configSkip` is given: a
 * `skipped` row whose reason is `no_template` or `sms_not_armed`, for a
 * client whose `text_back` switch is ON NOW, that started at or after
 * `configSkip.since`. D-10 says a failed text-back is never silent, and these
 * two are failures of the armed client's configuration — a business renamed
 * after attestation, or SMS disarmed under an armed text-back. It is a
 * SEPARATE statement (so the three arms above keep their partial index) in
 * the SAME transaction, so the claim stays all-or-nothing: a throw stamps
 * nothing. Its rows say whether the client already had one of these claimed
 * earlier this Perth day (`repeatToday`), read BEFORE the stamp inside the
 * transaction, so the caller emails each client about it at most once a day
 * while every row is still stamped exactly once.
 *
 * Returns the tenant, the status and the codes per row — no row id beyond
 * that, and no number: the alert names clients and counts.
 */
export async function claimTextBackAlerts(
  now: Date,
  stuckBefore: Date,
  configSkip?: TextBackConfigSkipAlertWindow,
): Promise<ClaimedTextBackAlert[]> {
  if (configSkip === undefined) return claimFailureAlerts(getDb(), now, stuckBefore);
  return getDb().transaction(async (tx) => [
    ...(await claimFailureAlerts(tx, now, stuckBefore)),
    ...(await claimConfigSkipAlerts(tx, now, configSkip)),
  ]);
}

/** The three failure arms of `claimTextBackAlerts`. See there. */
async function claimFailureAlerts(
  db: DbLike,
  now: Date,
  stuckBefore: Date,
): Promise<ClaimedTextBackAlert[]> {
  const rows = await db
    .update(missedCalls)
    .set({ textBackAlertedAt: now, updatedAt: now })
    .where(
      and(
        isNotNull(missedCalls.tenantId),
        isNull(missedCalls.textBackAlertedAt),
        or(
          eq(missedCalls.textBackStatus, 'failed'),
          and(
            eq(missedCalls.textBackStatus, 'claimed'),
            lt(missedCalls.textBackDecidedAt, stuckBefore),
          ),
          // 12-05 (D-08): sent, but the quote cadence did not pause.
          and(
            eq(missedCalls.textBackStatus, 'sent'),
            eq(missedCalls.textBackDetail, TEXT_BACK_PAUSE_FAILED_DETAIL),
          ),
        ),
      ),
    )
    .returning({
      tenantId: missedCalls.tenantId,
      status: missedCalls.textBackStatus,
      detail: missedCalls.textBackDetail,
    });

  // The predicate makes both non-null; the narrowing says so to the compiler
  // rather than casting.
  return rows.flatMap((r) =>
    r.tenantId !== null && r.status !== null
      ? [
          {
            tenantId: r.tenantId,
            status: r.status,
            detail: r.detail,
            skipReason: null,
            repeatToday: false,
          },
        ]
      : [],
  );
}

/** The configuration arm of `claimTextBackAlerts` (WR-02). See there. */
async function claimConfigSkipAlerts(
  db: DbLike,
  now: Date,
  window: TextBackConfigSkipAlertWindow,
): Promise<ClaimedTextBackAlert[]> {
  const configReason = inArray(missedCalls.textBackSkipReason, TEXT_BACK_CONFIG_SKIP_REASONS);

  // Read BEFORE the stamp: which clients already had one claimed today.
  const alertedToday = await db
    .selectDistinct({ tenantId: missedCalls.tenantId })
    .from(missedCalls)
    .where(
      and(
        isNotNull(missedCalls.tenantId),
        eq(missedCalls.textBackStatus, 'skipped'),
        configReason,
        gte(missedCalls.textBackAlertedAt, window.dayStart),
        lt(missedCalls.textBackAlertedAt, now),
      ),
    );
  const repeatTenants = new Set(alertedToday.map((r) => r.tenantId));

  // ARMED NOW: a client the operator has since disarmed is not alerted about.
  const armedTenants = db
    .select({ tenantId: messagingConfig.tenantId })
    .from(messagingConfig)
    .where(
      and(eq(messagingConfig.channel, TEXT_BACK_CHANNEL), eq(messagingConfig.enabled, true)),
    );

  const rows = await db
    .update(missedCalls)
    .set({ textBackAlertedAt: now, updatedAt: now })
    .where(
      and(
        isNotNull(missedCalls.tenantId),
        isNull(missedCalls.textBackAlertedAt),
        eq(missedCalls.textBackStatus, 'skipped'),
        configReason,
        gte(missedCalls.startedAt, window.since),
        inArray(missedCalls.tenantId, armedTenants),
      ),
    )
    .returning({
      tenantId: missedCalls.tenantId,
      status: missedCalls.textBackStatus,
      skipReason: missedCalls.textBackSkipReason,
    });

  return rows.flatMap((r) =>
    r.tenantId !== null && r.status !== null
      ? [
          {
            tenantId: r.tenantId,
            status: r.status,
            detail: null,
            skipReason: r.skipReason,
            repeatToday: repeatTenants.has(r.tenantId),
          },
        ]
      : [],
  );
}

/**
 * What the `text_back_proof` may read about one text-back (Phase 12, 12-08).
 * NO CALLER NUMBER: `forwardedFromPresent` is a boolean computed in SQL, the
 * `MissedCallEvidence` rule. The ledger half is NULL-filled when the call has
 * no ledger row (it was skipped, or never decided).
 */
export interface TextBackEvidence {
  id: string;
  textBackStatus: string | null;
  textBackRoute: string | null;
  afterHours: boolean;
  startedAt: Date;
  endedAt: Date | null;
  forwardedFromPresent: boolean;
  /** `send_ledger.outcome` — `sent`, a code, or NULL for "unknown". */
  outcome: string | null;
  providerMessageId: string | null;
  claimedAt: Date | null;
  /** The DLR verdict — the proof needs `delivered`, not merely accepted. */
  deliveryStatus: string | null;
  deliveredAt: Date | null;
}

/**
 * ONE TEXT-BACK, BY MISSED-CALL ID, FOR THE TENANT WHO OWNS IT — `null` for an
 * unknown id AND for another client's call, indistinguishably (the
 * `getMissedCallForTenant` shape; the tenant is in the PREDICATE).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE ONE JOIN IN THIS FILE, and why it is allowed: the proof is "this     │
 * │ call was texted AND the carrier delivered it", and the second half lives │
 * │ only on the `send_ledger` row the call points at (`text_back_ledger_id`).│
 * │ It is a LEFT JOIN by that exact id, with the ledger's own `tenant_id`    │
 * │ also in the join condition, so it can reach one ledger row of this       │
 * │ client and nothing else. Its select list carries no address from either │
 * │ table — `send_ledger.to_address` is the caller's number and is not read. │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export async function getTextBackEvidenceForTenant(
  tenantId: string,
  id: string,
): Promise<TextBackEvidence | null> {
  const rows = await getDb()
    .select({
      id: missedCalls.id,
      textBackStatus: missedCalls.textBackStatus,
      textBackRoute: missedCalls.textBackRoute,
      afterHours: missedCalls.afterHours,
      startedAt: missedCalls.startedAt,
      endedAt: missedCalls.endedAt,
      forwardedFromPresent: sql<boolean>`(${missedCalls.forwardedFromRaw} IS NOT NULL)`,
      outcome: sendLedger.outcome,
      providerMessageId: sendLedger.providerMessageId,
      claimedAt: sendLedger.claimedAt,
      deliveryStatus: sendLedger.deliveryStatus,
      deliveredAt: sendLedger.deliveredAt,
    })
    .from(missedCalls)
    .leftJoin(
      sendLedger,
      and(eq(sendLedger.id, missedCalls.textBackLedgerId), eq(sendLedger.tenantId, tenantId)),
    )
    .where(and(eq(missedCalls.tenantId, tenantId), eq(missedCalls.id, id)))
    .limit(1);

  return rows[0] ?? null;
}
