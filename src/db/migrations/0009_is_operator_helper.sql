-- Migration 002d — the `is_operator()` RLS helper for non-tenant tables.
--
-- ORDERING RATIONALE — THIS IS WHY IT IS A SEPARATE MIGRATION, AND WHY IT RUNS
-- BEFORE THE ONE THAT CREATES THE TABLES (the same argument as 0000):
--
--   CREATE POLICY resolves the functions it references at DDL time. The
--   policies emitted from the drizzle schema in 0010 call `is_operator()`, so
--   the function must already exist when those policies are created. The plan
--   named a single generated-then-custom pair; that ordering cannot work,
--   because the generated file carries the policies.
--
--   And `is_operator()` reads `operator_allowlist`, which does not exist until
--   0010. The way out is the language choice, exactly as in 0000: plpgsql
--   resolves table references at CALL time, not at CREATE FUNCTION time. A
--   LANGUAGE sql function would be parsed and validated immediately and would
--   fail here.
--
-- WHAT IT GATES: the tables with no `tenant_id` to scope on —
-- `event_consumer_cursors` now, the Phase 2 prospect tables shortly
-- (RESEARCH Pattern 6). `has_tenant_access(tenant_id)` is inapplicable to them
-- and `USING (true)` is RLS in name only, which tests/rls-coverage.test.ts
-- rejects outright.
--
-- WHY AN ALLOWLIST AND NOT "IS A MEMBER OF ANY TENANT": see the header of
-- src/db/schema/operators.ts. Short version — the v2 client reports portal makes
-- every client a tenant_members row, and on that day an
-- exists-in-tenant_members check would hand each of them the sales pipeline.

CREATE OR REPLACE FUNCTION public.is_operator()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid   uuid := auth.uid();
  found boolean;
BEGIN
  -- An unauthenticated caller has no id. Returning false rather than letting
  -- the EXISTS compare against NULL keeps the answer a boolean rather than a
  -- NULL, which a policy would treat as "not visible" anyway — but explicitly,
  -- so nobody has to reason about three-valued logic inside an RLS check.
  IF uid IS NULL THEN
    RETURN false;
  END IF;

  -- SECURITY DEFINER runs this with the owner's rights, so reading
  -- operator_allowlist from inside a policy ON operator_allowlist does not
  -- recurse — the same mechanism has_tenant_access() uses for tenant_members.
  SELECT EXISTS (
    SELECT 1 FROM public.operator_allowlist WHERE user_id = uid
  ) INTO found;

  RETURN found;
END;
$$;
--> statement-breakpoint

-- `public` includes anon, so revoke from both explicitly rather than relying on
-- the default grant being absent (0002's rule).
--
-- `authenticated` MUST hold EXECUTE: an RLS policy expression is evaluated with
-- the CALLING role's privileges, so without this grant every read of a gated
-- table would fail with `42501 permission denied for function is_operator`
-- instead of returning zero rows — an error that leaks the table's existence.
REVOKE EXECUTE ON FUNCTION public.is_operator() FROM public;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.is_operator() FROM anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.is_operator() TO authenticated;
