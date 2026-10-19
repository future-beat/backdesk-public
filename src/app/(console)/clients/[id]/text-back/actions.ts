'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { addNeverTextNumber, removeNeverTextNumber } from '@/core/leads/never-text';
import { attestTextBackTemplate, saveTextBackTemplate } from '@/core/leads/template-admin';
import { NEVER_TEXT_KINDS, TEXT_BACK_VARIANTS } from '@/db/schema';
import { createClient } from '@/lib/supabase/server';

import { OPERATOR_DENIED_MESSAGE, requireOperatorId } from '../../../_auth';
import {
  ATTEST_NOTE_REQUIRED_MESSAGE,
  ATTEST_NOTE_TOO_LONG_MESSAGE,
  attestInvalidMessage,
  BAD_REQUEST_MESSAGE,
  BLANK_TEXT_BACK_STATE,
  NEVER_TEXT_ADDED_MESSAGE,
  NEVER_TEXT_ALREADY_LISTED_MESSAGE,
  NEVER_TEXT_INVALID_NUMBER_MESSAGE,
  NEVER_TEXT_LABEL_FIELD_MAX,
  NEVER_TEXT_LABEL_TOO_LONG_MESSAGE,
  NEVER_TEXT_LAST_OWN_LINE_MESSAGE,
  NEVER_TEXT_NOT_FOUND_MESSAGE,
  NEVER_TEXT_NUMBER_FIELD_MAX,
  NEVER_TEXT_REMOVED_MESSAGE,
  TEMPLATE_ALREADY_ATTESTED_MESSAGE,
  TEMPLATE_ATTESTED_MESSAGE,
  TEMPLATE_BODY_TOO_LONG_MESSAGE,
  TEMPLATE_RULE_MESSAGE,
  TEMPLATE_UNCHANGED_MESSAGE,
  TEMPLATE_VERSION_NOT_FOUND_MESSAGE,
  templateRefusalMessage,
  templateSavedMessage,
  TEXT_BACK_BODY_FIELD_MAX,
  TEXT_BACK_NOTE_MAX,
  TEXT_BACK_WRITE_FAILED_MESSAGE,
  type TextBackState,
  UNKNOWN_CLIENT_MESSAGE,
} from './action-state';

export type { TextBackState };

/**
 * THE TEXT-BACK WRITES, as server actions (Phase 12, D-02, D-06, IN-07).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ EVERY EXPORT BELOW IS A GLOBALLY-POSTABLE ENDPOINT (T-12-11). A Server   │
 * │ Action id can be POSTed at any route, and the (console) layout's gate    │
 * │ runs after the action has finished. What is attested here is sent       │
 * │ verbatim to members of the public; what is listed here is the fail-safe  │
 * │ that stops a client being texted about their own call.                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * SO EVERY ONE OPENS THE SAME WAY, BEFORE A BYTE OF `formData` IS READ:
 *
 *  1. OPERATOR — `requireOperatorId()`, the allowlist read made with the
 *     operator's own JWT. Its user id is the `created_by` / `attested_by`;
 *     a form field never is.
 *  2. TENANT — `authorize(tenantId)`, the RLS-scoped `tenants` read with the
 *     same JWT. A client the operator does not hold reads as absent.
 *
 * Then a zod parse of the fields, then the framework-free core
 * (`src/core/leads/template-admin.ts`, `src/core/leads/never-text.ts`) inside
 * a try whose catch DISCARDS the value and logs a fixed string — a driver error
 * carries the statement's parameters, which here are a client's numbers and
 * wording. Every result kind maps to one sentence from `action-state.ts`.
 *
 * NOTHING HERE ATTESTS ON SAVE, DEFAULTS A NOTE, OR EDITS / UN-ATTESTS /
 * DELETES A VERSION. There is no action for any of those, and none may be
 * added (TXT-01).
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A hard bound on the note field before the core trims and checks it. */
const NOTE_FIELD_MAX = TEXT_BACK_NOTE_MAX * 4;

function denial(message: string): TextBackState {
  return { ...BLANK_TEXT_BACK_STATE, error: message };
}

function success(message: string): TextBackState {
  return { ...BLANK_TEXT_BACK_STATE, success: message };
}

/** A missing or non-string field is `''`, which the schemas then refuse. */
function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

/**
 * OPERATOR, THEN TENANT — both load-bearing, in that order. Returns the
 * operator's user id when the caller is cleared to proceed.
 */
type Authorized = { ok: true; operatorUserId: string } | { ok: false; state: TextBackState };

