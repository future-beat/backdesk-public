/**
 * One sender for dispatch, two providers behind it (D-06, MSG-01).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ DISPATCH STILL TAKES EXACTLY ONE SENDER. THIS IS HOW.                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `TouchSender` is the Phase 4 contract and `sender.ts` is untouchable (D-06):
 * changing its shape would touch dispatch, the ledger and the provider gateway
 * at once. So the sms/email split is expressed as a COMPOSITE that satisfies the
 * existing interface, plus one narrow extension (`ChannelAwareTouchSender`,
 * declared in dispatch.ts) that exists solely because the ledger row is claimed
 * BEFORE the send runs and must record the real provider.
 *
 * ── ONE ROUTING RULE, ASKED TWICE ──────────────────────────────────────────
 *
 * `providerFor(channel)` and `send(request)` both resolve through the private
 * `delegateFor`. This is the same shape as `nextAllowedSlot` answering "may we
 * send now" (03-04) and `contactWindowOf` being exported so the progress pass
 * and the claim path cannot disagree: two rules that must never disagree are
 * safer as one rule asked twice. A second copy here would surface as a ledger
 * row naming one provider while the message left through another — an
 * attribution error that looks like clean data.
 *
 * ── ACTIVATION IS A CONFIG-ROW FLIP, AND `buildRoutingSender` IS THE GATE ───
 *
 * With no enabled `messaging_config` row (production's state, because the AU
 * dedicated number is blocked on the IPND business-address requirement — D-08),
 * BOTH delegates are `StubSender` and dispatch behaves byte-identically to
 * Phase 3: same `send_ledger.sender = 'stub'`, same `outcome = 'stub_sent'`.
 * Deploying this plan cannot send a real message. Turning sending on is a row
 * write, picked up by the NEXT tick, with no deploy — which is what makes a
 * one-client-at-a-time rollout, and an instant rollback, possible at all.
 *
 * Config is read ONCE PER TICK, at construction. Not per message: fifteen
 * clients' touches would otherwise each re-ask a question whose answer changes
 * about once a fortnight, and the read would land inside the loop dispatch
 * deliberately runs outside its transaction.
 */
import { isChannelAware, type ChannelAwareTouchSender } from '@/core/cadence/dispatch';
import { StubSender, type SendOutcome, type SendRequest, type TouchSender } from '@/core/cadence/sender';
import { getServerEnv } from '@/core/shared/env';
import { anyChannelEnabled, forTenant, getChannelConfig } from '@/db/repository';
import type { TouchChannel } from '@/db/schema/cadence-templates';

import { ClickSendSender } from './clicksend-sender';
import { chooseEmailSender, type EmailIdentity } from './resend-sender';

export interface RoutingDelegates {
  sms: TouchSender;
  email: TouchSender;
}

export class RoutingSender implements ChannelAwareTouchSender {
  /**
   * A LABEL, AND IT MUST NEVER REACH `send_ledger.sender`.
   *
   * `TouchSender` requires the field, and a composite has no honest answer: the
   * provider depends on the channel, which this object does not know until it is
   * asked. Deliberately a word no real provider uses, so a ledger row carrying
   * it is unambiguously the claim-time wiring bug rather than a plausible
   * provider name somebody has to go and investigate. `dispatch.ts` resolves the
   * claim through `providerFor` instead, and
   * `tests/routing-sender.test.ts` asserts against a real ledger row that it
   * does — the only assertion in this repository that can fail on it.
   */
  readonly provider = 'routing';

  private readonly delegates: RoutingDelegates;

  constructor(delegates: RoutingDelegates) {
    this.delegates = delegates;
  }

  /** THE routing rule. Both public methods below go through it. */
  private delegateFor(channel: TouchChannel): TouchSender {
    return this.delegates[channel];
  }

  providerFor(channel: TouchChannel): string {
    return this.delegateFor(channel).provider;
  }

  /**
   * UNCHANGED, deliberately. The outcome carries the DELEGATE's provider, which
   * `performSends` reads to choose between `'sent'` and `'stub_sent'` — rewrite
   * it here and every real send would be recorded as a stub, or every stub as
   * real. The composite's job is to pick who sends, not to have an opinion about
   * what happened.
   */
  send(request: SendRequest): Promise<SendOutcome> {
    return this.delegateFor(request.channel).send(request);
  }
}

/** Just the credential pair, so the gate below can be tested without an env. */
export interface OptionalClickSendCreds {
  username?: string;
  apiKey?: string;
}

