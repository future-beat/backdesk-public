/**
 * The Phase 14 pre-flight: six counts, and nothing else.
 *
 * Usage:  npm run lead-jobs:invariants
 *
 * WRITES NOTHING. One SELECT.
 *
 * ── WHY A SCRIPT ────────────────────────────────────────────────────────────
 *
 * Migration 0041 rewrites `leads_closed_iff_reason` (a closed lead now admits
 * `converted`) and widens `quotes_sync_source_known` (admits `lead`) as plain,
 * validated CHECKs. A CHECK added over a row that breaks it fails the whole
 * migration in production, so the rule (the one 0024's header states) is:
 * count first, read-only, against the database the migration will meet. 0041
 * is written on the assumption that no lead is `converted` and no quote carries
 * `sync_source = 'lead'` yet (the 0008 CHECK forbids the latter today), and
 * that no tenant is armed for text-back; a non-zero `leads_converted` or
 * `quotes_source_lead` is a founder question, never a NOT VALID edit made
 * alone. Data is never repaired by SQL.
 *
 * The statement reads tables and columns that exist BEFORE 0041 (Phase 12's
 * `leads` and `escalations.lead_id`, Phase 6's `escalations.sent_at`, 0008's
 * `quotes.sync_source`, `messaging_config`), so it runs the same before and
 * after the apply. `schema_0041_applied` is a catalogue probe for
 * `leads.sm8_job_state`, the column 0041 adds; it is the read-back line the
 * push protocol checks after `db:migrate`.
 *
 * ── WHAT IS DELIBERATELY NOT SELECTED (T-14-09) ─────────────────────────────
 *
 * No row. No id, no tenant, no contact mobile, no caller number, no body, no
 * job uuid. The statement aggregates inside the database and returns five
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
  // Pre-0041 tables and columns only, plus one catalogue probe.
  const [row] = await sql`
    SELECT
      (SELECT count(*)::int FROM leads) AS leads_total,
      (SELECT count(*)::int FROM leads WHERE status = 'converted') AS leads_converted,
      (SELECT count(*)::int FROM quotes WHERE sync_source = 'lead') AS quotes_source_lead,
      (
        SELECT count(*)::int
        FROM escalations
        WHERE lead_id IS NOT NULL AND sent_at IS NOT NULL
      ) AS escalations_lead_sent,
      (
        SELECT count(DISTINCT tenant_id)::int
        FROM messaging_config
        WHERE channel = 'text_back' AND enabled
      ) AS text_back_armed_tenants,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'leads'
          AND column_name = 'sm8_job_state'
      ) AS schema_0041_applied
  `;

  console.log(`leads_total=${row.leads_total}`);
  console.log(`leads_converted=${row.leads_converted}`);
  console.log(`quotes_source_lead=${row.quotes_source_lead}`);
  console.log(`escalations_lead_sent=${row.escalations_lead_sent}`);
  console.log(`text_back_armed_tenants=${row.text_back_armed_tenants}`);
  console.log(`schema_0041_applied=${row.schema_0041_applied}`);

  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(0);
} catch (error) {
  await sql.end({ timeout: 5 }).catch(() => {});
  // Nothing carrying a secret is interpolated into the statement above, so the
  // message can only name a missing table or a privilege.
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
