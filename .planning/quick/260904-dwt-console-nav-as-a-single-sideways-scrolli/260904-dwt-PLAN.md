---
phase: quick-260904-dwt
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/app/globals.css
  - tests/layout-contract.test.ts
  - .planning/phases/07-attribution-reporting/07-06-harness/gen-nav.mjs
  - .planning/phases/07-attribution-reporting/07-06-harness/nav-check.sh
  - .planning/phases/07-attribution-reporting/07-06-harness/gen-tables.mjs
  - .planning/phases/07-attribution-reporting/07-06-harness/tables-check.sh
  - .planning/phases/07-attribution-reporting/07-06-harness/README.md
  - .planning/phases/07-attribution-reporting/07-UI-SPEC.md
  - .planning/debug/console-nav-overflow-390.md
autonomous: true
requirements: []

estimate:
  tokens: 60000
  raw_tokens: 60000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "At a 390px viewport the console bar is ONE row of about 72px (it is 176px / three rows today), the document is exactly 390px wide, and the link row inside it scrolls sideways (scrollWidth > clientWidth) — spec items 1 and 4"
    - "At 390px, Inbox and Queue (with its badge) are fully visible without scrolling, the last visible item is cut at the right edge so the row reads as scrollable, and one swipe (scroll to the end) brings Sign out fully into view — spec items 2 and 3"
    - "The right-edge fade is CSS-only (no JS, no tabIndex on the row): present while the row overflows, collapsed at the scroll end so Sign out is never dimmed, and absent altogether where nothing overflows — spec item 2"
    - "At 700px the bar is unchanged: one line, 72px, nothing scrolls, Sign out flush at the right content edge, and no fade — spec item 4"
    - "Every nav control keeps its 44px tap box, no two hit boxes intersect, keyboard focus on any link scrolls it into view with 3px of ring headroom inside the row (the row is padded for the ring and gives the padding back with an equal margin), and `.nav` stays hidden in the printed report and audit — spec items 1 and 5"
    - "The pure suite pins the new contract at source (07-06 wrap pins replaced, not deleted) and the headless harness measures it, failing on the pre-change CSS and passing on the shipped one; `npm test` keeps its 0-assertion-failure baseline"
  artifacts:
    - "src/app/globals.css — `.nav nav` is the scroll container (nowrap, overflow-x auto, x proximity snap, hidden scrollbar, ring padding/margin pair, scroll-driven `--nav-fade` mask); `.nav` keeps `flex-wrap: wrap` as the fallback; `.nav nav > *` items are `flex: 0 0 auto` snap starts; first item carries `margin-inline-start: auto`; explicit focus ring on row items"
    - "tests/layout-contract.test.ts — the `console bar at phone width` describe pins the scroll-row contract, the wrap fallback, the padding/margin pair, the 44px targets, and the print-hidden `.nav`"
    - ".planning/phases/07-attribution-reporting/07-06-harness/gen-nav.mjs + nav-check.sh — probe reports row scroll facts, visible/cut sets, ring headroom, focus-scroll and end-scroll reachability, computed mask; script asserts them at 390/604/700 and one-row height at every width"
    - ".planning/phases/07-attribution-reporting/07-06-harness/gen-tables.mjs + tables-check.sh — `barRight` (brand + row box) replaces the all-descendants `navRight` so a row that scrolls inside the viewport is not reported as widening it"
    - ".planning/phases/07-attribution-reporting/07-UI-SPEC.md — E8 overflow row corrected with a `[Contract correction quick-260904-dwt, 2026-09-04]` tag and a dated `### Contract corrections (quick-260904-dwt, 2026-09-04)` subsection"
    - ".planning/debug/console-nav-overflow-390.md — dated follow-up note: the SHELL still never clips; the LINK ROW is now the scroll box"
  key_links:
    - "`.nav nav { flex: 1 1 12rem; min-width: 0; overflow-x: auto }` -> the row sits beside the brand on ONE line at >= ~365px (measured: 360px and below drops the row under the brand at 124px; 365px and up is one 72px row — the arithmetic is 121 brand + 16 gap + 184 row + 40 padding = 361px) and takes the remaining width (221px at 390); at 320px it drops under the brand (the `.nav { flex-wrap: wrap }` fallback) instead of colliding with it"
    - "`.nav nav > :first-child { margin-inline-start: auto }` -> flush-right items at desktop exactly as today (auto margins collapse to 0 under overflow, so the row is scrollable from its start on a phone)"
    - "`@property --nav-fade` + `@keyframes nav-row-edge` + `animation-timeline: scroll(self inline)` -> the mask's fade width is 2.5rem while the row overflows and 0 at the end; an inactive timeline (no overflow) or an engine without scroll timelines leaves `--nav-fade` at 0px = no fade"
    - "`padding: 0.25rem; margin: -0.25rem; scroll-padding-inline: 0.25rem` on `.nav nav` -> focus rings (2px + 1px offset = 3px) are not clipped by the scroll container, the snap start does not hide the padding, and no hit box moves"
    - "tests/layout-contract.test.ts `rule(GLOBALS_CSS, '.nav nav')` -> requires exactly ONE `.nav nav` rule in the file (no `@supports` duplicate), which is why every declaration lives in the one rule"
    - "nav-check.sh `GLOBALS_CSS=` override + `git show 898bce3:src/app/globals.css` -> the harness demonstrably FAILS on the wrapping CSS before it is trusted to PASS on the scrolling one"
