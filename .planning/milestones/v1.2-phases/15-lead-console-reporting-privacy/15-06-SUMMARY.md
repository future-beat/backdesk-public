---
phase: 15-lead-console-reporting-privacy
plan: 06
subsystem: reporting (generator, printed sheet, live client page, overview) / design-partner CSV export / 06:30 digest
status: complete
tags: [missed-call-report-block, frozen-report, partner-csv, blob-download, digest-overdue-line, rpt-04, rpt-05, con-05, d-03, d-04, d-09, d-10, d-11]
requires:
  - 15-02 (reportMissedCallsSchema / figures.missedCalls optional; computeMissedCallFigures; partnerCsv + PARTNER_CSV_HEADER; copy constants; export-state.ts leaf; stored-row fixture)
  - 15-03 (forTenant().metrics.missedCallCounts; forAllTenants_reportMetrics overview fields; listLatestReportFiguresForExport; countOverdueOpenLeads)
  - 15-04 (leadDeadlineTier, the TypeScript twin of countOverdueOpenLeads; GUARDED_PATHS / CLIENT_REACHABLE entries)
  - 15-05 (GUARDED_PATHS ownership; this entry sits below it)
provides:
  - "generateMonthlyReport freezes figures.missedCalls beside the eleven quote figures (same transaction, same period)"
  - "The printed sheet's optional Missed calls block (four figures + weekday table), rendered only when the row carries it"
  - "/reports/[client] live month-to-date Missed calls block (five MetricRows, footnote, weekday + hour tables) in its own tolerated arm"
  - "/reports seventh column Missed calls (count + after hours, or dash + no divert number)"
  - "exportDesignPartnerCsv server action + ExportCsvForm Blob-download island + the Design-partner export section"
  - "Digest Leads line: '{Client}: {n} open lead(s) past its/their next follow-up deadline — open the lead queue: {console}/leads', first per client"
affects:
  - 15-08 (CI gate: first run of the three new monthly-report DB cases; phone UAT for the column, the live block, the sheet, the export download on iOS Safari)
tech-stack:
  added: []
  patterns:
    - "Optional frozen block composed at the document boundary ({ ...figures, missedCalls }) so the pure figures module stays untouched and the comparator sees the block"
    - "Second live instrument read in its own try after the page's shared failure arm"
    - "Server action returns a CSV string; a 'use client' island turns it into a Blob download, effect keyed on the result object"
key-files:
  created:
    - src/app/(console)/reports/export-actions.ts
    - src/app/(console)/reports/export-csv-form.tsx
    - tests/export-csv-action.test.ts
    - tests/reports-missed-calls-page.test.ts
  modified:
    - src/core/reporting/generate.ts
    - src/app/(console)/reports/[client]/[reportId]/page.tsx
    - src/app/(console)/reports/[client]/page.tsx
    - src/app/(console)/reports/page.tsx
    - src/core/aging/stalled-digest.ts
    - tests/monthly-report.test.ts
    - tests/report-unchanged.test.ts (mock widened, additions only — see deviations)
    - tests/lead-digest-section.test.ts
    - tests/lint-ban.test.ts
    - tests/operator-authorization.test.ts
decisions:
  - "The live hour table has two columns (Hour, Calls), not three: the frozen block carries byHour totals only and no after-hours-by-hour array, and missed-call-figures.ts is a prohibited file. The after-hours split stays on the weekday table"
  - "exportDesignPartnerCsv declares no parameters: it reads neither the previous state nor the form data. useActionState still calls it with (state, formData), and an unused-param lint warning would otherwise fail --max-warnings=0"
  - "A names-read error fails the whole export with the fixed sentence, rather than writing a file where every client is 'Another client'. The 'Another client' fallback still covers a tenant the JWT cannot see"
  - "The island's download effect is keyed on the state object, not [state.csv, state.filename]: a same-day repeat press with nothing new frozen returns byte-identical strings, and an effect keyed on them would not re-run"
  - "The sheet's MissedCallsSheetBlock is declared BELOW the page component, because tests/layout-contract.test.ts reads the per-job table as the file's first <tbody>"
  - "The digest line's link is consoleBaseUrl() + '/leads', the same base the digest's queueUrl() is built from, and it is computed only when an overdue line renders"
