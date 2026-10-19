---
phase: 09-landing-page-audit-intake
plan: "11"
subsystem: ui
tags: [marketing, css, layout, brand, privacy, footer, typography]
gap_closure: true
gap_ids: ["G-09-3", "G-09-4", "G-09-5"]

requires:
  - phase: 09-02
    provides: "src/core/brand.ts contact and legal identity constants + footerIdentityLine(), pinned by tests/brand.test.ts"
  - phase: 09-05
    provides: "the public site shell, marketing.css, the .wrap/.measure containers and the privacy copy"
  - phase: 09-10
    provides: "tests/marketing-css-contract.test.ts — the CSS-contract harness this plan extended"
provides:
  - "No public surface names the founder's suburb; the footer is Backdesk · ABN · Perth WA · email · phone"
  - "One left edge on desktop: header, hero, every section and the footer all start at the .wrap inner edge"
  - "ABN_DISPLAY — the ABN as one unbreakable U+00A0-joined token, rendered on every HTML surface"
  - "CSS-contract gates for the container, the measure, both bars and the markup that uses them"
affects: [landing-page, privacy-notice, printed-audit, monthly-report, future-marketing-pages]

actuals:
  tokens: 12000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "The gutter belongs to the container (.wrap), never to a full-width bar"
    - "A private groups array is the one spelling of a legal identifier; the plain and non-breaking forms are both derived from it"
    - "CSS-contract tests assert expanded shorthand sides, not substring matches on a declaration"

key-files:
  created: []
  modified:
    - "src/core/brand.ts"
    - "src/app/(marketing)/marketing.css"
    - "src/app/(marketing)/layout.tsx"
    - "src/app/(marketing)/copy.ts"
    - "src/app/(marketing)/page.tsx"
    - "src/app/(marketing)/audit/page.tsx"
    - "src/app/(marketing)/audit/thanks/page.tsx"
    - "src/app/(marketing)/privacy/page.tsx"
    - "src/app/(console)/audits/[id]/page.tsx"
    - "src/app/(console)/reports/[client]/[reportId]/page.tsx"
    - "tests/brand.test.ts"
    - "tests/marketing-css-contract.test.ts"
    - "tests/marketing-metadata.test.ts"
    - "tests/privacy-page.test.ts"

key-decisions:
  - "BUSINESS_SUBURB was renamed to BUSINESS_LOCATION ('Perth WA') rather than deleted: the footer still owes a reader a city, and one constant keeps one spelling of it"
  - "The ABN's digits now live in a module-private ABN_GROUPS array; BUSINESS_ABN (plain) and ABN_DISPLAY (U+00A0) are both derived, so the canonical and display forms cannot drift"
  - "footerIdentityLine() keeps its abn parameter and prints what it is handed; the CALL SITES that render HTML pass ABN_DISPLAY, which leaves the builder's 'never emits a number it was not given' promise intact"
  - "The header and footer keep their full-width rule and background; only the horizontal padding moved into an inner .wrap, so the bars still run edge to edge"
  - "The two A4 print pages were switched to ABN_DISPLAY too — 'unbreakable on every surface' includes the documents that leave the building, and U+00A0 cannot change a line that does not wrap"

patterns-established:
  - "Container owns the gutter: a full-width bar carries vertical padding, borders and background; horizontal padding lives on .wrap alone"
  - "`.measure` caps a width, it never centres a box — it nests inside `.wrap` and states margin-left: 0"
  - "Legal identifiers with two required renderings are derived from one private source and pinned equal in the test, the way the two phone shapes already were"

requirements-completed: ["LAND-01", "LAND-05"]

