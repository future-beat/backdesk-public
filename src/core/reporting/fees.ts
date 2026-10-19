/**
 * The fee schedule in force over a period, pro-rated by local day (D-13).
 *
 * This is the DENOMINATOR of the number the whole service is sold on — "the
 * invoice must arrive stapled to proof it paid for itself", measured as
 * conservative recovered revenue ÷ fees, against a 3× guarantee. Getting it
 * wrong in the service's favour is how that guarantee gets called in; getting
 * it wrong in the client's favour is how a report claims a multiple the client
 * can disprove from their own bank statement.
 *
 * ── APPEND-ONLY, LATEST WINS ────────────────────────────────────────────────
 *
 * Rows are never updated. Raising a client from the founding $297 to $597 is a
 * NEW ROW with a new `effective_from`; the old one stays, because a report
 * generated for March has to keep saying what March actually cost. This is the
 * `tenant_attestations` shape, and the tie-break for two rows with the SAME
 * `effective_from` is latest-inserted-wins — a correction typed a minute after
 * a mistake is a correction, not an ambiguity.
 *
 * ── ONE FLOOR, AT THE END ───────────────────────────────────────────────────
 *
 * Pro-rating divides. Dividing per day and summing the results accumulates
 * floating-point error, and a whole month with a single unchanged fee would
 * then come out a cent short of the number on the client's actual invoice —
 * which is the one discrepancy nobody forgives. So every day contributes an
 * INTEGER (`amountCents × SCALE / daysInMonth`, exact because SCALE is
 * divisible by 28, 29, 30 and 31), the sum is exact integer arithmetic, and
 * there is exactly ONE rounding step — a single floor, at the end, in the
 * client's favour. The suite pins that there is only one.
 */
import { daysInLocalMonth, localDaysIn, type Period } from './period';

/**
 * The common denominator: `28 × 29 × 30 × 31`.
 *
 * Chosen so that `SCALE / daysInMonth` is an INTEGER for every possible month
 * length, which is what makes the per-day contribution exact and the
 * whole-month case collapse to precisely `amountCents` rather than to
 * `amountCents − 1`. At a $100,000 monthly fee the accumulated sum is still
 * four orders of magnitude below `Number.MAX_SAFE_INTEGER`.
 */
const SCALE = 28 * 29 * 30 * 31;

export interface FeeRow {
  kind: 'monthly' | 'setup';
  amountCents: number;
  /** `YYYY-MM-DD`, as the `date` column returns it. Compared as text — ISO dates sort. */
  effectiveFrom: string;
  /** The tie-break for two rows with the same `effective_from`. */
  createdAt: Date;
}

export interface FeesInForce {
  /**
   * The pro-rated monthly fee, or `null` when NO monthly schedule covers any
   * part of the period.
   *
   * `null` and `0` are different answers and are never conflated: `0` is a
   * client on a real, deliberate $0.00 arrangement (a pilot, a make-good
   * month), `null` is a client whose fee has not been entered yet. The report
   * renders the first as `$0.00` and the second as "no fee schedule", and
   * NEITHER produces a recovery multiple — see `multipleBasisPoints`.
   */
  monthlyCents: number | null;
  /** One-off setup fees whose `effective_from` falls in the period. Its own line. */
  setupCents: number;
  /** Local days that had a monthly fee in force. Evidence for the pro-rated figure. */
  daysCharged: number;
  /** Local days in the period. `daysCharged < daysInPeriod` means a mid-period change. */
  daysInPeriod: number;
}

/**
 * The monthly fee in force on one local day, or `null`.
 *
 * The greatest `effective_from` not after the day, ties broken by the later
 * `createdAt`. Text comparison is correct and deliberate: `YYYY-MM-DD` sorts
 * lexicographically in date order, and parsing these into instants would
 * reintroduce the zone question the `date` column exists to avoid.
 */
export function monthlyFeeInForceOn(rows: readonly FeeRow[], localDay: string): FeeRow | null {
  let best: FeeRow | null = null;

  for (const row of rows) {
    if (row.kind !== 'monthly') continue;
    if (row.effectiveFrom > localDay) continue;

    if (best === null) {
      best = row;
      continue;
    }
    if (row.effectiveFrom > best.effectiveFrom) {
      best = row;
      continue;
    }
    // Same effective date: the row entered LATER is the correction.
    if (row.effectiveFrom === best.effectiveFrom && row.createdAt.getTime() > best.createdAt.getTime()) {
      best = row;
    }
  }

  return best;
}

/**
 * Whether any monthly schedule covers any part of the period.
 *
 * TRUE for a schedule that starts mid-period: a client onboarded on the 20th
 * has a fee for that month, it is simply a smaller one. The days before it
 * contribute zero rather than making the whole month `null` — which would
 * render as "no fee schedule" on a report that has a real, payable fee on it.
 */
export function hasMonthlyFeeInForce(
  rows: readonly FeeRow[],
  period: Period,
  timeZone: string,
): boolean {
  // Keyed on the LAST LOCAL DAY the period covers, not on `period.end`. For a
  // calendar month those agree; for a rolling window ending mid-afternoon they
  // do not, and the `period.end` form would answer `null` for a schedule that
  // the pro-rating loop below is charging days against — a report whose
  // "no fee schedule" line contradicts its own arithmetic.
  const days = localDaysIn(period, timeZone);
  const lastDay = days[days.length - 1];
  if (lastDay === undefined) return false;

  return rows.some((row) => row.kind === 'monthly' && row.effectiveFrom <= lastDay);
}

/**
 * The fees in force over `period`, pro-rated by local day.
 *
 * Each local day is charged at the daily rate of the fee in force THAT DAY,
 * derived from the length of the month THAT DAY belongs to. A rolling window
 * spanning two months therefore charges July days at a 31st of July's fee and
 * August days at a 31st of August's — which is what "the fee in force" means
 * when the window is not a month.
 */
export function feesInForce(
  rows: readonly FeeRow[],
  period: Period,
  timeZone: string,
): FeesInForce {
  const days = localDaysIn(period, timeZone);

  let scaled = 0;
  let daysCharged = 0;

  for (const day of days) {
    const fee = monthlyFeeInForceOn(rows, day);
    if (fee === null) continue;

    const [year, month] = day.split('-').map(Number) as [number, number, number];
    const perDay = SCALE / daysInLocalMonth(timeZone, year, month);
    scaled += fee.amountCents * perDay;
    daysCharged += 1;
  }

  // Bounded by the days actually covered, so the setup line and the pro-rated
  // line describe the same stretch of calendar. EXCLUDED from the multiple's
  // denominator (A3) and footnoted as excluded: the 3x guarantee is quoted
  // against the retainer, and a $990 setup line would make every first-month
  // multiple look like a failure of a service that was in fact working.
  const firstDay = days[0];
  const lastDay = days[days.length - 1];
  const setupCents =
    firstDay === undefined || lastDay === undefined
      ? 0
      : rows.reduce(
          (sum, row) =>
            row.kind === 'setup' && row.effectiveFrom >= firstDay && row.effectiveFrom <= lastDay
              ? sum + row.amountCents
              : sum,
          0,
        );

  return {
    // THE one rounding step in this file. See the header.
    monthlyCents: hasMonthlyFeeInForce(rows, period, timeZone) ? Math.floor(scaled / SCALE) : null,
    setupCents,
    daysCharged,
    daysInPeriod: days.length,
  };
}
