/**
 * SYNC-03: timestamp normalization and the money path.
 *
 * Two properties are being defended here, and both have the same failure shape
 * — a wrong value that never throws:
 *
 *   1. A ServiceM8 timestamp normalizes to a real UTC instant or to `null`.
 *      NEVER to `Invalid Date`, which is a Date whose arithmetic silently
 *      yields NaN and whose comparisons are all false.
 *   2. Money never touches binary floating point. `parseFloat('0.1') * 100` is
 *      10.000000000000002, and the rounding that hides it stops hiding it at
 *      1234.565.
 */
import { describe, expect, it } from 'vitest';

import {
  centsToNumeric,
  moneyToNumeric,
  parseMoneyToCents,
  sm8ToUtc,
  SM8_TIMESTAMP_ZONE,
} from '../src/core/servicem8/normalize';

describe('sm8ToUtc — zone interpretation', () => {
  it('interprets a naive string in the given zone (Perth, UTC+8, no DST)', () => {
    expect(sm8ToUtc('2026-08-26 09:00:00', 'Australia/Perth')?.toISOString()).toBe(
      '2026-08-26T01:00:00.000Z',
    );
  });

  it('resolves DST correctly for a zone that observes it', () => {
    // Sydney is UTC+10 in winter and UTC+11 under daylight saving. A FIXED
    // offset would get one of these two wrong, which is precisely why the
    // codebase stores IANA identifiers and never offsets.
    expect(sm8ToUtc('2026-06-15 12:00:00', 'Australia/Sydney')?.toISOString()).toBe(
      '2026-06-15T02:00:00.000Z',
    );
    expect(sm8ToUtc('2026-12-15 12:00:00', 'Australia/Sydney')?.toISOString()).toBe(
      '2026-12-15T01:00:00.000Z',
    );
  });

  it('treats a UTC string as UTC — the measured ServiceM8 behaviour (A3)', () => {
    expect(SM8_TIMESTAMP_ZONE).toBe('UTC');
    expect(sm8ToUtc('2026-08-26 09:00:00', SM8_TIMESTAMP_ZONE)?.toISOString()).toBe(
      '2026-08-26T09:00:00.000Z',
    );
  });

  it('reads the same string 8 hours apart depending on the zone', () => {
    // The concrete size of the A3 mistake: interpreting ServiceM8's UTC
    // timestamps in the tenant's Perth zone would shift every displayed time by
    // exactly this much.
    const asUtc = sm8ToUtc('2026-08-26 09:00:00', 'UTC')!;
    const asPerth = sm8ToUtc('2026-08-26 09:00:00', 'Australia/Perth')!;

    expect((asUtc.getTime() - asPerth.getTime()) / 3_600_000).toBe(8);
  });

  it('accepts the ISO T separator and an omitted seconds field', () => {
    expect(sm8ToUtc('2026-08-26T09:00:00', 'UTC')?.toISOString()).toBe('2026-08-26T09:00:00.000Z');
    expect(sm8ToUtc('2026-08-26 09:00', 'UTC')?.toISOString()).toBe('2026-08-26T09:00:00.000Z');
    expect(sm8ToUtc('2026-08-26', 'UTC')?.toISOString()).toBe('2026-08-26T00:00:00.000Z');
  });
});

describe('sm8ToUtc — absence, never Invalid Date', () => {
  it('returns null for every flavour of "no value"', () => {
    for (const empty of [
      null,
      undefined,
      '',
      '   ',
      '0000-00-00',
      '0000-00-00 00:00:00',
      '0000-00-00T00:00:00',
    ]) {
      expect(sm8ToUtc(empty, 'UTC'), `input: ${JSON.stringify(empty)}`).toBeNull();
    }
  });

  it('returns null for unparseable input rather than Invalid Date', () => {
    for (const junk of ['not a date', '26/08/2026', 'yesterday', '2026']) {
      const result = sm8ToUtc(junk, 'UTC');
      expect(result, `input: ${junk}`).toBeNull();
    }
  });

  it('never returns a Date whose time is NaN', () => {
    // The general form of the two assertions above — the property that actually
    // matters, stated once so a new input class cannot slip past.
    for (const input of ['0000-00-00 00:00:00', '', 'garbage', '2026-02-31', '2026-13-01']) {
      const result = sm8ToUtc(input, 'UTC');
      if (result !== null) expect(Number.isNaN(result.getTime())).toBe(false);
    }
  });
});

