-- Migration 001d — table privileges for the Supabase roles.
--
-- WHY THIS EXISTS (found by CI, 01-04):
-- RLS decides WHICH ROWS a role may see. Table privileges decide whether the
-- role may touch the table at all, and the two are independent. Postgres checks
-- privileges first, so a role with a perfectly good policy and no GRANT gets
-- `42501 permission denied for table ...` — an ERROR, not an empty result.
--
-- On the hosted Supabase project this was invisible: project bootstrap installs
-- ALTER DEFAULT PRIVILEGES in `public` for the `postgres` role, so every table
-- drizzle created there was silently granted to anon/authenticated/service_role.
-- A fresh `supabase start` database has no such default, which is exactly why
-- CI runs against one — the migration set must stand up a working database on
-- its own, not lean on state someone configured once in a dashboard.
--
-- Consequence for the console: without the anon GRANT, an unauthenticated read
-- returns 42501 instead of `[]`, which leaks the existence of the table and
-- breaks the property that denial and absence are indistinguishable (T-03-02).
--
-- EVERY NEW TABLE NEEDS ITS OWN BLOCK HERE. Deliberately not doing this with a
-- blanket ALTER DEFAULT PRIVILEGES: a future table should become reachable by a
-- role only because someone decided so, not by inheritance. Hosted will mask an
-- omission; CI will not.

-- tenants: readable by anon (RLS then returns zero rows — an empty array, not an
-- error). Authenticated members may read and modify their own tenants, gated by
-- `tenants_member_access`. INSERT is deliberately withheld: creation goes
-- through create_tenant(), which is the only path that can satisfy the RLS
-- chicken-and-egg, so granting INSERT here would only create a dead end.
GRANT SELECT ON public.tenants TO anon;
--> statement-breakpoint
GRANT SELECT, UPDATE, DELETE ON public.tenants TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.tenants TO service_role;
--> statement-breakpoint

-- tenant_members: the policy is SELECT-only for authenticated (`user_id =
-- auth.uid()`), so the grant is SELECT-only too — writes belong to
-- create_tenant() and to service-role seeding.
GRANT SELECT ON public.tenant_members TO anon;
--> statement-breakpoint
GRANT SELECT ON public.tenant_members TO authenticated;
--> statement-breakpoint
GRANT ALL ON public.tenant_members TO service_role;
