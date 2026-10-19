/**
 * THE PHASE 7 TRACER: the DATABASE refuses a second attribution and a rewritten
 * report — not the caller, not a convention, not a code review.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY THIS SUITE EXISTS. Migration 0033 is the phase's ONE journal entry,  │
 * │ and the journal-ordering trap makes `npm run db:migrate` exit 0 while    │
 * │ applying nothing. Types flow from the schema FILES, so every later Phase │
 * │ 7 plan would compile green, `tsc` would pass, and the first symptom of a │
 * │ silently-skipped migration would be a runtime 42P01 in the attribution   │
 * │ consumer — or, worse, no symptom at all until a client is invoiced twice │
 * │ for one recovered job.                                                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * So each guarantee is exercised for its BEHAVIOUR against the real database,
 * and the refusals matter more than the successes:
 *
 *   * `attributions.claim` returning ZERO ROWS on a second call IS the D-04
 *     never-twice guarantee. A version that returned the conflicting row, or
 *     that raised, would let a replayed `won` event bill the same job again.
 *   * The claim is TENANT-SCOPED (`quotes_tenant_job_uniq` argument), so one
 *     client's win must never consume another client's claim for a job uuid a
 *     shared ServiceM8 account handed to both.
 *   * `reports.insertVersion` writing version 2 while KEEPING version 1 IS
 *     D-11. A report row is the record of what a client was handed, and the
 *     correction story ("here is what we sent you, here is the corrected one")
 *     is unsayable if N is replaced by N+1.
 *   * `fees.list`'s ordering IS the D-13 in-force rule for the awkward case:
 *     two rows sharing an `effective_from`, where latest-inserted must win so a
 *     same-day correction supersedes the mistake without either row vanishing.
 *   * And the SOURCE assertion, because three of those guarantees are absences.
 *     An `update` on any of the three namespaces would compile, pass every
 *     behavioural test here, and quietly make the frozen document editable.
 *
 * REMOTE. It seeds and tears down against the hosted Sydney project, so it runs
 * only under `npm run test:remote`. Teardown lists all three tables explicitly
 * (tests/helpers/seed.ts) — a `quote_attributions` row left behind permanently
 * consumes the never-twice claim for that quote.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  closeDb,
  forTenant,
  type AttributionClaim,
  type MonthlyReportSummary,
} from '../src/db/repository';

import {
  admin,
  seedCadence,
  seedInbound,
  seedLedgerRow,
  seedQuotes,
  seedTenant,
  teardownTenants,
} from './helpers/seed';

const REPOSITORY_SOURCE = 'src/db/repository/for-tenant.ts';

let tenantA: string;
let tenantB: string;
let quoteId: string;
let secondQuoteId: string;
/** The three quotes the half-open period case straddles. */
let periodQuoteIds: string[];

/** A complete claim, every not-null column supplied. `evidence` stays opaque here. */
function claimFor(quote: string, overrides: Partial<AttributionClaim> = {}): AttributionClaim {
  const now = new Date();
  return {
    quoteId: quote,
    sm8JobUuid: null,
    wonEventId: -1,
    wonDetectedAt: now,
    firstTouchClaimedAt: now,
    lastTouchClaimedAt: now,
    qualifyingTouchCount: 2,
    grossCents: 250_000,
    conservativeCents: 220_000,
    valueSource: 'mirror',
    baselineRateBp: 1200,
    baselineSource: 'connect',
    baselineSample: 40,
    windowDays: 30,
    evidence: {},
    ...overrides,
  };
}

/** The five jsonb documents a frozen report carries. Shape is the generator's. */
const REPORT_DOCUMENTS = {
  figures: { grossCents: 250_000, conservativeCents: 220_000 },
  lines: [] as unknown[],
  baseline: { rateBp: 1200, source: 'connect' },
  constants: { attributionWindowDays: 30 },
  fees: { monthlyCents: 59_700 },
};

beforeAll(async () => {
  tenantA = await seedTenant('Reporting Tables A');
  tenantB = await seedTenant('Reporting Tables B');

  const quotes = await seedQuotes(tenantA, [{}, {}, {}, {}, {}]);
  quoteId = quotes[0].id;
  secondQuoteId = quotes[1].id;
  periodQuoteIds = quotes.slice(2).map((q) => q.id);
});

