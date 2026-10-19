---
phase: quick
plan: "261016-k4p"
quick_id: 261016-k4p
subsystem: marketing-site
tags: [pricing, landing-copy, deploy]
requires: [dc1576f tier rename]
provides: [public pricing $397/$797, no setup fee, first 30 days free]
affects: [src/app/(marketing)/copy.ts, src/app/(marketing)/page.tsx]
key-files:
  created: []
  modified:
    - src/app/(marketing)/copy.ts
    - src/app/(marketing)/page.tsx
    - src/app/(marketing)/marketing.css
    - tests/marketing-copy.test.ts
    - tests/structured-data.test.ts
    - .planning/PROJECT.md
    - docs/external-registrations.md
decisions:
  - "Public pricing 16 Oct 2026 (founder): Call Catcher $397 / month, Back Desk $797 / month, no setup fee, first 30 days free, founding-five offer withdrawn; billed from day 31"
  - "The trial replaces the founding offer one for one in the same .callout markup (key renamed founding -> trial) so the layout and CSS contracts hold"
status: complete
completed: 2026-10-16
duration: ~35m
actuals:
  tokens: 3000
  tasks: 2
  commits: 3
---

# Quick 261016-k4p: pricing $397 / $797, no setup fee, first 30 days free Summary

The site now shows the new prices: Call Catcher $397 / month and Back Desk $797 / month. "No setup fee." replaces the $990 setup line. A "First 30 days free" callout at $0 replaces the founding-five offer, and the new terms say billing starts on day 31. It is live on backdesk.com.au as b296cda.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| plan | fd34398 | docs(quick): plan |
| 1 | b296cda | feat: pricing $397/$797, no setup fee, first 30 days free (copy, page, CSS comments, pins, PROJECT.md) |
| 2 | d290931 | docs: pricing deployed and probed (docs/external-registrations.md) |

## Verification

- Pure suites (marketing-copy, brand, marketing-metadata, layout-contract, structured-data, guide-page, privacy-page, marketing-css-contract): 8 files, 257 tests passed. typecheck, lint and `next build` all exit 0.
- CI run 38891200209 on b296cda: success. Vercel `dpl_5iZBZuMyALe9dBe27cTXQEkApafh` is Production and Ready, created 2026-10-16 19:02 AWST. GitHub deployment 7117335801.
- Live HTML contains `$397`, `$797`, `$0`, "First 30 days free", "No setup fee." and "from day 31". It no longer contains `$597`, `$990`, `$297` or "Founding five".
- Probes: voice 401, voice-status 401, cadence-tick 401, GET /leads 307.

## Deviations from Plan

1. **[Rule 2] Added `tests/marketing-css-contract.test.ts` to the verify list.** That suite pins the `.callout` layout, so it was run as well. It passed and was not edited.
2. **[Rule 2] Extended the no-price pin in `tests/structured-data.test.ts`.** The JSON-LD must not quote any price, so `397` and `797` were added next to the retired figures.
3. **[Rule 1] Updated two stale comments in `marketing.css`.** They named the founding-five callout and now name the trial callout. Only comments changed.
4. **[Rule 1] Updated PROJECT.md line 12 as well as line 14.** Line 12 still said "founding five at $297/mo, then $597–997/mo".

## Open item for the founder (not changed: the section was ruled unchanged)

The guarantee body still says "Setup is a one-off and sits outside the multiple." There is no setup fee any more, so the sentence describes a fee that does not exist. The section was left as instructed. Deleting that one sentence would fix it.

## Known Stubs

None.

## Self-Check: PASSED

- Files exist: copy.ts, page.tsx, both tests, external-registrations entry, this SUMMARY.
- Commits fd34398, b296cda and d290931 are present on main and pushed.
