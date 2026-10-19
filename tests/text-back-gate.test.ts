/**
 * THE TEXT-BACK GATE, OVER ITS WHOLE INPUT SPACE (Phase 12, D-06/D-07/D-15/D-20).
 *
 * Pure: `decideTextBack` takes facts and a clock and returns a decision. No
 * database, no mocks — so every reason, the ORDER of every adjacent pair, the
 * own-number null guard and every boundary is provable on a bare `npm test`.
 *
 * The order is the specification (D-06 first, then Phase 12's three, with
 * Phase 13's D-12 rule inserted directly after `suppressed`):
 *
 *   not_armed → own_number → withheld → not_mobile → suppressed
 *   → recent_negative_close → recent_conversion → recent_text → daily_cap
 *   → stale → sms_not_armed → no_template
 *
 * 2026-10 (Phase 13, 13-01): `recent_negative_close` (D-12) joined the order
 * at position 6 and the stored vocabulary at the same position; every
 * existing pairwise and adjacency case below still holds, and the new
 * adjacent pairs (suppressed → recent_negative_close → recent_text) are
 * generated from ORDER like the rest.
 *
 * 2026-10 (Phase 15, D-08b): `recent_conversion` joined the order at position
 * 7, directly after `recent_negative_close`, and the stored vocabulary at the
 * same position; the two new adjacent pairs (recent_negative_close →
 * recent_conversion → recent_text) are generated from ORDER like the rest.
 *
 * All numbers are from ACMA's fiction block (0491 570 1xx / +61491570 1xx).
 */
import { describe, expect, it } from 'vitest';

import { TEXT_BACK_DAILY_CAP } from '@/core/audit/constants';
import {
  LEAD_NEGATIVE_COOL_OFF_DAYS,
  LEAD_RECENT_CONVERSION_HOURS,
  TEXT_BACK_MAX_AGE_MINUTES,
} from '@/core/leads/constants';
import {
  decideTextBack,
  isRecentConversion,
  isRecentNegativeClose,
  NEGATIVE_CLOSE_REASONS,
  type TextBackFacts,
  type TextBackGateReason,
} from '@/core/leads/gate';
import { LEAD_CLOSED_REASONS } from '@/db/schema';
import { TEXT_BACK_SKIP_REASONS } from '@/db/schema';

const NOW = new Date('2026-10-06T02:00:00.000Z');

const CALLER = '+61491570101';
const OWN_LINE = '+61891570102';
const ESCALATION = '+61491570103';
const DIVERT = '+61891570104';
const SMS_FROM = '+61491570105';

/** The all-clear fact set: every rule passes and the call is texted. */
function clear(overrides: Partial<TextBackFacts> = {}): TextBackFacts {
  return {
    armed: true,
    callerE164: CALLER,
    callerKind: 'mobile',
    forwardedFromE164: null,
    ownNumbers: [OWN_LINE, ESCALATION, DIVERT, SMS_FROM],
    suppressed: false,
    recentNegativeClose: false,
    recentConversion: false,
    textedSince24h: false,
    sentSince24h: 0,
    referenceAt: new Date(NOW.getTime() - 30_000),
    smsFrom: SMS_FROM,
    provider: 'clicksend',
    openQuoteCadence: false,
    templateOk: true,
    variant: 'business_hours',
    ...overrides,
  };
}

/** The minimal patch that makes each rule fail, everything else clear. */
const FAILING: Record<TextBackGateReason, Partial<TextBackFacts>> = {
  not_armed: { armed: false },
  own_number: { callerE164: OWN_LINE, callerKind: 'other_number' },
  withheld: { callerE164: null, callerKind: 'withheld' },
  not_mobile: { callerE164: '+61891570199', callerKind: 'other_number' },
  suppressed: { suppressed: true },
  // 2026-10 (Phase 13, D-12): the caller's newest lead here closed negatively
  // inside the ninety-day cool-off.
  recent_negative_close: { recentNegativeClose: true },
  // 2026-10 (Phase 15, D-08b): the caller's newest lead here CONVERTED within
  // LEAD_RECENT_CONVERSION_HOURS.
  recent_conversion: { recentConversion: true },
  recent_text: { textedSince24h: true },
  daily_cap: { sentSince24h: TEXT_BACK_DAILY_CAP },
  stale: { referenceAt: new Date(NOW.getTime() - TEXT_BACK_MAX_AGE_MINUTES * 60_000 - 1) },
  sms_not_armed: { smsFrom: null },
  no_template: { templateOk: false },
};

/**
 * D-06's seven, then Phase 12's three — THE order. 2026-10 (Phase 13, D-12):
 * `recent_negative_close` inserted after `suppressed`, a per-caller "must not
 * text" fact like it. 2026-10 (Phase 15, D-08b): `recent_conversion` inserted
 * after `recent_negative_close`, the same kind of per-caller fact.
 */
