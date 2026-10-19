/**
 * The dead-man's switch, proved in seconds instead of in fifteen minutes.
 *
 * `tests/helpers/global-setup.ts` pauses production's `cadence-tick` and
 * `sm8-sync-tick` for the duration of a remote run and re-arms them at
 * teardown. A run killed before teardown used to leave them inactive
 * indefinitely. Migration 0027's `public.remote_test_watchdog()` is what makes
 * that bounded: a per-minute job that re-arms the leased jobs once the lease
 * expires and then retires itself.
 *
 * ── WHY THE FUNCTION IS INVOKED DIRECTLY ────────────────────────────────────
 *
 * Waiting on pg_cron would mean a minimum of one minute per case and a real
 * fifteen-minute wait for the expiry path — so the suite would either not exist
 * or would be skipped. Every case here is set up by writing a lease row with
 * the `expires_at` it needs and then calling `SELECT
 * public.remote_test_watchdog()`. No sleeps anywhere. This is the entire reason
 * the watchdog is a committed FUNCTION rather than SQL inlined into the cron
 * command string: one definition, two callers, no drift between the thing under
 * test and the thing that runs in production.
 *
 * ── THIS SUITE EATS THE RUN'S OWN PROTECTION, AND PUTS IT BACK ──────────────
 *
 * global-setup's REAL lease and REAL watchdog are live while this file runs —
 * they are what is keeping production's ticks paused for the rest of the suite.
 * The expiry test deliberately consumes both (that is what the expiry path
 * DOES). So, following the discipline `tests/cron-schedules.test.ts` already
 * establishes for the tick schedules, this file SNAPSHOTS the lease row and the
 * watchdog job up front and restores them verbatim afterwards. Without that,
 * everything after this file would run with production paused and nothing
 * watching — which is precisely the failure the code under test exists to
 * prevent, reintroduced by its own test.
 *
 * The real watchdog is also UNSCHEDULED for the duration, after snapshotting:
 * a per-minute job that reads the same lease row these tests are rewriting is a
 * race, and every outcome of that race is a confusing red.
 *
 * The tests are deliberately STATEFUL AND SEQUENTIAL (vitest runs a file's
 * tests serially): case 2 consumes the lease case 1 wrote, which is the real
 * lifecycle rather than three independent fixtures.
 */
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { testEnv } from './helpers/env';

const WATCHDOG_JOB = 'remote-test-watchdog';

/**
 * An inactive stand-in for a paused tick. Scheduled for 23:59 on 31 December
 * and running `SELECT 1`, so even if something re-armed it by mistake it can do
 * nothing — the tests assert on its `active` flag, never on it firing.
 */
const SCRATCH_JOB = 'watchdog-test-target';

/** The jobs the watchdog must NEVER touch unless a lease names them. */
const TICK_JOBS = ['cadence-tick', 'sm8-sync-tick'];

const WATCHDOG_COMMAND = 'SELECT public.remote_test_watchdog()';

const sql = postgres(testEnv.migrateDatabaseUrl, {
  prepare: false,
  max: 1,
  idle_timeout: 20,
  connect_timeout: 30,
});

interface CronJob {
  jobname: string;
  schedule: string;
  command: string;
  active: boolean;
}

interface LeaseRow {
  id: boolean;
  expires_at: Date;
  paused_jobs: string[];
  created_at: Date;
}

let leaseSnapshot: LeaseRow | undefined;
let watchdogSnapshot: CronJob | undefined;

async function jobsNamed(name: string): Promise<CronJob[]> {
  return sql<CronJob[]>`
    SELECT jobname, schedule, command, active FROM cron.job WHERE jobname = ${name}
  `;
}

async function unscheduleIfPresent(name: string): Promise<void> {
  const rows = await sql<{ jobid: string }[]>`
    SELECT jobid FROM cron.job WHERE jobname = ${name}
  `;
  for (const row of rows) {
    await sql`SELECT cron.unschedule(${row.jobid}::bigint)`;
  }
}

/** Put a watchdog row in the catalog so a test can observe it being removed. */
async function armWatchdog(): Promise<void> {
  await unscheduleIfPresent(WATCHDOG_JOB);
  await sql`SELECT cron.schedule(${WATCHDOG_JOB}, '* * * * *', ${WATCHDOG_COMMAND})`;
}

async function leaseRows(): Promise<LeaseRow[]> {
  return sql<LeaseRow[]>`
    SELECT id, expires_at, paused_jobs, created_at FROM remote_test_lease
  `;
}

async function scratchActive(): Promise<boolean> {
  const [job] = await jobsNamed(SCRATCH_JOB);
  return job.active;
}

/** Plain objects, so the assertion compares rows rather than driver metadata. */
async function tickStates(): Promise<{ jobname: string; active: boolean }[]> {
  const rows = await sql<{ jobname: string; active: boolean }[]>`
    SELECT jobname, active FROM cron.job WHERE jobname = ANY(${TICK_JOBS}) ORDER BY jobname
  `;
  return rows.map((r) => ({ jobname: r.jobname, active: r.active }));
}

async function runWatchdog(): Promise<void> {
  await sql`SELECT public.remote_test_watchdog()`;
}

beforeAll(async () => {
  leaseSnapshot = (await leaseRows())[0];
  watchdogSnapshot = (await jobsNamed(WATCHDOG_JOB))[0];

  // Take the real watchdog out of the way BEFORE rewriting the lease it reads.
  await unscheduleIfPresent(WATCHDOG_JOB);

  await unscheduleIfPresent(SCRATCH_JOB);
  await sql`SELECT cron.schedule(${SCRATCH_JOB}, '59 23 31 12 *', 'SELECT 1')`;
  await sql`SELECT cron.alter_job(jobid, active := false) FROM cron.job WHERE jobname = ${SCRATCH_JOB}`;
}, 60_000);

