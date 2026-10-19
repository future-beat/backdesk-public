/**
 * The daily messaging sweep (MSG-01, T-4-18). pg_cron POSTs here at 03:30 AWST;
 * this route runs one reconciliation — history poll, inbound poll, opt-out
 * evidence — and reports how much it found.
 *
 * ── AND THE CALL-LOG SWEEP RIDES THE SAME TICK (11-03, CAP-03/CAP-02) ────────
 *
 * After the messaging pass, `reconcileMissedCalls` converges Twilio's inbound
 * call log onto `missed_calls` and counts recordings on the account (D-04). It
 * rides THIS tick on purpose — no second pg_cron job, no second bearer, no
 * second route (planning note S8): one more nightly job is one more thing that
 * can fail green. It runs whether or not sms is armed, because it has its own
 * total guard (no active divert number, or no Twilio credentials → zero HTTP
 * calls), and it never throws; the route adds a `.catch` anyway so a throw that
 * escaped it would still answer 200 with zeros for its two fields.
 *
 * ── AND THE PSEUDONYMISATION PASS RIDES IT TOO (Phase 15, 15-07, COMP-02) ───
 *
 * Third and last, the nightly retention pass (`@/core/leads/pseudonymise`,
 * D-06): every caller number past the ninety-day boundary becomes a keyed
 * hash. Same reasoning as the call-log sweep — no new pg_cron job, no
 * `cron:apply`. The caller pepper is read ONCE, here at the edge, and handed
 * down as an argument; the pass itself never reads the environment. It never
 * throws, and the route adds the same `.catch` belt.
 *
 * ── EVERY PASS IS GUARDED, THE FIRST ONE TOO (15-REVIEW WR-09) ──────────────
 *
 * The messaging pass runs first, and it was the one pass without a belt: a
 * throw that escaped `reconcileMessaging` left `POST`, recorded a 500, and the
 * telephony sweep and the retention pass behind it did not run that night. It
 * now carries its own `.catch`, logged by kind with the caught value
 * discarded, and reports `messagingFailed: true` with `skipped: true` and zero
 * counts, so the two passes behind it always run.
 *
 * The body is exactly eighteen fields: `skipped`, `receiptsApplied`,
 * `inboundReplayed`, `optOutsRecorded` and `messagingFailed` (messaging), then
 * `missedCallsRecovered`,
 * `recordingsFound` and `recordingsCheckFailed` (telephony), then the pass's
 * ten counts, each prefixed `pseudonymised…` / `pseudonymise…` (privacy; the
 * tenth, `pseudonymisedInboundRowsNoLead`, is 15-REVIEW WR-01's late replies).
 * `skipped` stays the MESSAGING pass's flag. `recordingsFound` is `null` when
 * the count could not be read (WR-05) — never a 0 that reads as "verified
 * none".
 *
 * A deliberate clone of the cadence-tick route's shape, because it is the same
 * kind of endpoint: a bearer-authenticated, `api/`-excluded, awaited,
 * counts-only internal tick. Everything below that is not a count is a comment
 * explaining why it is identical.
 *
 * ── THIS ROUTE OWNS ITS OWN AUTH, AND IT IS THE ONLY AUTH (WR-01) ───────────
 *
 * `proxy.ts`'s matcher excludes `api/`, so nothing runs before this handler.
 * Both halves of that are load-bearing together, verbatim as the cadence tick
 * states them:
 *
 *   WITHOUT the exclusion: the proxy answers an unauthenticated POST with a 307
 *   to /login. `net.http_post` got *a* response, so `cron.job_run_details`
 *   records success — every night, forever, green, while no receipt is ever
 *   reconciled and no swallowed STOP is ever recovered.
 *
 *   WITH the exclusion and no bearer check: an unauthenticated endpoint anyone
 *   can use to make this system hammer ClickSend's API on demand.
 *
 * ── ITS OWN SECRET (MESSAGING_RECONCILE_SECRET) ─────────────────────────────
 *
 * Not the cadence tick's. Rotating one bearer must 401 one endpoint — and these
 * two differ in blast radius as well as in schedule: the cadence tick SENDS.
 *
 * ── SYNCHRONOUS, AND WHY 300s ───────────────────────────────────────────────
 *
 * `waitUntil` is ruled out for must-happen work (CLAUDE.md): a suppression the
 * sweep discovers is a compliance write, and a 200 for work that did not run is
 * how it goes missing. The sweep makes paged HTTP calls to a third party, so it
 * gets the Vercel Fluid ceiling rather than the webhook routes' 60s; `pg_net`'s
 * own 8s timeout covers DISPATCH only and does not wait for us. The tables are
 * the record, the HTTP body is a convenience.
 */
