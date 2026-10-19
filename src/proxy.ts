import { NextResponse, type NextRequest } from 'next/server';

import { APEX_DOMAIN } from '@/core/brand';
import { updateSession } from '@/lib/supabase/proxy';

/**
 * The hosts that serve the PUBLIC SITE and nothing else (D-01, D-02).
 *
 * A closed set of this project's own domains, compared by exact match — never a
 * suffix test, which `evil-backdesk.com.au` would pass.
 *
 * `apex.localhost` is the LOCAL STAND-IN so `next start` and Lighthouse can
 * reach the landing page while plain `localhost` stays the console — both halves
 * of the site in one dev session. RESEARCH §1 and the plan both wrote
 * `127.0.0.1` here; that cannot work, and the reason is measured rather than
 * argued: `NextURL` rewrites every loopback literal to `localhost`, so
 * `new NextRequest('http://127.0.0.1:3000/').nextUrl.hostname` is `'localhost'`
 * and the two hosts are indistinguishable inside this function. `.localhost`
 * subdomains resolve to loopback with no /etc/hosts entry (RFC 6761, honoured by
 * Chrome, Firefox, Safari and macOS' resolver) and survive that normalisation —
 * verified in tests/proxy-host-routing.test.ts, which pins both facts so nobody
 * "restores" the address from the research doc.
 *
 * `www` is listed even though Vercel 308s it to the apex before a request ever
 * arrives here — a redirect configured in a dashboard is not a fact this file
 * should depend on being true.
 */
const MARKETING_HOSTS = new Set([APEX_DOMAIN, `www.${APEX_DOMAIN}`, 'apex.localhost']);

/**
 * The host this request was actually addressed to.
 *
 * THE `host` HEADER, NOT `nextUrl.hostname`. RESEARCH §1 and the plan both read
 * the latter; it is the hostname of the URL Next built for the request, which
 * under `next start` is the address the server is BOUND to — so every host on
 * one machine reads back as `localhost` and the marketing branch is unreachable.
 * Measured, not assumed: with the plan's version, `apex.localhost:3100/inbox`
 * answered 307-to-login instead of 404. Next's own `getHostname` prefers the
 * header for exactly this reason.
 *
 * The port is dropped (`apex.localhost:3100` and `apex.localhost` are one host)
 * and the name lower-cased, because a header is free-form text: `Host` is
 * case-insensitive per RFC 7230 and `BACKDESK.COM.AU` must not slip past a
 * Set lookup. `nextUrl.hostname` remains the fallback for a synthesised request
 * that carries no header at all.
 */
function requestHostname(request: NextRequest): string {
  const header = request.headers.get('host');
  return (header ? header.split(':')[0] : request.nextUrl.hostname).toLowerCase();
}

