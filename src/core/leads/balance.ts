/**
 * THE CLICKSEND BALANCE ALARM AND THE AUDITED AUTO-DISARM (Phase 12, D-07,
 * D-10, D-21; TXT-06) — the single place the two balance floors apply.
 *
 * The shared ClickSend balance has already hit zero once: the first live SMS
 * this system attempted failed `INSUFFICIENT_CREDIT`. A text-back that fails
 * for want of credit is a caller who rang a tradie and heard nothing back, so
 * the balance is read from the per-minute tick — no new cron job (D-01) — on
 * every fifteenth minute, and at once in a tick that saw a text-back refused
 * for want of credit, but ONLY while at least one client is armed.
 *
 *   below A$20.00  → one email per Perth day (the low-balance alert);
 *   below A$5.00   → every armed client's text-back is DISARMED through
 *                    `disarmChannelBySystem` — one audited `actor = 'system'`
 *                    row each, with the reason — and one email per Perth day
 *                    says how many.
 *
 * Both comparisons are STRICT: 1999 cents alerts and 2000 does not; 499
 * disarms and 500 does not.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ AN UNREADABLE BALANCE NEVER DISARMS AND NEVER SAYS "LOW" (T-12-21).      │
 * │ Credentials absent, an HTTP failure, a timeout, an unparseable figure,   │
 * │ a currency other than AUD: each is `probeFailed`, and raises one         │
 * │ "balance could not be read" email per Perth day. A provider outage, or a │
 * │ garbled response, is not an empty account — and a write that stops      │
 * │ every client's service must never be driven by one.                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * A NEGATIVE figure is READABLE, not a read failure (12-REVIEW CR-01): an
 * overdrawn ClickSend account (production read −A$20.87 on 6 Oct 2026) is
 * below both floors, so it disarms every armed client and sends the
 * auto-disarm email exactly as A$4.99 does. Every text-back attempted in that
 * state fails `INSUFFICIENT_CREDIT`.
 *
 * EMAIL ONLY, never SMS: an SMS about an empty SMS balance goes nowhere. Each
 * of the three emails is claim-then-send through `claimOperatorAlert` on
 * `operator_alert_log (kind, alert_day)`; a send that fails after its claim is
 * counted (`emailFailed`) and never retried by re-claiming.
 *
 * COUNTS ONLY out of here; every caught value discarded; framework-free.
 */
import { TZDate } from '@date-fns/tz';

import {
  buildAutoDisarmAlert,
  buildBalanceLowAlert,
  buildBalanceUnreadableAlert,
  clientsPageUrl,
} from '@/core/alerts/text-back-alerts';
import type { StalledEmailSender } from '@/core/alerts/stalled-drafts';
import {
  CLICKSEND_BALANCE_ALERT_FLOOR_CENTS,
  CLICKSEND_BALANCE_DISARM_FLOOR_CENTS,
} from '@/core/audit/constants';
import { centsFromDecimal, getAccountBalance } from '@/core/messaging/clicksend-client';
import {
  claimOperatorAlert,
  disarmChannelBySystem,
  listArmedTextBackTenantIds,
} from '@/db/repository';
import type { OperatorAlertKind } from '@/db/schema';

/** The probe's cadence inside the per-minute tick, in minutes past the hour. */
export const BALANCE_PROBE_EVERY_MINUTES = 15;

/** The operator's calendar: the alert latch rolls at Perth midnight (16:00 UTC). */
const ALERT_ZONE = 'Australia/Perth';

/**
 * The audit reason every auto-disarm row carries, derived from the floor so
 * the two cannot disagree: `auto: ClickSend balance below A$5`.
 */
export const AUTO_DISARM_REASON = `auto: ClickSend balance below A$${
  CLICKSEND_BALANCE_DISARM_FLOOR_CENTS / 100
}`;

/**
 * ClickSend's balance (a decimal string of dollars) as whole cents, rounded
 * DOWN with no floating-point arithmetic; `null` for anything that is not a
 * plain (optionally negative) decimal. `"19.999"` is 1999, `"0.029806"` is 2
 * and `"-20.87"` is -2087 — an overdraft, which disarms (CR-01). The
 * implementation sits at the provider boundary (`centsFromDecimal`), where the
 * balance read uses it too; this is its name for everyone else.
 */
export function parseBalanceCents(raw: unknown): number | null {
  return centsFromDecimal(raw);
}

