/**
 * Vitest global setup: make a remote run deterministic on a database that is
 * ALSO production.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * The hosted Sydney project carries two ACTIVE pg_cron jobs — `cadence-tick`
 * every minute and `sm8-sync-tick` every five — each POSTing to the deployed
 * Vercel app, which runs the full cadence engine against the SAME database
 * these suites seed. During a full `npm run test:remote` (several minutes,
 * many minute boundaries) the deployed tick would consume test-emitted outbox
 * events, move the single shared consumer cursor, promote and complete
 * test-seeded cadences — failing exactly one test per run, in whichever suite
 * a minute boundary happened to land, while every suite passed in isolation
 * because a ~40-second run usually dodges the window. That was not a
 * hypothesis: `net._http_response` showed the deployed tick answering
 * `eventsConsumed: 1` at the exact minute `cadence-consume-events` failed
 * with "expected 0 to be >= 1".
 *
 * So a sanctioned remote run PAUSES both tick jobs for its duration and
 * re-arms them on the way out. The engine is built to absorb exactly this
 * shape of gap: consumption is cursor-based and the tick's progress pass
 * re-windows anything that slipped, so a few paused minutes cost nothing but
 * delay. What is NOT survivable is the production engine and the test
 * fixtures interleaving on one set of tables.
 *
 * ── AND WHY IT ALSO SWEEPS ──────────────────────────────────────────────────
 *
 * Cleanup is afterAll-only, so an interrupted run (Ctrl-C, crash, a thrown
 * beforeAll) leaves seeded tenants behind — where the operator sees them in
 * the console, the sync tick polls their garbage connections every five
 * minutes, and `tests/leak.test.ts` reds on rows the operator is genuinely
 * enrolled to see. Every seed helper stamps its names with
 * ` <epoch-ms>-<random>` (see tests/helpers/seed.ts), which no human-created
 * row would ever match, so stale seeds are identifiable by name alone: rows
 * whose stamp is older than an hour are torn down here, through the same
 * ordered teardown the suites themselves use. Real rows — e.g. the founder's
 * "Perth Sparks Electrical (Test)" tenant — carry no stamp and are untouchable.
 *
 * ── THE GATE IS env.ts's GATE, NOT A SECOND ONE ─────────────────────────────
 *
 * Reading `testEnv` asserts the stack is disposable (WR-09). A pure
 * `npm test` with no credentials, or a remote target without
 * `ALLOW_REMOTE_TESTS=yes`, throws on that read — and this file treats the
 * throw as "this run will not touch a database", does nothing, and lets the
 * per-suite gate produce its own message. A local stack has no production
 * schedules to pause and is skipped too.
 *
 * ── THE DEAD-MAN'S LEASE, AND WHAT IT BOUNDS ────────────────────────────────
 *
 * A run killed hard enough that teardown never fires used to leave the ticks
 * DEACTIVATED indefinitely — production stopped chasing quotes until a human
 * noticed and ran the re-enable statement by hand. That happened on
 * 2026-08-28 (a full-suite timeout), which is why the pause is now leased
 * rather than merely promised.
 *
 * Before deactivating anything, setup writes ONE row to `remote_test_lease`
 * naming exactly the jobs it is about to own and stamping an expiry
 * `LEASE_TTL_MINUTES` out, and schedules a per-minute `remote-test-watchdog`
 * pg_cron job running `SELECT public.remote_test_watchdog()` (migration 0027).
 * The watchdog does nothing while the lease is live; once it expires the
 * watchdog re-arms exactly the leased jobs, deletes the lease, and unschedules
 * itself. Teardown does the same three things in the same order and the
 * watchdog then finds nothing to do.
 *
 * The ORDER is the whole guarantee, so death at any point is survivable:
 *   • before the lease  → nothing is paused yet;
 *   • after the lease, before the pause → watchdog re-arms already-armed jobs
 *     (a no-op) and cleans up;
 *   • after the pause → watchdog re-arms them at expiry;
 *   • mid-teardown → whatever teardown got to, the watchdog finishes (either
 *     case 2 or case 3 of the function).
 * The outage from a hard kill is therefore bounded at the lease TTL plus one
 * watchdog minute, with no operator action.
 *
 * ── FAILURE MODES, STATED OUT LOUD ──────────────────────────────────────────
 *
 * A job found ALREADY INACTIVE is still not adopted blindly. If the lease names
 * it, this run can PROVE the pause was a test run's and takes it over; if there
 * is no lease evidence, the job was deactivated by someone for a reason this
 * file cannot see, so it is left as found and the re-enable statement is
 * printed — re-arming production behind the operator's back is not this file's
 * call.
 *
 * Two overlapping remote runs are still not defended against: one run's
 * teardown would re-arm the ticks under the other. They now also collide
 * visibly on the single lease row — the second run's upsert overwrites the
 * first's expiry and job list — which is a symptom, not a defence. Do not run
 * two.
 *
 * The TTL is a real constraint, not a comfort number: a run that outlives its
 * lease gets its ticks re-armed MID-RUN, which is precisely the interleaving
 * bug this file exists to prevent. See LEASE_TTL_MINUTES.
 */
