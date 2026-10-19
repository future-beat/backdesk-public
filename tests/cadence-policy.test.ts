/**
 * Phase 13 (D-03, LEAD-05) — the per-kind cadence policy, at its boundaries.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE ROADMAP'S SEAM: a lead's touches 2 and 3 are one day apart. Under    │
 * │ the quote's 48-hour minimum gap every slipped touch 2 is retired         │
 * │ `min_gap`, and a lead cadence lives six weeks. This suite pins that the  │
 * │ two kinds get different numbers, and that `rewindowTouch` uses whichever │
 * │ numbers it is handed — at each boundary and one millisecond past it.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The same rule as `tests/cadence-rewindow.test.ts` (which stays untouched and
 * keeps proving the quote numbers through the DEFAULT policy): a magnitude is
 * the LAST acceptable value, so exactly 12 hours before the next touch, exactly
 * 24 hours late and exactly 7 days old all keep the lead cadence alive.
 *
 * PURE — no database, no clock reads, no environment: it imports neither the
 * seed helpers nor a database client, and runs on a bare checkout.
 */
import { TZDate } from '@date-fns/tz';
import { describe, expect, it } from 'vitest';

import {
  CADENCE_EXPIRY_DAYS,
  DEFAULT_TOUCH_OFFSET_DAYS,
  MIN_GAP_HOURS,
  STALENESS_CAP_HOURS,
} from '../src/core/cadence/constants';
import { LEAD_POLICY, policyFor, QUOTE_POLICY, type CadencePolicy } from '../src/core/cadence/policy';
import { rewindowTouch } from '../src/core/cadence/rewindow';
import { nextAllowedSlot, type ContactWindow } from '../src/core/cadence/window';
import {
  LEAD_EXPIRY_DAYS,
  LEAD_MIN_GAP_HOURS,
  LEAD_STALENESS_CAP_HOURS,
  LEAD_TOUCH_OFFSET_DAYS,
} from '../src/core/leads/constants';

const ZONE = 'Australia/Perth';

/** A Perth office week: 08:00–17:00, Monday to Friday (the seeded tenant's). */
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

/** A Perth wall-clock moment. */
function perth(year: number, month: number, day: number, hours: number, minutes = 0): Date {
  return new Date(new TZDate(year, month - 1, day, hours, minutes, 0, ZONE).getTime());
}

function at(base: Date, ms: number): Date {
  return new Date(base.getTime() + ms);
}

/** One touch judged under one policy; every other input fixed unless stated. */
function judge(
  policy: CadencePolicy | undefined,
  input: { scheduledAt: Date; now: Date; anchorAt: Date; nextTouchAt?: Date | null },
) {
  return rewindowTouch({
    touch: { scheduledAt: input.scheduledAt },
    nextTouch: input.nextTouchAt == null ? null : { scheduledAt: input.nextTouchAt },
    cadenceAnchorAt: input.anchorAt,
    window: PERTH,
    preferredSendTime: PREFERRED,
    now: input.now,
    jitterMinutes: noJitter,
    policy,
  });
}

describe('policyFor(kind) — one object per kind', () => {
  it('gives the quote the four quote constants, unchanged', () => {
    expect(policyFor('quote')).toEqual({
      minGapHours: MIN_GAP_HOURS,
      stalenessCapHours: STALENESS_CAP_HOURS,
      expiryDays: CADENCE_EXPIRY_DAYS,
      touchOffsetDays: DEFAULT_TOUCH_OFFSET_DAYS,
    });
    expect(policyFor('quote')).toBe(QUOTE_POLICY);
    // The numbers themselves, so a drift in the constants module is loud here too.
    expect([MIN_GAP_HOURS, STALENESS_CAP_HOURS, CADENCE_EXPIRY_DAYS]).toEqual([48, 72, 42]);
    expect([...DEFAULT_TOUCH_OFFSET_DAYS]).toEqual([0, 3, 7, 14, 21]);
  });

  it('gives the lead the four lead constants', () => {
    expect(policyFor('lead')).toEqual({
      minGapHours: LEAD_MIN_GAP_HOURS,
      stalenessCapHours: LEAD_STALENESS_CAP_HOURS,
      expiryDays: LEAD_EXPIRY_DAYS,
      touchOffsetDays: LEAD_TOUCH_OFFSET_DAYS,
    });
    expect(policyFor('lead')).toBe(LEAD_POLICY);
    expect([LEAD_MIN_GAP_HOURS, LEAD_STALENESS_CAP_HOURS, LEAD_EXPIRY_DAYS]).toEqual([12, 24, 7]);
    expect([...LEAD_TOUCH_OFFSET_DAYS]).toEqual([0, 1, 2]);
  });
});

