---
phase: 03-cadence-engine
plan: 04
subsystem: cadence-engine
tags: [cadence, rewindow, resume, concurrency, skip-locked, send-ledger, contact-hours, compliance]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: tenants.timezone / contact_hours_* / contact_days, the validated-IANA-zone rule
  - phase: 02-servicem8-sync-quote-leakage-audit
    provides: sm8_connections.paused_at and resumeConnection (the D-08 re-key path this plan hooks), the framework-free-core header convention, the real-DB integration-test rig
  - phase: 03-cadence-engine
    provides: "03-01's cadence tables and guarded repository namespaces (listLive, listUnsentForCadence, reschedule, skipWhere, skipUnsentForCadences, markExpired, claimDue, insertClaim); 03-02's dispatch claim path, run-tick shape and TouchSender seam; 03-03's transitions matrix; 03-07's pure scheduling core (nextAllowedSlot, slotAtOffsetDays, isInsideWindow) and named policy constants"
provides:
  - rewindowTouch — the pure five-armed D-09/D-10/D-11/D-12 policy for an overdue touch
  - computeResumeSchedule — the pure D-07 rule, and applyResumeRewindow, the DB applier every pause-lift path shares
  - The tick's progress pass — expiry sweep, re-window, then promotion — between consume and dispatch
  - resumeConnection now funnels auth recovery through the same D-07 rule
  - DISPATCH_REFUSALS — a closed, per-reason count vocabulary for every refusal the claim path makes
  - randomJitterMinutes — the single production jitter draw, so the pure modules provably hold none
  - Real-DB proof of the two-connection ledger race and the four just-in-time refusals
affects: [03-05 operator controls, 03-06 tick route, 04-messaging, 05-drafting, 06-approval-console, 07-reporting]

actuals:
  tokens: 26006
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Two rules that must never disagree expressed as ONE rule asked twice: 'may we send now' is answered by asking the slot chooser whether the next allowed slot IS now"
    - "Every policy threshold's boundary falling on the side that keeps the cadence alive, decided once for all three thresholds rather than independently"
    - "Walking a cadence's overdue touches in touch-number order against the slots AS THEY STAND, so 'the next touch carries the conversation' falls out of the min-gap rule instead of being special-cased"
    - "A refusal vocabulary distinct from the durable skip-reason vocabulary: what this tick decided is not the same fact as what retired a touch forever"
    - "A concurrency guarantee asserted from both interleavings — the production path (which SKIP LOCKED usually settles) and two raw connections racing the same INSERT (which it cannot)"
    - "Test helpers that ask the production predicate for a valid moment rather than hand-picking a date, so a suite cannot fail for the hour it ran at"

key-files:
  created:
    - src/core/cadence/rewindow.ts
    - src/core/cadence/resume.ts
    - src/core/cadence/jitter.ts
    - tests/cadence-rewindow.test.ts
    - tests/cadence-dispatch.test.ts
    - tests/cadence-resume.test.ts
  modified:
    - src/core/cadence/run-tick.ts
    - src/core/cadence/dispatch.ts
    - src/core/sync/connect.ts
    - tests/cadence-tick.test.ts

key-decisions:
  - "'May we send this now' is answered by asking nextAllowedSlot whether the next allowed slot from now IS now, rather than by re-deriving inside-window-plus-margin — two rules that must never disagree are safer as one rule asked twice, and the alternative lets a touch be refused by the send test and re-placed at the same minute by the placement test forever"
  - "send_now requires the D-09 same-day margin, not merely being inside contact hours: a touch coming due at 16:55 against a 17:00 close is compliant and is still an ambush at knock-off, and D-09 already decided that question for placement"
  - "All three thresholds are strict — exactly 72h late is sendable, exactly 42 days old is live, exactly MIN_GAP apart is far enough — because a magnitude somebody chose is the last acceptable value, not the first unacceptable one, and deciding each independently turns three defensible choices into one arbitrary policy"
  - "The min-gap comparison is SIGNED: a candidate landing after the next touch's slot is not 'plenty of room', it is the missed touch overtaking the one meant to follow it, and both readings get the same answer"
  - "Only the last overdue touch of a cadence can be rescheduled, and that falls out of the rule rather than being special-cased — an earlier overdue touch's candidate always lands after its successor's slot, which is a negative gap and therefore within it"
  - "Paused tenants are excluded from the progress pass, not merely from dispatch: repairing a paused client's schedule against a moment that is not their resume would push every touch further into the past on every tick, and the repair belongs to the resume"
  - "Promotion moved LAST within the progress pass — promoting a touch and then moving it would surface work to the drafting queue at a time it is no longer going out at"
  - "The production jitter draw was extracted to its own module because the standing purity grep forbids it in the pure schedulers and three callers now need the same bounded draw; three inlined copies is three places the bound can drift from JITTER_MAX_MINUTES, invisibly"
  - "Dispatch refusal reasons are a vocabulary of their own, deliberately not TOUCH_SKIP_REASONS: only two of the six write to that column, and the other four describe a decision about a touch that is still live"

