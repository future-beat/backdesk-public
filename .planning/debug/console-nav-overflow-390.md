---
status: resolved
trigger: "G-07-3 console-nav-overflow-390 — At a 390px-wide viewport the console page becomes wider than the viewport because the top navigation bar overflows instead of wrapping — the `Email` and `Sign out` items sit off the right edge and do not scroll with the page content."
created: 2026-09-03T00:00:00+08:00
updated: 2026-09-03T01:20:00+08:00
resolved: 2026-09-05
resolution: "Resolved by 07-06-PLAN.md (nav wraps; UAT test 6 pass) and superseded by quick task 260904-dwt (single scrolling row; operator pass 2026-09-04)"
---

## Current Focus
<!-- OVERWRITE on each update - reflects NOW -->

bug_class: Bohrbug (deterministic layout defect — reproduces on every load at any viewport narrower than ~604px)
hypothesis: CONFIRMED — `.nav` and `.nav nav` in `src/app/globals.css` are `display: flex` with NO `flex-wrap` declaration, so both compute to the initial `flex-wrap: nowrap`. They have been that way in every commit since `19828d8` (Phase 01-02 tracer) — the "existing flex-wrap nav" the 07-UI-SPEC E8 overflow row relies on has never existed in CSS. With seven nav items plus the brand the header's min-content width is ~497px against 350px of available content box at a 390px viewport; `min-width: auto` on flex items floors the shrink there, so ~108px spills out of `.shell` (which carries no CSS at all), and the document's scrollable overflow grows.
test: Static analysis of the shipped CSS + full git history of the `.nav` rule + intrinsic-width computation from the real system-font metrics (SFNS.ttf hmtx/cmap) + differential against every other flex container on the page
expecting: n/a — confirmed
next_action: Return ROOT CAUSE FOUND (goal: find_root_cause_only — no fix applied; plan-phase --gaps owns the fix)

