/**
 * THE SENTENCES ON A DOCUMENT THE CLIENT IS BILLED BY, PINNED BYTE FOR BYTE.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE CENTRAL PROPERTY: every number in every footnote comes from the ROW, │
 * │ not from today's constants. Footnote 1 says `30 days` on a report        │
 * │ generated under a 30-day window and `45 days` on one generated under 45  │
 * │ — from the SAME module, at the SAME moment, with only the row changed.   │
 * │ That pair is the whole D-11 freeze, stated as a test.                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Asserted BYTE-VERBATIM rather than with `toContain` wherever the UI-SPEC
 * Copywriting Contract gives an exact sentence — the 06-02 lesson: a
 * `toContain` suite passes cheerfully on copy that has grown a clause, and
 * these sentences are read by the person deciding whether to pay the invoice
 * they are stapled to.
 *
 * PURE. No database, no clock, no network — and the absence of a `@/db` value
 * import is asserted below rather than assumed, because that absence is what
 * makes a client-facing document testable this cheaply.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  followUpRange,
  formatReportDate,
  generateRefusalMessage,
  generateSuccessMessage,
  generateUnchangedMessage,
  methodologyNotes,
  periodLabel,
  shortDate,
  GENERATE_FAILED_MESSAGE,
} from '../src/core/reporting/copy';
import { NO_VALUE } from '../src/core/shared/tenant';
import type { ReportDocument } from '../src/core/reporting/document';

const SOURCE = readFileSync('src/core/reporting/copy.ts', 'utf8');

const PERTH = 'Australia/Perth';
const CLIENT = 'Perth Sparks';
const AUGUST = 'August 2026';

/** One frozen August report, with everything the footnotes read. */
function reportFor(overrides: Partial<ReportDocument> = {}): ReportDocument {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    periodStart: '2026-08-01',
    periodEnd: '2026-09-01',
    timezone: PERTH,
    version: 1,
    generatedAt: new Date('2026-09-02T02:00:00.000Z'),
    figures: {
      quotesChased: 12,
      replies: 5,
      jobsWonAttributed: 2,
      jobsWonTotal: 3,
      grossCents: 650_000,
      conservativeCents: 487_500,
      feesMonthlyCents: 59_700,
      feesSetupCents: 0,
      multipleConservativeBp: 8165,
      multipleGrossBp: 10_888,
      valueMissingCount: 0,
    },
    lines: [],
    baseline: {
      rateBp: 2500,
      source: 'connect',
      sampleSize: 40,
      windowStart: '2025-12-01',
      windowEnd: '2026-03-01',
      prospectRateBp: null,
    },
    constants: {
      attributionWindowDays: 30,
      defaultBaselineWinRate: 0.7,
      baselineMinQuotes: 10,
    },
    fees: {
      monthlyCents: 59_700,
      setupCents: 0,
      daysCharged: 31,
      daysInPeriod: 31,
      rows: [],
    },
    ...overrides,
  };
}

/** One per-job line. `valueSource: 'missing'` is the † case. */
function lineFor(overrides: Partial<ReportDocument['lines'][number]> = {}) {
  return {
    attributionId: '22222222-2222-4222-8222-222222222222',
    quoteId: '33333333-3333-4333-8333-333333333333',
    generatedJobId: '4192',
    jobDescription: 'Bathroom renovation, Scarborough',
    contactFirstName: 'Dave',
    wonDetectedAt: '2026-08-05T02:00:00.000Z',
    touchCount: 2,
    firstTouchAt: '2026-08-02T02:00:00.000Z',
    lastTouchAt: '2026-08-04T02:00:00.000Z',
    replyCount: 1,
    replyLabels: ['interested'],
    grossCents: 250_000,
    conservativeCents: 187_500,
    valueSource: 'mirror' as const,
    ...overrides,
  };
}

