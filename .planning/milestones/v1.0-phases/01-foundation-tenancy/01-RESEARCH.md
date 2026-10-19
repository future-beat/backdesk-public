# Phase 1: Foundation & Tenancy - Research

**Researched:** 2026-08-25
**Domain:** Multi-tenant SaaS foundation — Supabase (Sydney) + Next.js + drizzle-orm, RLS-everywhere tenancy, external registration lead-time clocks
**Confidence:** MEDIUM overall — package versions and framework facts verified against npm registry and official docs this session; external-provider lead times (ServiceM8 approval, ClickSend provisioning) remain LOW and are handled as day-1 clock-starts with documented fallbacks

## User Constraints

No CONTEXT.md exists for this phase (no `/gsd-discuss-phase` run). The binding constraints below are locked project-level decisions from PROJECT.md / STATE.md and must be honored:

### Locked Decisions (from PROJECT.md Key Decisions + STATE.md)
- Custom TypeScript service + Next.js console on Vercel; Supabase (Postgres/auth/cron) in Sydney region (`ap-southeast-2`) — AU data residency is a selling point
- ClickSend dedicated AU numbers (Twilio fallback); Resend for email — provider decisions already made in project research
- drizzle-orm + drizzle-kit over Prisma; no n8n/Zapier
- Budget ≤ ~$200/mo pre-revenue; Supabase Pro + Vercel Pro are within budget per STACK.md cost check
- Walking skeleton target: first cadence for a real client in ~2 weeks — Phase 1 must not gold-plate

