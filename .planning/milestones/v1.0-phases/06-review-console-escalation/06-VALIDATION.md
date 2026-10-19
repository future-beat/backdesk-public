---
phase: 6
slug: review-console-escalation
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-01
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (existing — pure suites on bare `npm test`, hosted suites via `npm run test:remote`) |
| **Config file** | vitest config in repo (existing) |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test && npx tsc --noEmit && npm run lint` |
| **Estimated runtime** | ~60 seconds (pure); test:remote excluded from per-task sampling (production-shared DB, serialized runs only) |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm test && npx tsc --noEmit && npm run lint`
- **Before `/gsd-verify-work`:** Full suite must be green; one serialized `npm run test:remote` at phase end
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-01-T1 | 06-01 | 1 | CON-01 | T-6-01, T-6-02, T-6-03 | WR-01 action hardening; force-dynamic + operator gate; latest-attempt in one core | remote + pure | `npm run test:remote -- tests/approval-queue.test.ts && npm test && npx tsc --noEmit && npm run lint` | ❌ created in-task | ⬜ pending |
| 06-01-T2 | 06-01 | 1 | CON-01 | T-6-04 | pgPolicy authored in-schema; append-only attestation surface | pure | `npx tsc --noEmit && npm run lint && npm test` | ✅ existing suites | ⬜ pending |
| 06-01-T3 | 06-01 | 1 | CON-01 | T-6-04 | REVOKE-then-GRANT per new table; SELECT-only grants | migration proof | `npm run db:migrate && npm run db:migrate && npm test && npx tsc --noEmit` | ✅ migrator exists | ⬜ pending |
| 06-02-T1 | 06-02 | 2 | CON-04 | T-6-05 | closed-vocabulary alert bodies byte-asserted | pure | `npx vitest run tests/stall-policy.test.ts tests/stalled-drafts.test.ts && npx tsc --noEmit` | ❌ created in-task | ⬜ pending |
| 06-02-T2 | 06-02 | 2 | CON-04 | T-6-06, T-6-08 | own digest bearer 401s; guarded-UPDATE dedupe | remote | `npm run test:remote -- tests/stall-tick.test.ts && npm test && npx tsc --noEmit && npm run lint` | ❌ created in-task | ⬜ pending |
| 06-02-T3 | 06-02 | 2 | CON-04 | T-6-07 | RLS-scoped nav count via caller JWT (A5 parity) | remote | `npm run test:remote -- tests/stall-tick.test.ts && npx tsc --noEmit && npm run lint` | ❌ shared with T2 | ⬜ pending |
| 06-03-T1 | 06-03 | 3 | CON-01 | T-6-09, T-6-10, T-6-11 | equality-guarded skip; single-uuid schemas | remote | `npm run test:remote -- tests/approval-queue.test.ts && npx tsc --noEmit && npm run lint` | ✅ from 06-01 | ⬜ pending |
| 06-03-T2 | 06-03 | 3 | CON-01, CON-04 | T-6-11 | no-draft card mirrors server refusal; parity via one core | remote + pure | `npm run test:remote -- tests/approval-queue.test.ts && npm test && npx tsc --noEmit && npm run lint` | ✅ from 06-01 | ⬜ pending |
| 06-04-T1 | 06-04 | 4 | ONB-04 | T-6-12, T-6-13 | one composed predicate; append-only evidence | remote | `npm run test:remote -- tests/onboarding-checklist-gate.test.ts && npm test && npx tsc --noEmit` | ❌ created in-task | ⬜ pending |
| 06-04-T2 | 06-04 | 4 | ONB-04 | T-6-14, T-6-15 | staleness never pauses; note required at schema | remote + pure | `npm run test:remote -- tests/onboarding-checklist-gate.test.ts && npm test && npx tsc --noEmit && npm run lint` | ❌ shared with T1 | ⬜ pending |
| 06-04-T3 | 06-04 | 4 | ONB-04 | — | probe-first; no prod code on unmeasured endpoints | doc gate | `grep -q "api_1.0/sms.json" docs/servicem8-api-notes.md && grep -q "api_1.0/email.json" docs/servicem8-api-notes.md` | ✅ doc exists | ⬜ pending |
| 06-05-T1 | 06-05 | 5 | CON-03 | T-6-18 | sanitized, bounded, number-unclippable body | pure | `npx vitest run tests/escalation-message.test.ts && npx tsc --noEmit` | ❌ created in-task | ⬜ pending |
| 06-05-T2 | 06-05 | 5 | CON-03 | T-6-16, T-6-17, T-6-19, T-6-20 | unique claim; zero-HTTP when disarmed; privilege pin unchanged | remote | `npm run test:remote -- tests/escalation.test.ts && npm test && npx tsc --noEmit && npm run lint` | ❌ created in-task | ⬜ pending |
| 06-06-T1 | 06-06 | 5 | CON-02 | — | pure grouping; shared stall predicate | pure | `npx vitest run tests/pipeline-grouping.test.ts && npm test && npx tsc --noEmit && npm run lint` | ❌ created in-task | ⬜ pending |
| 06-06-T2 | 06-06 | 5 | CON-02 | T-6-21, T-6-22, T-6-23 | bodies only behind the gate; refuse-never-repair phone edit | pure | `npx vitest run tests/pipeline-grouping.test.ts && npm test && npx tsc --noEmit && npm run lint` | ❌ shared with T1 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements — vitest pure suites + test:remote harness with lease/watchdog pause are live.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Hot-lead SMS reaches a real handset with tap-to-call | CON-03 | Live provider send to operator handset | Trigger a hot-classified inbound against the test tenant; confirm SMS content + callable number |
| Mobile approval-queue ergonomics | CON-01 | Visual/touch judgment on a phone | Open queue on a phone; approve, edit-then-approve, skip one draft each |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
