---
phase: 01-foundation-tenancy
plan: 03
subsystem: api
tags: [zod, validation, nextjs, react-19, useActionState, supabase, rls, postgres, multi-tenancy]

requires:
  - phase: 01-02
    provides: tenants schema with RLS, create_tenant RPC, unique index on lower(name), authenticated server client, console shell and create-client slice
provides:
  - tenantCreateSchema — the single, framework-free validation authority for tenant creation (ONB-01)
  - Server-side field-error surface — the create action returns typed per-field errors plus the submitted values instead of redirecting the operator's input away
  - Deterministic duplicate-name handling — SQLSTATE 23505 / tenants_name_lower_key mapped to a name-field message, proven against the live database
  - /clients/[id] tenant detail page reading through the RLS-enforced path, 404 on unknown, foreign or malformed ids
  - Shared contact-hours display helpers (formatContactDays / formatContactTime) used by both the list and the detail page
  - 44 new assertions (42 pure validation units + 2 integration) covering every ONB-01 rejection rule and edge
affects: [servicem8-sync, cadence-engine, sms-email-delivery, approval-queue]

actuals:
  tokens: 11265
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Validation lives in src/core (framework-free) and is called from the server action — the form is convenience, the action is the trust boundary"
    - "Server actions shaped for useActionState: return state on failure, navigate only on success, so a rejection never costs the operator their input"
    - "Database error identification by SQLSTATE first with the index name as fallback, asserted against the real error PostgREST returns rather than a hand-written stand-in"
    - "Route params validated for shape before they reach Postgres — a malformed uuid 404s instead of raising 22P02"
    - "Display formatting for a domain value lives beside its schema, so the list and detail pages cannot drift apart"

key-files:
  created:
    - src/core/shared/tenant.ts
    - src/app/(console)/clients/[id]/page.tsx
    - src/app/(console)/clients/new/form.tsx
    - tests/tenant-validation.test.ts
  modified:
    - src/app/(console)/clients/new/actions.ts
    - src/app/(console)/clients/new/page.tsx
    - src/app/(console)/page.tsx
    - src/app/globals.css
    - tests/tenant-create.test.ts
    - vitest.config.mts

key-decisions:
  - "Timezone validity is membership in Intl.supportedValuesOf('timeZone'), not a try/catch around DateTimeFormat — the formatter accepts UTC offsets and non-canonical aliases, and an offset breaks across DST in exactly the way the cadence engine cannot survive"
  - "Equal start and end is rejected rather than read as a zero-width or 24-hour window: an ambiguous window is the failure mode the plan prohibition exists to prevent"
  - "Duplicate days are deduplicated and sorted rather than rejected (an operator slip), while an out-of-range day is rejected (a data error)"
  - "The create form is the console's only client component, so useActionState can return field errors with the submitted values; a redirect could not carry the input back without putting a phone number in a URL"
  - "Escalation phone separators are stripped before matching, then stored in compact form — operators type 0412 345 678, the send path needs 0412345678"
  - "isDuplicateNameError checks SQLSTATE 23505 first and falls back to the index name, because PostgREST does not always surface code for errors raised inside a SECURITY DEFINER function"
  - "vitest resolves the tsconfig @/ alias through a hand-written resolve.alias rather than adding vite-tsconfig-paths — no unaudited dependency for three lines"

patterns-established:
  - "One message per control: toFieldErrors keys issues on path[0], so an error against an array element lands on the single control the operator can actually fix"
  - "Every rejection rule has a named unit test; the form's required/type attributes are treated as convenience that the server never trusts"

requirements-completed: [ONB-01]

