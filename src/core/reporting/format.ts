/**
 * Display formatting for money, rates and multiples — the ONLY place a stored
 * integer becomes a decimal.
 *
 * Framework-free and importable by a server component, a print page or a digest
 * builder, for the same reason the constants module is: the figure and the
 * footnote that explains it must render through the same function. A page that
 * formats `$2,450.00` while its own methodology paragraph prints `2450` is a
 * document a client reads twice and trusts once.
 *
 * MONEY ON THIS DOCUMENT IS INVOICE-GRADE, SO CENTS PRINT. The audit's
 * whole-dollar rule is explicitly for ESTIMATES handed to a prospect; a
 * recovered-revenue line is a real quote total that the client can look up in
 * ServiceM8, and rounding it to the dollar invites exactly the "your number is
 * wrong" conversation the evidence chain exists to prevent.
 */
import { NO_VALUE } from '@/core/shared/tenant';

const MONEY = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Integer cents → `$2,450.00`.
 *
 * THE ONE DIVISION IN THE REPORTING PATH, and it happens here, at display time,
 * on a value that is already final and will never be summed again.
 */
export function formatCents(cents: number): string {
  return MONEY.format(cents / 100);
}

/**
 * Integer basis points → `7.1%`, or the em dash for "there is no rate".
 *
 * One decimal place, always — `7%` and `7.1%` in the same table read as two
 * different precisions of the same claim.
 */
export function formatRateBp(bp: number | null): string {
  return bp === null ? NO_VALUE : `${(bp / 100).toFixed(1)}%`;
}

/**
 * Integer basis points → `3.4×`, or the em dash for "there is no denominator".
 *
 * DIVISOR 10_000, NOT 100 — and the difference is a factor of one hundred on the
 * number this product is sold on. Basis points are hundredths of a PERCENT when
 * they carry a rate (`formatRateBp`), but ten-thousandths of ONE when they carry
 * a ratio. `multipleBasisPoints` returns a ratio: 1× is 10_000 bp, so a 3.4×
 * month is 34_000 bp and must not print as `340.0×`.
 *
 * The em dash renders as "no fee schedule" in context; what it must never do is
 * render as `0.0×` (which would accuse a working service of failing) or as `∞`.
 */
export function formatMultipleBp(bp: number | null): string {
  return bp === null ? NO_VALUE : `${(bp / 10_000).toFixed(1)}×`;
}
