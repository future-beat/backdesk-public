/**
 * Action state + every sentence the text-back page can say (Phase 12, D-02,
 * D-06, IN-07).
 *
 * OUTSIDE `actions.ts` because a `'use server'` module may export only async
 * functions — the `drafting/action-state.ts` split, for the same reason.
 *
 * A CLIENT-REACHABLE LEAF. `forms.tsx` is `'use client'` and imports this
 * module, so nothing here may import a value from `@/db/*` or from a core
 * module that reaches the repository (`tests/lint-ban.test.ts` pins it). The
 * variant and kind vocabularies are spelled as labels here; the actions own the
 * validation against the real vocabularies.
 *
 * NO SENTENCE CARRIES A NUMBER THE OPERATOR TYPED. A refused number is
 * described by rule ("an Australian mobile or landline"), never repeated, and a
 * caught repository error becomes one fixed sentence (T-12-07, T-12-11).
 */
import type { TextBackTemplateRule } from '@/core/leads/template';
import type { TextBackVariant } from '@/db/schema';

export type TextBackState = {
  /** A fixed sentence the operator can act on. Never a database message. */
  error: string | null;
  success: string | null;
};

export const BLANK_TEXT_BACK_STATE: TextBackState = { error: null, success: null };

/* ------------------------------------------------------------------------- *
 * Limits the forms show and the actions enforce
 * ------------------------------------------------------------------------- */

/**
 * A hard bound on what the wording field accepts at all. Two GSM-7 segments are
 * 306 septets, so anything near this is refused by the validator anyway — this
 * only stops an arbitrarily large body reaching it.
 */
export const TEXT_BACK_BODY_FIELD_MAX = 1000;

/** The attestation note's cap — the core enforces it after trimming. */
export const TEXT_BACK_NOTE_MAX = 500;

/** The never-text label column's CHECK. */
export const NEVER_TEXT_LABEL_FIELD_MAX = 60;

/** Long enough for `+61 (08) 9123 4567` with room for stray spacing. */
export const NEVER_TEXT_NUMBER_FIELD_MAX = 32;

/* ------------------------------------------------------------------------- *
 * Labels
 * ------------------------------------------------------------------------- */

export const TEXT_BACK_VARIANT_LABEL: Readonly<Record<TextBackVariant, string>> = {
  business_hours: 'Business hours',
  after_hours: 'After hours',
  about_quote: 'About your quote',
};

export const NEVER_TEXT_KIND_LABEL: Readonly<Record<'own_line' | 'never_text', string>> = {
  own_line: 'Client’s own line',
  never_text: 'Never text',
};

/* ------------------------------------------------------------------------- *
 * Refusals shared by every action
 * ------------------------------------------------------------------------- */

/**
 * The same sentence for "no such client" and "not your client" — the response
 * must not be a membership oracle over tenant uuids.
 */
export const UNKNOWN_CLIENT_MESSAGE = 'That client could not be found.';

export const BAD_REQUEST_MESSAGE = 'Check the details and try again.';

/** A caught repository error, whatever it was. The detail is never shown. */
export const TEXT_BACK_WRITE_FAILED_MESSAGE = 'Could not save that. Try again in a moment.';

/* ------------------------------------------------------------------------- *
 * Templates — one sentence per validator rule (TXT-05)
 * ------------------------------------------------------------------------- */

export const TEMPLATE_RULE_MESSAGE = {
  empty: 'Write the wording first — it is empty.',
  not_gsm7:
    'The wording has a character a plain text cannot carry (an emoji, an accented letter or a special symbol). Rewrite it without — nothing is replaced for you.',
  too_many_segments: 'The wording is longer than 2 text segments. Shorten it.',
  missing_identity:
    'Name the business in the wording, exactly as it is spelled on this client — the caller must know who is texting.',
  missing_stop: 'Include “Reply STOP” — the caller must be able to opt out.',
  missing_privacy_pointer: 'Include backdesk.com.au/privacy as plain text.',
  extra_link: 'Remove the link — backdesk.com.au/privacy is the only link a text-back may carry.',
  merge_token_left:
    'Remove the { } placeholder and type the actual words — nothing is filled in when it sends.',
} as const satisfies Record<TextBackTemplateRule, string>;

export type TemplateRuleKey = keyof typeof TEMPLATE_RULE_MESSAGE;

/** Every refusal reason, one sentence each, in the validator's order. */
export function templateRefusalMessage(rules: readonly TemplateRuleKey[]): string {
  return [...new Set(rules)].map((rule) => TEMPLATE_RULE_MESSAGE[rule]).join(' ');
}

export const TEMPLATE_BODY_TOO_LONG_MESSAGE = 'That wording is far too long for a text. Shorten it.';

export const TEMPLATE_UNCHANGED_MESSAGE = 'That is the wording already saved — nothing changed.';

export function templateSavedMessage(version: number, segments: number): string {
  return `Saved as version ${version} — ${segments} segment${segments === 1 ? '' : 's'}. Not in use until you attest it.`;
}

/* ------------------------------------------------------------------------- *
 * Attestation (D-02)
 * ------------------------------------------------------------------------- */

export const TEMPLATE_ATTESTED_MESSAGE = 'Attested. This is the wording callers will receive.';

export const ATTEST_NOTE_REQUIRED_MESSAGE =
  'Write how this wording was checked and approved — the note is the record.';

export const ATTEST_NOTE_TOO_LONG_MESSAGE = 'Keep the note to 500 characters.';

export const TEMPLATE_ALREADY_ATTESTED_MESSAGE = 'That version is already attested.';

export const TEMPLATE_RENAMED_MESSAGE =
  'Save the wording again — the business name has changed since this version.';

export const TEMPLATE_VERSION_NOT_FOUND_MESSAGE = 'That version could not be found.';

/**
 * A saved version that no longer passes. Almost always a renamed business; any
 * other rule is named so the operator knows what to change before saving again.
 */
export function attestInvalidMessage(rules: readonly TemplateRuleKey[]): string {
  if (rules.includes('missing_identity')) return TEMPLATE_RENAMED_MESSAGE;
  return `Save the wording again — this version no longer passes. ${templateRefusalMessage(rules)}`;
}

/* ------------------------------------------------------------------------- *
 * The never-text list (D-06, IN-07)
 * ------------------------------------------------------------------------- */

export const NEVER_TEXT_ADDED_MESSAGE = 'Added.';

export const NEVER_TEXT_ALREADY_LISTED_MESSAGE = 'That number is already on the list.';

export const NEVER_TEXT_INVALID_NUMBER_MESSAGE = 'Enter an Australian mobile or landline number.';

export const NEVER_TEXT_LABEL_TOO_LONG_MESSAGE = 'Keep the label to 60 characters.';

export const NEVER_TEXT_REMOVED_MESSAGE = 'Removed.';

export const NEVER_TEXT_NOT_FOUND_MESSAGE = 'That entry is no longer on the list.';

export const NEVER_TEXT_LAST_OWN_LINE_MESSAGE =
  'Disarm text-back first — an armed client must keep at least one own line on this list.';
