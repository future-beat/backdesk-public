/**
 * The one-minute heartbeat (CAD-01, CAD-02, D-13). pg_cron POSTs here; this
 * route runs one cadence tick — consume, make progress, dispatch — and reports
 * how much happened.
 *
 * ── WHY THIS IS A SECOND CRON JOB AND NOT A PASS INSIDE THE SYNC TICK ───────
 *
 * The sync tick fetches ServiceM8 over the network for every connected client.
 * A slow or unresponsive ServiceM8 stretches that tick, and if sending lived
 * inside it, that latency would land on a customer as a follow-up arriving at
 * 10:47 instead of 10:31 — CAD-02's "never late" broken by an upstream that has
 * nothing to do with the message. Two jobs means dispatch latency is decoupled
 * from ServiceM8 entirely, and it means the two bearer secrets rotate
 * independently: rotating one 401s one tick, never both.
 *
 * Per minute rather than every five: the touch slots this engine materializes
 * carry jitter down to the minute, and a five-minute tick would round every one
 * of them up to the next multiple of five — collapsing the jitter that exists so
 * fifteen clients' follow-ups do not all leave at exactly 09:00. A tick with no
 * work due is one indexed query.
 *
 * ── THIS ROUTE OWNS ITS OWN AUTH, AND IT IS THE ONLY AUTH (WR-01, T-3-23) ────
 *
 * `proxy.ts`'s matcher excludes `api/`, so nothing runs before this handler —
 * no session refresh, no redirect, no cookie. That exclusion is deliberate and
 * the two halves of it are load-bearing together:
 *
 *   WITHOUT the exclusion (RESEARCH Pitfall 7): the proxy sees an unauthenticated
 *   POST and answers 307 → /login. `net.http_post` got *a* response, so
 *   `cron.job_run_details` records success — every minute, forever, all green,
 *   while no cadence ever advances and no customer is ever contacted. The
 *   failure is silent in the one place an operator would look for it.
 *
 *   WITH the exclusion and no bearer check: this becomes an unauthenticated
 *   endpoint that anyone on the internet can use to make this system SEND SMS in
 *   a tradie's name, on demand, as fast as they can POST. Elevation of privilege
 *   with a customer-visible blast radius.
 *
 * So: the matcher must exclude it AND this file must reject anything without the
 * shared secret. Both are asserted in `tests/cadence-tick-route.test.ts`,
 * including the negative that matters most — the unauthenticated response is a
 * plain 401 with no `Location` header, i.e. provably not a redirect.
 *
 * ── SYNCHRONOUS, NOT FIRE-AND-FORGET ────────────────────────────────────────
 *
 * `runCadenceTick()` is awaited inside the request. `waitUntil` is explicitly
 * ruled out for must-happen work (CLAUDE.md §What NOT to Use): it is best-effort
 * and bounded by the function's duration anyway, so it buys nothing here except
 * the ability to return 200 for sends that never ran. `net.http_post`'s own 8s
 * timeout covers dispatch only — pg_cron does not wait for us, and does not need
 * to, because `cadences`, `cadence_touches` and `send_ledger` are where the
 * outcome is durably recorded. The HTTP body is a convenience; the tables are
 * the record.
 *
 * Region `syd1` (vercel.json) keeps execution next to the Sydney database.
 */
import { timingSafeEqual } from 'node:crypto';

