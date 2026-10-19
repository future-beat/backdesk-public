---
phase: 01-foundation-tenancy
reviewed: 2026-08-25T00:00:00Z
depth: standard
files_reviewed: 45
files_reviewed_list:
  - .github/workflows/ci.yml
  - drizzle.config.ts
  - eslint.config.mjs
  - next.config.ts
  - proxy.ts
  - scripts/create-operator.mjs
  - scripts/db-diagnose.mjs
  - scripts/db-probe-pooler.mjs
  - scripts/db-status.mjs
  - scripts/lib/support.mjs
  - scripts/migrate.mjs
  - scripts/verify-tracer.mjs
  - src/app/(console)/clients/[id]/page.tsx
  - src/app/(console)/clients/new/actions.ts
  - src/app/(console)/clients/new/form.tsx
  - src/app/(console)/clients/new/page.tsx
  - src/app/(console)/layout.tsx
  - src/app/(console)/page.tsx
  - src/app/layout.tsx
  - src/app/login/actions.ts
  - src/app/login/page.tsx
  - src/core/shared/env.ts
  - src/core/shared/tenant.ts
  - src/db/migrations/0000_extensions_and_tenant_access.sql
  - src/db/migrations/0001_tenants_and_members.sql
  - src/db/migrations/0002_create_tenant_rpc.sql
  - src/db/migrations/0003_table_grants.sql
  - src/db/repository/client.ts
  - src/db/repository/for-tenant.ts
  - src/db/repository/index.ts
  - src/db/schema/index.ts
  - src/db/schema/tenants.ts
  - src/lib/supabase/browser.ts
  - src/lib/supabase/proxy.ts
  - src/lib/supabase/server.ts
  - supabase/config.toml
  - tests/auth-security.test.ts
  - tests/helpers/env.ts
  - tests/helpers/seed.ts
  - tests/leak.test.ts
  - tests/lint-ban.test.ts
  - tests/rls-coverage.test.ts
  - tests/tenant-create.test.ts
  - tests/tenant-validation.test.ts
  - tsconfig.json
findings:
  critical: 1
  warning: 13
  info: 9
  total: 23
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-08-25
**Depth:** standard
**Files Reviewed:** 45
**Status:** issues_found

## Summary

The tenancy substrate is unusually well-reasoned for a Phase 1: the `forTenant()` closure, the three-control import ban (closure + ESLint + a test that proves the rule fires), the SECURITY DEFINER `create_tenant` chicken-and-egg resolution, the table-GRANT migration found by CI, and the decision to run the console on the anon key so RLS is exercised continuously are all correct and load-bearing. Secret handling is clean — no `.env` file is tracked, no script prints a password or key, and the service-role key never appears under `src/app`.

The defects cluster in three places, and they matter more than the polish suggests:

1. **One provable unauthenticated crash.** `/login?error=__proto__` walks the prototype chain of a plain object literal and hands React a non-renderable value. The only auth entry point 500s on a crafted query string.
2. **The isolation proof is narrower than it claims.** The leak test proves *read* isolation for both data paths, but never attempts a cross-tenant **write** and never attempts the privilege-escalation move that actually matters — an authenticated user inserting their own `tenant_members` row for a tenant they do not belong to. That path is guarded only by an absent GRANT. Separately, `forTenant().tenant.update()` enforces `id` immutability with a TypeScript type and nothing else, so a runtime patch object can repoint a row across tenants — the precise outcome the module's own header says it exists to prevent.
3. **The validation authority is bypassable and the pipeline that guards it is racy.** `create_tenant` is a PostgREST-exposed RPC granted to `authenticated` with no CHECK constraints behind it, so every compliance-critical rule (contact-hours ordering, ISO day range, real IANA timezone) lives only in TypeScript. Meanwhile the test suites share one operator account and one database while vitest runs files in parallel, producing at least two genuine races, and two "isolation" assertions pass vacuously on a fresh database.

Nothing here is an active cross-tenant data leak today. Several findings are latent-by-one-commit, which for a foundation phase is the same thing three phases from now.

## Critical Issues

### CR-01: Unauthenticated render crash on the login page via prototype-chain lookup

**File:** `src/app/login/page.tsx:7,18`
**Issue:** `ERRORS` is a plain object literal indexed with attacker-controlled input:

```ts
const ERRORS: Record<string, string> = { missing: '…', invalid: '…' };
const message = error ? (ERRORS[error] ?? ERRORS.invalid) : null;
```

`ERRORS['__proto__']` returns `Object.prototype` — an object, which is truthy, so `??` never falls through to the safe default. `{message}` then hands React a plain object, which React refuses to render ("Objects are not valid as a React child") and the page 500s. Verified in this repo's Node:

```
__proto__    -> object    (invalid React child -> render throws)
constructor  -> function  (invalid React child)
toString     -> function  (invalid React child)
```

Anyone on the internet can reach `/login` (it is deliberately excluded from the proxy matcher), so this is an unauthenticated crash of the console's only authentication entry point. The `Record<string, string>` annotation is what hid it — TypeScript types the lookup as `string`, which it is not at runtime.

**Fix:** Use an own-property lookup, or a `null`-prototype map:

```ts
const ERRORS: Record<string, string> = { __proto__: null, ...{
  missing: 'Enter both your email and password.',
  invalid: 'That email and password combination did not work.',
} } as Record<string, string>;

// or, clearer:
const ERRORS = new Map<string, string>([
  ['missing', 'Enter both your email and password.'],
  ['invalid', 'That email and password combination did not work.'],
]);

const message = error ? (ERRORS.get(error) ?? ERRORS.get('invalid')!) : null;
```

Add a regression test asserting `/login?error=__proto__` renders the generic message. The same anti-pattern should be banned wherever a user-supplied string indexes a lookup table in later phases (`Object.hasOwn(map, key)` is the minimum bar).

## Warnings

### WR-01: Server Actions carry no authorization of their own, and the proxy exclusion makes them reachable without a session

**File:** `proxy.ts:16`, `src/app/(console)/clients/new/actions.ts:65`
**Issue:** The matcher excludes anything whose path starts with `login`:

```ts
matcher: ['/((?!_next/static|_next/image|favicon.ico|login).*)']
```

Next.js Server Action IDs are global — an action registered anywhere in the app can be invoked by POSTing its ID to **any** route, including a route the proxy never sees. `createTenant` therefore has exactly one real guard: the `REVOKE EXECUTE … FROM anon` on `create_tenant`. The layout's `getClaims()` check does not help; layouts render *after* an action runs. The file header for `proxy.ts` claims "`(console)/layout.tsx` re-checks independently so a matcher mistake cannot silently expose a page" — true for pages, false for actions.

Today the database rejects the anonymous call, so there is no exploit. The moment Phase 3 adds an action that does not happen to bottom out in a role-restricted RPC, there is one.

**Fix:** Authorize inside every mutating action, not only at the edge:

```ts
export async function createTenant(_previous, formData) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) {
    return { errors: {}, formError: 'Your session expired. Sign in again.', values };
  }
  …
}
```

Also narrow the matcher exclusion to the exact path (`(?!login$|login/)`) so `/loginanything` is not silently unprotected.

### WR-02: `forTenant().tenant.update()` enforces `id` immutability with a type, not at runtime — a patch object can repoint a row across tenants

**File:** `src/db/repository/for-tenant.ts:28,60-69`
**Issue:** The module header states that `id` is "deliberately not patchable — repointing a row's primary key would move data between tenants, the precise outcome this module exists to make impossible." The enforcement is `TenantPatch = Partial<Omit<Tenant, 'id' | 'createdAt'>>`, which is erased at runtime. Drizzle's `.set(patch)` maps every key present on the object to its column, so `update(someParsedJson)` where the JSON carries `id` emits `UPDATE tenants SET id = $1 WHERE id = $2` and moves the row. Note the asymmetry: the constructor *does* validate `tenantId` at runtime (`UUID_PATTERN`) precisely because "a bad tenant id is a programming error and must never degrade into a silently wrong result set" — the write path deserves the same treatment and does not get it.

**Fix:** Strip immutable keys at runtime and reject unknown ones:

```ts
const IMMUTABLE = new Set(['id', 'createdAt']);

update: (patch: TenantPatch) => {
  const keys = Object.keys(patch);
  if (keys.length === 0) throw new Error('…empty patch.');
  const illegal = keys.filter((k) => IMMUTABLE.has(k));
  if (illegal.length > 0) {
    throw new Error(`forTenant().tenant.update() cannot patch ${illegal.join(', ')}.`);
  }
  …
}
```

