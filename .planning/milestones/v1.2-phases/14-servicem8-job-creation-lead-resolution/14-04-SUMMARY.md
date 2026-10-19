---
phase: 14-servicem8-job-creation-lead-resolution
plan: 04
subsystem: inbound door / leads / operator alerts / digest / docs
status: complete
tags: [lead-04, d-07, d-08, d-09, done-keyword, done_no_lead, digest, commercial-assumptions, runbooks]
requires:
  - 14-01 (DONE_LOOKBACK_HOURS, LEAD_JOB_MATCH_* constants, closed_by_tradie reason, escalations_lead_to_address_sent_idx, sm8_job_created_at)
  - 14-02 (the create-job form labels, the inbox chips, job_created)
  - 14-03 (booked_by_tradie written by the sync; commercial-assumptions §18 already in place)
provides:
  - isDoneKeyword / handleTradieDone (src/core/leads/done-keyword.ts)
  - InboundSmsResult arms done_closed and done_no_lead; handleInboundSms(input, { now?, alert? })
  - tenantsOwningNumber and countLeadResolutionsSince (src/db/repository/leads.ts, a new family file)
  - latestSentLeadEscalationTo (src/db/repository/escalations.ts)
  - The done_no_lead operator alert kind (alertSubject arm, doneNoLeadAlertBody, routing)
  - Two Leads lines in the 06:30 digest
  - commercial-assumptions §16–§17; go-live runbook section 3 DONE paragraph and section 19; divert runbook 0.5 and 8.4 lines
  - seedEscalationSent and the CI-only tests/lead-done-keyword.test.ts
affects:
  - 14-05 (the CI gate is the first run of tests/lead-done-keyword.test.ts and of the three new reads against Postgres)
tech-stack:
  added: []
  patterns:
    - "A keyword branch at the door between the normalisation and the lookup, guarded by !isStop, returning null to fall through unchanged"
    - "A family read that starts from a number (tenant ids out, the number compared and never selected) instead of a seventeenth forAllTenants_* export"
    - "One count(*) FILTER (WHERE …) statement per digest read, counts only"
    - "DB suite isolation by clock: each scenario runs a week after the last so the newest-send read can only find its own row"
key-files:
  created:
    - src/core/leads/done-keyword.ts
    - src/db/repository/leads.ts
    - tests/done-keyword.test.ts
    - tests/lead-done-keyword.test.ts
  modified:
    - src/core/messaging/inbound.ts
    - src/db/repository/escalations.ts
    - src/db/repository/index.ts
    - src/core/alerts/operator-email.ts
    - src/core/aging/stalled-digest.ts
    - tests/lint-ban.test.ts
    - tests/lead-digest-section.test.ts
    - tests/helpers/seed.ts
    - tests/runbook-contract.test.ts
    - docs/commercial-assumptions.md
    - docs/first-client-go-live-runbook.md
    - docs/client-divert-onboarding-runbook.md
decisions:
  - "done_no_lead is one operator email per event through sendOperatorAlert, not a once-per-day claim — operator_alert_log's CHECK is untouched and no journal entry was added (D-10)"
  - "A number on two clients' own-number sets: the escalation read takes every owning tenant; with nothing to close the row and the alert go to the lowest tenant id; one warn line names each further owner (checker I5)"
  - "handleTradieDone catches a throw from the tenant-name read or the alert after the row is written, so the provider's retry can never record the reply twice"
  - "The DB suite isolates scenarios by pinned clock (one week apart) rather than by number, because every scenario texts from the same escalation phone"
metrics:
  duration: "~18 min"
  completed: 2026-10-10
  tasks: 3
  files: 16
estimate:
  tokens: 85000
  tasks: 3
actuals:
  tokens: 18000
  tasks: 3
  commits: 5
requirements-completed: []
requirements-advanced: [LEAD-04]  # pure suites green; the DB proof first runs at 14-05's CI gate and nothing is live until 0041 is applied (not marked complete, as in 14-02/14-03)
---

# Phase 14 Plan 04: DONE at the door, the done_no_lead alert, the digest lines, and the constants and runbooks Summary