patterns-established:
  - "Delegating a policy's slot choice to the one proven slot chooser and documenting the branch that is consequently unreachable, rather than reimplementing the branch"
  - "Real-DB suites isolated by the pinned clock rather than by tenant, because the dispatcher walks every tenant by design"
  - "Integration coverage for a new DB applier even when the plan assigned it none, on the grounds that its failure mode is a clean return of zero"

requirements-completed: [CAD-02, CAD-04, CAD-05]

coverage:
  - id: D1
    description: "An overdue touch re-windows to the next allowed slot instead of ever being sent outside contact hours: the window-closed, margin-short and disallowed-day cases each place it at the next allowed day's preferred slot + jitter (CAD-02, D-09)"
    requirement: "CAD-02"
    verification:
      - kind: unit
        ref: "tests/cadence-rewindow.test.ts#reschedules to the next allowed day when the window has closed for the day"
        status: pass
      - kind: unit
        ref: "tests/cadence-rewindow.test.ts#reschedules to the next allowed day when less than SAME_DAY_MARGIN_MINUTES remain"
        status: pass
      - kind: unit
        ref: "tests/cadence-rewindow.test.ts#rolls past a day the tenant does not contact"
        status: pass
      - kind: integration
        ref: "tests/cadence-dispatch.test.ts#re-windows it to a future slot inside the window and claims nothing"
        status: pass
    human_judgment: false
  - id: D2
    description: "A re-windowed touch landing within MIN_GAP_HOURS of the next scheduled touch is skipped with reason min_gap — including the negative-gap case where it would overtake its successor (D-10)"
    requirement: "CAD-02"
    verification:
      - kind: unit
        ref: "tests/cadence-rewindow.test.ts#skips with min_gap when the candidate lands within MIN_GAP_HOURS of the next unsent touch"
        status: pass
      - kind: unit
        ref: "tests/cadence-rewindow.test.ts#reschedules at exactly MIN_GAP_HOURS — the boundary is not \"within\""
        status: pass
      - kind: unit
        ref: "tests/cadence-rewindow.test.ts#treats a candidate landing AFTER the next touch as within the gap"
        status: pass
      - kind: unit
        ref: "tests/cadence-rewindow.test.ts#never skips for min_gap when this is the last unsent touch"
        status: pass
    human_judgment: false
  - id: D3
    description: "A touch more than STALENESS_CAP_HOURS past its slot is skipped with reason stale and never sent, and staleness is judged before any reschedule (D-11)"
    requirement: "CAD-02"
    verification:
      - kind: unit
        ref: "tests/cadence-rewindow.test.ts#skips a touch more than STALENESS_CAP_HOURS past its slot"
        status: pass
      - kind: unit
        ref: "tests/cadence-rewindow.test.ts#does NOT skip at exactly STALENESS_CAP_HOURS — the cap is the last sendable moment"
        status: pass
      - kind: unit
        ref: "tests/cadence-rewindow.test.ts#judges staleness BEFORE any reschedule — a stale touch outside the window is skipped, not moved"
        status: pass
    human_judgment: false
  - id: D4
    description: "A cadence older than CADENCE_EXPIRY_DAYS from its anchor auto-completes as expired with its remaining touches skipped, and expiry is evaluated first (D-12)"
    requirement: "CAD-02"
    verification:
      - kind: unit
        ref: "tests/cadence-rewindow.test.ts#expires the cadence when the anchor is older than CADENCE_EXPIRY_DAYS"
        status: pass
      - kind: unit
        ref: "tests/cadence-rewindow.test.ts#does NOT expire at exactly CADENCE_EXPIRY_DAYS — the boundary keeps the cadence alive"
        status: pass
      - kind: unit
        ref: "tests/cadence-rewindow.test.ts#expires rather than skipping, even when the touch is also stale"
        status: pass
      - kind: other
        ref: "src/core/cadence/run-tick.ts — expireOverdueCadences: markExpired + skipUnsentForCadences('cadence_expired') in ONE transaction, RETURNING-driven, run before the re-window sub-pass"
        status: pass
    human_judgment: true
    rationale: "The pure policy arm and the tick's expiry sweep are both proven; what no Phase 3 test exercises is a cadence actually surviving 42 real days, so the sweep's threshold is asserted at the rule and reviewed at the write"
  - id: D5
    description: "Resume uses ONE rule for every pause type: the next unsent touch lands at the next allowed slot from the resume moment, later touches keep their original relative gaps, nothing bursts and nothing lands out of hours (D-07)"
    requirement: "CAD-02"
    verification:
      - kind: unit
        ref: "tests/cadence-rewindow.test.ts#places the first unsent touch at the next allowed slot from the resume moment"
        status: pass
      - kind: unit
        ref: "tests/cadence-rewindow.test.ts#preserves the ORIGINAL relative gaps in days rather than compressing them"
        status: pass
      - kind: unit
        ref: "tests/cadence-rewindow.test.ts#never bursts: every consecutive pair is at least MIN_GAP_HOURS apart"
        status: pass
      - kind: integration
        ref: "tests/cadence-resume.test.ts#moves every overdue touch of a live cadence forward, inside the window, in one call"
        status: pass
      - kind: integration
        ref: "tests/cadence-resume.test.ts#refuses to move anything while a pause is still in force"
        status: pass
      - kind: integration
        ref: "tests/cadence-resume.test.ts#leaves a cadence that is still paused for its own reason exactly where it was"
        status: pass
    human_judgment: false
  - id: D6
    description: "Auth recovery resumes through the same D-07 rule: resumeConnection calls applyResumeRewindow after the unpause and the immediate cycle, and never on a failure path"
    requirement: "CAD-02"
    verification:
      - kind: other
        ref: "grep -q applyResumeRewindow src/core/sync/connect.ts → matches, at step 4 after the `if (!updated)` guard and after runSyncForConnection; every earlier return leaves the pause in force"
        status: pass
      - kind: integration
        ref: "tests/rekey-resume.test.ts (unchanged Phase 2 suite) — still green; the hook did not change resume semantics for connections with no cadences"
        status: pass
    human_judgment: true
    rationale: "That a re-key followed by a re-window produces the right schedule END TO END is not asserted anywhere — rekey-resume's tenants have no cadences, and the applier is proven separately against seeded ones. The composition is reviewed, not tested; it needs a live ServiceM8 key plus a cadence, which is plan 03-05's fixture territory"
  - id: D7
    description: "Two concurrent dispatch transactions racing the same due touch produce exactly one send_ledger row and exactly one stub send, with the loser refusing cleanly — proven on the production path AND on two separate database connections (CAD-04)"
    requirement: "CAD-04"
    verification:
      - kind: integration
        ref: "tests/cadence-dispatch.test.ts#produces exactly one ledger row and exactly one send under a genuine two-connection race"
        status: pass
      - kind: integration
        ref: "tests/cadence-dispatch.test.ts#lets exactly one of two SEPARATE database connections win the same claim"
        status: pass
      - kind: integration
        ref: "tests/cadence-dispatch.test.ts#refuses the second claim of the same touch with zero rows, not an error"
        status: pass
    human_judgment: false
  - id: D8
    description: "A suppression committed after approval refuses the send with no ledger row; the paused-connection and closed-quote refusals behave as specified; the claim SELECT orders by scheduled_at with an id tie-break (CAD-05)"
    requirement: "CAD-05"
    verification:
      - kind: integration
        ref: "tests/cadence-dispatch.test.ts#refuses a due, approved touch whose recipient was suppressed after approval"
        status: pass
      - kind: integration
        ref: "tests/cadence-dispatch.test.ts#leaves a paused client's touch completely untouched"
        status: pass
      - kind: integration
        ref: "tests/cadence-dispatch.test.ts#refuses a touch whose quote closed after approval, and stops the cadence"
        status: pass
      - kind: other
        ref: "src/db/repository/for-tenant.ts claimDue — .orderBy(cadenceTouches.scheduledAt, cadenceTouches.id) with FOR UPDATE OF cadence_touches SKIP LOCKED (unchanged from 03-01; verified rather than rewritten)"
        status: pass
    human_judgment: false
  - id: D9
    description: "The tick runs consume → (expire, re-window, promote) → dispatch in that order, and tenants with either pause set are excluded from the progress and dispatch passes"
    verification:
      - kind: other
        ref: "src/core/cadence/run-tick.ts — runCadenceTick body sequences consumeQuoteEvents, runProgressPass, dispatchDueTouches; runProgressPass and dispatchDueTouches both `continue` on connectionPausedAt or settingsPausedAt"
        status: pass
      - kind: integration
        ref: "tests/cadence-tick.test.ts — all 8 cases still green against the hosted database, including the exhaustive quiet-tick toEqual over the widened result shape"
        status: pass
      - kind: integration
        ref: "tests/cadence-dispatch.test.ts#leaves a paused client's touch completely untouched"
        status: pass
    human_judgment: false
  - id: D10
    description: "The pure policy modules hold no randomness and no framework, and the whole repository is green"
    verification:
      - kind: unit
        ref: "tests/cadence-rewindow.test.ts#rewindow.ts and resume.ts hold no randomness and no framework (4 cases)"
        status: pass
      - kind: other
        ref: "npm run typecheck; npm run lint (--max-warnings=0)"
        status: pass
      - kind: integration
        ref: "npm run test:remote → 45 files, 992 tests, all pass"
        status: pass
    human_judgment: false

