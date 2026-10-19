---
phase: 14-servicem8-job-creation-lead-resolution
reviewed: 2026-10-11T04:46:43Z
depth: standard
files_reviewed: 57
files_reviewed_list:
  - package.json
  - scripts/lead-jobs-invariants.mjs
  - src/app/(console)/inbox/action-state.ts
  - src/app/(console)/inbox/create-job-actions.ts
  - src/app/(console)/inbox/create-job-form.tsx
  - src/app/(console)/inbox/page.tsx
  - src/core/aging/stalled-digest.ts
  - src/core/alerts/operator-email.ts
  - src/core/attribution/consume-wins.ts
  - src/core/attribution/lead-born.ts
  - src/core/leads/booked-by-tradie.ts
  - src/core/leads/constants.ts
  - src/core/leads/create-job.ts
  - src/core/leads/done-keyword.ts
  - src/core/leads/gate.ts
  - src/core/leads/job-description.ts
  - src/core/leads/job-match.ts
  - src/core/leads/job-provision.ts
  - src/core/leads/mobile-spellings.ts
  - src/core/messaging/inbound.ts
  - src/core/servicem8/client.ts
  - src/core/servicem8/schemas.ts
  - src/core/servicem8/types.ts
  - src/core/servicem8/writes.ts
  - src/core/sync/run-sync.ts
  - src/db/migrations/0041_phase14_job_creation.sql
  - src/db/migrations/meta/0041_snapshot.json
  - src/db/migrations/meta/_journal.json
  - src/db/repository/escalations.ts
  - src/db/repository/for-tenant.ts
  - src/db/repository/index.ts
  - src/db/repository/leads.ts
  - src/db/schema/escalations.ts
  - src/db/schema/leads.ts
  - src/db/schema/quotes.ts
  - tests/attribution-consume-isolation.test.ts
  - tests/attribution-lead-born.test.ts
  - tests/create-job-action.test.ts
  - tests/done-keyword.test.ts
  - tests/helpers/seed.ts
  - tests/helpers/sm8-stub.ts
  - tests/lead-booked-by-tradie.test.ts
  - tests/lead-digest-section.test.ts
  - tests/lead-done-keyword.test.ts
  - tests/lead-job-create-db.test.ts
  - tests/lead-job-create.test.ts
  - tests/lead-job-description.test.ts
  - tests/lead-job-match.test.ts
  - tests/lead-job-structure.test.ts
  - tests/lint-ban.test.ts
  - tests/mobile-spellings.test.ts
  - tests/operator-authorization.test.ts
  - tests/ops-scripts.test.ts
  - tests/rls-coverage.test.ts
  - tests/runbook-contract.test.ts
  - tests/sm8-client-write.test.ts
  - tests/sm8-schemas.test.ts
findings:
  critical: 1
  warning: 6
  info: 9
  total: 16
status: issues_found
---

# Phase 14: Code Review Report

**Reviewed:** 2026-10-11T04:46:43Z
**Depth:** standard
**Files Reviewed:** 57
**Status:** issues_found

## Summary

Phase base `bd8beb3` to code HEAD `bc620eb` (migration 0041 applied, deployed, zero leads on production). Every source file in the diff was read in full; the five summaries' recorded deviations (A–G, the ratified deviation C, the in-place `stale_claim` edit to 0041) were treated as deliberate and are not re-flagged. 13-REVIEW IN-01..IN-11 remain open by design and were not re-raised. No ServiceM8 call, no DB-backed suite and no `.env*` file was touched; CI run 38111363682 on `bc620eb` is the DB proof cited.

**The focus questions, answered from the code:**

