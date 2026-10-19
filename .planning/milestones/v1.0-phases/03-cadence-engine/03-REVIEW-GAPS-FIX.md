---
phase: 03-cadence-engine
fixed_at: 2026-08-28T10:15:00Z
review_path: .planning/phases/03-cadence-engine/03-REVIEW-GAPS.md
iteration: 1
fix_scope: critical_warning
findings_in_scope: 7
fixed: 7
skipped: 0
status: all_fixed
migrations_added:
  - 0023_cadence_replay_key_required
  - 0024_cadence_one_live_per_job
migrations_applied_to_hosted_db: true
verification_ran_in: main checkout (workflow.use_worktrees = false)
---

# Phase 03 (gap closure): Code Review Fix Report

**Fixed at:** 2026-08-28T10:15:00Z
**Source review:** `.planning/phases/03-cadence-engine/03-REVIEW-GAPS.md`
**Iteration:** 1
**Scope:** Critical + Warning (Info findings IN-01…IN-04 not in scope)

**Summary:**

- Findings in scope: 7 (1 critical, 6 warnings)
- Fixed: 7
- Skipped: 0

All seven were fixed as separate atomic commits. Two new migrations were written
and applied to the hosted Sydney database **before** the code depending on them
was committed, per the live-cron rule. `npm run db:migrate` re-run afterwards
reports 25 journal entries and is a clean no-op, confirming both are idempotent.

---

## Fixed Issues

### CR-01: The G-3-2 replay guarantee is not enforced by the database

**Commit:** `a44a120`
**Files modified:** `src/db/migrations/0023_cadence_replay_key_required.sql` (new),
`src/db/migrations/meta/_journal.json`, `src/db/schema/cadences.ts`,
`tests/helpers/seed.ts`, `tests/leak.test.ts`, `tests/cadence-repository.test.ts`

**Applied fix:** Migration 0023 adds `cadences_replay_key_present`, a `NOT VALID`
CHECK requiring `created_by_event_id IS NOT NULL OR created_at <
'2026-08-28T08:53:44.384+00:00'`, and re-creates
`cadences_one_per_opened_event` with `WHERE created_by_event_id IS NOT NULL`.

The carve-out timestamp is the **real** 0021 application moment, read from
`drizzle.__drizzle_migrations.created_at = 1787907224384`, rather than the
placeholder in the review.

The NULL-writing path the review identified (`tests/helpers/seed.ts`
`seedCadence`) now mints a synthetic **negative** key per row — `quote_status_events.id`
is a bigserial, so a negative can never collide with a real event id. The base is
randomised per process because vitest runs suites in parallel against one shared
hosted database and `cadences_one_per_opened_event` is global.

Two further keyless writers were found beyond the one the review named, both in
`tests/leak.test.ts`: `seedCadenceFixture`, and the RLS-denial insert at the
`operator` client. The latter mattered for a reason of its own — without a key
the new CHECK would also have refused that insert, so the isolation assertion
would have passed for a reason unrelated to tenant isolation. It now supplies a
key so RLS remains the only thing that can refuse it.