describe('period and date labels', () => {
  it('renders the month a report covers', () => {
    expect(periodLabel('2026-08-01', PERTH)).toBe(AUGUST);
  });

  it('reads a DATE-ONLY value as a date, not as a local midnight', () => {
    // The audit page's rule. A `date` column read as an instant and formatted
    // in a zone behind UTC renders as the previous day — which on a baseline
    // window would move the footnote's dates by one.
    expect(formatReportDate('2026-03-01', PERTH)).toBe('1 Mar 2026');
    expect(shortDate('2026-03-01', PERTH)).toBe('1 Mar');
    // TWO SPACE-SEPARATED TOKENS, pinned here rather than left implicit (07-07
    // review, IN-02). `followUpRange` decides `sameMonth` from
    // `last.split(' ').length === 2`, so a `shortDate` that grew a year would
    // make an asymmetric pair collapse to `1–2 Aug` and drop the year from a
    // client-facing figure. A format change should fail at this line, not
    // inside the range builder.
    expect(shortDate('2026-03-01', PERTH)).toMatch(/^\d{1,2} [A-Z][a-z]{2}$/);
  });

  it('renders an INSTANT in the client zone, with no time component', () => {
    // 4 August 18:00 UTC is 02:00 on the FIFTH in Perth (UTC+8). Rendering the
    // browser's zone here would date a client's report a day early.
    expect(formatReportDate(new Date('2026-08-04T18:00:00.000Z'), PERTH)).toBe('5 Aug 2026');

    // NO TIME COMPONENT, the audit page's rule: `prepared 5 Aug 2026, 02:00`
    // reads as a measurement rather than as a document assembled that day.
    expect(formatReportDate(new Date('2026-08-04T18:00:00.000Z'), PERTH)).not.toContain(':');
  });
});

describe('the Follow-ups cell (the printed range)', () => {
  it('drops the repeated month when both touches share one', () => {
    // The width argument (07-06 review, CR-01): the month is already in the
    // `Won` column, the h1, the subline and the footer.
    expect(followUpRange(2, '1 Aug', '4 Aug')).toBe('2 · 1–4 Aug');
    expect(followUpRange(12, '14 Aug', '31 Aug')).toBe('12 · 14–31 Aug');
  });

  it('collapses a same-day range to the day — a range from a day to itself is a date', () => {
    // The Test 4 PDF printed `2 · 1–1 Aug`. On a document a client is billed
    // by, that reads as a mistake in the figures rather than as a one-day
    // cadence — and a single-touch cadence lands here every time.
    expect(followUpRange(2, '1 Aug', '1 Aug')).toBe('2 · 1 Aug');
    expect(followUpRange(1, '3 Aug', '3 Aug')).toBe('1 · 3 Aug');
  });

  it('keeps both months when the cadence crosses one', () => {
    expect(followUpRange(3, '28 Jul', '2 Aug')).toBe('3 · 28 Jul–2 Aug');
  });

  it('does not print a marker joined to itself when shortDate degraded both ends', () => {
    // `shortDate` never throws; it returns the no-value marker. Two markers are
    // the same string, so the same-day rule collapses them — `2 · —` rather
    // than `2 · —–—`.
    expect(followUpRange(2, NO_VALUE, NO_VALUE)).toBe(`2 · ${NO_VALUE}`);
    // One degraded end falls through to the long form unchanged: the honest
    // reading is that one of the two dates is unavailable, not that they match.
    expect(followUpRange(2, '1 Aug', NO_VALUE)).toBe(`2 · 1 Aug–${NO_VALUE}`);
  });
});

describe('footnote 1 comes from the ROW, not from the constants module', () => {
  it('says 30 days for a report computed under 30, and 45 for one computed under 45', () => {
    const thirty = methodologyNotes(reportFor())[0];
    const fortyFive = methodologyNotes(
      reportFor({
        constants: { attributionWindowDays: 45, defaultBaselineWinRate: 0.7, baselineMinQuotes: 10 },
      }),
    )[0];

    expect(thirty).toContain('30 days');
    expect(fortyFive).toContain('45 days');

    // THE PAIR IS THE ASSERTION. Today's constant is 30; a module that read the
    // import instead of the row would produce '30 days' for both, and a frozen
    // report would quietly restate its own methodology the day D-01 changed.
    expect(thirty).not.toBe(fortyFive);
  });

  it('says what "sent" means, in the ledger\'s own terms', () => {
    expect(methodologyNotes(reportFor())[0]).toBe(
      'A job counts as recovered when ServiceM8 showed it won within 30 days of a follow-up ' +
        'we sent. "Sent" means handed to the carrier and not reported undelivered at the time ' +
        'the win was recorded.',
    );
  });
});

describe('footnote 2 names the zone the month was measured in (D-10)', () => {
  it('renders the frozen zone, not the client\'s current one', () => {
    expect(methodologyNotes(reportFor())[1]).toBe(
      'Jobs are counted in the month the win was seen in your ServiceM8 account ' +
        '(Australia/Perth), not by the job\'s work-order date, so a month never changes after ' +
        'it is reported.',
    );
  });
});