const ORDER: TextBackGateReason[] = [
  'not_armed',
  'own_number',
  'withheld',
  'not_mobile',
  'suppressed',
  'recent_negative_close',
  'recent_conversion',
  'recent_text',
  'daily_cap',
  'stale',
  'sms_not_armed',
  'no_template',
];

function reasonOf(facts: TextBackFacts): string {
  const decision = decideTextBack(facts, NOW);
  return decision.send ? `send:${decision.variant}` : decision.reason;
}

describe('decideTextBack — the all-clear set', () => {
  it('sends, with the variant it was given', () => {
    expect(decideTextBack(clear(), NOW)).toEqual({ send: true, variant: 'business_hours' });
    expect(decideTextBack(clear({ variant: 'after_hours' }), NOW)).toEqual({
      send: true,
      variant: 'after_hours',
    });
  });

  it('an open quote cadence is NOT a gate rule — the send path routes it (D-08)', () => {
    expect(reasonOf(clear({ openQuoteCadence: true }))).toBe('send:business_hours');
  });
});

describe('decideTextBack — every reason from a minimal failing fact set', () => {
  it.each(ORDER)('%s', (reason) => {
    expect(reasonOf(clear(FAILING[reason]))).toBe(reason);
  });

  it('the gate vocabulary is the stored skip vocabulary, in the same order, minus the two send-path reasons', () => {
    expect([...TEXT_BACK_SKIP_REASONS].filter((r) => r !== 'lead_open' && r !== 'quote_open')).toEqual(
      ORDER,
    );
  });
});

describe('decideTextBack — the ORDER, proven pairwise', () => {
  const pairs = ORDER.slice(0, -1).map((earlier, i) => [earlier, ORDER[i + 1]] as const);

  /**
   * Two adjacent pairs fail on the SAME fields (the caller's number and kind),
   * so a plain merge would make one patch erase the other. Each gets a fact
   * set that genuinely trips both rules.
   */
  const BOTH: Partial<Record<string, Partial<TextBackFacts>>> = {
    // In the own-number list AND classified withheld.
    'own_number+withheld': { callerE164: OWN_LINE, callerKind: 'withheld' },
    // No number at all AND not classified a mobile.
    'withheld+not_mobile': { callerE164: null, callerKind: 'other_number' },
  };

  it.each(pairs)('a fact set failing both %s and %s records the earlier', (earlier, later) => {
    const facts = clear(BOTH[`${earlier}+${later}`] ?? { ...FAILING[later], ...FAILING[earlier] });
    // The fixture really does fail BOTH rules: removing the earlier rule's
    // failure leaves the later one standing.
    expect(reasonOf(facts)).toBe(earlier);
  });

  it('the special pair fixtures really trip the later rule on their own', () => {
    // own_number+withheld without the list hit → withheld.
    expect(reasonOf(clear({ callerE164: OWN_LINE, callerKind: 'withheld', ownNumbers: [] }))).toBe(
      'withheld',
    );
    // withheld+not_mobile with a number restored → not_mobile.
    expect(reasonOf(clear({ callerE164: '+61891570199', callerKind: 'other_number' }))).toBe(
      'not_mobile',
    );
  });

  it('own_number beats withheld-adjacent facts: an own MOBILE that is also suppressed is own_number', () => {
    expect(reasonOf(clear({ callerE164: ESCALATION, suppressed: true }))).toBe('own_number');
  });

  it('withheld beats not_mobile: a withheld caller is never reported as merely not a mobile', () => {
    expect(reasonOf(clear({ callerE164: null, callerKind: 'withheld' }))).toBe('withheld');
  });

  it('every rule failing at once is not_armed', () => {
    const all = ORDER.reduce<Partial<TextBackFacts>>((acc, r) => ({ ...acc, ...FAILING[r] }), {});
    expect(reasonOf(clear(all))).toBe('not_armed');
  });
});

/**
 * 2026-10 (Phase 13, D-12): the ninety-day negative cool-off. The gate reads
 * one boolean; `isRecentNegativeClose` derives it from the caller's NEWEST
 * lead at the client, and both halves are pure.
 */
