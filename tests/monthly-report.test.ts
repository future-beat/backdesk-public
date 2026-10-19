/**
 * THE MONTHLY REPORT, END TO END, AGAINST THE REAL DATABASE (RPT-02).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHAT THIS SUITE IS ACTUALLY DEFENDING: a document handed to the person   │
 * │ being billed. Every case below is a way that document could be wrong in  │
 * │ a manner the client can prove — a job billed in two months, a report     │
 * │ silently replaced after it was sent, a figure that disagrees with the    │
 * │ per-job table under it, a customer's mobile number printed on it.        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The three properties that need a REAL Postgres and cannot be proved in a unit
 * test:
 *
 *   * HALF-OPEN MONTHS ARE A QUERY, NOT A CONVENTION. `listForPeriod` is
 *     `>= start AND < end` in SQL; a win detected at exactly 1 September local
 *     must not appear in August. Proved against a row seeded at precisely that
 *     millisecond, not mid-month.
 *   * VERSIONING IS AN INDEX. `reports.insertVersion` computes
 *     `COALESCE(MAX(version), 0) + 1` inside the INSERT and
 *     `monthly_reports_version_uniq` arbitrates. Two concurrent generates are
 *     therefore a race only Postgres can settle, and the loser's 23505 mapping
 *     to "just generated — reload" is what this suite pins.
 *   * THE THREE COUNT READS ARE SQL COPIES OF A TYPESCRIPT PREDICATE. A
 *     `delivery_status <> 'undelivered'` written where
 *     `IS DISTINCT FROM` belongs silently drops every email touch and every
 *     pending SMS — most of the qualifying rows in the table — and produces a
 *     plausible, wrong "quotes chased" figure. Only a real row with a NULL
 *     receipt catches it.
 *   * AN IDENTICAL SECOND PRESS WRITES NOTHING, AND A CHANGED ONE STILL WRITES
 *     N+1 (quick-260904-dfq). The comparator itself is a pure function pinned in
 *     `tests/report-unchanged.test.ts`; what only the real index can prove is
 *     that the idempotency check and the `MAX(version) + 1` arbiter COMPOSE —
 *     that a re-press finds the document jsonb actually stored (key order and
 *     all), and that a fee appended mid-month still produces version 2 beside a
 *     version 1 nobody deleted.
 *
 * REMOTE. It seeds and tears down against the hosted Sydney project, so it runs
 * only under `npm run test:remote`.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseReportDocument, reportFiguresSchema } from '../src/core/reporting/document';
import { generateMonthlyReport } from '../src/core/reporting/generate';
import { closeDb, forTenant } from '../src/db/repository';

import {
  admin,
  seedCadence,
  seedConnection,
  seedFee,
  seedInbound,
  seedLedgerRow,
  seedQuotes,
  seedTenant,
  teardownTenants,
} from './helpers/seed';

const REPORT_PAGE_SOURCE = 'src/app/(console)/reports/[client]/[reportId]/page.tsx';

/**
 * PERTH IS UTC+8 AND HAS NO DST, which is what makes these literals stable —
 * and is exactly why the boundary case below is written as an INSTANT rather
 * than as a local date string. August 2026 in `Australia/Perth` runs from
 * `2026-07-31T16:00:00Z` (inclusive) to `2026-08-31T16:00:00Z` (EXCLUSIVE).
 */
const AUGUST_END_UTC = '2026-08-31T16:00:00.000Z';

/** The operator's clock for every generate in this suite. Two days into September. */
const NOW = new Date('2026-09-02T02:00:00.000Z');

/** The connect instant every seeded tenant shares — five months before August. */
const CONNECTED_AT = '2026-03-01T00:00:00.000Z';

const MONTHLY_FEE_CENTS = 59_700;

let tenantA: string;
/** No fee schedule at all — the U-4 refusal. */
let tenantNoFee: string;
/** A deliberate $0.00 month — a fact, not a gap. */
let tenantZeroFee: string;

let quoteIds: string[];

/** August's version 1, captured by the first test and read by the two after it. */
let augustV1Id: string;

