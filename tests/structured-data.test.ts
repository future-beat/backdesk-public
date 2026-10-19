/**
 * THE SITE CLAIMS ITS LISTINGS, AND CLAIMS THEM ONCE (build request "Phase 11",
 * 19 Sep 2026).
 *
 * Structured data is the one thing on this site NO HUMAN EVER LOOKS AT. It is
 * read by a crawler, months later, and its failure mode is silence: a block with
 * a wrong phone number does not render wrong, it renders nothing at all — the
 * Google Business Profile and the website stay two businesses as far as Google
 * is concerned, and nobody finds out. So the assertions below are the contract:
 *
 *  1. Every value equals the brand-module constant it is supposed to come from,
 *     COMPARED rather than trusted. The whole point of the block is the claim
 *     "this website and that listing are one business"; a second spelling of the
 *     phone number is the claim being false.
 *  2. What is NOT in it: no street address (the profile is a service-area
 *     business and the operator works from home), and no Offer or Service entry
 *     (the three prices live in copy sentences, and the request forbids typing
 *     a price twice rather than reading it from one source).
 *  3. Exactly ONE block, rendered in the layout, so the six public pages cannot
 *     disagree with each other.
 *
 * PURE: reads two source files and calls one builder. Runs bare
 * (`npx vitest run tests/structured-data.test.ts`), with NO ALLOW_REMOTE_TESTS.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  APEX_DOMAIN,
  BUSINESS_LOCATION,
  CONTACT_EMAIL,
  CONTACT_PHONE_E164,
  FACEBOOK_URL,
  GOOGLE_PROFILE_URL,
  OPENING_HOURS,
  SERVICE_AREAS,
  SERVICE_NAME,
} from '@/core/brand';

import {
  LOGO_PATH,
  SITE_URL,
  professionalServiceJsonLd,
  professionalServiceJsonLdText,
} from '@/app/(marketing)/structured-data';

const LAYOUT = readFileSync('src/app/(marketing)/layout.tsx', 'utf8');

/**
 * The layout's MARKUP, with every comment removed — the convention
 * `tests/layout-contract.test.ts` set, and it is load-bearing here twice.
 *
 * The block below explains, in prose, why there is no `wa.me` link and why
 * `dangerouslySetInnerHTML` is correct exactly once. A negative match or a count
 * over the raw text is satisfied by the explanation, so writing down the reason
 * would fail the rule the reason is about. The JSX form `{/* … *\/}` is stripped
 * first: strip the inner block comment first and the surviving braces read as
 * markup.
 */
const MARKUP = LAYOUT.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/** The block, as a crawler would receive it: serialised and parsed back. */
const PARSED = JSON.parse(professionalServiceJsonLdText()) as Record<string, unknown>;

describe('the block is a ProfessionalService that identifies itself', () => {
  it('declares the context, the type and a stable @id', () => {
    expect(PARSED['@context']).toBe('https://schema.org');
    // A subtype of LocalBusiness with no storefront expectation — what a
    // one-operator service actually is.
    expect(PARSED['@type']).toBe('ProfessionalService');
    // The id is an address a future block can point AT rather than re-describe.
    expect(PARSED['@id']).toBe('https://backdesk.com.au/#business');
  });

  it('carries every property the listings are matched on, and none of them empty', () => {
    for (const key of [
      '@context',
      '@type',
      '@id',
      'name',
      'url',
      'logo',
      'email',
      'telephone',
      'address',
      'areaServed',
      'openingHoursSpecification',
      'priceRange',
      'sameAs',
    ]) {
      expect(PARSED, `missing ${key}`).toHaveProperty(key);
      expect(PARSED[key], `${key} is empty`).toBeTruthy();
    }
  });

  it('survives the round trip a crawler makes — serialise, parse, still equal', () => {
    // The text function escapes `<`; that must not change the VALUE. A parser
    // and this process have to agree on every field or the block is a different
    // business from the one the builder describes.
    expect(PARSED).toEqual(professionalServiceJsonLd());
  });

  it('is the same block every time it is built — no clock, no request, no randomness', () => {
    // Six pages render it. If it varied, `@id` would be pointing at six
    // different descriptions of one business.
    expect(professionalServiceJsonLdText()).toBe(professionalServiceJsonLdText());
  });
});

