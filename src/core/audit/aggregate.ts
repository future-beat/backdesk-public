/**
 * Every number in the Quote Leakage Audit, computed once (AUD-01, AUD-02).
 *
 * PURE. No database, no network, no clock except the one handed in. Three
 * separate callers depend on that:
 *
 *   - the prospect audit (API path, plan 02-06)
 *   - the prospect audit (CSV path, plan 02-07)
 *   - the client backfill baseline at connect (D-14)
 *
 * They must produce the same arithmetic, because the first is a sales promise
 * and the third is the yardstick the monthly report is measured against. If a
 * prospect's audit and their first report disagree about how their business was
 * doing, the disagreement is discovered by the client, in writing, after they
 * have paid. `AuditLine` is deliberately source-agnostic for that reason — the
 * shape carries no trace of whether it came from an API response, a CSV row, or
 * a `quotes` table row.
 *
 * ── INTEGER CENTS, EVERYWHERE, WITH NO EXCEPTIONS ───────────────────────────
 *
 * Nothing in this file performs floating-point arithmetic on money.
 * `0.1 + 0.2 === 0.30000000000000004`, and across three hundred quotes the
 * error is visible in the dollars column of a printed A4 page. Values arrive as
 * integer cents (parsed once by `parseMoneyToCents`, which is string math), are
 * summed as integers, and leave as integers or as `numeric`-column strings.
 * The recovery rate is applied in basis points for the same reason.
 */
import { AUDIT_RECOVERY_RATE, WINDOW_DAYS } from './constants';
import { graceDeadline } from './followup';

/**
 * One quote, normalized past its origin.
 *
 * `followedUp` is a CONCLUSION, not evidence: it is computed by `followup.ts`
 * at fetch time from records this module never sees. That split is what lets a
 * stored audit be recomputed after the raw signals have been purged (D-04) —
 * the boolean survives, the stranger's communication history does not.
 */
export interface AuditLine {
  /** One of the four ServiceM8 statuses, as it stands TODAY. */
  status: string;
  /** `null` for a job that was never issued as a quote (a zero-date). */
  quoteDateUtc: Date | null;
  valueCents: number | null;
  followedUp: boolean;
}

export interface AuditFigures {
  quotesIssued: number;
  totalValueCents: number;
  neverFollowedUpValueCents: number;
  recoverableEstimateCents: number;
}

export interface Baseline {
  /**
   * A `numeric(5,4)` string — or `null` when no quotes were issued.
   *
   * **`null` and `'0.0000'` mean different things and must never be conflated.**
   * `'0.0000'` says this client issued quotes and won none: a real, measured,
   * usable baseline. `null` says there is nothing to measure. Phase 7 subtracts
   * the baseline from observed wins to compute recovered revenue; fed a 0 where
   * the truth is "unknown", it attributes to the service every win the client
   * would have made anyway — an invoice they can disprove from their own books.
   */
  winRate: string | null;
  quotesIssued: number;
  quotesWon: number;
}

export interface AuditWindow {
  start: Date;
  end: Date;
}

/**
 * ServiceM8's fixed lifecycle, with "won" spanning BOTH terminal success
 * states.
 *
 * The four statuses do not progress linearly and a tradie can mark a job
 * `Completed` without it ever passing through `Work Order` (RESEARCH Pitfall 5)
 * — the same rule `classifyTransition` already follows for the event stream.
 * Counting only `Work Order` would understate the baseline for precisely the
 * clients who close work fastest.
 */
const WON_STATUSES: ReadonlySet<string> = new Set(['Work Order', 'Completed']);

/**
 * The recovery rate as an integer number of basis points, DERIVED from the
 * exported constant rather than typed a second time.
 *
 * `cents * 0.15` is a float multiplication on money, which this module does not
 * do. `cents * 1500 / 10_000` is integer arithmetic until the single final
 * division, which is then floored — so there is exactly one rounding step and
 * it is visible. `Math.round` on the conversion is a guard, not a repair:
 * `0.15 * 10_000` happens to be exactly `1500` in binary floating point, but
 * a rate edited to `0.07` or `0.57` would not be (`0.07 * 10_000` is
 * `700.0000000000001`), and the round keeps the basis points an integer no
 * matter what the constant becomes. (`src/core/attribution/baseline.ts` states
 * the same rule.)
 */
const RECOVERY_RATE_BASIS_POINTS = Math.round(AUDIT_RECOVERY_RATE * 10_000);

const DAY_MS = 86_400_000;

/**
 * The window ending at `now` and reaching `days` back.
 *
 * Computed in elapsed milliseconds rather than calendar days for the same
 * reason the grace period is (see `followup.ts`): a DST transition inside the
 * window would otherwise move its edge by an hour depending on where the audit
 * was run.
 */
export function auditWindow(now: Date = new Date(), days: number = WINDOW_DAYS): AuditWindow {
  return { start: new Date(now.getTime() - days * DAY_MS), end: new Date(now.getTime()) };
}

/**
 * INCLUSIVE at both ends — a quote issued exactly 90 days before the window end
 * is in the audit.
 *
 * Stated by a test rather than left to whichever comparison operator someone
 * happened to type. An exclusive lower bound silently shortens every audit by a
 * day, produces figures that are wrong by an amount nobody can detect, and
 * looks identical in review.
 */
