---
phase: 14
slug: servicem8-job-creation-lead-resolution
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-10-10
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.11 |
| **Config file** | `vitest.config.mts` (`fileParallelism: false`, 30 s timeouts, `globalSetup`) |
| **Quick run command** | `npx vitest run tests/<named pure suite>.test.ts` (pure suites run bare; a DB-backed suite refuses a remote target without `ALLOW_REMOTE_TESTS`, which is never set in this phase) |
| **Full suite command** | CI (`.github/workflows/ci.yml`, every branch push): `npx tsc --noEmit`, `npx eslint . --max-warnings=0`, `npx next build`, migrate a fresh local stack from the journal (now including 0041), `vitest run` |
| **Local gate** | `npm run typecheck && npm run lint` plus the task's named pure suites |
| **Estimated runtime** | pure suite per task ~5–20 s; typecheck + lint ~60 s; `next build` ~90 s; CI ~8–12 min |

Two classes of suite, by design:

- **Pure** (run locally, on every task — none imports `tests/helpers/seed` or `tests/helpers/env`; `tests/helpers/sm8-stub.ts` is a pure helper): new — `sm8-client-write`, `mobile-spellings`, `lead-job-description`, `lead-job-create`, `create-job-action`, `lead-job-structure`, `lead-job-match`, `attribution-lead-born`, `done-keyword`; moved — `sm8-schemas`, `lint-ban` (CLIENT_REACHABLE + the barrel list), `operator-authorization` (GUARDED_PATHS), `lead-digest-section` (the mocked read list + two lines), `runbook-contract` (a control label), `ops-scripts` (the invariants block); untouched regression pins — `text-back-gate`, `text-back-structure`, `lead-close-isolation`, `inbox-authorization`, `console-error-leak`, `stop-keywords`, `urgency-keywords`, `classification-privilege`, `sync-tick-route`, `stalled-drafts`, `attribution-decide`, `attribution-qualify`, `attribution-wedge-section`, `client-divert-runbook`, `audit-aggregate`.
- **DB-backed** (CI only — they import the seed or env helper, which refuses a non-local target; the dev machine has no local stack and the hosted database is production): new — `tests/lead-job-create-db.test.ts` (14-02), `tests/lead-booked-by-tradie.test.ts` (14-03), `tests/lead-done-keyword.test.ts` (14-04); edited — `tests/rls-coverage.test.ts` (14-01, the 0041 names); untouched pins that CI re-proves — `tests/sync-upsert.test.ts`, `tests/sync-cursor.test.ts`, `tests/sync-failure-alerts.test.ts`, `tests/sync-health.test.ts`, `tests/sync-tick-budget.test.ts`, `tests/quote-events.test.ts`, `tests/connect-servicem8.test.ts`, `tests/lead-close.test.ts`, `tests/lead-reply.test.ts`, `tests/lead-label-effects.test.ts`, `tests/inbound-stop.test.ts`, `tests/inbound-threading.test.ts`, every `tests/cadence-*.test.ts`, `tests/attribution-consume.test.ts`, `tests/attribution-consume-isolation.test.ts`, `tests/attribution-baseline.test.ts`, every `tests/escalation-*.test.ts`, `tests/report-metrics.test.ts`, `tests/cron-schedules.test.ts`. None of these appears in a local `<automated>` chain. `npm run test:remote` is never run.
- **Live ServiceM8**: NONE. D-11 authorised the research spike alone; every write test runs against `vi.stubGlobal('fetch')` or `createSm8Stub`. `scripts/sm8-spike.mjs` is not run by any plan.

---

## Sampling Rate

