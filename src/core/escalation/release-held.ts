/**
 * The window has opened: send the escalations D-09 held overnight, each ONCE
 * (Phase 13, plan 13-06, D-08/D-09, LEAD-03).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE RELEASE IS THE CLAIM. `claimHeldEscalationRelease` is one guarded     │
 * │ UPDATE — `released_at = now` WHERE `hold_until <= now AND released_at IS │
 * │ NULL AND outcome IS NULL` — and only the rows it RETURNS are this pass's. │
 * │ Two overlapping ticks release a row once; the loser drops out of          │
 * │ RETURNING on the row-lock re-check.                                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── A THROW AFTER THE RELEASE IS NEVER RETRIED ─────────────────────────────
 *
 * The row is released with `outcome IS NULL` — "claimed, outcome unknown" —
 * and nothing reads a released row again: the guard excludes it. The message
 * may have left, and the answer to an unknown is never a second message to a
 * tradie's handset (the 03-01 send-ledger rule). Counted `sendFailed`.
 *
 * ── NO COOLDOWN AT RELEASE ─────────────────────────────────────────────────
 *
 * The held row already holds the claim; the cooldown was asked when it was
 * held. Asking again here would let the held row — or a row it suppressed —
 * cool down its own release (the cooldown read counts every row in the
 * window, refused or held).
 *
 * ── A LEAD THAT CLOSED DURING THE HOLD IS NOT TOLD ─────────────────────────
 *
 * If the lead is no longer open and it closed AFTER the hold was claimed — the
 * tradie rang them, an operator closed it, a quote took over, the customer
 * opted out — the situation the alert describes is over: `lead_closed`, no
 * send. A lead that its own reply's label closed in the claiming tick (a
 * high-confidence `complaint` / `existing_job`, which are hot AND closing) is
 * still told: closing never cancels the tradie hearing about it, and the
 * immediate path would have told them at once.
 *
 * ── THE FACTS ARE READ AFTER THE RELEASE, THROUGH THE NARROW READS ─────────
 *
 * The hold stored ids and the tradie's number only. A held REPLY reads its
 * words through `forTenant(id).inbound.byIdForEscalation` and the cadence
 * snapshot for the name and number — `buildEscalationSms` exactly as the
 * hot-lead pass builds it. A held RING-TWICE reads the caller's number through
 * `getMissedCallForTextBack` and builds `buildRingTwiceEscalationSms`.
 *
 * THE RECIPIENT IS THE TENANT'S ESCALATION PHONE AS IT STANDS AT RELEASE
 * (13-REVIEW WR-01), re-read through `forTenant(id).tenant.get()` and
 * normalised exactly as the hot-lead pass normalises it — NOT the `to_address`
 * the hold recorded at 23:00. The operator's one reason to change that number
 * overnight is that it was wrong (an ex-employee, a typo that would text a
 * stranger), and a hold claimed before the edit must not text the number the
 * client removed. A number now gone or unrepairable is `no_escalation_number`
 * with no send. When a send is attempted, the number actually used is written
 * back to `to_address` with the outcome, so the evidence row names the handset
 * that was texted. The arming switch is asked again for the same reason: a
 * client can be disarmed overnight.
 *
 * ── NO SENDER, NO SCAN; COUNTS ONLY ────────────────────────────────────────
 *
 * Undefined sender: nothing is released (a release with nowhere to send would
 * burn the row for good). Integers out; caught values discarded.
 */
import { normalizeAuMobile } from '@/core/cadence/primary-contact';
import { RING_TWICE_WINDOW_MINUTES } from '@/core/leads/constants';
import { codeOf } from '@/core/messaging/clicksend-client';
import { resolveSmsFrom } from '@/core/messaging/routing-sender';
import {
  claimHeldEscalationRelease,
  forTenant,
  getMissedCallForTextBack,
  HOT_ESCALATION_CAP,
  recordEscalationOutcome,
  type ReleasedEscalation,
} from '@/db/repository';

import { LEAD_REPLY_SNIPPET, type EscalationSmsSender } from './escalate-hot-leads';
import {
  buildEscalationSms,
  buildRingTwiceEscalationSms,
  type EscalationSms,
} from './message';

/** Counts only — one field per different thing an operator would do. */
export interface ReleaseHeldCounts {
  /** A held escalation's SMS reached the provider and was accepted. */
  released: number;
  /**
   * Released and refused with ZERO provider calls: the lead closed during the
   * hold (`lead_closed`), the client's CURRENT escalation phone is gone or will
   * not normalise (`no_escalation_number`), or the client was disarmed
   * overnight (`sms_not_configured`).
   */
  refused: number;
  /** The provider refused it, or the row threw after its release (never retried). */
  sendFailed: number;
  /** `1` when no sender was supplied, so nothing was released. */
  unconfigured: number;
}

export const NO_RELEASES: ReleaseHeldCounts = {
  released: 0,
  refused: 0,
  sendFailed: 0,
  unconfigured: 0,
};