coverage:
  - id: D1
    description: "The founder's suburb is gone from every public surface; ABN, Perth WA, email and phone remain (G-09-3)"
    requirement: "LAND-05"
    verification:
      - kind: unit
        ref: "tests/brand.test.ts#names the former SUBURB nowhere under src/ either (G-09-3, UAT 10 Sep 2026)"
        status: pass
      - kind: unit
        ref: "tests/privacy-page.test.ts#says who is behind the service, with the ABN (D-16)"
        status: pass
      - kind: e2e
        ref: "curl -s https://backdesk.com.au/privacy | grep -c Perth -> 0; same on / -> 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "Header, hero, sections and footer share one left edge at desktop width; phone layout unchanged (G-09-4)"
    requirement: "LAND-01"
    verification:
      - kind: unit
        ref: "tests/marketing-css-contract.test.ts#the page has ONE left edge, and it is the container's (G-09-4)"
        status: pass
      - kind: automated_ui
        ref: "CDP getBoundingClientRect on https://backdesk.com.au/ at 1440x900: header lockup / hero h1 / hero button / ol.steps / #pricing-h / footer p all left=228"
        status: pass
      - kind: automated_ui
        ref: "same measurement at 390px: every edge left=20, scrollWidth 390, tiers single column"
        status: pass
    human_judgment: true
    rationale: "Alignment is a visual judgment as much as a number — the operator should confirm the page now reads as one column on their own 1440px screen and on their phone."
  - id: D3
    description: "The ABN renders as one unbreakable token on every surface (G-09-5)"
    requirement: "LAND-05"
    verification:
      - kind: unit
        ref: "tests/brand.test.ts#renders the ABN as ONE unbreakable token, digit for digit the same number (G-09-5)"
        status: pass
      - kind: unit
        ref: "tests/privacy-page.test.ts#says who is behind the service, with the ABN (D-16)"
        status: pass
      - kind: automated_ui
        ref: "CDP Range.getClientRects over the ABN text on https://backdesk.com.au/privacy at 390px -> 1 line box (114px); on / at 320px -> 1 line box (115px)"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-09-10
status: complete
---

# Phase 09 Plan 11: UAT Gap Closure (suburb, desktop alignment, ABN wrap) Summary

**The public site drops the founder's suburb, aligns header, hero, sections and footer to one container edge at x=228 on a 1440px screen, and renders the ABN as a single U+00A0-joined token that no longer breaks across lines on a phone.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-09-10T10:00:26Z (18:00:26 AWST)
- **Completed:** 2026-09-10T10:23:07Z (18:23 AWST), production deploy READY
- **Tasks:** 3
- **Files modified:** 14

## Accomplishments

- **G-09-3 — the suburb is gone.** `BUSINESS_SUBURB` became `BUSINESS_LOCATION = 'Perth WA'`; the footer line, the privacy intro, the printed audit and the monthly report all shortened by one fact and kept the four that matter (ABN, city, email, phone). A walk over every file in `src/` now fails if the string comes back.
- **G-09-4 — one left edge.** The header's and footer's own 20px gutter moved into an inner `.wrap`, and `wrap measure` on a single element was split into `.wrap > .measure` on all five public pages. Live at 1440px: header lockup, hero h1, hero button, `ol.steps`, the pricing h2 and the footer paragraph all measure **left = 228px**. At 390px every one of them is at 20px, with no horizontal scroll.
- **G-09-5 — the ABN is one token.** `ABN_DISPLAY` joins the four groups with U+00A0 and is what every HTML surface renders. Measured live with a Range over the rendered text: **one line box** at 390px on `/privacy` (the width that broke it at UAT) and at 320px on the home-page footer.
- The CSS-contract test grew six gates, each mutation-checked: reverting the header padding fails the padding gate, and putting `wrap measure` back fails the markup gate.

## Task Commits

1. **Task 1: Drop the suburb everywhere; keep the phone (G-09-3)** — `586d8bb` (fix)
2. **Task 2: One container edge on desktop (G-09-4)** — `d04e8ee` (fix)
3. **Task 3: Unbreakable ABN (G-09-5)** — `54c5de5` (fix)

## Files Created/Modified

