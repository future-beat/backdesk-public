---
phase: 15-lead-console-reporting-privacy
plan: 07
subsystem: privacy / retention (nightly pass, messaging-reconcile tick, public notice, operator docs)
status: complete
tags: [pseudonymisation, comp-01, comp-02, d-05, d-06, messaging-reconcile, privacy-notice, hmac, read-back, runbook]
requires:
  - 15-01 (migration 0042: pseudonymised_at on leads / missed_calls / inbound_messages, the hash-admitting leads CHECK; PSEUDONYMISE_AFTER_DAYS, PSEUDONYMISE_BATCH; CALLER_PSEUDONYM_PEPPER in the env schema and the CI dummy)
  - 15-02 (src/core/leads/pseudonym.ts, pseudonymiseCaller with the 32-char floor)
  - 15-03 (listLeadsDueForPseudonymisation, listMissedCallsDueForPseudonymisation, forTenant leads.pseudonymise, missedCalls.listRawForLead, missedCalls.pseudonymise; tests/pseudonymise-structure.test.ts)
provides:
  - "src/core/leads/pseudonymise.ts: runPseudonymisationPass({ now, pepper }), PseudonymisationResult, PSEUDONYMISE_NOTHING, PSEUDONYMISE_FAILED"
  - "messaging-reconcile route: third awaited pass, pepper read once at the edge, nine body fields by name (7 -> 16 keys)"
  - "tests/pseudonymise.test.ts: the DB-backed read-back suite (CI-only; first runs at 15-08's gate)"
  - "Pure pins: route cases + key-count move, pass-module structure describe (f), text-back-structure directory list, privacy-page flip + dated describe"
  - "Privacy notice callers ¶4 (processors and where) and ¶6 (ninety-day pseudonymisation); dateLine 13 October 2026"
  - "docs: commercial-assumptions §19 and §20, go-live runbook §20, divert runbook §0.4 retention sentences, CALLER_PSEUDONYM_PEPPER registration entry (no value)"
affects:
  - 15-08 (the CI gate is the first run of tests/pseudonymise.test.ts and therefore the first execution of the 15-03 writes and due-reads; the pepper must be on Vercel Production + Preview BEFORE the deploy; the decision checkpoint that makes the pass live; the status-table row and push record for the pepper)
  - 15-06 (no file overlap; the route body grew to 16 keys)
tech-stack:
  added: []
  patterns:
    - "A retention pass rides an existing nightly tick: awaited, never throws (per-pass catch returning a FAILED shape), route .catch belt, counts by name in the body"
    - "One transaction per due lead with the parent stamp last; a refused parent throws inside the transaction so no child is left hashed under an unstamped lead; tallies added only after commit"
    - "Two-argument count logs console.log(label, count) — no template literal on any console line, pinned structurally"
    - "DB read-back of a GLOBAL pass in a shared database: pre-read the due sets at the pinned instant, assert this suite's ids in/out of them, and assert the pass's counts exactly against the pre-read (own rows plus any foreign due rows and their children)"
key-files:
  created:
    - src/core/leads/pseudonymise.ts
    - tests/pseudonymise.test.ts
  modified:
    - src/app/api/internal/messaging-reconcile/route.ts
    - tests/messaging-reconcile-route.test.ts
    - tests/pseudonymise-structure.test.ts
    - tests/text-back-structure.test.ts
    - src/app/(marketing)/copy.ts
    - tests/privacy-page.test.ts
    - docs/commercial-assumptions.md
    - docs/first-client-go-live-runbook.md
    - docs/client-divert-onboarding-runbook.md
    - docs/external-registrations.md
decisions:
  - "A lead the final leads.pseudonymise statement refuses (counts.leads !== 1 — stamped or changed between the due-read and the write) throws inside its transaction, rolling back the missed-call hashes written before it; it counts as failed and is re-selected next night if still due"
  - "The lead's caller hash is computed OUTSIDE the per-lead try, so a pepper under the floor fails the whole pass (passFailed: true) before any write instead of counting every lead as failed"
  - "The read-back suite asserts the pass's counts exactly against a pre-read of the two due-reads at the same instant (own seeds plus any foreign due row and its children), because the pass is global and the CI database is shared — the 15-03 lead-queue rule applied"
  - "The paste-ready retention paragraph's two em dashes became parentheses: tests/marketing-copy.test.ts (LAND-01 M1) bans em dashes in every marketing string"
  - "The go-live runbook says where the nine counts are actually readable (the dispatch's pg_net response body and the [pseudonymise] lines in the Vercel log) — npm run cron:status prints status codes only"
