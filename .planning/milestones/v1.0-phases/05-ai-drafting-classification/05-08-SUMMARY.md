---
phase: 05-ai-drafting-classification
plan: 08
subsystem: ui
tags: [css, flexbox, responsive, next.js, inbox, badges]

gap_closure: true
gap_ids: [G-05-3]

# Dependency graph
requires:
  - phase: 05-ai-drafting-classification (05-07)
    provides: The triage inbox row header that nests classification/attribution badge pills inside `.touch-when`
  - phase: 02-servicem8-sync-quote-leakage-audit
    provides: The shared `.badge` / `.touch-list` / `.touch-when` presentation classes in globals.css
provides:
  - "`.touch-when` is a wrapping flex container (gap 0.25rem 0.5rem) — badge pills and bare text nodes are gap-separated regardless of JSX whitespace stripping"
  - "`.badge` hardened as an atomic pill: display inline-block, white-space nowrap, max-width 100% — it can no longer fragment across line boxes with a sliced 999px border in any parent"
  - "`.touch-when--stack` modifier: full-row header at phone widths, 12rem basis above 32rem"
  - "Narrow-viewport fallback below 22.5rem: the longest classification label wraps INSIDE one intact pill"
affects: [phase-06-escalation, any future screen using .badge or .touch-list]

# Actuals (#2632)
actuals:
  tokens: 7432
  tasks: 1
  commits: 2

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A shared presentation class states its own layout contract rather than inheriting it from where it happened to be used first"
    - "Phone/desktop flex-basis split via a BEM-style modifier plus the existing 32rem breakpoint (mirrors `.touch-meta`)"

key-files:
  created: []
  modified:
    - src/app/globals.css
    - src/app/(console)/inbox/page.tsx

key-decisions:
  - "The fix restores the flex-container contract `.badge` assumes rather than sprinkling `{' '}` separators into the inbox markup — a gap fixes separation for ALL children regardless of whether JSX kept the whitespace, whereas a manual separator fixes only the children someone remembered"
  - "`.badge` gets `display: inline-block` + `white-space: nowrap` even though flex would blockify it anyway — the class must be safe in a future non-flex parent, because that latent defect is exactly what shipped here"
  - "Phone-width stacking is scoped to a `.touch-when--stack` modifier, not applied to `.touch-when` itself — the quote-detail schedule and ledger lists share the class and passed UAT, so their file is not edited and their layout is unchanged apart from the visually-equivalent whitespace-to-gap swap"
  - "Below 22.5rem the pill's own text is allowed to wrap (`white-space: normal`): an inline-block cannot fragment, so wrapping inside an intact border is strictly better than the label overflowing it — the only place nowrap is deliberately relaxed"

patterns-established:
  - "Pattern: a shared class that relies on a parent context (gap, align-self) declares that context on the container it ships with, so a new nesting site cannot silently break it"
  - "Pattern: viewport-specific layout for one consumer of a shared class rides a modifier class, never a change to the shared class"

requirements-completed: [AI-03]

