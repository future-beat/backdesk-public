---
phase: 10
slug: first-client-go-live
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-11
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Filled by plan-phase on 2026-09-11 from the eight plans; validate-phase sets `status: validated`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.11 (`fileParallelism: false`; `setupFiles: tests/helpers/env.ts`; `globalSetup` pauses production ticks on remote runs — never used in this phase) |
| **Config file** | `vitest.config.mts` |
| **Quick run command** | `npx vitest run tests/<file>.test.ts` (pure suites only, bare — no `ALLOW_REMOTE_TESTS`) |
| **Full suite command** | `npm test && npm run typecheck && npm run lint` locally (pure suites; DB-backed suites refuse at import by design); CI runs the DB-backed suites against `supabase start` with drizzle migrations applied |
| **Estimated runtime** | ~10 seconds for a pure suite; CI full run in minutes |

**Hard rule (D-11):** the hosted Sydney Supabase is production. `npm run test:remote` is never run during this phase. DB-backed suites (marked "integration (CI)") are verified by the CI run on the wave merge, not locally.

---

## Sampling Rate

- **After every task commit:** run the task's `<automated>` command (pure suite / typecheck / lint / the read-only script the task names).
- **After every plan wave:** CI full run (DB-backed suites against the local stack); `npm test`, `npm run typecheck`, `npm run lint` locally.
- **Before `/gsd-verify-work`:** CI green on the last code wave (wave 3); both proof artefact ids present in `docs/external-registrations.md`; migration 0036 applied (plan 01 Task 3 exit lines).
- **Max feedback latency:** ~10 seconds for pure suites; the CI run for DB-backed suites.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | ARM-01, ARM-02 | T-10-01/02/03/04/05 | requireOperatorId first; arm+audit in one transaction; identity re-supplied; domain read failure refuses | typecheck + lint + journal check | `npm run typecheck && npm run lint && node -e "<journal idx 36 check>"` | ✅ | ⬜ pending |
| 10-01-02 | 01 | 1 | ARM-02 | T-10-01/06 | refusal with no write; caught error text never returned; guarded path pinned | unit (pure) | `npx vitest run tests/arming-actions.test.ts tests/operator-authorization.test.ts` | ❌ W0 (created in task) | ⬜ pending |
| 10-01-03 | 01 | 1 | ARM-02 | T-10-07 | migration applied once, idempotent; cron gate before/after | ops (production, read-only gate + migrator) | `npm run db:migrate` (exit 0; second run no-op) | n/a | ⬜ pending |
| 10-02-01 | 02 | 1 | ARM-05 | T-10-08/10 | balance script prints no secret; GET-only | unit (source pin) | `npx vitest run tests/ops-scripts.test.ts` | ❌ W0 (created in task) | ⬜ pending |
| 10-02-02 | 02 | 1 | ARM-03 | T-10-09/10 | explicit select lists; addresses only inside EXISTS | unit (source pin) | `npx vitest run tests/ops-scripts.test.ts` | ✅ (extended) | ⬜ pending |
| 10-02-03 | 02 | 1 | DOM-04 | T-10-11 | --cadence refuses foreign/dead cadences; default link inert | unit (source pin) + typecheck | `npm run typecheck && npx vitest run tests/ops-scripts.test.ts` | ✅ (extended) | ⬜ pending |
| 10-03-01 | 03 | 2 | ARM-02 | T-10-12 | blast radius named by count and names | unit (pure) | `npx vitest run tests/arming-actions.test.ts` | ✅ | ⬜ pending |
| 10-03-02 | 03 | 2 | ARM-02 | T-10-13/14 | settings form never flips enabled; one domain predicate | unit (pure) | `npx vitest run tests/email-settings-action.test.ts` | ✅ | ⬜ pending |
| 10-04-01 | 04 | 2 | ARM-02 | T-10-15 | seed refuses enabled=true; grants SELECT-only on both new tables | integration (CI) | `npx vitest run tests/rls-coverage.test.ts` | ✅ (extended) | ⬜ pending |
| 10-04-02 | 04 | 2 | ARM-02 | T-10-02/03 | atomic arm+audit (forced failure rolls back); identity survives; override beats global | integration (CI) | `npx vitest run tests/messaging-config-arming.test.ts` | ❌ W0 (created in task) | ⬜ pending |
| 10-04-03 | 04 | 2 | ARM-01 | T-10-04/16 | three-state domain read; per-tenant disarmed assertions | integration (CI) | `npx vitest run tests/go-live-checklist.test.ts tests/routing-dispatch.test.ts tests/escalation.test.ts` | ❌ W0 / ✅ / ✅ | ⬜ pending |
| 10-05-01 | 05 | 3 | ARM-03, DOM-04 | T-10-17 | proof CHECKs; tenant-scoped escalation read | integration (CI) | `npx vitest run tests/tenant-proofs.test.ts` | ❌ W0 (created in task) | ⬜ pending |
| 10-05-02 | 05 | 3 | ARM-01 | — | live derived from armed + proof, never stored | integration (CI) | `npx vitest run tests/go-live-checklist.test.ts tests/onboarding-checklist-gate.test.ts` | ✅ (extended) | ⬜ pending |
| 10-05-03 | 05 | 3 | ARM-03, DOM-04 | T-10-17/18/19/20 | live artefact verification before write; no write on refusal | unit (pure) | `npx vitest run tests/proof-actions.test.ts` | ❌ W0 (created in task) | ⬜ pending |
| 10-06-01 | 06 | 4 | ARM-05 | T-10-23 | runbook references pinned; no credential shapes | unit (docs pin) | `npx vitest run tests/runbook-contract.test.ts` | ❌ W0 (created in task) | ⬜ pending |
| 10-06-02 | 06 | 4 | ARM-04 | T-10-21 | native follow-up seeded on the TRIAL account only | manual (checkpoint:human-action) | — | n/a | ⬜ pending |
| 10-06-03 | 06 | 4 | ARM-04 | T-10-22 | read-only probe; field names only | ops (read-only) | `node scripts/sm8-spike.mjs probe` | n/a | ⬜ pending |
| 10-07-01 | 07 | 5 | ARM-02, ARM-03 | T-10-24/25 | event gate + readiness; test-tenant override read back | manual (checkpoint:human-action, event-gated) | — | n/a | ⬜ pending |
| 10-07-02 | 07 | 5 | ARM-02 | T-10-27 | arming is a recorded decision | manual (checkpoint:decision) | — | n/a | ⬜ pending |
| 10-07-03 | 07 | 5 | ARM-03 | T-10-26 | product-path sequence; proof recorded with the escalation id | manual (checkpoint:human-action) | — | n/a | ⬜ pending |
| 10-08-01 | 08 | 6 | DOM-04, ARM-03 | T-10-28/29/30 | live send, delivered, one-click POST, suppression read back; evidence without secrets | ops (production, read-only read-backs + one send + one POST) | `npm run resend:email-status -- <id>`; `npm run cadence:status -- --cadence <id>`; `grep -c "CON-03 and MSG-02 live proofs" docs/external-registrations.md` | n/a | ⬜ pending |
| 10-08-02 | 08 | 6 | DOM-04 | T-10-31 | headers/footer observed in a real client; proof recorded | manual (checkpoint:human-action) | — | n/a | ⬜ pending |
| 10-08-03 | 08 | 6 | DOM-04 | — | obligations recorded closed | docs grep | `grep -c "Email pipe proof: recorded on" docs/external-registrations.md` | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Created inside the task that first needs them (no separate scaffold plan — each is a `tdd="true"` task with a `<behavior>` block):

