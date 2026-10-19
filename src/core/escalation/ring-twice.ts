/**
 * A caller with an open lead rang the tradie AGAIN inside half an hour and was
 * missed again: tell the tradie, on their own phone, once (Phase 13, plan
 * 13-06, D-07, LEAD-03).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ EXACTLY ONCE PER SECOND CALL, AND THE UNIQUE INDEX IS WHY. The claim is  │
 * │ `claimEscalationForMissedCall` keyed on the SECOND call's                │
 * │ `missed_call_id` (`escalations_missed_call_uniq`); only the caller that   │
 * │ gets a row back sends. A third call inside the window has its own id and │
 * │ is claimed too — and meets the per-cadence cooldown, which records it    │
 * │ `cooldown_suppressed` without a send.                                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── WHAT THE SECOND CALL DOES NOT GET: A SECOND TEXT ───────────────────────
 *
 * The Phase 12 gate already decided that: the second call was recorded
 * `skipped` (`recent_text` or `lead_open`) and the caller was sent nothing.
 * This pass never texts the CALLER; its only recipient is the tradie.
 *
 * ── THE TRADIE IS NEVER TEXTED FOR A SINGLE MISS (D-08) ─────────────────────
 *
 * `listUnescalatedRingTwiceCalls` returns only a call with an EARLIER call
 * from the same mobile at the same client inside `RING_TWICE_WINDOW_MINUTES`,
 * whose lead is still open. A first call is never on it; nor is a second call
 * 31 minutes after the first.
 *
 * ── THE CADENCE ON THE CLAIM IS THE LEAD'S LIVE ONE ─────────────────────────
 *
 * Written onto the skipped call by 13-03 (`cadence_id` with `lead_id`), so the
 * cooldown here asks about the same conversation key as a hot reply on that
 * lead: a hot reply and a ring-twice inside 30 minutes buzz the tradie once.
 *
 * ── THE HOLD (D-09, research Open Question 6) ──────────────────────────────
 *
 * A call has no body, so it is never "immediate": outside the client's contact
 * window, with `after_hours_escalation` off, the claim carries `hold_until` =
 * the window's next opening and nothing is sent; `release-held.ts` sends it.
 *
 * ── THE GATES (D-04, D-05) ─────────────────────────────────────────────────
 *
 * `quote-call.ts`' exact order: the client's own escalation phone through
 * `normalizeAuMobile` (refuses rather than repairs), `resolveSmsFrom` before
 * the claim and before any HTTP (the arming switch is not exempt), the cooldown
 * before the claim so the row about to be inserted cannot suppress itself.
 * The caller's number is read through `getMissedCallForTextBack` only AFTER
 * the claim, and feeds only the message builder.
 *
 * ── NO SENDER, NO SCAN; COUNTS ONLY ────────────────────────────────────────
 *
 * Undefined sender: the pass does not read and does not claim. Integers out;
 * nothing logged but integers; every caught value discarded — a driver error
 * carries its statement parameters, and these include a caller's number.
 */
import { contactWindowOf } from '@/core/cadence/dispatch';
import { normalizeAuMobile } from '@/core/cadence/primary-contact';
import {
  QUOTE_CALL_ESCALATION_MAX_AGE_HOURS,
  RING_TWICE_WINDOW_MINUTES,
} from '@/core/leads/constants';
import { codeOf } from '@/core/messaging/clicksend-client';
import { resolveSmsFrom } from '@/core/messaging/routing-sender';
import {
  claimEscalationForMissedCall,
  forTenant,
  getMissedCallForTextBack,
  listUnescalatedRingTwiceCalls,
  recentEscalationForCadence,
  recordEscalationOutcome,
} from '@/db/repository';

import type { EscalationSmsSender } from './escalate-hot-leads';
import { escalationHoldUntil } from './hold';
import { buildRingTwiceEscalationSms, ESCALATION_COOLDOWN_MINUTES } from './message';

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;

/** Second calls one pass looks at — `QUOTE_CALL_ESCALATION_CAP`'s reasoning. */
export const RING_TWICE_ESCALATION_CAP = 25;

/** Counts only — one field per different thing an operator would do. */
export interface RingTwiceEscalationCounts {
  /** An SMS reached the provider and was accepted. */
  escalated: number;
  /** Claimed with `hold_until` (D-09): goes when the client's window opens. */
  held: number;
  /** Claimed and recorded `cooldown_suppressed`: the tradie was told recently. */
  cooldownSuppressed: number;
  /** Claimed and refused with ZERO provider calls: no phone, or disarmed. */
  refused: number;
  /** The provider refused it, or the row threw (a claimed one is never retried). */
  sendFailed: number;
  /** `1` when no sender was supplied, so the pass did not scan. */
  unconfigured: number;
}

