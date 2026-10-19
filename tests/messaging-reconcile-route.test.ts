/**
 * The reconcile tick's door: the bearer, and the counts-only body.
 *
 * SPLIT FROM `tests/messaging-reconcile.test.ts` for a mechanical reason worth
 * writing down: this file must `vi.mock('@/core/messaging/reconcile')` to observe
 * the route in isolation, and a mocked module cannot also be the subject under
 * test. The same separation `cadence-tick-route.test.ts` keeps from
 * `cadence-tick.test.ts`.
 *
 * The handler is invoked directly with `Request` objects — no dev server, no
 * database, no ClickSend.
 */
import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const SECRET = 'reconcile-secret-of-exactly-forty-chars!!';
/** DERIVED, so "same length" cannot drift when the secret above is edited. */
const WRONG_SAME_LENGTH = `W${SECRET.slice(1)}`;
/** The cadence tick's bearer. It must not open this door. */
const CADENCE_SECRET = 'cadence-secret-of-exactly-forty-chars!!!!';
/**
 * Phase 15 (2026-10, plan 15-07): the pepper the route reads ONCE and hands to
 * the pseudonymisation pass. A test literal over the 32-character floor — not a
 * secret, and not hex, so no secret scan can mistake it for one.
 */
const PEPPER = 'route-test-caller-pepper-not-a-secret-at-all';

vi.mock('@/core/shared/env', () => ({
  getServerEnv: () => ({
    MESSAGING_RECONCILE_SECRET: SECRET,
    CADENCE_TICK_SECRET: CADENCE_SECRET,
    CALLER_PSEUDONYM_PEPPER: PEPPER,
  }),
}));

const reconcileMessaging = vi.fn();
vi.mock('@/core/messaging/reconcile', () => ({
  reconcileMessaging: (...args: unknown[]) => reconcileMessaging(...args),
}));

const reconcileMissedCalls = vi.fn();
vi.mock('@/core/telephony/reconcile', () => ({
  reconcileMissedCalls: (...args: unknown[]) => reconcileMissedCalls(...args),
}));

// Phase 15 (2026-10, plan 15-07): the nightly pseudonymisation pass rides this
// tick as its third awaited pass. Mocked like the other two; the FAILED constant
// is the real shape, so the route's `.catch` belt is observed returning it.
const runPseudonymisationPass = vi.fn();
vi.mock('@/core/leads/pseudonymise', () => ({
  runPseudonymisationPass: (...args: unknown[]) => runPseudonymisationPass(...args),
  PSEUDONYMISE_FAILED: {
    leadsClosed: 0,
    leadsConverted: 0,
    missedCallsWithLead: 0,
    missedCallsNoLead: 0,
    inboundRows: 0,
    inboundRowsNoLead: 0,
    cadenceRows: 0,
    ledgerRows: 0,
    failed: 0,
    passFailed: true,
  },
}));

const { POST, maxDuration, runtime } = await import(
  '@/app/api/internal/messaging-reconcile/route'
);

const ROUTE_SOURCE = readFileSync(
  'src/app/api/internal/messaging-reconcile/route.ts',
  'utf8',
);
const PROXY_SOURCE = readFileSync('src/proxy.ts', 'utf8');

const MESSAGING = { skipped: false, receiptsApplied: 3, inboundReplayed: 2, optOutsRecorded: 1 };
/**
 * The messaging half of the BODY: the four counts plus the route's own
 * `messagingFailed` flag (15-REVIEW WR-09), false when the pass returned.
 */
