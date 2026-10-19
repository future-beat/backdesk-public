---
phase: 07-attribution-reporting
plan: 03
subsystem: api
tags: [outbox-consumer, cursor, idempotency, head-of-line, attribution, privacy, vitest, remote-suite]

requires:
  - phase: 02-servicem8-sync-quote-leakage-audit
    provides: "the quote_status_events outbox, its id-order consumption contract, detected_at vs occurred_at, and the rule that no cursor row is seeded"
  - phase: 03-cadence-engine
    provides: "consume-events.ts — the register → scan → contiguous-same-tenant-run → advance-in-transaction structure and the head-of-line policy this module clones; CADENCE_CONSUMER as the sibling cursor name; send_ledger.claimed_at as the sent moment"
  - phase: 06-review-console-escalation
    provides: "escalations.ts as an evidence family outside forTenant() whose tenant id travels in each call, and the barrel note reserving 'the read Phase 7 needs, with its own argument'"
  - phase: 07-attribution-reporting
    provides: "07-01's quote_attributions table, attributions.claim (targetless ON CONFLICT DO NOTHING RETURNING), send_ledger_tenant_quote_idx and the evidence seeders; 07-02's decideAttribution, LedgerTouchFields, attributionEvidenceSchema and ATTRIBUTION_CONSUMER"
provides:
  - "consumeWonEvents — the SECOND outbox consumer, cursor 'attribution', writing at most one quote_attributions row per quote and advancing its own cursor in the same transaction (RPT-01)"
  - "ATTRIBUTION_BATCH_LIMIT, ConsumeWonEventsResult, NO_ATTRIBUTION (frozen)"
  - "RunCadenceTickOptions.attribution ('run' | 'skip', defaulting to 'skip' — the no-op default that keeps every remote suite and script from attributing real history)"
  - "runAttributionPass + six enumerated numeric fields on CadenceTickResult (37 → 43) and on the tick route's response body"
  - "forTenant().ledger.listForQuote and forTenant().inbound.listThreadedForQuote — tenant-pinned evidence reads with explicit select lists"
  - "listEscalationsForQuote(tenantId, quoteId) + EscalationEvidence on the repository barrel"
  - "ThreadedInboundEvidence on for-tenant.ts"
  - "tests/attribution-consume.test.ts (remote, park-and-restore the shared cursor) and tests/attribution-consume-isolation.test.ts (pure, failure injection)"
affects: [07-04-report-generation-and-page, 07-05-metrics-overview]

actuals:
  tokens: 71000
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "A second consumer on one outbox: two cursor rows, two independent head-of-line policies, one shared ordered stream — and neither consumer may name the other's cursor constant"
    - "Head-of-line tolerance and never-twice are ONE mechanism: later tenants may commit without advancing only because the unique index makes next tick's re-read a sequence of zero-row claims"
    - "A no-op default as a safety seam: 'skip' does not register, does not scan and does not advance, so a function reachable from every remote suite cannot write to a production billing table"
    - "The select list IS the privacy boundary — an evidence read that feeds a row outliving its sources names its columns, and a source assertion pins the list"
    - "A remote suite restores the non-tenant-scoped state it changed: teardownTenants cannot reach event_consumer_cursors, so the suite puts the cursor back — absent if it was absent"

key-files:
  created:
    - src/core/attribution/consume-wins.ts
    - tests/attribution-consume.test.ts
    - tests/attribution-consume-isolation.test.ts
  modified:
    - src/core/cadence/run-tick.ts
    - src/app/api/internal/cadence-tick/route.ts
    - src/db/repository/for-tenant.ts
    - src/db/repository/escalations.ts
    - src/db/repository/index.ts
    - src/core/attribution/evidence.ts
    - tests/cadence-tick.test.ts
    - tests/cadence-tick-route.test.ts
    - tests/lint-ban.test.ts

