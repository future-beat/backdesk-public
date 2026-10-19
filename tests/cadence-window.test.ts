/**
 * CAD-02: the contact-hours window, asserted rather than assumed.
 *
 * Every "never" in this phase's timing goal reduces to one of the four
 * properties pinned here, and each one has a specific, already-documented way
 * of going wrong silently:
 *
 *   ISO WEEKDAYS (Pitfall 2). `contact_days` is Monday = 1 .. Sunday = 7;
 *   `Date.prototype.getDay()` is Sunday = 0 .. Saturday = 6. A direct
 *   `contactDays.includes(getDay())` makes Sunday permanently refused and
 *   shifts every other day by one — with no error anywhere. So all seven days
 *   are asserted, and one of them is asserted on an instant whose UTC weekday
 *   differs from its Perth weekday, because that is the case a UTC-based
 *   implementation passes by accident.
 *
 *   HALF-OPEN [start, end) (DNCR discipline). 17:00:00 is the moment the
 *   window CLOSES. Treating it as inclusive sends one message per day outside
 *   permitted hours, forever, and the only witness is a customer complaint.
 *
 *   TIME STRINGS (Pitfall 3). Postgres `time` columns arrive as 'HH:MM:SS'
 *   strings. An unpadded '9:30' or a stray `Date` comparison produces nonsense
 *   silently, so `parseTimeOfDay` refuses everything that is not exactly
 *   'HH:MM' or 'HH:MM:SS'.
 *
 *   OVERNIGHT WINDOWS (Assumption A1). Phase 1 rejects only start == end, so
 *   start > end is reachable from the database. Nothing here guesses what a
 *   20:00–06:00 tenant means; `assertValidWindow` throws by name.
 *
 * Pure: no database, no network, no ALLOW_REMOTE_TESTS gate.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { SAME_DAY_MARGIN_MINUTES } from '@/core/cadence/constants';
import {
  assertValidWindow,
  InvalidContactWindowError,
  isInsideWindow,
  isoWeekdayInZone,
  NoAllowedContactDayError,
  nextAllowedSlot,
  parseTimeOfDay,
  preferredSlotOnOrAfter,
  type ContactWindow,
} from '@/core/cadence/window';

/** A Perth tradie: 08:00–17:00, weekdays. Perth has no DST — UTC+8, always. */
const PERTH: ContactWindow = {
  timezone: 'Australia/Perth',
  contactHoursStart: '08:00:00',
  contactHoursEnd: '17:00:00',
  contactDays: [1, 2, 3, 4, 5],
};

/** Pinned RNG. Every slot below lands at preferred + 7 minutes, by construction. */
const jitter7 = () => 7;
const noJitter = () => 0;

describe('parseTimeOfDay — the driver hands us strings, not Dates (Pitfall 3)', () => {
  it('parses the exact shape a Postgres `time` column returns', () => {
    expect(parseTimeOfDay('09:30:00')).toBe(570);
    expect(parseTimeOfDay('00:00:00')).toBe(0);
    expect(parseTimeOfDay('17:00:00')).toBe(1020);
    expect(parseTimeOfDay('23:59:59')).toBe(1439);
  });

  it('accepts the seconds-less form the config constants use', () => {
    expect(parseTimeOfDay('09:30')).toBe(570);
  });

  it('refuses an unpadded hour rather than guessing at it', () => {
    // '9:30' is the shape a hand-written config produces, and the shape a
    // substring comparison against '17:00:00' silently mis-orders.
    expect(() => parseTimeOfDay('9:30')).toThrow(/9:30/);
  });

  it.each(['', '  ', 'abc', '25:00:00', '09:60:00', '09:30:60', '09-30-00', '0930'])(
    'refuses %j loudly',
    (bad) => {
      expect(() => parseTimeOfDay(bad)).toThrow();
    },
  );
});