import postgres from 'postgres';

import { LOCAL_HOST_PATTERN, testEnv } from './env';

/** The production jobs that mutate the tables these suites assert on. */
const TICK_JOBS = ['cadence-tick', 'sm8-sync-tick'];

/**
 * The per-minute guard scheduled for the duration of a run. Its SQL body lives
 * in migration 0027 as `public.remote_test_watchdog()`; only the SCHEDULE is
 * created here, because the schedule must exist exactly while a pause is live.
 */
const WATCHDOG_JOB = 'remote-test-watchdog';

/**
 * How long the watchdog waits before deciding the run that took the lease is
 * dead and handing production back.
 *
 * A full remote run takes ~8 minutes, so 15 leaves a wide margin. RAISE THIS
 * BEFORE THE RUN EVER APPROACHES IT: an expiry that fires mid-run re-arms the
 * ticks under the suites, and the deployed engine then consumes test-emitted
 * events and mutates test-seeded cadences — the exact intermittent,
 * one-failure-per-run interleaving bug this whole file exists to prevent, back
 * again and now wearing the costume of the fix.
 */
const LEASE_TTL_MINUTES = 15;

/**
 * The seed helpers' name stamp: ` <Date.now()>-<rand up to 1e6>`. Thirteen
 * digits pins the epoch-milliseconds reading (valid 2001–2286), which is what
 * makes the age computable from the name alone — no created_at needed, and no
 * way for a human-named row to qualify.
 */
const STAMP_PATTERN = ' \\d{13}-\\d{1,6}$';
const STAMP_CAPTURE = ' (\\d{13})-\\d{1,6}$';

/**
 * Older than this and a stamped row is garbage from a run that never got to
 * its afterAll. Generous: a full remote run takes ~8 minutes, so nothing an
 * in-flight run just seeded can qualify.
 */
const STALE_AFTER_MS = 60 * 60 * 1000;

/**
 * How long a just-started tick is given to finish before the run proceeds.
 * Deactivation stops future launches; an HTTP call already dispatched runs to
 * completion regardless, so if a tick started moments ago, wait it out. The
 * observed ticks complete in well under a second — this is the margin, not
 * the expectation.
 */
const DRAIN_WINDOW_SECONDS = 20;