metrics:
  duration: 16min
  completed: 2026-10-13
  tasks: 3
  files: 12
actuals:
  tokens: 18800
  tasks: 3
  commits: 4
---

# Phase 15 Plan 07: The Retention Pass and the Words That Promise It Summary

The nightly pseudonymisation pass (`runPseudonymisationPass`) now rides the 03:30 `messaging-reconcile` tick. It HMACs every due caller number on every carrier, one transaction per lead with the lead's stamp last, and lead-less calls one guarded row at a time, at most 200 per kind. It never throws and logs counts only. Nine counts reach the tick's body by name. A DB-backed read-back suite is written for CI. The privacy notice's callers section now says who processes the details and where, and states the ninety-day pseudonymisation. §19–§20, the runbook steps and the pepper's registration entry are recorded.

## What was built

### The pass (`src/core/leads/pseudonymise.ts`)

- Imports `forTenant` and the two due-reads from `@/db/repository`, `PSEUDONYMISE_BATCH` from `./constants`, and `pseudonymiseCaller` from `./pseudonym`. Nothing else. No SDK, no environment, and no opt-out table named.
- **Due leads:** `listLeadsDueForPseudonymisation(now, PSEUDONYMISE_BATCH)`. For each lead, one `forTenant(tenantId).transaction` does the following:
  1. `missedCalls.listRawForLead`, then `missedCalls.pseudonymise` per call. `caller_e164`, `caller_raw` and `forwarded_from_raw` are each hashed on their own value, and a NULL stays NULL.
  2. `leads.pseudonymise` runs last: inbound, cadence and ledger rows, then the lead's hash and stamp in one statement.
  3. If the lead is refused, the transaction throws and rolls back.

  Tallies are added only after the commit: `leadsClosed` or `leadsConverted` by status, plus the three child row counts.
- **Lead-less calls:** `listMissedCallsDueForPseudonymisation(now, PSEUDONYMISE_BATCH)`, then `forTenant(tenantId).missedCalls.pseudonymise` one row at a time.
- **Failure handling:** a per-row failure adds 1 to `failed` and logs a fixed string with no id. A whole-pass throw logs `[pseudonymise] pass failed` and returns `PSEUDONYMISE_FAILED`.
- **Logs:** eight `console.log('[pseudonymise] <kind>', result.<count>)` lines.
- **Header:** covers all of D-06, including research Q6's gate ruling. `PSEUDONYMISE_AFTER_DAYS` is the cool-off, so no gate window ever contains a hash, and STOP survives because the suppression rows are kept raw.

### The route (sixteen body fields)

The seven existing fields are `skipped`, `receiptsApplied`, `inboundReplayed`, `optOutsRecorded`, `missedCallsRecovered`, `recordingsFound` and `recordingsCheckFailed`.

The nine new ones are `pseudonymisedLeadsClosed`, `pseudonymisedLeadsConverted`, `pseudonymisedMissedCallsWithLead`, `pseudonymisedMissedCallsNoLead`, `pseudonymisedInboundRows`, `pseudonymisedCadenceRows`, `pseudonymisedLedgerRows`, `pseudonymiseFailed` and `pseudonymisePassFailed`.

The call is `runPseudonymisationPass({ now: new Date(), pepper: getServerEnv().CALLER_PSEUDONYM_PEPPER }).catch(() => PSEUDONYMISE_FAILED)`. It is awaited after the telephony sweep, and `maxDuration` is unchanged at 300.

### The read-back suite (`tests/pseudonymise.test.ts`, DB-backed, CI only)

