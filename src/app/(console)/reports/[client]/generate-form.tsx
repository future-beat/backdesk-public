'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { generateReportAction } from './actions';
import { BLANK_GENERATE_STATE } from './action-state';

/**
 * PICK A MONTH, GET A FROZEN REPORT (RPT-02, UI-SPEC "Generate action").
 *
 * ── THE FORM IS NEVER UNFILLED (U-5) ────────────────────────────────────────
 *
 * Both selects carry defaults — the previous calendar month in the CLIENT'S
 * zone, because the month an operator invoices for is the one that just closed.
 * There is therefore no empty state to design, no "choose a month" placeholder
 * option, and no partially-filled submission the action has to refuse. The
 * common act is one tap on `Generate report`.
 *
 * ── PLAIN PROPS, NO DATABASE MODULE ─────────────────────────────────────────
 *
 * The only value imports are the server action and the sibling `action-state`
 * (which imports nothing). The month names are declared HERE rather than pulled
 * from a shared vocabulary, and the year range arrives as two numbers rather
 * than as a connection row: reaching for a constant from a module that touches
 * the repository is the value/type asymmetry that broke `next build` in 06-02.
 * `tests/lint-ban.test.ts` pins this file for that reason.
 */

/**
 * The month names, in order, 1-based by index+1.
 *
 * Written out rather than produced by `Intl.DateTimeFormat` in a loop: this is
 * a CONTROL, and a select whose option labels depend on the browser's ICU data
 * can render differently for the operator than for the report they generate.
 */
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function GenerateForm({
  tenantId,
  years,
  defaultMonth,
  defaultYear,
}: {
  tenantId: string;
  /** Connect year … current year, ascending. Never empty — the page guarantees it. */
  years: number[];
  /** 1-based. */
  defaultMonth: number;
  defaultYear: number;
}) {
  const [state, formAction, pending] = useActionState(
    generateReportAction.bind(null, tenantId),
    BLANK_GENERATE_STATE,
  );

  return (
    <form action={formAction}>
      <fieldset>
        <legend>Generate a report</legend>

        {/* ONE `.controls` around both selects AND the button: that rule stacks
            its children on a phone and makes the button full-width at 44px,
            which is the tap target the whole page is sized for. Reusing it here
            is why this form needs no CSS of its own. */}
        <div className="controls">
          <div>
            <label htmlFor="report-month">Month</label>
            <select
              id="report-month"
              name="month"
              defaultValue={String(defaultMonth)}
              disabled={pending}
              required
            >
              {MONTHS.map((label, index) => (
                <option key={label} value={String(index + 1)}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="report-year">Year</label>
            <select
              id="report-year"
              name="year"
              defaultValue={String(defaultYear)}
              disabled={pending}
              required
            >
              {years.map((year) => (
                <option key={year} value={String(year)}>
                  {year}
                </option>
              ))}
            </select>
          </div>

          <button type="submit" disabled={pending}>
            {pending ? 'Generating…' : 'Generate report'}
          </button>
        </div>

        {/* THE REFUSAL SITS BESIDE THE BUTTON, not above the form: all five
            refusals are about the month that was just submitted, and the
            no-fee one points at the disclosure directly below. */}
        {state.error ? (
          <p className="field-error" role="alert">
            {state.error}
          </p>
        ) : null}

        {state.success ? (
          <p className="muted" role="status">
            {state.success}{' '}
            {state.reportId ? (
              <Link href={`/reports/${tenantId}/${state.reportId}`}>Open it →</Link>
            ) : null}
          </p>
        ) : null}

        <p className="muted hint">
          Creates a frozen report you can print to PDF and attach to the invoice. Re-generating a
          month adds a version only if something changed.
        </p>
      </fieldset>
    </form>
  );
}
