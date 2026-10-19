---
status: resolved
trigger: "G-07-6 clients-table-widens-page-390 — On the deployed console at phone width (390px viewport), the Clients table on the post-login landing page src/app/(console)/page.tsx (rendered at :154, seven columns: Name / Trade / Sync / Drafts / Last sync / Contact hours / Status) makes the whole document wider than the viewport, whereas the Reports overview table (src/app/(console)/reports/page.tsx:149) does not. The 07-06 gap fix (G-07-3, commit range ca3d813..2fb1e3a) made the console nav wrap at 390px, which removed the nav as the widest box and exposed this table as the next one."
created: 2026-09-03T15:24:01Z
updated: 2026-09-03T16:05:00Z
resolved: 2026-09-05
resolution: "Resolved by 07-07-PLAN.md (commit 43d245f; UAT test 6 re-check pass 2026-09-04; harness tables-check.sh PASS)"
mode: find_root_cause_only
symptoms_prefilled: true
---

## Current Focus
<!-- OVERWRITE on each update - reflects NOW -->

bug_class: Bohrbug (deterministic layout defect — reproduces on every render of `/` at any viewport narrower than ~640px, for ANY tenant data including the header row alone)
hypothesis: CONFIRMED — `src/app/(console)/page.tsx:154` renders its `<table>` as a bare child of `<section>` with no `.table-scroll` wrapper (it never had one in any of its five commits), so the table's min-content width — 447.7px for the seven uppercase header cells alone, 599.6px with realistic rows — is a floor that `table { width: 100% }` cannot go under; `<section>`, `<main>` (`max-width: 60rem`, no overflow), `.shell` (no CSS) and `html/body` all leave `overflow` at `visible`, so the surplus becomes document scrollable overflow (`scrollWidth` 620 at 390px, measured). The identical markup inside `<div class="table-scroll">` measures exactly 390.
test: Headless Chrome (152) over the REAL globals.css, page markup mirrored 1:1 inside a 390px iframe (the 07-06 nav-check.sh technique), with the wrapped /reports table as the control; plus git history of page.tsx and every `<table>` in src/app/(console).
expecting: n/a — confirmed
next_action: Return ROOT CAUSE FOUND (goal: find_root_cause_only — no fix applied; plan-phase --gaps owns the fix)
known_pattern_candidate: "console-nav-overflow-390 (G-07-3) — a UI-SPEC row signed off an overflow state on a container behaviour the container never had. Matched exactly, one page over."

