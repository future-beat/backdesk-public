-- Migration 0034 — the value CHECKs 0033 gave every new table EXCEPT the one a
-- client is billed from (07 WR-06, WR-07).
--
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 0033 APPLIED THE HOUSE CLOSED-VOCABULARY RULE TO `value_source`,         │
-- │ `baseline_source` and `tenant_fees.kind`, and gave `tenant_fees` an      │
-- │ `amount_cents >= 0`. It gave `quote_attributions` NO RANGE CONSTRAINT AT │
-- │ ALL — and that is the table whose columns a recovered-revenue invoice is │
-- │ computed from, written by a background consumer, for the exact reason    │
-- │ 0033 states for having CHECKs at all: "the TypeScript unions erase       │
-- │ before the INSERT is built".                                            │
-- └──────────────────────────────────────────────────────────────────────────┘
--
-- HAND-WRITTEN, NOT GENERATED. drizzle-kit does not model CHECK constraints
-- from this schema (see `README.md` — they are invisible to `meta/*_snapshot.json`
-- and drizzle believes they do not exist), so `db:generate` reports no changes
-- for this file. Same shape as `0004_tenant_constraints.sql`, which is likewise
-- a constraints-only migration with no generated half.
--
-- IDEMPOTENT BY CONSTRUCTION (0004's pattern, restated by 0033): Postgres has no
-- ADD CONSTRAINT IF NOT EXISTS, so drop-if-present then re-add. Re-running this
-- migration is a no-op.
--
-- ── VERIFIED AGAINST THE LIVE DATA BEFORE WRITING ──────────────────────────
--
-- Every predicate below was counted against the hosted Sydney database first:
-- `quote_attributions` and `monthly_reports` are both EMPTY, and no
-- `sm8_connections.baseline_win_rate` sits outside 0..1. So no ALTER here can
-- fail on an existing row. That check is the whole reason a constraint added to
-- a live billing table is safe to add at all, and it is worth repeating before
-- any future one.
--
-- ── WHY THESE PREDICATES, AND NOT MERELY "SOME VALIDATION" ─────────────────
--
-- Each one catches a class of bug the type system cannot, because the writer is
-- a service-role consumer and every one of these columns is a plain integer by
-- the time it reaches the INSERT:
--
--   * `conservative_cents <= gross_cents` is the INVARIANT OF `conservativeCents`
--     itself (`gross * (10_000 - rateBp) / 10_000`, floored, with rateBp in
--     0..10_000). A violation is the service claiming to have recovered more
--     than the job was worth — the single most expensive row this system could
--     write, because it is the one a client disproves from their own books.
--   * `baseline_rate_bp BETWEEN 0 AND 10000` is the EXACT range `conservativeCents`
--     throws outside. 07-WR-07 fixed `resolveBaseline` to clamp there, but the
--     column is what makes it true of rows written by anything else, ever.
--   * `qualifying_touch_count > 0` says out loud what `decideAttribution`
--     already guarantees: a row with zero qualifying touches is an attribution
--     with no evidence, which is precisely what D-01 exists to refuse.
--   * `window_days > 0` — a zero-day window would make the D-01 footnote on a
--     frozen report describe a rule that could not have attributed anything.

-- quote_attributions: THE MONEY.
ALTER TABLE public.quote_attributions DROP CONSTRAINT IF EXISTS quote_attributions_money_sane;
--> statement-breakpoint
ALTER TABLE public.quote_attributions
  ADD CONSTRAINT quote_attributions_money_sane
  CHECK (gross_cents >= 0 AND conservative_cents >= 0 AND conservative_cents <= gross_cents);
--> statement-breakpoint

-- quote_attributions: THE ARITHMETIC THE MONEY WAS STRUCK WITH.
--
-- Kept as a SECOND constraint rather than folded into the one above so a
-- violation names which half failed. `quote_attributions_money_sane` firing and
-- `quote_attributions_baseline_in_range` firing are different bugs with
-- different fixes, and a single constraint would report them identically.
ALTER TABLE public.quote_attributions DROP CONSTRAINT IF EXISTS quote_attributions_baseline_in_range;
--> statement-breakpoint
ALTER TABLE public.quote_attributions
  ADD CONSTRAINT quote_attributions_baseline_in_range
  CHECK (baseline_rate_bp BETWEEN 0 AND 10000 AND window_days > 0 AND qualifying_touch_count > 0);
--> statement-breakpoint

-- monthly_reports: THE VERSION SEQUENCE AND THE PERIOD.
--
-- `version` is computed as `COALESCE(MAX(version), 0) + 1` inside the INSERT, so
-- it starts at 1 and cannot legally be 0 or negative; `monthly_reports_version_uniq`
-- already refuses a duplicate, and this refuses a nonsensical one. `period_end`
-- is EXCLUSIVE, so it is strictly greater than `period_start` for every real
-- calendar month — an inverted or empty period would produce a document
-- reporting on no days at all, with figures summed over nothing.
ALTER TABLE public.monthly_reports DROP CONSTRAINT IF EXISTS monthly_reports_period_sane;
--> statement-breakpoint
ALTER TABLE public.monthly_reports
  ADD CONSTRAINT monthly_reports_period_sane
  CHECK (version > 0 AND period_end > period_start);
--> statement-breakpoint

-- sm8_connections: THE COLUMN 07-WR-07 FOUND UNGUARDED AT BOTH ENDS.
--
-- `baseline_win_rate` is `numeric(5,4)`, so the COLUMN permits values up to
-- 9.9999 while a win rate can only mean 0..1. An out-of-range value there is
-- what `resolveBaseline` reads, multiplies by 10_000, and hands to
-- `conservativeCents` — which throws `InvalidMoneyError` and (before 07-CR-03)
-- wedged the attribution consumer for every tenant. The TypeScript side now
-- falls back to the default rather than trusting it; this is the same rule
-- stated where a row cannot get past it.
--
-- NULL IS EXPLICITLY ALLOWED and is a different fact from 0: "there is nothing
-- to measure" versus "this client issued quotes and won none". `resolveBaseline`
-- turns on exactly that distinction, so the constraint must not collapse it.
ALTER TABLE public.sm8_connections DROP CONSTRAINT IF EXISTS sm8_connections_baseline_win_rate_range;
--> statement-breakpoint
ALTER TABLE public.sm8_connections
  ADD CONSTRAINT sm8_connections_baseline_win_rate_range
  CHECK (baseline_win_rate IS NULL OR (baseline_win_rate >= 0 AND baseline_win_rate <= 1));
