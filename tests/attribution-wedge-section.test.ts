/**
 * 07 CR-03 — THE WEDGE HAS TO REACH A HUMAN.
 *
 * The defect this suite pins is not that the attribution consumer can stop. It
 * is that when it stops, every screen keeps rendering, nothing throws, and the
 * report for that month shows all zeros — indistinguishable from a month where
 * nobody won anything. The counters existed; they reached a cron log and
 * stopped there, with no consumer anywhere in `src`.
 *
 * So the property under test is a SIGNAL, and signals fail in two directions.
 * A line that never fires is the bug being fixed. A line that fires on a quiet
 * Tuesday is worse than none at all, because a morning nag that is sometimes
 * noise is a morning nag that stops being read — and then the real wedge goes
 * past unnoticed too. Both directions are asserted.
 *
 * PURE. No database, runs on bare `npm test`.
 */
import { describe, expect, it } from 'vitest';

import {
  ATTRIBUTION_WEDGE_HOURS,
  buildAttributionWedgeSection,
} from '@/core/attribution/wedge-section';
import type { ConsumerBacklog } from '@/db/repository';

const NOW = new Date('2026-09-02T20:30:00.000Z');

/** `hours` before `NOW`. */
function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 3_600_000);
}

function backlog(over: Partial<ConsumerBacklog> = {}): ConsumerBacklog {
  return { pendingCount: 4, oldestPendingAt: hoursAgo(9), ...over };
}

describe('it fires when the cursor has stopped moving', () => {
  it('names the backlog and how long it has been waiting', () => {
    const section = buildAttributionWedgeSection(backlog(), NOW);

    expect(section).not.toBeNull();
    expect(section?.lines[0]).toContain('4 quote events');
    expect(section?.lines[0]).toContain('9 hours');
  });

  it('says what the operator should do about it', () => {
    // A symptom without a next step is a line that gets read once and then
    // skipped every morning after.
    const section = buildAttributionWedgeSection(backlog(), NOW);

    expect(section?.lines.join(' ')).toContain('cursor has not advanced');
  });

  it('warns that reports generated meanwhile are missing the wins behind it', () => {
    // THE CONSEQUENCE THAT COSTS MONEY. A report generated during a wedge is a
    // frozen document understating what the client is owed, and freezing it is
    // the one action here that cannot be undone.
    const section = buildAttributionWedgeSection(backlog(), NOW);

    expect(section?.lines.join(' ')).toContain('no report generated');
  });

  it('says "event", singular, for a backlog of one', () => {
    const section = buildAttributionWedgeSection(
      backlog({ pendingCount: 1, oldestPendingAt: hoursAgo(30) }),
      NOW,
    );

    expect(section?.lines[0]).toContain('1 quote event unread');
  });

  it('floors the wait to whole hours', () => {
    const section = buildAttributionWedgeSection(
      { pendingCount: 2, oldestPendingAt: hoursAgo(7.9) },
      NOW,
    );

    // "7 hours", never "7.9 hours" — the digest states durations the way every
    // other line in it does.
    expect(section?.lines[0]).toContain('7 hours');
  });
});

describe('it stays silent on everything that is not a wedge', () => {
  it('returns NULL rather than an empty section when the backlog is clear', () => {
    // A heading with nothing under it is a daily "still fine" all-clear, which
    // is exactly the trained blindness the digest's empty-send rule avoids.
    expect(buildAttributionWedgeSection({ pendingCount: 0, oldestPendingAt: null }, NOW)).toBeNull();
  });

  it('says nothing about a consumer that has never registered', () => {
    // NOT A WEDGE. A consumer with no position has taken no reading, and the
    // tick's attribution seam defaults to `'skip'` for every caller but the
    // route. Alerting here would fire on every developer machine forever.
    expect(buildAttributionWedgeSection(null, NOW)).toBeNull();
  });

  it('tolerates a normal minute-to-minute backlog', () => {
    // The consumer is per-minute. Events arriving between ticks are the healthy
    // state, and a line that fired on them would fire every single morning.
    expect(
      buildAttributionWedgeSection({ pendingCount: 12, oldestPendingAt: hoursAgo(0.05) }, NOW),
    ).toBeNull();
  });

  it('holds its fire right up to the threshold, and fires once past it', () => {
    const justUnder = buildAttributionWedgeSection(
      { pendingCount: 3, oldestPendingAt: hoursAgo(ATTRIBUTION_WEDGE_HOURS - 0.1) },
      NOW,
    );
    const justOver = buildAttributionWedgeSection(
      { pendingCount: 3, oldestPendingAt: hoursAgo(ATTRIBUTION_WEDGE_HOURS + 0.1) },
      NOW,
    );

    expect(justUnder).toBeNull();
    expect(justOver).not.toBeNull();
  });

  it('does not name a client, or anything a client could be identified by', () => {
    // The read this consumes returns a count and a timestamp by construction.
    // Asserting it here too keeps a future field from riding into an email.
    const section = buildAttributionWedgeSection(backlog(), NOW);
    const text = `${section?.heading ?? ''} ${section?.lines.join(' ') ?? ''}`;

    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i); // no uuid
    expect(text).not.toMatch(/@/); // no address
    expect(text).not.toMatch(/\+61/); // no mobile
  });
});