/**
 * A COMPLETE EVIDENCE CHAIN, because the generator PARSES it with
 * `attributionEvidenceSchema` (a `strictObject` at every depth) before it
 * freezes a line. A partial fixture here would make every line assertion below
 * a test of the fixture rather than of the generator.
 *
 * The description is exactly 60 code points plus the ellipsis — the bound the
 * frozen line is held to, seeded AT the bound so an off-by-one in either
 * direction fails rather than passes.
 */
function evidenceFor(jobNumber: string, options: { label?: string | null } = {}) {
  return {
    wonEventId: -1,
    ledger: [
      {
        id: randomUUID(),
        touchNumber: 1,
        channel: 'sms',
        claimedAt: '2026-08-02T02:00:00.000Z',
        // NULL — no receipt yet, which QUALIFIES (D-02).
        deliveryStatus: null,
      },
      {
        id: randomUUID(),
        touchNumber: 2,
        channel: 'email',
        claimedAt: '2026-08-04T02:00:00.000Z',
        deliveryStatus: null,
      },
    ],
    inbound: [
      {
        id: randomUUID(),
        receivedAt: '2026-08-05T01:00:00.000Z',
        label: options.label ?? 'interested',
        isHot: false,
      },
    ],
    escalations: [],
    cadences: [],
    generatedJobId: jobNumber,
    jobDescription: `${'Bathroom renovation in Scarborough, second-storey ext'.padEnd(60, 'x')}…`,
    contactFirstName: 'Dave',
    constants: { attributionWindowDays: 30 },
    baseline: {
      rateBp: 2500,
      source: 'connect' as const,
      sampleSize: 40,
      windowStart: '2025-12-01',
      windowEnd: '2026-03-01',
    },
  };
}

async function seedAttributionRow(
  tenantId: string,
  quoteId: string,
  entry: {
    wonDetectedAt: string;
    grossCents: number;
    conservativeCents: number;
    jobNumber: string;
  },
): Promise<string> {
  const { data, error } = await admin
    .from('quote_attributions')
    .insert({
      tenant_id: tenantId,
      quote_id: quoteId,
      sm8_job_uuid: randomUUID(),
      // Negative: `quote_status_events.id` is a bigserial, so a negative id can
      // never collide with a real event this suite did not write.
      won_event_id: -Math.floor(Math.random() * 1e9) - 1,
      won_detected_at: entry.wonDetectedAt,
      first_touch_claimed_at: '2026-08-02T02:00:00.000Z',
      last_touch_claimed_at: '2026-08-04T02:00:00.000Z',
      qualifying_touch_count: 2,
      gross_cents: entry.grossCents,
      conservative_cents: entry.conservativeCents,
      value_source: 'mirror',
      baseline_rate_bp: 2500,
      baseline_source: 'connect',
      baseline_sample: 40,
      window_days: 30,
      evidence: evidenceFor(entry.jobNumber),
    })
    .select('id')
    .single();

  if (error) throw new Error(`Seeding an attribution failed: ${error.message}`);
  return (data as { id: string }).id;
}

/** A `won` row on the outbox — what `countWonQuotesInPeriod` reads. */
async function seedWonEvent(
  tenantId: string,
  quoteId: string,
  detectedAt: string,
): Promise<void> {
  const { error } = await admin.from('quote_status_events').insert({
    tenant_id: tenantId,
    quote_id: quoteId,
    sm8_job_uuid: randomUUID(),
    from_status: 'Quote',
    to_status: 'Work Order',
    event_type: 'won',
    detected_at: detectedAt,
  });
  if (error) throw new Error(`Seeding a won event failed: ${error.message}`);
}

