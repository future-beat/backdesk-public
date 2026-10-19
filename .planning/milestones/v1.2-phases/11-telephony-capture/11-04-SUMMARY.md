---
phase: 11-telephony-capture
plan: 04
subsystem: telephony
tags: [checklist, divert-health, rls, grants, vitest, supabase, drizzle]

requires:
  - phase: 11-telephony-capture
    provides: "11-01 — tenant_divert_numbers, missed_calls, tenant_proofs kind divert_verification_call (migration 0038, unpushed); forTenant().divertNumber/.missedCalls; the missed-calls repository family"
  - phase: 10-first-client-go-live
    provides: the eleven-item go-live checklist, ProofRecord/escalationHandsetProof date rule, tenant_proofs DB-suite mould, runbook contract test
provides:
  - thirteen-key readGoLiveChecklist (divertNumber, divertVerified appended after emailPipeProof) with proofs.divertVerification and a read-time divert block (numberE164, status, spokenName, lastCallAt, daysSinceLastCall)
  - "Ready to send?" card rows "Divert number provisioned" / "Verification call recorded", the #divert-number fix link, and the "No diverted call yet." / "Last diverted call … — N days ago" health line
  - tests/missed-calls.test.ts — CI-only DB proof of the arbiter, CHECKs, two-arm RLS, SELECT-only grants and both UNIQUEs
  - seedDivertNumber / seedMissedCall; both tables in NO_CASCADE_TABLES; seedProof widened to three kinds
  - rls-coverage grants pins and tenant-proofs third-kind pin
affects: [11-02, 11-05, 11-06, 12-missed-call-text-back]

actuals:
  tokens: 13200
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Read-path health derivation: days since the last diverted call computed from missedCalls.latest() via attestationAgeDays (the one floored whole-24h rule), never stored"
    - "Proof slot union (ArmChannel | 'divert') for badge composition, with the proof FORM rendered only for slots whose action arm exists"
    - "Grant refusal asserted as 42501 + 'permission denied' (grant absent), distinct from an RLS WITH CHECK refusal"

key-files:
  created:
    - tests/missed-calls.test.ts
  modified:
    - src/core/onboarding/checklist.ts
    - src/app/(console)/clients/[id]/checklist-card.tsx
    - src/app/(console)/clients/[id]/page.tsx
    - tests/go-live-checklist.test.ts
    - tests/onboarding-checklist-gate.test.ts
    - tests/runbook-contract.test.ts
    - docs/first-client-go-live-runbook.md
    - tests/helpers/seed.ts
    - tests/rls-coverage.test.ts
    - tests/tenant-proofs.test.ts

key-decisions:
  - "The two divert rows gate nothing this phase: ARMING_GATES and firstUnmetGate untouched (git diff --quiet on arming.ts), pinned by a DB case where a divert-less client still opens the SMS gate (D-09)"
  - "daysSinceLastCall reuses attestationAgeDays (floored whole 24-hour periods); calendar days in the tenant zone rejected because the core is framework-free and formats no dates"
  - "divertVerified badge reads 'verified on {date} · {missed_calls id}'; its proof form is NOT rendered until plan 11-05 adds the action arm (ACTION_PROOF_KINDS still narrows to two kinds)"
  - "The three divert reads join the existing twelve in the one Promise.all (fifteen reads), per the plan; the pool-ceiling note is cross-referenced in the doc comment"
  - "tenant-proofs' unknown-kind pin now uses 'text_back' — the kind Phase 12 will add — so that pin goes red on purpose then"

requirements-completed: []

