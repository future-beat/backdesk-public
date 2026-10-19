---
phase: 13
slug: lead-cadence-labels-escalation
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-10-08
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.11 |
| **Config file** | `vitest.config.mts` (`fileParallelism: false`, 30 s timeouts, `globalSetup`) |
| **Quick run command** | `npx vitest run tests/<named pure suite>.test.ts` (pure suites run bare; a DB-backed suite refuses a remote target without `ALLOW_REMOTE_TESTS`, which is never set in this phase) |
| **Full suite command** | CI (`.github/workflows/ci.yml`, every branch push): `npx tsc --noEmit`, `npx eslint . --max-warnings=0`, `npx next build`, migrate a fresh local stack from the journal (now including 0040), `vitest run` |
| **Local gate** | `npm run typecheck && npm run lint` plus the task's named pure suites |
| **Estimated runtime** | pure suite per task ~5–20 s; typecheck + lint ~60 s; CI ~8–12 min |

Two classes of suite, by design:

- **Pure** (run locally, on every task — none imports `tests/helpers/seed` or `tests/helpers/env`): new — `cadence-policy`, `lead-close-isolation`, `queue-lead-rows`, `urgency-keywords`, `lead-labels`, `lead-label-effects`, `escalation-hold`, `escalation-passes`, `after-hours-escalation-action`, `lead-digest-section`; moved — `text-back-gate`, `drafting-prompt`, `drafting-validate`, `cadence-tick-route`, `classify-inbound`, `classification-privilege`, `escalation-message`, `runbook-contract`, `lint-ban`, `ops-scripts`; untouched regression pins — `cadence-rewindow`, `cadence-window`, `cadence-transitions`, `text-back-structure`, `stalled-drafts`, `cadence-tick-isolation`, `cadence-dispatch-isolation`, `cadence-tick-classification`, `stall-claim-isolation`, `console-error-leak`, `layout-contract`, `text-back-actions`, `arming-actions`, `operator-authorization`, `audit-aggregate`, `client-divert-runbook`.
- **DB-backed** (CI only — they import the seed or env helper, which refuses a non-local target; the dev machine has no local stack and the hosted database is production): new — `tests/lead-cadence-active.test.ts` (REPLACES `lead-cadence-inert` by `git mv`), `tests/lead-policy-both-kinds.test.ts`, `tests/lead-close.test.ts`, `tests/ring-twice.test.ts`, `tests/escalation-lead.test.ts`; edited — `tests/rls-coverage.test.ts`, `tests/approval-queue.test.ts`, `tests/onboarding-gate.test.ts`, `tests/lead-reply.test.ts`, `tests/escalation.test.ts` (type widening); untouched quote pins that CI re-proves — `tests/cadence-tick.test.ts`, `tests/cadence-resume.test.ts`, `tests/cadence-dispatch.test.ts`, `tests/text-back.test.ts`, `tests/inbound-threading.test.ts`, `tests/inbound-stop.test.ts`; and the three "must not move" pins — `tests/sync-upsert.test.ts`, `tests/report-metrics.test.ts`, `tests/cron-schedules.test.ts`. None of these appears in a local `<automated>` chain. `npm run test:remote` is never run.

---

## Sampling Rate