---

<objective>
Turn the console bar's link row into a single sideways-scrolling row on phones, so the bar costs one line (~72px) instead of three (176px at 390px today), while the page itself never scrolls sideways, hidden items announce themselves with a right-edge fade and a cut-off last item, Sign out stays one swipe away, keyboard focus still reaches every link, tap targets stay 44px, and the printed report/audit still hide the bar. Replace the 07-06 wrap pins with pins for the new contract, extend the headless harness to measure it, and correct the paper contract (07-UI-SPEC E8) plus the G-07-3 debug record.

Purpose: the Queue page is the screen the operator opens between meetings on a 390px phone; the wrapped bar takes a quarter of that screen and its second and third rows hold the least-used items. The operator asked for a sideways-scrolling bar on 2026-09-04 (todo `2026-09-04-console-nav-single-row-sideways-scroll-on-phones.md`), and the answer given was yes, provided the LINK ROW scrolls and the page never does, with a cue that more exists.

Output: one CSS change (`src/app/globals.css`), replaced contract pins (`tests/layout-contract.test.ts`), an extended harness (`07-06-harness/`), and three corrected planning documents. No markup change: `src/app/(console)/layout.tsx` already orders the items Inbox, Queue, Audits, Reports, New client, Email, Sign out, which is the order the spec asks for, and links are natively focusable, so no `tabIndex` is added to the row (spec item 4; the harness proves focus scrolls the last item into view).
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/todos/pending/2026-09-04-console-nav-single-row-sideways-scroll-on-phones.md
@src/app/globals.css
@src/app/(console)/layout.tsx
@tests/layout-contract.test.ts
@.planning/phases/07-attribution-reporting/07-06-harness/gen-nav.mjs
@.planning/phases/07-attribution-reporting/07-06-harness/nav-check.sh
@.planning/phases/07-attribution-reporting/07-06-harness/gen-tables.mjs
@.planning/phases/07-attribution-reporting/07-06-harness/tables-check.sh
@.planning/debug/console-nav-overflow-390.md
</context>

<planner_evidence>
Measured by the planner on 2026-09-04 in headless Google Chrome 152 over the real `globals.css` using the 07-06 iframe fixture (synthetic nav, Queue badge showing), so every number below is an observation, not an estimate.

**Today (HEAD `898bce3` (= BASE, the pre-Task-1 tree; the 260904-dfq commits are already in it), `nav-check.sh` PASS):** 390px: bar 176px, 3 lines. 604px: 124px, 2 lines. 700px: 72px, 1 line, `navRight` 680 (= the content-box edge). All tap boxes 44px, no overlaps.

**With the candidate CSS of Task 1 (a patched copy, tree untouched):**

| width | doc scrollWidth | bar height / lines | row client / scroll | fully visible at rest | cut at rest | focus Sign out → inside row, ring headroom | scroll to end → Sign out inside | computed mask at rest |
|-------|-----------------|--------------------|---------------------|-----------------------|-------------|---------------------------------------------|----------------------------------|-----------------------|
| 320 | 320 | 124 / 1 item line (row dropped under the brand — the wrap fallback) | 288 / 502 | Inbox, Queue, Audits, Reports | — | yes, 4px | yes (scrollLeft 214 = max) | fade 40px |
| 390 | 390 | 72 / 1 | 221 / 502 | Inbox, Queue, Audits | Reports (7px of it showing) | yes, 4px | yes (scrollLeft 281 = max) | `linear-gradient(to right, rgb(0,0,0) calc(100% - 40px), rgba(0,0,0,0))` |
| 604 | 604 | 72 / 1 | 435 / 502 | all but Sign out | — | yes, 4px | yes (67 = max) | fade 40px |
| 700 | 700 | 72 / 1 | 531 / 531 (not scrollable) | all seven | — | already inside, 3.7px | n/a | `linear-gradient(to right, rgb(0,0,0) 100%, rgba(0,0,0,0))` — fully opaque, fade absent |

