-- Migration 0017 — table privileges and closed vocabularies for the six cadence
-- tables (WR-04, WR-03; threats T-3-01, T-3-02, T-3-03).
--
-- HAND-WRITTEN, not generated: drizzle-kit models tables and policies, not
-- GRANTs and not CHECK constraints. Its journal entry is stamped by hand in
-- meta/_journal.json for the same reason 0007, 0011 and 0014 are.
--
-- EVERY NEW TABLE NEEDS ITS OWN BLOCK HERE — 0003 said it, 0005 explained why
-- saying it once was not enough, 0007 repeated it, 0011 repeated it again. This
-- is the fifth time, for six tables at once. Recap:
--
--   RLS decides WHICH ROWS a role may see. Table privileges decide whether the
--   role may touch the table at all. Postgres checks privileges FIRST, so a
--   table with a perfect policy and no GRANT returns `42501 permission denied`
--   — an ERROR, not an empty result — which leaks the table's existence and
--   breaks the property that denial and absence are indistinguishable.
--
-- REVOKE-THEN-GRANT, following 0005/0007/0011. Hosted Supabase installs ALTER
-- DEFAULT PRIVILEGES at bootstrap and silently hands anon and authenticated the
-- full set — SELECT, INSERT, UPDATE, DELETE, TRUNCATE — on every table drizzle
-- creates in `public`. A fresh `supabase start` database (what CI runs) has no
-- such default, so skipping the REVOKE makes CI and production disagree with
-- production being the permissive one. TRUNCATE is why this is not merely
-- untidy: TRUNCATE IS NOT SUBJECT TO ROW-LEVEL SECURITY, so no policy test
-- could ever catch it.
--
-- ── ALL SIX ARE READ-ONLY TO `authenticated`, AND THAT IS NOT LAZINESS ──────
--
-- `quotes` grants UPDATE because `chase_eligibility` holds a genuine HUMAN
-- decision made in the console. NOT ONE COLUMN on these six tables is like
-- that. The kill switches, pauses and resumes of D-16 are server ACTIONS: they
-- authorize through an RLS-scoped read with the operator's own JWT and then
-- write through the service-role repository (WR-01), which is the only path
-- that also stops the cadence, skips the unsent touches and writes the
-- suppression row as one transaction. A direct console UPDATE would perform one
-- third of that and leave the rest — a "stopped" cadence whose touches are
-- still scheduled, or a suppressed contact whose live cadence keeps sending.
--
-- So `authenticated` gets SELECT (the console renders cadence state and
-- upcoming touches) and nothing else. anon gets SELECT so an unauthenticated
-- read returns `[]` rather than 42501; RLS then returns zero rows.

REVOKE ALL ON public.cadence_touch_templates FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.cadence_touch_templates FROM authenticated;
--> statement-breakpoint
REVOKE ALL ON public.cadence_settings FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.cadence_settings FROM authenticated;
--> statement-breakpoint
REVOKE ALL ON public.cadences FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.cadences FROM authenticated;
--> statement-breakpoint
REVOKE ALL ON public.cadence_touches FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.cadence_touches FROM authenticated;
--> statement-breakpoint
REVOKE ALL ON public.send_ledger FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.send_ledger FROM authenticated;
--> statement-breakpoint
REVOKE ALL ON public.suppressed_contacts FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.suppressed_contacts FROM authenticated;
--> statement-breakpoint

-- cadence_touch_templates: the client's follow-up shape (D-02). An UPDATE grant
-- would let a caller with an operator JWT rewrite `offset_days` directly —
-- harmless-looking, and it silently changes how every FUTURE cadence for that
-- client is materialized without going through the onboarding flow that is
-- supposed to be the record of what the tradie agreed to.
GRANT SELECT ON public.cadence_touch_templates TO anon;
--> statement-breakpoint
GRANT SELECT ON public.cadence_touch_templates TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.cadence_touch_templates TO service_role;
--> statement-breakpoint

-- cadence_settings: holds `paused_at`, the reversible per-client kill switch
-- (D-06). An UPDATE grant is the ability to CLEAR it — i.e. to restart
-- messaging every one of a client's customers — with a single PATCH and none of
-- the D-07 re-window that a real resume performs. Cadences would then dispatch
-- every touch that fell due during the pause, all at once. That is the burst
-- send CAD-02 exists to make impossible, reachable from a curl.
GRANT SELECT ON public.cadence_settings TO anon;
--> statement-breakpoint
GRANT SELECT ON public.cadence_settings TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.cadence_settings TO service_role;
--> statement-breakpoint

