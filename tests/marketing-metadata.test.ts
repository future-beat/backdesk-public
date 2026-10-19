/**
 * WHAT A CRAWLER, A LINK PREVIEW AND A SEARCH RESULT SEE (D-18, LAND-06).
 *
 * Three separate promises, none of which any human on this project will ever
 * look at again once they are right:
 *
 *  1. The public pages carry a title, a description and a canonical, and `/`
 *     bypasses the root layout's title template so the name is printed once.
 *  2. The CONSOLE is not indexed. `robots.txt` disallows its paths, and the
 *     console layout, the login page and the post-submit confirmation each say
 *     `noindex` themselves — belt and braces, because a robots file is a
 *     request and a meta tag is an instruction (T-9-29).
 *  3. The sitemap lists the three public pages on the APEX, whatever host the
 *     page was rendered on.
 *
 * The metadata objects are IMPORTED rather than grepped: `robots: { index:
 * false }` and `robots: { follow: false }` look identical to a regex, and the
 * one that matters is a value.
 *
 * PURE. Runs bare, with NO ALLOW_REMOTE_TESTS.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import robots from '../src/app/robots';
import sitemap from '../src/app/sitemap';
import { ABN_DISPLAY, CONTACT_EMAIL, CONTACT_PHONE_DISPLAY, footerIdentityLine } from '../src/core/brand';
import { METADATA_COPY } from '../src/app/(marketing)/copy';
import { metadata as homeMetadata } from '../src/app/(marketing)/page';
import { metadata as auditMetadata } from '../src/app/(marketing)/audit/page';
import { metadata as thanksMetadata } from '../src/app/(marketing)/audit/thanks/page';
import { metadata as privacyMetadata } from '../src/app/(marketing)/privacy/page';
import { metadata as consoleMetadata } from '../src/app/(console)/layout';
import { metadata as loginMetadata } from '../src/app/login/page';

const APEX = 'https://backdesk.com.au';

describe('robots.txt lets the public site in and keeps the console out (D-18)', () => {
  const rules = robots();

  it('allows exactly the three public paths', () => {
    expect(rules.rules).toMatchObject({
      userAgent: '*',
      allow: ['/', '/audit', '/privacy'],
    });
  });

  // 2026-10-13 (Phase 15, 15-04): `/leads`, the lead queue, joins the list.
  it.each(['/login', '/inbox', '/queue', '/leads', '/audits', '/reports', '/clients', '/settings', '/api/'])(
    'disallows %s',
    (path) => {
      const disallow = (rules.rules as { disallow: string[] }).disallow;

      expect(disallow).toContain(path);
    },
  );

  it('points at the sitemap on the apex', () => {
    expect(rules.sitemap).toBe(`${APEX}/sitemap.xml`);
  });
});

describe('sitemap.xml lists the public pages, on the apex (D-18)', () => {
  const entries = sitemap();

  it('lists exactly five URLs', () => {
    // The how-to joined them on 12 Sep (260912-lwi): a page an owner searches
    // for again a week later, and forwards to whoever logs into ServiceM8.
    expect(entries.map((entry) => entry.url)).toEqual([
      `${APEX}/`,
      `${APEX}/audit`,
      `${APEX}/audit/how-to`,
      `${APEX}/privacy`,
      `${APEX}/guides/servicem8-quote-follow-up`,
    ]);
  });

  it('never lists a console path or the confirmation page', () => {
    const urls = entries.map((entry) => entry.url).join(' ');

    expect(urls).not.toContain('/thanks');
    expect(urls).not.toContain('app.backdesk.com.au');
  });

  it('holds the guide out of the count until it is published (260915-ec0)', () => {
    // The guide page is built and deployed but 404s behind `GUIDE_PUBLISHED`,
    // because its ServiceM8 merge fields are not founder-verified yet. A
    // sitemap entry for a page that answers 404 is an instruction to index
    // something that does not exist, so the flag governs both. It has its
    // title and description ready here either way, so publishing is the flag
    // and the date and nothing else.
    // Published 15 Sep 2026 once the founder verified the merge fields.
    expect(entries.map((entry) => entry.url).join(' ')).toContain('/guides/');
    expect(METADATA_COPY.guide.title).toBe('How to set up quote follow-ups in ServiceM8');
    expect(METADATA_COPY.guide.description.length).toBeGreaterThan(60);
  });
});

describe('every public page carries its own title, description and canonical', () => {
  it('prints the name once on the home page (title.absolute)', () => {
    // Moved 16 Oct 2026 (quick 261016-1xw): the home title leads with
    // missed-call text-back; it was 'Backdesk · Quote chasing for Perth trade
    // businesses' until the founder repositioned the site.
    expect(homeMetadata.title).toEqual({
      absolute: 'Backdesk · Missed-call text-back for Perth trade businesses',
    });
    expect(homeMetadata.description).toContain('Free Quote Leakage Audit');
    expect(homeMetadata.description).toContain('missed call');
    expect(homeMetadata.alternates?.canonical).toBe('/');
  });

  it('lets the root template append the name on /audit', () => {
    expect(auditMetadata.title).toBe('Free Quote Leakage Audit');
    expect(auditMetadata.description).toBeTruthy();
    expect(auditMetadata.alternates?.canonical).toBe('/audit');
  });

  it('titles the privacy notice and gives it a description worth a search result', () => {
    expect(privacyMetadata.title).toBe('Privacy notice');
    expect(privacyMetadata.description).toContain('Backdesk');
    expect(privacyMetadata.alternates?.canonical).toBe('/privacy');
  });
});

describe('nothing behind a login, and nothing after a submit, is indexed (T-9-29)', () => {
  it('keeps the confirmation page out of search results', () => {
    expect(thanksMetadata.title).toBe('Request received');
    expect(thanksMetadata.robots).toMatchObject({ index: false });
  });

  it('marks the console layout noindex', () => {
    expect(consoleMetadata.robots).toMatchObject({ index: false });
  });

  it('marks the login page noindex', () => {
    expect(loginMetadata.robots).toMatchObject({ index: false });
  });
});

describe('the link preview and the footer are wired to the brand module', () => {
  const LAYOUT = readFileSync('src/app/(marketing)/layout.tsx', 'utf8');

  it('resolves the OG image absolutely, from the apex', () => {
    expect(LAYOUT).toContain('metadataBase');
    expect(LAYOUT).toContain('/brand/og-image.png');
    expect(LAYOUT).toContain("card: 'summary_large_image'");
  });

  it('splits the ONE identity line into linkable segments (D-16)', () => {
    // The layout renders `footerIdentityLine(ABN_DISPLAY).split(' · ')` and
    // turns two of the segments into a mailto: and a tel: by comparing them to
    // the constants. That is only safe while the separator and the segment
    // values are what they are here — so they are pinned here, and a change to
    // the builder fails this rather than silently rendering one flat string.
    const segments = footerIdentityLine(ABN_DISPLAY).split(' · ');

    expect(segments).toHaveLength(5);
    expect(segments[0]).toBe('Backdesk');
    expect(segments).toContain(CONTACT_EMAIL);
    expect(segments).toContain(CONTACT_PHONE_DISPLAY);
    expect(LAYOUT).toContain("footerIdentityLine(ABN_DISPLAY).split(' · ')");
    expect(LAYOUT).toContain('mailto:');
    expect(LAYOUT).toContain('tel:');
  });
});

describe('robots and sitemap are static files, not request-time work', () => {
  it.each(['src/app/robots.ts', 'src/app/sitemap.ts'])('%s reads no request state', (path) => {
    // Comments stripped first: the file explains why it does NOT call these,
    // and the explanation must not be what fails the gate (the
    // `tests/layout-contract.test.ts` rule).
    const source = readFileSync(path, 'utf8')
      .replaceAll(/\/\*[\s\S]*?\*\//g, '')
      .replaceAll(/^\s*\/\/.*$/gm, '');

    // `headers()` or `cookies()` here would make the route dynamic, which costs
    // a function invocation on every crawl for a file that never changes.
    expect(source).not.toContain('headers()');
    expect(source).not.toContain('cookies()');
  });
});
