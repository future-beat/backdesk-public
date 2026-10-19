/**
 * Tenant creation — the single validation authority (ONB-01).
 *
 * `src/core` is framework-free by contract: nothing here imports from `next/*`,
 * so this schema is reachable from a server action, a future API route, a CLI
 * import job, and a unit test alike. That matters because validation here is a
 * mechanism, not a habit — the timezone and contact-hours window captured on
 * this form are the inputs to the DNCR contact-hours discipline every later
 * send obeys. A window that is wrong here is a compliance breach three phases
 * from now, so the rules live in one place that the form cannot bypass.
 *
 * Deliberately absent: any default contact-hours window or day set. An
 * operator who never thinks about contact hours must not silently inherit a
 * 24/7 one.
 */
import { z } from 'zod';

/** Matches the practical bound on a business name; keeps stored text sane. */
export const TENANT_NAME_MAX_LENGTH = 120;
export const TRADE_TYPE_MAX_LENGTH = 80;

/** 24-hour HH:MM, optionally with the seconds Postgres round-trips. */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/** AU mobile: national 04xxxxxxxx or E.164 +614xxxxxxxx. Landlines are not SMS-reachable. */
const AU_MOBILE_PATTERN = /^(?:04\d{8}|\+614\d{8})$/;

/** Separators an operator actually types: "0412 345 678", "(04) 1234-5678". */
const PHONE_SEPARATORS = /[\s().-]/g;

const DAY_RANGE_MESSAGE = 'Contact days must be weekdays 1 (Monday) to 7 (Sunday).';
const DAYS_REQUIRED_MESSAGE = 'Choose at least one contact day.';

/** ISO weekday number (1 = Monday) to a short label; index 0 is unused padding. */
export const CONTACT_DAY_LABELS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

let cachedZones: Set<string> | null | undefined;

/**
 * The IANA zones this runtime actually knows about.
 *
 * Read from the runtime rather than hardcoded, so the accepted set tracks the
 * tzdata the server ships with. `null` means the runtime does not expose the
 * list at all, which is the only case where the weaker formatter probe is used.
 */
function knownTimeZones(): Set<string> | null {
  if (cachedZones !== undefined) return cachedZones;
  const values = Intl.supportedValuesOf?.('timeZone') ?? [];
  cachedZones = values.length > 0 ? new Set(values) : null;
  return cachedZones;
}

