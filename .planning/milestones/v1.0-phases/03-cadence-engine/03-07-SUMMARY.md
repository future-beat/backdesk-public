---
phase: 03-cadence-engine
plan: 07
subsystem: cadence-core
tags: [cadence, scheduling, timezone, contact-hours, tzdate, pure-functions, tdd, compliance]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: tenants.timezone / contact_hours_start / contact_hours_end / contact_days columns (IANA zone, HH:MM:SS time strings, ISO weekdays), the validated-IANA-zone rule, the zero-width-window rejection
  - phase: 02-servicem8-sync-quote-leakage-audit
    provides: the TZDate wall-clock-in-zone idiom (servicem8/normalize.ts), the UTC-pinned addDays idiom (audit/followup.ts), the framework-free-core header convention (sync/eligibility.ts), quote_contacts field semantics
  - phase: 03-cadence-engine
    provides: TOUCH_CHANNELS vocabulary from 03-01's cadence-templates schema
provides:
  - Nine named cadence policy constants plus CADENCE_CONSUMER, in an import-free module
  - The single ISO-weekday conversion for the cadence engine (isoWeekdayInZone)
  - Half-open [start, end) contact-window membership (isInsideWindow) and a named refusal for overnight/zero-width windows (assertValidWindow / InvalidContactWindowError)
  - The D-09 slot chooser (nextAllowedSlot) and the two offset placements (preferredSlotOnOrAfter, slotAtOffsetDays)
  - materializeCadenceSchedule — the D-01/D-02/D-03 birth schedule, deterministic under a pinned RNG
  - D-04 recipient selection (selectPrimaryContact) with normalizeAuMobile / normalizeEmail
  - Pure suites runnable without ALLOW_REMOTE_TESTS — 23 previously-ungated suites now execute on a bare `npm test`
affects: [03-02 tracer tick, 03-03 event consumption, 03-04 rewindow and dispatch, 03-05 operator controls, 04-messaging, 05-drafting, 07-reporting]

actuals:
  tokens: 24270
  tasks: 1
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Zone resolution confined to two operations: reading a candidate instant's tenant wall clock, and constructing the instant for a chosen wall-clock slot — every other comparison is UTC milliseconds"
    - "Calendar-day arithmetic performed on a TZDate pinned to UTC and returned as a DATE, with the moment built afterwards from the tenant's wall clock — so a DST day cannot shift which date a touch lands on"
    - "Injected RNG drawn exactly once per placement, before any branch is chosen, so the number of candidate days examined cannot influence the result"
    - "A deterministic final tie-break (lowest uuid) whose only job is to make the answer independent of an unordered query's row order"
    - "Environment gates deferred to first credential read via property getters, so a pure suite never trips a guard about production data"

key-files:
  created:
    - src/core/cadence/constants.ts
    - src/core/cadence/window.ts
    - src/core/cadence/materialize.ts
    - src/core/cadence/primary-contact.ts
    - tests/cadence-window.test.ts
    - tests/cadence-materialize.test.ts
    - tests/cadence-primary-contact.test.ts
  modified:
    - tests/helpers/env.ts

key-decisions:
  - "nextAllowedSlot and the offset placement are two functions, not one function with a flag — folding them together would let an anchor at 14:00 drag every later touch to 14:00 through the same-day branch, which is not what a mid-morning preferred send time means"
  - "Contact-type precedence dominates channel usability: a BILLING contact with a mobile does not outrank a JOB contact we can only email, because reaching the wrong person quickly is not an improvement"
  - "A mobile missing its leading zero ('412345678') is refused rather than repaired — restoring the digit is a guess whose wrong answer is a message to a stranger in the client's name, and whose right answer saves one triage entry"
  - "normalizeAuMobile is applied to the phone column as a fallback when mobile is empty; because the normalizer accepts only mobile shapes, the fallback can recover a real mobile and can never promote a landline"
  - "parseTimeOfDay throws rather than returning null: every available fallback for a malformed contact-hours value (midnight, always-open, skip the tenant) is a compliance decision made by accident"
  - "Jitter is clamped to non-negative and a slot pushed past the window close falls back to the last minute inside it — unreachable while JITTER_MAX_MINUTES stays far below any real window width, which is exactly why it is written down"
  - "The WR-09 disposable-stack gate moved from module scope to property getters on testEnv, so it fires on credential access rather than on setup-file load; a suite that reads testEnv is a suite about to open a connection"

