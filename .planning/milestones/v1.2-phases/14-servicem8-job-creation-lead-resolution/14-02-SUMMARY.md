---
phase: 14-servicem8-job-creation-lead-resolution
plan: 02
subsystem: leads / ServiceM8 write path / inbox console
status: complete
tags: [tracer, sm8-01, sm8-02, sm8-03, d-01, d-04, d-05, d-06, d-09, d-13, exactly-once, adopt-before-create]
requires:
  - 14-01 (migration 0041 written; forTenant().leads claim/linkage/sheet reads; writes.ts wrappers; mobile-spellings; createSm8Stub)
provides:
  - createJobForLead (src/core/leads/create-job.ts) — facts and refusals, the DB claim, ServiceM8 outside any tx, failure record, one unit of work
  - provisionLeadJob (src/core/leads/job-provision.ts) — company/job/contact pipeline with adopt-before-create and the SHA-256 adopt key
  - buildJobDescription / composeJobDescription / previewLinesFor / urgencyLineFor / noteLineFor / JOB_NOTE_PREFIX (client-safe)
  - createJobForLeadAction ('use server', one export) + CreateJobForm (arm-then-confirm sheet) + CREATE_JOB_SENTENCES leaf
  - Inbox row chips for D-09 (job uuid/status, job created / booked by tradie / closed by tradie, creating job… / job failed)
  - The DB-backed tracer proof (tests/lead-job-create-db.test.ts), green in CI on a fresh database including 0041
affects:
  - 14-03 (the sync match must leave failed/creating leads alone; run-sync must not import create-job — create-job imports normalizeContact from run-sync)
  - 14-04 (DONE door; digest lines read sm8_job_created_at / closed_reason written here)
  - 14-05 (production apply of 0041 — this plan proved it on a fresh CI database only)
tech-stack:
  added: []
  patterns:
    - "Digest-before-POST: the job description's SHA-256 is persisted before the job POST, so an orphan from a crashed attempt is adopted by that digest, never by a re-composed string"
    - "List-before-create only where something can exist: no digest persisted means no job POST was ever made; a job created this attempt has no contacts (ledger #8)"
    - "Preview and write share one pure composer over server-built lines; the action re-reads the facts and refuses thread_changed"
key-files:
  created:
    - src/core/leads/job-description.ts
    - src/core/leads/job-provision.ts
    - src/core/leads/create-job.ts
    - src/app/(console)/inbox/create-job-actions.ts
    - src/app/(console)/inbox/create-job-form.tsx
    - tests/lead-job-description.test.ts
    - tests/lead-job-create.test.ts
    - tests/create-job-action.test.ts
    - tests/lead-job-structure.test.ts
    - tests/lead-job-create-db.test.ts
  modified:
    - src/app/(console)/inbox/action-state.ts
    - src/app/(console)/inbox/page.tsx
    - tests/lint-ban.test.ts
    - tests/operator-authorization.test.ts
decisions:
  - "The note date is formatted with @date-fns/tz TZDate (the repo's timezone library); date-fns-tz is not a dependency. Still one import, still client-safe"
  - "Adopt-by-digest runs only when a digest is persisted, and the contact list only for an adopted job — each skip follows from an invariant, not a shortcut"
  - "An unexpected throw during provisioning (a DB persist) is recorded readback_mismatch, so a lead is never left in creating by an in-process error"
  - "unknown urgency is not a label: the newest reply with a real urgency sets the urgency line"
  - "The mirror and filter tiers verify the company is active with getCompany before adopting it; the mirror tier matches mobile or phone"
metrics:
  duration: "~62 min"
  completed: 2026-10-10
  tasks: 3
  files: 14
estimate:
  tokens: 98000
  tasks: 3
actuals:
  tokens: 25500
  tasks: 3
  commits: 4
requirements-completed: []
requirements-advanced: [SM8-01, SM8-02, SM8-03]  # proven on a fresh CI database; not live until 14-05 applies 0041 to production (not marked complete in REQUIREMENTS.md)
---

# Phase 14 Plan 02: The job-creation tracer Summary

One operator tap now creates one ServiceM8 Quote job, for a matched or created client, with one JOB contact carrying the caller's mobile. Every record is read back. The job goes into the quotes mirror as `needs_review` / `lead`, and the lead becomes `converted` / `job_created` with its cadence stopped. That all happens in one transaction, exactly once, and the next sync cycle emits nothing for the job.