export default async function globalSetup(): Promise<(() => Promise<void>) | undefined> {
  let url: string;
  let migrateDatabaseUrl: string;
  try {
    url = testEnv.url;
    migrateDatabaseUrl = testEnv.migrateDatabaseUrl;
  } catch {
    // Missing credentials, or a remote target without ALLOW_REMOTE_TESTS=yes.
    // Either way this run is not sanctioned to touch a database; the per-suite
    // gate owns the error message.
    return undefined;
  }

  if (LOCAL_HOST_PATTERN.test(url)) return undefined;

  const sql = postgres(migrateDatabaseUrl, {
    prepare: false,
    max: 1,
    connect_timeout: 30,
  });

  /** Everything this run OWNS: what it deactivates, plus what it adopts. */
  const pausedJobs: string[] = [];
  /** The subset it actually switched off — an adopted job was already off. */
  const deactivated: string[] = [];

  try {
    await sweepStaleSeedRows(sql);

    // Read ONCE, before the loop: the adoption question is asked of every job
    // and the answer cannot change underneath us mid-loop.
    const [lease] = await sql<{ paused_jobs: string[] }[]>`
      SELECT paused_jobs FROM remote_test_lease
    `;

    const toPause: { name: string; jobid: string }[] = [];

    for (const name of TICK_JOBS) {
      const [job] = await sql<{ jobid: string; active: boolean }[]>`
        SELECT jobid, active FROM cron.job WHERE jobname = ${name}
      `;

      if (!job) continue; // not scheduled on this stack — nothing to pause

      if (!job.active) {
        if (lease?.paused_jobs.includes(name)) {
          // The lease NAMES this job, so a test run paused it and never got to
          // its teardown. That is evidence, not a guess, and it is the only
          // thing that makes adoption safe: this run takes the job over so its
          // own teardown re-arms it, instead of leaving a pause that only the
          // watchdog's expiry would eventually clear.
          pausedJobs.push(name);
          console.log(
            `[remote-tests] REPAIRING a stale pause: cron job '${name}' was inactive and ` +
              'the lease names it, so a previous run paused it and died. Adopted — this ' +
              "run's teardown will re-arm it.",
          );
          continue;
        }

        // No lease evidence. Someone deactivated this for a reason this file
        // cannot see. Left as found — re-arming production behind the
        // operator's back is not this file's call — but said loudly, with the
        // fix.
        console.warn(
          `[remote-tests] cron job '${name}' was ALREADY inactive before this run — ` +
            'likely a previous run that never reached teardown. Production is not ' +
            "ticking. Re-arm it with: SELECT cron.alter_job(jobid, active := true) " +
            `FROM cron.job WHERE jobname = '${name}';`,
        );
        continue;
      }

      toPause.push({ name, jobid: job.jobid });
      pausedJobs.push(name);
    }

    // GUARD FIRST, PAUSE SECOND. Everything below this point is recoverable by
    // the watchdog; nothing above it needs to be. The window in which
    // production could be paused with nothing watching does not exist.
    if (pausedJobs.length > 0) {
      await takeLease(sql, pausedJobs);
      await scheduleWatchdog(sql);
    }

    for (const job of toPause) {
      await sql`SELECT cron.alter_job(${job.jobid}::bigint, active := false)`;
      deactivated.push(job.name);
      console.log(
        `[remote-tests] paused production cron job '${job.name}' for the duration of this run.`,
      );
    }

    // Gated on what was actually switched off, not on what is owned: an adopted
    // job has been inactive since some previous run, so it has no tick in
    // flight to drain.
    if (deactivated.length > 0) await drainInFlightTick(sql);
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }

  if (pausedJobs.length === 0) return undefined;

  // A FRESH connection at teardown time: the run takes minutes, and holding an
  // idle session open across it buys nothing but a timeout to debug.
  return async () => {
    const done = postgres(migrateDatabaseUrl, {
      prepare: false,
      max: 1,
      connect_timeout: 30,
    });
    try {
      for (const name of pausedJobs) {
        // By NAME, not by the jobid recorded at setup: cron-schedules.test.ts
        // unschedules and re-creates these jobs mid-run, so the id this file
        // paused may no longer exist while the job very much does.
        const [job] = await done<{ jobid: string }[]>`
          SELECT jobid FROM cron.job WHERE jobname = ${name}
        `;
        if (!job) {
          console.warn(
            `[remote-tests] cron job '${name}' no longer exists; nothing to re-arm.`,
          );
          continue;
        }
        await done`SELECT cron.alter_job(${job.jobid}::bigint, active := true)`;
        console.log(`[remote-tests] re-armed production cron job '${name}'.`);
      }

      // RELEASE ONLY AFTER RE-ARMING, and retire the watchdog last. A crash
      // between any two of these three steps leaves a state the watchdog itself
      // resolves: with the lease still present it re-arms at expiry (case 2);
      // with the lease gone it simply removes itself (case 3). The reverse
      // order would delete the only record that production was paused while it
      // still was.
      await done`DELETE FROM remote_test_lease`;

      const [watchdog] = await done<{ jobid: string }[]>`
        SELECT jobid FROM cron.job WHERE jobname = ${WATCHDOG_JOB}
      `;
      if (watchdog) {
        await done`SELECT cron.unschedule(${watchdog.jobid}::bigint)`;
      }

      console.log(
        '[remote-tests] released the pause lease and unscheduled the watchdog.',
      );
    } finally {
      await done.end({ timeout: 5 }).catch(() => {});
    }
  };
}

/**
 * Record which jobs this run owns, and until when.
 *
 * `ON CONFLICT (id) DO UPDATE` rather than a plain INSERT: the table holds at
 * most one row by construction, so a lease left behind by a run that died is
 * exactly what this statement meets, and the alternative is a duplicate-key
 * crash that refuses to start a test run because a PREVIOUS one was killed.
 * Overwriting is right — the old lease's holder is gone, and its job list is
 * carried forward by the adoption pass that already ran.
 *
 * `expires_at` is computed by POSTGRES, never from this process's clock. A
 * machine with skew would otherwise write a lease that is already expired and
 * have the watchdog hand the ticks back mid-run.
 */
async function takeLease(sql: postgres.Sql, jobs: string[]): Promise<void> {
  await sql`
    INSERT INTO remote_test_lease (id, expires_at, paused_jobs)
    VALUES (
      true,
      now() + make_interval(mins => ${LEASE_TTL_MINUTES}::int),
      ${jobs}::text[]
    )
    ON CONFLICT (id) DO UPDATE
      SET expires_at = excluded.expires_at,
          paused_jobs = excluded.paused_jobs,
          created_at = excluded.created_at
  `;
  console.log(
    `[remote-tests] took a ${LEASE_TTL_MINUTES}-minute pause lease over ` +
      `${jobs.map((j) => `'${j}'`).join(', ')} — if this run dies, the watchdog re-arms them.`,
  );
}

