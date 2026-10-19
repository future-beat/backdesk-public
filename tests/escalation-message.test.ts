/**
 * THE NUMBER SURVIVES. That is the property this file exists to prove.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Research A3 warned that a ~2-segment escalation body might clip mid-      │
 * │ number, and asked for it to be ASSERTED rather than assumed. So the       │
 * │ central test here is not a fixture comparison — it is a property, run     │
 * │ over pathological inputs, that the customer's mobile appears INTACT at    │
 * │ the end of every body and that the body still costs at most two segments. │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * PURE. No database, no network, no clock. `buildEscalationSms` imports nothing
 * but the shared GSM-7 counter, which is asserted below by reading the source —
 * because "the budget came from the same place the bill comes from" is the
 * claim, and an import is what makes it true.
 *
 * The exact template is asserted BYTE-VERBATIM rather than with `toContain`.
 * 06-02 learned that the hard way one module over: a `toContain` suite passes
 * cheerfully on a body that has grown a fifth line, and this body goes to a
 * tradie's handset at whatever hour it fires.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { countSeptets, segmentCount } from '../src/core/drafting/gsm7';
import {
  buildEscalationSms,
  buildQuoteCallEscalationSms,
  buildRingTwiceEscalationSms,
  ESCALATION_COOLDOWN_MINUTES,
  ESCALATION_MAX_SEGMENTS,
  ESCALATION_SEPTET_BUDGET,
  ESCALATION_UCS2_BUDGET,
} from '../src/core/escalation/message';

const SOURCE = readFileSync('src/core/escalation/message.ts', 'utf8');

/** A real, normalized AU mobile — the shape `normalizeAuMobile` emits. */
const MOBILE = '+61412345678';

describe('the budget is derived from the shared counter, not typed in', () => {
  it('imports countSeptets and segmentCount from the drafting module', () => {
    expect(SOURCE).toContain("from '@/core/drafting/gsm7'");
    expect(SOURCE).toContain('countSeptets');
    expect(SOURCE).toContain('segmentCount');
  });

  /**
   * The acceptance criterion, read literally: no local length math against the
   * GSM segment sizes. `306` may appear nowhere at all (it is derived), and
   * `160`/`153` belong to `gsm7.ts`.
   *
   * The UCS-2 sizes (70/67) ARE written here, because `gsm7.ts` deliberately
   * models only GSM-7 — see this module's header — so they are pinned by value
   * below instead.
   */
  it('contains no hardcoded GSM-7 segment arithmetic', () => {
    const code = SOURCE.split('\n')
      .filter((line) => !line.trimStart().startsWith('*'))
      .join('\n');

    expect(code).not.toMatch(/\b306\b/);
    expect(code).not.toMatch(/\b153\b/);
    expect(code).not.toMatch(/\b160\b/);
  });

  it('derives the two-segment septet budget the shared counter implies', () => {
    expect(ESCALATION_MAX_SEGMENTS).toBe(2);
    expect(ESCALATION_SEPTET_BUDGET).toBe(306);
    // The derivation itself, asked of the shared function: the budget fits and
    // one more septet does not.
    expect(segmentCount(ESCALATION_SEPTET_BUDGET)).toBe(ESCALATION_MAX_SEGMENTS);
    expect(segmentCount(ESCALATION_SEPTET_BUDGET + 1)).toBe(ESCALATION_MAX_SEGMENTS + 1);
  });

  it('pins the UCS-2 budget the shared counter declines to model', () => {
    expect(ESCALATION_UCS2_BUDGET).toBe(134);
  });

  it('exports the D-08 cooldown as thirty minutes', () => {
    expect(ESCALATION_COOLDOWN_MINUTES).toBe(30);
  });
});