requirements-completed: [CAD-01, CAD-02]

coverage:
  - id: D1
    description: "Contact-hours membership is half-open [start, end) and ISO-weekday correct in the tenant zone: an instant exactly at contact_hours_end is refused, exactly at contact_hours_start is accepted, and all seven ISO weekdays map correctly including a Perth Sunday whose UTC day is Saturday"
    requirement: "CAD-02"
    verification:
      - kind: unit
        ref: "tests/cadence-window.test.ts#REFUSES the instant at exactly contact_hours_end"
        status: pass
      - kind: unit
        ref: "tests/cadence-window.test.ts#accepts the instant at exactly contact_hours_start"
        status: pass
      - kind: unit
        ref: "tests/cadence-window.test.ts#isoWeekdayInZone — Monday = 1 .. Sunday = 7 (Pitfall 2) [7 cases]"
        status: pass
      - kind: unit
        ref: "tests/cadence-window.test.ts#reads the weekday in the TENANT zone, not in UTC"
        status: pass
      - kind: unit
        ref: "tests/cadence-window.test.ts#refuses an instant whose UTC day is allowed but whose tenant day is not"
        status: pass
    human_judgment: false
  - id: D2
    description: "An overnight or zero-width contact window is refused by name (InvalidContactWindowError) rather than interpreted — Assumption A1 handled loudly"
    requirement: "CAD-02"
    verification:
      - kind: unit
        ref: "tests/cadence-window.test.ts#throws a NAMED error on an overnight window"
        status: pass
      - kind: unit
        ref: "tests/cadence-window.test.ts#throws on a zero-width window even though Phase 1 already rejects it"
        status: pass
      - kind: unit
        ref: "tests/cadence-window.test.ts#rejects an overnight window before it can place anything"
        status: pass
    human_judgment: false
  - id: D3
    description: "Postgres `time` strings parse to integer minutes and malformed values (including an unpadded '9:30') are refused loudly rather than compared as strings"
    requirement: "CAD-02"
    verification:
      - kind: unit
        ref: "tests/cadence-window.test.ts#parseTimeOfDay — the driver hands us strings, not Dates (Pitfall 3) [12 cases]"
        status: pass
    human_judgment: false
  - id: D4
    description: "D-09 slot selection: later today at now + jitter when the window is open with margin, the preferred slot today when the anchor precedes it, otherwise the next allowed day — rolling past every day absent from contact_days and clamping a preferred time that falls outside the window to the window start"
    requirement: "CAD-02"
    verification:
      - kind: unit
        ref: "tests/cadence-window.test.ts#nextAllowedSlot — D-09: later today if the window is still open [13 cases]"
        status: pass
      - kind: unit
        ref: "tests/cadence-window.test.ts#preferredSlotOnOrAfter — the offset-touch placement [2 cases]"
        status: pass
    human_judgment: false
  - id: D5
    description: "D-01 — a cadence can never be born overdue: with an anchor 60 days after the quote's issue date, every materialized scheduledAt is at or after the anchor, including when the anchor falls after hours or on a weekend"
    requirement: "CAD-02"
    verification:
      - kind: unit
        ref: "tests/cadence-materialize.test.ts#ignores the quote issue date entirely: a 60-day-old quote still schedules forward"
        status: pass
      - kind: unit
        ref: "tests/cadence-materialize.test.ts#is still forward-only when the anchor lands after the window closes"
        status: pass
      - kind: unit
        ref: "tests/cadence-materialize.test.ts#is still forward-only when the anchor lands on a weekend"
        status: pass
      - kind: unit
        ref: "tests/cadence-window.test.ts#never returns an instant before the anchor, whatever the jitter draw"
        status: pass
    human_judgment: false
  - id: D6
    description: "D-03 — jitter comes only from the injected RNG, is drawn exactly once per touch, and is baked into the stored instant: two runs with the same pinned RNG are deep-equal, and neither materialize.ts nor window.ts contains a call to the global random source"
    requirement: "CAD-02"
    verification:
      - kind: unit
        ref: "tests/cadence-materialize.test.ts#produces deep-equal schedules for two runs with the same pinned RNG"
        status: pass
      - kind: unit
        ref: "tests/cadence-materialize.test.ts#draws from the RNG exactly once per touch"
        status: pass
      - kind: unit
        ref: "tests/cadence-window.test.ts#draws jitter exactly once per placement"
        status: pass
      - kind: unit
        ref: "tests/cadence-materialize.test.ts#contains no Math.random — the injected RNG is the only randomness source"
        status: pass
      - kind: unit
        ref: "tests/cadence-window.test.ts#contains no Math.random — jitter is injected or it is not deterministic"
        status: pass
    human_judgment: false
  - id: D7
    description: "Offset touches land on the anchor's tenant-zone date plus offset_days at the preferred slot, resolved through TZDate per date — proven across the Sydney AEDT→AEST transition where the same 09:30 wall clock is a different UTC instant on either side"
    requirement: "CAD-02"
    verification:
      - kind: unit
        ref: "tests/cadence-materialize.test.ts#places the same 09:30 wall-clock slot at different UTC instants across the AEDT→AEST change"
        status: pass
      - kind: unit
        ref: "tests/cadence-materialize.test.ts#places the offset touches on anchor-date + offset at preferred + jitter"
        status: pass
    human_judgment: false
  - id: D8
    description: "Materialized touches are strictly ordered by touch_number, carry originalOffsetDays and the snapshotted channel, and equal offsets still produce a deterministic touch_number-ordered schedule; duplicate touch numbers, negative offsets and an unusable anchor are refused"
    requirement: "CAD-01"
    verification:
      - kind: unit
        ref: "tests/cadence-materialize.test.ts#materializeCadenceSchedule — total, ordered, and loud about bad input [7 cases]"
        status: pass
      - kind: unit
        ref: "tests/cadence-materialize.test.ts#carries originalOffsetDays through, which is D-07’s relative-gap basis"
        status: pass
    human_judgment: false
  - id: D9
    description: "D-04 — primary-contact selection is deterministic and total: contact_type precedence JOB > BILLING > Property Manager > other (case-insensitive), usable mobile before usable email within a tier, lowest sm8_contact_uuid as final tie-break, inactive contacts excluded, and an empty or all-unusable list returns null"
    requirement: "CAD-01"
    verification:
      - kind: unit
        ref: "tests/cadence-primary-contact.test.ts#selectPrimaryContact — contact_type precedence [7 cases]"
        status: pass
      - kind: unit
        ref: "tests/cadence-primary-contact.test.ts#selectPrimaryContact — channel usability inside a tier [4 cases]"
        status: pass
      - kind: unit
        ref: "tests/cadence-primary-contact.test.ts#returns the same contact whatever order the repository happened to return"
        status: pass
      - kind: unit
        ref: "tests/cadence-primary-contact.test.ts#selectPrimaryContact — exclusions and the honest null [5 cases]"
        status: pass
    human_judgment: false
  - id: D10
    description: "Address normalization: AU mobiles reach E.164 from every common local shape, landlines / 1300 numbers / non-AU numbers / a mobile missing its leading zero all return null, and emails are trimmed, lowercased and shape-checked"
    requirement: "CAD-01"
    verification:
      - kind: unit
        ref: "tests/cadence-primary-contact.test.ts#normalizeAuMobile — Pattern 7 normalization [21 cases]"
        status: pass
      - kind: unit
        ref: "tests/cadence-primary-contact.test.ts#normalizeEmail [9 cases]"
        status: pass
      - kind: unit
        ref: "tests/cadence-primary-contact.test.ts#returns normalized addresses, not the raw ServiceM8 strings"
        status: pass
    human_judgment: false
  - id: D11
    description: "All four modules are framework-free (no next/* imports) and the named policy constants exist"
    requirement: "CAD-01"
    verification:
      - kind: other
        ref: "grep -rn \"from 'next/\" src/core/cadence/ → no matches; grep -q MIN_GAP_HOURS / CADENCE_CONSUMER src/core/cadence/constants.ts → both succeed"
        status: pass
      - kind: unit
        ref: "tests/cadence-window.test.ts / cadence-materialize.test.ts / cadence-primary-contact.test.ts — 'imports nothing from next/*' [3 cases]"
        status: pass
      - kind: other
        ref: "npm run typecheck && npm run lint (--max-warnings=0)"
        status: pass
    human_judgment: false
  - id: D12
    description: "The three suites run with no database access and no ALLOW_REMOTE_TESTS opt-in, and the full suite is green against the hosted Sydney project with no regression from the env-gate change"
    verification:
      - kind: unit
        ref: "npx vitest run tests/cadence-window.test.ts tests/cadence-materialize.test.ts tests/cadence-primary-contact.test.ts → 125/125"
        status: pass
      - kind: integration
        ref: "npm run test:remote → 39 files, 812 tests, all pass"
        status: pass
      - kind: other
        ref: "npm test (no opt-in) → 23 pure files pass, 586 tests; the 16 DB suites correctly refuse"
        status: pass
    human_judgment: false

