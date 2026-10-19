/**
 * THE HOW-TO PAGE PUBLISHES DOCUMENTED STEPS, AND NOTHING ELSE (LAND-05).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ This page asks a stranger to go into their own ServiceM8 account and     │
 * │ hand over their customer list. Two things make that reasonable, and both │
 * │ are pinned here: the steps are short enough to follow standing up (two   │
 * │ lists, five steps each), and the sentence that says what we look at and  │
 * │ when we delete it is the sentence marketing approved, word for word, on  │
 * │ BOTH the page and the confirmation a prospect has just landed on.        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The negative assertion is the load-bearing one. The console calls the key a
 * "read-only API key"; the founder verified on 2026-09-12 that the access level is set at creation, so that
 * claim may not be made to a stranger until the founder has seen the screen.
 * A future edit that pastes the console's wording onto the public page fails
 * here rather than in front of a prospect.
 *
 * Structural over the two page sources and value-level over the copy, in the
 * shape `tests/privacy-page.test.ts` set: a `.tsx` module cannot be imported
 * without React, and what matters about these pages is that they render THESE
 * values, from that one module, rather than sentences of their own.
 *
 * PURE. Runs bare (`npx vitest run tests/howto-page.test.ts`), with NO
 * ALLOW_REMOTE_TESTS.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { CONTACT_EMAIL } from '../src/core/brand';
import { HOWTO_COPY, METADATA_COPY } from '../src/app/(marketing)/copy';

/**
 * Source with its comments removed, as in `tests/marketing-copy.test.ts`.
 *
 * A doc comment that explains the markup ("two `<ol>` lists") must not be the
 * thing that satisfies, or breaks, a count of the markup. A heuristic, not a
 * parser, and it is enough: every assertion below reads code, not prose.
 */
function uncommented(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/^\s*\/\/.*$/gm, '');
}

const HOWTO_PAGE = uncommented(readFileSync('src/app/(marketing)/audit/how-to/page.tsx', 'utf8'));
const THANKS_PAGE = uncommented(readFileSync('src/app/(marketing)/audit/thanks/page.tsx', 'utf8'));
const SITEMAP = uncommented(readFileSync('src/app/sitemap.ts', 'utf8'));
const FORM_PAGE = uncommented(readFileSync('src/app/(marketing)/audit/form.tsx', 'utf8'));
const LANDING_PAGE = uncommented(readFileSync('src/app/(marketing)/page.tsx', 'utf8'));

/** Every sentence the page shows, flattened, for the presence checks. */
const TEXT = [
  HOWTO_COPY.h1,
  HOWTO_COPY.lede,
  ...HOWTO_COPY.options.flatMap((option) => [option.h2, ...option.steps, option.note]),
  HOWTO_COPY.sentence,
].join('\n');

describe('two lists, five steps each (copy request §3.2)', () => {
  it('offers exactly two ways, the key first', () => {
    // The order is the recommendation, and it matches the console's connect
    // flow: the key measures "never followed up", the export infers it.
    expect(HOWTO_COPY.options.map((option) => option.id)).toEqual(['api-key', 'job-list-export']);
  });

  it('keeps each list to five steps or fewer', () => {
    for (const option of HOWTO_COPY.options) {
      expect(option.steps.length, option.id).toBeLessThanOrEqual(5);
      expect(option.steps.length, option.id).toBeGreaterThan(0);
    }
  });

  it('renders each list as an ordered list, and only ordered lists', () => {
    expect(HOWTO_PAGE.split('<ol>').length - 1).toBe(1);
    expect(HOWTO_PAGE).toContain('option.steps.map');
    expect(HOWTO_PAGE).not.toContain('<ul');
  });

  it('drives every string from the one copy module (D-08)', () => {
    expect(HOWTO_PAGE).toContain("from '../../copy'");
    expect(HOWTO_PAGE).toContain('HOWTO_COPY');
    // No sentence of its own: a string literal in the markup is a string the
    // voice gate in `tests/marketing-copy.test.ts` never reads.
    expect(HOWTO_PAGE).not.toContain('Send the key or the file');
  });
});

