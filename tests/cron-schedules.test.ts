/**
 * The tick's other half: a schedule that actually exists in the database.
 *
 * `tests/sync-tick-route.test.ts` proves the endpoint answers correctly. This
 * suite proves something is calling it every five minutes — the pair is the
 * whole of SYNC-01's "unattended", and neither file can demonstrate it alone.
 *
 * Integration, against the real `cron` catalog: the properties under test are
 * "the row exists", "the row is unique after two applies" and "the row's command
 * has no committed secret in it", none of which survive being mocked.
 *
 * ── THIS SUITE MUTATES A REAL SCHEDULE, AND PUTS IT BACK ────────────────────
 *
 * It applies BOTH tick jobs pointing at `https://example.invalid`. Against the
 * hosted project that would replace live production schedules with dead ones —
 * silently, and in exactly the "cron green, sync empty" shape this phase exists
 * to prevent. So the suite SNAPSHOTS whatever schedules it finds and restores
 * them verbatim afterwards, or unschedules if there were none. Do not remove
 * that without replacing it with something better.
 *
 * The snapshot covers EVERY job the script writes, read from the script's own
 * job list rather than from a list repeated here — a second job added there and
 * forgotten here is a live schedule this suite would quietly leave pointing at
 * `example.invalid`, which is the exact failure the restore exists to prevent.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { testEnv } from './helpers/env';

const TICK_JOB = 'sm8-sync-tick';
const CADENCE_JOB = 'cadence-tick';
const RECONCILE_JOB = 'messaging-reconcile';
const DIGEST_JOB = 'stalled-digest';
const CLEANUP_JOB = 'cron-details-cleanup';

/** Every job the script writes — the set this suite must snapshot and restore. */
const MANAGED_JOBS = [TICK_JOB, CADENCE_JOB, RECONCILE_JOB, DIGEST_JOB];

/** Deliberately unroutable: if anything ever posts here, it fails loudly. */
const TEST_BASE_URL = 'https://example.invalid';
const TEST_SECRET = 'dummy-secret-used-only-by-this-suite-0123456789';
/**
 * A DIFFERENT dummy for the cadence tick, on purpose. Reusing one value would
 * make this suite pass just as happily if the script sent the sync bearer to
 * the cadence route — which in production is a tick that 401s forever while
 * every assertion here stays green.
 */
const TEST_CADENCE_SECRET = 'dummy-cadence-secret-this-suite-only-9876543210';
/** And a third distinct dummy, for the same reason as the second. */
const TEST_RECONCILE_SECRET = 'dummy-reconcile-secret-this-suite-only-1122334455';
/** And a fourth (06-02), for the same reason as the third. */
const TEST_DIGEST_SECRET = 'dummy-digest-secret-this-suite-only-5566778899000';

const sql = postgres(testEnv.migrateDatabaseUrl, {
  prepare: false,
  connect_timeout: 30,
  max: 1,
  idle_timeout: 20,
});

interface CronJob {
  jobname: string;
  schedule: string;
  command: string;
  active: boolean;
}

async function jobsNamed(name: string): Promise<CronJob[]> {
  return sql<CronJob[]>`
    SELECT jobname, schedule, command, active FROM cron.job WHERE jobname = ${name}
  `;
}

/** Run the committed script with the test's own origin and secret. */
function applySchedules(): string {
  return execFileSync('node', ['scripts/apply-cron-schedules.mjs'], {
    // The script calls process.loadEnvFile('.env.local'), which does NOT
    // overwrite variables already present — so these win over the real ones.
    env: {
      ...process.env,
      APP_BASE_URL: TEST_BASE_URL,
      SYNC_TICK_SECRET: TEST_SECRET,
      CADENCE_TICK_SECRET: TEST_CADENCE_SECRET,
      MESSAGING_RECONCILE_SECRET: TEST_RECONCILE_SECRET,
      STALLED_DIGEST_SECRET: TEST_DIGEST_SECRET,
    },
    encoding: 'utf8',
  });
}

const snapshots = new Map<string, CronJob | undefined>();
let firstRunOutput = '';

beforeAll(async () => {
  for (const name of MANAGED_JOBS) {
    snapshots.set(name, (await jobsNamed(name))[0]);
  }
  firstRunOutput = applySchedules();
}, 60_000);

