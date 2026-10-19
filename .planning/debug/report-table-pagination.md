---
status: resolved
trigger: "G-07-2 report-table-pagination — On a 20-line printed monthly report the per-job table's header row is not repeated on continuation pages, a data row splits across the page fold, and the job number runs straight into the description with no separator."
created: 2026-09-03T00:00:00+08:00
updated: 2026-09-03T01:30:00+08:00
resolved: 2026-09-05
resolution: "Resolved by 07-06-PLAN.md (thead break-inside, one-line rows, separator; UAT tests 4 and 5 pass; WebKit header non-repeat accepted as WINDOWS #26)"
---

## Current Focus
<!-- OVERWRITE on each update - reflects NOW -->

bug_class: Bohrbug (deterministic — reproduces on every desktop-Chrome print of any report whose table exceeds one page)
hypothesis: CONFIRMED — three independent causes, two of them originating in the design contract (07-UI-SPEC line 261 / 07-04-PLAN line 191), which the implementation followed verbatim.
test: Static analysis of authored CSS + BUILT CSS chunks + JSX + Next.js CSS chunk order, cross-checked against the Chromium commit that defines the repeat-header condition and the still-open Chromium tr/td break bug, plus a codebase differential against the established `.cell-truncate` pattern.
expecting: n/a — confirmed
next_action: Return ROOT CAUSE FOUND (goal: find_root_cause_only — no source modified; plan-phase --gaps owns the fix)

