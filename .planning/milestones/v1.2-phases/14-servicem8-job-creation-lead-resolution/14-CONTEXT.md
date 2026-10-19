---
phase: 14
phase_name: ServiceM8 Job Creation & Lead Resolution
milestone: v1.2
created: 2026-10-10
source: founder decisions 27 Sep + 10 Oct 2026; .planning/research/{FEATURES §7, PITFALLS §5.4 §5.5, ARCHITECTURE §3.x job creation, SUMMARY D8}; ROADMAP.md Phase 14 (research/risk flag); Phase 13 outcomes (13-CONTEXT D-11/D-12/D-14, 13-REVIEW IN-01..11, lead closing + label effects)
---

# Phase 14 Context — ServiceM8 Job Creation & Lead Resolution

## Goal
A lead with confirmed intent becomes a ServiceM8 quote job on one operator tap, exactly once, without the sync opening a second cadence on the same customer; and leads the tradie handled himself close honestly without operator work.

## Decisions (locked)

<decisions>
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
</decisions>

## Scope
- In: SM8-01, SM8-02, SM8-03, LEAD-04.
- Out: lead queue page, lead reporting, 90-day pseudonymisation (Phase 15); posting a client's ServiceM8 booking form instead of a job (v2); attributing dollars to lead-born jobs (D8); ServiceM8 webhooks (polling stays the guarantee); OAuth-app scope work beyond recording the follow-up.

## Constraints carried
- Hosted Supabase is production; migration push protocol before code push; never `test:remote`; `.env*` never named in commands; the agent permission classifier refuses `db:migrate` and may refuse `git push` — the plan's push step must say the founder runs `db:migrate` by hand on refusal (13-07 precedent).
- No text-back has ever been sent live (12-09 override); zero leads on production; the test tenant is paused with SMS off. Live proofs are event-gated on the first client; plans need no second phone and no live customer.
- ServiceM8 test rig = the test tenant's trial account via private API key; Job webhooks are not live; sync polls every 5 min.
- GSD model policy: fable for planner/researcher/checker/verifier; opus for executors.
- 13-REVIEW IN-01..IN-11 open by design; touch only what this work passes through.

## Deferred ideas
- Service-area check feeding the confirm sheet; booking-form POST; auto-creation on high-confidence intent; per-client "create jobs automatically" switch; lead dollars attribution.
