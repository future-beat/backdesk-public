/**
 * MSG-04 / Spam Act — the identification and opt-out every outbound SMS carries.
 *
 * PURE: no database, no network. The rule under test is a fact about Australian
 * commercial electronic messages, not about a request handler, and it is pinned
 * here rather than left to the live handset test because the live test happens
 * once and this suite runs on every commit.
 *
 * WHY THIS SUITE EXISTS AT ALL. Until 04-07 the body went to `StubSender`, which
 * sends nothing — so an unidentified message was a string in a log line. The
 * moment the sms `messaging_config` row is armed (D-04, a row write with no
 * deploy) the same string is a commercial message on a real handset, and an
 * unidentified one with no unsubscribe facility is the breach itself. There is no
 * code change between those two worlds, which is exactly why the guarantee has to
 * be asserted rather than remembered.
 */
import { describe, expect, it } from 'vitest';

import { complianceSuffix, stubTouchBody } from '../src/core/cadence/sender';

/**
 * The GSM 03.38 basic alphabet, as a character class.
 *
 * Anything outside it forces the whole SMS to UCS-2 and drops the segment size
 * from 160 characters to 70 — three segments where there was one, on every
 * message. The escape-table extras (`^{}[]~|\`) are deliberately omitted: they
 * cost two septets each and this suffix has no need of them.
 */
const GSM7 =
  /^[A-Za-z0-9@£$¥èéùìòÇØøÅåΔΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà\r\n]*$/;

describe('complianceSuffix — Spam Act identification and opt-out', () => {
  it('names the business and states the opt-out', () => {
    expect(complianceSuffix('Perth Sparks Electrical')).toBe(
      'Perth Sparks Electrical. Reply STOP to opt out.',
    );
  });

  it('still states the opt-out when there is no name to give', () => {
    // A missing business name is a configuration defect the console refuses to
    // create — but if one ever reaches here, dropping the unsubscribe facility
    // as well would turn one compliance problem into two. The identification is
    // the half we cannot manufacture; the opt-out is the half we always can.
    for (const empty of ['', '   ', '\n\t']) {
      expect(complianceSuffix(empty)).toBe('Reply STOP to opt out.');
    }
  });

  it('uses the exact word the STOP regex matches', () => {
    // `isStopMessage` is an ANCHORED whole-message match (04-01): a customer who
    // replies with the word this suffix told them to send must be suppressed by
    // it. Telling them to text something the regex does not accept is an opt-out
    // that silently does not work, which is worse than not offering one.
    expect(complianceSuffix('Anyone')).toContain('STOP');
  });

  it('is GSM-7 clean, so it cannot triple the segment count', () => {
    expect(complianceSuffix('')).toMatch(GSM7);
    expect(complianceSuffix('Perth Sparks Electrical (Test)')).toMatch(GSM7);
  });
});

describe('stubTouchBody', () => {
  const base = {
    touchNumber: 1,
    quoteId: '33333333-3333-4333-8333-333333333333',
    contactName: 'Dana',
    businessName: 'Perth Sparks Electrical (Test)',
  };

  it('carries the identification and the opt-out', () => {
    const body = stubTouchBody(base);

    expect(body).toContain('Perth Sparks Electrical (Test)');
    expect(body).toContain('Reply STOP to opt out.');
  });

  it('stays visibly a stub, so it cannot be mistaken for an approved draft', () => {
    // D-13/Phase 5: the words are placeholder until the drafting gate exists.
    // The compliance envelope is NOT part of the placeholder and survives the
    // Phase 5 swap; the `[STUB touch N]` prefix does not.
    expect(stubTouchBody(base)).toMatch(/^\[STUB touch 1\]/);
  });

  it('addresses an unnamed contact without inventing a name', () => {
    expect(stubTouchBody({ ...base, contactName: null })).toContain(' to customer.');
  });
});
