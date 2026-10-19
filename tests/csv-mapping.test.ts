/**
 * The CSV fallback's mapping heuristics (D-12, AUD-01, RESEARCH Pattern 7).
 *
 * ── WHY THIS SUITE READS A REAL EXPORT ──────────────────────────────────────
 *
 * ServiceM8's Job List CSV comes from the Advanced Reporting Pack add-on and its
 * column layout is not publicly documented (RESEARCH A5). A synthetic fixture
 * written from imagination would encode this file's own guesses and then confirm
 * them — the heuristics would pass a test about themselves. `job-list-export.csv`
 * is a sanitized export pulled from the trial account, so every assertion below
 * about which header wins is an assertion about the format the operator will
 * actually be handed in a sales meeting.
 *
 * The single most valuable case in the file is the negative one: that
 * `quote_date` does NOT bind to the export's generic `Date` column. That export
 * carries EIGHT date-shaped columns (Date, Invoice Date, Quote Date, Work Order
 * Date, Unsuccessful Date, Payment Received Date, Invoice Sent Stamp, Completion
 * Date) and a substring heuristic would happily take the first. Getting that
 * wrong does not throw — it silently ages every quote in the audit and moves the
 * leakage figure, on a document handed to a stranger as evidence.
 */
import { readFileSync } from 'node:fs';

import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';

import { computeAuditFigures, computeBaseline, type AuditLine } from '@/core/audit/aggregate';
import { isFollowedUp } from '@/core/audit/followup';
import { SM8_TIMESTAMP_ZONE, sm8ToUtc } from '@/core/servicem8/normalize';
import {
  CANONICAL_FIELDS,
  MAX_CSV_BYTES,
  MAX_CSV_ROWS,
  // Derived from CANONICAL_FIELDS rather than hand-written here, so adding a
  // field cannot leave this suite asserting against a stale key list.
  blankMapping,
  inferMapping,
  missingRequiredFields,
  validateRows,
  type CsvMapping,
  type CsvRow,
} from '@/core/audit/csv-mapping';

const FIXTURE = readFileSync(
  new URL('./fixtures/sm8/job-list-export.csv', import.meta.url),
  'utf8',
);

const parsed = Papa.parse<CsvRow>(FIXTURE, { header: true, skipEmptyLines: true });
const fixtureHeaders = (parsed.meta.fields ?? []).filter((h) => h.trim() !== '');
const fixtureRows = parsed.data;

function mappingOf(status: string, quoteDate: string, value: string): CsvMapping {
  return { ...blankMapping(), status, quote_date: quoteDate, value };
}

describe('the real ServiceM8 Job List export parses', () => {
  it('yields a header row and data rows', () => {
    expect(parsed.errors.filter((e) => e.type === 'Delimiter')).toHaveLength(0);
    expect(fixtureHeaders.length).toBeGreaterThan(10);
    expect(fixtureRows.length).toBeGreaterThan(0);
  });

  it('carries more than one date-shaped column — the ambiguity the heuristic must survive', () => {
    const dateish = fixtureHeaders.filter((h) => /date|stamp/i.test(h));
    expect(dateish.length).toBeGreaterThan(3);
    expect(fixtureHeaders).toContain('Date');
    expect(fixtureHeaders).toContain('Quote Date');
  });
});

describe('CANONICAL_FIELDS', () => {
  it('declares exactly the ten audit fields', () => {
    // The last three are the status-change stamps added for WR-05, so the CSV
    // path can apply the API path's 72-hour grace rule instead of a timing-free
    // `status !== 'Quote'`. Exhaustive on purpose: adding a field means editing
    // this line, and a field the operator is never offered is a field that is
    // silently never read.
    expect(CANONICAL_FIELDS.map((f) => f.key)).toEqual([
      'status',
      'quote_date',
      'value',
      'description',
      'contact_name',
      'contact_phone',
      'contact_email',
      'work_order_date',
      'unsuccessful_date',
      'completion_date',
    ]);
  });

  it('marks status, quote date and value required and the rest optional', () => {
    const required = CANONICAL_FIELDS.filter((f) => f.required).map((f) => f.key);
    expect(required).toEqual(['status', 'quote_date', 'value']);
  });

  it('gives every field operator-facing prose for the named-column error', () => {
    for (const field of CANONICAL_FIELDS) {
      expect(field.label.length).toBeGreaterThan(2);
      expect(field.label).not.toMatch(/_/);
    }
  });
});

