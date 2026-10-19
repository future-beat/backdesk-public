# Phase 1 — API Coverage Declaration

**Generated:** 2026-08-25 (planner, API Coverage Decision Checkpoint)

No external API integration: Phase 1 SUBMITS two external registrations (ServiceM8 Development Partner form, ClickSend dedicated AU virtual number order) as human-action lead-time clocks, but integrates neither API — ServiceM8 sync integration lands in Phase 2 (ONB-02, SYNC-01..04) and ClickSend/SMS integration lands in Phase 4 (MSG-01..04), each of which will carry its own full INTEGRATE-by-default coverage matrix.

**Supabase note:** `@supabase/supabase-js` / `@supabase/ssr` are used in this phase as the platform substrate (managed Postgres, Auth session handling, RLS-enforced PostgREST reads) per the locked stack decision, not as a third-party API surface being integrated feature-by-feature. Usage is scoped by 01-RESEARCH.md Patterns 1–4 (drizzle-kit migration authority, operator-only auth via `getClaims()`, `forTenant()` repository, membership-lookup RLS policies); there is no endpoint matrix to opt in/out of.

| External service | This phase | API integration phase |
|------------------|-----------|----------------------|
| ServiceM8 | Partner registration submitted (human action, no code) | Phase 2 — coverage matrix required |
| ClickSend | AU number order submitted (human action, no code) | Phase 4 — coverage matrix required |
| Supabase | Platform substrate (DB/Auth/RLS), not an integration surface | n/a |
