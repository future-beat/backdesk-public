'use client';

import { useActionState } from 'react';

import { appendFeeAction } from './actions';
import { BLANK_FEE_STATE } from './action-state';

/**
 * RECORD WHAT THIS CLIENT PAYS US (D-13). APPEND ONLY.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ NO DEFAULTS ON ANY FIELD. The pricing appears as PLACEHOLDERS and as one │
 * │ hint sentence, and nowhere else. A pre-filled amount would put a fee     │
 * │ nobody agreed to one accidental submit away from becoming the            │
 * │ denominator of a multiple on a client's invoice — and `effective_from`   │
 * │ has no default anywhere in the stack for the same reason the contact     │
 * │ window does not (a defaulted date silently back- or forward-dates a      │
 * │ price change depending on when the form was submitted).                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── NO EDIT, NO DELETE, NO CONFIRM STEP ─────────────────────────────────────
 *
 * A price change is a NEW ROW with a later `effective_from`; a mistake is
 * corrected by a newer row on the same date (latest-inserted wins). Nothing is
 * ever lost, so there is nothing to confirm — a confirm dialog on an append-only
 * form is friction that teaches the operator to click through dialogs.
 *
 * ── PLAIN PROPS, NO DATABASE MODULE ─────────────────────────────────────────
 *
 * The only value imports are the server action and the sibling `action-state`
 * (which imports nothing). The kind vocabulary is spelled out here rather than
 * imported from the schema module, which reaches the repository:
 * `tests/lint-ban.test.ts` pins this file for exactly that reason.
 */
export function FeeScheduleForm({ tenantId }: { tenantId: string }) {
  const [state, formAction, pending] = useActionState(
    appendFeeAction.bind(null, tenantId),
    BLANK_FEE_STATE,
  );

  return (
    // KEYED ON THE OUTCOME so React REMOUNTS the fieldset after a success and
    // reuses it after a refusal. `defaultValue` is only read on mount, so
    // without this the echoed values below would stick around after a
    // successful append and pre-fill the next fee — the exact "a fee nobody
    // agreed to, one accidental submit away" hazard the no-defaults rule exists
    // to prevent. On a refusal the key is unchanged, the fieldset is not
    // remounted, and what the operator typed simply stays on screen.
    <form action={formAction} key={state.success ?? 'editing'}>
      <fieldset>
        <legend>Add a fee</legend>

        {state.error ? (
          <p className="error" role="alert">
            {state.error}
          </p>
        ) : null}
        {state.success ? (
          <p className="muted" role="status">
            {state.success}
          </p>
        ) : null}

        <label htmlFor="fee-kind">Kind</label>
        <select
          id="fee-kind"
          name="kind"
          defaultValue={state.values.kind}
          disabled={pending}
          aria-invalid={state.fieldErrors.kind ? true : undefined}
        >
          {/* An EMPTY first option, selected by the browser because it is
              first — no field in this form arrives pre-filled. A monthly
              retainer and a one-off setup fee are different commercial facts,
              and a select that already answers the question is how a $990 setup
              fee gets recorded as a recurring one. */}
          <option value="">Choose…</option>
          <option value="monthly">Monthly retainer</option>
          <option value="setup">One-off setup fee</option>
        </select>
        {state.fieldErrors.kind ? (
          <p className="field-error" role="alert">
            {state.fieldErrors.kind}
          </p>
        ) : null}

        <label htmlFor="fee-amount">Amount (AUD)</label>
        {/* `inputMode="decimal"` puts the number pad under an operator's thumb.
            The value IS echoed back on failure (`state.values`, populated on
            every non-success return in `appendFeeAction`) — losing three digits
            somebody just typed because the fourth was wrong is a refusal that
            punishes the fix. */}
        <input
          id="fee-amount"
          name="amount"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="597.00"
          defaultValue={state.values.amount}
          disabled={pending}
          aria-invalid={state.fieldErrors.amount ? true : undefined}
        />
        {state.fieldErrors.amount ? (
          <p className="field-error" role="alert">
            {state.fieldErrors.amount}
          </p>
        ) : null}

        <label htmlFor="fee-effective-from">Effective from</label>
        <input
          id="fee-effective-from"
          name="effective_from"
          type="date"
          defaultValue={state.values.effective_from}
          disabled={pending}
          aria-invalid={state.fieldErrors.effective_from ? true : undefined}
        />
        {state.fieldErrors.effective_from ? (
          <p className="field-error" role="alert">
            {state.fieldErrors.effective_from}
          </p>
        ) : null}

        <label htmlFor="fee-note">Note (optional)</label>
        <input
          id="fee-note"
          name="note"
          type="text"
          autoComplete="off"
          maxLength={200}
          defaultValue={state.values.note}
          disabled={pending}
        />

        <button type="submit" disabled={pending}>
          {pending ? 'Adding…' : 'Add fee'}
        </button>

        <p className="muted hint">
          Fees are never edited or deleted — add a new row and each month&rsquo;s report uses the
          latest row in force. Founding rate $297, standard $597 / $997, setup $990.
        </p>
      </fieldset>
    </form>
  );
}
