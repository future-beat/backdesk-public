---
phase: quick-260902-1kw
plan: 01
subsystem: tests
tags: [ci, fixtures, onboarding-gate, ONB-04, cadence]
status: complete

requires:
  - "06-04 — the two-condition activation gate (onboardingComplete)"
provides:
  - "cadence-consume-events and cadence-tick fixtures that satisfy both ONB-04 gate conditions"
affects:
  - "CI on main — 15 of 19 red tests are now green; 4 remain (see Deferred Issues)"

tech-stack:
  added: []
  patterns:
    - "A fixture for a suite whose subject is NOT the gate must satisfy EVERY gate condition, not the one that existed when it was written"

key-files:
  created: []
  modified:
    - tests/cadence-consume-events.test.ts
    - tests/cadence-tick.test.ts

decisions:
  - "The line-810 deliberate-absence block stays byte-identical — a born-paused test whose tenant gained an attestation would still pass, for the wrong reason, and the missing-template-set arm would stop being asserted anywhere"
  - "The CAD-05 all-zero failure was NOT fixed here despite living in a plan file: proving it needs a second production-shared remote window, and it belongs with the three other out-of-plan failures in one follow-up window rather than exposing the shared DB twice"

metrics:
  duration: "~25 min"
  completed: 2026-09-02

actuals:
  tokens: 18711
  tasks: 3
  commits: 1
---

# Quick Task 260902-1kw: Seed the sm8_automation_off attestation in the cadence suites — Summary

Three stale fixtures now satisfy both ONB-04 activation conditions, turning 15 of the 19 red CI tests green — but the run's own log shows the diagnosis was incomplete and main stays red on 4 tests in 3 files.

## What Was Built

Phase 6 plan 06-04 made cadence activation a **conjunction**: a cadence is born active only when the tenant holds BOTH an approved template set (ONB-03) and an `sm8_automation_off` attestation (ONB-04). `consume-events` asks `onboardingComplete` at creation. Two older DB suites still seeded only the template set, so every cadence they created was born `paused(onboarding)` and every born-active expectation failed.

The gate is correct. The fixtures were stale. Three `seedAttestation` calls were added beside the three stale `seedApprovedTemplateSet` calls:

| File | Site | Why that tenant needs both conditions |
|------|------|----------------------------------------|
| `tests/cadence-consume-events.test.ts` | main-tenant `beforeAll` (line 255) | Every stop/replay/cursor block above the gate section asserts `active` for reasons unrelated to onboarding |
| `tests/cadence-consume-events.test.ts` | `UNCHANGED BEHAVIOUR once the set is approved` (line 941) | The test's whole claim is that the gate OPENS — it cannot open on one condition |
| `tests/cadence-tick.test.ts` | tracer `beforeAll` (line 179) | materialize → promote → dispatch cannot run behind the activation gate |

Comments that stated the gate as template-set-only were rewritten to name both conditions — at each call site and at the born-paused section banner, which had attributed the suite tenant's `active` cadences to the template set alone.

**The line-810 block is byte-identical.** `// NO seedApprovedTemplateSet HERE. That absence is the subject.` and the `hasApprovedTemplateSet(...)  === false` assertion are untouched, so the missing-template-set arm of the gate is still exercised by a tenant that satisfies neither condition.

## Key Implementation Details

- `seedAttestation` needed no change: it already inserts a `tenant_attestations` row of kind `sm8_automation_off` through the service-role admin client — the exact evidence row `hasSm8AutomationAttestation` reads.
- Staleness is irrelevant to these fixtures. `hasSm8AutomationAttestation` deliberately does not look at `attested_at` (D-15 makes staleness a nag, never a block), so a freshly-seeded row satisfies the condition unconditionally.

## Verification

| Gate | Result |
|------|--------|
| Task 1 automated verify (3 call sites, 2 imports, line-810 intact) | PASS |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | exit 0 |
| Bare `npm test` (dummy `STALLED_DIGEST_SECRET` injected on the command line) | **2123 tests passed, 0 assertion failures**; 35 file failures are the pre-existing WR-09 remote refusals |
| One serialized `npm run test:remote -- tests/cadence-consume-events.test.ts tests/cadence-tick.test.ts` | 23 passed, 1 failed — every ONB-04 gate failure green; the 1 failure is unrelated (below) |
| `git diff --stat` on the commit | only the two test files; no `src/`, no migration, no `.env*` |

