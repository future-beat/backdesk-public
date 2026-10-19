-- Migration 001c — tenant creation RPC + duplicate-name constraint.
--
-- Why an RPC rather than a plain INSERT from the console:
-- RLS on `tenants` requires an existing tenant_members row to grant access, but
-- no membership row can exist before the tenant does. That chicken-and-egg is
-- solved by a SECURITY DEFINER function that writes both rows itself.
--
-- Both INSERTs run inside the function's single implicit transaction, so an
-- interrupted create can never leave an orphan membership row.

CREATE OR REPLACE FUNCTION public.create_tenant(
  p_name             text,
  p_trade_type       text,
  p_timezone         text,
  p_hours_start      time,
  p_hours_end        time,
  p_days             smallint[],
  p_escalation_phone text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_new_id uuid;
BEGIN
  -- SECURITY DEFINER runs with the owner's rights, so the caller's identity must
  -- be checked explicitly. Without this, an unauthenticated caller would create
  -- a tenant owned by nobody.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'create_tenant requires an authenticated user'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.tenants (
    name, trade_type, timezone,
    contact_hours_start, contact_hours_end, contact_days, escalation_phone
  )
  VALUES (
    p_name, p_trade_type, p_timezone,
    p_hours_start, p_hours_end, p_days, p_escalation_phone
  )
  RETURNING id INTO v_new_id;

  INSERT INTO public.tenant_members (tenant_id, user_id, role)
  VALUES (v_new_id, v_uid, 'operator');

  RETURN v_new_id;
END;
$$;
--> statement-breakpoint

-- anon must never reach this. `public` includes anon, so revoke from both
-- explicitly rather than relying on the default grant being absent.
REVOKE EXECUTE ON FUNCTION public.create_tenant(text, text, text, time, time, smallint[], text) FROM public;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.create_tenant(text, text, text, time, time, smallint[], text) FROM anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.create_tenant(text, text, text, time, time, smallint[], text) TO authenticated;
--> statement-breakpoint

-- Two concurrent creates with the same name must collide rather than both
-- succeed. lower() makes the collision case-insensitive; Plan 01-03 maps the
-- resulting 23505 to a form-level message.
CREATE UNIQUE INDEX IF NOT EXISTS tenants_name_lower_key ON public.tenants (lower(name));