- *Two ServiceM8 jobs for one lead?* The claim (`claimJobCreation`, guarded `open AND state IN ('none','failed')`) and adopt-before-create at every step hold for every failure the stub can inject. One path escapes: a POST that succeeds and a read-back that fails discards the `x-record-uuid` (CR-01). The retry adopts a job by digest, but the window between the failure and the retry is exactly the one SM8-02 was written against, and for a company the retry creates a duplicate client record.
- *A job for a closed lead?* Not through the claim. Only a close that lands mid-flight (STOP, DONE, the sweep) produces a `closed` lead carrying `sm8_job_state = 'created'` (IN-07) — the job was legitimately created while the lead was open.
- *Wrong company/contact from a poor mobile match?* No: equality is `normalizeAuMobile` in TypeScript over CHECK-validated E.164; landlines never normalise; both tiers verify the company reads back active. The two mobile predicates diverge in one case (IN-03).
- *A lead left unretryable?* Two states loop on every Retry: a 23505 on the partial unique caught as `readback_mismatch` (WR-02), and a persisted job the tradie deleted, adopted without an `active` check (WR-01).
- *A lead-born job opening a quote cadence?* Yes, through CR-01: the orphan's uuid is unknown to `jobUuidsLinkedAmong`, so the next poll mirrors it `poll`/`eligible` and emits `quote_opened`.
- *Can the sync WRITE to ServiceM8?* No. `runSyncForConnection`'s `clientFactory` returns `Sm8Client` (`run-sync.ts:146`), so `post`/`getOne` are statically unreachable from the sync and from `resolveLeadsBookedByTradie` (`booked-by-tradie.ts:85`).
- *A stranger's DONE closing a lead?* No: `tenantsOwningNumber` must return an owner AND an escalation must have been SENT to that exact address. *A tradie's DONE closing the wrong lead?* Only by D-08's own "most recently sent" rule — design, not defect. What the branch does do is swallow a reply that belongs to another tenant's cadence (WR-05).
- *Booked-by-tradie closing a lead whose job is ours, or double-counting?* No: candidates are `open AND none`; our creates are `creating`/`created`/`failed` and never candidates; the 24 h text-back rate window keeps a repeat caller's new lead dated after our job. `setMatchedJob` and the claim are single guarded UPDATEs, so a tap racing the pass is decided by Postgres in both orders.
- *Preview differs from the write?* Yes, in one way: the classifier labelling a reply between render and confirm changes the urgency line (WR-04). Replies and suburb cannot differ.
- *Caller number / API key / model free text in logs?* None found. Every log line in the new modules carries ids, counts and closed-vocabulary kinds; the client never returns a response body; the invariants script aggregates in SQL. The sheet renders the caller's mobile in a client component, which is planned (14-02-PLAN line 156) and consistent with the inbox already rendering `row.fromAddress` (page.tsx:414).
- *Post-commit pass hanging or throwing per tenant?* It cannot throw out of the cycle (fixed-string catch), but it is outside the tick deadline and can add up to 200 s to the last admitted cycle (WR-06).
- *`$filter` injection?* Closed: every value entering a filter is a pattern-checked uuid or a `mobileSpellings` output re-checked by `SPELLING_PATTERN`, single-quoted; the stub throws on any clause outside that subset.