- **Clock and pepper:** NOW is pinned to `2026-10-20T00:00:00Z`. The pepper is a 47-character non-hex literal passed in directly, never read from the environment.
- **Tenants:** one armed tenant (text_back on, SMS identity `…369`, attested templates) and one plain second tenant.
- **Fiction numbers:** all in the sub-blocks `+6149157035x` and `+6149157036x`, namely 351, 352, 353, 354, 355, 357, 358, 359, 361 and 369. The landline-shaped strings are `+61891570350` (forwarded), `+61891570356` (e2) and `+61891570360` (withheld forwarded). Every word is invented.

| Seed | Shape | Expected |
|------|-------|----------|
| (a) …351 | closed `not_a_lead`, 91 d ago | every carrier hashed and stamped |
| (b) …352 | closed `other`, 89 d ago | untouched, byte-identical |
| (c) …353 | converted `job_created`, quote Completed 91 d ago | every carrier hashed |
| (d) …354 | converted `booked_by_tradie`, quote Work Order | untouched |
| (d2) …355 | converted `job_created`, quote Completed 30 d ago | untouched |
| (e) withheld | lead-less, 91 d ago, `caller_raw 'anonymous'`, forwarded set | stamped; `caller_e164` NULL; raw strings hashed |
| (e2) other number | lead-less, 91 d ago, forwarded NULL | `caller_e164` hashed; forwarded stays NULL |
| (e3) …357 | lead-less mobile, 10 d ago | untouched |
| (f) …358 | closed `opt_out`, 91 d ago, plus an sms suppression row | hashed; suppression row raw; a new call → `skipped` / `suppressed`, no lead |
| (g) …359 | OPEN, first call 100 d ago | untouched |
| (h) …361 | second tenant, closed `spam`, 91 d ago | hashed under its own tenant |

Each lead carries the full carrier set:
- a missed call with `caller_raw` (spelled `0491 570 3xx`) and `forwarded_from_raw`
- a lead cadence
- one threaded inbound row with an invented body
- one ledger row

The suite then checks:
- **Due-set pre-read:** the boundary is proven at the read.
- **Exact counts** against the pre-read.
- **Per-carrier read-back:** the hash is recomputed with `pseudonymiseCaller(value, P)`, `body` is byte-identical, and the stamps equal NOW.
- **Untouched rows:** deep-equal to their pre-run snapshot.
- **Second run:** all zero, and (a)'s rows are column-for-column unchanged, `updated_at` included.
- **Gate check:** goes through `sendTextBack`.
- **Log scan:** over every `console.*` line from both runs — no `+61`, no nine-digit run, no 64-hex string, and no seeded id.
- **Teardown:** `messaging_config` by id first, then the suppression row by id, then `teardownTenants`.

### The notice (`PRIVACY_COPY`)

- **¶4:** research Q5 verbatim — Twilio in the United States through its Sydney edge, ClickSend from Australia, both processing outside Australia, Anthropic in the United States with a person approving, Supabase in Sydney, Vercel in Sydney.
- **¶6:** research Q5 with the two em dashes replaced by parentheses: "Ninety days after a lead closes without becoming a job, we replace your number in that record (on the call, on the lead and on your messages) with a code we cannot turn back into a number; …". It also states that a customer's number is kept until the job is finished plus 90 days, that STOP is kept for as long as it is needed, and that callers can ask for removal sooner.
- **Unchanged:** ¶1–¶3 and ¶5 are byte-identical. Twilio and ClickSend stay inside `callers`. The processors and where sections are untouched. Bedrock is named nowhere.
- **dateLine written:** `Last updated 13 October 2026. Backdesk is operated by ${OPERATOR_LEGAL_NAME}, ${BUSINESS_LOCATION}.…` The diff against the phase base shows exactly one `-` and one `+` line containing `Last updated`.

### The documents

- **`docs/commercial-assumptions.md`:** §19 `LEAD_RECENT_CONVERSION_HOURS` = `24` and §20 `PSEUDONYMISE_AFTER_DAYS` = `90` (defined as the cool-off) / `PSEUDONYMISE_BATCH` = `200`, in the §16–§18 shape. The footer now reads §11–§20.
- **Go-live runbook §20** "Caller privacy — the nightly pseudonymisation pass (Phase 15)" covers:
  - what runs (no new job, no `cron:apply`)
  - what is replaced and what is kept
  - when rows fall due, with the January 2027 note
  - how to read the nine counts, and that a failure is a next-morning check, never SQL repair
  - the pepper's handling (`vercel env ls production` for presence, never `vercel env pull`, rotation is a recorded decision)
  - what the client is told

  It has an artefact table.
