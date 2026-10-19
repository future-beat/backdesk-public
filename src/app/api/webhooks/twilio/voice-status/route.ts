/**
 * The status door (Phase 11, CAP-03/CAP-04, D-06). When a diverted call ends,
 * Twilio POSTs its final status here — `completed`, with `CallDuration` and a
 * `Timestamp` — and this route authenticates it twice and hands it to
 * `applyVoiceStatus`, which fills the row the voice door wrote at arrival. It
 * decides nothing itself.
 *
 * ── AND, SINCE PHASE 12, IT TRIGGERS THE TEXT-BACK (D-01) ───────────────────
 *
 * When the completion matched a row and the reported status is final (the
 * caller has hung up), the route hands `sendTextBack` the ROW ID the UPDATE
 * returned — and nothing else. No callback parameter crosses into the send
 * path: the number texted is read from the row the signed ARRIVAL door wrote
 * (T-12-01). Every decision is `sendTextBack`'s; the route makes no
 * repository call of its own and logs one more closed-union value, the
 * text-back kind. A throw from it is caught here and the acknowledgement is
 * still the byte-identical 200: the tick sweep is the guarantee for any call
 * whose synchronous send did not complete.
 *
 * ── THE HINT HALF, THE DELIVERY-RECEIPT ARGUMENT ────────────────────────────
 *
 * The voice door must answer every call, because a caller is waiting on its
 * answer. This door waits on nothing: a status callback is a HINT, and the
 * nightly call-log reconcile is the GUARANTEE — it reads the same duration and
 * final status from Twilio's API and converges the row either way. So:
 *
 *   - a callback naming a CallSid no row carries completes NOTHING and creates
 *     NOTHING (kind `unmatched`); if the call was real, the reconcile writes it;
 *   - an unreadable or unparseable body is a counted log line and no row
 *     anywhere — not even a dead letter. The arrival door keeps a dead letter
 *     because it is the only record of a caller; this door never is.
 *
 * ── A URL TOKEN *AND* A SIGNATURE (T-11-01) ─────────────────────────────────
 *
 *   1. THE TOKEN, in constant time, BEFORE A BYTE OF THE BODY IS READ — this
 *      route's OWN secret, per the four-bearer rule. The voice door's secret
 *      does not open this door and this door's does not open that one: one
 *      endpoint's token must rotate alone, and the suite asserts the sibling's
 *      value is REJECTED here, which is the only assertion that can fail on it.
 *   2. THE SIGNATURE, over the CANONICAL URL rebuilt from `APP_BASE_URL` by
 *      `twilioWebhookUrl()` — never the incoming request's own URL, which
 *      Vercel's proxy rewrites. A failure writes nothing and still answers the
 *      uniform 200: it may be Twilio after an auth-token rotation, and a 4xx
 *      buys a retry storm, not information.
 *
 * ── WHAT A FORGED REQUEST CAN DO, EXHAUSTIVELY ──────────────────────────────
 *
 * Without the auth token: nothing. With the URL token AND Twilio's signing key:
 * re-stamp `call_status`, `duration_seconds`, `ended_at` and `completed_via` on
 * ONE `missed_calls` row whose CallSid the forger already knows, with a status
 * from the closed CHECK vocabulary. That is the complete list, enforced
 * structurally in `completeMissedCall`: an UPDATE with an exact-match predicate.
 * It cannot invent a call, cannot enumerate one, and cannot touch the caller or
 * tenant columns.
 *
 * ── EVERY RESPONSE AFTER THE TOKEN GATE IS BYTE-IDENTICAL ───────────────────
 *
 * Completed, unmatched, unparseable, database down, signature rejected, base URL
 * unset, body unreadable, env unreadable (WR-03, answered before the token gate
 * because without the env there is no token to compare): the same JSON
 * acknowledgement, 200. Never a 5xx. A body that distinguished "completed" from "unmatched" would tell a token
 * holder which CallSids name real calls, one request at a time.
 *
 * ── NOTHING HERE LOGS THE TOKEN, A NUMBER, THE SIGNATURE OR THE BODY ────────
 *
 * Fixed strings, and exactly two interpolations: the result kind and the
 * text-back kind, each a member of a closed union.
 */
import { timingSafeEqual } from 'node:crypto';

import { sendTextBack } from '@/core/leads/text-back';
import { buildRoutingSender } from '@/core/messaging/routing-sender';
import { getServerEnv } from '@/core/shared/env';
import { applyVoiceStatus } from '@/core/telephony/missed-call';
import { decodeFormBody } from '@/core/telephony/parse-voice-webhook';
import { verifyTwilioSignature } from '@/core/telephony/verify-signature';
import { twilioWebhookUrl } from '@/core/telephony/webhook-url';

