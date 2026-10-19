/**
 * THE EMERGENCY KEYWORD RULE (Phase 13, D-06; LEAD-03), over its list.
 *
 * Pure: `isUrgentKeyword` takes a string and returns a boolean. No database,
 * no mocks, no model — it runs on a bare checkout.
 *
 * What this suite pins:
 *
 *   - THE LIST, not a regex literal. Every member of `URGENT_KEYWORDS` is hot
 *     as a whole word inside a longer sentence, and the list itself is pinned
 *     so a member silently dropped is a red test, not a quiet regression.
 *   - THE WORD BOUNDARY. "urgently", "sparky", "spark plug", "no worries" and
 *     "gas hot water quote" are cold — the research false-positive analysis.
 *   - WHITESPACE TOLERANCE in phrases: "no  power", "gas\nleak".
 *   - THE LOCKED "NOT URGENT" COST (research Open Question 4): no negation
 *     guard, so "not urgent" is hot.
 *   - NON-GLOBAL: the same body answers the same twice.
 *
 * What it does NOT pin, and where that lives: the door calls this only after
 * the STOP decision and only for a lead reply. That ordering is asserted in the
 * DB-backed `tests/lead-reply.test.ts` (CI only), through `handleInboundSms`.
 */
import { describe, expect, it } from 'vitest';

import { URGENT_KEYWORDS } from '@/core/leads/constants';
import { isUrgentKeyword } from '@/core/leads/urgency-keywords';

describe('the list (D-06, as research finalised it)', () => {
  it('is exactly the ten words and phrases, in order', () => {
    expect([...URGENT_KEYWORDS]).toEqual([
      'urgent',
      'emergency',
      'burst',
      'flooding',
      'flooded',
      'gas leak',
      'smell gas',
      'no power',
      'locked out',
      'sparking',
    ]);
  });

  it.each(URGENT_KEYWORDS)('"%s" is hot as a whole word inside a sentence', (keyword) => {
    expect(isUrgentKeyword(`hi mate, ${keyword} at the house, can you come`)).toBe(true);
  });

  it.each(URGENT_KEYWORDS)('"%s" is hot alone, and in capitals', (keyword) => {
    expect(isUrgentKeyword(keyword)).toBe(true);
    expect(isUrgentKeyword(keyword.toUpperCase())).toBe(true);
  });
});

describe('case and punctuation', () => {
  it.each([
    ['URGENT'],
    ['Urgent!'],
    ['urgent, no power'],
    ['URGENT no power'],
    ['pipe has BURST in the kitchen'],
    ['Emergency.'],
    ['(locked out)'],
    ['we can smell gas near the meter'],
  ])('%j is hot', (body) => {
    expect(isUrgentKeyword(body)).toBe(true);
  });
});

describe('the word boundary — the false-positive analysis', () => {
  it.each([
    // `\b` after URGENT: the adverb is not the keyword. Add `urgently` to the
    // list if the founder wants it; the boundary is not the place to widen.
    ['urgently'],
    ['can you get back to me urgently'],
    // `no power` is the phrase, never bare `no`.
    ['no worries'],
    ['no thanks, all good'],
    // `sparking` only — the tradie's own nickname and car parts are cold.
    ['are you the sparky?'],
    ['need a spark plug changed'],
    // `gas leak` / `smell gas` only — a hot-water quote is not an emergency.
    ['gas hot water quote please'],
    // Deliberately absent from the list (a quote, not an emergency).
    ['no hot water since monday'],
    ['bursting with excitement'],
    ['emergencyroom'],
    [''],
    ['   '],
  ])('%j is cold', (body) => {
    expect(isUrgentKeyword(body)).toBe(false);
  });
});

describe('phrases tolerate any whitespace between their words', () => {
  it.each([
    ['no  power'],
    ['no\tpower'],
    ['gas\nleak'],
    ['locked   out again'],
    ['smell\r\ngas'],
  ])('%j is hot', (body) => {
    expect(isUrgentKeyword(body)).toBe(true);
  });

  it('a phrase broken by a non-space character is cold', () => {
    expect(isUrgentKeyword('no-power')).toBe(false);
    expect(isUrgentKeyword('gasleak')).toBe(false);
  });
});

describe('the locked rule: no negation guard (research Open Question 4)', () => {
  it('"not urgent" is HOT', () => {
    // RESEARCH OPEN QUESTION 4, RESOLVED WITH THE DEFAULT: D-06 says the word
    // counts "anywhere", and the rule is implemented literally. The COST of this
    // false positive is one extra SMS to the tradie — after which the model's
    // `flexible` urgency sits on the row for the operator to read. A negation
    // guard is a one-line follow-up if the first clients report it.
    expect(isUrgentKeyword('not urgent')).toBe(true);
    expect(isUrgentKeyword("it's not an emergency, whenever suits")).toBe(true);
  });

  it('known, accepted false positives in the same direction', () => {
    // A complaint is hot under D-07 anyway; laughter at a tradie is implausible.
    expect(isUrgentKeyword('stop flooding me with texts')).toBe(true);
    expect(isUrgentKeyword('burst out laughing at that')).toBe(true);
  });
});

describe('the boundary with an untrusted payload', () => {
  it.each([[undefined], [null], [42], [{ body: 'urgent' }], [['urgent']]])(
    'a non-string (%j) is false, never a throw',
    (value) => {
      expect(isUrgentKeyword(value as unknown as string)).toBe(false);
    },
  );

  it('is not a global regex: the same body answers the same every time', () => {
    for (let i = 0; i < 5; i += 1) {
      expect(isUrgentKeyword('URGENT no power')).toBe(true);
      expect(isUrgentKeyword('no worries')).toBe(false);
    }
  });
});
