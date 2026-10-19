---
phase: 07-attribution-reporting
plan: 06
subsystem: ui
tags: [css, print, webkit, chromium, pagination, responsive, a11y, tap-target, vitest]

# Dependency graph
requires:
  - phase: 07-04
    provides: the printed report page, `report.css` and the per-job table this plan repaginates
  - phase: 07-05
    provides: the seventh nav link that pushed the console bar past a 390px phone
provides:
  - "A printed monthly report whose every job row is one line box in both print engines — no row can straddle a page fold"
  - "No trailing blank page in WebKit: the `<p>` footer's UA bottom margin is reset in both report.css and audit.css"
  - "A WebKit-only print `zoom: 0.75` that gives iOS Safari Chromium's sheet width (496px → 661px)"
  - "Column headers repeated on Chromium continuation pages via `thead { break-inside: avoid }`"
  - "A console bar that wraps at 390px, keeping the document exactly viewport-wide, with a 44px `Sign out` tap box"
  - "tests/layout-contract.test.ts — a pure source-assertion suite pinning all eight rules on every `npm test`"
  - "Two engine limitations recorded as accepted debt in WINDOWS.md, with their reasons"
affects: [ui-spec, printing, console-nav, phase-08]

actuals:
  tokens: 12355
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "One-line-box print rows: rows are kept whole structurally (nowrap + .cell-truncate + named softwrap valves), never by `break-inside: avoid` on a `tr`"
    - "Engine-gated print rules via `@supports (font: -apple-system-body)` — a WebKit-only value, inert in Chromium"
    - "Pure source-assertion suites for CSS contracts: read the stylesheet, strip comments, assert the rule"

key-files:
  created:
    - tests/layout-contract.test.ts
  modified:
    - src/app/(console)/reports/[client]/[reportId]/report.css
    - src/app/(console)/reports/[client]/[reportId]/page.tsx
    - src/app/(console)/audits/[id]/audit.css
    - src/app/globals.css
    - .planning/phases/07-attribution-reporting/07-UI-SPEC.md
    - .planning/phases/07-attribution-reporting/07-04-PLAN.md
    - .planning/phases/07-attribution-reporting/07-05-PLAN.md
    - .planning/WINDOWS.md

key-decisions:
  - "WebKit's refusal to repeat table header groups is accepted engine debt, recorded in WINDOWS.md — the 'header on every continuation page' truth holds on desktop Chrome only, and is never claimed as fixed for iPhone Safari"
  - "Printed rows are guaranteed unsplittable by being one line box, not by `break-inside: avoid` on a row — Chromium never honoured that property on a `tr` and WebKit split one with the rule present"
  - "Customer and Follow-ups are the named pressure valves (`.report-softwrap`): under width pressure a long name costs a two-line row rather than a Conservative column clipped off the sheet"
  - "The `@supports (font: -apple-system-body) { html { zoom: 0.75 } }` block is the one speculative rule; the recorded fallback is deleting that block only, which degrades to wrapped two-line rows (the accepted-debt state), never to a broken sheet"
  - "`.nav button.linkish` carries the 44px minimum rather than the generic `button.linkish`, which is used in prose where 44px would open gaps; a -0.625rem vertical margin keeps the bar's height at 55px"

patterns-established:
  - "Print-engine facts belong in the CSS comment: 96px/in vs 1px = 1pt is why a rule exists, and the UI-SPEC now carries it too"
  - "Contract corrections are tagged in place (`[Contract correction 07-06, 2026-09-03, G-07-x]`) so a wrong rule cannot be re-specified from the contract it was read out of"

requirements-completed: [RPT-02, RPT-03]

