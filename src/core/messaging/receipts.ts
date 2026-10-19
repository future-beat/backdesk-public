/**
 * Delivery receipts (MSG-01, second half): what a provider later said happened
 * to a message it had already accepted.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A RECEIPT IS A NEW FACT ABOUT A SEND, NEVER A NEW OUTCOME.               │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `send_ledger.outcome` answers "did the provider accept this from us" and is
 * written once, by dispatch, at send time. `delivery_status` answers "did the
 * carrier get it to the handset" and arrives minutes to hours later on a
 * callback we do not control. Nothing in this file can reach `outcome` —
 * `updateDeliveryWhereMatch` does not list it — because folding an undelivered
 * receipt back into `failed` erases the fact that we DID send it, and the
 * obvious follow-up for a failed send is to try again, which is how a customer
 * gets messaged twice for a message a carrier merely could not confirm.
 *
 * ── THE HINT, NOT THE GUARANTEE (SYNC-03's split, applied to messaging) ─────
 *
 * This is the webhook path and it is allowed to miss. `reconcile.ts` polls
 * ClickSend's history daily and applies whatever it finds THROUGH THIS SAME
 * FUNCTION, so a dropped callback is recovered without a second copy of the
 * mapping rules below. That is why nothing here retries, queues or alerts: a
 * receipt we never see costs a column that stays NULL until the sweep runs.
 *
 * ── THE PAYLOAD SHAPE WAS RESEARCH; IT IS NOW OBSERVED, AND IT DIFFERED ─────
 *
 * [CITED: research A1 — assumed DLR fields `timestamp_send`, `timestamp`,
 * `message_id`, `status_code`, `status_text`, `error_code`, `error_text`,
 * `custom_string`.] Those fields are all real. What the research did not say,
 * and what the first two live sends showed on 2026-08-30, is that ClickSend
 * populates `error_code` AND `error_text` on a SUCCESSFUL delivery — see
 * `classify`, which used to treat their presence as dispositive and therefore
 * recorded every delivered message as `undelivered`.
 *
 * The tolerance was right and is kept: the schema hard-requires only that AT
 * LEAST ONE ROUTING KEY be present and passes everything else through, because
 * a strict schema would turn "ClickSend added a field" into "every receipt is
 * discarded". What the tolerance could not do was save a CLASSIFICATION rule
 * built on a guess about which fields mean what.
 *
 * ── THE TIMESTAMP UNIT IS THE LEAST CERTAIN THING HERE ──────────────────────
 *
 * Values below `MS_BOUNDARY` (1e11) are read as epoch SECONDS and everything at
 * or above it as MILLISECONDS. 1e11 seconds is the year 5138 and 1e11
 * milliseconds is 1973, so no plausible send time is ambiguous under that rule.
 * CONFIRMED 2026-08-30, on the first delivered message: ClickSend's `date` is
 * epoch SECONDS (`1788023160`), it is on the right side of the boundary, and the
 * `delivered_at` it produced (`17:06:00.000Z`) matches that row's `claimed_at`
 * (`17:06:00.181Z`) to the second. The reading is right for the poll path; the
 * DLR callback's own `timestamp` field has still never reached this branch,
 * because both live callbacks classified as failures at the time. The visible
 * symptom of getting it wrong is a `delivered_at` in the year 57644, which is
 * why the boundary exists rather than a bare `* 1000`.
 *
 * ── WHAT NEVER REACHES A LOG (T-4-17) ───────────────────────────────────────
 *
 * Result kinds and ids. Not the recipient (a receipt can carry one), not the
 * provider's `status_text` or `error_text` — those are free text a third party
 * writes, they can quote our request back at us, and `codeOf` exists precisely
 * because they are not trustworthy enough to store, let alone log.
 */
import { z } from 'zod';

import { updateDeliveryWhereMatch } from '@/db/repository';
import type { DeliveryStatus } from '@/db/schema';

import { codeOf } from './clicksend-client';

/**
 * Below this, a numeric timestamp is seconds; at or above it, milliseconds.
 * See the header — this is a backstop for an unverified unit, not a fact.
 */
const MS_BOUNDARY = 100_000_000_000;

/**
 * TOLERANT, and the ONE hard requirement is a routing key.
 *
 * Without `custom_string` or `message_id` there is no row this receipt could
 * belong to, so it is not a receipt we failed to understand — it is not a
 * receipt. Everything else is optional because every other field is either
 * classified defensively below or ignored.
 *
 * `z.union` on the numeric fields because a provider that sends `"1756351200"`
 * and a provider that sends `1756351200` are the same provider on different
 * days, and a receipt discarded over a JSON type is a receipt the daily poll
 * has to find again.
 */
const numeric = z.union([z.number(), z.string()]).nullish();

