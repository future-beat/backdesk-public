---
phase: 03-cadence-engine
plan: 9
subsystem: database
tags: [postgres, drizzle, check-constraint, vocabulary, cadence, attribution, vitest]

# Dependency graph
requires:
  - phase: 03-cadence-engine
    provides: "dispatch.ts's just-in-time revalidation branch (WR-07), which stopped a cadence whose mirrored quote row had vanished — under the same word as an observed ServiceM8 deletion"
  - phase: 03-cadence-engine
    provides: "migration 0021 at journal idx 21 (plan 03-08), behind which 0022 is journaled"
provides:
  - "`mirror_missing` — an eighth `CADENCE_STOP_REASONS` member meaning 'our mirror has no row and we cannot say why'"
  - "migration 0022 — `cadences_stop_reason_known` re-added with the widened 8-member vocabulary"
  - "`removed` narrowed to exactly one meaning: ServiceM8 told us the job is gone (outbox event, or `sm8_active=false` on a row we still hold)"
  - "a PAIRED test in tests/cadence-dispatch.test.ts that fails if either bucket is re-conflated"
affects: [phase-7-revenue-attribution, phase-4-reply-handling, cadence-engine]

actuals:
  tokens: 3950
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "A stop reason records the EVIDENCE we had, not the inference we drew — two facts with different evidence get two words even when the mechanical response is identical"
    - "Distinction-by-pair: two sibling tests asserting opposite values on adjacent code paths, so a re-conflation cannot pass by renaming one of them"

key-files:
  created:
    - src/db/migrations/0022_mirror_missing_stop_reason.sql
  modified:
    - src/db/schema/cadences.ts
    - src/db/migrations/meta/_journal.json
    - src/core/cadence/dispatch.ts
    - src/app/(console)/clients/[id]/quotes/[quoteId]/page.tsx
    - tests/cadence-dispatch.test.ts

key-decisions:
  - "'mirror_missing' is written ONLY by dispatch's missing-row branch; `stopReasonForQuote` is untouched, so `removed` keeps both of its evidence-backed writers and loses its third, evidence-free one"
  - "The CHECK was widened on the hosted DB BEFORE the writer was committed (the 0018 ordering principle): a writer racing a stale 7-member CHECK does not degrade, it THROWS inside the claim transaction every minute and the cadence never stops"
  - "transitions.ts deliberately untouched — the matrix maps outbox EVENTS to outcomes, and mirror_missing has no event; adding a matrix arm would invent an outbox vocabulary member nothing emits"
  - "The touch skip reason (`cadence_stopped`) and the dispatch refusal (`quote_closed`) were left alone: they describe this tick's decision, not the durable reason, and only the durable column feeds Phase 7"
  - "Phase 7's attribution bucket for mirror_missing is deliberately NOT decided here — distinguishability is the requirement; deciding the bucket now would guess on Phase 7's behalf"

patterns-established:
  - "Less evidence is a reason for a DIFFERENT word, not a reason to reuse the nearest one — the inverse of the argument WR-07 originally made and UAT overruled"
  - "Widening a CHECK is applied to the live database in its own step ahead of the writer commit, and the migration header says WIDENING ONLY so a reader knows it cannot fail on data"

requirements-completed: [CAD-04]

