---
phase: 14-servicem8-job-creation-lead-resolution
plan: 01
subsystem: database / leads / ServiceM8 write path / repository
status: complete
tags: [migration-0041, leads, sm8-write, job-linkage, sync-source-lead, d-04, d-05, d-07, d-10, d-11, d-13]
requires:
  - Phase 13 migration 0040 (leads.closed_reason/closed_at, leads_closed_reason_known, leads_closed_iff_reason, escalations.lead_id)
  - Phase 2 ServiceM8 read client (src/core/servicem8/client.ts, types.ts, schemas.ts)
  - 14-RESEARCH spike ledger (measured write semantics, 10 Oct 2026)
provides:
  - Migration 0041 (one journal entry, idx 41, when 1791619675151; written NOT applied, NOT pushed)
  - Lead constants LEAD_JOB_MATCH_WINDOW_DAYS=14, DONE_LOOKBACK_HOURS=48, LEAD_JOB_MATCH_COMPANY_READS_PER_CYCLE=10
  - Vocabularies LEAD_CLOSED_REASONS (+booked_by_tradie, job_created, closed_by_tradie), LEAD_CONVERSION_REASONS, LEAD_JOB_STATES, LEAD_JOB_ERROR_KINDS, SYNC_SOURCES (+lead)
  - forTenant() leads/quotes/quoteContacts methods for 14-02/14-03/14-04 (declared once)
  - Sticky sync_source 'lead' in the quotes upsert; three-way leads.close
  - Sm8WriteClient (post/getOne), Sm8WriteFailureKind, writes.ts wrappers with read-back, request/read schemas, mobile-spellings, createSm8Stub
affects:
  - 14-02 (tracer: create-job pipeline consumes claimJobCreation/setJobLinkage/recordJobCreated/recordJobFailure/jobSheetFacts/jobLinkageFor, the writes.ts wrappers, mobileSpellings and createSm8Stub; CI proves 0041 on a fresh database)
  - 14-03 (job-match consumes listOpenForJobMatch, setMatchedJob, quotes.listActiveByDateRange, quoteContacts.forJobs, linkedToJob, LEAD_JOB_MATCH_* constants)
  - 14-04 (DONE door consumes DONE_LOOKBACK_HOURS and escalations_lead_to_address_sent_idx; digest lines read sm8_job_created_at / closed_reason)
  - 14-05 (production apply of 0041 under the push protocol)
tech-stack:
  added: []
  patterns:
    - "Sibling write interface (Sm8WriteClient extends Sm8Client) so read fakes and the sync failure policy stay byte-identical"
    - "Create = validate (strict zod) -> POST -> x-record-uuid -> getOne -> loose zod -> verify; anything else is readback_mismatch"
    - "Guarded UPDATE claim (sm8_job_state IN ('none','failed')) as the double-tap arbiter"
    - "Hand-written CHECK re-pinned in the schema file and widened as DROP IF EXISTS + ADD (0008/0040 idiom)"
key-files:
  created:
    - src/db/migrations/0041_phase14_job_creation.sql
    - src/db/migrations/meta/0041_snapshot.json
    - src/core/servicem8/writes.ts
    - src/core/leads/mobile-spellings.ts
    - tests/helpers/sm8-stub.ts
    - tests/sm8-client-write.test.ts
    - tests/mobile-spellings.test.ts
  modified:
    - src/core/leads/constants.ts
    - src/core/leads/gate.ts (comment only)
    - src/db/schema/{leads,quotes,escalations}.ts
    - src/db/migrations/meta/_journal.json
    - src/db/repository/for-tenant.ts
    - src/db/repository/index.ts
    - src/core/servicem8/{types,client,schemas}.ts
    - tests/sm8-schemas.test.ts
    - tests/rls-coverage.test.ts
    - docs/servicem8-api-notes.md
    - docs/external-registrations.md
decisions:
  - "The repository's jobStateFor row type is named LeadJobStateFacts (not LeadJobState as the plan's type list said), because the schema barrel already exports LeadJobState as the LEAD_JOB_STATES union and for-tenant.ts imports from it"
  - "createSm8Client now returns Sm8WriteClient; Sm8Client, Sm8FailureKind and Sm8Result are unchanged, so every structural fake and the sync failure policy compile untouched"
  - "A failed or mismatching read-back (any getOne failure kind, unparseable record, inactive, uuid differs, job status not Quote, parent uuid differs) is readback_mismatch, per D-03 literally"
  - "Bounded list reads take ONE page; a page of >= BOUNDED_LIST_MAX_ROWS (500) rows is parse_error 'unexpected second page' (no paging signal exists to detect a literal second page)"
  - "companyCandidatesByMobileTail returns the CONTACT's sm8Active; a non-3-digit tail returns [] without a query"
  - "The stub records single reads as method GET_ONE (with uuid) and is itself an Sm8WriteClient, also exposed as .client, so it can be passed to a clientFactory directly"
