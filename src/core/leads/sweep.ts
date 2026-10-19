/**
 * THE TEXT-BACK GUARANTEE AND ITS ALARM (Phase 12, D-01/D-04/D-10/D-20,
 * TXT-02/TXT-06) — two passes the per-minute cadence tick runs.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHAT THE SWEEP GUARANTEES, AND WHAT IT DELIBERATELY DOES NOT.            │
 * │                                                                          │
 * │ It sends ONLY text-backs that were NEVER CLAIMED: the Twilio status      │
 * │ callback never arrived (Twilio does not retry a timed-out one), or the   │
 * │ work before the claim failed or ran out of time. Those rows still read   │
 * │ `text_back_status IS NULL`, and nothing has been sent for them.          │
 * │                                                                          │
 * │ Once a ledger claim exists NOTHING IS EVER RE-SENT. A send the provider  │
 * │ refused (`failed`) and a send whose outcome is unknown (still `claimed`) │
 * │ may already have reached the caller, so they are ALERTED to the operator │
 * │ by `runTextBackAlertPass` within the tick — never retried (D-04, D-10).  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── THE WINDOW (D-20) ───────────────────────────────────────────────────────
 *
 * A call is the sweep's once its reference instant `coalesce(ended_at,
 * started_at)` is at least `TEXT_BACK_GRACE_SECONDS` old (the synchronous path
 * usually wins well inside that) and at most `TEXT_BACK_MAX_AGE_MINUTES` old,
 * both bounds inclusive. Older than that is marked `skipped` / `stale` and is
 * never texted: a call the nightly reconcile inserts hours late must not
 * produce a text at 03:30 (T-12-20).
 *
 * ── ONE IMPLEMENTATION OF THE SEND ──────────────────────────────────────────
 *
 * Each id goes to `sendTextBack`, the same function the status door calls. Its
 * guarded claim admits exactly one of them, so the sweep racing the callback
 * sends one text and the loser returns `claim_lost` or `already_decided`
 * (T-12-02). The caller's number never passes through here: the read returns
 * ids only.
 *
 * ── NO SENDER, NO SCAN ──────────────────────────────────────────────────────
 *
 * `runCadenceTick` is reachable from scripts and from every remote suite, all
 * against the hosted database. A claim consumes the never-twice right for that
 * call, so without the route's sender the sweep reads nothing and writes
 * nothing — not even the stale marks — and says so (`unconfigured: 1`).
 *
 * COUNTS ONLY, and every caught value is discarded: a driver error carries its
 * statement parameters, and these statements' parameters are a caller's call.
 * Framework-free; no id in any log line.
 */
import type { TouchSender } from '@/core/cadence/sender';
import { buildTextBackFailureAlert, clientsPageUrl } from '@/core/alerts/text-back-alerts';
import type { StalledEmailSender } from '@/core/alerts/stalled-drafts';
import { isInsufficientCreditCode } from '@/core/messaging/clicksend-client';
import {
  claimTextBackAlerts,
  forTenant,
  listPendingTextBacks,
  markStaleTextBacks,
  type ClaimedTextBackAlert,
} from '@/db/repository';
import { TEXT_BACK_PAUSE_FAILED_DETAIL } from '@/db/schema';

import { perthAlertDay } from './balance';
import {
  TEXT_BACK_CONFIG_ALERT_LOOKBACK_HOURS,
  TEXT_BACK_GRACE_SECONDS,
  TEXT_BACK_MAX_AGE_MINUTES,
  TEXT_BACK_STUCK_MINUTES,
} from './constants';
import { sendTextBack, type TextBackKind } from './text-back';

/**
 * How many pending calls one tick hands to `sendTextBack`. Each is a handful
 * of indexed reads, one transaction and one provider call; twenty-five is far
 * beyond any minute fifteen clients produce, and bounds a tick that would
 * otherwise be unbounded after an outage. Anything left waits one minute.
 */
export const TEXT_BACK_SWEEP_LIMIT = 25;

/**
 * How long a claimed text-back may sit with no recorded outcome before the
 * operator is told (D-10). Lives in `./constants` since 12-REVIEW WR-05 (the
 * quote-call escalation pass reads it too); re-exported here, its first home.
 */
export { TEXT_BACK_STUCK_MINUTES };

const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;

/** What one sweep did. Counts only. */
export interface TextBackSweepCounts {
  /** Pending calls handed to `sendTextBack` this tick. */
  swept: number;
  /**
   * Of those, texted — including an about-quote text whose quote cadence did
   * not pause (`sent_pause_failed`): the text left, and the alert pass reports
   * the pause.
   */
  sent: number;
  /** Of those, refused by the gate with a recorded reason. */
  skipped: number;
  /**
   * Of those, NOT texted for a reason someone may want to look at: the
   * provider refused, the outcome is unknown, the pre-claim work failed (the
   * row stays pending and the next tick retries it), or the call threw.
   */
  failed: number;
  /** Calls past the ceiling marked `skipped` / `stale` this tick. */
  stale: number;
  /** `1` when no sender was supplied, so the sweep did not scan. */
  unconfigured: number;
}