describe('footnote 3 — the baseline, and whether it was MEASURED or ASSUMED (D-06, D-08)', () => {
  it('the connect variant names the rate, the sample and the window', () => {
    const note = methodologyNotes(reportFor())[2];

    expect(note).toContain('25%');
    expect(note).toContain('40 quotes');
    expect(note).toContain('1 Dec 2025');
    expect(note).toContain('1 Mar 2026');
    expect(note).not.toContain('assumed');
  });

  it('the default variant says ASSUMED and says it understates us', () => {
    const note = methodologyNotes(
      reportFor({
        baseline: {
          rateBp: 7000,
          source: 'default',
          sampleSize: 7,
          windowStart: null,
          windowEnd: null,
          prospectRateBp: null,
        },
      }),
    )[2];

    expect(note).toContain('an assumed win rate');
    expect(note).toContain('fewer than 10 quotes');
    // THE PROHIBITION, AS A TEST: presenting an assumption as a measurement on
    // an invoice is the fastest way to lose the argument about every other
    // number on the page.
    expect(note).toContain('This understates our contribution.');
  });

  it('says "no quotes" — not "fewer than ten" — for a client who issued none', () => {
    for (const sampleSize of [0, null]) {
      const note = methodologyNotes(
        reportFor({
          baseline: {
            rateBp: 7000,
            source: 'default',
            sampleSize,
            windowStart: null,
            windowEnd: null,
            prospectRateBp: null,
          },
        }),
      )[2];

      // "Fewer than ten" read to a business that issued none is an accusation
      // about their business rather than a statement about our method.
      expect(note).toContain('no quotes');
      expect(note).not.toContain('fewer than');
    }
  });

  it('shortens the sentence rather than throwing when the window dates are null', () => {
    // A LATENT 500 ON A FROZEN DOCUMENT. `reportBaselineSchema` types both dates
    // as nullable and the `connect` branch needs only a rate and ten quotes —
    // `resolveBaseline` never reads the window — so a row can legally arrive
    // here with nulls. The old `?? ''` made `new Date('')` an Invalid Date, and
    // `Intl.DateTimeFormat.format` throws `RangeError` on one. That happened at
    // RENDER time, on a report that is immutable and reachable only through the
    // page that just failed to draw it: permanently unreadable, no data repair
    // possible from the console.
    const note = () =>
      methodologyNotes(
        reportFor({
          baseline: {
            rateBp: 2500,
            source: 'connect',
            sampleSize: 40,
            windowStart: null,
            windowEnd: null,
            prospectRateBp: null,
          },
        }),
      )[2];

    expect(note).not.toThrow();
    // Still a complete, honest sentence — it just does not claim a window it
    // does not have.
    expect(note()).toContain('your win rate on the 40 quotes in your account,');
    expect(note()).toContain('before follow-ups started.');
    expect(note()).not.toContain('from  to');
    expect(note()).not.toContain('Invalid');
  });

  it('formats an unparseable date as the no-value marker instead of throwing', () => {
    // `formatIn` is total: every caller is on a frozen document's render path,
    // where a throw costs the whole page and an em dash costs one word.
    expect(() => formatReportDate('not-a-date', PERTH)).not.toThrow();
    expect(formatReportDate('not-a-date', PERTH)).toBe(NO_VALUE);
  });

  it('adds the prospect-audit sentence ONLY when the two rates differ', () => {
    const same = methodologyNotes(
      reportFor({
        baseline: {
          rateBp: 2500,
          source: 'connect',
          sampleSize: 40,
          windowStart: '2025-12-01',
          windowEnd: '2026-03-01',
          prospectRateBp: 2500,
        },
      }),
    )[2];

    const differs = methodologyNotes(
      reportFor({
        baseline: {
          rateBp: 2500,
          source: 'connect',
          sampleSize: 40,
          windowStart: '2025-12-01',
          windowEnd: '2026-03-01',
          prospectRateBp: 1800,
        },
      }),
    )[2];

    // Printing it when they agree would INVENT a discrepancy on a document
    // whose whole value is that it does not have any.
    expect(same).not.toContain('Quote Leakage Audit');
    expect(differs).toContain(
      'Your Quote Leakage Audit showed 18%; this report uses the 25% measured when your ' +
        'account was connected.',
    );
  });
});

describe('footnote 4 — what was charged, and what the multiple divided by (D-13, A3)', () => {
  it('names the retainer and says the multiple used only that', () => {
    expect(methodologyNotes(reportFor())[3]).toBe(
      'Fees this month: $597.00 retainer. The return on fees divides the conservative ' +
        'recovered value by the retainer only.',
    );
  });

  it('states a setup fee AND states it as excluded', () => {
    const note = methodologyNotes(
      reportFor({
        fees: {
          monthlyCents: 59_700,
          setupCents: 99_000,
          daysCharged: 31,
          daysInPeriod: 31,
          rows: [],
        },
      }),
    )[3];

    // Folding $990 into the denominator would make a first month that WORKED
    // look like a failure; omitting it would make the report disagree with the
    // invoice it is stapled to.
    expect(note).toBe(
      'Fees this month: $597.00 retainer and a one-off $990.00 setup fee, shown separately. ' +
        'The return on fees divides the conservative recovered value by the retainer only.',
    );
  });

  it('says a $0.00 month has no return on fees', () => {
    const note = methodologyNotes(
      reportFor({
        fees: { monthlyCents: 0, setupCents: 0, daysCharged: 31, daysInPeriod: 31, rows: [] },
      }),
    )[3];

    expect(note).toBe('No fee was charged for this month, so no return on fees is shown.');
  });
});

