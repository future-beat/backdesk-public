/**
 * The second implementation behind the D-13 seam: `TouchSender` over Resend
 * (MSG-02, MSG-04, D-01, D-02).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ EVERY FAILURE MODE IS A RETURNED UNION MEMBER. NOTHING THROWS.           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Same contract, same reason as `clicksend-sender.ts`: `performSends` iterates
 * over every touch its transaction committed to, so a throw escaping here
 * strands each REMAINING claimed touch with `outcome IS NULL` — rows an operator
 * sees and nothing auto-resends. One client's bad address would cost fourteen
 * other clients their follow-ups for that tick.
 *
 * ── WHAT THIS FILE OWES A CUSTOMER, AND WHAT IT REFUSES TO SEND WITHOUT ─────
 *
 * A follow-up email in a tradie's name carries obligations that a green tick on
 * a send does not check, so they are structural here — the message cannot be
 * built without them, and if any is missing the send is REFUSED rather than
 * degraded:
 *
 *   IDENTITY (Spam Act)   the footer names the client business AND says Backdesk
 *                         sent it on their behalf. Neither alone is honest: our
 *                         domain sending as only the tradie is the shape a
 *                         filter distrusts, and only naming us leaves the
 *                         customer wondering who is emailing them. Both phrases
 *                         come from `@/core/brand`, so they cannot disagree.
 *   UNSUBSCRIBE           a visible footer link AND the RFC 8058 one-click
 *                         headers. The Spam Act requires the first; Gmail and
 *                         Yahoo bulk-sender rules require the second.
 *   REPLY-TO (D-01)       the tradie's OWN address. v1 captures no inbound email
 *                         at all, so a reply to us is a customer saying yes into
 *                         a mailbox nobody reads.
 *   A REAL LINK BASE      no `APP_BASE_URL`, no send. A relative or localhost
 *                         unsubscribe link in a customer's inbox is a Spam Act
 *                         breach wearing a working-code disguise, and there is
 *                         no degraded version of this email worth sending.
 *
 * ── FRAMEWORK-FREE AND DATABASE-FREE, BY INJECTION ─────────────────────────
 *
 * This file reads no configuration and opens no connection. `resolveEmailConfig`
 * is handed in by `buildRoutingSender`, which is the only place that knows about
 * `messaging_config` and `tenants` — the same split `resolveSmsFrom` makes for
 * ClickSend, and for the same reason: dispatch invokes senders OUTSIDE its
 * transaction so a pooled Postgres connection is never held across a third
 * party's HTTP call, and a repository read inside `send()` would put a query
 * straight back into that window, per message.
 *
 * The signing secret is injected for the same reason the api key is: this module
 * must be drivable by a unit test that has no environment, and a key read at
 * module scope would be whatever was true when the instance cold-started.
 *
 * ── WHAT IS NEVER LOGGED (T-2-02, T-4-14) ──────────────────────────────────
 *
 * Ids, counts and the outcome kind. NOT the recipient address, NOT the body, NOT
 * the unsubscribe token (it is a credential), and NOT the provider's error text,
 * which quotes our request — containing a customer's address — back at us.
 * Failure detail is the error's `name`, exactly as `operator-email.ts` rule 3
 * requires of the only other Resend caller in this codebase.
 */
import { Resend } from 'resend';

import { identityLine, viaDisplayName } from '@/core/brand';
import type { SendOutcome, SendRequest, TouchSender } from '@/core/cadence/sender';

import { domainOfAddress } from './resend-domains';
import { mintUnsubscribeToken, unsubscribeUrl } from './unsubscribe-token';

/**
 * Resend's pre-verification sender domain.
 *
 * Before a domain is verified, Resend permits only `onboarding@resend.dev`, and
 * only to the ACCOUNT OWNER's own inbox (RESEARCH A6) — which is why
 * `operator-email.ts` may use it and this file may not. A customer-facing send
 * from it does not arrive; and if it ever did, it would identify the wrong
 * business entirely. Exported so `scripts/verify-email-pipe.mjs` refuses the
 * same address rather than spelling the rule a second time.
 */
export const OWNER_ONLY_SENDER_DOMAIN = 'resend.dev';

/**
 * Is this address one Resend will only deliver to the account owner?
 *
 * THE SAME PREDICATE THE SENDER AND THE SCRIPT BOTH ASK, exported for the reason
 * `domainOfAddress` is: two spellings of "is this the onboarding sender" is how
 * one of them stops matching, and the failure is a proof — or worse, a client's
 * follow-up — carried by an address that reaches nobody.
 *
 * Subdomains count. An address at `mail.resend.dev` is no more deliverable to a
 * customer than one at the apex, and the version of this check that missed it
 * would be the one somebody discovers from a tradie asking why their customer
 * never replied.
 */
