/**
 * What the service calls itself, and the domains it calls home.
 *
 * This module has NO imports, and that is the whole point. The name renders on
 * an A4 page printed to PDF in a meeting, inside an email builder that runs in
 * a background consumer, from a public route handler that resolves no tenant,
 * and from an alert sender that boots with half the environment missing. A
 * dependency added here is a dependency all four must be able to take — and the
 * workaround, every time, is a second spelling of the name somewhere. Two
 * spellings of a sender's identity is not a cosmetic problem: the identity line
 * and the From display name are the Spam Act sender identification, and a
 * follow-up whose header says one thing and whose footer says another is a
 * message a recipient cannot verify came from who it claims.
 *
 * `tests/brand.test.ts` pins this file to exactly twenty-one exports and asserts,
 * as a test rather than as a convention, that it contains no `import` — mirroring
 * the rule `tests/audit-aggregate.test.ts` enforces on `src/core/audit/constants.ts`.
 *
 * Nothing here quotes, escapes or sanitises anything. The From-header injection
 * control lives with the header builder in `src/core/messaging/resend-sender.ts`,
 * where its test can see it; this module receives strings that are already safe.
 */

/** The service's name, everywhere a human reads one (BRAND-01, D-01). */
export const SERVICE_NAME = 'Backdesk';

/** The registered apex. Reserved for the landing page — no console traffic. */
export const APEX_DOMAIN = 'backdesk.com.au';

/** Where the operator console lives — the URL opened on a phone between meetings. */
export const CONSOLE_HOST = 'app.backdesk.com.au';

/**
 * The service-owned sending domain (Resend). Cadence identities that have no
 * per-client verified domain send from here, as do operator alerts once it is
 * verified; per-client domains remain the default path for cadence email.
 */
export const SENDING_DOMAIN = 'quotes.backdesk.com.au';

/** `<meta name="description">` for the console. Public prose, no host or identifier. */
export const CONSOLE_DESCRIPTION =
  'Operator console for Backdesk, the managed missed-call text-back and quote-chasing service for trade businesses.';

/**
 * Identifies US as the sending platform in ClickSend's own reporting. Provider-side
 * only: never customer-visible, and never the Spam Act sender identification — the
 * tradie's business is named in the message copy, which is what the Act asks for.
 */
export const PROVIDER_SOURCE_TAG = 'backdesk';

/**
 * Resend's pre-verification sender: before a domain is verified, Resend will only
 * deliver from `onboarding@resend.dev`, and only to the account owner — which is
 * exactly who an operator alert is for. `OPERATOR_ALERT_FROM` takes over with no
 * code change once `SENDING_DOMAIN` is verified (D-03).
 */
export const DEFAULT_ALERT_FROM = `${SERVICE_NAME} <onboarding@resend.dev>`;

/**
 * The one phrasing of who sent a message and on whose behalf (D-01, D-02).
 *
 * The tradie's business is the sender; the service is named only as the service.
 * One builder, imported by every surface, so a second spelling anywhere is a test
 * failure rather than a discrepancy a recipient finds.
 */
export function identityLine(business: string): string {
  return `Sent by ${SERVICE_NAME} on behalf of ${business}.`;
}

/**
 * The email From display name — both parties named, the business first.
 *
 * The caller passes an already-sanitised business string and adds the surrounding
 * quotes: the sanitiser is a header-injection control and stays next to the header
 * it protects (`src/core/messaging/resend-sender.ts`).
 */
export function viaDisplayName(business: string): string {
  return `${business} via ${SERVICE_NAME}`;
}

/* ------------------------------------------------------------------------- *
 * CONTACT AND LEGAL IDENTITY (D-16, D-17)
 *
 * These are the facts a recipient uses to check that the business exists: the
 * registered number, where it operates from, and two ways to reach a human.
 * They live here, beside the name, for the same reason the name does — the
 * landing footer, the privacy notice, the printed audit and the monthly report
 * each render them, and four spellings of an ABN is four chances to be wrong
 * about a legal identifier.
 * ------------------------------------------------------------------------- */

