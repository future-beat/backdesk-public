/**
 * The console's shared action-state shape, and the DRAFT-APPROVAL COPY that both
 * approval surfaces render.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ TWO SURFACES, ONE SET OF SENTENCES. The quote page (Phase 5) and the     │
 * │ cross-client queue (Phase 6, CON-01) approve the same drafts through the │
 * │ same core. If they answered a double-tap, a superseded draft or a failed │
 * │ fact check with DIFFERENT words, an operator would learn one screen's    │
 * │ vocabulary and be surprised by the other's — and a rule tightened on one │
 * │ surface would silently keep the old wording on the other. That is the    │
 * │ CR-02 drift class, in the DOM (UI-SPEC "component reuse mandate").       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * OUTSIDE any `'use server'` module, because such a module may export only async
 * functions — a const export is a module-evaluation error under Turbopack
 * (nextjs.org/docs/messages/invalid-use-server-value). Types alone would erase,
 * but these are runtime values the client components import too.
 *
 * `clients/[id]/quotes/[quoteId]/action-state.ts` re-exports everything here, so
 * every existing import path keeps working and there is still exactly one
 * definition.
 *
 * ── ONE STATE SHAPE FOR EVERY CONSOLE ACTION ────────────────────────────────
 *
 * Kill, pause, resume, approve and edit-then-approve all report the same two
 * things: a sentence that went right or a sentence that went wrong. There is no
 * field for any of them to own, because none of them has an input the operator
 * typed that survives the action. A per-action state type would be N copies of
 * the same two nullable strings.
 *
 * ── THE FAILURE MESSAGES ARE DELIBERATELY DULL ──────────────────────────────
 *
 * `UNKNOWN_QUOTE` is what a caller gets for a malformed id, an expired session,
 * a client they are not a member of, a cadence that belongs to somebody else,
 * and a cadence that does not exist. Distinguishing those in the copy would turn
 * the failure into a membership oracle: POST a guessed uuid, read which sentence
 * comes back, learn whether that client exists. One sentence for all of them
 * costs a legitimate operator nothing, because a legitimate operator arrived
 * here by tapping a control on a page that had already rendered the row.
 */
import { z } from 'zod';

// TWO IMPORTS, AND THE SPLIT IS LOAD-BEARING (06-02, build fix).
//
// This module is reached from `draft-card.tsx`, which is a CLIENT component.
// `import type` is erased at build time; a VALUE import is a real edge in the
// module graph — so importing `EDITED_BODY_MAX` from `approve-draft` dragged
// `@/db/repository` and the `postgres` driver into the browser bundle and broke
// `next build` with four `Module not found` errors (`fs`, `net`, `tls`,
// `perf_hooks`). The number now lives in a leaf module. Keep it that way; the
// asymmetry is invisible to `tsc` and to a reader, and `quote-draft-approval`
// asserts the boundary.
import type { ApprovalResult } from '@/core/approval/approve-draft';
import { EDITED_BODY_MAX } from '@/core/approval/limits';

export { EDITED_BODY_MAX };

export type ControlState = {
  /** A failure. Fixed copy — never a database message (WR-08, T-2-16). */
  error: string | null;
  /** Confirmation of what actually happened. */
  success: string | null;
  /**
   * IS THERE STILL ANYTHING TO DO TO THIS ROW? (06-03)
   *
   * Set when the outcome means the touch has left the operator's hands — it was
   * approved, it was already approved by somebody else, it was skipped, or the
   * card raced a colleague and lost. The card then swaps its controls for the
   * sentence, so a stale row stops offering a tap whose only possible answer is
   * the message already on screen.
   *
   * OPTIONAL, and absent means "still actionable". That is the conservative
   * default in the direction that matters: a forgotten `settled` leaves a button
   * on screen (harmless — the write is guarded), where a defaulted `true` would
   * silently remove the approve control from a card that still needs one.
   */
  settled?: boolean;
  /**
   * WHERE TO GO TO MAKE THIS WORK (06-04, T-5-10 / Pitfall 10).
   *
   * A refusal that names a missing condition and then leaves the operator to
   * find the screen that supplies it is half an answer. These are the links the
   * sentence points at — one per missing condition, in the order they should be
   * dealt with.
   *
   * NEVER A "DO IT ANYWAY" AFFORDANCE. Everything in this array goes to a page
   * that CLEARS a condition; there is no override, because the gate exists
   * precisely for the moment somebody is in a hurry.
   *
   * OPTIONAL for `settled`'s reason, in the same direction: a forgotten `fixes`
   * renders the sentence alone (still true, just less helpful), where a
   * defaulted one would render a link that fixes nothing.
   */
  fixes?: ReadonlyArray<{ href: string; label: string }>;
};

