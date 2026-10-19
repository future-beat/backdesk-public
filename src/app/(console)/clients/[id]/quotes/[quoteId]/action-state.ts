/**
 * State shape + message constants for this page's control actions.
 *
 * OUTSIDE actions.ts because a `'use server'` module may export only async
 * functions — a const export is a module-evaluation error under Turbopack
 * (nextjs.org/docs/messages/invalid-use-server-value). Types alone would erase,
 * but these are runtime values the client components import too.
 *
 * ── HALF OF THIS FILE NOW LIVES ONE DIRECTORY UP (06-01) ────────────────────
 *
 * Everything about DRAFT APPROVAL — the state shape, the shared failure
 * sentences, the violation copy, the id/body schemas and the outcome→sentence
 * mapping — moved to `src/app/(console)/components/action-state.ts` when Phase 6
 * added a SECOND approval surface (the cross-client queue, CON-01). Two screens
 * approving the same drafts must answer a double-tap, a superseded attempt and a
 * failed fact check with the same words; two copies of these constants is how
 * one screen keeps the old wording after the other is corrected — the CR-02
 * drift class, in the DOM.
 *
 * They are RE-EXPORTED here rather than merely moved, so every existing import
 * of this path keeps working and there is still exactly one definition. What
 * remains defined below is what is genuinely this page's: the D-06/D-16 cadence
 * control copy, which no other surface renders (the queue deliberately does not
 * duplicate the kill switch — D-02).
 */

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
  draftIdsSchema,
  draftViolationMessage,
  EDITED_BODY_MAX,
  editedBodySchema,
  SESSION_EXPIRED_MESSAGE,
  UNKNOWN_QUOTE_MESSAGE,
} from '@/app/(console)/components/action-state';

/* --- kill (D-06/D-15, terminal) ------------------------------------------ */

/**
 * The success copy states the IRREVERSIBILITY, in the same breath as the
 * confirmation. This is the one action in the console with no undo anywhere in
 * the codebase, and the moment an operator most needs to know that is the moment
 * they have just done it.
 */
export const KILL_SUCCESS_MESSAGE =
  'Stopped. This contact will never be chased again — on this quote or any future one.';
export const KILL_ALREADY_STOPPED_MESSAGE =
  'This sequence had already stopped. The contact is suppressed either way — they will never be chased again.';
export const KILL_NO_ADDRESSES_MESSAGE =
  'There is no mobile or email on this sequence, so there is nobody to suppress. Nothing changed.';
/**
 * Phase 15 (15-REVIEW CR-01): the caller's number was retired by the privacy
 * pass, so the sequence holds a code, not a number. Writing that code as a
 * suppression would suppress nobody, so nothing is written and the operator is
 * told so — never the success copy.
 */
export const KILL_NUMBER_RETIRED_MESSAGE =
  "This caller's number was retired under the privacy policy, so there is no number left to suppress. Nothing changed.";

/* --- client pause / resume (D-06, reversible) ---------------------------- */

export const PAUSE_CLIENT_SUCCESS_MESSAGE =
  'Paused. Nothing goes out for this client until you resume.';
export const PAUSE_CLIENT_ALREADY_MESSAGE = 'This client was already paused. Nothing changed.';

export const RESUME_CLIENT_SUCCESS_MESSAGE =
  'Resumed. Follow-ups were rescheduled to the next available slots inside contact hours.';
/**
 * The honest half-answer. The pause IS lifted; the schedules were not repaired,
 * because the client's ServiceM8 key is still dead and repairing them against a
 * moment that is not the real resume would push every touch further into the
 * past. Saying "resumed" flatly would send the operator looking for messages
 * that are not coming yet.
 */
export const RESUME_CLIENT_DEFERRED_MESSAGE =
  'Resumed — but this client’s ServiceM8 connection is still paused, so nothing sends until the key is replaced.';
export const RESUME_CLIENT_NOT_PAUSED_MESSAGE = 'This client was not paused. Nothing changed.';

/* --- single-cadence resume (D-05, the explicit human act) ---------------- */

