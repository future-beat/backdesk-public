/**
 * The ONE line the 06:30 digest gains for a client drifting past the opt-out
 * threshold (D-16).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ IT NAGS. IT NEVER STOPS ANYTHING. This module returns strings. Nothing   │
 * │ it calls writes, pauses, re-gates or suppresses — a client whose opt-out │
 * │ rate crossed 5% overnight has a copy problem to talk about, not a        │
 * │ cadence to halt, and halting one would cost them the quotes they are     │
 * │ still winning. That is Phase 6's D-15 rule applied to a metric.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── WHY IT SITS BESIDE `buildStaleAttestationSection` AND NOT INSIDE IT ────
 *
 * Both ride `buildDailyDigest`'s `sections` seam, which exists so that
 * `stalled-drafts.ts` never learns about attestations, metrics or whatever
 * comes after: strings in, strings out, and each caller owns its own
 * vocabulary and its own assertion. This file's vocabulary is a client name,
 * three integers and fixed words.
 *
 * ── ONE THRESHOLD, THREE SURFACES ──────────────────────────────────────────
 *
 * `isOptOutAlarming` decides here exactly as it decides the badge on `/reports`
 * and the badge on `/reports/[client]`, and the heading's percentage is DERIVED
 * from `OPT_OUT_ALARM_BP` rather than typed. An operator who reads "above 5%"
 * in an email and sees no badge on the screen stops believing both.
 *
 * ── NULL, NOT AN EMPTY SECTION ─────────────────────────────────────────────
 *
 * A heading with nothing under it is a daily "no drift" all-clear, which is the
 * trained blindness the digest's own empty-send rule exists to avoid. Same
 * decision `buildStaleAttestationSection` made, restated rather than inherited.
 *
 * ── AND IT TAKES NO CLOCK ──────────────────────────────────────────────────
 *
 * The window is already inside the numbers: the caller computed them over
 * `rollingWindow(now, LIVE_METRICS_WINDOW_DAYS)`, and a `now` parameter here
 * could only be used to describe that window a second way — which is how a line
 * comes to say "30 days" over a fortnight's counts.
 */
import type { DigestSection } from '@/core/alerts/stalled-drafts';

import { formatRateBp } from './format';
import {
  isOptOutAlarming,
  LIVE_METRICS_WINDOW_DAYS,
  OPT_OUT_ALARM_BP,
  sortForOverview,
  type TenantMetrics,
} from './metrics';

/**
 * One line per client above the threshold, or `null`.
 *
 * Ordered by `sortForOverview` — every row here is alarmed, so its
 * alarmed-first arm is a no-op and what remains is the client-name order (en-AU
 * collator) with the tenant id as the total-order tie-break. Reusing it rather
 * than writing a second comparator is the same argument as reusing the
 * threshold: two orderings of one list eventually disagree, and the operator
 * reads this email next to that screen.
 */
export function buildOptOutSection(rows: readonly TenantMetrics[]): DigestSection | null {
  // `isOptOutAlarming(row.optOut)` rather than the precomputed `alarming` flag:
  // they are the same call — `computeTenantMetrics` sets the flag with it — and
  // naming the predicate here is what makes this file greppable as one of its
  // three callers. It is handed the whole rate because the rule has two halves:
  // a null rate is not alarming (a client we have messaged nobody for has not
  // upset anybody), and neither is a rate over fewer than
  // `OPT_OUT_ALARM_MIN_CONTACTS` contacts — which is the line that used to fill
  // this digest every morning on one opted-out test handset.
  const alarmed = sortForOverview(rows.filter((row) => isOptOutAlarming(row.optOut)));

  const lines = alarmed.map(
    (row) =>
      `${row.tenantName}: ${formatRateBp(row.optOut.rateBp)} ` +
      `(${row.optOut.numerator} of ${row.optOut.denominator} contacts) ` +
      `in the last ${LIVE_METRICS_WINDOW_DAYS} days.`,
  );

  if (lines.length === 0) return null;

  return { heading: `Opt-out rate above ${OPT_OUT_ALARM_BP / 100}%:`, lines };
}