export function isSupportedTimeZone(value: string): boolean {
  const zones = knownTimeZones();
  if (zones) return zones.has(value);
  try {
    new Intl.DateTimeFormat('en-AU', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** A required 24-hour time field, normalised down to HH:MM. */
function timeField(label: string) {
  return z
    .string({ error: `${label} is required.` })
    .trim()
    .regex(TIME_PATTERN, `${label} must be a 24-hour time such as 08:00.`)
    .transform((value) => value.slice(0, 5));
}

const contactDay = z.coerce
  .number({ error: DAY_RANGE_MESSAGE })
  .int(DAY_RANGE_MESSAGE)
  .min(1, DAY_RANGE_MESSAGE)
  .max(7, DAY_RANGE_MESSAGE);

/** Blank, missing or separator-only input all mean "no escalation phone". */
function normalisePhone(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const compact = value.replace(PHONE_SEPARATORS, '');
  return compact === '' ? null : compact;
}

export const ESCALATION_PHONE_MESSAGE =
  'Escalation phone must be an Australian mobile, such as 0412 345 678.';

/**
 * THE ESCALATION NUMBER'S ONE VALIDATION PATH (CON-03).
 *
 * Extracted from `tenantCreateSchema` — where it still lives, as this same
 * object — because 06-06 made the number EDITABLE after creation and the edit
 * must go through the identical rule. A second spelling of an AU mobile pattern
 * is the CR-01 defect on the field that decides which handset gets a hot lead.
 *
 * ── IT REFUSES; IT NEVER REPAIRS ────────────────────────────────────────────
 *
 * `normalisePhone` strips only the separators a person types — spaces,
 * brackets, dots, dashes. It does not add a leading zero, does not prepend
 * `+61`, and does not drop a digit to make a length work. `412345678` is
 * REFUSED rather than turned into `0412345678`, and that is the Phase 3 rule
 * stated where it is enforced: a repaired digit is a text message to a stranger,
 * and the stranger it reaches is a stranger who then receives a tradie's
 * customer's name and phone number.
 *
 * `null` is a legitimate value in both directions — no number set, and an
 * operator explicitly clearing one. The escalation pass already records
 * `no_escalation_number` honestly, so an absent number is a known state rather
 * than a broken one.
 */
export const escalationPhoneSchema = z
  .union([z.string(), z.null()])
  .optional()
  .transform(normalisePhone)
  .refine((value) => value === null || AU_MOBILE_PATTERN.test(value), {
    message: ESCALATION_PHONE_MESSAGE,
  });

export const tenantCreateSchema = z
  .object({
    name: z
      .string({ error: 'Business name is required.' })
      .trim()
      .min(1, 'Business name is required.')
      .max(
        TENANT_NAME_MAX_LENGTH,
        `Business name must be ${TENANT_NAME_MAX_LENGTH} characters or fewer.`,
      ),

    trade_type: z
      .string({ error: 'Trade type is required.' })
      .trim()
      .min(1, 'Trade type is required.')
      .max(TRADE_TYPE_MAX_LENGTH, `Trade type must be ${TRADE_TYPE_MAX_LENGTH} characters or fewer.`),

    timezone: z
      .string({ error: 'Timezone is required.' })
      .trim()
      .min(1, 'Timezone is required.')
      .superRefine((value, ctx) => {
        if (value.length > 0 && !isSupportedTimeZone(value)) {
          ctx.addIssue({
            code: 'custom',
            // Naming the rejected value is the difference between a fixable
            // error and a support call.
            message: `${value} is not a timezone this server recognises. Choose one from the list.`,
          });
        }
      }),

    contact_hours_start: timeField('Contact hours start'),
    contact_hours_end: timeField('Contact hours end'),

    contact_days: z
      .array(contactDay, { error: DAYS_REQUIRED_MESSAGE })
      .min(1, DAYS_REQUIRED_MESSAGE)
      // Duplicates are an operator slip, not an error worth blocking on; an
      // out-of-range day is a different thing entirely and is rejected above.
      .transform((days) => [...new Set(days)].sort((a, b) => a - b)),

    // THE SAME OBJECT the client page's edit form validates through, so the
    // number a client is created with and the number an operator changes it to
    // cannot be judged by two different rules (06-06).
    escalation_phone: escalationPhoneSchema,
  })
  // HH:MM strings are zero-padded, so lexical order is chronological order.
  // Equal start and end is rejected rather than read as a zero-width or an
  // all-day window: an ambiguous window is exactly what the plan forbids.
  .refine((tenant) => tenant.contact_hours_start < tenant.contact_hours_end, {
    path: ['contact_hours_end'],
    message: 'Contact hours must end after they start.',
  });

export type TenantInput = z.infer<typeof tenantCreateSchema>;

export const TENANT_FIELDS = [
  'name',
  'trade_type',
  'timezone',
  'contact_hours_start',
  'contact_hours_end',
  'contact_days',
  'escalation_phone',
] as const;

export type TenantField = (typeof TENANT_FIELDS)[number];
export type TenantFieldErrors = Partial<Record<TenantField, string>>;

function isTenantField(value: string): value is TenantField {
  return (TENANT_FIELDS as readonly string[]).includes(value);
}

type IssueLike = { readonly path?: ReadonlyArray<PropertyKey>; readonly message: string };

/**
 * Collapse a validation failure into one message per form control.
 *
 * Keyed on `path[0]` so an issue raised against an array element
 * (`['contact_days', 1]`) still lands on the single control the operator can
 * actually fix. Structurally typed rather than taking `z.ZodError` so callers
 * are not forced to thread zod's generics around.
 */
export function toFieldErrors(error: { readonly issues: ReadonlyArray<IssueLike> }): TenantFieldErrors {
  const errors: TenantFieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path?.[0] ?? '');
    if (!isTenantField(key)) continue;
    // First message wins: it is the most specific one for that control.
    if (errors[key] === undefined) errors[key] = issue.message;
  }
  return errors;
}

/**
 * The unique index that makes two clients with the same name impossible.
 *
 * KNOWN LIMITATION (WR-11): the index is global, not scoped to the caller's
 * memberships. With a single operator that is correct and is what makes a double
 * submit produce one client. With a SECOND operator it becomes a cross-tenant
 * existence oracle — operator B is told a name is taken by a row RLS says they
 * cannot see — and it blocks two operators legitimately onboarding two different
 * businesses that share a trading name.
 *
 * Revisit BEFORE provisioning a second operator account. The decision, its
 * trigger condition and the intended `(owner_user_id, lower(name))` fix are
 * recorded in `src/db/migrations/README.md`.
 */
export const DUPLICATE_NAME_INDEX = 'tenants_name_lower_key';
export const DUPLICATE_NAME_MESSAGE = 'A client with that name already exists.';

/**
 * Is this database failure the duplicate-name collision?
 *
 * Checks SQLSTATE first and falls back to the index name, because PostgREST
 * does not always surface `code` for errors raised inside a SECURITY DEFINER
 * function. Anything else must stay a generic failure — claiming "duplicate"
 * for an unrelated fault sends the operator hunting for a client that is not
 * there.
 */
export function isDuplicateNameError(
  error: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (!error) return false;
  if (error.code === '23505') return true;
  return typeof error.message === 'string' && error.message.includes(DUPLICATE_NAME_INDEX);
}

function runLabel(start: number, end: number): string {
  if (start === end) return CONTACT_DAY_LABELS[start];
  // A two-day run reads worse as a range than as a list.
  if (end === start + 1) return `${CONTACT_DAY_LABELS[start]}, ${CONTACT_DAY_LABELS[end]}`;
  return `${CONTACT_DAY_LABELS[start]}–${CONTACT_DAY_LABELS[end]}`;
}

/**
 * Render contact days the way a person would say them: "Mon–Fri", "Mon, Wed,
 * Fri", "Every day". The raw `[1,2,3,4,5]` is unreadable at a glance on a
 * phone, and glancing is the whole point of the detail page.
 */
export function formatContactDays(days: readonly number[] | null | undefined): string {
  if (!days || days.length === 0) return '—';

  const unique = [...new Set(days)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b);
  if (unique.length === 0) return '—';
  if (unique.length === 7) return 'Every day';

  const parts: string[] = [];
  let start = unique[0];
  let previous = unique[0];

  for (const day of unique.slice(1)) {
    if (day === previous + 1) {
      previous = day;
      continue;
    }
    parts.push(runLabel(start, previous));
    start = day;
    previous = day;
  }
  parts.push(runLabel(start, previous));

  return parts.join(', ');
}

/** Postgres returns a `time` column as HH:MM:SS; the seconds are noise here. */
export function formatContactTime(value: string | null | undefined): string {
  if (!value) return '—';
  return value.slice(0, 5);
}

/** The em-dash every "no value here" cell in the console renders. */
export const NO_VALUE = '—';

/**
 * Render an instant in a CLIENT's own timezone.
 *
 * "Created 25 Aug, 4:15 pm" only means anything relative to the business it
 * belongs to, and the operator reads two clients' pages one after the other.
 * Rendering both in the browser's zone would silently compare a Perth business
 * against an Adelaide one on a scale neither of them uses.
 *
 * Lives here, beside the other two display formatters, because the client list
 * and the client detail page now both need it — and a second copy would be a
 * second place for the fallback behaviour to drift.
 *
 * A stored timezone that this runtime does not recognise falls back to a
 * LABELLED UTC render rather than throwing: a row written before the timezone
 * column was validated must not take the whole page down, and an unlabelled
 * wrong-zone time is worse than an honest UTC one.
 */
export function formatInTenantZone(
  value: string | Date | null | undefined,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
): string {
  if (!value) return NO_VALUE;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return NO_VALUE;

  try {
    return new Intl.DateTimeFormat('en-AU', { ...options, timeZone }).format(date);
  } catch {
    return `${new Intl.DateTimeFormat('en-AU', { ...options, timeZone: 'UTC' }).format(date)} UTC`;
  }
}