# Metrics
duration: 16 min
completed: 2026-08-27
status: complete
---

# Phase 3 Plan 07: Pure Scheduling Core Summary

**The cadence engine's timing brain — contact-hours window math, anchor-relative materialization with injected jitter, and deterministic recipient selection — shipped as four framework-free modules whose every "never" is a passing assertion rather than a code-review promise.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-08-27T11:57:26Z
- **Completed:** 2026-08-27T12:13:23Z
- **Tasks:** 1 (TDD: RED then GREEN)
- **Files modified:** 8 (7 created, 1 modified)

## Accomplishments

- **Every timing "never" in the phase goal is now a test, not a promise.** Out-of-hours is impossible because the boundary is half-open and asserted at exactly `contact_hours_end`; Sunday-is-unreachable is impossible because all seven ISO weekdays are asserted, one of them on a Perth instant whose UTC day differs; born-overdue is impossible because a 60-day-old quote's schedule is asserted forward of its anchor; and a guessed recipient is impossible because an all-unusable contact list returns `null`.
- **The three failure modes research predicted are each closed by construction rather than by care.** There is exactly one `getDay()` call in the cadence engine and it is the ISO conversion (Pitfall 2). Every window comparison is between integer minutes parsed from the driver's `'HH:MM:SS'` string, and an unpadded `'9:30'` is refused (Pitfall 3). Jitter is drawn once per placement from an injected RNG before any branch is chosen (Pitfall 4) — so the number of candidate days the roller examines cannot influence the answer.
- **DST is proven, not assumed.** A Perth-only suite cannot distinguish real zone resolution from a hard-coded +8, because Perth never changes offset. The Sydney block crosses the 5 April 2026 AEDT→AEST transition and asserts that the same 09:30 wall clock is `22:30Z` on one side and `23:30Z` on the other — three days and one hour apart, which a fixed offset gets wrong by exactly an hour.
- **Recipient selection cannot drift between two ticks.** The lowest-uuid tie-break exists solely so that an unordered repository query cannot change who gets messaged, and the test asserts it across four permutations of the same three contacts. A recipient that changed mid-cadence would break reply threading, opt-out matching and Phase 7 attribution simultaneously.
- **`npm test` became a real gate.** 23 pure suites — 586 tests covering date math, state transitions, normalization and the lint tripwires — could not previously run at all without declaring that production data was fair game. They now run in 14 seconds with no opt-in, while the destructive-stack refusal stays exactly as strong for the 16 suites that open connections.

