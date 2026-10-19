/**
 * The IN-04 pre-flight: four counts over `missed_calls`, and nothing else.
 *
 * Usage:  npm run missed-calls:invariants
 *
 * WRITES NOTHING. One SELECT.
 *
 * ── WHY A SCRIPT ────────────────────────────────────────────────────────────
 *
 * Migration 0039 adds three consistency CHECKs the Phase 11 review asked for
 * (IN-04): a withheld caller has no number, the withheld flag agrees with the
 * caller kind, and a row has no tenant exactly when it is a dead letter. The
 * code paths that write those columns are consistent by construction, but the
 * nightly reconcile's rows were never traced exhaustively, and a CHECK added
 * over a row that breaks it fails the whole migration in production. So the
 * rule (the one 0024's header states) is: count first, read-only, against the
 * database the migration will meet. A zero count means the CHECK is written
 * plain; a non-zero count means that one CHECK is written NOT VALID — new rows
 * enforced, existing rows untouched — and the migration header says so. Data is
 * never repaired by SQL.
 *
 * ── WHAT IS DELIBERATELY NOT SELECTED (T-11-04) ─────────────────────────────
 *
 * No row. No id, no tenant, no caller number, no ForwardedFrom, no raw payload.
 * The statement aggregates inside the database and returns four integers; a
 * number that never leaves the database cannot reach a `console.log` a later
 * edit adds. The output is safe to paste into a SUMMARY, where it stays.
 */
import postgres from 'postgres';

function fail(message) {
  console.error(message);
  process.exit(1);
}

/* -------------------------------------------------------------------------- *
 * Connection
 * -------------------------------------------------------------------------- */

try {
  process.loadEnvFile('.env.local');
} catch {
  // rely on ambient env
}

const url = process.env.MIGRATE_DATABASE_URL;
if (!url) fail('MIGRATE_DATABASE_URL is not set — see docs/env-vars.md');

// Parsed inside a `try`, and the failure NEVER echoes the value (CR-01).
try {
  new URL(url);
} catch {
  fail('MIGRATE_DATABASE_URL is not a parseable URL — see docs/env-vars.md');
}

const sql = postgres(url, { prepare: false, connect_timeout: 30, max: 1, idle_timeout: 20 });

try {
  // Phase 11 columns only: this runs BEFORE 0039 exists in production.
  const [row] = await sql`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (
        WHERE (caller_kind = 'withheld') IS DISTINCT FROM (caller_e164 IS NULL)
      )::int AS withheld_number_mismatch,
      count(*) FILTER (
        WHERE caller_withheld IS DISTINCT FROM (caller_kind = 'withheld')
      )::int AS withheld_flag_mismatch,
      count(*) FILTER (
        WHERE (tenant_id IS NULL) IS DISTINCT FROM (dead_letter_reason IS NOT NULL)
      )::int AS dead_letter_tenant_mismatch
    FROM missed_calls
  `;

  console.log(`total=${row.total}`);
  console.log(`withheld_number_mismatch=${row.withheld_number_mismatch}`);
  console.log(`withheld_flag_mismatch=${row.withheld_flag_mismatch}`);
  console.log(`dead_letter_tenant_mismatch=${row.dead_letter_tenant_mismatch}`);

  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(0);
} catch (error) {
  await sql.end({ timeout: 5 }).catch(() => {});
  // Nothing carrying a secret is interpolated into the statement above, so the
  // message can only name a missing table or a privilege.
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
