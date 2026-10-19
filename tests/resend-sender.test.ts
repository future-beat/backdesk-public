/**
 * The email arm of the D-13 seam: `TouchSender` over Resend (MSG-02, MSG-04).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE COMPLIANCE OBLIGATIONS OF AN EMAIL ARE ASSERTED, NOT DESCRIBED.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * A follow-up email sent in a tradie's name carries three legal requirements and
 * one product one, and none of them is visible from a green tick on a send:
 *
 *   • The sender must be IDENTIFIED (Spam Act). The footer names the client
 *     business AND says Backdesk sent it on their behalf — a customer must
 *     never be unable to work out who is emailing them.
 *   • The unsubscribe must be FUNCTIONAL, both as a visible link and as RFC 8058
 *     one-click headers, because Gmail and Yahoo bulk-sender rules require the
 *     headers and the Spam Act requires the link.
 *   • Replies must reach a HUMAN (D-01). v1 captures no inbound email at all, so
 *     `Reply-To` is the tradie's own address; a missing one is a customer saying
 *     yes into a mailbox nobody reads.
 *   • The token in the header must name THIS request's cadence, or the
 *     unsubscribe suppresses somebody else's conversation.
 *
 * ── PURE, WITH THE SDK INJECTED ─────────────────────────────────────────────
 *
 * No network, no database. The client is a function the sender is handed, which
 * is what makes "the SDK was never called" assertable — and every short-circuit
 * in this file (empty body, unconfigured identity, an owner-only from-address)
 * is a case where NOT calling the provider is the entire behaviour.
 */
import { describe, expect, it, vi } from 'vitest';

import type { SendRequest } from '@/core/cadence/sender';
import type { MessagingConfigRow } from '@/db/schema';

const SECRET = 'unsubscribe-signing-secret-of-at-least-32-chars';
const API_KEY = 're_test_key';
const BASE_URL = 'https://quotes.example.test';

vi.mock('@/core/shared/env', () => ({
  getServerEnv: () => ({
    RESEND_API_KEY: API_KEY,
    APP_BASE_URL: BASE_URL,
    UNSUBSCRIBE_SIGNING_SECRET: SECRET,
    CLICKSEND_USERNAME: undefined,
    CLICKSEND_API_KEY: undefined,
  }),
}));

const getChannelConfig = vi.fn();
const anyChannelEnabled = vi.fn<(channel: string) => Promise<boolean>>(async () => false);
const tenantGet = vi.fn();
vi.mock('@/db/repository', () => ({
  getChannelConfig: (...args: unknown[]) => getChannelConfig(...args),
  anyChannelEnabled: (...args: unknown[]) => anyChannelEnabled(...(args as [string])),
  forTenant: () => ({ tenant: { get: () => tenantGet() } }),
}));

const { verifyUnsubscribeToken } = await import('@/core/messaging/unsubscribe-token');
const { ResendSender, buildEmailMessage, chooseEmailSender, isOwnerOnlySender } = await import(
  '@/core/messaging/resend-sender'
);
const { buildRoutingSender, resolveEmailIdentity } = await import(
  '@/core/messaging/routing-sender'
);
const { StubSender } = await import('@/core/cadence/sender');

const TENANT = '11111111-1111-4111-8111-111111111111';
const CADENCE = '44444444-4444-4444-8444-444444444444';

const IDENTITY = {
  fromAddress: 'followups@quotes.example.test',
  replyTo: 'dave@daveselectrical.example',
  businessName: "Dave's Electrical",
};

function request(overrides: Partial<SendRequest> = {}): SendRequest {
  return {
    ledgerId: '99999999-9999-4999-8999-999999999999',
    tenantId: TENANT,
    quoteId: '33333333-3333-4333-8333-333333333333',
    leadId: null,
    cadenceId: CADENCE,
    touchNumber: 2,
    channel: 'email',
    to: { address: 'customer@example.test', contactName: 'Sam' },
    body: 'Just checking in on the quote we sent last week.',
    ...overrides,
  };
}

