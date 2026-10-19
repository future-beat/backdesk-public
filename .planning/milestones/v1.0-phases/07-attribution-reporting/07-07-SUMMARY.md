---
phase: 07-attribution-reporting
plan: 07
subsystem: ui
tags: [react, nextjs, css-layout, print, webkit, table-scroll, vitest, headless-chrome]

requires:
  - phase: 07-attribution-reporting (07-04)
    provides: the report page, `print-button.tsx`, `report.css` and the `.report-actions` print-hidden list
  - phase: 07-attribution-reporting (07-06)
    provides: `tests/layout-contract.test.ts` (the `rule()`/`uncommented()` machinery), the `07-06-harness/` scaffold, the nav wrap
  - phase: 02-servicem8-sync-quote-leakage-audit (02-05)
    provides: `.table-scroll` itself (8de755c) — the wrapper this plan finally applies to the four tables that cited it without having it
provides:
  - Every `<table>` under `src/app/(console)` sits inside `.table-scroll`; `/`, `/clients/[id]`, `/audits` and `/audits/[id]/mapping` are exactly viewport-wide at 390px
  - A source gate that fails `npm test` on the next bare console table, anywhere, with no per-page allowlist
  - A print button that acknowledges the press, treats `beforeprint` as the only success signal, names the manual route after 1.5s of silence and never goes out of service — as a pure reducer under test
  - `followUpRange` in `@/core/reporting/copy` with the same-day collapse (`2 · 1 Aug`, never `2 · 1–1 Aug`)
  - Two UI-SPECs, one source comment and the harness README corrected to name the quotes table (02-05, 8de755c) as the origin of `.table-scroll`
affects: [any future console page that renders a table, any future change to the report print path, /gsd-verify-work reconciliation of G-07-6 and G-07-4]

actuals:
  tokens: 73026
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Source-level layout gate: walk a route group recursively, strip comments, assert two counts are equal — no allowlist, so the next offender is caught the day it is written"
    - "Browser behaviour that cannot be asserted in the pure suite is split into a pure reducer (the transition table) plus a thin island (the listeners); the reducer is tested, the island is source-pinned"

key-files:
  created:
    - src/app/(console)/reports/[client]/[reportId]/print-feedback.ts
    - tests/print-feedback.test.ts
  modified:
    - src/app/(console)/page.tsx
    - src/app/(console)/clients/[id]/page.tsx
    - src/app/(console)/audits/page.tsx
    - src/app/(console)/audits/[id]/mapping/mapping-form.tsx
    - src/app/(console)/reports/[client]/[reportId]/print-button.tsx
    - src/app/(console)/reports/[client]/[reportId]/page.tsx
    - src/app/(console)/reports/page.tsx
    - src/core/reporting/copy.ts
    - tests/layout-contract.test.ts
    - tests/lint-ban.test.ts
    - tests/reporting-copy.test.ts
    - .planning/phases/07-attribution-reporting/07-UI-SPEC.md
    - .planning/phases/06-review-console-escalation/06-UI-SPEC.md
    - .planning/phases/07-attribution-reporting/07-06-harness/README.md

key-decisions:
  - "The wrapper is the fix, not CSS: `globals.css` is byte-untouched (still 6ed9105). `overflow-x: hidden` on `main`/`.shell` would clip the Status column unreachably and `table-layout: fixed` wraps uppercase headers mid-word — both were considered and rejected in the debug session, and neither was needed."
  - "The layout gate walks the route group rather than listing pages: the defect it exists to prevent is a table nobody has written yet, which an allowlist of today's pages cannot catch."
  - "`beforeprint` is the success signal, not the click. A press proves nothing on WebKit, so the reducer treats the dialog opening — and only that — as evidence the press landed."
  - "The button is never taken out of service and the timeout transition fires only from `opening`: a second press after the fallback hint is a fresh attempt, and a stale timer can never put the hint back under an already-open print sheet."
  - "The same-day collapse also folds two degraded ends together (`2 · —` rather than `2 · —–—`) but leaves one degraded end in the long form — the honest reading is that one date is unavailable, not that the two match."