# Metrics
duration: 42 min
completed: 2026-08-27
status: complete
---

# Phase 3 Plan 04: Re-window, Resume and the Concurrency Proofs Summary

**A late touch is now a decision rather than an accident — the five-armed D-09/D-10/D-11/D-12 policy is a pure function asserted at every threshold boundary, every pause type resumes through one D-07 rule that auth recovery now shares, and the never-twice guarantee is proven against the real database from both sides of the race.**

## Performance

- **Duration:** 42 min
- **Started:** 2026-08-27T13:18:34Z
- **Completed:** 2026-08-27T14:00:00Z
- **Tasks:** 3
- **Files modified:** 10 (6 created, 4 modified)

## Accomplishments

- **Every overdue touch now has a deterministic, tested fate, and each of the three thresholds is asserted at the exact value and one millisecond past it.** Exactly 72 hours late is sendable; exactly 42 days old is live; exactly `MIN_GAP_HOURS` before the next touch is far enough. The direction is stated in each test name rather than left to be inferred from a passing assertion, and it is the same direction for all three — a magnitude somebody chose is the last acceptable value, not the first unacceptable one. Deciding each threshold independently is how three defensible choices add up to one arbitrary policy.
- **"May we send now" and "may we place a slot now" are one rule asked twice.** `rewindowTouch` answers the first by asking `nextAllowedSlot` whether the next allowed slot from `now` IS `now`. Written the other way — an `isInsideWindow` check plus a margin comparison — the two could drift, and the visible symptom would be a touch refused by the send test and immediately re-placed at the same minute by the placement test, every tick, forever. It also means the D-09 margin applies to sending: a touch coming due at 16:55 against a 17:00 close goes tomorrow morning rather than arriving at knock-off.
- **"The next touch carries the conversation" falls out of the rule instead of being special-cased.** When several touches came due during one outage, the tick walks them in touch-number order against the slots as they stand. Touch 2's candidate lands after touch 3's slot, which is a negative gap and therefore within it, so touch 2 is retired as `min_gap` — and only the LAST overdue touch of a cadence can be rescheduled. Nobody wrote that rule; it is what D-10 says when you apply it in order.
- **The ledger race is proven from both interleavings, because they exercise different mechanisms.** Two overlapping `dispatchDueTouches` calls in one `Promise.all` run on genuinely separate pooled connections and produce exactly one ledger row and exactly one send — but `SKIP LOCKED` usually settles that before the INSERT is reached, which is liveness, not correctness. So two `postgres()` clients of the suite's own race the same `ON CONFLICT … DO NOTHING` insert with no lock between them, and the loser learns it lost from zero returned rows rather than from an error. That is the arm that still holds for a second deployment, a manual invocation, or a cron that fired twice.
- **Auth recovery stopped being a third answer to "when does messaging start again".** `resumeConnection` now calls the same `applyResumeRewindow` that plan 03-05's client and operator resumes will call. Without it, a client whose key was dead for two days would resume by texting six customers within a minute of each other — the burst CAD-02 exists to prevent, arriving through the door marked "we fixed it".
- **A quiet tick can now say WHY it was quiet.** Dispatch refusals are a closed vocabulary counted per reason (`paused`, `quote_closed`, `suppressed`, `outside_window`, `claim_lost`, `no_address`), deliberately distinct from `TOUCH_SKIP_REASONS` — only two of the six write to that durable column. A single `refused` number could not distinguish "there was nothing to do" from "we declined everything", which is the only question an operator asks about a silent minute.

