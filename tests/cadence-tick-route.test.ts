/**
 * The two halves of RESEARCH Pitfall 7, asserted together — for the tick that
 * SENDS (T-3-23, T-3-24).
 *
 * The stakes here are one step past the sync tick's. An unauthenticated
 * sync-tick is an endpoint that reads ServiceM8 on demand; an unauthenticated
 * CADENCE tick is an endpoint that makes this system text a tradie's customers
 * in the tradie's name, as fast as a stranger can POST. So the same two halves
 * are asserted: the proxy must not stand in front of this route (a 307 to /login
 * reads as success to `net.http_post` — cron green, nothing ever sent), and the
 * route must reject anything without the bearer.
 *
 * The handler is invoked directly with `Request` objects — no dev server, no
 * port, nothing to leave running. `runCadenceTick` is stubbed because what is
 * under test is the gate in front of it and the shape of what comes back; the
 * tick itself has its own integration suites.
 */
import { readdirSync, readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Type-only, so it is erased before `vi.mock` replaces the module at runtime.
// It is here to make ONE_RESULT below a COMPLETE `CadenceTickResult`: the route
// enumerates its response fields rather than spreading, and this is what stops
// that from silently dropping a field somebody adds to the tick later.
import type { CadenceTickResult } from '@/core/cadence/run-tick';

// A VALUE import, unlike the line above: the vocabulary itself is asserted
// against the response body, so a member added to it without reaching the route
// fails here rather than going unnoticed.
import { DISPATCH_REFUSALS } from '@/core/cadence/dispatch';
import { resendStalledEmailSender } from '@/core/alerts/stalled-drafts';

/**
 * A known secret, so the test can send both a correct value and a WRONG VALUE
 * OF THE SAME LENGTH — the only case that exercises `timingSafeEqual` rather
 * than short-circuiting on the length check.
 *
 * Injected, so this suite never needs the production value: it asserts the
 * comparison, not the secret.
 */
const SECRET = 'cadence-secret-of-exactly-forty-chars!!!!';
const WRONG_SAME_LENGTH = 'WRONG-secret-of-exactly-forty-chars-here!';

vi.mock('@/core/shared/env', () => ({
  getServerEnv: () => ({ CADENCE_TICK_SECRET: SECRET }),
}));

const runCadenceTick = vi.fn();
vi.mock('@/core/cadence/run-tick', () => ({
  runCadenceTick: (...args: unknown[]) => runCadenceTick(...args),
}));

/**
 * The route became a COMPOSITION ROOT in plan 04-03: it builds the tick's sender
 * from `messaging_config` before running it (D-04 — activation is a row flip,
 * not a deploy). Stubbed here for the same reason `runCadenceTick` is — this
 * suite asserts the gate in front of the tick and the shape of what comes back,
 * and neither should require a database to be reachable.
 *
 * Returning a recognisable object rather than `undefined` lets the success-path
 * test below assert that the route actually THREADS it through, which is the
 * whole point of constructing it here: a route that built a sender and then
 * called `runCadenceTick()` bare would silently fall back to the Phase 3 stub
 * default forever, and every other assertion in this file would still pass.
 */
const buildRoutingSender = vi.fn();
const ROUTING_SENDER = { provider: 'routing', providerFor: () => 'stub', send: async () => null };
vi.mock('@/core/messaging/routing-sender', () => ({
  buildRoutingSender: () => buildRoutingSender(),
}));

const { POST, maxDuration, runtime } = await import('@/app/api/internal/cadence-tick/route');

const ROUTE_SOURCE = readFileSync('src/app/api/internal/cadence-tick/route.ts', 'utf8');
const SYNC_ROUTE_SOURCE = readFileSync('src/app/api/internal/sync-tick/route.ts', 'utf8');
const PROXY_SOURCE = readFileSync('src/proxy.ts', 'utf8');
/** The tick itself, read as text for the D-16 ordering/isolation gate below. */
const TICK_SOURCE = readFileSync('src/core/cadence/run-tick.ts', 'utf8');

function tick(authorization?: string): Request {
  return new Request('https://example.test/api/internal/cadence-tick', {
    method: 'POST',
    headers: authorization ? { authorization } : {},
  });
}

/**
 * The full counts-only result shape, exactly as `runCadenceTick` returns it.
 *
 * TYPED, so adding a field to `CadenceTickResult` without adding it here is a
 * compile error — and adding it here without adding it to the route is a test
 * failure on the `toEqual` below. Between them, the route cannot quietly stop
 * reporting something the tick counts.
 */
const ONE_RESULT: CadenceTickResult = {
  eventsConsumed: 4,
  cadencesCreated: 2,
  cadencesStopped: 1,
  quotesFlaggedForReview: 1,
  eventsSkipped: 2,
  cursorAt: 4210,
  tenantsBlocked: 0,
  // RPT-01 / 07-03. DISTINCT VALUES, and `attributionCursorAt` deliberately
  // DIFFERENT from `cursorAt` above: the two consumers advance independently,
  // and a route that crossed the wires — reporting the cadence engine's
  // position under the attribution label — would pass against two equal
  // numbers and mislead an operator diagnosing a wedge.
  attributionEventsConsumed: 4,
  attributionsRecorded: 1,
  attributionsUnqualified: 2,
  attributionsValueMissing: 1,
  attributionsPoisoned: 0,
  attributionCursorAt: 4207,
  attributionTenantsBlocked: 0,
  cadencesExpired: 0,
  touchesRewindowed: 3,
  touchesSkipped: 1,
  touchesPromoted: 5,
  touchesDrafted: 3,
  draftsNotOnboarded: 4,
  draftsValidatorFailed: 1,
  draftsRateLimited: 1,
  draftsDeferred: 2,
  draftsDeterministicFailed: 1,
  draftsAttemptsExhausted: 1,
  draftingUnconfigured: 0,
  dispatched: 2,
  refused: 1,
  refusals: {
    paused: 1,
    quote_closed: 0,
    mirror_missing: 0,
    suppressed: 0,
    outside_window: 0,
    claim_lost: 0,
    no_address: 0,
    no_approved_draft: 0,
    // Phase 13 (2026-10, 13-02): the lead dispatch branch's refusal.
    lead_closed: 0,
  },
  cadencesCompleted: 1,
  // Phase 13 (2026-10, 13-02): leads closed by the reconciling sweep — a
  // distinct value so a route that dropped or crossed it fails the toEqual.
  leadsClosed: 31,
  // Phase 13 (2026-10, 13-04): leads closed by the label-effects pass on a
  // high-confidence closing label — distinct from the sweep's 31.
  leadsClosedByLabel: 37,
  inboundClassified: 3,
  inboundNeedsHuman: 1,
  inboundClassifyDeferred: 2,
  classificationUnconfigured: 0,
  // CON-03 / 06-05 — seven distinct values for the same reason as the three
  // below: a route that dropped one, or crossed two, must fail the `toEqual`
  // rather than pass on a coincidence of zeroes.
  hotEscalated: 7,
  escalationCooldownSuppressed: 8,
  escalationNoNumber: 9,
  escalationNotConfigured: 10,
  escalationSendFailed: 11,
  escalationDeferred: 12,
  escalationUnconfigured: 0,
  quoteCallEscalated: 21,
  quoteCallEscalationSuppressed: 22,
  quoteCallEscalationRefused: 23,
  quoteCallEscalationFailed: 24,
  // Phase 13 (2026-10, 13-06): the hold, ring-twice and release counts —
  // distinct values, so a route that dropped or crossed one fails the toEqual.
  escalationHeld: 41,
  ringTwiceEscalated: 42,
  ringTwiceHeld: 43,
  ringTwiceSuppressed: 44,
  ringTwiceRefused: 45,
  ringTwiceFailed: 46,
  escalationReleased: 47,
  escalationReleaseRefused: 48,
  escalationReleaseFailed: 49,
  // CON-04 / 06-02 — distinct non-zero values, so a route that dropped one or
  // crossed two of them fails the `toEqual` below rather than passing on a
  // coincidence of zeroes.
  // Phase 12 / TXT-02 — the text-back sweep. Distinct values, for the reason
  // above: a route that crossed two of them fails the `toEqual`.
  textBackSwept: 13,
  textBackSent: 14,
  textBackSkipped: 15,
  textBackFailed: 16,
  textBackStale: 17,
  textBackUnconfigured: 0,
  textBackAlerted: 18,
  textBackAlertFailed: 1,
  textBackPauseFailed: 20,
  balanceProbed: 1,
  balanceProbeFailed: 0,
  balanceLowAlerted: 1,
  textBackAutoDisarmed: 19,
  touchesNewlyStalled: 6,
  stallAlertSent: 1,
  stallAlertFailed: 0,
};

beforeEach(() => {
  runCadenceTick.mockReset();
  runCadenceTick.mockResolvedValue(ONE_RESULT);
  buildRoutingSender.mockReset();
  buildRoutingSender.mockResolvedValue(ROUTING_SENDER);
});

describe('cadence-tick authentication (T-3-23)', () => {
  it('returns 401 with no Authorization header — and never runs a tick', async () => {
    const response = await POST(tick());

    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(await response.text()).toBe('unauthorized');
    expect(runCadenceTick).not.toHaveBeenCalled();
  });

  it('returns 401 for a wrong secret of IDENTICAL length', async () => {
    // Same length on purpose: a length mismatch is rejected before
    // timingSafeEqual is reached, so an equal-length wrong value is the only
    // input that proves the comparison itself rejects.
    expect(WRONG_SAME_LENGTH.length).toBe(SECRET.length);

    const response = await POST(tick(`Bearer ${WRONG_SAME_LENGTH}`));

    expect(response.status).toBe(401);
    expect(runCadenceTick).not.toHaveBeenCalled();
  });

  it('returns 401 rather than throwing when the header is far too short', async () => {
    // `timingSafeEqual` throws on unequal lengths. Without the pre-check this
    // is a 500 — which a monitor reads very differently from a 401.
    const response = await POST(tick('Bearer x'));

    expect(response.status).toBe(401);
    expect(runCadenceTick).not.toHaveBeenCalled();
  });

  it('rejects a bare secret with no Bearer prefix', async () => {
    const response = await POST(tick(SECRET));

    expect(response.status).toBe(401);
    expect(runCadenceTick).not.toHaveBeenCalled();
  });

  it('rejects the SYNC tick secret — the two secrets are not interchangeable', async () => {
    // The whole point of a second variable is independent rotation. If this
    // route ever accepted either value, rotating one would silently keep both
    // ticks alive and the separation would be decorative.
    const syncSecret = 'test-secret-of-exactly-forty-chars-here!!';
    expect(syncSecret).not.toBe(SECRET);

    const response = await POST(tick(`Bearer ${syncSecret}`));

    expect(response.status).toBe(401);
    expect(runCadenceTick).not.toHaveBeenCalled();
  });

  it('THE PITFALL-7 ASSERTION: the 401 is a plain response, not a redirect', async () => {
    const response = await POST(tick());

    // A 3xx with a Location to /login is what the proxy would have produced,
    // and `net.http_post` records it as a success. If this ever fails, the tick
    // is green in cron and dead in reality — every minute, forever, while no
    // customer is ever contacted.
    expect(response.status).toBe(401);
    expect(response.status < 300 || response.status >= 400).toBe(true);
    expect(response.headers.get('location')).toBeNull();
    expect(response.redirected).toBe(false);
  });
});

describe('cadence-tick success path', () => {
  it('runs the tick and returns the counts', async () => {
    const response = await POST(tick(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    expect(runCadenceTick).toHaveBeenCalledTimes(1);

    expect(await response.json()).toEqual(ONE_RESULT);
  });

  it('builds the routing sender per tick and threads it into runCadenceTick (D-04)', async () => {
    await POST(tick(`Bearer ${SECRET}`));

    // PER TICK, not per module. An activation is a `messaging_config` row flip
    // and the NEXT tick must observe it; a module-scope sender would hold the
    // configuration current when the serverless instance booted, so turning
    // sending on — or off — would take effect at whatever moment Vercel next
    // cold-started.
    expect(buildRoutingSender).toHaveBeenCalledTimes(1);

    // AND IT IS ACTUALLY USED. `runCadenceTick` defaults `sender` to
    // `StubSender`, so a route that built a composite and then called the tick
    // bare would send nothing real forever while every other assertion in this
    // file stayed green — the exact shape of the bug this line exists for.
    // AND THE SECOND SEAM, for the same reason (06-02). `runCadenceTick`
    // defaults its stall-alert sink to a no-op that reports `not_configured`,
    // because the tick is reachable from a script and from every remote suite
    // and a real Resend default in `src/core` would mail the operator during a
    // test run. This route is the composition root; a route that called the
    // tick without naming the real sender would claim stalled touches forever
    // and never tell anybody, with `stallAlertFailed` ticking up unread.
    // AND THE FOURTH SEAM (07-03, RPT-01), which is the strictest of the four.
    // `runCadenceTick` defaults `attribution` to `'skip'`, meaning the pass does
    // not register a cursor, does not scan and does not advance — because a
    // brand-new consumer registers AT ZERO by contract and would then walk every
    // real client's `won` history into `quote_attributions`, a table with no
    // update method and no delete method. THIS ROUTE IS THE ONLY PLACE `'run'`
    // IS TYPED, so a route that called the tick without it would leave the
    // service silently unable to bill for anything it recovered, with every
    // count in this body reading zero and nothing else looking wrong.
    // AND THE FIFTH SEAM (Phase 12, TXT-02): the text-back sweep's sender,
    // undefined by default inside the tick (no scan, no claim). It is the SAME
    // routing sender, so a route that forgot it would leave every missed
    // callback unanswered with `textBackUnconfigured` the only witness.
    expect(runCadenceTick).toHaveBeenCalledWith({
      sender: ROUTING_SENDER,
      stallAlertSender: resendStalledEmailSender,
      attribution: 'run',
      textBackSender: ROUTING_SENDER,
      // AND THE SIXTH (Phase 12, D-10): the alert pass and the balance probe,
      // undefined by default inside the tick. Email through the real Resend
      // sender; the ClickSend values are whatever the environment holds (this
      // suite's env mock holds none, so both are undefined here).
      textBackOps: {
        alertSender: resendStalledEmailSender,
        clicksend: { username: undefined, apiKey: undefined },
      },
    });
  });

  it('refuses to run the tick at all if the sender cannot be built', async () => {
    // A failure reading `messaging_config` must NOT degrade into "run the tick
    // with whatever the default is". The default is the stub, so degrading
    // would look like a perfectly healthy tick that quietly stopped sending —
    // and `cron.job_run_details` would be green throughout. Better a 500 the
    // operator can see.
    buildRoutingSender.mockRejectedValue(new Error('config read failed'));

    await expect(POST(tick(`Bearer ${SECRET}`))).rejects.toThrow();
    expect(runCadenceTick).not.toHaveBeenCalled();
  });

  it('awaits the tick inside the request — the response follows the work', async () => {
    // Fire-and-forget (`waitUntil`) is explicitly ruled out for must-happen
    // work: a send is not best-effort. If the handler stopped awaiting, this
    // resolves before the tick does and `settled` is still false.
    let settled = false;
    runCadenceTick.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            settled = true;
            resolve(ONE_RESULT);
          }, 20),
        ),
    );

    await POST(tick(`Bearer ${SECRET}`));

    expect(settled).toBe(true);
  });

  it('THE T-3-24 ASSERTION: the body is numbers under fixed labels, nothing else', async () => {
    // Every LEAF of the response must be a number. `cron.job_run_details` and
    // the Vercel log are lower-trust surfaces than the database, so a customer
    // name, a phone number or a caught error string reaching this body is a
    // disclosure — not a debugging convenience.
    //
    // Walked recursively rather than one level deep: `refusals` is a nested
    // Record over a closed vocabulary (WR-02), and a flat check would have
    // stopped at the object and passed on whatever was inside it.
    const body = await (await POST(tick(`Bearer ${SECRET}`))).json();

    const assertNumericLeaves = (value: unknown, path: string): void => {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        for (const [key, child] of Object.entries(value)) {
          assertNumericLeaves(child, `${path}.${key}`);
        }
        return;
      }
      expect(typeof value, `${path} must be a number, got ${typeof value}`).toBe('number');
    };

    assertNumericLeaves(body, 'body');
  });

  it('reports EXACTLY the agreed key set — additions are deliberate, never a spread', async () => {
    // ┌──────────────────────────────────────────────────────────────────────┐
    // │ THE T-3-24 ENUMERATION, AS AN EQUALITY.                              │
    // └──────────────────────────────────────────────────────────────────────┘
    //
    // The recursive numeric-leaf check above proves nothing here can be a
    // string. This proves the field SET itself: a key that appears without
    // anybody deciding it should fails, and so does a key that quietly stops
    // being reported. Written out rather than derived from `ONE_RESULT`,
    // because deriving it from the tick's own type is what a spread does.
    const body = (await (await POST(tick(`Bearer ${SECRET}`))).json()) as Record<
      string,
      unknown
    >;

    expect(Object.keys(body).sort()).toEqual(
      [
        'eventsConsumed',
        'cadencesCreated',
        'cadencesStopped',
        'quotesFlaggedForReview',
        'eventsSkipped',
        'cursorAt',
        'tenantsBlocked',
        // RPT-01 / 07-03: the SECOND outbox consumer's counts, on its own
        // cursor row. `attributionCursorAt` is a position like `cursorAt`, for
        // a cursor that advances independently — the route is the one caller
        // that passes `attribution: 'run'`, so this is the only place in the
        // codebase where these seven are ever non-zero. `attributionsPoisoned`
        // is a count of events that could never be decided and were stepped
        // over so the shared cursor could keep moving — a count of bugs, and
        // still only a count, so T-3-24 holds.
        'attributionEventsConsumed',
        'attributionsRecorded',
        'attributionsUnqualified',
        'attributionsValueMissing',
        'attributionsPoisoned',
        'attributionCursorAt',
        'attributionTenantsBlocked',
        'cadencesExpired',
        'touchesRewindowed',
        'touchesSkipped',
        'touchesPromoted',
        // AI-01 / 05-04: the drafting breakdown, one field per thing an
        // operator would do about it.
        'touchesDrafted',
        'draftsNotOnboarded',
        'draftsValidatorFailed',
        'draftsRateLimited',
        'draftsDeferred',
        'draftsDeterministicFailed',
        'draftsAttemptsExhausted',
        'draftingUnconfigured',
        'dispatched',
        'refused',
        'refusals',
        'cadencesCompleted',
        // Phase 13 (2026-10, 13-02, D-01/D-14): open leads closed by the
        // reconciling sweep after their lead cadence ended. A count only.
        'leadsClosed',
        // Phase 13 (2026-10, 13-04, D-11): open leads closed by the
        // label-effects pass on a high-confidence closing label. A count only.
        'leadsClosedByLabel',
        // AI-02 / 05-06: the classification counts. Global rather than
        // per-tenant, because an inbound reply arrives with a phone number and
        // no client.
        'inboundClassified',
        'inboundNeedsHuman',
        'inboundClassifyDeferred',
        'classificationUnconfigured',
        // CON-03 / 06-05: the hot-lead escalation counts. Also global — the
        // scan is over `inbound_messages`, which has no tenant scope to run
        // inside. `escalationUnconfigured` is the flag-shaped one: no sender
        // was wired, so the pass did not scan and claimed nothing.
        'hotEscalated',
        'escalationCooldownSuppressed',
        'escalationNoNumber',
        'escalationNotConfigured',
        'escalationSendFailed',
        'escalationDeferred',
        'escalationUnconfigured',
        // 12-05 (D-16): the quote-call escalation counts, on the same seam.
        'quoteCallEscalated',
        'quoteCallEscalationSuppressed',
        'quoteCallEscalationRefused',
        'quoteCallEscalationFailed',
        // Phase 13 (2026-10, 13-06, D-07/D-09): the after-hours hold, the
        // ring-twice escalation and the release of held alerts. Counts only.
        'escalationHeld',
        'ringTwiceEscalated',
        'ringTwiceHeld',
        'ringTwiceSuppressed',
        'ringTwiceRefused',
        'ringTwiceFailed',
        'escalationReleased',
        'escalationReleaseRefused',
        'escalationReleaseFailed',
        // CON-04 / 06-02: the aging counts. `stallAlertFailed` is the only
        // record that an operator was owed an email they did not get, since the
        // claim is never undone and the touch is never re-claimed.
        // Phase 12 / TXT-02: the text-back guarantee sweep. Global, like
        // classification: a pending call is found by age, not by tenant.
        // `textBackUnconfigured` is the flag: no sender, so no scan.
        'textBackSwept',
        'textBackSent',
        'textBackSkipped',
        'textBackFailed',
        'textBackStale',
        'textBackUnconfigured',
        // D-10: the failed / stuck text-back alert. `textBackAlertFailed` is
        // the record of an owed email that did not leave.
        'textBackAlerted',
        'textBackAlertFailed',
        // 12-05 (D-08): an about-quote text sent whose quote cadence did not pause.
        'textBackPauseFailed',
        // D-10 / D-21: the ClickSend balance probe. Three flags and a count of
        // clients the system switched off — never the balance figure itself.
        'balanceProbed',
        'balanceProbeFailed',
        'balanceLowAlerted',
        'textBackAutoDisarmed',
        'touchesNewlyStalled',
        'stallAlertSent',
        'stallAlertFailed',
      ].sort(),
    );
  });

  it('reports one refusal count per member of the closed dispatch vocabulary', async () => {
    // The scalar `refused` cannot tell twelve paused tenants from twelve
    // suppressed customers, and those want different responses. A member added
    // to DISPATCH_REFUSALS without reaching this body fails here.
    const body = (await (await POST(tick(`Bearer ${SECRET}`))).json()) as {
      refusals: Record<string, number>;
      refused: number;
    };

    expect(Object.keys(body.refusals).sort()).toEqual([...DISPATCH_REFUSALS].sort());
    expect(Object.values(body.refusals).reduce((a, b) => a + b, 0)).toBe(body.refused);
  });

  it('does not spread unknown fields from the tick result into the response', async () => {
    // The guarantee above has to survive someone adding a field to
    // `CadenceTickResult` for an operator's benefit. The handler enumerates its
    // fields; a spread would carry this straight into a cron log.
    runCadenceTick.mockResolvedValue({
      ...ONE_RESULT,
      failingTenantName: 'Acme Plumbing',
      lastError: 'connect ETIMEDOUT 10.0.0.1:5432',
    });

    const response = await POST(tick(`Bearer ${SECRET}`));
    const body = await response.json();

    expect(JSON.stringify(body)).not.toContain('Acme Plumbing');
    expect(JSON.stringify(body)).not.toContain('ETIMEDOUT');
    expect(body).toEqual(ONE_RESULT);
  });
});

