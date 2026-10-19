/**
 * Where a month begins — D-10, and the D-15 rolling window beside it.
 *
 * ── WHY A MODULE AND NOT A DATE RANGE ───────────────────────────────────────
 *
 * "A win lands in the month its `won` event was DETECTED." That sentence is a
 * client-facing promise — "jobs won this month" stays literally true, and a
 * closed month never changes — and it is only true if "the month" means the
 * calendar month IN THE CLIENT'S OWN TIMEZONE. Every client is a Perth trade
 * business today, and Perth has no DST, which is exactly why this has to be
 * written carefully NOW: a zone bug here is invisible in `Australia/Perth` and
 * appears the day the first eastern-states client signs, as a report that
 * silently moves the first and last jobs of every month.
 *
 * ── THE ZONE BOUNDARY ───────────────────────────────────────────────────────
 *
 * Stored instants are UTC; every comparison of two instants is UTC
 * milliseconds. Zone resolution happens at exactly two points: constructing the
 * instant for a local wall-clock slot (`TZDate`'s numeric constructor reads its
 * components AS LOCAL TIME in the zone and resolves that date's offset,
 * including DST — the operation a stored UTC offset cannot perform), and
 * reading the local calendar date of an instant. Both live in this file.
 *
 * ── HALF-OPEN, EXCEPT WHERE IT IS NOT ───────────────────────────────────────
 *
 * A calendar `Period` is `[start, end)` — the last millisecond of August and
 * the first of September belong to different reports, and a closed interval
 * would put a midnight win in two of them. A rolling window is `[start, now]`
 * INCLUSIVE at the end, because its end is "now" and an event happening this
 * instant is inside the last 30 days by any reading. The two are different
 * instruments and are labelled as different on screen (D-15); they are also
 * different here, and `inPeriod` / `inRolling` are deliberately two functions
 * rather than one with a flag.
 */
import { TZDate, tz } from '@date-fns/tz';
import { addDays, addMonths, startOfMonth, subMonths } from 'date-fns';

/** Elapsed milliseconds in a day — the rolling window's unit. */
const DAY_MS = 86_400_000;

/** Two instants. `end` is EXCLUSIVE for a calendar period. See the header. */
export interface Period {
  start: Date;
  end: Date;
}

/** The local calendar date of an instant, as `TZDate` resolves it in `timeZone`. */
function localParts(instant: Date, timeZone: string): { year: number; month: number; day: number } {
  const local = new TZDate(instant.getTime(), timeZone);
  return { year: local.getFullYear(), month: local.getMonth() + 1, day: local.getDate() };
}

/**
 * `YYYY-MM-DD` in the tenant's zone.
 *
 * Built from `TZDate` getters rather than an `Intl` locale format: the
 * component order of a locale is an ICU fact that can change under us, and
 * these strings are COMPARED (fee `effective_from` is a `date` column and ISO
 * date strings sort correctly as text). A locale that reordered them would
 * silently break the fee schedule rather than merely look wrong.
 */
export function localDateString(instant: Date, timeZone: string): string {
  const { year, month, day } = localParts(instant, timeZone);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The calendar month `year-month` (1-based) as it falls in `timeZone`.
 *
 * `addMonths` on a `TZDate` returns a `TZDate` in the same zone, so the end is
 * the NEXT month's local midnight — which across a DST boundary is a different
 * UTC offset from the start, and correctly so. Adelaide's October 2026 runs
 * from `2026-09-30T14:30Z` to `2026-10-31T13:30Z`: one hour short of 31 days,
 * because that hour did not exist locally.
 */
export function calendarMonth(timeZone: string, year: number, month: number): Period {
  const start = new TZDate(year, month - 1, 1, timeZone);
  return { start: new Date(start.getTime()), end: new Date(addMonths(start, 1).getTime()) };
}

/** The month `now` falls in — the "generate current month" default. */
export function currentMonth(timeZone: string, now: Date): Period {
  const start = startOfMonth(now, { in: tz(timeZone) });
  return { start: new Date(start.getTime()), end: new Date(addMonths(start, 1).getTime()) };
}

/**
 * The month before the one `now` falls in — the U-5 default for the Generate
 * action, because the month an operator invoices for is the one that just
 * closed.
 */
export function previousMonth(timeZone: string, now: Date): Period {
  const start = subMonths(startOfMonth(now, { in: tz(timeZone) }), 1);
  return { start: new Date(start.getTime()), end: new Date(addMonths(start, 1).getTime()) };
}

/**
 * `[now − days, now]` in ELAPSED milliseconds — deliberately not calendar days.
 *
 * The `auditWindow` reasoning: a DST transition inside the window would
 * otherwise move its edge by an hour depending on when the page happened to be
 * rendered, and a live metric that changes because of a clock change is a
 * metric an operator stops trusting.
 */
export function rollingWindow(now: Date, days: number): Period {
  return { start: new Date(now.getTime() - days * DAY_MS), end: new Date(now.getTime()) };
}

/** Half-open: `[start, end)`. For calendar periods. See the header. */
export function inPeriod(at: Date, period: Period): boolean {
  return at.getTime() >= period.start.getTime() && at.getTime() < period.end.getTime();
}

/** Closed at the end: `[start, now]`. For rolling windows. See the header. */
export function inRolling(at: Date, window: Period): boolean {
  return at.getTime() >= window.start.getTime() && at.getTime() <= window.end.getTime();
}

/**
 * How many CALENDAR days the local month has — 28, 29, 30 or 31.
 *
 * Calendar days, not elapsed days: Adelaide's October 2026 is 31 days long even
 * though it contains 30 days and 23 hours of elapsed time. A monthly fee buys a
 * month, and the DST hour is not a refund.
 *
 * Day 0 of the following month is the last day of this one — the standard
 * overflow trick, done on a `TZDate` so the zone is never in doubt.
 */
export function daysInLocalMonth(timeZone: string, year: number, month: number): number {
  return new TZDate(year, month, 0, timeZone).getDate();
}

/** The local `YYYY-MM-DD` of a period's start — the `monthly_reports.period_start` value. */
export function periodStartDate(period: Period, timeZone: string): string {
  return localDateString(period.start, timeZone);
}

/**
 * Every local calendar date the period covers, as `YYYY-MM-DD`, ascending.
 *
 * A date is covered when its LOCAL MIDNIGHT falls inside the period. For a
 * calendar month that is exactly its 1st through its last — 31 strings for
 * August. For a rolling 30-day window ending mid-afternoon it is 30 strings,
 * skipping the partial day the window starts inside: a fee is charged by the
 * day, and half a Tuesday is not a billable unit either way.
 *
 * Advanced with `addDays` on a `TZDate` so a DST day is still ONE day. Stepping
 * by 86_400_000ms instead would drift an hour and eventually skip or repeat a
 * date, which as a fee bug means a client billed for 364 or 366 days a year.
 */
export function localDaysIn(period: Period, timeZone: string): string[] {
  const first = localParts(period.start, timeZone);
  let cursor = new TZDate(first.year, first.month - 1, first.day, timeZone);
  if (cursor.getTime() < period.start.getTime()) cursor = addDays(cursor, 1);

  const days: string[] = [];
  const end = period.end.getTime();
  // A year and a day of headroom: any period this product generates resolves
  // far inside it, and the bound exists so a malformed one terminates rather
  // than spinning inside a server action.
  for (let guard = 0; cursor.getTime() < end && guard < 400; guard += 1) {
    days.push(localDateString(new Date(cursor.getTime()), timeZone));
    cursor = addDays(cursor, 1);
  }

  return days;
}
