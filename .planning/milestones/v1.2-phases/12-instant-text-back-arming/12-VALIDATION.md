---
phase: 12
slug: instant-text-back-arming
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-10-06
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.11 |
| **Config file** | `vitest.config.mts` (`fileParallelism: false`, 30 s timeouts, `globalSetup`) |
| **Quick run command** | `npx vitest run tests/<named pure suite>.test.ts` (pure suites run bare; a DB-backed suite refuses a remote target without `ALLOW_REMOTE_TESTS`, which is never set in this phase) |
| **Full suite command** | CI (`.github/workflows/ci.yml`, every branch push): `npx tsc --noEmit`, `npx eslint . --max-warnings=0`, `npx next build`, migrate a fresh local stack from the journal, `vitest run` |
| **Local gate** | `npm run typecheck && npm run lint` plus the task's named pure suites |
| **Estimated runtime** | pure suite per task ~5–20 s; typecheck + lint ~60 s; CI ~8–12 min |

Two classes of suite, by design:

- **Pure** (run locally, on every task — none imports `tests/helpers/seed` or `tests/helpers/env`): new — `text-back-gate`, `text-back-template`, `text-back-structure`, `text-back-balance`, `text-back-admin`, `text-back-actions`, `text-back-arming-gate`, `client-divert-runbook`; existing — `twilio-voice-status-route`, `twilio-voice-route`, `telephony-greeting`, `audit-aggregate`, `ops-scripts`, `lint-ban`, `cadence-tick-route`, the four tick isolation suites, `cadence-transitions`, `attribution-qualify`, `attribution-decide`, `escalation-message`, `arming-actions`, `proof-actions`, `divert-provision-action`, `operator-authorization`, `console-error-leak`, `layout-contract`, `classification-privilege`, `privacy-page`, `marketing-copy`, `runbook-contract`.
- **DB-backed** (CI only — they import the seed or env helper, which refuses a non-local target; the dev machine has no local stack and the hosted database is production): new — `tests/text-back.test.ts`, `tests/lead-cadence-inert.test.ts`, `tests/text-back-repository.test.ts`, `tests/text-back-sweep.test.ts`, `tests/text-back-quote.test.ts`, `tests/lead-reply.test.ts`; edited — `tests/rls-coverage.test.ts`, `tests/tenant-proofs.test.ts`, `tests/missed-calls.test.ts`, `tests/cadence-repository.test.ts`, `tests/escalation.test.ts`, `tests/inbound-threading.test.ts`, `tests/inbound-stop.test.ts`, `tests/messaging-config-arming.test.ts`, `tests/go-live-checklist.test.ts`, `tests/onboarding-checklist-gate.test.ts`, `tests/cadence-tick.test.ts`, `tests/stall-tick.test.ts`; and the three "must not move" pins — `tests/sync-upsert.test.ts`, `tests/report-metrics.test.ts`, `tests/cron-schedules.test.ts`. None of these appears in a local `<automated>` chain. `npm run test:remote` is never run.

---

## Sampling Rate