import { timingSafeEqual } from 'node:crypto';

import { PSEUDONYMISE_FAILED, runPseudonymisationPass } from '@/core/leads/pseudonymise';
import { reconcileMessaging } from '@/core/messaging/reconcile';
import { getServerEnv } from '@/core/shared/env';
import { reconcileMissedCalls } from '@/core/telephony/reconcile';

/** Vercel Fluid ceiling per CLAUDE.md. A 48-hour window is seconds of work. */
export const maxDuration = 300;

/** `node:crypto` and the postgres driver both need the Node runtime. */
export const runtime = 'nodejs';

/**
 * What a telephony pass that somehow threw reports: nothing, and no 500. The
 * recordings check did not run, so it is reported as failed rather than as a
 * clean zero (WR-05).
 */
const TELEPHONY_NOTHING = {
  missedCallsRecovered: 0,
  recordingsFound: null,
  recordingsCheckFailed: true,
} as const;

/**
 * What a messaging pass that threw reports (15-REVIEW WR-09): nothing done,
 * `skipped` as the pass's own guard reports it, and the body's
 * `messagingFailed` flag set beside it.
 */
const MESSAGING_FAILED = {
  skipped: true,
  receiptsApplied: 0,
  inboundReplayed: 0,
  optOutsRecorded: 0,
} as const;

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
  if (
    !bearerMatches(request.headers.get('authorization'), getServerEnv().MESSAGING_RECONCILE_SECRET)
  ) {
    return unauthorized();
  }

  // THE MESSAGING PASS, BELTED LIKE THE TWO BEHIND IT (15-REVIEW WR-09): a
  // throw here must not 500 the tick, or the telephony sweep and the
  // retention pass do not run tonight. A fixed line, the caught value
  // discarded — a provider or postgres error can carry an address.
  let messagingFailed = false;
  const result = await reconcileMessaging().catch(() => {
    messagingFailed = true;
    console.error('[messaging-reconcile] messaging pass failed');
    return MESSAGING_FAILED;
  });

  // THE CALL-LOG SWEEP — outside any sms condition; its own guard is total. The
  // core catches everything; this `.catch` is the belt to its braces, so a
  // regression there degrades to zeros rather than to a 500 that
  // `cron.job_run_details` would record while the messaging work above had
  // already happened.
  const telephony = await reconcileMissedCalls().catch(() => TELEPHONY_NOTHING);

  // THE PSEUDONYMISATION PASS (Phase 15, COMP-02) — must-happen nightly work,
  // awaited, never `waitUntil`: a 200 for a retention pass that did not run is
  // how a promise on the public notice quietly stops being true. The pepper is
  // read here and nowhere else. The core catches everything; this `.catch` is
  // the belt, so a regression there degrades to the FAILED counts, not a 500.
  const privacy = await runPseudonymisationPass({
    now: new Date(),
    pepper: getServerEnv().CALLER_PSEUDONYM_PEPPER,
  }).catch(() => PSEUDONYMISE_FAILED);

  // COUNTS ONLY, enumerated field by field rather than spread — the T-3-24 rule
  // the cadence tick states. A future field added to `ReconcileResult` (or to
  // `MissedCallReconcileResult`, or to `PseudonymisationResult`) for an
  // operator's benefit (a failing tenant's id, a provider's error string, a
  // caller's number or its hash) would ride a spread of any of the three
  // results straight into `cron.job_run_details` and the Vercel log, which are
  // lower-trust surfaces than the database. Listing the fields makes that a
  // compile error to reach rather than a leak to notice.
  return Response.json({
    skipped: result.skipped,
    receiptsApplied: result.receiptsApplied,
    inboundReplayed: result.inboundReplayed,
    optOutsRecorded: result.optOutsRecorded,
    messagingFailed,
    missedCallsRecovered: telephony.missedCallsRecovered,
    recordingsFound: telephony.recordingsFound,
    recordingsCheckFailed: telephony.recordingsCheckFailed,
    pseudonymisedLeadsClosed: privacy.leadsClosed,
    pseudonymisedLeadsConverted: privacy.leadsConverted,
    pseudonymisedMissedCallsWithLead: privacy.missedCallsWithLead,
    pseudonymisedMissedCallsNoLead: privacy.missedCallsNoLead,
    pseudonymisedInboundRows: privacy.inboundRows,
    pseudonymisedInboundRowsNoLead: privacy.inboundRowsNoLead,
    pseudonymisedCadenceRows: privacy.cadenceRows,
    pseudonymisedLedgerRows: privacy.ledgerRows,
    pseudonymiseFailed: privacy.failed,
    pseudonymisePassFailed: privacy.passFailed,
  });
}
