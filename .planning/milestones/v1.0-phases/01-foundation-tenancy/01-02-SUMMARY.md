---
phase: 01-foundation-tenancy
plan: 02
subsystem: infra
tags: [nextjs, supabase, drizzle, postgres, rls, auth, vitest, typescript, multi-tenancy]

requires:
  - phase: 01-01
    provides: External registration clocks (ServiceM8 partner, AU number) — independent of this plan's code path
provides:
  - Next.js 16.3.2 App Router scaffold with all dependencies pinned to registry-verified versions
  - tenants + tenant_members schema with RLS enabled from the first migration set
  - drizzle-kit established as the single migration authority, with a 3-migration journal applied to the live Sydney project
  - SECURITY DEFINER has_tenant_access() membership lookup used by every tenant policy
  - create_tenant() RPC — transactional tenant + operator-membership insert, granted to authenticated only
  - "@supabase/ssr auth layer: server/browser client factories + proxy.ts session refresh and route gating"
  - Operator login, console shell, client list, and create-client form wired end-to-end
  - Vitest 4 infrastructure with two integration suites against hosted Supabase
  - Runnable tracer verification script (scripts/verify-tracer.mjs)
affects: [servicem8-sync, cadence-engine, sms-email-delivery, ai-drafting, approval-queue, attribution-reporting]

actuals:
  tokens: 22600
  tasks: 3
  commits: 2

tech-stack:
  added:
    - next@16.3.2
    - react@19.2.8 / react-dom@19.2.8
    - "@supabase/supabase-js@2.112.4"
    - "@supabase/ssr@0.12.5"
    - drizzle-orm@0.45.2
    - drizzle-kit@0.31.10
    - postgres@3.4.9
    - zod@4.4.3
    - vitest@4.1.11
    - supabase@2.115.0 (CLI, dev only)
    - typescript@~5.9.3
  patterns:
    - "RLS policies authored in TypeScript via pgPolicy — attaching a policy auto-enables RLS, so a new table cannot ship unprotected by omission"
    - "Membership-lookup authorization through a SECURITY DEFINER helper, never JWT metadata"
    - "Console reads and writes use the authenticated client (anon key + operator JWT) so RLS is exercised continuously"
    - "Tenant creation via SECURITY DEFINER RPC to resolve the RLS chicken-and-egg in one transaction"
    - "drizzle-kit as sole migration authority; platform SQL lands as --custom migrations in the same journal"
    - "Deterministic list ordering: created_at DESC with id DESC as tiebreaker"
    - "Dependency-free env loading via Node 22 process.loadEnvFile; ambient environment always wins over the file"

key-files:
  created:
    - src/db/schema/tenants.ts
    - src/db/migrations/0000_extensions_and_tenant_access.sql
    - src/db/migrations/0001_tenants_and_members.sql
    - src/db/migrations/0002_create_tenant_rpc.sql
    - src/core/shared/env.ts
    - src/lib/supabase/server.ts
    - src/lib/supabase/browser.ts
    - src/lib/supabase/proxy.ts
    - proxy.ts
    - src/app/login/page.tsx
    - src/app/login/actions.ts
    - src/app/(console)/layout.tsx
    - src/app/(console)/page.tsx
    - src/app/(console)/clients/new/page.tsx
    - src/app/(console)/clients/new/actions.ts
    - scripts/verify-tracer.mjs
    - scripts/create-operator.mjs
    - scripts/migrate.mjs
    - tests/tenant-create.test.ts
    - tests/auth-security.test.ts
    - vitest.config.mts
    - docs/env-vars.md
  modified:
    - package.json
    - .gitignore
    - next.config.ts
    - src/app/layout.tsx

key-decisions:
  - "Applied migrations through scripts/migrate.mjs (drizzle-orm programmatic migrator) instead of the drizzle-kit CLI, because the CLI exits 0 when a connection drops mid-run — a false success that would have left the phase unverified"
  - "Dropped the create-next-app Geist webfonts for system fonts: removes a build-time network dependency and speeds first paint on a phone"
  - "Typed RootLayout explicitly rather than with Next's generated LayoutProps global, so tsc --noEmit passes on a clean checkout before any build"
  - "vitest.config.mts rather than .ts — the CommonJS config loader warns on ESM syntax today and will reject it in a future Vite major"
  - "Login and create-client forms post to server actions and redirect with an error code, keeping both pages zero-client-JS server renders"
  - "MIGRATE_DATABASE_URL and DATABASE_URL must use the session (5432) and transaction (6543) poolers on aws-0-ap-southeast-2; the legacy db.<ref>.supabase.co direct host is IPv6-only and unreachable from IPv4 networks"