afterAll(async () => {
  for (const name of MANAGED_JOBS) {
    const present = await sql<{ jobid: string }[]>`
      SELECT jobid FROM cron.job WHERE jobname = ${name}
    `;
    for (const row of present) {
      await sql`SELECT cron.unschedule(${row.jobid}::bigint)`;
    }

    const snapshot = snapshots.get(name);
    if (snapshot) {
      // Restore verbatim, including the real origin and bearer this suite never
      // saw in plaintext anywhere but the catalog it read them from.
      await sql`SELECT cron.schedule(${snapshot.jobname}, ${snapshot.schedule}, ${snapshot.command})`;

      // INCLUDING `active`. `cron.schedule` always creates the job ACTIVE, so
      // without this a snapshot taken while the job was deactivated — which is
      // every remote run, because tests/helpers/global-setup.ts pauses both
      // ticks for the duration of the run — would be restored ARMED, and the
      // production tick would race every suite that runs after this file.
      if (!snapshot.active) {
        await sql`
          SELECT cron.alter_job(jobid, active := false)
            FROM cron.job WHERE jobname = ${snapshot.jobname}
        `;
      }
    }
  }
  await sql.end({ timeout: 5 }).catch(() => {});
}, 60_000);

describe('sm8-sync-tick schedule (SYNC-01, D-13)', () => {
  it('exists, every five minutes, active', async () => {
    const jobs = await jobsNamed(TICK_JOB);

    expect(jobs).toHaveLength(1);
    expect(jobs[0].schedule).toBe('*/5 * * * *');
    expect(jobs[0].active).toBe(true);
  });

  it('posts to the tick route at the origin supplied in the environment', async () => {
    const [job] = await jobsNamed(TICK_JOB);

    expect(job.command).toContain('net.http_post');
    expect(job.command).toContain(`${TEST_BASE_URL}/api/internal/sync-tick`);
    expect(job.command).toContain('Bearer ');
    // Dispatch timeout, not work timeout — the route's own 300s does the work.
    expect(job.command).toContain('timeout_milliseconds := 8000');
  });

  it('took the secret from the environment, not from anywhere on disk', async () => {
    const [job] = await jobsNamed(TICK_JOB);

    expect(job.command).toContain(TEST_SECRET);
    // The real secret is in .env.local, which the script also loads. If the
    // child environment did NOT win, this suite would have just published the
    // production bearer into a job pointing at example.invalid — and, worse,
    // every assertion above would still be green.
    const real = process.env.SYNC_TICK_SECRET;
    if (real && real !== TEST_SECRET) {
      expect(job.command).not.toContain(real);
    }
  });

  it('is idempotent — a second apply leaves exactly one job', async () => {
    applySchedules();

    const jobs = await jobsNamed(TICK_JOB);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].schedule).toBe('*/5 * * * *');
  }, 60_000);

  it('prints the jobname and schedule but never the bearer (T-2-15)', () => {
    expect(firstRunOutput).toContain(TICK_JOB);
    expect(firstRunOutput).toContain('*/5 * * * *');
    expect(firstRunOutput).not.toContain(TEST_SECRET);
    expect(firstRunOutput).not.toContain(TEST_BASE_URL);
  });
});

describe('cadence-tick schedule (CAD-01, CAD-02, T-3-25)', () => {
  it('exists, EVERY MINUTE, active', async () => {
    const jobs = await jobsNamed(CADENCE_JOB);

    expect(jobs).toHaveLength(1);
    // Per-minute, not */5. The materialized slots carry jitter down to the
    // minute; a five-minute tick rounds every one of them up to the next
    // multiple of five and collapses the jitter that exists so fifteen clients'
    // follow-ups do not all leave at 09:00 exactly.
    expect(jobs[0].schedule).toBe('* * * * *');
    expect(jobs[0].active).toBe(true);
  });

  it('posts to the cadence route, not the sync route', async () => {
    const [job] = await jobsNamed(CADENCE_JOB);

    expect(job.command).toContain('net.http_post');
    expect(job.command).toContain(`${TEST_BASE_URL}/api/internal/cadence-tick`);
    expect(job.command).not.toContain('/api/internal/sync-tick');
    expect(job.command).toContain('timeout_milliseconds := 8000');
  });

  it('THE ROTATION ASSERTION: it carries its OWN bearer, not the sync tick’s', async () => {
    const [job] = await jobsNamed(CADENCE_JOB);

    // The two secrets exist to rotate independently. A script that sent the
    // sync bearer here would produce a cadence tick that 401s every minute
    // forever — with `cron.job_run_details` full of delivered requests, and
    // every other assertion in this file still green.
    expect(job.command).toContain(TEST_CADENCE_SECRET);
    expect(job.command).not.toContain(TEST_SECRET);

    const realSync = process.env.SYNC_TICK_SECRET;
    if (realSync && realSync !== TEST_CADENCE_SECRET) {
      expect(job.command).not.toContain(realSync);
    }
    const realCadence = process.env.CADENCE_TICK_SECRET;
    if (realCadence && realCadence !== TEST_CADENCE_SECRET) {
      expect(job.command).not.toContain(realCadence);
    }
  });

  it('and the sync job did NOT get the cadence bearer', async () => {
    // The same mistake in the other direction, which the sync suite above
    // cannot see because it never knows this value exists.
    const [job] = await jobsNamed(TICK_JOB);

    expect(job.command).not.toContain(TEST_CADENCE_SECRET);
  });

  it('is idempotent — a second apply leaves exactly one of each job', async () => {
    applySchedules();

    expect(await jobsNamed(CADENCE_JOB)).toHaveLength(1);
    expect(await jobsNamed(TICK_JOB)).toHaveLength(1);
  }, 60_000);

  it('prints its jobname and schedule but never its bearer (T-3-25)', () => {
    expect(firstRunOutput).toContain(CADENCE_JOB);
    expect(firstRunOutput).toContain('* * * * *');
    expect(firstRunOutput).not.toContain(TEST_CADENCE_SECRET);
    expect(firstRunOutput).not.toContain('Authorization');
    expect(firstRunOutput).not.toContain('net.http_post');
  });
});

