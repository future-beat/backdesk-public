/**
 * Vitest setup: load test environment before any suite runs.
 *
 * Prefers .env.test so a developer can point tests at a throwaway project
 * without disturbing their console setup; falls back to .env.local.
 *
 * Uses Node's built-in loadEnvFile rather than adding a dotenv dependency —
 * unaudited packages are not installed in this repo. Verified behaviour:
 * variables already present in process.env are NOT overwritten, so
 * CI-provided secrets always win over whatever is on disk.
 */
import { existsSync } from 'node:fs';

const CANDIDATES = ['.env.test', '.env.local'];

const chosen = CANDIDATES.find((f) => existsSync(f));
if (chosen) {
  process.loadEnvFile(chosen);
}

const REQUIRED = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  // Runtime queries — the transaction pooler the repository layer connects on.
  // Required since 01-04: tests/leak.test.ts exercises forTenant() for real.
  'DATABASE_URL',
  // Session/direct connection — tests/rls-coverage.test.ts reads pg_tables,
  // which PostgREST cannot reach.
  'MIGRATE_DATABASE_URL',
  'OPERATOR_EMAIL',
  'OPERATOR_PASSWORD',
  // Required since 02-04: these are REQUIRED members of serverEnvSchema, so any
  // suite that reaches getServerEnv() — which is every suite that touches the
  // repository — fails without them. Listing them here turns a zod report
  // thrown from three layers down into one message that names the file to fix.
  //
  // No email is ever sent from a test: tests/sync-failure-alerts.test.ts
  // injects an onAlert spy, so the send path is never reached.
  'RESEND_API_KEY',
  'OPERATOR_ALERT_EMAIL',
  // Also REQUIRED members of serverEnvSchema (02-01/02-03): the encryption key
  // must be base64 decoding to exactly 32 bytes, the tick secret 32+ chars.
  // Without them, every suite that reaches getServerEnv() fails three layers
  // down (CI run 33056697214 — 31 failures); with them here, one message.
  'CREDENTIALS_ENCRYPTION_KEY',
  'SYNC_TICK_SECRET',
  // Also a REQUIRED member of serverEnvSchema (03-06), for the same reason and
  // with the same failure mode: it is a second, independently-rotating bearer
  // for the per-minute cadence tick, so nothing here can fall back to
  // SYNC_TICK_SECRET on its behalf.
  'CADENCE_TICK_SECRET',
  // The four Phase 4 bearers (04-01). REQUIRED members of serverEnvSchema for
  // the reason that file gives — an optional webhook secret is an
  // unauthenticated public endpoint wearing the safe code path's clothes — so
  // every suite that reaches getServerEnv() fails without them, which is every
  // suite that touches the repository. Listed here so that failure is ONE
  // message naming the file to fix rather than a zod report from three layers
  // down, exactly as 02-01/02-03/03-06 did for their own secrets.
  //
  // No suite ever calls ClickSend: the senders take a TouchSender and the tests
  // inject a stub, so these are dummies in CI and real values only on a machine
  // that actually sends.
  'CLICKSEND_WEBHOOK_SECRET',
  'CLICKSEND_DLR_SECRET',
  'UNSUBSCRIBE_SIGNING_SECRET',
  'MESSAGING_RECONCILE_SECRET',
  // The sixth bearer (06-02, CON-04): the nightly stalled-draft digest. A
  // REQUIRED member of serverEnvSchema for the same reason as the four above,
  // with the same failure mode — every suite reaching getServerEnv() fails
  // without it. Listed here so that failure is ONE message naming the file to
  // fix. No suite ever mails anything: the digest runner takes an injected
  // sender and the tests pass a spy.
  'STALLED_DIGEST_SECRET',
  // The Phase 9 public-intake pair (09-01). REQUIRED members of serverEnvSchema
  // for the reason env.ts gives, with the same failure mode as every secret
  // above: every suite that reaches getServerEnv() fails without them, which is
  // every suite that touches the repository. Listed here so that failure is ONE
  // message naming the file to fix rather than a zod report from three layers
  // down.
  //
  // NO SUITE EVER TEXTS ANYONE: tests/audit-request-notify.test.ts mocks
  // `sendSms`, so the ClickSend path is never reached and the number here is a
  // dummy in CI and the founder's own handset only on the machine that actually
  // sends. The salt is a dummy too — nothing in a test verifies a hash against
  // production.
  'OPERATOR_ALERT_PHONE',
  'AUDIT_IP_HASH_SALT',
  // The caller pseudonymisation pepper (2026-10, Phase 15, 15-02). A REQUIRED
  // member of serverEnvSchema for the salt's reason — a retention promise that
  // silently does not run is worse than a loud failure — and the retention
  // pass reads it through the messaging-reconcile route. A dummy in CI: no
  // suite compares a hash to one produced in production.
  'CALLER_PSEUDONYM_PEPPER',
  // The Phase 11 telephony quartet (11-01). REQUIRED members of serverEnvSchema
  // for the reason env.ts gives — an optional webhook token is an
  // unauthenticated public endpoint wearing the safe path's clothes, and
  // without the auth token no signature can be checked — so every suite that
  // reaches getServerEnv() fails without them, which is every suite that
  // touches the repository. Listed here so that failure is ONE message naming
  // the file to fix, exactly as the Phase 4 bearers are.
  //
  // NO SUITE EVER CALLS TWILIO: the route suites sign their own fixtures with
  // node:crypto and mock the repository, so these are dummies in CI (the SID
  // shaped to satisfy its regex) and real values only on a machine that
  // actually provisions or answers a call.
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_VOICE_WEBHOOK_SECRET',
  'TWILIO_VOICE_STATUS_WEBHOOK_SECRET',
];

