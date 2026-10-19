/**
 * RPT-02 — ONE ROW PER MONTH, AND EVERY SUPERSEDED VERSION STILL REACHABLE.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE PROPERTY THAT IS EXPENSIVE TO LOSE (T-Q-05). A frozen version may    │
 * │ already be stapled to an invoice. Collapsing the list must never be the  │
 * │ same act as hiding a document a client was actually sent — when they     │
 * │ ring about version 1, version 1 has to be findable. So the disclosure is │
 * │ NATIVE `<details>`: every earlier version is in the DOM, is a real       │
 * │ `Link`, and opens with its own `Version N of M` banner.                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── WHY SOURCE ASSERTIONS AND NOT A RENDER ──────────────────────────────────
 *
 * The page is an async React Server Component whose body opens three
 * `forTenant()` reads and a Supabase session before it returns any markup.
 * Rendering it would mean mocking the database, the auth client and the router
 * to assert the shape of a list — and the properties at stake here are
 * STRUCTURAL (which element, which class, which predicate), which is exactly
 * what source assertions can state precisely and a render cannot. The grouping
 * arithmetic itself has no branch worth a fixture: it is a Map and a `Math.max`.
 *
 * PURE. No database, no `ALLOW_REMOTE_TESTS`, runs on bare `npm test`.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const LIST_PAGE = 'src/app/(console)/reports/[client]/page.tsx';
const REPORT_PAGE = 'src/app/(console)/reports/[client]/[reportId]/page.tsx';
const GENERATE_FORM = 'src/app/(console)/reports/[client]/generate-form.tsx';
const CSS = 'src/app/globals.css';

const LIST_SOURCE = readFileSync(LIST_PAGE, 'utf8');
const REPORT_SOURCE = readFileSync(REPORT_PAGE, 'utf8');
const FORM_SOURCE = readFileSync(GENERATE_FORM, 'utf8');
const CSS_SOURCE = readFileSync(CSS, 'utf8');

/** Value imports only — `import type { … }` lines are erased and are fine. */
function valueImportSources(path: string): string[] {
  const source = readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  return [...source.matchAll(/^import\s+([\s\S]*?)from\s+'([^']+)';$/gm)]
    .filter(([, clause]) => !/^\s*type\s/.test(clause))
    .map(([, , specifier]) => specifier);
}

describe('the reports list groups by month without hiding a version', () => {
  it('draws exactly two disclosures — the fee schedule and the per-month one', () => {
    expect(
      LIST_SOURCE.match(/<details className="disclosure"/g) ?? [],
      'A third would mean something else on this page got collapsed, which is a ' +
        'decision and not a refactor.',
    ).toHaveLength(2);
  });

  it('uses a NATIVE details — no client island collapses a billing history', () => {
    // `'use client'` on this page would ship the reports list to the browser and
    // put a `@/db` value import one edge away from the bundle.
    expect(LIST_SOURCE).not.toContain("'use client'");
  });

  it('names how many earlier versions are behind the summary', () => {
    expect(LIST_SOURCE).toContain('earlier version');
    expect(
      LIST_SOURCE,
      'One version is not `1 earlier versions`. The operator reads this line ' +
        'more often than any other on the screen.',
    ).toContain("earlier.length === 1 ? '' : 's'");
  });

  it('still renders every earlier version as a link, and marks it superseded', () => {
    expect(LIST_SOURCE).toContain('superseded');
    expect(
      LIST_SOURCE,
      'SUPERSEDED, NEVER HIDDEN (D-11). A collapsed row is still a row.',
    ).toContain('earlier.map(');
  });

  it('picks the month’s newest version by MAXIMUM, not by list position', () => {
    expect(
      LIST_SOURCE,
      'The `period_start DESC, version DESC` ordering is a repository promise. ' +
        'The row the operator opens should stay right on the day it moves.',
    ).toContain('row.version > best.version');
  });

  it('says the cap is on VERSIONS, and never types the number', () => {
    expect(
      LIST_SOURCE,
      'What falls off the end is the oldest month’s OLDEST versions, so a ' +
        'month showing only `version 3` would otherwise read as though 1 and 2 ' +
        'were never generated.',
    ).toContain('report versions');
    expect(LIST_SOURCE).toContain('the oldest month shown may be missing earlier versions');

    // The predicate stays on versions fetched — grouping happens afterwards.
    expect(LIST_SOURCE).toContain('versions.length === REPORT_LIST_LIMIT');
    // Interpolated from the repository's constant, never typed as a literal.
    expect(LIST_SOURCE).toContain('{REPORT_LIST_LIMIT}');
  });

  it('tells the operator that re-generating only writes when something changed', () => {
    expect(LIST_SOURCE).toContain('only if the figures or lines changed');
    expect(FORM_SOURCE).toContain('only if something changed');
    expect(
      FORM_SOURCE,
      'The old sentence promised a new version on every press, which is no ' +
        'longer what the button does.',
    ).not.toContain('adds a new version');
  });
});

describe('the things this change must NOT have touched', () => {
  it('leaves the report page’s own `Version N of M` banner alone', () => {
    expect(
      REPORT_SOURCE,
      'The banner is how a superseded version announces itself when opened from ' +
        'inside the disclosure — it is the other half of not hiding anything.',
    ).toContain('latestVersionOf(');
    expect(REPORT_SOURCE).toContain('of {latestVersion}');
  });

  it('keeps the generate form at its four imports, none of them `@/db`', () => {
    expect(
      valueImportSources(GENERATE_FORM),
      'A CLIENT ISLAND. The unchanged sentence reaches it through ' +
        '`GenerateState.success` + `reportId`, which already existed — pinned ' +
        'here as well as in lint-ban, on THIS change.',
    ).toEqual(['next/link', 'react', './actions', './action-state']);
  });
});

describe('the nested disclosure claims its own line inside the row', () => {
  it('has the rule that stops the summary sitting beside the generated-at meta', () => {
    expect(
      CSS_SOURCE,
      '`.touch-list li` is a wrapping flex row, so a bare `<details>` becomes a ' +
        'content-sized item and the 44px thumb target shrinks to the width of ' +
        'its own text.',
    ).toContain('.touch-list li > .disclosure');
  });
});
