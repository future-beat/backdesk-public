import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { getClientEnv } from '@/core/shared/env';

/** Routes reachable without a session. Everything else requires the operator. */
const PUBLIC_PATHS = ['/login'];

/**
 * Refresh the operator's session and gate protected routes.
 *
 * Two things must happen together on every request:
 *  1. Rotated cookies are written onto the REQUEST, so server components
 *     rendered downstream in this same pass see the fresh session.
 *  2. The same cookies are written onto the RESPONSE, so the browser keeps them.
 * Doing only one of the two produces intermittent, hard-to-reproduce logouts.
 *
 * Authorisation uses `getClaims()`, which verifies the JWT signature against the
 * project's public keys. `getSession()` is never trusted server-side — it reads
 * the cookie without verifying it, so a forged cookie would pass (threat T-02-03).
 *
 * `rewriteTo` (09-04) serves a DIFFERENT route under the requested URL once the
 * session has been settled — the app host's `/` renders the client list, which
 * now really lives at `/clients`. It is deliberately the LAST thing that
 * happens: an unauthenticated request still redirects to `/login` first, so the
 * rewrite can never be a way around the gate.
 *
 * THE REWRITE IS BUILT TWICE, ON PURPOSE. Supabase hands back rotated cookies
 * through `setAll`, which rebuilds the response so the fresh cookies are on the
 * object that is actually returned. Rebuilding it as a plain `next()` there
 * would silently drop the rewrite — the operator would get the landing-page
 * 404 at `/` — and rebuilding it as a rewrite while forgetting the cookies logs
 * them out at random (threat T-9-24). Both call sites therefore construct the
 * same shape from the same `target`, and `tests/proxy-host-routing.test.ts`
 * asserts at source that there are exactly two of them naming one variable.
 */
export async function updateSession(
  request: NextRequest,
  options?: { rewriteTo?: string },
): Promise<NextResponse> {
  const target = options?.rewriteTo ? new URL(options.rewriteTo, request.url) : null;
  let response = target
    ? NextResponse.rewrite(target, { request })
    : NextResponse.next({ request });
  const env = getClientEnv();

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          // The SAME shape as the initial response, from the same `target`.
          response = target
            ? NextResponse.rewrite(target, { request })
            : NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims);

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (!isAuthenticated && !isPublic) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = '';
    return NextResponse.redirect(loginUrl);
  }

  return response;
}