beforeAll(async () => {
  tenantA = await seedTenant('Monthly Report A');
  tenantNoFee = await seedTenant('Monthly Report NoFee');
  tenantZeroFee = await seedTenant('Monthly Report ZeroFee');

  for (const id of [tenantA, tenantNoFee, tenantZeroFee]) {
    await seedConnection(id, {
      created_at: CONNECTED_AT,
      baseline_win_rate: '0.2500',
      baseline_quotes_issued: 40,
      baseline_window_start: '2025-12-01',
      baseline_window_end: '2026-03-01',
    });
  }

  await seedFee(tenantA, {
    kind: 'monthly',
    amountCents: MONTHLY_FEE_CENTS,
    // The 1st, so the whole of August is charged and the pro-rated figure
    // collapses to exactly the retainer — the case a client checks first.
    effectiveFrom: '2026-08-01',
  });
  await seedFee(tenantZeroFee, {
    kind: 'monthly',
    amountCents: 0,
    effectiveFrom: '2026-08-01',
  });

  const quotes = await seedQuotes(tenantA, [{}, {}, {}, {}]);
  quoteIds = quotes.map((q) => q.id);

  // Two wins INSIDE Perth August, one at exactly the first millisecond of
  // September local — the boundary the whole D-10 promise rests on.
  await seedAttributionRow(tenantA, quoteIds[0], {
    wonDetectedAt: '2026-08-05T02:00:00.000Z',
    grossCents: 250_000,
    conservativeCents: 187_500,
    jobNumber: '4192',
  });
  await seedAttributionRow(tenantA, quoteIds[1], {
    wonDetectedAt: '2026-08-20T02:00:00.000Z',
    grossCents: 400_000,
    conservativeCents: 300_000,
    jobNumber: '4207',
  });
  await seedAttributionRow(tenantA, quoteIds[2], {
    wonDetectedAt: AUGUST_END_UTC,
    grossCents: 999_900,
    conservativeCents: 999_900,
    jobNumber: '4300',
  });

  // A THIRD win the service does NOT claim — the `of {t} won in the month`
  // qualifier's input. Three `won` events in August, two of them attributed.
  await seedWonEvent(tenantA, quoteIds[0], '2026-08-05T02:00:00.000Z');
  await seedWonEvent(tenantA, quoteIds[1], '2026-08-20T02:00:00.000Z');
  await seedWonEvent(tenantA, quoteIds[3], '2026-08-22T02:00:00.000Z');
  // And one outside the month, which must not be counted.
  await seedWonEvent(tenantA, quoteIds[2], AUGUST_END_UTC);

  // ONE CADENCE PER QUOTE. `send_ledger_cadence_touch_uniq` is
  // (cadence_id, touch_number), so sharing a cadence across quotes would make
  // the touch numbers collide — and the never-twice claim it enforces is the
  // Phase 3 guarantee, not a nuisance to work around with higher numbers.
  const cadences = [
    await seedCadence(tenantA, quoteIds[0]),
    await seedCadence(tenantA, quoteIds[1]),
    await seedCadence(tenantA, quoteIds[2]),
    await seedCadence(tenantA, quoteIds[3]),
  ];

  // TWO touches on ONE quote, so `COUNT(DISTINCT quote_id)` is provably not
  // `COUNT(*)`: without DISTINCT this reads 3 instead of 2, and "quotes chased"
  // silently becomes "messages sent" — inflated by the cadence length.
  await seedLedgerRow(tenantA, {
    cadenceId: cadences[0],
    quoteId: quoteIds[0],
    touchNumber: 1,
    claimedAt: '2026-08-02T02:00:00.000Z',
  });
  await seedLedgerRow(tenantA, {
    cadenceId: cadences[0],
    quoteId: quoteIds[0],
    touchNumber: 2,
    // An EMAIL touch: `delivery_status` is NULL forever. Under a
    // `delivery_status <> 'undelivered'` predicate this row disappears.
    claimedAt: '2026-08-04T02:00:00.000Z',
    channel: 'email',
    sender: 'resend',
    toAddress: 'nobody@example.invalid',
  });
  await seedLedgerRow(tenantA, {
    cadenceId: cadences[1],
    quoteId: quoteIds[1],
    touchNumber: 1,
    claimedAt: '2026-08-10T02:00:00.000Z',
  });
  // A STUB row, excluded by the `sender` column forever, and an UNDELIVERED
  // one. Both on a quote nothing else touches, so either leaking into the count
  // moves it by exactly one.
  await seedLedgerRow(tenantA, {
    cadenceId: cadences[3],
    quoteId: quoteIds[3],
    touchNumber: 1,
    claimedAt: '2026-08-11T02:00:00.000Z',
    sender: 'stub',
    outcome: 'stub_sent',
  });
  await seedLedgerRow(tenantA, {
    cadenceId: cadences[3],
    quoteId: quoteIds[3],
    touchNumber: 2,
    claimedAt: '2026-08-12T02:00:00.000Z',
    deliveryStatus: 'undelivered',
  });
  // OUTSIDE the month, on a quote otherwise untouched in August.
  await seedLedgerRow(tenantA, {
    cadenceId: cadences[2],
    quoteId: quoteIds[2],
    touchNumber: 1,
    claimedAt: '2026-07-02T02:00:00.000Z',
  });

  // Two threaded replies in August; one `ambiguous` row that must not count
  // (its `quote_id` is a guess) and one outside the month.
  await seedInbound(tenantA, {
    cadenceId: cadences[0],
    quoteId: quoteIds[0],
    receivedAt: '2026-08-05T01:00:00.000Z',
    label: 'interested',
  });
  await seedInbound(tenantA, {
    cadenceId: cadences[1],
    quoteId: quoteIds[1],
    receivedAt: '2026-08-19T01:00:00.000Z',
    label: 'objection',
  });
  await seedInbound(tenantA, {
    cadenceId: cadences[1],
    quoteId: quoteIds[1],
    receivedAt: '2026-08-19T02:00:00.000Z',
    attribution: 'ambiguous',
  });
  await seedInbound(tenantA, {
    cadenceId: cadences[0],
    quoteId: quoteIds[0],
    receivedAt: '2026-07-05T01:00:00.000Z',
    label: 'interested',
  });
});

