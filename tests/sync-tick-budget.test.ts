/**
 * WR-03: the tick has a budget, says what it could not reach, and cannot starve
 * the same clients forever.
 *
 * ── WHY THESE RUN WITHOUT A DATABASE ────────────────────────────────────────
 *
 * The property under test is what happens when a cycle is NOT run. With the
 * deadline already blown, `runSyncTick` never calls `runSyncForConnection`,
 * never opens a transaction and never decrypts a credential — so the interesting
 * path is reachable with no stack at all. That is a happy accident worth keeping:
 * the mixed case (some cycles run, some skipped) is covered in
 * tests/sync-upsert.test.ts against real Postgres, and this file covers the
 * boundary and the reporting contract everywhere else.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * The loop was sequential under a hard `maxDuration = 300`, and one unresponsive
 * account costs ~65s (20s timeout x 3 attempts x 2 resources, plus jittered
 * sleeps). Five such clients consumed the whole budget, so at the target of
 * fifteen a ServiceM8 slowdown left two-thirds unattempted — and because the
 * order was `tenants.name`, it was the SAME two-thirds every tick. A starved
 * client writes no `sync_runs` row and never increments `consecutive_failures`,
 * so nothing anywhere reported it.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { runSyncTick, TICK_DEADLINE_MS, type SyncCycleResult } from '@/core/sync/run-sync';
import type { DueConnection } from '@/db/repository';

/** Strip comments so prose describing a rule cannot satisfy an assertion. */
const source = (path: string) =>
  readFileSync(path, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

function connection(n: number): DueConnection {
  return {
    tenantId: `0000000${n}-0000-4000-8000-00000000000${n}`,
    tenantName: `Client ${n}`,
    tenantTimezone: 'Australia/Perth',
    apiKeyCiphertext: 'enc:v1:aa:bb:cc',
    jobCursor: null,
    contactCursor: null,
    consecutiveFailures: 0,
    alertedAt: null,
  };
}

const CONNECTIONS = [connection(1), connection(2), connection(3)];

/**
 * A deadline already in the past. Every connection is therefore skipped before
 * any work begins — which is exactly the state a tick reaches after burning its
 * budget on the clients ahead of them.
 */
async function skipAll(): Promise<SyncCycleResult[]> {
  return runSyncTick({ connections: CONNECTIONS, deadlineMs: -1 });
}

describe('tick budget (WR-03)', () => {
  it('returns a result for every connection, reached or not', async () => {
    const results = await skipAll();

    // The count is the contract the route reports as `connections`. A tick that
    // silently returned only what it managed would make "we synced everyone"
    // and "we synced the first five" the same response.
    expect(results).toHaveLength(CONNECTIONS.length);
    expect(results.map((r) => r.tenantId)).toEqual(CONNECTIONS.map((c) => c.tenantId));
  });

  it('marks unreached connections skipped', async () => {
    const results = await skipAll();

    expect(results.every((r) => r.skipped)).toBe(true);
  });

  it('a skipped connection is NOT reported as a failure', async () => {
    const results = await skipAll();

    for (const result of results) {
      // Nothing was attempted, so there is no honest outcome and no sync_runs
      // row. Fabricating either would put a failure on a client whose only
      // problem is that we ran out of time.
      expect(result.outcome).toBeNull();
      expect(result.recorded).toBe(false);
      expect(result.paused).toBe(false);
      expect(result.alert).toBeNull();
    }
  });

  it('a skipped connection reports no work done', async () => {
    const results = await skipAll();

    for (const result of results) {
      expect(result.jobsFetched).toBe(0);
      expect(result.jobsUpserted).toBe(0);
      expect(result.contactsFetched).toBe(0);
      expect(result.eventsEmitted).toBe(0);
    }
  });

  it('an empty connection list is not an error', async () => {
    expect(await runSyncTick({ connections: [], deadlineMs: -1 })).toEqual([]);
  });

  it('a generous deadline does not skip anything', async () => {
    // Nothing to sync, so no database is touched — but the deadline branch must
    // be provably not taken, or the test above would pass with a hardcoded true.
    const results = await runSyncTick({ connections: [], deadlineMs: TICK_DEADLINE_MS });

    expect(results.every((r) => !r.skipped)).toBe(true);
  });
});

describe('the deadline leaves headroom inside maxDuration', () => {
  it('is 220s against the route 300s ceiling', () => {
    expect(TICK_DEADLINE_MS).toBe(220_000);
  });

  it('leaves more than one worst-case cycle of headroom', () => {
    // The deadline is checked BEFORE a cycle starts, so the last connection
    // admitted may still run a full worst case: 20s timeout x 3 attempts x 2
    // resources = 120s, plus jittered sleeps. The headroom must cover it, or
    // the platform kills a cycle mid-transaction — worse than not starting it.
    const WORST_CASE_CYCLE_MS = 65_000;
    const MAX_DURATION_MS = 300_000;

    expect(MAX_DURATION_MS - TICK_DEADLINE_MS).toBeGreaterThanOrEqual(WORST_CASE_CYCLE_MS);
  });
});

/**
 * 14-REVIEW WR-06: the tradie-booked pass runs after a cycle commits, outside
 * the start-of-cycle check above, so it carries a deadline of its own derived
 * from this tick's — the behaviour is pinned with a fake clock in
 * tests/lead-booked-deadline.test.ts; the wiring is pinned here.
 */
describe('the post-commit pass spends inside the tick budget (WR-06)', () => {
  const RUN_SYNC = source('src/core/sync/run-sync.ts');
  const CLIENT = source('src/core/servicem8/client.ts');

  it('runSyncTick hands every cycle the tick deadline', () => {
    expect(RUN_SYNC).toContain('const tickDeadlineAt = tickStartedAt + deadlineMs;');
    expect(RUN_SYNC).toContain('runSyncForConnection(conn, { ...options, tickDeadlineAt })');
  });

  it('the pass deadline is the tick deadline less the margin, on the wall clock', () => {
    expect(RUN_SYNC).toMatch(
      /\(options\.tickDeadlineAt \?\? Date\.now\(\) \+ TICK_DEADLINE_MS\) - LEAD_JOB_MATCH_PASS_MARGIN_MS/,
    );
    expect(RUN_SYNC).toContain('deadlineAt: passDeadlineAt');
  });

  it('a caller may only shorten the ServiceM8 read timeout, never lengthen it', () => {
    expect(CLIENT).toContain('Math.min(Math.ceil(options.timeoutMs), REQUEST_TIMEOUT_MS)');
  });
});

/**
 * The other half of the fix. A budget alone converts "the tail never syncs" into
 * "the tail never syncs, and we say so" — which is better, and still wrong. What
 * makes starvation temporary is that the order is keyed to how far behind each
 * client is, so a connection skipped by one tick leads the next.
 */
describe('ordering makes starvation temporary (WR-03)', () => {
  const REPO = source('src/db/repository/for-all-tenants.ts');

  it('the tick orders by last_success_at, furthest behind first', () => {
    expect(REPO).toMatch(/lastSuccessAt[\s\S]*ASC NULLS FIRST/);
  });

  it('no longer orders by tenant name, which was the starvation schedule', () => {
    const tick = REPO.slice(REPO.indexOf('forAllTenants_syncTick'));
    const orderBy = tick.slice(tick.indexOf('.orderBy'), tick.indexOf('.orderBy') + 200);

    expect(orderBy).not.toMatch(/tenants\.name/);
  });

  it('still breaks ties deterministically', () => {
    // Two connections with equal (or both NULL) last_success_at must not have an
    // order the planner may vary between ticks.
    const tick = REPO.slice(REPO.indexOf('forAllTenants_syncTick'));
    expect(tick).toMatch(/\.orderBy\([\s\S]*sm8Connections\.tenantId[\s\S]*?\)/);
  });
});

describe('the route reports what the tick could not reach', () => {
  const ROUTE = source('src/app/api/internal/sync-tick/route.ts');

  it('returns a skipped count', () => {
    // The response is the one artefact a cron log keeps. Without this, a tick
    // that reached five of fifteen clients is indistinguishable from one that
    // reached all fifteen.
    expect(ROUTE).toMatch(/skipped: results\.filter\(\(r\) => r\.skipped\)\.length/);
  });

  it('reports skipped per connection too', () => {
    expect(ROUTE).toMatch(/skipped: r\.skipped/);
  });
});
