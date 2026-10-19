---
phase: 15-lead-console-reporting-privacy
verified: 2026-10-15
uat: 15-UAT.md (founder phone + pane, 2026-10-15 — 4/4 pass after the a641750 badge-wrap fix)
status: passed
score: 22/22 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification: false
ci:
  final_sha: 9c2f4a2
  run_id: 38704147919
  conclusion: success (completed 2026-10-15T08:24:31Z; typecheck, lint, migrate "Journal entries recorded: 43", test suite 211/211 files, 6,573 passed, 29 pre-existing skips, zero failure markers; every DB-backed Phase 15 suite ran — pseudonymise, lead-queue, missed-call-log, report-missed-calls, text-back-recent-conversion, lead-job-create-db, retired-number-suppress)
  previous_green: 38697822211 on 3387492 (the SHA that applied 0042 and first deployed Phase 15); 38699339505 on 23b0c2e
deployment:
  vercel_production: Ready on 9c2f4a2 (backdesk-jil6acjb7, 1 m build, 8 min old at verification)
  github_deployment: 7087447788 Production success (2026-10-15T08:14:50Z)
  migration_0042: applied (schema_0042_applied=true; 43 journal entries); SQL/snapshot/journal last edited before the apply
  pepper: CALLER_PSEUDONYM_PEPPER present by name on Vercel Production (1) and Preview (1); required member of serverEnvSchema (min 32)
production_readback:
  lead_privacy_invariants: leads_total=0 leads_closed_past_boundary=0 missed_calls_total=6 missed_calls_no_lead_past_boundary=0 suppressed_contacts_total=4 schema_0042_applied=true
  cron_status: four jobs active, remote_test_lease rows 0, no watchdog, last five net._http_response 200 (08:18–08:21Z, after the 9c2f4a2 deploy)
  probes: twilio/voice wrong signature 401; twilio/voice-status wrong signature 401; cadence-tick wrong bearer 401; messaging-reconcile wrong bearer 401; GET /leads unauthenticated 307 -> /login; GET backdesk.com.au/privacy 200 serving "Last updated 15 October 2026"
  spike_rows: both spike quotes (01a12438-259d, 01a12438-2cc6) status=Unsuccessful sync_source=poll sm8_active=false, zero quote_status_events; quotes_source_lead=0; monthly_reports total 0
