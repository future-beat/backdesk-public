---
phase: 09-landing-page-audit-intake
plan: 09
subsystem: ui
tags: [nextjs, server-components, supabase, rls, postgrest, console, accessibility]

requires:
  - phase: 09-landing-page-audit-intake
    provides: "09-01's `audit_requests` table, its `is_operator()` policy, and `TRADE_LABELS` / `BAND_LABELS` in the pure intake module"
  - phase: 02-quote-leakage-audit
    provides: "`src/app/(console)/audits/page.tsx` — the createClient() read contract, the header `.row` and the WR-08 error branch this page copies"
  - phase: 06-inbox-triage
    provides: "the `.touch-list` / `.touch-when` / `.touch-meta` row shape and the badge-class-map convention"
provides:
  - "`/audits/requests`: the operator's list of public audit requests, newest first, read through `createClient()` under `is_operator()` with an explicit ten-column select"
  - "`Requests (N new)` in the `/audits` header row, from a `head: true` count that degrades to a plain label on zero or a failed read"
  - "`tests/audit-request-console.test.ts`: the structural suite 09-06 extends with the detail page, the status action, the CSV route and the pre-fill"
  - "`.request-name` in globals.css — the first console rule for the request surfaces"
affects: [09-06 console detail and pre-fill, 09-04 host-aware routing, 10 go-live]

actuals:
  tokens: 5676
  tasks: 2
  commits: 4

tech-stack:
  added: []
  patterns:
    - "A capped list read that stays honest about its size: `count: 'exact'` beside `.limit(n)` so the total is the table's, not the page's"
    - "A count read whose failure degrades the label rather than the page — the console-layout badge rule applied to a link"
    - "A per-page mirror of `tests/console-error-leak.test.ts`'s three rules, held until the page joins that suite's `NAMED_PAGES`"

key-files:
  created:
    - src/app/(console)/audits/requests/page.tsx
    - tests/audit-request-console.test.ts
  modified:
    - src/app/(console)/audits/page.tsx
    - src/app/globals.css

key-decisions:
  - "The list and the count both read through `createClient()`, never the repository barrel: `audit_requests` has one policy and letting Postgres apply it keeps the gate out of whichever `requireOperator()` call somebody remembers to keep (T-9-18)"
  - "`user_agent` and `ip_hash` are named nowhere in the page, not merely absent from the select: the assertion is over the whole file, so a later 'just add the agent string' edit fails a test rather than shipping"
  - "`{N} new` comes from a second `head: true` count over the whole table rather than from the 50 rows fetched — with a cap in play those are different numbers, and the operator is asking the first question"
  - "A failed count renders the plain `Requests` label and the plain `{M} total` line: a zero would read as 'nothing is waiting', which is the one direction the error must not lie in"
  - "`.touch-list`, not a table: seven facts per row inside `.table-scroll` puts the status badge off the right edge of a 390px phone (G-07-6)"

patterns-established:
  - "Console request surfaces get their classes appended to globals.css beside `.touch-list` (UI-SPEC Implementation Notes); `.request-name` is the first"
  - "A structural suite written for a page ahead of that page joining the shared leak suite, so the rules are enforced from the first commit rather than from the plan that registers the page"

requirements-completed: [LAND-03]

