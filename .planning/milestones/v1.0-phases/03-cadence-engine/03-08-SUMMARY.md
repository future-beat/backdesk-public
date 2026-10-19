---
phase: 03-cadence-engine
plan: 8
subsystem: database
tags: [postgres, drizzle, idempotence, outbox, unique-index, on-conflict, vitest]

# Dependency graph
requires:
  - phase: 02-servicem8-sync-quote-leakage-audit
    provides: the `quote_status_events` outbox and its bigserial event ids, which are now the cadence replay-dedupe key
  - phase: 03-cadence-engine
    provides: consume-events.ts (the shared-cursor outbox consumer) and the cadences table its creation path writes
provides:
  - "`cadences.created_by_event_id` — which consumed `quote_opened` created each cadence"
  - "`cadences_one_per_opened_event` unique index — the REPLAY guarantee, complementing `cadences_one_live_per_quote`'s CONCURRENCY guarantee"
  - "targetless `ON CONFLICT DO NOTHING` on cadence creation, so a conflict on either index returns zero rows instead of a 23505"
  - "regression tests for both G-3-2 replay shapes (born-stopped, and stopped mid-batch by a win)"
affects: [phase-4-reply-handling, phase-7-revenue-attribution, cadence-engine]

actuals:
  tokens: 6900
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Two unique indexes on one table, each answering a different question, arbitrated by a TARGETLESS ON CONFLICT DO NOTHING"
    - "Record the event id that caused a row, so replay of that event conflicts regardless of the row's later state"

key-files:
  created:
    - src/db/migrations/0021_cadence_created_by_event.sql
    - src/db/migrations/meta/0021_snapshot.json
  modified:
    - src/db/schema/cadences.ts
    - src/db/repository/for-tenant.ts
    - src/core/cadence/consume-events.ts
    - src/db/migrations/meta/_journal.json
    - tests/cadence-consume-events.test.ts
    - tests/cadence-repository.test.ts

key-decisions:
  - "Cadence replay dedupe keys on the EVENT id, never on quote_id — a blanket unique on quote_id would forbid the legal sequential-cadence history (reopen -> re-triage -> fresh quote_opened) along with the illegal duplicate"
  - "`cadences.create` is TARGETLESS `ON CONFLICT DO NOTHING`: naming an arbiter would make a conflict on the OTHER unique index raise 23505, which consume-events reads as a blocked run and which holds the SHARED cursor for every tenant — G-3-2 would have been upgraded from duplicate rows to a permanent wedge"
  - "`created_by_event_id` is nullable in the column and REQUIRED in `CadenceCreate`: NULL exists only so pre-0021 rows stay legal (NULLS DISTINCT means they never conflict), while no caller may decline the replay guarantee"
  - "RED was established by temporarily decoupling `createdByEventId` from `event.id` in the working tree (never committed, never deployed) rather than by reverting the migration on a live database"

patterns-established:
  - "One unique index per QUESTION, not per table: a partial index that answers 'never two live' cannot also answer 'never twice from one event', and the second index is not redundant with the first"
  - "A replay test must assert the row COUNT for the quote inline — a newest-first read helper cannot see a duplicate appended behind it"

requirements-completed: [CAD-01, CAD-03]

coverage:
  - id: D1
    description: "Migration 0021 adds `cadences.created_by_event_id` + the `cadences_one_per_opened_event` unique index, journaled at idx 21 with a monotonic `when`, and is applied to the hosted Sydney DB"
    requirement: CAD-01
    verification:
      - kind: integration
        ref: "tests/prospect-staging-retention.test.ts#migration journal ordering"
        status: pass
      - kind: other
        ref: "npm run db:migrate (hosted Sydney session pooler; 'Migrations applied. Journal entries recorded: 22')"
        status: pass
    human_judgment: false
  - id: D2
    description: "Cadence creation refuses a replayed `quote_opened` whose first cadence was created ALREADY STOPPED (`no_contact`) — exactly one cadence row, zero replay counters, unmoved `updated_at`"
    requirement: CAD-01
    verification:
      - kind: integration
        ref: "tests/cadence-consume-events.test.ts#refuses to re-create a cadence that was created already-stopped (G-3-2)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Worst case closed: replaying a `quote_opened` whose live cadence was stopped by a `won` in the same held batch creates no new cadence and materializes no fresh touches — nothing is re-chased"
    requirement: CAD-03
    verification:
      - kind: integration
        ref: "tests/cadence-consume-events.test.ts#refuses to re-create a cadence whose quote was already won mid-batch (G-3-2)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Sequential cadences stay legal: a FRESH `quote_opened` from the reopen -> re-triage flow still creates a second cadence for the same quote, and the two rows carry different `created_by_event_id`s"
    requirement: CAD-01
    verification:
      - kind: integration
        ref: "tests/cadence-consume-events.test.ts#starts a fresh, second cadence when the operator re-triages a reopened quote"
        status: pass
    human_judgment: false
  - id: D5
    description: "A creation conflict on EITHER unique index returns zero rows, never a thrown 23505 — proven separately for the live-partial index (distinct event ids) and the event-id index (same id, after the cadence stopped)"
    requirement: CAD-01
    verification:
      - kind: integration
        ref: "tests/cadence-repository.test.ts#runs every cadence namespace, and refuses where it must"
        status: pass
    human_judgment: false

