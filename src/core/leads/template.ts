/**
 * THE TEXT-BACK WORDING — defaults and the validator (Phase 12, D-02/D-03/D-23).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ NO MODEL, NO MERGE-FILL, NO LINK BUT THE POINTER. The bytes a caller      │
 * │ receives are the bytes an operator attested, verbatim. A template is     │
 * │ stored as its FINAL literal text with the business name typed in — a     │
 * │ `{business}` token would let a later rename change attested bytes — so a │
 * │ curly brace anywhere is a refusal, not something to fill.                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `validateTextBackTemplate` runs at SAVE (the console, a later plan) and
 * AGAIN AT SEND inside `sendTextBack`, where a refusal is recorded as
 * `no_template` and nothing is sent. Its closed rule set:
 *
 *   empty                   — nothing but whitespace
 *   not_gsm7                — a character outside GSM 03.38 survives
 *                             `normalizeForGsm7`: a UCS-2 text halves the
 *                             segment size, so it is refused to be REWRITTEN,
 *                             never shortened or transliterated behind the
 *                             operator's back
 *   too_many_segments       — more than TEXT_BACK_MAX_SEGMENTS segments
 *   missing_identity        — the client's business name is absent (the Spam
 *                             Act sender identification, met in copy because
 *                             the number is shared)
 *   missing_stop            — no "Reply STOP" (the functional opt-out)
 *   missing_privacy_pointer — no plain-text `backdesk.com.au/privacy` (D-11)
 *   extra_link              — any other link-shaped text (D-02/D-03)
 *   merge_token_left        — a `{` or `}` anywhere
 *
 * Measured AFTER `normalizeForGsm7` with the shared `countSeptets` /
 * `segmentCount` — the counters every other SMS in the product is measured
 * with. No budget is typed as a number here: the 306-septet edge of two
 * segments is whatever the counter says it is.
 */
import { countSeptets, normalizeForGsm7, segmentCount } from '@/core/drafting/gsm7';
import { LINK_PATTERN } from '@/core/shared/link-pattern';
import type { TextBackVariant } from '@/db/schema';

/** The plain-text privacy pointer every text-back carries (D-03, D-11). */
export const TEXT_BACK_PRIVACY_POINTER = 'backdesk.com.au/privacy';

/** At most two GSM-7 segments (D-02). */
export const TEXT_BACK_MAX_SEGMENTS = 2;

/** The closed vocabulary of reasons a wording is refused. */
export const TEXT_BACK_TEMPLATE_RULES = [
  'empty',
  'not_gsm7',
  'too_many_segments',
  'missing_identity',
  'missing_stop',
  'missing_privacy_pointer',
  'extra_link',
  'merge_token_left',
] as const;
export type TextBackTemplateRule = (typeof TEXT_BACK_TEMPLATE_RULES)[number];

export interface TextBackTemplateViolation {
  rule: TextBackTemplateRule;
  /** A count or a character list — never the body. */
  detail?: string;
}

export type TextBackTemplateResult =
  | { ok: true; segments: number; normalizedBody: string }
  | { ok: false; violations: TextBackTemplateViolation[] };

/**
 * The default wordings (D-03 verbatim for business hours; D-23's proposals
 * for after hours and about-a-quote). STARTING POINTS for the operator, never
 * sent unseen: each client's set is attested before arming.
 *
 * Every fixed character below is in the GSM-7 basic alphabet (a straight
 * apostrophe, no dash, no ellipsis), so a default can only fail the counter
 * through the length of the business name.
 */
export function defaultTextBackBody(variant: TextBackVariant, businessName: string): string {
  const name = businessName.trim();
  const tail = `Reply STOP to opt out. Privacy: ${TEXT_BACK_PRIVACY_POINTER}`;

  switch (variant) {
    case 'business_hours':
      return (
        `Hi, it's ${name}. Sorry we missed your call. ` +
        `What do you need a hand with, and which suburb? ` +
        `Reply here and we'll get back to you. ${tail}`
      );
    case 'after_hours':
      return (
        `Hi, it's ${name}. Sorry we missed your call. ` +
        `What do you need a hand with, and which suburb? ` +
        `Reply here and we'll get back to you. ` +
        `We read replies in the morning unless it's urgent. ${tail}`
      );
    case 'about_quote':
      return (
        `Hi, it's ${name}. Sorry we missed your call. Is it about your quote? ` +
        `Reply here and we'll get back to you. ${tail}`
      );
  }
}

/** "Reply STOP", as words — not `ReplySTOP`, not `Reply STOPPED`. */
const STOP_PATTERN = /\bReply STOP\b/i;

/*
 * Link-shaped text is `LINK_PATTERN` from `@/core/shared/link-pattern` — one
 * spelling shared with the lead-draft validator's link rule (13-REVIEW WR-02).
 * Run here on the body with every copy of the privacy pointer removed, so the
 * pointer itself is the only link a text-back can carry.
 */

/**
 * Validate one wording for one client. See the header for the rule set.
 *
 * `variant` is accepted so every caller states which wording it validated;
 * the rules are the same for all three today.
 */
export function validateTextBackTemplate(
  body: string,
  options: { businessName: string; variant: TextBackVariant },
): TextBackTemplateResult {
  const normalizedBody = normalizeForGsm7(body);
  const violations: TextBackTemplateViolation[] = [];

  if (normalizedBody.trim() === '') {
    return { ok: false, violations: [{ rule: 'empty' }] };
  }

  const counted = countSeptets(normalizedBody);
  let segments = 0;
  if (counted.encoding === 'ucs2') {
    violations.push({ rule: 'not_gsm7', detail: counted.unsupported.join('') });
  } else {
    segments = segmentCount(counted.septets);
    if (segments > TEXT_BACK_MAX_SEGMENTS) {
      violations.push({ rule: 'too_many_segments', detail: String(segments) });
    }
  }

  // The name is normalized the same way as the body, so "Dave’s" (curly) on
  // the tenant row still identifies a body the save path stored as "Dave's".
  const name = normalizeForGsm7(options.businessName).trim().toLowerCase();
  if (name === '' || !normalizedBody.toLowerCase().includes(name)) {
    violations.push({ rule: 'missing_identity' });
  }

  if (!STOP_PATTERN.test(normalizedBody)) violations.push({ rule: 'missing_stop' });

  if (!normalizedBody.includes(TEXT_BACK_PRIVACY_POINTER)) {
    violations.push({ rule: 'missing_privacy_pointer' });
  }

  if (LINK_PATTERN.test(normalizedBody.split(TEXT_BACK_PRIVACY_POINTER).join(' '))) {
    violations.push({ rule: 'extra_link' });
  }

  if (/[{}]/.test(normalizedBody)) violations.push({ rule: 'merge_token_left' });

  return violations.length > 0 ? { ok: false, violations } : { ok: true, segments, normalizedBody };
}
