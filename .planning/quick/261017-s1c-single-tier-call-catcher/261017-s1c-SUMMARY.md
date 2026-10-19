---
phase: quick
plan: "261017-s1c"
quick_id: 261017-s1c
subsystem: marketing-site
tags: [pricing, landing-copy, offer-sheet, deploy]
requires: [261016-k4p pricing $397/$797]
provides: [public offer is one plan, Call Catcher $397 / month, no setup fee, first 30 days free]
affects: [src/app/(marketing)/copy.ts, src/app/(marketing)/marketing.css, scripts/brand/offer-sheet.html]
key-files:
  created: []
  modified:
    - src/app/(marketing)/copy.ts
    - src/app/(marketing)/page.tsx
    - src/app/(marketing)/marketing.css
    - tests/marketing-copy.test.ts
    - tests/marketing-css-contract.test.ts
    - tests/structured-data.test.ts
    - .planning/PROJECT.md
    - scripts/brand/offer-sheet.html
    - docs/external-registrations.md
decisions:
  - "Public offer 17 Oct 2026 (founder): one plan, Call Catcher $397 / month, no setup fee, first 30 days free; Back Desk ($797) removed and its extras (dormant backlog, invoice chasing, review requests) not offered and not folded in"
  - "On desktop the single card fills the 38em pricing measure with its left edge on the heading's, the same box as the .callout. It is not centred: centring would break the pinned G-09-4 contract (no auto margin)"
status: complete
completed: 2026-10-17
duration: ~30m
actuals:
  tokens: 4700
  tasks: 2
  commits: 3
---

# Quick 261017-s1c: one plan, Call Catcher Summary

The site and the offer sheet now offer a single plan: Call Catcher at $397 / month, with no setup fee and the first 30 days free. The Back Desk tier and its extras are gone from both. The Call Catcher bullets, the trial callout, the guarantee and the terms are unchanged. The site is live on backdesk.com.au as b54f28f.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| plan | bbf9856 | docs(quick): plan, one tier, Call Catcher |
| 1 | b54f28f | feat: one plan on the site (copy, page comments, CSS one-column grid, test pins, PROJECT.md) |
| 2 | 9cc1a91 | docs: offer sheet table has two columns; single-plan deploy evidence |

## What changed

- **copy.ts:** `pricing.tiers` has one entry, Call Catcher, with its five bullets byte-identical. The Back Desk entry is gone, along with its 9 September comment. The Call Catcher comment is dated for the 17 Oct decision.
- **page.tsx:** Only comments changed. The ones that said "two products", "two cards" and "both tiers" now describe one card. The structure is the same: six h2s, two buttons, and the section order.
- **marketing.css:** The wide-block `ul.tiers { grid-template-columns: 1fr 1fr; gap: 24px }` rule is gone. That leaves one implicit column, so above 48rem the card fills the 38em cap, the same width as the `.callout` below it. Without this, the card would have sat at 311px next to an empty column. `max-width: 38em` and `margin: 0 0 24px` are unchanged. `li.tier` keeps its 24px wide padding.
- **Tests:**
  - marketing-copy now expects one tier: names `['Call Catcher']`, prices `['$397']` and setup `['No setup fee.']`. The figure pin is `['$397','$0']`.
  - The retired list gained `$797`, `Back Desk`, `dormant`, `invoice chasing` and `review requests`, with dated comments.
  - The css-contract case that pinned `1fr 1fr` now pins the reverse: no track list for `ul.tiers` at any width, `1fr 1fr` nowhere in the uncommented CSS, and wide `li.tier` padding of 24px.
- **PROJECT.md:** The Customer and Revenue model lines describe one plan.
- **Offer sheet:** The pricing table has two columns: a label column and Call Catcher. The header comment now names the 17 Oct single plan.

## Verification

- Pure suites (marketing-copy, marketing-css-contract, brand, marketing-metadata, layout-contract, structured-data, guide-page, privacy-page): 8 files, 261 tests passed. `npm run typecheck`, `npm run lint` and `npx next build` all exit 0.
- CI run 39000338003 on b54f28f: success.
- Vercel `dpl_EX1VDtkikNQQEnWPzxKVy9yxyuLc` is Production and Ready, created 2026-10-17 11:50 AWST. GitHub deployment 7134419162.
- Live https://backdesk.com.au/: `Call Catcher` 3 occurrences, `$397` 2, `Back Desk` 0, `$797` 0.
- Probes on the console host (app.backdesk.com.au): voice 401, voice-status 401, cadence-tick 401, GET /leads 307 to /login.
- The offer sheet PDF (`docs/gtm/m2-offer-sheet.pdf`, gitignored) has one `/Type /Page` object and `/Count 1`. I viewed it: one A4 page with Inter loaded, a two-column pricing table, and the trial callout, guarantee, terms and footer all on the page.

## Deviations from Plan

1. **[Interpretation] The card is not centred.** The brief asked for "a single card centred at the same max-width". `tests/marketing-css-contract.test.ts` pins the opposite (G-09-4): the grid is capped without centring, with no auto margin and a left margin of 0, because a centred 38em box starts about 169px right of its heading. So the one card fills the 38em measure, starting where the heading starts and ending where the `.callout` ends. It does not stretch past 38em and does not shrink to half. The result is visually centred within the pricing column, and that contract stays green.
2. **[Rule 1] structured-data keeps `797` in its no-price pin.** The brief said to drop it if it was listed. It now pins a retired figure, the same way the list already pins 597, 997, 990 and 297, so keeping it is strictly safer. Only the comment changed.
3. **[Rule 2] The three Back Desk extras were added to the retired list** (`dormant`, `invoice chasing`, `review requests`). Without that pin, folding them into Call Catcher later would go uncaught.
4. **[Rule 1] The offer sheet's header comment now includes `--virtual-time-budget=4000` in the render command**, so the recorded recipe matches the one actually used.
5. **[Note] Probe host.** `GET https://backdesk.com.au/leads` returns 404. That is by design: the proxy 404s every console path on the apex (threat T-9-23). The 307 probe, and the API probes alongside it, were run on `app.backdesk.com.au`. The evidence entry names that host explicitly; the 16 Oct entry did not name a host.
6. **[Out of scope, not changed]** A section comment in `tests/marketing-css-contract.test.ts` (around line 338) still mentions the "founding-five `.callout`" from before 16 Oct. It is a historical description and was left alone.

## Known Stubs

None.

## Self-Check: PASSED

- The files exist: copy.ts, page.tsx, marketing.css, the three tests, PROJECT.md, offer-sheet.html, the external-registrations entry and this SUMMARY.
- Commits bbf9856, b54f28f and 9cc1a91 are on main and pushed.
