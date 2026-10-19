---
phase: 03-cadence-engine
plan: 02
subsystem: cadence-engine
tags: [cadence, outbox, dispatch, idempotency, skip-locked, send-ledger, tracer, compliance]

# Dependency graph
requires:
  - phase: 02-servicem8-sync-quote-leakage-audit
    provides: the quote_status_events transactional outbox and its written consumption contract, event_consumer_cursors, markChaseEligible as the real event source, sm8_connections.paused_at, the framework-free-core header convention
  - phase: 03-cadence-engine
    provides: "03-01's six cadence tables, guarded repository namespaces, forAllTenants_cadenceTick / forAllTenants_pendingQuoteEvents, test seeders; 03-07's pure scheduling core (materializeCadenceSchedule, isInsideWindow, selectPrimaryContact) and named policy constants"
provides:
  - The D-13 TouchSender / SendRequest / SendOutcome contract Phase 4 swaps an implementation into, plus StubSender (provider 'stub')
  - consumeQuoteEvents — the outbox consumer, with cursor registration, contiguous same-tenant runs, and act-and-advance co-commit
  - dispatchDueTouches — the claim transaction (FOR UPDATE SKIP LOCKED), the four just-in-time refusals, and the ledger claim
  - runCadenceTick — the ordered consume/promote/dispatch tick with injectable clock, RNG and sender
  - touches.claimDue and touches.markSent, quoteContacts.listForJob, settings.get, consumerCursor.advanceTo, registerConsumerCursor / readConsumerCursor
  - A real-DB end-to-end suite covering the happy path, replay, both creation gates, the quiet tick, and the enqueue-then-suppress refusal
affects: [03-03 event consumption and transitions, 03-04 rewindow and dispatch hardening, 03-05 operator controls, 03-06 tick route, 04-messaging, 05-drafting, 06-approval-console, 07-reporting]

actuals:
  tokens: 86883
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Contiguous same-tenant runs as the unit of consumption: one transaction, one cursor advance, so 'act and advance together' stays expressible over a single cursor spanning many tenants"
    - "Head-of-line blocking as the correct failure mode for an ordered cursor — a run that cannot finish stops the scan rather than being stepped over"
    - "FOR UPDATE OF <table> SKIP LOCKED, never a bare FOR UPDATE across a join, so a console write does not queue behind a tick's read"
    - "Commit the claim before invoking the sender: at-most-once by ordering, with a NULL outcome meaning 'we do not know'"
    - "Refusal reasons read off the data rather than assumed — the quote's own state picks won/lost/removed/reopened"
    - "A read-only accessor beside the lazily-creating one, so the refusal path never writes"

key-files:
  created:
    - src/core/cadence/sender.ts
    - src/core/cadence/consume-events.ts
    - src/core/cadence/dispatch.ts
    - src/core/cadence/run-tick.ts
    - src/db/repository/consumer-cursor.ts
    - tests/cadence-tick.test.ts
  modified:
    - src/db/repository/for-tenant.ts
    - src/db/repository/index.ts
    - tests/lint-ban.test.ts

key-decisions:
  - "The unit of consumption is a contiguous same-tenant RUN, not an event and not a batch: the cursor is one number over a stream that interleaves tenants while the actions are tenant-scoped, so the only honest advance is to the last event of a run whose writes just committed"
  - "A run that fails stops the scan instead of being skipped — skipping ahead would strand its events behind a cursor that has already passed them, and no later tick would ever look at them again"
  - "consumeQuoteEvents deliberately takes NO injectable clock: D-01's anchor is the event's own detected_at, already committed by the sync path, so a caller-supplied now() could only overrule the database's record of when we noticed"
  - "The cadence stop reason for a closed quote is read off the quote's actual state (won / lost / removed / reopened) rather than a generic 'quote_closed', because Phase 7 attributes revenue on that column and one bucket for three outcomes destroys the distinction"
  - "Materialization picks the channel the selected contact can actually be reached on: D-04 explicitly allows an email-only contact and every Phase 3 template is sms, so without the fallback an email-only customer gets five sms touches to a mobile that does not exist"
  - "A touch whose cadence has no address on its channel is NOT skipped with a borrowed reason — it stays live and logs loudly, because every TOUCH_SKIP_REASON is evidence Phase 7 reads and a false one would be written only to make a loop terminate"
  - "A tenant whose events survive but whose connection row does not (a deleted client) has those events consumed with no action and counted separately, rather than wedging the single shared cursor for every other client forever"
  - "event_consumer_cursors gets two homes on purpose: registration and the pre-scan read in src/db/repository/consumer-cursor.ts (before any tenant is known), the advance on forTenant(id).consumerCursor (the only handle that can be inside the transaction the outbox contract requires)"

