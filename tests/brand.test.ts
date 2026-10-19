/**
 * The service names itself in exactly one place (BRAND-01, D-01).
 *
 * Two kinds of assertion live here, and the structural ones matter as much as
 * the behavioural ones. `src/core/brand.ts` is read by a print page, an email
 * builder, a public route handler and an alert sender; the block below pins its
 * export list and its import-freedom the same way `tests/audit-aggregate.test.ts`
 * pins `src/core/audit/constants.ts`, because the failure mode is not a wrong
 * string — it is a SECOND string, added somewhere to work around a dependency
 * this module was never supposed to acquire.
 *
 * Pure suite: no real environment, no database and no provider — `getServerEnv`
 * is mocked and every assertion is over a string this process built or a file it
 * read. It runs bare (`npx vitest run tests/brand.test.ts`), with NO
 * ALLOW_REMOTE_TESTS: setting that pauses the production tick jobs.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  ABN_DISPLAY,
  APEX_DOMAIN,
  BUSINESS_ABN,
  BUSINESS_LOCATION,
  CONSOLE_DESCRIPTION,
  CONSOLE_HOST,
  CONTACT_EMAIL,
  CONTACT_PHONE_DISPLAY,
  CONTACT_PHONE_E164,
  DEFAULT_ALERT_FROM,
  FACEBOOK_URL,
  OPENING_HOURS,
  OPERATOR_LEGAL_NAME,
  PROVIDER_SOURCE_TAG,
  SENDING_DOMAIN,
  SERVICE_AREAS,
  SERVICE_NAME,
  TAGLINE,
  footerIdentityLine,
  identityLine,
  viaDisplayName,
} from '@/core/brand';

/* ------------------------------------------------------------------------- *
 * BRAND-03 rendered surfaces — fixtures
 *
 * Copied BY VALUE from `tests/resend-sender.test.ts` rather than imported: one
 * test file importing another makes each suite's fixtures load-bearing for the
 * other's failures, and the whole point of the block below is to assert what a
 * customer reads independently of the suite that owns the sender.
 * ------------------------------------------------------------------------- */
const SECRET = 'unsubscribe-signing-secret-of-at-least-32-chars';
const BASE_URL = 'https://quotes.example.test';

vi.mock('@/core/shared/env', () => ({
  getServerEnv: () => ({
    RESEND_API_KEY: 're_test_key',
    APP_BASE_URL: BASE_URL,
    UNSUBSCRIBE_SIGNING_SECRET: SECRET,
    CLICKSEND_USERNAME: undefined,
    CLICKSEND_API_KEY: undefined,
  }),
}));

/**
 * Defensive only. The unsubscribe route imports `suppressFromInbound` for POST,
 * and GET — the only handler this suite calls — never reaches it; the mock keeps
 * this file pure even if that ever stops being true.
 */
vi.mock('@/core/cadence/controls', () => ({
  suppressFromInbound: vi.fn(),
}));

const { buildEmailMessage } = await import('@/core/messaging/resend-sender');
const { GET } = await import('@/app/api/unsubscribe/route');

const IDENTITY = {
  fromAddress: 'followups@quotes.example.test',
  replyTo: 'dave@daveselectrical.example',
  businessName: "Dave's Electrical",
};

/** One built email, with the business name as the only variable. */
function message(businessName: string = IDENTITY.businessName) {
  return buildEmailMessage({
    request: {
      ledgerId: '99999999-9999-4999-8999-999999999999',
      tenantId: '11111111-1111-4111-8111-111111111111',
      quoteId: '33333333-3333-4333-8333-333333333333',
      leadId: null,
      cadenceId: '44444444-4444-4444-8444-444444444444',
      touchNumber: 2,
      channel: 'email',
      to: { address: 'customer@example.test', contactName: 'Sam' },
      body: 'Just checking in on the quote we sent last week.',
    },
    identity: { ...IDENTITY, businessName },
    appBaseUrl: BASE_URL,
    signingSecret: SECRET,
  });
}

