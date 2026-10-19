'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';

// A LEAF MODULE — `stall-policy.ts` imports nothing. The TIER is computed on
// the server from the render's one `now`; only the words come from here.
import { URGENCY_LABELS, type UrgencyTier } from '@/core/aging/stall-policy';

import { BLANK_CONTROL_STATE, type ControlState } from '../components/action-state';
import type { CreateJobSheet, LeadJobChip } from '../components/lead-job-sheet';
// The Phase 14 sheet, UNCHANGED (15-04 Task 2 — the one widening of this
// card's value-import set). Itself `'use client'` with client-safe imports;
// the inbox mounts the same component.
import { CreateJobForm } from '../inbox/create-job-form';
import {
  APPROVE_TOUCH_LABEL,
  CLOSE_CONFIRM_LABEL,
  CLOSE_DISMISS_LABEL,
  CLOSE_PENDING_LABEL,
  CLOSE_STEP_LABEL,
  closeConsequence,
  LEAD_TOUCH_COUNT,
  NO_FOLLOW_UPS_LEFT_LABEL,
  NO_REPLY_LABEL,
} from './action-state';
import { closeLeadFromQueue } from './actions';

/**
 * One card on the cross-client lead queue (Phase 15, CON-05 / D-01).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ PLAIN PROPS, BUILT ON THE SERVER. Every word on this card is either a    │
 * │ fixed sentence from the sibling leaf or a string the page already        │
 * │ formatted from the render's one `now`. Nothing here reaches the          │
 * │ repository barrel or the schema module — a VALUE import from either is   │
 * │ the edge that put `postgres` in the browser bundle in 06-02             │
 * │ (`tests/lint-ban.test.ts` CLIENT_REACHABLE).                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The tenant is BOUND onto the close action here, from the row the server read
 * returned — never submitted in the form. The core re-reads the lead under
 * `forTenant(that tenant)`, where another client's lead id matches nothing.
 *
 * The caller's mobile and their words are rendered here and nowhere else on
 * this surface: this page is behind the operator gate, and neither ever
 * reaches a log (T-15-01).
 */

export type LeadCardRow = {
  /** The row's identity, the list key and the card's `#lead-{id}` anchor. */
  leadId: string;
  tenantId: string;
  /** Resolved under the OPERATOR's RLS; 'Another client' when unresolvable. */
  clientName: string;
  /** The client's zone, named beside every time on the card. */
  timezone: string;
  /** The inbox's job / resolution / creation-state chips, words and class. */
  chips: LeadJobChip[];
  /**
   * The create-job sheet's props, built by the server's shared builder —
   * present only for an open lead at `none` or `failed` with a reply.
   */
  sheet: CreateJobSheet | undefined;
  /**
   * The deadline tier, DERIVED ON THE SERVER by `leadDeadlineTier` from the
   * render's one clock — the one definition the count line and the digest
   * share. `null` when no follow-up remains: no deadline, no chip.
   */
  tier: UrgencyTier | null;
  afterHours: boolean;
  /** `0412 345 678` — the spaced local form. Operator-only; never logged. */
  callerLabel: string;
  /** When they first rang, in the client's zone (zone named by the card). */
  rangLabel: string;
  /** The number of calls, when more than one; otherwise `null`. */
  callCount: number | null;
  /** When they last rang, short form, when more than one call. */
  lastRangLabel: string | null;
  /** The next follow-up, or `null` when the lead's touches are exhausted. */
  next: {
    touchNumber: number;
    /** Already rendered in the client's zone, with the zone named. */
    slotLabel: string;
    /** Zone-free, and always BESIDE the absolute time. */
    relativeLabel: string;
    /** `awaiting approval` / `no draft yet` / `approved` / `stalled`. */
    stateWord: string;
    /** `/queue#touch-{id}` only when the touch is on the queue; else `null`. */
    approveHref: string | null;
  } | null;
  /** `first_missed_at + LEAD_EXPIRY_DAYS`, when `next` is null. */
  expiresLabel: string | null;
  /** The newest threaded, non-STOP reply — verbatim — or `null`. */
  reply: {
    body: string;
    /** `reads as …`, with ` — not certain` / ` — a guess` below high. */
    labelChip: string | null;
    softOptOut: boolean;
    urgencyChip: string | null;
    emergency: boolean;
    hot: boolean;
    receivedLabel: string;
  } | null;
};

/**
 * Tier → badge class, as a MAP (06-UI-SPEC Colour, house rule). A tier added
 * to `UrgencyTier` without a class here is a COMPILE error. `overdue` is a
 * STATE in red, never a control.
 */
const URGENCY_BADGE_CLASS: Record<UrgencyTier, string> = {
  overdue: 'badge badge--error',
  due_soon: 'badge badge--warn',
  scheduled: 'badge',
};