human_verification:
  - test: "On the phone at app.backdesk.com.au: open /leads"
    expected: "The 'No open leads.' empty state; Leads is the third console nav item; nothing else on the page (no caller, no card)"
    why_human: "Layout at phone width; production holds zero leads, so only the empty state can be seen today"
  - test: "Open the test tenant's client page and scroll to Missed calls"
    expected: "The section lists the six Phase 11/12 verification calls newest first with an outcome chip each; a withheld row shows no number; the state line names the divert number and reads 'text-back not armed'; no 'Show older calls' link (fewer than 20 rows)"
    why_human: "Rendering of real rows at phone width; the pins check strings, not how they read"
  - test: "Open /reports, then the test tenant's client report page, then tap 'Export design-partner CSV' on iOS Safari"
    expected: "The overview's Missed calls column shows a count for a client with an active divert number and 'no divert number' otherwise; the client page's month-to-date block shows every rate beside its denominator and 'no samples — no text-back delivered this month' under Text-back speed; the export downloads a header-only CSV (14 columns) and the status line reports 0 rows"
    why_human: "The Blob download on iOS Safari is the one open risk (WR-06 moved the revoke to a 10 s timer; the GET-route fallback is documented, not built)"
  - test: "When the first monthly report is frozen for any client (production holds zero monthly_reports today): open it"
    expected: "A report frozen after Phase 15 shows the Missed calls block last; a month regenerated after Phase 15 becomes version N+1 with N kept; the stored pre-Phase-15 fixture proves an old row renders without the block"
    why_human: "Event-gated — no frozen report exists in production yet; the fixture test is the only evidence until then"
  - test: "Open backdesk.com.au/privacy on the phone and read the callers section and the general processors paragraph"
    expected: "Callers: what is captured, Twilio (United States, Sydney edge, processes call details outside Australia), ClickSend 'an Australian provider', Anthropic (United States), Supabase/Vercel Sydney; the ninety-day sentence with '…and no later than 12 months after you booked'; the general paragraph says Resend and Anthropic are offshore and ClickSend is Australian; the landing footer says 'Email and AI providers'; 'Last updated 15 October 2026' (NOT 13 October — the date moved again at 9c2f4a2 after the review fixes)"
    why_human: "Prose quality and consistency as read, not as grepped"
  - test: "The next 06:30 AWST digest email and the next 03:30 AWST messaging-reconcile tick"
    expected: "Digest arrives with no overdue-leads line (zero open leads); cron:status shows the 03:30 dispatch answered 200; its body carries 18 keys with every pseudonymised* count 0, pseudonymisePassFailed false, messagingFailed false; the Vercel function log shows nine '[pseudonymise] …' count lines reading 0"
    why_human: "Scheduled runs on production; cannot be triggered by the verifier"
  - test: "Founder commit: the `CALLER_PSEUDONYM_PEPPER=hex-32-bytes` name-only line in the example env file"
    expected: "The example file carries the line directly after AUDIT_IP_HASH_SALT=, value never recorded anywhere"
    why_human: "Agents cannot read or write that file by workspace rule (15-02 deviation); docs/env-vars.md:128 carries the line verbatim"
  - test: "Live clauses, relocated to the first client (12-09 override, as Phases 11–14)"
    expected: "First diverted call appears on the client's missed-call log with its outcome; first lead appears on /leads with caller, after-hours flag, reply label + urgency and next action; first delivered text-back gives the report its first timing sample; first frozen report carries the block with real denominators; first CSV row with data; first pseudonymisation runs in early January 2027 on the founder's own verification calls (lead-less, 90 days from started_at) and the invariants backlog counts return to zero the morning after"
    why_human: "Nothing has run live against a customer; production holds zero leads and no armed tenant"
---

# Phase 15: Lead Console, Reporting & Privacy — Verification Report

**Phase Goal:** The operator works leads and sees every missed call from a phone, the monthly report and instrumentation carry Backdesk's first-party missed-call figures with honest denominators, a design-partner CSV replaces vendor statistics in the sales deck, and callers are covered by the privacy notice and a retention job.
**Verified:** 2026-10-15 (HEAD `9c2f4a2` on `main`, phase base `e7ee32b`, 48 commits)
**Status:** human_needed — every code-level must-have is verified; the live halves are event-gated on the first client and the zero-row phone UAT is outstanding
**Re-verification:** No — initial verification

## Declared up front: nothing has run live against a customer

As in Phases 11–14 (12-09 founder override), no text-back has been sent live, production holds zero leads (`leads_total=0`), no tenant is armed, no quote carries `sync_source = 'lead'` (`quotes_source_lead=0`), and no monthly report has been frozen (`monthly_reports` total 0). Every live clause of CON-05, CON-06, RPT-04, RPT-05 and COMP-02 (a real lead on the queue, a real diverted call on the log, a real timing sample, a real CSV row, a real pseudonymisation) is therefore **relocated** to the first client, not failed. What is verified here is the code path, the schema, the pure suites run locally, the DB-backed suites by CI run id, and read-only production state.

## Method

