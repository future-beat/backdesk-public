/**
 * Which baseline win rate this attribution is computed against — D-06, D-08,
 * D-09, as one resolver.
 *
 * The conservative figure is `gross × (1 − baseline)`, so this number decides
 * how much of a won job the service claims credit for. There are exactly two
 * sources and one rule for choosing between them:
 *
 *  - `'connect'` — the client's OWN pre-service win rate, measured once at
 *    connect over the same 90-day window as the audit and frozen forever
 *    (D-09). "How were they doing before we arrived" is a one-time fact; any
 *    later window contains our own wins.
 *  - `'default'` — the deliberately HIGH assumption, used when there is no
 *    usable history.
 *
 * THE PROSPECT-AUDIT RATE IS NOT A SOURCE. D-06 makes the connect-time figure
 * canonical; where a converted prospect's `prospects.baseline_win_rate` differs
 * it reaches the report as a FOOTNOTE for continuity with what they were sold
 * on, and is never computed from. This module reads one place.
 */
import { BASELINE_MIN_QUOTES, DEFAULT_BASELINE_WIN_RATE } from '@/core/audit/constants';

/**
 * The default rate as integer basis points, DERIVED from the constant rather
 * than typed a second time.
 *
 * `Math.round` is load-bearing exactly as it is for `RECOVERY_RATE_BASIS_POINTS`
 * in `aggregate.ts`, and it is load-bearing FOR THE EDIT rather than for today's
 * value. `0.7 * 10_000` happens to land on exactly 7000 in binary floating
 * point — but `0.07 * 10_000` is `700.0000000000001` and `0.57 * 10_000` is
 * `5699.999999999999`, and `DEFAULT_BASELINE_WIN_RATE` is explicitly flagged as
 * operator-confirmable (A1). Without the round, changing one constant would
 * propagate a non-integer basis-point count into money arithmetic this codebase
 * does not do — a bug introduced by a one-line edit the doc comment invites.
 *
 * This is the ONE float→int step in the attribution path; everything downstream
 * of it is integer arithmetic.
 */
export const DEFAULT_BASELINE_BP = Math.round(DEFAULT_BASELINE_WIN_RATE * 10_000);

export interface ResolvedBaseline {
  /** Integer basis points, 0..10_000. Never a float, never null. */
  rateBp: number;
  /** Which of the two sources produced it — the report footnote branches on this. */
  source: 'connect' | 'default';
  /**
   * `baseline_quotes_issued` as it stood, WHICHEVER source won.
   *
   * Carried even on the `'default'` branch because that is the branch whose
   * footnote has to explain itself: "fewer than 10 quotes in the baseline
   * window" and "no quotes at all" are different sentences, and the difference
   * is this number. `null` means the client has no connection row to measure.
   */
  sampleSize: number | null;
}

/**
 * The connect-time baseline, or the assumed one — never a zero.
 *
 * **`null` and `'0.0000'` MEAN DIFFERENT THINGS AND ARE NEVER CONFLATED.**
 * `'0.0000'` says this client issued quotes and won none: a real, measured,
 * usable baseline, and the branch where the service can honestly claim nearly
 * all of a win. `null` says there is nothing to measure — and treating that as
 * zero would attribute to the service every win the client would have made
 * anyway, on an invoice they can disprove from their own books. That is the
 * `computeBaseline` rule (`aggregate.ts`) carried one phase forward to the
 * place where it costs money.
 *
 * The thin-sample fallback runs in the SAME direction: `BASELINE_MIN_QUOTES` is
 * a floor below which a measured rate is a coin flip, and falling back to a
 * 70% assumption can only shrink our credit.
 */
export function resolveBaseline(input: {
  winRate: string | null;
  quotesIssued: number | null;
}): ResolvedBaseline {
  const sampleSize = input.quotesIssued ?? null;

  if (input.winRate === null || (input.quotesIssued ?? 0) < BASELINE_MIN_QUOTES) {
    return { rateBp: DEFAULT_BASELINE_BP, source: 'default', sampleSize };
  }

  // `numeric(5,4)` arrives from postgres.js as a STRING ('0.2500'). One
  // Number() at the boundary, one Math.round to basis points, integer from here.
  const rateBp = Math.round(Number(input.winRate) * 10_000);

  // ── THE COLUMN PERMITS MORE THAN A RATE CAN MEAN (07 WR-07) ───────────────
  //
  // `baseline_win_rate` is `numeric(5,4)`, so the column accepts up to 9.9999
  // and the schema-side CHECK is a separate migration. A value above 1.0 is not
  // a rate at all, and trusting it is expensive in three separate ways: it makes
  // `conservativeCents` throw `InvalidMoneyError` and quarantine the event
  // (CR-03), it will not fit the `smallint baseline_rate_bp` column above
  // 32767, and if it somehow landed it would claim a NEGATIVE share of a win.
  //
  // AN UNUSABLE MEASURED RATE IS THE SAME ANSWER AS NO MEASURED RATE, and it
  // falls back the same way the thin-sample arm above does — to the deliberately
  // HIGH default, which can only shrink our credit. Nothing here throws: this
  // module decides how much of a won job the service claims, and refusing to
  // decide is what wedges billing rather than what protects it.
  if (!Number.isFinite(rateBp) || rateBp < 0 || rateBp > 10_000) {
    return { rateBp: DEFAULT_BASELINE_BP, source: 'default', sampleSize };
  }

  return { rateBp, source: 'connect', sampleSize };
}
