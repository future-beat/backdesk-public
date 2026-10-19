/**
 * THE DESIGN-PARTNER CSV WRITER (Phase 15, RPT-05 / D-04, D-10).
 *
 * PURE + a source read. One writer, a byte-pinned header, and a structural pin
 * that makes D-04's "no phone numbers, no message bodies, no caller details"
 * a property of the code rather than an item on a review checklist: the
 * header has no such column, and the writer's code (comments stripped) names
 * no such field. The repository read that feeds it gets the same pin in 15-03.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { ReportMissedCallsDocument } from '@/core/reporting/document';
import {
  PARTNER_CSV_HEADER,
  partnerCsv,
  partnerCsvRows,
  type PartnerCsvInput,
} from '@/core/reporting/partner-csv';

const PERSONAL = /caller|mobile|e164|from_address|to_address|body|contact_/i;
const CRLF = '\r\n';
const HEADER_LINE =
  'client,month,missed_calls,after_hours_calls,withheld_calls,text_backs_sent,' +
  'text_backs_delivered,text_back_median_seconds,text_back_p90_seconds,replies_on_delivered,' +
  'leads_opened,jobs_created,jobs_won,booked_by_tradie';

function block(overrides: Partial<ReportMissedCallsDocument> = {}): ReportMissedCallsDocument {
  return {
    captured: 12,
    withheld: 2,
    byHour: Array.from({ length: 24 }, () => 0),
    byIsoWeekday: Array.from({ length: 7 }, () => 0),
    afterHoursByIsoWeekday: Array.from({ length: 7 }, () => 0),
    afterHours: { numerator: 3, denominator: 12, rateBp: 2500 },
    textBacks: { sent: 9, delivered: 8, medianSeconds: 41, p90Seconds: 75 },
    replyRate: { numerator: 2, denominator: 8, rateBp: 2500 },
    funnel: { leads: 7, jobsCreated: 4, jobsWon: 2, bookedByTradie: 1 },
    ...overrides,
  };
}

const input = (clientName: string, month: string, missedCalls?: ReportMissedCallsDocument): PartnerCsvInput => ({
  clientName,
  month,
  missedCalls,
});

describe('PARTNER_CSV_HEADER', () => {
  it('is the fixed fourteen-column list', () => {
    expect(PARTNER_CSV_HEADER).toHaveLength(14);
    expect(PARTNER_CSV_HEADER.join(',')).toBe(HEADER_LINE);
  });

  it('has no column that could carry a phone number, a body or a caller identifier', () => {
    for (const column of PARTNER_CSV_HEADER) expect(column).not.toMatch(PERSONAL);
  });
});

describe('partnerCsv', () => {
  it('writes the header and nothing else for no rows', () => {
    expect(partnerCsv([])).toBe(`${HEADER_LINE}${CRLF}`);
  });

  it('starts every output with the header line and ends with CRLF', () => {
    const csv = partnerCsv([input('Acme Plumbing', '2026-08', block())]);
    expect(csv.split(CRLF)[0]).toBe(HEADER_LINE);
    expect(csv.endsWith(CRLF)).toBe(true);
    expect(csv.split(CRLF)).toHaveLength(3);
  });

  it('writes the figures in header order', () => {
    const csv = partnerCsv([input('Acme Plumbing', '2026-08', block())]);
    expect(csv.split(CRLF)[1]).toBe('Acme Plumbing,2026-08,12,3,2,9,8,41,75,2,7,4,2,1');
  });

  it('quotes a name with a comma and doubles an inner quote (RFC 4180)', () => {
    const csv = partnerCsv([input('Acme, "The" Plumbing', '2026-08')]);
    expect(csv.split(CRLF)[1]!.startsWith('"Acme, ""The"" Plumbing",2026-08,')).toBe(true);
  });
});

describe('partnerCsvRows', () => {
  it('a month without the block has an empty cell in every column after month', () => {
    const [row] = partnerCsvRows([input('Acme Plumbing', '2026-07')]);
    expect(row).toHaveLength(14);
    expect(row!.slice(0, 2)).toEqual(['Acme Plumbing', '2026-07']);
    expect(row!.slice(2).every((cell) => cell === '')).toBe(true);
  });

  it('a null median or P90 is an empty cell, never 0', () => {
    const [row] = partnerCsvRows([
      input('Acme Plumbing', '2026-08', block({ textBacks: { sent: 1, delivered: 0, medianSeconds: null, p90Seconds: null } })),
    ]);
    const at = (name: string) => row![PARTNER_CSV_HEADER.indexOf(name as (typeof PARTNER_CSV_HEADER)[number])];
    expect(at('text_back_median_seconds')).toBe('');
    expect(at('text_back_p90_seconds')).toBe('');
    expect(at('text_backs_delivered')).toBe('0');
  });

  it('prefixes a formula-leading client name with an apostrophe', () => {
    for (const lead of ['=', '+', '-', '@']) {
      const [row] = partnerCsvRows([input(`${lead}1+1`, '2026-08')]);
      expect(row![0]).toBe(`'${lead}1+1`);
    }
    const [plain] = partnerCsvRows([input('Plain 1+1', '2026-08')]);
    expect(plain![0]).toBe('Plain 1+1');
  });

  it('also guards a tab, a carriage return and leading whitespace before a lead (15-REVIEW WR-05)', () => {
    for (const name of ['\t=1+1', '\r=1+1', '  =1+1', ' +1+1', '\u00a0-1+1', '\t@SUM(A1)', '\tPlain', '\rPlain']) {
      const [row] = partnerCsvRows([input(name, '2026-08')]);
      expect(row![0], JSON.stringify(name)).toBe(`'${name}`);
    }
    // Whitespace before an ordinary name is not a formula.
    for (const name of [' Plain 1+1', 'Plain = 1+1', 'A-1 Electrical']) {
      const [row] = partnerCsvRows([input(name, '2026-08')]);
      expect(row![0], JSON.stringify(name)).toBe(name);
    }
  });

  it('writes a formula-leading name as the escaped cell in the file', () => {
    expect(partnerCsv([input('=1+1', '2026-08')]).split(CRLF)[1]!.startsWith("'=1+1,")).toBe(true);
  });

  it('sorts by client name, then month', () => {
    const rows = partnerCsvRows([
      input('Zed Electrical', '2026-07'),
      input('Acme Plumbing', '2026-08'),
      input('Acme Plumbing', '2026-07'),
    ]);
    expect(rows.map((row) => `${row[0]} ${row[1]}`)).toEqual([
      'Acme Plumbing 2026-07',
      'Acme Plumbing 2026-08',
      'Zed Electrical 2026-07',
    ]);
  });
});

describe('the writer names nothing personal (structural pin, D-04)', () => {
  const code = readFileSync(join(process.cwd(), 'src/core/reporting/partner-csv.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('matches no personal token once comments are stripped', () => {
    expect(code).not.toMatch(PERSONAL);
  });

  it('imports only papaparse and the document types', () => {
    const imports = [...code.matchAll(/^import\s+([\s\S]*?)from\s+'([^']+)';$/gm)].map(([, clause, specifier]) => ({
      clause: clause!.trim(),
      specifier,
    }));
    expect(imports.map((entry) => entry.specifier).sort()).toEqual(['./document', 'papaparse']);
    const documentImport = imports.find((entry) => entry.specifier === './document');
    expect(documentImport!.clause.startsWith('type ')).toBe(true);
  });
});

/**
 * 2026-10 (15-03, D-04): THE REPOSITORY READ THAT FEEDS THE WRITER gets the
 * writer's pin. `src/db/repository/reports.ts` crosses tenants (it is a family
 * read, not a `forAllTenants_*` export), so what it may select is the whole
 * of what the export can ever carry: five columns of ONE table, the frozen
 * figures and the ids that place them. A sixth column, a join, or a customer
 * token fails here before it can reach a CSV.
 */
describe('the export read names nothing personal (structural pin, D-04)', () => {
  const code = readFileSync(join(process.cwd(), 'src/db/repository/reports.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('matches no personal token once comments are stripped', () => {
    expect(code).not.toMatch(PERSONAL);
  });

  it('joins no table and reads only monthly_reports', () => {
    expect(code).not.toMatch(/join\(/i);
    const tables = new Set([...code.matchAll(/\.from\((\w+)\)/g)].map((match) => match[1]));
    expect(tables).toEqual(new Set(['monthlyReports']));
  });

  it('selects the tenant id, the period, the zone, the version and the figures — and nothing else', () => {
    const selected = [...code.matchAll(/(\w+):\s*monthlyReports\.(\w+)/g)].map(([, key, column]) => ({
      key,
      column,
    }));
    expect(selected.map((entry) => entry.key).sort()).toEqual(
      ['figures', 'periodStart', 'tenantId', 'timezone', 'version'].sort(),
    );
    for (const entry of selected) expect(entry.column).toBe(entry.key);
    // The `lines` document names jobs; it is never selected.
    expect(code).not.toMatch(/monthlyReports\.lines/);
  });
});