patterns-established:
  - "Counts-only tick results, so the object that becomes an HTTP response body carries no client name, address or error string"
  - "Caught values are never logged at either boundary — a driver error carries the statement, whose parameters are a customer's address"
  - "Test suites that share a global cursor park it at the outbox head rather than starting from 0"

requirements-completed: [CAD-01, CAD-04, CAD-05]

coverage:
  - id: D1
    description: "A quote flipped chase-eligible produces, through the real runCadenceTick path, an active cadence with 5 materialized touches and — once touch 1 is due — exactly one send_ledger row with sender 'stub' and outcome 'stub_sent'"
    requirement: "CAD-01"
    verification:
      - kind: integration
        ref: "tests/cadence-tick.test.ts#carries an eligible quote to an active cadence with five ordered touches"
        status: pass
      - kind: integration
        ref: "tests/cadence-tick.test.ts#sends touch one exactly once, recorded as a stub in the ledger (CAD-04, D-13)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Processing the same event window twice yields exactly one live cadence per quote — the partial unique arbitrates the collision and the cursor co-commits with the actions"
    requirement: "CAD-01"
    verification:
      - kind: integration
        ref: "tests/cadence-tick.test.ts#absorbs a replayed quote_opened into the one live cadence (CAD-01)"
        status: pass
      - kind: integration
        ref: "tests/cadence-repository.test.ts#runs every cadence namespace, and refuses where it must (replayed create returns [])"
        status: pass
    human_judgment: false
  - id: D3
    description: "A quote_opened whose selected primary contact is suppressed creates the cadence stopped with reason contact_suppressed and zero touches — a suppressed human is blocked on NEW quotes at creation (D-15)"
    requirement: "CAD-05"
    verification:
      - kind: integration
        ref: "tests/cadence-tick.test.ts#creates a cadence already stopped when the chosen contact is suppressed"
        status: pass
    human_judgment: false
  - id: D4
    description: "A quote_opened with no usable contact creates the cadence stopped with reason no_contact — consumed exactly once, visible to the operator, nothing sent, never a guess (D-04)"
    requirement: "CAD-01"
    verification:
      - kind: integration
        ref: "tests/cadence-tick.test.ts#creates a cadence stopped as no_contact when nobody is reachable"
        status: pass
    human_judgment: false
  - id: D5
    description: "Dispatch revalidates just-in-time inside the claim transaction: a recipient suppressed after the touch was approved is refused with no ledger row, the touch skipped 'suppressed' and the cadence stopped in the same transaction"
    requirement: "CAD-05"
    verification:
      - kind: integration
        ref: "tests/cadence-tick.test.ts#refuses a due, approved touch whose recipient was suppressed after approval"
        status: pass
    human_judgment: false
  - id: D6
    description: "The closed/ineligible-quote, paused-connection and outside-window JIT refusals are implemented and re-read inside the claim transaction"
    requirement: "CAD-05"
    verification:
      - kind: other
        ref: "src/core/cadence/dispatch.ts — quotes.stateFor, connection.get + settings.get, isInsideWindow, all inside forTenant().transaction; the suppression arm of the same block is proven by D5"
        status: pass
    human_judgment: true
    rationale: "Only the suppression refusal is exercised end-to-end here. The four-scenario JIT matrix and the two-connection concurrency race are plan 03-04's assigned tests (3-04-03 in 03-VALIDATION.md); asserting them here would duplicate the coverage that plan is measured on"
  - id: D7
    description: "A tick with no due work completes cleanly returning zero counts — never an error (CAD-05 empty edge)"
    requirement: "CAD-05"
    verification:
      - kind: integration
        ref: "tests/cadence-tick.test.ts#completes a tick with no due work as an all-zero result (CAD-05)"
        status: pass
    human_judgment: false
  - id: D8
    description: "The cadence-engine consumer registers its own cursor row with INSERT ON CONFLICT DO NOTHING starting at 0 — no seeded row, and 'has never run' stays distinguishable from 'is at 0'"
    requirement: "CAD-01"
    verification:
      - kind: integration
        ref: "tests/cadence-tick.test.ts#registers its own cursor at 0 rather than finding one seeded (outbox contract)"
        status: pass
    human_judgment: false
  - id: D9
    description: "The TouchSender seam matches the RESEARCH Pattern 6 contract exactly, and stub sends are structurally distinguishable from real provider sends forever"
    requirement: "CAD-04"
    verification:
      - kind: integration
        ref: "tests/cadence-tick.test.ts (ledger row asserts sender 'stub', outcome 'stub_sent', providerMessageId null)"
        status: pass
      - kind: other
        ref: "src/core/cadence/sender.ts — SendRequest / SendOutcome / TouchSender field-for-field against 03-RESEARCH.md Pattern 6"
        status: pass
    human_judgment: true
    rationale: "Whether the interface shape is the RIGHT one for Phase 4 (a costly-to-reverse D-13 decision) is a judgment no Phase 3 test can make; the test proves only that this phase writes through it correctly"
  - id: D10
    description: "The cadence modules stay framework-free and the whole repository is green"
    verification:
      - kind: other
        ref: "grep -rn \"from 'next/\" src/core/cadence/ → no matches; npm run typecheck; npm run lint (--max-warnings=0)"
        status: pass
      - kind: integration
        ref: "npm run test:remote → 40 files, 820 tests, all pass"
        status: pass
    human_judgment: false

