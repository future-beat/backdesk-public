---
phase: 12-instant-text-back-arming
plan: 04
subsystem: cadence tick / telephony / messaging / alerts
status: complete
tags: [text-back, sweep, stale, operator-alerts, clicksend-balance, auto-disarm, tick-seams]
requires:
  - 12-01 (sendTextBack, D-07 floor constants, TEXT_BACK_GRACE_SECONDS / TEXT_BACK_MAX_AGE_MINUTES)
  - 12-02 (listPendingTextBacks, markStaleTextBacks, claimTextBackAlerts, listArmedTextBackTenantIds, disarmChannelBySystem, claimOperatorAlert)
  - 12-03 (migration 0039 live)
provides:
  - src/core/leads/sweep.ts (runTextBackSweep, runTextBackAlertPass)
  - src/core/leads/balance.ts (runBalanceProbe, parseBalanceCents, decideBalanceActions, perthAlertDay, AUTO_DISARM_REASON)
  - src/core/alerts/text-back-alerts.ts (four counts-only email builders, clientsPageUrl, formatAud)
  - getAccountBalance, centsFromDecimal, isInsufficientCreditCode in the ClickSend client
  - Two tick seams (textBackSender, textBackOps), both undefined by default; twelve enumerated tick counts
affects:
  - 12-05 (wave-4 CI proves tests/text-back-sweep.test.ts and the moved tick literals; D-08 replaces the quote_open stub the sweep also reaches)
  - 12-08 (once MESSAGING_CHANNELS can arm text_back, the probe and the sweep start acting in production)
tech-stack:
  added: []
  patterns:
    - "Undefined-by-default tick seam: no sender / no ops means no scan and no claim, so scripts and remote suites cannot spend a real client's once-only right"
    - "Claim-then-send with the try split at the claim; a lost email after the claim is a counted failure, never zero"
    - "Provider figure parsed to integer cents from digit strings (no float), and anything unreadable is never treated as empty"
key-files:
  created:
    - src/core/leads/sweep.ts
    - src/core/leads/balance.ts
    - src/core/alerts/text-back-alerts.ts
    - tests/text-back-sweep.test.ts
    - tests/text-back-balance.test.ts
    - tests/text-back-tick-passes.test.ts
  modified:
    - src/core/messaging/clicksend-client.ts
    - src/core/cadence/run-tick.ts
    - src/app/api/internal/cadence-tick/route.ts
    - tests/cadence-tick-route.test.ts
    - tests/cadence-tick.test.ts
    - tests/cadence-tick-isolation.test.ts
    - tests/cadence-tick-classification.test.ts
    - tests/stall-claim-isolation.test.ts
decisions:
  - "The sweep guarantees only never-claimed text-backs; a provider-refused (failed) or unknown-outcome (claimed) text-back is alerted to the operator within the tick and never re-sent (D-04, D-10)"
  - "The sweep marks stale AFTER its sends, strictly older than now - 10 min, at the tick clock; with no sender it marks nothing stale either"
  - "textBackFailed counts failed + outcome_unknown + pre_claim_failed + a throw; claim_lost / already_decided / not_found / dead_letter count only in textBackSwept"
  - "textBackAlerted counts text-backs reported in an email that left; textBackAlertFailed is the alert pass's lost email PLUS any balance email whose daily claim was spent without the mail leaving (one 'lost operator email' signal, twelve fields kept)"
  - "Below A$5 with at least one client disarmed, the auto-disarm email stands in for the low-balance email that tick (it carries the balance and the floor); the low email is sent only when nothing was disarmed"
  - "The decimal-to-cents parse lives at the provider boundary (centsFromDecimal in clicksend-client.ts) and balance.ts exports it as parseBalanceCents, so the ClickSend client never imports the probe (no cycle, no repository in the client's module graph)"
  - "The failure email links the console client LIST, not a client page, because a client page URL carries a tenant id"
  - "AUTO_DISARM_REASON is derived from CLICKSEND_BALANCE_DISARM_FLOOR_CENTS ('auto: ClickSend balance below A$5') so the reason and the floor cannot disagree"
  - "Insufficient-credit spelling confirmed as INSUFFICIENT_CREDIT (escalations.ts schema comment, scripts/clicksend-balance.mjs header); matched on the codeOf token with includes('INSUFFICIENT_CREDIT')"
metrics:
  duration: "~25 min"
  completed: 2026-10-06
  tasks: 3
  files: 14
estimate:
  tokens: 60000
  tasks: 3
actuals:
  tokens: 31500
  tasks: 3
  commits: 4
---