reasoning_checkpoint:
  hypothesis: "The console header overflows at 390px because `.nav` (`display:flex; justify-content:space-between; gap:1rem; padding:0.85rem 1.25rem`) and `.nav nav` (`display:flex; gap:1rem`) never declare `flex-wrap`, so both are `nowrap`. A nowrap flex container's min-content width is the sum of its items' min-content contributions plus gaps, and `min-width:auto` prevents any item shrinking below that — so the header cannot get narrower than ~497px. At a 390px layout viewport only 350px of content box exists, `.shell` has no CSS to clip or contain the difference, and `justify-content: space-between` degrades to `flex-start` under overflow, sending the whole ~108px surplus off the RIGHT edge, where `Email` and `Sign out` are."
  confirming_evidence:
    - "globals.css 104-117: `.nav { display:flex; align-items:center; justify-content:space-between; gap:1rem; padding:0.85rem 1.25rem; border-bottom }` and `.nav nav { display:flex; align-items:center; gap:1rem }` — no `flex-wrap` in either, and no media query anywhere touches them (the file's only two non-color media queries are `min-width:32rem` for `.touch-meta` and `max-width:22.5rem` for `.touch-when--stack .badge`)"
    - "git history: the `.nav` and `.nav nav` blocks are byte-identical in all 14 commits that touched globals.css, back to the initial 19828d8 tracer. `flex-wrap` has NEVER appeared in either rule. `git log -p --follow` shows six `+flex-wrap: wrap` additions in the file's life — all on `.row`, `.touch-list li`, `.metrics dd`, `.touch-meta` and similar; none on the nav"
    - "07-UI-SPEC.md:323 asserts the false premise verbatim: `| overflow | E8 nav + pipeline link | ✅ covered | The existing flex-wrap nav gains one more link and wraps to a second line on a phone (Phase 6 nav rule)`. The cited Phase 6 rule (06-UI-SPEC.md:167) actually says only `the nav is already a gapped flex container` — a claim about `gap`, not about wrapping. The E8 overflow row was signed off ✅ (not 🧪 backstop) on a rule that does not exist"
    - "Intrinsic widths computed from the actual macOS system font (SFNS.ttf hmtx/cmap, 16px): Inbox 36.9 · Queue 45.0 · Audits 43.0 · Reports 52.3 · New client 70.1 · Email 36.3 · Sign out 55.0; brand `Quote Recovery` ~113 at 600 weight. Inner nav min-content = 375.4px, header min-content = 66.1 (brand floor) + 16 (gap) + 375.4 + 40 (padding) = 497.5px vs a 390px viewport → 107.5px of unavoidable overflow, 213.8px at natural (max-content) width, 140.8px when the Queue badge is showing"
    - "`.shell` has NO CSS rule at all (grep across all three stylesheets finds only the `/* --- shell --- */ ` comment) — it is a plain block, so the header's visible overflow propagates to the initial containing block and makes the document scroll horizontally. Nothing sets `overflow-x` on `html`/`body`; the file's only `overflow` declarations are `.table-scroll { overflow-x: auto }` and `.cell-truncate { overflow: hidden }`"
    - "Differential — every OTHER flex container in the console already wraps or contains itself: `.row` has `flex-wrap: wrap`, `.touch-list li` has it, `.metrics dd` has `flex-wrap: wrap` (07-UI-SPEC:250), the reports table is inside `.table-scroll { overflow-x: auto }` (reports/page.tsx:149), `main` is `max-width: 60rem` with no min-width. The header is the single unwrapped flex row in the shell — which is exactly why the user could correctly attribute the widening to the top bar and simultaneously confirm the table behaves"
    - "Symptom fingerprint match: `justify-content: space-between` resolves to `flex-start` when the line overflows (CSS Box Alignment: overflow alignment is safe/start), so 100% of the surplus goes past the right edge — i.e. the LAST items, `Email` and `Sign out`, are the ones off-screen, which is precisely what was reported"
    - "`Sign out` is a `<button class=\"linkish\">` inside a `<form>`; `.nav form { display:inline }` is inert (a flex item is blockified to `block`), so the form is an ordinary flex item that participates in — and cannot escape — the nowrap line. Nothing about the form is special-casing the overflow"
  falsification_test: "Add `flex-wrap: wrap` to `.nav` and `.nav nav` and reload /reports at exactly 390px. If `document.documentElement.scrollWidth` is still > 390 (or `Email`/`Sign out` are still off the right edge), the hypothesis is wrong. Conversely, widening the viewport past ~604px (the header's max-content width) must make the symptom vanish with no code change — which is exactly why every desktop check has passed."
  fix_rationale: "The fix is to declare the wrap the contract always assumed, not to hide the overflow. `overflow-x: hidden` on the shell would make `Sign out` permanently unreachable (worse than the bug); a hamburger is explicitly out of scope (UI-SPEC says wrap). `flex-wrap: wrap` on BOTH containers is required, not one: with it on `.nav` alone the inner nav drops to its own line at 350px but its max-content is 434.5px, so it would fit only by shrinking `New client` and `Sign out` below max-content — i.e. those two labels would each break mid-phrase onto two lines. With wrap on `.nav nav` too the links flow as whole words (Inbox/Queue/Audits/Reports = 225.2px on one line, New client/Email/Sign out = 193.4px on the next), both inside 350px."
  blind_spots: "Not rendered in a real browser — no headless browser is installed in this repo (no playwright/puppeteer in node_modules) and the brief was read-only. Widths are computed from SFNS.ttf's default (Regular) instance; the 600-weight brand is approximated at +5%, and iOS's SF Pro Text optical size at 16px may differ by a few px. None of that moves a ~108px overflow. The Queue badge width (33.3px for a two-digit count) is estimated from the `.badge` rule rather than measured. I did not verify the exact browser used for the UAT report; Safari and Chrome agree on all the mechanisms cited here. Whether Phase 6 ALSO overflowed (see the timeline evidence entry) rests on the same computation, not on a screenshot."
  candidate_causes:
    - "code (CSS): `.nav` / `.nav nav` in globals.css declare `display:flex` with no `flex-wrap` — latent since 19828d8. PRIMARY."
    - "code (markup): layout.tsx now carries a brand plus seven interactive items whose combined max-content is ~604px; 07-05 added the 7th (`Reports` = 52.3px text + one 16px gap = 68.3px), pushing the floor overflow from ~39px to ~108px."
    - "process/contract: 07-UI-SPEC:323 marked the E8 overflow state ✅ covered by citing a 'Phase 6 flex-wrap nav rule' that was never implemented — the paper contract and the CSS disagreed, and nothing checked."
    - "environment (viewport): only bites below ~604px. Every local dev check and every desktop review runs wider, so the defect was structurally invisible to the whole review chain."
  and_gate: "Partly. The FIX is single-cause: `flex-wrap: wrap` on the two rules removes the symptom on its own, at any item count, at any viewport. The VISIBILITY required three conditions at once — the missing wrap AND enough items to exceed the viewport's min-content budget AND a narrow viewport — which is why the same defect shipped through six phases of desktop-width review without being seen. Treating the Reports link as the cause would be wrong: removing it leaves a ~39px (or ~72px with the Queue badge showing) overflow at 390px still in place."