**Migration 0041 vs schema vs writers:** every CHECK is reachable and matches the schema file byte for byte; `leads_closed_iff_reason` is dropped at line 96 and re-added at 120 inside the one migration; the partial unique is scoped to `created` as designed; the two indexes are plain `CREATE INDEX` (fine at this table size inside the migrator's transaction). Two members of `leads_sm8_job_error_kind_known` are never written (IN-01).

**Tests:** 14 new suites, zero skips, no removed assertion in any pre-existing suite (only `tests/sm8-schemas.test.ts` had one import line reshaped). Fiction ranges are disjoint across the three DB suites (60x / 62x / 64x). The door suites, `transitions.ts`, `eligibility.ts`, `qualify.ts` and `decide.ts` are byte-identical to the phase base. The stub's measured semantics (duplicate POST creates twice, header uuid, exact-spelling filter, soft-deleted record readable, 400 on a missing referent) match the ledger. One gap: `failNext` fires on the next request to a resource, so the POST-succeeds/read-back-fails sequence that CR-01 depends on is exercised by no test.

## Critical Issues

### CR-01: A failed read-back discards the record's uuid, so a job our tap created can be first-sighted by the sync as `poll`/`eligible`

**Status:** FIXED in `eb740f1` — the create wrappers carry the POST's uuid on every post-POST mismatch; `provisionLeadJob` persists it (company, job, contact) before returning `failed`. Stub control `failNextReadBack`; pure pins for all three steps; DB case (CI) proves the next cycle mirrors the orphan `needs_review`/`lead` with zero events and the retry adopts by uuid. Residual: a company whose read-back failed is adopted on retry by tier 0, so its company contact (the mobile) is never created — the same shape as a failed company-contact POST before this fix; the mirror tier finds the company through the job contact afterwards.

**File:** `src/core/servicem8/writes.ts:105-122`; `src/core/leads/job-provision.ts:247-254` (job), `:195-198` (company)
**Issue:** `createAndReadBack` returns `mismatch(...)` with no uuid whenever the GET after a successful POST fails (`network_error`, a 20 s timeout, `rate_limited`, a 5xx, an unparseable or inactive record, a coerced status). `resolveJob` then returns `{ ok: false, kind }` without calling `persist({ jobUuid })`, so the lead goes `failed` with `sm8_job_uuid IS NULL` although the job now exists in the client's account with the header uuid in hand. Consequences, in order: (1) the SM8-02 first-sight guard (`run-sync.ts:480-486`) keys on `jobUuidsLinkedAmong`, which cannot see this job, so the next poll (≤ 5 min) upserts it `poll`/`eligible` and emits `quote_opened` — the quote cadence the phase goal says the sync must not open; (2) when the operator retries, adopt-by-digest finds the job and the unit of work upserts `sync_source = 'lead'`, but `chase_eligibility` is absent from the conflict set, so the row stays `eligible` with a live cadence and a `job_created` lead — a state D-06 says only operator review may produce; (3) for `createCompany`, the uuid is lost before the company contact exists, so no tier can find the company and the retry creates a duplicate client record. The only path the tests cover is the no-header case (`omitHeaderNext`), where nothing can be persisted; the header-present/read-back-failed case is uncovered because `failNext` always lands on the POST.
**Fix:**
```ts
// writes.ts — carry the uuid on every post-POST failure
export type WriteOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; kind: Sm8WriteFailureKind | 'readback_mismatch'; status?: number; detail?: string;
      /** Set when the POST answered with a uuid but the read-back did not confirm it. */
      uuid?: string };
// ...
const read = await readBack(uuid);
if (!read.ok) return { ...mismatch(`read-back of ${resource} failed (${read.kind})`), uuid };
// (same for the parse / active / verify mismatches)

// job-provision.ts — persist BEFORE giving up, so the sync guard and the retry can see it
const created = await createJob(client, { ... });
if (!created.ok) {
  if (created.uuid !== undefined) await persist({ jobUuid: created.uuid });
  return { ok: false, kind: created.kind };
}
// and in resolveCompany tier (iii): if (!company.ok) { if (company.uuid) await persist({ companyUuid: company.uuid }); ... }
```
Then on retry, tier 0 (`getJob` by persisted uuid) adopts it and `jobUuidsLinkedAmong` sees it in the meantime. Add a stub control (`failNextReadBack(resource)`) and pin: POST ok + GET_ONE 500 → lead `failed/readback_mismatch` WITH `sm8_job_uuid` set, and the sync mirrors it `lead`/`needs_review` with no event.

## Warnings

### WR-01: Tier-0 adopt of the persisted job ignores `active`, so a job the tradie deleted is adopted — the lead converts to a deleted job or loops on Retry

**Status:** FIXED in `21d381a` — tier 0 adopts only an ACTIVE persisted job; inactive or gone, the job and contact uuids are cleared (`setJobLinkage` patch admits `null`), the kind (`inactive`/`missing`) is logged by the caller beside ids, and a fresh create follows. Pure pins + DB case (CI).

**File:** `src/core/leads/job-provision.ts:221-225`
**Issue:** `if (read.ok) return { ok: true, value: { uuid: persisted.jobUuid, adopted: true } }` adopts the persisted job whatever `active` says (the comment: "ours, whatever its status now"). A soft-deleted job reads back `200` with `active: 0` (ledger #20). From there `resolveContact` lists and then POSTs a job contact onto a deleted job. If ServiceM8 accepts it, the final read-back succeeds, the mirror row is inserted `sm8_active = false`, and the lead converts `job_created` with the inbox chip "job 01a1… · Quote" for a job that no longer exists; if ServiceM8 refuses (unmeasured), every Retry fails `bad_request` forever. The same shape is reachable through the sync guard: an orphan the tradie deleted before the poll is mirrored `lead`/`needs_review` inactive, then adopted on retry.
**Fix:** Adopt only an active persisted job, otherwise fall through (adopt-by-digest already filters `active eq 1`, so a fresh create follows):
```ts
if (persisted.jobUuid !== null) {
  const read = await getJob(client, persisted.jobUuid);
  if (read.ok && read.data.active === true) return { ok: true, value: { uuid: persisted.jobUuid, adopted: true } };
  if (!read.ok && read.kind !== 'bad_request') return { ok: false, kind: read.kind };
}
```
Pin with `stub.post('job/<uuid>.json', { active: 0 })` between attempts.

### WR-02: A 23505 on `leads_sm8_job_created_uniq` is swallowed as `readback_mismatch` and the lead becomes permanently unretryable

**Status:** FIXED in `99bffc4` — the note line carries the call's local time to the minute (`… on 10 Oct 2026 at 7:30 am`), so per-lead digests differ; a 23505 on `leads_sm8_job_created_uniq` in the unit of work clears the job linkage (job uuid, contact uuid, digest; company kept) and fails retryable with kind **`parse_error`** plus a fixed log sentence naming the violation. LIMITATION (for Phase 15): 0041 is applied to production and its CHECK admits no dedicated kind, so `parse_error` is a borrowed label — the sheet says "ServiceM8 returned data in an unexpected shape. Retry…", which is approximately true (the adopt read returned another lead's job) and the retry does succeed. A dedicated kind (e.g. `job_linked_elsewhere`) needs migration 0042 + a sentence. Also: the second contact already added to the other lead's job in ServiceM8 is not removed (the tap never deletes). DB case (CI).

**File:** `src/core/leads/create-job.ts:229-238`; `src/core/leads/job-provision.ts:228-240`
**Issue:** Adopt-by-digest keys on SHA-256 of the description, whose only lead-specific content is the caller's words, the typed suburb, the urgency label and the call's calendar date. Two leads whose callers map to the same company (a business with two mobiles, or a shared landline-free office) replying the same words on the same day produce the same digest. If the second lead's first POST fails and the operator retries, `listOpenQuoteJobsForCompany` finds the FIRST lead's job, adopts it, adds a second contact to it, and `recordJobCreated` raises 23505 (the first lead holds that uuid in `created`). The generic `catch` records `readback_mismatch` with the first lead's job uuid persisted; every Retry re-adopts it through tier 0 and hits 23505 again. The sheet says "Retry — an existing job is adopted, never duplicated", which is true and useless here; the state needs a manual repair.
**Fix:** Make the digest unique per lead by putting the call's local time into the note line (`… on 11 Oct 2026 at 09:14`), which is also better information for the tradie; and treat a unique violation distinctly in the unit of work (`error.code === '23505'` → clear `sm8_job_uuid` and `sm8_job_description_sha256` in `recordJobFailure` so the next attempt creates fresh). Pin: two leads, one company, identical descriptions, the second retried.

### WR-03: `isLeadBornJob` excludes a `failed` lead that holds our job's uuid, so a job our tap created can still be billed

**Status:** FIXED in `041ac89` — `isLeadBornJob` is `links.length > 0`; pure pins updated (failed, creating, other-reason links are lead-born).

**File:** `src/core/attribution/lead-born.ts:32-39`; `src/core/attribution/consume-wins.ts:334-343`
**Issue:** `linkedToJob(event.sm8JobUuid)` returns only leads whose `sm8_job_uuid` IS this job; the uuid gets there through `createJob`, adopt-by-digest, or `setMatchedJob` — every one of them is a job Backdesk recorded as the lead's. Yet the predicate requires `created`, `job_created` or `booked_by_tradie`, so a lead left `failed` (contact POST failed, `stale_claim`, or CR-01's shape) with a persisted uuid is "not lead-born" ("no job of ours exists yet as far as the record says" — the record says the opposite). Timeline that bills: tap creates the job, contact step fails, operator never retries; the mirror row is `needs_review`; weeks later the operator reviews it eligible and runs a quote cadence; the tradie wins it; the `won` event passes this check and `decideAttribution` credits the touches. D-06 says never.
**Fix:**
```ts
export function isLeadBornJob(links: readonly LeadJobLink[]): boolean {
  // Any linkage at all: the uuid reaches `leads.sm8_job_uuid` only through our create, our adopt
  // or the sync's match. A lead still `creating` holds it too — the job is ours, not yet confirmed.
  return links.length > 0;
}
```
Update the three header paragraphs and the pure pins accordingly.

