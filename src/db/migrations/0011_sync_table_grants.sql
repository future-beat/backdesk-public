-- Migration 002f — table privileges and closed vocabularies for the five sync
-- tables (WR-04, WR-03).
--
-- EVERY NEW TABLE NEEDS ITS OWN BLOCK HERE — 0003 said it, 0005 explained why
-- saying it once was not enough, 0007 repeated it. Recap:
--
--   RLS decides WHICH ROWS a role may see. Table privileges decide whether the
--   role may touch the table at all. Postgres checks privileges FIRST, so a
--   table with a perfect policy and no GRANT returns `42501 permission denied`
--   — an ERROR, not an empty result — which leaks the table's existence and
--   breaks the property that denial and absence are indistinguishable.
--
-- REVOKE-THEN-GRANT, following 0005 and 0007. Hosted Supabase installs ALTER
-- DEFAULT PRIVILEGES at bootstrap and silently hands anon and authenticated the
-- full set — SELECT, INSERT, UPDATE, DELETE, TRUNCATE — on every table drizzle
-- creates in `public`. A fresh `supabase start` database (what CI runs) has no
-- such default, so skipping the REVOKE makes CI and production disagree with
-- production being the permissive one. TRUNCATE is why this is not merely
-- untidy: TRUNCATE IS NOT SUBJECT TO ROW-LEVEL SECURITY, so no policy test
-- could ever catch it.

REVOKE ALL ON public.quote_contacts FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.quote_contacts FROM authenticated;
--> statement-breakpoint
REVOKE ALL ON public.quote_status_events FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.quote_status_events FROM authenticated;
--> statement-breakpoint
REVOKE ALL ON public.sync_runs FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.sync_runs FROM authenticated;
--> statement-breakpoint
REVOKE ALL ON public.operator_allowlist FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.operator_allowlist FROM authenticated;
--> statement-breakpoint
REVOKE ALL ON public.event_consumer_cursors FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.event_consumer_cursors FROM authenticated;
--> statement-breakpoint

-- quote_contacts: READ-ONLY for authenticated, narrower than `quotes`.
--
-- `quotes` grants UPDATE because operator triage (chase_eligibility) is a
-- genuine console write. This table has no such column: every field on it is
-- mirrored ServiceM8 state, so there is no legitimate console write and the
-- grant says so. The stakes are the reason to be strict — these are a client's
-- customers' phone numbers and email addresses, and an UPDATE grant is a path
-- to redirect a cadence at an attacker-chosen recipient. DELETE is withheld for
-- the same reason: a contact vanishing from our mirror while still present
-- upstream would be silently repaired by the next sync, hiding the tampering.
GRANT SELECT ON public.quote_contacts TO anon;
--> statement-breakpoint
GRANT SELECT ON public.quote_contacts TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.quote_contacts TO service_role;
--> statement-breakpoint

-- quote_status_events: APPEND-ONLY, and not even append from this role.
--
-- The table is the ledger Phase 7 computes recovered revenue from and Phase 3
-- drives cadences from. An INSERT grant here is the ability to fabricate a win
-- — an invoice line the service bills against, for a job nobody won. An UPDATE
-- or DELETE grant is the ability to erase one. Only the sync worker
-- (service_role) writes, and it writes inside the same transaction as the quote
-- upsert that justifies the row. SELECT is granted so the console can render a
-- per-quote timeline.
GRANT SELECT ON public.quote_status_events TO anon;
--> statement-breakpoint
GRANT SELECT ON public.quote_status_events TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.quote_status_events TO service_role;
--> statement-breakpoint

-- sync_runs: the health log. Read-only for the console; written only by the
-- worker that actually ran the cycle. A writable health log is not a health log
-- — the point of the table is that it records what happened, not what someone
-- would like it to say.
GRANT SELECT ON public.sync_runs TO anon;
--> statement-breakpoint
GRANT SELECT ON public.sync_runs TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.sync_runs TO service_role;
--> statement-breakpoint

