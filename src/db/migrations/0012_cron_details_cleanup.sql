-- Migration 0012 — weekly cleanup of cron.job_run_details (RESEARCH Pitfall 10).
--
-- pg_cron records one row per job execution and "records ... are not cleaned up
-- automatically" (supabase.com/docs/guides/cron/quickstart). The sync tick runs
-- every 5 minutes: 288 rows/day, ~105,000/year, growing without limit for as
-- long as the product exists. Each row holds the job's `command` — which for
-- `sm8-sync-tick` embeds the bearer token — so this table is also the largest
-- unbounded copy of that secret in the database. Retention is a security control
-- here, not only a housekeeping one.
--
-- WHY THIS ONE IS A MIGRATION AND `sm8-sync-tick` IS NOT: this job's SQL is pure
-- and carries no secret, so a committed file is the right home. The tick's
-- command embeds a bearer token and is applied by `scripts/apply-cron-schedules.mjs`
-- from environment variables instead — see that file's header for the full
-- argument, including why the Supabase Vault alternative was not taken.
--
-- 30 days is chosen to comfortably outlive the operator's own feedback loop: the
-- health badge (02-04) reads `sync_runs`, not this table, so what remains here is
-- for forensics on "did cron actually fire", and a month is longer than any
-- outage that would go unnoticed.
--
-- IDEMPOTENT BY CONSTRUCTION, following every migration in this directory:
-- unschedule-if-present, then schedule. `cron.unschedule` raises when the job
-- does not exist, so the existence check is required, not defensive.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cron-details-cleanup') THEN
    PERFORM cron.unschedule('cron-details-cleanup');
  END IF;
END
$$;
--> statement-breakpoint

-- Sundays at 03:30 UTC — off the top of the hour, so it does not contend with
-- the tick or with every other cron job in the world that fires at :00.
--
-- Filtered on `start_time`, NOT `end_time`: `end_time` is NULL for a run that is
-- still in flight (and for one whose worker died), and `end_time < ...` silently
-- skips NULLs, which would leave exactly the rows an investigation cares about
-- accumulating forever.
SELECT cron.schedule(
  'cron-details-cleanup',
  '30 3 * * 0',
  $$DELETE FROM cron.job_run_details WHERE start_time < now() - interval '30 days'$$
);
