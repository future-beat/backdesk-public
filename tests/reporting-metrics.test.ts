/**
 * The five-plus-one instrumentation metrics (RPT-03).
 *
 * PURE. Three surfaces read these numbers — the `/reports` overview, the
 * `/reports/[client]` detail page and the 06:30 digest — and they compute
 * through this one file, so the property under test is really "the three
 * screens cannot disagree, because they cannot compute differently".
 *
 * The suite leans hardest on the EMPTY cases. A metric with no denominator is
 * the common state of a brand-new client, and every wrong answer available
 * there is a specific lie: `0%` says the service is failing, `100%` says it is
 * perfect, and a not-a-number value says the console is broken. `null` is the
 * only honest one, and it is returned BEFORE any division happens.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  FIRST_TOUCH_HOURS,
  OPT_OUT_ALARM_MIN_CONTACTS,
  OPT_OUT_ALARM_RATE,
} from '@/core/audit/constants';
import type { FeeRow } from '@/core/reporting/fees';
import {
  FIRST_TOUCH_MS,
  LIVE_METRICS_WINDOW_DAYS,
  OPT_OUT_ALARM_BP,
  computeTenantMetrics,
  escalationSpeed,
  firstTouchRate,
  humanEditRate,
  isOptOutAlarming,
  meanEditDistanceBp,
  onboardedAt,
  optOutRate,
  rateBasisPoints,
  replyRate,
  sortForOverview,
  withinFirstTouchWindow,
  type TenantMetricCounts,
  type TenantMetrics,
} from '@/core/reporting/metrics';
import { calendarMonth, rollingWindow } from '@/core/reporting/period';

const PERTH = 'Australia/Perth';
const NOW = new Date('2026-08-26T06:23:00.000Z');
const WINDOW = rollingWindow(NOW, LIVE_METRICS_WINDOW_DAYS);

function monthlyFee(amountCents: number): FeeRow {
  return {
    kind: 'monthly',
    amountCents,
    effectiveFrom: '2026-01-01',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function counts(over: Partial<TenantMetricCounts> = {}): TenantMetricCounts {
  return {
    tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    tenantName: 'Alpha Electrical',
    timezone: PERTH,
    quotesOpened: 0,
    quotesFirstTouch24h: 0,
    cadencesTouched: 0,
    cadencesReplied: 0,
    contactsTouched: 0,
    contactsOptedOut: 0,
    draftsApproved: 0,
    draftsEdited: 0,
    editDistanceSum: '0',
    conservativeCents: 0,
    escalationLatencyMinutes: [],
    fees: [],
    // 2026-10 (Phase 15, 15-03): the overview's calls column, zero by default.
    missedCalls: 0,
    missedCallsAfterHours: 0,
    hasDivertNumber: false,
    ...over,
  };
}

describe('rateBasisPoints — the one rounding step per rate', () => {
  it('rounds once to integer basis points', () => {
    // 10_000 / 14 = 714.2857...
    expect(rateBasisPoints(1, 14)).toBe(714);
    expect(rateBasisPoints(3, 42)).toBe(714);
    expect(rateBasisPoints(1, 1)).toBe(10_000);
    expect(rateBasisPoints(0, 42)).toBe(0);
  });

  it('rounds rather than floors, because these are diagnostics and not money', () => {
    // 99.996% should read as 100.0% on a screen. The money in this phase floors;
    // the instruments round; the two rules live in different files on purpose.
    expect(rateBasisPoints(24_999, 25_000)).toBe(10_000);
  });

  it('returns null for an empty denominator — never 0, never 100%', () => {
    expect(rateBasisPoints(0, 0)).toBeNull();
    expect(rateBasisPoints(5, 0)).toBeNull();
  });
});

describe('every rate is null on an empty denominator', () => {
  const empty = counts();

  it('is null for a brand-new client with no history at all', () => {
    expect(firstTouchRate(empty)).toEqual({ numerator: 0, denominator: 0, rateBp: null });
    expect(replyRate(empty).rateBp).toBeNull();
    expect(optOutRate(empty).rateBp).toBeNull();
    expect(humanEditRate(empty).rateBp).toBeNull();
    expect(meanEditDistanceBp(empty)).toBeNull();
  });

  it('never produces a non-finite number for any input', () => {
    const rates = [
      firstTouchRate(empty).rateBp,
      replyRate(empty).rateBp,
      optOutRate(empty).rateBp,
      humanEditRate(empty).rateBp,
      meanEditDistanceBp(empty),
    ];

    for (const value of rates) {
      expect(value === null || Number.isFinite(value)).toBe(true);
    }
  });

  it('carries both numbers so a page can print "3 of 42"', () => {
    const populated = counts({ contactsTouched: 42, contactsOptedOut: 3 });

    expect(optOutRate(populated)).toEqual({ numerator: 3, denominator: 42, rateBp: 714 });
  });
});

describe('isOptOutAlarming — one threshold, three surfaces (D-16)', () => {
  /**
   * A rate at `rateBp` over a denominator big enough to clear the sample floor,
   * so a threshold assertion is about the THRESHOLD and nothing else.
   */
  const atRate = (rateBp: number | null, denominator = OPT_OUT_ALARM_MIN_CONTACTS) => ({
    numerator: 0,
    denominator,
    rateBp,
  });

  it('is derived from the constant, not typed a second time', () => {
    expect(OPT_OUT_ALARM_BP).toBe(Math.round(OPT_OUT_ALARM_RATE * 10_000));
    expect(OPT_OUT_ALARM_BP).toBe(OPT_OUT_ALARM_RATE * 10_000);
  });

  it('alarms AT the threshold and not one basis point below', () => {
    expect(isOptOutAlarming(atRate(OPT_OUT_ALARM_BP))).toBe(true);
    expect(isOptOutAlarming(atRate(OPT_OUT_ALARM_BP - 1))).toBe(false);
    expect(isOptOutAlarming(atRate(10_000))).toBe(true);
    expect(isOptOutAlarming(atRate(0))).toBe(false);
  });

  it('does not alarm on a null rate', () => {
    // A client we have messaged nobody for has not upset anybody. A badge on
    // that row is a false accusation on the screen the operator triages from.
    expect(isOptOutAlarming(atRate(null, 0))).toBe(false);
  });

  it('needs a SAMPLE before it fires — the denominator floor (quick 260913-ind)', () => {
    // The bug this rule was written for: the live test tenant has one contact,
    // the operator's own handset, opted out during the Phase 4 STOP test. 1 of
    // 1 is a true 100% and a meaningless one, and it filled the daily digest
    // every morning for a rolling thirty days.
    expect(isOptOutAlarming({ numerator: 1, denominator: 1, rateBp: 10_000 })).toBe(false);

    // AT the floor it fires again — the same at-the-boundary-is-inside
    // convention as the threshold itself. 1 of 10 is 10%, above 5%.
    expect(
      isOptOutAlarming({
        numerator: 1,
        denominator: OPT_OUT_ALARM_MIN_CONTACTS,
        rateBp: 1_000,
      }),
    ).toBe(true);

    // One contact short of the floor, and unanimous, and still silent.
    expect(
      isOptOutAlarming({
        numerator: OPT_OUT_ALARM_MIN_CONTACTS - 1,
        denominator: OPT_OUT_ALARM_MIN_CONTACTS - 1,
        rateBp: 10_000,
      }),
    ).toBe(false);

    // The floor can only ever SILENCE. Above it, nothing changed: 1 of 20 is
    // exactly 5% and still alarms.
    expect(isOptOutAlarming({ numerator: 1, denominator: 20, rateBp: 500 })).toBe(true);
  });

  it('is the only place the threshold appears — no second literal in the module', () => {
    // The overview badge, the detail badge and the digest heading all import
    // this predicate. 07-05 pins that none of them carries its own number; this
    // pins that the module they import from does not either.
    const source = readFileSync('src/core/reporting/metrics.ts', 'utf8');

    expect(source).toContain('OPT_OUT_ALARM_RATE');
    expect(source).not.toMatch(/\b500\b/);
    expect(source).not.toContain('0.05');
  });
});

