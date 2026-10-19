/**
 * D-15: the human gate between "synced" and "chased".
 *
 * A newly connected client's 90-day backfill is a pile of history, not a work
 * queue. Some of those quotes were declined over the phone in June, some were
 * won off-system, and some belong to a customer the tradie would rather never
 * hear from us. Chasing them because they happen to be `status = 'Quote'` is
 * the fastest available way to lose a design partner, and no follow-up copy is
 * good enough to undo it.
 *
 * So nothing in this codebase makes a backfilled quote chase-eligible except
 * this function, and this function only ever runs because an operator ticked a
 * box and pressed Save. That is the entire product argument for the white-glove
 * service: a human looked at the list first.
 *
 * FRAMEWORK-FREE ON PURPOSE. Nothing here imports from `next/*`. The rule this
 * module encodes is a fact about the business, not about a form — the CSV path
 * (02-06) and any later bulk tool must be able to reach the same guarantee
 * without going through a React server action.
 *
 * WHAT THE CALLER MUST STILL DO: authorize. This function scopes writes to the
 * tenant it is given; it has no opinion about whether the caller is entitled to
 * that tenant. `saveEligibilityAction` performs the membership check (WR-01,
 * T-2-13) before it gets here.
 */
import { FIRST_SIGHT } from '@/db/schema/quote-events';
import { forTenant, type QuoteStatusEventInsert } from '@/db/repository';

export interface MarkChaseEligibleResult {
  /** Rows that actually moved from `needs_review` to `eligible`. */
  flipped: number;
  /** `quote_opened` rows written. Equal to `flipped`, by construction. */
  eventsEmitted: number;
}

/**
 * Flip the named quotes to chase-eligible and announce each one exactly once.
 *
 * THE TWO WRITES ARE ONE TRANSACTION, and that co-commit is the whole
 * guarantee (SYNC-02). A quote that is eligible in our mirror with no
 * `quote_opened` in the outbox is a quote the operator approved and nobody ever
 * chases — silent, and invisible until the client asks why. An event with no
 * flip is the opposite failure: the cadence engine starts on a quote the
 * console still shows as awaiting review.
 *
 * ONLY ROWS THAT ACTUALLY FLIPPED GET AN EVENT. The emission is driven by the
 * UPDATE's own RETURNING, not by the caller's id list, so an id that was
 * already eligible, belongs to a won job, or belongs to another tenant
 * contributes nothing — which is what makes a re-saved form a no-op rather than
 * a duplicate announcement (T-2-11).
 *
 * `occurred_at` CARRIES THE QUOTE'S SERVICEM8 ISSUE DATE, NOT now(), AND IT IS
 * NOT THE CADENCE ANCHOR. It is kept for Phase 7 attribution honesty — the
 * report must be able to say how old a quote already was when the service
 * started chasing it, and now() would erase that.
 *
 * D-01 fixes the Phase 3 anchor at the DETECTION MOMENT instead: `detected_at`,
 * i.e. when we noticed the quote became chase-eligible. The difference is the
 * whole point. A quote issued in June and triaged today would, anchored on
 * `occurred_at`, materialize a schedule whose first three touches are already
 * weeks overdue; the staleness cap would skip every one of them and the cadence
 * would expire without a single message — indistinguishable from the outside
 * from a cadence that ran. See `cadences.anchor_at` in
 * src/db/schema/cadences.ts and the consumer in
 * src/core/cadence/consume-events.ts, which both say the same thing.
 */
export async function markChaseEligible(
  tenantId: string,
  quoteIds: readonly string[],
): Promise<MarkChaseEligibleResult> {
  if (quoteIds.length === 0) {
    return { flipped: 0, eventsEmitted: 0 };
  }

  // Duplicates in the submitted list would make `flipped` and the id count
  // disagree for no interesting reason; the UPDATE would flip once regardless.
  const unique = [...new Set(quoteIds)];

  return forTenant(tenantId).transaction(async (tx) => {
    const flipped = await tx.quotes.updateEligibilityWhereNeedsReview(unique);
    if (flipped.length === 0) {
      return { flipped: 0, eventsEmitted: 0 };
    }

    const events: QuoteStatusEventInsert[] = flipped.map((quote) => ({
      quoteId: quote.id,
      sm8JobUuid: quote.sm8JobUuid,
      // We never watched this quote transition INTO `Quote` — it was already
      // open when the client connected. `(new)` is the honest from-status; a
      // fabricated 'Quote' → 'Quote' would tell Phase 7 we saw something we
      // did not.
      fromStatus: FIRST_SIGHT,
      toStatus: 'Quote',
      eventType: 'quote_opened',
      occurredAt: quote.quoteDateUtc,
    }));

    const eventsEmitted = await tx.events.insertMany(events);

    return { flipped: flipped.length, eventsEmitted };
  });
}
