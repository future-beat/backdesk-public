/**
 * THE BUTTON A PHONE COULD NOT READ, PINNED AT SOURCE (G-09-2).
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ TWO CORRECT RULES IN TWO FILES CAN STILL BE WRONG TOGETHER. Neither     │
 * │ `.marketing a` (green, underlined — right for prose) nor `.button`      │
 * │ (green background, `--accent-fg` label — right for a control) is a bug. │
 * │ The bug is that a link which is ALSO a button matches both, and the     │
 * │ prose rule out-specifies the button by one class — so the landing page  │
 * │ shipped its two calls to action as green text on green (UAT test 1,     │
 * │ 2026-09-10).                                                            │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * A CSS-contract test in the `tests/layout-contract.test.ts` style: it reads
 * the stylesheet rather than a browser, so it runs in the pure suite on every
 * `npm test` and costs nothing. It cannot see computed colour — what it CAN see
 * is the two facts that decide it: that a rule for `a.button` exists with the
 * label token, and that it comes after the prose rule in source order. Equal
 * specificity is broken by order, and `.marketing a.button--secondary` ties
 * with `.marketing a.button` exactly, so order is load-bearing twice over.
 *
 * The third assertion is the one that keeps this honest: the prose rule must
 * STILL be green and underlined. Deleting it would also fix the button, and
 * would silently take every underline off every link in the copy (D-19: colour
 * is never the only cue).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const MARKETING_CSS = readFileSync('src/app/(marketing)/marketing.css', 'utf8');

/** Every `.tsx` under the public site's route group, sorted. */
const MARKETING_TSX = readdirSync('src/app/(marketing)', { recursive: true })
  .map((entry) => join('src/app/(marketing)', String(entry)))
  .filter((path) => path.endsWith('.tsx'))
  .sort();