describe('footnote 5 and the † lines', () => {
  it('says where the dollar figures came from', () => {
    expect(methodologyNotes(reportFor())[4]).toBe(
      'Job values are the ServiceM8 quote totals at the time each win was recorded.',
    );
  });

  it('adds one † note per job whose value could not be read, naming the job', () => {
    const notes = methodologyNotes(
      reportFor({
        lines: [
          lineFor(),
          lineFor({
            attributionId: '44444444-4444-4444-8444-444444444444',
            generatedJobId: '4207',
            grossCents: 0,
            conservativeCents: 0,
            valueSource: 'missing',
          }),
        ],
      }),
    );

    expect(notes).toHaveLength(6);
    // NAMES THE JOB, so the operator knows which one to price by hand — a note
    // that merely announced "one job has no value" is a note nobody can act on.
    expect(notes[5]).toBe(
      '† Job #4207 was won but its quote total could not be read from ServiceM8 when the win ' +
        'was recorded, so it is not included in the totals.',
    );
  });

  it('adds no † note when every value was read', () => {
    expect(methodologyNotes(reportFor({ lines: [lineFor()] }))).toHaveLength(5);
  });
});

describe('the Generate action says one thing, and names the fix', () => {
  const context = { clientName: CLIENT, monthLabel: AUGUST, connectedAtLabel: '1 Mar 2026' };

  it('refuses a month with no fee by pointing at the schedule below the button', () => {
    expect(generateRefusalMessage({ kind: 'no_fee' }, context)).toBe(
      'No monthly fee is recorded for August 2026. Add one in the fee schedule below, then ' +
        'generate.',
    );
  });

  it('refuses a month that has not started', () => {
    expect(
      generateRefusalMessage({ kind: 'future_month' }, { ...context, monthLabel: 'October 2026' }),
    ).toBe("October 2026 hasn't started yet.");
  });

  it('refuses a month before the connection, naming the date', () => {
    expect(
      generateRefusalMessage(
        { kind: 'before_connection', connectedAt: new Date('2026-03-01T00:00:00.000Z') },
        context,
      ),
    ).toBe(
      "Perth Sparks wasn't connected until 1 Mar 2026 — there is nothing to report before that.",
    );
  });

  it('refuses a client with no connection at all', () => {
    expect(generateRefusalMessage({ kind: 'not_connected' }, context)).toBe(
      "Perth Sparks isn't connected to ServiceM8 — there is nothing to report.",
    );
  });

  it('tells the loser of a concurrent generate to reload, not to retry', () => {
    expect(generateRefusalMessage({ kind: 'concurrent' }, context)).toBe(
      'A report for August 2026 was just generated — reload to see it.',
    );
  });

  it('has one fixed sentence for a genuine write failure', () => {
    expect(GENERATE_FAILED_MESSAGE).toBe('Could not generate the report. Try again in a moment.');
  });

  it('names the version and the month on success', () => {
    expect(generateSuccessMessage(2, AUGUST)).toBe('Version 2 for August 2026 is ready.');
  });

  it('says a re-pressed month is already up to date, and which version says so', () => {
    // NOT AN ERROR SENTENCE. The operator pressed Generate on a month nothing
    // has changed for; the right outcome is that no fourth identical version
    // exists, and the sentence has to read like the button worked.
    expect(generateUnchangedMessage(3, AUGUST)).toBe(
      'August 2026 is already up to date (version 3).',
    );
  });
});

describe('the copy module is pure', () => {
  /** Value imports only — `import type { … }` lines are erased and are fine. */
  function valueImportSources(source: string): string[] {
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    return [...stripped.matchAll(/^import\s+([\s\S]*?)from\s+'([^']+)';$/gm)]
      .filter(([, clause]) => !/^\s*type\s/.test(clause))
      .map(([, , specifier]) => specifier);
  }

  it('pulls in no database module', () => {
    for (const specifier of valueImportSources(SOURCE)) {
      expect(
        specifier.startsWith('@/db'),
        `copy.ts must not value-import ${specifier}: a module that composes a ` +
          'client-facing sentence has to be assertable byte-for-byte without a ' +
          'database.',
      ).toBe(false);
    }
  });
});
