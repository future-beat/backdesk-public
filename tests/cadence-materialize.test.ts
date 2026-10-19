/**
 * D-01/D-02/D-03: the schedule a cadence is born with.
 *
 * THE PROPERTY THIS FILE EXISTS FOR is D-01's "a cadence can never materialize
 * already-overdue". The failure it prevents is specific and was found in
 * research (Pitfall 1): a backfilled quote whose ServiceM8 issue date is two
 * months old, anchored on that issue date, materializes five touches all in the
 * past. The staleness cap then skips every one of them and the cadence expires
 * without a single message — silently, and looking exactly like a cadence that
 * ran. So the anchor is the ELIGIBILITY moment, and the test below seeds a
 * 60-day-old quote to prove that the issue date has no influence at all.
 *
 * DETERMINISM (Pitfall 4). Jitter drawn at dispatch makes `scheduled_at` a
 * moving target and turns min-gap and staleness comparisons nondeterministic.
 * It is drawn once here, through an injected RNG, and baked into the stored
 * instant — which is also what makes every assertion in this file an exact
 * ISO string rather than a range.
 *
 * DST. `Australia/Perth` never changes offset, so a Perth-only suite cannot
 * tell a real zone resolution from a hard-coded +8. The Sydney block crosses
 * the 5 April 2026 AEDT→AEST transition, where the same 09:30 wall-clock time
 * is a different UTC instant on either side.
 *
 * Pure: no database, no network, no ALLOW_REMOTE_TESTS gate.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { DEFAULT_TOUCH_OFFSET_DAYS } from '@/core/cadence/constants';
import {
  materializeCadenceSchedule,
  type MaterializeTemplate,
} from '@/core/cadence/materialize';
import { isInsideWindow, type ContactWindow } from '@/core/cadence/window';

const PERTH: ContactWindow = {
  timezone: 'Australia/Perth',
  contactHoursStart: '08:00:00',
  contactHoursEnd: '17:00:00',
  contactDays: [1, 2, 3, 4, 5],
};

const SYDNEY: ContactWindow = {
  timezone: 'Australia/Sydney',
  contactHoursStart: '08:00:00',
  contactHoursEnd: '17:00:00',
  contactDays: [1, 2, 3, 4, 5],
};

const jitter7 = () => 7;
const noJitter = () => 0;

/** The D-02 default shape, as the template rows a tenant is seeded with. */
function defaultTemplates(): MaterializeTemplate[] {
  return DEFAULT_TOUCH_OFFSET_DAYS.map((offsetDays, index) => ({
    touchNumber: index + 1,
    offsetDays,
    channel: 'sms' as const,
  }));
}

/** Perth Thursday 27 Aug 2026, 10:00 local (= 02:00 UTC). */
const ANCHOR = new Date('2026-08-27T02:00:00Z');

describe('materializeCadenceSchedule — the default 0/3/7/14/21 shape', () => {
  const schedule = materializeCadenceSchedule({
    anchor: ANCHOR,
    templates: defaultTemplates(),
    window: PERTH,
    preferredSendTime: '09:30',
    jitterMinutes: jitter7,
  });

  it('produces one touch per template, strictly ordered by touch_number', () => {
    expect(schedule.map((t) => t.touchNumber)).toEqual([1, 2, 3, 4, 5]);
  });

  it('places touch 1 at the next allowed slot from the anchor, not at midnight', () => {
    // Window still open with margin → later today at anchor + jitter.
    expect(schedule[0].scheduledAt.toISOString()).toBe('2026-08-27T02:07:00.000Z');
  });

  it('places the offset touches on anchor-date + offset at preferred + jitter', () => {
    // Thu 27 Aug + 3 = Sun 30 Aug → rolls to Mon 31 Aug 09:37 Perth = 01:37Z.
    expect(schedule[1].scheduledAt.toISOString()).toBe('2026-08-31T01:37:00.000Z');
    // +7 = Thu 3 Sep, +14 = Thu 10 Sep, +21 = Thu 17 Sep — all contact days.
    expect(schedule[2].scheduledAt.toISOString()).toBe('2026-09-03T01:37:00.000Z');
    expect(schedule[3].scheduledAt.toISOString()).toBe('2026-09-10T01:37:00.000Z');
    expect(schedule[4].scheduledAt.toISOString()).toBe('2026-09-17T01:37:00.000Z');
  });

  it('carries originalOffsetDays through, which is D-07’s relative-gap basis', () => {
    expect(schedule.map((t) => t.originalOffsetDays)).toEqual([0, 3, 7, 14, 21]);
  });

  it('snapshots the template channel onto the touch', () => {
    expect(schedule.every((t) => t.channel === 'sms')).toBe(true);
  });

  it('lands every touch inside the contact window on an allowed day', () => {
    for (const touch of schedule) {
      expect(isInsideWindow(touch.scheduledAt, PERTH)).toBe(true);
    }
  });

  it('produces a strictly increasing sequence of instants', () => {
    for (let i = 1; i < schedule.length; i += 1) {
      expect(schedule[i].scheduledAt.getTime()).toBeGreaterThan(
        schedule[i - 1].scheduledAt.getTime(),
      );
    }
  });
});

