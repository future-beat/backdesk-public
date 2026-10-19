/**
 * Read-only read-back of the scheduled ticks (D-06 step 2, DOM-01).
 *
 * Reports where the four production cron jobs are POSTing, what the last few
 * dispatches answered, whether a remote test run currently owns the ticks, and
 * what origin the local environment would apply if `cron:apply` ran now.
 *
 * WRITES NOTHING. `scripts/apply-cron-schedules.mjs` is the only sanctioned
 * writer of `cron.job` and it replaces jobs by name; a mixed state discovered
 * here is recovered by re-running that script, never by editing the catalog by
 * hand.
 *
 * ── WHY THIS EXISTS AS A REPO SCRIPT ────────────────────────────────────────
 *
 * The proof queries for the URL switch were written as `psql "$MIGRATE_DATABASE_URL"
 * -c ...` one-liners. This workspace denies any command whose text names an
 * `.env*` file, and the connection string only lives in one, so an operator (or
 * an agent) cannot run those one-liners without either pasting a credential onto
 * a command line or reading a file it is denied. A script in the `db-status.mjs`
 * mould reads the value the same way every other script here does — through
 * `process.loadEnvFile` — and prints an answer that contains no credential.
 *
 * ── WHAT IS DELIBERATELY NOT PRINTED ────────────────────────────────────────
 *
 * `cron.job.command` embeds a bearer token; that is inherent to pg_cron and is
 * why `cron` schema privileges are asserted in tests/rls-coverage.test.ts. The
 * URL is therefore extracted IN THE DATABASE with `substring(command from ...)`
 * so the headers never cross the wire, and the extracted value is then reduced
 * to `origin + pathname` before printing — a callback URL carrying a `?token=`
 * query string would otherwise leak the moment this output is pasted into an
 * evidence log, which is precisely what this script is for.
 *
 * Usage:  npm run cron:status
 */
import postgres from 'postgres';

try {
  process.loadEnvFile('.env.local');
} catch {
  // rely on ambient env
}

/** The four jobs scripts/apply-cron-schedules.mjs owns, in its own order. */
const JOB_NAMES = ['sm8-sync-tick', 'cadence-tick', 'messaging-reconcile', 'stalled-digest'];

/** The guard tests/helpers/global-setup.ts schedules while it holds the ticks. */
const WATCHDOG_JOB = 'remote-test-watchdog';

function fail(message) {
  console.error(message);
  process.exit(1);
}

const url = process.env.MIGRATE_DATABASE_URL;
if (!url) fail('MIGRATE_DATABASE_URL is not set — see docs/env-vars.md');

// Same rule as scripts/apply-cron-schedules.mjs: reading `cron.job` is a catalog
// read, and the session pooler is the connection that has the privileges for it.
// Parsed inside a `try`, and the failure NEVER echoes the value. An uncaught
// `new URL()` throw prints `ERR_INVALID_URL` with an `input:` property carrying
// the string it could not parse — which here is the connection string, password
// included, on the one path an operator hits while editing the env file.
let port;
try {
  port = new URL(url).port;
} catch {
  fail('MIGRATE_DATABASE_URL is not a parseable URL — see docs/env-vars.md');
}
if (port === '6543') {
  fail(
    'MIGRATE_DATABASE_URL points at the transaction pooler (6543). ' +
      'Schedule reads need the session pooler (5432).',
  );
}

/**
 * `origin + pathname`, never the query string and never the raw command.
 *
 * An unparseable value is reported as `(unparseable)` rather than echoed: the
 * only reason a non-URL would be in there is that the extraction regex missed,
 * and the thing it would have missed is the command — bearer included.
 */
const originAndPath = (value) => {
  try {
    const parsed = new URL(value);
    return parsed.origin + parsed.pathname;
  } catch {
    return '(unparseable)';
  }
};

/** The origin alone — what `cron:apply` would prefix every job path with. */
const originOnly = (value) => {
  try {
    return new URL(value).origin;
  } catch {
    return '(unparseable)';
  }
};

const sql = postgres(url, { prepare: false, connect_timeout: 30, max: 1, idle_timeout: 20 });

try {
  // ── (a) what the LOCAL environment would apply ────────────────────────────
  // Printed first because every "the jobs are still on the old origin" incident
  // ends here: `cron:apply` reads this value, so if it is stale or unset the
  // job rows below cannot be anything but stale too.
  const baseUrl = process.env.APP_BASE_URL;
  console.log(`local APP_BASE_URL origin: ${baseUrl ? originOnly(baseUrl) : '(unset)'}`);

  // ── (b) is a remote test run holding the ticks right now? ─────────────────
  // Pitfall 4: `cron:apply` overlapping a `test:remote` run leaves a paused tick
  // or a lease naming jobids that no longer exist. Both facts are cheap to read
  // and neither is visible from the job rows alone — an adopted-and-paused
  // cadence tick reads `active=f` for a reason this script must name.
  const [lease] = await sql`SELECT count(*)::int AS n FROM remote_test_lease`.catch(() => [
    { n: -1 },
  ]);
  console.log(`remote_test_lease rows: ${lease.n === -1 ? '(table missing)' : lease.n}`);

  const watchdog = await sql`SELECT 1 FROM cron.job WHERE jobname = ${WATCHDOG_JOB}`;
  console.log(`remote-test-watchdog scheduled: ${watchdog.length > 0 ? 'yes' : 'no'}`);

  // ── (c) the four jobs, one line each ──────────────────────────────────────
  console.log('');
  for (const name of JOB_NAMES) {
    // The bearer stays inside the database: `substring(command from ...)` runs
    // server-side and only the URL literal comes back.
    const rows = await sql`
      SELECT jobname, schedule, active,
             substring(command from 'url := ''([^'']+)''') AS target
        FROM cron.job
       WHERE jobname = ${name}
    `;
    if (rows.length === 0) {
      console.log(`${name} MISSING`);
      continue;
    }
    if (rows.length > 1) {
      // Two rows with one name is the mixed state DOM-02 warns about. Say so;
      // the fix is re-running `cron:apply`, which unschedules by name first.
      console.log(`${name} DUPLICATED (${rows.length} rows) — re-run cron:apply`);
    }
    for (const row of rows) {
      console.log(
        `${row.jobname} ${row.schedule} active=${row.active ? 't' : 'f'} ${originAndPath(row.target ?? '')}`,
      );
    }
  }

  // ── (d) what the dispatches actually answered ─────────────────────────────
  // The Phase 3 standard: `cron.job_run_details` reads "success" for a job that
  // POSTed and got a 401, because the POST itself succeeded. The status code is
  // the only thing that distinguishes a working tick from a silent one.
  console.log('');
  console.log('net._http_response (last 5, newest first):');
  const responses = await sql`
    SELECT status_code, created FROM net._http_response ORDER BY id DESC LIMIT 5
  `.catch(() => null);
  if (!responses) {
    console.log('(net._http_response is not readable on this connection)');
  } else if (responses.length === 0) {
    console.log('(no rows — pg_net has dispatched nothing recently)');
  } else {
    for (const r of responses) {
      console.log(`${r.status_code} ${r.created.toISOString()}`);
    }
  }

  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(0);
} catch (error) {
  await sql.end({ timeout: 5 }).catch(() => {});
  // Nothing carrying a secret is interpolated into any statement above, so the
  // message can only name a missing table or privilege.
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
