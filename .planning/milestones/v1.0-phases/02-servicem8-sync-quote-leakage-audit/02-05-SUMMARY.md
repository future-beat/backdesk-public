---
phase: 02-servicem8-sync-quote-leakage-audit
plan: 05
subsystem: console
status: complete
tags: [console, ui, quotes, triage, servicem8, outbox, server-actions, rls]

requires:
  - phase: "02-01"
    provides: "quotes/quote_contacts schema, chase_eligibility excluded from the upsert conflict set, client detail page shell"
  - phase: "02-02"
    provides: "quote_status_events outbox contract, FIRST_SIGHT sentinel, quote_opened semantics, forTenant events accessor"
  - phase: "02-04"
    provides: "client detail page sections, health badge/banner, formatInTenantZone, badge CSS vocabulary"
provides:
  - "markChaseEligible(tenantId, quoteIds) — the ONLY path from backfilled to chase-eligible, flip + quote_opened in one transaction"
  - "forTenant().quotes.updateEligibilityWhereNeedsReview — state-conditional UPDATE whose WHERE clause is the idempotence mechanism"
  - "saveEligibilityAction + BLANK_ELIGIBILITY_STATE — WR-01 auth-first server action for the triage form"
  - "TriageForm component (44px label rows, no select-all)"
  - "Quotes table with the D-16 Open/Won/Lost/All status filter and three distinct empty states"
  - "CSS: .cell-truncate, .filter-link + [aria-current] pair, .table-scroll, .triage-row"
affects:
  - "Phase 3 (the quote_opened stream it consumes now contains exactly the quotes an operator approved)"
  - "02-06/02-07 (audit pages inherit .cell-truncate and .table-scroll)"

actuals:
  tokens: 23400
  tasks: 2
  commits: 4

tech-stack:
  added: []
  patterns:
    - "State-conditional UPDATE ... RETURNING as the idempotence mechanism — emission driven by what Postgres flipped, never by the caller's id list"
    - "Server actions authorize before they read formData; the tenant closure is the second layer, not the first"
    - "Display formatting happens once, on the server, so a table and the form beneath it cannot render the same quote two ways"
    - "Closed vocabularies (eligibility) get a label map, never a .replace() at the render site"

key-files:
  created:
    - src/core/sync/eligibility.ts
    - src/app/(console)/clients/[id]/triage-form.tsx
    - tests/quote-triage.test.ts
  modified:
    - src/app/(console)/clients/[id]/page.tsx
    - src/app/(console)/clients/[id]/actions.ts
    - src/app/globals.css
    - src/db/repository/for-tenant.ts
    - src/db/schema/quote-events.ts

key-decisions:
  - "The triage checklist is read INDEPENDENTLY of the status filter — it is an outstanding task, not a view of the current slice"
  - "Emission is driven by the UPDATE's own RETURNING, so an already-eligible / won / foreign id contributes nothing and a re-saved form announces nothing twice"
  - "No select-all control: one tap must not be able to approve a stranger's entire customer list"
  - "sm8_active = false stays out of every filter including All — a job the tradie deleted upstream must not be offered for triage"
  - "The plan's second repository accessor (insertQuoteOpenedEvents) was not added; 02-02's events.insertMany already carries the co-commit guarantee"
  - "quote-events.ts header corrected: emission now has exactly two sites (run-sync diff path, eligibility triage flip), and it names both"

patterns-established:
  - "Pattern: a repository method whose WHERE clause encodes the business precondition, so concurrency cannot defeat it"
  - "Pattern: three empty states where a naive implementation has one — never-synced, synced-none-open, filter-empty are three different diagnoses"

requirements-completed: [SYNC-01, SYNC-02]