coverage:
  - id: D1
    description: "Invalid tenant input is rejected server-side with a field-level error: contact-hours start equal to or after end, invalid IANA timezone, empty or out-of-range contact days, empty name or trade type"
    requirement: ONB-01
    verification:
      - kind: unit
        ref: "tests/tenant-validation.test.ts (42 assertions across 8 describes)"
        status: pass
      - kind: unit
        ref: "tests/tenant-validation.test.ts#rejects a start equal to the end (adjacency: a zero-width window is not 24h)"
        status: pass
      - kind: unit
        ref: "tests/tenant-validation.test.ts#rejects a timezone the runtime does not recognise, naming it in the error"
        status: pass
      - kind: unit
        ref: "tests/tenant-validation.test.ts#reports every failing field at once, not just the first"
        status: pass
    human_judgment: false
  - id: D2
    description: "Submitting the create-client form twice with the same name yields exactly one tenant, and the second attempt surfaces a duplicate-name field error mapped from the unique index violation"
    requirement: ONB-01
    verification:
      - kind: integration
        ref: "tests/tenant-create.test.ts#collides on a duplicate name and reports it as the mapped duplicate error"
        status: pass
      - kind: unit
        ref: "tests/tenant-validation.test.ts#isDuplicateNameError — recognises the Postgres unique-violation SQLSTATE"
        status: pass
    human_judgment: false
  - id: D3
    description: "A rejected submission re-renders the create form with the operator's typed input intact next to the field errors"
    requirement: ONB-01
    verification:
      - kind: other
        ref: "createTenant returns { errors, values } and every control reads defaultValue/defaultChecked from state.values; next build green"
        status: pass
    human_judgment: true
    rationale: "React 19 resets uncontrolled form controls to their defaultValue after an action resolves; the code is shaped for that, but only a real submission in a browser proves the repopulation the operator experiences. No DOM-level test harness exists in this project yet."
  - id: D4
    description: "Operator can open /clients/[id] and see the full business profile: name, trade type, timezone, contact-hours window with day names, escalation phone, status, created date"
    requirement: ONB-01
    verification:
      - kind: unit
        ref: "tests/tenant-validation.test.ts#contact-hours display helpers (7 assertions on formatContactDays/formatContactTime)"
        status: pass
      - kind: e2e
        ref: "next start + GET /clients/{uuid} -> HTTP 307 to /login (route served and auth-gated)"
        status: pass
    human_judgment: true
    rationale: "Deferred to the end-of-phase device check the plan asks for: whether the rendered profile is readable and correct on a phone is a judgment no assertion in this project currently makes, because the console has no authenticated HTTP test harness."
  - id: D5
    description: "Unknown, foreign or malformed client ids 404 rather than leaking existence or erroring (threat T-03-02)"
    verification:
      - kind: integration
        ref: "tests/tenant-create.test.ts#returns no row for an unknown id — the detail page 404 path"
        status: pass
      - kind: other
        ref: "UUID_PATTERN guard calls notFound() before the query, so Postgres never raises 22P02 on a malformed segment"
        status: pass
    human_judgment: false
  - id: D6
    description: "The client list shows an explicit empty state when no clients exist, and each row links to its detail page"
    requirement: ONB-01
    verification:
      - kind: other
        ref: "src/app/(console)/page.tsx renders the empty state on tenants.length === 0 and links each name cell to /clients/{id}; next build green"
        status: pass
    human_judgment: true
    rationale: "The empty-state branch cannot be reached automatically without emptying the live project's tenants table; the plan defers it to the end-of-phase check on a fresh project."
  - id: D7
    description: "No default contact-hours window or day set exists anywhere in schema, form or action (plan prohibition — the window feeds DNCR contact-hours compliance)"
    requirement: ONB-01
    verification:
      - kind: other
        ref: "grep defaultValue/defaultChecked in clients/new/ — every occurrence reads from state.values (empty on first render); no default in tenantCreateSchema or createTenant"
        status: pass
      - kind: unit
        ref: "tests/tenant-validation.test.ts#rejects a missing start or end — there is no default window"
        status: pass
    human_judgment: false

duration: 11 min
completed: 2026-08-25
status: complete
---

# Phase 1 Plan 03: Tenant Validation and Detail Summary

**Server-side ONB-01 validation as a single framework-free zod authority — IANA timezone membership, an unambiguous contact-hours window, deterministic duplicate-name mapping proven against live Postgres — plus the RLS-enforced tenant detail page.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-08-25T10:24:23Z
- **Completed:** 2026-08-25T10:35:27Z
- **Tasks:** 2 (1 TDD)
- **Files created/modified:** 10
- **Commits:** 3 task commits (test → feat → feat)

## Accomplishments

- **Validation is now a mechanism, not vigilance.** `tenantCreateSchema` in `src/core/shared/tenant.ts` is the only thing that decides whether a tenant profile is acceptable, and the server action delegates to it before the RPC. The form's `required` and `type="time"` attributes are treated as convenience the server never trusts — a curl request hits exactly the same rules.
- **The ambiguous contact-hours window is now impossible.** `08:00–08:00` is rejected rather than silently read as either a zero-width or an all-day window, and there is no default window anywhere in the schema, form or action. This is the prohibition that matters: the window captured here is the input to DNCR contact-hours discipline in Phase 3, so an operator who never thinks about it must not inherit 24/7 by omission.
- **Timezones are validated by membership, not by "does the formatter throw".** `Intl.DateTimeFormat` happily accepts `+08:00` and non-canonical aliases; a UTC offset breaks across DST in exactly the way a cadence engine cannot survive. Only zones the runtime actually advertises are accepted, and the rejection message names the offending value.
- **The duplicate-name path is verified, not assumed.** A double submit collides on `tenants_name_lower_key` and comes back as a name-field message. An integration test asserts against the error PostgREST *actually* returns — `{code: '23505', message: '...tenants_name_lower_key'}` — so the mapping cannot rot into a silent generic failure.
- **The read side is closed.** `/clients/[id]` renders the full profile through the authenticated client, so a tenant this operator is not a member of returns zero rows and 404s, indistinguishable from one that does not exist. A malformed uuid 404s before the query rather than raising `22P02`.

