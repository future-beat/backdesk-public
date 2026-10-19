---
phase: 15-lead-console-reporting-privacy
plan: 01
subsystem: database / leads / text-back gate / job creation
status: complete
tags: [migration-0042, pseudonymisation, recent-conversion, job-linked-elsewhere, d-06, d-07, d-08a, d-08b]
requires:
  - Phase 14 migration 0041 (leads job linkage, leads_sm8_job_error_kind_known, leads_closed_iff_reason admitting converted)
  - Phase 13 gate (recent_negative_close at position 6, latestForMobile)
  - 14-REVIEW WR-02 (the 23505 recovery on leads_sm8_job_created_uniq)
provides:
  - Migration 0042 (one journal entry, idx 42, when 1791878630443; written NOT applied, NOT pushed)
  - Constants LEAD_RECENT_CONVERSION_HOURS=24, PSEUDONYMISE_AFTER_DAYS=LEAD_NEGATIVE_COOL_OFF_DAYS (90), PSEUDONYMISE_BATCH=200
  - Gate rule 7 recent_conversion + isRecentConversion; TextBackFacts.recentConversion
  - Vocabulary members recent_conversion (TEXT_BACK_SKIP_REASONS, position 7) and job_linked_elsewhere (LEAD_JOB_ERROR_KINDS, last)
  - pseudonymisedAt columns on leads, missedCalls, inboundMessages; hash-admitting leads_contact_mobile_e164
  - CREATE_JOB_SENTENCES['failed:job_linked_elsewhere']
affects:
  - 15-02 (any skip-reason label map for the missed-call log must carry recent_conversion; lint-ban allowlist untouched here)
  - 15-03 (pins PSEUDONYMISE_AFTER_DAYS >= LEAD_NEGATIVE_COOL_OFF_DAYS; due-reads use PSEUDONYMISE_BATCH; leads.pseudonymise writes the hash under the stamp)
  - 15-04 (tracer CI is the first database built through 0042; runs rls-coverage, lead-job-create-db, text-back-recent-conversion)
  - 15-07 (the pass writes against the stamp columns and the widened CHECK; docs §19-§20 record the three constants)
  - 15-08 (production apply of 0042 under the push protocol; 43 journal entries)
tech-stack:
  added: []
  patterns:
    - "Hash arm of a shape CHECK gated on a stamp column (pseudonymised_at IS NOT NULL), so a hash cannot land without its stamp"
    - "Retention constant DEFINED AS the gate cool-off constant so the boundary identity cannot drift silently"
    - "Rewritten CHECKs as adjacent DROP CONSTRAINT IF EXISTS + ADD pairs, after the ADD COLUMNs they read"
key-files:
  created:
    - src/db/migrations/0042_phase15_privacy_console.sql
    - src/db/migrations/meta/0042_snapshot.json
    - tests/text-back-recent-conversion.test.ts
  modified:
    - src/core/leads/constants.ts
    - src/core/leads/gate.ts
    - src/core/leads/text-back.ts
    - src/core/leads/create-job.ts
    - src/db/schema/leads.ts
    - src/db/schema/missed-calls.ts
    - src/db/schema/inbound-messages.ts
    - src/db/migrations/meta/_journal.json
    - src/db/repository/for-tenant.ts (comment only)
    - src/app/(console)/inbox/action-state.ts
    - tests/text-back-gate.test.ts
    - tests/rls-coverage.test.ts
    - tests/create-job-action.test.ts
    - tests/lead-job-create-db.test.ts
decisions:
  - "Migration statement order: three ADD COLUMNs first, then each rewritten CHECK as an adjacent DROP IF EXISTS + ADD pair (the generator put the bare DROPs first and the ADDs last); the mobile CHECK reads pseudonymised_at, so the column must exist before it"
  - "The WR-02 source pin in tests/create-job-action.test.ts anchors on `isJobCreatedUniqueViolation(error)` rather than the string `leads_sm8_job_created_uniq`: in comment-stripped code that string first appears at the JOB_CREATED_UNIQUE const (line 117), whose next recordJobFailure is the claim-path failure at 256, not the WR-02 branch"
  - "The DB-backed recent_conversion suite uses one armed tenant per case (three tenants) and SMS_FROM +61491570399, so every number in the file is in the Phase 15 3xx sub-block"
metrics:
  duration: "~16 min"
  completed: 2026-10-13
  tasks: 3
  files: 17
estimate:
  tokens: 80000
  tasks: 3
actuals:
  tokens: 50500   # chars/4 over the realized diff; ~40,600 of it is the generated 0042_snapshot.json, ~9,900 hand-written
  tasks: 3
  commits: 3
requirements-completed: []
requirements-advanced: [COMP-02, CON-05, CON-06]  # schema and gate foundations only; none is satisfied until the console, pass and live plans land
---