Add a leak-test case: `expect(() => forTenant(A).tenant.update({ id: B } as never)).toThrow()` followed by a service-role read proving A still exists.

### WR-03: The "single validation authority" is bypassable — `create_tenant` is a public RPC with no CHECK constraints behind it

**File:** `src/db/migrations/0002_create_tenant_rpc.sql:11-52`, `src/db/schema/tenants.ts:25-51`
**Issue:** `src/core/shared/tenant.ts` says the rules "live in one place that the form cannot bypass," but the form is not the only caller — `create_tenant` is granted to `authenticated` and exposed on PostgREST, so a `curl` with a valid operator JWT can insert `contact_days = '{0,99}'`, `contact_hours_start > contact_hours_end`, `timezone = 'Mars/Phobos'`, or a 10 KB name. Nothing in the database says no: `tenants` has no CHECK constraints, no length bounds, and no timezone validation. The detail page already carries a try/catch for this exact eventuality ("A row written before the timezone was validated could still hold junk" — `[id]/page.tsx:43`), which is the code acknowledging the gap rather than closing it.

These are the inputs the DNCR contact-hours discipline consumes in Phase 3. A window that is wrong here is a compliance breach later, which is the file's own stated rationale.

**Fix:** Add constraints in a new migration so the invariant holds regardless of caller:

```sql
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_hours_ordered CHECK (contact_hours_start < contact_hours_end),
  ADD CONSTRAINT tenants_days_nonempty CHECK (array_length(contact_days, 1) BETWEEN 1 AND 7),
  ADD CONSTRAINT tenants_days_in_range CHECK (contact_days <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
  ADD CONSTRAINT tenants_name_len CHECK (char_length(name) BETWEEN 1 AND 120),
  ADD CONSTRAINT tenants_status_known CHECK (status IN ('onboarding','active','paused','ended'));
```

Timezone validity can be checked in `create_tenant` with `PERFORM now() AT TIME ZONE p_timezone;` wrapped in an exception block. Then extend `tests/tenant-create.test.ts` with a "raw RPC with junk values is rejected by the database" case — that is the test that proves the authority is not merely a convention.

### WR-04: The leak test proves read isolation only — no cross-tenant write, and no self-enrolment attempt

**File:** `tests/leak.test.ts:41-97`, `src/db/migrations/0003_table_grants.sql:40-44`
**Issue:** The RLS half asserts what the operator can *see*. It never asserts what the operator cannot *do*. Two untested paths, both of which are the actual escalation moves:

1. `operator.from('tenants').update({ status: 'x' }).eq('id', tenantB)` — the policy is `FOR ALL` with `WITH CHECK`, and `GRANT UPDATE, DELETE … TO authenticated` is real, so this is a live write surface with zero coverage. Same for `.delete()`, which cascades to `tenant_members`.
2. `operator.from('tenant_members').insert({ tenant_id: tenantB, user_id: operatorId })` — if this ever succeeds, the attacker grants themselves full access to tenant B and every subsequent assertion in this suite goes green anyway. It is blocked today *only* by the absence of `GRANT INSERT`, i.e. by something not being written down. A hosted `ALTER DEFAULT PRIVILEGES`, a dashboard action, or a future "grant everything to authenticated" convenience migration silently re-opens it, and no test would notice.

The repository half is stronger (it does test a scoped write), but the console half — the one governed by policies rather than by a closure — is read-only.

**Fix:** Add to the RLS half:

```ts
it('cannot write to a tenant it is not a member of', async () => {
  const { data, error } = await operator
    .from('tenants').update({ status: 'hijacked' }).eq('id', seeded.tenantB).select();
  expect(error?.code ?? '').not.toBe('');   // 42501, or…
  expect(data ?? []).toEqual([]);           // …zero rows matched
  const { data: row } = await admin.from('tenants').select('status').eq('id', seeded.tenantB).single();
  expect(row!.status).toBe('onboarding');
});

it('cannot enrol itself in another tenant', async () => {
  const { error } = await operator
    .from('tenant_members').insert({ tenant_id: seeded.tenantB, user_id: seeded.operatorId });
  expect(error).not.toBeNull();
  const { data } = await admin.from('tenant_members').select('user_id').eq('tenant_id', seeded.tenantB);
  expect(data).toEqual([]);
});

it('cannot delete a tenant it is not a member of', async () => { /* … */ });
```