/**
 * WR-09: refuse to run destructively against a stack that is not disposable.
 *
 * `.env.test` does not exist in this repo, so a bare `npm test` fell through to
 * `.env.local` — which points at the hosted Sydney project. These suites then
 * create auth users, insert tenants, UPDATE a tenant's status and DELETE rows
 * using the SERVICE-ROLE key, in production. Cleanup is afterAll-only, so a
 * Ctrl-C, a timeout, or a throwing beforeAll leaves seeded tenants and
 * membership rows behind, where the operator sees them in the console.
 *
 * The opt-in is deliberately an environment variable rather than a file: this
 * machine has no Docker, so running against the hosted project is a legitimate
 * and routine workflow — it just has to be a DECISION each time rather than the
 * default. `npm run test:remote` is the sanctioned way to say yes.
 */
/** Exported for tests/helpers/global-setup.ts, which must make the same local-or-remote call. */
export const LOCAL_HOST_PATTERN = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i;

interface ResolvedTestEnv {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  databaseUrl: string;
  migrateDatabaseUrl: string;
  operatorEmail: string;
  operatorPassword: string;
}

let resolved: ResolvedTestEnv | undefined;

/**
 * THE GATE FIRES ON CREDENTIAL ACCESS, NOT ON FILE LOAD, AND THAT IS THE WHOLE
 * POINT OF THE INDIRECTION BELOW.
 *
 * This module is the vitest `setupFiles` entry, so it is evaluated once per
 * TEST FILE — including the 23 suites that touch no database at all (pure
 * date math, state transitions, normalization, lint tripwires). While the
 * missing-variable check and the WR-09 disposable-stack refusal ran at module
 * scope, those pure suites could not run without `ALLOW_REMOTE_TESTS=yes` —
 * so proving a pure function required asserting out loud that production data
 * was fair game. `npm test` was, in practice, not runnable at all.
 *
 * Deferring both checks to the first read of a real credential keeps the
 * guarantee exactly as strong and moves it to where it belongs: a suite that
 * reaches for `testEnv` is a suite that is about to open a connection, and
 * every such read happens at that suite's module scope (or inside
 * `helpers/seed.ts`, which every destructive suite imports). A pure suite
 * never touches this object, so it never trips the gate — and a DB suite trips
 * it before its first `beforeAll`, exactly as before.
 */
