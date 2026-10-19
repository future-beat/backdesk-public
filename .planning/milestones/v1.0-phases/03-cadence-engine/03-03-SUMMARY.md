---
phase: 03-cadence-engine
plan: 03
subsystem: cadence-engine
tags: [state-machine, cadence, outbox, idempotency, transitions, d-05, d-08, exhaustive-testing]

# Dependency graph
requires:
  - phase: 02-servicem8-sync-quote-leakage-audit
    provides: the quote_status_events outbox with its five-member CHECK-constrained vocabulary, markChaseEligible as the real emitter, the framework-free-core header convention, and src/core/sync/transitions.ts as the canonical total-function analog
  - phase: 03-cadence-engine
    provides: "03-01's cadence/touch vocabularies and guarded repository namespaces (stopWhereLiveByQuoteIds, skipUnsentForCadences, flagNeedsReviewOnReopen); 03-02's consumer, contiguous-run transaction unit and cursor co-commit"
provides:
  - cadenceTransition — a pure TOTAL function over CADENCE_STATUSES x CADENCE_EVENTS, every cell a recorded human decision
  - touchTransition — the same over TOUCH_STATUSES x TOUCH_EVENTS, with the skip reason required rather than defaulted
  - CADENCE_EVENTS and TOUCH_EVENTS as the closed event vocabularies Phases 4/5/6 raise
  - consumeQuoteEvents completed to all five outbox event types; the tracer's stop-at-unhandled prefix guard removed
  - The D-08 reopen path — stop plus operator triage plus cursor advance, co-committed
  - tests/cadence-transitions.test.ts — 114 hand-written matrix cells and three guards over the table itself
  - tests/cadence-consume-events.test.ts — real-DB proof of the four stops, their skip reasons, sequential cadences and replay no-ops
affects: [03-04 rewindow and dispatch hardening, 03-05 operator controls, 03-06 tick route, 04-messaging (inbound replies raise customer_reply), 05-drafting, 06-approval-console, 07-reporting]

actuals:
  tokens: 28940
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "The transition matrix as a hand-written literal table: expectations are decided per cell by a human, never computed from the rule under test"
    - "A machine's answer resolved ONCE at module load, so a broken matrix fails at import rather than inside a transaction with a customer at the other end"
    - "Decided-quote dominance: closing events stop a cadence identically from every live state, which is what makes one guarded UPDATE over all live rows correct without reading each row's status"
    - "Pause-reason stickiness expressed as matrix cells rather than as caller discipline — a client pause never replaces or lifts a customer_reply pause"
    - "Replay proven by `updated_at` equality, which distinguishes 'the write was refused' from 'the write happened and produced the same result'"

key-files:
  created:
    - src/core/cadence/transitions.ts
    - tests/cadence-transitions.test.ts
    - tests/cadence-consume-events.test.ts
  modified:
    - src/core/cadence/consume-events.ts
    - src/core/sync/eligibility.ts

key-decisions:
  - "customer_reply arriving at a client_paused cadence UPGRADES the pause reason rather than being a no-op — leaving client_paused would let the client's own resume restart messaging at somebody mid-conversation, which is exactly what D-05 forbids"
  - "all_touches_done at a PAUSED cadence is a no-op: completing it would clear it off the operator's queue and discard the fact that a human still owes it an answer"
  - "A paused row with no recorded reason resumes only for an operator — the two readings of an uninterpretable pause are not equally safe, and the cheap mistake is making a human click"
  - "The consumer derives each stop reason from cadenceTransition ONCE at module load rather than restating it as a literal or recomputing per event, so a matrix that stopped prescribing a stop fails at import instead of inside a live transaction"
  - "Skip reasons split by honesty, not convenience: won/lost skip touches as quote_closed (the quote did close), removed/reopened as cadence_stopped (a reopened quote is still an open Quote row, so quote_closed would be a false statement in Phase 7's evidence)"
  - "The D-08 reopen triage flip runs UNCONDITIONALLY, not only when a cadence stopped — the triage decision is about the quote, and usually no live cadence survives to that point because the earlier won/lost already stopped it"
  - "A defensive unknown-event-type guard replaces the tracer guard it is not: that one blocked on types this build knew about and had not implemented; this one can only fire on a type nothing in the codebase has ever heard of, and is unreachable while the CHECK constraint holds"
  - "quotesFlaggedForReview is added to the consume result but deliberately NOT to CadenceTickResult — the tick's counts-only response body is plan 03-06's contract, and widening it here would change a shape that plan owns"

