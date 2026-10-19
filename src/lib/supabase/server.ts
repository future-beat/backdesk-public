import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { getClientEnv } from '@/core/shared/env';

/**
 * Per-request Supabase client for server components, server actions and route
 * handlers.
 *
 * Deliberately built on the ANON key plus the operator's cookie session, never
 * the service-role key: that is what makes every console read and write pass
 * through RLS, so the policies are exercised continuously instead of rotting
 * unverified (01-RESEARCH.md Pitfall 5, threat T-02-01).
 *
 * `cookies()` is async-only in Next 16, so this factory must be awaited.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const env = getClientEnv();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. This is safe to swallow only
          // because proxy.ts refreshes the session on every request, so the
          // browser still receives rotated tokens.
        }
      },
    },
  });
}