function resolveTestEnv(): ResolvedTestEnv {
  if (resolved) return resolved;

  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Integration tests need these environment variables: ${missing.join(', ')}.\n` +
        `Checked ${CANDIDATES.join(' then ')} (found: ${chosen ?? 'neither'}).\n` +
        'See docs/env-vars.md for the contract.',
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  if (!LOCAL_HOST_PATTERN.test(url) && process.env.ALLOW_REMOTE_TESTS !== 'yes') {
    throw new Error(
      'Refusing to run integration tests against a non-local Supabase stack.\n' +
        `  Target:  ${url}\n` +
        `  Loaded:  ${chosen ?? '(no env file — ambient environment)'}\n\n` +
        'These suites CREATE auth users and INSERT, UPDATE and DELETE rows with the\n' +
        'service-role key. Against the hosted project that is production data.\n\n' +
        'Either:\n' +
        '  • create .env.test pointing at a throwaway project or a local stack, or\n' +
        '  • run `npm run test:remote` (sets ALLOW_REMOTE_TESTS=yes) if you really\n' +
        '    do mean the hosted project.\n\n' +
        'See docs/env-vars.md.',
    );
  }

  if (!canReachServiceM8) {
    console.warn(
      '\n⚠ SKIPPING the live ServiceM8 integration suite: ' +
        `${!sm8TestApiKey ? 'SM8_TEST_API_KEY' : 'CREDENTIALS_ENCRYPTION_KEY'} is not set.\n` +
        '  Connect idempotence and the verify-then-write guarantee are NOT covered in this run.\n' +
        '  See docs/env-vars.md.\n',
    );
  }

  resolved = {
    url,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    databaseUrl: process.env.DATABASE_URL!,
    migrateDatabaseUrl: process.env.MIGRATE_DATABASE_URL!,
    operatorEmail: process.env.OPERATOR_EMAIL!,
    operatorPassword: process.env.OPERATOR_PASSWORD!,
  };

  return resolved;
}

/**
 * Reading ANY property here asserts that this stack is disposable. Getters, not
 * values, so that assertion travels with the read rather than with the import.
 */
export const testEnv: Readonly<ResolvedTestEnv> = {
  get url() {
    return resolveTestEnv().url;
  },
  get anonKey() {
    return resolveTestEnv().anonKey;
  },
  get serviceRoleKey() {
    return resolveTestEnv().serviceRoleKey;
  },
  get databaseUrl() {
    return resolveTestEnv().databaseUrl;
  },
  get migrateDatabaseUrl() {
    return resolveTestEnv().migrateDatabaseUrl;
  },
  get operatorEmail() {
    return resolveTestEnv().operatorEmail;
  },
  get operatorPassword() {
    return resolveTestEnv().operatorPassword;
  },
};

/**
 * ServiceM8 live-account credentials — OPTIONAL, unlike everything above.
 *
 * `tests/connect-servicem8.test.ts` calls the real ServiceM8 API, which needs a
 * trial account that a CI runner (or a second developer) may legitimately not
 * have. Rather than fail the whole suite for a missing third-party credential,
 * that ONE suite skips itself and says so loudly.
 *
 * The skip is deliberately narrow: everything provable without ServiceM8 —
 * schemas against the captured fixtures, normalization, crypto, RLS — is
 * unconditional. Only the live round trip is optional.
 */
export const sm8TestApiKey = process.env.SM8_TEST_API_KEY;
export const credentialsEncryptionKey = process.env.CREDENTIALS_ENCRYPTION_KEY;

/** True when the live-ServiceM8 integration suite can actually run. */
export const canReachServiceM8 = Boolean(sm8TestApiKey && credentialsEncryptionKey);