`cadence-repository.test.ts` witnesses the refusal **by constraint name**,
walking drizzle's cause chain: drizzle re-wraps driver errors as `Failed query:
…`, so matching the outer message would have accepted any failed insert.

### WR-01: `mirror_missing` is terminal, irreversible, and completely silent

**Commit:** `448670b`
**Files modified:** `src/core/cadence/dispatch.ts`, `tests/cadence-dispatch.test.ts`,
`tests/cadence-tick.test.ts`, `tests/cadence-tick-route.test.ts`

**Applied fix:** `'mirror_missing'` joins `DISPATCH_REFUSALS`, and the branch
returns it instead of borrowing `'quote_closed'`. The branch now logs via
`console.error` in the style the sibling `no_address` branch already uses — ids
only, never customer data — and the message states that the cadence is stopped
**and cannot be resumed**.

The two literal refusal maps in the tick suites are the deliberate
acknowledge-a-new-member tripwires the code comments describe; both were updated,
which is those tripwires working as designed. `tests/cadence-tick-route.test.ts`
derives its assertion from `DISPATCH_REFUSALS`, so it needed no change.

Not done: routing to the `onAlert` operator-alert path. That was the review's
"better" option, not its minimum; it needs an alert sink plumbed through
`dispatchOne`, which is a wiring change rather than a review fix. Noted below as
a follow-up.

### WR-02: `cadences_one_live_per_quote` is keyed on the surrogate `quotes.id`

**Commit:** `cedcdd6`
**Files modified:** `src/db/migrations/0024_cadence_one_live_per_job.sql` (new),
`src/db/migrations/meta/_journal.json`, `src/db/schema/cadences.ts`,
`src/db/repository/for-tenant.ts`, `tests/cadence-consume-events.test.ts`

**Applied fix:** Migration 0024 adds `cadences_one_live_per_job`, `UNIQUE
(tenant_id, sm8_job_uuid) WHERE status IN ('active','paused')`.

Two judgment calls:

- **Tenant-scoped**, not a bare unique on `sm8_job_uuid`. Two tenants may
  legitimately hold the same ServiceM8 job — `quotes` is unique on the pair for
  exactly that reason (`tests/webhook-hint.test.ts`). A bare unique would let one
  client's live cadence block another client's.
- **Kept alongside** `cadences_one_live_per_quote` rather than replacing it. The
  review offered either; keeping both costs one index and avoids having to argue
  the new one covers everything the old one did. No existing invariant is
  weakened to land a fix.

Verified against the production database **before** applying that no
`(tenant_id, sm8_job_uuid)` group held more than one live cadence, so the index
build could not fail on data.

A new end-to-end test in `cadence-consume-events.test.ts` stages the full
scenario: live cadence → ops purge of the `quotes` row → re-sync under a new
surrogate uuid → `markChaseEligible` → consume.

### WR-03: The G-3-2 dedupe key is not recorded when the *live* index wins

**Commit:** `e3b707d`
**Files modified:** `src/db/schema/cadences.ts`, `src/core/cadence/consume-events.ts`,
`tests/cadence-consume-events.test.ts`, `tests/cadence-repository.test.ts`

**Applied fix:** Took the review's second option (narrow the claim), because its
first option does not work. **The review's suggested `claimOpenedEvent` cannot
close this gap:** stamping the second event onto the existing cadence requires
that row to hold two event ids in one column. A `WHERE created_by_event_id IS
NULL` guard would match only pre-0021 legacy rows, so after CR-01 the update is a
no-op for every row it would need to affect. Closing it properly needs a separate
consumed-event ledger, which is a larger design decision than a review fix.

So: the claim is narrowed to "…once its id has been recorded", stated in the
schema header, at the `if (!cadence)` branch in `consume-events.ts`, and in the
test assertion message the review flagged. The two **emitter** facts the gap
currently rests on — `markChaseEligible` requiring `needs_review`, and
`run-sync.ts` suppressing `quote_opened` for pre-existing quotes — are written
down where the author of a new eligibility writer will meet them.

A tripwire in `cadence-repository.test.ts` pins the gap at the repository level
(create → refused by live index → stop → replay the refused event → duplicate),
so that closing it, or making it reachable, turns a test red instead of turning a
customer's phone on.

### WR-04: New G-3-2 test contains a tautological assertion

**Commit:** `8468a11`
**Files modified:** `tests/cadence-consume-events.test.ts`

**Applied fix:** The assertion is now a before/after comparison of **every**
`cadence_touches` id in the tenant, captured before the rewind and compared after.

**Deviated from the review's suggested snippet, which would not have worked.**
The review proposed a tenant-wide `toHaveLength(touchesBefore.length)`; that fails
outright, because this file's tests share one tenant and run in file order, so
earlier quotes already hold five touches each. The honest question is not "how
many touches does the tenant have" but "did the replay add one anywhere" — which
is the set comparison now in place.

### WR-05: Migration 0021 is not idempotent

**Commit:** `b8c337a`
**Files modified:** `src/db/migrations/0021_cadence_created_by_event.sql`

**Applied fix:** Rewritten to the `IF NOT EXISTS` house idiom, with a header
explaining why the edit is safe.

**The review's reconciliation warning does not apply.** It cautioned that
"drizzle keys on the file hash, so editing the file after it was recorded will
itself need a reconciliation step." Verified against
`node_modules/drizzle-orm/pg-core/dialect.js`: the migrator selects the last
applied row by `created_at` and applies every journal entry whose `when` exceeds
it (`Number(lastDbMigration.created_at) < migration.folderMillis`). It records
the hash but never compares it. Editing an applied migration is therefore inert
for existing databases and changes only what a fresh one replays. Confirmed
empirically — `npm run db:migrate` after the edit is a clean no-op.

The `CREATE UNIQUE INDEX` / `ACCESS EXCLUSIVE` note the review raised as
secondary is recorded in the migration header for when the table grows.

### WR-06: Targetless `ON CONFLICT DO NOTHING` absorbs every constraint

**Commit:** `d4ad72c`
**Files modified:** `tests/rls-coverage.test.ts`, `src/db/repository/for-tenant.ts`,
`tests/cadence-repository.test.ts`

**Applied fix:** Kept the targetless form (the review agrees it is correct) and
added the tripwire it implies, in `tests/rls-coverage.test.ts` where catalog
queries already live and where the question is "did the migration actually reach
the database".

The test pins the exact set of unique arbiters on `cadences` against the
**migrated** database. **The review's suggested expected set was incomplete** — it
omitted `cadences_id_tenant_uniq`, the `(id, tenant_id)` pairing that
`cadence_touches` references (migration 0019), and included
`cadences_tenant_status_idx`, which is not unique and so is not an arbiter. The
set was read from `pg_index.indisunique` rather than transcribed.

Two meaningful predicates are asserted rather than assumed: that
`cadences_one_live_per_job` is tenant-scoped and partial on live statuses, and
that `cadences_one_per_opened_event` is **not** partial on status but **is**
partial on NULL. A second test asserts the CR-01 CHECK exists and is `NOT VALID`.

---

## Verification

Run in the **main checkout** — `workflow.use_worktrees` is `false` in
`.planning/config.json`, so per the documented opt-out no worktree was created
and all edits and commits were made directly on `main`.

| Gate | Result |
|------|--------|
| `npm run typecheck` | clean |
| `npm run lint` (`--max-warnings=0`) | clean |
| `npx vitest run tests/prospect-staging-retention.test.ts` (journal monotonicity) | 16 passed |
| `ALLOW_REMOTE_TESTS=yes npx vitest run` over `cadence-consume-events`, `cadence-dispatch`, `cadence-repository`, `cadence-tick` | 31 passed, 4 files |
| `ALLOW_REMOTE_TESTS=yes npx vitest run tests/rls-coverage.test.ts` | 18 passed |
| `ALLOW_REMOTE_TESTS=yes npx vitest run tests/leak.test.ts` | passed (with `cadence-tick`, 44 total) |
| `npm run db:migrate` (re-run) | clean no-op, 25 journal entries |

**Negative verification of WR-02.** A test that passes is not evidence the fix is
what makes it pass. `cadences_one_live_per_job` was temporarily dropped and the
new test re-run: `cadencesCreated` came back **1** — the duplicate live cadence
the review predicted — and **0** with the index restored. The index was
recreated immediately and its presence re-confirmed from `pg_indexes`.

**CR-01** is likewise witnessed by a rejection (constraint name matched through
drizzle's cause chain), not merely by the absence of a duplicate.

Per-fix verification was Tier 1 (re-read) plus Tier 2 (`tsc --noEmit` and eslint
across the project) on every commit, plus the affected suites.

---

## Operational note (not a finding)

A full-suite `vitest run` was killed by a harness timeout partway through. The
remote-test global setup pauses the two production pg_cron jobs for the duration
of a run and re-arms them at teardown; a killed run never reaches teardown, so
`cadence-tick` and `sm8-sync-tick` were left `active = false` — production was
not ticking. The next run detected and reported this rather than masking it.

Both jobs were re-armed with the recovery statement that warning prints
(`cron.alter_job(jobid, active := true)`), and `cron.job` was re-read to confirm
all five jobs are active. **No schedule or command was modified** — the commands
carry bearer secrets and were not touched. Nothing about this was caused by the
fixes themselves, but it is worth knowing that an interrupted remote test run
silently stops the production cron.

---

## Follow-ups not in scope

- **WR-01, the "better" half:** route `mirror_missing` to the `onAlert`
  operator-alert path `run-sync.ts` uses. Needs an alert sink threaded through
  `dispatchOne`.
- **WR-03, the real close:** a consumed-event ledger would make the replay
  guarantee unconditional. The tripwire test is the placeholder until then.
- **IN-01 probe was run** even though Info was out of scope: `SELECT count(*)
  FROM cadences WHERE stop_reason = 'removed' AND NOT EXISTS (SELECT 1 FROM
  quotes …)` returned **0**, so no backfill is needed. (The `cadences` table held
  zero rows throughout, which is also why the CR-01 carve-out is vacuous today.)
- **IN-04(b)** — the missing trailing newline on `_journal.json` — was fixed
  incidentally, since 0023 and 0024 required editing that file.
- **IN-02, IN-03, IN-04(a)** untouched: out of scope.

---

_Fixed: 2026-08-28T10:15:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