reasoning_checkpoint:
  hypothesis: "The document on `/` is wider than a 390px viewport because the Clients `<table>` at page.tsx:154 has no overflow-containing ancestor between itself and the initial containing block. An auto-layout table's used width is max(specified width, min-content width) (CSS 2.1 §17.5.2.2); `width: 100%` therefore cannot shrink the seven-column table below its min-content sum (447.7px header-only, 599.6px with rows) against the 350px content box of `main` at 390px. With `overflow: visible` on `<section>`, `<main>`, `.shell`, `body` and `html`, the ~250px surplus is scrollable overflow of the viewport — `document.documentElement.scrollWidth === 620`."
  confirming_evidence:
    - "MEASURED (headless Chrome 152, real globals.css, 390px iframe): clients-realistic → docScrollWidth 620, tableWidth 599.6 == tableMinContent 599.6, parent `<section>` overflow-x: visible, navRight 370 (the nav is inside the viewport — the bar is no longer the widest box). Column floors: Name 92 · Trade 91 · Sync 137 (the nowrap `.badge` 'never synced' pill) · Drafts 71 · Last sync 58 · Contact hours 82 · Status 69."
    - "MEASURED: clients-min (one tenant 'Bob', every cell at its shortest) → 565; clients-no-badges → 497; clients-THEAD-only (empty tbody) → 468 (min-content 447.7 vs 350 available). The seven header cells alone — 0.8rem uppercase, 0.03em letter-spacing, 0.5rem padding each side — exceed the 390px content box by ~98px. No cell-level change (badge, truncation, date format) can bring seven columns under 350px; only containment or fewer columns can."
    - "MEASURED, the differential: the SAME realistic markup inside `<div class=\"table-scroll\">` → docScrollWidth 390, table still 599.6 wide inside a box whose computed overflow-x is `auto`. The /reports control (wrapped, min-content 472.9) → 390. This is precisely the user's observation — 'unlike the Reports table'."
    - "SOURCE: page.tsx:154 `<table>` is the direct child of `<section>` (:141). reports/page.tsx:149 wraps its table in `.table-scroll`. globals.css: `table { width: 100% }` (:292), `.table-scroll { overflow-x: auto }` (:319), `main { padding: 1.25rem; max-width: 60rem }` with no overflow (:57), no `.shell` rule at all, nothing sets `overflow-x` on html/body — same propagation path recorded for G-07-3."
    - "HISTORY: `git log -S'table-scroll' -- 'src/app/(console)/page.tsx'` is empty — none of the file's five commits (19828d8 → 58307c9) ever contained the wrapper. `.table-scroll` was born in 8de755c (02-05, the QUOTES table) and adopted by 02-07, 03-05, 04-06, 07-04, 07-05 — never by the landing page."
    - "BREAKPOINTS: at a 640px viewport (600px content box) the 599.6px floor just fits → docScrollWidth 640; at 1000px the 917.6px max-content fits main's 920px cap → natural layout, zero squeeze. Every desktop review (≥1000px) saw a perfect table; the defect exists only below ~640px."
  falsification_test: "Wrap page.tsx:154 in `<div className=\"table-scroll\">` and load `/` at exactly 390px: `document.documentElement.scrollWidth` must be 390 and the table must scroll inside its own box with `Sign out` untouched. If the page is still wider than 390 after the wrap, the hypothesis is wrong. Conversely, at ≥640px the symptom must vanish with no code change — which is why every desktop check passed."
  fix_rationale: "The fix is the containment the contract has claimed since 06-UI-SPEC:182, not a content change: `overflow-x: hidden` on main/shell would clip the Status column unreachably, `table-layout: fixed` would wrap uppercase headers mid-word and squash seven columns into 50px each, and dropping columns is a product decision the UI-SPEC does not make. `.table-scroll` is the established, tested rule (02-05) and is measured to put `/` at exactly 390."
  blind_spots: "Measured in headless Chromium, not iPhone Safari — but the mechanism (table min-content floor + overflow: visible propagation) is engine-independent and identical to the G-07-3 path the user has already confirmed on the phone. Row content in the fixture is representative, not the operator's live tenants (cannot log in); the THEAD-only fixture removes that dependency by showing the header row alone overflows. Ultimate root font size assumed 16px."
  candidate_causes:
    - "code (markup — PRIMARY): page.tsx:154 `<table>` has no `.table-scroll` wrapper; latent since 19828d8, unambiguous since d113b8e (02-04) took the table to six columns with a nowrap health pill, grown by 58307c9 (06-02) adding the seventh."
    - "code (CSS): `table { width: 100% }` + auto layout floors at min-content, and no ancestor (section/main/.shell/body/html) contains overflow — the propagation path. Correct by design (the wrapper is the intended containment); not itself a defect."
    - "process/contract: 06-UI-SPEC:182 ('the table stays inside `.table-scroll`'), 06-02-PLAN:159/162, 07-UI-SPEC:242 and :319 ('client-list convention/precedent'), and the reports/page.tsx:146 comment all cite a client-list wrapper that never existed. 02-UI-SPEC's overflow row (:191) covers only the quotes table; 02-UAT test 1 recorded 'page body never overflows at 390px' after a walkthrough that included the client list — inaccurate for a six-column table with a nowrap pill. No gate ever measured `/` at phone width."
    - "environment (viewport): only visible below ~640px; every dev window, desktop review and screenshot renders wider. The 390px checks that DID happen (02-UAT 1, 06-UAT 2, 07-UAT 3/6) looked at the quotes table, the queue, and /reports — never at `/` with a scrollWidth probe."
  and_gate: "No for the FIX — the wrapper alone puts `/` at exactly 390 at any column count and any data (measured). Yes for VISIBILITY — three conditions had to coincide: the missing wrapper AND a viewport under ~640px AND a contract/UAT chain that repeatedly marked the landing-page overflow covered by citing a precedent that lived on a different table. Treating the 06-02 Drafts column as the cause would be wrong: the six-column table already overflowed by ~180px before it."