describe('every value comes from the brand module, compared rather than trusted', () => {
  it('names the business and its site from the constants (D-17)', () => {
    expect(PARSED.name).toBe(SERVICE_NAME);
    expect(PARSED.url).toBe(SITE_URL);
    expect(SITE_URL).toBe(`https://${APEX_DOMAIN}/`);
  });

  it('gives the SAME email and the SAME number the footer prints', () => {
    // The drift this prevents is the one that matters most: a listing that says
    // one number and a website that says another is not a stronger signal that
    // they are one business, it is evidence that they are not.
    expect(PARSED.email).toBe(CONTACT_EMAIL);
    expect(PARSED.telephone).toBe(CONTACT_PHONE_E164);
    // E.164, because a crawler and a dialler both want the country code.
    expect(PARSED.telephone).toMatch(/^\+61\d{9}$/);
  });

  it('points logo and image at ONE served square, absolutely', () => {
    const logo = `https://${APEX_DOMAIN}${LOGO_PATH}`;

    expect(PARSED.logo).toBe(logo);
    expect(PARSED.image).toBe(logo);
    // Absolute, not relative: the block is read away from the page it came from.
    expect(String(PARSED.logo).startsWith('https://')).toBe(true);
    expect(LOGO_PATH).toBe('/brand/logo-512.png');
  });

  it('splits the ONE location constant into the locality and the region', () => {
    // `BUSINESS_LOCATION` is 'Perth WA'. Split rather than re-typed, exactly as
    // the layout splits the footer identity line — so a change there moves this
    // block with it instead of leaving two places claiming two cities.
    expect(PARSED.address).toEqual({
      '@type': 'PostalAddress',
      addressLocality: 'Perth',
      addressRegion: 'WA',
      addressCountry: 'AU',
    });
    expect(BUSINESS_LOCATION).toBe('Perth WA');
  });

  it('serves the five towns the Google profile serves, each with the state', () => {
    expect(PARSED.areaServed).toEqual(
      SERVICE_AREAS.map((area) => ({ '@type': 'City', name: `${area} WA` })),
    );
    expect(PARSED.areaServed).toHaveLength(5);
    expect(JSON.stringify(PARSED.areaServed)).toContain('Perth WA');
    expect(JSON.stringify(PARSED.areaServed)).toContain('Rockingham WA');
  });

  it('opens Monday to Friday, 08:00 to 17:00, from the hours constant', () => {
    expect(PARSED.openingHoursSpecification).toEqual([
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: [...OPENING_HOURS.days],
        opens: '08:00',
        closes: '17:00',
      },
    ]);
    // 24-hour, zero-padded: the shape the schema requires, and the shape that
    // cannot be read as 8pm.
    expect(OPENING_HOURS.opens).toMatch(/^\d{2}:\d{2}$/);
    expect(OPENING_HOURS.closes).toMatch(/^\d{2}:\d{2}$/);
  });

  it('claims both listings: the Facebook page and the Google Business Profile', () => {
    // Marketing delivered the GBP link on 21 Sep 2026. The share short link
    // redirects to Google's entity URL, so the entity URL is what is claimed.
    expect(PARSED.sameAs).toEqual([FACEBOOK_URL, GOOGLE_PROFILE_URL]);
    expect(GOOGLE_PROFILE_URL).toBe('https://www.google.com/search?kgmid=/g/11zyp59ss9');
    expect(PARSED.priceRange).toBe('$$');
  });
});