patterns-established:
  - "Total transition functions with no default branch: TypeScript exhaustiveness is the guard, so adding a vocabulary member stops the build rather than silently falling through"
  - "Event vocabularies deliberately aligned across module boundaries, with the mapping written out anyway so a rename breaks the build rather than quietly matching nothing"
  - "Integration tests that order a batch adversarially (a closing event FIRST) to prove a removed guard is actually gone, rather than asserting the happy order"

requirements-completed: [CAD-01, CAD-03]

coverage:
  - id: D1
    description: "cadenceTransition is a pure TOTAL function: every (status, pauseReason, event) triple returns a well-formed outcome, never throws, and every declared cell matches a hand-written literal expectation"
    requirement: "CAD-03"
    verification:
      - kind: unit
        ref: "tests/cadence-transitions.test.ts#cadenceTransition — the full (status x event) matrix (CAD-03) (84 per-cell cases)"
        status: pass
      - kind: unit
        ref: "tests/cadence-transitions.test.ts#is TOTAL — every (status, pauseReason, event) triple returns a well-formed outcome"
        status: pass
      - kind: unit
        ref: "tests/cadence-transitions.test.ts#enumerates every declared state row against every event — no cell is unasserted"
        status: pass
    human_judgment: false
  - id: D2
    description: "won and lost stop a cadence whether it is active OR paused — a decided quote is never chased again, even mid-pause"
    requirement: "CAD-03"
    verification:
      - kind: unit
        ref: "tests/cadence-transitions.test.ts#cadenceTransition — decided-quote dominance (the consumer depends on this)"
        status: pass
      - kind: integration
        ref: "tests/cadence-consume-events.test.ts#stops a live cadence on `won` and retires its unsent touches as quote_closed"
        status: pass
      - kind: integration
        ref: "tests/cadence-consume-events.test.ts#stops a live cadence on `lost`, with a reason distinct from `won`"
        status: pass
    human_judgment: false
  - id: D3
    description: "customer_reply at a stopped cadence is a no-op, and a reply pause is lifted only by an explicit operator action — never by a client-level resume (D-05)"
    requirement: "CAD-03"
    verification:
      - kind: unit
        ref: "tests/cadence-transitions.test.ts#stopped|null + customer_reply -> noop"
        status: pass
      - kind: unit
        ref: "tests/cadence-transitions.test.ts#paused|customer_reply + client_resumed -> noop"
        status: pass
      - kind: unit
        ref: "tests/cadence-transitions.test.ts#paused|customer_reply + client_paused -> noop"
        status: pass
      - kind: unit
        ref: "tests/cadence-transitions.test.ts#paused|client_paused + customer_reply -> paused(customer_reply)"
        status: pass
    human_judgment: false
  - id: D4
    description: "removed stops the cadence terminally; reopened stops any live cadence AND flips the quote to needs_review in the same transaction — no auto-restart (D-08)"
    requirement: "CAD-01"
    verification:
      - kind: integration
        ref: "tests/cadence-consume-events.test.ts#stops a live cadence on `removed`, skipping touches as cadence_stopped"
        status: pass
      - kind: integration
        ref: "tests/cadence-consume-events.test.ts#stops on `reopened` and returns the quote to operator triage in the same pass"
        status: pass
      - kind: integration
        ref: "tests/cadence-consume-events.test.ts#starts a fresh, second cadence when the operator re-triages a reopened quote"
        status: pass
    human_judgment: false
  - id: D5
    description: "Stopping a cadence skips its unsent touches with an auditable skip reason — nothing remains claimable by dispatch after a stop"
    requirement: "CAD-03"
    verification:
      - kind: integration
        ref: "tests/cadence-consume-events.test.ts (all four stop tests assert every touch skipped with the reason that decided it)"
        status: pass
      - kind: unit
        ref: "tests/cadence-transitions.test.ts#carries THE GIVEN skip reason through, never a substituted one"
        status: pass
    human_judgment: false
  - id: D6
    description: "The consumer handles the full five-event vocabulary and the tracer's cursor stop-at-unhandled guard is removed — the cursor advances through every event type"
    requirement: "CAD-01"
    verification:
      - kind: integration
        ref: "tests/cadence-consume-events.test.ts#walks the whole batch, whatever the event type of its first row"
        status: pass
      - kind: integration
        ref: "tests/cadence-consume-events.test.ts#advances the cursor through all five outbox event types"
        status: pass
      - kind: integration
        ref: "tests/cadence-consume-events.test.ts#consumes a closing event for a quote with no cadence, changing nothing"
        status: pass
    human_judgment: false
  - id: D7
    description: "Replaying a stop event is a zero-row no-op — the guarded UPDATE matches nothing and no state changes, proven by updated_at rather than by re-reading a status"
    requirement: "CAD-01"
    verification:
      - kind: integration
        ref: "tests/cadence-consume-events.test.ts (expectReplayIsANoOp, invoked from all four stop tests after a deliberate cursor rewind)"
        status: pass
    human_judgment: false
  - id: D8
    description: "touchTransition is total over the D-14 lifecycle; sent and skipped reject all further transitions, and only an approved touch can be recorded as sent"
    verification:
      - kind: unit
        ref: "tests/cadence-transitions.test.ts#touchTransition — the full (status x event) matrix (D-14) (30 per-cell cases)"
        status: pass
      - kind: unit
        ref: "tests/cadence-transitions.test.ts#is TOTAL — every cell returns a well-formed outcome and never throws"
        status: pass
    human_judgment: true
    rationale: "The touch machine is not yet DRIVEN by any production path — Phase 3's touches.promoteDue compresses scheduled → approved in one statement (D-14, stubbed gates). The matrix proves the specification is total and self-consistent; whether it is the RIGHT specification for Phases 5 and 6 is a judgment no Phase 3 test can make"
  - id: D9
    description: "The stale D-01 anchor comment in src/core/sync/eligibility.ts is corrected so the detection-moment anchor has exactly one written story in the codebase"
    verification:
      - kind: other
        ref: "grep -c 'D-01' src/core/sync/eligibility.ts → 1; git diff --stat shows 14 insertions / 3 deletions, every changed line inside the doc comment"
        status: pass
    human_judgment: true
    rationale: "Whether the new wording actually stops a future reader reaching for occurred_at is a judgment about prose that no automated check can make; the automated part only proves the comment changed and names D-01"
  - id: D10
    description: "The cadence modules stay framework-free and the whole repository is green"
    verification:
      - kind: other
        ref: "grep -rn \"from 'next/\" src/core/cadence/ → no matches; npm run typecheck; npm run lint (--max-warnings=0)"
        status: pass
      - kind: integration
        ref: "npm run test:remote → 42 files, 952 tests, all pass"
        status: pass
    human_judgment: false

