-- Migration 0027 — the dead-man's lease that bounds a remote test run's pause of
-- production's pg_cron ticks, and the watchdog function that acts on it.
--
-- RENUMBERED FROM 0025 AT MERGE (2026-08-30). This was authored as 0025 on the
-- branch `claude/trusting-noether-eb2e3c` and applied to the hosted database
-- from that worktree, but main's own 0025_inbound_messages and
-- 0026_messaging_config_delivery landed first. The statements below are
-- byte-identical to what the hosted database already ran; only this comment
-- block changed. The hosted `drizzle.__drizzle_migrations` bookkeeping row was
-- re-stamped to this entry's journal `when` in the same quick task (260830-j8x),
-- so the migrator sees nothing pending here while a fresh CI database built
-- from the journal applies it at position 27.
--
-- THE FAILURE THIS ANSWERS. `tests/helpers/global-setup.ts` deactivates
-- `cadence-tick` and `sm8-sync-tick` for the duration of `npm run test:remote`,
-- because the hosted Sydney project IS production and the deployed engine would
-- otherwise mutate test fixtures mid-assertion. Re-arming lives in the teardown
-- closure, which a hard kill never reaches — and on 2026-08-28 a full-suite
-- timeout left both ticks inactive, i.e. production silently chasing nothing,
-- until a human noticed. This migration turns "until someone notices" into
-- lease TTL + one watchdog minute.
--
-- WHAT IS PERMANENT HERE AND WHAT IS NOT. The TABLE and the FUNCTION are
-- permanent, so they live in a committed migration. The per-minute
-- `remote-test-watchdog` SCHEDULE is NOT created here: it must exist only while
-- a run's pause is live, so global-setup schedules it before pausing anything
-- and teardown (or the watchdog itself) removes it. That is the same split
-- migration 0012 documents — pure committed SQL in migrations, dynamic
-- scheduling by scripts.
--
-- WHY A FUNCTION RATHER THAN SQL INLINED INTO THE CRON COMMAND STRING. The
-- lease-expiry path has to be provable without waiting on pg_cron's scheduler,
-- so `tests/remote-test-watchdog.test.ts` calls
-- `SELECT public.remote_test_watchdog()` directly. One definition, two callers,
-- no drift between the thing under test and the thing that runs in production.
--
-- NOTE ON WHAT drizzle-kit ALSO WANTED TO EMIT HERE. Migrations 0022–0024 were
-- hand-written and carry no snapshot, so `generate` diffed against
-- 0021_snapshot and proposed re-creating `cadences_one_live_per_job` and
-- dropping/recreating `cadences_one_per_opened_event`. Both are already applied
-- — on the hosted database and in any CI database built from this journal — so
-- the CREATE would abort the whole migration on a duplicate index name, and the
-- DROP would briefly remove the G-3-2 replay guarantee (and take ACCESS
-- EXCLUSIVE) on a table the per-minute cadence tick writes to. Those statements
-- were removed by hand; 0025_snapshot.json records the true post-0024 state, so
-- the drift is healed and the next `generate` starts clean.

CREATE TABLE "remote_test_lease" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"paused_jobs" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "remote_test_lease_single_row" CHECK ("remote_test_lease"."id")
);
--> statement-breakpoint
ALTER TABLE "remote_test_lease" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "remote_test_lease_operator_access" ON "remote_test_lease" AS PERMISSIVE FOR ALL TO "authenticated" USING (is_operator()) WITH CHECK (is_operator());
--> statement-breakpoint

