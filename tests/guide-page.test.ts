/**
 * THE GUIDE PAGE PUBLISHES VERIFIED STEPS, ONE BUTTON, AND NOTHING YET (M7).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ This page describes ANOTHER COMPANY'S product in detail and names it in  │
 * │ the title. Two facts make that safe, and both are pinned here: the menu  │
 * │ path is one ServiceM8 documents in public, and the three merge fields —  │
 * │ which ServiceM8's docs never print — live in ONE map, unverified, and    │
 * │ hold the whole page behind `notFound()` until the founder has read the   │
 * │ template editor with his own eyes (LAND-05).                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The other half of the suite is the shape marketing approved: the M7 copy
 * verbatim, exactly one button and it is at the bottom, no link to
 * `/audit/how-to` (that page assumes a conversation already happened), and the
 * disclaimer with a real date whenever the flag is on.
 *
 * Structural over the page source and value-level over the copy, in the shape
 * `tests/howto-page.test.ts` set: a `.tsx` module cannot be imported without
 * React, and what matters about this page is that it renders THESE values, from
 * that one module, rather than sentences of its own.
 *
 * PURE. Runs bare (`npx vitest run tests/guide-page.test.ts`), with NO
 * ALLOW_REMOTE_TESTS.
 */
import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GUIDE_COPY,
  GUIDE_PUBLISHED,
  GUIDE_PUBLISHED_ON,
  MERGE_FIELDS,
  METADATA_COPY,
  guideDisclaimer,
  guideIsPublished,
} from '../src/app/(marketing)/copy';

const COPY_PATH = 'src/app/(marketing)/copy.ts';
const PAGE_PATH = 'src/app/(marketing)/guides/servicem8-quote-follow-up/page.tsx';

/**
 * Comments stripped, as in `tests/howto-page.test.ts` — a doc comment that
 * names the markup, or quotes the merge-field cheatsheet, must never be what
 * satisfies or breaks a gate about the code.
 *
 * Block comments go first and JSX comments fall out with them (`{/* x *\/}`
 * leaves an inert `{}`). Matching `{`-then-comment as one unit looks tidier and
 * is a trap: the opening brace of a function whose first line is a comment also
 * matches, and the sweep then runs to the first `*\/}` in the JSX below.
 */
function uncommented(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/^\s*\/\/.*$/gm, '');
}

const PAGE = uncommented(readFileSync(PAGE_PATH, 'utf8'));
const COPY_SOURCE = uncommented(readFileSync(COPY_PATH, 'utf8'));
const LAYOUT = uncommented(readFileSync('src/app/(marketing)/layout.tsx', 'utf8'));

/** Every sentence the guide shows, flattened. */
function leaves(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(leaves);
  if (value && typeof value === 'object') return Object.values(value).flatMap(leaves);
  return [];
}

const GUIDE_TEXT = leaves(GUIDE_COPY).join('\n');

