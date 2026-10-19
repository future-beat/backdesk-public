---
phase: 12-instant-text-back-arming
plan: 03
subsystem: database / deploy
status: complete
tags: [migration-0039, production-push, ci, text-back, inert]
requires:
  - 12-01 (migration 0039, tracer)
  - 12-02 (repository surface, lead-cadence inert proof)
provides:
  - Migration 0039 live on the hosted Sydney database (40 journal entries)
  - The 12-01/12-02 tracer deployed to production, inert
  - scripts/db-status.mjs read-back of the 0039 widened CHECKs and the text_back row count
  - The migration-0039 push record in docs/external-registrations.md
affects:
  - 12-04..12-09 (every later plan builds on the live schema; 0039 is frozen, corrections are new journal entries)
tech-stack:
  added: []
  patterns:
    - "Throwaway-branch CI on the exact SHA that goes to main, before production is touched"
    - "Schema before code: invariants -> lease -> generator -> migrate -> no-op migrate -> read-back -> push"
key-files:
  created: []
  modified:
    - src/db/repository/for-all-tenants.ts
    - tests/sync-upsert.test.ts
    - scripts/db-status.mjs
    - docs/external-registrations.md
decisions:
  - "The cross-tenant cadence read admits cadences.leadId (the D-04 threading decision for a lead cadence) and drops cadences.kind (unused, implied by which id is set); the sync-upsert column pin moved by exactly that one column with a written justification"
  - "The widened-CHECK and text_back-count read-back was added to the existing read-only scripts/db-status.mjs rather than run as ad-hoc SQL"
  - "The read-back script commit was proven on the throwaway branch too, so CI was green on the exact SHA pushed to main"
  - "TXT-02 left Pending in REQUIREMENTS.md: the per-minute sweep guarantee it names is a later plan in this phase"
metrics:
  duration: "~80 min (most of it CI wall-clock)"
  completed: 2026-10-06
  tasks: 2
  files: 4
estimate:
  tokens: 18000
  tasks: 2
actuals:
  tokens: 6000
  tasks: 2
  commits: 3
---

# Phase 12 Plan 03: Fresh-database proof and production push of migration 0039 Summary

Migration 0039 was proven on a database built only from the journal (CI on a throwaway branch, after one fix-forward). It was then applied to the hosted Sydney database under the full push protocol: 39 to 40 journal entries, a no-op second run, and the four new tables read back under RLS. Only after that was `main` pushed, carrying the 12-01/12-02 tracer. Production is Ready on `f0cb6d2`, every door still answers 401 to a wrong token, the cadence tick answers 200 after the deploy, and there are 0 `text_back` rows, so text-back is inert.

## Tasks

| # | Task | Commit | Key files |
|---|------|--------|-----------|
| 1 | Fresh-database CI on `ci/phase-12-tracer`, fixed forward until green | `9ac9fde` (fix) | src/db/repository/for-all-tenants.ts, tests/sync-upsert.test.ts |
| 2 | [BLOCKING] 0039 applied under the protocol, `main` pushed, production probed | `f0cb6d2` (chore: read-back), `4c6c60d` (docs: push record) | scripts/db-status.mjs, docs/external-registrations.md |

## CI runs

| Run | SHA | Branch | Result |
|-----|-----|--------|--------|
| `37358552338` | `fb1143a` | ci/phase-12-tracer | **failure**: one assertion (the sync-upsert cross-tenant cadence column pin) |
| `37359982378` | `9ac9fde` | ci/phase-12-tracer | **success**: 155/155 files, 4826 tests passed (29 skipped) |
| `37361344148` | `f0cb6d2` | ci/phase-12-tracer | **success**: the SHA then pushed to main |
| `37362564453` | `f0cb6d2` | main | **success** |
| `37364314368` | `4c6c60d` | main | attempt 1 **failure, infrastructure**: "The job was not acquired by Runner of type hosted even after multiple attempts", so no step ran. Re-run as attempt 2; result in the Self-Check below |

The named DB-backed suites ran for the first time in run `37359982378`, and all passed: `text-back` (34), `lead-cadence-inert` (6), `text-back-repository` (31), `rls-coverage` (24), `sync-upsert` (18), `report-metrics` (16), `cron-schedules` (29). The branch `ci/phase-12-tracer` was deleted after `main` was pushed (`git ls-remote` is empty).

## The production run, verbatim

```
missed-calls:invariants exit=0   (total=6, withheld_number_mismatch=0, withheld_flag_mismatch=0, dead_letter_tenant_mismatch=0)
cron:status exit=0               (remote_test_lease rows: 0, remote-test-watchdog scheduled: no, origin https://app.backdesk.com.au)
db:generate exit=0               (No schema changes, nothing to migrate)
db:migrate exit=0                (Migrations applied. Journal entries recorded: 40; 39 before)
second db:migrate                (Journal entries recorded: 40; its exit went through a pipe, so it was run a third time: exit=0, still 40)
cron:status(after) exit=0
missed-calls:invariants(after) exit=0  (all three counts 0)
```