metrics:
  duration: "~23 min"
  completed: 2026-10-10
  tasks: 3
  files: 21
estimate:
  tokens: 90000
  tasks: 3
actuals:
  tokens: 68000
  tasks: 3
  commits: 4
requirements-completed: []
requirements-advanced: [SM8-01, SM8-02, SM8-03, LEAD-04]  # foundations only; none is satisfied until 14-02..14-05 (not marked complete in REQUIREMENTS.md)
---

# Phase 14 Plan 01: Migration 0041, the lead job linkage, the repository surface and the ServiceM8 write path Summary

Phase 14's whole schema now sits in one hand-finished journal entry, `0041_phase14_job_creation` (idx 41, `when` 1791619675151, ahead of 0040's 1791444299489). It is generated and written, and it is **not applied anywhere and not pushed**. The entry adds the lead's ServiceM8 job linkage: ten columns, all nullable or defaulted. It adds the `none → creating → created | failed` creation-state machine with six CHECKs and the `leads_sm8_job_created_uniq` arbiter. The closed-reason vocabulary gains three reasons, and `converted` now carries one of two conversion reasons. `quotes_sync_source_known` gains `lead` (hand-written as DROP IF EXISTS + ADD). The DONE read gets its index.

Every repository method the expansion plans need now exists once on `forTenant()`. That covers the guarded claim, the per-step linkage persist, the created/failed records, the sheet and row reads, and the match reads. Each predicate carries the tenant, and no `forAllTenants_*` export was added (still 16). The quotes upsert keeps `sync_source = 'lead'` sticky, and `leads.close` maps reasons to statuses three ways.

The ServiceM8 write path also exists now. `Sm8WriteClient` is a sibling of the unchanged read interface. `post()` reads `x-record-uuid`; `getOne()` validates the uuid before it goes into the path. Strict request schemas and loose read schemas match the spike's measurements. Each of the four create wrappers reads its record back before returning. `createSm8Stub` is an in-memory ServiceM8 that answers with the measured shapes. No test or task made a ServiceM8 request.

## Tasks

| # | Task | Commit | Key files |
|---|------|--------|-----------|
| 1 | Migration 0041, job linkage, converted reasons, lead sync source (not applied) | `852ce09` | constants.ts, schema/{leads,quotes,escalations}.ts, 0041 + snapshot + journal, gate.ts (comment), rls-coverage.test.ts |
| 2 | Repository surface: claim, linkage writes, sheet/row/match reads, sticky source, three-way close | `bbf498d` | repository/for-tenant.ts, repository/index.ts |
| 3 RED | Failing suites for the write path, schemas, spellings | `3330079` | sm8-client-write.test.ts, sm8-schemas.test.ts, mobile-spellings.test.ts |
| 3 GREEN | Write path: post/getOne, wrappers with read-back, schemas, spellings, stub, docs | `0aeefb7` | servicem8/{types,client,schemas,writes}.ts, leads/mobile-spellings.ts, helpers/sm8-stub.ts, docs ×2 |

## Exported names added (for 14-02 / 14-03 / 14-04 to cite)

**`src/core/leads/constants.ts`**: `LEAD_JOB_MATCH_WINDOW_DAYS` (14), `DONE_LOOKBACK_HOURS` (48), `LEAD_JOB_MATCH_COMPANY_READS_PER_CYCLE` (10). The module still has no imports.

**`src/db/schema/leads.ts`**: `LEAD_CLOSED_REASONS` (+`booked_by_tradie`, `job_created`, `closed_by_tradie`), `LEAD_CONVERSION_REASONS` / `LeadConversionReason`, `LEAD_JOB_STATES` / `LeadJobState`, `LEAD_JOB_ERROR_KINDS` / `LeadJobErrorKind`. Columns: `sm8JobState`, `sm8CompanyUuid`, `sm8JobUuid`, `sm8JobContactUuid`, `sm8JobErrorKind`, `sm8JobAttemptCount`, `sm8JobAttemptedAt`, `sm8JobCreatedAt`, `sm8JobCreatedBy`, `sm8JobDescriptionSha256`.

