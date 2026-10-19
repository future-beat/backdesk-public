/**
 * EVERY SENTENCE THE REPORT SAYS, BUILT FROM THE ROW IT IS EXPLAINING (RPT-02).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE DOCUMENT MUST NOT DISAGREE WITH ITSELF (T-7-21).                     │
 * │ A footnote reading "a conservative 30% baseline" above a figure computed │
 * │ with 25% is not a typo — it is a document the person being billed can    │
 * │ show is wrong, in the one conversation the evidence chain exists to      │
 * │ prevent. So every number in every footnote here is INTERPOLATED FROM THE │
 * │ FROZEN ROW: `row.constants.attributionWindowDays`, `row.baseline.rateBp`,│
 * │ `row.fees.monthlyCents`. Not from the constants module, not recomputed,  │
 * │ not typed a second time.                                                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * That is why footnote 1 renders `30 days` on a report generated under a 30-day
 * window even after D-01 is changed to 45 — the report keeps saying what it
 * actually did, and the PAGE (not this module) warns the operator on screen that
 * today's rule differs.
 *
 * ── PURE, AND FRAMEWORK-FREE ────────────────────────────────────────────────
 *
 * No database import, no React, no `next/*`. The only value imports are the
 * display formatters and the period module, for the reason `format.ts` gives:
 * the figure and the sentence that explains it must render through ONE
 * function. `tests/reporting-copy.test.ts` pins the absence of a `@/db` value
 * import, because that absence is what keeps this module testable by asserting
 * bytes.
 *
 * ── A CLOSED VOCABULARY ─────────────────────────────────────────────────────
 *
 * Every branch below produces one of a fixed set of sentences, each pinned
 * byte-for-byte against the UI-SPEC Copywriting Contract in the suite. This is
 * the `escalation/message.ts` shape (06-05): copy that leaves the building is
 * composed from enumerated parts and asserted verbatim, never assembled from
 * whatever a caller happened to pass.
 */
import { NO_VALUE } from '@/core/shared/tenant';

import { formatCents, formatRateBp } from './format';
import { calendarMonth } from './period';

import type { ReportDocument } from './document';
import type { GenerateReportResult } from './generate';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// ── THE MISSED-CALL BLOCK'S FIXED SENTENCES (Phase 15, RPT-04 / D-03, D-10) ──
//
// UI-SPEC §3b (the live month-to-date block) and §3c (the printed sheet),
// verbatim. Server-only: both pages are server components, so these live
// beside the figures rather than in a client-safe leaf.

/** D-10: an absence of samples is said in words, never as a number. */
export const NO_SAMPLES_LABEL = 'no samples';

/** The evidence line a `MetricRow` shows when its figure has nothing to divide. */
export const MISSED_CALL_EVIDENCE = {
  none: 'no diverted calls this month',
  noSamples: 'no samples — no text-back delivered this month',
  nothingDelivered: 'nothing delivered this month',
  noLeads: 'no leads this month',
} as const;

/** The footnote under the live block (§3b). */
export const MISSED_CALL_LIVE_FOOTNOTE =
  'Text-back speed is measured from the call arriving at Backdesk to the carrier reporting the ' +
  'text delivered, over delivered texts only. Reply rate counts a reply from the caller against ' +
  'texts that were delivered. Jobs from leads are counted here and never given a dollar value — ' +
  'recovered value stays a quotes figure.';

/**
 * The note appended to the printed sheet's `ol.report-notes` (§3c) — ONLY when
 * the ROW carries the block, so a report frozen before Phase 15 keeps exactly
 * the notes it was sent with (D-11).
 */
export const MISSED_CALL_SHEET_NOTE =
  'Missed calls are calls your phone diverted to your Backdesk number. "Text sent back within" is ' +
  'the time from the call arriving to the carrier confirming the text was delivered, over ' +
  'delivered texts only. Jobs from leads are counted here, not valued — the recovered figures ' +
  'above are quotes only.';

