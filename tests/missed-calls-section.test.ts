/**
 * Phase 15 (CON-06, D-02; T-15-03, T-15-01, T-15-14) — the client page's
 * missed-calls section, pinned by its source.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE FAILURES THIS PINS: the one list on an RLS-only page that carries a  │
 * │ caller's number is read BEFORE the operator gate (or with no gate); its  │
 * │ failure blanks the client page instead of costing the section; a raw     │
 * │ snake_case reason reaches the operator's phone; a stamped row renders    │
 * │ its hash; or the pages skip by OFFSET and a call arriving mid-scroll     │
 * │ shifts a row onto two pages.                                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * No database renders a server component here, so the proof is the source,
 * read with comments stripped (the `queue-lead-rows` mould): prose that names
 * a call cannot satisfy an assertion about it.
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

const SECTION_PATH = 'src/app/(console)/clients/[id]/missed-calls-list.tsx';
const SECTION = code(SECTION_PATH);

describe('the missed-calls section component (D-02)', () => {
  it('is a server component', () => {
    expect(readFileSync(SECTION_PATH, 'utf8').slice(0, 200)).not.toContain("'use client'");
  });

  it('runs the operator gate before the one read that returns caller numbers', () => {
    const gate = SECTION.indexOf('requireOperator()');
    const read = SECTION.indexOf('listForLog(');
    expect(gate).toBeGreaterThanOrEqual(0);
    expect(read).toBeGreaterThan(gate);
    // ONE read of the log.
    expect(SECTION.split('listForLog(').length - 1).toBe(1);
  });

  it('renders the denied sentence, never a row, when the gate refuses', () => {
    expect(SECTION).toContain('OPERATOR_DENIED_MESSAGE[access]');
    expect(SECTION).toMatch(/access\s*!==\s*'ok'/);
  });

  it('discards the caught value and logs one fixed string', () => {
    expect(SECTION).toContain("console.error('[client] missed calls read failed')");
    // Every catch in the file is bare — no bound value to leak.
    expect(SECTION).not.toMatch(/catch\s*\(/);
    const logs = SECTION.match(/console\.(error|log|warn|info)\([^)]*\)/g) ?? [];
    expect(logs).toEqual(["console.error('[client] missed calls read failed')"]);
  });

  it('says its own failure inside the section', () => {
    expect(SECTION).toContain('Could not load the missed calls');
    expect(SECTION).toContain('role="alert"');
  });

  it('takes every chip and caller word from the maps', () => {
    for (const token of [
      'resolveTextBackOutcome(',
      'TEXT_BACK_STUCK_MINUTES',
      'NUMBER_RETIRED_LABEL',
      'CALLER_KIND_LABELS',
      'AFTER_HOURS_LABEL',
      'LEAD_RESOLUTION_LABELS',
      'toLocalSpacedMobile(',
    ]) {
      expect(SECTION, token).toContain(token);
    }
    // The threshold is passed in milliseconds (the leaf's contract).
    expect(SECTION).toMatch(/TEXT_BACK_STUCK_MINUTES\s*\*\s*60_000/);
  });

  it('checks the retired stamp before it renders a number', () => {
    const retired = SECTION.indexOf('pseudonymisedAt !== null');
    const mobile = SECTION.indexOf('toLocalSpacedMobile(');
    expect(retired).toBeGreaterThanOrEqual(0);
    expect(mobile).toBeGreaterThan(retired);
  });

  it('pages twenty at a time over the keyset, never an offset', () => {
    // MOVED 2026-10-15 (15-REVIEW WR-07): the pin follows the constant, so
    // the read's limit and the "Show older calls" test cannot drift apart.
    expect(SECTION).toMatch(/const PAGE_SIZE = 20;/);
    expect(SECTION).toContain('limit: PAGE_SIZE');
    expect(SECTION).toContain('rows.length === PAGE_SIZE');
    expect(SECTION).not.toMatch(/limit: \d/);
    expect(SECTION).toContain('parseCallsBefore(');
    expect(SECTION).toContain('formatCallsBefore(');
    expect(SECTION).not.toContain('.offset(');
    expect(SECTION).not.toMatch(/\bOFFSET\b/);
    expect(SECTION).toContain('Show older calls');
    expect(SECTION).toContain('Newest calls');
  });

  it('carries the anchor and both divert-aware empty states', () => {
    expect(SECTION).toContain('id="missed-calls"');
    expect(SECTION).toContain('No diverted calls yet.');
    expect(SECTION).toContain('appear here newest first');
    expect(SECTION).toContain('Provision a divert number above first');
  });
});

/*
 * 2026-10 (Phase 15, 15-05 Task 2) — THE PAGE HALF. The section is mounted on
 * the client page between Quotes and Recent sync runs, fed the checklist's own
 * facts, and the page itself still never reads the log (T-6-21: the page's own
 * reads select no number; the gated component is the one file that does).
 */
const PAGE = code('src/app/(console)/clients/[id]/page.tsx');

describe('the missed-calls section on the client page (D-02)', () => {
  it('sits after Quotes and before Recent sync runs', () => {
    const quotes = PAGE.indexOf('Quotes <span className="muted zone-note">');
    const section = PAGE.indexOf('<MissedCallsSection');
    const runs = PAGE.indexOf('Recent sync runs');
    expect(quotes).toBeGreaterThanOrEqual(0);
    expect(section).toBeGreaterThan(quotes);
    expect(runs).toBeGreaterThan(section);
    expect(PAGE.split('<MissedCallsSection').length - 1).toBe(1);
  });

  it('reads the cursor from searchParams and hands it over raw', () => {
    expect(PAGE).toContain('searchParams');
    expect(PAGE).toContain('[CALLS_BEFORE_PARAM]');
    expect(PAGE).toMatch(/callsBefore=\{callsBefore\}/);
  });

  it("passes the checklist's own facts, so the state line and the card agree", () => {
    expect(PAGE).toMatch(/divertNumber=\{checklist\?\.divert\.numberE164 \?\? null\}/);
    expect(PAGE).toMatch(/textBackLive=\{checklist\?\.live\.textBack \?\? 'not_armed'\}/);
    expect(PAGE).toMatch(/now=\{now\}/);
  });

  it('never reads the log, a caller number or the operator gate itself', () => {
    expect(PAGE).not.toContain('listForLog(');
    expect(PAGE).not.toContain('caller_e164');
    expect(PAGE).not.toContain('callerE164');
    expect(PAGE).not.toMatch(/\brequireOperator(?:Id)?\s*\(/);
  });
});
