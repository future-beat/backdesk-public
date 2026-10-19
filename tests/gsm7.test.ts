/**
 * Known-answer pins for the septet arithmetic behind D-03's segment cap.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ EVERY NUMBER IN THIS FILE IS A PUBLISHED LIMIT, NOT AN OBSERVATION.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * That distinction is the entire value of the suite. GSM 03.38 was frozen in
 * 2003: 160 septets in a single message, 153 per segment once a message is
 * concatenated, two septets for each of the nine extension characters, and a
 * whole-message flip to UCS-2 the moment one character falls outside the table.
 * Those are facts about the world, so a test asserting them can only fail if
 * `gsm7.ts` is wrong — which is what separates a known-answer test from one
 * written by running the code and pasting what came out.
 *
 * The failure this guards against is expensive and silent: `body.length / 153`
 * (the tracer's interim arm) says a 150-character message with one curly
 * apostrophe is one segment. It is three, at ~7.9c each, and nothing anywhere
 * reports the difference except the invoice.
 *
 * PURE — no database, no credentials, runs on a bare `npm test`.
 */
import { describe, expect, it } from 'vitest';

import {
  countSeptets,
  GSM_BASIC_SIZE,
  GSM_EXTENDED_SIZE,
  normalizeForGsm7,
  segmentCount,
} from '../src/core/drafting/gsm7';

/** A body of `n` plain ASCII letters — every one a 1-septet basic character. */
function basic(n: number): string {
  return 'a'.repeat(n);
}

/** The septet count, or a failure if the body unexpectedly flipped to UCS-2. */
function septetsOf(body: string): number {
  const result = countSeptets(body);
  if (result.encoding !== 'gsm7') {
    throw new Error(`expected gsm7, got ucs2 on: ${result.unsupported.join('')}`);
  }
  return result.septets;
}

describe('the character tables', () => {
  /**
   * 127, not 128: the basic table has 128 slots and 0x1B is ESC, which is a
   * transmission byte rather than a character. A table that counted 128 would
   * mean ESC had been included as though somebody could type it.
   */
  it('has 127 basic characters (128 slots less ESC)', () => {
    expect(GSM_BASIC_SIZE).toBe(127);
  });

  /**
   * EXACTLY NINE. A tenth member would mean a character was granted 2-septet
   * status it does not have, which under-counts every message containing it —
   * the direction that bills a 3-segment send as 2 and blows past D-03's cap.
   */
  it('has exactly nine extension characters', () => {
    expect(GSM_EXTENDED_SIZE).toBe(9);
  });

  /**
   * The counter-intuitive half of the table, and the reason the tracer's
   * "non-ASCII is expensive" proxy had to go: these cost exactly one septet.
   */
  it('treats the non-ASCII basics as one septet each', () => {
    for (const ch of ['£', '¥', '§', '¡', '¿', 'é', 'è', 'ù', 'ì', 'ò', 'Ç', 'Ø', 'Å', 'ä', 'ö', 'ñ', 'ü', 'à', 'ß', 'Æ', '¤']) {
      expect(septetsOf(ch)).toBe(1);
    }
  });
});

describe('countSeptets', () => {
  it('counts an empty body as zero septets', () => {
    expect(septetsOf('')).toBe(0);
  });

  it('counts basic characters at one septet each', () => {
    expect(septetsOf(basic(160))).toBe(160);
    expect(septetsOf('Hi Sarah, the quote is ready.')).toBe(29);
  });

  /**
   * Each of the nine, individually. Asserted one at a time rather than as a
   * joined string so a failure names the character that is mis-tabled.
   */
  it('counts each extension character at two septets', () => {
    for (const ch of ['^', '{', '}', '\\', '[', ']', '~', '|', '€']) {
      expect(septetsOf(ch)).toBe(2);
    }
  });

  /**
   * THE PITFALL-2 CASE. One smart quote in an otherwise plain sentence is not
   * "one more septet" — it is a different encoding for the entire message.
   */
  it('reports a UCS-2 flip for a single curly apostrophe', () => {
    const result = countSeptets("it's fine".replace("'", '’'));
    expect(result.encoding).toBe('ucs2');
    if (result.encoding !== 'ucs2') throw new Error('unreachable');
    expect(result.unsupported).toEqual(['’']);
  });

  it('reports each unsupported character once, in first-appearance order', () => {
    const result = countSeptets('a’b—c’d');
    if (result.encoding !== 'ucs2') throw new Error('expected a UCS-2 flip');
    expect(result.unsupported).toEqual(['’', '—']);
  });

  /**
   * Code points, not UTF-16 units. An emoji reported as two lone surrogates is
   * a violation message no human and no model can act on.
   */
  it('reports an astral emoji as ONE unsupported code point', () => {
    const result = countSeptets('thanks 👍');
    if (result.encoding !== 'ucs2') throw new Error('expected a UCS-2 flip');
    expect(result.unsupported).toEqual(['👍']);
  });

  it('accepts the newline and carriage return that are in the table', () => {
    expect(septetsOf('a\nb\rc')).toBe(5);
  });

  /**
   * TAB IS NOT IN GSM 03.38. Over-strict in the safe direction: a draft with a
   * tab is refused and regenerated, which costs one API call. The alternative —
   * treating it as free — costs a segment nobody predicted.
   */
  it('rejects a tab, which is not in the table', () => {
    expect(countSeptets('a\tb').encoding).toBe('ucs2');
  });
});

