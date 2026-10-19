/**
 * The tracer proof for plan 02-01: the connect slice, end to end, against the
 * REAL ServiceM8 trial account and the REAL database.
 *
 * This is not a test double exercise. It calls the same `connectServiceM8` the
 * console's server action calls, so what it proves is that the deployed path
 * works — including the pieces a unit test cannot reach: that ServiceM8 accepts
 * our filter syntax, that the payload matches the zod schemas, that the
 * transaction commits, and that the ciphertext is really ciphertext.
 *
 * Seven assertions, each named and each failing loudly:
 *   1. ciphertext-format          — enc:v1: envelope, not plaintext
 *   2. last4                      — matches the real key's last four
 *   3. quotes>0                   — the backfill actually pulled something
 *   4. needs_review-default       — every open quote is parked, not chaseable (D-15)
 *   5. win-history-present        — non-Quote statuses persisted too (D-14/D-16)
 *   6. cursor=max-edit_date       — cursor came from THEIR clock, not ours
 *   7. second-connect-still-one-row — the ONB-02 concurrency/idempotence edge
 *
 * Plus the prohibition check: the plaintext key appears in NO column of the
 * stored connection row.
 *
 * Cleanup runs in a finally block: this creates a real tenant on a real project
 * and leaving it behind would put a fake client in the operator's console.
 */
import { register } from 'node:module';

import { createClient } from '@supabase/supabase-js';

import { loadEnv, requireEnv, withRetry } from './lib/support.mjs';

loadEnv();
const env = requireEnv(
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPERATOR_EMAIL',
  'OPERATOR_PASSWORD',
  'SM8_TEST_API_KEY',
  'CREDENTIALS_ENCRYPTION_KEY',
);

// Teach node the `@/` alias, then import the real modules.
register('./lib/ts-alias-hook.mjs', import.meta.url);
const { connectServiceM8 } = await import('@/core/sync/connect');
const { closeDb } = await import('@/db/repository');

const noPersist = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, noPersist);

const API_KEY = env.SM8_TEST_API_KEY;

let step = 'startup';
let tenantId = null;
let failed = false;

function fail(message) {
  throw new Error(message);
}

function pass(label, detail) {
  console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
}

