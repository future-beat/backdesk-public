/**
 * SYNC-01: the cursor must never skip a record, and must never regress.
 *
 * These are the two failure modes that produce the same visible symptom —
 * "a quote we should have chased was never chased" — from opposite causes, and
 * neither one alarms. A cursor that jumps ahead loses edits permanently, because
 * the next poll moves it forward again over the gap. A cursor that goes
 * backwards re-reads the same window forever, burning the 20k/day request budget
 * while looking perfectly healthy.
 *
 * Everything here is pure string/date math with no I/O, so it is exhaustive
 * rather than representative.
 */
import { describe, expect, it } from 'vitest';

import { advanceCursor, filterFrom, OVERLAP_MINUTES } from '@/core/sync/cursor';

describe('filterFrom — the value handed to ServiceM8s $filter', () => {
  it('falls back to a date-only literal one day beyond the backfill window when there is no cursor', () => {
    // A connection that has never synced. 90 days + 1 of slack: ServiceM8's
    // clock and ours are independent, and an extra day of jobs costs one
    // request while a missing day costs a quote.
    const now = new Date('2026-08-26T09:00:00Z');
    expect(filterFrom(null, { now, backfillDays: 90 })).toBe('2026-05-27');
  });

  it('emits a bare date for the backfill, not a datetime', () => {
    // The documented filter examples are date-only. Second precision buys
    // nothing across a 90-day window and the documented form is the one with
    // the most evidence behind it.
    const literal = filterFrom(null, { now: new Date('2026-08-26T09:00:00Z') });
    expect(literal).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('subtracts the overlap window from a cursor', () => {
    expect(OVERLAP_MINUTES).toBe(15);
    expect(filterFrom('2026-08-26 09:20:00')).toBe('2026-08-26 09:05:00');
  });

  it('INCLUDES a record edited in the same second as the cursor', () => {
    // Pitfall 2, stated as an assertion rather than a comment. If the filter
    // value were the cursor itself and `gt` were strict, a second edit landing
    // inside the same second would never be fetched — and nothing would ever
    // go red, because the record simply stops appearing.
    //
    // The Wave-0 spike (A1) measured `gt` as INCLUSIVE, which already saves us;
    // the overlap is the belt to that braces, and it is what this asserts.
    const cursor = '2026-08-26 09:20:00';
    const filter = filterFrom(cursor);

    expect(
      filter < cursor,
      'the filter value must be strictly earlier than the cursor, so a row AT ' +
        'the cursor is returned under either a strict or an inclusive `gt`',
    ).toBe(true);
  });

  it('rolls back across midnight, the hour and the month without a timezone', () => {
    expect(filterFrom('2026-08-26 00:05:00')).toBe('2026-08-25 23:50:00');
    expect(filterFrom('2026-09-01 00:00:00')).toBe('2026-08-31 23:45:00');
    expect(filterFrom('2026-03-01 00:10:00')).toBe('2026-02-28 23:55:00');
  });

  it('does not shift a cursor by a DST offset', () => {
    // The whole design of Pattern 1 is that a ServiceM8 timestamp only ever
    // meets other ServiceM8 timestamps, inside ServiceM8's own filter. If this
    // math ever attached a zone, a cursor spanning a DST boundary would move by
    // an hour and silently skip (or re-read) sixty minutes of edits. Perth does
    // not observe DST, but the machine running the tick might.
    //
    // 2026-04-05 02:10 is inside the US DST fallback hour: interpreting it in a
    // zone that observes DST and subtracting 15 minutes yields a different
    // wall-clock answer than pure calendar arithmetic does.
    expect(filterFrom('2026-04-05 02:10:00')).toBe('2026-04-05 01:55:00');
    expect(filterFrom('2026-10-04 02:10:00')).toBe('2026-10-04 01:55:00');
  });

  it('accepts a date-only cursor and returns a datetime', () => {
    expect(filterFrom('2026-08-26')).toBe('2026-08-25 23:45:00');
  });

  it('falls back to the backfill literal when the stored cursor is unparseable', () => {
    // Corrupt cursor: re-reading 90 days is expensive and self-healing (the
    // cycle's own advanceCursor replaces it with a real ServiceM8 timestamp).
    // Passing the garbage through would produce a malformed `$filter`, which
    // ServiceM8 answers with a 400 — classified as server_error, retried
    // forever, and never fixed by anything.
    const now = new Date('2026-08-26T09:00:00Z');
    expect(filterFrom('not a timestamp', { now })).toBe('2026-05-27');
  });
});

describe('advanceCursor — the new high-water mark', () => {
  it('returns the maximum observed edit_date', () => {
    expect(
      advanceCursor('2026-08-26 09:00:00', [
        '2026-08-26 09:10:00',
        '2026-08-26 09:30:00',
        '2026-08-26 09:20:00',
      ]),
    ).toBe('2026-08-26 09:30:00');
  });

  it('NEVER regresses when every observed row is older than the cursor', () => {
    // The overlap window guarantees this case happens on most polls: the
    // re-fetched rows are by construction older than the cursor. A cursor that
    // took the max of only the observed rows would step backwards by the
    // overlap every cycle and never advance again.
    expect(
      advanceCursor('2026-08-26 09:00:00', [
        '2026-08-26 08:50:00',
        '2026-08-26 08:55:00',
      ]),
    ).toBe('2026-08-26 09:00:00');
  });

  it('returns the previous cursor unchanged when nothing was observed', () => {
    expect(advanceCursor('2026-08-26 09:00:00', [])).toBe('2026-08-26 09:00:00');
    expect(advanceCursor(null, [])).toBeNull();
  });

  it('sets the first cursor from observed rows when there was none', () => {
    expect(advanceCursor(null, ['2026-08-01 07:00:00', '2026-08-02 07:00:00'])).toBe(
      '2026-08-02 07:00:00',
    );
  });

  it('never returns our own clock', () => {
    // Pattern 1's central rule. If ServiceM8's clock runs behind ours, a cursor
    // taken from `now()` skips every record edited in the gap — permanently.
    const observed = ['2020-01-01 00:00:00'];
    expect(advanceCursor(null, observed)).toBe('2020-01-01 00:00:00');
  });

  it('discards a malformed previous cursor in favour of a real observation', () => {
    // This is what makes the filterFrom fallback above self-healing rather than
    // permanent: a corrupt cursor would otherwise win the lexicographic
    // comparison forever ('zzz' > any digit) and every cycle would re-backfill.
    expect(advanceCursor('zzz-corrupt', ['2026-08-26 09:00:00'])).toBe(
      '2026-08-26 09:00:00',
    );
  });

  it('ignores malformed observed values rather than adopting one as the cursor', () => {
    expect(advanceCursor('2026-08-26 09:00:00', ['zzz', '2026-08-26 09:05:00'])).toBe(
      '2026-08-26 09:05:00',
    );
    expect(advanceCursor('2026-08-26 09:00:00', ['zzz'])).toBe('2026-08-26 09:00:00');
  });

  it('round-trips: a cursor produced by advanceCursor is always parseable by filterFrom', () => {
    // The two functions are each other's only callers in production. If
    // advanceCursor could emit something filterFrom rejects, every subsequent
    // poll would silently re-backfill.
    const next = advanceCursor(null, ['2026-08-26 09:30:15']);
    expect(filterFrom(next)).toBe('2026-08-26 09:15:15');
  });
});
