'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';

import {
  BLANK_CONTROL_STATE,
  type ControlState,
} from '@/app/(console)/components/action-state';
import { DraftCard, type PendingDraft } from '@/app/(console)/components/draft-card';
// A LEAF MODULE — `stall-policy.ts` imports nothing at all (source-asserted in
// `tests/stall-policy.test.ts`), so pulling its label map into a client bundle
// costs one object. The TIER itself is computed on the server, from the render's
// single `now`; only the words come from here.
import { URGENCY_LABELS, type UrgencyTier } from '@/core/aging/stall-policy';

import {
  SKIP_CONFIRM_LABEL,
  skipConsequence,
  SKIP_DISMISS_LABEL,
  SKIP_PENDING_LABEL,
  SKIP_STEP_LABEL,
} from './action-state';
import { approveFromQueue, editAndApproveFromQueue, skipFromQueue } from './actions';
// One number, two surfaces (15-04): the lead card's `Next: #n of 3` reads it too.
import { LEAD_TOUCH_COUNT } from '../leads/action-state';

/**
 * One card on the cross-client queue.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE CARD IS `components/draft-card.tsx`, UNCHANGED. This file supplies   │
 * │ only what is TRUE OF THIS SURFACE and not of the quote page: whose       │
 * │ client this is, and a link back to the quote where the full control      │
 * │ surface (including the kill switch, D-02) lives.                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The tenant is BOUND onto the actions here, from the row the server read
 * returned — never submitted in the form. A forged body naming another client's
 * draft therefore changes nothing twice over: the binding decides which tenant
 * is authorized, and the core re-reads the draft under `forTenant(that tenant)`,
 * where another client's draft id matches nothing.
 *
 * THE QUOTE ID IS BOUND THE SAME WAY, AND FOR ONE REASON (WR-04): the action
 * has to revalidate `/clients/{tenant}/quotes/{quote}` — the page the "Open the
 * quote" link three lines below sends the operator to. Without it the card
 * cleared here kept offering an approve button over there, which is the exact
 * failure `revalidateQueue`'s own comment describes. It carries NO authority:
 * the tenant binding is still the only thing `authorize` acts on.
 *
 * A LEAD CARD (Phase 13) has no quote: its quote id is NULL, it reads "Missed
 * call · touch N of 3", and it offers NO quote link anywhere — there is no
 * quote page to open. The actions are bound to the null id unchanged, and
 * `revalidateQueue`'s UUID guard is what stops a `/quotes/null` path being
 * built from it.
 */

export type QueueCardRow = {
  /**
   * THE ROW'S IDENTITY, and the list key.
   *
   * Not the draft id: a `needs_draft` touch has no draft, and two of them for
   * one client would collide on any tenant-derived key — React would then reuse
   * one card's edit-box state on the other, which on this screen means typing
   * into a message about a different customer.
   */
  touchId: string;
  tenantId: string;
  /** Resolved under the OPERATOR's RLS; 'Another client' when unresolvable. */
  clientName: string;
  /** NULL on a lead card (Phase 13) — there is no quote to link to. */
  quoteId: string | null;
  /** One of CADENCE_KINDS; `'lead'` is a missed caller's follow-up. */
  kind: string;
  /** The lead a lead card chases; NULL on a quote card. */
  leadId: string | null;
  touchNumber: number;
  channelLabel: string;
  /** Already rendered in the CLIENT's zone, with the zone named. */
  slotLabel: string;
  /** Zone-free, and always BESIDE the absolute time, never instead of it. */
  relativeLabel: string;
  /**
   * The tier, DERIVED ON THE SERVER by `deriveUrgency` from the render's one
   * clock. Passed in rather than computed here so the badge, the stall alert
   * and the nav count are three renderings of one answer (D-12).
   */
  urgency: UrgencyTier;
  quoteDescription: string | null;
  /** 05-04's deterministic-failure count — why a no-draft card is stuck. */
  draftFailures: number;
  /** `draftFailures` has reached `MAX_DRAFT_FAILURES`: nothing will retry it. */
  draftingGaveUp: boolean;
  /** `null` for a `needs_draft` touch that has produced no attempt yet. */
  draft: PendingDraft | null;
};

/**
 * Tier → badge class, as a MAP (06-UI-SPEC Colour, house rule).
 *
 * `Record<UrgencyTier, …>` rather than a switch with a default: a tier added to
 * `UrgencyTier` without a class here is a COMPILE error, where a default arm
 * would silently paint it neutral — and a new tier is added precisely because
 * somebody wanted it to look different.
 *
 * `overdue` is the only `--error` on this screen and it is a STATE, not a
 * control: the armed kill on the quote page remains the only red thing an
 * operator can press (D-02).
 */