A tradie can now close his own lead with one word. When a reply contains the whole word DONE, in any case, and comes from a client's escalation phone or from a line on that client's never-text list, the inbound door closes the lead whose escalation was most recently **sent** to that number within the last 48 hours. The close reason is `closed_by_tradie`. It goes through the `closeLead` wrapper, which stops the lead's cadence `lead_closed`. The reply is recorded pre-triaged against the tenant, and nobody is texted back.

If no lead was escalated to that number, nothing is closed. The reply waits untriaged in the inbox and the operator gets one email, `DONE received for <client> — no lead to close`. A DONE from any other number takes exactly the path it took before. A STOP from any number is still a STOP.

The 06:30 digest's Leads section gains two lines per client. Every constant the phase chose is now recorded in commercial-assumptions §16–§18, and the runbooks describe the tap, the sheet, DONE and the tradie-booked rule.

## Tasks

| # | Task | Commit | Key files |
|---|------|--------|-----------|
| 1 RED | Failing pins: matcher, door order, no-send imports, log interpolations, branch decisions, alert words | `01528a2` | tests/done-keyword.test.ts |
| 1 GREEN | DONE at the door; three family reads; done_no_lead alert; DB suite for CI | `624cf68` | done-keyword.ts, inbound.ts, leads.ts, escalations.ts, index.ts, operator-email.ts, lint-ban, seed.ts, lead-done-keyword.test.ts |
| 2 RED | Failing pins: the two digest lines and their wiring | `7512c2b` | tests/lead-digest-section.test.ts |
| 2 GREEN | Two digest lines from one counts-only read | `ea3bfcd` | stalled-digest.ts |
| 3 | commercial-assumptions §16–§17, runbook lines, runbook-contract pins | `984b456` | docs ×3, runbook-contract.test.ts |

## Result kinds added to `InboundSmsResult`

```ts
| { kind: 'done_closed'; inboundId: string; tenantId: string; leadId: string; close: 'closed' | 'already_closed' }
| { kind: 'done_no_lead'; inboundId: string; tenantId: string }
```

`handleInboundSms(input, options = {})` now takes `{ now?: Date; alert?: typeof sendOperatorAlert }`. Both route handlers and every existing test call it with one argument, unchanged.

The branch, between `normalizeAuMobile(input.from)` and `forAllTenants_cadencesByContactMobile(`:

```ts
if (!isStop && isDoneKeyword(input.body)) {
  const done = await handleTradieDone(base, normalizedFrom, options.now ?? new Date(), {
    alert: options.alert ?? sendOperatorAlert,
  });
  if (done !== null) return done;
}
```

The inbound.ts diff against the phase base is additive except one line: the old final arm of the result union lost its `;` so that the two new arms could follow it. The STOP decision and the normalisation are byte-identical, and inbound.ts has no new `console.` call. A local replay of the `tests/inbound-threading.test.ts` log pin's extractor yields the same interpolation set as the phase base.

## The three barrel names (a dated Phase 14 block in index.ts; lint-ban list +3)

| Name | Family / file | Returns |
|------|---------------|---------|
| `tenantsOwningNumber(e164)` | leads (`src/db/repository/leads.ts`, new) | Sorted, deduplicated tenant ids. The never-text list ∪ the escalation phone, normalised in TypeScript |
| `latestSentLeadEscalationTo(tenantIds, toAddress, since)` | escalations | `{ tenantId, leadId } \| null`. The query is `outcome = 'sent'`, `lead_id IS NOT NULL`, `sent_at >= since`, newest first, limit 1 |
| `countLeadResolutionsSince(since)` | leads | `{ tenantId, jobsCreated, bookedByTradie }[]` from one `count(*) FILTER (WHERE …)` statement. Rows with both counts zero are dropped |

`forAllTenants_*` stays at 16.

## The digest lines, verbatim

```
{client}: {n} ServiceM8 job created from leads in the last 24 h        (n = 1)
{client}: {n} ServiceM8 jobs created from leads in the last 24 h       (n > 1)
{client}: {n} lead booked by the tradie in the last 24 h               (n = 1)
{client}: {n} leads booked by the tradie in the last 24 h              (n > 1)
```