- **After every task commit:** `npm run typecheck && npm run lint` and the task's named pure suites (the task's `<automated>` command)
- **After every plan wave:** CI on a push — a throwaway branch for the tracer (plan 13-02 Task 2, `ci/phase-13-tracer`, before any expansion plan starts) and a throwaway branch for the whole phase (plan 13-07 Task 1, `ci/phase-13-final`, before production is touched); `main` is pushed once, in 13-07 Task 3, after migration 0040 is applied and read back
- **Before `/gsd-verify-work`:** CI green on the final `main` SHA, migration 0040 live with a proven no-op second run, production probed; no live lead is required (12-09 override: nothing is armed; the first live lead stays event-gated with the first client)
- **Max feedback latency:** ~60 s for pure suites; one wave for DB-backed suites written in waves 3–5 (they are written with the code and first run at the 13-07 gate; an executor may push an extra throwaway branch earlier if it needs the signal)
- **Pins that must NOT move in any plan:** `tests/cron-schedules.test.ts` (four jobs — a change here means a cron job was added), `tests/sync-upsert.test.ts` (sixteen `forAllTenants_*` exports — the two digest reads live in `inbound-messages.ts` and `escalations.ts` precisely so this stands), `tests/report-metrics.test.ts` (twin parity), `scripts/apply-cron-schedules.mjs`; plus the quote behaviour pins `tests/cadence-rewindow.test.ts`, `tests/cadence-tick.test.ts`, `tests/cadence-resume.test.ts`, `tests/cadence-window.test.ts`, `src/core/cadence/resume.ts`, `src/core/escalation/quote-call.ts`, `src/core/messaging/stop-keywords.ts` (D-17). Locally "did not move" is proven by `git diff --quiet <base> -- <files>`; CI at the two gates runs them. `<phase base>` = `git log -1 --format=%H -- .planning/phases/13-lead-cadence-labels-escalation/13-01-PLAN.md`; `<plan base>` = the newest commit that touched the SUMMARY of the plan the current plan depends on
- **CI readings are bound to the pushed SHA:** `gh run list --commit "$(git rev-parse HEAD)" --json conclusion --jq '.[0].conclusion' | grep -x success` — never "the latest run"

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 13-01-01 | 01 | 1 | LEAD-01, LEAD-05 | T-13-05 | Migration 0040 is one additive entry; every vocabulary member in const and CHECK byte for byte; nothing applied | static + pure pins | `npm run typecheck && npm run lint && npx vitest run tests/lint-ban.test.ts tests/cadence-rewindow.test.ts tests/text-back-structure.test.ts && npm run db:generate` (no schema changes) `&&` journal idx 40 check `&& git diff --quiet <phase base> -- <quote pins + must-not-move>` | ✅ extend | ⬜ pending |
| 13-01-02 | 01 | 1 | LEAD-01, LEAD-05 | T-13-03 | Five template reads carry kind; the 90-day gate rule in D-06 order with the stored vocabulary | unit (pure) | `npx vitest run tests/text-back-gate.test.ts tests/text-back-structure.test.ts tests/lint-ban.test.ts && npm run typecheck && npm run lint && git diff --quiet <phase base> -- <quote pins + must-not-move>` | ✅ extend | ⬜ pending |
| 13-02-01 | 02 | 2 | LEAD-01, LEAD-05 | T-13-01, T-13-02, T-13-04, T-13-07, T-13-14, T-13-23 | Kind switch first in dispatchOne; policy by kind with the quote default; closeLeadInTx on the caller's handle (no nested transaction); lead facts fenced; queue and inbox null-safe | unit + structural (tracer) | `npx vitest run tests/cadence-policy.test.ts tests/cadence-rewindow.test.ts tests/lead-close-isolation.test.ts tests/queue-lead-rows.test.ts tests/drafting-prompt.test.ts tests/drafting-validate.test.ts tests/cadence-tick-route.test.ts tests/cadence-tick-isolation.test.ts tests/cadence-dispatch-isolation.test.ts tests/inbox-authorization.test.ts tests/text-back-structure.test.ts tests/text-back-gate.test.ts tests/console-error-leak.test.ts tests/lint-ban.test.ts && npm run typecheck && npm run lint && git diff --quiet <phase base> -- <quote pins + must-not-move>` | ❌ created in task (cadence-policy, lead-close-isolation, queue-lead-rows); ✅ extend | ⬜ pending |
| 13-02-02 | 02 | 2 | LEAD-01, LEAD-05 | T-13-01, T-13-03, T-13-04 | Drafted, approvable, dispatched inside hours, closed after touch 3; both kinds decided by policy; lead rows reach the queue; the quote gate stays unmet | integration (CI, branch `ci/phase-13-tracer`) | `npm run typecheck && npm run lint && test ! -f tests/lead-cadence-inert.test.ts && gh run list --commit "$(git rev-parse HEAD)" … = success` | ❌ created in task (lead-cadence-active by rename; lead-policy-both-kinds) | ⬜ pending |
| 13-03-01 | 03 | 3 | LEAD-01, LEAD-03 | T-13-16 | Tenant-scoped reads carry the tenant; skipped calls record the lead they joined | static + pure pins | `npm run typecheck && npm run lint && npx vitest run tests/text-back-structure.test.ts tests/text-back-gate.test.ts tests/lint-ban.test.ts && git diff --quiet <plan base> -- <must-not-move>` | ✅ extend | ⬜ pending |
| 13-03-02 | 03 | 3 | LEAD-03 | T-13-13, T-13-10, T-13-15 | Five-column classification write; (is_hot OR keyword_hot); release is a guarded claim; counts-only digest reads; sixteen exports | unit (pins) + diff | `npm run typecheck && npm run lint && npx vitest run tests/lint-ban.test.ts tests/classification-privilege.test.ts tests/classify-inbound.test.ts && git diff --quiet <plan base> -- tests/sync-upsert.test.ts …` | ✅ extend | ⬜ pending |
| 13-03-03 | 03 | 3 | LEAD-01 | T-13-09, T-13-16 | closeLead idempotent; every exit maps to a reason; 90-day rule on both sides | integration (CI) | local: `npm run typecheck && npm run lint && npx vitest run tests/lint-ban.test.ts tests/text-back-gate.test.ts`; CI (13-07): `tests/lead-close.test.ts` | ❌ created in task | ⬜ pending |
| 13-04-01 | 04 | 4 | LEAD-02, LEAD-03, LEAD-01 | T-13-08, T-13-06 | STOP first; keyword_hot at the door for lead replies only; quote-wins only within one tenant | unit (pure) | `npx vitest run tests/urgency-keywords.test.ts tests/text-back-structure.test.ts && npm run typecheck && npm run lint && git diff --quiet <plan base> -- src/core/messaging/stop-keywords.ts …` | ❌ created in task | ⬜ pending |
| 13-04-02 | 04 | 4 | LEAD-02, LEAD-03 | T-13-13 | Vocabulary byte-identical in three places; schema-bound output; no tools; hot rule decided once | unit (pure) | `npx vitest run tests/lead-labels.test.ts tests/classify-inbound.test.ts tests/classification-privilege.test.ts tests/cadence-tick-classification.test.ts && npm run typecheck && npm run lint` | ❌ created in task (lead-labels); ✅ extend | ⬜ pending |
| 13-04-03 | 04 | 4 | LEAD-02, LEAD-01 | T-13-09, T-13-06 | Closing labels at high confidence only, in a separate pass; counts enumerated | unit (pure isolation) + integration (CI) | `npx vitest run tests/lead-label-effects.test.ts tests/cadence-tick-route.test.ts tests/cadence-tick-isolation.test.ts tests/cadence-tick-classification.test.ts tests/text-back-structure.test.ts && npm run typecheck && npm run lint`; CI (13-07): `tests/lead-reply.test.ts` | ❌ created in task; ✅ extend | ⬜ pending |
| 13-06-01 | 06 | 5 | LEAD-03 | T-13-17, T-13-11 | Hold is a claim with hold_until; window opens at start minute; emergencies and keywords bypass | unit (pure) | `npx vitest run tests/escalation-hold.test.ts tests/escalation-message.test.ts tests/cadence-window.test.ts tests/cadence-rewindow.test.ts && npm run typecheck && npm run lint && git diff --quiet <plan base> -- tests/cadence-window.test.ts …` | ❌ created in task (escalation-hold); ✅ extend | ⬜ pending |
| 13-06-02 | 06 | 5 | LEAD-03 | T-13-10, T-13-08 | Ring-twice claims on the second call; release guarded; no cooldown at release; counts only | unit (pure isolation) | `npx vitest run tests/escalation-passes.test.ts tests/cadence-tick-route.test.ts tests/cadence-tick-isolation.test.ts tests/escalation-hold.test.ts tests/escalation-message.test.ts && npm run typecheck && npm run lint && git diff --quiet <plan base> -- src/core/escalation/quote-call.ts …` | ❌ created in task | ⬜ pending |
| 13-06-03 | 06 | 5 | LEAD-03 | T-13-10, T-13-08, T-13-11 | One send across three ticks; switch both ways; emergencies regardless; never-twice on the second call | integration (CI) | local: `npm run typecheck && npm run lint && npx vitest run tests/escalation-hold.test.ts tests/escalation-passes.test.ts`; CI (13-07): `tests/ring-twice.test.ts`, `tests/escalation-lead.test.ts` | ❌ created in task | ⬜ pending |
| 13-05-01 | 05 | 4 | LEAD-03, LEAD-01 | T-13-12, T-13-19, T-13-18 | Authorization before any form read; one-column patch; fixed sentences; seed in its own try | unit + build | `npx vitest run tests/after-hours-escalation-action.test.ts tests/text-back-actions.test.ts tests/arming-actions.test.ts tests/operator-authorization.test.ts tests/console-error-leak.test.ts tests/lint-ban.test.ts tests/layout-contract.test.ts && npm run typecheck && npm run lint && npx next build` | ❌ created in task | ⬜ pending |
| 13-05-02 | 05 | 4 | LEAD-03 | T-13-15 | Closed-vocabulary section; null when empty; no number | unit (pure) | `npx vitest run tests/lead-digest-section.test.ts tests/stalled-drafts.test.ts && npm run typecheck && npm run lint && git diff --quiet <plan base> -- tests/cron-schedules.test.ts …` | ❌ created in task | ⬜ pending |
| 13-05-03 | 05 | 4 | LEAD-03, LEAD-05 | T-13-15 | Constants recorded; runbooks name the switch and ring-twice; no number in docs | unit (contract) + grep | `npx vitest run tests/runbook-contract.test.ts tests/client-divert-runbook.test.ts tests/audit-aggregate.test.ts` + the grep gates in the plan | ✅ extend | ⬜ pending |
| 13-07-01 | 07 | 6 | LEAD-01..05 | T-13-05, T-13-15 | Read-only pre-flight; whole phase green on a fresh database before production | CI (branch `ci/phase-13-final`) + read-only run | `npx vitest run tests/ops-scripts.test.ts && npm run lead-cadence:invariants \| grep inbound_lead_rows=0 && gh run list --commit "$(git rev-parse HEAD)" … = success` | ❌ created in task (script + ops-scripts block) | ⬜ pending |
| 13-07-02 | 07 | 6 | LEAD-01 | T-13-22 | Blocking-human decision before the one-way act; pre-flight lines in the message | checkpoint:decision | read-only pre-flight (see plan) | n/a | ⬜ pending |
| 13-07-03 | 07 | 6 | LEAD-01 | T-13-05, T-13-20, T-13-21, T-13-15 | Schema before code; lease gate; no-op second migrate; doors 401; identifiers only | ops read-back + CI gate | `npm run cron:status`, `npm run lead-cadence:invariants`, `node scripts/db-status.mjs`, door probes, then HEAD = origin/main and `gh run list --commit "$(git rev-parse HEAD)" …` = success | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