## Task Commits

1. **Task 1 (RED): the boundary table and the D-07 cases, failing** — `5dfbf8b` (test)
2. **Task 1 (GREEN): rewindow.ts, resume.ts and the extracted jitter draw** — `fd0a4c1` (feat)
3. **Task 2: the tick's progress pass and the auth-recovery resume hook** — `647536f` (feat)
4. **Task 3: the two-connection ledger race and the JIT refusal matrix** — `864a3f4` (test)
5. **Deviation 3: the D-07 applier proven against the real database** — `aa0a940` (test)

_No REFACTOR commit: the GREEN implementation is the shape its header argues for._

## Files Created/Modified

### Core (`src/core/cadence/`)

- `rewindow.ts` (new, 234 lines) — the five-armed policy, with the evaluation order argued in the header and the same-day branch of `nextAllowedSlot` documented as unreachable-by-construction from this caller
- `resume.ts` (new, 266 lines) — `computeResumeSchedule` (pure D-07) and `applyResumeRewindow` (one transaction per cadence, refusing while either pause is in force)
- `jitter.ts` (new, 37 lines) — `randomJitterMinutes`, the single production draw, in the one module allowed to hold it
- `run-tick.ts` — the progress pass: expiry sweep, per-cadence re-window, then promotion; `CadenceTickResult` widened by three counts
- `dispatch.ts` — `DISPATCH_REFUSALS` and a per-reason count on `DispatchResult`; `dispatchOne` returns a named refusal instead of `null`; `contactWindowOf` exported so the two passes cannot disagree about what a window is