## Task Commits

1. **Task 1 (RED): three failing suites + the pure-suite env gate** — `da2de38` (test)
2. **Task 1 (GREEN): constants, window, materialize, primary-contact** — `1ef5dcb` (feat)

No REFACTOR commit: the GREEN implementation needed no cleanup pass.

## Files Created/Modified

### Core (`src/core/cadence/`)
- `constants.ts` — the nine policy magnitudes (D-02/03/09/10/11/12/14) plus `CADENCE_CONSUMER`, with no imports, and a header separating what is a per-tenant DEFAULT from what is product policy
- `window.ts` — `parseTimeOfDay`, `isoWeekdayInZone`, `isInsideWindow`, `assertValidWindow`, `nextAllowedSlot`, `preferredSlotOnOrAfter`, `slotAtOffsetDays`, plus `InvalidContactWindowError` and `NoAllowedContactDayError`
- `materialize.ts` — `materializeCadenceSchedule`, with the D-01 anchor argument spelled out in the header alongside the `occurred_at` trap it exists to avoid
- `primary-contact.ts` — `selectPrimaryContact`, `normalizeAuMobile`, `normalizeEmail`; the full D-04 rule is stated in the file header, which is the documentation D-04 required

### Tests
- `tests/cadence-window.test.ts` (new) — 40 cases
- `tests/cadence-materialize.test.ts` (new) — 21 cases
- `tests/cadence-primary-contact.test.ts` (new) — 64 cases
- `tests/helpers/env.ts` — the WR-09 gate deferred to credential access (see Deviation 1)

