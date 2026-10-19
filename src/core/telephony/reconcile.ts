/**
 * The nightly call-log sweep — the GUARANTEE behind two telephony webhook HINTS
 * (Phase 11, CAP-03, D-06), and the nightly proof that no recording exists
 * (CAP-02, D-04).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS MODULE CONTAINS NO DECISION OF ITS OWN. It classifies a caller with │
 * │ `classifyCaller`, flags after-hours with `isInsideWindow`, and writes    │
 * │ through `upsertMissedCallFromLog` — the classifier and window function   │
 * │ the voice webhook uses, and the unique index both webhooks converge on.  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Imported, not re-implemented: a second copy of "is this caller withheld" or
 * "was this after hours" would drift from the first, and the drift would only
 * ever show as a caller treated differently depending on whether their call
 * arrived by webhook or by poll (the messaging reconcile's argument, one
 * channel over).
 *
 * ── WHY A POLL AT ALL ───────────────────────────────────────────────────────
 *
 * Twilio does NOT retry a voice webhook on a 5xx or a read timeout — only a
 * connect failure, once (RESEARCH correction 1). A cold start that loses the
 * 15 s race, a deploy mid-flight, a database blip: each one is a diverted call
 * with no row, and no second delivery is coming. The same holds for the status
 * callback, whose loss leaves a row with no end. This sweep is the only thing
 * that makes "every diverted call becomes a row" true.
 *
 * ── IT RECORDS FACTS. IT NEVER CREATES A CALL, A TEXT OR A SEND ─────────────
 *
 * The client functions it calls are list reads. The one write is the upsert,
 * which on a row the webhook already holds fills ONLY the NULL completion
 * columns — `started_at`, `after_hours` and every caller column were computed at
 * arrival and are stored facts it cannot touch (T-11-02). The exception is a
 * DEAD LETTER (no tenant, so no caller facts at all): when the called number
 * now resolves to an owner, the row is adopted — tenant, divert row, caller
 * classification and after-hours filled from the log (WR-06). The one outbound
 * action is the operator's own alarm SMS below.
 *
 * ── IDEMPOTENT BY CONSTRUCTION, WHICH IS WHY THE WINDOW CAN OVERLAP ─────────
 *
 * Every run looks back 48 hours, so a missed night is recovered by the next with
 * no cursor to corrupt: `(provider, provider_call_id)` is the arbiter, and a
 * call seen twice converges on one row.
 *
 * ── THE RECORDING ALARM (D-04) ──────────────────────────────────────────────
 *
 * Nothing in this product records a call, and the structural scan in
 * `tests/telephony-greeting.test.ts` keeps it that way in our code. What that
 * scan cannot see is the ACCOUNT: a console setting, a Studio flow, a support
 * change. So every night the sweep COUNTS recordings created in the window —
 * counts only, never fetches one — and any number above zero is a fixed-string
 * error and an SMS to the operator. The invariant is asserted, not assumed from
 * a settings page. The count runs BEFORE the call sweep so a database failure
 * part-way through the sweep cannot silence it.
 *
 * ── LOGS ARE COUNTS AND BOUNDED CODES ───────────────────────────────────────
 *
 * No caller number, no called number and no provider prose reaches a log line
 * (T-11-04). The poll's `reason` is bounded by the client; every caught value
 * here is discarded, because a postgres error carries its statement parameters
 * and those include a caller's number.
 */
import { isInsideWindow, type ContactWindow } from '@/core/cadence/window';
import { SERVICE_NAME } from '@/core/brand';
import { sendOperatorSms } from '@/core/alerts/operator-sms';
import {
  forAllTenants_activeDivertNumbers,
  upsertMissedCallFromLog,
  type ActiveDivertNumber,
  type MissedCallFromLog,
} from '@/db/repository';

import { classifyCaller } from './caller';
import { CALL_STATUSES } from './parse-voice-webhook';
import {
  countRecordingsSince,
  listInboundCalls,
  twilioCredsFromEnv,
  type LoggedCall,
  type TwilioCreds,
} from './twilio-client';

/**
 * 48 hours, not 24 — the messaging reconcile's margin: the sweep runs daily, so
 * a 24-hour window loses a whole day to one skipped run.
 */
const WINDOW_HOURS = 48;

/** The raw `From` kept as evidence is capped — the arrival path's cap. */
const MAX_CALLER_RAW_CHARS = 64;

/**
 * The operator alarm. One GSM-7 segment, a FIXED sentence: it carries no
 * number, no tenant and no Twilio identifier, because the action it asks for
 * is the same whatever the recording is.
 */
export const RECORDING_ALARM_SMS =
  `${SERVICE_NAME}: a Twilio recording exists on the account (D-04). Open the Twilio ` +
  'Console now and delete it; nothing in this product should have created one.';

/**
 * The operator-sms `requestId` for the alarm — it becomes the prefixed custom
 * string on the send, so a delivery receipt files as unmatched rather than
 * against any cadence touch.
 */