# Metrics
duration: 20 min
completed: 2026-08-27
status: complete
---

# Phase 3 Plan 02: End-to-End Tracer Summary

**One quote ticked chase-eligible now travels the entire machine on the hosted Sydney database — outbox event to cadence to materialized schedule to claim to a ledger row marked `stub` — with the replay, collision and just-in-time refusal guarantees each proven rather than promised.**

## Performance

- **Duration:** 20 min
- **Started:** 2026-08-27T12:26:00Z
- **Completed:** 2026-08-27T12:46:00Z
- **Tasks:** 2
- **Files modified:** 9 (6 created, 3 modified)

## Accomplishments

- **The architecture is proven on one real path before anything horizontal is built on it.** A quote flipped through the actual `markChaseEligible` — not a hand-inserted event row — becomes an active cadence with five ordered touches, gets promoted through the auto-passed D-14 gates, and lands as exactly one `send_ledger` row with `sender = 'stub'` and `outcome = 'stub_sent'`. Every later plan in this phase fills a stage of this machine; none has to reshape it.
- **Replay is legal and now demonstrably harmless.** The suite rewinds the shared cursor behind a consumed `quote_opened` and re-runs the tick: one live cadence, the same five touch rows with the same ids and the same instants, one ledger row. The zero rows come back from the INSERT itself — Postgres deciding, not a read that could have lost a race.
- **Both creation-time gates are real gates, not dispatch-time ones wearing a disguise.** A suppressed contact and an unreachable contact each produce a cadence created already stopped, with a reason, with zero touches, and with the cursor advanced — the event consumed exactly once, visible to the operator, nothing sent. That is what makes D-15's "block cadences on NEW quotes too" true rather than aspirational.
- **The CAD-05 headline is asserted end to end:** a touch approved ahead of its slot for a customer who is suppressed before it comes due leaves **no ledger row at all**, is skipped as `suppressed`, and stops its cadence and skips its four siblings in the same transaction. The window between approval and dispatch is exactly where a customer says "stop", and it is now closed inside the claim.
- **The D-13 seam is the shape Phase 4 needs, not the shape Phase 3 uses.** `SendRequest` carries the ledger id, the normalized address and the contact name; `SendOutcome` carries `provider`, `providerMessageId` and `retryable` from day one. The stub uses almost none of it, which is the point — the fields exist so that swapping in ClickSend is a caller change rather than a simultaneous edit to dispatch, the ledger and the gateway.

