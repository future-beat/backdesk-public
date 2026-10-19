---
phase: 10-first-client-go-live
plan: 04
subsystem: testing
tags: [vitest, postgres, supabase, rls, messaging-config, audit-trail, ci]

requires:
  - phase: 04-messaging-activation
    provides: messaging_config as the arming switch, resolveSmsFrom / resolveEmailIdentity, the per-tenant OFF-means-STOP reading, the two disarmed-state alarms this plan rewrites
  - phase: 10-first-client-go-live
    plan: 01
    provides: armChannel / disarmChannel / listChannelAudit, readGoLiveChecklist + firstUnmetGate, migration 0036's two tables and their SELECT-only grants
  - phase: 10-first-client-go-live
    plan: 03
    provides: forAllTenants_armedBySmsGlobal — the fourteenth crossing, which arrived without a DB-backed test or a tripwire update
provides:
  - seedMessagingConfigOverride — an explicit OFF row a suite can seed, which REFUSES enabled=true
  - seedProof — a tenant_proofs row with a real artefact id and the operator's user id
  - tests/messaging-config-arming.test.ts — the writer's atomicity, identity re-supply, refusals and audit ordering as CI facts
  - tests/go-live-checklist.test.ts — nine keys, the three-state domain read, and the gate order on a real database
  - the two Phase 4 alarms rewritten from "the deployment is disarmed" to "is THIS client armed"
  - rls-coverage, lint-ban and sync-upsert pins covering every Phase 10 surface (two tables, four barrel names, the fourteenth crossing, the eighteenth table)
affects: [10-05, 10-06, 10-07, 10-08]

actuals:
  tokens: 96000
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "A fixture that REFUSES the dangerous value: seedMessagingConfigOverride throws on enabled=true before any statement, so arming cannot be a side effect of a test"
    - "Per-tenant questions instead of deployment-level alarms: an explicit enabled=false override makes the answer 'no' a fact about a row this suite wrote, not about production"
    - "Forced-failure atomicity: the rollback is exercised through the audit row's own NOT NULL uuid column rather than a mock throwing on cue"
    - "Cross-tenant tripwires updated with the argument typed out — which question has no tenant to be asked from, which single accessor reaches the table, what bounds it"

key-files:
  created:
    - tests/messaging-config-arming.test.ts
    - tests/go-live-checklist.test.ts
  modified:
    - tests/helpers/seed.ts
    - tests/rls-coverage.test.ts
    - tests/routing-dispatch.test.ts
    - tests/escalation.test.ts
    - tests/lint-ban.test.ts
    - tests/sync-upsert.test.ts

key-decisions:
  - "The bare-tenant checklist test asserts arming.sms.tenantRow is null rather than smsArmed.detail is null: the detail depends on the shared row's state, which is a deployment fact this phase is deliberately removing from assertions"
  - "The literal spelling of the deployment-level activation read is avoided even in the history comments of the two rewritten files, following the repo's existing 'the tripwire counts occurrences in the SOURCE, prose included' convention"
  - "tenant_proofs joins NO_CASCADE_TABLES; messaging_config_audit deliberately does not — a delete-by-tenant in the shared teardown would be a fixture erasing the record of an arming"
  - "The forced audit failure uses an unparseable operator uuid, so the rollback is proven by the real constraint on the real table"
  - "The suite never reads or writes the shared row, which is what makes it true on a database where the founding client is armed"

patterns-established:
  - "An alarm whose answer is allowed to change must be rewritten before the change, not after: a blocking gate that is red for a reason unrelated to its property gets re-run until green, which is how a real red gets waved through"
  - "Every DB-backed suite that arms anything asserts, as its own last test, that it left nothing armed"

requirements-completed: [ARM-01, ARM-02]

