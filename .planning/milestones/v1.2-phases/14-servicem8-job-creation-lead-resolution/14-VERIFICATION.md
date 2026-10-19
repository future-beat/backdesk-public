---
phase: 14-servicem8-job-creation-lead-resolution
verified: 2026-10-11
uat: 14-UAT.md (founder, phone, 2026-10-11 — 3/3 pass, item 3 by assumption pending the next digest)T05:30:00Z
status: passed
score: 17/17 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification: false
ci:
  final_sha: cef29ba
  run_id: 38114051225
  conclusion: success (completed 2026-10-11T05:22:10Z; typecheck, lint, build, migrate "Journal entries recorded: 42", test suite 192/192 files passed)
  previous_green: 38111363682 on bc620eb (the SHA that applied 0041 and first deployed Phase 14)
deployment:
  vercel_production: Ready on cef29ba (backdesk-60nhp1itm, 38 s build)
  github_deployment: 6991273790 Production success (2026-10-11T05:13:18Z)
  migration_0041: applied (schema_0041_applied=true; 42 journal entries); file last edited at a1746fb, before the apply
human_verification:
  - test: "Open /inbox on the phone at production (app.backdesk.com.au) while production holds zero leads"
    expected: "No lead row, no 'Create ServiceM8 job' control, no job chip anywhere; the page renders exactly as before Phase 14"
    why_human: "Layout at phone width; production has no lead, so only the absence can be seen today"
  - test: "When the first real lead with a reply appears: read the row's control and sheet"
    expected: "Control reads 'Create ServiceM8 job' (or 'Retry ServiceM8 job' after a failure); the sheet shows the caller's verbatim replies, the suburb field, the urgency line, the note 'Created by Backdesk from a missed call on <d Mon yyyy at h:mm am/pm>', the job contact name and local mobile, the warning 'This writes into <client>'s ServiceM8.', the confirm button 'Yes — create the job in ServiceM8' and 'Cancel'"
    why_human: "Wording and layout at phone width; the pins check the strings, not how they read"
  - test: "After the first real job is created: read the row chips"
    expected: "'job created' with the job's generated id/status; after a tradie booking 'booked by tradie'; after a DONE 'closed by tradie'; 'creating job…' / 'job failed' only transiently"
    why_human: "Event-gated on the first client (12-09 override: nothing has run live against a customer)"
  - test: "The 06:30 digest the morning after the first resolution"
    expected: "A Leads line '<client>: 1 ServiceM8 job created from leads in the last 24 h' and/or '<client>: 1 lead booked by the tradie in the last 24 h' after that client's cold/held lines; no line for a zero count"
    why_human: "Email rendering; event-gated on the first client"
  - test: "Read the runbook sections the operator will follow: first-client-go-live-runbook §3 (DONE paragraph) and §19; client-divert-onboarding-runbook 0.5 and 8.4; commercial-assumptions §16–§18"
    expected: "The tap, the sheet, Retry, DONE (whole word, own numbers, 48 h, one alert when nothing to close) and the 14-day tradie-booked rule read correctly and match the labels in the console"
    why_human: "Prose quality; the contract test pins words, not sense"
  - test: "Live clauses, relocated to the first client (SM8-01 / LEAD-04 live halves)"
    expected: "First real tap creates one Quote job visible in the client's ServiceM8 with the caller's words and a JOB contact; first tradie-booked job within 14 days resolves the lead on the next sync; first DONE from the escalation phone closes the escalated lead; record the job uuid (never the caller's number) in docs/external-registrations.md per go-live §19"
    why_human: "No live ServiceM8 write is authorised outside a client engagement (D-11); production holds zero leads"
---

# Phase 14: ServiceM8 Job Creation & Lead Resolution — Verification Report

**Phase Goal:** A lead with confirmed intent becomes a ServiceM8 quote job on one operator tap, exactly once, without the sync opening a second cadence on the same customer — and leads the tradie handled himself close honestly without operator work.
**Verified:** 2026-10-11 (HEAD `cef29ba` on `main`, phase base `bd8beb3`)
**Status:** human_needed — every code-level must-have is verified; the live halves are event-gated on the first client and the phone UAT is outstanding
**Re-verification:** No — initial verification

## Declared up front: nothing has run live against a customer