/**
 * THE ACTIVATION GATE — pure, so every one of its cases is enumerable in a test
 * that touches nothing.
 *
 * TWO independent conditions must hold before a real provider is wired in, and
 * each is a genuinely different way of not being ready:
 *
 *   `channelEnabled`  — `anyChannelEnabled('sms')`: nobody has switched sms on
 *                       for ANY client on this deployment (or it was switched
 *                       back off)
 *   both credentials  — the ClickSend account is not connected on this deploy
 *
 * Either failing falls back to `fallback`, which is `StubSender`. The fallback
 * is passed in rather than constructed here so the caller — and the test — can
 * see that the two branches return objects from the same place.
 *
 * ── TWO LEVELS, AND EACH OWNS A DIFFERENT QUESTION (CR-01) ──────────────────
 *
 * This gate is DEPLOYMENT-level and answers one thing: is sms armed anywhere,
 * and can this deployment reach ClickSend at all. It deliberately reads no
 * from-address, because it holds no tenant: a number is a per-client fact and
 * this is asked once per tick before any tenant is in hand.
 *
 * The PER-TENANT authority is `resolveSmsFrom` below (and `resolveEmailIdentity`
 * for the other channel). It returns `null` for a tenant whose effective row is
 * disabled, absent or address-less, and `ClickSendSender` records
 * `sms_not_configured` on the ledger for it — an honest, per-client refusal a
 * human can read.
 *
 * A PER-TENANT `enabled = false` STILL MEANS STOP FOR THAT ONE CLIENT: the
 * resolver reads the tenant's OVERRIDE row when one exists, so switching one
 * client off does not require flipping the global row and stopping all fifteen.
 * That half of the old comment was always true. The half that was NOT — this is
 * the IN-04/CR-01 correction — claimed `buildRoutingSender` performed that tenant
 * lookup at THIS gate. It never did: it read the global row alone, so an enabled
 * per-tenant row with the global row off produced a silent `StubSender` for
 * everybody, making the one-client-at-a-time rollout D-04 describes impossible to
 * perform. The gate now asks `anyChannelEnabled`, which the override row
 * satisfies.
 */
export function chooseSmsSender(
  channelEnabled: boolean,
  creds: OptionalClickSendCreds,
  fallback: TouchSender,
): TouchSender {
  if (!channelEnabled) return fallback;

  const { username, apiKey } = creds;
  if (!username || !apiKey) return fallback;

  return new ClickSendSender({ creds: { username, apiKey }, resolveSmsFrom });
}

/**
 * THE PER-TENANT SMS IDENTITY AUTHORITY, asked at send time — and the ONLY
 * place that question is answered.
 *
 * The gate above decides "is sms armed anywhere on this deployment at all";
 * this resolves "which number does THIS client send from", which is a different
 * question with a per-tenant answer (CR-01, 04-08).
 *
 * A disabled override, an absent row and an address-less row all return `null`,
 * and the caller records `sms_not_configured` rather than falling back to the
 * global number. That is the correct reading of an explicit per-client
 * `enabled = false`: it means stop, not "use the default instead". It is also
 * what keeps the deployment-level gate safe to widen — a client nobody
 * configured is refused here, on the record.
 *
 * This is a database read on the send path, which dispatch is otherwise careful
 * about — but it happens AFTER the claim transaction has committed (senders are
 * invoked outside it by design), so no pooled connection is held across the
 * provider's HTTP call. That ordering is the constraint, not the query count.
 *
 * ── A NAMED EXPORT SINCE 06-05, AND THE REASON IS THE HOUSE RULE ───────────
 *
 * It used to be an arrow written inline in `chooseSmsSender`. The hot-lead
 * escalation (CON-03) must ask the SAME question before it texts a tradie —
 * D-05 exempts that path from the customer-protection gates but explicitly NOT
 * from the D-04 arming switch — and a second copy of `row?.enabled ?
 * row.fromAddress : null` is exactly the shape that produced CR-01: two
 * readings of one activation rule, agreeing until one of them was widened. Two
 * rules that must never disagree are safer as one rule asked twice.
 */
export async function resolveSmsFrom(tenantId: string): Promise<string | null> {
  const row = await getChannelConfig('sms', tenantId);
  if (!row?.enabled) return null;
  return row.fromAddress;
}

