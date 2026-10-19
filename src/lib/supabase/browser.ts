import { createBrowserClient } from '@supabase/ssr';

import { getClientEnv } from '@/core/shared/env';

type BrowserClient = ReturnType<typeof createBrowserClient>;

let client: BrowserClient | undefined;

/**
 * Singleton browser client. One instance per tab keeps a single auth state and
 * one token-refresh timer — repeated construction races refreshes against each
 * other and can sign the operator out mid-session.
 */
export function createClient(): BrowserClient {
  if (client) return client;
  const env = getClientEnv();
  client = createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return client;
}