key-decisions:
  - "`ledger.listForQuote` returns `LedgerTouchFields` — the SAME Pick the attribution rule declares in `src/core/attribution/qualify.ts`, imported into the repository as a TYPE-ONLY import. The select list and the rule's column set are therefore ONE declaration rather than two that can drift: widening the query without widening the type is a compile error. Precedent for the core→repository direction already existed (`STALLABLE_TOUCH_STATUSES`), and a type import erases, so no runtime dependency runs from the repository into src/core."
  - "`ThreadedInboundEvidence` and `EscalationEvidence` are WRITTEN OUT rather than `Pick<Row, …>`, deliberately breaking symmetry with the ledger shape above. On those two tables the dangerous columns are the ones to DROP — `body`, `from_address`, `normalized_from`, `raw_payload`, `to_address` — and a `Pick` names what to keep, so a widened `Pick` is not a decision anybody typed. An explicit interface makes adding a column a line somebody wrote."
  - "The escalation read is called through the POOL (not `tx`) from inside the run's transaction callback. Nothing in this pass writes `escalations`, so there is no write it could fail to see, and the escalation family lives outside `forTenant()` by 06-05's design."
  - "The consumer reads all six evidence sources BEFORE calling `decideAttribution`, including for wins that turn out unqualified. Pre-filtering on `qualifyingTouches` in the consumer would be cheaper and would restate D-01/D-02 outside the one pure module that owns them — the rule lives in `decide.ts` and the consumer does IO."
  - "`attributionCursorAt: 0` is PINNABLE in the tick's all-zero literal where `cursorAt` is `expect.any(Number)`. The asymmetry is the point: `cursorAt` is a shared position every suite moves, while `NO_ATTRIBUTION.cursorAt` is the ABSENCE of a reading by a pass that declined to register. If that pin ever goes non-zero, the default has stopped being 'skip'."
  - "The remote suite RESTORES the `'attribution'` cursor in afterAll — deleting the row when it found none, because `null` ('never run') and 0 ('registered, at the start of history') are different facts under the outbox contract. Without this, a test run permanently decides where production starts attributing from."
  - "Attribution keys on the outbox `won` event and never on `cadences.stop_reason`. The two consumers advance independently, so when this pass sees a win the cadence engine may not have stopped the cadence yet — or may never, if that tenant is head-of-line blocked. Keying on stop_reason would make billing silently inherit the cadence engine's outages."

patterns-established:
  - "Header paragraphs that a test greps: the consumer documents 'the cadence engine's consumer name is not spelled anywhere in this file' WITHOUT naming it, because the suite asserts zero occurrences of the identifier"
  - "Failure injection shaped like the real thing: the rejected error quotes a job number and an ACMA fiction mobile, so the log-discipline assertion fails if anybody appends `${String(error)}`"
  - "Assert the advance is per RUN, not per event — two calls for three events across two tenants, each carrying its run's last id"
  - "A quiet pass and a skipped pass must report DIFFERENT cursor values (the registered position vs 0), pinned as its own case"

requirements-completed: []

