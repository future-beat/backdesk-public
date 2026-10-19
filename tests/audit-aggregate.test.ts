/**
 * The aggregation core (AUD-01, D-09, D-10).
 *
 * PURE — no database, no network, no environment. These functions produce every
 * number the Quote Leakage Audit hands to a prospect and every number Phase 7
 * computes recovered revenue against, so the test that matters is not "does it
 * run" but "is it exactly this, at the boundary, in both directions".
 *
 * Two properties are load-bearing enough to state out loud:
 *
 *  1. **Cents, integers, everywhere.** A dollar figure on a printed audit is
 *     the number a sales conversation happens over. `0.1 + 0.2` is
 *     `0.30000000000000004` and the error compounds across 300 quotes.
 *  2. **Both sides of every boundary.** A grace-period test that only checks
 *     "a signal three days later counts" passes for an implementation that
 *     counts every signal ever recorded. The 1-second-before case is what
 *     makes the assertion mean anything.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  auditWindow,
  computeAuditFigures,
  isInWindow,
  type AuditLine,
} from '@/core/audit/aggregate';
import {
  ATTRIBUTION_WINDOW_DAYS,
  AUDIT_RECOVERY_RATE,
  BASELINE_MIN_QUOTES,
  CLICKSEND_BALANCE_ALERT_FLOOR_CENTS,
  CLICKSEND_BALANCE_DISARM_FLOOR_CENTS,
  DEFAULT_BASELINE_WIN_RATE,
  FIRST_TOUCH_HOURS,
  GRACE_PERIOD_DAYS,
  OPT_OUT_ALARM_MIN_CONTACTS,
  OPT_OUT_ALARM_RATE,
  TEXT_BACK_DAILY_CAP,
  WINDOW_DAYS,
} from '@/core/audit/constants';
import { isFollowedUp } from '@/core/audit/followup';

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** A fixed instant, so no assertion here depends on when the suite runs. */
const NOW = new Date('2026-08-26T00:00:00.000Z');

function line(over: Partial<AuditLine> = {}): AuditLine {
  return {
    status: 'Quote',
    quoteDateUtc: new Date('2026-07-01T00:00:00.000Z'),
    valueCents: 0,
    followedUp: false,
    ...over,
  };
}

