'use client';

import { useActionState } from 'react';

import { updateEscalationPhoneAction } from './actions';
import { BLANK_ESCALATION_PHONE_STATE, ESCALATION_PHONE_MAX } from './action-state';

/**
 * THE NUMBER A HOT LEAD ARRIVES ON (CON-03), EDITABLE AT LAST (06-06).
 *
 * Until now `escalation_phone` could only be set on the new-client form. A
 * tradie changing phones, or an operator who left it blank during a hurried
 * onboarding, had no route to it that was not a SQL console — on the one field
 * whose whole purpose is that a person picks up.
 *
 * ── COLLAPSED, AND THAT IS THE DECISION ─────────────────────────────────────
 *
 * The current number is visible in the profile list above without opening
 * anything, because CHECKING it is the common act and CHANGING it is rare. An
 * always-open input beside a working number is an invitation to paste the wrong
 * client's — the same argument the `Replace key` disclosure makes one section
 * down, on a field with the same failure mode.
 *
 * ── CLEARING IS ALLOWED, AND IT SAYS WHAT IT MEANS ──────────────────────────
 *
 * An empty submission sets the column to NULL. That is a legitimate state — the
 * escalation pass records `no_escalation_number` honestly rather than failing —
 * so it gets its own success sentence naming the consequence, rather than a
 * "Saved." an operator could read either way.
 *
 * ── PLAIN PROPS, NO DATABASE MODULE ─────────────────────────────────────────
 *
 * The only value imports here are its sibling `action-state.ts` (which imports
 * nothing) and the server action. Reaching for a constant from a module that
 * touches the repository is the value/type asymmetry that broke `next build` in
 * 06-02; `tests/lint-ban.test.ts` pins this file for that reason.
 */
export function EscalationPhoneForm({
  tenantId,
  current,
}: {
  tenantId: string;
  current: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    updateEscalationPhoneAction.bind(null, tenantId),
    BLANK_ESCALATION_PHONE_STATE,
  );

  return (
    <details className="disclosure">
      <summary>{current ? 'Change the escalation number' : 'Set an escalation number'}</summary>

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

        <label htmlFor="escalation-phone">Escalation phone</label>
        <p className="muted meta">
          The mobile a hot lead is texted to. Australian mobile — 0412 345 678 or
          +61412345678. Leave it empty to send hot-lead alerts to nobody.
        </p>
        {/* `inputMode="tel"` puts the number pad under an operator's thumb; the
            value is a phone number and never a credential, so unlike the API key
            field it IS echoed back — losing the eight digits somebody just typed
            because the ninth was wrong is a refusal that punishes the fix. */}
        <input
          id="escalation-phone"
          name="escalation_phone"
          type="text"
          inputMode="tel"
          autoComplete="off"
          maxLength={ESCALATION_PHONE_MAX}
          defaultValue={current ?? ''}
          disabled={pending}
        />

        <button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save number'}
        </button>
      </form>
    </details>
  );
}
