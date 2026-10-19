---
status: resolved
trigger: "G-07-1 report-print-trailing-blank-page — Printing the Phase 7 monthly report page (/reports/[client]/[reportId]) to PDF from desktop Chrome produces one extra, completely blank final page (page 4 of 4)."
created: 2026-09-03T00:00:00Z
updated: 2026-09-03T00:00:00Z
resolved: 2026-09-05
resolution: "Resolved by 07-06-PLAN.md (footer margin reset; UAT tests 4 and 5 pass — no blank page on iPhone Safari or desktop Chrome)"
---

## Current Focus

bug_class: Bohrbug — deterministic per (engine, content length). Latent on Chrome, manifest on WebKit. The reported "desktop Chrome" in the brief is WRONG: the UAT record and two co-reported symptoms prove the PDF came from iPhone Safari (WebKit).
hypothesis: |
  `.report-footer` is a <p>. report.css sets its margin-TOP but never resets the
  UA default `margin-block-end: 1em` (= 14px at its 0.875rem font-size). With
  `main`, `.report-sheet`, `.shell` and `body` all at zero bottom padding/border
  under @media print, that 14px margin COLLAPSES outward to the root, making the
  document 13.84px taller than its last inked pixel. WebKit does not truncate
  that trailing margin, so when the footer's bottom lands within 14px of the
  final fold it emits an entirely blank extra page.
test: WebKit fold sweep with the UNMODIFIED css — shift .report-sheet padding-top across a full page cycle and look for last pages with 0 characters
expecting: a blank final page in a window ~14px wide per page cycle (~1.4% of alignments); Chrome must show none (already confirmed: 0/205)
next_action: run wksweep.sh across 0..1020 and confirm a blank window appears with no injected margin

## Symptoms

expected: The printed A4 PDF contains exactly the pages the content needs — hero, six figures, per-job table, methodology footnotes, footer — and nothing after the footer.
actual: A fourth page is entirely blank after the page holding the totals row, the five footnotes and the `Quote Recovery · August 2026 · prepared 3 Sept 2026 · version 2` footer line. The report body itself printed correctly (light background, accent hero, no nav/buttons).
errors: None reported
reproduction: Test 1 in UAT — generate a month for tenant 13e8f2aa-edee-4eb1-b699-09b650674f81, report 2240704d-c755-4d55-ac1b-04fa09082331 (or version 2), open report page as operator, Print → Save as PDF in desktop Chrome with default margins.
started: Discovered during Phase 7 UAT on the first real print of the deployed page (commit 7c10104 + 14 fix(07) commits).

## Eliminated

- hypothesis: A height-forcing ancestor (min-height / 100vh / flex column on .shell, main, body or html) pushes the document past the fold.
  evidence: globals.css has NO `.shell` rule at all and no min-height/vh anywhere in the shell chain; measured heights of .report-sheet/main/.shell/body are all identical (4258.16px) and driven purely by content.
  timestamp: T2

- hypothesis: The hidden `.report-actions` section still occupies a box that pushes past the fold.
  evidence: measured in print media — computed `display: none`, bounding rect 0x0. Same for `.nav`. A display:none box contributes no height and no margin.
  timestamp: T4

- hypothesis: The `.table-scroll { overflow: visible }` print override loses the cascade, leaving a scroll container that is monolithic in fragmentation.
  evidence: (a) measured computed `overflow: visible` in print; (b) production build manifest lists the globals chunk BEFORE the report chunk, so report.css wins; (c) forcing `overflow-x: auto` back on in Chrome produced byte-identical page counts, so it is not even a page-count factor there.
  timestamp: T8

- hypothesis: Desktop Chrome produced the reported blank page.
  evidence: exhaustive fold sweep — 205 alignments over a full page cycle in Chrome 152 — produced ZERO blank trailing pages; and Chrome repeats the table header and honours `break-inside: avoid` on rows, which the user's PDF demonstrably does NOT. The UAT setup line for the test that produced the PDF reads "On an iPhone in dark mode".
  timestamp: T7

## Evidence

- timestamp: T0
  checked: .planning/debug/knowledge-base.md
  found: File does not exist; only prior session is inbox-badge-layout-phone.md (unresolved, unrelated symptom domain)
  implication: No known-pattern shortcut. Investigate from first principles.