describe('withinFirstTouchWindow — D-18', () => {
  const opened = new Date('2026-08-01T00:00:00.000Z');

  it('derives the window from the constant', () => {
    expect(FIRST_TOUCH_MS).toBe(FIRST_TOUCH_HOURS * 3_600_000);
    expect(FIRST_TOUCH_MS).toBe(86_400_000);
  });

  it('counts a touch at exactly 24 hours', () => {
    expect(withinFirstTouchWindow(opened, new Date(opened.getTime() + FIRST_TOUCH_MS))).toBe(true);
  });

  it('does not count one millisecond later', () => {
    expect(withinFirstTouchWindow(opened, new Date(opened.getTime() + FIRST_TOUCH_MS + 1))).toBe(
      false,
    );
  });

  it('does not count a touch claimed BEFORE the quote was detected', () => {
    // A clock problem or a replay, not a fast follow-up. Counting it would let
    // a data bug flatter the one metric that says whether the service is
    // actually being delivered.
    expect(withinFirstTouchWindow(opened, new Date(opened.getTime() - 1))).toBe(false);
  });

  it('counts a touch in the same millisecond', () => {
    expect(withinFirstTouchWindow(opened, new Date(opened.getTime()))).toBe(true);
  });
});

describe('onboardedAt — the D-18 exclusion as one rule (A5)', () => {
  const templates = new Date('2026-07-01T00:00:00.000Z');
  const attested = new Date('2026-07-04T00:00:00.000Z');

  it('is the LATER of the two gate instants', () => {
    // The moment BOTH ONB gates first held — the moment a cadence could first
    // send. Quotes opened before it were born paused for onboarding.
    expect(onboardedAt(templates, attested)).toEqual(attested);
    expect(onboardedAt(attested, templates)).toEqual(attested);
  });

  it('is null when either gate has never been cleared', () => {
    // Every quote is EXCLUDED rather than defaulted in. Blaming the service for
    // not sending messages it was forbidden to send is the failure this rule
    // prevents.
    expect(onboardedAt(null, attested)).toBeNull();
    expect(onboardedAt(templates, null)).toBeNull();
    expect(onboardedAt(null, null)).toBeNull();
  });

  it('is either instant when they coincide', () => {
    const same = new Date('2026-07-04T00:00:00.000Z');

    expect(onboardedAt(same, new Date(same.getTime()))).toEqual(same);
  });
});