coverage:
  - id: D1
    description: "Quotes table defaults to open with an Open · Won · Lost · All ?status= filter; won covers Work Order AND Completed; unknown params resolve to open"
    requirement: SYNC-01
    verification:
      - kind: unit
        ref: "tests/quote-triage.test.ts#maps every filter to the statuses it means — and `won` includes Completed"
        status: pass
      - kind: unit
        ref: "tests/quote-triage.test.ts#resolves an absent or unrecognised ?status= to open, never to all"
        status: pass
    human_judgment: false
  - id: D2
    description: "All three quote empty states render the exact UI-SPEC copy, and the triage section renders 'Nothing needs review.' instead of disappearing"
    requirement: SYNC-01
    verification:
      - kind: unit
        ref: "tests/quote-triage.test.ts#carries all three empty states, verbatim"
        status: pass
      - kind: unit
        ref: "tests/quote-triage.test.ts#renders \"Nothing needs review.\" rather than vanishing when triage is done"
        status: pass
    human_judgment: false
  - id: D3
    description: "Quote values render via Intl.NumberFormat en-AU currency with cents; no string-concatenated dollar signs"
    requirement: SYNC-01
    verification:
      - kind: unit
        ref: "tests/quote-triage.test.ts#renders money through Intl, never by gluing a dollar sign to a number"
        status: pass
    human_judgment: false
  - id: D4
    description: "Job descriptions and addresses truncate to one line with ellipsis; the table scrolls inside its own box on a phone"
    verification:
      - kind: unit
        ref: "tests/quote-triage.test.ts#truncates long cells to one line and keeps the filter link pair"
        status: pass
    human_judgment: false
  - id: D5
    description: "Ticked quotes become chase-eligible on Save eligibility; unticked stay needs_review and remain re-triageable"
    requirement: SYNC-02
    verification:
      - kind: integration
        ref: "tests/quote-triage.test.ts#flips ticked needs_review quotes and emits exactly one quote_opened each"
        status: pass
      - kind: integration
        ref: "tests/quote-triage.test.ts#leaves unticked quotes needs_review and re-triageable"
        status: pass
    human_judgment: false
  - id: D6
    description: "Flipping a quote to eligible emits exactly one quote_opened in the same transaction; re-saving cannot duplicate it, and only needs_review open rows flip"
    requirement: SYNC-02
    verification:
      - kind: integration
        ref: "tests/quote-triage.test.ts#is idempotent: the second save flips 0 and the event count does not move"
        status: pass
      - kind: integration
        ref: "tests/quote-triage.test.ts#flips nothing and emits nothing for an already-eligible quote"
        status: pass
      - kind: integration
        ref: "tests/quote-triage.test.ts#flips nothing for a won or lost quote — eligibility is an open-quote question"
        status: pass
      - kind: integration
        ref: "tests/quote-triage.test.ts#writes the outbox row Phase 3 expects — first-sight, opened, upstream timestamp"
        status: pass
    human_judgment: false
  - id: D7
    description: "A forged save naming another tenant's quote ids flips nothing (T-2-13), and the action authorizes before it reads formData"
    requirement: SYNC-02
    verification:
      - kind: integration
        ref: "tests/quote-triage.test.ts#flips nothing for ANOTHER tenant’s quote id, passed deliberately (T-2-13)"
        status: pass
      - kind: unit
        ref: "tests/quote-triage.test.ts#authorizes BEFORE it reads formData (WR-01 order)"
        status: pass
    human_judgment: false
  - id: D8
    description: "The open-quotes table with 200+ backfilled rows stays scrollable and the Save eligibility button reachable on a 390px phone viewport"
    verification: []
    human_judgment: true
    rationale: "Declared a backstop truth by the plan. .table-scroll and the 44px rows are asserted in source, but whether the button is actually reachable with 200 rows above it on a real 390px viewport is a rendering judgment no source assertion can make."
  - id: D9
    description: "Contact column resolves the JOB-type contact for each quote, name preferred, em-dash fallback"
    requirement: SYNC-01
    verification: []
    human_judgment: true
    rationale: "The join is exercised only against seeded contacts in unrelated suites; no test asserts the rendered Contact cell for a quote with two contacts of differing type. Needs a look at a real synced client during UAT."

duration: 14 min
completed: 2026-08-26
---

# Phase 02 Plan 05: Quotes Table + Operator Triage Summary

**The client detail page now shows the full synced quote history behind an Open · Won · Lost · All filter, and a checklist that is the only way a backfilled quote ever becomes something the cadence engine may touch — one tick, one `quote_opened`, and a second save that changes nothing.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-08-26T11:24:00Z
- **Completed:** 2026-08-26T11:38:00Z
- **Tasks:** 2
- **Files modified:** 8 (3 created, 5 modified)

## Accomplishments

- The D-16 quotes table: a `?status=` link group rendered on the server (no client JS, no hydration, Back button works), seven UI-SPEC columns, JOB-type contact joined on `sm8_job_uuid`, AUD money with cents, deterministic `quote_date DESC, id DESC` ordering.
- Three distinct empty states where a naive build has one.
- `markChaseEligible` — the D-15 gate, framework-free, transactional, and idempotent by construction.
- `saveEligibilityAction` — auth before body, uuid-array validation, tenant closure as the second layer.
- The triage checklist: 44px label rows, the UI-SPEC explainer, one full-width `Save eligibility`, and no select-all.

