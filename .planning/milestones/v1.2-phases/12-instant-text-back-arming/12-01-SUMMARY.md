---
phase: 12-instant-text-back-arming
plan: 01
subsystem: telephony / cadence / database
status: complete
tags: [text-back, migration-0039, leads, ledger, gate, tracer]
requires:
  - Phase 11 telephony capture (missed_calls, voice-status door, tenant_divert_numbers)
  - Phase 4 send ledger and RoutingSender (claimedProviderFor, resolveSmsFrom)
provides:
  - Migration 0039 (one journal entry, idx 39, written NOT pushed)
  - src/core/leads/{constants,gate,template,text-back}.ts
  - Repository lead path (createLead, leads, neverText, textBackTemplates, missedCalls decision writes, isTextBackArmed, getMissedCallForTextBack)
  - voice-status → sendTextBack call site
  - D-07 constants (TEXT_BACK_DAILY_CAP, CLICKSEND_BALANCE_ALERT_FLOOR_CENTS, CLICKSEND_BALANCE_DISARM_FLOOR_CENTS)
affects:
  - 12-02 (lead-cadence inert DB proof), 12-03 (CI run + migration push), 12-05 (D-08 replaces the quote_open arm), 12-08 (MESSAGING_CHANNELS widening + arming gate)
tech-stack:
  added: []
  patterns:
    - "Claim → decide → ledger claim in ONE transaction; send after commit; NULL outcome never resent"
    - "Pure ordered gate with explicit null guard (firstUnmetGate shape)"
    - "Targeted ON CONFLICT on a partial index for the lead arbiters; quote create stays targetless"
key-files:
  created:
    - scripts/missed-calls-invariants.mjs
    - src/db/schema/leads.ts
    - src/db/schema/text-back-templates.ts
    - src/db/schema/tenant-never-text.ts
    - src/db/schema/operator-alert-log.ts
    - src/db/migrations/0039_phase12_text_back.sql
    - src/db/migrations/meta/0039_snapshot.json
    - src/core/leads/constants.ts
    - src/core/leads/gate.ts
    - src/core/leads/template.ts
    - src/core/leads/text-back.ts
    - tests/text-back-gate.test.ts
    - tests/text-back-template.test.ts
    - tests/text-back-structure.test.ts
    - tests/text-back.test.ts
  modified:
    - src/db/schema/{cadences,send-ledger,escalations,inbound-messages,missed-calls,messaging-config,messaging-config-audit,tenant-proofs,index}.ts
    - src/db/repository/{for-tenant,for-all-tenants,missed-calls,messaging-config,escalations,index}.ts
    - src/core/cadence/{sender,dispatch,run-tick}.ts
    - src/core/messaging/inbound.ts
    - src/core/telephony/{missed-call,parse-voice-webhook}.ts
    - src/app/api/webhooks/twilio/voice-status/route.ts
    - src/app/(console)/queue/page.tsx
    - src/core/audit/constants.ts
    - docs/commercial-assumptions.md
    - package.json
decisions:
  - "IN-04 pre-flight counts were all zero, so all three IN-04 CHECKs are written PLAIN (validated)"
  - "missed_calls_skip_reason_iff_skipped uses coalesce(text_back_status,'') so an undecided row cannot carry a reason (a bare = would evaluate NULL and pass)"
  - "cadences.listLive takes a kind parameter defaulting to 'quote' — every pre-Phase-12 caller (tick, pause/resume, onboarding gate, reconnect) keeps reading quote cadences only"
  - "The text-back draft is inserted 'generated' then approved through drafts.approve — the only path to 'approved' stays the only path"
  - "A stored template body that is not already GSM-7-canonical is treated as no_template: the bytes sent are the bytes stored"
  - "A decision-transaction failure returns pre_claim_failed (the claim rolled back with it; the sweep retries)"
  - "Own numbers include both normalizeAuMobile and classifyCaller of the escalation phone, so a landline escalation number is also never texted"
  - "The tracer feedback gate was satisfied by automated re-verification (human_verify_mode is end-of-phase and nothing is deployed in this plan)"