## Symptoms
<!-- Written during gathering, then IMMUTABLE -->

expected: At 390px the page is never wider than the viewport. The nav wraps to a second line (the Phase 6 nav rule that UI-SPEC U-8 relied on when it added the `Reports` link), the overview table on `/reports` scrolls sideways only inside its own `.table-scroll` box, and the `Sign out` control stays reachable.
actual: On `/reports` and `/reports/[client]` at 390px the table scrolls inside its box correctly and the metric rows wrap correctly, but the document itself is wider than the viewport: the nav's `Email` (settings) and `Sign out` items overflow to the right and are clipped/unreachable without horizontally scrolling the whole page. The user attributes the page widening to the top bar, not the table.
errors: None reported
reproduction: Test 3 in UAT — log in as operator, open https://quote-recovery-mvp.vercel.app/reports at a 390px viewport (or on a phone).
started: Reported as appearing after Phase 7 added the `Reports` link to the console nav in `src/app/(console)/layout.tsx` (07-05, commit daac276); Phase 6 UAT at phone width passed before that link existed.

## Eliminated
<!-- APPEND only - prevents re-investigating -->

- hypothesis: "A child of the nav carries `white-space: nowrap` or a `min-width` that blocks wrapping"
  evidence: "The only `white-space: nowrap` in globals.css is on `.badge` (line 333, added by the 05-08 fix), and `.badge` also carries `max-width: 100%`, so it can never be the widening element. No `min-width` is declared anywhere in the file. The wrap is blocked by the ABSENCE of `flex-wrap`, not by any positive declaration on a child."
  timestamp: 2026-09-03T00:55+08:00

- hypothesis: "A `margin-left: auto` spacer or the sign-out `<form>`/`<button>` is pinned and prevents wrapping"
  evidence: "No `margin-left: auto` exists in any stylesheet. Separation is done with `justify-content: space-between` on `.nav`. The form is `.nav form { display: inline }` — inert, because flex items are blockified — and `button.linkish` zeroes padding/min-height. It is an ordinary shrinkable flex item; removing it entirely still leaves the nav ~53px over budget at 390px."
  timestamp: 2026-09-03T01:00+08:00

- hypothesis: "The `Reports` link (07-05) introduced the overflow"
  evidence: "Intrinsic-width computation on the Phase 6 nav (6 items, no Reports): header min-content = 429.2px vs 350px available — already 39.2px over at 390px, and 72.5px over whenever the Queue badge renders. The Reports link added 68.3px on top. It made a latent defect unmissable; it did not create it. The nav rule is byte-identical in every commit since 19828d8."
  timestamp: 2026-09-03T01:10+08:00

- hypothesis: "Something on the /reports page other than the nav widens the document"
  evidence: "The overview table is wrapped in `<div className=\"table-scroll\">` (reports/page.tsx:149) and `.table-scroll { overflow-x: auto }` contains it; `.row` (h1 line) is `flex-wrap: wrap`; `.metrics dd` is `flex-wrap: wrap`; `main` is `padding:1.25rem; max-width:60rem` with no min-width. The user independently confirmed the table and metric rows behave. The header is the only unwrapped flex row in the shell."
  timestamp: 2026-09-03T01:12+08:00

## Evidence
<!-- APPEND only - facts discovered -->