- **After every task commit:** `npm run typecheck && npm run lint` and the task's named pure suites (the task's `<automated>` command); the console tasks add `npx next build`
- **After every plan wave:** CI on a push — a throwaway branch for the tracer (plan 14-02 Task 3, `ci/phase-14-tracer`, before any expansion plan starts) and a throwaway branch for the whole phase (plan 14-05 Task 1, `ci/phase-14-final`, before production is touched); `main` is pushed once, in 14-05 Task 3, after migration 0041 is applied and read back
- **Before `/gsd-verify-work`:** CI green on the final `main` SHA, migration 0041 live with a proven no-op second run, production probed; no live lead, no live job and no ServiceM8 write is required (12-09 override: nothing is armed; the first live job stays event-gated with the first client)
- **Max feedback latency:** ~90 s for pure suites plus build; one wave for the DB-backed suites written in wave 3 (they are written with the code and first run at the 14-05 gate; an executor may push an extra throwaway branch earlier if it needs the signal)
- **Pins that must NOT move in any plan:** `tests/sync-upsert.test.ts` (sixteen `forAllTenants_*` exports — the three new cross-tenant reads live in `leads.ts` and `escalations.ts` precisely so this stands; the `errorDetail` pins on `run-sync.ts`), `tests/cron-schedules.test.ts` (no cron job was added — the match rides the sync), `tests/report-metrics.test.ts`, `scripts/apply-cron-schedules.mjs`; the quote behaviour pins `tests/sync-cursor`, `sync-failure-alerts`, `quote-events`, `connect-servicem8`, every `cadence-*`, every existing `attribution-*`, `inbound-stop`, `inbound-threading`, `lead-close`, `lead-label-effects`, `escalation-*`; and the sources `src/core/sync/transitions.ts`, `src/core/sync/eligibility.ts`, `src/core/sync/failure-policy.ts`, `src/core/attribution/qualify.ts`, `src/core/attribution/decide.ts`, `src/core/messaging/stop-keywords.ts`, `src/core/leads/close.ts` (D-13). Locally "did not move" is proven by `git diff --quiet <base> -- <files>`; CI at the two gates runs them. `<phase base>` = `git log -1 --format=%H -- .planning/phases/14-servicem8-job-creation-lead-resolution/14-01-PLAN.md`
- **Pins that move BY DESIGN, each with a dated containment comment:** `tests/rls-coverage.test.ts` (14-01: the 0041 CHECK and index names), `tests/lint-ban.test.ts` (14-02: two CLIENT_REACHABLE entries; 14-04: three barrel names), `tests/operator-authorization.test.ts` (14-02: the new action file), `tests/lead-digest-section.test.ts` (14-04: the mocked read and two lines), `tests/runbook-contract.test.ts` (14-04: one control label), `tests/ops-scripts.test.ts` (14-05: the invariants block), `tests/sm8-schemas.test.ts` (14-01: a Phase 14 describe)
- **CI readings are bound to the pushed SHA:** `gh run list --commit "$(git rev-parse HEAD)" --json conclusion --jq '.[0].conclusion' | grep -x success` — never "the latest run"

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 14-01-01 | 01 | 1 | SM8-02, SM8-03, LEAD-04 | T-14-11, T-14-07 | Migration 0041 is one additive entry; every vocabulary member in const and CHECK byte for byte; `quotes_sync_source_known` hand-written; nothing applied | static + pure pins | `npm run typecheck && npm run lint && npx vitest run tests/text-back-gate.test.ts tests/lint-ban.test.ts tests/text-back-structure.test.ts && npm run db:generate` (no schema changes) `&&` journal idx 41 check `&& git diff --quiet <phase base> -- <pins>` | ✅ extend | ⬜ pending |
| 14-01-02 | 01 | 1 | SM8-02, SM8-03, LEAD-04 | T-14-02, T-14-07 | Guarded claim as one UPDATE; every predicate carries the tenant; sticky `'lead'` in the conflict set; three-way close; sixteen exports | static + pure pins | `npm run typecheck && npm run lint && npx vitest run tests/lint-ban.test.ts tests/text-back-structure.test.ts tests/lead-close-isolation.test.ts && test $(grep -c forAllTenants_ for-all-tenants.ts) = 16 && git diff --quiet <phase base> -- <pins>` | ✅ extend | ⬜ pending |
| 14-01-03 | 01 | 1 | SM8-01 | T-14-03, T-14-04, T-14-08, T-14-14 | Never-throw write client; status-only details; `$filter` from validated values; every create read back; `Sm8Client` unchanged | unit (pure, fetch stubbed) | `npx vitest run tests/sm8-client-write.test.ts tests/sm8-schemas.test.ts tests/mobile-spellings.test.ts tests/lint-ban.test.ts && npm run typecheck && npm run lint && grep gates && git diff --quiet <phase base> -- <six fakes + sync sources>` | ❌ created in task (sm8-client-write, mobile-spellings, sm8-stub); ✅ extend (sm8-schemas) | ⬜ pending |
| 14-02-01 | 02 | 2 | SM8-01, SM8-02, SM8-03 | T-14-01, T-14-02, T-14-07, T-14-08, T-14-13 | One tap, one job read back, one mirror row `needs_review`/`lead`, one converted lead; `closeLeadInTx` on the handle; gate before body; no event emitted | unit + structural (tracer) + build | `npx vitest run tests/lead-job-description.test.ts tests/lead-job-create.test.ts tests/sm8-client-write.test.ts tests/lint-ban.test.ts tests/inbox-authorization.test.ts tests/console-error-leak.test.ts tests/lead-close-isolation.test.ts && npm run typecheck && npm run lint && npx next build >/dev/null 2>&1 && grep gates && git diff --quiet <phase base> -- <pins>` | ❌ created in task (lead-job-description, lead-job-create) | ⬜ pending |
| 14-02-02 | 02 | 2 | SM8-03, SM8-01 | T-14-02, T-14-09, T-14-13 | Retry adopts by uuid/description/mobile, never POSTs blind; fixed sentences keyed on the closed kinds; the create files cannot emit events; logs ids only | unit (pure) + structural | `npx vitest run tests/lead-job-create.test.ts tests/create-job-action.test.ts tests/lead-job-structure.test.ts tests/lead-job-description.test.ts tests/lint-ban.test.ts tests/operator-authorization.test.ts tests/inbox-authorization.test.ts tests/console-error-leak.test.ts && npm run typecheck && npm run lint && npx next build >/dev/null 2>&1 && git diff --quiet <phase base> -- <pins>` | ❌ created in task (create-job-action, lead-job-structure); ✅ extend | ⬜ pending |
| 14-02-03 | 02 | 2 | SM8-01, SM8-02, SM8-03 | T-14-02, T-14-07, T-14-14 | Double tap → one job; the sync's silence; failed and retry; the partial unique — on a fresh database | integration (CI, branch `ci/phase-14-tracer`) | `npm run typecheck && npm run lint && test -f tests/lead-job-create-db.test.ts && gh run list --commit "$(git rev-parse HEAD)" … = success` | ❌ created in task | ⬜ pending |
| 14-03-01 | 03 | 3 | LEAD-04 | T-14-10, T-14-15, T-14-07 | Window pinned at D−1/D/D+14/D+15 in the tenant's zone; the pass post-commit, reads only, capped; `run-sync.ts` diff bounded | unit (pure) + structural | `npx vitest run tests/lead-job-match.test.ts tests/lead-job-structure.test.ts tests/lint-ban.test.ts tests/sync-tick-route.test.ts tests/lead-close-isolation.test.ts && npm run typecheck && npm run lint && grep gates && git diff --quiet <phase base> -- <sync pins>` | ❌ created in task (lead-job-match); ✅ extend | ⬜ pending |
| 14-03-02 | 03 | 3 | SM8-02 (D-06) | T-14-13 | Lead-born won unqualified before the decision; keyed on the linkage; `qualify.ts`/`decide.ts` byte-identical | unit (pure) + structural | `npx vitest run tests/attribution-lead-born.test.ts tests/attribution-decide.test.ts tests/attribution-qualify.test.ts tests/attribution-wedge-section.test.ts && npm run typecheck && npm run lint && grep gates && git diff --quiet <phase base> -- <attribution pins>` | ❌ created in task | ⬜ pending |
| 14-03-03 | 03 | 3 | LEAD-04, SM8-02 | T-14-15, T-14-13 | Resolved once, never twice, never outside the window, never for the operator's lead; two leads on one job; lead-born won → no attribution row | integration (CI) | local: `npm run typecheck && npm run lint` + file/grep gates; CI (14-05): `tests/lead-booked-by-tradie.test.ts` | ❌ created in task | ⬜ pending |
| 14-04-01 | 04 | 3 | LEAD-04 | T-14-05, T-14-06, T-14-09, T-14-16 | DONE after STOP, before the lookup, own numbers only, most-recent escalation within 48 h; never texts back; sixteen exports; door suites byte-identical | unit (pure) + structural; DB suite written | `npx vitest run tests/done-keyword.test.ts tests/lint-ban.test.ts tests/stop-keywords.test.ts tests/urgency-keywords.test.ts tests/classification-privilege.test.ts && npm run typecheck && npm run lint && grep gates && git diff --quiet <phase base> -- <door pins>`; CI (14-05): `tests/lead-done-keyword.test.ts` | ❌ created in task (done-keyword, lead-done-keyword) | ⬜ pending |
| 14-04-02 | 04 | 3 | LEAD-04 (D-09) | T-14-09 | Counts-only read; two fixed-word lines byte-pinned; a failed read costs a paragraph | unit (pure, mocked barrel) | `npx vitest run tests/lead-digest-section.test.ts tests/stalled-drafts.test.ts tests/lint-ban.test.ts && npm run typecheck && npm run lint && grep gates && git diff --quiet <phase base> -- <must-not-move>` | ✅ extend | ⬜ pending |
| 14-04-03 | 04 | 3 | LEAD-04 (D-07, D-08, D-09) | T-14-09 | Constants recorded; runbooks name the tap, the sheet, DONE and the tradie-booked rule; no number in docs | unit (contract) + grep | `npx vitest run tests/runbook-contract.test.ts tests/client-divert-runbook.test.ts tests/audit-aggregate.test.ts` + the grep gates in the plan | ✅ extend | ⬜ pending |
| 14-05-01 | 05 | 4 | SM8-01..03, LEAD-04 | T-14-11, T-14-09 | Read-only pre-flight; whole phase green on a fresh database before production | CI (branch `ci/phase-14-final`) + read-only run | `npx vitest run tests/ops-scripts.test.ts && npm run lead-jobs:invariants \| grep leads_converted=0 && gh run list --commit "$(git rev-parse HEAD)" … = success && git diff --quiet <phase base> -- <must-not-move>` | ❌ created in task (script + ops-scripts block) | ⬜ pending |
| 14-05-02 | 05 | 4 | SM8-03 | T-14-19 | Blocking-human decision before the one-way act; pre-flight lines in the message | checkpoint:decision | read-only pre-flight (see plan) | n/a | ⬜ pending |
| 14-05-03 | 05 | 4 | SM8-03 | T-14-11, T-14-18, T-14-12, T-14-09, T-14-14 | Schema before code; lease gate; founder runs db:migrate on refusal; no-op second migrate; doors 401; both ticks 200; identifiers only | ops read-back + CI gate | `npm run cron:status`, `npm run lead-jobs:invariants`, `node scripts/db-status.mjs`, door probes, then HEAD = origin/main and `gh run list --commit "$(git rev-parse HEAD)" …` = success | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