describe('D-01 — a cadence can never be born overdue', () => {
  it('ignores the quote issue date entirely: a 60-day-old quote still schedules forward', () => {
    // The quote went out on 28 June 2026 and sat in the backfill until an
    // operator ticked it eligible today. Anchoring on the issue date would put
    // all five touches in the past; the anchor is the eligibility moment.
    const quoteIssuedAt = new Date(ANCHOR.getTime() - 60 * 24 * 60 * 60 * 1000);
    expect(quoteIssuedAt.toISOString()).toBe('2026-06-28T02:00:00.000Z');

    const schedule = materializeCadenceSchedule({
      anchor: ANCHOR,
      templates: defaultTemplates(),
      window: PERTH,
      preferredSendTime: '09:30',
      jitterMinutes: jitter7,
    });

    expect(schedule).toHaveLength(5);
    for (const touch of schedule) {
      expect(touch.scheduledAt.getTime()).toBeGreaterThanOrEqual(ANCHOR.getTime());
      expect(touch.scheduledAt.getTime()).toBeGreaterThan(quoteIssuedAt.getTime());
    }
  });

  it('is still forward-only when the anchor lands after the window closes', () => {
    // Perth Friday 18:30 — outside hours, and the weekend follows.
    const lateFriday = new Date('2026-08-28T10:30:00Z');
    const schedule = materializeCadenceSchedule({
      anchor: lateFriday,
      templates: defaultTemplates(),
      window: PERTH,
      preferredSendTime: '09:30',
      jitterMinutes: jitter7,
    });

    for (const touch of schedule) {
      expect(touch.scheduledAt.getTime()).toBeGreaterThanOrEqual(lateFriday.getTime());
      expect(isInsideWindow(touch.scheduledAt, PERTH)).toBe(true);
    }
    // Touch 1 rolls to Monday morning.
    expect(schedule[0].scheduledAt.toISOString()).toBe('2026-08-31T01:37:00.000Z');
  });

  it('is still forward-only when the anchor lands on a weekend', () => {
    const saturday = new Date('2026-08-29T04:00:00Z'); // Perth Saturday midday
    const schedule = materializeCadenceSchedule({
      anchor: saturday,
      templates: defaultTemplates(),
      window: PERTH,
      preferredSendTime: '09:30',
      jitterMinutes: jitter7,
    });

    for (const touch of schedule) {
      expect(touch.scheduledAt.getTime()).toBeGreaterThanOrEqual(saturday.getTime());
    }
  });
});

describe('D-03 — jitter is injected, drawn once per touch, and baked in', () => {
  it('produces deep-equal schedules for two runs with the same pinned RNG', () => {
    const args = {
      anchor: ANCHOR,
      templates: defaultTemplates(),
      window: PERTH,
      preferredSendTime: '09:30',
      jitterMinutes: jitter7,
    };

    const first = materializeCadenceSchedule(args);
    const second = materializeCadenceSchedule(args);

    expect(first).toEqual(second);
  });

  it('moves every instant when the RNG changes — the jitter is really applied', () => {
    const base = {
      anchor: ANCHOR,
      templates: defaultTemplates(),
      window: PERTH,
      preferredSendTime: '09:30',
    };

    const zero = materializeCadenceSchedule({ ...base, jitterMinutes: noJitter });
    const seven = materializeCadenceSchedule({ ...base, jitterMinutes: jitter7 });

    for (let i = 0; i < zero.length; i += 1) {
      expect(seven[i].scheduledAt.getTime() - zero[i].scheduledAt.getTime()).toBe(7 * 60_000);
    }
  });

  it('draws from the RNG exactly once per touch', () => {
    let draws = 0;
    materializeCadenceSchedule({
      anchor: ANCHOR,
      templates: defaultTemplates(),
      window: PERTH,
      preferredSendTime: '09:30',
      jitterMinutes: () => {
        draws += 1;
        return 4;
      },
    });

    expect(draws).toBe(5);
  });

  it('spreads touches apart when the RNG returns a different draw each time', () => {
    const draws = [1, 2, 3, 4, 5];
    let i = 0;
    const schedule = materializeCadenceSchedule({
      anchor: ANCHOR,
      templates: defaultTemplates(),
      window: PERTH,
      preferredSendTime: '09:30',
      jitterMinutes: () => draws[i++],
    });

    // Touch 2 is the first preferred-slot placement: 09:30 + 2 = 09:32.
    expect(schedule[1].scheduledAt.toISOString()).toBe('2026-08-31T01:32:00.000Z');
    expect(schedule[2].scheduledAt.toISOString()).toBe('2026-09-03T01:33:00.000Z');
  });
});

