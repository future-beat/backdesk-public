/**
 * Baseline resolution (D-06/D-08/D-09) and the conservative haircut (D-07).
 *
 * PURE. These two files decide HOW MUCH of a won job the service bills for, so
 * every assertion below is really an assertion about a number on an invoice.
 *
 * The property that matters most is a NEGATIVE one: **an unknown baseline is
 * never a zero.** `'0.0000'` says this client issued quotes and won none — a
 * real, measured, usable baseline. `null` says there is nothing to measure.
 * Conflating them attributes to the service every win the client would have
 * made anyway, on an invoice they can disprove from their own books.
 */
import { describe, expect, it } from 'vitest';

import { BASELINE_MIN_QUOTES, DEFAULT_BASELINE_WIN_RATE } from '@/core/audit/constants';
import { DEFAULT_BASELINE_BP, resolveBaseline } from '@/core/attribution/baseline';
import {
  InvalidMoneyError,
  conservativeCents,
  grossCentsFromNumeric,
  multipleBasisPoints,
} from '@/core/attribution/money';

describe('DEFAULT_BASELINE_BP — the one float to integer step', () => {
  it('is exactly 7000 basis points, derived from the constant', () => {
    // Derived, never typed twice: the report footnote renders
    // `baseline.rateBp / 100` and the arithmetic uses `rateBp`. A second literal
    // is a figure and a footnote that can silently disagree.
    expect(DEFAULT_BASELINE_BP).toBe(7000);
    expect(DEFAULT_BASELINE_BP).toBe(Math.round(DEFAULT_BASELINE_WIN_RATE * 10_000));
    expect(Number.isInteger(DEFAULT_BASELINE_BP)).toBe(true);
  });

  it('rounds, because the constant is explicitly operator-confirmable', () => {
    // 0.70 happens to be exact in binary floating point. 0.07 and 0.57 are not
    // (`700.0000000000001` and `5699.999999999999`), and A1 invites the operator
    // to change this value. Math.round is the guard on THAT edit, not on today's.
    expect(Number.isInteger(0.07 * 10_000)).toBe(false);
    expect(Number.isInteger(0.57 * 10_000)).toBe(false);
    expect(Math.round(0.57 * 10_000)).toBe(5700);
  });
});

describe('resolveBaseline — D-06 / D-08 / D-09', () => {
  it('falls back to the assumed rate when there is no measured one', () => {
    expect(resolveBaseline({ winRate: null, quotesIssued: null })).toEqual({
      rateBp: 7000,
      source: 'default',
      sampleSize: null,
    });
  });

  it('NEVER treats a null baseline as zero', () => {
    // The whole point. A zero baseline credits the service with 100% of every
    // won job for a client whose history we simply never measured.
    const resolved = resolveBaseline({ winRate: null, quotesIssued: 0 });

    expect(resolved.rateBp).not.toBe(0);
    expect(resolved.rateBp).toBe(DEFAULT_BASELINE_BP);
  });

  it('falls back below the thin-sample floor, and reports the sample size', () => {
    // Nine quotes at 25% is a coin flip dressed as a measurement — at n = 10 the
    // 95% Wilson interval on p = 0.5 already spans about +/- 0.28. The sample
    // size survives onto the `default` branch because that is the branch whose
    // footnote has to explain itself: "fewer than 10 quotes" and "no quotes at
    // all" are different sentences.
    expect(resolveBaseline({ winRate: '0.2500', quotesIssued: BASELINE_MIN_QUOTES - 1 })).toEqual({
      rateBp: 7000,
      source: 'default',
      sampleSize: 9,
    });
  });

  it('uses the measured rate at exactly the thin-sample floor', () => {
    // At the threshold is INSIDE — the same convention as every other boundary
    // in this codebase.
    expect(resolveBaseline({ winRate: '0.2500', quotesIssued: BASELINE_MIN_QUOTES })).toEqual({
      rateBp: 2500,
      source: 'connect',
      sampleSize: 10,
    });
  });

  it('reads a measured ZERO as a real baseline, not as an absence', () => {
    // '0.0000' with a usable sample says: this client issued quotes and won
    // none. That is the branch where the service can honestly claim nearly all
    // of a win, and collapsing it into the `null` case would cost the service
    // money for no reason.
    expect(resolveBaseline({ winRate: '0.0000', quotesIssued: 40 })).toEqual({
      rateBp: 0,
      source: 'connect',
      sampleSize: 40,
    });
  });

  it('converts the numeric(5,4) string to integer basis points', () => {
    expect(resolveBaseline({ winRate: '0.8700', quotesIssued: 50 }).rateBp).toBe(8700);
    expect(resolveBaseline({ winRate: '0.3333', quotesIssued: 50 }).rateBp).toBe(3333);
  });

  it('falls back to the default for a rate the column permits but a RATE cannot mean', () => {
    // `baseline_win_rate` is `numeric(5,4)`: the column accepts up to 9.9999.
    // Above 1.0 is not a rate, and trusting it makes `conservativeCents` throw
    // `InvalidMoneyError` — which quarantines the event and costs the client
    // the attribution entirely. An unusable measured rate is the same answer as
    // no measured rate, and falls back the same way: to the deliberately HIGH
    // default, which can only shrink our credit.
    expect(resolveBaseline({ winRate: '1.5000', quotesIssued: 50 })).toEqual({
      rateBp: DEFAULT_BASELINE_BP,
      source: 'default',
      sampleSize: 50,
    });
    expect(resolveBaseline({ winRate: '9.9999', quotesIssued: 50 }).source).toBe('default');
    expect(resolveBaseline({ winRate: '-0.5000', quotesIssued: 50 }).source).toBe('default');
    // An unparseable string is the same answer for the same reason.
    expect(resolveBaseline({ winRate: 'not-a-number', quotesIssued: 50 }).source).toBe('default');
  });

  it('keeps BOTH ends of the legal range on the measured branch', () => {
    // The fallback must not swallow the two values that are exactly a rate:
    // nobody won anything, and everybody did.
    expect(resolveBaseline({ winRate: '0.0000', quotesIssued: 50 }).source).toBe('connect');
    expect(resolveBaseline({ winRate: '1.0000', quotesIssued: 50 })).toEqual({
      rateBp: 10_000,
      source: 'connect',
      sampleSize: 50,
    });
  });

  it('never hands `conservativeCents` a rate it would throw on', () => {
    // The two functions are one contract: whatever `resolveBaseline` returns is
    // what the money path is called with, and the money path throws outside
    // 0..10_000. Asserting the round trip is what makes that a property rather
    // than a coincidence of two separately-pinned ranges.
    for (const winRate of ['0.0000', '1.0000', '1.5000', '9.9999', '-0.5000', 'not-a-number']) {
      const { rateBp } = resolveBaseline({ winRate, quotesIssued: 50 });
      expect(() => conservativeCents(100_000, rateBp)).not.toThrow();
    }
  });
});