### Sync

- `src/core/sync/connect.ts` — step 4 of `resumeConnection`: the D-07 re-window, on the success path only, with a failure there explicitly not failing the re-key

### Tests

- `tests/cadence-rewindow.test.ts` (new, 433 lines) — 29 cases, no database, runs on a bare `npm test`
- `tests/cadence-dispatch.test.ts` (new, 448 lines) — 7 cases against the hosted Sydney database, including both race interleavings
- `tests/cadence-resume.test.ts` (new, 201 lines) — 4 cases proving the applier, not just the rule
- `tests/cadence-tick.test.ts` — the quiet-tick `toEqual` widened deliberately, and the window helper rewritten to ask the engine (deviation 2)

## Decisions Made

Recorded in `key-decisions` above. The three worth reading in full:

1. **`send_now` requires the D-09 same-day margin, not merely being inside contact hours.** The plan's behaviour lines could be read either way, and the two readings differ for exactly one case: a touch that comes due with less than an hour of the window left. Sending it is technically compliant. It is also the ambush D-09 was written about — the tradie is packing up, the customer's reply lands after hours, and the answer sits unread until the following week. The margin already governs where a slot may be PLACED; letting it not govern whether a touch may be SENT would mean the engine refuses to schedule something at 16:55 while happily sending at 16:55. The visible consequence is that `nextAllowedSlot`'s same-day branch is unreachable from the re-window path, which is correct rather than wasteful: a touch we may send is sent, never re-placed eleven minutes later for no reason a customer could perceive.

2. **Every threshold boundary falls on the side that keeps the cadence alive, and that was decided once rather than three times.** `> STALENESS_CAP_HOURS`, `> CADENCE_EXPIRY_DAYS`, `< MIN_GAP_HOURS` — each strict, each meaning the named value is still acceptable. Any one of them could defensibly go the other way in isolation, and that is the problem: three independent coin-flips produce a policy nobody chose and nobody can explain to a client. "No more than 72 hours late" includes 72, and the same sentence structure decides the other two.

3. **The production jitter draw was extracted rather than inlined a third time.** The standing purity grep forbids the global random source in `window.ts`, `materialize.ts`, `rewindow.ts` and `resume.ts` — that is what makes CAD-02's determinism assertable at all. But something has to draw the number, and by this plan there were three callers wanting the same bounded one. Three copies of `floor(random × (bound + 1))` is three places the bound can drift from `JITTER_MAX_MINUTES`, and the drift is invisible: the schedule still looks plausible, just not like the one the constant describes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The production jitter draw had nowhere legal to live**

- **Found during:** Task 1
- **Issue:** `applyResumeRewindow` needs a default RNG for callers that have no opinion — `resumeConnection` is one — but the task's own acceptance criterion is that `grep -q "Math.random" src/core/cadence/rewindow.ts src/core/cadence/resume.ts` finds nothing. Putting the draw in `resume.ts` fails the criterion; making the parameter required pushes an RNG expression into `src/core/sync/connect.ts`, where a scheduling policy's bound would sit in a module about ServiceM8 credentials; `constants.ts` is import-free by design and holds magnitudes, not behaviour.
- **Fix:** `src/core/cadence/jitter.ts` — one exported function, reading its bound from `JITTER_MAX_MINUTES`. `run-tick.ts`'s previously-inlined copy now calls it too, so the tick and the resume path draw identically.
- **Files modified:** `src/core/cadence/jitter.ts` (new), `src/core/cadence/resume.ts`, `src/core/cadence/run-tick.ts`
- **Verification:** the purity assertions in `tests/cadence-rewindow.test.ts`; `grep -q "Math.random"` returns nothing for both files
- **Committed in:** `fd0a4c1`