const MESSAGING_BODY = { ...MESSAGING, messagingFailed: false };
/** What a messaging pass that threw past the route's belt answers (WR-09). */
const MESSAGING_FAILED_BODY = {
  skipped: true,
  receiptsApplied: 0,
  inboundReplayed: 0,
  optOutsRecorded: 0,
  messagingFailed: true,
};
const TELEPHONY = {
  skipped: false,
  missedCallsRecovered: 4,
  recordingsFound: 0,
  recordingsCheckFailed: false,
};
/** The pass's own counts, as the core returns them (Phase 15, plan 15-07). */
const PRIVACY = {
  leadsClosed: 2,
  leadsConverted: 1,
  missedCallsWithLead: 3,
  missedCallsNoLead: 4,
  inboundRows: 5,
  inboundRowsNoLead: 7,
  cadenceRows: 2,
  ledgerRows: 6,
  failed: 0,
  passFailed: false,
};
/** The ten body fields those counts become, each renamed BY NAME in the route. */
const PRIVACY_BODY = {
  pseudonymisedLeadsClosed: 2,
  pseudonymisedLeadsConverted: 1,
  pseudonymisedMissedCallsWithLead: 3,
  pseudonymisedMissedCallsNoLead: 4,
  pseudonymisedInboundRows: 5,
  pseudonymisedInboundRowsNoLead: 7,
  pseudonymisedCadenceRows: 2,
  pseudonymisedLedgerRows: 6,
  pseudonymiseFailed: 0,
  pseudonymisePassFailed: false,
};
/** What a pass that threw past its own catch answers: zeros, and the flag. */
const PRIVACY_FAILED_BODY = {
  pseudonymisedLeadsClosed: 0,
  pseudonymisedLeadsConverted: 0,
  pseudonymisedMissedCallsWithLead: 0,
  pseudonymisedMissedCallsNoLead: 0,
  pseudonymisedInboundRows: 0,
  pseudonymisedInboundRowsNoLead: 0,
  pseudonymisedCadenceRows: 0,
  pseudonymisedLedgerRows: 0,
  pseudonymiseFailed: 0,
  pseudonymisePassFailed: true,
};
/**
 * What the route answers: four messaging counts, then three telephony fields
 * (11-03, WR-05), then the pass's nine (Phase 15, plan 15-07).
 */
const RESULT = {
  ...MESSAGING_BODY,
  missedCallsRecovered: 4,
  recordingsFound: 0,
  recordingsCheckFailed: false,
  ...PRIVACY_BODY,
};
/** `reconcileMissedCalls`' own NOTHING — its total guard. */
const TELEPHONY_NOTHING = {
  skipped: true,
  missedCallsRecovered: 0,
  recordingsFound: 0,
  recordingsCheckFailed: false,
};

function tick(authorization?: string): Request {
  return new Request('https://example.test/api/internal/messaging-reconcile', {
    method: 'POST',
    headers: authorization === undefined ? {} : { authorization },
  });
}

beforeEach(() => {
  reconcileMessaging.mockReset();
  reconcileMessaging.mockResolvedValue(MESSAGING);
  reconcileMissedCalls.mockReset();
  reconcileMissedCalls.mockResolvedValue(TELEPHONY);
  runPseudonymisationPass.mockReset();
  runPseudonymisationPass.mockResolvedValue(PRIVACY);
});

