---
phase: 01-foundation-tenancy
plan: 01
subsystem: infra
tags: [servicem8, clicksend, twilio, sms, oauth, ipnd, acma, vendor-registration]

# Dependency graph
requires: []
provides:
  - "docs/external-registrations.md — dated evidence log for both external lead-time clocks"
  - "ServiceM8 Development Partner registration submitted (Phase 2 OAuth/webhook clock started)"
  - "Committed ServiceM8 fallback: per-client private API key (X-API-Key) + edit_date polling"
  - "Committed ClickSend fallback: Twilio AU regulatory bundle, triggered at the 2026-09-01 check"
  - "Identified root blocker for AU SMS: no IPND-acceptable Australian business address"
affects: [02-servicem8-sync, 04-messaging-sms, phase-4-planning]

actuals:
  tokens: 1480
  tasks: 3
  commits: 2

tech-stack:
  added: []
  patterns:
    - "External registrations tracked as dated, committed evidence with an explicit fallback trigger per item"

key-files:
  created:
    - docs/external-registrations.md
  modified: []

key-decisions:
  - "Recorded the ClickSend AU number as Blocked rather than Submitted — the IPND street-address requirement stopped the purchase, and overstating it would hide a Phase 4 critical-path risk"
  - "Named the missing AU business address (not the SMS provider) as the root blocker: Twilio's AU regulatory bundle requires a verified AU address too, so provider-switching does not resolve it"
  - "Did not mark ONB-02 / MSG-01 complete — this plan starts vendor clocks and ships no code for either requirement (per the plan's own frontmatter note)"
  - "Left .gitignore creation to Plan 01-02, which explicitly owns it via create-next-app scaffolding"

patterns-established:
  - "Evidence-log pattern: each external dependency gets Submitted / Account-ID / Status / Next check / Fallback trigger lines, greppable and committed"

requirements-completed: []
# ONB-02 (Phase 2) and MSG-01 (Phase 4) appear in the plan's `requirements` field only to name
# the requirements whose lead-time clocks this plan starts. Neither is implemented here, so
# neither is marked complete — MSG-01 in particular is now blocked (see Deviations).

coverage:
  - id: D1
    description: "docs/external-registrations.md records both registrations with dates, non-secret identifiers, status, next check, and fallback trigger"
    verification:
      - kind: other
        ref: "test -f docs/external-registrations.md && [ \"$(grep -c 'Submitted:' docs/external-registrations.md)\" -ge 2 ] && grep -q 'Fallback trigger:' docs/external-registrations.md"
        status: pass
      - kind: other
        ref: "secret-material grep over docs/external-registrations.md (api key / secret / password / token-shaped strings)"
        status: pass
    human_judgment: false
  - id: D2
    description: "ServiceM8 Development Partner registration submitted, starting the Phase 2 OAuth/webhook approval clock"
    requirement: ONB-02
    verification: []
    human_judgment: true
    rationale: "Vendor-side state with no automated probe; evidence is the operator's report plus the ServiceM8 developer dashboard. App ID not yet reported, so even the operator confirmation is incomplete."
  - id: D3
    description: "ClickSend dedicated AU virtual number ordered, starting the Phase 4 SMS provisioning clock"
    requirement: MSG-01
    verification: []
    human_judgment: true
    rationale: "NOT achieved — the order is blocked on the IPND street-address requirement. A human must confirm the support outcome and the address solution; no automation can clear this."

# Metrics
duration: 10min
completed: 2026-08-25
status: complete
---

# Phase 1 Plan 01: External Registrations Summary

**Both vendor lead-time clocks started and logged with committed fallback triggers — ServiceM8 partner registration submitted, ClickSend's AU number blocked on an IPND street-address requirement that also gates the Twilio fallback**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-08-25T03:05:57Z
- **Completed:** 2026-08-25T03:10:00Z
- **Tasks:** 3 of 3
- **Files modified:** 1 created

## Accomplishments

