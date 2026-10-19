/**
 * `send_ledger`'s delivery columns — the ONLY module that writes them.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE WHERE-MATCH IS THE ENTIRE SECURITY MODEL. THERE IS NO INSERT PATH.   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * A delivery receipt arrives on an unsigned callback whose token travels in a
 * URL, so "somebody else holds it" is a state this file has to survive rather
 * than exclude (T-4-15). What makes it survivable is structural, not
 * behavioural:
 *
 *   • The statement is an UPDATE. Nothing here can create a ledger row, so a
 *     forged receipt cannot invent a send for a customer nobody messaged — and
 *     that is true even if every guard above this file were wrong.
 *   • The predicate is an EXACT MATCH on a key the forger must already know: a
 *     `send_ledger.id` (which we handed ClickSend as `custom_string`) or a
 *     `provider_message_id` (which ClickSend handed us). There is no wildcard,
 *     no prefix and no NULL-matching arm, so a payload with no usable key
 *     updates nothing rather than everything.
 *   • `outcome` IS NOT IN THE SET LIST, and cannot be reached from any caller.
 *     `outcome` answers "did the provider accept this from us"; the delivery
 *     columns answer "did the carrier reach the handset". Folding an
 *     undelivered receipt into `outcome = 'failed'` invites the retry that
 *     messages a customer twice — see the send-ledger schema header, which
 *     states the rule this file is the enforcement of.
 *
 * ── WHY THIS IS ITS OWN FILE AND NOT A `forTenant()` METHOD ─────────────────
 *
 * A receipt arrives before we know whose it is. ClickSend's callback carries a
 * message id and our own ledger id and nothing else — no tenant — so a closure
 * over a tenant scope has nothing to be constructed from. Same shape as
 * `inbound-messages.ts` (04-01) and for the same reason.
 *
 * That is not a tenant-scope escape, because the ONLY way to reach a row here is
 * to already hold its primary key or the provider's id for it. There is no
 * accessor in this file that can enumerate, list, or read a row — the update's
 * `RETURNING` clause is the id it was given back, which tells a caller nothing
 * it did not already supply.
 */
import { eq, sql } from 'drizzle-orm';

import { type DeliveryStatus, sendLedger } from '@/db/schema';

import { getDb } from './client';

/**
 * `send_ledger.id` is a uuid column, so an unvalidated `WHERE id = 'garbage'`
 * is a 22P02 (invalid input syntax) raised INSIDE the webhook handler — and a
 * provider's response to an error is to re-deliver for up to 72 hours and then
 * throttle the rule. A third party controls this value; a shape check on it is
 * not defensive programming, it is the difference between "matched nothing" and
 * "degraded delivery of every other receipt".
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DeliveryReceiptUpdate {
  /** The `send_ledger.id` we sent as `custom_string`. Ignored unless a uuid. */
  ledgerId?: string | null;
  /** ClickSend's own message id, as recorded at send time. */
  providerMessageId?: string | null;
  status: DeliveryStatus;
  /** A CODE, never provider prose — the caller sanitizes. See the schema. */
  detail: string | null;
  /** Set ONLY for a `'delivered'` verdict; NULL for every other. */
  deliveredAt: Date | null;
}

/**
 * Stamp the delivery columns of whichever row this receipt belongs to.
 *
 * Returns the ids it moved — `[]` means "no send matches this receipt", which
 * is a MEANINGFUL ANSWER and not an error: a re-delivered callback for a row
 * we purged, a receipt for another ClickSend sub-account, or a forgery all land
 * here, and all three are correctly a no-op.
 *
 * ── ONE KEY OR THE OTHER, AND `ledgerId` WINS ───────────────────────────────
 *
 * The two predicates are deliberately NOT OR-ed together. A payload naming one
 * row by `custom_string` and a DIFFERENT row by `message_id` would, under an
 * `OR`, annotate two clients' sends from one callback. `custom_string` is the
 * value WE generated and handed to the provider, so where it is present and
 * well-formed it is authoritative; `provider_message_id` is the fallback for a
 * receipt that echoes only ClickSend's own id.
 *
 * ── IDEMPOTENT BY CONSTRUCTION (T-4-16) ─────────────────────────────────────
 *
 * A re-delivered callback re-applies the same values and moves only
 * `delivery_updated_at`, which is exactly what that column is for: it answers
 * "how long ago did we last hear anything", which is our clock's question, not
 * the provider's. `now()` is the DATABASE's clock rather than the serverless
 * function's — a receipt processed on an instance with a skewed clock must not
 * be able to claim it arrived tomorrow.
 */
export async function updateDeliveryWhereMatch(
  input: DeliveryReceiptUpdate,
): Promise<{ id: string }[]> {
  const ledgerId = input.ledgerId && UUID_RE.test(input.ledgerId) ? input.ledgerId : null;
  const providerMessageId = input.providerMessageId || null;

  const predicate = ledgerId
    ? eq(sendLedger.id, ledgerId)
    : providerMessageId
      ? eq(sendLedger.providerMessageId, providerMessageId)
      : null;

  // NO PREDICATE MEANS NO STATEMENT. A `WHERE true` reached by an empty payload
  // would stamp every row in the table — every client's — from one callback.
  if (!predicate) return [];

  return getDb()
    .update(sendLedger)
    .set({
      deliveryStatus: input.status,
      deliveryDetail: input.detail,
      // Overwritten rather than preserved, deliberately: the newest receipt is
      // the current truth about this message, and a `delivered_at` surviving a
      // later `undelivered` verdict would be a delivery time for a
      // non-delivery.
      deliveredAt: input.deliveredAt,
      deliveryUpdatedAt: sql`now()`,
    })
    .where(predicate)
    .returning({ id: sendLedger.id });
}