coverage:
  - id: D1
    description: "armChannel writes the config flip and its audit row atomically; a forced audit failure leaves the config row unchanged with no audit row behind"
    requirement: ARM-02
    verification:
      - kind: integration
        ref: "tests/messaging-config-arming.test.ts#ROLLS THE FLIP BACK when the audit row cannot be written — CI run 34570523758, green"
        status: pass
    human_judgment: false
  - id: D2
    description: "The identity survives an arm → disarm → arm cycle; already_armed / already_disarmed write nothing; a blank disarm reason and an email row with no reply-to are refused with no write"
    requirement: ARM-02
    verification:
      - kind: integration
        ref: "tests/messaging-config-arming.test.ts (13 tests) — CI run 34570523758"
        status: pass
    human_judgment: false
  - id: D3
    description: "The explicit-off override creates a disabled row for a client that had none, and that client resolves no number while a sibling's own row is armed; listChannelAudit returns newest first and only this client's rows"
    requirement: ARM-02
    verification:
      - kind: integration
        ref: "tests/messaging-config-arming.test.ts#the explicit-off override and listChannelAudit — CI run 34570523758"
        status: pass
    human_judgment: false
  - id: D4
    description: "forAllTenants_armedBySmsGlobal returns exactly the connected clients with no sms row of their own, ids and names only, paused connections dropped"
    requirement: ARM-02
    verification:
      - kind: integration
        ref: "tests/messaging-config-arming.test.ts#forAllTenants_armedBySmsGlobal (2 tests) — CI run 34570523758"
        status: pass
    human_judgment: false
  - id: D5
    description: "The nine checklist keys render in fixed order with a fact or an honest null each; the injected domain read's three states map to verified / unverified / could-not-check; firstUnmetGate walks the same items the card renders"
    requirement: ARM-01
    verification:
      - kind: integration
        ref: "tests/go-live-checklist.test.ts (10 tests) — CI run 34570523758"
        status: pass
    human_judgment: false
  - id: D6
    description: "tenant_proofs and messaging_config_audit are SELECT-only for anon and authenticated, with RLS on and a policy present"
    requirement: ARM-02
    verification:
      - kind: integration
        ref: "tests/rls-coverage.test.ts (23 tests) — CI run 34570523758"
        status: pass
    human_judgment: false
  - id: D7
    description: "The two Phase 4 disarmed-state assertions ask a per-tenant question backed by an explicit off override, so they stay meaningful after the founding client is armed"
    requirement: ARM-02
    verification:
      - kind: integration
        ref: "tests/routing-dispatch.test.ts (6 tests) + tests/escalation.test.ts (17 tests) — CI run 34570523758"
        status: pass
    human_judgment: false

duration: 45min
completed: 2026-09-11
status: complete
---

# Phase 10 Plan 04: DB-Backed Arming, RLS and Checklist Suites Summary

**The write that turns real customer messaging on is now proven against Postgres — its atomicity, its identity re-supply and every one of its refusals — and the two Phase 4 alarms that asserted "production is disarmed" have become the per-tenant question that stays true the morning after go-live.**

## Performance