/**
 * Arm the per-minute guard, replacing a stale one rather than duplicating it.
 *
 * Unschedule-if-present then schedule, following migration 0012's convention:
 * a watchdog left over from a run that died is superseded here, and two
 * watchdogs racing to re-arm the same jobs is a state nobody should have to
 * reason about. The FUNCTION it calls is committed (migration 0027); only this
 * schedule is per-run.
 */
async function scheduleWatchdog(sql: postgres.Sql): Promise<void> {
  const existing = await sql<{ jobid: string }[]>`
    SELECT jobid FROM cron.job WHERE jobname = ${WATCHDOG_JOB}
  `;
  for (const row of existing) {
    await sql`SELECT cron.unschedule(${row.jobid}::bigint)`;
  }

  await sql`
    SELECT cron.schedule(${WATCHDOG_JOB}, '* * * * *', 'SELECT public.remote_test_watchdog()')
  `;
  console.log(`[remote-tests] scheduled '${WATCHDOG_JOB}' to run every minute.`);
}

/**
 * Tear down stamped rows from runs that never reached their afterAll.
 *
 * Deletion goes through the seed module's own `teardownTenants` /
 * `teardownProspects` so the NO-CASCADE evidence tables are cleared in the one
 * documented order rather than re-stated here. That module is imported
 * DYNAMICALLY because its module scope reads `testEnv` — an import at the top
 * of this file would trip the WR-09 gate for a pure `npm test` run before the
 * try/catch in `globalSetup` could decide to do nothing.
 *
 * Best-effort by design: a sweep failure is worth a warning, never a refused
 * test run — the suites' own isolation does not depend on it, only
 * leak.test.ts's tolerance for other runs' corpses does.
 */
async function sweepStaleSeedRows(sql: postgres.Sql): Promise<void> {
  const cutoff = Date.now() - STALE_AFTER_MS;

  try {
    const { teardownProspects, teardownTenants } = await import('./seed');

    const staleTenants = await sql<{ id: string; name: string }[]>`
      SELECT id, name FROM tenants
       WHERE name ~ ${STAMP_PATTERN}
         AND (substring(name from ${STAMP_CAPTURE}))::bigint < ${cutoff}
    `;
    if (staleTenants.length > 0) {
      await teardownTenants(staleTenants.map((row) => row.id));
      console.log(
        `[remote-tests] swept ${staleTenants.length} stale seeded tenant(s) left by an ` +
          `interrupted run: ${staleTenants.map((row) => `'${row.name}'`).join(', ')}`,
      );
    }

    // After the tenants, so a converted prospect's NO ACTION foreign key has
    // nothing left pointing at it.
    const staleProspects = await sql<{ id: string; business_name: string }[]>`
      SELECT id, business_name FROM prospects
       WHERE business_name ~ ${STAMP_PATTERN}
         AND (substring(business_name from ${STAMP_CAPTURE}))::bigint < ${cutoff}
    `;
    if (staleProspects.length > 0) {
      await teardownProspects(staleProspects.map((row) => row.id));
      console.log(
        `[remote-tests] swept ${staleProspects.length} stale seeded prospect(s) left by an ` +
          'interrupted run.',
      );
    }
  } catch (error) {
    console.warn(
      `[remote-tests] stale-seed sweep failed (continuing): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * If a tick launched within the last `DRAIN_WINDOW_SECONDS`, sleep out the
 * remainder — its HTTP call is already in flight and deactivation cannot
 * recall it.
 */
async function drainInFlightTick(sql: postgres.Sql): Promise<void> {
  const [row] = await sql<{ wait: number }[]>`
    SELECT greatest(
             0,
             ${DRAIN_WINDOW_SECONDS} - coalesce(
               extract(epoch FROM (now() - max(d.start_time))),
               ${DRAIN_WINDOW_SECONDS}
             )
           )::float8 AS wait
      FROM cron.job_run_details d
      JOIN cron.job j ON j.jobid = d.jobid
     WHERE j.jobname = ANY(${TICK_JOBS})
  `;

  const waitSeconds = row?.wait ?? 0;
  if (waitSeconds > 0) {
    console.log(
      `[remote-tests] a production tick launched moments ago — waiting ` +
        `${waitSeconds.toFixed(1)}s for it to drain before seeding anything.`,
    );
    await new Promise((resolve) => setTimeout(resolve, Math.ceil(waitSeconds * 1000)));
  }
}
