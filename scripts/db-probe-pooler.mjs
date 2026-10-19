/**
 * Identify which Supavisor pooler shard hosts this project.
 *
 * Supabase's pooler hostname carries a shard prefix (aws-0, aws-1, ...) that is
 * NOT derivable from the project ref — the authoritative source is the dashboard
 * Connect panel. When the wrong shard is used, Supavisor answers
 * "tenant/user <user> not found" (XX000) rather than a connection error.
 *
 * This probe reuses the credentials already in MIGRATE_DATABASE_URL and only
 * swaps the hostname. It runs SELECT 1 and prints host + outcome. It never
 * prints a password, a key, or a full connection string.
 */
import postgres from 'postgres';

try {
  process.loadEnvFile('.env.local');
} catch {
  // rely on ambient env
}

const base = process.env.MIGRATE_DATABASE_URL;
if (!base) {
  console.error('MIGRATE_DATABASE_URL is not set');
  process.exit(1);
}

const candidates = [
  'aws-0-ap-southeast-2.pooler.supabase.com',
  'aws-1-ap-southeast-2.pooler.supabase.com',
];

let winner = null;

for (const host of candidates) {
  const u = new URL(base);
  u.hostname = host;
  const sql = postgres(u.toString(), { prepare: false, connect_timeout: 15, max: 1 });
  try {
    await sql`SELECT 1`;
    console.log(`${host}:${u.port}  ->  OK`);
    winner ??= host;
  } catch (e) {
    console.log(`${host}:${u.port}  ->  ${e.code ?? 'ERR'}: ${e.message}`);
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

console.log(
  winner
    ? `\nCorrect pooler host for this project: ${winner}`
    : '\nNeither shard accepted the credentials.',
);
