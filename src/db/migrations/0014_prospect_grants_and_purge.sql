-- Migration 0014 — privileges, closed vocabularies and the D-04 retention job
-- for the two prospect tables.
--
-- EVERY NEW TABLE NEEDS ITS OWN GRANT BLOCK. 0003 said it, 0005 explained why
-- saying it once was not enough, 0007 and 0011 repeated it. Recap:
--
--   RLS decides WHICH ROWS a role may see. Table privileges decide whether the
--   role may touch the table at all. Postgres checks privileges FIRST, so a
--   table with a perfect policy and no GRANT returns `42501 permission denied`
--   — an ERROR, not an empty result — which leaks the table's existence and
--   breaks the property that denial and absence are indistinguishable.
--
-- REVOKE-THEN-GRANT: hosted Supabase installs ALTER DEFAULT PRIVILEGES at
-- bootstrap and hands anon and authenticated the full set — including TRUNCATE,
-- WHICH IS NOT SUBJECT TO ROW-LEVEL SECURITY — on every table drizzle creates
-- in `public`. A fresh `supabase start` database has no such default, so
-- skipping the REVOKE makes CI and production disagree with production being
-- the permissive one.

REVOKE ALL ON public.prospects FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.prospects FROM authenticated;
--> statement-breakpoint
REVOKE ALL ON public.prospect_quote_lines FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.prospect_quote_lines FROM authenticated;
--> statement-breakpoint

-- prospects: READ-ONLY for authenticated, and the read is gated by
-- `is_operator()` on top of this grant, so an authenticated non-operator sees
-- an empty set rather than an error.
--
-- NO INSERT, and that omission is the same one `sm8_connections` carries for
-- the same reason: a prospect row is created only by the verify-then-write
-- audit action, which proves the API key works against the live API BEFORE
-- anything is stored. A hand-inserted prospect is a business we have no read
-- access to, wearing an audit's clothes.
--
-- NO UPDATE either — unlike `quotes`, no column on this table holds a human
-- decision. Every value is either typed once at creation or computed by the
-- aggregation. And no DELETE: retention here is the purge job's business, and
-- an `authenticated` DELETE grant would let a caller destroy the aggregate
-- figures that are supposed to OUTLIVE the raw lines.
GRANT SELECT ON public.prospects TO anon;
--> statement-breakpoint
GRANT SELECT ON public.prospects TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.prospects TO service_role;
--> statement-breakpoint

-- prospect_quote_lines: the same, and this is the table the strictness is
-- really for. These rows are the names, phone numbers and email addresses of
-- the customers of a business that is NOT our client — the highest-sensitivity
-- data in the phase, and the least justified by any ongoing purpose (T-2-07).
-- SELECT is granted because plan 02-07's mapping preview renders from it; every
-- write path is service-role only.
GRANT SELECT ON public.prospect_quote_lines TO anon;
--> statement-breakpoint
GRANT SELECT ON public.prospect_quote_lines TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.prospect_quote_lines TO service_role;
--> statement-breakpoint

