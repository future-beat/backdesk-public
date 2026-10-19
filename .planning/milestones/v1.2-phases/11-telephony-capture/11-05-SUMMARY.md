---
phase: 11-telephony-capture
plan: 05
subsystem: telephony
tags: [twilio, provisioning, claim-then-buy, server-actions, proofs, vitest]

requires:
  - phase: 11-telephony-capture
    provides: "11-01: tenant_divert_numbers (tenant_id UNIQUE, failure_code CHECK), forTenant().divertNumber, getMissedCallForTenant, twilioWebhookUrl/Host. 11-03: searchAuLocalNumbers/purchaseNumber. 11-04: the thirteen-row checklist, the divert block, the #divert-number fix link, the proof slot switch"
provides:
  - "provision.ts: checkProvisionGuards, findDivertNumberCandidate, provisionDivertNumber, divertFailureCode. Claim-then-buy with closed-union results; nothing throws"
  - "forTenant().divertNumber.reclaim(spokenName): re-claims a failed row (failed to pending), guarded on status = 'failed'"
  - "searchDivertNumberAction / provisionDivertNumberAction / updateSpokenNameAction, plus the DIVERT_* sentences"
  - "divert-number-form.tsx at #divert-number: the two-tap buy, the spoken-name correction, no release control"
  - "recordProofAction third arm: divert_verification_call against a completed, tenant-scoped missed_calls row"
  - "DivertHealth.failureCode on the checklist's divert block"
affects: [11-06, 11-07, 12-missed-call-text-back]

tech-stack:
  added: []
  patterns:
    - "Claim-then-buy: INSERT the pending row (the tenant_id UNIQUE is the arbiter), then the provider call, then activate or fail. A retry is a status-guarded UPDATE, never a second INSERT"
    - "Provider reason codes are mapped onto a closed, CHECK-safe vocabulary before storage (the column admits no digits)"
    - "A 23505 is detected by walking the error's cause chain, because drizzle wraps the driver error"

key-files:
  created:
    - src/core/telephony/provision.ts
    - src/app/(console)/clients/[id]/divert-number-form.tsx
    - tests/provision-divert-number.test.ts
    - tests/divert-provision-action.test.ts
  modified:
    - src/db/repository/for-tenant.ts
    - src/app/(console)/clients/[id]/actions.ts
    - src/app/(console)/clients/[id]/action-state.ts
    - src/app/(console)/clients/[id]/checklist-card.tsx
    - src/app/(console)/clients/[id]/page.tsx
    - src/app/globals.css
    - src/core/onboarding/checklist.ts
    - tests/proof-actions.test.ts
    - tests/arming-actions.test.ts
    - tests/go-live-checklist.test.ts
    - tests/lint-ban.test.ts

key-decisions:
  - "A failed divert row is re-claimed through a new repository method, reclaim(), guarded on status = 'failed', instead of setSpokenName followed by a purchase. Two retry clicks now race the same way two first claims do, and a second refusal lands through fail(), which is guarded on pending"
  - "Refused purchases are stored as closed codes (provider_rejected, provider_auth_refused, number_not_found, provider_rate_limited, provider_unavailable, network_error, sdk_error). The failure_code CHECK is ^[a-z_]{1,32}$, so the plan's literal http_400 would have violated it"
  - "A fifth guard kind, config_unreadable, covers an unreadable server env or unreadable Twilio credentials. It is checked after the four named guards and before any row read"
  - "The search action also validates the spoken name before searching. Operators hear about a bad name before a number is on screen, and the formData parameter is genuinely used"
  - "The candidate's locality travels as a hidden form field, zod-bounded to letters and at most 40 characters, because the purchase response carries no locality"
  - "The DivertNumberForm renders only when the checklist was read. A buy control drawn without knowing the row's state is never shown"

requirements-completed: []

coverage:
  - id: D1
    description: "Guards refuse by name before any provider call; claim strictly before purchase; both URLs from twilioWebhookUrl; uuid friendlyName; no sms URL; 23505 bare and wrapped means in_progress; CHECK-safe failure codes; orphaned_number log line with the sid"
    requirement: CAP-01
    verification:
      - kind: unit
        ref: "tests/provision-divert-number.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "The three actions authorize operator-first and then check membership before reading formData; bad phone, confirm or spoken name are refused before the core; every outcome maps to its sentence; no release path in the source"
    requirement: CAP-01
    verification:
      - kind: unit
        ref: "tests/divert-provision-action.test.ts; tests/operator-authorization.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "Verification-call proof: non-uuid, foreign or unknown id, a non-completed call and a non-active divert row are all refused; artefact_detail holds exactly the eight keys and no +61 value"
    requirement: CAP-05
    verification:
      - kind: unit
        ref: "tests/proof-actions.test.ts#the divert_verification_call artefact is a completed call of THIS client"
        status: pass
    human_judgment: false
  - id: D4
    description: "Divert number section renders on the production client page, pre-filled spoken name, Find button, checklist link lands on it, verification row shows a Missed call id form, no release control"
    requirement: CAP-01
    verification: []
    human_judgment: true
    rationale: "Visual layout and the two-tap flow on a phone. Tapping Find is a live Twilio read the founder does in plan 11-07"