async function authorize(tenantId: string): Promise<Authorized> {
  const operator = await requireOperatorId();
  if (!operator.ok) {
    return { ok: false, state: denial(OPERATOR_DENIED_MESSAGE[operator.reason]) };
  }

  if (!UUID_PATTERN.test(tenantId)) {
    return { ok: false, state: denial(UNKNOWN_CLIENT_MESSAGE) };
  }

  // THE OPERATOR'S OWN JWT, so Postgres decides membership. Everything after
  // this writes through `forTenant()`, the service-role path, where RLS is
  // inert by design — and neither table grants `authenticated` a write.
  const supabase = await createClient();
  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('id')
    .eq('id', tenantId)
    .maybeSingle();

  if (error || !tenant) {
    return { ok: false, state: denial(UNKNOWN_CLIENT_MESSAGE) };
  }

  return { ok: true, operatorUserId: operator.userId };
}

function revalidateTextBack(tenantId: string): void {
  revalidatePath(`/clients/${tenantId}/text-back`);
  // The client page carries the go-live checklist, whose text-back items read
  // the attested set and the own-line count.
  revalidatePath(`/clients/${tenantId}`);
}

/* ------------------------------------------------------------------------- *
 * saveTextBackTemplateAction — D-02, TXT-05
 * ------------------------------------------------------------------------- */

const saveSchema = z.object({
  variant: z.enum(TEXT_BACK_VARIANTS, BAD_REQUEST_MESSAGE),
  body: z
    .string()
    .min(1, TEMPLATE_RULE_MESSAGE.empty)
    .max(TEXT_BACK_BODY_FIELD_MAX, TEMPLATE_BODY_TOO_LONG_MESSAGE),
});

/** Save a new version of one wording, UNATTESTED. A save is never an attestation. */
export async function saveTextBackTemplateAction(
  tenantId: string,
  _previous: TextBackState,
  formData: FormData,
): Promise<TextBackState> {
  const access = await authorize(tenantId);
  if (!access.ok) return access.state;

  const parsed = saveSchema.safeParse({
    variant: readString(formData, 'variant'),
    body: readString(formData, 'body'),
  });
  if (!parsed.success) return denial(parsed.error.issues[0]?.message ?? BAD_REQUEST_MESSAGE);

  let result: Awaited<ReturnType<typeof saveTextBackTemplate>>;
  try {
    result = await saveTextBackTemplate(tenantId, {
      variant: parsed.data.variant,
      body: parsed.data.body,
      operatorUserId: access.operatorUserId,
    });
  } catch {
    // Discarded: the statement's parameters are the wording itself.
    console.error('[text-back] template save failed');
    return denial(TEXT_BACK_WRITE_FAILED_MESSAGE);
  }

  switch (result.kind) {
    case 'saved':
      revalidateTextBack(tenantId);
      return success(templateSavedMessage(result.version, result.segments));
    case 'invalid':
      return denial(templateRefusalMessage(result.violations.map((v) => v.rule)));
    case 'unchanged':
      return denial(TEMPLATE_UNCHANGED_MESSAGE);
    case 'tenant_missing':
      return denial(UNKNOWN_CLIENT_MESSAGE);
  }
}

/* ------------------------------------------------------------------------- *
 * attestTextBackTemplateAction — D-02 (write-once)
 * ------------------------------------------------------------------------- */

const attestSchema = z.object({
  versionId: z.uuid(TEMPLATE_VERSION_NOT_FOUND_MESSAGE),
  // Required and bounded AGAIN in the core, after trimming — this is only the
  // field's outer bound. No default: an attestation nobody wrote a note for is
  // not evidence of anything.
  note: z.string().max(NOTE_FIELD_MAX, ATTEST_NOTE_TOO_LONG_MESSAGE),
});

/** Attest one saved version: who, when and what they checked. Never edits it. */
export async function attestTextBackTemplateAction(
  tenantId: string,
  _previous: TextBackState,
  formData: FormData,
): Promise<TextBackState> {
  const access = await authorize(tenantId);
  if (!access.ok) return access.state;

  const parsed = attestSchema.safeParse({
    versionId: readString(formData, 'version_id'),
    note: readString(formData, 'attestation_note'),
  });
  if (!parsed.success) return denial(parsed.error.issues[0]?.message ?? BAD_REQUEST_MESSAGE);

  let result: Awaited<ReturnType<typeof attestTextBackTemplate>>;
  try {
    result = await attestTextBackTemplate(tenantId, {
      versionId: parsed.data.versionId,
      note: parsed.data.note,
      operatorUserId: access.operatorUserId,
      now: new Date(),
    });
  } catch {
    console.error('[text-back] template attest failed');
    return denial(TEXT_BACK_WRITE_FAILED_MESSAGE);
  }

  switch (result.kind) {
    case 'attested':
      revalidateTextBack(tenantId);
      return success(TEMPLATE_ATTESTED_MESSAGE);
    case 'note_required':
      return denial(ATTEST_NOTE_REQUIRED_MESSAGE);
    case 'note_too_long':
      return denial(ATTEST_NOTE_TOO_LONG_MESSAGE);
    case 'already_attested':
      // NOT a failure: the wording IS attested, which is what was asked for.
      revalidateTextBack(tenantId);
      return success(TEMPLATE_ALREADY_ATTESTED_MESSAGE);
    case 'invalid':
      return denial(attestInvalidMessage(result.violations.map((v) => v.rule)));
    case 'not_found':
      return denial(TEMPLATE_VERSION_NOT_FOUND_MESSAGE);
    case 'tenant_missing':
      return denial(UNKNOWN_CLIENT_MESSAGE);
  }
}

