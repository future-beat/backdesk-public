/**
 * THE PRIVACY NOTICE SAYS WHAT THE SYSTEM ACTUALLY DOES (LAND-05, D-16).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Two sentences on this page are pinned BYTE FOR BYTE, and they are the    │
 * │ two that could be repudiated: where the data is held, and who processes  │
 * │ it outside Australia. AU residency is a selling point, which is exactly  │
 * │ why the page may not claim more of it than is true — storage is in       │
 * │ Sydney; the sending of a message and the drafting of one are not.        │
 * │ A softened wording here is a misrepresentation, not a copy edit (T-9-28).│
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The retention numbers are asserted for presence rather than derived from the
 * schema constants on purpose: this suite's job is that the PAGE states a
 * period a reader can hold us to. That the code keeps it is 09-03's purge test.
 *
 * Structural over the page source and value-level over the copy: a `.tsx`
 * module cannot be imported here without React, and what matters about the page
 * is that it renders these sections, in this order, from that module.
 *
 * 2026-10 (D-11, Phase 12): the notice grew an eighth section for the people
 * who call a client, placed after "What we collect", and Twilio became a named
 * processor in a NEW sentence. The heading list, the "eight sections" titles
 * and the callers block below moved deliberately; the two byte-for-byte
 * sentences did not.
 *
 * 2026-10 (D-05/D-06, Phase 15, COMP-01/COMP-02): the callers section's
 * processors paragraph now says where each provider runs, and its last
 * paragraph states the ninety-day pseudonymisation the nightly pass enforces.
 * The D-22 test that refused a ninety-day promise FLIPPED by design — the
 * promise is now one the code keeps — and a dated describe pins the new
 * literals, the arming predicate and the first text's plain-text pointer. The
 * byte-pinned sentences did not move.
 *
 * 2026-10-15 (15-REVIEW WR-03): the processors sentence MOVED by design. It
 * listed ClickSend among the providers processing content outside Australia
 * while the callers section called it an Australian provider; the notice now
 * says one thing (ClickSend Australian; Resend and Anthropic offshore), and a
 * cross-section assertion keeps it so. The landing footer says "Email and AI
 * providers" to match.
 *
 * PURE. Runs bare, with NO ALLOW_REMOTE_TESTS.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { PRIVACY_COPY } from '../src/app/(marketing)/copy';
import { APEX_DOMAIN } from '../src/core/brand';
import { PSEUDONYMISE_CONVERTED_MAX_DAYS } from '../src/core/leads/constants';
import { TEXT_BACK_PRIVACY_POINTER } from '../src/core/leads/template';
import {
  PRIVACY_CALLERS_SECTION_ID,
  privacyCoversCallers,
} from '../src/core/onboarding/privacy-coverage';

const PAGE = readFileSync('src/app/(marketing)/privacy/page.tsx', 'utf8');

/** Every sentence in the notice, flattened, for the presence checks. */
const TEXT = [
  PRIVACY_COPY.h1,
  PRIVACY_COPY.dateLine,
  ...PRIVACY_COPY.sections.flatMap((section) => [section.h2, ...section.paragraphs]),
].join('\n');

function section(id: string) {
  const found = PRIVACY_COPY.sections.find((candidate) => candidate.id === id);

  expect(found, `no section with id ${id}`).toBeDefined();
  return found!;
}

describe('the notice has the APP 1/5 shape (D-16)', () => {
  it('carries the eight headings, in order', () => {
    expect(PRIVACY_COPY.sections.map((s) => s.h2)).toEqual([
      'What we collect',
      'If you called a business that uses Backdesk',
      'Why we collect it',
      'Where it is held',
      'Who else processes it',
      'How long we keep it',
      'Your access and correction',
      'Contact',
    ]);
  });

  it('says who is behind the service, with the ABN (D-16)', () => {
    expect(PRIVACY_COPY.dateLine).toContain(
      'Backdesk is operated by Hesam Abbaszadi, Perth WA',
    );
    // U+00A0 between the groups, not a space: the notice is read on a phone,
    // and this is the line that broke the number in half at UAT (G-09-5).
    expect(PRIVACY_COPY.dateLine).toContain('ABN 00\u00A0000\u00A0000\u00A0000');
    expect(PRIVACY_COPY.dateLine).not.toContain('00 000 000 000');
    expect(PRIVACY_COPY.dateLine).toMatch(/Last updated \d{1,2} \w+ 2026\./);
  });

  it('every section says something: no heading with an empty body', () => {
    for (const s of PRIVACY_COPY.sections) {
      expect(s.paragraphs.length, s.h2).toBeGreaterThan(0);
      for (const paragraph of s.paragraphs) expect(paragraph.length).toBeGreaterThan(40);
    }
  });
});