## Symptoms
<!-- Written during gathering, then IMMUTABLE -->

expected: At a 390px viewport no console page becomes wider than the viewport; any table too wide for the column scrolls sideways INSIDE its own box (02-UI-SPEC overflow backstop; the `.table-scroll { overflow-x: auto }` rule in src/app/globals.css:319).
actual: User reported verbatim: "the Clients table after login widens the page unlike the Reports table".
errors: None reported.
reproduction: Test 6 in UAT (.planning/phases/07-attribution-reporting/07-UAT.md). Cannot log in to deployed console; reason from source and, if useful, local build or static HTML measurement with headless Chrome (see 07-06-harness/run.sh). Do NOT run npm run test:remote or touch the hosted DB.
started: Discovered during UAT after the 07-06 deploy. The Clients table has had no wrapper since it was created; the wrapper convention was introduced for the Phase 2 quotes table.

## Eliminated
<!-- APPEND only - prevents re-investigating -->

- hypothesis: "The nav is still the widest box on `/` after 07-06 (the G-07-3 fix did not take on this page)"
  evidence: "In every 390px fixture `navRight` is 370 (inside the 390 viewport) and the wrapped fixtures measure docScrollWidth exactly 390 — the bar wraps and contains itself. Only the unwrapped table moves scrollWidth."
  timestamp: 2026-09-03T15:50Z

- hypothesis: "The h1 `.row` with the `New client` button, or some other element on the landing page, widens the document"
  evidence: "clients-WRAPPED-fix keeps the identical h1 row + button and every other element, changing only the table's parent — docScrollWidth drops from 620 to 390. `.row` is `flex-wrap: wrap` (globals.css:137)."
  timestamp: 2026-09-03T15:50Z

- hypothesis: "A specific cell — the nowrap `.badge` health pill, the 'Mon, Wed, Fri' contact days, the en-AU timestamp — is the cause, and trimming it would fix the page"
  evidence: "The pill IS the biggest single contributor (Sync column 137px vs 54px header-only), but clients-no-badges still measures 497 and clients-THEAD-only (no rows at all) still measures 468 against a 390 viewport. Seven padded uppercase headers alone exceed the 350px content box by ~98px. Content trimming cannot close a gap the header row opens."
  timestamp: 2026-09-03T15:58Z

- hypothesis: "The 06-02 Drafts column (58307c9) introduced the overflow"
  evidence: "Removing its 71px floor from the 599.6px realistic min-content still leaves ~529px — 179px over. The six-column table from d113b8e (02-04) already overflowed; the tracer's five columns (with an `Australia/Perth` Timezone cell) sat at the edge. Not a regression to bisect."
  timestamp: 2026-09-03T16:00Z

## Evidence
<!-- APPEND only - facts discovered -->

- timestamp: 2026-09-03T15:30Z
  checked: Phase 0 — .planning/debug/knowledge-base.md and sibling sessions
  found: knowledge-base.md does not exist. console-nav-overflow-390.md (G-07-3, diagnosed) is the sibling on the same page shell and records the propagation path — `.shell` has no CSS rule, nothing sets `overflow-x` on html/body/main, the only overflow declarations in globals.css are `.table-scroll { overflow-x: auto }` and `.cell-truncate { overflow: hidden }`. Its Eliminated section explicitly notes the /reports table behaves because it is inside `.table-scroll`.
  implication: Known-pattern candidate — "contract cites a container behaviour the container never had" (G-07-3 shape). Test first: does the Clients table have the wrapper the UI-SPECs say it has?

- timestamp: 2026-09-03T15:32Z
  checked: grep every `<table` in src/app/(console) with 3 lines of preceding context; grep every `table-scroll` in src
  found: |
    Nine <table> elements. WRAPPED in <div className="table-scroll">: reports/page.tsx:150, reports/[client]/[reportId]/page.tsx:306, settings/email/page.tsx:106 and :239, audits/[id]/mapping/mapping-form.tsx:127.
    UNWRAPPED (direct child of a block, no overflow containment): page.tsx:154 (Clients), clients/[id]/page.tsx:1045 (sync runs), audits/page.tsx:105 (audits list), audits/[id]/mapping/mapping-form.tsx:73 (first mapping table).
    The brief's inventory is exactly right.
  implication: The Clients table is one of four tables with no `.table-scroll` box between it and `main`.