Within a client the lines run cold, then held, then jobs created, then booked by the tradie. A zero count renders no line. A tenant the directory cannot name renders `unknown client`. The read sits inside the Leads section's own `try`, after `listHeldEscalationsSince`, with the same `since`. Its tenants join the directory-fallback check. A rejection costs the Leads paragraph, not the email.

## The done_no_lead alert, verbatim

Subject: `DONE received for {client} — no lead to close` (control characters are stripped).

```
A DONE reply arrived from one of this client’s own numbers, but no lead
was escalated to that number in the last 48 hours, so nothing was closed.

Client: {client}
Received: {YYYY-MM-DD HH:MM:SS} UTC

The reply is waiting in the inbox. Find the lead the tradie meant and
close it there, or mark the reply handled.

{console}/clients/{tenantId}
```

The `48` is interpolated from `DONE_LOOKBACK_HOURS`. `SyncAlertKind` excludes `done_no_lead`, so neither the sync arms nor `alertBody` moved.

## Verification

- **Task 1 `<automated>`:** passed. The run covered done-keyword, lint-ban, stop-keywords, urgency-keywords and classification-privilege (180 tests), typecheck, lint (0 warnings), the sixteen-export pin and `handleTradieDone(` appearing once. The door, sync and must-not-move pins are byte-identical to `bd8beb3`.
- **Task 2 `<automated>`:** passed. lead-digest-section, stalled-drafts and lint-ban (72 tests); the line greps each `== 1`; cron-schedules, report-metrics, sync-upsert and apply-cron-schedules.mjs byte-identical.
- **Task 3 `<automated>`:** passed. runbook-contract, client-divert-runbook and audit-aggregate (148 tests). The docs diff has no `+61`, no 64-hex string and no `X-API-Key:`.
- **Every pure suite**, i.e. every test file that imports neither the seed helper nor the env helper: **125 files, 4,900 tests, all passing** after the last commit. clicksend-inbound-route and audit-request-notify were also run explicitly after Task 1.
- **Never run:** `tests/lead-done-keyword.test.ts` and every other DB suite, `npm run test:remote`, `db:migrate`. Nothing was pushed (`main` is 23 commits ahead of origin).

## Deviations from Plan

### Auto-fixed / interpretation

**1. [Ordering] `countLeadResolutionsSince` was implemented in Task 1, not Task 2**
- The plan declares the barrel export in Task 1 "so Task 2 adds no export". A barrel line needs the function to exist, so the read itself landed in Task 1's commit `624cf68`. Task 2's commit touched only the digest module. The function's shape is the one Task 2 specifies.

**2. [Rule 3 - Blocking] The digest's doc comment could not quote its own lines**
- Task 2's verify asserts `grep -c 'created from leads in the last 24 h' == 1` (and the same for the booked line), so the header comment reads `… (last 24 h)` instead of quoting the phrase. The meaning is unchanged.
- **Commit:** `ea3bfcd`

**3. [Rule 2 - Correctness] No throw after the row is written**
- On the not-found path the row is inserted before the tenant-name read and the alert. A throw from either would become a non-2xx, and ClickSend's retry would record the reply twice and send a second email. Both are wrapped, and a fixed string is logged. `sendOperatorAlert` never throws by contract; this guards an injected or future alert.
- **Commit:** `624cf68`

**4. [Interpretation] Log lines name ids and kinds only, so the 48 is not in the log**
- The pure pin requires every interpolation in done-keyword.ts to end in `Id` or `kind`, so the not-found log says "inside the DONE lookback" instead of "in the last 48 h". The alert body interpolates the constant.

**5. [Addition] Branch-decision cases in the pure suite**
- `tests/done-keyword.test.ts` also drives `handleTradieDone` over a mocked barrel and close wrapper. It covers fall-through with no writes, close-then-row order, `already_closed`, the untriaged row with one alert, a failed alert, and the I5 shared-number cases. These run locally, ahead of the DB suite's first CI run.

