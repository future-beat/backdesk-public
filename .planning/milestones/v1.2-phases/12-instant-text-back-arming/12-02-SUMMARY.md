---
phase: 12-instant-text-back-arming
plan: 02
subsystem: database / repository / tests
status: complete
tags: [text-back, repository, barrel-pin, d-19, d-21, d-10, d-16, d-20]
requires:
  - 12-01 (migration 0039 schema, the four kind='quote' predicates, seed helpers)
provides:
  - The full Phase 12 repository surface (no later plan in the phase needs a new repository export)
  - src/db/repository/operator-alerts.ts (claimOperatorAlert)
  - tests/lead-cadence-inert.test.ts (DB-backed D-19 proof, CI-only)
  - tests/text-back-repository.test.ts (DB-backed surface proof, CI-only)
affects:
  - 12-03 (CI runs both new suites for the first time)
  - 12-04 (sweep, alert pass, balance probe consume listPendingTextBacks, markStaleTextBacks, claimTextBackAlerts, listArmedTextBackTenantIds, disarmChannelBySystem, claimOperatorAlert)
  - 12-05 (claimEscalationForMissedCall, listUnescalatedQuoteCalls; extends claimTextBackAlerts with the pause_failed arm)
  - 12-06 (textBackTemplates.insertVersion/attestWhereUnattested/byId/latestForVariant, neverText.add/remove/countOwnLines)
  - 12-08 (attestedSetStatus, countOwnLines, getTextBackEvidenceForTenant)
tech-stack:
  added: []
  patterns:
    - "Reference instant coalesce(ended_at, started_at) written as two column comparisons so every bound Date is column-encoded (no raw Date in a sql template)"
    - "System writer as a separate function with a literal-typed channel, never a nullable operator id on the operator writer"
    - "Global tick reads proven on pinned 2020 clocks with assertions filtered to the suite's own ids"
key-files:
  created:
    - src/db/repository/operator-alerts.ts
    - tests/lead-cadence-inert.test.ts
    - tests/text-back-repository.test.ts
  modified:
    - src/db/repository/for-tenant.ts
    - src/db/repository/missed-calls.ts
    - src/db/repository/escalations.ts
    - src/db/repository/messaging-config.ts
    - src/db/repository/index.ts
    - tests/lint-ban.test.ts
decisions:
  - "attestedSetStatus returns Record<TextBackVariant, boolean> built from TEXT_BACK_VARIANTS (one selectDistinct), so 12-08's checklist reads one boolean per variant and a missing row reads false"
  - "disarmChannelBySystem flips with UPDATE ... WHERE id = ? AND enabled = true (not the upsert): a concurrent operator disarm that commits first makes it already_disarmed with no second audit row; it never creates a row (absent = already off)"
  - "disarmChannelBySystem throws on a blank reason, a blank tenant id or a non-text_back channel (programming errors, constant callers); result kinds stay disarmed | already_disarmed"
  - "markStaleTextBacks(before, at?) takes an optional decision time; default is the database now(). 12-04 can pass its pinned tick clock"
  - "claimEscalationForMissedCall is TARGETED on escalations_missed_call_uniq (with the partial predicate); claimEscalation stays targetless"
  - "getTextBackEvidenceForTenant LEFT JOINs send_ledger on text_back_ledger_id AND the ledger's own tenant_id, so it reaches at most one ledger row of this client"
  - "claimOperatorAlert(kind, alertDay, detail = null) validates YYYY-MM-DD before any statement"
  - "TXT-02/TXT-03 are not marked complete: both depend on later plans in the phase (the sweep in 12-04, the arming gate in 12-08). 12-01 left them open too"
metrics:
  duration: "~17 min"
  completed: 2026-10-06
  tasks: 2
  files: 9
estimate:
  tokens: 50000
  tasks: 2
actuals:
  tokens: 22400
  tasks: 2
  commits: 2
---

# Phase 12 Plan 02: The remaining text-back repository surface and the D-19 inert proof

