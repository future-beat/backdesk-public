---
phase: 13-lead-cadence-labels-escalation
plan: 06
subsystem: escalation passes / cadence tick / contact window
status: complete
tags: [after-hours-hold, ring-twice, held-release, next-window-open, escalation, d-07, d-08, d-09, lead-03]
requires:
  - 13-01 escalations.hold_until/released_at, tenants.after_hours_escalation, RING_TWICE_WINDOW_MINUTES
  - 13-03 claimEscalation/claimEscalationForMissedCall with holdUntil, claimHeldEscalationRelease, listUnescalatedRingTwiceCalls, inbound.byIdForEscalation, the (is_hot OR keyword_hot) hot scan with urgency/keywordHot/leadId
  - 13-04 keyword_hot at the door, emergency urgency on is_hot, the label-effects pass ahead of escalation
  - 13-05 the switch in the console and the digest's held line (reads hold_until)
provides:
  - nextWindowOpen (window.ts) — the window's START minute on the next allowed day, or from itself when inside
  - hold.ts — shouldHoldEscalation (D-09 truth table), isImmediateEscalation, escalationHoldUntil
  - the D-09 hold inside escalateHotLeads (lead replies only; held count)
  - escalateRingTwiceCalls (ring-twice.ts) and releaseHeldEscalations (release-held.ts)
  - buildRingTwiceEscalationSms (message.ts)
  - nine tick counts, enumerated in run-tick and mirrored by the route
affects:
  - 13-07 first CI runs of tests/escalation-lead.test.ts and tests/ring-twice.test.ts, plus the edited exact-shape pins in tests/cadence-tick.test.ts and tests/escalation.test.ts
tech-stack:
  added: []
  patterns:
    - "A hold is a claim: the decision is made before the claim and rides on it as hold_until, so a held row leaves the scan at once"
    - "Release-is-the-claim: one guarded UPDATE, facts read afterwards through the narrow reads, never retried"
    - "Immediate rows exempt from still-held rows in the cooldown read; every other caller unchanged (optional third argument)"
key-files:
  created:
    - src/core/escalation/hold.ts
    - src/core/escalation/ring-twice.ts
    - src/core/escalation/release-held.ts
    - tests/escalation-hold.test.ts
    - tests/escalation-passes.test.ts
    - tests/escalation-lead.test.ts
    - tests/ring-twice.test.ts
  modified:
    - src/core/cadence/window.ts
    - src/core/cadence/dispatch.ts
    - src/core/escalation/escalate-hot-leads.ts
    - src/core/escalation/message.ts
    - src/core/cadence/run-tick.ts
    - src/app/api/internal/cadence-tick/route.ts
    - src/db/repository/escalations.ts
    - src/db/repository/missed-calls.ts
    - tests/escalation-message.test.ts
    - tests/cadence-tick-route.test.ts
    - tests/cadence-tick.test.ts
    - tests/escalation.test.ts
key-decisions:
  - "Only a lead reply that would otherwise SEND is held: no phone, disarmed and cooling are recorded at once as before; quote rows are never evaluated"
  - "An immediate lead reply (emergency or keyword) does not count a still-held row in its cooldown — the held alert has reached nobody; every other cooldown read counts it as before"
  - "The release refuses lead_closed only when the lead closed AFTER the hold was claimed; a lead its own reply's label closed in the claiming tick is still told"
  - "The release sends to the to_address the hold recorded (normalised again) and re-asks resolveSmsFrom; it does not re-read the tenant's phone"
  - "Ring-twice message: 'A caller rang twice in {N} minutes and was missed.' + 'Call them:' line; minutes passed in so message.ts imports only the shared counter"
  - "Tick order: hot-lead → quote-call → ring-twice → release, all on escalationSender"
metrics:
  duration: "~25 min"
  completed: 2026-10-08
  tasks: 3
  files: 19
estimate:
  tokens: 75000
  tasks: 3
