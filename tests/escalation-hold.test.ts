/**
 * D-09 (Phase 13, plan 13-06): the after-hours hold, asserted as a truth table
 * and as instants.
 *
 *   nextWindowOpen — the instant the window OPENS, never the preferred send
 *   time. Research gap 5: a helper built on the preferred time passes every
 *   test whose preferred time equals the start, and in production releases a
 *   tradie's held alert at 09:30 instead of when the shop opens. So every
 *   window here that matters carries a preferred send time that DIFFERS from
 *   its start, and `nextAllowedSlot` is asked the same question beside it to
 *   prove the two answers really are different.
 *
 *   shouldHoldEscalation — all eight rows of (immediate, inside, switch).
 *
 *   escalationHoldUntil — the composition the passes call, including the
 *   short-circuit that keeps an emergency from ever reading the window.
 *
 * PURE: no database, no network, no clock. Perth has no DST (UTC+8 always);
 * the Sydney case crosses the first Sunday of October 2026 (4 Oct, 02:00 AEST
 * → 03:00 AEDT) so the opening minute is pinned on both sides of a transition.
 *
 * Calendar: Tuesday 6 October 2026 (Thursday 8 October 2026 is today's date
 * when this was written; 1 January 2026 was a Thursday).
 */
import { describe, expect, it } from 'vitest';

import {
  nextAllowedSlot,
  nextWindowOpen,
  type ContactWindow,
} from '@/core/cadence/window';
import {
  escalationHoldUntil,
  isImmediateEscalation,
  shouldHoldEscalation,
} from '@/core/escalation/hold';

/** 08:00–17:00 Monday to Friday, Perth. */
const PERTH: ContactWindow = {
  timezone: 'Australia/Perth',
  contactHoursStart: '08:00:00',
  contactHoursEnd: '17:00:00',
  contactDays: [1, 2, 3, 4, 5],
};

/**
 * The same window as a TENANT row carries it, with a preferred send time of
 * 09:30 that is NOT the start. Handed to `nextWindowOpen` whole: the helper
 * must ignore the extra field, and the answers below say it does.
 */
const PERTH_PREFERRED_0930 = { ...PERTH, preferredSendTime: '09:30:00' };

/** A Perth wall clock as a UTC instant (Perth = UTC+8, no DST). */
function perth(day: number, hh: number, mm: number): Date {
  return new Date(Date.UTC(2026, 9, day, hh - 8, mm));
}

const noJitter = () => 0;

describe('nextWindowOpen — the opening minute, never the preferred time (research gap 5)', () => {
  it('Tue 23:00 → Wed 08:00', () => {
    expect(nextWindowOpen(perth(6, 23, 0), PERTH)).toEqual(perth(7, 8, 0));
  });

  it('Fri 19:00 → Mon 08:00 (the weekend is not a contact day)', () => {
    expect(nextWindowOpen(perth(9, 19, 0), PERTH)).toEqual(perth(12, 8, 0));
  });

  it('Sat 10:00 → Mon 08:00', () => {
    expect(nextWindowOpen(perth(10, 10, 0), PERTH)).toEqual(perth(12, 8, 0));
  });

  it('Wed 07:59 → Wed 08:00, the same morning', () => {
    expect(nextWindowOpen(perth(7, 7, 59), PERTH)).toEqual(perth(7, 8, 0));
  });

  it('Wed 10:00 is inside the window, so it returns from itself', () => {
    const from = perth(7, 10, 0);
    expect(nextWindowOpen(from, PERTH)).toEqual(from);
  });

  it('Wed 17:00 is the close (half-open), so it rolls to Thu 08:00', () => {
    expect(nextWindowOpen(perth(7, 17, 0), PERTH)).toEqual(perth(8, 8, 0));
  });

  it('with a 09:30 preferred send time the window still opens at 08:00 — and nextAllowedSlot would have said 09:30', () => {
    const from = perth(6, 23, 0);
    expect(nextWindowOpen(from, PERTH_PREFERRED_0930)).toEqual(perth(7, 8, 0));
    expect(nextWindowOpen(perth(9, 19, 0), PERTH_PREFERRED_0930)).toEqual(perth(12, 8, 0));
    expect(nextWindowOpen(perth(10, 10, 0), PERTH_PREFERRED_0930)).toEqual(perth(12, 8, 0));

    // The contrast that makes the pin mean something: the cadence helper,
    // asked about the same instant with the same preferred time, answers
    // 09:30. Built on that, a held alert would go out mid-morning.
    expect(nextAllowedSlot(from, PERTH, PERTH_PREFERRED_0930.preferredSendTime, noJitter)).toEqual(
      perth(7, 9, 30),
    );
  });

  it('contact days excluding Wednesday roll Tue 23:00 to Thu 08:00', () => {
    const noWednesday: ContactWindow = { ...PERTH, contactDays: [1, 2, 4, 5] };
    expect(nextWindowOpen(perth(6, 23, 0), noWednesday)).toEqual(perth(8, 8, 0));
  });

  it('a 07:00 start opens at 07:00, not at a fixed 08:00', () => {
    const early: ContactWindow = { ...PERTH, contactHoursStart: '07:00:00' };
    expect(nextWindowOpen(perth(6, 23, 0), early)).toEqual(perth(7, 7, 0));
  });

  it('Sydney across the October DST transition opens at the WALL-CLOCK start', () => {
    const sydney: ContactWindow = { ...PERTH, timezone: 'Australia/Sydney' };
    // Fri 2 Oct 2026 19:00 AEST (UTC+10) = 09:00Z.
    const fridayEvening = new Date(Date.UTC(2026, 9, 2, 9, 0));
    // Mon 5 Oct 2026 08:00 AEDT (UTC+11) = Sun 4 Oct 21:00Z — not 22:00Z,
    // which a stored +10 offset would produce.
    expect(nextWindowOpen(fridayEvening, sydney)).toEqual(new Date(Date.UTC(2026, 9, 4, 21, 0)));
    // And the Friday before the change still opens at 08:00 AEST = 22:00Z.
    const thursdayNight = new Date(Date.UTC(2026, 9, 1, 13, 0)); // Thu 23:00 AEST
    expect(nextWindowOpen(thursdayNight, sydney)).toEqual(new Date(Date.UTC(2026, 9, 1, 22, 0)));
  });

  it('refuses an Invalid Date rather than reading it as "not open yet" forever', () => {
    expect(() => nextWindowOpen(new Date(Number.NaN), PERTH)).toThrow(/real Date/);
  });
});