reasoning_checkpoint:
  hypothesis: "Three separate defects produce the four observed artifacts. (1) The header does not repeat because Chromium's documented condition for repeating a header group is `break-inside: avoid` computing on the `<thead>` box itself; report.css puts `break-inside: avoid` on `.report-lines tr` and gives `thead` only `display: table-header-group`, which is a NO-OP because that is already the UA default for `<thead>`. (2) The `#4208` row splits mid-cell because Chromium has never honoured `break-inside`/`page-break-inside: avoid` on `<tr>`/`<td>` (Chromium 99124 / 40639169, still open), so `.report-lines tr { break-inside: avoid }` is inert in the exact browser the product designates as its PDF engine. (3) `#4201Switchboard…` has no separator because the description span carries className='muted report-figure-note' but the only rule that gives that class `display: block` is the DESCENDANT selector `.report-figure .report-figure-note`, and a `<td>` in `.report-lines` has no `.report-figure` ancestor — so the span computes to `display: inline`, and JSX strips the newline whitespace between the `#{id}` text node and the span, leaving zero separation. The same inline run is one ~66-character run that auto table layout awards a huge column share to, starving the FOLLOW-UPS column into the observed `2 (1`/`Aug–1`/`Aug)` wrap."
  confirming_evidence:
    - "Chromium commit 81c0fc6d4e08e4e2bb4eb8a42747f21b13303616 (BUG=24826, now issues.chromium.org/40321210), verbatim: 'we agreed to repeat the header group if it has break-inside:avoid. We make this the default style for theads when printing.' The condition is on the header GROUP (thead), not on its row."
    - "Independent empirical confirmation (blog.dev030.com, headless Chrome): 'adding display: table-header-group to the thead elements didn't do the trick… So I added break-inside:avoid to the thead element and voilà, it worked.'"
    - "Chromium 99124 / 40639169 / 40294997: page-break-*/break-inside on TR and TD are ignored; 'Page breaks happen in the middle of rows or even in the middle of lines of text' — exactly the reported `Joondalup` alone at the top of page 2."
    - "BUILT CSS .next/static/chunks/16uu422xnyx_0.css emits `.report-lines thead{display:table-header-group}` and `.report-lines tr` inside the `break-inside:avoid` group — no `thead` ever receives `break-inside`. Nothing was lost in minification; the authored rules are the shipped rules."
    - "report.css:111 is `.report-figure .report-figure-note { … display: block }` — a descendant selector. page.tsx:297 puts `report-figure-note` on a span whose ancestors are td -> tr -> tbody -> table.report-lines -> .table-scroll. No `.report-figure` ancestor exists, so display:block never applies. globals.css:72 `.muted` sets only color. The span computes to display:inline."
    - "Differential WITHIN the same file: page.tsx:238 uses the identical class on a span that IS inside <div className='report-figure'> (line 229) -> there it DOES get display:block. Same class, two call sites, one silently inert — which is why it was never noticed."
    - "Differential against the established codebase pattern: clients/[id]/page.tsx:402 renders the same job-number-plus-description shape as <strong> + <span className='cell-truncate'>, and `.cell-truncate` (globals.css:257-263) IS display: block — the pattern the report page was supposed to reuse. 07-UI-SPEC line 261 even says '`.cell-truncate` stays one line in print', showing `.cell-truncate` was the intended class."
    - "Contract origin: 07-UI-SPEC.md:261 and 07-04-PLAN.md:191 both prescribe, verbatim, `.report-lines thead { display: table-header-group }` annotated '(headers repeat on page two)' and `break-inside: avoid` on `.report-lines tr`. The implementation is a faithful execution of a plan that encoded a false belief about Chromium."
  falsification_test: "In desktop Chrome DevTools on the deployed report, emulate print media and (a) add `break-inside: avoid` to `.report-lines thead` — if the header still does not repeat on page 2, cause 1 is wrong; (b) inspect the computed `display` of the Job-cell description span — if it already computes to `block`, cause 3 is wrong; (c) check the computed `overflow-x` of `.table-scroll` under print emulation — if it is `auto` rather than `visible`, the diagnosis shifts to the monolithic-container alternative below and NO thead CSS will help."
  fix_rationale: "Cause 1 and 3 are fixed by making the CSS say what the contract meant: add `break-inside: avoid` to `.report-lines thead` (the actual repeat trigger; keep `display: table-header-group` or drop it as the no-op it is), and put the description in a real block box — reuse `.cell-truncate` as the spec intended, which simultaneously supplies the missing line break AND caps the Job column at 16rem, relieving the FOLLOW-UPS starvation. Cause 2 cannot be fixed in CSS at all in the designated browser; it needs an explicit acknowledgement in the contract (accept mid-row breaks, or restructure so cells are single-line so a row is one line box and cannot straddle). Fixing 3 alone already makes most rows one or two lines, which shrinks but does not eliminate cause 2 — that is a mitigation, not a fix, and must be recorded as such."
  blind_spots: "Not reproduced in a live browser — diagnosis is static analysis of the built CSS plus primary-source browser behaviour, no print render performed (context forbids modifying source and the page is deployed/remote). The `.table-scroll` cascade conclusion (report.css wins -> overflow: visible in print) rests on Next.js App Router emitting root-layout CSS before page CSS and on the route's client-reference-manifest listing the globals chunk before the report chunk; it was NOT verified against the deployed page's actual <link> order. If that conclusion is wrong the whole picture changes (see Eliminated). Chrome version used by the operator is unknown; the tr/td break bug is long-standing but a very recent Chromium change could alter it. The exact column widths driving the FOLLOW-UPS wrap are reasoned from auto-table-layout behaviour, not measured."
  candidate_causes:
    - "code (CSS selector scope): `.report-figure .report-figure-note` is descendant-scoped and cannot match inside a table cell — cause 3"
    - "code (CSS property target): `break-inside: avoid` applied to `tr` instead of `thead`; `display: table-header-group` is a no-op — cause 1"
    - "code (markup/JSX): newline whitespace between the `#{id}` text node and the description span is stripped by JSX — cause 3's second half"
    - "environment (browser engine): Chromium ignores break-inside on tr/td (99124, open since 2011) — cause 2, unfixable in CSS"
    - "process (design contract): 07-UI-SPEC:261 and 07-04-PLAN:191 specified the wrong rules; implementation and code review both matched code to spec, so no gate could catch it"
    - "data: 20 attribution lines with 60-codepoint descriptions — the first report that exceeded one page, so no earlier print exercised any of this"
  and_gate: "yes, for the row split. Cause 2 alone is latent — Chromium ignores tr break-inside on every table in the product, but a row only straddles a fold when it is tall enough to reach one. The `#4208` row is 3-4 line boxes tall ONLY because cause 3 merged `#4208` and the 47-character description into one inline run. So the visible split required (Chromium tr limitation) AND (tall cell from cause 3) AND (20 lines of data pushing the table past page 1). Causes 1 and 3 are each independently sufficient for their own symptoms and do not need the AND-gate. Note the topology: cause 3 is a HUB — it produces the missing separator, amplifies the row split, and starves the FOLLOW-UPS column; fixing it alone resolves two-and-a-half of the four artifacts."

## Symptoms
<!-- Written during gathering, then IMMUTABLE -->

