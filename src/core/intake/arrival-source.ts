/**
 * WHERE AN AUDIT REQUEST CAME FROM (Cowork build request "Phase 11", 19 Sep
 * 2026).
 *
 * With outreach email, the guide page, the Google Business Profile and the
 * Facebook page all pointing at `/audit`, the first real requests were going to
 * be impossible to attribute — and the M4 tripwire ("fewer than 5 positive
 * replies after the full list is touched twice") is a decision about which
 * channel to keep working, taken on evidence this module is the only source of.
 *
 * ── THE PRIVACY SHAPE IS THE DESIGN, NOT A CONSTRAINT ON IT (LAND-05) ───────
 *
 * Four short strings, and the list of what is deliberately NOT collected is
 * longer than the list of what is:
 *
 *  - The referrer's HOST, never the URL. `www.google.com` is the useful part;
 *    the rest of a referrer is a search query, a page path, and on some sites a
 *    campaign identifier that belongs to somebody else.
 *  - Three named query keys, and no other part of the query string.
 *  - No cookie, no pixel, no analytics script, no third-party request. The
 *    values are kept in the visitor's own `sessionStorage` by the marketing
 *    layout and come back as ordinary form fields.
 *  - No IP-derived location. The address is already reduced to a salted hash
 *    for the throttle (T-9-05) and is not read for anything else.
 *
 * ── AND IT IS TOTAL, BECAUSE THE FORM MUST NEVER FAIL ON IT ────────────────
 *
 * These values arrive from a URL a stranger controls, so they are exactly as
 * hostile as any other form field — but unlike every other field they are not
 * something the visitor typed, which means a rejection would be a form refusing
 * a submission over a value the person cannot see and did not write. So the
 * parser has NO failure mode: anything it does not recognise becomes `null` and
 * the request goes through with one fewer fact attached. `parseArrivalSource`
 * returns a record, never an error, and there is no code path here that can
 * reach the caller's field errors.
 *
 * PURE and framework-free: one import, of the import-free brand module.
 */
import { APEX_DOMAIN, CONSOLE_HOST } from '@/core/brand';

/**
 * The form fields the capture component writes and the action reads, in the
 * order the console renders them.
 *
 * ONE SPELLING of each name, shared by the hidden `<input name=…>`, the
 * `sessionStorage` record and the parser's input, so a renamed field cannot
 * silently stop arriving.
 */
export const ARRIVAL_SOURCE_FIELDS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'referrer_host',
] as const;
export type ArrivalSourceField = (typeof ARRIVAL_SOURCE_FIELDS)[number];

/**
 * The one `sessionStorage` key. Namespaced so it cannot collide with anything
 * else a browser extension or a future feature puts in the same store.
 */
export const ARRIVAL_SOURCE_KEY = 'backdesk.arrival';

/**
 * Our own hosts, which are NOT a referrer worth recording.
 *
 * A visitor moving from `/` to `/audit` sends a referrer, and recording it
 * would attribute every request to ourselves — the one answer that is never
 * useful. Built from the brand constants so a new host cannot be forgotten
 * here, and lower-cased at comparison time because a hostname is
 * case-insensitive.
 */
export const OWN_HOSTS: readonly string[] = [
  APEX_DOMAIN,
  `www.${APEX_DOMAIN}`,
  CONSOLE_HOST,
];

/**
 * How long a value may be. Generous for any real campaign tag and far short of
 * anything that could be a payload: a marketing tag is a word, and 64
 * characters is two of them.
 */
export const ARRIVAL_VALUE_MAX = 64;

/**
 * What a utm value may contain, and nothing else.
 *
 * The URL-unreserved characters, lower case: letters, digits, and `. _ ~ -`.
 * No space, no slash, no percent, no angle bracket, no quote — so a value that
 * reaches the console cannot be markup, cannot be a URL, and cannot carry a
 * separator that would make one tag read as two. Marketing owns the vocabulary
 * (the request is explicit that Code accepts any values), so the SHAPE is
 * bounded here and the WORDS are not bounded at all.
 */
const UTM_PATTERN = /^[a-z0-9._~-]+$/;

