/**
 * Is this submission over the limit? (Phase 9, LAND-03, D-12, threat T-9-02)
 *
 * PURE: one comparison, no clock, no database. The interesting engineering is
 * next door in the repository — `INSERT … ON CONFLICT DO UPDATE … RETURNING
 * hits` is what makes the count race-free across every serverless instance at
 * once — and this module exists so the DECISION that count feeds is a thing a
 * unit test can state, rather than a `>` buried in a server action.
 *
 * ── WHY THE WINDOW IS A FIXED HOUR AND NOT A ROLLING ONE ────────────────────
 *
 * The counter's primary key is `(ip_hash, window_start)` with `window_start =
 * date_trunc('hour', now())`, so the window IS the key: that is precisely what
 * lets one statement both count and return the total under Postgres' own row
 * lock. A rolling 60-minute window cannot be a primary key — it needs a read
 * over timestamps, and a read-then-write lets two concurrent submissions both
 * see 5 and both write 6.
 *
 * The price is a known, bounded imprecision: a burst straddling the boundary
 * can reach 2 × limit inside some rolling 60 minutes. Ten submissions from one
 * connection in an hour is still nothing like the flood this exists to stop,
 * and the alternative trades a real guarantee (atomicity) for a cosmetic one
 * (an exact window). Accepted, deliberately, and pinned by a test.
 */
import { AUDIT_THROTTLE_LIMIT } from '@/db/schema';

/**
 * The bucket the counter is keyed on. A `date_trunc` unit, and the repository
 * truncates with exactly this word in UTC — `now()` on Supabase is UTC, so the
 * hour boundary is the same one everywhere and never shifts under AWST.
 */
export const AUDIT_THROTTLE_WINDOW = 'hour';

export type ThrottleDecision = 'allow' | 'refuse';

/**
 * `hits` is the RUNNING TOTAL INCLUDING this attempt, because the bump happens
 * before the decision. So the comparison is strictly greater-than: the fifth
 * submission arrives as `hits = 5` and is allowed, the sixth arrives as 6 and
 * is refused.
 *
 * Counting the attempt before judging it is what makes refused attempts count
 * too — otherwise a submitter parked at the limit is refused forever and never
 * counted, and the window never fills.
 */
export function throttleDecision(
  hits: number,
  limit: number = AUDIT_THROTTLE_LIMIT,
): ThrottleDecision {
  return hits > limit ? 'refuse' : 'allow';
}
