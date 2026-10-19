---
phase: quick-260904-dwt
plan: 01
subsystem: console-ui
status: complete
tags: [css, layout, accessibility, harness, contract]
requires:
  - 07-06 nav wrap (G-07-3) — superseded in place, not deleted
  - 07-06-harness (headless Google Chrome)
provides:
  - "`.nav nav` as the console bar's sideways-scrolling link row (one 72px bar at every width from ~365px up)"
  - "scroll-row contract pinned at source in tests/layout-contract.test.ts"
  - "nav-check.sh row-scroll / cue / ring-headroom / reachability gates with a working negative control"
  - "bar-level `barRight` measure replacing the all-descendants `navRight` in both nav probes"
affects:
  - src/app/globals.css (.nav region only)
  - .planning/phases/07-attribution-reporting/07-06-harness/
tech-stack:
  added: []
  patterns:
    - "scroll-driven CSS animation (`@property` + `animation-timeline: scroll(self inline)`) as a progressive-enhancement affordance that degrades to nothing"
    - "padding/negative-margin pair sized to a known focus-ring extent, netting to zero layout inside a scroll container"
key-files:
  created: []
  modified:
    - src/app/globals.css
    - tests/layout-contract.test.ts
    - .planning/phases/07-attribution-reporting/07-06-harness/gen-nav.mjs
    - .planning/phases/07-attribution-reporting/07-06-harness/nav-check.sh
    - .planning/phases/07-attribution-reporting/07-06-harness/gen-tables.mjs
    - .planning/phases/07-attribution-reporting/07-06-harness/tables-check.sh
    - .planning/phases/07-attribution-reporting/07-06-harness/README.md
    - .planning/phases/07-attribution-reporting/07-UI-SPEC.md
    - .planning/debug/console-nav-overflow-390.md
decisions:
  - "The one-row bar wins over fitting a fourth item in the first 390px screenful; `Reports` is deliberately the cut item that cues the scroll"
  - "The link row gets no `tabIndex` — unlike `.table-scroll` it is full of focusable children, and the harness measures that focus scrolls `Sign out` into view"
  - "Both nav probes measure `barRight` (brand + the row's own box), not the all-descendants `navRight`, which now reads the row's scrollable overflow"
  - "The 604px cue gate accepts a wired fade, not only a rendered one — headless Chrome advances no scroll timeline"
metrics:
  duration: ~35 min
  completed: 2026-09-04
actuals:
  tokens: 26000
  tasks: 3
  commits: 3
---

# Phase quick-260904-dwt Plan 01: Console nav as a single sideways-scrolling row on phones Summary

The console link row became an `overflow-x: auto` scroll container, so the bar costs ONE 72px row at 390px instead of the three (176px) the 07-06 wrap cost, with the page still exactly 390px wide and every item reachable by swipe, scroll and keyboard focus.

## What Was Built

**Task 1 — `.nav nav` is the box that scrolls** (`adc6f2d`)

`src/app/globals.css`, `.nav` region only:

- `.nav nav` rewritten as ONE rule: `flex-wrap: nowrap`, `flex: 1 1 12rem`, `min-width: 0`, `overflow-x: auto`, `scroll-snap-type: x proximity`, `scroll-padding-inline: 0.25rem`, `scrollbar-width: none`, `-webkit-overflow-scrolling: touch`, `padding: 0.25rem` / `margin: -0.25rem`, a `mask-image` gradient over `var(--nav-fade)`, and `animation: nav-row-edge linear both` before `animation-timeline: scroll(self inline)` (the shorthand resets the timeline, so the order is load-bearing).
- `@property --nav-fade` (`<length>`, initial `0px`) and `@keyframes nav-row-edge` (`0%,85% → 2.5rem`, `100% → 0px`) — the fade holds full width until 85% of the scroll range then collapses, so the final item is never dimmed at the end.
- `.nav nav::-webkit-scrollbar { display: none }`, `.nav nav > * { flex: 0 0 auto; scroll-snap-align: start }` (`> *` because the last item is the `<form>` around Sign out), `.nav nav > :first-child { margin-inline-start: auto }` (auto margins absorb free space at desktop and collapse to 0 under overflow — `justify-content: flex-end` would push the START of the row out of reach), and an explicit `outline: 2px solid var(--accent); outline-offset: 1px` focus ring so the ring's extent is the known 3px the row's padding is sized against.
- `.nav` untouched (`flex-wrap: wrap` survives as the brand-collision fallback), tap rule untouched, `.nav form` untouched.
- The block comment above `.nav` rewritten — it claimed "BOTH FLEX CONTAINERS WRAP", which is now false for the inner row — with the measured numbers, the four-items arithmetic, the honest WR-03 comparison for the padding/margin pair, and the fade's degradation story. The stale "(about 148px at 390px, 71px at 700px)" parenthetical in the tap-rule comment corrected.

