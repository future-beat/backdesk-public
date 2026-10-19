/**
 * The proxy matcher, after the public site moved in (Phase 9, D-02).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `/audit` IS PUBLIC. `/audits` IS THE CONSOLE. One character apart, and   │
 * │ an unanchored exclusion (`audit|` rather than `audit$|audit/`) would     │
 * │ prefix-match both — silently taking the session gate off the console's   │
 * │ audit pages while every test that only checked `/audit` still passed     │
 * │ (RESEARCH Pitfall 3). Both directions are asserted below.                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The matcher is READ FROM THE REAL FILE with the SAME regex the three route
 * suites use, so this suite also fails if somebody turns it into an array of
 * strings or a `has` object — which would break those suites at a distance.
 *
 * THE HOST HALF (09-04) is the second half of this file: the same `proxy()` is
 * called for real, once per host class, with `@/lib/supabase/proxy` mocked so no
 * Supabase environment is needed. What it pins is the shape of D-02 — a public
 * host serves `/` WITHOUT a session call and 404s every console path (never a
 * redirect chain to the app host), while the app host keeps its current
 * behaviour with `/` rewritten to the moved client list.
 *
 * The classification chooses between PUBLIC PAGES and THE AUTH WALL and nothing
 * else. It is not an authorisation decision and must never become one: console
 * pages gate on `getClaims()` in `(console)/layout.tsx` and every mutating
 * action calls `requireOperator()`, so a spoofed host buys an attacker the
 * login form (threat T-9-01).
 */
import { existsSync, readFileSync } from 'node:fs';

import { NextRequest } from 'next/server';
import {
  getRewrittenUrl,
  isRewrite,
  // Next 16.3.2 still ships this under its MIDDLEWARE name even though the file
  // convention was renamed to `proxy.ts` — verified against
  // node_modules/next/dist/experimental/testing/server/middleware-testing-utils.d.ts.
  // The plan wrote `unstable_doesProxyMatch`, which does not exist.
  unstable_doesMiddlewareMatch,
} from 'next/experimental/testing/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APEX_DOMAIN, CONSOLE_HOST } from '@/core/brand';

const PROXY_SOURCE = readFileSync('src/proxy.ts', 'utf8');
const SUPABASE_PROXY_SOURCE = readFileSync('src/lib/supabase/proxy.ts', 'utf8');

/**
 * The session gate, replaced by a spy.
 *
 * Mocked rather than exercised because this suite is about ROUTING: which host
 * reaches the gate at all, and with what rewrite. `updateSession`'s own
 * behaviour (cookie rotation, the `/login` redirect) is the subject of the
 * structural describe at the bottom and of the console's own suites.
 */
const updateSession = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/proxy', () => ({ updateSession }));

// Imported AFTER the mock declaration for readability only — `vi.mock` is
// hoisted above every import, so `proxy` sees the spy however this is ordered.
import { config, proxy } from '../src/proxy';

/**
 * THE FILE HAS TO BE SOMEWHERE NEXT LOOKS. This is not pedantry — it is the
 * defect this suite failed to catch for five phases.
 *
 * `proxy.ts` lived at the REPO ROOT from Phase 4 until 09-04, and Next never
 * loaded it: `getPossibleMiddlewareFilenames` searches the directory that
 * CONTAINS `app`, which in this project is `src/`. The build emitted an empty
 * `middleware-manifest.json`, every request went straight to the route, and
 * nothing looked wrong because the real gates — `getClaims()` in the console
 * layout, `requireOperator()` in every action — were doing the work the proxy
 * was credited with. Seven suites read the file's source and asserted its
 * matcher was correct; none of them could tell that the file was inert.
 *
 * Source-reading tests cannot see this, so it is asserted directly: the module
 * is at `src/proxy.ts`, and no file at the root is shadowing it.
 */
describe('the proxy is where Next actually looks for it', () => {
  it('lives at src/proxy.ts, beside app/', () => {
    expect(existsSync('src/proxy.ts')).toBe(true);
  });

  it('has no leftover copy at the repo root', () => {
    // Two files would be worse than the wrong one: the root copy is the one a
    // reader would find and edit, and it would never run.
    expect(existsSync('proxy.ts')).toBe(false);
    expect(existsSync('middleware.ts')).toBe(false);
  });
});

/** The matcher string, read from the real file rather than re-declared here. */
const matcher = (() => {
  const found = PROXY_SOURCE.match(/matcher:\s*\['([^']+)'\]/);
  if (!found) throw new Error('proxy.ts no longer exposes a single-string matcher');
  return found[1];
})();