-- operator_allowlist: the gate itself, so INSERT is the highest-value write in
-- the schema — it is self-promotion to operator, and from there to every
-- non-tenant table `is_operator()` guards. Enrolment happens through
-- `scripts/grant-operator.mjs` on the service-role key, run deliberately by
-- someone with that key. SELECT (gated by the policy, so operators only) is
-- granted so the console can show who is enrolled.
GRANT SELECT ON public.operator_allowlist TO anon;
--> statement-breakpoint
GRANT SELECT ON public.operator_allowlist TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.operator_allowlist TO service_role;
--> statement-breakpoint

-- event_consumer_cursors: consumers run as service_role. An authenticated
-- UPDATE here would let a caller rewind or fast-forward the cadence engine —
-- rewinding replays every event (a burst of duplicate follow-ups to real
-- customers), fast-forwarding skips them silently. Both are worse than they
-- look for a two-column table.
GRANT SELECT ON public.event_consumer_cursors TO anon;
--> statement-breakpoint
GRANT SELECT ON public.event_consumer_cursors TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.event_consumer_cursors TO service_role;
--> statement-breakpoint

-- CLOSED VOCABULARIES (WR-03, following 0004 and 0008).
--
-- Unlike `quotes`, `authenticated` holds no write grant on these tables, so the
-- CHECKs are not defending against a curl with an operator JWT. They defend
-- against US: the service-role sync worker is the only writer, and a typo'd
-- `event_type` written by it would be a win the cadence engine silently ignores
-- and the recovered-revenue report silently omits. Nothing goes red — the row
-- is simply never matched by any `event_type = ...` predicate. That is exactly
-- the class of bug a database constraint catches and a TypeScript union cannot,
-- because the union erases before the INSERT is built.
--
-- IDEMPOTENT BY CONSTRUCTION (0004's pattern): Postgres has no
-- ADD CONSTRAINT IF NOT EXISTS, so drop-if-present then re-add.

ALTER TABLE public.quote_status_events DROP CONSTRAINT IF EXISTS quote_status_events_type_known;
--> statement-breakpoint
ALTER TABLE public.quote_status_events
  ADD CONSTRAINT quote_status_events_type_known
  CHECK (event_type IN ('quote_opened', 'won', 'lost', 'reopened', 'removed'));
--> statement-breakpoint

-- `from_status` additionally admits the '(new)' first-sight sentinel; `to_status`
-- does not, because there is no transition INTO not-having-been-seen.
ALTER TABLE public.quote_status_events DROP CONSTRAINT IF EXISTS quote_status_events_from_status_known;
--> statement-breakpoint
ALTER TABLE public.quote_status_events
  ADD CONSTRAINT quote_status_events_from_status_known
  CHECK (from_status IN ('Quote', 'Work Order', 'Unsuccessful', 'Completed', '(new)'));
--> statement-breakpoint

ALTER TABLE public.quote_status_events DROP CONSTRAINT IF EXISTS quote_status_events_to_status_known;
--> statement-breakpoint
ALTER TABLE public.quote_status_events
  ADD CONSTRAINT quote_status_events_to_status_known
  CHECK (to_status IN ('Quote', 'Work Order', 'Unsuccessful', 'Completed'));
--> statement-breakpoint

-- The outcome vocabulary is deliberately identical to `Sm8FailureKind` plus
-- 'ok' (src/core/servicem8/types.ts). A sixth value would be a failure with no
-- policy attached — D-06 assigns a response to each of these five and to
-- nothing else.
ALTER TABLE public.sync_runs DROP CONSTRAINT IF EXISTS sync_runs_outcome_known;
--> statement-breakpoint
ALTER TABLE public.sync_runs
  ADD CONSTRAINT sync_runs_outcome_known
  CHECK (outcome IN ('ok', 'auth_failed', 'rate_limited', 'server_error', 'network_error', 'parse_error'));
