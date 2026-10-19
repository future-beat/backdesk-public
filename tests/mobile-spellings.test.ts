/**
 * Phase 14 (Pitfall 3): ServiceM8's `$filter` is EXACT-SPELLING, so the create
 * path, the match tier and the tests share one spelling rule. PURE — imports
 * nothing from tests/helpers/env or seed.
 *
 * The numbers are ACMA fiction-block mobiles (0491 570 xxx), never a person's.
 */
import { describe, expect, it } from 'vitest';

import { normalizeAuMobile } from '../src/core/cadence/primary-contact';
import {
  mobileSpellings,
  mobileTail,
  toLocalSpacedMobile,
} from '../src/core/leads/mobile-spellings';

const E164 = '+61491570999';

describe('mobile spellings (Phase 14)', () => {
  it('writes the local spaced form a tradie types', () => {
    expect(toLocalSpacedMobile(E164)).toBe('0491 570 999');
  });

  it('derives exactly three spellings, local spaced first', () => {
    expect(mobileSpellings(E164)).toEqual(['0491 570 999', '0491570999', '+61491570999']);
  });

  it('takes the last three digits as the tail', () => {
    expect(mobileTail(E164)).toBe('999');
  });

  it('every spelling normalises back to the input', () => {
    for (const spelling of mobileSpellings(E164)) {
      expect(normalizeAuMobile(spelling)).toBe(E164);
    }
  });

  it('refuses anything that is not a +614 E.164 mobile', () => {
    for (const bad of ['0491570999', '+6189123456', '+614915709', "+61491570999' or 1 eq 1", '']) {
      expect(() => toLocalSpacedMobile(bad)).toThrow();
      expect(() => mobileSpellings(bad)).toThrow();
      expect(() => mobileTail(bad)).toThrow();
    }
  });
});
