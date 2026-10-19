---
phase: 03-cadence-engine
plan: 06
subsystem: infra
tags: [pg_cron, next-route-handler, timingSafeEqual, bearer-auth, vercel, supabase, state-machine]

# Dependency graph
requires:
  - phase: 03-02
    provides: runCadenceTick — the consume/progress/dispatch orchestrator this route wraps
  - phase: 03-03
    provides: cadenceTransition — the matrix whose all_touches_done cell this plan finally drives
  - phase: 03-04
    provides: the progress pass and dispatch claim the tick calls before the new sweep
  - phase: 02-03
    provides: the sync-tick route and cron script this plan clones and generalizes
provides:
  - POST /api/internal/cadence-tick — authenticated per-minute tick endpoint
  - CADENCE_TICK_SECRET — a second, independently-rotating bearer
  - a two-job cron script (sm8-sync-tick */5, cadence-tick every minute)
  - the production driver for all_touches_done → completed (post-dispatch sweep)
affects: [phase-04-messaging, phase-05-drafting, phase-07-reporting]

actuals:
  tokens: 16171
  tasks: 2
  commits: 7

tech-stack:
  added: []
  patterns:
    - "Two cron jobs, two secrets: dispatch latency decoupled from ServiceM8, rotation blast radius halved"
    - "Route response enumerates its fields rather than spreading the worker result, so a future field cannot leak into a cron log"
    - "Completion decided by one guarded UPDATE with EXISTS + NOT EXISTS, never by an app-side read-then-write"

key-files:
  created:
    - src/app/api/internal/cadence-tick/route.ts
    - tests/cadence-tick-route.test.ts
    - tests/cadence-completion-sweep.test.ts
  modified:
    - src/core/shared/env.ts
    - src/core/cadence/run-tick.ts
    - src/db/repository/for-tenant.ts
    - scripts/apply-cron-schedules.mjs
    - tests/cron-schedules.test.ts
    - tests/helpers/env.ts
    - tests/cadence-tick.test.ts
    - tests/cadence-controls.test.ts
    - tests/cadence-resume.test.ts
    - docs/env-vars.md
    - .github/workflows/ci.yml

key-decisions:
  - "CADENCE_TICK_SECRET is a second variable, not a reuse of SYNC_TICK_SECRET — rotating a shared bearer 401s BOTH ticks until the redeploy lands, so no client is synced AND no customer is contacted"
  - "The cadence tick runs every minute, not every five: a */5 tick rounds every materialized slot up to the next multiple of five and collapses the jitter that exists so fifteen clients' follow-ups do not all leave at 09:00"
  - "The route enumerates its nine response fields instead of spreading CadenceTickResult, so a field added later for an operator's benefit is a compile error to reach rather than a leak to notice"
  - "completeWhereAllTouchesDone is guarded on status = 'active', NOT the live pair used by the stop and expiry writes — a stop is about the QUOTE and an expiry about TIME, both of which dominate a pause; running out of touches does not"
  - "The completion sweep requires EXISTS(touch) alongside NOT EXISTS(live touch): 'every touch is terminal' is vacuously true of a cadence with none, and completing one would retire a quote that was never chased once"
  - "The sweep is a post-dispatch pass, not a consequence of the last send: a cadence's final touch is as often skipped as sent, and those writes happen in three places"

patterns-established:
  - "Two-secret tick separation: each scheduled job carries its own bearer so a rotation can only break the half it names"
  - "Cron script drives a JOBS list through ONE apply loop — the printing rule and unschedule-first guard have a single implementation, asserted by a source check that counts cron.schedule calls"
  - "Schedule suites snapshot and restore EVERY job the script writes, reading the set from the script's own list"

requirements-completed: [CAD-01, CAD-02]