`tests/layout-contract.test.ts`: the 07-06 `lets both nav flex containers wrap` pin REPLACED by three pins (scroll-row declarations incl. the negative `not.toMatch(/flex-wrap: wrap;/)` on the row; the padding/margin pair asserted TOGETHER plus the item and first-child rules; the registered property, the keyframes, and the absent `tabIndex` read through `uncommentedTsx`), the two tap-target pins kept verbatim, and a new pin that both print sheets still hide `.nav`. 15 → 18 tests.

**Task 2 — the harness measures it, and fails on the old CSS** (`d9f7150`)

`gen-nav.mjs` keeps every existing field and adds `barRight`, `rowClientWidth`/`rowScrollWidth`/`rowScrollable`/`rowOverflowX`/`rowSnap`, `restScrollLeft`, `visibleAtRest`/`cutAtRest` (labels with the badge digits stripped), `maskAtRest`/`fadeAtRest` (read before anything is focused or scrolled), `firstRingHeadroom`, then focuses the last item for `focusScrollsLastIn`/`lastRingHeadroom`, then scrolls the row to its end for `endScrollLeft`/`endMaxScroll`/`endShowsSignOut` and resets. Synchronous throughout — headless Chrome produces almost no animation frames inside an iframe and every fact here is layout geometry.

`nav-check.sh` gates `barRight <= w`, one row (`navLines == 1 && navHeight <= 72`) and the existing G-07-3 truths at every width; row-scroll, resting scrollLeft, Inbox+Queue visible, a right-edge cue, ≥3px ring headroom on the first and focused-last item, focus reach and end reach at 390/604; and at 700 `navRight <= 700`, `rowScrollable == false`, exactly 72px, and no fade. `gen-tables.mjs`/`tables-check.sh` moved to `barRight`. README row rewritten with a dated evidence paragraph.

**Task 3 — the paper contract** (`086e8fa`)

07-UI-SPEC E8 rewritten (07-06 tag kept ahead of the new `[Contract correction quick-260904-dwt, 2026-09-04]`, no surviving claim of a multi-line bar) plus a `### Contract corrections (quick-260904-dwt, 2026-09-04)` subsection. The G-07-3 debug record gained a `## Follow-up (quick-260904-dwt, 2026-09-04)` section restating the falsification test for the scrolling contract, leaving Symptoms / Evidence / Eliminated / Resolution untouched.

## DECISION SURFACED FOR THE OPERATOR

