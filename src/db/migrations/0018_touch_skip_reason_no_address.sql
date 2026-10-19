-- Migration 0018 — `no_address` joins the touch skip-reason vocabulary (WR-01).
--
-- WHY THIS EXISTS:
-- dispatch.ts refused a claimed touch whose channel carries no snapshotted
-- address WITHOUT changing the touch's state, on the correct principle that
-- every member of TOUCH_SKIP_REASONS is a rule that decided something and Phase
-- 7 reads them as evidence — so writing `quote_closed` there would put a false
-- statement in the record to make a loop terminate.
--
-- But the consequence was worse than the thing being avoided. The touch stayed
-- `approved` with `scheduled_at <= now`, so every tick re-claimed it: one of the
-- tenant's 50 claim slots consumed, one identical console.error emitted, once a
-- minute for the six weeks until D-12 expires the cadence. `claimDue` orders by
-- `scheduled_at`, so the corrupted row is the OLDEST and therefore starves
-- genuinely sendable touches behind it. "Stays live and stays loud" sixty
-- thousand times is the same as being silent.
--
-- The answer is an honest terminal reason rather than a borrowed false one. The
-- CHECK is widened here first, in its own migration, so the vocabulary the
-- database enforces is never narrower than the one the code can produce.
--
-- IDEMPOTENT BY CONSTRUCTION, in the idiom migrations 0004/0008/0011/0017 use:
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so the constraint is
-- dropped-if-present and re-added with the definition in force.
--
-- WIDENING ONLY. No existing row can violate this — every value previously
-- legal is still legal — so this cannot fail on data.
ALTER TABLE public.cadence_touches DROP CONSTRAINT IF EXISTS cadence_touches_skip_reason_known;
--> statement-breakpoint
ALTER TABLE public.cadence_touches
  ADD CONSTRAINT cadence_touches_skip_reason_known
  CHECK (skip_reason IS NULL OR skip_reason IN (
    'min_gap', 'stale', 'suppressed', 'quote_closed',
    'cadence_stopped', 'cadence_expired', 'no_address', 'window_refused'
  ));