coverage:
  - id: D1
    description: "POST /api/internal/cadence-tick runs runCadenceTick behind a constant-time bearer and returns a counts-only body; unauthenticated calls get a plain 401 with no Location header"
    requirement: CAD-02
    verification:
      - kind: unit
        ref: "tests/cadence-tick-route.test.ts#THE PITFALL-7 ASSERTION: the 401 is a plain response, not a redirect"
        status: pass
      - kind: unit
        ref: "tests/cadence-tick-route.test.ts#THE T-3-24 ASSERTION: the body is numbers under fixed labels, nothing else"
        status: pass
      - kind: unit
        ref: "tests/cadence-tick-route.test.ts#rejects the SYNC tick secret — the two secrets are not interchangeable"
        status: pass
    human_judgment: false
  - id: D2
    description: "CADENCE_TICK_SECRET exists as a required server env var with an explicit process.env reference, documented, and dummied in CI"
    requirement: CAD-02
    verification:
      - kind: other
        ref: "grep -c CADENCE_TICK_SECRET src/core/shared/env.ts (returns 2)"
        status: pass
      - kind: integration
        ref: "npm run build — /api/internal/cadence-tick present in the route manifest"
        status: pass
    human_judgment: false
  - id: D3
    description: "The cron script applies both tick schedules idempotently from env, each with its own bearer, printing job name and schedule only"
    requirement: CAD-01
    verification:
      - kind: integration
        ref: "tests/cron-schedules.test.ts#exists, EVERY MINUTE, active"
        status: pass
      - kind: integration
        ref: "tests/cron-schedules.test.ts#THE ROTATION ASSERTION: it carries its OWN bearer, not the sync tick’s"
        status: pass
      - kind: integration
        ref: "tests/cron-schedules.test.ts#prints its jobname and schedule but never its bearer (T-3-25)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A cadence whose every touch is terminal is completed by the tick; a paused one and a touchless one are not"
    requirement: CAD-01
    verification:
      - kind: integration
        ref: "tests/cadence-completion-sweep.test.ts#completes an ACTIVE cadence whose every touch is terminal, through the real tick"
        status: pass
      - kind: integration
        ref: "tests/cadence-completion-sweep.test.ts#THE MATRIX NOTE 5 ASSERTION: a PAUSED cadence stays paused, touches or not"
        status: pass
      - kind: integration
        ref: "tests/cadence-completion-sweep.test.ts#THE VACUOUS-TRUTH ASSERTION: a cadence with NO touches is not \"done\""
        status: pass
    human_judgment: false
  - id: D5
    description: "A pg_cron job named cadence-tick fires every minute against the DEPLOYED production route, with runs recorded in cron.job_run_details"
    requirement: CAD-02
    verification:
      - kind: manual_procedural
        ref: "curl -X POST https://quote-recovery-mvp.vercel.app/api/internal/cadence-tick → 401 plain, no Location header (pre-schedule gate)"
        status: pass
      - kind: manual_procedural
        ref: "npm run cron:apply → cron.job row 'cadence-tick' schedule='* * * * *' active=true, count=1"
        status: pass
      - kind: manual_procedural
        ref: "cron.job_run_details — three consecutive per-minute runs 03:56/03:57/03:58 UTC, all status=succeeded"
        status: pass
      - kind: manual_procedural
        ref: "net._http_response — HTTP 200 with the counts-only cadence body; zero non-200 responses across both ticks in the preceding 10 minutes"
        status: pass
    human_judgment: false

# Metrics
duration: 1h 24m
completed: 2026-08-28
status: complete
---

# Phase 3 Plan 6: Cadence Tick Route & Schedule Summary

**Per-minute cadence-tick route with its own timingSafeEqual bearer, a two-job cron script that gives each tick an independently-rotating secret, and the post-dispatch sweep that finally drives `all_touches_done → completed` — live in production, ticking every minute at HTTP 200.**

## Performance

- **Duration:** 1h 24m (across three sessions, separated by two checkpoints — a missing secret and a missing deploy)
- **Started:** 2026-08-27T22:41:00Z
- **Completed:** 2026-08-28T03:58:00Z
- **Tasks:** 2
- **Files modified:** 14

## Accomplishments