coverage:
  - id: D1
    description: "A win with ≥1 qualifying touch inside the window becomes exactly one quote_attributions row with its evidence chain, gross and conservative figures, and the baseline and constants it was computed under"
    requirement: RPT-01
    verification:
      - kind: integration
        ref: "tests/attribution-consume.test.ts#records ONE attribution for a qualifying win, with the whole evidence chain"
        status: pass
    human_judgment: false
  - id: D2
    description: "Replay is a zero-row no-op: a rewound cursor re-reads the win and the stored row is byte-identical, proven on id and attributed_at rather than on values"
    requirement: RPT-01
    verification:
      - kind: integration
        ref: "tests/attribution-consume.test.ts#REPLAY: a rewound cursor re-reads the win and writes nothing"
        status: pass
    human_judgment: false
  - id: D3
    description: "A second won event for one quote (reopen → won again) is refused by quote_attributions_one_per_quote; the cursor still advances past both events"
    requirement: RPT-01
    verification:
      - kind: integration
        ref: "tests/attribution-consume.test.ts#A SECOND WIN after a reopen is a no-op decided by the database"
        status: pass
    human_judgment: false
  - id: D4
    description: "A win with no qualifying touch writes nothing and advances; a win whose quote mirror is gone records value_source 'missing' with gross_cents 0 and never holds the cursor"
    requirement: RPT-01
    verification:
      - kind: integration
        ref: "tests/attribution-consume.test.ts#UNQUALIFIED: a win with no real touch writes nothing and still advances"
        status: pass
      - kind: integration
        ref: "tests/attribution-consume.test.ts#MISSING MIRROR: a vanished quote row is recorded, not skipped and not priced"
        status: pass
    human_judgment: false
  - id: D5
    description: "The attribution consumer never reads or moves the cadence engine's cursor, and does not name its constant"
    requirement: RPT-01
    verification:
      - kind: integration
        ref: "tests/attribution-consume.test.ts#advanced its OWN cursor and left the cadence engine’s exactly where it was"
        status: pass
      - kind: unit
        ref: "tests/attribution-consume.test.ts#the consumer never names the cadence engine’s cursor"
        status: pass
    human_judgment: false
  - id: D6
    description: "runCadenceTick under its default options does not register, scan or advance the attribution cursor; the route's 'run' does"
    requirement: RPT-01
    verification:
      - kind: integration
        ref: "tests/attribution-consume.test.ts#THE TICK SEAM: the default tick does not register, scan or advance"
        status: pass
      - kind: unit
        ref: "tests/cadence-tick.test.ts — the 43-field all-zero literal, attributionCursorAt pinned to 0"
        status: pass
      - kind: unit
        ref: "tests/cadence-tick-route.test.ts#builds the routing sender per tick and threads it into runCadenceTick (D-04) — now asserting attribution: 'run'"
        status: pass
    human_judgment: false
  - id: D7
    description: "A throwing run blocks only its tenant: the cursor is held, later tenants still claim, their advance is withheld, and the caught value never reaches the log"
    requirement: RPT-01
    verification:
      - kind: unit
        ref: "tests/attribution-consume-isolation.test.ts (9 tests — blocks the failing tenant, still records tenant B, WITHHOLDS the advance, logs ONE fixed sentence)"
        status: pass
    human_judgment: false
  - id: D8
    description: "The three evidence reads carry no customer or tradie address, no message text and no raw payload — asserted on the SOURCE, not only on the seeded data"
    requirement: RPT-01
    verification:
      - kind: unit
        ref: "tests/attribution-consume.test.ts#the three evidence reads select columns, never rows (3 cases)"
        status: pass
      - kind: integration
        ref: "tests/attribution-consume.test.ts — the serialized attribution row contains no '@' and no '+61'"
        status: pass
    human_judgment: false
  - id: D9
    description: "The tick response body carries six numbers under fixed labels and nothing else"
    requirement: RPT-01
    verification:
      - kind: unit
        ref: "tests/cadence-tick-route.test.ts#reports EXACTLY the agreed key set + THE T-3-24 ASSERTION (recursive numeric-leaf walk)"
        status: pass
    human_judgment: false

duration: 41min
completed: 2026-09-02
status: complete
---

# Phase 07 Plan 03: Attribution Consumer Summary

**A `won` event on the hosted Sydney database now becomes exactly one evidence-chained `quote_attributions` row, written by the production tick route — and nothing else can write one: the pass declines to start unless a caller types `attribution: 'run'`, which only the route does.**

## Performance

- **Duration:** ~41 min
- **Started:** 2026-09-02T13:47Z
- **Completed:** 2026-09-02T14:28Z
- **Tasks:** 2 of 2
- **Files modified:** 12 (3 created, 9 modified)

## Accomplishments

- **The second consumer exists and is genuinely independent.** `consumeWonEvents` registers under `'attribution'`, scans `quote_status_events` by `id`, chunks into contiguous same-tenant runs, and advances its own cursor inside the same transaction as the claim it accounts for. The cadence engine's cursor is asserted unmoved across a full pass, and the cadence engine's constant is not spelled anywhere in the file — a grep in the suite enforces that, so the header describes it without naming it.
- **Never-twice is a database fact end to end, proven three ways on production.** One row for a qualifying win; zero new rows when the cursor is rewound by hand; zero new rows when a reopen produces a second `won`. The replay proof asserts on `id` and `attributed_at`, not on the figures — an `ON CONFLICT DO UPDATE` would leave the same values behind and pass a value assertion.
- **The tick seam is the thing that made this safe to build at all.** `RunCadenceTickOptions.attribution` defaults to `'skip'`, and `'skip'` does not register, does not scan and does not advance. Every existing remote suite calls `runCadenceTick`, and a brand-new consumer registers *at zero* by contract — so without this default the first test run would have walked fifteen real clients' won history into a table with no update method and no delete method. The suite asserts both directions: the default tick leaves the cursor untouched and writes nothing; `attribution: 'run'` consumes the same pending event.
- **The evidence chain cannot carry a person.** Three reads with explicit select lists — `ledger.listForQuote`, `inbound.listThreadedForQuote`, `listEscalationsForQuote` — omitting `to_address`, `from_address`, `normalized_from`, `body` and `raw_payload`. Defended twice and differently: the serialized row is asserted to contain no `@` and no `+61` (behaviour), and each select list's key set is asserted against a written-out list extracted from the source (structure). The second is what catches a `.select()` widening in six months, which the first cannot.
- **One client's deadlock cannot wedge fourteen.** Failure injection at the repository seam proves the blocked tenant holds the cursor, the blocked tenant's later runs are skipped, *later tenants still commit their attributions*, and their advance is withheld. The header now states why that is safe rather than reckless: head-of-line tolerance and never-twice are the same mechanism seen from two directions.

