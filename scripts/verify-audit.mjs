/**
 * The live proof for plan 02-06: a Quote Leakage Audit generated from a
 * read-only API key against the REAL ServiceM8 account and the REAL database.
 *
 * The trial account acts as its own prospect. This is not a test-double
 * exercise — it calls the same `generateAuditFromApiKey` the console's server
 * action calls, so what it proves is that the deployed path works, including
 * the pieces no unit test can reach: that ServiceM8 accepts our four filters,
 * that note/jobactivity payloads match the zod schemas, that the transaction
 * commits, and that `purge_after` really lands on every row.
 *
 * Assertions, each named and each failing loudly:
 *   1. figures-persisted     — the four AUD-01 figures are on the prospect row
 *   2. window-90-days        — window_start/end span exactly the audit window
 *   3. recoverable-derived   — estimate = never-followed-up x 0.15, floored
 *   4. baseline-null-safe    — AUD-02 snapshot, and null (not 0) for no data
 *   5. ciphertext-only       — enc:v1 envelope + last4, no plaintext anywhere
 *   6. lines-stamped         — every line carries purge_after ~30 days out
 *   7. no-tenant-leak        — the audit created no tenant and no quote row
 *
 * Cleanup runs in a finally block: this writes a real prospect to a real
 * project, and leaving it behind would put a fake business in the operator's
 * own sales pipeline.
 */
import { register } from 'node:module';

import { createClient } from '@supabase/supabase-js';

import { loadEnv, requireEnv } from './lib/support.mjs';

loadEnv();
const env = requireEnv(
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SM8_TEST_API_KEY',
  'CREDENTIALS_ENCRYPTION_KEY',
);

// Teach node the `@/` alias, then import the real modules.
register('./lib/ts-alias-hook.mjs', import.meta.url);
const { generateAuditFromApiKey } = await import('@/core/audit/generate');
const { AUDIT_RECOVERY_RATE } = await import('@/core/audit/constants');
const { closeDb } = await import('@/db/repository');

const noPersist = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, noPersist);

const API_KEY = env.SM8_TEST_API_KEY;
const BUSINESS = `Verification Prospect ${new Date().toISOString()}`;

let prospectId = null;
let failed = false;

function fail(message) {
  throw new Error(message);
}

function pass(label, detail) {
  console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
}

/** `numeric` arrives from PostgREST as a JSON number; cents is the safe unit. */
function cents(value) {
  return Math.round(Number(value) * 100);
}

