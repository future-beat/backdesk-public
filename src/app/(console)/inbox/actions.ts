'use server';

import { revalidatePath } from 'next/cache';

import { markInboundTriaged } from '@/db/repository';

import { OPERATOR_DENIED_MESSAGE, requireOperator } from '../_auth';
import { BLANK_TRIAGE_STATE, type TriageState } from './action-state';

export type { TriageState };

/**
 * A uuid, and nothing that is not a uuid.
 *
 * Not politeness about input shape: the id goes into a parameterised predicate,
 * and a non-uuid reaches Postgres as a `22P02` thrown from two layers below a
 * screen the operator is looking at. Rejecting here means the failure is named
 * where it happened.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Mark one inbound row handled (MSG-04).
 *
 * ── THE GATE RUNS FIRST, BEFORE THE BODY IS READ (WR-01, T-4-24) ────────────
 *
 * A Server Action id is GLOBAL: this one is POSTable at any route, including
 * routes `proxy.ts` never sees, and the `(console)` layout's own auth check runs
 * only when a layout renders — which is after the action has already finished.
 * So the layout is not this action's authorization, and neither is RLS:
 * `markInboundTriaged` writes through `getDb()`, the service-role path, where
 * the `inbound_messages` policy is inert by design.
 *
 * `requireOperator()` is therefore the ONLY enforcement on this path, and a
 * SESSION IS NOT ENOUGH (CR-01) — the rows this action reaches are, by
 * definition, the ones with `tenant_id = NULL`, which the policy admits to
 * operators alone precisely because an unplaced reply may be another client's
 * customer. There is nothing in `formData` worth parsing for a caller who is not
 * one, which is why the gate is above the read rather than beside it.
 *
 * What a forged POST could do if this were missing is small but not nothing:
 * clear the queue. Not delete evidence — the row, the body and the attribution
 * all survive — but make the one screen that exists to show a human a STOP they
 * have not seen render "No inbound needing attention."
 *
 * ── ONE EXPORT, DELIBERATELY ────────────────────────────────────────────────
 *
 * Every export of a `'use server'` module is a globally-POSTable endpoint, so
 * orchestration stays out of this file: the page's reads, the tenant-name lookup
 * and the formatting all live in `page.tsx`, which is reachable only by
 * rendering it.
 */
export async function markHandledAction(
  _previous: TriageState,
  formData: FormData,
): Promise<TriageState> {
  const access = await requireOperator();
  if (access !== 'ok') {
    return { ...BLANK_TRIAGE_STATE, error: OPERATOR_DENIED_MESSAGE[access] };
  }

  const raw = formData.get('inbound_id');
  if (typeof raw !== 'string' || !UUID_PATTERN.test(raw)) {
    return { ...BLANK_TRIAGE_STATE, error: 'That message could not be found.' };
  }

  const result = await markInboundTriaged(raw);

  revalidatePath('/inbox');

  // Both outcomes are successes and only one of them is news. A second tap — or
  // a second operator — writing nothing is the guard working, and saying
  // "marked handled" for it would claim a write that did not happen.
  return {
    error: null,
    success: result.triaged ? 'Marked handled.' : 'Already handled.',
  };
}
