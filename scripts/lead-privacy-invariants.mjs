/**
 * The Phase 15 pre-flight: six counts, and nothing else.
 *
 * Usage:  npm run lead-privacy:invariants
 *
 * WRITES NOTHING. One SELECT.
 *
 * ── WHY A SCRIPT ────────────────────────────────────────────────────────────
 *
 * Migration 0042 adds the `pseudonymised_at` stamps and widens three CHECKs;
 * the code that follows it deploys the nightly pseudonymisation pass (D-06).
 * That pass is the one-way act of the phase: on its FIRST run after deploy it
 * replaces the caller number of every row already past the retention boundary
 * with a keyed hash that cannot be turned back. So the pre-flight counts,
 * read-only, exactly the rows the NEXT run would touch:
 *
 *   leads_closed_past_boundary          — UNSTAMPED leads closed without
 *                                         converting (`closed` / `expired`)
 *                                         at or before now − 90 days
 *   missed_calls_no_lead_past_boundary  — UNSTAMPED lead-less tenant calls
 *                                         that started at or before
 *                                         now − 90 days
 *
 * UNSTAMPED (15-REVIEW WR-08): both counts carry `pseudonymised_at IS NULL`,
 * so once the pass has run they read as the BACKLOG — what is due and not yet
 * done — and fall back to zero when it is working. Counting every row past the
 * boundary, stamped or not, would read as a permanent backlog from the first
 * live hash on and could no longer tell "the pass is working" from "the pass
 * is stuck".
 *
 * The ninety-day interval literal is `PSEUDONYMISE_AFTER_DAYS`
 * (src/core/leads/constants.ts); `tests/pseudonymise-structure.test.ts` is the
 * pin that holds that constant at 90. A non-zero count on either line is a
 * founder question — whether those rows should be hashed tonight — never the
 * executor's. `suppressed_contacts_total` is the count the pass must leave
 * unchanged (a STOP is kept for as long as it is needed). Data is never
 * repaired by SQL.
 *
 * The statement reads the `pseudonymised_at` stamps migration 0042 added, so
 * it needs 0042 — applied in production by plan 15-08; before that
 * it would fail naming the missing column, which is itself the answer.
 * `schema_0042_applied` is a catalogue probe for `leads.pseudonymised_at`; it
 * is the read-back line the push protocol checks after `db:migrate`.
 *
 * ── WHAT IS DELIBERATELY NOT SELECTED (T-14-09) ─────────────────────────────
 *
 * No row. No id, no tenant, no contact mobile, no caller number, no body, no
 * hash. The statement aggregates inside the database and returns five
 * integers and one boolean; a number that never leaves the database cannot
 * reach a `console.log` a later edit adds. The output is safe to paste into a
 * SUMMARY, a checkpoint message or the evidence entry, where it stays.
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
  // The two boundaries are PSEUDONYMISE_AFTER_DAYS (= 90), inclusive, as in
  // the pass, and both counts take UNSTAMPED rows only (WR-08): the backlog.
  const [row] = await sql`
    SELECT
      (SELECT count(*)::int FROM leads) AS leads_total,
      (
        SELECT count(*)::int
        FROM leads
        WHERE status IN ('closed', 'expired')
          AND closed_at <= now() - interval '90 days'
          AND pseudonymised_at IS NULL
      ) AS leads_closed_past_boundary,
      (SELECT count(*)::int FROM missed_calls) AS missed_calls_total,
      (
        SELECT count(*)::int
        FROM missed_calls
        WHERE tenant_id IS NOT NULL
          AND lead_id IS NULL
          AND started_at <= now() - interval '90 days'
          AND pseudonymised_at IS NULL
      ) AS missed_calls_no_lead_past_boundary,
      (SELECT count(*)::int FROM suppressed_contacts) AS suppressed_contacts_total,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'leads'
          AND column_name = 'pseudonymised_at'
      ) AS schema_0042_applied
  `;

  console.log(`leads_total=${row.leads_total}`);
  console.log(`leads_closed_past_boundary=${row.leads_closed_past_boundary}`);
  console.log(`missed_calls_total=${row.missed_calls_total}`);
  console.log(`missed_calls_no_lead_past_boundary=${row.missed_calls_no_lead_past_boundary}`);
  console.log(`suppressed_contacts_total=${row.suppressed_contacts_total}`);
  console.log(`schema_0042_applied=${row.schema_0042_applied}`);

  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(0);
} catch (error) {
  await sql.end({ timeout: 5 }).catch(() => {});
  // Nothing carrying a secret is interpolated into the statement above, so the
  // message can only name a missing table or a privilege.
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
