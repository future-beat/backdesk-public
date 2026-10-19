/**
 * THE ONE DERIVATION OF "STALLED" (CON-04, D-09/D-12).
 *
 * Four surfaces read this module — the queue's urgency badge, the nav count
 * badge's stalled subset, the client-list Drafts column and the alert email —
 * and the failure this suite guards is not a crash. It is a red badge beside
 * three cards that all read `scheduled`, which teaches an operator that the
 * colour means nothing.
 *
 * So the boundaries are pinned by NAME here rather than left to whichever
 * caller was written first, and the no-draft-row case (05-04's deterministic
 * failure, the reason CON-04 exists at all) is asserted from a touch snapshot
 * that has no draft to be joined to even in principle.
 *
 * PURE. No database, no environment, no clock — every `now` is a literal.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  deriveUrgency,
  isStalled,
  relativeToSlot,
  STALL_THRESHOLD_HOURS,
  STALLABLE_TOUCH_STATUSES,
  URGENCY_LABELS,
  type UrgencyTier,
} from '@/core/aging/stall-policy';

const NOW = new Date('2026-09-01T00:00:00.000Z');
const HOUR = 3_600_000;

/** `now + hours`, as a slot. */
const slot = (hours: number): Date => new Date(NOW.getTime() + hours * HOUR);

const touch = (status: string, hours: number) => ({ status, scheduledAt: slot(hours) });

describe('STALL_THRESHOLD_HOURS', () => {
  it('is four hours, and is the ONLY threshold the module exposes', () => {
    expect(STALL_THRESHOLD_HOURS).toBe(4);
  });

  it('is the same constant `deriveUrgency` uses for its due-soon boundary', () => {
    // The UI-SPEC fixed the due-soon tier to the stall threshold deliberately.
    // If someone gives the tier its own number, this fails.
    expect(deriveUrgency(slot(STALL_THRESHOLD_HOURS), NOW)).toBe('due_soon');
    expect(deriveUrgency(slot(STALL_THRESHOLD_HOURS + 0.001), NOW)).toBe('scheduled');
    expect(isStalled(touch('pending_approval', STALL_THRESHOLD_HOURS), NOW)).toBe(true);
    expect(isStalled(touch('pending_approval', STALL_THRESHOLD_HOURS + 0.001), NOW)).toBe(false);
  });
});

describe('isStalled — the status half', () => {
  it('counts the two statuses that are waiting on a human', () => {
    expect(isStalled(touch('needs_draft', 0), NOW)).toBe(true);
    expect(isStalled(touch('pending_approval', 0), NOW)).toBe(true);
  });

  it('counts nothing else, however overdue', () => {
    for (const status of ['scheduled', 'approved', 'sent', 'skipped']) {
      expect(isStalled(touch(status, -240), NOW)).toBe(false);
    }
  });

  it('shares its population rule with the approval queue rather than re-spelling it', () => {
    // Asserted on the SOURCE rather than by importing `@/db/repository`, which
    // would pull the driver into a pure suite. What matters is that there is one
    // array literal in the codebase, and that the db layer aliases it.
    const repo = readFileSync('src/db/repository/for-all-tenants.ts', 'utf8');
    expect(repo).toContain("import { STALLABLE_TOUCH_STATUSES } from '@/core/aging/stall-policy'");
    expect(repo).toContain('export const APPROVAL_QUEUE_STATUSES = STALLABLE_TOUCH_STATUSES;');
    expect(repo).not.toContain("['needs_draft', 'pending_approval']");
    expect([...STALLABLE_TOUCH_STATUSES]).toEqual(['needs_draft', 'pending_approval']);
  });
});

describe('isStalled — the boundary half, pinned by name', () => {
  it('exactly at the threshold is STALLED (inclusive, decided once)', () => {
    expect(isStalled(touch('needs_draft', 4), NOW)).toBe(true);
  });

  it('one millisecond past the threshold is not', () => {
    expect(
      isStalled({ status: 'needs_draft', scheduledAt: new Date(NOW.getTime() + 4 * HOUR + 1) }, NOW),
    ).toBe(false);
  });

  it('exactly at the slot is stalled', () => {
    expect(isStalled(touch('needs_draft', 0), NOW)).toBe(true);
  });

  it('already past the slot is stalled — the worst case, not an excluded one', () => {
    expect(isStalled(touch('pending_approval', -72), NOW)).toBe(true);
  });

  it('a slot far in the future is not stalled', () => {
    expect(isStalled(touch('pending_approval', 48), NOW)).toBe(false);
  });
});

