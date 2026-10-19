/**
 * THE LAYOUT RULES A UAT PRINT AND A PHONE DISPROVED, PINNED AT SOURCE (07-06).
 *
 * Phase 7 UAT produced a four-page iPhone PDF with a blank last page, a job
 * number run into its description (`#4201Switchboard…`), a row split across a
 * fold and no header on the continuation pages — and a console bar that made
 * every page wider than a 390px phone. Each was a CSS rule that did not do
 * what its comment and the UI-SPEC said it did. These assertions pin the rules
 * that DO: they read the stylesheets and the page, not a browser, so they run
 * in the pure suite on every `npm test`.
 *
 * Comments are stripped before any negative match — a comment that names the
 * old selector while explaining why it is gone must not fail the gate.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPORT_CSS = readFileSync('src/app/(console)/reports/[client]/[reportId]/report.css', 'utf8');
const AUDIT_CSS = readFileSync('src/app/(console)/audits/[id]/audit.css', 'utf8');
const GLOBALS_CSS = readFileSync('src/app/globals.css', 'utf8');
/**
 * `.tsx` with JSX comments, block comments and whole-line comments removed —
 * the `.tsx` counterpart of `uncommented()`, and the same promise the header
 * makes about CSS.
 *
 * It was applied to the three CSS constants and never to the page, so both
 * negative matches over the page ran on raw text (07-06 review, WR-07). The
 * `tbody` slice is dense with exactly the explanatory comment the header says
 * must be tolerated — the Job cell alone carries a twelve-line block — so
 * writing the natural note ("`report-figure-note` was inert here, which is why
 * the id ran into the description") failed the gate for a documentation change,
 * and a comment containing `className="report-softwrap"` inflated a count.
 *
 * The line-comment pattern is anchored at the start of a line on purpose: an
 * unanchored `//` would eat the rest of any line containing a URL.
 *
 * A HEURISTIC, NOT A PARSER (07-07 review, IN-03). It has no string awareness,
 * so a template-literal or JSX-text line that happens to BEGIN with `//` — a
 * protocol-relative URL, an example comment quoted in copy — is deleted from
 * the text the gates then search, and a `/*` inside a string literal would open
 * a false block comment. The current tree is unaffected (all `<table`
 * occurrences survive stripping), and the `seen > 0` / `boxes > 0` guards below
 * are the backstop against a stripper that eats everything — but a gate that
 * suddenly stops seeing markup it should see is worth checking here first.
 *
 * The JSX form `{/* … *\/}` is stripped FIRST: strip the inner block comment
 * first and the surviving braces are an empty JSX expression that reads as
 * markup. `gen-tables.mjs` strips in the same order for the same reason.
 */
