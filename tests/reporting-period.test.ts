/**
 * Where a month begins, in the client's own timezone (D-10, D-15).
 *
 * PURE. Every client is a Perth trade business today and Perth has no DST,
 * which is precisely why this suite tests Adelaide: a zone bug here is
 * INVISIBLE in `Australia/Perth` and surfaces the day the first eastern-states
 * client signs, as a report that silently moves the first and last jobs of
 * every month. The Adelaide October case and the `T23:30Z` case exist to fail
 * now rather than then.
 *
 * Boundaries are tested from BOTH sides. A half-open assertion that only checks
 * "the 15th is in August" passes for an implementation with no upper bound at
 * all; the `15:59:59.999Z` / `16:00:00.000Z` pair is what makes it mean
 * something.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  calendarMonth,
  currentMonth,
  daysInLocalMonth,
  inPeriod,
  inRolling,
  localDateString,
  localDaysIn,
  periodStartDate,
  previousMonth,
  rollingWindow,
} from '@/core/reporting/period';

const PERTH = 'Australia/Perth';
const ADELAIDE = 'Australia/Adelaide';

describe('calendarMonth — D-10, in the tenant zone', () => {
  it('puts Perth August 2026 at [2026-07-31T16:00Z, 2026-08-31T16:00Z)', () => {
    const august = calendarMonth(PERTH, 2026, 8);

    expect(august.start.toISOString()).toBe('2026-07-31T16:00:00.000Z');
    expect(august.end.toISOString()).toBe('2026-08-31T16:00:00.000Z');
  });

  it('is half-open at the boundary, to the millisecond', () => {
    // The last millisecond of August and the first of September belong to
    // different reports. A closed interval would put a midnight win in two.
    const august = calendarMonth(PERTH, 2026, 8);

    expect(inPeriod(new Date('2026-08-31T15:59:59.999Z'), august)).toBe(true);
    expect(inPeriod(new Date('2026-08-31T16:00:00.000Z'), august)).toBe(false);
    expect(inPeriod(new Date('2026-07-31T16:00:00.000Z'), august)).toBe(true);
    expect(inPeriod(new Date('2026-07-31T15:59:59.999Z'), august)).toBe(false);
  });

  it('spans the Adelaide DST change without losing or inventing an hour', () => {
    // ACST (+9:30) to ACDT (+10:30) on 4 October 2026. October is 31 CALENDAR
    // days but 30 days and 23 hours of elapsed time — a monthly fee buys the
    // month, and the DST hour is not a refund.
    const october = calendarMonth(ADELAIDE, 2026, 10);

    expect(october.start.toISOString()).toBe('2026-09-30T14:30:00.000Z');
    expect(october.end.toISOString()).toBe('2026-10-31T13:30:00.000Z');
    expect(daysInLocalMonth(ADELAIDE, 2026, 10)).toBe(31);
    expect(october.end.getTime() - october.start.getTime()).toBe(31 * 86_400_000 - 3_600_000);
  });

  it('knows how long every kind of month is', () => {
    expect(daysInLocalMonth(PERTH, 2026, 9)).toBe(30);
    expect(daysInLocalMonth(PERTH, 2026, 2)).toBe(28);
    expect(daysInLocalMonth(PERTH, 2028, 2)).toBe(29);
  });
});

describe('localDateString — the local calendar date of an instant', () => {
  it('lands a late-evening UTC instant on the NEXT day in Perth', () => {
    // 23:30Z is 07:30 the following morning in Perth. An implementation reading
    // UTC components would file that win in the wrong month twice a year and
    // in the wrong day every day.
    expect(localDateString(new Date('2026-08-14T23:30:00.000Z'), PERTH)).toBe('2026-08-15');
  });

  it('agrees with itself across a DST change', () => {
    expect(localDateString(new Date('2026-10-03T14:30:00.000Z'), ADELAIDE)).toBe('2026-10-04');
    expect(localDateString(new Date('2026-10-04T13:30:00.000Z'), ADELAIDE)).toBe('2026-10-05');
  });

  it('gives the period_start value a monthly report row stores', () => {
    expect(periodStartDate(calendarMonth(PERTH, 2026, 8), PERTH)).toBe('2026-08-01');
  });
});

describe('currentMonth / previousMonth — the U-5 default', () => {
  const now = new Date('2026-09-02T02:00:00.000Z'); // 10:00 on 2 September in Perth

  it('resolves the month the instant falls in', () => {
    expect(currentMonth(PERTH, now).start.toISOString()).toBe('2026-08-31T16:00:00.000Z');
  });

  it('defaults the Generate action to the month that just closed', () => {
    const previous = previousMonth(PERTH, now);

    expect(previous.start.toISOString()).toBe('2026-07-31T16:00:00.000Z');
    expect(previous.end.toISOString()).toBe('2026-08-31T16:00:00.000Z');
    expect(previous).toEqual(calendarMonth(PERTH, 2026, 8));
  });
});

describe('rollingWindow — D-15, and why it is a different instrument', () => {
  const now = new Date('2026-08-26T06:23:00.000Z');
  const window = rollingWindow(now, 30);

  it('reaches back exactly 30 x 86_400_000 elapsed milliseconds', () => {
    // Elapsed, not calendar: a live metric that moves because of a DST change
    // is a metric an operator stops trusting.
    expect(now.getTime() - window.start.getTime()).toBe(30 * 86_400_000);
    expect(window.start.toISOString()).toBe('2026-07-27T06:23:00.000Z');
  });

  it('is INCLUSIVE at the end, unlike a calendar month', () => {
    // Its end is "now". An event happening this instant is inside the last 30
    // days by any reading.
    expect(inRolling(now, window)).toBe(true);
    expect(inPeriod(now, window)).toBe(false);
    expect(inRolling(new Date(now.getTime() + 1), window)).toBe(false);
    expect(inRolling(window.start, window)).toBe(true);
    expect(inRolling(new Date(window.start.getTime() - 1), window)).toBe(false);
  });
});

describe('localDaysIn — the fee schedule unit', () => {
  it('covers a calendar month exactly, first to last', () => {
    const days = localDaysIn(calendarMonth(PERTH, 2026, 8), PERTH);

    expect(days).toHaveLength(31);
    expect(days[0]).toBe('2026-08-01');
    expect(days[30]).toBe('2026-08-31');
  });

  it('counts a DST month as 31 days, each advanced by one local day', () => {
    // Stepping by 86_400_000ms would drift an hour and eventually skip or
    // repeat a date — as a fee bug, a client billed for 364 or 366 days a year.
    const days = localDaysIn(calendarMonth(ADELAIDE, 2026, 10), ADELAIDE);

    expect(days).toHaveLength(31);
    expect(days[3]).toBe('2026-10-04');
    expect(days[4]).toBe('2026-10-05');
  });

  it('skips the partial day a rolling window starts inside', () => {
    const days = localDaysIn(rollingWindow(new Date('2026-08-26T06:23:00.000Z'), 30), PERTH);

    // The window opens at 14:23 local on 27 July; that Monday is not a billable
    // unit either way, so the first whole local day is the 28th.
    expect(days).toHaveLength(30);
    expect(days[0]).toBe('2026-07-28');
    expect(days[29]).toBe('2026-08-26');
  });
});

describe('the zone boundary is where it says it is', () => {
  it('resolves zones through TZDate and never from bare year/month parts', () => {
    // `new Date(2026, 7, 1)` is midnight in the SERVER's zone — which on Vercel
    // is UTC and in local development is not. It would produce a month that is
    // correct on one machine and eight hours wrong on the other, which is the
    // hardest possible bug to see.
    const source = readFileSync('src/core/reporting/period.ts', 'utf8');

    expect(source).toMatch(/from '@date-fns\/tz'/);
    expect(source).not.toMatch(/new Date\(\s*year/);
    expect(source).not.toMatch(/new Date\(\d{4},/);
  });
});