export const NO_RING_TWICE_ESCALATIONS: RingTwiceEscalationCounts = {
  escalated: 0,
  held: 0,
  cooldownSuppressed: 0,
  refused: 0,
  sendFailed: 0,
  unconfigured: 0,
};

export interface EscalateRingTwiceCallsInput {
  /** `undefined` means "no client" — the pass does not scan. */
  sender?: EscalationSmsSender;
  /** The tick's pinned clock: the claim time, the cooldown's and the hold's reference. */
  now: Date;
  /** Rows per tick. Defaults to `RING_TWICE_ESCALATION_CAP`. */
  limit?: number;
}

/**
 * Tell every tradie whose caller rang twice inside the window. Counts.
 *
 * PER-ROW ISOLATION: one poisoned row must not strand the rest.
 */
export async function escalateRingTwiceCalls(
  input: EscalateRingTwiceCallsInput,
): Promise<RingTwiceEscalationCounts> {
  const { sender, now, limit } = input;
  const counts: RingTwiceEscalationCounts = { ...NO_RING_TWICE_ESCALATIONS };

  // NO SENDER, NO SCAN. A claim consumes the never-twice right for good.
  if (sender === undefined) {
    counts.unconfigured = 1;
    return counts;
  }

  // A second call too old to be news is not owed (WR-05's bound); the window
  // is how far back the FIRST call may be.
  const rows = await listUnescalatedRingTwiceCalls(limit ?? RING_TWICE_ESCALATION_CAP, {
    notBefore: new Date(now.getTime() - QUOTE_CALL_ESCALATION_MAX_AGE_HOURS * MS_PER_HOUR),
    windowMs: RING_TWICE_WINDOW_MINUTES * MS_PER_MINUTE,
  });
  if (rows.length === 0) return counts;

  const cooldownFrom = new Date(now.getTime() - ESCALATION_COOLDOWN_MINUTES * MS_PER_MINUTE);

  for (const row of rows) {
    try {
      // ── (a) WHO DO WE TEXT? The client's own escalation phone, only. ─────
      const [tenant] = await forTenant(row.tenantId).tenant.get();
      const to = normalizeAuMobile(tenant?.escalationPhone);

      // ── (b) MAY THIS DEPLOYMENT SEND AS THIS CLIENT? (D-04) ─────────────
      const from = to === null ? null : await resolveSmsFrom(row.tenantId);

      // ── (c) HAVE WE TOLD THEM ABOUT THIS LEAD RECENTLY? (D-08) ──────────
      //
      // On the lead's live cadence, before the claim. A held row counts: a
      // ring-twice is never immediate, so a burst behind a hold is one alert.
      const cooling =
        to !== null && from !== null
          ? await recentEscalationForCadence(row.cadenceId, cooldownFrom)
          : null;

      // ── (d) D-09: HELD UNTIL THE WINDOW OPENS? Never immediate. ─────────
      const holdUntil =
        tenant !== undefined && to !== null && from !== null && cooling === null
          ? escalationHoldUntil({
              now,
              window: contactWindowOf(tenant),
              immediate: false,
              afterHoursEscalation: tenant.afterHoursEscalation,
            })
          : null;

      // ── (e) THE CLAIM, on the SECOND call's id. Zero rows: not ours. ────
      const claimed = await claimEscalationForMissedCall({
        missedCallId: row.missedCallId,
        tenantId: row.tenantId,
        cadenceId: row.cadenceId,
        quoteId: null,
        leadId: row.leadId,
        // The empty string is "there was nobody" — see the column's comment.
        toAddress: to ?? '',
        holdUntil,
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

      // HELD: claimed, nothing sent, outcome NULL until the release pass.
      if (holdUntil !== null) {
        counts.held += 1;
        continue;
      }

      // The caller's number, read only now that the claim is ours, and only
      // for the `Call them:` line. A row from another client reads as none.
      const call = await getMissedCallForTextBack(row.missedCallId);
      const callerMobile = call !== null && call.tenantId === row.tenantId ? call.callerE164 : null;

      const message = buildRingTwiceEscalationSms({
        customerMobile: callerMobile,
        minutes: RING_TWICE_WINDOW_MINUTES,
      });

      const result = await sender({
        to,
        from,
        body: message.body,
        // THE ESCALATION ROW ID, never a ledger id — a receipt for it files as
        // `unmatched`, exactly as for every other escalation.
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
    `[ring-twice-escalation] sent=${counts.escalated} held=${counts.held} ` +
      `cooldown=${counts.cooldownSuppressed} refused=${counts.refused} failed=${counts.sendFailed}`,
  );

  return counts;
}