# Metrics
duration: 22 min
completed: 2026-08-27
status: complete
---

# Phase 3 Plan 03: Deterministic Stops and Pauses Summary

**Two pure total state machines whose 114 cells were each decided by hand rather than derived, wired into an outbox consumer that now acts on all five event types — so a won, lost, deleted or renegotiated quote stops being chased from every state it could be in, and replaying the signal changes nothing.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-08-27T20:54:00Z
- **Completed:** 2026-08-27T21:16:00Z
- **Tasks:** 2
- **Files modified:** 5 (3 created, 2 modified)

## Accomplishments

- **The CAD-03 matrix is now an executable specification, and every cell in it is a recorded human decision.** `cadenceTransition` is total over five statuses × twelve events, with the paused row split three ways (both reasons and the unreadable one) — 84 cells, each asserted against a literal expectation with the reasoning written beside it. Phase 2's won/lost gap was not a broken rule; it was a cell nobody looked at, and a table generated from the same rule the implementation uses would have had exactly that blind spot. Three guards protect the table itself: completeness (deleting a block fails), totality (every triple returns, including the ones the database cannot hold), and never-throws.
- **Decided-quote dominance is proven where the consumer depends on it, not assumed at the call site.** `won`/`lost`/`removed`/`reopened` produce the same stop from `active` and from both pauses. That identity is what makes the consumer's single guarded `UPDATE … WHERE status IN ('active','paused')` correct without first reading each row's status — so it is asserted as its own named property rather than left implicit in four separate cells.
- **The D-05 asymmetry is now two matrix cells instead of caller discipline.** A `client_resumed` cannot lift a `customer_reply` pause, and a `client_paused` arriving at one is refused. The cell that is not in the plan's list is the mirror: `customer_reply` arriving at a `client_paused` cadence **upgrades** the reason. Leaving `client_paused` there would have handed the client a lever that restarts messaging at somebody mid-conversation — the same failure D-05 forbids, reached from the other direction.
- **The full outbox vocabulary is consumed and the tracer's prefix guard is gone.** `HANDLED_EVENT_TYPES` and the stop-at-unhandled loop are deleted; the cursor now walks every event type. The suite proves it adversarially: a batch whose FIRST row is a `lost` and whose second is a `quote_opened` is consumed entirely, where the old guard would have consumed zero events and left the cursor where it was.
- **A reopen is triage, not a restart, and both halves commit together.** `reopened` stops the live cadence, retires its touches, and flips the quote to `needs_review` in one transaction that ends with the cursor advance. The suite then re-triages and asserts a **second** cadence with a **later anchor** and exactly one live row — the sequential history the partial unique index is partial for.
- **Replay is proven by `updated_at`, not by re-reading a status.** A guarded UPDATE matching zero rows cannot touch the column; an unguarded one would rewrite it even when setting identical values. Comparing timestamps is what distinguishes "the write was refused" from "the write happened and produced the same result" — an assertion on `stop_reason` alone cannot tell those apart, and the second one is a bug.

