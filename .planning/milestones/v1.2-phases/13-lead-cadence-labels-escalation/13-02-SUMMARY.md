---
phase: 13-lead-cadence-labels-escalation
plan: 02
subsystem: cadence engine / leads / drafting / console queue and inbox
status: complete
tags: [tracer, lead-cadence, per-kind-policy, dispatch-lead-branch, close-lead, p5, queue, inbox, d-01, d-03, d-04, d-15]
requires:
  - 13-01 migration 0040 (leads.closed_reason/closed_at, message_templates.kind, lead_closed stop reason) and the lead constants
provides:
  - policyFor(kind) / QUOTE_POLICY / LEAD_POLICY; rewindowTouch takes an optional policy (default quote)
  - promoteDue, listNeedsDraft and claimDue admit both kinds; ClaimedTouch carries kind and leadId
  - dispatchOne's kind switch as its first statement; the lead_closed refusal
  - closeLeadInTx (caller's handle) / closeLead (the one wrapper) / closeLeadsWithEndedCadences; leadsClosed tick count
  - lead template defaults seeded at first use; PROMPT_VERSION p5 with LEAD_INSTRUCTIONS and LeadFacts
  - /queue keeps lead rows; the inbox can confirm a lead's soft opt-out
  - seed knobs: seedLeadTemplates, setTenantAfterHoursEscalation, lead-aware seedLedgerRow and seedInbound (leadId, keywordHot)
affects:
  - 13-03..13-06 build on the lead branch, closeLead (wrapper) and the seed knobs
  - 13-04 must restore the skipped lead-reply case (WINDOWS ledger)
  - 13-05 adds the arming-time lead template seed
tech-stack:
  added: []
  patterns:
    - "Per-kind policy object keyed `as const satisfies Record<CadenceKind, CadencePolicy>`"
    - "Close core on the caller's transaction handle + one wrapper that opens the only transaction"
    - "Kind switch as the first statement of the dispatcher; shared tail for both kinds"
    - "Derive a cadence's kind from lead_id where a column-set pin forbids selecting kind"
key-files:
  created:
    - src/core/cadence/policy.ts
    - src/core/leads/close.ts
    - src/core/leads/lead-templates.ts
    - tests/cadence-policy.test.ts
    - tests/lead-close-isolation.test.ts
    - tests/queue-lead-rows.test.ts
    - tests/lead-policy-both-kinds.test.ts
    - tests/lead-cadence-active.test.ts (renamed from lead-cadence-inert.test.ts)
  modified:
    - src/core/cadence/{rewindow,run-tick,dispatch}.ts
    - src/app/api/internal/cadence-tick/route.ts
    - src/db/repository/{for-tenant,for-all-tenants}.ts
    - src/core/drafting/{prompt,draft-touches}.ts
    - src/app/(console)/queue/{page.tsx,queue-card.tsx,actions.ts}
    - src/app/(console)/inbox/{page.tsx,suppress-contact-form.tsx}
    - src/app/(console)/clients/[id]/quotes/[quoteId]/actions.ts
    - tests/{cadence-tick-route,drafting-prompt,drafting-validate,inbox-authorization,draft-touches,text-back-lead-claim-fault,approval-queue,onboarding-gate,lead-reply,text-back,cadence-tick}.test.ts
    - tests/helpers/seed.ts
decisions:
  - "The dispatch lead branch writes the stop pair itself (stopWhereLive lead_closed + skip unsent) and then calls closeLeadInTx, which only closes the lead — so the cadence is stopped lead_closed in every not-chaseable case, never expired"
  - "The approval-queue row's kind is derived from lead_id (CASE) rather than selected, keeping the pinned cross-tenant cadence column set"
  - "Lead templates are loaded lazily, at the first lead touch of a drafting batch; quote-only tenants never get lead rows seeded by drafting"
  - "The cadence is read before the template lookup in drafting, because its kind chooses the template set"
  - "The D-03 side-by-side tick runs after hours: min_gap is judged only on the reschedule arm"
metrics:
  duration: "~2 h 40 min"
  completed: 2026-10-08
  tasks: 2
  files: 35
estimate:
  tokens: 95000
  tasks: 2
actuals:
  tokens: 37600
  tasks: 2
  commits: 7
requirements-completed: [LEAD-01, LEAD-05]
---

# Phase 13 Plan 02: Lead cadence tracer Summary

The lead cadence now runs end to end. A missed caller's touch 2 is promoted and drafted from the client's lead wording (seeded at first use, prompt `p5`). It is parked for a human, approved through the same `approveUnchanged` core the queue uses, and dispatched inside contact hours by the existing dispatch path. Its ledger row belongs to the lead: `lead_id` set, `quote_id` NULL. After touch 3 the cadence completes and the lead closes `touches_exhausted`.

Policy is chosen by cadence kind. Every close runs on a transaction the caller already holds. The queue and inbox handle a row with no quote. All of this passed on a database built fresh from the journal, including 0040, in CI run **37750042844** on `bfa773d`: 169/169 test files, 5,422 tests passed.

## Tasks

| # | Task | Commit | Key files |
|---|------|--------|-----------|
| 1 | Tracer: per-kind policy, the three predicate flips, dispatch lead branch, closeLeadInTx/closeLead/sweep, lead templates, p5 prompt, queue and inbox | `24baf5d` | policy.ts, close.ts, lead-templates.ts, dispatch.ts, run-tick.ts, for-tenant.ts, prompt.ts, draft-touches.ts, queue/*, inbox/* |
| 2 | DB-backed proof: lead-cadence-active (by rename), lead-policy-both-kinds, queue and onboarding-gate cases, seed knobs | `0f4a252` (pure rename), `250bf32` | tests/lead-cadence-active, lead-policy-both-kinds, approval-queue, onboarding-gate, helpers/seed |

Fix-forward commits:
- `28140c3`: the WR-04 fault fake lacked `leads.latestForMobile`. 13-01 had added that read; this pure test was already red before this plan.
- `1503b94`: the queue derives a row's kind from `lead_id`. Found by CI run 1 in `sync-upsert`.
- `65b31ca`: the text-back fixture now closes its lead with a reason, as 0040 requires. Found by CI run 1.
- `bfa773d`: acknowledges the two new tick keys in `cadence-tick.test.ts`'s exact-shape check. Found by CI runs 1 and 2; approved as decision A.

## CI on throwaway branch `ci/phase-13-tracer`

| Run | Commit | Result |
|-----|--------|--------|
| 37747410717 | `250bf327d2716ec6203b9e14fed82b218c781b19` | 3/169 files failed: cadence-tick (exact-shape check), sync-upsert (cadence column set), text-back (fixture close without reason). All new suites green. |
| 37748757448 | `65b31caed8382d6584c23fae659d2dd78261da02` | 1/169 failed: cadence-tick only (needed a decision; see deviation 7) |
| **37750042844** | **`bfa773d96d71b38fc2c5e7cd62dfa9d9231cbb4a`** | **success, 169/169 files, 5,422 passed, 30 skipped** |

Suites confirmed passing in the final run:

| Suite | Tests |
|-------|-------|
| lead-cadence-active | 22 |
| lead-policy-both-kinds | 6 |
| approval-queue | 40 |
| onboarding-gate | 14 |
| rls-coverage (proves 0040's CHECKs and indexes) | 26 |
| cadence-tick | 9 |
| cadence-rewindow | 32 |
| cadence-resume | 5 |
| sync-upsert | 18 |
| report-metrics | 17 |
| cron-schedules | 29 |

The 30 skipped are 29 that were already skipped before this plan, plus the one lead-reply case below. After the green run the branch was deleted, and `git ls-remote --heads origin ci/phase-13-tracer` prints nothing. `main` was not pushed.

## The three flipped predicate sites (`src/db/repository/for-tenant.ts`)

- About line 3564: `promoteDue`. The `kind = 'quote'` condition is dropped from the active-cadence subquery.
- About line 3591: `listNeedsDraft`. The same subquery change.
- About lines 3676 and 3720: `claimDue`. The select now includes `quoteId`/`sm8JobUuid` as nullable, plus `kind` (typed as a `CadenceKind`) and `leadId`, and the predicate is removed. `ClaimedTouch` widened to match.
- The `cadences.kind` grep count went from 7 to 6. New reads are `liveForLead`, `leads.close`, `leads.listOpenWithEndedCadence`, `templates.ensureLeadDefaults` and `inbound.latestForLead` (grep count 10).

## The two sites that stay quote-only

- **`applyResumeRewindow`** (`resume.ts`, untouched) keeps using `listLive`'s quote default. The sentence beside `listLive` (about line 1198): "its gap-preserving resume exists for three-week quote cadences; a lead paused by a reply and later resumed is repaired by the per-tick lead rewindow within a minute, under the lead policy."
- **`liveQuoteCadenceForMobile`** (about line 3215) is reused unchanged by the dispatch lead branch for the D-10 tie-break. A caller who is on a live quote cadence has the lead closed as `quote_cadence_wins`.

## The two `closeLeadInTx` call sites

- `src/core/cadence/run-tick.ts:736`: inside `expireOverdueCadences`' own transaction, when `kind === 'lead'`.
- `src/core/cadence/dispatch.ts:433`: inside `refuseUnchaseableLead`, on the dispatch claim transaction.
- `close.ts` calls `forTenant(` exactly once and `.transaction(` exactly once; both are pinned by `tests/lead-close-isolation.test.ts`.

## Files `tsc` forced

- `tests/draft-touches.test.ts`: the fake repository gained `ensureLeadDefaults`, `leads.byId` and `inbound.latestForLead`, and the `CADENCE` fixture gained `kind: 'quote'` and `leadId: null`.
- `tests/drafting-prompt.test.ts`: the `build` helper is now typed `Partial<QuoteDraftPromptInput>`, because the prompt input is now a union on `kind`.
- No source file other than the planned ones. `approve-draft.ts` needed no change.

## Verification

- Local typecheck and lint are clean (0 warnings).
- Task 1's verify chain passes: 15 test files, 942 tests. Across all 89 pure test files, 3,559 tests pass.
- **Diff check against phase base `ed2e4dc`, seven files unchanged:** `tests/cron-schedules.test.ts`, `report-metrics.test.ts`, `sync-upsert.test.ts`, `cadence-rewindow.test.ts`, `cadence-resume.test.ts`, `src/core/cadence/resume.ts`, `scripts/apply-cron-schedules.mjs`.
- `tests/cadence-tick.test.ts` is **dropped from the protected set**. It received the approved two-line key acknowledgement (deviation 7); every quote value in it is unchanged.
- I ran no database-backed suite locally and never ran `npm run test:remote`. I named no env file in any command, did not apply the migration anywhere, and did not run `db:migrate`.

## Deviations from Plan

1. **[Rule 1] D-03 side-by-side timing.** The plan's tick at Tue 11:30 is inside the window, so both touch 2s would send — `min_gap` is only checked on the reschedule arm, so that test would prove nothing about the gap. Corrected against D-03 and the rewindow evaluation order:
   - The tick is Tue 17:30, after the window closes, so both touch 2s must re-place to Wed 09:30. Touch 3 is 24 h after that slot.
   - The lead touch is rescheduled (24 ≥ 12) and sent at Wed 09:31.
   - The quote touch is skipped `min_gap` (24 < 48), and its touch 3 stands.
   - A second pair with touch 3 49 h after the slot sends both.
2. **Dispatch lead branch close order.** The branch writes the stop pair (`lead_closed`) itself, then `closeLeadInTx` only closes the lead. Otherwise an `expired` reason would expire the cadence instead of stopping it `lead_closed`, which the must-have requires.
3. **Rename as its own commit.** The rewrite is under git's 50% similarity threshold, so the rename landed as a pure R100 commit (`0f4a252`) before the rewrite (`250bf32`). The plan's literal check (`git log --diff-filter=R … -1 -- <one path>`) prints nothing for a single-path pathspec; with `--follow` it shows `R100 lead-cadence-inert → lead-cadence-active`. The D-19 control block is byte-identical; I checked with `diff`.
4. **`tests/lead-reply.test.ts`** (outside the plan's file list):
   - The case that writes a quote label onto a lead reply is now `it.skip` with its body kept and "restored in 13-04" in the title. 0040's by-kind CHECK refuses that write, and the CHECK is not weakened. It is recorded in WINDOWS as a `skipped-test`.
   - Its source check that `/queue` dropped rows with no quote id moved by design: it now asserts the filter is gone and that the card links a quote only on a quote row.
5. **Small extras in planned files:**
   - `seedLedgerRow` accepts `leadId` and a null `quoteId`; `seedInbound` also takes `body`.
   - The inbox suppress warning reads correctly for a lead.
   - The queue actions are bound to the nullable `row.quoteId` and pass `?? ''` when revalidating; the plan put `?? ''` at the binding.
6. **Tracer gate.** Config is interactive, but Task 2 *is* the tracer's end-to-end proof and the coordinator directed both tasks, so execution continued straight into it.
7. **[Approved, decision A] `tests/cadence-tick.test.ts` edited despite the plan's MUST NOT.** Its all-zero tick assertion is exhaustive by design. Its own comment says a count deliberately added must be acknowledged there. This plan's required `refusals.lead_closed` and `leadsClosed` made it red in CI runs 1 and 2.
   - The coordinator relaxed the prohibition for the key-set acknowledgement only.
   - The edit is two keys at 0 with "added by 13-02" comments (`bfa773d`). No quote value changed.
8. **[Rule 3] Fix-forwards caused by 13-01's schema and pins:**
   - `28140c3`: a fault-test fake was missing a read 13-01 added.
   - `65b31ca`: a text-back fixture closed a lead without the reason 0040 requires. The update was unchecked, so the lead stayed open.
   - `1503b94`: the queue derives kind from `lead_id` instead of selecting `cadences.kind`, which a `sync-upsert` column-set check forbids. Same choice 12-03 made.

## TDD Gate Compliance

Task 2 is `tdd="true"`. The plan sets the commit order as a pure rename followed by the suites. The suites test code that Task 1 already committed, so this is a proof written after the code rather than a RED→GREEN cycle. CI ran them red-on-arrival for unrelated pins, then green.

## Known Stubs

None. The lead-reply skip is a deferred test, not a code stub, and is tracked in WINDOWS for 13-04.

## Threat Flags

None beyond the plan's threat model.
- T-13-01 is mitigated: the kind switch is first, and `mirror_missing` is 0 on every tick.
- T-13-23 is mitigated: closes run on the caller's handle, pinned by both the pure suite and CI.
- `inbound.latestForLead` is the one new read that returns a reply body. Its only caller is drafting, and the text is sanitized, capped at 500 characters and fenced.

## Self-Check: PASSED

- FOUND: src/core/cadence/policy.ts, src/core/leads/close.ts, src/core/leads/lead-templates.ts, tests/cadence-policy.test.ts, tests/lead-close-isolation.test.ts, tests/queue-lead-rows.test.ts, tests/lead-policy-both-kinds.test.ts, tests/lead-cadence-active.test.ts
- FOUND commits: 24baf5d, 28140c3, 0f4a252, 250bf32, 1503b94, 65b31ca, bfa773d
- CI 37750042844 conclusion `success` for `bfa773d`