actuals:
  tokens: 26000
  tasks: 2
  commits: 3

duration: 20min
completed: 2026-09-28
status: complete
---

# Phase 11 Plan 05: Divert-number provisioning and the verification-call proof Summary

**Two new controls on the client page:**

- **Buy a divert number.** The operator buys one Perth 08 Twilio number in two taps: Find shows the number, its locality and "about A$3 a month", then Buy confirms. The row is claimed on the `tenant_id` UNIQUE before anything is bought. Configuration guards refuse by name with no Twilio call.
- **Record the verification call.** The operator pastes a missed-call id. The action accepts it only if that row is a completed call of this tenant and the tenant has an active number.

Nothing on the page, in the actions or in the core can release a number.

## Performance

- **Duration:** about 20 min
- **Started:** 2026-09-28T06:23Z (14:23 AWST)
- **Completed:** 2026-09-28T06:43Z
- **Tasks:** 2
- **Files:** 15 (4 created, 11 modified)

## Accomplishments

**Core (`provision.ts`)**
- Four guards run in order before any provider call: base URL, then `twilioWebhookHost === CONSOLE_HOST`, then the bundle SID, then the address SID. A fifth, `config_unreadable`, covers an env or credentials that cannot be read.
- The row state comes next: active returns `already_provisioned`, pending returns `in_progress`.
- The claim is made before anything is bought:
  - no row: `claim` (INSERT)
  - failed row: `reclaim` (a guarded UPDATE)
- One `purchaseNumber` call carries both URLs from `twilioWebhookUrl`, `friendlyName` set to `backdesk-divert-<uuid>`, the bundle and the address. There is no sms URL.
- After the purchase, `activate` records success. `fail` records a refusal with a CHECK-safe code.
- If the fill throws after a successful purchase, the core logs `[telephony] provision orphaned_number <PN sid>`.

**Actions**
- The three actions follow the `armChannelAction` preamble exactly, then validate with zod:
  - phone number: `^\+618\d{8}$`
  - spoken name: trimmed, 1–60 characters, at most 6 words, no control characters
  - confirm: must be `buy`
- Every core kind maps to a sentence from `DIVERT_REFUSAL` or a sentence builder.

**Proof arm**
- `PROOF_CHANNEL` now has a third entry, `divert_verification_call: null`. A null channel swaps the armed gate for a check that `checklist.divert.status` is `active`.
- The id is checked against `UUID_PATTERN`, then read with `getMissedCallForTenant(tenantId, id)`. The call must be `completed`.
- `artefact_detail` holds exactly eight keys: `provider_call_id`, `call_status`, `duration_seconds`, `after_hours`, `caller_kind`, `forwarded_from_present`, `started_at`, `completed_via`.

**Form (`#divert-number`)**
- **No row or a failed row:** a spoken-name input and a Find button. Once Find returns a candidate, a Buy form appears with hidden `phone_number`, `locality`, `spoken_name` and `confirm=buy`. A failed row also shows its failure code above the controls.
- **Pending:** "Purchase in progress — reload in a moment." and no button.
- **Active:** the number in large type, the divert instruction, the spoken-name correction form, and "This number cannot be released while the client is active."

**Card and page**
- The verification row now renders a `ProofRow` labelled "Missed call id", with the runbook hint.
- `LastTapped` is widened to proof slots.
- The page renders `DivertNumberForm` directly above the checklist card.
- The 11-04 known stub (the `#divert-number` link that scrolled nowhere) is resolved.

## Task Commits

1. **Task 1: claim-then-buy provisioning core:** `8701008` (feat)
2. **Task 2: divert-number provisioning form and verification-call proof:** `5e7512a` (feat)

**Plan metadata:** committed with this SUMMARY (docs)

## Verification

