---
phase: quick-260904-dwt
verified: 2026-09-04T02:58:00Z
status: passed
score: 5/6 must-haves verified
behavior_unverified: 1
overrides_applied: 0
behavior_unverified_items:
  - truth: "The right-edge fade is CSS-only: present while the row overflows, collapsed at the scroll end so Sign out is never dimmed, and absent altogether where nothing overflows"
    test: "On the iPhone (iOS 26.5 Safari) open /queue at rest, then swipe the link row to its end"
    expected: "A fade is visible over the cut `Reports` item at rest; after the swipe `Sign out` is fully opaque and the fade has collapsed; in desktop Chrome at full width there is no fade at all"
    why_human: "`--nav-fade` measured `0px` at 390 and 604 in every headless Chrome run (mine included) — `--dump-dom` advances no scroll timeline — so no automated gate in this repo has ever observed the fade rendering or collapsing; the 700px no-fade gate passes but is non-discriminating for the same reason. The built CSS also minifies `initial-value: 0px` to `initial-value: 0`; if Safari rejects that registration the collapse flips instead of interpolating, which only a real device shows."
human_verification:
  - test: "iPhone (iOS 26.5 Safari), signed in, open /queue. Look at the bar at rest, then swipe the link row left once, then tap each link"
    expected: "One-line bar with `Quote Recovery` fixed on the left; Inbox, Queue (with badge) and Audits readable; the next item (Reports) cut at the right edge under a fade; after one swipe Sign out is fully in view and fully opaque with the fade gone; the page itself never pans sideways; every link and Sign out respond to a tap"
    why_human: "The fade's presence and collapse are scroll-timeline progress, which headless Chrome never renders; the page-pan and tap feel are on-device behaviour"
  - test: "Desktop Chrome at full window width, any console page"
    expected: "The bar is exactly as before this change: one 72px line, items flush at the right content edge, no fade, no scrollbar, nothing scrolls"
    why_human: "Measured at 700px in headless Chrome (72px, not scrollable, `navRight` 684, opaque mask) but the no-fade reading there is non-discriminating; a visual look at full width confirms the desktop experience is unchanged"
---

# Phase quick-260904-dwt: Console nav as a single sideways-scrolling row on phones — Verification Report

