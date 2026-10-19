---
phase: 01-foundation-tenancy
plan: 04
subsystem: infra
tags: [multi-tenancy, rls, postgres, drizzle, eslint, vitest, github-actions, ci, supabase, security]

requires:
  - phase: 01-02
    provides: tenants + tenant_members schema with RLS, create_tenant RPC, drizzle migration journal, vitest infrastructure, operator auth
provides:
  - "forTenant(tenantId) — the only exported tenant-data surface for service-role code; the tenant is closed over at construction and no method accepts a tenantId parameter"
  - "Module-private drizzle + postgres.js client on the transaction pooler, created lazily so importing the repository never demands credentials"
  - "ESLint no-restricted-imports ban on the raw client outside src/db/repository, with a region-scoped allowance"
  - "tests/lint-ban.test.ts — 6 assertions proving the ban fires outside the repository and stays silent inside it"
  - "tests/leak.test.ts — two-tenant leak test, RLS half + repository half, mutation-checked"
  - "tests/rls-coverage.test.ts — fails on any public table with rowsecurity false, with a guard against passing vacuously"
  - "tests/helpers/seed.ts — two identical-profile tenants, operator enrolled in one only"
  - "Migration 0003 — explicit table GRANTs so the migration set stands up a working database with no dashboard-configured state"
  - "supabase/config.toml — local stack definition matching the operator-only production posture"
  - ".github/workflows/ci.yml — typecheck, lint, two secret scans, fresh Supabase stack, drizzle-kit migrate, full vitest suite"
affects: [servicem8-sync, cadence-engine, sms-email-delivery, ai-drafting, approval-queue, attribution-reporting]

actuals:
  tokens: 14188
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Tenant scoping by closure, not by parameter — forgetting the tenant is not an expressible mistake because there is no unscoped query surface"
    - "Cross-tenant operations reserved to explicitly-named forAllTenants_* exports so every cross-tenant touchpoint is greppable"
    - "A lint rule is not trusted until a test has watched it fire — ESLint.lintText over virtual file paths keeps the violating fixture off disk"
    - "Static gates (typecheck, lint, secret scans) run before the Docker stack boots, so cheap failures fail fast"
    - "CI runs against a database built only from the migration journal, which is what exposes reliance on dashboard-configured state"
    - "A coverage assertion carries a companion guard against passing vacuously (an empty schema must not be green)"

key-files:
  created:
    - src/db/repository/client.ts
    - src/db/repository/for-tenant.ts
    - src/db/repository/index.ts
    - src/db/migrations/0003_table_grants.sql
    - tests/helpers/seed.ts
    - tests/leak.test.ts
    - tests/lint-ban.test.ts
    - tests/rls-coverage.test.ts
    - .github/workflows/ci.yml
    - supabase/config.toml
  modified:
    - eslint.config.mjs
    - package.json
    - tests/helpers/env.ts
    - src/db/migrations/meta/_journal.json

key-decisions:
  - "forTenant() closes over the tenant id and exposes no method that takes one — a per-call tenantId parameter would reintroduce exactly the forgotten-filter bug the layer exists to remove"
  - "TenantPatch omits id: repointing a row's primary key would move data between tenants, which is the single worst outcome this module guards against"
  - "The repository barrel exports forTenant and closeDb only; re-exporting the raw client would defeat the lint ban through the front door"
  - "Explicit per-table GRANTs rather than a blanket ALTER DEFAULT PRIVILEGES — a future table becomes reachable by a role because someone decided so, not by inheritance"
  - "anon keeps SELECT on both tables so an unauthenticated read returns [] rather than 42501; denial and absence must stay indistinguishable (T-03-02)"
  - "The leak test's RLS half asserts visibility equals membership, not 'every row is tenant A', so it keeps holding once the operator onboards real clients"
  - "The leak test was mutation-checked: removing the tenant predicate from forTenant().tenant.get() turns 3 assertions red, so the suite is known to detect the failure it exists for"
  - "CI needs no repository secrets — the local stack's own throwaway credentials plus a dummy operator account, seeded through the admin API against a database destroyed with the runner"
  - "Actions pinned to major versions from official orgs and the Supabase CLI pinned to 2.115.0, so the Postgres image under the migrations cannot change without a commit"