describe('isStalled — the 05-04 no-draft-row case (D-09, the named CON-04 backstop)', () => {
  it('ages a needs_draft touch that has no draft row, because it never looks for one', () => {
    // A deterministic drafting failure (400/401/403) records NOTHING in
    // `touch_drafts` — 05-04 decided there was no model output to be evidence
    // of. This is the entire snapshot the predicate gets, and there is no draft
    // in it because the signature cannot accept one.
    const stuck = { status: 'needs_draft', scheduledAt: slot(1) };
    expect(isStalled(stuck, NOW)).toBe(true);
    expect(Object.keys(stuck)).toEqual(['status', 'scheduledAt']);
  });

  it('is not filtered on cadence state — a paused cadence stalls too', () => {
    // Nothing about a pause is expressible in this signature, which is the
    // point: the queue's population rule has no cadence-status filter either.
    expect(isStalled(touch('pending_approval', -1), NOW)).toBe(true);
  });
});

describe('the digest predicate carries no alert-state term (WR-09)', () => {
  /**
   * `selectStalled` used to live in the policy module and only this suite called
   * it — so the rule it "covered" was a rule nothing in production asked it.
   *
   * The digest never has rows in memory to filter: `forAllTenants_stalledTally`
   * is a read-only SQL predicate, and IT is what must not mention
   * `stall_alerted_at`. Filtering the 06:30 digest on "not yet alerted" would
   * mail an empty digest every morning while the queue grew, because the
   * once-only guard belongs to the IMMEDIATE alert (D-11).
   *
   * So the assertion moved to where the rule is enforced.
   */
  const REPO = readFileSync('src/db/repository/for-all-tenants.ts', 'utf8');

  it('the tally accessor does not filter on stall_alerted_at', () => {
    const start = REPO.indexOf('export async function forAllTenants_stalledTally');
    expect(start).toBeGreaterThan(-1);

    const body = REPO.slice(start, REPO.indexOf('\nexport ', start + 1));
    const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    expect(code).not.toContain('stallAlertedAt');
    expect(code).not.toContain('stall_alerted_at');
  });

  it('the CLAIM, by contrast, is guarded on exactly that column', () => {
    // The two are a pair, and the difference between them is the whole rule.
    const start = REPO.indexOf('export async function forAllTenants_claimNewlyStalled');
    expect(start).toBeGreaterThan(-1);

    const body = REPO.slice(start, REPO.indexOf('\nexport ', start + 1));
    expect(body).toContain('stallAlertedAt');
  });
});

describe('deriveUrgency — the 06-UI-SPEC tier table', () => {
  const cases: Array<[string, number, UrgencyTier]> = [
    ['a slot two days ago', -48, 'overdue'],
    ['a slot one second ago', -1 / 3600, 'overdue'],
    ['a slot exactly now', 0, 'overdue'],
    ['a slot one second away', 1 / 3600, 'due_soon'],
    ['a slot exactly at the threshold', 4, 'due_soon'],
    ['a slot just past the threshold', 4.5, 'scheduled'],
    ['a slot next week', 168, 'scheduled'],
  ];

  for (const [name, hours, expected] of cases) {
    it(`${name} is ${expected}`, () => {
      expect(deriveUrgency(slot(hours), NOW)).toBe(expected);
    });
  }

  it('resolves the overdue/due-soon overlap at exactly now toward the more urgent reading', () => {
    // Both branches match at that instant. Reporting `due soon` for a slot that
    // has arrived would understate the only case that cannot be recovered.
    expect(deriveUrgency(NOW, NOW)).toBe('overdue');
  });

  it('has a label for every tier — a map, never .replace()', () => {
    expect(URGENCY_LABELS).toEqual({
      overdue: 'overdue',
      due_soon: 'due soon',
      scheduled: 'scheduled',
    });
    for (const label of Object.values(URGENCY_LABELS)) {
      expect(label).not.toContain('_');
    }
  });
});