**`src/db/schema/quotes.ts`**: `SYNC_SOURCES` (+`lead`); `check('quotes_sync_source_known')` now in the schema file.

**`src/db/schema/escalations.ts`**: index `escalations_lead_to_address_sent_idx`.

**`forTenant().leads`**: `claimJobCreation(leadId, at)`, `jobStateFor(leadId)`, `setJobLinkage(leadId, patch)`, `recordJobCreated(leadId, {jobUuid, contactUuid, createdBy, at})`, `recordJobFailure(leadId, kind, at)`, `jobLinkageFor(leadIds)`, `jobSheetFacts(leadId)` (returns `null` when the lead does not exist), `linkedToJob(sm8JobUuid)`, `listOpenForJobMatch()`, `setMatchedJob(leadId, jobUuid, at)`.

**`forTenant().quotes`**: `listActiveByDateRange(fromYmd, toYmd)`.

**`forTenant().quoteContacts`**: `forJobs(sm8JobUuids)`, `companyCandidatesByMobileTail(tail)`.

**Repository types** (re-exported as `type` from `@/db/repository`): `LeadJobClaim`, `LeadJobStateFacts`, `LeadJobLinkagePatch`, `LeadJobLinkage`, `LeadJobSheetFacts`, `LeadJobMatchCandidate`, `LeadLinkedToJob`, `ActiveJobInRange`, `JobContactMobile`, `CompanyCandidate`. No value export was added to the barrel.

**`src/core/servicem8/types.ts`**: `Sm8WriteFailureKind`, `Sm8WriteResult<T>`, `Sm8WriteClient` (`get` + `getOne` + `post`).

**`src/core/servicem8/client.ts`**: `createSm8Client(auth): Sm8WriteClient`; internal `classifyWrite`, `post`, `getOne`.

**`src/core/servicem8/schemas.ts`**: `sm8Company`, `sm8CompanyContact`, `sm8JobCreate`, `sm8JobContactCreate`, `sm8CompanyCreate`, `sm8CompanyContactCreate`, `sm8WriteResult`, and the inferred types `Sm8Company`, `Sm8CompanyContact`, `Sm8JobCreate`, `Sm8JobContactCreate`, `Sm8CompanyCreate`, `Sm8CompanyContactCreate`, `Sm8WriteEnvelope`.

**`src/core/servicem8/writes.ts`**: `WriteOutcome<T>`, `BOUNDED_LIST_MAX_ROWS` (500), `createCompany`, `createCompanyContact`, `createJob`, `createJobContact`, `getJob`, `getJobContact`, `getCompany`, `listJobContactsForJob`, `findCompanyContactsByMobile`, `listOpenQuoteJobsForCompany`.

**`src/core/leads/mobile-spellings.ts`**: `toLocalSpacedMobile`, `mobileSpellings` (returns `[spaced, compact, e164]`), `mobileTail`.

**`tests/helpers/sm8-stub.ts`**: `createSm8Stub(seed?)` → `Sm8Stub` (itself an `Sm8WriteClient`, plus `.client`, `calls`, `failNext(resource, status)`, `omitHeaderNext()`, `coerceNextJobStatus(status)`, `setJobStatus(uuid, status)`, `rows(resource)`); `Sm8StubCall`, `Sm8StubSeed`.

## db:generate outputs

The first `npm run db:generate` produced `0041_massive_dracula.sql` with `when` 1791619675151 (> 1791444299489, so no re-stamp was needed). It generated **no** statement touching any cadences object. It emitted bare `DROP CONSTRAINT` for `leads_closed_reason_known` and `leads_closed_iff_reason`, and a bare `ADD` for `quotes_sync_source_known`. After the rename to `0041_phase14_job_creation` and the hand-finish, the second `npm run db:generate` printed "No schema changes, nothing to migrate".

## Migration 0041: hand-finish