describe('decideTextBack — the ninety-day negative cool-off (Phase 13, D-12)', () => {
  const DAY = 86_400_000;
  const closed = (closedReason: string, daysAgo: number, extraMs = 0) => ({
    closedReason,
    closedAt: new Date(NOW.getTime() - daysAgo * DAY - extraMs),
  });

  it('a caller both suppressed and negatively closed is suppressed — the permanent reason wins', () => {
    expect(reasonOf(clear({ suppressed: true, recentNegativeClose: true }))).toBe('suppressed');
  });

  it('a caller negatively closed AND texted within 24 h is recent_negative_close', () => {
    expect(reasonOf(clear({ recentNegativeClose: true, textedSince24h: true }))).toBe(
      'recent_negative_close',
    );
  });

  it('the four negative reasons are exactly not_a_lead, spam, complaint and opt_out — all stored reasons', () => {
    expect([...NEGATIVE_CLOSE_REASONS].sort()).toEqual(
      ['complaint', 'not_a_lead', 'opt_out', 'spam'].sort(),
    );
    for (const reason of NEGATIVE_CLOSE_REASONS) expect(LEAD_CLOSED_REASONS).toContain(reason);
  });

  it.each(['not_a_lead', 'spam', 'complaint', 'opt_out'])(
    'a newest lead closed %s yesterday refuses the text',
    (reason) => {
      expect(isRecentNegativeClose(closed(reason, 1), NOW)).toBe(true);
      expect(
        reasonOf(clear({ recentNegativeClose: isRecentNegativeClose(closed(reason, 1), NOW) })),
      ).toBe('recent_negative_close');
    },
  );

  it.each(
    LEAD_CLOSED_REASONS.filter(
      (r) => !(NEGATIVE_CLOSE_REASONS as readonly string[]).includes(r),
    ),
  )('a newest lead closed %s is NOT refused by this rule', (reason) => {
    expect(isRecentNegativeClose(closed(reason, 1), NOW)).toBe(false);
  });

  it('a newest lead closed touches_exhausted is texted again (a fresh call opens a new lead)', () => {
    const fact = isRecentNegativeClose(closed('touches_exhausted', 1), NOW);
    expect(fact).toBe(false);
    expect(reasonOf(clear({ recentNegativeClose: fact }))).toBe('send:business_hours');
  });

  it(`the boundary: closed exactly ${LEAD_NEGATIVE_COOL_OFF_DAYS} days ago is still refused; one millisecond more is not`, () => {
    expect(LEAD_NEGATIVE_COOL_OFF_DAYS).toBe(90);
    expect(isRecentNegativeClose(closed('spam', 90), NOW)).toBe(true);
    expect(isRecentNegativeClose(closed('spam', 90, 1), NOW)).toBe(false);
  });

  it('no lead, or an open or converted newest lead (no reason, no close time), is never negative', () => {
    expect(isRecentNegativeClose(undefined, NOW)).toBe(false);
    expect(isRecentNegativeClose({ closedReason: null, closedAt: null }, NOW)).toBe(false);
  });

  it('a reason without a close time is not trusted as a close', () => {
    expect(isRecentNegativeClose({ closedReason: 'spam', closedAt: null }, NOW)).toBe(false);
  });
});

/**
 * 2026-10 (Phase 15, D-08b): a caller whose newest lead here CONVERTED within
 * LEAD_RECENT_CONVERSION_HOURS is not texted again and opens no new lead. The
 * gate reads one boolean; `isRecentConversion` derives it from the same newest
 * lead `isRecentNegativeClose` reads, and both halves are pure.
 */
describe('decideTextBack — the one-day recent conversion (Phase 15, D-08b)', () => {
  const HOUR = 3_600_000;
  const lead = (status: string, hoursAgo: number | null, extraMs = 0) => ({
    status,
    closedAt: hoursAgo === null ? null : new Date(NOW.getTime() - hoursAgo * HOUR - extraMs),
  });

  it('the window is twenty-four hours', () => {
    expect(LEAD_RECENT_CONVERSION_HOURS).toBe(24);
  });

  it('no lead is never a recent conversion', () => {
    expect(isRecentConversion(undefined, NOW)).toBe(false);
  });

  it('a newest lead converted exactly 24 h ago is still inside; one millisecond more is not', () => {
    expect(isRecentConversion(lead('converted', 24), NOW)).toBe(true);
    expect(isRecentConversion(lead('converted', 24, 1), NOW)).toBe(false);
  });

  it('a newest lead converted an hour ago refuses the text as recent_conversion', () => {
    const fact = isRecentConversion(lead('converted', 1), NOW);
    expect(fact).toBe(true);
    expect(reasonOf(clear({ recentConversion: fact }))).toBe('recent_conversion');
  });

  it('a newest lead CLOSED (not converted) an hour ago is not a conversion', () => {
    expect(isRecentConversion(lead('closed', 1), NOW)).toBe(false);
    expect(isRecentConversion(lead('expired', 1), NOW)).toBe(false);
    expect(isRecentConversion(lead('open', null), NOW)).toBe(false);
  });

  it('a converted lead without a close time is not trusted as a conversion', () => {
    expect(isRecentConversion(lead('converted', null), NOW)).toBe(false);
  });

  it('a caller negatively closed AND recently converted is recent_negative_close — the earlier rule wins', () => {
    expect(reasonOf(clear({ recentNegativeClose: true, recentConversion: true }))).toBe(
      'recent_negative_close',
    );
  });

  it('a caller recently converted AND texted within 24 h is recent_conversion', () => {
    expect(reasonOf(clear({ recentConversion: true, textedSince24h: true }))).toBe(
      'recent_conversion',
    );
  });
});