try {
  console.log(`\nGenerating an audit for "${BUSINESS}" from the live trial account…\n`);

  const result = await generateAuditFromApiKey({ businessName: BUSINESS, apiKey: API_KEY });
  if (!result.ok) fail(`audit generation failed: ${result.kind}`);
  prospectId = result.prospectId;

  const { data: prospect, error } = await admin
    .from('prospects')
    .select('*')
    .eq('id', prospectId)
    .single();
  if (error) fail(`could not read the prospect back: ${error.message}`);

  // --- 1. figures-persisted -------------------------------------------------
  if (prospect.audit_generated_at === null) fail('audit_generated_at was never set');
  if (!(prospect.quotes_issued > 0)) fail('quotes_issued is not positive');
  for (const column of ['total_value', 'never_followed_up_value', 'recoverable_estimate']) {
    if (prospect[column] === null) fail(`${column} is null`);
  }
  pass(
    'figures-persisted',
    `${prospect.quotes_issued} quotes, $${prospect.total_value} total, ` +
      `$${prospect.never_followed_up_value} never followed up`,
  );

  // --- 2. window-90-days ----------------------------------------------------
  const spanDays =
    (Date.parse(`${prospect.window_end}T00:00:00Z`) -
      Date.parse(`${prospect.window_start}T00:00:00Z`)) /
    86_400_000;
  if (spanDays !== 90) fail(`window spans ${spanDays} days, expected 90`);
  pass('window-90-days', `${prospect.window_start} → ${prospect.window_end}`);

  // --- 3. recoverable-derived ----------------------------------------------
  const neverCents = cents(prospect.never_followed_up_value);
  const recoverableCents = cents(prospect.recoverable_estimate);
  const expected = Math.floor((neverCents * 15) / 100);
  if (recoverableCents !== expected) {
    fail(`recoverable estimate is ${recoverableCents}c, expected ${expected}c`);
  }
  if (recoverableCents > neverCents * AUDIT_RECOVERY_RATE) {
    fail('recoverable estimate was rounded UP — D-09 forbids overstating it');
  }
  pass('recoverable-derived', `$${prospect.recoverable_estimate} @ ${AUDIT_RECOVERY_RATE}`);

  // --- 4. baseline-null-safe ------------------------------------------------
  if (prospect.baseline_quotes_issued === 0 && prospect.baseline_win_rate !== null) {
    fail('a prospect with no quotes issued was given a 0% baseline instead of null');
  }
  if (prospect.baseline_quotes_issued > 0 && prospect.baseline_win_rate === null) {
    fail('quotes were issued but no baseline was computed');
  }
  pass(
    'baseline-null-safe',
    prospect.baseline_win_rate === null
      ? 'null (no quotes in window) — correctly NOT zero'
      : `${Math.round(Number(prospect.baseline_win_rate) * 100)}% of ${prospect.baseline_quotes_issued}`,
  );

  // --- 5. ciphertext-only ---------------------------------------------------
  if (!String(prospect.api_key_ciphertext).startsWith('enc:v1:')) {
    fail('the prospect key is not an enc:v1 envelope');
  }
  if (prospect.key_last4 !== API_KEY.slice(-4)) fail('key_last4 does not match the real key');
  for (const [column, value] of Object.entries(prospect)) {
    if (column === 'key_last4') continue;
    if (typeof value === 'string' && value.includes(API_KEY)) {
      fail(`the PLAINTEXT key is stored in prospects.${column}`);
    }
  }
  pass('ciphertext-only', `enc:v1 envelope, last4 ${prospect.key_last4}`);

  // --- 6. lines-stamped -----------------------------------------------------
  const { data: lines, error: linesError } = await admin
    .from('prospect_quote_lines')
    .select('id, purge_after, line_source')
    .eq('prospect_id', prospectId);
  if (linesError) fail(`could not read the audit lines: ${linesError.message}`);
  if (lines.length === 0) fail('no audit lines were stored');

  const unstamped = lines.filter((line) => line.purge_after === null);
  if (unstamped.length > 0) {
    fail(`${unstamped.length} line(s) written with NO purge date — D-04 broken`);
  }
  const horizon = Date.now() + 30 * 86_400_000;
  for (const line of lines) {
    const drift = Math.abs(Date.parse(line.purge_after) - horizon);
    if (drift > 86_400_000) fail(`purge_after is not ~30 days out (off by ${drift}ms)`);
    if (line.line_source !== 'api') fail(`line_source is ${line.line_source}, expected api`);
  }
  pass('lines-stamped', `${lines.length} lines, all purging in ~30 days`);

  // --- 7. no-tenant-leak (D-03) --------------------------------------------
  const { count: tenantCount } = await admin
    .from('tenants')
    .select('id', { count: 'exact', head: true })
    .eq('name', BUSINESS);
  if (tenantCount !== 0) fail('the audit created a TENANT — prospect data reached the client path');

  const { count: quoteCount } = await admin
    .from('quotes')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', prospectId);
  if (quoteCount !== 0) fail('the audit wrote rows into the tenant-scoped quotes table');
  pass('no-tenant-leak', 'no tenant, no quote row — audit data stayed analysis-only');

  console.log('\n  7/7 live assertions passed.\n');
} catch (e) {
  failed = true;
  console.error(`\n  FAIL — ${e.message}\n`);
} finally {
  if (prospectId) {
    // Cascades to prospect_quote_lines.
    const { error } = await admin.from('prospects').delete().eq('id', prospectId);
    if (error) console.error(`  cleanup failed, prospect ${prospectId} left behind: ${error.message}`);
    else console.log('  cleanup: verification prospect removed.');
  }
  await closeDb();
  process.exit(failed ? 1 : 0);
}
