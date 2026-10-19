---
phase: 11-telephony-capture
plan: 07
subsystem: telephony
tags: [twilio, one-way-door, purchase, verification-call, drill, evidence, s5, s7]
status: complete

requires:
  - phase: 11-telephony-capture
    provides: "11-02 voice + voice-status doors live; 11-03 call-log reconcile; 11-05 console claim-then-buy + divert_verification_call proof arm; 11-06 missed-calls:recent, verify:missed-call-reconcile, telephony runbook"
provides:
  - "One active divert number for the test tenant: PN00000000000000000000000000000000 (+61 8 75…), bundle and address attached, canonical voice/status URLs"
  - "divert_verification_call proof for tenant 13e8f2aa with artefact b79a5f9d-1edb-447c-9f94-8cc991ce2ea1 (12 s, completed_via callback)"
  - "Production proof of success criterion 3: drill row 71284d4a completed by the reconcile, same id, no duplicate"
  - "S7 settled: US1 via the Sydney edge lists the inbound AU calls (3, then 4)"
  - "The 2026-10-02 evidence entry in docs/external-registrations.md"
affects: [11-08, 12-missed-call-text-back]

tech-stack:
  added: []
  patterns:
    - "Evidence entry follows the runbook §11 template; the carrier-spike table is left for 11-08"

key-files:
  created:
    - .planning/phases/11-telephony-capture/11-07-SUMMARY.md
  modified:
    - docs/external-registrations.md
    - .planning/phases/11-telephony-capture/deferred-items.md
    - .planning/STATE.md
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md

key-decisions:
  - "One-way door taken: founder chose buy-perth-local for test tenant 13e8f2aa (2026-10-02). The number is the test tenant's permanently and is never released (D-08). The TwiML Bin fallback was not created"
  - "S5 passed as measured: 12 s against the 13 s limit, intelligible, so no greeting trim. The 'Test.' pause comes from the test tenant's parenthesised name, not from the template"
  - "CAP-01, CAP-02 and CAP-05 marked complete. CAP-03 and CAP-04 stay Pending for 11-08, which lists both; the withheld and diverted-call clauses of CAP-03 only get proven there"

requirements-completed: [CAP-01, CAP-02, CAP-05]

metrics:
  duration: "~15 min executor (Task 3); founder session ~12:35–12:51Z on 2026-10-02"
  completed: 2026-10-02

actuals:
  tokens: 6500
  tasks: 3
  commits: 3
---

# Phase 11 Plan 07: First divert number, verification call, S7 and the dropped-callback drill Summary

**Production now has a real AU number for the test tenant (PN00000000000000000000000000000000), bought from the console. The founder called it and heard a 12 s greeting, and that call is recorded as the `divert_verification_call` proof. The S7 check listed the inbound calls (3, then 4). In the drill a status callback was deliberately broken, and the reconcile then completed that call's row under the same id with no duplicate.**

## What happened

| Task | Outcome | Commit |
|---|---|---|
| 1. One-way-door decision (`checkpoint:decision`, blocking-human) | `buy-perth-local 13e8f2aa-edee-4eb1-b699-09b650674f81`, chosen by the founder on 2026-10-02 after bundle `BU0000…` was approved on 2026-10-01T13:28Z | — (founder) |
| 2. Purchase, verification call, proof, S7, drill (`checkpoint:human-action`) | `purchase-done` | — (founder + orchestrator) |
| 3. Record the evidence | Evidence entry, status table, findings, STATE | `b2877ad`, `969b21f` |

## Evidence (identifiers only)

