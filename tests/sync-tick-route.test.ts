/**
 * The two halves of RESEARCH Pitfall 7, asserted together.
 *
 * The tick fails silently when EITHER half breaks: the proxy swallowing the
 * route (cron sees a 307 to /login and calls it success), or the route not
 * checking its bearer (an open endpoint that decrypts every client's ServiceM8
 * key). Neither half is provable from the other file, so both live here.
 *
 * The route handler is invoked directly with `Request` objects — no dev server,
 * no port, nothing to leave running. `runSyncTick` is stubbed because what is
 * under test is the gate in front of it; the cycle itself has 25 integration
 * tests of its own in `sync-upsert.test.ts`.
 */
import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A known secret, so the test can send both a correct value and a WRONG VALUE
 * OF THE SAME LENGTH — the only case that exercises `timingSafeEqual` rather
 * than short-circuiting on the length check.
 */
const SECRET = 'test-secret-of-exactly-forty-chars-here!!';
const WRONG_SAME_LENGTH = 'WRONG-secret-of-exactly-forty-chars-here!';

vi.mock('@/core/shared/env', () => ({
  getServerEnv: () => ({ SYNC_TICK_SECRET: SECRET }),
}));

const runSyncTick = vi.fn();
vi.mock('@/core/sync/run-sync', () => ({
  runSyncTick: (...args: unknown[]) => runSyncTick(...args),
}));

const { POST, maxDuration, runtime } = await import('@/app/api/internal/sync-tick/route');

const ROUTE_SOURCE = readFileSync('src/app/api/internal/sync-tick/route.ts', 'utf8');
const PROXY_SOURCE = readFileSync('src/proxy.ts', 'utf8');
const VERCEL_JSON = readFileSync('vercel.json', 'utf8');

function tick(authorization?: string): Request {
  return new Request('https://example.test/api/internal/sync-tick', {
    method: 'POST',
    headers: authorization ? { authorization } : {},
  });
}

const ONE_RESULT = [
  {
    tenantId: '11111111-1111-1111-1111-111111111111',
    outcome: 'ok' as const,
    recorded: true,
    jobsFetched: 3,
    jobsUpserted: 3,
    contactsFetched: 1,
    eventsEmitted: 2,
    paused: false,
    alert: null,
  },
];

beforeEach(() => {
  runSyncTick.mockReset();
  runSyncTick.mockResolvedValue(ONE_RESULT);
});

describe('sync-tick authentication (T-2-03)', () => {
  it('returns 401 with no Authorization header — and never runs a cycle', async () => {
    const response = await POST(tick());

    expect(response.status).toBe(401);
    expect(runSyncTick).not.toHaveBeenCalled();
  });

  it('returns 401 for a wrong secret of IDENTICAL length', async () => {
    // Same length on purpose: a length mismatch is rejected before
    // timingSafeEqual is reached, so an equal-length wrong value is the only
    // input that proves the comparison itself rejects.
    expect(WRONG_SAME_LENGTH.length).toBe(SECRET.length);

    const response = await POST(tick(`Bearer ${WRONG_SAME_LENGTH}`));

    expect(response.status).toBe(401);
    expect(runSyncTick).not.toHaveBeenCalled();
  });

  it('returns 401 rather than throwing when the header is far too short', async () => {
    // `timingSafeEqual` throws on unequal lengths. Without the pre-check this
    // is a 500 — which a monitor reads very differently from a 401.
    const response = await POST(tick('Bearer x'));

    expect(response.status).toBe(401);
  });

  it('rejects a bare secret with no Bearer prefix', async () => {
    const response = await POST(tick(SECRET));

    expect(response.status).toBe(401);
  });

  it('THE PITFALL-7 ASSERTION: the 401 is a plain response, not a redirect', async () => {
    const response = await POST(tick());

    // A 3xx with a Location to /login is what the proxy would have produced,
    // and `net.http_post` records it as a success. If this ever fails, the tick
    // is green in cron and dead in reality.
    expect(response.status).toBe(401);
    expect(response.status < 300 || response.status >= 400).toBe(true);
    expect(response.headers.get('location')).toBeNull();
    expect(response.redirected).toBe(false);
  });
});