/**
 * One callback is one indexed UPDATE and, when it ends a call for an armed
 * client, ONE text-back: a few small reads, one transaction and one ClickSend
 * request (whose own abort is 20s, deliberately not shortened — a send aborted
 * after ClickSend accepted it is a texted caller with an unknown outcome).
 * 60s holds that with room; it is the siblings' decision, kept so the number
 * is a decision rather than an inherited default.
 */
export const maxDuration = 60;

/** `node:crypto` and the postgres driver are both unavailable on edge. */
export const runtime = 'nodejs';

/**
 * Constant-time token comparison.
 *
 * `timingSafeEqual` THROWS on unequal lengths, so the length check is not an
 * optimisation — it is what stops a short token from turning a 401 into a 500.
 *
 * Copied from the voice door rather than shared with it, for the reason the
 * ClickSend doors give: a helper that took "the thing to compare" from either a
 * header or a query parameter is one refactor away from accepting a header on a
 * route whose provider cannot send one.
 */
function tokenMatches(provided: string | null, expected: string): boolean {
  const a = Buffer.from(provided ?? '', 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** 401 without a body that distinguishes "wrong token" from "no token". */
function unauthorized(): Response {
  return new Response('unauthorized', {
    status: 401,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

/** THE ONLY 200 THIS ROUTE PRODUCES — see the header. */
function received(): Response {
  return Response.json({ received: true });
}

export async function POST(request: Request): Promise<Response> {
  // THE ENVIRONMENT IS READ ONCE, AND ITS FAILURE IS NOT A 500 (WR-03).
  // `getServerEnv()` validates the WHOLE server schema; an env regression in
  // any key would otherwise throw here and turn every status callback into a
  // 5xx retry storm. The acknowledgement writes nothing, and the nightly
  // reconcile is the guarantee for any completion this door could not apply.
  let env: ReturnType<typeof getServerEnv>;
  try {
    env = getServerEnv();
  } catch {
    console.error('[twilio] status env_unreadable; acknowledged 200.');
    return received();
  }

  // AUTH FIRST, before the body is read. A caller without the token must not be
  // able to make this process do any work at all, including parsing.
  const token = new URL(request.url).searchParams.get('token');
  if (!tokenMatches(token, env.TWILIO_VOICE_STATUS_WEBHOOK_SECRET)) {
    return unauthorized();
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    // The stream itself failed. Nothing to verify and nothing to record.
    console.warn('[twilio] status body_unreadable; acknowledged 200.');
    return received();
  }

  // THE SIGNED URL IS BUILT FROM CONFIGURATION, NEVER FROM THE REQUEST.
  const url = twilioWebhookUrl('voice-status', env);
  if (url === null) {
    // FAIL CLOSED: no canonical URL means no signature can be checked.
    console.warn('[twilio] status base_url_unset; acknowledged 200.');
    return received();
  }

  const params = decodeFormBody(raw) ?? {};

  const signed = verifyTwilioSignature({
    authToken: env.TWILIO_AUTH_TOKEN,
    signature: request.headers.get('x-twilio-signature'),
    url,
    params,
  });
  if (!signed) {
    console.warn('[twilio] status signature_rejected; acknowledged 200.');
    return received();
  }

  const result = await applyVoiceStatus(params, { now: new Date() });

  // THE RESULT KIND, AND NOTHING ELSE. A member of a closed union — no CallSid,
  // no number, no token can reach a platform log through it.
  console.log(`[twilio] status handled: ${result.kind}.`);

  // D-01 — the call ended: text the caller back. ONLY the row id from the
  // completion UPDATE crosses; the send path reads everything else itself.
  // Truthiness, not `!== null`: an id that is absent in ANY form (null, empty,
  // undefined from a stubbed dependency) sends nothing.
  if (result.kind === 'completed' && result.callEnded && result.missedCallId && result.tenantId) {
    try {
      const textBack = await sendTextBack(result.missedCallId, {
        now: new Date(),
        getSender: buildRoutingSender,
      });
      console.log(`[twilio] status text_back: ${textBack.kind}.`);
    } catch {
      // `sendTextBack` never throws by contract; this is the belt. The value is
      // discarded — it could carry a statement parameter, i.e. a number.
      console.error('[twilio] status text_back threw; acknowledged 200.');
    }
  }

  return received();
}
