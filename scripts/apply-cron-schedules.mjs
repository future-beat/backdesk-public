/**
 * Apply the pg_cron schedules that carry a SECRET (SYNC-01, CAD-01/CAD-02,
 * MSG-01, D-13).
 *
 * Four jobs: the five-minute ServiceM8 sync tick, the per-minute cadence tick,
 * the nightly messaging reconciliation sweep, and the 06:30 stalled-draft
 * digest. See `JOBS` below for why they are separate.
 *
 * ── WHY THIS IS A SCRIPT AND NOT A MIGRATION ────────────────────────────────
 *
 * Every other schedulable thing in this project lives in `src/db/migrations/`,
 * and the weekly `cron-details-cleanup` job still does — it is pure SQL with
 * nothing to hide. These two are different: their commands embed a bearer
 * token, and a migration is a committed file.
 *
 * The alternative was Supabase Vault — store the secret with
 * `vault.create_secret` and have the committed migration read
 * `(select decrypted_secret from vault.decrypted_secrets where name = ...)`.
 * That keeps the "schedules live in migrations" rule intact and is the nicer
 * shape. It was NOT taken because Vault's interop with pg_cron command SQL is
 * unverified for this project (02-RESEARCH assumption A7), and the failure mode
 * of getting it wrong is the worst one available here: a schedule that exists,
 * runs, and posts a null bearer — 401 every five minutes, `cron.job_run_details`
 * full of "success", `sync_runs` empty. Exactly RESEARCH Pitfall 7 wearing a
 * different hat. This script trades elegance for a thing you can watch work.
 *
 * ── WHAT IS AND IS NOT COMMITTED ────────────────────────────────────────────
 *
 * Committed: this file, containing no URL and no secret.
 * Not committed: `APP_BASE_URL`, `SYNC_TICK_SECRET`, `CADENCE_TICK_SECRET`,
 * `MESSAGING_RECONCILE_SECRET` and `STALLED_DIGEST_SECRET`, read from the
 * environment at APPLY time.
 * In the database: `cron.job.command` holds the interpolated secret, which is
 * inherent to pg_cron and is why `cron` schema privileges are asserted in
 * tests/rls-coverage.test.ts — anon and authenticated cannot read that table.
 *
 * ── ROTATION ────────────────────────────────────────────────────────────────
 *
 * Rotating either secret means: update the Vercel env, redeploy, then re-run
 * this script. In between, THAT tick 401s — and only that one, which is the
 * whole reason the two ticks do not share a bearer. Re-running is safe at any
 * time: each job is replaced, never duplicated.
 *
 * Usage:  APP_BASE_URL=https://your-app.vercel.app node scripts/apply-cron-schedules.mjs
 */
import postgres from 'postgres';

try {
  process.loadEnvFile('.env.local');
} catch {
  // rely on ambient env
}

/**
 * ── THE TWO TICKS ARE TWO JOBS, AND THAT IS ARCHITECTURE, NOT TIDINESS ──────
 *
 * The sync tick talks to ServiceM8 over the network for every connected client;
 * the cadence tick sends messages. Folded into one job, a slow or unresponsive
 * ServiceM8 would delay a customer's follow-up — CAD-02's "never late" broken
 * by an upstream that has nothing to do with the message. Separate jobs also
 * mean separate bearers: rotating one 401s one tick, never both.
 *
 * The cadence tick runs EVERY MINUTE. The touch slots this engine materializes
 * carry jitter down to the minute (so fifteen clients' follow-ups do not all
 * leave at 09:00 exactly), and a five-minute tick would round every one of them
 * up to the next multiple of five, collapsing the jitter it exists to preserve.
 * A minute with no work due costs one indexed query.
 */
const JOBS = [
  {
    name: 'sm8-sync-tick',
    schedule: '*/5 * * * *', // D-13
    path: '/api/internal/sync-tick',
    secretVar: 'SYNC_TICK_SECRET',
  },
  {
    name: 'cadence-tick',
    schedule: '* * * * *', // CAD-02 — per-minute, for jitter fidelity
    path: '/api/internal/cadence-tick',
    secretVar: 'CADENCE_TICK_SECRET',
  },
  /**
   * ── THE MESSAGING SWEEP IS DAILY, AND THE TIME IS 03:30 AWST ──────────────
   *
   * `30 19 * * *` is UTC; pg_cron schedules run in the database's timezone and
   * this project's is UTC, so the Perth time is +8. Overnight on purpose: the
   * sweep re-runs `handleInboundSms` for replies it finds, which can suppress
   * contacts and pause cadences, and doing that while an operator is watching
   * the triage screen mid-morning makes the screen change under them for
   * reasons they did not cause. It also keeps a paged third-party query away
   * from the contact-hours window the cadence tick is busiest in.
   *
   * DAILY, not hourly: this is the belt to two braces (SYNC-03's hint-vs-
   * guarantee split). Its 48-hour window means a single skipped run costs
   * nothing, which is the property that makes a low frequency safe.
   *
   * Its own bearer, like the other two — rotating one 401s one tick.
   */
  {
    name: 'messaging-reconcile',
    schedule: '30 19 * * *', // 03:30 Australia/Perth (AWST, UTC+8)
    path: '/api/internal/messaging-reconcile',
    secretVar: 'MESSAGING_RECONCILE_SECRET',
  },
  /**
   * ── THE STALLED DIGEST IS DAILY, AND THE TIME IS 06:30 AWST (CON-04) ──────
   *
   * `30 22 * * *` is UTC; pg_cron runs in the database's timezone and this
   * project's is UTC, so the Perth time is +8. FIRST THING RATHER THAN
   * OVERNIGHT, and that is the opposite choice from the sweep above it, for the
   * opposite reason: the sweep changes state and is deliberately kept away from
   * a watching operator, while this one exists to BE watched. The operator opens
   * their phone, and the list of what is still waiting is already there — before
   * the working day's first send slots arrive.
   *
   * DAILY, and the only roll-up there is. The immediate alert fires once per
   * touch per threshold crossing (D-11); anything hourly beyond that is not
   * escalation, it is the training that makes the next alert invisible.
   *
   * Its own bearer, like the three above — rotating one 401s one job.
   */
  {
    name: 'stalled-digest',
    schedule: '30 22 * * *', // 06:30 Australia/Perth (AWST, UTC+8)
    path: '/api/internal/stalled-digest',
    secretVar: 'STALLED_DIGEST_SECRET',
  },
];