- **Number:** PN `PN00000000000000000000000000000000`, `+61 8 75…`, friendly name `backdesk-divert-13e8f2aa-…`. Voice and status URLs point at app.backdesk.com.au, both HTTP POST. SMS is empty. Address `AD0000…` and bundle `BU0000…` are attached (the bundle was attached by an API update, see F-11-07-2).
- **Verification call:** row `b79a5f9d-1edb-447c-9f94-8cc991ce2ea1`: completed, 12 s, mobile, caller_present true, forwarded_from_present false, completed_via callback. Proof recorded 2026-10-02T12:46:41Z.
- **S5:** Olivia-Neural en-AU. The greeting is intelligible and hangs up by itself. Perceived length ~12 s, measured 12 s (limit 13 s).
- **S7:** `calls listed (inbound, 48h): 3`, then 4 after the drill. `recordings=0` on every run.
- **Drill:** row `71284d4a-9713-4679-a0de-8ca0fb5c9c85` went from ringing / `completed_via -` to completed / 11 s / `completed_via reconcile`, keeping the same id. The restore call, row `24c72471-cee5-4d71-8995-6c2e1e0e7ba2`, completed via callback in 12 s.
- **Executor read-back:** `missed-calls:recent --limit 10` shows 5 rows with 5 distinct call ids. There are 4 callback rows and 1 reconcile row, and the output contains no `+61`. `cron:status` shows lease 0, watchdog no, all four jobs on the custom domain, and the last five responses were 200.

## Deviations from Plan

### Recorded findings (not auto-fixed: Phase 12 or a quick task owns them)

**1. F-11-07-1: the WA search filter accepts an SA 08 range**
- **Found during:** Task 2 (Console read-back)
- **Issue:** Twilio's search said the locality was Perth, but the Console says "Waikerie, South Australia". D-11-06-1's `+618` filter cannot tell WA from SA or NT.
- **Impact:** None on capture, because callers never dial a divert number. The locality line on the client page may be wrong.
- **Action:** Logged in deferred-items.md and STATE. Tighten the filter before the first real client's purchase.

**2. F-11-07-2: `bundleSid` on create did not attach the bundle**
- **Found during:** Task 2
- **Issue:** Twilio returned `bundle_sid: null` on the new number even though the create call passed `bundleSid`.
- **Fix applied (orchestrator):** At ~12:47Z the bundle was attached by an explicit API update. The read-back now shows it attached.
- **Action:** In Phase 12, verify whether provisioning needs a follow-up assignment plus a read-back.

**3. Plan step 7 expected `recovered=0`, then `recovered=1`**
- The reconcile actually reported 3, then 4. This is the counting rule documented in 11-06 (calls converged in the window). As the runbook says, the row's `completed_via` is the proof, not the count. This was expected, not a defect.

**4. [Rule 1, wording] Acceptance grep**
- The first evidence commit wrote `completed_via=reconcile` and `- → reconcile`, so the plan's literal `completed_via reconcile` grep returned 0.
- **Fix:** Added a plain-words sentence (`969b21f`).

## Requirements

- **CAP-01, CAP-02, CAP-05:** marked complete. The number is provisioned from the console against the tenant and cannot be released. The greeting is at most 12 s with no Record (pinned by `tests/telephony-greeting.test.ts`). The verification call is observed and recorded, and the checklist shows divert health. CAP-05's arming enforcement belongs to TXT-05 in Phase 12.
- **CAP-03, CAP-04:** left Pending for 11-08. The drill proves the dropped-webhook guarantee on production, but CAP-03's diverted and withheld clauses and 11-08's own CAP-04 checks are still open.

## Known Stubs

None.

## Threat Flags

None. No new surface was added, the commit contains no secret (64-hex grep = 0), and the only `+61` strings are the tenant's own number prefix.

## Next

Plan 11-08 is the three-carrier live divert spike (Telstra, Optus, Vodafone, plus a `#31#` withheld call), which gates Phase 12. Before it runs, set Twilio auto-recharge (balance is US$20).

## Self-Check: PASSED

- FOUND: docs/external-registrations.md entry "2026-10-02 — Phase 11: first divert number…"
- FOUND: commits b2877ad, 969b21f
- Acceptance: `completed_via reconcile` = 1, `PN[0-9a-f]{32}` ≥ 1, `calls listed` = 3, 64-hex in HEAD diff = 0, `Phase 11` in STATE ≥ 1