- The bare DROPs of `leads_closed_reason_known` and `leads_closed_iff_reason` became `DROP CONSTRAINT IF EXISTS`.
- `ALTER TABLE "quotes" DROP CONSTRAINT IF EXISTS "quotes_sync_source_known"` was inserted before the generated ADD (0008 idiom; research Pitfall 8).
- A header in 0040's style: ONE ENTRY FOR THE PHASE / NO OTHER PLAN TOUCHES THE JOURNAL, `when` checked, SAFE TO MEET PHASE 13 CODE (it says explicitly that the rewritten `leads_closed_iff_reason` admits every row the old one did), a pre-flight expectation (production `leads_total=0`; `sync_source` only backfill/poll), the unchanged arbiters with Pitfall 7, and a note that the spike rows are untouched.
- Greps: CREATE TABLE 0, GRANT 0, data statements 0, `cadences` 0, DROP CONSTRAINT IF EXISTS 4.

## Files `tsc` forced

None. Widening `LEAD_CLOSED_REASONS` and `SYNC_SOURCES` forced no switch arm or `Record` entry anywhere.

## Verification

- `npm run typecheck`: pass. `npm run lint`: pass (0 warnings). Both were run at the end of each task.
- Pure suites run locally from an explicit file list: `tests/sm8-client-write.test.ts`, `tests/sm8-schemas.test.ts`, `tests/mobile-spellings.test.ts`, `tests/lint-ban.test.ts`, `tests/text-back-gate.test.ts`, `tests/text-back-structure.test.ts`, `tests/lead-close-isolation.test.ts` — 7 files, 489 tests passing.
- `npm run db:generate` prints "No schema changes". The journal's last entry is idx 41, tag `0041_phase14_job_creation`, `when` 1791619675151.
- `forAllTenants_*` export count: 16, unchanged.
- The must-not-move pins are byte-identical to the phase base `bd8beb3` (`git diff --quiet`): sync-upsert, sync-cursor, sync-failure-alerts, sync-health, sync-tick-budget, sync-tick-route, quote-events, connect-servicem8, cron-schedules, report-metrics, inbound-stop, inbound-threading, lead-close, lead-label-effects, lead-digest-section, every cadence-*/attribution-*/escalation-* suite, apply-cron-schedules.mjs, sync/transitions.ts, sync/eligibility.ts, messaging/stop-keywords.ts, leads/close.ts. Task 3's list (baseline-winrate, pagination-cap, resume-write-guard, run-sync.ts, failure-policy.ts, outcomes.ts) is also identical.
- The docs diff contains no `+61`, no 64-hex string and no `X-API-Key:` value.
- Not run, by rule: `tests/rls-coverage.test.ts` is DB-backed and runs in CI only. It compiles here, and the 14-02 tracer CI runs it on a fresh database built from the journal including 0041. `db:migrate` was not run, nothing was pushed, `test:remote` was not run, and no ServiceM8 request was made (every fetch was stubbed or went to `createSm8Stub`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `String(e)` appeared in existing client.ts comments**
- **Found during:** Task 3
- **Issue:** The plan's verify asserts `grep -c 'String(e)' client.ts == 0`, but two existing comments in the header and the `get()` catch contained the literal text `String(e)`.
- **Fix:** Reworded both comments to "the caught value stringified" / "never the stringified error". No code behaviour changed, and `get()` is otherwise untouched.
- **Commit:** `0aeefb7`

**2. [Rule 3 - Blocking] Header prose tripped two acceptance greps**
- **Found during:** Tasks 1 and 3
- **Issue:** The 0041 header's mention of the hand-written cadences object names broke `grep -c cadences == 0`. The stub header's "imports nothing from tests/helpers/env" broke `grep -c "import.*helpers/env" == 0`.
- **Fix:** Reworded both: "the cadence table's one-live-per-lead partial unique" and "depends on neither the env helper nor the seed helper". The meaning is unchanged.
- **Commits:** `852ce09`, `0aeefb7`

**3. [Naming] Repository row type `LeadJobStateFacts` instead of `LeadJobState`**
- **Found during:** Task 2
- **Issue:** The schema barrel exports `LeadJobState` as the `LEAD_JOB_STATES` union, and `for-tenant.ts` imports from that barrel, so a same-named interface would shadow it.
- **Fix:** Named the `jobStateFor` row type `LeadJobStateFacts`. No later plan text cites the repository name.
- **Commit:** `bbf498d`

**4. [Interpretation] "a second page" on a bounded list**
- **Found during:** Task 3
- **Issue:** ServiceM8 advertises no paging signal (pagination.ts; spike A2), so a single `get` cannot see a literal second page.
- **Fix:** One unpaged `get`. A page of 500 or more rows (`BOUNDED_LIST_MAX_ROWS`) is `parse_error` with detail `unexpected second page from <resource>`.
- **Commit:** `0aeefb7`

**5. [Addition] `getOne(` visible at every create; one extra stub control**
- Each create wrapper passes its own `(uuid) => client.getOne('<resource>.json', uuid)` into the shared `createAndReadBack`, so the read-back is visible at each create (5 `getOne(` sites).
- The stub gained `coerceNextJobStatus(status)` so the "read-back status is not Quote" path is testable. Single reads are recorded as `method: 'GET_ONE'` with `uuid`.
- `tests/sm8-client-write.test.ts` also exercises the wrappers against the stub: the four-create chain, no-header, coerced status, a 400 creating nothing, no-dedupe, exact-spelling short-circuit, filter refusal, and adopt reads.

### Not needed
- `tests/text-back-gate.test.ts` stayed green with no pin moved; it does not pin the reason count.
- `tests/lint-ban.test.ts` needed no edit. Its barrel pin is `Object.keys` of the runtime module, so type exports do not count, and no value export was added.

## TDD Gate Compliance

Task 3 (`tdd="true"`): RED `3330079` (`test(14-01): …`) — 3 suites failed with 6 failing tests and unresolved modules — then GREEN `0aeefb7` (`feat(14-01): …`) — 65 tests in the three suites passing. No refactor commit was needed. HEAD `3330079` did not typecheck, by design of the RED gate; `0aeefb7` does.

## Hazards for 14-02's tracer CI run (out of scope here, not fixed)

1. **rls-coverage index regex.** `pg_indexes.indexdef` renders the predicate as `WHERE (sm8_job_state = 'created'::text)`. The new assertion `toMatch(/sm8_job_state = 'created'/)` matches that as a substring, and `/\(tenant_id, sm8_job_uuid\)/` matches `USING btree (tenant_id, sm8_job_uuid)`. Both were reasoned, not run, so this is the first place CI could disagree.
2. **`leads_closed_iff_reason` definition text.** The assertion `toContain("'converted'")` relies on `pg_get_constraintdef` keeping the literal (Postgres renders `'converted'::text`), so the substring matches. Same for `'lead'` in `quotes_sync_source_known` and the three reasons in `leads_closed_reason_known`.
3. **The upsert CASE is new SQL on the hot sync path.** `CASE WHEN "quotes"."sync_source" = 'lead' THEN 'lead' ELSE excluded.sync_source END` inside `ON CONFLICT DO UPDATE` was typechecked but never executed. A DB-backed sync suite (sync-upsert, byte-identical) exercises it in CI, and that is the first real execution.
4. **None of the new repository methods has run against Postgres.** In particular, `jobLinkageFor`'s LEFT JOIN on two uuid columns, `listActiveByDateRange`'s `substr(... ) BETWEEN $1 AND $2` (text params), and `companyCandidatesByMobileTail`'s `LIKE '%' || $1` with `ORDER BY quotes.date_raw DESC NULLS LAST`. 14-02's `lead-job-create-db.test.ts` is their first execution.
5. **`BOUNDED_LIST_MAX_ROWS = 500`.** Suppose the caller matches a property-manager-style client with 500 or more open Quote jobs. The adopt-before-create read then returns `parse_error`, and creation fails for that company every time. That is very unlikely at v1.2 volume, and if it happens it shows as a `parse_error` kind on the sheet.
6. **The stub mirrors ServiceM8, not Postgres.** It enforces referents (#12/#14) and exact-spelling filters. Its `$filter` parser accepts only the `field eq 'x'` / `field eq 1` subset joined by ` and `, and throws on anything else. A 14-02 filter outside that subset will throw in the test, which is the intended loud failure.

## Known Stubs

None. Every added method and wrapper is wired to a real data source. `tests/helpers/sm8-stub.ts` is a deliberate test double, not a product stub.

## Threat Flags

None beyond the plan's threat model. The new outbound surface (`post`, `getOne` to api.servicem8.com) and the `$filter` inputs are T-14-03/T-14-04/T-14-08/T-14-14, all mitigated as planned. `jobSheetFacts` is a new body-returning read, and its two permitted callers are documented on the interface and in the `latestForLead` comment.

## Self-Check: PASSED

All seven created files exist; commits 852ce09, bbf498d, 3330079 and 0aeefb7 are in the log.
