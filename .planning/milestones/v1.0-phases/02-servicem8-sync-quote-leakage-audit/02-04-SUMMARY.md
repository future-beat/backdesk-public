---
phase: 02-servicem8-sync-quote-leakage-audit
plan: 04
subsystem: servicem8-sync
status: complete
tags: [servicem8, sync, alerting, resend, health, console, ui, rekey]

requires:
  - "02-01: sm8_connections, connect form + action, Sm8Client, crypto"
  - "02-02: applyFailurePolicy, runSyncForConnection, onAlert hook, sync_runs, pause fields"
provides:
  - "sendOperatorAlert — Resend-backed operator alert with a typed, never-throwing outcome"
  - "SYNC_OUTCOME_LABELS / syncOutcomeLabel — the only human rendering of the sync vocabulary"
  - "deriveHealth + HEALTH_LABELS + HEALTH_BADGE_CLASS — the single origin of every health string"
  - "resumeConnection — verify, re-key, clear the episode, sync now (D-08)"
  - "rekeyAction — WR-01 auth-first server action for the re-key form"
  - "formatInTenantZone — shared client-timezone date rendering"
  - "CSS tokens --ok/--warn, .badge--ok/--warn/--error, .banner-error, .disclosure"
affects:
  - "02-05 (triage renders inside the Open quotes section this plan left intact)"
  - "02-06/02-07 (audit pages inherit the badge/banner CSS vocabulary)"
  - "Phase 3 (dispatch still checks paused_at itself; this plan only makes the pause visible and recoverable)"
  - "Phase 4 (verifying a service-owned domain flips OPERATOR_ALERT_FROM with no code change)"

tech-stack:
  added:
    - "resend 6.22.1 (pinned exact, human-approved legitimacy gate)"
  patterns:
    - "Alert sinks return typed outcomes and never throw into the loop that called them"
    - "Derived state computed from ONE row, so two renderers cannot disagree"
    - "Closed vocabularies get a label map, not a .replace() per render site"
    - "Policy decisions evaluated inside the row lock they will be written under"

key-files:
  created:
    - src/core/alerts/operator-email.ts
    - src/core/sync/outcomes.ts
    - src/core/sync/health.ts
    - tests/sync-failure-alerts.test.ts
    - tests/rekey-resume.test.ts
  modified:
    - src/core/shared/env.ts
    - src/core/shared/tenant.ts
    - src/core/servicem8/normalize.ts
    - src/core/sync/connect.ts
    - src/core/sync/failure-policy.ts
    - src/core/sync/run-sync.ts
    - src/app/globals.css
    - src/app/(console)/page.tsx
    - src/app/(console)/clients/[id]/page.tsx
    - src/app/(console)/clients/[id]/actions.ts
    - src/app/(console)/clients/[id]/connect-form.tsx
    - tests/helpers/env.ts
    - docs/env-vars.md
    - package.json

decisions:
  - "deriveHealth takes ONE argument — the plan's sketched lastRun parameter is consulted by none of the four rules, and an ignored parameter invites two renderers to pass different inputs"
  - "resumeConnection is a separate function from connectServiceM8: reusing connect would re-run the backfill and revert every triage decision to needs_review"
  - "Auth alerts deduped on alerted_at inside the pure policy rather than relying on the tick's paused_at filter"
  - "The failure policy is evaluated INSIDE the connection lock, against the locked row"
  - "normalizeJob relocated to servicem8/normalize.ts to break a connect<->run-sync import cycle"
  - "RESEND_API_KEY and OPERATOR_ALERT_EMAIL are REQUIRED env; OPERATOR_ALERT_FROM and APP_BASE_URL optional with documented fallbacks"

metrics:
  duration: ~23 minutes
  completed: 2026-08-26
  tasks: 3
  commits: 2
  tests_added: 32
  tests_total: 355

actuals:
  tokens: 71000
  tasks: 3
  commits: 2
---

# Phase 02 Plan 04: Sync Health + Operator Alerting Summary

A revoked ServiceM8 key now produces exactly one email, a persistent red banner, and a one-paste recovery that clears the pause and syncs immediately — with the badge, the banner and the alert all computed from the same row, so none of them can contradict the others.

## What was built