/** The legacy service name, in either spelling — the BRAND-01 grep. */
const LEGACY_NAME = /quote[- ]recovery/i;

describe('brand module structure (D-01)', () => {
  const SOURCE = readFileSync('src/core/brand.ts', 'utf8');

  /**
   * Comments stripped before every structural rule below.
   *
   * The module's header explains WHY it has no imports and no sanitiser, and it
   * can only do that by naming both. A rule that read the comments would be
   * obeyed by deleting the explanation.
   */
  const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('exports exactly the twenty-two pinned names, in EVERY export syntax', () => {
    // Not `(?:const|function)`: that pattern is blind to `export async
    // function`, `export class`, `export enum` and `export let`, which makes
    // "exactly eighteen exports" mean "exactly eighteen exports of two
    // syntactic shapes" — and this count is the T-8-01 mitigation, so a
    // nineteenth export wearing a different keyword is exactly what it must
    // not miss.
    //
    // Grew from nine to seventeen in 09-02: the contact and legal identity
    // (D-16, D-17) moved here so the landing footer, the privacy notice, the
    // printed audit and the monthly report read one ABN rather than four.
    // Eighteen in 09-11: `ABN_DISPLAY`, the unbreakable form (G-09-5). Note
    // what is NOT on the list — `ABN_GROUPS`, the private array both ABN
    // exports are built from, which is why there is still only one spelling of
    // the digits in this file.
    //
    // TWENTY-TWO on 21 Sep 2026 (`GOOGLE_PROFILE_URL`, the second listing the
    // structured data claims). TWENTY-ONE on 19 Sep 2026, when the site started claiming its public
    // listings: `FACEBOOK_URL`, `SERVICE_AREAS` and `OPENING_HOURS`. Each is a
    // fact that now appears on the website AND on the Google Business Profile,
    // and the whole point of the structured-data block is the claim that the two
    // are one business — so the site's copy of each fact has to have exactly one
    // spelling, for the same reason the ABN does.
    const exported = [
      ...CODE.matchAll(/^export\s+(?:async\s+)?(?:const|let|var|function|class|enum)\s+(\w+)/gm),
    ]
      .map((m) => m[1])
      .sort();

    expect(exported).toEqual([
      'ABN_DISPLAY',
      'APEX_DOMAIN',
      'BUSINESS_ABN',
      'BUSINESS_LOCATION',
      'CONSOLE_DESCRIPTION',
      'CONSOLE_HOST',
      'CONTACT_EMAIL',
      'CONTACT_PHONE_DISPLAY',
      'CONTACT_PHONE_E164',
      'DEFAULT_ALERT_FROM',
      'FACEBOOK_URL',
      'GOOGLE_PROFILE_URL',
      'OPENING_HOURS',
      'OPERATOR_LEGAL_NAME',
      'PROVIDER_SOURCE_TAG',
      'SENDING_DOMAIN',
      'SERVICE_AREAS',
      'SERVICE_NAME',
      'TAGLINE',
      'footerIdentityLine',
      'identityLine',
      'viaDisplayName',
    ]);

    // The two shapes the list above cannot enumerate, forbidden outright so the
    // count stays total over the file rather than over what the regex can see.
    expect(CODE).not.toMatch(/^export\s*\{/m);
    expect(CODE).not.toMatch(/^export\s+default\b/m);
  });

  it('is a module with NO imports OF ANY SHAPE — stated as a test, not as a convention', () => {
    // `/^import /` alone is a hole: `export { x } from './y'`, `export * from
    // './y'`, `await import('./y')` and `require('./y')` all add a dependency to
    // a module whose entire premise is that it has none. The name renders from a
    // print page, a background consumer, a public route handler that resolves no
    // tenant, and an alert sender that boots with half the environment missing;
    // a dependency here is one all four must be able to take, and the workaround
    // every time is a second spelling of the sender's identity somewhere.
    expect(CODE).not.toMatch(/^\s*import\b/m);
    expect(CODE).not.toMatch(/^\s*export\b[^\n]*\bfrom\b/m);
    expect(CODE).not.toMatch(/\b(require|import)\s*\(/);
  });

  it('carries no sanitiser of its own, in any spelling (T-8-01)', () => {
    // The From-header injection control stays in resend-sender.ts, where its own
    // test can see it. A second one smuggled in here would be a control nobody
    // is testing, in a file every surface imports.
    //
    // `.replace(` alone is a hole: `.replaceAll(`, `.split(...).join(` and
    // `.normalize(` rewrite a string just as thoroughly, and `.normalize(` in
    // particular can change what a header sanitiser downstream sees.
    expect(CODE).not.toMatch(/\.(replace|replaceAll|normalize|split)\s*\(/);
  });

  it('does not name the legacy service anywhere, comments included', () => {
    const source = readFileSync('src/core/brand.ts', 'utf8');

    expect(source).not.toMatch(LEGACY_NAME);
  });
});

describe('brand constants', () => {
  it('names the service and its three public domains', () => {
    expect(SERVICE_NAME).toBe('Backdesk');
    expect(APEX_DOMAIN).toBe('backdesk.com.au');
    expect(CONSOLE_HOST).toBe('app.backdesk.com.au');
    expect(SENDING_DOMAIN).toBe('quotes.backdesk.com.au');
  });

  it('defaults alerts to Resend pre-verification sender under the new name (D-03)', () => {
    expect(DEFAULT_ALERT_FROM).toBe('Backdesk <onboarding@resend.dev>');
  });

  it('tags the SMS provider with the new source', () => {
    expect(PROVIDER_SOURCE_TAG).toBe('backdesk');
  });

  it('describes the console without the legacy name', () => {
    expect(CONSOLE_DESCRIPTION).toContain(SERVICE_NAME);
    expect(CONSOLE_DESCRIPTION).not.toMatch(LEGACY_NAME);
  });
});

describe('identity builders (D-01, D-02)', () => {
  it('renders the locked identity-line phrasing', () => {
    expect(identityLine("Dave's Plumbing")).toBe(
      "Sent by Backdesk on behalf of Dave's Plumbing.",
    );
  });

  it('renders the locked via display name — the business first', () => {
    expect(viaDisplayName("Dave's Plumbing")).toBe("Dave's Plumbing via Backdesk");
  });

  it('is total over strings: an empty business name yields a string, never a throw', () => {
    // The upstream gate is `settings/email/actions.ts`, which refuses to enable a
    // row with no business name. These builders are downstream of it and must not
    // be the thing that explodes if it is ever bypassed.
    expect(() => identityLine('')).not.toThrow();
    expect(() => viaDisplayName('')).not.toThrow();
    expect(identityLine('')).toContain(SERVICE_NAME);
    expect(viaDisplayName('')).toContain(SERVICE_NAME);
  });

  it('keeps both parties distinguishable when the business name contains the service name', () => {
    // The adjacency edge: a tradie trading as "Backdesk Plumbing" must still read
    // as the sender, with the service named second in the via-name and first in
    // the identity line — the two locked shapes, not one collapsed one.
    expect(viaDisplayName('Backdesk Plumbing')).toBe('Backdesk Plumbing via Backdesk');
    expect(identityLine('Backdesk Plumbing')).toBe(
      'Sent by Backdesk on behalf of Backdesk Plumbing.',
    );
  });
});

describe('contact and legal identity (D-16, D-17)', () => {
  it('carries the ASIC-issued ABN, unformatted by anything downstream', () => {
    // The business name Backdesk was registered with ASIC on 8 September 2026
    // and this is the number that came back. Pinned as a literal here because
    // the whole point of D-16 is that ONE place holds it: a test that read the
    // constant and compared it to itself would pass through a typo.
    expect(BUSINESS_ABN).toBe('00 000 000 000');
  });

  it('renders the ABN as ONE unbreakable token, digit for digit the same number (G-09-5)', () => {
    // The phone found this: on a narrow screen the privacy notice broke the
    // number across two lines, which reads as two numbers. The display form
    // joins the groups with U+00A0, so a browser has nowhere to break it.
    expect(ABN_DISPLAY).toBe('00\u00A0000\u00A0000\u00A0000');
    expect(ABN_DISPLAY).not.toContain(' ');
    expect(ABN_DISPLAY?.match(/\u00A0/g)).toHaveLength(3);

    // ...and the SAME number as the canonical form, compared here rather than
    // trusted, exactly as the two phone shapes are below. Two hand-typed
    // spellings of a legal identifier is what this pair must never become.
    expect(ABN_DISPLAY?.split('\u00A0').join(' ')).toBe(BUSINESS_ABN);
  });

  it('prints the unbreakable form in the line every surface renders (G-09-5)', () => {
    // The builder prints what it is handed; what this pins is that the handed
    // value carries the non-breaking number through the join intact — a
    // separator change that normalised whitespace would be caught here.
    const line = footerIdentityLine(ABN_DISPLAY);

    expect(line).toContain('ABN 00\u00A0000\u00A0000\u00A0000');
    expect(line).toBe('Backdesk · ABN 00\u00A0000\u00A0000\u00A0000 · Perth WA · hello@backdesk.com.au · 0491 578 888');
  });

  it('carries the contact details a recipient can reply to, in both phone shapes', () => {
    expect(CONTACT_EMAIL).toBe('hello@backdesk.com.au');
    expect(CONTACT_PHONE_DISPLAY).toBe('0491 578 888');
    expect(CONTACT_PHONE_E164).toBe('+61491578888');
    expect(BUSINESS_LOCATION).toBe('Perth WA');
    expect(OPERATOR_LEGAL_NAME).toBe('Hesam Abbaszadi');
  });

  it('spells the display phone and the dialled phone as the SAME number', () => {
    // A footer that displays one number and dials another is worse than no
    // number at all, and the two are stored separately because a tel: href may
    // not carry spaces. Compared digit by digit rather than by eye.
    const dialled = CONTACT_PHONE_DISPLAY.replaceAll(' ', '');

    expect(dialled.startsWith('0')).toBe(true);
    expect(CONTACT_PHONE_E164).toBe('+61' + dialled.slice(1));
  });

  it('states the tagline once, in the 16 October 2026 wording', () => {
    // Moved 16 Oct 2026: the site was repositioned around missed-call text-back
    // by founder decision. The M1 quote line ("Every quote chased until it's won
    // or dead.") is now the lede's second sentence, pinned in the lede by
    // tests/marketing-copy.test.ts.
    expect(TAGLINE).toBe('Every missed call texted back in seconds.');
  });

  it('holds the listing facts the site and the Google profile must agree on', () => {
    // Pinned as literals rather than read back from the constants: these three
    // are the values a human types into the Google Business Profile by hand, and
    // a test that compared each to itself would pass through the typo that put
    // the two surfaces out of step. The Facebook URL was confirmed 19 Sep 2026;
    // the five towns are the GBP's own service area; the hours are the resolved
    // Mon–Fri 08:00–17:00 (the profile's 08:30 Monday was a typo, since fixed).
    expect(FACEBOOK_URL).toBe('https://www.facebook.com/backdeskau');
    expect(SERVICE_AREAS).toEqual(['Perth', 'Mandurah', 'Midland', 'Joondalup', 'Rockingham']);
    expect(OPENING_HOURS).toEqual({
      days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      opens: '08:00',
      closes: '17:00',
    });
  });

  it('names the service area WITHOUT a street, and starts it at the city it is in', () => {
    // The transparency rule the footer already keeps, one level out: the Google
    // profile is a service-area business with no public address, so neither the
    // site nor this module may carry one. The first town is the city
    // `BUSINESS_LOCATION` names, so the two never describe different places.
    expect(BUSINESS_LOCATION.startsWith(SERVICE_AREAS[0])).toBe(true);
    expect(SERVICE_AREAS.join(' ')).not.toMatch(/\d/);
    expect(SERVICE_AREAS).not.toContain('Formersuburb'); // former suburb name removed from the public export
  });

  it('renders the locked footer identity line with the ABN segment', () => {
    expect(footerIdentityLine(BUSINESS_ABN)).toBe(
      'Backdesk · ABN 00 000 000 000 · Perth WA · hello@backdesk.com.au · 0491 578 888',
    );
  });

  it('DROPS the ABN segment when there is no ABN — never a placeholder (D-16)', () => {
    // The transparency prohibition made checkable. A future entity change sets
    // the constant to null; the line that results must read as a complete
    // footer with one fewer fact, not as a footer with a hole in it.
    const line = footerIdentityLine(null);

    expect(line).toBe('Backdesk · Perth WA · hello@backdesk.com.au · 0491 578 888');
    expect(line).not.toContain('ABN');
    expect(line).not.toContain('· ·');
    expect(line).not.toMatch(/·\s*$/);
  });

  it('treats an empty ABN exactly like a missing one', () => {
    // An empty string is what a cleared field yields, and it is falsy — but
    // only if the builder tests truthiness rather than `!== null`. The failure
    // this catches is a line reading `Backdesk · ABN  · Perth WA…`.
    expect(footerIdentityLine('')).toBe(footerIdentityLine(null));
    expect(footerIdentityLine('')).not.toContain('ABN');
  });

  it('can never print a placeholder ABN, whatever it is handed', () => {
    // The LAND-05 prohibition, as a test. The builder has one input, so the
    // only shapes it can emit are the ones enumerated here — this pins that
    // none of them carries the giveaways of an invented number.
    for (const abn of [BUSINESS_ABN, null, '']) {
      const line = footerIdentityLine(abn);

      expect(line).not.toContain('ABN [');
      expect(line).not.toMatch(/TBD|TODO|XXX|placeholder/i);
      expect(line.startsWith(SERVICE_NAME)).toBe(true);
    }
  });
});

describe('the A4 footers render the identity from the module (D-16)', () => {
  const A4_PAGES = [
    'src/app/(console)/audits/[id]/page.tsx',
    'src/app/(console)/reports/[client]/[reportId]/page.tsx',
  ];

  it.each(A4_PAGES)('%s builds its footer line with footerIdentityLine', (path) => {
    const source = readFileSync(path, 'utf8');

    expect(source).toContain('footerIdentityLine');
    // The DISPLAY form since 09-11: a printed page is the one surface where a
    // number broken over a line break cannot be re-flowed by the reader.
    expect(source).toContain('ABN_DISPLAY');
  });

  it.each(A4_PAGES)('%s keeps no ABN digits of its own', (path) => {
    // The printed audit and the printed report are the two documents that leave
    // the building. An ABN typed into either of them is a second spelling of a
    // legal identifier, which is the exact failure D-17 moved these constants
    // into one module to prevent.
    const source = readFileSync(path, 'utf8');

    expect(source).not.toContain('00 000 000 000');
    expect(source).not.toMatch(/\bABN\b/);
  });
});

describe('login page renders the name from the module (D-11)', () => {
  it('imports SERVICE_NAME and renders it, with no literal left behind', () => {
    const source = readFileSync('src/app/login/page.tsx', 'utf8');

    expect(source).toContain("from '@/core/brand'");
    expect(source).toContain('{SERVICE_NAME}');
    expect(source).not.toMatch(LEGACY_NAME);
  });
});

describe('console and print surfaces render the name from the module (D-01, D-04)', () => {
  const SURFACES = [
    'src/app/layout.tsx',
    'src/app/(console)/layout.tsx',
    'src/app/(console)/audits/[id]/page.tsx',
    'src/app/(console)/reports/[client]/[reportId]/page.tsx',
    // The public site's shell (09-05). It is the ONE surface where a stranger
    // reads the name, the ABN and both contact details in the same breath, and
    // it renders all four from this module rather than from four literals.
    'src/app/(marketing)/layout.tsx',
  ];

  it.each(SURFACES)('%s imports the brand module and keeps no legacy literal', (path) => {
    const source = readFileSync(path, 'utf8');

    expect(source).toContain("from '@/core/brand'");
    expect(source).not.toMatch(LEGACY_NAME);
  });

  it('drives the root title default, template and description from the module', () => {
    const source = readFileSync('src/app/layout.tsx', 'utf8');

    // A page that sets its own title (login: "Sign in") renders through the
    // TEMPLATE; the default is what a page without one falls back to. Both must
    // come from the same constant or the two paths disagree on the name.
    expect(source).toContain('default: SERVICE_NAME');
    expect(source).toContain('template: `%s · ${SERVICE_NAME}`');
    expect(source).toContain('description: CONSOLE_DESCRIPTION');
  });

  it('leaves no local SERVICE_NAME constant on either A4 page', () => {
    for (const path of [
      'src/app/(console)/audits/[id]/page.tsx',
      'src/app/(console)/reports/[client]/[reportId]/page.tsx',
    ]) {
      expect(readFileSync(path, 'utf8')).not.toMatch(/^const SERVICE_NAME\b/m);
    }
  });

  it('renders the name as an escaped text node on both A4 pages', () => {
    // The BRAND-01 encoding edge: nothing on the print pages injects raw HTML, so
    // a business or service name is React-escaped by construction — this module
    // does no escaping of its own and must never need to.
    for (const path of [
      'src/app/(console)/audits/[id]/page.tsx',
      'src/app/(console)/reports/[client]/[reportId]/page.tsx',
    ]) {
      expect(readFileSync(path, 'utf8')).not.toContain('dangerouslySetInnerHTML');
    }
  });
});

/* ------------------------------------------------------------------------- *
 * BRAND-03 — what a customer actually reads
 *
 * The builders are asserted above in isolation; these assert them where they
 * land. A phrasing that is right in `brand.ts` and wrong in the header a mail
 * client renders is the failure this pair of blocks exists to separate.
 * ------------------------------------------------------------------------- */

describe('BRAND-03 rendered surfaces — the cadence email', () => {
  it('sends AS the tradie, THROUGH Backdesk, in the one line every client shows', () => {
    expect(message().from).toBe(`"Dave's Electrical via Backdesk" <${IDENTITY.fromAddress}>`);
  });

  it('carries the locked identity line in BOTH bodies (Spam Act, D-01)', () => {
    const built = message();

    // html and text, because a mail client picks one and the customer never
    // sees the other — an identification present in only one is absent for
    // whoever was shown the other.
    expect(built.html).toContain("Sent by Backdesk on behalf of Dave's Electrical.");
    expect(built.text).toContain("Sent by Backdesk on behalf of Dave's Electrical.");
  });

  it('names the tradie FIRST — in the display name and in the subject (ordering)', () => {
    const built = message();

    expect(built.from.indexOf("Dave's Electrical")).toBeLessThan(built.from.indexOf('Backdesk'));
    expect(built.subject).toBe("Quote follow-up from Dave's Electrical");
    expect(built.subject).not.toContain('Backdesk');
  });

  it('stays unambiguous when the trading name CONTAINS the service name (adjacency)', () => {
    // "Backdesk Plumbing" is a tradie, not us. The via-shape is what keeps the
    // two readable as two.
    expect(message('Backdesk Plumbing').from).toBe(
      `"Backdesk Plumbing via Backdesk" <${IDENTITY.fromAddress}>`,
    );
  });

  it('SANITISES BEFORE IT BRANDS — CR/LF and quoting characters never reach the header (T-8-01)', () => {
    const built = message('\r\nBcc: x@example.test');

    expect(built.from).not.toMatch(/[\r\n]/);
    // Exactly two quotes — one at each end of the display name — and no angle
    // bracket inside it, so the `<address>` beside it cannot be rewritten.
    expect(built.from.match(/"/g)).toHaveLength(2);
    expect(built.from.slice(1, built.from.lastIndexOf('"'))).not.toMatch(/[<>]/);
    expect(built.from).toBe(`"Bcc: x@example.test via Backdesk" <${IDENTITY.fromAddress}>`);
  });

  it('leaves a non-ASCII trading name intact (encoding)', () => {
    // The sanitiser strips control characters and the four quoting characters —
    // accents are neither, and a rebrand that mangled them would rename a client.
    expect(message("Zoë's Électrique").from).toBe(
      `"Zoë's Électrique via Backdesk" <${IDENTITY.fromAddress}>`,
    );
  });
});

describe('BRAND-03 rendered surfaces — the unsubscribe page', () => {
  it('names Backdesk on behalf of a business it deliberately does not resolve', async () => {
    const body = await (await GET()).text();

    expect(body).toContain('Sent by Backdesk on behalf of the business that quoted you.');
    expect(body).not.toMatch(LEGACY_NAME);
  });

  it('is BYTE-IDENTICAL across calls — the footer resolves no tenant (T-8-09)', async () => {
    // The generic wording is the point: a page that named the business would
    // render differently for a real token than for a forged one, which is the
    // oracle the whole route is built to avoid.
    const first = await (await GET()).text();
    const second = await (await GET()).text();

    expect(second).toBe(first);
  });
});

/* ------------------------------------------------------------------------- *
 * BRAND-01 acceptance — the grep, as a test (D-10)
 *
 * D-10 makes "a repo-wide grep for the legacy name in `src/` returns nothing"
 * the acceptance criterion for BRAND-01. A grep run once at the end of a phase
 * proves a fact about one afternoon; the walk below proves it on every CI run,
 * which is what stops the name coming back in a file nobody re-greps.
 * ------------------------------------------------------------------------- */

describe('BRAND-01 acceptance: the grep, as a test (D-10)', () => {
  /** Every source file under `src/`, and nothing outside it. */
  const FILES = readdirSync('src', { recursive: true })
    .map((entry) => join('src', String(entry)))
    .filter((path) => statSync(path).isFile() && /\.(tsx?|css|mjs)$/.test(path));

  it('names the legacy service NOWHERE under src/ — COMMENTS INCLUDED', () => {
    // Deliberately NOT comment-stripped, unlike `tests/cron-schedules.test.ts`'s
    // literal-URL scan. D-01 says no literal may remain in `src/`, and the header
    // comments in the sender and the alert modules described the service by its
    // old name in prose a reader would believe.
    const offenders = FILES.filter((path) => LEGACY_NAME.test(readFileSync(path, 'utf8')));

    expect(offenders).toEqual([]);
  });

  it('names the former SUBURB nowhere under src/ either (G-09-3, UAT 10 Sep 2026)', () => {
    // The operator read the live footer and asked for the suburb gone: a sole
    // trader working from home has no premises to publish, and the footer's job
    // is done by the ABN, the city and the two ways to reach a person. Written
    // as the same walk rather than as a grep run once, for the same reason the
    // rule above is — the string comes back in the file nobody re-greps, and it
    // would come back into a PUBLIC footer.
    const offenders = FILES.filter((path) => /Formersuburb/i.test(readFileSync(path, 'utf8'))); // former suburb name removed from the public export

    expect(offenders).toEqual([]);
  });

  it('reads only src/ — package.json keeps its name under the BRAND-01 carve-out', () => {
    // The adjacency rule made checkable: the npm package name is exempt, and the
    // way it stays exempt is that this walk provably never opens the file.
    expect(FILES.filter((path) => !path.startsWith('src/'))).toEqual([]);
    // A walk that returned nothing would pass the assertion above for the wrong
    // reason — a green test proving only that it read no files.
    expect(FILES.length).toBeGreaterThan(20);
  });
});
