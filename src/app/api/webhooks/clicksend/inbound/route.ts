/**
 * The inbound SMS door (MSG-03, MSG-04). ClickSend POSTs a customer's reply
 * here; this route authenticates it, parses defensively, and hands the decision
 * to `handleInboundSms`. It decides nothing itself.
 *
 * ── A URL TOKEN IS THE AUTHENTICATION, BECAUSE THERE IS NO SIGNATURE (T-4-05) ─
 *
 * ClickSend's inbound-SMS rules POST to a URL of our choosing and sign nothing —
 * there is no HMAC header to verify, so "is this really ClickSend" cannot be
 * answered cryptographically at this boundary. What CAN be answered is "does
 * the caller hold a 64-hex secret only we and ClickSend's rule configuration
 * know", so that is what this checks, in constant time, before reading a byte of
 * the body.
 *
 * The token lives in the query string because that is the only place a
 * provider-configured callback URL can carry one. Two consequences, both
 * accepted deliberately:
 *
 *   • It appears in access logs at every hop. That is why it is its OWN secret
 *     (`CLICKSEND_WEBHOOK_SECRET`, one of four, per the 04-01 four-bearer rule)
 *     and not the tick's: rotating it 401s this endpoint alone, and a leaked
 *     value grants exactly the powers below and nothing else.
 *   • It is not a signature, so a forged POST is possible for anyone who learns
 *     it. Which is survivable ONLY because of what the effects are.
 *
 * ── WHAT A FORGED REQUEST CAN DO, EXHAUSTIVELY ──────────────────────────────
 *
 * Suppress a contact, stop a cadence, pause a cadence, upgrade a pause reason,
 * and write a row. That is the complete list, enforced one layer down in
 * `handleInboundSms` — nothing reachable from here sends a message, approves a
 * touch, or resumes anything. So the worst outcome of a forgery is that a
 * cadence STOPS, which is the direction this system is allowed to fail in.
 * "Suppressing is always safe, sending is not."
 *
 * ── EVERY PARSEABLE REQUEST GETS THE SAME 200 (T-4-08) ──────────────────────
 *
 * `{ received: true }`, byte-identical, whether the reply threaded to a cadence,
 * matched eleven, matched none, or was an opt-out. A body that distinguished
 * them would be an ATTRIBUTION ORACLE: anyone holding the token and a list of
 * phone numbers could sort them into "currently being chased by a client of this
 * service" and "not", which is a customer list assembled one 200 at a time. The
 * same reasoning the ServiceM8 webhook applies to job uuids, one channel over.
 *
 * ── AN UNPARSEABLE BODY IS A 200 AND A DEAD-LETTER ROW (T-4-07, T-4-09) ─────
 *
 * ClickSend's push payload shape is under-documented, so "we did not recognise
 * this" is a thing that will happen in production the first time they add a
 * field or a wrapper. A 4xx would be the honest HTTP answer and the wrong
 * product answer: their retry behaviour on an error is to keep re-delivering for
 * up to 72 hours and to THROTTLE the rule after repeated failures, so a shape
 * change would degrade delivery of every OTHER customer's replies too. Instead
 * the payload is recorded verbatim as `attribution: 'dead_letter'` with
 * `raw_payload` set, which is a diagnosable event on the triage screen rather
 * than a silent gap — and 04-04's reconciliation poll is the belt to this
 * braces.
 *
 * ── NOTHING HERE LOGS THE TOKEN, THE NUMBER, OR THE BODY (T-4-08) ───────────
 *
 * The token is compared and never referenced again — not in a log, not in a
 * response, not in an error. `from` and `body` are handed straight to core and
 * never interpolated. Result kinds and counts only.
 */
import { timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { handleInboundSms } from '@/core/messaging/inbound';
import { getServerEnv } from '@/core/shared/env';
import { insertInboundMessage } from '@/db/repository';

/**
 * One inbound reply is one lookup, up to a handful of small writes, and no
 * network call to anyone. 60s is generous; it exists so a database hiccup fails
 * as a timeout rather than at Vercel's default, and so the number is a decision
 * rather than a default.
 */
export const maxDuration = 60;

/** `node:crypto` and the postgres driver are both unavailable on edge. */
export const runtime = 'nodejs';

/**
 * How much of an unrecognised payload we keep.
 *
 * `raw_payload` exists to diagnose a provider shape change, and the first 8k of
 * one answers that. Unbounded, it would let anyone holding the token write
 * arbitrarily large blobs into a table an operator's triage screen reads —
 * storage a third party controls the size of.
 */
const MAX_RAW_PAYLOAD_CHARS = 8_000;

/**
 * TOLERANT BY DESIGN — hard-require only what is acted on.
 *
 * `from` and `body` are the two fields every decision downstream is made from:
 * without a sender there is nobody to thread to, and without a body there is no
 * opt-out to detect. Everything else is optional, and unknown keys are NOT an
 * error (`looseObject`), because ClickSend's push payload is under-documented
 * and a strict schema would turn "they added a field" into "every reply becomes
 * a dead letter".
 *
 * `body` is `z.string()` with no `.min(1)`: a provider can and does deliver an
 * empty-bodied SMS, and that is a real message from a real person, not a
 * malformed request.
 */
const inboundPayload = z.looseObject({
  from: z.string().min(1),
  body: z.string(),
  /** Which of our numbers it arrived on. */
  to: z.string().optional(),
  /** ClickSend's own id — 04-04's reconciliation dedupe key. */
  message_id: z.string().optional(),
});

/**
 * Constant-time token comparison.
 *
 * `timingSafeEqual` THROWS on unequal lengths, so the length check is not an
 * optimisation — it is what stops a short token from turning a 401 into a 500.
 * It does leak the secret's length, which is not a useful thing to learn about a
 * 64-character random string.
 *
 * Adapted from `bearerMatches` in the two tick routes rather than shared with
 * them: those read an `Authorization: Bearer` header and this reads a query
 * parameter, and a helper that took "the thing to compare" from either place is
 * one refactor away from accepting a header on a route whose provider cannot
 * send one.
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

/**
 * THE ONLY 200 THIS ROUTE PRODUCES. One field, enumerated, and identical for
 * every outcome — see the header on the attribution oracle.
 */
function received(): Response {
  return Response.json({ received: true });
}

export async function POST(request: Request): Promise<Response> {
  // AUTH FIRST, before the body is read. A caller without the token must not be
  // able to make this process do any work at all, including parsing.
  const token = new URL(request.url).searchParams.get('token');
  if (!tokenMatches(token, getServerEnv().CLICKSEND_WEBHOOK_SECRET)) {
    return unauthorized();
  }

  // `.text()` rather than `.json()`, deliberately: a body that is not JSON at
  // all is exactly the case `raw_payload` exists for, and `request.json()`
  // throws away the bytes on its way to the exception.
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    // The stream itself failed — an aborted upload, a truncated request. There
    // is nothing to record but the fact, and even that is worth a row.
    await deadLetter({ body_unreadable: true });
    return received();
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    await deadLetter({ unparseable_body: raw.slice(0, MAX_RAW_PAYLOAD_CHARS) });
    return received();
  }

  const parsed = inboundPayload.safeParse(payload);
  if (!parsed.success) {
    // Shape we do not recognise. The payload is kept as it arrived — this is
    // the row somebody reads when ClickSend changes their callback format —
    // unless it is enormous, in which case a truncated string of it is, for the
    // same reason the unparseable branch truncates: the caller decides the size
    // of anything stored here.
    await deadLetter(
      raw.length > MAX_RAW_PAYLOAD_CHARS
        ? { oversized_payload: raw.slice(0, MAX_RAW_PAYLOAD_CHARS) }
        : payload,
      raw.length,
    );
    return received();
  }

  const result = await handleInboundSms({
    from: parsed.data.from,
    to: parsed.data.to ?? null,
    body: parsed.data.body,
    providerMessageId: parsed.data.message_id ?? null,
  });

  // THE RESULT KIND, AND NOTHING ELSE. It is a member of a closed union — no
  // number, no address, no message text can reach a platform log through it.
  console.log(`[clicksend] inbound handled: ${result.kind}.`);

  return received();
}

/**
 * Record a payload we could not act on.
 *
 * `from_address` is `''` rather than a guess: the column is NOT NULL because
 * every ordinary inbound has a sender, and inventing one here would put a
 * fabricated address on the one screen an operator triages from. Empty means
 * "we never learned it", which is the truth.
 *
 * `normalized_from` is left NULL, so this row can never be matched by the
 * threading lookup — a dead letter is evidence, not a message we understood.
 */
async function deadLetter(payload: unknown, rawLength?: number): Promise<void> {
  const { id } = await insertInboundMessage({
    channel: 'sms',
    fromAddress: '',
    normalizedFrom: null,
    toAddress: null,
    body: '',
    providerMessageId: null,
    isStop: false,
    attribution: 'dead_letter',
    matchedCadenceCount: 0,
    rawPayload: payload,
  });

  // The LENGTH is a count; the content is not. A shape change shows up here as
  // a rising dead-letter rate, and the row itself holds the diagnosis.
  //
  // The size is resolved to a string BEFORE the template rather than with a
  // nested one, so that every interpolation in this file is a single plain
  // expression — which is what makes the pinned-interpolation assertion in
  // `tests/clicksend-inbound-route.test.ts` able to read them at all.
  const size = rawLength === undefined ? 'unreadable' : String(rawLength);
  console.warn(
    `[clicksend] inbound ${id} recorded as dead_letter (${size} bytes); acknowledged 200.`,
  );
}
