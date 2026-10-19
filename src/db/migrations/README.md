# Migrations

Applied with `npm run db:migrate` (which runs `scripts/migrate.mjs`, **not** bare
`drizzle-kit migrate` — the CLI exits 0 when a connection drops mid-run, which
looks like success on a database where nothing was applied).

Migrations must run over the **session** connection (port 5432).
`MIGRATE_DATABASE_URL` is checked for this; the transaction pooler (6543) cannot
hold the advisory locks DDL needs.

## Hand-written objects are invisible to the drizzle snapshots

`meta/*_snapshot.json` describes only what drizzle can model from
`src/db/schema/`. Several load-bearing objects are hand-written SQL and appear in
**no** snapshot — drizzle believes they do not exist:

| Object | Defined in | Kind |
|---|---|---|
| `has_tenant_access(uuid)` | `0000_extensions_and_tenant_access.sql` | SECURITY DEFINER function |
| `pg_cron`, `pg_net`, `pgmq` | `0000_extensions_and_tenant_access.sql` | extensions |
| `create_tenant(...)` | `0002_create_tenant_rpc.sql` | SECURITY DEFINER function |
| `tenants_name_lower_key` | `0002_create_tenant_rpc.sql` | unique index on `lower(name)` |
| table GRANTs / REVOKEs | `0003`, `0005` | privileges |
| tenant CHECK constraints | `0004_tenant_constraints.sql` | constraints |
| `tenants_validate_timezone_trg` | `0004_tenant_constraints.sql` | trigger |

Consequences to respect:

- A future `drizzle-kit generate` that adds the same index from the schema file
  will emit a bare `CREATE UNIQUE INDEX` that **fails** against the live
  database. Check generated SQL before applying it.
- `drizzle-kit push` / `pull` will diverge harder — do not use them here.
- Keep writing custom SQL with `IF NOT EXISTS` / `CREATE OR REPLACE` /
  `DROP ... IF EXISTS` first, as every migration in this directory already does,
  so re-running is always a no-op.

## Open decision: `pg_net` / `pg_cron` / `pgmq` are enabled before use (WR-13)

`0000` enables all three "because it is cheap and forward-compatible", two
phases before anything uses them. `pg_net` in particular gives the database the
ability to make arbitrary outbound HTTP requests — an SSRF primitive inside the
trust boundary — and `pg_cron` can schedule arbitrary SQL.

**Measured state on the hosted project (not what the code implies):**

| Schema | Owner | anon/authenticated USAGE | Reachable via PostgREST |
|---|---|---|---|
| `net` | `supabase_admin` | **yes** (+ EXECUTE on `http_post`, `http_get`, `http_delete`) | no |
| `cron` | `supabase_admin` | no | no |
| `pgmq` | `postgres` | no | no |

**The obvious fix does not work.** `REVOKE ALL ON SCHEMA net FROM anon,
authenticated` is a no-op here: `net` is owned by the superuser
`supabase_admin`, migrations connect as `postgres`, and a REVOKE by a non-owner
without grant option emits `WARNING: no privileges could be revoked` and exits
successfully. A migration containing it would report success while changing
nothing — worse than not writing it, because it reads like a control.

**What holds instead:** anon and authenticated only reach this database through
PostgREST, which exposes `public` and `graphql_public` only
(`supabase/config.toml`). `net.*` is therefore not callable by them.
`tests/rls-coverage.test.ts` asserts both that boundary and the `cron`/`pgmq`
schema privileges, so a config change that exposes `net` fails CI.

**Trigger condition — revisit when Phase 3 wires up the cadence tick.** The
durable fix is to stop enabling these in `0000` and enable each in the phase that
uses it, so the SSRF primitive is not sitting in production during Phases 1–2. If
the platform grant on `net` is ever to be removed rather than merely contained,
it needs a Supabase dashboard action or support request — it is not reachable
from a migration.

## Open decision: `tenants_name_lower_key` is global, not per-operator (WR-11)

`0002` creates:

```sql
CREATE UNIQUE INDEX tenants_name_lower_key ON public.tenants (lower(name));
```

That index spans the **whole table**, not the caller's membership set. It is
correct for the current single-operator MVP and it is what makes a double submit
produce one client instead of two.

It becomes wrong the moment a **second operator** exists:

- Operator B typing a client name operator A already onboarded gets
  "A client with that name already exists" — for a row RLS says they cannot see.
  That is a cross-tenant existence oracle, the exact inversion of the
  denial-vs-absence property (`T-03-02`) the rest of the phase protects.
- It also hard-blocks two operators from legitimately onboarding two different
  businesses that happen to share a trading name, which is common in the trades.

**Trigger condition — revisit before provisioning a second operator account**,
not after. `tenant_members.role` already anticipates more than one member, and
the v2 reports portal would introduce client logins.

**Intended fix when that happens:** add an explicit `owner_user_id` column set by
`create_tenant()` and replace the index with a unique index on
`(owner_user_id, lower(name))`. Both the duplicate-name mapping in
`src/core/shared/tenant.ts` (`DUPLICATE_NAME_INDEX`) and the collision test in
`tests/tenant-create.test.ts` need updating in the same change.
