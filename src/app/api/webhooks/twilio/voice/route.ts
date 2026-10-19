/**
 * The voice door (Phase 11, CAP-02/CAP-03/CAP-04). A client's line diverts an
 * unanswered call to their Backdesk number; Twilio POSTs the call here and
 * EXECUTES WHATEVER THIS ROUTE ANSWERS AS THE LIVE CALL. This route
 * authenticates the request twice, records the call through
 * `recordMissedCallArrival`, and answers with the greeting. It decides nothing
 * itself.
 *
 * ── A URL TOKEN *AND* A SIGNATURE (T-11-01) ─────────────────────────────────
 *
 * The ClickSend doors have only a URL token, because ClickSend signs nothing.
 * Twilio signs every request: `X-Twilio-Signature` is an HMAC, keyed with the
 * account auth token, over the exact URL configured on the number (query string
 * included) and the form parameters. So this door checks both, in order:
 *
 *   1. THE TOKEN, in constant time, BEFORE A BYTE OF THE BODY IS READ. It is
 *      `TWILIO_VOICE_WEBHOOK_SECRET` — this route's OWN value, per the
 *      four-bearer rule, never the status route's. No token, no Twilio: the
 *      token is inside the configured URL, so a request without it cannot have
 *      come from a number we set up, and a 401 costs nothing.
 *   2. THE SIGNATURE, over the CANONICAL URL rebuilt from `APP_BASE_URL` by
 *      `twilioWebhookUrl()` — never over the incoming request's own URL, which
 *      Vercel's proxy rewrites. A request with the right token and a bad
 *      signature may BE Twilio (after an auth-token rotation, or a URL drift),
 *      so it is answered with the generic greeting and no write, not a 401: a
 *      4xx here is Twilio's error message played to a real customer.
 *
 * ── WHAT A FORGED REQUEST CAN DO, EXHAUSTIVELY ──────────────────────────────
 *
 * Without the auth token: nothing past a generic greeting. With it (i.e. with
 * Twilio's own signing key): one idempotent insert into `missed_calls` — keyed
 * on the CallSid, so a replay writes nothing — and a greeting naming the
 * business that owns the dialled number, which the caller already knew because
 * they dialled it. Nothing reachable from here sends a message.
 *
 * ── EVERY RESPONSE AFTER THE TOKEN GATE IS A 200 WITH THE SAME SHAPE ────────
 *
 * Signature rejected, base URL unset, body unreadable, unknown number, database
 * down, duplicate delivery, recorded — and an env that will not parse, which is
 * answered BEFORE the token gate because without the env there is no token to
 * compare (WR-03): all answer 200 `text/xml` with a Pause,
 * one Say and a Hangup. Never a 5xx — Twilio does not retry the incoming-call
 * webhook, it plays an application error to the caller. The call-log reconcile
 * (11-02) recovers any row this door could not write.
 *
 * ── THE GREETING NEVER WAITS ON A SECOND NETWORK CALL (D-03, R3) ────────────
 *
 * One read (whose number, what name, what window) and one deadline-bounded
 * insert. No ClickSend, no Anthropic, no `waitUntil`: the 15-second Twilio
 * ceiling includes TLS and a cold start.
 *
 * ── NOTHING HERE LOGS THE TOKEN, A NUMBER, THE SIGNATURE OR THE BODY ────────
 *
 * Fixed strings, and exactly one interpolation: the result kind, a member of a
 * closed union.
 */
import { timingSafeEqual } from 'node:crypto';

import { getServerEnv } from '@/core/shared/env';
import { greetingTwiml } from '@/core/telephony/greeting';
import { recordMissedCallArrival } from '@/core/telephony/missed-call';
import { decodeFormBody } from '@/core/telephony/parse-voice-webhook';
import { verifyTwilioSignature } from '@/core/telephony/verify-signature';
import { twilioWebhookUrl } from '@/core/telephony/webhook-url';

/**
 * One arrival is one read and one insert, both inside a 6-second deadline, and
 * the answer is due inside Twilio's 15. 60s is the siblings' decision, kept so
 * the number is a decision rather than an inherited default — the handler
 * responds long before it.
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
 * Copied from the ClickSend doors rather than shared with them, for the reason
 * those files give: a helper that took "the thing to compare" from either a
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

/** THE ONLY 200 THIS ROUTE PRODUCES: a TwiML document. */
function twiml(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/xml; charset=utf-8' },
  });
}

export async function POST(request: Request): Promise<Response> {
  // THE ENVIRONMENT IS READ ONCE, AND ITS FAILURE IS NOT A 500 (WR-03).
  // `getServerEnv()` validates the WHOLE server schema, so an env regression in
  // a key that has nothing to do with telephony would otherwise throw here and
  // Twilio would play its application-error message to the tradie's customer.
  // The static generic greeting needs nothing from the env and writes nothing,
  // so it is safe to serve unauthenticated; the fixed line says where to look.
  let env: ReturnType<typeof getServerEnv>;
  try {
    env = getServerEnv();
  } catch {
    console.error('[twilio] voice env_unreadable; served generic greeting.');
    return twiml(greetingTwiml(null));
  }

  // AUTH FIRST, before the body is read. A caller without the token must not be
  // able to make this process do any work at all, including parsing.
  const token = new URL(request.url).searchParams.get('token');
  if (!tokenMatches(token, env.TWILIO_VOICE_WEBHOOK_SECRET)) {
    return unauthorized();
  }

  // `.text()`, never `.formData()`: the raw bytes are what a dead letter keeps.
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    // The stream itself failed. Nothing to verify and nothing to record.
    console.warn('[twilio] voice body_unreadable; served generic greeting.');
    return twiml(greetingTwiml(null));
  }

  // THE SIGNED URL IS BUILT FROM CONFIGURATION, NEVER FROM THE REQUEST.
  const url = twilioWebhookUrl('voice', env);
  if (url === null) {
    // FAIL CLOSED: no canonical URL means no signature can be checked.
    console.warn('[twilio] voice base_url_unset; served generic greeting.');
    return twiml(greetingTwiml(null));
  }

  const params = decodeFormBody(raw) ?? {};

  const signed = verifyTwilioSignature({
    authToken: env.TWILIO_AUTH_TOKEN,
    signature: request.headers.get('x-twilio-signature'),
    url,
    params,
  });
  if (!signed) {
    console.warn('[twilio] voice signature_rejected; served generic greeting.');
    return twiml(greetingTwiml(null));
  }

  const result = await recordMissedCallArrival(params, raw, { now: new Date() });

  // THE RESULT KIND, AND NOTHING ELSE. A member of a closed union — no number,
  // no name, no token can reach a platform log through it.
  console.log(`[twilio] voice handled: ${result.kind}.`);

  return twiml(greetingTwiml(result.spokenName));
}
