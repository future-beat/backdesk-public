/**
 * What happened to one cadence, and whether its contact is now blocked.
 *
 * Usage:  npm run cadence:status -- --cadence <uuid>
 *
 * WRITES NOTHING. One SELECT.
 *
 * ── WHY IT EXISTS ───────────────────────────────────────────────────────────
 *
 * Two go-live proofs are observed through this script rather than through a
 * screen. The CON-03 sequence ends with a cadence that must read
 * `paused(customer_reply)` — the reply stopped the chase, which is the promise
 * the product makes. The DOM-04 one-click click ends with a cadence that must
 * read `stopped(unsubscribed)` AND a contact suppressed on BOTH channels — the
 * compliance promise. Neither is rendered anywhere an operator can point at,
 * and both are the whole claim.
 *
 * ── THE SUPPRESSION FACTS ARE BOOLEANS, AND THEY STAY BOOLEANS (T-10-09) ────
 *
 * The question is "is this contact blocked on sms / on email". The obvious
 * implementation selects the cadence's snapshot `contact_mobile` and
 * `contact_email`, then looks them up — which pulls a real customer's mobile
 * number and email address into this process, one `console.log` away from an
 * evidence log that gets pasted into a file and re-read next quarter.
 *
 * So the comparison happens INSIDE the database, as two EXISTS subqueries, and
 * what crosses the wire is `true` or `false`. The snapshot columns appear
 * exactly once each in this file, both times inside a SQL predicate, and never
 * in the select list or in any output — pinned by `tests/ops-scripts.test.ts`.
 *
 * A note on what the EXISTS actually proves: it joins on the cadence's OWN
 * snapshot of the contact, which is the address the engine would send to. That
 * is the right join. A suppression recorded against a different spelling of the
 * same person would (correctly) read `no` here, because dispatch would also
 * miss it — this script agrees with the engine rather than with an intuition
 * about who the person is.
 */
import postgres from 'postgres';

function fail(message) {
  console.error(message);
  process.exit(1);
}

/* -------------------------------------------------------------------------- *
 * Arguments — validated BEFORE a statement is built
 * -------------------------------------------------------------------------- */

/** `--cadence x`, the parser from verify-email-pipe.mjs:71. */
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
if (!parsed?.cadence) {
  fail('Usage: npm run cadence:status -- --cadence <uuid>');
}

const cadenceId = parsed.cadence;
if (!UUID.test(cadenceId)) {
  fail(`--cadence must be a uuid, got: ${cadenceId}`);
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
  const [row] = await sql`
    SELECT
      c.id,
      c.tenant_id,
      c.quote_id,
      c.status,
      c.pause_reason,
      c.stop_reason,
      c.created_at,
      EXISTS (
        SELECT 1 FROM suppressed_contacts s
        WHERE s.tenant_id = c.tenant_id AND s.channel = 'sms' AND s.address = c.contact_mobile
      ) AS sms_suppressed,
      EXISTS (
        SELECT 1 FROM suppressed_contacts s
        WHERE s.tenant_id = c.tenant_id AND s.channel = 'email' AND s.address = c.contact_email
      ) AS email_suppressed
    FROM cadences c
    WHERE c.id = ${cadenceId}
  `;

  if (!row) {
    console.log('cadence: not found');
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  }

  console.log(
    `cadence ${row.id}: tenant=${row.tenant_id} quote=${row.quote_id} ` +
      `status=${row.status} pause_reason=${row.pause_reason ?? '-'} ` +
      `stop_reason=${row.stop_reason ?? '-'} created=${row.created_at.toISOString()}`,
  );
  console.log(
    `suppressed: sms=${row.sms_suppressed ? 'yes' : 'no'} ` +
      `email=${row.email_suppressed ? 'yes' : 'no'}`,
  );

  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(0);
} catch (error) {
  await sql.end({ timeout: 5 }).catch(() => {});
  // Nothing carrying a secret is interpolated into the statement above, so the
  // message can only name a missing table or a privilege.
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
