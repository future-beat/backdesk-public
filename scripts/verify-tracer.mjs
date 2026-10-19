/**
 * Walking-skeleton verification — the runnable proof that the tracer holds.
 *
 * Five steps, each an assertion that fails loudly and names itself:
 *   1. anon (no session) reads tenants          -> zero rows          (RLS holds)
 *   2. operator signs in                        -> session issued     (auth works)
 *   3. operator calls create_tenant RPC         -> uuid returned      (write path)
 *   4. operator reads tenants                   -> the row is present (RLS-scoped read)
 *   5. service-role deletes the tenant          -> cascade cleans up  (no residue)
 *
 * Exits non-zero naming the failing step. Run against the live Sydney project.
 */
import { createClient } from '@supabase/supabase-js';

import { loadEnv, requireEnv, withRetry } from './lib/support.mjs';

loadEnv();
const env = requireEnv(
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPERATOR_EMAIL',
  'OPERATOR_PASSWORD',
);

const anonOptions = { auth: { autoRefreshToken: false, persistSession: false } };

let step = 'startup';
let createdTenantId = null;

function fail(message) {
  throw new Error(message);
}

try {
  // --- Step 1: anon sees nothing -------------------------------------------
  step = '1/5 anon-sees-zero-rows';
  const anon = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    anonOptions,
  );
  const anonRead = await withRetry(step, async () => {
    const r = await anon.from('tenants').select('id');
    if (r.error) throw r.error;
    return r;
  });
  if (!Array.isArray(anonRead.data)) fail(`expected an array, got ${typeof anonRead.data}`);
  if (anonRead.data.length !== 0) {
    fail(`anon could read ${anonRead.data.length} tenant row(s) — RLS is not protecting tenants`);
  }
  console.log('  ok  1/5  anon read returns zero rows');

  // --- Step 2: operator signs in -------------------------------------------
  step = '2/5 operator-sign-in';
  const operator = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    anonOptions,
  );
  const signIn = await withRetry(step, async () => {
    const r = await operator.auth.signInWithPassword({
      email: env.OPERATOR_EMAIL,
      password: env.OPERATOR_PASSWORD,
    });
    if (r.error) throw r.error;
    return r;
  });
  if (!signIn.data.session) fail('sign-in returned no session');
  console.log(`  ok  2/5  operator signed in (${signIn.data.user.email})`);

  // --- Step 3: create a tenant through the RPC ------------------------------
  step = '3/5 create_tenant-rpc';
  const name = `Tracer Client ${Date.now()}`;
  const profile = {
    p_name: name,
    p_trade_type: 'Plumbing',
    p_timezone: 'Australia/Perth',
    p_hours_start: '08:00',
    p_hours_end: '17:00',
    p_days: [1, 2, 3, 4, 5],
    p_escalation_phone: null,
  };
  const created = await withRetry(step, async () => {
    const r = await operator.rpc('create_tenant', profile);
    if (r.error) throw r.error;
    return r;
  });
  if (typeof created.data !== 'string' || created.data.length !== 36) {
    fail(`expected a uuid, got ${JSON.stringify(created.data)}`);
  }
  createdTenantId = created.data;
  console.log(`  ok  3/5  create_tenant returned ${createdTenantId}`);

  // --- Step 4: operator reads it back through RLS ---------------------------
  step = '4/5 rls-scoped-readback';
  const readBack = await withRetry(step, async () => {
    const r = await operator
      .from('tenants')
      .select('id, name, trade_type, timezone, status, contact_hours_start, contact_days')
      .eq('id', createdTenantId)
      .single();
    if (r.error) throw r.error;
    return r;
  });
  const row = readBack.data;
  if (row.name !== name) fail(`name mismatch: ${row.name} !== ${name}`);
  if (row.trade_type !== 'Plumbing') fail(`trade_type mismatch: ${row.trade_type}`);
  if (row.timezone !== 'Australia/Perth') fail(`timezone mismatch: ${row.timezone}`);
  if (row.status !== 'onboarding') fail(`status default not applied: ${row.status}`);
  if (!row.contact_hours_start.startsWith('08:00')) {
    fail(`contact_hours_start mismatch: ${row.contact_hours_start}`);
  }
  if (String(row.contact_days) !== '1,2,3,4,5') fail(`contact_days mismatch: ${row.contact_days}`);
  console.log('  ok  4/5  operator read the row back with every profile field intact');

  // --- Step 5: clean up via service role ------------------------------------
  step = '5/5 service-role-cleanup';
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await withRetry(step, async () => {
    const r = await admin.from('tenants').delete().eq('id', createdTenantId);
    if (r.error) throw r.error;
    return r;
  });
  const leftovers = await withRetry(step, async () => {
    const r = await admin.from('tenant_members').select('tenant_id').eq('tenant_id', createdTenantId);
    if (r.error) throw r.error;
    return r;
  });
  if (leftovers.data.length !== 0) {
    fail(`membership rows survived the tenant delete — ON DELETE CASCADE is not working`);
  }
  createdTenantId = null;
  console.log('  ok  5/5  tenant deleted, membership cascade removed');

  console.log('\nTracer verified: all five steps passed.');
  process.exit(0);
} catch (e) {
  console.error(`\nFAILED at step ${step}: ${e.message}`);
  if (createdTenantId) {
    console.error(`Leftover tenant ${createdTenantId} may need manual cleanup.`);
  }
  process.exit(1);
}
