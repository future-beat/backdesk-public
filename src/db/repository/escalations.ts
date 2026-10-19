/**
 * The escalation evidence surface (Phase 6, CON-03, plan 06-05) — a SEVENTH
 * family of the same shape as `inbound-messages`, `delivery-receipts` and
 * `messaging-config`: one table, no joins, and no method that takes a
 * `tenantId` as a SCOPE.
 *
 * It lives outside `forTenant()` for the reason the whole evidence family does:
 * `escalations` carries `tenant_id` as a COLUMN with no foreign key and no
 * cascade, because a client who disconnects must not take the record of what we
 * did on their behalf with them. The tenant id travels IN each write, supplied
 * by a caller that already knows it from the inbound row.
 *
 *   claimEscalation           — the D-08 NEVER-TWICE CLAIM. `INSERT … ON
 *     CONFLICT DO NOTHING RETURNING id`: only the caller that gets a row back
 *     may send. See its header — this function IS the guarantee.
 *   recentEscalationForCadence — the cooldown read, on the
 *     `(cadence_id, created_at)` index.
 *   recordEscalationOutcome   — the ONLY writer of `outcome`, `sent_at`,
 *     `provider_message_id` and `body_segments`, guarded on `outcome IS NULL`.
 *
 * PHASE 12 (D-08/D-16) adds the second TRIGGER — an open-quote customer rang
 * the client and was missed — with its own never-twice key:
 *
 *   claimEscalationForMissedCall — `claimEscalation`'s exact shape, keyed on
 *     `missed_call_id` (`escalations_missed_call_uniq`).
 *   listUnescalatedQuoteCalls    — which route-`quote` missed calls have no
 *     escalation yet. THE ONE READ HERE THAT TOUCHES A SECOND TABLE; its
 *     header says why it lives in this file.
 *
 * PHASE 13 (D-07/D-08/D-09, plan 13-03) adds the hold, the release and the
 * second missed-call trigger, ring-twice:
 *
 *   claimEscalation / claimEscalationForMissedCall — gain `holdUntil`: a hot
 *     lead outside contact hours (after-hours switch off) is CLAIMED with the
 *     next window's start instead of sent, which takes it out of the
 *     unescalated set at once. Holding by skipping the claim would leave it
 *     in the scan every minute until morning.
 *   claimHeldEscalationRelease — the release IS the claim: one guarded UPDATE
 *     on `released_at IS NULL AND outcome IS NULL`, never retried.
 *   listHeldEscalationsSince   — the digest's "held overnight" line: a tenant
 *     id and a time per row, nothing else.
 *   listUnescalatedRingTwiceCalls — the second call within the window from a
 *     number with an open lead (D-07). Ids only; reads `missed_calls`, an
 *     aliased `missed_calls`, `leads` and this table, for
 *     `listUnescalatedQuoteCalls`' reason.
 *
 * PHASE 14 (D-08, plan 14-04) adds the tradie's DONE:
 *
 *   latestSentLeadEscalationTo — the lead escalation most recently SENT to
 *     the number that texted DONE, inside the lookback. A tenant id and a
 *     lead id; the address is compared, never returned.
 *
 * ── WHAT IS DELIBERATELY ABSENT ────────────────────────────────────────────
 *
 * There is no list, no read-by-tenant and no delete. The console does not render
 * escalations in this phase, and an accessor added "just for a dashboard" is how
 * an evidence table becomes a queryable log of who replied to whom. Phase 7 will
 * add exactly the read it needs, with its own argument.
 * (Phase 12's `listUnescalatedQuoteCalls` lists MISSED CALLS that have no
 * escalation, three ids per row — not escalations, and not who replied to
 * whom. There is still no delete.)
 *
 * NOTHING HERE RETRIES. `outcome IS NULL` means "claimed, outcome unknown" — the
 * 03-01 send-ledger rule, restated — and the response to an unknown must never
 * be to send again, because the thing on the other end is a tradie's phone.
 */
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notExists,
  or,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { escalations, leads, missedCalls } from '@/db/schema';

import { getDb } from './client';

/**
 * Everything the claim needs, and nothing about the message.
 *
 * The BODY is not here on purpose: it is built after the claim succeeds, from
 * facts the caller already holds, and storing it would put a customer's words
 * (and their mobile, inside the `Call them:` line) into a second table with a
 * different retention story from `inbound_messages`.
 */