actuals:
  tokens: 30900
  tasks: 3
  commits: 3
requirements-completed: [LEAD-03]
---

# Phase 13 Plan 06: After-hours hold, ring-twice and the held-escalation release Summary

Hot leads now reach the tradie's escalation phone through the existing claim-then-send path, and that path obeys two new rules.

- **After-hours hold (D-09).** A hot lead reply that is outside the client's contact window, from a client whose after-hours switch is off, and is neither emergency urgency nor a keyword hit, is claimed with `hold_until` set to the window's next opening. Nothing is sent. A new release pass sends it once when the window opens. Emergency and keyword replies go at once whatever the hour and the switch.
- **Ring-twice (D-07).** A second missed call from the same mobile within 30 minutes, at a client where the caller has an open lead, is escalated once. The claim is keyed on the second call's id. The caller gets no second text. A ring-twice obeys the hold rule like any non-emergency trigger.

## Tasks

| # | Task | Commit | Key files |
|---|------|--------|-----------|
| 1 | The hold rule: nextWindowOpen, shouldHoldEscalation, the lead hold inside escalateHotLeads, the ring-twice message builder | `9fa26e1` | window.ts, hold.ts, escalate-hot-leads.ts, message.ts, escalation-hold / escalation-message tests |
| 2 | Ring-twice and release as tick passes, nine counts in three places | `eafa859` | ring-twice.ts, release-held.ts, run-tick.ts, route.ts, escalation-passes / cadence-tick-route tests |
| 3 | DB-backed proofs (CI only) | `650d33b` | tests/escalation-lead.test.ts (573 lines), tests/ring-twice.test.ts (393 lines) |

## Final tick pass order (escalation tail)

`runEscalationPass` (hot leads, with the D-09 hold) → `runQuoteCallEscalationPass` → `runRingTwiceEscalationPass` → `runReleaseHeldEscalationsPass` → text-back alerts → balance → aging. All four escalation passes ride `escalationSender`. Undefined means none of them scans, claims or releases.

## The nine counts, as the route names them

`escalationHeld`, `ringTwiceEscalated`, `ringTwiceHeld`, `ringTwiceSuppressed`, `ringTwiceRefused`, `ringTwiceFailed`, `escalationReleased`, `escalationReleaseRefused`, `escalationReleaseFailed`.

The route test pins each with a distinct value (41 to 49) and adds the names to the exact key set. The DB `cadence-tick.test.ts` exhaustive pin lists them as zeros.

## Verification (local)