describe('the M7 copy, as approved (15 September 2026)', () => {
  it('carries the head the request specified, with the name printed once', () => {
    // The root layout appends ` · Backdesk` to every non-absolute title, so the
    // requested `<title>` is this plus that suffix and not a second spelling.
    expect(`${METADATA_COPY.guide.title} · Backdesk`).toBe(
      'How to set up quote follow-ups in ServiceM8 · Backdesk',
    );
    expect(METADATA_COPY.guide.description).toBe(
      'ServiceM8 can chase your quotes for you, free, on every plan. Here is how to turn it on, what to write in each message, and where it stops helping.',
    );
    expect(GUIDE_COPY.h1).toBe('How to set up quote follow-ups in ServiceM8');
  });

  it('opens on the sentence that gives the tool away, before it sells anything', () => {
    expect(GUIDE_COPY.intro[0]).toBe(
      'ServiceM8 will chase your quotes for you. It is free, it is on every plan, and most Perth trade businesses we look at have never switched it on.',
    );
    expect(GUIDE_COPY.intro[2]).toBe(
      'We run a quote-chasing service, so you would expect us to tell you the built-in tool is no good. It is good. Use it.',
    );
  });

  it('walks the menu path ServiceM8 documents, without the forbidden word', () => {
    const steps = GUIDE_COPY.turningOn.steps;

    // Verified 15 Sep 2026 against help-centre articles 212550866 and 214222743.
    expect(steps[1]).toContain('Settings > ServiceM8 Add-ons');
    expect(steps[1]).toContain('Automation');
    expect(steps[2]).toBe('Go to Settings > Automation.');
    expect(steps[3]).toBe('Find Quote Follow Up and click Edit.');
    // The M7 draft said "open the ServiceM8 Online Dashboard". "Dashboard" is a
    // pinned forbidden word on this site, and the step loses nothing: what it
    // means is that this is not done from the phone app.
    expect(steps[0]).toBe('On a computer, open ServiceM8.');
    expect(GUIDE_TEXT).not.toMatch(/dashboard/i);
  });

  it('prints the five-row schedule exactly', () => {
    expect(GUIDE_COPY.schedule.columns).toEqual(['#', 'When', 'Channel', 'Job of the message']);
    expect(GUIDE_COPY.schedule.rows).toEqual([
      ['1', '2 hours after sending', 'SMS', 'Confirm it arrived and landed in the right inbox'],
      ['2', 'Day 3', 'Email', 'Offer to walk them through it'],
      ['3', 'Day 7', 'SMS', 'Ask one question that is easy to answer'],
      ['4', 'Day 14', 'Email', 'Open the door on scope or timing'],
      ['5', 'Day 21', 'SMS', 'Close the loop, politely'],
    ]);
  });

  it('keeps the four things the tool does NOT do, in the reader-first order', () => {
    expect(GUIDE_COPY.limits.items.map((item) => item.lead)).toEqual([
      'It only applies from the day you switch it on.',
      'It sends the template, whatever the situation.',
      'It does not handle the reply.',
      'It cannot tell you what it was worth.',
    ]);
    // The honest close. Without it the section reads as a hit piece on the tool
    // the page has just told the reader to use.
    expect(GUIDE_COPY.limits.closing).toBe(
      'None of that is a criticism of ServiceM8. It is a scheduler, and it is a good one. Those four things are just work, and the work still belongs to someone.',
    );
  });

  it('lists the five cancel conditions that quietly stop the sequence', () => {
    expect(GUIDE_COPY.settings.cancels).toHaveLength(5);
    expect(GUIDE_COPY.settings.cancels[0]).toBe(
      'The customer replies, and you have not yet responded to or dismissed that reply. The sequence stays paused until you do.',
    );
    expect(GUIDE_COPY.settings.cancels[2]).toContain('Work Order, Completed or Unsuccessful');
  });
});