- `POST /api/internal/cadence-tick` — a shape-for-shape clone of the proven sync tick, with `maxDuration = 300`, `runtime = 'nodejs'`, a length-guarded `timingSafeEqual` bearer, and the awaited call (no `waitUntil`; sends are must-happen work).
- `CADENCE_TICK_SECRET` as a **second** secret. The two ticks are separate cron jobs so a slow ServiceM8 can never delay a send; sharing a bearer would re-couple them at the one moment separation matters most — rotation, where a shared value 401s both ticks at once.
- `scripts/apply-cron-schedules.mjs` generalized to a two-entry `JOBS` list driven through **one** apply loop, so the printing rule and the unschedule-first guard have a single implementation.
- **The `all_touches_done` gap, closed** — the blocker carried forward from 03-04 and 03-05. `transitions.ts` had prescribed `active + all_touches_done → completed` since 03-03 and nothing raised the event, so a finished cadence sat `active` until D-12 expired it at 42 days, reporting "ran out of time" for a schedule that had run its course.
- Phase gate green: `npm run test:remote` — **48 files, 1049 tests, all passing**.
- **The engine is live.** `cadence-tick` fires every minute against production and returns HTTP 200 with the counts-only body.

## Task Commits

1. **Task 1: Cadence-tick route with its own secret** — `c229bd5` (feat)
2. **Task 2a: all_touches_done completion sweep** — `ad4be5e` (feat)
3. **Task 2b: two-job cron script + schedule tests** — `fd973b4` (feat)
4. **Task 2c: pre-existing resume-slot flake** — `d4661cf` (fix)

**Plan metadata:** `04aea33`, `633e52a`, and the completion update recorded with this edit.

**Live apply:** `npm run cron:apply` against production, 2026-08-28T03:55Z — no code change, evidence below.

## Files Created/Modified

- `src/app/api/internal/cadence-tick/route.ts` — the per-minute authenticated endpoint
- `src/core/shared/env.ts` — `CADENCE_TICK_SECRET` schema entry + explicit `process.env` reference
- `src/core/cadence/run-tick.ts` — pass 4, the post-dispatch completion sweep; `cadencesCompleted` count
- `src/db/repository/for-tenant.ts` — `completeWhereAllTouchesDone()` replaces the unused `markCompleted()`
- `scripts/apply-cron-schedules.mjs` — two jobs, one loop, per-job secret variable
- `tests/cadence-tick-route.test.ts` — 18 tests: auth, redirect-proof 401, counts-only body
- `tests/cadence-completion-sweep.test.ts` — 5 real-DB tests covering both silent failure modes
- `tests/cron-schedules.test.ts` — both jobs, two distinct dummy secrets, snapshot/restore for each
- `tests/helpers/env.ts`, `.github/workflows/ci.yml`, `docs/env-vars.md` — the keep-in-sync trio

## Decisions Made

**Two secrets, not one.** Rotating a shared bearer 401s both ticks until the redeploy lands: no client synced *and* no customer contacted. Two variables mean a rotation can only break the half it names. A route test asserts the cadence route rejects the sync secret, and the schedule suite uses two distinct dummies so a script that crossed the bearers fails there rather than 401ing every minute in production with every assertion green.

**Per minute, not every five.** The materialized slots carry jitter down to the minute so fifteen clients' follow-ups do not all leave at 09:00 exactly. A `*/5` tick rounds every one of them up to the next multiple of five and collapses exactly that. A no-work minute is one indexed query. (Assumption A2's fallback was not needed — Supabase accepted `* * * * *`.)

**The completion guard is `status = 'active'`, deliberately narrower than the `LIVE_CADENCE_STATUSES` used by the stop and expiry writes.** A stop is about the *quote* and an expiry is about *time*; both dominate a pause. Running out of touches does not. Completing a paused cadence would clear it off the operator's queue and discard the fact that a human still owes it an answer. The obvious implementation — reuse the existing guard, or call the pre-existing `markCompleted()` — gets this exactly wrong, which is why `markCompleted()` was replaced rather than called.

**`EXISTS` alongside `NOT EXISTS`.** "Every touch is terminal" is vacuously true of a cadence with zero touches, so the naive `NOT EXISTS (live touch)` completes cadences whose materialization failed or has not run — retiring a quote that was never chased once, reported with the same word the successful case uses.

