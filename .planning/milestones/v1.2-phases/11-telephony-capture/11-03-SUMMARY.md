---
phase: 11-telephony-capture
plan: 03
subsystem: telephony
tags: [twilio, reconcile, pg_cron, d-04, recordings, operator-sms, vitest]

requires:
  - phase: 11-telephony-capture
    provides: "11-01 — upsertMissedCallFromLog, forAllTenants_activeDivertNumbers, classifyCaller, CALL_STATUSES, the pinned twilio@6.1.1, the TWILIO_* env keys"
  - phase: 04-messaging-activation
    provides: the messaging-reconcile route and its 03:30 AWST pg_cron tick and bearer; the reconcile mould (total guard, 48 h window, warn + 0)
  - phase: 09-landing-intake
    provides: sendOperatorSms (the one operator-handset door)
provides:
  - src/core/telephony/twilio-client.ts — the ONLY importer of the twilio REST client (edge sydney; listInboundCalls, countRecordingsSince, searchAuLocalNumbers, purchaseNumber, twilioCredsFromEnv, twilioReasonOf)
  - src/core/telephony/reconcile.ts — reconcileMissedCalls, the guarantee half of double-sourced capture plus the nightly D-04 recording alarm
  - messaging-reconcile route answers six enumerated fields (four messaging + missedCallsRecovered + recordingsFound)
  - tests/missed-call-reconcile.test.ts (46 pure cases) and four new route cases
affects: [11-02, 11-04, 11-05, 11-06, 11-07, 12-missed-call-text-back]

actuals:
  tokens: 16100
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Twilio SDK behind one core file: per-call client built with { edge: TWILIO_EDGE, timeout }, closed-union results, reasons bounded to [A-Za-z0-9_]{1,32} (http_<status> > errno > e.name > sdk_error), message never read"
    - "Second pass on an existing cron route instead of a new job: own total guard, own whole-body catch to NOTHING, route-level .catch belt, enumerated fields only"
    - "Invariant alarm by counting: recordings are listed for their count only, BEFORE the sweep, so a DB failure mid-sweep cannot silence D-04"
    - "Mocked-SDK client proof: vi.mock('twilio') default export observed for constructor opts and every list/create argument"

key-files:
  created:
    - src/core/telephony/twilio-client.ts
    - src/core/telephony/reconcile.ts
    - tests/missed-call-reconcile.test.ts
  modified:
    - src/app/api/internal/messaging-reconcile/route.ts
    - tests/messaging-reconcile-route.test.ts

key-decisions:
  - "twilioCredsFromEnv returns TwilioCreds | null (null on an unreadable env) so an env fault skips the pass with zero HTTP instead of throwing on the cron tick"
  - "The recording count runs BEFORE the call sweep so a database failure part-way through the sweep cannot silence the D-04 alarm"
  - "The route wraps reconcileMissedCalls() in .catch(() => zeros): the core already catches everything, and this keeps a regression there from turning into a 500 after the messaging work has run"
  - "The alarm SMS is a fixed 150-character GSM-7 sentence with no identifiers, sent through sendOperatorSms with requestId telephony-recording-present"
  - "CAP-02/CAP-03 are NOT marked complete: the status route and production push (11-02) and the live proofs (11-07/11-08) remain"

patterns-established:
  - "Telephony reconcile test mould: deps builder with vi.fn collaborators, getServerEnv mocked and observed (not called under the guard), console spies scanned for any +61 number"

requirements-completed: []

