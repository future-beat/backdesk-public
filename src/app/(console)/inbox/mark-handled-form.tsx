'use client';

import { useActionState } from 'react';

import { BLANK_TRIAGE_STATE } from './action-state';
import { markHandledAction } from './actions';

/**
 * The per-row mark-handled control.
 *
 * ONE FORM PER ROW rather than a checklist with one submit. The triage queue is
 * not a batch decision: each row is a different customer who did a different
 * thing, and a select-all over "replies we could not place" is the same mistake
 * `triage-form.tsx` refuses to make with quotes — one tap dismissing a screen
 * full of people, including whoever texted STOP.
 *
 * The button is disabled while pending so a double-tap cannot fire twice.
 * Harmless by construction (the `triaged_at IS NULL` guard makes the second
 * write flip nothing) but a form that silently accepts a second tap on a phone
 * looks broken, which is how an operator learns to distrust the screen.
 */
export function MarkHandledForm({ inboundId }: { inboundId: string }) {
  const [state, formAction, pending] = useActionState(markHandledAction, BLANK_TRIAGE_STATE);

  return (
    <form action={formAction}>
      <input type="hidden" name="inbound_id" value={inboundId} />

      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}

      {/* The row LEAVES the list on success — it is no longer untriaged — so
          without this the operator's only evidence is a row disappearing, which
          reads like a bug. It shows on the re-render before revalidation lands. */}
      {state.success ? (
        <p className="muted" role="status">
          {state.success}
        </p>
      ) : null}

      <button type="submit" disabled={pending}>
        {pending ? 'Marking…' : 'Mark handled'}
      </button>
    </form>
  );
}