metrics:
  duration: "~37 min"
  completed: 2026-10-06
  tasks: 3
  files: 56
estimate:
  tokens: 110000
  tasks: 3
actuals:
  tokens: 58000
  tasks: 3
  commits: 4
---

# Phase 12 Plan 01: Text-back tracer (schema 0039, gate, sendTextBack, voice-status) Summary

A Twilio-signed "call ended" callback now hands the completed row's id to `sendTextBack`. For an armed client that produces one lead, one `kind='lead'` cadence (touch 1 sent, touches 2–3 inert), one approved draft holding the attested bytes, one `send_ledger` claim (touch 1, `lead_id` set, `quote_id` NULL, sender = the delegate provider) and one provider request. Every refusal (not armed, own number, withheld, not mobile, suppressed, recent text, daily cap, stale, SMS not armed, no template, open quote, open lead) is recorded on the missed call and creates nothing else. All of it sits on migration 0039, which is written and generated but **not pushed or applied anywhere**.

## Tasks

| # | Task | Commit | Key files |
|---|------|--------|-----------|
| 1 | Migration 0039, cadence-kind schema, IN-04 pre-flight, compile-driven widening | `4833d9c` | 0039 sql + snapshot, 4 new schema files, 8 widened schema files, for-tenant D-19 predicates |
| 2 | Tracer: gate, template, sendTextBack, repository lead path, voice-status call site, D-07 constants | `3ae00e8` | src/core/leads/*, voice-status route, missed-calls / messaging-config / for-tenant repository, 3 pure suites |
| 3 | DB-backed tracer suite and the schema pins (CI runs it in 12-03) | `5b51b4c` | tests/text-back.test.ts, seed helpers, rls-coverage / tenant-proofs / missed-calls / cadence-repository pins |

## IN-04 pre-flight (read-only, production, 2026-10-06)

`npm run missed-calls:invariants` printed:

```
total=6
withheld_number_mismatch=0
withheld_flag_mismatch=0
dead_letter_tenant_mismatch=0
```

All three counts are zero, so `missed_calls_withheld_has_no_number`, `missed_calls_withheld_flag_consistent` and `missed_calls_dead_letter_iff_no_tenant` are all written **plain** (validated against existing rows). None is NOT VALID. The migration header records the counts and the decision.

## db:generate outputs

- First run: generated `0039_tidy_rogue.sql` (renamed to `0039_phase12_text_back.sql`; journal re-tagged; `when` 1791222883774 > 1790525643412, so no re-stamp was needed).
- Second run, after hand-finishing: `No schema changes, nothing to migrate 😴`.

Hand-finished: the three widened CHECKs became `DROP CONSTRAINT IF EXISTS` then `ADD`; the replay key was rewritten in 0023's idiom as `kind = 'lead' OR created_by_event_id IS NOT NULL OR created_at < '2026-08-28T08:53:44.384+00:00'::timestamptz` and kept `NOT VALID`; the data statement (existing tenant-owned missed calls → `skipped` / `not_armed`) sits after the column additions and before the CHECKs; there is one REVOKE-then-GRANT block for each of the four new tables. Drizzle emitted nothing touching `cadences_one_live_per_job`, `cadences_one_per_opened_event`, `cadences_id_tenant_uniq` or `cadences_replay_key_present` (checked).

## D-19 predicate sites (`kind = 'quote'`)

- `src/db/repository/for-tenant.ts:3253`: `touches.promoteDue`, inside the active-cadence subquery
- `src/db/repository/for-tenant.ts:3277`: `touches.listNeedsDraft`, inside the same subquery
- `src/db/repository/for-tenant.ts:3397`: `touches.claimDue`, `eq(cadences.kind, 'quote')` in the WHERE (its select narrows `quoteId` / `sm8JobUuid` to `string` honestly, so `ClaimedTouch` and dispatch are unchanged)
- `src/db/repository/for-tenant.ts:2945`: `cadences.listLive(kind = 'quote')`
- `src/core/cadence/run-tick.ts:540`: the 42-day expiry reads `listLive('quote')`
- `src/core/cadence/run-tick.ts:675`: the progress pass reads `listLive('quote')`

## Files `tsc` forced (compile-driven widening)

Source:
- `src/db/repository/escalations.ts`: `EscalationClaim.quoteId`, plus `EscalationEvidence.quoteId` / `inboundMessageId` made nullable
- `src/db/repository/for-all-tenants.ts`: `CadenceByContactMobile` (`quoteId: string | null`, plus `kind` and `leadId`), `ApprovalQueueRow.quoteId`, `HotUnescalatedReply.quoteId`. These are type-only changes plus two select columns. The export list, the import block, `forAllTenants_reportMetrics` and the export count (16) are untouched.
- `src/db/repository/for-tenant.ts`: `claimDue` select narrowing
- `src/db/repository/messaging-config.ts`: `ChannelAuditRow.operatorUserId` nullable, `actor` added
- `src/core/cadence/dispatch.ts`: the `SendRequest` builder gains `leadId: null`
- `src/app/(console)/queue/page.tsx`: queue cards are built only from rows that carry a quote id (a lead touch never reaches the queue, D-19)

Tests (type-level only; quote behaviour unchanged): `tests/brand.test.ts`, `tests/clicksend-sender.test.ts`, `tests/resend-sender.test.ts`, `tests/routing-sender.test.ts` (each `SendRequest` fixture gains `leadId: null`).

Not forced, but named by the plan: `tests/escalation.test.ts`, `tests/inbound-threading.test.ts`, `tests/inbound-stop.test.ts` and `tests/cadence-repository.test.ts` compiled unchanged. `tests/messaging-config-arming.test.ts` compiled unchanged; I corrected two stale "NOT NULL" comments in it. `tests/sync-upsert.test.ts` was not named by `tsc` and was not edited. `tests/report-metrics.test.ts`, `tests/cron-schedules.test.ts` and `scripts/apply-cron-schedules.mjs` are byte-identical to the phase base (`git diff --quiet` green in every task's verify).

Edited by intent rather than by compiler: `SendRequest.leadId`, `stubTouchBody` parameter, `handleSingleMatch` writing `leadId`, `MissedCallArrivalInsert` and `MissedCallFromLog` omitting every text-back column, and the WR-06 comment on `cadences.create` naming the fourth arbiter.

## Template known answer

The fixed text of the D-03 business-hours default is **179 septets**, re-measured with `countSeptets` and matching the research figure. The after-hours fixed text is 230 septets (a name budget of 76) and the about-quote text is 155. The pins: 306 septets is accepted, 307 is refused `too_many_segments`, a 120-character name validates at exactly 2 segments, `€` costs 2 septets, and a non-GSM character is `not_gsm7`.

## Verification

- Task 1 verify: typecheck, lint, `ops-scripts` and `lint-ban` suites, second `db:generate` no-op, journal check and the pin diff all **green**.
- Task 2 verify: the 9 named pure suites (610 tests), typecheck, lint and the pin diff all **green**.
- Task 3 verify: typecheck, lint, `lint-ban` and `text-back-gate` all **green**.
- Local full `vitest run`: 4116 tests passed and 0 failed. The 44 failed *files* are all DB-backed suites refusing the non-local target (`tests/helpers/env.ts`), which is by design.
- **Not run here** (CI in plan 12-03): `tests/text-back.test.ts`, the moved pins (rls-coverage, tenant-proofs, missed-calls, cadence-repository), the type-widened DB suites and the three must-not-move suites.
- Nothing was pushed. `npm run db:migrate` was not run. The only statement run against production was the read-only invariants SELECT.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Correctness] Skip-reason CHECK hardened against NULL**
- **Found during:** Task 1
- **Issue:** `(text_back_status = 'skipped') = (text_back_skip_reason IS NOT NULL)` evaluates to NULL on an undecided row, and a NULL CHECK passes. An undecided row could therefore carry a reason.
- **Fix:** `(coalesce(text_back_status, '') = 'skipped') = (text_back_skip_reason IS NOT NULL)`, with a DB test row for exactly that case.
- **Commit:** 4833d9c

**2. [Rule 1 - Bug] Existing missed-calls CHECK fixtures would trip the new IN-04 CHECKs**
- **Found during:** Task 3
- **Issue:** `validRow()` in `tests/missed-calls.test.ts` had a mobile caller with no number. The `'spam'` dead-letter refusal used a tenant row, so `missed_calls_dead_letter_iff_no_tenant` would be reported first (Postgres checks CHECKs in name order).
- **Fix:** `validRow` carries the caller number, and the `'spam'` case uses a tenant-less row. Both edits have dated comments. `seedMissedCall` gained options that derive a consistent withheld / dead-letter column set.
- **Commit:** 5b51b4c

**3. [Rule 2 - Correctness] Text-back columns omitted from the reconcile insert type too**
- **Found during:** Task 1
- **Issue:** The plan named only `MissedCallArrivalInsert`. The reconcile's `MissedCallFromLog` could still have typed a text-back outcome.
- **Fix:** Both types omit the shared `TextBackOutcomeColumns` union.
- **Commit:** 4833d9c

**4. [Rule 3 - Blocking] `withinDeadline` exported from `missed-call.ts`**
- **Found during:** Task 2
- **Issue:** The helper was private, and the plan requires the pre-claim reads to be bounded by it.
- **Fix:** I exported it (and `Raced`) instead of writing a second copy. `telephony-greeting.test.ts` stays green.
- **Commit:** 3ae00e8

**5. [Rule 2 - Correctness] The route guards on truthy ids**
- **Found during:** Task 2
- **Issue:** `!== null` would pass an `undefined` id from a stubbed dependency into `sendTextBack`.
- **Fix:** The route checks `result.missedCallId && result.tenantId`.
- **Commit:** 3ae00e8

**6. [Scope note] Structure suite allows `@/core/drafting/gsm7`**
- **Issue:** The plan says no file under `src/core/leads` imports "the drafting modules", but `template.ts` must use the shared GSM-7 counter (also named by the plan).
- **Fix:** `tests/text-back-structure.test.ts` allows exactly `@/core/drafting/gsm7`, the pure counter that calls nothing, and refuses every other drafting import.

### TDD Gate Compliance

Task 3 is `tdd="true"`, but its suites are DB-backed and refuse a non-local target, so no RED run was possible locally; the implementation they prove landed in Task 2. Its first execution is CI in plan 12-03, which is the gate that proves it.

## Known Stubs

- `src/core/leads/text-back.ts`: the `quote_open` arm records a skip and sends nothing. This is intentional. Plan 12-05 replaces it with the D-08 about-quote send and escalation.
- The `docs/commercial-assumptions.md` sections 9 and 10 and the D-07 JSDoc name `src/core/leads/balance.ts` as the single place the balance floors apply. That file is created by a later plan in this phase. Today the constants are defined and pinned but nothing reads them.

## Known limitations carried (by design)

- D-22: nothing closes a lead, so a repeat caller with an open lead is `lead_open`.
- `MESSAGING_CHANNELS` is still `['sms', 'email']`. No typed arm path can enable `text_back` until plan 12-08, so in production nothing can arm text-back yet.
- `listLive()` now defaults to `'quote'` for every caller. Phase 13 must decide per caller whether client pause/resume should also act on lead cadences.

## Threat Flags

None. The only new trust-boundary surface is the voice-status → `sendTextBack` call, and it is in the plan's threat model (T-12-01/02/03/06/07/09).

## Self-Check: PASSED

- All created files exist: 0039 sql and snapshot, the four schema files, `src/core/leads/*` (4 files), the four new test files and `scripts/missed-calls-invariants.mjs`.
- Commits `4833d9c`, `3ae00e8` and `5b51b4c` are present in `git log`. None is pushed (`origin/main..HEAD` lists all three).
