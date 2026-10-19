---
created: 2026-09-04T01:40:00Z
title: Console nav as a single sideways-scrolling row on phones
area: ui
severity: minor
sequence_after: Phase 7 close (after 07-07 deploy and /gsd-secure-phase 7); run as /gsd-quick alongside the idempotent-generate todo
files:
  - src/app/globals.css:104-135 (.nav / .nav nav — flex-wrap: wrap added by 07-06 for G-07-3)
  - src/app/globals.css:270-280 (.nav button.linkish 44px targets)
  - src/app/(console)/layout.tsx (brand + seven nav items)
  - tests/layout-contract.test.ts (nav wrap pins from 07-06 — must be replaced, not deleted)
  - .planning/phases/07-attribution-reporting/07-06-harness/nav-check.sh (measures the bar at 390/700px)
  - .planning/phases/07-attribution-reporting/07-UI-SPEC.md:323 (E8 overflow row — says "wraps to a second line")
  - .planning/debug/console-nav-overflow-390.md (G-07-3 diagnosis; its fix_rationale rejected overflow-x: hidden on the shell — this is a different thing)
---

## Problem

The G-07-3 fix (07-06) made `.nav` and `.nav nav` wrap, which stopped the document widening at 390px but costs three lines (~176px at 390px vs 72px on desktop) — about a quarter of a phone screen on the Queue page the operator opens most between meetings. Rows two and three carry the least-used items (New client, Email, Sign out). On 2026-09-04, after passing UAT test 6, the operator asked: "wouldn't it be better if the nav bar scrolls sideways instead of having two rows?" Answer given: yes, provided the LINK ROW scrolls and the page never does, and hidden items get a visual cue.

## Solution

1. `.nav nav { flex-wrap: nowrap; overflow-x: auto; scroll-snap-type: x proximity; scrollbar-width: none; -webkit-overflow-scrolling: touch; }` with `::-webkit-scrollbar { display: none }`; each item `scroll-snap-align: start; flex: 0 0 auto`. Keep `.nav { flex-wrap: wrap }` as the fallback so the brand never collides with the row; brand stays fixed on the left. Keep the 44px targets.
2. Cue that more exists: a right-edge fade on `.nav nav` (mask-image linear-gradient, or a `::after` gradient positioned over the row) that is present only when the row overflows — a CSS-only approach is `mask-image` unconditionally (harmless when nothing overflows) or a `scroll-timeline`/`animation-timeline: scroll(x)` fade if supported; do NOT rely on JS. At 390px the last visible item should be partly cut off by construction (check with nav-check.sh) so the row reads as scrollable.
3. Sign out stays last (reachable by one swipe). Consider ordering: Inbox, Queue, Audits, Reports first — they must fit in the first screenful at 390px.
4. Contract + gates: replace the 07-06 wrap pins in `tests/layout-contract.test.ts` with pins for `overflow-x: auto` on `.nav nav` and the fade; extend `nav-check.sh` to assert document scrollWidth === 390 AND `.nav nav` scrollWidth > clientWidth at 390px, bar height one row (~60–72px), unchanged at 700px; keyboard: the row needs `tabIndex={0}`? — NO: links are focusable already and focus scrolls them into view; verify with the harness. Update 07-UI-SPEC.md:323 (E8) to "single row, scrolls sideways inside `.nav nav`, right-edge fade" with a `[Contract correction …]` tag, and add a line to the G-07-3 debug file noting the follow-up.
5. Accessibility/print: `.nav` is hidden under `@media print` (report.css / audit.css) — unchanged. Reduced-motion: no animation involved.

Out of scope: hamburger/More menu (rejected in 07-UI-SPEC), hiding Sign out.

Constraints: hosted Supabase is production (no test:remote); no dependencies; `npm run build`, tsc, lint, `npm test` baseline 0 assertion failures.