Goal-backward over the five ROADMAP success criteria and D-01..D-12, plus the eleven review fixes (CR-01, WR-01..WR-09, IN-01). For each: the code path (read, not trusted from SUMMARY), the schema (migration 0042 read; CHECKs compared to the schema files), and the test proving it — pure suites run locally by explicit file list with the CI pepper inline (31 files, 1,255 tests, all passing, 14 s); DB-backed suites cited by CI run `38704147919` (success on `9c2f4a2`, 211 files, 6,573 tests). `npm run typecheck` and `npm run lint` exit 0 with no output. Read-only production checks only: `npm run lead-privacy:invariants`, `npm run cron:status`, four 401 probes, `GET /leads` → 307, `GET /privacy`, one read-only SELECT on the spike rows and report counts (through the repo's own `loadEnv()` helper). Never run: `test:remote`, `db:migrate`, any DB suite locally, any write.

Executor deviations were checked against the code, not accepted from the summaries: 15-03's `countMissedCallsInWindow`/`listTenantIdsWithActiveDivert` in `leads.ts` (not the pinned `for-all-tenants.ts`, which keeps exactly 16 `forAllTenants_` exports); 15-03's guarded child UPDATEs (`dueLead()` ×3); 15-07's rollback on refusal (`LeadRefused`); 15-07's em-dash removal in ¶6; 15-08's pipeline pin re-pointed to "exactly one search param, never a status".

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | **SC1 / CON-05** Cross-client lead queue sorted by next-touch deadline then call time, approval-queue shape, caller mobile, when they rang, after-hours flag, latest classified reply with urgency, next action (approve touch / create job / close), phone-usable | ✓ VERIFIED (live half relocated) | `src/db/repository/leads.ts:234-297` `listOpenLeadsForQueue`: `row_number() over (partition by lead_id order by scheduled_at)` rank-1 join, `orderBy(scheduled_at asc nulls last, first_missed_at, id)`, select is ids/instants/`afterHours` ONLY (no mobile crosses tenants); `forTenant().leads.queueCards` (the third `DISTINCT ON` read, `for-tenant.ts:2092,2564`) carries mobile + latest reply. `leads/page.tsx:133` `requireOperator()` precedes the read at `:150`; `lead-card.tsx:142` after-hours badge, `:152` "rang {label} ({zone})", `:183-190` label + urgency chips, `:208` `/queue#touch-` link, `:213` `CreateJobForm` (Phase 14 sheet reused via `components/lead-job-sheet.ts`), `:220` `CloseControl` → `actions.ts:124` `closeLead(tenantId, leadId, 'operator', …)` after `requireOperator()` at `:79` and before `formData.get` at `:116`. Nav `layout.tsx:200`; `robots.ts:27` disallows `/leads`; production `GET /leads` → 307 `/login`. Tests: pure `leads-page`, `lead-close-action`, `queue-deadline`, `operator-authorization` (local); DB `lead-queue.test.ts` order/NULLS-LAST/overdue (CI) |
| 2 | **SC2 / CON-06** Per-client missed-call log: every diverted call, texted or not and why, the lead it opened; client page shows divert number, template set and arming state | ✓ VERIFIED (live half relocated) | `for-tenant.ts:5017-5074` `listForLog` keyset `(started_at, id) <` via builders, tenant on both sides of every join, selects outcome + skip reason + delivery status + lead/quote linkage + `pseudonymisedAt`; `missed-calls-list.tsx:211` `requireOperator()` then `:228-245` the read inside its own `try` with `limit: PAGE_SIZE` (WR-07), `:96-98` `CallerLine` renders `NUMBER_RETIRED_LABEL` for a stamped row, `:173-178` state line "Divert number …" / "text-back not armed|armed", `:287-291` two empty states, `:331` "Show older calls"; `clients/[id]/page.tsx:479` reads exactly the cursor param, `:1224` mounts the section; attestation date at `:977`. Production holds six lead-less calls for the test tenant. Tests: pure `missed-calls-section`, `missed-call-cursor`, `text-back-outcome-labels`, `pipeline-grouping` (local); DB `missed-call-log.test.ts` (CI) |
| 3 | **SC3 / RPT-04** Report + `/reports` show per client: captured with hour/weekday split, after-hours share, median/P90 arrival→delivered, reply rate on delivered, leads → jobs created → jobs won; every rate with its denominator; lead-born jobs counted not attributed; frozen reports unchanged | ✓ VERIFIED (live figures relocated) | `missed-call-figures.ts:84-120` one pure derivation: `afterHours {numerator, denominator: captured, rateBp}`, `replyRate` denominator = `textBacksDelivered`, median/P90 `null` on no sample, `funnel {leads, jobsCreated, jobsWon, bookedByTradie}`; `for-tenant.ts:6242-6400` `missedCallCounts` (`greatest(0, …)` clamp `:6309`; `jobsWon` is a COUNT over `Work Order`/`Completed` of jobs we created, `:6361-6382`). Both surfaces call it: `generate.ts:291,409` (frozen) and `reports/[client]/page.tsx:24,486` (month to date). `document.ts:108` `missedCalls: reportMissedCallsSchema.optional()` LAST key; `generate.ts:402-409` + `insertVersion` `COALESCE(MAX(version),0)+1` (`for-tenant.ts:5875`) → N+1, N kept. `reports/page.tsx:164,215-227` Missed calls column with "no divert number"; `[reportId]/page.tsx:332-333` block rendered ONLY when present, `:537` `NO_SAMPLES_LABEL`; `reporting/copy.ts:54,59,68,79` "no samples", "counted here and never given a dollar value". Attribution modules byte-identical to `e7ee32b`. Tests: pure `missed-call-figures`, `report-frozen-fixture` (fixture has 11 figure keys, no block, parses with `missedCalls` undefined, canonical bytes equal, comparator unchanged), `reports-missed-calls-page`, `reporting-metrics`, `report-unchanged` (local); DB `report-missed-calls`, `monthly-report`, `report-metrics` (CI) |
| 4 | **SC4 / RPT-05** Operator exports a design-partner CSV, same figures per client per month, no phone numbers or message bodies | ✓ VERIFIED (data relocated) | `partner-csv.ts:44` 14-column fixed header; `:59-63` `FORMULA_LEAD = /^(?:[\t\r]|\s*[=+\-@])/` (WR-05); `:70` empty cells, never 0, for a pre-Phase-15 month; input type is the parsed block only. `export-actions.ts:62` `requireOperator()` before `:68` the cross-tenant read; names through the operator's own JWT `:73-79`; strict `reportFiguresSchema.parse` `:84`; caught value discarded `:92-96`. `reports.ts:68-78` export read selects `tenantId, periodStart, version, figures` via `DISTINCT ON … version DESC`. `export-csv-form.tsx:34,56-59` revoke on a 10 s timer with effect cleanup (WR-06). Tests: pure `partner-csv` (header byte-pin, `PERSONAL` token grep over the source, 8 formula-lead cases), `export-csv-action` (gate-before-read by mock call counts) (local) |
| 5 | **SC5 / COMP-01** Privacy notice callers section: what is captured, who processes it (Twilio, ClickSend, Anthropic) and retention; first text's plain-text pointer, no link; "Last updated" bumped | ✓ VERIFIED | `copy.ts:484` callers ¶4 (Twilio US + Sydney edge, "processes the call details outside Australia"; ClickSend "an Australian provider"; Anthropic US; Supabase/Vercel Sydney); `:486` ¶6 ninety days + 90 days after a finished job + "no later than 12 months after you booked" (WR-02); `:509` general processors (Resend + Anthropic offshore; ClickSend Australian — WR-03); `:375` footer "Email and AI providers"; `:442` "Last updated 15 October 2026" — net ONE changed line against `e7ee32b` (moved in two commits: `b32619b` → 13 Oct, `9c2f4a2` → 15 Oct). Live page serves all four strings. Pointer: `backdesk.com.au/privacy` pinned in `text-back-template`, `text-back`, `text-back-admin`, `guide-page` suites. Tests: pure `privacy-page` (`:124-136` the WR-03 cross-section assertion — no clause names ClickSend as offshore, both call it Australian; `:173` the ninety-day statement, D-22 flipped by design), `marketing-copy` (no em dash) (local) |
| 6 | **SC5 / COMP-02** Closed non-converting rows pseudonymised after 90 days by a scheduled job with a read-back test; suppressions kept forever | ✓ VERIFIED (first live run relocated to Jan 2027) | Due-reads `leads.ts:475-531` (three arms, `pseudonymised_at IS NULL`, never `open`, never names `suppressed_contacts`), `:557-586` lead-less calls incl. withheld. Pass `pseudonymise.ts:201-280`. Writes `for-tenant.ts:5085-5121, 5558-5674`. Rides the 03:30 tick `route.ts:166-169`, no new pg_cron job (`cron:status` shows the same four jobs; `apply-cron-schedules.mjs` and `cron-schedules.test.ts` byte-identical). Read-back: DB `pseudonymise.test.ts` (23+ cases: every carrier, every boundary, suppressions raw, idempotent second run zero, hashed STOP still refused, CR-01 confirm, WR-01 unplaced replies, WR-02 long-stop) ran green in CI `38704147919`. Production: `leads_closed_past_boundary=0`, `missed_calls_no_lead_past_boundary=0`, `suppressed_contacts_total=4`, `schema_0042_applied=true` |
| 7 | **D-06 safety** Open leads, converted-non-terminal leads, inside-boundary rows and NULL numbers are never hashed; suppressions never touched | ✓ VERIFIED | `leads.ts:486-487` `status IN ('closed','expired') AND closed_at <= boundary`; `:490-505` converted requires `EXISTS quotes … status IN ('Completed','Unsuccessful') AND coalesce(completion, unsuccessful, edit) <= boundary` (NULL `sm8_job_uuid` never matches → long-stop only); `for-tenant.ts:5562-5567` `leadIsDue = tenant ∧ id ∧ status <> 'open' ∧ unstamped` on every statement; `pseudonymise.ts:180-183` NULL → NULL so `missed_calls_withheld_has_no_number` holds; structure pin `pseudonymise-structure.test.ts:223,227` no `suppressed_contacts|suppression` token in the pass or the leads family. Pure (local) + DB boundary cases (CI) |
| 8 | **D-06 children before lead; rollback on refusal; idempotent at the row** | ✓ VERIFIED | `pseudonymise.ts:217-235` one `forTenant().transaction` per lead: calls first (`:219-227`), inbound/late-replies/cadence/ledger then the lead LAST (`for-tenant.ts:5571-5665`), `if (counts.leads !== 1) throw new LeadRefused()` (`:232`) rolls back; tallies after commit (`:237-244`); every write guarded on its own stamp (`:5098,5118,5582,5631`) — a behaviour-dependent truth proven by the DB suite's second-run-zero and refusal cases in CI, not by presence |
| 9 | **CR-01** A hashed cadence never becomes a suppression | ✓ VERIFIED | `controls.ts:495` `suppressionEntriesFor` drops a pseudonym mobile; `:311-314` `number_retired` outcome; `inbox/page.tsx:281,352-356` retired rows render `NUMBER_RETIRED_LABEL`, no hash, no suppress control (WR-04). Tests: pure `retired-number-suppress` (9 tests, local + CI); DB CR-01 confirm case in `pseudonymise.test.ts` (CI) |
| 10 | **WR-01** Unplaced replies from a hashed lead's number are hashed with it | ✓ VERIFIED | `for-tenant.ts:5588-5635` fourth arm: `tenant_id IS NULL ∧ lead_id/quote_id/cadence_id NULL ∧ (unmatched ∨ ambiguous with this tenant among candidates) ∧ unstamped ∧ EXISTS(due lead with `contact_mobile = normalized_from`, received from `first_missed_at` to close + 90 d or the boundary)`; count `inboundRowsNoLead` (`pseudonymise.ts:130,240`); route key 17 of 18. DB seed in CI |
| 11 | **WR-02** 365-day converted ceiling | ✓ VERIFIED | `constants.ts:272` `PSEUDONYMISE_CONVERTED_MAX_DAYS = 365`; `leads.ts:509-513,526` third arm; structure pin `:81-82` (`toBe(365)`, `> PSEUDONYMISE_AFTER_DAYS`); notice ¶6. DB long-stop seed (k) in CI |
| 12 | **The gate does not hash (identity pin)** | ✓ VERIFIED | `constants.ts:244` `PSEUDONYMISE_AFTER_DAYS = LEAD_NEGATIVE_COOL_OFF_DAYS` (90); `pseudonymise-structure.test.ts:76` `>=` pin, `:232-240` `latestForMobile` and `existsTextBackToCallerSince` are one raw equality each, no `inArray`, no hash token; `gate.ts` byte-identical to `6ee653f` (end of 15-01) per 15-07; DB "hashed STOP still refused" in CI |
| 13 | **D-07** One migration entry 0042, applied, matches the schema files | ✓ VERIFIED | `0042_phase15_privacy_console.sql:98-106`: three nullable stamps; `leads_contact_mobile_e164` first arm the old CHECK verbatim, hash admitted ONLY with `pseudonymised_at IS NOT NULL`; `recent_conversion` member 7 (after `recent_negative_close`, before `recent_text`); `job_linked_elsewhere` appended last. Journal idx 42 `when` 1791878630443 > 0041's. CI migrate "Journal entries recorded: 43"; production `schema_0042_applied=true` |
| 14 | **D-08a** `job_linked_elsewhere` replaces the borrowed `parse_error` on the 23505 branch | ✓ VERIFIED | `create-job.ts:136,298` `code === '23505'` → `kind = 'job_linked_elsewhere'`; sheet sentence in `create-job-action.test.ts` (sentence map covers every member); DB `lead-job-create-db.test.ts` WR-02 case flipped to the new kind (acknowledged edit, 5+/3−) in CI |
| 15 | **D-08b** `recent_conversion` at position 7, 24 h inclusive | ✓ VERIFIED | `gate.ts:177-184` `isRecentConversion` (`status === 'converted'`, `closed_at` within `LEAD_RECENT_CONVERSION_HOURS = 24`, boundary inside); `:218` rule 7 between 6 and 8; `text-back-gate.test.ts:111` ORDER pin (75+/4− — the deleted lines are the old order comment and an import, re-generated); DB `text-back-recent-conversion` (CI). `text-back.ts` byte-identical to `6ee653f` |
| 16 | **D-09** Digest gains one overdue-leads line, nothing else | ✓ VERIFIED | `stalled-digest.ts:410` `countOverdueOpenLeads(now)` (`leads.ts:326`, SQL twin of `deriveUrgency === 'overdue'`), `:249-252` "<client>: N open lead(s) past its/their next follow-up deadline — open the lead queue: …/leads", first per client, no line at zero. Pure `lead-digest-section` (148 additive lines) local |
| 17 | **D-10** No figure from vendor statistics; "no samples"; empty CSV until the first client | ✓ VERIFIED | Truths 3–4; `reporting/copy.ts:59`; `partner-csv.ts:65-70` empty not zero; production `monthly_reports` 0 → the export is header-only today |
| 18 | **D-11** Quote behaviour unchanged; frozen reports byte-identical | ✓ VERIFIED | Byte-identical to `e7ee32b`: `src/core/attribution/`, `cadence/engine.ts`, `cadence/transitions.ts`, `src/core/servicem8/`; suites `approval-queue`, `sync-upsert`, `attribution-consume`, `cadence-engine`, `cron-schedules`, `inbound-stop`, `inbound-threading`. Report suites additions-only (`report-metrics` +44, `reporting-metrics` +38, `monthly-report` +138, `report-unchanged` +22, `report-frozen-fixture` +114 new). Acknowledged edits with deletions, each read: `pipeline-grouping` (pin re-pointed, 11+/2−), `privacy-page` (D-22 flip + WR-03 sentence, 94+/7−), `create-job-action` (builder moved to the shared helper, 37+/1−), `lead-job-create-db` (kind flip), `messaging-reconcile-route` (7 → 18 keys, 289+/7−), `proxy-host-routing`/`marketing-metadata` (`/leads` added to path lists), `text-back-gate` (order regenerated). `for-all-tenants.ts` keeps exactly 16 exports |
| 19 | **Console authorisation** `/leads`, the close action, the missed-call section and the CSV action authorise before any read | ✓ VERIFIED | Truths 1, 2, 4; `operator-authorization.test.ts` (+19) lists the new guarded paths; `rls-coverage` (+58) and `lint-ban` (+58) widened additively |
| 20 | **The reconcile route** 18 enumerated keys; every pass guarded | ✓ VERIFIED | `route.ts:147-152` messaging `.catch` → `MESSAGING_FAILED` + `messagingFailed` (WR-09); `:159` telephony `.catch`; `:166-169` privacy `.catch` → `PSEUDONYMISE_FAILED`; `:179-198` body enumerated field by field: 5 messaging + 3 telephony + 10 privacy = 18. Pepper read once at `:168`; `pseudonymise.ts:204` floor checked once before any read (IN-01). Pure `messaging-reconcile-route` local; production tick 200 |
| 21 | **Ops** Invariants script read-only, counts the unstamped backlog; pepper on Vercel by name | ✓ VERIFIED | `lead-privacy-invariants.mjs:86-111` one SELECT, both past-boundary counts `AND pseudonymised_at IS NULL` (WR-08), catalogue probe; six `name=value` lines; `ops-scripts` pin local. Run today: all zeros, 6 calls, 4 suppressions, schema applied. `vercel env ls` names `CALLER_PSEUDONYM_PEPPER` on Production and Preview; `env.ts:216` `z.string().min(32)`; `docs/env-vars.md:128` example line |
| 22 | **Three spike rows untouched; no live write by any task** | ✓ VERIFIED | Read-only SELECT today: `01a12438-259d…` and `01a12438-2cc6…` `Unsuccessful`/`poll`/`sm8_active=false`, zero `quote_status_events`, `quotes_source_lead=0` — identical to the Phase 14 read |

**Score:** 22/22 truths verified (0 present-but-behaviour-unverified). The behaviour-dependent truths (6, 7, 8, 9, 10, 11, 12, 14, 15) rest on the DB-backed suites this machine must not run against the hosted project; they are proven by CI run `38704147919` on `9c2f4a2` (success, every named suite ran, zero failure markers).

### Required Artifacts

`gsd-tools query verify.artifacts` over the eight PLANs: 15-01 6/6, 15-02 8/8, 15-03 5/5, 15-04 5/5, 15-05 3/3, 15-06 5/5, 15-07 5/5, 15-08 2/2 — all exist, all substantive, all wired (every artifact above is imported and called from the surface that needs it; see the truth table for the call sites).

### Key Link Verification

`verify.key-links`: 15-01 4/4, 15-02 3/3, 15-03 3/3, 15-08 1/1 by the tool. Seven links in 15-04/05/06/07 were reported `Invalid regex pattern` (a tool escaping error on `\\(`), NOT missing wiring; each was verified by direct grep:

| From | To | Via | Status |
|------|----|-----|--------|
| `leads/actions.ts:124` | `core/leads/close.ts` | `closeLead(tenantId, leadId, 'operator', new Date())` | WIRED |
| `clients/[id]/missed-calls-list.tsx:233` | `for-tenant.ts:5017` | `repo.missedCalls.listForLog({ before, limit: PAGE_SIZE })` | WIRED |
| `core/reporting/generate.ts:291,409` | `for-tenant.ts:6242` | `repo.metrics.missedCallCounts(period, timezone)` → `computeMissedCallFigures` | WIRED |
| `reports/export-actions.ts:87` | `core/reporting/partner-csv.ts:97` | `partnerCsv(inputs)` | WIRED |
| `core/aging/stalled-digest.ts:410` | `db/repository/leads.ts:326` | `countOverdueOpenLeads(now)` | WIRED |
| `api/internal/messaging-reconcile/route.ts:166` | `core/leads/pseudonymise.ts:190` | `runPseudonymisationPass({ now, pepper })` | WIRED |
| `core/leads/pseudonymise.ts:214,223` | `core/leads/pseudonym.ts:51` | `pseudonymiseCaller(value, pepper)` | WIRED |
| `core/leads/pseudonymise.ts:209,252` | `db/repository/leads.ts:475,557` | the two due-reads | WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data variable | Source | Real data | Status |
|----------|---------------|--------|-----------|--------|
| `leads/page.tsx` | `page.rows` → `cards` | `listOpenLeadsForQueue` (ids) + `queueCards` (per tenant) | DB query | FLOWING (0 rows in production by fact, empty state by design) |
| `missed-calls-list.tsx` | `rows` | `missedCalls.listForLog` keyset | DB query | FLOWING (6 rows in production) |
| `reports/[client]/page.tsx` | month-to-date block | `metrics.missedCallCounts` → `computeMissedCallFigures` | DB query | FLOWING |
| `reports/[client]/[reportId]/page.tsx` | `figures.missedCalls` | frozen `monthly_reports.figures` parsed by `reportFiguresSchema` | DB row | FLOWING (0 rows in production) |
| `export-actions.ts` | `rows` → `inputs` | `listLatestReportFiguresForExport` + tenants via JWT | DB query | FLOWING (header-only today) |
| `stalled-digest.ts` | `overdue` | `countOverdueOpenLeads` | DB query | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Pure suites | `npx vitest run <31 explicit files>` with the CI pepper inline | 31 files, 1,255 tests passed, 13.97 s | PASS |
| Typecheck / lint | `npm run typecheck`; `npm run lint` | both exit 0, no output | PASS |
| Unauthenticated doors | four `curl` POSTs with wrong signature/bearer | 401 ×4 | PASS |
| `/leads` gate | `curl -s GET app.backdesk.com.au/leads` | 307 → `/login` | PASS |
| Live privacy page | `curl` backdesk.com.au/privacy | 200; "Last updated 15 October 2026", "an Australian provider", "Twilio processes the call details outside Australia", "no later than 12 months after you booked" | PASS |
| Invariants | `npm run lead-privacy:invariants` | all zeros, 6 calls, 4 suppressions, `schema_0042_applied=true` | PASS |
| Cron | `npm run cron:status` | four jobs active, lease 0, no watchdog, last five 200 | PASS |
| Spike rows | one read-only SELECT | unchanged | PASS |
| DB-backed suites | CI `38704147919` | success, 211/211 files, 6,573 passed | PASS (by run id) |

### Probe Execution

No `probe-*.sh` is declared by any PLAN/SUMMARY and none exists under `scripts/*/tests/` — Step 7c not applicable. The phase's own read-only probe (`lead-privacy-invariants.mjs`) ran in this process; result above.

### Requirements Coverage

| Requirement | Source plans | Status | Evidence |
|-------------|--------------|--------|----------|
| CON-05 | 15-01, 02, 03, 04, 06, 08 | SATISFIED (live half relocated) | Truth 1 |
| CON-06 | 15-01, 02, 03, 05, 08 | SATISFIED (live half relocated) | Truth 2 |
| RPT-04 | 15-02, 03, 06, 08 | SATISFIED (live figures relocated) | Truth 3 |
| RPT-05 | 15-02, 03, 06, 08 | SATISFIED (data relocated) | Truth 4 |
| COMP-01 | 15-07, 08 (callers section itself: Phase 12 D-11) | SATISFIED | Truth 5 |
| COMP-02 | 15-01, 02, 03, 07, 08 | SATISFIED (first live run Jan 2027) | Truths 6–12 |

REQUIREMENTS.md maps exactly these six to Phase 15; every one is claimed by at least one plan — no orphans. The ticks in REQUIREMENTS.md are consistent with the code.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (49 reviewed source files) | — | no `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`, no placeholder phrases | — | none |
| `missed-call-figures.ts` | 70, 79 | `return null` | Info | intentional: "no samples" is `null`, not 0 (D-10) |
| `missed-calls-list.tsx` | 150 | `return null` | Info | an empty-state branch |
| 15-REVIEW IN-02..IN-08 | — | open by design (expiry label formula, duplicated constants, "Another client" rows, dead-letter payloads, ms/µs cursor tie, dead `not_found` arm, unscoped read-back pass) | Info | recorded; IN-08 is guarded by `env.ts:177` (a remote target without `ALLOW_REMOTE_TESTS=yes` throws before any suite runs) |
| ROADMAP.md Phase 15 | "Plans: 7/8 plans executed" | stale counter beside eight `[x]` boxes | Info | bookkeeping only; all eight SUMMARYs exist |

### Human Verification Required

See the frontmatter `human_verification` list — the 15-08 zero-row phone UAT list refined for the phone (the privacy date is now 15 October, not 13), plus the `.env.example` founder line and the event-gated live clauses relocated to the first client.

### Gaps Summary

No gaps. Every code-level must-have is present, substantive, wired and proven by a test that ran (locally for the pure suites, in CI `38704147919` for the DB-backed ones). Production is on `9c2f4a2` with migration 0042 applied, the pepper present by name, the four doors answering 401, `/leads` gated, the invariants at zero and the cron ticks green. The phase status is `human_needed` solely because the phone UAT and the live clauses are outside what a verifier can observe today.

---

_Verified: 2026-10-15_
_Verifier: Claude (gsd-verifier)_