afterAll(async () => {
  await teardownTenants([tenantA, tenantNoFee, tenantZeroFee]);
  await closeDb();
});

describe('generateMonthlyReport freezes one calendar month (RPT-02, D-10, D-11)', () => {
  it('writes version 1 with figures, lines and the frozen constants', async () => {
    const result = await generateMonthlyReport(tenantA, { year: 2026, month: 8 }, NOW);

    expect(result.kind, 'August 2026 is a closed month with a fee in force.').toBe('generated');
    if (result.kind !== 'generated') return;

    expect(result.version).toBe(1);
    augustV1Id = result.reportId;

    const [row] = await forTenant(tenantA).reports.byId(result.reportId);
    expect(row, 'The row the action redirects to must be readable back.').toBeDefined();
    if (!row) return;

    // HALF-OPEN, AS LOCAL DATES. `period_end` is the FIRST day of September,
    // exclusive — a reader of the row cannot mistake it for "includes 1 Sept".
    expect(row.periodStart).toBe('2026-08-01');
    expect(row.periodEnd).toBe('2026-09-01');
    expect(row.timezone).toBe('Australia/Perth');

    const figures = row.figures as Record<string, number | null>;

    expect(
      figures.jobsWonAttributed,
      'THE 1-SEPTEMBER-LOCAL WIN MUST NOT BE IN AUGUST. A closed upper bound ' +
        'would bill that job in two months, on two invoices.',
    ).toBe(2);
    expect(figures.grossCents).toBe(650_000);
    expect(figures.conservativeCents).toBe(487_500);

    // The whole of August at one unchanged retainer collapses to exactly the
    // retainer — not a cent under. That is the pro-rating rule's headline case.
    expect(figures.feesMonthlyCents).toBe(MONTHLY_FEE_CENTS);
    expect(figures.feesSetupCents).toBe(0);
    expect(figures.multipleConservativeBp).toBe(
      Math.floor((487_500 * 10_000) / MONTHLY_FEE_CENTS),
    );

    // Two DISTINCT quotes chased: three qualifying rows across two quotes, plus
    // a stub, an undelivered and a July row that must all be excluded.
    expect(
      figures.quotesChased,
      'DISTINCT on the quote, and the D-02 predicate in SQL — see the seeds.',
    ).toBe(2);
    expect(figures.replies, 'Threaded replies in the month only.').toBe(2);
    expect(
      figures.jobsWonTotal,
      "The client's own wins, printed beside the ones we claim (D-13).",
    ).toBe(3);
    expect(figures.valueMissingCount).toBe(0);

    const lines = row.lines as Array<Record<string, unknown>>;
    expect(lines).toHaveLength(2);

    // ORDERED BY `won_detected_at` ASC — the order the printed table prints in,
    // and the order two renders of one frozen report must agree on.
    expect(lines[0].generatedJobId).toBe('4192');
    expect(lines[1].generatedJobId).toBe('4207');

    for (const line of lines) {
      expect(
        Array.from(String(line.jobDescription)).length,
        'Sixty code points plus the ellipsis, frozen — print and screen render ' +
          'the same bytes.',
      ).toBeLessThanOrEqual(61);
      expect(Array.from(String(line.contactFirstName)).length).toBeLessThanOrEqual(32);
    }

    const baseline = row.baseline as Record<string, unknown>;
    expect(baseline.source).toBe('connect');
    expect(baseline.rateBp).toBe(2500);

    const constants = row.constants as Record<string, unknown>;
    expect(
      constants.attributionWindowDays,
      'The constant this report was computed under, frozen with it (D-01).',
    ).toBe(30);
  });

  it('pressing Generate again with nothing changed writes nothing (quick-260904-dfq)', async () => {
    // ── WHAT ONLY THE REAL COLUMN CAN PROVE ─────────────────────────────────
    //
    // The comparator is pure and its edge cases live in
    // `tests/report-unchanged.test.ts`. What that suite cannot prove is that the
    // documents coming back out of `jsonb` compare equal to the ones that went
    // in: the column REORDERS OBJECT KEYS and drops nothing else, and a
    // comparator that got either fact wrong would leave this feature silently
    // inert with the duplicates still accumulating.
    const again = await generateMonthlyReport(tenantA, { year: 2026, month: 8 }, NOW);

    expect(
      again.kind,
      'Nothing has changed since version 1, so there is no fourth identical ' +
        'version to create — the operator is pointed at the one that exists.',
    ).toBe('unchanged');
    if (again.kind !== 'unchanged') return;

    expect(again.version).toBe(1);
    expect(again.reportId).toBe(augustV1Id);

    const listed = await forTenant(tenantA).reports.list();
    const august = listed.filter((row) => row.periodStart === '2026-08-01');

    expect(august.map((row) => row.version), 'NO ROW WAS WRITTEN.').toEqual([1]);
  });

  it('generates version 2 after the fee schedule changed and KEEPS version 1 (D-11)', async () => {
    // A setup fee dated INSIDE August, so both `figures.feesSetupCents` and the
    // `fees.rows` array differ from version 1 — a real correction, not a nudge
    // to the comparator. No note: the T-7-20 serialisation test below reads the
    // newest August row and asserts no `@` and no `+61` anywhere in it.
    await seedFee(tenantA, {
      kind: 'setup',
      amountCents: 99_000,
      effectiveFrom: '2026-08-15',
    });

    const again = await generateMonthlyReport(tenantA, { year: 2026, month: 8 }, NOW);

    expect(again.kind).toBe('generated');
    if (again.kind !== 'generated') return;
    expect(again.version).toBe(2);

    const listed = await forTenant(tenantA).reports.list();
    const august = listed.filter((row) => row.periodStart === '2026-08-01');

    expect(
      august.map((row) => row.version),
      'A CORRECTION IS A NEW VERSION, NOT AN EDIT. The document a client was ' +
        'already sent has to stay readable.',
      ).toEqual([2, 1]);

    const [row] = await forTenant(tenantA).reports.byId(again.reportId);
    expect(row, 'The corrected version must be readable back.').toBeDefined();
    if (!row) return;

    const figures = row.figures as Record<string, number | null>;
    expect(
      figures.feesSetupCents,
      'The changed figure, in the new version — proof the write happened ' +
        'BECAUSE the document differed and not merely because a button was ' +
        'pressed twice.',
    ).toBe(99_000);
  });

  it('refuses a month that has not started', async () => {
    const result = await generateMonthlyReport(tenantA, { year: 2026, month: 10 }, NOW);
    expect(result.kind).toBe('future_month');
  });

  it('refuses a month that ended before the client was connected', async () => {
    const result = await generateMonthlyReport(tenantA, { year: 2026, month: 2 }, NOW);
    expect(result.kind).toBe('before_connection');
  });

  it('refuses a month with NO monthly fee recorded (U-4)', async () => {
    const result = await generateMonthlyReport(tenantNoFee, { year: 2026, month: 8 }, NOW);

    expect(
      result.kind,
      'MISSING is the refusal. Generating here would print a `—` hero and ' +
        'invite the operator to send a report with no multiple on it.',
    ).toBe('no_fee');

    const listed = await forTenant(tenantNoFee).reports.list();
    expect(listed, 'A refusal writes nothing.').toEqual([]);
  });

  it('GENERATES for a recorded $0.00 fee, with no multiple', async () => {
    const result = await generateMonthlyReport(tenantZeroFee, { year: 2026, month: 8 }, NOW);

    expect(
      result.kind,
      'A deliberate $0.00 month — a pilot, a make-good — is a FACT, and is ' +
        'never conflated with "no fee entered yet".',
    ).toBe('generated');
    if (result.kind !== 'generated') return;

    const [row] = await forTenant(tenantZeroFee).reports.byId(result.reportId);
    const figures = row?.figures as Record<string, number | null>;

    expect(figures.feesMonthlyCents).toBe(0);
    expect(
      figures.multipleConservativeBp,
      '`null` means "no denominator" and renders as `—`. Printing `0.0×` here ' +
        'would accuse a working service of failing.',
    ).toBeNull();
  });

  it('never lets two concurrent generates share or skip a version (T-7-19)', async () => {
    // ── WHAT THIS TEST CAN AND CANNOT PROVE ─────────────────────────────────
    //
    // It was titled "lets exactly one commit" and asserted
    // `toBeGreaterThanOrEqual(1)`, which is satisfied by BOTH outcomes — so on
    // a warm pooler, where the two transactions serialise and both succeed, the
    // `concurrent` arm was never exercised and the loser loop iterated zero
    // times. Green, without having tested the thing in its own name.
    //
    // The race is genuinely non-deterministic: `insertVersion` computes
    // `MAX(version) + 1` inside the INSERT, so whether the second transaction
    // sees the first's committed row depends on which of ~8 reads each is on
    // when the other commits. BOTH outcomes are correct, and the test now says
    // which one it got and asserts the right thing about each, rather than
    // asserting something weak enough to be true of both.
    //
    // THE ARBITER'S EXISTENCE IS PROVEN ELSEWHERE, deterministically:
    // `tests/rls-coverage.test.ts` asserts `monthly_reports_version_uniq` is on
    // the table. This test's job is the behaviour on top of it.
    const results = await Promise.all([
      generateMonthlyReport(tenantA, { year: 2026, month: 9 }, NOW),
      generateMonthlyReport(tenantA, { year: 2026, month: 9 }, NOW),
    ]);

    const generated = results.filter((r) => r.kind === 'generated');
    const losers = results.filter((r) => r.kind !== 'generated');
    const versions = generated.map((r) => (r.kind === 'generated' ? r.version : -1));

    // EXACTLY TWO LEGAL SHAPES, and the assertion names both rather than
    // admitting anything with at least one winner.
    //
    // `[2, 0]` IS NARROWER THAN IT WAS since the idempotency check landed: two
    // winners now requires BOTH transactions to have passed the unchanged check
    // before either committed. It stays a legal shape — the check reads the
    // transaction's own snapshot and never claims to serialise anything — so
    // the assertion is unchanged.
    expect(
      [generated.length, losers.length],
      'Either the index arbitrated (1 winner, 1 concurrent) or the two ' +
        'transactions serialised (2 winners). Anything else — two raises, or a ' +
        'loser reporting something the operator cannot act on — is a bug.',
    ).toEqual(generated.length === 1 ? [1, 1] : [2, 0]);

    // THE INVARIANT THAT HOLDS IN BOTH: versions are unique and dense. Two rows
    // sharing a version is two documents claiming to be the same one; a gap is
    // a version somebody will ask to see and nobody can produce.
    expect(new Set(versions).size).toBe(generated.length);
    expect(versions.slice().sort((a, b) => a - b)).toEqual(
      Array.from({ length: generated.length }, (_, i) => i + 1),
    );

    // Non-vacuous when it runs, and it only runs in the arbitrated case — which
    // the shape assertion above has already established.
    for (const loser of losers) {
      expect(
        ['concurrent', 'unchanged'],
        'TWO CORRECT LOSERS, and the operator can act on either. Either the ' +
          'index arbitrated — both transactions computed the same ' +
          '`MAX(version) + 1`, one raised 23505, and the sentence says reload ' +
          '— or the second transaction serialised BEHIND the first commit, ' +
          'read the identical document it had just stored, and declined to ' +
          'write a duplicate (quick-260904-dfq). Anything else is a bug.',
      ).toContain(loser.kind);
    }
  });
});

