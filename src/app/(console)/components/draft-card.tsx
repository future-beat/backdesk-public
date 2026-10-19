'use client';

import { type ReactNode, useActionState, useState } from 'react';

import { countSeptets, segmentCount } from '@/core/drafting/gsm7';

// WR-10: the ONE outcome renderer. This file used to declare its own `Message`
// beside `cadence-controls.tsx`'s — two components under one name, over one
// shared state type — and the local copy silently dropped `state.fixes`.
import { ActionMessage } from './action-message';
import {
  BLANK_CONTROL_STATE,
  type ControlState,
  describeDraftViolation,
  type DraftViolationView,
  EDITED_BODY_MAX,
} from './action-state';

/**
 * THE D-12 REVIEW GATE, as the operator's thumb meets it — ON EVERY SURFACE.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ NOTHING AI-WRITTEN REACHES A CUSTOMER WITHOUT PASSING THROUGH THIS CARD. │
 * │ A touch sits at `pending_approval` until somebody taps here; dispatch    │
 * │ refuses anything without an approved draft, and the tick cannot approve. │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── WHY THIS IS A SHARED COMPONENT AND NOT TWO GOOD-LOOKING COPIES ──────────
 *
 * Phase 6 gives the same draft two homes: the quote page (where the cadence
 * controls live) and the cross-client queue (CON-01). The UI-SPEC's component
 * reuse mandate says why they are one component rather than two: "Two approval
 * surfaces rendering the same draft must be pixel-identical in the parts they
 * share, for the same reason the action core is shared: drift between them is
 * the CR-02 defect class, in the DOM."
 *
 * Concretely, these are the parts that must not drift: which control exists on
 * which draft status, whether the body is ever truncated, what the buttons say,
 * and what the live segment count is measured with. Each of those is a rule with
 * a server-side counterpart, and a screen that disagrees with the server offers
 * a tap the server refuses.
 *
 * ── WHAT EACH SURFACE SUPPLIES, AND WHAT IT MAY NOT ─────────────────────────
 *
 * The `approveAction` / `editAction` props are ALREADY-BOUND server actions —
 * the quote page binds its tenant and quote, the queue binds the tenant the row
 * came from. That is the only difference between the two renderings that is
 * allowed to exist below the header, and it is a difference in WHO is written
 * to, never in WHAT is checked: both bindings land in the same
 * `src/core/approval/approve-draft.ts`.
 *
 * `header` and `footer` are the surface's own furniture (a client name, a link
 * back to the quote, the 06-03 skip control). Neither may be used to hide,
 * clamp or replace the body or the controls.
 *
 * ── THE BODY IS SHOWN AS IT WILL SEND, IN MONOSPACE, INCLUDING THE SUFFIX ───
 *
 * `final_body` is the frozen column dispatch reads verbatim — not the model's
 * raw output, not a preview, not a re-render. The compliance line is part of
 * what is displayed because it is part of what is sent, and an operator judging
 * length or tone without it is judging a different message. Monospace because
 * this is a string being approved character by character: the whole reason the
 * validator exists is that `$2,450` and `$2,540` look alike at a glance, and a
 * proportional font makes them look more alike.
 *
 * IT IS NEVER TRUNCATED, CLAMPED OR COLLAPSED. The full-review invariant made
 * physical (D-03): every approve tap has the whole body on screen.
 *
 * ── A FAILED DRAFT RENDERS NO APPROVE-UNCHANGED BUTTON (D-11) ───────────────
 *
 * And that absence is a courtesy, NOT the enforcement. The core refuses a
 * `validator_failed` attempt server-side, because a Server Action id is POSTable
 * without rendering anything at all. What the missing button buys is that the
 * operator is never offered a tap the server would refuse.
 */

export type PendingDraft = {
  draftId: string;
  touchId: string;
  touchNumber: number;
  /** Already formatted in the CLIENT's zone by the page. See its header. */
  scheduledLabel: string;
  channelLabel: string;
  /** The frozen `final_body` — the exact bytes dispatch will send. */
  finalBody: string;
  /** `generated` (clean) or `validator_failed` (edit-only). */
  status: string;
  /** As the validator measured it. `null` on a failed attempt. */
  segments: number | null;
  /**
   * The exact model recorded on the row, never a constant re-read at render
   * time. The question this answers is which model wrote THIS text, and the
   * project's model choice has already changed once by operator direction.
   */
  model: string;
  attempt: number;
  violations: DraftViolationView[];
};