export function isOwnerOnlySender(address: string): boolean {
  const domain = domainOfAddress(address);
  if (!domain) return false;
  return domain === OWNER_ONLY_SENDER_DOMAIN || domain.endsWith(`.${OWNER_ONLY_SENDER_DOMAIN}`);
}

/** Matches `UNSUBSCRIBE_SIGNING_SECRET`'s own `min(32)` in `env.ts`. */
const MIN_SIGNING_SECRET_CHARS = 32;

/** A From display name is a header value; 78 characters is a header's comfort. */
const MAX_DISPLAY_NAME_CHARS = 78;

/** Everything the message needs about who is sending, already resolved. */
export interface EmailIdentity {
  /** An address on a VERIFIED domain. Never the owner-only onboarding sender. */
  fromAddress: string;
  /** The tradie's own address (D-01). */
  replyTo: string;
  /** The client's trading name, as the customer knows it (Spam Act). */
  businessName: string;
}

/** The provider payload, in the shape `resend.emails.send` accepts. */
export interface EmailMessage {
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
}

/** The SDK's return shape, narrowed to what is read (operator-email.ts:216). */
export interface EmailSendResult {
  data: { id: string } | null;
  error: { name?: string } | null;
}

export type EmailClient = (
  message: EmailMessage,
  apiKey: string,
) => Promise<EmailSendResult>;

export interface ResendSenderOptions {
  apiKey: string;
  /**
   * The origin every unsubscribe link is built from. REQUIRED, and empty is a
   * refusal rather than a fallback — see the header.
   */
  appBaseUrl: string;
  /** `UNSUBSCRIBE_SIGNING_SECRET`. Injected so this file needs no environment. */
  signingSecret: string;
  /**
   * The sending identity for this tenant — the per-tenant override if one
   * exists, else the global default. `null` means email is not configured, which
   * is production's state until an operator enables a row on `/settings/email`,
   * and is a refusal rather than an error.
   */
  resolveEmailConfig: (tenantId: string) => Promise<EmailIdentity | null>;
  /** Injectable for tests. Defaults to the real SDK. */
  client?: EmailClient;
}

const defaultClient: EmailClient = async (message, apiKey) =>
  (await new Resend(apiKey).emails.send(message)) as EmailSendResult;

/**
 * A From display name, made safe to put in a header.
 *
 * `business_name` is typed by an operator on `/settings/email` and lands
 * verbatim in a From header. A CR or LF in a header value is an INJECTED HEADER
 * (`Bcc:` being the obvious one), and `<`, `>` or `"` break the quoting around
 * the display name so that the address beside it can be rewritten. Neither is
 * hypothetical for a field a human pastes into.
 *
 * Stripped rather than rejected: the name is what identifies the sender to the
 * customer, and refusing to send because somebody's trading name contains a
 * quotation mark would be a compliance failure caused by a typography rule.
 */
