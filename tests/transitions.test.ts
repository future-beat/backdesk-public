/**
 * SYNC-02: the transition matrix, enumerated rather than sampled.
 *
 * Pitfall 5 is that transition code gets written for the happy path
 * (`Quote → Work Order`) and every other pair falls through a `default` that
 * returns null. Nothing goes red: a tradie who drags a quote straight to
 * Completed simply never registers as a win, the client is under-credited on
 * the report the whole product is sold on, and the only evidence is a number
 * that looks slightly low.
 *
 * So the test is the table. All 5 × 4 (prev, next) cells are listed explicitly
 * with the reason for each answer, and a completeness assertion at the bottom
 * proves none was omitted — because a table-driven test that quietly stops
 * short of the full matrix has exactly the blind spot it was written to remove.
 */
import { describe, expect, it } from 'vitest';

import { JOB_STATUSES, type Sm8Status } from '@/core/servicem8/schemas';
import { classifyTransition } from '@/core/sync/transitions';
import type { QuoteEventType } from '@/db/schema';

type Prev = Sm8Status | null;

interface Cell {
  prev: Prev;
  next: Sm8Status;
  expected: QuoteEventType | null;
  why: string;
}

const MATRIX: Cell[] = [
  // ---- First sight. The connection has never seen this job before. ----------
  //
  // Only an OPEN quote produces anything. Everything else is pre-connection
  // history: we did not watch it happen, and manufacturing an event for it
  // would make Phase 3 congratulate a client on a job won in June and would
  // credit Phase 7's recovered-revenue report with wins the service never
  // touched. That is the plan's explicit prohibition, and it is enforced here
  // as well as structurally.
  {
    prev: null,
    next: 'Quote',
    expected: 'quote_opened',
    why: 'a newly-arrived open quote is the one thing a cadence may act on',
  },
  {
    prev: null,
    next: 'Work Order',
    expected: null,
    why: 'first sight of an already-won job — we never watched it transition',
  },
  {
    prev: null,
    next: 'Unsuccessful',
    expected: null,
    why: 'first sight of an already-dead job',
  },
  {
    prev: null,
    next: 'Completed',
    expected: null,
    why: 'first sight of an already-finished job',
  },

  // ---- From Quote: the transitions the product exists to detect. -----------
  { prev: 'Quote', next: 'Quote', expected: null, why: 'no status change' },
  {
    prev: 'Quote',
    next: 'Work Order',
    expected: 'won',
    why: 'the canonical win — the quote was accepted',
  },
  {
    prev: 'Quote',
    next: 'Completed',
    expected: 'won',
    why:
      'ALSO a win. ServiceM8 does not force a linear path and a tradie can mark ' +
      'a quote complete without ever passing through Work Order (Pitfall 5)',
  },
  {
    prev: 'Quote',
    next: 'Unsuccessful',
    expected: 'lost',
    why: 'the quote was declined',
  },

  // ---- From Work Order. ----------------------------------------------------
  {
    prev: 'Work Order',
    next: 'Quote',
    expected: 'reopened',
    why: 'dragged back to quoting — the job is live again and chaseable',
  },
  { prev: 'Work Order', next: 'Work Order', expected: null, why: 'no status change' },
  {
    prev: 'Work Order',
    next: 'Completed',
    expected: null,
    why:
      'progress, NOT a new win. The win was already emitted when it left Quote; ' +
      'emitting again would double-count the job in recovered revenue',
  },
  {
    prev: 'Work Order',
    next: 'Unsuccessful',
    expected: 'lost',
    why:
      'a job that was won and then died IS a loss. The research skeleton returned ' +
      'null here; that would leave Phase 7 crediting the service with revenue the ' +
      'client never invoiced, and Phase 3 with no signal to stop',
  },

  // ---- From Unsuccessful: the dead-quote revival. --------------------------
  {
    prev: 'Unsuccessful',
    next: 'Quote',
    expected: 'reopened',
    why: 'a written-off quote is live again',
  },
  {
    prev: 'Unsuccessful',
    next: 'Work Order',
    expected: 'won',
    why:
      'revived straight to a job. This is the single most valuable event the ' +
      'service can produce — a quote everyone had given up on turning into work',
  },
  {
    prev: 'Unsuccessful',
    next: 'Unsuccessful',
    expected: null,
    why: 'no status change',
  },
  {
    prev: 'Unsuccessful',
    next: 'Completed',
    expected: 'won',
    why: 'same revival, recorded straight to complete',
  },

  // ---- From Completed. -----------------------------------------------------
  {
    prev: 'Completed',
    next: 'Quote',
    expected: 'reopened',
    why: 'a finished job re-quoted — variation work, and chaseable again',
  },
  {
    prev: 'Completed',
    next: 'Work Order',
    expected: null,
    why:
      'moving backwards from complete to in-progress is a correction, not a new ' +
      'win — the win was counted when it left Quote',
  },
  {
    prev: 'Completed',
    next: 'Unsuccessful',
    expected: 'lost',
    why: 'a completed job marked unsuccessful — written off after the fact',
  },
  { prev: 'Completed', next: 'Completed', expected: null, why: 'no status change' },
];

describe('classifyTransition — the full status matrix (SYNC-02)', () => {
  it.each(MATRIX)(
    '$prev -> $next is $expected ($why)',
    ({ prev, next, expected }) => {
      expect(classifyTransition(prev, next, false)).toBe(expected);
    },
  );

  it('enumerates every cell of the matrix — no pair is unasserted', () => {
    // Without this, deleting a row from MATRIX would silently shrink the
    // coverage and every remaining test would still pass.
    const covered = new Set(MATRIX.map((c) => `${c.prev}->${c.next}`));
    const expectedCells: string[] = [];

    for (const prev of [null, ...JOB_STATUSES] as Prev[]) {
      for (const next of JOB_STATUSES) {
        expectedCells.push(`${prev}->${next}`);
      }
    }

    expect(expectedCells.length).toBe(20);
    expect(MATRIX.length).toBe(20);
    for (const cell of expectedCells) {
      expect(covered, `matrix cell ${cell} is not asserted`).toContain(cell);
    }
  });

  it('is total — it returns a member of the vocabulary or null for every input', () => {
    const legal = new Set([
      'quote_opened',
      'won',
      'lost',
      'reopened',
      'removed',
      null,
    ]);

    for (const prev of [null, ...JOB_STATUSES] as Prev[]) {
      for (const next of JOB_STATUSES) {
        for (const becameInactive of [false, true]) {
          const result = classifyTransition(prev, next, becameInactive);
          expect(
            legal.has(result),
            `classifyTransition(${prev}, ${next}, ${becameInactive}) returned ` +
              `${JSON.stringify(result)}, which is outside the event vocabulary — ` +
              'the CHECK constraint on quote_status_events would reject it',
          ).toBe(true);
        }
      }
    }
  });
});

describe('classifyTransition — upstream deletion (Pitfall 6)', () => {
  it('classifies removal regardless of the status pair', () => {
    // A deleted job outranks whatever else changed in the same cycle: a cadence
    // chasing a job that no longer exists is the most urgent thing this stream
    // can report, and the customer on the other end is a real person.
    for (const prev of [null, ...JOB_STATUSES] as Prev[]) {
      for (const next of JOB_STATUSES) {
        expect(classifyTransition(prev, next, true)).toBe('removed');
      }
    }
  });

  it('takes precedence over a status change happening in the same cycle', () => {
    expect(classifyTransition('Quote', 'Work Order', true)).toBe('removed');
    expect(classifyTransition('Quote', 'Quote', true)).toBe('removed');
  });
});
