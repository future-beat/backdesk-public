/**
 * The fee schedule in force over a period (D-13).
 *
 * PURE. This is the DENOMINATOR of the number the whole service is sold on —
 * conservative recovered revenue over fees, against a 3x guarantee. The
 * assertion that matters most is the dullest one: **a whole month with one
 * unchanged fee collapses to exactly `amountCents`.** Pro-rating that arrives a
 * cent short of the client's actual invoice is the one discrepancy nobody
 * forgives, and it is precisely what per-day floating-point division produces.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  feesInForce,
  hasMonthlyFeeInForce,
  monthlyFeeInForceOn,
  type FeeRow,
} from '@/core/reporting/fees';
import { calendarMonth, rollingWindow } from '@/core/reporting/period';

const PERTH = 'Australia/Perth';
const ADELAIDE = 'Australia/Adelaide';

/** September 2026 — thirty local days, so the pro-rating fractions are readable. */
const SEPTEMBER = calendarMonth(PERTH, 2026, 9);

const FOUNDING = 29_700; // $297.00
const STANDARD = 59_700; // $597.00

function fee(over: Partial<FeeRow> = {}): FeeRow {
  return {
    kind: 'monthly',
    amountCents: FOUNDING,
    effectiveFrom: '2026-01-01',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  };
}

describe('feesInForce — a month with one unchanged fee', () => {
  it('collapses to EXACTLY the monthly amount, not a cent less', () => {
    const result = feesInForce([fee()], SEPTEMBER, PERTH);

    expect(result.monthlyCents).toBe(FOUNDING);
    expect(result.daysCharged).toBe(30);
    expect(result.daysInPeriod).toBe(30);
  });

  it('collapses exactly in every month length, including a DST one', () => {
    // 28, 29, 30 and 31 days all divide the internal scale, so none of them
    // leaves a remainder for the final floor to eat.
    expect(feesInForce([fee()], calendarMonth(PERTH, 2026, 8), PERTH).monthlyCents).toBe(FOUNDING);
    expect(feesInForce([fee()], calendarMonth(PERTH, 2026, 2), PERTH).monthlyCents).toBe(FOUNDING);
    expect(feesInForce([fee()], calendarMonth(PERTH, 2028, 2), PERTH).monthlyCents).toBe(FOUNDING);
    expect(feesInForce([fee()], calendarMonth(ADELAIDE, 2026, 10), ADELAIDE).monthlyCents).toBe(
      FOUNDING,
    );
  });
});

describe('feesInForce — a change mid-month', () => {
  it('pro-rates by local day and floors once', () => {
    // Days 1-15 at $297, days 16-30 at $597.
    const rows = [
      fee(),
      fee({
        amountCents: STANDARD,
        effectiveFrom: '2026-09-16',
        createdAt: new Date('2026-09-10T00:00:00.000Z'),
      }),
    ];

    const expected = Math.floor((15 / 30) * FOUNDING + (15 / 30) * STANDARD);

    expect(feesInForce(rows, SEPTEMBER, PERTH).monthlyCents).toBe(expected);
    expect(feesInForce(rows, SEPTEMBER, PERTH).monthlyCents).toBe(44_700);
  });

  it('charges only the days a mid-month schedule covers', () => {
    // A client onboarded on the 20th of a 30-day month: 11 days, days 1-19
    // contribute zero.
    const rows = [
      fee({ effectiveFrom: '2026-09-20', createdAt: new Date('2026-09-19T00:00:00.000Z') }),
    ];
    const result = feesInForce(rows, SEPTEMBER, PERTH);

    expect(result.daysCharged).toBe(11);
    expect(result.daysInPeriod).toBe(30);
    expect(result.monthlyCents).toBe(Math.floor((11 / 30) * FOUNDING));
  });

  it('does not answer "no fee schedule" for a month it is charging days against', () => {
    const rows = [
      fee({ effectiveFrom: '2026-09-20', createdAt: new Date('2026-09-19T00:00:00.000Z') }),
    ];

    expect(hasMonthlyFeeInForce(rows, SEPTEMBER, PERTH)).toBe(true);
  });
});

