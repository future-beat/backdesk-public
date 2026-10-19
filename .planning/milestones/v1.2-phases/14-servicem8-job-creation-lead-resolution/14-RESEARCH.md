# Phase 14: ServiceM8 Job Creation & Lead Resolution - Research

**Researched:** 2026-10-10
**Domain:** ServiceM8 REST write path (job / company / contact creation), exactly-once operator action over a third-party API, lead auto-resolution on the existing sync, a tradie keyword at the inbound door, migration 0041
**Confidence:** HIGH on ServiceM8 write semantics (measured live this session against the test account — see Spike ledger), HIGH on in-repo seams (every claim cites a file read this session), MEDIUM on the two designs the founder left to discretion (company name on the sheet, the `converted` CHECK shape)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01 The tap lives on the inbox lead row with a confirm sheet; the tap is the judgment (founder 10 Oct 2026):** any OPEN lead with at least one inbound reply shows "Create ServiceM8 job" on its inbox row; a confirm sheet previews exactly what will be written (description = the caller's verbatim words, suburb if given, urgency line, the "Created by Backdesk from a missed call on <date>" note) before the POST. There is no label gate; the operator reading the thread is the human gate, as with message approval. No auto-creation anywhere. The full lead page is Phase 15.
- **D-02 Job shape (research FEATURES §7, PITFALLS §5.5):** `POST job.json` with `status = 'Quote'`; company matched by normalised E.164 mobile against ServiceM8 companies/contacts, else created; one `jobcontact` for the caller; description built from stored verbatim words only (no model text, no free-text summary). Exact field names, uuid-in-header behaviour, read-after-write consistency and DELETE semantics are settled by the research spike (D-11), not assumed.
- **D-03 The new write path lives in the ServiceM8 client (SM8-01):** `post()`/`create…()` methods beside the existing read methods, zod-validated responses, the same auth modes (private API key first; the OAuth scope `create_jobs` for App ID 000000 recorded as a follow-up); every create is verified by reading the record back before the console shows it; rate-limit and error kinds mapped to a closed enum.
- **D-04 Exactly once per lead (SM8-03):** `leads` gains the job linkage (`sm8_job_uuid`, creation state, error kind, attempt timestamps) with a partial unique on the job uuid and a creation-state machine (`none → creating → created | failed`); a second tap while `creating` or `created` is refused; `failed` is retryable from the same sheet with the recorded ServiceM8 error kind shown; a partial failure (company created, job missing; job created, contact missing) is reconciled on retry by uuid/mobile match, never by a second blind create.
- **D-05 Mirror pre-insert (SM8-02):** inside the same unit of work as the successful read-back, the job is inserted into the quotes mirror as `chase_eligibility = 'needs_review'` with `sync_source = 'lead'` (new source value, CHECK widened) so the sync's first-sight rule sees a known row and opens no quote cadence; the lead's caller contact is the mirror's contact; the existing status machine then tracks Work Order/Completed/Unsuccessful as for any quote.
- **D-06 Lead-born jobs join the quote cadence only through the normal operator review (founder 10 Oct 2026):** nothing auto-chases a source=lead row; once the tradie has actually quoted it, the operator reviews it exactly like any other `needs_review` quote. D8 stands: lead-born jobs are COUNTED in leads-to-jobs, never attributed recovered dollars in v1.2; attribution's qualifying rules exclude source=lead rows and touch 0, pinned by tests.
- **D-07 Tradie-booked auto-resolution (LEAD-04, founder 10 Oct 2026):** on the 5-minute sync, a lead whose caller mobile (normalised) appears on any ServiceM8 job created within 14 days AFTER the lead's call, via the job's company or job-contact mobile, is marked `converted` with reason `booked_by_tradie`, its cadence stopped (existing `closeLead` path), the matched job uuid recorded; counted in leads-to-jobs, not attributed. The constant `LEAD_JOB_MATCH_WINDOW_DAYS = 14` lives beside the lead constants and in docs/commercial-assumptions.md. A job created by our own tap is `converted` with reason `job_created` (distinct reason), never double-counted.
- **D-08 DONE keyword (LEAD-04, founder 10 Oct 2026):** whole-word `DONE`, case-insensitive, received from the client's escalation phone or any number on the client's own-number/never-text list, closes the lead whose escalation was most recently sent to THAT number within the last 48 hours, with reason `closed_by_tradie`; no such lead → one operator alert, nothing closed; the tradie is never texted back; a DONE from a number that is not a client's own number is an ordinary inbound reply. Runs at the inbound door after STOP, before the lead keyword rule, and never touches the quote path.
- **D-09 Honest counting surfaces (minimal, Phase 15 builds the real queue/report):** the lead's closed/converted reason and the job linkage are visible on the inbox row (created job uuid + status, "booked by tradie", "closed by tradie"); the 06:30 digest's Leads section gains one line for jobs created and one for tradie-booked resolutions; no new report yet.
- **D-10 Schema lands in one migration entry (0041):** `leads` job-linkage columns + creation-state CHECKs + partial unique; `quotes.sync_source` CHECK widened with `lead`; `leads.closed_reason` CHECK widened with `booked_by_tradie`, `job_created`, `closed_by_tradie` (or a `converted_reason` column — research decides, preferring the existing column); any audit table for creation attempts. Push protocol as always; hosted Supabase is production.
- **D-11 Research spike against the TEST ServiceM8 account is authorised (founder 10 Oct 2026):** during research (before planning), the researcher may create a handful of clearly named `BACKDESK SPIKE` jobs and one `BACKDESK SPIKE` company in the test tenant 13e8f2aa's ServiceM8 trial account through the private API key, to settle: uuid-in-header on POST, `jobcontact.json` required fields, `status='Quote'` accepted on create, read-after-write consistency, company-by-mobile lookup shape, DELETE (or `active=0`) semantics, error shapes (400/401/404/409/429). Every spike object is deleted or marked Unsuccessful + inactive in the same session and the uuids are recorded in 14-RESEARCH.md. No other account is ever written to; no production Backdesk tables are written; the sync must not be allowed to mistake spike jobs for client quotes (the test tenant is paused; verify the spike rows do not surface as quotes, or clean them before the next sync tick).
- **D-12 Sync safety:** the auto-resolution match and the mirror pre-insert ride the existing sync run (no new cron job); both are idempotent across repeated polls; the sync never creates, deletes or edits anything in ServiceM8 (writes happen only from the operator tap); the 180/min / 20k/day budget is unaffected at this volume.
- **D-13 Quote behaviour unchanged:** every existing sync, cadence and attribution suite passes untouched; the first-sight rule's existing branches are not modified, only given a known row to find.

### Claude's Discretion
(CONTEXT.md has no `## Claude's Discretion` section. D-10 delegates one choice to research — `closed_reason` widening vs a `converted_reason` column — decided in §Q3 below.)

### Deferred Ideas (OUT OF SCOPE)
- Service-area check feeding the confirm sheet; booking-form POST; auto-creation on high-confidence intent; per-client "create jobs automatically" switch; lead dollars attribution.

### Scope and constraints carried (verbatim)
- In: SM8-01, SM8-02, SM8-03, LEAD-04. Out: lead queue page, lead reporting, 90-day pseudonymisation (Phase 15); posting a client's ServiceM8 booking form instead of a job (v2); attributing dollars to lead-born jobs (D8); ServiceM8 webhooks (polling stays the guarantee); OAuth-app scope work beyond recording the follow-up.
- Hosted Supabase is production; migration push protocol before code push; never `test:remote`; `.env*` never named in commands; the agent permission classifier refuses `db:migrate` and may refuse `git push` — the plan's push step must say the founder runs `db:migrate` by hand on refusal (13-07 precedent).
- No text-back has ever been sent live (12-09 override); zero leads on production; the test tenant is paused with SMS off. Live proofs are event-gated on the first client; plans need no second phone and no live customer.
- ServiceM8 test rig = the test tenant's trial account via private API key; Job webhooks are not live; sync polls every 5 min.
- GSD model policy: fable for planner/researcher/checker/verifier; opus for executors.
- 13-REVIEW IN-01..IN-11 open by design; touch only what this work passes through.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SM8-01 | From a lead with confirmed intent the operator creates a ServiceM8 job with one tap: status Quote, the caller's own words as the description, the company matched by mobile or created, and a job contact; through a new POST path in the ServiceM8 client that verifies the created record by reading it back | Spike ledger (every field, header and error shape measured), §Q1 (client additions), §Q3 (the unit of work and read-back), §Q6 (the sheet), Code Examples 1–3 |
| SM8-02 | A job created from a lead is pre-inserted into the quotes mirror as `needs_review` with source `lead`, so the sync's first-sight rule does not open a second quote cadence | §Q2 (first-sight rule, upsert conflict set, the `sync_source` CHECK being hand-written in 0008), Pitfall 1 (the conflict set overwrites `sync_source`), §Q7 |
| SM8-03 | Job creation is idempotent per lead and failures leave the lead retryable with the ServiceM8 error kind recorded | §Q3 (columns, CHECKs, partial unique, state machine, the three partial-failure reconciliations, the DB arbiter for a double tap), §Q8 tests |
| LEAD-04 | DONE from the tradie's own number closes the lead; a lead whose caller mobile appears on a ServiceM8 job created within 14 days is auto-resolved "booked by the tradie" | §Q4 (match on the sync run; the measured fact that Company has no mobile — the mobile is on CompanyContact/JobContact), §Q5 (door order, own-number set, the escalation read), §Q8 tests |
</phase_requirements>

## Summary

ServiceM8's write path is now measured, not assumed. Twenty-four live calls against the test account (05:10:20–05:10:25 UTC, 10 Oct 2026) settled every question D-11 listed: a `POST <resource>.json` returns `200 {"errorCode":0,"message":"OK"}` with the new record's uuid in the **`x-record-uuid`** response header (company, companycontact, job, jobcontact alike); `status: 'Quote'` is the only required job field and persists on an immediate read-back with `quote_date` and `date` stamped by ServiceM8; `jobcontact.json` needs only `job_uuid` (a missing one is `400 "job_uuid is not a valid uuid"`); read-after-write is consistent on the very next request (143 ms later); DELETE is a soft delete (`active: 0`, record still readable with 200); a duplicate POST creates a second job (no server-side dedupe — exactly-once is ours); `$filter=mobile eq '…'` is an **exact-spelling** match (digits-only spelling found nothing); and — the one fact that changes the design — **the Company object has no mobile/phone/email field at all**. The caller's mobile lives on `companycontact.json` and `jobcontact.json`, so "company matched by mobile" means "company contact matched by mobile", and the cheapest, API-free source for that is the `quote_contacts` mirror the sync already maintains.

The in-repo seams are all in place. The client (`src/core/servicem8/client.ts`) exposes `get` only and rejects a non-array body, so Phase 14 adds `post()` and `getOne()` with a separate write-failure kind (`bad_request`) rather than widening the sync's `Sm8FailureKind` (which `applyFailurePolicy` switches on). The first-sight rule is one line — `run-sync.ts:503` skips `quote_opened` whenever `prev !== undefined` — so a pre-inserted row is all SM8-02 needs; but the upsert's conflict set overwrites `sync_source` (`for-tenant.ts:2758`), so the next poll would turn `'lead'` into `'poll'` unless the set is taught to keep `'lead'`, and the attribution exclusion must key on the lead linkage, not the source string. The leads row already reserves the `converted` status and its CHECKs say "converted carries NO reason" (`leads.ts:85-87`, `:178-181`); D-07's `booked_by_tradie` / `job_created` reasons therefore need `leads_closed_iff_reason` rewritten to include `converted` — the existing-column path D-10 prefers, no new column. The inbound door decides STOP first and normalises once (`inbound.ts:252-257`) before any lookup; DONE slots in between normalisation and the cadence lookup, keyed on the client's own-number set the text-back gate already defines, and the "most recent escalation to that number" is a one-row read on `escalations(to_address, lead_id, sent_at)` where `to_address` is already the normalised `+614…` (`escalate-hot-leads.ts:256`).

One honest finding about the test rig: the test tenant's **sync connection is live** (`paused_at: null`, a successful cycle every five minutes); only its cadence messaging is paused. Because the sync's job filter deliberately carries no `active` filter and ServiceM8 deletes are soft, the two spike jobs surfaced in the production `quotes` mirror on the 05:15 tick — as `Unsuccessful`, `sm8_active = false`, with **zero** events and zero cadences, because they were set to `Unsuccessful` before deletion and the first-sight rule emits nothing for a non-Quote. Per the brief they are reported, not deleted (ids in the Spike ledger). The same tick is a live proof of the SM8-02 reasoning: a first-sight **Quote** row would have emitted `quote_opened`; the pre-insert is what stops that.

**Primary recommendation:** build the tap as a four-step pipeline — (1) a guarded DB claim that flips `sm8_job_state` `none|failed → creating` (the double-tap arbiter), (2) ServiceM8 calls outside any transaction with every uuid persisted the moment it is known and every create read back, (3) one tenant transaction that upserts the mirror row (`sync_source='lead'`, `needs_review`) + the contact, stamps the linkage, and `closeLeadInTx(…, 'job_created')`, (4) on any failure a single UPDATE to `failed` + the closed error kind — and plan the auto-resolution as a post-commit step of `runSyncForConnection` that matches open leads against the mirror's `quote_contacts` first and `companycontact.json` only for the handful of unmatched recent jobs.

## Project Constraints (from CLAUDE.md)

| Directive | Effect on this phase |
|---|---|
| Custom TS + Next.js 16 on Vercel `syd1`, Supabase Sydney; tooling budget; no new infra | No new cron job, queue or service: the tap is a Server Action, the auto-resolution rides `runSyncForConnection`, DONE rides `handleInboundSms` |
| `zod` v4 at every boundary (webhooks, provider callbacks, LLM outputs) | Request schemas for the four creates, a response schema for `{errorCode, message}`, read-back parsed through the existing `sm8Job` / `sm8JobContact` schemas; form fields parsed with zod in the action |
| ServiceM8 facts: private `X-API-Key`; OAuth app 000000 pending; 180/min, 20k/day per app per account; webhooks need OAuth; design polling as incremental | Private key path first (D-03); the `create_jobs` + `manage_job_contacts` + `manage_customers` + `manage_customer_contacts` scopes recorded as the OAuth follow-up (§Q1); creation = ≤ 9 requests; auto-resolution ≤ a few reads per cycle, only when open leads exist |
| drizzle-orm + versioned migrations; no Prisma; `drizzle-kit` generate then hand-finish | Migration 0041 generated from the schema files, hand-finished for the two hand-written CHECKs (`quotes_sync_source_known` lives in 0008 and is invisible to the snapshot) |
| Never free-text-parse LLM output; strict structured outputs | Not touched: the description is built from stored verbatim words, no model in the path (D-02) |
| GSD workflow enforcement; hosted DB is production; never `test:remote`; `.env*` never named | DB-backed suites in CI only; push protocol per 13-07 (founder runs `db:migrate` by hand on classifier refusal) |
| Spam Act / privacy posture: caller numbers never logged | The new code logs ids and vocabulary values only; `tests/inbound-threading.test.ts:616` reads `inbound.ts` as source and will police the DONE branch |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Create ServiceM8 company/contact/job/jobcontact | API / Backend (`src/core/servicem8`, `src/core/leads/create-job.ts`) | — | The only module allowed to talk to api.servicem8.com (`client.ts:1-2`); credentials decrypted in-process |
| Exactly-once per lead | Database (`leads` CHECKs + partial unique + guarded UPDATE) | Backend state machine | A check-then-insert can be passed twice; Postgres decides (the `leads_one_open_per_mobile` precedent, `leads.ts:5-12`) |
| Mirror pre-insert | Database transaction in the backend | — | Same unit of work as the linkage write; the sync reads `stateFor` under its own lock |
| Confirm sheet + tap | Frontend server (Server Action with `requireOperatorId`) | Browser (arm-then-confirm client component) | The action is the authorization boundary (`inbox/actions.ts:25-44`); the component is presentation only |
| Auto-resolution (booked by tradie) | Backend, on the sync run | Database (mirror contacts) | The mirror already holds job contacts; ServiceM8 is read only for unmatched recent jobs |
| DONE keyword | Backend inbound door | Database (`escalations` read, `leads.close`) | Decided before any cadence lookup, like STOP |
| Counting surfaces | Frontend server (inbox row) + backend (digest builder) | — | Reads only; Phase 15 owns the real queue/report |

## Standard Stack

### Core (no additions)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| global `fetch` (Node 22) | runtime | ServiceM8 POST/GET/DELETE | `src/core` is framework-free, "global `fetch` only, no HTTP library" [VERIFIED: src/core/servicem8/client.ts:15] |
| `zod` | already installed | Request/response schemas | Existing boundary discipline [VERIFIED: src/core/servicem8/schemas.ts:26] |
| `drizzle-orm` / `drizzle-kit` | already installed | Schema + migration 0041 | Existing [VERIFIED: src/db/schema/leads.ts:35-47] |
| `vitest` | already installed | Pure + DB-backed suites | [VERIFIED: vitest.config.ts] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Header-sourced uuid (`x-record-uuid`) | Client-supplied `uuid` in the POST body (docs: "optional; generated if omitted") | Would make the create idempotent by uuid alone (persist before POST, `GET job/{uuid}` on retry). **Not measured** — ServiceM8 mints time-ordered uuids (`01a12438-…`) and acceptance of a v4 is unverified. See Assumptions A2 and Open Question 2 |
| Matching company contacts via the mirror | `companycontact.json?$filter=mobile eq '…'` for every spelling | 3 reads per create and exact-spelling only; keep as the fallback tier, not the first |

**Installation:** none. **Package Legitimacy Audit:** not applicable — this phase installs no packages (verified: no new `package.json` dependency is needed; every import above exists in the lockfile).

## Architecture Patterns

### System Architecture Diagram

```
                     operator (phone)                                   ServiceM8 (test/client account)
                           │ tap "Create ServiceM8 job" on an OPEN lead row (inbox)
                           ▼
  ┌─ Server Action createJobForLeadAction(tenantId, leadId, form) ───────────────────────────┐
  │ requireOperatorId() → zod(form: name, first, last, suburb)                               │
  │ → createJobForLead(tenantId, leadId, input, operatorUserId)   [src/core/leads/create-job]│
  └───────────────────────────┬──────────────────────────────────────────────────────────────┘
                              ▼
  (1) CLAIM  tx: UPDATE leads SET sm8_job_state='creating', attempt+1, attempted_at
             WHERE id=? AND status='open' AND sm8_job_state IN ('none','failed') RETURNING
             ── 0 rows ⇒ refused: already_in_progress | already_created | not_open
                              ▼
  (2) SERVICEM8, outside any tx, each step persisted as soon as its uuid is known
      company: lead.sm8_company_uuid? ──GET company/{uuid}──▶ verify active
               else mirror match (quote_contacts.mobile|phone ≈ lead.contact_mobile → quotes.company_uuid)
               else companycontact.json?$filter=mobile eq '<3 spellings>' and active eq 1
               else POST company.json {name} ──x-record-uuid──▶ POST companycontact.json {mobile, type:'JOB', primary}
               ── persist sm8_company_uuid
      job:     lead.sm8_job_uuid? ──GET job/{uuid}──▶ verify
               else adopt: job.json?$filter=company_uuid eq … and status eq 'Quote' and active eq 1  (same description)
               else POST job.json {status:'Quote', company_uuid, job_description, job_address?} ──x-record-uuid──▶ GET job/{uuid}
               ── persist sm8_job_uuid
      contact: jobcontact.json?$filter=job_uuid eq … (JOB contact with our mobile?) else POST jobcontact.json ──▶ GET jobcontact/{uuid}
      readback: GET job/{uuid}  (edit_date bumped by the contact)
                              ▼
  (3) UNIT OF WORK  forTenant(tenantId).transaction:
        quotes.upsertManyReturning([{…normalizeJob(readback), syncSource:'lead', chaseEligibility:'needs_review'}])
        quoteContacts.upsertMany([normalizeContact(contactReadback)])
        leads.recordJobCreated(leadId, {jobUuid, contactUuid, createdBy, now})   (state → 'created')
        closeLeadInTx(tx, leadId, 'job_created', now)        (cadence stopped 'lead_closed', touches skipped)
                              ▼
  (4) any failure after (1): UPDATE leads SET sm8_job_state='failed', sm8_job_error_kind=<closed enum>  (uuids kept)
      ── the sheet shows the kind; a retry re-enters (2) and reconciles by the persisted uuids

  ── 5-minute sync (unchanged write tx) ──▶ stateFor finds the pre-inserted row ⇒ no quote_opened (run-sync.ts:503)
                                        ──▶ post-commit: resolveLeadsBookedByTradie(tenantId, now)
                                             open leads × mirror jobs dated [call, call+14d] × quote_contacts mobiles
                                             (+ companycontact.json for unmatched recent jobs, capped)
                                             ⇒ closeLead(…, 'booked_by_tradie') + sm8_job_uuid
  ── inbound SMS ──▶ handleInboundSms: STOP? → normalise → [DONE from a client's own number?]
                                             → latest sent lead escalation to that number ≤ 48 h
                                             ⇒ closeLead(…, 'closed_by_tradie'); row recorded, triaged
                                             ⇒ none: row recorded untriaged + one operator email
                                        → otherwise the existing cadence lookup, untouched
```

### Recommended Project Structure (new and touched files)

```
src/core/servicem8/
├── client.ts            # + post(), getOne(); write-failure classification (bad_request)
├── schemas.ts           # + sm8CompanyCreate, sm8CompanyContactCreate, sm8JobCreate, sm8JobContactCreate, sm8WriteResult, sm8CompanyContact (read)
└── types.ts             # + Sm8WriteFailureKind, Sm8WriteClient surface
src/core/leads/
├── create-job.ts        # createJobForLead — claim / calls / unit of work / failure record
├── job-description.ts   # deterministic description builder (pure, verbatim words only)
├── booked-by-tradie.ts  # resolveLeadsBookedByTradie — the sync's post-commit match
├── done-keyword.ts      # isDoneKeyword + handleTradieDone (called by the door)
└── constants.ts         # + LEAD_JOB_MATCH_WINDOW_DAYS = 14, DONE_LOOKBACK_HOURS = 48
src/core/messaging/inbound.ts       # the DONE branch between normalisation and the cadence lookup
src/core/sync/run-sync.ts           # one post-commit call, try/caught, in runSyncForConnection
src/db/schema/leads.ts              # linkage columns, state + reason CHECKs, partial unique
src/db/schema/quotes.ts             # SYNC_SOURCES + 'lead'
src/db/repository/for-tenant.ts     # leads.claimJobCreation / recordJobCreated / recordJobFailure / setCompanyUuid / setJobUuid / listOpenForJobMatch; quoteContacts.mobilesForJobs; quotes.listRecentByDate
src/db/repository/escalations.ts    # latestSentLeadEscalationTo(toAddress, since)
src/db/repository/for-all-tenants.ts# forAllTenants_tenantsOwningNumber(e164)  (16 → 17, containment paragraph)
src/db/repository/inbound-messages.ts # InboundTriageRow + lead linkage fields (LEFT JOIN leads)
src/app/(console)/inbox/{page.tsx,actions.ts,action-state.ts,create-job-form.tsx}
src/core/aging/stalled-digest.ts    # buildLeadsSection gains created/booked inputs
src/db/migrations/0041_phase14_job_creation.sql (+ meta/_journal.json idx 41)
docs/commercial-assumptions.md      # §16 LEAD_JOB_MATCH_WINDOW_DAYS, §17 DONE_LOOKBACK_HOURS
docs/servicem8-api-notes.md         # "Write semantics (Phase 14 spike)" section from the ledger below
```

### Q1. The ServiceM8 client: what exists, and the exact shape of the additions

**How reads are built today** [VERIFIED: src/core/servicem8/client.ts:21-107]: `BASE = 'https://api.servicem8.com/api_1.0'` (`:21`); `endpointPath()` appends `.json` once (`:56-58`); `get(resource, {filter, cursor})` sets `$filter` via `URLSearchParams` (`:68`), sends `{'X-API-Key': auth.key, Accept: 'application/json'}` with a 20 s `AbortSignal.timeout` (`:73-76`); a thrown fetch becomes `{ok:false, kind:'network_error', detail:'fetch failed (<e.name>)'}` (`:77-81`); non-2xx goes through `classify(status)` which maps 401/403 → `auth_failed`, 429 → `rate_limited`, everything else → `server_error` (`:34-43`); a non-array body is `parse_error` (`:94-101`). Pagination walks `cursor` with the no-new-uuids guard (`pagination.ts:84-136`) and treats the 50-page cap as a `parse_error` failure (`:138-160`). The closed failure enum is

```ts
// [VERIFIED: src/core/servicem8/types.ts:21-26]
export type Sm8FailureKind =
  | 'auth_failed'
  | 'rate_limited'
  | 'server_error'
  | 'network_error'
  | 'parse_error';
```

and `Sm8Auth = { kind: 'apiKey'; key: string }` (`types.ts:48`) with the OAuth arm explicitly reserved as "a new arm plus a header branch" (`:44-46`). The private key reaches the client decrypted in-process: `decryptCredential(conn.apiKeyCiphertext, …)` then `clientFactory(apiKey)` [VERIFIED: src/core/sync/run-sync.ts:425-427]; the row is `sm8_connections.api_key_ciphertext` (`enc:v1:…`, AES-256-GCM) with only `key_last4` ever rendered [VERIFIED: src/db/schema/sm8-connections.ts:61-68]. `connectServiceM8` verifies a key with `client.get('job.json', {cursor:'-1'})` before storing it [VERIFIED: src/core/sync/connect.ts:133-135].

**Measured write semantics** (Spike ledger, all `[VERIFIED: live call, 2026-10-10 05:10 UTC]`):

| Fact | Measured |
|---|---|
| Create verb/path | `POST /api_1.0/<resource>.json` with a JSON body; `Content-Type: application/json` |
| Success body | `200` `{"errorCode":0,"message":"OK"}` — `errorCode` is a **number** on the wire (docs show the string `"0"`); accept both |
| New uuid | `x-record-uuid` response header on every create (company, companycontact, job, jobcontact); absent on reads and errors |
| Update verb | `POST /<resource>/{uuid}.json` with a partial body → `200 {"errorCode":0,…}` and `x-record-uuid` echoing the uuid (measured for `status: 'Unsuccessful'`) |
| Single read | `GET /<resource>/{uuid}.json` → a **single object** (not an array); `200` even when `active: 0` |
| Delete | `DELETE /<resource>/{uuid}.json` → `200 OK`; soft: `active: 0`, record still readable |
| 400 shape | `{"errorCode":400,"message":"<reason>","documentation":"Please refer to https://developer.servicem8.com/llms.txt …"}` — reasons seen: `company_uuid record does not exist`, `Job status is not valid`, `job_uuid is not a valid uuid` |
| 401/429 | Not triggered. Docs: 401 `{"errorCode":"401","message":"Authentication failed. Please check your API key or OAuth token."}`; 429 `{"errorCode":429,"message":"Number of allowed API requests per minute exceeded"}` (or `… per day …`) [CITED: developer.servicem8.com/reference/createclients.md] |
| 404 | Docs: "The requested record does not exist or has been deleted" on `GET job/{uuid}` [CITED: developer.servicem8.com/reference/getjobs.md] — **but** a soft-deleted record read back `200` with `active: 0` in the spike, so 404 means "never existed / not this account", not "deleted" |
| Latency | 119–609 ms per call; 24 calls in 5.7 s |

**Exact additions** (prescriptive):

```ts
// types.ts — a SEPARATE write enum so applyFailurePolicy's switch over Sm8FailureKind is untouched (D-13)
export type Sm8WriteFailureKind = Sm8FailureKind | 'bad_request';   // 400/404/422 on a write: our payload or a missing referent
export interface Sm8Client {
  get(...): …;                                                   // unchanged
  getOne(resource: string, uuid: string): Promise<Sm8Result<{ row: unknown; headers: Headers }>>;
  post(resource: string, body: Record<string, unknown>): Promise<Sm8WriteResult<{ uuid: string | null; headers: Headers }>>;
}
```

- `post()` builds `${BASE}/${endpointPath(resource)}`, `method: 'POST'`, the same headers plus `Content-Type: application/json`, `JSON.stringify(body)`, the same timeout and the same never-throw/never-interpolate rules (`client.ts:1-18`). Classification for writes: 401/403 → `auth_failed`; 429 → `rate_limited`; **400/404/422 → `bad_request`**; other 4xx/5xx → `server_error`. The `detail` carries the HTTP status only — never the response `message` (T-2-02: "never the response body", `client.ts:9-11`). The uuid is `res.headers.get('x-record-uuid')`; a 200 with no header is returned as `ok: true, uuid: null` and the caller treats it as `readback_mismatch` (below).
- `getOne()` is needed because `get()` rejects a non-array body (`client.ts:94-101`); it parses an object and returns it raw for the caller's zod schema.
- Typed wrappers in a new `src/core/servicem8/writes.ts` (keeps `client.ts` transport-only): `createCompany`, `createCompanyContact`, `createJob`, `createJobContact`, `getJob`, `getJobContact`, `getCompany`, `listJobContactsForJob(jobUuid)`, `findCompanyContactsByMobile(spellings[])`, `listOpenQuoteJobsForCompany(companyUuid)`. Each create validates its input with the request schema, POSTs, and **reads the record back** through `sm8Job` / `sm8JobContact` / a new `sm8CompanyContact` (fields measured: `uuid, active, edit_date, company_uuid, first, last, email, phone, mobile, type`) before returning — D-03's "every create is verified by reading the record back".
- Request schemas (zod, `.strict()` on OUR side so a typo never silently ships a field ServiceM8 ignores):

```ts
export const sm8JobCreate = z.object({
  status: z.literal('Quote'),                       // only required field (measured); the only value we ever write
  company_uuid: z.string().uuid(),
  job_description: z.string().min(1).max(4000),
  job_address: z.string().max(500).optional(),       // docs: max 500 [CITED: createjobs]
}).strict();
export const sm8JobContactCreate = z.object({
  job_uuid: z.string().uuid(), first: z.string().max(100).optional(), last: z.string().max(100).optional(),
  mobile: z.string(), type: z.literal('JOB'),
}).strict();
export const sm8CompanyCreate = z.object({ name: z.string().min(1).max(100) }).strict();   // max 100 [CITED: createclients]
export const sm8CompanyContactCreate = z.object({
  company_uuid: z.string().uuid(), first: z.string().optional(), last: z.string().optional(),
  mobile: z.string(), type: z.literal('JOB'), is_primary_contact: z.literal('1'),
}).strict();
export const sm8WriteResult = z.object({ errorCode: z.union([z.literal(0), z.literal('0')]), message: z.string() }).loose();
```

- **Spelling of the mobile we write:** ServiceM8 stores exactly what it is given and filters by exact spelling (ledger #4/#5). Write the **local spaced form** `04xx xxx xxx` (the shape a tradie types; the one spelling the spike proved round-trips and is filterable), derived from the lead's `+614…` by a tiny pure `toLocalSpaced(e164)`. `normalizeAuMobile` accepts both shapes on the way back [VERIFIED: src/core/cadence/primary-contact.ts:111-141].
- **OAuth scopes to record for App ID 000000** [CITED: developer.servicem8.com/docs/authentication.md + the four endpoint pages]: `create_jobs` ("Ability to create jobs on behalf of account. Note creating jobs may incur account charges."), `manage_job_contacts` (JobContact), `manage_customers` (Company), `manage_customer_contacts` (CompanyContact), plus `read_jobs` / `read_customers` / `read_customer_contacts` for the read-backs. Private API keys are not scope-limited in the docs ("You do not need a ServiceM8 Developer account to use API keys") and the spike confirms a private key may create, update and delete. The follow-up goes in `docs/external-registrations.md` under the App ID 000000 entry [VERIFIED: docs/external-registrations.md:32-36].

### Q2. Mirror pre-insert (D-05): the shapes, the rule, and the status machine

**The insert shape** [VERIFIED: src/core/sync/connect.ts:205-210 and src/core/sync/run-sync.ts:463-474]: a `QuoteUpsert` is `{ ...NormalizedQuote, syncSource, chaseEligibility }`; `connect.ts` writes `syncSource: 'backfill'`, `chaseEligibility: 'needs_review'`; the poll writes `syncSource: 'poll'`, `chaseEligibility: 'eligible'`. `NormalizedQuote` comes from `normalizeJob(sm8Job.parse(row), SM8_TIMESTAMP_ZONE)` [VERIFIED: src/core/servicem8/normalize.ts:194-222] and needs `edit_date` non-empty (`quotes.edit_date_raw NOT NULL`, `quotes.ts:104`) — which the read-back supplies (measured `edit_date: "2026-10-10 05:10:22"`). Contacts go through `normalizeContact()` [VERIFIED: src/core/sync/run-sync.ts:173-189] and `tx.quoteContacts.upsertMany` (`for-tenant.ts:5137`).

**The vocabulary and its CHECK:**

```ts
// [VERIFIED: src/db/schema/quotes.ts:67-68]
export const SYNC_SOURCES = ['backfill', 'poll'] as const;
```
```sql
-- [VERIFIED: src/db/migrations/0008_sm8_vocabulary_constraints.sql:49-53]
ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_sync_source_known;
ALTER TABLE public.quotes
  ADD CONSTRAINT quotes_sync_source_known
  CHECK (sync_source IN ('backfill', 'poll'));
```
This CHECK is **hand-written in 0008 and absent from the drizzle schema file**, so `drizzle-kit generate` will not emit its widening; 0041 hand-writes `DROP CONSTRAINT IF EXISTS` + `ADD … IN ('backfill','poll','lead')` (the README rule, `src/db/migrations/README.md:11-30`). `tests/rls-coverage.test.ts:1193` pins the constraint's existence by name — unchanged name, still green.

**The first-sight rule** [VERIFIED: src/core/sync/run-sync.ts:461-504]: the write transaction reads `stateFor(uuids)` (`:461`), builds `previous`, and for each job computes `becameInactive = !job.sm8Active && prev !== undefined && prev.sm8Active` (`:491`), `classifyTransition(prev?.status ?? null, job.status, becameInactive)` and then

```ts
// [VERIFIED: src/core/sync/run-sync.ts:503]
if (type === 'quote_opened' && prev !== undefined) continue;
```
So with a pre-inserted row, `prev` is defined and no `quote_opened` is emitted; the transition classifier itself returns `quote_opened` only on `prev === null && next === 'Quote'` [VERIFIED: src/core/sync/transitions.ts:69-71]. Nothing in these branches changes (D-13). The spike's 05:15 tick is a live demonstration of the complement: first sight of two `Unsuccessful` jobs emitted `events_emitted: 0`.

**What the upsert does to the pre-inserted row on the next poll** [VERIFIED: src/db/repository/for-tenant.ts:2731-2771]: the conflict set overwrites every mirrored column **and** `syncSource: sql\`excluded.sync_source\`` (`:2758`), while `chase_eligibility` is deliberately absent (`:2760-2768`). Consequences: `needs_review` survives (good — it lands in the client page's "Needs review" list, `clients/[id]/page.tsx:1200`), but `sync_source` becomes `'poll'` on the first poll after creation. Pitfall 1 covers the fix: change that one line to keep `'lead'` once set — `syncSource: sql\`CASE WHEN ${quotes.syncSource} = 'lead' THEN 'lead' ELSE excluded.sync_source END\`` — which no existing row can observe (no row holds `'lead'` today), so every sync suite stays green; and key D-06's attribution exclusion on the **lead linkage**, never on the string.

**Status machine for such a row:** identical to any quote — `Quote → Work Order|Completed` is `won`, `→ Unsuccessful` is `lost`, back to `Quote` is `reopened`, `active: 0` on a known live row is `removed` [VERIFIED: src/core/sync/transitions.ts:75-93]. A `won` on a lead-born job produces a `won` event that `consume-wins.ts` evaluates; its unqualified branch is `if (decision.kind === 'unqualified')` [VERIFIED: src/core/attribution/consume-wins.ts:379-380]. The lead exclusion belongs **there**, before `decide`: a quote whose `(tenant_id, sm8_job_uuid)` matches a lead with `sm8_job_state = 'created'` (our tap) or a lead resolved `booked_by_tradie` with that `sm8_job_uuid` is unqualified with a new closed reason (`lead_born`), regardless of touches — because an operator may later make the row eligible and run a quote cadence, after which `qualifyingTouches` (which already drops touch 0, `qualify.ts:113`) would otherwise credit it. Pin with a test beside `tests/attribution-consume.test.ts`.

**Operator review afterwards (D-06):** `markChaseEligible` flips `needs_review → eligible` and emits `quote_opened` with `fromStatus: FIRST_SIGHT` [VERIFIED: src/core/sync/eligibility.ts:79-101]; that is the only door into the quote cadence for a lead-born row, exactly as for a backfilled one.

### Q3. Exactly-once (D-04): columns, CHECKs, state machine, reconciliation, unit of work, the action

**What the `leads` row holds today** [VERIFIED: src/db/schema/leads.ts:107-195]: `contact_mobile` (normalised `+614…`, CHECK `^[+]614[0-9]{8}$`, `:163`), `status` CHECK `IN ('open','converted','closed','expired')` (`:165`), `closed_reason` / `closed_at` with

```sql
-- [VERIFIED: src/db/schema/leads.ts:173-185]
leads_closed_reason_known   closed_reason IS NULL OR closed_reason IN ('new_enquiry', 'callback_request', 'question', 'existing_job', 'complaint', 'not_a_lead', 'already_sorted', 'spam', 'opt_out', 'other', 'touches_exhausted', 'expired', 'operator', 'quote_cadence_wins')
leads_closed_iff_reason     (status IN ('closed', 'expired')) = (closed_reason IS NOT NULL)
leads_closed_at_with_reason (closed_reason IS NULL) = (closed_at IS NULL)
leads_expired_reason        status <> 'expired' OR closed_reason = 'expired'
```
and the arbiter `leads_one_open_per_mobile` UNIQUE `(tenant_id, contact_mobile) WHERE status = 'open'` (`:146-148`). The schema header says, verbatim, "`converted` (Phase 14) carries NO closed_reason under these CHECKs … and Phase 14 is not blocked by this vocabulary" (`:85-87`) — but D-07 wants `converted` to carry `booked_by_tradie` / `job_created`, so **the existing column is used (D-10's preference) and `leads_closed_iff_reason` is rewritten**, not a new column:

```sql
leads_closed_reason_known   … IN (<the 14 today>, 'booked_by_tradie', 'job_created', 'closed_by_tradie')
leads_closed_iff_reason     (status IN ('closed', 'expired', 'converted')) = (closed_reason IS NOT NULL)
leads_converted_reason      status <> 'converted' OR closed_reason IN ('booked_by_tradie', 'job_created')
leads_conversion_reason_only_converted  closed_reason IS NULL OR closed_reason NOT IN ('booked_by_tradie', 'job_created') OR status = 'converted'
```
`closed_by_tradie` is an ordinary `closed`. The repository's close maps status from the reason — today `status: reason === 'expired' ? 'expired' : 'closed'` [VERIFIED: src/db/repository/for-tenant.ts:4549] — and gains a third arm: `CONVERSION_REASONS.has(reason) ? 'converted'`. `closeLeadInTx` needs no edit beyond the widened `LeadClosedReason` type [VERIFIED: src/core/leads/close.ts:51-78]; it stops the live cadence `lead_closed` and skips unsent touches (`:69-72`), then `tx.leads.close` guarded on `status = 'open'` (`for-tenant.ts:4555-4561`). `isRecentNegativeClose` only reacts to the four negative reasons [VERIFIED: src/core/leads/gate.ts:120-147], so a converted lead never cools a caller off; its comment ("an open or converted newest lead carries no reason") becomes stale and should be edited in passing.

**New linkage columns on `leads`** (all nullable or defaulted, so Phase 13 code meets the 0041 schema safely):

| Column | Type | Purpose |
|---|---|---|
| `sm8_job_state` | `text NOT NULL DEFAULT 'none'` | `none → creating → created \| failed`; `failed → creating` on retry |
| `sm8_company_uuid` | `uuid` | persisted the moment the company is matched/created (reconciliation key) |
| `sm8_job_uuid` | `uuid` | our created job, or the tradie's matched job (`booked_by_tradie`) |
| `sm8_job_contact_uuid` | `uuid` | the caller's job contact |
| `sm8_job_error_kind` | `text` | closed enum `LEAD_JOB_ERROR_KINDS` below; NULL unless `failed` |
| `sm8_job_attempt_count` | `integer NOT NULL DEFAULT 0` | shown on the sheet after a failure |
| `sm8_job_attempted_at`, `sm8_job_created_at` | `timestamptz` | the state's timestamps; `created_at` is the digest's "jobs created" read |
| `sm8_job_created_by` | `uuid` | the operator's `sub` from `requireOperatorId()` (never a form field) |

CHECKs: `leads_sm8_job_state_known` (`IN ('none','creating','created','failed')`), `leads_sm8_job_error_kind_known`, `leads_sm8_job_created_has_uuid` (`sm8_job_state <> 'created' OR sm8_job_uuid IS NOT NULL`), `leads_sm8_job_failed_has_kind` (`sm8_job_state <> 'failed' OR sm8_job_error_kind IS NOT NULL`), `leads_sm8_job_attempts_nonneg`. **Partial unique:** `leads_sm8_job_created_uniq` UNIQUE `(tenant_id, sm8_job_uuid) WHERE sm8_job_state = 'created'` — scoped to our creates so that two leads (two callers, two mobiles, one tradie job with both as contacts) can both resolve `booked_by_tradie` to one job without a 23505, while one job can never be "our creation" for two leads. `LEAD_JOB_ERROR_KINDS = ['auth_failed','rate_limited','server_error','network_error','parse_error','bad_request','connection_paused','not_connected','readback_mismatch'] as const` (the write enum plus three local refusals). **No audit table** in v1.2: the attempt count, last kind and timestamps on the lead answer "what happened", and a new table would need the 0039-style GRANT block (`0039_phase12_text_back.sql:241-248`), an RLS policy and the rls-coverage pins for a surface Phase 15's report does not need.

**The state machine and the DB arbiter (double tap):**

```sql
-- leads.claimJobCreation(leadId, now): the ONLY transition into 'creating'
UPDATE leads SET sm8_job_state = 'creating', sm8_job_attempt_count = sm8_job_attempt_count + 1,
                 sm8_job_attempted_at = $now, sm8_job_error_kind = NULL, updated_at = $now
 WHERE tenant_id = $t AND id = $lead AND status = 'open' AND sm8_job_state IN ('none', 'failed')
 RETURNING id, sm8_company_uuid, sm8_job_uuid, sm8_job_contact_uuid;
```
Zero rows is an answer, decided by Postgres under row-level locking — the second of two concurrent taps gets `[]` and the action reports `already_in_progress` (state `creating`), `already_created`, or `not_open`, read back in one SELECT. This is the `leads_one_open_per_mobile` / `claimEscalation` discipline ("decided by POSTGRES rather than by a check-then-insert two overlapping ticks can both pass", `escalations.ts:37-48`).

**Unit-of-work boundaries** — the `connect.ts` / `run-sync.ts` precedent: third-party HTTP **outside any transaction** ("an open Postgres transaction held across several seconds of third-party HTTP occupies a pooled connection", `run-sync.ts:12-18`, `connect.ts:12-15`):

1. **Claim** (one short tx or a single UPDATE): the statement above. Also require ≥ 1 inbound reply on the lead (`forTenant().inbound.latestForLead(leadId)` exists, `for-tenant.ts:1835`, `:4087`) — D-01's "at least one inbound reply", enforced in core, not only at render.
2. **Connection**: `repo.connection.get()`; none → `not_connected`; `pausedAt !== null` → `connection_paused` (the `resumeConnection` shape, `connect.ts:308-312`). Decrypt as `run-sync.ts:425-427`.
3. **ServiceM8**, each step persisting its uuid immediately via a tiny guarded UPDATE (`WHERE sm8_job_state = 'creating'`):
   - *Company.* If `sm8_company_uuid` is set: `GET company/{uuid}` and verify `active`. Else tier (i): mirror — `quote_contacts` rows of this tenant whose `normalizeAuMobile(mobile ?? phone)` equals `lead.contact_mobile`, joined to `quotes.company_uuid`, newest `quotes.date_raw` first → candidate company; `GET company/{uuid}` to verify it is active. Tier (ii): `companycontact.json?$filter=mobile eq '<spelling>' and active eq 1` for the three spellings (local spaced, local compact, `+61…`) — 3 reads; the `$filter` value is built only from digits, spaces and `+` of a value that already passed `leads_contact_mobile_e164`, and is single-quoted (filter syntax: `eq/ne/gt/lt`, `and` only, strings in single quotes [CITED: developer.servicem8.com/docs/filtering.md]). Tier (iii): `POST company.json {name}` then `POST companycontact.json {company_uuid, first, last, mobile, type:'JOB', is_primary_contact:'1'}` so the tradie's client record carries the mobile (and D-07's future matches can find it). Persist `sm8_company_uuid`.
   - *Job.* If `sm8_job_uuid` is set: `GET job/{uuid}` (exists → skip to the contact). Else **adopt-before-create**: `job.json?$filter=company_uuid eq '<company>' and status eq 'Quote' and active eq 1`; a job whose `job_description` equals our deterministic description is ours from a crashed attempt (the header was received but the process died before persisting) — adopt it. Else `POST job.json` → `x-record-uuid` → `GET job/{uuid}`; verify `status === 'Quote'`, `active`, `company_uuid` matches; persist `sm8_job_uuid`. A `null` header or a mismatching read-back is `readback_mismatch` — the lead goes `failed` with no uuid, and the next retry's adopt step finds the job by description.
   - *Contact.* `jobcontact.json?$filter=job_uuid eq '<job>'` (measured: ServiceM8 auto-creates **nothing** for an API-created job — ledger #8); a `JOB`-type row with our mobile (normalised compare) is adopted, else `POST jobcontact.json` → `GET jobcontact/{uuid}`. Persist `sm8_job_contact_uuid`.
   - *Read-back.* `GET job/{uuid}` once more (adding the contact bumps the job's `edit_date` — ledger #11 — and the cursor must see the final value).
4. **The unit of work** (one `forTenant(tenantId).transaction`): `tx.quotes.upsertManyReturning([{ …normalizeJob(job), syncSource: 'lead', chaseEligibility: 'needs_review' }])`; `tx.quoteContacts.upsertMany([normalizeContact(contact)])`; `tx.leads.recordJobCreated(leadId, { jobUuid, contactUuid, createdBy, now })` guarded `WHERE sm8_job_state = 'creating'`; `closeLeadInTx(tx, leadId, 'job_created', now)`. Row count checks: if the linkage UPDATE returns zero rows (the lead was closed `booked_by_tradie` by a sync cycle that raced — see §Q4's guard, which makes this a one-in-a-million) the transaction throws and the lead is marked `failed/readback_mismatch` with its uuids kept, never silently losing a job that now exists in the tradie's account.
5. **Failure record**: any `!ok` or thrown step → `UPDATE leads SET sm8_job_state = 'failed', sm8_job_error_kind = $kind WHERE sm8_job_state = 'creating'`. Caught values are never logged (T-2-02); the kind is.

**Exactly-once budget:** worst case 9 ServiceM8 requests per create (3 filter reads, 2 company writes, job write + read, contact write + read, final read) against 180/min — irrelevant at this volume (D-12).

**The server action** [analog VERIFIED: src/app/(console)/inbox/actions.ts:53-78 and clients/[id]/quotes/[quoteId]/actions.ts:197-229]: `'use server'` module exporting only async functions (`tests/lint-ban.test.ts:903` pins this); `requireOperatorId()` **first**, before reading the body ("the gate runs first, before the body is read", `inbox/actions.ts:25-44`; `requireOperatorId` at `_auth.ts:73-86`); uuid guard on `lead_id` (`UUID_PATTERN`, `inbox/actions.ts:20`); zod on `company_name` (1–100), `first`/`last` (≤ 100, optional), `suburb` (≤ 60, optional); the action returns a `TriageState`-like `{error, success}` with **fixed sentences only** (`action-state.ts:11-14`), never a driver or provider message; `revalidatePath('/inbox')`. The description is rebuilt server-side from the lead's stored inbound bodies — a posted preview is never trusted. The client component follows `SuppressContactForm`'s arm-then-confirm shape with `useActionState(createJobForLeadAction.bind(null, tenantId, leadId), BLANK)` [VERIFIED: src/app/(console)/inbox/suppress-contact-form.tsx:52-104], the confirm panel showing the exact description, company name, contact and the "Created by Backdesk from a missed call on <date AWST>" line. Note that the inbox hides triaged rows: the tap must happen before "Mark handled" (or from Phase 15's lead page) — say so in the panel copy.

### Q4. Auto-resolution (D-07) on the sync run

**Where:** in `runSyncForConnection`, **after** `await repo.transaction(…)` commits (`run-sync.ts:453`) and before the result is returned — a separate try/catch that logs a fixed string with the tenant id and never changes the cycle's outcome (the per-pass isolation rule of `run-tick.ts`, and `runSyncTick`'s own "deliberately NOT logging the caught value" at `run-sync.ts:647-649`). Not inside the locked write transaction: the match performs its own small reads and one `closeLead` per hit, and `closeLead` opens its own transaction (`close.ts:84-91`) — calling it from inside the sync's transaction would be the nested-transaction deadlock `close.ts:17-24` warns about. Not a new pass in the cadence tick either (D-12: it rides the sync). `SyncCycleResult` is left unchanged in this phase (adding a field changes the tick route's JSON that `tests/sync-tick-route.test.ts` reads); the count is observable through the digest line.

**Inputs and the window:** the job's `date` is set by ServiceM8 at creation to a date-only naive string (measured `"2026-10-10 00:00:00"` for a job created 05:10 UTC = 13:10 Perth) and mirrored as `quotes.date_raw` (`normalize.ts:210`, `quotes.ts:107`). The lead's call is `leads.first_missed_at` (`leads.ts:125`). Rule: let `callDate` = the calendar date of `first_missed_at` in the tenant's zone (`conn.tenantTimezone`, `DueConnection`, `for-all-tenants.ts:233-244`); a job qualifies when `date_raw`'s `YYYY-MM-DD` ∈ `[callDate, callDate + LEAD_JOB_MATCH_WINDOW_DAYS]` (both ends inclusive — at-the-boundary-is-inside, the house rule `qualify.ts:79-84`), `sm8_active`, any status (a job already won is the strongest proof of booking). Whose zone ServiceM8's `date` is in is **unmeasured** (Assumption A1); date-only granularity makes an hour's skew irrelevant except at midnight, and the error direction is one extra tradie-booked resolution, counted, never attributed.

**Match:** tier (i) mirror — `quote_contacts` of those jobs (`for-tenant` read `quoteContacts.forJobs(uuids)` selecting `mobile, phone, sm8_active`), normalised in TypeScript with `normalizeAuMobile` (never SQL string munging), compared with `lead.contact_mobile`. Tier (ii) company contacts — for candidate jobs with **no** mirror contact at all (a job the tradie created from a client record without a job contact), `GET companycontact.json?$filter=company_uuid eq '<uuid>' and active eq 1`, capped at `LEAD_JOB_MATCH_COMPANY_READS_PER_CYCLE = 10` per tenant per cycle, and only when the tenant has ≥ 1 open lead — zero reads for every tenant with no leads. D-12 holds: reads only.

**Guard and idempotency:** candidates are **open** leads with `sm8_job_state = 'none'` — a lead in `creating`/`created` is the operator's and is skipped (this is what makes the §Q3 step-4 race negligible). `closeLead(tenantId, leadId, 'booked_by_tradie', now)` is idempotent by its `status = 'open'` guard; the linkage write `leads.setMatchedJob(leadId, jobUuid)` runs in the same transaction via a `closeLeadInTx` call site of our own — so make it one function `resolveLeadBookedByTradie(tenantId, leadId, jobUuid, now)` that opens one tx, sets `sm8_job_uuid` (state stays `none`; the partial unique is scoped to `created`) and calls `closeLeadInTx`. Repeated polls find no open lead and do nothing.

**Never double-counted (D-07's last sentence):** `job_created` leads are `converted` by the tap's transaction before any sync cycle can see them; `booked_by_tradie` leads are matched only while `sm8_job_state = 'none'`. The two reasons are disjoint by construction and the digest counts each by its reason.

**Constants:** `LEAD_JOB_MATCH_WINDOW_DAYS = 14` beside the lead constants [VERIFIED pattern: src/core/leads/constants.ts:161-203] and a new `docs/commercial-assumptions.md` §16 in the §13 format (what it is / rationale / where it applies / if it changes) [VERIFIED: docs/commercial-assumptions.md:369-391].

### Q5. DONE keyword (D-08) at the inbound door

**The door's order today** [VERIFIED: src/core/messaging/inbound.ts:252-295]: `isStop = isStopMessage(body)` first (`:252`), `normalizedFrom = normalizeAuMobile(from)` once (`:257`), unnormalisable → recorded `unmatched` (`:273-290`), then `forAllTenants_cadencesByContactMobile(normalizedFrom)` (`:293`) and the three branches; the keyword rule (`isUrgentKeyword`) runs inside `handleSingleMatch` for a non-STOP lead reply only (`:325-327`). STOP from any number — including a tradie's own — is honoured on every candidate (D-03) and is not changed.

**Where DONE goes:** between `:257` and `:293` —

```ts
if (!isStop && isDoneKeyword(input.body)) {
  const done = await handleTradieDone(base, normalizedFrom, new Date());   // src/core/leads/done-keyword.ts
  if (done !== null) return done;                                           // an own number: closed, or alerted
}                                                                           // not an own number: fall through, unchanged
```
`isDoneKeyword` = whole word, case-insensitive, any surrounding text (`/(^|[^a-z])done([^a-z]|$)/i` over the trimmed body) — the `URGENT` precedent ("as a whole word anywhere", 13-CONTEXT D-06), so "DONE" and "done thanks" close; "undone" does not. **Never texts back:** the function sends nothing; the only writes are the close and the evidence row.

**Who is "the client's own number":** the text-back gate's own-number set is the never-text list (`own_line` + `never_text`) ∪ normalised `tenants.escalation_phone` ∪ divert number ∪ SMS from-number [VERIFIED: src/core/leads/text-back.ts:372-383]; D-08 names the first two. New read `forAllTenants_tenantsOwningNumber(e164)`: tenant ids from `tenant_never_text_numbers.number_e164 = $e164` (stored normalised, CHECK `^[+]61[0-9]{9}$`, `tenant-never-text.ts:41-58`) ∪ tenants whose `normalizeAuMobile(escalation_phone) === e164` (raw column, `tenants.ts:41`; normalised in TS over at most fifteen rows). That is a seventeenth `forAllTenants_*` export, which moves `tests/sync-upsert.test.ts:498`'s "exactly sixteen" pin by design — write the containment paragraph as 13-03 did.

**The lead to close:** new `latestSentLeadEscalationTo(tenantIds, toAddress, since)` in `src/db/repository/escalations.ts`: `WHERE tenant_id = ANY($ids) AND to_address = $e164 AND lead_id IS NOT NULL AND outcome = 'sent' AND sent_at >= $since ORDER BY sent_at DESC LIMIT 1` returning `{tenantId, leadId}`. `to_address` is the tradie's normalised mobile (`normalizeAuMobile(tenant?.escalationPhone)`, `escalate-hot-leads.ts:256`; the same in `ring-twice.ts:147` and `release-held.ts:194`), `lead_id` is set on lead-cadence alerts (`escalations.ts:157`), `sent_at` is NULL until the provider accepted (`:181`); a held-then-released row carries its release-time `sent_at` and `to_address` (`escalations.ts:646-698`). Add a partial index `escalations_lead_to_address_sent_idx (to_address, sent_at DESC) WHERE lead_id IS NOT NULL`. `DONE_LOOKBACK_HOURS = 48` beside the lead constants.

**Outcomes:**
- *Found:* `closeLead(tenantId, leadId, 'closed_by_tradie', now)` (the wrapper — the door is outside any transaction, `close.ts:23-24`); then the evidence row `insertInboundMessage({ ...base, tenantId, attribution: 'unmatched', matchedCadenceCount: 0, triagedAt: now })` — `InboundMessageInsert` admits `triagedAt` (`Omit<NewInboundMessage, 'id'|'receivedAt'|'createdAt'>`, [VERIFIED: src/db/repository/inbound-messages.ts:42-45]; column at `inbound-messages.ts:345`). Pre-triaged because the tradie's word is the decision and the inbox is for things a human must decide. Return `{ kind: 'done_closed', inboundId, tenantId, leadId, close: result.kind }`.
- *Not found:* the row is recorded `unmatched`, **untriaged** (it shows in the inbox with its body "DONE" and the client's name — the visible half of the alert), and one operator email goes out through `sendOperatorAlert` with a new kind `done_no_lead` (`OperatorAlertKind` is a closed union at `src/core/alerts/operator-email.ts:65`; add the arm with a fixed subject/body: client name, "a DONE arrived from <client>'s own number but no lead was escalated to it in the last 48 h"). Return `{ kind: 'done_no_lead', inboundId, tenantId }`.
- The classifier will still pick either row up (`listUnclassified` selects `label IS NULL AND attribution <> 'dead_letter'`, [VERIFIED: src/db/repository/inbound-messages.ts:458-463]) and label "DONE" in the quote vocabulary as it does any unmatched reply today — a fraction of a cent, no effect (label effects act on lead rows only, `label-effects.ts:65`). Acceptable; do not teach the classifier about DONE (its read is pinned by `tests/classification-privilege.test.ts`).

**Why the quote path is untouched:** a client's own number never carries a cadence (the gate refuses `own_number` before a lead can exist, `gate.ts:157-164`), so for every number that is not an own number the new branch is a pure `false` and the existing lookup runs exactly as before; a STOP from an own number is still a STOP. `tests/inbound-stop.test.ts` and `tests/inbound-threading.test.ts` stay byte-identical except that the latter's source-reading pin (`:616`) now also covers the DONE branch's log lines (ids only).

### Q6. Inbox row (D-09) and the digest seam

**The lead row today** [VERIFIED: src/app/(console)/inbox/page.tsx:282-297]: when `row.tenantId && row.leadId` the row renders the client name link and "· missed-call lead, no quote"; the suppress form follows for soft opt-outs (`:312-325`), then `MarkHandledForm` (`:327`). `InboundTriageRow` carries `leadId` and nothing else about the lead [VERIFIED: src/db/repository/inbound-messages.ts:225-262]. Add to the row — via a LEFT JOIN on `leads` in `listInboundNeedingTriage` (select-list only; the WHERE is pinned by `tests/inbox-authorization.test.ts`) — `leadStatus`, `leadClosedReason`, `leadSm8JobUuid`, `leadSm8JobState`, `leadSm8JobErrorKind`, `leadSm8JobAttemptCount`, and the mirror's status for the linked job (`leadJobStatus`, a second LEFT JOIN on `quotes(tenant_id, sm8_job_uuid)`). Render, in the badge strip (text first, colour second — WCAG 1.4.1, the page's own rule `:66-68`): `job created · <status>` (uuid shown short), `booked by tradie`, `closed by tradie`, `job failed · <kind>`, `creating…`. The button + confirm panel (`CreateJobForm`) renders when `leadStatus === 'open'` and `leadSm8JobState ∈ {'none','failed'}`; on `failed` the panel shows the recorded kind and attempt count and the button reads "Retry". A map, not `.replace('_',' ')`, for every new vocabulary word (`:62-68`, and `components/label-guess.ts` for the lead labels).

**The digest** [VERIFIED: src/core/aging/stalled-digest.ts:157-214, 336-349]: `buildLeadsSection(cold, held, directory, now)` is pure, tallies per tenant, sorts by client name, and emits fixed-word lines (`"${name}: ${n} cold lead replies in the last 24 h waiting in the inbox"`, `"… hot leads held overnight — released at …"`); the caller reads `countColdLeadRepliesSince(since)` and `listHeldEscalationsSince(since)` (`:336-337`). Add two inputs in the same shape — `created: {tenantId, count}[]` from `leads.sm8_job_created_at >= since`, `booked: {tenantId, count}[]` from `closed_reason = 'booked_by_tradie' AND closed_at >= since` — one new cross-tenant counting read `countLeadResolutionsSince(since)` (counts only, no ids or numbers, the `countColdLeadRepliesSince` posture, `inbound-messages.ts:565-568`) and two lines: `"${name}: ${n} ServiceM8 ${job|jobs} created from leads in the last 24 h"` and `"${name}: ${n} ${lead|leads} booked by the tradie in the last 24 h"`. `tests/lead-digest-section.test.ts` mocks the barrel's reads by name (`:19-35`) — the new read is added to that mock list.

### Q7. Migration `0041_phase14_job_creation.sql` — exact change list (12/13-RESEARCH format)

One journal entry; `when` must exceed 0040's `1791444299489` [VERIFIED: src/db/migrations/meta/_journal.json, idx 40]. Generate with `npm run db:generate`, rename the tag, hand-finish per `src/db/migrations/README.md` (every widened CHECK as `DROP CONSTRAINT IF EXISTS` then `ADD`; delete any generated statement touching the five hand-written `cadences_*` objects named in 0040's header).

**A. Columns that change nullability:** none.

**B. New columns**

| Table | Column | Notes |
|---|---|---|
| `leads` | `sm8_job_state text NOT NULL DEFAULT 'none'` | D-04 |
| `leads` | `sm8_company_uuid uuid NULL`, `sm8_job_uuid uuid NULL`, `sm8_job_contact_uuid uuid NULL` | linkage |
| `leads` | `sm8_job_error_kind text NULL`, `sm8_job_attempt_count integer NOT NULL DEFAULT 0` | retry surface |
| `leads` | `sm8_job_attempted_at timestamptz NULL`, `sm8_job_created_at timestamptz NULL`, `sm8_job_created_by uuid NULL` | timestamps + operator |

**C. CHECKs** (all plain — pre-flight: production `leads` = 0 rows (13-07 invariants `leads_total=0`), `quotes.sync_source` ∈ {backfill, poll} by the 0008 CHECK)

```sql
-- leads (DROP IF EXISTS + ADD for the two rewritten ones; the rest new)
leads_closed_reason_known            closed_reason IS NULL OR closed_reason IN ('new_enquiry','callback_request','question','existing_job','complaint','not_a_lead','already_sorted','spam','opt_out','other','touches_exhausted','expired','operator','quote_cadence_wins','booked_by_tradie','job_created','closed_by_tradie')
leads_closed_iff_reason              (status IN ('closed','expired','converted')) = (closed_reason IS NOT NULL)
leads_converted_reason               status <> 'converted' OR closed_reason IN ('booked_by_tradie','job_created')
leads_conversion_reason_only_converted  closed_reason IS NULL OR closed_reason NOT IN ('booked_by_tradie','job_created') OR status = 'converted'
leads_sm8_job_state_known            sm8_job_state IN ('none','creating','created','failed')
leads_sm8_job_error_kind_known       sm8_job_error_kind IS NULL OR sm8_job_error_kind IN ('auth_failed','rate_limited','server_error','network_error','parse_error','bad_request','connection_paused','not_connected','readback_mismatch')
leads_sm8_job_created_has_uuid       sm8_job_state <> 'created' OR sm8_job_uuid IS NOT NULL
leads_sm8_job_failed_has_kind        sm8_job_state <> 'failed' OR sm8_job_error_kind IS NOT NULL
leads_sm8_job_attempts_nonneg        sm8_job_attempt_count >= 0
-- quotes — HAND-WRITTEN (0008 idiom; invisible to drizzle), DROP IF EXISTS + ADD
quotes_sync_source_known             sync_source IN ('backfill','poll','lead')
```
Unchanged: `leads_closed_at_with_reason`, `leads_expired_reason`, `leads_contact_mobile_e164`, `leads_source_known`, `leads_status_known`.

**D. Indexes**

| Index | Definition | Purpose |
|---|---|---|
| `leads_sm8_job_created_uniq` (UNIQUE, partial) | `(tenant_id, sm8_job_uuid) WHERE sm8_job_state = 'created'` | D-04 exactly-once for our creates |
| `escalations_lead_to_address_sent_idx` (partial) | `(to_address, sent_at DESC) WHERE lead_id IS NOT NULL` | the DONE read |

Unchanged and still correct: `leads_one_open_per_mobile` (a `converted` lead exits it — a later call opens a new lead, D-12), `cadences_one_live_per_lead`, `quotes_tenant_job_uniq`.

**E. New tables:** none. **GRANT blocks:** none. **F. Data statements:** none — every new column is nullable or defaulted, so Phase 13 code meeting the 0041 schema stays legal.

**G. Repository/types that change:** `LEAD_CLOSED_REASONS` (+3), `LeadClosedReason`; `SYNC_SOURCES` (+`'lead'`); `leads.close` status mapping; new `forTenant` methods `leads.claimJobCreation`, `leads.setCompanyUuid`, `leads.setJobUuid`, `leads.setJobContactUuid`, `leads.recordJobCreated`, `leads.recordJobFailure`, `leads.listOpenForJobMatch`, `leads.resolveBookedByTradie` (or the one-tx function in core), `quotes.listActiveByDateRange`, `quoteContacts.forJobs`; new barrel exports `latestSentLeadEscalationTo`, `forAllTenants_tenantsOwningNumber`, `countLeadResolutionsSince`; `InboundTriageRow` (+ lead linkage fields); `Sm8Client` (+`post`, `getOne`); `OperatorAlertKind` (+`done_no_lead`). Pins to move by design: `tests/sync-upsert.test.ts:498` (sixteen → seventeen), `tests/rls-coverage.test.ts:722-736` (add the new `leads_*` CHECK names), `tests/lead-digest-section.test.ts:19-35` (the mocked read list), `tests/lint-ban.test.ts` if it pins the barrel's export list.

**Push protocol** (13-07 precedent, verbatim in effect): read-only pre-flight (`npm run lead-cadence:invariants` → `leads_total=0`; `cron:status` → lease rows 0, no watchdog) → `db:generate` reports no schema drift → **`npm run db:migrate`** (the agent permission classifier refused it in both sessions of 13-07; the plan's step says the founder runs it by hand and reports `42 entries, exit 0`) → a second run is a no-op at 42 → read-back of the new columns/CHECKs → only then `git push origin main` (schema before code) → CI → Vercel Ready → evidence entry in `docs/external-registrations.md`. Over the session connection (5432), never the pooler (`README.md:6-9`).

### Q8. Test plan

**How existing suites fake ServiceM8 reads** [VERIFIED: tests/sync-upsert.test.ts:38-57]: a `stubClient(jobs, contacts, onRequest?)` object implementing `Sm8Client.get` from in-memory rows, injected through `runSyncForConnection(conn, { clientFactory })` (`run-sync.ts:122-128`); fixtures are the sanitised live pages in `tests/fixtures/sm8/{job,jobcontact}.json`. Reuse: extend the stub type to the widened `Sm8Client` (`post`, `getOne`) in a shared `tests/helpers/sm8-stub.ts` — an in-memory ServiceM8 that mints `x-record-uuid`-style ids, stores rows, answers `getOne`, filters `$filter=job_uuid eq …` / `mobile eq …` / `company_uuid eq …` by exact spelling (as measured), and can be told to fail the N-th call with a given HTTP status.

**Pure (local, seconds):**
- `tests/sm8-client-write.test.ts` — `vi.stubGlobal('fetch', …)`: `post()` sends `X-API-Key`, `Content-Type: application/json`, the serialised body, to `…/job.json`; reads `x-record-uuid`; `{errorCode: 0}` and `{errorCode: "0"}` both ok; 400 → `bad_request` with `detail` = status only (assert the body's `message` never appears); 401 → `auth_failed`; 429 → `rate_limited`; a thrown fetch → `network_error` carrying `e.name` only; `getOne()` accepts an object and rejects an array. Source pin: `client.ts` contains no `String(e)` and no `res.text()` in a returned detail (the existing T-2-02 discipline).
- `tests/sm8-schemas.test.ts` extended: the measured job read-back (ledger #7, with `errorCode` numeric, `quote_sent: false`, `total_invoice_amount: "0.0000"`, `generated_job_id: "7"`) parses through `sm8Job`; the measured jobcontact (#10) and companycontact (#4) parse; `sm8JobCreate.strict()` rejects an unknown field.
- `tests/lead-job-description.test.ts` — deterministic builder: same inputs → byte-identical output; verbatim bodies in `received_at` order, each on its own line; suburb and urgency lines only when present; the fixed "Created by Backdesk from a missed call on <d MMM yyyy, Australia/Perth>" note; no model text can enter (the builder takes only `string[]` bodies and typed facts).
- `tests/lead-job-match.test.ts` — the window: call date D; job `date_raw` D → match; D+14 → match; D+15 → no; D−1 → no; the Perth date of a 23:30 AWST call vs a UTC-rolled job date; `0491 570 999` vs `+61491570999` vs `0491570999` all match the lead's `+614…`; a `sm8_active = false` job never matches; a lead in `creating` is skipped.
- `tests/done-keyword.test.ts` — `isDoneKeyword`: `DONE`, `done`, `Done thanks`, `all done.` match; `undone`, `DONEish`, `` (empty) do not; STOP-shaped bodies never reach it (asserted at the door test).
- `tests/lead-job-create.test.ts` — the orchestration as a pure function over the in-memory ServiceM8 stub and an in-memory `LeadJobStore` port: happy path makes exactly 1 company, 1 companycontact, 1 job, 1 jobcontact and reads each back; **three partial failures** — (a) company created then `POST job` 500 → state `failed/server_error`, `sm8_company_uuid` persisted; retry makes **no** second company (GET company only), creates the job; (b) job created then `POST jobcontact` fails → `sm8_job_uuid` persisted; retry GETs the job, lists its contacts, creates the contact, never a second job; (c) `POST job` 200 with no `x-record-uuid` → `readback_mismatch`; retry adopts the job via the company+description filter; also the mirror-match tier (a `quote_contacts` row with the lead's mobile → no companycontact filter call, no company create), the 3-spelling filter tier, `connection_paused`, `not_connected`, and the "fewer than one inbound reply" refusal.
- `tests/attribution-lead-born.test.ts` (pure, beside `attribution-decide`): a `won` on a quote linked to a `created` lead is `unqualified/lead_born` even with qualifying touches; the touch-0 pin in `tests/attribution-qualify.test.ts` is untouched.

**DB-backed (CI only; never `test:remote`):**
- `tests/lead-job-create-db.test.ts` — seeds (`seedTenant`, `seedConnection` with a real ciphertext via `encryptCredential`, `seedLead`, `seedLeadCadence`, `seedInbound` with `leadId`): the **double tap** — two concurrent `createJobForLead` calls against the stub → exactly one `created`, one `already_in_progress`, one `POST job` on the stub; the unit of work — `quotes` row `sync_source='lead'`, `chase_eligibility='needs_review'`, `quote_contacts` row with the caller's mobile, lead `converted/job_created`, cadence `stopped/lead_closed`, touches `cadence_stopped`; then **`runSyncForConnection` with the stub returning that job** → `events_emitted = 0`, `chase_eligibility` still `needs_review`, `sync_source` still `'lead'` (Pitfall 1); then the stub flips the job to `Work Order` → one `won` event → the attribution consumer records it unqualified `lead_born`; a `failed` lead shows the kind on `listInboundNeedingTriage`'s row; a retry after `failed` succeeds and the partial unique holds (`INSERT` of a second `created` lead with the same job uuid → 23505).
- `tests/lead-booked-by-tradie.test.ts` — seed an open lead at D, mirror quotes with `date_raw` D+3 and a `quote_contacts` row carrying the caller's mobile in local spaced form → after `runSyncForConnection` (stub) the lead is `converted/booked_by_tradie`, `sm8_job_uuid` set, cadence stopped; a second cycle changes nothing; a lead in `creating` is untouched; a job dated D+15 does not resolve; the companycontact tier is exercised with a stub `GET companycontact.json?$filter=company_uuid …`.
- `tests/lead-done-keyword.test.ts` — seed a tenant with `escalation_phone` and an `own_line` never-text number, a lead + cadence, and an `escalations` row (`to_address` = the own e164, `lead_id`, `outcome='sent'`, `sent_at` now−1 h): `handleInboundSms({from: ownNumber, body: 'DONE'})` → `done_closed`, lead `closed/closed_by_tradie`, cadence stopped, inbound row `triaged_at` set; `sent_at` now−49 h → `done_no_lead`, nothing closed, row untriaged, alert spy called once; a stranger's "DONE" → `reply_unmatched` exactly as before; `STOP` from the own number → the existing STOP path (`stop_unmatched`), DONE never consulted; lowercase `done`.
- `tests/rls-coverage.test.ts` — the new CHECK names and the partial unique.

**Suites that must stay byte-identical** (D-13): `sync-upsert`, `sync-cursor`, `sync-failure-alerts`, `sync-health`, `sync-tick-budget`, `sync-tick-route`, `quote-events`, `connect-servicem8`, every `cadence-*`, `attribution-{baseline,consume,consume-isolation,decide,qualify,wedge-section}`, `inbound-stop`, `inbound-threading` (its source pin still passes), `lead-close`, `lead-label-effects`, `escalation-*`. Two pins move **by design** with a containment paragraph: `sync-upsert.test.ts:498` (sixteen → seventeen `forAllTenants_*`) and `rls-coverage` (new names).

**Gaps a green suite would not catch — name them in the plan:**
1. The live `$filter` on `companycontact.json` with a `+61…` spelling is unmeasured (only `04xx xxx xxx` and digits-only were) — a wave-0 one-call probe, or accept that tier (ii) may miss a `+61`-spelled contact and fall to tier (iii).
2. ServiceM8's `date` zone (A1) — only observable near midnight; the error direction is benign.
3. Client-supplied `uuid` on POST (A2) — if the plan wants it, a 4-call wave-0 probe (create with uuid, read, mark Unsuccessful, delete).

### Anti-Patterns to Avoid
- **Widening `Sm8FailureKind` for the write path.** `applyFailurePolicy` switches on it for the sync; a new member there is a policy change for reads. Keep `Sm8WriteFailureKind` separate.
- **A second blind POST on retry.** Measured: ServiceM8 creates a duplicate job for an identical body (ledger #15). Every retry step starts with a GET/filter on the persisted uuid or the deterministic description.
- **Keying the attribution exclusion on `quotes.sync_source`.** The upsert overwrites it (`for-tenant.ts:2758`); key on the lead linkage.
- **Running `closeLead` inside the sync's write transaction.** Nested transaction on the same cadence row — the deadlock `close.ts:17-24` describes.
- **Trusting a posted description or operator id.** Rebuild the description from the DB; take `created_by` from `requireOperatorId()`.
- **Logging the ServiceM8 400 `message`.** It is a response body (T-2-02); map to the kind and keep the status.
- **Letting the classifier learn DONE.** Its read is privilege-pinned; the door decides, as with STOP.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Mobile comparison | SQL `replace()` chains over `quote_contacts.mobile` | `normalizeAuMobile` in TS [VERIFIED: primary-contact.ts:129-141] | It refuses the ambiguous `412345678` case deliberately; SQL would guess |
| Closing a lead | A new UPDATE on `leads` | `closeLeadInTx` / `closeLead` [VERIFIED: close.ts:51-91] | Stops the cadence, skips touches, guards idempotence — one implementation |
| Mirror writes | A hand INSERT into `quotes` | `tx.quotes.upsertManyReturning` + `tx.quoteContacts.upsertMany` | The conflict set and the `chase_eligibility` rule live there |
| Operator authorization | A session check | `requireOperatorId()` [VERIFIED: _auth.ts:73-86] | Allowlist read through the operator's own JWT |
| Timestamp interpretation | `new Date(raw)` | `normalizeJob` / `sm8ToUtc` [VERIFIED: normalize.ts:87-120] | Zero-dates and UTC interpretation handled once |
| Exactly-once | In-memory flags, `SELECT` then `UPDATE` | Guarded `UPDATE … WHERE sm8_job_state IN ('none','failed') RETURNING` + partial unique | Postgres arbitrates two taps; an app check cannot |

**Key insight:** every guarantee this phase adds is the same shape as one the repo already has — claim-then-act (`escalations`), verify-before-write (`connect.ts`), one-live-per-lead (partial unique). Copy the shapes, not the idea.

## Runtime State Inventory

Not a rename/refactor phase — omitted. (The one runtime fact that matters is recorded in the Spike ledger: the test tenant's sync connection is live.)

## Common Pitfalls

### Pitfall 1: the next poll turns `sync_source = 'lead'` into `'poll'`
**What goes wrong:** the upsert's conflict set assigns `excluded.sync_source` [VERIFIED: for-tenant.ts:2758]; after the first 5-minute cycle the provenance is gone and any rule written as `WHERE sync_source = 'lead'` silently stops matching.
**How to avoid:** keep `'lead'` sticky in the conflict set (`CASE WHEN quotes.sync_source = 'lead' THEN 'lead' ELSE excluded.sync_source END`) — observable by no existing row — and key the D-06 exclusion on the lead linkage. Pin both in `lead-job-create-db.test.ts`.

### Pitfall 2: the Company has no mobile
**What goes wrong:** code written from FEATURES §7 / D-02 ("company matched by mobile") filters `company.json` by `mobile` and gets a 400 or an empty list forever.
**Why:** measured — `company.json` returns `name, abn_number, address…, fax_number, …` and no phone/mobile/email (ledger #2; docs agree [CITED: listclients.md]). The mobile is on `companycontact.json` / `jobcontact.json`.
**How to avoid:** §Q3's three tiers; always create a `companycontact` beside a new company.

### Pitfall 3: `$filter` is exact-spelling
**What goes wrong:** `mobile eq '0491570999'` finds nothing for a contact stored `0491 570 999` (ledger #4/#5).
**How to avoid:** match in the mirror with `normalizeAuMobile` first; query the three common spellings only as the fallback; write the local spaced form so our own contacts are findable.

### Pitfall 4: a 200 is not a job until it is read back
**What goes wrong:** trusting `{"errorCode":0}` and a header; a missing header (never seen, but unguarded) or a status coerced by ServiceM8 would put a phantom row in the mirror.
**How to avoid:** D-03 literally — `GET job/{uuid}` and compare `status`, `active`, `company_uuid`; `readback_mismatch` otherwise.

### Pitfall 5: the sync's inactive-first-sight branch emits for a Quote
**What goes wrong:** `classifyTransition(null, 'Quote', false)` returns `quote_opened` and `run-sync.ts:503` lets it through when `prev` is undefined — a deleted Quote job seen for the first time would emit (the comment at `:486-490` describes `removed` only).
**Why it matters here:** it is the exact mechanism SM8-02 defends against, and it is why the spike set its jobs to `Unsuccessful` before deleting them (0 events on the 05:15 tick). Not a Phase 14 change (D-13) — note it for the pre-insert's test, which must assert `events_emitted = 0`.

### Pitfall 6: the inbox hides the lead once it is "handled"
**What goes wrong:** the operator marks the reply handled first, the row disappears, and there is no other surface to create the job from until Phase 15.
**How to avoid:** order the controls (create job above mark handled), say so in the panel copy, and let the lead's "job created" chip appear on later rows of the same lead.

### Pitfall 7: a repeat call after conversion opens a new lead and a new text-back
**What goes wrong:** `converted` exits `leads_one_open_per_mobile`; the lead-born job sits at `needs_review` with no quote cadence, so the Phase 12 `quote_open` fact is false and the caller gets "sorry we missed your call" again the day after their job was created.
**How to avoid:** out of scope to change the gate (D-13); record it as Open Question 4 with the v1.2 default (accept; the operator sees both rows) and a Phase 15 candidate (a `recent_conversion` skip).

### Pitfall 8: hand-written CHECK is invisible to the generator
**What goes wrong:** `drizzle-kit generate` emits nothing for `quotes_sync_source_known`; the migration ships without the widening and the first `'lead'` insert raises 23514 in production.
**How to avoid:** hand-write the 0008 idiom in 0041 and pin `'lead'` acceptance in `rls-coverage` by reading the constraint definition.

## Code Examples

### 1. `post()` on the client (transport only; the T-2-02 rules kept)
```ts
// src/core/servicem8/client.ts — beside get()
async function post(resource: string, body: Record<string, unknown>) {
  const url = `${BASE}/${endpointPath(resource)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'X-API-Key': auth.key, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : 'UnknownError';
    return { ok: false as const, kind: 'network_error' as const, detail: `fetch failed (${name})` };
  }
  if (!res.ok) return classifyWrite(res.status);          // 401/403 auth_failed · 429 rate_limited · 400/404/422 bad_request · else server_error; status only
  let parsed: unknown;
  try { parsed = await res.json(); } catch { return { ok: false as const, kind: 'parse_error' as const, status: res.status, detail: 'response was not JSON' }; }
  if (!sm8WriteResult.safeParse(parsed).success) return { ok: false as const, kind: 'parse_error' as const, status: res.status, detail: `unexpected write envelope from ${resource}` };
  return { ok: true as const, data: { uuid: res.headers.get('x-record-uuid'), headers: res.headers } };
}
```
Measured request/response (ledger #6/#7): `POST job.json` `{"status":"Quote","company_uuid":"01a12438-2033-…","job_description":"BACKDESK SPIKE …"}` → `200`, `x-record-uuid: 01a12438-259d-7bb1-957a-334257f778ab`, body `{"errorCode":0,"message":"OK"}`; `GET job/01a12438-259d-….json` → `{"uuid":…,"active":1,"date":"2026-10-10 00:00:00","status":"Quote","quote_date":"2026-10-10 05:10:21","edit_date":"2026-10-10 05:10:21","generated_job_id":"7","company_uuid":"01a12438-2033-…","quote_sent":false,"total_invoice_amount":"0.0000","job_address":"",…}`.

### 2. The claim (the double-tap arbiter)
```ts
// for-tenant.ts, leads namespace
claimJobCreation: (leadId: string, at: Date) =>
  db.update(leads)
    .set({ sm8JobState: 'creating', sm8JobAttemptCount: sql`${leads.sm8JobAttemptCount} + 1`, sm8JobAttemptedAt: at, sm8JobErrorKind: null, updatedAt: at })
    .where(and(eq(leads.tenantId, tenantId), eq(leads.id, leadId), eq(leads.status, 'open'), inArray(leads.sm8JobState, ['none', 'failed'])))
    .returning({ id: leads.id, sm8CompanyUuid: leads.sm8CompanyUuid, sm8JobUuid: leads.sm8JobUuid, sm8JobContactUuid: leads.sm8JobContactUuid }),
```

### 3. The unit of work (step 4 of §Q3)
```ts
await forTenant(tenantId).transaction(async (tx) => {
  await tx.quotes.upsertManyReturning([{ ...normalizeJob(jobReadback, SM8_TIMESTAMP_ZONE), syncSource: 'lead', chaseEligibility: 'needs_review' }]);
  await tx.quoteContacts.upsertMany([normalizeContact(contactReadback)]);
  const linked = await tx.leads.recordJobCreated(leadId, { jobUuid, contactUuid, createdBy: operatorUserId, at: now }); // WHERE sm8_job_state = 'creating'
  if (linked.length === 0) throw new LeadNoLongerCreating();            // caught above → failed/readback_mismatch, uuids kept
  const closed = await closeLeadInTx(tx, leadId, 'job_created', now);   // already_closed is an anomaly here; log the kind, never throw
});
```

### 4. The DONE branch at the door (between `inbound.ts:257` and `:293`)
```ts
if (!isStop && isDoneKeyword(input.body)) {
  const done = await handleTradieDone(base, normalizedFrom, new Date());
  if (done !== null) return done;       // own number: 'done_closed' | 'done_no_lead'; a stranger's DONE falls through
}
```

### 5. The auto-resolution hook (post-commit in `runSyncForConnection`)
```ts
const written = await repo.transaction(async (tx) => { /* unchanged */ });
try {
  await resolveLeadsBookedByTradie(conn.tenantId, { client, tenantTimezone: conn.tenantTimezone, now });
} catch {
  console.error(`[sync] lead job match failed for tenant ${conn.tenantId}.`);   // fixed string, ids only
}
return { /* unchanged result */ };
```

## Spike ledger (D-11) — test account only, 2026-10-10 05:10:20–05:10:25 UTC, 24 of 25 calls

Pre-flight (read-only, hosted DB): `SM8_TEST_API_KEY` present and **identical** to the test tenant's decrypted `sm8_connections` key (compared in-process, never printed); tenant `Perth Sparks Electrical (Test)` / `Australia/Perth`; **`sm8_connections.paused_at = null`** (sync live, `last_success_at` 05:05:00 UTC, job cursor `2026-08-26 08:21:02`); `cadence_settings.paused_at = 2026-09-13` (messaging paused); no `text_back` row; 0 `quotes` rows mentioning BACKDESK SPIKE. The brief's premise "the test tenant is paused and its sync may be disabled" held only for messaging — **the sync was not disabled**. The spike was therefore started 20 s after the 05:10:00 tick and finished 4 min 35 s before the next; every job was set to `Unsuccessful` before `DELETE` so a first sight would emit nothing.

| # | Call | Status | ms | Result |
|---|---|---|---|---|
| 1 | `POST company.json` `{"name":"BACKDESK SPIKE Pty Ltd"}` | 200 | 609 | `x-record-uuid: 01a12438-2033-7bb1-957b-3d868b711fcb`; body `{"errorCode":0,"message":"OK"}` |
| 2 | `GET company/{1}.json` | 200 | 437 | single object; `active: 1`, `is_individual: 0`, `edit_date "2026-10-10 05:10:20"`; **no mobile/phone/email fields** |
| 3 | `POST companycontact.json` `{company_uuid, first:"BACKDESK", last:"SPIKE", mobile:"0491 570 999", type:"JOB", is_primary_contact:"1"}` | 200 | 323 | uuid `01a12438-232f-7bb1-957b-c635a0fac47b` |
| 4 | `GET companycontact.json?$filter=mobile eq '0491 570 999'` | 200 | 202 | **1** match: `{uuid: …232f…, company_uuid: …2033…, mobile: "0491 570 999", active: 1, type: "BILLING"}` — note `type` came back `BILLING` for the primary contact |
| 5 | same with `'0491570999'` | 200 | 119 | **0** matches — exact spelling only |
| 6 | `POST job.json` `{"status":"Quote","company_uuid":…2033…,"job_description":"BACKDESK SPIKE — research spike, delete me"}` | 200 | 331 | uuid `01a12438-259d-7bb1-957a-334257f778ab` |
| 7 | `GET job/{6}.json` (immediately) | 200 | 143 | `status: "Quote"` persisted; `active: 1`; `date "2026-10-10 00:00:00"`; `quote_date` and `edit_date "2026-10-10 05:10:21"`; `generated_job_id "7"`; `job_address ""`; `category_uuid ""`; `quote_sent: false`; `total_invoice_amount "0.0000"`; `x-platform-date-utc: 2026-10-10 05:10:22` (UTC, consistent with A3) |
| 8 | `GET jobcontact.json?$filter=job_uuid eq '{6}'` | 200 | 171 | **0** — ServiceM8 auto-creates no job contact for an API-created job |
| 9 | `POST jobcontact.json` `{job_uuid, first:"BACKDESK", last:"SPIKE", mobile:"0491 570 999", type:"JOB"}` | 200 | 231 | uuid `01a12438-2832-7bb1-957b-91e78978beeb` |
| 10 | `GET jobcontact/{9}.json` | 200 | 141 | `type: "JOB"`, `mobile "0491 570 999"`, `active: 1`, `edit_date "2026-10-10 05:10:22"` |
| 11 | `GET job/{6}.json` again | 200 | 210 | `edit_date` bumped `05:10:21 → 05:10:22` by the contact create |
| 12 | `POST job.json` with `company_uuid` all-zeros | **400** | 163 | `{"errorCode":400,"message":"company_uuid record does not exist","documentation":"…llms.txt…"}` — nothing created |
| 13 | `POST job.json` `{"status":"Bogus"}` | **400** | 234 | `{"errorCode":400,"message":"Job status is not valid",…}` |
| 14 | `POST jobcontact.json` without `job_uuid` | **400** | 156 | `{"errorCode":400,"message":"job_uuid is not a valid uuid",…}` |
| 15 | `POST job.json` identical to #6 | 200 | 355 | **a second job** `01a12438-2cc6-7bb1-957b-074e89246b4b` — no dedupe |
| 16 | `POST job/{6}.json` `{"status":"Unsuccessful"}` | 200 | 390 | update verb works; header echoes the uuid |
| 17 | `DELETE job/{6}.json` | 200 | 200 | `{"errorCode":0,"message":"OK"}` |
| 18 | `POST job/{15}.json` `{"status":"Unsuccessful"}` | 200 | 166 | |
| 19 | `DELETE job/{15}.json` | 200 | 202 | |
| 20 | `GET job/{6}.json` after delete | **200** | 127 | `active: 0`, `status: "Unsuccessful"`, `unsuccessful_date "2026-10-10 05:10:24"`, `edit_date "2026-10-10 05:10:24"` — soft delete, still readable (not 404) |
| 21 | `DELETE jobcontact/{9}.json` | 200 | 199 | |
| 22 | `DELETE companycontact/{3}.json` | 200 | 179 | |
| 23 | `DELETE company/{1}.json` | 200 | 187 | |
| 24 | `GET company/{1}.json` after delete | 200 | 146 | `active: 0`, `edit_date "2026-10-10 05:10:25"` |

Not triggered: 401 (key valid), 429 (24 calls in 6 s is far below 180/min), 409 (none exists in the docs), 404 on GET (the deleted record returned 200). Nothing was written to any other account; no Backdesk table was written by the spike script.

**Final state of every spike object in ServiceM8:** company `01a12438-2033-7bb1-957b-3d868b711fcb` active 0; companycontact `01a12438-232f-7bb1-957b-c635a0fac47b` active 0; job `01a12438-259d-7bb1-957a-334257f778ab` Unsuccessful, active 0; job `01a12438-2cc6-7bb1-957b-074e89246b4b` Unsuccessful, active 0; jobcontact `01a12438-2832-7bb1-957b-91e78978beeb` active 0. All cleaned, same session.

**Sync safety check (the 05:15:00 tick, read-only post-check at 05:15:45):** `sync_runs` for the tenant: `jobs_fetched 7, jobs_upserted 7, contacts_fetched 2, events_emitted 0` (the previous two cycles fetched 5/1). **Two spike rows landed in production `quotes`** — `f427525f-fb48-4f08-b98a-6bf8829bef86` (job …259d…) and `481527b3-b1db-4206-a612-6163c18b407c` (job …2cc6…), both `status 'Unsuccessful'`, `sm8_active false`, `chase_eligibility 'eligible'` (the poll path's insert default), `sync_source 'poll'`, `date_raw '2026-10-10 00:00:00'` — and **one in `quote_contacts`** (`13b0ca26-19b5-44ce-8ef6-b9003bf48d30`, `sm8_active false`, first/last BACKDESK/SPIKE). `quote_status_events` for them: **0**. `cadences`: **0**. The job/contact cursors advanced to `2026-10-10 05:10:25`. **Per the brief I stopped and did not delete them.** They are inert (inactive, lost, no event, no cadence, fiction-block mobile); the founder can delete the three rows by id or leave them. Lesson for the plan: any future ServiceM8 write probe must assume the test tenant's sync is live and use the same Unsuccessful-then-delete protocol.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ServiceM8 write semantics assumed (ARCHITECTURE §5.2 "LOW confidence") | Measured: header uuid, soft delete, exact-spelling filter, no Company mobile, no server dedupe | this session | The plan writes against facts; two design corrections (company contact, sticky `sync_source`) |
| "Company matched by mobile" | Company **contact** matched by mobile; mirror first | this session | API-free match in the common case |
| `converted` carries no reason (`leads.ts:85-87`) | `converted` carries `booked_by_tradie` / `job_created`; CHECK rewritten | Phase 14 | One column, no `converted_reason` |

**Deprecated/outdated:** the docs' `errorCode: "0"` string — the wire carries a number; `is_primary_contact` on JobContact is deprecated upstream and is not written (JobContact `type` is the selector, `schemas.ts:105`); on CompanyContact `is_primary_contact: '1'` is still live and is what makes the client record's contact primary.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | ServiceM8's job `date` is a calendar date in the account's local zone (measured only on a day where UTC and Perth agree) | Q4 | A job created 00:00–08:00 AWST could fall one day outside the window; count-only, no dollars |
| A2 | A client-supplied `uuid` (v4) in the POST body is accepted and returned (docs say optional, generated if omitted; not measured; ServiceM8 mints `01a1…` time-ordered ids) | Q1 alternatives, Q3 | If the plan relies on it without the 4-call probe, creates could 400 |
| A3 | `$filter=mobile eq '+61491570999'` behaves like the two measured spellings (exact) | Q3 tier (ii) | A `+61`-spelled contact is missed and a duplicate client record is created (recoverable in ServiceM8) |
| A4 | `GET job/{uuid}` for a uuid that never existed returns 404 (docs); only the deleted-record case (200) was measured | Q1 | The adopt step may see `bad_request` instead of a clean miss; both are handled as "not ours" |
| A5 | The CompanyContact `type` coercion to `BILLING` for the primary contact is ServiceM8 behaviour, not an artefact of `is_primary_contact: '1'` | Spike #4 | Only matters if a later read filters company contacts by `type = 'JOB'` — do not |

## Open Questions

1. **Does the confirm sheet require a company name?** — What we know: `name` is the only required Company field (max 100) and `leads` has no name column (`contact_name` lives on `cadences`). Recommendation: required, prefilled from `cadences.contact_name` when present, placeholder "Caller 0491 570 999"-style guidance; tier (i)/(ii) matches reuse the existing company and ignore the typed name. **(RESOLVED — planner default: required field, prefilled.)**
2. **Header uuid or client-supplied uuid as the idempotency key?** — Header is measured; supplied is not (A2). Recommendation: header + persisted-uuid-per-step + adopt-by-description as designed; offer the 4-call wave-0 probe as an optional task, and if it passes, persist a pre-generated uuid before the POST as an extra belt. **(RESOLVED — header path is the plan; probe optional.)**
3. **Should the sync's `SyncCycleResult` report `leadsResolved`?** — It would change the tick route's JSON that `tests/sync-tick-route.test.ts` reads. Recommendation: no result change in v1.2; the digest line is the count. **(RESOLVED.)**
4. **Repeat call after conversion re-texts the caller (Pitfall 7).** Recommendation: accept in v1.2; record a Phase 15 candidate `recent_conversion` gate skip in STATE.md. **(RESOLVED.)**
5. **Whole-word DONE anywhere, or the whole body?** — D-08 says whole-word; URGENT's precedent is anywhere. Recommendation: anywhere, pinned by `done-keyword.test.ts`. **(RESOLVED.)**
6. **Delete the three spike rows in production?** — The brief says stop and report. Recommendation: founder deletes `quotes` `f427525f-…`, `481527b3-…` and `quote_contacts` `13b0ca26-…` by id (or leaves them; inert either way). **(RESOLVED — founder's call, outside the plan.)**

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | scripts, tests | ✓ | 22.20.0 | — |
| ServiceM8 test account + private key | wave-0 probes, `verify:sm8-connect` | ✓ | key present in the local env, equals the test tenant's connection | docs-only |
| Hosted Supabase (Sydney) | migration 0041 push, DB-backed CI suites | ✓ | reachable (read-only probes this session) | — |
| Vercel production | deploy after push | ✓ (13-07) | — | — |
| ClickSend / Twilio | not touched by this phase | n/a | — | — |

**Missing dependencies with no fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (`tests/**/*.test.ts`, `setupFiles: tests/helpers/env.ts`, `fileParallelism: false`) [VERIFIED: vitest.config.ts] |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/sm8-client-write.test.ts tests/lead-job-create.test.ts tests/lead-job-match.test.ts tests/done-keyword.test.ts` (pure, local) |
| Full suite command | `npm test` locally (pure suites; DB suites skip without a disposable stack); the DB-backed suites run in CI only — never `npm run test:remote` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SM8-01 | POST path builds the request, reads `x-record-uuid`, maps errors, reads back | unit | `npx vitest run tests/sm8-client-write.test.ts tests/sm8-schemas.test.ts` | ❌ Wave 0 (schemas file exists) |
| SM8-01 | Job shape: Quote, verbatim description, company matched/created, contact | unit + DB | `npx vitest run tests/lead-job-create.test.ts` / CI `tests/lead-job-create-db.test.ts` | ❌ Wave 0 |
| SM8-02 | Pre-inserted row → sync emits nothing; `needs_review` and `'lead'` survive the poll | DB (CI) | `tests/lead-job-create-db.test.ts` | ❌ Wave 0 |
| SM8-03 | Double tap → one job; three partial failures reconcile by uuid; kind recorded | unit + DB | `tests/lead-job-create.test.ts`, `tests/lead-job-create-db.test.ts` | ❌ Wave 0 |
| LEAD-04 | 14-day match window + normalisation; `booked_by_tradie`; DONE closes / alerts | unit + DB | `tests/lead-job-match.test.ts`, `tests/done-keyword.test.ts`, CI `tests/lead-booked-by-tradie.test.ts`, `tests/lead-done-keyword.test.ts` | ❌ Wave 0 |
| D-06 | Lead-born `won` is unqualified | unit | `tests/attribution-lead-born.test.ts` | ❌ Wave 0 |
| D-13 | Quote suites byte-identical | existing | `npm test` | ✅ |

### Sampling Rate
- **Per task commit:** the quick run command above plus `npm run typecheck` and `npm run lint`.
- **Per wave merge:** `npm test` locally; the phase CI branch for the DB suites (13-07's `ci/phase-13-final` precedent).
- **Phase gate:** CI green on the final commit before `db:migrate` + push; `/gsd-verify-work` after deploy.

### Wave 0 Gaps
- [ ] `tests/helpers/sm8-stub.ts` — in-memory ServiceM8 with `get`/`getOne`/`post`, exact-spelling filters, fail-the-Nth-call
- [ ] `tests/sm8-client-write.test.ts`, `tests/lead-job-description.test.ts`, `tests/lead-job-match.test.ts`, `tests/done-keyword.test.ts`, `tests/lead-job-create.test.ts`, `tests/attribution-lead-born.test.ts` (pure)
- [ ] `tests/lead-job-create-db.test.ts`, `tests/lead-booked-by-tradie.test.ts`, `tests/lead-done-keyword.test.ts` (DB, CI)
- [ ] seed knobs: `seedLead` overrides already accept the linkage columns once 0041 lands (plain insert, `seed.ts:726-748`); add `seedEscalationSent(tenantId, {leadId, toAddress, sentAt})`
- [ ] optional wave-0 probes (test account, ≤ 5 calls, Unsuccessful-then-delete): client-supplied uuid (A2); `+61` filter spelling (A3)

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase session + operator allowlist via `requireOperatorId()` before the body is read |
| V3 Session Management | no change | — |
| V4 Access Control | yes | Tenant in every predicate; the lead id is matched with `tenant_id`; `created_by` from the verified claim, never the form |
| V5 Input Validation | yes | zod on the form (`company_name` ≤ 100, names, suburb), uuid regex on `lead_id`; zod `.strict()` request schemas; `sm8Job`/`sm8JobContact` on every read-back; `$filter` values built only from a CHECK-validated E.164 and single-quoted; uuids validated before entering a URL path |
| V6 Cryptography | yes | `decryptCredential` in-process as `run-sync.ts:425-427`; the key never enters a log, a result or a thrown error (`client.ts:1-18`) |
| V7 Error handling & logging | yes | Fixed sentences to the console; ids and closed-vocabulary kinds in logs; never a ServiceM8 `message`, a number or a body (T-2-02, T-4-02) |
| V8 Data protection | yes | The description carries a caller's words into the tradie's own ServiceM8 — the client is the controller; the note names Backdesk as the source (PITFALLS §5.5) |

### Known Threat Patterns for this phase
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Forged Server Action POST creates jobs in a client's ServiceM8 | Spoofing / Elevation | Operator gate first; lead must be open with ≥ 1 reply; tenant-scoped claim |
| Double submit / two tabs create two jobs | Tampering | DB claim + partial unique; ServiceM8 has no dedupe (measured) |
| Credential leak through a thrown `fetch` or a logged response | Information disclosure | Never-throw client; status-only details; no body in logs |
| Injection into `$filter` | Tampering | Only normalised digits/`+`/space from a CHECK-validated column; quoted |
| A stranger texts "DONE" to close someone's lead | Spoofing | DONE acts only for a number on a client's own-number set **and** only on the lead most recently escalated to that number; otherwise an ordinary reply |
| Classifier output gains an effect | Elevation (AI-03) | The door decides DONE deterministically; the classifier's read is untouched |

## Sources

### Primary (HIGH confidence)
- Live ServiceM8 API, test account, 2026-10-10 05:10 UTC — 24 calls (Spike ledger; raw ledger at the session scratchpad `spike-ledger.json`)
- Hosted Supabase read-only probes (pre-flight 05:09, post-check 05:15:45 UTC)
- In-repo files read this session: `src/core/servicem8/{client,types,schemas,normalize,pagination}.ts`; `src/core/sync/{run-sync,connect,transitions,eligibility}.ts`; `src/db/schema/{quotes,quote-contacts,leads,tenant-never-text,escalations,sm8-connections,inbound-messages,tenants}.ts`; `src/db/repository/{for-tenant,for-all-tenants,escalations,inbound-messages}.ts`; `src/core/leads/{close,label-effects,constants,gate,never-text,text-back}.ts`; `src/core/messaging/inbound.ts`; `src/core/attribution/{qualify,consume-wins}.ts`; `src/core/escalation/escalate-hot-leads.ts`; `src/core/aging/stalled-digest.ts`; `src/core/alerts/operator-email.ts`; `src/app/(console)/{_auth.ts,inbox/*,clients/[id]/actions.ts,clients/[id]/quotes/[quoteId]/actions.ts}`; `src/db/migrations/{0008,0039,0040}*.sql`, `meta/_journal.json`, `README.md`; `tests/{sync-upsert,lead-close,lead-digest-section,rls-coverage,lint-ban,inbound-threading}.test.ts`, `tests/helpers/{env,seed,global-setup}.ts`, `vitest.config.ts`; `scripts/{sm8-spike.mjs,lib/support.mjs,lib/ts-alias-hook.mjs}`; `docs/{servicem8-api-notes,external-registrations,env-vars,commercial-assumptions}.md`; `.planning/phases/13-*/{13-CONTEXT,13-RESEARCH,13-REVIEW,13-02/03/04/07-SUMMARY}.md`; `.planning/research/{FEATURES,PITFALLS,ARCHITECTURE,SUMMARY}.md`

### Secondary (MEDIUM confidence — official docs, fetched)
- developer.servicem8.com/reference/createjobs — `status` required; `x-record-uuid`; `create_jobs` scope; 400/401/403/429/500
- developer.servicem8.com/reference/createjobcontacts — fields; `manage_job_contacts`; `is_primary_contact` deprecated
- developer.servicem8.com/reference/createclients.md, listclients.md — Company fields (no phone/mobile/email); `manage_customers` / `read_customers`
- developer.servicem8.com/reference/createcompanycontacts.md, listcompanycontacts.md — CompanyContact fields; `manage_customer_contacts` / `read_customer_contacts`
- developer.servicem8.com/reference/deletejobs.md, getjobs.md — soft delete (`active = 0`), 404 wording; `manage_jobs` / `read_jobs`
- developer.servicem8.com/docs/filtering.md — `eq/ne/gt/lt`, `and` only, ≤ 10 conditions, single-quoted strings
- developer.servicem8.com/docs/authentication.md — scopes, incremental authorization, API keys need no developer account

### Tertiary (LOW confidence)
- None used.

## Metadata

**Confidence breakdown:**
- ServiceM8 write semantics: HIGH — measured live; docs cross-checked where they differ (`errorCode` type, 404 vs 200 on a deleted record)
- In-repo seams: HIGH — every claim is a file:line read this session
- Design choices left open by CONTEXT (company name, `converted` CHECK shape, DONE row triage): MEDIUM — reasoned defaults, flagged as resolved open questions
- Pitfalls: HIGH for 1–5 and 8 (measured or read), MEDIUM for 6–7 (product judgment)

**Research date:** 2026-10-10
**Valid until:** 2026-11-10 for the in-repo facts (re-check after any merge touching `for-tenant.ts` or `run-sync.ts`); ServiceM8 semantics stable — re-measure only if the OAuth path replaces the private key
