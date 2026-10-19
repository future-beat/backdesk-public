/**
 * WR-04: the page cap is a FAILURE, not a quietly truncated success.
 *
 * `fetchAllPages` promises in its own header that it "Returns the FIRST failure
 * encountered rather than a partial result ... Partial success is the one
 * outcome this function will not produce" — and then produced exactly that at
 * `MAX_PAGES`, falling out of the loop into `{ ok: true, data: collected }` with
 * no way for a caller to tell "the data ended" from "we stopped looking".
 *
 * Downstream that becomes an audit with understated `quotesIssued`,
 * `totalValueCents` and `recoverableEstimateCents` that looks complete —
 * "worse than no audit, because it looks exactly like a complete one"
 * (fetch-history.ts). This suite pins each legitimate termination as a success
 * and the cap as a failure, so the two can never collapse back together.
 *
 * Pure: the client is a function, so no network and no database.
 */
import { describe, expect, it } from 'vitest';

import { fetchAllPages, MAX_PAGES } from '@/core/servicem8/pagination';
import type { Sm8Client } from '@/core/servicem8/types';

/** A row with a unique uuid, so the no-new-uuids rule does not fire early. */
let counter = 0;
const row = () => ({ uuid: `uuid-${String(counter++).padStart(8, '0')}` });

/** Answers every request with `pageSize` FRESH rows — a walk that never ends. */
function endlessClient(pageSize: number): Sm8Client {
  return {
    async get() {
      return {
        ok: true as const,
        data: { rows: Array.from({ length: pageSize }, row), headers: new Headers() },
      };
    },
  };
}

/** Answers from a fixed list of pages, then empties. */
function pagedClient(pages: unknown[][]): Sm8Client {
  let call = 0;
  return {
    async get() {
      const rows = pages[call++] ?? [];
      return { ok: true as const, data: { rows, headers: new Headers() } };
    },
  };
}

describe('the page cap is a failure (WR-04)', () => {
  it('a walk that never runs out of fresh rows fails rather than truncating', async () => {
    const result = await fetchAllPages(endlessClient(10), 'job.json', { maxPages: 3 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('parse_error');
  });

  it('names the resource and the cap, and nothing else (T-2-02)', async () => {
    const result = await fetchAllPages(endlessClient(10), 'jobcontact.json', { maxPages: 3 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toContain('jobcontact.json');
    expect(result.detail).toContain('3');
    // No cursor, no URL, no header — the request's one header is the API key.
    expect(result.detail).not.toMatch(/uuid-|http|X-API-Key/i);
  });

  it('classifies as parse_error, so a client is not paused for our bug', async () => {
    // parse_error means the API's paging behaviour is not what this walk
    // assumes. applyFailurePolicy treats it as weather rather than pausing the
    // connection (T-2-09): pausing would send the operator chasing a re-key that
    // changes nothing.
    const result = await fetchAllPages(endlessClient(5), 'job.json', { maxPages: 2 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).not.toBe('auth_failed');
    expect(result.kind).toBe('parse_error');
  });

  it('does not return the rows it did collect', async () => {
    // A caller that ignored `ok` and read `data` anyway would otherwise get a
    // truncated set. There is no `data` on the failure branch at all.
    const result = await fetchAllPages(endlessClient(10), 'job.json', { maxPages: 2 });

    expect(result).not.toHaveProperty('data');
  });
});

describe('legitimate terminations are still successes', () => {
  it('an empty page ends the walk cleanly', async () => {
    const result = await fetchAllPages(pagedClient([[row(), row()], []]), 'job.json', {
      maxPages: 10,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(2);
  });

  it('a page with no NEW uuids ends the walk cleanly', async () => {
    // The load-bearing rule given the measured behaviour: the API ignores the
    // cursor, so page two IS page one.
    const page = [row(), row()];
    const result = await fetchAllPages(pagedClient([page, page]), 'job.json', { maxPages: 10 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(2);
  });

  it('a short final page ends the walk cleanly', async () => {
    const result = await fetchAllPages(
      pagedClient([[row(), row(), row()], [row()]]),
      'job.json',
      { maxPages: 10 },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(4);
  });

  it('the real single-page case terminates as a success under the default cap', async () => {
    // THE PRODUCTION PATH, and the one that must not have been turned into a
    // failure by the cap change. The measured API IGNORES the cursor, so the
    // second request returns the first page again, `fresh === 0` fires, and the
    // walk ends having proven it saw everything — one extra request, one clean
    // success. This is what every backfill actually does.
    const page = [row(), row(), row()];
    const client: Sm8Client = {
      async get() {
        return { ok: true as const, data: { rows: page, headers: new Headers() } };
      },
    };

    const result = await fetchAllPages(client, 'job.json');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(3);
  });

  it('a cap of 1 reached with a full page is honestly indeterminate', async () => {
    // Not a legitimate termination: one page was read, the cap stopped the walk,
    // and nothing proved there was no second page. "We stopped looking" must
    // report as a possible truncation even when the truth may be that the data
    // ended -- guessing in the caller's favour here is exactly the silent
    // partial-success this fix removes.
    const result = await fetchAllPages(pagedClient([[row()]]), 'job.json', { maxPages: 1 });

    expect(result.ok).toBe(false);
  });

  it('an entirely empty resource is a success with no rows', async () => {
    const result = await fetchAllPages(pagedClient([[]]), 'job.json', { maxPages: 10 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([]);
  });

  it('a transport failure is still returned as-is, ahead of any cap logic', async () => {
    const failing: Sm8Client = {
      async get() {
        return { ok: false as const, kind: 'rate_limited' as const };
      },
    };

    const result = await fetchAllPages(failing, 'job.json', { maxPages: 1 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // NOT overwritten by parse_error: the first failure encountered wins, and a
    // 429 must stay a 429 for the failure policy to classify it correctly.
    expect(result.kind).toBe('rate_limited');
  });

  it('the default cap is unchanged at 50', () => {
    expect(MAX_PAGES).toBe(50);
  });
});

describe('the audit fetches contacts with a filter (WR-04)', () => {
  it('jobcontact.json is filtered like the other three resources', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/core/audit/fetch-history.ts', 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    // An unfiltered walk pulled the account's ENTIRE contact table -- every
    // contact for every job ever -- which made it by far the likeliest resource
    // to hit the cap that is now a hard failure. `edit_date` also matches what
    // run-sync.ts already sends for this resource, so the audit path and the
    // connected-client path ask ServiceM8 the same question.
    expect(source).toMatch(/'jobcontact\.json',\s*\{\s*filter:\s*`edit_date gt/);
    expect(source).not.toMatch(/'jobcontact\.json',\s*\{\s*\}/);
  });
});
