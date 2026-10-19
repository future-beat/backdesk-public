---
status: resolved
trigger: "G-07-4 report-print-button-inert — On the deployed console (https://quote-recovery-mvp.vercel.app, production deployment d16scn2x6 = commit 2fb1e3a), pressing the 'Print or save as PDF' button on /reports/<client>/<reportId> does nothing, per the operator. User reported verbatim: 'the print button is not working'."
created: 2026-09-03T00:00:00+08:00
updated: 2026-09-03T23:50:00+08:00
resolved: 2026-09-05
resolution: "Withdrawn — the button worked on retry (iOS Safari PDF, UAT test 4 pass); hardened by 07-07 (press acknowledgement + fallback hint; operator pass 2026-09-04)"
mode: symptoms_prefilled, goal=find_root_cause_only
---

## Current Focus
<!-- OVERWRITE on each update - reflects NOW -->

bug_class: Heisenbug — ONE silent first tap on iPhone Safari (iOS 26.5.2); the second tap on the same page load printed. Not reproducible on demand. SBFL skipped (no failing test, no per-test coverage).
surface: iPhone Safari proper (PDF Creator "Safari", Producer "iOS 26.5.2 Quartz PDFContext") — not a home-screen web app, not WKWebView.
status: DIAGNOSED as a transient first-press miss. No code defect in the handler, the bundle, the CSS or the route tree. Gap G-07-4 is withdrawn in 07-UAT.md; this session records the ranked candidate causes and the fix direction that is correct under all of them.

reasoning_checkpoint:
  hypothesis: "The first tap either (H3) reached window.print() while WebKit's active DocumentLoader still had a subresource in flight — LocalDOMWindow::print() then returns silently, sets m_shouldPrintWhenFinishedLoading, and the ONE sheet appears only when the last subresource completes (coalescing a second press) — or (H1/H2) never reached a bound handler at all (iOS consumes the tap that stops a momentum scroll / overscroll bounce; or the tap landed before ~177KB gz of route JS executed on a cold cache after the fresh deploy)."
  confirming_evidence:
    - "WebKit main: LocalDOMWindow::print() lines 1194-1197 return silently when activeDocumentLoader()->isLoading(); DocumentLoader::isLoading() is true whenever m_subresourceLoaders is non-empty (fetch() loads register via SubresourceLoader::init → addSubresourceLoader); DocumentLoader::removeSubresourceLoader → checkLoadComplete → window()->finishedLoading() → the deferred print fires once — a delayed single sheet, exactly the reported shape."
    - "Next 16.3.2 links.js: shared IntersectionObserver (rootMargin 200px) prefetches every in-viewport <Link> in production immediately after hydration; the console layout renders 7 Links (6 nav + backlink), so a burst of RSC prefetch fetches to Sydney is in flight at precisely the moment the button first becomes clickable."
    - "Second tap on the same page load produced the PDF (UAT Test 4 note) — so the handler bound, window.print() works on this surface, and nothing structural is wrong."
    - "print-button.tsx unchanged since 5d2fba5; HEAD == deployed 2fb1e3a; client-reference manifest lists the island with 3 chunks and the emitted chunk contains onClick:()=>window.print()."
  falsification_test: "Operator answer to one question: 'Did the print sheet appear on its own a moment later, or only after the second press?' / 'Were you still scrolling when you tapped?'. Instrumented: listen for beforeprint and log (a) hydration time, (b) tap time, (c) performance.getEntriesByType('resource') in flight at tap, (d) beforeprint time. H3 predicts beforeprint fires later WITHOUT a second tap; H1/H2 predict no click event at all on the first tap."
  fix_rationale: "None applied (diagnose-only). A fix that is correct under ALL surviving hypotheses does not pick one: give immediate visible acknowledgement that the press was received, and if beforeprint has not fired within ~1.5s of the press, show the inline fallback (Share → Print on iPhone, ⌘P/Ctrl+P on desktop). Under H3 the sheet arrives late and the hint auto-clears on beforeprint; under H1/H2 no acknowledgement appears, which tells the operator the tap did not land and to tap again — no more silent miss."
  blind_spots: "Cannot log in to the deployed console, so the deployed page's exact in-flight request timeline at tap time is unobserved; iOS print-sheet presentation latency (H4) is unmeasured; whether the Test 4 report had a superseding version (which adds a Link — and a prefetch — INSIDE .report-actions next to the button) is unknown."
  candidate_causes:
    - "environment/engine: WebKit LocalDOMWindow::print() defers silently while any subresource loads (H3)"
    - "code/config: Next.js <Link> default prefetch fires a burst of fetches right after hydration — the condition that makes H3 fire on THIS page (AND-gate partner)"
    - "environment/device: iOS consumes the tap that stops a momentum scroll or overscroll bounce; the button is the last element on a page that must be scrolled to reach it (H1)"
    - "environment/network: cold-cache JS (176,959 gz bytes across 10 chunks) after a fresh deploy — tap before hydration is lost; React attaches root listeners only when the runtime executes (H2)"
    - "data: none — the report row is frozen and irrelevant to the button"
  and_gate: "YES for H3: WebKit's deferral is inert unless something is loading, and Next's post-hydration prefetch burst (plus cold-cache fonts/chunks on a fresh deploy) is what keeps isLoading() true in the window when the button first becomes tappable. Neither alone produces the symptom; together they produce exactly one delayed sheet."

