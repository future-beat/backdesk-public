/**
 * Phase 15 (D-01, D-09): the lead deadline tier — the one definition of
 * "overdue" the `/leads` chip and count line share, and the twin of the
 * digest's `countOverdueOpenLeads` predicate.
 *
 * PURE: no seed, no database client, no environment.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { deriveUrgency, STALLABLE_TOUCH_STATUSES } from '@/core/aging/stall-policy';
import { leadDeadlineTier } from '@/core/leads/queue-deadline';

const NOW = new Date('2026-10-13T02:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const anHourAgo = new Date(NOW.getTime() - HOUR);

describe('leadDeadlineTier', () => {
  it('a pending_approval touch past its slot is overdue', () => {
    expect(leadDeadlineTier({ status: 'pending_approval', scheduledAt: anHourAgo }, NOW)).toBe(
      'overdue',
    );
  });

  it('a needs_draft touch past its slot is overdue', () => {
    expect(leadDeadlineTier({ status: 'needs_draft', scheduledAt: anHourAgo }, NOW)).toBe(
      'overdue',
    );
  });

  it('an approved touch past its slot is NOT overdue — the next tick sends it', () => {
    expect(leadDeadlineTier({ status: 'approved', scheduledAt: anHourAgo }, NOW)).toBe('scheduled');
  });

  it('a scheduled touch past its slot is NOT overdue — the next tick promotes it', () => {
    expect(leadDeadlineTier({ status: 'scheduled', scheduledAt: anHourAgo }, NOW)).toBe(
      'scheduled',
    );
  });

  it('a waiting touch in the future takes exactly what deriveUrgency gives', () => {
    for (const offset of [1, 2 * HOUR, 3 * HOUR, 6 * HOUR, 48 * HOUR]) {
      const slot = new Date(NOW.getTime() + offset);
      for (const status of STALLABLE_TOUCH_STATUSES) {
        expect(leadDeadlineTier({ status, scheduledAt: slot }, NOW)).toBe(
          deriveUrgency(slot, NOW),
        );
      }
    }
  });

  it('a slot exactly at now is overdue for a waiting touch (the inclusive boundary)', () => {
    expect(leadDeadlineTier({ status: 'pending_approval', scheduledAt: NOW }, NOW)).toBe(
      'overdue',
    );
  });

  it('no next touch is no chip', () => {
    expect(leadDeadlineTier(null, NOW)).toBeNull();
  });

  it('spells no threshold of its own — it asks deriveUrgency the question', () => {
    const source = readFileSync('src/core/leads/queue-deadline.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(source).toContain('STALLABLE_TOUCH_STATUSES');
    expect(source).toContain('deriveUrgency(');
    expect(source).not.toContain('STALL_THRESHOLD_HOURS');
    expect(source).not.toMatch(/3_?600_?000/);
  });
});