function displayName(raw: string): string {
  return (
    raw
      // Every C0 control character and DEL, collapsed to a single space rather
      // than deleted: CR and LF are the injection, and joining the two sides of
      // a stripped newline into one word would be a silent rename.
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      // The characters that terminate a quoted display name or open an address.
      .replace(/["<>\\]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_DISPLAY_NAME_CHARS)
  );
}

/** The body is a customer-visible string, not markup. */
function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isAddress(value: string): boolean {
  return domainOfAddress(value) !== null;
}

/**
 * THE MESSAGE, as one pure function.
 *
 * Exported so `scripts/verify-email-pipe.mjs` can print the exact headers a real
 * send would carry, and so the compliance obligations above are assertable
 * without a provider. `send()` below builds through this and nothing else — two
 * spellings of "what goes in the footer" is how a header link and a footer link
 * end up pointing at different URLs.
 */
export function buildEmailMessage(input: {
  request: SendRequest;
  identity: EmailIdentity;
  appBaseUrl: string;
  signingSecret: string;
}): EmailMessage {
  const { request, identity, appBaseUrl, signingSecret } = input;

  const token = mintUnsubscribeToken(
    { tenantId: request.tenantId, cadenceId: request.cadenceId },
    signingSecret,
  );
  const link = unsubscribeUrl(appBaseUrl, token);
  const business = displayName(identity.businessName);

  const line = identityLine(business);
  const replyLine = `Reply to this email and it goes straight to ${identity.replyTo}.`;

  return {
    // "Dave's Electrical via Backdesk" — both parties named, in the one line
    // every mail client shows before anything else is read. The quotes and the
    // angle brackets stay HERE, beside the sanitiser that makes them safe.
    from: `"${viaDisplayName(business)}" <${identity.fromAddress}>`,
    to: request.to.address,
    replyTo: identity.replyTo,
    // Neutral and fixed. COPY AUTHORSHIP IS PHASE 5 / ONB-03: this plan builds
    // the pipe, and a subject line written here would be an unapproved message
    // going out under an approval gate that does not exist yet.
    subject: `Quote follow-up from ${business}`,
    html: [
      '<!doctype html><html><body style="font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111">',
      '<div style="max-width:34rem">',
      `<p>${escapeHtml(request.body).replace(/\n/g, '<br>')}</p>`,
      '<hr style="border:0;border-top:1px solid #e5e5e5;margin:1.5rem 0">',
      `<p style="font-size:13px;color:#666">${escapeHtml(line)}<br>`,
      `${escapeHtml(replyLine)}<br>`,
      `<a href="${link}">Unsubscribe from these follow-ups</a></p>`,
      '</div></body></html>',
    ].join('\n'),
    text: [
      request.body,
      '',
      '—',
      line,
      replyLine,
      `Unsubscribe: ${link}`,
      '',
    ].join('\n'),
    headers: {
      // Angle brackets are required by RFC 8058; without them Gmail ignores the
      // header entirely and the sender-reputation benefit disappears.
      'List-Unsubscribe': `<${link}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

export class ResendSender implements TouchSender {
  /** Written verbatim into `send_ledger.sender`. */
  readonly provider = 'resend';

  private readonly apiKey: string;
  private readonly appBaseUrl: string;
  private readonly signingSecret: string;
  private readonly resolveEmailConfig: (tenantId: string) => Promise<EmailIdentity | null>;
  private readonly client: EmailClient;

  constructor(options: ResendSenderOptions) {
    this.apiKey = options.apiKey;
    this.appBaseUrl = options.appBaseUrl;
    this.signingSecret = options.signingSecret;
    this.resolveEmailConfig = options.resolveEmailConfig;
    this.client = options.client ?? defaultClient;
  }

  async send(request: SendRequest): Promise<SendOutcome> {
    const outcome = await this.attempt(request);

    console.info(
      `[cadence] resend send ledger=${request.ledgerId} cadence=${request.cadenceId} ` +
        `touch=${request.touchNumber} chars=${request.body.length} outcome=${outcome.kind}`,
    );

    return outcome;
  }

  /**
   * The whole body, wrapped once.
   *
   * One `try` around everything rather than one per step, for the reason
   * `clicksend-sender.ts` gives: the guarantee is "no throw escapes", and a
   * per-step wrapper has as many holes as there are steps somebody forgets to
   * wrap. `retryable: true` is the honest answer for an unexpected throw —
   * nothing acts on it automatically (D-07), and we do not know that asking
   * again would fail.
   */
  private async attempt(request: SendRequest): Promise<SendOutcome> {
    try {
      // FIRST, BEFORE ANYTHING ELSE, and before any provider call. A blank email
      // from a tradie cannot be un-sent and makes the client look broken.
      if (request.body.trim() === '') {
        return this.failed('empty_body', false);
      }

      // THE LINK BASE AND THE SIGNING KEY, BEFORE THE IDENTITY LOOKUP: neither
      // is per-tenant, so a deployment missing either can never send a compliant
      // email for anybody and there is nothing to be learned by asking the
      // database first.
      if (
        this.appBaseUrl.trim() === '' ||
        this.signingSecret.length < MIN_SIGNING_SECRET_CHARS
      ) {
        return this.failed('email_not_configured', false);
      }

      const resolved = await this.resolveEmailConfig(request.tenantId);
      const identity = usableIdentity(resolved);
      if (!identity) {
        // Not an error and not retryable: there is no verified identity to send
        // as, and there will not be one until an operator saves a row. The
        // ledger records the refusal so an operator sees WHY nothing went out.
        return this.failed('email_not_configured', false);
      }

      if (isOwnerOnlySender(identity.fromAddress)) {
        // Its own reason rather than `email_not_configured`: this row IS
        // configured, and what is wrong with it is a specific, fixable mistake
        // an operator needs to be told about by name.
        return this.failed('owner_only_sender', false);
      }

      if (displayName(identity.businessName) === '') {
        // The name passed the settings gate and `usableIdentity`'s blank check —
        // both of which look at the RAW string — and then nothing legible
        // survived the header sanitiser. `<>`, `""` and a lone backslash all do this.
        //
        // Refused rather than degraded, for the reason the file header states:
        // the send would go out as `From: " via Backdesk"`, subject "Quote
        // follow-up from ", footer "Sent by Backdesk on behalf of ." — a
        // customer-facing message that identifies no sender at all, which is
        // the Spam Act identification failure, not a typography one.
        //
        // Its own reason rather than `email_not_configured`, on the same rule as
        // the owner-only check above: this row IS configured, and what is wrong
        // with it is one field an operator can fix in one edit.
        return this.failed('unidentified_sender', false);
      }

      const { data, error } = await this.client(
        buildEmailMessage({
          request,
          identity,
          appBaseUrl: this.appBaseUrl,
          signingSecret: this.signingSecret,
        }),
        this.apiKey,
      );

      // `name` only — operator-email.ts rule 3. Resend's names ARE the
      // classification; the message adds prose and the risk that a future
      // version of it echoes the address we just sent to.
      if (error) return this.failed(error.name ?? 'unknown_error', true);

      // "The provider said nothing" is NOT "the provider accepted it".
      // Recording this as sent would put a row in the ledger that Phase 7
      // counts as a delivered follow-up.
      if (!data?.id) return this.failed('no_id_in_response', true);

      return { kind: 'sent', provider: this.provider, providerMessageId: data.id };
    } catch (e) {
      // The error NAME only. NOT `String(e)` and not `e.message`: a rejection
      // from an HTTP client can carry the request, and the request carries a
      // customer's address and our api key.
      return this.failed(e instanceof Error ? e.name : 'UnknownError', true);
    }
  }

  private failed(reason: string, retryable: boolean): SendOutcome {
    return { kind: 'failed', provider: this.provider, reason, retryable };
  }
}

/**
 * The resolved identity, or `null` if any part of it is missing.
 *
 * ALL THREE FIELDS ARE REQUIRED and the reasons are different: a from-address is
 * where the mail leaves from, a reply-to is where a customer's "yes" lands
 * (D-01), and a business name is who the Spam Act says must be identified. A row
 * missing any of them cannot produce a legal email, so there is no partial send
 * to attempt — `/settings/email` refuses to save such a row enabled (04-06), and
 * this is the same rule enforced where the message is actually built.
 */
function usableIdentity(resolved: EmailIdentity | null): EmailIdentity | null {
  if (!resolved) return null;

  const fromAddress = resolved.fromAddress.trim();
  const replyTo = resolved.replyTo.trim();
  const businessName = resolved.businessName.trim();

  if (!isAddress(fromAddress) || !isAddress(replyTo) || businessName === '') return null;

  return { fromAddress, replyTo, businessName };
}

/** Just the deployment-level inputs, so the gate below needs no environment. */
export interface OptionalEmailCreds {
  apiKey?: string;
  appBaseUrl?: string;
  signingSecret?: string;
}

/**
 * THE ACTIVATION GATE FOR EMAIL — pure, so every case is enumerable in a test
 * that touches nothing.
 *
 * The same shape and the same argument as `chooseSmsSender`: independent
 * conditions must ALL hold before a real provider is wired in, and each is a
 * genuinely different way of not being ready.
 *
 *   `channelEnabled`  — `anyChannelEnabled('email')`: nobody has switched email
 *                       on for ANY client on this deployment (or it was switched
 *                       back off)
 *   `RESEND_API_KEY`  — the Resend account is not connected on this deploy
 *   base + secret     — links cannot be built or signed, so no compliant email
 *                       can be produced at all
 *
 * ANY of them failing falls back to `fallback`, which is `StubSender`. Pure so
 * that proving it works never requires writing an ENABLED email row to a
 * database shared with production — that row is, by D-04's design, the switch
 * that starts emailing a client's customers with no deploy.
 *
 * ── NO IDENTITY CONDITION HERE, DELIBERATELY (CR-01) ────────────────────────
 *
 * This gate is DEPLOYMENT-level and holds no tenant, so it cannot sensibly ask
 * about a from-address: an address is a per-client fact. The identity question —
 * from-address, reply-to (D-01) and business name (Spam Act) — is answered
 * WHOLLY by `resolveEmailIdentity`, which returns `null` for a row that is
 * disabled, absent or incomplete, and whose refusal `ResendSender` records as
 * `email_not_configured` on the ledger. Asking it here instead read the GLOBAL
 * row for everybody, so one client's enabled override row produced a silent stub
 * for all fifteen and the one-client-at-a-time rollout could not be performed.
 */
export function chooseEmailSender(
  channelEnabled: boolean,
  creds: OptionalEmailCreds,
  fallback: TouchSender,
  resolveEmailConfig: (tenantId: string) => Promise<EmailIdentity | null> = async () => null,
): TouchSender {
  if (!channelEnabled) return fallback;

  const { apiKey, appBaseUrl, signingSecret } = creds;
  if (!apiKey || !appBaseUrl || !signingSecret) return fallback;

  return new ResendSender({ apiKey, appBaseUrl, signingSecret, resolveEmailConfig });
}
