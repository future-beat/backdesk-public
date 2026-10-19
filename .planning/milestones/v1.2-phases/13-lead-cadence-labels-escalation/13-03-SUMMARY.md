---
phase: 13-lead-cadence-labels-escalation
plan: 03
subsystem: repository surface / text-back ring-twice data / lead closing proof
status: complete
tags: [repository, interface-first, ring-twice, held-escalation, keyword-hot, classification-columns, digest-reads, close-lead, d-07, d-09, d-11, d-12, d-14]
requires:
  - 13-01 migration 0040 (escalations.hold_until/released_at, inbound_messages.urgency/keyword_hot, leads.closed_reason/closed_at, the by-lead_id label CHECK)
  - 13-02 closeLeadInTx / closeLead / closeLeadsWithEndedCadences, cadences.liveForLead, the inbound namespace, the seed knobs
provides:
  - forTenant().inbound.closingLabelRowsForOpenLeads() and forTenant().inbound.byIdForEscalation(id)
  - TextBackDecisionPatch skipped arm with optional leadId/cadenceId; recent_text and lead_open skips for an open lead record both ids
  - claimEscalation / claimEscalationForMissedCall with holdUntil (and leadId on the missed-call claim)
  - claimHeldEscalationRelease, listHeldEscalationsSince, listUnescalatedRingTwiceCalls (escalations.ts)
  - forAllTenants_hotUnescalated reading (is_hot OR keyword_hot) with urgency, keywordHot, leadId selected
  - listUnclassified with leadId; writeClassification with five columns (urgency); insertInboundMessage writing keywordHot; countColdLeadRepliesSince
  - tests/lead-close.test.ts (DB-backed, CI only)
affects:
  - 13-04 (classification, keyword, label effects) needs no repository export; must add urgency to ClassificationRepository
  - 13-05 (digest) needs no repository export
  - 13-06 (hold/release, ring-twice) needs no repository export
  - 13-07 (phase CI gate) runs lead-close.test.ts and the widened escalation/text-back-repository suites for the first time
tech-stack:
  added: []
  patterns:
    - "Interface-first repository surface: declare every later plan's method once, so parallel plans never touch the barrel or its exhaustive pin"
    - "The release IS the claim: one guarded UPDATE with an id sub-select bound and the guards repeated on the outer statement"
    - "Ring-twice as a correlated EXISTS on an aliased missed_calls; the caller's number compared in SQL, never selected"
key-files:
  created:
    - tests/lead-close.test.ts
  modified:
    - src/db/repository/for-tenant.ts
    - src/db/repository/escalations.ts
    - src/db/repository/for-all-tenants.ts
    - src/db/repository/inbound-messages.ts
    - src/db/repository/index.ts
    - src/core/leads/text-back.ts
    - src/core/escalation/escalate-hot-leads.ts
    - src/core/escalation/quote-call.ts
    - tests/lint-ban.test.ts
    - tests/classification-privilege.test.ts
    - tests/classify-inbound.test.ts
    - tests/escalation.test.ts
    - tests/text-back-repository.test.ts
    - tests/text-back-lead-claim-fault.test.ts
decisions:
  - "holdUntil is REQUIRED (Date | null) on both escalation claims, so every claim site states its hold; the two existing callers pass null until 13-06's hold rule"
  - "The hot-scan OR is a column-only sql template, not drizzle's or(), so for-all-tenants.ts' import block is unchanged"
  - "listUnescalatedRingTwiceCalls also requires cadence_id NOT NULL: an escalation row needs a cadence, and an open lead with no live cadence is a transient the reconciling sweep closes"
  - "The closing-label vocabulary is a module-local const in for-tenant.ts; only its types (ClosingLabelRow, LeadClosingLabel) are exported, and LeadClosingLabel is assignable to LeadClosedReason so 13-04 can pass row.label to closeLead directly"
  - "A text-back skip writes the ring-twice ids only for recent_text and lead_open, and only when noteRepeatCall returned an open lead; liveForLead supplies the cadence id when one is live"
metrics:
  duration: "~22 min"
  completed: 2026-10-08
  tasks: 3
  files: 15
estimate:
  tokens: 55000
  tasks: 3
actuals:
  tokens: 15300
  tasks: 3
  commits: 3
requirements-completed: []
requirements-contributed: [LEAD-01, LEAD-03]  # LEAD-03 completes with 13-04 (keyword/labels) and 13-06 (hold, ring-twice); not marked complete here
---

# Phase 13 Plan 03: Repository surface, ring-twice ids and the lead-close proof Summary