/** pg_net's timeout covers DISPATCH only; the route's own 300s does the work. */
const DISPATCH_TIMEOUT_MS = 8000;

function fail(message) {
  console.error(message);
  process.exit(1);
}

const url = process.env.MIGRATE_DATABASE_URL;
if (!url) fail('MIGRATE_DATABASE_URL is not set — see docs/env-vars.md');

// Same rule as scripts/migrate.mjs: the session connection, not the transaction
// pooler. `cron.schedule` is a catalog write.
// Parsed inside a `try`, and the failure NEVER echoes the value: an uncaught
// `new URL()` throw prints `ERR_INVALID_URL` with an `input:` property holding
// the whole connection string, password included.
let port;
try {
  port = new URL(url).port;
} catch {
  fail('MIGRATE_DATABASE_URL is not a parseable URL — see docs/env-vars.md');
}
if (port === '6543') {
  fail(
    'MIGRATE_DATABASE_URL points at the transaction pooler (6543). ' +
      'Schedule changes need the session pooler (5432).',
  );
}

const baseUrl = process.env.APP_BASE_URL;
if (!baseUrl) {
  fail(
    'APP_BASE_URL is not set.\n' +
      '  This is the stable deployed origin pg_cron will POST to, e.g.\n' +
      '  APP_BASE_URL=https://<your-app>.vercel.app node scripts/apply-cron-schedules.mjs\n' +
      '  A preview URL that changes on every deploy will silently stop working.',
  );
}

// ALL missing secrets are reported at once, by name. Failing on the first one
// makes an operator run this twice to learn two facts that were both knowable
// on the first run — and the second run is the one they do in a hurry, mid
// rotation, with a tick already 401ing.
const missingSecrets = JOBS.filter((job) => !process.env[job.secretVar]).map(
  (job) => job.secretVar,
);
if (missingSecrets.length > 0) {
  fail(`Not set: ${missingSecrets.join(', ')} — see docs/env-vars.md`);
}

/**
 * Reject a malformed origin HERE rather than after it is embedded in a cron
 * command, where the symptom is a job that runs forever against nothing.
 */
let origin;
try {
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
    fail(`APP_BASE_URL must be https (got ${parsed.protocol}//).`);
  }
  origin = parsed;
} catch {
  fail('APP_BASE_URL is not a valid absolute URL (include the scheme).');
}

/**
 * SQL string literal escaping.
 *
 * The command is a SQL *string* passed to `cron.schedule`, so its contents
 * cannot be bound as parameters — they are baked in. Doubling single quotes is
 * the correct and complete escape for a standard-conforming string literal, and
 * both inputs are validated above besides. `cron.schedule` itself is called with
 * bound parameters.
 */
const lit = (value) => `'${String(value).replaceAll("'", "''")}'`;

const commandFor = (job) =>
  `select net.http_post(
  url := ${lit(new URL(job.path, origin).toString())},
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', ${lit(`Bearer ${process.env[job.secretVar]}`)}
  ),
  timeout_milliseconds := ${DISPATCH_TIMEOUT_MS}
) as request_id;`;

const sql = postgres(url, { prepare: false, connect_timeout: 30, max: 1, idle_timeout: 20 });

try {
  for (const job of JOBS) {
    // `cron.unschedule` THROWS when the job is absent, so it is guarded rather
    // than wrapped in a swallow — a swallowed error here would also hide a
    // permissions failure, which is the realistic reason this step fails.
    const existing = await sql`SELECT jobid FROM cron.job WHERE jobname = ${job.name}`;
    for (const row of existing) {
      await sql`SELECT cron.unschedule(${row.jobid}::bigint)`;
    }

    await sql`SELECT cron.schedule(${job.name}, ${job.schedule}, ${commandFor(job)})`;

    // jobname + schedule ONLY. `command` holds the bearer token, and this
    // output ends up in terminal scrollback and CI logs (T-2-15, T-3-25).
    const applied = await sql`
      SELECT jobname, schedule, active FROM cron.job WHERE jobname = ${job.name}
    `;
    if (applied.length !== 1) {
      fail(`Expected exactly one '${job.name}' job after apply, found ${applied.length}.`);
    }
    console.log(
      `Applied: ${applied[0].jobname}  schedule=${applied[0].schedule}  active=${applied[0].active}`,
    );
    console.log(`Target path: ${job.path} (origin and bearer read from env, not printed)`);
  }

  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(0);
} catch (error) {
  await sql.end({ timeout: 5 }).catch(() => {});
  // The message may name a missing privilege; it cannot contain the secret,
  // because the only statement carrying it is parameterised.
  console.error(`Failed to apply cron schedules: ${error.message}`);
  process.exit(1);
}