- timestamp: T1
  checked: src/app/(console)/reports/[client]/[reportId]/report.css (full)
  found: Print block hides .nav/.report-actions/.report-backlink/.banner-error/.report-screen-note/button/form with display:none !important; sets @page {size A4; margin 14mm}; main {padding:0; max-width:none}; .report-sheet {max-width:none; padding-top:0}. No break-before/break-after anywhere. break-inside:avoid on hero, figures, figure, tr, notes li, footer.
  implication: No explicit forced break. Blank page must come from a laid-out box extending past the last content, or from a height rule (min-height/height:100%) on an ancestor.

- timestamp: T2
  checked: src/app/globals.css (main/body/html/.shell/table rules), src/app/layout.tsx, src/app/(console)/layout.tsx, print-button.tsx
  found: `.shell` has NO css rules at all. `main { padding: 1.25rem; max-width: 60rem; margin: 0 auto }`. `html, body { margin:0; padding:0 }`. No min-height, no 100vh, no flex column anywhere in the shell. No @vercel/analytics or speed-insights in package.json. Root layout renders only <html><body>{children}</body></html>.
  implication: No height-forcing ancestor. The trailing page cannot come from a min-height/100vh rule.

- timestamp: T3
  checked: Built a faithful standalone repro (same DOM as page.tsx, <link>ing the REAL globals.css + report.css) and printed it with headless Chrome 152 (`--print-to-pdf`, A4 honoured via @page).
  found: Harness works — page counts and per-page text extract correctly. Sweeping row counts N=20..50 and sweeping the fold position (`.report-sheet{padding-top:Npx}`) in 2px steps across the footer's page transition produced NO blank trailing page at any alignment tested so far.
  implication: The obvious "trailing margin spills past the fold" story does not, on its own, produce a blank page — Chrome appears to truncate the collapsed trailing margin at the end of the fragmentation flow.

- timestamp: T4
  checked: Direct measurement of the PRINT-media layout via Chrome DevTools Protocol (Emulation.setEmulatedMedia media=print, viewport 688x1017 = A4 content box at 14mm margins), reading getBoundingClientRect + computed styles.
  found: |
    documentElement.scrollHeight = 4272.16
    body height                  = 4258.16
    .report-footer bottom        = 4258.16  (last inked element)
    .report-footer computed      margin-top 24px, margin-bottom 14px, padding-bottom 0
    main computed (print)        padding 0, max-width none   <- report.css print rules DO win over globals.css
    .report-sheet computed       padding-top 0, padding-bottom 0, margin-bottom 0
    .table-scroll overflow       visible                      <- print override applied
    .report-actions display      none  (rect 0x0)
    .nav display                 none  (rect 0x0)
    TRAILING GAP AFTER LAST INK  = 13.84px
  implication: |
    There IS a systematic 13.84px of zero-ink height at the end of every printed
    report. Its source is `.report-footer`, a <p>: report.css sets margin-top but
    never resets the UA default `margin-block-end: 1em` (= 14px at the element's
    0.875rem font-size). Because `.report-sheet`, `main`, `.shell` and `body` all
    have zero bottom padding/border in print, that bottom margin COLLAPSES
    outward through all four ancestors to the root — which is exactly why
    documentElement is 14px taller than body.
    The audit sheet has the identical defect (`.audit-footer` is also a <p> with
    only padding-top set) but never shows it: its content is one short page with
    ~half a page of slack, so its 14px can never land near a fold.