## Task Commits

1. **Task 1 (tracer): sender, consumer, dispatch, tick, and the end-to-end suite** — `720c50c` (feat)
2. **Task 2: replay, collision, creation-gate and JIT-suppression guarantees** — `80e2fe1` (test)

## Files Created/Modified

### Core (`src/core/cadence/`)
- `sender.ts` — the D-13 contract copied field-for-field from RESEARCH Pattern 6, `StubSender`, and `stubTouchBody` (deliberately unconvincing placeholder copy, so a log line can never be mistaken for a real message)
- `consume-events.ts` — the outbox consumer, with the consumption contract quoted clause by clause in the header, the contiguous-run transaction unit, and the temporary "only `quote_opened` is handled" guard that plan 03-03 removes
- `dispatch.ts` — the claim transaction: `claimDue` → four JIT refusals → `insertClaim` → `markSent` → commit → sender → `setOutcome`
- `run-tick.ts` — the ordered three passes, with the argument for that order written down, and the injected clock/RNG/sender documented as production seams rather than test hooks

### Repository
- `src/db/repository/consumer-cursor.ts` (new) — `registerConsumerCursor` (the ON CONFLICT DO NOTHING at 0) and `readConsumerCursor` (which distinguishes "never ran" from "at 0")
- `src/db/repository/for-tenant.ts` — `touches.claimDue` (the SKIP LOCKED claim), `touches.markSent`, `quoteContacts.listForJob`, `settings.get`, and the `consumerCursor` namespace with a header explaining why a table with no `tenant_id` is reachable from the tenant-scoped repository
- `src/db/repository/index.ts` — the two cursor accessors, on their own line with their own justification

### Tests
- `tests/cadence-tick.test.ts` (new) — 8 cases against the hosted Sydney database
- `tests/lint-ban.test.ts` — the barrel export list, updated deliberately with the reason each new name exists

## Decisions Made

Recorded in `key-decisions` above. The four worth reading in full:

1. **The unit of consumption is a contiguous same-tenant run.** The outbox contract says act and advance in one transaction; the cursor is a single number over a stream that interleaves clients, while every action is tenant-scoped. Those two facts only reconcile one way: walk the batch in `id` order, chunk it into maximal same-tenant runs, and let each run be one transaction ending in one advance. In the ordinary case — a batch from one client — that is a single transaction. What it can never be is an advance past an event that some other transaction still owes work for.

2. **A failed run stops the scan.** Head-of-line blocking looks like a defect until you consider the alternative: advancing past a run that did not finish strands its events permanently behind the cursor, because nothing scans backwards. So a tenant with an uninterpretable contact window (the one failure this consumer can actually produce) halts consumption at that event and says so by name in the log. It is loud, it is recoverable by fixing one row, and it never silently drops a `quote_opened`.

3. **The stop reason for a closed quote is read, not assumed.** `CADENCE_STOP_REASONS` has no `quote_closed` member and should not gain one. Phase 7 computes recovered revenue from this column, and a single bucket covering a won job, a lost job and a deleted job would destroy exactly the distinction the report exists to make. The quote's own state is right there in the transaction: `!sm8_active → removed`, `Work Order`/`Completed` → `won`, `Unsuccessful` → `lost`, still-a-Quote-but-ineligible → `reopened` (which has one writer in this codebase, the D-08 flip).

