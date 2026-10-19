/**
 * ServiceM8 webhooks as HINTS TO POLL (SYNC-03) — never as a source of record.
 *
 * ── THE ONE RULE THIS FILE EXISTS TO ENFORCE ────────────────────────────────
 *
 * **Nothing from the request body is ever written to the database.** The payload
 * is parsed for exactly one thing — a job uuid — and that uuid is used only to
 * decide *whose* authenticated re-fetch to run. The re-fetch is the truth.
 *
 * This is not defensive style, it is the threat model (T-2-05). The endpoint is
 * unauthenticated by construction: ServiceM8 signs nothing, and the callback URL
 * is knowable. Anyone can POST here. If a payload field could reach a column,
 * anyone could set a client's quote to "Work Order" and fabricate a win the
 * monthly report bills against. Because the only thing a forged payload can do
 * is cause an authenticated poll of a tenant's own account, the worst outcome of
 * a flood is a poll we were going to do anyway — and the 60-second debounce
 * bounds even that.
 *
 * Grep this file for a write: there is none. `runSyncForConnection` does the
 * writing, from data it fetched itself with the client's own credential.
 *
 * ── POLLING REMAINS THE GUARANTEE ───────────────────────────────────────────
 *
 * Every unresolvable case here returns 200 and does nothing: unknown job uuid,
 * paused connection, debounced, unparseable body. None of them is a failure,
 * because the five-minute tick will cover the same ground within one interval.
 * A webhook can only ever make sync *faster*, never different — which is why
 * this route is safe to leave inert until OAuth credentials land, and why it can
 * stay a pure accelerator afterwards.
 *
 * ── WHY EVERY RESPONSE IS 200 ───────────────────────────────────────────────
 *
 * ServiceM8's delivery behaviour makes non-200 actively harmful (CLAUDE.md
 * §ServiceM8 webhook facts): a 429 from us throttles delivery for 15 minutes, a
 * 410 AUTO-UNSUBSCRIBES us, and retries continue for 72 hours. A 500 on a
 * malformed payload therefore converts a parse bug into hours of retry traffic
 * or a silently cancelled subscription. There is nothing to report to ServiceM8
 * anyway — the outcome of the poll is recorded in `sync_runs`, where the
 * operator can see it.
 *
 * ── STATUS: INERT UNTIL OAUTH ───────────────────────────────────────────────
 *
 * A private API key cannot create a webhook subscription; only an OAuth public
 * app can. Until the Development Partner credentials for App ID 000000 are
 * issued, nothing calls this route. The activation steps — including the one
 * unverified detail, the exact challenge-echo shape — are in
 * docs/servicem8-api-notes.md §Webhook activation.
 */
import { z } from 'zod';

import { runSyncForConnection } from '@/core/sync/run-sync';
import { forAllTenants_webhookHint } from '@/db/repository';

export const runtime = 'nodejs';

/**
 * Per-tenant debounce (T-2-05). A tradie updating six jobs in one minute
 * produces six callbacks; without this, six full fetch cycles run against an
 * account with a 180-requests-per-minute cap, for a set of changes one cycle
 * would have covered.
 *
 * 60 seconds is chosen against the five-minute tick: it collapses a burst while
 * still leaving a webhook five times more responsive than polling alone, which
 * is the entire reason to accept webhooks at all.
 */
const DEBOUNCE_MS = 60_000;

/**
 * The ONLY fields read from an untrusted body.
 *
 * The schema is STRICT by omission — zod object parsing strips unknown keys, and
 * no passthrough mode is enabled — and the `changed fields` are deliberately not
 * modelled at all: a field this schema cannot see is a field no future edit can
 * accidentally persist. ServiceM8 sends `{uuid, <changed fields>, resource_url}`
 * per object; batch deliveries wrap them in `entry`. Both shapes are accepted
 * because the payload envelope is documented loosely and guessing wrong here
 * costs a poll, not correctness.
 */
const hintPayload = z.union([
  z.object({ uuid: z.uuid() }),
  z.object({ entry: z.array(z.object({ uuid: z.uuid() })).min(1) }),
]);

/**
 * The subscription handshake. ServiceM8 POSTs a challenge to a candidate
 * callback URL and expects it echoed back before the subscription becomes live.
 *
 * UNVERIFIED DETAIL, FLAGGED RATHER THAN ASSUMED: the docs state that the
 * challenge must be echoed but do not pin the response encoding. This answers
 * with the raw value as `text/plain`, which is the common form. If the live
 * subscription call rejects it, the fix is the one line marked below — switch to
 * `Response.json({ challenge })`. Recorded in docs/servicem8-api-notes.md so the
 * person activating this does not have to rediscover it.
 */
const challengePayload = z.object({ challenge: z.string().min(1) });

