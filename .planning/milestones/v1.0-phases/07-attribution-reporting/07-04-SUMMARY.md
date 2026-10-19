---
phase: 07-attribution-reporting
plan: 04
subsystem: frontend
tags: [next-app-router, server-actions, print-css, zod, frozen-documents, integer-cents, rls, vitest]

requires:
  - phase: 02-servicem8-sync-quote-leakage-audit
    provides: "audits/[id] as the printed-sheet mould (page-level CSS import, forced-light @media print block, @page A4), parseMoneyToCents, the connect-time baseline columns on sm8_connections"
  - phase: 05-ai-drafting-classification
    provides: "the 23505-at-the-write precedent the concurrent-generate mapping reuses"
  - phase: 06-review-console-escalation
    provides: "the authorize → zod → core → revalidatePath action shape, action-state.ts outside 'use server', the CLIENT_REACHABLE lint tripwire, the 32-code-point first-name cap"
  - phase: 07-attribution-reporting
    provides: "07-01's monthly_reports/tenant_fees tables and reports.insertVersion/list/byId + fees.append/list; 07-02's calendarMonth/previousMonth/localDateString, feesInForce/hasMonthlyFeeInForce/monthlyFeeInForceOn, computeReportFigures, resolveBaseline, truncateCodePoints, formatCents/formatMultipleBp; 07-03's quote_attributions rows and their evidence chain"
provides:
  - "generateMonthlyReport — the one write that freezes a month: four refusals as VALUES, one transaction for the whole snapshot, frozen per-job lines, the versioned insert and the 23505 → 'concurrent' mapping"
  - "src/core/reporting/document.ts — the five jsonb schemas + parseReportDocument as a LEAF module, so the printed page can assert the row without reaching the generator"
  - "src/core/reporting/copy.ts — periodLabel, formatReportDate, shortDate, methodologyNotes (five footnotes, every variant, plus the † lines), generateRefusalMessage, generateSuccessMessage, GENERATE_FAILED_MESSAGE"
  - "forTenant().ledger.countQuotesChasedInPeriod, .inbound.countThreadedInPeriod, .events.countWonQuotesInPeriod — half-open, tenant-pinned, the D-02 predicate written in SQL"
  - "/reports/[client] — Generate form, every version listed, and the append-only fee schedule that supplies the multiple's denominator"
  - "/reports/[client]/[reportId] — the A4 monthly report, rendered FROM the row, with report.css's print block"
  - "generateReportAction + appendFeeAction, GenerateState/FeeState, GenerateForm/FeeScheduleForm/PrintButton"
  - "globals.css .num and .metrics — token-only, and .metrics is the dl 07-05's six live metrics render into"
affects: [07-05-metrics-overview]

actuals:
  tokens: 41100
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "A leaf shape module between the writer and the reader: the schema that describes a frozen document lives apart from the function that produces one, so the renderer can parse without being able to recompute"
    - "Refusals as VALUES, not throws: every ordinary operator situation returns a `kind` the action maps to one sentence naming the fix; only a genuine write failure propagates"
    - "Catch the unique-violation OUTSIDE the transaction that raised it — the rollback has happened and there is nothing left to commit"
    - "Two opposite medium switches (`.report-screen-note` / `.report-print-only`) rather than one modifier, so a fact carried by a badge on screen is carried by text on paper"
    - "Match the row a pure rule picked by OBJECT IDENTITY rather than re-running the rule per list item, so a badge and the figure it describes cannot disagree"