export function isInWindow(quoteDateUtc: Date | null | undefined, window: AuditWindow): boolean {
  if (!quoteDateUtc || Number.isNaN(quoteDateUtc.getTime())) return false;

  const at = quoteDateUtc.getTime();
  return at >= window.start.getTime() && at <= window.end.getTime();
}

/** The `date`-column form of a window bound. */
export function windowDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * A job counts toward the audit only if it was ever issued as a quote.
 *
 * Jobs created straight to `Work Order` carry a ServiceM8 zero-date in
 * `quote_date`, which the boundary schemas normalize to `null`. Counting them
 * would inflate a walk-in-heavy tradie's "quotes issued" with work that was
 * never quoted, and — worse for AUD-02 — hand them a 100% baseline win rate
 * built entirely from jobs no customer ever had to say yes to.
 */
function wasQuoted(line: AuditLine): boolean {
  return line.quoteDateUtc != null && !Number.isNaN(line.quoteDateUtc.getTime());
}

/**
 * The four headline figures (AUD-01).
 *
 * Callers pass lines ALREADY FILTERED to the window (`isInWindow`). `now` is an
 * explicit argument rather than an implicit `new Date()` so a stored audit can
 * be reproduced exactly — the same input and the same instant always give the
 * same figures.
 *
 * ── A QUOTE STILL INSIDE ITS GRACE WINDOW IS NOT A LEAK ─────────────────────
 *
 * This was found by running the audit against the live trial account, whose
 * jobs were all seeded within 48 hours: all six came back as "never followed
 * up" and the leakage figure was the prospect's ENTIRE quoted value. The
 * arithmetic was right and the finding was nonsense — nothing can be past a
 * 72-hour deadline that has not arrived yet.
 *
 * D-10 defines the leak as "no signal AFTER quote_date + 3 days", which
 * presupposes those days have passed. A quote issued yesterday is not
 * neglected; it is PENDING, and the honest answer about it is "not yet known".
 * It still counts toward `quotesIssued` and `totalValueCents` — it was issued,
 * and it is quoted value — but it contributes nothing to the leak or to the
 * estimate derived from it.
 *
 * The commercial argument is the one the whole page rests on: the quotes a
 * prospect can check against their own memory are this week's, and being told
 * they neglected the job they sent yesterday discredits every other number on
 * the document.
 *
 * An empty input returns zeros — not `NaN`, and with no division anywhere near
 * it. A prospect with no quotes in ninety days still gets a report; it just
 * says zero, which is a finding. A `NaN` on a printed sales document is worse
 * than any number it could have shown.
 */
export function computeAuditFigures(
  lines: readonly AuditLine[],
  now: Date = new Date(),
): AuditFigures {
  let quotesIssued = 0;
  let totalValueCents = 0;
  let neverFollowedUpValueCents = 0;

  for (const line of lines) {
    if (!wasQuoted(line)) continue;

    quotesIssued += 1;

    const value = line.valueCents ?? 0;
    totalValueCents += value;

    // Inclusive at the deadline, matching `isFollowedUp`: the instant a
    // follow-up would still have counted is the instant silence starts to.
    const graceElapsed = graceDeadline(line.quoteDateUtc!).getTime() <= now.getTime();
    if (graceElapsed && !line.followedUp) neverFollowedUpValueCents += value;
  }

  return {
    quotesIssued,
    totalValueCents,
    neverFollowedUpValueCents,
    // FLOORED, never rounded. The half-cent always falls in the prospect's
    // favour: D-09 forbids overstating this figure in either direction of
    // arithmetic, because it is the number the 3x-fees guarantee is written
    // against.
    recoverableEstimateCents: Math.floor(
      (neverFollowedUpValueCents * RECOVERY_RATE_BASIS_POINTS) / 10_000,
    ),
  };
}

/**
 * The baseline win rate (AUD-02) — of the quotes issued in the window, the
 * fraction that stand in a won status TODAY.
 *
 * STATUS NOW, NOT STATUS THEN, and that is a decision rather than a
 * convenience. A quote issued inside the window and won a month after it closed
 * still counts as won. Restricting wins to the window would systematically
 * understate every baseline, because quotes take time to convert and the most
 * recent ones in any window have had the least of it — the bias would run in
 * the direction that flatters the service's later attribution, which is exactly
 * the direction an honest baseline must not lean.
 */
export function computeBaseline(lines: readonly AuditLine[]): Baseline {
  let quotesIssued = 0;
  let quotesWon = 0;

  for (const line of lines) {
    if (!wasQuoted(line)) continue;
    quotesIssued += 1;
    if (WON_STATUSES.has(line.status)) quotesWon += 1;
  }

  // See `Baseline.winRate` — the one branch in this file that must never be
  // simplified into `quotesWon / Math.max(quotesIssued, 1)`.
  if (quotesIssued === 0) return { winRate: null, quotesIssued: 0, quotesWon: 0 };

  // Scaled to 4 decimal places as an INTEGER before being formatted, so the
  // output always has exactly the shape `numeric(5,4)` accepts. Producing
  // '0.33333333' here is a failed INSERT at connect time — a reporting nicety
  // turning into an onboarding outage.
  const scaled = Math.round((quotesWon * 10_000) / quotesIssued);
  const winRate = `${Math.floor(scaled / 10_000)}.${String(scaled % 10_000).padStart(4, '0')}`;

  return { winRate, quotesIssued, quotesWon };
}