## Task Commits

1. **Task 1 (tracer): One won event → one attribution row, through the tick** — `32a5210` (feat)
2. **Task 2: Head-of-line isolation, logging discipline and the frozen-delivery-state rule** — `9bd3602` (test)

**Tracer feedback gate:** Task 1's `<verify>` was re-run end to end after its commit — 46 tests across the three suites against the hosted database, plus `tsc --noEmit` and `eslint`. It passed; execution continued to Task 2.

## Files Created/Modified

**Created:**
- `src/core/attribution/consume-wins.ts` — `consumeWonEvents`, `ATTRIBUTION_BATCH_LIMIT`, `ConsumeWonEventsResult`, `NO_ATTRIBUTION`, `contiguousRuns`, `consumeRun`, `attributeWonEvent`
- `tests/attribution-consume.test.ts` — 11 cases: the full chain, the two cursors, replay, second win, unqualified, missing mirror, the tick seam both ways, and four source assertions
- `tests/attribution-consume-isolation.test.ts` — 9 pure cases: the block, the surviving tenant, the withheld advance, the log, per-run advance, the four walked-past event types, the frozen literal, quiet-vs-skipped

**Modified:**
- `src/core/cadence/run-tick.ts` — `RunCadenceTickOptions.attribution`, `runAttributionPass`, six enumerated result fields (37 → 43), the pass placed immediately after the consume guard
- `src/app/api/internal/cadence-tick/route.ts` — `attribution: 'run'` at the composition root; six enumerated body fields
- `src/db/repository/for-tenant.ts` — `ledger.listForQuote`, the new one-member `inbound` namespace, `ThreadedInboundEvidence`, the type-only `LedgerTouchFields` import
- `src/db/repository/escalations.ts` — `listEscalationsForQuote`, `EscalationEvidence`
- `src/db/repository/index.ts` — the read and its type re-exported, with the 06-05 comment updated to record that the promised read has landed and what bounds it
- `src/core/attribution/evidence.ts` — the Pitfall 7 decision recorded on `deliveryStatus` itself
- `tests/cadence-tick.test.ts`, `tests/cadence-tick-route.test.ts`, `tests/lint-ban.test.ts` — the three pinned literals extended deliberately

## Decisions Made

See `key-decisions` in the frontmatter. The two most load-bearing:

1. **`listForQuote` returns the attribution rule's own `LedgerTouchFields` type.** The privacy boundary is a select list, and a select list drifts. Binding the query's return type to the `Pick` that `qualify.ts` declares makes widening the query a compile error rather than a review somebody might not have.

2. **The remote suite restores the `'attribution'` cursor it parked.** `event_consumer_cursors` has no `tenant_id`, so the ordered teardown cannot reach it — and a parked cursor left behind silently decides where production starts attributing from the first time the deployed route runs. `null` is restored as an absent row rather than as 0, because the outbox contract turns on that distinction.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `detected_at` cannot be supplied through `events.insertMany`**
- **Found during:** Task 1 (the remote suite)
- **Issue:** The plan's action says to "write the `won` event through `forTenant(id).events.insertMany` with a fixed `detected_at`". `QuoteStatusEventInsert` is `Omit<NewQuoteStatusEvent, 'tenantId' | 'id' | 'detectedAt'>` — the column is deliberately the database's, because "a caller-supplied `detectedAt` would let a clock skew reorder the record of when we noticed". The suite could not compile as written.
- **Fix:** `emitWon` writes the event, reads it back, and returns the `detected_at` the database assigned; every seeded touch is anchored to *that* instant. The window is therefore measured against the same value production measures it against, rather than against a fixture the test invented — strictly stronger than the planned form.
- **Files modified:** `tests/attribution-consume.test.ts`
- **Verification:** all 11 cases pass against the hosted database
- **Committed in:** `32a5210`