- Task 1 verify: escalation-hold, escalation-message, cadence-window, cadence-rewindow passed (464 tests). Typecheck and lint exit 0. The pins (`cadence-window`, `sync-upsert`, `report-metrics`, `cron-schedules`, `apply-cron-schedules.mjs`) are byte-identical to the plan base `cd68bf1`.
- Task 2 verify: escalation-passes, cadence-tick-route, cadence-tick-isolation, escalation-hold, escalation-message passed (450 tests). `quote-call.ts` is byte-identical to the plan base.
- Task 3 verify: typecheck, lint, escalation-hold and escalation-passes passed (60 tests). No command set `ALLOW_REMOTE_TESTS`.
- Wider check: every test file that imports neither the seed helper nor `closeDb` was run from an explicit list. 116 files and 4609 tests passed. Three files failed at the environment guard (`cron-schedules`, `rls-coverage`, `remote-test-watchdog`). They are DB-backed by `migrateDatabaseUrl` and refuse a non-local target by design. This is not a regression.
- Acceptance greps all pass:
  - `export function nextWindowOpen` 1; `export function shouldHoldEscalation` 1
  - hold, window and holdUntil references in escalate-hot-leads.ts: 4 or more; `afterHoursEscalation`: 1 or more
  - `buildRingTwiceEscalationSms` 1; `ESCALATION_COOLDOWN_MINUTES = 30` 1
  - `recentEscalationForCadence` in release-held.ts: 0
  - the count names across run-tick, the route and the route test: 9 or more
  - escalation-lead.test.ts: 573 lines, `hold_until` 19, `released_at` 12, `lead_closed` 3, `keyword_hot` 6, `HOT_ESCALATION_CAP` 9
  - ring-twice.test.ts: 393 lines, `missed_call_id` 7, `ringTwiceHeld` 3, `cooldown_suppressed` 3

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1, bug] An emergency after a held reply on the same lead would have been cooled down until morning.**
- **Found during:** Task 1.
- **Issue:** `recentEscalationForCadence` counts every row created in the last 30 minutes, including a held row that has reached nobody. Take a held non-emergency reply at 23:00 and a burst-pipe reply on the same lead at 23:10. The second reply would be recorded `cooldown_suppressed` and never sent, which breaks D-09's "emergencies regardless".
- **Fix:** `recentEscalationForCadence` takes an optional third argument, `{ ignoreUnreleasedHolds }`. It excludes rows with `hold_until` set and `released_at` NULL. Only the hot-lead pass passes it, and only for an immediate lead reply. All other callers are unchanged, including `quote-call.ts`, which is byte-identical. A second non-emergency reply behind a hold is still suppressed (research Q7).
- **Files:** src/db/repository/escalations.ts, src/core/escalation/escalate-hot-leads.ts.
- **Proof:** pure, in escalation-passes. On a real database, escalation-lead's "emergency ten minutes after a HELD reply" case.
- **Commit:** `9fa26e1`.