afterAll(async () => {
  await teardownTenants([tenantA, tenantB]);
  await closeDb();
});

describe('quote_attributions — at most once per quote, ever (D-04, RPT-01)', () => {
  it('claims once, then returns zero rows and leaves the first row untouched', async () => {
    const first = await forTenant(tenantA).attributions.claim(claimFor(quoteId));

    expect(first, 'The first claim on a fresh quote must win.').toHaveLength(1);
    const claimedId = first[0].id;

    const { data: before, error: beforeError } = await admin
      .from('quote_attributions')
      .select('id, attributed_at, gross_cents')
      .eq('id', claimedId)
      .single();
    if (beforeError) throw beforeError;

    // A SECOND claim for the same quote — the replayed `won` event, the reopen
    // and re-win, the second overlapping tick. All three arrive here.
    const second = await forTenant(tenantA).attributions.claim(
      claimFor(quoteId, { grossCents: 999_999, conservativeCents: 999_999 }),
    );

    expect(
      second,
      'ZERO ROWS IS THE ANSWER. A second claim that returned an id would let the ' +
        'consumer record a second attribution for one quote, and the client is ' +
        'then invoiced twice for one recovered job.',
    ).toEqual([]);

    const { data: after, error: afterError } = await admin
      .from('quote_attributions')
      .select('id, attributed_at, gross_cents')
      .eq('id', claimedId)
      .single();
    if (afterError) throw afterError;

    expect(
      after,
      'DO NOTHING means DO NOTHING: the refused claim carried a different ' +
        'gross_cents, and if any of it had landed the stored figure would have ' +
        'moved. An upsert here would silently restate a reported dollar amount.',
    ).toEqual(before);

    const { count, error: countError } = await admin
      .from('quote_attributions')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantA)
      .eq('quote_id', quoteId);
    if (countError) throw countError;

    expect(count, 'Exactly one attribution row may exist for one quote.').toBe(1);
  });

  it('leaves the same client free to claim a DIFFERENT quote', async () => {
    // The obvious over-correction, ruled out: a unique index on `tenant_id`
    // alone would also make the second claim above return zero rows, and would
    // silently cap every client at one recovered job for all time.
    const other = await forTenant(tenantA).attributions.claim(claimFor(secondQuoteId));

    expect(other, 'One attribution per QUOTE, not one per client.').toHaveLength(1);
  });

  it('is tenant-scoped: another client may still claim the same quote id', async () => {
    // The `quotes_tenant_job_uniq` argument, one table over: two clients could
    // be handed the same job uuid by a shared ServiceM8 account, and a globally
    // unique claim would silently deny the second client their own recovered
    // job — a missing line on an invoice, which nobody notices.
    const other = await forTenant(tenantB).attributions.claim(claimFor(quoteId));

    expect(
      other,
      'A GLOBAL unique index would return [] here and one client would lose a ' +
        'recovered job with no error anywhere.',
    ).toHaveLength(1);
  });
});

describe('monthly_reports — frozen and versioned (D-11, RPT-02)', () => {
  it('writes version 1 then version 2 for one period and keeps both', async () => {
    const period = { periodStart: '2026-08-01', periodEnd: '2026-09-01' };

    const first = await forTenant(tenantA).reports.insertVersion({
      ...period,
      timezone: 'Australia/Perth',
      ...REPORT_DOCUMENTS,
    });
    const second = await forTenant(tenantA).reports.insertVersion({
      ...period,
      timezone: 'Australia/Perth',
      ...REPORT_DOCUMENTS,
      figures: { grossCents: 300_000, conservativeCents: 260_000 },
    });

    expect(
      [first[0].version, second[0].version],
      'The version is computed INSIDE the insert, so a re-generate is N+1.',
    ).toEqual([1, 2]);

    const { data, error } = await admin
      .from('monthly_reports')
      .select('id, version, figures')
      .eq('tenant_id', tenantA)
      .eq('period_start', '2026-08-01')
      .order('version', { ascending: true });
    if (error) throw error;

    expect(
      (data ?? []).map((r) => r.version),
      'VERSION 1 MUST SURVIVE. It is the document the client was already sent; ' +
        'a re-generate that replaced it would make the PDF stapled to an invoice ' +
        'unreproducible, which is the whole of D-11.',
    ).toEqual([1, 2]);

    expect(
      (data ?? [])[0].figures,
      'And version 1 must still say what it said — the corrected figures belong ' +
        'to version 2 alone.',
    ).toEqual(REPORT_DOCUMENTS.figures);
  });

  it('keeps versions independent per period_start', async () => {
    const other = await forTenant(tenantA).reports.insertVersion({
      periodStart: '2026-07-01',
      periodEnd: '2026-08-01',
      timezone: 'Australia/Perth',
      ...REPORT_DOCUMENTS,
    });

    expect(
      other[0].version,
      'The version sequence is per (tenant, period_start). July starting at 2 ' +
        'because August exists would mislabel every report a client receives.',
    ).toBe(1);
  });
});