### WR-05: Test files run in parallel against one shared operator and one shared database — two real races

**File:** `vitest.config.mts`, `tests/helpers/seed.ts:48-64`, `tests/tenant-create.test.ts:24-38`, `tests/leak.test.ts:53-71`
**Issue:** Vitest runs *files* concurrently by default (`fileParallelism: true`); nothing in the config disables it. Every suite shares `OPERATOR_EMAIL` and one database.

- **Duplicate operator creation.** `leak.test.ts` and `tenant-create.test.ts` each run their own check-then-create in `beforeAll`. On a fresh CI database both see "no such user", both call `admin.auth.admin.createUser`, and the loser gets "email address already registered" — an unhandled throw in `beforeAll` fails an entire blocking suite. Classic TOCTOU.
- **Set-equality assertion is not stable.** `leak.test.ts:58-71` fetches `tenants` and `tenant_members` as two separate round-trips and asserts the sets are equal. `tenant-create.test.ts` concurrently commits `create_tenant` calls (tenant + membership) and concurrently deletes them in `afterAll`. A commit landing between the two requests makes `visible !== member` and reds the CI-blocking leak test for a reason that has nothing to do with isolation.

A blocking gate that fails for reasons unrelated to the property under test gets re-run until green, which is how a real red eventually gets waved through.

**Fix:** Either serialize the DB-touching suites:

```ts
// vitest.config.mts
test: { fileParallelism: false, /* … */ }
```

or (better) make each suite self-isolating: seed the operator once in a `globalSetup`, and give each suite its own operator account (`OPERATOR_EMAIL` with a `+suite` tag) so nothing is shared. Also collapse the duplicated `ensureOperatorExists` into `tests/helpers/seed.ts` and make it tolerate the already-registered error rather than throwing.

### WR-06: `auth-security.test.ts` isolation assertions pass vacuously on a fresh database

**File:** `tests/auth-security.test.ts:19-36,63-71`
**Issue:** Both "returns zero rows to an unauthenticated reader" tests seed nothing. On the CI database — created seconds earlier by `supabase start` and migrated — `tenants` and `tenant_members` may legitimately be empty when this file runs, so `expect(data).toEqual([])` is true whether RLS works or not. The test that is supposed to prove denial cannot distinguish denial from absence, which is exactly the property it exists to check.

The same file's "accepts the correct operator credentials" depends on an operator user that *this file never creates* — it exists only if another file's `beforeAll` has already run. That is a cross-file order dependency in a parallel runner.

**Fix:** Seed inside this suite before asserting, and assert against a known row:

```ts
let seeded: TwoTenants;
beforeAll(async () => { seeded = await seedTwoTenants(); });
afterAll(async () => { await teardownTenants([seeded.tenantA, seeded.tenantB]); });

it('returns zero rows to an unauthenticated reader even though rows exist', async () => {
  const { data, error } = await anonClient().from('tenants').select('*');
  expect(error).toBeNull();
  expect(data).toEqual([]);
  // and prove the rows really are there:
  const { data: real } = await admin.from('tenants').select('id').in('id', [seeded.tenantA, seeded.tenantB]);
  expect(real).toHaveLength(2);
});
```

Call `ensureOperatorExists()` in this file's own `beforeAll`.

### WR-07: CI never builds the application

**File:** `.github/workflows/ci.yml:38-110`
**Issue:** The pipeline runs `tsc --noEmit`, `eslint`, migrations and vitest — but never `next build`. Whole classes of failure ship undetected: a server-only import pulled into a client component graph, a `'use client'` boundary violation, a Server Component that reads `cookies()` in a statically-rendered segment, a route that fails prerendering, a Turbopack config error. `tsc` sees none of these; `next build` sees all of them. For a project whose deploy target is Vercel, "it typechecks" is not "it deploys".

**Fix:** Add after the lint step (before the Supabase stack, so it fails fast):