- timestamp: 2026-09-03T00:30+08:00
  checked: .planning/debug/knowledge-base.md and the three sibling debug sessions
  found: knowledge-base.md does not exist. `inbox-badge-layout-phone.md` (status diagnosed, 2026-08-31) is a prior 390px layout defect on the same stylesheet — root cause there was `.badge` living outside the flex context it assumed, fixed in 6334881 by hardening `.badge` with `display:inline-block; white-space:nowrap; max-width:100%`.
  implication: Known-pattern candidate — "a shipped CSS class is used in a container that does not provide the layout behaviour the class assumes." It matched, but one level up: here the CONTRACT (07-UI-SPEC E8) assumed a container behaviour (`flex-wrap`) that the container never had. Same failure shape, different layer.

- timestamp: 2026-09-03T00:35+08:00
  checked: src/app/(console)/layout.tsx (the real nav item list)
  found: `<header class="nav">` holds a `.brand` Link (`Quote Recovery`) and an inner `<nav>` with exactly seven interactive items in this order — Inbox (optional count `.badge` inside the Queue link, not Inbox), Queue (+ conditional `.badge`/`.badge--error`), Audits, Reports, New client, Email, and a `<form action={signOut}>` wrapping `<button class="linkish">Sign out</button>`.
  implication: Confirms the item list from the brief. `Email` and `Sign out` are the last two — exactly the pair reported off the right edge, which is the signature of `flex-start`-degraded overflow rather than, say, a centred or reversed layout.

- timestamp: 2026-09-03T00:45+08:00
  checked: src/app/globals.css lines 104-120, 216-218, and all three stylesheets for `.nav`
  found: |
    .nav { display: flex; align-items: center; justify-content: space-between;
           gap: 1rem; padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--line); }
    .nav nav { display: flex; align-items: center; gap: 1rem; }
    .nav form { display: inline; }
    No `flex-wrap` in either container. No `.shell` rule exists at all — only the
    `/* --- shell --- */` section comment on line 102. The only other `.nav`
    references project-wide are `audit.css:131` and `report.css:225`, both inside
    `@media print` blocks that hide it.
  implication: Both containers are `flex-wrap: nowrap` (the initial value), and there is no containing block between the header and the initial containing block that could absorb or clip the overflow.

- timestamp: 2026-09-03T00:50+08:00
  checked: Full git history of the `.nav` / `.nav nav` rules across all 14 commits that touched globals.css
  found: The two rule blocks are byte-identical in every commit from 19828d8 (feat(01-02) tracer) through 5d2fba5 (feat(07-04)). `git log -p --follow src/app/globals.css | grep '^[+-].*flex-wrap'` shows six additions and one removal — every one of them on `.row`, `.touch-list li`, `.touch-meta`, `.metrics dd` or a similar content row. `flex-wrap` has never been added to, or removed from, the nav.
  implication: DEFINITIVE — the nav has never been able to wrap. There is no regression to bisect; the Phase 7 link crossed a threshold on a defect that shipped in the very first console commit.

- timestamp: 2026-09-03T01:05+08:00
  checked: Intrinsic widths measured from /System/Library/Fonts/SFNS.ttf (hmtx + cmap parsed directly), 16px, against the shipped 1rem gaps and 1.25rem side padding
  found: |
    Link text @16px: Inbox 36.9 · Queue 45.0 · Audits 43.0 · Reports 52.3 ·
    New client 70.1 (min-content "client" 36.0) · Email 36.3 · Sign out 55.0
    (min-content "Sign" 30.0). Brand: 107.8 regular → ~113.2 at 600 weight;
    min-content "Recovery" ~66.1. Queue badge ("12" @0.8rem + padding + border) ~33.3.

    Phase 7 (7 items): inner nav max-content 434.5 / min-content 375.4;
      header = brand + 16 gap + nav + 40 padding
      → max-content 603.8px, min-content 497.5px.
      At a 390px viewport: 213.8px overflow at natural width, 107.5px at the
      absolute shrink floor, 140.8px with the Queue badge showing.

    Phase 6 (6 items, pre-Reports): header max-content 535.5 / min-content 429.2
      → 39.2px floor overflow at 390px, 72.5px with the badge showing.
  implication: The overflow is not marginal and cannot be shrunk away — `min-width: auto` on flex items floors a nowrap container at its min-content sum. It also proves the defect predates Phase 7: the Reports link added 68.3px (52.3 text + one 16px gap) to a header that was already ~39px too wide.