coverage:
  - id: D1
    description: "G-07-1 — the printed monthly report has no trailing blank page: `.report-footer`'s UA `<p>` bottom margin is reset, and `.audit-footer` closes the same latent defect"
    requirement: RPT-02
    verification:
      - kind: unit
        ref: "tests/layout-contract.test.ts#resets the footer bottom margin so no zero-ink height trails the last page"
        status: pass
      - kind: automated_ui
        ref: "bash .planning/phases/07-attribution-reporting/07-06-harness/run.sh (section A: trailingGap -0.27 at 661px and 688px; sections B/C: last page carries text)"
        status: pass
    human_judgment: true
    rationale: "The harness WKWebView leg sits at ~0.87 of the iPhone's absolute scale — direction evidence only. The acceptance is the operator's own iPhone Safari print of the deployed fixture report, queued as an end-of-phase human check."
  - id: D2
    description: "G-07-2 — every printed job row is ONE line box in both engines, `#4201 · description` is separated, and Chromium repeats the column header on continuation pages"
    requirement: RPT-02
    verification:
      - kind: unit
        ref: "tests/layout-contract.test.ts#drives every job cell to one line box in print and names the two pressure valves"
        status: pass
      - kind: unit
        ref: "tests/layout-contract.test.ts#renders the Job cell as one clipped line with a literal separator"
        status: pass
      - kind: unit
        ref: "tests/layout-contract.test.ts#puts break-inside: avoid on the thead — the box Chromium actually repeats"
        status: pass
      - kind: unit
        ref: "tests/layout-contract.test.ts#does not claim a row break rule it cannot have — rows are whole by being one line"
        status: pass
      - kind: automated_ui
        ref: "bash .planning/phases/07-attribution-reporting/07-06-harness/run.sh (section A: wrappedRows 0, tableFits true at 661/688px; section B: header on 1 of 1 continuation page; section C: WebKit 26 + 14 one-line rows, no fragment)"
        status: pass
    human_judgment: true
    rationale: "Row-fold behaviour and header repetition are engine behaviours; the WKWebView harness reproduces but does not equal iPhone Safari. The operator's iPhone print plus a desktop Chrome print of the deployed 20-line August 2026 fixture is the acceptance."
  - id: D3
    description: "G-07-2 (debt) — WebKit does not repeat the table header on continuation pages; recorded in WINDOWS.md and in the UI-SPEC, never claimed as fixed"
    requirement: RPT-02
    verification:
      - kind: automated_ui
        ref: "bash .planning/phases/07-attribution-reporting/07-06-harness/run.sh (section C INFO: header repeated on 0 of 1 continuation pages — expected, not asserted)"
        status: pass
      - kind: other
        ref: "grep -c 'G-07-2 (07-06)' .planning/WINDOWS.md (entries 26 unmet-truth, 27 deviation); grep -c 'apple-system-body' 07-UI-SPEC.md"
        status: pass
    human_judgment: false
  - id: D4
    description: "G-07-3 — at 390px the console document is exactly viewport-wide: `.nav` and `.nav nav` wrap, no label breaks mid-phrase, `Sign out` is a 44px tap box, and at 700px the bar is one unchanged line"
    requirement: RPT-03
    verification:
      - kind: unit
        ref: "tests/layout-contract.test.ts#lets both nav flex containers wrap, so the page never widens past the viewport"
        status: pass
      - kind: unit
        ref: "tests/layout-contract.test.ts#keeps Sign out on the 44px tap-target rule every other nav control has"
        status: pass
      - kind: automated_ui
        ref: "bash .planning/phases/07-attribution-reporting/07-06-harness/nav-check.sh (390px: docScrollWidth 390, navRight 370, navLines 3, signOutBox 44, no mid-phrase breaks; 700px: navLines 1, navHeight 55)"
        status: pass
    human_judgment: true
    rationale: "Thumb comfort on the real device is a judgment the headless measurement cannot make; the 390px phone check is queued for end-of-phase UAT."
  - id: D5
    description: "The contracts that prescribed the failing rules are corrected in place — 07-UI-SPEC Screens §3 + E6/E8 + a dated corrections subsection, and 07-04-PLAN.md:191 / 07-05-PLAN.md:50 annotated"
    verification:
      - kind: other
        ref: "grep -c 'existing flex-wrap nav' 07-UI-SPEC.md = 0; 'Contract correction 07-06' = 5 lines; 'CORRECTED BY 07-06' = 1 in each prior plan; gsd-tools frontmatter validate 07-05-PLAN.md --schema plan → valid: true"
        status: pass
    human_judgment: false

gap_closure: true
gap_ids: [G-07-1, G-07-2, G-07-3]

duration: 12min
completed: 2026-09-03
status: complete
---

