/**
 * WHO CALLED, PINNED (Phase 11, D-06/D-07, Pitfall 4).
 *
 * `classifyCaller` sorts a voice `From` into `withheld`, `mobile` or
 * `other_number`. The table below is the contract, and three rows in it are
 * the reasons it exists:
 *
 *   `+266696687` — "ANONYMOUS" spelled on a keypad. It PARSES AS E.164, and
 *     stored as an international caller it is a number Phase 12 might text.
 *   `not a number` — the design rule that makes the sentinel list non-exhaustive
 *     by necessity and harmless by construction: anything that is not a
 *     recognisable number is withheld.
 *   `412345678` — a mobile that lost its leading zero. `normalizeAuMobile`
 *     refuses to guess the zero back (a wrong guess is a text to a stranger),
 *     and the classifier inherits that refusal rather than second-guessing it.
 *
 * Pure. ACMA fiction-block numbers throughout.
 */
import { describe, expect, it } from 'vitest';

import { classifyCaller, WITHHELD_SENTINELS } from '@/core/telephony/caller';

const E164 = /^\+[1-9]\d{6,14}$/;

describe('classifyCaller — withheld', () => {
  it.each([
    ['anonymous'],
    ['Anonymous '],
    ['unknown'],
    ['restricted'],
    ['unavailable'],
    ['+266696687'],
    ['+7378742833'],
    ['+86282452253'],
    ['+2562533'],
    // WR-01: UNKNOWN in keypad digits — Twilio's own list, and it parses as E.164.
    ['+8656696'],
    ['+464'],
    ['blocked'],
    // The same sentinels without their `+`, with a NANP `+1`, or punctuated.
    ['266696687'],
    ['8656696'],
    ['+1266696687'],
    ['+17378742833'],
    ['+18656696'],
    ['865-6696'],
    ['737 874-2833'],
    [''],
    ['   '],
    [undefined],
    [null],
    ['not a number'],
    ['sip:someone@example.com'],
    ['client:alice'],
    // A mobile with its leading zero lost — refused, not guessed.
    ['412345678'],
  ])('%j → withheld, no number', (from) => {
    expect(classifyCaller(from)).toEqual({ kind: 'withheld', e164: null });
  });

  it('the known sentinels are in the set, compared lower-cased', () => {
    for (const sentinel of ['anonymous', 'unknown', '+266696687', '+8656696']) {
      expect(WITHHELD_SENTINELS.has(sentinel)).toBe(true);
    }
    expect(classifyCaller('ANONYMOUS').kind).toBe('withheld');
  });
});

describe('classifyCaller — mobile', () => {
  it.each([['0491570156'], ['+61491570156'], ['61491570156'], ['0491 570 156'], ['0491-570-156']])(
    '%j → mobile +61491570156',
    (from) => {
      expect(classifyCaller(from)).toEqual({ kind: 'mobile', e164: '+61491570156' });
    },
  );
});

describe('classifyCaller — other_number', () => {
  it.each([
    ['+61891570156', '+61891570156'],
    ['+441632960123', '+441632960123'],
    ['0892345678', '+61892345678'],
    ['(08) 9234 5678', '+61892345678'],
    ['02 9876 5432', '+61298765432'],
  ])('%j → other_number %s', (from, e164) => {
    expect(classifyCaller(from)).toEqual({ kind: 'other_number', e164 });
  });
});

describe('classifyCaller — the invariant across every row', () => {
  const INPUTS = [
    'anonymous',
    '+266696687',
    '+8656696',
    '+1266696687',
    '',
    undefined,
    null,
    'not a number',
    '412345678',
    '0491570156',
    '+61491570156',
    '61491570156',
    '0491 570 156',
    '+61891570156',
    '+441632960123',
    '0892345678',
  ];

  it('withheld ⇔ e164 null; every other kind carries a well-formed E.164', () => {
    for (const from of INPUTS) {
      const result = classifyCaller(from);
      if (result.kind === 'withheld') {
        expect(result.e164).toBeNull();
      } else {
        expect(result.e164).toMatch(E164);
      }
    }
  });
});