## Task Commits

1. **Task 1 (RED): the exhaustive matrix, failing** — `9fd8bf5` (test)
2. **Task 1 (GREEN): the two total state machines** — `98d1a42` (feat)
3. **Task 2: full five-event consumption, reopen triage, anchor comment fix** — `be04ec6` (feat)

_No REFACTOR commit: the GREEN implementation is the shape the header argues for, and there was nothing to clean up._

## Files Created/Modified

### Core

- `src/core/cadence/transitions.ts` (new, 452 lines) — both machines, with a header that names the six cells deliberately differing from naive expectation, and a closing section on what the file does NOT decide (gating, persistence, anything about the world)
- `src/core/cadence/consume-events.ts` — the closing-event handler, the module-load stop-reason derivation, the D-08 reopen co-commit, the removal of the prefix guard, and a defensive unknown-type guard that is explicitly not the one it replaces
- `src/core/sync/eligibility.ts` — comment only: `occurred_at` is Phase 7 attribution honesty, the Phase 3 anchor is D-01's detection moment

### Tests

- `tests/cadence-transitions.test.ts` (new, 1137 lines) — 114 hand-written cells plus five guards; runs on a bare `npm test`, no database
- `tests/cadence-consume-events.test.ts` (new, 474 lines) — 8 cases against the hosted Sydney database

