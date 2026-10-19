'use client';

import { DraftCard, type PendingDraft } from '@/app/(console)/components/draft-card';

import { approveDraft, editAndApproveDraft } from './actions';

export type { PendingDraft };

/**
 * THE PER-QUOTE APPROVAL SURFACE (D-12).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE CARD ITSELF NOW LIVES IN components/draft-card.tsx, SHARED WITH THE  │
 * │ CROSS-CLIENT QUEUE (CON-01). What is left here is this surface's own     │
 * │ framing: the heading, the count sentence, and the binding of THIS        │
 * │ page's tenant and quote onto the two server actions.                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The extraction is the UI half of the same decision `src/core/approval/
 * approve-draft.ts` makes about the write path: two surfaces approving the same
 * draft must not be two implementations that happen to agree today. Drift
 * between them — a button that appears on one status here and another status
 * there, a body clamped on one screen — is the CR-02 defect class in the DOM,
 * and it is invisible until an operator meets both screens on the same draft.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────
 *
 * The queue does NOT duplicate the kill switch (D-02): the terminal, irreversible
 * control stays on this page, where the cadence it stops is fully described. The
 * queue's own additions (client name header, skip control) are supplied to the
 * shared card as `header` / `footer`, never by forking it.
 */

export function DraftReview({
  tenantId,
  quoteId,
  drafts,
}: {
  tenantId: string;
  quoteId: string;
  drafts: PendingDraft[];
}) {
  if (drafts.length === 0) return null;

  return (
    <section className="draft-review">
      <h3>Waiting on you</h3>
      <p className="hint muted">
        {drafts.length === 1 ? 'One message is' : `${drafts.length} messages are`} written and
        checked but not sent. Nothing goes out until you approve it — read it as the customer
        will, then approve it or fix it.
      </p>

      {drafts.map((draft) => (
        <DraftCard
          key={draft.draftId}
          draft={draft}
          // BOUND HERE, so the tenant and quote a write lands on come from the
          // page that rendered the row rather than from the form that submits
          // it. The action re-authorizes the tenant anyway (WR-01) — this
          // binding is what stops the ids being in the body at all.
          approveAction={approveDraft.bind(null, tenantId, quoteId)}
          editAction={editAndApproveDraft.bind(null, tenantId, quoteId)}
        />
      ))}
    </section>
  );
}