- [ ] `tests/arming-actions.test.ts` — ARM-02 actions (plan 01 Task 2; pattern `tests/email-settings-action.test.ts`)
- [ ] `tests/ops-scripts.test.ts` — script hygiene pins (plan 02 Task 1; pattern `tests/cron-status-script.test.ts`)
- [ ] `tests/helpers/seed.ts` — `seedMessagingConfigOverride` (refuses enabled=true), `seedProof` (plan 04 Task 1)
- [ ] `tests/messaging-config-arming.test.ts` — ARM-02 repository, DB-backed (plan 04 Task 2)
- [ ] `tests/go-live-checklist.test.ts` — ARM-01, DB-backed (plan 04 Task 3; extended in plan 05 Task 2)
- [ ] `tests/tenant-proofs.test.ts` — D-02, DB-backed (plan 05 Task 1)
- [ ] `tests/proof-actions.test.ts` — D-02 action, pure (plan 05 Task 3)
- [ ] `tests/runbook-contract.test.ts` — ARM-05 docs pin (plan 06 Task 1)
- [ ] `tests/rls-coverage.test.ts` — two new tables + four grant entries (plan 04 Task 1)

Existing infrastructure (Vitest, `tests/helpers/env.ts`, CI local stack) covers everything else.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Escalation SMS arrives on the escalation handset within the tick interval | ARM-03 | ClickSend and a physical handset are never called from a test; production only | Plan 07 Task 3 steps 1-8; artefact = escalations row `sent` + provider id via `npm run escalations:recent`; proof recorded on the card |
| Proof email observed with From "via Backdesk", Reply-To the tradie, identity footer, List-Unsubscribe + List-Unsubscribe-Post | DOM-04 | header rendering is a judgment in a real mail client | Plan 08 Task 2 step 1 (Gmail "Show original") |
| Live one-click POST suppresses both channels and stops the cadence | DOM-04 | live-only on production; semantics pinned by `tests/unsubscribe-suppression.test.ts` | Plan 08 Task 1 steps 4-5; `npm run cadence:status` read-back |
| Native follow-up seeded on the ServiceM8 trial account | ARM-04 | ServiceM8 automation settings have no API | Plan 06 Task 2 |
| Test tenant 13e8f2aa off override written and read back before arming | D-06 | requires the operator's console session; write path is the audited action | Plan 07 Task 1 step 5 |
| Arming the shared sms row on production | ARM-02 / D-03 | one-way door; a recorded human decision | Plan 07 Task 2 (checkpoint:decision) |
| Eleven checklist rows, controls and Live lines render on a phone | ARM-01 | visual; end-of-phase human check (`human_verify_mode: end-of-phase`) | open a client page on `https://app.backdesk.com.au` after wave 3 |
| Alert From header `Backdesk <alerts@quotes.backdesk.com.au>` | D-12 | event-gated on a real operator alert | Plan 08 Task 2 step 3; recorded either way in Task 3 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies (manual-only rows above are checkpoints by design)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (waves 5-6 are the event-gated live proofs; each has a read-only read-back)
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s for pure suites
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
