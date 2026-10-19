/**
 * A REPORT FROZEN BEFORE PHASE 15 STILL READS EXACTLY AS IT DID (D-03, D-11).
 *
 * PURE. `tests/fixtures/monthly-report-v1.json` is a hand-written stored row
 * in the shape `generate.ts` froze before the optional `missedCalls` block
 * existed: eleven figure keys, two lines, a baseline, constants and fees. A
 * tradie may already hold the document it describes, so this suite pins three
 * things: it still parses, its canonical figures are byte-identical to what is
 * stored (nothing was added on the way through), and its footnotes are the
 * same five it had. A fresh row MAY carry the block, gains exactly one note,
 * and the comparator calls it a new version (N+1, N kept — D-03).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { MISSED_CALL_SHEET_NOTE, methodologyNotes } from '@/core/reporting/copy';
import {
  parseReportDocument,
  reportMissedCallsSchema,
  type ReportMissedCallsDocument,
  type StoredReportRow,
} from '@/core/reporting/document';
import { canonicalJson, reportDocumentsUnchanged } from '@/core/reporting/unchanged';

/** Counted from a run BEFORE the copy change — the notes a pre-Phase-15 row has. */
const NOTES_BEFORE_PHASE_15 = 5;

const RAW = JSON.parse(
  readFileSync(join(process.cwd(), 'tests/fixtures/monthly-report-v1.json'), 'utf8'),
) as Omit<StoredReportRow, 'generatedAt'> & { generatedAt: string; figures: Record<string, unknown> };

const STORED: StoredReportRow = { ...RAW, generatedAt: new Date(RAW.generatedAt) };

const BLOCK: ReportMissedCallsDocument = {
  captured: 12,
  withheld: 2,
  byHour: Array.from({ length: 24 }, (_, hour) => (hour === 18 ? 5 : hour === 9 ? 7 : 0)),
  byIsoWeekday: [3, 2, 2, 1, 2, 1, 1],
  afterHoursByIsoWeekday: [1, 0, 1, 0, 0, 1, 0],
  afterHours: { numerator: 3, denominator: 12, rateBp: 2500 },
  textBacks: { sent: 9, delivered: 8, medianSeconds: 41, p90Seconds: 75 },
  replyRate: { numerator: 2, denominator: 8, rateBp: 2500 },
  funnel: { leads: 7, jobsCreated: 4, jobsWon: 2, bookedByTradie: 1 },
};

const documentsOf = (row: { figures: unknown; lines: unknown; baseline: unknown; constants: unknown; fees: unknown }) => ({
  figures: row.figures,
  lines: row.lines,
  baseline: row.baseline,
  constants: row.constants,
  fees: row.fees,
});

describe('the stored pre-Phase-15 row', () => {
  const parsed = parseReportDocument(STORED);

  it('is the shape it claims: eleven figure keys and no block', () => {
    expect(Object.keys(RAW.figures)).toHaveLength(11);
    expect(RAW.figures).not.toHaveProperty('missedCalls');
  });

  it('parses with figures.missedCalls undefined', () => {
    expect(parsed.figures.missedCalls).toBeUndefined();
    expect('missedCalls' in parsed.figures).toBe(false);
  });

  it('has canonical figures byte-identical to the stored document', () => {
    expect(canonicalJson(parsed.figures)).toBe(canonicalJson(RAW.figures));
  });

  it('renders exactly the notes it had, none about missed calls', () => {
    const notes = methodologyNotes(parsed);
    expect(notes).toHaveLength(NOTES_BEFORE_PHASE_15);
    for (const note of notes) expect(note).not.toContain('Missed calls');
  });

  it('is unchanged against itself through the comparator', () => {
    expect(reportDocumentsUnchanged(documentsOf(RAW), documentsOf(RAW))).toBe(true);
  });
});

describe('reportMissedCallsSchema', () => {
  it('accepts a complete block', () => {
    expect(reportMissedCallsSchema.parse(BLOCK)).toEqual(BLOCK);
  });

  it('rejects byHour of length 23', () => {
    expect(reportMissedCallsSchema.safeParse({ ...BLOCK, byHour: BLOCK.byHour.slice(1) }).success).toBe(false);
  });

  it('rejects a non-integer rateBp', () => {
    expect(
      reportMissedCallsSchema.safeParse({ ...BLOCK, afterHours: { ...BLOCK.afterHours, rateBp: 2500.5 } }).success,
    ).toBe(false);
  });
});

describe('a row carrying the block', () => {
  const withBlock = { ...RAW, figures: { ...RAW.figures, missedCalls: BLOCK } };

  it('is a CHANGED document set to the comparator (version N+1, N kept)', () => {
    expect(reportDocumentsUnchanged(documentsOf(withBlock), documentsOf(RAW))).toBe(false);
  });

  it('parses, keeps the block, and gains exactly the sheet note as its last note', () => {
    const parsed = parseReportDocument({ ...STORED, figures: withBlock.figures });
    expect(parsed.figures.missedCalls).toEqual(BLOCK);
    const notes = methodologyNotes(parsed);
    expect(notes).toHaveLength(NOTES_BEFORE_PHASE_15 + 1);
    expect(notes.at(-1)).toBe(MISSED_CALL_SHEET_NOTE);
    expect(notes.slice(0, -1)).toEqual(methodologyNotes(parseReportDocument(STORED)));
  });
});