**Phase Goal:** Turn the console bar's link row into a single sideways-scrolling row on phones so the bar costs one line (~72px) instead of three (176px at 390px), while the page never scrolls sideways, hidden items announce themselves with a right-edge fade and a cut-off last item, Sign out stays one swipe away, keyboard focus reaches every link, tap targets stay 44px, and the printed report/audit still hide the bar. Replace the 07-06 wrap pins, extend the headless harness, correct 07-UI-SPEC E8 and the G-07-3 debug record.
**Verified:** 2026-09-04T02:58:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | At 390px the bar is ONE row of ~72px, the document is exactly 390px wide, and the link row scrolls sideways | ✓ VERIFIED | `nav-check.sh` run by the verifier on the shipped tree: `390px: document is exactly viewport-wide`, `bar is one row of 72px`, `the link row scrolls inside the bar (221px box, 502px of content)`, `overflow-x: auto`, `scrollLeft 0` at rest. Negative control (`GLOBALS_CSS=` 898bce3): `FAIL 390px: bar is 3 lines / 176px, not one row`, `FAIL 390px: the link row does not scroll (scrollWidth 350, clientWidth 350)` |
| 2 | At 390px Inbox and Queue (badge) fully visible without scrolling, the last visible item cut at the right edge, one swipe brings Sign out fully into view | ✓ VERIFIED | Harness: `visible at rest: Inbox,Queue,Audits`, `'Reports' is cut at the right edge`, `one swipe reaches Sign out (scrollLeft 281 of 281)`. Item order in `src/app/(console)/layout.tsx` confirmed Inbox, Queue, Audits, Reports, New client, Email, Sign out (unchanged) |
| 3 | The fade is CSS-only (no JS, no tabIndex): present while the row overflows, collapsed at the end, absent where nothing overflows | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Present and wired: `@property --nav-fade` (`<length>`, `0px`), `@keyframes nav-row-edge` (`0%,85% → 2.5rem`, `100% → 0px`), `mask-image: linear-gradient(... var(--nav-fade) ...)`, `animation` shorthand before `animation-timeline: scroll(self inline)`; pinned by the contract test; survives `next build` (`.next/static/chunks/0se5cw6edf8uo.css`). No JS anywhere; `<nav` open tag carries no `tabIndex`. BUT `--nav-fade` read `0px` and the mask read the fully-opaque `100%` gradient at 390 AND 604 in the verifier's run — the fade was never observed rendering or collapsing in any automated run, so the 700px "no fade" gate is satisfied without discriminating. Routed to human verification |
| 4 | At 700px the bar is unchanged: one line, 72px, nothing scrolls, Sign out flush at the right content edge, no fade | ✓ VERIFIED | Harness 700px JSON: `navHeight 72`, `navLines 1`, `rowClientWidth 531 == rowScrollWidth 531`, `rowScrollable false`, `navRight 684` (the row's own padding box; `lastRingHeadroom 3.7` puts Sign out's right edge at ~680.3 = the 680px content edge), all seven items `visibleAtRest`, mask opaque. The no-fade half rests on the deterministic inactive-timeline argument plus the desktop human look (item 2) |
| 5 | Every nav control keeps its 44px tap box, no two hit boxes intersect, focus scrolls any link into view with ≥3px ring headroom, padding/margin pair nets to zero, `.nav` hidden in printed report and audit | ✓ VERIFIED | Harness at 390/604/700: `smallest nav tap box is 44px ('Quote Recovery')`, `Sign out tap box is 44px`, `no two nav hit boxes intersect`, `first item has 4px of ring headroom`, `focused last item has 4px`, `keyboard focus scrolls Sign out into view without a tabIndex`. `.nav nav` has `padding: 0.25rem; margin: -0.25rem; scroll-padding-inline: 0.25rem`. `.nav` sits in the `display: none !important` selector list inside `@media print` in both `report.css` (print block line 274) and `audit.css` (line 133); neither file is in the diff |
| 6 | The pure suite pins the new contract (07-06 wrap pins replaced, not deleted), the harness fails on the pre-change CSS and passes on the shipped one, `npm test` keeps its 0-assertion-failure baseline | ✓ VERIFIED | `git show 898bce3:tests/layout-contract.test.ts` had `it('lets both nav flex containers wrap…')` (15 `it`s); HEAD has 0 occurrences of it and 18 `it`s — three replacement pins plus a new print pin, tap-target pins kept verbatim. `npx vitest run tests/layout-contract.test.ts` → `Tests 18 passed (18)`. `nav-check.sh`: shipped `RESULT: PASS` (exit 0, 16 PASS lines at 390px); 898bce3 CSS `RESULT: FAIL` (exit 1, 12 FAILs naming the one-row, row-scroll, overflow-x, cue and ring-headroom gates). `tables-check.sh` → `RESULT: PASS` (exit 0). Baseline: the six test files that read `globals.css` (`layout-contract`, `pipeline-grouping`, `report-list`, `rekey-resume`, `approval-queue`, `quote-triage`) were run — 0 assertion failures; the three file-level failures are the documented `Refusing to run integration tests against a non-local Supabase stack` remote-gate refusal, untouched by this phase. `test:remote` / `ALLOW_REMOTE_TESTS` never used |