key-files:
  created:
    - src/core/reporting/generate.ts
    - src/core/reporting/document.ts
    - src/core/reporting/copy.ts
    - src/app/(console)/reports/[client]/page.tsx
    - src/app/(console)/reports/[client]/actions.ts
    - src/app/(console)/reports/[client]/action-state.ts
    - src/app/(console)/reports/[client]/generate-form.tsx
    - src/app/(console)/reports/[client]/fee-schedule-form.tsx
    - src/app/(console)/reports/[client]/[reportId]/page.tsx
    - src/app/(console)/reports/[client]/[reportId]/print-button.tsx
    - src/app/(console)/reports/[client]/[reportId]/report.css
    - tests/monthly-report.test.ts
    - tests/reporting-copy.test.ts
    - tests/reports-authorization.test.ts
  modified:
    - src/db/repository/for-tenant.ts
    - src/app/globals.css
    - tests/lint-ban.test.ts

key-decisions:
  - "The five jsonb schemas live in a LEAF module (`src/core/reporting/document.ts`) that `generate.ts` re-exports, rather than in `generate.ts` itself. The plan's own action text said the page parses with the generator's schemas while its acceptance criterion forbids a VALUE import of `@/core/reporting/generate` from that page — and a zod schema is a value, not a type. The split satisfies both and is the stronger guarantee: not 'the page does not recompute' but 'the page cannot'."
  - "`generateMonthlyReport` catches SQLSTATE 23505 OUTSIDE the transaction. The loser's raise has already aborted its transaction, so catching it inside would return a value into a transaction Postgres has condemned and leave the commit to chance."
  - "All six reads run inside ONE transaction — not for write atomicity (there is one write) but for ONE SNAPSHOT: a `won` event consumed between the attribution list and the win count would produce a document whose per-job table contradicts its own headline."
  - "The three count reads are SQL, not TypeScript filters, and the D-02 predicate is spelled `delivery_status IS DISTINCT FROM 'undelivered'`. The plain inequality is NULL — and therefore false — for every email touch and every pending SMS, which is most of the qualifying rows; the remote suite seeds exactly those rows so the wrong form fails."
  - "`COUNT(...)::int` on all three: `COUNT()` is a bigint and postgres.js returns bigints as STRINGS, so without the cast `quotesChased` arrives as '7' and every arithmetic use of it concatenates."
  - "Footnote percentages are trimmed to `25%` where the tenth is zero, while tables keep `25.0%`. Prose has no columns to align, and '25.0%' claims a measurement to three significant figures about a ratio of two small integers. The trim is a string operation on `formatRateBp`'s output — the single-division rule in `format.ts` is untouched."
  - "`periodLabel` builds its instant through `calendarMonth` rather than parsing `period_start` as UTC midnight. The two agree for every Australian zone and disagree for every negative-offset one, where the report heading and its own footer would name different months."
  - "The `in force` badge is matched by OBJECT IDENTITY against the row `monthlyFeeInForceOn` returned, not by re-deriving an id. One array, one rule, one answer — the badge and the report's denominator cannot point at different rows."
  - "The fee-kind label map THROWS on an unknown member rather than falling back to a string rewrite. A vocabulary widened in the database CHECK and not here would render a raw enum member on a page about money, and the operator would read it as a bug in the amount beside it."
  - "The Kind select opens on an empty `Choose…` option and no field in the Add-a-fee form arrives pre-filled. A pre-selected `monthly` is how a $990 setup fee gets recorded as a recurring one; the PROJECT.md pricing appears only as a placeholder and one hint sentence."
  - "`revalidatePath` fires on the `concurrent` arm too: that arm means somebody else's version landed a moment ago, so this operator's list is stale in exactly the way the message tells them to fix by reloading."

patterns-established:
  - "Leaf shape module between writer and reader — the render-from-the-row mandate enforced by the module graph rather than by a source scan alone (the scan stays, as the second defence)"
  - "Refusal `kind`s mapped to sentences by a pure copy module, so every refusal is byte-assertable without a database"
  - "`.report-screen-note` / `.report-print-only` as opposite defaults, so operator context and client-facing text are each present in exactly one medium"
  - "Seed fixtures that carry the EXCLUDED rows too (a stub sender, an undelivered receipt, a July touch, an ambiguous reply) on quotes nothing else touches, so a leak moves the count by exactly one"
  - "Acceptance-criterion greps kept honest by rewording prose rather than loosening the criterion (the 07-01 precedent), and reported where a criterion is arithmetically unsatisfiable"