- **After every task commit:** `npm run typecheck && npm run lint` and the task's named pure suites (the task's `<automated>` command)
- **After every plan wave:** CI on a push — a throwaway branch for the tracer (plan 12-03 Task 1, before production is touched), then `main` at the wave gates: 12-03 Task 2 (waves 1–2), 12-05 Task 1 (wave 4), 12-05 Task 3 (wave 5), 12-08 Task 3 (wave 6)
- **Before `/gsd-verify-work`:** CI green on the final `main` SHA, and plan 12-09's live session recorded (or its deferral recorded by the founder)
- **Max feedback latency:** ~60 s for pure suites; one wave for DB-backed suites (they are written with the code and first run at the next wave gate)
- **Pins that must NOT move in any plan:** `tests/cron-schedules.test.ts` (four jobs — a change here means a cron job was added, which D-01 forbids), `tests/sync-upsert.test.ts` (sixteen `forAllTenants_*` exports, same tables), `tests/report-metrics.test.ts` (twin parity). All three are DB-backed, so locally "did not move" is proven by `git diff --quiet <base> -- <files>` and CI at the wave gates is what runs them. `<phase base>` = `git log -1 --format=%H -- .planning/phases/12-instant-text-back-arming/12-01-PLAN.md` (the last planning commit); `<plan base>` = the newest commit that touched the SUMMARY of the plan(s) the current plan depends on. In plan 12-01 `tests/sync-upsert.test.ts` may receive a compiler-forced type widening only (its pins stay byte-identical, proven by CI in 12-03); from 12-02 on it is in the `git diff --quiet` list
- **CI readings are bound to the pushed SHA:** `gh run list --commit "$(git rev-parse HEAD)" --json conclusion --jq '.[0].conclusion' | grep -x success` — never "the latest run"

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 12-01-01 | 01 | 1 | TXT-02, TXT-03 | T-12-10, T-12-12 | Migration 0039 is one additive entry (nullable or defaulted columns, widening-only CHECKs, IN-04 decided by read-only counts); lead touches excluded by `kind = 'quote'` | static + pure pins | `npm run typecheck && npm run lint && npx vitest run tests/ops-scripts.test.ts tests/lint-ban.test.ts && npm run db:generate` (no schema changes) `&&` journal check `&& git diff --quiet <phase base> -- tests/report-metrics.test.ts tests/cron-schedules.test.ts scripts/apply-cron-schedules.mjs` | ✅ extend | ⬜ pending |
| 12-01-02 | 01 | 1 | TXT-01, TXT-02, TXT-03 | T-12-01, T-12-02, T-12-03, T-12-06, T-12-08, T-12-09 | The door passes only a row id into the send path; the gate refuses in D-06 order with a null-guarded own-number rule; a stub send is never recorded as sent; the template validator refuses links and non-GSM text | unit + structural (tracer) | `npx vitest run tests/text-back-gate.test.ts tests/text-back-template.test.ts tests/text-back-structure.test.ts tests/twilio-voice-status-route.test.ts tests/twilio-voice-route.test.ts tests/telephony-greeting.test.ts tests/audit-aggregate.test.ts tests/ops-scripts.test.ts tests/lint-ban.test.ts && npm run typecheck && npm run lint && git diff --quiet <phase base> -- tests/report-metrics.test.ts tests/cron-schedules.test.ts scripts/apply-cron-schedules.mjs` | ❌ created in task (gate, template, structure); ✅ extend (route, pins) | ⬜ pending |
| 12-01-03 | 01 | 1 | TXT-02, TXT-03 | T-12-02, T-12-06, T-12-10 | One claimant per call; every skip recorded with no ledger row; constraints refuse the forbidden shapes | integration (CI) | local: `npm run typecheck && npm run lint && npx vitest run tests/lint-ban.test.ts tests/text-back-gate.test.ts`; CI (12-03): `tests/text-back.test.ts` + moved pins | ❌ created in task | ⬜ pending |
| 12-02-01 | 02 | 2 | TXT-02, TXT-03 | T-12-07, T-12-11, T-12-14 | Reads select no caller number; system disarm writes its audit row in one transaction | unit (pin) + diff | `npm run typecheck && npm run lint && npx vitest run tests/lint-ban.test.ts && git diff --quiet <plan base> -- tests/sync-upsert.test.ts tests/report-metrics.test.ts tests/cron-schedules.test.ts scripts/apply-cron-schedules.mjs` | ✅ extend | ⬜ pending |
| 12-02-02 | 02 | 2 | TXT-02 | T-12-17, T-12-14 | A due lead touch is never promoted, drafted, claimed, re-windowed or expired; forged audit rows refused | integration (CI) | local: `npm run typecheck && npm run lint`; CI: `tests/lead-cadence-inert.test.ts`, `tests/text-back-repository.test.ts` | ❌ created in task | ⬜ pending |
| 12-03-01 | 03 | 3 | TXT-02 | T-12-10 | Migration 0039 applies on a database built from the journal; every DB-backed suite green before production | CI (branch `ci/phase-12-tracer`) | `gh run list --commit "$(git rev-parse HEAD)" --json conclusion --jq '.[0].conclusion' \| grep -x success` | n/a | ⬜ pending |
| 12-03-02 | 03 | 3 | TXT-02 | T-12-10, T-12-18, T-12-19, T-12-07 | Schema before code; lease gate; no-op second migrate; doors 401 | ops read-back + CI gate | `npm run cron:status`, `node scripts/db-status.mjs`, `npm run missed-calls:invariants`, door probes, then HEAD = origin/main and `gh run list --commit "$(git rev-parse HEAD)" …` = success (see plan) | n/a | ⬜ pending |
| 12-04-01 | 04 | 4 | TXT-02 | T-12-02, T-12-20, T-12-22 | Sweep sends only never-claimed rows inside the window; no sender means no scan | unit + diff + integration (CI) | `npx vitest run tests/cadence-tick-route.test.ts tests/cadence-tick-isolation.test.ts tests/cadence-dispatch-isolation.test.ts tests/cadence-tick-classification.test.ts tests/stall-claim-isolation.test.ts tests/text-back-structure.test.ts && npm run typecheck && npm run lint && git diff --quiet <phase base> -- tests/cron-schedules.test.ts scripts/apply-cron-schedules.mjs`; CI (12-05 gate): `tests/text-back-sweep.test.ts` | ❌ created in task (sweep); ✅ extend | ⬜ pending |
| 12-04-02 | 04 | 4 | TXT-06 | T-12-07, T-12-22 | Failed and stuck text-backs alerted once, counts only | unit + integration (CI) | `npx vitest run tests/text-back-balance.test.ts tests/cadence-tick-route.test.ts && npm run typecheck && npm run lint` | ❌ created in task | ⬜ pending |
| 12-04-03 | 04 | 4 | TXT-06 | T-12-04, T-12-21, T-12-14 | Floors strict; unreadable balance never disarms; auto-disarm audited as system | unit + integration (CI) | `npx vitest run tests/text-back-balance.test.ts tests/cadence-tick-route.test.ts tests/audit-aggregate.test.ts && npm run typecheck && npm run lint && git diff --quiet <phase base> -- tests/cron-schedules.test.ts scripts/apply-cron-schedules.mjs scripts/clicksend-balance.mjs` | ✅ from 12-04-02 | ⬜ pending |
| 12-05-01 | 05 | 5 | TXT-04 | T-12-27, T-12-02, T-12-28 | No lead for an open-quote caller; touch 0 once; never attributed; a failed pause is named, counted and alerted | unit + diff + CI gate + integration (CI) | `npx vitest run tests/attribution-qualify.test.ts tests/attribution-decide.test.ts tests/cadence-transitions.test.ts tests/cadence-tick-route.test.ts tests/text-back-balance.test.ts tests/text-back-gate.test.ts tests/text-back-structure.test.ts && npm run typecheck && npm run lint && git diff --quiet <plan base> -- tests/report-metrics.test.ts tests/sync-upsert.test.ts tests/cron-schedules.test.ts tests/cadence-transitions.test.ts src/db/repository/for-all-tenants.ts scripts/apply-cron-schedules.mjs && gh run list --commit "$(git rev-parse origin/main)" …` = success (wave-4 gate); CI: `tests/text-back-quote.test.ts` | ✅ extend; ❌ created in task (quote suite) | ⬜ pending |
| 12-05-02 | 05 | 5 | TXT-04 | T-12-29, T-12-22 | Escalation only to the client's own phone, once per call, behind the arming switch | unit + diff + integration (CI) | `npx vitest run tests/escalation-message.test.ts tests/cadence-tick-route.test.ts tests/cadence-tick-isolation.test.ts && npm run typecheck && npm run lint && git diff --quiet <plan base> -- tests/cron-schedules.test.ts scripts/apply-cron-schedules.mjs` | ✅ extend | ⬜ pending |
| 12-05-03 | 05 | 5 | TXT-04 | T-12-30 | Nothing throws on a cadence with no quote | integration (CI) + CI gate | `npm run typecheck && npm run lint && npx vitest run tests/classification-privilege.test.ts tests/console-error-leak.test.ts tests/text-back-structure.test.ts`, then HEAD = origin/main, `gh run list --commit "$(git rev-parse HEAD)" …` = success (`tests/lead-reply.test.ts`), and `git diff --quiet <plan base> -- ` the three pins | ❌ created in task | ⬜ pending |
| 12-06-01 | 06 | 4 | TXT-01, TXT-05 | T-12-08, T-12-23, T-12-24 | Save is not attest; one normaliser; last own line cannot be removed while armed | unit | `npx vitest run tests/text-back-admin.test.ts tests/text-back-template.test.ts tests/text-back-structure.test.ts && npm run typecheck && npm run lint` | ❌ created in task | ⬜ pending |
| 12-06-02 | 06 | 4 | TXT-01, TXT-05 | T-12-11, T-12-07 | Authorization before any form read; fixed-string logs | unit + build | `npx vitest run tests/text-back-actions.test.ts tests/lint-ban.test.ts tests/console-error-leak.test.ts tests/layout-contract.test.ts tests/operator-authorization.test.ts && npm run typecheck && npm run lint && npx next build` | ❌ created in task | ⬜ pending |
| 12-07-01 | 07 | 4 | COMP-01 | T-12-15, T-12-25 | Pinned sentences unchanged; no overclaim; coverage predicate true | unit | `npx vitest run tests/privacy-page.test.ts tests/marketing-copy.test.ts && npm run typecheck && npm run lint` | ✅ extend | ⬜ pending |
| 12-07-02 | 07 | 4 | COMP-03 | T-12-03, T-12-26, T-12-07 | Runbook order, traps and no credential shape | unit (contract) | `npx vitest run tests/client-divert-runbook.test.ts tests/runbook-contract.test.ts` | ❌ created in task | ⬜ pending |
| 12-07-03 | 07 | 4 | COMP-03 (D-14 instrument) | T-12-07 | Reader is read-only, prints no number, and ends with the two arming read-back lines | unit + read-only run | `npx vitest run tests/ops-scripts.test.ts && npm run lint && npm run text-back:timing -- --tenant 13e8f2aa-edee-4eb1-b699-09b650674f81 --limit 5` → `samples=`, `text_back_armed=false`, `sms_enabled_for_tenant=false` | ✅ extend | ⬜ pending |
| 12-08-01 | 08 | 6 | TXT-05 | T-12-05, T-12-03 | Per-tenant only; ten-item gate in order; strict verification proof | unit (pure gate table) + integration (CI) | `npx vitest run tests/text-back-arming-gate.test.ts tests/arming-actions.test.ts tests/lint-ban.test.ts && npm run typecheck && npm run lint && npm run db:generate` (no schema changes); CI (12-08-03 gate): `tests/go-live-checklist.test.ts`, `tests/onboarding-checklist-gate.test.ts`, `tests/messaging-config-arming.test.ts` | ❌ created in task (text-back-arming-gate); ✅ extend | ⬜ pending |
| 12-08-02 | 08 | 6 | TXT-05 | T-12-05, T-12-25, T-12-31 | Target everyone refused; privacy predicate guards the arm; proof re-verified | unit | `npx vitest run tests/arming-actions.test.ts tests/proof-actions.test.ts tests/divert-provision-action.test.ts tests/operator-authorization.test.ts tests/lint-ban.test.ts tests/console-error-leak.test.ts && npm run typecheck && npm run lint` | ✅ extend | ⬜ pending |
| 12-08-03 | 08 | 6 | TXT-05 | T-12-14, T-12-32 | No every-client control; disarm ungated; CI green after push | unit + build + diff + CI gate | `npm run typecheck && npm run lint && npx vitest run tests/client-divert-runbook.test.ts tests/runbook-contract.test.ts tests/text-back-arming-gate.test.ts tests/arming-actions.test.ts tests/proof-actions.test.ts tests/layout-contract.test.ts tests/lint-ban.test.ts && git diff --quiet <plan base> -- ` the three pins, the cron script and `src/db/migrations`, then HEAD = origin/main and `gh run list --commit "$(git rev-parse HEAD)" …` = success | ✅ extend | ⬜ pending |
| 12-09-01 | 09 | 7 | TXT-05 | T-12-05 | Blocking-human decision before any live SMS; HALT if the client pause blocks text-back | checkpoint:decision | read-only pre-flight incl. `text_back_armed=false`, `sms_enabled_for_tenant=false` (see plan) | n/a | ⬜ pending |
| 12-09-02 | 09 | 7 | TXT-01, TXT-02, TXT-05 | T-12-03, T-12-05, T-12-07 | Test tenant only; fail-safes seen; teardown mandatory before either resume signal | checkpoint:human-action + read-only reader | `npm run text-back:timing -- --tenant 13e8f2aa-edee-4eb1-b699-09b650674f81 --limit 15` ends with `text_back_armed=false` and `sms_enabled_for_tenant=false` (both signals); `samples=` ≥ 1 on `s4-done` | n/a | ⬜ pending |
| 12-09-03 | 09 | 7 | TXT-01, TXT-02, COMP-03 | T-12-07, T-12-05 | Tenant proven disarmed before any evidence is written; evidence carries identifiers only | read-back + doc gate | the reader's two read-back lines `= false`, then grep gates on `docs/external-registrations.md` (see plan) | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