coverage:
  - id: D1
    description: "No active divert number or no credentials → skipped with zero provider calls, and the env is not even read"
    requirement: CAP-03
    verification:
      - kind: unit
        ref: "tests/missed-call-reconcile.test.ts#the reconcile guard is first and total"
        status: pass
    human_judgment: false
  - id: D2
    description: "An owned inbound call is upserted once with the owner's tenant, source/completedVia reconcile, classifyCaller kind and after_hours from the owner's window at the call's start; unowned calls are skipped; inserted and updated both count"
    requirement: CAP-03
    verification:
      - kind: unit
        ref: "tests/missed-call-reconcile.test.ts#the call-log convergence"
        status: pass
    human_judgment: false
  - id: D3
    description: "A failed poll warns with a bounded code and returns 0; an empty page returns 0 with no warning; a throwing upsert or owner read returns NOTHING; no log line carries a number or thrown prose"
    requirement: CAP-03
    verification:
      - kind: unit
        ref: "tests/missed-call-reconcile.test.ts#the call-log convergence"
        status: pass
    human_judgment: false
  - id: D4
    description: "Recordings > 0 → recordingsFound, a fixed [telephony] RECORDING_PRESENT error and one operator SMS; a failed count raises no alarm; a failed alert is a warning; the alarm survives a DB failure in the sweep"
    requirement: CAP-02
    verification:
      - kind: unit
        ref: "tests/missed-call-reconcile.test.ts#the recording alarm"
        status: pass
    human_judgment: false
  - id: D5
    description: "The client is built with edge sydney and a 20 s timeout; the calls list is 48 h, limit 500, inbound only; recordings are counted (limit 50); Perth search with a WA fallback; one create call with everything and no sms key; reasons are bounded"
    requirement: CAP-03
    verification:
      - kind: unit
        ref: "tests/missed-call-reconcile.test.ts#the Twilio client"
        status: pass
    human_judgment: false
  - id: D6
    description: "The route answers six enumerated fields; a skipped or throwing telephony pass is 200 with zeros; telephony runs after messaging even when messaging skipped; no spread"
    requirement: CAP-03
    verification:
      - kind: unit
        ref: "tests/messaging-reconcile-route.test.ts#messaging-reconcile response"
        status: pass
    human_judgment: false
  - id: D7
    description: "The reconcile sees calls Twilio processed in US1 through the Sydney edge (S7) and recovers a deliberately dropped callback"
    requirement: CAP-03
    verification: []
    human_judgment: true
    rationale: "Needs a purchased number and a live call. This is the S7 check and dropped-callback drill in plan 11-07."

duration: 15min
completed: 2026-09-28
status: complete
---

# Phase 11 Plan 03: Twilio client and call-log reconcile Summary

**The nightly 03:30 AWST messaging-reconcile tick now runs a second pass. It lists Twilio's inbound calls from the last 48 hours through the Sydney edge and writes each call to one of our numbers through `upsertMissedCallFromLog`, using the same classifier and window function as the webhook. It also counts recordings on the account and sends the operator an SMS if there are any. It adds no new cron job, secret or route. The Twilio REST SDK is imported in exactly one file, where every function returns a closed-union result and never throws.**

## Performance

- **Duration:** about 15 min
- **Started:** 2026-09-27T16:36Z
- **Completed:** 2026-09-27T16:50Z (2026-09-28 AWST)
- **Tasks:** 2
- **Files:** 3 created, 2 modified

## Accomplishments

- **`twilio-client.ts`:** the only file under `src/` that imports `twilio`, and a test enforces that by walking the tree. The webhooks still import only the deep `twilio/lib/webhooks/webhooks` path. The SDK is built per call as `twilio(sid, token, { edge: TWILIO_EDGE, timeout: 20_000 })`. Offline, the SDK resolves that to `api.sydney.us1.twilio.com`. It exposes four operations: list inbound calls, count recordings, search AU local numbers (Perth `inLocality`, falling back to a client-side WA / `+618` filter), and purchase one number (a single fully configured create call: `voiceCallerIdLookup: false`, POST voice and status URLs, optional GET fallback, no sms key). There is no release, delete, update, outbound-call or messages operation. Reasons are `http_<status>`, then an errno, then `e.name`, then `sdk_error`, bounded to `[A-Za-z0-9_]{1,32}`. `.message` is never read.
- **`reconcile.ts`:** `reconcileMissedCalls(deps)`.
  1. Guard first: no active divert number means `NOTHING`, and the env is never read. Null credentials also mean `NOTHING`.
  2. Count recordings. If the count is above 0, log `console.error('[telephony] RECORDING_PRESENT …')` and send an operator SMS.
  3. Run `calls.list` over 48 h, keep calls whose `To` is in the owner map, and upsert each with `classifyCaller`, `!isInsideWindow(startTime ?? now, owner window)` (an invalid window counts as after-hours), and a status from `CALL_STATUSES` or null.
  4. Log counts only.

  The whole body is wrapped so any throw becomes `[telephony] reconcile failed` and `NOTHING`.
