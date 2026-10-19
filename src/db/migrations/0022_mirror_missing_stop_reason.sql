-- Migration 0022 — `mirror_missing` joins the cadence stop-reason vocabulary (G-3-5).
--
-- WHY THIS EXISTS:
-- `removed` meant two different things at once. One is evidence-backed:
-- ServiceM8 told us the job is gone, either through the outbox `removed` event
-- or through `stopReasonForQuote` reading `sm8_active = false` off a quote row
-- we still hold. The other is not: dispatch's just-in-time re-read
-- (src/core/cadence/dispatch.ts, CAD-05 (a)) found NO quote row in our mirror at
-- all, and wrote `removed` on the argument that this was "the same fact arriving
-- with less evidence".
--
-- UAT test 5 overruled that argument, and the correction is the point: less
-- evidence is exactly why it must be a DIFFERENT WORD. A missing mirror row
-- could be a purge, a bug in our own sync, or an upstream deletion we never
-- observed — and we cannot tell which from here. `cadences` carries no FK to
-- `quotes` (Phase 7 attribution must survive a client disconnect), so a cadence
-- outliving its quote row is a reachable state rather than a corruption.
--
-- Phase 7 attributes recovered revenue on this column. Collapsing "the job was
-- deleted" and "we lost the row" into one bucket destroys a distinction the
-- report cannot reconstruct later. Which bucket each belongs to is Phase 7's
-- decision; being ABLE to tell them apart is this migration's.
--
-- `removed` keeps both of its evidence-backed writers, unchanged.
--
-- IDEMPOTENT BY CONSTRUCTION, in the idiom migrations 0004/0008/0011/0017/0018
-- use: Postgres has no ADD CONSTRAINT IF NOT EXISTS, so the constraint is
-- dropped-if-present and re-added with the definition in force.
--
-- WIDENING ONLY. Every value previously legal is still legal, so this cannot
-- fail on data. It is also applied BEFORE the writer ships, which is the 0018
-- ordering principle verbatim — the vocabulary the database enforces is never
-- narrower than the one the code can produce. A writer racing an old seven-member
-- CHECK would not degrade: it would THROW inside the claim transaction, every
-- minute, and the cadence would never stop.
ALTER TABLE public.cadences DROP CONSTRAINT IF EXISTS cadences_stop_reason_known;
--> statement-breakpoint
ALTER TABLE public.cadences
  ADD CONSTRAINT cadences_stop_reason_known
  CHECK (stop_reason IS NULL OR stop_reason IN (
    'won', 'lost', 'removed', 'reopened',
    'contact_suppressed', 'operator_closed', 'no_contact', 'mirror_missing'
  ));
