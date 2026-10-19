-- Migration 001f — revoke the privileges nobody granted on purpose (WR-04).
--
-- WHAT WAS ACTUALLY IN FORCE ON THE HOSTED PROJECT:
--
--   tenants        / anon, authenticated: DELETE, INSERT, REFERENCES, SELECT,
--                                         TRIGGER, TRUNCATE, UPDATE
--   tenant_members / anon, authenticated: DELETE, INSERT, REFERENCES, SELECT,
--                                         TRIGGER, TRUNCATE, UPDATE
--
-- 0003 predicted this in its own header — "project bootstrap installs ALTER
-- DEFAULT PRIVILEGES in `public` for the `postgres` role, so every table drizzle
-- created there was silently granted to anon/authenticated/service_role" — and
-- then only ever ADDED grants. Nothing revoked the inherited set, so the
-- carefully documented intent ("tenant_members is SELECT-only for
-- authenticated", "INSERT on tenants is deliberately withheld") was true only on
-- a fresh `supabase start` database and false in production.
--
-- WHY THAT MATTERS BEYOND TIDINESS:
--
--  1. TRUNCATE IS NOT SUBJECT TO ROW-LEVEL SECURITY. A role holding TRUNCATE on
--     `tenants` can empty the table regardless of any policy, and the cascade
--     takes tenant_members with it. No RLS test would ever catch it.
--  2. Self-enrolment (INSERT into tenant_members for a tenant you do not belong
--     to) was left standing on the privilege check and stopped only by the
--     absence of an INSERT policy. That is one convenience policy away from a
--     full cross-tenant escalation.
--  3. CI and production disagreed about the privilege set, so CI could not have
--     caught either of the above.
--
-- REVOKE-THEN-GRANT rather than revoking individual privileges: the point is to
-- state the whole intended set explicitly, so this file is the answer to "what
-- may these roles do?" rather than a diff against whatever the platform happened
-- to install. Idempotent — re-running lands on the same set.
--
-- service_role is untouched: it bypasses RLS by design and owns seeding,
-- teardown and the worker path.

REVOKE ALL ON public.tenants FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.tenants FROM authenticated;
--> statement-breakpoint
REVOKE ALL ON public.tenant_members FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.tenant_members FROM authenticated;
--> statement-breakpoint

-- tenants: anon may SELECT so that an unauthenticated read returns `[]` rather
-- than 42501 — denial and absence must stay indistinguishable (T-03-02).
-- Authenticated members may read and modify their own tenants, gated by the
-- `tenants_member_access` policy. INSERT stays withheld: creation goes through
-- create_tenant(), the only path that can satisfy the RLS chicken-and-egg.
GRANT SELECT ON public.tenants TO anon;
--> statement-breakpoint
GRANT SELECT, UPDATE, DELETE ON public.tenants TO authenticated;
--> statement-breakpoint

-- tenant_members: SELECT only, matching the `tenant_members_select_own` policy.
-- Writes belong to create_tenant() (SECURITY DEFINER, so it needs no grant here)
-- and to service-role seeding.
GRANT SELECT ON public.tenant_members TO anon;
--> statement-breakpoint
GRANT SELECT ON public.tenant_members TO authenticated;
