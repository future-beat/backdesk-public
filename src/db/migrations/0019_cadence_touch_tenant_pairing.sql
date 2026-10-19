-- Migration 0019 — a touch and its cadence belong to the SAME tenant (WR-05).
--
-- WHY THIS EXISTS:
-- `cadence_touches.tenant_id` is a bare uuid with no `.references()`, and
-- `cadences.tenant_id` likewise — the latter deliberately, so a disconnected
-- client does not take Phase 7's attribution history with them (see the header
-- of src/db/schema/cadences.ts). That argument covers the reference to
-- `tenants`. It does NOT cover the PAIRING: nothing said the touch and the
-- cadence it hangs off had to agree about whose they are.
--
-- Until now the only thing holding that invariant was that every writer happens
-- to take both values from the same closure. `claimDue` is the query that makes
-- it matter — its result rows feed contact_mobile / contact_email / contact_name
-- straight into a SendRequest — and it is now correlated on both sides in
-- for-tenant.ts. This migration is the other half: the invariant becomes
-- structural, so a future writer cannot reintroduce the hole and no query has to
-- remember to defend against it.
--
-- ADDED ALONGSIDE the existing single-column FK rather than replacing it: the
-- drizzle schema declares that one via `.references()`, so dropping it here
-- would put the SQL and the snapshot out of step and the next generated
-- migration would try to put it back. Two cascade paths to the same parent row
-- are harmless — Postgres deletes the child once.
--
-- IDEMPOTENT BY CONSTRUCTION, in the idiom 0004/0008/0017 use.
--
-- IF THIS FAILS, IT FAILS FOR THE RIGHT REASON: a row whose touch and cadence
-- disagree about the tenant is exactly the state this constraint exists to make
-- impossible, and it must be seen rather than papered over.

-- The referenced pair needs a uniqueness guarantee. `id` is already the primary
-- key, so this is free — it exists only to give the composite FK a target.
ALTER TABLE public.cadences DROP CONSTRAINT IF EXISTS cadences_id_tenant_uniq;
--> statement-breakpoint
ALTER TABLE public.cadences
  ADD CONSTRAINT cadences_id_tenant_uniq UNIQUE (id, tenant_id);
--> statement-breakpoint

ALTER TABLE public.cadence_touches DROP CONSTRAINT IF EXISTS cadence_touches_cadence_tenant_fk;
--> statement-breakpoint
ALTER TABLE public.cadence_touches
  ADD CONSTRAINT cadence_touches_cadence_tenant_fk
  FOREIGN KEY (cadence_id, tenant_id)
  REFERENCES public.cadences (id, tenant_id)
  ON DELETE CASCADE;