export interface EscalationClaim {
  /** The never-twice key — the hot inbound reply this alert is about. */
  inboundMessageId: string;
  tenantId: string;
  cadenceId: string;
  /**
   * NULL when the hot reply is on a LEAD cadence (Phase 12, D-18), which has
   * no quote; the column relaxed in migration 0039.
   */
  quoteId: string | null;
  /**
   * The lead when the hot reply is on a LEAD cadence (12-05, D-18), so the row
   * names what the conversation is about; null (or absent) on a quote cadence.
   */
  leadId?: string | null;
  /**
   * The TRADIE's normalized mobile, or `''` when the client has none on file.
   * See the column's own comment: the empty string is "there was nobody".
   */
  toAddress: string;
  /**
   * Phase 13 (D-09): the start of the client's next contact window when the
   * alert is HELD (a hot lead outside hours, after-hours switch off), or
   * `null` for an alert sent at once. A held claim still consumes the
   * never-twice key, so the hot scan stops offering the reply immediately;
   * `claimHeldEscalationRelease` sends it when the window opens.
   */
  holdUntil: Date | null;
  /** The tick's pinned clock — never `now()` in SQL. */
  at: Date;
}

/**
 * CLAIM THE RIGHT TO ESCALATE ONE HOT REPLY, EXACTLY ONCE (D-08).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `ON CONFLICT DO NOTHING RETURNING id` AGAINST                            │
 * │ `escalations_inbound_message_uniq` IS THE GUARANTEE. A caller that gets   │
 * │ a row back owns the send; a caller that gets `null` has been beaten to it │
 * │ and must do nothing at all. Two overlapping ticks — pg_cron fires without │
 * │ waiting for the previous response — therefore produce ONE text, decided   │
 * │ by Postgres rather than by a check-then-insert both of them can pass.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The same shape as `send_ledger`'s claim: claim FIRST, then send, so a crash
 * between the two leaves a claimed row with a NULL outcome rather than a second
 * message. The failure this prevents is specific and expensive — a tradie's
 * phone buzzing repeatedly about ONE customer reply, which is exactly the noise
 * that teaches them to ignore the next one.
 *
 * TARGETLESS `ON CONFLICT`, following `cadences.create` (03-08, G-3-2): naming
 * the arbiter makes a conflict on any OTHER unique index raise 23505 instead,
 * which the per-row catch would then record as an unknown throw. There is only
 * one unique index on this table today; the targetless form is what keeps that
 * true tomorrow.
 */
export async function claimEscalation(
  input: EscalationClaim,
): Promise<{ id: string } | null> {
  const rows = await getDb()
    .insert(escalations)
    .values({
      inboundMessageId: input.inboundMessageId,
      tenantId: input.tenantId,
      cadenceId: input.cadenceId,
      quoteId: input.quoteId,
      leadId: input.leadId ?? null,
      toAddress: input.toAddress,
      holdUntil: input.holdUntil,
      createdAt: input.at,
      updatedAt: input.at,
    })
    .onConflictDoNothing()
    .returning({ id: escalations.id });

  return rows[0] ?? null;
}

/**
 * Everything the missed-call claim needs (Phase 12, D-08/D-16). The
 * `EscalationClaim` shape with the trigger swapped: `missedCallId` is the
 * never-twice key and `inboundMessageId` is NULL by construction
 * (`escalations_one_trigger`). No body, for the reason `EscalationClaim` gives.
 */
export interface MissedCallEscalationClaim {
  /** The never-twice key — the missed call this alert is about. */
  missedCallId: string;
  tenantId: string;
  /**
   * The cadence the call is attached to (the call's `cadence_id`): the open
   * QUOTE cadence for a quote call (Phase 12), or the open lead's LIVE lead
   * cadence for a ring-twice call (Phase 13, D-07).
   */
  cadenceId: string;
  quoteId: string | null;
  /** Phase 13 (D-07): the open lead a ring-twice call joined; `null` for a quote call. */
  leadId: string | null;
  /** The TRADIE's normalized mobile, or `''` when the client has none. */
  toAddress: string;
  /**
   * Phase 13 (D-09): the next contact window's start when the alert is held,
   * else `null` — `EscalationClaim.holdUntil`'s meaning exactly.
   */
  holdUntil: Date | null;
  /** The tick's pinned clock — never `now()` in SQL. */
  at: Date;
}

/**
 * CLAIM THE RIGHT TO TELL THE TRADIE ABOUT ONE MISSED QUOTE CALL, EXACTLY ONCE
 * (D-16). `null` means another process owns it and the caller does nothing.
 *
 * `claimEscalation`'s exact shape — claim FIRST, then send, so a crash between
 * the two leaves a claimed row with a NULL outcome rather than a second text to
 * a tradie's phone — keyed on the missed call instead of the inbound reply.
 *
 * TARGETED on `escalations_missed_call_uniq`, unlike `claimEscalation`: this
 * row carries `inbound_message_id = NULL`, which cannot conflict on the other
 * unique index (NULLs are distinct), so the only conflict this statement can
 * meet is the one it means. Naming it — with the partial index's predicate,
 * which Postgres requires to infer a partial arbiter — makes any other
 * conflict raise rather than be swallowed as "already escalated".
 */
