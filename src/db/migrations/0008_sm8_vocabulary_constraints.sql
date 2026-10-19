-- Migration 002c — closed vocabularies on quotes (WR-03, following 0004).
--
-- WHY THIS EXISTS:
-- `status`, `chase_eligibility` and `sync_source` are declared in
-- src/db/schema/quotes.ts as closed vocabularies, and the TypeScript unions say
-- so — but 0007 grants UPDATE on public.quotes to `authenticated`, so a curl
-- with a valid operator JWT can write any string it likes into any of them.
-- TypeScript erases; the grant does not.
--
-- These are not cosmetic fields:
--
--  * `chase_eligibility` is the switch that decides whether a real SMS goes to
--    a real customer. A value that is neither 'needs_review' nor 'eligible'
--    makes every `= 'eligible'` predicate false and every `<> 'eligible'`
--    predicate true, so the same row is simultaneously not-chaseable and
--    not-safely-parked depending on which query asks. D-15 exists to stop
--    unreviewed quotes being chased; a junk value is how that guarantee gets
--    silently lost.
--  * `status` drives win/loss attribution. A row with status 'won' (a plausible
--    typo for 'Work Order') is invisible to the baseline calculation and the
--    recovered-revenue report — the client is under-credited and nothing goes
--    red.
--
-- Text + CHECK rather than a Postgres ENUM: ServiceM8 owns this vocabulary, not
-- us. If they ever add a fifth status, a CHECK is a one-line migration, whereas
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block and cannot be
-- reversed.
--
-- IDEMPOTENT BY CONSTRUCTION (0004's pattern): Postgres has no ADD CONSTRAINT
-- IF NOT EXISTS, so each constraint is dropped-if-present and re-added.

-- [CITED: developer.servicem8.com/reference/listjobs.md — "Valid values: Quote,
-- Work Order, Unsuccessful, Completed"]. Fixed upstream; not customisable per
-- account.
ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_status_known;
--> statement-breakpoint
ALTER TABLE public.quotes
  ADD CONSTRAINT quotes_status_known
  CHECK (status IN ('Quote', 'Work Order', 'Unsuccessful', 'Completed'));
--> statement-breakpoint

ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_chase_eligibility_known;
--> statement-breakpoint
ALTER TABLE public.quotes
  ADD CONSTRAINT quotes_chase_eligibility_known
  CHECK (chase_eligibility IN ('needs_review', 'eligible'));
--> statement-breakpoint

ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_sync_source_known;
--> statement-breakpoint
ALTER TABLE public.quotes
  ADD CONSTRAINT quotes_sync_source_known
  CHECK (sync_source IN ('backfill', 'poll'));
--> statement-breakpoint

-- The credential envelope must be the versioned format crypto.ts writes.
-- Without this, a plaintext key written by a future careless code path would be
-- indistinguishable from ciphertext at the database level — and the one thing
-- this column must never hold is a readable API key (threat T-2-01).
ALTER TABLE public.sm8_connections DROP CONSTRAINT IF EXISTS sm8_connections_ciphertext_versioned;
--> statement-breakpoint
ALTER TABLE public.sm8_connections
  ADD CONSTRAINT sm8_connections_ciphertext_versioned
  CHECK (api_key_ciphertext LIKE 'enc:v%');