describe('the five templates render from the ONE merge-field map (FOUNDER-VERIFY)', () => {
  const TEMPLATES = GUIDE_COPY.write.templates;

  it('captions them the way the copy heads them', () => {
    expect(
      TEMPLATES.map((template) => `${template.n}. ${template.when}, ${template.channel}`),
    ).toEqual([
      '1. Two hours, SMS',
      '2. Day 3, email',
      '3. Day 7, SMS',
      '4. Day 14, email',
      '5. Day 21, SMS',
    ]);
  });

  it('substitutes the fields into the first line of every message', () => {
    expect(TEMPLATES[0].lines[0]).toBe(
      `Hi ${MERGE_FIELDS.name}, [your business] here. Just sent through the quote for ${MERGE_FIELDS.job} to your email. Give us a yell if it hasn't turned up or if anything on it doesn't make sense.`,
    );
    expect(TEMPLATES[1].lines[0]).toBe(`Hi ${MERGE_FIELDS.name},`);
    expect(TEMPLATES[1].lines[1]).toBe(
      `Just checking you got the quote for ${MERGE_FIELDS.job} on ${MERGE_FIELDS.date}.`,
    );
    expect(TEMPLATES[2].lines[0]).toBe(
      `Hi ${MERGE_FIELDS.name}, [your business]. Any thoughts on the quote? Even a "not yet" is useful, it just tells me whether to hold the spot in the calendar.`,
    );
    expect(TEMPLATES[3].lines[0]).toBe(`Hi ${MERGE_FIELDS.name},`);
    expect(TEMPLATES[3].lines[1]).toBe(`Following up on the quote for ${MERGE_FIELDS.job}.`);
    expect(TEMPLATES[4].lines[0]).toBe(
      `Hi ${MERGE_FIELDS.name}, last one from me on that quote. If the timing is off, tell me when to come back and I will. Otherwise all the best with it.`,
    );
  });

  it('leaves the reader their own words, and none of the draft placeholders', () => {
    const bodies = TEMPLATES.flatMap((template) => template.lines).join('\n');

    // `[your business]` and `[your name]` are not merge fields; they are what a
    // tradesperson types in. `[name]`, `[job]` and `[date]` were the M7 draft's
    // placeholders and must not survive into anything a reader pastes.
    expect(bodies).toContain('[your business]');
    expect(bodies).toContain('[your name]');
    expect(bodies).not.toContain('[name]');
    expect(bodies).not.toContain('[job]');
    expect(bodies).not.toContain('[date]');
  });

  it('spells the brace syntax in MERGE_FIELDS and NOWHERE else', () => {
    // The founder's correction has to be one edit. Three literals, all three
    // inside the one map: a fourth anywhere in this file is a second place the
    // unverified syntax would survive a correction.
    const braces = COPY_SOURCE.match(/\{(?:recipient_[a-z]+|(?:job|vendor|calculation)\.[a-z_]+)\}/g) ?? [];
    expect(braces).toEqual(['{recipient_first}', '{job.description}', '{job.quote_date}']);

    const map = COPY_SOURCE.slice(
      COPY_SOURCE.indexOf('export const MERGE_FIELDS = {'),
      COPY_SOURCE.indexOf('export const GUIDE_COPY'),
    );
    for (const brace of braces) {
      expect(map).toContain(brace);
    }

    // And the page itself types none of them: it renders what the map holds.
    expect(PAGE).not.toMatch(/\{(?:job|vendor|calculation)\.[a-z_]+\}/);
    expect(PAGE).toContain('template.lines.join');
  });
});

describe('the publish gate: the page went live only by a deliberate edit (LAND-05)', () => {
  it('is published as of 15 Sep 2026, after the founder read the editor', () => {
    // THIS ASSERTION IS MEANT TO BE EDITED BY THE PUBLISH COMMIT, together with
    // the flag, the date and any correction to MERGE_FIELDS. That is the point:
    // publishing a page that describes someone else's menus is a deliberate act
    // with a human in it, never a stray `true`.
    // Published 2026-09-15 after the founder verified the merge fields.
    expect(GUIDE_PUBLISHED).toBe(true);
    expect(GUIDE_PUBLISHED_ON).toBe('2026-09-15');
    expect(guideIsPublished()).toBe(true);
  });

  it('never reports published without a date for the disclaimer', () => {
    expect(COPY_SOURCE).toContain('return GUIDE_PUBLISHED && GUIDE_PUBLISHED_ON !== null;');
    expect(guideIsPublished()).toBe(GUIDE_PUBLISHED && GUIDE_PUBLISHED_ON !== null);
  });

  it('404s the route from that one predicate', () => {
    expect(PAGE).toContain("import { notFound } from 'next/navigation';");
    expect(PAGE).toContain('if (!guideIsPublished() || publishedOn === null) notFound();');
    // Before anything is rendered: the guard is the first statement of the body.
    expect(PAGE.indexOf('notFound()')).toBeLessThan(PAGE.indexOf('<section>'));
  });

  it('renders the disclaimer verbatim, with a real date, when it is published', () => {
    expect(guideDisclaimer('2026-09-15')).toBe(
      'Backdesk is independent and is not affiliated with ServiceM8. Setup steps were accurate as at 15 September 2026; ServiceM8 changes its interface from time to time, so check against the app.',
    );
    // Perth, not UTC and not the build machine: a date rendered a day early on
    // an American server is a date that contradicts the commit that set it.
    expect(COPY_SOURCE).toContain("timeZone: 'Australia/Perth'");
    expect(PAGE).toContain('guideDisclaimer(publishedOn)');
    expect(PAGE).toContain('className="disclaimer"');
  });
});