### WR-04: The preview can differ from what is written — the thread-change guard compares the newest reply id, not the description

**Status:** FIXED in `cf9936c` — `previewSha256For` (server-only, in job-provision.ts) digests reply ids, replies, urgency line and note line; the page computes it, the form posts `preview_sha256` beside `latest_inbound_id`, and `createJobForLead` recomputes it before any claim → `thread_changed` on any difference. Pinned pure (digest changes on an urgency label) and DB (CI: label set between render and confirm → `thread_changed`, no claim, no ServiceM8 call).

**File:** `src/core/leads/create-job.ts:139-141`, `:158-161`; `src/core/leads/job-description.ts:121-137`
**Issue:** `previewLinesFor` takes the urgency line from the newest LABELLED reply. The classifier labels asynchronously, so between the page render (newest reply unlabelled → urgency from an older reply or none) and the confirm (newest reply now `emergency`) the server-side `buildJobDescription` adds or changes "Urgency: …" while `newest.id === expectedLatestInboundId` still holds. The operator approved a description that is not the one written into the tradie's ServiceM8, against D-01's "previews exactly what will be written". Secondary: a reply landing after `jobSheetFacts` and before the claim is omitted silently (the header at `:40-46` claims otherwise — see IN-02).
**Fix:** Post a digest of the preview and compare the rebuilt description to it:
```tsx
// create-job-form.tsx: <input type="hidden" name="preview_sha256" value={previewSha256} />  (computed server-side on the page from previewLinesFor + '' suburb is not enough — hash the LINES: replies, urgencyLine, noteLine, newest id)
// create-job.ts: if (sha256Of(JSON.stringify({ ids: facts.replies.map(r => r.id), lines: previewLinesFor(...) })) !== input.expectedPreviewSha256) return { kind: 'thread_changed' };
```
(Server-side `node:crypto` is already in `job-provision.ts`; the page computes the hash, the client only echoes it.)