describe('sync-tick success path', () => {
  it('runs the cycle and returns the per-connection outcome list', async () => {
    const response = await POST(tick(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    expect(runSyncTick).toHaveBeenCalledTimes(1);

    const body = await response.json();
    expect(body.connections).toBe(1);
    expect(body.outcomes).toHaveLength(1);
    expect(body.outcomes[0]).toMatchObject({
      outcome: 'ok',
      recorded: true,
      jobsFetched: 3,
      eventsEmitted: 2,
      alerted: false,
    });
  });

  it('awaits the cycle inside the request — the response follows the work', async () => {
    // Fire-and-forget (`waitUntil`) is explicitly ruled out for must-happen
    // work. If the handler stopped awaiting, this resolves before the cycle
    // does and `settled` is still false.
    let settled = false;
    runSyncTick.mockImplementation(
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

  it('reduces an alert to a boolean — the client business name does not travel', async () => {
    runSyncTick.mockResolvedValue([
      {
        ...ONE_RESULT[0],
        outcome: 'auth_failed' as const,
        paused: true,
        alert: { kind: 'auth', tenantId: 'x', tenantName: 'Acme Plumbing', outcome: 'auth_failed' },
      },
    ]);

    const body = await (await POST(tick(`Bearer ${SECRET}`))).json();

    expect(body.outcomes[0].alerted).toBe(true);
    expect(JSON.stringify(body)).not.toContain('Acme Plumbing');
  });
});

describe('route configuration', () => {
  it('sets maxDuration to the 300s Fluid ceiling', () => {
    expect(maxDuration).toBe(300);
  });

  it('pins the Node runtime — node:crypto is not available on edge', () => {
    expect(runtime).toBe('nodejs');
  });

  it('compares the secret with timingSafeEqual, not ===', () => {
    expect(ROUTE_SOURCE).toContain('timingSafeEqual');
    // A plain equality check on the secret would pass every behavioural test
    // above while leaking the secret one byte at a time.
    expect(ROUTE_SOURCE).not.toMatch(/provided\s*===\s*expected/);
  });

  it('pins function execution to Sydney (AU residency posture)', () => {
    expect(JSON.parse(VERCEL_JSON).regions).toEqual(['syd1']);
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

  it('does NOT match the sync-tick route', () => {
    expect(matches('/api/internal/sync-tick')).toBe(false);
  });

  it('does NOT match the webhook route', () => {
    expect(matches('/api/webhooks/servicem8')).toBe(false);
  });

  it('still matches console pages — the exclusion is API-only', () => {
    expect(matches('/')).toBe(true);
    expect(matches('/clients/2f1c8f8e-0000-4000-8000-000000000000')).toBe(true);
  });

  /**
   * `/login` NOW MATCHES (WR-01). The exclusion it used to have was removed
   * because it applied on every host, so the apex could never 404 the console
   * sign-in form. The form is kept open by `PUBLIC_PATHS` in
   * `src/lib/supabase/proxy.ts` instead, which is a decision the proxy makes
   * AFTER classifying the host rather than one baked into the matcher.
   *
   * Nothing in this file's subject changes: the cron POST is exempted by
   * `api/`, and that exclusion is untouched.
   */
  it('matches /login and the /login prefix impostor alike', () => {
    expect(matches('/login')).toBe(true);
    expect(matches('/loginanything')).toBe(true);
  });

  it('does not exempt a path that merely contains "api"', () => {
    // The exclusion is `api/` at the start of the path, not anywhere in it: a
    // page at /clients/api-keys must stay gated.
    expect(matches('/clients/api-keys')).toBe(true);
  });
});
