/**
 * Money arithmetic for attribution — integer cents and integer basis points,
 * with every rounding step visible and every one of them floored toward the
 * client (D-07).
 *
 * There is no `Number(x) * rate` in this file and there must not be one
 * anywhere downstream. Binary floating point cannot represent 0.10, and these
 * numbers are what a recovered-revenue invoice is written against — the one
 * document in this product a client will read with a calculator.
 *
 * The guards THROW rather than repairing. A non-integer cent count or a
 * baseline outside 0..100% is a fact about OUR code, not about anything a
 * customer did; every available repair (clamp, round, treat as zero) is a
 * billing decision made by accident inside a background consumer.
 */
import { parseMoneyToCents } from '@/core/servicem8/normalize';

/** Thrown for an input this module refuses to compute with. Named, so a caller can catch it. */
export class InvalidMoneyError extends Error {
  override readonly name = 'InvalidMoneyError';
}

/**
 * `gross × (1 − baseline)`, floored — the conservative figure (D-07).
 *
 * FLOORED, never rounded: the half-cent always falls in the client's favour,
 * the same rule `recoverableEstimateCents` follows in the audit. Never negative,
 * because `rateBp` is bounded at 10_000 — a 100% baseline yields exactly 0,
 * which is the honest answer for a client who was already winning everything.
 *
 * Written as `gross * (10_000 − rateBp) / 10_000` so the multiplication happens
 * in integers and there is EXACTLY ONE division, at the end, floored.
 */
export function conservativeCents(grossCents: number, rateBp: number): number {
  if (!Number.isInteger(grossCents) || grossCents < 0) {
    throw new InvalidMoneyError(
      `grossCents must be a non-negative integer number of cents, got ${String(grossCents)}`,
    );
  }
  if (!Number.isInteger(rateBp) || rateBp < 0 || rateBp > 10_000) {
    throw new InvalidMoneyError(
      `rateBp must be an integer in 0..10_000 basis points, got ${String(rateBp)}`,
    );
  }

  return Math.floor((grossCents * (10_000 - rateBp)) / 10_000);
}

/**
 * `numerator ÷ fee` as integer basis points — the recovery multiple (D-13).
 *
 * `null` when there is no fee schedule yet AND when the fee in force is $0.00.
 * Both are "there is no denominator", and both must render as "no fee schedule"
 * rather than as `∞` or as a spectacularly good month. Returning null here is
 * what makes the division-by-zero branch UNREACHABLE downstream rather than
 * merely unlikely.
 *
 * FLOORED, again toward the client: a 3.0× guarantee measured with a rounded-up
 * multiple is a guarantee met on a rounding error.
 */
export function multipleBasisPoints(numeratorCents: number, feeCents: number | null): number | null {
  if (feeCents === null || feeCents === 0) return null;
  return Math.floor((numeratorCents * 10_000) / feeCents);
}

/**
 * `quotes.total_invoice_amount` (a `numeric(12,2)` STRING) → integer cents.
 *
 * Delegates to the Phase 2 parser rather than re-deriving it: that function is
 * regex + integer parse with no floating-point operation at any step, and a
 * second money parser in this codebase is a second set of edge cases to keep in
 * agreement. `null` in, `null` out — and `null` OUT for an unparseable string
 * too, which the decision treats as `valueSource: 'missing'` rather than as a
 * zero it could quietly bill against.
 */
export function grossCentsFromNumeric(raw: string | null | undefined): number | null {
  return parseMoneyToCents(raw);
}
