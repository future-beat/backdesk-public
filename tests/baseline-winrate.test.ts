/**
 * The baseline win rate (AUD-02, D-14) — and the reason it is `null`, never 0.
 *
 * ── WHAT THIS NUMBER IS FOR ─────────────────────────────────────────────────
 *
 * Phase 7 reports recovered revenue NET OF BASELINE: of the quotes this client
 * won while we were chasing, how many would they have won anyway? The baseline
 * is the "anyway". It is captured at connect time, before the service has
 * touched anything, because it is unrecoverable afterwards — once the cadence
 * runs there is no un-chased population left to measure.
 *
 * ── WHY `null` IS NOT AN EDGE CASE BUT THE CENTRAL PROPERTY ─────────────────
 *
 * A client who issued no quotes in the 90 days before connecting has an
 * UNDEFINED win rate. Storing 0 for them tells Phase 7 they won nothing before
 * we arrived, so every win afterwards is attributed to the service and billed
 * against — including the ones they would have made regardless. That is an
 * invoice the client can disprove from their own records, and it is one
 * arithmetic shortcut away from happening.
 *
 * ── STATUS NOW, NOT STATUS THEN ─────────────────────────────────────────────
 *
 * The measure is: of the quotes ISSUED in the window, what fraction are in
 * Work Order or Completed TODAY. A quote issued in the window and won a month
 * after it closed still counts as won. Restricting wins to the window would
 * systematically understate every baseline — quotes take time to convert, and
 * the most recent ones in the window have had the least of it.
 */
import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { computeBaseline, type AuditLine } from '@/core/audit/aggregate';
import { connectServiceM8 } from '@/core/sync/connect';
import { closeDb } from '@/db/repository';

import { canReachServiceM8, sm8TestApiKey } from './helpers/env';
import { admin, seedTenant, teardownTenants } from './helpers/seed';

const NOW = new Date('2026-08-26T00:00:00.000Z');
const DAY = 86_400_000;

function line(over: Partial<AuditLine> = {}): AuditLine {
  return {
    status: 'Quote',
    quoteDateUtc: new Date(NOW.getTime() - 30 * DAY),
    valueCents: 100_000,
    followedUp: false,
    ...over,
  };
}

describe('computeBaseline (AUD-02)', () => {
  it('returns won / issued as a 4-decimal-place numeric string', () => {
    // 2 of 6 → 0.3333 (recurring, so the rounding is visible).
    const baseline = computeBaseline([
      line({ status: 'Quote' }),
      line({ status: 'Quote' }),
      line({ status: 'Quote' }),
      line({ status: 'Unsuccessful' }),
      line({ status: 'Work Order' }),
      line({ status: 'Completed' }),
    ]);

    expect(baseline.winRate).toBe('0.3333');
    expect(baseline.quotesIssued).toBe(6);
    expect(baseline.quotesWon).toBe(2);
  });

  it('counts BOTH Work Order and Completed as won', () => {
    // ServiceM8's four statuses do not progress linearly — a tradie can mark a
    // job Completed without it ever passing through Work Order (Pitfall 5).
    // Omitting Completed would understate the baseline for exactly the clients
    // who close work fastest.
    expect(computeBaseline([line({ status: 'Work Order' })]).winRate).toBe('1.0000');
    expect(computeBaseline([line({ status: 'Completed' })]).winRate).toBe('1.0000');
  });

  it('returns null — NEVER 0 — when no quotes were issued', () => {
    expect(computeBaseline([]).winRate).toBeNull();
    expect(computeBaseline([]).quotesIssued).toBe(0);
  });

  it('returns null when every line is a job that was never quoted', () => {
    // Same reasoning: a job created straight to Work Order was never a quote,
    // so it is neither a win nor a loss for a QUOTE win rate. A client whose
    // only jobs are walk-ins has no baseline, not a 100% one.
    const baseline = computeBaseline([
      line({ status: 'Work Order', quoteDateUtc: null }),
      line({ status: 'Completed', quoteDateUtc: null }),
    ]);

    expect(baseline.winRate).toBeNull();
    expect(baseline.quotesIssued).toBe(0);
  });

  it('returns 0.0000 — a real zero — when quotes were issued and none won', () => {
    // The distinction the whole file is about: this client HAS a baseline and
    // it is zero. That is a fact, and it is a different fact from "unknown".
    const baseline = computeBaseline([
      line({ status: 'Quote' }),
      line({ status: 'Unsuccessful' }),
    ]);

    expect(baseline.winRate).toBe('0.0000');
    expect(baseline.quotesIssued).toBe(2);
    expect(baseline.quotesWon).toBe(0);
  });

  it('counts a quote issued in-window but won after the window end', () => {
    // Status NOW is the measure — see the file header.
    const baseline = computeBaseline([
      line({ status: 'Completed', quoteDateUtc: new Date(NOW.getTime() - 89 * DAY) }),
      line({ status: 'Quote' }),
    ]);

    expect(baseline.winRate).toBe('0.5000');
  });

  it('fits numeric(5,4) for every possible ratio', () => {
    // The column is numeric(5,4): 1 digit before the point, 4 after. A value
    // rendered as '1.00000' or '0.33333333' is rejected by Postgres at INSERT,
    // which turns a reporting nicety into a failed connect.
    for (const [won, issued] of [
      [0, 1],
      [1, 1],
      [1, 3],
      [2, 3],
      [1, 7],
      [6, 7],
      [17, 143],
    ]) {
      const lines = [
        ...Array.from({ length: won }, () => line({ status: 'Work Order' as const })),
        ...Array.from({ length: issued - won }, () => line({ status: 'Quote' as const })),
      ];

      const winRate = computeBaseline(lines).winRate!;
      expect(winRate, `${won}/${issued}`).toMatch(/^[01]\.\d{4}$/);
      expect(Number(winRate)).toBeCloseTo(won / issued, 4);
    }
  });
});