## Task Commits

1. **Task 1: Quotes table with status filter, contacts, empty states** — `8de755c` (feat)
2. **Task 2 (RED): failing triage tests** — `7acef03` (test)
3. **Task 2 (GREEN): eligibility flip, action, form, page wiring** — `8fe5e41` (feat)
4. **Task 1 acceptance criteria committed as assertions** — `e2aa427` (test)

## The counting problem, again — and why the WHERE clause is the answer

02-04's summary was about getting an email count right. This plan is about getting an event count right, and the two failure directions are the same shape.

**One too few** is a quote the operator approved that nobody ever chases. Nothing errors; the row just sits at `eligible` with no announcement, and the client asks in six weeks why that job was never followed up.

**One too many** is a customer texted twice about the same quote. That one the client hears about the same day, from the customer.

The mechanism that makes it exactly one is not a check in the action. It is the `WHERE ... AND chase_eligibility = 'needs_review'` inside the UPDATE statement, and the fact that the event emission is driven by that statement's own `RETURNING` rather than by the id list the caller submitted. Postgres evaluates the precondition inside the same statement that performs the write, so two concurrent saves of the same form cannot both see `needs_review` and both flip: one matches the rows, the other matches zero. A read-then-write in the action would have a window between the two, and losing that race costs a duplicate SMS.

That is also why the accessor is named `updateEligibilityWhereNeedsReview` rather than `setEligible` — the condition is not an implementation detail of the method, it is the guarantee.

Eight of the nineteen tests in the new suite exist to pin this: already-eligible, won, lost, foreign-tenant, a mixed list, an empty list, and a double save whose second call flips 0 and leaves the event count unmoved.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 2 — Missing critical] `quote-events.ts` documented a guarantee this plan makes false**

The outbox header stated, as a structural claim: *"event emission lives only in `run-sync.ts`'s diff path, which `connect.ts` never calls."* This plan adds a second emission site. Left alone, the file that every Phase 3 consumer is told to read first would have asserted something untrue about the stream they consume — and the specific untruth ("there is one emission site") is exactly the kind a consumer builds an assumption on.

The header now names both sites and what distinguishes them: a quote that *arrives* after connection lands eligible in the diff path; a *backfilled* quote becomes eligible only through an operator's save. The `connect.ts` claim (backfill emits nothing) is unchanged and still true.

- **Files:** `src/db/schema/quote-events.ts`
- **Commit:** `8fe5e41`

**2. [Rule 1 — Bug in the test, found by the test] The uuid assertion asserted the wrong location**

The first RED run left one failure standing after implementation: an acceptance-criterion assertion looked for `uuid()` *inside* the action body, but the schema is a module constant — the same shape `connectSchema` has used since 02-01. Moving the validation inside the function to satisfy the test would have been the tail wagging the dog, and would have rebuilt the schema object on every invocation.

The assertion was split instead: the schema must demand `z.array(z.uuid())`, and the action must run `eligibilitySchema.safeParse` *before* it calls `markChaseEligible`. That proves the property the criterion was actually about (validated ids reach the repository) rather than a coincidence of where a constant is declared.

- **Files:** `tests/quote-triage.test.ts`
- **Commit:** `8fe5e41`

### Intentional design deviations

**3. The second repository accessor (`insertQuoteOpenedEvents`) was not added**

The plan names a pair: `updateEligibilityWhereNeedsReview` + `insertQuoteOpenedEvents`. The first is genuinely new. The second would have been a thin rename of 02-02's `events.insertMany`, which already exists, already takes the tenant from the closure, and already carries the co-commit guarantee the emission depends on. A second door into the same table means two places for a future change to the outbox write to land, and one of them to eventually not.

**4. Triage is read independently of the status filter**

The plan places triage "inside the quotes section". It does — but its query is its own, not a subset of the filtered table. Deriving the checklist from the visible rows would make it vanish when the operator switches to `Won` to check something, and reappear when they switch back. Triage is an outstanding task, not a view of the current slice, and a task that hides itself under a filter is a task that gets forgotten.

**5. `sm8_active = false` is excluded from every filter, including `All`**

`All` means the full *synced history the tradie would recognise*, not every row we hold. A job deleted upstream is kept (Pitfall 6 — deletion must be visible to us as deletion) but surfacing it under `All` would put a deleted job one filter-switch away from the triage list.

**6. There is no select-all control on the checklist**

The omission is the feature. D-15's whole value is that a human looked at each row of a stranger's customer list; a select-all turns that review into one tap, which is the outcome the decision exists to prevent.