/** What a readable balance calls for. Strict less-than against both floors (D-07). */
export function decideBalanceActions(cents: number): { alertLow: boolean; disarm: boolean } {
  return {
    alertLow: cents < CLICKSEND_BALANCE_ALERT_FLOOR_CENTS,
    disarm: cents < CLICKSEND_BALANCE_DISARM_FLOOR_CENTS,
  };
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * The Perth calendar date of `now`, `YYYY-MM-DD` — the key of the once-a-day
 * operator alert latch. Perth keeps no daylight saving, so the day rolls at
 * 16:00 UTC: 15:59:59 UTC and 16:00:00 UTC on one UTC date are two Perth days.
 */
export function perthAlertDay(now: Date): string {
  const perth = new TZDate(now.getTime(), ALERT_ZONE);
  return `${perth.getFullYear()}-${pad2(perth.getMonth() + 1)}-${pad2(perth.getDate())}`;
}

/** What one probe did. Counts only. */
export interface BalanceProbeCounts {
  /** `1` when the probe ran this tick (on the quarter hour or forced, with someone armed). */
  probed: number;
  /** `1` when the balance could not be read. Never a disarm, never a low alert. */
  probeFailed: number;
  /** `1` when the low-balance email left this tick. */
  lowAlerted: number;
  /** Clients whose text-back the system switched off this tick. */
  autoDisarmed: number;
  /** Operator emails claimed for today that did NOT leave (the tick adds this to `textBackAlertFailed`). */
  emailFailed: number;
}

export const NO_BALANCE_PROBE: BalanceProbeCounts = {
  probed: 0,
  probeFailed: 0,
  lowAlerted: 0,
  autoDisarmed: 0,
  emailFailed: 0,
};

export interface BalanceProbeInput {
  now: Date;
  /** Probe off the quarter hour — set when a text-back was refused for want of credit. */
  force: boolean;
  clicksend: { username: string | undefined; apiKey: string | undefined };
  fetchImpl?: typeof fetch;
  sendEmail: StalledEmailSender;
}

/**
 * READ THE BALANCE; ALERT BELOW A$20; DISARM EVERYONE BELOW A$5. See the
 * header. Never throws.
 */
export async function runBalanceProbe(input: BalanceProbeInput): Promise<BalanceProbeCounts> {
  const { now } = input;
  if (!input.force && now.getUTCMinutes() % BALANCE_PROBE_EVERY_MINUTES !== 0) {
    return { ...NO_BALANCE_PROBE };
  }

  // Nobody armed: no ClickSend call at all, and nothing to protect.
  let armed: string[];
  try {
    armed = await listArmedTextBackTenantIds();
  } catch {
    console.error('[balance] armed-client read failed this tick.');
    return { ...NO_BALANCE_PROBE };
  }
  if (armed.length === 0) return { ...NO_BALANCE_PROBE };

  const counts: BalanceProbeCounts = { ...NO_BALANCE_PROBE, probed: 1 };
  const day = perthAlertDay(now);

  /** Claim today's alert of this kind; send it if the claim is ours. */
  const alertOnce = async (
    kind: OperatorAlertKind,
    detail: Record<string, unknown>,
    build: () => { subject: string; body: string },
  ): Promise<boolean> => {
    let claimed: boolean;
    try {
      claimed = await claimOperatorAlert(kind, day, detail);
    } catch {
      console.error('[balance] alert latch failed this tick.');
      return false;
    }
    if (!claimed) return false;

    // ── PAST THIS LINE TODAY'S ALERT IS SPENT. A failure is a lost alert. ──
    try {
      const outcome = await input.sendEmail(build());
      if (outcome.ok) return true;
    } catch {
      // Not logged: see the header.
    }
    console.error('[balance] operator email failed after its claim.');
    counts.emailFailed += 1;
    return false;
  };

  const { username, apiKey } = input.clicksend;
  const read =
    username && apiKey
      ? await getAccountBalance({ username, apiKey }, { fetchImpl: input.fetchImpl })
      : ({ ok: false, reason: 'no_credentials' } as const);

  if (!read.ok) {
    // UNREADABLE IS NOT EMPTY. One email a day, and nothing else.
    counts.probeFailed = 1;
    await alertOnce('clicksend_balance_unreadable', { reason: read.reason }, () =>
      buildBalanceUnreadableAlert({
        reason: read.reason,
        armedClients: armed.length,
        at: now,
        clientsUrl: clientsPageUrl(),
      }),
    );
    return counts;
  }

  const { alertLow, disarm } = decideBalanceActions(read.balanceCents);

  if (disarm) {
    for (const tenantId of armed) {
      try {
        const result = await disarmChannelBySystem({
          channel: 'text_back',
          tenantId,
          reason: AUTO_DISARM_REASON,
        });
        if (result.kind === 'disarmed') counts.autoDisarmed += 1;
      } catch {
        // One client's flip failing must not leave the next one armed.
        console.error('[balance] one auto-disarm failed; continuing.');
      }
    }

    if (counts.autoDisarmed > 0) {
      // The disarm email carries the balance and the floor, so it stands in
      // for the low-balance email this tick.
      await alertOnce(
        'text_back_auto_disarmed',
        { disarmed: counts.autoDisarmed, balance_cents: read.balanceCents },
        () =>
          buildAutoDisarmAlert({
            balanceCents: read.balanceCents,
            disarmFloorCents: CLICKSEND_BALANCE_DISARM_FLOOR_CENTS,
            disarmedClients: counts.autoDisarmed,
            at: now,
            clientsUrl: clientsPageUrl(),
          }),
      );
      return counts;
    }
  }

  if (alertLow) {
    const sent = await alertOnce('clicksend_balance_low', { balance_cents: read.balanceCents }, () =>
      buildBalanceLowAlert({
        balanceCents: read.balanceCents,
        alertFloorCents: CLICKSEND_BALANCE_ALERT_FLOOR_CENTS,
        disarmFloorCents: CLICKSEND_BALANCE_DISARM_FLOOR_CENTS,
        armedClients: armed.length,
        at: now,
        clientsUrl: clientsPageUrl(),
      }),
    );
    counts.lowAlerted = sent ? 1 : 0;
  }

  return counts;
}