export async function claimEscalationForMissedCall(
  input: MissedCallEscalationClaim,
): Promise<{ id: string } | null> {
  const rows = await getDb()
    .insert(escalations)
    .values({
      inboundMessageId: null,
      missedCallId: input.missedCallId,
      tenantId: input.tenantId,
      cadenceId: input.cadenceId,
      quoteId: input.quoteId,
      leadId: input.leadId,
      toAddress: input.toAddress,
      holdUntil: input.holdUntil,
      createdAt: input.at,
      updatedAt: input.at,
    })
    .onConflictDoNothing({
      target: escalations.missedCallId,
      where: isNotNull(escalations.missedCallId),
    })
    .returning({ id: escalations.id });

  return rows[0] ?? null;
}

/** One missed quote call still owed an escalation: ids only. */
export interface UnescalatedQuoteCall {
  missedCallId: string;
  tenantId: string;
  cadenceId: string;
}

/** The two time bounds on what is still owed (12-REVIEW WR-05). */
export interface UnescalatedQuoteCallWindow {
  /**
   * The oldest call still told: its reference instant `coalesce(ended_at,
   * started_at)` is at or after this. Older ones stop being selected — the
   * SMS carries no time, so a backlog must not reach the tradie as news.
   */
  notBefore: Date;
  /**
   * A row still `claimed` (its about-quote text in flight) is left for a
   * later tick unless it was decided at or before this — so the tradie is not
   * told "our text is not confirmed" a second before it is.
   */
  stuckBefore: Date;
}

/**
 * THE MISSED QUOTE CALLS NOBODY HAS TOLD THE TRADIE ABOUT YET (D-16), oldest
 * first, at most `limit`.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY THIS LIVES HERE, AND NOT IN `missed-calls.ts` OR `for-all-tenants`.  │
 * │ It is "missed calls with no escalation row", so it must read            │
 * │ `escalations` — and `missed-calls.ts` promises to read one table.        │
 * │ `for-all-tenants.ts` is the cross-tenant surface whose export count and  │
 * │ table set are pinned (sync-upsert), and this is not a new crossing of    │
 * │ tenant DATA: it returns three ids per row and no customer column. The    │
 * │ escalation family is where the never-twice key it tests for lives.       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * A call qualifies when it belongs to a real tenant, its text-back route is
 * `quote`, it names the quote cadence (`cadence_id` set), and NO escalation
 * row carries its id. The `NOT EXISTS` is a hint, not the guarantee —
 * `claimEscalationForMissedCall` is the guarantee, so two overlapping ticks
 * that both list a call still produce one claim.
 *
 * TWO TIME BOUNDS (12-REVIEW WR-05): a call older than `window.notBefore`
 * is not owed any more (a backlog after an outage must not reach the tradie
 * as a burst of undated alarms), and a call whose text-back is still
 * `claimed` and younger than `window.stuckBefore` waits a tick for its
 * outcome. A `claimed` row older than that is told as unconfirmed, which is
 * then the truth.
 *
 * No caller number, no quote, no name: the pass reads what it needs to word
 * the alert through the tenant's own scope afterwards.
 */
export async function listUnescalatedQuoteCalls(
  limit: number,
  window: UnescalatedQuoteCallWindow,
): Promise<UnescalatedQuoteCall[]> {
  const db = getDb();
  const rows = await db
    .select({
      missedCallId: missedCalls.id,
      tenantId: missedCalls.tenantId,
      cadenceId: missedCalls.cadenceId,
    })
    .from(missedCalls)
    .where(
      and(
        isNotNull(missedCalls.tenantId),
        eq(missedCalls.textBackRoute, 'quote'),
        isNotNull(missedCalls.cadenceId),
        // Not older than the bound, by the reference instant (WR-05).
        or(
          and(isNotNull(missedCalls.endedAt), gte(missedCalls.endedAt, window.notBefore)),
          and(isNull(missedCalls.endedAt), gte(missedCalls.startedAt, window.notBefore)),
        ),
        // Not mid-send (WR-05): a `claimed` row decided after `stuckBefore`
        // waits a tick for its outcome.
        or(
          isNull(missedCalls.textBackStatus),
          ne(missedCalls.textBackStatus, 'claimed'),
          isNull(missedCalls.textBackDecidedAt),
          lte(missedCalls.textBackDecidedAt, window.stuckBefore),
        ),
        notExists(
          db
            .select({ id: escalations.id })
            .from(escalations)
            .where(eq(escalations.missedCallId, missedCalls.id)),
        ),
      ),
    )
    .orderBy(asc(missedCalls.startedAt), asc(missedCalls.id))
    .limit(limit);

  // The predicate makes both non-null; narrowed, not cast.
  return rows.flatMap((r) =>
    r.tenantId !== null && r.cadenceId !== null
      ? [{ missedCallId: r.missedCallId, tenantId: r.tenantId, cadenceId: r.cadenceId }]
      : [],
  );
}

