/**
 * The first real implementation behind the D-13 seam: `TouchSender` over
 * ClickSend.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ EVERY FAILURE MODE IS A RETURNED UNION MEMBER. NOTHING THROWS.           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `sender.ts` states the rule and the reason; this file is where it stops being
 * free. `performSends` (dispatch.ts) iterates over every touch its transactions
 * committed to, so a throw escaping here strands each REMAINING claimed touch
 * with `outcome IS NULL` — rows that are surfaced to an operator and never
 * auto-resent. One client's bad number would cost fourteen other clients their
 * follow-ups for that tick. Dispatch does wrap the call; that wrapper is a
 * backstop, and the `try` around the whole body below is what keeps it unused.
 *
 * ── FRAMEWORK-FREE AND DATABASE-FREE, BY INJECTION ─────────────────────────
 *
 * This file reads no configuration and opens no connection. `resolveSmsFrom` is
 * handed in by `buildRoutingSender` (routing-sender.ts), which is the only place
 * that knows about `messaging_config`. Two reasons, and the second is the one
 * that matters: dispatch deliberately invokes senders OUTSIDE its transaction
 * so a pooled Postgres connection is never held open across a third-party HTTP
 * call — and a `getChannelConfig()` inside `send()` would put a query right back
 * into that window, per message.
 *
 * ── WHAT IS NEVER LOGGED (T-2-02, T-4-14) ──────────────────────────────────
 *
 * Ids, counts and the outcome kind. NOT the address — it is a customer's mobile,
 * it is already in the ledger row behind RLS, and platform logs are the one
 * surface in this system with no tenant scoping, no retention limit and no
 * per-customer deletion. NOT the body, for the same reason. NOT the provider's
 * error text, which can quote our request back at us. `tests/clicksend-sender.
 * test.ts` pins the exact set of interpolated expressions, so adding one is a
 * test failure rather than a leak somebody notices later.
 */
import type { SendOutcome, SendRequest, TouchSender } from '@/core/cadence/sender';

import { sendSms, type ClickSendCreds } from './clicksend-client';

export interface ClickSendSenderOptions {
  creds: ClickSendCreds;
  /**
   * The `from` number for this tenant — the per-tenant override if one exists,
   * else the global default (see `messaging_config`). `null` means SMS is not
   * configured, which is production's state until the IPND-blocked dedicated
   * number lands (D-08) and is a refusal rather than an error.
   */
  resolveSmsFrom: (tenantId: string) => Promise<string | null>;
  /** Injectable for tests. Defaults to the real client. */
  client?: typeof sendSms;
}

export class ClickSendSender implements TouchSender {
  /** Written verbatim into `send_ledger.sender`. */
  readonly provider = 'clicksend';

  private readonly creds: ClickSendCreds;
  private readonly resolveSmsFrom: (tenantId: string) => Promise<string | null>;
  private readonly client: typeof sendSms;

  constructor(options: ClickSendSenderOptions) {
    this.creds = options.creds;
    this.resolveSmsFrom = options.resolveSmsFrom;
    this.client = options.client ?? sendSms;
  }

  async send(request: SendRequest): Promise<SendOutcome> {
    const outcome = await this.attempt(request);

    console.info(
      `[cadence] clicksend send ledger=${request.ledgerId} cadence=${request.cadenceId} ` +
        `touch=${request.touchNumber} chars=${request.body.length} outcome=${outcome.kind}`,
    );

    return outcome;
  }

  /**
   * The whole body, wrapped once.
   *
   * A single `try` around everything rather than one per step, deliberately: the
   * guarantee is "no throw escapes", and a per-step wrapper is a guarantee with
   * as many holes as there are steps somebody forgets to wrap. The catch cannot
   * distinguish causes, and does not need to — `retryable: true` is the honest
   * answer for an unexpected throw, because we do not know that asking again
   * would fail. Nothing acts on it automatically (D-07).
   */
  private async attempt(request: SendRequest): Promise<SendOutcome> {
    try {
      // FIRST, BEFORE ANYTHING ELSE. A blank SMS is a message a customer
      // receives from a tradie that says nothing: it cannot be un-sent, it costs
      // a segment, and it makes the client look broken. Checking after the
      // provider call would still have sent it.
      if (request.body.trim() === '') {
        return this.failed('empty_body', false);
      }

      const from = await this.resolveSmsFrom(request.tenantId);
      if (!from) {
        // Not an error and not retryable: there is no number to send from, and
        // there will not be one until a `messaging_config` row is written. The
        // ledger records the refusal so the operator sees WHY nothing went out,
        // instead of a tick that silently did nothing.
        return this.failed('sms_not_configured', false);
      }

      const result = await this.client(
        {
          to: request.to.address,
          from,
          body: request.body,
          // The ledger id, so 04-04's delivery receipt can find its row without
          // searching on a phone number.
          customString: request.ledgerId,
        },
        this.creds,
      );

      if (result.ok) {
        return { kind: 'sent', provider: this.provider, providerMessageId: result.messageId };
      }

      // A STABLE LABEL for the opt-out case, not the provider's spelling. The
      // 04-04 reconciliation sweep turns these into suppression evidence, and it
      // must key on a word this codebase owns — matching on ClickSend's
      // vocabulary would make a compliance write depend on a third party's
      // release notes.
      return this.failed(
        result.optedOut ? 'recipient_opted_out' : result.reason,
        result.optedOut ? false : result.retryable,
      );
    } catch (e) {
      // The error NAME only. NOT `String(e)` and not `e.message`: a rejection
      // from an HTTP client can carry the request, and the request carries a
      // customer's mobile number and our Basic-auth header.
      return this.failed(e instanceof Error ? e.name : 'UnknownError', true);
    }
  }

  private failed(reason: string, retryable: boolean): SendOutcome {
    return { kind: 'failed', provider: this.provider, reason, retryable };
  }
}