patterns-established:
  - "Migration ordering: a plpgsql helper function is created before the tables it reads, because plpgsql resolves table references at call time while CREATE POLICY resolves functions at DDL time"
  - "Every operational script loads env the same way and retries only genuinely transient network failures, never assertion failures"
  - "Security posture that lives in a vendor dashboard (signups disabled) is pinned by an assertion in the test suite"

requirements-completed: [ONB-01, ONB-05]

coverage:
  - id: D1
    description: "Operator can sign in at /login with email+password; unauthenticated requests to any console route redirect to /login"
    requirement: ONB-01
    verification:
      - kind: integration
        ref: "tests/auth-security.test.ts#accepts the correct operator credentials"
        status: pass
      - kind: integration
        ref: "tests/auth-security.test.ts#rejects a wrong password for the operator account"
        status: pass
      - kind: e2e
        ref: "next start + GET / and /clients/new -> HTTP 307 location /login; GET /login -> 200"
        status: pass
    human_judgment: false
  - id: D2
    description: "Operator can create a client with name, trade type, timezone and contact-hours window, and it appears in the client list"
    requirement: ONB-01
    verification:
      - kind: integration
        ref: "tests/tenant-create.test.ts#persists every profile field and returns the row to its member"
        status: pass
      - kind: e2e
        ref: "node scripts/verify-tracer.mjs (steps 2-4: sign in, RPC create, RLS-scoped readback)"
        status: pass
    human_judgment: false
  - id: D3
    description: "RLS is enabled on every table in migration set 001, with policies keyed on tenant_members membership lookup rather than raw_user_meta_data"
    requirement: ONB-05
    verification:
      - kind: integration
        ref: "tests/auth-security.test.ts#returns zero rows to an unauthenticated reader — never rows, never null"
        status: pass
      - kind: other
        ref: "node scripts/db-status.mjs -> tenants rowsecurity=true, tenant_members rowsecurity=true; both policies scoped to authenticated"
        status: pass
    human_judgment: false
  - id: D4
    description: "create_tenant inserts tenant and operator membership in one transaction; duplicate names collide on a unique index over lower(name)"
    requirement: ONB-01
    verification:
      - kind: e2e
        ref: "node scripts/verify-tracer.mjs (step 5: cascade cleanup leaves no membership residue)"
        status: pass
      - kind: other
        ref: "node scripts/db-status.mjs -> tenants_name_lower_key index present"
        status: pass
    human_judgment: false
  - id: D5
    description: "Public signup is rejected — the project is operator-only"
    verification:
      - kind: integration
        ref: "tests/auth-security.test.ts#rejects public signup — the project must not accept new users"
        status: pass
    human_judgment: false
  - id: D6
    description: "The tenant data path runs against a Supabase project in ap-southeast-2 (Sydney) — AU residency is a committed sales claim"
    verification:
      - kind: other
        ref: "pooler host aws-0-ap-southeast-2.pooler.supabase.com; direct-host AAAA 2406:da1c:… in AWS Sydney range"
        status: pass
    human_judgment: true
    rationale: "Hostname and IP range are strong evidence but not an authoritative residency attestation; only the Supabase dashboard project settings confirm the region of record."
  - id: D7
    description: "Console usability on a phone — the operator signs in and creates a real client between sales meetings"
    requirement: ONB-01
    verification: []
    human_judgment: true
    rationale: "The plan defers this to an end-of-phase human check on a real device; layout, tap targets and form flow are judgment calls no assertion covers."

duration: ~55 min active (4h 15m elapsed including three checkpoint round-trips)
completed: 2026-08-25
status: complete
---

# Phase 1 Plan 02: Walking Skeleton Summary

**Operator login through to an RLS-protected client tenant created via a SECURITY DEFINER RPC in Sydney Postgres — Next 16 + @supabase/ssr + drizzle-authored policies, proven end-to-end by a runnable five-step tracer.**

## Performance

- **Duration:** ~55 min active execution; 4h 15m elapsed including three human checkpoints
- **Tasks:** 3 (1 checkpoint, 1 tracer, 1 auto)
- **Files created/modified:** 47
- **Commits:** 2 task commits + 1 metadata commit

## Accomplishments

- **The walking skeleton runs.** One path touches every layer Phase 1 owns — scaffold, schema with RLS, applied migration, operator auth, a real UI write, a real UI read — and `scripts/verify-tracer.mjs` proves it in five assertions against the live Sydney project.
- **RLS is load-bearing from migration 001.** Both tables report `rowsecurity=true`; anon reads return `[]` on both. Policies resolve through a `SECURITY DEFINER` membership lookup, never user-modifiable JWT metadata.
- **Migration authority is settled.** Three migrations in one drizzle journal, applied to the live database. No `supabase db push`, no second authority to drift against.
- **The console exercises its own security.** Every read and write goes through the authenticated client (anon key + operator JWT), so the policies are tested on every interaction rather than rotting until a v2 client portal makes them matter.
- **Guarantees are now continuously verifiable.** 8 Vitest assertions across 2 suites, self-seeding and self-cleaning, including one that pins a Supabase dashboard toggle that code review cannot see.

