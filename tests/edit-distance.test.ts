/**
 * Known-answer pins for the AI-04 metric.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE METRIC IS A STORED RECORD, SO ITS DEFINITION IS A CONTRACT. These    │
 * │ tests exist so that redefining it is a visible diff rather than a quiet  │
 * │ discontinuity in a column nobody re-derives.                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * "How much do operators edit our drafts?" is answered by averaging a column of
 * these numbers over months. If the definition shifts — a different tie-break, a
 * different length denominator, UTF-16 units instead of code points — the old
 * and new rows stop being comparable and NOTHING SAYS SO. The average just moves,
 * and it looks like the model got better or worse.
 *
 * So the pins below are algebraic properties (identity, symmetry, 1/n) and
 * published known answers, not values observed by running the implementation.
 *
 * PURE — no database, no credentials, runs on a bare `npm test`.
 */
import { describe, expect, it } from 'vitest';

import { editDistance, normalizedEditDistance } from '../src/core/drafting/edit-distance';

/** A realistic draft, so the properties are pinned at the length they run at. */
const DRAFT =
  'Hi Sarah, just checking in on that meter box quote from 12 August, $2,450. Any questions? Mick';

describe('editDistance (raw)', () => {
  /**
   * THE published pair. Wagner-Fischer's own example: kitten -> sitting is
   * three edits (k->s, e->i, +g). A value other than 3 means the recurrence is
   * wrong, and this is the case that says so without ambiguity.
   */
  it('is 3 for kitten/sitting', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });

  it('is 3 for saturday/sunday', () => {
    expect(editDistance('saturday', 'sunday')).toBe(3);
  });

  it('is 0 for identical strings', () => {
    expect(editDistance(DRAFT, DRAFT)).toBe(0);
  });

  it('is the length of the other string when one is empty', () => {
    expect(editDistance('', 'abcd')).toBe(4);
    expect(editDistance('abcd', '')).toBe(4);
    expect(editDistance('', '')).toBe(0);
  });

  it('counts a single insertion, deletion and substitution as one each', () => {
    expect(editDistance('quote', 'quotes')).toBe(1); // insertion
    expect(editDistance('quotes', 'quote')).toBe(1); // deletion
    expect(editDistance('quote', 'quota')).toBe(1); // substitution
  });

  /**
   * CODE POINTS, NOT UTF-16 UNITS. `'👍'.length` is 2, so a length-based
   * implementation scores adding one emoji as two edits — and inflates every
   * distance on a body containing one.
   */
  it('counts an astral emoji as ONE code point', () => {
    expect(editDistance('ok', 'ok👍')).toBe(1);
    expect(editDistance('👍', '')).toBe(1);
    expect(editDistance('👍', '👎')).toBe(1);
  });
});

describe('normalizedEditDistance', () => {
  it('is 0 for a draft compared with itself (identity)', () => {
    expect(normalizedEditDistance(DRAFT, DRAFT)).toBe(0);
    expect(normalizedEditDistance('', '')).toBe(0);
  });

  /**
   * The both-empty guard, stated as the thing it prevents. Without it the
   * denominator is zero, the result is NaN, and NaN in a numeric column either
   * throws at the driver or silently poisons every average taken over it.
   */
  it('never returns NaN', () => {
    expect(Number.isNaN(normalizedEditDistance('', ''))).toBe(false);
  });

  /** A completely rewritten draft is 1 — the upper bound of the scale. */
  it('is 1 when one side is empty', () => {
    expect(normalizedEditDistance(DRAFT, '')).toBe(1);
    expect(normalizedEditDistance('', DRAFT)).toBe(1);
  });

  /**
   * ONE SUBSTITUTION ON A LENGTH-N STRING IS EXACTLY 1/N. This is the property
   * that makes the number mean "the fraction of the draft that changed", and
   * the one a different denominator (either operand rather than the longer)
   * would break.
   */
  it('scores a single substitution on a length-n string as exactly 1/n', () => {
    for (const n of [1, 5, 20, 93]) {
      const a = 'a'.repeat(n);
      const b = `b${'a'.repeat(n - 1)}`;
      expect(normalizedEditDistance(a, b)).toBe(1 / n);
    }
  });

  it('is symmetric', () => {
    const edited = DRAFT.replace('Any questions?', 'Happy to talk it through.');
    expect(normalizedEditDistance(DRAFT, edited)).toBe(
      normalizedEditDistance(edited, DRAFT),
    );
    expect(normalizedEditDistance('kitten', 'sitting')).toBe(
      normalizedEditDistance('sitting', 'kitten'),
    );
  });

  it('stays within [0, 1]', () => {
    const pairs: Array<[string, string]> = [
      [DRAFT, ''],
      [DRAFT, DRAFT],
      ['kitten', 'sitting'],
      ['', 'x'],
      [DRAFT, 'totally different text entirely'],
    ];
    for (const [a, b] of pairs) {
      const d = normalizedEditDistance(a, b);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
    }
  });

  /**
   * THE ROUNDING CONTRACT, pinned as a fact about the values rather than as a
   * comment. A one-character edit to a 300-character SMS is 0.0033; stored at
   * two decimal places it is 0.00 — identical to an untouched draft, which is
   * exactly the signal AI-04 measures. Four places is the floor.
   */
  it('produces values that need at least four decimal places to survive storage', () => {
    const long = 'a'.repeat(300);
    const oneEdit = `b${'a'.repeat(299)}`;
    const d = normalizedEditDistance(long, oneEdit);

    expect(d).toBeCloseTo(0.003333, 6);
    expect(Number(d.toFixed(2))).toBe(0); // two places erases the edit
    expect(Number(d.toFixed(4))).toBeGreaterThan(0); // four places keeps it
  });

  it('returns full precision, rounding nothing itself', () => {
    // 3/7 is not representable in a short decimal; the raw quotient is returned.
    expect(normalizedEditDistance('abcdefg', 'xyzdefg')).toBe(3 / 7);
  });
});
