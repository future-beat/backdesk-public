/**
 * The ONE line the 06:30 digest gains when the attribution consumer has stopped
 * moving (07 CR-03).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A WEDGE LOOKS EXACTLY LIKE A QUIET MONTH. Both are all zeros. That is    │
 * │ the whole problem this file solves: recovered jobs silently stop         │
 * │ reaching invoices, every screen keeps rendering, nothing errors, and the │
 * │ only difference between "nobody won anything" and "billing has been      │
 * │ broken for nine days" is a number nobody reads.                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── WHY THIS RIDES THE DIGEST AND NOT A NEW CHANNEL ────────────────────────
 *
 * `buildDailyDigest`'s `sections` seam already exists and the operator already
 * reads that email every morning. A second alert channel is a second thing to
 * configure, a second thing to silence, and a second thing that can be broken
 * without anybody noticing — which is the failure mode being fixed here, not a
 * good pattern to add another instance of. Strings in, strings out, beside
 * `buildOptOutSection` and `buildStaleAttestationSection`.
 *
 * ── IT MEASURES THE CURSOR, NOT THE TICK'S OPINION OF ITSELF ───────────────
 *
 * `attributionTenantsBlocked` and `attributionsPoisoned` are per-pass counts
 * that live for one HTTP response, and reading them here would mean persisting
 * a counter — a derived fact that can drift from the thing it describes, and
 * that reports nothing at all if the tick stopped running entirely.
 *
 * The backlog's AGE is the thing itself. A per-minute consumer whose oldest
 * unconsumed event has been waiting six hours is stuck, and it is stuck whether
 * the cause is a held cursor, a crashed cron, a pooler outage or a failure
 * nobody has thought of yet. One reading, every cause.
 *
 * ── NULL, NOT AN EMPTY SECTION ─────────────────────────────────────────────
 *
 * A heading with nothing under it is a daily "still fine" all-clear, which is
 * the trained blindness the digest's own empty-send rule exists to avoid. The
 * same decision `buildOptOutSection` made, restated rather than inherited.
 *
 * ── AND IT NAMES NO CLIENT ─────────────────────────────────────────────────
 *
 * A count and a duration. The backlog read returns no tenant id by
 * construction, and "is the consumer moving" is answerable without one — so
 * this line carries nothing an operator would have to be careful forwarding.
 */
import type { DigestSection } from '@/core/alerts/stalled-drafts';
import type { ConsumerBacklog } from '@/db/repository';

/**
 * How long the oldest unconsumed event may sit before the digest says so.
 *
 * SIX HOURS AGAINST A PER-MINUTE TICK is deliberately loose. The consumer walks
 * `ATTRIBUTION_BATCH_LIMIT` events a minute, so even a first registration
 * against months of history drains in well under this; anything still waiting
 * after six hours is not draining. Loose because THIS LINE MUST NEVER CRY WOLF:
 * a morning nag that is sometimes noise is a morning nag that stops being read,
 * and then the real wedge goes past unnoticed too.
 */
export const ATTRIBUTION_WEDGE_HOURS = 6;

const MS_PER_HOUR = 3_600_000;

/** Whole hours, floored — the digest says "6 hours", never "6.37 hours". */
function hoursBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_HOUR);
}

/**
 * One line naming a stalled attribution cursor, or `null`.
 *
 * `backlog` is `null` when the consumer has never registered — which is NOT a
 * wedge and must not alert: a consumer with no position has taken no reading,
 * and the tick's attribution seam defaults to `'skip'` for every caller except
 * the route. Silence there is correct.
 */
export function buildAttributionWedgeSection(
  backlog: ConsumerBacklog | null,
  now: Date,
): DigestSection | null {
  if (backlog === null) return null;
  if (backlog.pendingCount === 0 || backlog.oldestPendingAt === null) return null;

  const waitingHours = hoursBetween(backlog.oldestPendingAt, now);
  if (waitingHours < ATTRIBUTION_WEDGE_HOURS) return null;

  return {
    heading: 'Attribution has stopped — recovered jobs are not reaching invoices',
    lines: [
      `${String(backlog.pendingCount)} quote ${backlog.pendingCount === 1 ? 'event' : 'events'} ` +
        `unread, oldest waiting ${String(waitingHours)} hours.`,
      // WHAT TO DO, not just what is wrong. The operator reading this at 06:30
      // needs the next step, and the next step is not obvious from the symptom.
      'The attribution cursor has not advanced. Check the tick logs for a held ' +
        'cursor or a quarantined event; no report generated while this persists ' +
        'will show the wins behind it.',
    ],
  };
}
