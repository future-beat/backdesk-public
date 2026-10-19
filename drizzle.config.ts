/**
 * drizzle-kit is the single migration authority for this repo.
 *
 * The Supabase CLI is used for the local stack only — `supabase db push` is
 * never run here. Two migration systems against one database is the drift trap
 * this project explicitly avoids (01-RESEARCH.md Pattern 1).
 */
import { defineConfig } from 'drizzle-kit';

// Node 22 built-in — no dotenv dependency. Values already in process.env win,
// so CI secrets override the local file automatically.
if (!process.env.MIGRATE_DATABASE_URL) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // No .env.local (e.g. CI): rely on the ambient environment.
  }
}

const url = process.env.MIGRATE_DATABASE_URL;
if (!url) {
  throw new Error(
    'MIGRATE_DATABASE_URL is not set. Migrations need the session/direct connection ' +
      '(port 5432), NOT the transaction pooler (6543) — see docs/env-vars.md.',
  );
}

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
  // Supabase owns anon/authenticated/service_role — drizzle must not try to
  // create or drop them.
  entities: { roles: { provider: 'supabase' } },
});