/* ------------------------------------------------------------------------- *
 * addNeverTextNumberAction — D-06, IN-07
 * ------------------------------------------------------------------------- */

const addSchema = z.object({
  // Bounded only — the core's one normaliser decides what is a number.
  number: z.string().max(NEVER_TEXT_NUMBER_FIELD_MAX, NEVER_TEXT_INVALID_NUMBER_MESSAGE),
  kind: z.enum(NEVER_TEXT_KINDS, BAD_REQUEST_MESSAGE),
  label: z.string().max(NEVER_TEXT_LABEL_FIELD_MAX * 4, NEVER_TEXT_LABEL_TOO_LONG_MESSAGE),
});

/** Add one number to this client's never-text list. The number is never logged. */
export async function addNeverTextNumberAction(
  tenantId: string,
  _previous: TextBackState,
  formData: FormData,
): Promise<TextBackState> {
  const access = await authorize(tenantId);
  if (!access.ok) return access.state;

  const parsed = addSchema.safeParse({
    number: readString(formData, 'number'),
    kind: readString(formData, 'kind'),
    label: readString(formData, 'label'),
  });
  if (!parsed.success) return denial(parsed.error.issues[0]?.message ?? BAD_REQUEST_MESSAGE);

  let result: Awaited<ReturnType<typeof addNeverTextNumber>>;
  try {
    result = await addNeverTextNumber(tenantId, {
      input: parsed.data.number,
      kind: parsed.data.kind,
      label: parsed.data.label,
      operatorUserId: access.operatorUserId,
    });
  } catch {
    // Discarded: the statement's parameters include the number.
    console.error('[text-back] never-text add failed');
    return denial(TEXT_BACK_WRITE_FAILED_MESSAGE);
  }

  switch (result.kind) {
    case 'added':
      revalidateTextBack(tenantId);
      return success(NEVER_TEXT_ADDED_MESSAGE);
    case 'already_listed':
      return denial(NEVER_TEXT_ALREADY_LISTED_MESSAGE);
    case 'invalid_number':
      return denial(NEVER_TEXT_INVALID_NUMBER_MESSAGE);
    case 'invalid_label':
      return denial(NEVER_TEXT_LABEL_TOO_LONG_MESSAGE);
  }
}

/* ------------------------------------------------------------------------- *
 * removeNeverTextNumberAction — IN-07 (an armed client keeps an own line)
 * ------------------------------------------------------------------------- */

const removeSchema = z.object({
  id: z.uuid(NEVER_TEXT_NOT_FOUND_MESSAGE),
});

/** Remove one entry. The last own line of an armed client is refused. */
export async function removeNeverTextNumberAction(
  tenantId: string,
  _previous: TextBackState,
  formData: FormData,
): Promise<TextBackState> {
  const access = await authorize(tenantId);
  if (!access.ok) return access.state;

  const parsed = removeSchema.safeParse({ id: readString(formData, 'entry_id') });
  if (!parsed.success) return denial(parsed.error.issues[0]?.message ?? BAD_REQUEST_MESSAGE);

  let result: Awaited<ReturnType<typeof removeNeverTextNumber>>;
  try {
    result = await removeNeverTextNumber(tenantId, parsed.data.id);
  } catch {
    console.error('[text-back] never-text remove failed');
    return denial(TEXT_BACK_WRITE_FAILED_MESSAGE);
  }

  switch (result.kind) {
    case 'removed':
      revalidateTextBack(tenantId);
      return success(NEVER_TEXT_REMOVED_MESSAGE);
    case 'not_found':
      revalidateTextBack(tenantId);
      return denial(NEVER_TEXT_NOT_FOUND_MESSAGE);
    case 'last_own_line_while_armed':
      return denial(NEVER_TEXT_LAST_OWN_LINE_MESSAGE);
  }
}