**2. [Rule 1 - Bug] The progress pass introduced a one-hour-a-day flake into the existing tracer suite**

- **Found during:** Task 2
- **Issue:** `tests/cadence-tick.test.ts` seeds an always-open 00:00–23:59 window and dispatches at "touch one's slot plus a minute". With the progress pass now running before dispatch, a `now` inside the last `SAME_DAY_MARGIN_MINUTES` of that window makes `rewindowTouch` MOVE the touch rather than leave it — so the suite would watch its touch get re-windowed and then assert, mystifyingly, that nothing was dispatched. Roughly one run in twenty-four, after 22:59 Perth. This is 03-02's deviation 6 in a larger form: that helper already nudged past the one minute per day the half-open boundary excludes, and the margin widened that hole from a minute to an hour.
- **Fix:** the helper now asks `nextAllowedSlot` for the first contactable moment after the touch's slot, instead of hand-rolling the boundary. Asking the engine's own slot chooser means the helper cannot drift from the rule it compensates for — both edges, the half-open boundary and the margin, are answered by the code that owns them.
- **Files modified:** `tests/cadence-tick.test.ts`
- **Verification:** all 8 tracer cases green; the helper's header now names both edges and why they are the engine's properties rather than the suite's
- **Committed in:** `864a3f4`

**3. [Rule 2 - Missing Critical] The one new database writer had no integration coverage**

- **Found during:** Task 3 close-out
- **Issue:** The plan's validation map assigns three tests, and none of them exercises `applyResumeRewindow` against a database — `tests/rekey-resume.test.ts` proves the hook runs, but its tenants have no cadences, so the applier does no work in it. The pure suite proves the RULE and cannot prove the applier feeds it the right rows or writes the answer back. Every way that fails is silent: a status filter matching nothing, a window read from the wrong columns, a reschedule guarded into a no-op. All of them return cleanly, report zero, and leave a client resuming into exactly the burst D-07 exists to prevent.
- **Fix:** `tests/cadence-resume.test.ts` — four cases against the hosted database: the still-paused refusal, a live cadence's whole remaining schedule moved forward and inside the window, a cadence paused for its own reason left alone (D-05), and idempotence proven by `updated_at` equality rather than by re-reading a slot.
- **Files modified:** `tests/cadence-resume.test.ts` (new)
- **Verification:** 4/4 green; `npm run test:remote` at 45 files / 992 tests
- **Committed in:** `aa0a940`

**4. [Rule 2 - Missing Critical] Every dispatch refusal was an unlabelled decrement**

- **Found during:** Task 3
- **Issue:** The task asks that "every refusal path returns a typed reason in the counts", and `DispatchResult` carried a single `refused` integer fed by `dispatchOne` returning `null`. Six distinct rules collapsed into one number that cannot answer the only question a silent minute raises — nothing to do, or declined everything? Two of the six also had no representation at all in any test assertion, because a count of one is a count of one whatever caused it.
- **Fix:** `DISPATCH_REFUSALS` as a closed vocabulary with a per-reason count on `DispatchResult`; `dispatchOne` returns a discriminated outcome instead of `null`. Deliberately NOT reusing `TOUCH_SKIP_REASONS`: only `quote_closed` and `suppressed` write to that durable column, and the other four describe what this tick decided about a touch that is still live.
- **Files modified:** `src/core/cadence/dispatch.ts`
- **Verification:** the suppression and closed-quote cases assert `result.refusals.suppressed` / `.quote_closed` by name; `CadenceTickResult` is unchanged in shape apart from the counts Task 2 added, so plan 03-06's response body contract is untouched
- **Committed in:** `864a3f4`

**5. [Rule 2 - Missing Critical] `contactWindowOf` was private, so the two passes could have disagreed**

- **Found during:** Task 2
- **Issue:** The progress pass needs a `ContactWindow` built from the same four tenant columns the claim path uses. A second copy of that mapping is a second answer to "may we contact them now" — one used to place a slot, one used to refuse a send — and the disagreement would surface as a touch that is re-windowed and refused in the same minute, indefinitely.
- **Fix:** exported from `dispatch.ts` with the reason stated at the definition.
- **Files modified:** `src/core/cadence/dispatch.ts`, `src/core/cadence/run-tick.ts`
- **Verification:** typecheck; the outside-window case in `tests/cadence-dispatch.test.ts` exercises both passes at the same instant and they agree
- **Committed in:** `647536f`, `864a3f4`

---