coverage:
  - id: D1
    description: "`/audits/requests` reads `audit_requests` through `createClient()` under `is_operator()`, with an explicit ten-column select that excludes `user_agent` and `ip_hash`, ordered newest first and capped at 50"
    requirement: LAND-03
    verification:
      - kind: unit
        ref: "tests/audit-request-console.test.ts#the request list is read under RLS, never around it (T-9-18)"
        status: pass
      - kind: unit
        ref: "tests/audit-request-console.test.ts#the select list is explicit and narrow (T-9-34)"
        status: pass
      - kind: unit
        ref: "tests/audit-request-console.test.ts#newest first, and capped"
        status: pass
    human_judgment: false
  - id: D2
    description: "The list's copy and badges are the UI-SPEC's: the empty state, the count line, the four status badges, the notify-failed badge on either channel, and the WR-08 error branch that logs the code and renders the fixed sentence"
    requirement: LAND-03
    verification:
      - kind: unit
        ref: "tests/audit-request-console.test.ts#the copy is the UI-SPEC row, verbatim"
        status: pass
      - kind: unit
        ref: "tests/audit-request-console.test.ts#the badges say the word and only then the colour (WCAG 1.4.1)"
        status: pass
      - kind: unit
        ref: "tests/audit-request-console.test.ts#a failed read reports without leaking (WR-08, mirrored for this page)"
        status: pass
      - kind: unit
        ref: "tests/console-error-leak.test.ts#raw database errors never reach a rendered surface (WR-08)"
        status: pass
    human_judgment: false
  - id: D3
    description: "`Requests (N new)` in the `/audits` header row, counted with a `head: true` read filtered to `status = 'new'`, with the console nav bar left at its six links"
    requirement: LAND-03
    verification:
      - kind: unit
        ref: "tests/audit-request-console.test.ts#the /audits header row opens the request list"
        status: pass
      - kind: unit
        ref: "tests/audit-request-console.test.ts#the console nav bar was not widened"
        status: pass
      - kind: unit
        ref: "tests/layout-contract.test.ts#every console table scrolls inside its own box (G-07-6)"
        status: pass
    human_judgment: false
  - id: D4
    description: "On the deployed host, signed in on the phone: `/audits` shows `Requests (2 new)`, the list shows the two live 09-01 rows newest first with Perth received times, correct badges, and no sideways scroll"
    requirement: LAND-03
    verification: []
    human_judgment: true
    rationale: "Rendering on a 390px device against live rows is the claim — a source scan proves the class names and the query, not that the row fits the screen or that the times read as Perth wall clock. Also carries the E11 loading/overflow/partial backstops, which are rendered states rather than source properties."

duration: 14min
completed: 2026-09-09
status: complete
---

# Phase 9 Plan 9: Console Request List Summary

**The operator can now open `/audits/requests` on their phone and read every public audit request newest first — with status and notify-failed badges, Perth received times and a `Requests (N new)` way in from `/audits` — read under RLS with an explicit select that never names the throttle hash or the agent string.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-09-09T03:24:00Z
- **Completed:** 2026-09-09T03:38:00Z
- **Tasks:** 2 of 2
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments

- **ROADMAP criterion 3's "visible in the console" half now holds.** 09-01 proved the row existed with a read-only count script because no console surface could show it; the row is now on a screen, and the screen reads it the way the threat model requires — `createClient()` so `is_operator()` decides, no repository barrel, no `getDb()`, no service-role door anywhere in `src/app`.
- **The two diagnostic columns are excluded by construction, not by omission.** `user_agent` and `ip_hash` are asserted absent from the whole file rather than just from the select list, so the next well-meaning "show the browser too" edit is a red test rather than a stranger's device fingerprint on a list read at arm's length on a job site.
- **The entry point cost the nav nothing.** The console layout's own comment refuses a fifth nav item; the way in is a second link in the `/audits` header row, and the suite pins the nav at six links and asserts the layout does not know the request list exists.
- **The structural suite 09-06 inherits exists from the first commit.** It mirrors `tests/console-error-leak.test.ts`'s three rules for this page rather than waiting for 09-06 to add the page to `NAMED_PAGES`, so the WR-08 contract is enforced on this file from today.

## Task Commits

Each task was committed atomically, RED before GREEN:

1. **Task 1: The request list page at /audits/requests through RLS, and its structural suite** — `b3ea223` (test, RED) → `6f8bfda` (feat, GREEN)
2. **Task 2: The Requests (N new) link in the /audits header row** — `9604445` (test, RED) → `6dcf27f` (feat, GREEN)

**Plan metadata:** see the `docs(09-09)` commit.

## Files Created/Modified

- `src/app/(console)/audits/requests/page.tsx` — the list: a `force-dynamic` server component, an explicit ten-column select with `count: 'exact'` beside a 50-row cap, `.touch-list` rows carrying the name link, the status badge, the notify-failed badge, the trade/band/ServiceM8 line and the Perth received time, plus the WR-08 error branch
- `tests/audit-request-console.test.ts` — 43 structural assertions over the two pages and the console layout; extended by 09-06
- `src/app/(console)/audits/page.tsx` — the `Requests (N new)` link and the `head: true` count behind it
- `src/app/globals.css` — `.request-name { overflow-wrap: anywhere }`, beside `.touch-list`