patterns-established:
  - "Count-equality source gates: `count(<table) === count(<div className=\"table-scroll\"><table)` per file, with a `expect(seen).toBeGreaterThan(0)` guard so a wrong path cannot pass vacuously (the WR-06 lesson applied to a new gate)"
  - "`uncommentedTsx()` is now the shared `.tsx` comment stripper in the layout suite, mirroring `gen-tables.mjs`'s stripping order (JSX comment first, then block, then whole-line)"
  - "A browser-behaviour island keeps its transition table in an import-free sibling leaf, pinned in `CLIENT_REACHABLE`, so the behaviour is testable without jsdom and the island's import set stays provably narrow"

requirements-completed: [RPT-02, RPT-03]

coverage:
  - id: D1
    description: "Every `<table>` under `src/app/(console)` is inside `.table-scroll`; `/`, `/clients/[id]`, `/audits` and `/audits/[id]/mapping` are exactly 390px wide at a 390px viewport and the wrapper is inert at 1000px"
    requirement: RPT-03
    verification:
      - kind: unit
        ref: "tests/layout-contract.test.ts#wraps every <table> under src/app/(console) in .table-scroll — a bare table widens a 390px phone"
        status: pass
      - kind: automated_ui
        ref: "bash .planning/phases/07-attribution-reporting/07-06-harness/tables-check.sh (headless Chrome, 390px + 1000px, RESULT: PASS)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A bare `<table>` anywhere under `src/app/(console)` fails `npm test` — the gate that would have caught this at 06-02"
    requirement: RPT-03
    verification:
      - kind: unit
        ref: "tests/layout-contract.test.ts#wraps every <table> under src/app/(console) in .table-scroll — a bare table widens a 390px phone (observed RED on the four unwrapped files before the fix, GREEN after)"
        status: pass
      - kind: unit
        ref: "tests/layout-contract.test.ts#keeps .table-scroll the overflow-containing box"
        status: pass
    human_judgment: false
  - id: D3
    description: "The printed Follow-ups cell collapses a same-day range to `2 · 1 Aug`; multi-day and cross-month ranges are unchanged; frozen `monthly_reports` rows are untouched"
    requirement: RPT-02
    verification:
      - kind: unit
        ref: "tests/reporting-copy.test.ts#collapses a same-day range to the day — a range from a day to itself is a date"
        status: pass
      - kind: unit
        ref: "tests/reporting-copy.test.ts#drops the repeated month when both touches share one"
        status: pass
      - kind: unit
        ref: "tests/reporting-copy.test.ts#keeps both months when the cadence crosses one"
        status: pass
    human_judgment: false
  - id: D4
    description: "The print button's feedback behaviour: a press always acknowledges, the dialog clears it, a stale timer is ignored, the button never goes out of service, and the copy is byte-verbatim"
    requirement: RPT-02
    verification:
      - kind: unit
        ref: "tests/print-feedback.test.ts#the print button’s transition table (G-07-4) — 12 transition cases + two sequences"
        status: pass
      - kind: unit
        ref: "tests/print-feedback.test.ts#names BOTH manual routes byte for byte — the operator follows it exactly"
        status: pass
      - kind: unit
        ref: "tests/print-feedback.test.ts#the island that drives it (import set, beforeprint/afterprint listeners, clearTimeout, status role, .report-actions still hidden in print)"
        status: pass
    human_judgment: false
  - id: D5
    description: "On the operator's iPhone, a press of `Print or save as PDF` produces either the print sheet or `Opening print…` followed within ~2s by the fallback hint; the saved PDF contains neither string; a second tap still works"
    requirement: RPT-02
    verification: []
    human_judgment: true
    rationale: "The defect is a WebKit timing behaviour on a real device under a real network — the diagnosis found no code defect and could not reproduce it in any harness. Only the operator's phone can show whether the acknowledgement appears and whether the sheet arrives by itself. Deferred to end-of-phase per `human_verify_mode: end-of-phase`."
  - id: D6
    description: "On the operator's phone at 390px, `/` after login does not scroll sideways, the Clients table scrolls inside its own box with Status reachable, and `Sign out` stays reachable"
    requirement: RPT-03
    verification:
      - kind: automated_ui
        ref: "07-06-harness/tables-check.sh — clients @390 docScrollWidth 390, navRight 370; control-bare still 620"
        status: pass
    human_judgment: true
    rationale: "The harness measures a hand-mirrored fixture over the real globals.css, not the deployed React render. The UAT finding was reported from the operator's phone and should be closed from the same place. Deferred to end-of-phase."