There is no separate Wave 0 plan: each new suite is written in the task that needs it (tasks marked `tdd="true"` write the test first), the ServiceM8 stub is written with the client in 14-01 Task 3, and the tracer's DB-backed proof is run by CI in plan 14-02 Task 3 before any expansion plan starts.

- [ ] `tests/helpers/sm8-stub.ts` — pure helper: in-memory ServiceM8 with exact-spelling `$filter`, `x-record-uuid` minting, `failNext`, `omitHeaderNext`, `setJobStatus` (14-01 Task 3) — SM8-01, SM8-03
- [ ] `tests/sm8-client-write.test.ts`, `tests/mobile-spellings.test.ts` — pure (14-01 Task 3) — SM8-01
- [ ] `tests/lead-job-description.test.ts`, `tests/lead-job-create.test.ts` — pure (14-02 Task 1) — SM8-01, SM8-03
- [ ] `tests/create-job-action.test.ts`, `tests/lead-job-structure.test.ts` — pure, source-reading (14-02 Task 2) — SM8-01, SM8-02
- [ ] `tests/lead-job-create-db.test.ts` — DB-backed (14-02 Task 3, CI on `ci/phase-14-tracer`) — SM8-01, SM8-02, SM8-03
- [ ] `tests/lead-job-match.test.ts`, `tests/attribution-lead-born.test.ts` — pure (14-03) — LEAD-04, D-06
- [ ] `tests/lead-booked-by-tradie.test.ts` — DB-backed (14-03 Task 3) — LEAD-04, D-06
- [ ] `tests/done-keyword.test.ts` — pure; `tests/lead-done-keyword.test.ts` — DB-backed (14-04 Task 1) — LEAD-04
- [ ] `tests/helpers/seed.ts` — `seedEscalationSent` (14-04 Task 1); `seedLead` overrides already admit the 0041 linkage columns
- [ ] `scripts/lead-jobs-invariants.mjs` + its `ops-scripts` block (14-05 Task 1)
- [ ] No framework install: vitest is present; no package is added in this phase; no live ServiceM8 probe is run (research's optional A2/A3 probes are declined under D-11)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| A real lead's tap creates a real job in a real client's ServiceM8, visible in the ServiceM8 app with the caller's words and contact | SM8-01, D-02 | Needs an armed client, a real reply and the client's own ServiceM8 account; no live write is authorised outside a client engagement (D-11) | Event-gated with the first client: the first lead with a reply — tap on the inbox row, confirm, open the job in the client's ServiceM8; record the job uuid (not the caller's number) in `docs/external-registrations.md` per the go-live runbook §19 |
| The tradie's own booking resolves the lead "booked by tradie" on the next sync | LEAD-04, D-07 | Needs a real tradie creating a real job for a real caller within 14 days | Event-gated with the first client; the inbox row chip and the next morning's digest line are the proof |
| DONE from the tradie's escalation phone closes the escalated lead | LEAD-04, D-08 | Needs the escalation handset and a real hot-lead escalation | Event-gated with the first client; `npm run escalations:recent -- --tenant <id>` shows the row, the inbox row shows "closed by tradie" |
| The confirm sheet reads correctly on a phone — the verbatim words, the prefilled company name, the suburb field, the note line, the Retry panel after a failure | D-01, D-09 | Layout and wording at phone width | `/gsd-verify-work` end-of-phase human check on `/inbox` (no `checkpoint:human-verify` tasks — `human_verify_mode` is end-of-phase); no lead exists on production, so the operator checks the first real lead's row when it appears; the structural pins and the DB proof stand until then |

---

## Dimension 8 — Nyquist coverage summary

- Every `auto` and `tracer` task carries an `<automated>` command that runs in under about two minutes locally and names ONLY suites that can run here (pure suites, typecheck, lint, `next build`, read-only scripts, `git diff --quiet` against a base, grep gates and SHA-bound CI readings); no local chain names a DB-backed suite and none reaches api.servicem8.com. The one checkpoint task (14-05 Task 2) is preceded by a read-only pre-flight and followed by a read-back task.
- No three consecutive tasks lack an automated check: the longest stretch without a locally runnable behavioural suite is one task (14-03 Task 3 writes a DB-backed suite, gated locally by typecheck, lint and grep, and proven by CI in 14-05 Task 1).
- DB-backed behaviour is sampled at two CI gates (the tracer branch after wave 2; the phase branch before production), and the tracer is proven on a fresh database before any expansion plan.
- Edge-probe accounting: the window pinned at D−1 / D / D+14 / D+15 in `Australia/Perth` with a UTC-rolled call; the three mobile spellings both ways; `errorCode` 0 and '0'; 400/401/403/404/422/429/500 and a thrown fetch; a 200 with no header; the double tap; a reply landing between the preview and the confirm (`thread_changed`); the three partial failures, including the retry with a retyped suburb adopting by the persisted hash; 47 h / 48 h / 49 h for DONE; `done`, `DONE`, `undone`, `well-done`; two leads on one job; a lead in `creating` left alone; a qualifying ledger row on a lead-born job still unqualified.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (suites are created in the tasks that need them)
- [x] No watch-mode flags (`vitest run` only)
- [x] Feedback latency < 120 s for local gates; DB-backed suites within one wave of the tracer gate or at the phase gate
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending (seeded by plan-phase 2026-10-10; validated by `/gsd-validate-phase 14`)
