---
phase: 03-cadence-engine
fixed_at: 2026-08-28T05:35:00Z
review_path: .planning/phases/03-cadence-engine/03-REVIEW.md
iteration: 1
findings_in_scope: 14
fixed: 14
skipped: 0
status: all_fixed
---

# Phase 3: Code Review Fix Report

**Fixed at:** 2026-08-28
**Source review:** `.planning/phases/03-cadence-engine/03-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 14 (3 critical, 11 warning — `fix_scope: critical_warning`)
- Fixed: 14
- Skipped: 0

**Where verification ran:** the **main checkout**, not an isolated worktree.
`.planning/config.json` sets `workflow.use_worktrees: false`, so every edit,
gate run and commit happened in `~/Documents/Projects/Productised service`
on `main`. The numbers below are reproducible from the tree you are looking at.

**Database:** three migrations were generated AND APPLIED to the hosted Sydney
project (`npm run db:migrate`) before the suites that depend on them were run —
0018, 0019, 0020. See "Migrations applied" below.

---

## Fixed Issues

### CR-01: A failure in event consumption aborts dispatch for every tenant

**Files modified:** `src/core/cadence/consume-events.ts`, `src/core/cadence/run-tick.ts`, `tests/cadence-tick-isolation.test.ts`
**Commit:** `4fc3a02`

`consumeRun`'s catch names the two contact-window errors and rethrows everything
else; the caller awaited it unguarded, so a deadlock, statement timeout,
`RangeError` from materialization or a seeding failure propagated out of the
whole tick. A throwing run is now a *blocked* run — the head-of-line rule the
file already prescribes — and `runCadenceTick` guards the pass as a whole for
the two calls (`registerConsumerCursor`, `forAllTenants_pendingQuoteEvents`)
that happen before any per-run guard exists. `NO_CONSUMPTION` is exported rather
than restated so the fallback cannot drift from `ConsumeQuoteEventsResult`.

New suite `tests/cadence-tick-isolation.test.ts` stubs the repository seam to
reject and asserts (a) `consumeQuoteEvents` resolves, (b) dispatch still runs,
(c) the caught value is never logged.

### CR-02: One tenant's uninterpretable window wedges the shared cursor for everyone

**Files modified:** `src/core/cadence/consume-events.ts`, `src/core/cadence/run-tick.ts`, `src/core/cadence/window.ts`, `src/app/api/internal/cadence-tick/route.ts`, `tests/cadence-tick-isolation.test.ts`, `tests/cadence-tick-route.test.ts`
**Commit:** `c138cb4`

"Stop the cursor" and "stop the scan" are now separate statements. `consumeRun`
takes an `advanceCursor` flag, false for every run after a block, so the shared
position freezes where it stands while other tenants' runs still commit their
stops. Nothing is ever stepped over — the held events stay ahead of the cursor
and are re-read next tick, which is safe because replay is idempotent by
construction here. A blocked tenant's *own* later runs are skipped, because
order within a tenant carries meaning. `tenantsBlocked` is carried to the tick's
response body so a wedge is visible in `cron.job_run_details`.

**Deliberate deviation from the suggested fix.** The review's snippet advanced
the shared cursor to `min(cursorFloor - 1, lastConsumedId)` *after* the loop. The
advance lives INSIDE each run's transaction — clause 3 of the consumption
contract, and the property that makes a crash roll back both the writes and the
position — so a post-hoc advance would have broken the invariant the finding is
protecting. Withholding the advance achieves the same blast-radius reduction
without moving it out of the transaction.

**The finding's second half was already in force.** Migration 0004 has carried
`tenants_hours_ordered CHECK (contact_hours_start < contact_hours_end)` and
`tenants_days_nonempty` since Phase 1, so the unusable window is already
unreachable through any writer. No new migration was added. `window.ts`'s header
claimed "nothing rejects start > end", stale since 0004 — corrected there
instead.

### CR-03: A resume pulls not-yet-due touches EARLIER

**Files modified:** `src/core/cadence/resume.ts`, `tests/cadence-rewindow.test.ts`, `tests/cadence-resume.test.ts`
**Commit:** `b020f01`

`computeResumeSchedule`'s first placement is now clamped: a slot earlier than the
touch's own `scheduledAt` is discarded in favour of the slot that already stood.
One-directional, so an overdue touch is repaired exactly as before, and
`applyResumeRewindow`'s existing no-op guard then leaves `updated_at` alone.

Both suites the review identified as blind were extended: the pure one asserts
the original slot **to the millisecond** (an ordering assertion passes on the
three-days-early placement), and a DB test pauses/resumes with touch 1 `sent` and
touch 2 three days out, asserting `scheduled_at` and `updated_at` are unchanged.

### WR-01: The `no_address` refusal never retires the touch

**Files modified:** `src/db/schema/cadence-touches.ts`, `src/db/migrations/0018_touch_skip_reason_no_address.sql`, `src/db/migrations/meta/_journal.json`, `src/core/cadence/dispatch.ts`, `src/app/(console)/clients/[id]/quotes/[quoteId]/page.tsx`, `tests/cadence-dispatch.test.ts`
**Commit:** `6779ac6`

Took the review's preferred path rather than the minimum-viable one: `no_address`
is now a member of `TOUCH_SKIP_REASONS` in its own right (schema constant,
migration 0018 widening the CHECK, console label), so the touch is retired under
a true name instead of staying claimable for ~60,000 ticks and starving the
tenant's batch behind it. The DB test dispatches twice and asserts the second
call finds nothing.

### WR-02: The per-reason refusal breakdown is computed and thrown away

**Files modified:** `src/core/cadence/run-tick.ts`, `src/app/api/internal/cadence-tick/route.ts`, `tests/cadence-tick-route.test.ts`
**Commit:** `f76d430`

`refusals: Record<DispatchRefusal, number>` now reaches `CadenceTickResult` and
the response body. It is the one nested value in an otherwise flat body, and the
T-3-24 assertion was **strengthened** rather than relaxed to accommodate it: the
test now walks the body recursively so every LEAF must be a number, where the
previous flat check would have stopped at the object. A second test pins the key
set to `DISPATCH_REFUSALS` and the sum to `refused`.

### WR-03: A second, unguarded `Math.random()` jitter draw

**Files modified:** `src/core/cadence/consume-events.ts`, `tests/cadence-jitter.test.ts`
**Commit:** `e6ed95c`

`defaultJitter` deleted; `consumeQuoteEvents` defaults to `randomJitterMinutes`.

Rather than adding `consume-events.ts` to the list of named greps — which is how
it was missed in the first place — the new `tests/cadence-jitter.test.ts`
enumerates `src/core/cadence/` and asserts every module except `jitter.ts` is
free of the global random source, plus a guard that `jitter.ts` still holds it so
the rule cannot go vacuous. A module added next phase is covered on creation.

### WR-04: Three consume-pass counters computed and discarded

**Files modified:** `src/core/cadence/run-tick.ts`, `src/app/api/internal/cadence-tick/route.ts`, `tests/cadence-tick-route.test.ts`
**Commit:** `3612c22`

`quotesFlaggedForReview`, `eventsSkipped` and `cursorAt` added to
`CadenceTickResult` and the enumerated response body.

### WR-05: `claimDue` does not correlate `cadences.tenant_id`

**Files modified:** `src/db/repository/for-tenant.ts`, `src/db/migrations/0019_cadence_touch_tenant_pairing.sql`, `src/db/migrations/meta/_journal.json`
**Commit:** `5b5381f`

Predicate added (free — `cadences` is already joined and indexed on
`(tenant_id, status)`). Also took the "consider a follow-up" half: migration 0019
adds `cadences_id_tenant_uniq UNIQUE (id, tenant_id)` and the composite FK
`cadence_touches (cadence_id, tenant_id) → cadences (id, tenant_id)`, making the
pairing structural. It is added **alongside** the drizzle-declared single-column
FK rather than replacing it, so the SQL and the drizzle snapshot stay in step.
`rls-coverage` and `leak` were re-run after applying it.

### WR-06: `resumeConnection` re-windows cadences created during the pause

**Files modified:** `src/core/sync/connect.ts`, `tests/resume-write-guard.test.ts`
**Commit:** `56ba167`

Scoped to cadences whose `created_at` precedes `existing.pausedAt`. A null
`pausedAt` (a proactive key rotation) yields an EMPTY scope — "nothing was
resumed", which is what the option documents it to mean — because nothing slipped
on our account and anything overdue for an unrelated reason belongs to the tick's
own re-window pass. `resume-write-guard.test.ts`'s repository stub gained
`cadences.listLive` and three tests covering the scope, the empty scope, and a
failed re-window still being a successful re-key.

### WR-07: A missing quote row leaves the cadence live and writes a false skip

**Files modified:** `src/core/cadence/dispatch.ts`, `tests/cadence-dispatch.test.ts`
**Commit:** `dcd85f3`

The touch is skipped `cadence_stopped` (not `quote_closed`, which would be false)
and the cadence is stopped as `removed` — what `stopReasonForQuote` itself returns
for `!sm8Active`, and the honest reading of "not in our mirror any more". The
refusal reported to the caller stays `quote_closed`, since that vocabulary
describes this tick's decision rather than the durable reason. The DB test deletes
a mirrored quote row and asserts both touches end terminal under a true reason.

### WR-08: All four control-action results render simultaneously

**Files modified:** `src/app/(console)/clients/[id]/quotes/[quoteId]/cadence-controls.tsx`
**Commit:** `52de25b`

One message slot keyed by the action last tapped. The key is set from `onClick`
on each submit button rather than `onSubmit` on the form: a click is unambiguous
and fires before submission, and the interaction between a submit handler and a
React `action` is not a detail this component should depend on.

### WR-09: Event consumption writes template and settings rows on runs needing neither

**Files modified:** `src/core/cadence/consume-events.ts`, `tests/cadence-tick-isolation.test.ts`
**Commit:** `89d5746`

Both seeds moved behind a memoized `prepare()` awaited in the `quote_opened`
branch only, so a run with twenty creations seeds once and a run of closing events
seeds never. A test records whether `templates.ensureDefaults` / `settings.ensure`
were reached and asserts a `won`-only run reaches neither.

### WR-10: `window_refused` is a skip reason with no writer

**Files modified:** `src/db/schema/cadence-touches.ts`, `src/db/migrations/0020_drop_window_refused_skip_reason.sql`, `src/db/migrations/meta/_journal.json`, `src/app/(console)/clients/[id]/quotes/[quoteId]/page.tsx`
**Commit:** `38b2a54`

Removed, as the review preferred. `operator_closed` in `CADENCE_STOP_REASONS` is
deliberately left alone — it is honest forward-declaration for D-16, not a
contradiction of a decision already made.

### WR-11: Convention drift across the cadence modules

**Files modified:** `eslint.config.mjs`, `src/core/cadence/consume-events.ts`, `src/core/cadence/controls.ts`, `tests/lint-ban.test.ts`, and eight test files whose imports moved to the barrel
**Commit:** `c9cfdfd`

`??` for the send-time fallback. `controls.ts` and the ten test files that
deep-imported repository internals now go through `@/db/repository`, and a
`no-restricted-imports` group makes the deep import a lint error outside
`src/db/repository/**` — production and tests alike, since the barrel is not a
production-only rule. `lint-ban.test.ts` proves the new group fires and that the
barrel itself and the repository's own region stay allowed.

### Follow-on: the tick's exhaustive result assertion

**Files modified:** `tests/cadence-tick.test.ts`
**Commit:** `d9dcb12`

`tests/cadence-tick.test.ts` pins `CadenceTickResult` with an exhaustive
`toEqual` — deliberately, so a field reaching the response body without anyone
deciding it should fails there rather than in production logs. The six fields
added by WR-02 and WR-04 are now acknowledged. `cursorAt` uses
`expect.any(Number)` because it is the shared outbox position and every other
suite moves it; exhaustiveness is preserved (an extra key still fails, a string
still fails), and the refusals breakdown is asserted member by member.

---

## Migrations applied

| Migration | What | Applied |
|---|---|---|
| `0018_touch_skip_reason_no_address` | Widens the `cadence_touches.skip_reason` CHECK to admit `no_address` | Yes |
| `0019_cadence_touch_tenant_pairing` | `cadences_id_tenant_uniq` + composite FK making the touch/cadence tenant pairing structural | Yes |
| `0020_drop_window_refused_skip_reason` | Narrows the same CHECK to drop `window_refused` | Yes |

All three ran clean against the hosted Sydney project via `npm run db:migrate`
(session pooler, port 5432). Journal entries recorded: 21. `_journal.json`
ordering satisfies `tests/prospect-staging-retention.test.ts`'s monotonic-`when`
and positional-`idx` assertions.

---

## Verification

Run in the **main checkout** (`workflow.use_worktrees: false`).

| Gate | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` (`--max-warnings=0`) | clean |
| `ALLOW_REMOTE_TESTS=yes npx vitest run` (full suite) | **1086 / 1087 passed**, 49/50 files |

Every fix was also verified with a targeted run of its own suite before commit.

### The one outstanding failure is a pre-existing flake, and that was proven

The final full run had a single failure:
`tests/cadence-controls.test.ts > resumes ONLY client-paused cadences and
re-windows exactly those (D-05, D-07)`. It passes in isolation.

Across runs the failing test **moves** — `cadence-consume-events`,
`cadence-repository`, `cadence-tick`, `sync-failure-alerts` and
`cadence-controls` have each failed once and passed on the next run. Every one of
them passes when its file is run alone. The cause is the shared hosted database:
one operator account, one `event_consumer_cursors` row across every suite, and
tenants seeded and torn down around each other. `vitest.config.mts` already
documents two races of exactly this shape and disables file parallelism because
of them.

**Confirmed against the pre-fix baseline.** `src/`, `tests/` and
`eslint.config.mjs` were checked out at `7f8e91f` (the commit immediately before
this fix run) and the same four-file combination was executed: it failed there
too, on a *different* test (`cadence-repository > promoteDue`). The working tree
was restored immediately afterwards and the gates re-run clean. The flakiness
therefore pre-dates this fix run and is not attributable to it.

For the specific test above: its touches are seeded 11–22 days in the past, so
CR-03's clamp — which only ever declines to move a touch that is still in the
FUTURE — cannot reach it.

### Requires human verification

These four fixes change behaviour in ways syntax and unit checks cannot fully
adjudicate. Each has a test, but the semantics are worth a second read before the
phase advances:

1. **CR-02 — the cursor-hold semantics.** Runs after a block now commit their
   writes without advancing the shared position, so those events are re-read on
   the next tick. This is safe only because every action in the file is
   idempotent by construction (the header's own claim). Worth confirming that
   claim still holds for every one of the five event types.
2. **CR-03 — the clamp direction.** It must never fire on an overdue touch. The
   pure suite asserts both directions, but the interaction with `slotAtOffsetDays`
   chaining for the touches *behind* a clamped one is worth a read.
3. **WR-06 — the empty scope on a null `pausedAt`.** A proactive key rotation now
   re-windows nothing where it previously re-windowed every active cadence. That
   is the honest reading, but it is a behaviour change on a path with no
   end-to-end coverage locally (`tests/rekey-resume.test.ts` is
   `skipIf(!canReachServiceM8)`).
4. **WR-07 — `removed` as the stop reason for a missing mirror row.** Phase 7
   attributes revenue on `stop_reason`; this adds a new way for a cadence to end
   up marked `removed`.

### Not covered by an automated test

**WR-08** (the control-surface message slot). The vitest environment is `node`
and the project carries no DOM testing library, so there is no way to render the
component and assert one message renders instead of four. Covered by typecheck
and by reading. If this matters, it wants a `jsdom` project and
`@testing-library/react` — a decision beyond a review fix.

---

_Fixed: 2026-08-28_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
