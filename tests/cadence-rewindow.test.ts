/**
 * D-09/D-10/D-11/D-12 — what happens to a touch that missed its slot, and D-07 —
 * what happens to a whole cadence that missed a fortnight of them.
 *
 * ── WHY THIS SUITE IS A TABLE OF BOUNDARIES ─────────────────────────────────
 *
 * Every arm of the re-window policy is a threshold comparison, and every
 * threshold has exactly one interesting input: the value itself. `MIN_GAP_HOURS`
 * is 48 and the only case worth arguing about is a gap of exactly 48 hours; the
 * same is true of the staleness cap and the expiry. So each of the three
 * thresholds is asserted at the boundary AND one millisecond past it, and the
 * direction each falls is stated in the test name rather than left for a reader
 * to infer from a passing assertion.
 *
 * Every one of them falls on the side that KEEPS THE CADENCE ALIVE. A magnitude
 * somebody chose is the last acceptable value, not the first unacceptable one —
 * "no more than 72 hours late" includes 72.
 *
 * ── PINNED INSTANTS, PERTH WALL CLOCK ───────────────────────────────────────
 *
 * Perth is UTC+8 and never changes offset, which is exactly why the DST proofs
 * live in `cadence-window.test.ts` against Sydney instead. Here the zone is a
 * fixed lens so the assertions can be about POLICY: dates are written as the
 * tenant experiences them and converted once, at the edge.
 *
 * No database, no clock reads, no environment: `npx vitest run
 * tests/cadence-rewindow.test.ts` runs on a bare checkout.
 */
import { readFileSync } from 'node:fs';

import { TZDate } from '@date-fns/tz';
import { describe, expect, it } from 'vitest';

import {
  CADENCE_EXPIRY_DAYS,
  MIN_GAP_HOURS,
  SAME_DAY_MARGIN_MINUTES,
  STALENESS_CAP_HOURS,
} from '../src/core/cadence/constants';
import { computeResumeSchedule } from '../src/core/cadence/resume';
import { rewindowTouch } from '../src/core/cadence/rewindow';
import { isInsideWindow, nextAllowedSlot, type ContactWindow } from '../src/core/cadence/window';

const ZONE = 'Australia/Perth';

/** A Perth office week: 08:00–17:00, Monday to Friday. */
const PERTH: ContactWindow = {
  timezone: ZONE,
  contactHoursStart: '08:00:00',
  contactHoursEnd: '17:00:00',
  contactDays: [1, 2, 3, 4, 5],
};

const PREFERRED = '09:30';

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

const noJitter = () => 0;
const jitter7 = () => 7;

/** A Perth wall-clock moment, written the way the tradie would say it. */
function perth(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes = 0,
): Date {
  return new Date(new TZDate(year, month - 1, day, hours, minutes, 0, ZONE).getTime());
}

/** The tenant-zone calendar date, for gap assertions expressed in DAYS. */
function perthDateKey(instant: Date): number {
  const zoned = new TZDate(instant, ZONE);
  return Date.UTC(zoned.getFullYear(), zoned.getMonth(), zoned.getDate()) / MS_PER_DAY;
}

/** Calendar days between two instants, in the tenant's zone. */
function calendarDaysBetween(from: Date, to: Date): number {
  return perthDateKey(to) - perthDateKey(from);
}

/**
 * The full input, with every field named at one call site so a case only has to
 * state what it is actually about.
 */
function ask(overrides: {
  scheduledAt: Date;
  now: Date;
  anchorAt?: Date;
  nextTouchAt?: Date | null;
  jitterMinutes?: () => number;
  window?: ContactWindow;
}) {
  return rewindowTouch({
    touch: { scheduledAt: overrides.scheduledAt },
    nextTouch:
      overrides.nextTouchAt == null ? null : { scheduledAt: overrides.nextTouchAt },
    // Far enough back to be a real cadence and far enough forward to be nowhere
    // near D-12, unless a case says otherwise.
    cadenceAnchorAt: overrides.anchorAt ?? perth(2026, 9, 2, 10),
    window: overrides.window ?? PERTH,
    preferredSendTime: PREFERRED,
    now: overrides.now,
    jitterMinutes: overrides.jitterMinutes ?? noJitter,
  });
}