requirements-completed: []

coverage:
  - id: D1
    description: "An operator picks a month on /reports/[client] and a frozen, versioned monthly_reports row is written: half-open calendar-month bounds in the tenant's zone, figures, per-job lines, baseline, constants and fees"
    requirement: RPT-02
    verification:
      - kind: integration
        ref: "tests/monthly-report.test.ts#writes version 1 with figures, lines and the frozen constants"
        status: pass
      - kind: integration
        ref: "tests/monthly-report.test.ts — the 1-September-local win is excluded from August (half-open to the millisecond)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Regenerating a month writes version N+1 and keeps N; two concurrent generates produce exactly one document per version with no gap and no duplicate"
    requirement: RPT-02
    verification:
      - kind: integration
        ref: "tests/monthly-report.test.ts#generates again as version 2 and KEEPS version 1 (D-11)"
        status: pass
      - kind: integration
        ref: "tests/monthly-report.test.ts#lets exactly one of two concurrent generates commit (T-7-19)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The four refusals are values with named fixes: future month, no connection, a month that ended before connect, and NO monthly fee — while a recorded $0.00 fee generates with a null multiple"
    requirement: RPT-02
    verification:
      - kind: integration
        ref: "tests/monthly-report.test.ts#refuses a month that has not started / ended before the client was connected / with NO monthly fee recorded (U-4)"
        status: pass
      - kind: integration
        ref: "tests/monthly-report.test.ts#GENERATES for a recorded $0.00 fee, with no multiple"
        status: pass
      - kind: unit
        ref: "tests/reporting-copy.test.ts — all six refusal sentences byte-verbatim against the UI-SPEC"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every number, label and footnote on the printed page comes from the frozen row — the page imports no aggregation module and computes nothing"
    requirement: RPT-02
    verification:
      - kind: integration
        ref: "tests/monthly-report.test.ts#imports no aggregation module — the render-from-the-row mandate as a test"
        status: pass
      - kind: unit
        ref: "tests/reporting-copy.test.ts#says 30 days for a report computed under 30, and 45 for one computed under 45"
        status: pass
    human_judgment: false
  - id: D5
    description: "The printed report and its frozen lines carry no customer phone, email, address, message body or reply text"
    requirement: RPT-02
    verification:
      - kind: integration
        ref: "tests/monthly-report.test.ts#freezes no customer address, phone number or message body (T-7-20, U-3)"
        status: pass
      - kind: unit
        ref: "src/core/reporting/document.ts reportLineSchema — job number, ≤61-code-point description and a capped first name, and nothing else"
        status: pass
    human_judgment: false
  - id: D6
    description: "Both server actions authorize before they parse, and write nothing on any denied or invalid path"
    requirement: RPT-02
    verification:
      - kind: unit
        ref: "tests/reports-authorization.test.ts (13 cases: no session, non-member, malformed id, bad month, bad amount, bad date, unchosen kind — 0 core/repository calls on every one)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Fees are append-only, recorded only by an operator action, in integer cents, and the row the report divides by wears `in force`"
    requirement: RPT-02
    verification:
      - kind: unit
        ref: "tests/reports-authorization.test.ts#writes ONE row in INTEGER CENTS for a cleared caller (59_700 from '597.00')"
        status: pass
      - kind: unit
        ref: "tests/reports-authorization.test.ts#refuses `59.7` — a one-decimal amount is a typo, not $59.70"
        status: pass
      - kind: manual_procedural
        ref: "grep: no `defaultValue` anywhere in fee-schedule-form.tsx; the PROJECT.md pricing appears only as a placeholder and one hint sentence"
        status: pass
    human_judgment: false
  - id: D8
    description: "Every enumerated state the UI-SPEC lists for the printed page and the version list exists: constant mismatch, value unavailable, month to date, superseded, newer version, zero lines"
    requirement: RPT-02
    verification:
      - kind: manual_procedural
        ref: "grep acceptance battery on both page files (mismatch sentence, `value unavailable`, `†`, `a newer version exists`, 0 × `redirect(`, `superseded`, `month to date`)"
        status: pass
      - kind: manual_procedural
        ref: "End-of-phase human check: print a generated report from a dark-mode phone — light A4, accent hero, no nav/buttons/back link, repeated table header on page two"
        status: deferred
    human_judgment: true
  - id: D9
    description: "No client-reachable module pulls a database module into the browser bundle"
    verification:
      - kind: unit
        ref: "tests/lint-ban.test.ts — action-state.ts, generate-form.tsx, fee-schedule-form.tsx and print-button.tsx joined CLIENT_REACHABLE"
        status: pass
      - kind: integration
        ref: "npm run build exits 0 with both new routes rendered as ƒ (Dynamic)"
        status: pass
    human_judgment: false

