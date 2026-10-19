/**
 * The public audit-request form, as a schema (Phase 9, LAND-02, D-10).
 *
 * PURE and framework-free: no `next/*`, no repository, no environment. It takes
 * seven strings off a `FormData` and answers with either a normalised record or
 * every failing field at once. That is the whole trust boundary for the one
 * unauthenticated write path in the product, which is why it lives here rather
 * than inside the action — a boundary that can only be exercised through a
 * server action is a boundary that can only be tested through one.
 *
 * ── EVERY MESSAGE IS THE UI-SPEC'S, VERBATIM ────────────────────────────────
 *
 * The strings below are the Copywriting Contract rows for the audit form, not
 * paraphrases. A prospect reads them on a phone with no other help available;
 * "Invalid input" is not a sentence anybody can act on. `tests/audit-request-
 * schema.test.ts` pins each one by value, so a well-meaning rewording is a test
 * failure rather than a silent change to what a stranger reads.
 *
 * ── THE NORMALISERS ARE BORROWED, NOT RE-SPELLED ────────────────────────────
 *
 * `normalizeAuMobile` and `normalizeEmail` are the cadence path's own, and the
 * number stored here must be the same shape the cadence path would produce: the
 * operator texts this person back, and a second spelling of "an Australian
 * mobile" is a number that works in one place and not the other.
 *
 * ── LENGTHS ARE COUNTED IN CODE POINTS ──────────────────────────────────────
 *
 * zod's `.max()` on a string counts UTF-16 units, which is the same as code
 * points for everything a Perth trade business is called, and the caps here
 * (120 / 80) are far above any real name — so the encoding edge that matters is
 * not truncation but SURVIVAL: `Zoë's Électrique` must be stored and rendered
 * exactly as typed. THE SCHEMA normalises, transliterates and strips nothing.
 *
 * `stripControlCharacters` below is not an exception to that. It is never
 * applied on the way IN — the row keeps what the prospect typed — only by a
 * caller that is about to interpolate the value into a mail header, a
 * plain-text body or an SMS, where a `\r\n` stops being a character and starts
 * being structure (T-9-08). See its own docstring.
 */
import { z } from 'zod';

import { normalizeAuMobile, normalizeEmail } from '@/core/cadence/primary-contact';
import { AUDIT_REQUEST_BANDS, AUDIT_REQUEST_TRADES } from '@/db/schema';

/**
 * RE-EXPORTED, not re-declared. The form, the operator email, the SMS and the
 * console list all need the same nine trades and four bands, and the ONE
 * definition of them is the schema's — where the CHECK constraint that enforces
 * them also lives. A second tuple here would be a vocabulary that could drift
 * from the constraint, which is a `23514` in production and nowhere else.
 */
export { AUDIT_REQUEST_BANDS, AUDIT_REQUEST_TRADES };

/**
 * The form's own field names, in D-10 order. The `name` attributes, the state's
 * `values` keys and the error keys are all this list — one spelling, so a
 * renamed input cannot silently stop echoing its value back.
 */
export const AUDIT_REQUEST_FIELDS = [
  'business_name',
  'contact_name',
  'phone',
  'email',
  'trade',
  'servicem8',
  'quotes_per_month',
] as const;
export type AuditRequestField = (typeof AUDIT_REQUEST_FIELDS)[number];

/** What a human reads for each trade — shared by the form, the email and 09-09. */
export const TRADE_LABELS: Readonly<Record<(typeof AUDIT_REQUEST_TRADES)[number], string>> = {
  electrical: 'Electrical',
  plumbing: 'Plumbing',
  hvac: 'HVAC',
  solar: 'Solar',
  patios_outdoor: 'Patios and outdoor',
  painting: 'Painting',
  landscaping: 'Landscaping',
  small_builder: 'Small builder',
  other: 'Other',
};

/** The four bands, as the select renders them (D-10). */
export const BAND_LABELS: Readonly<Record<(typeof AUDIT_REQUEST_BANDS)[number], string>> = {
  lt8: 'Fewer than 8',
  '8_15': '8–15',
  '16_30': '16–30',
  gt30: 'More than 30',
};