export interface ReleaseHeldEscalationsInput {
  /** `undefined` means "no client" — nothing is released. */
  sender?: EscalationSmsSender;
  /** The tick's pinned clock: what "the window has opened" is measured against. */
  now: Date;
  /** Rows per tick. Defaults to `HOT_ESCALATION_CAP`. */
  limit?: number;
}

/**
 * Did the lead this held row names close AFTER the hold was claimed?
 *
 * Missing, converted (closed with no `closed_at`) or closed later than the
 * claim: yes. Open, or closed at or before the claim instant (its own reply's
 * label, in the same tick): no.
 */
async function leadClosedDuringHold(row: ReleasedEscalation): Promise<boolean> {
  if (row.leadId === null) return false;
  const [lead] = await forTenant(row.tenantId).leads.byId(row.leadId);
  if (lead === undefined) return true;
  if (lead.status === 'open') return false;
  return lead.closedAt === null || lead.closedAt.getTime() > row.claimedAt.getTime();
}

/** The message the original trigger would have sent, built from facts read now. */
async function messageFor(row: ReleasedEscalation): Promise<EscalationSms> {
  const repo = forTenant(row.tenantId);

  if (row.inboundMessageId !== null) {
    const [reply] = await repo.inbound.byIdForEscalation(row.inboundMessageId);
    if (reply === undefined) throw new Error('held reply not found');
    const [cadence] = await repo.cadences.getById(row.cadenceId);
    const quoteId = cadence?.quoteId ?? null;
    const [quote] = quoteId === null ? [] : await repo.quotes.byId(quoteId);

    return buildEscalationSms({
      customerName: cadence?.contactName ?? null,
      // A lead reply has no quote to describe (D-18) — as the hot-lead pass.
      quoteSnippet: quoteId === null ? LEAD_REPLY_SNIPPET : (quote?.jobDescription ?? null),
      replyText: reply.body,
      customerMobile: cadence?.contactMobile ?? null,
    });
  }

  if (row.missedCallId !== null) {
    const call = await getMissedCallForTextBack(row.missedCallId);
    const callerMobile = call !== null && call.tenantId === row.tenantId ? call.callerE164 : null;
    return buildRingTwiceEscalationSms({
      customerMobile: callerMobile,
      minutes: RING_TWICE_WINDOW_MINUTES,
    });
  }

  // `escalations_one_trigger` makes this unreachable; a throw, not a guess.
  throw new Error('held escalation has no trigger');
}

/**
 * Release and send every held escalation whose window has opened. Counts.
 *
 * PER-ROW ISOLATION: one poisoned row must not strand the rest — and every row
 * here is already released, so a throw is final for that row.
 */
export async function releaseHeldEscalations(
  input: ReleaseHeldEscalationsInput,
): Promise<ReleaseHeldCounts> {
  const { sender, now, limit } = input;
  const counts: ReleaseHeldCounts = { ...NO_RELEASES };

  // NO SENDER, NO RELEASE. Releasing is irreversible.
  if (sender === undefined) {
    counts.unconfigured = 1;
    return counts;
  }

  const rows = await claimHeldEscalationRelease(now, limit ?? HOT_ESCALATION_CAP);
  if (rows.length === 0) return counts;

  for (const row of rows) {
    try {
      if (await leadClosedDuringHold(row)) {
        await recordEscalationOutcome(row.id, { outcome: 'lead_closed', at: now });
        counts.refused += 1;
        continue;
      }

      // The number as it stands NOW (WR-01), never the one the hold recorded.
      const [tenant] = await forTenant(row.tenantId).tenant.get();
      const to = normalizeAuMobile(tenant?.escalationPhone);
      if (to === null) {
        await recordEscalationOutcome(row.id, { outcome: 'no_escalation_number', at: now });
        counts.refused += 1;
        continue;
      }

      const from = await resolveSmsFrom(row.tenantId);
      if (from === null) {
        await recordEscalationOutcome(row.id, { outcome: 'sms_not_configured', at: now });
        counts.refused += 1;
        continue;
      }

      const message = await messageFor(row);

      const result = await sender({
        to,
        from,
        body: message.body,
        // THE ESCALATION ROW ID — the same row the hold claimed.
        customString: row.id,
      });

      if (result.ok) {
        await recordEscalationOutcome(row.id, {
          outcome: 'sent',
          sentAt: now,
          providerMessageId: result.messageId,
          bodySegments: message.segments,
          // The handset actually texted, which may differ from the claim's.
          toAddress: to,
          at: now,
        });
        counts.released += 1;
      } else {
        await recordEscalationOutcome(row.id, {
          outcome: codeOf(result.reason),
          bodySegments: message.segments,
          toAddress: to,
          at: now,
        });
        counts.sendFailed += 1;
      }
    } catch {
      // RELEASED, OUTCOME UNKNOWN, NEVER REVISITED: `released_at` is set, so
      // the guard excludes the row from every later release. The caught value
      // is discarded — it may carry a reply's words or a number.
      counts.sendFailed += 1;
    }
  }

  console.info(
    `[escalation-release] sent=${counts.released} refused=${counts.refused} ` +
      `failed=${counts.sendFailed}`,
  );

  return counts;
}