describe('the sitemap follows the same flag, never a second spelling of it', () => {
  afterEach(() => {
    vi.doUnmock('../src/app/(marketing)/copy');
    vi.resetModules();
  });

  it('omits the guide when the flag says unpublished', async () => {
    vi.resetModules();
    vi.doMock('../src/app/(marketing)/copy', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../src/app/(marketing)/copy')>()),
      guideIsPublished: () => false,
    }));
    const { default: sitemap } = await import('../src/app/sitemap');

    expect(sitemap().map((entry) => entry.url).join(' ')).not.toContain('/guides/');
  });

  it('lists it now that the flag says published (15 Sep 2026)', async () => {
    vi.resetModules();
    const { default: sitemap } = await import('../src/app/sitemap');

    expect(sitemap().map((entry) => entry.url)).toEqual([
      'https://backdesk.com.au/',
      'https://backdesk.com.au/audit',
      'https://backdesk.com.au/audit/how-to',
      'https://backdesk.com.au/privacy',
      'https://backdesk.com.au/guides/servicem8-quote-follow-up',
    ]);
  });
});

describe('one button, at the bottom, and no link back to the how-to (request §2, §3)', () => {
  it('renders exactly one button, and it is the free audit', () => {
    expect(PAGE.split('className="button').length - 1).toBe(1);
    expect(GUIDE_COPY.cta).toEqual({ label: 'Get the free audit', href: '/audit' });
    expect(PAGE).toContain('href={cta.href}');
  });

  it('puts it after every word of the guide, and before only the disclaimer', () => {
    // No sticky bar, no mid-page call to action, no pop-up: the page earns the
    // click by being useful first, and interrupting it defeats the point.
    expect(PAGE.indexOf('className="button')).toBeGreaterThan(PAGE.indexOf('pitch.paragraphs'));
    expect(PAGE.indexOf('className="button')).toBeLessThan(PAGE.indexOf('className="disclaimer"'));
  });

  it('never links to /audit/how-to, from the page or from the copy', () => {
    // That page assumes a conversation already happened. Cross-linking is one
    // way only, and this is the direction that must stay closed.
    expect(PAGE).not.toContain('/audit/how-to');
    expect(GUIDE_TEXT).not.toContain('/audit/how-to');
  });
});