This plan declares in one place every repository method that plans 12-04 to 12-08 call. That covers template versioning with write-once attestation, the never-text list, the sweep and alert reads, the text-back evidence read, the missed-call escalation claim, the once-a-day operator alert latch and the system auto-disarm. Each is exported once from the barrel and pinned in `tests/lint-ban.test.ts`. Two DB-backed suites go with them. The first runs a full `runCadenceTick` over a due lead touch beside a quote control and checks that the lead touch is left alone. The second proves the semantics of every new method, including the two audit-actor CHECKs. Neither suite can run locally; CI runs them in 12-03.

## Tasks

| # | Task | Commit | Key files |
|---|------|--------|-----------|
| 1 | Declare the remaining repository surface once | `3eab24b` | for-tenant, missed-calls, escalations, messaging-config, operator-alerts (new), index, lint-ban |
| 2 | DB-backed proofs: lead touches inert through a tick; the surface and its CHECKs | `26203d9` | tests/lead-cadence-inert.test.ts, tests/text-back-repository.test.ts |

## Every name this plan added, by file (for later plans to cite)

**Barrel value exports (new, 9), all in the "Text-back (Phase 12)" block of `src/db/repository/index.ts`:**

| Export | File | Signature (abridged) |
|---|---|---|
| `listPendingTextBacks` | `src/db/repository/missed-calls.ts` | `({ olderThan, newerThan, limit }) => Promise<Array<{ id }>>` |
| `markStaleTextBacks` | `src/db/repository/missed-calls.ts` | `(before: Date, at?: Date) => Promise<number>` |
| `claimTextBackAlerts` | `src/db/repository/missed-calls.ts` | `(now, stuckBefore) => Promise<Array<{ tenantId, status, detail }>>` |
| `getTextBackEvidenceForTenant` | `src/db/repository/missed-calls.ts` | `(tenantId, id) => Promise<TextBackEvidence \| null>` |
| `claimEscalationForMissedCall` | `src/db/repository/escalations.ts` | `({ missedCallId, tenantId, cadenceId, quoteId, toAddress, at }) => Promise<{ id } \| null>` |
| `listUnescalatedQuoteCalls` | `src/db/repository/escalations.ts` | `(limit) => Promise<Array<{ missedCallId, tenantId, cadenceId }>>` |
| `disarmChannelBySystem` | `src/db/repository/messaging-config.ts` | `({ channel: 'text_back', tenantId, reason }) => Promise<{ kind: 'disarmed', config, auditId } \| { kind: 'already_disarmed', config \| null }>` |
| `listArmedTextBackTenantIds` | `src/db/repository/messaging-config.ts` | `() => Promise<string[]>` |
| `claimOperatorAlert` | `src/db/repository/operator-alerts.ts` | `(kind: OperatorAlertKind, alertDay: 'YYYY-MM-DD', detail?) => Promise<boolean>` |

**Barrel type exports (new):** `PendingTextBackWindow`, `ClaimedTextBackAlert`, `TextBackEvidence` (missed-calls), `DisarmChannelBySystemInput`, `DisarmChannelBySystemResult` (messaging-config), `MissedCallEscalationClaim`, `UnescalatedQuoteCall` (escalations), `NeverTextAdd`, `TextBackTemplateInsert` (for-tenant).

**`forTenant()` namespace methods (new):**

- `textBackTemplates.insertVersion({ variant, body, segments, createdBy })`: version computed inside the INSERT.
- `textBackTemplates.attestWhereUnattested(versionId, note, attestedBy, at)`: guarded on `attested_at IS NULL`.
- `textBackTemplates.latestForVariant(variant)`, `textBackTemplates.byId(versionId)`.
- `textBackTemplates.attestedSetStatus()`: returns `Record<TextBackVariant, boolean>`.
- `neverText.add({ numberE164, kind, label, createdBy })`: returns `[]` when the number is already listed.
- `neverText.remove(id)`, `neverText.has(numberE164)`, `neverText.countOwnLines()`.

Unchanged and deliberately not edited: `armChannel`, `disarmChannel` (plan 12-08), `MESSAGING_CHANNELS` (still `['sms','email']`) and `for-all-tenants.ts` (16 `forAllTenants_*` exports, import block untouched). `cadences.create` still names no conflict target. There is still no update, delete or un-attest path for a template version, and no delete path for leads.