**2. [Rule 3 - Blocking] `listEscalationsForQuote` broke the repository barrel's pinned export set**
- **Found during:** Task 1
- **Issue:** `tests/lint-ban.test.ts` asserts `Object.keys(barrel).sort()` against an exact list (the ONB-05 raw-client ban). A new runtime export appears in that set and turns the guard red — the same mechanism `REPORT_LIST_LIMIT` hit in 07-01. `EscalationEvidence` is a type and erased, so it did not.
- **Fix:** Added `'listEscalationsForQuote'` with a decision-record comment in the established form, stating why it does not reopen the surface the 06-05 paragraph above it guards: keyed on one quote id the caller already holds, tenant-scoped in the same predicate, no `to_address` — it cannot list, cannot enumerate and cannot make a phone ring.
- **Files modified:** `tests/lint-ban.test.ts`
- **Verification:** `npx vitest run tests/lint-ban.test.ts` — 22 passed
- **Committed in:** `32a5210`

**3. [Rule 3 - Blocking] The route's seam assertion pins `runCadenceTick`'s whole argument object**
- **Found during:** Task 1
- **Issue:** `tests/cadence-tick-route.test.ts` asserts `toHaveBeenCalledWith({ sender, stallAlertSender })`. Adding `attribution: 'run'` to the route made it fail. The plan named this file for the key-set list only.
- **Fix:** Added `attribution: 'run'` to the assertion with the fourth-seam paragraph — and this is the better home for it than a grep: a route that called the tick without it would leave the service silently unable to bill for anything it recovered, with every count in the body reading zero and nothing else looking wrong.
- **Files modified:** `tests/cadence-tick-route.test.ts`
- **Verification:** 48 passed
- **Committed in:** `32a5210`

**4. [Rule 2 - Missing Critical] The suite left a production cursor row behind**
- **Found during:** Task 1, after the first green remote run
- **Issue:** The plan specifies parking the `'attribution'` cursor at the outbox head in `beforeAll` (Pitfall 11) but says nothing about restoring it. `teardownTenants` cannot reach `event_consumer_cursors` — it has no `tenant_id` — so the first run left the row at `last_event_id: 3988` on the production database. That is a permanent, silent decision about where the deployed route starts attributing from, made by a test rather than by the operator, and it contradicts the plan's own `<verification>` note that "the first production tick with `attribution: 'run'` registers the cursor at 0 and drains history idempotently".
- **Fix:** `beforeAll` now reads the cursor *before* parking it; `afterAll` restores it — deleting the row when it found none, because `null` ("never run") and 0 ("registered, at the start of history") are different facts under the outbox contract. The leftover 3988 row was removed and the suite re-run so the `null` branch was exercised for real.
- **Files modified:** `tests/attribution-consume.test.ts`
- **Verification:** post-run inspection of the hosted database — `event_consumer_cursors` holds only `cadence-engine`; `quote_attributions` / `monthly_reports` / `tenant_fees` all 0 rows
- **Committed in:** `32a5210`

**5. [Rule 2 - Missing Critical] Two header greps the plan asks for could not match their own text**
- **Found during:** Tasks 1 and 2
- **Issue:** Task 1's acceptance criterion requires zero occurrences of `CADENCE_CONSUMER` in `consume-wins.ts`, and the header explained the two-cursor rule by naming that constant. Task 2's requires exactly one `console.error`, and the new logging-discipline paragraph spelled `console.error` while describing it. Both criteria were failing on prose, not on code.
- **Fix:** The header now states each rule without spelling the token it forbids, and says so explicitly ("this paragraph describes the constant without naming it on purpose"). Same resolution 07-01 reached for its three `grep -c` criteria: reword the comment, do not loosen the gate.
- **Files modified:** `src/core/attribution/consume-wins.ts`
- **Verification:** both greps now return the required counts
- **Committed in:** `32a5210` and `9bd3602`

