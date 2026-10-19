/**
 * THE VOICE RULES, AS A TEST — because the landing page is regulated speech.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Every sentence a stranger reads before they trust us with their customer │
 * │ list lives in ONE module (D-08), and the rules D-09 binds it to are not  │
 * │ style preferences. "AI-powered", "platform", "guaranteed results" and a  │
 * │ competitor's name are each, in their own way, a claim the service either │
 * │ cannot keep or should not make; an em dash and an exclamation mark are   │
 * │ how copy stops sounding like the tradesperson it is written for.         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The suite walks EVERY string leaf of every export rather than a hand-listed
 * set of sentences: the 11 September Cowork copy request replaces this module
 * wholesale, and a gate that only checked the strings that existed on 9 Sep
 * would pass the replacement without reading it. That is the whole point of
 * putting the copy in one file — the file has a test, so the swap has a test.
 *
 * PURE. Reads the module and its source text, touches nothing else. Runs bare
 * (`npx vitest run tests/marketing-copy.test.ts`), with NO ALLOW_REMOTE_TESTS.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import * as COPY from '../src/app/(marketing)/copy';

/**
 * Source with its comments removed, for the negative matches only.
 *
 * `tests/layout-contract.test.ts` makes the same promise for the same reason: a
 * comment that names the thing it forbids ("no server directive here") must not
 * be the thing that fails the gate. A heuristic, not a parser.
 */
function uncommented(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/^\s*\/\/.*$/gm, '');
}

const SOURCE = uncommented(readFileSync('src/app/(marketing)/copy.ts', 'utf8'));
const PAGE = readFileSync('src/app/(marketing)/page.tsx', 'utf8');

/**
 * Every string in every export, flattened, with the path that reaches it.
 *
 * The path is carried so a failure names the sentence rather than the offence:
 * "LANDING_COPY.guarantee.body" is a thing an author can open, "a leaf" is not.
 */
function leaves(value: unknown, path: string): Array<{ path: string; text: string }> {
  if (typeof value === 'string') return [{ path, text: value }];
  if (Array.isArray(value)) return value.flatMap((item, i) => leaves(item, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => leaves(child, `${path}.${key}`));
  }
  return [];
}

const LEAVES = Object.entries(COPY).flatMap(([name, value]) => leaves(value, name));
const ALL_TEXT = LEAVES.map((leaf) => leaf.text).join('\n');

/**
 * The D-09 / UI-SPEC forbidden list, copied into the test on purpose.
 *
 * Not imported from the module under test: a list the copy module owned would
 * be a list the copy module could quietly shorten. Word-boundaried and
 * case-insensitive, so "agreement" is not "agent" and "both" is not "bot".
 */
const FORBIDDEN = [
  'AI-powered',
  'automation',
  'agent',
  'bot',
  'assistant',
  'AI employee',
  'dashboard',
  'platform',
  'solution',
  'leverage',
  'unlock',
  'seamless',
  'supercharge',
  '10x',
  'game-changer',
  'revolutionary',
  'cutting-edge',
  'SMB',
  'business owner',
  'guaranteed results',
  'proven',
  // 'free trial' left this list on 17 Oct 2026: the founder named the
  // 30-day offer "Free Trial" on the site and the offer sheet. The rest of
  // D-09's voice rules stand.
  'demo',
  'discovery call',
  'strategy session',
  'average client sees',
];

