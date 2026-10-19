---
phase: 7
slug: attribution-reporting
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-02
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (existing) |
| **Config file** | vitest config in repo root (existing — Wave 0 installs nothing) |
| **Quick run command** | `npm test -- <suite-file>` (pure suites, bare `npm test` needs no database) |
| **Full suite command** | `npm test` (pure) then `npm run test:remote` (serialized against the hosted Sydney DB — production; never overlap runs) |
| **Estimated runtime** | ~60 seconds pure; several minutes remote |

---

## Sampling Rate

- **After every task commit (pure tasks):** Run `npm test -- <the suite(s) the task touched>` and `npx tsc --noEmit` — per-task latency budget 120 seconds
- **Tracer tasks and the wave's one remote-suite user:** run the serialized `npm run test:remote -- <suite(s)>` (and `npm run build` where the plan says so) inline in the task's `<verify>` — multi-minute, by design: a tracer proves its path end-to-end against the real schema, and the remote proof cannot be deferred to the wave boundary without leaving the door unverified (07-01 T1/T2, 07-03 T1, 07-04 T1/T3, 07-05 T1/T2/T3)
- **After every plan wave:** Run `npm test`, then one serialized `npm run test:remote`
- **Before `/gsd-verify-work`:** Full suite must be green (pure + remote), `npx tsc --noEmit` and `npm run lint` clean
- **Max feedback latency:** 120 seconds for pure tasks; remote-in-task runs under the rule above are exempt from the 120-second budget
- **Standing rules (unchanged):** exactly one remote-suite user per wave — 07-01 (w1), 07-03 (w2), 07-04 (w3), 07-05 (w4); 07-02 is pure-only — and exactly ONE migration in the phase (`0033_phase7_reporting`, 07-01 T1); never run two remote suites concurrently (the hosted Sydney DB is production, ticks lease-paused by the global setup)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 07-01-T1 | 07-01 | 1 | RPT-01, RPT-02 | T-7-01, T-7-02, T-7-03, T-7-05 | ONE monotonic migration applied to production; SELECT-only grants; unique claim + unique version proven in the DB | migration proof + remote | `npx vitest run tests/prospect-staging-retention.test.ts && npm run db:generate 2>&1 \| grep -q "No schema changes" && npm run db:migrate && npm run db:migrate && npm run test:remote -- tests/rls-coverage.test.ts tests/reporting-tables.test.ts && npx tsc --noEmit` | ❌ created in-task | ⬜ pending |
| 07-01-T2 | 07-01 | 1 | RPT-01, RPT-02 | T-7-04, T-7-06 | tenant-pinned keyed reads, half-open period, capped list; fiction-number seeders | remote | `npm run test:remote -- tests/reporting-tables.test.ts && npx tsc --noEmit && npm run lint` | ❌ shared with T1 | ⬜ pending |
| 07-02-T1 | 07-02 | 1 | RPT-01 | T-7-07, T-7-08, T-7-09 | import-free constants (8 pinned); D-02 predicate + D-01 window edges; floored haircut; strict evidence schema with no address/body key; pure decision | pure | `npx vitest run tests/audit-aggregate.test.ts tests/attribution-qualify.test.ts tests/attribution-baseline.test.ts tests/attribution-decide.test.ts && npx tsc --noEmit` | ❌ created in-task | ⬜ pending |
| 07-02-T2 | 07-02 | 1 | RPT-02 | T-7-08, T-7-10 | TZDate month bounds (DST-tested); fee pro-rating floors once; integer figures, null multiples | pure | `npx vitest run tests/reporting-period.test.ts tests/reporting-fees.test.ts tests/reporting-figures.test.ts && npx tsc --noEmit` | ❌ created in-task | ⬜ pending |
| 07-02-T3 | 07-02 | 1 | RPT-03 | T-7-09, T-7-10 | null-never-0 rates; one alarm predicate; one onboarding rule; one derivation for both pages | pure | `npx vitest run tests/reporting-metrics.test.ts && npm test && npx tsc --noEmit && npm run lint` | ❌ created in-task | ⬜ pending |
| 07-03-T1 | 07-03 | 2 | RPT-01 | T-7-11, T-7-12, T-7-14, T-7-15, T-7-16 | 'attribution' cursor only; claim + advance in one tx; tick seam defaults to skip; enumerated counts; address-free evidence reads | remote | `npm run test:remote -- tests/attribution-consume.test.ts tests/cadence-tick.test.ts tests/cadence-tick-route.test.ts && npx tsc --noEmit && npm run lint` | ❌ created in-task | ⬜ pending |
| 07-03-T2 | 07-03 | 2 | RPT-01 | T-7-13, T-7-14 | head-of-line hold; caught value never logged; delivery state frozen at consumption | pure | `npx vitest run tests/attribution-consume-isolation.test.ts && npm test && npx tsc --noEmit && npm run lint` | ❌ created in-task | ⬜ pending |
| 07-04-T1 | 07-04 | 3 | RPT-02 | T-7-17, T-7-19, T-7-20, T-7-21 | authorize-first action; versioned frozen row; 23505 mapped; render-from-the-row source assertion; A4 print block | remote | `npm run test:remote -- tests/monthly-report.test.ts && npx tsc --noEmit && npm run lint && npm run build` | ❌ created in-task | ⬜ pending |
| 07-04-T2 | 07-04 | 3 | RPT-02 | T-7-20, T-7-21 | screen-only banners; † value-unavailable; byte-pinned footnote variants from the row; client bundle pulls no db module | pure | `npx vitest run tests/reporting-copy.test.ts tests/lint-ban.test.ts && npx tsc --noEmit && npm run lint` | ❌ created in-task | ⬜ pending |
| 07-04-T3 | 07-04 | 3 | RPT-02 | T-7-17, T-7-18 | fee action authorizes before parsing; zod money/date validation; append-only rows; 0 writes on denied paths | pure | `npx vitest run tests/reports-authorization.test.ts tests/lint-ban.test.ts && npm test && npx tsc --noEmit && npm run lint && npm run build` | ❌ created in-task | ⬜ pending |
| 07-05-T1 | 07-05 | 4 | RPT-03 | T-7-23, T-7-24 | counts-only cross-tenant accessor pinned 13/17; requireOperator overview; no nav read | remote | `npm run test:remote -- tests/report-metrics.test.ts tests/sync-upsert.test.ts tests/stall-tick.test.ts && npx tsc --noEmit && npm run lint` | ❌ created in-task | ⬜ pending |
| 07-05-T2 | 07-05 | 4 | RPT-03 | T-7-25, T-7-26 | tenant-scoped counts equal the cross-tenant row field by field; no write in any metric path | remote | `npm run test:remote -- tests/report-metrics.test.ts && npx tsc --noEmit && npm run lint && npm run build` | ❌ shared with T1 | ⬜ pending |
| 07-05-T3 | 07-05 | 4 | RPT-03 | T-7-27, T-7-28 | closed-vocabulary digest line; NULL not empty; digest still writes nothing; metrics read isolated | pure + remote | `npx vitest run tests/opt-out-section.test.ts && npm run test:remote -- tests/stall-tick.test.ts tests/report-metrics.test.ts && npm test && npx tsc --noEmit && npm run lint` | ❌ created in-task | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*(Populated by the planner from the five PLAN.md files; see 07-RESEARCH.md §Validation Architecture for the research test map. Remote suites serialize: one remote-suite user per wave — 07-01 (w1), 07-03 (w2), 07-04 (w3), 07-05 (w4); 07-02 is pure-only.)*

---

## Wave 0 Requirements

- [ ] Pure suites for the attribution predicate, window math, per-job haircut, calendar-month bounds, and metric definitions (bare `npm test`)
- [ ] Remote suite for the attribution consumer cursor + never-twice index, parked at the outbox head and rewound only to its own seeded events
- [ ] Deliberate updates to the five pinned tests named in 07-RESEARCH.md (sync-upsert export/table counts, audit-aggregate constant count, rls-coverage grants map, cadence-tick literal + route key set)

*Existing vitest infrastructure covers all phase requirements; no framework install.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Printed A4 report reads correctly and hides operator controls | RPT-02 | Print rendering is browser-side | Open `/reports/[client]`, generate a month, print to PDF on phone + desktop, confirm no screen-only controls appear |
| `/reports` overview on a phone viewport | RPT-03 | Layout check | Open `/reports` at phone width; five metrics per client legible, >5% badge visible |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