# Phase 07 Plan 06: UAT Gap Closure (Print Pagination + Console Nav) Summary

**Every printed job row is now one line box — the only row shape either print engine promises not to split — the `<p>` footer no longer pages WebKit for 14px of zero-ink height, and the console bar wraps instead of widening a 390px phone; all eight rules pinned in a pure suite and the contracts that prescribed the wrong ones corrected in place.**

## Gap Closure

- **G-07-1 — FIXED.** The trailing blank page is gone. `.report-footer` uses the `margin: 1.5rem 0 0` shorthand, so the UA `<p>` `margin-block-end: 1em` no longer collapses out to the root; `.audit-footer` gets `margin: 0` for the same latent defect. Verified in the harness at 661px and 688px (`trailingGap -0.27`) and in both printed PDFs (last page carries text). **iPhone acceptance pending the end-of-phase human check.**
- **G-07-2 — FIXED on Chromium; one-line rows on BOTH engines; WebKit header repetition accepted as debt.** Chrome now prints the `JOB · CUSTOMER · …` header on every continuation page carrying rows (1 of 1) and no row is split; WebKit prints 40 fixture rows as 26 + 14 one-line rows with `#4200 · …` separated and no page opening on a fragment. WebKit repeats the header on 0 of 1 continuation pages — **recorded as accepted engine debt (WINDOWS.md #26), never claimed as fixed.**
- **G-07-3 — FIXED.** At a true 390px viewport `document.documentElement.scrollWidth` is exactly 390 (was 502), the bar wraps to three lines / 119px, `Sign out` is a 44px box, nothing breaks mid-phrase; at 700px the bar is one line at 55px — unchanged.

## Performance

- **Duration:** 12 min
- **Started:** 2026-09-03T08:37:20Z
- **Completed:** 2026-09-03T08:49Z
- **Tasks:** 3 of 3
- **Files modified:** 8 (+1 created)

## Accomplishments

- Replaced the two print rules that had never worked (`display: table-header-group` alone repeats nothing; `break-inside: avoid` on a `tr` is honoured by neither engine) with rules that do: `thead { break-inside: avoid }` for Chromium's header repeat, and a measured one-line-box budget (`0.7rem` / `0.4rem 0.3rem` / `nowrap` / `.cell-truncate` at `10rem`) that makes every row structurally unsplittable.
- Closed the 496px-vs-688px engine gap that was the whole four-page print, with a single WebKit-gated `zoom: 0.75` that is inert in Chromium and ships in the built chunk.
- Fixed the run-on job number at its real cause: the description span's only block rule was descendant-scoped to `.report-figure` and inert inside a `<td>`. The Job cell is now one `.cell-truncate` span with an explicit `{' · '}` string expression and the full label in `title`.
- Gave both nav flex containers `flex-wrap: wrap` — wrapping only the outer row leaves the inner `<nav>` overflowing — and restored the 44px `Sign out` tap box without moving the bar's height.
- Wrote `tests/layout-contract.test.ts`: eight pure assertions that read the stylesheets and the page with comments stripped, so a comment naming an old selector while explaining its removal cannot fail the gate.
- Corrected the UI-SPEC, both prior plans and the windows ledger so the failing rules cannot be re-specified from the contract, including the admission that 07-04 implemented §3 verbatim and the defect was the contract itself.

## Task Commits

1. **Task 1 (tracer): print fix end to end (G-07-1, G-07-2)** — `ca3d813` (fix)
2. **Task 2: console bar wraps at phone width (G-07-3)** — `834e7c6` (fix)
3. **Task 3: correct the contracts, record the engine debt** — `cba407f` (docs)

## Files Created/Modified

- `tests/layout-contract.test.ts` (created) — 8 pure source assertions pinning the print block, the Job cell markup and the two nav rules; copied verbatim from the planner's harness scaffold.
- `src/app/(console)/reports/[client]/[reportId]/report.css` — footer margin shorthand; the WebKit `zoom` gate; `thead { break-inside: avoid }`; the one-line-box table rules and the `.report-softwrap` valves; rows removed from the `break-inside` group; header comment rewritten.
- `src/app/(console)/reports/[client]/[reportId]/page.tsx` — `jobLabel()` helper; the Job cell as one `.cell-truncate` span with a literal separator and a `title`; `report-softwrap` on the Customer and Follow-ups cells.
- `src/app/(console)/audits/[id]/audit.css` — `.audit-footer { margin: 0 }`.
- `src/app/globals.css` — `.nav` and `.nav nav` `flex-wrap: wrap; gap: 0.5rem 1rem`; `.nav button.linkish { min-height: 2.75rem; margin: -0.625rem 0 }`.
- `.planning/phases/07-attribution-reporting/07-UI-SPEC.md` — Screens §3 screen + print rules, page budget, E6 and E8 overflow rows, plus a new `### Contract corrections (07-06, 2026-09-03)` subsection.
- `.planning/phases/07-attribution-reporting/07-04-PLAN.md`, `07-05-PLAN.md` — annotated in place with `[CORRECTED BY 07-06 …]`.
- `.planning/WINDOWS.md` — entries 26 (`unmet-truth`, WebKit header non-repetition) and 27 (`deviation`, softwrap two-line-row fold risk). `open_count` 21 → 23.

## Verification Output

### `bash .planning/phases/07-attribution-reporting/07-06-harness/run.sh`

```
== A. structural (Chrome, print block applied on screen) ==
        661 px: {"width":661,"trailingGap":-0.27,"wrappedRows":0,"tableFits":true,"tableScrollOverflow":"visible","theadBreakInside":"avoid","jobCellDisplay":"block","cols":[172,79,47,114,60,85,104]}
  PASS  661px: no zero-ink height after the footer (G-07-1)
  PASS  661px: every job row is one line box
  PASS  661px: seven columns fit the column (no clipped Conservative)
  PASS  661px: .table-scroll computes overflow visible in print
  PASS  661px: thead computes break-inside: avoid
  PASS  661px: Job cell span is a block
        688 px: {"width":688,"trailingGap":-0.27,"wrappedRows":0,"tableFits":true,"tableScrollOverflow":"visible","theadBreakInside":"avoid","jobCellDisplay":"block","cols":[179,82,48,119,63,88,108]}
  PASS  688px: no zero-ink height after the footer (G-07-1)
  PASS  688px: every job row is one line box
  PASS  688px: seven columns fit the column (no clipped Conservative)
  PASS  688px: .table-scroll computes overflow visible in print
  PASS  688px: thead computes break-inside: avoid
  PASS  688px: Job cell span is a block
== B. Chromium print (Google Chrome, A4, @page margins) ==
        chrome p1 1813 18 0 0 0 Quote follow-up report — Fixture Client
        chrome p2 2511 22 0 1 0 JOB                           CUSTOMER WON FOLLOW-UPS
        chrome p3 53 0 0 0 0 Quote Recovery · August 2026 · prepared 3 Sep 2026 · vers
  PASS  chrome: last page carries text (no trailing blank page)
  PASS  chrome: every job row keeps its dollar figures on its own page
  PASS  chrome: no page opens with the tail of a cut row
  PASS  chrome: job id and description are separated (#4200 · …)
  PASS  chrome: header repeated on all 1 continuation page(s) carrying rows
== C. WebKit print (WKWebView, 1px = 1pt, iOS-measured margins) ==
        webkit p1 2381 26 0 0 0 Quote follow-up report — Fixture Client
        webkit p2 1833 14 0 0 0 #4226 · Switchboard upg…      Dave           31 Aug   12
  PASS  webkit: last page carries text (no trailing blank page)
  PASS  webkit: every job row keeps its dollar figures on its own page
  PASS  webkit: no page opens with the tail of a cut row
  PASS  webkit: job id and description are separated (#4200 · …)
  INFO  webkit: header repeated on 0 of 1 continuation page(s) carrying rows (WebKit does not repeat table header groups — recorded engine debt, not asserted)

RESULT: PASS
```

### `bash .planning/phases/07-attribution-reporting/07-06-harness/nav-check.sh`

```
        390px: {"viewport":390,"docScrollWidth":390,"navRight":370,"navHeight":119,"navLines":3,"signOutBox":44,"brokenMidPhrase":[]}
  PASS  390px: document is exactly viewport-wide (no sideways page scroll)
  PASS  390px: every nav item is inside the viewport
  PASS  390px: Sign out tap box is 44px (≥ 44)
  PASS  390px: no label breaks mid-phrase
        604px: {"viewport":604,"docScrollWidth":604,"navRight":514,"navHeight":87,"navLines":2,"signOutBox":44,"brokenMidPhrase":[]}
  PASS  604px: document is exactly viewport-wide (no sideways page scroll)
  PASS  604px: every nav item is inside the viewport
  PASS  604px: Sign out tap box is 44px (≥ 44)
  PASS  604px: no label breaks mid-phrase
        700px: {"viewport":700,"docScrollWidth":700,"navRight":680,"navHeight":55,"navLines":1,"signOutBox":44,"brokenMidPhrase":[]}
  PASS  700px: document is exactly viewport-wide (no sideways page scroll)
  PASS  700px: every nav item is inside the viewport
  PASS  700px: Sign out tap box is 44px (≥ 44)
  PASS  700px: no label breaks mid-phrase
  PASS  700px: bar is one line (desktop unchanged)

RESULT: PASS
```

### Toolchain

- `npx vitest run tests/layout-contract.test.ts -t "printed report sheet"` — RED before the source edits (6 failed), GREEN after (6 passed).
- `npx vitest run tests/layout-contract.test.ts` — **8 passed, 0 failed.**
- `npm test` — **2366 passed, 0 assertion failures.** 39 test *files* fail at import with `Refusing to run integration tests against a non-local Supabase stack` — the documented remote-gated baseline, unchanged by this plan.
- `npx tsc --noEmit`, `npm run lint`, `npm run build` — all exit 0.
- `grep -l 'apple-system-body' .next/static/chunks/*.css | wc -l` = **1** — the WebKit gate ships in the built chunk.

### Windows ledger

`gsd-tools windows status`: `open_count` **21 → 23**, `total_count` 25 → 27. New entries:

| id | kind | description |
|----|------|-------------|
| 26 | unmet-truth | WebKit does not repeat the per-job table header on continuation pages; the "header repeated on each continuation page" truth holds on desktop Chrome only |
| 27 | deviation | Printed rows are unsplittable only because every cell is one line box; the `.report-softwrap` valves may wrap under width pressure and WebKit can split such a two-line row |

## Decisions Made

See `key-decisions` in the frontmatter. The load-bearing one: **WebKit's header non-repetition is recorded as debt rather than worked around.** Making iOS Safari repeat a header group would need per-page table splitting in JS or a server-side paginator — disproportionate for a document that is at most three pages, and it would put computation back on a page whose whole contract is render-from-the-row.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] The plan's Task 1 comment wording collided with its own acceptance grep**

- **Found during:** Task 1
- **Issue:** The JSX comment the plan dictates for the Job cell quotes the separator literal while explaining why it is written out. That put a second `{' · '}` on the page, and the acceptance criterion is `grep -c "{' · '}" page.tsx` = 1 (grep counts lines).
- **Fix:** Reworded the comment to "The separator below is an explicit string expression because JSX strips the newline whitespace…" — same mechanism stated, no literal duplicated.
- **Files modified:** `src/app/(console)/reports/[client]/[reportId]/page.tsx`
- **Verification:** `grep -c "{' · '}"` = 1; the pure suite's `expect(tbody).toContain("{' · '}")` still passes.
- **Committed in:** `ca3d813`

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking). **Impact on plan:** none on behaviour; a comment rewording only. No scope creep.