describe('the two load-bearing sentences, byte for byte (T-9-28, LAND-05)', () => {
  it('names Sydney as where it is held', () => {
    expect(section('where').paragraphs).toContain(
      'Your details and any file you attach are stored with Supabase in Sydney, Australia.',
    );
  });

  it('names the providers that process content offshore, and the one that does not', () => {
    // MOVED BY DESIGN 2026-10-15 (15-REVIEW WR-03): the old sentence put
    // ClickSend among the providers processing content outside Australia while
    // the callers section called it Australian. ClickSend is the Australian
    // SMS provider (D-05); Resend (email) and Anthropic (drafting) are the
    // offshore ones. One fact, stated the same way everywhere.
    expect(section('processors').paragraphs).toContain(
      'Email is sent through Resend and message drafting uses Anthropic; these providers process content outside Australia. SMS is sent through ClickSend, an Australian provider.',
    );
  });

  it('never says ClickSend is offshore in one place and Australian in another (WR-03)', () => {
    // Every clause naming ClickSend, across the whole notice: none of them
    // puts it outside Australia, and both sections that name it call it
    // Australian.
    const clauses = PRIVACY_COPY.sections
      .flatMap((s) => s.paragraphs)
      .flatMap((p) => p.split(/(?<=[.;])\s+/))
      .filter((clause) => clause.includes('ClickSend'));

    expect(clauses.length).toBeGreaterThanOrEqual(2);
    for (const clause of clauses) {
      expect(clause, clause).not.toMatch(/outside Australia/);
      expect(clause, clause).toMatch(/an Australian provider/);
    }
  });

  it('refuses the stronger claim it would be easy to make', () => {
    // The LAND-05 prohibition as a test: nowhere on this page may the service
    // claim that everything stays in Australia.
    expect(TEXT).not.toMatch(/(all|entirely|fully|only)[^.]{0,40}in Australia/i);
  });
});