coverage:
  - id: D1
    description: "A cadence stopped because its mirrored quote row is ABSENT carries `stop_reason='mirror_missing'`, distinguishable from a ServiceM8-deleted job"
    requirement: CAD-04
    verification:
      - kind: integration
        ref: "tests/cadence-dispatch.test.ts#stops the cadence as `mirror_missing` when the quote row is gone, not one false skip per tick"
        status: pass
    human_judgment: false
  - id: D2
    description: "`removed` still means an OBSERVED deletion: a PRESENT quote row with `sm8_active=false` stops the cadence as `removed`, with its due touch skipped `quote_closed` and the touch behind it `cadence_stopped`"
    requirement: CAD-04
    verification:
      - kind: integration
        ref: "tests/cadence-dispatch.test.ts#stops the cadence as `removed` when the row is PRESENT but ServiceM8 deactivated the job"
        status: pass
      - kind: integration
        ref: "tests/cadence-consume-events.test.ts (outbox `removed` event -> 'removed', unchanged)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The DB CHECK accepts `mirror_missing` before any code can write it — migration 0022 re-adds `cadences_stop_reason_known` with 8 members, journaled at idx 22 behind 0021, and is applied to the hosted Sydney DB"
    requirement: CAD-04
    verification:
      - kind: integration
        ref: "tests/prospect-staging-retention.test.ts#migration journal ordering"
        status: pass
      - kind: other
        ref: "npm run db:migrate (hosted Sydney session pooler; 'Migrations applied. Journal entries recorded: 23')"
        status: pass
    human_judgment: false
  - id: D4
    description: "The console quote-detail page renders an honest label for `mirror_missing` rather than a raw enum string"
    verification: []
    human_judgment: true
    rationale: "The label's wording is a voice judgment — whether 'the quote vanished from our records — not a deletion ServiceM8 told us about' reads correctly to the operator is not something a test can assert; no snapshot or automated UI check covers STOP_REASON_LABELS."

# Metrics
duration: 6 min
completed: 2026-08-28
status: complete
---

# Phase 3 Plan 9: G-3-5 Gap Closure Summary

**`removed` no longer answers two different questions: an observed ServiceM8 deletion keeps the word, while a cadence whose quote row has vanished from our own mirror now stops as `mirror_missing` — a new CHECK-enforced vocabulary member applied to the live database before the writer existed.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-08-28T09:06:34Z
- **Completed:** 2026-08-28T09:12:47Z
- **Tasks:** 2
- **Files modified:** 6 (1 created, 5 modified)

## Accomplishments

- **Split the conflated bucket.** `dispatchOne`'s `!chaseable` branch wrote `removed` whether the just-in-time re-read found a deactivated quote or NO quote row at all. Those are different facts with different evidence: one is ServiceM8 telling us the job is gone, the other is our mirror having lost the row for reasons we cannot see (a purge, a sync bug, a deletion we never observed). Phase 7 attributes recovered revenue on this column and cannot rebuild the distinction after the fact.
- **Widened the CHECK before the writer, on the live database.** Migration 0022 follows the 0018/0020 drop-then-re-add idiom, is journaled at idx 22 behind 03-08's idx 21, and was applied to the hosted Sydney DB in its own step ahead of the code commit. This ordering is not tidiness: the per-minute cron is live, and a writer racing a stale seven-member CHECK would not degrade gracefully — it would raise inside the claim transaction every minute, and the cadence would never stop at all.
- **Narrowed `removed` to exactly two writers, both evidence-backed.** `stopReasonForQuote` (`!sm8Active -> 'removed'`) is untouched, and the outbox `removed` event path is untouched. The only thing that changed is the branch that had no evidence to offer.
- **Made the distinction the thing the suite asserts.** The existing missing-row test was updated rather than replaced (its once-only-stop regression guard, the reason WR-07 wrote it, survives intact), and a sibling test was added for the present-but-deactivated row. Re-conflating either direction turns one of the pair red; a rename alone cannot pass both.

## Task Commits

1. **Task 1: `mirror_missing` joins the vocabulary — CHECK first, then the writer** — `1fc0c66` (fix)
2. **Task 2: the two buckets asserted as a pair** — `f9bc539` (test)

_Task 2 is a `tdd="true"` task whose mechanism necessarily shipped in Task 1 (the migration is [BLOCKING] against a live per-minute cron). RED was therefore the pre-existing assertion failing against the new writer — `expected 'removed', received 'mirror_missing'` — which is a genuine red and additionally proved the hosted CHECK had accepted the new member._

## Files Created/Modified