// ── D-12: the cadence outlives its own schedule ─────────────────────────────

describe('rewindowTouch — D-12 expiry is evaluated first', () => {
  const anchor = perth(2026, 9, 2, 10); // Wednesday

  it('expires the cadence when the anchor is older than CADENCE_EXPIRY_DAYS', () => {
    const now = new Date(anchor.getTime() + CADENCE_EXPIRY_DAYS * MS_PER_DAY + 1);

    expect(ask({ scheduledAt: now, now, anchorAt: anchor })).toEqual({
      kind: 'expire_cadence',
    });
  });

  it('does NOT expire at exactly CADENCE_EXPIRY_DAYS — the boundary keeps the cadence alive', () => {
    const now = new Date(anchor.getTime() + CADENCE_EXPIRY_DAYS * MS_PER_DAY);

    expect(ask({ scheduledAt: now, now, anchorAt: anchor }).kind).not.toBe(
      'expire_cadence',
    );
  });

  it('expires rather than skipping, even when the touch is also stale', () => {
    // Both rules apply. An expired cadence's touches are never individually
    // judged: the cadence is over, and skipping one touch of it would leave four
    // more for the next tick to reach the same conclusion about.
    const now = new Date(anchor.getTime() + (CADENCE_EXPIRY_DAYS + 5) * MS_PER_DAY);
    const scheduledAt = new Date(now.getTime() - (STALENESS_CAP_HOURS + 10) * MS_PER_HOUR);

    expect(ask({ scheduledAt, now, anchorAt: anchor })).toEqual({ kind: 'expire_cadence' });
  });
});

// ── D-11: a late touch is worse than a skipped touch ────────────────────────

describe('rewindowTouch — D-11 staleness', () => {
  const slot = perth(2026, 9, 2, 10); // Wednesday 10:00, inside the window

  it('skips a touch more than STALENESS_CAP_HOURS past its slot', () => {
    const now = new Date(slot.getTime() + STALENESS_CAP_HOURS * MS_PER_HOUR + 1);

    expect(ask({ scheduledAt: slot, now, anchorAt: slot })).toEqual({
      kind: 'skip',
      reason: 'stale',
    });
  });

  it('does NOT skip at exactly STALENESS_CAP_HOURS — the cap is the last sendable moment', () => {
    // 72 hours after Wednesday 10:00 is Saturday 10:00, which is outside the
    // contact days — so the answer is a reschedule, and the point of the case is
    // that it is NOT a skip.
    const now = new Date(slot.getTime() + STALENESS_CAP_HOURS * MS_PER_HOUR);

    expect(ask({ scheduledAt: slot, now, anchorAt: slot }).kind).toBe('reschedule');
  });

  it('judges staleness BEFORE any reschedule — a stale touch outside the window is skipped, not moved', () => {
    const now = perth(2026, 9, 6, 3); // Sunday 03:00: closed day, closed hours
    const scheduledAt = new Date(now.getTime() - (STALENESS_CAP_HOURS + 1) * MS_PER_HOUR);

    expect(ask({ scheduledAt, now, anchorAt: scheduledAt })).toEqual({
      kind: 'skip',
      reason: 'stale',
    });
  });
});

// ── The slot stands: nothing to repair ──────────────────────────────────────

describe('rewindowTouch — send_now', () => {
  it('sends a due touch that is inside the window with margin and inside the cap', () => {
    const slot = perth(2026, 9, 2, 10);
    const now = new Date(slot.getTime() + 30 * 60_000);

    expect(ask({ scheduledAt: slot, now, anchorAt: slot })).toEqual({ kind: 'send_now' });
  });

  it('leaves a touch whose slot has not arrived alone', () => {
    const slot = perth(2026, 9, 2, 14);
    const now = perth(2026, 9, 2, 10);

    expect(ask({ scheduledAt: slot, now, anchorAt: now })).toEqual({ kind: 'send_now' });
  });
});

// ── D-09: where a missed touch goes instead ─────────────────────────────────