duration: 21min
completed: 2026-09-04
status: complete
---

# Phase 7 Plan 07: Table wrappers, print acknowledgement and corrected contracts Summary

**The Clients table stopped widening a 390px phone — and the gate that should have caught it in 06-02 now fails on the next bare console table anywhere; the print button admits it was pressed; a same-day Follow-ups range prints as a date.**

## Performance

- **Duration:** 21 min
- **Started:** 2026-09-04T00:24:00Z (approx — first gate run 00:26:51)
- **Completed:** 2026-09-04T00:45:00Z
- **Tasks:** 3 of 3
- **Files modified:** 16 (2 created, 14 modified)

## Accomplishments

- **G-07-6 fixed.** Four bare console tables — Clients (`page.tsx`), sync runs (`clients/[id]/page.tsx`), the audits list (`audits/page.tsx`) and the mapping table (`mapping-form.tsx`) — are now inside `<div className="table-scroll">`. All nine console tables are wrapped. Measured: every page exactly 390px wide at a 390px viewport, inert at 1000px. **No CSS changed** — `globals.css` is still at `6ed9105`.
- **The missing gate exists.** `tests/layout-contract.test.ts` gained `every console table scrolls inside its own box (G-07-6)`: a recursive walk of `src/app/(console)/**/*.tsx` with comments stripped, requiring `count(<table)` to equal `count(<div className="table-scroll"><table)` per file. It went RED on exactly the four predicted files before any markup changed, and it has no allowlist — the next bare table fails `npm test` the day it is written.
- **G-07-4 hardened.** The press is acknowledged (`Opening print…`), `beforeprint`/`afterprint` clear it, 1.5s of silence names the manual route, and the button never goes out of service. The behaviour is a pure reducer in a new import-free leaf (`print-feedback.ts`), so all twelve transitions and both event sequences are asserted without a browser. The version link beside the button no longer prefetches — an in-flight prefetch is the exact state in which WebKit defers `window.print()`.
- **The same-day range collapses.** `followUpRange` moved from the report page to `@/core/reporting/copy` and now returns `2 · 1 Aug` where the UAT PDF printed `2 · 1–1 Aug`. Render-time formatting only — no frozen `monthly_reports` row is read or written differently.
- **The false precedent is gone.** 06-UI-SPEC:182, 07-UI-SPEC :219/:242/:299/:319, the `reports/page.tsx` comment and the harness README now name the quotes table (02-05, `8de755c`) as the origin of `.table-scroll`, each correction dated and tagged `[Contract correction 07-07, 2026-09-03, G-07-x]`, plus a `### Contract corrections (07-07, 2026-09-03)` subsection.

## Task Commits

Each task was committed atomically:

1. **Task 1 (tracer): wrap the four tables, pin the gate, prove it (G-07-6)** — `43d245f` (fix)
2. **Task 2: the print button acknowledges the press and falls back (G-07-4)** — `c7b45ff` (fix)
3. **Task 3: same-day Follow-ups range + the corrected contracts** — `271107e` (fix)

**Plan metadata:** see the `docs(07-07)` commit carrying this SUMMARY.

## The G-07-6 proof, pasted