coverage:
  - id: D1
    description: "readGoLiveChecklist returns thirteen keys in fixed order; divert rows appended after emailPipeProof; ARMING_GATES untouched"
    requirement: CAP-05
    verification:
      - kind: unit
        ref: "tests/go-live-checklist.test.ts#renders thirteen keys; tests/onboarding-checklist-gate.test.ts#renders THIRTEEN items"
        status: pending
      - kind: other
        ref: "git diff --quiet HEAD -- src/core/onboarding/arming.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "divertNumber satisfied only when active (detail = number); pending/failed name their state; divertVerified from a divert_verification_call proof; days since last call floored and derived at read time"
    requirement: CAP-05
    verification:
      - kind: unit
        ref: "tests/go-live-checklist.test.ts#the divert rows read their facts"
        status: pending
    human_judgment: false
  - id: D3
    description: "Arbiter idempotency, callback/reconcile convergence, operator-JWT write refusals, two-arm RLS incl. dead letters, CHECKs, both UNIQUEs, latest() tiebreak"
    requirement: CAP-03
    verification:
      - kind: unit
        ref: "tests/missed-calls.test.ts"
        status: pending
    human_judgment: false
  - id: D4
    description: "SELECT-only grants for anon/authenticated on both new tables; tenant_proofs accepts divert_verification_call and refuses text_back"
    requirement: CAP-01
    verification:
      - kind: unit
        ref: "tests/rls-coverage.test.ts#grants exactly the documented privileges; tests/tenant-proofs.test.ts"
        status: pending
    human_judgment: false
  - id: D5
    description: "Thirteen rows on a phone-width client page, last two 'Divert number provisioned' / 'Verification call recorded', 'No diverted call yet.' beneath"
    requirement: CAP-05
    verification: []
    human_judgment: true
    rationale: "Visual row order and copy on the rendered page; checked on production after wave 3 deploys"

duration: 11min
completed: 2026-09-28
status: complete
---

# Phase 11 Plan 04: Divert health on the checklist and the telephony tables proven at the database Summary

**The go-live checklist grows from eleven to thirteen rows. "Divert number provisioned" is met only by an active number, and "Verification call recorded" is met by a divert_verification_call proof. Under the second row, a health line shows the date of the last diverted call and how many days ago it was, derived from missedCalls.latest() when the page is read and never stored. A CI-only DB suite pins the missed_calls arbiter, the CHECK vocabularies, the two-arm RLS, the SELECT-only grants and both tenant_divert_numbers UNIQUEs. ARMING_GATES is untouched.**

## Performance

- **Duration:** about 11 min
- **Started:** 2026-09-27T16:52Z (2026-09-28 00:52 AWST)
- **Completed:** 2026-09-27T17:03Z
- **Tasks:** 2
- **Files modified:** 11 (1 created)

## Accomplishments

- **Core (`checklist.ts`):**
  - `CHECKLIST_ITEM_KEYS` gains `divertNumber` and `divertVerified` after `emailPipeProof`. The ORDER comment explains that neither gates anything until Phase 12.
  - Three reads join the fan-out: `divertNumber.get()`, `proofs.latest('divert_verification_call')` and `missedCalls.latest()`, bringing it to fifteen.
  - New `DivertHealth` interface. `GoLiveChecklist` gains `proofs.divertVerification` and `divert`.
  - `daysSinceLastCall` is `attestationAgeDays(lastCallAt, now)`.
  - Every mention of the old count is updated. `grep eleven` returns 0.
- **Card:**
  - Two labels, taken verbatim from the plan.
  - `ITEM_FIX.divertNumber` points to `#divert-number` ("Provision it →"), and `divertVerified: null`.
  - The proofChannel switch gets a third `'divert'` arm, and its badge reads `verified on {date} · {id}`.
  - `DivertHealthLine` shows "No diverted call yet." or `Last diverted call {date} — today / 1 day ago / N days ago`.
  - No form and no button.
- **Page:** formats the verification date (`dateStyle: 'medium'`) and the last-call instant (medium date + short time) with `formatInTenantZone` in the tenant's zone. The comment now says FIFTEEN.
- **Runbook:** new subsection "Divert rows (v1.2, Phase 11)" under "What each proof is and is not". It names both labels and points to `docs/telephony-runbook.md`. The contract test lists thirteen labels.
- **DB suite (`tests/missed-calls.test.ts`, 659 lines):** covers cases (a)–(i) as planned. Two design points:
  - Grant refusals are asserted as `42501` plus "permission denied", so a policy refusal would not pass.
  - UPDATE and DELETE accept both denial shapes, then re-read the row through the service role.
