---
phase: 11
slug: telephony-capture
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-27
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.11 (`include: tests/**/*.test.ts`, `setupFiles: tests/helpers/env.ts`, `fileParallelism: false`, `testTimeout: 30000`) |
| **Config file** | `vitest.config.mts` |
| **Quick run command** | `npx vitest run tests/twilio-voice-route.test.ts tests/telephony-greeting.test.ts` |
| **Full suite command** | `npm test` (pure suites locally; DB-backed suites refuse without a local stack and run in CI via `supabase start`). `npm run test:remote` is FORBIDDEN for every suite this phase adds — the hosted Sydney database is production. |
| **Estimated runtime** | pure additions < 10 s locally; CI full run ~8 min |

Three tiers, by what a suite may touch:

| Tier | Runs where | Phase 11 suites |
|---|---|---|
| Pure (mocked env + repository; signed fixtures built with `node:crypto`) | bare `npm test`, every task commit | `twilio-voice-route`, `twilio-voice-status-route`, `telephony-greeting`, `telephony-webhook-url`, `telephony-caller`, `missed-call-reconcile`, `provision-divert-number`, `divert-provision-action`; edits to `proof-actions`, `arming-actions`, `messaging-reconcile-route`, `ops-scripts`, `lint-ban`, `sync-upsert`, `runbook-contract` |
| DB-backed (`supabase start` on the CI runner only) | CI per push | `missed-calls` (new); edits to `rls-coverage`, `go-live-checklist`, `onboarding-checklist-gate`, `tenant-proofs` |
| Live / human (production, founder) | plans 11-02 T1, 11-07, 11-08 | bundle submission; migration push; first purchase; verification call; S5/S7 readings; dropped-callback drill; three-carrier divert spike — all recorded with `scripts/missed-calls-recent.mjs` into `docs/external-registrations.md` |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/twilio-voice-route.test.ts tests/telephony-greeting.test.ts` plus `npm run typecheck`
- **After every plan wave:** Run `npm test` (pure) locally; CI green (DB tier) on the wave's push before the next wave starts
- **Before `/gsd-verify-work`:** Full suite must be green in CI AND the live spike (11-08) recorded in `docs/external-registrations.md`
- **Max feedback latency:** 10 seconds (pure), one CI run (~8 minutes) for the DB tier

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 1 | CAP-04 | T-11-SC | twilio installed only at the exact pinned version after a blocking-human decision; no postinstall | checkpoint:decision | `node -e "process.exit(require('./package.json').dependencies.twilio==='6.1.1'?0:1)"` | ✅ (package.json) | ⬜ pending |
| 11-01-02 | 01 | 1 | CAP-02, CAP-03, CAP-04 | T-11-01 / T-11-02 / T-11-04 / T-11-11 / T-11-12 / T-11-13 | 401 before the body on a bad token; generic TwiML + fixed log on bad signature / unset base URL / DB failure; one idempotent insert; tenant from To only | unit (pure) | `npx vitest run tests/twilio-voice-route.test.ts tests/lint-ban.test.ts tests/sync-upsert.test.ts && npm run typecheck && npm run lint` | ❌ W0 (`tests/twilio-voice-route.test.ts` written in this task) | ⬜ pending |
| 11-01-03 | 01 | 1 | CAP-02, CAP-03, CAP-04 | T-11-05 / T-11-10 / T-11-11 | No recording/dial/gather/play/redirect verb in any telephony source; `&`/`'` escaped; URL builder null when unset; withheld sentinels never yield a number | unit (structural + pure) | `npx vitest run tests/telephony-greeting.test.ts tests/telephony-webhook-url.test.ts tests/telephony-caller.test.ts tests/twilio-voice-route.test.ts` | ❌ W0 (three new suites written in this task) | ⬜ pending |
| 11-02-01 | 02 | 2 | CAP-01, CAP-02 | T-11-10 | Recording Configurations empty; bundle submitted; keys placed by hand; evidence entry carries no secret | checkpoint:human-action | `grep -c "Phase 11" docs/external-registrations.md` | ✅ (docs) | ⬜ pending |
| 11-02-02 | 02 | 2 | CAP-01, CAP-03 | T-11-14 / T-11-16 | Lease gate before/after; migrate exit captured; second run no-op; deployed routes 401 (not 500); secrets never printed | integration (production, read-only probes) | `npm run cron:status \| grep "remote_test_lease rows: 0" && node scripts/db-status.mjs \| grep "missed_calls\s+rowsecurity=true" && curl … voice?token=wrong → 401` | ✅ (scripts exist) | ⬜ pending |
| 11-02-03 | 02 | 2 | CAP-03, CAP-04 | T-11-01 / T-11-02 / T-11-04 / T-11-09 | Status door: own token, signature, exact-match UPDATE, never an insert, uniform `{received:true}`; sibling secret rejected | unit (pure) | `npx vitest run tests/twilio-voice-status-route.test.ts tests/twilio-voice-route.test.ts && npm run typecheck && npm run lint` | ❌ W0 (written in this task) | ⬜ pending |
| 11-03-01 | 03 | 2 | CAP-02, CAP-03 | T-11-14 / T-11-SC | One importing file; closed unions; no credential in a returned string; edge sydney; single create call; no messaging URL | typecheck + lint + import pin | `npm run typecheck && npm run lint && grep -rl "from 'twilio'" src/ \| grep -v twilio-client.ts \| wc -l \| grep -qx 0` | ✅ (grep) | ⬜ pending |
| 11-03-02 | 03 | 2 | CAP-03, CAP-02 | T-11-02 / T-11-04 / T-11-10 / T-11-13 | Zero HTTP without active numbers; recover/complete through the same unique index; RECORDING_PRESENT alarm; route never spreads | unit (pure) | `npx vitest run tests/missed-call-reconcile.test.ts tests/messaging-reconcile-route.test.ts tests/messaging-reconcile.test.ts tests/cron-schedules.test.ts && npm run typecheck && npm run lint` | ❌ W0 (`tests/missed-call-reconcile.test.ts` written in this task; route test edited) | ⬜ pending |
| 11-04-01 | 04 | 2 | CAP-05 | T-11-04 | Thirteen keys; ARMING_GATES untouched; detail carries the tenant's own number and a row id only; days derived at read time | unit (pure) + DB (CI) + human-check (end-of-phase) | `npx vitest run tests/runbook-contract.test.ts tests/proof-actions.test.ts tests/arming-actions.test.ts && npm run typecheck && npm run lint` (DB cases in `tests/go-live-checklist.test.ts` run in CI) | ✅ (edits) | ⬜ pending |
| 11-04-02 | 04 | 2 | CAP-01, CAP-03 | T-11-12 / T-11-15 / T-11-16 / T-11-17 | Operator-JWT writes refused; cross-tenant read refused; dead letter visible to the operator; uniques and CHECKs refuse; no test:remote | DB (CI only) | `npm run typecheck && npm run lint && npx vitest run tests/missed-calls.test.ts` (refuses locally; green in CI) | ❌ W0 (`tests/missed-calls.test.ts` + seed helpers written in this task) | ⬜ pending |
| 11-05-01 | 05 | 3 | CAP-01 | T-11-07 / T-11-08 / T-11-11 | Guards before any provider call; claim before buy; URLs from the one builder; bounded failure codes; orphan logged with the PN sid | unit (pure) | `npx vitest run tests/provision-divert-number.test.ts && npm run typecheck && npm run lint` | ❌ W0 (written in this task) | ⬜ pending |
| 11-05-02 | 05 | 3 | CAP-01, CAP-05 | T-11-05 / T-11-07 / T-11-14 / T-11-15 / T-11-17 | Operator-first before formData; two taps with confirm=buy; proof only for a completed call of this tenant with an active divert; no release control | unit (pure) + build + human-check (end-of-phase) | `npx vitest run tests/divert-provision-action.test.ts tests/proof-actions.test.ts tests/arming-actions.test.ts tests/operator-authorization.test.ts && npm run typecheck && npm run lint` (+ `npx next build`) | ❌ W0 (`tests/divert-provision-action.test.ts` written in this task) | ⬜ pending |
| 11-06-01 | 06 | 3 | CAP-03, CAP-01 | T-11-04 / T-11-14 / T-11-16 | Reader selects no caller column; search is GET-only; verify script only calls the core; e.name only | unit (source pins) + production read-only run | `npx vitest run tests/ops-scripts.test.ts && npm run typecheck && npm run lint && npm run missed-calls:recent -- --tenant not-a-uuid \| grep -q "must be a uuid"` | ✅ (edit of ops-scripts.test.ts) | ⬜ pending |
| 11-06-02 | 06 | 3 | CAP-03, CAP-04, CAP-01 | T-11-09 | Runbook orders restore-then-verify; no real number in the runbook; every Twilio surface INTEGRATE or reasoned OPT-OUT | doc greps | `test $(wc -l < docs/telephony-runbook.md) -ge 150 && grep -c "OPT-OUT" COVERAGE.md ≥ 10 && grep -q ClickSend COVERAGE.md` | ✅ (greps) | ⬜ pending |
| 11-07-01 | 07 | 4 | CAP-01 | T-11-07 | The one-way door is decided by a human; bundle approved; search shows inventory (count only) | checkpoint:decision | precondition: `gh run list --limit 1` success on HEAD; `npm run twilio:numbers-search` exit 0 | ✅ | ⬜ pending |
| 11-07-02 | 07 | 4 | CAP-01, CAP-02, CAP-03, CAP-05 | T-11-07 / T-11-09 / T-11-10 | Console-only purchase; verification row completed via callback; drill row completed via reconcile with no duplicate; no number in the resume | checkpoint:human-action + read-only reader | `npm run missed-calls:recent -- --limit 5 \| grep -c completed` | ✅ | ⬜ pending |
| 11-07-03 | 07 | 4 | CAP-01, CAP-03, CAP-05 | T-11-04 | Evidence entry with identifiers only; no 64-hex, no foreign +61 | doc greps | `grep -c "completed_via reconcile" docs/external-registrations.md ≥ 1 && git show HEAD -- docs/external-registrations.md \| grep -Ec '^\+.*[0-9a-f]{64}' == 0` | ✅ | ⬜ pending |
| 11-08-01 | 08 | 5 | CAP-03, CAP-04 | T-11-01 / T-11-04 | Nine diverted calls with caller_present true and caller_kind mobile; one withheld; no signature_rejected in the window; handset labels only | checkpoint:human-action + read-only reader | `npm run missed-calls:recent -- --limit 20 \| grep -c withheld` | ✅ | ⬜ pending |
| 11-08-02 | 08 | 5 | CAP-03 | T-11-04 | Table built from the reader's output; Phase 12 gate line; no secret, no caller number | doc greps | `grep -c "live divert spike" docs/external-registrations.md ≥ 1 && git show HEAD … 64-hex == 0` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Every suite below is written INSIDE the task that creates the code it pins (the tracer writes its own end-to-end suite; each expansion task writes its suite), so no separate Wave 0 plan exists — the "❌ W0" marks above name the file the task must create before its `<verify>` can run:

