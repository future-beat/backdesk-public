---
quick_id: 260828-jx0
slug: stabilize-remote-test-suite-against-prod
created: 2026-08-28T06:20:25.824Z
status: planned
---

# Quick Task: Stabilize `npm run test:remote` against the production cron ticks

## Root cause (diagnosed, with direct evidence)

The full remote suite intermittently fails exactly one test, moving between
suites across runs, while every suite passes in isolation. The cause is NOT
cross-suite seed leakage (queries are tenant-scoped and `fileParallelism` is
already off). It is an **external concurrent actor**: the hosted Sydney
database carries two ACTIVE production pg_cron jobs —

- `cadence-tick` (`* * * * *`) → POST `https://quote-recovery-mvp.vercel.app/api/internal/cadence-tick`
- `sm8-sync-tick` (`*/5 * * * *`) → POST `.../api/internal/sync-tick`

— and the deployed app runs the whole cadence engine **against the same
database the tests seed**. Captured `net._http_response` rows show the
deployed tick consuming a test-emitted event (`eventsConsumed: 1` at
06:13:00, exactly when `cadence-consume-events` failed with "expected 0 to be
>= 1") and completing a test cadence (`cadencesCompleted: 1` at 06:14:00).
The failure roams because it lands on whichever suite's seeded-state window a
minute boundary falls into; a ~40 s isolation run usually dodges it.

Two secondary defects surfaced by the same investigation:

1. `tests/leak.test.ts` fails when an interrupted earlier run leaves a stale
   seeded tenant behind (e.g. `Cadence Controls 1787896318779-996281`): the
   operator is enrolled in it, so RLS correctly returns its rows and the
   isolation assertion trips on garbage, not on a leak.
2. `tests/cadence-controls.test.ts:413` still asserts strictly
   `scheduledAt > now` on a resume that runs with the PRODUCTION jitter draw;
   jitter = 0 (p = 1/11 per cadence) lands the first touch exactly on `now`
   inside Perth contact hours. Its two sibling assertions were already fixed
   to `>=` with the 03-05 rationale.

## Tasks

1. **`tests/cadence-controls.test.ts`** — change the one remaining strict
   `toBeGreaterThan(now)` (line 413) to `toBeGreaterThanOrEqual`, carrying the
   same comment its siblings already carry. Not a weakening: "never in the
   past" is what D-07 promises; strict `>` contradicts the rule 03-05 decided.

2. **`tests/cron-schedules.test.ts`** — the afterAll restore re-creates
   snapshot jobs with `cron.schedule(...)`, which always creates them ACTIVE,
   silently discarding the snapshot's `active` flag (and un-doing the global
   pause below mid-run). Restore the flag with `cron.alter_job(..., active :=
   snapshot.active)` after re-scheduling.

3. **`tests/helpers/global-setup.ts` (new) + `vitest.config.mts`** — a vitest
   `globalSetup` that, ONLY when the run is sanctioned to hit a remote stack
   (same gate as `tests/helpers/env.ts`, reused via `testEnv`):
   - sweeps stale seeded rows: tenants/prospects whose names end in the seed
     helpers' ` <epoch-ms>-<rand>` stamp AND whose stamp is older than one
     hour, deleted in `teardownTenants`/`teardownProspects` order (reused from
     `tests/helpers/seed.ts`) — heals interrupted runs, fixes `leak.test.ts`;
   - deactivates `cadence-tick` and `sm8-sync-tick` via `cron.alter_job`,
     waits out any tick started in the last ~20 s, and records what it paused;
   - on teardown, re-activates exactly the jobs it paused (by name — jobids
     change when `cron-schedules.test.ts` re-creates them), printing what it
     did; a job found already-inactive at setup is left as found and reported
     loudly with the re-enable statement.

4. **One-off hygiene** — delete the existing stale `Cadence Controls
   1787896318779-996281` tenant (it also causes the production sync tick to
   poll a garbage connection every 5 minutes).

5. **Verify** — `npm run test:remote` twice; expect 0 failures both times and
   the cron jobs active again after each run.

## Out of scope

- Moving tests to a throwaway Supabase project (`.env.test`) — the right
  long-term isolation, already documented in `env.ts`; not buildable today.
- Touching the deployed app or its schedules beyond the paused-window.