/**
 * Next 16 renamed `middleware.ts` to `proxy.ts` and runs it on the Node runtime.
 * This is the first line of route protection; `(console)/layout.tsx` re-checks
 * independently so a matcher mistake cannot silently expose a PAGE.
 *
 * IT DOES NOT PROTECT SERVER ACTIONS (WR-01). Action IDs are global: an action
 * registered anywhere in the app can be invoked by POSTing its ID to any route,
 * including one this matcher never sees, and layouts render *after* the action
 * has already run. Every mutating action therefore authorizes its own caller —
 * see `src/app/(console)/clients/new/actions.ts`.
 *
 * HOST-AWARENESS, AND WHY IT IS NOT A SECURITY DECISION (09-04, threat T-9-01).
 * On Vercel the edge routes only this project's own domains to this function and
 * `x-forwarded-host` is identical to `host`, so a client cannot make a foreign
 * name arrive here. But the argument does not rest on that: the classification
 * below chooses between PUBLIC PAGES and THE AUTH WALL, never between allowed
 * and denied. Spoof the host perfectly and the prize is the login form — console
 * pages still gate on `getClaims()` in the console layout, and every mutating
 * action still calls `requireOperator()`. Nothing downstream reads the host.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (MARKETING_HOSTS.has(requestHostname(request))) {
    // The landing page, served WITHOUT asking Supabase anything. A stranger's
    // first request is the one measured by Lighthouse and the one most likely to
    // be a crawler; an auth round trip on it buys nothing (threat T-9-25).
    if (pathname === '/') return NextResponse.next();

    // Anything else that reaches this function on a public host is a console
    // path — the marketing routes are excluded by the matcher below and never
    // arrive. It answers 404, NOT a redirect to the console host: a redirect
    // would be a crawler-visible chain from the apex to a login form, which
    // publishes the console's address and makes the public site look like a
    // front for a signed-in app (threat T-9-23). `/__not_found` matches no
    // route, so `src/app/not-found.tsx` renders; the explicit status is
    // belt-and-braces over what an unmatched rewrite already returns.
    return NextResponse.rewrite(new URL('/__not_found', request.url), { status: 404 });
  }

  // The console hosts: app.backdesk.com.au, localhost, and every preview URL.
  // `/` still shows the client list, which since 09-04 really lives at
  // `/clients` — rewritten rather than redirected so the operator's bookmark,
  // the nav brand link and the post-login landing all keep working unchanged.
  return await updateSession(request, pathname === '/' ? { rewriteTo: '/clients' } : undefined);
}

export const config = {
  // /login IS MATCHED, and the exclusion it used to have is the WR-01 defect.
  //
  // The form still opens without a session — `PUBLIC_PATHS` in
  // `src/lib/supabase/proxy.ts` names `/login`, so `updateSession` settles the
  // cookies and returns the response instead of redirecting. Exempting the path
  // from the MATCHER was a stronger statement than that, and a wrong one: it
  // took the proxy off `/login` on EVERY host, so the `MARKETING_HOSTS` branch
  // above never saw it and `https://backdesk.com.au/login` answered the console
  // sign-in form with HTTP 200 while every other console path on the apex
  // 404'd (09-VERIFICATION gap T-9-23, measured live 2026-09-09).
  //
  // The cost of matching it is one `getClaims()` call on the login page, on the
  // console host only. The gain is that the apex has exactly one shape — the
  // landing page, the three public routes, and 404 for everything else — with
  // no path that has to be remembered as an exception.
  //
  // `api/` is excluded because API ROUTES ENFORCE THEIR OWN CREDENTIAL — a
  // timing-safe bearer secret for /api/internal/*, the ServiceM8 challenge
  // handshake for /api/webhooks/*. Without this exclusion the cron POST to
  // /api/internal/sync-tick is answered with a 307 to /login; `net.http_post`
  // treats that as a successful request, so `cron.job_run_details` reads
  // all-green while `sync_runs` stays empty and nothing ever syncs (RESEARCH
  // Pitfall 7). The exclusion is therefore only safe *because* each route under
  // it rejects unauthenticated callers itself — asserted in
  // tests/sync-tick-route.test.ts.
  //
  // THE PUBLIC SITE (Phase 9, D-02). `/audit`, `/audit/thanks`, `/privacy`,
  // `/brand/*`, `/robots.txt` and `/sitemap.xml` are excluded because they are
  // public by definition — a prospect who has never heard of us cannot be asked
  // to sign in to ask for an audit.
  //
  // ANCHORED, and the anchors are doing real work: an unanchored `audit` would
  // prefix-match `/audits` and `/audits/requests` and silently take the proxy
  // off the CONSOLE's audit pages. `audit$|audit/` excludes `/audit` and
  // `/audit/thanks` and nothing else; tests/proxy-host-routing.test.ts asserts
  // both directions.
  //
  // Server Functions POST to the PAGE ROUTE, so excluding `/audit` also skips
  // the proxy for the form's own action. That is correct rather than an
  // oversight: the action is deliberately session-less (it is the public
  // intake) and self-protects with validation, and from 09-03 a honeypot and a
  // per-IP throttle — the same WR-01 rule the header states, applied to the one
  // action whose caller is meant to be a stranger.
  // THE TWO ROOT ICONS, and `apple-touch-icon.png` is the one that had to be
  // added (19 Sep 2026). `/favicon.ico` was excluded from the beginning; its
  // twin was not, because until now neither file existed. Without the
  // exclusion the console host answers a 307 to /login for an icon request and
  // the apex rewrites it to 404 — on BOTH hosts the well-known address stays
  // broken, which is the entire defect the root copies exist to fix. Anchored
  // with `$` so nothing under a same-named directory is exempted by accident;
  // `favicon.ico` keeps its long-standing unanchored form rather than being
  // tightened in a task about icons.
  //
  // ONE STRING, and it must stay one string: three route suites parse this with
  // /matcher:\s*\['([^']+)'\]/ and throw if it is not (RESEARCH Pitfall 2).
  // prettier-ignore
  matcher: ['/((?!_next/static|_next/image|favicon.ico|apple-touch-icon.png$|api/|audit$|audit/|privacy$|guides/|brand/|robots.txt$|sitemap.xml$).*)'],
};