**6. [Rule 2 - Missing Critical] `evidence.ts` was outside `files_modified` but named in Task 2's action**
- **Found during:** Task 2
- **Issue:** Task 2's action says to state the Pitfall 7 decision "in the header AND in the row's `evidence.ledger[].deliveryStatus` comment". That field lives in `src/core/attribution/evidence.ts`, which the plan's `files_modified` frontmatter omits.
- **Fix:** Added the doc comment as the action instructs. It is comment-only, changes no schema and no behaviour, and it is the one place a reader of the evidence chain will actually be standing when they wonder whether a `null` delivery status was ever re-checked.
- **Files modified:** `src/core/attribution/evidence.ts`
- **Verification:** `tsc --noEmit` and `eslint` clean; all `attribution-decide` tests unaffected
- **Committed in:** `9bd3602`

---

**Total deviations:** 6 auto-fixed (3 blocking, 3 missing critical). No Rule 4 (architectural) situations arose.
**Impact on plan:** No scope creep. Three are the mechanical consequence of adding a runtime export and a new option to surfaces that are pinned by design; two are the plan's own acceptance criteria being taken literally rather than loosened; one closes a production-residue hole the plan did not anticipate.

## Deferred Items

Logged, not fixed (out of scope — pre-existing, in a file this plan does not own). See `.planning/phases/07-attribution-reporting/deferred-items.md`:

- **`tests/onboarding-gate.test.ts:356` — a wall-clock boundary flake.** It asserts `scheduledAt > approvedAt` where `approvedAt = new Date()`, and failed once during the full-suite regression run at exact-millisecond equality (`expected 1788329815516 to be greater than 1788329815516`). Re-run in isolation immediately afterwards: 13/13 passed. Nothing in this plan is reachable from `approveTemplateVersion`. The honest fix is a boundary decision — either the assertion becomes `toBeGreaterThanOrEqual` (which is what `b020f01 fix(03): a resume must never pull a not-yet-due touch earlier` actually guarantees) or `rewindowTouch` is specified to place strictly after its input. Owner is Phase 3/5.

## Issues Encountered

- **`npm test` bare reports 37 failing test FILES, with zero assertion failures.** All 37 fail at import time on `resolveTestEnv`'s "Refusing to run integration tests against a non-local Supabase" guard — the pre-existing environment gate. **2,259 tests pass across 66 pure suites.** The count moved 35 → 37 across wave 1 and 2 exactly as expected: 07-01 added `reporting-tables.test.ts` and this plan added `attribution-consume.test.ts`, both remote by design.
- **No production residue.** Post-run inspection of the hosted Sydney database: `quote_attributions` 0, `monthly_reports` 0, `tenant_fees` 0, and `event_consumer_cursors` holds only the `cadence-engine` row. The `'attribution'` cursor this suite creates is restored to absent by `afterAll`.
- **`grep -c`-exact acceptance criteria constrained prose again**, as in 07-01. Two header paragraphs had to be reworded to describe a rule without spelling the identifier the criterion forbids. The comments say the same thing in different words; the gates were not loosened.

## Known Stubs

None. No placeholder values, no skipped tests, no unrun `<verify>` blocks within this plan's scope.

## Threat Flags

None new. Every `mitigate` disposition in the plan's threat register is discharged:

| Threat | Disposition | Where mitigated |
|---|---|---|
| T-7-11 (duplicate attribution under rewind / overlapping ticks / reopen→won) | mitigate | Targetless claim on `quote_attributions_one_per_quote`; the replay and second-win cases in `tests/attribution-consume.test.ts`, both asserting on row identity rather than on values |
| T-7-12 (a suite or script draining real won history into production) | mitigate | `attribution` defaults to `'skip'` — no register, no scan, no advance; only the route passes `'run'`; the seam case asserts both directions and `grep` confirms no `scripts/` or `src/core/` call site passes it |
| T-7-13 (one tenant's failing run wedging attribution for everybody) | mitigate | Head-of-line hold + per-tenant transaction; `tests/attribution-consume-isolation.test.ts` proves later tenants still claim and their advance is withheld |
| T-7-14 (tick body or log carrying a tenant id, quote id, amount or driver error) | mitigate | Six enumerated numeric fields in both places, the route key set pinned, the recursive numeric-leaf walk; one `console.error` whose only interpolation is a tenant id, asserted against a rejection fixture that quotes a job number and a mobile |
| T-7-15 (evidence reads pulling addresses or bodies into a row that outlives them) | mitigate | Explicit select lists on all three reads, each pinned by a source assertion over its extracted key set; the serialized row asserted free of `@` and `+61` |
| T-7-16 (the cadence engine's cursor moved or read by this consumer) | mitigate | Zero occurrences of the identifier in `consume-wins.ts` (grep gate); cursor equality asserted before and after a full pass |
| T-7-SC (package installs) | accept | No install performed |

## Verification

- `npm run test:remote -- tests/attribution-consume.test.ts tests/cadence-tick.test.ts tests/cadence-tick-route.test.ts`: **46 tests, all passing** against the hosted Sydney database with the two production cron ticks lease-paused
- `npx vitest run tests/attribution-consume-isolation.test.ts`: **9 tests passing** (pure)
- `npm test` (bare): **2,259 tests passing** across 66 pure suites; 37 database-backed files gated by the environment guard (see Issues Encountered)
- `npm run test:remote` (full suite, regression check because this plan touched the repository barrel and `for-tenant.ts`): **2,774 of 2,775 passing**; the single failure is the pre-existing `onboarding-gate` wall-clock flake recorded under Deferred Items, which passed on an immediate isolated re-run
- `npx tsc --noEmit` exits 0; `npm run lint` (`eslint . --max-warnings=0`) exits 0
- Every acceptance-criteria `grep` in both tasks verified and matching, including `CadenceTickResult` at exactly 43 fields

## User Setup Required

None for this plan — no environment variable, no migration, no external service.

**One operator decision at deploy, though, and it is a real one.** The `'attribution'` cursor does not exist on the production database (the suite restores it to absent). The first tick that runs with `attribution: 'run'` will therefore register it **at 0** and walk the entire outbox history idempotently. That is the designed behaviour and it is safe — every event is re-read against the never-twice index, and no pre-connection win can be attributed because the 90-day backfill emits no events. But it does mean **historical wins with qualifying touches will be attributed on the first production tick**, retroactively. If the operator would rather start attributing from the deploy moment instead, the cursor must be set to the current outbox head *before* the deploy. There is no wrong answer here; there is only a decision that should be made deliberately rather than discovered on an invoice.

## Next Phase Readiness

- **07-04 (report generation and page) is unblocked.** `quote_attributions` rows now exist to be listed: `attributions.listForPeriod` has real input, and each row carries the frozen gross and conservative cents, `value_source`, and the evidence chain the methodology footnote interpolates from (`evidence.constants` and `evidence.baseline`, never the live constants). Note the `value_source = 'missing'` line: the generator must render it as "value unavailable — check job {id} in ServiceM8" rather than as a $0 line, and it must not be summed into a headline.
- **07-05 (metrics overview) is unblocked** for the attribution half; it still needs its own `forAllTenants_reportMetrics` and the two `tests/sync-upsert.test.ts` tripwire updates (12→13 exports, 13→15 tables), untouched here.
- **RPT-01 / RPT-02 / RPT-03 remain `Pending` in REQUIREMENTS.md**, per the phase rule that requirements flip only at the last plan — the same line 07-01 and 07-02 held. RPT-01 is now structurally true end to end; nothing yet generates the report a client is handed.

**Concerns carried forward:**
- **A1/A2 are still operator assumptions.** This plan's suite deliberately seeds a real connect-time baseline (25% over 40 quotes) so the `'connect'` branch is what is proven. The `'default'` branch — `DEFAULT_BASELINE_WIN_RATE = 0.70` — is exercised only in 07-02's pure tests, and it is the branch every no-history client will be billed on. It should be confirmed before the first real report reaches a client.
- **Pitfall 7 is accepted, not solved.** A touch counted as qualifying with a pending receipt can be reported `undelivered` seconds later and the row stands. That decision is now recorded in three places (the consumer header, the evidence schema's own field, and this summary) precisely because it is the kind of thing that looks like a bug to whoever finds it next.

---
*Phase: 07-attribution-reporting*
*Completed: 2026-09-02*

## Self-Check: PASSED

All three created files verified present on disk, along with this SUMMARY and the
updated `deferred-items.md`. Both task commit hashes (`32a5210`, `9bd3602`)
verified present in `git log --all`. Every acceptance-criteria `grep` in both
tasks re-run and matching, including `CadenceTickResult` at exactly 43 fields and
zero occurrences of the cadence engine's consumer identifier in
`src/core/attribution/consume-wins.ts`.