4. **A touch with no address on its channel is not skipped with a borrowed reason.** Every member of `TOUCH_SKIP_REASONS` is a rule that decided something, and Phase 7 reads them as evidence. Writing `quote_closed` on a row that had a perfectly open quote — purely so a loop terminates — would put a false statement in the record. The touch stays live and the condition logs loudly with the cadence id. It is unreachable by construction anyway (see deviation 1); the point is what happens if the construction is ever wrong.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Materialization picks the channel the contact can actually be reached on**

- **Found during:** Task 1
- **Issue:** D-04 deliberately allows an email-only contact to be selected — a usable mobile merely OUTRANKS email inside a contact-type tier, it is not a requirement — while every Phase 3 template ships `channel = 'sms'`. Taking the template's channel verbatim therefore materializes five sms touches for a customer who has no mobile. Those touches can never be dispatched (no address on the channel), so they would be re-examined by the claim query every minute forever, with nothing to show for it anywhere an operator looks.
- **Fix:** `reachableChannel(templateChannel, contact)` in `consume-events.ts`: the template says how we PREFER to reach them, the contact says how we CAN. It falls back to the other channel only when the preferred one has no address, and returns null only for a contact with neither — which cannot reach it, because `selectPrimaryContact` returns null for that case and the cadence is created stopped as `no_contact`.
- **Files modified:** `src/core/cadence/consume-events.ts`
- **Verification:** the sms path is asserted throughout the suite (`channel: 'sms'` on the ledger row); the fallback's guard condition is total by construction and its unreachable branch is documented at the call site
- **Committed in:** `720c50c`

**2. [Rule 3 - Blocking] Five repository methods the plan's shape required but 03-01 had not shipped**

- **Found during:** Task 1
- **Issue:** The plan specifies the claim query, the just-in-time re-reads and the contact load, and the raw drizzle client is banned outside `src/db/repository` by an ESLint rule with its own proving test. None of `touches.claimDue`, `touches.markSent`, `quoteContacts.listForJob`, `settings.get` or a cursor advance existed. Two are subtle rather than merely absent: `settings.ensure()` WRITES, so using it for the D-06 pause re-read would have the send path creating configuration rows for clients it is about to decline to message — a write on a refusal path, inside a transaction whose only job is to decide whether to act. And a bare `FOR UPDATE` across the touches/cadences join would lock the cadence row too, so a console kill switch would queue behind a tick that is merely reading the contact snapshot.
- **Fix:** Added all five, each with the rationale in the interface comment: `claimDue` uses `FOR UPDATE OF cadence_touches SKIP LOCKED` with a deterministic `scheduled_at, id` order; `settings.get` is read-only beside the lazily-creating `ensure`; `listForJob` deliberately returns inactive contacts because exclusion is `selectPrimaryContact`'s documented decision and moving half of it into a query would put it where nothing asserts it.
- **Files modified:** `src/db/repository/for-tenant.ts`, `src/db/repository/index.ts`
- **Verification:** `tests/cadence-tick.test.ts` exercises all five on the real database; `npm run test:remote` green at 40 files / 820 tests
- **Committed in:** `720c50c`

**3. [Rule 3 - Blocking] The cursor needed two homes, and the barrel tripwire had to be told why**

- **Found during:** Task 1
- **Issue:** The contract requires the cursor advance to commit with the actions (tenant-scoped, so it must be reachable from a `forTenant(id).transaction()` handle), while registration and the pre-scan read happen BEFORE any tenant is known. No single home satisfies both. Separately, `event_consumer_cursors` is not tenant data at all — it carries no `tenant_id` and is gated by `is_operator()` — so putting it in `for-all-tenants.ts` would inflate the list a reviewer greps to audit tenant-scope escapes with a row that has no tenant to escape.
- **Fix:** Registration and the read went into their own `src/db/repository/consumer-cursor.ts`, following the precedent `prospects.ts` set for non-tenant tables; the advance is a `consumerCursor` namespace on the tenant repository whose header states that it is the only non-tenant-scoped namespace in that file and must stay the only one. `tests/lint-ban.test.ts`'s exact barrel-export assertion fired as designed and was updated deliberately, with the reason each name exists and a note that the ADVANCE is deliberately absent from that list.
- **Files modified:** `src/db/repository/consumer-cursor.ts`, `src/db/repository/for-tenant.ts`, `src/db/repository/index.ts`, `tests/lint-ban.test.ts`
- **Verification:** `tests/lint-ban.test.ts` green; the registration contract is asserted end-to-end in the tracer suite
- **Committed in:** `720c50c`