There is no separate Wave 0 plan: each new suite is written in the task that needs it (tasks marked `tdd="true"` write the test first), and the tracer's DB-backed proof is run by CI in plan 13-02 Task 2 before any expansion plan starts.

- [ ] `tests/cadence-policy.test.ts`, `tests/lead-close-isolation.test.ts`, `tests/queue-lead-rows.test.ts` — pure (13-02 Task 1) — LEAD-05, LEAD-01
- [ ] `tests/lead-cadence-active.test.ts` (git mv of `lead-cadence-inert`), `tests/lead-policy-both-kinds.test.ts` — DB-backed (13-02 Task 2) — LEAD-01, LEAD-05
- [ ] `tests/lead-close.test.ts` — DB-backed (13-03 Task 3) — D-11, D-12, D-14
- [ ] `tests/urgency-keywords.test.ts`, `tests/lead-labels.test.ts`, `tests/lead-label-effects.test.ts` — pure (13-04) — LEAD-02, LEAD-03
- [ ] `tests/escalation-hold.test.ts`, `tests/escalation-passes.test.ts` — pure (13-06) — LEAD-03
- [ ] `tests/ring-twice.test.ts`, `tests/escalation-lead.test.ts` — DB-backed (13-06 Task 3) — LEAD-03
- [ ] `tests/after-hours-escalation-action.test.ts`, `tests/lead-digest-section.test.ts` — pure (13-05) — D-09, D-08
- [ ] `tests/helpers/seed.ts` — `seedLeadTemplates`, `seedInbound` with `leadId`/`keywordHot`, `setTenantAfterHoursEscalation` (13-02 Task 2)
- [ ] No framework install: vitest is present; no package is added in this phase

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| A real caller's touch 2 arrives the next morning in the tradie's voice, and touch 3 the morning after, on a real handset | LEAD-01, D-04 | Needs an armed client, a real call and a real handset; nothing has ever sent live (12-09 override) and the test tenant is paused with SMS off | Event-gated with the first client: the live first-lead proof per `docs/client-divert-onboarding-runbook.md` section 8, extended by 13-05 Task 3 |
| A hot lead reply reaches the tradie's handset, and a held one arrives when the shop opens | LEAD-03, D-09 | Needs a real reply and the escalation handset | Event-gated with the first client; `npm run escalations:recent -- --tenant <id>` shows the row, `hold_until` and `released_at` |
| The After-hours escalation form reads correctly on a phone | D-09 | Layout and wording at phone width | `/gsd-verify-work` end-of-phase human check on `/clients/[id]` (no `checkpoint:human-verify` tasks — `human_verify_mode` is end-of-phase) |
| A lead card on `/queue` reads as a missed-call follow-up with no quote link and approves with one tap | LEAD-01 | Rendering of a row with no quote id | End-of-phase human check: seed none on production — verified on the CI-built stack's screenshots is not available, so the operator checks the first real lead's card when it appears; the structural pin `tests/queue-lead-rows.test.ts` and the DB row proof stand until then |

