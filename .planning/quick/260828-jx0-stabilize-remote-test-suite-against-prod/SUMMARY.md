---
quick_id: 260828-jx0
slug: stabilize-remote-test-suite-against-prod
status: complete
completed: 2026-08-28T07:05:00.000Z
---

# Summary: Stabilize `npm run test:remote` against the production cron ticks

## Root cause

Not cross-suite seed leakage. The hosted Sydney database carries two ACTIVE
production pg_cron jobs — `cadence-tick` (every minute) and `sm8-sync-tick`
(every 5 minutes) — POSTing to the deployed Vercel app, which runs the full
cadence engine against the same database the remote suites seed. Captured
`net._http_response` rows showed the deployed tick consuming a test-emitted
event (`eventsConsumed: 1`) at the exact minute `cadence-consume-events`
failed with "expected 0 to be >= 1", and completing a test cadence the next
minute. A full run crosses many minute boundaries, so exactly one roaming
test failed per run; a ~40 s isolation run usually dodged the window.

Two secondary defects: (1) stale seeded tenants from interrupted runs
(afterAll never ran) enrolled the operator and failed `leak.test.ts` on rows
RLS correctly returns; (2) `cadence-controls.test.ts` still asserted strictly
`scheduledAt > now` on a resume using the production jitter draw — a
zero-minute draw (p = 1/11 per cadence) inside Perth contact hours lands the
first touch exactly on `now`, which is what rule 03-05 prescribes.

## Changes (commits on `claude/strange-mcclintock-0f7402`)

- `75dff6c` — controls client-resume assertion `>` → `>=`, matching its
  already-fixed siblings and the D-07 "never in the past" guarantee.
- `faa0f52` — `cron-schedules.test.ts` afterAll restore now re-applies the
  snapshot's `active` flag (`cron.schedule` always re-creates jobs ACTIVE,
  which would have silently re-armed the ticks mid-run).
- `88b6258` — new `tests/helpers/global-setup.ts` wired via
  `vitest.config.mts` `globalSetup`: on a sanctioned remote run (env.ts's
  WR-09 gate decides; pure runs and local stacks untouched) it (a) sweeps
  seeded tenants/prospects whose ` <epoch-ms>-<rand>` name stamp is older
  than one hour, via the seed module's ordered teardown; (b) deactivates both
  tick jobs, waits out any tick launched in the last 20 s, and re-arms
  exactly what it paused on teardown, reporting a job found already-inactive
  (crashed-run leftover) with the re-enable statement instead of adopting it.

## Verification

- Run 1 (before sweep threshold): 1086/1087 — only the pre-existing stale
  tenant tripping `leak.test.ts`; ticks paused throughout (survived the
  cron-schedules snapshot/restore cycle) and re-armed after, confirmed in DB.
- Run 2: **50/50 files, 1087/1087 tests green**; sweep removed
  `Cadence Controls 1787896318779-996281`; drain wait caught an in-flight
  tick (15.5 s); both jobs re-armed (`active: true` verified).
- A third confirmation run was blocked by the session's permission layer;
  re-run `npm run test:remote` to accumulate further evidence.

## Known limitations (stated in the setup's header)

- A run killed before teardown leaves the ticks deactivated; the next run
  warns loudly with the re-enable SQL rather than silently re-arming.
- Two overlapping remote runs are not defended against.
- The real fix for test isolation remains a throwaway project via `.env.test`.