describe('isoWeekdayInZone — Monday = 1 .. Sunday = 7 (Pitfall 2)', () => {
  // Perth midday on each day of one full week. Midday keeps the UTC date and
  // the Perth date on the same calendar day, so these seven are unambiguous.
  const week: Array<[string, number, string]> = [
    ['2026-08-24T04:00:00Z', 1, 'Monday'],
    ['2026-08-25T04:00:00Z', 2, 'Tuesday'],
    ['2026-08-26T04:00:00Z', 3, 'Wednesday'],
    ['2026-08-27T04:00:00Z', 4, 'Thursday'],
    ['2026-08-28T04:00:00Z', 5, 'Friday'],
    ['2026-08-29T04:00:00Z', 6, 'Saturday'],
    ['2026-08-30T04:00:00Z', 7, 'Sunday'],
  ];

  it.each(week)('maps %s to ISO %i (%s)', (iso, expected) => {
    expect(isoWeekdayInZone(new Date(iso), 'Australia/Perth')).toBe(expected);
  });

  it('never returns 0 for a Sunday — the getDay() value the schema has no name for', () => {
    const sunday = new Date('2026-08-30T04:00:00Z');
    expect(isoWeekdayInZone(sunday, 'Australia/Perth')).not.toBe(0);
    expect(isoWeekdayInZone(sunday, 'Australia/Perth')).toBe(7);
  });

  it('reads the weekday in the TENANT zone, not in UTC', () => {
    // Perth Sunday 06:00 is still Saturday in UTC. A UTC-based implementation
    // returns 6 here and passes every other test in this block.
    const perthSundayMorning = new Date('2026-08-29T22:00:00Z');
    expect(perthSundayMorning.getUTCDay()).toBe(6); // Saturday, in UTC
    expect(isoWeekdayInZone(perthSundayMorning, 'Australia/Perth')).toBe(7);
  });
});

describe('assertValidWindow — Assumption A1 handled loudly, never guessed', () => {
  it('accepts a normal window', () => {
    expect(() => assertValidWindow(480, 1020)).not.toThrow();
  });

  it('throws a NAMED error on an overnight window', () => {
    // 20:00 → 06:00. Both readings (wrap, or empty) are guesses, and one of
    // them sends at 3am.
    expect(() => assertValidWindow(1200, 360)).toThrow(InvalidContactWindowError);
  });

  it('throws on a zero-width window even though Phase 1 already rejects it', () => {
    // Defence in depth: Phase 1's form is not the only writer forever.
    expect(() => assertValidWindow(600, 600)).toThrow(InvalidContactWindowError);
  });
});

describe('isInsideWindow — the boundary is half-open [start, end)', () => {
  it('accepts the instant at exactly contact_hours_start', () => {
    // Perth 08:00:00 on Thursday.
    expect(isInsideWindow(new Date('2026-08-27T00:00:00Z'), PERTH)).toBe(true);
  });

  it('REFUSES the instant at exactly contact_hours_end', () => {
    // Perth 17:00:00 on Thursday — the moment the window closes.
    expect(isInsideWindow(new Date('2026-08-27T09:00:00Z'), PERTH)).toBe(false);
  });

  it('accepts the last minute inside the window', () => {
    // Perth 16:59.
    expect(isInsideWindow(new Date('2026-08-27T08:59:00Z'), PERTH)).toBe(true);
  });

  it('refuses one minute before the window opens', () => {
    // Perth 07:59.
    expect(isInsideWindow(new Date('2026-08-26T23:59:00Z'), PERTH)).toBe(false);
  });

  it('refuses a day that is not in contact_days however good the time is', () => {
    // Perth Saturday 12:00 — dead centre of the hours, wrong day.
    expect(isInsideWindow(new Date('2026-08-29T04:00:00Z'), PERTH)).toBe(false);
  });

  it('refuses an instant whose UTC day is allowed but whose tenant day is not', () => {
    // Perth Saturday 07:00 is Friday 23:00 UTC. Friday is an allowed day.
    const perthSaturdayMorning = new Date('2026-08-28T23:00:00Z');
    expect(perthSaturdayMorning.getUTCDay()).toBe(5); // Friday, in UTC
    expect(isInsideWindow(perthSaturdayMorning, PERTH)).toBe(false);
  });
});