describe('sm8ToUtc — zone validation', () => {
  it('throws loudly on an invalid zone identifier', () => {
    // Silently falling back to UTC would put a Perth client's times 8 hours out
    // with nothing going red — the Phase 1 timezone rule exists for this.
    expect(() => sm8ToUtc('2026-08-26 09:00:00', 'Mars/Phobos')).toThrow(/unsupported timezone/);
    expect(() => sm8ToUtc('2026-08-26 09:00:00', '+08:00')).toThrow(/unsupported timezone/);
    expect(() => sm8ToUtc('2026-08-26 09:00:00', '')).toThrow(/unsupported timezone/);
  });

  it('validates the zone even when the timestamp is absent', () => {
    // A bad zone is a configuration bug and must surface on the first call,
    // not only on rows that happen to have a value.
    expect(() => sm8ToUtc(null, 'Mars/Phobos')).toThrow(/unsupported timezone/);
  });
});

describe('parseMoneyToCents — integer string math only', () => {
  it('parses the precision contract cases exactly', () => {
    expect(parseMoneyToCents('1234.50')).toBe(123450);
    expect(parseMoneyToCents('0.1')).toBe(10);
    expect(parseMoneyToCents(null)).toBeNull();
  });

  it('handles the values a float round-trip gets wrong', () => {
    // Each of these is a known binary-floating-point failure. `0.1 + 0.2` is
    // 0.30000000000000004; `1.005 * 100` is 100.49999999999999.
    expect(parseMoneyToCents('0.29')).toBe(29);
    expect(parseMoneyToCents('1.005')).toBe(100);
    expect(parseMoneyToCents('8.165')).toBe(816);
    expect(parseMoneyToCents('1234.565')).toBe(123456);
  });

  it('handles the 4-decimal form ServiceM8 actually returns', () => {
    // Measured, not assumed: total_invoice_amount arrives as "393.7500".
    expect(parseMoneyToCents('393.7500')).toBe(39375);
    expect(parseMoneyToCents('4850.0000')).toBe(485000);
    expect(parseMoneyToCents('2320.0000')).toBe(232000);
  });

  it('handles missing or partial components', () => {
    expect(parseMoneyToCents('100')).toBe(10000);
    expect(parseMoneyToCents('100.')).toBe(10000);
    expect(parseMoneyToCents('.5')).toBe(50);
    expect(parseMoneyToCents('0')).toBe(0);
    expect(parseMoneyToCents('0.00')).toBe(0);
  });

  it('handles negatives (a credit note)', () => {
    expect(parseMoneyToCents('-12.34')).toBe(-1234);
    expect(parseMoneyToCents('-0.05')).toBe(-5);
  });

  it('returns null for absence and for junk', () => {
    for (const bad of [null, undefined, '', '   ', 'abc', '$12.34', '1,234.50', '12.34.56']) {
      expect(parseMoneyToCents(bad), `input: ${JSON.stringify(bad)}`).toBeNull();
    }
  });

  it('keeps large amounts exact within numeric(12,2)', () => {
    expect(parseMoneyToCents('9999999999.99')).toBe(999999999999);
  });
});

describe('centsToNumeric — the numeric(12,2) column format', () => {
  it('always emits two decimal places, as a string', () => {
    expect(centsToNumeric(123450)).toBe('1234.50');
    expect(centsToNumeric(10)).toBe('0.10');
    expect(centsToNumeric(5)).toBe('0.05');
    expect(centsToNumeric(0)).toBe('0.00');
    expect(centsToNumeric(100)).toBe('1.00');
    expect(centsToNumeric(-1234)).toBe('-12.34');
    expect(centsToNumeric(null)).toBeNull();
  });

  it('returns a string, never a number', () => {
    // Handing drizzle a JS number for a numeric column reintroduces the float
    // round-trip one layer further down, where it is harder to see.
    expect(typeof centsToNumeric(123450)).toBe('string');
  });

  it('round-trips through parseMoneyToCents', () => {
    for (const value of ['1234.50', '0.10', '0.05', '999.99', '-12.34']) {
      expect(centsToNumeric(parseMoneyToCents(value))).toBe(value);
    }
  });
});

describe('moneyToNumeric — the composition used at persistence', () => {
  it('maps ServiceM8 money strings straight to column values', () => {
    expect(moneyToNumeric('393.7500')).toBe('393.75');
    expect(moneyToNumeric('0.1')).toBe('0.10');
    expect(moneyToNumeric(null)).toBeNull();
    expect(moneyToNumeric('')).toBeNull();
  });
});