**A sweep, not a consequence of the last send.** A cadence's final touch is at least as often *skipped* as sent, and those writes happen in three different places; the check would be missing from the fourth one somebody adds later. It would also put a cadence-wide read inside a single touch's claim transaction, the one place that must stay narrow.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] `CADENCE_TICK_SECRET` added to CI and the test env REQUIRED list in the same commit**
- **Found during:** Task 1
- **Issue:** The variable is a REQUIRED member of `serverEnvSchema`, so every suite reaching `getServerEnv()` fails without it — the breakage that hit CI twice in the preceding two days (`769bcc2`, `c936a91`). `docs/env-vars.md` states the rule explicitly: a variable joining `REQUIRED` must gain a matching `ci.yml` entry in the *same commit*.
- **Fix:** Added to `tests/helpers/env.ts` REQUIRED, and a **distinct** dummy to `ci.yml` — a shared CI value would let a route reading the wrong variable pass CI and 401 in production.
- **Files modified:** `tests/helpers/env.ts`, `.github/workflows/ci.yml`, `docs/env-vars.md`
- **Committed in:** `c229bd5`

**2. [Rule 4 — Architectural, user-approved] The `all_touches_done → completed` production driver**
- **Found during:** Task 2 (carried forward from 03-04 and 03-05, unassigned by this plan)
- **Issue:** 03-06 is the last plan of the phase. Without this, the phase ships with cadences that never reach `completed` — they sit `active` until D-12 expires them at 42 days, mislabelling a finished schedule as one that ran out of time, which Phase 7 would then report on.
- **Resolution:** Surfaced as a checkpoint decision rather than actioned unilaterally; the user chose "add the sweep". Implemented as `completeWhereAllTouchesDone()` + `run-tick.ts` pass 4, with a 5-test real-DB suite covering both silent failure modes.
- **Files modified:** `src/db/repository/for-tenant.ts`, `src/core/cadence/run-tick.ts`, `src/app/api/internal/cadence-tick/route.ts`, `tests/cadence-completion-sweep.test.ts`, `tests/cadence-tick.test.ts`, `tests/cadence-tick-route.test.ts`
- **Committed in:** `ad4be5e`

**3. [Rule 1 — Bug] Two pre-existing resume-slot assertions failed on the time of day**
- **Found during:** Task 2 phase gate
- **Issue:** `tests/cadence-controls.test.ts` and `tests/cadence-resume.test.ts` both asserted `scheduledAt > resumeAt`. When the suite runs *inside* Perth contact hours the first rescheduled touch lands exactly **on** the resume moment — because 03-05 decided that "'may we send now' is answered by asking `nextAllowedSlot` whether the next allowed slot from now IS now". The assertions contradicted the rule the code implements, and failed on a Friday at 11:30 Perth while passing at 6am.
- **Fix:** `toBeGreaterThanOrEqual`. D-07 promises "never in the past", which is exactly what `>=` states; the guarantee against a resume leaving overdue touches is fully preserved.
- **Verification:** Both suites green; full `test:remote` green.
- **Committed in:** `d4661cf` (and `ad4be5e` for the controls half)

---

**Total deviations:** 3 (1 blocking, 1 architectural with user approval, 1 pre-existing bug)
**Impact on plan:** No scope creep. Deviation 2 was explicitly approved and closes a blocker carried across three plans. Deviation 3 fixed two latent time-dependent failures that would have blocked the phase gate for anyone running it during business hours.

## Issues Encountered

**The plan halted twice on preconditions, and both halts were correct.**

*First halt — the secret.* `CADENCE_TICK_SECRET` and `APP_BASE_URL` were absent from `.env.local` (the workspace denies writes to `.env*`) and the secret was not in the Vercel environment. Surfaced as a checkpoint rather than worked around.

*Second halt — the deploy.* With the secret in place, the deployed route still returned **404**. The cause was not the secret: **`origin/main` was 31 commits behind local `main`**, and Vercel deploys from GitHub, so production was serving code from before Phase 3 began. The control check (`POST /api/internal/sync-tick` → 401) isolated it — the app was live, the route simply did not exist yet.