### Claude's Discretion
- Exact migration workflow (drizzle-kit vs supabase CLI as authority) — recommendation below
- RLS policy keying mechanism, `forTenant()` design, leak-test mechanics
- Repo scaffold layout details (within ARCHITECTURE.md's `core/` structure)

### Deferred (OUT OF SCOPE for this phase)
- ServiceM8 sync implementation (Phase 2) — Phase 1 only *submits the partner registration*
- Messaging/SMS implementation (Phase 4) — Phase 1 only *orders the number*
- Client logins, report portal, employee accounts (v2)

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ONB-01 | Operator can create a client (tenant) with business profile, trade type, timezone, and contact-hours window | `tenants` schema sketch (Architecture Patterns §Data Model), Supabase Auth operator-console pattern (Pattern 2), Next.js 16 App Router + @supabase/ssr auth (Pattern 2, Code Examples), tenant-creation form fields cross-checked against ARCHITECTURE.md data model |
| ONB-05 | All data access is tenant-scoped — RLS on all tables plus a tenant-scoped query layer for service-role workers, with cross-tenant leak tests in CI | drizzle-orm native RLS (`pgPolicy`) support (Pattern 1), `forTenant()` repository design (Pattern 3, Code Examples), two-tenant leak test + RLS-everywhere check in CI (Validation Architecture, Code Examples), Pitfall 11 mitigations from project PITFALLS.md |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

`./.claude/CLAUDE.md` contains the GSD-managed project block. Actionable directives:

- **Workflow enforcement:** file changes must go through GSD commands (`/gsd-execute-phase` for planned work) — the planner's tasks execute inside that flow, no bypass
- **Stack block is authoritative:** the embedded STACK.md content (drizzle over Prisma, no ClickSend SDK, dedicated virtual numbers not alpha tags, etc.) carries locked-decision weight
- No additional coding conventions or security rules yet ("Conventions not yet established") — Phase 1 establishes them

## Summary

Phase 1 builds the multi-tenant skeleton everything else stands on: a Supabase project in Sydney, a Next.js console with operator-only Supabase Auth, a schema where every table is tenant-scoped with RLS enabled from migration 001, a `forTenant()` repository layer that is the *only* path service-role code can take to tenant data, and a CI pipeline that proves tenant isolation with an automated two-tenant leak test. It also starts two external clocks that gate later phases: ServiceM8 Development Partner registration (needed for OAuth/webhooks in Phase 2) and a dedicated AU virtual number order at ClickSend (needed for SMS in Phase 4).

The most consequential fact discovered this session: **Next.js 16 (16.3.2) is current stable, not 15** — STACK.md's "15.x, verify at init" is now resolved to 16. This matters concretely: `middleware.ts` is deprecated in favor of `proxy.ts` (Node.js runtime only), request APIs (`cookies()`, `params`) are async-only, and Turbopack is the default bundler. The Supabase docs already describe their auth-refresh layer as "Proxy," so the `@supabase/ssr` pattern maps cleanly. Second key finding: drizzle-orm now has first-class RLS support (`pgPolicy` in schema definitions, Supabase role helpers in `drizzle-orm/supabase`), which settles the migration-authority question — **drizzle-kit is the single schema authority**; the Supabase CLI is used for the local stack and for plain-SQL extras (extensions, cron schedules) via drizzle custom migrations. Third: the dev machine has **no Docker**, which `supabase start` requires — local dev needs a Docker runtime installed (or the leak test runs against local Homebrew Postgres 17, which is present); GitHub Actions runners have Docker, so CI is unaffected.

**Primary recommendation:** Scaffold one Next.js 16 app with `src/core` domain modules, define schema + RLS policies in drizzle (`pgPolicy` on every table, membership-lookup policies), gate all service-role access behind `forTenant()`, run the two-tenant leak test in CI against `supabase start`, and submit both external registrations on day 1 with the fallback paths (per-client private API keys; Twilio regulatory bundle) written into the phase's verification notes.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Operator login / session | Frontend Server (Next.js proxy + server components) | Database (Supabase Auth) | `@supabase/ssr` refreshes tokens in `proxy.ts`; Supabase Auth stores identities |
| Tenant creation form + validation | Frontend Server (server actions) | Database | Zod validation server-side; insert via authenticated client so RLS is exercised, not bypassed |
| Tenant data isolation (RLS) | Database | API/Backend (`forTenant()`) | RLS policies are the backstop; repository layer is the service-role guard where RLS is bypassed |
| Service-role worker data access | API/Backend (`src/core` via `forTenant()`) | Database | Service role bypasses RLS by design — app-layer scoping is load-bearing (ONB-05) |
| Leak test / RLS-everywhere check | CI (GitHub Actions + local Supabase) | Database | Isolation must be proven automatically, not assumed |
| ServiceM8 partner registration | External (manual, human) | — | Web form + agreement; no code |
| AU virtual number provisioning | External (manual, human) | — | ClickSend dashboard purchase; no code |
| Secrets (service-role key, DB URL) | Deployment platform (Vercel env) | — | Server-only env vars; never `NEXT_PUBLIC_*` |

## Standard Stack

All versions below verified against the npm registry this session (2026-08-25) via `npm view <pkg> version`.

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | 16.3.2 [VERIFIED: npm registry — version; package flagged SUS "too-new" by legitimacy seam, see audit] | Console + route handlers | Locked stack; **16 is current stable, not 15** — 15.x is one major behind [CITED: nextjs.org/docs/app/guides/upgrading/version-16] |
| `react` / `react-dom` | 19.2.8 [VERIFIED: npm registry] | UI runtime | Required by Next 16 (App Router uses React 19.2 canary features) |
| `typescript` | **pin ~5.9.3** (npm `latest` is now 7.0.2 — the native-compiler line) [VERIFIED: npm registry — `npm view typescript dist-tags` returned `"latest": "7.0.2"`, `"beta": "6.0.0-beta"`; last 5.x is 5.9.3] | Language | Next 16 requires TS ≥ 5.1; TS 7 (Go-native) ecosystem compat with drizzle-kit/vitest is unverified — pin 5.9.3, revisit later (see Open Questions) |
| `@supabase/supabase-js` | 2.112.4 [VERIFIED: npm registry — version; SUS "too-new", see audit] | DB/auth client | Official client; anon key in console, service-role server-only |
| `@supabase/ssr` | 0.12.5 [VERIFIED: npm registry — version; SUS "too-new", see audit] | Cookie-based auth for App Router | The official replacement for auth-helpers; docs pattern uses `getClaims()` [CITED: supabase.com/docs/guides/auth/server-side/nextjs] |
| `drizzle-orm` | 0.45.2 [VERIFIED: npm registry] | Typed schema + queries + **RLS policies in schema** | First-class `pgPolicy` + `drizzle-orm/supabase` role helpers [CITED: orm.drizzle.team/docs/rls] |
| `drizzle-kit` | 0.31.10 [VERIFIED: npm registry] | Migration generation/apply | Generates policy DDL from schema; single migration authority (see Pattern 1) |
| `postgres` (postgres.js) | 3.4.9 [VERIFIED: npm registry] | Driver for drizzle | STACK.md-recommended driver; transaction pooler port 6543 for serverless runtime, **direct/session connection for migrations** |
| `zod` | 4.4.3 [VERIFIED: npm registry] | Env + form + boundary validation | Locked stack choice (v4) |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` | 4.1.11 [VERIFIED: npm registry — version; SUS "too-new", see audit] | Unit + leak tests | All Phase 1 tests; config in `vitest.config.ts` |
| `supabase` (CLI, dev dep) | 2.115.0 [VERIFIED: npm registry — version; SUS "too-new", see audit] | Local stack (`supabase start`), `supabase test db` | Local dev + CI service container; **not** the schema authority |
| `@types/node` | 26.2.0 [VERIFIED: npm registry — version; SUS "too-new", see audit] | Types | Dev dep |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| drizzle-kit as migration authority | `supabase/migrations/*.sql` + `supabase db push`, drizzle types via `drizzle-kit pull` | Keeps everything in Supabase's flow, but splits truth (SQL files + TS schema drift apart) and loses drizzle's typed `pgPolicy` definitions. Pick ONE authority — recommendation is drizzle-kit (see Pattern 1) |
| Vitest app-level leak test | pgTAP via `supabase test db` (+ basejump `supabase_test_helpers`) | pgTAP gives transactional isolation and per-policy coverage but is a second test framework/language; use pgTAP *in addition* only for the RLS-everywhere assertion if desired — the CI leak test itself should be Vitest so it exercises the real `forTenant()` code path |
| `proxy.ts` (Next 16 convention) | Keep `middleware.ts` (deprecated, still works, required if edge runtime needed) | `proxy.ts` runs Node.js runtime only; Supabase auth refresh doesn't need edge — use `proxy.ts` [CITED: nextjs.org/docs/app/guides/upgrading/version-16] |

**Installation:**
```bash
# Scaffold (Next 16, App Router, TS, src dir)
npx create-next-app@latest . --typescript --app --src-dir --no-tailwind --use-npm

# Data + auth layer
npm install @supabase/supabase-js @supabase/ssr drizzle-orm postgres zod
npm install -D drizzle-kit supabase vitest @types/node typescript@~5.9.3
```

**Version verification:** all of the above confirmed on the npm registry this session; re-run `npm view <pkg> version` at execution time and pin exact versions in `package.json`.

## Package Legitimacy Audit

Ran `gsd-tools query package-legitimacy check --ecosystem npm` on all 13 recommended packages. No package returned SLOP. Seven returned SUS with the single reason `too-new` — meaning the *latest patch* was published within the last few days, not that the package is unknown. All seven are canonical, extreme-download-volume packages with correct source repos and **no postinstall scripts** (`postinstall: null` for every package checked).

| Package | Registry | Latest publish | Downloads/wk | Source Repo | Verdict | Disposition |
|---------|----------|-----------|-----------|-------------|---------|-------------|
| next | npm | 2026-08-21 | 53.1M | github.com/vercel/next.js | [SUS: too-new] | Flagged — pin exact `16.3.2`; planner adds one verify step at scaffold |
| react | npm | 2026-07-21 | 170.5M | github.com/react/react | [OK] | Approved |
| react-dom | npm | 2026-07-21 | 159.6M | github.com/react/react | [OK] | Approved |
| @supabase/supabase-js | npm | 2026-08-24 | 24.7M | github.com/supabase/supabase-js | [SUS: too-new] | Flagged — pin `2.112.4` |
| @supabase/ssr | npm | 2026-08-24 | 7.1M | github.com/supabase/ssr | [SUS: too-new] | Flagged — pin `0.12.5` |
| drizzle-orm | npm | 2026-03-27 | 19.7M | github.com/drizzle-team/drizzle-orm | [OK] | Approved |
| drizzle-kit | npm | 2026-03-17 | 16.4M | github.com/drizzle-team/drizzle-orm | [OK] | Approved |
| postgres | npm | 2026-04-05 | 15.7M | github.com/porsager/postgres | [OK] | Approved |
| zod | npm | 2026-05-04 | 265.7M | github.com/colinhacks/zod | [OK] | Approved |
| typescript | npm | 2026-07-08 | 269.6M | github.com/microsoft/TypeScript | [OK] | Approved (pin ~5.9.3, not latest 7.0.2) |
| vitest | npm | 2026-08-18 | 93.3M | github.com/vitest-dev/vitest | [SUS: too-new] | Flagged — pin `4.1.11` |
| supabase (CLI) | npm | 2026-08-18 | 3.6M | github.com/supabase/cli | [SUS: too-new] | Flagged — pin `2.115.0` |
| @types/node | npm | 2026-08-07 | 416.5M | github.com/DefinitelyTyped/DefinitelyTyped | [SUS: too-new] | Flagged — pin `26.2.0` |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** next, @supabase/supabase-js, @supabase/ssr, vitest, supabase, @types/node — all flagged solely for recent latest-patch timestamps on canonical packages with tens of millions of weekly downloads and no postinstall scripts. Recommended handling: pin the exact versions listed above (which were the registry-verified versions on 2026-08-25) and cover all installs with a **single** `checkpoint:human-verify` at project scaffold rather than one per package — a per-package checkpoint would be noise given the signal cause.

## Architecture Patterns

### System Architecture Diagram

```
                 Operator (founder, phone/desktop browser)
                                  │  HTTPS
                                  ▼
        ┌─────────────────────────────────────────────────────┐
        │            NEXT.JS 16 APP (Vercel, syd1)            │
        │                                                     │
        │  proxy.ts ──► @supabase/ssr getClaims()             │
        │   (session refresh + route protection, Node runtime)│
        │        │ authenticated                              │
        │        ▼                                            │
        │  (console)/ pages ──► server actions                │
        │   clients/new  ─── zod validate ──► insert tenant   │
        │   clients/[id] ─── read via authenticated client    │
        │        │                    (anon key, RLS ENFORCED)│
        │  ──────┼─────────────────────────────────────────   │
        │  src/core (future workers, service-role key)        │
        │        │                                            │
        │        ▼                                            │
        │  src/db/repository: forTenant(tenantId) ──────┐     │
        │   (ONLY export that touches tenant tables;    │     │
        │    raw client is module-private)              │     │
        └───────────────────────────────────────────────┼─────┘
                    │ anon key + JWT                    │ service-role key
                    ▼                                   ▼
        ┌─────────────────────────────────────────────────────┐
        │        SUPABASE (ap-southeast-2, Pro plan)          │
        │  Postgres 15+: tenants, tenant_members,             │
        │    cadence_templates (stub), + RLS ON EVERY TABLE   │
        │  Auth: single operator user, signups disabled       │
        │  Extensions enabled in migration: pg_cron, pg_net,  │
        │    pgmq (schedules land in later phases)            │
        └─────────────────────────────────────────────────────┘

   CI (GitHub Actions):                  External clocks (day 1, human):
   typecheck ► vitest unit               ServiceM8 partner registration ──► Phase 2
   ► supabase start (Docker)             ClickSend AU number order ───────► Phase 4
   ► drizzle-kit migrate                   (fallbacks: private API keys;
   ► two-tenant leak test                   Twilio regulatory bundle)
   ► RLS-everywhere assertion
```

### Recommended Project Structure

Per ARCHITECTURE.md (`.planning/research/ARCHITECTURE.md` §Recommended Project Structure), trimmed to what Phase 1 actually creates:

```
src/
├── app/
│   ├── (console)/
│   │   ├── layout.tsx          # Auth-gated shell (server component, getClaims check)
│   │   ├── page.tsx            # Client list (dashboard seed)
│   │   └── clients/
│   │       ├── new/page.tsx    # Tenant creation form (ONB-01)
│   │       └── [id]/page.tsx   # Tenant detail (profile, hours, tz)
│   ├── login/page.tsx          # Operator sign-in
│   └── layout.tsx
├── core/                       # Domain logic — no Next.js imports (empty-ish in P1)
│   └── shared/
│       ├── tenant.ts           # Tenant domain types, contact-hours value object
│       └── env.ts              # zod-validated env (server/client split)
├── db/
│   ├── schema/
│   │   ├── tenants.ts          # pgTable + pgPolicy definitions
│   │   └── index.ts
│   ├── repository/
│   │   ├── client.ts           # module-private postgres.js + drizzle instances
│   │   └── for-tenant.ts       # forTenant() — the only tenant-data export
│   └── migrations/             # drizzle-kit output + custom SQL (extensions)
├── lib/
│   └── supabase/
│       ├── server.ts           # createServerClient (per-request)
│       ├── browser.ts          # createBrowserClient (singleton)
│       └── proxy.ts            # session-refresh helper used by /proxy.ts
proxy.ts                        # Next 16 convention (was middleware.ts)
drizzle.config.ts
vitest.config.ts
supabase/config.toml            # local stack config (CLI-managed)
tests/
├── leak.test.ts                # two-tenant leak test (CI-blocking)
└── rls-coverage.test.ts        # every-table-has-RLS assertion
.github/workflows/ci.yml
```

### Pattern 1: drizzle-kit as the single migration authority (RLS policies in schema)

**What:** Define tables AND RLS policies in TypeScript with `pgTable` + `pgPolicy`; `drizzle-kit generate` emits SQL migrations including policy DDL; `drizzle-kit migrate` applies them. The Supabase CLI runs the local stack only — never `supabase db push`. Platform-SQL that drizzle can't model (enabling `pg_cron`/`pg_net`/`pgmq` extensions, future cron schedules) goes in hand-written custom migrations in the same drizzle journal (`drizzle-kit generate --custom`).

**When to use:** Always in this repo. Two migration systems (drizzle journal + supabase/migrations) is the classic drift trap — the phase focus explicitly asks to "pick one authority."

**Key mechanics** [CITED: orm.drizzle.team/docs/rls]:
- Adding a `pgPolicy` to a table auto-enables RLS on it — no separate `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` to forget
- `drizzle-orm/supabase` exports `authenticatedRole`, `anonRole`, `serviceRole`, `authUid`, and `authUsers` (typed reference to `auth.users`)
- Supabase-managed roles must be marked existing via `drizzle.config.ts` → `entities.roles: { provider: 'supabase' }` so drizzle-kit doesn't try to create/drop them
- **Connection discipline:** `drizzle-kit migrate` needs a session-mode connection (direct connection or session pooler, port 5432); runtime serverless queries use the transaction pooler (port 6543). Two env vars: `DATABASE_URL` (runtime, 6543) and `DIRECT_URL`/`MIGRATE_DATABASE_URL` (migrations, 5432) [ASSUMED — standard Supabase+drizzle guidance; confirm exact pooler hostnames from the project's dashboard at setup]

**Example:**
```typescript
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.MIGRATE_DATABASE_URL! },
  entities: { roles: { provider: 'supabase' } }, // don't manage Supabase's own roles
});
```

### Pattern 2: Operator-only Supabase Auth on Next.js 16 (`proxy.ts` + `getClaims()`)

**What:** Single operator user; **disable public signups** in Supabase Auth settings (or enforce a one-row allowlist). `@supabase/ssr` provides `createBrowserClient` (singleton, client components) and `createServerClient` (per-request, cookie `getAll`/`setAll` adapters). The Next 16 `proxy.ts` (renamed from `middleware.ts`, Node runtime only) refreshes the session every request and redirects unauthenticated requests to `/login`.

**Critical rules** [CITED: supabase.com/docs/guides/auth/server-side/nextjs]:
- Protect pages/routes with `supabase.auth.getClaims()` — it verifies the JWT signature against the project's public keys. **Never trust `getSession()` in server code.**
- The proxy must pass refreshed tokens both directions: `request.cookies.set` (for server components downstream) and `response.cookies.set` (for the browser)
- Next 16: `cookies()` is async-only — every `createServerClient` factory must `await cookies()` [CITED: nextjs.org/docs/app/guides/upgrading/version-16]

**When to use:** All console routes. Email+password (+ optional TOTP later) — per STACK.md, no magic-link-only flows (console must open fast on a phone).

### Pattern 3: `forTenant()` — the tenant-scoped repository layer for service-role code

**What:** Service-role connections bypass RLS by design, so the ONLY guard for worker code is the application layer (PITFALLS.md Pitfall 11). Make the raw drizzle/postgres client **module-private** to `src/db/repository/`; the sole exported surface for tenant-scoped tables is `forTenant(tenantId)`, which returns query helpers that bake the `tenant_id` predicate into every operation. Cross-tenant operations (future tick claims) get their own explicitly-named, narrowly-scoped exports (`forAllTenants_tickClaim()` style) so a reviewer can grep for every cross-tenant touchpoint.

**Enforcement:** an ESLint `no-restricted-imports` rule bans importing `src/db/repository/client` outside `src/db/repository/**` — "raw table access is lint-banned" per PITFALLS.md Pitfall 11. The leak test then proves the pattern holds at runtime.

**Design sketch (see Code Examples for fuller version):**
```typescript
export function forTenant(tenantId: string) {
  return {
    tenants: {
      get: () => db.select().from(tenants).where(eq(tenants.id, tenantId)),
      update: (patch: TenantPatch) =>
        db.update(tenants).set(patch).where(eq(tenants.id, tenantId)),
    },
    // each future tenant-scoped table gets a scoped accessor here;
    // no method ever accepts a tenantId parameter — it's closed over
  };
}
```

**Stronger variant (Claude's discretion, optional):** give workers a dedicated non-bypassing Postgres role and set `SET LOCAL app.tenant_id = '<uuid>'` per transaction, with RLS policies that also check `current_setting('app.tenant_id')` — DB-enforced scoping even for workers. Worth considering in Phase 3 when the tick lands; for Phase 1 the success criterion only requires the repository layer + leak test. [ASSUMED — pattern is standard Postgres multi-tenancy practice but not required by the phase]

### Pattern 4: RLS policies keyed by membership lookup, not JWT claims

**What:** Per ARCHITECTURE.md (§Multi-Tenancy, read this session): policies check a `tenant_members(tenant_id, user_id, role)` row via a `SECURITY DEFINER` helper function rather than trusting `raw_user_meta_data` (user-modifiable) or custom JWT claims. Day one there is one auth user (the founder) with a membership row per client — adding employees later is an INSERT, not a schema change.

**Verbatim from ARCHITECTURE.md** [VERIFIED: .planning/research/ARCHITECTURE.md:327-332]:
> - **Shared tables, `tenant_id` on every row** — the standard Supabase pattern. No per-tenant schemas.
> - **Policies via membership lookup, not JWT metadata:** `tenant_members(tenant_id, user_id, role)` + a `SECURITY DEFINER` helper `has_tenant_access(tid uuid)` used in every policy. Do not trust `raw_user_meta_data` claims (user-modifiable); a DB lookup is the safe default and trivially fast at this row count.

**Why `SECURITY DEFINER` for the helper:** a policy on `tenant_members` itself would otherwise recurse when other policies query it; the definer function sidesteps policy recursion and gets a stable plan. Mark the function `STABLE` and set a fixed `search_path`. [ASSUMED — standard Supabase RLS practice]

### Pattern 5: External registrations as first-class phase tasks with fallback docs

**What:** The two lead-time clocks are *deliverables*, not side quests. Each is a human-action task producing an artifact:

1. **ServiceM8 Development Partner registration** — self-serve form at `servicem8.com/developer-registration` (account details + accept the Developer Agreement). After registering, create an add-on under Account → Developer → "Add Item"; **App ID/App Secret are issued immediately on save** — no approval gate for that. OAuth via a Public Application works on real accounts through the **Private Add-on Install URL without Add-on Store listing**; store listing approval is a separate 6-step review (test via private URL → complete listing → submit → assess → partner preview → public) with **no published lead time** [ASSUMED — assembled from developer.servicem8.com/docs/authentication, /docs/servicem8-add-on-store, and servicem8.com/developer-registration fetched this session; the immediate-issuance claim comes from official docs but couldn't be end-to-end confirmed without actually registering]. **Fallback (bridges Phase 2 regardless):** per-client private API keys (`X-API-Key` from the client's own ServiceM8 settings, zero approval) + edit_date polling — already the STACK.md variant plan.
2. **ClickSend dedicated AU virtual number** — sign up, then Dashboard → Sender IDs → "Buy a Number" → Australia. Requires business name, contact details, and an **Australian street address in IPND format (no PO boxes)**; ACMA verification applies to all registrations. API pricing lists an AU dedicated number at **~AUD $20.71/mo, no setup fee**; inbound SMS/two-way is free. Provisioning time is **not published** — assume verification can take days [ASSUMED — from help.clicksend.com/en/articles/43652 (fetched) + ClickSend developer API docs via search; verify price and timing at actual signup]. **Fallback:** Twilio AU mobile number — requires an approved **Regulatory Bundle before purchase** (business name, AU address, ABN with proof docs); review "generally up to three business days," sometimes longer [ASSUMED — Twilio regulatory docs via search]. Start the ClickSend order day 1; if not provisioned by the time Phase 4 planning starts, submit the Twilio bundle in parallel.

**Deliverable:** a `docs/external-registrations.md` (or section in the phase VERIFICATION notes) recording: date submitted, account IDs, current status, and the go/no-go fallback trigger for each.

### Anti-Patterns to Avoid

- **Deferring RLS because "it's just me":** PITFALLS.md Anti-Pattern — retrofitting policies onto live data is the classic Supabase incident class; enable on every table in migration 001 (this is success criterion 2)
- **Two migration authorities:** `supabase db push` + drizzle-kit in the same repo guarantees drift; drizzle-kit only
- **Service-role key anywhere client-reachable:** never `NEXT_PUBLIC_*`; secret scanning in CI (PITFALLS.md Security Mistakes table)
- **`middleware.ts` + edge assumptions in new code:** Next 16 deprecates the name; `proxy.ts` is Node-runtime-only — don't write edge-dependent auth code
- **RLS policies reading `raw_user_meta_data`:** user-modifiable; membership lookup instead (Pattern 4)
- **`forTenant()` methods that accept a `tenantId` argument:** the tenant must be closed over at construction — a per-call parameter reintroduces the forgotten-filter bug shape
- **Building the cron tick in Phase 1:** enable the extensions in a migration (cheap, forward-compatible); schedules and heartbeat land with the cadence engine (Phase 3)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Session/cookie management | Custom JWT cookie handling | `@supabase/ssr` (`createServerClient`/`createBrowserClient`) | Chunked-cookie handling, refresh races, and cache-header pitfalls are all handled; docs explicitly warn about hand-rolled `getSession()` trust |
| Auth UI + password handling | Custom credential store | Supabase Auth (signups disabled) | Hashing, lockouts, MFA-ready for free |
| Migration diffing | Hand-written ALTER statements | drizzle-kit generate | Policy DDL + schema diffing with a journal; hand-written SQL only for platform extras via `--custom` |
| RLS enablement tracking | A checklist in a doc | `pgPolicy` in every `pgTable` + automated every-table-has-RLS test | Policy-in-schema means a new table without a policy fails review AND the CI assertion catches it |
| Tenant-scoping discipline | Code-review vigilance alone | `forTenant()` + ESLint import ban + leak test | Three independent layers; vigilance is not a control |
| Timezone/contact-hours math | Manual offset arithmetic | `date-fns` + `date-fns-tz` with IANA `Australia/Perth` (Phase 3; but store tz as IANA string now) | Locked stack choice; naive offsets break the moment a non-WA client signs |

**Key insight:** Phase 1's entire value is *guarantees* (isolation, auth, migration integrity). Every guarantee here must come from a mechanism (constraint, policy, test, lint rule) rather than convention — conventions don't survive the 2-week walking-skeleton pace.

## Common Pitfalls

### Pitfall 1: Planning against Next.js 15 when 16 is stable
**What goes wrong:** Plans written from STACK.md's "Next.js 15.x" produce `middleware.ts`, sync `cookies()`, and `next lint` tasks that are deprecated/removed in 16.
**Why it happens:** STACK.md predates this session's version check ("verify at init" was the instruction).
**How to avoid:** Target `next@16.3.2` pinned. Use `proxy.ts`, `await cookies()`, ESLint CLI directly (no `next lint`), Turbopack defaults (no `--turbopack` flags).
**Warning signs:** any plan task mentioning `middleware.ts` or `next lint`.

### Pitfall 2: Service-role leak test that doesn't test the real code path
**What goes wrong:** The leak test seeds two tenants and queries with the *authenticated* client only — proving RLS works but never exercising `forTenant()`, which is where the actual risk lives (service role bypasses RLS).
**Why it happens:** RLS tests are the pattern most tutorials show; the service-role side has no DB backstop to test against.
**How to avoid:** The leak test must have **both** halves: (a) RLS half — per-tenant authenticated clients see only their rows, anon sees nothing; (b) repository half — `forTenant(A)` can produce zero rows referencing tenant B even when tenant B data exists, verified across every exported accessor.
**Warning signs:** leak test imports `@supabase/supabase-js` but not the repository module.

### Pitfall 3: Migrations applied through the transaction pooler
**What goes wrong:** `drizzle-kit migrate` fails or partially applies DDL through the 6543 transaction pooler (prepared statements/advisory locks unsupported in transaction mode).
**How to avoid:** Separate `MIGRATE_DATABASE_URL` (direct/session, 5432) from runtime `DATABASE_URL` (6543); document both in `.env.example`. [ASSUMED — standard Supabase guidance; verify port/hostnames in the created project's connect panel]
**Warning signs:** intermittent `prepared statement does not exist` errors during migrate.

### Pitfall 4: Local dev blocked by missing Docker
**What goes wrong:** `supabase start` fails on the dev machine — Docker is not installed (verified this session).
**How to avoid:** Plan an explicit environment task: install a Docker runtime (Docker Desktop or OrbStack on macOS) before the leak-test task. Interim fallbacks: run Vitest leak tests against local Homebrew Postgres 17 (present) with Supabase-shim roles created by a setup script, or against a second (free-tier) hosted Supabase project. CI is unaffected (GitHub runners ship Docker).
**Warning signs:** `Cannot connect to the Docker daemon` in local test runs.

### Pitfall 5: Tenant creation writes through the service-role client
**What goes wrong:** The ONB-01 form's server action uses the service-role client "because it's easier," so the operator console never exercises RLS — policies rot unverified until a v2 client portal makes them load-bearing.
**How to avoid:** Console reads/writes use the **authenticated** server client (anon key + operator JWT); policies for the operator role are therefore exercised on every console interaction. Service-role stays reserved for `src/core` workers.
**Warning signs:** `SUPABASE_SERVICE_ROLE_KEY` imported anywhere under `src/app/(console)`.

### Pitfall 6: External clocks started "later"
**What goes wrong:** ServiceM8 partner registration or the number order slips to Phase 2/4, then the unverified lead time lands on the critical path exactly when the 2-week walking-skeleton deadline bites (STATE.md lists both as Phase-1 blockers).
**How to avoid:** Make both registrations Wave-0-eligible human tasks in the plan with explicit "submitted on <date>" evidence, independent of all code tasks.

## Code Examples

Patterns below are assembled from official docs fetched this session; discrete values (table/column names) follow the ARCHITECTURE.md data-model sketch [VERIFIED: .planning/research/ARCHITECTURE.md:186-194], quoted here verbatim:

> ```
> tenants        (id, name, timezone /* 'Australia/Perth' */, sm8_account_id,
>                 sm8_oauth_tokens /* encrypted */, review_mode, sample_rate,
>                 contact_hours_start, contact_hours_end, contact_days,
>                 escalation_phone, sender_id_config, status, created_at)
> tenant_members (tenant_id, user_id, role)          -- operator now, employees later
> ```

Phase 1 implements `tenants` + `tenant_members` (plus the ONB-01 field `trade_type`, which is part of the requirement's "business profile, trade type" and absent from the sketch — planner should add it deliberately). API shapes below are illustrative patterns, not verified compilable code — treat exact drizzle `pgPolicy` argument syntax as to-be-confirmed against drizzle 0.45 docs at execution time [CITED: orm.drizzle.team/docs/rls].

### Tenant schema with RLS policy (drizzle)

```typescript
// src/db/schema/tenants.ts
// Pattern per orm.drizzle.team/docs/rls — adding pgPolicy auto-enables RLS
import { pgTable, uuid, text, time, smallint, timestamp, pgPolicy } from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';
import { sql } from 'drizzle-orm';

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  tradeType: text('trade_type').notNull(),            // ONB-01 "trade type"
  timezone: text('timezone').notNull().default('Australia/Perth'), // IANA string
  contactHoursStart: time('contact_hours_start').notNull(),
  contactHoursEnd: time('contact_hours_end').notNull(),
  contactDays: smallint('contact_days').array().notNull(), // e.g. [1..6] ISO weekday
  escalationPhone: text('escalation_phone'),
  status: text('status').notNull().default('onboarding'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, () => [
  pgPolicy('tenants_member_access', {
    as: 'permissive',
    to: authenticatedRole,
    for: 'all',
    using: sql`has_tenant_access(id)`,          // SECURITY DEFINER membership lookup
    withCheck: sql`has_tenant_access(id)`,
  }),
]);
```

The `has_tenant_access` function and the `tenant_members` table's own policy ship as a custom SQL migration (`drizzle-kit generate --custom`), alongside `CREATE EXTENSION IF NOT EXISTS pg_cron; ... pg_net; ... pgmq;`.

### forTenant repository (service-role guard)

```typescript
// src/db/repository/client.ts — MODULE-PRIVATE; ESLint bans importing this elsewhere
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL!, { prepare: false }); // 6543 pooler
export const db = drizzle(sql);