**Score:** 5/6 truths verified (1 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `src/app/globals.css` | `.nav nav` scroll container, one rule; `.nav` keeps wrap; items `flex: 0 0 auto` snap starts; first-child auto margin; explicit focus ring; `@property` + keyframes | ✓ VERIFIED | Exactly one `.nav nav` rule (parser count 1, `@supports` count 0). Declarations in the planned order. `.nav`, tap rule, `button.linkish`, `.nav form` untouched (third diff hunk is comment-only). Block comment rewritten with the measured numbers, the four-items arithmetic, the WR-03 comparison and the degradation story; stale "148px at 390px" parenthetical amended |
| `tests/layout-contract.test.ts` | Scroll-row contract pinned, wrap fallback, padding/margin pair, 44px, print-hidden `.nav` | ✓ VERIFIED | Describe renamed `(G-07-3, quick-260904-dwt)`; pins match the plan's Tests 1–5; passes 18/18 |
| `07-06-harness/gen-nav.mjs` + `nav-check.sh` | Row-scroll facts, visible/cut sets, ring headroom, focus/end reach, computed mask; gates at 390/604/700 | ✓ VERIFIED | Probe adds `barRight`, `row*`, `restScrollLeft`, `visibleAtRest`, `cutAtRest`, `maskAtRest`, `fadeAtRest`, `firstRingHeadroom`, `focusScrollsLastIn`, `lastRingHeadroom`, `end*`; synchronous; resets `scrollLeft`. Script gates all planned assertions; run first-hand both ways |
| `07-06-harness/gen-tables.mjs` + `tables-check.sh` | `barRight` replaces all-descendants `navRight` | ✓ VERIFIED | Both files use `barRight`; header comment added; `tables-check.sh` PASS at 390 and 1000 with `control-bare` still widening to 620 |
| `07-06-harness/README.md` | Row rewritten + dated evidence paragraph | ✓ VERIFIED | `nav-check.sh` row describes every new gate and the negative control; dated paragraph appended |
| `07-UI-SPEC.md` | E8 corrected with the quick-260904-dwt tag and a dated subsection | ✓ VERIFIED | E8 row keeps `[Contract correction 07-06, 2026-09-03, G-07-3]` first, ends with `[Contract correction quick-260904-dwt, 2026-09-04]`, describes `overflow-x: auto`, no "three lines" claim. Three `### Contract corrections` subsections in date order; file grew 386 → 397 lines |
| `.planning/debug/console-nav-overflow-390.md` | Dated follow-up: shell never clips, link row is the scroll box | ✓ VERIFIED | `## Follow-up (quick-260904-dwt, 2026-09-04)` appended; Symptoms/Evidence/Eliminated/Resolution untouched; contains `scrollWidth === 390` |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `.nav nav { flex: 1 1 12rem; min-width: 0; overflow-x: auto }` | one 72px row beside the brand at ≥ ~365px | flex basis 192px | ✓ WIRED | 390: row 221px wide on the brand's line, 72px bar; 604: 435px; 700: 531px |
| `.nav nav > :first-child { margin-inline-start: auto }` | flush-right at desktop, scroll-from-start on phone | auto margin collapse | ✓ WIRED | 700: last item right ≈ 680.3 (content edge); 390: `restScrollLeft 0`, Inbox first visible |
| `@property --nav-fade` + `@keyframes nav-row-edge` + `animation-timeline: scroll(self inline)` | fade 2.5rem while overflowing, 0 at end/inactive | scroll-driven animation | ⚠️ WIRED, BEHAVIOR UNVERIFIED | All three present in source and build; `--nav-fade` never advanced past `0px` in headless Chrome — see Truth 3 |
| `padding: 0.25rem; margin: -0.25rem; scroll-padding-inline: 0.25rem` | 3px ring not clipped, no hit box moves | padding/margin pair | ✓ WIRED | ring headroom 4px first/last at 390/604; no overlaps; bar height unchanged at 72 |
| `rule(GLOBALS_CSS, '.nav nav')` | exactly one `.nav nav` rule | test helper refuses ambiguity | ✓ WIRED | count 1; test passes |
| `nav-check.sh GLOBALS_CSS=` + `git show 898bce3:src/app/globals.css` | harness FAILS on old CSS | negative control | ✓ WIRED | exit 1, `RESULT: FAIL`, 12 FAIL lines naming `row` and `one row` |

### Data-Flow Trace (Level 4)

Not applicable — CSS, a pure-suite test over stylesheet text, a headless harness over synthetic markup, and planning documents. No rendered data values.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Contract pins pass | `npx vitest run tests/layout-contract.test.ts` | `Tests 18 passed (18)` | ✓ PASS |
| Exactly one `.nav nav` rule | node rule-count script | `nav nav rules: 1` | ✓ PASS |
| Types / lint / build | `npx tsc --noEmit`; `npm run lint`; `npm run build` | exit 0 / 0 / 0 | ✓ PASS |
| Built CSS keeps the fade machinery | grep on `.next/static/chunks/0se5cw6edf8uo.css` | `@property --nav-fade{syntax:"<length>";inherits:false;initial-value:0}`, `@keyframes nav-row-edge{0%,85%{--nav-fade:2.5rem}to{--nav-fade:0px}}`, `animation-timeline:scroll(self inline)` | ✓ PASS (see Info note on `initial-value:0`) |
| Other `globals.css` readers unaffected | `npx vitest run` on the five other files | 72 passed, 0 assertion failures; 3 remote-gate refusals (documented baseline) | ✓ PASS |
| Diff scope | `git diff --stat 898bce3..HEAD` | 9 files, exactly `files_modified`; 3 commits `adc6f2d`, `d9f7150`, `086e8fa` | ✓ PASS |

### Probe Execution

| Probe | Command | Result | Status |
| --- | --- | --- | --- |
| `07-06-harness/nav-check.sh` (shipped tree) | `bash nav-check.sh` | exit 0, `RESULT: PASS`, 16 PASS at 390px incl. `700px: no fade where nothing overflows` | PASS |
| `07-06-harness/nav-check.sh` (negative control) | `GLOBALS_CSS=<898bce3 globals.css> bash nav-check.sh` | exit 1, `RESULT: FAIL` — `390px: bar is 3 lines / 176px, not one row`, `390px: the link row does not scroll (scrollWidth 350, clientWidth 350)`, `overflow-x is visible, not auto`, `nothing cues the overflow`, `0px of ring headroom` (×2), same six at 604px | PASS (fails as required) |
| `07-06-harness/tables-check.sh` | `bash tables-check.sh` | exit 0, `RESULT: PASS`; `control-bare @390` still widens to 620 | PASS |

### Requirements Coverage

`requirements: []` in the plan; no REQUIREMENTS.md IDs map to a quick task. Nothing orphaned.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| — | — | No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` in any of the nine changed files | — | — |
| `.next/static/chunks/*.css` (build output) | — | Minifier rewrote `@property --nav-fade { initial-value: 0px }` to `initial-value:0` | ℹ️ Info | Chromium accepts unitless `0` for a `<length>` registration; if Safari rejects the registration the property is unregistered and the end-of-row collapse flips rather than interpolates (still "no fade where nothing overflows", still scrollable). Watch for it on the iPhone check; if seen, the fix is a Lightning CSS/minifier exclusion or `initial-value: 0.001px` — not a gap in this phase |
| `07-06-harness/nav-check.sh` | 700px branch | The `no fade where nothing overflows` gate cannot fail in headless Chrome (no width shows a fade there) | ℹ️ Info | Honestly documented in the script, the README, the UI-SPEC and SUMMARY deviation 2; the gate remains correct by design (inactive timeline) and is not evidence of the fade — hence the human item |

### Human Verification Required

#### 1. iPhone: one-line bar, cut item under a fade, one swipe to Sign out

**Test:** On the iPhone (iOS 26.5 Safari), signed in, open `/queue`. Look at the bar at rest; swipe the link row left once; tap each link and Sign out.
**Expected:** One-line bar with `Quote Recovery` fixed left; Inbox, Queue (badge), Audits readable; Reports cut at the right edge under a visible fade; after one swipe Sign out is fully in view and fully opaque with the fade gone; the page never pans sideways; every control responds to a tap.
**Why human:** The fade's presence and its collapse are scroll-timeline progress. `--nav-fade` measured `0px` at 390 and 604 in every headless run (the verifier's included), so no automated gate has ever seen the fade render. The built CSS's `initial-value:0` is the one thing that could make the collapse abrupt on Safari; only the device shows it.

#### 2. Desktop Chrome: bar unchanged

**Test:** Desktop Chrome at full window width, any console page.
**Expected:** One 72px line, items flush at the right content edge, no fade, no scrollbar, nothing scrolls — identical to before this change.
**Why human:** Measured at 700px (72px, not scrollable, mask opaque) but the no-fade reading is non-discriminating in headless Chrome; a visual look confirms the desktop experience.

### Gaps Summary

No gaps. Every must-have that headless Chrome, the pure suite, `tsc`, `lint` and `next build` can observe was re-run by the verifier and holds: the bar is one 72px row at 390/604/700 with the document exactly viewport-wide, the link row is the single scroll box (221/502 at 390), Inbox/Queue/Audits are whole with Reports cut, Sign out is reached by focus and by one swipe with 4px of ring headroom, every tap box is 44px with no intersections, `.nav` is still hidden in both print sheets, the 07-06 pins were replaced (15 → 18 tests), the harness fails on the pre-change CSS and passes on the shipped one, and the paper contract (E8 + dated subsection, G-07-3 follow-up, DECISION SURFACED line) is in place. The one behaviour no gate in this repo can see — the fade rendering while the row overflows and collapsing at the end — is present, wired and pinned in source, and is handed to the iPhone check above rather than counted as verified.

---

_Verified: 2026-09-04T02:58:00Z_
_Verifier: Claude (gsd-verifier)_

## Human verification result (2026-09-04)

Both human items settled by the operator on 2026-09-04 ("pass"): iPhone one-row bar with the cut item under the fade and one swipe to Sign out; desktop bar unchanged.