- timestamp: T5
  checked: .planning/phases/07-attribution-reporting/07-UAT.md — the ORIGINAL UAT record behind this gap
  found: |
    Test 1 (the test that produced the PDF) setup reads: "On an iPhone in dark
    mode, open /reports/<client>/<reportId> and use Print -> Save as PDF."
    NOT desktop Chrome. The SAME artifact ("Monthly report · Quote Recovery.pdf,
    4 pages, version 2") is cited under gap G-07-2, which reports THREE further
    defects in it:
      * the per-job table header is NOT repeated on pages 2 and 3
      * row #4208 SPLITS across the page 1/2 fold ('Joondalup' orphaned)
      * '#4201Switchboard upgrade' — job number runs into the description
  implication: |
    report.css explicitly declares `.report-lines thead { display: table-header-group }`
    and `.report-lines tr { break-inside: avoid }`. A browser that honoured them
    could not produce those two symptoms. The engine that made this PDF ignores
    both -> it is NOT Chrome. The iPhone setup says WebKit.

- timestamp: T6
  checked: Printed the identical repro through a real WebKit print pipeline (Swift + WKWebView.printOperation, A4, 14mm margins) and compared page-by-page against Chrome 152.
  found: |
    WebKit page 2 begins directly with a data row ("#1203Replace Customer3") —
    NO repeated column header. Chrome's page 2 begins with the full repeated
    header row (JOB CUSTOMER WON FOLLOW-UPS REPLIES GROSS CONSERVATIVE).
    WebKit also renders "#1203Replace hot water system…" run together, exactly
    like the user's "#4201Switchboard upgrade".
  implication: |
    Two independent symptoms from the user's PDF reproduce in WebKit and do NOT
    reproduce in Chrome. The PDF was produced by WebKit (iPhone Safari), not by
    desktop Chrome as the bug brief states. Any fix must be verified in Safari.

- timestamp: T7
  checked: DECISIVE EXPERIMENT — does the engine truncate a trailing collapsed margin at the end of the fragmentation flow? Injected a large trailing margin and a large trailing padding, printed both engines.
  found: |
    WebKit:  baseline                     -> 5 pages, last page 518 chars
             .report-footer margin-bottom:900px -> 6 pages, last page 0 chars  (BLANK)
             .report-sheet padding-bottom:900px -> 6 pages, last page 0 chars  (BLANK)
    Chrome:  exhaustive fold sweep, .report-sheet padding-top shifted 0..1020px
             in 5px steps (205 alignments, a full page cycle) -> ZERO blank
             trailing pages at any alignment.
  implication: |
    WebKit does NOT truncate a trailing margin — it pages for it, producing a
    genuinely empty final page (0 characters). Chrome DOES truncate it, which is
    why the defect is invisible on desktop Chrome and why the repro would not
    reproduce until the engine was switched. The 13.84px measured in T4 is
    therefore a real page-producing quantity in the engine that printed the PDF.

- timestamp: T8
  checked: Production build output — `npm run build`, then the emitted CSS chunks and the report route's chunk order (`.next/server/app/(console)/reports/[client]/[reportId]/page_client-reference-manifest.js`).
  found: |
    globals chunk (2tjs39atdy9kq.css) is listed BEFORE the report chunk
    (16uu422xnyx_0.css) — so report.css's @media print rules DO win the cascade
    in production. The minified print block is intact and complete:
      main{max-width:none;padding:0} .table-scroll{overflow:visible}
      .report-lines thead{display:table-header-group}
      ...{break-inside:avoid}
    And the shipped footer rule is, verbatim:
      .report-footer{border-top:1px solid var(--line);color:var(--muted);
                     margin-top:1.5rem;padding-top:1rem;font-size:.875rem}
    — margin-TOP only. No margin-bottom. The UA <p> `margin-block-end: 1em`
    survives into production.
  implication: |
    ELIMINATES the "CSS load-order inversion" hypothesis. Nothing else in the
    document contributes trailing zero-ink height; the 13.84px measured in T4 is
    the whole of it, in production.

- timestamp: T9
  checked: Margin-collapse chain, measured element by element from .report-footer up to <html> (print media).
  found: |
    P.report-footer  margin-bottom 14px  padding-bottom 0  border-bottom 0
    SECTION.report-sheet  padding-bottom 0  border-bottom 0  overflow visible  height 4258.16
    MAIN                  padding-bottom 0  border-bottom 0  overflow visible  height 4258.16
    DIV.shell             padding-bottom 0  border-bottom 0  overflow visible  height 4258.16
    BODY                  padding-bottom 0  border-bottom 0  overflow visible  height 4258.16
    HTML                                                                        height 4272.16
  implication: |
    Four identical heights then a 14px jump at the root. Nothing in the ancestor
    chain (no bottom padding, no bottom border, no overflow other than visible,
    no bottom margin of its own) can stop the collapse, so the footer's bottom
    margin propagates all the way out and lands as 14px of trailing height on
    the document itself.

- timestamp: T10
  checked: |
    THE CONFIRMING EXPERIMENT. Minimal document (real globals.css + real
    report.css, `.report-sheet` containing one fixed-height spacer + the real
    <p class="report-footer">), spacer height swept in 2px steps across a page
    fold, printed through real WebKit (WKWebView.printOperation, A4, 14mm).
  found: |
    A) UNMODIFIED report.css:
       spacer 862..876 -> 1 page
       spacer 878..890 -> 2 pages, LAST PAGE 0 CHARACTERS (entirely blank)
       spacer 892..900 -> 2 pages, last page 54 chars (the footer, legitimately moved)
       The blank window is 878..891 = EXACTLY 14px wide.
    B) SAME sweep, one declaration added — .report-footer { margin-bottom: 0 }:
       spacer 862..890 -> 1 page, no blank
       spacer 892..900 -> 2 pages, last page 54 chars (UNCHANGED)
    C) SAME sweep, Chrome 152: 1 page throughout 862..900. No blank at any height.
  implication: |
    The blank window is exactly the width of the footer's un-reset bottom margin,
    it disappears when that margin is reset, and legitimate pagination (the 892
    boundary) is untouched by the fix. Root cause CONFIRMED and fix direction
    VERIFIED. Chrome never shows it because Chrome truncates the trailing margin.

