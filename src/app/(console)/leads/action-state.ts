/**
 * The lead queue's words, its close schema and the close outcome mapping
 * (Phase 15, CON-05 / D-01; UI-SPEC §1).
 *
 * A LEAF, in the `queue/action-state.ts` shape: it value-imports `zod` and
 * the shared console action state, nothing else. `lead-card.tsx` (plan 15-04)
 * is `'use client'`, and the vocabularies these words describe live in the
 * schema barrel, which reaches Postgres (research Pitfall 9;
 * `tests/lint-ban.test.ts` CLIENT_REACHABLE). The keys of
 * `NEXT_TOUCH_STATE_LABELS` are string literals for that reason, and
 * `tests/text-back-outcome-labels.test.ts` checks them against
 * `TOUCH_STATUSES`. It is also a sibling rather than part of `actions.ts`
 * because a `'use server'` module may export only async functions.
 */
import { z } from 'zod';

import {
  BAD_REQUEST_MESSAGE,
  BLANK_CONTROL_STATE,
  type ControlState,
} from '../components/action-state';

/**
 * Touches in a lead cadence. One number, two surfaces: the queue card's
 * `touch n of 3` and the lead card's `Next: #n of 3` (plan 15-04 moves the
 * queue card onto this export).
 */
export const LEAD_TOUCH_COUNT = 3;

/* --- the two-step close (D-01) -------------------------------------------- */

export const CLOSE_STEP_LABEL = 'Close this lead';
export const CLOSE_CONFIRM_LABEL = 'Close it';
export const CLOSE_DISMISS_LABEL = 'Keep it';
export const CLOSE_PENDING_LABEL = 'Closing…';

/** Step two: the consequence, said in full, naming whose customer it is. */
export function closeConsequence(clientName: string): string {
  return (
    'This lead closes for good: its remaining follow-ups are cancelled and nothing more is sent. ' +
    `${clientName}'s customer can still ring again.`
  );
}

export const LEAD_CLOSED_MESSAGE = 'Lead closed. Nothing more will be sent.';
export const LEAD_ALREADY_CLOSED_MESSAGE = 'This lead was already closed.';
export const LEAD_CLOSE_FAILED_MESSAGE = 'Could not close the lead. Try again in a moment.';

/* --- the card ------------------------------------------------------------- */

export const APPROVE_TOUCH_LABEL = 'Approve the next touch →';

/** The deadline line's state word for the next touch, by its status. */
export const NEXT_TOUCH_STATE_LABELS: Record<string, string> = {
  scheduled: 'scheduled',
  needs_draft: 'no draft yet',
  pending_approval: 'awaiting approval',
  approved: 'approved',
};

export const STALLED_LABEL = 'stalled';
export const NO_FOLLOW_UPS_LEFT_LABEL = 'No follow-ups left';
export const NO_REPLY_LABEL = 'No reply yet.';

/* --- the page ------------------------------------------------------------- */

export const LEADS_HINT =
  "Every missed caller who got a text and hasn't been closed, booked or expired — soonest " +
  'follow-up deadline first, across every client. Read their latest reply, then approve the ' +
  'next touch, create the job, or close the lead.';

export const LEADS_EMPTY_TITLE = 'No open leads.';

export const LEADS_EMPTY_HINT =
  'A lead opens the moment a diverted call gets a text-back. It shows up here with its next ' +
  "follow-up deadline, the caller's latest reply and what to do next, until it's closed, booked " +
  'or expired.';

export const LEADS_LOAD_FAILED_MESSAGE = 'Could not load the leads. Try again in a moment.';

/* --- the close action's contract ------------------------------------------ */

/** Exactly one lead id; no array arm (the `skipTouchSchema` rule). */
export const closeLeadSchema = z.object({ lead_id: z.uuid() });

/** What the close actually did, as the action decided it. */
export type CloseOutcome = { kind: 'closed' } | { kind: 'already_closed' } | { kind: 'not_found' };

/**
 * Outcome → the card's state. A real close and an already-closed lead both
 * SETTLE the card (there is nothing left to do to it); an unknown lead is a
 * refusal that leaves the controls in place.
 */
export function closeControlState(outcome: CloseOutcome): ControlState {
  switch (outcome.kind) {
    case 'closed':
      return { ...BLANK_CONTROL_STATE, success: LEAD_CLOSED_MESSAGE, settled: true };
    case 'already_closed':
      return { ...BLANK_CONTROL_STATE, success: LEAD_ALREADY_CLOSED_MESSAGE, settled: true };
    case 'not_found':
      return { ...BLANK_CONTROL_STATE, error: BAD_REQUEST_MESSAGE };
  }
}