-- REVOKE-THEN-NOTHING, unlike 0005/0007/0011/0017 which revoke and then grant
-- back a documented read. There is no read to grant back: nothing in `src/`
-- touches this table. It is written by the test harness over
-- MIGRATE_DATABASE_URL and read by the function below under pg_cron, both
-- connecting as the owner, for whom neither grants nor RLS apply.
--
-- The REVOKE is still required rather than merely tidy: the hosted project
-- installs ALTER DEFAULT PRIVILEGES in `public` for the `postgres` role, so
-- without this anon and authenticated would hold full DML plus TRUNCATE here
-- (WR-04, migration 0005's lesson) while CI — built from this journal, with no
-- such default — would not. And the contents matter: this row names production
-- cron jobs and states the minute at which they will be re-armed.
REVOKE ALL ON public.remote_test_lease FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.remote_test_lease FROM authenticated;
--> statement-breakpoint

-- The watchdog. Exactly three cases, and the ordering within case 2 is the
-- self-healing property — see tests/helpers/global-setup.ts for the other half
-- of the contract (who writes the lease, and when relative to pausing).
--
-- SECURITY INVOKER (the default), deliberately NOT DEFINER. This function is an
-- arm/disarm lever over production schedules; it must carry no privilege of its
-- own. It works because both callers already hold the rights: pg_cron runs the
-- job as the role that scheduled it (`postgres`, from global-setup's session
-- connection) and the test invokes it on that same connection.
CREATE OR REPLACE FUNCTION public.remote_test_watchdog()
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  lease record;
BEGIN
  SELECT l.expires_at, l.paused_jobs INTO lease FROM public.remote_test_lease l;

  -- CASE 3 — no lease. Either teardown re-armed the ticks and deleted the lease
  -- but died before unscheduling this job, or we are the tail of case 2 below.
  -- Nothing is paused on our account, so touch no schedule but our own.
  --
  -- The `FROM cron.job` form is existence-safe by construction: zero matching
  -- rows means zero calls. A bare `cron.unschedule('remote-test-watchdog')`
  -- RAISES when the job is absent, which here would mean the watchdog erroring
  -- every minute forever in `cron.job_run_details`.
  IF NOT FOUND THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'remote-test-watchdog';
    RETURN;
  END IF;

  -- CASE 1 — a run is in progress and its pause is legitimate. Doing nothing is
  -- the whole point: re-arming here would resurrect the exact interleaving bug
  -- (deployed tick vs. test fixtures on one set of tables) that the pause
  -- exists to prevent.
  IF lease.expires_at > now() THEN
    RETURN;
  END IF;

  -- CASE 2 — the lease expired, so whoever took it is not coming back.
  --
  -- ONLY the jobs the lease NAMES. global-setup deliberately leaves a job that
  -- was already inactive before its run as it found it; re-arming production
  -- behind the operator's back is not the harness's call, and it is not this
  -- function's either. `paused_jobs` is that consent, recorded when it was
  -- given. Matched BY NAME because tests/cron-schedules.test.ts unschedules and
  -- re-creates these jobs mid-run, so a jobid captured at setup may be stale
  -- while the job very much exists.
  PERFORM cron.alter_job(j.jobid, active := true)
    FROM cron.job j
   WHERE j.jobname = ANY (lease.paused_jobs);

  -- RE-ARM FIRST, then release, then retire. This runs in one transaction, so a
  -- failure in the alter_job above rolls back the delete and the unschedule
  -- too: the lease survives, this job survives, and it tries again next minute.
  -- The reverse order would release the lease and remove the only thing left
  -- that knew production was paused.
  DELETE FROM public.remote_test_lease;

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'remote-test-watchdog';
END;
$$;
--> statement-breakpoint

-- `public` includes anon and authenticated, and EXECUTE defaults to PUBLIC on a
-- new function (0002's and 0009's rule). Nothing is granted back here — unlike
-- is_operator(), which authenticated MUST execute for RLS to evaluate, this one
-- has no caller outside the owner. An unrevoked EXECUTE would be a
-- console-reachable switch for re-arming or, via a forged lease row, for
-- learning exactly which production schedules are paused.
REVOKE EXECUTE ON FUNCTION public.remote_test_watchdog() FROM public;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.remote_test_watchdog() FROM anon;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.remote_test_watchdog() FROM authenticated;