expected: Page one holds the hero, the six figures and the totals; the per-job table flows to later pages with the column header (Job / Customer / Won / Follow-ups / Replies / Gross / Conservative) repeated at the top of each continuation page; no single row is split across a page fold; the Job cell reads `#4201` followed by the description on its own line (or with a clear separator), not `#4201Switchboard upgrade and RCD replacement`.
actual: From the user's 4-page PDF (desktop Chrome, default print settings) - the header row appears only on page 1; pages 2 and 3 start directly with data rows; row `#4208 Outdoor power and lighting for alfresco, Joondalup` is split - its first three lines are at the bottom of page 1 and the word `Joondalup` is alone at the top of page 2; every Job cell renders the number and description with no space or line break between them (`#4201Switchboard upgrade...`, `#4203Kitchen renovation...`); the `FOLLOW-UPS` header wraps as `FOLLOW-` / `UPS` and its cells wrap as `2 (1` / `Aug-1` / `Aug)`. The totals row and footnotes landed correctly on page 3.
errors: None reported
reproduction: Test 2 in UAT - test tenant 13e8f2aa-edee-4eb1-b699-09b650674f81 has an August 2026 report with 20 attribution lines (report 2240704d-c755-4d55-ac1b-04fa09082331, and a version 2); open it logged in as operator and Print -> Save as PDF from desktop Chrome.
started: Discovered during Phase 7 UAT on the first real multi-page print of the deployed page (commit 7c10104 plus the fix(07) commits).

## Eliminated
<!-- APPEND only - prevents re-investigating -->

- hypothesis: "`.table-scroll` is still a scroll container in print (globals.css `.table-scroll { overflow-x: auto }` beating report.css's `@media print { .table-scroll { overflow: visible } }` at equal specificity), making the wrapper MONOLITHIC per css-break — which would slice the table at arbitrary offsets, explaining the missing header repetition AND the mid-row split with one mechanism."
  evidence: "Cascade order resolves the other way. The two rules land in SEPARATE built chunks — globals in .next/static/chunks/2tjs39atdy9kq.css (`.table-scroll{overflow-x:auto}`), report.css in .next/static/chunks/16uu422xnyx_0.css (`@media print{....table-scroll{overflow:visible}...}`). globals.css is imported by the ROOT layout (src/app/layout.tsx:3) and report.css by the page (page.tsx:14); Next.js App Router emits layout CSS before page CSS, and the route's page_client-reference-manifest.js lists 2tjs39atdy9kq.css before 16uu422xnyx_0.css. Equal specificity + later source order -> `overflow: visible` wins in print -> not a scroll container -> not monolithic. Independently, causes 1 and 2 each have a documented Chromium mechanism that explains the same evidence without this hypothesis, so it is not needed. RESIDUAL RISK recorded in blind_spots: not verified against the deployed page's live <link> order; the fix planner should confirm computed `overflow-x: visible` under DevTools print emulation before trusting any thead fix."
  timestamp: 2026-09-03T00:44+08:00

- hypothesis: "A flex or grid ancestor breaks Chromium's table fragmentation."
  evidence: "globals.css:57 `main { padding: 1.25rem; max-width: 60rem; margin: 0 auto }` — a plain block. `.report-sheet` (report.css:28) is a plain block. `.table-scroll` (globals.css:249) sets only overflow. There is no flex/grid box anywhere on the ancestor chain from <table class='report-lines'> up to <body>."
  timestamp: 2026-09-03T00:46+08:00

- hypothesis: "The header markup lacks a real `<thead>`."
  evidence: "page.tsx:273-287 is a genuine <thead><tr><th scope='col'>... with all seven headers. Markup is correct; the failure is entirely in which CSS property was applied to it."
  timestamp: 2026-09-03T00:20+08:00

- hypothesis: "The print block is not reaching the browser at all (report.css not loaded, or the @media print rules lost in the build)."
  evidence: "The built chunk .next/static/chunks/16uu422xnyx_0.css contains the complete, intact `@media print{...}` block. And the user's PDF is demonstrably a printed-mode render: console chrome, the back link and the action buttons are all absent, and the sheet is in the forced-light palette — all of which come from that same block."
  timestamp: 2026-09-03T00:40+08:00

## Evidence
<!-- APPEND only - facts discovered -->