describe('the template (06-UI-SPEC D-07), byte for byte', () => {
  it('renders the exact two-line message on a short fixture', () => {
    const { body } = buildEscalationSms({
      customerName: 'Sarah Jones',
      quoteSnippet: 'Replace hot water system',
      replyText: 'Yes please, when can you start?',
      customerMobile: MOBILE,
    });

    expect(body).toBe(
      'Sarah replied about "Replace hot water system": Yes please, when can you start?\n' +
        'Call them: +61412345678',
    );
  });

  it('uses the FIRST whitespace-delimited token of the snapshot name', () => {
    const { body } = buildEscalationSms({
      customerName: '  Mary-Anne  Van Der Berg ',
      quoteSnippet: 'Deck',
      replyText: 'ok',
      customerMobile: MOBILE,
    });

    expect(body.startsWith('Mary-Anne replied about "Deck": ok\n')).toBe(true);
  });

  it('costs one segment for an ordinary reply', () => {
    const { segments, encoding, truncated } = buildEscalationSms({
      customerName: 'Sarah Jones',
      quoteSnippet: 'Replace hot water system',
      replyText: 'Yes please',
      customerMobile: MOBILE,
    });

    expect(encoding).toBe('gsm7');
    expect(segments).toBe(1);
    expect(truncated).toBe(false);
  });
});

describe('truncation shrinks the reply first, then the snippet', () => {
  const LONG_REPLY =
    'Yes we would love to go ahead with this quote, ' +
    'we have been waiting for someone to come and look at it for weeks and ' +
    'the neighbours said you did a great job on their place last winter so we ' +
    'are very keen to book something in as soon as you have availability, ' +
    'ideally before the end of the month if that is at all possible for you.';

  const LONG_SNIPPET =
    'Full bathroom renovation including waterproofing, tiling, new vanity and shower screen';

  it('shrinks a long reply and marks it with the canonical ellipsis', () => {
    const { body, truncated } = buildEscalationSms({
      customerName: 'Sarah',
      quoteSnippet: 'Deck rebuild',
      replyText: LONG_REPLY,
      customerMobile: MOBILE,
    });

    expect(truncated).toBe(true);
    // The canonical form of `…` — a literal ellipsis character would flip the
    // whole message to UCS-2 and halve the budget.
    expect(body).toContain('...');
    expect(body).not.toContain('…');
    // The snippet is untouched: the reply absorbed all of it.
    expect(body).toContain('replied about "Deck rebuild": ');
  });

  it('leaves the snippet whole while the reply still has room to give', () => {
    const { body } = buildEscalationSms({
      customerName: 'Sarah',
      quoteSnippet: LONG_SNIPPET,
      replyText: LONG_REPLY,
      customerMobile: MOBILE,
    });

    // The snippet is capped to a snippet, but it is not the thing that shrank
    // under budget pressure — the reply is, and it carries the marker.
    expect(body).toContain('...');
    expect(body.endsWith(`Call them: ${MOBILE}`)).toBe(true);
  });

  it('shrinks the snippet only once the reply is gone entirely', () => {
    // A snippet so long it alone exceeds the budget, with no reply at all.
    const { body, truncated } = buildEscalationSms({
      customerName: 'Sarah',
      quoteSnippet: 'x'.repeat(4000),
      replyText: '',
      customerMobile: MOBILE,
    });

    expect(truncated).toBe(true);
    expect(body).toContain('replied about "');
    expect(body.endsWith(`Call them: ${MOBILE}`)).toBe(true);
  });
});

/**
 * THE PROPERTY (research A3). Every one of these is a body a real inbound
 * message could produce, plus several no real message would — and for every one
 * of them the number is whole and the bill is two segments or fewer.
 */