- **Route:** `const telephony = await reconcileMissedCalls().catch(() => TELEPHONY_NOTHING)` runs after `reconcileMessaging()`. `missedCallsRecovered` and `recordingsFound` are listed as fields, not spread in. The header documents the six-field body and the S8 reasoning.

## Task Commits

1. **Task 1: Twilio REST client behind one file.** `0d1a689` (feat)
2. **Task 2: call-log reconcile and recording alarm on messaging-reconcile.** `69a26d5` (feat)

**Plan metadata:** the final docs commit (SUMMARY + STATE + ROADMAP).

## Verification

- `npx vitest run tests/missed-call-reconcile.test.ts tests/messaging-reconcile-route.test.ts tests/messaging-reconcile.test.ts tests/telephony-greeting.test.ts tests/lint-ban.test.ts tests/twilio-voice-route.test.ts`: all green (188 tests). The D-04 structural scan in `telephony-greeting.test.ts` now also covers the two new telephony files and passes.
- `tests/cron-schedules.test.ts` did not run here. It is DB-backed (it applies the pg_cron jobs) and the production guard refuses it off-CI ("Refusing to run integration tests against a non-local Supabase stack"). What it tests, `scripts/apply-cron-schedules.mjs`, is byte-identical to HEAD (`git diff --quiet HEAD -- scripts/apply-cron-schedules.mjs src/core/shared/env.ts` exits 0), so no job and no secret changed. CI runs it.
- Full bare `npx vitest run` with the four Twilio dummies set inline in the command (nothing written to `.env*`): **3494/3494 tests pass**, up from 3444 after 11-01. The 43 failed files are all the existing production-guard refusal, counted exactly.
- Negative control: breaking the guard (`numbers.length === -1`) turned both guard tests red. The first version of the "credentials not even read" test did **not** go red, so it was rewritten to watch a mocked `getServerEnv` directly. It is now red under the broken guard and green once restored.
- `npm run typecheck` and `npm run lint` both exit 0.
- Every acceptance grep in both tasks passes. The route spread grep is 0, the route has one `reconcileMissedCalls(` call, and `twilio-client.ts` has one `voiceCallerIdLookup: false`.

## Decisions Made

See `key-decisions` in the frontmatter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Correctness] `twilioCredsFromEnv()` returns `TwilioCreds | null`**
- **Found during:** Task 1
- **Issue:** the plan typed it as `TwilioCreds`, but Task 2's guard branches on `creds === null`, and so does the research shape. With a non-null return that branch could never run, and `getServerEnv()` throwing on an incomplete env would have been the only outcome.
- **Fix:** `null` when the env cannot be read or a value is empty. The zod report is discarded. Tested.
- **Commit:** 0d1a689

**2. [Rule 2 - D-04] Recording count runs before the call sweep**
- **Found during:** Task 2
- **Issue:** in the plan's order (calls, then recordings), an upsert throw sends the pass to the catch-all before the recordings are counted. A database outage on the night a recording appears would then hide the alarm.
- **Fix:** count first, then sweep. The upsert-throws case still returns the NOTHING shape as the plan requires. A test shows the alarm still fires when the sweep fails.
- **Commit:** 69a26d5

