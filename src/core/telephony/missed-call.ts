/**
 * A diverted call arrived: work out whose it is, classify the caller, flag
 * after-hours, and record ONE row (Phase 11, CAP-03, D-02/D-06/D-07).
 *
 * FRAMEWORK-FREE, deps injectable, and it NEVER THROWS. Its caller is the voice
 * webhook, whose every response after the token gate must be a 200 TwiML
 * greeting — a throw here would become a 500, and a 500 is Twilio's own error
 * message played to a tradie's customer, with no retry (Twilio does not retry a
 * 5xx on the incoming-call webhook). So every failure is a RESULT KIND, and the
 * nightly call-log reconcile (11-02) is the guarantee behind a row this path
 * could not write.
 *
 * ── ONE READ BEFORE THE GREETING, AND A DEADLINE ON ALL OF IT ───────────────
 *
 * Twilio abandons a voice request after 15 seconds, and that budget includes
 * TLS and a cold function start. The greeting needs the spoken name, so one
 * read is unavoidable (`forAllTenants_divertNumberByE164`, which also carries
 * the contact window, so there is no second); the insert follows. BOTH race a
 * single deadline (6 s by default). On timeout the caller still gets the
 * greeting — named if the read made it, generic if not — and the log says
 * `db_timeout`, a fixed string the ops probe can count.
 *
 * ── THE CALLED NUMBER IS THE ONLY TENANT KEY (D-02) ─────────────────────────
 *
 * The lookup is given `To` and nothing else. `ForwardedFrom` — the client's own
 * line, when a carrier sends it — is stored on the row as EVIDENCE for the
 * divert spike and never consulted, not even as a fallback when `To` is
 * unknown: a second tenant-resolution rule that only fires on the error path
 * is one nobody tests until it attributes one client's caller to another.
 *
 * ── DEAD LETTERS ────────────────────────────────────────────────────────────
 *
 * A call is stored even when it cannot be attributed, with `tenant_id NULL`
 * and a closed `dead_letter_reason`: `unparseable` (no CallSid or no To),
 * `not_inbound` (a Direction other than inbound), `unknown_number` (a To no
 * active divert row owns). A dead letter carries NO CALLER DATA — no number,
 * no raw From — because a caller's number with no client attached is personal
 * information we have no purpose for; `caller_kind` is `withheld` in the sense
 * of "not recorded". The unparseable and not-inbound rows keep at most 8 000
 * characters of the raw body, which is the diagnosis when Twilio changes a
 * payload; the unknown-number row keeps the CallSid and the called number,
 * which is the diagnosis there.
 *
 * ── LOGS ARE FIXED STRINGS ──────────────────────────────────────────────────
 *
 * Nothing from the request reaches a log line from this module. The caught
 * value of every failure is discarded: a postgres error carries its statement
 * parameters, which here include a caller's number.
 */
import { isInsideWindow, type ContactWindow } from '@/core/cadence/window';
import {
  completeMissedCall,
  forAllTenants_divertNumberByE164,
  insertMissedCallArrival,
  type DivertNumberOwner,
  type MissedCallArrivalInsert,
} from '@/db/repository';

import { classifyCaller } from './caller';
import {
  CALL_SID_PATTERN,
  FINAL_CALL_STATUSES,
  parseVoiceArrival,
  parseVoiceStatus,
} from './parse-voice-webhook';

/** How much of an unrecognised body a dead letter keeps (the inbound-SMS cap). */
const MAX_RAW_PAYLOAD_CHARS = 8_000;

/** The raw `From` kept as evidence is capped — a caller controls its length. */
const MAX_CALLER_RAW_CHARS = 64;

/** The whole DB budget for one arrival, inside Twilio's 15 s ceiling. */
const DEFAULT_DEADLINE_MS = 6_000;

export type MissedCallArrivalKind =
  | 'recorded'
  | 'duplicate'
  | 'unknown_number'
  | 'dead_letter'
  | 'db_failed';

export interface MissedCallArrivalResult {
  /** A member of a closed union — the only thing the route may log. */
  kind: MissedCallArrivalKind;
  /** The name the greeting speaks, or null for the generic greeting. */
  spokenName: string | null;
}

export interface MissedCallArrivalDeps {
  lookup?: typeof forAllTenants_divertNumberByE164;
  insert?: typeof insertMissedCallArrival;
  /** Server receipt time — `started_at` and the after-hours instant. */
  now?: Date;
  deadlineMs?: number;
}

/** A value that settled in time, a timeout, or a throw — never a rejection. */
export type Raced<T> = { ok: true; value: T } | { ok: false; reason: 'timeout' | 'failed' };

/**
 * Run `work` against an absolute deadline. Never rejects; the caught value is
 * discarded. Exported (Phase 12) so the text-back path bounds its pre-claim
 * reads with this same helper rather than a second one.
 */
