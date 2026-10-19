/**
 * The three spellings of a caller's mobile that ServiceM8 is asked about
 * (Phase 14, research Pitfall 3). PURE; imports only `normalizeAuMobile`.
 *
 * ServiceM8 stores a number exactly as it was typed and its `$filter` is
 * EXACT-SPELLING: `mobile eq '0491570999'` finds nothing for a contact stored
 * `0491 570 999` (measured, spike ledger #4/#5). So the create path, the match
 * tier and the tests share this one rule:
 *
 *  - WE WRITE the local spaced form `04xx xxx xxx` — the shape a tradie types,
 *    and the one spelling the spike proved round-trips and is filterable.
 *  - WE ASK for three spellings, in order: local spaced, local compact, E.164.
 *
 * ASSUMPTION A3: the `+61…` spelling's filter behaviour is UNMEASURED. A
 * contact the tradie typed as `+61 491 …` (or any fourth spelling) is missed by
 * the filter tier, falls through to creating a new client record, and a
 * duplicate client in ServiceM8 is the recoverable cost. The mirror tier
 * (`normalizeAuMobile` over every mirrored contact) catches most of those
 * before ServiceM8 is asked at all.
 *
 * Every input is a `leads.contact_mobile`, which the column CHECK already
 * proves is `+614` + 8 digits; anything else THROWS, because a spelling built
 * from an unchecked value would be a string entering a `$filter` (T-14-04).
 */
import { normalizeAuMobile } from '@/core/cadence/primary-contact';

const E164_AU_MOBILE = /^\+614\d{8}$/;

function assertE164(e164: string): void {
  if (!E164_AU_MOBILE.test(e164)) {
    throw new Error('mobile-spellings: input is not a +614 E.164 mobile');
  }
}

/** `+61491570999` → `0491 570 999`. */
export function toLocalSpacedMobile(e164: string): string {
  assertE164(e164);
  const local = `0${e164.slice(3)}`;
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}

/** `[local spaced, local compact, E.164]` — each normalises back to the input. */
export function mobileSpellings(e164: string): [string, string, string] {
  const spaced = toLocalSpacedMobile(e164);
  const spellings: [string, string, string] = [spaced, `0${e164.slice(3)}`, e164];
  for (const spelling of spellings) {
    // A belt over the derivation: a spelling that does not round-trip would
    // be asked about and never matched.
    if (normalizeAuMobile(spelling) !== e164) {
      throw new Error('mobile-spellings: a spelling did not round-trip');
    }
  }
  return spellings;
}

/** The last three digits — the mirror tier's coarse SQL prefilter. */
export function mobileTail(e164: string): string {
  assertE164(e164);
  return e164.slice(-3);
}
