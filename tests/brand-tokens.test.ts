/**
 * THE M1 PALETTE, PINNED AT SOURCE (D-04, D-07).
 *
 * Phase 8 shipped the name and deferred the colour. This suite is what stops
 * the swap being undone by a plausible-looking edit: the hexes are a brand
 * decision made once with contrast measured against both schemes, and the two
 * failure modes are silent. A token declared only in `:root` renders as its
 * light value against a dark background — invisible on the phone the operator
 * actually reads this on. And a rule that hard-codes `#fff` on the accent
 * survives every colour change ever made to the token beneath it, which is how
 * the dark-mode button ends up at 2.1:1 while the stylesheet looks correct.
 *
 * Structural, like `tests/layout-contract.test.ts`, whose harness this copies:
 * it reads the three stylesheets with `readFileSync` and asserts over text, so
 * it runs in the pure suite with no browser and no server. It cannot prove the
 * page LOOKS right — that is the human check in 09-02 — but it can prove the
 * declarations the look depends on are all still there and all still agree.
 *
 * Pure suite: no environment, no database, no provider. Runs bare
 * (`npx vitest run tests/brand-tokens.test.ts`), with NO ALLOW_REMOTE_TESTS.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const GLOBALS_CSS = readFileSync('src/app/globals.css', 'utf8');
const AUDIT_CSS = readFileSync('src/app/(console)/audits/[id]/audit.css', 'utf8');
const REPORT_CSS = readFileSync('src/app/(console)/reports/[client]/[reportId]/report.css', 'utf8');

/**
 * CSS with every block comment removed — the same promise `layout-contract`
 * makes, for the same reason. The token blocks are dense with comments naming
 * colours ("Recovered green", "unchanged") and the print blocks argue about the
 * blue they replaced; a negative match over raw text would fail on the
 * explanation rather than on the code.
 */