describe('inferMapping over the real export', () => {
  const mapping = inferMapping(fixtureHeaders);

  it('maps the three required fields automatically', () => {
    expect(mapping.status).toBe('Job Status');
    expect(mapping.quote_date).toBe('Quote Date');
    expect(mapping.value).toBe('Total Invoice Amount');
  });

  it('never binds the quote date to the generic Date column', () => {
    expect(mapping.quote_date).not.toBe('Date');
    expect(mapping.quote_date).not.toBe('Invoice Date');
    expect(mapping.quote_date).not.toBe('Completion Date');
  });

  it('prefers the mobile number over the blank landline column', () => {
    expect(mapping.contact_phone).toBe('Job Contact Mobile Number');
  });

  it('maps the optional description and email columns', () => {
    expect(mapping.description).toBe('Description of work');
    expect(mapping.contact_email).toBe('Job Email Address');
  });

  it('leaves nothing required unmapped', () => {
    expect(missingRequiredFields(mapping)).toHaveLength(0);
  });

  it('never assigns one header to two fields', () => {
    const claimed = Object.values(mapping).filter((h): h is string => h !== null);
    expect(new Set(claimed).size).toBe(claimed.length);
  });
});

describe('inferMapping refuses to guess', () => {
  it('leaves value unmapped when the export carries no money column', () => {
    const mapping = inferMapping(['Job Status', 'Quote Date', 'Description of work']);

    expect(mapping.status).toBe('Job Status');
    expect(mapping.quote_date).toBe('Quote Date');
    // The row it would otherwise reach for. A wrong money column is not a
    // degraded audit, it is a fabricated dollar figure.
    expect(mapping.value).toBeNull();
    expect(missingRequiredFields(mapping).map((f) => f.key)).toEqual(['value']);
  });

  it('leaves the quote date unmapped when only unrelated date columns exist', () => {
    const mapping = inferMapping(['Job Status', 'Invoice Date', 'Completion Date', 'Total']);

    expect(mapping.quote_date).toBeNull();
    expect(missingRequiredFields(mapping).map((f) => f.key)).toEqual(['quote_date']);
  });

  it('returns every field null for an empty header row', () => {
    const mapping = inferMapping([]);
    expect(Object.values(mapping).every((v) => v === null)).toBe(true);
    expect(missingRequiredFields(mapping)).toHaveLength(3);
  });

  it('is insensitive to case, spacing and punctuation in headers', () => {
    const mapping = inferMapping(['  job_status ', 'QUOTE-DATE', 'Quote Value']);

    expect(mapping.status).toBe('  job_status ');
    expect(mapping.quote_date).toBe('QUOTE-DATE');
    expect(mapping.value).toBe('Quote Value');
  });
});