export const NO_TEXT_BACK_SWEEP: TextBackSweepCounts = {
  swept: 0,
  sent: 0,
  skipped: 0,
  failed: 0,
  stale: 0,
  unconfigured: 0,
};

/** The result kinds the sweep counts as `failed`. The rest are counted in `swept` only. */
const FAILED_KINDS: ReadonlySet<TextBackKind> = new Set<TextBackKind>([
  'failed',
  'outcome_unknown',
  'pre_claim_failed',
]);

/**
 * SEND WHAT THE CALLBACK DID NOT, THEN MARK WHAT IS TOO OLD. See the header.
 *
 * `claim_lost`, `already_decided`, `not_found` and `dead_letter` are counted
 * in `swept` and nowhere else: each means somebody else decided the call, or
 * there was nothing to decide, which is the race working.
 */
export async function runTextBackSweep(input: {
  now: Date;
  sender: TouchSender | undefined;
}): Promise<TextBackSweepCounts> {
  const { now, sender } = input;
  if (sender === undefined) return { ...NO_TEXT_BACK_SWEEP, unconfigured: 1 };

  const counts: TextBackSweepCounts = { ...NO_TEXT_BACK_SWEEP };
  const oldestAllowed = new Date(now.getTime() - TEXT_BACK_MAX_AGE_MINUTES * MS_PER_MINUTE);

  let pending: Array<{ id: string }> = [];
  try {
    pending = await listPendingTextBacks({
      olderThan: new Date(now.getTime() - TEXT_BACK_GRACE_SECONDS * MS_PER_SECOND),
      newerThan: oldestAllowed,
      limit: TEXT_BACK_SWEEP_LIMIT,
    });
  } catch {
    console.error('[text-back-sweep] pending read failed this tick.');
  }

  for (const { id } of pending) {
    counts.swept += 1;
    try {
      // The SAME sender the route built for the tick, handed over as the
      // builder `sendTextBack` asks for only once the client is armed.
      const result = await sendTextBack(id, { now, getSender: async () => sender });
      if (result.kind === 'sent' || result.kind === 'sent_pause_failed') counts.sent += 1;
      else if (result.kind === 'skipped') counts.skipped += 1;
      else if (FAILED_KINDS.has(result.kind)) counts.failed += 1;
    } catch {
      // `sendTextBack` never throws by contract; this is the backstop that
      // keeps one row from costing the next one its text.
      console.error('[text-back-sweep] one text-back threw; continuing.');
      counts.failed += 1;
    }
  }

  // AFTER the sends, so a row at exactly the ceiling is offered first (it is
  // still sendable) and only a row strictly past it is marked. The decision
  // time is the tick's own clock.
  try {
    counts.stale = await markStaleTextBacks(oldestAllowed, now);
  } catch {
    console.error('[text-back-sweep] stale marking failed this tick.');
  }

  return counts;
}

/** What one alert pass did. Counts only. */
export interface TextBackAlertCounts {
  /** Text-backs reported in an operator email that left this tick. */
  alerted: number;
  /** `1` when text-backs were claimed for alerting and the email did NOT leave. */
  alertFailed: number;
  /** `1` when a claimed row carried the provider's insufficient-credit code. */
  insufficientCreditSeen: number;
  /**
   * About-quote texts SENT whose quote cadence could not be paused (12-05,
   * D-08), claimed for alerting this tick. Each is claimed once, so a second
   * tick reports 0 for the same row.
   */
  pauseFailed: number;
}

export const NO_TEXT_BACK_ALERTS: TextBackAlertCounts = {
  alerted: 0,
  alertFailed: 0,
  insufficientCreditSeen: 0,
  pauseFailed: 0,
};

/**
 * TELL THE OPERATOR ABOUT FAILED AND STUCK TEXT-BACKS, ONCE (D-10, TXT-06) —
 * and (12-05, D-08) about an about-quote text whose quote cadence could not be
 * paused, so the operator pauses it by hand — and (12-REVIEW WR-02) about an
 * ARMED client whose callers go untexted because its own configuration stopped
 * allowing a send (`no_template`, `sms_not_armed`), at most once per client
 * per Perth day.
 *
 * The claim (`text_back_alerted_at`) is the decision to alert and nothing
 * un-claims it, so the try is SPLIT AT THE CLAIM exactly as `runAgingPass`
 * splits it: a claim that throws wrote nothing (zero is the truth), and
 * anything that fails after it is reported as `alertFailed: 1` — never as
 * "nothing to report", because those rows will never be claimed again.
 *
 * One email per tick covering every client, names and counts only.
 */
