---
phase: 3
slug: cadence-engine
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-27
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.11 (existing harness; no install needed) |
| **Config file** | `vitest.config.mts` (fileParallelism: false — deliberate; the CAD-04 race must be intra-file, RESEARCH Pitfall 6) |
| **Quick run command** | `npx vitest run tests/<file>.test.ts` (pure) / `ALLOW_REMOTE_TESTS=yes npx vitest run tests/<file>.test.ts` (real-DB) |
| **Full suite command** | `npm test` (pure/local) · `npm run test:remote` (hosted Sydney DB) |
| **Estimated runtime** | pure suites ~10s; remote integration suites ~60–120s (30s per-test timeout for cold Sydney connections) |

---

## Sampling Rate

- **After every task commit:** Run the task's own `<verify><automated>` command plus `npm run typecheck`
- **After every plan wave:** Run `npm test`; add `npm run test:remote` whenever DB schema or integration paths changed in the wave
- **Before `/gsd-verify-work`:** `npm run test:remote` must be fully green
- **Max feedback latency:** ~120 seconds (remote suite file)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 3-01-01 | 01 | 1 | CAD-04 | T-3-01/T-3-02/T-3-03 | RLS triple + exact grants on all six tables; suppression insert-only at grant layer | integration | `ALLOW_REMOTE_TESTS=yes npx vitest run tests/rls-coverage.test.ts tests/lint-ban.test.ts` | ✅ extend | ⬜ pending |
| 3-01-02 | 01 | 1 | CAD-01 | T-3-04 | no tenantId params; cross-tenant only via named exports | typecheck/lint | `npm run typecheck && npm run lint` | n/a | ⬜ pending |
| 3-07-01 | 07 | 1 | CAD-01, CAD-02 | T-3-27 | deterministic selection; injected RNG; [start,end) window | unit | `npx vitest run tests/cadence-window.test.ts tests/cadence-materialize.test.ts tests/cadence-primary-contact.test.ts` | ❌ W0 (this task creates) | ⬜ pending |
| 3-02-01 | 02 | 2 | CAD-01, CAD-05 | T-3-05/T-3-07/T-3-08 | cursor co-commit; JIT gates; paused-connection refusal | integration (e2e) | `ALLOW_REMOTE_TESTS=yes npx vitest run tests/cadence-tick.test.ts` | ❌ W0 (this task creates) | ⬜ pending |
| 3-02-02 | 02 | 2 | CAD-01, CAD-04, CAD-05 | T-3-06/T-3-09 | replay collision → one live cadence; suppress-at-creation; enqueue→suppress→refuse | integration | `ALLOW_REMOTE_TESTS=yes npx vitest run tests/cadence-tick.test.ts` | extends 3-02-01 | ⬜ pending |
| 3-03-01 | 03 | 3 | CAD-03 | T-3-10 | total matrix, every cell a human decision | unit (exhaustive) | `npx vitest run tests/cadence-transitions.test.ts` | ❌ W0 (this task creates) | ⬜ pending |
| 3-03-02 | 03 | 3 | CAD-01, CAD-03 | T-3-11/T-3-12 | won/lost/removed stop; reopened → needs_review; replay no-op | integration | `ALLOW_REMOTE_TESTS=yes npx vitest run tests/cadence-consume-events.test.ts tests/cadence-tick.test.ts` | ❌ W0 (this task creates) | ⬜ pending |
| 3-04-01 | 04 | 3 | CAD-02 | T-3-13 | D-09/10/11/12 policy boundaries; D-07 gap preservation | unit | `npx vitest run tests/cadence-rewindow.test.ts` | ❌ W0 (this task creates) | ⬜ pending |
| 3-04-02 | 04 | 3 | CAD-02 | T-3-16 | pause exclusion from progress/dispatch; resume hook | integration | `ALLOW_REMOTE_TESTS=yes npx vitest run tests/cadence-tick.test.ts tests/rekey-resume.test.ts` | ✅ extend | ⬜ pending |
| 3-04-03 | 04 | 3 | CAD-04, CAD-05 | T-3-14/T-3-15/T-3-17 | two-connection race → one ledger row; four JIT refusal scenarios | integration (race) | `ALLOW_REMOTE_TESTS=yes npx vitest run tests/cadence-dispatch.test.ts` | ❌ W0 (this task creates) | ⬜ pending |
| 3-05-01 | 05 | 4 | CAD-03 | T-3-20 | cross-channel terminal kill; reply-pause survives client resume | integration | `ALLOW_REMOTE_TESTS=yes npx vitest run tests/cadence-controls.test.ts` | ❌ W0 (this task creates) | ⬜ pending |
| 3-05-02 | 05 | 4 | CAD-03 | T-3-21 | RLS-scoped reads; foreign quoteId → notFound | build + human-check | `npm run typecheck && npm run lint && npm run build` | n/a | ⬜ pending |
| 3-05-03 | 05 | 4 | CAD-03 | T-3-18/T-3-19/T-3-22 | authorize-first actions; two-step kill confirm | build + human-check | `npm run typecheck && npm run lint && npm run build` | n/a | ⬜ pending |
| 3-06-01 | 06 | 4 | CAD-02 | T-3-23/T-3-24 | 401-no-Location; counts-only body | route test | `npx vitest run tests/cadence-tick-route.test.ts` | ❌ W0 (this task creates) | ⬜ pending |
| 3-06-02 | 06 | 4 | CAD-01, CAD-02 | T-3-25/T-3-26 | secret never printed; deployed 401 before schedule | script test + live check | `npx vitest run tests/cron-schedules.test.ts && npm run cron:apply` | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Test files are created by the same tasks that create the code they verify (each `<verify><automated>` names the file its task ships), so there is no standalone Wave 0 scaffold plan. Files created per plan:

- [ ] `tests/cadence-window.test.ts`, `tests/cadence-materialize.test.ts`, `tests/cadence-primary-contact.test.ts` — plan 03-07 (CAD-01/CAD-02 pure; split from 03-01 Task 3)
- [ ] `tests/cadence-tick.test.ts` — plan 03-02 (e2e tracer, CAD-01/04/05)
- [ ] `tests/cadence-transitions.test.ts`, `tests/cadence-consume-events.test.ts` — plan 03-03 (CAD-03)
- [ ] `tests/cadence-rewindow.test.ts`, `tests/cadence-dispatch.test.ts` — plan 03-04 (CAD-02/04/05)
- [ ] `tests/cadence-controls.test.ts` — plan 03-05 (CAD-03 kill switches)
- [ ] `tests/cadence-tick-route.test.ts` — plan 03-06 (route auth)
- [ ] Extensions: `tests/helpers/seed.ts` (03-01), `tests/rls-coverage.test.ts` (03-01), `tests/leak.test.ts` (03-01), `tests/cron-schedules.test.ts` (03-06)
- Framework install: none needed (Vitest + real-DB harness exist)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Kill/pause/resume usable one-handed on a phone | CAD-03 (D-16) | Layout/ergonomics judgment | Phone-width viewport: open client → quote → arm-and-confirm kill; pause/resume client; watch badges and touch times update (end-of-phase human check, plans 03-05 T2/T3) |
| Production cron firing per minute | CAD-02 | Live infra observation | Supabase SQL editor: cron.job row `cadence-tick`; cron.job_run_details fresh successful runs (plan 03-06 T2) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