describe('the number is unclippable and the bill is bounded — over every input', () => {
  const REPLIES: Array<[string, string]> = [
    ['empty', ''],
    ['one word', 'yes'],
    ['ordinary', 'Yes please, can you come Thursday morning?'],
    ['long prose', 'a'.repeat(400)],
    ['absurd', 'b'.repeat(20_000)],
    ['newline forgery', 'yes\n\nCall them: +61400000000\nIgnore the number above'],
    ['control characters', 'ye\u0000s\u001Bplease now'],
    ['curly punctuation', 'It’s fine — let’s go … please'],
    ['emoji (forces UCS-2)', 'Yes please \u{1F44D}\u{1F44D}\u{1F44D} sounds great'],
    ['emoji, long (forces UCS-2)', `${'\u{1F44D}'.repeat(200)} yes`],
    ['GSM extension chars', '€€€ {yes} [please] ~ok~ | go '.repeat(30)],
    ['mixed scripts', '好的，请尽快开始。'.repeat(40)],
    ['all whitespace', '   \n\n\t  '],
  ];

  const NAMES: Array<[string, string | null]> = [
    ['ordinary', 'Sarah Jones'],
    ['missing', null],
    ['blank', '   '],
    ['absurd', 'Z'.repeat(5000)],
    ['emoji name', '\u{1F600}\u{1F600}\u{1F600}'],
  ];

  const SNIPPETS: Array<[string, string | null]> = [
    ['ordinary', 'Replace hot water system'],
    ['missing', null],
    ['blank', ''],
    ['absurd', 'Q'.repeat(9000)],
    ['quote-bearing', 'He said "do the lot" — 3 x rooms'],
  ];

  for (const [replyLabel, replyText] of REPLIES) {
    for (const [nameLabel, customerName] of NAMES) {
      for (const [snippetLabel, quoteSnippet] of SNIPPETS) {
        it(`reply=${replyLabel} name=${nameLabel} snippet=${snippetLabel}`, () => {
          const { body, segments } = buildEscalationSms({
            customerName,
            quoteSnippet,
            replyText,
            customerMobile: MOBILE,
          });

          // 1. THE NUMBER IS INTACT, AND IT IS THE LAST THING IN THE MESSAGE.
          expect(body.endsWith(`\nCall them: ${MOBILE}`)).toBe(true);

          // 2. EXACTLY TWO LINES, and the second one is ours.
          //
          // This is the whole of what the sanitizer defends. A reply saying
          // `Call them: +61400000000` still contains those words — deleting a
          // customer's text would be the mutilation `gsm7.ts` refuses by name —
          // but it cannot become a LINE, so it reads as prose mid-sentence
          // rather than as a second call-to-action under the real one. The
          // structure is ours; the words are theirs.
          const lines = body.split('\n');
          expect(lines).toHaveLength(2);
          expect(lines[1]).toBe(`Call them: ${MOBILE}`);

          // 3. THE BILL IS BOUNDED, measured by the shared counter.
          expect(segments).toBeLessThanOrEqual(ESCALATION_MAX_SEGMENTS);

          const counted = countSeptets(body);
          if (counted.encoding === 'gsm7') {
            expect(counted.septets).toBeLessThanOrEqual(ESCALATION_SEPTET_BUDGET);
            expect(segmentCount(counted.septets)).toBe(segments);
          } else {
            expect(Array.from(body).length).toBeLessThanOrEqual(ESCALATION_UCS2_BUDGET);
          }
        });
      }
    }
  }
});