/**
 * The ABN as the register prints it: four groups, and the ONE spelling of the
 * digits in this codebase (D-16).
 *
 * The business name Backdesk was registered with ASIC on 8 September 2026 and
 * this is the number that came back. An ABN in a footer is a claim a reader can
 * look up, so the only two honest states are the real number and no number at
 * all: if the entity behind the service ever changes, set THIS to `null` — both
 * exports below go null with it and every footer drops the segment on its own.
 * Never a placeholder, never a bracketed token.
 *
 * Module-private, and grouped rather than written out, because the number has
 * to appear in two shapes (below) and two independently typed shapes of a legal
 * identifier is two chances to be wrong about it — the same failure D-17 moved
 * these constants into one module to prevent, one level down.
 */
const ABN_GROUPS: readonly string[] | null = ['00', '000', '000', '000'];

/**
 * The canonical, plain-space value — what a record, an agreement or a config
 * field copies, and what a human types into an ABN lookup.
 *
 * Anything RENDERED as HTML uses `ABN_DISPLAY` below instead.
 */
export const BUSINESS_ABN: string | null = ABN_GROUPS && ABN_GROUPS.join(' ');

/**
 * The same number, as ONE unbreakable token (G-09-5, UAT 10 Sep 2026).
 *
 * On a phone the privacy notice broke the ABN across two lines — `00 000` at
 * the end of one and `000 000` at the start of the next — which reads as two
 * numbers and is useless to anyone checking it. The groups are joined with
 * NO-BREAK SPACE (U+00A0) instead of a space: the browser cannot choose a line
 * break inside it, so the number moves whole or not at all.
 *
 * Built by joining the groups rather than by rewriting the plain form because
 * this module may not call `.replace`, `.replaceAll`, `.split` or `.normalize`
 * (T-8-01, pinned by `tests/brand.test.ts`) — and because four groups joined by
 * a separator is what the number actually is. Nothing here is a sanitiser: the
 * separator is chosen at build time, never derived from an input.
 */
export const ABN_DISPLAY: string | null = ABN_GROUPS && ABN_GROUPS.join('\u00A0');

/**
 * Where the business operates from — the CITY and the state, and no more.
 *
 * It was the suburb and the state until the operator read the live footer
 * (UAT, 10 Sep 2026) and asked for the suburb gone: a sole trader working from
 * home has no commercial premises, and a suburb in a public footer is a step
 * closer to a home address than a stranger needs to be. What the footer owes a
 * reader is a way to check the business exists and a way to reach a person —
 * the ABN does the first, the email and the phone do the second, and the city
 * says which market it serves. The suburb was doing none of those jobs.
 *
 * Named for the fact rather than for its old shape: `BUSINESS_SUBURB` holding
 * `'Perth WA'` would be a constant whose name is wrong, which is how the next
 * person to read it puts the suburb back.
 */
export const BUSINESS_LOCATION = 'Perth WA';

/** The human behind the sole trader, for the agreement and the privacy notice. */
export const OPERATOR_LEGAL_NAME = 'Hesam Abbaszadi';

/** The address a prospect, a client or a regulator writes to. Monitored. */
export const CONTACT_EMAIL = 'hello@backdesk.com.au';

/**
 * The contact number as a human reads it — spaced, local form.
 *
 * Stored twice on purpose: a `tel:` href may not carry spaces, and a footer
 * that displays one number while dialling another is worse than printing none.
 * The pair is asserted equal digit by digit in `tests/brand.test.ts`.
 */
export const CONTACT_PHONE_DISPLAY = '0491 578 888';

/** The same number in E.164, for `tel:` and for any provider that demands it. */
export const CONTACT_PHONE_E164 = '+61491578888';

/**
 * The one-line promise. Landing hero and the OG image.
 *
 * Repositioned 16 Oct 2026 by founder decision: the site now leads with
 * missed-call text-back. The M1 quote line ("Every quote ... until it's won or
 * dead.") is now the lede's second sentence, pinned there by
 * `tests/marketing-copy.test.ts`.
 */
export const TAGLINE = 'Every missed call texted back in seconds.';

/* ------------------------------------------------------------------------- *
 * THE PUBLIC LISTINGS (Cowork build request "Phase 11", 19 Sep 2026)
 *
 * Three facts the site publishes about the business as a LISTING rather than as
 * prose: the social profile it claims, the towns it serves, and the hours it
 * answers. They live here for the reason everything else in this file does —
 * the structured-data block, the footer link and (later) an hours line in copy
 * would otherwise each hold their own spelling, and a business whose website
 * says one set of hours while its Google profile says another is a business a
 * customer cannot plan around.
 * ------------------------------------------------------------------------- */