describe('nextAllowedSlot — D-09: later today if the window is still open', () => {
  it('sends later today, at now + jitter, when the window has margin left', () => {
    // Perth Thursday 10:00. 10:00 + 60 min margin ≤ 17:00, so today it is.
    const from = new Date('2026-08-27T02:00:00Z');
    const slot = nextAllowedSlot(from, PERTH, '09:30', jitter7);

    expect(slot.toISOString()).toBe('2026-08-27T02:07:00.000Z');
    expect(slot.getTime()).toBeGreaterThanOrEqual(from.getTime());
    expect(isInsideWindow(slot, PERTH)).toBe(true);
  });

  it('rolls to the next allowed day when the remaining window is under the margin', () => {
    // Perth Thursday 16:30. 16:30 + 60 > 17:00 — not enough of the day left to
    // be a follow-up rather than an ambush at closing time.
    const from = new Date('2026-08-27T08:30:00Z');
    const slot = nextAllowedSlot(from, PERTH, '09:30', jitter7);

    // Friday 09:37 Perth = 01:37 UTC.
    expect(slot.toISOString()).toBe('2026-08-28T01:37:00.000Z');
  });

  it('uses the preferred slot TODAY when the anchor lands before the window opens', () => {
    // Perth Thursday 06:00 — today is allowed and 09:37 is still ahead, so
    // rolling to tomorrow would delay a whole day for no reason.
    const from = new Date('2026-08-26T22:00:00Z');
    const slot = nextAllowedSlot(from, PERTH, '09:30', jitter7);

    expect(slot.toISOString()).toBe('2026-08-27T01:37:00.000Z');
  });

  it('rolls day-by-day past every day missing from contact_days', () => {
    // Perth Friday 16:30 → Saturday and Sunday are not contact days.
    const from = new Date('2026-08-28T08:30:00Z');
    const slot = nextAllowedSlot(from, PERTH, '09:30', jitter7);

    // Monday 2026-08-31 09:37 Perth = 01:37 UTC.
    expect(slot.toISOString()).toBe('2026-08-31T01:37:00.000Z');
    expect(isoWeekdayInZone(slot, PERTH.timezone)).toBe(1);
  });

  it('honours a tenant who only ever contacts on Wednesdays', () => {
    const wednesdaysOnly: ContactWindow = { ...PERTH, contactDays: [3] };
    // Perth Thursday 10:00 — six days of rolling.
    const from = new Date('2026-08-27T02:00:00Z');
    const slot = nextAllowedSlot(from, wednesdaysOnly, '09:30', jitter7);

    expect(slot.toISOString()).toBe('2026-09-02T01:37:00.000Z');
    expect(isoWeekdayInZone(slot, PERTH.timezone)).toBe(3);
  });

  it('clamps to the window start when the preferred time falls outside the window', () => {
    // 07:00 preferred against an 08:00 opening: the slot is 08:00 + jitter,
    // never 07:00, and never silently dropped.
    const from = new Date('2026-08-26T22:00:00Z'); // Perth Thursday 06:00
    const slot = nextAllowedSlot(from, PERTH, '07:00', jitter7);

    // Perth 08:07 = 00:07 UTC.
    expect(slot.toISOString()).toBe('2026-08-27T00:07:00.000Z');
    expect(isInsideWindow(slot, PERTH)).toBe(true);
  });

  it('clamps a preferred time at or after the window close back to the start', () => {
    const from = new Date('2026-08-26T22:00:00Z'); // Perth Thursday 06:00
    const slot = nextAllowedSlot(from, PERTH, '18:30', noJitter);

    // Perth 08:00 = 00:00 UTC.
    expect(slot.toISOString()).toBe('2026-08-27T00:00:00.000Z');
    expect(isInsideWindow(slot, PERTH)).toBe(true);
  });

  it('respects an explicit sameDayMarginMinutes override', () => {
    // Perth Thursday 16:30 with a 15-minute margin: 16:45 ≤ 17:00, so today.
    const from = new Date('2026-08-27T08:30:00Z');
    const slot = nextAllowedSlot(from, PERTH, '09:30', jitter7, {
      sameDayMarginMinutes: 15,
    });

    expect(slot.toISOString()).toBe('2026-08-27T08:37:00.000Z');
  });

  it('defaults the margin to SAME_DAY_MARGIN_MINUTES', () => {
    const from = new Date('2026-08-27T08:30:00Z'); // Perth 16:30
    const withDefault = nextAllowedSlot(from, PERTH, '09:30', jitter7);
    const withExplicit = nextAllowedSlot(from, PERTH, '09:30', jitter7, {
      sameDayMarginMinutes: SAME_DAY_MARGIN_MINUTES,
    });

    expect(withDefault.toISOString()).toBe(withExplicit.toISOString());
  });

  it('never returns an instant before the anchor, whatever the jitter draw', () => {
    const from = new Date('2026-08-27T02:00:00Z');
    for (const draw of [0, 1, 5, 9, 10]) {
      const slot = nextAllowedSlot(from, PERTH, '09:30', () => draw);
      expect(slot.getTime()).toBeGreaterThanOrEqual(from.getTime());
    }
  });

  it('throws by name when no day is ever allowed, rather than looping or guessing', () => {
    const never: ContactWindow = { ...PERTH, contactDays: [] };
    expect(() => nextAllowedSlot(new Date('2026-08-27T02:00:00Z'), never, '09:30', jitter7)).toThrow(
      NoAllowedContactDayError,
    );
  });

  it('rejects an overnight window before it can place anything', () => {
    const overnight: ContactWindow = {
      ...PERTH,
      contactHoursStart: '20:00:00',
      contactHoursEnd: '06:00:00',
    };
    expect(() =>
      nextAllowedSlot(new Date('2026-08-27T02:00:00Z'), overnight, '09:30', jitter7),
    ).toThrow(InvalidContactWindowError);
  });

  it('refuses an unusable anchor rather than producing an Invalid Date', () => {
    expect(() => nextAllowedSlot(new Date(NaN), PERTH, '09:30', jitter7)).toThrow();
  });

  it('draws jitter exactly once per placement', () => {
    let draws = 0;
    const counting = () => {
      draws += 1;
      return 3;
    };
    // The rolling case is the one that would re-draw per candidate day.
    nextAllowedSlot(new Date('2026-08-28T08:30:00Z'), PERTH, '09:30', counting);
    expect(draws).toBe(1);
  });
});

describe('preferredSlotOnOrAfter — the offset-touch placement', () => {
  it('ignores the time of day and places at the preferred slot on that date', () => {
    // Perth Thursday 23:00 — late in the day, but this function is asked about
    // the DATE, not the moment.
    const day = new Date('2026-08-27T15:00:00Z');
    const slot = preferredSlotOnOrAfter(day, PERTH, '09:30', jitter7);

    expect(slot.toISOString()).toBe('2026-08-27T01:37:00.000Z');
  });

  it('rolls forward when that date is not a contact day', () => {
    // Perth Saturday.
    const day = new Date('2026-08-29T04:00:00Z');
    const slot = preferredSlotOnOrAfter(day, PERTH, '09:30', jitter7);

    expect(slot.toISOString()).toBe('2026-08-31T01:37:00.000Z');
  });
});

describe('window.ts is framework-free and holds no randomness of its own', () => {
  const source = readFileSync(new URL('../src/core/cadence/window.ts', import.meta.url), 'utf8');

  it('imports nothing from next/*', () => {
    expect(source).not.toMatch(/from ['"]next\//);
  });

  it('contains no Math.random — jitter is injected or it is not deterministic', () => {
    expect(source).not.toContain('Math.random');
  });
});