function uncommented(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Everything BEFORE `@media print` — the screen rules. */
function screenBlock(css: string): string {
  const source = uncommented(css);
  const at = source.indexOf('@media print');
  return at < 0 ? source : source.slice(0, at);
}

/** The body of the `@media print` block (brace-balanced). */
function printBlock(css: string): string {
  const source = uncommented(css);
  const start = source.indexOf('@media print');
  if (start < 0) throw new Error('no `@media print` block — was the print block removed?');
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return '';
}

/**
 * The stylesheet with every `@media` block removed, brace-balanced.
 *
 * globals.css declares `:root` twice and `.button--lg` twice — once at the top
 * level and once inside a media query — which makes an unqualified lookup
 * ambiguous rather than wrong. Callers say which they mean: this returns the
 * unconditional rules, `mediaBlock()` below returns one condition's.
 */
function withoutMediaBlocks(css: string): string {
  const source = uncommented(css);
  let out = '';
  for (let i = 0; i < source.length; i += 1) {
    if (!source.startsWith('@media', i)) {
      out += source[i];
      continue;
    }
    const open = source.indexOf('{', i);
    if (open < 0) break;
    let depth = 0;
    let j = open;
    for (; j < source.length; j += 1) {
      if (source[j] === '{') depth += 1;
      if (source[j] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    i = j;
  }
  return out;
}

/** The body of the `@media` block whose condition contains `condition`. */
function mediaBlock(css: string, condition: string): string {
  const source = uncommented(css);
  const at = source.indexOf('@media (' + condition + ')');
  if (at < 0) throw new Error(`no @media (${condition}) block — was it removed?`);
  const open = source.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return '';
}

/**
 * The declarations of the ONE rule whose selector list contains every selector
 * given, in any order. Copied by value from `tests/layout-contract.test.ts`
 * rather than imported: a test file importing another makes each suite's
 * helpers load-bearing for the other's failures.
 *
 * Fails loudly on a miss and on an ambiguity — a helper that returned `''` for
 * a deleted rule would make every negative assertion below pass against a file
 * that no longer said anything of the kind.
 */
function rule(css: string, ...selectors: string[]): string {
  const want = selectors.map((sel) => sel.trim().replace(/\s+/g, ' '));
  const hits = [...uncommented(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((block) => {
    const list = block[1]
      .split(',')
      .map((sel) => sel.trim().replace(/\s+/g, ' '))
      .filter(Boolean);
    return want.every((sel) => list.includes(sel));
  });

  if (hits.length === 0) {
    throw new Error(`no rule whose selectors include ${want.join(' + ')} — renamed or deleted?`);
  }
  if (hits.length > 1) {
    throw new Error(
      `${hits.length} rules include ${want.join(' + ')} — pass screenBlock()/printBlock() to pick one`,
    );
  }
  return hits[0][2];
}

/** Every `--token: value` declaration inside one rule body, lowercased. */
function tokens(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out[name] = value.trim().toLowerCase();
  }
  return out;
}

/* ------------------------------------------------------------------------- *
 * M1 §2 — the token set, verbatim, in BOTH schemes
 * ------------------------------------------------------------------------- */

/** The light scheme, exactly as the UI-SPEC locks it. Order-independent. */
const LIGHT = {
  '--bg': '#fafaf7',
  '--surface': '#ffffff',
  // Graphite, not the old Ink navy (logo v2, 19 Sep 2026): it is the hex the
  // header lockup is drawn in, and two different darks on one page read as a
  // printing fault. Strictly better on contrast — 15.75:1 on Paper and 16.47:1
  // on --surface, against 15.28 and 15.97 — so it cost nothing below it.
  '--fg': '#1a1f2b',
  '--muted': '#5b6470',
  '--line': '#d9dde3',
  '--accent': '#1b7a4a',
  '--accent-fg': '#ffffff',
  '--error': '#b42318',
  '--ok': '#1a7f37',
  '--warn': '#9a6700',
};

/** The dark scheme. Declared in full, never partially inherited from `:root`. */
const DARK = {
  '--bg': '#101317',
  '--surface': '#181c22',
  '--fg': '#e9ecf1',
  '--muted': '#9aa2b1',
  '--line': '#262b33',
  '--accent': '#4cbf86',
  '--accent-fg': '#101317',
  '--error': '#ff8a80',
  '--ok': '#57ab5a',
  '--warn': '#d4a72c',
};

/** The pre-M1 accents, in both schemes. Neither may survive anywhere. */
const OLD_BLUES = ['#1f6feb', '#6ea8fe'];

describe('the M1 token set lives in globals.css, in both schemes (D-04)', () => {
  const BASE = withoutMediaBlocks(GLOBALS_CSS);

  it('declares exactly the ten light tokens on :root — no more, no fewer', () => {
    // `toEqual` on the whole map rather than ten `toContain` checks: an extra
    // token nobody asserted is a colour decision made outside the brand spec,
    // and it is exactly as much of a drift as a wrong hex would be.
    expect(tokens(rule(BASE, ':root'))).toEqual(LIGHT);
  });

  it('re-declares ALL TEN in the dark scheme — a partial block is the silent failure', () => {
    // The comment in globals.css has said "both modes are mandatory" since
    // Phase 2; this is that sentence as a test. A token present in `:root` and
    // absent here renders as its LIGHT value on a dark background, which is
    // where contrast failures hide rather than announce themselves.
    expect(tokens(rule(mediaBlock(GLOBALS_CSS, 'prefers-color-scheme: dark'), ':root'))).toEqual(
      DARK,
    );
  });

  it('names the Recovered green once per scheme, and the pre-M1 blue nowhere', () => {
    const source = uncommented(GLOBALS_CSS).toLowerCase();

    expect(source.match(/#1b7a4a/g)).toHaveLength(1);
    expect(source.match(/#4cbf86/g)).toHaveLength(1);
    for (const blue of OLD_BLUES) {
      expect(source).not.toContain(blue);
    }
  });

  it('leaves no pre-M1 blue on either printed sheet', () => {
    // The A4 pages re-declare the tokens for print, so a blue left behind there
    // survives the swap on the one surface that gets handed to a client.
    for (const css of [AUDIT_CSS, REPORT_CSS]) {
      for (const blue of OLD_BLUES) {
        expect(uncommented(css).toLowerCase()).not.toContain(blue);
      }
    }
  });
});

/* ------------------------------------------------------------------------- *
 * The pairs, measured — not asserted in a comment
 * ------------------------------------------------------------------------- */

/** WCAG 2.1 relative luminance of an `#rrggbb` string. */
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };

  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
}

/** The WCAG contrast ratio between two `#rrggbb` strings, to 2dp. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2));
}

describe('every pair the palette actually renders clears WCAG AA (D-04)', () => {
  /*
   * WRITTEN WHEN --fg BECAME GRAPHITE (19 Sep 2026). The token swap's whole
   * defence was "strictly better on contrast", and until now that sentence
   * lived in a CSS comment where nothing could check it. A hex is a claim about
   * a RATIO, and the ratio is the thing that has to survive the next edit — so
   * the numbers are computed here from the same maps asserted above, and a
   * future colour that reads well in a design tool but fails on a phone fails
   * here first.
   *
   * 4.5:1 is the AA body-text floor. Every pair below clears it with room; the
   * tightest is the light scheme's accent at 5.11:1.
   */
  const PAIRS: Array<[string, string, string]> = [
    ['light body text on Paper', LIGHT['--fg'], LIGHT['--bg']],
    ['light body text on a card', LIGHT['--fg'], LIGHT['--surface']],
    ['light Slate on Paper', LIGHT['--muted'], LIGHT['--bg']],
    ['light link/figure green on Paper', LIGHT['--accent'], LIGHT['--bg']],
    ['light button label on the accent', LIGHT['--accent-fg'], LIGHT['--accent']],
    ['dark body text on the dark ground', DARK['--fg'], DARK['--bg']],
    ['dark body text on a card', DARK['--fg'], DARK['--surface']],
    ['dark Slate on the dark ground', DARK['--muted'], DARK['--bg']],
    ['dark link/figure green on the dark ground', DARK['--accent'], DARK['--bg']],
    ['dark button label on the accent', DARK['--accent-fg'], DARK['--accent']],
  ];

  it.each(PAIRS)('%s clears 4.5:1', (_name, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('Graphite on Paper is not a downgrade on the navy it replaced', () => {
    // The one number the swap was argued on. If a later edit softens --fg
    // towards the background, this is what says so.
    expect(contrast(LIGHT['--fg'], LIGHT['--bg'])).toBeGreaterThan(contrast('#14213d', '#fafaf7'));
  });
});

describe('button text is paid for out of --accent-fg, not #fff (D-04)', () => {
  const BASE = withoutMediaBlocks(GLOBALS_CSS);

  it('sets both the element rule and the class to var(--accent-fg)', () => {
    // White on the dark accent `#4cbf86` is ~2.1:1 and fails on the operator's
    // phone; `#101317` on it is 8.1:1. The token is what makes the label track
    // the background it sits on — a literal cannot.
    expect(rule(BASE, 'button')).toMatch(/color:\s*var\(--accent-fg\)/);
    expect(rule(BASE, '.button')).toMatch(/color:\s*var\(--accent-fg\)/);
  });

  it('leaves no hard-coded white text anywhere in globals.css', () => {
    expect(uncommented(GLOBALS_CSS).toLowerCase()).not.toMatch(
      /color:\s*(#fff\b|#ffffff\b|white\b)/,
    );
  });
});

describe('the landing CTA classes exist and spend no hex of their own', () => {
  const BASE = withoutMediaBlocks(GLOBALS_CSS);

  it('.button--secondary is an outlined, neutral twin of .button', () => {
    const body = rule(BASE, '.button--secondary');

    expect(body).toMatch(/background:\s*transparent/);
    expect(body).toMatch(/color:\s*var\(--fg\)/);
    expect(body).toMatch(/border:\s*1px solid var\(--fg\)/);
    // Worn by an `<a>` as well as a `<button>`, so the 44px target has to come
    // from a box that centres a label rather than from an inline line box.
    expect(body).toMatch(/display:\s*inline-flex/);
    expect(body).toMatch(/min-height:\s*2\.75rem/);
  });

  it('.button--lg is the one 48px action, full width on a phone only', () => {
    expect(rule(BASE, '.button--lg')).toMatch(/min-height:\s*3rem/);
    expect(rule(BASE, '.button--lg')).toMatch(/width:\s*100%/);
    expect(rule(mediaBlock(GLOBALS_CSS, 'min-width: 48rem'), '.button--lg')).toMatch(
      /width:\s*auto/,
    );
    expect(uncommented(GLOBALS_CSS)).toMatch(
      /@media \(min-width: 48rem\)\s*\{\s*\.button--lg\s*\{[^}]*width:\s*auto/,
    );
  });
});

/* ------------------------------------------------------------------------- *
 * The A4 sheets — print accent and tabular figures (D-07)
 * ------------------------------------------------------------------------- */

describe('the printed sheets carry the Recovered green and tabular figures (D-07)', () => {
  const SHEETS: Array<[string, string, string]> = [
    ['audit', AUDIT_CSS, '.audit-figure dd'],
    ['report', REPORT_CSS, '.report-figure dd'],
  ];

  it.each(SHEETS)('%s print :root forces the accent to the Recovered green', (_name, css) => {
    // Print re-declares the tokens unconditionally because
    // `prefers-color-scheme` still reports dark while printing. The accent has
    // to be named here as a literal — there is no token left to read.
    expect(tokens(rule(printBlock(css), ':root'))['--accent']).toBe('#1b7a4a');
  });

  it.each(SHEETS)('%s prints in Graphite, the brand’s own dark (logo v2)', (_name, css) => {
    // #16181d was neither Ink nor Graphite — a near-black picked for print
    // contrast before the palette had a dark of its own, left behind by the v2
    // swap because it looked like a print decision rather than a brand one. It
    // is the colour of the page a client is handed, so it was both.
    expect(tokens(rule(printBlock(css), ':root'))['--fg']).toBe('#1a1f2b');

    // The token AND the element that does not read it: `html, body` sets the
    // colour literally (not through `var(--fg)`), so it is a second place the
    // near-black could have survived the swap. `tokens()` only sees custom
    // properties, so this one is read straight off the rule body.
    expect(rule(printBlock(css), 'html', 'body')).toMatch(/color:\s*#1A1F2B;/i);

    // Nowhere in the file, in any casing — including the screen rules.
    expect(uncommented(css).toLowerCase()).not.toContain('#16181d');
  });

  it.each(SHEETS)('%s pays nothing real for the swap — computed, not narrated', (
    _name,
    css,
  ) => {
    // The quick-260919-kel pattern: a contrast claim a comment makes is a claim
    // nothing can fail on. Graphite is very slightly lighter than the near-black
    // it replaced, and "very slightly" should be a number.
    const print = tokens(rule(printBlock(css), ':root'));
    const ratio = contrast(print['--fg'], print['--bg']);

    expect(ratio).toBeGreaterThan(16); // 16.47:1, against #16181d's 17.76:1
    expect(ratio).toBeGreaterThanOrEqual(4.5); // WCAG AA body text, on paper
    // The muted colour still clears AA against the same paper — it carries the
    // methodology footnotes, which are the small type on the sheet.
    expect(contrast(print['--muted'], print['--bg'])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(SHEETS)('%s hero figure reads the token in print, not a literal', (_name, css) => {
    // The one rule that asks for `print-color-adjust: exact`. Pointing it at
    // `var(--accent)` is what keeps it in step with the `:root` above rather
    // than being a second place the brand colour is decided.
    const forced = uncommented(css)
      .slice(uncommented(css).indexOf('@media print'))
      .match(/print-color-adjust:\s*exact/g);

    expect(forced).not.toBeNull();
    expect(uncommented(css)).not.toMatch(/color:\s*#[0-9a-f]{6};\s*\n\s*print-color-adjust/i);
  });

  it.each(SHEETS)('%s dollar figures are tabular — digits line up down a column', (
    _name,
    css,
    selector,
  ) => {
    expect(rule(screenBlock(css), selector)).toMatch(
      /font-variant-numeric:\s*tabular-nums/,
    );
  });
});

/* ------------------------------------------------------------------------- *
 * The no-loose-hex rule (UI-SPEC "Consequential edits" item 4)
 * ------------------------------------------------------------------------- */

describe('colour is spent through tokens, not through literals', () => {
  /**
   * The hexes allowed to appear outside a token block, and why each one is
   * there. Anything else in the three stylesheets is a colour decision made
   * where no brand review will ever find it.
   *
   * - `#000` is the opaque end of the console bar's scroll-fade `mask-image`.
   *   A mask reads alpha, not colour; the value is a stencil, not a paint, and
   *   it is Phase 7 code that predates the palette.
   * - `#ffffff` / `#1a1f2b` / `#3d424e` / `#c9ced6` are the print forced-light
   *   values on the two A4 sheets. They cannot be tokens: they are what the
   *   tokens are overridden TO when the browser still reports dark mode while
   *   printing.
   *
   * `#16181d` LEFT THIS LIST ON 19 Sep 2026 and must not come back. It was the
   * printed foreground on both sheets — a near-black that is neither Ink nor
   * Graphite, chosen for contrast before the palette had a dark of its own. The
   * sheets now print in Graphite `#1a1f2b`, the same colour the screen is
   * painted in and the one `logo/README.txt` names.
   */
  const GRANDFATHERED = new Set(['#000', '#ffffff', '#1a1f2b', '#3d424e', '#c9ced6', '#1b7a4a']);

  const SOURCES: Array<[string, string]> = [
    ['globals.css', GLOBALS_CSS],
    ['audit.css', AUDIT_CSS],
    ['report.css', REPORT_CSS],
  ];

  it.each(SOURCES)('%s spends no hex outside the token blocks and the print override', (
    _name,
    css,
  ) => {
    const source = uncommented(css).toLowerCase();
    // Every `:root` body removed first — those ARE the token blocks, and they
    // are asserted exhaustively above. What is left is ordinary rules.
    const ordinary = source.replace(/:root\s*\{[^}]*\}/g, '');
    const found = [...ordinary.matchAll(/#[0-9a-f]{3,8}\b/g)].map(([hex]) => hex);
    const offenders = found.filter((hex) => !GRANDFATHERED.has(hex));

    expect(offenders).toEqual([]);
  });
});