This was proven on a database built fresh from the journal, including 0041. CI run **38038751432** at `b3dbf62` passed on attempt 2: 186/186 test files, 5,984 tests passed, 29 skipped. Nothing was applied to production, `main` was not pushed, and no request reached api.servicem8.com.

## Tasks

| # | Task | Commit | Key files |
|---|------|--------|-----------|
| 1 | Tracer: description builder, ServiceM8 pipeline, core with claim and unit of work, action, sheet, inbox row | `eb15027` | job-description.ts, job-provision.ts, create-job.ts, create-job-actions.ts, create-job-form.tsx, action-state.ts, page.tsx |
| 2 (tests) | Reconciliation cases, action order and sentence key set, structural pins | `ed1ad12` | lead-job-create, create-job-action, lead-job-structure, lint-ban, operator-authorization |
| 2 (impl) | The row's chips (D-09) | `ecd953c` | page.tsx |
| 3 | DB-backed proof of the tracer | `b3dbf62` | tests/lead-job-create-db.test.ts |

## Result kinds and their sentences (`CREATE_JOB_SENTENCES`)

| Key | Sentence |
|-----|----------|
| `created` (the one success) | ServiceM8 job created and read back. The lead is now converted. |
| `already_in_progress` | A job is already being created for this lead. Refresh in a moment. |
| `already_created` | A ServiceM8 job already exists for this lead. |
| `not_open` | This lead is no longer open. |
| `no_reply` | This lead has no reply yet, so there is nothing to put in a job. |
| `thread_changed` | The thread changed — review the preview again. |
| `not_connected` | This client has no ServiceM8 connection. |
| `connection_paused` | This client's ServiceM8 connection is paused. Fix the connection first. |
| `failed:auth_failed` | ServiceM8 rejected the client's API key. Nothing was created — re-key the connection and retry. |
| `failed:rate_limited` | ServiceM8 is busy. Retry in a minute. |
| `failed:server_error`, `failed:network_error` | Could not reach ServiceM8, or it returned an error. Retry — anything already created is reused, never duplicated. |
| `failed:parse_error` | ServiceM8 returned data in an unexpected shape. Retry; if it fails again this needs a developer. |
| `failed:bad_request` | ServiceM8 refused the request. Retry; if it fails again this needs a developer. |
| `failed:connection_paused` | This client's ServiceM8 connection is paused. Fix the connection first, then retry. |
| `failed:not_connected` | This client has no ServiceM8 connection. Connect it first, then retry. |
| `failed:readback_mismatch` | The job could not be verified after creation. Retry — an existing job is adopted, never duplicated. |

`CREATE_JOB_UNKNOWN_SENTENCE` is the fallback when the action catches a throw. `tests/create-job-action.test.ts` checks the key set against `LEAD_JOB_ERROR_KINDS`.

## Repository fixes

None. Every 14-01 method the tracer uses worked as declared: `claimJobCreation`, `jobStateFor`, `setJobLinkage`, `recordJobCreated`, `recordJobFailure`, `jobSheetFacts`, `jobLinkageFor`, `companyCandidatesByMobileTail` and the sticky `upsertManyReturning`. The CI run is their first execution against Postgres. `for-tenant.ts` and `tests/helpers/seed.ts` were not edited.

## CI on throwaway branch `ci/phase-14-tracer`

| Run | Commit | Result |
|-----|--------|--------|
| 38038751432 (attempt 1) | `b3dbf62164374f6f84496de26671d34e21017bd1` | failure in the **Build** step, before any test ran. `next/font/google` in the untouched `src/app/(marketing)/layout.tsx` could not fetch the Inter font from Google Fonts. This was an infrastructure fetch failure: no file in this plan's diff touches the marketing layout, `next.config.ts` or the lockfile, `main` was green 40 minutes earlier, and the local `next build` passed. |
| **38038751432 (attempt 2, re-run, same SHA)** | **`b3dbf62164374f6f84496de26671d34e21017bd1`** | **success: 186/186 files, 5,984 passed, 29 skipped. The migrate step recorded "Journal entries recorded: 42".** |

No fix-forward commits were needed. The branch was deleted after the green run (`git ls-remote --heads origin ci/phase-14-tracer` prints nothing), and `git log origin/main..HEAD` still lists this plan's commits, so `main` was not pushed.