export const BLANK_CONTROL_STATE: ControlState = { error: null, success: null };

/* --- failures shared by every console action ----------------------------- */

export const UNKNOWN_QUOTE_MESSAGE = 'Unknown client or quote.';
export const SESSION_EXPIRED_MESSAGE = 'Your session has expired. Sign in again.';
export const BAD_REQUEST_MESSAGE = 'That request was not valid. Reload the page and try again.';

/* --- draft approval (D-11/D-12, the AI gate) ----------------------------- */

export const DRAFT_BODY_REQUIRED_MESSAGE = 'Write the message before approving it.';
export const DRAFT_BODY_TOO_LONG_MESSAGE =
  `That message is far longer than an SMS can be (over ${EDITED_BODY_MAX} characters). ` +
  'Shorten it and try again.';

/**
 * The D-11 refusal, and the ONE message on this surface that has to teach
 * rather than merely report.
 *
 * A `validator_failed` draft is unapprovable UNCHANGED — mechanically, in the
 * approval core, not merely absent from the UI. An operator meeting that refusal
 * needs to know it is not a glitch and not a permission problem: the draft is
 * refused because a machine found something wrong with the text, and the way
 * through is to fix the text. So the sentence names the rule and the remedy in
 * the same breath.
 */
export const DRAFT_VALIDATOR_FAILED_MESSAGE =
  'This draft failed the fact check, so it cannot be sent as written. ' +
  'Edit the message below and approve your version.';

/**
 * The stale-page refusal. Deliberately distinct from "not found": the draft
 * exists, and telling the operator it does not would send them looking for a
 * bug. A newer attempt replaced it between the page rendering and the tap.
 */
export const DRAFT_SUPERSEDED_MESSAGE =
  'A newer draft replaced this one. Reload the page to see it.';

export const DRAFT_NOT_FOUND_MESSAGE = 'That draft could not be found.';

/**
 * The double-approve answer, and it is a SUCCESS rather than an error.
 *
 * Two taps on a phone with a bad connection, or two operators, reach here. The
 * write is refused by `drafts.approve`'s own guard and by the unique partial
 * index behind it — nothing went wrong, and the message says what is true: the
 * draft is approved and will go out. Calling that an error would invite a third
 * tap.
 *
 * THE SENTENCE IS ONLY TRUE BECAUSE THE CORE MAKES IT TRUE (CR-01). "It goes
 * out at its scheduled time" is a claim about the TOUCH, and a draft can be
 * `approved` beside a touch that never moved — in which case dispatch never
 * claims it and this reads as a lie with the controls removed. Every route to
 * this outcome re-runs the guarded touch write first (`settleAlreadyApproved`),
 * so by the time these words are rendered the touch really is approved.
 */
export const DRAFT_ALREADY_APPROVED_MESSAGE =
  'This draft was already approved. It goes out at its scheduled time.';

export const DRAFT_APPROVED_MESSAGE =
  'Approved. This exact message goes out at its scheduled time.';
export const DRAFT_EDITED_APPROVED_MESSAGE =
  'Approved with your edit. Your version is what goes out — word for word.';