describe('tenant_fees — append-only, latest-inserted-wins on a tie (D-13)', () => {
  it('appends two rows for one effective_from and orders the later one first', async () => {
    // The same-day correction: an operator enters $597, notices it should have
    // been $997 from the same date, and enters the second row. Nothing is
    // overwritten, and the in-force read must resolve to the correction.
    await forTenant(tenantA).fees.append({
      kind: 'monthly',
      amountCents: 59_700,
      effectiveFrom: '2026-08-01',
      note: 'first entry',
    });
    const corrected = await forTenant(tenantA).fees.append({
      kind: 'monthly',
      amountCents: 99_700,
      effectiveFrom: '2026-08-01',
      note: 'same-day correction',
    });

    expect(corrected).toHaveLength(1);

    const { data, error } = await admin
      .from('tenant_fees')
      .select('id, amount_cents, note, created_at')
      .eq('tenant_id', tenantA)
      .order('effective_from', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw error;

    expect(
      (data ?? []).length,
      'BOTH rows must remain — an append-only table that loses the superseded ' +
        'row cannot answer "what were we charging them in August".',
    ).toBe(2);

    expect(
      (data ?? [])[0].id,
      'LATEST-INSERTED WINS on an effective_from tie. Ordering on ' +
        'effective_from alone leaves the tie to the planner, which means the ' +
        'mistake could win and a client could be billed the wrong retainer.',
    ).toBe(corrected[0].id);
  });

  it('refuses a negative amount at the database (0033 CHECK)', async () => {
    // A negative fee is not a credit note; it is a typo that SHRINKS the
    // denominator of the 3x guarantee — i.e. inflates the headline claim in a
    // document sent to a paying client.
    const { error } = await admin.from('tenant_fees').insert({
      tenant_id: tenantA,
      kind: 'monthly',
      amount_cents: -1,
      effective_from: '2026-08-01',
    });

    expect(error?.message ?? '', 'tenant_fees_amount_nonnegative must reject it.').toMatch(
      /tenant_fees_amount_nonnegative|violates check constraint/i,
    );
  });

  it('refuses an unknown fee kind at the database (0033 CHECK)', async () => {
    const { error } = await admin.from('tenant_fees').insert({
      tenant_id: tenantA,
      kind: 'montly',
      amount_cents: 59_700,
      effective_from: '2026-08-01',
    });

    expect(error?.message ?? '', 'tenant_fees_kind_known must reject it.').toMatch(
      /tenant_fees_kind_known|violates check constraint/i,
    );
  });
});

describe('the keyed reads the later plans run on', () => {
  /**
   * PERTH AUGUST 2026 IS `[2026-07-31T16:00Z, 2026-08-31T16:00Z)`.
   *
   * Three rows straddle it by a single millisecond on the lower bound and land
   * exactly ON the upper bound, because those are the two ways a month boundary
   * goes wrong and neither is visible in a test that seeds mid-month:
   *
   *   * a CLOSED upper bound puts the 31-Aug-16:00Z win into August AND into
   *     September, so the same recovered job appears on two invoices; and
   *   * an upper bound compared in UTC rather than in the tenant's zone moves
   *     every win between 16:00Z and midnight into the wrong month — which
   *     Perth's fixed +08:00 will hide right up until an Adelaide client
   *     onboards and DST starts moving the offset.
   */
  const AUGUST_START = new Date('2026-07-31T16:00:00.000Z');
  const AUGUST_END = new Date('2026-08-31T16:00:00.000Z');

  it('listForPeriod is half-open at BOTH ends (D-10)', async () => {
    const [beforeQuote, insideQuote, afterQuote] = periodQuoteIds;

    await forTenant(tenantA).attributions.claim(
      claimFor(beforeQuote, { wonDetectedAt: new Date('2026-07-31T15:59:59.999Z') }),
    );
    await forTenant(tenantA).attributions.claim(
      claimFor(insideQuote, { wonDetectedAt: AUGUST_START }),
    );
    await forTenant(tenantA).attributions.claim(
      claimFor(afterQuote, { wonDetectedAt: AUGUST_END }),
    );

    const august = await forTenant(tenantA).attributions.listForPeriod(
      AUGUST_START,
      AUGUST_END,
    );

    expect(
      august.map((row) => row.quoteId),
      'Exactly the middle row. The one a millisecond early belongs to July; the ' +
        'one exactly on the upper bound is the FIRST instant of September, and ' +
        'counting it here would bill the client for it twice.',
    ).toEqual([insideQuote]);
  });

  it('byQuote returns the one row, or none', async () => {
    const found = await forTenant(tenantA).attributions.byQuote(quoteId);
    expect(found).toHaveLength(1);
    expect(found[0].quoteId).toBe(quoteId);

    const missing = await forTenant(tenantA).attributions.byQuote(randomUUID());
    expect(missing, 'Not attributed is `[]`, never a row of zeroes.').toEqual([]);
  });

  it('reports.list is newest-first and carries no frozen document', async () => {
    const summaries = await forTenant(tenantA).reports.list();

    expect(
      summaries.map((r) => [r.periodStart, r.version]),
      'Newest month first, newest version first within a month — and EVERY ' +
        'version stays visible (D-11).',
    ).toEqual([
      ['2026-08-01', 2],
      ['2026-08-01', 1],
      ['2026-07-01', 1],
    ]);

    // A type-level assertion and a runtime one, because either alone is weak:
    // `satisfies` catches a widened select list at compile time, and the runtime
    // check catches a `select()` that returns every column while the type still
    // claims six.
    const [first] = summaries satisfies MonthlyReportSummary[];

    for (const document of ['figures', 'lines', 'baseline', 'constants', 'fees']) {
      expect(
        first,
        `reports.list must not pull ${document}. A list page that fetched every ` +
          "client's whole reporting history to draw a table of links moves the " +
          'largest rows in the schema over the wire for nothing.',
      ).not.toHaveProperty(document);
    }
  });

  it('reports.byId returns the full row, and nothing across tenants (T-7-04)', async () => {
    const [summary] = await forTenant(tenantA).reports.list();

    const full = await forTenant(tenantA).reports.byId(summary.id);
    expect(full).toHaveLength(1);
    expect(full[0].figures, 'byId is the read that DOES carry the documents.').toEqual({
      grossCents: 300_000,
      conservativeCents: 260_000,
    });

    const crossTenant = await forTenant(tenantB).reports.byId(summary.id);

    expect(
      crossTenant,
      'A report id is a uuid in a URL. `byId` pins tenant_id from the closure, so ' +
        'another client sees the SAME answer they would get for an id that does ' +
        'not exist — denial and absence stay indistinguishable.',
    ).toEqual([]);
  });

  it('fees.list resolves a same-day correction through the repository', async () => {
    // Already proven through `admin` above; asserted again through the read the
    // report actually calls, because `feesInForce` consumes THIS order.
    const fees = await forTenant(tenantA).fees.list();

    expect(fees.map((f) => f.amountCents)).toEqual([99_700, 59_700]);
    expect(
      fees[0].note,
      'Latest-inserted wins on an effective_from tie (D-13).',
    ).toBe('same-day correction');
  });

  it('seeds ledger and inbound evidence with fiction addresses and no bodies', async () => {
    // The seeders 07-03 / 07-04 / 07-05 consume. Round-tripped here so a broken
    // default surfaces in the plan that wrote it rather than three plans later.
    const cadenceId = await seedCadence(tenantA, quoteId);
    const claimedAt = '2026-08-15T02:00:00.000Z';

    const ledgerId = await seedLedgerRow(tenantA, {
      cadenceId,
      quoteId,
      touchNumber: 1,
      claimedAt,
    });
    const inboundId = await seedInbound(tenantA, {
      cadenceId,
      quoteId,
      receivedAt: '2026-08-16T02:00:00.000Z',
    });

    const { data: ledger, error: ledgerError } = await admin
      .from('send_ledger')
      .select('sender, outcome, delivery_status, to_address, claimed_at')
      .eq('id', ledgerId)
      .single();
    if (ledgerError) throw ledgerError;

    expect(
      { sender: ledger.sender, outcome: ledger.outcome, delivery: ledger.delivery_status },
      'The default must be a QUALIFYING touch: a real sender, `sent`, and a ' +
        'pending receipt (NULL), which D-02 counts. A `stub` default would make ' +
        'every attribution suite silently assert nothing.',
    ).toEqual({ sender: 'clicksend', outcome: 'sent', delivery: null });

    expect(ledger.to_address, 'ACMA fiction range only — this is production.').toMatch(
      /^\+61491570\d{3}$/,
    );
    expect(new Date(ledger.claimed_at).toISOString()).toBe(claimedAt);

    const { data: inbound, error: inboundError } = await admin
      .from('inbound_messages')
      .select('attribution, body, from_address, normalized_from, is_stop')
      .eq('id', inboundId)
      .single();
    if (inboundError) throw inboundError;

    expect(inbound.attribution).toBe('threaded');
    expect(
      inbound.body,
      "No customer words on the production inbound table. '' is a first-class " +
        'value here — a provider can deliver an empty-bodied SMS.',
    ).toBe('');
    expect(inbound.from_address).toMatch(/^\+61491570\d{3}$/);
    expect(inbound.normalized_from).toBe(inbound.from_address);
    expect(inbound.is_stop).toBe(false);
  });
});

describe('the three namespaces expose no write-back surface (RPT-01, T-7-03)', () => {
  /**
   * THREE OF THIS PHASE'S GUARANTEES ARE ABSENCES, and an absence is exactly
   * what a behavioural test cannot see. Adding `attributions.update` would break
   * nothing above, compile cleanly, and make a reported dollar figure editable.
   *
   * So the interface TEXT is the assertion. The slice runs from the namespace's
   * opening line to the next `};`, and only member declarations at the
   * interface's indent are collected — doc comments (which say UPDATE and DELETE
   * out loud, on purpose) are not members and cannot trip it.
   */
  const source = readFileSync(REPOSITORY_SOURCE, 'utf-8');

  function interfaceMembers(namespace: string): string[] {
    const open = source.indexOf(`\n  ${namespace}: {\n`);
    expect(
      open,
      `${namespace} is not a namespace on TenantScopedRepository — has it been renamed?`,
    ).toBeGreaterThan(-1);

    const close = source.indexOf('\n  };\n', open);
    expect(close, `${namespace}'s interface block is unterminated.`).toBeGreaterThan(open);

    const body = source.slice(open, close);
    return [...body.matchAll(/^ {4}(\w+)[<(]/gm)].map((m) => m[1]);
  }

  it.each([
    ['attributions', 'claim', 'an attribution is written once and stands'],
    ['reports', 'insertVersion', 'a correction is a new VERSION, never an edit'],
    ['fees', 'append', 'a price change is a new ROW with a later effective_from'],
  ])('%s exposes %s and no mutating member', (namespace, required, why) => {
    const members = interfaceMembers(namespace);

    expect(members, `${namespace}.${required} must exist.`).toContain(required);

    const mutators = members.filter((m) => /^(update|delete|patch|set|upsert)/i.test(m));

    expect(
      mutators,
      `forTenant().${namespace} must expose no mutating member — ${why}. ` +
        'The absent method IS the rule (the suppression / attestations posture), ' +
        'and migration 0033 enforces the same thing for the console role.',
    ).toEqual([]);
  });
});