**2. [Rule 1, bug] A complaint after hours would never have reached the tradie.**
- **Found during:** Task 2.
- **Issue:** The plan says a held row whose lead is not open is released `lead_closed`. High-confidence `complaint` and `existing_job` replies are both hot and closing (D-07, D-11). The label-effects pass closes the lead in the same tick, before the escalation pass holds the reply. So at 08:00 every such row would be refused, and the tradie would never hear about an after-hours complaint. The 13-04 hazard says closing must never cancel the tradie hearing about it.
- **Fix:** The release refuses only when the lead is missing, converted, or closed after the hold was claimed (`closed_at > created_at`). `ReleasedEscalation` gains `claimedAt` (the row's `created_at`) for this.
- **Proof:** pure: closed later is refused, closed in the same tick is still sent, converted is refused. On a real database: escalation-lead's "complaint closed in the claiming tick is still told", and "closed by the operator an hour later is lead_closed".
- **Files:** src/db/repository/escalations.ts, src/core/escalation/release-held.ts.
- **Commit:** `9fa26e1` (repository field), `eafa859` (pass).

**3. [Rule 3, blocking] `contactWindowOf` parameter narrowed to the four window columns.**
- **Issue:** The passes hold a `tenants` row, not a `CadenceTickTenant`.
- **Fix:** The parameter is now `Pick<CadenceTickTenant, 'timezone' | 'contactHoursStart' | 'contactHoursEnd' | 'contactDays'>`. The change is type-only. Behaviour and the existing callers are unchanged, and the code still has one mapping of a window.
- **File:** src/core/cadence/dispatch.ts.
- **Commit:** `9fa26e1`.

**4. [Rule 3, blocking] DB exact-shape pins edited without a local run.**
- `tests/escalation.test.ts`: `held: 0` added to the no-sender `EscalationCounts` `toEqual`.
- `tests/cadence-tick.test.ts`: the nine keys added as zeros. `leadsClosedByLabel: 0` was also added. 13-04 added that key to the tick without updating this exhaustive pin, so it would have failed at 13-07's gate regardless of this plan.
- **Commits:** `9fa26e1`, `eafa859`.

**5. [Documentation] `getMissedCallForTextBack`'s header listed `text-back.ts` as its only reader.**
- It now names the two escalation passes. Both read a ring-twice caller's number only after their own claim, and only for the `Call them:` line. The edit is comment-only.
- **File:** src/db/repository/missed-calls.ts.
- **Commit:** `eafa859`.

### Plan-shape choices (not behaviour deviations)

- `hold.ts` imports `window.ts` (pure and framework-free), as the plan's key link requires (`hold.ts → window.ts via nextWindowOpen`). It does not follow "no imports but types". `shouldHoldEscalation` itself is pure.
- The pass signatures use an input object (`escalateRingTwiceCalls({ sender, now, limit })`, `releaseHeldEscalations({ sender, now, limit })`). This matches the `escalateQuoteCalls` mould rather than `(now, sender)`.
- The release does not re-read the tenant's phone. It sends to the `to_address` the hold recorded, normalised again, so the evidence row stays true. It re-asks `resolveSmsFrom`, so a client disarmed overnight gets `sms_not_configured`.
- The hot-lead pass now takes `leadId` from the scan row (`cadences.lead_id`, added by 13-03). It no longer re-reads the cadence. The value is the same and it saves one query per lead row.
- `RING_TWICE_WINDOW_MINUTES` is pinned to 30 both in the pure escalation-passes suite (so it runs locally) and in the DB ring-twice suite, as 13-05 asked.

## Known Stubs

None.

## Threat Flags

None. No new endpoint or trust boundary. The two new number-bearing reads (`inbound.byIdForEscalation`, `getMissedCallForTextBack`) run after a claim and feed only the message builders. Every log line is counts only, and caught values are discarded (T-13-15).

## Hazards for 13-07's CI gate

1. **First DB runs.**
   - `claimHeldEscalationRelease`, including the new `claimedAt: escalations.createdAt` in its RETURNING, and `recentEscalationForCadence`'s new `or(isNull(hold_until), isNotNull(released_at))` arm both run against a real database for the first time in `tests/escalation-lead.test.ts`.
   - `listUnescalatedRingTwiceCalls` gets its first real claim path in `tests/ring-twice.test.ts`.
2. **Exact tick counts.**
   - Both new suites assert `escalationHeld`, `escalationReleased`, `escalationReleaseRefused`, `ringTwiceEscalated`, `ringTwiceHeld` and `ringTwiceSuppressed` exactly. The cap cases assert `hotEscalated` exactly.
   - This is the same footing as the other tick suites: files run serially and each tears down its own rows. Any other suite that leaves a hot unescalated, held, or ring-twice row behind past its `afterAll` would move these numbers.
   - The cap cases are last in their file, because any earlier tick at 08:00 or later would release their held rows.
3. **Fixed past clocks through whole ticks.**
   - Both suites run `runCadenceTick` at 6–7 October 2026, with the default `StubSender` and no draft or classify client. This matches what `text-back-quote` and `lead-cadence-active` already do.
   - escalation-lead seeds `seedConnection` so the label-effects pass visits its tenants, which the complaint case needs.
4. **`tests/cadence-tick.test.ts`** now pins `leadsClosedByLabel: 0`. That key was missing from 13-04 and was a latent red for 13-07 regardless.
5. **Numbers.** Ring-twice uses 0491 570 7xx. escalation-lead uses 0491 570 801 upward for 59 leads, with 898 as the from-number and 899 as the tradie's phone. The sequence throws before it reaches 898.

## State updates

- STATE.md: plan 6 of 7 complete, wave 6 next. Decisions recorded and a metric row added.
- ROADMAP.md: 13-06 ticked.
- REQUIREMENTS.md: LEAD-03 complete. The keyword and labels came from 13-04, the hold and ring-twice from this plan, and the switch UI from 13-05. Its DB proofs run at 13-07's gate.

## Self-Check: PASSED

- FOUND: src/core/escalation/hold.ts, src/core/escalation/ring-twice.ts, src/core/escalation/release-held.ts, tests/escalation-hold.test.ts, tests/escalation-passes.test.ts, tests/escalation-lead.test.ts, tests/ring-twice.test.ts
- FOUND commits: 9fa26e1, eafa859, 650d33b