describe('the minimum gap — 12 hours for a lead, 48 for a quote', () => {
  // Touch 2 was due Wednesday 09:30 and nobody approved it until 17:30, after
  // the window closed: its candidate is the next allowed slot.
  const anchor = perth(2026, 10, 6, 10); // Tuesday — the call
  const scheduledAt = perth(2026, 10, 7, 9, 30); // Wednesday
  const now = perth(2026, 10, 7, 17, 30);
  const candidate = nextAllowedSlot(now, PERTH, PREFERRED, noJitter, { sameDayMarginMinutes: 60 });

  it('a lead touch 2 whose candidate lands on touch 3\'s slot is min_gap — one message that morning', () => {
    expect(judge(LEAD_POLICY, { scheduledAt, now, anchorAt: anchor, nextTouchAt: candidate })).toEqual({
      kind: 'skip',
      reason: 'min_gap',
    });
  });

  it('a lead touch 2 exactly 12 hours before touch 3 is rescheduled — the boundary keeps it', () => {
    const nextTouchAt = at(candidate, LEAD_MIN_GAP_HOURS * MS_PER_HOUR);
    expect(judge(LEAD_POLICY, { scheduledAt, now, anchorAt: anchor, nextTouchAt })).toEqual({
      kind: 'reschedule',
      at: candidate,
    });
  });

  it('one millisecond inside 12 hours is min_gap', () => {
    const nextTouchAt = at(candidate, LEAD_MIN_GAP_HOURS * MS_PER_HOUR - 1);
    expect(judge(LEAD_POLICY, { scheduledAt, now, anchorAt: anchor, nextTouchAt }).kind).toBe('skip');
  });

  it('the same inputs under the quote policy are min_gap — the 48-hour rule', () => {
    const nextTouchAt = at(candidate, LEAD_MIN_GAP_HOURS * MS_PER_HOUR);
    expect(judge(QUOTE_POLICY, { scheduledAt, now, anchorAt: anchor, nextTouchAt })).toEqual({
      kind: 'skip',
      reason: 'min_gap',
    });
    // ...and the quote's own boundary is 48: exactly 48 hours away is rescheduled.
    expect(
      judge(QUOTE_POLICY, {
        scheduledAt,
        now,
        anchorAt: anchor,
        nextTouchAt: at(candidate, MIN_GAP_HOURS * MS_PER_HOUR),
      }).kind,
    ).toBe('reschedule');
  });

  it('no policy at all decides as the quote policy (the default every older caller relies on)', () => {
    const nextTouchAt = at(candidate, LEAD_MIN_GAP_HOURS * MS_PER_HOUR);
    expect(judge(undefined, { scheduledAt, now, anchorAt: anchor, nextTouchAt })).toEqual(
      judge(QUOTE_POLICY, { scheduledAt, now, anchorAt: anchor, nextTouchAt }),
    );
  });
});

