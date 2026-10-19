/**
 * The site's ONE structured-data block (Cowork build request "Phase 11", 19 Sep
 * 2026).
 *
 * ── WHY IT EXISTS ───────────────────────────────────────────────────────────
 *
 * Backdesk now has three public listings besides this site: the Google Business
 * Profile, the Facebook page and the WhatsApp Business profile. Google joins a
 * business's listings together partly through structured data on its site, and
 * until now this site had none at all — so `backdesk.com.au`, the GBP and
 * `facebook.com/backdeskau` were three things Google had to GUESS were one
 * business. This block is the site claiming them.
 *
 * ── `ProfessionalService`, NOT `LocalBusiness` ──────────────────────────────
 *
 * A subtype of LocalBusiness that carries no storefront expectation — closer to
 * what a one-operator service actually is, and it keeps every LocalBusiness
 * property the listings care about.
 *
 * ── EVERY VALUE COMES FROM `@/core/brand` ───────────────────────────────────
 *
 * Nothing here is typed twice. The name, the email, both phone shapes, the city
 * and the state, the service area and the hours are constants in the import-free
 * brand module (D-17), for the same reason the footer reads them from there: a
 * business whose website says one phone number and whose Google listing says
 * another is a business a customer cannot reach, and the whole purpose of this
 * block is to assert that the two are the same business.
 *
 * ── WHAT IS DELIBERATELY ABSENT ─────────────────────────────────────────────
 *
 * NO `streetAddress`. The GBP is a service-area business with no public address
 * and the site must not publish one either — a sole trader working from home has
 * no premises to name (the same rule that took the suburb out of the footer:
 * the site says Perth WA and stops there).
 *
 * NO `Service` or `Offer` entries. The three prices live in `LANDING_COPY` as
 * sentences, and the build request is explicit: read them from the same source
 * the page uses or skip the entries rather than typing the numbers a second
 * time. There is no structured source to read — the copy is prose — so they are
 * skipped. A price in two places is a price that goes stale in one of them, and
 * a stale price in machine-readable markup is the one a search engine believes.
 *
 * `sameAs` CLAIMS BOTH LISTINGS (21 Sep 2026): the Facebook page and the Google
 * Business Profile, the latter as Google's entity URL rather than the share
 * short link that redirects to it (see `GOOGLE_PROFILE_URL`).
 *
 * PURE. No imports beyond the brand module, no environment, no request state —
 * the marketing subtree must prerender, and this must not be the thing that
 * stops it.
 */
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

/** The public site's own address, with the trailing slash a canonical carries. */
export const SITE_URL = `https://${APEX_DOMAIN}/`;

/**
 * The 512px square the listings themselves use.
 *
 * The SAME drawing that is uploaded to the Google Business Profile, Facebook and
 * WhatsApp as the profile picture — derived from `profile-720.svg` by
 * `scripts/brand/render-brand-assets.sh`, so all four surfaces show one image
 * and Google is not comparing two pictures of one business. Google asks for at
 * least 112x112 and prefers a square; 512 is the size the profiles want anyway.
 */
export const LOGO_PATH = '/brand/logo-512.png';

/**
 * The city and the state, from the ONE constant that holds both.
 *
 * Split rather than re-typed, exactly as the layout splits the footer identity
 * line: `BUSINESS_LOCATION` is 'Perth WA' and these are its two halves, so a
 * change there moves the structured data with it. `tests/structured-data.test.ts`
 * pins both values, so a constant that stopped being two words fails a test
 * rather than silently emitting an undefined region.
 */
const [ADDRESS_LOCALITY, ADDRESS_REGION] = BUSINESS_LOCATION.split(' ');

/** ISO 3166-1 alpha-2, which is the form `addressCountry` wants. */
const ADDRESS_COUNTRY = 'AU';

/**
 * The block, as a value.
 *
 * A BUILDER RATHER THAN A CONSTANT so the test can call it and compare its
 * fields to the brand module's, instead of comparing a literal to itself. It
 * takes no arguments and reads nothing: called twice it returns equal objects,
 * which is what makes "the same block on every page" a property of the code
 * rather than of the three pages that render it.
 */
export function professionalServiceJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfessionalService',
    // A stable identifier for this business, so a future block (a Service, a
    // WebSite) can point at it rather than describe it again.
    '@id': `${SITE_URL}#business`,
    name: SERVICE_NAME,
    url: SITE_URL,
    logo: `https://${APEX_DOMAIN}${LOGO_PATH}`,
    // The same file. `logo` is what a knowledge panel reads and `image` is what
    // a generic LocalBusiness consumer reads; pointing them at one drawing is
    // the difference between one identity and two.
    image: `https://${APEX_DOMAIN}${LOGO_PATH}`,
    email: CONTACT_EMAIL,
    telephone: CONTACT_PHONE_E164,
    address: {
      '@type': 'PostalAddress',
      addressLocality: ADDRESS_LOCALITY,
      addressRegion: ADDRESS_REGION,
      addressCountry: ADDRESS_COUNTRY,
    },
    // The GBP's own five towns, each named with its state so the list reads the
    // same on both surfaces.
    areaServed: SERVICE_AREAS.map((area) => ({
      '@type': 'City',
      name: `${area} ${ADDRESS_REGION}`,
    })),
    openingHoursSpecification: [
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: [...OPENING_HOURS.days],
        opens: OPENING_HOURS.opens,
        closes: OPENING_HOURS.closes,
      },
    ],
    priceRange: '$$',
    sameAs: [FACEBOOK_URL, GOOGLE_PROFILE_URL],
  };
}

/**
 * The block as the exact string that goes inside `<script>`.
 *
 * `<` ESCAPED AS `<`, AND THAT IS THE WHOLE POINT OF THIS FUNCTION. A
 * `<script>` element ends at the first literal `</script` in its text, wherever
 * it appears — including inside a JSON string — so a value carrying that
 * sequence would close the element early and everything after it would be parsed
 * as markup. `<` is the same character to a JSON parser and inert to an
 * HTML tokeniser.
 *
 * Today every value here is a compile-time constant, so there is nothing hostile
 * to escape. The escape is kept anyway because the next value added to the block
 * may not be a constant, and the failure mode of remembering then is that nobody
 * does.
 */
export function professionalServiceJsonLdText(): string {
  return JSON.stringify(professionalServiceJsonLd()).replaceAll('<', '\\u003c');
}