describe('the steps name documented paths only (LAND-05 prohibition)', () => {
  it('tells the prospect the access level is chosen at creation (founder-verified 2026-09-12)', () => {
    const step = HOWTO_COPY.options[0].steps[3].toLowerCase();
    expect(step).toContain('read-only');
    expect(step).toContain('cannot be changed later');
    // Once on the page, in that step, and nowhere else.
    expect(TEXT.toLowerCase().split('read-only').length - 1).toBe(1);
  });

  it('claims no date filter on the export, and says what the audit reads instead', () => {
    const exportOption = HOWTO_COPY.options[1];

    expect(exportOption.steps.join('\n')).not.toMatch(/date|last 90 days|range/i);
    expect(exportOption.note).toContain('last 90 days');
  });

  it('walks the two paths ServiceM8 documents', () => {
    const keySteps = HOWTO_COPY.options[0].steps.join('\n');
    const exportSteps = HOWTO_COPY.options[1].steps.join('\n');

    expect(keySteps).toContain('Settings');
    expect(keySteps).toContain('API Keys');
    expect(exportSteps).toContain('ServiceM8 Add-ons');
    expect(exportSteps).toContain('Advanced Reporting Pack');
    expect(exportSteps).toContain('Reports');
    expect(exportSteps).toContain('Job List Export');
  });
});

describe('the approved sentence, once on each page', () => {
  const SENTENCE =
    `Send the key or the file to ${CONTACT_EMAIL} or reply to Hesam's text. ` +
    'Backdesk sees quotes, job statuses and the customer details on those quotes. ' +
    "Nothing else. If you don't go ahead, we delete it after 30 days.";

  it('is the marketing wording byte for byte, with the address from the brand module', () => {
    expect(HOWTO_COPY.sentence).toBe(SENTENCE);
    expect(HOWTO_COPY.sentence).toContain(CONTACT_EMAIL);
  });

  it('is rendered once on the how-to page and once on the confirmation', () => {
    expect(HOWTO_PAGE.split('HOWTO_COPY.sentence').length - 1).toBe(1);
    expect(THANKS_PAGE.split('HOWTO_COPY.sentence').length - 1).toBe(1);
  });
});

describe('the confirmation carries the same block (copy request §3.3)', () => {
  it('renders the same two lists from the same object, not a second copy', () => {
    expect(THANKS_PAGE).toContain('HOWTO_COPY.options.map');
    expect(THANKS_PAGE).toContain('option.steps.map');
    expect(THANKS_PAGE).toContain("from '../../copy'");
  });

  it('links to the page for anyone who wants it on its own', () => {
    expect(THANKS_PAGE).toContain('href="/audit/how-to"');
    expect(THANKS_PAGE).toContain('HOWTO_COPY.thanksLink');
  });

  it('keeps its headings in level order under the one h1 (D-19)', () => {
    // h1 "Thanks, we've got it." > h2 the block > h3 each option. A page that
    // skips a level is a page a screen reader cannot outline.
    expect(THANKS_PAGE.split('<h1').length - 1).toBe(1);
    expect(THANKS_PAGE.split('<h2').length - 1).toBe(1);
    expect(THANKS_PAGE.split('<h3').length - 1).toBe(1);
  });
});

describe('the page is findable and titled (D-18)', () => {
  it('has its own title and description, and renders them', () => {
    expect(METADATA_COPY.howTo.title).toBe('How to send your ServiceM8 data');
    expect(METADATA_COPY.howTo.description.length).toBeGreaterThan(60);
    expect(HOWTO_PAGE).toContain('METADATA_COPY.howTo.title');
    expect(HOWTO_PAGE).toContain('METADATA_COPY.howTo.description');
  });

  it('is in the sitemap, and is indexable', () => {
    expect(SITEMAP.split("'/audit/how-to'").length - 1).toBe(1);
    // The confirmation is `noindex`; this page is the opposite, on purpose.
    expect(HOWTO_PAGE).not.toContain('index: false');
    expect(HOWTO_PAGE).toContain("canonical: '/audit/how-to'");
  });

  it('renders one h1 and two h2, and sends a reader back to the form', () => {
    expect(HOWTO_PAGE.split('<h1').length - 1).toBe(1);
    expect(HOWTO_PAGE.split('<h2').length - 1).toBe(1);
    expect(HOWTO_PAGE).toContain('href="/audit"');
  });

  it('adds no nav item, no script and no dependency (LAND-01 prohibition)', () => {
    expect(HOWTO_PAGE).not.toContain('<script');
    expect(HOWTO_PAGE).not.toContain("'use client'");
    expect(HOWTO_PAGE).toContain('className="measure"');
    expect(HOWTO_PAGE).toContain('className="wrap"');
  });

  it('links to the how-to from the audit form and the landing page', () => {
    expect(FORM_PAGE).toContain('href="/audit/how-to"');
    expect(LANDING_PAGE).toContain('href="/audit/how-to"');
  });
});
