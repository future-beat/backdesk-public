/**
 * THE DESIGN-PARTNER CSV: ONE WRITER, A FIXED HEADER (Phase 15, RPT-05 / D-04,
 * D-10).
 *
 * PURE. One row per client per month, built from the frozen monthly report's
 * parsed `missedCalls` block — never from raw jsonb, never from a live table.
 * Written ONCE, here, for the reason `canonicalJson` is written once: two
 * writers are two answers to "what does the file say".
 *
 * ── NOTHING PERSONAL HAS A COLUMN (D-04) ────────────────────────────────────
 *
 * Client names are the only identifier. No phone number, no message body, no
 * caller detail of any kind — and that is a PROPERTY, not a review item:
 * `tests/partner-csv.test.ts` pins the fourteen-column header byte for byte
 * and greps this file's code (comments stripped) for every token that could
 * name such a field; plan 15-03 adds the same pin over the repository read
 * that feeds it. The input type is the parsed block, so there is no field
 * here through which anything else could arrive.
 *
 * ── EMPTY IS NOT ZERO (D-10) ────────────────────────────────────────────────
 *
 * A month frozen before Phase 15 has no block: every figure cell is empty. A
 * month with no delivered text-back has no speed sample: the two speed cells
 * are empty. A `0` in either place would be a measurement nobody made.
 *
 * ── FORMULA INJECTION ───────────────────────────────────────────────────────
 *
 * A client name is operator-entered free text and the file is opened in a
 * spreadsheet. A cell starting with `=`, `+`, `-` or `@` is a formula there,
 * so such a name gets a leading apostrophe. So does a name starting with a
 * TAB or a CARRIAGE RETURN (OWASP's list), and one whose first non-blank
 * character is a formula lead: importers trim leading whitespace before they
 * evaluate, so `' =HYPERLINK(…)'` is as live as `'=HYPERLINK(…)'` (15-REVIEW
 * WR-05). Figure cells are non-negative integers rendered by `String()`, so
 * they never start with one.
 *
 * Quoting (a comma or a quote inside a name) is papaparse's, per RFC 4180.
 * Lines end CRLF, and so does the file.
 */
import Papa from 'papaparse';

import type { ReportMissedCallsDocument } from './document';

export const PARTNER_CSV_HEADER = ['client', 'month', 'missed_calls', 'after_hours_calls', 'withheld_calls', 'text_backs_sent', 'text_backs_delivered', 'text_back_median_seconds', 'text_back_p90_seconds', 'replies_on_delivered', 'leads_opened', 'jobs_created', 'jobs_won', 'booked_by_tradie'] as const;

export interface PartnerCsvInput {
  clientName: string;
  /** `YYYY-MM` from the row's `period_start` — already a local calendar date. */
  month: string;
  /** The parsed block, or `undefined` for a month frozen before Phase 15. */
  missedCalls: ReportMissedCallsDocument | undefined;
}

const NEWLINE = '\r\n';
/**
 * A leading tab or carriage return, or a formula lead after any run of
 * whitespace (`\s` includes the no-break space).
 */
const FORMULA_LEAD = /^(?:[\t\r]|\s*[=+\-@])/;

function safeName(name: string): string {
  return FORMULA_LEAD.test(name) ? `'${name}` : name;
}

function cell(value: number | null): string {
  return value === null ? '' : String(value);
}

function figureCells(block: ReportMissedCallsDocument | undefined): string[] {
  if (block === undefined) return Array.from({ length: PARTNER_CSV_HEADER.length - 2 }, () => '');
  return [
    cell(block.captured),
    cell(block.afterHours.numerator),
    cell(block.withheld),
    cell(block.textBacks.sent),
    cell(block.textBacks.delivered),
    cell(block.textBacks.medianSeconds),
    cell(block.textBacks.p90Seconds),
    cell(block.replyRate.numerator),
    cell(block.funnel.leads),
    cell(block.funnel.jobsCreated),
    cell(block.funnel.jobsWon),
    cell(block.funnel.bookedByTradie),
  ];
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The data rows, as strings, in header order — sorted by client name, then month. */
export function partnerCsvRows(inputs: readonly PartnerCsvInput[]): string[][] {
  return [...inputs]
    .sort((a, b) => compare(a.clientName, b.clientName) || compare(a.month, b.month))
    .map((input) => [safeName(input.clientName), input.month, ...figureCells(input.missedCalls)]);
}

/** The whole file: the header line, one line per row, CRLF-terminated. */
export function partnerCsv(inputs: readonly PartnerCsvInput[]): string {
  const text = Papa.unparse({ fields: [...PARTNER_CSV_HEADER], data: partnerCsvRows(inputs) }, { newline: NEWLINE });
  // papaparse already terminates a header-only file (no data rows) with the
  // newline; with data rows it does not. Either way the file ends in exactly
  // one CRLF.
  return text.endsWith(NEWLINE) ? text : `${text}${NEWLINE}`;
}