# Phase 12 Plan 04: Text-back guarantee sweep, failure alerts and the ClickSend balance alarm Summary

The per-minute cadence tick now has three new passes. A sweep sends any never-claimed text-back between 45 seconds and 10 minutes old through the one `sendTextBack`, and marks anything older `skipped` / `stale`. An alert pass emails the operator, once, about every failed or stuck text-back. A balance probe alerts below A$20 and, below A$5, disarms every armed client, writing one audited `actor = 'system'` row each. All three sit behind two seams that are undefined by default. Without the route, nothing is scanned, claimed, latched or disarmed.

**Scope of the guarantee:** the sweep sends only text-backs that were never claimed. A provider-refused (`failed`) or unknown-outcome (`claimed`) text-back is alerted to the operator within the tick and never re-sent (D-04, D-10).

## Tasks

| # | Task | Commit | Key files |
|---|------|--------|-----------|
| 1 | Guarantee sweep with the stale window, behind `textBackSender` | `a234916` | src/core/leads/sweep.ts, run-tick.ts, cadence-tick route, route/tick/isolation tests, tests/text-back-sweep.test.ts, tests/text-back-tick-passes.test.ts |
| 2 | Failed and stuck text-backs alert the operator within the tick, behind `textBackOps` | `a385cfd` | sweep.ts (runTextBackAlertPass), src/core/alerts/text-back-alerts.ts, clicksend-client.ts (isInsufficientCreditCode), tests |
| 3 | ClickSend balance probe, low alert, audited auto-disarm | `17c26b9` | src/core/leads/balance.ts, clicksend-client.ts (getAccountBalance, centsFromDecimal), three builders, tests |

## The twelve new tick fields (result and route body, enumerated, pinned in the exact key set)

| Field | Meaning |
|---|---|
| `textBackSwept` | Pending calls handed to `sendTextBack` this tick |
| `textBackSent` | Of those, texted by the sweep (non-zero means a callback was missed) |
| `textBackSkipped` | Of those, refused by the gate with a recorded reason |
| `textBackFailed` | Of those, failed / outcome unknown / pre-claim failed / threw |
| `textBackStale` | Calls past the 10-minute ceiling marked `skipped` / `stale` |
| `textBackUnconfigured` | `1` when no `textBackSender` was supplied (no scan) |
| `textBackAlerted` | Failed or stuck text-backs reported in an email that left |
| `textBackAlertFailed` | Owed operator emails (failure alert or a balance email) that did not leave |
| `balanceProbed` | `1` when the balance was read or tried this tick |
| `balanceProbeFailed` | `1` when the balance could not be read (never disarms, never "low") |
| `balanceLowAlerted` | `1` when the once-a-day below-A$20 email left |
| `textBackAutoDisarmed` | Clients the system disarmed this tick (below A$5) |

## Insufficient-credit code

`INSUFFICIENT_CREDIT`. This is ClickSend's own reason, named in `src/db/schema/escalations.ts` (the "provider refusal" note) and in the header of `scripts/clicksend-balance.mjs`. The first live SMS failed with it. `sendTextBack` records `codeOf(reason)` as `text_back_detail`, and `isInsufficientCreditCode` matches `codeOf(code).includes('INSUFFICIENT_CREDIT')`, so casing and separators make no difference.

## Pass order inside `runCadenceTick`

consume → attribution → progress → dispatch → **text-back sweep** → completion → classification → escalation → **text-back alerts** → **balance probe** (forced when the alert pass saw `INSUFFICIENT_CREDIT` on a `failed` row) → aging.

The sweep sits beside dispatch because it touches a customer. The two mail-sending passes sit behind everything that does.

## Verification