hypothesis: see reasoning_checkpoint (H3 ranked first; H1, H2 close behind; H4 latency last)
test: none further possible without operator input or console credentials
expecting: n/a
next_action: return diagnosis; if the orchestrator wants certainty, ask the operator the single settling question recorded under falsification_test
known_pattern_candidate: none (knowledge-base.md does not exist yet)

## Symptoms
<!-- Written during gathering, then IMMUTABLE -->

expected: A tap/click opens the browser's native print dialog with "Save as PDF" available (D-12: the browser is the PDF engine).
actual: User reported verbatim: "the print button is not working". Browser/surface unknown (iPhone Safari, iPhone home-screen web app, desktop Chrome, Claude desktop app's embedded browser, a link preview). Unknown whether anything at all appeared. Earlier in the same UAT the user DID obtain a PDF ("Monthly report · Quote Recovery.pdf") from an iPhone — unknown whether via this button or Safari Share → Print.
errors: None reported.
reproduction: Test 4 in UAT (.planning/phases/07-attribution-reporting/07-UAT.md). Cannot log in to the deployed console (operator credentials); /reports/* answers 307 → /login unauthenticated.
started: Discovered during UAT after the 07-06 gap-closure deploy (ca3d813..2fb1e3a). Unknown whether it ever worked. Recent commits touching the route: 44b0cf8, 38f3855, a947503, ca3d813, 59e7d4b, 71f022a, 57f36f1, 5d2fba5.

## Eliminated
<!-- APPEND only - prevents re-investigating -->

- hypothesis: CSS or an overlay makes the button unclickable on screen (report.css leaking print rules, pointer-events, zoom block)
  evidence: All hiding/zoom rules are inside a balanced @media print block; no pointer-events/z-index/positioned element in report.css; the SECOND tap on the same page opened the print sheet (UAT Test 4 note), which a CSS blocker could not allow.
  timestamp: 2026-09-03T23:27+08:00
- hypothesis: The island is missing from the route's client bundle / hydration never binds the handler on this route
  evidence: Local production build lists print-button.tsx in page_client-reference-manifest.js with three chunks and window.print() is in the emitted chunk; the second tap printed, so the handler was bound on that page load.
  timestamp: 2026-09-03T23:27+08:00
- hypothesis: window.print() is a silent no-op because the operator was in a home-screen (standalone) web app or a WKWebView-based in-app browser
  evidence: The PDF that the button produced on retry carries Creator "Safari" / Producer "iOS 26.5.2 Quartz PDFContext"; the console declares no manifest / apple-mobile-web-app meta. Under standalone or WKWebView the SECOND tap would have been just as silent.
  timestamp: 2026-09-03T23:27+08:00

## Evidence
<!-- APPEND only - facts discovered -->

- timestamp: 2026-09-03T23:20+08:00
  checked: print-button.tsx, page.tsx:14-15,423-439
  found: Component is a 'use client' island with zero imports; `<button type="button" onClick={() => window.print()}>`; rendered inside `<section className="report-actions">` after the sheet. Unchanged since its first commit 5d2fba5 (git log --follow shows one commit). HEAD == 2fb1e3a == deployed commit.
  implication: No code change in the 07-06 deploy touched the button; if it is inert it is by environment, timing, or hydration — not by a regression in the handler.
- timestamp: 2026-09-03T23:22+08:00
  checked: report.css (full), globals.css grep for pointer-events/z-index/position/overlay
  found: Screen rules for .report-actions are margin/padding/border-top only; `.report-actions button { width:100%; min-height:2.75rem }`. `button { display:none !important }` and the `zoom: 0.75` block are inside `@media print` only (lines 237-450, braces balanced). No pointer-events, no z-index, no positioned overlay anywhere in report.css.
  implication: H-CSS (control unclickable on screen because of CSS/overlay) has no support — ELIMINATED.
- timestamp: 2026-09-03T23:24+08:00
  checked: `npm run build` (local, Next 16.3.2 Turbopack, EXIT 0); .next/server/app/(console)/reports/[client]/[reportId]/page_client-reference-manifest.js; .next/static/chunks
  found: Manifest entry `"[project]/src/app/(console)/reports/[client]/[reportId]/print-button.tsx": {id:75862, name:"*", chunks:[3fntmmi971322.js, 22i43cg4l4-dq.js, 1n4tifgyca8p5.js], async:false}`; `window.print()` present in .next/static/chunks/1n4tifgyca8p5.js. Route tree has no error.tsx/loading.tsx/template.tsx; root layout and console layout are server components; the only client components on the route are next/link and PrintButton.
  implication: The island is bundled and referenced correctly; there is no client-side code on this route that could throw before the button hydrates. A permanent hydration failure is not supported — and the second tap working confirms hydration DID complete on the same page load.
- timestamp: 2026-09-03T23:25+08:00
  checked: src/app (grep manifest|apple-mobile|standalone|display-mode|appleWebApp), public/, next.config.ts, src/proxy.ts
  found: No web manifest, no apple-mobile-web-app-capable meta, no viewport override, no headers()/CSP in next.config.ts or proxy.ts. proxy matcher excludes _next/static.
  implication: The console does not itself request standalone/home-screen mode; the standalone no-op hypothesis needs the operator to have added the site to the home screen (iOS 16.4+ opens such sites standalone by default even without a manifest). Refuted for THIS report by the PDF metadata (Creator Safari) — Safari, not a web app or WKWebView, produced the print.
- timestamp: 2026-09-03T23:26+08:00
  checked: .planning/phases/07-attribution-reporting/07-06-harness/wkprint.swift
  found: The harness never calls window.print(); it drives `WKWebView.printOperation(with:)` from native Cocoa after didFinish + 0.4s. Nothing in it comments on window.print().
  implication: Consistent with window.print() being unavailable inside a bare WKWebView (no WKUIDelegate print hook exists), but irrelevant to the operator's surface, which the PDF metadata shows was Safari.
- timestamp: 2026-09-03T23:27+08:00
  checked: 07-UAT.md Test 1, Test 4, gap G-07-4
  found: Test 1 setup instructed "use Print → Save as PDF" (the Safari share-sheet path), so the earlier iPhone PDF is not evidence about the button. Test 4: "the print button is not working" — then on retry with PDF attached: "It's working (see PDF)". Note: "The first button press did nothing and the second worked; cause of the first miss unknown." Gap status: withdrawn (not reproducible), "Kept for the record because the first press silently did nothing." PDF: Creator Safari, Producer iOS 26.5.2 Quartz PDFContext, A4, 2 pages, fixture version 3.
  implication: Surface = iPhone Safari (iOS 26.5.2). The handler binds and window.print() works on this surface. The defect is a SINGLE silent first tap on a freshly-deployed page (new chunk hashes, cold cache) whose button sits at the very bottom of a page that must be scrolled to reach it. This is a Heisenbug; the remaining hypotheses are timing/gesture, not logic.

- timestamp: 2026-09-03T23:33+08:00
  checked: .next/build-manifest.json rootMainFiles + polyfills + the island's 3 manifest chunks (gzip measured locally)
  found: 10 files, 575,168 raw / 176,959 gzip bytes must download and execute before PrintButton's onClick is bound (largest: 71KB gz React/runtime chunk, 39KB, 36KB). Root layout has no client component; hydration of this island waits on the full runtime.
  implication: On a freshly-deployed build (new content hashes → nothing cached on the phone) there is a real window of ~0.5-2s on a mobile link during which the server-rendered button is visible, styled and tappable but has no handler. React attaches its root event listeners only when hydrateRoot runs; a click before that is not replayed. H2 is plausible, not proven.
- timestamp: 2026-09-03T23:36+08:00
  checked: .next/static/chunks/1n4tifgyca8p5.js (emitted island)
  found: `t.s(["PrintButton",0,function(){return jsx("button",{type:"button",onClick:()=>window.print(),children:"Print or save as PDF"})}])`
  implication: The compiled handler is exactly the source; nothing is stripped or transformed.
- timestamp: 2026-09-03T23:40+08:00
  checked: WebKit main — Source/WebCore/page/LocalDOMWindow.cpp:1176-1200, 2555-2562; loader/DocumentLoader.cpp:422-431 (isLoading), 1492-1498 (checkLoadComplete), 2029-2037 (addSubresourceLoader), 2064-2071 (removeSubresourceLoader); loader/SubresourceLoader.cpp:199
  found: `if (auto* loader = frame->loader().activeDocumentLoader(); loader && loader->isLoading()) { m_shouldPrintWhenFinishedLoading = true; return; }` — no dialog, no error, no event. isLoading() == isLoadingMainResource() || !m_subresourceLoaders.isEmpty(); every SubresourceLoader (scripts, fonts, AND fetch()/XHR raw resources) registers in m_subresourceLoaders after first byte. removeSubresourceLoader → checkLoadComplete → `if (isLoading()) return; window()->finishedLoading()` → deferred print() fires once when the LAST in-flight subresource completes (and only if mainDocumentError().isNull()). A second print() while still loading just re-sets the flag.
  implication: On iOS Safari, window.print() called while ANY request is in flight is a silent no-op whose sheet appears later, once — and two presses during that window yield exactly one sheet. This is the only mechanism found that reproduces the reported shape ("first press did nothing, second worked") without a lost tap. The print-button.tsx comment "window.print() is SYNCHRONOUS ... nothing to await" is false on WebKit in this state.
- timestamp: 2026-09-03T23:44+08:00
  checked: node_modules/next/dist/client/app-dir/link.js:291-311, components/links.js:88-97,134-135,199-229 (Next 16.3.2)
  found: A single shared IntersectionObserver (rootMargin 200px) marks each mounted <Link> visible and schedules its prefetch when prefetchEnabled (the default `prefetch={null}`); (console)/layout.tsx renders 6 nav Links, page.tsx renders the backlink and, when superseded, an "Open version N →" Link INSIDE .report-actions next to the button.
  implication: Right after hydration — the earliest instant the button can work — 7 RSC prefetch fetches to the Sydney function region are in flight, and scrolling the version link into view (if present) starts another one right beside the button. This is the AND-gate partner for the WebKit deferral (H3).
- timestamp: 2026-09-03T23:47+08:00
  checked: External — Apple Developer Forums thread 99316, ftlabs/fastclick#227, apache/cordova-ios#490
  found: On iOS, a tap that stops momentum (inertial) scrolling stops the scroll and fires NO click (and no touchstart); a second tap is required. Expected platform behaviour, differs from Android.
  implication: The button is the LAST element on a page that must be scrolled to reach it; a flick to the bottom followed by an immediate tap is consumed as "stop scrolling" (H1). Cannot be distinguished from H3 without the operator's answer.

## Resolution
<!-- OVERWRITE as understanding evolves -->

root_cause: "Transient first-press miss on iPhone Safari — no defect in print-button.tsx, page.tsx, report.css, the bundle or the route tree (all verified). Ranked candidates, none individually proven: (1) WebKit LocalDOMWindow::print() silently defers when the active DocumentLoader has any subresource in flight, AND Next.js <Link> default prefetch fires 7 fetches immediately after hydration on this page — the first tap in that window produces no sheet until the last fetch completes, and a second press is coalesced into that one sheet; (2) iOS consumes the tap that stops a momentum scroll / overscroll bounce — the button is the last element on a page that must be scrolled to reach it; (3) tap before hydration on a cold cache after the fresh deploy (176,959 gz bytes of JS must execute first; pre-hydration clicks are not replayed); (4) iOS print-sheet presentation latency read as inertness."
fix: "" # diagnose-only; direction recorded in return
verification: ""
files_changed: []
settling_question: "Ask the operator ONE thing: 'After the first tap, did the print sheet come up by itself a second or two later, or only when you tapped again — and were you still scrolling when you first tapped?' A sheet that arrived on its own = H3 (WebKit deferral); only-after-second-tap while stationary = H2 (pre-hydration) or H4; tapped mid-scroll = H1."