describe('messaging-reconcile schedule (MSG-01, T-4-18)', () => {
  it('exists, ONCE DAILY at 03:30 AWST, active', async () => {
    const jobs = await jobsNamed(RECONCILE_JOB);

    expect(jobs).toHaveLength(1);
    // 19:30 UTC is 03:30 in Australia/Perth (UTC+8, no DST). Overnight on
    // purpose: the sweep replays inbound messages, which can suppress contacts
    // and pause cadences, and doing that mid-morning changes the operator's
    // triage screen under them for reasons they did not cause.
    expect(jobs[0].schedule).toBe('30 19 * * *');
    expect(jobs[0].active).toBe(true);
  });

  it('posts to the reconcile route, not to either tick route', async () => {
    const [job] = await jobsNamed(RECONCILE_JOB);

    expect(job.command).toContain('net.http_post');
    expect(job.command).toContain(`${TEST_BASE_URL}/api/internal/messaging-reconcile`);
    expect(job.command).not.toContain('/api/internal/sync-tick');
    expect(job.command).not.toContain('/api/internal/cadence-tick');
    expect(job.command).toContain('timeout_milliseconds := 8000');
  });

  it('carries its OWN bearer — neither tick’s', async () => {
    const [job] = await jobsNamed(RECONCILE_JOB);

    expect(job.command).toContain(TEST_RECONCILE_SECRET);
    expect(job.command).not.toContain(TEST_SECRET);
    expect(job.command).not.toContain(TEST_CADENCE_SECRET);

    const real = process.env.MESSAGING_RECONCILE_SECRET;
    if (real && real !== TEST_RECONCILE_SECRET) {
      expect(job.command).not.toContain(real);
    }
  });

  it('and neither tick got the reconcile bearer', async () => {
    // The same mistake in the other direction, which the two suites above
    // cannot see because neither knows this value exists.
    for (const name of [TICK_JOB, CADENCE_JOB]) {
      const [job] = await jobsNamed(name);
      expect(job.command).not.toContain(TEST_RECONCILE_SECRET);
    }
  });

  it('prints its jobname and schedule but never its bearer', () => {
    expect(firstRunOutput).toContain(RECONCILE_JOB);
    expect(firstRunOutput).toContain('30 19 * * *');
    expect(firstRunOutput).not.toContain(TEST_RECONCILE_SECRET);
  });
});

describe('stalled-digest schedule (CON-04, 06-02)', () => {
  it('exists, ONCE DAILY at 06:30 AWST, active', async () => {
    const jobs = await jobsNamed(DIGEST_JOB);

    expect(jobs).toHaveLength(1);
    // 22:30 UTC is 06:30 in Australia/Perth (UTC+8, no DST). FIRST THING rather
    // than overnight, which is the opposite of the sweep above and deliberately
    // so: this job exists to be READ, before the day's first send slots arrive.
    expect(jobs[0].schedule).toBe('30 22 * * *');
    expect(jobs[0].active).toBe(true);
  });

  it('posts to the digest route and to no other', async () => {
    const [job] = await jobsNamed(DIGEST_JOB);

    expect(job.command).toContain('net.http_post');
    expect(job.command).toContain(`${TEST_BASE_URL}/api/internal/stalled-digest`);
    expect(job.command).not.toContain('/api/internal/sync-tick');
    expect(job.command).not.toContain('/api/internal/cadence-tick');
    expect(job.command).not.toContain('/api/internal/messaging-reconcile');
    expect(job.command).toContain('timeout_milliseconds := 8000');
  });

  it('carries its OWN bearer — none of the other three', async () => {
    const [job] = await jobsNamed(DIGEST_JOB);

    expect(job.command).toContain(TEST_DIGEST_SECRET);
    expect(job.command).not.toContain(TEST_SECRET);
    expect(job.command).not.toContain(TEST_CADENCE_SECRET);
    expect(job.command).not.toContain(TEST_RECONCILE_SECRET);

    const real = process.env.STALLED_DIGEST_SECRET;
    if (real && real !== TEST_DIGEST_SECRET) {
      expect(job.command).not.toContain(real);
    }
  });

  it('and no other job got the digest bearer', async () => {
    // The same mistake in the other direction, which the suites above cannot
    // see because none of them knows this value exists.
    for (const name of [TICK_JOB, CADENCE_JOB, RECONCILE_JOB]) {
      const [job] = await jobsNamed(name);
      expect(job.command).not.toContain(TEST_DIGEST_SECRET);
    }
  });

  it('prints its jobname and schedule but never its bearer', () => {
    expect(firstRunOutput).toContain(DIGEST_JOB);
    expect(firstRunOutput).toContain('30 22 * * *');
    expect(firstRunOutput).not.toContain(TEST_DIGEST_SECRET);
  });
});

