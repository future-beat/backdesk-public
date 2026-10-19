/**
 * D-13 — the seam Phase 4 swaps an implementation into, and the shape it must
 * find waiting.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS INTERFACE IS THE PHASE 4 CONTRACT. Changing its shape later touches  │
 * │ dispatch, the ledger and the provider gateway simultaneously, which is    │
 * │ why every field Phase 4 needs is here from day one even though the stub   │
 * │ uses none of them.                                                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * FRAMEWORK-FREE ON PURPOSE. Nothing here imports from `next/*` and nothing here
 * reads the database. A sender is handed everything it needs, sends, and answers.
 *
 * ── THE OUTCOME IS A UNION AND NOTHING THROWS ───────────────────────────────
 *
 * A provider refusing a message is an expected answer, not an exception: the
 * ledger has a column for it and the operator has a screen for it. If a send
 * could throw, the `try` would have to live inside the dispatch loop and one
 * client's bad number would abort the whole tick's remaining sends. So the
 * union carries the refusal, and `retryable` carries the only thing a caller
 * can act on — whether asking again could plausibly produce a different answer.
 *
 * `provider` and `providerMessageId` travel from day one because Phase 4's
 * delivery receipts arrive asynchronously and are reconciled against
 * `send_ledger.provider_message_id`. A stub that omitted them would leave the
 * ledger's reconciliation column unreachable from the only code that could
 * populate it.
 *
 * ── WHY THE STUB IS STRUCTURALLY DISTINGUISHABLE, FOREVER ───────────────────
 *
 * `StubSender.provider` is the literal `'stub'`, written into
 * `send_ledger.sender`, and dispatch records `outcome = 'stub_sent'` for it.
 * Phase 7 computes recovered revenue from that ledger and MUST be able to
 * exclude rows that were never actually sent — years later, against rows written
 * today. Putting the distinction in a date range somebody has to remember is how
 * an invoice ends up stapled to proof that is not true. So it lives in the data.
 */
import type { TouchChannel } from '@/db/schema/cadence-templates';

/**
 * Everything a sender needs, and deliberately nothing more.
 *
 * NOTE WHAT IS ABSENT: the tenant's ServiceM8 credentials, the quote's value,
 * the customer's other contact rows. A sender's job is to put one body in front
 * of one address; anything else in this object would be an invitation to make a
 * second decision at the moment the first one has already been made.
 */
export interface SendRequest {
  /** The claimed `send_ledger` row this send belongs to. Written BEFORE the send. */
  ledgerId: string;
  tenantId: string;
  /**
   * The quote a quote touch chases; NULL for a text-back (Phase 12), which
   * belongs to a lead. Exactly one of `quoteId` / `leadId` is set, mirroring
   * `send_ledger_one_owner`. No transport reads either: `ClickSendSender`
   * routes on `ledgerId` alone.
   */
  quoteId: string | null;
  /** The lead a text-back belongs to (Phase 12); NULL on every quote touch. */
  leadId: string | null;
  cadenceId: string;
  touchNumber: number;
  channel: TouchChannel;
  to: {
    /** NORMALIZED — `+614…` for sms, trimmed-lowercase for email. Never raw. */
    address: string;
    contactName: string | null;
  };
  /**
   * Phase 3: deterministic placeholder text (see `stubTouchBody`).
   * Phase 5: the approved draft. Phase 4 does not change this field's meaning —
   * it changes who fills it in.
   */
  body: string;
}

export type SendOutcome =
  | { kind: 'sent'; provider: string; providerMessageId: string | null }
  | { kind: 'failed'; provider: string; reason: string; retryable: boolean };

export interface TouchSender {
  /** Written verbatim into `send_ledger.sender`. `'stub'` | `'clicksend'` | `'resend'`. */
  readonly provider: string;
  send(request: SendRequest): Promise<SendOutcome>;
}

