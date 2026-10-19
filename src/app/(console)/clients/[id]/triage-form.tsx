'use client';

import { useActionState } from 'react';

import { saveEligibilityAction } from './actions';
import { BLANK_ELIGIBILITY_STATE } from './action-state';

/**
 * One row of the checklist. Pre-formatted on the server, deliberately.
 *
 * Money and dates are rendered in the CLIENT's timezone and in en-AU currency
 * by the page that already does that for every other cell. Passing raw values
 * here would mean a second formatter in a component that renders in the
 * operator's browser locale — so the same quote would read one way in the table
 * and another way two inches below it.
 */
export interface TriageQuote {
  id: string;
  jobId: string;
  description: string;
  value: string;
  quoteDate: string;
}

/**
 * The D-15 triage checklist.
 *
 * WHAT THIS SCREEN IS ACTUALLY ASKING is not "which quotes are open" — the
 * table above already answers that. It is "which of these old quotes may we
 * text this tradie's customers about", and the honest default for that question
 * is *none*. Every unticked box stays unticked; there is no select-all, and
 * that omission is the feature. A select-all control turns a considered review
 * of a stranger's customer list into one tap, which is precisely the outcome
 * D-15 exists to prevent.
 *
 * UNTICKED IS NOT A DECISION, IT IS A NOT-YET. Nothing here can mark a quote as
 * permanently excluded, so a quote skipped today reappears tomorrow. The
 * alternative — a third "never chase" state — would be a decision the operator
 * makes on a phone with 200 rows in front of them and no way to revisit.
 */
export function TriageForm({
  tenantId,
  quotes,
}: {
  tenantId: string;
  quotes: readonly TriageQuote[];
}) {
  const [state, formAction, pending] = useActionState(
    saveEligibilityAction.bind(null, tenantId),
    BLANK_ELIGIBILITY_STATE,
  );

  return (
    <form className="triage" action={formAction}>
      <p className="hint muted">
        Backfilled open quotes start as &ldquo;needs review&rdquo;. Tick the quotes this client
        wants chased — nothing is followed up until you save it here.
      </p>

      {state.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}

      {/* The list shrinks on success — the saved rows leave `needs_review` and
          stop being rendered — so without this the operator's only evidence is
          rows disappearing, which reads like a bug. */}
      {state.success ? (
        <p className="muted" role="status">
          {state.success}
        </p>
      ) : null}

      <ul className="triage-list">
        {quotes.map((quote) => (
          <li key={quote.id}>
            {/* The LABEL is the tap target, not the checkbox. A bare checkbox is
                about 16px; on a phone the mis-taps that produces do not fail
                loudly, they approve the wrong customer's quote. */}
            <label className="triage-row">
              <input type="checkbox" name="quote_ids" value={quote.id} />
              <span className="triage-text">
                <span className="cell-truncate">
                  <strong>{quote.jobId}</strong> {quote.description}
                </span>
                <span className="cell-truncate muted">
                  {quote.value} · {quote.quoteDate}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      {/* The one primary button on this screen (02-UI-SPEC Color). Disabled
          while pending so a double-tap cannot fire a second save — harmless by
          construction (the WHERE clause makes the second one flip nothing) but
          a spinner-free form that accepts a second tap looks broken. */}
      <button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save eligibility'}
      </button>
    </form>
  );
}