afterAll(async () => {
  // PROTECTION FIRST, tidying second: everything after this file runs with
  // production's ticks still paused, so the lease and the watchdog go back
  // before the scratch job is cleaned up.
  await sql`DELETE FROM remote_test_lease`;
  if (leaseSnapshot) {
    await sql`
      INSERT INTO remote_test_lease (id, expires_at, paused_jobs, created_at)
      VALUES (
        ${leaseSnapshot.id},
        ${leaseSnapshot.expires_at},
        ${leaseSnapshot.paused_jobs}::text[],
        ${leaseSnapshot.created_at}
      )
    `;
  }

  await unscheduleIfPresent(WATCHDOG_JOB);
  if (watchdogSnapshot) {
    // Verbatim. `cron.schedule` always creates a job ACTIVE, which is also the
    // only state global-setup ever leaves this job in, so there is no `active`
    // flag to restore separately the way cron-schedules.test.ts must for the
    // ticks.
    await sql`
      SELECT cron.schedule(
        ${watchdogSnapshot.jobname},
        ${watchdogSnapshot.schedule},
        ${watchdogSnapshot.command}
      )
    `;
  }

  await unscheduleIfPresent(SCRATCH_JOB);
  await sql.end({ timeout: 5 }).catch(() => {});
}, 60_000);

describe('remote_test_watchdog() — a live lease is left alone (case 1)', () => {
  it('changes nothing at all while the lease is unexpired', async () => {
    await armWatchdog();
    await sql`DELETE FROM remote_test_lease`;
    await sql`
      INSERT INTO remote_test_lease (id, expires_at, paused_jobs)
      VALUES (true, now() + interval '15 minutes', ${[SCRATCH_JOB]}::text[])
    `;

    expect(await scratchActive()).toBe(false);

    await runWatchdog();

    // The whole point of case 1. If the watchdog re-armed here it would hand
    // the ticks back to the deployed engine MID-RUN — the interleaving bug the
    // pause exists to prevent, reintroduced by its own guard.
    expect(
      await scratchActive(),
      'the watchdog re-armed a job whose lease has not expired',
    ).toBe(false);
    expect(await leaseRows(), 'the watchdog released a live lease').toHaveLength(1);
    expect(
      await jobsNamed(WATCHDOG_JOB),
      'the watchdog retired itself while a run was still holding the lease',
    ).toHaveLength(1);
  });
});

describe('remote_test_watchdog() — an expired lease is honoured (case 2)', () => {
  it('re-arms only the leased jobs, releases the lease, and retires itself', async () => {
    // Reuse the row case 1 wrote — the real lifecycle — and age it out.
    await sql`UPDATE remote_test_lease SET expires_at = now() - interval '1 minute'`;
    expect(await scratchActive()).toBe(false);

    // Captured rather than hardcoded: mid-run the ticks are PAUSED, on a stack
    // without them they are ABSENT, and the assertion "unchanged" is the true
    // one in every case. A hardcoded `active: true` would encode a state that
    // is wrong exactly when this suite normally runs.
    const ticksBefore = await tickStates();

    await runWatchdog();

    expect(await scratchActive(), 'the expired lease did not re-arm its job').toBe(true);
    expect(await leaseRows(), 'the expired lease was not released').toHaveLength(0);
    expect(
      await jobsNamed(WATCHDOG_JOB),
      'the watchdog did not retire itself after acting',
    ).toHaveLength(0);

    expect(
      await tickStates(),
      'the watchdog touched a production tick the lease did not name. `paused_jobs` ' +
        'is the record of what a test run actually paused; anything else was ' +
        "deactivated by a human for a reason this function cannot see, and re-arming " +
        'it is exactly the overreach global-setup refuses to commit.',
    ).toEqual(ticksBefore);
  });
});

describe('remote_test_watchdog() — no lease means retire quietly (case 3)', () => {
  it('unschedules itself and touches nothing else', async () => {
    // "Teardown re-armed the jobs and deleted the lease, then died before
    // unscheduling me." Nothing is paused on the watchdog's account, so the
    // only correct action is to remove itself.
    await armWatchdog();
    await sql`DELETE FROM remote_test_lease`;
    await sql`SELECT cron.alter_job(jobid, active := false) FROM cron.job WHERE jobname = ${SCRATCH_JOB}`;

    const ticksBefore = await tickStates();
    expect(await scratchActive()).toBe(false);

    await runWatchdog();

    expect(
      await jobsNamed(WATCHDOG_JOB),
      'with no lease the watchdog must remove itself, or it errors every minute forever',
    ).toHaveLength(0);
    expect(
      await scratchActive(),
      'with no lease there is no record of consent, so nothing may be re-armed',
    ).toBe(false);
    expect(await tickStates()).toEqual(ticksBefore);
  });

  it('is safe to invoke when it is not scheduled at all', async () => {
    // The invocation the direct-call form makes routine, and the one a bare
    // `cron.unschedule('remote-test-watchdog')` would RAISE on — which under
    // pg_cron means a job that fails every minute forever instead of retiring.
    expect(await jobsNamed(WATCHDOG_JOB)).toHaveLength(0);

    // Resolving at all is the assertion — `toBeUndefined` merely names what a
    // `RETURNS void` call resolves TO. A raise here is the failure mode.
    await expect(runWatchdog()).resolves.toBeUndefined();

    expect(await leaseRows()).toHaveLength(0);
    expect(await scratchActive()).toBe(false);
  });
});
