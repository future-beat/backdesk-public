/**
 * Phase 14 (D-01, D-02; checker W3): the ServiceM8 job description is the
 * caller's verbatim words and three fixed lines, deterministic, and the
 * sheet's preview (`composeJobDescription` over `previewLinesFor`) and the
 * action's write (`buildJobDescription`) agree byte for byte.
 *
 * PURE: no database, no network. Every reply here is invented words.
 */
import { describe, expect, it } from 'vitest';

import {
  buildJobDescription,
  composeJobDescription,
  JOB_NOTE_PREFIX,
  noteLineFor,
  previewLinesFor,
  urgencyLineFor,
} from '../src/core/leads/job-description';

const CALL = new Date('2026-10-09T23:30:00Z'); // 10 Oct 2026, 07:30 in Perth
const NOTE = 'Created by Backdesk from a missed call on 10 Oct 2026 at 7:30 am';

const facts = {
  replies: [
    { body: 'Need a quote for a fence, Fiction Street', urgency: null },
    { body: '  It is about twenty metres\nall timber  ', urgency: 'this_week' },
  ],
  firstMissedAt: CALL,
  timezone: 'Australia/Perth',
};

describe('the job description (D-02)', () => {
  it('is byte-identical for the same input', () => {
    const a = buildJobDescription(facts, 'Fictionville');
    const b = buildJobDescription(
      { ...facts, replies: facts.replies.map((r) => ({ ...r })) },
      'Fictionville',
    );
    expect(a).toBe(b);
  });

  it('puts each reply on its own line in the order given, then suburb, urgency and the note', () => {
    expect(buildJobDescription(facts, 'Fictionville')).toBe(
      [
        'Need a quote for a fence, Fiction Street',
        'It is about twenty metres\nall timber',
        'Suburb: Fictionville',
        'Urgency: this week',
        NOTE,
      ].join('\n'),
    );
  });

  it('writes the suburb line only when one is given', () => {
    const none = buildJobDescription(facts, null);
    const blank = buildJobDescription(facts, '   ');
    expect(none).not.toContain('Suburb:');
    expect(blank).toBe(none);
  });

  it('maps the urgency through the closed vocabulary, and writes nothing for unknown', () => {
    expect(urgencyLineFor('emergency')).toBe('Urgency: emergency');
    expect(urgencyLineFor('this_week')).toBe('Urgency: this week');
    expect(urgencyLineFor('flexible')).toBe('Urgency: flexible');
    expect(urgencyLineFor('unknown')).toBeNull();
    expect(urgencyLineFor(null)).toBeNull();
    expect(urgencyLineFor('not_a_value')).toBeNull();
  });

  it('takes the urgency from the NEWEST labelled reply', () => {
    const lines = previewLinesFor({
      ...facts,
      replies: [
        { body: 'first', urgency: 'flexible' },
        { body: 'second', urgency: 'emergency' },
        { body: 'third', urgency: 'unknown' },
        { body: 'fourth', urgency: null },
      ],
    });
    expect(lines.urgencyLine).toBe('Urgency: emergency');
  });

  it('names the call date and time in the tenant zone, not UTC', () => {
    expect(noteLineFor(CALL, 'Australia/Perth')).toBe(NOTE);
    expect(noteLineFor(CALL, 'UTC')).toBe(`${JOB_NOTE_PREFIX}9 Oct 2026 at 11:30 pm`);
  });

  it('formats the time to the minute, 12-hour, midnight and noon as 12 (WR-02)', () => {
    // Perth is UTC+8 all year.
    expect(noteLineFor(new Date('2026-10-09T16:00:00Z'), 'Australia/Perth')).toBe(
      `${JOB_NOTE_PREFIX}10 Oct 2026 at 12:00 am`,
    );
    expect(noteLineFor(new Date('2026-10-10T04:05:59Z'), 'Australia/Perth')).toBe(
      `${JOB_NOTE_PREFIX}10 Oct 2026 at 12:05 pm`,
    );
    expect(noteLineFor(new Date('2026-10-10T13:59:00Z'), 'Australia/Perth')).toBe(
      `${JOB_NOTE_PREFIX}10 Oct 2026 at 9:59 pm`,
    );
  });

  it('two leads with the same words on the same day but different call minutes differ (WR-02)', () => {
    const later = { ...facts, firstMissedAt: new Date(CALL.getTime() + 60_000) };
    expect(buildJobDescription(later, null)).not.toBe(buildJobDescription(facts, null));
  });

  it('drops an empty reply', () => {
    const text = composeJobDescription({
      replies: ['', '   ', 'Gate is broken'],
      suburb: null,
      urgencyLine: null,
      noteLine: NOTE,
    });
    expect(text).toBe(`Gate is broken\n${NOTE}`);
  });

  it('the preview and the write agree byte for byte (checker W3)', () => {
    for (const suburb of [null, 'Fictionville', ' Fiction Heights ']) {
      const preview = composeJobDescription({ ...previewLinesFor(facts), suburb });
      expect(preview).toBe(buildJobDescription(facts, suburb));
    }
  });
});