There is no separate Wave 0 plan: each new suite is written in the task that needs it (tasks marked `tdd="true"` write the test first), and the tracer's DB-backed proof is run by CI in plan 12-03 before any expansion plan starts.

- [ ] `tests/text-back-gate.test.ts`, `tests/text-back-template.test.ts`, `tests/text-back-structure.test.ts` — pure (12-01 Task 2) — TXT-01, TXT-03
- [ ] `tests/text-back.test.ts` — DB-backed (12-01 Task 3) — TXT-02, TXT-03
- [ ] `tests/text-back-arming-gate.test.ts` — pure, the ten-item `firstUnmetGate('text_back')` table with no seed-helper import (12-08 Task 1) — TXT-05
- [ ] `tests/lead-cadence-inert.test.ts`, `tests/text-back-repository.test.ts` — DB-backed (12-02 Task 2) — D-19, D-21
- [ ] `tests/text-back-sweep.test.ts` — DB-backed; `tests/text-back-balance.test.ts` — pure (12-04) — TXT-02, TXT-06
- [ ] `tests/text-back-quote.test.ts`, `tests/lead-reply.test.ts` — DB-backed (12-05) — TXT-04, D-18
- [ ] `tests/text-back-admin.test.ts`, `tests/text-back-actions.test.ts` — pure (12-06) — TXT-01, TXT-05
- [ ] `tests/client-divert-runbook.test.ts` — pure (12-07) — COMP-03
- [ ] `tests/helpers/seed.ts` — lead, lead-cadence, armed-text-back, template and never-text seeds; teardown for the new no-cascade tables (12-01 Task 3)
- [ ] No framework install: vitest is present; no package is added in this phase

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| The text arrives on a real handset within seconds of a real call, with the business name, "Reply STOP" and the privacy pointer (S4) | TXT-01, D-14 | Needs a handset, a carrier and a stopwatch; the carrier's delivered time and the founder's reading are two clocks | Plan 12-09 Task 2 steps 9–11; evidence from `npm run text-back:timing` |
| The caller's number survives a real carrier divert (the relocated 11-08 spike proof) | TXT-05, D-09 | Code cannot tell a direct dial from a divert when ForwardedFrom is absent | Plan 12-09 Task 2 step 6 in two-phone mode; per client thereafter by runbook section 6 |
| A withheld call and a call from the client's own line produce no text on real calls | TXT-03, D-06 | The withheld sentinel and own-number substitution are carrier behaviour | Plan 12-09 Task 2 step 12 |
| The Text-back page and the seventeen-row checklist read correctly on a phone | TXT-05 | Layout, pre-fill and wording at phone width | `<human-check>` blocks in 12-06 Task 2 and 12-08 Task 3 |
| Inbox and queue render with no link to a missing quote | TXT-04 (D-18) | No lead-threaded message exists on production before 12-09 | `<human-check>` in 12-05 Task 3 |
| The divert codes are right for a client's carrier and plan | COMP-03 | Carrier facts are unverified in the repository | Runbook section 6: the diverted verification call per client |