patterns-established:
  - "Every new table needs its own GRANT block in a migration; the hosted project will mask an omission and CI will not"
  - "Local Supabase config is the code-level mirror of dashboard security toggles, so CI tests the same product that ships"

requirements-completed: [ONB-05]

coverage:
  - id: D1
    description: "A two-tenant leak test passes both halves: the operator (member of tenant A only) sees zero tenant-B rows and anon sees nothing; forTenant(A) can never emit tenant-B data even though tenant-B rows exist"
    requirement: ONB-05
    verification:
      - kind: integration
        ref: "tests/leak.test.ts#shows the operator tenant A and never tenant B"
        status: pass
      - kind: integration
        ref: "tests/leak.test.ts#grants visibility through membership and nothing else"
        status: pass
      - kind: integration
        ref: "tests/leak.test.ts#returns nothing at all to a caller with no session"
        status: pass
      - kind: integration
        ref: "tests/leak.test.ts#cannot emit tenant B data even though tenant B exists"
        status: pass
      - kind: other
        ref: "mutation check — removing the tenant predicate from forTenant().tenant.get() turns 3 assertions red"
        status: pass
    human_judgment: false
  - id: D2
    description: "An automated assertion fails the suite when any public-schema table has RLS disabled — new tables cannot ship unprotected"
    requirement: ONB-05
    verification:
      - kind: integration
        ref: "tests/rls-coverage.test.ts#has row-level security enabled on every table in the public schema"
        status: pass
      - kind: integration
        ref: "tests/rls-coverage.test.ts#found the tables it was meant to check — an empty schema would pass vacuously"
        status: pass
    human_judgment: false
  - id: D3
    description: "Importing the raw db client outside src/db/repository is an ESLint error, proven by a test that lints a violating snippet and asserts the rule fires"
    requirement: ONB-05
    verification:
      - kind: unit
        ref: "tests/lint-ban.test.ts (6 assertions: @/ alias, relative form, src/app, repository allowance, sanctioned import, barrel surface)"
        status: pass
      - kind: other
        ref: "npx eslint . --max-warnings=0 green locally and in CI"
        status: pass
    human_judgment: false
  - id: D4
    description: "forTenant(id) for a tenant with no rows returns an empty array — never null, never a throw, never another tenant's rows (empty edge)"
    requirement: ONB-05
    verification:
      - kind: integration
        ref: "tests/leak.test.ts#returns an empty array for a tenant with no rows — never null, never a throw (empty edge)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Two tenants with identical profile values remain fully isolated — isolation keys on tenant UUID, never on name or profile equality (adjacency edge)"
    requirement: ONB-05
    verification:
      - kind: integration
        ref: "tests/leak.test.ts#keeps two identical-profile tenants apart (adjacency edge)"
        status: pass
      - kind: integration
        ref: "tests/leak.test.ts#scopes writes as tightly as reads"
        status: pass
    human_judgment: false
  - id: D6
    description: "GitHub Actions CI runs typecheck, drizzle-kit migrate against a fresh local Supabase stack, and the full Vitest suite (leak + rls-coverage included) and passes — the leak test is CI-blocking"
    requirement: ONB-05
    verification:
      - kind: e2e
        ref: "GitHub Actions run 32840275174 (b1f3aec) — conclusion success, 6 files / 69 tests passed on a fresh supabase start database"
        status: pass
      - kind: other
        ref: "gh run list --limit 1 --json conclusion --jq '.[0].conclusion' | grep -q success"
        status: pass
    human_judgment: false
  - id: D7
    description: "The service-role key is not reachable from console code and no environment file is tracked (threat T-04-03)"
    verification:
      - kind: e2e
        ref: "CI step 'Secret scan — service-role key must not be reachable from the console' and 'Secret scan — no environment file is tracked', both green"
        status: pass
    human_judgment: false
  - id: D8
    description: "The repository layer is the pattern later phases will actually reach for when the cadence tick needs cross-tenant work"
    verification: []
    human_judgment: true
    rationale: "Whether forAllTenants_* stays a narrow, greppable exception or quietly becomes the normal path is a judgment about Phase 3's code, which does not exist yet. No assertion can pre-empt it."

