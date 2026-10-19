/**
 * Phase 15 (CON-06, D-02; T-15-12) — the missed-call log's keyset cursor.
 *
 * `?calls_before={ISO instant}_{uuid}` is typed by whoever holds the URL, so
 * it is parsed before it reaches a predicate: the instant must be a real
 * instant, the id a real uuid, and anything else is page one — silently, never
 * an error and never a half-parsed cursor.
 *
 * PURE: no seed, no database client, no environment.
 */
import { describe, expect, it } from 'vitest';

import {
  CALLS_BEFORE_PARAM,
  formatCallsBefore,
  parseCallsBefore,
} from '@/app/(console)/clients/[id]/missed-calls-cursor';

const ID = '3f2b8c1e-4d5a-4b6c-9d7e-8f9a0b1c2d3e';
const AT = new Date('2026-10-12T23:04:05.678Z');

describe('the missed-call keyset cursor', () => {
  it('names the query parameter once', () => {
    expect(CALLS_BEFORE_PARAM).toBe('calls_before');
  });

  it('round-trips the last row of a page to the same instant and id', () => {
    const raw = formatCallsBefore({ startedAt: AT, id: ID });
    expect(raw).toBe(`2026-10-12T23:04:05.678Z_${ID}`);
    const parsed = parseCallsBefore(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.startedAt.getTime()).toBe(AT.getTime());
    expect(parsed?.id).toBe(ID);
  });

  it.each<[string, string | string[] | undefined]>([
    ['undefined', undefined],
    ['an empty string', ''],
    ['an array (the parameter given twice)', [`2026-10-12T23:04:05.678Z_${ID}`, `2026-10-12T23:04:05.678Z_${ID}`]],
    ['no underscore', `2026-10-12T23:04:05.678Z${ID}`],
    ['a bad date', `2026-13-45T99:99:99.000Z_${ID}`],
    ['a word for a date', `yesterday_${ID}`],
    ['a bad uuid', '2026-10-12T23:04:05.678Z_not-a-uuid'],
    ['a path walk', '../'],
    ['an SQL fragment', `2026-10-12T23:04:05.678Z_${ID}' OR 1=1 --`],
  ])('reads %s as page one (null)', (_label, raw) => {
    expect(parseCallsBefore(raw)).toBeNull();
  });
});