```yaml
      - name: Build
        run: npx next build
        env:
          NEXT_PUBLIC_SUPABASE_URL: https://build.invalid
          NEXT_PUBLIC_SUPABASE_ANON_KEY: build-only-not-a-secret
```

(The lazy env parsing in `src/core/shared/env.ts` is what makes a credential-free build possible — this step also proves that property stays true.)

### WR-08: `scripts/migrate.mjs` is unwired — nothing runs the safe migration path

**File:** `scripts/migrate.mjs:1-14`, `package.json` (`db:migrate`), `.github/workflows/ci.yml:104-105`
**Issue:** The script's docblock states its reason for existing: "the CLI exits 0 when the connection drops mid-run, which looks like success while nothing was applied — a false-positive state this phase explicitly must not enter." Yet `npm run db:migrate` is `drizzle-kit migrate`, and CI runs `npx drizzle-kit migrate`. The hardened path has no caller anywhere in the repo. A developer migrating the hosted Sydney project over a flaky connection gets exactly the false success the script was written to prevent — and unlike CI, they have no `rls-coverage` suite standing behind them to catch a silent no-op.

**Fix:** Point the npm script at it and use it in CI:

```json
"db:migrate": "node scripts/migrate.mjs"
```

If `drizzle-kit migrate` is genuinely preferred, delete `scripts/migrate.mjs` — one migration entry point, not two with different safety properties.

### WR-09: Destructive integration tests default to the live Sydney project

**File:** `tests/helpers/env.ts:14-19`, `vitest.config.mts` (comment)
**Issue:** `CANDIDATES = ['.env.test', '.env.local']` — `.env.test` does not exist in this repo, so a bare `npm test` on a developer machine loads `.env.local`, which the config comment confirms points at "hosted Supabase in Sydney over the public internet". Those suites then create auth users, insert tenants, `UPDATE` a tenant's status, and delete rows using the **service-role key**, in production. Cleanup is `afterAll`-only: a Ctrl-C, a timeout, or a thrown `beforeAll` leaves seeded tenants and membership rows in the live database, where the operator will see them in the console.

**Fix:** Refuse to run against anything that is not a throwaway stack unless the developer opts in explicitly:

```ts
const isLocal = /127\.0\.0\.1|localhost/.test(testEnv.url);
if (!isLocal && process.env.ALLOW_REMOTE_TESTS !== 'yes') {
  throw new Error(
    `Integration tests write and delete data. ${testEnv.url} is not a local stack.\n` +
    'Create .env.test pointing at a throwaway project, or set ALLOW_REMOTE_TESTS=yes.',
  );
}
```

Commit a `.env.test.example` alongside it.

### WR-10: The RLS-coverage guard checks that RLS is enabled, never that a policy is restrictive

**File:** `tests/rls-coverage.test.ts:29-46`
**Issue:** The suite is described as "the standing guard for every table that does not exist yet", and it queries `pg_tables.rowsecurity` only. A future table shipping with `CREATE POLICY … FOR ALL TO authenticated USING (true)` — the single most common RLS mistake, and the one that produces a real cross-tenant leak — has `rowsecurity = true` and sails straight through. It also passes a table with RLS enabled and *no* policy at all (deny-all, which is safe but usually unintended and invisible until a query returns nothing).

**Fix:** Add two assertions over `pg_policies`:

```ts
it('has at least one policy on every RLS-enabled public table', async () => { /* … */ });

it('has no policy whose USING clause is unconditionally true', async () => {
  const wide = await sql<{ tablename: string; policyname: string }[]>`
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public'
      AND (qual = 'true' OR with_check = 'true')
  `;
  expect(wide, 'A USING(true) policy is RLS in name only').toEqual([]);
});
```

### WR-11: The duplicate-name unique index is global, making it a cross-tenant existence oracle

**File:** `src/db/migrations/0002_create_tenant_rpc.sql:67`, `src/core/shared/tenant.ts:184-203`
**Issue:** `CREATE UNIQUE INDEX tenants_name_lower_key ON public.tenants (lower(name))` spans the whole table, not the caller's membership set. Correct for a single-operator MVP; wrong the moment a second operator exists (which the project plans — "v2 reports portal", and `tenant_members.role` already anticipates more than one member). Operator B typing a client name that operator A already onboarded gets "A client with that name already exists" for a row RLS says they cannot see. That is precisely the denial-vs-absence property `T-03-02` protects everywhere else, inverted. It also hard-blocks two operators from legitimately onboarding two different businesses that share a trading name.