The plan is explicit about this case — *"a 404 means the deploy predates the route; a 307 means proxy misconfiguration — halt and fix, do not schedule"* — so `npm run cron:apply` was deliberately not run. Scheduling a per-minute job against a 404 would have filled `cron.job_run_details` with delivered requests while nothing ever ticked: precisely the silent-green failure this phase exists to prevent. Pushing 31 commits is a release decision, so it was left to the operator, who pushed and redeployed.

**A note on what "green cron" actually proved.** `cron.job_run_details.status = 'succeeded'` only says the `SELECT net.http_post(...)` statement ran — it stays green when the route 401s or 404s, which is RESEARCH Pitfall 7 wearing its third hat. So the live verification went one level deeper and read `net._http_response`, where the real HTTP status and body live. That is where the 200 and the counts-only payload were confirmed.

## Live Verification Evidence

```
curl -X POST .../api/internal/cadence-tick   → 401, content-type text/plain, no Location header
npm run cron:apply                            → Applied: cadence-tick  schedule=* * * * *  active=true
                                                (job names and schedules only; no bearer, no origin, no command)

cron.job            cadence-tick   schedule='* * * * *'  active=true  count=1
                    target=https://quote-recovery-mvp.vercel.app/api/internal/cadence-tick

cron.job_run_details   03:56:00 succeeded │ 03:57:00 succeeded │ 03:58:00 succeeded   (0 non-succeeded)

net._http_response     03:56:00.081  http=200
  {"eventsConsumed":0,"cadencesCreated":0,"cadencesStopped":0,"cadencesExpired":0,
   "touchesRewindowed":0,"touchesSkipped":0,"touchesPromoted":0,"dispatched":0,
   "refused":0,"cadencesCompleted":0}

  status codes across BOTH ticks, preceding 10 minutes:  200 × 5   (no 401, no 404, no 3xx)
```

Three consecutive minute boundaries fired, so this is a running schedule and not a single triggered execution. The response body also confirms the T-3-24 prohibition holds in production: numbers under fixed labels, no customer or client identifiers.

## User Setup Required

None outstanding. `CADENCE_TICK_SECRET` and `APP_BASE_URL` are in `.env.local`, the secret is in the Vercel production environment, and the schedule is applied.

**Rotation runbook** (`docs/env-vars.md` carries the full note): update the Vercel env → redeploy → `npm run cron:apply`. Only the rotated tick 401s in between, which is the entire reason the two ticks do not share a bearer.

## Next Phase Readiness

**The cadence engine is live.** Materialized send times are now honored to the minute without anyone touching anything — the phase goal, met. 1049 tests across 48 files green against the live Sydney database; `typecheck`, `lint` and `build` clean.

**Ready for `/gsd-verify-work 3`.** All four must-have truths are proven, three by automated tests and the fourth by the live evidence above.

**Watch on first real traffic:** every tick so far has been a no-work tick (all counts zero) because no tenant currently has a live cadence with a due touch. The dispatch path has integration coverage but has not yet run against production data — the first eligible quote is the real smoke test, and `send_ledger` plus `cron.job_run_details` are where to watch it.

**Carried forward to Phase 4:** the `cadenceTransition` pause-upgrade gap (`paused(client_paused) + customer_reply → paused(customer_reply)`) is still unclosed but no longer silent — `pauseForReply` returns `upgrade_unsupported`. Closing it needs one guarded pause-or-upgrade write.

**Closed by this plan:** the `all_touches_done → completed` blocker carried across 03-04 and 03-05.

---
*Phase: 03-cadence-engine*
*Completed: 2026-08-28*

## Self-Check: PASSED

All four key files verified present on disk; all commits verified in `git log`.
Live re-verification after the deploy: deployed route 401 (plain, no `Location`),
`cron.job` holds exactly one `cadence-tick` row at `* * * * *`, and three
consecutive per-minute runs returned HTTP 200 with the counts-only body.
