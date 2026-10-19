# Phase 2: ServiceM8 Sync & Quote Leakage Audit - Pattern Map

**Mapped:** 2026-08-26
**Files analyzed:** 28 new/modified files
**Analogs found:** 20 / 28 (8 have no in-repo analog — RESEARCH.md Code Examples cover them)

The codebase is Phase-1-only (~25 source files), so analogs cluster around five exemplars: `src/db/schema/tenants.ts` (all schema files), `src/db/repository/for-tenant.ts` (all repository work), `src/core/shared/env.ts` (all `src/core` modules), `src/app/(console)/clients/new/actions.ts` (all server actions), and the two clients pages (all console pages). RESEARCH.md §Code Examples supplies skeletons for the genuinely-new shapes (Sm8Client, cursor, transitions, crypto, tick route) — treat those as the "analog" where no repo file exists.

## File Classification

### Schema + migrations

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/db/schema/sm8-connections.ts` | model | CRUD | `src/db/schema/tenants.ts` | exact |
| `src/db/schema/quotes.ts` | model | CRUD | `src/db/schema/tenants.ts` | exact |
| `src/db/schema/quote-events.ts` | model | event-driven (outbox) | `src/db/schema/tenants.ts` | role-match (schema style exact; outbox shape from RESEARCH Pattern 3) |
| `src/db/schema/sync-runs.ts` | model | batch log | `src/db/schema/tenants.ts` | exact |
| `src/db/schema/prospects.ts` (+ prospect_quote_lines) | model | CRUD | `src/db/schema/tenants.ts` (esp. `tenantMembers` for a narrower policy) | role-match (no `tenant_id` → operator-only policy, new helper) |
| `src/db/schema/index.ts` | config (barrel) | — | itself (modify) | exact |
| migrations: grants for ~6 new tables | migration | — | `src/db/migrations/0003_table_grants.sql` | exact |
| migrations: cron schedules (sync tick, purge, cron-details cleanup) | migration | — | `src/db/migrations/0000_extensions_and_tenant_access.sql` (custom SQL migration style) + RESEARCH Pattern 2 SQL | role-match |
| migration: `is_operator()` / prospect policy helper | migration | — | `src/db/migrations/0002_create_tenant_rpc.sql` (SECURITY DEFINER function style) | role-match |

### Repository

| File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/db/repository/for-tenant.ts` (extend: quotes, connection) | repository | CRUD | itself | exact |
| `src/db/repository/for-all-tenants.ts` (`forAllTenants_syncTick`) | repository | batch | `src/db/repository/for-tenant.ts` (header documents this exact convention) | exact-by-decree |

### Core (framework-free) modules

| File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/core/servicem8/client.ts` | service (HTTP client) | request-response | RESEARCH §Code Examples "Thin typed client"; repo style from `src/core/shared/env.ts` | no repo analog |
| `src/core/servicem8/schemas.ts` | validation | transform | `src/core/shared/env.ts` (zod schema + typed exports) + RESEARCH zod example | role-match |
| `src/core/servicem8/types.ts`, `pagination.ts` | utility | — | `src/core/shared/tenant.ts` (pure shared module style) | role-match |
| `src/core/sync/run-sync.ts` | service (orchestrator) | batch | none — RESEARCH Architecture Diagram + Pattern 1/3/5 | no analog |
| `src/core/sync/cursor.ts`, `transitions.ts`, `failure-policy.ts` | utility (pure) | transform | RESEARCH §Code Examples (cursor, transitions given verbatim) | no repo analog |
| `src/core/audit/aggregate.ts`, `followup.ts`, `csv-mapping.ts`, `constants.ts` | utility (pure) | transform | `src/core/shared/tenant.ts` for module style; logic from RESEARCH Pattern 6/7 | role-match |
| `src/core/alerts/operator-email.ts` | service | request-response | `src/core/servicem8/client.ts` (built same wave — thin typed fetch/SDK wrapper, typed outcome) | role-match |
| `src/core/shared/crypto.ts` | utility | transform | RESEARCH §Code Examples AES-256-GCM (verbatim) | no repo analog |
| `src/core/shared/env.ts` (extend: `CREDENTIALS_ENCRYPTION_KEY`, `SYNC_TICK_SECRET`, Resend key) | config | — | itself | exact |

### Routes, proxy, console

| File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/app/api/internal/sync-tick/route.ts` | route (internal worker) | request-response | RESEARCH route skeleton; no repo route handlers exist yet | no repo analog |
| `proxy.ts` (modify matcher: exclude `api/`) | middleware | request-response | itself | exact |
| `src/app/(console)/page.tsx` (add health badge + last-sync) | component (server) | request-response | itself | exact |
| `src/app/(console)/clients/[id]/page.tsx` (sync runs, quote list, triage) | component (server) | request-response | itself | exact |
| Connect-form action (save/verify API key) + triage/CSV actions | server action | request-response | `src/app/(console)/clients/new/actions.ts` | exact |
| Connect/CSV forms | component (client) | request-response | `src/app/(console)/clients/new/form.tsx` | exact |
| `src/app/(console)/audits/new/page.tsx`, `audits/[id]/page.tsx` | component (server) | request-response | `clients/new/page.tsx` + `clients/[id]/page.tsx` | role-match (print CSS is new) |