- **Pure suites, bare:** 156 tests passed across `provision-divert-number`, `divert-provision-action`, `proof-actions`, `arming-actions` and `operator-authorization`.
- **Neighbouring suites** (with the Twilio dummies inline): 373 tests passed across `lint-ban`, `runbook-contract`, `email-settings-action`, `telephony-*`, `twilio-*`, `missed-call-reconcile` and `brand`.
- **Static checks:** `npm run typecheck` is clean. `npm run lint` (`--max-warnings=0`) is clean. `npx next build` exits 0.
- **Acceptance greps:** all pass. Every count matches the plan, and the `>=` thresholds are met.
- **CI:** run `36387019020` on `5e7512aac5a53d1f137ce3ae6b5b8b3403201c4b` succeeded (typecheck, lint, migrate, test, including the DB suites `go-live-checklist` and `missed-calls`). The push also carried 11-02's two docs commits.
- **Production:** deployment `dpl_Ak7uXCgHpeT8xPoHADGam2iGv9Fb` (backdesk-busqppb7z) is READY, created 14:32:54 AWST, the push time. `https://app.backdesk.com.au/login` returns 200.
- **Live Twilio calls:** none. Nothing was searched or bought. The bundle is pending, and the first search and purchase belong to plan 11-07's founder checkpoint.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Failure codes mapped to the column's CHECK vocabulary**
- **Found during:** Task 1
- **Issue:** `tenant_divert_numbers_failure_code_shape` is `^[a-z_]{1,32}$`, which allows no digits. The plan's `fail({ failureCode: 'http_400' })` would have raised a CHECK violation on every refused purchase. That throw was caught and logged, and it left the row stuck at `pending`, which reads as "in progress" forever.
- **Fix:** `divertFailureCode(reason)` maps each client reason onto a closed code (for example `http_400` becomes `provider_rejected`). The test pins the mapping, and pins that `fail` receives a CHECK-safe code.
- **Files:** src/core/telephony/provision.ts, tests/provision-divert-number.test.ts
- **Commit:** 8701008

**2. [Rule 2 - Correctness] A failed-row retry is claim-guarded (`reclaim`)**
- **Found during:** Task 1
- **Issue:** The plan's "failed means reuse the row (skip claim), setSpokenName, then purchase" had two gaps:
  - Two retry clicks would both reach `purchase`, which is a double buy.
  - `fail` is guarded on `status = 'pending'`, so a second refusal would not record its code.
- **Fix:** Added `divertNumber.reclaim(spokenName)`: `UPDATE … SET status='pending', failure_code=NULL, spoken_name=$1 WHERE tenant_id=$t AND status='failed' RETURNING`. Zero rows returned means `in_progress`. This is the "UPDATE … WHERE status='failed'" retry that RESEARCH Pattern 4 describes. There is still no delete or release method.
- **Files:** src/db/repository/for-tenant.ts, src/core/telephony/provision.ts
- **Commit:** 8701008

**3. [Rule 1 - Bug] 23505 detected through drizzle's wrapper**
- **Found during:** Task 1
- **Issue:** drizzle 0.45 wraps driver errors in `DrizzleQueryError`, and the SQLSTATE sits on `.cause`. A bare `error.code === '23505'` check would have reported a lost claim race as `claim_failed`.
- **Fix:** The core walks the cause chain, the same way `generate.ts` does. The suite covers both a bare 23505 and a wrapped one.
- **Commit:** 8701008

**4. [Rule 2 - Missing critical] The new client form is pinned in lint-ban's client-boundary guard**
- **Found during:** Task 2
- **Issue:** `divert-number-form.tsx` is one import away from a module that reaches both the repository and the Twilio REST client.
- **Fix:** Added it to `CLIENT_REACHABLE`, in the same way `escalation-phone-form.tsx` is pinned.
- **Commit:** 5e7512a

**5. [Rule 3 - Blocking] `divert.failureCode` added to the checklist core; the DB test's `toEqual` updated**
- **Found during:** Task 2
- **Issue:** The plan anticipated this change. The go-live-checklist DB suite's exact `toEqual` on the bare divert block needed the new key.
- **Fix:** Added the key to the core and updated the test, plus a `bundle_rejected` read-back assertion. CI ran it green.
- **Commit:** 5e7512a

Minor additions:
- Six extra sentences: `divertAlreadyProvisionedMessage`, `divertSearchFailedMessage`, `DIVERT_SPOKEN_NAME_NO_NUMBER_MESSAGE`, `DIVERT_CONFIRM_MESSAGE`, `config_unreadable`, and `base_url_unset`/`address_missing` wording.
- One CSS class, `.divert-number`, for the large-type number.

## Known Stubs

| File | Line | Reason |
|------|------|--------|
| src/app/(console)/clients/[id]/action-state.ts | DIVERT_ORPHANED_MESSAGE | Points to `docs/telephony-runbook.md`, which plan 11-06 writes |

## Threat Flags

None beyond the plan's register. T-11-07, T-11-11, T-11-08, T-11-15, T-11-14, T-11-17 and T-11-05 are each mitigated as specified and pinned by the suites above.

## Self-Check: PASSED

- FOUND: src/core/telephony/provision.ts, src/app/(console)/clients/[id]/divert-number-form.tsx, tests/provision-divert-number.test.ts, tests/divert-provision-action.test.ts
- FOUND: 8701008, 5e7512a
