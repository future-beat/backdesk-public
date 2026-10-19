/**
 * THE ONE DEFINITION OF "OVERDUE" FOR A LEAD (Phase 15, D-01 / D-09).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THREE SURFACES ASK WHETHER A LEAD IS OVERDUE: the card's deadline chip,  │
 * │ the `/leads` count line, and the 06:30 digest's overdue line. The first  │
 * │ two call this function; the digest calls its SQL twin,                   │
 * │ `countOverdueOpenLeads` (plan 15-03), which encodes the same predicate:  │
 * │ a next touch in `STALLABLE_TOUCH_STATUSES` whose slot has arrived. Two   │
 * │ spellings of the rule are pinned against each other; three would drift. │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── WHY AN APPROVED OR SCHEDULED TOUCH PAST ITS SLOT IS NOT OVERDUE ─────────
 *
 * `approved` past its slot is sent by the next tick, and `scheduled` past its
 * slot is promoted by it. The machine owns both; nothing is waiting on the
 * operator, so a red chip would be an alarm with no action behind it. Only a
 * touch waiting on a person — `needs_draft` or `pending_approval` — takes the
 * time-derived tier, and it takes it from `deriveUrgency`, never from a
 * threshold spelled here.
 *
 * A lead with no next touch (its follow-ups are exhausted, it waits for
 * expiry) has no deadline, so no chip: `null`.
 *
 * PURE: imports only the stall policy, which imports nothing.
 */
import { deriveUrgency, STALLABLE_TOUCH_STATUSES, type UrgencyTier } from '@/core/aging/stall-policy';

/** The next touch, as much of it as the tier needs. */
export interface LeadNextTouch {
  status: string;
  scheduledAt: Date;
}

export function leadDeadlineTier(next: LeadNextTouch | null, now: Date): UrgencyTier | null {
  if (next === null) return null;
  if ((STALLABLE_TOUCH_STATUSES as readonly string[]).includes(next.status)) {
    return deriveUrgency(next.scheduledAt, now);
  }
  return 'scheduled';
}