# Metrics
duration: 16 min
completed: 2026-08-28
status: complete
---

# Phase 3 Plan 8: G-3-2 Gap Closure Summary

**Cadence creation is now deduped on the outbox event that caused it (`created_by_event_id` + a plain unique index, arbitrated by a targetless `ON CONFLICT DO NOTHING`), so a held-cursor replay of `quote_opened` is a zero-row no-op whatever status the first cadence has reached.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-08-28T08:47:00Z
- **Completed:** 2026-08-28T09:03:06Z
- **Tasks:** 2
- **Files modified:** 8 (2 created, 6 modified)

## Accomplishments

- **Closed G-3-2's root cause.** `cadences_one_live_per_quote` is partial over `status IN ('active','paused')`, so a replayed `quote_opened` whose first cadence had left live state hit NO index and created a duplicate cadence on every tick the shared cursor stayed held. Migration 0021 adds `created_by_event_id` with a plain unique index `cadences_one_per_opened_event`, which refuses that replay at any status.
- **Removed the wedge the naive fix would have introduced.** `cadences.create` no longer names an arbiter. With the old explicit target, a conflict on the NEW index would have raised 23505; `consume-events` catches a throw as a blocked run, which freezes the SHARED cursor for every tenant — turning a duplicate-row bug into a permanent outage. Targetless `ON CONFLICT DO NOTHING` no-ops on either index.
- **Kept sequential cadences legal.** The dedupe is on the event id, not the quote id, so the reopen -> re-triage -> fresh `quote_opened` flow still produces a second cadence — asserted explicitly, plus an assertion that the two rows carry different event ids, so a future over-widening to a blanket unique on `quote_id` fails the suite.
- **Covered the case UAT test 2 found untested.** Every pre-existing replay assertion rewound behind a CLOSING event (exercising the guarded `UPDATE`); none rewound behind a `quote_opened` whose cadence was no longer live. Both G-3-2 shapes now have tests, and both were verified to FAIL against pre-fix behavior before being committed.

## Task Commits

1. **Task 1: created_by_event_id column + unique index, targetless ON CONFLICT, consumer passes event.id** — `76bc5df` (fix)
2. **Task 2: stopped-cadence replay tests** — `5209b28` (test)

_Task 2 is a `tdd="true"` task whose mechanism necessarily shipped in Task 1 (the migration is [BLOCKING] and must precede writer code against a live per-minute cron). RED was therefore established in the working tree, not by reverting production: `createdByEventId` was temporarily decoupled from `event.id` (reproducing the pre-fix state where only the partial live index arbitrates), both new tests failed, and the change was reverted before the GREEN run and the commit. See Deviations._

## Files Created/Modified