## Decisions Made

Recorded in `key-decisions` above. The three worth reading in full:

1. **`customer_reply` at a `client_paused` cadence upgrades the pause reason.** The plan enumerated the stickiness rule in one direction only (a client pause must not overwrite a reply pause). The mirror cell was unspecified, and the naive answer — leave it alone, the cadence is already paused — is wrong for the same reason the specified one is: if the reason still reads `client_paused` when the client taps resume, the cadence restarts at a customer who is mid-conversation. The invariant is not "don't overwrite"; it is "once a customer has replied, only a human resumes", and preserving it requires movement in one direction and refusal in the other.

2. **The stop reason is resolved from the machine once, at module load.** Restating `'won'` as a literal in the consumer would create a second place the answer lives, and the two can drift silently — the whole failure mode this plan exists to close. Recomputing per event would be honest but would push a broken-matrix failure into a live transaction. Resolving at import means the cadence engine simply refuses to start if `cadenceTransition` ever stops prescribing a stop for a closing event, which is a failure in CI, in a deploy, or in a test run: everywhere except in front of a customer.

3. **The two skip reasons are assigned by what is true, not by what sounds tidy.** `quote_closed` says the quote stopped being an open, chase-eligible Quote — true of a won or lost job. It is NOT true of a `reopened` one: that quote row still reads `status = 'Quote'`, which is the entire point of a reopen. So reopened (and removed, whose row also still says `Quote` — only `sm8_active` flipped) get `cadence_stopped`. This is 03-02's rule applied again: every member of `TOUCH_SKIP_REASONS` is a rule that decided something, and Phase 7 reads the column as evidence.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] The mirror cell of the D-05 stickiness rule was unspecified**

- **Found during:** Task 1
- **Issue:** The plan specifies `client_paused` at `paused('customer_reply')` → noop, and `client_resumed` at `paused('customer_reply')` → noop. It does not say what `customer_reply` does at `paused('client_paused')`. The naive answer (noop — already paused) leaves `pause_reason = 'client_paused'`, which means the client's own resume can later lift a pause that a customer's reply created. That is the exact failure D-05 exists to prevent, reached from the other direction, and the flagged-assumption note in the plan explicitly asks for genuinely ambiguous cells to be surfaced rather than guessed.
- **Fix:** The cell UPGRADES the reason to `customer_reply`. Documented as header note 3 in `transitions.ts` and asserted with its reasoning in the matrix.
- **Files modified:** `src/core/cadence/transitions.ts`, `tests/cadence-transitions.test.ts`
- **Verification:** `tests/cadence-transitions.test.ts#paused|client_paused + customer_reply -> paused(customer_reply)`
- **Committed in:** `98d1a42`
- **CARRIED FORWARD:** no repository method performs this write today. `cadences.pauseWhereActive` deliberately pauses only from `active` (its header explains why: to stop a client pause overwriting a reply pause). Phase 4, which raises `customer_reply` from inbound SMS, must add a guarded pause-or-upgrade write — see "Next Phase Readiness".

**2. [Rule 2 - Missing Critical] `all_touches_done` at a paused cadence was unspecified**

- **Found during:** Task 1
- **Issue:** The plan gives `all_touches_done at active → completed` and says nothing about the paused rows. Both answers are defensible until you ask who is looking: a paused cadence is on an operator's queue precisely because a human owes it a decision, and marking it `completed` would remove it from that queue and discard the pause reason.
- **Fix:** noop from both pauses (and from the unreadable one), with the reasoning in the cell.
- **Files modified:** `src/core/cadence/transitions.ts`, `tests/cadence-transitions.test.ts`
- **Verification:** three matrix cells, plus the totality guard
- **Committed in:** `98d1a42`

**3. [Rule 2 - Missing Critical] A `paused` row with no recorded reason**

