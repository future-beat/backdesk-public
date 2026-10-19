---
quick_id: 260915-h2g
status: complete
completed: 2026-09-15
commits:
  - 586c3ad
  - 6792552
deployment: dpl_Ach4RkfBQ6dvoPq6qLbRs17TZc3T (backdesk-8vex1hic6, production, Ready)
---
# Summary: phone header tidy + schedule table as a stacked list under 600px

Two Cowork observations from a 390px screen, both fixed in CSS from the markup that was already there. The stylesheet grew its first `max-width` block — `@media (max-width: 37.5rem)`, the file's only one — because both components are correct above 600px and had to be taken apart below it.

**The header** (586c3ad). At 390px the lockup (147px) and the two links did not fit on one line, so the nav wrapped inside itself and left the lockup floating between one link above it and one below. `flex-wrap: wrap` on `.site-header .wrap` plus `flex-basis: 100%` on the nav moves the break to the one place it reads: lockup alone on line one, both links sharing line two, left-aligned (`justify-content: flex-start`). Row gap 4px, not 16px — each link's 44px tap target already supplies the space above its text. The desktop rule, `space-between`, and the 44px targets are untouched.

**The schedule** (6792552). Four columns in 390px was a sideways scroll behind a hairline affordance nobody noticed, with the fourth header cut to "JOB OF THE MESS…". Each `<td>` now carries `data-label={schedule.columns[index + 1]}` — the column header it belongs under, read from `GUIDE_COPY.schedule`, never retyped. Under 600px the scroller goes `overflow: visible`, the table parts go `display: block`, each row becomes a bordered card with its number as the heading, and `content: attr(data-label)` prints a small uppercase label above each value. `<thead>` is clipped (1px + `clip-path: inset(50%)`), not `display: none`, so a screen reader still gets the column names. One markup, two shapes — no second table, no hamburger, no script, no new dependency (LAND-01 prohibition honoured).

## Verification (live, production)

Measured on `https://backdesk.com.au` after the push, with headless Chrome under real device emulation at 390×844 @2x (`--window-size` clamps wider than a phone and was not used):

| Fact | Measured |
|---|---|
| Lockup alone on line one | `lockup` top 18px, `nav` top 50px |
| Both links on line two, left-aligned, 44px | `ServiceM8 guide` x=20 y=50 h=44; `Free audit` x=176 y=50 h=44 |
| No horizontal page scroll (guide + home) | `documentElement.scrollWidth` 390 = `innerWidth` 390 |
| Schedule does not scroll on a phone | `.table-scroll` `scrollWidth - clientWidth` = 0 |
| Desktop header still one line, links right | at 1280px: nav top 18, links x=896 and x=1052 |
| Desktop schedule still a table | four columns, full "JOB OF THE MESSAGE" header |

Captures (scratchpad, not committed):
- `/private/tmp/claude-501/-Users-hesamabbaszadi-Documents-Projects-Backdesk/e19356ea-5e7b-4e17-944b-5370a9f6f09f/scratchpad/guide-shots/h2g-home-phone-390.png` — live home header at 390px
- `/private/tmp/claude-501/-Users-hesamabbaszadi-Documents-Projects-Backdesk/e19356ea-5e7b-4e17-944b-5370a9f6f09f/scratchpad/guide-shots/h2g-guide-schedule-phone-390.png` — live schedule section at 390px (five cards, WHEN / CHANNEL / JOB OF THE MESSAGE)
- `/private/tmp/claude-501/-Users-hesamabbaszadi-Documents-Projects-Backdesk/e19356ea-5e7b-4e17-944b-5370a9f6f09f/scratchpad/guide-shots/h2g-guide-schedule-desktop-1280.png` — the unchanged desktop table
- `/private/tmp/claude-501/-Users-hesamabbaszadi-Documents-Projects-Backdesk/e19356ea-5e7b-4e17-944b-5370a9f6f09f/scratchpad/guide-shots/h2g-guide-phone-390-full.png` — full guide page at 390px

Gates: `tests/marketing-css-contract.test.ts`, `tests/guide-page.test.ts`, `tests/layout-contract.test.ts`, `tests/marketing-copy.test.ts` all pass; `npm run typecheck`, `npm run lint`, `npm run build` clean. The full bare `npm test` run is 3155 tests passing, with 43 integration files refusing to collect — the pre-existing `ALLOW_REMOTE_TESTS` guard against the hosted Sydney Supabase, untouched by this change and correctly not overridden.

## Pins added

- `marketing-css-contract.test.ts`: the phone block gives the nav `flex-basis: 100%` and `justify-content: flex-start`; the base rule keeps `flex-end` and declares no `flex-wrap`; the wide block never mentions `site-header`; the 44px target is set only in the base and the phone block sets no height on the two boxes above the link.
- `guide-page.test.ts`: every `<td>` carries a `data-label` and it is bound to `schedule.columns` (a literal `data-label="` fails); the number stays a label-less `<th scope="row">`; the phone block contains `content: attr(data-label)`, `overflow: visible` on the scroller and a clipped — not hidden — `thead`; above the breakpoint the scroller is still `overflow-x: auto`, the base table rule sets no `display`, and the generated label never appears outside the phone block.

## Deviations from plan

**1. [Rule 3 — blocking] The header pins went to `tests/marketing-css-contract.test.ts`, not `tests/layout-contract.test.ts`.** The plan named `layout-contract.test.ts` for task 1, but that file's header assertions are about the *console* nav (`globals.css`, `report.css`, `audit.css`); every marketing-header assertion lives in `marketing-css-contract.test.ts`. Pinning "alongside its existing header assertions" therefore meant that file. Same commit, 586c3ad.

**2. [Rule 3 — blocking] `rule()` in the contract test refuses duplicate selectors, so its helpers had to be split first.** `.marketing .site-header .wrap` is now declared in both the base layer and the phone block, and the existing `rule(MARKETING_CSS, …)` lookup throws on that ambiguity by design — the header test would have failed on an otherwise correct stylesheet. `wideBlock()` was generalised to `mediaBlock(css, atRule)` with `wideBlock()`/`phoneBlock()` wrappers, `narrowBlock()` now slices at the first `@media` rather than at the wide breakpoint (there are two blocks now), and the header assertion reads the base layer explicitly. Same commit, 586c3ad.

**3. [Rule 1 — bug, caught pre-commit] A first draft of the tap-target pin asserted the phone block contained no `height:` at all.** Task 2 adds `height: 1px` for the clipped `thead`, so that assertion would have failed the moment the second commit landed — a gate that forbids a pattern the same plan requires. Narrowed to the two header rules by name before 586c3ad was committed.

## Known stubs

None.

## Self-Check: PASSED

Both commits exist on `main` and are pushed (`e140c9c..6792552`); the SUMMARY and both live phone captures exist at the paths above; no source or test changes are left uncommitted.
