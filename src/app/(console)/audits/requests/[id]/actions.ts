'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { updateAuditRequestStatus } from '@/db/repository';
import { AUDIT_REQUEST_STATUSES } from '@/db/schema';

import { OPERATOR_DENIED_MESSAGE, requireOperator } from '../../../_auth';
import type { ControlState } from './action-state';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The four words the CHECK constraint allows, as a parser.
 *
 * The constraint is the real gate and the repository re-checks the value too;
 * this one exists so a wrong value comes back as a sentence under the select
 * instead of as a `23514` thrown three layers down and rendered as "Could not
 * update the status", which would send the operator looking for an outage.
 */
const statusSchema = z.enum(AUDIT_REQUEST_STATUSES);

/**
 * Move an audit request along the sales pipeline (D-15, LAND-04).
 *
 * ── AUTH FIRST, AND AUTHORIZATION SEPARATELY (WR-01, CR-01, T-9-18) ─────────
 *
 * Server Action ids are global: this action is POSTable at any route, including
 * ones `proxy.ts` never sees, and the `(console)` layout's own gate runs only
 * when a layout renders — which is after the action has already finished. So the
 * check is the first statement, before a single field is read out of the body.
 *
 * And a session is not enough. `updateAuditRequestStatus` writes through
 * `getDb()`, the service-role connection, where the `is_operator()` policy on
 * `audit_requests` is inert by design. Without `requireOperator()` any
 * authenticated session could rewrite the status of every business that has
 * asked the founder for an audit — and `audited` is not a cosmetic word, it is
 * the one the console reads to decide a request has been dealt with.
 *
 * ── WHAT THE OPERATOR IS TOLD WHEN THE WRITE FAILS ──────────────────────────
 *
 * A fixed sentence. The caught value is DISCARDED rather than logged: a driver
 * error carries the statement, and the statement carries the request's id and
 * the column list. The log line names the operation and nothing else (WR-08,
 * T-9-05) — enough to find the request in the platform log, nothing that is
 * itself a fact about a stranger.
 */
export async function updateAuditRequestStatusAction(
  _previous: ControlState,
  formData: FormData,
): Promise<ControlState> {
  const access = await requireOperator();
  if (access !== 'ok') {
    return { error: OPERATOR_DENIED_MESSAGE[access], success: null };
  }

  const requestId = formData.get('request_id');
  // Postgres raises 22P02 on a malformed uuid rather than returning no rows, so
  // the shape is checked before it reaches the repository's own assertion.
  if (typeof requestId !== 'string' || !UUID_PATTERN.test(requestId)) {
    return { error: 'That request could not be found.', success: null };
  }

  const status = statusSchema.safeParse(formData.get('status'));
  if (!status.success) {
    return { error: 'Choose a status.', success: null };
  }

  try {
    await updateAuditRequestStatus(requestId, status.data);
  } catch {
    console.error('[audit-requests] status write failed');
    return { error: 'Could not update the status. Try again.', success: null };
  }

  // Both surfaces that render the status: the detail page the operator is
  // standing on, and the list they came from — whose badge and `N new` count
  // are now stale.
  revalidatePath(`/audits/requests/${requestId}`);
  revalidatePath('/audits/requests');

  return { error: null, success: 'Status updated.' };
}