- timestamp: T11
  checked: Computed `display` of `.report-figure-note` in each of its two usages (print media).
  found: |
    In the figure grid  -> display: block   (has a .report-figure ancestor)
    In a table cell     -> display: INLINE  (no .report-figure ancestor)
    The rule is `.report-figure .report-figure-note { display: block; ... }` —
    a DESCENDANT selector. `page.tsx` also uses the class inside <td> for the job
    description, where no `.report-figure` ancestor exists.
  implication: |
    SEPARATE DEFECT, found while investigating, and it is the exact cause of the
    third symptom in G-07-2: '#4201Switchboard upgrade' with no separator. The
    span never becomes a block, so the description runs on from the job number.
    Reproduced verbatim in the WebKit print as '#1203Replace hot water system…'.

## Resolution

root_cause: |
  `.report-footer` in src/app/(console)/reports/[client]/[reportId]/report.css
  (lines 154-160) styles a <p> and sets `margin-top: 1.5rem` but never resets the
  UA default `margin-block-end: 1em`. At the rule's own `font-size: 0.875rem`
  that is 14px (measured 13.84px).

  Under `@media print` the entire ancestor chain — `.report-sheet`
  (padding-top forced to 0, no padding-bottom), `main` (padding forced to 0),
  `.shell` (no rules at all) and `body` (margin/padding 0) — has zero bottom
  padding, zero bottom border, `overflow: visible` and no bottom margin of its
  own. Nothing can stop the collapse, so the footer's bottom margin propagates
  out to the root: documentElement is 4272.16px tall against a body of 4258.16px,
  i.e. the document is 13.84px taller than its last inked pixel, on every print.

  WebKit (iPhone Safari — the engine that produced the reported PDF) paginates
  for that trailing height instead of truncating it. Whenever the footer's bottom
  edge lands in the 14px band immediately before a page fold, WebKit emits one
  entirely blank extra page. Measured directly: the blank window is exactly 14px
  wide and vanishes when the margin is reset.

  Chrome truncates the trailing margin, which is why the defect is invisible on
  desktop and why it survived every prior check.

  SEPARATE DEFECT found en route (cause of G-07-2's '#4201Switchboard upgrade'):
  the rule is `.report-figure .report-figure-note { display: block }` — a
  descendant selector — but page.tsx also uses `.report-figure-note` inside <td>
  for the job description, where no `.report-figure` ancestor exists, so it
  computes `display: inline` and the description runs on from the job number.
fix: NOT APPLIED — goal was find_root_cause_only.
verification: |
  Fix direction pre-verified in the repro, not in the source tree: adding
  `.report-footer { margin-bottom: 0 }` collapses the 14px blank window
  (spacer 878..890 goes from 2 pages/0 chars to 1 page) while leaving the
  legitimate page break at spacer 892 unchanged.
files_changed: []