**4. [Rule 2 - Missing Critical] A deleted tenant's events would have wedged the shared cursor forever**

- **Found during:** Task 1
- **Issue:** `forAllTenants_cadenceTick` inner-joins `sm8_connections`, and `quote_status_events` deliberately carries no foreign key (it is Phase 7's evidence, so a disconnected client cannot take their attribution history with them). A deleted tenant therefore leaves events behind with no metadata to materialize a schedule from. Refusing to advance past them — the natural reading of "never skip an event" — would freeze the single shared cursor for every other client, permanently, over a client who no longer exists.
- **Fix:** Those events are consumed with no action and counted in a separate `eventsSkipped` field, so "nothing to do" stays distinguishable from "nothing happened". Documented at `consumeRun` with the reasoning.
- **Files modified:** `src/core/cadence/consume-events.ts`
- **Verification:** covered structurally (the branch is taken when the tenant map has no entry); not reachable from the suite without deleting a tenant mid-run, which teardown ordering makes hostile to assert
- **Committed in:** `720c50c`

**5. [Rule 1 - Deliberate omission] `consumeQuoteEvents` does not take the `now` the plan specified**

- **Found during:** Task 1
- **Issue:** The plan's signature is `consumeQuoteEvents({now})`, but nothing in consumption reads a clock: D-01's anchor is the event's own `detected_at`, a value the sync path already committed. An accepted-but-unused `now` is a stub-shaped API, and the only use it could be given later is overruling the database's record of when we noticed — which is Pitfall 1 approached from the other side.
- **Fix:** The parameter is absent and its absence is documented on the options interface, naming the reason. `runCadenceTick` still takes `now`, because "is this touch due" is a question about the present and is the one thing that must be pinnable.
- **Files modified:** `src/core/cadence/consume-events.ts`
- **Verification:** the suite pins `runCadenceTick`'s clock on both sides of every touch's slot and gets deterministic results
- **Committed in:** `720c50c`

**6. [Rule 2 - Missing Critical] A one-minute-per-day flake in the dispatch tests, closed in the harness**

- **Found during:** Task 2
- **Issue:** The tenant is seeded with an always-open 00:00–23:59 window so the assertions are about the pipeline rather than about what time CI runs. But the contact-hours boundary is half-open `[start, end)` — correctly and permanently — so 23:59 is OUTSIDE that window. A dispatch test computing `now` as "touch one's slot plus a minute" would therefore fail for roughly one run in fourteen hundred, at midnight, for a reason with nothing to do with what it asserts.
- **Fix:** `insideContactWindow()` in the suite nudges past that minute, with the half-open boundary named as the cause so a future reader does not delete it as superstition.
- **Files modified:** `tests/cadence-tick.test.ts`
- **Verification:** the two dispatch tests pass; the boundary itself is proven exhaustively with pinned instants in `tests/cadence-window.test.ts`
- **Committed in:** `720c50c`

---

**Total deviations:** 6 auto-fixed (1 deliberate omission, 3 missing critical, 2 blocking)
**Impact on plan:** No architectural change and no scope creep. Five of the six are things the plan's own `must_haves` require and did not enumerate — the repository methods its claim query implies, the liveness hole its "consume exactly once" rule would otherwise open, and the channel decision D-04 forces. The sixth removes an unused parameter rather than shipping it hollow.

## The pgmq directive, and why this plan does not follow it (checker I-1)

`.claude/CLAUDE.md` says, under **What NOT to Use**: *"Vercel `waitUntil` for sends — best-effort only… Use instead: pgmq queue + idempotency keys."* This plan uses **neither** `waitUntil` nor pgmq. Sends are claimed from `cadence_touches` with `FOR UPDATE SKIP LOCKED` and made never-twice by the `send_ledger_cadence_touch_uniq` index.

The reasoning is 03-RESEARCH.md's Alternatives table, recorded here so the deviation is auditable rather than merely made:

- **The directive's intent is durability and idempotency for must-happen sends**, and both are satisfied — more directly, in fact, than by a queue. The durable record IS the ledger row, which is also Phase 7's attribution evidence; the idempotency key IS `(cadence_id, touch_number)`, which is the same key `cadence_touches` uses, so the two tables agree on what "a touch" is.
- **pgmq would create a second source of truth** beside the touch rows and their materialized `scheduled_at` instants. CAD-02 states that send times are materialized and stored; a queue message carrying its own due time is a second answer to "when does this go out", and the two can disagree after a re-window.
- **The banned thing is best-effort work**, and nothing here is best-effort: the tick awaits its own work inside a `maxDuration = 300` route, exactly as the Phase 2 sync tick does.

**Revisit trigger, carried forward to Phase 4:** adopt pgmq only if ClickSend's latency or retry semantics demand decoupled workers — i.e. if a provider call becomes slow or flaky enough that holding it inside the tick threatens the per-minute cadence. Until then, one source of truth.

## Issues Encountered

- **The `quote_status_events` batch this build can act on is a PREFIX, not a filter.** Only `quote_opened` is handled here; `won`, `lost`, `removed` and `reopened` belong to plan 03-03. Consumption therefore stops at the first event of an unhandled type and does not advance past it — consuming a `won` by ignoring it would permanently lose the signal that stops a cadence, and the customer would keep being chased for a job they already awarded. This is a temporary constraint, documented as such in the module header, and it costs nothing yet: the pg_cron schedule that would run this in production does not exist until plan 03-06. **Plan 03-03 must delete `HANDLED_EVENT_TYPES` and the prefix loop when it lands the stop handler.**
- **The suite parks the shared cursor at the outbox head rather than starting from 0.** `event_consumer_cursors` holds one row for the whole engine by design, so a suite that started from 0 would act on every other suite's leftover events. The registration contract is still asserted directly (delete the row, prove it is absent rather than zero, register twice, prove idempotence) before the park happens.
- **No blocker introduced or encountered.** The Phase 4 IPND address blocker and the ServiceM8 partner-registration watch item are untouched: this phase dispatches against a stub sender by design (D-13) and performs no third-party I/O at all.

## Known Stubs

- **`StubSender` (`src/core/cadence/sender.ts`) is a deliberate, plan-mandated stub (D-13), not an oversight.** It is structurally distinguishable from every real send forever: `send_ledger.sender = 'stub'` and `outcome = 'stub_sent'`, asserted in the suite, so Phase 7's attribution can exclude these rows years from now against rows written today. Phase 4 replaces the implementation; the interface is the contract and does not change.
- **The D-14 draft and approval gates are auto-passed** by `touches.promoteDue`, exactly as 03-01 designed: `scheduled → approved` in one statement. The intermediate states ship in the vocabulary now so Phases 5 and 6 replace one method rather than migrating live cadences.
- **Message bodies are deterministic placeholder text** (`stubTouchBody`), deliberately unconvincing so that nothing in a log can be mistaken for a real follow-up before Phase 5's drafting and Phase 6's approval exist.

No unintended stubs: every function shipped here is fully implemented, and there are no `TODO`/`FIXME` markers in the new code.

## Threat Flags

None new. This plan adds no network endpoint (the tick route is plan 03-06), no auth path, no file access and no schema change.

The register's five entries for this plan are mitigated as written: **T-3-05** (cursor tampering) by the co-committed advance plus the never-rewind `WHERE` guard, proven by the replay test; **T-3-06** (duplicate send) by `insertClaim` before any sender call with a zero-row refusal, plus SKIP LOCKED; **T-3-07** (JIT gates) by same-transaction re-reads of quote state, both pause flags, suppression and window, with the enqueue→suppress→refuse case asserted; **T-3-08** (acting during a pause) by checking BOTH `connectionPausedAt` and `settingsPausedAt` at tenant selection AND re-reading both inside the claim; **T-3-09** (stub vs real sends) by `sender = 'stub'` / `outcome = 'stub_sent'` on every tracer ledger row, asserted by column value.

## User Setup Required

None — no external service configuration, no new environment variable, no migration.

## Next Phase Readiness

**Ready. The machine exists; the remaining Wave-2/3 plans fill its stages.**

- **03-03 (transitions and event consumption)** owns the four remaining event types. It must remove `HANDLED_EVENT_TYPES` and the prefix loop in `consume-events.ts`, and it owns the correction of the stale D-01 comment at `src/core/sync/eligibility.ts:52-54`, which this plan deliberately left alone (it is assigned there, and the code already anchors correctly on `detected_at`).
- **03-04 (re-window and dispatch hardening)** inherits the seams it needs: the two silent refusals (paused, outside-window) leave the touch untouched precisely so the re-window pass owns rescheduling, and `claimDue` is the claim its concurrency race will call twice in parallel.
- **03-06 (tick route)** can clone `sync-tick` against `runCadenceTick`: the result is already counts-only, and the work is already awaited rather than deferred.
- **Contracts later plans must honour:**
  - Advance the cursor only for events whose actions committed in the SAME transaction, and never step a failed run over.
  - `ledger.insertClaim` returning `[]` means another process owns the touch — refuse silently, never send.
  - A NULL `send_ledger.outcome` means "we do not know". Surface it; never auto-resend it.
  - Dispatch validates; it never chooses a time. The only writer of a new `scheduled_at` is the re-window pass.
  - Never write a `TOUCH_SKIP_REASON` that did not actually decide the skip — Phase 7 reads that column as evidence.

---
*Phase: 03-cadence-engine*
*Completed: 2026-08-27*

## Self-Check: PASSED

Created files verified present on disk:
- `src/core/cadence/sender.ts`, `consume-events.ts`, `dispatch.ts`, `run-tick.ts` — FOUND
- `src/db/repository/consumer-cursor.ts` — FOUND
- `tests/cadence-tick.test.ts` — FOUND

Commits verified in `git log`:
- `720c50c` — FOUND
- `80e2fe1` — FOUND

Plan-level verification re-run at close-out:
- `ALLOW_REMOTE_TESTS=yes npx vitest run tests/cadence-tick.test.ts` — PASS (8/8 against the hosted Sydney project)
- `npm run typecheck` — PASS
- `npm run lint` (`--max-warnings=0`) — PASS
- `npm run test:remote` — PASS (40 files, 820 tests; no regression)

All task acceptance criteria re-verified: the end-to-end path is green against the hosted DB; `grep -q "detected_at\|detectedAt" src/core/cadence/consume-events.ts` succeeds and the anchor passed to `materializeCadenceSchedule` is `event.detectedAt`; `grep -q "ON CONFLICT\|onConflictDoNothing" src/core/cadence/consume-events.ts` succeeds; `grep -i "skip locked"` and `grep "insertClaim"` both match `dispatch.ts`; the ledger assertions pin `sender = 'stub'` by column value; `grep -rn "from 'next/" src/core/cadence/` returns nothing.

Tracer feedback gate: the tracer's `<verify>` was re-run to completion after its commit and before any Task 2 work (8 passing cases, clean typecheck). The gate was auto-approved rather than surfaced as a checkpoint, on the basis of `mode: yolo` in `.planning/config.json` together with `autonomous: true` on this plan; it is recorded here so the decision is auditable. Had the re-run failed, expansion would have halted.