describe('shouldHoldEscalation — the full D-09 truth table', () => {
  const rows: Array<[boolean, boolean, boolean, boolean]> = [
    // immediate, inside, afterHoursEscalation → hold
    [true, true, true, false],
    [true, true, false, false],
    [true, false, true, false],
    [true, false, false, false], // an emergency at 23:00, switch off: sent at once
    [false, true, true, false],
    [false, true, false, false],
    [false, false, true, false], // the emergency trade's switch: sent at once
    [false, false, false, true], // the ONLY hold
  ];

  it.each(rows)(
    'immediate=%s inside=%s switch=%s → hold=%s',
    (immediate, inside, afterHoursEscalation, hold) => {
      expect(shouldHoldEscalation({ immediate, inside, afterHoursEscalation })).toBe(hold);
    },
  );

  it('holds in exactly one of the eight rows', () => {
    expect(rows.filter((row) => row[3]).length).toBe(1);
  });
});

describe('isImmediateEscalation — emergency urgency or a keyword hit, either alone', () => {
  it.each([
    [{ urgency: 'emergency', keywordHot: false }, true],
    [{ urgency: null, keywordHot: true }, true],
    [{ urgency: 'this_week', keywordHot: true }, true],
    [{ urgency: 'this_week', keywordHot: false }, false],
    [{ urgency: 'flexible', keywordHot: false }, false],
    [{ urgency: 'unknown', keywordHot: false }, false],
    [{ urgency: null, keywordHot: false }, false],
  ])('%o → %s', (row, expected) => {
    expect(isImmediateEscalation(row)).toBe(expected);
  });
});

describe('escalationHoldUntil — what the claim carries', () => {
  it('outside hours, switch off, not immediate → the window opening instant', () => {
    expect(
      escalationHoldUntil({
        now: perth(6, 23, 0),
        window: PERTH,
        immediate: false,
        afterHoursEscalation: false,
      }),
    ).toEqual(perth(7, 8, 0));
  });

  it('outside hours with the switch on → null (send at once)', () => {
    expect(
      escalationHoldUntil({
        now: perth(6, 23, 0),
        window: PERTH,
        immediate: false,
        afterHoursEscalation: true,
      }),
    ).toBeNull();
  });

  it('inside hours → null', () => {
    expect(
      escalationHoldUntil({
        now: perth(7, 10, 0),
        window: PERTH,
        immediate: false,
        afterHoursEscalation: false,
      }),
    ).toBeNull();
  });

  it('an emergency never reads the window — even a window this module would refuse', () => {
    const broken: ContactWindow = { ...PERTH, contactHoursStart: '9:30' };
    expect(
      escalationHoldUntil({
        now: perth(6, 23, 0),
        window: broken,
        immediate: true,
        afterHoursEscalation: false,
      }),
    ).toBeNull();
    // The same broken window on a non-immediate row throws by name, before
    // any claim — so the row is retried next tick, never held at a guess.
    expect(() =>
      escalationHoldUntil({
        now: perth(6, 23, 0),
        window: broken,
        immediate: false,
        afterHoursEscalation: false,
      }),
    ).toThrow(/Not a time of day/);
  });
});