- **Read-back** (`node scripts/db-status.mjs`): `migrations recorded: 40`; `leads`, `text_back_templates`, `tenant_never_text_numbers` and `operator_alert_log` all have `rowsecurity=true`; the policies `leads_member_access`, `text_back_templates_member_access`, `tenant_never_text_numbers_member_access` and `operator_alert_log_operator_access` are present; the widened `messaging_config_channel_known`, `messaging_config_audit_channel_known` and `tenant_proofs_kind_known` are `validated=true` and include `text_back` / `text_back_proof`; `messaging_config text_back: rows=0 enabled=0`. `git status --porcelain src/db/migrations` is empty.
- **Push:** `e864fbe..f0cb6d2 main -> main`. Vercel production deployment **`dpl_2ZGHc9whsgdJi4USG2PJ3JoVEuy8`** (`backdesk-p2wsg5fik`) is **Ready**, built in 59 s; the GitHub deployment record (Production) is bound to `f0cb6d2`. Evidence push `f0cb6d2..4c6c60d`.

| Probe (https://app.backdesk.com.au) | Code |
|---|---|
| `GET /login` | 200 |
| `POST /api/webhooks/twilio/voice?token=wrong` / no token | 401 / 401 |
| `POST /api/webhooks/twilio/voice-status?token=wrong` / no token | 401 / 401 |
| `POST /api/internal/{cadence-tick,sync-tick,stalled-digest,messaging-reconcile}`, `Bearer wrong` | 401 each (not 500, so the env parses) |

- **Gate after:** `remote_test_lease rows: 0`, watchdog unscheduled. `cadence-tick` answered 200 on every minute after the deploy, newest `2026-10-05T19:33:00.014Z`.
- **Inert:** no tenant has an enabled text_back row (`rows=0 enabled=0`), and `MESSAGING_CHANNELS` is unchanged (`['sms', 'email']`). The deployed text-back code stays inert until plan 12-08.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Cross-tenant cadence read broke the sync-upsert column pin**
- **Found during:** Task 1 (CI run `37358552338`)
- **Issue:** 12-01 added `cadences.kind` and `cadences.leadId` to `forAllTenants_cadencesByContactMobile`, as its plan prescribed. The pinned column set in `tests/sync-upsert.test.ts` ("reaches exactly nineteen tables…") does not allow either, and the pin had never run, because it is DB-backed and CI-only. The two plan instructions contradicted each other.
- **Fix:** `kind` is dropped from the select and from `CadenceByContactMobile`. Nothing consumed it, and it is implied by which of `quoteId` / `leadId` is set. `cadences.leadId` is admitted to the pin with a dated justification: for a lead cadence it is the D-04 threading decision, the same role and the same kind of opaque uuid as `quoteId`. Nothing else was admitted. No migration file changed, and `db:generate` stayed "No schema changes".
- **Files:** src/db/repository/for-all-tenants.ts, tests/sync-upsert.test.ts
- **Commit:** `9ac9fde`
- **Note:** 12-VALIDATION lists sync-upsert as "must not move". It moved by exactly one column here, in 12-03. The later plans' `git diff --quiet <plan base>` checks use bases after this commit, so they are unaffected.

**2. [Rule 2 - Missing critical] Read-back of the widened CHECKs and the text_back count**
- **Found during:** Task 2, step 6
- **Issue:** The orchestrator required a read-back of the widened CHECKs and a read-only `text_back` count. No existing script read either, and ad-hoc SQL against production is out of bounds.
- **Fix:** `scripts/db-status.mjs` gains two read-only sections: the catalog definitions of the three widened CHECKs (no row data), and `messaging_config` text_back rows/enabled as two integers. The `ops-scripts` suite (57) and lint passed. The commit was proven on the throwaway branch before `main` was pushed.
- **Commit:** `f0cb6d2`

**3. [Rule 3 - Blocking] CI infrastructure failure on the evidence commit**
- **Found during:** Task 2, after the evidence push
- **Issue:** Run `37364314368` attempt 1 failed because no hosted runner was acquired. No step ran.
- **Fix:** `gh run rerun 37364314368` (attempt 2).

## Requirements

TXT-02 is left **Pending**. This plan puts its schema and tracer into production, but the requirement's "per-minute tick as the guarantee when the synchronous send fails" (the sweep) is delivered by a later plan in this phase.

## Known Stubs

None introduced. The stubs 12-01 carried (the `quote_open` arm, the unread balance floors) are unchanged and still owned by plans 12-05 and later.

## Threat Flags

None. No new network endpoint, auth path or schema beyond the plan's threat model. The db-status additions are read-only catalog and aggregate reads.

## Self-Check
