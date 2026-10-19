/**
 * THE ONE BUILDER FOR THE URLS TWILIO POSTS TO (Phase 11, D-05).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ BOTH SIDES OF THE SIGNATURE READ THIS FUNCTION. Provisioning (11-04)     │
 * │ writes its output onto the number as the Voice URL / Status Callback,    │
 * │ and the two routes rebuild the SAME string to verify X-Twilio-Signature. │
 * │ Twilio signs the exact URL it was configured with, query string and      │
 * │ all, so two builders that disagree by one byte — a trailing slash, an    │
 * │ encoded character, a different host — fail every real call's signature  │
 * │ while Twilio's own debugger shows 200s.                                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── NEVER FROM THE REQUEST ──────────────────────────────────────────────────
 *
 * The incoming request's own URL and host headers are what Vercel's proxy and
 * any alias rewrite; the signed URL is the one written onto the number. So the
 * canonical URL is built from CONFIGURATION — `APP_BASE_URL` — and from nothing
 * the caller controls.
 *
 * ── FAIL CLOSED WHEN `APP_BASE_URL` IS UNSET ────────────────────────────────
 *
 * `APP_BASE_URL` is optional in the env schema, and the console's alert-email
 * origin resolver falls back to Vercel's injected production domain when it is
 * absent — which is Vercel's choice of domain, and can be the marketing apex
 * rather than the console host. That fallback is deliberately NOT inherited
 * here: a number wired to the wrong host answers every call with somebody
 * else's bytes. `null` means "there is no canonical URL"; the routes treat it
 * as a failed signature (generic greeting, no write, a fixed log line) and
 * provisioning refuses to buy.
 *
 * ── THE TOKEN IS HEX BY SCHEMA, AND ENCODED ANYWAY (WR-04) ──────────────────
 *
 * Each route's secret is 64 lower-case hex characters (`openssl rand -hex 32`),
 * and the env schema now REFUSES anything else (`TWILIO_ROUTE_TOKEN_PATTERN`),
 * so `encodeURIComponent` is a no-op on every value that can reach this
 * function and the string provisioning writes and the string the route rebuilds
 * stay byte-identical. It is applied anyway, at the one place the token enters
 * a URL: if the schema is ever loosened, a `+`, `&` or `#` is encoded into a
 * value that `searchParams.get('token')` decodes back to the secret, instead of
 * a URL that truncates or alters it and 401s every real call.
 *
 * Framework-free and pure: the caller hands in the env slice, so the tests can
 * pin the exact output without mocking a module.
 */
import type { ServerEnv } from '@/core/shared/env';

/** The two Twilio doors, by path. No trailing slash on either — see above. */
export const TWILIO_WEBHOOK_ROUTES = {
  voice: '/api/webhooks/twilio/voice',
  'voice-status': '/api/webhooks/twilio/voice-status',
} as const;

export type TwilioWebhookRoute = keyof typeof TWILIO_WEBHOOK_ROUTES;

/** Exactly what the builder reads, and nothing else. */
export type TwilioWebhookEnv = Pick<
  ServerEnv,
  'APP_BASE_URL' | 'TWILIO_VOICE_WEBHOOK_SECRET' | 'TWILIO_VOICE_STATUS_WEBHOOK_SECRET'
>;

/**
 * The canonical, signed URL for one route: `${APP_BASE_URL}${path}?token=${the
 * route's OWN secret}` — or `null` when `APP_BASE_URL` is unset (FAIL CLOSED).
 *
 * Each route gets its own secret (the four-bearer rule): the voice URL carries
 * `TWILIO_VOICE_WEBHOOK_SECRET`, the status URL `TWILIO_VOICE_STATUS_WEBHOOK_SECRET`.
 */
export function twilioWebhookUrl(route: TwilioWebhookRoute, env: TwilioWebhookEnv): string | null {
  const base = env.APP_BASE_URL;
  if (!base) return null;

  const token =
    route === 'voice' ? env.TWILIO_VOICE_WEBHOOK_SECRET : env.TWILIO_VOICE_STATUS_WEBHOOK_SECRET;

  return `${base.replace(/\/+$/, '')}${TWILIO_WEBHOOK_ROUTES[route]}?token=${encodeURIComponent(token)}`;
}

/**
 * The host the numbers point at, or `null` when `APP_BASE_URL` is unset.
 * Provisioning (11-04) asserts it equals the console host before any purchase,
 * so a preview-deployment or apex value can never be written onto a live number.
 */
export function twilioWebhookHost(env: Pick<ServerEnv, 'APP_BASE_URL'>): string | null {
  const base = env.APP_BASE_URL;
  if (!base) return null;
  return new URL(base).host;
}