describe('the staleness cap — 24 hours for a lead, 72 for a quote', () => {
  const anchor = perth(2026, 10, 6, 10); // Tuesday
  const now = perth(2026, 10, 8, 10); // Thursday 10:00, window open with margin

  it('a lead touch exactly 24 hours late is still sendable', () => {
    const scheduledAt = at(now, -LEAD_STALENESS_CAP_HOURS * MS_PER_HOUR);
    expect(judge(LEAD_POLICY, { scheduledAt, now, anchorAt: anchor })).toEqual({ kind: 'send_now' });
  });

  it('a lead touch 24 hours and 1 ms late is stale', () => {
    const scheduledAt = at(now, -LEAD_STALENESS_CAP_HOURS * MS_PER_HOUR - 1);
    expect(judge(LEAD_POLICY, { scheduledAt, now, anchorAt: anchor })).toEqual({
      kind: 'skip',
      reason: 'stale',
    });
  });

  it('the same 24 h + 1 ms under the quote policy is still sendable; 72 h + 1 ms is not', () => {
    const anchorLongAgo = perth(2026, 9, 20, 10);
    expect(
      judge(QUOTE_POLICY, {
        scheduledAt: at(now, -LEAD_STALENESS_CAP_HOURS * MS_PER_HOUR - 1),
        now,
        anchorAt: anchorLongAgo,
      }),
    ).toEqual({ kind: 'send_now' });
    expect(
      judge(QUOTE_POLICY, {
        scheduledAt: at(now, -STALENESS_CAP_HOURS * MS_PER_HOUR - 1),
        now,
        anchorAt: anchorLongAgo,
      }),
    ).toEqual({ kind: 'skip', reason: 'stale' });
  });
});

describe('the expiry — 7 days for a lead, 42 for a quote', () => {
  const anchor = perth(2026, 10, 7, 10); // Wednesday

  it('a lead cadence exactly 7 days old is still live', () => {
    const now = at(anchor, LEAD_EXPIRY_DAYS * MS_PER_DAY);
    expect(judge(LEAD_POLICY, { scheduledAt: now, now, anchorAt: anchor }).kind).not.toBe(
      'expire_cadence',
    );
  });

  it('a lead cadence 7 days and 1 ms old expires', () => {
    const now = at(anchor, LEAD_EXPIRY_DAYS * MS_PER_DAY + 1);
    expect(judge(LEAD_POLICY, { scheduledAt: now, now, anchorAt: anchor })).toEqual({
      kind: 'expire_cadence',
    });
  });

  it('the same age under the quote policy is nowhere near expiry; 42 days and 1 ms is', () => {
    const now = at(anchor, LEAD_EXPIRY_DAYS * MS_PER_DAY + 1);
    expect(judge(QUOTE_POLICY, { scheduledAt: now, now, anchorAt: anchor }).kind).not.toBe(
      'expire_cadence',
    );
    const late = at(anchor, CADENCE_EXPIRY_DAYS * MS_PER_DAY + 1);
    expect(judge(QUOTE_POLICY, { scheduledAt: late, now: late, anchorAt: anchor })).toEqual({
      kind: 'expire_cadence',
    });
  });
});

describe('the long weekend — why the lead expiry is 7 days and not 4', () => {
  /**
   * A Friday 14:00 call before a long weekend: the client does not work the
   * Monday holiday, so touch 2 lands on Tuesday and touch 3 on Wednesday at
   * the preferred time. With the 24-hour staleness slack touch 3 may still
   * send on Thursday morning — 5.8 days after the call. Expiry is judged
   * first, so a 4-day lead expiry would end the cadence before touch 3 could
   * ever go.
   */
  const anchor = perth(2026, 10, 9, 14); // Friday
  const touch3 = perth(2026, 10, 14, 9, 30); // the following Wednesday

  it('touch 3 on the following Wednesday is inside the window and sent', () => {
    const now = perth(2026, 10, 14, 10);
    expect(judge(LEAD_POLICY, { scheduledAt: touch3, now, anchorAt: anchor })).toEqual({
      kind: 'send_now',
    });
  });

  it('touch 3 still sends on Thursday morning, exactly 24 hours late, inside 7 days', () => {
    const now = at(touch3, LEAD_STALENESS_CAP_HOURS * MS_PER_HOUR);
    expect(now.getTime() - anchor.getTime()).toBeLessThan(LEAD_EXPIRY_DAYS * MS_PER_DAY);
    expect(judge(LEAD_POLICY, { scheduledAt: touch3, now, anchorAt: anchor })).toEqual({
      kind: 'send_now',
    });
  });

  it('a 4-day expiry would have ended that cadence first', () => {
    const now = perth(2026, 10, 14, 10);
    expect(
      judge({ ...LEAD_POLICY, expiryDays: 4 }, { scheduledAt: touch3, now, anchorAt: anchor }),
    ).toEqual({ kind: 'expire_cadence' });
  });
});