try {
  // --- Setup: a dedicated verification tenant ------------------------------
  step = 'setup/create-verification-tenant';
  const operator = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    noPersist,
  );
  const signIn = await withRetry(step, async () => {
    const r = await operator.auth.signInWithPassword({
      email: env.OPERATOR_EMAIL,
      password: env.OPERATOR_PASSWORD,
    });
    if (r.error) throw r.error;
    return r;
  });
  if (!signIn.data.session) fail('operator sign-in returned no session');

  const name = `SM8 Verify ${Date.now()}`;
  const created = await withRetry(step, async () => {
    const r = await operator.rpc('create_tenant', {
      p_name: name,
      p_trade_type: 'Plumbing',
      // The zone ServiceM8 timestamps are interpreted in (SYNC-03).
      p_timezone: 'Australia/Perth',
      p_hours_start: '08:00',
      p_hours_end: '17:00',
      p_days: [1, 2, 3, 4, 5],
      p_escalation_phone: null,
    });
    if (r.error) throw r.error;
    return r;
  });
  tenantId = created.data;
  console.log(`  ok    setup  verification tenant ${tenantId}`);

  // --- Connect --------------------------------------------------------------
  step = 'connect/first-call';
  const result = await connectServiceM8(tenantId, API_KEY);
  if (!result.ok) {
    fail(
      `connectServiceM8 failed: kind=${result.kind}${result.detail ? ` detail=${result.detail}` : ''}`,
    );
  }
  console.log(
    `  ok    connect  ${result.quotesWritten} job(s) mirrored, ${result.openQuotes} open`,
  );

  // --- Read back through the service-role client ----------------------------
  step = 'assert/read-back';
  const { data: connections, error: connError } = await admin
    .from('sm8_connections')
    .select('*')
    .eq('tenant_id', tenantId);
  if (connError) fail(`could not read the connection row: ${connError.message}`);
  if (connections.length !== 1) {
    fail(`expected exactly 1 connection row, found ${connections.length}`);
  }
  const connection = connections[0];

  const { data: quotes, error: quotesError } = await admin
    .from('quotes')
    .select('*')
    .eq('tenant_id', tenantId);
  if (quotesError) fail(`could not read quote rows: ${quotesError.message}`);

  // --- 1. ciphertext-format -------------------------------------------------
  step = 'assert/ciphertext-format';
  if (!connection.api_key_ciphertext.startsWith('enc:v1:')) {
    fail(
      'api_key_ciphertext does not carry the enc:v1 envelope — the key may be stored unencrypted',
    );
  }
  pass('ciphertext-format', 'enc:v1: envelope present');

  // --- 2. last4 -------------------------------------------------------------
  step = 'assert/last4';
  if (connection.key_last4 !== API_KEY.slice(-4)) {
    fail('key_last4 does not match the last four characters of the key');
  }
  pass('last4', 'matches the supplied key');

  // --- PROHIBITION: no plaintext anywhere on the row ------------------------
  //
  // Serialising the WHOLE row and searching it, rather than checking the one
  // column we expect the key to be in: the failure this guards against is a
  // future column that quietly captures the key (a debug field, a cached
  // header, an error message stored for the health page). Checking only
  // api_key_ciphertext would not notice any of those.
  step = 'assert/no-plaintext-key';
  const serialised = JSON.stringify({ ...connection, key_last4: '' });
  if (serialised.includes(API_KEY)) {
    fail('THE PLAINTEXT API KEY IS PRESENT IN THE STORED CONNECTION ROW (T-2-02)');
  }
  // The last4 is permitted, and only the last4 — anything longer is a leak.
  if (API_KEY.length > 8 && serialised.includes(API_KEY.slice(-8))) {
    fail('more than the last four characters of the key are stored on the row');
  }
  pass('no-plaintext-key', 'no column contains the key');

  // --- 3. quotes>0 ----------------------------------------------------------
  step = 'assert/quotes-present';
  if (quotes.length === 0) {
    fail(
      'the backfill wrote no quotes. Seed the ServiceM8 trial account with jobs ' +
        'across all four statuses (each needs a quote_date within the last 90 days).',
    );
  }
  pass('quotes>0', `${quotes.length} row(s)`);

  // --- 4. needs_review-default ---------------------------------------------
  step = 'assert/needs-review-default';
  const openQuotes = quotes.filter((q) => q.status === 'Quote');
  const chaseable = openQuotes.filter((q) => q.chase_eligibility !== 'needs_review');
  if (chaseable.length > 0) {
    fail(
      `${chaseable.length} backfilled open quote(s) are not needs_review — D-15 says a ` +
        'backfilled quote is never chase-eligible without operator triage',
    );
  }
  if (openQuotes.length === 0) {
    fail('no open (status Quote) rows were mirrored — seed at least one Quote job');
  }
  pass('needs_review-default', `${openQuotes.length} open quote(s), all parked`);

  // --- 5. win-history-present ----------------------------------------------
  step = 'assert/win-history';
  const nonQuote = quotes.filter((q) => q.status !== 'Quote');
  if (nonQuote.length === 0) {
    fail(
      'no non-Quote rows were mirrored — D-16 requires the full status history ' +
        '(seed Work Order / Completed / Unsuccessful jobs with a quote_date)',
    );
  }
  const statuses = [...new Set(nonQuote.map((q) => q.status))].sort();
  pass('win-history-present', `statuses also stored: ${statuses.join(', ')}`);

  // --- 6. cursor = max edit_date -------------------------------------------
  step = 'assert/cursor';
  const maxEditDate = quotes.reduce(
    (max, q) => (max === null || q.edit_date_raw > max ? q.edit_date_raw : max),
    null,
  );
  if (connection.job_cursor !== maxEditDate) {
    fail(
      `job_cursor is ${JSON.stringify(connection.job_cursor)} but the maximum stored ` +
        `edit_date_raw is ${JSON.stringify(maxEditDate)} — the cursor must come from ` +
        "ServiceM8's own clock, never ours",
    );
  }
  pass('cursor=max-edit_date', maxEditDate);

  // --- 7. second connect is idempotent -------------------------------------
  step = 'assert/second-connect';
  const second = await connectServiceM8(tenantId, API_KEY);
  if (!second.ok) fail(`the second connect failed: kind=${second.kind}`);

  const { data: afterSecond, error: secondError } = await admin
    .from('sm8_connections')
    .select('id')
    .eq('tenant_id', tenantId);
  if (secondError) fail(`could not re-read connections: ${secondError.message}`);
  if (afterSecond.length !== 1) {
    fail(
      `connecting twice produced ${afterSecond.length} connection rows — the UNIQUE ` +
        'constraint on tenant_id is the ONB-02 concurrency guarantee',
    );
  }

  const { count: quotesAfter, error: countError } = await admin
    .from('quotes')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);
  if (countError) fail(`could not count quotes: ${countError.message}`);
  if (quotesAfter !== quotes.length) {
    fail(
      `re-connecting changed the quote count from ${quotes.length} to ${quotesAfter} — ` +
        'the (tenant_id, sm8_job_uuid) upsert should update, never duplicate',
    );
  }
  pass('second-connect-still-one-row', `quotes still ${quotesAfter}`);

  console.log('\nTracer verified: all seven assertions passed against the live account.');
} catch (e) {
  failed = true;
  console.error(`\nFAILED at ${step}: ${e.message}`);
} finally {
  if (tenantId) {
    const { error } = await admin.from('tenants').delete().eq('id', tenantId);
    if (error) {
      console.error(`  cleanup failed — tenant ${tenantId} may need manual removal: ${error.message}`);
      failed = true;
    } else {
      console.log('  ok    cleanup  verification tenant removed (cascade)');
    }
  }
  await closeDb();
  process.exit(failed ? 1 : 0);
}