describe('DST — the tenant zone is resolved per date, not as a fixed offset', () => {
  it('places the same 09:30 wall-clock slot at different UTC instants across the AEDT→AEST change', () => {
    // Sydney Thursday 2 April 2026, 10:00 AEDT (UTC+11) = 23:00Z on 1 April.
    const anchor = new Date('2026-04-01T23:00:00Z');
    const schedule = materializeCadenceSchedule({
      anchor,
      templates: [
        { touchNumber: 1, offsetDays: 1, channel: 'sms' }, // Fri 3 Apr — still AEDT
        { touchNumber: 2, offsetDays: 4, channel: 'sms' }, // Mon 6 Apr — now AEST
      ],
      window: SYDNEY,
      preferredSendTime: '09:30',
      jitterMinutes: noJitter,
    });

    // 09:30 AEDT (+11) = 22:30Z the previous day.
    expect(schedule[0].scheduledAt.toISOString()).toBe('2026-04-02T22:30:00.000Z');
    // 09:30 AEST (+10) = 23:30Z the previous day. A fixed +11 would say 22:30Z.
    expect(schedule[1].scheduledAt.toISOString()).toBe('2026-04-05T23:30:00.000Z');

    // The two instants are 3 days and 1 HOUR apart, not exactly 3 days.
    const gapMs = schedule[1].scheduledAt.getTime() - schedule[0].scheduledAt.getTime();
    expect(gapMs).toBe((3 * 24 + 1) * 60 * 60 * 1000);

    for (const touch of schedule) {
      expect(isInsideWindow(touch.scheduledAt, SYDNEY)).toBe(true);
    }
  });
});

describe('materializeCadenceSchedule — total, ordered, and loud about bad input', () => {
  it('returns an empty schedule for an empty template list', () => {
    expect(
      materializeCadenceSchedule({
        anchor: ANCHOR,
        templates: [],
        window: PERTH,
        preferredSendTime: '09:30',
        jitterMinutes: jitter7,
      }),
    ).toEqual([]);
  });

  it('orders by touch_number even when the templates arrive out of order', () => {
    const schedule = materializeCadenceSchedule({
      anchor: ANCHOR,
      templates: [
        { touchNumber: 3, offsetDays: 7, channel: 'sms' },
        { touchNumber: 1, offsetDays: 0, channel: 'sms' },
        { touchNumber: 2, offsetDays: 3, channel: 'email' },
      ],
      window: PERTH,
      preferredSendTime: '09:30',
      jitterMinutes: jitter7,
    });

    expect(schedule.map((t) => t.touchNumber)).toEqual([1, 2, 3]);
    expect(schedule.map((t) => t.channel)).toEqual(['sms', 'email', 'sms']);
  });

  it('keeps equal offsets in touch_number order and gives them the same instant', () => {
    const schedule = materializeCadenceSchedule({
      anchor: ANCHOR,
      templates: [
        { touchNumber: 2, offsetDays: 3, channel: 'email' },
        { touchNumber: 1, offsetDays: 3, channel: 'sms' },
      ],
      window: PERTH,
      preferredSendTime: '09:30',
      jitterMinutes: noJitter,
    });

    expect(schedule.map((t) => t.touchNumber)).toEqual([1, 2]);
    expect(schedule[0].scheduledAt.toISOString()).toBe(schedule[1].scheduledAt.toISOString());
  });

  it('refuses a duplicated touch_number rather than materializing a schedule the DB will reject', () => {
    expect(() =>
      materializeCadenceSchedule({
        anchor: ANCHOR,
        templates: [
          { touchNumber: 1, offsetDays: 0, channel: 'sms' },
          { touchNumber: 1, offsetDays: 3, channel: 'sms' },
        ],
        window: PERTH,
        preferredSendTime: '09:30',
        jitterMinutes: jitter7,
      }),
    ).toThrow(/touch_number|touchNumber/i);
  });

  it('refuses a negative offset rather than scheduling into the past', () => {
    expect(() =>
      materializeCadenceSchedule({
        anchor: ANCHOR,
        templates: [{ touchNumber: 1, offsetDays: -1, channel: 'sms' }],
        window: PERTH,
        preferredSendTime: '09:30',
        jitterMinutes: jitter7,
      }),
    ).toThrow(/offset/i);
  });

  it('refuses an unusable anchor rather than producing Invalid Dates', () => {
    expect(() =>
      materializeCadenceSchedule({
        anchor: new Date(NaN),
        templates: defaultTemplates(),
        window: PERTH,
        preferredSendTime: '09:30',
        jitterMinutes: jitter7,
      }),
    ).toThrow(/anchor/i);
  });
});

describe('materialize.ts is framework-free and holds no randomness of its own', () => {
  const source = readFileSync(
    new URL('../src/core/cadence/materialize.ts', import.meta.url),
    'utf8',
  );

  it('imports nothing from next/*', () => {
    expect(source).not.toMatch(/from ['"]next\//);
  });

  it('contains no Math.random — the injected RNG is the only randomness source', () => {
    expect(source).not.toContain('Math.random');
  });
});
