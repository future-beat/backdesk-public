/**
 * The CON-03 artefact, on a console that does not exist (D-06).
 *
 * Usage:  npm run escalations:recent -- [--tenant <uuid>] [--limit <1..50>]
 *
 * WRITES NOTHING. One SELECT.
 *
 * ── WHY A SCRIPT ────────────────────────────────────────────────────────────
 *
 * Hot-lead escalation is deployed and works: Pass 5 labels an inbound reply,
 * Pass 6 texts the tradie and writes an `escalations` row carrying the
 * provider's message id. Nothing in the console renders that row. So the
 * go-live proof for CON-03 — "the handset buzzed, and here is the record that
 * says why" — has no surface, and the only alternatives are a hand-written SQL
 * query against production (a credential on a command line, in a workspace that
 * denies any command naming an env file) or a dashboard screenshot (not
 * repeatable, not server-side, not evidence).
 *
 * This is the third option, and it is the one D-10 asks for: a repeatable,
 * server-side read whose output is safe to paste into an evidence log.
 *
 * ── WHAT IS DELIBERATELY NOT SELECTED (T-10-09) ─────────────────────────────
 *
 * The select list is EXPLICIT, and two columns are missing from it on purpose:
 *
 *   `to_address`     the TRADIE's mobile as it stood when the alert was raised.
 *                    Not a customer's number — but still a handset number, and
 *                    the output of this script is archived in
 *                    `docs/external-registrations.md` where somebody re-reads it
 *                    next quarter.
 *   `body_segments`  a cost figure. It says nothing about whether the
 *                    escalation reached anybody, which is the only question
 *                    this script exists to answer.
 *
 * What IS printed is five uuids, a closed-vocabulary outcome, a provider id and
 * two timestamps. The provider id is the join key to ClickSend's own record,
 * which is what makes a pasted line checkable a month later.
 */
import postgres from 'postgres';

function fail(message) {
  console.error(message);
  process.exit(1);
}

/* -------------------------------------------------------------------------- *
 * Arguments — validated BEFORE a statement is built
 * -------------------------------------------------------------------------- */

/** `--tenant x --limit y`, the parser from verify-email-pipe.mjs:71. */
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
  fail('Usage: npm run escalations:recent -- [--tenant <uuid>] [--limit <1..50>]');
}

/**
 * The uuid check is not defence against injection — the statement below is a
 * tagged template and every value crosses as a bound parameter. It is defence
 * against a WRONG ANSWER: a mistyped tenant id returns zero rows, and "no
 * escalation was raised" is precisely the conclusion an operator would draw
 * from that at the moment they are deciding whether the feature works.
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

try {
  const rows = await sql`
    SELECT
      id,
      tenant_id,
      cadence_id,
      inbound_message_id,
      outcome,
      sent_at,
      provider_message_id,
      created_at
    FROM escalations
    ${tenant ? sql`WHERE tenant_id = ${tenant}` : sql``}
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}
  `;

  if (rows.length === 0) {
    console.log('escalations: none');
  } else {
    console.log(`escalations (newest first, ${rows.length} rows)`);
    for (const row of rows) {
      console.log(
        `${row.id}  tenant=${row.tenant_id}  cadence=${row.cadence_id}  ` +
          `inbound=${row.inbound_message_id}  ` +
          `outcome=${row.outcome ?? 'unknown'}  sent_at=${iso(row.sent_at)}  ` +
          `provider=${row.provider_message_id ?? '-'}  created=${iso(row.created_at)}`,
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