This plan adds every repository method that plans 13-04, 13-05 and 13-06 call, in one place, with the barrel and the exhaustive export pin updated once. The hot scan now reads `(is_hot OR keyword_hot)`. A second call from a number with an open lead now records which lead it joined and that lead's live cadence. A new DB-backed suite proves four things:
- `closeLead` is final and idempotent.
- The reconciling sweep maps every terminal cadence state onto a closed reason.
- The D-12 repeat-caller rule holds on both sides of the 90-day line.
- The ring-twice ids are written and found.

There are still exactly sixteen `forAllTenants_*` exports, and `tests/sync-upsert.test.ts` is byte-identical to the plan base.

## Tasks

| # | Task | Commit | Key files |
|---|------|--------|-----------|
| 1 | Tenant-scoped reads and the ring-twice ids on skipped calls | `2063118` | for-tenant.ts, text-back.ts, text-back-lead-claim-fault.test.ts |
| 2 | Cross-tenant surface: holds, release, ring-twice list, lead-aware hot scan, classification columns, digest reads, barrel and pins | `4aab4c1` | escalations.ts, for-all-tenants.ts, inbound-messages.ts, index.ts, lint-ban / classification-privilege / classify-inbound / escalation / text-back-repository tests, escalate-hot-leads.ts, quote-call.ts |
| 3 | DB-backed proof: closeLead idempotence, the sweep mapping, the repeat-caller rules, the ring-twice ids | `7a70a70` | tests/lead-close.test.ts (661 lines) |

## Every exported name added, by file (for later plans to cite)

**`src/db/repository/for-tenant.ts`** (reached through `forTenant()`):
- `inbound.closingLabelRowsForOpenLeads(): Promise<ClosingLabelRow[]>` returns `{ inboundMessageId, leadId, label }`.
  - Filters: `label IN (existing_job, complaint, not_a_lead, already_sorted, spam, opt_out)`, `label_confidence = 'high'`, `leads.status = 'open'`, tenant on both sides of the join.
  - Ordered by `received_at`, then id.
  - Self-healing: a closed lead drops out of the read, so there is no marker column.
- `inbound.byIdForEscalation(inboundMessageId): Promise<InboundForEscalation[]>` returns `{ body, fromAddress, cadenceId, leadId }`, scoped to the tenant.
  - It is the one read that returns a number and a body, and it exists for the held release only.
- Types: `ClosingLabelRow`, `InboundForEscalation`, `LeadClosingLabel` (barrel type exports).
- `TextBackDecisionPatch` skipped arm gains optional `leadId?` and `cadenceId?`.
  - The `setTextBackDecision` lines that write them:
    ```ts
    ...(patch.leadId !== undefined ? { leadId: patch.leadId } : {}),
    ...(patch.cadenceId !== undefined ? { cadenceId: patch.cadenceId } : {}),
    ```

**`src/db/repository/escalations.ts`** (barrel):
- `claimEscalation` / `EscalationClaim` gains `holdUntil: Date | null`.
- `claimEscalationForMissedCall` / `MissedCallEscalationClaim` gains `leadId: string | null` and `holdUntil: Date | null`.
- `claimHeldEscalationRelease(now, limit): Promise<ReleasedEscalation[]>` returns `id, tenantId, cadenceId, leadId, inboundMessageId, missedCallId, toAddress`.
  - It is one guarded UPDATE that sets `released_at = now` where `hold_until <= now AND released_at IS NULL AND outcome IS NULL`.
  - The limit is applied by an id sub-select ordered by `hold_until`, then id.
- `listHeldEscalationsSince(since): Promise<HeldEscalationSince[]>` returns `{ tenantId, holdUntil }`.
- `listUnescalatedRingTwiceCalls(limit, { notBefore, windowMs }): Promise<UnescalatedRingTwiceCall[]>` returns `{ missedCallId, tenantId, leadId, cadenceId }`.
- Types: `ReleasedEscalation`, `HeldEscalationSince`, `UnescalatedRingTwiceCall`, `RingTwiceWindow`.
- `recentEscalationForCadence` is unchanged.

**`src/db/repository/for-all-tenants.ts`**:
- `forAllTenants_hotUnescalated` (existing export): `HotUnescalatedReply` gains `urgency`, `keywordHot` and `leadId` (from `cadences.leadId`, a column the sync-upsert cadence-column pin already admits). Its WHERE clause is now `(is_hot OR keyword_hot)`.
- There is no new export, and the import block is unchanged.

**`src/db/repository/inbound-messages.ts`** (barrel):
- `UnclassifiedRow.leadId` / `listUnclassified` now selects `inboundMessages.leadId`. There is still no join.
- `ClassificationWrite.urgency: string | null`. `writeClassification` sets five columns and keeps the `label IS NULL` guard.
- `insertInboundMessage` writes `keywordHot: row.keywordHot ?? false`.
- `countColdLeadRepliesSince(since): Promise<ColdLeadReplyCount[]>` returns `{ tenantId, count }`.
  - Its filters are threaded, `lead_id` set, classified, `is_hot = false`, `keyword_hot = false`, `received_at >= since`.
