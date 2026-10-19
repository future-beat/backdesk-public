---
phase: 13-lead-cadence-labels-escalation
plan: 05
subsystem: console client page / arming action / 06:30 operator digest / docs
status: complete
tags: [after-hours-switch, lead-template-seed, digest-leads-section, runbooks, commercial-assumptions, d-02, d-08, d-09]
requires:
  - 13-01 tenants.after_hours_escalation and the lead constants (src/core/leads/constants.ts)
  - 13-02 seedLeadTemplateDefaults / templates.ensureLeadDefaults (src/core/leads/lead-templates.ts)
  - 13-03 countColdLeadRepliesSince (inbound-messages.ts) and listHeldEscalationsSince (escalations.ts), barrel exports outside the forAllTenants_* family
provides:
  - updateAfterHoursEscalationAction + AfterHoursEscalationForm + the "After-hours escalation" On/Off profile row (D-09)
  - the arming-time lead template seed in armChannelAction (D-02 "at arming")
  - buildLeadsSection + its wiring in defaultSections (D-08, D-09)
  - docs/commercial-assumptions.md §11–§15; runbook lines for the switch, ring twice and the lead queue
affects:
  - 13-06 must make the escalation pass read tenants.after_hours_escalation (the switch is stored and displayed, not yet obeyed) and should add a pure RING_TWICE_WINDOW_MINUTES value pin
  - 13-07 first DB runs of the digest's default composition with the Leads reads
tech-stack:
  added: []
  patterns:
    - "Arm-then-seed: a best-effort follow-on write in its own try after the success result, never able to unsay it"
    - "Digest directory reuse: the metrics rows already read name every client; a one-statement fallback only when that read failed"
    - "Runbook label tie for a control that is not on the checklist card: pinned in CONTROL_LABELS plus a cross-check against the form's source"
key-files:
  created:
    - src/app/(console)/clients/[id]/after-hours-escalation-form.tsx
    - tests/after-hours-escalation-action.test.ts
    - tests/lead-digest-section.test.ts
  modified:
    - src/app/(console)/clients/[id]/actions.ts
    - src/app/(console)/clients/[id]/action-state.ts
    - src/app/(console)/clients/[id]/page.tsx
    - src/core/aging/stalled-digest.ts
    - src/core/leads/constants.ts
    - docs/commercial-assumptions.md
    - docs/first-client-go-live-runbook.md
    - docs/client-divert-onboarding-runbook.md
    - tests/runbook-contract.test.ts
    - tests/lint-ban.test.ts
key-decisions:
  - "The after-hours action uses updateEscalationPhoneAction's guard exactly: authorize(tenantId) (session + RLS membership read) before any formData read; no requireOperatorId, same as its mould"
  - "Any posted value other than 'on' is OFF; the patch is { afterHoursEscalation } and nothing else"
  - "The Leads section renders after attestation drift and before opt-out (today's work before this week's conversation)"
  - "Client names and zones for the Leads lines come from the metrics rows defaultSections already reads; forAllTenants_cadenceTick is read only when that read failed; an unnamed id renders 'unknown client' in UTC"
  - "The onboarding-runbook step is 0.6, not 0.4: 0.4 is already 'The privacy notice covers callers'"
  - "The runbook states touch 3 appears in /queue about a day after the text-back, not within a minute: DRAFT_LEAD_HOURS = 24 promotes each touch 24 h before its slot"
metrics:
  duration: "~14 min"
  completed: 2026-10-08
  tasks: 3
  files: 13
estimate:
  tokens: 50000
  tasks: 3
actuals:
  tokens: 15400
  tasks: 3
  commits: 3
requirements-completed: []
requirements-contributed: [LEAD-03, LEAD-01]
---

# Phase 13 Plan 05: After-hours switch, lead wording at arming, the digest's Leads section, and the docs Summary

This plan adds four things the operator touches:
- **After-hours switch.** The client page has a per-client switch, default Off, that decides whether a hot lead outside contact hours texts the tradie straight away or waits for the window to open.
- **Lead wording at arming.** Arming text-back now writes the client's two default lead follow-up wordings.
- **Digest Leads section.** The 06:30 operator digest gains a Leads section, in fixed words: per client, the count of cold lead replies waiting and the count of hot leads held overnight with their release time.
- **Docs.** Every lead constant from this phase is recorded where the founder looks, and both runbooks describe the switch, ring twice and the lead queue.

## Tasks

| # | Task | Commit | Key files |
|---|------|--------|-----------|
| 1 | After-hours escalation switch; lead template defaults seeded at arming | `5469e8f` | after-hours-escalation-form.tsx, actions.ts, action-state.ts, page.tsx, after-hours-escalation-action.test.ts, lint-ban.test.ts |
| 2 | Leads section in the 06:30 digest | `fad29dd` | stalled-digest.ts, lead-digest-section.test.ts |
| 3 | Constants and behaviours in the docs | `e1e86f7` | commercial-assumptions.md, both runbooks, runbook-contract.test.ts, leads/constants.ts (header comment) |