- timestamp: 2026-09-03T15:33Z
  checked: git log -S'table-scroll' -- src ; git log --follow -- 'src/app/(console)/page.tsx' ; git log -S'table-scroll' -- 'src/app/(console)/page.tsx'
  found: `.table-scroll` was introduced in 8de755c (feat(02-05) quotes table, D-16) and later adopted by b50a94a (02-07 mapping preview table), 689c0ec (03-05), 1c44f19 (04-06 email settings), 5d2fba5 (07-04 report), daac276 (07-05 reports overview). page.tsx has five commits (19828d8, 06d5485, d113b8e, 53531f0, 58307c9) and NONE ever contained the string `table-scroll` — the `<table>` has been a bare child of `<section>` since the 01-02 tracer. No regression to bisect.
  implication: Not a regression — a latent omission since the first console commit, exposed when G-07-3 removed the nav as the widest box on /reports and sent the operator looking for what still scrolled.

- timestamp: 2026-09-03T15:34Z
  checked: src/app/globals.css table rules (292-321), main (57-61), shell (102-129), layout.tsx shell structure
  found: `table { width: 100%; border-collapse: collapse }` (auto table layout — no `table-layout: fixed`), `th, td { padding: 0.6rem 0.5rem }`, `th { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.03em }`. `.table-scroll { overflow-x: auto }` at 319. `main { padding: 1.25rem; max-width: 60rem }` — no overflow, no min-width. `.shell` still has no rule. `.badge` is `white-space: nowrap` (400-412), so a health pill ("never synced", "auth failed") is an unbreakable min-content contribution.
  implication: Mechanism candidate — `width: 100%` on an auto-layout table is a floor at min-content, not a cap; with no overflow containment between `<table>` and the initial containing block, the excess becomes document scroll width.

- timestamp: 2026-09-03T15:36Z
  checked: 02-UI-SPEC.md:142-196, 06-UI-SPEC.md:180-182, 06-02-PLAN.md:159/162, 07-UI-SPEC.md:242/319, reports/page.tsx:146-148 comment
  found: |
    06-UI-SPEC:182 (D-12, the Drafts column added to the client list in 58307c9; introduced by 19f8830 "docs(06): UI design contract"): "No new row styling; the table stays inside `.table-scroll`." — FALSE when written and still false. 06-02-PLAN:159 lists "client-list table + deriveHealth badge pattern + table-scroll" as read_first and :162 repeats "the table stays inside .table-scroll".
    07-UI-SPEC:242: "ONE `table` inside `.table-scroll` (the client-list convention — on a 390px phone it scrolls sideways inside the box; `main` never widens)".
    07-UI-SPEC:319 overflow row E1: "✅ covered — `.table-scroll` sideways scroll inside the box on a 390px phone; `main` never widens (client-list precedent)".
    reports/page.tsx:146-148 comment: "SIDEWAYS SCROLL INSIDE THE BOX, never a wider `main` — the client list's rule."
    02-UI-SPEC §1 (:142) adds Sync/Last sync columns to the client list with no overflow consideration; its overflow row (:191) covers only the QUOTES table (200+ rows, 🧪 backstop). 06-UI-SPEC's UI Considerations (:215-222) has no client-list row either. 02-UAT test 1 notes "page body never overflows at 390px; quotes table scrolls in .table-scroll" after an emulated-phone walkthrough that listed the client list — the measurement below shows the six-column table of that era already overflowed.
  implication: Same contract failure shape as G-07-3: two phases of UI-SPEC, one plan, and a source comment describe a "client-list convention/precedent" for `.table-scroll` that the client list never implemented. The convention was born on the quotes table (02-05) and misattributed to the landing page; nothing ever probed `/` with a scrollWidth check.