coverage:
  - id: D1
    description: "`.touch-when` is a wrapping flex container with gap 0.25rem 0.5rem, so the inbox timestamp text node and every badge pill are gap-separated (fixes the zero-gap `pm(THREADED)` collision)"
    requirement: AI-03
    verification:
      - kind: other
        ref: "awk '/^\\.touch-when \\{/,/^\\}/' src/app/globals.css | grep -q 'display: flex' (and flex-wrap: wrap, align-items: center, gap: 0.25rem 0.5rem)"
        status: pass
    human_judgment: true
    rationale: "The static assertion proves the declarations exist; only rendering /inbox on a ~390px device proves the pills READ as separated. Final confirmation belongs to the 05-UAT test 3 resume."
  - id: D2
    description: "`.badge` carries display: inline-block, white-space: nowrap, max-width: 100% — a pill wraps to the next line as a whole unit and can never fragment mid-text with a sliced rounded border"
    requirement: AI-03
    verification:
      - kind: other
        ref: "[ \"$(awk '/^\\.badge \\{/,/^\\}/' src/app/globals.css | grep -Ec 'display: inline-block|white-space: nowrap|max-width: 100%')\" -eq 3 ]"
        status: pass
    human_judgment: true
    rationale: "box-decoration-break fragmentation is a rendered artifact; no unit test in this repo renders CSS. The mechanism is spec-defined (an inline-block is not fragmentable) but the visual proof is the UAT resume screenshot."
  - id: D3
    description: "The inbox row header owns a full row at phone widths via `.touch-when--stack`, reverting to a 12rem basis above 32rem, so it no longer shares the li's first flex line with the `.meta` phone number"
    requirement: AI-03
    verification:
      - kind: other
        ref: "grep -q 'touch-when--stack' src/app/globals.css && grep -q 'touch-when--stack' 'src/app/(console)/inbox/page.tsx'"
        status: pass
    human_judgment: true
    rationale: "Whether ~390px now gives the header enough width for the ~280px classification pill is a rendered measurement, not a static one."
  - id: D4
    description: "Below 22.5rem (360px) the longest label ('reads as none of the above — a guess') wraps inside one intact pill instead of overflowing its border"
    requirement: AI-03
    verification:
      - kind: other
        ref: "grep -q 'max-width: 22.5rem' src/app/globals.css"
        status: pass
    human_judgment: true
    rationale: "The 320px case was derived from a measured-label estimate in the debug session's blind_spots, never rendered. It must be eyeballed at 320px during the UAT resume."
  - id: D5
    description: "The quote-detail schedule and ledger lists — the other consumers of `.touch-when` and `.badge` — are restyled only through the shared classes; their own file has zero working-tree changes"
    verification:
      - kind: other
        ref: "[ -z \"$(git status --porcelain -- 'src/app/(console)/clients/[id]/quotes/[quoteId]/page.tsx')\" ]"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit && npm run lint (--max-warnings=0)"
        status: pass
    human_judgment: true
    rationale: "The file being unedited is proven mechanically, but the flex change replaces its explicit `{' '}` node with a 0.5rem column gap — judged visually equivalent by the debug session, not yet eyeballed. Rides the same UAT resume."

# Metrics
duration: 10 min
completed: 2026-08-31
status: complete
---

# Phase 05 Plan 08: Inbox Badge Layout Fix (G-05-3) Summary

**`.touch-when` becomes a wrapping flex container and `.badge` becomes an atomic inline-block pill, so the triage inbox row header renders with gap-separated, unfragmented pills on a ~390px phone — with a `.touch-when--stack` modifier giving the header its own full row and a 22.5rem fallback that wraps the longest classification label inside an intact border.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-08-31T07:52:00Z
- **Completed:** 2026-08-31T08:02:33Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments

- Closed UAT gap G-05-3's four prescribed missing items in one CSS contract fix plus a single `className` change.
- Restored the layout contract `.badge` was written for: `.touch-when` now declares `display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.5rem` alongside its existing `flex: 1 1 12rem`, so the bare timestamp text node becomes an anonymous flex item separated from the pills by the gap and `.badge`'s previously inert `align-self: center` reactivates.
- Hardened `.badge` against inline-box fragmentation everywhere, not just here: `display: inline-block` makes the pill atomic (a 999px border can no longer be sliced across two line boxes), `white-space: nowrap` makes a too-wide pill move to the next flex line whole, `max-width: 100%` keeps it inside its container.
- Added `.touch-when--stack` (mobile-first `flex-basis: 100%`, `12rem` restored inside the existing `@media (min-width: 32rem)`) so on a phone the inbox header no longer shares the li's first flex line with the content-sized `.meta` phone number — the ~200px-vs-~280px squeeze that forced the wrap in the first place.
- Added the narrow-viewport fallback `@media (max-width: 22.5rem) { .touch-when--stack .badge { white-space: normal } }` so the longest label ("reads as none of the above — a guess", ~320px rendered + 2 × 1.25rem main padding = 360px) wraps inside one intact pill down to 320px rather than overflowing the border.

