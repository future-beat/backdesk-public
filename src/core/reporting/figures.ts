/**
 * The report's headline numbers (RPT-02) — integers or null, never a float.
 *
 * Everything here is a sum of integer cents or an integer basis-point count.
 * The only division in the whole reporting path happens at DISPLAY time, in
 * `format.ts`, on a value that is already final. That separation is the point:
 * the numbers a frozen report row stores are exactly the numbers it renders,
 * so re-rendering a March report in December produces the same document.
 *
 * `null` is a first-class answer here and means "there is no denominator",
 * never "zero". A month with a real fee and no attributions is a genuine 0.0×
 * — a bad month, honestly reported. A month with no fee schedule has no
 * multiple at all, and printing 0.0× for it would be a lie in the opposite
 * direction.
 */
import { multipleBasisPoints } from '@/core/attribution/money';

import type { FeesInForce } from './fees';

/** One attribution row, reduced to what the headline figures need. */
export interface FigureLine {
  grossCents: number;
  conservativeCents: number;
  valueSource: 'mirror' | 'missing';
}

export interface ReportFigures {
  /** Quotes the service chased in the period — the denominator of the story. */
  quotesChased: number;
  replies: number;
  /** Wins the service claims. */
  jobsWonAttributed: number;
  /** Wins the client had, full stop. Printed beside the above, deliberately. */
  jobsWonTotal: number;
  grossCents: number;
  conservativeCents: number;
  feesMonthlyCents: number | null;
  feesSetupCents: number;
  /** Integer basis points. The headline. `null` when there is no fee to divide by. */
  multipleConservativeBp: number | null;
  /** The gross multiple, printed beside the conservative one (D-13). */
  multipleGrossBp: number | null;
  /**
   * Attributed jobs whose dollar figure could not be read from the mirror.
   *
   * Surfaced as a COUNT rather than hidden, because it is the one number that
   * makes the totals below arguable: three missing-value lines mean the real
   * recovered figure is higher than the one printed, and the operator has to
   * price them by hand before sending.
   */
  valueMissingCount: number;
}

export interface ComputeReportFiguresInput {
  attributions: readonly FigureLine[];
  quotesChased: number;
  replies: number;
  jobsWonTotal: number;
  fees: FeesInForce;
}

export function computeReportFigures(input: ComputeReportFiguresInput): ReportFigures {
  let grossCents = 0;
  let conservativeCents = 0;
  let valueMissingCount = 0;

  for (const line of input.attributions) {
    grossCents += line.grossCents;
    conservativeCents += line.conservativeCents;
    if (line.valueSource === 'missing') valueMissingCount += 1;
  }

  return {
    quotesChased: input.quotesChased,
    replies: input.replies,
    jobsWonAttributed: input.attributions.length,
    jobsWonTotal: input.jobsWonTotal,
    grossCents,
    conservativeCents,
    feesMonthlyCents: input.fees.monthlyCents,
    // The setup fee is its own line and is NOT in either denominator (A3).
    feesSetupCents: input.fees.setupCents,
    multipleConservativeBp: multipleBasisPoints(conservativeCents, input.fees.monthlyCents),
    multipleGrossBp: multipleBasisPoints(grossCents, input.fees.monthlyCents),
    valueMissingCount,
  };
}