-- CLOSED VOCABULARIES (WR-03, following 0004, 0008 and 0011).
--
-- `authenticated` holds no write grant here, so — exactly as with the sync
-- tables — these CHECKs defend against US. A typo'd `line_source` written by
-- the service-role audit path is a line the report's CSV-degradation footnote
-- silently misclassifies; a typo'd `status` is a quote the baseline silently
-- counts as neither won nor lost, quietly deflating the number we hand a
-- prospect in a sales meeting. Nothing goes red: the row is simply never
-- matched by any `status = ...` predicate. TypeScript unions erase before the
-- INSERT is built.
--
-- IDEMPOTENT BY CONSTRUCTION (0004's pattern): Postgres has no
-- ADD CONSTRAINT IF NOT EXISTS, so drop-if-present then re-add.

ALTER TABLE public.prospects DROP CONSTRAINT IF EXISTS prospects_source_known;
--> statement-breakpoint
ALTER TABLE public.prospects
  ADD CONSTRAINT prospects_source_known
  CHECK (source IN ('api_key', 'csv'));
--> statement-breakpoint

-- The SAME four statuses as `quotes`, restated rather than shared: ServiceM8
-- fixes this lifecycle and cannot customise it per account, so a prospect's
-- history has exactly the vocabulary a client's does. A CSV import that mapped
-- a column of free text into this field is the failure this catches.
ALTER TABLE public.prospect_quote_lines DROP CONSTRAINT IF EXISTS prospect_quote_lines_status_known;
--> statement-breakpoint
ALTER TABLE public.prospect_quote_lines
  ADD CONSTRAINT prospect_quote_lines_status_known
  CHECK (status IN ('Quote', 'Work Order', 'Unsuccessful', 'Completed'));
--> statement-breakpoint

ALTER TABLE public.prospect_quote_lines DROP CONSTRAINT IF EXISTS prospect_quote_lines_source_known;
--> statement-breakpoint
ALTER TABLE public.prospect_quote_lines
  ADD CONSTRAINT prospect_quote_lines_source_known
  CHECK (line_source IN ('api', 'csv'));
--> statement-breakpoint

-- The prospect key envelope, mirroring `sm8_connections_ciphertext_versioned`
-- (0008). Nullable here, because a CSV prospect has no key at all — but a
-- non-null value that does not look encrypted is a plaintext credential written
-- by a careless code path, and without this CHECK it is indistinguishable from
-- ciphertext at the database level.
ALTER TABLE public.prospects DROP CONSTRAINT IF EXISTS prospects_ciphertext_versioned;
--> statement-breakpoint
ALTER TABLE public.prospects
  ADD CONSTRAINT prospects_ciphertext_versioned
  CHECK (api_key_ciphertext IS NULL OR api_key_ciphertext LIKE 'enc:v%');
--> statement-breakpoint

-- ── D-04 RETENTION (threat T-2-07, RESEARCH Pitfall 9) ──────────────────────
--
-- Raw prospect lines auto-purge 30 days after insert. The aggregate figures on
-- `prospects` are untouched by this and persist indefinitely: they are counts
-- and dollar totals about a BUSINESS, carrying nothing about any individual, so
-- the audit stays provable long after the PII behind it is gone. That split is
-- the entire reason there are two tables.
--
-- WHY THIS JOB IS A MIGRATION AND `sm8-sync-tick` IS NOT: the SQL below is pure
-- and carries no secret, so a committed file is the right home (the same
-- argument 0012 makes for `cron-details-cleanup`). The tick's command embeds a
-- bearer token and is applied by scripts/apply-cron-schedules.mjs instead.
--
-- 03:15 UTC = 11:15 Perth. Off the top of the hour so it does not contend with
-- the 5-minute tick or with every other cron job in the world that fires at :00,
-- and 15 minutes clear of `cron-details-cleanup` at 03:30.
--
-- `purge_after IS NOT NULL` is REDUNDANT AGAINST `purge_after < now()`, which
-- already skips NULLs, and it is written anyway. NULL means "this prospect
-- converted to a client, keep their lines" (D-02), and that is a decision worth
-- stating in the predicate rather than leaving as an emergent property of
-- three-valued logic — the next person editing this comparison should have to
-- delete the words "IS NOT NULL" to break it.
--
-- IDEMPOTENT BY CONSTRUCTION: unschedule-if-present, then schedule.
-- `cron.unschedule` raises when the job does not exist, so the existence check
-- is required, not defensive.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prospect-line-purge') THEN
    PERFORM cron.unschedule('prospect-line-purge');
  END IF;
END
$$;
--> statement-breakpoint

SELECT cron.schedule(
  'prospect-line-purge',
  '15 3 * * *',
  $$DELETE FROM prospect_quote_lines WHERE purge_after IS NOT NULL AND purge_after < now()$$
);