/* ========================================================================= *
 * relativeToSlot — the SENTENCE beside the badge (WR-05)
 * ========================================================================= */

describe('relativeToSlot agrees with deriveUrgency about every slot', () => {
  const MINUTE = 60_000;

  /**
   * THE PROPERTY THE OLD IMPLEMENTATION BROKE, ASSERTED DIRECTLY.
   *
   * The two used to live in different files, joined only by a comment claiming
   * they "cannot say different things about one slot" because both come from the
   * same clock. They could: the badge asked `slot <= now`, the sentence rounded
   * the difference to whole minutes and THEN tested its sign, so anything inside
   * the next thirty seconds read `overdue` in words beside an amber `due soon`.
   *
   * A red word beside an amber badge is the failure this whole module's header
   * names — it teaches an operator that the colour means nothing.
   */
  const offsets = [
    -3 * 3_600_000, -MINUTE, -1, 0, 1, 999, 20 * 1_000, 29 * 1_000, 59 * 1_000,
    MINUTE, 91 * MINUTE, 3 * 3_600_000, 5 * 3_600_000, 47 * 3_600_000,
  ];

  for (const offset of offsets) {
    it(`says "overdue" exactly when the tier is overdue, at ${offset}ms`, () => {
      const at = new Date(NOW.getTime() + offset);
      expect(relativeToSlot(at, NOW) === 'overdue').toBe(deriveUrgency(at, NOW) === 'overdue');
    });
  }

  it('never rounds a future slot down into the past', () => {
    // Twenty seconds away. `Math.round(20_000 / 60_000)` is 0, and `<= 0`
    // printed `overdue` for a message that has not been due yet.
    const at = new Date(NOW.getTime() + 20 * 1_000);
    expect(relativeToSlot(at, NOW)).toBe('due in 1m');
    expect(deriveUrgency(at, NOW)).toBe('due_soon');
  });

  it('FLOORS rather than rounds, so it never overstates the time available', () => {
    // 91 minutes rounded up to "due in 2h" — half an hour the operator does not
    // have, on the screen whose whole purpose is deciding what to do first.
    expect(relativeToSlot(new Date(NOW.getTime() + 91 * MINUTE), NOW)).toBe('due in 1h');
    expect(relativeToSlot(new Date(NOW.getTime() + 47 * 3_600_000), NOW)).toBe('due in 1d');
    expect(relativeToSlot(new Date(NOW.getTime() + 59 * MINUTE), NOW)).toBe('due in 59m');
  });

  it('never says "due in 0m"', () => {
    // A sub-minute slot floors to zero, and "due in 0m" is not a thing to tell
    // anybody — it is `overdue` phrased as a countdown.
    for (const ms of [1, 999, 30 * 1_000, 59 * 1_000]) {
      expect(relativeToSlot(new Date(NOW.getTime() + ms), NOW)).toBe('due in 1m');
    }
  });

  it('carries no timezone and no negative duration', () => {
    // Zone-free by construction: it renders a DIFFERENCE, and the absolute time
    // beside it is the only thing that names a zone (the queue mixes tenants).
    for (const offset of offsets) {
      const text = relativeToSlot(new Date(NOW.getTime() + offset), NOW);
      expect(text).not.toContain('-');
      expect(text).not.toMatch(/UTC|GMT|[+]\d\d:\d\d/);
    }
  });
});

describe('the module is framework-free and DB-free', () => {
  /** Source with comments stripped — the established source-assertion idiom. */
  const code = readFileSync('src/core/aging/stall-policy.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('imports nothing at all', () => {
    // The strongest available form of the claim: there is no import line, so
    // there is no `next/*`, no `@/db/*`, no driver and no clock to stub.
    expect(code.match(/^import .*$/gm) ?? []).toEqual([]);
  });

  it('does not name a DB or framework module anywhere in its code', () => {
    expect(code).not.toContain('@/db/');
    expect(code).not.toContain("from 'next");
    expect(code).not.toContain('drizzle');
  });
});
