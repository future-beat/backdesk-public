'use client';

import { useActionState, useState } from 'react';

import {
  provisionDivertNumberAction,
  searchDivertNumberAction,
  updateSpokenNameAction,
} from './actions';
import {
  BLANK_DIVERT_NUMBER_STATE,
  DIVERT_BUNDLE_UNATTACHED_MESSAGE,
  DIVERT_HELD_MESSAGE,
  DIVERT_SPOKEN_NAME_MESSAGE,
  DIVERT_STALE_CLAIM_MINUTES,
  divertClaimInProgressMessage,
  divertStaleClaimMessage,
  SPOKEN_NAME_MAX,
  type DivertNumberState,
} from './action-state';

/**
 * THE CLIENT'S BACKDESK DIVERT NUMBER (CAP-01, D-08) — find, buy, rename.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ BUYING IS TWO TAPS, WITH THE NUMBER AND THE COST BETWEEN THEM — the      │
 * │ arm-then-confirm shape. Tap one is a read at Twilio and shows the exact  │
 * │ number, where it is, and what it costs a month; tap two posts that       │
 * │ number with `confirm=buy`. A purchase is a real charge and a number that │
 * │ is not given back while the client is active, so it is never one tap.   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * THERE IS NO RELEASE CONTROL, AND THERE MUST NEVER BE ONE (D-08). A released
 * number is one Twilio can sell to somebody else while the tradie's phone keeps
 * diverting to it. The server has no action for it either; the absent button is
 * the courtesy copy of the absent path.
 *
 * The section id is the anchor the checklist's "Provision it →" link
 * lands on.
 *
 * ── PLAIN PROPS, NO DATABASE MODULE ─────────────────────────────────────────
 *
 * Value imports are the sibling `action-state.ts` (type-only imports of its
 * own) and the server actions — the escalation-phone-form mould, for the
 * 06-02 reason: a client component that reaches a repository module breaks
 * `next build`, and only there.
 */
export interface DivertNumberCurrent {
  numberE164: string | null;
  status: 'none' | 'pending' | 'active' | 'failed';
  spokenName: string | null;
  failureCode: string | null;
  /** WR-07: whole minutes since a `pending` row was claimed; `null` otherwise. */
  claimedMinutesAgo: number | null;
}

function Sentences({ state }: { state: DivertNumberState }) {
  return (
    <>
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
    </>
  );
}