### WR-05: The DONE branch swallows a reply before the cadence lookup, so a reply from a number that is one client's own and another client's customer never threads

**Status:** FIXED in `fea5d64` — the cadence lookup runs first and the DONE branch is taken only when it returns no candidate; STOP lines unchanged. Pure door pin over a mocked repository: own number at A, live lead cadence at B, "all done, thanks" → `reply_threaded` at B, A's lead untouched.

**File:** `src/core/leads/done-keyword.ts:140-176`; `src/core/messaging/inbound.ts:328-333`
**Issue:** The research premise — "a client's own number never carries a cadence" — is per tenant. A tradie who is another client's customer (a sparky hiring a plumber, both on Backdesk) texts "all done, thanks" to the plumber's lead or quote cadence. The door sees an own number (at his own tenant), finds no escalation sent to it, writes the row `unmatched`/untriaged under HIS tenant, emails `done_no_lead`, and returns — the plumber's cadence is never paused on reply, the reply is never threaded, and `pauseForReply`/`suppressFromInbound` never run. The found path has the same shape with a different outcome (closes his lead, drops the plumber's reply). With fifteen Perth trades the overlap is plausible.
**Fix:** Take the DONE branch only when no cadence answers the number:
```ts
if (!isStop && isDoneKeyword(input.body)) {
  const candidates = await forAllTenants_cadencesByContactMobile(normalizedFrom);
  if (candidates.length === 0) {
    const done = await handleTradieDone(base, normalizedFrom, now, deps);
    if (done !== null) return done;
  }
}
```
(or have `handleTradieDone` return `null` on the not-found path when the caller passes a non-empty candidate list). Pin: own number at A, live lead cadence at B, body "done" → `reply_threaded` at B.

### WR-06: The post-commit pass runs outside the tick deadline and can add up to 200 s to the last admitted sync cycle

**Status:** FIXED in `6788e0b` — `runSyncTick` hands each cycle `tickDeadlineAt`; the pass stops starting company-contact reads `LEAD_JOB_MATCH_PASS_MARGIN_MS` (10 s) before it, caps each read at `LEAD_JOB_MATCH_READ_TIMEOUT_MS` (5 s) and never past the deadline (client `get` timeout may now only be shortened), and skips the rest — `companyReadsSkipped`, logged kind `tick_deadline`. Fake-clock pure suite + wiring pins; tick-budget reasoning and commercial-assumptions §16 record it.