**Task 1 — the package legitimacy gate (no commit; a checkpoint).** `resend` was flagged `SUS` by the legitimacy check. The verdict rested on a single reason, `too-new`: version 6.22.1 was published two days before this run. Every other signal was clean — 10,143,531 weekly downloads, the official `resend/resend-node` repository, no postinstall hook, not deprecated. The user reviewed and approved. Installed with `--save-exact`, so `package.json` reads `"resend": "6.22.1"` with no caret. A range would have re-opened the supply-chain question on every future `npm install` without anyone being asked again.

**Task 2 — the alert (`bdfd2b7`).** `sendOperatorAlert` sends through Resend and returns a typed `ok`/`failed` outcome; nothing in it throws. `run-sync`'s `onAlert` default, a no-op left behind by 02-02, is now wired to it. Two things about the wiring matter more than the send itself, and both are covered below under deviations: the auth alert is now deduped inside the *policy*, and the policy is now evaluated inside the *lock*.

**Task 3 — the console (`d113b8e`).** `deriveHealth` plus the label and badge-class maps; the auth-failed banner; Sync and Last-sync columns on the client list; the last-10 sync-runs table; and `resumeConnection` behind a "Replace key" disclosure that opens itself when the client is broken.

## The counting problem this plan is really about

Both halves of SYNC-04 reduce to getting a number right, and both directions of being wrong end the same way — the operator does not read the alert.

**Too many.** A dead key at a five-minute tick is 288 emails a day about one problem. The operator filters the sender, and the next alert — about a different client — lands in a folder nobody opens.

**Too few.** An episode that alerted, recovered, and broke again must alert again. A dedupe keyed on "have we ever emailed about this client" silences every future failure for them permanently, which is the silent dead client this phase exists to prevent, arrived at by way of the fix for it.

Five tests pin the count directly (one auth alert; no second; two transients silent; the third alerts once; a success re-arms), and two more prove the re-arm by driving a second episode to a second alert.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 2 — Missing critical] The auth alert was deduped by the caller, not the policy**

`applyFailurePolicy` returned `alertKind: 'auth'` for every auth failure, with a comment arguing the alert could not repeat because the same decision pauses the connection and the tick skips paused connections.

That argument is true of `runSyncTick`, and true of the webhook adapter, and it is not a property of the function — it is a property of two callers that happen to filter first. The plan's own test list demands "second auth-failed cycle → no second alert", which is unprovable against a policy whose guarantee lives in somebody else's `WHERE` clause. `alertKind` is now `alertedAt === null ? 'auth' : null`. The pause stays unconditional: silence is about the email, never about the state.

- **Files:** `src/core/sync/failure-policy.ts`
- **Commit:** `bdfd2b7`

**2. [Rule 1 — Bug] The dedupe field was read from a pre-lock snapshot**

`recordFailure` computed the policy decision from `conn.alertedAt` and `conn.consecutiveFailures` — values fetched before the transaction opened — while writing `locked.consecutiveFailures + 1`. Two overlapping failing runs (the poll and a webhook hint arriving mid-poll) would both read `alerted_at = null` from their own stale snapshots and both email.

The decision is now made inside the transaction, against the locked row. This is the same argument the file already makes for re-reading the cursor from the locked row, applied to the field the whole dedupe rests on.

- **Files:** `src/core/sync/run-sync.ts`
- **Commit:** `bdfd2b7`

**3. [Rule 3 — Blocking] `resumeConnection` would have created an import cycle**

The plan puts `resumeConnection` in `sync/connect.ts`, and it has to trigger an immediate cycle — so `connect.ts` must import `run-sync.ts`. `run-sync.ts` already imported `normalizeJob` from `connect.ts`.

ESM tolerates that cycle today, because both bindings are hoisted function declarations. It stops being tolerated the moment either module grows a top-level constant that reads across the boundary, and the failure then is an `undefined` at import time with a stack naming neither file. `normalizeJob` moved to `servicem8/normalize.ts`, where every function it calls (`moneyToNumeric`, `sm8ToUtc`, `SM8_TIMESTAMP_ZONE`) already lived — it was a normalization concern wearing a connect module's address. One import site updated; no cycle remains.

- **Files:** `src/core/servicem8/normalize.ts`, `src/core/sync/connect.ts`, `src/core/sync/run-sync.ts`
- **Commit:** `d113b8e`

**4. [Rule 2 — Missing critical] Two env vars the plan did not name**