## Decisions Made

Recorded in `key-decisions` above. The three worth reading in full:

1. **The same-day branch and the offset placement are separate functions.** `nextAllowedSlot(anchor)` answers "when may we next contact this tenant", and its first branch is deliberately `anchor + jitter` rather than the preferred time — that branch is what sends a quote ticked eligible at 10am *this morning*, which is what D-01 buys. `slotAtOffsetDays` answers a different question, about a DATE: touch 4 belongs on anchor + 14 days at the preferred time, whatever hour the anchor fell at. A single function with a flag would have let a 14:00 anchor drag the entire cadence to 14:00, quietly discarding the mid-morning decision.

2. **Contact type outranks channel usability, and the test pins the direction.** It is tempting to prefer whoever we can text. But `contact_type` is a statement about *who asked for the work* and channel is a statement about *how we reach them*; a BILLING contact with a mobile beating a JOB contact we can email would mean texting the bookkeeper about a bathroom the homeowner commissioned. Reaching the wrong person quickly is not an improvement.

3. **A mobile missing its leading zero is refused, not repaired.** `412345678` is almost certainly `0412345678` mangled by a spreadsheet. Restoring the digit is nonetheless a guess, and the asymmetry decides it: a wrong guess sends a stranger a message in the client's name, while refusing costs one quote appearing on the operator's triage list with a visibly odd number next to it. Same reasoning as `parseTimeOfDay` throwing instead of defaulting — every silent fallback available in this file decides a compliance or reputation question by accident.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The plan's own verification command could not run: the vitest setup file refused every suite, pure or not**