- Type: `ColdLeadReplyCount`.

The barrel's "Lead cadence, labels and escalation (Phase 13)" block exports four value names: `claimHeldEscalationRelease`, `listHeldEscalationsSince`, `listUnescalatedRingTwiceCalls`, `countColdLeadRepliesSince`. Each has a sorted entry and a justification comment in `tests/lint-ban.test.ts`.

## Verification (local, pure only)

- `npm run typecheck` and `npm run lint` (max-warnings 0) were clean after every task.
- Task 1 verify: `text-back-structure`, `text-back-gate`, `lint-ban` and `text-back-lead-claim-fault` all passed (397 tests).
- Task 2 verify: `lint-ban`, `classification-privilege` and `classify-inbound` passed (119 tests).
- Task 3 verify: `lint-ban` and `text-back-gate` passed (99 tests).
- All 106 pure test files: 4,060 tests passed (final run after Task 3).
- **Pin diff against plan base `2d015d7`** (the newest commit touching 13-02-SUMMARY.md): no changes in `tests/sync-upsert.test.ts`, `report-metrics.test.ts`, `cron-schedules.test.ts`, `scripts/apply-cron-schedules.mjs`. Also unchanged: `cadence-rewindow`, `cadence-resume` and `cadence-tick` tests, plus `controls.ts`, `transitions.ts` and `resume.ts`.
- Acceptance greps:
  - for-tenant reads: 6
  - `liveForLead` in text-back.ts: 1
  - `forAllTenants_` exports: 16
  - the three escalation function exports: 3
  - `holdUntil` in escalations.ts: 17
  - `keywordHot` in for-all-tenants.ts: 4
  - `countColdLeadRepliesSince` export: 1
  - `urgency` in inbound-messages.ts: 8
  - `leadId` in inbound-messages.ts: 3
  - lint-ban names: 4
  - `urgency` in classification-privilege: 2
  - lead-close.test.ts: 661 lines; `already_closed` ×6, `touches_exhausted` ×5, `recent_negative_close` ×6, `opt_out` ×4
- I checked the new SQL by rendering it offline with `drizzle.mock()`:
  - The release UPDATE's id sub-select is self-contained.
  - The ring-twice EXISTS correlates `"ring_twice_first"` against the outer `"missed_calls"`.
  - `make_interval(secs => $1::double precision)` binds the window as a parameter.
  - The hot scan renders `("inbound_messages"."is_hot" OR "inbound_messages"."keyword_hot")`.
- **Not run here (DB-backed, CI only):** `tests/lead-close.test.ts`, plus the `holdUntil`/`leadId` fixture edits in `tests/escalation.test.ts` and `tests/text-back-repository.test.ts`. CI at plan 13-07's gate runs them. This plan has no CI gate and no throwaway branch.

## Deviations from Plan

1. **[Rule 3, blocking] `src/core/escalation/escalate-hot-leads.ts` and `quote-call.ts` edited, though neither is in the plan's file list.** The plan makes `holdUntil: Date | null` required on both claims, so `tsc` forced every claim site to state it.
   - `escalate-hot-leads.ts` passes `holdUntil: null`.
   - `quote-call.ts` passes `leadId: null, holdUntil: null`.
   - Each has a comment that 13-06's hold rule is what may set a window. No behaviour changed. 13-06 lists `escalate-hot-leads.ts` and will replace the `null` with its hold decision.
2. **[Rule 3, blocking] `tests/text-back-repository.test.ts` (DB-backed, not in the file list)** needed the same two fields on its missed-call claim fixture. Compile only, with a dated comment.
3. **[Rule 1, bug in a fake] `tests/text-back-lead-claim-fault.test.ts`.** Its fake `noteRepeatCall` returned `undefined`, where the real read returns an array. The decision now destructures that row for the ring-twice ids, so the fake now returns `[]`, with a dated comment.
4. **[Rule 3] `tests/classify-inbound.test.ts`.** Its `row()` fixture gained `leadId: null` because `UnclassifiedRow` now requires it.
5. **The hot-scan OR is `sql\`(${isHot} OR ${keywordHot})\``** rather than `or(eq(...), eq(...))`. It is the same predicate, and the drizzle import block of `for-all-tenants.ts` stays unchanged, as the plan requires. There are no bound values, so the template is safe.
6. **`listUnescalatedRingTwiceCalls` adds `cadence_id IS NOT NULL`**, which the plan's predicate list does not mention. `escalations.cadence_id` is NOT NULL, so a row without one could never be claimed.
7. **`classification-privilege` extras.** The forbidden-set list now also names `keywordHot` and `leadId`. A new case pins `listUnclassified`'s select list at exactly five columns. Both are deliberate tightenings, with dated comments.
8. **Process note.** During Task 1, a mistyped command (`npx vitest run --exclude nothing`) started the whole vitest suite once, DB-backed files included. Nothing was written to any database:
   - No `ALLOW_REMOTE_TESTS` was set.
   - `tests/helpers/env.ts` refuses a non-local target before any connection opens.
   - `global-setup` is a no-op without the permit.
   - No env file was named.
   I discarded the output. After that, pure suites were run only through an explicit file list.