describe('messaging-reconcile authentication', () => {
  it('401s with no Authorization header — and never runs the sweep', async () => {
    const response = await POST(tick());

    expect(response.status).toBe(401);
    expect(await response.text()).toBe('unauthorized');
    expect(reconcileMessaging).not.toHaveBeenCalled();
    expect(reconcileMissedCalls).not.toHaveBeenCalled();
    expect(runPseudonymisationPass).not.toHaveBeenCalled();
  });

  it('401s for a wrong bearer of IDENTICAL length', async () => {
    expect(WRONG_SAME_LENGTH.length).toBe(SECRET.length);

    const response = await POST(tick(`Bearer ${WRONG_SAME_LENGTH}`));

    expect(response.status).toBe(401);
    expect(reconcileMessaging).not.toHaveBeenCalled();
    // Phase 15 (2026-10, plan 15-07): the wrong bearer never reaches the pass.
    expect(runPseudonymisationPass).not.toHaveBeenCalled();
  });

  it('401s rather than throwing on a TRUNCATED bearer', async () => {
    const response = await POST(tick(`Bearer ${SECRET.slice(0, 8)}`));

    expect(response.status).toBe(401);
  });

  it('401s for the raw secret with no "Bearer " prefix', async () => {
    expect((await POST(tick(SECRET))).status).toBe(401);
  });

  it('THE ROTATION RULE: the cadence tick’s bearer does not open this door', async () => {
    // Rotating one secret must 401 one endpoint. These two differ in blast
    // radius as well as in schedule — the cadence tick SENDS.
    const response = await POST(tick(`Bearer ${CADENCE_SECRET}`));

    expect(response.status).toBe(401);
    expect(reconcileMessaging).not.toHaveBeenCalled();
    expect(runPseudonymisationPass).not.toHaveBeenCalled();
  });

  it('401 is a plain response with NO Location header — provably not a redirect', async () => {
    // RESEARCH Pitfall 7: a 307 to /login is recorded by `net.http_post` as a
    // successful delivery, so `cron.job_run_details` would be green forever
    // while nothing was ever reconciled.
    const response = await POST(tick());

    expect(response.headers.get('location')).toBeNull();
  });

  it('runs the sweep on a correct bearer', async () => {
    const response = await POST(tick(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    expect(reconcileMessaging).toHaveBeenCalledTimes(1);
    expect(reconcileMissedCalls).toHaveBeenCalledTimes(1);
    expect(runPseudonymisationPass).toHaveBeenCalledTimes(1);
  });
});

describe('messaging-reconcile response', () => {
  it('answers the enumerated counts and nothing else', async () => {
    const body = await (await POST(tick(`Bearer ${SECRET}`))).json();

    expect(body).toEqual(RESULT);
    expect(body.missedCallsRecovered).toBe(4);
    // `skipped` stays the MESSAGING pass's flag — the telephony pass's own
    // `skipped` is not a field of the body.
    //
    // MOVED 2026-10 (Phase 15, plan 15-07, COMP-02): the pin was seven keys
    // (four messaging + three telephony). The nightly pseudonymisation pass
    // rides this tick and adds nine counts by name, so the body is sixteen
    // keys BY DESIGN (research Q6) — still counts only, still enumerated.
    //
    // MOVED 2026-10-15 (15-REVIEW WR-01): seventeen. The pass also hashes the
    // late replies from a hashed lead's number that we could not place, and
    // counts them by name (`pseudonymisedInboundRowsNoLead`).
    //
    // MOVED 2026-10-15 (15-REVIEW WR-09): eighteen. The messaging pass carries
    // its own belt like the two behind it, and reports `messagingFailed`.
    expect(Object.keys(body)).toHaveLength(18);
  });

  it('a skipped telephony pass (no divert number) answers zeros for its fields', async () => {
    reconcileMissedCalls.mockResolvedValue(TELEPHONY_NOTHING);

    const response = await POST(tick(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ...MESSAGING_BODY,
      missedCallsRecovered: 0,
      recordingsFound: 0,
      recordingsCheckFailed: false,
      ...PRIVACY_BODY,
    });
  });

  it('a FAILED recordings count reaches the body as null + its own flag, never 0 (WR-05)', async () => {
    reconcileMissedCalls.mockResolvedValue({
      skipped: false,
      missedCallsRecovered: 2,
      recordingsFound: null,
      recordingsCheckFailed: true,
    });

    const response = await POST(tick(`Bearer ${SECRET}`));

    expect(await response.json()).toEqual({
      ...MESSAGING_BODY,
      missedCallsRecovered: 2,
      recordingsFound: null,
      recordingsCheckFailed: true,
      ...PRIVACY_BODY,
    });
  });

  it('a THROWING telephony pass still answers 200 — the check reported failed, messaging intact', async () => {
    // The core catches everything itself; this pins the route's own `.catch`,
    // so a regression in the core degrades to zeros rather than to a 500 that
    // `cron.job_run_details` records after the messaging work already ran.
    reconcileMissedCalls.mockRejectedValue(new Error('Twilio said: +61491570156 not found'));

    const response = await POST(tick(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ...MESSAGING_BODY,
      missedCallsRecovered: 0,
      recordingsFound: null,
      recordingsCheckFailed: true,
      ...PRIVACY_BODY,
    });
    expect(JSON.stringify(body)).not.toContain('+61');
  });

  it('the telephony pass runs AFTER the messaging pass, and runs even when messaging skipped', async () => {
    const order: string[] = [];
    reconcileMessaging.mockImplementation(async () => {
      order.push('messaging');
      return { ...MESSAGING, skipped: true, receiptsApplied: 0, inboundReplayed: 0, optOutsRecorded: 0 };
    });
    reconcileMissedCalls.mockImplementation(async () => {
      order.push('telephony');
      return TELEPHONY;
    });

    const body = await (await POST(tick(`Bearer ${SECRET}`))).json();

    expect(order).toEqual(['messaging', 'telephony']);
    expect(body.skipped).toBe(true);
    expect(body.missedCallsRecovered).toBe(4);
  });

  it('every leaf of the body is a number or a boolean — no strings, ever', async () => {
    reconcileMissedCalls.mockResolvedValue({
      ...TELEPHONY,
      // The same future-field leak, on the telephony half.
      lastCaller: '+61491570156',
    });
    reconcileMessaging.mockResolvedValue({
      ...MESSAGING,
      // A field a future contributor adds to `ReconcileResult` for an
      // operator's benefit. It must not ride a spread into
      // `cron.job_run_details` and the Vercel log, which are lower-trust
      // surfaces than the database.
      lastError: 'ClickSend said: could not reach +61491570156',
      failingTenant: 'tenant-1',
    });

    const body = (await (await POST(tick(`Bearer ${SECRET}`))).json()) as Record<string, unknown>;

    for (const [key, value] of Object.entries(body)) {
      expect(typeof value, `${key} is not a number or boolean`).toMatch(/number|boolean/);
    }
    expect(body).not.toHaveProperty('lastError');
    expect(body).not.toHaveProperty('failingTenant');
    expect(body).not.toHaveProperty('lastCaller');
  });
});

/**
 * PHASE 15 (2026-10, plan 15-07; COMP-02, D-06): THE PSEUDONYMISATION PASS ON
 * THIS TICK. One more awaited pass after the telephony sweep — no new pg_cron
 * job, no second bearer — with the pepper read once here at the edge and
 * handed down, and nine counts in the body by name.
 */
describe('messaging-reconcile — the pseudonymisation pass (Phase 15)', () => {
  it('carries the ten pass fields by name beside the seven existing ones', async () => {
    const body = await (await POST(tick(`Bearer ${SECRET}`))).json();

    expect(body).toMatchObject(PRIVACY_BODY);
    expect(body.pseudonymisedLeadsClosed).toBe(2);
    expect(body.pseudonymisedLeadsConverted).toBe(1);
    expect(body.pseudonymisedMissedCallsWithLead).toBe(3);
    expect(body.pseudonymisedMissedCallsNoLead).toBe(4);
    expect(body.pseudonymisedInboundRows).toBe(5);
    expect(body.pseudonymisedInboundRowsNoLead).toBe(7);
    expect(body.pseudonymisedCadenceRows).toBe(2);
    expect(body.pseudonymisedLedgerRows).toBe(6);
    expect(body.pseudonymiseFailed).toBe(0);
    expect(body.pseudonymisePassFailed).toBe(false);
    expect(body.receiptsApplied).toBe(3);
    expect(body.missedCallsRecovered).toBe(4);
  });

  it('calls the pass exactly once with { now: a Date, pepper: the server pepper }', async () => {
    await POST(tick(`Bearer ${SECRET}`));

    expect(runPseudonymisationPass).toHaveBeenCalledTimes(1);
    const [deps] = runPseudonymisationPass.mock.calls[0] as [{ now: unknown; pepper: unknown }];
    expect(deps.now).toBeInstanceOf(Date);
    expect(typeof deps.pepper).toBe('string');
    expect((deps.pepper as string).length).toBeGreaterThanOrEqual(32);
    expect(deps.pepper).toBe(PEPPER);
    expect(Object.keys(deps).sort()).toEqual(['now', 'pepper']);
  });

  it('runs AFTER the telephony sweep', async () => {
    const order: string[] = [];
    reconcileMessaging.mockImplementation(async () => {
      order.push('messaging');
      return MESSAGING;
    });
    reconcileMissedCalls.mockImplementation(async () => {
      order.push('telephony');
      return TELEPHONY;
    });
    runPseudonymisationPass.mockImplementation(async () => {
      order.push('privacy');
      return PRIVACY;
    });

    await POST(tick(`Bearer ${SECRET}`));

    expect(order).toEqual(['messaging', 'telephony', 'privacy']);
  });

  it('a REJECTED pass still answers 200 — FAILED fields, the other seven intact, no number', async () => {
    runPseudonymisationPass.mockRejectedValue(new Error('postgres said: +61491570351 violates'));

    const response = await POST(tick(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ...MESSAGING_BODY,
      missedCallsRecovered: 4,
      recordingsFound: 0,
      recordingsCheckFailed: false,
      ...PRIVACY_FAILED_BODY,
    });
    expect(Object.keys(body).length).toBe(Object.keys(RESULT).length);
    expect(JSON.stringify(body)).not.toContain('+61');
  });

  it('a future string field on the pass result never reaches the body', async () => {
    runPseudonymisationPass.mockResolvedValue({ ...PRIVACY, lastHash: 'a'.repeat(64), lastLead: 'lead-1' });

    const body = (await (await POST(tick(`Bearer ${SECRET}`))).json()) as Record<string, unknown>;

    for (const [key, value] of Object.entries(body)) {
      expect(typeof value, `${key} is not a number or boolean`).toMatch(/number|boolean/);
    }
    expect(body).not.toHaveProperty('lastHash');
    expect(body).not.toHaveProperty('lastLead');
  });
});

/**
 * 15-REVIEW WR-09 (2026-10-15): THE MESSAGING PASS IS BELTED TOO. It runs
 * first; a throw out of it used to 500 the tick and skip the telephony sweep
 * and the retention pass behind it.
 */
describe('messaging-reconcile — a throwing messaging pass (WR-09)', () => {
  it('still answers 200, runs telephony and the retention pass, and says messagingFailed', async () => {
    const order: string[] = [];
    reconcileMessaging.mockImplementation(async () => {
      order.push('messaging');
      throw new Error('ClickSend said: could not reach +61491570156');
    });
    reconcileMissedCalls.mockImplementation(async () => {
      order.push('telephony');
      return TELEPHONY;
    });
    runPseudonymisationPass.mockImplementation(async () => {
      order.push('privacy');
      return PRIVACY;
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await POST(tick(`Bearer ${SECRET}`));

      expect(response.status).toBe(200);
      expect(order).toEqual(['messaging', 'telephony', 'privacy']);
      const body = await response.json();
      expect(body).toEqual({
        ...MESSAGING_FAILED_BODY,
        missedCallsRecovered: 4,
        recordingsFound: 0,
        recordingsCheckFailed: false,
        ...PRIVACY_BODY,
      });
      expect(Object.keys(body)).toHaveLength(Object.keys(RESULT).length);
      expect(JSON.stringify(body)).not.toContain('+61');

      // Logged BY KIND, one fixed line, the caught value discarded.
      const lines = errors.mock.calls.map((args) => args.map(String).join(' '));
      expect(lines).toEqual(['[messaging-reconcile] messaging pass failed']);
    } finally {
      errors.mockRestore();
    }
  });

  it('a pass that returns reports messagingFailed false', async () => {
    const body = await (await POST(tick(`Bearer ${SECRET}`))).json();

    expect(body.messagingFailed).toBe(false);
    expect(body.skipped).toBe(false);
  });

  it('the route belts it in source, with a fixed log line and no caught value', () => {
    expect(ROUTE_SOURCE).toMatch(
      /await reconcileMessaging\(\)\.catch\(\(\) => \{\s*messagingFailed = true;\s*console\.error\('\[messaging-reconcile\] messaging pass failed'\);\s*return MESSAGING_FAILED;\s*\}\)/,
    );
    expect(ROUTE_SOURCE).toContain('messagingFailed,');
  });
});

describe('messaging-reconcile route configuration', () => {
  it('pins the Node runtime and the Fluid ceiling', () => {
    expect(runtime).toBe('nodejs');
    expect(maxDuration).toBe(300);
    expect(ROUTE_SOURCE).toContain("runtime = 'nodejs'");
    expect(ROUTE_SOURCE).toContain('maxDuration = 300');
  });

  it('compares the bearer with timingSafeEqual, not ===', () => {
    expect(ROUTE_SOURCE).toContain('timingSafeEqual');
  });

  it('reads its OWN secret and none of the other four', () => {
    expect(ROUTE_SOURCE).toContain('getServerEnv().MESSAGING_RECONCILE_SECRET');
    for (const other of [
      'CADENCE_TICK_SECRET',
      'SYNC_TICK_SECRET',
      'CLICKSEND_WEBHOOK_SECRET',
      'CLICKSEND_DLR_SECRET',
      'UNSUBSCRIBE_SIGNING_SECRET',
    ]) {
      expect(ROUTE_SOURCE).not.toContain(other);
    }
  });

  it('does not use waitUntil — a suppression it discovers is a compliance write', () => {
    expect(ROUTE_SOURCE).not.toMatch(/\bwaitUntil\b\s*\(/);
    expect(ROUTE_SOURCE).toContain('await reconcileMessaging(');
  });

  it('calls the telephony sweep exactly once, and spreads neither result into the body', () => {
    expect(ROUTE_SOURCE.match(/reconcileMissedCalls\(/g) ?? []).toHaveLength(1);
    expect(ROUTE_SOURCE).toContain('missedCallsRecovered: telephony.missedCallsRecovered');
    expect(ROUTE_SOURCE).toContain('recordingsFound: telephony.recordingsFound');
    expect(ROUTE_SOURCE).toContain('recordingsCheckFailed: telephony.recordingsCheckFailed');
    expect(ROUTE_SOURCE).not.toMatch(/\.\.\.\s*(result|telephony)\b/);
  });

  // Phase 15 (2026-10, plan 15-07): the twin for the third result.
  it('calls the pseudonymisation pass exactly once, reads the pepper here, and spreads none of the three results', () => {
    expect(ROUTE_SOURCE.match(/runPseudonymisationPass\(/g) ?? []).toHaveLength(1);
    expect(ROUTE_SOURCE).toContain('getServerEnv().CALLER_PSEUDONYM_PEPPER');
    expect(ROUTE_SOURCE).toContain('.catch(() => PSEUDONYMISE_FAILED)');
    for (const [field, source] of [
      ['pseudonymisedLeadsClosed', 'leadsClosed'],
      ['pseudonymisedLeadsConverted', 'leadsConverted'],
      ['pseudonymisedMissedCallsWithLead', 'missedCallsWithLead'],
      ['pseudonymisedMissedCallsNoLead', 'missedCallsNoLead'],
      ['pseudonymisedInboundRows', 'inboundRows'],
      ['pseudonymisedInboundRowsNoLead', 'inboundRowsNoLead'],
      ['pseudonymisedCadenceRows', 'cadenceRows'],
      ['pseudonymisedLedgerRows', 'ledgerRows'],
      ['pseudonymiseFailed', 'failed'],
      ['pseudonymisePassFailed', 'passFailed'],
    ]) {
      expect(ROUTE_SOURCE).toContain(`${field}: privacy.${source}`);
    }
    expect(ROUTE_SOURCE).not.toMatch(/\.\.\.\s*(result|telephony|privacy)\b/);
    expect(ROUTE_SOURCE).not.toMatch(/\bwaitUntil\b\s*\(/);
  });

  it('is EXCLUDED from the proxy matcher, and needs no proxy change', () => {
    // `api/` is excluded wholesale, so this route inherits the exclusion —
    // asserted rather than assumed, because the alternative failure is silent.
    const found = PROXY_SOURCE.match(/matcher:\s*\['([^']+)'\]/);
    if (!found) throw new Error('proxy.ts no longer exposes a single-string matcher');

    const matches = (pathname: string) => new RegExp(`^${found[1]}$`).test(pathname);

    expect(matches('/api/internal/messaging-reconcile')).toBe(false);
    expect(matches('/')).toBe(true);
  });
});