describe('the page is the layout, the measure and the one copy module (LAND-01)', () => {
  it('drives every string from ../../copy', () => {
    expect(PAGE).toContain("from '../../copy'");
    expect(PAGE).toContain('GUIDE_COPY');
    // No sentence of its own: a literal here is a string the voice gate in
    // `tests/marketing-copy.test.ts` never reads.
    expect(PAGE).not.toContain('ServiceM8 will chase your quotes');
  });

  it('adds no image, no script, no client component and no dependency', () => {
    expect(PAGE).not.toContain('<img');
    expect(PAGE).not.toContain('<script');
    expect(PAGE).not.toContain("'use client'");
    expect(PAGE).toContain('className="wrap"');
    expect(PAGE).toContain('className="measure guide"');
  });

  it('is indexable, canonical and titled from the metadata module (D-18)', () => {
    expect(PAGE).toContain("canonical: '/guides/servicem8-quote-follow-up'");
    expect(PAGE).toContain('METADATA_COPY.guide.title');
    expect(PAGE).toContain('METADATA_COPY.guide.description');
    expect(PAGE).not.toContain('index: false');
  });

  it('renders one h1 and the seven h2 of the M7 body, levels never skipped (D-19)', () => {
    expect(PAGE.split('<h1').length - 1).toBe(1);
    expect(PAGE.split('<h2>').length - 1).toBe(7);
    expect(PAGE).not.toContain('<h3');
  });

  it('wraps the schedule table in its own scroller, reachable by keyboard', () => {
    // G-07-6 / WCAG 2.1.1, the console's own convention: an `overflow-x: auto`
    // box with nothing focusable in it cannot be scrolled without a pointer,
    // and the columns it hides are the ones it exists to hide.
    expect(PAGE).toContain('className="table-scroll" tabIndex={0} role="region"');
    expect(PAGE).toContain('aria-label={schedule.h2}');
    expect(PAGE.indexOf('table-scroll')).toBeLessThan(PAGE.indexOf('<table>'));
  });

  it('turns that table into a LIST under 600px, from the same markup (h2g)', () => {
    // Cowork, 15 Sep 2026: at 390px the schedule scrolled sideways behind a
    // hairline affordance nobody noticed, and the fourth column read "JOB OF
    // THE MESS…". The fix is CSS plus one attribute — no second table, no
    // hamburger, no script, no dependency (LAND-01) — so the two shapes cannot
    // say different things.
    const css = readFileSync('src/app/(marketing)/marketing.css', 'utf8');
    const phoneAt = css.indexOf('@media (max-width: 37.5rem)');

    expect(phoneAt).toBeGreaterThan(-1);

    const phone = css.slice(phoneAt);
    const base = css.slice(0, css.indexOf('@media'));

    // The label IS the column header, read from the copy module. A literal
    // here is the drift this test exists to prevent.
    expect(PAGE).toContain('data-label={schedule.columns[index + 1]}');
    expect(PAGE).not.toMatch(/data-label="/);
    // Every value cell carries one; the number is the block's heading and is a
    // `<th>`, which is why the labels start at the second column.
    expect(PAGE.split('<td').length - 1).toBe(PAGE.split('data-label=').length - 1);
    expect(PAGE).toContain('<th scope="row">{row[0]}</th>');

    expect(phone).toContain('content: attr(data-label);');
    expect(phone).toMatch(/\.marketing \.guide \.table-scroll \{[^}]*overflow: visible;/);
    // Clipped, not removed: `display: none` would take the column names from a
    // screen reader as well, and they are what says which value is which.
    expect(phone).toMatch(/\.marketing \.guide thead \{[^}]*clip-path: inset\(50%\);/);
    expect(phone).not.toMatch(/thead \{[^}]*display: none/);

    // Above the breakpoint nothing moved: still a table, still in its scroller,
    // and the generated label never appears outside the phone block.
    expect(base).toMatch(/\.marketing \.table-scroll \{[^}]*overflow-x: auto;/);
    expect(base).not.toContain('attr(data-label)');

    const baseTable = base.slice(base.indexOf('.marketing .guide table {'));

    expect(baseTable.slice(0, baseTable.indexOf('}'))).not.toContain('display');
  });

  it('makes each message a block whose text selects as one unit', () => {
    const css = readFileSync('src/app/(marketing)/marketing.css', 'utf8');

    expect(PAGE.split('className="template"').length - 1).toBe(1);
    expect(PAGE).toContain('write.templates.map');
    expect(css).toMatch(/\.marketing \.template pre \{[^}]*user-select: all;/);
    expect(css).toMatch(/\.marketing \.template pre \{[^}]*white-space: pre-wrap;/);
  });

  it('gives the guide the long-form measure and line height it was asked for', () => {
    const css = readFileSync('src/app/(marketing)/marketing.css', 'utf8');
    const guide = css.slice(css.indexOf('.marketing .guide {'));
    const declarations = guide.slice(0, guide.indexOf('}'));

    // The same 38em cap as `.measure`, `.callout` and `ul.tiers`: the guide's
    // left and right edges are the site's, and 1.65 is what makes two thousand
    // words of it readable on a phone (request §2).
    expect(declarations).toContain('max-width: 38em;');
    expect(declarations).toContain('line-height: 1.65;');
  });

describe('the guide is reachable from every public page (quick-260915-g92)', () => {
  it('links to the guide from the site header and footer', () => {
    expect(LAYOUT.split('href="/guides/servicem8-quote-follow-up"').length - 1).toBe(2);
  });
});
});