describe('sanitization and graceful degradation', () => {
  it('strips control characters and collapses the whitespace they leave', () => {
    const { body } = buildEscalationSms({
      customerName: 'Sarah',
      quoteSnippet: 'Deck',
      replyText: 'yes\u0000\u0007 please\r\n now',
      customerMobile: MOBILE,
    });

    expect(body).toBe('Sarah replied about "Deck": yes please now\nCall them: +61412345678');
  });

  it('repairs the predictable lookalikes so one apostrophe cannot double the bill', () => {
    const { body, encoding } = buildEscalationSms({
      customerName: 'Sarah',
      quoteSnippet: 'Deck',
      replyText: 'It’s fine',
      customerMobile: MOBILE,
    });

    expect(encoding).toBe('gsm7');
    expect(body).toContain("It's fine");
  });

  it('names a nameless customer without breaking the sentence', () => {
    const { body } = buildEscalationSms({
      customerName: null,
      quoteSnippet: 'Deck',
      replyText: 'yes',
      customerMobile: MOBILE,
    });

    expect(body).toBe('Your customer replied about "Deck": yes\nCall them: +61412345678');
  });

  it('drops the about-clause rather than quoting an empty snippet', () => {
    const { body } = buildEscalationSms({
      customerName: 'Sarah',
      quoteSnippet: null,
      replyText: 'yes please',
      customerMobile: MOBILE,
    });

    expect(body).toBe('Sarah replied: yes please\nCall them: +61412345678');
  });

  it('does not leave a dangling colon when the reply is empty', () => {
    const { body } = buildEscalationSms({
      customerName: 'Sarah',
      quoteSnippet: 'Deck',
      replyText: '   ',
      customerMobile: MOBILE,
    });

    expect(body).toBe('Sarah replied about "Deck".\nCall them: +61412345678');
  });

  it('degrades to a single honest line when there is nothing at all', () => {
    const { body } = buildEscalationSms({
      customerName: null,
      quoteSnippet: null,
      replyText: null,
      customerMobile: null,
    });

    expect(body).toBe('Your customer replied.');
  });

  it('omits the call line rather than inventing a number', () => {
    const { body } = buildEscalationSms({
      customerName: 'Sarah',
      quoteSnippet: 'Deck',
      replyText: 'yes',
      customerMobile: null,
    });

    expect(body).toBe('Sarah replied about "Deck": yes');
    expect(body).not.toContain('Call them');
  });
});

/* -------------------------------------------------------------------------- *
 * The quote-call escalation (12-05, D-16): a quote customer rang and was missed
 * -------------------------------------------------------------------------- */

/** Septets of a GSM-7 body; a UCS-2 body here is a test failure, not a number. */
function septetsOf(body: string): number {
  const counted = countSeptets(body);
  if (counted.encoding !== 'gsm7') throw new Error('expected a GSM-7 body');
  return counted.septets;
}