- timestamp: 2026-09-03T15:48Z
  checked: Headless Chrome 152 measurement — page.tsx markup mirrored 1:1 (nav from layout.tsx with the Queue badge, h1 `.row` + button, the seven-column table with the real formatters' output: en-AU "3 Sept 2026, 4:15 pm", "08:00–18:00", "Mon–Fri", health pills) over the REAL globals.css, inside a 390px iframe; scratchpad g076/gen-tables.mjs + run.sh (same technique as 07-06-harness/gen-nav.mjs)
  found: |
    clients-realistic   docScrollWidth 620  tableWidth 599.6 == minContent 599.6  maxContent 917.6  parent <section> overflow-x:visible  navRight 370
                        columns: Name 92 | Trade 91 | Sync 137 | Drafts 71 | Last sync 58 | Contact hours 82 | Status 69
    clients-min         docScrollWidth 565  minContent 544.6   (one tenant "Bob"/plumber/never synced/—/—/—/active)
    clients-no-badges   docScrollWidth 497  minContent 476.6
    clients-THEAD-only  docScrollWidth 468  minContent 447.7   (empty tbody — header cells alone: 56|62|54|71|54|82|69)
    clients-WRAPPED-fix docScrollWidth 390  tableWidth 599.6   parent <div class="table-scroll"> overflow-x:auto
    reports-CONTROL     docScrollWidth 390  tableWidth 472.9   parent <div class="table-scroll"> overflow-x:auto
    main content box at 390px = 350 (390 − 2 × 1.25rem).
  implication: DEFINITIVE. The unwrapped table is at its min-content floor (tableWidth == tableMinContent) and the document is exactly that floor plus main's padding (599.6 + 20 = 619.6 → 620). The wrapper alone drops the document to 390 with the table untouched. The header row by itself overflows by ~98px, so this is a column-count/containment problem, not a content problem.

- timestamp: 2026-09-03T15:52Z
  checked: The other three unwrapped tables, same harness, common and worst-case content each
  found: |
    clients/[id]/page.tsx:1045 sync runs — runs-common (ok / auth failed / rate limited pills): minContent 342.6, fits, doc 390. runs-worst (the `response parse error` pill, nowrap, 200px column): minContent 417.1 → doc 437.
    audits/page.tsx:105 audits list — audits-common: 326.9, fits. audits-longword ("Electrotechnologies Pty Ltd" — one 19-char unbreakable word): 370.1 → tableRight 390.1, doc 390 (integer). One more character and it overflows.
    audits/[id]/mapping/mapping-form.tsx:73 mapping table (inside `form { display:flex; flex-direction:column; max-width:30rem }`, the table is a flex item with `min-width:auto`) — short CSV headers: 342.2, fits. Realistic ServiceM8 export headers ("Job Contact Mobile Number", "Total Invoice Amount"…, the select's intrinsic width = its widest option): 388.2 → doc 408.
  implication: All four unwrapped tables share the propagation path; the Clients table is the only one that overflows unconditionally (header row alone). Sync runs overflows on any `parse_error` run, the mapping table on realistic ServiceM8 headers, the audits list on a ≥20-char business-name word. A fix plan should wrap all four in one pass — the same class, the same reasoning, no CSS change.

- timestamp: 2026-09-03T15:58Z
  checked: Clients table at 640px and 1000px viewports (same harness)
  found: 640px → content box 600, tableWidth 600, minContent 599.6, doc 640 (fits, barely). 1000px → content box 920, tableWidth 920, maxContent 917.6, doc 1000 (natural layout, no squeeze at all).
  implication: The defect is invisible at ≥ ~640px and the table looks ideal at ≥1000px — every desktop review passed honestly. Timeline consistency: on `/` the table (620) has been WIDER than the pre-07-06 nav (502) all along; the nav fix did not change the landing page's width, it removed the explanation the operator already had for it.

- timestamp: 2026-09-03T16:00Z
  checked: Column history of page.tsx per commit (git show <sha>:path | grep '<th>')
  found: 19828d8/06d5485: Name|Trade|Timezone|Contact hours|Status (five, with an `Australia/Perth` cell). d113b8e (02-04): Name|Trade|Sync|Last sync|Contact hours|Status (six, plus the nowrap health pill). 58307c9 (06-02): + Drafts (seven).
  implication: At the 350px floor the tracer's five columns were already at the edge; six columns with a 137px pill (~529px) were unambiguously over from 02-04; the seventh column added 71px. No single commit "broke" it — the wrapper was never there.

- timestamp: 2026-09-03T16:02Z
  checked: tests/ for anything that would need updating if the four tables are wrapped — layout-contract.test.ts (full), rekey-resume.test.ts:225-300, stall-tick.test.ts:600-640, console-error-leak.test.ts:40-110, prospect-audit.test.ts:345-380, pipeline-grouping / quote-triage / drafting-settings-action / email-settings-action greps for `<table`, `table-scroll`, `<thead`
  found: No test asserts the markup adjacent to any of the four tables. The source assertions on page.tsx are: deriveHealth/HEALTH_BADGE_CLASS/HEALTH_LABELS present, no literal health strings, no `api_key_ciphertext`, `stallBoundary` present and no second `4`, "Could not load" + role="alert" + console.error(error.code). On clients/[id]/page.tsx: `toContain('Recent sync runs')`, 'No sync runs yet.', `syncOutcomeLabel`. On audits/page.tsx: no `api_key_ciphertext`/`csv_staging`. layout-contract.test.ts has G-07-1/2 print rules and the G-07-3 nav rules (`.nav` / `.nav nav` flex-wrap, 44px tap boxes) — nothing about tables and wrappers.
  implication: Wrapping the tables breaks no existing test. The gap that let this ship is the absence of any assertion that a console `<table>` lives inside `.table-scroll` — a natural third `describe` in layout-contract.test.ts (count of `<table` per (console) .tsx file, comments stripped, must equal count of `<div className="table-scroll">\s*<table`).

## Resolution
<!-- OVERWRITE as understanding evolves -->

root_cause: "`src/app/(console)/page.tsx:154` renders the seven-column Clients `<table>` as a bare child of `<section>` with no `.table-scroll` wrapper — and never has, in any of the file's five commits since the 01-02 tracer (19828d8). An auto-layout table's used width is max(specified, min-content) (CSS 2.1 §17.5.2.2), so `table { width: 100% }` cannot take it below its min-content floor: 447.7px for the seven padded uppercase header cells alone, 599.6px with realistic rows (the `white-space: nowrap` health pill contributes a 137px Sync column), against the 350px content box `main` offers at 390px. Between the table and the initial containing block, `<section>`, `<main>` (`max-width: 60rem`, no overflow), `.shell` (no CSS) and `html/body` all leave `overflow: visible`, so the ~250px surplus becomes viewport scrollable overflow — measured `document.documentElement.scrollWidth` = 620 at 390px in headless Chrome over the real globals.css; the identical markup inside `<div class=\"table-scroll\">` measures exactly 390, as does the wrapped /reports table the user says behaves. The overflow has been unambiguous since 02-04 (d113b8e) took the table to six columns and grew with 06-02's seventh; 07-06's nav fix (G-07-3) did not change the width of `/` — the table (620) was already wider than the overflowing nav (502) — it removed the explanation the operator had for the sideways scroll. The contract chain missed it because 06-UI-SPEC:182 ('the table stays inside `.table-scroll`'), 06-02-PLAN:162, 07-UI-SPEC:242/:319 ('client-list convention/precedent') and the reports/page.tsx:146 comment all cite a landing-page wrapper that exists only on the quotes table it was written for (02-05), and no UAT ever probed `/` at 390px with a scrollWidth check. Three sibling tables share the path and overflow conditionally: clients/[id]/page.tsx:1045 (sync runs; any `response parse error` pill → 437), audits/[id]/mapping/mapping-form.tsx:73 (mapping table; realistic ServiceM8 export headers → 408), audits/page.tsx:105 (audits list; a ≥20-character unbreakable business-name word → >390)."
fix: "NOT APPLIED — goal was find_root_cause_only. Suggested direction recorded in the return payload; plan-phase --gaps owns the fix plan."
verification: "Diagnosis only. Falsification test for the fix: at exactly 390px on `/` with at least one tenant row, `document.documentElement.scrollWidth === 390`, the Clients table scrolls sideways inside its own box (its width stays ~600), the nav is unchanged (three lines, `Sign out` reachable), and at ≥1000px the table renders at natural width with no visible scrollbar — the wrapper is inert there. The same probe on clients/[id] with a parse_error sync run, on audits with a long business name, and on the mapping step with ServiceM8 headers must also read exactly 390."
files_changed: []