-- cadences: an INSERT grant fabricates a chase against a customer the client
-- never quoted; an UPDATE grant flips `status` from 'stopped' back to 'active',
-- resurrecting a cadence that was killed. Both bypass the partial unique index
-- that makes one-live-per-quote structural (T-3-03) — not by defeating it, but
-- by writing rows the consumer never agreed to.
GRANT SELECT ON public.cadences TO anon;
--> statement-breakpoint
GRANT SELECT ON public.cadences TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.cadences TO service_role;
--> statement-breakpoint

-- cadence_touches: the materialized schedule. An UPDATE grant rewrites
-- `scheduled_at` — the one column the entire "never send out of hours, never
-- burst, never late" guarantee is stored in. Moving a touch to 3am is a
-- one-field write and a DNCR contact-hours breach. Marking a touch 'approved'
-- likewise skips whatever Phase 6's approval gate turns out to be.
GRANT SELECT ON public.cadence_touches TO anon;
--> statement-breakpoint
GRANT SELECT ON public.cadence_touches TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.cadence_touches TO service_role;
--> statement-breakpoint

-- send_ledger: APPEND-ONLY, and not even append from this role (the
-- quote_status_events posture, for the same reason and higher stakes).
--
-- This table IS the CAD-04 guarantee. A DELETE grant removes the row that
-- proves a touch was already claimed — the next tick would then claim it again
-- and the customer gets the same follow-up twice, which is the single failure
-- the constraint exists to prevent (T-3-03). An INSERT grant fabricates a send
-- Phase 7 bills against; an UPDATE grant rewrites `outcome`, turning "we do not
-- know whether this went out" into a definite answer nobody verified.
GRANT SELECT ON public.send_ledger TO anon;
--> statement-breakpoint
GRANT SELECT ON public.send_ledger TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.send_ledger TO service_role;
--> statement-breakpoint

-- suppressed_contacts: the irreversibility of D-06/D-15, enforced at the GRANT
-- layer rather than merely documented (T-3-02).
--
-- NO INSERT, NO UPDATE, NO DELETE — and the absent DELETE is the one that
-- matters. A row here exists because a human complained or asked to be left
-- alone; removing it re-arms the cadence against that person. The suppression
-- list is the Spam Act safety mechanism, so "un-suppress" must not be a
-- capability the console role holds at all, not even an undocumented one.
--
-- The absent INSERT is deliberate too: a console-written row would carry
-- whatever `address` the caller supplied, unnormalized, and a suppression that
-- stores `0400 123 456` does not match the `+61400123456` dispatch checks
-- against. Suppression is only written by the service-role kill path, which
-- normalizes both channels for the one human and stops the cadence in the same
-- transaction.
GRANT SELECT ON public.suppressed_contacts TO anon;
--> statement-breakpoint
GRANT SELECT ON public.suppressed_contacts TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.suppressed_contacts TO service_role;
--> statement-breakpoint

