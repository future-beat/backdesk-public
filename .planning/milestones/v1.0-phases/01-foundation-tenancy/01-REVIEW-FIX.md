---
phase: 01-foundation-tenancy
fixed_at: 2026-08-26T01:12:00+08:00
review_path: .planning/phases/01-foundation-tenancy/01-REVIEW.md
iteration: 1
fix_scope: critical_and_warning
findings_in_scope: 14
fixed: 12
partially_fixed: 2
skipped: 0
status: partial
tests_before: 69
tests_after: 100
verification_ran_in: main checkout (workflow.use_worktrees = false)
---

# Phase 1: Code Review Fix Report

**Fixed at:** 2026-08-26
**Source review:** `.planning/phases/01-foundation-tenancy/01-REVIEW.md`
**Iteration:** 1
**Scope:** Critical + Warning (Info findings deliberately not attempted)

**Summary:**

- Findings in scope: 14 (1 Critical, 13 Warning)
- Fixed: 12
- Partially fixed, with the remainder documented: 2 (WR-11, WR-13)
- Skipped: 0
- Tests: 69 → 100, all green
- Migrations added: 2 (`0004`, `0005`), both applied to the live Sydney project

**Close-out gate (run in the main checkout, so reproducible from a fresh clone
plus `.env.local`):**

| Gate | Result |
|---|---|
| `vitest run` (via `npm run test:remote`) | 7 files, **100 passed** |
| `tsc --noEmit` | clean |
| `eslint . --max-warnings=0` | clean |
| `next build` (credential-free) | succeeds, 5 routes |
| `git status` | clean, no uncommitted changes |
| live DB after run | 0 tenants, 0 memberships, 6 migrations — no seed data left behind |

---

## Read this before you do anything else

Three of these changes alter things outside the source tree. None of them are
reversible by `git revert` alone.

1. **Two migrations were applied to the live Sydney database** (`0004`, `0005`).
   `0005` in particular *revoked* privileges that Supabase's project bootstrap
   had granted. The console and all 100 tests pass against the post-migration
   database, but this is production state, not just code.
2. **`npm test` now refuses to run against the hosted project.** Use
   `npm run test:remote` on this machine (no Docker). CI is unaffected. This
   changes the phase's documented verification loop — see WR-09.
3. **Two findings are partial** (WR-11, WR-13). Both have a written trigger
   condition rather than a code fix, because the real fix is a schema change and
   a platform-ownership problem respectively. Details below.

---

## Fixed

### CR-01: Unauthenticated render crash on `/login` via prototype-chain lookup

**Files:** `src/core/shared/auth-messages.ts` (new), `src/app/login/page.tsx`, `tests/login-error.test.ts` (new)
**Commit:** `e759689`

Moved the message lookup into framework-free `src/core` and switched from an
object literal to a `Map`, which has no prototype chain to walk. The regression
test covers all eight `Object.prototype` keys and asserts the **type** of the
result is `string` — that is the property React needs and the property the
object-literal lookup silently lost.

Put it in `src/core` rather than inline in the page so it is testable without
standing up Next, matching the existing `src/core/shared/tenant.ts` convention.

### WR-01: Server Actions carry no authorization of their own

**Files:** `proxy.ts`, `src/app/(console)/clients/new/actions.ts`
**Commit:** `276f81e`

`createTenant` now checks `getClaims()` itself before touching the RPC, and the
matcher exclusion is anchored to `login$|login/` so `/loginanything` is no longer
silently unprotected by the prefix match.

### WR-02: `forTenant().tenant.update()` enforced `id` immutability with a type only

**Files:** `src/db/repository/for-tenant.ts`, `tests/leak.test.ts`
**Commit:** `6a11f81`

Rejects immutable keys and unknown fields at runtime, before Postgres sees
anything — the same treatment the constructor already gave `tenantId`. Mutable
columns are derived from the schema via `getTableColumns()` so a column added in
a later phase stays patchable without editing this file.

Tests assert the throw *and* then read both rows back through the service-role
client to prove nothing moved.

### WR-03: The validation authority was bypassable

**Files:** `src/db/migrations/0004_tenant_constraints.sql` (new), journal + snapshot, `tests/tenant-create.test.ts`
**Commit:** `bc92e2c`

Six CHECK constraints plus a timezone-validation trigger. Applied to the live
project with `scripts/migrate.mjs`; the `tenants` table was empty at the time, so
no existing row could conflict.

Two things worth knowing:

- **`COALESCE` in `tenants_days_nonempty` is load-bearing.** `array_length('{}', 1)`
  returns `NULL`, and a `NULL` CHECK expression **passes** — the review's
  suggested bare `BETWEEN` would have let an empty day set straight through.
