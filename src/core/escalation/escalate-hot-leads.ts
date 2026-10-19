/**
 * The revenue moment, made structural: a customer says yes, and the tradie's
 * phone buzzes with their name, their quote, their words and their number
 * (CON-03, D-05 through D-08).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ EXACTLY ONCE PER HOT REPLY, AND THE UNIQUE INDEX IS WHY. The claim is    │
 * │ `INSERT … ON CONFLICT DO NOTHING RETURNING`; only the caller that gets a │
 * │ row back sends. Two overlapping ticks — pg_cron fires without waiting    │
 * │ for the previous response — therefore produce ONE text, decided by       │
 * │ Postgres rather than by a check-then-insert both of them can pass.       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── IT IS ITS OWN PASS, NOT PART OF CLASSIFICATION (Pitfall 7, D-13/D-14) ───
 *
 * `classifyInbound` writes four columns through three functions and that is the
 * whole of what model output may do to this database — the boundary
 * `tests/classification-privilege.test.ts` pins. Sending an SMS from inside it
 * would widen that boundary to "and it can also make a phone ring", and Phase 5
 * decided explicitly that no label triggers a state transition. This pass
 * CONSUMES the stored `is_hot`; it never re-derives it (`isHotLead` stays
 * private to the classifier, so the product rule can change without rewriting
 * history) and it never moves a cadence.
 *
 * Being a SCAN rather than a hand-off is also the self-healing property: a tick
 * that crashed between classifying and escalating, or a deploy in the gap,
 * would otherwise leave that lead unescalated forever with nothing to notice.
 * Asking "hot and not yet escalated" every minute costs a missed lead a minute.
 *
 * ── WHICH GATES ARE EXEMPTED, AND THE ONE THAT IS NOT (D-05) ───────────────
 *
 * EXEMPT, because the recipient is the TRADIE and not a chased contact:
 *
 *   contact hours   — for a QUOTE reply: a hot quote reply at 7pm reaches
 *                     them at 7pm. That is the product; DNCR discipline
 *                     governs messages to consumers.
 *                     A LEAD reply obeys D-09 instead (Phase 13, 13-06):
 *                     outside the client's contact window it is HELD — claimed
 *                     with `hold_until` = the window's next opening, nothing
 *                     sent — unless the client's `after_hours_escalation`
 *                     switch is on, or the reply is emergency urgency or a
 *                     keyword hit, which go at once regardless (a caller in an
 *                     emergency at 11 pm is precisely who rang). The release
 *                     pass (`release-held.ts`) sends a held row once.
 *   the approval gate — nobody hand-approves an alert to the business owner
 *                     about their own customer.
 *   suppression     — `suppressed_contacts` is a record of customers who asked
 *                     never to be chased. The tradie is not in it and must not
 *                     be looked up in it.
 *
 * NOT EXEMPT:
 *
 *   THE D-04 ARMING SWITCH. The from-number is resolved through `resolveSmsFrom`
 *   — the same per-tenant question dispatch asks, in the same function — so a
 *   deployment with no enabled `messaging_config` sms row sends NOTHING and
 *   records `sms_not_configured` with ZERO provider calls. That is the current
 *   production state (04-07 disarmed the global row deliberately), and without
 *   this gate a remote test run would page a tradie about seeded data.
 *
 * ── AND THE SENDER IS INJECTED, WITH NO IMPLICIT FALLBACK ──────────────────
 *
 * `sender` undefined means the pass DOES NOT RUN AND DOES NOT SCAN
 * (`escalationUnconfigured: 1`). It deliberately does not build a real client
 * from the environment — the 05-06 lesson about a default that seventeen call
 * sites inherit — and it deliberately does not "run anyway and record
 * refusals", because claiming a row consumes the never-twice right for good.
 * Every remote suite in this repository runs `runCadenceTick` against the hosted
 * database; a pass that claimed rows without a sender would burn a real client's
 * hot lead from a test run.
 *
 * ── COUNTS ONLY, AND NOT ONE WORD OF THE REPLY (T-2-02, T-6-17) ────────────
 *
 * The result is integers. Nothing here logs a body, an address, a name, a quote
 * or a caught error value: the reply text exists in exactly two places — the
 * `inbound_messages` row behind RLS, and the SMS on the tradie's handset.
 */
