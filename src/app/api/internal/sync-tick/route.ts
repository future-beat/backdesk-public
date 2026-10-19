/**
 * The five-minute heartbeat (SYNC-01, D-13). pg_cron POSTs here; this route runs
 * one sync cycle per unpaused connection and reports what happened.
 *
 * ── THIS ROUTE OWNS ITS OWN AUTH, AND IT IS THE ONLY AUTH (WR-01, T-2-03) ────
 *
 * `proxy.ts`'s matcher excludes `api/`, so nothing runs before this handler —
 * no session refresh, no redirect, no cookie. That exclusion is deliberate and
 * the two halves of it are load-bearing together:
 *
 *   WITHOUT the exclusion (RESEARCH Pitfall 7): the proxy sees an unauthenticated
 *   POST and answers 307 → /login. `net.http_post` got *a* response, so
 *   `cron.job_run_details` records success — every five minutes, forever, all
 *   green, while `sync_runs` stays empty and no client is ever synced. The
 *   failure is silent in the one place an operator would look for it.
 *
 *   WITH the exclusion and no bearer check: this becomes an unauthenticated
 *   endpoint that decrypts every client's ServiceM8 key and hammers their API.
 *
 * So: the matcher must exclude it AND this file must reject anything without the
 * shared secret. Both are asserted in `tests/sync-tick-route.test.ts`, including
 * the negative that matters most — the unauthenticated response is a plain 401
 * with no `Location` header, i.e. provably not a redirect.
 *
 * ── SYNCHRONOUS, NOT FIRE-AND-FORGET ────────────────────────────────────────
 *
 * `runSyncTick()` is awaited inside the request. `waitUntil` is explicitly ruled
 * out for must-happen work (CLAUDE.md §What NOT to Use): it is best-effort and
 * bounded by the function's duration anyway, so it buys nothing here except the
 * ability to return 200 for work that never ran. `net.http_post`'s own 8s
 * timeout covers dispatch only — pg_cron does not wait for us, and does not need
 * to, because `sync_runs` is where the outcome is durably recorded.
 *
 * Region `syd1` (vercel.json) keeps execution next to the Sydney database.
 */
import { timingSafeEqual } from 'node:crypto';

import { getServerEnv } from '@/core/shared/env';
import { runSyncTick } from '@/core/sync/run-sync';

/** Vercel Fluid ceiling per CLAUDE.md. Fifteen clients complete in seconds. */
export const maxDuration = 300;

/** `node:crypto` and the postgres driver both need the Node runtime. */
export const runtime = 'nodejs';

/**
 * Constant-time bearer comparison.
 *
 * `timingSafeEqual` THROWS on unequal lengths, so the length check is not an
 * optimisation — it is what stops a short header from turning a 401 into a 500.
 * It does leak the secret's length, which is not a useful thing to learn about a
 * 32+ character random string.
 */
function bearerMatches(header: string | null, expected: string): boolean {
  const provided = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** 401 without a body that distinguishes "wrong secret" from "no secret". */
function unauthorized(): Response {
  return new Response('unauthorized', {
    status: 401,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!bearerMatches(request.headers.get('authorization'), getServerEnv().SYNC_TICK_SECRET)) {
    return unauthorized();
  }

  const results = await runSyncTick();

  // KINDS AND COUNTS ONLY (T-2-15). `outcome` is drawn from the closed
  // `sync_runs` vocabulary, never from a caught error, and the alert is reduced
  // to a boolean so the client's business name does not travel in a response
  // that ends up in a cron log.
  return Response.json({
    connections: results.length,
    // WR-03. A tick that ran out of budget leaves no `sync_runs` row and no
    // `consecutive_failures` increment for the clients it never reached, so
    // without this the response — the one artefact a cron log keeps — was
    // indistinguishable from a tick that synced everyone. A non-zero value here
    // means the tick is over budget and the client list needs splitting.
    skipped: results.filter((r) => r.skipped).length,
    outcomes: results.map((r) => ({
      tenantId: r.tenantId,
      outcome: r.outcome,
      recorded: r.recorded,
      skipped: r.skipped,
      paused: r.paused,
      alerted: r.alert !== null,
      jobsFetched: r.jobsFetched,
      jobsUpserted: r.jobsUpserted,
      contactsFetched: r.contactsFetched,
      eventsEmitted: r.eventsEmitted,
    })),
  });
}
