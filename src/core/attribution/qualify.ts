/**
 * What counts as a touch, and when it counts — D-01 and D-02, as one predicate
 * and one filter.
 *
 * ── WHY THIS IS A MODULE AND NOT A `WHERE` CLAUSE ───────────────────────────
 *
 * The same rule has to hold in three places: the consumer that writes an
 * attribution row, the report that lists the jobs, and the instrumentation that
 * computes reply and opt-out rates over "contacts we actually messaged". If the
 * SQL and the TypeScript drift, a client gets a report whose per-job lines do
 * not add up to its own headline — which is not a bug they report, it is a bug
 * they use to stop paying. The predicate is written HERE, in TypeScript, and
 * every SQL body that needs it copies the form documented on `qualifiesAsTouch`
 * verbatim.
 *
 * ── THE SENT MOMENT IS `claimed_at` ─────────────────────────────────────────
 *
 * `send_ledger` HAS NO `sent_at` COLUMN. `claimed_at` is "when the claim was
 * won — i.e. when this row came into existence", written BEFORE the provider
 * call; `outcome` is set after (`src/db/schema/send-ledger.ts`). So the D-01
 * "sent moment" of a qualifying row is its `claimed_at`, and the report's
 * methodology text says "sent (claimed) at" rather than pretending to a
 * precision the ledger does not have. This module reads no other timestamp.
 */
import type { SendLedgerRow } from '@/db/schema';

import { ATTRIBUTION_WINDOW_DAYS } from '@/core/audit/constants';
import { ABOUT_QUOTE_TOUCH_NUMBER } from '@/core/leads/constants';

/**
 * Elapsed milliseconds in a day. The window is elapsed time, NOT calendar days
 * — the `auditWindow` reasoning (`src/core/audit/aggregate.ts`): a DST
 * transition inside the window would otherwise move its edge by an hour
 * depending on where the consumer happened to run.
 */
const DAY_MS = 86_400_000;

/**
 * Exactly the ledger columns attribution is allowed to read.
 *
 * A `Pick`, not the whole row, and that is the point: `to_address` is a
 * customer's mobile number or email, and this shape is what the evidence
 * builder receives. The read in the consumer (07-03) selects exactly these
 * columns, so the address never enters the process that writes a row designed
 * to outlive the cadence.
 */
export type LedgerTouchFields = Pick<
  SendLedgerRow,
  'id' | 'cadenceId' | 'touchNumber' | 'channel' | 'sender' | 'outcome' | 'claimedAt' | 'deliveryStatus'
>;

/**
 * D-02: a real provider accepted it, and no carrier has said otherwise.
 *
 * `sender !== 'stub'` — Phase 3's stub sender logged instead of sending; those
 * rows are excluded forever, by the column, not by a date cutoff.
 * `outcome === 'sent'` — a real provider accepted it. NULL ("we do not know")
 * and `'failed'` and `'stub_sent'` all fail this.
 * `deliveryStatus !== 'undelivered'` — NULL (no receipt has arrived yet),
 * `'delivered'` and `'unknown'` (a receipt came and was unmappable) ALL QUALIFY.
 * D-02: "an SMS with a pending receipt counts". Every email touch is NULL here
 * forever — no receipt exists — so the NULL branch is the common case, not an
 * edge.
 *
 * THE SQL FORM IS `delivery_status IS DISTINCT FROM 'undelivered'`, never
 * `delivery_status <> 'undelivered'`: the plain inequality is NULL — and
 * therefore false — for every email and every pending SMS, which would silently
 * drop most of the qualifying rows in the table.
 */
export function qualifiesAsTouch(
  row: Pick<SendLedgerRow, 'sender' | 'outcome' | 'deliveryStatus'>,
): boolean {
  return row.sender !== 'stub' && row.outcome === 'sent' && row.deliveryStatus !== 'undelivered';
}

/**
 * The qualifying rows whose sent (claimed) moment lies inside the D-01 window.
 *
 * BOTH EDGES INCLUSIVE, for two different reasons:
 *
 *  - The floor (`detectedAt − 30 days`) is inclusive because exactly-at-the-
 *    threshold is INSIDE throughout this codebase (the Phase 2 grace period and
 *    the Phase 3 contact window both do this). A rule whose boundary behaviour
 *    varies by module is a rule nobody can state in a footnote.
 *  - The ceiling (`detectedAt`) is inclusive because a touch sent in the same
 *    millisecond we detected the win is still a touch that preceded it. One
 *    millisecond LATER is not: a message sent after the job was already won
 *    cannot have caused it, and attributing it would be the exact overreach
 *    D-01 exists to prevent.
 *
 * TOUCH 0 NEVER QUALIFIES (12-05, D-17). `ABOUT_QUOTE_TOUCH_NUMBER` is the
 * "about your quote" text sent automatically because the CUSTOMER RANG the
 * tradie. An automatic reply to their own phone call did not chase anyone, so
 * it must never claim the win and put a fee on the client's invoice: a quote
 * won with only a touch-0 row in the window is unqualified. Excluded HERE and
 * not in `qualifiesAsTouch`, whose two SQL twins feed the live metrics and must
 * stay byte-equivalent to it (the about-quote text does count as "sent" there).
 *
 * Sorted by `claimedAt` ascending, ties broken by `touchNumber`, so the
 * evidence chain reads as the conversation happened — and so two runs over the
 * same rows produce byte-identical evidence.
 */
export function qualifyingTouches<T extends LedgerTouchFields>(
  rows: readonly T[],
  wonDetectedAt: Date,
): T[] {
  const ceiling = wonDetectedAt.getTime();
  const floor = ceiling - ATTRIBUTION_WINDOW_DAYS * DAY_MS;

  return rows
    .filter((row) => qualifiesAsTouch(row))
    // The customer rang; the automatic reply to their call claims nothing.
    .filter((row) => row.touchNumber !== ABOUT_QUOTE_TOUCH_NUMBER)
    .filter((row) => {
      const claimedAt = row.claimedAt.getTime();
      return claimedAt >= floor && claimedAt <= ceiling;
    })
    .sort((a, b) => a.claimedAt.getTime() - b.claimedAt.getTime() || a.touchNumber - b.touchNumber);
}