duration: 26 min
completed: 2026-08-25
status: complete
---

# Phase 1 Plan 04: Tenant Isolation Mechanisms and CI Summary

**Three independent controls make cross-tenant leakage structurally hard rather than merely intended — a `forTenant()` closure with no unscoped query surface, an ESLint ban proven to fire, and a mutation-checked two-tenant leak test that blocks a green GitHub Actions pipeline built on a database the migrations stand up alone.**

## Performance

- **Duration:** 26 min
- **Started:** 2026-08-25T10:41:58Z
- **Completed:** 2026-08-25T11:08:24Z
- **Tasks:** 3
- **Files created/modified:** 16
- **Commits:** 5

## Accomplishments

- **Forgetting the tenant is no longer expressible.** `forTenant(tenantId)` closes over the id at construction and exposes no method that accepts one. There is no unscoped query surface to reach by accident — the raw client is module-private, `index.ts` exports `forTenant` and `closeDb` and nothing else, and `TenantPatch` cannot even touch `id`. Cross-tenant work is reserved to `forAllTenants_*` exports that do not exist yet, so today the grep returns zero hits and that is the point.
- **The lint ban is proven, not assumed.** `tests/lint-ban.test.ts` runs the project's real `eslint.config.mjs` over a violating snippet through the ESLint Node API and watches the rule fire — via the `@/` alias, via the relative form, and from inside `src/app`. It also asserts the rule stays silent inside `src/db/repository` and that the barrel's export surface is exactly `['closeDb', 'forTenant']`. Virtual file paths keep the violating fixture off disk, so `eslint .` over the repo stays green.
- **The leak test is known to detect the thing it exists for.** Both halves pass — but passing tests prove nothing about a guard until you break the guard. Removing the tenant predicate from `forTenant().tenant.get()` turned three assertions red (repository half, adjacency edge, empty edge); restoring it turned them green. The fixture is deliberately adversarial: tenants A and B carry *identical* trade type, timezone, hours, days and escalation phone, so nothing but the uuid can be doing the isolating.
- **CI found a real gap on its first run, which is exactly why it exists.** Building the database from the migration journal alone surfaced that `anon`, `authenticated` and `service_role` had no table privileges — the hosted project only worked because Supabase's bootstrap installs default privileges that a fresh `supabase start` does not have. On that database an unauthenticated read returned `42501 permission denied` instead of `[]`, which leaks the table's existence and breaks T-03-02. Migration 0003 makes the grants explicit and the migration set self-contained.
- **The pipeline is green and needs no secrets.** typecheck → lint → two secret scans → `supabase start` → `drizzle-kit migrate` → 69 tests, in 3m36s on `ubuntu-latest`, using the local stack's own throwaway credentials and a dummy operator seeded through the admin API. Nothing to leak, nothing for the operator to configure.

## Task Commits

1. **Task 1: forTenant() repository + ESLint import ban with firing proof** — `30e5f7d` (feat)
2. **Task 2: Two-tenant leak test and RLS-everywhere assertion** — `cc29549` (test)
3. **Task 3: GitHub Actions CI** — `596350f` (ci), plus `7f45f97` (fix — table grants and email logins, found by the first CI run) and `b1f3aec` (chore — drizzle snapshot)

## Files Created/Modified

- `src/db/repository/client.ts` — lazy drizzle + postgres.js on the transaction pooler (`prepare: false`), with the import ban stated at the top of the file and the reason spelled out.
- `src/db/repository/for-tenant.ts` — `forTenant()`, `TenantPatch`, a uuid-shape assertion at construction and an empty-patch guard.
- `src/db/repository/index.ts` — the public surface: `forTenant` and `closeDb`.
- `src/db/migrations/0003_table_grants.sql` — explicit privileges for `anon`, `authenticated` and `service_role` on both tables, with the reasoning and the rule for future tables.
- `tests/helpers/seed.ts` — two identical-profile tenants, membership inserted directly with the service-role client (the RPC would have enrolled the operator in both).
- `tests/leak.test.ts` — 9 assertions across the two halves.
- `tests/rls-coverage.test.ts` — the every-table-has-RLS assertion plus its non-vacuity guard.
- `tests/lint-ban.test.ts` — 6 assertions on the ban.
- `tests/helpers/env.ts` — `DATABASE_URL` and `MIGRATE_DATABASE_URL` are now required and exposed on `testEnv`.
- `eslint.config.mjs` — the `no-restricted-imports` block and the region-scoped allowance.
- `package.json` — `lint` is now `eslint . --max-warnings=0`, matching CI exactly.
- `supabase/config.toml` — `supabase init` output with public signup disabled and the auth-provider distinction documented.
- `.github/workflows/ci.yml` — the pipeline.

