/**
 * The daily stalled-draft digest (CON-04, D-11), AND the daily audit-upload
 * purge (Phase 9, LAND-02, D-11, threat T-9-06). pg_cron POSTs here at 06:30
 * Australia/Perth; this route reads everything still stalled, mails the
 * operator one roll-up, deletes every expired prospect upload, and reports how
 * much of each it found.
 *
 * A deliberate clone of the messaging-reconcile route's shape, which is itself
 * a clone of the cadence tick's: a bearer-authenticated, `api/`-excluded,
 * awaited, counts-only internal job. Everything below that is not a count is a
 * comment explaining why it is identical.
 *
 * ── THIS ROUTE OWNS ITS OWN AUTH, AND IT IS THE ONLY AUTH (WR-01) ───────────
 *
 * `proxy.ts`'s matcher excludes `api/`, so nothing runs before this handler.
 * Both halves are load-bearing together, verbatim as the two ticks state them:
 *
 *   WITHOUT the exclusion: the proxy answers an unauthenticated POST with a 307
 *   to /login. `net.http_post` got *a* response, so `cron.job_run_details`
 *   records success — every morning, forever, green, while no digest is ever
 *   sent and the operator concludes there is nothing waiting on them.
 *
 *   WITH the exclusion and no bearer check: an unauthenticated endpoint anyone
 *   on the internet can use to mail the operator on demand, as fast as they can
 *   POST — which is both a nuisance and, faster than anyone would like, the
 *   reason the alert that mattered was in a folder.
 *
 * ── ITS OWN SECRET (STALLED_DIGEST_SECRET) ─────────────────────────────────
 *
 * The sixth bearer, not a reuse of the cadence tick's. Rotating one bearer must
 * 401 one endpoint — and these two differ in the direction that matters here:
 * sharing would mean a cadence-tick rotation ALSO silences the digest that tells
 * the operator drafts are piling up, so the two failures compound at exactly the
 * moment somebody needs the second one to notice the first.
 *
 * ── WHY THE UPLOAD PURGE RIDES HERE RATHER THAN ON ITS OWN CRON ────────────
 *
 * An attached Job List export is a stranger's CUSTOMERS, kept for 30 days and
 * then deleted — a promise `/privacy` makes in words and this handler keeps in
 * fact. It cannot be kept by pg_cron alone: Supabase Storage has no SQL delete
 * ("All operations … should exclusively go through the API"), so the purge needs
 * an authenticated HTTP entry point on a daily schedule. This route already is
 * one. A seventh internal route would mean a seventh bearer to rotate, and a
 * seventh cron entry to keep in step, for work with no separate schedule of its
 * own (09-RESEARCH §6, assumption A8 — accepted).
 *
 * The digest runs FIRST and the purge cannot un-send it: a Storage outage that
 * failed the purge must not also cost the operator the one email that tells them
 * drafts are piling up. The purge reports its own failures as a count instead,
 * and every object it could not delete keeps its row — so tomorrow's tick tries
 * again rather than orphaning a file nothing points at.
 *
 * ── SYNCHRONOUS, AND WHY 60s IS ENOUGH ─────────────────────────────────────
 *
 * `waitUntil` is ruled out for must-happen work (CLAUDE.md). Unlike the
 * reconcile sweep this route makes ONE grouped query and at most one Resend
 * call, so it does not need the Fluid ceiling; `pg_net`'s own 8s timeout covers
 * dispatch only and does not wait for us either way. The purge adds one small
 * read and a handful of object deletes at this scale.
 */
import { timingSafeEqual } from 'node:crypto';

import { runStalledDigest } from '@/core/aging/stalled-digest';
import { resendStalledEmailSender } from '@/core/alerts/stalled-drafts';
import { getServerEnv } from '@/core/shared/env';
import { purgeExpiredAuditUploads } from '@/db/repository';

/** One grouped read and one email. Generous, not a budget to grow into. */
export const maxDuration = 60;

/** `node:crypto` and the postgres driver both need the Node runtime. */
export const runtime = 'nodejs';

/**
 * Constant-time bearer comparison.
 *
 * `timingSafeEqual` THROWS on unequal lengths, so the length check is not an
 * optimisation — it is what stops a short header from turning a 401 into a 500.
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
  if (!bearerMatches(request.headers.get('authorization'), getServerEnv().STALLED_DIGEST_SECRET)) {
    return unauthorized();
  }

  // THIS ROUTE IS THE COMPOSITION ROOT. `runStalledDigest` defaults its sink to
  // a no-op that reports `not_configured`, for the reason `src/core` is
  // framework-free at all: it is reachable from a script and from the remote
  // suite, and a real Resend default there would mean a test run mails the
  // operator. This is the one genuinely production caller.
  const result = await runStalledDigest({ send: resendStalledEmailSender });

  // AFTER the digest, deliberately (see the header). Deletes every object past
  // its 30-day `csv_purge_after` stamp, nulls the row's four csv columns, and
  // sweeps day-old throttle counter rows in the same pass — those are hashed
  // addresses kept for nothing once their hour window is gone.
  const purge = await purgeExpiredAuditUploads();

  // COUNTS ONLY, enumerated field by field rather than spread — the T-3-24 rule
  // the cadence tick states. This body reaches `cron.job_run_details` and the
  // Vercel log, and the work behind it counts rows attached to customers'
  // names, numbers and drafts. A spread would let a field added later for an
  // operator's benefit ride straight there, which is why the absence of one is
  // checked rather than remembered. No client names: the digest says
  // WHICH clients in the email, which is addressed to one person and is not a
  // log.
  return Response.json({
    tenantsAffected: result.tenantsAffected,
    touchesStalled: result.touchesStalled,
    digestSent: result.digestSent,
    digestFailed: result.digestFailed,
    digestSkippedEmpty: result.digestSkippedEmpty,
    // Counts, not paths: an object key carries a request id and a prospect's
    // own filename, and this body reaches cron.job_run_details and the Vercel
    // log. `uploadsPurgeFailed` climbing day after day is the signal that
    // Storage is refusing deletes and the retention promise is not being kept.
    uploadsPurged: purge.purged,
    uploadsPurgeFailed: purge.failed,
    throttleSwept: purge.throttleSwept,
  });
}