describe('validateRows', () => {
  const mapping = mappingOf('Job Status', 'Quote Date', 'Total Invoice Amount');

  function row(over: Partial<Record<string, string>> = {}): CsvRow {
    return {
      'Job Status': 'Quote',
      'Quote Date': '2026-08-20 09:15:00',
      'Total Invoice Amount': '4850.0000',
      ...over,
    };
  }

  it('normalizes a good row into the shared AuditLine shape', () => {
    const { valid, skipped } = validateRows([row()], mapping);

    expect(skipped).toHaveLength(0);
    expect(valid).toHaveLength(1);
    expect(valid[0].status).toBe('Quote');
    // Integer cents, via the same string math the API path uses.
    expect(valid[0].valueCents).toBe(485_000);
    expect(valid[0].quoteDateUtc?.toISOString()).toBe('2026-08-20T09:15:00.000Z');
    expect(valid[0].quoteDateRaw).toBe('2026-08-20 09:15:00');
  });

  it('maps the export status vocabulary onto the four canonical statuses', () => {
    const rows = [
      row({ 'Job Status': 'quote' }),
      row({ 'Job Status': 'Work Order' }),
      row({ 'Job Status': 'Completed' }),
      row({ 'Job Status': 'Unsuccessful' }),
    ];

    const { valid, skipped } = validateRows(rows, mapping);

    expect(skipped).toHaveLength(0);
    expect(valid.map((v) => v.status)).toEqual([
      'Quote',
      'Work Order',
      'Completed',
      'Unsuccessful',
    ]);
  });

  it('skips an unknown status with a reason rather than inventing one', () => {
    const { valid, skipped } = validateRows([row({ 'Job Status': 'Awaiting Parts' })], mapping);

    expect(valid).toHaveLength(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].index).toBe(0);
    expect(skipped[0].reason).toMatch(/status/i);
  });

  it('skips a row whose quote date cannot be parsed', () => {
    const { valid, skipped } = validateRows([row({ 'Quote Date': '31/13/2026' })], mapping);

    expect(valid).toHaveLength(0);
    expect(skipped[0].reason).toMatch(/date/i);
  });

  it('skips a row with a negative money value', () => {
    const { valid, skipped } = validateRows([row({ 'Total Invoice Amount': '-120.00' })], mapping);

    expect(valid).toHaveLength(0);
    expect(skipped[0].reason).toMatch(/value/i);
  });

  it('skips a row whose money value is not a number', () => {
    const { valid, skipped } = validateRows(
      [row({ 'Total Invoice Amount': '$4,850' })],
      mapping,
    );

    expect(valid).toHaveLength(0);
    expect(skipped[0].reason).toMatch(/value/i);
  });

  it('keeps a row with a BLANK value as null cents — absent is not invalid', () => {
    const { valid, skipped } = validateRows([row({ 'Total Invoice Amount': '' })], mapping);

    expect(skipped).toHaveLength(0);
    expect(valid[0].valueCents).toBeNull();
  });

  it('keeps a ServiceM8 zero-date as a null quote date rather than a skip', () => {
    const { valid, skipped } = validateRows(
      [row({ 'Quote Date': '0000-00-00 00:00:00' })],
      mapping,
    );

    expect(skipped).toHaveLength(0);
    expect(valid[0].quoteDateUtc).toBeNull();
  });

  it('reports the index of every skipped row and keeps the survivors', () => {
    const rows = [row(), row({ 'Job Status': 'Awaiting Parts' }), row(), row({ 'Quote Date': 'x' })];

    const { valid, skipped } = validateRows(rows, mapping);

    expect(valid).toHaveLength(2);
    expect(skipped.map((s) => s.index)).toEqual([1, 3]);
  });

  it('falls back to the status alone when no stamp column is mapped (D-10)', () => {
    const rows = [
      row({ 'Job Status': 'Quote' }),
      row({ 'Job Status': 'Work Order' }),
      row({ 'Job Status': 'Completed' }),
      row({ 'Job Status': 'Unsuccessful' }),
    ];

    const { valid } = validateRows(rows, mapping);

    // `mapping` maps status, quote_date and value only. With no timing evidence
    // there is no timing test to apply, so the movement test stands — applying
    // `isFollowedUp` to an empty signal list would mark EVERY row a leak, which
    // is the wrongly-claimed-leak error that discredits the document.
    expect(valid.map((v) => v.followedUp)).toEqual([false, true, true, true]);
  });

  it('reads optional fields only when they are mapped', () => {
    const withContacts: CsvMapping = {
      ...mapping,
      description: 'Description of work',
      contact_name: 'Company',
      contact_email: 'Job Email Address',
    };

    const source = row({
      'Description of work': 'Install split system',
      Company: 'Sarah Dampier',
      'Job Email Address': 'sarah@example.com',
    });

    const bare = validateRows([source], mapping).valid[0];
    expect(bare.description).toBeNull();
    expect(bare.contactName).toBeNull();

    const full = validateRows([source], withContacts).valid[0];
    expect(full.description).toBe('Install split system');
    expect(full.contactName).toBe('Sarah Dampier');
    expect(full.contactEmail).toBe('sarah@example.com');
    // Never mapped, so never read — even though the column exists in the row.
    expect(full.contactPhone).toBeNull();
  });

  it('trims whitespace and turns empty strings into nulls, never into ""', () => {
    const withDescription: CsvMapping = { ...mapping, description: 'Description of work' };
    const { valid } = validateRows([row({ 'Description of work': '   ' })], withDescription);

    expect(valid[0].description).toBeNull();
  });
});

/**
 * WR-05: the CSV path and the API path apply the SAME follow-up rule.
 *
 * They used to disagree on ordinary cases. The API path required a signal at or
 * after quote + 72h; the CSV path asked only whether the status had moved. So a
 * quote won two hours after it was issued read as CHASED from a CSV and as a
 * LEAK through the API, and a quote whose status changed on day one and never
 * again did too.
 *
 * That matters because a prospect who converts from a CSV audit then gets an
 * API-derived baseline at connect — `fetch-history.ts` calls this out as the
 * scenario where "the first thing a converted client sees is a number that
 * contradicts the document that sold them". The disclosed CSV degradation
 * covered the difference in EVIDENCE; it never disclosed a different RULE.
 */