/** One held escalation the release pass now owns: ids and the tradie's number. */
export interface ReleasedEscalation {
  id: string;
  tenantId: string;
  cadenceId: string;
  leadId: string | null;
  /** Set when the trigger was a hot reply; exactly one of the two is set. */
  inboundMessageId: string | null;
  /** Set when the trigger was a ring-twice call; exactly one of the two is set. */
  missedCallId: string | null;
  /**
   * The TRADIE's mobile as it stood at the hold, or `''` (there was nobody).
   * Informational only since 13-REVIEW WR-01: the release re-reads the
   * tenant's CURRENT escalation phone and texts that, never this.
   */
  toAddress: string;
  /**
   * When the hold was CLAIMED (`created_at`, the claiming tick's clock) —
   * 13-06: the release refuses `lead_closed` only for a lead that closed
   * AFTER this instant. A lead its own reply's label closed in the claiming
   * tick (a high-confidence `complaint` / `existing_job`) is still told:
   * closing never cancels the tradie hearing about it, held or not.
   */
  claimedAt: Date;
}

/**
 * RELEASE THE HELD ESCALATIONS WHOSE WINDOW HAS OPENED — AND THE RELEASE IS
 * THE CLAIM (Phase 13, D-09). At most `limit`, earliest window first.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ONE GUARDED UPDATE: `released_at = now` WHERE `hold_until <= now` AND     │
 * │ `released_at IS NULL` AND `outcome IS NULL`. Only the caller that gets a  │
 * │ row back may send it. Two overlapping ticks select the same ids in the   │
 * │ sub-select; the second blocks on the row lock, re-checks the guards      │
 * │ against the committed row and drops out of RETURNING — one text.         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * A THROW AFTER THIS LEAVES THE ROW RELEASED WITH `outcome IS NULL`, AND IT IS
 * NEVER RESENT. That is the 03-01 send-ledger rule for a tradie's handset: an
 * unknown is recorded as unknown, and the answer to an unknown is never a
 * second message. Nothing reads a released row again — the guard excludes it.
 *
 * The bound is an id sub-select ordered `hold_until, id` (the house tie-break)
 * on `escalations_held_idx`; the guards are repeated on the outer UPDATE so
 * the row-lock re-check, not the sub-select, decides. Dates are bound by
 * column comparison, never interpolated raw.
 *
 * Returns ids and the tradie's number only — no caller number, no body. The
 * release pass reads those afterwards through the tenant's own scope
 * (`inbound.byIdForEscalation`) or `getMissedCallForTextBack`.
 */
export async function claimHeldEscalationRelease(
  now: Date,
  limit: number,
): Promise<ReleasedEscalation[]> {
  const db = getDb();
  const due = db
    .select({ id: escalations.id })
    .from(escalations)
    .where(
      and(
        isNotNull(escalations.holdUntil),
        lte(escalations.holdUntil, now),
        isNull(escalations.releasedAt),
        isNull(escalations.outcome),
      ),
    )
    .orderBy(asc(escalations.holdUntil), asc(escalations.id))
    .limit(limit);

  return db
    .update(escalations)
    .set({ releasedAt: now, updatedAt: now })
    .where(
      and(
        inArray(escalations.id, due),
        // THE GUARDS, repeated: under READ COMMITTED a concurrent releaser
        // blocks on the row lock, re-checks these against the committed row
        // and drops out of RETURNING.
        isNotNull(escalations.holdUntil),
        lte(escalations.holdUntil, now),
        isNull(escalations.releasedAt),
        isNull(escalations.outcome),
      ),
    )
    .returning({
      id: escalations.id,
      tenantId: escalations.tenantId,
      cadenceId: escalations.cadenceId,
      leadId: escalations.leadId,
      inboundMessageId: escalations.inboundMessageId,
      missedCallId: escalations.missedCallId,
      toAddress: escalations.toAddress,
      claimedAt: escalations.createdAt,
    });
}

