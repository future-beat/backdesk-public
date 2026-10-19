/**
 * D-04 retention, proven against the job that is actually scheduled.
 *
 * ── WHY THIS SUITE READS THE SQL OUT OF `cron.job` ──────────────────────────
 *
 * The obvious shape is to re-type the DELETE into the test and run it. That
 * proves a statement in this file behaves correctly and says nothing about the
 * one Postgres runs at 03:15 every morning — the two drift the moment somebody
 * edits the migration and not the test, and the drift is invisible because the
 * suite stays green. So the command is READ FROM THE CATALOG and executed
 * verbatim. What is under test is the deployed retention policy, not a replica
 * of it.
 *
 * ── THE THREE-WAY ASSERTION ─────────────────────────────────────────────────
 *
 * A purge test that only checks "the expired row is gone" passes for
 * `DELETE FROM prospect_quote_lines` with no WHERE clause at all. Both
 * directions of wrong have to be pinned:
 *
 *   expired (purge_after in the past)   → DELETED    — the retention promise
 *   live    (purge_after in the future) → SPARED     — not a truncation
 *   NULL    (the prospect converted)    → SPARED     — D-02, keep forever
 *
 * ── THIS SUITE RUNS THE REAL JOB'S STATEMENT ────────────────────────────────
 *
 * Which means it also deletes any OTHER expired lines in the database. That is
 * not a side effect worth avoiding: those rows are past their retention date
 * and the scheduled job would delete them within 24 hours regardless. Nothing
 * is done here that the product does not do to itself daily.
 */
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { testEnv } from './helpers/env';
import { admin, noPersist, seedProspect, seedProspectLines, teardownProspects } from './helpers/seed';

const PURGE_JOB = 'prospect-line-purge';

const sql = postgres(testEnv.migrateDatabaseUrl, {
  prepare: false,
  max: 1,
  idle_timeout: 5,
  connect_timeout: 30,
});

const DAY_MS = 86_400_000;

let prospectId: string;
let expiredId: string;
let liveId: string;
let convertedId: string;

beforeAll(async () => {
  prospectId = await seedProspect();

  const [expired, live, converted] = await seedProspectLines(prospectId, [
    // One day past retention — the row the job exists to remove.
    { purge_after: new Date(Date.now() - DAY_MS).toISOString(), status: 'Quote' },
    // Mid-retention. A fresh audit's lines look exactly like this.
    { purge_after: new Date(Date.now() + 29 * DAY_MS).toISOString(), status: 'Work Order' },
    // Converted (D-02): purge_after cleared, keep indefinitely.
    { purge_after: null, status: 'Unsuccessful' },
  ]);

  expiredId = expired.id;
  liveId = live.id;
  convertedId = converted.id;
}, 60_000);

afterAll(async () => {
  await teardownProspects([prospectId]).catch(() => {});
  await sql.end({ timeout: 5 }).catch(() => {});
}, 60_000);

