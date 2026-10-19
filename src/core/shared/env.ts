/**
 * Validated environment access.
 *
 * `src/core` is framework-free by contract — nothing here imports from `next/*`.
 *
 * The server/client split is the enforcement point for threat T-02-02: the
 * service-role key and database URLs are only ever read through `getServerEnv()`,
 * which throws if it is ever reached from browser code.
 */
import { z } from 'zod';

/**
 * THE SHAPE OF THE TWO TWILIO ROUTE TOKENS (WR-04): exactly 64 lower-case hex
 * characters, the output of `openssl rand -hex 32` they were generated with.
 *
 * The token sits INSIDE the URL Twilio signs, so it must survive a URL round
 * trip byte-for-byte. A value with `+`, `&`, `#`, `%`, `=` or a space (say from
 * `openssl rand -base64 48`) would pass a length check and then fail every
 * real call — `searchParams.get` decodes `+` to a space, and `&` or `#`
 * truncate it — showing up only on the first live call after a rotation.
 */
export const TWILIO_ROUTE_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

const serverEnvSchema = z.object({
  // Bypasses RLS by design. Server-only, never NEXT_PUBLIC.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  // Runtime queries — transaction pooler, port 6543.
  DATABASE_URL: z.string().min(1),
  // Migrations only — session/direct connection, port 5432. Absent at runtime
  // (and in production) is fine; only drizzle-kit needs it.
  MIGRATE_DATABASE_URL: z.string().min(1).optional(),
  // AES-256-GCM key for client API-key encryption at rest (ONB-02, T-2-01).
  // Validated for DECODED length, not string length: a 32-character base64
  // string decodes to 24 bytes and createCipheriv would reject it at the worst
  // possible moment — mid-connect, with a real client's key in hand.
  CREDENTIALS_ENCRYPTION_KEY: z
    .string()
    .min(1)
    .refine((v) => Buffer.from(v, 'base64').length === 32, {
      message: 'must be base64 that decodes to exactly 32 bytes (openssl rand -base64 32)',
    }),
  // Shared secret for the pg_cron → sync-tick route (consumed by plan 02-03).
  // Added here now so this file is edited once per wave rather than once per
  // plan — three plans racing edits to the same schema object is a merge
  // conflict with secrets in it.
  SYNC_TICK_SECRET: z.string().min(32),
  // Shared secret for the pg_cron → cadence-tick route (plan 03-06).
  //
  // A SECOND secret rather than a reuse of SYNC_TICK_SECRET, deliberately. The
  // two ticks are separate cron jobs precisely so a slow ServiceM8 sync can
  // never delay a send; sharing a bearer would re-couple them at the one moment
  // the separation matters most — rotation. Rotating a shared secret 401s BOTH
  // ticks until the redeploy lands, which means no client is synced AND no
  // customer is contacted. Two secrets means a rotation can only ever break the
  // half it names.
  CADENCE_TICK_SECRET: z.string().min(32),

  // --- Messaging gateway (Phase 4) -----------------------------------------
  //
  // FOUR SECRETS, NOT ONE, AND THE ARGUMENT IS THE ONE CADENCE_TICK_SECRET
  // MAKES — extended from two endpoints to six. Each webhook receiver and each
  // internal tick gets its OWN bearer, because the only time a shared secret is
  // observably different from separate ones is ROTATION, and that is precisely
  // the moment the blast radius matters. Rotating a shared value 401s EVERY
  // endpoint that reads it until the redeploy lands: inbound replies rejected
  // (so a customer's STOP is dropped at the door), delivery receipts rejected,
  // unsubscribe links broken, and the reconcile tick dead — all four at once,
  // from one rotation. Four secrets means a rotation can only ever break the
  // one endpoint it names.
  //
  // Declared together in ONE pass (plan 04-01) rather than one per plan, for the
  // reason SYNC_TICK_SECRET gives above: several plans racing edits to the same
  // schema object is a merge conflict with secrets in it.
  //
  // ALL REQUIRED. An optional webhook secret degrades "the inbound endpoint is
  // authenticated" into "the inbound endpoint is authenticated, unless nobody
  // configured it" — which is an unauthenticated public endpoint that accepts
  // forged STOPs and forged replies, wearing the same code path as the safe one.
  /**
   * Shared secret for the ClickSend inbound-SMS callback (plan 04-02, live at
   * `POST /api/webhooks/clicksend/inbound`).
   *
   * A URL QUERY TOKEN, NOT A BEARER HEADER, and the difference is operational:
   * ClickSend's inbound rules POST to a URL we configure and offer no way to
   * set an `Authorization` header, so the secret travels as `?token=…`. It is
   * therefore visible in access logs at every hop, which is exactly why it is
   * its own value — a leak grants the powers of that one endpoint (suppress,
   * stop, pause, record) and rotating it 401s nothing else.
   */
  CLICKSEND_WEBHOOK_SECRET: z.string().min(32),
  /**
   * Secret for the ClickSend delivery-receipt callback (plan 04-04).
   *
   * A URL QUERY TOKEN, NOT A BEARER HEADER, for exactly the reason the inbound
   * secret above is one: ClickSend's callback rules POST to a URL we configure
   * and offer no way to set request headers. The rule's callback URL must
   * therefore be `…/api/webhooks/clicksend/dlr?token=<this value>`; configured
   * without it, every real delivery receipt 401s silently and the delivery
   * columns simply stay NULL.
   *
   * ITS OWN VALUE, never the inbound one. Rotating a token that travels in
   * access logs must 401 one endpoint, and a receipt callback and a customer
   * reply callback grant very different powers.
   */
  CLICKSEND_DLR_SECRET: z.string().min(32),
  /**
   * HMAC key for one-click unsubscribe links (plan 04-05). NOT a bearer: it
   * signs a URL a customer clicks, so it must never be one of the values above —
   * a signing key travels inside links in customers' inboxes, and a bearer that
   * had done that would be a bearer a customer holds.
   */
  UNSUBSCRIBE_SIGNING_SECRET: z.string().min(32),
  /** Bearer for the pg_cron → messaging reconcile tick (plan 04-04). */
  MESSAGING_RECONCILE_SECRET: z.string().min(32),

  // --- Review console (Phase 6) ---------------------------------------------
  /**
   * Bearer for the pg_cron → stalled-draft digest (plan 06-02, CON-04), which
   * POSTs `/api/internal/stalled-digest` at 06:30 Australia/Perth.
   *
   * ITS OWN VALUE — the sixth, and the four-bearers argument above extended by
   * one endpoint rather than reasoned about again. This one differs from its
   * neighbours in a way worth naming: it EMAILS THE OPERATOR. A shared bearer
   * would mean rotating the cadence tick's secret also silences the digest that
   * tells the operator drafts are piling up — the two failures compounding
   * exactly when someone needs the second one to notice the first.
   *
   * REQUIRED, like every other bearer here, for the reason the Phase 4 block
   * gives: an optional secret degrades "this endpoint is authenticated" into
   * "authenticated, unless nobody configured it", which is a public endpoint
   * that will mail the operator on demand, wearing the safe path's clothes.
   */
  STALLED_DIGEST_SECRET: z.string().min(32),

  // --- ClickSend account (Phase 4) -----------------------------------------
  //
  // OPTIONAL, unlike the four above, and the asymmetry is D-08's
  // number-independent sequencing made structural. The AU dedicated number is
  // blocked on an IPND-acceptable business address (see STATE.md), which is a
  // paperwork dependency with no engineering answer — so every sender falls back
  // to the stub while these are absent, and the whole cadence pipeline stays
  // buildable and testable end-to-end without them. Making them required would
  // put a regulator's postal requirement on the critical path of `npm test`.
  CLICKSEND_USERNAME: z.string().min(1).optional(),
  CLICKSEND_API_KEY: z.string().min(1).optional(),

  // --- Anthropic (Phase 5) --------------------------------------------------
  //
  // OPTIONAL, following the ClickSend precedent directly above, and for a
  // sharper version of the same reason. This key is an EXTERNAL PAPERWORK
  // DEPENDENCY — an account, a billing method, a key somebody pastes — and
  // making it required would put all three on the critical path of `npm test`.
  // Every pure suite in this repository would then fail on a machine that has
  // never drafted anything, including CI.
  //
  // The behaviour when it is ABSENT is the load-bearing half, and it is D-10:
  // `buildAnthropicClient()` returns null, the drafting pass counts
  // `drafting_unconfigured` and LEAVES THE TOUCH IN `needs_draft`. It does not
  // throw, and it emphatically does not fall back to sending a merge-filled
  // template — an unconfigured key must look like "nothing was drafted yet",
  // which is recoverable by pasting a key, rather than like "something was sent
  // that no model wrote and no human approved", which is not recoverable at all.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),

  // --- Operator alerting (SYNC-04, D-05) -----------------------------------
  //
  // REQUIRED, not optional, and that is the point. The phase success criterion
  // this pair serves is "no silent dead client": a revoked ServiceM8 key must
  // reach the operator's inbox within one tick. An OPTIONAL alert credential
  // degrades that guarantee into "no silent dead client, unless the alert
  // channel was also silently unconfigured" — which is the same failure with
  // an extra layer of nobody noticing. A missing key fails loudly at boot.
  RESEND_API_KEY: z.string().min(1),
  // Validated as an address rather than a non-empty string: a typo'd value here
  // produces an alert that is accepted by our code and rejected by Resend, at
  // the one moment the alert matters.
  OPERATOR_ALERT_EMAIL: z.email(),
  // The alert sender. OPTIONAL with a default (see operator-email.ts): before a
  // domain is verified, Resend only permits its own onboarding sender, and only
  // to the account owner's address (RESEARCH A6). Once Phase 4 verifies a
  // service-owned domain, this becomes a config change rather than a code
  // change — the value it holds is a fact about the Resend account, not about
  // this program.
  OPERATOR_ALERT_FROM: z.string().min(1).optional(),

  // --- Public audit intake (Phase 9, LAND-03 / D-12, D-13) -----------------
  //
  // REQUIRED, both of them, and for the same class of reason the alert pair
  // above is. The phase guarantee is "every audit request reaches the operator
  // and no request is lost"; an optional notification number degrades that into
  // "reaches the operator, unless the number was silently unset", which is the
  // same failure with an extra layer of nobody noticing.
  //
  // THE OPERATOR'S OWN HANDSET, NEVER A CUSTOMER OR A TRADIE. The regex is the
  // narrowest thing that can be checked here: an AU number in E.164. It cannot
  // check WHOSE number it is, which is why `sendOperatorSms` reads this
  // variable directly and takes no recipient argument at all — there is no
  // parameter through which a form value could become a recipient (T-9-07).
  OPERATOR_ALERT_PHONE: z.string().regex(/^\+61\d{9}$/),
  // The per-IP throttle keys on `sha256(salt:ip)` and the raw address is never
  // stored (T-9-05). A salt is what makes that hash non-reversible: the IPv4
  // space is small enough to enumerate in seconds, so an unsalted hash of an
  // address is the address. 32 characters is the floor; `openssl rand -hex 32`
  // is the shape the value should have.
  AUDIT_IP_HASH_SALT: z.string().min(32),
  // The key of the HMAC that replaces a caller's number ninety days after
  // their lead closes without converting (Phase 15, COMP-02 / D-06; read by
  // `src/core/leads/pseudonym.ts` as an ARGUMENT, never by that module itself).
  // A KEYED hash rather than a salted digest because the Australian mobile
  // space is about 10^8 values: with a public or stored salt the hash would be
  // the number. 32 characters is the floor; `openssl rand -hex 32` is the
  // shape. REQUIRED rather than optional-with-skip because a retention promise
  // that silently does not run is worse than a loud deploy failure. Rotating
  // it changes every future hash (repeat-caller identity breaks across the
  // rotation), so a rotation is a recorded decision, never a routine.
  CALLER_PSEUDONYM_PEPPER: z.string().min(32),

  // --- Telephony capture (Phase 11, CAP-01..05) ----------------------------
  //
  // FOUR REQUIRED KEYS, AND ONLY TWO OF THEM ARE BEARERS. The four-bearer
  // argument the Phase 4 block makes is restated rather than re-derived: each
  // endpoint gets its OWN value, because the only moment a shared secret is
  // observably different from separate ones is ROTATION, and that is exactly
  // when the blast radius matters.
  //
  //   TWILIO_VOICE_WEBHOOK_SECRET        — the `voice` route's URL query token.
  //   TWILIO_VOICE_STATUS_WEBHOOK_SECRET — the `voice-status` route's URL query
  //     token. Its OWN value: rotating the call-arrival door must 401 that door
  //     alone, and the two routes grant different powers (an arrival writes a
  //     row and answers a live call; a status callback completes one).
  //   TWILIO_AUTH_TOKEN — NOT A BEARER. It is the SIGNING KEY Twilio's
  //     `X-Twilio-Signature` is computed with, shared by both routes, and it is
  //     in the UNSUBSCRIBE_SIGNING_SECRET category above: it verifies a
  //     signature over the canonical URL (token included) and the form params,
  //     and nothing presents it as a credential. It is also the REST client's
  //     password, which is why it lives beside the account SID.
  //   TWILIO_ACCOUNT_SID — the account the numbers live in (AC + 32 hex).
  //
  // ALL FOUR REQUIRED, for the reason every webhook secret here is: an optional
  // token degrades "the voice door is authenticated" into "authenticated, unless
  // nobody configured it" — an unauthenticated public endpoint that writes
  // `missed_calls` rows, wearing the safe path's clothes. And without the auth
  // token a signature cannot be checked at all.
  TWILIO_ACCOUNT_SID: z.string().regex(/^AC[0-9a-f]{32}$/),
  TWILIO_AUTH_TOKEN: z.string().min(32),
  // URL-SAFE HEX, NOT MERELY 32+ CHARACTERS (WR-04) — see the pattern above.
  TWILIO_VOICE_WEBHOOK_SECRET: z.string().regex(TWILIO_ROUTE_TOKEN_PATTERN),
  TWILIO_VOICE_STATUS_WEBHOOK_SECRET: z.string().regex(TWILIO_ROUTE_TOKEN_PATTERN),
  // OPTIONAL — facts about the Twilio account that exist only once the AU
  // regulatory bundle is approved (D-12). Provisioning (plan 11-04) refuses to
  // buy a number while either SID is absent; nothing else reads them, so making
  // them required would put a regulator's review queue on the critical path of
  // `npm test`, the ClickSend-account precedent below.
  TWILIO_AU_BUNDLE_SID: z.string().regex(/^BU[0-9a-f]{32}$/).optional(),
  TWILIO_AU_ADDRESS_SID: z.string().regex(/^AD[0-9a-f]{32}$/).optional(),
  // OPTIONAL. A TwiML Bin holding the GENERIC greeting, passed as the number's
  // `voiceFallbackUrl` at purchase so a Vercel outage still plays something.
  TWILIO_VOICE_FALLBACK_URL: z.url().optional(),

  // --- Console origin -------------------------------------------------------
  //
  // Used to build the client-detail link inside an alert email. An alert that
  // names a broken client without saying where to fix it makes the operator
  // hunt for the page while follow-ups stay paused.
  //
  // OPTIONAL, with a documented fallback chain (see operator-email.ts):
  // APP_BASE_URL → VERCEL_PROJECT_PRODUCTION_URL → localhost. Making it
  // required would break every existing `getServerEnv()` caller — the
  // repository client, connect, the sync cycle — for a value that only one
  // email body needs.
  //
  // PHASE 4 GIVES IT A SECOND CONSUMER: the unsubscribe-link base (plan 04-05).
  // It was already declared here by 02-04, so Phase 4 adds SIX keys rather than
  // the seven its plan counted — recorded because the fallback chain below is
  // now load-bearing for something a CUSTOMER clicks, not only for a link the
  // operator reads. A wrong base still produces a working alert email; it
  // produces a BROKEN opt-out, which is a Spam Act problem. Set it explicitly in
  // production rather than relying on the Vercel fallback.
  APP_BASE_URL: z.url().optional(),
  // Injected by Vercel; the stable PRODUCTION domain, deliberately not
  // `VERCEL_URL`, which is unique per deployment and 404s once that deployment
  // is superseded. An alert email outlives the deployment that sent it.
  VERCEL_PROJECT_PRODUCTION_URL: z.string().min(1).optional(),
});