- **Timezone validation is a trigger, not a CHECK and not a line in
  `create_tenant`.** A CHECK cannot read `pg_timezone_names` (no subqueries, no
  non-`IMMUTABLE` functions), and `create_tenant` is not the only writer —
  `0003` grants `UPDATE` on `tenants` to `authenticated`, so an operator can
  `PATCH` `timezone` over PostgREST without the RPC ever running.

One assumption in my own first draft was wrong and got corrected: I added a case
asserting `'EST'` was rejected. It is not — `EST` is a genuine (legacy
fixed-offset) entry in `pg_timezone_names`. The DB is correctly the **floor**
here; `Intl.supportedValuesOf('timeZone')` in `src/core/shared/tenant.ts` remains
the narrower authority. The migration comment records this so the divergence is
not mistaken for a bug later.

### WR-04: Leak test proved read isolation only — plus a much larger finding

**Files:** `tests/leak.test.ts`, `tests/rls-coverage.test.ts`, `src/db/migrations/0005_revoke_inherited_grants.sql` (new)
**Commit:** `eac89d6`

Added cross-tenant update, delete, self-enrolment and membership-repointing
cases.

**Writing those tests surfaced that the review's premise was wrong in the
attacker's favour.** WR-04 says self-enrolment "is blocked today *only* by the
absence of `GRANT INSERT`". On the hosted project the grant was **not** absent.
Measured privilege set before the fix:

```
tenants        / anon, authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
tenant_members / anon, authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
```

This is exactly what `0003`'s own header predicted (Supabase's
`ALTER DEFAULT PRIVILEGES` grants everything to `anon`/`authenticated` for tables
`postgres` creates) — and `0003` then only ever *added* grants. So the documented
intent held on a fresh `supabase start` and was false in production, and CI, being
the strict environment, could never have caught the difference.

**`TRUNCATE` is the sharp edge: it is not subject to row-level security.** A role
holding it can empty `tenants` regardless of any policy, cascading into
`tenant_members`. No RLS test would ever have noticed.

`0005` revokes everything from both roles on both tables and re-grants exactly
the intended set. `rls-coverage` gained a standing assertion on the full
privilege matrix, so drift fails CI. Post-fix:

```
tenants        / anon: SELECT          | authenticated: DELETE, SELECT, UPDATE
tenant_members / anon: SELECT          | authenticated: SELECT
```

One deliberate detail: the cross-tenant update test uses status `'paused'`, a
*valid* value. `'hijacked'` (as the review suggested) would now be rejected by the
`0004` CHECK constraint, so the test would pass without ever exercising RLS.

### WR-05: Parallel test races

**Files:** `vitest.config.mts`, `tests/helpers/seed.ts`, `tests/tenant-create.test.ts`
**Commit:** `5aabace`