export function DivertNumberForm({
  tenantId,
  tenantName,
  current,
}: {
  tenantId: string;
  tenantName: string;
  current: DivertNumberCurrent;
}) {
  const [searchState, searchAction, searchPending] = useActionState(
    searchDivertNumberAction.bind(null, tenantId),
    BLANK_DIVERT_NUMBER_STATE,
  );
  const [buyState, buyAction, buyPending] = useActionState(
    provisionDivertNumberAction.bind(null, tenantId),
    BLANK_DIVERT_NUMBER_STATE,
  );
  const [nameState, nameAction, namePending] = useActionState(
    updateSpokenNameAction.bind(null, tenantId),
    BLANK_DIVERT_NUMBER_STATE,
  );

  // ONE VALUE FOR BOTH TAPS. The name typed before tap one is the name tap two
  // posts — carried in a hidden field, so the operator never types it twice and
  // the buy form never posts a stale default.
  const [spokenName, setSpokenName] = useState(
    current.spokenName ?? tenantName.slice(0, SPOKEN_NAME_MAX),
  );

  const busy = searchPending || buyPending;
  const candidate = searchState.candidate;
  /** CR-01: a pending row whose purchase outcome is unknown. */
  const held = current.status === 'pending' && current.failureCode === 'outcome_unknown';
  /** WR-07: a pending claim older than the hold — nobody is still buying on it. */
  const stale =
    current.status === 'pending' &&
    !held &&
    current.claimedMinutesAgo !== null &&
    current.claimedMinutesAgo >= DIVERT_STALE_CLAIM_MINUTES;

  return (
    <section id="divert-number" className="draft-card">
      <h2>Divert number</h2>

      {current.status === 'active' && current.numberE164 ? (
        <>
          <p className="divert-number">{current.numberE164}</p>
          {current.failureCode === 'bundle_unattached' ? (
            // WR-09: recorded on the row, so it survives the reload.
            <p className="error">{DIVERT_BUNDLE_UNATTACHED_MESSAGE}</p>
          ) : null}
          {/* The buy's own sentence, minus the bundle warning the row already shows. */}
          <Sentences
            state={
              current.failureCode === 'bundle_unattached' &&
              buyState.error === DIVERT_BUNDLE_UNATTACHED_MESSAGE
                ? { ...buyState, error: null }
                : buyState
            }
          />
          <p className="meta">
            Give the client this number for their divert (61/62/67 codes in the runbook).
          </p>

          <form action={nameAction}>
            <Sentences state={nameState} />
            <label htmlFor="divert-spoken-name">Spoken name</label>
            <p className="muted meta">{DIVERT_SPOKEN_NAME_MESSAGE}</p>
            <input
              id="divert-spoken-name"
              name="spoken_name"
              type="text"
              autoComplete="off"
              maxLength={SPOKEN_NAME_MAX}
              defaultValue={current.spokenName ?? ''}
              required
              disabled={namePending}
            />
            <button type="submit" disabled={namePending}>
              {namePending ? 'Saving…' : 'Update spoken name'}
            </button>
          </form>

          <p className="muted meta">This number cannot be released while the client is active.</p>
        </>
      ) : current.status === 'pending' && !held && !stale ? (
        // A CLAIMED ROW WITH NOTHING BOUGHT YET — or a purchase whose fill
        // failed, which the orphan sentence has already explained. Either way
        // there is nothing to tap while it is fresh: a second buy is exactly
        // what the claim exists to refuse. Its AGE is shown (WR-07).
        <p className="muted">{divertClaimInProgressMessage(current.claimedMinutesAgo)}</p>
      ) : (
        <>
          {held ? (
            // CR-01: THE PURCHASE MAY HAVE GONE THROUGH. The taps stay, because
            // the buy step searches the account for this client's number and
            // records it before it would ever spend anything.
            <p className="error">{DIVERT_HELD_MESSAGE}</p>
          ) : stale ? (
            // WR-07: the same adopt-or-reclaim path as a held row.
            <p className="error">{divertStaleClaimMessage(current.claimedMinutesAgo ?? 0)}</p>
          ) : current.status === 'failed' ? (
            <p className="error">
              The last purchase did not go through ({current.failureCode ?? 'unknown'}). Nothing
              was bought — search again.
            </p>
          ) : (
            <p className="muted meta">
              One Perth (08) number for this client. Their own line diverts to it when they cannot
              answer; callers hear a short greeting and nothing is recorded.
            </p>
          )}

          {/* TAP ONE — a read. Nothing is bought here. */}
          <form action={searchAction}>
            <label htmlFor="divert-spoken-name">Spoken name</label>
            <p className="muted meta">{DIVERT_SPOKEN_NAME_MESSAGE}</p>
            <input
              id="divert-spoken-name"
              name="spoken_name"
              type="text"
              autoComplete="off"
              maxLength={SPOKEN_NAME_MAX}
              value={spokenName}
              onChange={(event) => setSpokenName(event.target.value)}
              required
              disabled={busy}
            />
            <button type="submit" disabled={busy}>
              {searchPending ? 'Searching…' : 'Find a Perth number'}
            </button>
            {/* The candidate sentence — number, locality, monthly cost — is
                the search's success line, rendered once, right here. */}
            <Sentences state={searchState} />
          </form>

          {/* TAP TWO — only once a number is on screen. The hidden fields are
              exactly what tap one showed; the server re-validates all four. */}
          {candidate ? (
            <form action={buyAction}>
              <input type="hidden" name="phone_number" value={candidate.phoneNumber} />
              <input type="hidden" name="locality" value={candidate.locality ?? ''} />
              <input type="hidden" name="spoken_name" value={spokenName} />
              <input type="hidden" name="confirm" value="buy" />
              <button type="submit" className="button--secondary" disabled={busy}>
                {buyPending ? 'Buying…' : 'Buy this number'}
              </button>
              <Sentences state={buyState} />
            </form>
          ) : (
            <Sentences state={buyState} />
          )}
        </>
      )}
    </section>
  );
}