## Task Commits

Each task was committed atomically:

1. **Task 1: Restore the .badge flex-item contract in the inbox row header** - `6334881` (fix)

**Plan metadata:** see the `docs(05-08)` commit following this summary.

## Files Created/Modified

- `src/app/globals.css` - `.badge` hardened (inline-block / nowrap / max-width); `.touch-when` made a wrapping flex container; new `.touch-when--stack` modifier with its 32rem revert; new 22.5rem narrow-label fallback. +45 lines, 0 removed.
- `src/app/(console)/inbox/page.tsx` - row-header div `className` changed from `"touch-when"` to `"touch-when touch-when--stack"`. The only markup change in the plan (1 line).

## Decisions Made

- **Flex gap, not `{' '}` separators.** The debug session's `fix_rationale` is explicit: separation delegated to a gap works for every child regardless of JSX whitespace stripping, whereas a manual separator only works for the children someone remembered to separate. The inbox markup keeps its bare text node.
- **`.badge` hardened even though flex already blockifies it.** As a flex item the pill would be blockified anyway; the declarations exist so the class survives its next nesting in a non-flex parent. That latent defect — a shared class silently depending on where it was first used — is exactly what produced G-05-3.
- **Phone stacking scoped to a modifier.** `.touch-when` is shared with the quote-detail schedule and ledger lists, which passed UAT. Applying `flex-basis: 100%` to the base class would have restyled a screen that was not broken; the modifier confines the change to the inbox.
- **`nowrap` deliberately relaxed below 22.5rem.** Everywhere else a pill must not wrap. At 320px the longest label cannot fit any header, and an inline-block cannot fragment — so allowing the text to wrap inside the pill keeps the border intact, which is the artifact the gap was reported for.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- **Pre-existing (out of scope): 31 integration test FILES fail to collect on a bare `npm test`.** Every one throws the same WR-09 disposable-stack gate error — `Refusing to run integration tests against a non-local Supabase stack` from `tests/helpers/env.ts` — because `npm test` runs the whole vitest project and the repo's `DATABASE_URL` points at the hosted Sydney stack. All 1590 *tests* that do execute pass; there are zero test-level failures. This is unrelated to a CSS change (no failing file imports `globals.css` or the inbox page) and pre-dates this plan, so per the scope boundary it was not "fixed". `npm run test:remote` was correctly NOT run: the hosted DB is production and this plan touches no data path.

## Threat Flags

None. Presentation-only change: CSS rules plus one static class attribute on an auth-gated, operator-only console page. The D-13 compliance boundary (deterministic STOP regex vs display-only model labels) is untouched — badges remain read-only surfacing. No packages installed.

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- G-05-3's failed truth is now achievable in code; the gap is NOT closed until 05-UAT.md test 3 is re-run on the actual phone. Every coverage entry above is `human_judgment: true` for that reason — CSS rendering is not something this repo's suites assert.
- **UAT resume checklist:** `/inbox` at ~390px (timestamp and pills gap-separated, classification pill wraps as one whole unit onto its own full-width row) and at 320px (label wraps inside one intact pill border); then a quote-detail page at ~390px to confirm the schedule and ledger rows are unchanged by the whitespace-to-gap swap between `#N` and the timestamp.
- No blockers for Phase 6.

---
*Phase: 05-ai-drafting-classification*
*Completed: 2026-08-31*

## Self-Check: PASSED

- `src/app/globals.css` — FOUND
- `src/app/(console)/inbox/page.tsx` — FOUND
- Task commit `6334881` — FOUND in git log
- Plan `<verification>` re-run: `npx tsc --noEmit` clean, `npm run lint` clean (`--max-warnings=0`), all static G-05-3 source assertions emit `GAP-CLOSED`.