/**
 * THE SENDING IDENTITY for one tenant's email, resolved at SEND time.
 *
 * ── WHY THIS LIVES HERE AND NOT IN `resend-sender.ts` ───────────────────────
 *
 * The same reason `resolveSmsFrom` does: `src/core/messaging`'s sender files
 * read no configuration and open no connection, so that dispatch — which invokes
 * senders OUTSIDE its claim transaction, deliberately — never has a repository
 * query appear inside a window where a pooled connection could be held across a
 * third party's HTTP call. This module is the one that knows about
 * `messaging_config`, and now about `tenants`.
 *
 * ── THREE REFUSALS, AND EACH IS A DIFFERENT MISSING THING ───────────────────
 *
 *   the row is absent or DISABLED — an explicit per-client `enabled = false`
 *     means STOP, not "use the global row instead". Without that reading, the
 *     only way to turn one client's email off would be the global row, which
 *     turns all fifteen off. Same rule `resolveSmsFrom` applies to a number.
 *   no reply-to (D-01) — v1 captures no inbound email, so a customer's "yes"
 *     would land in a mailbox nobody reads.
 *   no name anywhere (Spam Act) — the row's `business_name`, else the tenant's
 *     own name. If neither exists there is nobody to identify as the sender, and
 *     an unidentified commercial email is the breach itself.
 *
 * THE TENANT NAME IS A FALLBACK, NOT THE DEFAULT: `business_name` exists because
 * a trading name and a name typed into the client list are often different
 * strings, and the customer knows the trading one. The extra read only happens
 * for a row that left the field blank.
 */
export async function resolveEmailIdentity(tenantId: string): Promise<EmailIdentity | null> {
  const row = await getChannelConfig('email', tenantId);
  if (!row?.enabled) return null;

  const fromAddress = row.fromAddress ?? '';
  const replyTo = row.replyTo ?? '';
  if (fromAddress === '' || replyTo === '') return null;

  let businessName = row.businessName ?? '';
  if (businessName.trim() === '') {
    const [tenant] = await forTenant(tenantId).tenant.get();
    businessName = tenant?.name ?? '';
  }
  if (businessName.trim() === '') return null;

  return { fromAddress, replyTo, businessName };
}

/**
 * The composite the cadence tick runs with, built from current configuration.
 *
 * Called once per tick from the tick route. BOTH channels are gated the same
 * way and both refuse by default: with no enabled `messaging_config` row for a
 * channel, that delegate is `StubSender` and dispatch behaves byte-identically
 * to Phase 3. Email activation is `/settings/email` saving an enabled row after
 * a domain verifies (04-06); sms activation is the global row's `enabled` flag
 * or any one client's override row.
 */
export async function buildRoutingSender(): Promise<RoutingSender> {
  const stub = new StubSender();

  // THE DEPLOYMENT-LEVEL QUESTION, and the only one askable here: "is this
  // channel armed for ANY client". No tenant is in hand at construction, so
  // WHICH identity each client sends as is resolved later, per message, by
  // `resolveSmsFrom` and `resolveEmailIdentity` — which are also what refuse a
  // client whose own row is disabled or incomplete (CR-01).
  const [smsEnabled, emailEnabled] = await Promise.all([
    anyChannelEnabled('sms'),
    anyChannelEnabled('email'),
  ]);
  const env = getServerEnv();

  return new RoutingSender({
    sms: chooseSmsSender(
      smsEnabled,
      { username: env.CLICKSEND_USERNAME, apiKey: env.CLICKSEND_API_KEY },
      stub,
    ),
    email: chooseEmailSender(
      emailEnabled,
      {
        apiKey: env.RESEND_API_KEY,
        // NO FALLBACK CHAIN HERE, deliberately — unlike `consoleBaseUrl()`,
        // which degrades to localhost for an operator's alert link. This value
        // builds a link that goes into a CUSTOMER's inbox, and a localhost
        // unsubscribe is a Spam Act breach that every test would pass.
        appBaseUrl: env.APP_BASE_URL,
        signingSecret: env.UNSUBSCRIBE_SIGNING_SECRET,
      },
      stub,
      resolveEmailIdentity,
    ),
  });
}

/**
 * Re-exported so a reader of this file can see the guard dispatch resolves the
 * claim through without following an import into the cadence layer. The
 * interface and the guard live in `dispatch.ts` to keep the import direction
 * messaging→cadence — see `ChannelAwareTouchSender` there for why.
 */
export { isChannelAware, type ChannelAwareTouchSender };