/** One held escalation as the digest counts it: whose, and until when. */
export interface HeldEscalationSince {
  tenantId: string;
  holdUntil: Date;
}

/**
 * EVERY ESCALATION HELD FOR A WINDOW AT OR AFTER `since` (Phase 13, D-08/D-09)
 * — the 06:30 digest's "held overnight" line.
 *
 * A tenant id and a time per row, NOTHING ELSE: no address, no trigger id, no
 * outcome. The digest says how many alerts waited for a client's morning, and
 * a list of who waited is not something it needs. Released or not, a hold
 * whose window is in range counts — the line is about what was held.
 */
export async function listHeldEscalationsSince(since: Date): Promise<HeldEscalationSince[]> {
  const rows = await getDb()
    .select({ tenantId: escalations.tenantId, holdUntil: escalations.holdUntil })
    .from(escalations)
    .where(and(isNotNull(escalations.holdUntil), gte(escalations.holdUntil, since)))
    .orderBy(asc(escalations.holdUntil), asc(escalations.id));

  // The predicate makes `holdUntil` non-null; narrowed, not cast.
  return rows.flatMap((row) =>
    row.holdUntil !== null ? [{ tenantId: row.tenantId, holdUntil: row.holdUntil }] : [],
  );
}

/** The lead a tradie's DONE answers: whose, and which. */
export interface LeadEscalationAnswered {
  tenantId: string;
  leadId: string;
}

/**
 * THE LEAD MOST RECENTLY ESCALATED TO `toAddress` AT ANY OF `tenantIds`,
 * SENT AT OR AFTER `since` (Phase 14, D-08) — the lead a tradie's DONE closes.
 *
 * `to_address` is the TRADIE's number as it was actually texted: the
 * normalised escalation phone at the immediate send, and — for a held row —
 * the number the release texted, which `recordEscalationOutcome` rewrites
 * beside the outcome (13-REVIEW WR-01). So a DONE answers the alert that
 * reached THAT handset, whenever it was released.
 *
 * Only a real send counts: `outcome = 'sent'` with `sent_at` in the window
 * (`>=`: at the boundary is inside). A refused, cooled-down or still-held row
 * reached nobody, so there is nothing for the tradie to be answering. Only a
 * LEAD escalation counts (`lead_id IS NOT NULL`); a quote alert has no lead.
 * Newest send first, one row — served by
 * `escalations_lead_to_address_sent_idx`.
 *
 * Cross-tenant by `tenantIds` because the caller asked "which clients own
 * this number?" first; it returns a tenant id and a lead id, never the
 * address it matched on.
 */
export async function latestSentLeadEscalationTo(
  tenantIds: readonly string[],
  toAddress: string,
  since: Date,
): Promise<LeadEscalationAnswered | null> {
  if (tenantIds.length === 0) return null;

  const rows = await getDb()
    .select({ tenantId: escalations.tenantId, leadId: escalations.leadId })
    .from(escalations)
    .where(
      and(
        inArray(escalations.tenantId, [...tenantIds]),
        eq(escalations.toAddress, toAddress),
        isNotNull(escalations.leadId),
        eq(escalations.outcome, 'sent'),
        gte(escalations.sentAt, since),
      ),
    )
    .orderBy(desc(escalations.sentAt), desc(escalations.id))
    .limit(1);

  const row = rows[0];
  // The predicate makes `leadId` non-null; narrowed, not cast.
  return row && row.leadId !== null ? { tenantId: row.tenantId, leadId: row.leadId } : null;
}

/** One ring-twice call still owed an escalation: ids only. */
export interface UnescalatedRingTwiceCall {
  missedCallId: string;
  tenantId: string;
  leadId: string;
  /** The open lead's live lead cadence, recorded on the skipped call (13-03). */
  cadenceId: string;
}

/** The bounds on what a ring-twice is (Phase 13, D-07). */
export interface RingTwiceWindow {
  /**
   * The oldest second call still told, by its reference instant
   * `coalesce(ended_at, started_at)` — `listUnescalatedQuoteCalls`' WR-05
   * reason: the SMS carries no time, so a backlog must not arrive as news.
   */
  notBefore: Date;
  /**
   * How far back the FIRST call may be: an earlier call from the same caller
   * at the same client started in `[second.started_at − windowMs,
   * second.started_at)`. `RING_TWICE_WINDOW_MINUTES` in milliseconds.
   */
  windowMs: number;
}