**3. [Rule 2 - Robustness] Route-level `.catch` on the telephony pass**
- **Issue:** the plan's truth is "a throwing telephony pass still yields a 200 with zeros". The plan's route test asks for a rejecting mock, which can only return 200 if the route catches.
- **Fix:** `.catch(() => TELEPHONY_NOTHING)` in the route. Tested with a rejection whose message contains a phone number, and the number does not reach the body.
- **Commit:** 69a26d5

**4. [Rule 1 - Acceptance precision] An existing route comment contained the literal `` `...result` ``**
- **Issue:** at HEAD the acceptance grep `\.\.\.result\|\.\.\.telephony` on the route was already 1 because of the T-3-24 comment.
- **Fix:** reworded to "a spread of either result". The meaning is unchanged, and the comment now also names `MissedCallReconcileResult`.
- **Commit:** 69a26d5

**5. [Rule 2 - Test coverage] Client proven against a mocked SDK**
- **Issue:** the plan's tests covered only the reconcile. The client's D-10 edge, the inbound filter, the WA fallback, the single create call and the reason bounding had nothing but greps.
- **Fix:** a `vi.mock('twilio')` block in `missed-call-reconcile.test.ts` that observes constructor options and every list/create argument. `twilioReasonOf` is exported for this. Reasons also accept an errno (`ETIMEDOUT`) ahead of `e.name`, which tells you more than the transport class name.
- **Commit:** 69a26d5

### Notes for the verifier (not deviations)

- **"Five enumerated fields":** the plan's truth says five messaging fields, but the route has always returned four (`skipped`, `receiptsApplied`, `inboundReplayed`, `optOutsRecorded`). The body is now six fields, and the test pins that key count. `skipped` still refers to the messaging pass.
- **`missedCallsRecovered` semantics:** as specified, it counts `inserted + updated`. `upsertMissedCallFromLog` cannot tell "completed a row a callback left open" from "row was already complete". So after a normal night the number equals the owned inbound calls in the 48 h window, not only the calls that were actually recovered. The header comment says "converged". If 11-06's ops reader or the runbook needs a true "recovered" figure, the repository upsert would have to report whether the completion columns changed.
- **`completedVia: 'reconcile'` on a non-terminal call:** set on insert as specified, including a call still `in-progress` at 03:30. The later status callback overwrites it with `'callback'`. The repository's conflict path already coalesces this column no matter what the status is.
- **Alarm custom string:** `sendOperatorSms` prefixes `audit-request:`, so the alarm's ClickSend custom string reads `audit-request:telephony-recording-present`. The DLR handler files it as unmatched, which is harmless, but the label is inaccurate. Widening `sendOperatorSms` was out of scope.

---

**Total deviations:** 5 auto-fixed (4 correctness/robustness, 1 acceptance precision). None of them changes scope.

## Issues Encountered

- The local `.env.local` still does not have the four REQUIRED Twilio keys (carried over from 11-01). Suites that build the real env need the keys set inline in the command. Founder action (11-02 checkpoint): add them to `.env.local` and to Vercel before any deploy of `main`.
- This plan adds no deploy risk of its own. The pass reads Twilio credentials lazily, inside its try, so an environment without the keys makes it skip instead of returning a 500 on the tick.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. No new route or secret, and the only new outbound surfaces are Twilio list/create calls through the Sydney edge (T-11-13/14/SC) and the existing operator SMS door.

## Next Phase Readiness

- 11-02 (founder checkpoint, env push, `db:migrate` of 0038, voice-status route) is still the gate before this pass does anything in production. Until a divert number is active, the guard makes it a zero-HTTP skip.
- 11-05 consumes `searchAuLocalNumbers` / `purchaseNumber`. 11-06's one-shot reconcile script can call `reconcileMissedCalls()` directly.
- This plan did **not** push and did **not** run `db:migrate`.

## Self-Check: PASSED

- src/core/telephony/twilio-client.ts, src/core/telephony/reconcile.ts and tests/missed-call-reconcile.test.ts are present on disk.
- Commits 0d1a689 and 69a26d5 are present in `git log`.