describe('route configuration', () => {
  it('sets maxDuration to the 300s Fluid ceiling', () => {
    expect(maxDuration).toBe(300);
    expect(ROUTE_SOURCE).toContain('maxDuration = 300');
  });

  it('pins the Node runtime — node:crypto is not available on edge', () => {
    expect(runtime).toBe('nodejs');
    expect(ROUTE_SOURCE).toContain("runtime = 'nodejs'");
  });

  it('compares the secret with timingSafeEqual, not ===', () => {
    expect(ROUTE_SOURCE).toContain('timingSafeEqual');
    // A plain equality check on the secret would pass every behavioural test
    // above while leaking the secret one byte at a time.
    expect(ROUTE_SOURCE).not.toMatch(/provided\s*===\s*expected/);
  });

  it('reads its own secret and never the sync tick’s', () => {
    expect(ROUTE_SOURCE).toContain('getServerEnv().CADENCE_TICK_SECRET');
    expect(ROUTE_SOURCE).not.toContain('SYNC_TICK_SECRET');
  });

  it('does not use waitUntil — a send is must-happen work', () => {
    expect(ROUTE_SOURCE).not.toMatch(/\bwaitUntil\b\s*\(/);
    // WIDENED IN 04-03, from `await runCadenceTick()` to "awaited, with or
    // without arguments". The guarantee this line defends is that the tick is
    // AWAITED inside the request — fire-and-forget is explicitly ruled out for
    // must-happen work — and the route now legitimately passes the routing
    // sender it built. Pinning the empty parens was pinning the argument list,
    // which is not what the test is named after and not what the behavioural
    // assertion above it proves.
    expect(ROUTE_SOURCE).toMatch(/await runCadenceTick\(/);
  });

  it('keeps the proven sync-tick auth shape verbatim', () => {
    // This route is a deliberate clone. If the two auth helpers ever diverge,
    // one of them is wrong and nobody would find out from a behavioural test on
    // the other.
    const authHelper = (source: string) =>
      source.slice(source.indexOf('function bearerMatches'), source.indexOf('export async function'));

    expect(authHelper(ROUTE_SOURCE)).toBe(authHelper(SYNC_ROUTE_SOURCE));
  });
});

describe('D-16: the inbound compliance path stays LLM-free, structurally', () => {
  /** Every source file under the webhook region, read from disk. */
  const webhookSources = (() => {
    const found: { path: string; source: string }[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          found.push({ path: full, source: readFileSync(full, 'utf8') });
        }
      }
    };
    walk('src/app/api/webhooks');
    return found;
  })();

  it('finds webhook sources at all — a silent empty scan proves nothing', () => {
    // A structural gate that walks the wrong directory passes vacuously and
    // forever. This is the assertion that says the gate below has something to
    // be a gate over.
    expect(webhookSources.length).toBeGreaterThan(0);
    expect(webhookSources.map((f) => f.path)).toContain(
      'src/app/api/webhooks/clicksend/inbound/route.ts',
    );
  });

  it('NO file under src/app/api/webhooks imports the classification module', () => {
    // ┌──────────────────────────────────────────────────────────────────────┐
    // │ THE D-16 GATE. An Anthropic outage must never be able to delay or    │
    // │ fail a customer's STOP. The webhook matches the deterministic regex, │
    // │ writes suppression, threads, pauses and answers 200 — with no model  │
    // │ anywhere on that path. Classification happens later, from the tick,  │
    // │ over rows this route has already finished with.                      │
    // └──────────────────────────────────────────────────────────────────────┘
    //
    // MATCHED ON THE IMPORT-PATH FORM, never the bare word: the ServiceM8
    // webhook route legitimately uses "classifiable" in a comment about job
    // statuses, and a gate that fired on that would be deleted by the next
    // person to hit it rather than fixed.
    const importsClassification = /from\s+['"][^'"]*core\/classification[^'"]*['"]/;

    for (const file of webhookSources) {
      expect(importsClassification.test(file.source), `${file.path} must stay LLM-free`).toBe(
        false,
      );
    }
  });

  it('the tick runs classification LAST, after the completion sweep', () => {
    // Ordering as a property of the source, because the behavioural alternative
    // needs a database. Nothing above reads a label (D-14: no label triggers a
    // state transition), so a model call standing in front of a send would buy
    // this tick nothing and cost somebody their follow-up.
    const sweep = TICK_SOURCE.indexOf('await runCompletionSweep()');
    const classify = TICK_SOURCE.indexOf('await runClassificationPass(');

    expect(sweep).toBeGreaterThan(-1);
    expect(classify).toBeGreaterThan(sweep);
  });

  it('wraps the classification pass in its own try/catch that logs no caught value', () => {
    // The isolation is asserted behaviourally in
    // `tests/cadence-tick-classification.test.ts`; this pins the shape the other
    // passes share — a caught driver error carries the statement, and this
    // statement's parameters include a customer's words.
    const pass = TICK_SOURCE.slice(
      TICK_SOURCE.indexOf('async function runClassificationPass'),
      TICK_SOURCE.indexOf('export async function runCadenceTick'),
    );

    expect(pass).toContain('try {');
    // `catch {` with no binding — the caught value cannot be logged because it
    // is not named.
    expect(pass).toMatch(/}\s*catch\s*{/);
    expect(pass).not.toMatch(/catch\s*\(/);
  });
});

describe('proxy matcher exclusion (RESEARCH Pitfall 7)', () => {
  /** The matcher string, read from the real file rather than re-declared here. */
  const matcher = (() => {
    const found = PROXY_SOURCE.match(/matcher:\s*\['([^']+)'\]/);
    if (!found) throw new Error('proxy.ts no longer exposes a single-string matcher');
    return found[1];
  })();

  const matches = (pathname: string) => new RegExp(`^${matcher}$`).test(pathname);

  it('does NOT match the cadence-tick route', () => {
    expect(matches('/api/internal/cadence-tick')).toBe(false);
  });

  it('still matches console pages — the exclusion is API-only', () => {
    expect(matches('/')).toBe(true);
    expect(matches('/clients/2f1c8f8e-0000-4000-8000-000000000000')).toBe(true);
  });
});