**7. The job address renders as a second truncated line inside the Description cell**

The plan lists no Address column, but the must-have truth names addresses among the things that must truncate. Rather than add an eighth column to a table already at seven on a 390px screen, the address is a `.muted` second line in the description cell — both lines `.cell-truncate`, so neither wraps and the row height stays constant.

**8. Quote counts: `QUOTE_LIMIT = 500`, up from the previous 100**

The old list was open-quotes-only. `All` over a 90-day backfill plus subsequent history is a bigger set, and 100 would have silently truncated the history the filter exists to show. 500 is bounded (an unbounded select is not something to ship) and comfortably past founding-cohort scale.

---

**Total deviations:** 2 auto-fixed (1 missing critical, 1 bug), 6 documented design deviations.
**Impact on plan:** No scope creep. Both auto-fixes were correctness of the contract Phase 3 reads.

## Threat mitigations applied

| Threat | Applied |
|---|---|
| T-2-13 (EoP on `saveEligibilityAction`) | `authorize()` — session claims + an RLS-scoped membership read — runs before `formData` is touched, asserted by source order. `z.array(z.uuid()).min(1).max(1000)` bounds a forged body. The `forTenant` closure supplies `tenant_id` to the UPDATE from the call argument, never from the request: proven by the cross-tenant test, which passes another client's real quote ids and flips nothing. |
| T-2-11 (duplicate emission) | State-conditional `WHERE`, emission driven by `RETURNING`, both writes in one transaction. Double-save test asserts the event count does not move. |
| T-2-04 (info disclosure on the page) | Every read on the page goes through the AUTHENTICATED Supabase client, so RLS decides visibility and denial is indistinguishable from absence. `tests/leak.test.ts` re-run green (30 passed). |

## Verification

| Check | Result |
|---|---|
| `ALLOW_REMOTE_TESTS=yes npx vitest run tests/quote-triage.test.ts` | 19 passed (new) |
| `ALLOW_REMOTE_TESTS=yes npx vitest run tests/leak.test.ts` | 30 passed |
| `ALLOW_REMOTE_TESTS=yes npx vitest run` (full suite) | **369 passed** (14 new at the time of the run; 5 more added after) |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npm run build` | compiled, 7 routes |

### Acceptance criteria

| Criterion | Evidence |
|---|---|
| Filter maps absent/open→Quote, won→Work Order+Completed, lost→Unsuccessful, all→no filter | `FILTER_STATUSES` + `readFilter` assertions |
| Three distinct empty-state strings present | verbatim assertions |
| `.cell-truncate` + filter-link active/inactive pair added; no grandfathered rule modified | rule assertions; `git diff src/app/globals.css` shows 0 deleted lines |
| Money via `Intl.NumberFormat` AUD, no `$${...}` template | positive + negative assertions |
| Four behaviour cases incl. cross-tenant | 8 integration tests |
| Exactly-once proven by double-save event count | `afterSecond.length === afterFirst.length` |
| Each checkbox wrapped in a label with the min-height rule | source + CSS rule assertion |
| Auth check before `formData` | index-order assertion |

## Known Stubs

None. Every path in this plan is wired to real data and exercised against the live Sydney database.

## UAT — needs a human

Two items, both rendering judgments no source assertion can make:

1. **The 200-row backstop.** Seed a tenant with 200+ open quotes, open the client page at 390px, and confirm the table scrolls sideways inside its own box (not the page) and that `Save eligibility` is still reachable at the bottom of the checklist.
2. **The Contact column against real data.** Confirm a quote whose job carries both a `JOB` and a `BILLING` contact shows the JOB one, and that a job with no contact shows the em-dash rather than a blank cell.

02-04's inherited UAT item (the console has still never been visually verified) now covers this screen too.

## Next Phase Readiness

- **Phase 3** can consume `quote_status_events` knowing every `quote_opened` for a backfilled quote was preceded by an operator's explicit save. The paused-connection rule is unchanged: dispatch still checks `sm8_connections.paused_at IS NULL` itself.
- **02-06/02-07** inherit `.cell-truncate` and `.table-scroll`; `baseline_*` on `sm8_connections` (D-14) is still unpopulated and remains 02-06's.
- No new environment variables, no new dependencies.

---
*Phase: 02-servicem8-sync-quote-leakage-audit*
*Completed: 2026-08-26*

## Self-Check: PASSED

All 3 created files verified present on disk; all 4 commits (`8de755c`, `7acef03`, `8fe5e41`, `e2aa427`) verified in `git log`. No commit deleted a tracked file.