**Fix:** Scope uniqueness to the owner once membership is more than one row deep — e.g. a unique index on `(owner_user_id, lower(name))` with an explicit `owner_user_id` column set by `create_tenant`, or a partial index per operator. At minimum, record the decision and a trigger condition in the phase notes so it is revisited before the second operator is provisioned rather than after.

### WR-12: `create-operator.mjs` has a dead error branch; a real failure escapes as an unhandled rejection

**File:** `scripts/create-operator.mjs:45-59`
**Issue:**

```js
const { data, error } = await withRetry('createUser', async () => {
  const result = await admin.auth.admin.createUser({ … });
  if (result.error) throw result.error;   // <- never returns an error-bearing result
  return result;
});
if (error) { console.error(…); process.exit(1); }   // <- unreachable
```

The callback throws on failure, so `withRetry` either returns a success result or propagates the throw. `error` is always `undefined` and the handler never runs. A non-transient failure (weak password rejected, email already registered, service-role key wrong) therefore surfaces as an unhandled promise rejection with a raw stack trace at top level, instead of the intended one-line message and exit 1 — for the script an operator runs during provisioning, at the exact moment they are least equipped to read a Supabase SDK stack.

Note `withRetry` also has an implicit `return undefined` fall-through path (`support.mjs:47-57`) that is unreachable today but will silently produce `undefined` if the loop condition is ever edited.

**Fix:**

```js
let created;
try {
  created = await withRetry('createUser', async () => {
    const result = await admin.auth.admin.createUser({ … });
    if (result.error) throw result.error;
    return result;
  });
} catch (e) {
  console.error(`Failed to create operator: ${e.message}`);
  process.exit(1);
}
console.log(`Operator created: ${email} (id ${created.data.user.id})`);
```

Add `throw new Error(\`${label}: retry loop exited without a result\`)` after the loop in `withRetry`.

### WR-13: Three extensions enabled two phases before use, unpinned to a schema and with no privilege assertion

**File:** `src/db/migrations/0000_extensions_and_tenant_access.sql:19-23`
**Issue:** `pg_cron`, `pg_net` and `pgmq` are created now "because it is cheap and forward-compatible". `pg_net` in particular gives the database the ability to make arbitrary outbound HTTP requests — a server-side request forgery primitive sitting in the trust boundary this phase is otherwise so careful about. No `WITH SCHEMA` is specified, and no migration revokes or asserts who may execute the new functions, while `supabase/config.toml:15` puts `extensions` on the API search path. Nothing in `tests/rls-coverage.test.ts` or elsewhere asserts that `anon` and `authenticated` cannot reach `net.http_post` / `cron.schedule`.

The same migration's comment concedes "If the hosted platform rejects one of these, enable it in Dashboard → Database → Extensions and re-run", which contradicts the stated principle two files later that "the migration set must stand up a working database on its own, not lean on state someone configured once in a dashboard."

**Fix:** Either defer these to the phase that uses them, or pin and prove them:

```sql
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
REVOKE ALL ON SCHEMA net FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA net FROM anon, authenticated;
```

Add a test asserting an anon and an authenticated client cannot invoke any `net.*` or `cron.*` function.

## Info

### IN-01: `src/lib/supabase/browser.ts` is dead code

**File:** `src/lib/supabase/browser.ts:1-19`
**Issue:** No module imports it (`grep -rn "supabase/browser" src tests scripts` returns only the file itself). The console has exactly one client component (`clients/new/form.tsx`) and it uses a Server Action, not a browser client. Dead code in the auth layer is the kind that gets copy-pasted into a client component later without anyone re-reviewing the anon-key handling.
**Fix:** Delete it; reintroduce it in the phase that needs a browser-side session.

### IN-02: `.env.example` is referenced in three places but does not exist

**File:** `.gitignore:29` (`!.env.example`), `.github/workflows/ci.yml:57`, `drizzle.config.ts` comments
**Issue:** The gitignore whitelists it, the CI secret scan carves it out, and `docs/env-vars.md` is the only actual contract. A new machine has nothing to copy.
**Fix:** Commit `.env.example` with every key from `docs/env-vars.md` and empty values.