describe('decideTextBack — own numbers and ForwardedFrom (D-06, IN-07, 11-08 override)', () => {
  it.each([
    ['a never-text / own-line entry', OWN_LINE],
    ['the normalised escalation phone', ESCALATION],
    ["the client's divert number", DIVERT],
    ['the SMS from-number', SMS_FROM],
  ])('a caller equal to %s is own_number', (_label, number) => {
    expect(reasonOf(clear({ callerE164: number }))).toBe('own_number');
  });

  it('a caller equal to the normalised ForwardedFrom is own_number, even off the list', () => {
    expect(reasonOf(clear({ forwardedFromE164: CALLER, ownNumbers: [] }))).toBe('own_number');
  });

  it('a ForwardedFrom that differs from the caller changes nothing', () => {
    expect(reasonOf(clear({ forwardedFromE164: OWN_LINE }))).toBe('send:business_hours');
  });

  it('an ABSENT ForwardedFrom changes nothing — it is evidence, never required', () => {
    expect(reasonOf(clear({ forwardedFromE164: null }))).toBe('send:business_hours');
  });

  it('THE NULL GUARD: a withheld caller with no ForwardedFrom (both null) is withheld, never own_number', () => {
    expect(
      reasonOf(clear({ callerE164: null, callerKind: 'withheld', forwardedFromE164: null })),
    ).toBe('withheld');
  });

  it('a null caller with a NON-null ForwardedFrom is withheld too', () => {
    expect(
      reasonOf(clear({ callerE164: null, callerKind: 'withheld', forwardedFromE164: OWN_LINE })),
    ).toBe('withheld');
  });

  it('an ABSENT caller (null number) that claims to be a mobile is still withheld', () => {
    expect(reasonOf(clear({ callerE164: null, callerKind: 'mobile' }))).toBe('withheld');
  });

  it('an other_number caller (a landline) that is not ours is not_mobile', () => {
    expect(reasonOf(clear({ callerE164: '+61891570199', callerKind: 'other_number' }))).toBe(
      'not_mobile',
    );
  });

  it('an empty own-number list is no exemption: the other rules still apply', () => {
    expect(reasonOf(clear({ ownNumbers: [] }))).toBe('send:business_hours');
  });
});

describe('decideTextBack — the boundaries', () => {
  it(`the cap: ${TEXT_BACK_DAILY_CAP - 1} prior sends (this is the ${TEXT_BACK_DAILY_CAP}th), ${TEXT_BACK_DAILY_CAP} prior refuses`, () => {
    expect(TEXT_BACK_DAILY_CAP).toBe(30);
    expect(reasonOf(clear({ sentSince24h: 29 }))).toBe('send:business_hours');
    expect(reasonOf(clear({ sentSince24h: 30 }))).toBe('daily_cap');
    expect(reasonOf(clear({ sentSince24h: 31 }))).toBe('daily_cap');
  });

  it('staleness: exactly ten minutes old is still sendable; one millisecond more is stale', () => {
    const limit = TEXT_BACK_MAX_AGE_MINUTES * 60_000;
    expect(TEXT_BACK_MAX_AGE_MINUTES).toBe(10);
    expect(reasonOf(clear({ referenceAt: new Date(NOW.getTime() - limit) }))).toBe(
      'send:business_hours',
    );
    expect(reasonOf(clear({ referenceAt: new Date(NOW.getTime() - limit - 1) }))).toBe('stale');
  });

  it('a reference instant in the future (clock skew) is not stale', () => {
    expect(reasonOf(clear({ referenceAt: new Date(NOW.getTime() + 5_000) }))).toBe(
      'send:business_hours',
    );
  });
});

describe('decideTextBack — SMS arming (D-15)', () => {
  it('the stub provider is sms_not_armed: a stub send is never a text-back', () => {
    expect(reasonOf(clear({ provider: 'stub' }))).toBe('sms_not_armed');
  });

  it('a null SMS identity is sms_not_armed', () => {
    expect(reasonOf(clear({ smsFrom: null }))).toBe('sms_not_armed');
  });

  it('a real provider with an identity passes to the template rule', () => {
    expect(reasonOf(clear({ provider: 'clicksend', templateOk: false }))).toBe('no_template');
  });
});

describe('decideTextBack — the template (D-02)', () => {
  it('no attested, valid template is no_template', () => {
    expect(reasonOf(clear({ templateOk: false }))).toBe('no_template');
  });
});