/** Comments stripped, so a comment naming a selector can never satisfy a gate. */
function uncommented(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * `{ declarations, at }` for the ONE rule whose selector list contains exactly
 * this selector — parsed, not looked up as `${selector} {` text, so a formatter
 * that drops the space or wraps a long selector list cannot make a gate miss
 * (07-06 review, WR-08). `at` is the offset the rule opens at, which is how
 * source order is asserted below.
 *
 * Throws on a miss and on an ambiguity: a silent `''` would make every
 * assertion below pass against a file that no longer says anything of the kind.
 */
function rule(css: string, selector: string): { declarations: string; at: number } {
  const want = selector.trim().replace(/\s+/g, ' ');
  const hits = [...uncommented(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((block) =>
    block[1]
      .split(',')
      .map((sel) => sel.trim().replace(/\s+/g, ' '))
      .includes(want),
  );

  if (hits.length === 0) {
    throw new Error(`no rule for \`${want}\` — renamed or deleted?`);
  }
  if (hits.length > 1) {
    throw new Error(`${hits.length} rules for \`${want}\` — which one is the contract?`);
  }
  return { declarations: hits[0][2], at: hits[0].index ?? -1 };
}

/** A declaration's value, whitespace-normalised. `null` if the property is absent. */
function declaration(declarations: string, property: string): string | null {
  const match = declarations.match(new RegExp(`(?:^|;)\\s*${property}\\s*:([^;]*)`));
  return match ? match[1].trim().replace(/\s+/g, ' ') : null;
}

/** The breakpoint the wide layout starts at, named once. */
const WIDE_AT_RULE = '@media (min-width: 48rem)';

/** The breakpoint the phone-only overrides end at, named once (quick-260915-h2g). */
const PHONE_AT_RULE = '@media (max-width: 37.5rem)';

/**
 * Everything before the FIRST media block — the base layer every width reads.
 *
 * It was "everything before `@media (min-width: 48rem)`" while that was the
 * only block in the file. There are two now, the phone block is a `max-width`,
 * and a slice that stopped at the wide breakpoint alone would either swallow
 * the phone overrides or depend on which of the two a future edit puts first.
 * Both blocks live at the end of the stylesheet, which is what makes the first
 * `@media` the end of the base.
 */
function narrowBlock(css: string): string {
  const source = uncommented(css);
  const at = source.indexOf('@media');
  return at < 0 ? source : source.slice(0, at);
}

/**
 * The body of a media block (brace-balanced), named by its at-rule.
 *
 * `.marketing .callout` is declared twice — the base rule caps the box and the
 * wide rule pads it — and `rule()` throws on that ambiguity by design. (It was
 * `ul.tiers` until 17 Oct 2026, when the one-plan grid lost its wide rule.)
 * Splitting the file at the breakpoint lets each assertion name which of the
 * two it means instead of taking whichever came first in source order (the
 * `layout-contract.test.ts` `printBlock()` pattern). The header row is now the
 * same story across the base and the phone block.
 */
function mediaBlock(css: string, atRule: string): string {
  const source = uncommented(css);
  const start = source.indexOf(atRule);
  // Unguarded, `indexOf('{', -1)` clamps to 0 and this brace-matches the FIRST
  // rule in the file — every assertion over the block would then fail against
  // the wrong text, or a negative one pass outright (07-06 review, WR-06).
  if (start < 0) throw new Error(`no \`${atRule}\` block — renamed breakpoint?`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced braces after \`${atRule}\``);
}

/** The body of the `@media (min-width: 48rem)` block. */
function wideBlock(css: string): string {
  return mediaBlock(css, WIDE_AT_RULE);
}

/** The body of the `@media (max-width: 37.5rem)` block — the phone overrides. */
function phoneBlock(css: string): string {
  return mediaBlock(css, PHONE_AT_RULE);
}

describe('a link that is a button is painted as a button (G-09-2)', () => {
  it('gives the primary button label the token that pairs with its background', () => {
    const button = rule(MARKETING_CSS, '.marketing a.button');

    expect(declaration(button.declarations, 'color')).toBe('var(--accent-fg)');
    // C-2: a button is a solid block, and an underline through it is not a cue,
    // it is a stripe.
    expect(declaration(button.declarations, 'text-decoration')).toBe('none');
  });

  it('gives the secondary button the Ink label of UI-SPEC C-3', () => {
    const secondary = rule(MARKETING_CSS, '.marketing a.button--secondary');

    expect(declaration(secondary.declarations, 'color')).toBe('var(--fg)');
    expect(declaration(secondary.declarations, 'text-decoration')).toBe('none');
  });

  it('puts both AFTER the prose rule, because that is what actually decides it', () => {
    const prose = rule(MARKETING_CSS, '.marketing a');
    const button = rule(MARKETING_CSS, '.marketing a.button');
    const secondary = rule(MARKETING_CSS, '.marketing a.button--secondary');

    // (0,1,2) beats (0,1,1), so this pair is belt and braces for the button —
    // but `a.button` and `a.button--secondary` are the SAME specificity, and a
    // secondary button carries both classes. Reorder these two and the Ink
    // label silently goes green again.
    expect(button.at).toBeGreaterThan(prose.at);
    expect(secondary.at).toBeGreaterThan(button.at);
  });

  it('leaves prose links green AND underlined — deleting that rule is not the fix', () => {
    const prose = rule(MARKETING_CSS, '.marketing a');

    expect(declaration(prose.declarations, 'color')).toBe('var(--accent)');
    // D-19: colour is never the only cue.
    expect(declaration(prose.declarations, 'text-decoration')).toBe('underline');
  });

  it('introduces no second green: the button rules use tokens, never a literal', () => {
    const button = rule(MARKETING_CSS, '.marketing a.button');
    const secondary = rule(MARKETING_CSS, '.marketing a.button--secondary');

    for (const declarations of [button.declarations, secondary.declarations]) {
      expect(declarations).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(declarations).not.toMatch(/rgb|hsl|oklch/i);
    }
  });
});

/**
 * The four sides of a `padding` (or `margin`) shorthand, expanded.
 *
 * The G-09-4 gate below is about ONE side of a box, and `padding: 18px 20px`
 * says nothing about the left edge until it is expanded — a test that matched
 * `/20px/` on the declaration would also fire on `18px 20px 0` meaning
 * something else entirely.
 */
function sides(value: string): { top: string; right: string; bottom: string; left: string } {
  const parts = value.split(/\s+/).filter(Boolean);
  const [top, right = top, bottom = top, left = right] = parts;

  return { top, right, bottom, left };
}

/** A length that is zero, in any of the spellings CSS accepts for it. */
function isZero(value: string | undefined): boolean {
  return value !== undefined && /^0(px|rem|em|%)?$/.test(value);
}

/** `.tsx` with JSX, block and line comments removed — a comment naming the old
    markup must not be what fails a negative gate (the layout-contract rule). */
function uncommentedTsx(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/* ------------------------------------------------------------------------- *
 * ONE LEFT EDGE (G-09-4, UAT 10 Sep 2026)
 *
 * Measured live at 1440px, the page had THREE left edges: the header and the
 * footer at x=20 (their own 20px padding, no container), every section at
 * x=228 (`.wrap`: 64rem, auto margins, 20px padding), and the hero at x=417
 * (`class="wrap measure"` on ONE element, so `.measure`'s 38em cap combined
 * with `.wrap`'s auto margins and the hero centred itself independently).
 *
 * Three rules, each defensible alone. What follows pins the three facts that
 * make them agree: the gutter belongs to `.wrap` and to nothing else, the
 * measure nests inside the container rather than replacing it, and the markup
 * never puts the two classes back on one element.
 * ------------------------------------------------------------------------- */

describe('the page has ONE left edge, and it is the container\'s (G-09-4)', () => {
  it('keeps the gutter, the cap and the centring together on .wrap', () => {
    const wrap = rule(MARKETING_CSS, '.marketing .wrap');

    expect(declaration(wrap.declarations, 'max-width')).toBe('64rem');
    expect(declaration(wrap.declarations, 'margin')).toBe('0 auto');
    // The gutter every surface now shares. A page whose header gutters itself
    // is a page with two left margins, which is what UAT found.
    expect(sides(declaration(wrap.declarations, 'padding') ?? '').left).toBe('20px');
  });

  it('leaves the measure LEFT-ALIGNED — it caps a width, it does not centre a box', () => {
    const measure = rule(MARKETING_CSS, '.marketing .measure');

    expect(declaration(measure.declarations, 'max-width')).toBe('38em');
    expect(declaration(measure.declarations, 'margin-left')).toBe('0');
    // The regression in one line: `margin: 0 auto` here would re-centre every
    // measured block and put the hero back where UAT found it, at x=417.
    expect(declaration(measure.declarations, 'margin') ?? '').not.toMatch(/auto/);
    expect(declaration(measure.declarations, 'margin-right') ?? '').not.toMatch(/auto/);
  });

  it.each([
    ['.marketing .site-header', 'header'],
    ['.marketing .site-footer', 'footer'],
  ])('gives %s NO horizontal padding of its own — the bar is full width', (selector) => {
    const bar = rule(MARKETING_CSS, selector);
    const padding = sides(declaration(bar.declarations, 'padding') ?? '');

    // Vertical padding is theirs to keep (the header's is the wordmark's clear
    // space, the footer's is the space above the small print); horizontal
    // padding here is the second left margin.
    expect(isZero(padding.left), `padding-left: ${padding.left}`).toBe(true);
    expect(isZero(padding.right), `padding-right: ${padding.right}`).toBe(true);
    expect(declaration(bar.declarations, 'padding-left')).toBeNull();
    expect(declaration(bar.declarations, 'padding-right')).toBeNull();
    expect(declaration(bar.declarations, 'padding-inline')).toBeNull();
  });

  it('keeps the header a ROW — the layout moved to the container, it did not vanish', () => {
    // Deleting the flex would also remove the second left margin, and would
    // stack the lockup above the nav link on every page. The bar keeps the
    // border, the background and the 64px; the container keeps the row.
    const bar = rule(MARKETING_CSS, '.marketing .site-header');
    // From the base layer: the row is declared again in the phone block, where
    // it is allowed to wrap, and `rule()` refuses to guess between the two.
    const row = rule(narrowBlock(MARKETING_CSS), '.marketing .site-header .wrap');

    expect(declaration(bar.declarations, 'min-height')).toBe('64px');
    expect(declaration(bar.declarations, 'border-bottom')).toBe('1px solid var(--line)');
    expect(declaration(row.declarations, 'display')).toBe('flex');
    expect(declaration(row.declarations, 'justify-content')).toBe('space-between');
    expect(declaration(row.declarations, 'align-items')).toBe('center');
  });

  it('puts the container INSIDE the header and the footer, exactly once each', () => {
    const layout = uncommentedTsx(readFileSync('src/app/(marketing)/layout.tsx', 'utf8'));
    const header = layout.slice(layout.indexOf('<header'), layout.indexOf('</header>'));
    const footer = layout.slice(layout.indexOf('<footer'), layout.indexOf('</footer>'));

    expect(header).toContain('<div className="wrap">');
    expect(footer).toContain('<div className="wrap">');
    expect(layout.match(/<div className="wrap">/g)).toHaveLength(2);
  });

  it('never puts the two classes back on ONE element, on any public page', () => {
    // The hero, `/audit`, `/audit/thanks` and `/privacy` all carried
    // `className="wrap measure"`, and every one of them centred itself. The
    // walk is over the whole route group rather than a list of four files, so a
    // fifth public page cannot ship with the bug the other four just lost.
    const offenders = MARKETING_TSX.filter((path) =>
      /className="wrap measure"/.test(uncommentedTsx(readFileSync(path, 'utf8'))),
    );

    expect(offenders).toEqual([]);
    // A walk that found no files would pass the assertion above for the wrong
    // reason — a green test proving only that it read nothing.
    expect(MARKETING_TSX.length).toBeGreaterThan(4);
  });

  it('nests the measure inside a container wherever it is used', () => {
    // `.measure` no longer brings a gutter of its own, so a `.measure` with no
    // `.wrap` above it would sit flush against the viewport edge on a phone —
    // the opposite failure, and one a screenshot at 1440px would never show.
    const offenders = MARKETING_TSX.filter((path) => {
      const source = uncommentedTsx(readFileSync(path, 'utf8'));

      return (
        source.includes('className="measure"') && !source.includes('<div className="wrap">')
      );
    });

    expect(offenders).toEqual([]);
  });
});


/* ------------------------------------------------------------------------- *
 * THE PRICES SIT IN THE SAME COLUMN AS EVERYTHING ELSE (2026-09-11)
 *
 * `grid-template-columns: 1fr 1fr` was never the bug. Measured live at 1440px
 * the tracks computed to `480px 480px` — which IS `1fr 1fr`, of the whole
 * container: `.wrap` is 64rem with a 20px gutter (984px), less the 24px gap,
 * halved. Nothing capped the box the fractions were dividing, so while the
 * pricing section's heading, caption, founding-five `.callout` and terms all
 * stopped at the 38em measure (646px; right edge x=874 on a 1440px screen), the
 * card grid ran the full 984px and the right card overhung that edge by ~338px.
 *
 * A test that only asserted `1fr 1fr` would have passed on the broken page.
 * What these assert is the fact that actually decides it — the WIDTH the
 * fractions divide — and they assert it by comparing `.tiers` to its own
 * siblings rather than to a copy of the literal, because "the same column" is a
 * relationship between boxes, not a number that happens to appear three times.
 * ------------------------------------------------------------------------- */

describe('the pricing grid is capped at the shared reading measure', () => {
  it('caps .tiers at the SAME width as the measure and the callout beside it', () => {
    // All three read from the narrow half: `.marketing .callout` is ALSO named
    // in the wide block's padding rule, and `rule()` refuses an ambiguity
    // rather than guess which of the two carries the contract.
    const narrow = narrowBlock(MARKETING_CSS);
    const tiers = rule(narrow, '.marketing ul.tiers');
    const measure = rule(narrow, '.marketing .measure');
    const callout = rule(narrow, '.marketing .callout');

    expect(declaration(tiers.declarations, 'max-width')).toBe('38em');
    // The relationship, not the literal. `.callout` is the grid's next sibling
    // inside the same `.wrap`; equal caps on two left-aligned siblings is what
    // "the right edges line up" means in source. Retune the measure to 34em and
    // this fails until the grid is retuned with it, instead of silently letting
    // the prices drift back out of the column.
    expect(declaration(tiers.declarations, 'max-width')).toBe(
      declaration(measure.declarations, 'max-width'),
    );
    expect(declaration(tiers.declarations, 'max-width')).toBe(
      declaration(callout.declarations, 'max-width'),
    );
  });

  it('caps the grid WITHOUT centring it — same left edge, not a centred column', () => {
    const tiers = rule(narrowBlock(MARKETING_CSS), '.marketing ul.tiers');

    // G-09-4 in miniature: a capped box with auto margins centres itself inside
    // `.wrap` and the cards start ~169px right of the heading above them. The
    // grid keeps its bottom margin, so the gate reads the shorthand's sides.
    expect(declaration(tiers.declarations, 'margin') ?? '').not.toMatch(/auto/);
    expect(declaration(tiers.declarations, 'margin-left') ?? '').not.toMatch(/auto/);
    expect(declaration(tiers.declarations, 'margin-inline') ?? '').not.toMatch(/auto/);
    expect(sides(declaration(tiers.declarations, 'margin') ?? '').left).toBe('0');
  });

  it('keeps the ONE plan on one column at >= 48rem, filling the capped box', () => {
    // Moved 17 Oct 2026 (founder, quick 261017-s1c): one plan, Call Catcher.
    // This case pinned `1fr 1fr` while there were two cards. With one, that
    // track list would leave the card at (646 - 24) / 2 = 311px beside an
    // empty track, so the wide block now declares no track list for the grid
    // at all and the implicit single column fills the 38em cap. The cap and
    // the left edge are still pinned above, which is what keeps the one card
    // the same box as the `.callout` under it rather than a centred column.
    const wide = wideBlock(MARKETING_CSS);
    const hits = [...wide.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((block) =>
      block[1]
        .split(',')
        .map((sel) => sel.trim().replace(/\s+/g, ' '))
        .includes('.marketing ul.tiers'),
    );
    for (const hit of hits) {
      expect(declaration(hit[2], 'grid-template-columns')).toBeNull();
    }
    expect(uncommented(MARKETING_CSS)).not.toContain('1fr 1fr');
    // The card keeps the wide padding it shares with the callout.
    expect(declaration(rule(wide, '.marketing li.tier').declarations, 'padding')).toBe('24px');
  });

  it('leaves the phone on ONE column — the cap is inert there, the stack is not', () => {
    const tiers = rule(narrowBlock(MARKETING_CSS), '.marketing ul.tiers');

    // C-5: a plan whose "Included" cell is prose does not survive 390px as a
    // column. Below 48rem the grid must declare no track list at all, so the
    // implicit single column stands.
    expect(declaration(tiers.declarations, 'grid-template-columns')).toBeNull();
    expect(declaration(tiers.declarations, 'display')).toBe('grid');
  });

  it('states no fixed pixel track anywhere — 480px was computed, never written', () => {
    // The literal never appeared in this file; the number came out of the
    // engine. Pinning it as a negative gate is cheap, and the plausible "fix"
    // for a future overhang IS to hard-code a track — which would break the
    // phone and re-break the desktop at any other viewport.
    const source = uncommented(MARKETING_CSS);

    expect(source).not.toContain('480px');
    expect(source).not.toMatch(/grid-template-columns\s*:[^;]*\d+px/);
  });
});

/* ---------------------------------------------------------------------------
 * THE HEADER ON A PHONE (quick-260915-h2g)
 *
 * Cowork, 15 Sep 2026, on a 390px screen: the two header links stacked on the
 * right with the lockup floating between them. Both rules involved were
 * individually right — the row is `space-between` (G-09-4) and the nav wraps
 * (quick-260915-g92) — and together they wrapped in the wrong place. That is
 * the same shape of bug as the green-on-green button above, so it is pinned the
 * same way: by reading which block each declaration lives in.
 * ------------------------------------------------------------------------- */

describe('the header is two lines on a phone and one line above 600px', () => {
  it('gives the nav a line of its OWN below the breakpoint, left-aligned', () => {
    const phone = phoneBlock(MARKETING_CSS);
    const row = rule(phone, '.marketing .site-header .wrap');
    const nav = rule(phone, '.marketing .site-header nav');

    // Without `flex-wrap` the row cannot break at all; without the basis it
    // breaks inside the nav, which is the photograph.
    expect(declaration(row.declarations, 'flex-wrap')).toBe('wrap');
    expect(declaration(nav.declarations, 'flex-basis')).toBe('100%');
    expect(declaration(nav.declarations, 'justify-content')).toBe('flex-start');
  });

  it('leaves the desktop header exactly as it was — the base rule still ends right', () => {
    const base = narrowBlock(MARKETING_CSS);

    expect(
      declaration(rule(base, '.marketing .site-header .wrap').declarations, 'flex-wrap'),
    ).toBeNull();
    expect(
      declaration(rule(base, '.marketing .site-header nav').declarations, 'justify-content'),
    ).toBe('flex-end');
    // The wide block never mentioned the header and must not start to: one
    // breakpoint's worth of override is the whole change.
    expect(wideBlock(MARKETING_CSS)).not.toContain('site-header');
  });

  it('keeps the 44px tap target on both links at every width', () => {
    const link = rule(narrowBlock(MARKETING_CSS), '.marketing .site-header nav a');

    // D-19. The base rule is the only place the link's height is set, and the
    // phone block — where a bar that wants to be shorter would be tempted to
    // claw it back — never names the link at all, nor sets a height on either
    // of the two boxes above it.
    expect(declaration(link.declarations, 'min-height')).toBe('2.75rem');
    expect(phoneBlock(MARKETING_CSS)).not.toContain('site-header nav a');

    const phone = phoneBlock(MARKETING_CSS);

    for (const selector of ['.marketing .site-header .wrap', '.marketing .site-header nav']) {
      const { declarations } = rule(phone, selector);

      expect(declaration(declarations, 'height'), selector).toBeNull();
      expect(declaration(declarations, 'min-height'), selector).toBeNull();
      expect(declaration(declarations, 'max-height'), selector).toBeNull();
    }
  });
});