- **Found during:** Task 1
- **Issue:** The schema permits `status = 'paused'` with `pause_reason IS NULL`, and no writer in this codebase produces one — but a total function must answer for it, and the plan's "paused split by both pause reasons" enumerates only two of the three. The two readings are not equally safe: resume it automatically and we may message somebody mid-conversation; refuse and an operator has to click.
- **Fix:** a fourth declared state row in the matrix. `operator_resumed` lifts it, `client_resumed` and `client_paused` do not, `customer_reply` records the reason it now knows. Header note 6.
- **Files modified:** `src/core/cadence/transitions.ts`, `tests/cadence-transitions.test.ts`
- **Verification:** twelve matrix cells; the totality loop covers every status × pauseReason × event triple, including combinations the database cannot hold
- **Committed in:** `98d1a42`

**4. [Rule 2 - Missing Critical] The D-08 triage flip must not be conditional on a cadence having stopped**

- **Found during:** Task 2
- **Issue:** The plan's phrasing ("stop any live cadence … AND `quotes.flagNeedsReviewOnReopen`") reads naturally as one guarded sequence. But by the time a `reopened` arrives there is usually no live cadence — the earlier `won` or `lost` already stopped it — so a flip gated on `stopped.length > 0` would silently skip triage in the ordinary case, leaving a renegotiated quote sitting at `eligible` with nobody chasing it and nobody being asked about it.
- **Fix:** the flip is unconditional; the guard that makes it idempotent is its own `WHERE chase_eligibility = 'eligible'`, not the cadence stop. Documented at the call site.
- **Files modified:** `src/core/cadence/consume-events.ts`
- **Verification:** `tests/cadence-consume-events.test.ts#stops on reopened…` asserts `quotesFlaggedForReview === 1` and the column value; the replay assertion proves the second flip returns zero rows
- **Committed in:** `be04ec6`

**5. [Rule 3 - Blocking] An unknown event type would have fallen off the end of the switch**

- **Found during:** Task 2
- **Issue:** Removing the prefix guard leaves `event.eventType` as a bare `string` (the column is `text`, CHECK-constrained). An exhaustive switch over `QuoteEventType` compiles, but a value outside the vocabulary would fall through and return `undefined` at runtime — inside a transaction, with the cursor about to advance.
- **Fix:** an `isKnownEventType` narrowing guard that blocks the run loudly, documented as unreachable while the CHECK constraint holds and explicitly distinguished from the tracer guard it is not (that one blocked on KNOWN-but-unimplemented types; this one can only fire on a type nothing in the codebase has ever heard of).
- **Files modified:** `src/core/cadence/consume-events.ts`
- **Verification:** typecheck; the five-type walk test proves no legitimate type reaches it
- **Committed in:** `be04ec6`

**6. [Rule 2 - Missing Critical] Reopen triage was invisible in the consumer's result**

- **Found during:** Task 2
- **Issue:** `ConsumeQuoteEventsResult` had no way to say a quote had been returned to triage, so the reopen test could only assert the column value and not that the consumer knew what it had done — and an operator-facing tick would report a reopen as "one cadence stopped", which is half the story.
- **Fix:** `quotesFlaggedForReview` added to the consume result. Deliberately NOT added to `CadenceTickResult`: the tick's counts-only response body is plan 03-06's contract and widening it here would change a shape that plan owns (and that `tests/cadence-tick.test.ts` asserts exactly).
- **Files modified:** `src/core/cadence/consume-events.ts`
- **Verification:** asserted in three cases of the new suite; `tests/cadence-tick.test.ts`'s quiet-tick `toEqual` still passes unchanged
- **Committed in:** `be04ec6`

**7. [Rule 3 - Blocking] An unused constant tripped `--max-warnings=0`**

- **Found during:** Task 2
- **Issue:** A `NOTHING_APPLIED` constant left over from an earlier shape of `applyEvent` was never referenced; `npm run lint` runs at zero tolerance.
- **Fix:** deleted.
- **Files modified:** `src/core/cadence/consume-events.ts`
- **Verification:** `npm run lint` clean
- **Committed in:** `be04ec6`

