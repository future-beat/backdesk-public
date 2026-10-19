/**
 * The CAP-03 evidence reader: the newest missed calls, with nobody's number in
 * them.
 *
 * Usage:  npm run missed-calls:recent -- [--tenant <uuid>] [--limit <1..50>]
 *
 * WRITES NOTHING. One SELECT.
 *
 * ── WHY A SCRIPT ────────────────────────────────────────────────────────────
 *
 * Three live steps of Phase 11 end in the same question — "did the row land,
 * and what did it say?": the verification call (plan 11-07), the
 * dropped-callback drill (success criterion 3) and the three-carrier divert
 * spike (success criterion 4, which gates Phase 12). The console shows none of
 * it; the proof form takes a row id and nothing more. So this is the D-10
 * artefact: a repeatable, server-side, secret-free read whose output is safe
 * to paste into `docs/external-registrations.md`, where it stays forever.
 *
 * ── WHAT IS DELIBERATELY NOT SELECTED (T-11-04) ─────────────────────────────
 *
 * The select list is EXPLICIT, and every column that could hold a caller's
 * number is either absent or reduced to a boolean INSIDE the statement:
 *
 *   the caller's E.164         → `caller_present`, true/false, computed in SQL
 *   the raw ForwardedFrom      → `forwarded_from_present`, true/false, in SQL
 *   the raw From               → not selected at all
 *   the dead-letter payload    → not selected at all (it is the whole request)
 *
 * A number that never leaves the database cannot reach this process, and a
 * value that is not in this process cannot reach a `console.log` a later edit
 * adds. What IS printed: uuids, the provider's CallSid (the join key to
 * Twilio's own call log, which makes a pasted line checkable a month later),
 * closed-vocabulary statuses, the prefix class (`caller_kind`), the withheld
 * flag, the country code, a duration and timestamps.
 *
 * ── CARRIER IS NOT A STORED FACT ────────────────────────────────────────────
 *
 * Twilio does not tell us which network a diverted call came through. During
 * the spike the founder writes the carrier and the divert type beside each line
 * in the evidence entry, matched by call time (docs/telephony-runbook.md §10).
 */
import postgres from 'postgres';

function fail(message) {
  console.error(message);
  process.exit(1);
}

/* -------------------------------------------------------------------------- *
 * Arguments — validated BEFORE a statement is built
 * -------------------------------------------------------------------------- */

/** `--tenant x --limit y`, the parser from escalations-recent.mjs. */
function args(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--')) return null;
    parsed[argv[i].slice(2)] = argv[i + 1];
  }
  return parsed;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const parsed = args(process.argv.slice(2));
if (!parsed) {
  fail('Usage: npm run missed-calls:recent -- [--tenant <uuid>] [--limit <1..50>]');
}

/**
 * Not injection defence — every value below crosses as a bound parameter. It
 * is defence against a WRONG ANSWER: a mistyped tenant id returns zero rows,
 * and "the call never landed" is exactly the conclusion an operator would draw
 * in the middle of a drill.
 */
const tenant = parsed.tenant;
if (tenant !== undefined && !UUID.test(tenant)) {
  fail(`--tenant must be a uuid, got: ${tenant}`);
}

const limit = parsed.limit === undefined ? 10 : Number(parsed.limit);
if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
  fail(`--limit must be a whole number from 1 to 50, got: ${parsed.limit}`);
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

const iso = (value) => (value ? value.toISOString() : '-');
const text = (value) => (value === null || value === undefined || value === '' ? '-' : value);
const flag = (value) => (value ? 'true' : 'false');

try {
  const rows = await sql`
    SELECT
      id,
      tenant_id,
      provider_call_id,
      started_at,
      ended_at,
      call_status,
      duration_seconds,
      after_hours,
      caller_kind,
      caller_withheld,
      (caller_e164 IS NOT NULL) AS caller_present,
      (forwarded_from_raw IS NOT NULL) AS forwarded_from_present,
      from_country,
      source,
      completed_via,
      dead_letter_reason,
      created_at
    FROM missed_calls
    ${tenant ? sql`WHERE tenant_id = ${tenant}` : sql``}
    ORDER BY started_at DESC, id DESC
    LIMIT ${limit}
  `;

  if (rows.length === 0) {
    console.log('missed calls: none');
  } else {
    console.log(`missed calls (newest first, ${rows.length} rows)`);
    for (const row of rows) {
      console.log(
        `${row.id}  tenant=${text(row.tenant_id)}  call=${text(row.provider_call_id)}  ` +
          `started=${iso(row.started_at)}  ended=${iso(row.ended_at)}  ` +
          `call_status=${text(row.call_status)}  duration_seconds=${text(row.duration_seconds)}  ` +
          `after_hours=${flag(row.after_hours)}  caller_kind=${text(row.caller_kind)}  ` +
          `caller_withheld=${flag(row.caller_withheld)}  caller_present=${flag(row.caller_present)}  ` +
          `forwarded_from_present=${flag(row.forwarded_from_present)}  ` +
          `from_country=${text(row.from_country)}  source=${text(row.source)}  ` +
          `completed_via=${text(row.completed_via)}  dead_letter=${text(row.dead_letter_reason)}  ` +
          `created=${iso(row.created_at)}`,
      );
    }
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