/**
 * THE SECOND CALLS NOBODY HAS TOLD THE TRADIE ABOUT YET (Phase 13, D-07):
 * a caller with an open lead rang again inside the window. Oldest first, at
 * most `limit`.
 *
 * A call `m2` qualifies when it belongs to a real tenant, is from a mobile,
 * was SKIPPED `recent_text` or `lead_open` (the Phase 12 gate decided no
 * second text — this pass never sends the CALLER anything), carries the
 * open lead's id AND its live cadence id (written on the skipped row by plan
 * 13-03, and an escalation row needs a cadence), its reference instant is not
 * older than `notBefore`, an EARLIER call `m1` from the same tenant and caller
 * started inside the window before it, NO escalation carries its id, and the
 * lead it names is still OPEN — a lead closed between the two calls is not a
 * hot lead.
 *
 * Lives here for `listUnescalatedQuoteCalls`' reason (it tests for this
 * family's never-twice key) and is the same mould: the `NOT EXISTS` is a hint,
 * `claimEscalationForMissedCall` is the guarantee. IDS ONLY — the caller's
 * number is compared inside the database between two rows and never selected;
 * the pass reads it through `getMissedCallForTextBack` after its claim.
 */
export async function listUnescalatedRingTwiceCalls(
  limit: number,
  window: RingTwiceWindow,
): Promise<UnescalatedRingTwiceCall[]> {
  const db = getDb();
  const first = alias(missedCalls, 'ring_twice_first');
  // A number, not a Date: bound as a parameter and cast, never spliced.
  const windowSeconds = window.windowMs / 1000;

  const rows = await db
    .select({
      missedCallId: missedCalls.id,
      tenantId: missedCalls.tenantId,
      leadId: missedCalls.leadId,
      cadenceId: missedCalls.cadenceId,
    })
    .from(missedCalls)
    .where(
      and(
        isNotNull(missedCalls.tenantId),
        eq(missedCalls.callerKind, 'mobile'),
        eq(missedCalls.textBackStatus, 'skipped'),
        inArray(missedCalls.textBackSkipReason, ['recent_text', 'lead_open']),
        isNotNull(missedCalls.leadId),
        isNotNull(missedCalls.cadenceId),
        // Not older than the bound, by the reference instant (WR-05).
        or(
          and(isNotNull(missedCalls.endedAt), gte(missedCalls.endedAt, window.notBefore)),
          and(isNull(missedCalls.endedAt), gte(missedCalls.startedAt, window.notBefore)),
        ),
        // THE RING-TWICE: an earlier call from the same caller at the same
        // client, started inside the window before this one.
        exists(
          db
            .select({ id: first.id })
            .from(first)
            .where(
              and(
                eq(first.tenantId, missedCalls.tenantId),
                eq(first.callerE164, missedCalls.callerE164),
                ne(first.id, missedCalls.id),
                lt(first.startedAt, missedCalls.startedAt),
                sql`${first.startedAt} >= ${missedCalls.startedAt} - make_interval(secs => ${windowSeconds}::double precision)`,
              ),
            ),
        ),
        notExists(
          db
            .select({ id: escalations.id })
            .from(escalations)
            .where(eq(escalations.missedCallId, missedCalls.id)),
        ),
        // The lead is still open — and at this client.
        exists(
          db
            .select({ id: leads.id })
            .from(leads)
            .where(
              and(
                eq(leads.id, missedCalls.leadId),
                eq(leads.tenantId, missedCalls.tenantId),
                eq(leads.status, 'open'),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(missedCalls.startedAt), asc(missedCalls.id))
    .limit(limit);

  // The predicate makes all three non-null; narrowed, not cast.
  return rows.flatMap((r) =>
    r.tenantId !== null && r.leadId !== null && r.cadenceId !== null
      ? [{ missedCallId: r.missedCallId, tenantId: r.tenantId, leadId: r.leadId, cadenceId: r.cadenceId }]
      : [],
  );
}

/**
 * Has this conversation already been escalated recently? (D-08's cooldown.)
 *
 * Keyed on the CADENCE, because a cadence is what a conversation IS here — one
 * quote, one customer, one chase — and reads the `(cadence_id, created_at)`
 * index the schema created for exactly this question. `LIMIT 1`: the caller
 * needs a yes or a no, and returning the rows would be a per-conversation
 * history nobody asked for.
 *
 * Counts EVERY prior escalation in the window, including refused ones. That is
 * deliberate: `sms_not_configured` twice in ten minutes is the same disarmed
 * deployment twice, and recording it twice would inflate exactly the number
 * Phase 7 reads as "hot leads we failed to reach".
 *
 * Asked BEFORE the claim, so the row this tick is about to insert cannot
 * suppress itself.
 *
 * `ignoreUnreleasedHolds` (Phase 13, 13-06, D-09): a HELD escalation that has
 * not been released has not reached anybody's phone, so it must not cool down
 * an emergency or keyword reply that D-09 sends regardless of the hour — the
 * 23:00 held enquiry would otherwise silence the 23:10 burst pipe until 08:00.
 * Only the immediate lead path passes it; every other caller (a second
 * non-emergency reply, a ring-twice, the quote paths) counts the held row as
 * before, so a burst behind a hold is suppressed like any burst.
 */
export async function recentEscalationForCadence(
  cadenceId: string,
  since: Date,
  options?: { ignoreUnreleasedHolds?: boolean },
): Promise<{ id: string } | null> {
  const rows = await getDb()
    .select({ id: escalations.id })
    .from(escalations)
    .where(
      and(
        eq(escalations.cadenceId, cadenceId),
        gte(escalations.createdAt, since),
        options?.ignoreUnreleasedHolds === true
          ? or(isNull(escalations.holdUntil), isNotNull(escalations.releasedAt))
          : undefined,
      ),
    )
    .orderBy(desc(escalations.createdAt))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * The four columns an outcome may set, plus `to_address` from ONE caller.
 *
 * 2026-10-09 (13-REVIEW WR-01): a held escalation is sent at release to the
 * tenant's escalation phone as it stands THEN, which may not be the number the
 * hold recorded at claim. `toAddress` lets the release write the number it
 * actually texted beside the outcome, so the evidence row stays true. Every
 * other caller omits it and the column is untouched.
 */
export interface EscalationOutcomePatch {
  /**
   * A member of `ESCALATION_OUTCOMES` (lower_snake_case, ours) or a `codeOf`
   * token from the provider (UPPERCASE, theirs). See the schema's comment on
   * why the two are distinguishable by shape.
   */
  outcome: string;
  /** Only ever set on a real acceptance. */
  sentAt?: Date | null;
  providerMessageId?: string | null;
  /** As the shared septet counter measured the body, for cost attribution. */
  bodySegments?: number | null;
  /**
   * The normalised mobile a release actually texted (WR-01). Omitted: the
   * claim's `to_address` stands.
   */
  toAddress?: string;
  /** The tick's pinned clock. */
  at: Date;
}

/**
 * Record what became of one claimed escalation. THE ONLY WRITER of `outcome`.
 *
 * GUARDED ON `outcome IS NULL`, in the house style (`markInboundTriaged`,
 * `writeClassification`, `updateDeliveryWhereMatch`). The claim and the outcome
 * are two statements with a provider HTTP call between them, so a redeploy or an
 * overlapping tick can in principle arrive second — and the FIRST answer is the
 * one that describes what actually happened to the message. A silent overwrite
 * would let a later `cooldown_suppressed` bury an earlier `sent`, which is the
 * one row Phase 7 bills a recovered job from.
 *
 * `bodySegments` is a bounded integer and the outcome code is bounded by
 * `codeOf`; there is no column here that can hold prose, which is what keeps a
 * provider's error text — which can quote the request, and the request carries a
 * mobile — out of the table by construction.
 */
export async function recordEscalationOutcome(
  id: string,
  patch: EscalationOutcomePatch,
): Promise<{ recorded: boolean }> {
  const rows = await getDb()
    .update(escalations)
    .set({
      outcome: patch.outcome,
      sentAt: patch.sentAt ?? null,
      providerMessageId: patch.providerMessageId ?? null,
      bodySegments: patch.bodySegments ?? null,
      ...(patch.toAddress === undefined ? {} : { toAddress: patch.toAddress }),
      updatedAt: patch.at,
    })
    .where(and(eq(escalations.id, id), isNull(escalations.outcome)))
    .returning({ id: escalations.id });

  return { recorded: rows.length > 0 };
}

/**
 * ONE ESCALATION AS THE ATTRIBUTION EVIDENCE CHAIN IS ALLOWED TO SEE IT.
 *
 * WRITTEN OUT rather than `Pick<Escalation, …>` for the reason
 * `ThreadedInboundEvidence` is (for-tenant.ts): on this table the dangerous
 * column is `to_address` — the TRADIE's mobile as it stood when the alert was
 * raised — and a `Pick` somebody widens is not a decision anybody typed.
 * `body_segments` is omitted too, not because it is sensitive but because it is
 * a COST measurement and an evidence chain that carries one invites a reader to
 * treat it as one.
 */
export interface EscalationEvidence {
  id: string;
  /**
   * NULL when the trigger was a missed call rather than a reply (Phase 12,
   * D-16): exactly one of the two triggers is set (`escalations_one_trigger`).
   */
  inboundMessageId: string | null;
  cadenceId: string;
  /** NULL on a lead-cadence conversation (Phase 12, D-18), which has no quote. */
  quoteId: string | null;
  sentAt: Date | null;
  outcome: string | null;
  createdAt: Date;
}

/**
 * RPT-01 — THE HOT-LEAD ALERTS RAISED ON ONE QUOTE, OLDEST FIRST.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS IS THE READ THE BARREL PROMISED PHASE 7 WOULD ADD, "WITH ITS OWN     │
 * │ ARGUMENT" — and the argument is: an escalation is the strongest single    │
 * │ piece of evidence that a chase produced the win. "We texted you within    │
 * │ minutes of them saying yes" is the sentence a client reads on the report  │
 * │ line, and it has to be reconstructible from the attribution row alone,    │
 * │ after the inbound message and the cadence are gone.                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * IT IS STILL NOT A LIST ACCESSOR. The 06-05 header refuses "a read-by-tenant"
 * because an evidence table with a convenience reader becomes a queryable log
 * of who replied to whom. This one is keyed on a SINGLE quote the caller
 * already holds, scoped by tenant in the same predicate, and returns no
 * address — there is no argument you can pass it that enumerates anything.
 *
 * `tenantId` TRAVELS IN THE CALL, like every other function in this file: the
 * escalation family lives outside `forTenant()` because `escalations` carries
 * `tenant_id` as a column with no foreign key, so a client who disconnects
 * cannot take the record of what we did on their behalf with them.
 *
 * Ordered `created_at ASC` — the order the alerts actually happened in, which
 * is the order the evidence chain stores them in (`buildEvidence` re-sorts on
 * the same key, so the stored jsonb is deterministic either way).
 */
export async function listEscalationsForQuote(
  tenantId: string,
  quoteId: string,
): Promise<EscalationEvidence[]> {
  return getDb()
    .select({
      id: escalations.id,
      inboundMessageId: escalations.inboundMessageId,
      cadenceId: escalations.cadenceId,
      quoteId: escalations.quoteId,
      sentAt: escalations.sentAt,
      outcome: escalations.outcome,
      createdAt: escalations.createdAt,
    })
    .from(escalations)
    .where(and(eq(escalations.tenantId, tenantId), eq(escalations.quoteId, quoteId)))
    .orderBy(escalations.createdAt);
}

/**
 * The evidence fields PLUS the provider's own id for the message — the pair a
 * proof rests on (D-02).
 *
 * `providerMessageId` is here and not on `EscalationEvidence` because the two
 * readers want different things. The attribution consumer reconstructs "we
 * texted you within minutes"; a PROOF has to be re-checkable at ClickSend by
 * somebody who was not there, and the provider's id is the only handle that
 * survives outside this database.
 *
 * STILL NO `to_address` AND NO `body_segments`, for the reason
 * `EscalationEvidence` states: the dangerous column on this table is the
 * TRADIE's mobile as it stood when the alert was raised, and the id goes into a
 * stored artefact.
 */
export interface EscalationProofEvidence extends EscalationEvidence {
  providerMessageId: string | null;
}

/**
 * ARM-03 / D-02 — ONE ESCALATION, BY ID, FOR THE TENANT WHO OWNS IT.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE OPERATOR PASTES THIS ID INTO A FORM, AND A PASTE IS UNTRUSTED INPUT   │
 * │ THAT NAMES A PRODUCTION ROW. The tenant is in the PREDICATE, not checked  │
 * │ afterwards: a read that fetched the row and then compared `tenantId` in   │
 * │ TypeScript is one early `return` away from proving another client's       │
 * │ escalation for this one (T-10-17).                                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `null` is the answer for BOTH "no such escalation" and "that escalation is
 * somebody else's", deliberately: the caller has nothing to say about the
 * difference that would not also tell a guesser which uuids exist.
 *
 * This is still not a list accessor (the file header's rule). It takes an id the
 * caller already holds and returns one row; there is no argument you can pass it
 * that enumerates anything.
 */
export async function getEscalationForTenant(
  tenantId: string,
  id: string,
): Promise<EscalationProofEvidence | null> {
  const rows = await getDb()
    .select({
      id: escalations.id,
      inboundMessageId: escalations.inboundMessageId,
      cadenceId: escalations.cadenceId,
      quoteId: escalations.quoteId,
      sentAt: escalations.sentAt,
      outcome: escalations.outcome,
      providerMessageId: escalations.providerMessageId,
      createdAt: escalations.createdAt,
    })
    .from(escalations)
    .where(and(eq(escalations.tenantId, tenantId), eq(escalations.id, id)))
    .limit(1);

  return rows[0] ?? null;
}