// src/db/repository/for-tenant.ts — the ONLY exported tenant-data surface
import { db } from './client';
import { tenants } from '../schema';
import { eq } from 'drizzle-orm';

export function forTenant(tenantId: string) {
  return {
    tenant: {
      get: () => db.select().from(tenants).where(eq(tenants.id, tenantId)),
      update: (patch: Partial<typeof tenants.$inferInsert>) =>
        db.update(tenants).set(patch).where(eq(tenants.id, tenantId)).returning(),
    },
  };
}
```

### Next 16 proxy with @supabase/ssr

```typescript
// proxy.ts (Next 16 rename of middleware.ts; Node runtime)
// Pattern per supabase.com/docs/guides/auth/server-side/nextjs
import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

export async function proxy(request: NextRequest) {
  // updateSession: createServerClient with getAll/setAll cookie adapters,
  // calls supabase.auth.getClaims() to refresh + verify,
  // redirects to /login when no valid claims,
  // and mirrors refreshed cookies onto request AND response
  return await updateSession(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|login).*)'],
};
```

### Two-tenant leak test (Vitest, CI-blocking)

```typescript
// tests/leak.test.ts — runs against `supabase start` (local) or CI service stack
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { forTenant } from '../src/db/repository/for-tenant';

// beforeAll: service-role seed — tenant A ("Acme Plumbing"), tenant B ("Bravo Sparks"),
// one operator auth user, membership rows for A only (simulating scoped access)