// ── 2026-10-13, Phase 15 (15-06, D-03, D-11): THE MISSED-CALL BLOCK IS FROZEN ──
//
// The generator now composes `figures.missedCalls` beside the eleven quote
// figures, inside the same transaction. Three things only the real column can
// prove: the block survives the jsonb round trip and parses back through the
// strict schema; a second press with nothing changed still writes nothing (the
// block is part of the compared document, so a block that came back reordered
// or lossy would turn every re-press into a phantom version); and a month whose
// stored row PREDATES the block gets version N+1 with N kept and still parsing
// — the version jump research Pitfall 6 calls intended.
describe('Phase 15 (2026-10): the missed-call block is frozen beside the quote figures (D-03)', () => {
  /** Its own tenant: no calls, no quotes — the all-zero block, and its own months. */
  let tenantP15: string;

  beforeAll(async () => {
    tenantP15 = await seedTenant('Monthly Report P15');
    await seedConnection(tenantP15, {
      created_at: CONNECTED_AT,
      baseline_win_rate: '0.2500',
      baseline_quotes_issued: 40,
      baseline_window_start: '2025-12-01',
      baseline_window_end: '2026-03-01',
    });
    // From the 1st of July, so both July and August have a fee in force.
    await seedFee(tenantP15, {
      kind: 'monthly',
      amountCents: MONTHLY_FEE_CENTS,
      effectiveFrom: '2026-07-01',
    });
  });

  afterAll(async () => {
    await teardownTenants([tenantP15]);
  });

  it('freezes figures.missedCalls — the all-zero block for a client with no calls', async () => {
    const result = await generateMonthlyReport(tenantP15, { year: 2026, month: 8 }, NOW);
    expect(result.kind).toBe('generated');
    if (result.kind !== 'generated') return;

    const [row] = await forTenant(tenantP15).reports.byId(result.reportId);
    expect(row).toBeDefined();
    if (!row) return;

    // THE STRICT SCHEMA, over what came back out of jsonb.
    const figures = reportFiguresSchema.parse(row.figures);
    const missedCalls = figures.missedCalls;
    expect(missedCalls, 'A report generated after Phase 15 carries the block.').toBeDefined();
    if (!missedCalls) return;

    expect(missedCalls.byHour).toHaveLength(24);
    expect(missedCalls.byIsoWeekday).toHaveLength(7);
    expect(missedCalls.captured).toBe(0);
    expect(
      missedCalls.textBacks.medianSeconds,
      'NO SAMPLES IS NULL, NEVER 0 (D-10) — the page prints the words.',
    ).toBeNull();
    expect(missedCalls.afterHours.denominator).toBe(0);
    expect(missedCalls.afterHours.rateBp).toBeNull();

    // The eleven quote figures are still all there, untouched by the block.
    expect(figures.quotesChased).toBe(0);
    expect(figures.feesMonthlyCents).toBe(MONTHLY_FEE_CENTS);
  });

  it('a second press with nothing changed still writes nothing — the block compares equal', async () => {
    const again = await generateMonthlyReport(tenantP15, { year: 2026, month: 8 }, NOW);
    expect(
      again.kind,
      'The block came back out of jsonb comparing equal to the one that went in.',
    ).toBe('unchanged');

    const listed = await forTenant(tenantP15).reports.list();
    expect(
      listed.filter((row) => row.periodStart === '2026-08-01').map((row) => row.version),
    ).toEqual([1]);
  });

  it('a month stored BEFORE the block gets version N+1, and N is kept and still parses', async () => {
    // A pre-Phase-15 row — `figures` with ONLY the eleven quote keys — written
    // straight into the table by the admin client, in the shape of the stored
    // fixture `tests/fixtures/monthly-report-v1.json` (15-02).
    const fixture = JSON.parse(
      readFileSync('tests/fixtures/monthly-report-v1.json', 'utf8'),
    ) as Record<string, unknown>;
    const elevenKeys = fixture.figures as Record<string, unknown>;
    expect(Object.keys(elevenKeys)).toHaveLength(11);
    expect(elevenKeys).not.toHaveProperty('missedCalls');

    const { error } = await admin.from('monthly_reports').insert({
      tenant_id: tenantP15,
      period_start: '2026-07-01',
      period_end: '2026-08-01',
      timezone: 'Australia/Perth',
      version: 1,
      figures: elevenKeys,
      lines: fixture.lines,
      baseline: fixture.baseline,
      constants: fixture.constants,
      fees: fixture.fees,
    });
    if (error) throw new Error(`Seeding a pre-Phase-15 report failed: ${error.message}`);

    const result = await generateMonthlyReport(tenantP15, { year: 2026, month: 7 }, NOW);
    expect(
      result.kind,
      'THE VERSION JUMP IS THE INTENT (D-03): a document that gained a block is a ' +
        'changed document, so it is written as the next version.',
    ).toBe('generated');
    if (result.kind !== 'generated') return;
    expect(result.version).toBe(2);

    const listed = await forTenant(tenantP15).reports.list();
    const july = listed.filter((row) => row.periodStart === '2026-07-01');
    expect(
      july.map((row) => row.version),
      'VERSION 1 IS KEPT — the document the client was sent stays readable.',
    ).toEqual([2, 1]);

    const v1Summary = july.find((row) => row.version === 1);
    expect(v1Summary).toBeDefined();
    if (!v1Summary) return;

    const [v1] = await forTenant(tenantP15).reports.byId(v1Summary.id);
    const [v2] = await forTenant(tenantP15).reports.byId(result.reportId);
    expect(v1).toBeDefined();
    expect(v2).toBeDefined();
    if (!v1 || !v2) return;

    expect(
      parseReportDocument(v1).figures.missedCalls,
      'The old row parses, and has no block — so its sheet prints none.',
    ).toBeUndefined();
    expect(parseReportDocument(v2).figures.missedCalls).toBeDefined();
  });
});