const dlrPayload = z
  .looseObject({
    custom_string: z.string().nullish(),
    message_id: z.string().nullish(),
    /**
     * ClickSend's one-word verdict — `'Sent'`, `'Failed'`, `'Delivered'`.
     *
     * OBSERVED on the history rows for the first two real sends (2026-08-30)
     * and added here because it is the least ambiguous field in the payload:
     * `'Failed'` is a token the failure list already matches, where the same
     * message's `status_text` was a full English sentence with no such word in
     * it. Optional, like everything else — if a DLR callback omits it, the
     * text fields still decide.
     */
    status: z.string().nullish(),
    status_code: z.union([z.number(), z.string()]).nullish(),
    status_text: z.string().nullish(),
    error_code: z.union([z.number(), z.string()]).nullish(),
    error_text: z.string().nullish(),
    timestamp: numeric,
    timestamp_send: numeric,
  })
  .refine(
    (payload) => Boolean(payload.custom_string) || Boolean(payload.message_id),
    'A delivery receipt with neither custom_string nor message_id names no send.',
  );

/**
 * What this call did. A CLOSED UNION.
 *
 *   applied     — exactly one ledger row now carries this delivery fact
 *   unmatched   — a well-formed receipt naming no send we hold. A RECORDED
 *                 NO-OP, not an error: a re-delivered callback for a purged
 *                 row, a receipt for another sub-account, and a forgery are all
 *                 this, and all three are correctly nothing.
 *   unparseable — no routing key at all, so there was never a row to find
 */
export type ReceiptResult =
  | { kind: 'applied'; ledgerId: string }
  | { kind: 'unmatched' }
  | { kind: 'unparseable' };

/**
 * A provider status this system reads as SUCCESS.
 *
 * Checked AFTER the failure classes below, and the order is load-bearing:
 * `UNDELIVERED` CONTAINS `DELIVERED`, so a delivered-first test records the
 * carrier's clearest possible statement of failure as a success — on the column
 * Phase 7 reads and an operator triages from.
 */
const DELIVERED_CODES = ['DELIVERED', 'DELIVRD', 'RECEIVED', 'SUCCESS', 'COMPLETED'];

/** Provider statuses that assert the message did NOT reach the handset. */
const UNDELIVERED_CODES = [
  'UNDELIVERED',
  'UNDELIV',
  'UNDELIVERABLE',
  'FAILED',
  'FAILURE',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
  'CANCELED',
  'BOUNCED',
  'ERROR',
  'BLOCKED',
];

/**
 * Normalize a provider's verdict into the three-value vocabulary the operator's
 * screen and Phase 7 read (`DELIVERY_STATUSES`).
 *
 * `'unknown'` is not a failure of this function — it is the honest answer for a
 * receipt that arrived carrying something we cannot place, which is a DIFFERENT
 * fact from `NULL` ("no receipt has arrived") and prompts a different response:
 * look at `delivery_detail`. Guessing in either direction would be worse than
 * saying so, because both guesses are actionable and only one of them is true.
 */
function classify(code: string): DeliveryStatus {
  // FAILURE FIRST, AND THAT ORDER IS THE ONLY SAFETY RULE LEFT HERE.
  //
  // There used to be a second one — "the presence of an `error_code` is
  // dispositive" — on the reasoning that a payload carrying both
  // `status_text: 'Delivered'` and an error code is a contradiction whose safe
  // reading is the one that does not claim a customer received something. The
  // reasoning was sound and the premise was wrong, and the first two real sends
  // (2026-08-30) proved it: ClickSend populates `error_code` and `error_text` on
  // SUCCESS too. The delivered message came back as
  //
  //     status: 'Sent', status_code: '201',
  //     status_text: 'Message delivered to the handset',
  //     error_code: '4', error_text: 'Message delivered to the handset'
  //
  // so under the old rule EVERY delivered message was recorded `undelivered` —
  // on the column an operator triages from and Phase 7 reads. The rule fired on
  // the normal shape of a success, which is the worst possible place for a
  // conservative default to live.
  //
  // The conservatism survives in the ordering below plus the fact that
  // `error_text` is now part of the corpus: the failed send's error_text was the
  // useless `'Unknown error'`, and `ERROR` is a failure token, so a payload that
  // really is carrying an error still classifies as one without needing a rule
  // that cannot tell an error field from an error.
  if (UNDELIVERED_CODES.some((candidate) => code.includes(candidate))) return 'undelivered';
  if (DELIVERED_CODES.some((candidate) => code.includes(candidate))) return 'delivered';
  return 'unknown';
}