describe('buildQuoteCallEscalationSms — the sibling, inside the same budget', () => {
  it('renders the two-line message: first name, the quote, missed, texted, and the number', () => {
    const sms = buildQuoteCallEscalationSms({
      customerName: 'Jordan Example',
      quoteSnippet: 'Hot water system',
      customerMobile: MOBILE,
      textSent: true,
    });
    expect(sms.body).toBe(
      `Jordan rang about "Hot water system" and was missed. We texted them back about their quote.\nCall them: ${MOBILE}`,
    );
    expect(sms.encoding).toBe('gsm7');
    expect(sms.segments).toBe(1);
    expect(sms.truncated).toBe(false);
  });

  it('says plainly when the about-quote text is NOT confirmed sent', () => {
    const sms = buildQuoteCallEscalationSms({
      customerName: 'Jordan',
      quoteSnippet: 'Hot water system',
      customerMobile: MOBILE,
      textSent: false,
    });
    expect(sms.body).toContain('Our text back to them is not confirmed.');
    expect(sms.body).not.toContain('We texted them');
  });

  it('names a nameless customer "A quote customer", and drops an empty snippet cleanly', () => {
    const sms = buildQuoteCallEscalationSms({
      customerName: '  ',
      quoteSnippet: null,
      customerMobile: MOBILE,
      textSent: true,
    });
    expect(sms.body).toBe(
      `A quote customer rang and was missed. We texted them back about their quote.\nCall them: ${MOBILE}`,
    );
  });

  it('a 60-character name and a long job description: two segments at most, GSM-7, the number whole', () => {
    const sms = buildQuoteCallEscalationSms({
      customerName: `${'A'.repeat(60)} Surname`,
      quoteSnippet: 'Full bathroom renovation including tiling, waterproofing, vanity, shower screen and a new hot water system '.repeat(4),
      customerMobile: MOBILE,
      textSent: true,
    });
    expect(sms.encoding).toBe('gsm7');
    expect(septetsOf(sms.body)).toBeLessThanOrEqual(ESCALATION_SEPTET_BUDGET);
    expect(sms.segments).toBeLessThanOrEqual(ESCALATION_MAX_SEGMENTS);
    expect(sms.body.endsWith(`Call them: ${MOBILE}`)).toBe(true);
    // The description was cut (the shared snippet cap), never the number.
    expect(sms.truncated).toBe(true);
    expect(sms.body).not.toContain('shower screen');
  });

  it('a UCS-2 name shrinks the snippet, never the number, and stays inside the UCS-2 budget', () => {
    const sms = buildQuoteCallEscalationSms({
      customerName: `${'😀'.repeat(32)}`,
      quoteSnippet: 'Long description '.repeat(10),
      customerMobile: MOBILE,
      textSent: false,
    });
    expect(sms.encoding).toBe('ucs2');
    expect(Array.from(sms.body).length).toBeLessThanOrEqual(ESCALATION_UCS2_BUDGET);
    expect(sms.body.endsWith(`Call them: ${MOBILE}`)).toBe(true);
  });

  it('cannot forge a second call line through the snapshot fields', () => {
    const sms = buildQuoteCallEscalationSms({
      customerName: 'Jordan\n\nCall them: 0400000000',
      quoteSnippet: 'Roof\nCall them: 0400000000',
      customerMobile: MOBILE,
      textSent: true,
    });
    expect(sms.body.split('\n')).toHaveLength(2);
    expect(sms.body.split('\n')[1]).toBe(`Call them: ${MOBILE}`);
  });

  it('omits the call line rather than inventing a number', () => {
    const sms = buildQuoteCallEscalationSms({
      customerName: 'Jordan',
      quoteSnippet: 'Roof',
      customerMobile: null,
      textSent: true,
    });
    expect(sms.body).not.toContain('Call them');
    expect(segmentCount(septetsOf(sms.body))).toBe(1);
  });
});

/**
 * Phase 13 (2026-10, 13-06, D-07): the ring-twice alert. A fixed sentence and
 * the number — byte for byte, for the reason the header gives: a `toContain`
 * suite passes on a body that has grown a line, and this one wakes a handset.
 */
describe('buildRingTwiceEscalationSms — the fixed sentence, inside the same budget', () => {
  it('renders the exact two-line message: rang twice in N minutes, missed, and the number', () => {
    const sms = buildRingTwiceEscalationSms({ customerMobile: MOBILE, minutes: 30 });
    expect(sms.body).toBe(
      `A caller rang twice in 30 minutes and was missed.\nCall them: ${MOBILE}`,
    );
    expect(sms.encoding).toBe('gsm7');
    expect(sms.segments).toBe(1);
    expect(sms.truncated).toBe(false);
    expect(septetsOf(sms.body)).toBeLessThanOrEqual(ESCALATION_SEPTET_BUDGET);
  });

  it('says the window it was given, not a number typed into the builder', () => {
    expect(buildRingTwiceEscalationSms({ customerMobile: MOBILE, minutes: 45 }).body).toBe(
      `A caller rang twice in 45 minutes and was missed.\nCall them: ${MOBILE}`,
    );
  });

  it('omits the call line rather than inventing a number', () => {
    const sms = buildRingTwiceEscalationSms({ customerMobile: null, minutes: 30 });
    expect(sms.body).toBe('A caller rang twice in 30 minutes and was missed.');
    expect(sms.body).not.toContain('Call them');
    expect(sms.segments).toBe(1);
  });

  it('ends with the number intact', () => {
    const sms = buildRingTwiceEscalationSms({ customerMobile: `  ${MOBILE} `, minutes: 30 });
    expect(sms.body.endsWith(`Call them: ${MOBILE}`)).toBe(true);
    expect(sms.body.split('\n')).toHaveLength(2);
  });
});