/** A bound server action, as `useActionState` will call it. */
export type BoundDraftAction = (
  previous: ControlState,
  formData: FormData,
) => Promise<ControlState>;

export function DraftCard({
  draft,
  approveAction,
  editAction,
  header,
  meta,
  footer,
  settled,
  anchorId,
}: {
  draft: PendingDraft;
  /** Bound by the surface. Lands in the SAME approval core either way. */
  approveAction: BoundDraftAction;
  editAction: BoundDraftAction;
  /**
   * The surface's own top-of-card line, rendered beside the status badge.
   * Defaults to this card's own touch/channel/slot meta when absent.
   */
  header?: ReactNode;
  /**
   * An extra line between the header row and the body — the queue's
   * touch/slot/quote meta, which the quote page already has in its header.
   * It may add context; it may never replace or clamp the body below it.
   */
  meta?: ReactNode;
  /**
   * Rendered last inside `.controls` — the skip control's home (06-03).
   *
   * It is rendered whether or not the approve/edit controls are, because the
   * footer owns its OWN outcome message: a settled skip must be able to say so
   * on a card whose other controls have already gone.
   */
  footer?: ReactNode;
  /**
   * THE SURFACE'S OWN "there is nothing left to do to this row" (06-03).
   *
   * Set by the queue when its skip settles. `state.settled` below covers the
   * card's own two actions; this covers an action the surface owns and the card
   * knows nothing about. Either one takes the approve and edit controls away.
   */
  settled?: boolean;
  /**
   * The article's `id`, when a surface is deep-linked into (15-04: the lead
   * queue links `/queue#touch-{id}`). Absent renders no attribute — the quote
   * page passes none.
   */
  anchorId?: string;
}) {
  const [approveState, approveFormAction, approvePending] = useActionState(
    approveAction,
    BLANK_CONTROL_STATE,
  );
  const [editState, editFormAction, editPending] = useActionState(
    editAction,
    BLANK_CONTROL_STATE,
  );

  /**
   * Which of the two forms last answered — the same single-slot rule the cadence
   * controls state at length. Two `useActionState` hooks retain their results
   * independently and neither clears the other, so unconditional messages would
   * stack a stale "Approved" above a fresh refusal.
   */
  const [last, setLast] = useState<'approve' | 'edit' | null>(null);
  const state =
    last === 'approve' ? approveState : last === 'edit' ? editState : BLANK_CONTROL_STATE;

  /**
   * The edit box is OPT-IN, and closed by default.
   *
   * The common case is reading a message and approving it. An always-open
   * textarea pre-filled with the draft turns that into "scroll past the edit
   * box to find the button", and — worse — invites an accidental keystroke into
   * text that is about to be sent in somebody else's name.
   */
  const [editing, setEditing] = useState(draft.status === 'validator_failed');

  const failed = draft.status === 'validator_failed';

  return (
    <article className="draft-card" id={anchorId}>
      <div className="row">
        {header ?? (
          <p className="meta">
            <strong>#{draft.touchNumber}</strong> {draft.channelLabel} · {draft.scheduledLabel}
          </p>
        )}
        <span className={failed ? 'badge badge--error' : 'badge badge--warn'}>
          {failed ? 'failed the fact check' : 'awaiting approval'}
        </span>
      </div>

      {meta}

      <ActionMessage state={state} />

      {/* THE BYTES, AS THEY WILL SEND. `pre` rather than `p` so a line break the
          model wrote is a line break the operator sees — the customer will. */}
      <pre className="draft-body">{draft.finalBody}</pre>

      <p className="touch-meta muted">
        {draft.segments === null
          ? 'Length not measured — this draft did not pass the check.'
          : `${draft.segments} SMS segment${draft.segments === 1 ? '' : 's'}`}
        {' · '}
        {draft.model}
        {draft.attempt > 1 ? ` · attempt ${draft.attempt}` : ''}
      </p>

      {failed ? (
        <div className="draft-violations">
          {/* NAMED, EVERY ONE. "This draft failed" tells the operator nothing
              they can act on; the rule and the offending fragment tell them
              exactly which characters to change. */}
          <p className="kill-warning" role="alert">
            The fact check refused this message, so it cannot be sent as written. Fix it below and
            approve your version.
          </p>
          <ul className="touch-list">
            {draft.violations.map((violation, index) => (
              <li key={`${violation.rule}-${index}`}>
                <span className="touch-meta">{describeDraftViolation(violation)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="controls">
        {/* ── THE ROW HAS LEFT THE OPERATOR'S HANDS (06-03) ────────────────
            Approved here, approved by somebody else while this card sat on
            screen, or skipped through the footer. The outcome sentence is
            already rendered above by `Message` (or by the footer); what must
            not remain is a button whose only possible answer is that same
            sentence again. The absence is a courtesy — every one of these
            writes is guarded server-side — but a control that cannot do
            anything is a control that teaches the operator to distrust the
            screen. ── */}
        {settled === true || state.settled === true ? null : (
          <>
            {/* ── The approve-unchanged control. ABSENT on a failed draft,
                matching the server-side refusal — see the header. ── */}
            {failed ? null : (
              <form action={approveFormAction}>
                <input type="hidden" name="draft_id" value={draft.draftId} />
                <input type="hidden" name="touch_id" value={draft.touchId} />
                <button type="submit" disabled={approvePending} onClick={() => setLast('approve')}>
                  {approvePending ? 'Approving…' : 'Approve and send as written'}
                </button>
              </form>
            )}

            {editing ? (
              <EditForm
                draft={draft}
                formAction={editFormAction}
                pending={editPending}
                onSubmit={() => setLast('edit')}
                onCancel={failed ? null : () => setEditing(false)}
              />
            ) : (
              <button type="button" onClick={() => setEditing(true)}>
                Edit this message
              </button>
            )}
          </>
        )}

        {footer}
      </div>
    </article>
  );
}

function EditForm({
  draft,
  formAction,
  pending,
  onSubmit,
  onCancel,
}: {
  draft: PendingDraft;
  formAction: (payload: FormData) => void;
  pending: boolean;
  onSubmit: () => void;
  /** `null` on a failed draft: there is nothing to go back to. */
  onCancel: (() => void) | null;
}) {
  /**
   * PRE-FILLED WITH THE WHOLE `final_body`, opt-out line included.
   *
   * The operator is editing the message, not composing a new one, and an empty
   * box asks them to retype from memory on a phone. Including the compliance
   * line is what makes the server's `missing_suffix` rule fair: it is on screen,
   * it is theirs to keep, and deleting it is a decision rather than an
   * omission — which the action then refuses.
   */
  const [body, setBody] = useState(draft.finalBody);

  /**
   * The live count, so the two-segment refusal is met BEFORE the tap.
   *
   * `countSeptets` is the same pure function the server-side validator uses, so
   * this number and the one that decides the refusal cannot disagree. A UCS-2
   * flip (an emoji, a curly dash) is reported as what it is rather than as a
   * segment count, because septet arithmetic does not apply to a message that is
   * not being sent as septets — and that flip is what triples the price.
   */
  const counted = countSeptets(body);
  const segments = counted.encoding === 'gsm7' ? segmentCount(counted.septets) : null;

  return (
    <form action={formAction}>
      <input type="hidden" name="draft_id" value={draft.draftId} />
      <input type="hidden" name="touch_id" value={draft.touchId} />

      <label htmlFor={`edited-${draft.draftId}`}>Your version</label>
      <textarea
        id={`edited-${draft.draftId}`}
        name="edited_body"
        className="draft-body"
        rows={6}
        required
        maxLength={EDITED_BODY_MAX}
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />

      <p className="hint muted" aria-live="polite">
        {segments === null
          ? `Contains characters that cannot be sent as a plain SMS (${counted.encoding === 'ucs2' ? counted.unsupported.join(' ') : ''}) — it will be refused.`
          : `${segments} SMS segment${segments === 1 ? '' : 's'}${segments > 2 ? ' — over the two-segment limit, this will be refused' : ''}`}
      </p>
      <p className="hint muted">
        Prices and dates are still checked against the quote after you edit — a figure this job
        does not have will be refused, and the opt-out line has to stay.
      </p>

      <button type="submit" disabled={pending} onClick={onSubmit}>
        {pending ? 'Approving…' : 'Approve my version'}
      </button>
      {onCancel === null ? null : (
        <button type="button" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
      )}
    </form>
  );
}