/**
 * `2026-08-01` + a zone → `August 2026`.
 *
 * The instant is built through `calendarMonth`, the module that owns zone
 * resolution, rather than by parsing the string as UTC midnight and formatting
 * it in the tenant's zone. Those agree for every Australian zone and disagree
 * for every negative-offset one, where UTC midnight on the 1st is the 31st
 * locally — a report headed `July 2026` on the page and `August 2026` in its
 * own footer.
 */
export function periodLabel(periodStart: string, timeZone: string): string {
  const [year, month] = periodStart.split('-').map(Number) as [number, number, number];
  const period = calendarMonth(timeZone, year, month);

  return new Intl.DateTimeFormat('en-AU', {
    month: 'long',
    year: 'numeric',
    timeZone,
  }).format(period.start);
}

/**
 * An instant or a calendar date → `3 Aug 2026`, in the client's zone.
 *
 * NO TIME COMPONENT, the audit page's rule: `prepared 26 Aug 2026, 14:32` reads
 * as a measurement rather than as a document assembled that day.
 *
 * A DATE-ONLY STRING IS READ AS A DATE (the `formatDate` argument, one page
 * over): `baseline.windowStart` comes from a `date` column, and interpreting
 * `2026-03-01` as a local midnight would render it as 29 February in any zone
 * behind UTC. Date-only values are therefore formatted in UTC, instants in the
 * tenant's zone.
 */