---

## Dimension 8 — Nyquist coverage summary

- Every `auto` and `tracer` task carries an `<automated>` command that runs in under about two minutes locally and names ONLY suites that can run here (pure suites, typecheck, lint, read-only scripts, `git diff --quiet` against a base, and SHA-bound CI readings); no local chain names a DB-backed suite. The two checkpoint tasks in 12-09 are followed by a read-only reader run that asserts the tenant is disarmed.
- No three consecutive tasks lack an automated check: the longest stretch without a locally runnable behavioural suite is one task (12-01 Task 3 and 12-02 Task 2 write DB-backed suites, gated locally by typecheck and lint and proven by CI in 12-03 Task 1).
- DB-backed behaviour is sampled at every wave gate (five CI runs across the phase), and the tracer is proven on a fresh database before production schema changes.
- Edge-probe accounting: 25 explicit + 2 backstop = 27; TXT-04 flagged separately. The two backstops are the S4 timing truth (plan 12-09) and the per-carrier divert-code truth (plan 12-07); TXT-04's unclassified row is recorded as a flagged assumption in plan 12-05.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (suites are created in the tasks that need them)
- [x] No watch-mode flags (`vitest run` only)
- [x] Feedback latency < 120 s for local gates; DB-backed suites within one wave
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending (seeded by plan-phase 2026-10-06; validated by `/gsd-validate-phase 12`)