### Tests

| File | Role | Closest Analog | Match Quality |
|---|---|---|---|
| Pure-logic tests (cursor, transitions, failure-policy, schemas, crypto, aggregate, csv-mapping) | test (unit) | `tests/tenant-validation.test.ts` style; Vitest | role-match |
| Integration tests (sync-upsert, quote-events, connect, purge, baseline) | test (integration, real DB) | `tests/leak.test.ts` + `tests/helpers/seed.ts` | exact |
| `tests/rls-coverage.test.ts` (extend grants map + presence list) | test | itself | exact |
| `tests/helpers/seed.ts` (extend for new tables) | test helper | itself | exact |
| `tests/sync-tick-route.test.ts` | test (route) | `tests/auth-security.test.ts` (HTTP-level assertions) | role-match |

## Pattern Assignments

### All new schema files → copy `src/db/schema/tenants.ts`

**Imports + table shape** (lines 12-23, 25-51): `pgTable(name, columns, () => [pgPolicy(...)])` — policy attached in schema so RLS is auto-enabled; `authenticatedRole` from `drizzle-orm/supabase`; `sql`-templated `using`/`withCheck` calling `has_tenant_access(tenant_id)`:

```typescript
import { sql } from 'drizzle-orm';
import { pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

export const tenants = pgTable(
  'tenants',
  { id: uuid('id').primaryKey().defaultRandom(), /* ... */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow() },
  () => [
    pgPolicy('tenants_member_access', {
      as: 'permissive', for: 'all', to: authenticatedRole,
      using: sql`has_tenant_access(id)`, withCheck: sql`has_tenant_access(id)`,
    }),
  ],
);
export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
```

- Tenant-scoped tables (`sm8_connections`, `quotes`, `quote_events`, `sync_runs`): `tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' })` (per `tenantMembers`, lines 56-58) and policy `using: sql\`has_tenant_access(tenant_id)\``.
- Prospect tables: no `tenant_id` — write a deliberately narrower policy per the `tenant_members_select_own` example (lines 66-71); RESEARCH Pattern 6 recommends an `is_operator()` SECURITY DEFINER helper. Never `using(true)` — `tests/rls-coverage.test.ts` lines 82-100 fails any policy whose qual is literally `'true'`.
- Doc-comment conventions: file-header JSDoc explaining the why; `/** */` on non-obvious columns (see the IANA timezone comment, line 32). Money columns: `numeric(12,2)` per RESEARCH Pitfall 4.

### Grants migration → copy `src/db/migrations/0003_table_grants.sql`

Per-table block, `--> statement-breakpoint` between statements, anon keeps SELECT so denial and absence are indistinguishable (T-03-02):

```sql
GRANT SELECT ON public.tenants TO anon;
--> statement-breakpoint
GRANT SELECT, UPDATE, DELETE ON public.tenants TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.tenants TO service_role;
```

Header comment (lines 20-23): "EVERY NEW TABLE NEEDS ITS OWN BLOCK HERE. Deliberately not doing this with a blanket ALTER DEFAULT PRIVILEGES." Grants must exactly mirror what the policy allows — the rls-coverage grants test (see below) asserts the full map.

**Also required:** extend `tests/rls-coverage.test.ts` — (a) the `IN ('tenants','tenant_members')` list and expected-privileges object in the WR-04 test (lines 116-142) must enumerate every new table; (b) the presence test (lines 144-153) gains `expect(names).toContain(...)` for each.

### `src/db/repository/for-all-tenants.ts` → follow the rule stated in `src/db/repository/for-tenant.ts`

