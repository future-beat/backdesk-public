/**
 * The queue's action state — the APPROVAL vocabulary is re-exported, and only
 * the SKIP vocabulary is this surface's own.
 *
 * Every sentence this surface can say about a *draft* is a sentence the quote
 * page can say about the same draft, so both read them from
 * `src/app/(console)/components/action-state.ts`. This file exists because a
 * `'use server'` module may export only async functions (Turbopack's
 * invalid-use-server-value rule), so `queue/actions.ts` needs a sibling to hold
 * the constants its client components also import — the same shape every other
 * `action-state.ts` in this console has.
 *
 * NO APPROVAL COPY IS REDECLARED HERE, AND THAT IS THE POINT. A queue-specific
 * copy of "This draft was already approved." would be a second answer to a
 * question the operator asks on two screens about one row (UI-SPEC component
 * reuse mandate, CR-02 in the DOM).
 *
 * The SKIP sentences below are defined here rather than in the shared module
 * because the skip control exists on exactly one surface: the quote page's
 * terminal control is the armed kill switch over a whole cadence (D-02), and the
 * queue never duplicates it. Promoting these to `components/action-state.ts` is
 * the right move on the day a second surface grows a per-touch skip, and not
 * before — a shared module that holds one caller's copy teaches the next reader
 * that everything in it is shared.
 */
import { z } from 'zod';

import {
  BLANK_CONTROL_STATE as BLANK,
  type ControlState as State,
  UNKNOWN_QUOTE_MESSAGE as UNKNOWN,
} from '@/app/(console)/components/action-state';

export {
  BAD_REQUEST_MESSAGE,
  BLANK_CONTROL_STATE,
  type ControlState,
  DRAFT_ALREADY_APPROVED_MESSAGE,
  DRAFT_APPROVED_MESSAGE,
  DRAFT_BODY_REQUIRED_MESSAGE,
  DRAFT_BODY_TOO_LONG_MESSAGE,
  DRAFT_EDITED_APPROVED_MESSAGE,
  DRAFT_NOT_FOUND_MESSAGE,
  DRAFT_SUPERSEDED_MESSAGE,
  DRAFT_VALIDATOR_FAILED_MESSAGE,
  describeDraftViolation,
  type DraftViolationView,
  EDITED_BODY_MAX,
  SESSION_EXPIRED_MESSAGE,
  UNKNOWN_QUOTE_MESSAGE,
} from '@/app/(console)/components/action-state';

/* --- the operator's own skip (CON-01, D-02) ------------------------------- */

/**
 * THE TWO-STEP SKIP, IN WORDS.
 *
 * Step one is a quiet button; step two states the consequence and offers a pair
 * that reads as skip-vs-keep. `Skip it` / `Keep it` rather than `Confirm` /
 * `Cancel` because both of those describe what happens to the DIALOG, and the
 * question is what happens to the message.
 *
 * The consequence sentence names the touch number, because the operator is
 * looking at a list of cards and the one under their thumb is the one they must
 * be sure about. Both halves are said: this message is gone, and the sequence is
 * not — a skip is not a stop, and an operator who believes it is will reach for
 * the kill switch instead.
 */
export const SKIP_STEP_LABEL = 'Skip this message';
export const SKIP_CONFIRM_LABEL = 'Skip it';
export const SKIP_DISMISS_LABEL = 'Keep it';
export const SKIP_PENDING_LABEL = 'Skipping…';

export function skipConsequence(touchNumber: number): string {
  return `Touch #${touchNumber} will never send. The rest of the cadence carries on.`;
}

export const TOUCH_SKIPPED_MESSAGE =
  'Skipped. That message will never send — the rest of the cadence carries on.';

/**
 * THE ID A SKIP SUBMITS — exactly one, and there is no array arm (D-03).
 *
 * A skip needs no `draft_id`: it is a decision about the TOUCH, and a
 * `needs_draft` row with no draft at all is one of the two statuses it may
 * move. Single-object, single-uuid, for the same reason `draftIdsSchema` is:
 * nothing in this action layer could consume a multi-id form even if a forged
 * body offered one (T-6-11).
 */
export const skipTouchSchema = z.object({ touch_id: z.uuid() });

/**
 * WHAT THE SKIP ACTUALLY DID, as the action decided it.
 *
 * `stale` carries the status the touch was re-read as, because the whole point
 * of a zero-row write is that SOMETHING ELSE happened to this touch and the
 * operator is owed the specific thing rather than a shrug.
 */
export type SkipOutcome =
  | { kind: 'skipped' }
  | { kind: 'stale'; status: string }
  | { kind: 'not_found' };

/**
 * The honest sentences for a skip that moved nothing (Pitfall 3).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A ZERO-ROW SKIP IS NEVER REPORTED AS A SUCCESS. The card was rendered    │
 * │ before somebody else acted on the same touch; telling the operator "done"│
 * │ would leave them believing a message they meant to stop is stopped, when │
 * │ it is approved and scheduled to send.                                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * A map rather than a `.replace('_', ' ')`, and with a fallback that is a real
 * sentence: a touch status added to the schema later must reach the operator as
 * something they can act on, never as `awaiting_dispatch` in raw snake_case.
 */
const SKIP_STALE_MESSAGES: Record<string, string> = {
  approved: 'This one was already approved. It goes out at its scheduled time.',
  sent: 'This one has already gone out.',
  skipped: 'This one was already skipped.',
};

export const SKIP_MOVED_ON_MESSAGE =
  'This one has already moved on. Reload the queue to see where it is.';

/**
 * Outcome → the sentence, and whether the card is still worth offering
 * controls for. `settled` is what swaps a stale card's buttons for the truth.
 */
export function skipControlState(outcome: SkipOutcome): State {
  switch (outcome.kind) {
    case 'skipped':
      return { ...BLANK, success: TOUCH_SKIPPED_MESSAGE, settled: true };
    case 'stale':
      return {
        ...BLANK,
        // An ERROR, not a success: nothing the operator asked for happened.
        error: SKIP_STALE_MESSAGES[outcome.status] ?? SKIP_MOVED_ON_MESSAGE,
        settled: true,
      };
    case 'not_found':
      return { ...BLANK, error: UNKNOWN };
  }
}