describe('tenant isolation (ONB-05)', () => {
  it('RLS: authenticated member of A sees zero tenant-B rows', async () => {
    const asOperatorA = createClient(URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwtA}` } } });
    const { data } = await asOperatorA.from('tenants').select('*');
    expect(data!.every(t => t.id === TENANT_A)).toBe(true);
  });

  it('RLS: anon sees nothing', async () => {
    const anon = createClient(URL, ANON_KEY);
    const { data } = await anon.from('tenants').select('*');
    expect(data).toEqual([]);
  });

  it('repository: forTenant(A) can never emit tenant-B data', async () => {
    const rows = await forTenant(TENANT_A).tenant.get();
    expect(JSON.stringify(rows)).not.toContain(TENANT_B);
    expect(JSON.stringify(rows)).not.toContain('Bravo Sparks');
  });
});
```

### RLS-everywhere assertion

```typescript
// tests/rls-coverage.test.ts — fails CI if ANY public table lacks RLS
it('every public table has RLS enabled', async () => {
  const missing = await adminSql/* service-role or direct psql */`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND rowsecurity = false`;
  expect(missing).toEqual([]);
});
```

### GitHub Actions CI skeleton

```yaml
# .github/workflows/ci.yml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest   # Docker available on hosted runners
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npx tsc --noEmit
      - uses: supabase/setup-cli@v1
        with: { version: latest }
      - run: supabase start          # local stack in CI
      - run: npx drizzle-kit migrate # drizzle is the authority
        env: { MIGRATE_DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres }
      - run: npx vitest run          # unit + leak + rls-coverage
```

(Local-stack ports/credentials above are the Supabase CLI defaults [ASSUMED — confirm from `supabase start` output at execution].)

## Runtime State Inventory

Not applicable — greenfield phase, no rename/refactor/migration of existing state. (Repo contains only `.planning/`, `.claude/`, `.git`; verified by directory listing this session.)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Next.js 15, `middleware.ts` | Next.js 16, `proxy.ts` (Node runtime), Turbopack default, async-only request APIs | Next 16 GA (docs current at 16.3.2, 2026-08) | All auth-gating code targets the proxy convention; no `next lint` |
| `@supabase/auth-helpers-*` | `@supabase/ssr` with `getAll`/`setAll` cookie adapters | 2024, now sole documented path | Only pattern the docs support |
| `getUser()` for route protection | `getClaims()` (local JWT verification vs project public keys) | Current Supabase docs | Faster per-request check in proxy; `getUser()` reserved for freshness-critical reads |
| RLS as raw SQL alongside ORM schema | drizzle `pgPolicy` in table definitions + `drizzle-orm/supabase` role helpers | drizzle-orm ~0.36+, mature by 0.45 | Policies live with schema, migrate via drizzle-kit — kills the two-authority problem |
| TypeScript 5.x as `latest` | npm `latest` is TS 7.0.2 (native compiler); 5.9.3 is last 5.x | 2026 | Pin `~5.9.3` deliberately; don't blind-install `typescript@latest` |
| Alphanumeric SMS sender IDs | Dedicated AU virtual numbers (ACMA Sender ID Register live since 1 Jul 2026) | 2026-07-01 | Already locked in STACK.md; Phase 1 just orders the number |

**Deprecated/outdated:**
- `middleware.ts` naming + `skipMiddlewareUrlNormalize` config: renamed (`proxy.ts`, `skipProxyUrlNormalize`) [CITED: nextjs.org/docs/app/guides/upgrading/version-16]
- `next lint`: removed in Next 16; use ESLint CLI (flat config)
- `supabase db push` as schema authority *for this repo*: superseded by drizzle-kit decision (Pattern 1)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | ServiceM8 App ID/Secret issued immediately on add-on save; OAuth usable via Private Add-on Install URL without store approval | Pattern 5 | Phase 2 OAuth path delayed — mitigated by the private-API-key fallback already planned |
| A2 | ClickSend AU dedicated number ~AUD $20.71/mo, provisioning within days after IPND-address verification | Pattern 5 | Cost slightly off (budget headroom exists); provisioning slow → trigger Twilio fallback |
| A3 | Twilio AU regulatory bundle review ≈ up to 3 business days | Pattern 5 | Fallback slower than expected — start it in parallel if ClickSend stalls past week 1 |
| A4 | Migrations must use direct/session connection (5432), runtime uses transaction pooler (6543), with CLI-default local ports 54322 | Pitfall 3, CI example | Migration failures at setup — confirm from the created project's connect panel; 15-minute fix |
| A5 | pg_cron/pg_net/pgmq enable cleanly via `CREATE EXTENSION` in a migration on Supabase hosted + local CLI stack | Pattern 1, diagram | May need dashboard-side enablement first; verify during migration 001 authoring |
| A6 | drizzle `pgPolicy` exact argument syntax as sketched compiles on drizzle-orm 0.45.2 | Code Examples | Minor syntax fixes at execution; concept verified against official docs |
| A7 | Supabase Auth "disable signups" setting sufficient for operator-only access (no allowlist code needed) | Pattern 2 | Add one-row allowlist check in proxy — small task |
| A8 | GitHub Actions `supabase/setup-cli@v1` + `supabase start` works on ubuntu-latest runners | CI example | Swap to a Postgres service container + shim roles; leak test design unchanged |
| A9 | pg_cron/pgmq available on all Supabase plans incl. free (Pro needed only for no-pause reliability) | Environment/Stack | Moot for production (Pro already budgeted); affects only a free test project |
| A10 | ClickSend requires the *service operator's* AU business details (not each client's) for number registration | Pattern 5 | If per-end-client detail is required later, affects Phase 4 per-client numbering, not Phase 1 |

## Open Questions (RESOLVED)

1. **TypeScript 7 vs 5.9 for a greenfield repo** *(RESOLVED — pinned `~5.9.3` in Plan 01-02)*
   - What we know: npm `latest` is 7.0.2 (native compiler); Next 16 requires ≥5.1; drizzle-kit/vitest compat with TS7 unverified this session
   - What's unclear: whether the toolchain (drizzle-kit's internal tsc use, vitest transforms, Next typegen) is TS7-clean
   - Recommendation: pin `~5.9.3` now; revisit as a zero-risk upgrade later — do not spend phase time on it
2. **ServiceM8 partner-approval lead time (the actual clock)** *(RESOLVED — day-1 registration + private-API-key fallback in Plan 01-01)*
   - What we know: registration + App ID/Secret appear self-serve; *store* approval is the reviewed step and isn't needed for private installs
   - What's unclear: whether OAuth on arbitrary customer accounts via private install URL has any hidden review gate; no published SLA anywhere
   - Recommendation: register day 1, create the Public Application immediately, and test OAuth against the founder's own trial account in Phase 2 week 1; keep private-API-key bridge as the committed fallback
3. **ClickSend number provisioning SLA** *(RESOLVED — day-1 order + calendared +5-business-day Twilio fallback in Plan 01-01)*
   - What we know: purchase is dashboard self-serve; ACMA/IPND verification applies; no published timing
   - What's unclear: instant vs days
   - Recommendation: order at signup (day 1); calendar a +5-business-day check; if unprovisioned, submit the Twilio regulatory bundle in parallel
4. **Local dev database story on this machine (no Docker)** *(RESOLVED — hosted-project dev interim; CI is the leak-test enforcement point in Plan 01-04)*
   - What we know: Docker missing; Homebrew Postgres 17 present; Supabase CLI needs Docker for `supabase start`
   - Recommendation: add an environment task to install Docker Desktop/OrbStack; treat hosted-project development as the interim, CI as the enforcement point for the leak test

## Environment Availability

Probed on the dev machine this session (2026-08-25):

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js ≥20.9 | Next 16 | ✓ | v22.20.0 | — |
| npm | installs | ✓ | 10.9.3 | — |
| git | repo (already initialized) | ✓ | 2.50.1 | — |
| gh CLI | CI setup, PRs | ✓ | 2.97.0 | — |
| **Docker** | `supabase start` local stack | **✗** | — | Install Docker Desktop/OrbStack (task); interim: hosted Supabase project or local Postgres 17 |
| Supabase CLI | local stack, config | ✗ (installable) | — | `npm i -D supabase` (2.115.0 verified on registry) |
| Vercel CLI | deploys | ✗ (installable) | — | `npm i -g vercel`; or deploy via Vercel Git integration (no CLI needed) |
| psql / Postgres 17 | direct DB access, fallback test DB | ✓ | 17.10 (Homebrew) | — |
| Supabase account + Sydney project | everything | unknown (browser-side) | — | Human task: create project in `ap-southeast-2`, Pro plan per STACK.md |
| Vercel account | hosting | unknown (browser-side) | — | Human task |

**Missing dependencies with no fallback:** none — everything blocked locally has a CI or hosted fallback.
**Missing dependencies with fallback:** Docker (install task; CI unaffected), Supabase CLI + Vercel CLI (npm installs), cloud accounts (human tasks, day 1).

## Validation Architecture

(`workflow.nyquist_validation` is `true` in `.planning/config.json`.)

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.11 (pinned) |
| Config file | none yet — Wave 0 creates `vitest.config.ts` |
| Quick run command | `npx vitest run tests/<file>.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ONB-01 | Tenant created with profile, trade type, timezone, contact-hours; persisted and readable | integration (server action → DB) | `npx vitest run tests/tenant-create.test.ts` | ❌ Wave 0 |
| ONB-01 | Invalid contact-hours / timezone rejected by zod | unit | `npx vitest run tests/tenant-validation.test.ts` | ❌ Wave 0 |
| ONB-05 | Two-tenant leak test: RLS half + repository half both zero-leak | integration (local Supabase) | `npx vitest run tests/leak.test.ts` | ❌ Wave 0 |
| ONB-05 | Every public table has RLS enabled | integration (SQL assertion) | `npx vitest run tests/rls-coverage.test.ts` | ❌ Wave 0 |
| ONB-05 | Raw db client not importable outside repository | static (lint) | `npx eslint .` (no-restricted-imports rule) | ❌ Wave 0 |
| ONB-01 (login) | Unauthenticated request to console redirects to /login | integration or manual-first | `npx vitest run tests/auth-gate.test.ts` (or manual check pre-CI) | ❌ Wave 0 |
| — (external) | Registrations submitted with evidence | manual-only — human actions with screenshots/IDs recorded | n/a | n/a |

### Sampling Rate
- **Per task commit:** `npx vitest run <touched test file>` + `npx tsc --noEmit`
- **Per wave merge:** `npx vitest run` (full, incl. leak test against local/CI Supabase)
- **Phase gate:** full suite green in GitHub Actions before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `vitest.config.ts` — framework config (node environment, test globs)
- [ ] `tests/helpers/seed.ts` — two-tenant seed/teardown fixtures (service-role)
- [ ] `tests/leak.test.ts` — ONB-05 leak test (RLS + repository halves)
- [ ] `tests/rls-coverage.test.ts` — RLS-everywhere assertion
- [ ] `tests/tenant-create.test.ts`, `tests/tenant-validation.test.ts` — ONB-01
- [ ] `.github/workflows/ci.yml` — typecheck + tests + supabase local stack
- [ ] ESLint flat config with the repository import ban
- [ ] Framework install: `npm i -D vitest` (with pinned version)

## Security Domain

(`security_enforcement: true`, ASVS level 1, block on high.)

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase Auth, email+password, **signups disabled** (single operator); TOTP MFA optional later |
| V3 Session Management | yes | `@supabase/ssr` cookie sessions; `getClaims()` verification in proxy; cache-control headers on setAll (per official pattern) |
| V4 Access Control | yes | RLS on every table (membership-lookup policies) + `forTenant()` for service-role paths + CI leak test |
| V5 Input Validation | yes | zod v4 at every boundary (tenant form, env vars); server-side validation in server actions |
| V6 Cryptography | yes | Supabase-managed (auth hashing, TLS); no custom crypto. Future SM8 token encryption (Phase 2) — note now that a pgsodium/app-layer encryption decision arrives then |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant read via exposed PostgREST API with RLS off | Information Disclosure | RLS on all tables from migration 001 + `rls-coverage` CI test (the dominant real-world Supabase breach class per PITFALLS.md) |
| Service-role key in client bundle | Information Disclosure / Elevation | Server-only env var; grep/secret-scan in CI for `SERVICE_ROLE` under `src/app`; never `NEXT_PUBLIC_*` |
| Forgotten tenant predicate in worker query | Information Disclosure | `forTenant()` closure + ESLint import ban + leak test repository-half |
| Trusting `getSession()` / user metadata server-side | Spoofing | `getClaims()` only in server code; policies use membership lookup, never `raw_user_meta_data` |
| Signup abuse on an "operator-only" app | Elevation of Privilege | Disable signups in Supabase Auth settings; assert in a smoke test that signup returns an error |
| SQL injection | Tampering | drizzle parameterized queries only; no string-built SQL (`sql` template literal is parameterized) |

## Sources

### Primary (registry/tool-verified this session)
- npm registry via `npm view` — exact versions for all 13 packages; `typescript` dist-tags (`latest: 7.0.2`); publish dates and download counts via `gsd-tools query package-legitimacy check`
- Local environment probes — Node/npm/git/gh/psql present; Docker/supabase CLI/vercel CLI absent
- `.planning/research/ARCHITECTURE.md` (read in full) — data model sketch (lines 186–194), multi-tenancy rules (lines 327–332), build order
- `.planning/research/STACK.md`, `.planning/research/PITFALLS.md` (read in full) — locked stack, Pitfall 11 tenancy guidance

### Secondary (official docs, fetched this session)
- https://nextjs.org/docs/app/guides/upgrading/version-16 — proxy rename, async APIs, Turbopack default, Node/TS minimums, `next lint` removal (doc version 16.3.2, lastUpdated 2026-08-18)
- https://supabase.com/docs/guides/auth/server-side/nextjs — @supabase/ssr client factories, proxy session refresh, `getClaims()` guidance
- https://orm.drizzle.team/docs/rls — `pgPolicy`, `drizzle-orm/supabase` roles/helpers, `entities.roles` config
- https://supabase.com/docs/guides/cron — pg_cron engine, `cron.job_run_details`, ≤8 concurrent jobs / ≤10 min guidance
- https://help.clicksend.com/en/articles/43652-australia-61 — AU dedicated-number requirements (IPND address, no PO boxes, ACMA verification)
- https://www.servicem8.com/developer-registration, https://developer.servicem8.com/docs/servicem8-add-on-store — registration form + Developer Agreement; 6-step store review

### Tertiary (web search, LOW confidence — validate at execution)
- Supabase free-tier pausing / extension availability (supabase.com docs + GitHub discussions via search)
- ClickSend AU dedicated number ~AUD $20.71/mo (ClickSend developer API docs via search)
- Twilio AU regulatory bundle ~3-business-day review (Twilio docs/support via search)
- pgTAP / basejump `supabase_test_helpers` / rlsautotest for RLS testing (Supabase docs + community via search)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every version registry-verified; framework facts from official docs fetched this session
- Architecture (tenancy/RLS/forTenant): MEDIUM-HIGH — patterns from official docs + project ARCHITECTURE.md; exact drizzle policy syntax to confirm at execution (A6)
- Migration workflow decision: MEDIUM — drizzle RLS support verified; pooler-port discipline assumed (A4)
- External registrations: LOW — self-serve mechanics corroborated across official pages, but lead times are unpublished by both vendors; handled as day-1 clock-starts with committed fallbacks
- Pitfalls: HIGH — grounded in project PITFALLS.md plus session-verified version drift (Next 16, TS 7)

**Research date:** 2026-08-25
**Valid until:** ~2026-09-25 for stack/patterns (stable); re-verify npm versions and provider pricing at execution; external-registration facts should be replaced by actual observed dates as soon as the registrations are submitted