# Phase 15 Plan 01: Migration 0042, rule 7 `recent_conversion` and the dedicated `job_linked_elsewhere` kind Summary

Phase 15's whole schema is now one hand-finished journal entry, `0042_phase15_privacy_console` (idx 42, `when` 1791878630443, ahead of 0041's 1791619675151). It is written and **not applied anywhere and not pushed**. The entry adds three nullable `pseudonymised_at timestamptz` stamps (on `leads`, `missed_calls` and `inbound_messages`). It widens `leads_contact_mobile_e164`: the first arm is the old CHECK verbatim, and a 64-lower-hex hash is admitted only when `pseudonymised_at IS NOT NULL`. Each of the two vocabulary CHECKs gains one member, `recent_conversion` and `job_linked_elsewhere`. The entry has no table, no privilege statement, no data statement and no index.

The text-back gate has a new rule 7. A caller whose newest lead at this client converted within 24 hours (exactly-at is inside) is skipped `recent_conversion` and opens no lead. The fact comes from the same `latestForMobile` row the cool-off reads, so the gate's reads did not change. Separately, the WR-02 unique-violation recovery in `create-job.ts` now records its own kind and has its own sentence on the sheet. Before, it borrowed `parse_error`.

## Tasks

| # | Task | Commit | Key files |
|---|------|--------|-----------|
| 1 | Rule 7 `recent_conversion`: gate, fact, vocabulary member, three constants (TDD: RED 10 failing, then GREEN) | `6ee653f` | constants.ts, gate.ts, text-back.ts, schema/missed-calls.ts, for-tenant.ts (comment), text-back-gate.test.ts |
| 2 | Migration 0042: stamps, hash-admitting mobile CHECK, two vocabulary CHECKs, `job_linked_elsewhere` member (not applied) | `8db2997` | schema/{leads,missed-calls,inbound-messages}.ts, 0042 + snapshot + journal, rls-coverage.test.ts |
| 3 | `job_linked_elsewhere` on the WR-02 branch, its sentence, two DB-backed pins for CI (TDD: RED 3 failing, then GREEN) | `7db357d` | create-job.ts, inbox/action-state.ts, create-job-action.test.ts, lead-job-create-db.test.ts, text-back-recent-conversion.test.ts |

The RED and GREEN states of each TDD task went into one commit per task, as the plan's single commit message for each task specifies. RED was observed before implementing: 10 failing tests in `text-back-gate` (Task 1) and 3 failing in `create-job-action` (Task 3).

## Exported names added (for 15-02 … 15-08 to cite)

**`src/core/leads/constants.ts`** (still import-free): `LEAD_RECENT_CONVERSION_HOURS` (24), `PSEUDONYMISE_AFTER_DAYS` (`= LEAD_NEGATIVE_COOL_OFF_DAYS`, 90), `PSEUDONYMISE_BATCH` (200). The header now names §19–§20 of `docs/commercial-assumptions.md` (written in 15-07).

**`src/core/leads/gate.ts`**: `isRecentConversion(newestLead: { status; closedAt } | undefined, now): boolean`. `TextBackFacts.recentConversion: boolean` was added beside `recentNegativeClose`. Rule 7 sits between `recent_negative_close` and `recent_text`, and the header list is renumbered 1–12. `NEGATIVE_CLOSE_REASONS` is unchanged.

**`src/db/schema/missed-calls.ts`**: `TEXT_BACK_SKIP_REASONS` gains `'recent_conversion'` directly after `'recent_negative_close'`, in both the const and the CHECK literal. `TextBackGateReason` widens automatically. The column `pseudonymisedAt` is new.

**`src/db/schema/leads.ts`**: `LEAD_JOB_ERROR_KINDS` gains `'job_linked_elsewhere'` (last), in both the const and the CHECK. The column `pseudonymisedAt` is new. `leads_contact_mobile_e164` is now `contact_mobile ~ '^[+]614[0-9]{8}$' OR (pseudonymised_at IS NOT NULL AND contact_mobile ~ '^[0-9a-f]{64}$')`.

**`src/db/schema/inbound-messages.ts`**: the column `pseudonymisedAt` is new.

**`src/app/(console)/inbox/action-state.ts`**: `CREATE_JOB_SENTENCES['failed:job_linked_elsewhere']` = `That ServiceM8 job already belongs to another lead. Retry — a fresh job will be created.`

No repository method or barrel export was added. `forAllTenants_*` is still 16.

## db:generate outputs

The first `npm run db:generate` produced `0042_oval_cannonball.sql` with `when` **1791878630443**, which is ahead of 1791619675151, so no re-stamp was needed. It emitted bare `DROP CONSTRAINT` for the three CHECKs, then three `ADD COLUMN`, then three bare `ADD CONSTRAINT`. It touched no cadences object.