/**
 * What a hostname looks like: dot-separated labels of letters, digits and
 * hyphens, never starting or ending a label with a hyphen, with at least one
 * dot.
 *
 * The dot is required on purpose. It rejects `localhost`, a bare word, and —
 * more usefully — anything that is a hostname with something else attached: a
 * port (`example.com:8080`), a path (`example.com/x`), a scheme
 * (`https://example.com`) or a credential (`u@example.com`) all fail, because
 * `:`, `/`, `@` and `%` are not in the character class at all.
 */
const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Everything one arrival is, after parsing. Every field independently nullable. */
export interface ArrivalSource {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  referrerHost: string | null;
}

/** Nothing known — a direct visit, a link-free email, or a browser with no storage. */
export const NO_ARRIVAL_SOURCE: ArrivalSource = {
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  referrerHost: null,
};

/**
 * One utm value, or `null`.
 *
 * TRIM, LOWER-CASE, THEN BOUND, in that order. Lower-casing before the length
 * check rather than after is deliberate: it is the stored form that must fit,
 * and it also means `GBP` and `gbp` are one channel in the console rather than
 * two rows of the same thing.
 */
export function parseUtmValue(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  if (value === '' || value.length > ARRIVAL_VALUE_MAX) return null;
  return UTM_PATTERN.test(value) ? value : null;
}

/**
 * One referrer HOST, or `null` — including for every host that is ours.
 *
 * The client already drops our own hosts before storing anything; this is the
 * second reading, on the server, because the stored record travels through a
 * form field a stranger can rewrite. Two places that both say "not us" is the
 * cheapest possible defence against a value that would otherwise attribute
 * every request to the site it was made on.
 */
export function parseReferrerHost(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const host = raw.trim().toLowerCase();
  if (host === '' || host.length > ARRIVAL_VALUE_MAX) return null;
  if (!HOST_PATTERN.test(host)) return null;
  return OWN_HOSTS.includes(host) ? null : host;
}

/**
 * The four fields as they came off the form, as the record the row stores.
 *
 * TOTAL: every input shape yields a record. A missing key, a `File` where a
 * string was expected, 4 KB of script, a hostname with a port — each becomes
 * `null` in its own slot and leaves the other three alone, because a single bad
 * value must not cost the three good ones beside it.
 */
export function parseArrivalSource(
  read: (field: ArrivalSourceField) => string | null | undefined,
): ArrivalSource {
  return {
    utmSource: parseUtmValue(read('utm_source')),
    utmMedium: parseUtmValue(read('utm_medium')),
    utmCampaign: parseUtmValue(read('utm_campaign')),
    referrerHost: parseReferrerHost(read('referrer_host')),
  };
}

/** What the console prints when a request carries no arrival facts at all. */
export const ARRIVAL_UNKNOWN = 'Unknown';

/**
 * The one line the console shows: `gbp / organic (www.google.com)`, with the
 * campaign appended as ` · booking` when there is one — or `Unknown`.
 *
 * ALL FOUR NULL IS A REAL AND COMMON STATE, not a gap. Outreach emails stay
 * link-free (Gmail rewrites every link), so an email-sourced request genuinely
 * arrives with nothing; those are matched to a person by email address against
 * the M4 target list instead. `Unknown` is therefore an answer, and the line
 * says it plainly rather than rendering an empty row the reader has to
 * interpret.
 *
 * A PARTIAL arrival is also real — the Facebook page button carries a source
 * and a medium and no campaign; a plain referral carries a host and nothing
 * else. Each missing half is printed as the console's own `—` rather than
 * collapsing the line, so "we know the medium and not the source" stays visibly
 * different from "we know nothing".
 *
 * Returns a STRING that the page renders as a text node. Nothing here escapes
 * anything and nothing here needs to: React escapes it, the parser has already
 * refused every character that could be markup, and the two controls are
 * independent.
 */
export function arrivalSourceLine(source: ArrivalSource, noValue = '—'): string {
  const { utmSource, utmMedium, utmCampaign, referrerHost } = source;

  if (!utmSource && !utmMedium && !utmCampaign && !referrerHost) return ARRIVAL_UNKNOWN;

  const pair = `${utmSource ?? noValue} / ${utmMedium ?? noValue}`;
  const host = referrerHost ? ` (${referrerHost})` : '';
  const campaign = utmCampaign ? ` · ${utmCampaign}` : '';

  return `${pair}${host}${campaign}`;
}