export async function withinDeadline<T>(work: () => Promise<T>, deadlineAt: number): Promise<Raced<T>> {
  const remaining = Math.max(0, deadlineAt - Date.now());
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<Raced<T>>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), remaining);
  });
  const attempt = (async (): Promise<Raced<T>> => {
    try {
      return { ok: true, value: await work() };
    } catch {
      // Discarded deliberately — see the header.
      return { ok: false, reason: 'failed' };
    }
  })();

  try {
    return await Promise.race([attempt, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function logDbFailure(reason: 'timeout' | 'failed'): void {
  if (reason === 'timeout') {
    console.warn('[telephony] arrival db_timeout; greeting served.');
  } else {
    console.warn('[telephony] arrival db_failed; greeting served.');
  }
}

/**
 * After hours? `!isInsideWindow` — the window is half-open `[start, end)`, so the
 * closing second itself is after-hours. A window this module cannot interpret
 * (unreachable behind migration 0004's CHECKs, but not impossible) stores
 * `true`: the conservative direction, because an after-hours caller gets the
 * after-hours wording in Phase 12 rather than a promise of a call "shortly".
 */
function isAfterHours(now: Date, owner: DivertNumberOwner): boolean {
  const window: ContactWindow = {
    timezone: owner.timezone,
    contactHoursStart: owner.contactHoursStart,
    contactHoursEnd: owner.contactHoursEnd,
    contactDays: owner.contactDays,
  };
  try {
    return !isInsideWindow(now, window);
  } catch {
    console.warn('[telephony] arrival window_invalid; after_hours assumed.');
    return true;
  }
}

export async function recordMissedCallArrival(
  params: Record<string, string>,
  raw: string,
  deps: MissedCallArrivalDeps = {},
): Promise<MissedCallArrivalResult> {
  const lookup = deps.lookup ?? forAllTenants_divertNumberByE164;
  const insert = deps.insert ?? insertMissedCallArrival;
  const now = deps.now ?? new Date();
  const deadlineAt = Date.now() + (deps.deadlineMs ?? DEFAULT_DEADLINE_MS);

  /** A tenant-less row. Carries no caller data — see the header. */
  const deadLetter = async (
    reason: 'unparseable' | 'not_inbound' | 'unknown_number',
    keepRaw: boolean,
    callStatus: string | null,
  ): Promise<boolean> => {
    const callSid = params.CallSid;
    const row: MissedCallArrivalInsert = {
      tenantId: null,
      divertNumberId: null,
      provider: 'twilio',
      providerCallId: typeof callSid === 'string' && CALL_SID_PATTERN.test(callSid) ? callSid : null,
      calledNumberE164: params.To ?? '',
      callerE164: null,
      callerWithheld: true,
      callerKind: 'withheld',
      callerRaw: null,
      forwardedFromRaw: null,
      fromCountry: null,
      startedAt: now,
      // No window to evaluate; the conservative value. A dead letter is never
      // acted on (it has no client), so this is a placeholder, not a claim.
      afterHours: true,
      callStatus,
      source: 'webhook',
      deadLetterReason: reason,
      rawPayload: keepRaw ? raw.slice(0, MAX_RAW_PAYLOAD_CHARS) : null,
    };
    const written = await withinDeadline(() => insert(row), deadlineAt);
    if (!written.ok) logDbFailure(written.reason);
    return written.ok;
  };

  const parsed = parseVoiceArrival(params);
  if (!parsed.ok) {
    const stored = await deadLetter('unparseable', true, null);
    return { kind: stored ? 'dead_letter' : 'db_failed', spokenName: null };
  }
  const data = parsed.data;

  if (data.Direction !== undefined && data.Direction !== 'inbound') {
    const stored = await deadLetter('not_inbound', true, data.CallStatus ?? null);
    return { kind: stored ? 'dead_letter' : 'db_failed', spokenName: null };
  }

  // THE CALLED NUMBER, AND ONLY THE CALLED NUMBER (D-02).
  const found = await withinDeadline(() => lookup(data.To), deadlineAt);
  if (!found.ok) {
    logDbFailure(found.reason);
    return { kind: 'db_failed', spokenName: null };
  }

  const owner = found.value;
  if (owner === undefined) {
    const stored = await deadLetter('unknown_number', false, data.CallStatus ?? null);
    return { kind: stored ? 'unknown_number' : 'db_failed', spokenName: null };
  }

  const caller = classifyCaller(data.From);

  const row: MissedCallArrivalInsert = {
    tenantId: owner.tenantId,
    divertNumberId: owner.divertNumberId,
    provider: 'twilio',
    providerCallId: data.CallSid,
    calledNumberE164: data.To,
    callerE164: caller.e164,
    callerWithheld: caller.kind === 'withheld',
    callerKind: caller.kind,
    callerRaw: data.From === undefined ? null : data.From.slice(0, MAX_CALLER_RAW_CHARS),
    // EVIDENCE ONLY — stored, never looked up (D-02).
    forwardedFromRaw: data.ForwardedFrom ?? null,
    fromCountry: data.FromCountry ?? null,
    startedAt: now,
    afterHours: isAfterHours(now, owner),
    callStatus: data.CallStatus ?? null,
    source: 'webhook',
    deadLetterReason: null,
    rawPayload: null,
  };

  const written = await withinDeadline(() => insert(row), deadlineAt);
  if (!written.ok) {
    logDbFailure(written.reason);
    return { kind: 'db_failed', spokenName: owner.spokenName };
  }

  return {
    kind: written.value === null ? 'duplicate' : 'recorded',
    spokenName: owner.spokenName,
  };
}

/* -------------------------------------------------------------------------- *
 * The status callback — the HINT half (plan 11-02, D-06)
 * -------------------------------------------------------------------------- */

export type VoiceStatusKind = 'completed' | 'unmatched' | 'unparseable' | 'db_failed';

export interface VoiceStatusResult {
  /** A member of a closed union — the only thing the route may log. */
  kind: VoiceStatusKind;
  /**
   * The id of the row the completion UPDATE matched (Phase 12), or `null` when
   * nothing matched. From RETURNING — never from the callback's parameters —
   * so it is the only thing the route may hand the text-back path (T-12-01).
   * Never logged.
   */
  missedCallId: string | null;
  /** That row's tenant; `null` on no match and on a dead letter. Never logged. */
  tenantId: string | null;
  /** `true` when the reported status is final — the caller has hung up (D-01). */
  callEnded: boolean;
}

export interface VoiceStatusDeps {
  complete?: typeof completeMissedCall;
  /** Receipt time — the `ended_at` fallback when `Timestamp` is absent or unreadable. */
  now?: Date;
}

/**
 * A call finished: fill its final status, duration and end time on the row the
 * arrival wrote — by EXACT match on (provider, CallSid), and never anything
 * else.
 *
 * THE CALLBACK IS A HINT, the delivery-receipt argument. It completes a row that
 * already exists or it does nothing: a CallSid no row carries is `unmatched` and
 * creates nothing, because the nightly call-log reconcile is the guarantee — it
 * reads the same facts from Twilio's own API and writes the call whole if the
 * arrival never landed. So a forgery holding the token AND the signing key can
 * at most re-stamp a call that exists with a status from the closed CHECK
 * vocabulary; it cannot invent one, and in Phase 12 an invented call would be a
 * text to whoever's number was typed.
 *
 * NEVER THROWS. Twilio retries a failed status callback, and a retry of an
 * UPDATE that failed on a database blip is harmless — but a throw would be a
 * 500 carrying whatever the driver put in its message. Every failure is a kind.
 *
 * `Timestamp` is RFC 2822 in UTC (`Tue, 29 Sep 2026 03:14:15 +0000`), which
 * `Date.parse` reads; absent or unreadable, the receipt time stands in — a few
 * seconds late is a better `ended_at` than a dropped completion. `CallDuration`
 * is whole seconds as a digit string (the parser has already refused anything
 * else), stored as an integer, or NULL when Twilio omits it.
 */
export async function applyVoiceStatus(
  params: Record<string, string>,
  deps: VoiceStatusDeps = {},
): Promise<VoiceStatusResult> {
  const complete = deps.complete ?? completeMissedCall;

  const parsed = parseVoiceStatus(params);
  if (!parsed.ok) return { kind: 'unparseable', missedCallId: null, tenantId: null, callEnded: false };
  const data = parsed.data;
  const callEnded = (FINAL_CALL_STATUSES as readonly string[]).includes(data.CallStatus);

  const stamped = data.Timestamp === undefined ? Number.NaN : Date.parse(data.Timestamp);
  const endedAt = Number.isNaN(stamped) ? (deps.now ?? new Date()) : new Date(stamped);

  const durationSeconds =
    data.CallDuration === undefined ? null : Number.parseInt(data.CallDuration, 10);

  try {
    const result = await complete({
      providerCallId: data.CallSid,
      callStatus: data.CallStatus,
      durationSeconds,
      endedAt,
    });
    return result.completed
      ? { kind: 'completed', missedCallId: result.id, tenantId: result.tenantId, callEnded }
      : { kind: 'unmatched', missedCallId: null, tenantId: null, callEnded };
  } catch {
    // Discarded deliberately — a postgres error carries its statement parameters.
    console.warn('[telephony] status db_failed; acknowledged.');
    return { kind: 'db_failed', missedCallId: null, tenantId: null, callEnded };
  }
}