describe('meanEditDistanceBp — D-17', () => {
  it('converts the numeric string exactly once and rounds once', () => {
    // `edit_distance` is `numeric` and arrives from postgres.js as TEXT. Two
    // conversions on the way to a screen is two chances to disagree.
    expect(meanEditDistanceBp(counts({ draftsApproved: 4, editDistanceSum: '0.5200' }))).toBe(1_300);
    expect(meanEditDistanceBp(counts({ draftsApproved: 3, editDistanceSum: '0.1000' }))).toBe(333);
  });

  it('is null when nothing was approved', () => {
    expect(meanEditDistanceBp(counts({ draftsApproved: 0, editDistanceSum: '0' }))).toBeNull();
  });
});

describe('escalationSpeed — the median, not the mean', () => {
  it('is an absence, not a zero-minute response, when nothing escalated', () => {
    expect(escalationSpeed([])).toEqual({ count: 0, medianMinutes: null });
  });

  it('averages the middle two on an even count', () => {
    expect(escalationSpeed([3, 9])).toEqual({ count: 2, medianMinutes: 6 });
  });

  it('takes the middle one on an odd count, ignoring the outlier', () => {
    // One escalation that fired late because a phone was off must not hide a
    // week of two-minute responses — which is exactly what a mean would do
    // here (mean 4.3, median 2).
    expect(escalationSpeed([1, 2, 10])).toEqual({ count: 3, medianMinutes: 2 });
  });

  it('sorts before taking the middle, and does not mutate the caller array', () => {
    const input = [10, 1, 2];

    expect(escalationSpeed(input).medianMinutes).toBe(2);
    expect(input).toEqual([10, 1, 2]);
  });

  it('rounds an even-count median to a whole minute', () => {
    expect(escalationSpeed([3, 4]).medianMinutes).toBe(4);
  });
});