interface SentPayload {
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
}

/** A stand-in for `resend.emails.send`, in the shape operator-email.ts uses. */
function clientReturning(result: unknown) {
  return vi.fn(async () => result) as unknown as never;
}

function sender(options: Record<string, unknown> = {}) {
  return new ResendSender({
    apiKey: API_KEY,
    appBaseUrl: BASE_URL,
    signingSecret: SECRET,
    resolveEmailConfig: async () => IDENTITY,
    client: clientReturning({ data: { id: 'resend-message-1' }, error: null }),
    ...options,
  });
}

/* ------------------------------------------------------------------------- *
 * The message itself — Spam Act identity, RFC 8058 headers, D-01 reply-to
 * ------------------------------------------------------------------------- */

describe('buildEmailMessage — what a customer actually receives', () => {
  const message = buildEmailMessage({
    request: request(),
    identity: IDENTITY,
    appBaseUrl: BASE_URL,
    signingSecret: SECRET,
  });

  it('sends AS the business, THROUGH Backdesk, from the verified address', () => {
    // The display name names the client and the service. Sending as a bare
    // "Backdesk" would make the customer wonder who we are; sending as a
    // bare "Dave's Electrical" from our domain is the shape a phishing filter
    // is built to distrust.
    expect(message.from).toBe(`"Dave's Electrical via Backdesk" <${IDENTITY.fromAddress}>`);
  });

  it('replies to the TRADIE, never to us (D-01)', () => {
    // v1 captures no inbound email. A customer who replies "yes please" must
    // land in the tradie's own inbox, because there is nothing on our side that
    // would ever read it.
    expect(message.replyTo).toBe(IDENTITY.replyTo);
  });

  it('carries the RFC 8058 one-click headers, spelled exactly', () => {
    expect(Object.keys(message.headers).sort()).toEqual([
      'List-Unsubscribe',
      'List-Unsubscribe-Post',
    ]);
    expect(message.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    // Angle brackets are required by the RFC; without them Gmail ignores the
    // header and the sender-reputation benefit of having it disappears.
    expect(message.headers['List-Unsubscribe']).toMatch(/^<https:\/\/\S+>$/);
  });

  it('THE TOKEN NAMES THIS REQUEST — not some other conversation', () => {
    const link = message.headers['List-Unsubscribe'].slice(1, -1);
    const token = new URL(link).searchParams.get('token') ?? '';

    // The assertion that stops the worst available bug in this file: a token
    // minted from the wrong ids unsubscribes a customer who never clicked.
    expect(verifyUnsubscribeToken(token, SECRET)).toEqual({
      tenantId: TENANT,
      cadenceId: CADENCE,
    });
  });

  it('puts the SAME link in the visible footer as in the header', () => {
    const headerLink = message.headers['List-Unsubscribe'].slice(1, -1);

    // Two spellings would be a footer link that 404s while the header one
    // works — and the footer link is the one a human clicks.
    expect(message.html).toContain(`href="${headerLink}"`);
    expect(message.text).toContain(headerLink);
  });

  it('identifies BOTH senders in the footer (Spam Act)', () => {
    expect(message.html).toContain("Dave's Electrical");
    expect(message.html).toContain('on behalf of');
    expect(message.text).toContain('on behalf of');
  });

  it('shows the reply address so the customer can answer a human', () => {
    expect(message.html).toContain(IDENTITY.replyTo);
  });

  it('names the business in the subject and nothing else', () => {
    expect(message.subject).toBe("Quote follow-up from Dave's Electrical");
  });

  it('carries the body VERBATIM as text — no truncation, no rewriting', () => {
    const long = 'x'.repeat(3_000);
    const built = buildEmailMessage({
      request: request({ body: long }),
      identity: IDENTITY,
      appBaseUrl: BASE_URL,
      signingSecret: SECRET,
    });

    // The same byte-exact assertion 04-03 makes about a 220-character SMS, for
    // the same reason: Phase 5 hands this field an operator-approved draft, and
    // a display truncation added later would silently send a different message
    // from the one a human signed off.
    expect(built.text).toContain(long);
  });

  it('ESCAPES the body into the html — a quote is not markup', () => {
    const built = buildEmailMessage({
      request: request({ body: 'Ready to go <b>now</b>? Call us & say "yes".' }),
      identity: IDENTITY,
      appBaseUrl: BASE_URL,
      signingSecret: SECRET,
    });

    expect(built.html).toContain('&lt;b&gt;now&lt;/b&gt;');
    expect(built.html).toContain('&amp;');
    expect(built.html).not.toContain('<b>now</b>');
  });

  it('REFUSES to let a business name inject a header', () => {
    const built = buildEmailMessage({
      request: request(),
      identity: {
        ...IDENTITY,
        businessName: 'Evil\r\nBcc: everyone@example.test <hack>',
      },
      appBaseUrl: BASE_URL,
      signingSecret: SECRET,
    });

    // `business_name` is operator-typed and lands in a From header. A newline in
    // a header value is an injected header; `<` and `"` break the display-name
    // quoting around it.
    // THE INJECTION IS THE NEWLINE, not the word. `Bcc:` sitting inside a
    // quoted display name on one line is odd-looking text and nothing more —
    // stripping words an operator typed would be a worse rule, because the
    // display name is what identifies the sender to the customer. What must not
    // survive is a line break (which starts a new header) or a quote/angle
    // bracket (which ends the display name and opens the address beside it).
    expect(built.from).not.toMatch(/[\r\n]/);
    // Exactly two quotes — one at each end of the display name — and no angle
    // bracket inside it, so the `<address>` beside it cannot be rewritten.
    expect(built.from.match(/"/g)).toHaveLength(2);
    expect(built.from.slice(1, built.from.lastIndexOf('"'))).not.toMatch(/[<>]/);
    expect(built.from).toBe(
      `"Evil Bcc: everyone@example.test hack via Backdesk" <${IDENTITY.fromAddress}>`,
    );
  });
});

/* ------------------------------------------------------------------------- *
 * The outcome union — nothing throws (D-13)
 * ------------------------------------------------------------------------- */

describe('ResendSender — the outcome union', () => {
  it('records the provider verbatim for the ledger', () => {
    expect(sender().provider).toBe('resend');
  });

  it('maps a message id to sent', async () => {
    const outcome = await sender().send(request());

    expect(outcome).toEqual({
      kind: 'sent',
      provider: 'resend',
      providerMessageId: 'resend-message-1',
    });
  });

  it('maps an SDK error to failed by NAME ONLY', async () => {
    const outcome = await sender({
      client: clientReturning({
        data: null,
        error: { name: 'validation_error', message: 'The quotes@ domain is not verified' },
      }),
    }).send(request());

    expect(outcome).toEqual({
      kind: 'failed',
      provider: 'resend',
      reason: 'validation_error',
      retryable: true,
    });
    // The MESSAGE must not travel: Resend's prose echoes our request back at
    // us, and our request contains a customer's address.
    expect(JSON.stringify(outcome)).not.toContain('quotes@');
  });

  it('maps an errorless response with no id to failed rather than to sent', async () => {
    const outcome = await sender({ client: clientReturning({ data: null, error: null }) }).send(
      request(),
    );

    // "The provider said nothing" is not "the provider accepted it". Recording
    // it as sent would put a row in the ledger that Phase 7 counts as delivered.
    expect(outcome).toMatchObject({ kind: 'failed', provider: 'resend' });
  });

  it('does not throw when the SDK does', async () => {
    const outcome = await sender({
      client: vi.fn(async () => {
        throw new TypeError('fetch failed: getaddrinfo ENOTFOUND api.resend.com');
      }) as unknown as never,
    }).send(request());

    // A throw escaping here strands every REMAINING claimed touch this tick with
    // `outcome IS NULL` — rows an operator sees and nothing auto-resends.
    expect(outcome).toEqual({
      kind: 'failed',
      provider: 'resend',
      reason: 'TypeError',
      retryable: true,
    });
    expect(JSON.stringify(outcome)).not.toContain('resend.com');
  });
});

describe('ResendSender — the refusals that never reach the provider', () => {
  it.each([
    ['an empty body', { body: '' }],
    ['a whitespace-only body', { body: '   \n\t ' }],
  ])('refuses %s with NO provider call', async (_name, overrides) => {
    const client = vi.fn();
    const outcome = await sender({ client }).send(request(overrides));

    // A blank email from a tradie cannot be un-sent and makes the client look
    // broken. Checking after the provider call would still have sent it.
    expect(outcome).toEqual({
      kind: 'failed',
      provider: 'resend',
      reason: 'empty_body',
      retryable: false,
    });
    expect(client).not.toHaveBeenCalled();
  });

  it.each([
    ['no config row for the tenant', null],
    ['no from-address', { ...IDENTITY, fromAddress: '' }],
    ['no reply-to (D-01)', { ...IDENTITY, replyTo: '' }],
    ['no business name (Spam Act)', { ...IDENTITY, businessName: '  ' }],
    ['a from-address that is not an address', { ...IDENTITY, fromAddress: 'not-an-address' }],
    ['a reply-to that is not an address', { ...IDENTITY, replyTo: 'nobody@' }],
  ])('refuses %s with NO provider call', async (_name, identity) => {
    const client = vi.fn();
    const outcome = await sender({
      client,
      resolveEmailConfig: async () => identity,
    }).send(request());

    expect(outcome).toEqual({
      kind: 'failed',
      provider: 'resend',
      reason: 'email_not_configured',
      retryable: false,
    });
    expect(client).not.toHaveBeenCalled();
  });

  it('refuses when there is no base URL to build an unsubscribe link from', async () => {
    const client = vi.fn();
    const outcome = await sender({ client, appBaseUrl: '' }).send(request());

    // A relative or localhost unsubscribe link in a real customer's inbox is a
    // Spam Act breach wearing a working-code disguise. Refusing to send at all
    // is the only honest answer — there is no degraded email worth sending.
    expect(outcome).toMatchObject({ reason: 'email_not_configured', retryable: false });
    expect(client).not.toHaveBeenCalled();
  });

  it('refuses when the signing secret is unusable', async () => {
    const client = vi.fn();
    const outcome = await sender({ client, signingSecret: 'short' }).send(request());

    // An unsubscribe link signed with a weak key is a suppression anybody can
    // forge. Sending the email anyway would put that link in an inbox.
    expect(outcome).toMatchObject({ reason: 'email_not_configured', retryable: false });
    expect(client).not.toHaveBeenCalled();
  });

  it('REFUSES the owner-only resend.dev sender for customer mail', async () => {
    const client = vi.fn();
    const outcome = await sender({
      client,
      resolveEmailConfig: async () => ({ ...IDENTITY, fromAddress: 'onboarding@resend.dev' }),
    }).send(request());

    // Resend permits its onboarding sender only to the account owner's own
    // inbox. A customer-facing send from it does not arrive — and if it ever
    // did, it would identify the wrong business entirely.
    expect(outcome).toMatchObject({ reason: 'owner_only_sender', retryable: false });
    expect(client).not.toHaveBeenCalled();
  });

  it.each([
    ['angle brackets only', '<>'],
    ['quotation marks only', '""'],
    ['a lone backslash', '\\'],
    ['every stripped character at once', '<"">\\'],
    ['a control character only', '\u0001'],
  ])(
    'REFUSES a business name of %s — it sanitises to nothing, and nothing identifies nobody',
    async (_name, businessName) => {
      const client = vi.fn();
      const outcome = await sender({
        client,
        resolveEmailConfig: async () => ({ ...IDENTITY, businessName }),
      }).send(request());

      // `usableIdentity` only sees the RAW string, and each of these passes its
      // `trim() !== ''` gate — as does the settings form's
      // `z.string().trim().max(120)`. The sanitiser then strips all of it.
      //
      // Sent, this would carry `From: " via Backdesk"`, `Subject: Quote follow-up
      // from ` and the footer `Sent by Backdesk on behalf of .` — the Spam Act
      // sender identification missing from all three surfaces at once. The file
      // header's promise is that such a send is REFUSED rather than degraded.
      expect(outcome).toMatchObject({ reason: 'unidentified_sender', retryable: false });
      expect(client).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['the onboarding sender itself', 'onboarding@resend.dev', true],
    ['a subdomain of it', 'noreply@mail.resend.dev', true],
    ['a verified client domain', 'followups@quotes.example.test', false],
    ['a lookalike that is not it', 'hi@notresend.dev.example', false],
    ['a string that is not an address', 'resend.dev', false],
  ])('isOwnerOnlySender recognises %s', (_name, address, expected) => {
    // THE SAME PREDICATE `scripts/verify-email-pipe.mjs` asks before it sends.
    // Proving the script's refusal by driving the script would mean writing an
    // ENABLED email row with a resend.dev from-address to a database shared with
    // production — which is, by D-04's design, the switch that starts emailing
    // fifteen clients' customers. So the rule is proven where it lives, once,
    // and both callers ask it rather than spelling it themselves.
    expect(isOwnerOnlySender(address)).toBe(expected);
  });

  it('passes the built message to the provider unchanged', async () => {
    const client = vi.fn(async () => ({ data: { id: 'x' }, error: null }));
    await sender({ client: client as unknown as never }).send(request());

    expect(client).toHaveBeenCalledTimes(1);
    const payload = (client.mock.calls[0] as unknown[])[0] as SentPayload;

    expect(payload.to).toBe('customer@example.test');
    expect(payload.replyTo).toBe(IDENTITY.replyTo);
    expect(payload.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });
});

/* ------------------------------------------------------------------------- *
 * The activation gate — the same shape as chooseSmsSender (D-04)
 * ------------------------------------------------------------------------- */

describe('chooseEmailSender — the D-04 activation gate for email', () => {
  const CREDS = { apiKey: API_KEY, appBaseUrl: BASE_URL, signingSecret: SECRET };
  const fallback = new StubSender();

  it.each([
    { name: 'email enabled nowhere, fully credentialed', enabled: false, creds: CREDS },
    { name: 'no Resend api key on this deploy', enabled: true, creds: { ...CREDS, apiKey: undefined } },
    { name: 'no APP_BASE_URL to build links from', enabled: true, creds: { ...CREDS, appBaseUrl: undefined } },
    { name: 'no signing secret', enabled: true, creds: { ...CREDS, signingSecret: undefined } },
  ])('falls back to the stub for $name', ({ enabled, creds }) => {
    expect(chooseEmailSender(enabled, creds, fallback)).toBe(fallback);
  });

  it('builds a ResendSender once email is armed anywhere and credentialed', () => {
    // No from-address appears in this call at all — the identity question moved
    // WHOLLY to `resolveEmailIdentity`, whose null is a RECORDED
    // `email_not_configured` refusal per tenant rather than a silent stub for
    // every tenant at once (CR-01).
    const chosen = chooseEmailSender(true, CREDS, fallback);

    expect(chosen).not.toBe(fallback);
    expect(chosen.provider).toBe('resend');
  });
});

describe('buildRoutingSender — production stays stub-only until a row is enabled', () => {
  it('leaves both delegates on the stub while no row is enabled anywhere', async () => {
    anyChannelEnabled.mockReset();
    anyChannelEnabled.mockResolvedValue(false);

    const routing = await buildRoutingSender();

    // THE PRODUCTION INVARIANT. With no enabled `messaging_config` row for a
    // channel, that delegate is the stub and dispatch behaves byte-identically
    // to Phase 3.
    expect(routing.providerFor('email')).toBe('stub');
    expect(routing.providerFor('sms')).toBe('stub');
  });

  it('arms the email delegate when email is enabled ANYWHERE — global row or one tenant (CR-01)', async () => {
    anyChannelEnabled.mockReset();
    anyChannelEnabled.mockImplementation(async (channel: string) => channel === 'email');

    const routing = await buildRoutingSender();

    // The deployment-level gate does not care WHICH row is enabled. That is the
    // fix: a single tenant's override row with the global row off now arms the
    // real provider, and the per-tenant resolver refuses every other client.
    expect(routing.providerFor('email')).toBe('resend');
    expect(routing.providerFor('sms')).toBe('stub');
  });

  it('never asks getChannelConfig without a tenant — the gate is anyChannelEnabled', async () => {
    anyChannelEnabled.mockReset();
    anyChannelEnabled.mockResolvedValue(false);
    getChannelConfig.mockReset();
    getChannelConfig.mockResolvedValue(null);

    await buildRoutingSender();

    // The tenant-less read WAS the CR-01 defect: it consults the global row
    // alone, so an enabled tenant override was invisible to the gate.
    expect(getChannelConfig).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------- *
 * The resolver — the only piece that reads the database
 * ------------------------------------------------------------------------- */

describe('resolveEmailIdentity — per-tenant identity, resolved outside the sender', () => {
  function row(overrides: Partial<MessagingConfigRow> = {}): MessagingConfigRow {
    return {
      id: 'cfg',
      tenantId: null,
      channel: 'email',
      fromAddress: 'followups@quotes.example.test',
      replyTo: 'dave@daveselectrical.example',
      businessName: "Dave's Electrical",
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  it('returns the row identity and never asks about the tenant', async () => {
    getChannelConfig.mockReset();
    getChannelConfig.mockResolvedValue(row());
    tenantGet.mockReset();

    expect(await resolveEmailIdentity(TENANT)).toEqual(IDENTITY);
    // The name is on the row; reading `tenants` for it would be a query per
    // message for a value we already hold.
    expect(tenantGet).not.toHaveBeenCalled();
  });

  it('falls back to the TENANT NAME when the row carries no business name', async () => {
    getChannelConfig.mockReset();
    getChannelConfig.mockResolvedValue(row({ businessName: null }));
    tenantGet.mockReset();
    tenantGet.mockResolvedValue([{ id: TENANT, name: 'Fallback Plumbing' }]);

    // The fallback lives HERE and not in the sender, which is what keeps
    // `resend-sender.ts` free of database reads — the same split
    // `resolveSmsFrom` makes for ClickSend.
    expect(await resolveEmailIdentity(TENANT)).toEqual({
      ...IDENTITY,
      businessName: 'Fallback Plumbing',
    });
  });

  it.each([
    ['there is no row', null, []],
    ['the row is disabled for this tenant', row({ enabled: false }), []],
    ['no name can be found anywhere (Spam Act)', row({ businessName: null }), []],
  ])('refuses when %s', async (_name, config, tenantRows) => {
    getChannelConfig.mockReset();
    getChannelConfig.mockResolvedValue(config);
    tenantGet.mockReset();
    tenantGet.mockResolvedValue(tenantRows);

    // A per-tenant `enabled = false` means STOP, not "use the global row
    // instead" — the same reading `resolveSmsFrom` gives it. Without that,
    // turning one client's email off would mean turning all fifteen off.
    expect(await resolveEmailIdentity(TENANT)).toBeNull();
  });
});
