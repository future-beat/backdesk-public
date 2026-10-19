-- Migration 001e — database-level tenant invariants (WR-03).
--
-- WHY THIS EXISTS:
-- src/core/shared/tenant.ts calls itself "the single validation authority" and
-- says the rules "live in one place that the form cannot bypass". That was true
-- of the form and false of everything else: create_tenant() is GRANTed to
-- `authenticated` and exposed on PostgREST, and 0003 also grants UPDATE on
-- public.tenants to `authenticated`. A curl with a valid operator JWT could
-- therefore write contact_days = '{0,99}', contact_hours_start > _end,
-- timezone = 'Mars/Phobos', or a 10 KB name — nothing in the database said no.
--
-- These are the exact inputs the DNCR contact-hours discipline consumes from
-- Phase 3 onward. A window that is wrong here is a compliance breach later, so
-- the invariant belongs where no caller can route around it.
--
-- IDEMPOTENT BY CONSTRUCTION: Postgres has no ADD CONSTRAINT IF NOT EXISTS, so
-- each constraint is dropped-if-present and re-added. Re-running this migration
-- against a database that already has them is a no-op, and the definitions here
-- are always the ones in force.

-- Contact-hours window must be a real window. Equal start and end is rejected
-- rather than read as zero-width or all-day; an ambiguous window is precisely
-- what the TypeScript authority forbids, for the same reason.
ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_hours_ordered;
--> statement-breakpoint
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_hours_ordered
  CHECK (contact_hours_start < contact_hours_end);
--> statement-breakpoint

-- At least one contact day, at most seven. COALESCE matters: array_length() of
-- an empty array returns NULL, and a NULL check expression PASSES — so the bare
-- BETWEEN would have let contact_days = '{}' straight through.
ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_days_nonempty;
--> statement-breakpoint
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_days_nonempty
  CHECK (COALESCE(array_length(contact_days, 1), 0) BETWEEN 1 AND 7);
--> statement-breakpoint

-- ISO weekdays only: Monday = 1 .. Sunday = 7.
ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_days_in_range;
--> statement-breakpoint
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_days_in_range
  CHECK (contact_days <@ ARRAY[1,2,3,4,5,6,7]::smallint[]);
--> statement-breakpoint

-- Bounds mirror TENANT_NAME_MAX_LENGTH / TRADE_TYPE_MAX_LENGTH in
-- src/core/shared/tenant.ts. Keep the two in step.
ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_name_len;
--> statement-breakpoint
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_name_len
  CHECK (char_length(name) BETWEEN 1 AND 120);
--> statement-breakpoint

ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_trade_type_len;
--> statement-breakpoint
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_trade_type_len
  CHECK (char_length(trade_type) BETWEEN 1 AND 80);
--> statement-breakpoint

-- The lifecycle vocabulary. Widening this is a deliberate migration, not a typo
-- in an UPDATE that nothing notices until a report is wrong.
ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_status_known;
--> statement-breakpoint
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_status_known
  CHECK (status IN ('onboarding', 'active', 'paused', 'ended'));
--> statement-breakpoint

-- TIMEZONE VALIDITY — a trigger, not a CHECK, and not a line inside
-- create_tenant().
--
--  * Not a CHECK: validating a zone requires reading pg_timezone_names, and a
--    CHECK expression may not contain a subquery or a non-IMMUTABLE function.
--  * Not create_tenant(): 0003 grants UPDATE on public.tenants to
--    `authenticated`, so an operator holding a JWT can PATCH timezone directly
--    over PostgREST without the RPC ever running. A constraint that only one
--    caller honours is the bug this migration exists to close.
--
-- pg_timezone_names rather than `now() AT TIME ZONE`: the latter accepts any
-- POSIX offset string, so 'Mars/Phobos' fails but '<+08>-08' would pass.
--
-- This is a FLOOR, not a mirror of the TypeScript rule. pg_timezone_names still
-- contains a handful of legacy fixed-offset entries ('EST', 'MST', 'HST') that
-- Intl.supportedValuesOf('timeZone') — the list src/core/shared/tenant.ts
-- validates against — excludes. The console therefore stays the narrower
-- authority; this trigger only guarantees no caller can store a string that is
-- not a timezone at all.
CREATE OR REPLACE FUNCTION public.tenants_validate_timezone()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION '% is not a recognised IANA timezone identifier', NEW.timezone
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS tenants_validate_timezone_trg ON public.tenants;
--> statement-breakpoint
CREATE TRIGGER tenants_validate_timezone_trg
  BEFORE INSERT OR UPDATE OF timezone ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.tenants_validate_timezone();