**File:** `src/core/leads/booked-by-tradie.ts:199-221`; `src/core/sync/run-sync.ts:565-573`, `:104`
**Issue:** `TICK_DEADLINE_MS = 220_000` is checked before a cycle begins and the cycle "can start at the deadline and still run its full" length inside `maxDuration = 300`; that arithmetic (pinned in `tests/sync-tick-budget.test.ts`) predates this pass. The pass performs up to `LEAD_JOB_MATCH_COMPANY_READS_PER_CYCLE = 10` sequential `client.get` calls, each with the 20 s `AbortSignal.timeout`, plus one transaction per hit — up to 200 s of ServiceM8 wait on a slow day, after the cycle has already committed. A tenant with open leads and ≥10 contactless candidate jobs on a slow ServiceM8 pushes the function past 300 s; the kill lands mid-pass (the committed cycle is safe, hits already resolved stay resolved), but the tick's own summary and the `[sync] lead job match failed` line never run, so the overrun is invisible.
**Fix:** Pass a deadline into the pass and stop spending reads past it: `resolveLeadsBookedByTradie(tenantId, { client, tenantTimezone, now, deadline })` with `if (Date.now() > deadline) break;` in the read loop; or give these optional reads a shorter timeout via a `client.get(..., { timeoutMs })` option. Record the addition in the tick-budget reasoning.

## Info

### IN-01: Two `LEAD_JOB_ERROR_KINDS` members are never written

**File:** `src/db/schema/leads.ts:177-188`; `src/core/leads/create-job.ts:144-146`, `:196-200`; `src/app/(console)/inbox/action-state.ts:62-64`
**Issue:** `connection_paused` and `not_connected` are refusals answered BEFORE the claim and returned as `CreateJobResult` kinds; `recordJobFailure` only ever receives a provision kind or `readback_mismatch`. The CHECK admits two values no writer produces, and the sheet carries two `failed:` sentences that cannot be shown.
**Fix:** Drop the two from `LEAD_JOB_ERROR_KINDS`, the CHECK (next migration) and the sentence map, or document them as reserved.

### IN-02: Stale or incorrect comments

**Status:** PARTIAL — job-provision.ts header (`21d381a`), job-description.ts urgency-map comment (`99bffc4`) and create-job.ts read-then-claim comment (`cf9936c`) corrected in passing; action-state.ts header left open (file not otherwise edited).

**File:** `src/core/leads/create-job.ts:40-46`; `src/core/leads/job-description.ts:38-41`; `src/app/(console)/inbox/action-state.ts:1-2`; `src/core/leads/job-provision.ts:23`
**Issue:** create-job.ts says a reply arriving between the facts read and the claim "is caught by the thread-change check" — it is not (the check compares the preview's id to the facts read's newest, and the description is built from that same read). job-description.ts says "a fifth urgency must fail here, loudly" while `urgencyLineFor` returns `null` silently (`?? null`). action-state.ts's header still describes the file as the mark-handled form's state. job-provision.ts's "ours, even if the tradie has since moved its status" is the premise WR-01 corrects.
**Fix:** Reword each to what the code does.

### IN-03: Two mobile-match predicates with different semantics

**File:** `src/core/leads/job-provision.ts:132-137` (`sameMobile`: mobile OR phone); `src/core/leads/job-match.ts:144-154` (`contactsMatchMobile`: `mobile ?? phone`)
**Issue:** A contact whose `mobile` normalises to a different number and whose `phone` is the caller's matches the company on the create path but not the job on the match path. Harmless in direction (one fewer tradie-booked resolution) but a duplicated rule that will drift.
**Fix:** Export one `contactCarriesMobile(row, e164)` from `job-match.ts` and use it in both.

### IN-04: `BOUNDED_LIST_MAX_ROWS = 500` is an unverifiable bound

**File:** `src/core/servicem8/writes.ts:61-68`, `:240-242`; `src/core/servicem8/pagination.ts:1-39`
**Issue:** The pagination header records that ServiceM8 advertises no paging and ignores `cursor`. If it pages silently below 500, adopt-by-digest reads a truncated page and creates a duplicate job; if it never pages, a company with ≥500 open quotes fails `parse_error` on every retry (14-01 hazard 5). Neither branch is measured.
**Fix:** Record as an assumption beside A1–A5; consider `fetchAllPages` (which already handles the measured no-cursor behaviour) for the adopt read instead of a single page.

