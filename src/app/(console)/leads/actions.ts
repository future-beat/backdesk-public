'use server';

import { revalidatePath } from 'next/cache';

import {
  BAD_REQUEST_MESSAGE,
  BLANK_CONTROL_STATE,
  type ControlState,
  SESSION_EXPIRED_MESSAGE,
} from '@/app/(console)/components/action-state';
import { closeLead } from '@/core/leads/close';
import { createClient } from '@/lib/supabase/server';

import { requireOperator } from '../_auth';
import {
  type CloseOutcome,
  closeControlState,
  closeLeadSchema,
  LEAD_CLOSE_FAILED_MESSAGE,
} from './action-state';

/**
 * THE LEAD QUEUE'S ONE ACTION: CLOSE A LEAD (Phase 15, CON-05 / D-01).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ EVERY EXPORT BELOW IS A GLOBALLY-POSTABLE ENDPOINT. A Server Action id   │
 * │ is global: it can be invoked by POSTing to ANY route, including one the  │
 * │ proxy never sees, and the (console) layout's gate runs only when a       │
 * │ layout renders — after the action has finished. So `authorize(tenantId)` │
 * │ runs BEFORE a byte of `formData` is read (WR-01, the queue's rule).       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── TWO GATES, AND NEITHER IS REDUNDANT (`queue/actions.ts`'s argument) ─────
 *
 * `requireOperator()` answers "may this session use a cross-client surface at
 * all". The RLS-scoped `tenants` read, made with the operator's OWN JWT,
 * answers "may this caller act for THIS client": a tenant they are not on
 * returns zero rows, indistinguishable from one that does not exist.
 *
 * ── A FOREIGN LEAD ID MATCHES NOTHING, AND SAYS NOTHING ─────────────────────
 *
 * The tenant is BOUND onto the action by the card from the row the server read
 * returned — never submitted in the form. The lead id is the one posted value,
 * and `closeLead` re-reads it under `forTenant(that tenant)`: another client's
 * lead id finds no live cadence and its guarded UPDATE matches no open row, so
 * it answers `already_closed` exactly as a lead closed a minute ago does. The
 * refusal is never an existence oracle over somebody else's customers.
 *
 * ── WHY REASON `operator` ───────────────────────────────────────────────────
 *
 * It is the closed reason the vocabulary reserves for a human deciding a lead
 * is done (D-11). The close is final: the core stops the live cadence with the
 * `lead_closed` pair and retires its unsent touches in one tenant transaction,
 * and a lead is never reopened — a new call makes a new lead.
 *
 * ── THE CAUGHT VALUE IS DISCARDED (WR-08, T-2-16) ───────────────────────────
 *
 * A postgres error from the close carries the predicate, and the predicate
 * names the lead. The operator can act on none of it; the fixed sentence is
 * the honest one, and the control stays so a retry is one tap.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A cleared caller, with the tenant facts the gate's own read already holds. */
type Authorized =
  | { ok: true; name: string; timezone: string }
  | { ok: false; state: ControlState };

function denied(message: string): { ok: false; state: ControlState } {
  return { ok: false, state: { ...BLANK_CONTROL_STATE, error: message } };
}

async function authorize(tenantId: string): Promise<Authorized> {
  if (!UUID_PATTERN.test(tenantId)) {
    return denied(BAD_REQUEST_MESSAGE);
  }

  const access = await requireOperator();
  if (access === 'unauthenticated') return denied(SESSION_EXPIRED_MESSAGE);
  if (access !== 'ok') return denied(BAD_REQUEST_MESSAGE);

  const supabase = await createClient();

  // THE OPERATOR'S OWN JWT, so Postgres decides membership rather than this
  // file. A tenant they are not on returns zero rows.
  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('id, name, timezone')
    .eq('id', tenantId)
    .maybeSingle();

  if (error || !tenant) {
    return denied(BAD_REQUEST_MESSAGE);
  }

  const row = tenant as { name: string; timezone: string };
  return { ok: true, name: row.name, timezone: row.timezone };
}

/**
 * Close one lead, reason `operator`, from its card on `/leads`.
 *
 * Bound by the card as `closeLeadFromQueue.bind(null, tenantId)`; the form
 * carries exactly one `lead_id`, parsed by a schema with no array arm.
 */
export async function closeLeadFromQueue(
  tenantId: string,
  _previous: ControlState,
  formData: FormData,
): Promise<ControlState> {
  const access = await authorize(tenantId);
  if (!access.ok) return access.state;

  const parsed = closeLeadSchema.safeParse({
    lead_id: String(formData.get('lead_id') ?? ''),
  });
  if (!parsed.success) return { ...BLANK_CONTROL_STATE, error: BAD_REQUEST_MESSAGE };

  const leadId = parsed.data.lead_id;

  let outcome: CloseOutcome;
  try {
    const result = await closeLead(tenantId, leadId, 'operator', new Date());
    outcome = result.kind === 'closed' ? { kind: 'closed' } : { kind: 'already_closed' };
  } catch {
    // The caught value is DISCARDED — see the header.
    console.error('[leads] close write failed');
    return { ...BLANK_CONTROL_STATE, error: LEAD_CLOSE_FAILED_MESSAGE };
  }

  if (outcome.kind === 'closed') {
    // Every page that renders this lead or its cadence's touches. The tenant
    // id was uuid-checked by `authorize` before anything else ran, so the
    // client path is not built from an unvalidated string.
    revalidatePath('/leads');
    revalidatePath('/queue');
    revalidatePath('/inbox');
    revalidatePath(`/clients/${tenantId}`);
  }

  return closeControlState(outcome);
}