describe('the printed page renders FROM the row and nothing else (D-11, T-7-21)', () => {
  /** Value imports only — `import type { … }` lines are erased and are fine. */
  function valueImportSources(path: string): string[] {
    const source = readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    return [...source.matchAll(/^import\s+([\s\S]*?)from\s+'([^']+)';$/gm)]
      .filter(([, clause]) => !/^\s*type\s/.test(clause))
      .map(([, , specifier]) => specifier);
  }

  it('imports no aggregation module — the render-from-the-row mandate as a test', () => {
    const specifiers = valueImportSources(REPORT_PAGE_SOURCE);

    // THE ABSENCES ARE THE ASSERTION. Each of these would let the page compute
    // a figure at render time, and a report that restates a number the client
    // already checked is the failure the frozen row exists to prevent.
    for (const banned of [
      '@/core/reporting/figures',
      '@/core/reporting/fees',
      '@/core/reporting/metrics',
      '@/core/reporting/generate',
    ]) {
      expect(specifiers, `${REPORT_PAGE_SOURCE} must not value-import ${banned}.`).not.toContain(
        banned,
      );
    }

    // And the ones it DOES need: the document's shape (to parse the row), the
    // sentences (built from the row) and the display formatters.
    expect(specifiers).toContain('@/core/reporting/document');
    expect(specifiers).toContain('@/core/reporting/copy');
    expect(specifiers).toContain('@/core/reporting/format');
  });

  it('freezes no customer address, phone number or message body (T-7-20, U-3)', async () => {
    const listed = await forTenant(tenantA).reports.list();
    const august = listed.find((row) => row.periodStart === '2026-08-01');
    expect(august).toBeDefined();
    if (!august) return;

    const [row] = await forTenant(tenantA).reports.byId(august.id);
    const json = JSON.stringify(row);

    // The seeds carry a real-shaped email address and ACMA fiction mobiles on
    // the ledger and inbound rows the lines were built from. Neither may reach
    // the document that leaves the building.
    expect(json, 'No email address may reach a frozen report line.').not.toContain('@');
    expect(json, 'No AU mobile may reach a frozen report line.').not.toContain('+61');
  });
});