---

**Total deviations:** 7 auto-fixed (5 missing critical, 2 blocking)
**Impact on plan:** No architectural change and no scope creep. Five of the seven are cells or conditions the plan's own `must_haves` require and did not enumerate — which is the point of an exhaustive matrix, and exactly the flagged-assumption note's instruction to decide contentious cells explicitly and surface them here rather than guess. Deviation 1 is the only one that creates work for a later phase, and it is named below.

## The cells the plan flagged as potentially ambiguous, and how each was decided

The plan carried an unclassified edge-probe row for CAD-03 and asked that any genuinely ambiguous cell be surfaced rather than guessed. Four qualified:

| Cell | Decision | Why this direction |
|---|---|---|
| `customer_reply` at `paused(client_paused)` | upgrade to `customer_reply` | preserves "once a customer replies, only a human resumes" (deviation 1) |
| `all_touches_done` at either pause | noop | a paused cadence stays on the operator's queue (deviation 2) |
| `paused` with a NULL reason | operator-only resume | the unsafe reading messages somebody mid-conversation; the safe one costs a click (deviation 3) |
| `expired_deadline` at a pause | expire | D-12 does not stop running because a client paused — the quote still goes cold |

None was left to the implementation's discretion; each is a literal cell in the matrix with its reasoning attached.

## Issues Encountered

- **None blocking.** Both suites went green on their first full run; the only red was the intended RED phase and one zero-tolerance lint warning (deviation 7).
- **The suite parks the shared cursor at the outbox head**, the same convention 03-02 established, because `event_consumer_cursors` holds one row for the whole engine. Both cadence suites now do this and they run sequentially (`fileParallelism: false`), so they do not contend.
- **The Phase 4 IPND address blocker and the ServiceM8 partner-registration watch item are untouched.** This plan performs no third-party I/O and adds no environment variable, migration or endpoint.

## Known Stubs

- **`touchTransition` is shipped ahead of its drivers, deliberately (D-14).** `touches.promoteDue` still compresses `scheduled → approved` in one statement because Phase 3 auto-passes both gates; nothing in production calls `touchTransition` yet. This is the same one-way argument that put `needs_draft` and `pending_approval` in the vocabulary in 03-01: Phases 5 and 6 replace one repository method rather than migrating live cadences and rewriting the CAD-03 suite. Recorded as `human_judgment: true` on coverage entry D8 for the same reason.
- **No unintended stubs.** Every function shipped here is fully implemented, there are no `TODO`/`FIXME` markers in the new code, and no hardcoded empty value flows anywhere.

## Threat Flags

None new. This plan adds no network endpoint, no auth path, no file access and no schema change.

The register's three entries for this plan are mitigated as written:

- **T-3-10** (an unconsidered matrix cell chases a decided quote) — the exhaustive hand-written table over the full product, with completeness and totality asserted over the table itself, and the four contentious cells named in the plan's acceptance criteria each asserted individually.
- **T-3-11** (`reopened` auto-restarts chasing mid-negotiation) — stop plus `needs_review` triage in one transaction, proven by the reopen test; a new cadence appears only after an explicit operator flip, proven by the re-triage test.
- **T-3-12** (replayed stop events double-mutate state) — guarded `UPDATE … WHERE status IN ('active','paused')` writes, with replay asserted for all four closing events via a deliberate cursor rewind and an `updated_at` equality check that a status assertion could not make.

## User Setup Required

None — no external service configuration, no new environment variable, no migration.

## Next Phase Readiness

**Ready. The stop half of the machine is complete and proven.**