- timestamp: 2026-09-03T01:15+08:00
  checked: .planning/phases/07-attribution-reporting/07-UI-SPEC.md (U-8 and the UI Considerations table) vs .planning/phases/06-review-console-escalation/06-UI-SPEC.md §2
  found: 07-UI-SPEC:323 — "| overflow | E8 nav + pipeline link | ✅ covered | The existing flex-wrap nav gains one more link and wraps to a second line on a phone (Phase 6 nav rule); the pipeline `.meta` link is one line |". The cited Phase 6 rule (06-UI-SPEC:167) reads "Count badge is an existing `.badge` beside the link text (the nav is already a gapped flex container — the 05-08 `.badge` contract holds)" — an assertion about `gap`, with no claim about wrapping. U-8 itself (07-UI-SPEC:30) argues only nav ORDER and the absence of a badge; it never considers width.
  implication: The gate that should have caught this is the UI-SPEC overflow probe, and it failed by upgrading "gapped flex container" to "flex-wrap nav" across a phase boundary and then marking the row ✅ covered instead of 🧪 backstop. Every other genuinely-uncertain overflow row in the same table (E6 printed report) was correctly marked backstop and did get caught in UAT.

- timestamp: 2026-09-03T01:18+08:00
  checked: Why every prior gate passed (timeline consistency), incl. 06-UAT.md test 2
  found: 06-UAT test 2 is "390px queue ergonomics … smooth scrolling, no horizontal scroll, every approve/edit/skip control ≥44px" and its pass note enumerates only card-level facts ("tiers/sort/full bodies/no-draft card/two-step skip all confirmed on phone"). The nav was not part of what was inspected. Meanwhile the header's max-content width is ~604px, so any viewport ≥ ~604px — every local `next dev` window, every desktop review, every screenshot — renders it perfectly.
  implication: Consistent. The defect is invisible above ~604px and was ~39px (sub-scrollbar-obvious) below it until the Reports link doubled it. No gate lied; the phone-width gate simply looked at the page body, and the contract gate trusted a rule it had invented.

- timestamp: 2026-09-03T01:19+08:00
  checked: src/app/layout.tsx (viewport meta) and the fix-direction search space
  found: No `export const viewport` and no manual meta tag — the App Router's default `width=device-width, initial-scale=1` applies, so the layout viewport really is 390px on the reported device (no 980px fallback that would have hidden this). `button.linkish` sets `min-height: 0`, so the `Sign out` control is also below the 44px tap-target rule 06-UI-SPEC:51 asserts for the nav — a separate, pre-existing gap in the same element, worth folding into whichever plan touches this rule.
  implication: The mechanism holds on the reported device, and there is a second, adjacent contract violation in the same nav that a fix plan can cheaply close at the same time.

## Resolution
<!-- OVERWRITE as understanding evolves -->

root_cause: "`.nav` and `.nav nav` in `src/app/globals.css` (lines 104-117) are `display: flex` with no `flex-wrap` declaration, so both compute to `flex-wrap: nowrap` — and have in every commit since 19828d8. A nowrap flex container cannot shrink below the sum of its items' min-content contributions plus gaps (`min-width: auto`), which for the brand plus seven nav items is ~497px against the ~350px content box of a 390px viewport. `.shell` has no CSS, nothing sets `overflow-x`, and `justify-content: space-between` degrades to `flex-start` under overflow, so the entire ~108px surplus lands past the right edge on the last two items (`Email`, `Sign out`) and grows the document's scrollable width. Phase 7's `Reports` link (daac276) added 68.3px and made a latent defect unmissable — it did not create it: the same header was already ~39px over budget at 390px in Phase 6 (~72px whenever the Queue badge rendered). The contract gate missed it because 07-UI-SPEC:323 marked the E8 overflow state ✅ covered on the strength of an 'existing flex-wrap nav (Phase 6 nav rule)' that does not exist in CSS — 06-UI-SPEC:167 claims only that the nav is a 'gapped flex container'."
fix: "NOT APPLIED — goal was find_root_cause_only. Suggested direction recorded in the return payload; plan-phase --gaps owns the fix plan."
verification: "Diagnosis only. Falsification test for the fix: at exactly 390px on /reports, `document.documentElement.scrollWidth === 390` and both `Email` and `Sign out` are visible and tappable without horizontal page scroll; the nav occupies two lines with no label broken mid-phrase; at ≥604px the nav stays on one line and looks unchanged; the /reports table still scrolls only inside `.table-scroll`; the printed report still hides `.nav` (audit.css:131 / report.css:225)."
files_changed: []