## The guard order, quoted

In `updateAfterHoursEscalationAction` (`src/app/(console)/clients/[id]/actions.ts`), the `authorize` call (line 546) comes before the only form read (line 555):

```ts
  const denied = await authorize(tenantId);
...
    formData.get('after_hours_escalation') === 'on',
```

`tests/after-hours-escalation-action.test.ts` proves it. A `FormData` whose every getter throws is refused for three callers: a signed-out session, a tenant id that is not a uuid, and a session that RLS shows no tenant row to. In all three cases the form is never read and nothing is written.

## The new form's control labels and the runbook contract

- **Disclosure summary:** `Change after-hours escalation`
- **Checkbox label:** `After-hours escalation`. The client page's profile row uses the same text as its `<dt>`.
- **Help copy:** "Text the escalation phone about hot leads outside contact hours. Emergencies and URGENT replies are always sent."

Both labels are pinned in `CONTROL_LABELS` in `tests/runbook-contract.test.ts`, with a comment dated 2026-10-08. A new cross-check reads the form's source and asserts it still contains both labels, so renaming one side without the other turns the suite red. Both runbooks name both labels. `tests/client-divert-runbook.test.ts` was not changed: its lists are drawn from the checklist card.

## The Leads lines, as rendered

```
Leads
Acme Plumbing: 2 cold lead replies in the last 24 h waiting in the inbox
Acme Plumbing: 1 hot lead held overnight — released at 07:00 (Australia/Perth)
```

- **Cold count:** comes from `countColdLeadRepliesSince(now − 24 h)`.
- **Held count:** comes from `listHeldEscalationsSince(now − 24 h)`. The builder ignores any held row older than 24 h, whatever it is handed. The release time shown is the latest `hold_until`, in the client's zone.
- **Inputs:** both reads return only tenant ids, counts and times.
- **Pinned by the test:** no `+61`, no run of nine digits, no tenant id, and the exact number of digit runs on each line.
- **Empty case:** `null` when there is nothing to report, so an otherwise empty morning still sends no email.
- **Exports:** the `forAllTenants_*` export count is still 16.

## Verification (local, pure only)

- **Task 1 verify passed:** 7 suites, 449 tests (after-hours-escalation-action, text-back-actions, arming-actions, operator-authorization, console-error-leak, lint-ban, layout-contract). Typecheck, lint and `npx next build >/dev/null 2>&1` all exit 0.
- **Task 2 verify passed:** lead-digest-section and stalled-drafts, 29 tests. Typecheck and lint clean. The pin diff against plan base `78172a0` (the newest commit touching 13-03-SUMMARY.md) is clean for `cron-schedules.test.ts`, `apply-cron-schedules.mjs`, `report-metrics.test.ts` and `sync-upsert.test.ts`.
- **Task 3 verify passed:**
  - runbook-contract, client-divert-runbook and audit-aggregate: 140 tests.
  - The constant-name grep finds at least 6 in the assumptions record. `^## 1[1-5]\.` matches 5 headings.
  - The docs diff contains 0 lines with `+61` or a 64-hex string.
- **Final pass:**
  - The 15 named and adjacent suites: 757 tests.
  - `next build` exits 0 again, and the pins are clean again.
  - Every pure suite, from an explicit list of 115 files (excluding every file importing `helpers/seed`, plus cron-schedules, rls-coverage and remote-test-watchdog): 4,556 tests passed, 0 failed.
- **Not done:** no `test:remote` run, no `ALLOW_REMOTE_TESTS`, no env file named, no migration applied.

## Deviations from Plan

1. **[Rule 1, accuracy] The runbook does not say "touches 2 and 3 appear in `/queue` within a minute".**
   - `promoteDue` surfaces a touch `DRAFT_LEAD_HOURS = 24` hours before its slot (`run-tick.ts:909`). Touch 2 (next day) therefore usually appears within a minute, but touch 3 appears about a day later.
   - The runbook (divert §8.4) says exactly that. The plan's must-have wording claims both touches appear within a minute.