const RECORDING_ALARM_ID = 'telephony-recording-present';

export interface MissedCallReconcileResult {
  /**
   * True when there is nothing to poll (every count below is then 0 and the
   * check flag false), or when the sweep threw (then `recordingsFound` is null
   * and `recordingsCheckFailed` true — see FAILED).
   */
  skipped: boolean;
  /**
   * Calls in the window this sweep actually RECOVERED (WR-06): inserted (the
   * webhook never saw it), completed (a dropped callback left the completion
   * NULL), or adopted (a dead letter now attributed to its owner). A call whose
   * row was already attributed and complete is NOT counted — after a clean day
   * this reads 0.
   */
  missedCallsRecovered: number;
  /**
   * Recordings on the account created in the window. Anything but 0 is D-04
   * violated. `null` when the count COULD NOT BE READ (WR-05) — never 0, which
   * would read exactly like "verified none".
   */
  recordingsFound: number | null;
  /**
   * True when the recordings count was attempted and failed (WR-05) — the D-04
   * assertion did not run tonight. Its own field, so the ops probe and the cron
   * body can tell a failing check from a clean account.
   */
  recordingsCheckFailed: boolean;
}

const NOTHING: MissedCallReconcileResult = {
  skipped: true,
  missedCallsRecovered: 0,
  recordingsFound: 0,
  recordingsCheckFailed: false,
};

/**
 * The sweep THREW part-way (a database read or write). Nothing is reported as
 * recovered, and the recordings count is reported as not established rather
 * than as a clean 0 (WR-05): the alarm itself, if the count ran and found one,
 * has already fired — the count runs before the sweep.
 */
const FAILED: MissedCallReconcileResult = {
  skipped: true,
  missedCallsRecovered: 0,
  recordingsFound: null,
  recordingsCheckFailed: true,
};

/**
 * Every collaborator, injectable — so the suite proves each branch by observing
 * which dependency was called, and never reaches Twilio or the hosted database.
 */
export interface MissedCallReconcileDeps {
  divertNumbers?: typeof forAllTenants_activeDivertNumbers;
  /** `null` means "no credentials on this deploy"; omitted means read the env. */
  creds?: TwilioCreds | null;
  listCalls?: typeof listInboundCalls;
  countRecordings?: typeof countRecordingsSince;
  upsert?: typeof upsertMissedCallFromLog;
  alert?: (message: string) => Promise<unknown>;
  now?: Date;
}

/** The default alarm: the operator's handset, through the one operator-sms door. */
function alertOperator(message: string): Promise<unknown> {
  return sendOperatorSms({ requestId: RECORDING_ALARM_ID, body: message });
}

export async function reconcileMissedCalls(
  deps: MissedCallReconcileDeps = {},
): Promise<MissedCallReconcileResult> {
  try {
    return await sweep(deps);
  } catch {
    // The cron route must never 500 because of this pass. The caught value is
    // discarded — see the header.
    console.error('[telephony] reconcile failed');
    return FAILED;
  }
}

async function sweep(deps: MissedCallReconcileDeps): Promise<MissedCallReconcileResult> {
  const divertNumbers = deps.divertNumbers ?? forAllTenants_activeDivertNumbers;
  const listCalls = deps.listCalls ?? listInboundCalls;
  const countRecordings = deps.countRecordings ?? countRecordingsSince;
  const upsert = deps.upsert ?? upsertMissedCallFromLog;
  const alert = deps.alert ?? alertOperator;
  const now = deps.now ?? new Date();

  // THE GUARD IS FIRST AND IT IS TOTAL (RESEARCH Pitfall 12). No active divert
  // number anywhere — production's state until the first client is provisioned
  // — means there is nothing of ours on the account to reconcile: zero HTTP
  // calls, and the credentials are not even read. Asserted by the suite rather
  // than assumed, because CI carries placeholder credentials and a sweep that
  // "harmlessly" polled would try to authenticate with them every night.
  const numbers = await divertNumbers();
  if (numbers.length === 0) return NOTHING;

  const creds = deps.creds === undefined ? twilioCredsFromEnv() : deps.creds;
  if (creds === null) return NOTHING;

  const since = new Date(now.getTime() - WINDOW_HOURS * 3_600_000);

  const recordingsFound = await checkRecordings({ creds, since, countRecordings, alert });
  const missedCallsRecovered = await convergeCalls({ creds, since, now, numbers, listCalls, upsert });

  console.info(
    `[telephony] reconcile recovered=${missedCallsRecovered} recordings=${recordingsFound ?? 'unknown'}`,
  );

  return {
    skipped: false,
    missedCallsRecovered,
    recordingsFound,
    recordingsCheckFailed: recordingsFound === null,
  };
}

