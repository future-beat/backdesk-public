'use client';

import { useActionState } from 'react';

import { updateAfterHoursEscalationAction } from './actions';
import { BLANK_AFTER_HOURS_ESCALATION_STATE } from './action-state';

/**
 * THE AFTER-HOURS ESCALATION SWITCH (Phase 13, D-09), in the escalation-number
 * form's mould.
 *
 * OFF BY DEFAULT: a hot lead reply that arrives outside the client's contact
 * hours is held and texted to the escalation phone when the window opens. ON
 * texts it straight away. Emergencies and URGENT replies are texted at once
 * either way — the copy says so, because an operator switching it off must not
 * read that as "nothing reaches the tradie at night".
 *
 * ── COLLAPSED, AND THAT IS THE DECISION ─────────────────────────────────────
 *
 * The current setting is visible in the profile list above as On or Off. Like
 * the number, CHECKING it is the common act and CHANGING it is rare — and it is
 * decided once, at onboarding (divert runbook section 0.6).
 *
 * ── PLAIN PROPS, NO DATABASE MODULE ─────────────────────────────────────────
 *
 * The only value imports are React, the server action and the sibling leaf
 * `action-state.ts`, which imports nothing. `tests/lint-ban.test.ts` pins this
 * file for the 06-02 value/type asymmetry that broke `next build`.
 */
export function AfterHoursEscalationForm({
  tenantId,
  current,
}: {
  tenantId: string;
  current: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    updateAfterHoursEscalationAction.bind(null, tenantId),
    BLANK_AFTER_HOURS_ESCALATION_STATE,
  );

  return (
    <details className="disclosure">
      <summary>Change after-hours escalation</summary>

      <form action={formAction}>
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

        <label htmlFor="after-hours-escalation">
          <input
            id="after-hours-escalation"
            name="after_hours_escalation"
            type="checkbox"
            defaultChecked={current}
            disabled={pending}
          />{' '}
          After-hours escalation
        </label>
        <p className="muted meta">
          Text the escalation phone about hot leads outside contact hours. Emergencies and
          URGENT replies are always sent.
        </p>

        <button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save setting'}
        </button>
      </form>
    </details>
  );
}
