'use client';

import { useActionState, useState } from 'react';

// WR-10: the ONE outcome renderer, shared with the draft card. The fix-link
// rendering below used to live here and ONLY here, which made `ControlState`'s
// `fixes` field honoured on this surface and dropped on the other.
import { ActionMessage } from '@/app/(console)/components/action-message';

import {
  killContactAction,
  pauseClientAction,
  resumeCadenceAction,
  resumeClientAction,
} from './actions';
import { BLANK_CONTROL_STATE } from './action-state';

/** The four D-16 controls, as the message slot below identifies them. */
type ControlAction = 'kill' | 'pause' | 'resumeClient' | 'resumeCadence';

/**
 * The D-16 control surface, as the operator's thumb meets it.
 *
 * ── EVERY CONTROL IS A FULL-WIDTH BUTTON, AND THAT IS THE REQUIREMENT ───────
 *
 * "A kill switch you can't reach from your phone isn't a kill switch." The
 * operator is being told to stop chasing someone while standing in a driveway,
 * one-handed, on a 390px screen. So: no inline controls beside a table cell, no
 * dropdown, no modal — a stack of 44px buttons, each of which says what it does
 * in a verb.
 *
 * ── THE KILL TAKES TWO DISTINCT INTERACTIONS, AND IT IS NOT A `confirm()` ───
 *
 * `window.confirm` is the obvious answer and the wrong one: it is a browser
 * chrome dialog whose buttons sit wherever the phone puts them, which is often
 * exactly where the operator's thumb already is. The arm-then-confirm pattern
 * moves the second tap to a control that DID NOT EXIST a moment ago, so it
 * cannot be hit by the same gesture that armed it — and the intervening state
 * spells out the consequence, which a confirm dialog has no room for.
 *
 * Arming is also freely reversible: Cancel is beside Confirm, and navigating
 * away disarms. The only irreversible thing here is the thing that says so.
 *
 * ── THE BUTTONS RENDER ON THE CADENCE'S STATE ───────────────────────────────
 *
 * No resume on an active sequence, no kill on one that already stopped. A
 * disabled-but-present button would invite the operator to work out why; an
 * absent one asks nothing. The server re-decides all of it anyway — every action
 * routes through a guarded write whose WHERE clause is what actually holds — so
 * this is about what the operator is asked to think about, not about safety.
 */
export function CadenceControls({
  tenantId,
  quoteId,
  cadenceId,
  cadenceStatus,
  clientPaused,
}: {
  tenantId: string;
  quoteId: string;
  cadenceId: string;
  /** One of CADENCE_STATUSES, as stored. */
  cadenceStatus: string;
  /** Whether `cadence_settings.paused_at` is set for this client (D-06). */
  clientPaused: boolean;
}) {
  const [killState, killAction, killPending] = useActionState(
    killContactAction.bind(null, tenantId, quoteId),
    BLANK_CONTROL_STATE,
  );
  const [pauseState, pauseAction, pausePending] = useActionState(
    pauseClientAction.bind(null, tenantId, quoteId),
    BLANK_CONTROL_STATE,
  );
  const [resumeClientState, resumeClientFormAction, resumeClientPending] = useActionState(
    resumeClientAction.bind(null, tenantId, quoteId),
    BLANK_CONTROL_STATE,
  );
  const [resumeCadenceState, resumeCadenceFormAction, resumeCadencePending] = useActionState(
    resumeCadenceAction.bind(null, tenantId, quoteId),
    BLANK_CONTROL_STATE,
  );

  const [armed, setArmed] = useState(false);

  /**
   * WHICH ACTION THE OPERATOR LAST TAPPED — and the reason a single slot needs
   * one at all.
   *
   * `useActionState` retains each hook's last result independently and does not
   * clear its siblings, and this component does not unmount between actions
   * (the `revalidatePath` refresh re-renders it in place). Four unconditional
   * `<ActionMessage>` elements therefore stacked, so an operator who paused and then
   * resumed read BOTH confirmations at once — "Paused. Nothing goes out…"
   * directly above "Resumed. Follow-ups were rescheduled…" — and a screen-reader
   * user heard both, in that order, from two `role="status"` regions. For a
   * surface whose whole purpose is that somebody standing in a driveway can tell
   * what state a client is in, two contradictory confirmations is worse than
   * none.
   *
   * Set from `onClick` on each submit button rather than `onSubmit` on the form:
   * a click is unambiguous and happens before submission, whereas the
   * interaction between a submit handler and a React `action` is a detail this
   * component should not be relying on.
   */
  const [last, setLast] = useState<ControlAction | null>(null);

  const state =
    last === 'kill'
      ? killState
      : last === 'pause'
        ? pauseState
        : last === 'resumeClient'
          ? resumeClientState
          : last === 'resumeCadence'
            ? resumeCadenceState
            : BLANK_CONTROL_STATE;

  const live = cadenceStatus === 'active' || cadenceStatus === 'paused';

  return (
    <div className="controls">
      {/* ONE SLOT. The most recent outcome, and nothing else. */}
      <ActionMessage state={state} />

      {/* --- the sequence's own pause (D-05) --- */}
      {cadenceStatus === 'paused' ? (
        <form action={resumeCadenceFormAction}>
          <input type="hidden" name="cadence_id" value={cadenceId} />
          <button
            type="submit"
            disabled={resumeCadencePending}
            onClick={() => setLast('resumeCadence')}
          >
            {resumeCadencePending ? 'Restarting…' : 'Restart this follow-up'}
          </button>
        </form>
      ) : null}

      {/* --- the client-wide switch (D-06) --- */}
      {clientPaused ? (
        <form action={resumeClientFormAction}>
          <button
            type="submit"
            disabled={resumeClientPending}
            onClick={() => setLast('resumeClient')}
          >
            {resumeClientPending ? 'Resuming…' : 'Resume this client'}
          </button>
        </form>
      ) : (
        <form action={pauseAction}>
          <button type="submit" disabled={pausePending} onClick={() => setLast('pause')}>
            {pausePending ? 'Pausing…' : 'Pause this client'}
          </button>
        </form>
      )}

      {/* --- the terminal one (D-06/D-15) --- */}
      {live ? (
        armed ? (
          <>
            {/* The consequence, stated between the two taps rather than after
                them. This is the sentence the arm step exists to show. */}
            <p className="kill-warning" role="alert">
              This stops the sequence and blocks this contact for good — on this quote and on
              every future one. There is no undo.
            </p>
            <form action={killAction}>
              <input type="hidden" name="cadence_id" value={cadenceId} />
              <button
                type="submit"
                className="kill-armed"
                disabled={killPending}
                onClick={() => setLast('kill')}
              >
                {killPending ? 'Stopping…' : 'Yes — never contact them again'}
              </button>
            </form>
            <button type="button" onClick={() => setArmed(false)} disabled={killPending}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setArmed(true)}>
            Never contact this customer again
          </button>
        )
      ) : null}
    </div>
  );
}

