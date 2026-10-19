/**
 * The dead-man's lease that bounds how long a remote test run may leave
 * production's pg_cron ticks paused.
 *
 * ── THE FAILURE THIS TABLE EXISTS FOR ───────────────────────────────────────
 *
 * `tests/helpers/global-setup.ts` deactivates `cadence-tick` and
 * `sm8-sync-tick` for the duration of `npm run test:remote`, because the hosted
 * Sydney project IS production and the deployed engine would otherwise mutate
 * test fixtures mid-assertion. Re-arming happens in the teardown closure — which
 * a hard kill (Ctrl-C, a suite timeout, an OOM) never reaches. The observed
 * outcome: both ticks left inactive, production silently not chasing a single
 * quote, until a human notices and runs the recovery statement by hand.
 *
 * A lease turns "until someone notices" into a bounded number. Setup writes one
 * row naming exactly the jobs it paused and stamping an expiry; a per-minute
 * `remote-test-watchdog` job (scheduled by setup, not by a migration — the
 * schedule must exist only while a pause is live) re-arms those jobs once the
 * expiry passes and then removes itself. Teardown deletes the row.
 *
 * ── WHY `paused_jobs` AND NOT "just re-arm both ticks" ──────────────────────
 *
 * global-setup deliberately leaves a job that was ALREADY inactive before the
 * run as it found it — re-arming production behind the operator's back is not
 * that file's call. The watchdog inherits the same ethic, and can only do so if
 * it knows which jobs THIS run paused. That is the entire content of this
 * column: consent, recorded at the moment it was given.
 *
 * ── ONE ROW, BY CONSTRUCTION ────────────────────────────────────────────────
 *
 * `id boolean PRIMARY KEY DEFAULT true` with `CHECK (id)` — the standard
 * one-row-table shape. Two overlapping remote runs are not defended against
 * anywhere else either (see global-setup's header), and a primary-key collision
 * on the second run's INSERT is a far more visible way to say so than two
 * leases racing to unpause each other. The INSERT is an upsert precisely so a
 * DEAD run's stale row is reusable rather than a permanent duplicate-key wall.
 *
 * ── NOT AN APPLICATION TABLE ────────────────────────────────────────────────
 *
 * Nothing in `src/` reads or writes this. It is touched only by the test
 * harness and by `public.remote_test_watchdog()`, both connecting as the
 * table's owner. The policy below exists because `tests/rls-coverage.test.ts`
 * (rightly) refuses to let ANY public table ship without one, and because the
 * migration additionally revokes every inherited grant from anon and
 * authenticated — this table names production cron jobs and the times at which
 * they will be re-armed, which is reconnaissance, not public data.
 */
import { sql } from 'drizzle-orm';
import { boolean, check, pgPolicy, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

export const remoteTestLease = pgTable(
  'remote_test_lease',
  {
    /** Always `true`. See the header: this is the one-row-table pin. */
    id: boolean('id').primaryKey().default(true),

    /**
     * When the watchdog is permitted to re-arm `paused_jobs`. Computed by
     * Postgres (`now() + interval`), never by the test process's clock: a
     * machine with skew would otherwise write a lease that is already expired
     * and hand the ticks back mid-run, which is the interleaving bug the pause
     * exists to prevent.
     */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    /**
     * The cron jobnames THIS run deactivated, and the only ones the watchdog
     * may re-activate. By name rather than by jobid because
     * `tests/cron-schedules.test.ts` unschedules and re-creates these jobs
     * mid-run — the id recorded at setup may no longer exist while the job very
     * much does.
     */
    pausedJobs: text('paused_jobs').array().notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('remote_test_lease_single_row', sql`${table.id}`),
    /**
     * Same shape as `operator_allowlist_operator_access`: scoped through
     * `is_operator()` rather than a bare `using (true)`, so a v2 client login
     * can never satisfy it. Defense in depth only — the harness and the
     * watchdog both run as the owner, for whom RLS is not enforced, and the
     * migration leaves anon/authenticated with no grant to exercise anyway.
     */
    pgPolicy('remote_test_lease_operator_access', {
      as: 'permissive',
      for: 'all',
      to: authenticatedRole,
      using: sql`is_operator()`,
      withCheck: sql`is_operator()`,
    }),
  ],
);

export type RemoteTestLease = typeof remoteTestLease.$inferSelect;
