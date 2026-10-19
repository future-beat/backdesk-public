-- Migration 0020 — `window_refused` leaves the touch skip-reason vocabulary (WR-10).
--
-- WHY THIS EXISTS:
-- `window_refused` appeared in TOUCH_SKIP_REASONS, in the 0017 CHECK and in the
-- console's SKIP_REASON_LABELS ("outside the client's contact hours"), and a
-- repository-wide search found NO WRITER. It could not have one: this phase
-- decided that dispatch refuses an out-of-window send SILENTLY and leaves the
-- touch exactly where it was (src/core/cadence/dispatch.ts, CAD-05 (c)), because
-- skipping it there would apply D-11's staleness verdict from a module that was
-- never given that decision — and `rewindowTouch`, which DOES own moving it,
-- narrows its skip union to `min_gap | stale`.
--
-- So the schema and the UI both asserted a state the engine cannot reach. An
-- operator auditing "which rule retired this touch" was offered a fourth answer
-- that never occurs, and the next contributor reading the vocabulary would
-- reasonably conclude out-of-window touches ARE retired — the opposite of the
-- decision this phase made.
--
-- The CHECK vocabularies are the thing migrations 0004/0008/0011/0017 argue
-- should mean exactly what the code produces. This is that argument applied.
--
-- Contrast `operator_closed` in CADENCE_STOP_REASONS, which is left alone: it
-- has a matrix arm and no caller because D-16 has not landed yet, which is
-- honest forward-declaration rather than a contradiction of a decision made.
--
-- NARROWING. It can only fail if a row already carries 'window_refused' — and
-- since nothing has ever written one, that failure would itself be the finding.
ALTER TABLE public.cadence_touches DROP CONSTRAINT IF EXISTS cadence_touches_skip_reason_known;
--> statement-breakpoint
ALTER TABLE public.cadence_touches
  ADD CONSTRAINT cadence_touches_skip_reason_known
  CHECK (skip_reason IS NULL OR skip_reason IN (
    'min_gap', 'stale', 'suppressed', 'quote_closed',
    'cadence_stopped', 'cadence_expired', 'no_address'
  ));