describe('prospect-line-purge schedule (D-04, RESEARCH Pitfall 9)', () => {
  it('exists after migration 0014, daily, active', async () => {
    const jobs = await sql<{ schedule: string; active: boolean }[]>`
      SELECT schedule, active FROM cron.job WHERE jobname = ${PURGE_JOB}
    `;

    expect(jobs, `cron job ${PURGE_JOB} is not scheduled`).toHaveLength(1);
    expect(jobs[0].schedule).toBe('15 3 * * *');
    expect(jobs[0].active).toBe(true);
  });

  it('targets prospect_quote_lines and spares NULL purge_after explicitly', async () => {
    const [job] = await sql<{ command: string }[]>`
      SELECT command FROM cron.job WHERE jobname = ${PURGE_JOB}
    `;

    expect(job.command).toContain('prospect_quote_lines');
    expect(job.command).toContain('purge_after');
    // Redundant against `purge_after < now()`, which already skips NULLs — and
    // written anyway, so that breaking the converted-prospect guarantee
    // requires deleting words rather than merely reordering a comparison.
    expect(job.command).toContain('IS NOT NULL');
    // It must never reach the aggregates. Those are counts and dollar totals
    // about a business, carry nothing about any individual, and are the reason
    // the audit stays provable after the PII behind it is gone.
    expect(job.command).not.toContain('FROM prospects');
  });

  it('deletes expired lines, spares live ones, spares converted ones', async () => {
    const [job] = await sql<{ command: string }[]>`
      SELECT command FROM cron.job WHERE jobname = ${PURGE_JOB}
    `;

    // The scheduled statement itself, verbatim — see the header.
    await sql.unsafe(job.command);

    const survivors = await sql<{ id: string }[]>`
      SELECT id FROM prospect_quote_lines WHERE prospect_id = ${prospectId}::uuid
    `;
    const ids = survivors.map((r) => r.id);

    expect(ids, 'the expired line survived the purge').not.toContain(expiredId);
    expect(ids, 'a line still inside its retention window was purged').toContain(liveId);
    expect(
      ids,
      'a CONVERTED prospect’s line (purge_after NULL) was purged — D-02 broken',
    ).toContain(convertedId);
    expect(ids).toHaveLength(2);
  });

  it('leaves the prospect row and its aggregate figures untouched', async () => {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM prospects WHERE id = ${prospectId}::uuid
    `;

    // The whole point of two tables: raw PII expires, the audit does not.
    expect(rows, 'the purge deleted the prospect itself').toHaveLength(1);
  });
});

/**
 * T-2-08, the behavioural half.
 *
 * `tests/rls-coverage.test.ts` asserts the POLICY is written against
 * `is_operator()`. This asserts what that buys: two callers who are not on the
 * allowlist read nothing. The second one is the important one — an
 * authenticated user with a perfectly valid JWT, which is what a v2 client
 * login will be.
 */
describe('prospect data is invisible to non-operators (T-2-08)', () => {
  const anon = createClient(testEnv.url, testEnv.anonKey, noPersist);

  const outsiderEmail = `outsider-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.invalid`;
  const outsiderPassword = `Outsider!${Math.random().toString(36).slice(2)}`;
  let outsiderId: string | undefined;

  beforeAll(async () => {
    const created = await admin.auth.admin.createUser({
      email: outsiderEmail,
      password: outsiderPassword,
      email_confirm: true,
    });
    if (created.error) throw new Error(`Could not create the outsider: ${created.error.message}`);
    outsiderId = created.data.user!.id;
  }, 60_000);

  afterAll(async () => {
    if (outsiderId) await admin.auth.admin.deleteUser(outsiderId).catch(() => {});
  }, 60_000);

  it('returns an empty set — not an error — to the anon client', async () => {
    for (const table of ['prospects', 'prospect_quote_lines']) {
      const { data, error } = await anon.from(table).select('id');

      // Empty, NOT `42501 permission denied`: denial and absence have to be
      // indistinguishable, or the error itself confirms the table exists and
      // that there is something in it worth guarding (0014's grant argument).
      expect(error, `anon.from('${table}') errored instead of returning empty`).toBeNull();
      expect(data, `anon can read ${table}`).toEqual([]);
    }
  });

  it('returns an empty set to an authenticated user who is not on the allowlist', async () => {
    const outsider = createClient(testEnv.url, testEnv.anonKey, noPersist);
    const { error: signIn } = await outsider.auth.signInWithPassword({
      email: outsiderEmail,
      password: outsiderPassword,
    });
    expect(signIn, 'the outsider could not sign in — the test proves nothing').toBeNull();

    for (const table of ['prospects', 'prospect_quote_lines']) {
      const { data, error } = await outsider.from(table).select('id');

      expect(error, `the outsider's read of ${table} errored`).toBeNull();
      expect(
        data,
        `an authenticated non-operator can read ${table}. This is exactly the ` +
          'shape a v2 client login takes — the allowlist is what stops it.',
      ).toEqual([]);
    }
  });

  it('refuses an insert from an authenticated non-operator', async () => {
    const outsider = createClient(testEnv.url, testEnv.anonKey, noPersist);
    await outsider.auth.signInWithPassword({
      email: outsiderEmail,
      password: outsiderPassword,
    });

    // No INSERT grant at all (0014), so this fails on privileges before RLS is
    // consulted. Both layers have to be wrong for a row to land.
    const { error } = await outsider
      .from('prospects')
      .insert({ business_name: 'Injected', source: 'api_key' });

    expect(error, 'an authenticated non-operator inserted a prospect').not.toBeNull();
  });
});