import { contactWindowOf } from '@/core/cadence/dispatch';
import { normalizeAuMobile } from '@/core/cadence/primary-contact';
import { codeOf, sendSms, type SendSmsInput, type SendSmsResult } from '@/core/messaging/clicksend-client';
import { resolveSmsFrom } from '@/core/messaging/routing-sender';
import {
  claimEscalation,
  forAllTenants_hotUnescalated,
  forTenant,
  recentEscalationForCadence,
  recordEscalationOutcome,
} from '@/db/repository';
import type { Tenant } from '@/db/schema';

import { escalationHoldUntil, isImmediateEscalation } from './hold';
import { buildEscalationSms, ESCALATION_COOLDOWN_MINUTES } from './message';

const MS_PER_MINUTE = 60_000;

/**
 * What the SMS says the reply is ABOUT when it is on a LEAD cadence (12-05,
 * D-18): there is no quote and no job description — the customer is replying
 * to the text-back their missed call triggered, and the tradie reads that.
 */
export const LEAD_REPLY_SNIPPET = 'missed call';

/**
 * The seam the tick injects across — the shape of `sendSms` with its credentials
 * already bound.
 *
 * DELIBERATELY THE PROVIDER CALL AND NOT A `TouchSender`. `TouchSender` speaks
 * in `send_ledger` ids, cadence ids and touch numbers, none of which exist here:
 * an escalation is not a cadence touch, has no ledger row by design (D-05 —
 * writing one would put a message to the business owner in the table Phase 7
 * bills recovered revenue from), and carries the ESCALATION row id as its
 * `customString`. Reusing the cadence interface would have meant lying in four
 * fields to satisfy it.
 */
export type EscalationSmsSender = (input: SendSmsInput) => Promise<SendSmsResult>;

/**
 * The real one, built ONLY where credentials are in hand. Returns `undefined`
 * when this deployment cannot reach ClickSend at all — the `reconcile.ts`
 * read-and-refuse-if-missing shape, which is what makes "zero HTTP calls when
 * unconfigured" a property rather than a hope.
 */
export function buildEscalationSender(creds: {
  username?: string;
  apiKey?: string;
}): EscalationSmsSender | undefined {
  const { username, apiKey } = creds;
  if (!username || !apiKey) return undefined;
  return (input) => sendSms(input, { username, apiKey });
}

/**
 * Counts only — the `ClassifyCounts` discipline (T-3-24), split by the 05-04
 * rule: one field per DIFFERENT THING AN OPERATOR WOULD DO.
 */
export interface EscalationCounts {
  /** An SMS was accepted by the provider. The number that means the product worked. */
  hotEscalated: number;
  /**
   * A second hot reply on a conversation we texted about inside
   * `ESCALATION_COOLDOWN_MINUTES`. Recorded, not dropped — Phase 7 computes
   * reach latency from these rows and cannot reconstruct a silence.
   * Nothing to do about it.
   */
  cooldownSuppressed: number;
  /**
   * The client has no textable escalation mobile on file. THE FIX IS A PHONE
   * NUMBER SOMEBODY CAN GO AND ADD, which is why this is not lumped with the
   * one below.
   */
  noNumber: number;
  /**
   * No enabled sms `messaging_config` row applies to that client. The fix is a
   * row flip (D-04), not a phone number and not a deploy.
   */
  notConfigured: number;
  /** The provider refused it, and said why. Look at that specific number. */
  sendFailed: number;
  /**
   * Phase 13 (D-09): a hot LEAD reply outside the client's contact window,
   * switch off, neither emergency nor keyword — CLAIMED with `hold_until` and
   * not sent. Its outcome stays NULL until the release pass sends it once.
   * Nothing to do: it goes when the window opens.
   */
  held: number;
  /**
   * The row is claimed and its outcome is NULL: our own code or the database
   * threw somewhere we cannot classify. NOTHING RETRIES IT — the send may have
   * happened, and the response to an unknown must never be to send again
   * (the 03-01 send-ledger rule, restated for a tradie's handset).
   */
  deferred: number;
  /**
   * `1` when there is no sender and the pass did not run at all.
   *
   * A FLAG SHAPED LIKE A COUNT, exactly like `ClassifyCounts.unconfigured`:
   * with no sender we do not scan, so there is no number of rows to report. It
   * is its own field rather than part of `deferred` because "nothing is wired"
   * and "something threw" are read differently at 3am, and folding them would
   * make a missing credential look like a bug.
   */
  unconfigured: number;
}