import { resendStalledEmailSender } from '@/core/alerts/stalled-drafts';
import { runCadenceTick } from '@/core/cadence/run-tick';
import { buildEscalationSender } from '@/core/escalation/escalate-hot-leads';
import { buildRoutingSender } from '@/core/messaging/routing-sender';
import { getServerEnv } from '@/core/shared/env';

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
  if (!bearerMatches(request.headers.get('authorization'), getServerEnv().CADENCE_TICK_SECRET)) {
    return unauthorized();
  }

  // BUILT PER TICK, FROM THE DATABASE (D-04). `messaging_config` decides which
  // provider each channel routes to; with no enabled row — production's state
  // while the AU dedicated number is blocked on the IPND business-address
  // requirement (D-08) — both delegates are the Phase 3 stub and this tick
  // behaves exactly as it did before plan 04-03.
  //
  // Constructed HERE rather than defaulted inside `runCadenceTick` for the
  // reason `src/core` is framework-free at all: the tick function is reachable
  // from a script and a test, and neither should have to have a database
  // reachable to run the engine. The default there stays `StubSender`; the route
  // is the composition root that knows about configuration.
  //
  // Per tick rather than per module: an activation is a row flip and the NEXT
  // tick must pick it up. A module-scope sender would hold the configuration
  // that was current when the serverless instance booted, so turning sending on
  // — or off — would take effect at whatever moment Vercel next cold-started,
  // which is not a moment anybody can plan a rollout around.
  const sender = await buildRoutingSender();

  // THE OTHER SEAM THIS ROUTE IS THE COMPOSITION ROOT FOR (06-02, CON-04).
  //
  // `runCadenceTick` defaults its stall-alert sink to a no-op that reports
  // `not_configured`, for the same reason its `sender` defaults to the stub:
  // the tick is reachable from a script and from every remote suite, and a real
  // Resend default inside `src/core` would mean a test run mails the operator.
  // This is the one caller that is genuinely production, so this is where the
  // real sender is named.
  // THE THIRD SEAM THIS ROUTE IS THE COMPOSITION ROOT FOR (06-05, CON-03).
  //
  // `runCadenceTick` defaults its escalation sender to UNDEFINED, which means
  // the pass does not run and does not scan. That default is stricter than the
  // other two on purpose: claiming an `escalations` row consumes the
  // never-twice right for that reply permanently, so a script or a remote suite
  // must not be able to burn a real client's hot lead by forgetting a seam.
  //
  // `buildEscalationSender` is itself a refusal when credentials are absent —
  // the `reconcile.ts` read-and-refuse-if-missing shape — so an unconfigured
  // deployment makes zero provider calls rather than authenticating with empty
  // credentials every minute. The D-04 ARMING question is asked separately, per
  // tenant, inside the pass: credentials being present does not mean anybody has
  // switched sending on.
  const env = getServerEnv();
  const escalationSender = buildEscalationSender({
    username: env.CLICKSEND_USERNAME,
    apiKey: env.CLICKSEND_API_KEY,
  });

  // THE FOURTH SEAM THIS ROUTE IS THE COMPOSITION ROOT FOR (07-03, RPT-01).
  //
  // `runCadenceTick` defaults `attribution` to `'skip'`, which means the pass
  // does not register a cursor, does not scan and does not advance. That
  // default is the strictest of the four, and for the most expensive reason: a
  // brand-new consumer registers AT ZERO by contract and then walks the entire
  // outbox, so the first script or remote suite to reach an unregistered
  // attribution cursor would drain every real client's `won` history into
  // `quote_attributions` — a table with no update method and no delete method,
  // by design.
  //
  // This is the one caller that is genuinely production, so this is where
  // `'run'` is typed. It takes no credential and no configuration: the pass is
  // pure database work, and the only thing that gates it is somebody having
  // decided, here, that this is the real tick.
  // THE FIFTH SEAM (Phase 12, D-01/D-20, TXT-02): the text-back guarantee
  // sweep. `runCadenceTick` defaults it to UNDEFINED — no scan, no claim, no
  // stale mark — because a claimed missed call is never re-sent, so a script
  // or a remote suite must not be able to consume a real client's caller.
  // It is the SAME routing sender built above: per tick, so an arming flip is
  // seen by the next minute, and the gate inside `sendTextBack` refuses a stub
  // delegate (`sms_not_armed`) exactly as the status door's call does.
  const result = await runCadenceTick({
    sender,
    stallAlertSender: resendStalledEmailSender,
    escalationSender,
    attribution: 'run',
    textBackSender: sender,
    // THE SIXTH SEAM (Phase 12, D-10, TXT-06): the failed-text-back alert pass
    // and the ClickSend balance probe. Undefined inside the tick means neither
    // runs — both spend a once-only claim. Email through the same
    // closed-vocabulary sender as the stall alert (never SMS), and the two
    // ClickSend values this route already read for the escalation sender.
    textBackOps: {
      alertSender: resendStalledEmailSender,
      clicksend: { username: env.CLICKSEND_USERNAME, apiKey: env.CLICKSEND_API_KEY },
    },
  });

  // COUNTS ONLY (T-3-24), and enumerated field by field rather than spread.
  //
  // `CadenceTickResult` is counts-only today, and `runCadenceTick`'s own header
  // says so — but a future field added there for an operator's benefit (a failing
  // tenant's id, a refusal's message) would ride a `...result` straight into
  // `cron.job_run_details` and the Vercel log, which are lower-trust surfaces
  // than the database. Listing the fields makes that a compile error to reach
  // rather than a leak to notice. No customer names, no phone numbers, no quote
  // details, no error strings — ever.
  return Response.json({
    eventsConsumed: result.eventsConsumed,
    cadencesCreated: result.cadencesCreated,
    cadencesStopped: result.cadencesStopped,
    quotesFlaggedForReview: result.quotesFlaggedForReview,
    eventsSkipped: result.eventsSkipped,
    // A POSITION, not a count — and still just a number. It is the one value
    // that distinguishes a draining outbox from a wedged one across ticks.
    cursorAt: result.cursorAt,
    tenantsBlocked: result.tenantsBlocked,
    // RPT-01 / 07-03 — the SECOND outbox consumer, on its own cursor row.
    // Enumerated field by field like everything above, and the T-3-24 warning
    // is at its sharpest here: this pass reads a client's job descriptions,
    // their customer's reply labels and a DOLLAR FIGURE, and writes rows an
    // invoice is generated from. A field carrying a quote id, a tenant id, an
    // amount, or the error text out of a failed run would put billing data into
    // `cron.job_run_details` and the Vercel log permanently. Seven numbers.
    attributionEventsConsumed: result.attributionEventsConsumed,
    attributionsRecorded: result.attributionsRecorded,
    attributionsUnqualified: result.attributionsUnqualified,
    attributionsValueMissing: result.attributionsValueMissing,
    attributionsPoisoned: result.attributionsPoisoned,
    // A POSITION, not a count — and still just a number. The OTHER consumer's
    // position, read alongside `cursorAt` above: the two diverging is the
    // normal, healthy state, because one can be head-of-line blocked while the
    // other keeps working.
    attributionCursorAt: result.attributionCursorAt,
    attributionTenantsBlocked: result.attributionTenantsBlocked,
    cadencesExpired: result.cadencesExpired,
    touchesRewindowed: result.touchesRewindowed,
    touchesSkipped: result.touchesSkipped,
    touchesPromoted: result.touchesPromoted,
    // AI-01. COUNTS ONLY, and the reason bears restating for these two
    // specifically: the drafting pass handles a customer's name, their job and
    // their price, and this body reaches Vercel's logs and pg_cron's response
    // record. A field carrying a draft body, a validator's offending token, or
    // an API error string would put customer content there permanently and
    // undeletably (T-5-03).
    touchesDrafted: result.touchesDrafted,
    // The 05-04 breakdown, one field per thing an operator would DO about it —
    // listed one by one for the same reason as everything above. A field added
    // to `CadenceTickResult` later does not reach this body until somebody
    // types it here and decides it is a number.
    draftsNotOnboarded: result.draftsNotOnboarded,
    draftsValidatorFailed: result.draftsValidatorFailed,
    draftsRateLimited: result.draftsRateLimited,
    draftsDeferred: result.draftsDeferred,
    draftsDeterministicFailed: result.draftsDeterministicFailed,
    draftsAttemptsExhausted: result.draftsAttemptsExhausted,
    draftingUnconfigured: result.draftingUnconfigured,
    dispatched: result.dispatched,
    refused: result.refused,
    // THE ONE NESTED VALUE, and it is enumerated by its TYPE rather than by
    // hand: `Record<DispatchRefusal, number>` over a closed vocabulary admits
    // counts under six fixed labels and nothing else, so there is no key a
    // future contributor could add here that is not a number. The route test
    // walks the body recursively and asserts every leaf is a number, which is
    // the same guarantee the flat enumeration gives the fields above.
    refusals: result.refusals,
    cadencesCompleted: result.cadencesCompleted,
    // Phase 13 (D-01/D-14): open leads closed by the reconciling sweep. A
    // count, enumerated like every field here — no lead id, no number.
    leadsClosed: result.leadsClosed,
    // Phase 13 (D-11): open leads closed by the label-effects pass on a
    // high-confidence closing label. A count — no lead id, no label, no body.
    leadsClosedByLabel: result.leadsClosedByLabel,
    // AI-02 / 05-06. The same enumeration discipline, and the same warning with
    // one more edge: the classification pass reads REPLY BODIES — text a member
    // of the public typed and sent to a number we published. A field carrying a
    // reply, a label's reasoning, or an API error string would put a stranger's
    // words into `cron.job_run_details` and the Vercel log permanently. Four
    // numbers, and they are numbers about the queue rather than about anyone.
    inboundClassified: result.inboundClassified,
    inboundNeedsHuman: result.inboundNeedsHuman,
    inboundClassifyDeferred: result.inboundClassifyDeferred,
    classificationUnconfigured: result.classificationUnconfigured,
    // CON-03 / 06-05 — the hot-lead escalation, enumerated field by field like
    // everything above it, and the warning is sharper here than anywhere else in
    // this body: this pass handles a customer's REPLY TEXT and their MOBILE
    // NUMBER, and it assembles both into an SMS. A field carrying the body, the
    // recipient, a client name, or ClickSend's error string would put a
    // stranger's words and a phone number into `cron.job_run_details` and the
    // Vercel log permanently and undeletably. Seven numbers about the queue,
    // never about anyone in it.
    hotEscalated: result.hotEscalated,
    escalationCooldownSuppressed: result.escalationCooldownSuppressed,
    escalationNoNumber: result.escalationNoNumber,
    escalationNotConfigured: result.escalationNotConfigured,
    escalationSendFailed: result.escalationSendFailed,
    escalationDeferred: result.escalationDeferred,
    escalationUnconfigured: result.escalationUnconfigured,
    // 12-05 (D-16) — a quote customer rang and was missed; the tradie's phone
    // was texted, suppressed, refused or failed. Counts, never which call.
    quoteCallEscalated: result.quoteCallEscalated,
    quoteCallEscalationSuppressed: result.quoteCallEscalationSuppressed,
    quoteCallEscalationRefused: result.quoteCallEscalationRefused,
    quoteCallEscalationFailed: result.quoteCallEscalationFailed,
    // Phase 13 / 13-06 (D-07, D-09) — the after-hours hold, ring-twice and the
    // release of held alerts. Nine counts, never which reply, call, lead or
    // number: these passes read a customer's words and a caller's mobile.
    escalationHeld: result.escalationHeld,
    ringTwiceEscalated: result.ringTwiceEscalated,
    ringTwiceHeld: result.ringTwiceHeld,
    ringTwiceSuppressed: result.ringTwiceSuppressed,
    ringTwiceRefused: result.ringTwiceRefused,
    ringTwiceFailed: result.ringTwiceFailed,
    escalationReleased: result.escalationReleased,
    escalationReleaseRefused: result.escalationReleaseRefused,
    escalationReleaseFailed: result.escalationReleaseFailed,
    // CON-04 / 06-02, and enumerated here one by one like everything above it.
    // These three describe the ALARM on the approval deadline: how many touches
    // crossed the stall threshold this minute, whether the covering email left,
    // and whether it failed. Numbers about the queue, never about anyone in it —
    // no client name, no touch id, no Resend error string. `stallAlertFailed`
    // in particular must stay a 1 or a 0: the temptation to carry the provider's
    // reason here is exactly how a mail error string reaches
    // `cron.job_run_details` permanently.
    // Phase 12 / TXT-02 — the text-back guarantee sweep. Six numbers about
    // the pending-call queue, never about a call: this pass reads a caller's
    // number (inside `sendTextBack`, from the row), and no id, number or
    // provider string may reach `cron.job_run_details` through this body.
    textBackSwept: result.textBackSwept,
    textBackSent: result.textBackSent,
    textBackSkipped: result.textBackSkipped,
    textBackFailed: result.textBackFailed,
    textBackStale: result.textBackStale,
    textBackUnconfigured: result.textBackUnconfigured,
    // D-10 — the failed / stuck text-back alert: how many were reported, and
    // whether an owed email was lost. Never which call, never the provider's
    // words.
    textBackAlerted: result.textBackAlerted,
    textBackAlertFailed: result.textBackAlertFailed,
    textBackPauseFailed: result.textBackPauseFailed,
    // D-10 / D-21 — the ClickSend balance probe. Flags and a count of clients
    // switched off; never the balance figure, the provider's reason, an account
    // name or a credential.
    balanceProbed: result.balanceProbed,
    balanceProbeFailed: result.balanceProbeFailed,
    balanceLowAlerted: result.balanceLowAlerted,
    textBackAutoDisarmed: result.textBackAutoDisarmed,
    touchesNewlyStalled: result.touchesNewlyStalled,
    stallAlertSent: result.stallAlertSent,
    stallAlertFailed: result.stallAlertFailed,
  });
}