metrics:
  duration: "~16 min"
  completed: 2026-10-13
  tasks: 3
  files: 14
estimate:
  tokens: 90000
actuals:
  tokens: 14700
  tasks: 3
  commits: 4
---

# Phase 15 Plan 06: Report figures, design-partner CSV and the digest overdue line Summary

The monthly report now freezes the missed-call block beside the eleven quote figures, and the printed sheet shows it only when the row carries one, so a report stored before Phase 15 renders exactly as before. The per-client page shows the same derivation live for the month to date, and the overview has a Missed calls column. The operator can export a design-partner CSV through a gated server action and a Blob-download island. The 06:30 digest opens each client's Leads lines with how many open leads are past their next follow-up deadline.

## What was built

### Task 1: the frozen block, the printed block, the live block and the column (887027c, 9ac851a)

- **`generate.ts`**
  - `repo.metrics.missedCallCounts(period, timezone)` runs directly after the four existing reads, on the transaction's repo.
  - The stored figures document is `asDocument({ ...figures, missedCalls: computeMissedCallFigures(missedCallCounts) })`. `figures.ts` and `unchanged.ts` are byte-identical to the phase base.
  - A comment records that `reportDocumentsUnchanged` sees the block, so the first regenerate of a pre-Phase-15 month is version N+1 and N is kept (D-03, Pitfall 6).
- **Sheet `[reportId]/page.tsx`**
  - `{figures.missedCalls === undefined ? null : <MissedCallsSheetBlock block={figures.missedCalls} />}` sits between the six-figure `dl` and the jobs table.
  - The block is an h2 `Missed calls`, then four `.report-figure`s:
    - Calls diverted, with `{a} after hours`.
    - Text sent back within, `{median} s`, with `P90 {p90} s · {d} delivered`. With no samples it shows `—` with `NO_SAMPLES_LABEL`.
    - Replied, with `of {d} delivered`.
    - Leads → jobs, with `{b} booked by you`.
  - Then a `table.report-lines` captioned `When calls came in — by weekday`: seven rows, Mon to Sun, with Day, Calls and After hours columns.
  - The page's only new value import is `NO_SAMPLES_LABEL` from `copy`, plus a type from `document`. It has no `computeMissedCallFigures` and none of `figures`, `fees`, `metrics` or `generate`. The note under the block comes from `methodologyNotes(row)` (15-02).
- **Live `[client]/page.tsx`**
  - `currentMonth(tenant.timezone, now)` feeds `missedCallCounts` and then `computeMissedCallFigures`. This runs in its own `try`, after the page's shared read arm, and its catch logs only `[reports] missed-call figures read failed`.
  - The h2 is `Missed calls {Month yyyy} to date`, followed by the hint. If the read fails, the block's `role="alert"` sentence shows instead.
  - Otherwise there are five `MetricRow`s with the UI-SPEC values and the four `MISSED_CALL_EVIDENCE` null sentences, then the `MISSED_CALL_LIVE_FOOTNOTE`.
  - When there are calls, two `.table-scroll` regions follow: by weekday (7 rows) and by hour (only hours with calls, labelled `7 am` / `6 pm` via `Intl` in the tenant zone). With no calls, `No diverted calls this month.` replaces them.
  - No chart, SVG or canvas.
- **Overview `reports/page.tsx`**: a seventh `th.num` `Missed calls` after `Multiple`. A client with no divert number shows `—` and `no divert number`. A client with one shows the count and `{a} after hours`, and `0` is a real zero.
- **Tests**
  - `tests/monthly-report.test.ts` gains a dated describe with its own tenant: three DB cases for CI, listed below.
  - `tests/reports-missed-calls-page.test.ts` is a new pure source pin.

### Task 2: the design-partner CSV (fc5be35)

