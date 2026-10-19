/**
 * Read-only database status probe.
 *
 * Reports which migrations drizzle recorded, whether the tenancy tables exist,
 * and whether RLS is enabled on them. Prints no secrets and no row data.
 */
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

const sql = postgres(url, { prepare: false, connect_timeout: 20, max: 1 });

try {
  const applied = await sql`
    SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at
  `.catch(() => null);
  console.log(
    'migrations recorded:',
    applied ? applied.length : '(drizzle.__drizzle_migrations does not exist yet)',
  );

  const tables = await sql`
    SELECT tablename, rowsecurity
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `;
  console.log('public tables:');
  for (const t of tables) console.log(`  ${t.tablename}  rowsecurity=${t.rowsecurity}`);

  const policies = await sql`
    SELECT tablename, policyname, cmd, roles
    FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname
  `;
  console.log('policies:');
  for (const p of policies) {
    console.log(`  ${p.tablename}.${p.policyname} cmd=${p.cmd} roles=${p.roles}`);
  }

  const fns = await sql`
    SELECT proname FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND proname IN ('has_tenant_access', 'create_tenant')
    ORDER BY proname
  `;
  console.log('functions:', fns.map((f) => f.proname).join(', ') || '(none)');

  const idx = await sql`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'tenants_name_lower_key'
  `;
  console.log('tenants_name_lower_key index:', idx.length > 0);

  const ext = await sql`
    SELECT extname FROM pg_extension WHERE extname IN ('pg_cron','pg_net','pgmq') ORDER BY extname
  `;
  console.log('extensions:', ext.map((e) => e.extname).join(', ') || '(none)');

  // Phase 12 (12-03): the CHECKs migration 0039 WIDENED, read back from the
  // catalog. Definitions only — a constraint definition carries no row data.
  const widened = await sql`
    SELECT conrelid::regclass::text AS tbl, conname, convalidated,
           pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE contype = 'c' AND connamespace = 'public'::regnamespace
      AND conname IN ('messaging_config_channel_known',
                      'messaging_config_audit_channel_known',
                      'tenant_proofs_kind_known')
    ORDER BY tbl, conname
  `;
  console.log('widened checks:');
  for (const c of widened) {
    console.log(`  ${c.tbl}.${c.conname} validated=${c.convalidated} ${c.def}`);
  }

  // Text-back stays unarmable until plan 12-08: two integers, no row. Guarded
  // so the script still runs against a database that predates 0039's widening.
  const textBack = await sql`
    SELECT count(*)::int AS rows,
           count(*) FILTER (WHERE enabled)::int AS enabled
    FROM messaging_config WHERE channel = 'text_back'
  `.catch(() => null);
  console.log(
    'messaging_config text_back:',
    textBack ? `rows=${textBack[0].rows} enabled=${textBack[0].enabled}` : '(unreadable)',
  );
} finally {
  await sql.end();
}