const BUSINESS_NAME_MAX = 120;
const CONTACT_NAME_MAX = 80;

export const auditRequestSchema = z.object({
  business_name: z
    .string()
    .trim()
    .min(1, 'Enter your business name.')
    // The cap is a storage bound, not a judgement about names, so the message
    // does not scold: it says what to do.
    .max(BUSINESS_NAME_MAX, 'That name is too long.'),
  contact_name: z
    .string()
    .trim()
    .min(1, 'Enter your name.')
    .max(CONTACT_NAME_MAX, 'That name is too long.'),
  // TRANSFORM THEN REFINE, not regex-then-store: what reaches the database is
  // the E.164 form, so the operator's reply goes to the same number the
  // cadence path would have produced.
  phone: z
    .string()
    .transform((raw) => normalizeAuMobile(raw))
    .refine((value): value is string => value !== null, {
      message: 'Enter an Australian mobile number, like 0412 345 678.',
    }),
  email: z
    .string()
    .transform((raw) => normalizeEmail(raw))
    .refine((value): value is string => value !== null, {
      message: 'Enter an email address we can reply to.',
    }),
  trade: z.enum(AUDIT_REQUEST_TRADES, { message: 'Choose the closest trade.' }),
  // Two radios, so the wire format is a string and the column is a boolean. The
  // conversion happens once, here, rather than in the action.
  servicem8: z
    .enum(['yes', 'no'], { message: "Tell us whether you're on ServiceM8." })
    .transform((value) => value === 'yes'),
  quotes_per_month: z.enum(AUDIT_REQUEST_BANDS, {
    message: 'Choose a rough number of quotes a month.',
  }),
});

export type AuditRequestInput = z.infer<typeof auditRequestSchema>;

/**
 * Remove carriage returns, newlines and every other C0/C1 control character
 * from a value that came off the public form (T-9-08, WR-02, WR-04).
 *
 * ── WHY IT LIVES HERE AND NOT IN A NOTIFIER ─────────────────────────────────
 *
 * It used to be private to `operator-email.ts`, which meant the email body had
 * the rule, the email SUBJECT did not (WR-02), and the SMS did not either
 * (WR-04) — three answers to one question, in two files, none of them wrong on
 * purpose. This module is where a stranger's strings become values the rest of
 * the system may use, so this is where the rule about their SHAPE belongs. Both
 * notifiers import it; neither re-spells it.
 *
 * ── WHAT IT IS FOR ──────────────────────────────────────────────────────────
 *
 * The schema above deliberately does not normalise, transliterate or strip a
 * business name: `Zoë's Électrique` must be STORED exactly as typed. That is a
 * decision about the database. A `\r\n` inside that same name is a different
 * thing entirely once the value is interpolated into a mail header, a
 * plain-text body or an SMS — it is how a form field becomes a forged header,
 * a fabricated second fact, or a line break that pushes the operator's callback
 * number off the visible part of a notification. zod bounds the LENGTH; this
 * bounds the SHAPE, and only at the point of interpolation.
 *
 * REMOVED, never replaced with a marker: the operator reads the name, not an
 * escape sequence.
 */
export function stripControlCharacters(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
}

/**
 * EVERY failing field, keyed by its form name.
 *
 * All of them at once, deliberately (UI-SPEC E7 "partial"): a form that reveals
 * one problem per submit is a form somebody abandons on the third round trip,
 * and this one is filled in on a phone by a person who owes us nothing.
 *
 * Keyed on `issue.path[0]` and filtered against the known field list, so an
 * issue from a nested or unexpected path cannot write an arbitrary key into an
 * object that is spread into JSX.
 */
export function toAuditFieldErrors(error: z.ZodError): Partial<Record<AuditRequestField, string>> {
  const errors: Partial<Record<AuditRequestField, string>> = {};

  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field !== 'string') continue;
    if (!(AUDIT_REQUEST_FIELDS as readonly string[]).includes(field)) continue;
    const key = field as AuditRequestField;
    // FIRST issue per field wins: a value can fail two refinements (empty and
    // malformed), and the earlier rule is the one that describes what to do.
    if (errors[key] === undefined) errors[key] = issue.message;
  }

  return errors;
}
