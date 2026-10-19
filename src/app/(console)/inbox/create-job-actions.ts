'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { createJobForLead } from '@/core/leads/create-job';
import { createClient } from '@/lib/supabase/server';

import { OPERATOR_DENIED_MESSAGE, requireOperatorId } from '../_auth';
import {
  BLANK_CREATE_JOB_STATE,
  CREATE_JOB_SENTENCES,
  CREATE_JOB_UNKNOWN_SENTENCE,
  type CreateJobState,
} from './action-state';

/** A uuid, and nothing that is not a uuid — the `inbox/actions.ts` guard, for the same reason. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Blank optional text is absent. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === undefined || value === '' ? null : value));

/**
 * The sheet's fields. The description is NOT one of them: it is rebuilt from
 * the database in the core, so a posted preview is never trusted (D-01).
 */
const CreateJobForm = z.object({
  company_name: z.string().trim().min(1).max(100),
  contact_first: optionalText(100),
  contact_last: optionalText(100),
  suburb: optionalText(60),
  latest_inbound_id: z.string().regex(UUID_PATTERN),
  /** The preview's digest (14-REVIEW WR-04) — 64 lowercase hex, nothing else. */
  preview_sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

/**
 * Create the ServiceM8 job for one open lead (Phase 14, SM8-01, D-01).
 *
 * ── THE GATE RUNS FIRST, BEFORE THE BODY IS READ (T-14-01) ──────────────────
 *
 * A Server Action id is GLOBAL: this one is POSTable at any route, and the
 * `(console)` layout's auth check runs only when a layout renders — after the
 * action has finished. So the layout is not this action's authorization, and
 * neither is RLS: `createJobForLead` writes through the service-role
 * repository. And this action does more than write our own tables — it
 * CREATES RECORDS IN A CLIENT'S SERVICEM8 ACCOUNT with their API key, so a
 * forged POST would cost the client real data in a system we do not own.
 *
 * Therefore, in this order and no other: `requireOperatorId()` (a session is
 * not enough — the operator allowlist is); the uuid guard on both bound ids;
 * the membership read of the tenant THROUGH THE OPERATOR'S OWN JWT
 * (`clients/[id]/actions.ts`'s `authorize` shape); and only then the form,
 * through zod. `created_by` is the verified claim's `sub` — never a field,
 * because on an action whose id is global a field is the attacker's.
 *
 * ── ONE EXPORT, DELIBERATELY ────────────────────────────────────────────────
 *
 * Every export of a `'use server'` module is a globally-POSTable endpoint, so
 * this file holds this one action and nothing else (`inbox/actions.ts` keeps
 * its single export too). Every sentence returned is a fixed string from
 * `action-state.ts`; nothing a driver or ServiceM8 said reaches the screen.
 */
export async function createJobForLeadAction(
  tenantId: string,
  leadId: string,
  _previous: CreateJobState,
  formData: FormData,
): Promise<CreateJobState> {
  const access = await requireOperatorId();
  if (!access.ok) {
    return { ...BLANK_CREATE_JOB_STATE, error: OPERATOR_DENIED_MESSAGE[access.reason] };
  }

  if (!UUID_PATTERN.test(tenantId)) {
    return { ...BLANK_CREATE_JOB_STATE, error: 'Unknown client.' };
  }
  if (!UUID_PATTERN.test(leadId)) {
    return { ...BLANK_CREATE_JOB_STATE, error: 'That lead could not be found.' };
  }

  // The membership read, through the operator's own JWT: RLS decides whether
  // this operator may see this tenant at all.
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) {
    return { ...BLANK_CREATE_JOB_STATE, error: 'Your session has expired. Sign in again.' };
  }
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id')
    .eq('id', tenantId)
    .maybeSingle();
  if (tenantError || !tenant) {
    return { ...BLANK_CREATE_JOB_STATE, error: 'Unknown client.' };
  }

  // Only now is the body read.
  const parsed = CreateJobForm.safeParse({
    company_name: formData.get('company_name') ?? undefined,
    contact_first: formData.get('contact_first') ?? undefined,
    contact_last: formData.get('contact_last') ?? undefined,
    suburb: formData.get('suburb') ?? undefined,
    latest_inbound_id: formData.get('latest_inbound_id') ?? undefined,
    preview_sha256: formData.get('preview_sha256') ?? undefined,
  });
  if (!parsed.success) {
    return { ...BLANK_CREATE_JOB_STATE, error: 'Check the company name and suburb.' };
  }

  let resultKey: string;
  try {
    const result = await createJobForLead(
      tenantId,
      leadId,
      {
        companyName: parsed.data.company_name,
        contactFirst: parsed.data.contact_first,
        contactLast: parsed.data.contact_last,
        suburb: parsed.data.suburb,
        expectedLatestInboundId: parsed.data.latest_inbound_id,
        expectedPreviewSha256: parsed.data.preview_sha256,
      },
      access.userId,
    );
    resultKey = result.kind === 'failed' ? `failed:${result.errorKind}` : result.kind;
  } catch {
    // The caught value is not logged or shown: it can carry a predicate that
    // names customer columns (WR-08). The ids and nothing else.
    console.error(`[inbox] create job for lead ${leadId} (tenant ${tenantId}) threw.`);
    resultKey = 'unknown';
  }

  // Every surface that shows the lead, named directly.
  revalidatePath('/inbox');
  revalidatePath(`/clients/${tenantId}`);
  // 15-04: the sheet mounts on the lead queue too; without this a converted
  // lead keeps its button there (research Pitfall 5).
  revalidatePath('/leads');

  const sentence = CREATE_JOB_SENTENCES[resultKey] ?? CREATE_JOB_UNKNOWN_SENTENCE;
  return resultKey === 'created'
    ? { error: null, success: sentence }
    : { error: sentence, success: null };
}
