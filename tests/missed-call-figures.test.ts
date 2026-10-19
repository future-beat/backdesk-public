/**
 * THE MISSED-CALL FIGURES, DERIVED (Phase 15, RPT-04 / D-03, D-10).
 *
 * PURE — `computeMissedCallFigures` takes integers and returns the frozen
 * block. The frozen monthly row and the live month-to-date page call the SAME
 * function, so the two cannot disagree about a median; this suite is where
 * that one definition is pinned.
 *
 * D-10 in code: every rate carries its numerator and denominator, and an
 * absence is `null`, never `0` — "no samples" is a different statement from
 * "zero seconds".
 */
import { describe, expect, it } from 'vitest';

import {
  computeMissedCallFigures,
  type MissedCallCounts,
} from '@/core/reporting/missed-call-figures';
import { reportMissedCallsSchema } from '@/core/reporting/document';

function counts(overrides: Partial<MissedCallCounts> = {}): MissedCallCounts {
  return {
    captured: 0,
    withheld: 0,
    afterHours: 0,
    byHour: Array.from({ length: 24 }, () => 0),
    byIsoWeekday: Array.from({ length: 7 }, () => 0),
    afterHoursByIsoWeekday: Array.from({ length: 7 }, () => 0),
    textBacksSent: 0,
    textBacksDelivered: 0,
    deliveredSeconds: [],
    repliedLeadsOnDelivered: 0,
    leads: 0,
    jobsCreated: 0,
    jobsWon: 0,
    bookedByTradie: 0,
    ...overrides,
  };
}

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

describe('computeMissedCallFigures — an empty month', () => {
  const figures = computeMissedCallFigures(counts());

  it('has null rates over zero denominators, never 0', () => {
    expect(figures.afterHours).toEqual({ numerator: 0, denominator: 0, rateBp: null });
    expect(figures.replyRate).toEqual({ numerator: 0, denominator: 0, rateBp: null });
  });

  it('has no samples: median and P90 are null', () => {
    expect(figures.textBacks.medianSeconds).toBeNull();
    expect(figures.textBacks.p90Seconds).toBeNull();
  });

  it('keeps the three split arrays at 24 / 7 / 7, all zero', () => {
    expect(figures.byHour).toHaveLength(24);
    expect(figures.byIsoWeekday).toHaveLength(7);
    expect(figures.afterHoursByIsoWeekday).toHaveLength(7);
    expect([...figures.byHour, ...figures.byIsoWeekday, ...figures.afterHoursByIsoWeekday].every((n) => n === 0)).toBe(true);
  });

  it('parses through the frozen schema', () => {
    expect(reportMissedCallsSchema.parse(figures)).toEqual(figures);
  });
});

describe('computeMissedCallFigures — median and P90', () => {
  const speed = (deliveredSeconds: number[]) =>
    computeMissedCallFigures(counts({ deliveredSeconds, textBacksDelivered: deliveredSeconds.length })).textBacks;

  it('n = 1: both are the one sample', () => {
    expect(speed([42])).toMatchObject({ medianSeconds: 42, p90Seconds: 42 });
  });

  it('n = 2: the median is the average of the middle pair', () => {
    expect(speed([10, 20]).medianSeconds).toBe(15);
    expect(speed([20, 10]).p90Seconds).toBe(20);
  });

  it('n = 9: P90 is sorted[ceil(0.9 * 9) - 1] = sorted[8]', () => {
    expect(speed(range(9)).p90Seconds).toBe(9);
    expect(speed(range(9)).medianSeconds).toBe(5);
  });

  it('n = 10: P90 is sorted[8]', () => {
    expect(speed(range(10)).p90Seconds).toBe(9);
    expect(speed(range(10)).medianSeconds).toBe(6);
  });

  it('n = 11: P90 is sorted[9]', () => {
    expect(speed(range(11)).p90Seconds).toBe(10);
    expect(speed(range(11)).medianSeconds).toBe(6);
  });

  it('is order-independent', () => {
    expect(speed([9, 1, 5, 3, 7])).toEqual(speed([1, 3, 5, 7, 9]));
  });

  it('clamps a negative (provider clock skew) to 0 and rounds the median to an integer', () => {
    expect(speed([-5, 7]).medianSeconds).toBe(4);
    expect(speed([-5]).medianSeconds).toBe(0);
    expect(speed([-5]).p90Seconds).toBe(0);
  });
});

describe('computeMissedCallFigures — rates carry their denominators', () => {
  it('after hours is afterHours over captured', () => {
    const figures = computeMissedCallFigures(counts({ afterHours: 3, captured: 12 }));
    expect(figures.afterHours).toEqual({ numerator: 3, denominator: 12, rateBp: 2500 });
    expect(figures.captured).toBe(12);
  });

  it('reply rate is replied leads over DELIVERED text-backs', () => {
    const figures = computeMissedCallFigures(
      counts({ repliedLeadsOnDelivered: 2, textBacksDelivered: 8, textBacksSent: 11 }),
    );
    expect(figures.replyRate).toEqual({ numerator: 2, denominator: 8, rateBp: 2500 });
    expect(figures.textBacks.sent).toBe(11);
    expect(figures.textBacks.delivered).toBe(8);
  });
});

describe('computeMissedCallFigures — pass-through', () => {
  it('passes the funnel and withheld through unchanged', () => {
    const figures = computeMissedCallFigures(
      counts({ leads: 7, jobsCreated: 4, jobsWon: 2, bookedByTradie: 1, withheld: 3 }),
    );
    expect(figures.funnel).toEqual({ leads: 7, jobsCreated: 4, jobsWon: 2, bookedByTradie: 1 });
    expect(figures.withheld).toBe(3);
  });

  it('copies the split arrays rather than aliasing them', () => {
    const byHour = Array.from({ length: 24 }, (_, i) => i);
    const figures = computeMissedCallFigures(counts({ byHour }));
    expect(figures.byHour).toEqual(byHour);
    expect(figures.byHour).not.toBe(byHour);
  });
});

describe('computeMissedCallFigures — a wrong array length is our bug', () => {
  it('throws on byHour of length 23', () => {
    expect(() => computeMissedCallFigures(counts({ byHour: Array.from({ length: 23 }, () => 0) }))).toThrow();
  });

  it('throws on byIsoWeekday of length 6 and afterHoursByIsoWeekday of length 8', () => {
    expect(() => computeMissedCallFigures(counts({ byIsoWeekday: [0, 0, 0, 0, 0, 0] }))).toThrow();
    expect(() =>
      computeMissedCallFigures(counts({ afterHoursByIsoWeekday: Array.from({ length: 8 }, () => 0) })),
    ).toThrow();
  });
});