const matches = (pathname: string) => new RegExp(`^${matcher}$`).test(pathname);

describe('the matcher is still one string (Pitfall 2)', () => {
  it('exposes exactly one matcher entry', () => {
    expect(PROXY_SOURCE.match(/matcher:\s*\['([^']+)'\]/g)).toHaveLength(1);
  });
});

describe('public marketing paths never reach the session gate', () => {
  it.each([
    '/audit',
    '/audit/thanks',
    '/audit/how-to',
    '/privacy',
    // The guides prefix (quick-260915-ec0): the first guide 404'd in production
    // for four deployments because the proxy owned the path on the apex host
    // while `next build` — which never runs the proxy — rendered it fine.
    '/guides/servicem8-quote-follow-up',
    '/brand/og-image.png',
    '/robots.txt',
    '/sitemap.xml',
    /*
     * THE TWO WELL-KNOWN ROOT ICONS (19 Sep 2026).
     *
     * `/favicon.ico` was excluded from the start; `/apple-touch-icon.png` was
     * not, because until this change neither file existed. Both are requested
     * DIRECTLY by Google's favicon crawler, link unfurlers and Safari's touch
     * icon lookup, none of which read the document head — so an icon that the
     * proxy owns is a 307 to /login on the console host and a 404 rewrite on
     * the apex, on every one of those clients.
     */
    '/favicon.ico',
    '/apple-touch-icon.png',
  ])('does NOT match %s', (path) => {
    expect(matches(path)).toBe(false);
  });

  it('exempts the root icons WITHOUT exempting anything underneath them', () => {
    // `apple-touch-icon.png$` is anchored so a console route that merely starts
    // with the name is still gated. `favicon.ico` keeps its long-standing
    // unanchored form, which is recorded here rather than silently tightened.
    expect(matches('/apple-touch-icon.png/secret')).toBe(true);
    expect(matches('/apple-touch-icon.pngx')).toBe(true);
  });
});

describe('the console is still gated — the anchors are load-bearing', () => {
  it.each([
    '/audits',
    '/audits/requests',
    '/inbox',
    // 2026-10-13 (Phase 15, 15-04): the lead queue is gated like every
    // console path — the matcher needed no edit.
    '/leads',
    '/',
    // A prefix match would exempt this too. It is not a marketing route.
    '/auditsomething',
  ])('still matches %s', (path) => {
    expect(matches(path)).toBe(true);
  });
});

describe('the Phase 4 exclusions survived the edit', () => {
  it('still exempts the API routes', () => {
    expect(matches('/api/internal/cadence-tick')).toBe(false);
  });

  /**
   * `/login` USED TO BE EXEMPT, AND THAT WAS THE BUG (WR-01, gap T-9-23).
   *
   * The exclusion was written to keep the sign-in form reachable without a
   * session, but the form was never at risk: `PUBLIC_PATHS` in
   * `src/lib/supabase/proxy.ts` already lets `/login` through `updateSession`
   * without a redirect. What the matcher exclusion actually did was take the
   * proxy off `/login` on EVERY host — including the apex, where the
   * marketing branch then never ran and `https://backdesk.com.au/login`
   * served the console sign-in form with HTTP 200 while `/inbox` and
   * `/audits/requests` on the same host answered 404.
   *
   * Pinned as an assertion rather than a comment because the exclusion reads
   * like an obvious safety measure and the next person to see the login page
   * cost a `getClaims()` call will put it back.
   */
  it('matches /login, so the host branch above can see it', () => {
    expect(matches('/login')).toBe(true);
    expect(matches('/loginanything')).toBe(true);
  });
});

/**
 * The same exclusions again, through NEXT'S OWN matcher engine rather than a
 * hand-rolled `^…$` regex.
 *
 * The regex form above is what the three route suites do and is kept for that
 * reason; this block is the independent check that the string Next actually
 * compiles behaves the same way. A matcher that only satisfies our regex
 * interpretation is a matcher we have tested against ourselves.
 */
describe("Next's own matcher engine agrees with the regex reading", () => {
  const doesMatch = (pathname: string) =>
    unstable_doesMiddlewareMatch({
      config,
      nextConfig: {},
      url: `https://${CONSOLE_HOST}${pathname}`,
    });

  it.each(['/audit', '/audit/thanks', '/privacy', '/guides/servicem8-quote-follow-up', '/brand/og-image.png', '/robots.txt', '/sitemap.xml', '/favicon.ico', '/apple-touch-icon.png'])(
    'skips the proxy for %s',
    (path) => {
      expect(doesMatch(path)).toBe(false);
    },
  );

  // 2026-10-13 (Phase 15, 15-04): `/leads` added.
  it.each(['/', '/inbox', '/leads', '/audits', '/audits/requests', '/clients/new', '/login'])(
    'runs the proxy for %s',
    (path) => {
      expect(doesMatch(path)).toBe(true);
    },
  );
});

/**
 * A request as it arrives in production: the `host` HEADER carries the name.
 *
 * It is set explicitly rather than left to be inferred from the URL because
 * that is the difference the proxy turns on — `nextUrl.hostname` is the address
 * the server is bound to, and a suite that only sets the URL passes against a
 * proxy that cannot classify a real request.
 */
const request = (host: string, pathname: string) =>
  new NextRequest(`https://${host}${pathname}`, { headers: { host } });

/**
 * WHY THE LOCAL STAND-IN IS NOT `127.0.0.1`.
 *
 * RESEARCH §1 and the 09-04 plan both put the loopback literal in
 * `MARKETING_HOSTS`, and it cannot work: `NextURL` normalises every loopback
 * form to `localhost` before the proxy ever sees it, so `127.0.0.1` and the
 * console's own `localhost` are the same string by then — the landing page would
 * have been unreachable locally and `localhost` would have started 404ing the
 * console, depending on which side of the branch won.
 *
 * Pinned as a test rather than fixed in a comment because the wrong address is
 * written down in two planning documents, and the next person to reconcile the
 * code with them will "correct" it back.
 */
describe('the local stand-in survives NextURL normalisation', () => {
  it('collapses every loopback literal to localhost', () => {
    expect(new NextRequest('http://127.0.0.1:3000/').nextUrl.hostname).toBe('localhost');
    expect(new NextRequest('http://[::1]:3000/').nextUrl.hostname).toBe('localhost');
  });

  it('leaves a .localhost subdomain alone', () => {
    expect(new NextRequest('http://apex.localhost:3000/').nextUrl.hostname).toBe('apex.localhost');
  });
});

/**
 * THE HEADER IS THE HOST, and the port and case are not part of it.
 *
 * `nextUrl.hostname` is the URL Next built for the request — under `next start`
 * that is the bound address, so every name on the machine reads back as
 * `localhost`. Reading the header is what makes the marketing branch reachable
 * at all; these cases pin the three ways a header can differ from a bare name.
 */
describe('the host comes from the header, normalised', () => {
  beforeEach(() => {
    updateSession.mockClear();
  });

  it('classifies on the header even when the URL says otherwise', async () => {
    const response = await proxy(
      new NextRequest(`https://${CONSOLE_HOST}/inbox`, { headers: { host: APEX_DOMAIN } }),
    );

    // The URL names the console; the header names the apex, and the header wins.
    expect(updateSession).not.toHaveBeenCalled();
    expect(response.status).toBe(404);
  });

  it('ignores the port and the casing', async () => {
    const response = await proxy(
      new NextRequest('https://example.test/inbox', {
        headers: { host: `${APEX_DOMAIN.toUpperCase()}:3100` },
      }),
    );

    expect(response.status).toBe(404);
  });

  it('falls back to the URL when a synthesised request carries no header', async () => {
    const response = await proxy(new NextRequest(`https://${APEX_DOMAIN}/inbox`));

    expect(response.status).toBe(404);
  });
});

describe('the public hosts serve the landing page and 404 everything else (D-02)', () => {
  beforeEach(() => {
    updateSession.mockClear();
  });

  it.each([APEX_DOMAIN, `www.${APEX_DOMAIN}`, 'apex.localhost'])(
    '%s: / is served without ever calling Supabase',
    async (host) => {
      const response = await proxy(request(host, '/'));

      // The whole point of the branch (threat T-9-25): a stranger's first
      // request must not cost an auth round trip.
      expect(updateSession).not.toHaveBeenCalled();
      expect(isRewrite(response)).toBe(false);
      expect(response.headers.get('x-middleware-next')).toBe('1');
    },
  );

  it.each([
    [`www.${APEX_DOMAIN}`, '/inbox'],
    [APEX_DOMAIN, '/audits/requests'],
    ['apex.localhost', '/clients/new'],
    // WR-01 / gap T-9-23. THE ONE THAT WAS MEASURED WRONG: with `login$|login/`
    // in the matcher this request never reached `proxy()` at all, so the apex
    // answered the console sign-in form with 200. The suite could not see it —
    // the only `/login` assertion was that the matcher exempted the path, which
    // is the defect stated as a requirement.
    [APEX_DOMAIN, '/login'],
    [`www.${APEX_DOMAIN}`, '/login'],
  ])('%s: %s is rewritten to the 404 page, never redirected (T-9-23)', async (host, path) => {
    const response = await proxy(request(host, path));

    expect(updateSession).not.toHaveBeenCalled();
    expect(isRewrite(response)).toBe(true);
    expect(new URL(getRewrittenUrl(response) as string).pathname).toBe('/__not_found');
    // A redirect would be a crawler-visible chain ending on the login form.
    expect(response.status).toBe(404);
    expect(response.headers.get('location')).toBeNull();
  });
});

describe('the console hosts keep their session gate (D-02)', () => {
  beforeEach(() => {
    updateSession.mockClear();
  });

  it.each([CONSOLE_HOST, 'localhost:3000', 'backdesk-abc123.vercel.app'])(
    '%s: / reaches the gate and is rewritten to the moved client list',
    async (host) => {
      await proxy(request(host, '/'));

      expect(updateSession).toHaveBeenCalledTimes(1);
      expect(updateSession.mock.calls[0][1]).toEqual({ rewriteTo: '/clients' });
    },
  );

  it.each([CONSOLE_HOST, 'localhost:3000'])(
    '%s: every other path reaches the gate with no rewrite',
    async (host) => {
      await proxy(request(host, '/inbox'));

      expect(updateSession).toHaveBeenCalledTimes(1);
      expect(updateSession.mock.calls[0][1]).toBeUndefined();
    },
  );

  /**
   * THE OTHER HALF OF WR-01: closing the apex hole must not close the door the
   * operator signs in through.
   *
   * `/login` now reaches `updateSession` on the console hosts, and it is
   * `PUBLIC_PATHS` — not the matcher — that keeps it open there. The gate's own
   * behaviour is asserted in the structural block below and in the console
   * suites; what this pins is that the routing half hands `/login` to the gate
   * with no rewrite, exactly like any other console path.
   */
  it.each([CONSOLE_HOST, 'localhost:3000'])(
    '%s: /login reaches the gate, which lets it through as a public path',
    async (host) => {
      await proxy(request(host, '/login'));

      expect(updateSession).toHaveBeenCalledTimes(1);
      expect(updateSession.mock.calls[0][1]).toBeUndefined();
    },
  );
});

/**
 * `/login` IS PUBLIC IN THE GATE, NOT IN THE MATCHER (WR-01).
 *
 * Read at source rather than exercised because `updateSession` needs a Supabase
 * environment this suite deliberately does not have. It is the load-bearing
 * half of the matcher change: drop `PUBLIC_PATHS` and the sign-in page
 * redirects to itself forever.
 */
describe('the login form stays reachable through PUBLIC_PATHS', () => {
  it('names /login as a public path in the session gate', () => {
    expect(SUPABASE_PROXY_SOURCE).toMatch(/PUBLIC_PATHS\s*=\s*\['\/login'\]/);
  });
});

/**
 * THE COOKIE/REWRITE DANCE, ASSERTED AT SOURCE.
 *
 * `updateSession` builds its response twice — once up front and once inside
 * Supabase's `setAll` callback, because only the response that is actually
 * returned carries the rotated cookies. Add a rewrite to the first and forget
 * the second and the operator is silently logged out whenever a refresh lands
 * on `/` (threat T-9-24). A behavioural test would need a live Supabase; this
 * pins the structure instead.
 */
describe('the rewrite survives the cookie rebuild (T-9-24)', () => {
  it('builds a rewrite response in both places, from the same target', () => {
    const rewrites = SUPABASE_PROXY_SOURCE.match(/NextResponse\.rewrite\(\s*(\w+)/g) ?? [];

    expect(rewrites).toHaveLength(2);
    // Both call sites name the SAME local, so a future edit cannot point the
    // rebuilt response at a different URL than the one that was chosen.
    expect(new Set(rewrites).size).toBe(1);
  });

  it('takes the rewrite target from an option rather than a hard-coded path', () => {
    expect(SUPABASE_PROXY_SOURCE).toMatch(/rewriteTo\?:\s*string/);
    expect(SUPABASE_PROXY_SOURCE).toMatch(/options\?\.rewriteTo/);
  });
});