- **03-04 (re-window and dispatch hardening)** inherits an unchanged dispatch seam. Nothing here touches `dispatch.ts`, `claimDue` or the JIT refusals; the four-scenario refusal matrix and the two-connection concurrency race remain that plan's assigned tests (3-04-03).
- **03-05 (operator controls)** now has the machine its actions must agree with: `operator_closed`, `operator_resumed`, `client_paused`, `client_resumed` and `contact_killed` are all decided cells. Every console action should derive its outcome from `cadenceTransition` rather than restating a status, the way `consume-events.ts` does.
- **03-06 (tick route)** is unaffected: `CadenceTickResult` is deliberately unchanged, so the counts-only response body that plan owns is still exactly the shape 03-02 left.
- **CARRIED FORWARD TO PHASE 4 (inbound replies)** — the one real gap this plan opens: `cadenceTransition` prescribes `paused(client_paused) + customer_reply → paused(customer_reply)`, and **no repository method can perform that write today.** `cadences.pauseWhereActive` pauses only from `active`, deliberately (its header explains that re-pausing an already-paused cadence would overwrite `customer_reply` with `client_paused`). Phase 4 needs a guarded pause-or-upgrade write — something shaped like `UPDATE … SET pause_reason = 'customer_reply' WHERE status IN ('active','paused') AND pause_reason IS DISTINCT FROM 'customer_reply'` — and must NOT reach for `pauseWhereActive`, which would silently do nothing for a client-paused cadence and leave the client able to resume into a live conversation.
- **Contracts later plans must honour (carried forward from 03-02, plus this plan's):**
  - Derive outcomes from `transitions.ts`; never restate a status or a reason as a literal at a call site.
  - Advance the cursor only for events whose actions committed in the SAME transaction, and never step a failed run over.
  - Never write a `TOUCH_SKIP_REASON` that did not actually decide the skip — Phase 7 reads that column as evidence.
  - A stop is terminal. Re-chasing a stopped cadence is a NEW cadence from a NEW anchor, created by operator re-triage.

---
*Phase: 03-cadence-engine*
*Completed: 2026-08-27*

## Self-Check: PASSED

Created files verified present on disk:
- `src/core/cadence/transitions.ts` — FOUND
- `tests/cadence-transitions.test.ts` — FOUND (1137 lines, exceeds the plan's `min_lines: 100`)
- `tests/cadence-consume-events.test.ts` — FOUND

Commits verified in `git log`:
- `9fd8bf5` — FOUND
- `98d1a42` — FOUND
- `be04ec6` — FOUND

Plan-level verification re-run at close-out:
- `npx vitest run tests/cadence-transitions.test.ts` — PASS (124 tests, no database)
- `ALLOW_REMOTE_TESTS=yes npx vitest run tests/cadence-consume-events.test.ts` — PASS (8/8 against the hosted Sydney project)
- `ALLOW_REMOTE_TESTS=yes npx vitest run tests/cadence-tick.test.ts` — PASS (8/8; the guard removal did not regress the tracer)
- `npm run typecheck` — PASS
- `npm run lint` (`--max-warnings=0`) — PASS
- `npm run test:remote` — PASS (42 files, 952 tests; no regression)

Task acceptance criteria re-verified:
- The matrix test iterates the full product and asserts per-cell LITERAL expectation objects (no computed expectations anywhere in the file).
- The four named cells are asserted individually: `won` at `paused` → `stopped('won')`; `customer_reply` at `stopped` → noop; `client_resumed` at `paused('customer_reply')` → noop; `client_paused` at `paused('customer_reply')` → noop.
- `touchTransition` covers all 30 cells; `sent` and `skipped` return noop for all five events.
- `grep -ci "default" src/core/cadence/transitions.ts` → 6, **all in prose comments**; there is no `default:` branch and no `throw` statement anywhere in the transition switches (`grep -n throw` → 5 hits, all in comments).
- `grep -c "D-01" src/core/sync/eligibility.ts` → 1; `git diff --stat` shows 14 insertions / 3 deletions, every changed line inside the doc comment — comment-only, no code change.
- `grep -rn "from 'next/" src/core/cadence/` → no matches.
