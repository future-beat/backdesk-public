-- ── CR-03: THE CSV STAGING WORKSPACE GETS A CLOCK AND A SWEEP ───────────────
--
-- `prospects.csv_staging` holds the ENTIRE parsed Job List export — every column
-- of every row, not the seven mapped fields. For a real ServiceM8 export that is
-- job and billing addresses, both email columns, three phone columns and the
-- description of work: strictly MORE personal data than `prospect_quote_lines`,
-- which 0014 treats as the highest-sensitivity table in the schema.
--
-- Until this migration it had no retention AT ALL. `purge_after` and the
-- `prospect-line-purge` job (0014) cover the line table and nothing else, and
-- `csv_staging` was cleared in exactly one place — `storeAuditResults`, which
-- runs only on a SUCCESSFUL mapping confirmation. Every other exit from the
-- mapping flow left a full copy of a stranger's customer list in the database
-- indefinitely:
--
--   * the operator uploads and navigates away (the likely case mid-sales-call);
--   * `confirmCsvMapping` returns missing_columns / no_usable_rows /
--     unknown_header / needs_acknowledgement and the operator gives up;
--   * the prospect never converts and is simply forgotten.
--
-- Both the schema comment and the repository said the requirement out loud —
-- "leaving it populated would keep a second copy of every contact detail alive
-- past the purge that empties the line table" — and nothing enforced it. A
-- retention guarantee that depends on a user completing a flow is not one.

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS csv_staging_expires_at timestamptz;
--> statement-breakpoint

-- BACKFILL, so the sweep is retroactive. Rows staged before this migration have
-- no expiry and would otherwise be the one cohort the policy never reaches --
-- which is exactly the cohort that has been sitting there longest. They are
-- given the standard window from now rather than from their upload time: the
-- upload time is not recorded, and dating them from `created_at` could delete a
-- workspace out from under an operator who is mid-mapping right now.
UPDATE public.prospects
   SET csv_staging_expires_at = now() + interval '24 hours'
 WHERE csv_staging IS NOT NULL
   AND csv_staging_expires_at IS NULL;
--> statement-breakpoint

-- Partial index: the sweep's predicate, and nothing else. `prospects` is a
-- sales pipeline measured in dozens, so this is about keeping the hourly job
-- from being a sequential scan on a table that will one day not be tiny --
-- staged rows are a small minority of it by construction.
CREATE INDEX IF NOT EXISTS prospects_csv_staging_expiry_idx
  ON public.prospects (csv_staging_expires_at)
  WHERE csv_staging IS NOT NULL;
--> statement-breakpoint

-- ── THE SWEEP ───────────────────────────────────────────────────────────────
--
-- Hourly, not daily: an abandoned upload should be dead within the sales meeting
-- it came from, and the 24-hour window is already the generous part of the
-- policy. :20 past the hour keeps it clear of the 5-minute tick at :00/:05/...,
-- of `prospect-line-purge` at 03:15 and of `cron-details-cleanup` at 03:30.
--
-- A pure UPDATE carrying no secret, so a committed migration is the right home —
-- the same argument 0012 and 0014 make. The tick, whose command embeds a bearer
-- token, is applied by scripts/apply-cron-schedules.mjs instead.
--
-- BOTH COLUMNS ARE CLEARED TOGETHER. They are one fact ("something is staged and
-- it dies at this time"); an expiry left behind on a row with no staging is a
-- row this job would re-examine every hour to delete nothing.
--
-- `csv_staging_expires_at IS NOT NULL` is redundant against `< now()`, which
-- already skips NULLs, and is written anyway for the reason 0014 gives: NULL
-- means "nothing is staged", and that deserves to be stated in the predicate
-- rather than left as an emergent property of three-valued logic.
--
-- IDEMPOTENT BY CONSTRUCTION: unschedule-if-present, then schedule.
-- `cron.unschedule` raises when the job does not exist, so the existence check
-- is required, not defensive.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prospect-staging-sweep') THEN
    PERFORM cron.unschedule('prospect-staging-sweep');
  END IF;
END
$$;
--> statement-breakpoint

SELECT cron.schedule(
  'prospect-staging-sweep',
  '20 * * * *',
  $$UPDATE prospects
       SET csv_staging = NULL, csv_staging_expires_at = NULL
     WHERE csv_staging IS NOT NULL
       AND csv_staging_expires_at IS NOT NULL
       AND csv_staging_expires_at < now()$$
);
