/**
 * Phase 15 (15-06, RPT-04, D-03, D-10, D-11) — the missed-call block on the
 * three reports surfaces, pinned at the source.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE FAILURES THIS PINS: a printed report from August that gains a block  │
 * │ it was never sent with; a sheet that recomputes a figure at render time; │
 * │ a live block that derives its numbers differently from the frozen one;   │
 * │ a failed missed-call read that blanks the whole reports page; a client   │
 * │ with no divert number shown as `0` missed calls.                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * No database renders these pages, so the proof is the source itself, read
 * with comments stripped (the `queue-lead-rows` mould). The behaviour of the
 * derivation is `tests/missed-call-figures.test.ts`; the frozen-row fixture is
 * `tests/report-frozen-fixture.test.ts`; the DB round trip is the dated
 * describe in `tests/monthly-report.test.ts` (CI).
 *
 * PURE: no seed, no database client, no environment.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\}/g, '{}')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
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

const GENERATE_PATH = 'src/core/reporting/generate.ts';
const SHEET_PATH = 'src/app/(console)/reports/[client]/[reportId]/page.tsx';
const CLIENT_PATH = 'src/app/(console)/reports/[client]/page.tsx';
const OVERVIEW_PATH = 'src/app/(console)/reports/page.tsx';

const GENERATE = code(GENERATE_PATH);
const SHEET = code(SHEET_PATH);
const CLIENT = code(CLIENT_PATH);
const OVERVIEW = code(OVERVIEW_PATH);

describe('2026-10-13 (15-06): the generator freezes the block (D-03)', () => {
  it('reads the counts and derives the block once, inside the report transaction', () => {
    expect(GENERATE.match(/missedCallCounts\(/g) ?? []).toHaveLength(1);
    expect(GENERATE.match(/computeMissedCallFigures\(/g) ?? []).toHaveLength(1);
    expect(GENERATE).toContain('repo.metrics.missedCallCounts(period, timezone)');

    const transaction = GENERATE.indexOf('.transaction(async (repo)');
    expect(transaction).toBeGreaterThan(-1);
    expect(GENERATE.indexOf('missedCallCounts(')).toBeGreaterThan(transaction);
  });

  it('writes the block as `missedCalls:` on the figures document — the compared object', () => {
    const documents = GENERATE.slice(GENERATE.indexOf('const documents = {'));
    const figures = documents.slice(0, documents.indexOf('lines,'));
    expect(figures).toMatch(/missedCalls:\s*computeMissedCallFigures\(missedCallCounts\)/);
    expect(figures).toContain('...figures');
  });
});

describe('2026-10-13 (15-06): the printed sheet prints the block ONLY from the row (D-11)', () => {
  it('guards the block on its presence in the frozen figures', () => {
    expect(SHEET).toMatch(/figures\.missedCalls === undefined \? null :/);
    expect(SHEET).toContain('When calls came in');
    expect(SHEET).toContain('NO_SAMPLES_LABEL');
  });

  it('computes nothing — no derivation and no banned aggregation module', () => {
    expect(SHEET).not.toContain('computeMissedCallFigures');
    const specifiers = valueImportSources(SHEET_PATH);
    for (const banned of ['figures', 'fees', 'metrics', 'generate', 'missed-call-figures']) {
      expect(specifiers).not.toContain(`@/core/reporting/${banned}`);
    }
  });

  it('prints the weekday table and never the hour table (UI-SPEC §3c)', () => {
    expect(SHEET).not.toContain('byHour');
    expect(SHEET).toContain('byIsoWeekday');
    expect(SHEET).toContain('afterHoursByIsoWeekday');
  });
});

describe('2026-10-13 (15-06): the live month-to-date block (D-03, D-10)', () => {
  it('derives through the same pure function over the calendar month to date', () => {
    expect(CLIENT).toContain('currentMonth(');
    expect(CLIENT).toContain('missedCallCounts(');
    expect(CLIENT).toContain('computeMissedCallFigures(');
    expect(valueImportSources(CLIENT_PATH)).toContain('@/core/reporting/missed-call-figures');
  });

  it('reads in its own tolerated arm, logging only the fixed string', () => {
    const read = CLIENT.indexOf('missedCallCounts(');
    const tryAt = CLIENT.lastIndexOf('try {', read);
    const catchAt = CLIENT.indexOf('catch', read);
    expect(tryAt).toBeGreaterThan(-1);
    expect(catchAt).toBeGreaterThan(read);

    // No other read shares this try — the arm is the block's own.
    const arm = CLIENT.slice(tryAt, catchAt);
    expect(arm).not.toContain('windowCounts');
    expect(arm).not.toContain('reports.list');

    const handler = CLIENT.slice(catchAt, CLIENT.indexOf('}', catchAt) + 1);
    expect(handler).toContain("console.error('[reports] missed-call figures read failed')");
    expect(handler).toMatch(/^catch\s*\{/);
    expect(CLIENT).toContain('Could not load the missed-call figures. Try again in a moment.');
  });

  it('renders the five rows, the footnote and the fixed null sentences', () => {
    for (const label of [
      'label="Missed calls"',
      'label="After hours"',
      'label="Text-back speed"',
      'label="Reply rate"',
      'label="Leads → jobs"',
    ]) {
      expect(CLIENT).toContain(label);
    }
    expect(CLIENT).toContain('MISSED_CALL_LIVE_FOOTNOTE');
    for (const key of ['none', 'noSamples', 'nothingDelivered', 'noLeads']) {
      expect(CLIENT).toContain(`MISSED_CALL_EVIDENCE.${key}`);
    }
    expect(CLIENT).toContain('delivered text-backs replied');
    expect(CLIENT).toContain(' of ${afterHours.denominator} calls');
  });

  it('splits by weekday and by hour in two plain tables, or one line when empty', () => {
    expect(CLIENT).toContain('aria-label="Missed calls by weekday"');
    expect(CLIENT).toContain('aria-label="Missed calls by hour"');
    expect(CLIENT).toContain('By weekday, {timezone}');
    expect(CLIENT).toContain('By hour of day, {timezone}');
    expect(CLIENT).toContain('No diverted calls this month.');
    expect(CLIENT).toContain("hour12: true");
    expect(CLIENT).not.toMatch(/<svg|<canvas|recharts|chart\.js/i);
  });

  it('sits between the rolling window and the monthly reports', () => {
    const rolling = CLIENT.indexOf('Last {LIVE_METRICS_WINDOW_DAYS} days');
    const block = CLIENT.indexOf('<MissedCallsLiveBlock');
    const monthly = CLIENT.indexOf('<h2>Monthly reports</h2>');
    expect(rolling).toBeGreaterThan(-1);
    expect(block).toBeGreaterThan(rolling);
    expect(monthly).toBeGreaterThan(block);
  });
});

describe('2026-10-13 (15-06): the overview column (UI-SPEC §3a)', () => {
  it('adds the seventh column after Multiple, with no divert number distinct from zero', () => {
    expect(OVERVIEW).toContain('<th className="num">Missed calls</th>');
    expect(OVERVIEW.indexOf('Missed calls</th>')).toBeGreaterThan(
      OVERVIEW.indexOf('Multiple</th>'),
    );
    expect(OVERVIEW).toContain('no divert number');
    expect(OVERVIEW).toContain('row.missedCalls.hasDivertNumber');
    expect(OVERVIEW).toContain('{row.missedCalls.afterHours} after hours');
  });
});

describe('2026-10-13 (15-06, Task 2): the design-partner export (D-04, T-15-03, T-15-09)', () => {
  const ISLAND_PATH = 'src/app/(console)/reports/export-csv-form.tsx';
  const ACTION_PATH = 'src/app/(console)/reports/export-actions.ts';

  it("the island is 'use client' and value-imports exactly react, the action and the leaf", () => {
    const firstCodeLine = readFileSync(ISLAND_PATH, 'utf8')
      .split('\n')
      .find((line) => line.trim() !== '' && !line.trim().startsWith('//'));
    expect(firstCodeLine).toBe("'use client';");
    expect(valueImportSources(ISLAND_PATH).sort()).toEqual(
      ['./export-actions', './export-state', 'react'].sort(),
    );
  });

  it('the island downloads through a Blob, with the status line in the tree from first paint', () => {
    const island = code(ISLAND_PATH);
    expect(island).toContain('URL.createObjectURL(');
    expect(island).toContain('URL.revokeObjectURL(');
    expect(island).toContain("type: 'text/csv;charset=utf-8'");
    // Unconditionally rendered: the role sits on an element no ternary guards.
    expect(island).toMatch(/<p className="muted" role="status">\s*\{status\}\s*<\/p>/);
    expect(island).not.toMatch(/router\.push|window\.location|confirm\(/);
  });

  it('revokes the Blob URL on a timer AFTER the click, never in the same tick (15-REVIEW WR-06)', () => {
    const island = code(ISLAND_PATH);
    const click = island.indexOf('link.click();');
    const timer = island.indexOf('setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS)');
    expect(click).toBeGreaterThan(-1);
    expect(timer).toBeGreaterThan(click);
    // No synchronous revoke between the click and the timer.
    expect(island.slice(click, timer)).not.toContain('URL.revokeObjectURL(');
    // The delay is one named constant, and the effect's cleanup clears it.
    expect(island).toMatch(/const REVOKE_AFTER_MS = 10_000;/);
    expect(island).toMatch(/return \(\) => \{\s*clearTimeout\(timer\);\s*URL\.revokeObjectURL\(url\);\s*\};/);
  });

  it('the action calls requireOperator() before the cross-tenant read, and parses every row', () => {
    const action = code(ACTION_PATH);
    const gate = action.indexOf('requireOperator()');
    const read = action.indexOf('listLatestReportFiguresForExport(');
    expect(gate).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(gate);
    expect(action).toContain('reportFiguresSchema.parse(row.figures)');
    expect(action).toContain('row.periodStart.slice(0, 7)');
    expect(action).toContain('partnerCsv(inputs)');
    // Frozen figures and tenant names only — no personal field on this path.
    expect(action).not.toMatch(/caller|mobile|e164|from_address|to_address|body|contact_/i);
  });

  it('no GET route was built beside the action (research OQ2 — never both)', () => {
    expect(() => readFileSync('src/app/(console)/reports/csv/route.ts', 'utf8')).toThrow();
  });

  it('the /reports page carries the export section', () => {
    expect(OVERVIEW).toContain('id="design-partner-export"');
    expect(OVERVIEW).toContain('<ExportCsvForm />');
    expect(OVERVIEW).toContain('{EXPORT_HINT}');
  });
});