export function formatReportDate(value: string | Date, timeZone: string): string {
  return formatIn(value, timeZone, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** `3 Aug` — the per-job table's `Won` and follow-up-range cells. */
export function shortDate(value: string | Date, timeZone: string): string {
  return formatIn(value, timeZone, { day: 'numeric', month: 'short' });
}

/**
 * `12 · 14–31 Aug` — the Follow-ups cell, and 4 characters narrower than the
 * `12 (14 Aug–31 Aug)` it replaces.
 *
 * THE WIDTH IS THE POINT (07-06 review, CR-01). Every column on the printed
 * sheet is spending from one 661px budget, and this cell was the widest one
 * whose content repeats a fact the sheet already carries: the month is in the
 * `Won` column, in the h1, in the subline and in the footer. Dropping the
 * repeat when both ends share a month hands ~24px to the Job cell, which is
 * the only column that is actually losing content to the budget.
 *
 * A RANGE WHOSE ENDS ARE THE SAME DAY IS A DATE (07-07). The UAT PDF printed
 * `2 · 1–1 Aug` for two touches that both landed on 1 August; on a document a
 * client is billed by, a range from a day to itself reads as a mistake in the
 * figures rather than as a short cadence. A one-touch cadence lands here every
 * time, so this is the common case, not the edge one.
 *
 * String-level, not date-level, deliberately: `shortDate` is the ONE formatter
 * for these two values (zone resolution, the date-only rule, the never-throw
 * rule all live in it), so this compares what it produced rather than re-deriving
 * a month from the instant and risking a second answer. Anything `shortDate`
 * degrades to the no-value marker falls through to the long form unchanged —
 * except when BOTH ends degraded, where the same-day rule collapses the pair to
 * a single marker rather than printing one joined to itself.
 */
export function followUpRange(count: number, first: string, last: string): string {
  if (first === last) return `${count} · ${first}`;

  const [firstDay, firstMonth] = first.split(' ');
  const lastParts = last.split(' ');
  const sameMonth = lastParts.length === 2 && firstMonth !== undefined && firstMonth === lastParts[1];

  return `${count} · ${sameMonth ? firstDay : first}–${last}`;
}

/**
 * TOTAL, BY CONSTRUCTION — it returns the no-value marker rather than throwing.
 *
 * `Intl.DateTimeFormat.format(Invalid Date)` raises `RangeError`, and every
 * caller of this function is on a render path for a FROZEN document. A throw
 * there is a 500 on a report that is already immutable and reachable only
 * through the page that just failed to draw it: permanently unreadable, and
 * unfixable without a data repair. Degrading to `—` costs one em dash in a
 * sentence and keeps the other twenty numbers on the page legible.
 */
function formatIn(
  value: string | Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  const dateOnly = typeof value === 'string' && DATE_ONLY.test(value);
  const at = value instanceof Date ? value : new Date(dateOnly ? `${value}T00:00:00Z` : value);

  if (Number.isNaN(at.getTime())) return NO_VALUE;

  return new Intl.DateTimeFormat('en-AU', {
    ...options,
    timeZone: dateOnly ? 'UTC' : timeZone,
  }).format(at);
}

/**
 * Integer basis points → `25%` or `7.1%`, for PROSE.
 *
 * NOT A SECOND DIVISION — `formatRateBp` does the arithmetic and this trims one
 * character off its output. The trim exists because a footnote is a sentence a
 * tradie reads, and "your win rate on those quotes was 25.0%" claims a
 * measurement to three significant figures about a number that is a ratio of
 * two small integers. Tables keep the fixed decimal so columns align; prose
 * does not have columns.
 */
function percentInProse(bp: number): string {
  return formatRateBp(bp).replace(/\.0%$/, '%');
}

/* ------------------------------------------------------------------------- *
 * The methodology footnotes
 * ------------------------------------------------------------------------- */

/**
 * The five methodology footnotes, plus one `†` line per job whose value could
 * not be read — the whole `ol.report-notes`, in order.
 *
 * THE `†` LINES ARE LIST ITEMS AND NOT A SEPARATE APPARATUS, deliberately. A
 * money cell reading `$0.00†` needs the note to be findable on the same page by
 * somebody who is not looking for it; a second, unnumbered footnote block below
 * the numbered one is the layout in which a caveat gets missed. They carry the
 * `†` in their text so the marker in the cell and the marker in the note are the
 * same character.
 *
 * Every value here comes from the row. See the module header for why.
 */
export function methodologyNotes(row: ReportDocument): string[] {
  const notes: string[] = [];

  // 1 — what "recovered" means, and what "sent" means. The window days come
  // from the ROW: a report generated under a 30-day rule keeps saying 30.
  notes.push(
    `A job counts as recovered when ServiceM8 showed it won within ` +
      `${row.constants.attributionWindowDays} days of a follow-up we sent. "Sent" means handed ` +
      `to the carrier and not reported undelivered at the time the win was recorded.`,
  );

  // 2 — D-10, in the client's words: which month a win lands in, and why a
  // closed month never moves afterwards.
  notes.push(
    `Jobs are counted in the month the win was seen in your ServiceM8 account ` +
      `(${row.timezone}), not by the job's work-order date, so a month never changes after it ` +
      `is reported.`,
  );

  notes.push(baselineNote(row));

  notes.push(feesNote(row));

  // 5 — where the dollar figures came from. Deliberately last: it is the line
  // a client checks against their own account.
  notes.push('Job values are the ServiceM8 quote totals at the time each win was recorded.');

  // The † lines, one per unreadable value. Driven off the LINES rather than off
  // `valueMissingCount`, so the note names the job the operator has to price by
  // hand rather than merely announcing that one exists.
  for (const line of row.lines) {
    if (line.valueSource !== 'missing') continue;
    notes.push(
      `† Job #${line.generatedJobId ?? 'unknown'} was won but its quote total could not be read ` +
        `from ServiceM8 when the win was recorded, so it is not included in the totals.`,
    );
  }

  // Phase 15 (D-03, D-11): the missed-call note, LAST, and only when the ROW
  // carries the block — an old row gets no new note.
  if (row.figures.missedCalls !== undefined) notes.push(MISSED_CALL_SHEET_NOTE);

  return notes;
}

/**
 * Footnote 3 — WHERE THE CONSERVATIVE FIGURE'S HAIRCUT CAME FROM (D-06, D-08).
 *
 * THE `default` BRANCH SAYS "ASSUMED" OUT LOUD AND SAYS THE FIGURE UNDERSTATES
 * US. That sentence is a prohibition in this plan, not a nicety: presenting an
 * assumption as a measurement on an invoice is the single fastest way to lose
 * the argument about every other number on the page. Saying the assumption is
 * deliberately generous costs nothing and is the reason the rest is believed.
 */
function baselineNote(row: ReportDocument): string {
  const rate = percentInProse(row.baseline.rateBp);

  const opening =
    `The conservative figure credits us only with the share of each job you would not have ` +
    `won anyway: gross × (1 − ${rate}), where ${rate} is `;

  let body: string;
  if (row.baseline.source === 'connect') {
    // THE WINDOW IS OPTIONAL IN THE SCHEMA, SO THE SENTENCE HAS TO BE TOO. The
    // `connect` branch needs only a non-null rate and ten quotes — `resolveBaseline`
    // never looks at the window dates — so a row can legally reach here with
    // nulls. Coercing them to `''` produced an `Invalid Date` and a `RangeError`
    // out of `Intl` at RENDER time, on a frozen document: a permanent 500 on a
    // page that is the only way to reach the thing it failed to draw. A missing
    // window should shorten the sentence, not destroy the report.
    const windowPhrase =
      row.baseline.windowStart && row.baseline.windowEnd
        ? ` from ${formatReportDate(row.baseline.windowStart, row.timezone)} to ` +
          `${formatReportDate(row.baseline.windowEnd, row.timezone)}`
        : '';

    body =
      `your win rate on the ${row.baseline.sampleSize ?? 0} quotes in your account` +
      `${windowPhrase}, before follow-ups started.`;
  } else {
    // `0` and `null` are the same sentence here and different from `7`: "no
    // quotes" and "fewer than ten quotes" are both honest, and reading "fewer
    // than 10" to a business that issued none reads as an accusation.
    const sample = row.baseline.sampleSize ?? 0;
    const shortfall =
      sample > 0 ? `fewer than ${row.constants.baselineMinQuotes} quotes` : 'no quotes';

    body =
      `an assumed win rate: your account had ${shortfall} before follow-ups started, so we ` +
      `assumed you were already winning ${rate} — at or above published trade benchmarks. ` +
      `This understates our contribution.`;
  }

  // The continuity sentence, and ONLY when the two differ. A prospect whose
  // audit rate matches the connect-time one has nothing to reconcile, and
  // printing the sentence anyway would invent a discrepancy.
  const prospect = row.baseline.prospectRateBp;
  const continuity =
    prospect !== null && prospect !== row.baseline.rateBp
      ? ` Your Quote Leakage Audit showed ${percentInProse(prospect)}; this report uses the ` +
        `${rate} measured when your account was connected.`
      : '';

  return `${opening}${body}${continuity}`;
}

/**
 * Footnote 4 — WHAT WAS CHARGED, AND WHAT THE MULTIPLE DIVIDED BY (D-13, A3).
 *
 * The setup fee is stated and stated as EXCLUDED. The 3× guarantee is quoted
 * against the retainer, and silently folding a $990 setup fee into the
 * denominator would make a first month that worked look like a failure — while
 * omitting the fee entirely would make the report disagree with the invoice it
 * is stapled to.
 */
function feesNote(row: ReportDocument): string {
  const monthly = row.fees.monthlyCents;

  // A DELIBERATE $0.00 MONTH — a pilot, a make-good — is a fact, not a gap, and
  // it has no denominator. `null` cannot occur on a generated report (the
  // no-fee refusal precedes generation) and is folded in here rather than left
  // as an unhandled shape.
  if (monthly === null || monthly === 0) {
    return 'No fee was charged for this month, so no return on fees is shown.';
  }

  const setup =
    row.fees.setupCents > 0
      ? ` and a one-off ${formatCents(row.fees.setupCents)} setup fee, shown separately`
      : '';

  return (
    `Fees this month: ${formatCents(monthly)} retainer${setup}. The return on fees divides ` +
    `the conservative recovered value by the retainer only.`
  );
}

/* ------------------------------------------------------------------------- *
 * The Generate action's sentences
 * ------------------------------------------------------------------------- */

/**
 * THE WRITE ITSELF FAILED (WR-08).
 *
 * The caught value is never echoed — a driver error carries column names,
 * constraint names and SQLSTATE detail, and the operator cannot act on any of
 * it. The code goes to the log; the form gets this.
 */
export const GENERATE_FAILED_MESSAGE = 'Could not generate the report. Try again in a moment.';

/** What the refusal sentences need that the result does not carry. */
export interface RefusalContext {
  clientName: string;
  /** `August 2026` — already through `periodLabel`. */
  monthLabel: string;
  /** `1 Mar 2026` — already through `formatReportDate`. Only the connection arm reads it. */
  connectedAtLabel: string;
}

/**
 * One refusal → one sentence that names the fix.
 *
 * FIVE ARMS, AND EVERY ONE OF THEM TELLS THE OPERATOR WHAT TO DO NEXT. The
 * no-fee arm points at the disclosure directly below the button it renders
 * beside (U-4) — the fix is on the same screen, and a refusal that made the
 * operator go looking for it would be the version of this that gets worked
 * around by generating for the wrong month.
 *
 * TWO OF THE SEVEN RESULT ARMS ARE EXCLUDED, not five. `generated` is the
 * write; `unchanged` is neither a refusal nor a write — the month is already
 * up to date, and telling the operator that in the error slot would report a
 * correct outcome as a problem. Both get their own sentence below.
 *
 * The switch has NO `default` deliberately: adding an arm to
 * `GenerateReportResult` without deciding which of the three sentences it takes
 * fails to compile here rather than falling through to silence.
 */
export function generateRefusalMessage(
  result: Exclude<GenerateReportResult, { kind: 'generated' } | { kind: 'unchanged' }>,
  context: RefusalContext,
): string {
  switch (result.kind) {
    case 'no_fee':
      return (
        `No monthly fee is recorded for ${context.monthLabel}. Add one in the fee schedule ` +
        `below, then generate.`
      );
    case 'future_month':
      return `${context.monthLabel} hasn't started yet.`;
    case 'not_connected':
      // The sixth variant, recorded as discretion in 07-04-PLAN.md: the
      // UI-SPEC enumerates five, and a client with no connection at all would
      // otherwise fall through to "could not generate", which says nothing.
      return `${context.clientName} isn't connected to ServiceM8 — there is nothing to report.`;
    case 'before_connection':
      return (
        `${context.clientName} wasn't connected until ${context.connectedAtLabel} — there is ` +
        `nothing to report before that.`
      );
    case 'concurrent':
      // NOT AN ERROR, AND THE SENTENCE SAYS SO. The other generate succeeded;
      // this operator's next act is a reload, not a retry.
      return `A report for ${context.monthLabel} was just generated — reload to see it.`;
  }
}

/** `Version 2 for August 2026 is ready.` */
export function generateSuccessMessage(version: number, monthLabel: string): string {
  return `Version ${version} for ${monthLabel} is ready.`;
}

/**
 * `August 2026 is already up to date (version 3).`
 *
 * NOT AN APOLOGY AND NOT A CONGRATULATION. The operator pressed a button and
 * the right thing happened — the month already says exactly this, so no fourth
 * identical version was created. The version number is in the sentence because
 * the link beside it goes to that version, and a number the operator can check
 * against the list is what makes "already up to date" believable.
 */
export function generateUnchangedMessage(version: number, monthLabel: string): string {
  return `${monthLabel} is already up to date (version ${version}).`;
}
