'use client';

import { useActionState, useState } from 'react';

import {
  BLANK_CONTROL_STATE,
  type ControlState,
} from '../clients/[id]/quotes/[quoteId]/action-state';
import { killContactAction } from '../clients/[id]/quotes/[quoteId]/actions';

/**
 * THE D-13 SUGGESTED ACTION — and everything about it is in what it does NOT do.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A MODEL SAID THIS CUSTOMER WANTS OUT. THE MODEL DOES NOT GET TO ACT ON   │
 * │ THAT. This component is the suggestion; the write is the Phase 3 guarded │
 * │ `killContact` transaction, invoked by a human tapping twice.             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── WHY THIS IMPORTS AN ACTION FROM ANOTHER ROUTE RATHER THAN DEFINING ONE ──
 *
 * `killContactAction` already exists on the quote-detail surface: it authorizes
 * with the operator's own JWT before reading a byte of the body, then delegates
 * to `killContact`, which writes the suppression and the stop in one guarded
 * transaction. Writing a second suppression path for this screen would be a
 * second answer to "stop chasing this person" — and `controls.ts` says in its
 * own header that the second expression is the one that gets a condition wrong,
 * with a message going out after somebody asked us to stop as the failure.
 *
 * So THERE IS NO NEW WRITE IN THIS FILE, and there is no new action id either.
 * The suggestion is presentation. The privilege boundary is that a classification
 * label can put a row at the top of a screen and can put a button on it, and
 * that is the entire extent of what model output may cause (D-13, AI-03).
 *
 * ── ARM-THEN-CONFIRM, FOR A REASON THE QUOTE PAGE DOES NOT HAVE ─────────────
 *
 * The cadence controls arm this same action because it is irreversible. Here it
 * is irreversible AND it sits in a scrolling list of rows, each about a
 * different customer, on a phone. T-5-27 is precisely "one-tap suppressing the
 * wrong contact": a mis-tap while scrolling would permanently block somebody who
 * never asked, in a client's name, with no undo anywhere in this codebase. The
 * second tap lands on a control that did not exist a moment ago, so the gesture
 * that armed it cannot complete it.
 *
 * ── SUPPRESSING IS NOT TRIAGING ─────────────────────────────────────────────
 *
 * This does not mark the row handled. `triaged_at` answers "how long did this
 * customer wait for a human", and a suppression is not always the end of the
 * decision — the operator may want to ring the client first. Mark handled stays
 * its own tap, deliberately.
 */
export function SuppressContactForm({
  tenantId,
  quoteId,
  cadenceId,
  clientName,
}: {
  tenantId: string;
  /**
   * Only a path for `revalidatePath`; the write is scoped by `cadence_id`.
   * NULL for a lead reply (Phase 13, D-11): a missed caller's cadence has no
   * quote, and the action's UUID guard skips the quote page.
   */
  quoteId: string | null;
  cadenceId: string;
  clientName: string;
}) {
  const [state, formAction, pending] = useActionState(
    killContactAction.bind(null, tenantId, quoteId),
    BLANK_CONTROL_STATE,
  );
  const [armed, setArmed] = useState(false);

  return (
    <div className="controls">
      <Message state={state} />

      {armed ? (
        <>
          {/* The consequence, stated BETWEEN the two taps rather than after
              them, and naming the client so a mis-scroll is visible. */}
          <p className="kill-warning" role="alert">
            {quoteId === null
              ? `This blocks this caller for ${clientName} for good — no follow-up and no future text. There is no undo.`
              : `This blocks this contact for ${clientName} for good — on this quote and every future one. There is no undo.`}
          </p>
          <form action={formAction}>
            <input type="hidden" name="cadence_id" value={cadenceId} />
            <button type="submit" className="kill-armed" disabled={pending}>
              {pending ? 'Stopping…' : 'Yes — never contact them again'}
            </button>
          </form>
          <button type="button" onClick={() => setArmed(false)} disabled={pending}>
            Cancel
          </button>
        </>
      ) : (
        <button type="button" onClick={() => setArmed(true)}>
          Suppress this contact
        </button>
      )}
    </div>
  );
}

function Message({ state }: { state: ControlState }) {
  if (state.error) {
    return (
      <p className="error" role="alert">
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p className="muted" role="status">
        {state.success}
      </p>
    );
  }
  return null;
}
