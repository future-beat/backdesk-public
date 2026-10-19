/**
 * RPT-02 — PRESSING GENERATE TWICE MUST NOT PRODUCE TWO IDENTICAL DOCUMENTS.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHAT THIS SUITE IS DEFENDING, IN BOTH DIRECTIONS.                        │
 * │                                                                          │
 * │   * A comparator that says "unchanged" about a document that DID change  │
 * │     silently throws away a correction. The client keeps the wrong figure  │
 * │     and the operator is told the month is already up to date (T-Q-01).   │
 * │   * A comparator that says "changed" about an identical document is a    │
 * │     feature that is silently inert: the duplicates keep accumulating and │
 * │     nothing fails (T-Q-02). jsonb REORDERS OBJECT KEYS on storage, so    │
 * │     this is the failure mode a naive `JSON.stringify` equality has.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── WHY MOCKED, WHEN `monthly-report.test.ts` IS REAL ───────────────────────
 *
 * The real suite proves the thing only Postgres can settle: that the unchanged
 * check and the `MAX(version) + 1` arbiter compose under a genuine race, and
 * that a changed fee schedule still writes version 2. What it CANNOT do cheaply
 * is enumerate a comparator's edge cases — key order, undefined-vs-absent,
 * null-vs-absent, a swapped pair of lines — each of which would need a seeded
 * month of its own. Those are decided by a pure function, and this is where
 * they are pinned.
 *
 * PURE. No database, no `ALLOW_REMOTE_TESTS`, runs on bare `npm test`.
 */
import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The callback `forTenant(id).transaction` runs, as this suite intercepts it. */
type TxWork = (repo: unknown) => Promise<unknown>;

const TENANT = '11111111-1111-4111-8111-111111111111';
const REPORT_ID = '55555555-5555-4555-8555-555555555555';
const EXISTING_REPORT_ID = '66666666-6666-4666-8666-666666666666';

const latestVersionOf =
  vi.fn<(periodStart: string) => Promise<Array<{ id: string; version: number }>>>();
const byId = vi.fn<(reportId: string) => Promise<unknown[]>>();
const insertVersion =
  vi.fn<(row: Record<string, unknown>) => Promise<Array<{ id: string; version: number }>>>();

/** The tenant row both the pool read and the transaction read answer with. */
const TENANT_ROW = {
  id: TENANT,
  name: 'Comparator Plumbing',
  timezone: 'Australia/Perth',
  prospectId: null,
};

/** Connected five months before the month under test — the remote suite's seeds. */
const CONNECTION_ROW = {
  createdAt: new Date('2026-03-01T00:00:00.000Z'),
  baselineWinRate: '0.2500',
  baselineQuotesIssued: 40,
  baselineWindowStart: '2025-12-01',
  baselineWindowEnd: '2026-03-01',
};

/** One monthly fee in force for the whole of August — `no_fee` is not the case here. */
const FEE_ROW = {
  kind: 'monthly',
  amountCents: 59_700,
  effectiveFrom: '2026-08-01',
  createdAt: new Date('2026-07-20T00:00:00.000Z'),
  note: null,
};

/**
 * The repository the transaction callback sees.
 *
 * Every read answers the smallest thing that gets past the four refusals; the
 * `reports` seam is the only part under test.
 */
function txRepo(): unknown {
  return {
    tenant: { get: async () => [TENANT_ROW] },
    connection: { get: async () => [CONNECTION_ROW] },
    fees: { list: async () => [FEE_ROW] },
    attributions: { listForPeriod: async () => [] },
    ledger: { countQuotesChasedInPeriod: async () => 0 },
    inbound: { countThreadedInPeriod: async () => 0 },
    events: { countWonQuotesInPeriod: async () => 0 },
    // 2026-10-13, Phase 15 (15-06, D-03): the generator now reads the month's
    // missed-call counts on the same transaction repo. A month with no calls —
    // the all-zero, dense-bucket record the real read returns — so the block is
    // present on both presses and the comparator cases below are unchanged.
    metrics: {
      missedCallCounts: async () => ({
        captured: 0,
        withheld: 0,
        afterHours: 0,
        byHour: Array.from({ length: 24 }, () => 0),
        byIsoWeekday: Array.from({ length: 7 }, () => 0),
        afterHoursByIsoWeekday: Array.from({ length: 7 }, () => 0),
        textBacksSent: 0,
        textBacksDelivered: 0,
        deliveredSeconds: [],
        repliedLeadsOnDelivered: 0,
        leads: 0,
        jobsCreated: 0,
        jobsWon: 0,
        bookedByTradie: 0,
      }),
    },
    reports: { latestVersionOf, byId, insertVersion },
  };
}

