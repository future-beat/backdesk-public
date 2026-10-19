---
status: complete
phase: 07-attribution-reporting
source: [07-VERIFICATION.md, 07-06-SUMMARY.md]
started: 2026-09-02T09:38:40Z
updated: 2026-09-05T03:12:52Z
---

## Current Test

[testing complete]

## Tests

### 1. Dark-mode iPhone print of a generated monthly report yields a light A4 PDF
setup: On an iPhone in dark mode, open /reports/<client>/<reportId> for a generated month and use Print → Save as PDF. (BACKSTOP — 07-04, UI-SPEC E6 populated)
expected: A light A4 sheet: white background, dark text, the 'Return on fees' hero in accent blue (#1f6feb), NO nav bar, NO 'Print or save as PDF' button, NO '← client' back link, NO screen-only banner or 'month to date' / 'value unavailable' badges, and no dark background anywhere.
result: pass
note: "User: pass though there is an extra blank page at the end (see PDF) — logged as G-07-1"

### 2. A ~20-line month paginates with the table header repeated and no row split
setup: Seed or pick a month with ~20 attribution lines, generate it, and print to PDF (desktop Chrome/Safari is fine). (BACKSTOP — 07-04, UI-SPEC E6 overflow)
expected: Page one holds the hero, the six figures and the totals; the per-job table flows to page two with the column header (Job / Customer / Won / Follow-ups / Replies / Gross / Conservative) repeated at the top of page two; no single row is split across the page fold; no figure is separated from its label.
result: pass
first_result: issue (2026-09-03) — resolved by 07-06 (G-07-2) and re-verified by tests 4 (iPhone Safari PDF: one-line rows, no split, no blank page; header non-repeat is the accepted WebKit ruling WINDOWS #26) and 5 (desktop Chrome: header on every page)
reported: "From the user-supplied PDF (Monthly report · Quote Recovery.pdf, 4 pages, version 2 of the fixture month): the per-job table header is NOT repeated on pages 2 and 3; row #4208 splits across the page 1/2 fold ('Joondalup' orphaned at the top of page 2); a fourth page is completely blank; the job number runs into the description with no separator ('#4201Switchboard upgrade')."
severity: major

### 3. /reports and /reports/<client> at a 390px viewport
setup: Open /reports at a 390px viewport (or on a phone); then open /reports/<client>. (PLANNER-DEFERRED — 07-05 human-check, end-of-phase)
expected: /reports — the six-column table scrolls sideways INSIDE its box (the page does not widen; nav sign-out stays reachable); any client above 5% opt-out sits FIRST with a red 'above 5%' badge beside its number. /reports/<client> — six metric rows under 'Last 30 days'; badge and evidence text wrap UNDER the value rather than overflowing; for a client with no fee schedule the Recovery multiple row reads '—' with 'no fee schedule — add one below' and the link jumps to the Fee schedule disclosure.
result: pass
first_result: issue (2026-09-03) — resolved by 07-06 (G-07-3, nav wraps) and re-verified by test 6 after the 07-06 and 07-07 deploys (page never widens; the Clients table follow-up G-07-6 closed by 07-07)
reported: "pass, though the page widens for another reason: the Email and Sign out buttons on the top bar do not scroll (the console nav overflows at 390px instead of wrapping, so the page becomes wider than the viewport)"
severity: minor

### 4. iPhone Safari re-print of the fixture report after the 07-06 deploy
setup: After the deploy is Ready, open /reports/13e8f2aa-edee-4eb1-b699-09b650674f81/2240704d-c755-4d55-ac1b-04fa09082331 on the iPhone and Print → Save as PDF.
expected: Light A4 sheet, 2–3 pages, NO blank last page; every job row is ONE line reading "#4201 · Switchboard upg…" (the ~22 code-point clip is the recorded engine limit, WINDOWS #28); Follow-ups reads like "2 · 1–4 Aug"; no row split across a fold. Known and recorded: iPhone Safari does NOT repeat the column header on page 2 (WINDOWS #26) — do not fail on that.
result: pass
reported: "the print button is not working" — then, on retry with the PDF attached: "It's working (see PDF)"
note: "PDF evidence (Monthly report · Quote Recovery 2.pdf, Creator Safari, Producer iOS 26.5.2 Quartz PDFContext, A4 595×842pt, 2 pages, fixture version 3): one-line rows '#4201 · Switchboard upgrade an…' (~25 code points survive — above the 22 floor), Follow-ups '2 · 1–1 Aug', row #4230 and the Total row whole at the top of page 2, footnotes and footer on page 2, NO blank page, header not repeated on page 2 (WINDOWS #26, expected). Cosmetic observation not raised by the user: when both touches fall on the same day the range prints as '1–1 Aug' (fixture artefact — touches clamped to 1 Aug — but a real one-day cadence would print the same); a same-day range should collapse to '1 Aug'. The first button press did nothing and the second worked; cause of the first miss unknown (see G-07-4)."

### 5. Desktop Chrome re-print of the same report
setup: Same URL on desktop Chrome, Print → Save as PDF, default margins.
expected: Column header repeated at the top of every page that carries rows; one-line rows; no blank last page; totals and footnotes on the final page.
result: pass

### 6. Console bar at 390px after the deploy
setup: /reports on a phone or a 390px viewport.
expected: No sideways scroll of the page; the top bar wraps (three lines at 390px); every nav control including Sign out is a comfortable 44px tap target. The bar is taller than before (about 176px at 390px, 72px on desktop) — that is the recorded price of the 44px rule; judge whether it is acceptable.
result: pass
reported: "the Clients table after login widens the page unlike the Reports table" — then, after the 07-07 deploy (2026-09-04): "test 6 passed, wouldn't it be better if the nav bar scrolls sideways instead of having two rows?"
severity: major
note: "Passed on re-check after 07-07. The operator questioned the wrapped bar's height and asked whether a single sideways-scrolling row would be better — a design question about the G-07-3 fix, not a defect; answered in-session and to be queued as a quick task if chosen."
note: "Implicitly the /reports table and the wrapped bar behave (\"unlike the Reports table\"); the widening now comes from the Clients table on the post-login landing page (/), which has no .table-scroll wrapper. The bar height was not commented on."

### 7. The 06:30 Perth digest is actually delivered
setup: Check the operator inbox after 06:30 AWST (22:30 UTC) — carried forward from the Phase 6/7 verification; no UAT has covered delivery.
expected: The stalled-drafts digest email arrives; if any client is above the 5% opt-out threshold or the attribution cursor is wedged, the corresponding one-line section appears; otherwise those sections are absent (not empty headings).
result: pass
reported: "digest has not arrived yet" (09:13 AWST, 4 Sep)
note: "Correct by design, and the expectation above was mis-stated: the digest is NOT sent when there is nothing to report. Evidence (read-only production probe, 4 Sep): pg_cron job stalled-digest (30 22 * * *) ran at 2026-09-03T22:30:00Z = 06:30 AWST and succeeded; pg_net recorded the route's HTTP 200 body {tenantsAffected:0, touchesStalled:0, digestSent:0, digestFailed:0, digestSkippedEmpty:1}. src/core/aging/stalled-digest.ts:211-223 skips the send when touchesStalled === 0 and every section (opt-out drift, wedged attribution cursor) is empty — 'an unsent digest is how this route says there is nothing waiting on you'. The 'absent sections' half of the truth is therefore satisfied vacuously; the delivery half (a non-empty digest reaching the inbox through Resend) is exercised by the Phase 6 stalled-digest tests and the prior-day run history, not by this observation. Operator note: on quiet days no email arrives; silence cannot be told apart from a broken sender — consider a weekly heartbeat line (not queued; raise if wanted)."
delivered: "2026-09-05 06:30 AWST — the digest DID arrive (operator PDF 'Daily digest 0 drafts still waiting.pdf', From Quote Recovery <onboarding@resend.dev>): body = 'Nothing is waiting on you — no unapproved message is inside 4h of its send slot.' + section 'Opt-out rate above 5%: Perth Sparks Electrical (Test): 100.0% (1 of 1 contacts) in the last 30 days.' + 'As at 2026-09-04 22:30:01 UTC' + queue link; NO wedged-cursor heading (absent, not empty) — the full truth of this test observed on real delivery. Why 5 Sep and not 4 Sep: the 4 Sep fixture teardown removed 21 fictional touched contacts from the 30-day denominator, so the one real contact reached on 29 Aug (the Phase 4/6 live STOP test: delivered SMS, then STOP → suppressed; the other 29 Aug send was undelivered and is excluded by sentInWindow) went from 1/22 = 4.5% to 1/1 = 100%, crossing the 5% line. The figure is honest and will leave the window on 28 Sep. Verified read-only against send_ledger / suppressed_contacts."

## Summary

total: 7
passed: 7
issues: 0   # tests 2 and 3 were issues on 2026-09-03 (G-07-1/2/3); resolved by 07-06 and re-verified by tests 4–6, so they now record pass with their first result kept
pending: 0
skipped: 0
blocked: 0

## Gaps

- gap_id: G-07-1
  truth: "Printing the monthly report yields exactly the pages the content needs — no trailing blank page"
  status: resolved
  resolved_by: 07-06-PLAN.md
  resolved_at: 2026-09-03
  reason: "User reported: pass though there is an extra blank page at the end (see PDF). PDF page 4 of 4 is blank apart from the browser header/footer."
  severity: minor
  test: 1
  root_cause: ".report-footer (report.css:154-160) styles a <p> but sets only margin-top, so the UA default margin-block-end: 1em (14px at 0.875rem) survives; in print nothing in the ancestor chain (report-sheet, main, .shell, body) has bottom padding/border, so the margin collapses out to the root and the document is 13.84px taller than its last inked pixel. WebKit paginates for that trailing height (measured: a 14px-wide fold window produces an entirely blank page); Chrome truncates it. The same latent defect exists on .audit-footer (audit.css:87-92)."
  artifacts:
    - path: "src/app/(console)/reports/[client]/[reportId]/report.css"
      issue: ".report-footer leaves the UA bottom margin in place (margin-top longhand only) — the one rule in the file not using the margin shorthand convention"
    - path: "src/app/(console)/audits/[id]/audit.css"
      issue: ".audit-footer has the same latent defect (keeps both UA margins); harmless today only because the audit is one short page"
  missing:
    - "Reset the footer bottom margin (e.g. margin: 1.5rem 0 0, matching .report-hero/.report-figures/.report-notes shorthand convention) in report.css"
    - "Apply the same reset to .audit-footer in audit.css"
    - "Verify on iPhone Safari near a fold (the PDF evidence is WebKit; desktop Chrome cannot reproduce the blank page)"
  debug_session: .planning/debug/report-print-trailing-blank-page.md
- gap_id: G-07-2
  truth: "A ~20-line month prints with the per-job table header repeated at the top of each continuation page, no single row split across the page fold, and no figure separated from its label"
  status: resolved
  resolved_by: 07-06-PLAN.md
  resolved_at: 2026-09-03
  reason: "User reported (via PDF): thead not repeated on pages 2–3; row #4208 split across pages 1–2 (Joondalup orphaned); job number and description run together with no separator (#4201Switchboard upgrade…)"
  severity: major
  test: 2
  root_cause: "Three independent causes, two of them prescribed verbatim by 07-UI-SPEC.md:261-262 and 07-04-PLAN.md:191. (1) Header repeat: report.css:270-272 sets thead { display: table-header-group } which is already the UA default and a no-op; Chromium repeats a header group only when break-inside: avoid computes on the thead itself (Chromium commit 81c0fc6, bug 24826) — the codebase puts break-inside: avoid on tr, a different box. (2) Row split: Chromium has never honoured break-inside/page-break-inside on tr/td (issues 99124, 40639169, 40294997), so .report-lines tr { break-inside: avoid } is inert; a break lands at a line box. (3) Missing separator (the hub cause): page.tsx:297 gives the description span class report-figure-note, whose only block rule is the DESCENDANT selector .report-figure .report-figure-note (report.css:111); inside td there is no .report-figure ancestor so it computes display: inline, and JSX strips the whitespace between #{id} and the span → #4201Switchboard…; the merged ~66-char inline run also starves the other columns under auto table layout (FOLLOW-UPS wrapping) and makes rows 3-4 line boxes tall, which is what exposes cause 2. The two debug agents disagree on which engine produced the PDF (Chrome vs iPhone Safari/WebKit) — the fix must be robust in both and verified in both."
  artifacts:
    - path: "src/app/(console)/reports/[client]/[reportId]/report.css"
      issue: ":111 descendant-scoped .report-figure .report-figure-note; :270-272 no-op display: table-header-group; :276-283 break-inside: avoid on tr instead of thead"
    - path: "src/app/(console)/reports/[client]/[reportId]/page.tsx"
      issue: ":291-298 description span uses report-figure-note (inert in a td) and JSX-stripped whitespace after #{id}"
    - path: ".planning/phases/07-attribution-reporting/07-UI-SPEC.md"
      issue: ":261-262 prescribes the failing print rules verbatim (origin of causes 1 and 2)"
    - path: ".planning/phases/07-attribution-reporting/07-04-PLAN.md"
      issue: ":191 restates the same rules"
  missing:
    - "Add break-inside: avoid to .report-lines thead (the actual Chromium repeat trigger); keep or drop display: table-header-group"
    - "Swap report-figure-note → cell-truncate (the established clients/[id]/page.tsx:402 pattern and what UI-SPEC:261 intended) on the description span, or otherwise give it a block/line break and a capped Job column width, so id and description separate and FOLLOW-UPS stops wrapping"
    - "Decide cause 2 explicitly: drive every cell to a single line box (a one-line row cannot straddle a fold) or record mid-row breaks as accepted debt; a CSS break rule on tr cannot fix it in Chromium"
    - "Amend 07-UI-SPEC.md:261-262 and 07-04-PLAN.md:191 so the wrong rules are not re-specified"
    - "Verify a 20-line print in BOTH desktop Chrome and iPhone Safari; confirm .table-scroll computes overflow visible in print on the deployed page"
  debug_session: .planning/debug/report-table-pagination.md
- gap_id: G-07-3
  truth: "At a 390px viewport the console page never becomes wider than the viewport: the nav wraps to a second line and only the overview table scrolls sideways inside its own box"
  status: resolved
  resolved_by: 07-06-PLAN.md
  resolved_at: 2026-09-03
  reason: "User reported: pass on the table and metric rows, but the page widens for another reason — the Email and Sign out items on the top bar do not scroll (the nav overflows instead of wrapping after the Reports link was added)"
  severity: minor
  test: 3
  root_cause: ".nav and .nav nav in globals.css:104-117 are display: flex with NO flex-wrap declaration (initial nowrap), byte-identical since Phase 01-02 — flex-wrap was never on the nav. A nowrap flex container cannot shrink below its items min-content sum plus gaps (~497px for brand + seven items vs the ~350px content box of a 390px viewport); .shell has no CSS rule and nothing sets overflow-x, so the ~108px surplus lands past the right edge on Email and Sign out and widens the document. Latent since Phase 6 (six items already overflowed by 39px, 72px with the Queue badge); the Reports link added 68px and made it unmissable. 07-UI-SPEC.md:323 signed the E8 overflow row off as covered on a premise (existing flex-wrap nav) that 06-UI-SPEC.md:167 never made."
  artifacts:
    - path: "src/app/globals.css"
      issue: ":104-117 .nav and .nav nav lack flex-wrap: wrap"
    - path: "src/app/(console)/layout.tsx"
      issue: "seven-item nav confirmed; no markup defect"
    - path: ".planning/phases/07-attribution-reporting/07-UI-SPEC.md"
      issue: ":323 false-premise coverage row (cites a Phase 6 wrap rule that does not exist)"
  missing:
    - "Add flex-wrap: wrap to BOTH .nav and .nav nav (on .nav alone the inner nav still cannot wrap and New client / Sign out break mid-phrase); consider gap: 0.5rem 1rem"
    - "While there: button.linkish sets min-height: 0 so Sign out is under the 44px tap target 06-UI-SPEC:51 asserts for the nav"
    - "Correct 07-UI-SPEC.md:323 to name the selector/rule that guarantees the wrap, or mark it backstop"
  debug_session: .planning/debug/console-nav-overflow-390.md
- gap_id: G-07-4
  truth: "Pressing 'Print or save as PDF' on /reports/<client>/<reportId> opens the browser's print dialog (Save as PDF available) on the operator's phone and desktop"
  status: withdrawn
  withdrawn_at: 2026-09-03
  hardened_by: 07-07-PLAN.md
  hardening_note: "07-07 added the press acknowledgement, the beforeprint/afterprint + matchMedia('print') success signals and the 1.5s Share → Print fallback; review CR-01's claim that WebKit lacks the print events was refuted (caniuse beforeafterprint: iOS Safari 13+; WebKit r243762)."
  reason: "User reported: the print button is not working — then on retry: It's working (see PDF). Not reproducible; the iOS Safari PDF attached to test 4 was produced through the button. Kept for the record because the first press silently did nothing; the debug session below records the candidate causes for a silent first miss."
  severity: major
  test: 4
  root_cause: "Transient first-press miss on iPhone Safari (iOS 26.5.2), not a code defect: print-button.tsx is byte-identical to its first commit, the island is in the route's client-reference manifest with onClick:()=>window.print() verbatim in the emitted chunk, no overlay/pointer-events/CSP/manifest, and the second tap on the same page load produced the attached PDF. Ranked causes for one silent tap: (1) WebKit LocalDOMWindow::print() silently DEFERS while any subresource is loading (sets m_shouldPrintWhenFinishedLoading, no dialog, no event) and Next 16's default <Link> prefetch fires ~7 RSC fetches to Sydney right after hydration — the moment the handler first binds — so a print sheet appears once, after the load settles or the second press; (2) iOS swallows the tap that stops momentum scrolling on a button that sits at the bottom of a scrolled page; (3) tap before hydration on a cold cache after the fresh deploy (~177 KB gzip across 10 chunks; pre-hydration clicks are not replayed). The button's header comment ('window.print() is SYNCHRONOUS … nothing to await, no pending state') is false on WebKit mid-load, and that premise is why the first press gave no feedback."
  artifacts:
    - path: "src/app/(console)/reports/[client]/[reportId]/print-button.tsx"
      issue: "No defect; gives no acknowledgement when window.print() is deferred or the tap does not land — header comment asserts a synchronous print that WebKit does not guarantee"
    - path: "src/app/(console)/layout.tsx"
      issue: "Seven default-prefetch <Link>s (plus the conditional 'Open version N →' link beside the button in page.tsx) supply the in-flight requests that arm WebKit's print deferral"
  missing:
    - "On click show an 'Opening print…' acknowledgement and start a ~1.5s timer; clear both on beforeprint; if the timer fires first show the inline fallback ('Nothing opened? On iPhone use Share → Print; on desktop press ⌘P / Ctrl+P') and keep the button live"
    - "Optionally prefetch={false} on the version link inside .report-actions; correct the header comment"
    - "Settling question for the operator if it recurs: did the sheet come up by itself a second or two after the first tap, or only after the second tap, and were you still scrolling?"
  debug_session: .planning/debug/report-print-button-inert.md
- gap_id: G-07-6
  truth: "At a 390px viewport no console page becomes wider than the viewport: every wide table scrolls sideways inside its own box, including the Clients table on the post-login landing page"
  status: resolved
  resolved_by: 07-07-PLAN.md
  resolved_at: 2026-09-04
  resolution_note: "All nine console table boxes wrapped (four were missing), keyboard-reachable (tabIndex/role/aria-label, review WR-03), guarded by a layout-contract gate over all of src/app and by 07-06-harness/tables-check.sh (RESULT: PASS — every page 390px wide at a 390px viewport). Awaits the operator's phone check after the deploy (UAT re-check of test 6)."
  reason: "User reported: the Clients table after login widens the page unlike the Reports table"
  severity: major
  test: 6
  root_cause: "src/app/(console)/page.tsx:154 renders the seven-column Clients <table> as a bare child of <section> with no .table-scroll wrapper, and never has in any of the file's five commits (19828d8..58307c9). An auto-layout table's used width is max(specified, min-content), so table { width: 100% } cannot go below its min-content floor — 447.7px for the seven padded uppercase header cells alone, 599.6px with realistic rows — against the 350px content box main offers at 390px; section, main (max-width 60rem), .shell (no rule) and html/body all leave overflow visible, so the surplus becomes viewport scrollable overflow. Measured in headless Chrome 152 over the real globals.css at 390px: scrollWidth 620 bare; 390 with the identical markup inside div.table-scroll; 390 for /reports. The G-07-3 nav fix did not change the width of / — the table (620) was already wider than the overflowing nav (502); the fix only removed the operator's other explanation for the sideways scroll. Unambiguous since 02-04 (d113b8e) took the table to six columns with a nowrap health pill; 06-02 added the seventh. The contract chain cited a wrapper that never existed (06-UI-SPEC:182, 06-02-PLAN:159/162, 07-UI-SPEC:242,319, the comment at reports/page.tsx:146) and no gate ever probed / with a scrollWidth check. Three more unwrapped tables share the path and overflow conditionally: clients/[id]/page.tsx:1045 sync runs (437 when a 'response parse error' pill renders), audits/[id]/mapping/mapping-form.tsx:73 (408 with realistic ServiceM8 export headers), audits/page.tsx:105 (390.1 with a 19-character unbreakable business name)."
  artifacts:
    - path: "src/app/(console)/page.tsx"
      issue: ":154 seven-column Clients table with no .table-scroll wrapper — unconditional overflow below 640px (PRIMARY)"
    - path: "src/app/(console)/clients/[id]/page.tsx"
      issue: ":1045 unwrapped sync-runs table; overflows on parse_error runs"
    - path: "src/app/(console)/audits/[id]/mapping/mapping-form.tsx"
      issue: ":73 unwrapped mapping table inside the 30rem form; overflows on realistic CSV headers (the :127 preview table is already wrapped)"
    - path: "src/app/(console)/audits/page.tsx"
      issue: ":105 unwrapped audits list; at the edge with long business names"
    - path: "src/app/globals.css"
      issue: ":292-321 table { width: 100% } floor and the .table-scroll rule — correct as-is, no CSS change needed"
    - path: ".planning/phases/06-review-console-escalation/06-UI-SPEC.md"
      issue: ":182 asserts 'the table stays inside .table-scroll' for a client list that was never wrapped"
    - path: ".planning/phases/07-attribution-reporting/07-UI-SPEC.md"
      issue: ":242 and :319 cite the client-list wrapper as convention/precedent; it does not exist"
    - path: "src/app/(console)/reports/page.tsx"
      issue: ":146-148 comment names the client list as the precedent for .table-scroll"
  missing:
    - "Wrap each of the four unwrapped tables in <div className=\"table-scroll\"> in one pass (same class, no CSS change); measured to put / at exactly 390. Do NOT use overflow-x: hidden on main/.shell (clips the Status column unreachably) or table-layout: fixed (wraps uppercase headers mid-word)"
    - "Add a third describe to tests/layout-contract.test.ts: for every src/app/(console)/**/*.tsx with comments stripped, count of '<table' equals count of '<div className=\"table-scroll\">\\s*<table' — fails today on exactly the four files and would have caught this at 06-02"
    - "Extend 07-06-harness with a /-page fixture asserting docScrollWidth === 390 (scratchpad g076/gen-tables.mjs is a ready starting point)"
    - "Correct 06-UI-SPEC:182, 07-UI-SPEC:242/319 and the reports/page.tsx:146 comment to cite the quotes table (02-05, 8de755c) as the precedent"
  debug_session: .planning/debug/clients-table-widens-page-390.md
