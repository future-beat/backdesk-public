---
phase: 1
slug: foundation-tenancy
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-25
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.11 (pinned; registry-verified in 01-RESEARCH.md) |
| **Config file** | `vitest.config.ts` — created by Plan 01-02 Task 3 |
| **Quick run command** | `npx vitest run --reporter=dot` |
| **Full suite command** | `npx vitest run && npx tsc --noEmit` |
| **Estimated runtime** | ~60 seconds (integration tests hit the hosted Sydney Supabase project locally; CI uses `supabase start`) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=dot`
- **After every plan wave:** Run `npx vitest run && npx tsc --noEmit`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-T1 | 01-01 | 1 | ONB-02 (clock) | T-01-01 | App Secret never committed | manual-only (vendor form) | n/a — evidence grep in 01-01-T3 | n/a | ⬜ pending |
| 01-01-T2 | 01-01 | 1 | MSG-01 (clock) | T-01-01 | API key never committed | manual-only (vendor dashboard) | n/a — evidence grep in 01-01-T3 | n/a | ⬜ pending |
| 01-01-T3 | 01-01 | 1 | ONB-02, MSG-01 | T-01-01 | non-secret identifiers only in doc | static (existence + grep) | `test -f docs/external-registrations.md && [ "$(grep -c 'Submitted:' docs/external-registrations.md)" -ge 2 ]` | ❌ created by task | ⬜ pending |
| 01-02-T1 | 01-02 | 1 | — (supply chain) | T-02-SC | canonical packages pinned before install | blocking-human checkpoint | n/a (never auto-approved) | n/a | ⬜ pending |
| 01-02-T2 | 01-02 | 1 | ONB-01, ONB-05 | T-02-01..05 | RLS from migration set 001; getClaims gate; anon sees zero rows | integration (e2e script) | `npx tsc --noEmit && npm run build && node scripts/verify-tracer.mjs` + 3xx-redirect curl check | ❌ created by task | ⬜ pending |
| 01-02-T3 | 01-02 | 1 | ONB-01 | T-02-01, T-02-04 | signups disabled; anon RPC rejected | integration (vitest) | `npx vitest run tests/tenant-create.test.ts tests/auth-security.test.ts --reporter=dot` | ❌ created by task | ⬜ pending |
| 01-03-T1 | 01-03 | 2 | ONB-01 | T-03-01 | server-side zod on the form boundary; no 24/7 default hours | unit (vitest, tdd) | `npx vitest run tests/tenant-validation.test.ts --reporter=dot && npx tsc --noEmit` | ❌ created by task | ⬜ pending |
| 01-03-T2 | 01-03 | 2 | ONB-01 | T-03-02 | RLS-scoped detail query; foreign id 404s | build + full suite + end-of-phase human check | `npm run build && npx vitest run --reporter=dot` | ❌ created by task | ⬜ pending |
| 01-04-T1 | 01-04 | 2 | ONB-05 | T-04-01 | raw db client import lint-banned (firing proof) | static + unit (ESLint API) | `npx vitest run tests/lint-ban.test.ts --reporter=dot && npx eslint . --max-warnings=0` | ❌ created by task | ⬜ pending |
| 01-04-T2 | 01-04 | 2 | ONB-05 | T-04-01, T-04-02 | two-tenant zero-leak (RLS + repository halves); RLS on every public table | integration (vitest) | `npx vitest run tests/leak.test.ts tests/rls-coverage.test.ts --reporter=dot` | ❌ created by task | ⬜ pending |
| 01-04-T3 | 01-04 | 2 | ONB-05 | T-04-02..05 | CI-blocking leak test; secret scan on src/app | CI pipeline | `gh run list --limit 1 --json conclusion --jq '.[0].conclusion' \| grep -q success` | ❌ created by task | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Wave 0 gaps are fulfilled inline: each test lands in the same task as (or immediately alongside) the code it samples, so no task runs without an automated verify available at its commit point.

- [ ] `vitest.config.ts` + `package.json` test scripts + `tests/helpers/env.ts` (no-dep .env loader) — Plan 01-02 Task 3
- [ ] `scripts/verify-tracer.mjs` — runnable e2e tracer verification (pre-vitest) — Plan 01-02 Task 2
- [ ] `tests/tenant-create.test.ts` + `tests/auth-security.test.ts` — ONB-01 integration + operator-only auth posture — Plan 01-02 Task 3
- [ ] `tests/tenant-validation.test.ts` — ONB-01 validation matrix (TDD: written before the schema) — Plan 01-03 Task 1
- [ ] `tests/helpers/seed.ts` + `tests/leak.test.ts` (RLS half + repository half, supersedes the draft rls-leak/repo-scoping split) + `tests/rls-coverage.test.ts` — ONB-05 — Plan 01-04 Task 2
- [ ] `eslint.config.mjs` with the repository import ban + `tests/lint-ban.test.ts` firing proof — Plan 01-04 Task 1
- [ ] `.github/workflows/ci.yml` + `supabase/config.toml` — CI test target (`supabase start` on ubuntu-latest; local dev targets the hosted Sydney project since the dev machine lacks Docker) — Plan 01-04 Task 3

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| ServiceM8 Development Partner registration submitted | Phase SC4 | External vendor form + human account details | Complete signup at developer.servicem8.com; record App ID/Secret in secrets store; note date |
| ClickSend AU number provisioning submitted | Phase SC4 | External vendor dashboard purchase + IPND address | Purchase dedicated AU number in ClickSend dashboard; record number + date; calendar +5-business-day fallback check (Twilio regulatory bundle) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