- `src/core/brand.ts` — `BUSINESS_LOCATION` replaces `BUSINESS_SUBURB`; private `ABN_GROUPS` now the one spelling of the digits, with `BUSINESS_ABN` (plain) and the new `ABN_DISPLAY` (U+00A0) derived from it. Eighteen exports.
- `src/app/(marketing)/marketing.css` — header and footer keep vertical padding, border and background; the horizontal gutter moved to `.wrap`; new `.site-header .wrap` carries the flex row; `.measure` states `margin-left: 0`; the footer paragraph's duplicate `max-width` removed.
- `src/app/(marketing)/layout.tsx` — `<div className="wrap">` inside the header and inside the footer; the footer line is built from `footerIdentityLine(ABN_DISPLAY)`.
- `src/app/(marketing)/page.tsx`, `audit/page.tsx`, `audit/thanks/page.tsx`, `privacy/page.tsx` — `wrap measure` split into `.wrap > .measure` (six blocks in total).
- `src/app/(marketing)/copy.ts` — privacy date line reads "operated by Hesam Abbaszadi, Perth WA. ABN <nbsp form>."
- `src/app/(console)/audits/[id]/page.tsx`, `src/app/(console)/reports/[client]/[reportId]/page.tsx` — the two A4 footers pass `ABN_DISPLAY`.
- `tests/brand.test.ts` — eighteen-export pin, the `Perth` walk, the two ABN-form tests, the A4 pin updated.
- `tests/marketing-css-contract.test.ts` — the G-09-4 block: container, measure, both bars, header row, and two markup walks over the whole route group.
- `tests/marketing-metadata.test.ts`, `tests/privacy-page.test.ts` — pins follow the new call and the non-breaking ABN.

## Decisions Made

See `key-decisions` in the frontmatter. The load-bearing one: the ABN's digits are written once, as four groups, in a module-private constant — the plain form and the non-breaking form are both `join`ed from it, and the test asserts they are the same number rather than trusting two hand-typed strings. That mirrors what the module already does with the display and E.164 phone.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The privacy intro string lives in `copy.ts`, not `privacy/page.tsx`**
- **Found during:** Task 1
- **Issue:** The plan named `src/app/(marketing)/privacy/page.tsx` for the "operated by …" sentence, but the page renders `PRIVACY_COPY` and the sentence is built in `src/app/(marketing)/copy.ts` from the brand constants.
- **Fix:** Edited `copy.ts` (and again in Task 3 for the ABN form). `privacy/page.tsx` changed only for the container split in Task 2.
- **Verification:** `tests/privacy-page.test.ts` passes against the copy module; live `/privacy` shows the new sentence.
- **Committed in:** `586d8bb`, `54c5de5`

**2. [Rule 2 - Missing Critical] A fifth public page carried `wrap measure`**
- **Found during:** Task 2
- **Issue:** The plan listed four TSX files; `src/app/(marketing)/audit/thanks/page.tsx` — the post-submit confirmation, a public page — had the same centred container.
- **Fix:** Split there too, and the new markup gate walks the whole `(marketing)` route group rather than a list of four files, so a sixth page cannot ship with it.
- **Verification:** `curl -s https://backdesk.com.au/audit/thanks | grep -c 'wrap measure'` → 0.
- **Committed in:** `d04e8ee`

**3. [Rule 2 - Missing Critical] The two A4 print pages were not in Task 3's file list**
- **Found during:** Task 3
- **Issue:** The must-have truth says the ABN is one unbreakable token *on every surface*, and the printed audit and the monthly report are surfaces. They passed `BUSINESS_ABN`.
- **Fix:** Both now pass `ABN_DISPLAY`. The A4 layout does not change: U+00A0 differs from a space only in that a browser may not break at it, and the footer line got *shorter* this phase (the suburb left it), so it is further from any wrap threshold than the version already verified in UAT.
- **Verification:** `tests/brand.test.ts` A4 pins pass; `npx next build` clean.
- **Committed in:** `54c5de5`