Suites named by the acceptance criteria, all passing in the green run:

| Suite | Tests |
|-------|-------|
| lead-job-create-db (new) | 11 |
| rls-coverage (0041's CHECKs and the partial unique, first execution of 14-01's regexes) | 28 |
| sync-upsert (the sticky `lead` CASE on the hot path) | 18 |
| quote-events | 8 |
| connect-servicem8 | 16 (12 skipped, live key absent by design) |
| lead-close | 27 |
| cadence-tick | 9 |
| attribution-consume | 11 |
| report-metrics | 17 |
| cron-schedules | 29 |

## Verification

- Pure suites, run locally from an explicit list: lead-job-description (8), lead-job-create (13), create-job-action, lead-job-structure, lint-ban, operator-authorization, inbox-authorization, console-error-leak, sm8-client-write and lead-close-isolation. All green; Task 2's run was 374 tests across 8 files.
- `npm run typecheck`, `npm run lint` (0 warnings) and `npx next build` all pass locally after each task.
- Comparing against the phase base `bd8beb3`, these are byte-identical (`git diff --quiet`): sync-upsert, quote-events, connect-servicem8, cron-schedules, report-metrics, inbound-stop, inbound-threading, close.ts, run-sync.ts, transitions.ts, eligibility.ts.
- Greps: `closeLeadInTx(tx, leadId, 'job_created'` appears 1 time and `closeLead(` 0 times in create-job.ts; `.transaction(` appears 1 time; `events.insertMany|classifyTransition|markChaseEligible` appears 0 times in both core files. `forAllTenants_*` is unchanged at 16, because no repository file was touched.
- Mutation check on the reconciliation tests: each of four branches was disabled in turn (adopt-by-digest, contact adopt, persisted-company adopt, mirror tier), and each mutation failed at least one case.
- Never run: `test:remote`, `db:migrate`, any DB suite locally, any live ServiceM8 request.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `date-fns-tz` is not a dependency**
- **Found during:** Task 1
- **Issue:** The plan says `job-description.ts` "imports only `date-fns-tz`" and uses `formatInTimeZone`. The repo uses `@date-fns/tz` with date-fns v4 instead (see `src/core/reporting/period.ts`).
- **Fix:** `new TZDate(ms, timezone)` getters plus a fixed month table produce "10 Oct 2026". It is deterministic, with no ICU variance between server and browser, and the module still has exactly one import.
- **Commit:** `eb15027`

**2. [Rule 1 - Correctness] Never leave a lead in `creating` after an in-process throw**
- **Found during:** Task 1
- **Issue:** The claim only moves a lead out of `none` or `failed`. If a `setJobLinkage` persist threw mid-pipeline, the lead would stay `creating` with no retry path.
- **Fix:** A throw from provisioning is caught once and recorded as `readback_mismatch`, the "state unknown, the retry adopts" kind. The caught value is not logged.
- **Commit:** `eb15027`