The convention is documented in the analog's header (lines 12-15): cross-tenant work gets "explicitly-named exports of the form `forAllTenants_<operation>()` so a reviewer can grep one string." Copy from `for-tenant.ts`:
- Construction-time validation that throws loudly (UUID_PATTERN guard, lines 34-35, 75-79)
- `getDb()` from `./client` as the only DB handle (line 21, 83)
- Runtime IMMUTABLE_KEYS/unknown-key enforcement on any `update`-style patch (lines 47-56, 91-106) — replicate for quote/connection patch surfaces
- Extend `TenantScopedRepository` with `quotes` and `connection` namespaces mirroring the `tenant: { get, update }` shape (lines 58-68)

### Core modules (`src/core/servicem8/*`, `sync/*`, `audit/*`, `alerts/*`, `shared/crypto.ts`) → style from `src/core/shared/env.ts`, logic from RESEARCH

House rules visible in `env.ts`:
- Header comment: "`src/core` is framework-free by contract — nothing here imports from `next/*`" (lines 3-4). Applies to every new core module.
- zod schema + `z.infer` exported types + lazy parse with cached module-level singleton + human-readable failure via a `describe()` helper (lines 12-36, 38-62).
- New env vars: add to `serverEnvSchema` (lines 12-20) with an explicit `process.env.X` reference in the `safeParse` object (lines 53-57 — no dynamic lookup): `CREDENTIALS_ENCRYPTION_KEY`, `SYNC_TICK_SECRET`, `RESEND_API_KEY`, alert-recipient address.

Core-pattern code for client.ts, schemas.ts, cursor.ts, transitions.ts, crypto.ts, and the tick route is given ready-to-adapt in `02-RESEARCH.md` §Code Examples (lines ~497-646) — planner should reference those excerpts verbatim rather than invent alternatives: `Sm8Result` typed outcome union (never throw with headers attached; never log the key), `sm8Timestamp`/`sm8Money` zero-date coercions with `.passthrough()`, opaque `filterFrom`/`advanceCursor`, total `classifyTransition`, `enc:v1:` AES-256-GCM format, `timingSafeEqual` bearer check with `maxDuration = 300`.

### Server actions (connect form, triage, CSV upload, create-audit) → copy `src/app/(console)/clients/new/actions.ts`

**`use server` + state shape for `useActionState`** (lines 1, 30-36, 65-68): return `{ errors, formError, values }` on failure, navigate only on success, echo values back so a rejected submit never costs the operator the form.

**Auth check FIRST in every action** (lines 79-94) — this is the WR-01 rule and non-negotiable for the new actions (connect saves a live API key):

```typescript
// Authorize the caller HERE, not only at the edge (WR-01). Server Action IDs
// are global: this action can be invoked by POSTing its ID to any route...
const supabase = await createClient();
const { data: claims } = await supabase.auth.getClaims();
if (!claims?.claims) {
  return { errors: {}, formError: 'Your session has expired. Sign in again.', values };
}
```

**Boundary re-validation** (lines 96-99): `schema.safeParse(values)` server-side regardless of browser constraints; `readString(formData, key)` helper (lines 39-42) for FormData coercion; known-error mapping to field errors, generic message otherwise (lines 112-124); `revalidatePath` + `redirect` on success (lines 128-129).

**Deviation for connect:** the connect action writes ciphertext via the service-role repository path (`forTenant(...)`), not the anon client — the plaintext key must never be inserted through PostgREST and never returned to the browser (RESEARCH Pattern 4: verify with a live test call → encrypt → store; render `key_last4` only).

### Console pages (health badge, quote list, audit pages) → copy `src/app/(console)/page.tsx` and `clients/[id]/page.tsx`

- `export const dynamic = 'force-dynamic'` with the session comment (list page lines 6-7).
- Reads through the AUTHENTICATED server client so RLS decides visibility (list lines 10-21); deterministic ordering with `id` tiebreaker (lines 19-21).
- Error branch renders `<p className="error" role="alert">`, never throws (list lines 23-32); detail page distinguishes error vs not-found (detail lines 71-90).
- Detail page: `params: Promise<{ id }>` + `await params` (Next 16), UUID_PATTERN pre-check → `notFound()` (detail lines 48-56); `maybeSingle()` + null → `notFound()`.
- Badge markup already exists: `<span className="badge">{tenant.status}</span>` (detail line 104) — health badge extends this; badge value is DERIVED per RESEARCH Pattern 5, never stored.
- Timezone-aware timestamp rendering with fallback-to-UTC try/catch: `formatCreatedAt` (detail lines 33-46) — copy for last-sync times and audit dates.
- Audit report page (`audits/[id]`): same server-component shape; add `@page` print CSS in `globals.css` (D-11) — no analog, no library.