describe('follow-up parity between the CSV and API paths (WR-05)', () => {
  const QUOTE_AT = '2026-06-01 09:00:00';
  const quoteDateUtc = sm8ToUtc(QUOTE_AT, SM8_TIMESTAMP_ZONE)!;

  const withStamps: CsvMapping = {
    ...blankMapping(),
    status: 'Job Status',
    quote_date: 'Quote Date',
    value: 'Total Invoice Amount',
    work_order_date: 'Work Order Date',
    unsuccessful_date: 'Unsuccessful Date',
    completion_date: 'Completion Date',
  };

  function rowWith(overrides: Record<string, string>): CsvRow {
    return {
      'Job Status': 'Work Order',
      'Quote Date': QUOTE_AT,
      'Total Invoice Amount': '1000.0000',
      'Work Order Date': '0000-00-00 00:00:00',
      'Unsuccessful Date': '0000-00-00 00:00:00',
      'Completion Date': '0000-00-00 00:00:00',
      ...overrides,
    };
  }

  /** What the API path would conclude from the same instants. */
  const apiVerdict = (...signals: (string | null)[]) =>
    isFollowedUp(
      quoteDateUtc,
      signals.map((s) => (s === null ? null : sm8ToUtc(s, SM8_TIMESTAMP_ZONE))),
    );

  it('a quote won two hours later is a leak on BOTH paths', () => {
    // The headline disagreement. CSV said `true` (status moved), API said
    // `false` (nothing at or after the deadline).
    const wonAt = '2026-06-01 11:00:00';
    const { valid } = validateRows([rowWith({ 'Work Order Date': wonAt })], withStamps);

    expect(valid[0].followedUp).toBe(false);
    expect(valid[0].followedUp).toBe(apiVerdict(wonAt));
  });

  it('a quote won three weeks later is followed up on BOTH paths', () => {
    const wonAt = '2026-06-22 11:00:00';
    const { valid } = validateRows([rowWith({ 'Work Order Date': wonAt })], withStamps);

    expect(valid[0].followedUp).toBe(true);
    expect(valid[0].followedUp).toBe(apiVerdict(wonAt));
  });

  it('honours the inclusive boundary at exactly quote + 72h', () => {
    // `isFollowedUp` resolves the boundary toward "they followed up", and the
    // CSV path must resolve it the same way rather than one second differently.
    const atDeadline = '2026-06-04 09:00:00';
    const justBefore = '2026-06-04 08:59:59';

    expect(validateRows([rowWith({ 'Work Order Date': atDeadline })], withStamps).valid[0]
      .followedUp).toBe(true);
    expect(validateRows([rowWith({ 'Work Order Date': justBefore })], withStamps).valid[0]
      .followedUp).toBe(false);
  });

  it('reads the unsuccessful stamp, not just the work-order one', () => {
    const lostAt = '2026-06-30 09:00:00';
    const { valid } = validateRows(
      [rowWith({ 'Job Status': 'Unsuccessful', 'Unsuccessful Date': lostAt })],
      withStamps,
    );

    expect(valid[0].followedUp).toBe(true);
    expect(valid[0].followedUp).toBe(apiVerdict(null, lostAt));
  });

  it('reads the completion stamp too', () => {
    const doneAt = '2026-06-30 09:00:00';
    const { valid } = validateRows(
      [rowWith({ 'Job Status': 'Completed', 'Completion Date': doneAt })],
      withStamps,
    );

    expect(valid[0].followedUp).toBe(true);
  });

  it('takes ANY qualifying stamp, matching the API `some` semantics', () => {
    // Won early (does not qualify) but completed late (does). The API path uses
    // `signals.some(...)`, so one qualifying signal is enough on both.
    const { valid } = validateRows(
      [
        rowWith({
          'Job Status': 'Completed',
          'Work Order Date': '2026-06-01 10:00:00',
          'Completion Date': '2026-06-30 09:00:00',
        }),
      ],
      withStamps,
    );

    expect(valid[0].followedUp).toBe(true);
  });

  it('a still-open quote with no stamps is a leak, as before', () => {
    const { valid } = validateRows([rowWith({ 'Job Status': 'Quote' })], withStamps);

    expect(valid[0].followedUp).toBe(false);
  });

  it('zero-dated stamps are treated as absent, not as the epoch', () => {
    // A ServiceM8 zero-date is "this never happened". Read as a real instant it
    // would sort before every deadline and silently mean "not followed up" for
    // the right answer by the wrong route -- and worse, a row whose ONLY stamps
    // are zero-dates must fall back to the movement test rather than being
    // judged against evidence that does not exist.
    const { valid } = validateRows([rowWith({ 'Job Status': 'Work Order' })], withStamps);

    expect(valid[0].followedUp).toBe(true);
  });

  it('infers the three stamp columns from the real export headers', () => {
    const inferred = inferMapping(fixtureHeaders);

    expect(inferred.work_order_date).toBe('Work Order Date');
    expect(inferred.unsuccessful_date).toBe('Unsuccessful Date');
    expect(inferred.completion_date).toBe('Completion Date');
  });

  it('does not bind Invoice Sent Stamp to any stamp field', () => {
    // An invoicing event is not a status change on the quote, and the API path
    // does not count it either — binding it would recreate the divergence.
    const inferred = inferMapping(fixtureHeaders);

    expect(Object.values(inferred)).not.toContain('Invoice Sent Stamp');
  });

  it('still does not steal Quote Date for a stamp field', () => {
    const inferred = inferMapping(fixtureHeaders);

    expect(inferred.quote_date).toBe('Quote Date');
  });

});

