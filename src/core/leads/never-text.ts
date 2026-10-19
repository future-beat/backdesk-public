/**
 * THE NEVER-TEXT LIST, AS THE OPERATOR EDITS IT (Phase 12, D-06, IN-07).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE CLIENT'S OWN LINES ARE THE FAIL-SAFE AGAINST A SUBSTITUTED CALLER ID.│
 * │ A carrier may present the DIVERTING line as the caller; if that line is  │
 * │ on this list, the gate refuses `own_number` before anything else could   │
 * │ pass. So an armed client must never be left with an empty own-line list, │
 * │ and a number stored in a second spelling is a number the gate never      │
 * │ matches.                                                                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ONE NORMALISER. `classifyCaller` is the function the capture path stores
 * `caller_e164` with, so an own line entered here is spelled exactly as the
 * same line would be spelled arriving as a caller. Only `mobile` and
 * `other_number` results in the Australian shape are kept; withheld sentinels,
 * international numbers and anything unparseable are refused.
 *
 * NO NUMBER IS EVER LOGGED OR RETURNED. A refused number is described by rule
 * ("not an Australian mobile or landline"), never repeated back — the results
 * below carry kinds and ids only.
 *
 * FRAMEWORK-FREE: the console action authorizes, parses and maps kinds to copy.
 */
import { classifyCaller } from '@/core/telephony/caller';
import { forTenant, isTextBackArmed } from '@/db/repository';
import type { NeverTextKind } from '@/db/schema';

/** The label column's CHECK (`tenant_never_text_label_length`). */
export const NEVER_TEXT_LABEL_MAX = 60;

/**
 * An Australian geographic landline (`+612/3/7/8…`) or mobile (`+614…`): the
 * column CHECK's `^[+]61[0-9]{9}$`, narrowed to the leading digits that are
 * real Australian lines — a `+615…` or `+611…` is not a number a client owns.
 */
const AU_LINE = /^\+61[23478]\d{8}$/;

/**
 * Separators a person types between digit groups. Stripped before
 * `classifyCaller` sees the value, because its E.164 rule reads the string as
 * given and `+61 8 9123 4567` is as much the office line as `+61891234567`.
 */
const SEPARATORS = /[\s().-]/g;

export type AddNeverTextResult =
  | { kind: 'added'; id: string }
  | { kind: 'already_listed' }
  | { kind: 'invalid_number' }
  | { kind: 'invalid_label' };

export type RemoveNeverTextResult =
  | { kind: 'removed' }
  | { kind: 'not_found' }
  | { kind: 'last_own_line_while_armed' };

/** An entered number → `+61…`, or `null` when it is not an Australian line. */
export function normalizeNeverTextInput(raw: string): string | null {
  const classified = classifyCaller(raw.replace(SEPARATORS, ''));
  if (classified.kind === 'withheld') return null;
  return AU_LINE.test(classified.e164) ? classified.e164 : null;
}

/**
 * Add one number. A repeat — in any spelling — is `already_listed`, which the
 * targeted `ON CONFLICT DO NOTHING` answers with zero rows; the first entry's
 * kind and label stand.
 */
export async function addNeverTextNumber(
  tenantId: string,
  input: { input: string; kind: NeverTextKind; label: string | null; operatorUserId: string },
): Promise<AddNeverTextResult> {
  const numberE164 = normalizeNeverTextInput(input.input);
  if (numberE164 === null) return { kind: 'invalid_number' };

  const trimmed = input.label?.trim() ?? '';
  if (trimmed.length > NEVER_TEXT_LABEL_MAX) return { kind: 'invalid_label' };

  const [created] = await forTenant(tenantId).neverText.add({
    numberE164,
    kind: input.kind,
    // A blank label is no label — never a stored empty string.
    label: trimmed === '' ? null : trimmed,
    createdBy: input.operatorUserId,
  });

  return created ? { kind: 'added', id: created.id } : { kind: 'already_listed' };
}

/**
 * Remove one entry by id.
 *
 * THE IN-07 GUARD: when the target is an `own_line` row, it is the only one,
 * and this client's text-back is armed, the removal is refused — disarm first.
 * The arming read is made only when it can matter. (Two concurrent removals of
 * an armed client's last two own lines could each see the other still
 * present; the operator is one person and the gate also compares the
 * escalation phone, the divert number and ForwardedFrom independently, so the
 * guard is a check, not a lock.)
 */
export async function removeNeverTextNumber(
  tenantId: string,
  id: string,
): Promise<RemoveNeverTextResult> {
  const repo = forTenant(tenantId);

  // Tenant-scoped: another client's id is simply not in this list.
  const target = (await repo.neverText.list()).find((row) => row.id === id);
  if (!target) return { kind: 'not_found' };

  if (target.kind === 'own_line') {
    const ownLines = await repo.neverText.countOwnLines();
    if (ownLines <= 1 && (await isTextBackArmed(tenantId))) {
      return { kind: 'last_own_line_while_armed' };
    }
  }

  const removed = await repo.neverText.remove(id);
  return removed.length > 0 ? { kind: 'removed' } : { kind: 'not_found' };
}