- **Divert runbook §0.4:** the retention promise in two sentences, plus "read it with the rest of 0.5". No pinned line moved.
- **`docs/external-registrations.md`:** a dated `CALLER_PSEUDONYM_PEPPER` entry covering what it keys, where it is read, where it lives, who generates it, how presence is checked and the rotation rule. It holds NO value. The status-table row is left to 15-08.

## Verification

- **Task 1 `<automated>`:** passed. The `git diff --quiet` clause passes for `tests/cron-schedules.test.ts`, `scripts/apply-cron-schedules.mjs`, `src/core/telephony/reconcile.ts` and `src/core/messaging/reconcile.ts` against the phase base. `text-back.ts` and `gate.ts` are byte-identical to `6ee653f` (the end of 15-01); see deviations.
- **Task 2 `<automated>`:** passed — typecheck, lint, the import, run, `suppressed`, fiction, header and pure-suite clauses.
- **Task 3 `<automated>`:** passed, including the docs-diff grep. Its result: **0 added lines** across `docs/` and `copy.ts` matching `+61<digit>`, a 64-hex string, `X-API-Key:` or `postgres://`.
- **Plan-level pure run** (CI dummy pepper inline, no env file named): `messaging-reconcile-route`, `pseudonymise-structure`, `text-back-structure`, `pseudonym`, `privacy-page`, `text-back-template`, `runbook-contract`, `client-divert-runbook`, `lint-ban`, `marketing-metadata`, `audit-aggregate`, `text-back-gate`, `console-error-leak` — **13 files, 1032 tests passed**.
- **Second pure sweep** over every source-scanning suite plus `marketing-copy` and `arming-actions` — **18 files, 871 tests passed**.
- **Not run locally:** `tests/pseudonymise.test.ts`, any DB suite, `test:remote`, `db:migrate`, `cron:apply`. Nothing was pushed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The paste-ready retention paragraph broke the notice's voice rule**
- **Found during:** the plan-level pure sweep after Task 3.
- **Issue:** research Q5's ¶6 contains two em dashes. `tests/marketing-copy.test.ts` (LAND-01, M1) refuses an em dash in every marketing string. That suite was not in Task 3's verify list, so the Task 3 commit went red there.
- **Fix:** the aside is now in parentheses. Everything else is verbatim, and every privacy pin still passes.
- **Files modified:** `src/app/(marketing)/copy.ts`
- **Commit:** 80a2885

**2. [Rule 2 - Correctness] A refused lead rolls back its whole transaction**
- **Found during:** Task 1.
- **Issue:** As specified, the lead's missed calls were hashed before `leads.pseudonymise`. If the final guarded statement refused the lead (stamped or changed meanwhile, for example by an overlapping run), those calls would have committed hashed under an unstamped lead.
- **Fix:** `counts.leads !== 1` throws inside the transaction, which rolls everything back. The lead counts as `failed`, and tallies are added only after the commit.
- **Commit:** daaa012

**3. [Rule 1 - Test robustness] The read-back counts are exact against a pre-read, not bare literals**
- **Found during:** Task 2.
- **Issue:** The plan's `leadsClosed 3` (and so on) assume the shared CI database holds no other due row. The pass is global.
- **Fix:** Before the first run, the suite calls both due-reads at the same instant. It asserts that its own due and not-due ids are in and out of those sets, which is the boundary proven at the read. It then asserts the pass's result `toEqual` the counts derived from the pre-read: its own four leads and their children, plus any foreign due lead and that lead's children counted the same way. On a clean CI database this is exactly the plan's numbers. A second block keeps the plan's lower bounds on its own rows.
- **Commit:** 113b1c9

**4. [Verify clause] `text-back.ts` and `gate.ts` in Task 1's `git diff --quiet`**
- The clause diffs against the phase base, which predates 15-01's `6ee653f`, and that commit edited both files (15-03 recorded the same).
- Both files are byte-identical to `6ee653f`, the state 15-01 left them in, which is what the acceptance criterion asks. The other four paths passed as written.