const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type ClientEnv = z.infer<typeof clientEnvSchema>;

/** Turn a zod failure into a message that names the offending variables. */
function describe(error: z.ZodError, scope: string): string {
  const details = error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  return `Invalid ${scope} environment.\n${details}\n\nSee docs/env-vars.md for the full contract.`;
}

let serverEnvCache: ServerEnv | undefined;

/**
 * Server-only environment. Parsed lazily so that merely importing this module
 * from a shared file never crashes a browser bundle or a build that has no
 * secrets available.
 */
export function getServerEnv(): ServerEnv {
  if (typeof window !== 'undefined') {
    throw new Error(
      'getServerEnv() was called in the browser. Server secrets must never reach client code.',
    );
  }
  if (serverEnvCache) return serverEnvCache;

  const parsed = serverEnvSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    DATABASE_URL: process.env.DATABASE_URL,
    MIGRATE_DATABASE_URL: process.env.MIGRATE_DATABASE_URL,
    CREDENTIALS_ENCRYPTION_KEY: process.env.CREDENTIALS_ENCRYPTION_KEY,
    SYNC_TICK_SECRET: process.env.SYNC_TICK_SECRET,
    CADENCE_TICK_SECRET: process.env.CADENCE_TICK_SECRET,
    // Phase 4. EVERY key added to the schema above must also appear here — the
    // pick-list is explicit (rather than `process.env` wholesale) so a browser
    // bundle can never inline the environment, and the cost of that is that a
    // key present in one list and absent from the other validates as
    // `undefined` and fails at the first use instead of at boot.
    CLICKSEND_WEBHOOK_SECRET: process.env.CLICKSEND_WEBHOOK_SECRET,
    CLICKSEND_DLR_SECRET: process.env.CLICKSEND_DLR_SECRET,
    UNSUBSCRIBE_SIGNING_SECRET: process.env.UNSUBSCRIBE_SIGNING_SECRET,
    MESSAGING_RECONCILE_SECRET: process.env.MESSAGING_RECONCILE_SECRET,
    // Phase 6 (06-02). Same rule as the Phase 4 note above: a key in the schema
    // and absent from this pick-list validates as `undefined` and fails at first
    // use instead of at boot.
    STALLED_DIGEST_SECRET: process.env.STALLED_DIGEST_SECRET,
    CLICKSEND_USERNAME: process.env.CLICKSEND_USERNAME,
    CLICKSEND_API_KEY: process.env.CLICKSEND_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    OPERATOR_ALERT_EMAIL: process.env.OPERATOR_ALERT_EMAIL,
    OPERATOR_ALERT_FROM: process.env.OPERATOR_ALERT_FROM,
    // Phase 9 (09-01). Same rule as the Phase 4 and Phase 6 notes above: a key
    // in the schema and absent from this pick-list validates as `undefined` and
    // fails at first use instead of at boot.
    OPERATOR_ALERT_PHONE: process.env.OPERATOR_ALERT_PHONE,
    AUDIT_IP_HASH_SALT: process.env.AUDIT_IP_HASH_SALT,
    // Phase 15 (15-02). Same rule as the notes above: a key in the schema and
    // absent from this pick-list validates as `undefined` and fails at first
    // use instead of at boot.
    CALLER_PSEUDONYM_PEPPER: process.env.CALLER_PSEUDONYM_PEPPER,
    // Phase 11 (11-01). Same rule as the Phase 4, 6 and 9 notes above: a key in
    // the schema and absent from this pick-list validates as `undefined` and
    // fails at first use instead of at boot.
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
    TWILIO_VOICE_WEBHOOK_SECRET: process.env.TWILIO_VOICE_WEBHOOK_SECRET,
    TWILIO_VOICE_STATUS_WEBHOOK_SECRET: process.env.TWILIO_VOICE_STATUS_WEBHOOK_SECRET,
    TWILIO_AU_BUNDLE_SID: process.env.TWILIO_AU_BUNDLE_SID,
    TWILIO_AU_ADDRESS_SID: process.env.TWILIO_AU_ADDRESS_SID,
    TWILIO_VOICE_FALLBACK_URL: process.env.TWILIO_VOICE_FALLBACK_URL,
    APP_BASE_URL: process.env.APP_BASE_URL,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
  });
  if (!parsed.success) throw new Error(describe(parsed.error, 'server'));

  serverEnvCache = parsed.data;
  return serverEnvCache;
}

let clientEnvCache: ClientEnv | undefined;

/**
 * Public environment, safe on both sides of the boundary.
 *
 * The `process.env.NEXT_PUBLIC_*` references are written out in full so Next
 * can statically inline them into the client bundle — destructuring or dynamic
 * lookup would leave them `undefined` in the browser.
 */
export function getClientEnv(): ClientEnv {
  if (clientEnvCache) return clientEnvCache;

  const parsed = clientEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  if (!parsed.success) throw new Error(describe(parsed.error, 'client'));

  clientEnvCache = parsed.data;
  return clientEnvCache;
}
