/**
 * Webhooks are hints, not records (SYNC-03, T-2-05).
 *
 * The property this suite exists to hold down is a NEGATIVE one: no value from
 * an unauthenticated request body ever reaches a column. A behavioural test can
 * only sample that, so it is asserted twice — behaviourally (a payload carrying
 * a status change causes a *re-fetch*, and the re-fetch's data is what lands)
 * and structurally (the route file references no write surface at all).
 *
 * The route is inert in production until OAuth credentials for App ID 000000
 * are issued. Testing it now is not premature: this is the file that will be
 * checked when someone activates it months from now, and the guarantees it pins
 * are the reason activation can be a configuration change rather than a review.
 */
import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const CONNECTION = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  tenantName: 'Acme Plumbing',
  tenantTimezone: 'Australia/Perth',
  apiKeyCiphertext: 'enc:v1:aa:bb:cc',
  jobCursor: null,
  contactCursor: null,
  consecutiveFailures: 0,
  alertedAt: null,
  lastSuccessAt: null,
  lastAttemptAt: null,
};

/** The one response body every non-challenge POST gets (WR-01). */
const ACCEPTED = { status: 'accepted' };

const JOB_UUID = '2f1c8f8e-0000-4000-8000-000000000000';

const webhookHint = vi.fn();
const runSyncForConnection = vi.fn();

vi.mock('@/db/repository', () => ({
  forAllTenants_webhookHint: (...args: unknown[]) => webhookHint(...args),
}));

vi.mock('@/core/sync/run-sync', () => ({
  runSyncForConnection: (...args: unknown[]) => runSyncForConnection(...args),
}));

const { POST, GET } = await import('@/app/api/webhooks/servicem8/route');

const ROUTE_SOURCE = readFileSync('src/app/api/webhooks/servicem8/route.ts', 'utf8');

function callback(body: unknown): Request {
  return new Request('https://example.test/api/webhooks/servicem8', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  webhookHint.mockReset();
  runSyncForConnection.mockReset();
  webhookHint.mockResolvedValue(CONNECTION);
  runSyncForConnection.mockResolvedValue({ outcome: 'ok' });
});

describe('subscription challenge handshake', () => {
  it('echoes the challenge value back', async () => {
    const response = await POST(callback({ challenge: 'sm8-challenge-token' }));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('sm8-challenge-token');
  });

  it('does not run a sync cycle for a challenge', async () => {
    await POST(callback({ challenge: 'sm8-challenge-token' }));

    expect(runSyncForConnection).not.toHaveBeenCalled();
  });

  it('answers the query-string form on GET too', async () => {
    const response = await GET(
      new Request('https://example.test/api/webhooks/servicem8?challenge=abc123'),
    );

    expect(await response.text()).toBe('abc123');
  });
});

describe('hint-to-poll (SYNC-03)', () => {
  it('resolves the tenant from the job uuid and runs THE SAME cycle the tick runs', async () => {
    const response = await POST(callback({ uuid: JOB_UUID }));

    expect(webhookHint).toHaveBeenCalledWith(JOB_UUID);
    expect(runSyncForConnection).toHaveBeenCalledWith(CONNECTION);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(ACCEPTED);
  });

  it('accepts the batched `entry` envelope', async () => {
    await POST(callback({ entry: [{ uuid: JOB_UUID }] }));

    expect(webhookHint).toHaveBeenCalledWith(JOB_UUID);
  });

  it('IGNORES every other field in the payload — the poll is the truth', async () => {
    await POST(
      callback({
        uuid: JOB_UUID,
        status: 'Work Order',
        total_invoice_amount: '99999.0000',
        active: 0,
        resource_url: 'https://api.servicem8.com/api_1.0/job/x.json',
      }),
    );

    // The forged win did not become an argument to anything. The only thing the
    // body was allowed to influence is WHICH tenant gets re-fetched.
    expect(runSyncForConnection).toHaveBeenCalledWith(CONNECTION);
    expect(runSyncForConnection).toHaveBeenCalledTimes(1);
  });

  it('does nothing for an unknown job uuid — polling covers it', async () => {
    webhookHint.mockResolvedValue(undefined);

    const response = await POST(callback({ uuid: JOB_UUID }));

    expect(runSyncForConnection).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(ACCEPTED);
  });
});

/**
 * WR-01. The endpoint is unauthenticated and the callback URL is knowable, so
 * ANY distinguishable response is an answer to "is this ServiceM8 job uuid
 * mirrored by one of your clients?" — and a set of such answers is a client
 * list. The previous vocabulary (`polled` / `debounced` / `unknown` / `ignored`)
 * gave that away directly.
 *
 * Asserted as byte-identity across every reachable branch rather than as four
 * separate `toEqual(ACCEPTED)` checks: the property is that the responses cannot
 * be TOLD APART, which is stronger than each matching a constant.
 */
