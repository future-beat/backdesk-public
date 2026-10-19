/**
 * The Phase 13 pre-flight: six counts, and nothing else.
 *
 * Usage:  npm run lead-cadence:invariants
 *
 * WRITES NOTHING. One SELECT.
 *
 * ── WHY A SCRIPT ────────────────────────────────────────────────────────────
 *
 * Migration 0040 adds plain (validated) CHECKs over `inbound_messages` rows that
 * carry a `lead_id`, over `leads`, and over `message_templates`. A CHECK added
 * over a row that breaks it fails the whole migration in production, so the
 * rule (the one 0024's header states) is: count first, read-only, against the
 * database the migration will meet. 0040 is written on the assumption that no
 * lead and no lead-threaded inbound row exists yet, and that no tenant is armed
 * for text-back; a non-zero `leads_total` or `inbound_lead_rows` is a founder
 * question, never a NOT VALID edit made alone. Data is never repaired by SQL.
 *
 * The statement reads tables and columns that exist BEFORE 0040 (Phase 12's
 * `leads`, `cadences.kind`, `inbound_messages.lead_id`, `messaging_config`), so
 * it runs the same before and after the apply. `schema_0040_applied` is a
 * catalogue probe for `tenants.after_hours_escalation`, the column 0040 adds;
 * it is the read-back line the push protocol checks after `db:migrate`.
 *
 * ── WHAT IS DELIBERATELY NOT SELECTED (T-13-15) ─────────────────────────────
 *
 * No row. No id, no tenant, no contact mobile, no caller number, no body. The
 * statement aggregates inside the database and returns five integers and one
 * boolean; a number that never leaves the database cannot reach a
 * `console.log` a later edit adds. The output is safe to paste into a SUMMARY,
 * a checkpoint message or the evidence entry, where it stays.
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
  // Pre-0040 tables and columns only, plus one catalogue probe.
  const [row] = await sql`
    SELECT
      (SELECT count(*)::int FROM leads) AS leads_total,
      (SELECT count(*)::int FROM cadences WHERE kind = 'lead') AS lead_cadences_total,
      (SELECT count(*)::int FROM inbound_messages WHERE lead_id IS NOT NULL) AS inbound_lead_rows,
      (SELECT count(*)::int FROM message_templates) AS message_templates_total,
      (
        SELECT count(DISTINCT tenant_id)::int
        FROM messaging_config
        WHERE channel = 'text_back' AND enabled
      ) AS text_back_armed_tenants,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'tenants'
          AND column_name = 'after_hours_escalation'
      ) AS schema_0040_applied
  `;

  console.log(`leads_total=${row.leads_total}`);
  console.log(`lead_cadences_total=${row.lead_cadences_total}`);
  console.log(`inbound_lead_rows=${row.inbound_lead_rows}`);
  console.log(`message_templates_total=${row.message_templates_total}`);
  console.log(`text_back_armed_tenants=${row.text_back_armed_tenants}`);
  console.log(`schema_0040_applied=${row.schema_0040_applied}`);

  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(0);
} catch (error) {
  await sql.end({ timeout: 5 }).catch(() => {});
  // Nothing carrying a secret is interpolated into the statement above, so the
  // message can only name a missing table or a privilege.
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