describe('computeTenantMetrics — the single derivation', () => {
  it('computes every metric from one counts snapshot', () => {
    const metrics = computeTenantMetrics(
      counts({
        quotesOpened: 20,
        quotesFirstTouch24h: 19,
        cadencesTouched: 18,
        cadencesReplied: 6,
        contactsTouched: 42,
        contactsOptedOut: 3,
        draftsApproved: 25,
        draftsEdited: 5,
        editDistanceSum: '1.2500',
        conservativeCents: 744_000,
        escalationLatencyMinutes: [2, 4, 40],
        fees: [monthlyFee(29_700)],
      }),
      WINDOW,
      NOW,
    );

    expect(metrics.firstTouch.rateBp).toBe(9_500);
    expect(metrics.reply.rateBp).toBe(3_333);
    expect(metrics.optOut.rateBp).toBe(714);
    expect(metrics.optOut.alarming).toBe(true);
    expect(metrics.humanEdit.rateBp).toBe(2_000);
    expect(metrics.humanEdit.meanEditDistanceBp).toBe(500);
    expect(metrics.escalation).toEqual({ count: 3, medianMinutes: 4 });
    expect(metrics.recovery.feesCents).toBe(Math.floor((30 / 31) * 29_700));
    expect(metrics.recovery.multipleBp).not.toBeNull();
  });

  it('gives no multiple when the client has no fee schedule', () => {
    const metrics = computeTenantMetrics(counts({ conservativeCents: 744_000 }), WINDOW, NOW);

    expect(metrics.recovery.feesCents).toBeNull();
    expect(metrics.recovery.multipleBp).toBeNull();
    expect(metrics.recovery.conservativeCents).toBe(744_000);
  });

  it('does not alarm a client with no contacts messaged', () => {
    expect(computeTenantMetrics(counts(), WINDOW, NOW).optOut.alarming).toBe(false);
  });

  it('clamps an unfinished period so it does not bill days that have not happened', () => {
    // A month-to-date view: 26 of August's 31 local days have elapsed at `now`.
    // Charging the whole month against a fortnight of recovered revenue would
    // report a failing multiple for a service that is doing fine.
    const august = calendarMonth(PERTH, 2026, 8);
    const metrics = computeTenantMetrics(
      counts({ conservativeCents: 100_000, fees: [monthlyFee(29_700)] }),
      august,
      NOW,
    );

    expect(metrics.recovery.feesCents).toBe(Math.floor((26 / 31) * 29_700));
  });

  it('is a no-op clamp for the rolling window, which already ends at now', () => {
    const metrics = computeTenantMetrics(counts({ fees: [monthlyFee(29_700)] }), WINDOW, NOW);

    expect(metrics.recovery.feesCents).toBe(Math.floor((30 / 31) * 29_700));
  });
});

