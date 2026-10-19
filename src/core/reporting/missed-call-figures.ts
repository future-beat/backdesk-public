/**
 * THE MISSED-CALL FIGURES, FROM COUNTS TO THE FROZEN BLOCK (Phase 15, RPT-04 /
 * D-03, D-10).
 *
 * PURE. The repository read (`forTenant().metrics.missedCallCounts(period)`,
 * plan 15-03) returns integers and two small arrays; this module turns them
 * into the `ReportMissedCallsDocument` the monthly row freezes and the live
 * month-to-date page renders. Both surfaces call THIS function, so the frozen
 * sheet and the live page cannot disagree about a median or a rate — the
 * `computeTenantMetrics` rule: one definition, two callers.
 *
 * ── ONE DEFINITION OF MEDIAN AND P90 ────────────────────────────────────────
 *
 * The median is `escalationSpeed`'s (`./metrics`): sort ascending, take the
 * middle, average the middle pair at an even length, round to a whole second.
 * P90 is the nearest-rank value `sorted[min(n - 1, ceil(0.9 n) - 1)]` — an
 * actual observed delivery time, never an interpolation between two. With no
 * delivered text-back both are `null`, and the page says "no samples" (D-10):
 * an absence of samples is a different statement from zero seconds.
 *
 * ── WHY THE CLAMP ───────────────────────────────────────────────────────────
 *
 * `delivered_at` is the SMS provider's receipt clock and `started_at` is ours.
 * A few hundred milliseconds of skew can make a fast delivery read as
 * negative (research Pitfall 7). A negative duration is clamped to 0 here —
 * and in the SQL — so it can neither drag the median below the truth nor
 * print as "-1 s" on a client's sheet.
 *
 * ── RATES CARRY THEIR DENOMINATORS ──────────────────────────────────────────
 *
 * Every rate is `{ numerator, denominator, rateBp }` with `rateBp` from
 * `rateBasisPoints`, which is `null` at a zero denominator (D-10). The reply
 * rate's denominator is DELIVERED text-backs, not sent ones: a text the carrier
 * never delivered could not have been replied to.
 */
import type { ReportMissedCallsDocument } from './document';
import { rateBasisPoints } from './metrics';

/** What the repository read returns — every field an integer count. */
export interface MissedCallCounts {
  captured: number;
  withheld: number;
  afterHours: number;
  /** 24 entries, tenant-zone hour 0..23. */
  byHour: number[];
  /** 7 entries, ISO weekday Monday..Sunday. */
  byIsoWeekday: number[];
  /** 7 entries, ISO weekday Monday..Sunday, after-hours calls only. */
  afterHoursByIsoWeekday: number[];
  textBacksSent: number;
  textBacksDelivered: number;
  /** One entry per DELIVERED text-back: `delivered_at − started_at`, whole seconds. */
  deliveredSeconds: number[];
  repliedLeadsOnDelivered: number;
  leads: number;
  jobsCreated: number;
  jobsWon: number;
  bookedByTradie: number;
}

function assertLength(name: string, values: readonly number[], length: number): void {
  // A wrong length is OUR bug (the read groups into a fixed number of
  // buckets), not data — so it throws rather than padding.
  if (values.length !== length) {
    throw new Error(`computeMissedCallFigures: ${name} has ${values.length} entries, expected ${length}.`);
  }
}

function median(sorted: readonly number[]): number | null {
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

function p90(sorted: readonly number[]): number | null {
  const n = sorted.length;
  if (n === 0) return null;
  return sorted[Math.min(n - 1, Math.ceil(0.9 * n) - 1)]!;
}

/** The frozen block, from the counts. Pure; see the header. */
export function computeMissedCallFigures(counts: MissedCallCounts): ReportMissedCallsDocument {
  assertLength('byHour', counts.byHour, 24);
  assertLength('byIsoWeekday', counts.byIsoWeekday, 7);
  assertLength('afterHoursByIsoWeekday', counts.afterHoursByIsoWeekday, 7);

  const sorted = counts.deliveredSeconds.map((seconds) => Math.max(0, seconds)).sort((a, b) => a - b);

  return {
    captured: counts.captured,
    withheld: counts.withheld,
    byHour: [...counts.byHour],
    byIsoWeekday: [...counts.byIsoWeekday],
    afterHoursByIsoWeekday: [...counts.afterHoursByIsoWeekday],
    afterHours: {
      numerator: counts.afterHours,
      denominator: counts.captured,
      rateBp: rateBasisPoints(counts.afterHours, counts.captured),
    },
    textBacks: {
      sent: counts.textBacksSent,
      delivered: counts.textBacksDelivered,
      medianSeconds: median(sorted),
      p90Seconds: p90(sorted),
    },
    replyRate: {
      numerator: counts.repliedLeadsOnDelivered,
      denominator: counts.textBacksDelivered,
      rateBp: rateBasisPoints(counts.repliedLeadsOnDelivered, counts.textBacksDelivered),
    },
    funnel: {
      leads: counts.leads,
      jobsCreated: counts.jobsCreated,
      jobsWon: counts.jobsWon,
      bookedByTradie: counts.bookedByTradie,
    },
  };
}