The hand-finish did four things:
- renamed the file to `0042_phase15_privacy_console`
- re-tagged the journal
- reordered the statements so the ADD COLUMNs come first and each CHECK is an adjacent `DROP CONSTRAINT IF EXISTS` + `ADD` pair, with every literal byte-identical to its schema file
- wrote a header in 0041's style

The header covers: ONE ENTRY / NO OTHER PLAN TOUCHES THE JOURNAL; `when` checked; SAFE TO MEET PHASE 14 CODE (the mobile CHECK's first arm is verbatim, and each vocabulary CHECK gains one member); the pre-flight expectation of zero leads; why `missed_calls_withheld_has_no_number` still holds; the founder's Phase 11 verification calls being hashed in early January 2027; and the push protocol.

The second `npm run db:generate` printed "No schema changes, nothing to migrate".

Greps over the comment-stripped SQL: CREATE TABLE 0, GRANT 0, `cadences` 0, CREATE INDEX 0, INSERT/UPDATE/DELETE 0.

## Files `tsc` forced

None. Widening `LEAD_JOB_ERROR_KINDS` forced no `Record` arm, because `CREATE_JOB_SENTENCES` is `Record<string, string>`. The per-kind pin caught the missing sentence instead, as designed.

## DB-backed suites written for CI (compiled here, never run locally)

- `tests/rls-coverage.test.ts`: a new dated Phase 15 block with two `it`s.
  - `information_schema.columns`: `pseudonymised_at` exists on exactly `inbound_messages`, `leads` and `missed_calls`, as `timestamp with time zone`, nullable.
  - `pg_constraint`: the mobile CHECK contains `pseudonymised_at IS NOT NULL`, `[0-9a-f]{64}` and the E.164 arm; the skip-reason CHECK contains `'recent_conversion'`; the error-kind CHECK contains `'job_linked_elsewhere'`.
- `tests/lead-job-create-db.test.ts`: the WR-02 case now expects `job_linked_elsewhere`, both on the returned result and on the stored `sm8_job_error_kind`. The `it` title and the dated comment were updated with it. No other case moved.
- `tests/text-back-recent-conversion.test.ts` (new): the DB-BACKED header from `lead-close.test.ts`, the armed-tenant mould and a pinned NOW (2026-10-13T02:00Z). It has three cases:
  - converted 1 h ago: `skipped` / `recent_conversion`, no lead inserted, no ledger row, nothing sent.
  - converted 25 h ago: `sent`, and a new open lead with the converted one untouched.
  - closed `other` 1 h ago: not `recent_conversion`; `sent`, and a new lead.

  Numbers used: `+61491570311`, `312`, `313` and SMS_FROM `399`, all in the 3xx sub-block. Teardown deletes the config rows by id first, then the suite's tenants.

## Verification

- `npm run typecheck`: pass. `npm run lint`: pass (0 warnings). Both were run at the end of every task.
- Pure suites, run locally from an explicit list: `text-back-gate`, `text-back-structure`, `lint-ban`, `lead-close-isolation`, `create-job-action`, `lead-job-structure`, `prospect-staging-retention` (journal monotonic `when` and idx-equals-position) and `lead-labels`. That is 8 files and **664 tests passing**.
- Journal: the last entry is idx 42, tag `0042_phase15_privacy_console`, `when` 1791878630443 > 1791619675151. A second `db:generate` reports no schema changes.
- `forAllTenants_*` export count: 16, unchanged.
- Must-not-move pins are byte-identical to the phase base `e7ee32b` (`git diff --quiet`). That covers the full objective list: sync-upsert, sync-cursor, sync-failure-alerts, quote-events, connect-servicem8, cron-schedules, report-unchanged, reporting-figures, lead-close, lead-job-match, text-back-template, inbound-stop, inbound-threading, every `cadence-*`/`attribution-*` suite, apply-cron-schedules.mjs, sync/transitions.ts, sync/eligibility.ts, attribution/qualify.ts, attribution/decide.ts, reporting/figures.ts, reporting/unchanged.ts, messaging/stop-keywords.ts, leads/close.ts, queue/page.tsx and queue/actions.ts. Task 3's extra files (job-provision.ts, job-description.ts) are identical as well.
- Not run, by rule: the three DB-backed suites above. `db:migrate` was not run, nothing was pushed, `test:remote` was not run, and no env file was named in any command.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in plan's count] `'parse_error'` in `tests/lead-job-create-db.test.ts` dropped by two, not one**
- **Found during:** Task 3
- **Issue:** The acceptance criterion asks for the count to be "one less than at the phase base" (base: 2). The WR-02 case asserts the borrowed kind twice: once on the returned result (`errorKind`) and once on the stored row (`sm8_job_error_kind`). After the code change both must flip, or CI fails.
- **Fix:** Both were flipped to `job_linked_elsewhere`, with one dated comment. The count is now 0. No other case moved.
- **Commit:** `7db357d`

**2. [Rule 3 - Blocking] The WR-02 source-pin anchor**
- **Found during:** Task 3
- **Issue:** The behaviour block bounds the region from the string `leads_sm8_job_created_uniq` to the next `await repo.leads.recordJobFailure`. In comment-stripped code that string first appears at the `JOB_CREATED_UNIQUE` const, so the region would span the claim path's own failure write rather than the WR-02 branch.
- **Fix:** The pin anchors on `isJobCreatedUniqueViolation(error)`, which is the branch itself, up to the next `recordJobFailure`. Its assertions are the planned ones: the region contains `'job_linked_elsewhere'`, and there is no `= 'parse_error'`.
- **Commit:** `7db357d`

**3. [Ordering] Migration statement order**
- The generator emitted the three bare DROPs before the ADD COLUMNs. The hand-finish puts the ADD COLUMNs first and pairs each DROP IF EXISTS with its ADD. The end state and snapshot are the same, and the generator is clean afterwards.
- **Commit:** `8db2997`

### Additions
- Two extra pure suites were run beyond the plan's list because they read the journal or migrations: `prospect-staging-retention` (journal ordering) and `lead-labels`. Both are pure, and both pass.
- `tests/text-back-gate.test.ts` gained two pair cases (negative close beats conversion; conversion beats recent_text) in addition to the generated pairwise ones, plus closed/expired/open non-conversion cases.

## TDD Gate Compliance

Tasks 1 and 3 are `tdd="true"`. RED was observed before implementing in both: 10 failing tests in Task 1 and 3 failing in Task 3. The plan specifies one commit per task, so there is no separate `test(...)` commit; each task's single `feat(15-01)` commit carries both the test and the implementation. Task 2 is not TDD.

## Hazards for 15-02 / 15-03 and the 15-04 tracer CI run (out of scope here, not fixed)

1. **First execution of 0042 is CI.** The DROP IF EXISTS + ADD pairs, the ADD COLUMN ordering and the regex CHECK were reasoned through, not executed. The 15-04 tracer is the first database built through idx 42. Expect migrate to report "Journal entries recorded: 43".
2. **`pg_get_constraintdef` rendering.** Postgres deparses as `((pseudonymised_at IS NOT NULL) AND (contact_mobile ~ '^[0-9a-f]{64}$'::text))`. The rls-coverage assertions are substring `toContain`s: `pseudonymised_at IS NOT NULL`, `[0-9a-f]{64}`, `^[+]614[0-9]{8}$` and `'recent_conversion'` (rendered `'recent_conversion'::text`). These should match, but have not been run.
3. **rls-coverage asserts EXACTLY three tables carry `pseudonymised_at`.** This matches the prohibition on a fourth stamp. A later plan that adds one, which it must not, fails here.
4. **`text-back-recent-conversion` seeds a converted lead** with `sm8_job_state 'created'`, a random `sm8_job_uuid` and `sm8_job_created_at`. That has to satisfy `leads_converted_reason`, `leads_closed_iff_reason`, `leads_sm8_job_created_has_uuid` and `leads_sm8_job_created_uniq`. The constraints were read, not run. The 25 h case depends on the arbiter admitting a new open lead beside a converted one (0041 header).
5. **15-02 / any missed-call-log label map** keyed on skip reasons must carry `recent_conversion` (a client-reachable leaf must use string-literal keys; research Pitfall 9). Any map keyed on `LEAD_JOB_ERROR_KINDS` needs `job_linked_elsewhere`. `CREATE_JOB_SENTENCES` is the only one that exists today.
6. **15-03's pin** `PSEUDONYMISE_AFTER_DAYS >= LEAD_NEGATIVE_COOL_OFF_DAYS` has its definition in place. The identity is by definition, so the pin will hold.
7. **15-07's pass** must write the hash and `pseudonymised_at` in the SAME UPDATE on `leads`. Otherwise the CHECK refuses the row with 23514, which is research Pitfall 2. A hash written before its stamp fails.
8. **Production apply (15-08) is 43 entries.** The pre-flight still expects `leads_total=0`, zero missed calls with a lead and zero inbound rows with a lead.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model. No new endpoint, auth path or file access. The schema change at the trust boundary is T-15-04/T-15-06, mitigated as planned.

## Self-Check: PASSED

All three created files exist; commits 6ee653f, 8db2997 and 7db357d are in the log; the SUMMARY carries no caller number or hash outside the fiction 3xx sub-block.
