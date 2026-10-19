/**
 * The polling cursor (SYNC-01, RESEARCH Pattern 1).
 *
 * ONE RULE, AND EVERYTHING ELSE FOLLOWS FROM IT: a ServiceM8 timestamp is only
 * ever compared to another ServiceM8 timestamp, inside ServiceM8's own filter.
 * Our clock never enters the comparison.
 *
 * That is not fastidiousness. If ServiceM8's clock runs behind ours, a cursor
 * derived from `Date.now()` skips every record edited in the gap — and skips it
 * PERMANENTLY, because the next poll moves the cursor forward again over the
 * hole. The high-water mark taken from their own data is correct no matter what
 * their clock says, which is why `advanceCursor` reads observed values and
 * `filterFrom` does pure calendar arithmetic on a string.
 *
 * THE OVERLAP WINDOW. Each poll asks for edits since `cursor - 15 minutes`
 * rather than since the cursor, and the `(tenant_id, sm8_job_uuid)` upsert
 * absorbs the repeats. It buys three things:
 *
 *   1. Same-second edits (Pitfall 2). ServiceM8 has no `ge`, and a second edit
 *      landing inside the cursor's own second would fall outside a strict `gt`.
 *      Nothing would go red — the record would just stop appearing.
 *   2. Clock jitter between ServiceM8's own app servers.
 *   3. Any datetime-precision quirk in their filter parser.
 *
 * The Wave-0 spike (A1) measured `gt` behaving INCLUSIVELY, which already covers
 * (1) on its own. The overlap stays: it costs a handful of re-fetched rows per
 * cycle, and it is the only one of the three defences that does not depend on
 * an undocumented behaviour continuing to hold.
 *
 * A CONSEQUENCE WORTH STATING OUT LOUD, because plan 02-03 depends on it: a
 * poll is almost never empty. The boundary record comes back every time. **A
 * non-empty response is not a change signal** — the diff against stored state
 * is.
 *
 * Framework-free by construction: no zone library, no Date parsing of the input
 * string, no `Intl`. The naive timestamp is treated as a bag of calendar
 * numbers, and `Date.UTC` is used purely as a calendar calculator so that
 * subtracting fifteen minutes cannot be shifted by an hour on a machine whose
 * local zone observes DST.
 */

/** Pattern 1's recommended window. See the header for what it buys. */
export const OVERLAP_MINUTES = 15;

/** D-14's pre-service window, matching `connect.ts`. */
export const BACKFILL_DAYS = 90;

/** '2026-08-26 09:00:00', '2026-08-26T09:00:00', or a bare '2026-08-26'. */
const NAIVE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

interface Parts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

function parseNaive(raw: string | null | undefined): Parts | null {
  if (!raw) return null;

  const m = NAIVE.exec(raw.trim());
  if (!m) return null;

  const [, y, mo, d, h = '00', mi = '00', s = '00'] = m;
  const parts: Parts = {
    y: Number(y),
    mo: Number(mo),
    d: Number(d),
    h: Number(h),
    mi: Number(mi),
    s: Number(s),
  };

  // `Date.UTC` happily rolls '2026-02-31' into March. A ServiceM8 timestamp
  // that does not survive the round trip is not one we can do arithmetic on, so
  // it is rejected here rather than silently relocated by three days.
  const stamp = Date.UTC(parts.y, parts.mo - 1, parts.d, parts.h, parts.mi, parts.s);
  if (!Number.isFinite(stamp)) return null;

  const back = new Date(stamp);
  if (
    back.getUTCFullYear() !== parts.y ||
    back.getUTCMonth() + 1 !== parts.mo ||
    back.getUTCDate() !== parts.d
  ) {
    return null;
  }

  return parts;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** A Date used only as a calendar → the naive string form ServiceM8 speaks. */
function formatNaive(instant: Date): string {
  return (
    `${pad(instant.getUTCFullYear(), 4)}-${pad(instant.getUTCMonth() + 1)}-` +
    `${pad(instant.getUTCDate())} ${pad(instant.getUTCHours())}:` +
    `${pad(instant.getUTCMinutes())}:${pad(instant.getUTCSeconds())}`
  );
}

/** True for a string this module is willing to treat as a cursor. */
export function isCursorParseable(value: string | null | undefined): boolean {
  return parseNaive(value) !== null;
}

export interface FilterFromOptions {
  /** Only consulted for the no-cursor backfill literal. */
  now?: Date;
  backfillDays?: number;
}

/**
 * The value to put in `$filter=edit_date gt '<here>'`.
 *
 * NO CURSOR → a date-only literal `backfillDays + 1` days back. Date-only
 * because that is the documented filter form and second precision buys nothing
 * across ninety days; the extra day absorbs any offset between ServiceM8's
 * clock and ours, and costs one extra day of jobs in a request we make once.
 *
 * A CURSOR → the cursor minus the overlap window, as a naive datetime. The
 * result is strictly earlier than the cursor, which is what guarantees a record
 * sitting exactly ON the cursor is returned under a strict `gt` as well as the
 * inclusive one the spike actually measured.
 *
 * AN UNPARSEABLE CURSOR → the backfill literal. Re-reading ninety days is
 * expensive; passing the garbage through is worse, because ServiceM8 answers a
 * malformed filter with a 400, which classifies as `server_error` and retries
 * forever without ever fixing the cause. The expensive path self-heals in one
 * cycle: `advanceCursor` replaces the corrupt value with a real observation.
 */
export function filterFrom(
  cursor: string | null,
  options: FilterFromOptions = {},
): string {
  const { now = new Date(), backfillDays = BACKFILL_DAYS } = options;

  const parts = parseNaive(cursor);
  if (!parts) {
    const cutoff = new Date(now.getTime() - (backfillDays + 1) * 86_400_000);
    return cutoff.toISOString().slice(0, 10);
  }

  const shifted = new Date(
    Date.UTC(parts.y, parts.mo - 1, parts.d, parts.h, parts.mi, parts.s) -
      OVERLAP_MINUTES * 60_000,
  );

  return formatNaive(shifted);
}

/**
 * The new high-water mark: the maximum `edit_date` OBSERVED, never our clock.
 *
 * Monotonic by construction — `prev` is a candidate for the maximum, so the
 * overlap window's deliberately-older re-fetched rows cannot drag the cursor
 * backwards. A cursor that regressed by the overlap on every cycle would
 * re-read the same window forever, burning the 20,000/day budget while looking
 * perfectly healthy.
 *
 * Malformed values are DISCARDED rather than compared. The comparison is
 * lexicographic (correct for fixed-width timestamps, and free), and a corrupt
 * string like 'zzz' would beat every real timestamp and win permanently. That
 * is what makes `filterFrom`'s fallback a self-healing detour rather than a
 * permanent 90-day re-read.
 */
export function advanceCursor(prev: string | null, observed: string[]): string | null {
  let max: string | null = isCursorParseable(prev) ? prev : null;

  for (const value of observed) {
    if (!isCursorParseable(value)) continue;
    if (max === null || value > max) max = value;
  }

  // Nothing usable anywhere: hand back what we were given rather than inventing
  // a value. If `prev` was corrupt this returns the corruption, and the next
  // cycle's backfill re-read is what clears it.
  return max ?? prev;
}