describe('the committed script itself', () => {
  const SOURCE = readFileSync('scripts/apply-cron-schedules.mjs', 'utf8');

  it('contains no hard-coded origin in executable code — the URL is env-supplied', () => {
    // The whole reason the schedule is applied by a script rather than a
    // migration is that neither the secret nor the deployment URL may be a
    // committed literal. A URL baked in here would also break silently on the
    // next domain change, in the direction of "cron green, nothing syncing".
    //
    // Comments are stripped first: the usage example and the error message that
    // shows an operator what a good APP_BASE_URL looks like are documentation,
    // and a rule that forbade them would be obeyed by deleting the help text.
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const literalUrls = code.match(/https?:\/\/[a-z0-9]/gi) ?? [];
    expect(literalUrls).toEqual([]);
    expect(SOURCE).toContain('process.env.APP_BASE_URL');
    expect(SOURCE).toContain('new URL(job.path, origin)');
  });

  it('names every secret variable and never logs any of them', () => {
    expect(SOURCE).toContain("secretVar: 'SYNC_TICK_SECRET'");
    expect(SOURCE).toContain("secretVar: 'CADENCE_TICK_SECRET'");
    expect(SOURCE).toContain("secretVar: 'MESSAGING_RECONCILE_SECRET'");
    expect(SOURCE).toContain("secretVar: 'STALLED_DIGEST_SECRET'");
    // The only console.log of a job row selects jobname/schedule/active.
    expect(SOURCE).not.toMatch(/console\.log\([^)]*command/);
  });

  it('drives every job from one list rather than duplicated constants', () => {
    // A second copy of the apply flow is a second place for the printing rule
    // and the unschedule-first guard to be got wrong, and only one of them
    // would be under test.
    const scheduleCalls = SOURCE.match(/cron\.schedule\(/g) ?? [];
    expect(scheduleCalls).toHaveLength(1);
  });

  it('calls cron.schedule with bound parameters, not string concatenation', () => {
    // The command SQL is baked in by necessity; the schedule call is not.
    expect(SOURCE).toContain('cron.schedule(${job.name}, ${job.schedule}, ${commandFor(job)})');
  });

  it('reports EVERY missing secret at once, by name', () => {
    // Failing on the first one makes an operator run this twice to learn two
    // facts that were both knowable on the first run — and the second run is
    // the one done in a hurry, mid-rotation, with a tick already 401ing.
    expect(SOURCE).toContain('missingSecrets');
    expect(SOURCE).toContain("missingSecrets.join(', ')");
  });
});

describe('cron-details-cleanup schedule (RESEARCH Pitfall 10)', () => {
  it('exists after migration 0012, weekly', async () => {
    const jobs = await jobsNamed(CLEANUP_JOB);

    expect(jobs).toHaveLength(1);
    expect(jobs[0].schedule).toBe('30 3 * * 0');
    expect(jobs[0].active).toBe(true);
  });

  it('deletes run details older than 30 days, filtered on start_time', async () => {
    const [job] = await jobsNamed(CLEANUP_JOB);

    expect(job.command).toContain('cron.job_run_details');
    expect(job.command).toContain("interval '30 days'");
    // `end_time` is NULL for an in-flight or crashed run, and `end_time < ...`
    // skips NULLs — leaving exactly the rows an investigation wants.
    expect(job.command).toContain('start_time');
    expect(job.command).not.toContain('end_time');
  });

  it('survived a re-run of the migrator without duplicating', async () => {
    // 0012 is unschedule-then-schedule; the migrator will not re-run it, but a
    // hand-applied replay must still leave one row.
    const jobs = await jobsNamed(CLEANUP_JOB);
    expect(jobs).toHaveLength(1);
  });
});