## Follow-up (quick-260904-dwt, 2026-09-04)
<!-- APPEND only - the record above stands as written; this is what happened next -->

The 07-06 fix did what this diagnosis asked of it: `flex-wrap: wrap` on both containers stopped the document widening, and `nav-check.sh` proved it at 390/604/700px. What the diagnosis did not price is what the wrap COST. A nowrap flex row cannot shrink below its items' min-content sum (~502px with the Queue badge showing), so that surplus has to be spent somewhere, and wrapping spends it on HEIGHT: three rows and 176px of chrome at 390px, about a quarter of the phone screen, with `New client`, `Email` and `Sign out` on the rows nobody looks at. On 2026-09-04, after passing UAT test 6, the operator asked for the bar to scroll sideways instead (todo `2026-09-04-console-nav-single-row-sideways-scroll-on-phones.md`).

**The LINK ROW is now the scroll box, and that is a different thing from what `fix_rationale` rejected.** `fix_rationale` refused `overflow-x: hidden` on the SHELL because it would make `Sign out` permanently unreachable — a fix worse than the bug. `.nav nav { overflow-x: auto }` is the opposite trade: every item stays reachable by swipe, by programmatic scroll and by keyboard focus (measured, not assumed — see below), while the row keeps all 502px of its content inside a 221px box and the document stays exactly 390px. The outer `.nav` keeps `flex-wrap: wrap` as the brand-collision fallback only: with `flex: 1 1 12rem` the row sits beside the brand whenever ~192px remain (~365px viewport and up) and drops under it below that, at 320px, rather than colliding.

**The falsification test in `verification` above is superseded.** It now reads: at exactly 390px on a console page, `document.documentElement.scrollWidth === 390`; the bar is ONE row of ~72px (not two, not three); `.nav nav` has `scrollWidth > clientWidth` and `overflow-x: auto`, resting at `scrollLeft 0`; `Inbox` and `Queue` are fully visible without a swipe and something is cut or faded at the right edge; `Sign out` is fully visible after scrolling the row to its end AND when it takes keyboard focus; no label breaks mid-phrase; every tap box is >= 44px with no two intersecting; at 700px nothing scrolls and the bar is the unchanged 72px; the printed report and audit still hide `.nav`.

Proven by `07-06-harness/nav-check.sh`, which now measures all of it and — pointed at the 07-06 CSS via `GLOBALS_CSS=$(git show 898bce3:src/app/globals.css)` — exits 1 with `RESULT: FAIL`, naming `bar is 3 lines / 176px, not one row` and `the link row does not scroll` at 390px. Pinned at source by `tests/layout-contract.test.ts` (the 07-06 wrap pins are REPLACED, not deleted). Measured on the shipped tree: 390px one 72px row, row 221/502, `Inbox`/`Queue`/`Audits` whole, `Reports` cut, `Sign out` at `scrollLeft 281` of 281; 604px 72px, 435/502; 700px 72px, not scrollable, no fade; 320px the wrap fallback at 124px.

See `07-UI-SPEC.md` E8 (tagged `[Contract correction quick-260904-dwt, 2026-09-04]`) and its `### Contract corrections (quick-260904-dwt, 2026-09-04)` subsection, which also records the decision surfaced for the operator: four items cannot fit the first 390px screenful beside a 121px brand (262px needed, 221px available), so `Reports` is deliberately the cut item that acts as the scroll cue.
