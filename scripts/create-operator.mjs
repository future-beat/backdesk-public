/**
 * Create the single operator auth user. Idempotent — safe to re-run.
 *
 * Public signups are disabled on the project, so the user cannot be created
 * through the normal sign-up flow; this uses the admin API with the service-role
 * key. That key must never leave server-side scripts.
 */
import { createClient } from '@supabase/supabase-js';

import { loadEnv, requireEnv, withRetry } from './lib/support.mjs';

loadEnv();
const env = requireEnv(
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPERATOR_EMAIL',
  'OPERATOR_PASSWORD',
);

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findByEmail(email) {
  // listUsers is paginated; the project has a handful of users at most, but page
  // through anyway rather than assuming everything fits on page one.
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

const email = env.OPERATOR_EMAIL;

const existing = await withRetry('lookup', () => findByEmail(email));
if (existing) {
  console.log(`Operator already exists (${email}) — nothing to do.`);
  process.exit(0);
}

// The callback THROWS on failure, so withRetry either returns a success result
// or propagates — it never returns an error-bearing one. Destructuring `error`
// here (as this did) produced a permanently-undefined value and an unreachable
// handler, so a non-transient failure — weak password rejected, email already
// registered, wrong service-role key — escaped as an unhandled promise
// rejection with a raw SDK stack trace. That is the failure mode for a script an
// operator runs during provisioning, at the moment they are least equipped to
// read one.
let created;
try {
  created = await withRetry('createUser', async () => {
    const result = await admin.auth.admin.createUser({
      email,
      password: env.OPERATOR_PASSWORD,
      // No inbox round-trip: this account is provisioned, not self-registered.
      email_confirm: true,
    });
    if (result.error) throw result.error;
    return result;
  });
} catch (e) {
  console.error(`Failed to create operator: ${e.message}`);
  process.exit(1);
}

console.log(`Operator created: ${email} (id ${created.data.user.id})`);