describe('what the block deliberately does NOT say', () => {
  it('publishes no street address, in any spelling', () => {
    // The Google profile is a service-area business with no public address, and
    // the operator is a sole trader working from home — the same rule that took
    // the suburb out of the footer (UAT, 10 Sep 2026).
    const text = professionalServiceJsonLdText();

    expect(PARSED.address).not.toHaveProperty('streetAddress');
    expect(text).not.toContain('streetAddress');
    expect(text).not.toContain('postalCode');
    expect(text).not.toMatch(/Formersuburb/i); // former suburb name removed from the public export
    // A house number would arrive as a digit inside the address object.
    expect(JSON.stringify(PARSED.address)).not.toMatch(/\d/);
  });

  it('emits no Offer, no Service and no price figure', () => {
    // The request: read the prices from the same source the landing page uses or
    // skip the entries. They live in `LANDING_COPY` as sentences, so there is no
    // structured source to read — and a price typed a second time into
    // machine-readable markup is the copy a search engine believes after the
    // page has moved on.
    const text = professionalServiceJsonLdText();

    expect(text).not.toContain('"Offer"');
    expect(text).not.toContain('"Service"');
    expect(text).not.toContain('offers');
    expect(text).not.toContain('hasOfferCatalog');
    // 16 Oct 2026: the current list prices joined the retired ones here.
    // 17 Oct 2026 (quick 261017-s1c): 797 is retired too (one plan, $397)
    // and stays pinned with the other retired figures.
    for (const figure of ['397', '797', '597', '997', '990', '297']) {
      expect(text, `the block quotes ${figure}`).not.toContain(figure);
    }
    // `priceRange: '$$'` is the ONE money-shaped value, and it is a band rather
    // than a number, so it cannot go stale.
    expect((text.match(/\$/g) ?? []).length).toBe(2);
  });

  it('cannot close its own <script> element', () => {
    // A `<script>` ends at the first literal `</script` in its text, wherever it
    // appears — inside a JSON string included. `<` is the same character to
    // a JSON parser and inert to an HTML tokeniser.
    const text = professionalServiceJsonLdText();

    expect(text).not.toContain('<');
    // …and the escape is not merely absent for lack of input: it is applied.
    expect(JSON.stringify({ a: '<b>' }).replaceAll('<', '\\u003c')).toBe('{"a":"\\u003cb>"}');
  });

  it('reads no environment and imports nothing but the brand module', () => {
    // These pages must prerender. A module that read the environment or the
    // request would make the whole marketing subtree dynamic, which costs a
    // function invocation on every crawl of a file that never changes.
    const source = readFileSync('src/app/(marketing)/structured-data.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const imports = [...source.matchAll(/^\s*import[\s\S]*?from '([^']+)';/gm)].map((m) => m[1]);

    expect(imports).toEqual(['@/core/brand']);
    expect(source).not.toContain('process.env');
    expect(source).not.toContain('headers()');
  });
});

describe('the layout renders it exactly once, on every public page', () => {
  it('carries ONE application/ld+json script, in the layout', () => {
    expect(MARKUP.match(/type="application\/ld\+json"/g)).toHaveLength(1);
    expect(LAYOUT).toContain('professionalServiceJsonLdText()');
    // In the shared shell, not on a page: `/`, `/audit`, `/privacy`,
    // `/audit/how-to`, `/audit/thanks` and the guide all render through it, so
    // they cannot describe the business differently from one another.
    expect(LAYOUT).toContain("from './structured-data'");
  });

  it('injects it as raw text, because React would escape JSON into invalid JSON', () => {
    // A text child of `<script>` is HTML-escaped by React — `&` becomes `&amp;`
    // and the block stops parsing. This is the one place on the public site
    // where `dangerouslySetInnerHTML` is correct, and it is safe for a reason
    // that is checkable: the string is built from compile-time constants.
    const script = MARKUP.slice(
      MARKUP.indexOf('<script'),
      MARKUP.indexOf('/>', MARKUP.indexOf('<script')),
    );

    expect(script).toContain('dangerouslySetInnerHTML');
    expect(script).toContain('__html: professionalServiceJsonLdText()');
    // ONE occurrence in the whole layout: nothing else on the public shell may
    // acquire raw-HTML injection by copying this line.
    expect(MARKUP.match(/dangerouslySetInnerHTML/g)).toHaveLength(1);
  });
});

describe('the footer links the Facebook page, and only the Facebook page', () => {
  it('renders the link from the brand constant with the label from the copy module', () => {
    expect(LAYOUT).toContain('href={FACEBOOK_URL}');
    expect(LAYOUT).toContain('{LANDING_COPY.footer.facebook}');
  });

  it('opens it in a tab that cannot reach back', () => {
    const anchor = MARKUP.slice(
      MARKUP.indexOf('<a href={FACEBOOK_URL}'),
      MARKUP.indexOf('</a>', MARKUP.indexOf('<a href={FACEBOOK_URL}')),
    );

    expect(anchor).toContain('target="_blank"');
    expect(anchor).toContain('rel="noopener noreferrer"');
  });

  it('adds no WhatsApp link and no Google link (the request, §3)', () => {
    // `wa.me` on a public page invites messages somebody then has to answer, and
    // the Google profile is for search rather than for sending a reader away
    // from the page they are already on.
    expect(MARKUP).not.toContain('wa.me');
    expect(MARKUP).not.toContain('whatsapp');
    expect(MARKUP).not.toContain('g.page');
    expect(MARKUP).not.toContain('maps.app.goo.gl');
    // The stripper must not have eaten the markup it is supposed to be reading.
    expect(MARKUP).toContain('<footer');
  });

  it('keeps the address out of the copy module, where a domain is forbidden', () => {
    // `tests/marketing-copy.test.ts` allows exactly one domain in any public
    // sentence — ours. The label is copy; the address is a brand constant.
    const copy = readFileSync('src/app/(marketing)/copy.ts', 'utf8');

    expect(copy).not.toContain('facebook.com');
  });
});
