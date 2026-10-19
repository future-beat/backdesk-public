/**
 * Action state + every sentence the drafting page can say.
 *
 * OUTSIDE `actions.ts` because a `'use server'` module may export only async
 * functions — a const export is a module-evaluation error under Turbopack
 * (nextjs.org/docs/messages/invalid-use-server-value). Same split, same reason,
 * as `settings/email/action-state.ts` and the sibling `[id]/action-state.ts`.
 *
 * ── WHY THE PARAMETERISED ONES ARE FUNCTIONS AND NOT TEMPLATE LITERALS AT THE
 *    CALL SITE ───────────────────────────────────────────────────────────────
 *
 * Three of these sentences carry a NUMBER the operator acts on — which touches
 * still block activation, how many paused follow-ups just resumed. A sentence
 * assembled in `actions.ts` is a sentence the tests can only assert by
 * re-assembling it, which proves the test and the action agree about a string
 * rather than that the string is right. Built here, once, they are asserted as
 * the constants they are.
 */

export type DraftingState = {
  /** A fixed sentence the operator can act on. Never a database message. */
  error: string | null;
  success: string | null;
};

export const BLANK_DRAFTING_STATE: DraftingState = { error: null, success: null };

/* ------------------------------------------------------------------------- *
 * Refusals
 * ------------------------------------------------------------------------- */

export const SESSION_EXPIRED_MESSAGE = 'Your session has expired. Sign in again.';

/**
 * Deliberately the same sentence for "no such client" and "not your client".
 * The response must not be a membership oracle over tenant uuids — the same
 * property `cadences.getById`'s empty return gives the D-16 controls.
 */
export const UNKNOWN_CLIENT_MESSAGE = 'That client could not be found.';

export const BAD_REQUEST_MESSAGE = 'Check the details and try again.';

export const TEMPLATE_NOT_FOUND_MESSAGE = 'That version could not be found.';

/* ------------------------------------------------------------------------- *
 * Voice profile (D-05)
 * ------------------------------------------------------------------------- */

export const VOICE_PROFILE_SAVED_MESSAGE =
  'Voice profile saved. Drafts written from the next tick onward use it.';

export const VOICE_EXAMPLE_TOO_LONG_MESSAGE =
  'An example message is longer than 480 characters. Paste a real message they have actually sent.';

export const VOICE_TOO_MANY_EXAMPLES_MESSAGE =
  'Three example messages is the most this form takes — pick the three that sound most like them.';

export const VOICE_TOO_MANY_BANNED_MESSAGE =
  'Twenty banned phrases is the most this form takes. A long list is a voice guide, not a blocklist — put the rest in the notes.';

export const VOICE_FIELD_TOO_LONG_MESSAGE =
  'One of those fields is too long. Keep each under 500 characters.';

/* ------------------------------------------------------------------------- *
 * Template versions (D-04, D-08)
 * ------------------------------------------------------------------------- */

/**
 * THE NO-CHANGE REFUSAL (the ONB-03 encoding edge).
 *
 * A resubmission that is byte-identical to the current latest version does not
 * mint version+1. Two reasons, and the second is the one that matters: an
 * operator who re-taps Save has not written anything new, and a duplicate
 * unapproved version sitting above an approved one would put a touch back on
 * the "needs approval" list with wording that was ALREADY approved — the
 * activation gate closing itself over nothing.
 */
export const TEMPLATE_NO_CHANGE_MESSAGE =
  'That is word-for-word the version already saved, so nothing was added. Change the wording, or approve the version that is already there.';

export const TEMPLATE_BODY_REQUIRED_MESSAGE =
  'Write the touch wording — a template cannot be empty.';

export const TEMPLATE_BODY_TOO_LONG_MESSAGE =
  'That template is longer than 480 characters. It is the shape a text message is written from, not the message.';

export function templateSavedMessage(touchNumber: number, version: number): string {
  // Says what did NOT happen, on purpose. Saving is not attesting (D-06), and an
  // operator who reads "Saved" and leaves has changed nothing about what
  // customers receive — drafting is still using the last approved version.
  return `Touch ${touchNumber} saved as version ${version}. It is NOT approved yet — drafting keeps using the last approved version until you attest to this one.`;
}

/** A template long enough that every draft built from it will fail the D-03 length rule. */
export function templateLongWarning(segments: number): string {
  return ` Heads up: this wording is already ${segments} SMS segments before the model adds anything, and drafts over 2 segments are rejected.`;
}

/* ------------------------------------------------------------------------- *
 * Attestation (D-06) and the activation gate (D-07)
 * ------------------------------------------------------------------------- */

export const APPROVAL_NOTE_REQUIRED_MESSAGE =
  'Say how the client approved this wording — "approved by email 30/8", "read back on the phone". The note is the record that they did.';

export const APPROVAL_NOTE_TOO_LONG_MESSAGE =
  'Keep the approval note under 500 characters — it records how they approved, not what they said.';

/**
 * The attestation landed but the set is still incomplete.
 *
 * Names the touches, because "still incomplete" sends an operator back to count
 * cards and this sentence is what they act on.
 */
export function approvedStillWaitingMessage(touchNumbers: readonly number[]): string {
  const list = touchNumbers.join(', ');
  const plural = touchNumbers.length === 1 ? 'Touch' : 'Touches';
  return `Approved. ${plural} ${list} still ${
    touchNumbers.length === 1 ? 'needs' : 'need'
  } approved wording before this client's follow-ups can send.`;
}

/**
 * The attestation COMPLETED the set — the one act that opens the gate.
 *
 * `resumedCount` is reported rather than assumed, and zero is an ordinary
 * answer: a client onboarded before any quote came in has nothing waiting. The
 * sentence says so instead of implying something went wrong.
 */
export function approvedSetCompleteMessage(
  resumedCount: number,
  rewindowDeferred: boolean,
): string {
  const head =
    resumedCount === 0
      ? 'Approved — every touch now has approved wording. Follow-ups are live for this client. Nothing was waiting.'
      : `Approved — every touch now has approved wording. ${resumedCount} paused follow-up${
          resumedCount === 1 ? '' : 's'
        } resumed.`;

  // The honest half-answer `resumeClient` reports, in the same words: the
  // cadences ARE resumed, and their overdue touches were NOT re-spread, because
  // the client's own pause (or a dead ServiceM8 key) is still in force.
  return rewindowDeferred
    ? `${head} Their schedules will be spread out once the client's own pause is lifted.`
    : head;
}

/**
 * The write-once refusal (D-06, T-5-11), which says WHO said what and WHEN.
 *
 * A bare "already approved" is the wrong sentence for both readers of it: the
 * operator who double-tapped needs to know nothing broke, and the operator
 * looking at a colleague's approval needs the evidence itself.
 */
export function alreadyApprovedMessage(approvedAtLabel: string, note: string | null): string {
  const evidence = note ? ` — "${note}"` : '';
  return `Already approved on ${approvedAtLabel}${evidence}. Nothing changed: an attestation is written once, and re-recording it would destroy the evidence it is.`;
}