**4. [Rule 3 - Blocking] `tests/marketing-metadata.test.ts` pinned the old call**
- **Found during:** Task 3
- **Issue:** The suite pins the literal `footerIdentityLine(BUSINESS_ABN).split(' · ')` in the layout source; the call changed.
- **Fix:** Import and pin updated to `ABN_DISPLAY`. The five-segment split and the mailto/tel comparison are unchanged (the suburb rename kept the segment count at five).
- **Verification:** Suite passes.
- **Committed in:** `54c5de5`

---

**Total deviations:** 4 auto-fixed (2 blocking, 2 missing critical)
**Impact on plan:** All four were required to make the plan's own must-have truths true. No scope creep — nothing outside the three gaps changed.

## Issues Encountered

- **No before/after measurement from the previous deployment.** The prior production build's `*.vercel.app` URL sits behind Vercel deployment protection (it served the Vercel login page to headless Chrome), so the "before" numbers in this summary are the ones recorded in the plan's context from the UAT session (header at 20, sections at 228, hero at 417), not a fresh measurement.
- **The header is 81px tall, not 64px, and always was.** The plan's phone truth says "header 64px". Measured live at both 390px and 1440px, the bar is 81px: the nav link's 44px minimum tap target (D-19), plus 18+18 padding and the 1px border, exceeds the 64px minimum height. That is unchanged by this plan — the same arithmetic held before it, and `min-height: 64px` is still on the bar and still pinned. Flagged rather than "fixed": shrinking it would take the tap target below the accessibility floor.
- **40 integration suites do not run bare.** `npx vitest run` refuses them because the configured Supabase is the hosted (production) project. That is the intended guard. Everything that can run pure ran: 89 files, 2934 tests, all passing.

## Verification Evidence

- `npm run typecheck` clean, `npm run lint` clean (`--max-warnings=0`), `npx next build` clean.
- `npx vitest run` (bare, no `ALLOW_REMOTE_TESTS`): 2934 passed; the 40 failures are the DB-backed suites refusing to touch production.
- Pushed `main` (`13e2531..54c5de5`); production deployment `backdesk-9pw5ca1t4` **Ready** in 34s.
- Live: `/`, `/privacy`, `/audit`, `/audit/thanks` all HTTP 200. `grep -c Perth` → 0 on `/` and `/privacy`. `grep -c 'wrap measure'` → 0 on all four. The served HTML shows `<header class="site-header"><div class="wrap">` and `<footer class="site-footer"><div class="wrap">`, and the ABN bytes are `302 240` (U+00A0) between all four groups in both the privacy intro and the footer.
- **Desktop edge measurement (1440x900, headless Chrome 152 via CDP `getBoundingClientRect`):** header lockup 228, hero h1 228, hero button 228, `ol.steps` 228, `#pricing-h` 228, footer p 228. Hero measure width 646px (38em). **The single number is 228px.**
- **Phone (390px):** every edge 20px, `scrollWidth` 390 (no sideways scroll), tiers one column, `/privacy` ABN in one line box.
- Not measured here: the operator's own phone. The `/privacy` ABN was proven unbreakable at 390px and 320px in a headless viewport, which is the same layout engine but not the same device.

## User Setup Required

None.

## Next Phase Readiness

The three UAT change requests are closed and live. `09-UAT.md` still carries test 1 blocked on ClickSend credit — unrelated to this plan, and the only outstanding item on the phase.

---
*Phase: 09-landing-page-audit-intake*
*Completed: 2026-09-10*

## Self-Check: PASSED

All modified files present on disk; all three task commits (`586d8bb`, `d04e8ee`, `54c5de5`) resolve in `git log`. No stubs, no skipped tests, no unrun `<verify>` — every task's `<verify>` command was executed and passed, and the plan's `<verification>` was run against the live production deployment.