## TDD Gate Compliance

Task 3 is `tdd="true"`, but it is a proof of code that already exists (13-02's `close.ts`, and Tasks 1–2 here). It cannot run RED→GREEN locally because it is DB-backed and runs in CI only. It was committed as `test(13-03)` after the `feat` commits, the same posture 13-02 recorded.

## Known Stubs

None. The plan created no stub, skipped test or unrun `<verify>`; every `<verify>` command is pure and ran green. The DB-backed suite waits for the 13-07 CI gate by design, so nothing was added to WINDOWS.

## Threat Flags

None beyond the plan's threat model.
- T-13-13: `writeClassification` sets exactly five columns, and `keywordHot` is asserted not settable.
- T-13-10: the release is one guarded UPDATE, and nothing re-reads a released row.
- T-13-09: high confidence only.
- T-13-15: the digest reads, the ring-twice list and the release return ids, counts, timestamps and the tradie's own number only.
- T-13-16: both new `forTenant()` reads carry the tenant in their predicate.

## Hazards for the 13-04 / 13-05 / 13-06 CI runs

1. **13-04: `ClassificationRepository.writeClassification` in `classify-inbound.ts` still declares four fields.** Method-parameter bivariance lets `LIVE_REPOSITORY` compile even though the real function now takes `urgency`. Drizzle drops `undefined`, so today's quote writes are unaffected.
   - A lead-reply write that omits `urgency` will hit 0040's `inbound_messages_lead_label_has_urgency` CHECK. 13-04 must add `urgency` to that interface and pass `null` for quote rows.
   - The `listUnclassified` row now carries `leadId` for the vocabulary switch.
2. **13-06: `claimHeldEscalationRelease` has no DB execution yet.** Its first run will be 13-06's `escalation-lead` suite. The rendered SQL is standard Postgres (`UPDATE … WHERE id IN (SELECT … ORDER BY … LIMIT $n) AND <guards> RETURNING`), but watch it.
   - `listUnescalatedRingTwiceCalls` gets its first DB run in `lead-close.test.ts`. It is scanned globally, so assertions filter on this suite's tenant and ids.
3. **13-06 replaces the `holdUntil: null` in `escalate-hot-leads.ts`.** Any pure test that asserts `claimEscalation` was called with an exact object literal must include `holdUntil`. None exists today; the pure suite is green.
4. **`lead-close.test.ts` threads a real STOP by mobile across tenants.** It uses fiction numbers 0491 570 4xx, which no other suite uses. A future suite that seeds a live cadence on `+61491570404` would turn its STOP into a fan-out (`stop_unmatched`).
5. **`lead-close.test.ts` pins `NOW` at 2026-10-07 02:00Z while seeding real-clock `created_at` / `attested_at`.** Every gate and close read takes the injected `now`, which I checked (`latestAttested`, `claimForTextBack`, `existsTextBackToCallerSince`), so a later CI date does not change the results.
6. **Skipped-row ids now appear on `recent_text` / `lead_open` rows for callers with an open lead.** Any DB suite asserting `missed_calls.lead_id IS NULL` on such a skip would go red. The only such helper (`text-back.test.ts` `expectSkip`) is not used for those two reasons; I checked.

## State updates

- STATE.md: plan 3 of 7 complete, wave 4 next; two decisions recorded; metric row added.
- ROADMAP.md: 13-03 ticked, 3/7.
- REQUIREMENTS.md: `requirements.mark-complete` checked LEAD-03 off, which I reverted to Pending. This plan only delivered the data surface for hot-lead escalation; the behaviour lands in 13-04 and 13-06. LEAD-01 was already marked complete by 13-02.

## Self-Check: PASSED

- FOUND: tests/lead-close.test.ts, src/db/repository/escalations.ts, src/db/repository/inbound-messages.ts, src/db/repository/for-tenant.ts, src/db/repository/for-all-tenants.ts, src/db/repository/index.ts, src/core/leads/text-back.ts
- FOUND commits: 2063118, 4aab4c1, 7a70a70
