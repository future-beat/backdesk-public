-- Migration 002b — table privileges for sm8_connections and quotes (WR-04).
--
-- EVERY NEW TABLE NEEDS ITS OWN BLOCK HERE — 0003's header says so, and 0005
-- explains why saying it once was not enough. Recap, because this is the
-- migration that gets forgotten:
--
--   RLS decides WHICH ROWS a role may see. Table privileges decide whether the
--   role may touch the table at all. Postgres checks privileges FIRST, so a
--   table with a perfect policy and no GRANT returns `42501 permission denied`
--   — an ERROR, not an empty result — which leaks the table's existence and
--   breaks the property that denial and absence are indistinguishable.
--
-- REVOKE-THEN-GRANT, following 0005. On the hosted Supabase project, ALTER
-- DEFAULT PRIVILEGES installed at bootstrap silently hands anon and
-- authenticated the full set — SELECT, INSERT, UPDATE, DELETE, TRUNCATE — on
-- every table drizzle creates in `public`. A fresh `supabase start` database
-- (what CI runs) has no such default. Adding grants without revoking first
-- would therefore make CI and production disagree about the privilege set, with
-- production being the permissive one. TRUNCATE is the reason this is not
-- merely untidy: TRUNCATE IS NOT SUBJECT TO ROW-LEVEL SECURITY, so no policy
-- test could ever catch it.
--
-- THE STAKES ARE HIGHER ON THESE TWO TABLES THAN ON tenants:
-- `sm8_connections.api_key_ciphertext` is a client's credential to their entire
-- business (encrypted at rest, but an INSERT/UPDATE grant would let a role
-- REPLACE it with one pointing at an attacker's account), and `quotes` holds
-- customer addresses and job descriptions for every client.

REVOKE ALL ON public.sm8_connections FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.sm8_connections FROM authenticated;
--> statement-breakpoint
REVOKE ALL ON public.quotes FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.quotes FROM authenticated;
--> statement-breakpoint

-- sm8_connections: anon may SELECT so an unauthenticated read returns `[]`
-- rather than 42501 (T-03-02). RLS then returns zero rows, and the row it would
-- have returned holds only ciphertext and a last4 in any case.
--
-- Authenticated members get SELECT, UPDATE and DELETE, matching what
-- `sm8_connections_member_access` (FOR ALL, WITH CHECK) allows them to do to
-- their own tenant's row. INSERT is deliberately WITHHELD: connections are
-- created by the connect server action through the service-role repository
-- path, which is the only path that verifies the key with a live call before
-- writing it. Granting INSERT here would open a second way to create a
-- connection that skips that verification entirely.
GRANT SELECT ON public.sm8_connections TO anon;
--> statement-breakpoint
GRANT SELECT, UPDATE, DELETE ON public.sm8_connections TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.sm8_connections TO service_role;
--> statement-breakpoint

-- quotes: same shape and the same reasoning. INSERT is withheld because quote
-- rows are MIRRORED state — every one of them must correspond to a real
-- ServiceM8 job, and the only path that can guarantee that is the sync worker.
-- A hand-inserted quote row would be a job the cadence engine chases and the
-- client has never heard of. UPDATE is granted because operator triage
-- (`chase_eligibility`, plan 02-05) is a console write against this table.
GRANT SELECT ON public.quotes TO anon;
--> statement-breakpoint
GRANT SELECT, UPDATE, DELETE ON public.quotes TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.quotes TO service_role;