## Issues Encountered

**1. Two of the plan's acceptance criteria were arithmetically wrong for the artifacts they count. Neither is a defect; both are recorded so `/gsd-verify-work` does not read them as failures.**

- **`grep -c 'G-07-2 (07-06)' .planning/WINDOWS.md` = 2** — the actual count is **4**. `WINDOWS.md` stores every entry twice: once as a markdown table row and once inside the trailing fenced JSON block that `gsd-tools windows` maintains. Two appended entries therefore produce four grep-matching lines. The plan's own `<verify><automated>` block uses `-ge 2`, which passes; only the prose acceptance line says `= 2`. Table rows 26 and 27 are present and `open_count` rose by exactly 2, which is the substance of the check.
- **Task 1's `npm test` acceptance ("0 assertion failures") could not hold at the Task 1 commit**, because Task 1 step (0) copies the whole suite — including the `console bar at phone width` describe block, which Task 2's `read_first` itself describes as "already RED". The two nav assertions were knowingly RED for exactly one commit (`ca3d813`) and green from `834e7c6` onward. This is the plan's designed RED→GREEN sequencing, not a regression; every other gate (filtered suite, `tsc`, `lint`, `build`, both harnesses) was green at the Task 1 commit.

**2. `gen.mjs` needed no update.** Task 1 step (6) asks for it if the harness's hand-mirrored table markup drifts from `page.tsx`. The planner had already written `gen.mjs` against the post-fix markup (`.cell-truncate` span, literal separator, two `.report-softwrap` cells), so it matched the shipped JSX byte for byte after the edit.