- **ServiceM8 Development Partner registration submitted** (operator-reported 2026-08-25), starting the Phase 2 OAuth/webhook clock. App ID not yet issued/reported; the App Secret is in the operator's secret store and never entered the repo.
- **ClickSend clock started, and the real constraint surfaced early:** the AU dedicated-number purchase is blocked because ClickSend requires an Australian street address in IPND format (no PO boxes) and the operator has no physical AU business address. Support ticket open since 2026-08-25.
- **`docs/external-registrations.md` created** as the dated, greppable evidence log — Submitted / Account-ID / Status / Next check / Fallback trigger per registration, with zero secret material.
- **Both fallbacks are committed, not hypothetical:** per-client ServiceM8 private API keys (`X-API-Key`) + `edit_date` polling for Phase 2; Twilio AU regulatory bundle at the calendared 2026-09-01 (+5 business days) check for Phase 4.
- **Root blocker named and escalated:** because Twilio's AU regulatory bundle also requires a verified AU address, switching providers does not unblock SMS. An IPND-acceptable business address is the actual dependency, with candidate solutions documented.

## Task Commits

1. **Task 1: Submit ServiceM8 Development Partner registration** — no commit (human-action checkpoint; evidence recorded in Task 3's artifact)
2. **Task 2: Order dedicated AU virtual number at ClickSend** — no commit (human-action checkpoint; blocked outcome recorded in Task 3's artifact)
3. **Task 3: Write docs/external-registrations.md evidence log** — `0918986` (docs)

**Plan metadata:** see final `docs(01-01)` commit.

## Files Created/Modified

- `docs/external-registrations.md` — evidence log for both external lead-time clocks: submission dates, non-secret identifiers, observed status, next-check dates, fallback triggers, and the root-blocker analysis for the AU address requirement.

## Decisions Made

- **Status recorded as Blocked, not Submitted, for ClickSend.** The plan's must-have truth expects a submitted number order. It was attempted and refused. Recording it as submitted would have satisfied the checklist while hiding a Phase 4 critical-path risk, which is precisely the failure this evidence log exists to prevent.
- **Root-cause framing over provider framing.** The documented Twilio fallback was inherited from research assumption A3, which requires an AU address + ABN proof. Recording "Twilio is the fallback" without noting that it hits the same address wall would have handed Phase 4 a fallback that cannot fire. The doc now flags this explicitly and lists address-solution candidates.
- **`requirements-completed: []`.** Marking ONB-02/MSG-01 complete would corrupt traceability — no code shipped for either, and MSG-01 is now blocked.
- **`.gitignore` deliberately not created.** Plan 01-02 owns it (its scaffold step runs `create-next-app` and explicitly ensures `.env.local` coverage); creating one now risks a collision. Logged as a watch item below.
- **Operator-reported dates used verbatim (2026-08-25) with the log-write date (2026-08-25 AWST) recorded in the file header,** so the one-day discrepancy between the operator's report and the machine clock is visible rather than silently reconciled.

## Deviations from Plan

### Unmet must-have (not auto-fixable)

**1. [Rule 4 — External blocker] ClickSend AU virtual number order could not be submitted**

- **Found during:** Task 2 (human-action checkpoint, resolved from operator evidence)
- **Issue:** The plan's must-have truth states "ClickSend account is created and a dedicated AU virtual number order is submitted." The order was attempted and refused: ClickSend requires an Australian street address in IPND format (no PO boxes; ACMA verification applies), and the operator has no physical Australian business address. The documented fallback (Twilio AU regulatory bundle) requires a verified AU address as well, so it does not route around the blocker.
- **Handling:** Not auto-fixable — no code or configuration change can produce a registrable street address. Recorded truthfully in `docs/external-registrations.md` with the blocked status, the open support ticket, the calendared +5-business-day check (2026-09-01), and a "Root blocker" section listing address-solution candidates (ASIC registered address, IPND-acceptable virtual office, accountant/registered-agent address, residential address). Escalated as a STATE.md blocker and logged to the defect ledger as an unmet truth.
- **Files modified:** `docs/external-registrations.md`
- **Committed in:** `0918986`

**2. [Rule 2 — Missing critical information] Added root-blocker analysis beyond the plan's fallback text**

- **Found during:** Task 3
- **Issue:** The plan's prescribed fallback content would have documented Twilio as the ClickSend fallback without noting that both providers require the same AU address verification — leaving Phase 4 with a fallback that cannot fire.
- **Fix:** Added the "Root blocker: no registered Australian business address" section with candidate solutions, an owner, and a needed-by date (2026-09-01).
- **Verification:** Grounded in research assumption A3 (Twilio bundle requires business name, AU address, ABN + proof docs).
- **Committed in:** `0918986`

### Partial completion

**3. ServiceM8 App ID not yet recorded.** The plan's must-have truth requires "any issued App ID recorded." The operator reported registration submitted but not the Public Application creation or App ID issuance. Research assumption A1 expects immediate issuance on save. The doc carries an explicit placeholder line and a 2026-08-26 next-check to close this. Not blocking — the private-API-key fallback bridges Phase 2 regardless.

---

**Total deviations:** 1 unmet must-have (external blocker, escalated), 1 Rule 2 addition, 1 partial completion tracked with a next-check date.
**Impact on plan:** The plan's artifact deliverable is complete and verified. One of its two clock-start truths is only partially satisfied and one is blocked by an external constraint that no amount of execution could clear. Phase 1's remaining plans (01-02 through 01-04) are unaffected — they build the repo/tenancy foundation and do not depend on either vendor.

## Issues Encountered

- **Date discrepancy:** the operator reported both actions as occurring on 2026-08-25 while the machine clock reads 2026-08-25 AWST. Resolved by recording the operator-reported dates as the clock start and the log-write date in the file header, so the audit trail shows both rather than picking one silently.
- **No automated probe exists** for either vendor's state — by design for this plan; evidence is the committed log, which is what the T-01-03 repudiation mitigation calls for.

## Watch Items (not fixed — out of scope)

- **`.env.local` is untracked and the repo has no `.gitignore` yet.** No secret is at risk of being committed by this plan (only explicit paths were staged, per the commit protocol), and Plan 01-02 explicitly creates `.gitignore` with `.env.local` / `.env*.local` coverage as part of its scaffold. Flagged so it is not lost if 01-02's scaffold step is reordered.

## User Setup Required

Two open operator actions, both already tracked in `docs/external-registrations.md`:

1. **By 2026-08-26** — create the ServiceM8 Public Application (Account → Developer → "Add Item"), then record the App ID on the `Account/ID:` line. Keep the App Secret in the secret store; do not paste it into the repo or chat.
2. **By 2026-09-01** — check the ClickSend support response. If still unprovisioned, submit the Twilio AU regulatory bundle **and** progress an IPND-acceptable Australian business address, which is the binding constraint for both providers.

## Next Phase Readiness

- **Phase 1 continues unblocked.** Plans 01-02 (repo scaffold + tenancy), 01-03, and 01-04 have no dependency on either vendor registration.
- **Phase 2 (ServiceM8 sync) is safe either way** — the private-API-key + `edit_date`-polling bridge needs no partner approval, and the STACK.md variant plan already treats polling as the week-1 path.
- **Phase 4 (SMS) carries a live blocker.** No AU virtual number can be provisioned at either ClickSend or Twilio until the operator secures an IPND-acceptable Australian business address. This should be resolved well before Phase 4 planning; it is now a STATE.md blocker rather than an assumed-scheduled item.

## Self-Check: PASSED

- `docs/external-registrations.md` — FOUND
- `.planning/phases/01-foundation-tenancy/01-01-SUMMARY.md` — FOUND
- Commit `0918986` — FOUND in git log
- Task 3 automated verify — PASS (`Submitted:` count = 2, `Fallback trigger:` present)
- Secret-material scan of the committed doc — PASS (no key/secret/password-shaped strings)

---
*Phase: 01-foundation-tenancy*
*Completed: 2026-08-25*