describe('rewindowTouch — D-09 reschedule', () => {
  it('reschedules to the next allowed day when the window has closed for the day', () => {
    const slot = perth(2026, 9, 2, 16); // Wednesday 16:00
    const now = perth(2026, 9, 2, 18); // Wednesday 18:00 — an hour past close

    const action = ask({ scheduledAt: slot, now, anchorAt: slot });

    expect(action).toEqual({ kind: 'reschedule', at: perth(2026, 9, 3, 9, 30) });
  });

  it('reschedules to the next allowed day when less than SAME_DAY_MARGIN_MINUTES remain', () => {
    // Half the margin before close — inside contact hours and practically an
    // ambush at knock-off: a reply lands after hours and sits unread overnight.
    // Derived from the constant rather than written as 16:30, so raising the
    // margin cannot leave this case asserting something else by accident.
    const closeToday = perth(2026, 9, 2, 17);
    const now = new Date(closeToday.getTime() - (SAME_DAY_MARGIN_MINUTES / 2) * 60_000);
    const slot = perth(2026, 9, 2, 12);

    expect(ask({ scheduledAt: slot, now, anchorAt: slot })).toEqual({
      kind: 'reschedule',
      at: perth(2026, 9, 3, 9, 30),
    });
  });

  it('rolls past a day the tenant does not contact', () => {
    const now = perth(2026, 9, 5, 11); // Saturday
    const slot = perth(2026, 9, 4, 16); // Friday

    expect(ask({ scheduledAt: slot, now, anchorAt: slot })).toEqual({
      kind: 'reschedule',
      at: perth(2026, 9, 7, 9, 30), // Monday
    });
  });

  it('delegates the slot to nextAllowedSlot rather than placing one of its own', () => {
    const now = perth(2026, 9, 6, 12); // Sunday
    const slot = perth(2026, 9, 4, 16);

    const action = ask({ scheduledAt: slot, now, anchorAt: slot, jitterMinutes: jitter7 });
    const expected = nextAllowedSlot(now, PERTH, PREFERRED, jitter7);

    expect(action).toEqual({ kind: 'reschedule', at: expected });
  });

  it('takes its jitter from the injected RNG', () => {
    const now = perth(2026, 9, 6, 12); // Sunday
    const slot = perth(2026, 9, 4, 16);

    expect(ask({ scheduledAt: slot, now, anchorAt: slot, jitterMinutes: jitter7 })).toEqual({
      kind: 'reschedule',
      at: perth(2026, 9, 7, 9, 37),
    });
  });
});

// ── D-10: the customer never gets two texts in a morning ────────────────────

describe('rewindowTouch — D-10 minimum gap', () => {
  const now = perth(2026, 9, 6, 12); // Sunday — the window is shut
  const slot = perth(2026, 9, 4, 16); // Friday's missed touch
  /** Where the missed touch WOULD land: Monday 09:30. */
  const candidate = perth(2026, 9, 7, 9, 30);

  it('skips with min_gap when the candidate lands within MIN_GAP_HOURS of the next unsent touch', () => {
    const nextTouchAt = new Date(candidate.getTime() + MIN_GAP_HOURS * MS_PER_HOUR - 1);

    expect(ask({ scheduledAt: slot, now, anchorAt: slot, nextTouchAt })).toEqual({
      kind: 'skip',
      reason: 'min_gap',
    });
  });

  it('reschedules at exactly MIN_GAP_HOURS — the boundary is not "within"', () => {
    const nextTouchAt = new Date(candidate.getTime() + MIN_GAP_HOURS * MS_PER_HOUR);

    expect(ask({ scheduledAt: slot, now, anchorAt: slot, nextTouchAt })).toEqual({
      kind: 'reschedule',
      at: candidate,
    });
  });

  it('treats a candidate landing AFTER the next touch as within the gap', () => {
    // A negative gap is not "plenty of room"; it is the missed touch overtaking
    // the one that was supposed to follow it.
    const nextTouchAt = new Date(candidate.getTime() - MS_PER_HOUR);

    expect(ask({ scheduledAt: slot, now, anchorAt: slot, nextTouchAt })).toEqual({
      kind: 'skip',
      reason: 'min_gap',
    });
  });

  it('never skips for min_gap when this is the last unsent touch', () => {
    expect(ask({ scheduledAt: slot, now, anchorAt: slot, nextTouchAt: null })).toEqual({
      kind: 'reschedule',
      at: candidate,
    });
  });
});

// ── D-07: one resume rule for every pause type ──────────────────────────────

