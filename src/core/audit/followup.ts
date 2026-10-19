/**
 * D-10: did anything happen after this quote went out?
 *
 * Pure date arithmetic. The function knows nothing about where signals come
 * from — the caller assembles them from notes' `create_date`, job activities'
 * `start_date`, the status-change timestamps (`work_order_date`,
 * `completion_date`, `unsuccessful_date`) and `quote_sent_stamp`. Keeping the
 * sources out of here is what lets the CSV path (plan 02-07), which has access
 * to almost none of them, use the identical rule with a shorter list.
 *
 * ── WHY 72 HOURS AND NOT THREE CALENDAR DAYS ────────────────────────────────
 *
 * `addDays(someDate, 3)` in date-fns operates on a Date in the RUNNER'S LOCAL
 * ZONE, adding calendar days. Across a DST transition that is 71 or 73 hours,
 * so the same quote and the same follow-up would be classified differently
 * depending on where the server that ran the audit happened to be, twice a
 * year, for one weekend. The audit's figures would move without anyone editing
 * anything.
 *
 * So the addition is performed on a `TZDate` pinned to UTC, which has no DST
 * and therefore no 23- or 25-hour days: the boundary is exactly 72 hours after
 * the quote, everywhere, always. That is also the rule the tests pin one second
 * either side of, and a rule that cannot be stated to the second is a rule the
 * report cannot honestly describe.
 *
 * ── THE BOUNDARY IS INCLUSIVE, AND THAT DIRECTION IS CHOSEN ─────────────────
 *
 * A signal AT exactly quote + 72h counts as a follow-up. Every ambiguity in
 * this function is resolved toward "they followed up", because the commercial
 * cost of the two errors is not symmetric: a missed follow-up shrinks the
 * leakage figure slightly, while a wrongly-claimed leak is a specific,
 * checkable accusation about a quote the prospect remembers chasing.
 */
import { TZDate } from '@date-fns/tz';
import { addDays } from 'date-fns';

import { GRACE_PERIOD_DAYS } from './constants';

/**
 * The instant at which silence stops being excusable — quote + 72h.
 *
 * Exported so the fetch layer can decide how far back companion records are
 * worth requesting, and so the boundary is a value with a name rather than an
 * expression repeated at two call sites.
 */
export function graceDeadline(quoteDateUtc: Date): Date {
  // UTC has no DST, so `addDays` here is exactly GRACE_PERIOD_DAYS × 24h.
  return new Date(addDays(new TZDate(quoteDateUtc, 'UTC'), GRACE_PERIOD_DAYS).getTime());
}

/**
 * True when at least one signal lands at or after the grace deadline.
 *
 * Returns `false` for a quote with no date. A job whose `quote_date` is a
 * ServiceM8 zero-date was never issued as a quote (RESEARCH Pitfall 3), so it
 * has no grace window to be inside or outside of — and `null + 3 days` must
 * fail here, loudly and on purpose, rather than becoming an `Invalid Date`
 * whose every comparison is `false` for entirely the wrong reason. The
 * aggregation excludes such lines from `quotes issued` anyway; this is the
 * second half of the same statement.
 */
export function isFollowedUp(
  quoteDateUtc: Date | null | undefined,
  signals: ReadonlyArray<Date | null | undefined>,
): boolean {
  if (!quoteDateUtc || Number.isNaN(quoteDateUtc.getTime())) return false;

  const deadline = graceDeadline(quoteDateUtc).getTime();

  return signals.some(
    (signal) => signal != null && !Number.isNaN(signal.getTime()) && signal.getTime() >= deadline,
  );
}