The plan specifies `RESEND_API_KEY` and `OPERATOR_ALERT_EMAIL`, and requires the alert body to carry "the client detail URL" — but no base-URL variable existed anywhere in the project, so the URL could not be built. `APP_BASE_URL` was added (optional; falls back to `VERCEL_PROJECT_PRODUCTION_URL`, then localhost). `VERCEL_URL` is deliberately not used: it is unique per deployment and 404s once superseded, and an alert email outlives the deployment that sent it.

`OPERATOR_ALERT_FROM` was added for the same class of reason. Before a domain is verified Resend permits only its onboarding sender; hardcoding that address means a code change on the day Phase 4 verifies a domain, for a value that is a fact about the Resend account rather than about the program. Both are optional, so no existing `getServerEnv()` caller breaks.

- **Files:** `src/core/shared/env.ts`, `docs/env-vars.md`, `tests/helpers/env.ts`
- **Commit:** `bdfd2b7`

### Intentional design deviations

**5. `deriveHealth` takes one argument, not two**

The plan's artifact spec sketches `deriveHealth(connection, lastRun)`. None of the four rules it then specifies consults a run row: auth-failed reads `paused_at`/`status_reason`, never-synced reads `last_success_at`, degraded reads `consecutive_failures`. A parameter the function ignores is worse than no parameter — it advertises a dependency the badge does not have, and invites the badge's caller to pass a different run row than the banner's caller.

That trade sits directly against the plan's own must-have: *badge and banner can never disagree*. The strongest available guarantee of that is not discipline at two call sites; it is a function whose entire input is one row both call sites already hold. `sync_runs` is still what the operator *reads* — it is just not what the badge is *computed* from.

**6. `resumeConnection` is a new function, not a call to `connectServiceM8`**

02-01's summary noted that `connectServiceM8` already clears the pause fields, "so D-08 auto-resume needs no new code". Following that would have been a bug: connect also re-runs the 90-day backfill, and the backfill writes `chase_eligibility = 'needs_review'` over every open quote. A re-key would silently un-approve every quote the operator had triaged — the exact decision D-15 and the omitted upsert conflict-set column exist to protect. A re-key is a credential change, not a re-onboarding. Asserted by a test that approves a quote, re-keys, and checks it is still `eligible`.

**7. A failed immediate sync is still a successful re-key**

The key verified against the live API one moment earlier. If the cycle then hits a 429, that is weather; the connection is correctly unpaused and the next tick retries. Returning failure would send the operator hunting for a third key that does not exist. The action's success copy says which of the two happened, so the next five minutes of unchanged data are not a mystery.

**8. `error_detail` is not rendered in the sync-runs table**

02-02 writes the classified kind into `error_detail`, redundant with `outcome` by design. Rendering both would give the table a column that looks like detail and is not. The operator gets the classified outcome and the time, which is exactly what the UI-SPEC row permits.

**9. `SYNC_OUTCOME_LABELS` lives in a new `src/core/sync/outcomes.ts`**

Not in the plan's file list. The six labels are needed by both the email body and the console table, and the alternative homes were worse: a schema module would pull drizzle into a React server component's graph for a string map, and two `.replace()` calls at two render sites would make "no raw error text reaches a human" unprovable. Exhaustive over `SyncOutcome` by type, so a seventh outcome fails to compile rather than emailing `undefined`.

## Threat mitigations applied

| Threat | Applied |
|---|---|
| T-2-SC | Blocking-human legitimacy gate (never auto-approved) + `--save-exact` pin at 6.22.1; the SUS verdict's single reason recorded above rather than waved past |
| T-2-16 | `alertBody` is pure and exported; asserted verbatim for all six outcomes, and asserted NOT to contain `X-API-Key`, `api.servicem8.com`, `api_1.0`, `enc:v`, `Bearer ` or a stack frame. Provider failures reported by `error.name` only — `error.message` asserted absent from the source |
| T-2-10 | Episode dedupe on `alerted_at` for both alert kinds, evaluated inside the row lock; seven tests across both directions of the count |
| T-2-02 | `resumeConnection` reuses the verify→encrypt path; ciphertext-only storage asserted (`enc:v1` prefix); a rejected key leaves the row byte-identical; both console pages asserted not to select `api_key_ciphertext` |

## Verification