- **Duration:** ~45 min
- **Tasks:** 3 of 3 (plus two carry-over reds inherited from 10-01/10-03)
- **Files:** 8 (2 created, 6 modified)
- **CI:** run [34570523758](https://github.com/future-beat/backdesk/actions/runs/34570523758) — **success**, 133 test files, on SHA `9ddf580`

## Accomplishments

- **`tests/messaging-config-arming.test.ts` — 13 assertions, green on a real database first try.** The one that matters: an arm whose audit insert fails leaves the config row still disabled, with its number intact and no audit row behind it. The flip and its record are one transaction, proven by the real `operator_user_id` uuid constraint rather than by a mock throwing on cue.
- **`tests/go-live-checklist.test.ts` — 10 assertions.** The nine keys in their literal order; the OFF-override and own-armed-row details in the operator's words; the three-state domain read with the predicate injected, including UNKNOWN IS UNMET; `firstUnmetGate` from `sm8Connected` on a bare client to `null` once every common gate is met, with email still waiting on the domain.
- **The two alarms are rewritten.** `routing-dispatch` and `escalation` each seed an explicit `enabled = false` row for their own tenants and ask whether THAT client resolves an identity. The deployment-level guarantee moved to where it can still be kept: the CI database (created and destroyed with the job, and the arming suite asserts it leaves nothing armed) and the audit trail.
- **Three tripwires that were red on `main` are green, with their arguments written out** — the repository barrel's four Phase 10 names, the fourteenth cross-tenant crossing, the eighteenth reachable table, and the two new tables' SELECT-only grants.
- **`seedMessagingConfigOverride` cannot arm anything.** It throws on `enabled: true` before it runs a statement. Arming stays an act performed by a named operator through `armChannel`, which is the function under test.

## Task Commits

| Task | Name | Commit |
| ---- | ---- | ------ |
| carry-over | Pin the four Phase 10 names on the repository barrel | `b9423c1` (fix) |
| 1 | Seed helpers for overrides and proofs; RLS coverage for the two new tables | `7345221` (test) |
| 2 | The arming writer's contract on a real database | `06ee24a` (test) |
| 3 | The checklist derivation, and the two alarms rewritten per-tenant | `0df823f` (test) |
| carry-over | The fourteenth crossing and the eighteenth table | `9ddf580` (test) |

## Files Created/Modified

- `tests/helpers/seed.ts` — `seedMessagingConfigOverride` (returns the row id, because `messaging_config` has no FK to `tenants` and teardown cannot reach it), `seedProof`, and `tenant_proofs` added to `NO_CASCADE_TABLES`
- `tests/rls-coverage.test.ts` — the two Phase 10 tables in the `IN` list and four exact-grant entries, with the absent UPDATE/DELETE/TRUNCATE argued per table
- `tests/messaging-config-arming.test.ts` — the writer's contract (new)
- `tests/go-live-checklist.test.ts` — the derivation and the gate (new)
- `tests/routing-dispatch.test.ts` — two explicit off overrides in the block's setup; `resolveSmsFrom` / `resolveEmailIdentity` replacing the deployment alarm and the two `providerFor` stub expectations; the first block's residue alarm made per-tenant
- `tests/escalation.test.ts` — the residue alarm replaced by two seeded off overrides plus `resolveSmsFrom(disarmedTenantId)` being null; the header now states that running this file remotely after go-live would text a real tradie about a real customer
- `tests/lint-ban.test.ts` — `armChannel`, `disarmChannel`, `forAllTenants_armedBySmsGlobal`, `listChannelAudit` on the barrel surface, each with its containment argument
- `tests/sync-upsert.test.ts` — thirteen → fourteen crossings, seventeen → eighteen tables

## Decisions Made

- **The bare-tenant test does not assert `smsArmed.detail === null`.** That detail is `null` only while the client rides a shared row that is absent or disabled — a fact about the deployment, which is exactly the class of assertion this plan exists to remove. The per-tenant half (`arming.sms.tenantRow === null`) is asserted instead, alongside a rule that holds for every row on every database: each item's detail is either `null` or a non-empty string, never `''` (an empty warn badge reads as a broken page, not as an answer).
- **The history comments keep the story and drop the identifier.** The plan asked to keep the 04-08 CR-01 explanation and also required the deployment-level function name to be absent from both files. The repo already has a convention for that collision (`for-all-tenants.ts`: "the literal call spelling is avoided even in this comment: the tripwire counts occurrences in the SOURCE, prose included"), and it is applied here.
- **`messaging_config_audit` is NOT in `NO_CASCADE_TABLES`.** `tenant_proofs` is, for the `tenant_attestations` reason — a leftover proof for a recycled tenant id would answer a go-live question with somebody else's evidence. The audit table is different in kind: a blanket delete-by-tenant in the shared teardown would be a fixture erasing the record of an arming, so each suite deletes its own rows explicitly.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Three tripwires were red on `main` before this plan started**

- **Found during:** Task 1 (barrel pin) and the first CI run (cross-tenant pins)
- **Issue:** `tests/lint-ban.test.ts` had not learned the four names 10-01/10-03 added to the repository barrel, and `tests/sync-upsert.test.ts` still pinned thirteen cross-tenant exports and seventeen reachable tables while `forAllTenants_armedBySmsGlobal` and its `messaging_config` read existed. CI could not be green on any SHA until they were fixed, and this plan's whole purpose is a green CI run proving the writer.
- **Fix:** Both files updated with the argument typed out in the style each list already uses, never a bare number bump.
- **Files modified:** `tests/lint-ban.test.ts`, `tests/sync-upsert.test.ts`
- **Verification:** `npx vitest run tests/lint-ban.test.ts` locally (28 pass); CI run 34570523758 for the cross-tenant pins
- **Committed in:** `b9423c1`, `9ddf580`

**2. [Rule 2 - Missing critical functionality] `tenant_proofs` was not swept by `teardownTenants`**

- **Found during:** Task 1
- **Issue:** `seedProof` writes rows into a table with `tenant_id` and NO foreign key, so nothing would have deleted them. A leftover proof row for a recycled tenant id silently answers "has this client's escalation ever reached a real handset" with somebody else's evidence — the `tenant_attestations` failure mode, in the one place the go-live runbook is not allowed to guess.
- **Fix:** `'tenant_proofs'` added to `NO_CASCADE_TABLES` with the argument recorded beside it, and the deliberate exclusion of `messaging_config_audit` recorded next to it.
- **Files modified:** `tests/helpers/seed.ts`
- **Committed in:** `7345221`

**3. [Rule 1 - Bug] Stale prose in the two rewritten suites' headers**

- **Found during:** Task 3
- **Issue:** `routing-dispatch`'s header claimed "the sms row is only ever READ" (the suite now writes two disabled sms/email overrides) and referred to a "production-is-stub-only assertion" that no longer exists. `escalation`'s header claimed that a run against the shared database records other clients' hot replies as `sms_not_configured` with zero sends — true only while the deployment is disarmed, and dangerously wrong the day after go-live.
- **Fix:** Both headers corrected. `escalation`'s now states plainly that running it remotely after go-live would text a real tradie about a real customer, which is the sharpest edge of the D-11 prohibition.
- **Files modified:** `tests/routing-dispatch.test.ts`, `tests/escalation.test.ts`
- **Committed in:** `0df823f`

**Total deviations:** 3 auto-fixed (1 × Rule 1, 1 × Rule 2, 1 × Rule 3). **Impact:** none on scope — the two carry-overs were assigned to this plan, and the other two are consequences of the plan's own instructions meeting the existing files.

## Issues Encountered

- **The first CI run failed on the cross-tenant pins, not on anything this plan wrote.** All four DB-backed suites were green in that same run (`messaging-config-arming` 13, `go-live-checklist` 10, `routing-dispatch` 6, `escalation` 17, `rls-coverage` 23). The second run, after the pins were updated, was green end to end.
- **No DB-backed suite can be run on this machine** (no local Supabase stack; the hosted one is production, and `tests/helpers/env.ts` refuses at import). The local gates were `npm run typecheck` and `npx eslint . --max-warnings=0`; CI is the prover. `npm run test:remote` was never run.

## Production State

- **Nothing was armed, and nothing in this plan can arm anything.** Every change is under `tests/`; no production database write was made, and `seedMessagingConfigOverride` refuses `enabled: true` by construction.
- **Deployment (the last code SHA, `9ddf580`):** `dpl_64ue9jEwvkTQfXbxxEiPUAUQXE6n` (`backdesk-aswvrdmp2`), Production, **Ready**, built at 06:34:42Z.
- **Deployment (head of `main`, `ed49d42` — this summary, docs only):** `dpl_uKCiKTYak3BM4vTi1M8Pr9BkGRoA` (`backdesk-ivi9j7df0`), Production, **Ready**, built at 06:46:12Z. CI run [34571355173](https://github.com/future-beat/backdesk/actions/runs/34571355173) green on it. `GET https://app.backdesk.com.au/login` → 200.

## Requirements

`ARM-01` and `ARM-02` were ticked optimistically by 10-01, whose own coverage entry recorded the DB-backed verification as `unknown` and named this plan as the prover. That verification is now **pass**: CI run 34570523758 proves the audited writer, its atomicity and its refusals on a real Postgres database, and the checklist derivation and gate order beside it. The ticks are earned rather than pending.

## Known Stubs

None. Every suite this plan wrote runs, and runs in CI.

## Next Phase Readiness

- **Wave 2 is closed.** `main` is green at `9ddf580` and production is Ready on the same SHA.
- **10-05 inherits `seedProof`** and a `tenant_proofs` table that is swept by teardown and pinned in the RLS coverage map.
- **10-07 (the arming decision) inherits a writer whose contract is a CI fact** and two alarm suites that will not go red when it arms the founding client — which was the point of doing this before the arm rather than after it.
- **The remote-run prohibition is now written into the file that would do the most damage** (`tests/escalation.test.ts`): running it against production after go-live would text a real tradie about a real customer.

---
*Phase: 10-first-client-go-live*
*Completed: 2026-09-11*

## Self-Check: PASSED

- All 8 claimed test files exist on disk, plus this summary.
- All five commits exist in git history: `b9423c1`, `7345221`, `06ee24a`, `0df823f`, `9ddf580`.
- Artifact floors met: `tests/messaging-config-arming.test.ts` 522 lines (min 150), `tests/go-live-checklist.test.ts` 368 lines (min 120).
- `npm run typecheck` and `npx eslint . --max-warnings=0` exit 0 locally; CI run 34570523758 green on `9ddf580` (133 test files), with the four DB-backed suites passing against the local stack.
