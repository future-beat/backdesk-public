/**
 * A quote customer rang the tradie and was missed: tell the tradie, on their
 * own phone, once (Phase 12, plan 12-05, D-16, TXT-04).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ EXACTLY ONCE PER MISSED CALL, AND THE UNIQUE INDEX IS WHY. The claim is  │
 * │ `claimEscalationForMissedCall` — `INSERT … ON CONFLICT DO NOTHING        │
 * │ RETURNING` on `escalations_missed_call_uniq`; only the caller that gets  │
 * │ a row back sends. Two overlapping ticks therefore produce ONE text to    │
 * │ the tradie, decided by Postgres rather than by a check both can pass.    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `escalateHotLeads`' exact shape, with the trigger swapped: there the
 * customer REPLIED "yes"; here the customer RANG, the call attached to their
 * live quote cadence (`text_back_route = 'quote'`, D-08), and they were sent
 * the about-quote text — or, on a repeat call, were not sent a second one.
 * Either way the tradie should know a customer with an open quote is trying
 * to reach them.
 *
 * ── WHICH GATES ARE EXEMPTED, AND THE ONE THAT IS NOT (D-05, restated) ─────
 *
 * EXEMPT, because the recipient is the TRADIE and not a chased contact:
 * contact hours (an after-hours call reaches the tradie at that hour — a
 * per-client after-hours switch is Phase 13, LEAD-03), the approval gate, and
 * suppression (the tradie is not a customer who asked not to be chased).
 *
 * NOT EXEMPT: THE D-04 ARMING SWITCH. The from-number is resolved through
 * `resolveSmsFrom`, the same per-tenant question dispatch and the hot-lead
 * pass ask, BEFORE the claim and before any HTTP — so a client with no
 * enabled SMS row is recorded `sms_not_configured` with ZERO provider calls.
 *
 * ── THE RECIPIENT IS THE CLIENT'S OWN ESCALATION PHONE, AND NOTHING ELSE ───
 *
 * Read through `forTenant(row.tenantId)` and normalised by
 * `normalizeAuMobile`, which refuses rather than repairs. No other number is
 * ever a recipient here (T-12-29): an absent or unrepairable phone is the
 * recorded refusal `no_escalation_number`.
 *
 * ── THE COOLDOWN IS ASKED BEFORE THE CLAIM ─────────────────────────────────
 *
 * `recentEscalationForCadence` on the QUOTE cadence — the same conversation
 * key as a hot reply on it — so a second call (or a hot reply and a call)
 * inside `ESCALATION_COOLDOWN_MINUTES` is claimed and recorded
 * `cooldown_suppressed`, never sent. Asked first so the row this pass is
 * about to insert cannot suppress itself.
 *
 * ── NO SENDER, NO SCAN ─────────────────────────────────────────────────────
 *
 * It rides the tick's existing `escalationSender` seam. Undefined means the
 * pass does not read and does not claim (`unconfigured: 1`): a claim consumes
 * the never-twice right for that call for good, and every remote suite runs
 * `runCadenceTick` against the hosted database.
 *
 * ── COUNTS ONLY ────────────────────────────────────────────────────────────
 *
 * Integers out; nothing logged but integers; every caught value discarded — a
 * driver error carries its statement parameters, and these include a
 * customer's number. Framework-free.
 */
import { normalizeAuMobile } from '@/core/cadence/primary-contact';
import {
  ABOUT_QUOTE_TOUCH_NUMBER,
  QUOTE_CALL_ESCALATION_MAX_AGE_HOURS,
  TEXT_BACK_STUCK_MINUTES,
} from '@/core/leads/constants';
import { codeOf } from '@/core/messaging/clicksend-client';
import { resolveSmsFrom } from '@/core/messaging/routing-sender';
import {
  claimEscalationForMissedCall,
  forTenant,
  listUnescalatedQuoteCalls,
  recentEscalationForCadence,
  recordEscalationOutcome,
} from '@/db/repository';

import type { EscalationSmsSender } from './escalate-hot-leads';
import { buildQuoteCallEscalationSms, ESCALATION_COOLDOWN_MINUTES } from './message';

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;

/**
 * Missed quote calls one pass looks at. Twenty-five is far beyond any minute
 * fifteen clients produce, and bounds the SMS burst a backlog could cause;
 * anything left is taken next tick, oldest first.
 */
export const QUOTE_CALL_ESCALATION_CAP = 25;

/** Counts only — one field per different thing an operator would do. */
export interface QuoteCallEscalationCounts {
  /** An SMS reached the provider and was accepted. */
  escalated: number;
  /** Claimed and recorded `cooldown_suppressed`: the tradie was told recently. */
  cooldownSuppressed: number;
  /**
   * Claimed and recorded as a named refusal with ZERO provider calls: the
   * client has no textable escalation phone (`no_escalation_number`), or no
   * enabled SMS row applies to them (`sms_not_configured`).
   */
  refused: number;
  /**
   * The provider refused it (its code recorded), or the row threw — before
   * the claim (retried next tick) or after it (left claimed with a NULL
   * outcome and NEVER retried: the message may have left).
   */
  sendFailed: number;
  /** `1` when no sender was supplied, so the pass did not scan. */
  unconfigured: number;
}

export const NO_QUOTE_CALL_ESCALATIONS: QuoteCallEscalationCounts = {
  escalated: 0,
  cooldownSuppressed: 0,
  refused: 0,
  sendFailed: 0,
  unconfigured: 0,
};