describe('segmentCount', () => {
  it('floors an empty body at one segment (vacuous, documented)', () => {
    expect(segmentCount(0)).toBe(1);
  });

  it('fits 160 septets in a single segment', () => {
    expect(segmentCount(160)).toBe(1);
    expect(segmentCount(septetsOf(basic(160)))).toBe(1);
  });

  /**
   * 161 is TWO segments, not "160 plus a bit": concatenation adds a 7-septet
   * user-data header to every part, so the per-segment budget drops to 153.
   */
  it('spills 161 septets into two segments of 153', () => {
    expect(segmentCount(161)).toBe(2);
    expect(segmentCount(septetsOf(basic(161)))).toBe(2);
  });

  /**
   * THE D-03 BOUNDARY, pinned on both sides. The cap is "over 2 segments", so
   * 306 septets (2 x 153) must PASS the count that 307 must fail.
   */
  it('pins the 2-vs-3 segment boundary at 306/307 septets', () => {
    expect(segmentCount(306)).toBe(2);
    expect(segmentCount(307)).toBe(3);
    expect(segmentCount(septetsOf(basic(306)))).toBe(2);
    expect(segmentCount(septetsOf(basic(307)))).toBe(3);
  });

  /**
   * A euro sign in the 160th position costs two septets, so the message is 161
   * septets and TWO segments while `String.length` still reads 160. This is the
   * exact case a character-counting implementation gets wrong.
   */
  it('spills into two segments when a euro sign lands at position 160', () => {
    const body = basic(159) + '€';
    expect(body.length).toBe(160);
    expect(septetsOf(body)).toBe(161);
    expect(segmentCount(septetsOf(body))).toBe(2);
  });
});

describe('normalizeForGsm7', () => {
  it('repairs every documented lookalike', () => {
    expect(normalizeForGsm7('it’s')).toBe("it's");
    expect(normalizeForGsm7('‘quoted’')).toBe("'quoted'");
    expect(normalizeForGsm7('“quoted”')).toBe('"quoted"');
    expect(normalizeForGsm7('a – b')).toBe('a - b');
    expect(normalizeForGsm7('a — b')).toBe('a - b');
    expect(normalizeForGsm7('wait…')).toBe('wait...');
    expect(normalizeForGsm7('a b')).toBe('a b');
  });

  it('turns a curly-quoted body into one that counts as GSM-7', () => {
    const raw = 'Hi Sarah, just checking in — it’s been a while…';
    expect(countSeptets(raw).encoding).toBe('ucs2');
    expect(countSeptets(normalizeForGsm7(raw)).encoding).toBe('gsm7');
  });

  /**
   * NOT A TRANSLITERATOR. An emoji survives normalization so the validator can
   * name it; a body edited silently on the way to a customer is worse than a
   * body refused.
   */
  it('leaves characters it cannot repair alone', () => {
    expect(normalizeForGsm7('thanks 👍')).toBe('thanks 👍');
    expect(normalizeForGsm7('café')).toBe('café');
  });

  it('is idempotent', () => {
    const raw = '“it’s fine” — really…';
    const once = normalizeForGsm7(raw);
    expect(normalizeForGsm7(once)).toBe(once);
  });
});