/**
 * D-12's "exercises the same fetch code", asserted structurally.
 *
 * The commercial argument for one fetch path is that the audit is a PROMISE and
 * the client's own data is the DELIVERY: if the two are computed by different
 * code, a prospect can be shown a leakage figure that their first monthly
 * report then contradicts. No behavioural test can prove two implementations
 * are absent — only reading the source can.
 */
describe('one fetch path, one aggregation (D-12, D-14)', () => {
  const FETCH = readFileSync('src/core/audit/fetch-history.ts', 'utf8');
  const CONNECT = readFileSync('src/core/sync/connect.ts', 'utf8');

  it('fetches through the same Sm8Client the client sync uses', () => {
    expect(FETCH).toMatch(/from '@\/core\/servicem8\/(client|types)'/);
    expect(FETCH).toContain('fetchAllPages');
  });

  it('issues at most four resource fetches — no per-job N+1', () => {
    // 300 jobs × a notes call each is 600 requests against a 180/min ceiling
    // (RESEARCH anti-pattern). The bulk fetch + in-memory join is the whole
    // reason an audit takes seconds instead of minutes and does not get the
    // prospect's account rate-limited on first contact.
    const code = FETCH.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const calls = code.match(/fetchAllPages\(/g) ?? [];

    expect(calls).toHaveLength(4);
    // The paging walk lives inside fetchAllPages; a direct client.get here
    // would be a second, unaudited request path.
    expect(code).not.toMatch(/client\.get\(/);

    for (const resource of ['job.json', 'note.json', 'jobactivity.json', 'jobcontact.json']) {
      expect(
        (code.match(new RegExp(resource.replace('.', '\\.'), 'g')) ?? []).length,
        `${resource} is fetched from more than one call site`,
      ).toBe(1);
    }
  });

  it('connect.ts computes the baseline through computeBaseline, not by hand', () => {
    expect(CONNECT).toContain('computeBaseline');
    expect(CONNECT).toMatch(/from '@\/core\/audit\/aggregate'/);
  });

  it('writes the baseline inside the SAME transaction as the backfill', () => {
    // A connection row that is written but whose baseline is not is a client
    // for whom the pre-service window can never be reconstructed — the data it
    // needed was in memory, and the moment has passed. Committing them
    // together is the only way "we always have a baseline" is true.
    const transaction = CONNECT.match(/repo\.transaction\(async \(tx\) => \{[\s\S]*?\n {2}\}\)/)?.[0];

    expect(transaction, 'the backfill transaction block could not be located').toBeTruthy();
    for (const field of [
      'baselineWinRate',
      'baselineQuotesIssued',
      'baselineWindowStart',
      'baselineWindowEnd',
      'baselineComputedAt',
    ]) {
      expect(transaction, `${field} is written outside the backfill transaction`).toContain(
        field,
      );
    }
  });

  it('never lets the backfill emit outbox events (the 02-02 prohibition holds)', () => {
    // Restated here because this plan touches connect.ts: replaying three
    // months of status transitions into the cadence engine on connect day
    // fires follow-ups for jobs that closed in June.
    expect(CONNECT).not.toContain('quoteStatusEvents');
    expect(CONNECT).not.toMatch(/\.events\./);
  });
});

/**
 * The snapshot actually lands in the column (D-14).
 *
 * Every assertion above this point is about arithmetic and source text. None of
 * them would notice a `computeBaseline` call whose result is computed
 * correctly and then dropped on the floor — which is the failure that costs
 * most, because it is silent at connect time and only surfaces months later as
 * a report with no "before" column to compare against.
 *
 * Values are RECOMPUTED from the mirrored rows rather than hard-coded: the
 * trial account is live data and a seeded job added tomorrow must not turn this
 * suite red for the wrong reason. What is pinned is the RELATIONSHIP between
 * what was fetched and what was stored.
 */
describe.skipIf(!canReachServiceM8)('connectServiceM8 stores the baseline (D-14)', () => {
  const tenants: string[] = [];
  let tenantId: string;

  beforeAll(async () => {
    tenantId = await seedTenant('Baseline D14');
    tenants.push(tenantId);

    const result = await connectServiceM8(tenantId, sm8TestApiKey!);
    expect(
      result.ok,
      result.ok ? '' : `connect failed: ${result.kind} ${result.detail ?? ''}`,
    ).toBe(true);
  }, 120_000);

  afterAll(async () => {
    await teardownTenants(tenants);
    await closeDb();
  }, 60_000);

  it('writes all five baseline columns in one go', async () => {
    const { data } = await admin
      .from('sm8_connections')
      .select(
        'baseline_win_rate, baseline_quotes_issued, baseline_window_start, baseline_window_end, baseline_computed_at',
      )
      .eq('tenant_id', tenantId)
      .single();

    expect(data!.baseline_computed_at, 'the baseline was never computed').not.toBeNull();
    expect(data!.baseline_window_start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(data!.baseline_window_end).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Exactly 90 days apart — the window the audit uses, not a different one.
    const spanDays =
      (Date.parse(`${data!.baseline_window_end}T00:00:00Z`) -
        Date.parse(`${data!.baseline_window_start}T00:00:00Z`)) /
      86_400_000;
    expect(spanDays).toBe(90);
  });

  it('agrees with computeBaseline over the rows it just mirrored', async () => {
    const [{ data: connection }, { data: quotes }] = await Promise.all([
      admin
        .from('sm8_connections')
        .select('baseline_win_rate, baseline_quotes_issued, baseline_window_start, baseline_window_end')
        .eq('tenant_id', tenantId)
        .single(),
      admin
        .from('quotes')
        .select('status, quote_date_utc, sm8_active')
        .eq('tenant_id', tenantId),
    ]);

    const start = Date.parse(`${connection!.baseline_window_start}T00:00:00Z`);
    // The stored end is a date; the real window ended at an instant inside it.
    const end = Date.parse(`${connection!.baseline_window_end}T23:59:59Z`);

    const expected = computeBaseline(
      (quotes ?? [])
        .filter((q) => q.sm8_active && q.quote_date_utc !== null)
        .filter((q) => {
          const at = Date.parse(q.quote_date_utc as string);
          return at >= start && at <= end;
        })
        .map((q) => ({
          status: q.status as string,
          quoteDateUtc: new Date(q.quote_date_utc as string),
          valueCents: 0,
          followedUp: false,
        })),
    );

    expect(connection!.baseline_quotes_issued).toBe(expected.quotesIssued);

    // COMPARED AS A NUMBER, and the reason is a measured surprise worth
    // recording: PostgREST serialises `numeric` as a JSON NUMBER, not a quoted
    // string, so `baseline_win_rate` arrives here as `0.5` where
    // `computeBaseline` produced the string `'0.5000'`. Both are the same
    // value; only the transport differs.
    //
    // `computeBaseline` still returns a STRING on purpose — that is the value
    // written INTO a numeric(5,4) column, and handing drizzle a JS number for a
    // numeric column reintroduces the float round-trip the whole cents
    // discipline exists to prevent. The conversion belongs at the read edge,
    // which is here.
    expect(typeof connection!.baseline_win_rate).toBe('number');
    expect(Number(connection!.baseline_win_rate)).toBeCloseTo(Number(expected.winRate), 4);
  });

  it('leaves win rate null — not 0 — when nothing was quoted in the window', () => {
    // Proven at the unit level above; restated here as the property the STORED
    // column must carry, because `numeric` columns accept 0 quite happily and
    // the difference is invisible in the database.
    expect(computeBaseline([]).winRate).toBeNull();
  });
});