/**
 * The ids an approval submits, on EITHER surface.
 *
 * `touch_id` is not redundant beside `draft_id`: the approve write is two
 * statements (`drafts.approve` + `touches.approveWhere`) and the touch is what
 * dispatch reads. Both arrive from the form, both are re-checked against the
 * database by the core — the draft loaded for `touch_id` must BE `draft_id`, so
 * a forged pair naming another touch's draft matches nothing.
 *
 * Not politeness about shape: these values reach Postgres in a parameterised
 * predicate, and a non-uuid surfaces as a `22P02` thrown three layers below a
 * page the operator is looking at. Rejecting here names the failure where it
 * happened. The form can only ever submit the ids the page rendered — but the
 * action id is global and the body belongs to whoever POSTs it.
 */
export const draftIdsSchema = z.object({ draft_id: z.uuid(), touch_id: z.uuid() });

export const editedBodySchema = z.object({
  edited_body: z
    .string()
    .trim()
    .min(1, DRAFT_BODY_REQUIRED_MESSAGE)
    .max(EDITED_BODY_MAX, DRAFT_BODY_TOO_LONG_MESSAGE),
});

/**
 * A validator refusal of the OPERATOR'S OWN EDIT, in their words.
 *
 * ── WHY THIS EXISTS SEPARATELY FROM THE MODEL'S FEEDBACK COPY ───────────────
 *
 * `draft-touches.ts` already turns a `DraftViolation` into a sentence — for the
 * MODEL, on the one regeneration a rejection earns. That copy is written as an
 * instruction to a writer ("Use only the values listed, exactly as written"),
 * which is the wrong register for a human who has just been told their own
 * sentence is refused. An operator needs to know WHICH characters, and WHY the
 * rule exists, because the rule is occasionally going to be wrong about them.
 *
 * THE FRAGMENT IS ECHOED BACK. `detail` is a piece of the body the operator
 * typed on a screen they are looking at, behind auth — the same distinction the
 * inbox page draws about rendering a customer's reply. It is not logged, here or
 * anywhere: `console.error` on the approval path carries counts and tenant ids
 * only.
 */
/** One violation, as a sentence. See `draftViolationMessage` for the register. */
export type DraftViolationView = {
  rule: string;
  detail?: string;
  nearest?: string;
};

export function describeDraftViolation(violation: DraftViolationView): string {
  switch (violation.rule) {
    case 'unlisted_number':
      return (
        `“${violation.detail ?? 'a number'}” is not a figure from this quote, so it cannot be sent` +
        (violation.nearest === undefined ? '' : ` — the quote says “${violation.nearest}”`) +
        `. Use the quote's own figures or leave the number out.`
      );
    case 'unlisted_date_word':
      return (
        `“${violation.detail ?? 'that date'}” is not a date from this quote. ` +
        'Naming a day or month we did not supply is how a customer gets told the wrong thing.'
      );
    case 'non_gsm_character':
      return (
        `“${violation.detail ?? 'a character'}” cannot be sent in a plain SMS — it would triple ` +
        'the cost and may arrive as a question mark. Use plain letters, digits and punctuation.'
      );
    case 'too_many_segments':
      return `That is ${violation.detail ?? 'too many'} SMS segments; two is the limit. Shorten it.`;
    case 'missing_suffix':
      return (
        'The message must end with the opt-out line exactly as it was — ' +
        `“${violation.detail ?? 'the opt-out line'}”. It is a legal requirement, not a sign-off.`
      );
    case 'link':
      return (
        `“${violation.detail ?? 'That'}” looks like a link. A follow-up to a missed caller ` +
        'carries no links or web addresses. Remove it.'
      );
    case 'empty_body':
      // ── THE RECORDED CAUSE, WHEN THERE IS ONE. ─────────────────────────
      //
      // `parkUnusable` puts the real reason in `detail` — 'the model declined
      // to write this message (stop_reason: refusal)', a truncation, an output
      // the schema rejected. Discarding it left the operator with an empty
      // <pre>, an empty edit box, a "failed the fact check" badge, and a
      // sentence describing neither what happened nor what to do.
      //
      // A genuinely empty SUBMISSION has no detail and still gets the plain
      // instruction, which is the right sentence for that case.
      return violation.detail
        ? `There is no draft to approve: ${violation.detail}. Write this one yourself.`
        : DRAFT_BODY_REQUIRED_MESSAGE;
    default:
      // A rule added to the validator later reaches the operator as a refusal
      // they can act on rather than as a blank line. The card lists every
      // violation, so an unnamed one is still visibly A violation.
      return 'That message cannot be sent as written.';
  }
}