- `src/db/migrations/0021_cadence_created_by_event.sql` — `ADD COLUMN created_by_event_id bigint` + `CREATE UNIQUE INDEX cadences_one_per_opened_event`. Exactly two statements, as the migrations README's snapshot-drift note predicted.
- `src/db/migrations/meta/0021_snapshot.json`, `meta/_journal.json` — generated snapshot; journal entry hand-retagged to `0021_cadence_created_by_event` (idx 21, `when` 1787907224384 > 0020's 1787811300000).
- `src/db/schema/cadences.ts` — the nullable `createdByEventId` column, the second unique index, and a new WHY-header section explaining why there are two unique indexes, why neither subsumes the other, and why the writer must be targetless.
- `src/db/repository/for-tenant.ts` — `CadenceCreate` now omits `createdByEventId` from the inferred insert type and intersects it back as REQUIRED; `cadences.create` is targetless `ON CONFLICT DO NOTHING` with the load-bearing comment.
- `src/core/cadence/consume-events.ts` — passes `createdByEventId: event.id`; file header's replay paragraph and shape (d)'s comment now name BOTH indexes and describe what zero rows means since G-3-2.
- `tests/cadence-consume-events.test.ts` — two new quotes (one deliberately contactless), an `openedEventIdFor` helper, and the two G-3-2 replay tests; the sequential-cadence test now asserts distinct event ids.
- `tests/cadence-repository.test.ts` — the two existing creates carry DISTINCT fake event ids so they still witness the LIVE index specifically; a new case re-creates with the SAME id after `stopWhereLiveByQuoteIds` and must get zero rows.

## Decisions Made

- **Dedupe on the event, not the quote.** The UAT gap text offered "widen the dedupe to any cadence for the quote" as one fix direction. That is a blanket unique on `quote_id`, which `cadences.ts` already documents as wrong: it forbids the legal sequential-cadence history along with the illegal duplicate. The event id gets both — the same event conflicts, a new event does not.
- **Targetless `ON CONFLICT DO NOTHING` is the load-bearing line, not the index.** The index alone would have converted G-3-2 from "duplicate rows" into "23505 -> blocked run -> shared cursor held forever for every tenant", which is strictly worse. Both halves shipped in the same commit for that reason.
- **Nullable column, required field.** NULL exists purely so pre-0021 rows stay legal, and Postgres's default NULLS DISTINCT means those legacy rows can never conflict with each other. Making the TypeScript field optional would have let a future caller silently opt out of the replay guarantee and discover it in production, on a held cursor.
- **RED without touching the live database.** Reverting migration 0021 or the writer code to observe a genuine RED would have meant running the pre-fix path against the hosted DB the per-minute production cron rides on. Decoupling the id in the working tree reproduces exactly the pre-fix arbitration (only the partial live index) with no deployed or committed artifact.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `tests/cadence-repository.test.ts` moved into the Task 1 commit**

- **Found during:** Task 1 (verification step — `npm run typecheck`)
- **Issue:** Making `createdByEventId` required in `CadenceCreate` broke the two existing `cadences.create` call sites in `tests/cadence-repository.test.ts`. The plan assigns that file to Task 2, so Task 1's own `<verify>` (`npm run typecheck`) could not pass and Task 1 would have committed a non-compiling tree.
- **Fix:** Applied the minimal part of Task 2's prescription in Task 1 — the two distinct fake event ids (`900_000_001` / `900_000_002`) with the comment explaining why they must differ — plus a correction to that file's header, which claimed `cadences.create`'s ON CONFLICT "must INFER the partial index" (no longer true once the statement went targetless). Task 2 then added the new same-id-after-stop refusal case as planned.
- **Files modified:** `tests/cadence-repository.test.ts`
- **Verification:** `npm run typecheck` clean before the Task 1 commit; the file's suite passes against the hosted DB in Task 2's run.
- **Committed in:** `76bc5df` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** No scope change — the work was moved one commit earlier so each commit compiles independently. Nothing was added or dropped.

## Issues Encountered

- **`db:generate` named the migration `0021_complete_victor_mancha`.** Anticipated by the plan. The SQL contained exactly the two expected statements (no re-emitted hand-written objects), so the file was renamed and the journal `tag` hand-edited to `0021_cadence_created_by_event`; the snapshot number already matched. The journal-ordering guard (`tests/prospect-staging-retention.test.ts`) confirmed idx 21 with a monotonic `when` — the drizzle trap that fired on three consecutive Phase 2 plans did not fire here.
- **First RED attempt short-circuited on a different assertion.** In the born-stopped test, the pre-fix run failed at `expect(created.createdByEventId).toBe(openedId)` before reaching the duplicate-row assertion. The re-chase test failed exactly where intended (`cadencesCreated: 1` — the duplicate ACTIVE cadence). Both are genuine RED; the first proves the key is recorded, the second proves the duplicate is prevented.

## Verification Results

| Check | Result |
|---|---|
| `ALLOW_REMOTE_TESTS=yes npx vitest run tests/cadence-consume-events.test.ts tests/cadence-repository.test.ts tests/cadence-dispatch.test.ts` | 3 files, 20 tests passed (hosted Sydney DB; harness paused both production crons for the run) |
| `npx vitest run tests/prospect-staging-retention.test.ts` (journal ordering guard) | 16 passed |
| `npm run typecheck` | clean |
| `npm run lint` (`--max-warnings=0`) | clean |
| `grep -n "onConflictDoNothing()" src/db/repository/for-tenant.ts` | line 1121 — targetless, as required |
| `npm run db:migrate` (hosted Sydney) | applied; 22 journal entries recorded |
| RED (pre-fix simulation) | both new tests FAILED as designed, then passed after restore |

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **G-3-2 is closed.** All four `must_haves.truths` hold and are asserted by tests against the hosted database.
- **Deploy note:** migration 0021 is applied to the hosted DB and the code is committed locally. Vercel deploys from GitHub, so the fix reaches the running per-minute cron only after `git push origin main`. Until then production runs the old code, which is safe by construction — the nullable ADD COLUMN is compatible in both directions and old code simply never writes the column.
- **Still open in this phase:** G-3-5 (minor — `removed` conflates a ServiceM8 job deletion with a mirror-missing row; needs a distinct `mirror_missing` stop reason, a CHECK-constraint migration and coverage).
- No new blockers.

## Self-Check: PASSED

- All files listed in `key-files` exist on disk (7/7 verified with `[ -f ]`).
- Both task commits present in `git log`: `76bc5df`, `5209b28`.
- Post-commit deletion check on `76bc5df`: no tracked files deleted.
- All plan-level `<verification>` commands re-run and green (table above).

---
*Phase: 03-cadence-engine*
*Completed: 2026-08-28*