duration: 35min
completed: 2026-09-02
status: complete
---

# Phase 7 Plan 04: Report Generation & the Printed Page Summary

**An operator picks August on a client's reports page, gets a frozen version-1 row, opens it as an A4 document whose every number and footnote came out of that row, prints it to PDF from the browser — and doing it again yields version 2 beside version 1, with the fee that supplies the multiple's denominator recorded on the same screen.**

## Performance

- **Duration:** 35 min
- **Started:** 2026-09-02T06:37:00Z
- **Completed:** 2026-09-02T07:12:00Z
- **Tasks:** 3 (one tracer, two auto)
- **Files modified:** 17 (14 created, 3 modified)

## Accomplishments

- **The freeze is real and proven against production Postgres.** `generateMonthlyReport` writes `period_start '2026-08-01'` / `period_end '2026-09-01'` for Perth August, and a win detected at exactly `2026-08-31T16:00:00.000Z` — the first millisecond of 1 September local — is NOT in it. That single seeded row is the D-10 promise: a closed upper bound would put one job on two invoices.
- **Regenerating keeps what was sent.** Version 2 lands beside version 1, `reports.list()` returns `[v2, v1]`, and the version list shows both — `latest` on the newer, `superseded` in `.muted` on the older, never hidden.
- **Two concurrent generates settle at the index, not in the caller.** `Promise.all` of two generates for one month yields dense, distinct versions with no gap and no duplicate; a loser reports `concurrent`, which the action turns into `A report for August 2026 was just generated — reload to see it.` The 23505 is caught outside the transaction it aborted.
- **The four refusals are values with named fixes,** and a recorded `$0.00` monthly fee is a FACT rather than a gap: it generates, prints `—` for the return on fees, and footnote 4 says why. Only a missing schedule refuses, pointing at the disclosure directly below the button.
- **The printed page cannot recompute.** The five jsonb schemas live in `src/core/reporting/document.ts`, a leaf module; the page imports it, `copy.ts` and `format.ts`, and the remote suite asserts it value-imports none of `figures`, `fees`, `metrics` or `generate`. Footnote 1 renders `30 days` or `45 days` purely as a function of the row — asserted as a pair, from the same module, at the same moment.
- **Nothing a customer could be identified by leaves the building.** The frozen row's JSON is asserted free of `@` and `+61` against a fixture whose ledger and inbound rows carry a real-shaped email address and ACMA fiction mobiles.
- **Both actions authorize before they parse** (a Server Action id is globally POSTable and both write through the service-role path), with 13 cases asserting zero core and zero repository calls on every denied or invalid path.
- **The fee schedule is append-only and never pre-filled.** `597.00` becomes exactly 59_700 cents through `parseMoneyToCents`; `59.7` is refused as a typo; the PROJECT.md pricing appears only as a placeholder and one hint sentence.