vi.mock('@/db/repository', () => ({
  getProspect: async () => null,
  // ── THE POOL-SIDE OBJECT HAS NO `reports` KEY, DELIBERATELY (07 WR-02) ────
  //
  // `max: 5` is a ceiling on concurrency: a pool read issued while this call
  // already holds a transaction's connection makes each in-flight generate hold
  // two. If the unchanged check were ever written against `forTenant(id).reports`
  // instead of the transaction's `repo`, this mock throws TypeError rather than
  // passing — which is the only way a starvation deadlock gets caught in a unit
  // test.
  forTenant: () => ({
    tenant: { get: async () => [TENANT_ROW] },
    transaction: (work: TxWork) => work(txRepo()),
  }),
}));

const { generateMonthlyReport } = await import('@/core/reporting/generate');
const { canonicalJson, reportDocumentsUnchanged } = await import('@/core/reporting/unchanged');

/** The operator's clock — two days into September, so August is a closed month. */
const NOW = new Date('2026-09-02T02:00:00.000Z');
const AUGUST = { year: 2026, month: 8 } as const;

/* ------------------------------------------------------------------------- *
 * Fixtures
 * ------------------------------------------------------------------------- */

/** A realistic five-document set — every key of every schema, freshly built. */
function documents() {
  return {
    figures: {
      quotesChased: 2,
      replies: 2,
      jobsWonAttributed: 2,
      jobsWonTotal: 3,
      grossCents: 650_000,
      conservativeCents: 487_500,
      feesMonthlyCents: 59_700,
      feesSetupCents: 0,
      multipleConservativeBp: 8165,
      multipleGrossBp: 10_887,
      valueMissingCount: 0,
    } as Record<string, unknown>,
    lines: [
      {
        attributionId: '77777777-7777-4777-8777-777777777771',
        quoteId: '77777777-7777-4777-8777-777777777772',
        generatedJobId: '4192',
        jobDescription: 'Replace hot water system',
        contactFirstName: 'Dana',
        wonDetectedAt: '2026-08-05T02:00:00.000Z',
        touchCount: 2,
        firstTouchAt: '2026-08-01T02:00:00.000Z',
        lastTouchAt: '2026-08-03T02:00:00.000Z',
        replyCount: 1,
        replyLabels: ['interested'],
        grossCents: 250_000,
        conservativeCents: 187_500,
        valueSource: 'mirror',
      } as Record<string, unknown>,
      {
        attributionId: '77777777-7777-4777-8777-777777777773',
        quoteId: '77777777-7777-4777-8777-777777777774',
        generatedJobId: '4207',
        jobDescription: 'Rewire shed',
        contactFirstName: 'Sam',
        wonDetectedAt: '2026-08-19T02:00:00.000Z',
        touchCount: 1,
        firstTouchAt: '2026-08-12T02:00:00.000Z',
        lastTouchAt: '2026-08-12T02:00:00.000Z',
        replyCount: 0,
        replyLabels: [],
        grossCents: 400_000,
        conservativeCents: 300_000,
        valueSource: 'mirror',
      } as Record<string, unknown>,
    ],
    baseline: {
      rateBp: 2500,
      source: 'connect',
      sampleSize: 40,
      windowStart: '2025-12-01',
      windowEnd: '2026-03-01',
      prospectRateBp: null,
    } as Record<string, unknown>,
    constants: {
      attributionWindowDays: 30,
      defaultBaselineWinRate: 0.3,
      baselineMinQuotes: 20,
    } as Record<string, unknown>,
    fees: {
      monthlyCents: 59_700,
      setupCents: 0,
      daysCharged: 31,
      daysInPeriod: 31,
      rows: [
        {
          kind: 'monthly',
          amountCents: 59_700,
          effectiveFrom: '2026-08-01',
          createdAt: '2026-07-20T00:00:00.000Z',
          note: null,
        } as Record<string, unknown>,
      ],
    } as Record<string, unknown>,
  };
}

/** The same object with its own keys in the opposite insertion order. */
function reversedKeys(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).reverse()) out[key] = value[key];
  return out;
}

