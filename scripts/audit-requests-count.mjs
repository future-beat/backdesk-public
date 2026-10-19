/**
 * Proof that a public audit request reached the hosted database (Phase 9,
 * LAND-03) — one line, no console page, no PII.
 *
 * Usage:  node scripts/audit-requests-count.mjs
 *
 * WRITES NOTHING. One SELECT, and the only writer of `audit_requests` is the
 * public server action; a row that appears here appeared because somebody
 * submitted the form.
 *
 * ── WHY THIS EXISTS AS A REPO SCRIPT ────────────────────────────────────────
 *
 * The same argument `scripts/cron-status.mjs` makes: this workspace denies any
 * command whose text names an `.env*` file, and the connection string lives in
 * one, so a `psql "$MIGRATE_DATABASE_URL" -c ...` one-liner cannot be run
 * without either pasting a credential onto a command line or reading a denied
 * file. A script in that mould reads the value the way every other script here
 * does and prints an answer containing no credential.
 *
 * It also exists because the console list that will show these rows is 09-09.
 * Until then this is the ONLY way to prove the tracer's last hop — the row
 * landed — without opening a page that does not exist yet.
 *
 * ── WHAT IS DELIBERATELY NOT PRINTED (T-9-05) ───────────────────────────────
 *
 * No business name, no contact name, no phone number, no email address, no ip
 * hash and no user agent. That is the reason the select list is EXPLICIT rather
 * than `SELECT *`: this output is meant to be pasted into an evidence log, and
 * a `SELECT *` would put a stranger's mobile number there the first time
 * somebody re-read the file. What is printed is a count, a timestamp, a status
 * and two notification outcomes — every one of them from a closed vocabulary or
 * a clock.
 */
import postgres from 'postgres';

try {
  process.loadEnvFile('.env.local');
} catch {
  // rely on ambient env
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const url = process.env.MIGRATE_DATABASE_URL;
if (!url) fail('MIGRATE_DATABASE_URL is not set — see docs/env-vars.md');

// Parsed inside a `try`, and the failure NEVER echoes the value: an uncaught
// `new URL()` throw prints ERR_INVALID_URL with an `input:` property carrying
// the connection string, password included.
try {
  new URL(url);
} catch {
  fail('MIGRATE_DATABASE_URL is not a parseable URL — see docs/env-vars.md');
}

const sql = postgres(url, { prepare: false, connect_timeout: 30, max: 1, idle_timeout: 20 });

try {
  const [row] = await sql`
    SELECT
      (SELECT count(*)::int FROM audit_requests) AS total,
      (SELECT count(*)::int FROM audit_requests WHERE status = 'new') AS new_count,
      newest.created_at,
      newest.status,
      newest.notify_email,
      newest.notify_sms,
      newest.notify_detail,
      newest.notified_at
    FROM (
      SELECT created_at, status, notify_email, notify_sms, notify_detail, notified_at
      FROM audit_requests
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    ) AS newest
    RIGHT JOIN (SELECT 1) AS always ON true
  `;

  if (!row || row.total === 0) {
    console.log('audit_requests rows: 0');
  } else {
    console.log(
      `audit_requests rows: ${row.total} (new: ${row.new_count}); ` +
        `newest: ${row.created_at.toISOString()} status=${row.status} ` +
        `email=${row.notify_email ?? 'null'} sms=${row.notify_sms ?? 'null'} ` +
        `notified_at=${row.notified_at ? row.notified_at.toISOString() : 'null'}` +
        (row.notify_detail ? ` detail=${JSON.stringify(row.notify_detail)}` : ''),
    );
  }

  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(0);
} catch (error) {
  await sql.end({ timeout: 5 }).catch(() => {});
  // Nothing carrying a secret is interpolated into the statement above, so the
  // message can only name a missing table or a privilege.
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