- **`export-actions.ts`** (`'use server'`)
  - `requireOperator()` runs first. A denied caller gets `OPERATOR_DENIED_MESSAGE[access]` and nothing is read.
  - It then calls `listLatestReportFiguresForExport()`, reads names via `createClient().from('tenants').select('id, name')` (the operator's JWT), and builds the inputs. Each input has a name (falling back to `'Another client'`), `periodStart.slice(0, 7)`, and `reportFiguresSchema.parse(row.figures).missedCalls`.
  - The result goes through `partnerCsv(inputs)` and returns `{ csv, filename: backdesk-design-partner-stats-YYYY-MM-DD.csv, rows, error: null }`.
  - Any failure logs the fixed `[reports] export read failed` and returns `EXPORT_FAILED_MESSAGE`.
- **`export-csv-form.tsx`** (`'use client'`)
  - **Value imports: exactly `react`, `./export-actions`, `./export-state`** (pinned).
  - `useActionState` drives one accent button: `Export design-partner CSV`, or `Exporting…` (disabled) while pending.
  - The `role="status"` line is in the tree from first paint and stays empty until it has something to say. Errors show in a `role="alert"` line.
  - The effect builds the Blob, clicks a temporary `<a download>`, removes it and revokes the URL.
- **`/reports`**: `<section id="design-partner-export">` sits below the table with the h2, the `EXPORT_HINT` and the island. It renders with or without clients.
- **Pins**
  - `tests/export-csv-action.test.ts`, 8 cases:
    - A denied caller (both arms) triggers no read and no `createClient`, by call count.
    - The header line is byte-equal and the file has 3 lines, 2 rows, the filename pattern, and `Another client`.
    - A pre-block month exports empty cells.
    - An empty export is a header-only file with `rows === 0`.
    - A read throw leads to the fixed sentence with the value discarded.
    - A missing figures key fails the parse and produces no file.
    - A names-read error produces the failure sentence.
  - Structural pins sit in `reports-missed-calls-page.test.ts`.
  - `CLIENT_REACHABLE` gains the island and `GUARDED_PATHS` gains the action, both dated 2026-10-13.
- **GET route fallback: NOT built and not needed** (no `reports/csv/route.ts`; a pin asserts its absence). It is still subject to the 15-08 phone UAT.

### Task 3: the digest overdue line (829c1c2)

- `buildLeadsSection(cold, held, directory, now, resolutions = [], overdue = [])`.
- `Tally.overdue` skips non-integer and non-positive counts.
- The overdue line comes FIRST per client: `` `${name}: ${n} open lead${s} past ${its|their} next follow-up deadline — open the lead queue: ${consoleBaseUrl()}/leads` ``.
- `countOverdueOpenLeads(now)` is read in the one Leads `try`, after `countLeadResolutionsSince`. Its tenants join the directory-fallback check and it is passed as the sixth argument.
- No other line, section or rule changed. The section is null when every tally is zero, and the empty digest is still not sent.
- `tests/lead-digest-section.test.ts` (additions only against the phase base):
  - The ninth mocked read.
  - Six builder cases: first and plural with the link, singular, zero/negative/non-integer, all-empty null, overdue-only, unknown client.
  - Four wiring cases: called once with NOW, a throw costs only the paragraph, the name fallback, the empty digest unsent.
  - The test watched RED (7 failures) before the implementation.

## The three `monthly-report` DB cases written for CI (not run locally)

Dated describe `Phase 15 (2026-10): the missed-call block is frozen beside the quote figures (D-03)`, with its own tenant `Monthly Report P15`: connected in March, a monthly fee from 2026-07-01, no calls.

1. **Generate August.** The stored `figures` parses through `reportFiguresSchema` with `missedCalls` defined, `byHour` 24, `byIsoWeekday` 7, `captured` 0, `textBacks.medianSeconds === null`, and `afterHours.denominator === 0` / `rateBp === null`. The quote figures are intact.
2. **Generate August again.** The result is `unchanged` and the August versions are `[1]`, so the block survives the jsonb round trip and compares equal.
3. **A pre-Phase-15 July row** is inserted by the admin client at version 1, with figures holding only the eleven keys from `tests/fixtures/monthly-report-v1.json`. Generating July then produces `generated` v2, the July versions are `[2, 1]`, `parseReportDocument(v1).figures.missedCalls` is `undefined`, and v2's is defined.

## Local verification

All runs used the CI dummy pepper inline; no env file was named.

- **Task chains**
  - Task 1: 10 pure files, 435 tests. Typecheck, lint and `next build` green.
  - Task 2: 7 files, 403 tests. Typecheck, lint and build green, and every grep clause passed.
  - Task 3: 4 files, 97 tests. Typecheck and lint green, and every grep and `git diff --quiet` clause passed.
- **Plan-level run, 24 pure suites, 727 passed.** The suites: `console-error-leak`, `export-csv-action`, `layout-contract`, `lead-digest-section`, `leads-page`, `missed-call-cursor`, `missed-call-figures`, `missed-calls-section`, `opt-out-section`, `partner-csv`, `report-frozen-fixture`, `reporting-copy`, `reporting-fees`, `reporting-figures`, `reporting-metrics`, `reporting-period`, `reports-authorization`, `reports-missed-calls-page`, `stalled-drafts`, `report-unchanged`, `report-list`, `lint-ban`, `operator-authorization`, `queue-lead-rows`. Then typecheck, lint and `next build` were green.
- **Byte-identical to the phase base:** `figures.ts`, `unchanged.ts`, `tests/reporting-figures.test.ts`, `tests/reporting-copy.test.ts`, `tests/cron-schedules.test.ts`, `tests/sync-upsert.test.ts`, `tests/stalled-drafts.test.ts`, `src/core/alerts/stalled-drafts.ts`, `scripts/apply-cron-schedules.mjs`. 15-06 did not touch `document.ts`, `missed-call-figures.ts` or `partner-csv.ts`.
- `stall-tick.test.ts` was briefly included in a local list; it refused at its env guard (DB suite) and no database was contacted. No `test:remote`, no `db:migrate`, no push.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `tests/report-unchanged.test.ts` mock widened (the pin is no longer byte-identical)**
- **Found during:** Task 1 verify.
- **Issue:** The plan requires the generator to read `repo.metrics.missedCallCounts` inside its transaction. It also lists `tests/report-unchanged.test.ts` both in Task 1's local chain and in its `git diff --quiet` byte-identical clause. That suite's mocked transaction repo has no `metrics` key, so the three generate cases threw `TypeError: Cannot read properties of undefined (reading 'missedCallCounts')`. The two requirements cannot both hold.
- **Fix:** I added one `metrics: { missedCallCounts }` entry to the mock's `txRepo()`, returning the all-zero, dense-bucket counts. It is dated and commented, adds 22 lines and removes 0. No assertion changed, and the comparator and generate cases pass unchanged.
- **Consequence:** the `git diff --quiet <base> -- tests/report-unchanged.test.ts` sub-clause fails. Every other path in that clause passes.
- **Commit:** 887027c

**2. [Rule 1 - Bug] The island's download effect is keyed on the state object**
- **Issue:** The plan's `[state.csv, state.filename]` dependency array does not re-run when a second same-day press returns identical strings. The operator would press and get no file.
- **Fix:** The effect uses `[state]`; every completed action is a new object.
- **Commit:** fc5be35

**3. [Rule 3 - Blocking] `exportDesignPartnerCsv` declares no parameters**
- **Issue:** The plan's `(_previous, _formData)` triggered two `no-unused-vars` warnings, and lint runs with `--max-warnings=0`.
- **Fix:** No parameters, with a comment explaining why. It stays assignable to `useActionState`, and typecheck and build are green.
- **Commit:** fc5be35

**4. [Rule 2 - Correctness] A names-read error fails the export**
- **Issue:** As written, the plan would silently write every client as `Another client` if the RLS names read errored.
- **Fix:** That case throws, takes the fixed failure sentence, and is pinned. The `Another client` fallback still applies to a tenant the JWT cannot see.
- **Commit:** fc5be35

**5. [Rule 1 - Pin collision] The sheet block is declared below the page component**
- **Found during:** the plan-level run. `tests/layout-contract.test.ts` slices the sheet source's FIRST `<tbody>` as the per-job table, and the new weekday table had become first.
- **Fix:** I moved the `MissedCallsSheetBlock` declaration to the end of the file. Render order is unchanged and the pin is untouched.
- **Commit:** 9ac851a

### Spec gap, recorded (no code fix possible within the plan's prohibitions)

- **The live hour table has no After hours column.** UI-SPEC §3b lists `Hour · Calls · After hours` for the hour table, but the frozen block (15-02, `missed-call-figures.ts`, a prohibited file) carries `byHour` totals only. There is no after-hours-by-hour array. The hour table shows Hour and Calls, and the after-hours split stays on the weekday table. Adding it would need a new block field, which means a schema and document change, a migration-free but version-bumping figures change, and a 15-02/15-03 revisit. That is out of scope.

### TDD note

- Task 1 (`tdd="true"`): the behaviour suites were written in the same pass as the implementation, not run RED first. Task 3 was run RED (7 failures) before the implementation. Each task was committed once as `feat(...)`, following the 15-01/15-02 precedent for `tdd="true"` tasks in an execute-type plan.

## Hazards for 15-08's CI gate

- **First Postgres run of the generator's new read.** `generateMonthlyReport` now runs `missedCallCounts`' six statements inside the report transaction. Every existing `monthly-report` case and the 15-03 `report-missed-calls` SQL now execute together on one connection. If `monthly-report` reds on an existing case, check `missedCallCounts` first, starting with the `AT TIME ZONE $tz::text` grouping.
- **Version-jump expectations.** Existing `monthly-report` cases generate fresh months, so both presses carry the block and `unchanged` still holds. The new case 3 is the only one that writes a pre-block row. It inserts `monthly_reports` through the admin client, with no `generated_at` (the default applies).
- **The digest DB suites now run the real `countOverdueOpenLeads`.** These are `stall-tick` and `onboarding-checklist-gate`. A leftover open lead with an overdue touch from another suite would add a Leads line to their digests. Their assertions are `toContain` or use `sections: []`, so this should not red. If it does, a suite is leaking open leads.
- **Phone UAT (15-08):**
  - The Missed calls column (`—` / `no divert number` vs `0` / `0 after hours`).
  - The live block, with `no samples` under Text-back speed for the test tenant.
  - A pre-Phase-15 stored report opens with no block.
  - Generate for the current month gives a new version with the block, and pressing Generate again says unchanged.
  - **Export on iOS Safari:** confirm the file downloads. If it does not, the GET route at `reports/csv/route.ts` is the documented fallback (research OQ2). It is not built.
- **Pepper:** the suites that build the server env still need `CALLER_PSEUDONYM_PEPPER`. Here that is `lead-digest-section`, through `consoleBaseUrl()`. CI has the dummy; the local env still needs the founder's value.

## Known Stubs

None. Every surface reads real data: the generator, the live block and the column through the 15-03 reads; the export through the frozen rows; the digest through `countOverdueOpenLeads`.

## Threat Flags

None beyond the plan's threat model. The CSV string carries only client names and frozen counts (T-15-09). The action is gated before any read and listed in `GUARDED_PATHS` (T-15-03). The digest line carries a name, an integer, fixed words and the console URL (T-15-13). An old frozen row renders unchanged (T-15-11). A regenerate keeps N (T-15-12, DB case 3).

## Self-Check: PASSED

- Created files exist: `src/app/(console)/reports/export-actions.ts`, `src/app/(console)/reports/export-csv-form.tsx`, `tests/export-csv-action.test.ts`, `tests/reports-missed-calls-page.test.ts`.
- Commits exist: 887027c, fc5be35, 829c1c2, 9ac851a.
