'use server';

import { revalidatePath } from 'next/cache';

import { convertProspectToTenant } from '@/db/repository';

import { OPERATOR_DENIED_MESSAGE, requireOperator } from '../../_auth';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ConvertState = {
  error: string | null;
  success: string | null;
};

/**
 * Link this prospect to the client they became (D-02, AUD-02).
 *
 * AUTH FIRST, BEFORE THE BODY IS PARSED (WR-01, threat T-2-13). A Server Action
 * id is global — this one is POSTable at any route, including routes the proxy
 * never sees, and the `(console)` layout's gate runs only when a layout renders,
 * which is after the action has already finished. Both uuids are then shape-
 * checked before they reach Postgres, and `convertProspectToTenant` re-checks
 * them at the repository boundary.
 *
 * The consequence of getting this wrong is specific: conversion is the ONLY code
 * path that clears `purge_after`, so a forged POST that succeeded would be an
 * unauthenticated request cancelling the retention policy on a stranger's
 * customer data (threat T-2-07).
 *
 * WHICH IS WHY A SESSION IS NOT ENOUGH (CR-01). `convertProspectToTenant` writes
 * through the service-role repository, where RLS is inert — so until
 * `requireOperator()` was added below, ANY authenticated session could clear
 * `purge_after` on any prospect whose uuid it could name. That is threat T-2-07
 * reached with a session rather than without one, which the header above
 * mistakenly treated as the same thing as being authorized.
 */
export async function convertProspectAction(
  _previous: ConvertState,
  formData: FormData,
): Promise<ConvertState> {
  const access = await requireOperator();
  if (access !== 'ok') {
    return { error: OPERATOR_DENIED_MESSAGE[access], success: null };
  }

  const prospectId = formData.get('prospect_id');
  const tenantId = formData.get('tenant_id');

  if (typeof prospectId !== 'string' || !UUID_PATTERN.test(prospectId)) {
    return { error: 'That audit could not be found.', success: null };
  }

  if (typeof tenantId !== 'string' || tenantId === '') {
    return { error: 'Choose the client this prospect became.', success: null };
  }

  if (!UUID_PATTERN.test(tenantId)) {
    return { error: 'That client could not be found.', success: null };
  }

  const result = await convertProspectToTenant(prospectId, tenantId);

  if (result.ok) {
    revalidatePath(`/audits/${prospectId}`);
    revalidatePath('/audits');
    // The client list, which gained a row. `/clients` rather than `/` since
    // 09-04 — the list moved off the route-group root and `revalidatePath` names
    // the real route, not the URL the proxy rewrites from.
    revalidatePath('/clients');
    return {
      error: null,
      // The retention consequence stated plainly. Conversion is the one action
      // that makes a stranger's customer data permanent, and the operator
      // should see that happen rather than infer it.
      success: `Linked. ${result.linesKept} quote line${
        result.linesKept === 1 ? '' : 's'
      } will now be kept instead of purged.`,
    };
  }

  switch (result.kind) {
    case 'already_linked':
      return {
        error:
          'That client is already linked to another audit. One client, one baseline — link this prospect to a different client, or unlink the other one first.',
        success: null,
      };
    case 'tenant_not_found':
      return { error: 'That client could not be found.', success: null };
    case 'prospect_not_found':
      return { error: 'That audit could not be found.', success: null };
  }
}