export function LeadCard({ row }: { row: LeadCardRow }) {
  /**
   * THE CLOSE LIVES HERE, NOT INSIDE THE CONTROL (the queue card's reason).
   *
   * A settled close must take EVERY control on the card away — the approve
   * link and the close alike — and a control that owned its own state could
   * only report that upward through a callback and a second copy of the
   * same boolean.
   */
  const [closeState, closeFormAction, closePending] = useActionState(
    closeLeadFromQueue.bind(null, row.tenantId),
    BLANK_CONTROL_STATE,
  );
  const closeSettled = closeState.settled === true;

  return (
    <article className="draft-card" id={`lead-${row.leadId}`}>
      <div className="row">
        <span className="touch-when touch-when--stack">
          <strong>{row.clientName}</strong>
          {row.tier === null ? null : (
            <span className={URGENCY_BADGE_CLASS[row.tier]}>{URGENCY_LABELS[row.tier]}</span>
          )}
          {/* A fact about the call, not an alarm — neutral. */}
          {row.afterHours ? <span className="badge">after hours</span> : null}
          {row.chips.map((chip) => (
            <span key={chip.text} className={chip.className}>
              {chip.text}
            </span>
          ))}
        </span>
      </div>

      <p className="meta">
        <strong>{row.callerLabel}</strong> · rang {row.rangLabel} ({row.timezone})
        {row.callCount === null ? null : (
          <>
            {' · '}
            {row.callCount} calls, last {row.lastRangLabel}
          </>
        )}
      </p>

      <p className="touch-meta muted">
        {row.next === null ? (
          <>
            {NO_FOLLOW_UPS_LEFT_LABEL} · expires {row.expiresLabel} ({row.timezone})
          </>
        ) : (
          <>
            Next: #{row.next.touchNumber} of {LEAD_TOUCH_COUNT} · {row.next.slotLabel} ·{' '}
            {row.next.relativeLabel} · {row.next.stateWord}
          </>
        )}
      </p>

      {/* The reply verbatim, un-truncated — the inbox invariant. */}
      {row.reply === null ? (
        <p className="touch-meta muted">{NO_REPLY_LABEL}</p>
      ) : (
        <>
          <p className="reply-body">
            {row.reply.body === '' ? <em>(empty message)</em> : row.reply.body}
          </p>
          <p className="touch-line">
            {row.reply.labelChip === null ? null : (
              <span className={row.reply.softOptOut ? 'badge badge--error' : 'badge'}>
                {row.reply.labelChip}
              </span>
            )}
            {row.reply.urgencyChip === null ? null : (
              <span className={row.reply.emergency ? 'badge badge--error' : 'badge'}>
                {row.reply.urgencyChip}
              </span>
            )}
            {row.reply.hot ? <span className="badge badge--ok">hot</span> : null}
            <span className="muted">received {row.reply.receivedLabel}</span>
          </p>
        </>
      )}

      {/* A SETTLED close replaces the WHOLE controls block (Pitfall 3): a
          closed lead offers no approve link and no second close. */}
      {closeSettled ? (
        <p className="skip-confirm" role="status">
          {closeState.success}
        </p>
      ) : (
        <div className="controls">
          {row.next?.approveHref ? (
            <Link className="button-quiet" href={row.next.approveHref}>
              {APPROVE_TOUCH_LABEL}
            </Link>
          ) : null}
          {row.sheet === undefined ? null : (
            <CreateJobForm
              tenantId={row.tenantId}
              leadId={row.leadId}
              clientName={row.clientName}
              {...row.sheet}
            />
          )}
          <CloseControl
            leadId={row.leadId}
            clientName={row.clientName}
            formAction={closeFormAction}
            pending={closePending}
            state={closeState}
          />
        </div>
      )}
    </article>
  );
}

/**
 * THE TWO-STEP CLOSE (D-01; the queue's `SkipControl` shape).
 *
 * A close is terminal: the lead is never reopened. On a list worked one-handed
 * by thumb, the first tap only asks and the second decides; the consequence
 * sentence sits between them. Quiet, never red — the armed kill on the quote
 * page stays the console's only red control (D-02). No `confirm()` dialog.
 */
function CloseControl({
  leadId,
  clientName,
  formAction,
  pending,
  state,
}: {
  leadId: string;
  clientName: string;
  formAction: (payload: FormData) => void;
  pending: boolean;
  state: ControlState;
}) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <>
        <button type="button" className="button-quiet" onClick={() => setArmed(true)}>
          {CLOSE_STEP_LABEL}
        </button>
        {/* A refusal that did NOT settle the card keeps the control: a retry
            is the right next move. */}
        {state.error === null ? null : (
          <p className="error" role="alert">
            {state.error}
          </p>
        )}
      </>
    );
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="lead_id" value={leadId} />
      <p className="skip-confirm">{closeConsequence(clientName)}</p>
      <button type="submit" className="button-quiet" disabled={pending}>
        {pending ? CLOSE_PENDING_LABEL : CLOSE_CONFIRM_LABEL}
      </button>
      <button
        type="button"
        className="button-quiet"
        disabled={pending}
        onClick={() => setArmed(false)}
      >
        {CLOSE_DISMISS_LABEL}
      </button>
      {state.error === null ? null : (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