Exactly **one** remote window was run. The harness re-armed both production cron jobs and released the pause lease cleanly (`re-armed production cron job 'cadence-tick'` / `'sm8-sync-tick'` / `released the pause lease`).

Every test named in the plan's `must_haves` passed in that window: the four `won`/`lost`/`removed`/`reopened` stops, `starts a fresh second cadence`, `walks the whole batch`, `refuses to re-create…`, `advances the cursor`, `UNCHANGED BEHAVIOUR once the set is approved: the next quote opens ACTIVE`, and the cadence-tick tracer.

## Deviations from Plan

### [Rule 2 - Missing correction] Section banner comment corrected

- **Found during:** Task 1's "scan the remainder for comments that now state something false"
- **Issue:** The born-paused section banner (`tests/cadence-consume-events.test.ts` line ~779) read "Every block above asserts `active` because the suite tenant HAS an approved template set" — a template-set-only reading of the gate, which the plan's done-criterion forbids.
- **Fix:** Rewritten to name both conditions. It sits above `let gatedTenantId` and outside the born-paused `it()` body, so the byte-identical requirement on the line-810 block is unaffected.
- **Commit:** 73a782b

## Deferred Issues

**The plan's diagnosis was incomplete. Main is still red.** CI run 33493964984 failed on **19** tests, not the 15 the plan modelled. This task fixed the 15 ONB-04 ones. Four remain, in three files, and none is an ONB-04 gate failure:

| # | File | Test | Nature |
|---|------|------|--------|
| 1 | `tests/cadence-tick.test.ts` | `completes a tick with no due work as an all-zero result (CAD-05)` | Stale exhaustive `toEqual`. Phase 6 added six counters to `CadenceTickResult` (`hotEscalated`, `escalationUnconfigured`, `escalationSendFailed`, `stallAlertSent`, `stallAlertFailed`, `touchesNewlyStalled`) that the expected literal never gained. Note `escalationUnconfigured` reads **1**, not 0, on a quiet tick — so it needs the `expect.any(Number)` + separate-assertion treatment `draftingUnconfigured` already has, which is a test-design judgement, not a mechanical field add. |
| 2 | `tests/onboarding-gate.test.ts` | `approveTemplateVersion > APPROVES WITHOUT RESUMING while the set is still incomplete` | Not in this plan's scope or files. |
| 3 | `tests/onboarding-gate.test.ts` | `the version that completes the set > resumes ONLY the onboarding-paused cadences, and re-windows only those` | Not in this plan's scope or files. |
| 4 | `tests/sync-upsert.test.ts` | `source guarantees > keeps the cross-tenant surface to exactly seven named exports` **and** `reaches exactly seven tables from the cross-tenant file, and no more` | **Likely architectural.** These two assertions exist precisely to force a human to ratify any widening of the cross-tenant surface. Phase 6 appears to have widened it. Whether the eighth export/table is legitimate is a Rule 4 decision, not a fixture edit. |

**Why #1 was not fixed here despite living in a plan file.** Proving it requires a remote window against the production-shared Sydney Supabase, and this task was constrained to exactly one. Items 1–4 need one follow-up window between them; fixing #1 alone now would have spent a second window to prove a quarter of the remaining work. Deferring it means one future window proves all four.

**Recommended follow-up:** a quick task scoped to items 1–3 (fixtures), with item 4 raised as a decision first — "did Phase 6 legitimately widen the cross-tenant surface to eight?" — since the answer determines whether that test's constant is corrected or the src/ change is reverted.

## Threat Flags

None. No new surface: two test files, no `src/`, no schema, no environment file. The T-Q-01 production-DB mitigation held (one serialized window, crons re-armed, lease released). T-Q-02 held (the `STALLED_DIGEST_SECRET` dummy was injected per-command; no `.env*` file was read for it or edited).

## Self-Check: PASSED

- `tests/cadence-consume-events.test.ts` — FOUND
- `tests/cadence-tick.test.ts` — FOUND
- commit `73a782b` — FOUND