export const RESUME_CADENCE_SUCCESS_MESSAGE =
  'Restarted. The remaining follow-ups were rescheduled from now, inside contact hours.';
export const RESUME_CADENCE_DEFERRED_MESSAGE =
  'Restarted — but this client is paused, so nothing sends until the client is resumed too.';
export const RESUME_CADENCE_NOT_PAUSED_MESSAGE =
  'This sequence is not paused, so there is nothing to restart.';
/**
 * The ONB-03 + ONB-04 activation gate, said to the one person who can clear it.
 *
 * Deliberately NOT phrased as a permission refusal ("you cannot restart this"),
 * because the operator's authority is not what is missing — a condition is. So
 * the refusal names the condition ACTUALLY missing and links to exactly the
 * screen that clears it. An operator who reads "not paused" here reloads and
 * taps again; an operator who reads one of these goes and does the one thing
 * that works.
 *
 * ── PER CONDITION SINCE 06-04, AND NEVER A "RESTART ANYWAY" (T-5-10) ────────
 *
 * One sentence naming both conditions would be wrong for the common case (only
 * one is missing) and useless for the rare one (which do I fix first?). Both
 * missing renders BOTH sentences and BOTH links, in checklist order.
 *
 * There is no override affordance beside any of this, on purpose: a gate with a
 * bypass button is a gate that is open at exactly the moment somebody is in a
 * hurry, which is the moment ONB-04's harm — our follow-up arriving beside
 * ServiceM8's own — actually happens.
 *
 * Copy verbatim from 06-UI-SPEC's Copywriting Contract.
 */
export const RESUME_CADENCE_GATED_TEMPLATES_MESSAGE =
  "Templates aren't approved yet — approve them to start sending.";
export const RESUME_CADENCE_GATED_ATTESTATION_MESSAGE =
  "ServiceM8's own follow-up hasn't been verified off — record it on the client page.";

/** The fix-link labels, also 06-UI-SPEC verbatim. */
export const APPROVE_TEMPLATES_LINK_LABEL = 'Approve templates →';
export const RECORD_ATTESTATION_LINK_LABEL = 'Record it →';

/**
 * The refusal, assembled from the conditions the core reported.
 *
 * ONE MAPPING, so the quote page's resume and any later surface that renders a
 * gated cadence cannot answer the same refusal with different words — the
 * 06-01 rule (`src/core` returns outcomes; copy lives in one shared mapping)
 * applied to this outcome.
 *
 * Order is CHECKLIST order — templates before the attestation — so an operator
 * with both missing is told what to do first rather than being handed two
 * equal-looking tasks.
 */
export function resumeCadenceGatedState(
  tenantId: string,
  conditions: { templatesApproved: boolean; sm8AutomationAttested: boolean },
): { success: string; fixes: Array<{ href: string; label: string }> } {
  const sentences: string[] = [];
  const fixes: Array<{ href: string; label: string }> = [];

  if (!conditions.templatesApproved) {
    sentences.push(RESUME_CADENCE_GATED_TEMPLATES_MESSAGE);
    fixes.push({
      href: `/clients/${tenantId}/drafting`,
      label: APPROVE_TEMPLATES_LINK_LABEL,
    });
  }

  if (!conditions.sm8AutomationAttested) {
    sentences.push(RESUME_CADENCE_GATED_ATTESTATION_MESSAGE);
    fixes.push({
      href: `/clients/${tenantId}#ready-to-send`,
      label: RECORD_ATTESTATION_LINK_LABEL,
    });
  }

  // BOTH CONDITIONS READ TRUE AND THE CADENCE IS STILL GATED. Reachable only as
  // a race — somebody cleared the last condition between the resume attempt and
  // this read — and an EMPTY refusal would render a blank line beside a cadence
  // the operator can now actually restart. Say the true thing and offer the
  // reload, rather than inventing a condition to blame.
  if (sentences.length === 0) {
    return {
      success:
        'That was gated a moment ago and is not any more. Reload the page and restart it.',
      fixes: [],
    };
  }

  return { success: sentences.join(' '), fixes };
}