### IN-05: The post-commit pass also runs when the cycle's lock was not acquired

**File:** `src/core/sync/run-sync.ts:457-460`, `:569`
**Issue:** `!locked` returns zero counts from the transaction and the pass still runs; an overlapping run spends a second set of reads and a second stale-claim UPDATE. Guarded writes make it harmless; it is wasted ServiceM8 budget.
**Fix:** Return `locked` in `written` and skip the pass when false.

### IN-06: The invariants script prints the driver's error message

**File:** `scripts/lead-jobs-invariants.mjs:104`
**Issue:** `console.error(error instanceof Error ? error.message : String(error))` — the pattern 13-REVIEW IN-09 flagged in the sibling script, carried into the new one. True today that nothing secret is interpolated; the sibling rule is what keeps it true when the query grows.
**Fix:** `console.error('lead-jobs invariants read failed; nothing printed.')`.

### IN-07: A close landing mid-flight yields `status = 'closed'` with `sm8_job_state = 'created'`

**Status:** DOCUMENTED in `6c3bbd9` — the closed-lead-with-created-job state is described on `recordJobCreated`'s interface comment (no guard change; WR-03 keeps such a job unbilled).

**File:** `src/core/leads/create-job.ts:217-227`; `src/db/repository/for-tenant.ts` (`recordJobCreated`, guarded on `creating` only)
**Issue:** STOP (`opt_out`), DONE (`closed_by_tradie`) or the sweep can close the lead while the ServiceM8 calls are in flight. `recordJobCreated` succeeds, `closeLeadInTx` reports `already_closed` (logged), and the lead ends closed with the original reason, a `created` job, no `job_created` reason and no resolution chip — but counted by the digest's "jobs created" line. Legal under every CHECK and arguably right (the job was created while open); undocumented.
**Fix:** Document the state in the schema header, or guard `recordJobCreated` on `status = 'open'` and record the job as an orphan (which then relies on WR-03's fix to stay unbilled).

### IN-08: Three cross-tenant reads sit outside the `forAllTenants_*` prefix the "exactly sixteen" pin counts

**File:** `src/db/repository/leads.ts:48-67`, `:98-114`; `src/db/repository/escalations.ts:505-527`; `src/db/repository/index.ts:514-535`
**Issue:** `tenantsOwningNumber`, `countLeadResolutionsSince` and `latestSentLeadEscalationTo` each query without a tenant scope. The argument (ids and counts only) is sound, but the pin in `tests/sync-upsert.test.ts` now measures a naming convention rather than the number of cross-tenant reads.
**Fix:** Restate the pin's claim in its comment ("sixteen reads that reach customer data, cadences or writes"), or add a second pin enumerating the counts-and-ids family.

### IN-09: A hard-coded timezone fallback duplicates the schema default

**File:** `src/app/(console)/inbox/page.tsx:238`; `src/core/leads/create-job.ts:159`
**Issue:** `tenant?.timezone ?? 'Australia/Perth'` on the page, `tenant.timezone` in the core; `tenants.timezone` is `NOT NULL DEFAULT 'Australia/Perth'`, so the fallback is unreachable and a second spelling of the default.
**Fix:** Drop the fallback (the page already skips the lead when the tenant row is missing) or import one shared constant.

## Fix Log

Fixed 2026-10-11 by gsd-code-fixer on `main` (no worktree; `workflow.use_worktrees: false`). CR-01 and WR-01..WR-06 fixed, one atomic commit each; IN-02 partially and IN-07 (doc) taken in passing because they sat in files already being edited; IN-01, IN-03..IN-06, IN-08, IN-09 remain open. Local gates: `npm run typecheck`, `npm run lint` (0 warnings), `npx next build`, `npm run db:generate` ("No schema changes"), and every pure suite (127 files, 5,012 tests) green. DB suites changed and CI-only: `tests/lead-job-create-db.test.ts` (CR-01, WR-01, WR-02, WR-04 cases; the note-line assertion now includes the time). Migration 0041 untouched.

**Carried to Phase 15:** a dedicated `LEAD_JOB_ERROR_KINDS` member for the WR-02 unique violation (needs migration 0042 and a sheet sentence), replacing the borrowed `parse_error`.

---

_Reviewed: 2026-10-11T04:46:43Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
