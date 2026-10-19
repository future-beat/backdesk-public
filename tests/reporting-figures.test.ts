/**
 * The report's headline numbers, and how they print (RPT-02).
 *
 * PURE. Two properties carry the suite:
 *
 *  1. **Every stored figure is an integer or null.** The only division in the
 *     reporting path is in `format.ts`, at display time, on a value that is
 *     already final — so a frozen report row and the document it renders are
 *     the same numbers, and re-rendering March in December produces the same
 *     page.
 *  2. **`null` means "there is no denominator", never "zero".** A month with a
 *     real fee and no attributions is a genuine 0.0x — a bad month, honestly
 *     reported. A month with no fee schedule has no multiple at all, and
 *     printing 0.0x for it would accuse a working service of failing.
 */
import { describe, expect, it } from 'vitest';

import { multipleBasisPoints } from '@/core/attribution/money';
import type { FeesInForce } from '@/core/reporting/fees';
import { computeReportFigures, type FigureLine } from '@/core/reporting/figures';
import { formatCents, formatMultipleBp, formatRateBp } from '@/core/reporting/format';
import { NO_VALUE } from '@/core/shared/tenant';

function fees(over: Partial<FeesInForce> = {}): FeesInForce {
  return { monthlyCents: 29_700, setupCents: 0, daysCharged: 30, daysInPeriod: 30, ...over };
}

function line(over: Partial<FigureLine> = {}): FigureLine {
  return { grossCents: 100_000, conservativeCents: 60_000, valueSource: 'mirror', ...over };
}

describe('computeReportFigures — integer sums', () => {
  const figures = computeReportFigures({
    attributions: [
      line({ grossCents: 1_240_000, conservativeCents: 744_000 }),
      line({ grossCents: 320_000, conservativeCents: 192_000 }),
      line({ grossCents: 0, conservativeCents: 0, valueSource: 'missing' }),
    ],
    quotesChased: 42,
    replies: 11,
    jobsWonTotal: 7,
    fees: fees({ monthlyCents: 59_700, setupCents: 99_000 }),
  });

  it('sums gross and conservative cents as integers', () => {
    expect(figures.grossCents).toBe(1_560_000);
    expect(figures.conservativeCents).toBe(936_000);
    expect(Number.isInteger(figures.grossCents)).toBe(true);
    expect(Number.isInteger(figures.conservativeCents)).toBe(true);
  });

  it('prints attributed wins beside total wins, deliberately', () => {
    // Three of the client's seven wins are ours. Hiding the other four would
    // make the report look like a claim on the whole business.
    expect(figures.jobsWonAttributed).toBe(3);
    expect(figures.jobsWonTotal).toBe(7);
    expect(figures.quotesChased).toBe(42);
    expect(figures.replies).toBe(11);
  });

  it('surfaces the missing-value count rather than hiding it', () => {
    // The one number that makes the totals arguable: a missing-value line means
    // the real recovered figure is HIGHER than the one printed, and the
    // operator has to price it by hand before sending.
    expect(figures.valueMissingCount).toBe(1);
  });

  it('keeps the setup fee on its own line, out of the denominator', () => {
    expect(figures.feesMonthlyCents).toBe(59_700);
    expect(figures.feesSetupCents).toBe(99_000);
    // 936_000 x 10_000 / 59_700 = 156_783.9..., NOT divided by 59_700 + 99_000.
    expect(figures.multipleConservativeBp).toBe(156_783);
  });
});

describe('the multiple floors, and floors toward the client', () => {
  it('floors the conservative multiple', () => {
    // 100_000 x 10_000 / 29_700 = 33_670.03...
    const figures = computeReportFigures({
      attributions: [line({ grossCents: 178_200, conservativeCents: 100_000 })],
      quotesChased: 1,
      replies: 0,
      jobsWonTotal: 1,
      fees: fees({ monthlyCents: 29_700 }),
    });

    expect(figures.multipleConservativeBp).toBe(33_670);
  });

  it('floors the gross multiple the same way', () => {
    // 178_200 x 10_000 / 59_700 = 29_849.24...
    const figures = computeReportFigures({
      attributions: [line({ grossCents: 178_200, conservativeCents: 100_000 })],
      quotesChased: 1,
      replies: 0,
      jobsWonTotal: 1,
      fees: fees({ monthlyCents: 59_700 }),
    });

    expect(figures.multipleGrossBp).toBe(29_849);
  });
});

