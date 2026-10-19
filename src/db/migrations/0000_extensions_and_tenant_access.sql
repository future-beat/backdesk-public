-- Migration 001a — platform extensions + the RLS membership helper.
--
-- ORDERING RATIONALE (this is why this migration exists separately, and first):
-- CREATE POLICY resolves the functions it references at DDL time. The policies
-- emitted from the drizzle schema in the NEXT migration call has_tenant_access(),
-- so that function must already exist when they are created.
--
-- But has_tenant_access() reads tenant_members, which does not exist yet either.
-- The way out is the language choice: plpgsql resolves table references at CALL
-- time, not at CREATE FUNCTION time, so the body can reference a table that is
-- created later in the same migration run. (A LANGUAGE sql function would be
-- parsed and validated immediately and would fail here.)

-- Extensions the cadence engine needs from Phase 3 onward. Enabled now because
-- it is cheap and forward-compatible; no cron schedules are created here.
-- If the hosted platform rejects one of these, enable it in
-- Dashboard -> Database -> Extensions and re-run.
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_cron;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_net;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pgmq;
--> statement-breakpoint

-- Membership lookup used by every tenant-scoped RLS policy.
--
-- SECURITY DEFINER: a policy on tenant_members that queried tenant_members would
-- recurse. The definer function reads the table with the owner's rights, which
-- sidesteps policy recursion and gives the planner a stable plan.
-- STABLE: same result within a statement, so the planner can cache it per query.
-- SET search_path: pins resolution so a caller cannot shadow `tenant_members`
-- with a same-named table on their own search_path.
CREATE OR REPLACE FUNCTION public.has_tenant_access(tid uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  found boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_members
    WHERE tenant_id = tid
      AND user_id = auth.uid()
  ) INTO found;
  RETURN found;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION public.has_tenant_access(uuid) FROM public;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.has_tenant_access(uuid) TO authenticated;