export async function runTextBackAlertPass(input: {
  now: Date;
  sendEmail: StalledEmailSender;
}): Promise<TextBackAlertCounts> {
  const { now, sendEmail } = input;

  let claimed: ClaimedTextBackAlert[];
  try {
    claimed = await claimTextBackAlerts(
      now,
      new Date(now.getTime() - TEXT_BACK_STUCK_MINUTES * MS_PER_MINUTE),
      // THE CONFIGURATION ARM (12-REVIEW WR-02): an armed client's callers
      // refused `no_template` / `sms_not_armed`. Stamped once per call;
      // emailed at most once per client per Perth day.
      {
        since: new Date(now.getTime() - TEXT_BACK_CONFIG_ALERT_LOOKBACK_HOURS * MS_PER_HOUR),
        dayStart: perthDayStart(now),
      },
    );
  } catch {
    console.error('[text-back-alerts] alert claim failed this tick.');
    return { ...NO_TEXT_BACK_ALERTS };
  }

  // A configuration skip for a client already told about it today is stamped
  // (so it is never claimed again) and deliberately NOT re-emailed: the first
  // email of the day already says every caller to that client goes untexted.
  claimed = claimed.filter((row) => !(isConfigSkip(row) && row.repeatToday));

  if (claimed.length === 0) return { ...NO_TEXT_BACK_ALERTS };

  // Read before anything else can throw: the balance probe is forced by it
  // whatever happens to the email.
  const insufficientCreditSeen = claimed.some(
    (row) => row.status === 'failed' && row.detail !== null && isInsufficientCreditCode(row.detail),
  )
    ? 1
    : 0;
  // Counted from the claim, so the tick reports it even if the email is lost
  // (that loss is `alertFailed`, never a silent zero).
  const pauseFailed = claimed.filter(isPauseFailed).length;

  // ── PAST THIS LINE THE CLAIM IS COMMITTED AND CANNOT BE TAKEN BACK. ──────
  try {
    type Entry = {
      failed: number;
      unknown: number;
      pauseFailed: number;
      noTemplate: number;
      smsNotArmed: number;
    };
    const byTenant = new Map<string, Entry>();
    for (const row of claimed) {
      const entry = byTenant.get(row.tenantId) ?? {
        failed: 0,
        unknown: 0,
        pauseFailed: 0,
        noTemplate: 0,
        smsNotArmed: 0,
      };
      if (isPauseFailed(row)) entry.pauseFailed += 1;
      else if (isConfigSkip(row)) {
        if (row.skipReason === 'no_template') entry.noTemplate += 1;
        else entry.smsNotArmed += 1;
      } else if (row.status === 'failed') entry.failed += 1;
      else entry.unknown += 1;
      byTenant.set(row.tenantId, entry);
    }

    const perClient: Array<Entry & { tenantName: string }> = [];
    for (const [tenantId, entry] of byTenant) {
      perClient.push({ tenantName: await tenantNameOf(tenantId), ...entry });
    }

    const outcome = await sendEmail(
      buildTextBackFailureAlert({ perClient, at: now, clientsUrl: clientsPageUrl() }),
    );

    return outcome.ok
      ? { alerted: claimed.length, alertFailed: 0, insufficientCreditSeen, pauseFailed }
      : { alerted: 0, alertFailed: 1, insufficientCreditSeen, pauseFailed };
  } catch {
    console.error('[text-back-alerts] alert email failed after the claim.');
    return { alerted: 0, alertFailed: 1, insufficientCreditSeen, pauseFailed };
  }
}

/** An ARMED client's call refused for a configuration reason (12-REVIEW WR-02). */
function isConfigSkip(row: ClaimedTextBackAlert): boolean {
  return row.status === 'skipped';
}

/**
 * The start of `now`'s Perth calendar day, as an instant — the boundary of
 * "already told about it today". Perth keeps no daylight saving, so the day
 * starts at 00:00 +08:00 (16:00 UTC the day before); `perthAlertDay` is the
 * one place the Perth date is computed.
 */
function perthDayStart(now: Date): Date {
  return new Date(`${perthAlertDay(now)}T00:00:00+08:00`);
}

/** A SENT about-quote text whose quote cadence did not pause (12-05). */
function isPauseFailed(row: ClaimedTextBackAlert): boolean {
  return row.status === 'sent' && row.detail === TEXT_BACK_PAUSE_FAILED_DETAIL;
}

/**
 * The client's name for the email. A failed read is a fixed placeholder, not
 * a lost alert: the count still reaches the operator, who can find the client
 * from the console.
 */
async function tenantNameOf(tenantId: string): Promise<string> {
  try {
    const [tenant] = await forTenant(tenantId).tenant.get();
    return tenant?.name ?? 'A client (name unavailable)';
  } catch {
    return 'A client (name unavailable)';
  }
}