**5. [Doc accuracy] Where the nine counts are read**
- The plan says "`npm run cron:status` → the tick's response". `scripts/cron-status.mjs` prints status codes only.
- Runbook §20 instead says that `cron:status` shows the 03:30 dispatch answered 200, and that the nine counts are in that dispatch's response body (kept by pg_net) and in the `[pseudonymise] …` lines of the Vercel function log.

**6. Minor implementation choices**
- The key-count pin `toHaveLength(16)` appears exactly once, as the acceptance criterion requires. The rejected-pass case compares against `Object.keys(RESULT).length`.
- The suite imports the seed module once more, as a single-line `import type { MissedCallSeedOptions } from './helpers/seed'`, because the verify grep reads one line. The type is used for the withheld seed.
- The structure pin's backtick check reads comment-stripped lines, because the header quotes `console.log(label, count)`. The `${` check reads every raw line, as the plan's grep does.

## Hazards for 15-06 / 15-08

- **First Postgres execution:** 15-08's CI gate is the first run of `tests/pseudonymise.test.ts`. That makes it the first time `listLeadsDueForPseudonymisation` (the EXISTS on quotes with `coalesce(…) <= sql.param(boundary, …)`), `listMissedCallsDueForPseudonymisation`, `leads.pseudonymise` (the EXISTS-in-UPDATE guard on three child tables, then the lead hash and stamp in one statement under 0042's widened CHECK), `missedCalls.listRawForLead` and `missedCalls.pseudonymise` ever execute against Postgres.
  - A 23514 on `leads` means the hash and the stamp were split.
  - A 23514 on `missed_calls_withheld_has_no_number` would mean a NULL was hashed. The pass maps NULL to NULL.
- **Seed assumptions to check if the suite reds on an insert:**
  - A converted `booked_by_tradie` lead with `sm8_job_uuid` set and `sm8_job_state` left at its default.
  - Closed and converted leads holding an `active` lead cadence (15-03 noted this is not forbidden).
  - A lead-linked missed call with no `text_back_status`.
  - An inbound row `body 'STOP'` with `is_stop false` on (f).
- **Gate check:** relies on rule order (suppressed is rule 5, before every per-caller lead read) and on the call ending 15 s before the pinned NOW. The suite uses the text-back-recent-conversion mould exactly.
- **Global pass in a shared database:** a leaked due row from another suite is absorbed by the pre-read, unless more than 200 are due. The suite asserts the due set fits one batch, so a red there means a suite is leaking closed leads.
- **Pepper ordering (15-08):** `CALLER_PSEUDONYM_PEPPER` must exist on Vercel Production and Preview BEFORE the deploy, or every route fails at `getServerEnv()`. `docs/external-registrations.md` has the entry; the status-table row and the push record are 15-08's.
- **The pass is a one-way door once deployed.** No production row falls due before early January 2027, the founder's Phase 11 verification-call rows being first. The deploy decision is 15-08's checkpoint.
- **Route body:** now 16 keys. Any other consumer that pins the body shape (none found in `tests/`) would need the same move.
- **Copy review (A5):** ¶4 says ClickSend sends "from Australia" and then "Both process these details outside Australia". That is research Q5's wording kept verbatim, and the founder should read it at UAT.

## Known Stubs

None. The pass is wired to the real reads and writes, and the route calls it.

## Threat Flags

None. No new endpoint, auth path or schema change. The pass runs behind the route's existing bearer check (T-15-13), and every threat-register mitigation for T-15-01, 05, 06, 07 and 16 is implemented and pinned.

## TDD Gate Compliance

Task 1 is `tdd="true"` inside a `type: execute` plan. The route and structure cases were written first and seen failing (11 failures across the three suites) before the module and the wiring existed. Per the plan's commit instruction, RED and GREEN landed in one `feat` commit rather than separate `test`/`feat` commits.

## Self-Check: PASSED

- Files exist: `src/core/leads/pseudonymise.ts`, `tests/pseudonymise.test.ts`, and this SUMMARY.
- Commits exist: daaa012, 113b1c9, b32619b, 80a2885.