## Task Commits

1. **Task 1 (tracer): Pick a month → frozen versioned row → printed A4 page, end to end** — `5d2fba5` (feat)
2. **Task 2: Every printed-page state, and the copy suite** — `57f36f1` (feat)
3. **Task 3: Fee schedule on the reports page, auth-first proof** — `a3431f6` (feat)

**Plan metadata:** see the final `docs(07-04)` commit.

## Files Created/Modified

- `src/core/reporting/generate.ts` — `generateMonthlyReport`, `GenerateReportResult`, the one-transaction snapshot, the frozen-line builder, `isUniqueViolation`, and the re-export of the document shape
- `src/core/reporting/document.ts` — the five zod schemas, `ReportDocument`, `parseReportDocument`; imports `zod` and nothing else
- `src/core/reporting/copy.ts` — `periodLabel`, `formatReportDate`, `shortDate`, `methodologyNotes`, `generateRefusalMessage`, `generateSuccessMessage`, `GENERATE_FAILED_MESSAGE`
- `src/db/repository/for-tenant.ts` — `ledger.countQuotesChasedInPeriod`, `inbound.countThreadedInPeriod`, `events.countWonQuotesInPeriod` on the interface and in `build()`
- `src/app/(console)/reports/[client]/page.tsx` — the per-client page: back link, h1 + zone note, the 07-05 slot comment, Monthly reports, and the fee-schedule disclosure
- `src/app/(console)/reports/[client]/actions.ts` — `authorize`, `generateReportAction`, `appendFeeAction`, `isRealCalendarDate`, `toFeeFieldErrors`
- `src/app/(console)/reports/[client]/action-state.ts` — `GenerateState`/`FeeState` + blanks and the three fixed messages; imports nothing
- `src/app/(console)/reports/[client]/generate-form.tsx` — two defaulted selects and a 44px button inside one `.controls`
- `src/app/(console)/reports/[client]/fee-schedule-form.tsx` — `Add a fee`, four fields, three field errors, no pre-filled value anywhere
- `src/app/(console)/reports/[client]/[reportId]/page.tsx` — the A4 sheet plus every enumerated state
- `src/app/(console)/reports/[client]/[reportId]/print-button.tsx` — one synchronous `window.print()`; imports nothing
- `src/app/(console)/reports/[client]/[reportId]/report.css` — the `audit.css` twin: screen rules, the verbatim print block, the extended hidden list, `table-header-group`, the `break-inside` set
- `src/app/globals.css` — `.num` and `.metrics` (+`dt`/`dd`), token-only
- `tests/monthly-report.test.ts` — 9 remote cases
- `tests/reporting-copy.test.ts` — 24 byte-asserted cases
- `tests/reports-authorization.test.ts` — 13 auth-first cases
- `tests/lint-ban.test.ts` — four new `CLIENT_REACHABLE` entries

## Decisions Made

See `key-decisions` in the frontmatter. The load-bearing one is the **leaf shape module**: the plan asked the printed page to parse with the generator's schemas AND asserted the page value-imports no generator. A zod schema is a value, so those could not both hold. Extracting `document.ts` satisfies both and turns the render-from-the-row mandate from an assertion into a property of the module graph.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The plan's own Task 1 action and its acceptance criterion (e) were mutually unsatisfiable**
- **Found during:** Task 1
- **Issue:** Action step (7) says the printed page parses the five jsonb columns "with the generate.ts schemas"; acceptance criterion (e) requires that the page NOT value-import `@/core/reporting/generate` ("schemas may be `import type`d"). A zod schema is a runtime value — an `import type` of one cannot parse anything.
- **Fix:** Extracted the five schemas, `ReportDocument` and `parseReportDocument` into `src/core/reporting/document.ts`, a leaf importing only `zod`. `generate.ts` imports it and RE-EXPORTS the schemas, so the plan's artifact contract ("the five jsonb zod schemas" exported from generate.ts) still holds; the page imports the leaf.
- **Files modified:** `src/core/reporting/document.ts` (new), `src/core/reporting/generate.ts`, `src/core/reporting/copy.ts`
- **Verification:** `tests/monthly-report.test.ts#imports no aggregation module` passes with the four bans and three positive assertions
- **Committed in:** `5d2fba5`

