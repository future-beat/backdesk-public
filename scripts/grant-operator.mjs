/**
 * Enrol a user in `operator_allowlist` — the gate `is_operator()` reads.
 *
 *   node scripts/grant-operator.mjs                     # OPERATOR_EMAIL from env
 *   node scripts/grant-operator.mjs <user-uuid>         # explicit id
 *   node scripts/grant-operator.mjs someone@example.com # explicit email
 *
 * Idempotent — safe to re-run. Run it once after `node scripts/migrate.mjs`
 * applies 0010/0011; until then the operator's own console reads of
 * `operator_allowlist` and `event_consumer_cursors` return zero rows, which is
 * the correct behaviour for someone not on the list and is indistinguishable
 * from "the table is empty".
 *
 * WHY THIS IS A SCRIPT AND NOT A MIGRATION. The allowlist holds `auth.users`
 * ids, which differ per environment — a migration containing a literal uuid
 * would enrol a developer's local account into production, or (worse) enrol
 * nobody and leave the operator locked out of their own console with no error
 * to read. Enrolment is an environment fact, not schema.
 *
 * WHY IT NEEDS THE SERVICE-ROLE KEY. `authenticated` holds no INSERT on
 * `operator_allowlist` (see 0011): self-promotion to operator is the single
 * highest-value write in the schema, so the only path to it is someone holding
 * the service-role key and deciding to run this.
 */
import { createClient } from '@supabase/supabase-js';

import { loadEnv, requireEnv, withRetry } from './lib/support.mjs';

loadEnv();

const arg = process.argv[2];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The email is only required when we have to look one up. Asking for
// OPERATOR_EMAIL when the caller already supplied a uuid would fail a run that
// had everything it needed.
const needsEmail = !(arg && UUID.test(arg));
const env = requireEnv(
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  ...(needsEmail && !arg ? ['OPERATOR_EMAIL'] : []),
);

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PAGE_SIZE = 200;

/** Paged, like scripts/create-operator.mjs — page one is not the whole list. */
async function findByEmail(email) {
  const wanted = email.toLowerCase();
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === wanted);
    if (hit) return hit;
    if (data.users.length < PAGE_SIZE) return null;
  }
  return null;
}

let userId;
let label;

if (arg && UUID.test(arg)) {
  userId = arg;
  label = arg;
} else {
  const email = arg ?? process.env.OPERATOR_EMAIL;
  const user = await withRetry('lookup', () => findByEmail(email));
  if (!user) {
    console.error(`No auth user found for ${email}.`);
    console.error('Create it first: node scripts/create-operator.mjs');
    process.exit(1);
  }
  userId = user.id;
  label = `${email} (${user.id})`;
}

// ON CONFLICT DO NOTHING rather than check-then-insert: two runs racing must
// leave one row, decided by Postgres. `ignoreDuplicates` is PostgREST's
// spelling of it.
const { error } = await withRetry('enrol', async () => {
  const result = await admin
    .from('operator_allowlist')
    .upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true });
  if (result.error) throw result.error;
  return result;
});

if (error) {
  console.error(`Failed to enrol operator: ${error.message}`);
  process.exit(1);
}

console.log(`Operator enrolled in operator_allowlist: ${label}`);