describe('enumeration oracle (WR-01)', () => {
  async function bodyFor(setup: () => void): Promise<string> {
    webhookHint.mockReset();
    runSyncForConnection.mockReset();
    runSyncForConnection.mockResolvedValue({ outcome: 'ok' });
    setup();
    return (await POST(callback({ uuid: JOB_UUID }))).text();
  }

  it('answers identically for mirrored, unknown, paused and debounced', async () => {
    const mirrored = await bodyFor(() => webhookHint.mockResolvedValue(CONNECTION));

    // Unknown uuid AND paused connection both resolve to `undefined` inside the
    // accessor — the distinction the original comment correctly refused to make.
    const unknownOrPaused = await bodyFor(() => webhookHint.mockResolvedValue(undefined));

    const debounced = await bodyFor(() =>
      webhookHint.mockResolvedValue({ ...CONNECTION, lastSuccessAt: new Date() }),
    );

    expect(unknownOrPaused).toBe(mirrored);
    expect(debounced).toBe(mirrored);
  });

  it('an unparseable body is indistinguishable from a resolvable hint', async () => {
    webhookHint.mockResolvedValue(CONNECTION);

    const hint = await (await POST(callback({ uuid: JOB_UUID }))).text();
    const garbage = await (await POST(callback('<html>not json</html>'))).text();
    const noUuid = await (await POST(callback({ something: 'else' }))).text();

    expect(garbage).toBe(hint);
    expect(noUuid).toBe(hint);
  });

  it('the route contains no status vocabulary to leak', () => {
    // The values were only ever for local debugging, and this endpoint has
    // nobody to report to — the outcome is recorded in `sync_runs`.
    const body = ROUTE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    for (const leaked of ['polled', 'debounced', 'unknown']) {
      expect(body).not.toContain(`'${leaked}'`);
    }
  });
});

describe('debounce (T-2-05)', () => {
  it('skips the poll when the connection synced within the last 60 seconds', async () => {
    webhookHint.mockResolvedValue({ ...CONNECTION, lastSuccessAt: new Date(Date.now() - 5_000) });

    const response = await POST(callback({ uuid: JOB_UUID }));

    expect(runSyncForConnection).not.toHaveBeenCalled();
    expect(await response.json()).toEqual(ACCEPTED);
  });

  it('polls when the last success is older than the window', async () => {
    webhookHint.mockResolvedValue({ ...CONNECTION, lastSuccessAt: new Date(Date.now() - 90_000) });

    await POST(callback({ uuid: JOB_UUID }));

    expect(runSyncForConnection).toHaveBeenCalledTimes(1);
  });

  it('polls a connection that has never synced', async () => {
    await POST(callback({ uuid: JOB_UUID }));

    expect(runSyncForConnection).toHaveBeenCalledTimes(1);
  });
});

/**
 * WR-02. `last_success_at` advances only on the success path, so a debounce
 * measured from it stops engaging the moment an account starts failing — and
 * keeps not engaging for as long as the failures continue.
 *
 * That is the exact inverse of what the debounce is for. Each unauthenticated
 * POST triggers a fresh `fetchAndParse` (two resources, up to three attempts
 * each, 20s timeouts) against a third party's already-rate-limited account, at a
 * frequency the caller chooses, inflating `consecutive_failures` on the way.
 */
describe('debounce holds during a failure episode (WR-02)', () => {
  it('debounces on the last ATTEMPT even when the last success is ancient', async () => {
    webhookHint.mockResolvedValue({
      ...CONNECTION,
      // A four-hour failure episode: no success, but cycles are still running.
      lastSuccessAt: new Date(Date.now() - 4 * 60 * 60_000),
      lastAttemptAt: new Date(Date.now() - 5_000),
    });

    await POST(callback({ uuid: JOB_UUID }));

    expect(runSyncForConnection).not.toHaveBeenCalled();
  });

  it('debounces on attempts alone for a connection that has never succeeded', async () => {
    // The worst case of all: a brand-new connection failing from the start has
    // `last_success_at = NULL`, which the old rule read as POSITIVE_INFINITY —
    // i.e. "never debounce, ever".
    webhookHint.mockResolvedValue({
      ...CONNECTION,
      lastSuccessAt: null,
      lastAttemptAt: new Date(Date.now() - 5_000),
    });

    await POST(callback({ uuid: JOB_UUID }));

    expect(runSyncForConnection).not.toHaveBeenCalled();
  });

  it('still polls once the attempt is older than the window', async () => {
    // The debounce must not become a permanent mute: a real hint arriving after
    // the window still gets its cycle.
    webhookHint.mockResolvedValue({
      ...CONNECTION,
      lastSuccessAt: null,
      lastAttemptAt: new Date(Date.now() - 90_000),
    });

    await POST(callback({ uuid: JOB_UUID }));

    expect(runSyncForConnection).toHaveBeenCalledTimes(1);
  });

  it('takes the MAX of the two, so a recent success still debounces', async () => {
    webhookHint.mockResolvedValue({
      ...CONNECTION,
      lastSuccessAt: new Date(Date.now() - 5_000),
      lastAttemptAt: new Date(Date.now() - 90_000),
    });

    await POST(callback({ uuid: JOB_UUID }));

    expect(runSyncForConnection).not.toHaveBeenCalled();
  });

  it('polls when neither has ever happened', async () => {
    webhookHint.mockResolvedValue({ ...CONNECTION, lastSuccessAt: null, lastAttemptAt: null });

    await POST(callback({ uuid: JOB_UUID }));

    expect(runSyncForConnection).toHaveBeenCalledTimes(1);
  });
});