## Known Stubs

None. No placeholder values, no unwired data paths, no skipped tests introduced by this plan. The two accepted limitations are behavioural facts of the print engines, recorded in WINDOWS.md rather than left as silent stubs.

## Threat Flags

None. Every edit is presentation — CSS declarations, a class name, a literal separator string, a `title` attribute, planning documents and a local verification harness. No route handler, query, RLS policy, auth path, env var or dependency changed; `package.json` is untouched. The threat register's three `accept` dispositions (T-07-06-01 `title` disclosure, T-07-06-02 harness, T-07-06-03 print zoom) hold as written.

## Outstanding Human Verification

Both checks are **end-of-phase, on the deployed app** (`workflow.human_verify_mode: end-of-phase`) — they do not block this plan, and `/gsd-verify-work` reconciles G-07-1..3 from this SUMMARY.

1. **The iPhone print (the acceptance for G-07-1 and G-07-2).** On the operator's iPhone in dark mode, open `/reports/13e8f2aa-edee-4eb1-b699-09b650674f81/2240704d-c755-4d55-ac1b-04fa09082331` (the 20-line August 2026 fixture whose version-2 PDF was the UAT evidence) and Print → Save as PDF. Expect a **light** sheet of 2–3 pages; **no blank last page** (the last page ends on the `Quote Recovery · August 2026 · …` footer or a footnote, never Safari's URL footer alone); every job row on **one line** reading `#4201 · Switchboard upgrade…`, first name, `d MMM`, `n (d MMM–d MMM)`, replies, `$…`, `$…`; the Conservative column fully on the sheet; hero and figures never split from their labels. The table header appears on **page one only** — that is the recorded debt (WINDOWS.md #26); confirm and note it, do not fail on it. **If the type looks implausibly small or the pagination is odd, say so:** the recorded fallback is deleting the `@supports (font: -apple-system-body)` zoom block only, which degrades to wrapped two-line rows with no blank page, separated ids and no clipped column.
2. **The desktop Chrome print, and the 390px phone.** Same report from desktop Chrome (Print → Save as PDF, A4): additionally the `JOB · CUSTOMER · WON · FOLLOW-UPS · REPLIES · GROSS · CONSERVATIVE` header at the top of **every** page carrying rows, and no row split. In DevTools (Rendering → Emulate CSS media: print) select `.table-scroll` and confirm computed `overflow-x: visible`. Then on the phone (or DevTools at exactly 390px) open `/reports`: no sideways scroll (`document.documentElement.scrollWidth === 390`), `Email` and `Sign out` visible and comfortable to hit with a thumb, no label broken mid-word, only the table scrolling inside its own box; widen past ~700px and the bar is one line as before.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Phase 7's three UAT gaps are closed in code and pinned in a suite that runs on every `npm test`, so a future edit to either stylesheet fails loudly rather than silently reprinting the four-page PDF. The phase is ready for `/gsd-verify-work` once the two human checks above are performed against a deploy. Nothing here blocks Phase 8: no schema, no migration, no server code and no dependency moved.

---
*Phase: 07-attribution-reporting*
*Completed: 2026-09-03*

## Self-Check: PASSED

All created/modified files exist on disk and all four commits (`ca3d813`, `834e7c6`, `cba407f`, `082d413`) are present in git history.
