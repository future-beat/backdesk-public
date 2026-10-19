---
phase: 1
slug: foundation-tenancy
status: secured
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-08-26
---

# Phase 1 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Audit run 2026-08-26 by gsd-security-auditor (register authored at plan time; verified against post-review-fix code).

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Browser ↔ Next.js server | Unauthenticated internet to operator console | Credentials, tenant form input, error params |
| Next.js ↔ Supabase (PostgREST/Auth) | App server to hosted Sydney project | Auth tokens, tenant rows, service-role key (server-only) |
| Anon/authenticated roles ↔ Postgres | API-exposed DB roles vs data | RLS-gated tenant data; grants (post-0005: least-privilege) |
| Repo/CI ↔ secrets | Git history and GitHub Actions vs credentials | .env values (never tracked), CI throwaway stack only |
| Operator ↔ external vendors | ServiceM8 / ClickSend portals | App ID (public), App Secret + API keys (secret store only) |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-01-01 | Info Disclosure | External-registrations doc | high | mitigate | Secrets-discipline clause; only non-secret IDs committed; adversarial grep clean (`docs/external-registrations.md:10-13`) | closed |
| T-01-02 | Spoofing | Vendor registration forms | low | accept | Vendor-side ACMA/IPND controls; nothing to build — see AR-01 | closed (accepted) |
| T-01-03 | Repudiation | External clock evidence | low | mitigate | Committed dated log with Submitted/Status/Next check/Fallback lines | closed |
| T-02-01 | Info Disclosure | tenants/tenant_members via PostgREST | critical | mitigate | RLS on both tables from migration 0001; SECURITY DEFINER `has_tenant_access` with pinned search_path; anon-zero asserted non-vacuously (`tests/auth-security.test.ts:49-78`) | closed |
| T-02-02 | Info Disclosure | Service-role key | high | mitigate | `getServerEnv()` throws in browser (`src/core/shared/env.ts:45-50`); zero refs under `src/app`; `.env*` ignored; key absent from build output | closed |
| T-02-03 | Spoofing | Server-side auth checks | medium | mitigate | `getClaims()` at proxy, console layout, and server action (3 layers; WR-01) | closed |
| T-02-04 | Elevation of Privilege | Supabase Auth signups | high | mitigate | Signups disabled (dashboard + `supabase/config.toml:182`), asserted by test on every run; RPC revoked from public/anon | closed |
| T-02-05 | Tampering | SQL surface | medium | mitigate | No unsafe/raw SQL anywhere; static `sql``` literals + typed RPC params only | closed |
| T-02-SC | Tampering | npm supply chain | high | mitigate | Blocking human gate pre-install; flagged set exact-pinned; zero lifecycle scripts in checked deps; `npm ci` + lockfile in CI | closed |
| T-03-01 | Tampering | createTenant server action | medium | mitigate | zod authority at trust boundary + DB floor: 6 CHECK constraints + timezone trigger (migration 0004) | closed |
| T-03-02 | Info Disclosure | /clients/[id] foreign uuid | medium | mitigate | RLS-scoped authenticated read, uuid-shape guard, `notFound()`; denial and absence indistinguishable | closed |
| T-03-03 | Tampering | Stored XSS in tenant fields | low | accept | No `dangerouslySetInnerHTML`; React auto-escaping; length bounds in schema + DB CHECKs — see AR-02 | closed (accepted) |
| T-04-01 | Info Disclosure | Forgotten tenant predicate | high | mitigate | `forTenant()` closure (no method takes tenantId), ESLint import ban (firing-proven), mutation-checked leak test | closed |
| T-04-02 | Info Disclosure | Future table without RLS | high | mitigate | RLS-everywhere + policy-existence + USING(true) + privilege-matrix assertions (all proven to fire); CI-blocking | closed |
| T-04-03 | Info Disclosure | Client-reachable key leak | high | mitigate | CI secret scans over `src/app` + tracked-`.env*` check (scope caveat tracked as IN-09) | closed |
| T-04-04 | Info Disclosure | CI logs/env leaking credentials | low | accept | No `secrets.*` in ci.yml; names-only echoes — see AR-03 | closed (accepted) |
| T-04-05 | Tampering | CI pipeline actions | medium | mitigate | Official-org actions pinned (checkout@v7, setup-node@v7, setup-cli@v3); CLI pinned 2.115.0 | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*

### Unregistered surface found during audit (now mapped)

| Flag | Surface | Severity | Resolution |
|------|---------|----------|------------|
| UF-1 | `pg_net` SSRF primitive (platform grant, un-revocable as `postgres`) | medium | Contained by PostgREST exposed-schema boundary, asserted by test (PGRST202); residual documented with Phase-3 trigger — see AR-04 |
| UF-2 | Inherited default privileges (incl. RLS-bypassing TRUNCATE) on live project | was high | Fixed by migration 0005; drift now fails the privilege-matrix test |
| UF-3 | Server Action global-ID invocation + unanchored login matcher | was high | Fixed: auth check inside action + anchored matcher |
| UF-4 | `/login?error=` prototype-chain lookup 500ing auth entry | was medium | Fixed via Map lookup (`src/core/shared/auth-messages.ts`) |
| UF-5 | Operational DB scripts outside plan file lists | low | Hygiene verified (credentials never printed); noted for future plan file-list discipline |

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01 | T-01-02 | Vendor-portal spoofing is controlled by vendor-side ACMA/IPND verification; no in-repo control exists to build | Operator (via secure-phase run) | 2026-08-26 |
| AR-02 | T-03-03 | Stored XSS: React auto-escaping + no raw HTML rendering + schema/DB length bounds; re-evaluate if rich text is ever rendered | Operator (via secure-phase run) | 2026-08-26 |
| AR-03 | T-04-04 | CI secret leakage: workflow uses no repository secrets; throwaway local stack only; echoes are names-only | Operator (via secure-phase run) | 2026-08-26 |
| AR-04 | UF-1 | `pg_net` grants are platform-owned and un-revocable from migrations; contained by PostgREST schema exposure (asserted in tests). **Trigger: re-assess at Phase 3 before pg_net is used for the cron tick** (`src/db/migrations/README.md:37-70`) | Operator (via secure-phase run) | 2026-08-26 |

*Accepted risks do not resurface in future audit runs.*

---

## Open Findings (informational, non-blocking)

- **IN-09** — T-04-03 scan scope: covers `src/app` and literal string only; `src/lib`/`src/core` are equally client-reachable and computed access evades a literal grep. Candidate hardening in a later phase.
- **WR-11** — Global `tenants_name_lower_key` is a cross-tenant existence oracle; harmless at one operator, becomes real on the second. Documented trigger at `src/db/migrations/README.md:72-93`.
- **Caret ranges** on `eslint`/`@types/react*` (the `[ASSUMED]` set) — constrained in practice by `package-lock.json` + `npm ci`.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-08-26 | 17 (+5 unregistered flags mapped) | 17 | 0 | gsd-security-auditor (opus), verdict OPEN_THREATS→resolved by accepted-risks log |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