export interface EscalateQuoteCallsInput {
  /** `undefined` means "no client" — the pass does not scan. See the header. */
  sender?: EscalationSmsSender;
  /** The tick's pinned clock: the claim time and the cooldown's reference. */
  now: Date;
  /** Rows per tick. Defaults to `QUOTE_CALL_ESCALATION_CAP`. */
  limit?: number;
}

/**
 * Tell every tradie whose quote customer just rang and was missed. Counts.
 *
 * PER-ROW ISOLATION: one poisoned row must not strand the rest.
 */
export async function escalateQuoteCalls(
  input: EscalateQuoteCallsInput,
): Promise<QuoteCallEscalationCounts> {
  const { sender, now, limit } = input;
  const counts: QuoteCallEscalationCounts = { ...NO_QUOTE_CALL_ESCALATIONS };

  // NO SENDER, NO SCAN. See the header.
  if (sender === undefined) {
    counts.unconfigured = 1;
    return counts;
  }

  // THE TWO TIME BOUNDS (12-REVIEW WR-05), at the tick clock: a call too old
  // to be news is not owed; a call whose about-quote text is still in flight
  // waits a tick for its outcome.
  const rows = await listUnescalatedQuoteCalls(limit ?? QUOTE_CALL_ESCALATION_CAP, {
    notBefore: new Date(now.getTime() - QUOTE_CALL_ESCALATION_MAX_AGE_HOURS * MS_PER_HOUR),
    stuckBefore: new Date(now.getTime() - TEXT_BACK_STUCK_MINUTES * MS_PER_MINUTE),
  });
  if (rows.length === 0) return counts;

  const cooldownFrom = new Date(now.getTime() - ESCALATION_COOLDOWN_MINUTES * MS_PER_MINUTE);

  for (const row of rows) {
    try {
      const repo = forTenant(row.tenantId);

      // ── (a) WHO DO WE TEXT? The client's own escalation phone, only. ─────
      const [tenant] = await repo.tenant.get();
      const to = normalizeAuMobile(tenant?.escalationPhone);

      // ── (b) MAY THIS DEPLOYMENT SEND AS THIS CLIENT? (D-04) ─────────────
      const from = to === null ? null : await resolveSmsFrom(row.tenantId);

      // ── (c) HAVE WE TOLD THEM ABOUT THIS CONVERSATION RECENTLY? ─────────
      const cooling =
        to !== null && from !== null
          ? await recentEscalationForCadence(row.cadenceId, cooldownFrom)
          : null;

      // ── (d) THE QUOTE CADENCE SNAPSHOT, read through the tenant scope. ──
      const [cadence] = await repo.cadences.getById(row.cadenceId);
      const quoteId = cadence?.quoteId ?? null;

      // ── (e) THE CLAIM. Zero rows: another process owns this call. ───────
      const claimed = await claimEscalationForMissedCall({
        missedCallId: row.missedCallId,
        tenantId: row.tenantId,
        cadenceId: row.cadenceId,
        quoteId,
        // Phase 13 (13-03): a quote call names no lead and is never held.
        leadId: null,
        // The empty string is "there was nobody" — see the column's comment.
        toAddress: to ?? '',
        holdUntil: null,
        at: now,
      });
      if (claimed === null) continue;

      if (to === null) {
        await recordEscalationOutcome(claimed.id, { outcome: 'no_escalation_number', at: now });
        counts.refused += 1;
        continue;
      }

      if (from === null) {
        await recordEscalationOutcome(claimed.id, { outcome: 'sms_not_configured', at: now });
        counts.refused += 1;
        continue;
      }

      if (cooling !== null) {
        await recordEscalationOutcome(claimed.id, { outcome: 'cooldown_suppressed', at: now });
        counts.cooldownSuppressed += 1;
        continue;
      }

      // What the tradie is told: who, which quote, whether the customer got
      // the about-quote text (accepted by the provider — an unknown outcome
      // is never told as "texted"), and the number to ring.
      const [quote] = quoteId === null ? [] : await repo.quotes.byId(quoteId);
      const ledger = await repo.ledger.listForCadence(row.cadenceId);
      const textSent = ledger.some(
        (entry) => entry.touchNumber === ABOUT_QUOTE_TOUCH_NUMBER && entry.outcome === 'sent',
      );

      const message = buildQuoteCallEscalationSms({
        customerName: cadence?.contactName ?? null,
        quoteSnippet: quote?.jobDescription ?? null,
        customerMobile: cadence?.contactMobile ?? null,
        textSent,
      });

      const result = await sender({
        to,
        from,
        body: message.body,
        // THE ESCALATION ROW ID, never a ledger id — a receipt for it files
        // as `unmatched`, exactly as for a hot-lead escalation.
        customString: claimed.id,
      });

      if (result.ok) {
        await recordEscalationOutcome(claimed.id, {
          outcome: 'sent',
          sentAt: now,
          providerMessageId: result.messageId,
          bodySegments: message.segments,
          at: now,
        });
        counts.escalated += 1;
      } else {
        await recordEscalationOutcome(claimed.id, {
          outcome: codeOf(result.reason),
          bodySegments: message.segments,
          at: now,
        });
        counts.sendFailed += 1;
      }
    } catch {
      // Claimed rows stay claimed with a NULL outcome and are never retried;
      // an unclaimed row is listed again next tick. The value is discarded.
      counts.sendFailed += 1;
    }
  }

  console.info(
    `[quote-call-escalation] sent=${counts.escalated} cooldown=${counts.cooldownSuppressed} ` +
      `refused=${counts.refused} failed=${counts.sendFailed}`,
  );

  return counts;
}