describe('constants (D-09)', () => {
  /**
   * Comments stripped before every structural rule below — the file's header
   * explains WHY it has no imports, and can only do that by naming one.
   */
  const CONSTANTS_CODE = readFileSync('src/core/audit/constants.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('exports exactly the twelve named constants, in EVERY export syntax', () => {
    // TWELVE SINCE 2026-10 (Phase 12, D-07), up from nine: the founder's three
    // text-back limits — `TEXT_BACK_DAILY_CAP`, `CLICKSEND_BALANCE_ALERT_FLOOR_
    // CENTS` and `CLICKSEND_BALANCE_DISARM_FLOOR_CENTS` — live beside the other
    // commercial assumptions and are recorded in docs/commercial-assumptions.md
    // §8–§10.
    //
    // NINE SINCE 2026-09-13 (quick 260913-ind), up from eight: the deliberate
    // pin edit that comes with `OPT_OUT_ALARM_MIN_CONTACTS`. The count is a
    // tripwire, not a budget — a constant may be added, but only by a change
    // that says so here and records itself in docs/commercial-assumptions.md.
    //
    // Not `export const` alone: that pattern is blind to `export let`,
    // `export function`, `export class` and `export enum`, so "exactly nine"
    // would mean "exactly nine of one syntactic shape". Kept parallel with the
    // same pin on `src/core/brand.ts` in tests/brand.test.ts — the two files
    // make the same promise for the same reason and are worth breaking together.
    const exported = [
      ...CONSTANTS_CODE.matchAll(
        /^export\s+(?:async\s+)?(?:const|let|var|function|class|enum)\s+(\w+)/gm,
      ),
    ]
      .map((m) => m[1])
      .sort();

    expect(exported).toEqual([
      'ATTRIBUTION_WINDOW_DAYS',
      'AUDIT_RECOVERY_RATE',
      'BASELINE_MIN_QUOTES',
      'CLICKSEND_BALANCE_ALERT_FLOOR_CENTS',
      'CLICKSEND_BALANCE_DISARM_FLOOR_CENTS',
      'DEFAULT_BASELINE_WIN_RATE',
      'FIRST_TOUCH_HOURS',
      'GRACE_PERIOD_DAYS',
      'OPT_OUT_ALARM_MIN_CONTACTS',
      'OPT_OUT_ALARM_RATE',
      'TEXT_BACK_DAILY_CAP',
      'WINDOW_DAYS',
    ]);

    // The two shapes the list above cannot enumerate, forbidden outright so the
    // count stays total over the file rather than over what the regex can see.
    expect(CONSTANTS_CODE).not.toMatch(/^export\s*\{/m);
    expect(CONSTANTS_CODE).not.toMatch(/^export\s+default\b/m);
  });

  it('is a module with NO imports OF ANY SHAPE — stated as a test, not a convention', () => {
    // The whole point of this file is that a print page, a background consumer,
    // a digest builder and a React server component can all read the SAME value.
    // The moment it can import, it can acquire a dependency one of those four
    // cannot take — and the workaround is always a second literal somewhere,
    // which is a figure and a footnote that disagree in a document handed to a
    // client as evidence.
    // `/^import /` alone is a hole: `export { x } from './y'`, `export * from
    // './y'`, `await import('./y')` and `require('./y')` each add a dependency
    // to a module whose premise is that it has none.
    expect(CONSTANTS_CODE).not.toMatch(/^\s*import\b/m);
    expect(CONSTANTS_CODE).not.toMatch(/^\s*export\b[^\n]*\bfrom\b/m);
    expect(CONSTANTS_CODE).not.toMatch(/\b(require|import)\s*\(/);
  });

  it('holds the deliberately HIGH default baseline and the Phase 7 thresholds', () => {
    // D-01: 30 days is COSTLY to change — every attribution row records the
    // window it was computed under, so an edit means months computed under two
    // rules and frozen reports already sent under the old one.
    expect(ATTRIBUTION_WINDOW_DAYS).toBe(30);

    // D-08: the direction is the point. The conservative figure is
    // `gross x (1 - baseline)`, so a HIGH assumed baseline SHRINKS our credit.
    // A footnote that says "we assumed you were already winning 70%" survives
    // being challenged; the opposite assumption is one a client argues down.
    expect(DEFAULT_BASELINE_WIN_RATE).toBe(0.7);

    // Below ten quotes a measured rate is a coin flip, and falling back to the
    // 70% assumption can only cost the service money — never the client.
    expect(BASELINE_MIN_QUOTES).toBe(10);

    // D-16: it nags, it never pauses a healthy client.
    expect(OPT_OUT_ALARM_RATE).toBe(0.05);

    // And it needs a denominator before it nags at all (quick 260913-ind).
    // Deliberately the same ten as `BASELINE_MIN_QUOTES` and for the same
    // reason: below ten, a proportion is a coin flip. One opted-out test
    // handset read 100% and filled the daily digest for thirty rolling days.
    expect(OPT_OUT_ALARM_MIN_CONTACTS).toBe(10);

    // D-18: "every open quote gets followed up ON TIME" is the pitch; this is
    // the number that says whether it is happening.
    expect(FIRST_TOUCH_HOURS).toBe(24);

    // Phase 12 D-07 (founder, 5 Oct 2026): thirty text-backs per client per
    // rolling 24 hours; alert below A$20; auto-disarm below A$5. The disarm
    // floor must sit under the alert floor, or the first warning is the disarm.
    expect(TEXT_BACK_DAILY_CAP).toBe(30);
    expect(CLICKSEND_BALANCE_ALERT_FLOOR_CENTS).toBe(2000);
    expect(CLICKSEND_BALANCE_DISARM_FLOOR_CENTS).toBe(500);
    expect(CLICKSEND_BALANCE_DISARM_FLOOR_CENTS).toBeLessThan(
      CLICKSEND_BALANCE_ALERT_FLOOR_CENTS,
    );
  });

  it('holds the conservative end of the D-09 band', () => {
    // 15–20% is the band from GTM research. The low end is chosen on purpose:
    // the audit is a promise made before any work is done, and the service
    // guarantees 3x fees. Overstating recoverable dollars in a sales meeting
    // is how that guarantee gets called in.
    expect(AUDIT_RECOVERY_RATE).toBe(0.15);
    expect(GRACE_PERIOD_DAYS).toBe(3);
    expect(WINDOW_DAYS).toBe(90);
  });

  it('holds two rates that are exactly representable in basis points', () => {
    // `aggregate.ts` and `attribution/baseline.ts` both store these as WHOLE
    // basis points (value * 10000, rounded to an integer smallint), so a rate
    // that is not a whole basis point is silently rounded on the way into a
    // stored row while the footnote renders the unrounded constant.
    expect(Number.isInteger(AUDIT_RECOVERY_RATE * 10000)).toBe(true);
    expect(Number.isInteger(DEFAULT_BASELINE_WIN_RATE * 10000)).toBe(true);
  });

  it('is the ONLY origin of the recovery rate — aggregate.ts imports it', () => {
    // The report's methodology footnote renders the same constant (plan 02-07).
    // A literal 0.15 in either place is a figure and a footnote that can
    // silently disagree, in a document handed to a prospect as evidence.
    const source = readFileSync('src/core/audit/aggregate.ts', 'utf8');

    expect(source).toContain('AUDIT_RECOVERY_RATE');
    expect(source).toMatch(/from '(@\/core\/audit\/constants|\.\/constants)'/);
    // No second copy of the number anywhere in the aggregation.
    expect(source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')).not.toContain(
      '0.15',
    );
  });
});

describe('isFollowedUp — the D-10 grace boundary', () => {
  const quoteDate = new Date('2026-07-01T09:30:00.000Z');
  const threshold = new Date(quoteDate.getTime() + GRACE_PERIOD_DAYS * 24 * HOUR);

  it('counts a signal at exactly quote_date + 72h as a follow-up', () => {
    expect(isFollowedUp(quoteDate, [threshold])).toBe(true);
  });

  it('does NOT count a signal one second before the boundary', () => {
    // The direction that matters commercially: a quote wrongly called
    // "never followed up" inflates the leakage figure we show a prospect, and
    // the prospect can check it against their own records.
    expect(isFollowedUp(quoteDate, [new Date(threshold.getTime() - 1000)])).toBe(false);
  });

  it('counts a signal one second after the boundary', () => {
    expect(isFollowedUp(quoteDate, [new Date(threshold.getTime() + 1000)])).toBe(true);
  });

  it('ignores signals before the quote and finds one late signal among many', () => {
    const signals = [
      new Date(quoteDate.getTime() - 5 * DAY),
      new Date(quoteDate.getTime() + HOUR),
      new Date(quoteDate.getTime() + 2 * DAY),
      new Date(threshold.getTime() + DAY),
    ];

    expect(isFollowedUp(quoteDate, signals)).toBe(true);
  });

  it('is false for no signals at all', () => {
    expect(isFollowedUp(quoteDate, [])).toBe(false);
  });

  it('is false — never a crash — for a quote with no quote date', () => {
    // A job with a zero-date `quote_date` was never issued as a quote. It has
    // no grace window to be inside or outside of, and `null + 3 days` must not
    // become an Invalid Date comparison that silently returns false for the
    // wrong reason (RESEARCH Pitfall 3).
    expect(isFollowedUp(null, [new Date()])).toBe(false);
  });

  it('is unaffected by the runtime timezone — 72h is 72h', () => {
    // date-fns `addDays` on a local Date adds CALENDAR days, which is 71 or 73
    // hours across a DST transition in the runner's own zone. Pinned with a
    // quote issued inside the Australian DST changeover weekend.
    const dstEve = new Date('2026-10-03T14:00:00.000Z');
    const exactly72h = new Date(dstEve.getTime() + 72 * HOUR);

    expect(isFollowedUp(dstEve, [new Date(exactly72h.getTime() - 1000)])).toBe(false);
    expect(isFollowedUp(dstEve, [exactly72h])).toBe(true);
  });
});

describe('auditWindow / isInWindow — the 90-day boundary', () => {
  const window = auditWindow(NOW);

  it('spans exactly WINDOW_DAYS back from the given instant', () => {
    expect(window.end.toISOString()).toBe(NOW.toISOString());
    expect(window.start.toISOString()).toBe(
      new Date(NOW.getTime() - WINDOW_DAYS * DAY).toISOString(),
    );
  });

  it('INCLUDES a quote issued exactly 90 days before the window end', () => {
    // Inclusive lower bound, stated by a test rather than left to whichever
    // comparison operator someone types. The alternative silently shortens
    // every audit by a day and nobody ever notices.
    expect(isInWindow(new Date(NOW.getTime() - 90 * DAY), window)).toBe(true);
  });

  it('EXCLUDES a quote issued 91 days before the window end', () => {
    expect(isInWindow(new Date(NOW.getTime() - 91 * DAY), window)).toBe(false);
  });

  it('excludes a quote dated after the window end and one with no date', () => {
    expect(isInWindow(new Date(NOW.getTime() + 1000), window)).toBe(false);
    expect(isInWindow(null, window)).toBe(false);
  });
});

/**
 * A fixture with a KNOWN composition, so every figure below is a number that
 * can be checked by hand rather than by re-running the implementation.
 *
 *   quotes issued        6  (the null-quote-date row is not an issued quote)
 *   total value          $10,500.50   = 1,050,050c
 *   never followed up    $ 4,250.50   =   425,050c
 *   recoverable          425,050 × 0.15 = 63,757.5c → 63,757c (floored)
 */
const FIXTURE: AuditLine[] = [
  line({ status: 'Quote', valueCents: 100_000, followedUp: false }),
  line({ status: 'Quote', valueCents: 250_050, followedUp: false }),
  line({ status: 'Work Order', valueCents: 500_000, followedUp: true }),
  line({ status: 'Completed', valueCents: 125_000, followedUp: true }),
  line({ status: 'Unsuccessful', valueCents: 75_000, followedUp: false }),
  line({ status: 'Quote', valueCents: null, followedUp: false }),
  // Never issued as a quote — a job created straight to Work Order.
  line({ status: 'Work Order', quoteDateUtc: null, valueCents: 999_999 }),
];

/**
 * A quote issued YESTERDAY has not been neglected — it has not had its chance
 * yet.
 *
 * Found by running the audit against the live trial account, whose jobs were
 * all seeded within 48 hours: every one of the six came back as "never followed
 * up", producing a leakage figure of the prospect's ENTIRE quoted value. The
 * arithmetic was correct and the finding was nonsense.
 *
 * D-10 defines the leak as "no signal AFTER quote_date + 3 days", which
 * presupposes that those three days have passed. For a quote still inside its
 * grace window the honest answer is "not yet known", and the honest place to
 * put it is nowhere near the headline number — because the one figure a
 * prospect can check against their own memory is this week's quotes, and being
 * told they neglected the job they sent yesterday discredits the whole page.
 */
describe('quotes still inside their grace window (D-10)', () => {
  const justQuoted = line({
    quoteDateUtc: new Date(NOW.getTime() - 1 * DAY),
    valueCents: 500_000,
    followedUp: false,
  });

  it('counts a fresh quote as issued, and in the total value', () => {
    const figures = computeAuditFigures([justQuoted], NOW);

    expect(figures.quotesIssued).toBe(1);
    expect(figures.totalValueCents).toBe(500_000);
  });

  it('does NOT count it as never-followed-up value', () => {
    const figures = computeAuditFigures([justQuoted], NOW);

    expect(
      figures.neverFollowedUpValueCents,
      'a quote whose 72h grace has not elapsed was counted as neglected',
    ).toBe(0);
    expect(figures.recoverableEstimateCents).toBe(0);
  });

  it('starts counting it the moment the grace period elapses', () => {
    // Both sides of the boundary, on the same quote. One second before the
    // deadline it is pending; at the deadline it is a leak.
    const quotedAt = new Date(NOW.getTime() - GRACE_PERIOD_DAYS * 24 * HOUR);
    const pending = line({ quoteDateUtc: new Date(quotedAt.getTime() + 1000), valueCents: 1_000 });
    const elapsed = line({ quoteDateUtc: quotedAt, valueCents: 1_000 });

    expect(computeAuditFigures([pending], NOW).neverFollowedUpValueCents).toBe(0);
    expect(computeAuditFigures([elapsed], NOW).neverFollowedUpValueCents).toBe(1_000);
  });

  it('still excludes a fresh quote that WAS followed up', () => {
    const followed = { ...justQuoted, followedUp: true };
    expect(computeAuditFigures([followed], NOW).neverFollowedUpValueCents).toBe(0);
  });
});

describe('computeAuditFigures (AUD-01)', () => {
  const figures = computeAuditFigures(FIXTURE, NOW);

  it('counts quotes issued, excluding jobs that were never quoted', () => {
    expect(figures.quotesIssued).toBe(6);
  });

  it('sums total quoted value in exact cents', () => {
    expect(figures.totalValueCents).toBe(1_050_050);
  });

  it('sums only the never-followed-up lines', () => {
    expect(figures.neverFollowedUpValueCents).toBe(425_050);
  });

  it('applies the recovery rate, floored to a whole cent', () => {
    // 63,757.5c exactly — the half-cent is the point. Rounding UP here would
    // overstate the estimate, which is the one direction D-09 forbids.
    expect(figures.recoverableEstimateCents).toBe(63_757);
  });

  it('never produces a fractional cent for any input', () => {
    for (const cents of [1, 7, 33, 99, 12_345, 999_999_99]) {
      const { recoverableEstimateCents } = computeAuditFigures(
        [line({ valueCents: cents, followedUp: false })],
        NOW,
      );
      expect(Number.isInteger(recoverableEstimateCents)).toBe(true);
      expect(recoverableEstimateCents).toBeLessThanOrEqual(cents * AUDIT_RECOVERY_RATE);
    }
  });

  it('renders zeros — not NaN, not a divide-by-zero — for an empty window', () => {
    // AUD-01 empty-window edge. A prospect with no quotes in 90 days still gets
    // a report; it just says zero. A NaN on a printed sales document is worse
    // than any number it could have shown.
    expect(computeAuditFigures([], NOW)).toEqual({
      quotesIssued: 0,
      totalValueCents: 0,
      neverFollowedUpValueCents: 0,
      recoverableEstimateCents: 0,
    });
  });

  it('accumulates 300 cent-values exactly, with no float drift', () => {
    // The property no single-row test can show. 10c three hundred times is
    // $30.00 and nothing else; a float accumulator lands near it.
    const many = Array.from({ length: 300 }, () => line({ valueCents: 10 }));
    expect(computeAuditFigures(many, NOW).totalValueCents).toBe(3_000);
  });
});