## Task Commits

1. **Task 1 (RED): failing unit tests for the validation authority** — `7ea8db9` (test)
2. **Task 1 (GREEN): tenantCreateSchema + field-error form surface** — `5dc771b` (feat)
3. **Task 2: detail page, list links, shared contact-hours formatting** — `06d5485` (feat)

## Files Created/Modified

- `src/core/shared/tenant.ts` — the schema, `toFieldErrors`, `isDuplicateNameError`, and the day/time display helpers. No `next/*` import, so it is reachable from an action, a future route handler, an import job, and a unit test alike.
- `src/app/(console)/clients/new/actions.ts` — re-validates every field on the trust boundary (T-03-01), returns `{ errors, values }` on failure, navigates only on success.
- `src/app/(console)/clients/new/form.tsx` — the console's only client component; `useActionState` renders errors inline and repopulates controls from returned state.
- `src/app/(console)/clients/new/page.tsx` — reduced to a server component that supplies the runtime's Australian zone list.
- `src/app/(console)/clients/[id]/page.tsx` — RLS-enforced detail read with uuid-shape guard, `notFound()` on absence, created date rendered in the client's own timezone.
- `src/app/(console)/page.tsx` — name cells link to detail; now shares the formatters with the detail page.
- `src/app/globals.css` — inline field-error, hint, badge and profile-grid styles.
- `tests/tenant-validation.test.ts` — 42 pure assertions, one per rejection rule.
- `tests/tenant-create.test.ts` — two integration assertions: the real duplicate collision, and the empty read the 404 path depends on.
- `vitest.config.mts` — resolves the `@/` alias.

## Decisions Made

Captured in `key-decisions` frontmatter. The three with the longest reach:

- **Timezone validity is set membership.** Accepting anything `Intl.DateTimeFormat` tolerates would let `+08:00` into the column that Phase 3 uses to decide whether it is 8am at the customer.
- **Equal start and end is an error.** Both plausible readings of a zero-width window (send nothing, send always) are wrong, and one of them is a compliance breach. Making the operator state the window is cheaper than choosing wrong.
- **One client component, deliberately.** The rest of the console remains zero-client-JS server renders. This one exists because the alternative — redirecting with an error code — throws away everything the operator typed, and retyping a business profile on a phone between meetings is how a client never gets onboarded.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] vitest could not resolve the `@/` path alias**
- **Found during:** Task 1 (RED step)
- **Issue:** `tests/tenant-validation.test.ts` imports `@/core/shared/tenant`, but `vitest.config.mts` carried no `resolve.alias`, so the run failed with `Cannot find package '@/core/shared/tenant'` — a failure that would have masked genuine test results.
- **Fix:** Added a hand-written `resolve.alias` mirroring the tsconfig `@/* -> ./src/*` mapping. Chose this over `vite-tsconfig-paths` because this repo does not install unaudited packages for three lines of config.
- **Files modified:** `vitest.config.mts`
- **Verification:** `npx vitest run` resolves the alias; all 3 suites green.
- **Committed in:** `7ea8db9`

**2. [Rule 2 - Missing Critical] Malformed uuid guard on the detail route**
- **Found during:** Task 2
- **Issue:** The plan assumed an unknown id yields zero rows. That holds for a well-formed uuid, but a malformed path segment (`/clients/not-a-uuid`) makes Postgres raise `22P02 invalid input syntax for type uuid` — a 500 with a database message, not the 404 the plan requires.
- **Fix:** The route checks the uuid shape and calls `notFound()` before touching the database. Guessed-but-wrong uuids still fall through to the RLS-scoped read, so the security property is unchanged.
- **Files modified:** `src/app/(console)/clients/[id]/page.tsx`
- **Verification:** `next start` serves `/clients/not-a-uuid`; both malformed and well-formed unknown ids resolve to the not-found path (307 to `/login` when unauthenticated, confirming the route is served and gated).
- **Committed in:** `06d5485`