- **Seed and pins:**
  - `seedDivertNumber` and `seedMissedCall` added, and both tables are in `NO_CASCADE_TABLES` with the dead-letter caveat.
  - rls-coverage covers both tables in the IN-list, with four grant rows and a comment paragraph.
  - tenant-proofs round-trips the third kind and refuses `text_back`.
  - go-live-checklist gains six divert cases: bare, active, pending/failed, verified, floored days, and "gates nothing".

## Task Commits

1. **Task 1: thirteen checklist items and divert health on the client page:** `033eadb` (feat)
2. **Task 2: DB suite, seed helpers, RLS and proof-kind pins:** `89877e3` (test)

**Plan metadata:** committed with this SUMMARY (docs)

## Verification

- `npm run typecheck`: clean. `npm run lint` (`--max-warnings=0`): clean.
- Pure suites run with the four Twilio dummies inline: `runbook-contract`, `proof-actions`, `arming-actions`, `lint-ban` and `email-settings-action` all passed (185 tests across the runs).
- `npx vitest run tests/missed-calls.test.ts` refuses locally as expected: "Refusing to run integration tests against a non-local Supabase stack".
- `git diff --quiet HEAD -- src/core/onboarding/arming.ts` exits 0.
- **CI run id: NOT YET AVAILABLE.** This plan does not push, and `db:migrate` was not run. The green CI run for the DB suites (`missed-calls`, `rls-coverage`, `go-live-checklist`, `onboarding-checklist-gate`, `tenant-proofs`) comes with the wave-3 push after 11-02's production push. Record the run id there.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The seeded divert number now uses a seven-digit stamp instead of six**
- **Found during:** Task 2
- **Issue:** The plan's `'+6189' + a six-digit stamp` has eight digits after `+61`. The `tenant_divert_numbers_number_shape` CHECK (`^[+]61[0-9]{9}$`) would have refused every seed.
- **Fix:** The stamp is now seven digits, `(Date.now() + seq) % 1e7`, with a process-monotonic counter so two seeds in one millisecond do not collide on the UNIQUE.
- **Files modified:** tests/helpers/seed.ts
- **Commit:** 89877e3

**2. [Rule 1 - Bug] The divertVerified row renders no ProofRow form**
- **Found during:** Task 1
- **Issue:** Adding `'divert'` to the proofChannel switch would have sent the divert row through `ProofRow`. `ProofRow` maps only sms and email to a kind, so the divert row would have posted an email_pipe_proof form. The plan also says "no form, no button".
- **Fix:** The switch returns a `ProofSlot` (`ArmChannel | 'divert'`), which drives the badge. A separate `formChannel` narrows back to `ArmChannel` for the form. Plan 11-05 adds the divert form together with its action arm.
- **Files modified:** src/app/(console)/clients/[id]/checklist-card.tsx
- **Commit:** 033eadb

Minor test-design choice: the refusal rows in the (h) block use a random `+6188…` number, so a time stamp cannot collide with the seeded number and turn a CHECK refusal into a UNIQUE one.

## Known Stubs

| File | Line | Reason |
|------|------|--------|
| src/app/(console)/clients/[id]/checklist-card.tsx | ~111 | `ITEM_FIX.divertNumber` links to `#divert-number`. That anchor arrives with the provisioning form in plan 11-05. Until then the link scrolls nowhere. Intentional, per the plan. |
| docs/first-client-go-live-runbook.md | "Divert rows (v1.2, Phase 11)" | Points to `docs/telephony-runbook.md`, which plan 11-06 writes. |

## Threat Flags

None. No new network endpoint, auth path or schema. The card shows the tenant's own Twilio number and a missed_calls id, and never a caller number (T-11-04).

## Self-Check: PASSED

- FOUND: tests/missed-calls.test.ts, src/core/onboarding/checklist.ts, src/app/(console)/clients/[id]/checklist-card.tsx, .planning/phases/11-telephony-capture/11-04-SUMMARY.md
- FOUND: 033eadb, 89877e3