**2. [Rule 3 - Blocking] The remote fixture collided with `send_ledger_cadence_touch_uniq`**
- **Found during:** Task 1 (first remote run)
- **Issue:** The seed shared one cadence across two quotes and reused `touch_number` 1, which the Phase 3 never-twice index correctly refuses. The suite failed in `beforeAll` with a 23505.
- **Fix:** One cadence per quote. Deliberately not worked around by inventing higher touch numbers — the index is the CAD-04 guarantee, not a nuisance.
- **Files modified:** `tests/monthly-report.test.ts`
- **Verification:** 9 passed against the hosted database
- **Committed in:** `5d2fba5`

**3. [Rule 1 - Bug] A `<p>` inside a `<dl>` in the report hero**
- **Found during:** Task 1
- **Issue:** The UI-SPEC describes the hero as `dt` + 32px `dd` + a 14px muted line. Rendered as a `<p>` that line is not a legal child of a `dl` — invalid markup on the one page that gets printed and handed over.
- **Fix:** A SECOND `dd` on the same `dt` (two descriptions of one term, which is what they are), with a `.report-hero-note` rule stepping it back down to 14px prose that wraps.
- **Files modified:** `src/app/(console)/reports/[client]/[reportId]/page.tsx`, `.../report.css`
- **Verification:** `npm run build` exits 0; the rule is inside the existing `.report-hero` block
- **Committed in:** `5d2fba5`

**4. [Rule 2 - Missing Critical] Fixture rows the plan's cases implied but did not enumerate**
- **Found during:** Task 1
- **Issue:** The plan's remote cases asserted `quotesChased`, `replies` and `jobsWonTotal` but seeded nothing that must be EXCLUDED from them. A `delivery_status <> 'undelivered'` predicate written where `IS DISTINCT FROM` belongs would have passed every listed case while silently dropping every email touch and every pending SMS.
- **Fix:** Added a stub-sender row, an undelivered row, a July touch, an `ambiguous` reply, a July reply and a fourth `won` event the service does not claim — each on a quote nothing else touches, so a leak moves its count by exactly one. Plus a second touch on one quote, so `COUNT(DISTINCT quote_id)` is provably not `COUNT(*)`.
- **Files modified:** `tests/monthly-report.test.ts`
- **Verification:** `quotesChased` 2, `replies` 2, `jobsWonTotal` 3 — all three would move under the wrong predicate
- **Committed in:** `5d2fba5`

### Criteria reported rather than met

**5. `grep -c 'parseMoneyToCents' actions.ts` = 1 is arithmetically unsatisfiable — landed at 2.**
`grep -c` counts LINES. An import statement and its call site cannot occupy the same line, so the minimum for a module that imports and uses the function is 2. The criterion's intent (use `parseMoneyToCents`, never `Number(amount) * 100`) holds and is asserted behaviourally: `tests/reports-authorization.test.ts` pins `59_700` from `'597.00'`, which the float form would render as `59699.999...`. A third occurrence in a doc comment was reworded away rather than left to pad the count. Every other grep criterion in the plan is met exactly, two of them (`replace('_'` = 0, `defaultValue` = 0) by rewording prose rather than loosening the criterion — the 07-01 precedent.

### Discretion recorded

