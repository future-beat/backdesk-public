/**
 * Paging a ServiceM8 list endpoint.
 *
 * WHAT THE WAVE-0 SPIKE MEASURED (A2, scripts/sm8-spike.mjs, 26 Aug 2026):
 *
 *   - `cursor=-1` and omitting the parameter entirely return the IDENTICAL
 *     result set.
 *   - The response is a BARE JSON ARRAY. There is no envelope, and therefore no
 *     `next` / `cursor` / `page` key anywhere in the body.
 *   - No response header carries a cursor, link, page or total (the full header
 *     list is recorded in docs/servicem8-api-notes.md).
 *
 * So there is no observable paging mechanism to follow. The measurement is
 * HONEST BUT NOT CONCLUSIVE: the trial account holds 6 jobs, far below any
 * plausible page size, so a single response was always going to be enough. What
 * the spike proves is that no cursor is ADVERTISED — not that none exists.
 *
 * This function therefore keeps its defensive walk rather than collapsing to a
 * single request. Against the measured behaviour it costs exactly one extra
 * request per backfill (the second page returns the same rows, no new uuids
 * appear, and the walk stops); against a large account that does page, it keeps
 * working. Re-measure with >100 jobs before removing the loop.
 *
 * It terminates on OBSERVED BEHAVIOUR rather than a documented contract:
 *
 *   - an empty page ends the walk;
 *   - a page smaller than the first full page ends the walk;
 *   - a page that yields no NEW uuids ends the walk (the defence against a
 *     cursor that does not advance — without it, a server that ignores the
 *     parameter turns backfill into an infinite loop hammering a rate-limited
 *     API);
 *   - a hard cap of 50 pages ends the walk regardless, AND IS A FAILURE. The
 *     first three mean the data ended; the cap means only that we stopped
 *     looking, and returning those as the same thing is what WR-04 was.
 *
 * The no-new-uuids rule is the load-bearing one given the measurement above:
 * because the server IGNORES the cursor parameter, page two returns page one,
 * and without that check this walk would run to MAX_PAGES every single time.
 */
import type { Sm8Client, Sm8Result } from './types';

/** Refuses to walk forever even if every heuristic above fails. */
export const MAX_PAGES = 50;

export interface FetchAllPagesOptions {
  filter?: string;
  /**
   * `-1` is the documented starting value. `undefined` omits the parameter
   * entirely, which is how a single unpaged request is expressed.
   */
  startCursor?: string;
  maxPages?: number;
}

/**
 * Read every page of `resource`, concatenated.
 *
 * Returns the FIRST failure encountered rather than a partial result: a
 * half-fetched backfill written to the database looks exactly like a client
 * with half as many quotes, and nothing downstream could tell the difference.
 * Partial success is the one outcome this function will not produce.
 */
export async function fetchAllPages(
  client: Sm8Client,
  resource: string,
  options: FetchAllPagesOptions = {},
): Promise<Sm8Result<unknown[]>> {
  const { filter, startCursor = '-1', maxPages = MAX_PAGES } = options;

  const collected: unknown[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined = startCursor;
  let firstPageSize: number | null = null;

  /**
   * Did the loop end because the DATA ended, or because we ran out of pages?
   *
   * Starts pessimistic and is cleared by every legitimate termination below, so
   * a `break` added later without thinking about it fails closed — reported as a
   * truncation rather than silently returning a partial result as complete.
   */
  let exhausted = false;

  for (let page = 0; page < maxPages; page++) {
    const result = await client.get(resource, { filter, cursor });
    if (!result.ok) return result;

    const rows = result.data.rows;
    if (rows.length === 0) {
      exhausted = true;
      break;
    }

    // Track uuids to detect a cursor that is not advancing. Rows without a
    // uuid are counted as new so an unexpected shape cannot stall the walk.
    let fresh = 0;
    let maxUuid: string | undefined;
    for (const row of rows) {
      const uuid =
        typeof row === 'object' && row !== null && typeof (row as { uuid?: unknown }).uuid === 'string'
          ? (row as { uuid: string }).uuid
          : undefined;
      if (uuid === undefined) {
        fresh++;
        collected.push(row);
        continue;
      }
      if (!seen.has(uuid)) {
        seen.add(uuid);
        fresh++;
        collected.push(row);
      }
      if (maxUuid === undefined || uuid > maxUuid) maxUuid = uuid;
    }

    if (fresh === 0) {
      exhausted = true;
      break;
    }

    if (firstPageSize === null) firstPageSize = rows.length;
    else if (rows.length < firstPageSize) {
      exhausted = true;
      break;
    }

    if (maxUuid === undefined) {
      exhausted = true;
      break;
    }
    // The documented example advances by cursor value; with the mechanics
    // unverified, the last uuid of the page is the only monotone handle the
    // payload actually offers. The no-new-rows guard above is what makes a
    // wrong guess terminate instead of loop.
    cursor = maxUuid;
  }

  if (!exhausted) {
    // THE CAP IS A FAILURE, NOT A RESULT (WR-04).
    //
    // Falling through to `ok: true` here would return a partial walk that is
    // indistinguishable from a complete one — the exact outcome this function's
    // header promises it "will not produce". Downstream, a truncated `job.json`
    // walk becomes an audit with understated quotesIssued, totalValueCents and
    // recoverableEstimateCents that looks finished, which fetch-history.ts calls
    // "worse than no audit, because it looks exactly like a complete one".
    //
    // Classified as `parse_error` deliberately: it means the API's paging
    // behaviour is not what this walk assumes, which is our bug to fix and not
    // the client's key to re-enter. `applyFailurePolicy` treats parse_error as
    // weather rather than pausing the connection (T-2-09).
    //
    // The detail names the resource and the cap and nothing else — no cursor, no
    // URL, no header (T-2-02).
    return {
      ok: false,
      kind: 'parse_error',
      detail: `page walk hit the ${maxPages}-page cap on ${resource} — the result would be truncated`,
    };
  }

  return { ok: true, data: collected };
}
