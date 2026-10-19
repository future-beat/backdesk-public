'use client';

import { useActionState } from 'react';

import { connectServiceM8Action, rekeyAction } from './actions';
import { BLANK_CONNECT_STATE } from './action-state';

/**
 * The ServiceM8 key form, in both of its modes.
 *
 * ONE COMPONENT, TWO ACTIONS, AND THAT IS THE POINT (D-08). A re-key runs the
 * same live verification, refuses the same too-short input, and withholds the
 * key from the response for the same reason. Building a second form would mean
 * two places for those rules to live and one of them to eventually not.
 *
 * What actually differs between the modes is one verb and one server action —
 * everything else on screen is identical, which is also true of what the
 * operator is doing.
 *
 * THREE THINGS ABOUT THE INPUT, none of them decoration:
 *
 *  - `type="password"` so a key pasted in a client's kitchen, or on a screen
 *    share with a design partner, is not readable over a shoulder.
 *  - `autoComplete="off"` so the browser's password manager does not offer to
 *    save a credential that belongs to the CLIENT, not the operator, into the
 *    operator's own vault.
 *  - no `defaultValue`, ever. The action deliberately does not echo the key
 *    back on failure — see its header (threat T-2-02).
 *
 * The disabled-while-pending button is not cosmetic either: verification is a
 * live round trip to ServiceM8 and takes a visible moment. Without it a
 * double-click fires a second submission, which the UNIQUE constraint on
 * `sm8_connections.tenant_id` would survive, but which would also run a second
 * 90-day backfill against a rate-limited API for no reason.
 */
export function ConnectServiceM8Form({
  tenantId,
  mode = 'connect',
}: {
  tenantId: string;
  mode?: 'connect' | 'rekey';
}) {
  const rekey = mode === 'rekey';

  const [state, formAction, pending] = useActionState(
    (rekey ? rekeyAction : connectServiceM8Action).bind(null, tenantId),
    BLANK_CONNECT_STATE,
  );

  return (
    <form action={formAction}>
      {state.formError ? (
        <p className="error" role="alert">
          {state.formError}
        </p>
      ) : null}

      {/* The connect path replaces this whole form with the connected state on
          success, so it never sees this. The re-key path stays on screen — and
          an operator who pasted a key into a form that then looked unchanged
          would have no way to know it worked. */}
      {state.success ? (
        <p className="muted" role="status">
          {state.success}
        </p>
      ) : null}

      <label htmlFor="api_key">{rekey ? 'New ServiceM8 API key' : 'ServiceM8 API key'}</label>
      <p className="muted hint" id="api_key-hint">
        Paste a private API key from this client&rsquo;s ServiceM8 account (Settings → API Keys).
        The key is verified with a live call before it&rsquo;s saved.
      </p>
      <input
        id="api_key"
        name="api_key"
        type="password"
        required
        autoComplete="off"
        spellCheck={false}
        aria-invalid={state.error ? true : undefined}
        aria-describedby={state.error ? 'api_key-error' : 'api_key-hint'}
      />
      {state.error ? (
        <p className="field-error" id="api_key-error" role="alert">
          {state.error}
        </p>
      ) : null}

      <button type="submit" disabled={pending}>
        {pending ? 'Verifying key…' : rekey ? 'Save new key & resume' : 'Connect ServiceM8'}
      </button>
    </form>
  );
}