/**
 * MSG-04 / Spam Act — the identification and opt-out every outbound SMS carries.
 *
 * ── WHY THIS IS COMPOSED HERE AND NOT AT THE TRANSPORT ──────────────────────
 *
 * The shared dedicated virtual number cannot identify anybody: it is one number
 * for every client, and ACMA's Sender ID Register makes per-client alphanumeric
 * tags both unusable (they cannot receive the replies this product runs on) and
 * paperwork-per-onboarding. So the sender identification has to be IN THE COPY —
 * 04-CONTEXT.md states exactly that, and `scripts/setup-clicksend.mjs` says the
 * name comes from `tenants.name` unless a `messaging_config.business_name`
 * override exists.
 *
 * It is appended to the BODY rather than by `ClickSendSender` because the
 * transport's documented invariant is that it hands the approved text over
 * unchanged (`tests/clicksend-sender.test.ts` pins a 220-character body
 * byte-identical, and it exists to catch a well-meaning `.slice(0, 160)`).
 * Composing here keeps that true, and puts the compliance envelope in the layer
 * that OWNS the words — which in Phase 5 becomes the drafting path, with this
 * same suffix still appended to whatever Claude wrote.
 *
 * ── GSM-7 ONLY, DELIBERATELY ────────────────────────────────────────────────
 *
 * Every character below is in the GSM 03.38 basic alphabet. An em dash, a middle
 * dot or a curly apostrophe would force the whole message to UCS-2 and halve the
 * segment size from 160 characters to 70 — turning a one-segment follow-up into
 * three, on every message, forever. The business name is the operator's own text
 * and is outside our control; this suffix is not.
 */
export function complianceSuffix(businessName: string): string {
  const name = businessName.trim();
  return name === '' ? 'Reply STOP to opt out.' : `${name}. Reply STOP to opt out.`;
}

/**
 * The Phase 3 message body: deterministic, and obviously not a real follow-up —
 * plus the compliance envelope that a REAL provider makes non-optional.
 *
 * DELIBERATELY NOT PLAUSIBLE COPY. The `[STUB touch N]` prefix exists to prove
 * that a body reaches the sender with the right quote and touch attached, and to
 * keep a log line distinguishable from a real approved draft before Phase 5's
 * approval gate exists.
 *
 * THE SUFFIX IS NOT PART OF THAT PLACEHOLDER, and the distinction matters. The
 * moment the sms `messaging_config` row is armed (D-04), this text stops being a
 * thing that goes nowhere and becomes a commercial electronic message on a real
 * handset — at which point the Spam Act requires the sender to be identified and
 * an unsubscribe facility to be present, whoever wrote the words. So the
 * identification travels with EVERY body this function produces rather than
 * being added at activation time, when nobody is looking at this file.
 */
export function stubTouchBody(input: {
  touchNumber: number;
  quoteId: string | null;
  contactName: string | null;
  /** `tenants.name`, or the `messaging_config.business_name` override. */
  businessName: string;
}): string {
  const who = input.contactName ?? 'customer';
  return (
    `[STUB touch ${input.touchNumber}] follow-up for quote ${input.quoteId} to ${who}. ` +
    complianceSuffix(input.businessName)
  );
}

/**
 * The Phase 3 sender: it records that a send WOULD have happened, and does not.
 *
 * One structured log line per send, carrying the ledger id so a run can be
 * reconciled against the table afterwards. The ADDRESS IS NOT LOGGED — it is a
 * customer's mobile number, it is already recorded in the ledger row behind RLS,
 * and platform logs are the one place in this system with no tenant scoping at
 * all.
 */
export class StubSender implements TouchSender {
  readonly provider = 'stub';

  async send(request: SendRequest): Promise<SendOutcome> {
    console.info(
      `[cadence] stub send ledger=${request.ledgerId} cadence=${request.cadenceId} ` +
        `touch=${request.touchNumber} channel=${request.channel} chars=${request.body.length}`,
    );

    // `providerMessageId: null` rather than a fabricated id: there is no
    // provider and therefore no id, and a synthetic one would eventually be
    // looked up against a real provider's API by Phase 4's reconciliation.
    return { kind: 'sent', provider: this.provider, providerMessageId: null };
  }
}