/**
 * ONE response for every hint, resolvable or not (WR-01).
 *
 * An earlier revision returned `polled` / `debounced` / `unknown` / `ignored`,
 * with a comment correctly explaining that distinguishing "not ours" from
 * "paused" would be an enumeration oracle over client accounts — and then
 * distinguishing both of those from "ours, and active". That is the same oracle
 * with one fewer bit: anyone holding a set of ServiceM8 job uuids (a competitor,
 * a former staff member, another ServiceM8 app) could sort them into "mirrored
 * by a client of this service" and "not", which is a client list.
 *
 * The status values were only ever for local debugging, and this endpoint has
 * nobody to report to: ServiceM8 does nothing with the body, and the outcome of
 * the poll is recorded in `sync_runs` where the operator can actually see it.
 *
 * A TIMING CHANNEL REMAINS and is deliberately left documented rather than
 * silently half-fixed: `polled` awaits a full multi-request sync cycle while an
 * unresolvable uuid returns after one indexed SELECT. Closing it means detaching
 * the poll from the response, which needs a durable queue (pgmq, Phase 3) rather
 * than a fire-and-forget promise that Vercel may kill at function exit. Until
 * then, the body does not also advertise the answer.
 */
function acknowledged(): Response {
  return Response.json({ status: 'accepted' });
}

function echoChallenge(challenge: string): Response {
  // ← the one line to change if ServiceM8 rejects the plain-text echo.
  return new Response(challenge, {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

/**
 * Some providers verify a callback URL with a GET carrying the challenge in the
 * query string. Harmless to support and cheaper than discovering it during a
 * subscription call that fails for an unrelated-looking reason.
 */
export async function GET(request: Request): Promise<Response> {
  const challenge = new URL(request.url).searchParams.get('challenge');
  if (challenge) return echoChallenge(challenge);
  return acknowledged();
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    // Not JSON. Nothing to hint at; the tick covers it.
    return acknowledged();
  }

  const challenge = challengePayload.safeParse(body);
  if (challenge.success) return echoChallenge(challenge.data.challenge);

  const parsed = hintPayload.safeParse(body);
  if (!parsed.success) return acknowledged();

  const uuid = 'uuid' in parsed.data ? parsed.data.uuid : parsed.data.entry[0].uuid;

  const connection = await forAllTenants_webhookHint(uuid);
  if (!connection) {
    // Unknown job, or a paused connection. Deliberately logs nothing: the uuid
    // belongs to a third party. Indistinguishable from every other outcome in
    // the response — see `acknowledged`.
    return acknowledged();
  }

  // DEBOUNCE ON THE LAST ATTEMPT, NOT THE LAST SUCCESS (WR-02).
  //
  // `last_success_at` advances only on the success path of
  // `runSyncForConnection`. Measured from it, the debounce stops engaging the
  // moment an account starts failing — `since` grows without bound through any
  // rate_limited / network_error / server_error / parse_error episode, so it
  // never engages again until a cycle succeeds.
  //
  // That inverts the protection. The header below justifies the debounce as a
  // guard for an account with a 180-req/min cap; the scenario it guarded was a
  // burst, and the scenario it failed in was a SUSTAINED FAILURE — where each
  // unauthenticated POST triggered a fresh fetchAndParse (two resources, up to
  // three attempts each, 20s timeouts, jittered sleeps) against a third party's
  // already-struggling account, on a schedule the caller chooses, inflating
  // `consecutive_failures` along the way.
  //
  // `lastAttemptAt` is written by every cycle, success or failure, so the
  // debounce now holds hardest exactly when the account is in trouble. Taking
  // the max of the two is belt-and-braces: a success is also an attempt, but a
  // connection that has never failed has no `sync_runs` row older than its
  // success either way.
  const lastActivity = Math.max(
    connection.lastSuccessAt?.getTime() ?? Number.NEGATIVE_INFINITY,
    connection.lastAttemptAt?.getTime() ?? Number.NEGATIVE_INFINITY,
  );
  const since =
    lastActivity === Number.NEGATIVE_INFINITY ? Number.POSITIVE_INFINITY : Date.now() - lastActivity;
  if (since < DEBOUNCE_MS) return acknowledged();

  try {
    // THE SAME CYCLE THE TICK RUNS. Not a webhook-shaped variant of it — one
    // implementation, so the emission, idempotence and failure-policy guarantees
    // proven for the poll are the guarantees this path has too.
    await runSyncForConnection(connection);
  } catch {
    // Not logged, and not surfaced (T-2-02): a throw from this depth can carry a
    // Request whose one header is the client's ServiceM8 API key. The failure is
    // already recorded in `sync_runs` wherever it was classifiable, and the tick
    // retries in under five minutes regardless.
  }

  return acknowledged();
}