- `src/db/migrations/0022_mirror_missing_stop_reason.sql` — `cadences_stop_reason_known` dropped-if-present and re-added with eight members. Hand-written: CHECK constraints are invisible to drizzle snapshots, so no `db:generate` and no snapshot file. Header names G-3-5, the conflation it ends, and marks the change WIDENING ONLY.
- `src/db/migrations/meta/_journal.json` — idx 22, `when` 1787908000000 (> 0021's 1787907224384), tag matching the filename.
- `src/db/schema/cadences.ts` — `'mirror_missing'` in `CADENCE_STOP_REASONS` with its doc line, and `removed`'s doc line rewritten to name its two evidence-backed writers explicitly.
- `src/core/cadence/dispatch.ts` — one word in the ternary, and a rewritten comment block. The old comment argued `removed` was "the same fact arriving with less evidence"; it now records that UAT overruled that argument and why.
- `src/app/(console)/clients/[id]/quotes/[quoteId]/page.tsx` — `STOP_REASON_LABELS.mirror_missing`.
- `tests/cadence-dispatch.test.ts` — the missing-row test renamed and re-asserted; a new sibling seeding a PRESENT row with `sm8_active=false` and asserting `removed`.

## Decisions Made

- **`transitions.ts` was correctly left alone.** The gap text listed it as an artifact, but the state machine maps outbox EVENTS to outcomes and `mirror_missing` has no event — it is a dispatch-time discovery, like `contact_suppressed`, `no_contact` and `operator_closed`. Adding a matrix arm would have invented an outbox vocabulary member nothing emits.
- **The touch skip reason and the dispatch refusal stay as they were.** The missing-row touch is still skipped `cadence_stopped` (honest: the cadence reached terminal state; the quote did not observably close) and the caller still counts the refusal as `quote_closed` (that vocabulary describes this tick's decision, not the durable reason). Only the column Phase 7 reads needed the new word.
- **Phase 7's bucket for `mirror_missing` is not decided here.** The requirement is that the two are distinguishable; choosing now whether a vanished mirror row counts against attribution would be guessing on Phase 7's behalf with no report to test it against.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Verification Results

| Check | Result |
|---|---|
| `ALLOW_REMOTE_TESTS=yes npx vitest run tests/cadence-dispatch.test.ts tests/cadence-consume-events.test.ts` | 2 files, 20 tests passed (hosted Sydney DB; harness paused both production crons for the run) |
| `npx vitest run tests/prospect-staging-retention.test.ts` (journal ordering guard) | 16 passed, before and after the 0022 entry |
| `npm run db:migrate` (hosted Sydney) | applied; 23 journal entries recorded |
| `npm run typecheck` | clean |
| `npm run lint` (`--max-warnings=0`) | clean |
| `grep -n mirror_missing` across schema / migration / dispatch / console page | all four present |
| Migration 0022 re-adds the constraint with exactly 8 members | confirmed by reading the file |
| RED (pre-fix assertion) | `expected 'removed', received 'mirror_missing'` — the write reached the hosted CHECK and was accepted |

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **G-3-5 is closed.** All four `must_haves.truths` hold: the vocabulary is widened at the CHECK first, the writer produces the new word, `removed` retains exactly its two evidence-backed paths, and the console labels the new reason.
- **Deploy note:** migration 0022 is applied to the hosted DB and the code is committed locally. Vercel deploys from GitHub, so the running per-minute cron picks up the new writer only after `git push origin main`. Until then production runs the old code against the widened CHECK, which is safe in both directions — a widened vocabulary accepts everything the old writer produces.
- Both Phase 3 UAT gaps (G-3-2, G-3-5) are now closed. No new blockers.

## Self-Check: PASSED

- All files listed in `key-files` exist on disk (6/6 verified with `[ -f ]`).
- Both task commits present in `git log`: `1fc0c66`, `f9bc539`.
- Post-commit deletion check on both commits: no tracked files deleted.
- All plan-level `<verification>` commands re-run and green (table above).

---
*Phase: 03-cadence-engine*
*Completed: 2026-08-28*