---

## Dimension 8 — Nyquist coverage summary

- Every `auto` and `tracer` task carries an `<automated>` command that runs in under about two minutes locally and names ONLY suites that can run here (pure suites, typecheck, lint, `next build`, read-only scripts, `git diff --quiet` against a base, and SHA-bound CI readings); no local chain names a DB-backed suite. The one checkpoint task (13-07 Task 2) is preceded by a read-only pre-flight and followed by a read-back task.
- No three consecutive tasks lack an automated check: the longest stretch without a locally runnable behavioural suite is one task (13-03 Task 3 and 13-06 Task 3 write DB-backed suites, gated locally by typecheck, lint and the sibling pure suites, and proven by CI in 13-07 Task 1).
- DB-backed behaviour is sampled at two CI gates (the tracer branch after wave 2; the phase branch before production), and the tracer is proven on a fresh database before any expansion plan.
- Edge-probe accounting: boundaries pinned at 12 h / 24 h / 7 d (lead) beside 48 h / 72 h / 42 d (quote); 90 days ± 1; 30 minutes ± 1; preferred ≠ start; the 120-cell hot matrix; "not urgent" as a recorded false positive; the 02:00 slot; one send across three ticks for a held row.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (suites are created in the tasks that need them)
- [x] No watch-mode flags (`vitest run` only)
- [x] Feedback latency < 120 s for local gates; DB-backed suites within one wave of the tracer gate or at the phase gate
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending (seeded by plan-phase 2026-10-08; validated by `/gsd-validate-phase 13`)