## Decisions Made

Recorded in the frontmatter `key-decisions`. The two worth repeating:

- **The `{N} new` count is a second query, not a `filter()` over the fetched page.** With a 50-row cap those two numbers diverge exactly when the operator most needs the answer, and the cheap-looking version would have been wrong only under load.
- **`not_configured` is deliberately not the notify-failed badge.** D-13 separates a provider failure (this alert was lost) from a deployment failure (every future alert is lost); the list carries the first, and the detail page (09-06) names the second.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] A 120-character unbreakable business name would have widened the page**

- **Found during:** Task 1
- **Issue:** The public form caps `business_name` at 120 characters and normalises nothing, so one unbroken word is a legal submission. Inside a flex item that word sets the item's min-content width, which `flex-shrink` cannot go below — the surplus becomes document width and a 390px phone scrolls sideways, nav sign-out included. This is the same failure `.table-scroll` exists to prevent (G-07-6), and E11's `overflow` backstop is the must-have it fails.
- **Fix:** Added `.request-name { overflow-wrap: anywhere }` to `src/app/globals.css` beside `.touch-list` and applied the class to the name link. The UI-SPEC Implementation Notes already sanction "console request classes appended to globals.css next to `.touch-list`", so this is the contract's own location rather than a new one.
- **Files modified:** `src/app/globals.css` (not in the plan's `files_modified`), `src/app/(console)/audits/requests/page.tsx`
- **Verification:** `tests/audit-request-console.test.ts#lets a 120-character business name wrap rather than widen the page`; `tests/layout-contract.test.ts` and `tests/brand-tokens.test.ts` still green (the rule is appended, not inserted into a token block)
- **Committed in:** `6f8bfda` (part of the task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 × Rule 2)
**Impact on plan:** One file outside `files_modified`, eleven lines, in the location the UI-SPEC nominated. No scope creep.

## Issues Encountered

None. Both tasks went RED → GREEN on the first pass; typecheck and lint were clean at both gates.

## Verification

- `npx vitest run tests/audit-request-console.test.ts tests/console-error-leak.test.ts tests/layout-contract.test.ts` — 3 files, 260 tests, all passing
- `npm run typecheck && npm run lint` — clean after each task
- `npm test` (bare, no `ALLOW_REMOTE_TESTS`) — 83 pure suites pass, 2653 tests, 0 failing assertions. The 40 file-level failures are the DB-backed suites refusing to run against the hosted Sydney project without the opt-in flag, which is the guard working as designed and unrelated to this plan.
- Every plan acceptance grep checked and matching: `force-dynamic` 1, `<table` 0, `user_agent|ip_hash` 0, `@/db/repository` 0, `from '@/lib/supabase/server'` 1, empty-state sentence 1, error sentence 1, `error.code` 1, `/audits/requests` in `audits/page.tsx` 1, `count: 'exact'` 1, and `git diff --quiet HEAD~1 -- 'src/app/(console)/layout.tsx'` exits 0 for the task 2 commit.

## Owed by Later Plans

- **`NAMED_PAGES` in `tests/console-error-leak.test.ts`.** 09-04 owns that file this wave and 09-06 adds `src/app/(console)/audits/requests/page.tsx` to the named list. Until then the three per-page assertions live in this plan's own suite — the page is already covered by the leak suite's whole-directory scan, so nothing is unguarded in the meantime, only named in a different file.
- **The detail page.** `/audits/requests/{id}` 404s until 09-06 lands it. The list does not depend on it: the link is an anchor and nothing on this page reads the detail route.

## Known Stubs

None. Every element rendered on the list is wired to a real column.

## User Setup Required

None — no new environment values, no external service configuration.

## Next Phase Readiness

09-06 has the surface it hangs off: the list route exists, its suite is the one to extend, and the badge/label maps are already resolved from the shared intake module. The one open item is the live UAT (coverage D4), which needs a deploy and the two rows 09-01 submitted.

---
*Phase: 09-landing-page-audit-intake*
*Completed: 2026-09-09*

## Self-Check: PASSED

All 5 claimed files exist on disk; all 4 task commits (`b3ea223`, `6f8bfda`, `9604445`, `6dcf27f`) are present in the repository.