### IN-03: `ensureOperatorExists` exists in three variants

**File:** `tests/helpers/seed.ts:48-64`, `tests/tenant-create.test.ts:24-38`, `scripts/create-operator.mjs:24-35`
**Issue:** Three near-identical implementations with different behaviours: only the script paginates. The two test copies assume the operator is on page one (`perPage: 200`) and would silently attempt to re-create the user on a project with more users than that.
**Fix:** One exported helper in `tests/helpers/seed.ts`, imported by both suites; have it page like the script does.

### IN-04: Raw Postgres error text is rendered into the console UI

**File:** `src/app/(console)/page.tsx:29`, `src/app/(console)/clients/[id]/page.tsx:78`
**Issue:** `Could not load clients: {error.message}` surfaces driver/schema detail (constraint names, column names, SQLSTATE text) to whoever is looking at the screen. Operator-only today, so the impact is low; it becomes a disclosure the moment any page is shared or a client portal exists.
**Fix:** Render a fixed message, log the detail server-side with a correlation id, and show the id.

### IN-05: Hand-written database objects are invisible to the drizzle snapshots

**File:** `src/db/migrations/meta/0002_snapshot.json`, `0003_snapshot.json`
**Issue:** Verified: none of the snapshots contain `tenants_name_lower_key`, and none can represent `has_tenant_access`, `create_tenant`, or the GRANTs. Drizzle believes those objects do not exist. A future `drizzle-kit generate` that adds the same index from the schema file will emit a bare `CREATE UNIQUE INDEX` that fails against the live database, and `drizzle-kit push`/`pull` would diverge harder.
**Fix:** Note the hand-written objects in a `src/db/migrations/README.md`, and keep using `IF NOT EXISTS` / `CREATE OR REPLACE` in custom SQL as this phase already does.

### IN-06: `PUBLIC_PATHS` in the proxy is unreachable, and the matcher exclusion is a prefix match

**File:** `src/lib/supabase/proxy.ts:7,51-54`, `proxy.ts:16`
**Issue:** `/login` is already excluded by the matcher, so `updateSession` never sees it and the `isPublic` branch never evaluates true. Harmless as defence in depth, but it reads as an active guard. Separately the matcher exclusion has no anchor, so `/login-anything` also skips the proxy.
**Fix:** Keep the list (it is the right place for the check) but move the exclusion out of the matcher, or anchor it: `(?!login$|login/)`.

### IN-07: `new URL(DATABASE_URL)` can throw before the useful error is produced

**File:** `src/db/repository/client.ts:44`
**Issue:** A connection string whose password contains an unencoded `#`, `/` or `@` makes `new URL()` throw a bare `TypeError: Invalid URL` from inside `getDb()`, replacing the intended port warning with a message that names nothing. Supabase-generated passwords can contain such characters.
**Fix:** Wrap the port check in `try/catch` and warn "DATABASE_URL is not a parseable URL — check that the password is percent-encoded" without echoing the value.

### IN-08: The detail page casts the PostgREST result instead of using generated types

**File:** `src/app/(console)/clients/[id]/page.tsx:16-27,87`
**Issue:** `data as TenantRow | null` is an unchecked assertion; the hand-written `TenantRow` and the `select(…)` column list can drift apart silently (the list page selects a different, overlapping set with no type at all).
**Fix:** Generate database types (`supabase gen types typescript`) and type the client, or at minimum derive the row type from the drizzle schema so one definition governs.

### IN-09: The CI secret scan covers `src/app` only

**File:** `.github/workflows/ci.yml:44-53`
**Issue:** The grep looks for `SUPABASE_SERVICE_ROLE_KEY` under `src/app`. `src/lib` and `src/core` are equally capable of ending up in a client bundle (both are imported by client-reachable modules today), and the literal-string match misses any computed access. The rule as written encodes "don't type this string in one directory" rather than "this key never reaches the browser".
**Fix:** Scan `src/` with an allowlist for `src/db/repository/`, and add the stronger post-build assertion once WR-07 lands: grep the emitted `.next/static/**` chunks for the key's value and fail if found.

---

_Reviewed: 2026-08-25_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