describe('the notice covers the people who call a client (D-11, COMP-01 callers section)', () => {
  const callers = () => section(PRIVACY_CALLERS_SECTION_ID).paragraphs.join(' ');

  it('sits directly after "What we collect"', () => {
    const ids = PRIVACY_COPY.sections.map((s) => s.id);

    expect(ids.indexOf('callers')).toBe(ids.indexOf('collect') + 1);
  });

  it('says what is captured, that the call is not recorded, and what a withheld number means', () => {
    const text = callers();

    expect(text).toContain('not recorded');
    expect(text).toContain('withheld');
    expect(text).toContain('one text message');
  });

  it('names both offshore processors a caller meets, and how to stop', () => {
    const text = callers();

    expect(text).toContain('Twilio');
    expect(text).toContain('ClickSend');
    expect(text).toContain('outside Australia');
    expect(text).toContain('STOP');
  });

  it('states the ninety-day pseudonymisation the code now enforces (D-22 → COMP-02)', () => {
    // FLIPPED 2026-10 (Phase 15, COMP-02): the Phase 12 D-22 placeholder
    // promise ("for the term of their agreement") is replaced by the
    // pseudonymisation statement, because the nightly pass now keeps it
    // (src/core/leads/pseudonymise.ts; proven by tests/pseudonymise.test.ts).
    // The flip is the feature, not a regression: the assertion that refused a
    // ninety-day mention and the one that required the old phrase are gone.
    const text = callers();

    expect(text).toMatch(/ninety days|90 days/i);
    expect(text).toContain('STOP');
    expect(text).toMatch(/kept for as long as it is needed/);
    expect(text).toMatch(/remove your number sooner/);
  });

  it('states the ceiling on a customer\'s number (15-REVIEW WR-02), the one the long-stop keeps', () => {
    // PSEUDONYMISE_CONVERTED_MAX_DAYS = 365: a converted lead is due a year
    // after it converted whatever its job's state, so the promise has an end.
    expect(PSEUDONYMISE_CONVERTED_MAX_DAYS).toBe(365);
    expect(callers()).toContain(
      'If you became a customer, we keep your number until the job is finished and for 90 days after that, and no later than 12 months after you booked.',
    );
  });

  it('names Twilio in the processors section as a NEW paragraph, beside the pinned one', () => {
    expect(section('processors').paragraphs).toContain(
      'If you called a business that uses Backdesk, the call is answered through Twilio. Twilio processes the call details outside Australia.',
    );
  });

  it('is what the arm action checks: privacyCoversCallers is true for the shipped copy', () => {
    expect(privacyCoversCallers(PRIVACY_COPY.sections)).toBe(true);
  });

  it('privacyCoversCallers is false without the callers section', () => {
    const without = PRIVACY_COPY.sections.filter((s) => s.id !== PRIVACY_CALLERS_SECTION_ID);

    expect(without).toHaveLength(PRIVACY_COPY.sections.length - 1);
    expect(privacyCoversCallers(without)).toBe(false);
  });

  it('privacyCoversCallers is false when the section names only one of the two providers', () => {
    const reduced = (drop: string) =>
      PRIVACY_COPY.sections.map((s) =>
        s.id === PRIVACY_CALLERS_SECTION_ID
          ? { id: s.id, paragraphs: s.paragraphs.map((p) => p.replaceAll(drop, 'a provider')) }
          : s,
      );

    // Replace the name rather than drop the paragraph: the paragraph that names
    // one also names the other, so dropping it would test nothing.
    expect(privacyCoversCallers(reduced('Twilio'))).toBe(false);
    expect(privacyCoversCallers(reduced('ClickSend'))).toBe(false);
  });

  it('the predicate module depends on nothing', () => {
    const source = readFileSync('src/core/onboarding/privacy-coverage.ts', 'utf8')
      .replaceAll(/\/\*[\s\S]*?\*\//g, '')
      .replaceAll(/^\s*\/\/.*$/gm, '');

    expect(source).not.toMatch(/\bimport\b/);
    expect(source).not.toMatch(/\brequire\(/);
  });
});

describe('the retention promises are stated as periods a reader can hold us to', () => {
  it('states the 30-day life of an uploaded export (09-03)', () => {
    const retention = section('retention').paragraphs.join(' ');

    expect(retention).toContain('30 days');
    expect(retention).toMatch(/export|file/i);
  });

  it('states how long the request details and client records are kept', () => {
    const retention = section('retention').paragraphs.join(' ');

    expect(retention).toContain('12 months');
    expect(retention).toContain('7 years');
  });
});

describe('the page renders the notice, and nothing raw', () => {
  it('has exactly one h1 and renders the eight sections from the copy module', () => {
    expect(PAGE.split('<h1').length - 1).toBe(1);
    expect(PAGE).toContain('PRIVACY_COPY');
    expect(PAGE).toContain('aria-labelledby');
  });

  it('injects no raw HTML — every sentence is an escaped text node', () => {
    expect(PAGE).not.toContain('dangerouslySetInnerHTML');
  });

  it('gives the reader two ways to reach a person', () => {
    const contact = section('contact');

    // Narrowed by presence: the contact section is the only one carrying the
    // two links, and the type says so — which is itself the assertion that a
    // future section cannot quietly grow a second, different phone number.
    if (!('email' in contact)) throw new Error('the contact section lost its details');

    expect(contact.email).toBe('hello@backdesk.com.au');
    expect(contact.phoneDisplay).toBe('0491 578 888');
    expect(PAGE).toContain('mailto:');
    expect(PAGE).toContain('tel:');
  });

  it('is linked from the form a stranger fills in BEFORE they submit it (LAND-05)', () => {
    // The consent line's link is the whole point of the notice existing: a
    // policy nobody can find before they type is not a disclosure.
    const form = readFileSync('src/app/(marketing)/audit/form.tsx', 'utf8');

    expect(form).toContain('/privacy');
    expect(form).toContain('consent');
  });
});

/**
 * 2026-10 (Phase 15, D-05, COMP-01): THE CALLERS SECTION REVIEWED FOR HONESTY.
 * Who processes a caller's details and where, the arming predicate over the
 * shipped copy, and the first text's plain-text pointer — which must equal the
 * page this notice is served at, and must never be a link.
 */
describe('the reviewed callers section (Phase 15, D-05)', () => {
  const callers = () => section(PRIVACY_CALLERS_SECTION_ID).paragraphs.join(' ');

  it('names every processor a caller meets, and where it runs', () => {
    const text = callers();

    for (const literal of ['Twilio', 'ClickSend', 'Anthropic', 'Supabase', 'Vercel', 'Sydney', 'United States']) {
      expect(text).toContain(literal);
    }
  });

  it('never names a processor the product does not use', () => {
    expect(TEXT).not.toMatch(/Bedrock/);
  });

  it('privacyCoversCallers over the shipped copy is true — the arm action\'s exact call', () => {
    expect(privacyCoversCallers(PRIVACY_COPY.sections)).toBe(true);
  });

  it('the first text\'s pointer is this page, in plain text', () => {
    expect(TEXT_BACK_PRIVACY_POINTER).toBe(`${APEX_DOMAIN}/privacy`);
    expect(TEXT_BACK_PRIVACY_POINTER).not.toContain('http');
  });
});
