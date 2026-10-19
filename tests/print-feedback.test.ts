/**
 * THE ONE THING THE OPERATOR SEES WHEN THE BROWSER SHOWS NOTHING (G-07-4).
 *
 * Phase 7 UAT: the first press of `Print or save as PDF` on iPhone Safari did
 * nothing and the second produced the PDF. The diagnosis found no code defect —
 * WebKit's `window.print()` returns silently and defers while any subresource
 * is loading, and Next's default `<Link>` prefetch supplies exactly those
 * in-flight requests right after hydration. What the button lacked was any way
 * for the operator to tell a deferred print from a dead button.
 *
 * The hardening is a transition table, so it is testable without a browser:
 * a press always acknowledges, the dialog opening always clears, a stale timer
 * never resurrects a hint, and the button is never taken out of service. The
 * fallback sentence is asserted BYTE-VERBATIM — it names the two manual routes
 * and an operator between site visits has to be able to follow it exactly.
 *
 * PURE. No jsdom, no fake timers, no network. The island itself is pinned by
 * reading its source, which is the same trade `tests/layout-contract.test.ts`
 * makes: a source pin is not a render, but it catches the listener being
 * deleted, and it runs on every `npm test`.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  nextPrintFeedback,
  printFeedbackMessage,
  PRINT_FALLBACK_AFTER_MS,
  PRINT_FALLBACK_MESSAGE,
  PRINT_OPENING_MESSAGE,
  type PrintFeedback,
  type PrintFeedbackEvent,
} from '../src/app/(console)/reports/[client]/[reportId]/print-feedback';

const DIR = 'src/app/(console)/reports/[client]/[reportId]';
const LEAF = readFileSync(`${DIR}/print-feedback.ts`, 'utf8');
const REPORT_CSS = readFileSync(`${DIR}/report.css`, 'utf8');

/** Source with block comments and whole-line comments removed. */
function uncommented(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const ISLAND = uncommented(readFileSync(`${DIR}/print-button.tsx`, 'utf8'));

describe('the print button’s transition table (G-07-4)', () => {
  const CASES: [PrintFeedback, PrintFeedbackEvent, PrintFeedback][] = [
    // A press always acknowledges — from `fallback` too, because a button that
    // has just told the operator it failed is the one they will press again.
    ['idle', 'press', 'opening'],
    ['opening', 'press', 'opening'],
    ['fallback', 'press', 'opening'],
    // The dialog is the acknowledgement; ours goes away.
    ['idle', 'beforeprint', 'idle'],
    ['opening', 'beforeprint', 'idle'],
    ['fallback', 'beforeprint', 'idle'],
    // Belt and braces for a surface that opens a dialog without announcing it.
    ['idle', 'afterprint', 'idle'],
    ['opening', 'afterprint', 'idle'],
    ['fallback', 'afterprint', 'idle'],
    // The alarm fires ONLY on a press still waiting for a dialog. The three
    // unchanged cases are the point: a timer armed by a press whose sheet has
    // since opened must not put the hint back under it.
    ['opening', 'timeout', 'fallback'],
    ['idle', 'timeout', 'idle'],
    ['fallback', 'timeout', 'fallback'],
  ];

  for (const [from, event, to] of CASES) {
    it(`${from} + ${event} → ${to}`, () => {
      expect(nextPrintFeedback(from, event)).toBe(to);
    });
  }

  it('clears its own hint when the deferred sheet finally arrives', () => {
    // The WebKit case end to end: press, 1.5s of silence, then the print
    // dialog turning up by itself once the last subresource settled.
    let state: PrintFeedback = 'idle';
    state = nextPrintFeedback(state, 'press');
    expect(state).toBe('opening');
    state = nextPrintFeedback(state, 'timeout');
    expect(state).toBe('fallback');
    state = nextPrintFeedback(state, 'beforeprint');
    expect(state).toBe('idle');
  });

  it('is idempotent — the same signal arriving twice is one transition', () => {
    // The island feeds BOTH `window.addEventListener('beforeprint')` and the
    // `matchMedia('print')` change into this table (07-07 review, CR-01), and
    // on an engine that has both they arrive together. Two identical events
    // must not be two state changes, or the second would fight the first.
    let state: PrintFeedback = 'idle';
    state = nextPrintFeedback(state, 'press');
    state = nextPrintFeedback(state, 'beforeprint');
    expect(state).toBe('idle');
    state = nextPrintFeedback(state, 'beforeprint');
    expect(state).toBe('idle');
    state = nextPrintFeedback(state, 'afterprint');
    state = nextPrintFeedback(state, 'afterprint');
    expect(state).toBe('idle');
  });

  it('ignores a stale timer that fires after the dialog opened', () => {
    let state: PrintFeedback = 'idle';
    state = nextPrintFeedback(state, 'press');
    state = nextPrintFeedback(state, 'beforeprint');
    expect(state).toBe('idle');
    state = nextPrintFeedback(state, 'timeout');
    expect(state).toBe('idle');
  });
});

describe('what the line actually says', () => {
  it('renders no line at all when there is nothing to say', () => {
    expect(printFeedbackMessage('idle')).toBeNull();
  });

  it('acknowledges the press byte for byte', () => {
    expect(printFeedbackMessage('opening')).toBe('Opening print…');
    expect(PRINT_OPENING_MESSAGE).toBe('Opening print…');
  });

  it('names BOTH manual routes byte for byte — the operator follows it exactly', () => {
    expect(printFeedbackMessage('fallback')).toBe(
      'Nothing opened? On iPhone use Share → Print; on desktop press ⌘P / Ctrl+P.',
    );
    expect(PRINT_FALLBACK_MESSAGE).toBe(
      'Nothing opened? On iPhone use Share → Print; on desktop press ⌘P / Ctrl+P.',
    );
  });

  it('waits 1.5s before saying it — long enough not to flicker, short enough to be believed', () => {
    expect(PRINT_FALLBACK_AFTER_MS).toBe(1500);
  });
});

describe('the island that drives it', () => {
  it('keeps the reducer a leaf — it imports nothing at all', () => {
    // One directory from a file that reads the database. `tests/lint-ban.test.ts`
    // pins it in CLIENT_REACHABLE; this is the stricter statement.
    expect(uncommented(LEAF)).not.toMatch(/^import\b/m);
  });

  /**
   * Every `import` STATEMENT in a source, with its specifier — or `null` for a
   * side-effect import, which has no `from` clause.
   *
   * The old pin collected `/^import\s[\s\S]*?from\s+'([^']+)';$/gm`, so
   * `import '@/db/repository';` produced no match at all: the allowlist loop
   * had nothing to reject and `specifiers.length > 0` still held on the two
   * legitimate imports (07-07 review, WR-04). A statement with no `from` is now
   * a `null` the assertion trips over, and `["…"]` double quotes are read too.
   */
  function importStatements(source: string): { line: string; specifier: string | null }[] {
    return [...source.matchAll(/^import\b[^;]*?;/gm)].map(([line]) => {
      const match = /\bfrom\s+['"]([^'"]+)['"]/.exec(line);
      return { line, specifier: match === null ? null : match[1] };
    });
  }

  it('imports react and its sibling, and nothing else — in any import shape', () => {
    const statements = importStatements(ISLAND);
    expect(statements.length).toBeGreaterThan(0);
    for (const { line, specifier } of statements) {
      expect(specifier, `side-effect import with no \`from\`: ${line}`).not.toBeNull();
      expect(['react', './print-feedback']).toContain(specifier);
    }
    // A dynamic `import('…')` is a real edge in the module graph too, and it
    // is not a statement, so it would not appear above.
    expect(ISLAND).not.toMatch(/\bimport\s*\(/);
    // `export … from` re-exports another module through this one.
    expect(ISLAND).not.toMatch(/^export\b[^;]*\bfrom\b/m);
  });

  it('would catch the side-effect import that used to be invisible', () => {
    // The review's exact scenario, so the pin above cannot go quietly blind:
    // this line at the top of the island yielded the specifier list
    // ["react", "./print-feedback"] and passed.
    const poisoned = importStatements(`import '@/db/repository';\n${ISLAND}`);
    expect(poisoned.map(({ specifier }) => specifier)).toContain(null);
    // Double quotes were invisible as well.
    expect(importStatements(`import x from "@/db/repository";`)[0].specifier).toBe(
      '@/db/repository',
    );
  });

  it('listens for the dialog rather than trusting the press', () => {
    expect(ISLAND).toContain("addEventListener('beforeprint'");
    expect(ISLAND).toContain("addEventListener('afterprint'");
    // The SECOND route to those same two events, for an embedded webview or an
    // engine older than Safari 13 (07-07 review, CR-01). `beforeprint` remains
    // the primary signal; this pin stops the belt-and-braces being deleted as
    // dead code by somebody who tested on Chromium only.
    expect(ISLAND).toContain("matchMedia('print')");
    expect(ISLAND).toContain('PRINT_FALLBACK_AFTER_MS');
    // The timer is cleared, not merely armed — otherwise the hint lands under
    // an open print sheet.
    expect(ISLAND).toContain('clearTimeout(');
    // A polite live region, so the acknowledgement is heard without stealing
    // focus from the button the operator may need to press again.
    expect(ISLAND).toContain('role="status"');
    // AND IT IS NOT CONDITIONAL. A region mounted in the same commit as its
    // text is announced by nothing reliably (07-07 review, WR-01), and the
    // string pin above passes either way — so pin the shape too: exactly one
    // region, rendered before any `{message` expression, i.e. never inside a
    // `{message ? … : null}` conditional.
    expect(ISLAND.match(/role="status"/g)).toHaveLength(1);
    expect(ISLAND.indexOf('role="status"')).toBeLessThan(ISLAND.indexOf('{message'));
    expect(ISLAND).not.toMatch(/\{message \?[\s\S]*role="status"/);
  });

  it('never takes the button out of service — a second press is a fresh attempt', () => {
    expect(ISLAND).not.toMatch(/disabled=/);
  });

  it('cannot put any of it on paper', () => {
    // The line renders inside `.report-actions`, which the print block hides
    // outright. If that selector ever leaves the list, the acknowledgement
    // starts printing on a document the client is billed by.
    const source = REPORT_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const start = source.indexOf('@media print');
    expect(start).toBeGreaterThanOrEqual(0);
    const hidden = source.slice(start).match(/([^{}]+)\{\s*display: none !important;\s*\}/);
    expect(hidden).not.toBeNull();
    const selectors = (hidden as RegExpMatchArray)[1].split(',').map((sel) => sel.trim());
    expect(selectors).toContain('.report-actions');
  });
});