describe('computeResumeSchedule — D-07', () => {
  /** The four touches still unsent when the cadence was paused. */
  const unsent = [
    { id: 't2', touchNumber: 2, scheduledAt: perth(2026, 9, 3, 9, 30), originalOffsetDays: 3 },
    { id: 't3', touchNumber: 3, scheduledAt: perth(2026, 9, 7, 9, 30), originalOffsetDays: 7 },
    { id: 't4', touchNumber: 4, scheduledAt: perth(2026, 9, 14, 9, 30), originalOffsetDays: 14 },
    { id: 't5', touchNumber: 5, scheduledAt: perth(2026, 9, 21, 9, 30), originalOffsetDays: 21 },
  ];

  /** Ten days after the pause began, on a Sunday — the window is shut. */
  const resumeAt = perth(2026, 9, 13, 12);

  function resume(jitterMinutes = noJitter) {
    return computeResumeSchedule({
      unsentTouches: unsent,
      window: PERTH,
      preferredSendTime: PREFERRED,
      resumeAt,
      jitterMinutes,
    });
  }

  it('places the first unsent touch at the next allowed slot from the resume moment', () => {
    const [first] = resume();

    expect(first.touchId).toBe('t2');
    expect(first.scheduledAt).toEqual(nextAllowedSlot(resumeAt, PERTH, PREFERRED, noJitter));
    expect(first.scheduledAt.getTime()).toBeGreaterThan(resumeAt.getTime());
  });

  it('preserves the ORIGINAL relative gaps in days rather than compressing them', () => {
    const placed = resume();

    // The template's own deltas: 7-3, 14-7, 21-14.
    expect(placed.map((p) => p.touchNumber)).toEqual([2, 3, 4, 5]);
    expect(calendarDaysBetween(placed[0].scheduledAt, placed[1].scheduledAt)).toBe(4);
    expect(calendarDaysBetween(placed[1].scheduledAt, placed[2].scheduledAt)).toBe(7);
    expect(calendarDaysBetween(placed[2].scheduledAt, placed[3].scheduledAt)).toBe(7);
  });

  it('never bursts: every consecutive pair is at least MIN_GAP_HOURS apart', () => {
    const placed = resume();

    for (let i = 1; i < placed.length; i += 1) {
      const gap = placed[i].scheduledAt.getTime() - placed[i - 1].scheduledAt.getTime();
      expect(gap).toBeGreaterThanOrEqual(MIN_GAP_HOURS * MS_PER_HOUR);
    }
  });

  it('places every touch inside the contact window, on an allowed day', () => {
    for (const placed of resume()) {
      expect(isInsideWindow(placed.scheduledAt, PERTH)).toBe(true);
    }
  });

  it('is deterministic under a pinned RNG', () => {
    expect(resume(jitter7)).toEqual(resume(jitter7));
  });

  it('returns [] for a cadence with nothing left to send', () => {
    expect(
      computeResumeSchedule({
        unsentTouches: [],
        window: PERTH,
        preferredSendTime: PREFERRED,
        resumeAt,
        jitterMinutes: noJitter,
      }),
    ).toEqual([]);
  });

  it('collapses two touches that shared an offset rather than scheduling backwards', () => {
    const placed = computeResumeSchedule({
      unsentTouches: [
        { id: 'a', touchNumber: 1, scheduledAt: perth(2026, 9, 3, 9, 30), originalOffsetDays: 3 },
        { id: 'b', touchNumber: 2, scheduledAt: perth(2026, 9, 3, 9, 30), originalOffsetDays: 3 },
      ],
      window: PERTH,
      preferredSendTime: PREFERRED,
      resumeAt,
      jitterMinutes: noJitter,
    });

    expect(placed[1].scheduledAt.getTime()).toBeGreaterThanOrEqual(
      placed[0].scheduledAt.getTime(),
    );
  });

  /**
   * A RESUME MUST NEVER PULL A TOUCH EARLIER THAN WHERE IT ALREADY STOOD.
   *
   * The fixture above cannot see this: its `resumeAt` is Sep 13, and the two
   * touches that are still in the future (Sep 14, Sep 21) happen to be pushed
   * LATER by the chained arithmetic, so an unclamped first placement never shows
   * up. Every assertion in this describe holds for a schedule that has been
   * dragged forward. These two do not.
   */
  describe('never promotes a touch that had not yet fallen due', () => {
    /** Paused and resumed minutes apart. Nothing slipped; nothing may move. */
    const stillFuture = perth(2026, 9, 17, 9, 30);
    const resumedMinutesLater = perth(2026, 9, 14, 10, 15);

    function resumeOne(scheduledAt: Date) {
      return computeResumeSchedule({
        unsentTouches: [{ id: 't2', touchNumber: 2, scheduledAt, originalOffsetDays: 3 }],
        window: PERTH,
        preferredSendTime: PREFERRED,
        resumeAt: resumedMinutesLater,
        jitterMinutes: noJitter,
      });
    }

    it('returns a future touch on its ORIGINAL slot, to the millisecond', () => {
      const [placed] = resumeOne(stillFuture);

      // Not merely "on or after resumeAt" — unchanged. An assertion that only
      // checked the ordering would pass on the three-days-early placement this
      // exists to forbid.
      expect(placed.scheduledAt.getTime()).toBe(stillFuture.getTime());
    });

    it('still repairs an OVERDUE touch — the clamp is one-directional', () => {
      const overdue = perth(2026, 9, 10, 9, 30);
      const [placed] = resumeOne(overdue);

      expect(placed.scheduledAt.getTime()).toBeGreaterThan(overdue.getTime());
      expect(placed.scheduledAt).toEqual(
        nextAllowedSlot(resumedMinutesLater, PERTH, PREFERRED, noJitter),
      );
    });

    it('derives the touches behind a clamped one from the clamped slot', () => {
      const placed = computeResumeSchedule({
        unsentTouches: [
          { id: 't2', touchNumber: 2, scheduledAt: stillFuture, originalOffsetDays: 3 },
          {
            id: 't3',
            touchNumber: 3,
            scheduledAt: perth(2026, 9, 21, 9, 30),
            originalOffsetDays: 7,
          },
        ],
        window: PERTH,
        preferredSendTime: PREFERRED,
        resumeAt: resumedMinutesLater,
        jitterMinutes: noJitter,
      });

      expect(placed[0].scheduledAt.getTime()).toBe(stillFuture.getTime());
      // The template's own delta (7 - 3), measured from the slot that stood.
      expect(calendarDaysBetween(placed[0].scheduledAt, placed[1].scheduledAt)).toBe(4);
      expect(placed[1].scheduledAt.getTime()).toBeGreaterThan(placed[0].scheduledAt.getTime());
    });
  });

  it('reads the touches in touch_number order whatever order they arrive in', () => {
    const shuffled = [unsent[2], unsent[0], unsent[3], unsent[1]];

    expect(
      computeResumeSchedule({
        unsentTouches: shuffled,
        window: PERTH,
        preferredSendTime: PREFERRED,
        resumeAt,
        jitterMinutes: noJitter,
      }),
    ).toEqual(resume());
  });
});