**Before any markup changed** (step 0 of Task 1, the plan's RED requirement) — `bash .planning/phases/07-attribution-reporting/07-06-harness/tables-check.sh`:

```
== 390px: every console table scrolls inside its own box; the document never widens ==
        clients: {"viewport":390,"docScrollWidth":620,"wrapperInSource":false,"tableParent":"<section> overflow-x:visible","tableWidth":599.6,"tableMinContent":599.6,"tableFits":false,"mainContentBox":350,"navRight":370}
  FAIL  clients @390: <table> has no .table-scroll wrapper in the shipped .tsx
  FAIL  clients @390: document scrolls to 620px (table min-content 599.6px in a 350px column)
        runs: {"viewport":390,"docScrollWidth":437,...,"tableMinContent":417.1,...}
  FAIL  runs @390: <table> has no .table-scroll wrapper in the shipped .tsx
  FAIL  runs @390: document scrolls to 437px (table min-content 417.1px in a 350px column)
        audits: {"viewport":390,"docScrollWidth":464,...,"tableMinContent":444,...}
  FAIL  audits @390: <table> has no .table-scroll wrapper in the shipped .tsx
  FAIL  audits @390: document scrolls to 464px (table min-content 444px in a 350px column)
        mapping: {"viewport":390,"docScrollWidth":408,...,"tableMinContent":388.2,...}
  FAIL  mapping @390: <table> has no .table-scroll wrapper in the shipped .tsx
  FAIL  mapping @390: document scrolls to 408px (table min-content 388.2px in a 350px column)
  PASS  reports @390: document is exactly viewport-wide (no sideways page scroll)
  PASS  control-bare @390: an unwrapped seven-column table widens the document to 620px — the probe sees it
RESULT: FAIL
```

Measured widths match the planner's numbers exactly (620 / 437 / 464 / 408). The pure gate went RED at the same moment, naming the same four files and nothing else:

```
AssertionError: expected [ …(4) ] to deeply equal []
+ [
+   "src/app/(console)/audits/[id]/mapping/mapping-form.tsx: 2 table(s), 1 wrapped",
+   "src/app/(console)/audits/page.tsx: 1 table(s), 0 wrapped",
+   "src/app/(console)/clients/[id]/page.tsx: 1 table(s), 0 wrapped",
+   "src/app/(console)/page.tsx: 1 table(s), 0 wrapped",
+ ]
```

**After the four wraps** — the same command, unchanged:

```
== 390px: every console table scrolls inside its own box; the document never widens ==
        clients: {"viewport":390,"docScrollWidth":390,"wrapperInSource":true,"tableParent":"<div class=\"table-scroll\"> overflow-x:auto","tableWidth":599.6,"tableMinContent":599.6,"tableFits":false,"mainContentBox":350,"navRight":370}
  PASS  clients @390: <table> is inside .table-scroll in the shipped .tsx
  PASS  clients @390: document is exactly viewport-wide (no sideways page scroll)
  PASS  clients @390: every nav item is inside the viewport
  PASS  runs @390    (docScrollWidth 390, wrapperInSource true)
  PASS  audits @390  (docScrollWidth 390, wrapperInSource true)
  PASS  mapping @390 (docScrollWidth 390, wrapperInSource true)
  PASS  reports @390 (docScrollWidth 390, wrapperInSource true)
== 390px: the probe can see an overflow at all (Clients table bare, by construction) ==
  PASS  control-bare @390: an unwrapped seven-column table widens the document to 620px — the probe sees it
== 1000px: the wrapper is inert on desktop (natural width, no scrollbar) ==
  PASS  clients @1000: document is exactly viewport-wide
  PASS  clients @1000: table fits its box (no scrollbar on desktop)   [tableWidth 920, minContent 599.6]
  PASS  runs / audits / mapping / reports @1000: viewport-wide, table fits its box
RESULT: PASS
```

`control-bare` still widens to 620px after the fix, which is the point: the probe is demonstrably not blind, so the PASSes above are evidence rather than a probe that cannot fail.

## Suite state

`npm test` after each task, and after all three:

```
Test Files  39 failed | 72 passed (111)
     Tests  2402 passed (2402)
```

**0 assertion failures.** All 39 "failed" files are the remote-gated integration suites refusing with `Refusing to run integration tests against a non-local Supabase stack` — the recorded baseline, and exactly what must happen: the hosted Supabase is production and shares the Sydney database with live deployed cron ticks. `npm run test:remote` was never run and `ALLOW_REMOTE_TESTS` was never set. The database was not touched at any point in this plan.

Suite counts moved 2371 → 2398 → 2402 across the three tasks (2 layout-contract tests, 25 print-feedback tests + 2 lint-ban entries, 4 reporting-copy tests). `npx tsc --noEmit`, `npm run lint` and `npm run build` exited 0 after every task.

## Gap status

- **G-07-6 (failed, major) — FIXED.** Four one-element wraps + a source gate with no allowlist + a headless-Chrome harness that reads the wrapper from the shipped `.tsx` and measures 390/1000px. `globals.css` untouched (`6ed9105`). **Phone check pending end of phase** (D6): sign in at 390px, confirm `document.documentElement.scrollWidth === 390` on `/`, the Clients table scrolls inside its box with Status reachable and `Sign out` still reachable; then `/clients/[id]`, `/audits`, the mapping step; then past ~1000px for the inert case.
- **G-07-4 (withdrawn, kept for the record) — HARDENED.** Acknowledgement + 1.5s fallback + prefetch off + the false header claim replaced. No code defect was ever found; this is the hardening that is correct under every candidate cause the diagnosis ranked. **iPhone press check pending end of phase** (D5): a settled-page tap, then an immediate tap on reload, then confirm the saved PDF contains neither `Opening print…` nor `Nothing opened?`.
- **Cosmetic (Test 4 PDF) — FIXED.** `2 · 1–1 Aug` now prints `2 · 1 Aug`. Under test in the pure copy suite; frozen rows untouched.

## Files Created/Modified

**Created**

- `src/app/(console)/reports/[client]/[reportId]/print-feedback.ts` — the import-free leaf: `PrintFeedback`, `PrintFeedbackEvent`, `nextPrintFeedback`, `printFeedbackMessage`, `PRINT_FALLBACK_AFTER_MS = 1500`, `PRINT_OPENING_MESSAGE`, `PRINT_FALLBACK_MESSAGE`.
- `tests/print-feedback.test.ts` — 12 transition cases, two event sequences, byte-verbatim copy, the 1500ms constant, and source pins on the island's import set, its two listeners, its `clearTimeout`, its status role, its never-out-of-service button, and `.report-actions` still being in the print block's hidden selector list.

**Modified**

- `src/app/(console)/page.tsx`, `clients/[id]/page.tsx`, `audits/page.tsx`, `audits/[id]/mapping/mapping-form.tsx` — one `.table-scroll` wrapper each, with a comment recording the measured width and the real precedent. The mapping file's preview table (already wrapped) is untouched.
- `src/app/(console)/reports/[client]/[reportId]/print-button.tsx` — rewritten: state, timer, listeners, status line, header comment.
- `src/app/(console)/reports/[client]/[reportId]/page.tsx` — `followUpRange` deleted and imported from `@/core/reporting/copy`; prefetch off on the version link. The call site is byte-identical, so the layout-contract pin on `className="report-softwrap">{followUpRange(` still holds.
- `src/core/reporting/copy.ts` — `followUpRange` with the same-day collapse, immediately after `shortDate`.
- `tests/layout-contract.test.ts` — `uncommentedTsx()` and `consoleTsxFiles()` helpers, the third describe (2 tests).
- `tests/lint-ban.test.ts` — `print-feedback.ts` added to `CLIENT_REACHABLE`; the print-button entry reworded.
- `tests/reporting-copy.test.ts` — `the Follow-ups cell (the printed range)`, 4 tests / 7 cases.
- `07-UI-SPEC.md`, `06-UI-SPEC.md`, `reports/page.tsx` comment, `07-06-harness/README.md` — the contract corrections.

## Decisions Made

See `key-decisions` in the frontmatter. The load-bearing one: **the wrapper is the fix, and the CSS is correct as it stands.** `.table-scroll { overflow-x: auto }` at `globals.css:319` needed no change; the two alternatives the debug session weighed (`overflow-x: hidden` on `main`/`.shell`, `table-layout: fixed`) each trade a sideways page scroll for a worse defect — an unreachable Status column, or uppercase headers broken mid-word.

## Deviations from Plan

**1. [Formatting] The four table wraps reindent their table blocks rather than adding a handful of lines**

- **Found during:** Task 1
- **Issue:** The plan's action says `git diff --stat` for each wrapped file "must be a handful of added lines". Adding a wrapper `<div>` without reindenting the table it contains would leave a 25–77 line JSX block at the wrong depth, which every other table in the codebase (including the `reports/page.tsx` example this plan cites as the shape to copy) does not do.
- **Fix:** Reindented each wrapped block by two spaces, so the diffs are larger than the plan anticipated (`page.tsx` 162 lines touched, `mapping-form.tsx` 97, `audits/page.tsx` 73, `clients/[id]/page.tsx` 53) while the semantic change is still one wrapper plus one comment per file.
- **Verification:** No linter enforces indentation here (`eslint` only, no Prettier), so this is a readability choice, not a tooling requirement. Every acceptance criterion the plan states — the perl comment-strip wrapper/table counts, the harness, tsc/lint/build — passes. Reviewing with `git diff -w` shows the true change per file.
- **Committed in:** `43d245f`

**2. [Rule 1 - Bug] Two acceptance greps counted my own comments**

- **Found during:** Task 2
- **Issue:** First pass had `grep -c 'role="status"' print-button.tsx` = 2 and `grep -c 'prefetch={false}' page.tsx` = 2 against acceptance criteria of exactly 1 — both because an explanatory comment repeated the literal it was explaining. The criteria are deliberately exact-count (one attribute, one link), so the extra match is a real ambiguity in the gate, not a false alarm.
- **Fix:** Reworded both comments to describe the attribute rather than quote it ("a status role"; "Prefetch off").
- **Verification:** Both greps now return 1; the suites, tsc, lint and build re-run green.
- **Committed in:** `c7b45ff`

---

**Total deviations:** 2 (1 formatting judgment, 1 Rule 1 fix). **Impact:** none on behaviour or scope. No architectural change, no new dependency, no CSS change, no schema or migration.

## Issues Encountered

None. The plan's planner-verified facts held exactly: the gate went RED on the four predicted files, the harness measured the four predicted widths, `followUpRange`'s call site needed no change, and the `monthly-report.test.ts` import-set pin (remote-gated, so not executed here) is unaffected because `@/core/reporting/copy` was already in the page's import set.

## Known Stubs

None. Nothing added in this plan renders a placeholder, and no test was skipped or left unrun. The two `human_judgment: true` coverage entries (D5, D6) are deferred human checks, not stubs — the code paths behind them are complete and their automated halves pass.

## Threat Flags

None. No trust boundary moved: every edit is markup, a pure formatter, a client island reacting to its own button and two window print events, a prefetch flag, pure tests, or planning documents. No server action, route handler, query, RLS policy, auth path, env var or dependency changed. The report page still renders only from the frozen `monthly_reports` row behind `authorize(tenantId)`. The status line renders one of two fixed strings from an import-free module and is inside `.report-actions`, which the print block hides outright — pinned by `tests/print-feedback.test.ts`, so nothing new can reach paper.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

The two Phase 7 UAT findings are closed in code and in the contracts that mis-described them. What remains is the deployed human confirmation of both (D5, D6) plus the Follow-ups cell (part of D3's human-facing side), all queued for `/gsd-verify-work`, which reconciles G-07-6 and G-07-4 from this SUMMARY via `gap_ids`. `07-VERIFICATION.md` and `07-UAT.md` were deliberately not edited. `WINDOWS.md` was not touched — nothing here is accepted debt.

---
*Phase: 07-attribution-reporting*
*Completed: 2026-09-04*

## Self-Check: PASSED

All created files exist on disk (`print-feedback.ts`, `tests/print-feedback.test.ts`, this SUMMARY) and all three task commits (`43d245f`, `c7b45ff`, `271107e`) are present in git history.