describe('feesInForce — null is not zero', () => {
  it('returns null when no monthly schedule covers the period', () => {
    // "No fee has been entered yet" — the report renders that, never $0.00.
    const result = feesInForce([], SEPTEMBER, PERTH);

    expect(result.monthlyCents).toBeNull();
    expect(result.daysCharged).toBe(0);
    expect(hasMonthlyFeeInForce([], SEPTEMBER, PERTH)).toBe(false);
  });

  it('returns null for a schedule that starts after the period ends', () => {
    const rows = [fee({ effectiveFrom: '2026-10-01' })];

    expect(feesInForce(rows, SEPTEMBER, PERTH).monthlyCents).toBeNull();
  });

  it('returns 0 — a real, deliberate $0.00 arrangement — and not null', () => {
    // A pilot or a make-good month. The report prints $0.00 and, separately,
    // no multiple. Conflating this with "not entered yet" would hide a decision
    // the operator actually made.
    const result = feesInForce([fee({ amountCents: 0 })], SEPTEMBER, PERTH);

    expect(result.monthlyCents).toBe(0);
    expect(result.monthlyCents).not.toBeNull();
  });
});

describe('monthlyFeeInForceOn — append-only, latest wins', () => {
  it('takes the greatest effective_from not after the day', () => {
    const rows = [
      fee({ effectiveFrom: '2026-01-01' }),
      fee({ amountCents: STANDARD, effectiveFrom: '2026-09-16' }),
    ];

    expect(monthlyFeeInForceOn(rows, '2026-09-15')?.amountCents).toBe(FOUNDING);
    expect(monthlyFeeInForceOn(rows, '2026-09-16')?.amountCents).toBe(STANDARD);
  });

  it('breaks a same-date tie with the later created_at', () => {
    // A correction typed a minute after a mistake is a correction, not an
    // ambiguity — the `tenant_attestations` latest-wins rule.
    const rows = [
      fee({
        amountCents: 99_700,
        effectiveFrom: '2026-09-01',
        createdAt: new Date('2026-08-30T09:00:00.000Z'),
      }),
      fee({
        amountCents: STANDARD,
        effectiveFrom: '2026-09-01',
        createdAt: new Date('2026-08-30T09:01:00.000Z'),
      }),
    ];

    expect(monthlyFeeInForceOn(rows, '2026-09-10')?.amountCents).toBe(STANDARD);
    expect(feesInForce(rows, SEPTEMBER, PERTH).monthlyCents).toBe(STANDARD);
  });

  it('ignores setup rows entirely', () => {
    const rows = [fee({ kind: 'setup', amountCents: 99_000, effectiveFrom: '2026-09-03' })];

    expect(monthlyFeeInForceOn(rows, '2026-09-10')).toBeNull();
  });
});

describe('the setup fee — its own line, out of the denominator (A3)', () => {
  it('lands in the month containing its effective_from and nowhere else', () => {
    const rows = [
      fee(),
      fee({ kind: 'setup', amountCents: 99_000, effectiveFrom: '2026-09-03' }),
    ];

    expect(feesInForce(rows, SEPTEMBER, PERTH).setupCents).toBe(99_000);
    expect(feesInForce(rows, calendarMonth(PERTH, 2026, 10), PERTH).setupCents).toBe(0);
  });

  it('is never folded into the monthly figure', () => {
    // The 3x guarantee is quoted against the retainer. A $990 setup line in the
    // denominator would make every first-month multiple look like a failure of
    // a service that was in fact working.
    const rows = [
      fee(),
      fee({ kind: 'setup', amountCents: 99_000, effectiveFrom: '2026-09-03' }),
    ];

    expect(feesInForce(rows, SEPTEMBER, PERTH).monthlyCents).toBe(FOUNDING);
  });
});

describe('feesInForce over a rolling window', () => {
  it('charges each day at the daily rate of the month that day belongs to', () => {
    // 28 July - 26 August 2026 in Perth: 4 July days at a 31st, 26 August days
    // at a 31st. Same rate here because the schedule did not change, but the
    // denominators are resolved per day, which is what "the fee in force" means
    // when the window is not a month.
    const window = rollingWindow(new Date('2026-08-26T06:23:00.000Z'), 30);
    const result = feesInForce([fee()], window, PERTH);

    expect(result.daysInPeriod).toBe(30);
    expect(result.daysCharged).toBe(30);
    expect(result.monthlyCents).toBe(Math.floor((30 / 31) * FOUNDING));
  });
});

describe('one rounding step', () => {
  it('floors exactly once, at the end', () => {
    // Dividing per day and summing the results accumulates floating-point error
    // — enough that a whole unchanged month comes out a cent short. The single
    // floor is what makes the collapse assertion at the top of this file hold.
    const source = readFileSync('src/core/reporting/fees.ts', 'utf8');

    expect(source.match(/Math\.floor/g)).toHaveLength(1);
  });
});
