/**
 * The status-transition classifier (SYNC-02, RESEARCH Pattern 3).
 *
 * ServiceM8's four job statuses are fixed and cannot be customised per account,
 * so the matrix is CLOSED — twenty (previous, next) pairs plus first sight plus
 * upstream deletion, and that is the whole universe. This function enumerates
 * every one of them. There is no `default` returning null, because a default is
 * how Pitfall 5 happens: transition code gets written for `Quote → Work Order`,
 * a tradie drags a quote straight to Completed, the win never registers, and the
 * only symptom is a recovered-revenue figure that looks slightly low.
 *
 * TWO PLACES THIS DELIBERATELY DIFFERS FROM THE RESEARCH SKELETON, both because
 * the skeleton's answer loses money:
 *
 *   `Work Order → Unsuccessful` and `Completed → Unsuccessful` are **lost**,
 *   not null. A job that was won and then died is a loss, and it is a loss the
 *   service may already have claimed credit for. Returning null would leave
 *   Phase 7 attributing revenue the client never invoiced and Phase 3 with no
 *   signal to stop a cadence.
 *
 *   `Unsuccessful → Work Order | Completed` is **won**. The skeleton restricted
 *   wins to a Quote origin. A written-off quote turning into real work is the
 *   single most valuable thing this product can detect — it is the entire pitch
 *   — and it would have been invisible.
 *
 * WHAT IS NOT DECIDED HERE. A `quote_opened` result is a CANDIDATE. `run-sync`
 * emits it only when the row lands chase-eligible, because a backfilled quote at
 * `needs_review` is not something the cadence engine may act on (D-15). Keeping
 * that gate in the caller is what lets this function stay pure and total.
 */
import type { Sm8Status } from '@/core/servicem8/schemas';
import type { QuoteEventType } from '@/db/schema';

export type { QuoteEventType };

/**
 * Classify one observed change.
 *
 * @param prev  the status we had stored, or `null` for a job we are seeing for
 *              the first time
 * @param next  the status ServiceM8 just reported
 * @param becameInactive  **the EDGE, not the state.** True only on the cycle
 *   where a job we knew as live comes back with `active: 0`.
 *
 *   This distinction is load-bearing and is why the parameter is not named
 *   `nowInactive`. A deleted job keeps returning `active: 0` on every
 *   subsequent poll, so a caller passing the raw flag would emit a fresh
 *   `removed` event every five minutes forever — and the idempotence guarantee
 *   ("the same page twice produces zero new events") would be false. It also
 *   keeps first sight of an already-deleted job silent, which is the
 *   pre-connection-history prohibition applied to deletions.
 */
export function classifyTransition(
  prev: Sm8Status | null,
  next: Sm8Status,
  becameInactive: boolean,
): QuoteEventType | null {
  // Deletion outranks everything else that may have changed in the same cycle.
  // A cadence chasing a job that no longer exists is the most urgent thing this
  // stream can report, and there is a real customer at the other end of it.
  if (becameInactive) return 'removed';

  // ---- First sight -------------------------------------------------------
  //
  // Nothing transitioned while we were watching. Only an open quote produces
  // anything, and even that is a candidate the caller may withhold. Emitting
  // `won` here would credit the service with a job closed before it was hired
  // (the plan's explicit prohibition).
  if (prev === null) {
    return next === 'Quote' ? 'quote_opened' : null;
  }

  if (prev === next) return null;

  switch (next) {
    case 'Quote':
      // Any terminal status dragged back to quoting: the job is live and
      // chaseable again.
      return 'reopened';

    case 'Work Order':
    case 'Completed':
      // A win is a job LEAVING an unwon state. `Work Order → Completed` is
      // progress on a job already counted, and `Completed → Work Order` is a
      // correction — both null, or the same job is counted twice in the report
      // the whole service is sold on.
      return prev === 'Quote' || prev === 'Unsuccessful' ? 'won' : null;

    case 'Unsuccessful':
      // From any other status. See the header for why this is not restricted to
      // a Quote origin.
      return 'lost';
  }
}
