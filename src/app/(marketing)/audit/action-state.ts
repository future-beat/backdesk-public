/**
 * Blank initial state for the public audit form.
 *
 * Lives outside `actions.ts` because a `'use server'` module may export only
 * async functions — a const export is stripped or invalid under the use-server
 * loader (`invalid-use-server-value`), which reached the console's own form as
 * `undefined` and crashed on `state.values`. `tests/lint-ban.test.ts` enforces
 * the rule; this file is what obeying it looks like.
 *
 * ── WHY THE FIELD NAMES ARE WRITTEN OUT RATHER THAN DERIVED ─────────────────
 *
 * This module is imported by the CLIENT component, so every runtime import it
 * makes is shipped to a phone. Building the blank record from
 * `AUDIT_REQUEST_FIELDS` would mean a value import of `@/core/intake/audit-request`,
 * which imports `@/db/schema` for the closed vocabularies — and that puts
 * drizzle's `pg-core` (measured: ~97 KiB) into the browser bundle of a page
 * whose whole job is to load fast on 4G (LAND-06).
 *
 * The totality guarantee is not lost, it moves to the compiler: the literal
 * below is annotated `Record<AuditRequestField, string>`, so a field added to
 * the form without a blank value here is a typecheck error rather than an
 * `undefined` reaching `defaultValue`. `import type` is erased entirely, so the
 * type costs the browser nothing.
 */
import type { AuditRequestField } from '@/core/intake/audit-request';

/**
 * Every control that can carry a message, which is the seven zod fields PLUS
 * the optional attachment.
 *
 * `csv_file` is an ERROR key and not a VALUE key, and that asymmetry is the
 * browser's rule rather than a choice: a server cannot re-populate a file
 * input, so the attachment is the one thing a rejection genuinely loses. The
 * form says so in words (`AUDIT_FORM_COPY.csvReattach`) instead of pretending
 * otherwise.
 */
export type AuditErrorField = AuditRequestField | 'csv_file';

export type AuditRequestState = {
  /** Message under each failing control. Every failure at once (UI-SPEC E7). */
  errors: Partial<Record<AuditErrorField, string>>;
  /** A failure belonging to no single control. */
  formError: string | null;
  /**
   * The prospect's input, echoed back so a rejection does not cost their
   * typing — on a phone, with a keyboard covering half the form, that is the
   * difference between a second attempt and an abandoned one.
   */
  values: Record<AuditRequestField, string>;
};

/** Every field empty. Exhaustive by annotation — see the header. */
export const BLANK_AUDIT_REQUEST_VALUES: Record<AuditRequestField, string> = {
  business_name: '',
  contact_name: '',
  phone: '',
  email: '',
  trade: '',
  servicem8: '',
  quotes_per_month: '',
};

export const BLANK_AUDIT_REQUEST_STATE: AuditRequestState = {
  errors: {},
  formError: null,
  values: BLANK_AUDIT_REQUEST_VALUES,
};