- timestamp: 2026-09-03T00:05+08:00
  checked: .planning/debug/knowledge-base.md and .planning/debug/*.md
  found: No knowledge base exists. One prior session, `inbox-badge-layout-phone.md` (status: diagnosed), whose confirmed root cause includes "JSX strips the newline whitespace between the timestamp text node and the first badge span, so with no flex gap the rendered HTML is `...5:55 pm<span>Threaded</span>` — zero separation".
  implication: The missing-separator symptom here is the SAME pattern as a prior diagnosed defect in this codebase — a text node adjacent to a span with JSX-stripped whitespace and no block/gap to save it. Promoted to first hypothesis for symptom 3.

- timestamp: 2026-09-03T00:12+08:00
  checked: src/app/(console)/reports/[client]/[reportId]/report.css lines 268-283 (authored print rules for the table)
  found: Exactly two table-fragmentation rules exist. `.report-lines thead { display: table-header-group }` with the comment "Page two gets the column headers too", and a shared `break-inside: avoid` group listing `.report-hero, .report-figures, .report-figure, .report-lines tr, .report-notes li, .report-footer`. NOTHING applies `break-inside` to `thead`.
  implication: The header-repeat rule and the break-avoid rule target different boxes than Chromium's actual requirements. `display: table-header-group` is the UA default for <thead> and therefore changes nothing.

- timestamp: 2026-09-03T00:18+08:00
  checked: src/app/(console)/reports/[client]/[reportId]/page.tsx lines 288-299 (the Job cell)
  found: The <td> contains `#{line.generatedJobId ?? NO_VALUE}` followed by `{line.jobDescription ? (<span className="muted report-figure-note">{line.jobDescription}</span>) : null}`. The `#{...}` expression and the <span> are separated in source ONLY by a newline plus indentation.
  implication: JSX removes whitespace-containing-a-newline between children, so the DOM has no separating text node. The rendered separation depends entirely on the span being a block box.

- timestamp: 2026-09-03T00:22+08:00
  checked: Every definition of `report-figure-note` and `muted` (grep across src/)
  found: The class is defined in exactly ONE place — report.css:111, as `.report-figure .report-figure-note { ... display: block }` (a descendant selector). globals.css:72 `.muted { color: var(--muted) }` — no display. There is no bare `.report-figure-note` rule anywhere.
  implication: CONFIRMED cause of symptom 3. The Job-cell span's ancestors are td -> tr -> tbody -> table.report-lines -> div.table-scroll -> section.report-sheet — no `.report-figure` among them, so display: block never applies and the span computes to display: inline. Result: `#4201Switchboard upgrade and RCD replacement`.

- timestamp: 2026-09-03T00:26+08:00
  checked: Differential — the other call site of the same class, page.tsx:229-243
  found: <div className="report-figure"><dt>Jobs won</dt><dd>{...}<span className="muted report-figure-note">of {n} won in the month</span></dd></div> — this span IS inside `.report-figure`, so it DOES receive display: block and renders on its own line, correctly.
  implication: The identical class works at one call site and is silently inert at the other. This is why the defect survived review: the class demonstrably works elsewhere on the same page, so reading `report-figure-note` on the table span looks correct.

- timestamp: 2026-09-03T00:31+08:00
  checked: Differential against the established codebase pattern for job-number + description (grep `cell-truncate`)
  found: clients/[id]/page.tsx:402 renders <strong>{job link}</strong> then <span className="cell-truncate" title={...}>{description}</span>. globals.css:257-263 `.cell-truncate { display: block; max-width: 16rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }`. Same pattern at triage-form.tsx:84,87, queue-card.tsx:157, mapping-form.tsx:144. 07-UI-SPEC.md:261 states "`.cell-truncate` stays one line in print (the description is pre-truncated to 60 chars in the frozen line...)".
  implication: `.cell-truncate` is the intended and established class for exactly this shape, and it is display: block. The report page substituted `.report-figure-note` and lost the block display. The UI-SPEC's own print note proves `.cell-truncate` was what the contract expected to be on that element.

- timestamp: 2026-09-03T00:38+08:00
  checked: Built CSS chunks under .next/static/chunks/
  found: Two chunks carry the conflicting rules. `2tjs39atdy9kq.css` (globals, 6010 B) has `.table-scroll{overflow-x:auto}`. `16uu422xnyx_0.css` (report.css, 2056 B) has the full print block including `.table-scroll{overflow:visible}`, `.report-lines thead{display:table-header-group}` and `.report-hero,.report-figures,.report-figure,.report-lines tr,.report-notes li,.report-footer{break-inside:avoid}`.
  implication: The shipped CSS is byte-for-byte the authored CSS — no build/minification transform is involved. Also confirms `thead` never receives `break-inside` in the shipped output.

- timestamp: 2026-09-03T00:44+08:00
  checked: CSS load order — src/app/layout.tsx (root layout) vs page.tsx, and .next/server/app/(console)/reports/[client]/[reportId]/page_client-reference-manifest.js
  found: globals.css is imported only by the ROOT layout (src/app/layout.tsx:3); report.css only by the page (page.tsx:14). The route manifest lists `static/chunks/2tjs39atdy9kq.css` (globals) before `static/chunks/16uu422xnyx_0.css` (report).
  implication: report.css wins the cascade at equal specificity, so `.table-scroll` computes `overflow: visible` in print and is NOT a monolithic scroll container. Eliminates the monolithic-slicing alternative (logged in Eliminated with its residual risk).

- timestamp: 2026-09-03T00:52+08:00
  checked: Chromium primary source — commit 81c0fc6d4e08e4e2bb4eb8a42747f21b13303616 (fetched, BUG=24826, now issues.chromium.org/40321210)
  found: Commit message verbatim — "Display table header groups at the top of each page. FF, IE and Edge all repeat a table header group at the top of each printed page. This area is underspecified but after some discussion in the bug we agreed to repeat the header group if it has break-inside:avoid. We make this the default style for theads when printing."
  implication: CONFIRMED cause of symptom 1. Chromium's trigger for repetition is `break-inside: avoid` computing on the THEAD box. report.css puts it on `.report-lines tr` — a different box (table-row, not table-header-group) — and gives thead only the no-op `display: table-header-group`.

- timestamp: 2026-09-03T00:56+08:00
  checked: Independent empirical confirmation (blog.dev030.com, headless Chrome experiment, fetched)
  found: "The internet told me that I should be good if I used thead elements. But that didn't work. Also adding `display: table-header-group;` to the thead elements didn't do the trick. ... So I added `break-inside:avoid` to the thead element in my table and voila, it worked." Recommended CSS: `thead { display: table-header-group; break-inside: avoid; }`.
  implication: Real-world Chrome does NOT repeat on `display: table-header-group` alone — the author must supply `break-inside: avoid` on the thead explicitly. Exactly the rule missing from report.css.

- timestamp: 2026-09-03T01:02+08:00
  checked: Chromium issues 99124 ("Printed table content does not respect page-break CSS"), 40639169, 40294997 ("Tables print horribly in Chrome")
  found: Chrome does not support page-break-*/break-inside on TR or TD elements; the property is ignored and "page breaks happen in the middle of rows or even in the middle of lines of text". Reported as still unfixed through 2024-2025; reproduced independently downstream (element-plus #13335).
  implication: CONFIRMED cause of symptom 2. `.report-lines tr { break-inside: avoid }` is INERT in Chrome — the browser this product designates as its PDF engine (report.css header: "the browser is the PDF engine"). The observed artifact — three line boxes on page 1 and the single word `Joondalup` on page 2 — is the documented signature: a break inside a row, at a line box, not at a row boundary.

- timestamp: 2026-09-03T01:10+08:00
  checked: Why the Job cell is 3-4 line boxes tall, and the FOLLOW-UPS column starvation
  found: src/core/reporting/generate.ts:67,304-307 truncates jobDescription to DESCRIPTION_MAX = 60 code points at generation. With the span inline (cause 3), the Job cell content is a single continuous inline run of up to ~66 characters (`#4208` + 60 chars). globals.css:222-234 gives the table `width: 100%`, `border-collapse: collapse`, `padding: 0.6rem 0.5rem` per cell; no `table-layout: fixed` and no column widths are set anywhere, so AUTO table layout distributes width by content demand across 7 columns inside an A4 text column of ~182mm (~688px), minus ~112px of cell padding.
  implication: The Job column's max-content demand is inflated by the merged inline run, so auto layout awards it a large share and starves the rest — producing both the `FOLLOW-UPS` header breaking at its hyphen and the `2 (1`/`Aug-1`/`Aug)` cell wrap, and making the Job cell tall enough to straddle the fold. Cause 3 is therefore a HUB: it produces symptom 3, causes the column wrapping, and supplies the height that cause 2 then splits. `.cell-truncate`'s `max-width: 16rem` + `white-space: nowrap` would have capped that demand — another sign it was the intended class.

- timestamp: 2026-09-03T01:20+08:00
  checked: The design contract — .planning/phases/07-attribution-reporting/07-UI-SPEC.md:261 and 07-04-PLAN.md:191
  found: Both prescribe the shipped rules verbatim, including "`.report-lines thead { display: table-header-group }` (headers repeat on page two)" and "`break-inside: avoid` on `.report-hero, .report-figures, .report-figure, .report-lines tr, .report-notes li, .report-footer`". UI-SPEC:262 asserts the page budget: "a month beyond that flows the table to page two with repeated headers — acceptable".
  implication: The implementation is a FAITHFUL execution of the plan. The false belief — that `display: table-header-group` repeats headers and that `break-inside: avoid` works on `tr` — originated in the UI-SPEC and was carried into the plan. No code-review or spec-conformance gate could have caught this, because the code matches the spec exactly; only a real multi-page print could, and Phase 7 UAT is the first one.

## Resolution
<!-- OVERWRITE as understanding evolves -->

root_cause: "THREE independent causes, all reachable from one contract error. (1) HEADER NOT REPEATING — report.css:270-272 applies `display: table-header-group` to `.report-lines thead`, which is a no-op (already the UA default for <thead>), and applies `break-inside: avoid` to `.report-lines tr` (report.css:276-283) but never to `thead`. Chromium repeats a header group only when `break-inside: avoid` computes on the THEAD box itself (commit 81c0fc6, BUG=24826/issue 40321210: 'repeat the header group if it has break-inside:avoid'). The one rule written to make headers repeat does nothing, and the rule that would have is applied to the wrong box. (2) ROW SPLIT — `.report-lines tr { break-inside: avoid }` is inert in Chrome: Chromium has ignored break-inside/page-break-inside on <tr> and <td> since 2011 (issues 99124, 40639169, 40294997, still open), breaking inside rows and even mid-line-box, which is precisely the reported `Joondalup` alone on page 2. This cannot be fixed in CSS in the designated browser. (3) MISSING SEPARATOR — page.tsx:297 gives the description span className='muted report-figure-note', but the only rule granting that class display: block is the DESCENDANT selector `.report-figure .report-figure-note` (report.css:111), and a <td> inside `.report-lines` has no `.report-figure` ancestor, so the span computes to display: inline; JSX then strips the newline whitespace between the `#{generatedJobId}` text node and the span (page.tsx:291-293), leaving zero separation -> `#4201Switchboard upgrade...`. The established class for this shape is `.cell-truncate` (globals.css:257, display: block), used at clients/[id]/page.tsx:402 and named by 07-UI-SPEC:261 itself. AND-GATE: the row split required cause 2 AND cause 3 together — Chromium's tr limitation is latent on every table in the product, but a row only reaches a fold when it is tall, and this row is 3-4 line boxes tall only because cause 3 merged the id and the 47-character description into one inline run. Cause 3 is a hub: it also inflates the Job column's max-content demand under auto table layout, starving FOLLOW-UPS into the `FOLLOW-`/`UPS` and `2 (1`/`Aug-1`/`Aug)` wraps. ORIGIN: causes 1 and 2 were specified in 07-UI-SPEC.md:261 and 07-04-PLAN.md:191 and implemented verbatim — the defect is in the design contract, not in the execution of it."
fix: "NOT APPLIED — goal was find_root_cause_only, and the context forbids modifying source. Suggested direction is in the return payload; plan-phase --gaps owns the fix plan, which must also amend 07-UI-SPEC.md:261-262 and 07-04-PLAN.md:191 or the wrong rules will be re-specified."
verification: "Diagnosis only. Falsification test for any fix: print the 20-line August 2026 report (tenant 13e8f2aa-edee-4eb1-b699-09b650674f81, report 2240704d-c755-4d55-ac1b-04fa09082331) to PDF from desktop Chrome and confirm — the Job/Customer/Won/Follow-ups/Replies/Gross/Conservative header appears at the top of EVERY page carrying data rows; each Job cell shows `#4201` and its description on separate lines; the FOLLOW-UPS column holds `2 (1 Aug-1 Aug)` on at most two lines. Before trusting a thead fix, confirm in DevTools print emulation that `.table-scroll` computes `overflow-x: visible` (see Eliminated — residual risk). Cause 2 needs a separate acceptance decision: verify whether making cells single-line reduces every row to one line box, and if not, record mid-row breaks as accepted technical debt in the contract rather than claiming a fix."
files_changed: []