/** Value imports only — `import type { … }` lines are erased and are fine. */
function valueImportSources(path: string): string[] {
  const source = readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  return [...source.matchAll(/^import\s+([\s\S]*?)from\s+'([^']+)';$/gm)]
    .filter(([, clause]) => !/^\s*type\s/.test(clause))
    .map(([, , specifier]) => specifier);
}

/* ------------------------------------------------------------------------- *
 * The comparator
 * ------------------------------------------------------------------------- */

describe('reportDocumentsUnchanged decides whether a press writes (T-Q-01, T-Q-02)', () => {
  it('says unchanged for two structurally identical document sets', () => {
    expect(reportDocumentsUnchanged(documents(), documents())).toBe(true);
  });

  it('says CHANGED when one figure differs by a cent', () => {
    const next = documents();
    next.figures.grossCents = 650_001;

    expect(
      reportDocumentsUnchanged(next, documents()),
      'A CORRECTION MUST STILL BE WRITTEN. Swallowing this is a client keeping ' +
        'a figure we know to be wrong.',
    ).toBe(false);
  });

  it('says CHANGED when one per-job line differs', () => {
    const next = documents();
    next.lines[0].replyCount = 2;

    expect(reportDocumentsUnchanged(next, documents())).toBe(false);
  });

  it('says CHANGED when two lines are swapped — array order is the printed order', () => {
    const next = documents();
    next.lines = [next.lines[1], next.lines[0]];

    expect(
      reportDocumentsUnchanged(next, documents()),
      'The lines are stored in `won_detected_at ASC` order because that is the ' +
        'order the printed table prints in. A reorder is a different document.',
    ).toBe(false);
  });

  it('says unchanged when object KEY ORDER differs at any depth (jsonb re-keys)', () => {
    const previous = documents();
    previous.figures = reversedKeys(previous.figures);
    previous.baseline = reversedKeys(previous.baseline);
    (previous.fees.rows as Record<string, unknown>[])[0] = reversedKeys(
      (previous.fees.rows as Record<string, unknown>[])[0],
    );

    expect(
      reportDocumentsUnchanged(documents(), previous),
      'jsonb does not preserve key order. A byte comparison that did would call ' +
        'EVERY stored row changed and leave the feature inert.',
    ).toBe(true);
  });

  it('says unchanged when a property is `undefined` on one side and ABSENT on the other', () => {
    const next = documents();
    (next.fees.rows as Record<string, unknown>[])[0].note = undefined;
    next.baseline.windowStart = undefined;

    const previous = documents();
    delete (previous.fees.rows as Record<string, unknown>[])[0].note;
    delete previous.baseline.windowStart;

    expect(
      reportDocumentsUnchanged(next, previous),
      'jsonb cannot carry `undefined`; the stored row simply has no key. The ' +
        'generator that wrote it must compare equal to what came back.',
    ).toBe(true);
  });

  it('says CHANGED when a property is `null` on one side and ABSENT on the other', () => {
    const next = documents();
    const previous = documents();
    delete (previous.fees.rows as Record<string, unknown>[])[0].note;

    expect(
      reportDocumentsUnchanged(next, previous),
      'jsonb KEEPS null. `note: null` and no note are different stored documents.',
    ).toBe(false);
  });

  it('ignores everything outside the five documents', () => {
    const previous = {
      ...documents(),
      id: EXISTING_REPORT_ID,
      version: 9,
      generatedAt: new Date('2026-09-01T00:00:00.000Z'),
      periodStart: '2026-08-01',
      periodEnd: '2026-09-01',
      timezone: 'Australia/Perth',
      tenantId: TENANT,
    } as unknown as ReturnType<typeof documents>;

    expect(
      reportDocumentsUnchanged(documents(), previous),
      '`generatedAt` differs on every stored row by construction. Comparing it ' +
        'would make the comparator answer "changed" always.',
    ).toBe(true);
  });

  it('canonicalises key order and drops undefined, exactly as jsonb stores', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
    expect(canonicalJson({ a: 1, b: null })).not.toBe(canonicalJson({ a: 1 }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
});

/* ------------------------------------------------------------------------- *
 * The generate path
 * ------------------------------------------------------------------------- */

describe('generateMonthlyReport writes nothing when the newest version already says it', () => {
  beforeEach(() => {
    latestVersionOf.mockReset();
    byId.mockReset();
    insertVersion.mockReset();

    latestVersionOf.mockResolvedValue([]);
    byId.mockResolvedValue([]);
    insertVersion.mockResolvedValue([{ id: REPORT_ID, version: 1 }]);
  });

  it('writes version 1 when the month has no report at all', async () => {
    const result = await generateMonthlyReport(TENANT, AUGUST, NOW);

    expect(result.kind).toBe('generated');
    if (result.kind !== 'generated') return;
    expect(result.reportId).toBe(REPORT_ID);
    expect(result.periodStart).toBe('2026-08-01');
    expect(insertVersion).toHaveBeenCalledTimes(1);
  });

  it('returns `unchanged` and calls insertVersion ZERO times for an identical month', async () => {
    // The bytes the generator would write, captured from a first real press.
    await generateMonthlyReport(TENANT, AUGUST, NOW);
    const written = insertVersion.mock.calls[0][0];

    // Through jsonb and back: serialised, revived, and re-keyed the way a
    // round trip through the column re-keys it.
    const stored = JSON.parse(JSON.stringify(written)) as Record<string, unknown>;
    stored.figures = reversedKeys(stored.figures as Record<string, unknown>);
    stored.baseline = reversedKeys(stored.baseline as Record<string, unknown>);

    insertVersion.mockClear();
    latestVersionOf.mockResolvedValue([{ id: EXISTING_REPORT_ID, version: 3 }]);
    byId.mockResolvedValue([{ id: EXISTING_REPORT_ID, version: 3, ...stored }]);

    const again = await generateMonthlyReport(TENANT, AUGUST, NOW);

    expect(again).toEqual({
      kind: 'unchanged',
      reportId: EXISTING_REPORT_ID,
      version: 3,
      periodStart: '2026-08-01',
    });
    expect(
      insertVersion,
      'THE WHOLE POINT. Three identical presses used to leave three versions ' +
        'and a list that read like three corrections.',
    ).toHaveBeenCalledTimes(0);
    expect(byId).toHaveBeenCalledWith(EXISTING_REPORT_ID);
  });

  it('still writes a new version when the stored document differs', async () => {
    await generateMonthlyReport(TENANT, AUGUST, NOW);
    const written = insertVersion.mock.calls[0][0];

    const stored = JSON.parse(JSON.stringify(written)) as Record<string, unknown>;
    (stored.figures as Record<string, unknown>).quotesChased = 99;

    insertVersion.mockClear();
    insertVersion.mockResolvedValue([{ id: REPORT_ID, version: 4 }]);
    latestVersionOf.mockResolvedValue([{ id: EXISTING_REPORT_ID, version: 3 }]);
    byId.mockResolvedValue([{ id: EXISTING_REPORT_ID, version: 3, ...stored }]);

    const again = await generateMonthlyReport(TENANT, AUGUST, NOW);

    expect(again.kind).toBe('generated');
    if (again.kind !== 'generated') return;
    expect(again.version).toBe(4);
    expect(insertVersion).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------------- *
 * The seams, as source assertions
 * ------------------------------------------------------------------------- */

describe('the comparator is a leaf and the check precedes the write', () => {
  const UNCHANGED = 'src/core/reporting/unchanged.ts';
  const GENERATE = 'src/core/reporting/generate.ts';

  it('reaches nothing — no database, no generator, no zod', () => {
    expect(
      valueImportSources(UNCHANGED),
      'The comparator decides whether a press writes. A leaf can be tested by ' +
        'asserting bytes, which is the only way its edge cases get enumerated.',
    ).toEqual([]);
  });

  it('compares BEFORE it inserts', () => {
    const source = readFileSync(GENERATE, 'utf8');
    const compared = source.indexOf('reportDocumentsUnchanged(');
    const inserted = source.indexOf('repo.reports.insertVersion(');

    expect(compared).toBeGreaterThan(-1);
    expect(inserted).toBeGreaterThan(-1);
    expect(compared, 'A check after the write is not a check.').toBeLessThan(inserted);
  });

  it('reads the previous version through the TRANSACTION repo', () => {
    // COMMENTS STRIPPED FIRST. The prose beside the check NAMES the pool-side
    // call it exists to forbid, and an assertion that reads prose is an
    // assertion that fails when the reason is written down.
    const source = readFileSync(GENERATE, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    expect(source).toContain('repo.reports.latestVersionOf(');
    expect(source).toContain('repo.reports.byId(');
    expect(
      source,
      'A pool-side read under an open transaction holds two connections against ' +
        'a `max: 5` pool (07 WR-02).',
    ).not.toContain('forTenant(tenantId).reports');
  });
});