function uncommentedTsx(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Every `.tsx` under `src/app`, sorted — so a failure message names the same
 * files in the same order on every machine.
 *
 * A recursive walk rather than a list of pages: the gate below has to fail on
 * the table nobody has written yet, which is the one thing an allowlist of
 * today's pages cannot do.
 *
 * `src/app`, NOT `src/app/(console)` (07-07 review, WR-05). The narrower walk
 * made a promise it could not keep: a table added under another route group,
 * under `src/app` directly, or in a shared component rendered into the console
 * was outside the gate while `seen > 0` still passed, so the gate reported
 * healthy about files it had never opened. Nothing is excluded today — every
 * `<table>` in the tree is a console table on a 390px phone. If a print-only
 * or email table ever lands here, exclude it BY PATH with the reason, so the
 * exemption is a line somebody has to write rather than a walk that never
 * looked.
 */
function appTsxFiles(): string[] {
  const base = 'src/app';
  return readdirSync(base, { recursive: true })
    .map(String)
    .filter((entry) => entry.endsWith('.tsx'))
    .map((entry) => join(base, entry))
    .sort();
}

/**
 * How many `<table>`s a source has, how many sit DIRECTLY inside a
 * `.table-scroll` wrapper, and how many of those wrappers a keyboard cannot
 * reach.
 *
 * MATCHED BY MEANING, NOT BY ONE BYTE STRING (07-07 review, WR-05). The
 * previous `/<div className="table-scroll">\s*<table\b/` required that exact
 * spelling, so `className="table-scroll wide"`, a second attribute, a quote
 * style or a formatter splitting the tag across lines all read as "unwrapped" —
 * and adding the WR-03 keyboard attributes would have failed the gate on all
 * nine wrappers at once. The class is what the CSS keys on, so the class is
 * what this looks for, in any attribute order.
 *
 * Whitespace only between the div and the table: an intervening element would
 * become the box that overflows instead, which is the whole defect.
 */
function tableWrapping(source: string): { tables: number; wrapped: number; unreachable: number } {
  const stripped = uncommentedTsx(source);
  const wrappers = [
    ...stripped.matchAll(/<div[^>]*\bclassName=(["'])[^"']*\btable-scroll\b[^"']*\1[^>]*>\s*<table\b/g),
  ].map(([tag]) => tag);
  return {
    tables: stripped.match(/<table\b/g)?.length ?? 0,
    wrapped: wrappers.length,
    // WCAG 2.1.1: an `overflow-x: auto` box with no focusable descendant is not
    // scrollable by keyboard in Chrome, Edge or Safari, so the columns the box
    // hides are unreachable without a pointer. `tabIndex={0}` is the fix and
    // `aria-label` is what stops the resulting stop being an unnamed region.
    unreachable: wrappers.filter((tag) => !/tabIndex=\{0\}/.test(tag) || !/aria-label=/.test(tag))
      .length,
  };
}

/** The report page source with its comments stripped. */
const REPORT_PAGE = uncommentedTsx(
  readFileSync('src/app/(console)/reports/[client]/[reportId]/page.tsx', 'utf8'),
);

/** The audit page source with its comments stripped. */
const AUDIT_PAGE = uncommentedTsx(readFileSync('src/app/(console)/audits/[id]/page.tsx', 'utf8'));

/**
 * The console shell source with its comments stripped — the bar's markup.
 *
 * Read through `uncommentedTsx` for the same reason the CSS is read through
 * `uncommented()`: the nav is dense with block comments arguing the ORDER of
 * the links, and one of them mentions `tabIndex` by name while explaining why
 * the row does not get one. A raw-text negative match would fail on the
 * explanation (07-06 review, WR-07).
 */
const CONSOLE_LAYOUT = uncommentedTsx(readFileSync('src/app/(console)/layout.tsx', 'utf8'));

/** CSS with every block comment removed. */
function uncommented(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * The declarations of the ONE rule whose selector list contains every selector
 * given, in any order.
 *
 * PARSED, NOT PATTERN-MATCHED, and that is the whole point. Looking up
 * `${selector} {` as literal text pins the FORMATTING rather than the meaning
 * (07-06 review, WR-08): it requires exactly one space before the brace, so a
 * formatter emitting `.nav button.linkish{` makes the lookup miss; it misses a
 * selector list wrapped across lines; and matching `.report-lines th,\s*
 * .report-lines td` pins the ORDER of a list, so reordering to the
 * byte-for-byte-equivalent `td, th` fails a test about a font size.
 *
 * FAILS LOUDLY on a miss and on an ambiguity — both used to pass silently.
 * Returning `''` on a miss made every negative assertion pass against a file
 * that no longer said anything of the kind (WR-06). And `.report-footer`,
 * `.audit-footer` and `.report-lines .cell-truncate` each open TWO rules, one
 * per medium, saying deliberately opposite things — taking the first hit read
 * the right block only by accident of source order. Callers pass
 * `screenBlock()` or `printBlock()` to say which they mean; this refuses to
 * guess if they did not.
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

/**
 * Everything BEFORE `@media print` — the screen rules.
 *
 * `.report-footer`, `.audit-footer` and `.report-lines .cell-truncate` each
 * appear twice, once per medium, and the two say deliberately opposite things.
 * Splitting the file at the medium boundary lets `rule()` address each on
 * purpose instead of taking whichever the source order happened to put first.
 */
function screenBlock(css: string): string {
  const source = uncommented(css);
  const at = source.indexOf('@media print');
  return at < 0 ? source : source.slice(0, at);
}

/** The body of the `@media print` block (brace-balanced). */
function printBlock(css: string): string {
  const source = uncommented(css);
  const start = source.indexOf('@media print');
  // Unguarded, `indexOf('{', -1)` clamps to 0 and this brace-matches the FIRST
  // rule in the file, returning `.report-sheet`'s body as 'the print block' —
  // so every print assertion fails with a confusing message instead of the true
  // one, and a negative assertion passes outright (07-06 review, WR-06).
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

describe('the printed report sheet (G-07-1, G-07-2)', () => {
  it('resets the footer bottom margin so no zero-ink height trails the last page', () => {
    // A <p> keeps the UA's 1em bottom margin unless the shorthand resets it;
    // in print it collapses out to the root and WebKit pages for it.
    // SCREEN block explicitly: `.report-footer` and `.audit-footer` each open a
    // second rule inside `@media print` (the break-inside group), and the
    // margin reset being asserted here belongs to the screen one.
    expect(rule(screenBlock(REPORT_CSS), '.report-footer')).toMatch(/margin: 1\.5rem 0 0;/);
    expect(rule(screenBlock(REPORT_CSS), '.report-footer')).not.toMatch(/margin-top:/);
    expect(rule(screenBlock(AUDIT_CSS), '.audit-footer')).toMatch(/margin: 0;/);
  });

  it('puts break-inside: avoid on the thead — the box Chromium actually repeats', () => {
    expect(rule(printBlock(REPORT_CSS), '.report-lines thead')).toMatch(/break-inside: avoid;/);
  });

  it('drives every job cell to one line box in print and names the pressure valve', () => {
    // Addressed by selector SET, not by the source order of the list: `th, td`
    // and `td, th` are the same rule and a test about a font size has no
    // business failing on which one a formatter emitted (WR-08).
    const cells = rule(printBlock(REPORT_CSS), '.report-lines th', '.report-lines td');
    expect(cells).toMatch(/white-space: nowrap;/);
    expect(cells).toMatch(/font-size: 0\.7rem;/);

    const print = printBlock(REPORT_CSS);
    expect(rule(print, '.report-lines td.report-softwrap')).toMatch(/white-space: normal;/);
    expect(rule(print, '.report-lines .cell-truncate')).toMatch(/max-width: 13rem;/);
  });

  it('does not claim a row break rule it cannot have — rows are whole by being one line', () => {
    // Chromium never honoured break-inside on a table row and WebKit split one
    // with the rule present; the selector group must not name rows.
    const group = printBlock(REPORT_CSS).match(/([^{}]*)\{\s*break-inside: avoid;\s*\}/g) ?? [];
    expect(group.length).toBeGreaterThan(0);
    for (const g of group) expect(g).not.toMatch(/\.report-lines tr\b/);
    // MEMBERSHIP of the group, not its last entry. The old regex matched
    // `.report-footer {`, which only ever hits the final selector in the list —
    // so reordering the group broke a test about page breaks (WR-08).
    expect(rule(printBlock(REPORT_CSS), '.report-footer', '.report-hero')).toMatch(
      /break-inside: avoid;/,
    );
  });

  it('gives WebKit the same sheet width as Chromium, and only WebKit', () => {
    // WebKit prints at 1px = 1pt (a 496px column on the iPhone); Chromium at
    // 96px/in (688px). 0.75 is exactly 72/96 — the pt-to-px ratio, not a tuned
    // value; a test that let it drift would be letting the premise drift.
    const print = printBlock(REPORT_CSS);
    expect(print).toMatch(
      /@supports \(font: -apple-system-body\) \{[\s\S]*?html \{\s*zoom: 0\.75;/,
    );
  });

  it('will not shrink a 96px/in print even if the vendor sniff ever matches one', () => {
    // `@supports (font: -apple-system-body)` asks which vendor wrote the
    // parser, not a question about the page, and Chrome already accepts
    // `-apple-system` as a font-family — one parser change from shrinking every
    // Chromium print to 75% (07-06 review, WR-04). So the sniff is ANDed with
    // the question actually being asked: WebKit's A4 print box is at most
    // 516px, Chromium's is 688px, and 560px sits between them. The width query
    // cannot stand alone — a Chromium A5 page is 559px — hence both.
    expect(printBlock(REPORT_CSS)).toMatch(
      /@supports \(font: -apple-system-body\) \{\s*@media \(max-width: 560px\) \{/,
    );
  });

  it('clips the description in print ONLY — on screen the whole frozen text is readable', () => {
    // globals' 16rem `.cell-truncate` cap is written for the 200-row quotes
    // table. Here the table already scrolls, the recovery affordance is a
    // `title` the operator cannot reach on a phone, and the clip buys no
    // layout — so the screen rule lifts it and print keeps the budget.
    expect(rule(screenBlock(REPORT_CSS), '.report-lines .cell-truncate')).toMatch(
      /max-width: none;[\s\S]*white-space: normal;/,
    );
    expect(rule(printBlock(REPORT_CSS), '.report-lines .cell-truncate')).toMatch(
      /white-space: nowrap;/,
    );
  });

  it('renders the Job cell as one clipped line with a literal separator', () => {
    const tbody = REPORT_PAGE.slice(REPORT_PAGE.indexOf('<tbody>'), REPORT_PAGE.indexOf('</tbody>'));
    // The SPAN and the TITLE, not their attribute order or the helper's name.
    // The old regex pinned `className=... title={jobLabel(line)}` verbatim, so
    // renaming the helper or adding an attribute failed a test whose subject is
    // that the cell is one clipped line with a recoverable full text (WR-08).
    const jobCell = tbody.slice(tbody.indexOf('<td>'), tbody.indexOf('</td>'));
    expect(jobCell).toMatch(/className="cell-truncate"/);
    expect(jobCell).toMatch(/title=\{/);
    expect(tbody).toContain("{' · '}");
    // The class whose only block rule is scoped to `.report-figure` is inert
    // inside a table cell — that inertness was the run-on job number.
    expect(tbody).not.toContain('report-figure-note');
    // ONE pressure valve, and it is the Follow-ups cell. Customer lost its
    // softwrap in the 07-06 review (CR-01): a nowrap name column turns an
    // over-budget sheet into a loud harness failure instead of a two-line row.
    expect(tbody).toMatch(/className="report-softwrap">\s*\{followUpRange\(/);
    expect(tbody).not.toMatch(/className="report-softwrap">\{line\.contactFirstName/);
  });
});

describe('the console bar at phone width (G-07-3, quick-260904-dwt)', () => {
  it('makes the LINK ROW the box that scrolls, and keeps the outer bar wrapping only as a fallback', () => {
    // SUPERSEDES the 07-06 pin (`both nav flex containers wrap`). That fix was
    // right that the document must never widen and wrong about what it should
    // cost: wrapping both containers bought a 390px page three rows and 176px
    // of chrome, a quarter of the phone screen. The row now holds its own
    // overflow instead — the one box in the bar allowed to — so the bar is one
    // 72px row and the document is still exactly 390px (quick-260904-dwt).
    expect(rule(GLOBALS_CSS, '.nav')).toMatch(/flex-wrap: wrap;/);

    const row = rule(GLOBALS_CSS, '.nav nav');
    expect(row).toMatch(/flex-wrap: nowrap;/);
    // The outer fallback must NOT have leaked back into the row: a wrapping row
    // is the 176px bar again, and it would still pass every other pin here.
    expect(row).not.toMatch(/flex-wrap: wrap;/);
    expect(row).toMatch(/overflow-x: auto;/);
    expect(row).toMatch(/scroll-snap-type: x proximity;/);
    // Without this the snap lands on the first item's edge (scrollLeft 4),
    // swallowing the ring padding below and leaving 0px of headroom.
    expect(row).toMatch(/scroll-padding-inline: 0\.25rem;/);
    expect(row).toMatch(/scrollbar-width: none;/);
    // The cue that more exists, driven by the scroll position and nothing else.
    expect(row).toMatch(/mask-image: linear-gradient\(/);
    expect(row).toMatch(/var\(--nav-fade\)/);
    expect(row).toMatch(/animation-timeline: scroll\(self inline\);/);
  });

  it('pays for the focus ring with a padding/margin pair that nets to zero layout', () => {
    // WR-03 banned a bleed that BOUGHT tap-box height and put one hit box
    // inside another. This is the opposite trade and the pair is asserted
    // TOGETHER for that reason: the padding exists only so a 3px ring is not
    // clipped by the scroll container, and the equal negative margin gives the
    // space straight back, so no hit box moves. Either half alone is a bug —
    // padding without the margin grows the bar, margin without the padding
    // clips the ring.
    const row = rule(GLOBALS_CSS, '.nav nav');
    expect(row).toMatch(/padding: 0\.25rem;/);
    expect(row).toMatch(/margin: -0\.25rem;/);

    // Items are snap starts that never shrink — a shrinking item is a label
    // squeezed mid-phrase instead of a row that scrolls.
    const items = rule(GLOBALS_CSS, '.nav nav > *');
    expect(items).toMatch(/flex: 0 0 auto;/);
    expect(items).toMatch(/scroll-snap-align: start;/);

    // The desktop right-alignment. `justify-content: flex-end` would look
    // identical at 700px and push the START of the row out of reach at 390px.
    expect(rule(GLOBALS_CSS, '.nav nav > :first-child')).toMatch(/margin-inline-start: auto;/);
  });

  it('draws the fade from the scroll position in CSS alone, and adds no tabIndex to the row', () => {
    // A registered length is what makes the collapse interpolate rather than
    // flip, and what makes an unsupporting engine fall back to no fade at all
    // (an unregistered custom property would leave `mask-image` invalid).
    const css = uncommented(GLOBALS_CSS);
    expect(css).toMatch(/@property --nav-fade \{[^}]*syntax: '<length>';/);
    expect(css).toMatch(/@property --nav-fade \{[^}]*initial-value: 0px;/);

    const frames = css.slice(css.indexOf('@keyframes nav-row-edge'));
    expect(frames).toContain('@keyframes nav-row-edge');
    expect(frames.slice(0, 200)).toMatch(/--nav-fade: 2\.5rem;/);
    expect(frames.slice(0, 200)).toMatch(/--nav-fade: 0px;/);

    // NO `tabIndex` on the row, unlike `.table-scroll`: that box holds no
    // focusable descendant, so a keyboard cannot scroll it. This one is seven
    // links and a submit button — focus moves through them and the browser
    // scrolls each into view, which `nav-check.sh` measures rather than assumes.
    const nav = CONSOLE_LAYOUT.slice(CONSOLE_LAYOUT.indexOf('<nav'));
    expect(nav.slice(0, nav.indexOf('>') + 1)).not.toMatch(/tabIndex/);
  });

  it('puts EVERY nav control on the 44px tap target, Sign out included', () => {
    // 06-UI-SPEC:51 covers every button and names the Queue link's tap area.
    // Before this rule only Sign out complied: the brand and all six links
    // measured 24px and Queue — the control the spec names — 26.6px, under a
    // test whose title certified the opposite (07-06 review, WR-02).
    const tap = rule(GLOBALS_CSS, '.nav .brand', '.nav nav > a', '.nav button.linkish');
    expect(tap).toMatch(/min-height: 2\.75rem;/);
    expect(tap).toMatch(/display: inline-flex;/);
  });

  it('buys that 44px from the box, not by bleeding into the row above it', () => {
    // `margin: -0.625rem 0` bled 10px into a ~9.3px gap, so 0.7px of Sign out
    // sat inside Audits and — later in DOM order — won hit-testing there: a tap
    // on the bottom edge of Audits signed the operator out (WR-03). The bleed
    // was also load-bearing on a coincidence, growing with the root font size.
    // `nav-check.sh` is the real arbiter (it now asserts no two hit boxes
    // intersect); this pins the mechanism so it cannot come back unnoticed.
    const tap = rule(GLOBALS_CSS, '.nav .brand', '.nav nav > a', '.nav button.linkish');
    expect(tap).not.toMatch(/margin:[^;]*-/);
    expect(tap).not.toMatch(/margin-(top|bottom):[^;]*-/);
  });

  it('wears the v2 lockup as SUPPLIED ART, not a typeset name (logo v2, 19 Sep 2026)', () => {
    // The console rendered `{SERVICE_NAME}` in system-ui at weight 600 until
    // now — the right colour by accident (it reads `--fg`, which moved to
    // Graphite in quick-260919-kel) and the wrong letterforms by construction.
    // v2's wordmark is Archivo 700, lowercase, tracked -0.04em, and
    // logo/README.txt forbids approximating any of that ("never respace, never
    // capitalise"). The only way to obey it is to show the drawing.
    const brand = CONSOLE_LAYOUT.slice(
      CONSOLE_LAYOUT.indexOf('className="brand"'),
      CONSOLE_LAYOUT.indexOf('</Link>', CONSOLE_LAYOUT.indexOf('className="brand"')),
    );

    // BOTH transparent variants, switched by the browser. The supplied lockups
    // carry no ground of their own, so the Graphite drawing is invisible on the
    // dark scheme's bar and the Paper one on the light scheme's — one file
    // cannot serve both, and `<picture>` means only one is ever fetched.
    expect(brand).toContain('<picture>');
    expect(brand).toContain('media="(prefers-color-scheme: dark)"');
    expect(brand).toContain('/brand/lockup-paper-transparent.png');
    expect(brand).toContain('/brand/lockup-graphite-transparent.png');

    // Explicit intrinsic size, matching the CSS exactly, so the bar does not
    // reflow while the PNG decodes.
    expect(brand).toContain('width={105}');
    expect(brand).toContain('height={20}');
    expect(brand).toContain('alt={SERVICE_NAME}');

    // No typeset wordmark left anywhere in the shell. `SERVICE_NAME` survives
    // ONLY as the alt text; rendered as a child it is the thing this replaced.
    expect(brand).not.toMatch(/>\s*\{SERVICE_NAME\}\s*</);
  });

  it('renders the lockup above README’s 100px floor, at the source ratio', () => {
    // logo/README.txt: "Min lockup 100px / 24mm." 105px clears it; the height
    // follows 1508/288 = 5.236, rounded to 5.25 exactly as the marketing
    // header's 147/28 already does.
    const img = rule(GLOBALS_CSS, '.nav .brand img');
    expect(img).toMatch(/width: 105px;/);
    expect(img).toMatch(/height: 20px;/);
    expect(105 / 20).toBeCloseTo(1508 / 288, 1);
    expect(105).toBeGreaterThanOrEqual(100);
  });

  it('keeps the brand on the 44px target and gives it the file’s own focus ring', () => {
    // The tap box is unchanged by the swap — it comes from `.nav .brand`'s
    // `min-height`, not from whatever is inside it (asserted above with the
    // links). The ring is new: the brand sat on the UA's `auto` outline while
    // it was text, which is not good enough around a transparent PNG whose ink
    // stops well inside its box.
    expect(
      rule(GLOBALS_CSS, '.nav .brand:focus-visible', '.nav nav > a:focus-visible'),
    ).toMatch(/outline: 2px solid var\(--accent\);/);
  });

  it('records the 390px measurement the brand width is chosen against', () => {
    // NOT decoration. Every "which items fit the first screenful" argument in
    // this stylesheet is arithmetic on the brand's width, and those numbers
    // were computed when the service was called "Quote Recovery" (121px) —
    // the rename to "Backdesk" cut it to 73.6px and the comment was never
    // updated, so it described a bar that had not existed for weeks. It misled
    // the change that replaced it. This pins the re-measured figures to the
    // file so the next drift fails here instead of in somebody's reasoning.
    const nav = GLOBALS_CSS.slice(0, GLOBALS_CSS.indexOf('.nav {'));

    expect(nav).toContain('237px'); // the row's client box at 390px
    expect(nav).toContain('502px'); // its content, unchanged by the swap
    expect(nav).toContain('~353px'); // where the wrap fallback now engages

    // The two stale figures themselves, gone. `121px` still appears ONCE, in
    // the note recording that it was wrong — that sentence is the point, so
    // this matches the arithmetic rather than the digits.
    expect(nav).not.toContain('221px'); // the row box the 121px brand implied
    expect(nav).not.toContain('369px'); // the wrap threshold it implied
    expect(nav.match(/121px/g)).toHaveLength(1);
  });

  it('keeps the bar out of the printed report and audit entirely', () => {
    // The row now owns a mask, a scroll position and a hidden scrollbar, none
    // of which have a defined printed form — a bar that reappeared on paper
    // would arrive as a clipped strip of links on the client's report. Both
    // sheets already hide it; this pins that they still do after the change.
    expect(rule(printBlock(REPORT_CSS), '.nav')).toMatch(/display: none !important;/);
    expect(rule(printBlock(AUDIT_CSS), '.nav')).toMatch(/display: none !important;/);
  });
});

/**
 * THE LETTERHEAD ON THE TWO SHEETS A PROSPECT AND A CLIENT ARE HANDED.
 *
 * These are the only two documents that leave the building on paper, and until
 * 19 Sep 2026 the only thing on either that said who produced it was the ABN
 * line at the foot. The assertions below are not about decoration — every one
 * of them pins a way the printed identity was measured to break.
 */
describe('the printed sheets carry the v2 lockup (logo v2, 19 Sep 2026)', () => {
  const SHEETS: Array<[name: string, page: string, css: string, prefix: string]> = [
    ['audit', AUDIT_PAGE, AUDIT_CSS, 'audit'],
    ['report', REPORT_PAGE, REPORT_CSS, 'report'],
  ];

  it.each(SHEETS)('%s puts BOTH drawings in the markup, not a <picture>', (
    _name,
    page,
    _css,
    prefix,
  ) => {
    // THE MEASUREMENT BEHIND THIS, because it is the whole reason the sheets do
    // not reuse the nav's mechanism: printed through Chrome's real
    // `Page.printToPDF` with `prefers-color-scheme` forced to dark, a
    // `<picture>` whose source is scoped on the scheme alone selects the PAPER
    // lockup — a white drawing on white paper, on the page a client reads.
    // A printed page is always a light ground; the browser reports dark anyway.
    expect(page).toContain(`className="${prefix}-lockup-light"`);
    expect(page).toContain(`className="${prefix}-lockup-dark"`);
    expect(page).toContain('/brand/lockup-graphite-transparent.png');
    expect(page).toContain('/brand/lockup-paper-transparent.png');

    // Both named, because whichever is displayed is the one a screen reader
    // sees — the other is `display: none` and out of the tree entirely.
    const lockup = page.slice(page.indexOf(`${prefix}-lockup"`));
    expect(lockup.match(/alt=\{SERVICE_NAME\}/g)?.length).toBe(2);

    // The scheme switch must NOT be a <picture> on these two pages.
    const block = lockup.slice(0, lockup.indexOf('</div>'));
    expect(block).not.toContain('<picture>');
    expect(block).not.toContain('prefers-color-scheme');
  });

  it.each(SHEETS)('%s prints the GRAPHITE drawing whatever the OS scheme is', (
    _name,
    _page,
    css,
    prefix,
  ) => {
    // The reversal, unconditional, inside `@media print`. Without these two
    // rules a sheet printed from the operator's dark-mode phone carries the
    // Paper lockup onto white paper.
    const print = printBlock(css);
    expect(rule(print, `.${prefix}-lockup-light`)).toMatch(/display: block;/);
    expect(rule(print, `.${prefix}-lockup-dark`)).toMatch(/display: none;/);

    // And on screen, the other way round. `.{prefix}-lockup-dark` opens TWO
    // rules there — the base default and the dark-scheme override — which is
    // exactly the shape `rule()` refuses to guess about, so the file is split
    // at the media query and each half is addressed on purpose.
    const screen = screenBlock(css);
    const at = screen.indexOf('@media screen and (prefers-color-scheme: dark)');
    expect(at).toBeGreaterThan(-1);

    // LIGHT IS THE DEFAULT AND DARK IS THE EXCEPTION, in that order: a browser
    // that never evaluates the query still shows the readable drawing.
    expect(rule(screen.slice(0, at), `.${prefix}-lockup-dark`)).toMatch(/display: none;/);
    expect(rule(screen.slice(at), `.${prefix}-lockup-dark`)).toMatch(/display: block;/);
    expect(rule(screen.slice(at), `.${prefix}-lockup-light`)).toMatch(/display: none;/);

    // `screen` on the query is load-bearing, not tidiness: without it the dark
    // rule participates in the print cascade and races the override above.
    expect(screen.slice(at, at + 46)).toContain('screen and');
  });

  it.each(SHEETS)('%s lets the modifiers OWN display — the sizing rule must not', (
    _name,
    _page,
    css,
    prefix,
  ) => {
    /*
     * THE ASSERTION THAT WAS MISSING WHILE THE SHEET WAS WRONG.
     *
     * `.{prefix}-lockup img` is specificity (0,1,1); the two modifiers are
     * (0,1,0). The sizing rule opened with `display: block`, so it beat both of
     * them and BOTH drawings rendered — the Graphite lockup with the Paper one
     * ghosting underneath it, on the printed sheet, in every scheme. Every
     * other assertion in this block passed throughout: the modifier rules
     * existed exactly as written, they simply never won the cascade.
     *
     * A test that a rule EXISTS is not a test that it APPLIES. This one closes
     * the gap the only way source-reading can — by pinning that the higher
     * specificity selector does not touch the property being fought over.
     */
    for (const block of [screenBlock(css), printBlock(css)]) {
      expect(rule(block, `.${prefix}-lockup img`)).not.toMatch(/display:/);
    }
    // And the modifiers are the only place it is decided, at equal specificity
    // in both directions, so source order is what resolves them.
    expect(rule(screenBlock(css).slice(0, screenBlock(css).indexOf('@media screen')),
      `.${prefix}-lockup-light`)).toMatch(/display: block;/);
  });

  it.each(SHEETS)('%s renders the lockup above README’s 24mm print floor', (
    _name,
    _page,
    css,
    prefix,
  ) => {
    // logo/README.txt: "Min lockup 100px / 24mm." The print size is given in
    // MILLIMETRES because that is the unit the floor is written in and the one
    // that survives both engines' page boxes.
    const printed = rule(printBlock(css), `.${prefix}-lockup img`);
    const mm = Number(printed.match(/width:\s*([\d.]+)mm;/)?.[1]);

    expect(mm).toBeGreaterThanOrEqual(24);
    // `height: auto`, not a second millimetre figure: the image is long loaded
    // by print time, so the browser uses the source's exact 1508:288 and no
    // rounding enters the one dimension with a legal minimum under it.
    expect(printed).toMatch(/height: auto;/);

    // On screen it is the marketing header's pair exactly, so the two documents
    // a prospect sees carry the identity at one size.
    const shown = rule(screenBlock(css), `.${prefix}-lockup img`);
    expect(shown).toMatch(/width: 147px;/);
    expect(shown).toMatch(/height: 28px;/);
  });

  it.each(SHEETS)('%s keeps the footer identity line as TEXT', (_name, page) => {
    // The lockup replaces no part of the legal line. The ABN is an identifier
    // with exactly one spelling (D-16/D-17) and it is built in `@/core/brand`;
    // a picture of it would be unselectable, unsearchable and untranslatable on
    // a document somebody may have to quote back to us.
    expect(page).toContain('footerIdentityLine(ABN_DISPLAY)');
  });
});

/**
 * THE BOX, AT SOURCE, FOR EVERY TABLE — not a list of the pages we know about.
 *
 * An auto-layout table's used width is max(specified, min-content), so
 * `table { width: 100% }` cannot shrink a table below its header cells: the
 * seven padded uppercase cells of the Clients table are 447.7px on their own,
 * 599.6px with realistic rows, against the 350px column a 390px phone offers.
 * `section`, `main`, `.shell`, `body` and `html` all leave overflow visible, so
 * the surplus becomes document width and the page — nav sign-out included —
 * scrolls sideways. `.table-scroll` is the one box in the chain that contains
 * it, and this equality is the assertion that was missing when 06-02 added a
 * seventh column to a table that had never had the box (G-07-6).
 */
describe('every console table scrolls inside its own box (G-07-6)', () => {
  it('wraps every <table> under src/app in .table-scroll — a bare table widens a 390px phone', () => {
    const offenders: string[] = [];
    let seen = 0;

    for (const file of appTsxFiles()) {
      const { tables, wrapped } = tableWrapping(readFileSync(file, 'utf8'));
      if (tables === 0) continue;
      seen += tables;
      if (wrapped !== tables) offenders.push(`${file}: ${tables} table(s), ${wrapped} wrapped`);
    }

    // A wrong path, a renamed route group or a walk that returned nothing must
    // not pass vacuously — an empty gate certifies nothing (WR-06).
    expect(seen).toBeGreaterThan(0);
    // One assertion over the whole array, so a failure names EVERY unwrapped
    // table in one run rather than the first one alphabetically.
    expect(offenders).toEqual([]);
  });

  it('makes every one of those boxes reachable by keyboard (WCAG 2.1.1)', () => {
    // The box is `overflow-x: auto`, and a scroll container with no focusable
    // descendant cannot be scrolled by keyboard in Chrome, Edge or Safari. So
    // the columns the box hides — the ones it exists to hide — are pointer-only
    // without this (07-07 review, WR-03). The sync-runs table is the clear
    // case: a time, a badge <span> and two integers, nothing focusable at all.
    const offenders: string[] = [];
    let boxes = 0;

    for (const file of appTsxFiles()) {
      const { wrapped, unreachable } = tableWrapping(readFileSync(file, 'utf8'));
      boxes += wrapped;
      if (unreachable > 0) offenders.push(`${file}: ${unreachable} of ${wrapped} box(es) unreachable`);
    }

    expect(boxes).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  it('is not fooled by a commented-out wrapper, a quote style or an attribute order', () => {
    // THE GATE'S OWN FALSIFICATION, kept in the suite rather than performed by
    // hand once (the 07-07 review mutated `audits/page.tsx` and restored it).
    // Synthetic sources, so it asserts the matcher rather than today's tree.
    const box = '<div className="table-scroll" tabIndex={0} role="region" aria-label="X">';

    expect(tableWrapping(`${box}\n  <table>\n  </table>\n</div>`)).toEqual({
      tables: 1,
      wrapped: 1,
      unreachable: 0,
    });

    // The wrapper surviving ONLY as a comment must read as unwrapped — that is
    // the mutation, and it must FAIL.
    expect(tableWrapping(`{/* ${box} */}\n<div>\n  <table>\n  </table>\n</div>`)).toMatchObject({
      tables: 1,
      wrapped: 0,
    });

    // Attributes in any order, single quotes, an extra class, the tag split
    // across lines: all still the same box (WR-05).
    expect(
      tableWrapping(`<div\n  role="region"\n  className='table-scroll wide'\n  tabIndex={0}\n  aria-label="X"\n>\n<table>`),
    ).toMatchObject({ wrapped: 1, unreachable: 0 });

    // A box with no keyboard affordance is seen AND rejected (WR-03).
    expect(tableWrapping('<div className="table-scroll">\n<table>')).toMatchObject({
      wrapped: 1,
      unreachable: 1,
    });

    // An intervening element is not a wrapper: it would be the box that
    // overflows instead.
    expect(tableWrapping(`${box}\n<section>\n<table>`)).toMatchObject({ tables: 1, wrapped: 0 });
  });

  it('keeps .table-scroll the overflow-containing box, with a visible focus stop', () => {
    expect(rule(GLOBALS_CSS, '.table-scroll')).toMatch(/overflow-x: auto;/);
    // A tab stop nobody can see is a worse affordance than no tab stop.
    expect(rule(GLOBALS_CSS, '.table-scroll:focus-visible')).toMatch(/outline: 2px solid/);
  });
});