/**
 * Count recordings; alarm on anything but zero (D-04).
 *
 * A FAILED COUNT IS `null`, NEVER 0 (WR-05). A rotated auth token, a 429 or a
 * timeout must not read as "verified none" — a permanently failing check would
 * otherwise look like a permanently clean account. It is a fixed warning line
 * with the bounded code, no alarm SMS (there is nothing found to alarm about,
 * and tomorrow's run covers the same window), and `recordingsCheckFailed` in
 * the result.
 */
async function checkRecordings(pass: {
  creds: TwilioCreds;
  since: Date;
  countRecordings: typeof countRecordingsSince;
  alert: (message: string) => Promise<unknown>;
}): Promise<number | null> {
  const recordings = await pass.countRecordings({ creds: pass.creds, since: pass.since });
  if (!recordings.ok) {
    console.warn(`[telephony] reconcile recordings poll failed: ${recordings.reason}`);
    return null;
  }
  const found = recordings.count;
  if (found === 0) return 0;

  console.error('[telephony] RECORDING_PRESENT — D-04 violated; alerting operator.');

  // A failed alert is a warning, not a throw: the fixed-string error above is
  // already in the log, and the pass must still converge tonight's calls.
  try {
    const sent = await pass.alert(RECORDING_ALARM_SMS);
    if (typeof sent === 'object' && sent !== null && (sent as { ok?: unknown }).ok === false) {
      console.warn('[telephony] recording alarm sms not sent.');
    }
  } catch {
    console.warn('[telephony] recording alarm sms not sent.');
  }

  return found;
}

/**
 * After hours at the call's start, in the OWNER's window — `!isInsideWindow`,
 * with the arrival path's conservative answer (`true`) for a window that cannot
 * be interpreted. Only reaches the database on an INSERT: the upsert never
 * rewrites `after_hours` on a row the webhook already wrote.
 */
function afterHoursAt(instant: Date, owner: ActiveDivertNumber): boolean {
  const window: ContactWindow = {
    timezone: owner.timezone,
    contactHoursStart: owner.contactHoursStart,
    contactHoursEnd: owner.contactHoursEnd,
    contactDays: owner.contactDays,
  };
  try {
    return !isInsideWindow(instant, window);
  } catch {
    console.warn('[telephony] reconcile window_invalid; after_hours assumed.');
    return true;
  }
}

function knownStatus(status: string): string | null {
  return (CALL_STATUSES as readonly string[]).includes(status) ? status : null;
}

/** The row the arrival path would have written, plus what the log knows about the end. */
function rowFromLog(call: LoggedCall, owner: ActiveDivertNumber, now: Date): MissedCallFromLog {
  const caller = classifyCaller(call.from);
  const startedAt = call.startTime ?? now;

  return {
    tenantId: owner.tenantId,
    divertNumberId: owner.divertNumberId,
    provider: 'twilio',
    providerCallId: call.sid,
    calledNumberE164: call.to,
    callerE164: caller.e164,
    callerWithheld: caller.kind === 'withheld',
    callerKind: caller.kind,
    callerRaw: call.from === null ? null : call.from.slice(0, MAX_CALLER_RAW_CHARS),
    // EVIDENCE ONLY — stored, never looked up (D-02).
    forwardedFromRaw: call.forwardedFrom,
    fromCountry: null,
    startedAt,
    afterHours: afterHoursAt(startedAt, owner),
    callStatus: knownStatus(call.status),
    durationSeconds: call.durationSeconds,
    endedAt: call.endTime,
    source: 'reconcile',
    completedVia: 'reconcile',
    deadLetterReason: null,
    rawPayload: null,
  };
}

/**
 * Converge every inbound call to one of OUR numbers onto `missed_calls`.
 *
 * The owner is found by the called number and nothing else (D-02) — the same
 * key the voice webhook uses. A call to a number no active row owns is skipped
 * silently: another product on the same account, or a number mid-provisioning,
 * and in neither case ours to record.
 */
async function convergeCalls(pass: {
  creds: TwilioCreds;
  since: Date;
  now: Date;
  numbers: readonly ActiveDivertNumber[];
  listCalls: typeof listInboundCalls;
  upsert: typeof upsertMissedCallFromLog;
}): Promise<number> {
  const calls = await pass.listCalls({ creds: pass.creds, since: pass.since });
  if (!calls.ok) {
    // A code by construction (see the client). Not an error to raise: tomorrow's
    // sweep covers the same window.
    console.warn(`[telephony] reconcile calls poll failed: ${calls.reason}`);
    return 0;
  }

  const owners = new Map(pass.numbers.map((n) => [n.numberE164, n]));

  let recovered = 0;
  for (const call of calls.items) {
    const owner = owners.get(call.to);
    if (owner === undefined) continue;

    // THE SAME WRITE THE WEBHOOKS CONVERGE ON — see the header. Only a write
    // that moved something is a recovery (WR-06).
    const written = await pass.upsert(rowFromLog(call, owner, pass.now));
    if (written.kind !== 'unchanged') recovered += 1;
  }

  return recovered;
}