describe('sortForOverview — U-6, a total order', () => {
  function row(over: Partial<TenantMetrics> & { tenantId: string; tenantName: string }): TenantMetrics {
    const base = computeTenantMetrics(counts(), WINDOW, NOW);
    return { ...base, ...over, optOut: { ...base.optOut, ...over.optOut } };
  }

  it('puts an alarmed client above an un-alarmed one, whatever their names', () => {
    const alpha = row({ tenantId: 'a', tenantName: 'Alpha Electrical' });
    const zed = row({
      tenantId: 'z',
      tenantName: 'Zed Plumbing',
      optOut: { numerator: 3, denominator: 42, rateBp: 714, alarming: true },
    });

    expect(sortForOverview([alpha, zed]).map((r) => r.tenantName)).toEqual([
      'Zed Plumbing',
      'Alpha Electrical',
    ]);
  });

  it('orders un-alarmed clients by name', () => {
    const rows = [
      row({ tenantId: 'c', tenantName: 'Coastal Plumbing' }),
      row({ tenantId: 'a', tenantName: 'Alpha Electrical' }),
      row({ tenantId: 'b', tenantName: 'Beta Roofing' }),
    ];

    expect(sortForOverview(rows).map((r) => r.tenantName)).toEqual([
      'Alpha Electrical',
      'Beta Roofing',
      'Coastal Plumbing',
    ]);
  });

  it('breaks a name tie on id, so the list does not reshuffle between renders', () => {
    // A screen whose rows move under the operator's cursor is a screen they
    // misclick on.
    const rows = [
      row({ tenantId: 'bbbb', tenantName: 'Perth Plumbing' }),
      row({ tenantId: 'aaaa', tenantName: 'Perth Plumbing' }),
    ];

    expect(sortForOverview(rows).map((r) => r.tenantId)).toEqual(['aaaa', 'bbbb']);
  });

  it('does not mutate the caller array', () => {
    const rows = [
      row({ tenantId: 'b', tenantName: 'Beta Roofing' }),
      row({ tenantId: 'a', tenantName: 'Alpha Electrical' }),
    ];
    sortForOverview(rows);

    expect(rows.map((r) => r.tenantId)).toEqual(['b', 'a']);
  });
});

/**
 * 2026-10 (Phase 15, 15-03; RPT-04). The `/reports` overview's calls column:
 * `computeTenantMetrics` passes the window's diverted-call counts and the
 * divert-number fact through UNCHANGED. They are counts, not rates — so a zero
 * with an active divert number is a measurement ("diverting, nobody rang"),
 * and must reach the page as `0`, never as `null` (UI-SPEC §3a).
 */
describe('computeTenantMetrics — the missed-call counts pass through (Phase 15, 2026-10)', () => {
  it('carries the three fields unchanged', () => {
    const metrics = computeTenantMetrics(
      counts({ missedCalls: 14, missedCallsAfterHours: 5, hasDivertNumber: true }),
      WINDOW,
      NOW,
    );

    expect(metrics.missedCalls).toEqual({ count: 14, afterHours: 5, hasDivertNumber: true });
  });

  it('keeps a zero with a divert number a zero, not null', () => {
    const metrics = computeTenantMetrics(counts({ hasDivertNumber: true }), WINDOW, NOW);

    expect(metrics.missedCalls.count).toBe(0);
    expect(metrics.missedCalls.count).not.toBeNull();
    expect(metrics.missedCalls.afterHours).toBe(0);
    expect(metrics.missedCalls.hasDivertNumber).toBe(true);
  });

  it('says plainly when the client is not diverting', () => {
    const metrics = computeTenantMetrics(counts(), WINDOW, NOW);

    expect(metrics.missedCalls).toEqual({ count: 0, afterHours: 0, hasDivertNumber: false });
  });
});

describe('the null guard is structural', () => {
  it('needs no arithmetic sanity check, because null is returned before any division', () => {
    // A module that has to test its own output for a not-a-number value is a
    // module that divided first and apologised afterwards. Every denominator is
    // checked BEFORE the division, so there is nothing left to sanitise.
    const source = readFileSync('src/core/reporting/metrics.ts', 'utf8');

    expect(source).not.toContain('isNaN');
    expect(source).not.toContain('isFinite');
  });
});