- [ ] `tests/twilio-voice-route.test.ts` — CAP-03/CAP-04 (11-01-02); `sign()` oracle with `node:crypto`; mocked env + repository
- [ ] `tests/telephony-greeting.test.ts`, `tests/telephony-webhook-url.test.ts`, `tests/telephony-caller.test.ts` — CAP-02/CAP-04/CAP-03 (11-01-03)
- [ ] `tests/twilio-voice-status-route.test.ts` — CAP-03/CAP-04 (11-02-03)
- [ ] `tests/missed-call-reconcile.test.ts` — CAP-03/CAP-02 (11-03-02); `tests/messaging-reconcile-route.test.ts` RESULT gains two fields
- [ ] `tests/missed-calls.test.ts` (DB, CI only) + `seedDivertNumber` / `seedMissedCall` in `tests/helpers/seed.ts` + both tables in `NO_CASCADE_TABLES` — CAP-01/CAP-03 (11-04-02)
- [ ] `tests/provision-divert-number.test.ts` — CAP-01 (11-05-01); `tests/divert-provision-action.test.ts` — CAP-01/CAP-05 (11-05-02)
- [ ] Edits that break by design, each inside the plan that breaks them: `tests/lint-ban.test.ts` + `tests/sync-upsert.test.ts` (11-01), `tests/go-live-checklist.test.ts` + `tests/onboarding-checklist-gate.test.ts` (13 keys) + `tests/runbook-contract.test.ts` + `tests/rls-coverage.test.ts` + `tests/tenant-proofs.test.ts` (11-04), `tests/proof-actions.test.ts` + `tests/arming-actions.test.ts` mocks (11-05), `tests/ops-scripts.test.ts` (11-06); `tests/helpers/env.ts` REQUIRED (+4) and `.github/workflows/ci.yml` dummies (+4) in 11-01
- [ ] Framework install: none (vitest present); dependency install: `twilio@6.1.1` after the 11-01-01 decision

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Twilio account opened, Recording Configurations empty, AU bundle submitted as a sole trader, keys placed in `.env.local` | CAP-01, CAP-02 (D-04, D-12) | Dashboard-only KYC and settings pages; the executor may not read `.env.local` | 11-02 Task 1 instructions; resume "twilio-ready" with SIDs and dates only |
| Greeting length ≤ 12 s after the 1 s pause (CallDuration ≤ 13) and intelligibility / trade-name pronunciation on a mobile handset (S5) | CAP-02 (D-03) | Only a real call through TTS measures it; a backstop truth in 11-01 and 11-07 | 11-07 Task 2 steps 4–5: dial the number, note perceived length, read `duration_seconds` from `npm run missed-calls:recent`; trim the template via a quick task if over |
| First real purchase from the console; Twilio Console read-back of Voice URL / Status Callback / bundle | CAP-01 (D-08) | Regulated purchase with money; console-only by design; test credentials cannot buy AU numbers | 11-07 Task 1 (decision) then Task 2 steps 1–2 |
| S7: US1 + Sydney edge sees the inbound AU call in Calls list | CAP-03 (D-10) | Needs a real call on the account | 11-07 Task 2 step 7: `npm run verify:missed-call-reconcile` prints `calls listed (inbound, 48h): ≥ 1` |
| Dropped-callback drill: wrong-token Status Callback for one call, reconcile completes the row, no duplicate, URL restored | CAP-03 (success criterion 3) | Twilio does not retry on 5xx/timeout, so the drop must be staged by editing the number's configuration in the Console | 11-07 Task 2 step 8; `completed_via` reads `-` → `reconcile` on the same row id; restore call reads `callback` |
| Three-carrier divert spike (Telstra/Optus/Vodafone × no-answer/busy/unreachable + one #31# call) — CLI survival, withheld marker, ForwardedFrom fill-rate | CAP-03 (success criterion 4, gates Phase 12) | Real carrier networks and handsets; the single assumption the milestone rests on | 11-08 Task 1; evidence table per runbook §10–11; nine mobile rows with `caller_present true`, one `withheld` with `caller_present false` |
| Thirteen-row checklist, divert section and proof form render correctly on a phone; no release control anywhere | CAP-05, CAP-01 | Rendered layout is visual | `<verify><human-check>` blocks in 11-04-01 and 11-05-02, harvested at end-of-phase |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s (pure) / one CI run (DB tier)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