/**
 * The Facebook page, confirmed 19 Sep 2026 and added to the Google Business
 * Profile as a social profile.
 *
 * It is a URL rather than a handle because both consumers want the whole
 * address: `sameAs` in the structured data is defined as a link, and the footer
 * renders an `href`. It lives HERE and not in the marketing copy module because
 * `tests/marketing-copy.test.ts` forbids a domain-shaped string in any public
 * sentence — the one domain allowed on the page is ours, and that rule is what
 * stops a competitor's address being typed into a paragraph.
 */
export const FACEBOOK_URL = 'https://www.facebook.com/backdeskau';

/**
 * The Google Business Profile, as Google's own entity URL (21 Sep 2026).
 *
 * Marketing supplied the profile's "Share profile" short link. Followed, it
 * redirects to exactly this address: a search for the knowledge-graph id
 * `/g/11zyp59ss9`. The short link can be regenerated or retired; the entity id
 * cannot, so `sameAs` claims the destination rather than the alias. Used only
 * in the structured data — the footer deliberately carries no Google link.
 */
export const GOOGLE_PROFILE_URL = 'https://www.google.com/search?kgmid=/g/11zyp59ss9';

/**
 * The service area, exactly as the Google Business Profile states it.
 *
 * FIVE NAMES AND NO STREET. The GBP is registered as a service-area business
 * with no public address, so this list — not a location — is what says where
 * the service works. Keeping it identical to the profile's own list is the
 * point of the constant: Google joins a site to a listing partly by comparing
 * them, and two disagreeing service areas is a mismatch rather than a match.
 *
 * The state is NOT repeated on each entry: `BUSINESS_LOCATION` already carries
 * it, and the structured-data builder reads the region from there.
 */
export const SERVICE_AREAS = ['Perth', 'Mandurah', 'Midland', 'Joondalup', 'Rockingham'] as const;

/**
 * When a person answers, in the one shape every surface can render.
 *
 * Resolved 19 Sep 2026: Mon–Fri 08:00–17:00 everywhere, after the GBP's Monday
 * (08:30) turned out to be a typo and was corrected. Stored as 24-hour strings
 * because that is what `openingHoursSpecification` requires and because a
 * human-readable "8am–5pm" would be a second spelling that could drift from it.
 *
 * NO TIME ZONE FIELD, deliberately: the schema has none, the business is in one
 * place, and the address beside it says which place that is.
 */
export const OPENING_HOURS = {
  days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  opens: '08:00',
  closes: '17:00',
} as const;

/**
 * The footer line every surface prints, in one shape (D-16).
 *
 * Name, then `ABN <number>`, then the city, then email, then phone, joined with
 * ` · `. The number itself is spelled once in this file, on `ABN_GROUPS`
 * above — repeating it here, even in a comment, would be the second spelling
 * the module exists to prevent. `tests/brand.test.ts` pins the exact string.
 *
 * Every caller that renders HTML passes `ABN_DISPLAY`, so the number in the
 * printed line is one unbreakable token (G-09-5). This function does not choose
 * between the two shapes: it prints the one it is handed, which is what lets
 * the sentence below about placeholders stay true.
 *
 * The ABN arrives as an argument rather than being read from the constant
 * directly so that a caller with a per-entity value can pass it, and so this
 * module keeps its promise never to read the environment. Pass `null` (or an
 * empty string, which a cleared field yields) and the segment is dropped
 * whole — no dangling separator, no bare `ABN` label. That omission is the
 * transparency control: there is no code path here that emits a number this
 * function was not given.
 *
 * Built from an array literal, `filter` and `join` because the structural test
 * forbids every string-rewriting method in this file (T-8-01) — and because a
 * list of segments joined by a separator is what the line actually is.
 */
export function footerIdentityLine(abn: string | null): string {
  return [
    SERVICE_NAME,
    abn ? `ABN ${abn}` : null,
    BUSINESS_LOCATION,
    CONTACT_EMAIL,
    CONTACT_PHONE_DISPLAY,
  ]
    .filter((segment) => segment !== null)
    .join(' · ');
}