DECISION SURFACED FOR THE OPERATOR (must appear verbatim in the SUMMARY): spec item 3 asked for Inbox, Queue, Audits AND Reports in the first 390px screenful; that needs 262px of row against the 221px left beside the brand, so the one-row bar (spec item 4, the operator's actual complaint) wins and Reports is the partly-cut item that acts as the scroll cue. Reversible by shortening the brand or dropping a link.

## Measurements

Headless Google Chrome 152, the 07-06 iframe fixture over the shipped `globals.css`, Queue badge showing.

| width | doc scrollWidth | bar | barRight / navRight | row client / scroll | visible at rest | cut | ring headroom (first / focused last) | focus reaches Sign out | end scroll | mask at rest |
|---|---|---|---|---|---|---|---|---|---|---|
| 320 | 320 | 124px / 2 lines (wrap fallback) | 304 / 514 | 288 / 502 | Inbox, Queue, Audits, Reports | — | 4 / 4 | yes | 214 of 214 | opaque |
| **390** | **390** | **72px / 1 row** (176px before) | 374 / 651 | **221 / 502** | **Inbox, Queue, Audits** | **Reports** | 4 / 4 | yes | **281 of 281** | opaque (see deviation 2) |
| 604 | 604 | 72px / 1 row (124px before) | 588 / 651 | 435 / 502 | all but Sign out | — | 4 / 4 | yes | 67 of 67 | opaque |
| **700** | **700** | **72px / 1 row (unchanged)** | 684 / 684 | **531 / 531 — not scrollable** | all seven | — | 4 / 3.7 | already inside | n/a | opaque, **no fade** |

## Verification

| Command | Result |
|---|---|
| `npx vitest run tests/layout-contract.test.ts` | `Tests 18 passed (18)` |
| `npm test` | `Tests 2437 passed (2437)`, `Test Files 39 failed \| 74 passed (113)` — **0 assertion failures**, 39 remote-gated file refusals = the documented baseline. `test:remote` never run, `ALLOW_REMOTE_TESTS` never set |
| `bash 07-06-harness/nav-check.sh` (shipped tree) | **`RESULT: PASS`**, exit 0, **16 PASS lines at 390px** (≥13 required), incl. `PASS 700px: no fade where nothing overflows` |
| `GLOBALS_CSS=$(git show 898bce3:src/app/globals.css) bash nav-check.sh` | **`RESULT: FAIL`**, exit 1 — `FAIL 390px: bar is 3 lines / 176px, not one row`, `FAIL 390px: the link row does not scroll (scrollWidth 350, clientWidth 350)`, `FAIL 390px: the row's overflow-x is visible, not auto`, `FAIL 390px: nothing cues the overflow — no item cut and no fade (none)`, `FAIL 390px: first item has only 0px of ring headroom` (+ the same six at 604px) |
| `bash 07-06-harness/tables-check.sh` | `RESULT: PASS` after the `navRight → barRight` change |
| exactly one `.nav nav` rule in globals.css | `1` (the contract test's `rule()` refuses ambiguity) |
| `npx tsc --noEmit` / `npm run lint` / `npm run build` | clean after each task |
| `git diff --stat 898bce3..HEAD` | 9 files, exactly the plan's `files_modified`; no `reports/**`, `core/reporting/**`, `tests/report*.test.ts`, `report.css` or `audit.css` |
| built CSS check | `@property --nav-fade{syntax:"<length>";inherits:false;initial-value:0}`, `@keyframes nav-row-edge{0%,85%{--nav-fade:2.5rem}to{--nav-fade:0px}}`, `animation-timeline:scroll(self inline)` all survive the Next 16 build |

## Deviations from Plan

**1. [Rule 3 — blocking] The 604px cue gate as specified cannot pass in the required environment.**
- **Found during:** Task 2, first full `nav-check.sh` run (`FAIL 604px: nothing cues the overflow`).
- **Issue:** The plan's cue gate is `cutAtRest` non-empty OR `maskAtRest` contains `calc(`. At 604px the row's right edge lands in the GAP between `Email` and `Sign out`, so nothing is cut (`cutAtRest: []`, `visibleAtRest` = six of seven); and headless Chrome under `--dump-dom` advances no scroll timeline, so the mask reads its opaque fallback whatever the CSS says. Neither branch can be satisfied — the gate was unpassable on correct CSS.
- **Fix:** a third branch — if nothing is cut and no `calc(` is present, the mask must still be a `linear-gradient` (the fade is WIRED). That keeps the gate discriminating: the 07-06 CSS has no mask at all (`none`) and still FAILs, which the negative control confirms. The rendered fade is reported as `INFO` at both scrolling widths and remains the iPhone human check.
- **Files:** `nav-check.sh` (branch + the reasoning written into the script). **Commit:** `d9f7150`.

**2. [Observation, not a fix] The fade did not render in ANY headless run**, including 390px where the planner saw `calc(100% - 40px)` in most runs. `--nav-fade` measured `0px` at 320/390/604/700. This is the frame-starvation the planner flagged, and it is exactly the "no fade, still scrollable" degradation the CSS is designed for — the 390px cue gate passes on the cut `Reports` item regardless. Consequence to be honest about: **the 700px "no fade" gate is satisfied but not discriminating in headless Chrome**, since no width shows a fade there. The fade is unverified except by design analysis until the iPhone check below.

**3. [Mechanical] Backticks inside the `gen-nav.mjs` inner-page template literal.** The probe source lives in a JS template literal; comments written in the repo's usual backtick-quoting style terminated it (`SyntaxError` on first run). Fixed by quoting identifiers with `'` inside that region only. No behaviour change.

Nothing else deviated. No architectural change (Rule 4) arose; no package installs; no new dependencies.

## Known Stubs

None.

## Threat Flags

None. No network, database, env or dependency surface changed — CSS on an auth-gated console, a pure-suite test, a local headless harness over synthetic markup, and planning documents. T-dwt-01 (fixtures stay synthetic) restated in the `gen-nav.mjs` header; T-dwt-02 (no control becomes unreachable) is now gated by `focusScrollsLastIn` + `endShowsSignOut`; T-dwt-03 (no remote tests) held — `npm test` only.

## Outstanding Human Check

On the iPhone (iOS 26.5 Safari), `/queue`: the bar is one line with `Quote Recovery` fixed left; Inbox, Queue (badge), Audits readable; the next item cut under a right-edge fade; one swipe reaches `Sign out` fully opaque with the fade gone; the page itself does not pan sideways; every link taps. In desktop Chrome at full width the bar looks exactly as before with no fade. **The fade's travel is the one part of the contract no automated gate in this repo can observe** (deviation 2).

## Self-Check: PASSED

- `src/app/globals.css` FOUND · `tests/layout-contract.test.ts` FOUND · all five `07-06-harness/` files FOUND · `07-UI-SPEC.md` FOUND · `console-nav-overflow-390.md` FOUND
- Commits FOUND in `git log --oneline`: `adc6f2d`, `d9f7150`, `086e8fa`
- `git diff --stat 898bce3..HEAD` = exactly the 9 files claimed above