## Task Commits

1. **Task 1: Package legitimacy verification** — checkpoint, no commit (human-approved before any install)
2. **Task 2: Tracer — scaffold, schema + migrate, auth, create-client slice** — `19828d8` (feat)
3. **Task 3: Vitest infrastructure + integration tests** — `c0ec2be` (test)

## Files Created/Modified

- `src/db/schema/tenants.ts` — tenants + tenant_members with `pgPolicy` RLS
- `src/db/migrations/0000_extensions_and_tenant_access.sql` — pg_cron/pg_net/pgmq + `has_tenant_access()`
- `src/db/migrations/0001_tenants_and_members.sql` — generated tables and policies
- `src/db/migrations/0002_create_tenant_rpc.sql` — `create_tenant()`, grants, unique index on `lower(name)`
- `src/core/shared/env.ts` — zod v4 server/client env split; server getter throws if reached from the browser
- `src/lib/supabase/{server,browser,proxy}.ts` — client factories and session refresh
- `proxy.ts` — Next 16 route gating via signature-verifying `getClaims()`
- `src/app/login/*`, `src/app/(console)/*` — login, console shell, client list, create-client form
- `scripts/verify-tracer.mjs` — the five-step end-to-end proof
- `scripts/migrate.mjs`, `scripts/create-operator.mjs`, `scripts/db-{status,diagnose,probe-pooler}.mjs` — operational tooling
- `tests/{tenant-create,auth-security}.test.ts`, `tests/helpers/env.ts`, `vitest.config.mts` — test infrastructure
- `docs/env-vars.md` — environment contract (stands in for `.env.example`, see deviations)

## Decisions Made

Captured in `key-decisions` frontmatter. The two with the longest reach:

- **Migrations run through `scripts/migrate.mjs`, not the drizzle-kit CLI.** The CLI exited 0 twice while applying nothing, because the connection dropped mid-run. A migration step that reports success without doing anything is precisely the false-positive state this phase was built to prevent, so the programmatic migrator (same journal, same `drizzle.__drizzle_migrations` table) now runs with cause-aware retry.
- **Both Postgres URLs must use the pooler on `aws-0-ap-southeast-2`.** The legacy `db.<ref>.supabase.co` direct host has only an AAAA record and is unreachable from IPv4 networks. This bit us twice and is now documented in `docs/env-vars.md`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Migration applied via programmatic migrator after the CLI silently no-opped**
- **Found during:** Task 2 (step 5d, the `[BLOCKING]` migrate)
- **Issue:** `npx drizzle-kit migrate` exited 0 with no output and no effect — the network dropped mid-run and the CLI reported success. `drizzle.__drizzle_migrations` did not exist afterwards.
- **Fix:** Added `scripts/migrate.mjs` using `drizzle-orm/postgres-js/migrator` against the same journal and tracking table, with retry that unwraps the cause chain (drizzle re-wraps driver errors as "Failed query" with an undefined `code`, so a network drop is otherwise indistinguishable from a SQL error).
- **Files modified:** `scripts/migrate.mjs`
- **Verification:** `node scripts/db-status.mjs` reports 3 migrations recorded, both tables `rowsecurity=true`, both policies, both functions, the unique index and all three extensions present.
- **Committed in:** `19828d8`

**2. [Rule 3 - Blocking] Removed Geist webfonts from the root layout**
- **Found during:** Task 2 (step 8)
- **Issue:** The scaffold's `next/font/google` imports fetch from Google at build time, making `npm run build` depend on the same flaky network that was already breaking migrations.
- **Fix:** Switched to a system font stack in `globals.css`. Also faster first paint on a phone, which the plan asks for explicitly.
- **Files modified:** `src/app/layout.tsx`, `src/app/globals.css`
- **Verification:** `npm run build` green with no network fetch.
- **Committed in:** `19828d8`

**3. [Rule 1 - Bug] Replaced Next's generated `LayoutProps` global with an explicit type**
- **Found during:** Task 2 (verification)
- **Issue:** `tsc --noEmit` failed with `Cannot find name 'LayoutProps'` — that global only exists after a build has emitted `.next/types`, so typecheck was order-dependent and would fail in CI before the build step.
- **Fix:** Typed `RootLayout` as `{ children: React.ReactNode }`.
- **Files modified:** `src/app/layout.tsx`
- **Verification:** `npx tsc --noEmit` passes on a clean checkout.
- **Committed in:** `19828d8`