As in Phases 11–13 (12-09 founder override), no text-back has been sent live, production holds zero leads (`leads_total=0`), no tenant is armed (`text_back_armed_tenants=0`) and no quote carries `sync_source = 'lead'` (`quotes_source_lead=0`). Every live clause of SM8-01 and LEAD-04 (a real job in a real client's ServiceM8, a real tradie booking, a real DONE) is therefore **relocated** to the first client, not failed. What is verified here is the code path, the schema, the pure suites run locally, and the DB-backed suites by CI run id.

## Method

Goal-backward over the four ROADMAP success criteria and D-01..D-13. For each: the code path (read), the schema (migration 0041 read; `db:generate` clean), and the test proving it (pure suites run locally by explicit file list — 33 files, 1,449 tests, all passing; DB-backed suites cited by CI run id). `npm run typecheck` and `npm run lint` pass with no output. Read-only production checks only: `npm run lead-jobs:invariants`, `npm run cron:status`, three 401 probes, one read-only SELECT on the three spike rows. Never run: `test:remote`, `db:migrate`, any DB suite locally, any ServiceM8 request.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | **SC1 / SM8-01** One tap creates a Quote job with the caller's words, company matched by normalised mobile or created, one job contact; the console shows the job only after the POST path has read the record back | ✓ VERIFIED (live half relocated) | `src/core/servicem8/writes.ts:99-139` `createAndReadBack`: strict request → `post` → `x-record-uuid` → `getOne` → parse → `active` + uuid + `verify` (job: `status === 'Quote'` :186). `src/core/servicem8/schemas.ts:248` `status: z.literal('Quote')`, `:268` contact `type: 'JOB'`. `src/core/leads/job-provision.ts` company tiers (persisted uuid → mirror candidates → `findCompanyContactsByMobile` three spellings → create), each verified active (`activeCompany` :184). `src/core/leads/create-job.ts:272-320` returns `created` only after `provisioned.ok` AND the unit of work commits. Tests: `tests/sm8-client-write.test.ts` (post/getOne/wrappers/read-back), `tests/lead-job-create.test.ts` (happy path + reconciliation), DB `tests/lead-job-create-db.test.ts` "the UNIT OF WORK" (CI) |
| 2 | **SC2 / SM8-02** The lead-born job is in the mirror as `needs_review` / `lead` before the sync next sees it; no five-touch quote cadence opens | ✓ VERIFIED | `create-job.ts:278-285` upserts `syncSource: 'lead', chaseEligibility: 'needs_review'` inside the same `repo.transaction` as `recordJobCreated` and `closeLeadInTx(tx, leadId, 'job_created')`. Sticky source: `for-tenant.ts:3026` `CASE WHEN sync_source = 'lead' THEN 'lead' ELSE excluded.sync_source END`. First-sight guard for an orphan (deviation A + CR-01): `run-sync.ts:504-509` `jobUuidsLinkedAmong(unseen)` → `lead`/`needs_review`, `:522` event loop skips. Only one line of `run-sync.ts` was removed vs base (the `runSyncForConnection` call gaining `tickDeadlineAt`); the first-sight branches are untouched. Tests: DB "THE SYNC'S SILENCE" (:338), "THE ORPHAN" (:594), "THE READ-BACK ORPHAN (CR-01)" (:680) in `lead-job-create-db.test.ts` (CI); structural pins `tests/lead-job-structure.test.ts:192-216`; `tests/sync-upsert.test.ts` byte-identical and green in CI |
| 3 | **SC3 / SM8-03** A second tap cannot create a second job; a failed creation is retryable with the ServiceM8 error kind recorded | ✓ VERIFIED | Guarded claim `for-tenant.ts:4889-4913` (`status='open' AND sm8_job_state IN ('none','failed')`, one UPDATE). Partial unique `leads_sm8_job_created_uniq (tenant_id, sm8_job_uuid) WHERE sm8_job_state='created'` (0041). Failure record keeps uuids (`recordJobFailure` :4975). Adopt-before-create: tier 0 by persisted uuid **requires active** (WR-01, `job-provision.ts:276-281`), adopt by SHA-256 digest persisted before the POST (:286-302), contact adopt (:335-340). CR-01: every post-POST mismatch carries the uuid and is persisted (`writes.ts:125-135`, `job-provision.ts:240,314,354`). WR-02: 23505 on the partial unique clears the job linkage and fails `parse_error` (`create-job.ts:295-312`). Sheet shows kind + attempt count + Retry (`create-job-form.tsx:102-107,171`). Tests: DB "the DOUBLE TAP: one created, one refused, ONE job POST" (:231), "THE PARTIAL UNIQUE" (:406), "FAILED AND RETRY" (:440), WR-01 (:738), WR-02 (:772) (CI); pure `lead-job-create.test.ts` cases (a)(b)(c)(h)(i); `create-job-action.test.ts` sentence map covers every `LEAD_JOB_ERROR_KINDS` member |
| 4 | **SC4 / LEAD-04** DONE from the tradie's own number closes the lead; a lead whose caller mobile appears on a job created within 14 days is auto-resolved `booked_by_tradie` | ✓ VERIFIED (live half relocated) | DONE: `inbound.ts:334-340` branch under `!isStop && candidates.length === 0 && isDoneKeyword` (after STOP, after the cadence lookup — WR-05); `done-keyword.ts:116-126` `tenantsOwningNumber` → `latestSentLeadEscalationTo(ids, from, now − 48 h)` → `closeLead(..., 'closed_by_tradie')`; not found → row untriaged + one `done_no_lead` alert (:163-180). Match: `booked-by-tradie.ts:183-280` post-commit pass, `listOpenForJobMatch` (`open AND none`), `job-match.ts:118-125` window `[D, D+14]` in the tenant zone, `setMatchedJob` + `closeLeadInTx(tx, leadId, 'booked_by_tradie')` (:125-129). Tests: DB `tests/lead-done-keyword.test.ts` (47 h / 48 h inside, 49 h outside; own line → `done_no_lead` once; stranger threads; STOP wins) and `tests/lead-booked-by-tradie.test.ts` (D−1/D+15 open, D+14 resolves; idempotent; `creating` lead untouched; inactive job never) (CI); pure `done-keyword.test.ts` (42 cases), `lead-job-match.test.ts` (44 cases) |
| 5 | **D-01** Tap on the inbox row, confirm sheet previews exactly what is written, no label gate, no auto-creation | ✓ VERIFIED | `page.tsx:228-262` renders the sheet for an OPEN lead at `none`/`failed` with ≥1 reply; no label check; `create-job-form.tsx` arm-then-confirm, preview from `composeJobDescription` over server lines; WR-04 digest `preview_sha256` (`:120`) recomputed server-side (`create-job.ts:184-191`) → `thread_changed` on any difference. No auto-create: `lead-job-structure.test.ts:30` (create path emits no event, grants no eligibility); only `createJobForLeadAction` calls `createJobForLead`. DB case "an urgency label set between the preview and the confirm is thread_changed (WR-04)" (:555) |
| 6 | **D-02 / D-03** Job shape and the write path live in the ServiceM8 client with read-back and a closed error enum | ✓ VERIFIED | `types.ts` `Sm8WriteClient` (get/getOne/post) sibling of unchanged `Sm8Client`; `Sm8WriteFailureKind` closed; `client.ts` never stringifies a caught error (pinned `sm8-client-write.test.ts:206`); `createSm8Client` still answers `get()` for the sync (:196). OAuth `create_jobs` scope follow-up recorded in `docs/servicem8-api-notes.md` |
| 7 | **D-04** Exactly once at the database: `none → creating → created \| failed`, double tap refused, retry adopts | ✓ VERIFIED | See truth 3. `refusalFor` (`create-job.ts:148-157`) answers `already_in_progress` / `already_created` / `not_open`; stale `creating` released after 15 min (`failStaleJobClaims` :5115, DB case :458) |
| 8 | **D-05** Mirror pre-insert in the same unit of work, caller contact as the mirror contact, status machine then tracks the job | ✓ VERIFIED | `create-job.ts:276-294`; DB "THE WON EVENT: the tradie moves the job on and the status machine says 'won' once" (:371) |
| 9 | **D-06** Lead-born jobs are counted, never attributed; qualify/decide byte-identical | ✓ VERIFIED | `consume-wins.ts:336-343` `linkedToJob` → `isLeadBornJob` → `unqualified += 1; return` before `decideAttribution`; `lead-born.ts:38` `links.length > 0` (WR-03). `git diff --quiet bd8beb3..HEAD -- src/core/attribution/qualify.ts src/core/attribution/decide.ts` → identical; SHA-256 pins in `tests/attribution-lead-born.test.ts:129` pass. DB "the consumer unqualifies both lead-born wins, attributes the control" (`lead-booked-by-tradie.test.ts:658`) |
| 10 | **D-07** 14-day window both sides, `LEAD_JOB_MATCH_WINDOW_DAYS = 14` beside the lead constants and in commercial-assumptions; `job_created` and `booked_by_tradie` disjoint | ✓ VERIFIED | `constants.ts:264`; `docs/commercial-assumptions.md:501` §16. Disjoint by construction: the match reads `sm8_job_state = 'none'` only; our tap moves the lead to `creating` first (`lead-job-match.test.ts:212` each of creating/created/failed skipped; DB :349). Two leads on one tradie job both resolve, no 23505 (DB :434) |
| 11 | **D-08** DONE whole-word, case-insensitive, own numbers only, 48 h, most-recent sent escalation, never texted back, after STOP, never the quote path | ✓ VERIFIED | `done-keyword.ts:92` regex; `done-keyword.test.ts:136-151` imports no sending module; `:109-134` door order pins (after normalisation and the cadence lookup, guarded by `!isStop` and no candidate); `inbound-stop` / `inbound-threading` byte-identical. Note: WR-05 moved the branch from *before* the cadence lookup (14-04 wording) to *after* it; D-08's intent ("never touches the quote path") is better served and the pins were updated |
| 12 | **D-09** Row chips and two digest lines | ✓ VERIFIED | `page.tsx:126-138` chip words; `stalled-digest.ts:243,248` the two lines verbatim; `lead-digest-section.test.ts:189-258, 392-436` |
| 13 | **D-10** One migration entry 0041, applied, not edited after apply | ✓ VERIFIED | Journal idx 41 `0041_phase14_job_creation` `when` 1791619675151; `schema_0041_applied=true`; last edit to the SQL/snapshot/journal is `a1746fb` (14-03), before the apply at `bc620eb`; `npm run db:generate` → "No schema changes, nothing to migrate" and a clean tree |
| 14 | **D-11** The three spike rows untouched; no ServiceM8 write by any task | ✓ VERIFIED | Read-only SELECT today: both spike jobs (`01a12438-259d…`, `01a12438-2cc6…`) present `status=Unsuccessful sync_source=poll sm8_active=false`, one spike contact row, zero `quote_status_events` for them. Every test runs against `vi.stubGlobal('fetch')` or `createSm8Stub` |
| 15 | **D-12** The sync never writes to ServiceM8; match and pre-insert ride the existing sync, idempotent, no new cron | ✓ VERIFIED | `run-sync.ts:159,253,274` `clientFactory` returns `Sm8Client` (no `post`/`getOne` statically reachable); `lead-job-structure.test.ts:80-91,133-141` (no post, no write module import); `booked-by-tradie.ts:100` `client: Sm8Client`. `tests/cron-schedules.test.ts` and `scripts/apply-cron-schedules.mjs` byte-identical; `cron:status` shows the same four jobs. WR-06: the pass reads inside `tickDeadlineAt − 10 s`, 5 s per read (`tests/lead-booked-deadline.test.ts`, `sync-tick-budget.test.ts` additive pins) |
| 16 | **D-13** Quote behaviour unchanged: every existing sync, cadence and attribution suite untouched; first-sight branches not modified | ✓ VERIFIED | Byte-identical to `bd8beb3`: `transitions.ts`, `eligibility.ts`, `failure-policy.ts`, `outcomes.ts`, `pagination.ts`, `qualify.ts`, `decide.ts`, `stop-keywords.ts`, `close.ts`, `for-all-tenants.ts` (16 exports), `apply-cron-schedules.mjs`; suites `sync-upsert`, `sync-cursor`, `sync-failure-alerts`, `sync-health`, `sync-tick-route`, `quote-events`, `connect-servicem8`, `cron-schedules`, `report-metrics`, `inbound-stop`, `inbound-threading`, `lead-close`, `lead-reply`, `lead-label-effects`, `attribution-consume`, `attribution-baseline`, `attribution-qualify`, `attribution-decide`, `attribution-wedge-section`, every `cadence-*` and `escalation-*`. Acknowledged edits (all additive): `tests/attribution-consume-isolation.test.ts` +2 (deviation C, ratified in 14-05), `tests/sync-tick-budget.test.ts` +27 (WR-06 wiring pins), `tests/sm8-schemas.test.ts` (one import line reshaped + a Phase 14 describe), and the by-design pins `rls-coverage`, `lint-ban`, `operator-authorization`, `lead-digest-section`, `runbook-contract`, `ops-scripts`, `tests/helpers/seed.ts` |
| 17 | **Console authorisation** The action authorises before reading a byte of the body and sits in `GUARDED_PATHS` | ✓ VERIFIED | `create-job-actions.ts:76` `requireOperatorId()` precedes the first `formData.get` at `:106`; `tests/operator-authorization.test.ts:57-70` lists the file; `tests/create-job-action.test.ts:45-77` (order, shared import, one export, `created_by` from the claim) |

**Score:** 17/17 truths verified (0 present-but-behaviour-unverified). The behaviour-dependent truths (1, 2, 3, 4, 7, 8, 9, 10) rest on the DB-backed suites, which this machine cannot run; they are proven by CI run `38111363682` (bc620eb, success, 191 files / 6,140 tests) and the run on `cef29ba` recorded in the frontmatter.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/db/migrations/0041_phase14_job_creation.sql` | job linkage, state machine CHECKs, partial unique, widened reasons/sources, DONE index | ✓ VERIFIED | 120 lines; applied (42 entries); `db:generate` clean |
| `src/db/repository/for-tenant.ts` leads/quotes/quoteContacts additions | guarded claim, linkage writes, match reads, sticky source | ✓ VERIFIED | every predicate carries `tenantId`; `forAllTenants_*` still 16 |
| `src/core/servicem8/{types,client,schemas,writes}.ts` | write path with read-back | ✓ VERIFIED | wired from `job-provision.ts`; `Sm8Client` unchanged |
| `src/core/leads/{job-description,job-provision,create-job,mobile-spellings}.ts` | the tracer | ✓ VERIFIED | wired from `create-job-actions.ts` → `page.tsx` |
| `src/app/(console)/inbox/{create-job-actions.ts,create-job-form.tsx,action-state.ts,page.tsx}` | sheet, action, chips | ✓ VERIFIED | `CreateJobForm` rendered at `page.tsx:495` |
| `src/core/leads/{job-match,booked-by-tradie}.ts`, `src/core/attribution/lead-born.ts` | match + exclusion | ✓ VERIFIED | wired from `run-sync.ts:594` and `consume-wins.ts:336` |
| `src/core/leads/done-keyword.ts`, `src/db/repository/{leads,escalations}.ts` | DONE at the door | ✓ VERIFIED | wired from `inbound.ts:335`; `stalled-digest.ts:380` |
| `scripts/lead-jobs-invariants.mjs` | read-only pre-flight | ✓ VERIFIED | one SELECT + one catalogue probe; ran today |
| `docs/commercial-assumptions.md` §16–§18, go-live §3/§19, divert 0.5/8.4 | constants and runbooks | ✓ VERIFIED | `runbook-contract.test.ts` pins labels and facts |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `create-job-actions.ts` | `create-job.ts` | `createJobForLead(` after `requireOperatorId()` | WIRED |
| `create-job.ts` | `close.ts` | `closeLeadInTx(tx, leadId, 'job_created'` ×1 | WIRED |
| `create-job.ts` | `for-tenant.ts` | `upsertManyReturning` with `syncSource: 'lead'`, `chaseEligibility: 'needs_review'` | WIRED |
| `run-sync.ts` | `booked-by-tradie.ts` | `resolveLeadsBookedByTradie(` ×1, post-commit, in try/catch | WIRED |
| `booked-by-tradie.ts` | `close.ts` | `closeLeadInTx(tx, leadId, 'booked_by_tradie'` ×1 | WIRED |
| `consume-wins.ts` | `for-tenant.ts` | `tx.leads.linkedToJob(event.sm8JobUuid)` before `decideAttribution` | WIRED |
| `inbound.ts` | `done-keyword.ts` | `handleTradieDone(` ×1 under `!isStop && candidates.length === 0` | WIRED |
| `done-keyword.ts` | `close.ts` | `closeLead(tenantId, leadId, 'closed_by_tradie'` | WIRED |
| `stalled-digest.ts` | `repository/leads.ts` | `countLeadResolutionsSince(since)` inside the Leads try | WIRED |

(`gsd-tools query verify.key-links` reports "Invalid regex pattern" for the parenthesised `via` strings in the PLAN frontmatter — a tooling limitation; every link above was confirmed by fixed-string grep.)

### Behavioural Spot-Checks (local, read-only)

| Behaviour | Command | Result | Status |
|-----------|---------|--------|--------|
| Types and lint | `npm run typecheck && npm run lint` | no output, exit 0 | ✓ PASS |
| Schema in sync | `npm run db:generate` | "No schema changes, nothing to migrate"; tree clean | ✓ PASS |
| Pure suites (explicit list) | `npx vitest run` over 33 files (the 11 new/edited Phase 14 pure suites + the must-not-move pure pins) | 33 files, 1,449 tests passed | ✓ PASS |
| Production invariants | `npm run lead-jobs:invariants` | `leads_total=0 leads_converted=0 quotes_source_lead=0 escalations_lead_sent=0 text_back_armed_tenants=0 schema_0041_applied=true` | ✓ PASS |
| Cron health | `npm run cron:status` | lease rows 0, no watchdog, four jobs active, last five ticks 200 | ✓ PASS |
| Doors | `POST /api/webhooks/twilio/voice?token=wrong`, `/voice-status?token=wrong`, `/api/internal/cadence-tick` wrong bearer | 401 / 401 / 401 | ✓ PASS |
| Spike rows | one read-only SELECT (scratchpad script, same connection block as the invariants script) | 2 quotes rows `poll`/inactive/Unsuccessful, 1 contact row, 0 events | ✓ PASS |
| DB-backed suites | CI (cannot run here) | run 38111363682 success on bc620eb; run 38114051225 success on cef29ba (192/192 files, the first run of the CR-01/WR-01..06 DB cases) | ✓ PASS |

### Requirements Coverage

| Requirement | Plans | Status | Evidence |
|-------------|-------|--------|----------|
| SM8-01 | 14-01, 14-02 | ✓ SATISFIED (live clause event-gated) | truths 1, 5, 6 |
| SM8-02 | 14-01, 14-02, 14-03 | ✓ SATISFIED | truths 2, 8, 9 |
| SM8-03 | 14-01, 14-02 | ✓ SATISFIED | truths 3, 7 |
| LEAD-04 | 14-01, 14-03, 14-04 | ✓ SATISFIED (live clause event-gated) | truths 4, 10, 11, 12 |

All four ticked in REQUIREMENTS.md in this commit (`[x]` + "Complete (live clause event-gated on the first client)"). No orphaned requirement maps to Phase 14.

### Anti-Patterns Found

None. No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` in any Phase 14 source or script. `jobAddress: null` and `'(no name)'` are deliberate (D-01: the suburb goes into the description the sheet shows; a display fallback).

### Review state carried

14-REVIEW: CR-01 and WR-01..WR-06 fixed (`eb740f1`, `21d381a`, `99bffc4`, `041ac89`, `cf9936c`, `fea5d64`, `6788e0b`), each with pure pins and DB cases; IN-01, IN-03..IN-06, IN-08, IN-09 open by choice; IN-02 partial; IN-07 documented. Carried to Phase 15: a dedicated `LEAD_JOB_ERROR_KINDS` member for the WR-02 unique violation (today `parse_error` is borrowed; needs migration 0042 + a sheet sentence); the `recent_conversion` text-back gate skip (research OQ4); the OAuth `create_jobs` scope for App ID 000000 before any OAuth-path client creates jobs.

### Human Verification Required

See frontmatter `human_verification` — the phone UAT on `/inbox` (no lead rows, no create-job control today; the label words on the first real row), the digest wording, the runbook sections, and the three live clauses relocated to the first client.

### Gaps Summary

No gaps. Every success criterion and every D-NN decision is observable in the code and proven by a test; the only unverifiable items are those that need a real client (declared relocated, as in Phases 11–13) and the phone-width read of the sheet.

---

_Verified: 2026-10-11_
_Verifier: Claude (gsd-verifier)_