const URGENCY_BADGE_CLASS: Record<UrgencyTier, string> = {
  overdue: 'badge badge--error',
  due_soon: 'badge badge--warn',
  scheduled: 'badge',
};

export function QueueCard({ row }: { row: QueueCardRow }) {
  /**
   * A lead card has no quote page (Phase 13). The quote href is computed only
   * for a quote card, so no `/quotes/null` link can be rendered.
   */
  const quoteHref =
    row.kind !== 'lead' && row.quoteId !== null
      ? `/clients/${row.tenantId}/quotes/${row.quoteId}`
      : null;

  /**
   * THE SKIP LIVES HERE, NOT INSIDE THE CONTROL (D-02).
   *
   * `useActionState` is held by the card rather than by `SkipControl` because
   * its outcome decides something ABOVE the control: a settled skip must take
   * the approve and edit buttons away too, and a component that owned its own
   * state could only report that upward through a callback and a second copy of
   * the same boolean.
   */
  const [skipState, skipFormAction, skipPending] = useActionState(
    skipFromQueue.bind(null, row.tenantId, row.quoteId),
    BLANK_CONTROL_STATE,
  );
  const skipSettled = skipState.settled === true;

  /**
   * THE LEAD QUEUE DEEP-LINKS HERE (15-04, D-01): a lead card's `Approve the
   * next touch →` is `/queue#touch-{id}`. On BOTH arms — a `needs_draft`
   * touch renders the no-draft article below, a `pending_approval` one the
   * shared card — or the link lands at the top of the page.
   */
  const anchorId = `touch-${row.touchId}`;

  const skipControl = (
    <SkipControl
      touchId={row.touchId}
      touchNumber={row.touchNumber}
      formAction={skipFormAction}
      pending={skipPending}
      state={skipState}
    />
  );

  /**
   * CLIENT NAME + URGENCY, AS ONE STACKING UNIT (05-08's `.touch-when--stack`).
   *
   * Reused verbatim rather than forked: below 22.5rem the pair takes a full row
   * and the badge relaxes `white-space: nowrap`, so a long pill wraps INSIDE an
   * intact border instead of running out of both ends of it. That rule already
   * exists for the inbox's classification pills and is the same problem — a
   * pill next to a name that is longer than the viewport.
   */
  const header = (
    <span className="touch-when touch-when--stack">
      <strong>{row.clientName}</strong>
      <span className={URGENCY_BADGE_CLASS[row.urgency]}>{URGENCY_LABELS[row.urgency]}</span>
    </span>
  );

  const meta = (
    <p className="touch-meta muted">
      <strong>#{row.touchNumber}</strong> {row.channelLabel} · {row.slotLabel} ·{' '}
      {row.relativeLabel}
      {quoteHref === null ? (
        <>
          {' · '}
          {/* A MISSED CALLER, NOT A QUOTE: no description and no link. */}
          <span>
            Missed call · touch {row.touchNumber} of {LEAD_TOUCH_COUNT}
          </span>
        </>
      ) : row.quoteDescription ? (
        <>
          {' · '}
          {/* ONE LINE, with the full text on `title` and on the quote page. The
              body below is never truncated; a job description is not the thing
              being approved, and a three-line description above the message
              pushes the message off a 390px screen. */}
          <Link className="cell-truncate" href={quoteHref} title={row.quoteDescription}>
            {row.quoteDescription}
          </Link>
        </>
      ) : (
        <>
          {' · '}
          <Link href={quoteHref}>Open the quote</Link>
        </>
      )}
    </p>
  );

  /**
   * ── THE 05-04 GAP, RENDERED HONESTLY (Pitfall 4) ──────────────────────────
   *
   * A touch can sit in `needs_draft` with NO draft row at all: a deterministic
   * API refusal (400/401/403) produces no model output, so nothing is recorded
   * except the failure counter. The queue's population rule is keyed on the
   * TOUCH precisely so those rows are visible — a queue built from draft rows
   * would be blind to exactly the touches that are stuck, which is the state
   * CON-04's stall alert is about.
   *
   * There is nothing to approve, so there is no approve button and no edit box:
   * offering either would be a tap the server refuses. What there IS, is the
   * skip — a touch nobody can draft is exactly one an operator may want to take
   * off the schedule — and a link to the quote.
   *
   * ── AND THE COUNT IS SAID, WITH WHAT IT MEANS ──────────────────────────────
   *
   * `draft_failures` is not decoration. Below the ceiling the engine will try
   * again and the card is reporting a delay; AT the ceiling `listNeedsDraft`
   * has stopped offering this touch entirely, so nothing will ever be written
   * for it and the card is asking for a decision. Saying "it will keep trying"
   * in the second case is the kind of true-yesterday sentence that leaves a
   * message unsent for six weeks.
   */
  if (row.draft === null) {
    return (
      <article className="draft-card" id={anchorId}>
        <div className="row">
          {header}
          <span className="badge badge--warn">no draft yet</span>
        </div>
        {meta}
        <p className="touch-meta muted">
          Drafting hasn’t produced a message for this touch
          {row.draftFailures > 0
            ? ` — ${row.draftFailures} attempt${row.draftFailures === 1 ? '' : 's'} failed`
            : ''}
          .{' '}
          {quoteHref === null
            ? row.draftingGaveUp
              ? 'It has stopped trying, so nothing will be written for it. Skip it.'
              : 'It will keep trying; you can skip it.'
            : row.draftingGaveUp
              ? 'It has stopped trying, so nothing will be written for it. Skip it, or open the quote and fix what the drafting refused.'
              : 'It will keep trying; you can skip it or open the quote.'}
        </p>
        <div className="controls">
          {skipControl}
          {quoteHref === null ? null : (
            <Link className="button-quiet" href={quoteHref}>
              Open the quote
            </Link>
          )}
        </div>
      </article>
    );
  }

  return (
    <DraftCard
      anchorId={anchorId}
      draft={row.draft}
      header={header}
      meta={meta}
      approveAction={approveFromQueue.bind(null, row.tenantId, row.quoteId)}
      editAction={editAndApproveFromQueue.bind(null, row.tenantId, row.quoteId)}
      settled={skipSettled}
      footer={skipControl}
    />
  );
}