| Check | Result |
|---|---|
| `ALLOW_REMOTE_TESTS=yes npx vitest run tests/sync-failure-alerts.test.ts` | 14 passed |
| `ALLOW_REMOTE_TESTS=yes npx vitest run tests/rekey-resume.test.ts` | 18 passed (live ServiceM8 branches ran — `SM8_TEST_API_KEY` present) |
| `ALLOW_REMOTE_TESTS=yes npx vitest run` (full suite) | **355 passed** (32 new) |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npm run build` | compiled, 7 routes |

### Acceptance criteria

| Criterion | Evidence |
|---|---|
| Five dedupe/episode behaviours pass exactly as stated | `sync-failure-alerts.test.ts`, plus two re-arm cases |
| `package.json` pins an exact resend version | `"resend": "6.22.1"` — asserted by inspection, no caret |
| `operator-email.ts` imports nothing from `next/*`, returns a typed outcome | source assertions |
| Alert body uses only classified vocabulary | verbatim + negative assertions over all six outcomes |
| Re-key test passes both branches | live good key clears all four fields + syncs; garbage key leaves the row untouched |
| `--ok`/`--warn` in BOTH light and dark blocks | source assertion splitting on the dark media query |
| Badge text always includes the state word; `deriveHealth` is the only origin | label/state equality test + both pages asserted free of literal health strings |
| Banner renders only for auth-failed, exact UI-SPEC copy | source assertion on the guard and the copy, plus no dismiss control |

## Known Stubs

None. Every path in this plan is wired to real data and exercised.

Two deliberate not-yet-built items owned by later plans, neither a stub here:

- The **quotes table remains 02-01's list**, not the D-16 filtered table with the triage checklist. Both are plan 02-05's, and the section was left structurally intact for it to build into.
- `baseline_*` on `sm8_connections` remains unpopulated — D-14 is plan 02-06's.

## UAT — needs a human

Two items, and the first one is inherited.

**02-01's console UI was still never visually verified**, and this plan built the re-key flow on the same form. That UAT item is now larger rather than discharged.

**The end-to-end alert loop has not been observed live.** Every dedupe rule is proven under test with an injected spy, and the Resend send path is deliberately not exercised in CI — but nobody has watched an email arrive. Research assumption A6 (the free tier delivers from the onboarding sender to the account owner's own address, pre-domain-verification) is still **[ASSUMED]**, and it is the assumption the whole alert half rests on.

Worth 10 minutes before the phase closes:

1. `npm run dev`, sign in, open a client on a phone-width viewport.
2. Revoke the trial key in ServiceM8, wait for a tick (or hit the tick route).
3. Confirm: the banner appears under the h1 with the failure date, the badge reads `auth failed` on both the list and the detail page, and **one** email arrives.
4. Wait for a second tick — confirm no second email.
5. Open "Replace key" (it should already be open), paste a fresh key, confirm the CTA reads `Save new key & resume`.
6. Confirm the banner is gone, the badge reads `healthy`, and a fresh `ok` row is at the top of Recent sync runs.

If step 3 produces no email, A6 is false and the fallback is to verify one service-owned domain — which Phase 4 needs anyway — and set `OPERATOR_ALERT_FROM`.

## Notes for the next plans

- **02-05 (triage):** the Open quotes section is untouched and is yours to replace. `chase_eligibility` now survives a re-key as well as a sync — asserted.
- **02-06/02-07 (audit):** `.badge--ok/--warn/--error` and `--ok`/`--warn` exist in both schemes; the UI-SPEC reserves them for sync health, so the audit report should not reach for them.
- **Phase 3:** unchanged contract — check `paused_at IS NULL` yourself. What is new is that a pause is now visible and recoverable, not that anything downstream may assume it will be cleared.
- **Phase 4:** verifying a service-owned domain is a one-variable change (`OPERATOR_ALERT_FROM`), not a code change.
- **Deferred:** `.planning/phases/02-servicem8-sync-quote-leakage-audit/deferred-items.md` records four pre-existing `npm audit` advisories reaching `drizzle-kit` through `esbuild`. Unrelated to `resend`; the only fix is a major drizzle-kit downgrade.

## Self-Check: PASSED

All 5 created files verified present on disk; both commits (`bdfd2b7`, `d113b8e`) verified in `git log`. Neither commit deleted a tracked file.