export const NO_ESCALATIONS: EscalationCounts = {
  hotEscalated: 0,
  cooldownSuppressed: 0,
  noNumber: 0,
  notConfigured: 0,
  sendFailed: 0,
  held: 0,
  deferred: 0,
  unconfigured: 0,
};

export interface EscalateHotLeadsInput {
  /** `undefined` means "no client" — the pass does not scan. See the header. */
  sender?: EscalationSmsSender;
  /** The tick's pinned clock. Written to `sent_at` and used for the cooldown. */
  now: Date;
  /** Rows per tick. Defaults to `HOT_ESCALATION_CAP`. */
  limit?: number;
}

/**
 * Tell every tradie whose customer just said yes. Returns counts.
 *
 * PER-ROW ISOLATION, the 04-09 rule every pass in this tick follows: one
 * poisoned row — an unparseable number, a driver hiccup — must not strand the
 * rest. The catch discards the caught value, because a driver error carries the
 * statement and this statement's parameters are a customer's words.
 */
export async function escalateHotLeads(
  input: EscalateHotLeadsInput,
): Promise<EscalationCounts> {
  const { sender, now, limit } = input;
  const counts: EscalationCounts = { ...NO_ESCALATIONS };

  // NO SENDER, NO SCAN. See the header — claiming a row is irreversible, so a
  // pass with nowhere to send must not consume anybody's never-twice right.
  if (sender === undefined) {
    counts.unconfigured = 1;
    return counts;
  }

  const rows = await forAllTenants_hotUnescalated(limit);
  if (rows.length === 0) return counts;

  const cooldownFrom = new Date(now.getTime() - ESCALATION_COOLDOWN_MINUTES * MS_PER_MINUTE);

  /**
   * One lookup per TENANT rather than per row: a burst of replies to one client
   * is the ordinary shape of a busy morning, and both questions have the same
   * answer for every row of that client within a tick.
   */
  const tenantRows = new Map<string, Tenant | null>();
  const fromNumbers = new Map<string, string | null>();

  for (const row of rows) {
    try {
      // ── (a) WHO DO WE TEXT? The tradie, and only ever the tradie. ────────
      //
      // `tenants.escalation_phone` is stored COMPACT-LOCAL (`normalisePhone`
      // strips separators and nothing else), so it MUST pass through
      // `normalizeAuMobile` before it can be sent to. That function refuses
      // rather than repairs — a restored leading zero is a guess whose wrong
      // answer texts a stranger — so an unrepairable number is the same
      // recorded refusal as an absent one.
      //
      // The tenant row is kept whole (not just the phone) because the D-09
      // hold below reads its contact window and its after-hours switch.
      if (!tenantRows.has(row.tenantId)) {
        const [tenantRow] = await forTenant(row.tenantId).tenant.get();
        tenantRows.set(row.tenantId, tenantRow ?? null);
      }
      const tenant = tenantRows.get(row.tenantId) ?? null;
      const to = normalizeAuMobile(tenant?.escalationPhone);

      // ── (b) MAY THIS DEPLOYMENT SEND AS THIS CLIENT? (D-04) ─────────────
      //
      // The SAME function dispatch asks. Asked BEFORE the claim and before any
      // HTTP, so a disarmed deployment reaches the provider zero times.
      if (to !== null && !fromNumbers.has(row.tenantId)) {
        fromNumbers.set(row.tenantId, await resolveSmsFrom(row.tenantId));
      }
      const from = to === null ? null : (fromNumbers.get(row.tenantId) ?? null);

      // ── A REPLY ON A LEAD CADENCE (12-05, D-18; Phase 13) ────────────────
      //
      // No quote: the cadence is a missed-call text-back's, and the scan
      // carries its lead (`cadences.lead_id`, 13-03) so the row names it. The
      // SMS says "missed call" where a quote's description would go. Same
      // gates, same cooldown, same counts — plus the D-09 hold in (d).
      const leadId = row.quoteId === null ? row.leadId : null;
      const immediate = leadId !== null && isImmediateEscalation(row);

      // ── (c) HAVE WE ALREADY TEXTED THEM ABOUT THIS CONVERSATION? (D-08) ──
      //
      // Asked BEFORE the claim so the row we are about to insert cannot
      // suppress itself. An IMMEDIATE lead reply (emergency or keyword) does
      // not count a still-held row: that alert has reached nobody yet, and
      // D-09 sends an emergency regardless of the hour.
      const cooling =
        to !== null && from !== null
          ? await recentEscalationForCadence(
              row.cadenceId,
              cooldownFrom,
              immediate ? { ignoreUnreleasedHolds: true } : undefined,
            )
          : null;

      // ── (d) D-09: HELD UNTIL THE WINDOW OPENS? Lead replies only. ────────
      //
      // Only a row that would otherwise SEND is ever held: a refusal (no
      // phone, disarmed, cooling) is recorded at once, as before. A quote row
      // is never evaluated — contact hours stay exempt for quote replies.
      const holdUntil =
        leadId !== null && tenant !== null && to !== null && from !== null && cooling === null
          ? escalationHoldUntil({
              now,
              window: contactWindowOf(tenant),
              immediate,
              afterHoursEscalation: tenant.afterHoursEscalation,
            })
          : null;

      // ── (e) THE CLAIM. Everything above decided WHAT to record; this
      //        decides WHETHER we are the one to record it. ────────────────
      const claimed = await claimEscalation({
        inboundMessageId: row.inboundMessageId,
        tenantId: row.tenantId,
        cadenceId: row.cadenceId,
        quoteId: row.quoteId,
        leadId,
        // The empty string is "there was nobody" — see the column's comment.
        toAddress: to ?? '',
        // Phase 13 (D-09): the window's next opening when held, else NULL.
        // A HOLD IS A CLAIM — it leaves the hot scan at once, so a held
        // backlog can never fill HOT_ESCALATION_CAP (research Pitfall 4).
        holdUntil,
        at: now,
      });

      // Another tick owns this reply. Not a failure, not a count: exactly one
      // pass will report what happened to it, and it is not this one.
      if (claimed === null) continue;

      if (to === null) {
        await recordEscalationOutcome(claimed.id, { outcome: 'no_escalation_number', at: now });
        counts.noNumber += 1;
        continue;
      }

      if (from === null) {
        await recordEscalationOutcome(claimed.id, { outcome: 'sms_not_configured', at: now });
        counts.notConfigured += 1;
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

      const message = buildEscalationSms({
        customerName: row.contactName,
        // A missed call text-back's reply has no quote to describe (D-18).
        quoteSnippet: row.quoteId === null ? LEAD_REPLY_SNIPPET : row.quoteDescription,
        replyText: row.body,
        customerMobile: row.contactMobile,
      });

      const result = await sender({
        to,
        from,
        body: message.body,
        // THE ESCALATION ROW ID, deliberately not a `send_ledger` id. A receipt
        // for this message therefore matches no ledger row and is filed as
        // `unmatched` — asserted, because misfiling it would stamp a delivery
        // status onto somebody's customer send (research A4, T-6-20).
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
        counts.hotEscalated += 1;
      } else {
        // THE PROVIDER'S REASON, THROUGH `codeOf`. Bounded to 48 characters and
        // digit-runs redacted, because that column is read on an operator's
        // screen and a provider's prose can quote our request — which carries a
        // mobile number. UPPERCASE by construction, which is how a reader tells
        // a provider's verdict from one of ours (see ESCALATION_OUTCOMES).
        await recordEscalationOutcome(claimed.id, {
          outcome: codeOf(result.reason),
          bodySegments: message.segments,
          at: now,
        });
        counts.sendFailed += 1;
      }
    } catch {
      // THE ROW STAYS CLAIMED WITH A NULL OUTCOME, AND NOTHING RETRIES IT.
      // "Claimed, outcome unknown" is the honest record when we cannot tell
      // whether the message left; the obvious response to a definite failure is
      // a retry, and a retry here is how a tradie is texted twice about one
      // lead. The caught value is discarded — see the header.
      counts.deferred += 1;
    }
  }

  console.info(
    `[escalation] sent=${counts.hotEscalated} cooldown=${counts.cooldownSuppressed} ` +
      `no_number=${counts.noNumber} not_configured=${counts.notConfigured} ` +
      `failed=${counts.sendFailed} held=${counts.held} deferred=${counts.deferred}`,
  );

  return counts;
}
