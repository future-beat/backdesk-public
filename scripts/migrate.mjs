/**
 * Apply drizzle migrations with retry.
 *
 * Why this exists instead of a bare `npx drizzle-kit migrate`:
 * the CLI exits 0 when the connection drops mid-run, which looks like success
 * while nothing was applied — a false-positive state this phase explicitly must
 * not enter. This uses drizzle-orm's programmatic migrator against the SAME
 * journal (src/db/migrations) and the SAME tracking table
 * (drizzle.__drizzle_migrations), so drizzle-kit remains the single migration
 * authority; only the transport is made resilient.
 *
 * Migrations must run over the session connection (port 5432). The transaction
 * pooler (6543) cannot hold the advisory locks DDL needs.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

try {
  process.loadEnvFile('.env.local');
} catch {
  // rely on ambient env
}

const url = process.env.MIGRATE_DATABASE_URL;
if (!url) {
  console.error('MIGRATE_DATABASE_URL is not set — see docs/env-vars.md');
  process.exit(1);
}

const port = new URL(url).port;
if (port === '6543') {
  console.error(
    'MIGRATE_DATABASE_URL points at the transaction pooler (6543). ' +
      'Migrations need the session pooler (5432).',
  );
  process.exit(1);
}

const ATTEMPTS = 8;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const TRANSIENT = new Set([
  'CONNECT_TIMEOUT',
  'ENOTFOUND',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
]);

/**
 * drizzle's migrator re-wraps driver failures as a "Failed query" Error whose own
 * `code` is undefined, so a network drop is indistinguishable from a SQL error
 * unless the cause chain is walked. Misclassifying a drop as fatal aborts a run
 * that would have succeeded on retry.
 */
function isTransient(err) {
  for (let e = err, depth = 0; e && depth < 5; e = e.cause, depth++) {
    if (TRANSIENT.has(e.code)) return true;
    if (typeof e.message === 'string' && /ENOTFOUND|CONNECT_TIMEOUT|ECONNRESET|getaddrinfo/.test(e.message)) {
      return true;
    }
  }
  return false;
}

/** Deepest cause carries the real reason; the outer wrapper rarely does. */
function rootCause(err) {
  let e = err;
  while (e.cause) e = e.cause;
  return e;
}

for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  const sql = postgres(url, { prepare: false, connect_timeout: 30, max: 1, idle_timeout: 20 });
  try {
    await migrate(drizzle(sql), { migrationsFolder: './src/db/migrations' });
    const applied = await sql`
      SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations
    `;
    console.log(`Migrations applied. Journal entries recorded: ${applied[0].n}`);
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(0);
  } catch (e) {
    await sql.end({ timeout: 5 }).catch(() => {});
    const root = rootCause(e);
    console.error(
      `attempt ${attempt}/${ATTEMPTS} failed: ${root.code ?? ''} ${root.message}` +
        (root !== e ? `\n  (while running: ${e.message.split('\n')[0]})` : ''),
    );
    if (!isTransient(e)) {
      // A real SQL error — retrying will not help and would obscure the cause.
      if (root.detail) console.error(`  detail: ${root.detail}`);
      if (root.hint) console.error(`  hint: ${root.hint}`);
      console.error('\nNon-transient failure. Migration NOT applied.');
      process.exit(1);
    }
    if (attempt < ATTEMPTS) await wait(5000 * attempt);
  }
}

console.error('\nExhausted retries — network never stabilised. Migration NOT applied.');
process.exit(1);
