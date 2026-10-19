---
phase: 2
slug: servicem8-sync-quote-leakage-audit
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-26
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (established Phase 1) |
| **Config file** | vitest config in repo root |
| **Quick run command** | `npx vitest run --reporter=dot` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~60 seconds (real-DB integration tests against Sydney Postgres) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=dot`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-T1 | 02-01 | 1 | ONB-02, SYNC-01 | T-2-01, T-2-02 | Key verified live, stored enc:v1 only, last4 display | tracer script (live) | `node scripts/verify-sm8-connect.mjs` | ❌ Wave 0 (this task creates it) | ⬜ pending |
| 02-01-T2 | 02-01 | 1 | SYNC-01 | — | Spike closes A1–A4; sanitized fixtures | script + fixtures | `node scripts/sm8-spike.mjs` | ❌ Wave 0 | ⬜ pending |
| 02-01-T3 | 02-01 | 1 | SYNC-01, SYNC-03, ONB-05 | T-2-04 | Zero-date/money coercion, crypto tamper, connect idempotence, RLS on new tables | unit + integration | `ALLOW_REMOTE_TESTS=yes npx vitest run tests/sm8-schemas.test.ts tests/sm8-normalize.test.ts tests/credential-crypto.test.ts tests/connect-servicem8.test.ts tests/rls-coverage.test.ts tests/leak.test.ts` | ❌ Wave 0 | ⬜ pending |
| 02-02-T1 | 02-02 | 2 | SYNC-02, ONB-05 | T-2-04, T-2-08 | New tables RLS'd; is_operator() gates non-tenant tables | integration | `ALLOW_REMOTE_TESTS=yes npx vitest run tests/rls-coverage.test.ts` | ⚠️ extend | ⬜ pending |
| 02-02-T2 | 02-02 | 2 | SYNC-01, SYNC-02, SYNC-04 | — | Cursor overlap never skips; transitions total; D-06 policy exact | unit (table-driven) | `npx vitest run tests/sync-cursor.test.ts tests/transitions.test.ts tests/failure-policy.test.ts` | ❌ Wave 0 | ⬜ pending |
| 02-02-T3 | 02-02 | 2 | SYNC-01, SYNC-02 | T-2-02, T-2-11 | Idempotent upsert, same-tx events, no partial writes, classified error_detail | integration | `ALLOW_REMOTE_TESTS=yes npx vitest run tests/sync-upsert.test.ts tests/quote-events.test.ts` | ❌ Wave 0 | ⬜ pending |
| 02-03-T1 | 02-03 | 3 | SYNC-01 | T-2-03 | 401 without secret, never a redirect, timing-safe compare | route test | `npx vitest run tests/sync-tick-route.test.ts` | ❌ Wave 0 | ⬜ pending |
| 02-03-T2 | 02-03 | 3 | SYNC-01, SYNC-03 | T-2-05 | Idempotent cron apply, no committed secret, webhook = hint only | integration | `ALLOW_REMOTE_TESTS=yes npx vitest run tests/cron-schedules.test.ts` | ❌ Wave 0 | ⬜ pending |
| 02-04-T2 | 02-04 | 3 | SYNC-04 | T-2-10, T-2-16 | One alert per episode; pause on auth only; classified-vocab bodies | integration (spied alerts) | `ALLOW_REMOTE_TESTS=yes npx vitest run tests/sync-failure-alerts.test.ts` | ❌ Wave 0 | ⬜ pending |
| 02-04-T3 | 02-04 | 3 | ONB-02, SYNC-04 | T-2-02 | Re-key verifies before write; resume clears pause fields + syncs | integration | `ALLOW_REMOTE_TESTS=yes npx vitest run tests/rekey-resume.test.ts` | ❌ Wave 0 | ⬜ pending |
| 02-05-T1 | 02-05 | 4 | SYNC-01 | T-2-04 | RLS-scoped quote reads; filter mapping exact | typecheck + leak re-run | `npx tsc --noEmit && ALLOW_REMOTE_TESTS=yes npx vitest run tests/leak.test.ts` | ⚠️ extend | ⬜ pending |
| 02-05-T2 | 02-05 | 4 | SYNC-02 | T-2-13 | Triage exactly-once events, tenant-scoped, WR-01 order | integration (TDD) | `ALLOW_REMOTE_TESTS=yes npx vitest run tests/quote-triage.test.ts` | ❌ Wave 0 | ⬜ pending |
| 02-06-T1 | 02-06 | 4 | AUD-01, ONB-05 | T-2-07, T-2-08 | Operator-only prospect RLS; purge deletes expired, spares converted | integration | `ALLOW_REMOTE_TESTS=yes npx vitest run tests/rls-coverage.test.ts tests/prospect-purge.test.ts` | ❌ Wave 0 | ⬜ pending |
| 02-06-T2 | 02-06 | 4 | AUD-01, AUD-02 | T-2-17 | Cents-exact figures; 72h grace ±1s; day-90/91 window; null-not-zero baseline | unit (TDD) | `npx vitest run tests/audit-aggregate.test.ts tests/baseline-winrate.test.ts` | ❌ Wave 0 | ⬜ pending |
| 02-06-T3 | 02-06 | 4 | AUD-01, AUD-02 | T-2-01 | Prospect key verified-then-encrypted; purge_after on every line | integration + source assertions | `ALLOW_REMOTE_TESTS=yes npx vitest run tests/prospect-purge.test.ts` | ❌ Wave 0 | ⬜ pending |
| 02-07-T2 | 02-07 | 5 | AUD-01 | T-2-06, T-2-14 | Caps pre-parse; skipped rows counted, never silent; real-fixture mapping | unit (TDD, real fixture) | `npx vitest run tests/csv-mapping.test.ts` | ❌ Wave 0 (fixture = user_setup) | ⬜ pending |
| 02-07-T3 | 02-07 | 5 | AUD-01, AUD-02 | T-2-13, T-2-07 | Convert links tenant, clears purge, no overwrite; footnote from constant | integration | `ALLOW_REMOTE_TESTS=yes npx vitest run tests/convert-prospect.test.ts` | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] ServiceM8 trial-account spike closing research open questions A1–A3 (datetime `$filter` precision, `cursor=-1` pagination, Perth-account timestamp offset) — plan 02-01 Task 2 (`scripts/sm8-spike.mjs` → `docs/servicem8-api-notes.md`); A5 (real Job List CSV columns) is 02-07 user_setup (`tests/fixtures/sm8/job-list-export.csv`)
- [ ] Recorded-fixture set `tests/fixtures/sm8/{job,jobcontact,note,jobactivity}.json` — plan 02-01 Task 2 (sync tests never hit live ServiceM8; only the tracer script, spike, connect test, and live smokes do, guarded by `SM8_TEST_API_KEY`)
- [ ] Pure-logic test stubs created by their implementing tasks: `tests/sm8-schemas.test.ts`, `tests/sm8-normalize.test.ts`, `tests/credential-crypto.test.ts` (02-01-T3); `tests/sync-cursor.test.ts`, `tests/transitions.test.ts`, `tests/failure-policy.test.ts` (02-02-T2, TDD); `tests/audit-aggregate.test.ts`, `tests/baseline-winrate.test.ts` (02-06-T2, TDD); `tests/csv-mapping.test.ts` (02-07-T2, TDD)
- [ ] Integration stubs: `tests/connect-servicem8.test.ts`, `tests/sync-upsert.test.ts`, `tests/quote-events.test.ts`, `tests/sync-tick-route.test.ts`, `tests/cron-schedules.test.ts`, `tests/sync-failure-alerts.test.ts`, `tests/rekey-resume.test.ts`, `tests/quote-triage.test.ts`, `tests/prospect-purge.test.ts`, `tests/convert-prospect.test.ts`
- [ ] Extensions: `tests/rls-coverage.test.ts` + `tests/leak.test.ts` + `tests/helpers/seed.ts` gain the ~8 new tables across plans 02-01/02-02/02-06

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Alert email arrives on auth failure | SYNC-04 | External email delivery | Revoke trial API key, confirm email + console banner |
| Audit page prints to one A4 page | AUD-01 | Visual/print rendering | Browser print preview on generated audit |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