describe('never a non-200 (delivery behaviour)', () => {
  it('returns 200 for a body that is not JSON at all', async () => {
    const response = await POST(callback('<html>not json</html>'));

    expect(response.status).toBe(200);
    expect(runSyncForConnection).not.toHaveBeenCalled();
  });

  it('returns 200 for JSON with no recognisable uuid', async () => {
    const response = await POST(callback({ something: 'else' }));

    expect(response.status).toBe(200);
  });

  it('returns 200 for a malformed uuid rather than 400', async () => {
    const response = await POST(callback({ uuid: 'not-a-uuid' }));

    expect(response.status).toBe(200);
    expect(webhookHint).not.toHaveBeenCalled();
  });

  it('returns 200 even when the sync cycle throws', async () => {
    // A 429 from us throttles ServiceM8 delivery for 15 minutes and a 410
    // auto-unsubscribes; a 500 buys 72 hours of retries. None of those helps.
    runSyncForConnection.mockRejectedValue(new Error('database unreachable'));

    const response = await POST(callback({ uuid: JOB_UUID }));

    expect(response.status).toBe(200);
  });

  it('does not leak the thrown error into the response (T-2-02)', async () => {
    runSyncForConnection.mockRejectedValue(new Error('X-API-Key: smk-secret-value'));

    const body = await (await POST(callback({ uuid: JOB_UUID }))).text();

    expect(body).not.toContain('smk-secret-value');
  });
});

/**
 * WR-09. The uniqueness constraint on `quotes` is `(tenant_id, sm8_job_uuid)`,
 * not `sm8_job_uuid` alone, so two tenants legitimately holding the same job
 * uuid is a legal state — two design partners on one ServiceM8 account, a shared
 * franchise account, or a client onboarded twice during testing.
 *
 * A bare `LIMIT 1` then lets Postgres return either row, and which one it
 * returns can change with the plan, the statistics or a vacuum: the hint would
 * poll one tenant and never the other, non-deterministically.
 *
 * Asserted against the query's source because the defect is the ABSENCE of an
 * ORDER BY. Reproducing the ambiguity behaviourally would mean provoking a plan
 * change, which proves less than it costs; what needs pinning is that the choice
 * is made explicitly at all.
 */
describe('the hint resolves one tenant deterministically (WR-09)', () => {
  const REPO = readFileSync('src/db/repository/for-all-tenants.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  const HINT = REPO.slice(REPO.indexOf('export async function forAllTenants_webhookHint'));

  it('orders before limiting', () => {
    const orderAt = HINT.indexOf('.orderBy');
    const limitAt = HINT.indexOf('.limit(1)');

    expect(orderAt).toBeGreaterThan(-1);
    expect(limitAt).toBeGreaterThan(orderAt);
  });

  it('prefers the tenant furthest behind, matching the tick ordering', () => {
    expect(HINT).toMatch(/lastSuccessAt[\s\S]*?ASC NULLS FIRST/);
  });

  it('breaks exact ties on tenant id, so the result is stable not merely defined', () => {
    // Two connections with equal (or both NULL) last_success_at must not swap
    // between calls.
    expect(HINT).toMatch(/\.orderBy\([\s\S]*?sm8Connections\.tenantId[\s\S]*?\)/);
  });
});

describe('structural: the route writes nothing', () => {
  it('imports no write surface — only the resolver and the sync cycle', () => {
    // `forTenant` is the ONLY sanctioned write path in the codebase. Its absence
    // here is the structural half of "no payload field is ever persisted": a
    // future edit that wanted to write would have to import it, and this fails.
    expect(ROUTE_SOURCE).not.toContain('forTenant');
    expect(ROUTE_SOURCE).not.toMatch(/\binsert\b|\bupdate\b\(|\bupsert/i);
    expect(ROUTE_SOURCE).toContain('forAllTenants_webhookHint');
    expect(ROUTE_SOURCE).toContain('runSyncForConnection');
  });

  it('parses the body through a closed schema with no passthrough', () => {
    expect(ROUTE_SOURCE).toContain('safeParse');
    expect(ROUTE_SOURCE).not.toContain('.passthrough()');
  });
});