**Total deviations:** 5 auto-fixed (1 bug, 3 missing critical, 1 blocking)
**Impact on plan:** No architectural change and no scope creep. Two of the five (1 and 5) are structural consequences of the plan's own acceptance criteria; two (3 and 4) are guarantees the plan's `must_haves` assert but its assigned tests did not reach; one (2) is a pre-existing test helper the new pass widened a hole in. One new source file and one new test file exist beyond the plan's `files_modified`, and both are named above.

## The flagged assumptions, and how each was decided

The plan carried two unclassified edge-probe rows and encoded a direction for each. Both held, and a third question surfaced that the plan did not name:

| Question | Decision | Why this direction |
|---|---|---|
| CAD-02: a touch landing exactly at `contact_hours_end` | outside; re-windows to the next allowed day | 03-07's half-open `[start, end)`, unchanged and now depended on by the re-window path |
| CAD-04: two claimants tying exactly | one INSERT succeeds, one returns zero rows | asserted directly, twice — through the repository and through two separate connections, so the conflict path is observed rather than inferred from a SKIP LOCKED skip |
| **Unnamed by the plan:** does `send_now` require the D-09 margin, or only that the window is open? | requires the margin | the two readings differ only for a touch coming due at knock-off, and sending that one is the ambush D-09 was written about (see Decisions, 1) |

## Issues Encountered

- **No blocker introduced or encountered.** This plan performs no third-party I/O, adds no environment variable, no migration and no endpoint. The Phase 4 IPND address blocker and the ServiceM8 partner-registration watch item are untouched.
- **Other writers that clear a pause, as the plan asked to have surfaced.** `grep -rn "pausedAt: null" src/` finds exactly two, both in `src/core/sync/connect.ts`: `resumeConnection` (hooked) and `connectServiceM8` (line 220, deliberately NOT hooked — a first connect has no cadences, because cadences are created by the outbox consumer after operator triage, so there is nothing to re-window). A third pause-clearing writer exists at the client level, `settings.setPausedAt(null)`, and it has **no caller yet** — plan 03-05 adds the console action, and its own doc comment already states that clearing the column does not itself resume anything and that the caller must run the D-07 re-window. That obligation is now satisfiable in one call.
- **A cadence whose touches all terminate stays `active` until it expires.** `all_touches_done → completed` is a decided cell of 03-03's matrix with no driver in production, and this plan deliberately did not add one: the progress pass is the natural place, but "the cadence ran its course" is an operator-facing state that plan 03-05's console owns, and marking it here would have meant deciding the paused-cadence case (which the matrix says is a no-op) from a pass that does not look at paused cadences. Carried forward below.

## Known Stubs

- **Inherited, unchanged:** `StubSender` and `stubTouchBody` (D-13, plan 03-02), and the auto-passed D-14 draft/approval gates inside `touches.promoteDue`. Both remain deliberate and plan-mandated; this plan reordered when promotion runs but did not change what it does.
- **No new stubs.** Every function shipped here is fully implemented and exercised; there are no `TODO`/`FIXME` markers in the new code and no hardcoded empty value flows anywhere.
- **One documented unreachable branch:** the `expire_cadence` arm inside the tick's per-cadence re-window loop, which the expiry sweep above it makes unreachable. It is HANDLED rather than merely reported — it ends the cadence and retires its touches — on the grounds that a caller which acknowledged one arm of a total policy without acting on it would be deciding by omission.

## Threat Flags

None new. This plan adds no network endpoint, no auth path, no file access and no schema change.

The register's five entries for this plan are mitigated as written:

- **T-3-13** (send outside contact hours) — the `rewindowTouch` policy plus dispatch's unchanged just-in-time window check, with the outside-window case asserting reschedule-never-send against the real database.
- **T-3-14** (duplicate send under race) — the ledger unique index plus `FOR UPDATE … SKIP LOCKED`, asserted under both interleavings including two separate client connections.
- **T-3-15** (suppressed contact sent after enqueue) — the same-transaction suppression re-read, with the enqueue→suppress→refuse case asserting zero ledger rows.
- **T-3-16** (burst-send on resume) — `computeResumeSchedule` preserves the original gaps, and the single `applyResumeRewindow` is now shared by `resumeConnection`; the never-bursts property is asserted as its own case rather than inferred.
- **T-3-17** (overlapping ticks blocking on locks) — SKIP LOCKED skips contended rows and every refusal is counted rather than thrown, proven by the race test's two calls both returning cleanly.

## User Setup Required

None — no external service configuration, no new environment variable, no migration.

## Next Phase Readiness

**Ready. The "never late, never twice, never stale" half of the phase is proven rather than promised.**