- Task 1 gate: the six named pure suites (325 tests), typecheck, lint and the cron-pin diff all passed.
- Task 2 gate: `text-back-balance`, `cadence-tick-route`, `cadence-tick-isolation` and `stall-claim-isolation`, plus typecheck and lint, all passed.
- Task 3 gate: `text-back-balance`, `cadence-tick-route` and `audit-aggregate`, plus typecheck, lint and the diff of `tests/cron-schedules.test.ts`, `scripts/apply-cron-schedules.mjs` and `scripts/clicksend-balance.mjs` against the phase base `64bcd0f`, all passed. `tests/report-metrics.test.ts` is also byte-identical.
- Pure suites at the end: 10 files, 501 tests passed (includes `text-back-tick-passes`, `text-back-structure`, `ops-scripts`).
- Full local `vitest run`: 110 files passed and 48 failed. All 48 are DB-backed suites that refuse the non-local target. The baseline was 47; the new one is `tests/text-back-sweep.test.ts`. No non-DB file failed.
- **Not run here** (CI at the 12-05 wave gate): `tests/text-back-sweep.test.ts` (642 lines), plus the updated tick literal in `tests/cadence-tick.test.ts`. Nothing was pushed, and no statement touched production.
- No new cron job, env key, route, package or `package.json` script.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Correctness] Lost balance emails are counted, not silent**
- **Found during:** Task 3
- **Issue:** The plan's four probe counts (`probed`, `probeFailed`, `lowAlerted`, `autoDisarmed`) gave no way to report a balance email whose once-a-day claim was spent without the mail leaving. That alert would be lost for the rest of the Perth day with no trace.
- **Fix:** The probe returns an internal `emailFailed`. The tick reports `textBackAlertFailed = alertPass.alertFailed + probe.emailFailed`, so every lost text-back operator email lands in one field, and the field count stays at twelve.
- **Commit:** 17c26b9

**2. [Rule 2 - Correctness] Auto-disarm email stands in for the low email in the same tick**
- **Issue:** Read literally, the plan sends both a low-balance and an auto-disarm email at 450 cents. The behaviour block says "one email per Perth day".
- **Fix:** When at least one client is disarmed, only the auto-disarm email is sent, and it states the balance and the floor. The low-balance email is sent when nothing was disarmed, including a disarm decision where every client was already off.
- **Commit:** 17c26b9

**3. [Rule 3 - Blocking/design] Decimal parse placed at the provider boundary**
- **Issue:** `getAccountBalance` (in the ClickSend client) must return cents, and `parseBalanceCents` must be exported from `balance.ts`, which imports the client. Putting the implementation in `balance.ts` would create an import cycle and pull the repository into the client's module graph.
- **Fix:** `centsFromDecimal` lives in `clicksend-client.ts`, and `balance.ts` exports `parseBalanceCents` as that function. There is one implementation.
- **Commit:** 17c26b9

**4. [Scope addition] `tests/text-back-tick-passes.test.ts` (pure, mocked)**
- **Issue:** The plan's proof of the three passes' orchestration lives only in the DB-backed `text-back-sweep` suite, which cannot run locally.
- **Fix:** A pure suite with `@/db/repository` and `sendTextBack` mocked covers: no seam means no scan; the window bounds; tallying; one row throwing; the claim-split alert; a lost email; the probe's quarter-hour gate; strict floors; never disarming on an unreadable balance; and the daily latch. It has 26 tests.
- **Commits:** a234916, a385cfd, 17c26b9

**5. [Plan note] `tests/cadence-dispatch-isolation.test.ts` not edited**
- It mocks the repository for `dispatch.ts` only and never imports `run-tick.ts` or the sweep, so no new name reaches it. The three suites that do import the tick each gained throwing stubs for the six new repository names.

**6. [Plan note] `buildTextBackFailureAlert` signature**
- The signature is `{ perClient, at?, clientsUrl }`, with the total computed from `perClient` instead of passed in, so the subject and the lines cannot disagree. The closing line points at the client list, because a client page URL would carry a tenant id.

### TDD Gate Compliance

All three tasks are `tdd="true"`. Implementation and tests landed together in each task commit. The DB-backed half cannot run locally, which is the constraint 12-01 and 12-02 documented. The pure half (`text-back-balance`, `text-back-tick-passes`) ran green before each commit. There are no separate `test(...)` RED commits.

## Known Stubs

None introduced. The sweep reaches the 12-01 `quote_open` arm (records a skip and sends nothing) through `sendTextBack`; 12-05 replaces it.

## Threat Flags

None. Every new surface is in the plan's threat model: T-12-02 (single claim arbiter), T-12-20 (10-minute ceiling and stale marks), T-12-04 and T-12-21 (balance floors; unreadable never disarms), T-12-14 (system audit row in one transaction, via `disarmChannelBySystem`), T-12-07 (counts-only builders asserted free of `+61`, 8+ digit runs and uuids; the response key set is pinned; caught values are discarded) and T-12-22 (both seams undefined by default).

## Self-Check: PASSED

- Files exist: `src/core/leads/sweep.ts`, `src/core/leads/balance.ts`, `src/core/alerts/text-back-alerts.ts`, `tests/text-back-sweep.test.ts` (642 lines, at least 150), `tests/text-back-balance.test.ts` (326 lines, at least 100), `tests/text-back-tick-passes.test.ts`.
- Commits `a234916`, `a385cfd` and `17c26b9` are present in `git log`. None is pushed.