2. **[Rule 1] Divert runbook section numbered 0.6, not 0.4.** Section 0.4 is already "The privacy notice covers callers". Renumbering 0.4 and 0.5 would have moved the "0.2 to 0.5" artefact row and anything else that cites them. The plan's grep for `0.4` still passes, on the existing heading.
3. **[Rule 2] The new form is pinned in `tests/lint-ban.test.ts` `CLIENT_REACHABLE`.** This file is not in `files_modified`. The must-have says the form imports only its sibling leaf and the action, and this guard is how every other `'use client'` console form proves that.
4. **[Rule 2] Comment-only header edit in `src/core/leads/constants.ts`.** The header said these constants are "NOT commercial assumptions" and pointed only at `src/core/audit/constants.ts`. The record now covers them in §11–§15, and the record's footer says both headers point back at it, so the header now names §11–§15. No values changed.
5. **The action-guard test case "not an operator" became "a session RLS shows no tenant row to".**
   - `authorize()` checks the session and then makes a membership read through the caller's own JWT. It does not read the allowlist itself, which is the escalation-phone mould the plan names.
   - The fake client cannot model RLS denying a non-operator, so that case is expressed as the membership read returning no row.
   - No `requireOperatorId` was added: the plan prescribes the escalation-phone guard order exactly.
6. **The digest names clients from the metrics rows `defaultSections` already reads.**
   - The plan says "the tenant list the function already has", but the function had none.
   - The metrics read returns every tenant with name and timezone, so it is hoisted into a directory.
   - Only if that read failed is `forAllTenants_cadenceTick()` (one statement, connected tenants) read for names.
   - The opt-out section is still pushed last, so the order is: wedge, attestation, Leads, opt-out.
7. **Assumptions §14 and §15 do not invent rationale.** Ninety days (D-12) and thirty minutes (D-07) are recorded as decision numbers, not measured ones, beside the reasoning the decisions give. §11–§13 cite 13-RESEARCH Q2 as the source of the numbers, which were adopted by the plan under the founder's D-01/D-03.
8. **Commits were made through `gsd-tools query commit`, then amended** (local, unpushed, own commits only) to add the bullet body and the Co-Authored-By trailer that 13-01..13-04 carry.

## TDD Gate Compliance

Tasks 1 and 2 carry `tdd="true"`. As in 13-02..13-04, each landed as one `feat(13-05)` commit with its pure suite, and no separate RED `test(...)` commit precedes it. The suites assert behaviour absent at base: `updateAfterHoursEscalationAction`, the arming-time seed and `buildLeadsSection` did not exist, so the suites would have been red.

## Known Stubs

None. The switch is real and persisted, but the escalation pass does not read it until 13-06 (see Hazards). That is the plan split, not a stub in this plan's files. Nothing was added to WINDOWS.

## Threat Flags

None beyond the plan's threat model:
- **T-13-12:** authorize before any read; one-column patch.
- **T-13-15:** closed vocabulary and a no-number test; the docs diff was grepped.
- **T-13-18:** the seed runs in its own try after the arm.
- **T-13-19:** fixed sentences only; console-error-leak passes.

## Hazards for 13-06 / 13-07

1. **Deploy order (13-07 or whoever ships).**
   - The client page now selects `after_hours_escalation` through the Supabase client. The column arrives with migration 0040.
   - Deploying this console before 0040 is applied to production makes the client page's tenant read fail. The page then shows its fixed read-failure sentence instead of the client, on every client page.
   - Apply 0040 first, or ship the two together.
2. **13-06 must make the switch matter.**
   - Today `tenants.after_hours_escalation` is written and displayed. `escalateHotLeads` and the ring-twice pass do not read it yet.
   - The go-live runbook §3 and divert runbook §0.6 already describe the hold, the always-sent emergencies and URGENT replies, and ring twice, as 13-06 will build them.
   - The digest's held line has nothing to count until 13-06 writes `hold_until`.
3. **`RING_TWICE_WINDOW_MINUTES` has no pure value pin.** Assumptions §15 says 13-06's ring-twice suite pins the boundary. Add `expect(RING_TWICE_WINDOW_MINUTES).toBe(30)` there, or change §15.
4. **13-07: digest DB suites.**
   - `tests/stall-tick.test.ts` and `tests/onboarding-checklist-gate.test.ts` run `runStalledDigest` with the default composition, which now makes two (sometimes three) more reads.
   - Their assertions are `toContain`, or use `sections: []`, so they should hold. Their first run is at the gate.
   - The onboarding-checklist-gate source scan forbids `update(` and similar in `stalled-digest.ts` outside comments. That check was run by hand and is clean.
5. **`tests/arming-actions.test.ts` mocks `forTenant` as a bare `vi.fn()`.** Its successful text_back arm now enters the seed's try, throws on `undefined.templates` inside it, and logs the fixed line. `console.error` is mocked in that suite, so it stays green. The seed's behaviour is proven in the new suite.

## Self-Check: PASSED

- FOUND: src/app/(console)/clients/[id]/after-hours-escalation-form.tsx, tests/after-hours-escalation-action.test.ts, tests/lead-digest-section.test.ts
- FOUND commits: 5469e8f, fad29dd, e1e86f7
