/**
 * The S4 evidence reader: how fast a client's missed callers got their text,
 * with nobody's number in it (D-14).
 *
 * Usage:  npm run text-back:timing -- --tenant <uuid> [--limit <1..50>]
 *
 * WRITES NOTHING. Two SELECTs.
 *
 * ── WHAT IT PRINTS ─────────────────────────────────────────────────────────
 *
 * One line per recent missed call for the tenant, newest first: the missed-call
 * id, its timestamps, how it completed, the text-back decision (status, skip
 * reason, route, decided time) and, through `text_back_ledger_id`, the ledger
 * row's claimed time, outcome, delivery status and delivered time. Then three
 * deltas in whole seconds where both ends exist:
 *
 *   greeting_s              ended − started     (the call itself, greeting included)
 *   handler_s               claimed − ended     (our handler, completed → claimed)
 *   arrival_to_delivered_s  delivered − started (the promise: call in → text on the handset)
 *
 * Then `samples=N median_s=M worst_s=W` over the rows with a delivered time
 * (or `samples=0`), and a fixed line saying which clock each figure rests on:
 * `delivered_at` is the CARRIER's clock, every other instant is ours, so the
 * founder's stopwatch reading of handset arrival belongs beside these figures
 * in the evidence log (send-ledger.ts, `delivered_at` vs `claimed_at`).
 *
 * ── THE ARMING READ-BACK ────────────────────────────────────────────────────
 *
 * The output ENDS with exactly two lines, read from `messaging_config`:
 *
 *   text_back_armed=true|false         an enabled `text_back` row for this tenant exists
 *   sms_enabled_for_tenant=true|false  the effective SMS switch for this tenant, by
 *                                      the rule `resolveSmsFrom` applies: the
 *                                      tenant's own `sms` row decides when one
 *                                      exists, otherwise the shared row, otherwise
 *                                      false
 *
 * Plan 12-09's mandatory teardown is checked against these two lines, so the
 * state after a live session is read by a command rather than by memory.
 * Only the two booleans cross into this process: no sending identity column.
 *
 * ── WHAT IS DELIBERATELY NOT SELECTED (T-12-07) ─────────────────────────────
 *
 * The caller's number and the raw ForwardedFrom are reduced to booleans INSIDE
 * the statement. No recipient address, no message body, no provider message id
 * and no sending identity is selected. Output is safe to paste into a committed
 * evidence log.
 */
import postgres from 'postgres';

function fail(message) {
  console.error(message);
  process.exit(1);
}

/* -------------------------------------------------------------------------- *
 * Arguments — validated BEFORE a statement is built
 * -------------------------------------------------------------------------- */

/** `--tenant x --limit y`, the parser from missed-calls-recent.mjs. */
function args(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--')) return null;
    parsed[argv[i].slice(2)] = argv[i + 1];
  }
  return parsed;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const USAGE = 'Usage: npm run text-back:timing -- --tenant <uuid> [--limit <1..50>]';

const parsed = args(process.argv.slice(2));
if (!parsed) fail(USAGE);

/**
 * REQUIRED, unlike the missed-calls reader: timing figures mixed across
 * clients would be evidence about nobody, and the two read-back lines are
 * per-tenant facts.
 */
const tenant = parsed.tenant;
if (tenant === undefined) fail(USAGE);
if (!UUID.test(tenant)) fail(`--tenant must be a uuid, got: ${tenant}`);

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

/** Whole seconds from `from` to `to`, or null when either end is missing. */
function seconds(from, to) {
  if (!from || !to) return null;
  return Math.round((to.getTime() - from.getTime()) / 1000);
}

const shown = (value) => (value === null ? '-' : String(value));

/** The median of a non-empty list, rounded to whole seconds. */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

try {
  const rows = await sql`
    SELECT
      mc.id,
      mc.started_at,
      mc.ended_at,
      mc.completed_via,
      mc.after_hours,
      mc.text_back_status,
      mc.text_back_skip_reason,
      mc.text_back_route,
      mc.text_back_decided_at,
      (mc.caller_e164 IS NOT NULL) AS caller_present,
      (mc.forwarded_from_raw IS NOT NULL) AS forwarded_from_present,
      sl.claimed_at,
      sl.outcome,
      sl.delivery_status,
      sl.delivered_at
    FROM missed_calls mc
    LEFT JOIN send_ledger sl ON sl.id = mc.text_back_ledger_id
    WHERE mc.tenant_id = ${tenant}
    ORDER BY mc.started_at DESC, mc.id DESC
    LIMIT ${limit}
  `;

  const promises = [];

  if (rows.length === 0) {
    console.log('text-back calls: none');
  } else {
    console.log(`text-back calls (newest first, ${rows.length} rows)`);
    for (const row of rows) {
      const greeting = seconds(row.started_at, row.ended_at);
      const handler = seconds(row.ended_at, row.claimed_at);
      const promise = seconds(row.started_at, row.delivered_at);
      if (promise !== null) promises.push(promise);

      console.log(
        `${row.id}  started=${iso(row.started_at)}  ended=${iso(row.ended_at)}  ` +
          `completed_via=${text(row.completed_via)}  after_hours=${flag(row.after_hours)}  ` +
          `caller_present=${flag(row.caller_present)}  ` +
          `forwarded_from_present=${flag(row.forwarded_from_present)}  ` +
          `text_back_status=${text(row.text_back_status)}  ` +
          `text_back_skip_reason=${text(row.text_back_skip_reason)}  ` +
          `text_back_route=${text(row.text_back_route)}  ` +
          `text_back_decided_at=${iso(row.text_back_decided_at)}  ` +
          `claimed=${iso(row.claimed_at)}  outcome=${text(row.outcome)}  ` +
          `delivery_status=${text(row.delivery_status)}  delivered=${iso(row.delivered_at)}  ` +
          `greeting_s=${shown(greeting)}  handler_s=${shown(handler)}  ` +
          `arrival_to_delivered_s=${shown(promise)}`,
      );
    }
  }

  if (promises.length === 0) {
    console.log('samples=0');
  } else {
    console.log(
      `samples=${promises.length} median_s=${median(promises)} worst_s=${Math.max(...promises)}`,
    );
  }
  console.log(
    'clocks: delivered_at is the carrier clock; started, ended, decided and claimed are ours. ' +
      'Record the stopwatch reading of handset arrival beside these figures.',
  );

  /*
   * THE ARMING READ-BACK. Two booleans and nothing else. The sms subquery
   * orders the tenant's own row before the shared row (tenant_id IS NULL sorts
   * false first), which is `getChannelConfig`'s OVERRIDE_FIRST, and an absent
   * row reads false.
   */
  const [state] = await sql`
    SELECT
      EXISTS (
        SELECT 1 FROM messaging_config
        WHERE channel = 'text_back' AND tenant_id = ${tenant} AND enabled
      ) AS text_back_armed,
      coalesce((
        SELECT enabled FROM messaging_config
        WHERE channel = 'sms' AND (tenant_id = ${tenant} OR tenant_id IS NULL)
        ORDER BY (tenant_id IS NULL) ASC
        LIMIT 1
      ), false) AS sms_enabled_for_tenant
  `;

  console.log(`text_back_armed=${flag(state.text_back_armed)}`);
  console.log(`sms_enabled_for_tenant=${flag(state.sms_enabled_for_tenant)}`);

  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(0);
} catch (error) {
  await sql.end({ timeout: 5 }).catch(() => {});
  // Nothing carrying a secret is interpolated into the statements above, so
  // the message can only name a missing table or a privilege.
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