### `proxy.ts` (modify)

Current matcher (line 25): `'/((?!_next/static|_next/image|favicon.ico|login$|login/).*)'` — RESEARCH Pitfall 7: it swallows `/api/internal/sync-tick` with a 307 to `/login`. Add `api/` to the exclusion; keep the anchored-exclusion comment style (lines 21-24) and add a comment that API routes own their auth (consistent with the WR-01 header, lines 10-14).

### Integration tests → copy `tests/helpers/seed.ts` + `tests/leak.test.ts` conventions

- Service-role `admin` client confined to seeding/teardown (seed lines 20-26); timestamped unique names (line 111); teardown via cascade delete (lines 141-145); `signInAsOperator()` for the client RLS actually governs (lines 148-156).
- Extend `seedTwoTenants` (or add sibling seeders) for connections/quotes so the leak test proves tenant-B's quotes are invisible to A's operator.
- Direct-postgres catalog assertions where PostgREST can't reach (rls-coverage lines 12-27: `postgres(testEnv.migrateDatabaseUrl, { prepare: false, max: 1 ... })` + `afterAll` end).
- Idempotent-and-race-safe fixture creation pattern (seed lines 83-101) if any new fixture creates shared state.

## Shared Patterns

### RLS triple control (every new table)
**Sources:** `src/db/schema/tenants.ts` (pgPolicy in schema) + `src/db/migrations/0003_table_grants.sql` (explicit grants) + `tests/rls-coverage.test.ts` / `tests/leak.test.ts` (standing guards). A table ships with all three or the suite goes red — the coverage test scans `pg_tables` for `rowsecurity = false`, policyless tables, and `USING(true)` policies automatically; the grants test must be extended by hand.

### Loud construction-time validation
**Source:** `src/db/repository/for-tenant.ts` lines 70-79. Apply to: `forAllTenants_syncTick`, `createSm8Client`, `decryptCredential` (unknown version throws), cursor functions. Programming errors throw immediately; they never degrade into wrong result sets.

### zod at every boundary + typed outcomes over throws
**Sources:** `src/core/shared/env.ts` (env), `src/core/shared/tenant.ts` via `actions.ts` (form input). Apply to: SM8 responses (`parse_error` outcome), CSV rows, tick-route payloads. External-call failures are typed unions (`Sm8Result`), not exceptions carrying secrets.

### Denial-indistinguishable-from-absence
**Sources:** anon SELECT grants (0003 header lines 16-18) + detail-page RLS-scoped read comment (`clients/[id]/page.tsx` lines 60-62). Apply to all new tables' grants and all new console reads.

### Comment discipline
Every Phase 1 file carries a header JSDoc explaining *why* (often citing requirement IDs, threat IDs, research patterns). New files should cite D-xx decisions and RESEARCH pattern numbers the same way.

## No Analog Found

Files where the planner should lift from `02-RESEARCH.md` §Code Examples / Patterns instead of the repo:

| File | Role | Data Flow | Source to use |
|---|---|---|---|
| `src/core/servicem8/client.ts` | HTTP client | request-response | RESEARCH "Thin typed client" excerpt |
| `src/core/sync/cursor.ts` | pure utility | transform | RESEARCH "Opaque cursor" excerpt |
| `src/core/sync/transitions.ts` | pure utility | transform | RESEARCH "Transition classification" excerpt |
| `src/core/sync/run-sync.ts` | orchestrator | batch | RESEARCH Patterns 1/3/5 + Architecture Diagram |
| `src/core/shared/crypto.ts` | crypto utility | transform | RESEARCH "AES-256-GCM" excerpt (verbatim) |
| `src/app/api/internal/sync-tick/route.ts` | route handler | request-response | RESEARCH "Sync-tick route skeleton" (first route handler in the repo) |
| pg_cron schedule migrations | migration | event-driven | RESEARCH Pattern 2 SQL (secret via Vault or script — A7) |
| Audit print CSS | styling | — | none; `@page` CSS in `globals.css`, D-11 |

## Metadata

**Analog search scope:** `src/` (25 files), `tests/` (9 files), `scripts/`, `proxy.ts`, `src/db/migrations/` — exhaustive; the repo is small enough that every file was enumerated.
**Files read in full:** tenants.ts, for-tenant.ts, env.ts, clients/new/actions.ts, clients/[id]/page.tsx, (console)/page.tsx, proxy.ts, rls-coverage.test.ts, helpers/seed.ts, 0003_table_grants.sql
**Pattern extraction date:** 2026-08-26