// ── The purity the whole policy rests on ────────────────────────────────────

describe('rewindow.ts and resume.ts hold no randomness and no framework', () => {
  const rewindowSource = readFileSync(
    new URL('../src/core/cadence/rewindow.ts', import.meta.url),
    'utf8',
  );
  const resumeSource = readFileSync(
    new URL('../src/core/cadence/resume.ts', import.meta.url),
    'utf8',
  );

  it('imports nothing from next/*', () => {
    expect(rewindowSource).not.toMatch(/from ['"]next\//);
    expect(resumeSource).not.toMatch(/from ['"]next\//);
  });

  it('contains no call to the global random source — the RNG is injected or it is not deterministic', () => {
    expect(rewindowSource).not.toContain('Math.rand' + 'om');
    expect(resumeSource).not.toContain('Math.rand' + 'om');
  });

  it('keeps rewindow.ts free of the database layer entirely', () => {
    expect(rewindowSource).not.toMatch(/from ['"].*drizzle/);
    expect(rewindowSource).not.toMatch(/from ['"]@\/db/);
  });

  it("reaches the database only through the repository's tenant scope in resume.ts", () => {
    expect(resumeSource).toMatch(/forTenant/);
    expect(resumeSource).not.toMatch(/getDb|repository\/client/);
  });
});
