'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import {
  DUPLICATE_NAME_MESSAGE,
  isDuplicateNameError,
  tenantCreateSchema,
  toFieldErrors,
  type TenantFieldErrors,
} from '@/core/shared/tenant';
import { createClient } from '@/lib/supabase/server';

/**
 * Exactly what the operator typed, echoed back so a rejected submission never
 * costs them the form. Strings throughout — this is the raw shape of the
 * controls, not the parsed tenant.
 */
export type CreateTenantValues = {
  name: string;
  trade_type: string;
  timezone: string;
  contact_hours_start: string;
  contact_hours_end: string;
  contact_days: string[];
  escalation_phone: string;
};

export type CreateTenantState = {
  /** One message per control, keyed by field name. */
  errors: TenantFieldErrors;
  /** A failure that belongs to no single control (the RPC fell over). */
  formError: string | null;
  values: CreateTenantValues;
};

/** FormData values can be File entries; anything that is not a string is absent. */
function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

/**
 * Create a client tenant (ONB-01).
 *
 * The form is convenience; THIS is the trust boundary (threat T-03-01). Every
 * field is re-validated here through `tenantCreateSchema` regardless of what
 * the browser enforced, because `required` and `type="time"` are absent from a
 * curl request.
 *
 * Writes through the AUTHENTICATED server client (anon key + the operator's
 * JWT), never the service-role key — so RLS and the `create_tenant` grant are
 * exercised on every create (01-RESEARCH.md Pitfall 5).
 *
 * `create_tenant` is a SECURITY DEFINER function that inserts the tenant row
 * and the operator's membership row in one transaction. That is what resolves
 * the RLS chicken-and-egg: the policy needs a membership row that cannot exist
 * until the tenant does.
 *
 * Shaped for `useActionState`: it returns state on failure and only navigates
 * on success, so a rejected submission re-renders the form with field errors
 * and the operator's input intact.
 */
export async function createTenant(
  _previous: CreateTenantState,
  formData: FormData,
): Promise<CreateTenantState> {
  const values: CreateTenantValues = {
    name: readString(formData, 'name'),
    trade_type: readString(formData, 'trade_type'),
    timezone: readString(formData, 'timezone'),
    contact_hours_start: readString(formData, 'contact_hours_start'),
    contact_hours_end: readString(formData, 'contact_hours_end'),
    contact_days: formData.getAll('contact_days').map((day) => String(day)),
    escalation_phone: readString(formData, 'escalation_phone'),
  };

  // Authorize the caller HERE, not only at the edge (WR-01). Server Action IDs
  // are global: this action can be invoked by POSTing its ID to any route,
  // including one the proxy never sees, and the (console) layout's own check
  // runs only when a layout renders — which is after the action has finished.
  // Today `create_tenant` also refuses anon at the database, but that is the
  // RPC's guard, not this action's, and the next action added here may not
  // happen to bottom out in a role-restricted RPC.
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) {
    return {
      errors: {},
      formError: 'Your session has expired. Sign in again.',
      values,
    };
  }

  const parsed = tenantCreateSchema.safeParse(values);
  if (!parsed.success) {
    return { errors: toFieldErrors(parsed.error), formError: null, values };
  }

  const tenant = parsed.data;
  const { error } = await supabase.rpc('create_tenant', {
    p_name: tenant.name,
    p_trade_type: tenant.trade_type,
    p_timezone: tenant.timezone,
    p_hours_start: tenant.contact_hours_start,
    p_hours_end: tenant.contact_hours_end,
    p_days: tenant.contact_days,
    p_escalation_phone: tenant.escalation_phone,
  });

  if (error) {
    // The unique index on lower(name) is what makes a double submit produce one
    // tenant instead of two; this turns that collision into a fixable message
    // rather than a stack trace.
    if (isDuplicateNameError(error)) {
      return { errors: { name: DUPLICATE_NAME_MESSAGE }, formError: null, values };
    }
    return {
      errors: {},
      formError: 'Could not create the client. Try again.',
      values,
    };
  }

  // The list is force-dynamic, but the client router may still hold a payload
  // from before this write; drop it so the new client is visible on arrival.
  //
  // `/clients` rather than `/` since 09-04: the list moved off the route-group
  // root to free `/` for the public landing page, and `revalidatePath` takes the
  // REAL route path — the proxy's app-host `/` → `/clients` rewrite is a routing
  // decision made per request and invalidating `/` would now clear the landing
  // page's cache entry instead of the operator's list.
  revalidatePath('/clients');
  redirect('/clients');
}