## Verification

- Task 1 gate: `npm run typecheck`, `npm run lint` and `npx vitest run tests/lint-ban.test.ts` (29/29) all passed. `git diff --quiet 2db0791 -- tests/sync-upsert.test.ts tests/report-metrics.test.ts tests/cron-schedules.test.ts scripts/apply-cron-schedules.mjs` passed, and `grep -c "^export async function forAllTenants_"` returned 16.
- Task 2 gate: typecheck, lint and `lint-ban` all passed. The two suites are 356 and 822 lines.
- Local full `vitest run`: 4117 tests passed and 0 failed. All 47 failed files are DB-backed suites (each imports `tests/helpers/seed` or `env`) that refuse the non-local target, which is by design.
- **Not run here** (CI in plan 12-03): `tests/lead-cadence-inert.test.ts` and `tests/text-back-repository.test.ts`. Nothing was pushed, `npm run db:migrate` was not run, and no statement touched production. `ALLOW_REMOTE_TESTS` was never set.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Correctness] The evidence read's join also carries the ledger's tenant**
- **Found during:** Task 1
- **Issue:** The plan joins by `text_back_ledger_id` alone. A mis-set ledger id would then let one client's proof read another client's delivery facts.
- **Fix:** The LEFT JOIN condition is `send_ledger.id = text_back_ledger_id AND send_ledger.tenant_id = <tenant>`.
- **Commit:** 3eab24b

**2. [Rule 1 - Bug avoidance] No raw Date inside a sql template for the coalesce reference instant**
- **Found during:** Task 1
- **Issue:** `coalesce(ended_at, started_at) <= $date` written as a sql template binds a raw Date, which hits the postgres.js Bind-time trap documented at `promoteDue`. Typecheck and lint cannot see this.
- **Fix:** A private `referenceInstant(op, bound)` writes `(ended_at IS NOT NULL AND op(ended_at, bound)) OR (ended_at IS NULL AND op(started_at, bound))`. The two arms are exhaustive and exclusive, so it is exactly the coalesce, and every bound is column-encoded.
- **Commit:** 3eab24b

**3. [Rule 2 - Correctness] The system disarm flips with a guarded UPDATE, not the upsert**
- **Issue:** `upsertWith` takes `MessagingChannel` (no `text_back`). An upsert would also create a row where none exists, and a concurrent operator disarm could produce two audit rows for one flip.
- **Fix:** `UPDATE ... WHERE id = target.id AND enabled = true RETURNING`. Zero rows means `already_disarmed` with no audit row. The audit INSERT is inline in the same transaction, and the operator writers' private `appendAudit` is unchanged.
- **Commit:** 3eab24b

**4. [Scope note] `tests/helpers/seed.ts` not modified**
- The plan allowed seed extensions "only where a case needs a new knob". The existing `seedLeadCadence` and `seedTouches` overrides already accept `created_at`, `status` and `scheduled_at`, so no helper changed.

### TDD Gate Compliance

Task 2 is `tdd="true"`, but both suites are DB-backed and refuse a non-local target, so no RED run was possible locally. The implementation they prove landed in Task 1, under the same constraint 12-01 documented. Their first execution is CI in plan 12-03, which is the gate that proves them.

## Known Stubs

None. Nothing in this plan renders or sends. The new reads and claims have no caller yet; 12-04 to 12-08 wire them.

## Threat Flags

None. Every new surface is in the plan's threat model:
- T-12-17: lead touch reaching dispatch. Proven by the inert suite with a quote control.
- T-12-14: system disarm in one transaction, plus the two CHECK forgeries asserted by raw INSERT.
- T-12-07: no number in the sweep, alert or evidence select lists; `forwardedFromPresent` is computed in SQL.
- T-12-11: tenant in every predicate; cross-tenant `byId`, attest, remove and evidence asserted empty or null.

## Self-Check: PASSED

- Files exist: `src/db/repository/operator-alerts.ts`, `tests/lead-cadence-inert.test.ts`, `tests/text-back-repository.test.ts`.
- Commits `3eab24b` and `26203d9` are present in `git log`. Neither is pushed.