/**
 * THE TWO-STEP SKIP (D-02, UI-SPEC Screens §1).
 *
 * ── WHY TWO STEPS, AND WHY NOT AN ARM-THEN-CONFIRM ──────────────────────────
 *
 * A skip is terminal for the touch it names: `skipped` is a terminal status and
 * nothing re-drafts it. On a list worked one-handed by thumb, a single-tap
 * terminal control beside an approve button is a mis-tap waiting to happen. So
 * the first tap only asks, and the second decides.
 *
 * It is deliberately NOT the kill switch's arm-then-confirm-in-red. The kill
 * stops a whole cadence for a whole quote and is the console's only red control
 * on purpose (D-02) — spending `--error` on a per-touch skip would teach the eye
 * that red means "a button you press quite often".
 *
 * ── THE PAIR READS AS SKIP-VS-KEEP, AND EACH SIDE STATES ITS OUTCOME ────────
 *
 * `Skip it` / `Keep it`, not `Confirm` / `Cancel`: those two describe what
 * happens to the confirm row, and the operator's question is what happens to the
 * message. The sentence above them says both halves — this one is gone, the rest
 * of the cadence is not — because an operator who reads "skip" as "stop" reaches
 * for the wrong control next time.
 */
function SkipControl({
  touchId,
  touchNumber,
  formAction,
  pending,
  state,
}: {
  touchId: string;
  touchNumber: number;
  formAction: (payload: FormData) => void;
  pending: boolean;
  state: ControlState;
}) {
  const [armed, setArmed] = useState(false);

  /**
   * THE HONEST OUTCOME, IN PLACE OF THE CONTROL (Pitfall 3).
   *
   * A settled skip — it landed, or it moved nothing because somebody else acted
   * on this touch first — replaces the buttons with the sentence. Leaving a
   * `Skip this message` button under "This one was already approved." invites a
   * second tap on a write that will answer identically.
   */
  if (state.settled === true) {
    return (
      <p className="skip-confirm" role={state.error === null ? 'status' : 'alert'}>
        {state.error ?? state.success}
      </p>
    );
  }

  if (!armed) {
    return (
      <>
        <button type="button" className="button-quiet" onClick={() => setArmed(true)}>
          {SKIP_STEP_LABEL}
        </button>
        {/* A refusal that did NOT settle the row (a bad request, an expired
            session) still has to be readable — the control stays, because
            retrying is the right next move. */}
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
      <input type="hidden" name="touch_id" value={touchId} />
      <p className="skip-confirm">{skipConsequence(touchNumber)}</p>
      <button type="submit" className="button-quiet" disabled={pending}>
        {pending ? SKIP_PENDING_LABEL : SKIP_CONFIRM_LABEL}
      </button>
      <button
        type="button"
        className="button-quiet"
        disabled={pending}
        onClick={() => setArmed(false)}
      >
        {SKIP_DISMISS_LABEL}
      </button>
    </form>
  );
}