**3. [Interpretation] Each list-before-create read runs only when it can find something**
- Adopt-by-digest lists open quotes only when a digest is persisted. The digest is written before every job POST, so without one no job was ever POSTed for this lead.
- A job created in this attempt skips the contact list, because ServiceM8 auto-creates no contacts (ledger #8).
- This also makes `stub.failNext('job.json' | 'jobcontact.json')` hit the POST, which is what the behaviour block expects. The prohibition "MUST NOT POST … without first looking" still holds for every case where something could exist.

**4. [Interpretation] Company tiers verify before adopting**
- The mirror tier matches when either `mobile` or `phone` normalises to the caller's number. That is a superset of `mobile ?? phone`.
- The filter tier verifies each found company with `getCompany` (active) before adopting it, the same check the mirror tier makes.
- A persisted company that reads back inactive or missing falls through to the tiers. A transport failure stops the pipeline with its kind.

**5. [Interpretation] `unknown` urgency is not a label**
- When the newest labelled reply is chosen for the urgency line, `unknown` is skipped. A closing "ok thanks" therefore does not erase an earlier emergency.

**6. [Addition] Two sentences and a fallback**
- The plan listed sentences for most `failed:<kind>` keys. `failed:connection_paused` and `failed:not_connected` (members of `LEAD_JOB_ERROR_KINDS`) now have sentences too, and `CREATE_JOB_UNKNOWN_SENTENCE` covers a caught throw. `CreateJobResult`'s `already_created` carries `jobUuid: string | null`.

**7. [Rule 3 - Blocking] An existing comment tripped `grep -c "\.replace('_'" page.tsx == 0`**
- The page's original "A map, not a `.replace('_', ' ')`" comment, and the new map's comment, now say "an underscore-to-space string replace". The meaning is unchanged, and no test pins that text.
- **Commit:** `ecd953c`

**8. [Process] Tracer feedback gate**
- Auto mode was off (`auto_advance` and `_auto_chain_active` both false), which would normally mean an interactive tracer checkpoint. The plan is `autonomous: true`, though, and the orchestrator asked for the whole plan.
- The tracer's `<verify>` was re-run green end to end before expansion. The integration gate the plan names is the CI DB proof, and that is green.

**9. [CI] Attempt 1 failed in Build on a Google Fonts fetch; re-run green with no code change**
- The cause is outside this plan's scope and has no code fix: the network fetch made by `next/font/google` in the marketing layout. No check was weakened and no suite was skipped.

## TDD Gate Compliance

Task 2 is `tdd="true"`. Task 1, being the tracer, had already implemented every reconciliation branch on the happy path, so the behaviour-block cases passed when they were first run. Per the fail-fast rule this was investigated rather than skipped past: four source mutations, one per branch, each turned at least one case red, which confirms the tests test the branches. The commit order is `test(14-02)` (`ed1ad12`) and then `feat(14-02)` (`ecd953c`, the chips). Like 13-02's Task 2, this is a proof written after the code, not a literal RED→GREEN cycle.

## Hazards for 14-03 / 14-04

1. **A `failed` lead's orphan job reaches the mirror through the sync.** In case (b), the job is created and the contact POST fails, so the job exists in ServiceM8 but was never pre-inserted. The next poll sees it for the first time as `poll` and emits `quote_opened`, the exact mechanism SM8-02 defends against. The retry's pre-insert then flips `sync_source` to `lead` (the CASE keeps only an existing `lead`), but the event already exists. 14-03, or a follow-up, should decide whether the sync skips a job uuid that a `creating`/`failed` lead has persisted. `listOpenForJobMatch` already reads `none` only, so the tradie-booked match cannot close such a lead.
2. **A lead stuck in `creating`** (the function was killed mid-pipeline, e.g. by a Vercel timeout) cannot be reclaimed. The claim admits only `none`/`failed`, and the row shows "creating job…" with no control. A stale-`creating` reclaim (by `sm8_job_attempted_at` age) is not in any plan yet.
3. **Import direction:** `create-job.ts` imports `normalizeContact` from `run-sync.ts` (checker I6). 14-03's post-commit hook in `run-sync.ts` must not import `create-job.ts`, or the two modules form a cycle.
4. **Description length:** `sm8JobCreate.job_description` is capped at 4,000 characters. A very long thread makes `createJob` return `bad_request` with no request made, and the operator sees "ServiceM8 refused the request". Rare at v1.2 volume, but the sentence is not exact for this case.
5. **The inbox page reads per lead:** one `jobSheetFacts` call per open, creatable lead on screen, bounded by the triage cap. A linkage-read failure hides only the create controls and logs a fixed sentence.
6. **CI Build depends on Google Fonts reachability** (`next/font/google` in the marketing layout). It is flaky by nature; a re-run is the remedy, not a code change.

## Known Stubs

None. `jobAddress` is deliberately `null`: D-01 requires that the sheet show exactly what is written, and the suburb goes into the description, which the sheet shows. `'(no name)'` in the sheet is a display fallback for an empty contact name, not a stub.

## Threat Flags

None beyond the plan's threat model. The new Server Action is T-14-01, mitigated and pinned by `tests/create-job-action.test.ts` and `GUARDED_PATHS`. The outbound writes are T-14-02/T-14-08/T-14-14, and the mirror pre-insert is T-14-07/T-14-13. All are mitigated and proven in CI.

## Self-Check: PASSED

All ten created files exist. Commits eb15027, ed1ad12, ecd953c and b3dbf62 are in the log. CI run 38038751432 shows `success` for `b3dbf62`, and the throwaway branch is gone.