/**
 * THE ONE ANSWER TO "WHAT DID THE PROVIDER SAY ABOUT THIS MESSAGE", asked from
 * here AND from `reconcile.ts`.
 *
 * Exported for the same reason `codeOf` is: a second spelling of this question
 * is a second answer, and the drift is only ever visible as a customer treated
 * differently depending on which file read their receipt. That is not
 * hypothetical — it is exactly what CR-02 found. `classify`'s corpus was widened
 * to all four verdict-bearing fields on 2026-08-30 when the first live sends
 * showed the verdict lives in the prose; `reconcile.ts`'s opt-out probe was left
 * reading `status` + `status_code` alone, which the same capture proves are
 * `Sent`/`Failed` and `201`/`301` — so the T-4-18 compliance backstop could not
 * fire on any real payload. One builder, two callers, no third copy.
 *
 * NORMALIZED FIELD BY FIELD, NEVER AS ONE JOINED STRING. `codeOf` caps its
 * output at 48 characters, which is correct for a value that gets STORED and
 * wrong for one that only gets searched: the real failure receipt's
 * `status_text` is a 114-character sentence, so a single joined string would
 * have been truncated inside it and the `ERROR` in `error_text` — the only
 * failure token that payload contained — would have fallen off the end. Each
 * field gets its own budget instead.
 *
 * Callers pass the fields in the SAME ORDER (status, status_text, status_code,
 * error_text) so the two call sites cannot quietly diverge on precedence.
 */
export function providerVerdictCorpus(
  fields: readonly (string | number | null | undefined)[],
): string {
  return fields
    .filter((field) => field !== null && field !== undefined && String(field).trim() !== '')
    .map((field) => codeOf(String(field)))
    .join(' ');
}

/** Epoch seconds or milliseconds → a Date, or null. See the header. */
function toDate(value: number | string | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;

  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return null;

  const ms = numberValue < MS_BOUNDARY ? numberValue * 1000 : numberValue;
  const date = new Date(ms);

  // `new Date(NaN)` is a Date. Writing one into a timestamptz column is a
  // driver error raised inside the webhook, which the provider answers by
  // re-delivering for 72 hours.
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Record one delivery receipt.
 *
 * NEVER THROWS FOR AN ORDINARY OUTCOME — the `inbound.ts` / `controls.ts`
 * convention, and for the same reason: a shape we do not recognise and a
 * receipt for a send we do not hold are both normal things for a webhook to be
 * handed, and a throw becomes a non-2xx that ClickSend retries for 72 hours
 * before abandoning. A database failure DOES propagate, deliberately: that is
 * not an ordinary outcome, the receipt is genuinely unrecorded, and a
 * re-delivery is exactly what should happen.
 */
export async function applyDeliveryReceipt(payload: unknown): Promise<ReceiptResult> {
  const parsed = dlrPayload.safeParse(payload);
  if (!parsed.success) return { kind: 'unparseable' };

  const receipt = parsed.data;

  // The CODE fields first, the prose fields only as a last resort — and even
  // then through `codeOf`, which bounds and redacts. `status_code` is what the
  // schema's `delivery_detail` column documents itself as holding.
  //
  // `status_code` NOW OUTRANKS `error_code`, having been the other way round.
  // Both real sends say why: the delivered one gave `error_code: '4'` against
  // `status_code: '201'`, and the failed one gave `error_code: '12'` (whose
  // `error_text` was 'Unknown error') against `status_code: '301'` — whose
  // `status_text` was 'Absent Subscriber. Phone is out of range or switched
  // off.' The operator's screen showed `4` and `12`. ClickSend's error pair is
  // the vestigial one; its status pair is the diagnosis.
  const rawCode = String(
    receipt.status_code ?? receipt.error_code ?? receipt.status_text ?? receipt.error_text ?? '',
  );
  const detail = rawCode.trim() === '' ? null : codeOf(rawCode);

  // Classification reads the TEXT as well as the codes, because a numeric
  // `status_code` alone ('201') carries no verdict this side can interpret —
  // and `error_text`, because that is where a real failure's only recognisable
  // token turned out to live. See `classify`.
  //
  // Assembled by `providerVerdictCorpus` — the ONE builder, shared with
  // `reconcile.ts`'s opt-out probe, which is documented there and which is why
  // the per-field normalization argument lives beside it rather than here.
  const status = classify(
    providerVerdictCorpus([
      receipt.status,
      receipt.status_text,
      receipt.status_code,
      receipt.error_text,
    ]),
  );

  const timestamp = toDate(receipt.timestamp) ?? toDate(receipt.timestamp_send);

  const rows = await updateDeliveryWhereMatch({
    ledgerId: receipt.custom_string,
    providerMessageId: receipt.message_id,
    status,
    detail,
    // ONLY for a delivered verdict. "When did the non-delivery happen" is not a
    // fact `delivered_at` can hold without lying about what it means, and the
    // schema header says so.
    deliveredAt: status === 'delivered' ? timestamp : null,
  });

  const applied = rows[0];
  return applied ? { kind: 'applied', ledgerId: applied.id } : { kind: 'unmatched' };
}