**6. [Addition] runbook-contract pins**
- The plan asked for one label plus a `DONE` / `booked by tradie` fact pin. The suite now also pins `Retry ServiceM8 job`, the failed-state spelling the runbook names, and cross-checks it against the form. It also pins `closed by tradie` and `Needs review`.

**7. [Docs] §18's preface updated**
- §18 said that §16–§17 "are reserved". It now says that §18 was written before them. The footer reads "§11–§18" in both places.

### Not changed, by rule
- `stop-keywords.ts`, `close.ts`, `for-all-tenants.ts`, every door suite, `operator_alert_log` and the journal are untouched. The classifier knows nothing about DONE.

## TDD Gate Compliance

- **Task 1:** RED `01528a2` (the module was missing, so the suite failed to load), then GREEN `624cf68`.
- **Task 2:** RED `7512c2b` (8 of 21 tests failing), then GREEN `ea3bfcd`.
- No refactor commits. Each RED commit does not typecheck, by design, as in 14-01 and 14-03.

## Hazards for 14-05's CI gate

1. **First execution against Postgres** of `tenantsOwningNumber`, `latestSentLeadEscalationTo` and `countLeadResolutionsSince`:
   - `tenantsOwningNumber` uses `selectDistinct` on `tenant_never_text_numbers`.
   - `latestSentLeadEscalationTo` uses `inArray` over the tenant ids and `desc(sent_at), desc(id)`.
   - `countLeadResolutionsSince` embeds drizzle `and(eq, gte)` conditions inside a `count(*) FILTER (WHERE …)` template. The timestamps are bound through the column mapping, not as raw Dates.
   - The digest's DB-backed callers (`tests/onboarding-checklist-gate.test.ts` and `tests/stall-tick.test.ts` run the real `runStalledDigest`) now execute the count read too. A SQL error there would only log `lead reads failed` and drop the Leads paragraph. It would not fail those suites unless they assert the Leads section.
2. **`tests/lead-done-keyword.test.ts`** (10 cases) assumes the following:
   - The admin client can update `tenants.escalation_phone`.
   - `seedEscalationSent`'s row satisfies `escalations_one_trigger` (a fresh `inbound_message_id`) and `escalations_release_needs_hold`.
   - No other tenant in the CI database owns `+61491570641`–`643` or `640`.
   - Its STOP case fans a bare-mobile suppression of the escalation phone out to every tenant present at that moment. `afterAll` deletes those suppressions by address and the two tenant-less inbound rows by id.
3. **Every inbound SMS whose body contains the word "done"** now costs two extra reads, `tenant_never_text_numbers` by number and `tenants.escalation_phone` for all tenants, before the cadence lookup. That is bounded by the client count. For a customer it returns `[]` and the door continues as before.
4. **The classifier will still label a DONE row** in the quote vocabulary, like any unmatched reply (research Q5). This is accepted and has no effect, because label effects act on lead rows only.

## Carried forward (for STATE.md)

- **Phase 15 candidate: a `recent_conversion` text-back gate skip** (research OQ4, accepted for v1.2). A caller whose lead converted recently (`job_created` / `booked_by_tradie`) and who rings again is texted back again, and a new lead opens (Pitfall 7). A gate skip keyed on a recent conversion would stop the second text.

## Known Stubs

None. Every new read is wired: the door calls the two DONE reads, and the digest calls the count read.

## Threat Flags

None beyond the plan's register. The mitigations are in place:
- **T-14-05:** own-number sets only, newest sent escalation to that number, 48 h.
- **T-14-06:** deterministic, before any lookup, classifier untouched.
- **T-14-09:** ids, counts and the client name only. The docs and log greps are clean.
- **T-14-16:** `!isStop`, order pinned in source, door suites byte-identical.
- **T-14-17 (accepted):** one email per event.

## Self-Check: PASSED

- Created files exist: src/core/leads/done-keyword.ts, src/db/repository/leads.ts, tests/done-keyword.test.ts, tests/lead-done-keyword.test.ts.
- Commits 01528a2, 624cf68, 7512c2b, ea3bfcd and 984b456 are in the log.
- `git status --porcelain` was empty before this summary was written.