- **Found during:** Task 1 (RED), before a line of implementation existed
- **Issue:** `tests/helpers/env.ts` is the global `setupFiles` entry, and it performed the WR-09 disposable-stack refusal at module scope. Because a setup file is evaluated once per *test file*, that refusal fired for all 39 suites — including the 23 that touch no database. `npx vitest run tests/cadence-window.test.ts` (this task's stated `<verify><automated>`) therefore exited with "Refusing to run integration tests against a non-local Supabase stack" before collecting a single test, and the plan's acceptance criterion "All three pure suites pass locally with no DB access (no ALLOW_REMOTE_TESTS gating)" was unreachable. The pre-existing consequence is worth recording: `npm test` had not been a runnable command in this repo, and proving a pure function required asserting out loud that production data was fair game.
- **Fix:** Deferred the missing-variable check and the disposable-stack refusal from module scope into `resolveTestEnv()`, and exposed `testEnv` as an object of property getters. The gate now fires on the first read of a real credential. This keeps the guarantee exactly as strong — every existing read of `testEnv` happens at a DB suite's module scope or inside `helpers/seed.ts`, so a destructive suite still trips it before its first `beforeAll` — while a pure suite, which never touches the object, runs free. The `canReachServiceM8` skip warning moved inside the same function, which also stops it printing 39 times per run.
- **Files modified:** `tests/helpers/env.ts`
- **Verification:** `npx vitest run tests/leak.test.ts` still refuses with the identical message; `npm run test:remote` green at 39 files / 812 tests; `npm test` (no opt-in) now runs 23 pure files / 586 tests and correctly refuses the 16 DB suites; CI is unaffected because it points at a localhost stack, which was never gated.
- **Committed in:** `da2de38`

**2. [Rule 2 - Missing Critical] `normalizeAuMobile` is applied to the `phone` column as a fallback, which the plan's behavior spec did not mention**

- **Found during:** Task 1 (GREEN)
- **Issue:** The plan's `<behavior>` describes mobile usability in terms of the `mobile` field only. But `quote_contacts` mirrors both `phone` and `mobile`, ServiceM8 does not police which one a tradie types a number into, and D-04's failure mode is a reachable customer being sent to triage. Reading only `mobile` would send those quotes to the operator for a data-entry habit.
- **Fix:** `usableMobile()` tries `mobile` then `phone`, both through `normalizeAuMobile`. This cannot promote a landline, because the normalizer accepts only `04`/`+614` shapes — a Perth landline in `phone` still returns null. Documented at the function with that argument spelled out, and asserted in both directions.
- **Files modified:** `src/core/cadence/primary-contact.ts`, `tests/cadence-primary-contact.test.ts`
- **Verification:** `reads a mobile-shaped number out of the phone column when mobile is empty` and `does not promote a landline sitting in the phone column` — both green
- **Committed in:** `da2de38` (test), `1ef5dcb` (implementation)

**3. [Rule 2 - Missing Critical] Three refusals added to `materializeCadenceSchedule` that the plan did not specify**

- **Found during:** Task 1 (GREEN)
- **Issue:** The plan specifies the happy path. Three input shapes reach it that produce a cadence which *looks* correct and is not: an `Invalid Date` anchor (every `scheduled_at` becomes Invalid, and an Invalid `scheduled_at` compares false to every due-check, so the cadence sits inert forever); a duplicated `touch_number` (rejected several layers later by `cadence_touches`' unique index, far from the cause); and a negative `offsetDays` (a request to schedule into the past, which is the exact thing D-01 exists to make impossible).
- **Fix:** All three throw with a message naming the decision. Also added a named `NoAllowedContactDayError` for a tenant whose `contact_days` is empty, so that configuration terminates the day-roller with a cause rather than appearing as a hung tick.
- **Files modified:** `src/core/cadence/materialize.ts`, `src/core/cadence/window.ts`, `tests/cadence-materialize.test.ts`, `tests/cadence-window.test.ts`
- **Verification:** `materializeCadenceSchedule — total, ordered, and loud about bad input` (7 cases) and `throws by name when no day is ever allowed` — green
- **Committed in:** `da2de38` (test), `1ef5dcb` (implementation)

**4. [Rule 1 - Bug] The file header named the global random source literally, which failed the plan's own grep criterion**

- **Found during:** Task 1 (GREEN), first full run — 124 of 125 passing
- **Issue:** `materialize.ts`'s header explained *why* the RNG is injected by naming `Math.random` in prose. The acceptance criterion is a literal `grep -c "Math.random"` returning 0, and the in-suite assertion mirrors it, so the explanation failed the rule it was explaining. This is the house style ("record what is deliberately absent") colliding with a substring check — the same collision 03-01 hit with its cross-tenant tripwire.
- **Fix:** Reworded to "the global random source" and added the reason the grep exists, so the prose still records the absence without tripping the check.
- **Files modified:** `src/core/cadence/materialize.ts`
- **Verification:** `grep -c "Math.random"` returns 0 for both `materialize.ts` and `window.ts`; the two in-suite assertions green
- **Committed in:** `1ef5dcb`

---

**Total deviations:** 4 auto-fixed (1 bug, 2 missing critical, 1 blocking)
**Impact on plan:** No scope creep and no architectural change. Deviation 1 is the only one that touched a file outside this plan's manifest, and it was a hard prerequisite — the task's stated verify command could not execute without it; the side benefit is that 586 previously-unrunnable assertions now run on every `npm test`. The other three tightened guarantees the plan's `must_haves` already asked for.

## Issues Encountered

- **`npm test` still exits non-zero on this machine**, because the 16 database suites correctly refuse a non-local stack. That is the designed behaviour of WR-09, not a regression: the sanctioned commands remain `npm run test:remote` locally and `npx vitest run` in CI (which points at a localhost Supabase stack). What changed is that the 23 pure files now report real results instead of all 39 failing on the gate.
- **No blocker encountered from the Phase 4 IPND address or the ServiceM8 partner registration.** Neither is on this plan's path — nothing here performs I/O of any kind.

## Known Stubs

None. Every function in this plan is fully implemented and exercised; there are no placeholder returns, no `TODO`/`FIXME` markers, and no component wired to empty data.

## Threat Flags

None. This plan adds no network endpoint, no auth path, no file access and no schema change. T-3-27 (tampering/compliance on window and materialization) is mitigated as the register requires — the half-open boundary, the ISO-weekday mapping and D-01's never-born-overdue are each asserted rather than reviewed. T-3-28 (contact PII in memory) remains `accept`: these are pure functions with no logging and no side effects, and the PII persists only through 03-01's RLS-protected tables.

## User Setup Required

None — no external service configuration, no environment variable, no migration.

## Next Phase Readiness

**Ready. Wave 2 can call proven math instead of inventing it mid-slice, which is the reason this plan exists.**

- **03-02 (the tracer tick)** should call `materializeCadenceSchedule({ anchor, templates, window, preferredSendTime, jitterMinutes })` with the anchor taken from the `quote_opened` event's `detected_at` or the consumption `now()` — **never `occurred_at`**, which carries the ServiceM8 issue date (RESEARCH Pitfall 1). The superseded comment at `src/core/sync/eligibility.ts:52-54` still says otherwise and is assigned to a later plan in this phase to correct.
- **The 03-01 seam holds as designed:** `templates.ensureDefaults(offsetDays)` still takes the offsets as a parameter and imports nothing from here. The Wave-2 caller passes `DEFAULT_TOUCH_OFFSET_DAYS`.
- **03-04 (re-window)** has its inputs ready: `MIN_GAP_HOURS`, `STALENESS_CAP_HOURS`, `CADENCE_EXPIRY_DAYS` and `SAME_DAY_MARGIN_MINUTES` are named, and `nextAllowedSlot` is the reschedule primitive — call it with a fresh jitter draw per placement, exactly as materialization does. `originalOffsetDays` on each touch is the D-07 relative-gap basis.
- **Contracts later plans must honour:**
  - `selectPrimaryContact` returning `null` means operator triage. It is not a retryable condition and must never be replaced with a fallback recipient.
  - `nextAllowedSlot` never returns an instant before its `from` argument. Anything that appears to schedule backwards is a caller passing the wrong anchor, not a window bug.
  - `InvalidContactWindowError` means a tenant row this engine refuses to interpret (overnight or zero-width hours). It is an operator-facing configuration problem, not a transient failure to retry.
  - Jitter must be drawn at *placement* and stored. Drawing it at dispatch reintroduces Pitfall 4 and silently invalidates every min-gap and staleness comparison.

---
*Phase: 03-cadence-engine*
*Completed: 2026-08-27*

## Self-Check: PASSED

Created files verified present on disk:
- `src/core/cadence/constants.ts`, `window.ts`, `materialize.ts`, `primary-contact.ts` — FOUND
- `tests/cadence-window.test.ts`, `tests/cadence-materialize.test.ts`, `tests/cadence-primary-contact.test.ts` — FOUND

Commits verified in `git log`:
- `da2de38` — FOUND
- `1ef5dcb` — FOUND

Plan-level verification re-run at close-out:
- `npx vitest run tests/cadence-window.test.ts tests/cadence-materialize.test.ts tests/cadence-primary-contact.test.ts` — PASS (125/125, no DB, no ALLOW_REMOTE_TESTS)
- `npm run typecheck` — PASS
- `npm run lint` (`--max-warnings=0`) — PASS
- `npm run test:remote` — PASS (39 files, 812 tests; no regression from the env-gate change)

All task acceptance criteria re-verified: three pure suites green without gating; the 60-day backfill test asserts every `scheduledAt >= anchor`; the instant at exactly `contact_hours_end` is refused and at `contact_hours_start` accepted; all seven ISO days covered for Perth instants; two pinned-RNG runs are deep-equal and `grep -c "Math.random"` returns 0 for both `materialize.ts` and `window.ts`; `grep -q "MIN_GAP_HOURS"` and `grep -q "CADENCE_CONSUMER"` both succeed against `constants.ts`.
