/**
 * SAVING AND ATTESTING A TEXT-BACK WORDING (Phase 12, D-02, TXT-01, TXT-05).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE OPERATOR'S HAND ON THE EXACT WORDING IS THE CONTROL. A member of the │
 * │ public receives these bytes with no model and no merge-fill in between,  │
 * │ so the two acts that put them in front of a caller are kept apart:       │
 * │ SAVE never attests, and ATTEST never edits. There is no un-attest, no    │
 * │ delete and no edit of an attested version here, and none may be added.  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * FRAMEWORK-FREE. No `next/*`, no form parsing, no sentences: the console
 * action (`clients/[id]/text-back/actions.ts`) authorizes, parses and maps the
 * result kinds below to copy; these functions own the rules and nothing else,
 * so a future caller (a script, a second surface) cannot reach the table
 * without them.
 *
 * ── WHAT IS STORED IS WHAT THE VALIDATOR RETURNED ───────────────────────────
 *
 * `validateTextBackTemplate` normalises lookalikes (a curly apostrophe pasted
 * from a phone becomes a straight one) and returns `normalizedBody`; that, and
 * only that, is inserted. A wording that fails a rule is REFUSED WITH THE
 * REASON — never shortened, re-encoded or repaired behind the operator's back
 * (TXT-05). The business name is typed into the bytes, never a token, so a
 * later rename cannot change attested text.
 *
 * ── ATTEST RE-VALIDATES ─────────────────────────────────────────────────────
 *
 * The stored body is checked again against the tenant's CURRENT name before it
 * is stamped. A version saved under an old name no longer identifies the
 * sender (the Spam Act rule), and attesting it would put a wording on the send
 * path that `sendTextBack`'s own re-check then refuses as `no_template` — a
 * silent dead switch. Refusing here tells the operator to save it again.
 */
import { forTenant } from '@/db/repository';
import type { TextBackVariant } from '@/db/schema';

import { validateTextBackTemplate, type TextBackTemplateViolation } from './template';

/** The longest attestation note accepted — the drafting attestation's cap. */
export const TEXT_BACK_ATTESTATION_NOTE_MAX = 500;

export type SaveTextBackTemplateResult =
  | { kind: 'saved'; version: number; segments: number }
  | { kind: 'invalid'; violations: TextBackTemplateViolation[] }
  /** Byte-identical to the newest version of this variant: nothing minted. */
  | { kind: 'unchanged' }
  | { kind: 'tenant_missing' };

export type AttestTextBackTemplateResult =
  | { kind: 'attested'; variant: TextBackVariant; version: number }
  | { kind: 'note_required' }
  | { kind: 'note_too_long' }
  | { kind: 'not_found' }
  | { kind: 'already_attested' }
  /** The stored body fails a rule today — usually a renamed business. */
  | { kind: 'invalid'; violations: TextBackTemplateViolation[] }
  | { kind: 'tenant_missing' };

async function readTenantName(tenantId: string): Promise<string | null> {
  const [tenant] = await forTenant(tenantId).tenant.get();
  return tenant ? tenant.name : null;
}

/**
 * Save a new UNATTESTED version of one variant.
 *
 * `operatorUserId` comes from `requireOperatorId()` — never a form field.
 *
 * ── THE NO-CHANGE REFUSAL ───────────────────────────────────────────────────
 *
 * A resubmission whose normalised bytes equal the newest version's stored
 * bytes mints nothing. An unattested copy of an ATTESTED wording would put a
 * "saved, not attested" line over a wording that is in use, inviting a second
 * attestation of text that is already live.
 */
export async function saveTextBackTemplate(
  tenantId: string,
  input: { variant: TextBackVariant; body: string; operatorUserId: string },
): Promise<SaveTextBackTemplateResult> {
  const businessName = await readTenantName(tenantId);
  if (businessName === null) return { kind: 'tenant_missing' };

  const checked = validateTextBackTemplate(input.body, {
    businessName,
    variant: input.variant,
  });
  if (!checked.ok) return { kind: 'invalid', violations: checked.violations };

  const repo = forTenant(tenantId);

  const [latest] = await repo.textBackTemplates.latestForVariant(input.variant);
  if (latest && latest.body === checked.normalizedBody) return { kind: 'unchanged' };

  const [created] = await repo.textBackTemplates.insertVersion({
    variant: input.variant,
    body: checked.normalizedBody,
    segments: checked.segments,
    createdBy: input.operatorUserId,
  });

  // The INSERT has no conflict clause: a concurrent save that loses the
  // version race raises 23505 rather than returning nothing. An empty return is
  // therefore not an outcome this function can describe — the caller's catch
  // turns it into its fixed failure sentence.
  if (!created) throw new Error('text-back template insert returned no row');

  return { kind: 'saved', version: created.version, segments: created.segments };
}

/**
 * Attest ONE saved version: the write-once stamp of who, when and what they
 * checked (D-02). The note is required and bounded BEFORE anything is read.
 */
export async function attestTextBackTemplate(
  tenantId: string,
  input: { versionId: string; note: string; operatorUserId: string; now: Date },
): Promise<AttestTextBackTemplateResult> {
  const note = input.note.trim();
  if (note === '') return { kind: 'note_required' };
  if (note.length > TEXT_BACK_ATTESTATION_NOTE_MAX) return { kind: 'note_too_long' };

  const businessName = await readTenantName(tenantId);
  if (businessName === null) return { kind: 'tenant_missing' };

  const repo = forTenant(tenantId);

  // Scoped to this tenant: another client's version id reads as absent.
  const [version] = await repo.textBackTemplates.byId(input.versionId);
  if (!version) return { kind: 'not_found' };

  // Already attested is the more truthful answer than any re-validation
  // finding — the stamp exists and is evidence, and it is not this call's to
  // judge again.
  if (version.attestedAt !== null) return { kind: 'already_attested' };

  const variant = version.variant as TextBackVariant;
  const checked = validateTextBackTemplate(version.body, { businessName, variant });
  if (!checked.ok) return { kind: 'invalid', violations: checked.violations };

  const [stamped] = await repo.textBackTemplates.attestWhereUnattested(
    version.id,
    note,
    input.operatorUserId,
    input.now,
  );
  // Zero rows: a colleague (or a double tap) attested it between the read and
  // the guarded UPDATE. The stamp that exists is theirs, and it stands.
  if (!stamped) return { kind: 'already_attested' };

  return { kind: 'attested', variant, version: stamped.version };
}
