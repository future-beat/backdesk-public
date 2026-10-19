/**
 * The delivery-receipt door (MSG-01). ClickSend POSTs a DLR here; this route
 * authenticates it, parses JSON defensively, and hands the decision to
 * `applyDeliveryReceipt`. It decides nothing itself.
 *
 * Deliberately the same shape as the inbound webhook one directory over — token
 * compared in constant time before a byte of the body is read, tolerant parse
 * one layer down, one uniform 200 — because the boundary is the same boundary.
 * Two things differ, and both are the point of this file existing separately.
 *
 * ── IT HAS ITS OWN SECRET, AND THAT IS THE WHOLE FOUR-BEARER RULE ───────────
 *
 * `CLICKSEND_DLR_SECRET`, not the inbound webhook's. Rotating one endpoint's
 * token must 401 that endpoint alone; a route that also accepted its sibling's
 * value would quietly make the two webhooks one endpoint with two URLs, and
 * every behavioural test would still pass. The suite asserts the inbound token
 * is REJECTED here, which is the only assertion that can fail on it.
 *
 * A URL QUERY TOKEN, NOT A BEARER HEADER. ClickSend's callback rules POST to a
 * URL we configure and offer no way to set request headers — the same
 * correction 04-02 had to make to the inbound secret after it was documented as
 * a bearer. A route reading an `Authorization` header here would 401 every real
 * receipt, silently and forever, while `cron` and the provider's own dashboard
 * both looked healthy.
 *
 * ── WHAT A FORGED REQUEST CAN DO, EXHAUSTIVELY ──────────────────────────────
 *
 * Stamp `delivery_status`, `delivery_detail`, `delivered_at` and
 * `delivery_updated_at` on ONE `send_ledger` row whose id or provider message
 * id the forger already knows. That is the complete list, enforced structurally
 * in `src/db/repository/delivery-receipts.ts`: the statement is an UPDATE with
 * an exact-match predicate, so a forgery cannot invent a send, cannot enumerate
 * anything, and cannot reach `outcome` — the column whose obvious follow-up
 * action is to send the message again (T-4-15).
 *
 * ── IT PARSES JSON *AND* FORM-ENCODED, BECAUSE THE RULE CANNOT BE TOLD ──────
 *
 * The inbound automation rule takes a `webhook_type`, and we set it to `json`.
 * A DELIVERY-RECEIPT rule has no such property: ClickSend documents exactly five
 * (`rule_name`, `match_type`, `action`, `action_address`, `enabled`), the API
 * rejects a POST missing any of them, and the created rule read back on
 * 2026-08-29 carried no `webhook_type` at all. Their documented DEFAULT
 * transport is `post` — "sends the event data using an HTTP POST request",
 * i.e. a form body, as distinct from `json`, "a custom JSON format".
 *
 * So the encoding of a real receipt is not ours to choose and was, until this
 * was written, unobserved. A JSON-only parse would have answered every genuine
 * receipt with a cheerful 200 and a `console.warn`, leaving the four delivery
 * columns NULL forever while the ClickSend dashboard showed a healthy rule —
 * recovered only by the nightly poll, one day late, which is the backstop doing
 * a job it should not have to do daily.
 *
 * A form body decodes to a flat map of STRINGS. That costs nothing: the receipt
 * schema already unions `number | string` on every numeric field, for the
 * unrelated reason that a provider sending `"1756351200"` and one sending
 * `1756351200` are the same provider on different days.
 *
 * ── AN UNPARSEABLE BODY IS A 200 AND NO ROW ANYWHERE ────────────────────────
 *
 * The inbound route dead-letters an unreadable payload because a customer's
 * reply is irreplaceable. A delivery receipt is not: it is the HINT half of the
 * hint-and-guarantee split, and `reconcile.ts`'s daily ClickSend poll recovers
 * anything this door drops. So an unreadable DLR is a counted log line and
 * nothing more — which also means holding this token buys no write surface at
 * all, not even a notepad.
 *
 * The 200 itself is uniform for the same reason the inbound route's is: a body
 * that distinguished "applied" from "unmatched" would tell a token holder which
 * ids name real sends, one request at a time.
 */
import { timingSafeEqual } from 'node:crypto';

import { applyDeliveryReceipt } from '@/core/messaging/receipts';
import { getServerEnv } from '@/core/shared/env';

/**
 * One receipt is one indexed UPDATE and no network call to anyone. 60s exists
 * so a database hiccup fails as a timeout rather than at Vercel's default, and
 * so the number is a decision rather than an inherited one.
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
 * Adapted from the inbound route rather than shared with it, for the reason
 * that file gives about the tick routes: a helper that took "the thing to
 * compare" from either a header or a query parameter is one refactor away from
 * accepting a header on a route whose provider cannot send one.
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

/**
 * A request body in either transport ClickSend might use, or `undefined` when it
 * is neither.
 *
 * JSON FIRST, and the form attempt is GUARDED rather than a bare fallback. That
 * guard is the whole subtlety: `new URLSearchParams('this is not json at all')`
 * does not fail — it cheerfully yields one entry whose KEY is the entire
 * sentence and whose value is empty. An unguarded fallback would therefore turn
 * every scrap of garbage into a well-formed-looking object, hand it to the core,
 * and convert the "we could not read this" signal — the one that says ClickSend
 * changed their format — into a silent `unparseable` indistinguishable from a
 * receipt for a send we do not hold.
 *
 * So a body only qualifies as form-encoded if it contains an `=` and does not
 * open like JSON. A real one (`message_id=CS-1&status=Delivered`) passes; prose
 * does not.
 *
 * The content-type header is deliberately NOT consulted. It is a claim by the
 * sender about a body we are about to read anyway, and the failure it invites is
 * the expensive direction: a receipt discarded for being labelled wrong.
 */
function decodeBody(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    // Not JSON. Fall through to the guarded form attempt.
  }

  const trimmed = text.trim();
  if (trimmed === '' || trimmed.startsWith('{') || trimmed.startsWith('[')) return undefined;
  if (!trimmed.includes('=')) return undefined;

  const entries = [...new URLSearchParams(trimmed).entries()].filter(([key]) => key !== '');
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

export async function POST(request: Request): Promise<Response> {
  // AUTH FIRST, before the body is read. A caller without the token must not be
  // able to make this process do any work at all, including parsing.
  const token = new URL(request.url).searchParams.get('token');
  if (!tokenMatches(token, getServerEnv().CLICKSEND_DLR_SECRET)) {
    return unauthorized();
  }

  const payload = decodeBody(await request.text());
  if (payload === undefined) {
    // COUNT ONLY, no row and no payload. A rising rate here is the signal that
    // ClickSend changed their callback format; the diagnosis then comes from
    // the reconciliation poll, which reads the same facts from their API in a
    // shape we can inspect at will.
    console.warn('[clicksend] dlr body was readable as neither JSON nor a form; acknowledged 200.');
    return received();
  }

  const result = await applyDeliveryReceipt(payload);

  // THE RESULT KIND, AND NOTHING ELSE. A member of a closed union — no id, no
  // number, no provider status text can reach a platform log through it.
  console.log(`[clicksend] dlr handled: ${result.kind}.`);

  return received();
}