describe('conservativeCents — D-07, floored toward the client', () => {
  it('floors the half-cent in the client favour', () => {
    // 100_001 * 3000 / 10_000 = 30_000.3 exactly. Rounding would bill a third of
    // a cent nobody earned; the audit's `recoverableEstimateCents` floors for
    // the same reason.
    expect(conservativeCents(100_001, 7000)).toBe(30_000);
  });

  it('is never negative, and is exactly zero at a 100% baseline', () => {
    // The honest answer for a client who was already winning everything.
    expect(conservativeCents(1_234_567, 10_000)).toBe(0);
  });

  it('is the whole gross at a measured zero baseline', () => {
    expect(conservativeCents(1_234_567, 0)).toBe(1_234_567);
  });

  it('throws rather than repairing a bad input', () => {
    // A non-integer cent count is a fact about OUR code. Every available repair
    // (clamp, round, treat as zero) is a billing decision made by accident
    // inside a background consumer.
    expect(() => conservativeCents(100.5, 7000)).toThrow(InvalidMoneyError);
    expect(() => conservativeCents(-1, 7000)).toThrow(InvalidMoneyError);
    expect(() => conservativeCents(100, 10_001)).toThrow(InvalidMoneyError);
    expect(() => conservativeCents(100, -1)).toThrow(InvalidMoneyError);
  });
});

describe('multipleBasisPoints — D-13, and the unreachable division by zero', () => {
  it('returns null for no fee schedule and for a zero fee', () => {
    // Both are "there is no denominator". Rendering either as a multiple would
    // print an infinity or a spectacular month on a document a client reads
    // with a calculator.
    expect(multipleBasisPoints(500_000, null)).toBeNull();
    expect(multipleBasisPoints(500_000, 0)).toBeNull();
  });

  it('floors the multiple, again toward the client', () => {
    // 10_000 * 10_000 / 3_000 = 33_333.33... A 3.0x guarantee measured with a
    // rounded-up multiple is a guarantee met on a rounding error.
    expect(multipleBasisPoints(10_000, 3_000)).toBe(33_333);
  });

  it('is exactly zero for a month that recovered nothing against a real fee', () => {
    expect(multipleBasisPoints(0, 59_700)).toBe(0);
  });
});

describe('grossCentsFromNumeric', () => {
  it('parses the numeric(12,2) string to integer cents', () => {
    expect(grossCentsFromNumeric('12400.00')).toBe(1_240_000);
    expect(grossCentsFromNumeric('0.10')).toBe(10);
  });

  it('returns null for absent and unparseable totals — never a zero', () => {
    expect(grossCentsFromNumeric(null)).toBeNull();
    expect(grossCentsFromNumeric(undefined)).toBeNull();
    expect(grossCentsFromNumeric('')).toBeNull();
    // An unparseable total is as much a MISSING figure as an absent one. The
    // decision flags it rather than billing a real job at zero.
    expect(grossCentsFromNumeric('not a number')).toBeNull();
  });
});