- **A sixth generate-side sentence.** `GENERATE_INPUT_MESSAGE` (`Pick a month and a year, then generate.`) covers a body that fails the zod schema. Both selects are required and defaulted, so the FORM cannot produce it; it exists for a forged POST to a globally-addressable Server Action id, and says the one true thing without echoing what was sent.
- **`not_connected` refusal copy.** The UI-SPEC enumerates five refusals; the plan authorised a sixth for a client with no ServiceM8 connection at all (`{Client name} isn't connected to ServiceM8 — there is nothing to report.`), which would otherwise fall through to "could not generate" and say nothing.
- **The printed page value-imports `@/core/reporting/period`** for `localDateString`, used by the month-to-date predicate. It is a zone formatter, not an aggregation, is not on the mandate's ban list, and is the same function the version list uses for the same predicate — so the badge on the list and the badge on the sheet cannot key on different rules.

## Issues Encountered

- **`en-AU` renders September as `Sept`, not `Sep`.** CLDR's four-letter abbreviation. The existing audit sheet formats dates the same way, so the behaviour is consistent across both printed documents; the copy suite pins an August instant (`5 Aug 2026`) rather than asserting whatever ICU emits for September.
- **`npm test` bare exits non-zero, with 0 assertion failures.** 2321 tests passed; 38 files refuse to run without `ALLOW_REMOTE_TESTS` (the WR-09 disposable-stack gate). Expected, and unchanged by this plan.
- **No production residue.** Post-run counts on the hosted database: `quote_attributions` 0, `monthly_reports` 0, `tenant_fees` 0. The four `quote_status_events` rows present are pre-existing `quote_opened` rows from 27/29 August belonging to the real `Perth Sparks Electrical (Test)` tenant, not this run's.

## Known Stubs

| Stub | File | Reason |
|------|------|--------|
| `← Reports` back link (both new routes) points at `/reports`, which does not exist yet; the nav carries no `Reports` link | `src/app/(console)/reports/[client]/page.tsx`, `.../[reportId]/page.tsx` | 07-05 builds the cross-client overview at `/reports` and adds the nav entry and the `Reports & metrics →` link on `clients/[id]` (UI-SPEC Screens §1 and §4, D-14). Until then both routes are reachable only by URL. Recorded in `.planning/WINDOWS.md`. |
| One-line comment marking the `Last 30 days` slot above `Monthly reports` | `src/app/(console)/reports/[client]/page.tsx` | The plan's own instruction: 07-05 inserts the six live metrics there. The section is absent, not empty — nothing renders a placeholder. |

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **07-05 (metrics overview) is unblocked and has everything it needs from here:** the `/reports/[client]` page with its marked slot, `.metrics` in globals.css (a `.profile`-shaped `dl` whose `dd` is a flex row so a badge and its evidence text wrap under the rate on a phone), `.num` for the overview's figures, and the `authorize` shape to copy for any new action. It must still add `/reports` itself, the nav link, the `Reports & metrics →` line on `clients/[id]`, its own `forAllTenants_reportMetrics`, and the two `tests/sync-upsert.test.ts` tripwire updates (12→13 exports, 13→15 tables) — none of which this plan touched.
- **The three count reads are on `forTenant()` and are half-open**, so 07-05's rolling-window metrics can reuse them against a `rollingWindow` period without a second predicate.
- **RPT-01 / RPT-02 / RPT-03 remain `Pending` in REQUIREMENTS.md**, per the phase's rule that requirements flip only at the last plan. The document exists and prints; the overview that proves the phase does not yet.
- **One human check is deferred to the end of the phase** (`workflow.human_verify_mode = end-of-phase`): print a generated report from a dark-mode phone and confirm the light A4 sheet, the accent hero, the hidden controls, and a repeated table header with no row split across the fold on a 20-line month.

---
*Phase: 07-attribution-reporting*
*Completed: 2026-09-02*

## Self-Check: PASSED

All fourteen created files and the SUMMARY exist on disk; all three task commits (`5d2fba5`, `57f36f1`, `a3431f6`) are in the git history.
