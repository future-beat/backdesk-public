/**
 * Action state shapes + blank initial values for the per-client reports page.
 *
 * These live OUTSIDE actions.ts because a `'use server'` module may export only
 * async functions — a const export is a module-evaluation error under Turbopack
 * (nextjs.org/docs/messages/invalid-use-server-value). Types alone would be
 * erased, but the BLANK_* constants are runtime values, so they need a plain
 * module both the server actions and the client form components can import.
 *
 * ── THIS MODULE IMPORTS NOTHING, AND THAT IS LOAD-BEARING ───────────────────
 *
 * `generate-form.tsx` and `fee-schedule-form.tsx` are `'use client'` and import
 * this file. Reaching from here for a constant that lives in a module which
 * touches the repository — `GENERATE_FAILED_MESSAGE`, say, or a fee kind
 * vocabulary — would be a VALUE edge in the browser bundle's module graph and
 * would break `next build` with `Module not found: fs` (06-01/06-02).
 * `tests/lint-ban.test.ts` pins this file for exactly that reason.
 */

/* ------------------------------------------------------------------------- *
 * Generate a monthly report (RPT-02)
 * ------------------------------------------------------------------------- */

export type GenerateState = {
  /** The refusal, beside the Generate button. One slot: five refusals, one place. */
  error: string | null;
  success: string | null;
  /**
   * The report just written, so the success line can offer `Open it →`.
   *
   * A LINK AND NOT A REDIRECT, deliberately: the operator generating five
   * clients' reports in a row wants to stay on this page, and the one who wants
   * to read it wants one tap. A redirect serves the second and punishes the
   * first.
   */
  reportId: string | null;
};

export const BLANK_GENERATE_STATE: GenerateState = {
  error: null,
  success: null,
  reportId: null,
};

/**
 * BOTH SELECTS ARE REQUIRED AND DEFAULTED, so a partially filled submission
 * cannot exist through the form (U-5). This message covers the OTHER caller —
 * a forged POST to a globally-addressable Server Action id — and says the one
 * true thing about it without echoing what was sent.
 */
export const GENERATE_INPUT_MESSAGE = 'Pick a month and a year, then generate.';

/* ------------------------------------------------------------------------- *
 * Append a fee-schedule row (D-13)
 * ------------------------------------------------------------------------- */

/**
 * Field errors keyed BY CONTROL NAME, not by a flat message list.
 *
 * The Add-a-fee form has three validated fields and the refusal has to render
 * beside the one that is wrong — a form-level "check your input" on a
 * three-field form is a puzzle. Keys match the `name` attributes so the mapping
 * from a zod issue path to a control is mechanical (the Phase 1 `toFieldErrors`
 * rule: `path[0]`, never a guess).
 */
export type FeeFieldErrors = {
  kind?: string;
  amount?: string;
  effective_from?: string;
};

/**
 * What the operator typed, echoed back so a refusal does not punish the fix.
 *
 * STRINGS, VERBATIM, NOT THE PARSED VALUES. The whole point is the submission
 * that FAILED to parse: an amount of `597.0O` has no parsed form, and re-seeding
 * the control from a normalised value would silently correct a typo the operator
 * needs to see in order to fix it. Keys match the `name` attributes for the same
 * mechanical reason `FeeFieldErrors` does.
 */
export type FeeValues = {
  kind: string;
  amount: string;
  effective_from: string;
  note: string;
};

export type FeeState = {
  /** A failure belonging to no single control — the write itself. */
  error: string | null;
  fieldErrors: FeeFieldErrors;
  success: string | null;
  /**
   * Re-seeds the controls on EVERY non-success return, and is cleared on success.
   *
   * React 19 resets an uncontrolled field after a `<form action={…}>` submission
   * completes, so without this a validation refusal ("Amount must be a dollar
   * figure like 597.00.") blanks the amount, the kind and the date while the
   * error renders — the operator reads what is wrong and simultaneously loses
   * the three fields that were right. Cleared on success because the form is
   * append-only and the next fee is a different fee.
   */
  values: FeeValues;
};

export const BLANK_FEE_VALUES: FeeValues = {
  kind: '',
  amount: '',
  effective_from: '',
  note: '',
};

export const BLANK_FEE_STATE: FeeState = {
  error: null,
  fieldErrors: {},
  success: null,
  values: BLANK_FEE_VALUES,
};

/**
 * THE WRITE ITSELF FAILED, AND NO ROW WAS APPENDED (WR-08).
 *
 * `fees.append` is a single INSERT, so a failure leaves nothing half-written and
 * the retry is safe. The caught value is discarded rather than echoed: a driver
 * error carries column and constraint names, and the operator cannot act on any
 * of it.
 */
export const FEE_WRITE_FAILED_MESSAGE = 'Could not save the fee. Try again in a moment.';

/** Recorded. Says nothing about which month it changes — that is the report's job. */
export const FEE_SAVED_MESSAGE = 'Fee recorded.';