Facts that shaped the CSS:
- The brand `Quote Recovery` is 121px wide at 600 weight; with the 1rem gap and 1.25rem side padding a 390px phone leaves the row 221px. Inbox + Queue(badge) + Audits + Reports need 262px, so the spec's wish that all four fit the first screenful is arithmetically impossible in a ONE-ROW bar with the brand beside it. The one-row bar (spec item 4, the operator's actual complaint) wins; Inbox, Queue and Audits are fully visible, and Reports being cut IS the spec's item-2 cue. Record this in the CSS comment and the UI-SPEC correction; do not shrink gaps or the brand to chase the fourth item.
- With `flex-basis: auto` the row's hypothetical size (~494px) would never fit beside the brand at 390 and the outer bar would wrap it under the brand (124px). `flex: 1 1 12rem` makes the row's hypothetical size 192px, so it stays on the brand's line whenever at least 192px is left (>= ~365px viewport) and grows to fill; at 320px it drops under the brand — the `.nav { flex-wrap: wrap }` fallback the spec asks to keep.
- `min-width: 0` is already implied by `overflow-x: auto` (a scroll container's automatic minimum size is 0) — written explicitly so nobody removes the overflow and silently reintroduces G-07-3.
- Without `scroll-padding-inline`, `scroll-snap-align: start` snapped the row to scrollLeft 4 on load (the first item's edge, ignoring the 4px padding) and the first item's ring headroom was 0. With it, scrollLeft is 0 at rest and headroom is 4px.
- A second `.nav nav` rule inside `@supports (animation-timeline: scroll())` makes `rule()` in `tests/layout-contract.test.ts` throw ("2 rules include .nav nav"). Every declaration therefore lives in the ONE `.nav nav` rule. No `@supports` is needed: `animation-duration` initial value is `auto`, which with a scroll timeline spans the scroll range and without one is 0s — the animation finishes instantly and `fill-mode: both` holds the 100% keyframe (`--nav-fade: 0px`), i.e. no fade — and an unset `--nav-fade` makes the `mask-image` invalid at computed-value time, i.e. `none`. Both degrade to "no fade, still scrollable".
- Headless Chrome under `--dump-dom` produces almost no animation frames inside an iframe, so scroll-timeline PROGRESS (fade collapsing at the end) is not reliably observable there; the mask at rest was read as `calc(100% - 40px)` in most runs and `100%` in one. The 700px "no fade" reading is deterministic (an inactive timeline never applies the animation), so the harness gates that; the 390px fade is reported as INFO and is the human check on the iPhone (iOS 26.5 Safari supports scroll-driven animations).
- The all-descendants `navRight` probe in BOTH `gen-nav.mjs` and `gen-tables.mjs` reports 647px at 390 once items live in the row's scrollable overflow, so both `nav-check.sh` and `tables-check.sh` would FAIL "nav content reaches 647px" on correct CSS. The bar-level `barRight` (brand + the row's own box, 374 at 390) is the right measure; every item's reachability is asserted separately by the end-scroll and focus checks.
- The concurrent quick task 260904-dfq lists `src/app/globals.css` in its `files_modified`. Edit `globals.css` with scoped `Edit` calls on the `.nav` region only and re-read the file immediately before editing; never `Write` the whole file.
</planner_evidence>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: Make `.nav nav` the box that scrolls, pin the contract, prove one row at 390</name>
  <files>src/app/globals.css, tests/layout-contract.test.ts</files>
  <behavior>
    - Test 1: `rule(GLOBALS_CSS, '.nav')` still matches `flex-wrap: wrap;` (the fallback), and `rule(GLOBALS_CSS, '.nav nav')` matches `flex-wrap: nowrap;`, `overflow-x: auto;`, `scroll-snap-type: x proximity;`, `scroll-padding-inline: 0.25rem;`, `scrollbar-width: none;`, `mask-image: linear-gradient(` with `var(--nav-fade)` inside it, and `animation-timeline: scroll(self inline);`, and does NOT match `/flex-wrap: wrap;/`
    - Test 2: the row's ring headroom is net-zero for layout: `.nav nav` matches `padding: 0.25rem;` AND `margin: -0.25rem;` (equal magnitude, asserted as a pair), and `rule(GLOBALS_CSS, '.nav nav > *')` matches `flex: 0 0 auto;` and `scroll-snap-align: start;`, and `rule(GLOBALS_CSS, '.nav nav > :first-child')` matches `margin-inline-start: auto;`
    - Test 3: the fade is scroll-driven and CSS-only: the uncommented file contains `@property --nav-fade` with `syntax: '<length>'` and `initial-value: 0px`, and `@keyframes nav-row-edge` whose text includes `--nav-fade: 2.5rem` and `--nav-fade: 0px`; and the stripped `layout.tsx` source (via `uncommentedTsx`) contains no `tabIndex` on the `<nav`
    - Test 4: existing pins kept verbatim — the 44px tap rule (`min-height: 2.75rem;`, `display: inline-flex;`) and its no-negative-margin assertions on `.nav .brand` + `.nav nav > a` + `.nav button.linkish`
    - Test 5: print stays clean — `rule(printBlock(REPORT_CSS), '.nav')` and `rule(printBlock(AUDIT_CSS), '.nav')` both match `display: none !important;`
  </behavior>
  <action>
    **globals.css (scoped edits only; re-read the `.nav` region first — 260904-dfq may have touched the file since).**

    1. Replace the `.nav nav` rule (currently `display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 1rem;`) with ONE rule carrying, in this order: `display: flex; flex-wrap: nowrap; align-items: center; gap: 1rem; flex: 1 1 12rem; min-width: 0; overflow-x: auto; scroll-snap-type: x proximity; scroll-padding-inline: 0.25rem; scrollbar-width: none; -webkit-overflow-scrolling: touch; padding: 0.25rem; margin: -0.25rem; mask-image: linear-gradient(to right, #000 calc(100% - var(--nav-fade)), transparent); animation: nav-row-edge linear both; animation-timeline: scroll(self inline);`. The `animation` shorthand MUST come before `animation-timeline` (the shorthand resets it). Do NOT add a second `.nav nav` rule anywhere (no `@supports` block) — `rule()` in the contract test refuses ambiguity, and the fallback story needs none (see planner_evidence).
    2. Immediately above that rule add `@property --nav-fade { syntax: '<length>'; inherits: false; initial-value: 0px; }` and below it `@keyframes nav-row-edge { 0%, 85% { --nav-fade: 2.5rem; } 100% { --nav-fade: 0px; } }` — the fade holds its full 2.5rem until 85% of the scroll range and collapses over the last 15% so the final item is never dimmed at the end; the keyframes animate the registered length, not `mask-image` itself, so the collapse interpolates instead of flipping.
    3. Add `.nav nav::-webkit-scrollbar { display: none; }` (older WebKit/Blink; `scrollbar-width: none` covers current engines).
    4. Add `.nav nav > * { flex: 0 0 auto; scroll-snap-align: start; }` — `> *` because the last item is the `<form>` around Sign out, not an `<a>`.
    5. Add `.nav nav > :first-child { margin-inline-start: auto; }` — the desktop right-alignment. Auto margins absorb free space when there is some (700px: items flush at the content edge, exactly today's 680) and collapse to 0 under overflow (390px: items start at the row's left edge and the row scrolls from its start). Do NOT use `justify-content: flex-end` on the row — under overflow it pushes the START of the row out of reach.
    6. Add `.nav nav > a:focus-visible, .nav button.linkish:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }` — the file's `:focus-visible` convention (07-07, `.table-scroll:focus-visible`) with a 1px offset so the ring's total extent (3px) is a known number the row's 0.25rem padding is sized against. A scroll container clips outlines drawn outside its padding box; the UA `auto` ring has no fixed extent to size for.
    7. Leave the `.nav` rule (`flex-wrap: wrap`, `gap: 0.5rem 1rem`, `padding: 0.85rem 1.25rem`, `justify-content: space-between`) exactly as it is, and leave the `.nav .brand, .nav nav > a, .nav button.linkish` tap rule and `button.linkish` untouched. Do not touch `.nav form`.
    8. Rewrite the block comment above `.nav` (the one that opens "BOTH FLEX CONTAINERS WRAP") — it is now false for the inner row. State the new contract in the file's voice: the OUTER bar still wraps, but only as the fallback that keeps the brand off the row when fewer than 12rem remain (320px: the row drops under the brand, 124px, Inbox through Reports visible); the INNER row is the scroll container and the one box in the bar allowed to hold overflow, because a nowrap flex row cannot shrink below its items' min-content sum (~494px with the Queue badge) and G-07-3 was that sum landing on the document. Give the measured numbers: 390px → one 72px row (176px before), row 221px wide of 502px content, Inbox/Queue/Audits fully visible, Reports cut as the cue, Sign out at scrollLeft 281 after one swipe; 604px → 72px (124 before); 700px → unchanged 72px, nothing scrolls. Explain why four items cannot fit the first 390px screenful beside a 121px brand (262px needed, 221 available) and that the one-row bar was chosen over shrinking the brand or the gaps. Explain the `padding: 0.25rem` / `margin: -0.25rem` pair honestly against the 07-06 review's WR-03 ruling: that bleed BOUGHT tap-box height and put one hit box inside another; this pair buys nothing for any hit box — the row itself is not tappable, its margin gives back exactly the padding, every item sits where it did — and exists only so a 3px focus ring is not clipped by the scroll container (`nav-check.sh` asserts ring headroom >= 3 AND, as before, that no two hit boxes intersect). Explain the fade: a registered `--nav-fade` driven by `animation-timeline: scroll(self inline)` — present while the row overflows, 0 at the end, and 0 wherever the timeline is inactive (nothing overflows) or unsupported (`animation-duration: auto` is 0s on a time timeline, `fill-mode: both` holds the last keyframe), so no engine ever shows a fade over a row that does not scroll; no JS, no `prefers-reduced-motion` clause because nothing moves on its own. Note that `-webkit-overflow-scrolling: touch` is inert on iOS >= 13 and kept because the spec lists it. Also amend the stale parenthetical in the tap-rule comment ("about 148px at 390px, 71px at 700px") to say the bar is one 72px row at every width from ~340px up since quick-260904-dwt.

    **tests/layout-contract.test.ts.** In `describe('the console bar at phone width (G-07-3)')`, REPLACE the first `it('lets both nav flex containers wrap, …')` with the pins in `<behavior>` Tests 1–3 (three or four focused `it` blocks; keep the file's style of a comment naming WHY each pin exists — cite quick-260904-dwt, the 07-06 wrap it supersedes, and the row-scroll mechanism). Keep the two tap-target `it` blocks verbatim. Add Test 5 as a new `it` (print block hides `.nav` in both stylesheets — `rule(printBlock(REPORT_CSS), '.nav')` works because the selector list of that print rule includes `.nav`). For Test 3's `tabIndex` check, read `src/app/(console)/layout.tsx` through the existing `uncommentedTsx` helper and assert the `<nav` open tag carries no `tabIndex` (spec item 4: links are focusable already; the harness proves focus scrolls them into view). Update the describe title to name both G-07-3 and quick-260904-dwt. Do not delete any helper; do not touch the report-sheet or table describes.

    Commit as `feat(quick-260904-dwt): scroll the console link row sideways on phones instead of wrapping it` after the verify passes.
  </action>
  <verify>
    <automated>cd "~/Documents/Projects/Productised service" && npx vitest run tests/layout-contract.test.ts 2>&1 | tail -6 && npx vitest run tests/layout-contract.test.ts 2>&1 | grep -E '^\s+Tests\s+[0-9]+ passed \([0-9]+\)$' && node -e 'const css=require("fs").readFileSync("src/app/globals.css","utf8").replace(/\/\*[\s\S]*?\*\//g,"");const n=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(b=>b[1].split(",").map(s=>s.trim().replace(/\s+/g," ")).includes(".nav nav")).length;if(n!==1){console.error("expected exactly one .nav nav rule, found "+n);process.exit(1)};console.log("one .nav nav rule")' && OUT=$(mktemp -d) && node .planning/phases/07-attribution-reporting/07-06-harness/gen-nav.mjs "$OUT" "$PWD/src/app/globals.css" 390 700 && for w in 390 700; do "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --allow-file-access-from-files --window-size=900,900 --virtual-time-budget=1500 --dump-dom "file://$OUT/outer-$w.html" 2>/dev/null | grep -o '<pre id="m">[^<]*' | sed 's/<pre id="m">//;s/&quot;/"/g' | node -e 'const o=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(o.viewport+"px",JSON.stringify(o));const ok=o.docScrollWidth===o.viewport&&o.navHeight<=72&&o.navLines===1&&o.minTapBox>=44&&o.overlaps.length===0&&o.brokenMidPhrase.length===0;if(!ok)process.exit(1)'; done && npm run build 2>&1 | tail -3 && npx tsc --noEmit && npm run lint</automated>
    <human-check>On the iPhone (iOS 26.5 Safari) open /queue: the bar is one line with `Quote Recovery` fixed on the left; Inbox, Queue (badge), Audits are readable, the next item is cut at the right edge under a fade; one swipe reaches Sign out fully opaque with the fade gone; the page itself does not pan sideways; tapping each link works; in desktop Chrome at full width the bar looks exactly as before with no fade.</human-check>
  </verify>
  <done>`tests/layout-contract.test.ts` passes with the new pins; exactly one `.nav nav` rule exists; the existing 07-06 probe measures the bar at 390px as viewport-wide, <= 72px, one line, all tap boxes >= 44px with no overlaps and no label broken mid-phrase, and the same at 700px; `npm run build`, `npx tsc --noEmit`, `npm run lint` all clean; committed as `feat(quick-260904-dwt): …`.</done>
</task>

<task type="auto">
  <name>Task 2: Teach the harness the new contract — and make it fail on the old CSS first</name>
  <files>.planning/phases/07-attribution-reporting/07-06-harness/gen-nav.mjs, .planning/phases/07-attribution-reporting/07-06-harness/nav-check.sh, .planning/phases/07-attribution-reporting/07-06-harness/gen-tables.mjs, .planning/phases/07-attribution-reporting/07-06-harness/tables-check.sh, .planning/phases/07-attribution-reporting/07-06-harness/README.md</files>
  <precondition>Google Chrome is installed at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` (the 07-06 harness requirement; both scripts exit 2 otherwise) and `git show 898bce3:src/app/globals.css` resolves (the pre-change CSS used as the harness's negative control).</precondition>
  <action>
    **gen-nav.mjs — extend the synchronous probe (no requestAnimationFrame: headless Chrome barely produces frames inside the iframe; every fact below is layout geometry, which is synchronous).** Keep every existing field. Let `row = document.querySelector('.nav nav')`, `items = [...row.querySelectorAll('a, button')]`, and label each item by its text with the trailing badge digits stripped (so the Queue link reads `Queue`). Define the row's client box as `{left: r.left, right: r.left + row.clientWidth, top: r.top, bottom: r.top + row.clientHeight}` from `row.getBoundingClientRect()`; "fully inside" means the item's rect is within that box with 0.5px slack, "cut" means it intersects the box but is not fully inside. Add:
    - `barRight`: `Math.round(Math.max(...[...nav.children].map(e => e.getBoundingClientRect().right)))` — the brand and the row's OWN box. Keep `navRight` (all descendants) too; it is the 700px gate where nothing may scroll.
    - `rowClientWidth`, `rowScrollWidth`, `rowScrollable` (scrollWidth > clientWidth), `rowOverflowX` (computed `overflowX`), `rowSnap` (computed `scrollSnapType`).
    - `restScrollLeft` (must be 0 — the snap must not swallow the padding), `visibleAtRest` (labels fully inside at rest), `cutAtRest` (labels cut at rest), `maskAtRest` (computed `maskImage` string, read BEFORE any focus or scroll), `fadeAtRest` (computed `--nav-fade`).
    - `firstRingHeadroom`: min of (first item top − row top, row bottom − first item bottom, first item left − row left), one decimal.
    - Then call `.focus()` on the LAST item and record `focusScrollsLastIn` (last item fully inside the row box) and `lastRingHeadroom`: min of (row right − last right, last top − row top, row bottom − last bottom).
    - Then set `row.scrollLeft = row.scrollWidth` and record `endScrollLeft`, `endMaxScroll` (scrollWidth − clientWidth) and `endShowsSignOut` (the Sign out button fully inside). Reset `row.scrollLeft = 0` before writing the JSON.
    Update the file header: brand + seven items over the real CSS, now also measuring the sideways-scrolling row (quick-260904-dwt); note why the probe is synchronous and why the fade at 390 is INFO (frames) while its absence at 700 is a gate (inactive timeline).

    **nav-check.sh — assertions.** Keep the `set -uo pipefail`, `pass`/`failed`, `v()` helpers and the 390/604/700 loop. At EVERY width keep: `docScrollWidth == w`, `signOutBox >= 44`, `minTapBox >= 44`, no `overlaps`, no `brokenMidPhrase`. Replace the all-descendants `navRight <= w` line with `barRight <= w` ("the console bar — brand and the link row's own box — is inside the viewport") at all widths, and ADD `navRight <= w` back ONLY inside the `w = 700` branch (nothing may scroll on desktop, so every item must be inside). Add at every width: `navLines == 1` and `navHeight <= 72` ("one row"). Add at 390 and 604: `rowScrollable == true` ("the link row scrolls inside the bar"), `rowOverflowX == auto`, `restScrollLeft == 0`, `visibleAtRest` contains `Inbox` AND `Queue` ("the two clocked screens need no swipe"), the cue — `cutAtRest` non-empty OR `maskAtRest` contains `calc(` — with the measured value echoed, `firstRingHeadroom >= 3` and `lastRingHeadroom >= 3`, `focusScrollsLastIn == true` ("keyboard focus reaches Sign out without tabIndex"), `endShowsSignOut == true` ("one swipe reaches Sign out"). At 700 add: `rowScrollable == false`, `navHeight == 72` ("desktop bar unchanged"), and `maskAtRest` does NOT contain `calc(` ("no fade where nothing overflows"). Print `maskAtRest`/`fadeAtRest` at 390 as an `INFO` line either way. FAIL messages must name the same subject as their PASS twin, because the negative-control gate greps them: the scroll gate fails as `${w}px: the link row does not scroll (scrollWidth S, clientWidth C)` and the one-row gate fails as `${w}px: bar is N lines / Hpx, not one row` — both contain the word `row`. Update the header comment (G-07-3 truths + quick-260904-dwt scroll-row truths; 390 reported phone, 604 old threshold, 700 desktop; `GLOBALS_CSS=` is also how the negative control is run).

    **gen-tables.mjs / tables-check.sh.** In the measure script replace the all-descendants `navRight` with `barRight` computed as in gen-nav.mjs (max right of `document.querySelector('.nav').children`), and in `tables-check.sh` change the 390px assertion to `barRight <= 390` with the message "the console bar is inside the viewport" — the fixtures' nav now scrolls inside the bar, so descendants beyond 390 are the row's scrollable overflow, not a widened page. Add one line to the gen-tables.mjs header comment saying so (quick-260904-dwt).

    **README.md.** Rewrite the `nav-check.sh` / `gen-nav.mjs` table row: 390 / 604 / 700px iframe, asserts document exactly viewport-wide, bar inside the viewport, ONE row at every width (<= 72px), the link row scrolls at 390/604 with Inbox and Queue visible without a swipe and a cut item or fade as the cue, focus and end-scroll both reach Sign out with >= 3px ring headroom, 44px boxes, no intersecting hit boxes, and at 700 nothing scrolls and no fade; negative control = `GLOBALS_CSS=<pre-quick-260904-dwt globals.css>` must FAIL. Add a dated planner/executor evidence paragraph in the style of the existing ones.

    Commit as `test(quick-260904-dwt): measure the sideways-scrolling console row in the 07-06 harness` (the repo's established prefix for gate work, e.g. quick-260902-1x6).
  </action>
  <verify>
    <automated>cd "~/Documents/Projects/Productised service" && H=.planning/phases/07-attribution-reporting/07-06-harness && bash $H/nav-check.sh 2>&1 | tee /tmp/nav-new.log | tail -40 && grep -q '^RESULT: PASS' /tmp/nav-new.log && grep -c '  PASS  390px' /tmp/nav-new.log | awk '{ if ($1 < 13) { print "too few 390px gates: " $1; exit 1 } }' && grep -q '  PASS  700px: .*no fade' /tmp/nav-new.log && T=$(mktemp -d) && git show 898bce3:src/app/globals.css > "$T/old.css" && ( GLOBALS_CSS="$T/old.css" bash $H/nav-check.sh > "$T/old.log" 2>&1; test $? -eq 1 ) && grep -q '^RESULT: FAIL' "$T/old.log" && grep -q '  FAIL  390px: .*row' "$T/old.log" && grep -q '  FAIL  390px: .*one row\|  FAIL  390px: .*line' "$T/old.log" && bash $H/tables-check.sh 2>&1 | tail -5 | grep -q '^RESULT: PASS' && grep -c 'barRight' $H/gen-nav.mjs $H/nav-check.sh $H/gen-tables.mjs $H/tables-check.sh | awk -F: '{ if ($2 < 1) { print "missing barRight in " $1; bad=1 } } END { exit bad }' && grep -c 'quick-260904-dwt' $H/README.md | awk '{ if ($1 < 1) exit 1 }'</automated>
  </verify>
  <done>`nav-check.sh` prints `RESULT: PASS` on the shipped tree with at least 13 PASS lines at 390px including the row-scroll, cue, focus-reach, end-reach and ring-headroom gates, and `RESULT: FAIL` (exit 1) naming the row and the one-row gate when pointed at the pre-change CSS (`git show 898bce3:src/app/globals.css`); `tables-check.sh` prints `RESULT: PASS`; all four harness scripts use `barRight`; README documents the new gates; committed as `test(quick-260904-dwt): …`.</done>
</task>

<task type="auto">
  <name>Task 3: Correct the paper contract and close the G-07-3 record</name>
  <files>.planning/phases/07-attribution-reporting/07-UI-SPEC.md, .planning/debug/console-nav-overflow-390.md</files>
  <action>
    **07-UI-SPEC.md (scoped `Edit`s only — the file is 386 lines and other phases' rows must survive).**
    1. Rewrite the E8 overflow row (the `| overflow | E8 nav + pipeline link | ✅ covered | …` line, ~line 324) so it describes the shipped contract: `.nav` keeps `flex-wrap: wrap` as the fallback that puts the row under the brand only when fewer than 12rem remain (320px); `.nav nav` is a `flex-wrap: nowrap` / `overflow-x: auto` scroll container with `scroll-snap-type: x proximity`, a hidden scrollbar, a 0.25rem padding/−0.25rem margin pair for focus rings, and a scroll-driven right-edge fade (`--nav-fade`, `animation-timeline: scroll(self inline)`) that is absent when nothing overflows; measured 390px: one 72px row (176px under the 07-06 wrap), Inbox/Queue/Audits visible, Reports cut as the cue, Sign out one swipe away; 604px: 72px (124 before); 700px: unchanged; `.nav button.linkish` keeps the 44px box; the pipeline `.meta` link is one line; gated by `tests/layout-contract.test.ts` and `07-06-harness/nav-check.sh`. End the cell with the tag `[Contract correction quick-260904-dwt, 2026-09-04]` and keep the earlier `[Contract correction 07-06, 2026-09-03, G-07-3]` tag before it so the row's history reads in order. Remove the wrapped-bar sentence entirely — the row must not describe the bar as wrapping to more than one line at 390.
    2. Append, after the `### Contract corrections (07-07, 2026-09-03)` subsection (end of file), a new `### Contract corrections (quick-260904-dwt, 2026-09-04)` subsection with one intro sentence (the operator, after passing UAT test 6 on 2026-09-04, asked for a sideways-scrolling bar instead of a wrapped one; the wrap was correct for G-07-3's premise — the page must never widen — and wrong about the cost, a quarter of a phone screen on the Queue page) and one bullet **E8 — the wrapped bar traded page width for screen height.** State the mechanism (the inner row is the one box allowed to hold overflow; the outer bar wraps only as the brand's collision fallback), the measured numbers from Task 1's harness run, the four-items-cannot-fit arithmetic (121px brand + 16 gap + 40 padding leaves 221px; Inbox+Queue+Audits+Reports need 262px) and the decision that the one-row bar wins over shrinking brand or gaps, the fade's CSS-only degradation story, the no-`tabIndex` decision with the harness proof that focus scrolls Sign out into view, and that print remains untouched (`report.css` / `audit.css` still hide `.nav`). Reference the debug file's follow-up note.

    **console-nav-overflow-390.md.** Append a final section `## Follow-up (quick-260904-dwt, 2026-09-04)` (do not edit the immutable Symptoms or the append-only Evidence/Eliminated sections; leave Resolution as the record of the 07-06 fix). Say: the 07-06 wrap fixed the widening but cost three rows at 390px; on the operator's request the LINK ROW (`.nav nav`) became an `overflow-x: auto` scroll container — a different thing from the `overflow-x: hidden` on the SHELL that `fix_rationale` rejected, because a scroll container keeps every item reachable by swipe, by scroll and by keyboard focus, whereas a clipped shell made Sign out permanently unreachable; the outer `.nav` keeps `flex-wrap: wrap` as the brand-collision fallback; the falsification test in `verification` now reads: at 390px `document.documentElement.scrollWidth === 390`, the bar is one ~72px row, `.nav nav` `scrollWidth > clientWidth`, Sign out fully visible after scrolling the row to its end, no label broken mid-phrase; proven by `07-06-harness/nav-check.sh` (which FAILS on the 07-06 CSS via `GLOBALS_CSS=`) and pinned by `tests/layout-contract.test.ts`. Point at `07-UI-SPEC.md` E8 and the `### Contract corrections (quick-260904-dwt, 2026-09-04)` subsection.

    Commit both files as `docs(quick-260904-dwt): correct the E8 overflow contract and record the G-07-3 follow-up`.
  </action>
  <verify>
    <automated>cd "~/Documents/Projects/Productised service" && S=.planning/phases/07-attribution-reporting/07-UI-SPEC.md && D=.planning/debug/console-nav-overflow-390.md && test "$(grep -c '^### Contract corrections (quick-260904-dwt, 2026-09-04)' $S)" = 1 && test "$(grep -c '^### Contract corrections (07-06, 2026-09-03)' $S)" = 1 && test "$(grep -c '^### Contract corrections (07-07, 2026-09-03)' $S)" = 1 && E8=$(grep '^| overflow | E8 nav + pipeline link |' $S) && test "$(printf '%s' "$E8" | grep -c 'Contract correction quick-260904-dwt, 2026-09-04')" = 1 && test "$(printf '%s' "$E8" | grep -c 'overflow-x: auto')" >= 1 && test "$(printf '%s' "$E8" | grep -c 'three lines')" = 0 && test "$(printf '%s' "$E8" | grep -c 'Contract correction 07-06, 2026-09-03, G-07-3')" = 1 && test "$(grep -c '^## Follow-up (quick-260904-dwt, 2026-09-04)' $D)" = 1 && grep -q 'scrollWidth === 390' $D && test "$(wc -l < $S)" -ge 386 && git diff --stat HEAD~1 -- $S $D | tail -1</automated>
  </verify>
  <done>The E8 row carries the quick-260904-dwt correction tag, describes the scroll row, keeps its 07-06 tag, and no longer claims a multi-line bar; the three dated `### Contract corrections` subsections exist in order; the debug file ends with the dated follow-up section naming the scroll-row falsification test; the UI-SPEC lost no lines; committed as `docs(quick-260904-dwt): …`.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| none new | CSS on an auth-gated operator console, a pure-suite test, a local headless harness over synthetic markup, and planning documents. No network, database, env or dependency changes. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-dwt-01 | Information disclosure | 07-06 harness fixtures | low | mitigate | Fixtures stay synthetic (fixture client, fake counts); the harness never reads the database, the network or an env file — unchanged 07-06 rule, restated in the gen-nav.mjs header |
| T-dwt-02 | Denial of service (usability) | `.nav nav` scroll container | low | mitigate | Sign out and every link remain reachable by swipe, programmatic scroll and keyboard focus; `nav-check.sh` gates `endShowsSignOut` and `focusScrollsLastIn`, and the fade collapses at the scroll end so no control is dimmed |
| T-dwt-03 | Tampering | `npm test` baseline / hosted Supabase | medium | mitigate | No `npm run test:remote`, no `ALLOW_REMOTE_TESTS`; the verify gates use `npm test` (remote-gated files refuse as today) and the pure layout-contract suite |
| T-dwt-SC | Tampering | package installs | n/a | accept | No npm/pip/cargo installs in this plan; no package-legitimacy checkpoint needed |
</threat_model>

<verification>
- DECISION SURFACED FOR THE OPERATOR (must appear verbatim in the SUMMARY): spec item 3 asked for Inbox, Queue, Audits AND Reports in the first 390px screenful; that needs 262px of row against the 221px left beside the brand, so the one-row bar (spec item 4, the operator's actual complaint) wins and Reports is the partly-cut item that acts as the scroll cue. Reversible by shortening the brand or dropping a link.
- `npx vitest run tests/layout-contract.test.ts` passes with the replaced pins (Task 1).
- `npm test` keeps the baseline: every `Tests` summary line reads `N passed (N)` with no `failed` count (remote-gated file refusals are unchanged and expected; never run `test:remote`).
- `bash .planning/phases/07-attribution-reporting/07-06-harness/nav-check.sh` → `RESULT: PASS`; the same script with `GLOBALS_CSS=` pointing at `git show 898bce3:src/app/globals.css` → `RESULT: FAIL` (Task 2).
- `bash .planning/phases/07-attribution-reporting/07-06-harness/tables-check.sh` → `RESULT: PASS` (Task 2).
- `npm run build`, `npx tsc --noEmit`, `npm run lint` clean after each task.
- `git diff --stat "$BASE..HEAD" (BASE = `898bce3`, recorded before Task 1)` touches only the nine files in `files_modified` — never `src/app/(console)/reports/**`, `src/core/reporting/**`, `tests/report*.test.ts`, `report.css` or `audit.css`.
- Human (end-of-phase): iPhone check in Task 1's `<human-check>`.
</verification>

<success_criteria>
- At 390px the console bar is one ~72px row, the document is exactly 390px wide, the link row scrolls sideways with Inbox and Queue visible at rest, the next item cut or faded at the right edge, and Sign out fully visible after one swipe or on keyboard focus.
- At 700px the bar is byte-for-byte the same experience as today: one 72px line, nothing scrolls, Sign out flush right, no fade.
- All nav tap boxes >= 44px, no intersecting hit boxes, >= 3px focus-ring headroom inside the row, `.nav` still hidden in print.
- Contract pinned at source (`tests/layout-contract.test.ts`), measured by the harness (PASS on shipped CSS, FAIL on the 07-06 CSS), and corrected on paper (07-UI-SPEC E8 + dated subsection, G-07-3 follow-up).
- Three commits: `feat(quick-260904-dwt): …`, `test(quick-260904-dwt): …`, `docs(quick-260904-dwt): …`; `npm test` baseline intact; no remote tests run; no reports/reporting files touched.
</success_criteria>

<output>
Create `.planning/quick/260904-dwt-console-nav-as-a-single-sideways-scrolli/260904-dwt-SUMMARY.md` when done
</output>