Set `fileParallelism: false`, and collapsed the two suite-local
`ensureOperatorExists` copies onto one shared helper that paginates (neither copy
did — IN-03's substance) and treats an already-registered failure as the
postcondition being met rather than an error.

### WR-06: Vacuous isolation assertions

**Files:** `tests/auth-security.test.ts`
**Commit:** `148b6cd`

Seeds two tenants in its own `beforeAll` and now also asserts, through the
service-role client, that the rows really exist — so "returns zero rows to an
unauthenticated reader" can no longer pass on an empty database. Also calls
`ensureOperatorExists()` itself instead of depending on another file's hook.

### WR-07: CI never built the application

**Files:** `.github/workflows/ci.yml`
**Commit:** `6824383`

Added a `next build` step before the Supabase stack. Verified locally against
Next 16.3.2 with placeholder credentials, which also proves the lazy env parsing
in `src/core/shared/env.ts` keeps a credential-free build possible.

### WR-08: `scripts/migrate.mjs` had no caller

**Files:** `package.json`, `.github/workflows/ci.yml`
**Commit:** `2df0ca4`

`npm run db:migrate` and the CI step both go through `scripts/migrate.mjs` now.
Verified end to end — this is the path that actually applied `0004` and `0005`.

### WR-09: Destructive tests defaulted to the live Sydney project

**Files:** `tests/helpers/env.ts`, `package.json`, `docs/env-vars.md`
**Commit:** `f3f0144`

`tests/helpers/env.ts` refuses a non-local target unless `ALLOW_REMOTE_TESTS=yes`,
naming both the target URL and the env file it loaded. CI is unaffected
(`supabase start` serves `127.0.0.1`).

**This changes your workflow.** Per your constraint that running against the
hosted project must stay possible on this Docker-less machine, the opt-in is an
environment variable with a first-class npm script rather than a required file:

- `npm test` → refuses against hosted, with an actionable message
- `npm run test:remote` → sets the flag, runs all 100 tests

Verified both directions. The phase's documented loop of bare `npx vitest run`
now needs `npm run test:remote` on this machine.

**Not done:** `.env.test.example` was *not* committed. Writing any `.env*` file is
denied in this workspace, and committing one would also trip CI's
tracked-env-file scan (which greps `^\.env` with only `.env.example` carved out).
`docs/env-vars.md` carries the contract instead.

### WR-10: RLS guard checked enablement, never restrictiveness

**Files:** `tests/rls-coverage.test.ts`
**Commit:** `70671e6`

Two assertions over `pg_policies`: every RLS-enabled table has at least one
policy, and no policy has an unconditionally-true `USING`/`WITH CHECK`.

**Both detectors were proved to fire**, not just to pass — I created a probe table
carrying each defect inside a transaction and rolled it back, confirming the
queries return it. A guard nobody has seen reject anything is a guard you hope is
configured.

### WR-12: Dead error branch in `create-operator.mjs`

**Files:** `scripts/create-operator.mjs`, `scripts/lib/support.mjs`
**Commit:** `5cafd9d`

Replaced the unreachable `if (error)` with a `try/catch`, and gave `withRetry` an
explicit terminal throw instead of an implicit `return undefined`. Verified the
idempotent path still reports "already exists", and verified `withRetry`
propagates non-transient failures so the new catch actually fires.

---

## Partially fixed

### WR-11: Global unique index is a cross-tenant existence oracle

**Files:** `src/db/migrations/README.md` (new), `src/core/shared/tenant.ts`
**Commit:** `4071845`
**Status:** documented, not structurally fixed — this is the reviewer's stated minimum

The real fix is an `owner_user_id` column set by `create_tenant` plus a unique
index on `(owner_user_id, lower(name))`. That is a schema migration touching the
RPC, the duplicate-name error mapping and the collision test — too much blast
radius to bolt onto a review-fix pass, and not yet needed (one operator).

Applied the reviewer's explicit fallback instead: the decision, the trigger
condition (*"revisit before provisioning a second operator, not after"*) and the
intended fix are recorded in a new `src/db/migrations/README.md` and pointed at
from `DUPLICATE_NAME_INDEX`. That README also documents the hand-written database
objects invisible to the drizzle snapshots (IN-05's substance).

**Your call:** if a second operator is on the near roadmap, this should become its
own small phase rather than staying a note.

### WR-13: Extensions enabled early with no privilege assertion

**Files:** `tests/rls-coverage.test.ts`, `src/db/migrations/README.md`
**Commit:** `f6a19f4`
**Status:** contained and asserted; the underlying grant is not ours to revoke

The finding is real and measurably worse than the review states. On the live
project, `anon` and `authenticated` hold `USAGE` on the `net` schema **and**
`EXECUTE` on `net.http_post`, `http_get`, `http_delete` — an SSRF primitive
inside the trust boundary. (`cron` and `pgmq` are already unreachable: no schema
`USAGE`.)

**The review's suggested fix does not work, and would have been worse than
nothing.** `REVOKE ALL ON SCHEMA net FROM anon, authenticated` is a silent no-op
here: `net` is owned by the superuser `supabase_admin`, migrations connect as
`postgres`, and a REVOKE by a non-owner without grant option emits
`WARNING: no privileges could be revoked for "net"` and **exits successfully**. I
verified this in a rolled-back transaction — the grants were unchanged afterwards.
A migration containing that line would have reported success while reading like a
control. I did not ship it.

What actually contains `pg_net` is the PostgREST boundary: `anon` and
`authenticated` only reach this database through PostgREST, which exposes
`public` and `graphql_public` only. So I asserted the properties that are real
and enforceable, and both currently hold:

- `cron` and `pgmq` grant no `USAGE` to either role
- `net`/`cron` primitives are not routable as PostgREST RPCs (verified `PGRST202`)

A config change exposing `net` now fails CI.

**Residual, accepted and recorded:** the platform grant on `net` stands. The
durable fix — stop enabling these in `0000`, enable each in the phase that uses
it — is written into the README with a trigger condition (Phase 3, cadence tick).
Removing the grant rather than containing it needs a Supabase dashboard action or
support request; it is not reachable from a migration.

---

## Not attempted (out of scope)

Info findings IN-01 … IN-09 were out of scope for this pass. Two were incidentally
addressed:

- **IN-03** (three `ensureOperatorExists` variants) — resolved as part of WR-05;
  one shared helper, and it now paginates.
- **IN-05** (hand-written objects invisible to drizzle snapshots) — documented in
  the new `src/db/migrations/README.md` as part of WR-11.
- **IN-02** (`.env.example` missing) appears to be already resolved; the file
  exists in the working tree.

The rest (IN-01 dead browser client, IN-04 raw Postgres error text in the UI,
IN-06 unreachable `PUBLIC_PATHS`, IN-07 `new URL()` throw, IN-08 unchecked cast,
IN-09 narrow secret scan) remain open.

---

_Fixed: 2026-08-26_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