describe('the fixture, end to end', () => {
  const mapping = inferMapping(fixtureHeaders);
  const { valid, skipped } = validateRows(fixtureRows, mapping);

  it('validates every row of the real export', () => {
    expect(skipped).toHaveLength(0);
    expect(valid).toHaveLength(fixtureRows.length);
  });

  it('produces figures computeAuditFigures accepts', () => {
    const lines: AuditLine[] = valid.map((v) => ({
      status: v.status,
      quoteDateUtc: v.quoteDateUtc,
      valueCents: v.valueCents,
      followedUp: v.followedUp,
    }));

    // A fixed clock well past every quote in the export, so the grace window is
    // spent and the arithmetic is deterministic.
    const figures = computeAuditFigures(lines, new Date('2026-12-01T00:00:00Z'));

    expect(figures.quotesIssued).toBe(valid.length);
    expect(figures.totalValueCents).toBeGreaterThan(0);
    expect(Number.isInteger(figures.totalValueCents)).toBe(true);
    expect(Number.isInteger(figures.recoverableEstimateCents)).toBe(true);
    expect(figures.recoverableEstimateCents).toBeLessThan(figures.neverFollowedUpValueCents);

    // ── WHY THIS IS THE WHOLE BOOK, AND WHY THAT IS CORRECT HERE (WR-05) ────
    //
    // This assertion used to read "the two open quotes are the whole of the
    // leak", because the CSV path computed followedUp as `status !== 'Quote'`
    // with no timing test. It now applies the SAME 72-hour grace rule the API
    // path applies, and in THIS FIXTURE every status change lands seconds after
    // its quote — the account was seeded in one burst, so `Work Order Date` is
    // one second after `Quote Date` on the first row and roughly ninety seconds
    // after on the third.
    //
    // Nothing in the export is therefore evidence of a follow-up under D-10, and
    // with the clock pushed past every grace window the whole book reads as
    // leaked. That is what the API path computes for this same account and this
    // same instant, which is the agreement WR-05 is about. It is an artefact of
    // a synthetic fixture rather than a claim about real trade data, where a
    // quote won three weeks later has a stamp well past its deadline.
    const wholeBook = lines.reduce((sum, l) => sum + (l.valueCents ?? 0), 0);
    expect(figures.neverFollowedUpValueCents).toBe(wholeBook);
  });

  it('produces a baseline computeBaseline accepts', () => {
    const lines: AuditLine[] = valid.map((v) => ({
      status: v.status,
      quoteDateUtc: v.quoteDateUtc,
      valueCents: v.valueCents,
      followedUp: v.followedUp,
    }));

    const baseline = computeBaseline(lines);

    expect(baseline.quotesIssued).toBe(valid.length);
    expect(baseline.winRate).toMatch(/^\d\.\d{4}$/);
    expect(baseline.quotesWon).toBeGreaterThan(0);
  });
});

describe('upload caps (T-2-06)', () => {
  it('declares both caps as named constants', () => {
    // 4 MiB since 09-03: the same number the public audit form promises.
    expect(MAX_CSV_BYTES).toBe(4 * 1024 * 1024);
    expect(MAX_CSV_ROWS).toBe(5000);
  });
});