describe('the copy module holds every public string, and nothing else (D-08)', () => {
  it('exports the landing, form, thanks, how-to, guide, privacy and metadata copy', () => {
    // The list is exhaustive on purpose: a new public string that arrives in a
    // module of its own is a string the voice gate below never reads. The
    // how-to page (260912-lwi) was added here rather than beside its page for
    // exactly that reason, and the guide (260915-ec0) followed it — including
    // its publish flag, its date and the one merge-field map, which belong with
    // the sentences they govern rather than beside the route.
    expect(Object.keys(COPY).sort()).toEqual([
      'AUDIT_FORM_COPY',
      'GUIDE_COPY',
      'GUIDE_PUBLISHED',
      'GUIDE_PUBLISHED_ON',
      'HOWTO_COPY',
      'LANDING_COPY',
      'MERGE_FIELDS',
      'METADATA_COPY',
      'PRIVACY_COPY',
      'THANKS_COPY',
      'guideDisclaimer',
      'guideIsPublished',
    ]);
  });

  it('has enough strings to be the whole site, not a stub', () => {
    expect(LEAVES.length).toBeGreaterThan(60);
  });

  it('is a plain module: no server directive, no framework, no database', () => {
    // The one-file swap is only cheap while this file is inert. A `'use server'`
    // here would make every sentence an entry point; a `@/db` import would make
    // the copy untestable without a database.
    expect(SOURCE).not.toContain("'use server'");
    expect(SOURCE).not.toMatch(/from '@\/db/);
    expect(SOURCE).not.toMatch(/from 'next\//);
  });
});

/**
 * THE ONE EXEMPTION, AND THE REASON IT IS NOT A LOOPHOLE (260915-ec0).
 *
 * The D-09 list governs how BACKDESK DESCRIBES ITSELF. `GUIDE_COPY` describes
 * somebody else's product: the ServiceM8 add-on a reader has to find in their
 * own Settings menu is literally named "Automation", and the guide's whole job
 * is to walk them to that menu item. A guide that will not print the name on
 * the button is a guide that sends a stranger looking for a screen that is not
 * there, which is the exact failure `/audit/how-to` exists to avoid.
 *
 * So: `automation`, in any case, inside `GUIDE_COPY` and nowhere else. Every
 * other word on the list still applies to the guide — "dashboard" in
 * particular, which is why the M7 draft's "open the ServiceM8 Online Dashboard"
 * is published as "On a computer, open ServiceM8." The narrowness is asserted
 * below, in both directions, so this cannot quietly widen.
 */
const EXEMPT_WORD = 'automation';
const EXEMPT_EXPORT = 'GUIDE_COPY';

/** Is this leaf the one place the one exempt word is allowed? */
function isExempt(word: string, path: string): boolean {
  return word.toLowerCase() === EXEMPT_WORD && path.startsWith(`${EXEMPT_EXPORT}.`);
}

describe('the D-09 voice rules hold over every string (LAND-01)', () => {
  it.each(FORBIDDEN)('says %s nowhere', (word) => {
    const pattern = new RegExp(`\\b${word.replaceAll('-', '[- ]')}\\b`, 'i');
    const offenders = LEAVES.filter(
      (leaf) => pattern.test(leaf.text) && !isExempt(word, leaf.path),
    ).map((leaf) => leaf.path);

    expect(offenders).toEqual([]);
  });

  it('exempts "automation" for the guide ONLY, and the exemption is not dead', () => {
    const pattern = /\bautomation\b/i;
    const saying = LEAVES.filter((leaf) => pattern.test(leaf.text)).map((leaf) => leaf.path);

    // Dead-exemption guard: if the guide stops naming the menu item, this
    // exemption should be deleted rather than left standing for the next page.
    expect(saying.length).toBeGreaterThan(0);
    // And every one of them is the guide. A second export that starts saying it
    // fails the `says %s nowhere` case above, not this one.
    expect(saying.filter((path) => !path.startsWith(`${EXEMPT_EXPORT}.`))).toEqual([]);
  });

  it('keeps "dashboard" forbidden INSIDE the guide too', () => {
    // The M7 draft said "open the ServiceM8 Online Dashboard". The exemption is
    // one word wide, so the published step had to be reworded, and this is what
    // says so out loud.
    const guide = LEAVES.filter((leaf) => leaf.path.startsWith(`${EXEMPT_EXPORT}.`));

    expect(guide.filter((leaf) => /\bdashboard\b/i.test(leaf.text))).toEqual([]);
    expect(guide.length).toBeGreaterThan(40);
  });

  it('never presents a dollar figure as a ceiling ("up to $X")', () => {
    // The transparency prohibition on LAND-01: every figure on the site is a
    // list price or a marked estimate. "Up to $12,000 recovered" is the sentence
    // this forbids, and the only real number a prospect sees is their own audit.
    expect(LEAVES.filter((leaf) => /up to \$/i.test(leaf.text))).toEqual([]);
  });

  it('names no other product: the only domain on the page is ours', () => {
    // A competitor list cannot be enumerated in a test, but naming one almost
    // always means printing its address. Ours is removed first, then anything
    // domain-shaped that is left is a name that should not be here.
    const withoutUs = ALL_TEXT.replaceAll('backdesk.com.au', '');

    expect(withoutUs).not.toMatch(/[a-z0-9-]+\.(com|com\.au|io|net|app)\b/i);
  });

  it('discloses the AI exactly once, in the locked phrase (D-09)', () => {
    const matches = ALL_TEXT.match(/Run by AI, checked by a human/g) ?? [];

    expect(matches).toHaveLength(1);
  });

  it('uses no em dash and no exclamation mark (M1 punctuation)', () => {
    const dashes = LEAVES.filter((leaf) => leaf.text.includes('—')).map((leaf) => leaf.path);
    const bangs = LEAVES.filter((leaf) => leaf.text.includes('!')).map((leaf) => leaf.path);

    expect(dashes).toEqual([]);
    expect(bangs).toEqual([]);
  });

  it('spells ServiceM8 and Backdesk exactly (M1)', () => {
    // Capital M, digit 8; one word, capital B. The lowercase spelling is legal
    // in exactly one place — the domain — so it is removed before the check.
    expect(ALL_TEXT.replaceAll('ServiceM8', '')).not.toMatch(/servicem8|service m8/i);
    expect(ALL_TEXT.replaceAll('backdesk.com.au', '').replaceAll('Backdesk', '')).not.toMatch(
      /backdesk/i,
    );
  });
});

describe('the offer is on the page, in the M2 numbers (LAND-01, D-09)', () => {
  // Moved 16 Oct 2026 (founder, quick 261016-k4p): Call Catcher $397 and Back
  // Desk $797 a month, no setup fee, first 30 days free ($0). The M2 figures
  // ($597, $997, $990 setup, $297 founding five) retired the same day.
  // Moved again 17 Oct 2026 (founder, quick 261017-s1c): one plan, Call
  // Catcher at $397, so $797 left this list for the retired one below.
  it.each(['$397', '$0'])('quotes %s', (figure) => {
    expect(ALL_TEXT).toContain(figure);
  });

  it.each([
    '$990',
    '$597',
    '$997',
    '$297',
    'Founding five',
    'Setup (once)',
    '$797',
    'Back Desk',
    'dormant',
    'invoice chasing',
    'review requests',
  ])(
    'no longer quotes the retired %s',
    (retired) => {
      // 16 Oct 2026: the setup fee and the founding-five offer were withdrawn
      // and the list prices moved. A stale figure left anywhere in the copy is
      // an offer the site is still making, so each one is held off by name.
      // 17 Oct 2026 (quick 261017-s1c): the Back Desk tier was removed, and
      // its extras (dormant backlog, invoice chasing, review requests) went
      // with it rather than being folded into Call Catcher.
      expect(ALL_TEXT).not.toContain(retired);
    },
  );

  it('states no setup fee and the free first 30 days, billing from day 31', () => {
    const { pricing } = COPY.LANDING_COPY;

    expect(pricing.tiers.map((tier) => tier.setup)).toEqual(['No setup fee.']);
    expect(pricing.trial.h3).toBe('Free Trial'); // renamed by the founder 17 Oct 2026
    expect(pricing.trial.figure).toBe('$0');
    expect(pricing.trial.body).toContain('30 days');
    expect(pricing.terms).toContain('from day 31');
    expect(pricing.terms).toContain('Prices exclude GST.');
  });

  it('carries the tagline, the quote line and the missed-call positioning', () => {
    // Moved 16 Oct 2026 (quick 261016-1xw, founder decision): the site leads
    // with missed-call text-back. The old positioning statement left with the
    // old lede; the M1 quote line survives as the lede's second sentence, and
    // the locked phrase and the 3× conditional stay in the lede.
    const { hero } = COPY.LANDING_COPY;

    expect(hero.h1).toBe('Every missed call texted back in seconds.');
    expect(hero.h1.toLowerCase()).toContain('missed call');
    expect(hero.lede).toContain('missed call');
    expect(hero.lede).toContain("until it's won or dead");
    expect(hero.lede).toContain('Run by AI, checked by a human, reported in dollars.');
    expect(hero.lede).toContain('3×');
  });

  it('welcomes emergency and after-hours trades, and still turns away lead generation', () => {
    // Added 16 Oct 2026: until the repositioning the fit paragraph turned away
    // "emergency-only trades". A trade that misses calls is now the best fit,
    // so the exclusion is gone and the lead-generation one is held in place.
    const { body } = COPY.LANDING_COPY.fit;

    expect(body).not.toMatch(/emergency-only/i);
    expect(body).toMatch(/Best fit:.*emergency/);
    expect(body).toContain('Not a fit: anyone wanting lead generation.');
    for (const fact of ['Perth', 'ServiceM8', 'owner-run']) {
      expect(body).toContain(fact);
    }
  });

  it('states the residency and the offshore processors on the landing page itself', () => {
    // LAND-05's prohibition is not satisfied by the privacy notice alone: the
    // sentence a prospect reads without clicking is the one that must be true.
    expect(ALL_TEXT).toContain('held in Sydney');
    expect(ALL_TEXT).toContain('process message content outside Australia');
    // 15-REVIEW WR-03: SMS goes through ClickSend, an Australian provider, so
    // the footer names email and AI as the offshore processors, not messaging.
    expect(COPY.LANDING_COPY.customers.residencyLead).toContain(
      'Email and AI providers process message content outside Australia.',
    );
    expect(ALL_TEXT).not.toContain('Messaging and AI providers');
  });

  it('lists four steps and one tier', () => {
    expect(COPY.LANDING_COPY.steps.items).toHaveLength(4);
    // 17 Oct 2026 (founder, quick 261017-s1c): one plan. Back Desk was
    // removed; Call Catcher is the whole offer.
    expect(COPY.LANDING_COPY.pricing.tiers).toHaveLength(1);
    // Tier names moved 16 Oct 2026 with the missed-call repositioning
    // (founder): "Quote Chaser" became "Call Catcher" and "Pipeline Manager"
    // became "Back Desk". Prices moved the same day (quick 261016-k4p):
    // $597/$997 became $397/$797 with no setup fee. The second tier left
    // the next day.
    expect(COPY.LANDING_COPY.pricing.tiers.map((tier) => tier.name)).toEqual(['Call Catcher']);
    expect(COPY.LANDING_COPY.pricing.tiers[0].included[0]).toMatch(/missed call/i);
    expect(COPY.LANDING_COPY.pricing.tiers.map((tier) => tier.price)).toEqual(['$397']);
    expect(COPY.LANDING_COPY.pricing.tiers.map((tier) => tier.setup)).toEqual(['No setup fee.']);
    // Step titles pinned 16 Oct 2026: missed-call text-back is step 3 and the
    // monthly report merged into step 4 so the scannable phrase survives.
    expect(COPY.LANDING_COPY.steps.items.map((item) => item.title)).toEqual([
      'Free Quote Leakage Audit',
      'Set up in 7 days',
      'Every missed call texted back',
      'Every open quote chased, reported in dollars',
    ]);
    expect(COPY.LANDING_COPY.pricing.tiers[0].included[0]).toContain('missed call');
  });
});

describe('the landing page renders the sections in the D-09 order', () => {
  const SECTIONS = [
    'hero',
    'how-it-works',
    'pricing',
    'guarantee',
    'your-customers',
    'good-fit',
    'how-to-start',
  ];

  it('places every section id in the page, once', () => {
    for (const id of SECTIONS) {
      expect(PAGE.split(`aria-labelledby="${id}-h"`)).toHaveLength(2);
    }
  });

  it('places them in ascending source order — the offer sheet laid out for a phone', () => {
    const positions = SECTIONS.map((id) => PAGE.indexOf(`aria-labelledby="${id}-h"`));

    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('renders one h1 and six h2 — heading levels never skip (D-19)', () => {
    expect(PAGE.split('<h1').length - 1).toBe(1);
    expect(PAGE.split('<h2').length - 1).toBe(6);
  });

  it('renders the one green action twice and nothing else green (D-04)', () => {
    // `.button--lg` IS the accent on this page: hero and closing section, the
    // same action rendered twice. A third occurrence is a second action.
    expect(PAGE.split('button button--lg').length - 1).toBe(2);
  });

  it('drives every string from the copy module', () => {
    expect(PAGE).toContain("from './copy'");
    expect(PAGE).toContain('LANDING_COPY');
  });

  it('reads no server environment — these pages prerender (T-9-26)', () => {
    for (const path of [
      'src/app/(marketing)/page.tsx',
      'src/app/(marketing)/layout.tsx',
      'src/app/(marketing)/copy.ts',
    ]) {
      expect(uncommented(readFileSync(path, 'utf8'))).not.toContain('getServerEnv');
    }
  });
});