- **03-05 (operator controls)** inherits `applyResumeRewindow` ready to call. Both console resume actions — the D-06 client resume and the D-05 operator resume — must clear their pause FIRST and then call it; the function refuses while either pause is still in force, and returns `stillPaused: true` rather than silently doing nothing. For the D-05 case, resume the cadence itself (`resumeWherePaused`) before calling, because the applier deliberately moves only `active` cadences.
- **03-06 (tick route)** should note that `CadenceTickResult` gained three counts (`cadencesExpired`, `touchesRewindowed`, `touchesSkipped`). It is still counts-only — no client names, no addresses, no error strings — so the response body contract that plan owns is unchanged in kind.
- **CARRIED FORWARD:**
  - `all_touches_done → completed` still has no production driver (see Issues). A cadence whose touches all terminated stays `active` until D-12 expires it. 03-05 or 03-06 should decide where that write belongs; the matrix already says a PAUSED cadence must stay on the operator's queue.
  - The Phase 4 gap 03-03 opened is untouched and still open: `cadenceTransition` prescribes `paused(client_paused) + customer_reply → paused(customer_reply)`, and no repository method can perform that write.
- **Contracts later plans must honour (added to 03-02's and 03-03's):**
  - The re-window pass is the ONLY writer of a new `scheduled_at` outside materialization and resume. Dispatch validates; it never chooses a time.
  - Never ask `rewindowTouch` about a touch whose cadence is paused, and never run it for a paused tenant. Their repair is the resume's job, and per-tick drift is what makes a resume burst.
  - A dispatch refusal reason is not a skip reason. Only `quote_closed` and `suppressed` write to `cadence_touches.skip_reason`; the other four describe a live touch this tick declined.
  - `applyResumeRewindow` is the single D-07 implementation. A second one — for a new resume path, in a hurry — is a second answer to when messaging starts again, and the first anyone would learn of the disagreement is a design partner forwarding a screenshot.

---
*Phase: 03-cadence-engine*
*Completed: 2026-08-27*

## Self-Check: PASSED

Created files verified present on disk:
- `src/core/cadence/rewindow.ts`, `resume.ts`, `jitter.ts` — FOUND
- `tests/cadence-rewindow.test.ts`, `tests/cadence-dispatch.test.ts`, `tests/cadence-resume.test.ts` — FOUND

Commits verified in `git log`:
- `5dfbf8b`, `fd0a4c1`, `647536f`, `864a3f4`, `aa0a940` — all FOUND

Plan-level verification re-run at close-out:
- `npx vitest run tests/cadence-rewindow.test.ts` — PASS (29/29, no database, no `ALLOW_REMOTE_TESTS`)
- `ALLOW_REMOTE_TESTS=yes npx vitest run tests/cadence-dispatch.test.ts tests/cadence-tick.test.ts tests/rekey-resume.test.ts tests/cadence-resume.test.ts` — PASS (30/30 against the hosted Sydney project)
- `npm run typecheck` — PASS
- `npm run lint` (`--max-warnings=0`) — PASS
- `npm run test:remote` — PASS (45 files, 992 tests; no regression)

All task acceptance criteria re-verified:
- All five action arms covered with explicit boundary cases at exactly `STALENESS_CAP_HOURS`, exactly `MIN_GAP_HOURS` and exactly `CADENCE_EXPIRY_DAYS`, each test name stating which side the boundary falls on.
- The resume case asserts consecutive gaps of 4, 7 and 7 calendar days in the tenant zone — the original 3/7/14/21 offset deltas — plus every slot inside the window and every pair at least `MIN_GAP_HOURS` apart.
- `grep -q "Math.random" src/core/cadence/rewindow.ts src/core/cadence/resume.ts` → no match. `grep` for `next/`, `drizzle` and `@/db` in `rewindow.ts` → no match (the header names these absences in prose only, the 03-07 lesson applied). `resume.ts` matches `forTenant` and does not match `getDb` or `repository/client`.
- `grep -q "applyResumeRewindow" src/core/sync/connect.ts` → matches, on the success path after the unpause write and the immediate cycle.
- `run-tick.ts` excludes both `connectionPausedAt` and `settingsPausedAt` from the progress pass; `dispatch.ts` excludes both from the dispatch pass.
- The race test constructs two `postgres()` client instances of its own and asserts one ledger row and one stub send after `Promise.all`; the duplicate `insertClaim` returns `[]`; each of the four JIT refusal scenarios asserts the absence of a ledger row alongside its named touch and cadence outcome; the outside-window case asserts the new `scheduled_at` is strictly greater than the injected `now` and inside the window.