**4. [Rule 3 - Blocking] Pinned the Turbopack workspace root**
- **Found during:** Task 2 (verification)
- **Issue:** The build warned that it had ignored `package-lock.json` because it inferred a workspace root outside the git repository — it had walked up and found an unrelated lock file in the home directory.
- **Fix:** Set `turbopack.root` to the repo directory in `next.config.ts`.
- **Files modified:** `next.config.ts`
- **Verification:** Rebuild is warning-free.
- **Committed in:** `19828d8`

**5. [Rule 1 - Bug] `vitest.config.ts` renamed to `.mts`**
- **Found during:** Task 3
- **Issue:** Vite warned that ESM syntax in a CommonJS-loaded config is unsupported by the native config loader and will become the default in a future major.
- **Fix:** Renamed to `vitest.config.mts`. Setting `"type": "module"` instead would have broken `next.config.ts`, which uses `__dirname`.
- **Files modified:** `vitest.config.mts` (was `vitest.config.ts`)
- **Verification:** `npx vitest run` clean, no warning.
- **Committed in:** `c0ec2be`

### Plan artifact not produced

**`.env.example` could not be written.** This workspace has a permission deny rule covering `.env*`, and `Write` was refused. I did not route around it. The full contract — every variable, which component reads it, and the 6543-vs-5432 distinction — is in `docs/env-vars.md`, and `.gitignore` already carries `!.env.example` so the file will be tracked once the operator creates it by copying that block.

---

**Total deviations:** 5 auto-fixed (3 blocking, 2 bugs) + 1 plan artifact deferred to the operator.
**Impact on plan:** No scope creep. Four of the five fixes remove false-positive or order-dependent failure modes from the verification path; the fifth is a forward-compatibility rename.

## Issues Encountered

- **Two rounds lost to Postgres connection configuration.** `.env.local` initially carried the legacy `db.<ref>.supabase.co` direct host, which is IPv6-only. My first correction named the wrong pooler shard (`aws-1`) because I inferred it from a DNS probe that returned a false negative for `aws-0` during a network outage in my sandbox. The correct value is `aws-0-ap-southeast-2.pooler.supabase.com`, confirmed empirically by connecting to both shards. Lesson recorded in `docs/env-vars.md`: the shard prefix is not derivable and must come from the dashboard Connect panel.
- **Public signups were still enabled** when I first probed `/auth/v1/settings`, despite the `user_setup` step. The operator disabled them; `tests/auth-security.test.ts` now asserts this on every run so it cannot silently regress.
- **Sandbox network instability** (intermittent `getaddrinfo` and HTTPS failures with raw TCP unaffected) caused several transient failures. All operational scripts now retry transient errors only, never assertion failures.

## User Setup Required

Two items remain for the operator:

1. **Create `.env.example`** by copying the block in `docs/env-vars.md` — I am blocked from writing `.env*` files.
2. **Confirm the Supabase project region** in the dashboard. Hostname and IP evidence both point to `ap-southeast-2`, but only project settings are authoritative, and AU residency is a committed sales claim (prohibition `ONB-01/privacy`, still `unverified` in the plan frontmatter).

## Next Phase Readiness

**Ready.** Later phases inherit the schema module, the migration journal, the auth layer, env validation, and the test runner. New tables need only a `pgTable` with a `pgPolicy` in `src/db/schema/` plus `drizzle-kit generate`.

**Carried forward:**

- The tracer's `<human-check>` is deliberately deferred to end-of-phase UAT: log in on a phone, create a real client, confirm it lists correctly (coverage D7).
- Plan 01-03 owns the full validation matrix — hour ordering, IANA verification, day-range rules, and mapping the `23505` duplicate-name error to a form message. The unique index and the error-code branch it needs are already in place.
- Plan 01-04 owns `forTenant()`, the ESLint import ban, the two-tenant leak test, and CI. `src/db/repository/` is intentionally empty — no service-role data path exists yet, so nothing currently bypasses RLS.
- The `pg_cron`, `pg_net` and `pgmq` extensions are enabled but no schedules exist; Phase 3 adds those.

## Self-Check: PASSED

- All 23 key files verified present on disk.
- Both task commits verified in git history (`19828d8`, `c0ec2be`).
- Plan verification re-run at close-out: `tsc --noEmit` PASS, `next build` PASS, `verify-tracer.mjs` 5/5 PASS, `vitest run` 8/8 PASS, `rowsecurity=true` on both tables, unauthenticated console routes 307 to `/login`.
- Stub scan clean: no TODO/FIXME/placeholder stubs (the single `placeholder` match is an HTML input attribute).
- Threat spot-checks: no `SERVICE_ROLE` reference anywhere under `src/app`; `getSession` appears only in comments explaining why it is not trusted.

---
*Phase: 01-foundation-tenancy*
*Completed: 2026-08-25*