/**
 * The whole refusal, as ONE action-state sentence.
 *
 * Only the first violation is spelled out, with a count of the rest. The action
 * has a single message slot and a paragraph of stacked refusals on a phone is
 * one nobody reads to the end — the card lists them all in full, next to the
 * text they are about, which is where an operator is actually looking.
 */
export function draftViolationMessage(violations: readonly DraftViolationView[]): string {
  const first = violations[0];
  if (first === undefined) return BAD_REQUEST_MESSAGE;

  const more =
    violations.length > 1
      ? ` (and ${violations.length - 1} other problem${violations.length === 2 ? '' : 's'})`
      : '';

  const sentence = describeDraftViolation(first);
  return more === '' ? sentence : `${sentence.replace(/\.$/, '')}${more}.`;
}

/**
 * THE ONE MAPPING FROM "what happened" TO "what the operator reads".
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ The approval core returns OUTCOMES, never sentences — it is framework-   │
 * │ free and copy-free by design. This function is where an outcome becomes  │
 * │ words, and it is shared so the two approval surfaces cannot disagree     │
 * │ about which outcomes are successes.                                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Note which branches land in `success` rather than `error`: an already-approved
 * draft is a success (nothing went wrong; a third tap must not be invited), and
 * a `write_failed` is deliberately the DULL bad-request sentence — the caught
 * database value was discarded in the core and there is nothing here to say
 * about it that would not be a leak (WR-08, T-5-03).
 */
export function approvalControlState(result: ApprovalResult): ControlState {
  switch (result.kind) {
    case 'approved':
      return {
        ...BLANK_CONTROL_STATE,
        success: result.edited ? DRAFT_EDITED_APPROVED_MESSAGE : DRAFT_APPROVED_MESSAGE,
        // Nothing further to do to this draft, on either surface. The
        // revalidation will take the card away; until it lands, the controls go
        // first — a second tap on a slow connection is the common case here.
        settled: true,
      };
    case 'already_approved':
      // THE STALE-CARD CASE, made visible. Somebody else cleared this row while
      // the card sat on screen; the sentence is the honest one and the controls
      // have nothing left to offer.
      return { ...BLANK_CONTROL_STATE, success: DRAFT_ALREADY_APPROVED_MESSAGE, settled: true };
    case 'not_found':
      return { ...BLANK_CONTROL_STATE, error: DRAFT_NOT_FOUND_MESSAGE };
    case 'superseded':
      return { ...BLANK_CONTROL_STATE, error: DRAFT_SUPERSEDED_MESSAGE };
    case 'validator_failed':
      return { ...BLANK_CONTROL_STATE, error: DRAFT_VALIDATOR_FAILED_MESSAGE };
    case 'violations':
      return { ...BLANK_CONTROL_STATE, error: draftViolationMessage(result.violations) };
    case 'write_failed':
      return { ...BLANK_CONTROL_STATE, error: BAD_REQUEST_MESSAGE };
  }
}

/**
 * Did this outcome CHANGE anything? — the revalidation predicate.
 *
 * Each surface owns which paths it re-renders (the core imports no `next/*`),
 * but "was there anything to re-render" is one question with one answer, and
 * getting it wrong in one direction leaves a card on screen that has already
 * been approved.
 */
export function approvalChangedState(result: ApprovalResult): boolean {
  return result.kind === 'approved';
}
