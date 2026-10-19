# Walking Skeleton — Quote Recovery MVP

**Phase:** 1
**Generated:** 2026-08-25

## Capability Proven End-to-End

The operator (founder) signs in on a phone or desktop browser and creates an isolated client tenant — business profile, trade type, timezone, contact-hours window — which is written to RLS-protected Sydney Postgres through an authenticated (non-service-role) path and appears in the client list.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Framework | Next.js 16.3.2 (App Router, `proxy.ts` convention, Turbopack default, TS ~5.9.3 pinned) | Locked stack (Next on Vercel); 16 is current stable — `middleware.ts` is deprecated, request APIs are async-only (01-RESEARCH.md Pitfall 1) |
| Data layer | Supabase hosted Postgres (`ap-southeast-2`, Sydney) + drizzle-orm 0.45.2 with **drizzle-kit as the single migration authority** — RLS policies defined as `pgPolicy` in schema | AU data residency is a selling point; policy-in-schema kills the two-migration-authority drift trap (Pattern 1); Supabase CLI is local-stack-only, never `supabase db push` |
| Multi-tenancy | Shared tables, `tenant_id` on every row; RLS on every table from migration 001; policies via `tenant_members` membership lookup through `SECURITY DEFINER has_tenant_access(tid)` — never JWT metadata | Retrofitting RLS is the classic Supabase incident class; membership lookup survives adding employees later as an INSERT (Pattern 4) |
| Tenant creation path | `SECURITY DEFINER create_tenant(...)` RPC inserting tenant + operator membership in one transaction, called via the **authenticated** client | Solves the RLS chicken-and-egg (no membership row exists before the tenant does) and keeps the console exercising RLS on every interaction (Pitfall 5) |
| Service-role guard | `forTenant(tenantId)` repository — the only exported tenant-data surface; raw drizzle client module-private + ESLint import ban + CI leak test | Service role bypasses RLS by design; app-layer scoping is load-bearing for ONB-05 (Pattern 3) |
| Auth | Supabase Auth, single operator user, public signups disabled; `@supabase/ssr` cookie sessions; `proxy.ts` refreshes and gates via `getClaims()` (never `getSession()` trust) | Console must open fast on a phone; email+password, MFA-ready later (Pattern 2) |
| Test enforcement | Vitest 4.1.11; two-tenant leak test (RLS half + repository half) + RLS-everywhere assertion, enforced in GitHub Actions against `supabase start` | Dev machine has no Docker — CI is the enforcement point; local runs target the hosted Sydney project (Pitfall 4) |
| Deployment target | Documented local full-stack run (`npm run build && npm run start` against the hosted Sydney Supabase project) + CI on GitHub Actions | Exercises the real stack end-to-end; Vercel deploy is deferred until a stable public URL is needed (Phase 2 webhooks / Phase 4 callbacks) — Vercel Git integration picks up the repo created in Plan 01-04 |
| Directory layout | `src/app` (console routes) / `src/core` (domain, no Next imports) / `src/db` (schema, repository, migrations) / `src/lib/supabase` (client factories) / `tests/` | Per project ARCHITECTURE.md; keeps the future cadence engine framework-free |

## Stack Touched in Phase 1

- [x] Project scaffold (Next 16, TypeScript, ESLint, Vitest test runner)
- [x] Routing — `/login`, `(console)/` client list, `(console)/clients/new`, `(console)/clients/[id]`
- [x] Database — real write (create tenant via RPC) AND real read (client list, detail) through RLS
- [x] UI — tenant-creation form wired to a server action, list + detail rendering live rows
- [x] Deployment — documented local full-stack run command + CI pipeline proving the stack on every push

## Out of Scope (Deferred to Later Slices)

- ServiceM8 sync, OAuth connect, sync health (Phase 2) — Phase 1 only submits the partner registration
- Quote Leakage Audit (Phase 2)
- Cadence engine, pg_cron schedules, pgmq consumers (Phase 3) — extensions are enabled in migration 001, schedules are not
- SMS/email sending, STOP handling (Phase 4) — Phase 1 only orders the AU number
- AI drafting/classification, voice profiles, template approval (Phase 5)
- Approval queue, pipeline view, escalation (Phase 6); attribution/reports (Phase 7)
- Vercel deployment, client logins, employee accounts, sampled review (v2 / later phases)

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering its architectural decisions:

- Phase 2: connect a client's ServiceM8 account → open quotes mirror into tenant-scoped tables → Quote Leakage Audit
- Phase 3: synced quote → materialized cadence schedule → send ledger (tick uses the pg_cron/pgmq extensions enabled here)
- Phase 4: due touch → real SMS/email through the compliance gate → inbound threading
- Phase 5: touch → Claude draft in client voice → reply classification
- Phase 6: pending draft → mobile approval queue → hot-lead escalation
- Phase 7: won job → evidence-chained attribution → monthly report