**3. [Rule 2 - Missing Critical] Integration proof for the duplicate-error shape**
- **Found during:** Task 2
- **Issue:** `isDuplicateNameError` was written against an *assumed* PostgREST error shape. A unit test asserting a hand-written object proves only that the function matches my guess — if PostgREST reports the error differently, every duplicate would silently become "Could not create the client. Try again." and the ONB-01 idempotency edge would be unverified in exactly the way the phase exists to prevent.
- **Fix:** Added two integration assertions that create a real collision (with different casing, exercising the `lower(name)` index) and check both the mapping and that exactly one row survives. Confirmed the live shape carries both signals: `code: '23505'` and the index name in `message`.
- **Files modified:** `tests/tenant-create.test.ts`
- **Verification:** `npx vitest run tests/tenant-create.test.ts` — 5 passed.
- **Committed in:** `06d5485`

### Plan deviation by design

**The create form became a client component** (`src/app/(console)/clients/new/form.tsx`), which the plan's `files_modified` list did not name. The plan explicitly offered "the React 19 `useActionState` pattern or a server-rendered form state"; `useActionState` requires a client boundary, and the extracted component keeps that boundary as small as possible — the page stays a server component and computes the timezone list server-side.

**Removed the pre-filled 08:00–17:00 window and pre-ticked Mon–Fri** left over from the 01-02 tracer form. Required by the plan prohibition; called out here because it is a visible behaviour change from wave 1, not an oversight.

---

**Total deviations:** 3 auto-fixed (1 blocking, 2 missing critical) + 2 by-design departures from the plan's file list.
**Impact on plan:** No scope creep. Both Rule 2 fixes close gaps between what the plan's must-have truths claim and what was actually provable.

## Issues Encountered

None. Every verification command passed on first or second run; no repair budget was consumed.

## Verification Results

- `npx vitest run` — **52 passed** (3 files: 42 validation units, 5 tenant-create integration, 5 auth-security integration)
- `npx tsc --noEmit` — clean
- `npm run build` — green; `/clients/[id]` registered as a dynamic route
- `npx eslint src tests` — clean
- `next start` route gating — `/`, `/clients/new`, `/clients/{uuid}`, `/clients/not-a-uuid` all 307 to `/login` unauthenticated

### Prohibition check (ONB-01 / values)

`MUST NOT default, coerce, or silently fill the contact-hours window to an always-on (24/7) window.` **Satisfied.** Every `defaultValue`/`defaultChecked` in `clients/new/` reads from `state.values`, which is empty on first render; `tenantCreateSchema` and `createTenant` contain no fallback window or day set; and `#rejects a missing start or end — there is no default window` pins it. The plan frontmatter still reads `status: unverified` — left untouched, since the executor does not rewrite plan artifacts; this section is the evidence.

## User Setup Required

None new. The two items carried from 01-02 still stand: create `.env.example` from `docs/env-vars.md`, and confirm the Supabase project region in the dashboard.

## Next Phase Readiness

**ONB-01 is complete**, with all three named edges closed: idempotency (unique `lower(name)` + mapped error), adjacency (`start == end` rejected), and empty (empty state + empty-days rejection).

**Carried forward:**

- Two human checks remain for end-of-phase UAT, both deliberate: the detail page and empty state on a real phone (coverage D4, D6), and that a rejected submission visibly keeps the operator's typed input (D3). The console has no authenticated HTTP test harness — worth considering in Phase 2 if UI regressions start costing time.
- Plan 01-04 owns `forTenant()`, the ESLint import ban, the two-tenant leak test and CI. Nothing here bypasses RLS: every read and write in the console still goes through the authenticated client.
- `src/core/shared/tenant.ts` is the pattern for later domain modules — schema, error mapping and display formatting for one concept, framework-free, unit-tested.

## Self-Check: PASSED

- All 4 key created files verified present on disk.
- All 3 task commits verified in git history (`7ea8db9`, `5dc771b`, `06d5485`).
- Plan verification re-run at close-out: vitest 52/52, `tsc --noEmit` clean, `next build` green, eslint clean.
- Must-have artifacts confirmed: `tenantCreateSchema` present in `src/core/shared/tenant.ts`; key link `actions.ts -> tenant.ts` present (3 references); list links to `/clients/${tenant.id}`.
- Stub scan clean: no TODO/FIXME/placeholder/"coming soon" across `src` and `tests`.

---
*Phase: 01-foundation-tenancy*
*Completed: 2026-08-25*