## Decisions Made

Captured in `key-decisions` frontmatter. The three with the longest reach:

- **Scoping by closure rather than by parameter.** Every alternative design — a `tenantId` argument, a "remember to call `.where()`" convention, a code-review checklist — relies on someone remembering, in every one of the hundreds of queries Phase 3 onward will write. A closure moves the guarantee from vigilance to mechanism, and that is the whole content of ONB-05.
- **Explicit per-table grants over a blanket default.** `ALTER DEFAULT PRIVILEGES` would have fixed CI in one line and quietly made every future table reachable by `anon` the moment it was created. The explicit form costs three lines per table and forces the question to be asked once, out loud, per table. CI enforces it; the hosted project would not.
- **`anon` keeps `SELECT`.** Counter-intuitive, but revoking it turns an RLS-filtered empty result into a `42501` error, and an error is information: it confirms the table exists. Empty and denied must look identical from outside.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Missing table privileges — the migration set did not stand up a working database**
- **Found during:** Task 3 (first CI run, 32839668309)
- **Issue:** On a fresh `supabase start` database, `anon`, `authenticated` and `service_role` had no privileges on `tenants` or `tenant_members`. Postgres checks privileges before RLS, so PostgREST returned `42501 permission denied for table tenants` instead of an RLS-filtered empty array. Five assertions failed and the leak suite could not even seed. The hosted project hid this: Supabase's project bootstrap installs `ALTER DEFAULT PRIVILEGES` in `public` for the `postgres` role, so drizzle's tables were granted automatically there.
- **Fix:** `src/db/migrations/0003_table_grants.sql` — `SELECT` for `anon`, `SELECT/UPDATE/DELETE` for `authenticated` on `tenants` and `SELECT` on `tenant_members` (matching each table's policy scope), `ALL` for `service_role`. `INSERT` on `tenants` deliberately withheld: `create_tenant()` is the only path that can satisfy the RLS chicken-and-egg, so a grant would only create a dead end.
- **Files modified:** `src/db/migrations/0003_table_grants.sql`, `src/db/migrations/meta/_journal.json`, `src/db/migrations/meta/0003_snapshot.json`
- **Verification:** Applied to the hosted project via `node scripts/migrate.mjs` (4 journal entries recorded); local suite 69/69; CI run 32840275174 green on a fresh database.
- **Committed in:** `7f45f97`, `b1f3aec`

**2. [Rule 1 - Bug] `[auth.email] enable_signup = false` disabled email logins entirely**
- **Found during:** Task 3 (first CI run)
- **Issue:** Setting both `[auth] enable_signup` and `[auth.email] enable_signup` to false in `supabase/config.toml` blocked signup as intended but also produced `Email logins are disabled` on every operator sign-in — that key maps to `GOTRUE_EXTERNAL_EMAIL_ENABLED`, which switches the provider off rather than restricting new accounts.
- **Fix:** Reverted `[auth.email] enable_signup` to `true` with the distinction documented in the file. `[auth] enable_signup = false` alone is the local equivalent of the hosted "Disable new user signups" toggle, and `tests/auth-security.test.ts#rejects public signup` still passes in CI, so the posture is intact.
- **Files modified:** `supabase/config.toml`
- **Verification:** CI run 32840275174 — signup rejected, operator sign-in accepted.
- **Committed in:** `7f45f97`

**3. [Rule 3 - Blocking] Test env contract had no database URLs**
- **Found during:** Task 2
- **Issue:** `tests/helpers/env.ts` required only the Supabase API keys and operator credentials. The leak test needs `DATABASE_URL` (the repository connection) and the RLS-coverage test needs `MIGRATE_DATABASE_URL` (the catalog is unreachable through PostgREST). Without them the failure surfaced as an obscure zod error from deep inside `getServerEnv()` rather than the named, early message the helper exists to give.
- **Fix:** Added both to `REQUIRED` and to the exported `testEnv`, each with a comment saying which suite needs it and why.
- **Files modified:** `tests/helpers/env.ts` (not in the plan's `files_modified` list)
- **Verification:** Both suites resolve their connections; the missing-variable path still names the offending variables.
- **Committed in:** `cc29549`

**4. [Rule 2 - Missing Critical] `forTenant()` accepted anything as a tenant id**
- **Found during:** Task 1
- **Issue:** `forTenant(undefined)` or `forTenant('')` would have reached the driver. `''` raises an obscure `22P02`; `undefined` risks a predicate nobody intended — a silently wrong result set from the one function whose entire job is to be right about scope.
- **Fix:** A uuid-shape assertion at construction, plus a guard on empty patches in `update()`. Both throw immediately with a message naming the bad value.
- **Files modified:** `src/db/repository/for-tenant.ts`
- **Verification:** `tests/leak.test.ts#refuses a tenant id that is not a uuid rather than guessing`.
- **Committed in:** `30e5f7d`

**5. [Rule 2 - Missing Critical] The RLS-coverage assertion could pass vacuously**
- **Found during:** Task 2
- **Issue:** "No public table has `rowsecurity = false`" is trivially true of a database with no tables. A dropped schema, a migration that silently applied nothing, or a mis-pointed connection would all have shown green.
- **Fix:** A companion assertion that `tenants` and `tenant_members` are actually present. This is also what closes the false-positive hole 01-02 documented in `drizzle-kit migrate`: a CI migrate step that exits 0 without applying anything cannot survive this suite.
- **Files modified:** `tests/rls-coverage.test.ts`
- **Verification:** Both assertions green locally and in CI.
- **Committed in:** `cc29549`

**6. [Rule 2 - Missing Critical] Second secret scan — no tracked environment file**
- **Found during:** Task 3
- **Issue:** The plan's secret scan covers the service-role variable *name* under `src/app`. It would not notice a committed `.env.local`, which is the more common and more total leak.
- **Fix:** A CI step failing on any tracked `.env*` file other than `.env.example`.
- **Files modified:** `.github/workflows/ci.yml`
- **Verification:** Step green; `git ls-files | grep '^\.env'` returns nothing.
- **Committed in:** `596350f`

### Plan deviations by design

- **`tests/helpers/seed.ts` seeds through the service-role PostgREST client, not a direct `postgres.js` connection.** The plan named `MIGRATE_DATABASE_URL` for seeding, but every table it touches is reachable through PostgREST with the service-role key, and a second connection would be one more thing to close in `afterAll`. The direct connection is used where it is genuinely required — `tests/rls-coverage.test.ts`, which reads `pg_tables`.
- **The RLS half asserts *visibility equals membership* as well as "A yes, B no".** The plan's literal wording ("every returned row has id === tenantA") is only true while the operator has no other clients, and would turn red the first time they onboard a real one. The generalised form is strictly stronger, keeps holding forever, and still fails loudly if tenant B ever appears.
- **`package.json`'s `lint` script became `eslint . --max-warnings=0`** rather than the plan's `eslint .`, so the local command and the CI gate cannot drift apart.
- **`supabase/config.toml` `project_id` renamed** from the directory-derived `AI_employee` to `quote-recovery-mvp`.
- **Actions pinned to current majors** (`actions/checkout@v7`, `actions/setup-node@v7`, `supabase/setup-cli@v3`) after checking the published releases; the plan's `setup-cli@v1` is two majors behind. The Supabase CLI itself is pinned to `2.115.0` to match the devDependency, as the plan directed.

---

**Total deviations:** 6 auto-fixed (2 bugs, 1 blocking, 3 missing critical) + 5 by-design departures.
**Impact on plan:** No scope creep. The two bugs were both found by CI doing exactly the job the plan gave it — proving the system stands up on a database nobody hand-configured. Deviation 1 in particular fixed a latent defect in the 01-02 migration set, not in this plan's code.

## Issues Encountered

- **The first CI run was red, and that was the useful outcome.** Two independent defects surfaced (table grants, the auth-provider config key), both invisible against the hosted project. Fixed in one commit; the second run was green end to end.
- **`supabase start` cannot run on this machine** (no Docker), so the workflow could not be rehearsed locally. The `Export local stack environment` step was written defensively for that reason — it prints the variable *names* `supabase status` reports and fails with a named message if an expected one is missing. It worked first time.

## Verification Results

- `npx vitest run` — **69 passed** (6 files: 42 validation units, 9 leak, 6 lint-ban, 5 tenant-create, 5 auth-security, 2 rls-coverage)
- `npx eslint . --max-warnings=0` — clean
- `npx tsc --noEmit` — clean
- **GitHub Actions run 32840275174** (`b1f3aec`, branch `main`) — **success** in 3m36s: typecheck, lint, both secret scans, `supabase start`, `drizzle-kit migrate`, 69/69 tests, stack stopped.
- **Mutation check** — with `forTenant().tenant.get()` stripped of its `where(eq(tenants.id, tenantId))`, `tests/leak.test.ts` reports 3 failed / 6 passed; predicate restored, 9/9 pass.
- **Self-cleaning confirmed** — after a full local run, `tenants` and `tenant_members` are both empty.

## Known Stubs

None. No TODO, FIXME, placeholder or hardcoded-empty stubs were introduced. `forAllTenants_*` is named in comments as the future shape for cross-tenant exports; no such export exists, which is the intended Phase 1 state (01-02 said the same).

## Threat Flags

None. No new network endpoint, auth path, file-access pattern or trust-boundary schema change was introduced beyond what the plan's threat model already covers. Migration 0003 changes privileges at an existing boundary and is analysed under T-04-01/T-03-02 above rather than as new surface.

## User Setup Required

None new. The two items carried from 01-02 still stand: create `.env.example` from `docs/env-vars.md`, and confirm the Supabase project region in the dashboard.

Worth knowing: **CI requires no repository secrets.** If GitHub branch protection is ever enabled, `typecheck, lint, migrate, test` is the check to make required.

## Next Phase Readiness

**ONB-05 is complete**, with all three controls in place and all three named edges closed: empty (`[]` from `forTenant` on an unknown tenant), adjacency (identical-profile tenants stay isolated), ordering (covered by 01-02's `created_at DESC, id DESC` tiebreak).

**Carried forward:**

- Phase 3's cadence tick is the first caller that will genuinely want cross-tenant access. It gets a `forAllTenants_*` export, not a raw query — and the leak test's repository half is the regression guard when it lands.
- Every new table needs three things now: a `pgPolicy` in `src/db/schema` (RLS), a `GRANT` block in a migration (privileges), and nothing else — `tests/rls-coverage.test.ts` catches a forgotten policy, CI catches a forgotten grant.
- The stronger variant sketched in 01-RESEARCH.md Pattern 3 — a non-bypassing worker role with `SET LOCAL app.tenant_id` — remains open and is worth revisiting in Phase 3 when the tick exists to justify it.
- `supabase start` still cannot run on this machine. Anything that must be proven against a fresh database has to be proven in CI.

## Self-Check: PASSED

- All 10 key created files verified present on disk.
- All 5 commits verified in git history (`30e5f7d`, `cc29549`, `596350f`, `7f45f97`, `b1f3aec`).
- Plan verification re-run at close-out: vitest 69/69, `eslint . --max-warnings=0` clean, `tsc --noEmit` clean, latest GitHub Actions conclusion `success`.
- Must-have artifacts confirmed: `forTenant` exported from `src/db/repository/for-tenant.ts`; key link `tests/leak.test.ts -> ../src/db/repository/for-tenant` present; `no-restricted-imports` present in `eslint.config.mjs`; `.github/workflows/ci.yml` runs `npx drizzle-kit migrate`.
- Stub scan clean across `src` and `tests`.

---
*Phase: 01-foundation-tenancy*
*Completed: 2026-08-25*