-- ── CLOSED VOCABULARIES (WR-03, following 0004, 0008 and 0011) ──────────────
--
-- `authenticated` holds no write grant on any of these, so — exactly as with
-- the sync tables — these CHECKs are not defending against a curl with an
-- operator JWT. THEY DEFEND AGAINST US. The service-role cadence worker is the
-- only writer, and the TypeScript unions in src/db/schema/cadences.ts and
-- cadence-touches.ts erase before the INSERT is built.
--
-- What a typo costs here is specific and silent. `status = 'stoped'` matches
-- neither `status = 'active'` (so the cadence stops dispatching) nor
-- `status IN ('active','paused')` (so it falls OUT of the partial unique index
-- and a second live cadence can be created for the same quote). Nothing goes
-- red; the customer gets two parallel chase sequences. That is precisely the
-- class of bug a database constraint catches and a union cannot.
--
-- REASON COLUMNS ADMIT NULL, and the CHECKs say so explicitly rather than
-- relying on three-valued logic being remembered correctly: `pause_reason` is
-- null whenever the cadence is not paused, which is most of the time.
--
-- IDEMPOTENT BY CONSTRUCTION (0004's pattern): Postgres has no
-- ADD CONSTRAINT IF NOT EXISTS, so drop-if-present then re-add.

ALTER TABLE public.cadences DROP CONSTRAINT IF EXISTS cadences_status_known;
--> statement-breakpoint
ALTER TABLE public.cadences
  ADD CONSTRAINT cadences_status_known
  CHECK (status IN ('active', 'paused', 'stopped', 'completed', 'expired'));
--> statement-breakpoint

ALTER TABLE public.cadences DROP CONSTRAINT IF EXISTS cadences_pause_reason_known;
--> statement-breakpoint
ALTER TABLE public.cadences
  ADD CONSTRAINT cadences_pause_reason_known
  CHECK (pause_reason IS NULL OR pause_reason IN ('customer_reply', 'client_paused'));
--> statement-breakpoint

-- 'reopened' and 'no_contact' are in this list and are NOT in the research
-- sketch: D-08 makes a reopen a terminal stop (the quote returns to operator
-- triage rather than the cadence restarting), and D-04 requires a quote with no
-- usable contact to be created already-stopped so the event is consumed exactly
-- once and the console surfaces it — never a guess at who to text.
ALTER TABLE public.cadences DROP CONSTRAINT IF EXISTS cadences_stop_reason_known;
--> statement-breakpoint
ALTER TABLE public.cadences
  ADD CONSTRAINT cadences_stop_reason_known
  CHECK (stop_reason IS NULL OR stop_reason IN (
    'won', 'lost', 'removed', 'reopened',
    'contact_suppressed', 'operator_closed', 'no_contact'
  ));
--> statement-breakpoint

-- D-14 verbatim, including the two gates Phase 3 auto-passes. They are
-- constrained now so Phases 5 and 6 fill in behaviour rather than migrating
-- live cadences to a wider vocabulary.
ALTER TABLE public.cadence_touches DROP CONSTRAINT IF EXISTS cadence_touches_status_known;
--> statement-breakpoint
ALTER TABLE public.cadence_touches
  ADD CONSTRAINT cadence_touches_status_known
  CHECK (status IN (
    'scheduled', 'needs_draft', 'pending_approval', 'approved', 'sent', 'skipped'
  ));
--> statement-breakpoint

ALTER TABLE public.cadence_touches DROP CONSTRAINT IF EXISTS cadence_touches_skip_reason_known;
--> statement-breakpoint
ALTER TABLE public.cadence_touches
  ADD CONSTRAINT cadence_touches_skip_reason_known
  CHECK (skip_reason IS NULL OR skip_reason IN (
    'min_gap', 'stale', 'suppressed', 'quote_closed',
    'cadence_stopped', 'cadence_expired', 'window_refused'
  ));
--> statement-breakpoint

-- NULL is admitted deliberately and means "claimed, outcome unknown" — see the
-- header of src/db/schema/send-ledger.ts. A NOT NULL column with a 'failed'
-- default would reclassify an unknown as a definite non-delivery, and the
-- obvious response to a definite non-delivery is a retry.
ALTER TABLE public.send_ledger DROP CONSTRAINT IF EXISTS send_ledger_outcome_known;
--> statement-breakpoint
ALTER TABLE public.send_ledger
  ADD CONSTRAINT send_ledger_outcome_known
  CHECK (outcome IS NULL OR outcome IN ('stub_sent', 'sent', 'failed'));
--> statement-breakpoint

-- A channel the engine can send on but cannot suppress on would be a hole in
-- the D-15 guarantee, so these two vocabularies are deliberately identical.
ALTER TABLE public.suppressed_contacts DROP CONSTRAINT IF EXISTS suppressed_contacts_channel_known;
--> statement-breakpoint
ALTER TABLE public.suppressed_contacts
  ADD CONSTRAINT suppressed_contacts_channel_known
  CHECK (channel IN ('sms', 'email'));
--> statement-breakpoint

ALTER TABLE public.cadence_touch_templates DROP CONSTRAINT IF EXISTS cadence_touch_templates_channel_known;
--> statement-breakpoint
ALTER TABLE public.cadence_touch_templates
  ADD CONSTRAINT cadence_touch_templates_channel_known
  CHECK (channel IN ('sms', 'email'));
--> statement-breakpoint

ALTER TABLE public.cadence_touches DROP CONSTRAINT IF EXISTS cadence_touches_channel_known;
--> statement-breakpoint
ALTER TABLE public.cadence_touches
  ADD CONSTRAINT cadence_touches_channel_known
  CHECK (channel IN ('sms', 'email'));
