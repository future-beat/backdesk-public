/**
 * Connection diagnostic. Prints STRUCTURE only — never a password, never a key.
 *
 * Answers: do the two configured Postgres URLs point where they should, and does
 * each hostname actually resolve? Supabase's legacy `db.<ref>.supabase.co` direct
 * host is IPv4-unreachable on current projects, which surfaces as drizzle-kit
 * hanging rather than as a clear error.
 */
import dns from 'node:dns/promises';

try {
  process.loadEnvFile('.env.local');
} catch {
  // rely on ambient env
}

function shape(name) {
  const raw = process.env[name];
  if (!raw) return { name, present: false };
  try {
    const u = new URL(raw);
    return {
      name,
      present: true,
      host: u.hostname,
      port: u.port || '(default 5432)',
      user: u.username,
      hasPassword: u.password.length > 0,
      database: u.pathname.replace(/^\//, ''),
    };
  } catch (e) {
    return { name, present: true, parseError: e.message };
  }
}

for (const name of ['DATABASE_URL', 'MIGRATE_DATABASE_URL']) {
  const s = shape(name);
  console.log(`\n=== ${name} ===`);
  if (!s.present) {
    console.log('  NOT SET');
    continue;
  }
  if (s.parseError) {
    console.log('  UNPARSEABLE:', s.parseError);
    continue;
  }
  console.log(`  host     : ${s.host}`);
  console.log(`  port     : ${s.port}`);
  console.log(`  user     : ${s.user}`);
  console.log(`  database : ${s.database}`);
  console.log(`  password : ${s.hasPassword ? 'present (not shown)' : 'MISSING'}`);
  try {
    const addrs = await dns.lookup(s.host, { all: true });
    console.log(`  dns      : resolves -> ${addrs.map((a) => `IPv${a.family}`).join(', ')}`);
  } catch (e) {
    console.log(`  dns      : DOES NOT RESOLVE (${e.code})`);
  }
}

console.log('\nExpected shape:');
console.log('  DATABASE_URL         host *.pooler.supabase.com  port 6543  (transaction)');
console.log('  MIGRATE_DATABASE_URL host *.pooler.supabase.com  port 5432  (session)');