describe('null denominators', () => {
  it('gives a real 0.0x for a month that recovered nothing against a real fee', () => {
    const figures = computeReportFigures({
      attributions: [],
      quotesChased: 18,
      replies: 4,
      jobsWonTotal: 2,
      fees: fees({ monthlyCents: 29_700 }),
    });

    expect(figures.grossCents).toBe(0);
    expect(figures.conservativeCents).toBe(0);
    expect(figures.jobsWonAttributed).toBe(0);
    // A bad month, honestly reported. NOT null.
    expect(figures.multipleConservativeBp).toBe(0);
    expect(figures.multipleGrossBp).toBe(0);
  });

  it('gives NO multiple when there is no fee schedule', () => {
    const figures = computeReportFigures({
      attributions: [line()],
      quotesChased: 1,
      replies: 1,
      jobsWonTotal: 1,
      fees: fees({ monthlyCents: null }),
    });

    expect(figures.multipleConservativeBp).toBeNull();
    expect(figures.multipleGrossBp).toBeNull();
  });

  it('gives NO multiple for a deliberate $0.00 fee', () => {
    // Dividing by it would print an infinity on a document a client reads with
    // a calculator.
    const figures = computeReportFigures({
      attributions: [line()],
      quotesChased: 1,
      replies: 1,
      jobsWonTotal: 1,
      fees: fees({ monthlyCents: 0 }),
    });

    expect(figures.feesMonthlyCents).toBe(0);
    expect(figures.multipleConservativeBp).toBeNull();
  });
});

describe('format — the only division, at display time', () => {
  it('prints money invoice-grade, with cents', () => {
    // The audit's whole-dollar rule is for ESTIMATES. A recovered-revenue line
    // is a real quote total the client can look up in ServiceM8.
    expect(formatCents(245_000)).toBe('$2,450.00');
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(10)).toBe('$0.10');
  });

  it('prints rates to one decimal, always', () => {
    // `7%` and `7.1%` in the same table read as two different precisions of the
    // same claim.
    expect(formatRateBp(714)).toBe('7.1%');
    expect(formatRateBp(0)).toBe('0.0%');
    expect(formatRateBp(10_000)).toBe('100.0%');
  });

  it('prints multiples to one decimal with the multiplication sign', () => {
    // A MULTIPLE IS A RATIO, SO 1× IS 10_000 bp — not 100. The previous
    // expectations here pinned the percentage conversion and so pinned a
    // headline that printed one hundred times too large on the invoice.
    expect(formatMultipleBp(34)).toBe('0.0×'); // 34 bp is 0.0034×
    expect(formatMultipleBp(33_670)).toBe('3.4×');
    expect(formatMultipleBp(30_000)).toBe('3.0×'); // the guarantee, at the boundary
  });

  it('agrees with the function that produces the basis points it renders', () => {
    // The round trip is the property that actually matters: whatever
    // `multipleBasisPoints` calls a 3× month, `formatMultipleBp` must print as
    // `3.0×`. Pinning the two independently is how the factor-of-100 survived.
    const feeCents = 29_700;
    expect(formatMultipleBp(multipleBasisPoints(3 * feeCents, feeCents))).toBe('3.0×');
    expect(formatMultipleBp(multipleBasisPoints(100_000, 29_700))).toBe('3.4×');
  });

  it('renders a null as the shared no-value marker, never as a zero', () => {
    expect(formatRateBp(null)).toBe(NO_VALUE);
    expect(formatMultipleBp(null)).toBe(NO_VALUE);
    expect(formatMultipleBp(null)).not.toBe('0.0×');
  });
});
