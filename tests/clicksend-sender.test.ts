/**
 * The first real provider behind the D-13 seam, and the eight ways a send can
 * end. PURE — no database, no network: `fetch` is stubbed.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE CONTRACT UNDER TEST IS "NOTHING THROWS", AND IT IS NOT A STYLE RULE. │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `performSends` (dispatch.ts) loops over every touch the claim transactions
 * committed to. A sender that throws would strand every REMAINING claimed touch
 * in that loop with `outcome IS NULL` — rows that are surfaced to the operator
 * and never auto-resent, i.e. one bad phone number silently costing a whole
 * tick's follow-ups for every other client. Dispatch does wrap the call, so the
 * damage is bounded; that wrapper exists as a backstop and this suite exists so
 * it is never reached. Every failure mode below resolves to a `failed` outcome.
 *
 * ── WHY THE TESTS GO THROUGH THE REAL CLIENT WITH A STUBBED `fetch` ─────────
 *
 * `ClickSendSender` takes its client by injection, so it would be easy to test
 * the sender against a fake client and the client against a fake fetch, and
 * prove both halves while the WIRING between them stays unasserted. Two of the
 * behaviour rows are about exactly that wiring: `custom_string` must equal the
 * ledger id (it is how a delivery receipt finds its row in 04-04) and `from`
 * must be the resolved config number. So the default path here is the real
 * client with `fetch` stubbed, and injection is used only for the case a stub
 * fetch cannot produce — a client that throws.
 *
 * ── THE BODY IS COMPARED WITH `toBe`, DELIBERATELY ─────────────────────────
 *
 * A 220-character body crosses the 160-character SMS segment boundary and an
 * emoji forces UCS-2. Both are the provider's problem, not ours: our job is to
 * hand over the approved text unchanged. `toBe` on the exact string is what
 * catches a well-meaning `.slice(0, 160)` or a normalization added later —
 * assertions like `toContain` or a length check would pass on truncated text,
 * which is a message that reaches a customer mid-sentence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sendSms } from '../src/core/messaging/clicksend-client';
import { ClickSendSender } from '../src/core/messaging/clicksend-sender';
import type { SendRequest } from '../src/core/cadence/sender';

const CREDS = { username: 'test-user', apiKey: 'test-key' };

/** The dedicated AU virtual number, as `messaging_config.from_address` holds it. */
const FROM = '+61491570156';

/**
 * A request as dispatch builds one. The recipient is from the `0491 570 1xx`
 * block ACMA reserves for fiction — nothing here sends, but a real number in a
 * fixture is a real number somebody eventually pastes into a live call.
 */
function request(overrides: Partial<SendRequest> = {}): SendRequest {
  return {
    ledgerId: '11111111-1111-4111-8111-111111111111',
    tenantId: '22222222-2222-4222-8222-222222222222',
    quoteId: '33333333-3333-4333-8333-333333333333',
    leadId: null,
    cadenceId: '44444444-4444-4444-8444-444444444444',
    touchNumber: 2,
    channel: 'sms',
    to: { address: '+61491570157', contactName: 'Dana' },
    body: 'Hi Dana, just following up on that quote.',
    ...overrides,
  };
}

/** A ClickSend 200 with one message in it. */
function accepted(messageId = 'CS-MSG-1', status = 'SUCCESS') {
  return {
    http_code: 200,
    response_code: 'SUCCESS',
    data: { messages: [{ message_id: messageId, status }] },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** The sender under test, wired to the REAL client. */
function sender(from: string | null = FROM) {
  return new ClickSendSender({
    creds: CREDS,
    resolveSmsFrom: async () => from,
  });
}

/** The single JSON payload the stubbed fetch was handed. */
function sentPayload(mock: ReturnType<typeof vi.fn>) {
  expect(mock, 'fetch was never called').toHaveBeenCalledTimes(1);
  const init = mock.mock.calls[0][1] as RequestInit;
  return JSON.parse(String(init.body)) as {
    messages: { to: string; from: string; body: string; source: string; custom_string: string }[];
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ClickSendSender — the outcome union', () => {
  it('maps a 200 with a message_id to sent, carrying the provider id', async () => {
    fetchMock.mockResolvedValue(jsonResponse(accepted('CS-ABC-123')));

    const outcome = await sender().send(request());

    expect(outcome).toEqual({
      kind: 'sent',
      provider: 'clicksend',
      providerMessageId: 'CS-ABC-123',
    });
  });

  it('maps a 200 carrying a per-message ERROR status to failed, not retryable', async () => {
    // The provider ACCEPTED the request and REFUSED the message. Retrying it
    // would produce the same refusal, so `retryable` is false — and D-07 means
    // nothing auto-retries anyway; the flag exists to tell an operator whether
    // asking again could plausibly differ.
    fetchMock.mockResolvedValue(
      jsonResponse({
        http_code: 200,
        response_code: 'SUCCESS',
        data: { messages: [{ message_id: null, status: 'INVALID_RECIPIENT' }] },
      }),
    );

    const outcome = await sender().send(request());

    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') return;
    expect(outcome.provider).toBe('clicksend');
    expect(outcome.reason).toBe('INVALID_RECIPIENT');
    expect(outcome.retryable).toBe(false);
  });

  it('maps a per-message opt-out status to recipient_opted_out (04-04 evidence)', async () => {
    // ClickSend maintains its own opt-out list, so a message can be refused for
    // a reason our `suppressed_contacts` table has never heard of. The
    // reconciliation sweep (04-04) turns these into suppression evidence, which
    // is only possible if the reason is a STABLE label rather than whatever the
    // provider called it that day.
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: { messages: [{ message_id: null, status: 'OPT_OUT_RECIPIENT' }] },
      }),
    );

    const outcome = await sender().send(request());

    expect(outcome).toEqual({
      kind: 'failed',
      provider: 'clicksend',
      reason: 'recipient_opted_out',
      retryable: false,
    });
  });

  it.each([
    { status: 401, retryable: false, why: 'our credentials are wrong; asking again cannot fix it' },
    { status: 400, retryable: false, why: 'we sent something malformed' },
    { status: 429, retryable: true, why: 'rate limited — later is a different answer' },
    { status: 500, retryable: true, why: 'their side; later is a different answer' },
    { status: 503, retryable: true, why: 'their side' },
  ])('maps HTTP $status to failed(http_$status), retryable=$retryable', async (row) => {
    fetchMock.mockResolvedValue(new Response('nope', { status: row.status }));

    const outcome = await sender().send(request());

    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') return;
    expect(outcome.reason, row.why).toBe(`http_${row.status}`);
    expect(outcome.retryable, row.why).toBe(row.retryable);
  });

  it('maps a thrown fetch to failed carrying the error NAME only', async () => {
    // NOT `String(e)` and not the message: a fetch rejection can stringify to
    // something containing the request URL, and this string is written to a log
    // and rendered to an operator. The ServiceM8 client's invariant, one
    // boundary over (T-4-10, T-4-14).
    const boom = new Error('connect ECONNREFUSED 10.1.2.3:443 for +61491570157');
    boom.name = 'TypeError';
    fetchMock.mockRejectedValue(boom);

    const outcome = await sender().send(request());

    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') return;
    expect(outcome.reason).toBe('TypeError');
    expect(outcome.retryable).toBe(true);
    expect(outcome.reason).not.toContain('ECONNREFUSED');
    expect(outcome.reason).not.toContain('61491570157');
  });

  it('never lets a throw escape send() — even from the client itself', async () => {
    // The stubbed `fetch` above covers a network failure. This covers the case
    // a stub fetch cannot produce: a bug INSIDE the client, or a future client
    // that throws for a reason nobody anticipated. `performSends` iterates, so
    // an escape here costs every remaining touch in the tick.
    const exploding = (async () => {
      throw new Error('client is broken');
    }) as unknown as typeof sendSms;

    const outcome = await new ClickSendSender({
      creds: CREDS,
      resolveSmsFrom: async () => FROM,
      client: exploding,
    }).send(request());

    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') return;
    expect(outcome.reason).toBe('Error');
    expect(outcome.retryable).toBe(true);
  });
});

describe('ClickSendSender — the refusals that never reach the network', () => {
  it.each(['', '   ', '\n\t  \n'])(
    'refuses a whitespace-only body (%j) with NO http call',
    async (body) => {
      // A blank SMS is a message a customer receives from a tradie that says
      // nothing. It cannot be un-sent, it costs a segment, and it makes the
      // tradie look broken. The assertion that matters is the second one:
      // returning `failed` after calling the provider would still have sent it.
      const outcome = await sender().send(request({ body }));

      expect(outcome).toEqual({
        kind: 'failed',
        provider: 'clicksend',
        reason: 'empty_body',
        retryable: false,
      });
      expect(fetchMock, 'a blank body reached the provider').not.toHaveBeenCalled();
    },
  );

  it('refuses with sms_not_configured when no from-number is resolved', async () => {
    // The IPND-blocked number (D-08) arriving as `null`. This is the state
    // production is in until 04-07, and it must be an honest recorded refusal
    // rather than a send from `undefined`.
    const outcome = await sender(null).send(request());

    expect(outcome).toEqual({
      kind: 'failed',
      provider: 'clicksend',
      reason: 'sms_not_configured',
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('ClickSendSender — what actually crosses the wire', () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(jsonResponse(accepted()));
  });

  it('sends custom_string = ledgerId, and the resolved from-number', async () => {
    // `custom_string` is how a delivery receipt finds its ledger row in 04-04.
    // Without it a DLR carries a provider id we would have to have stored and
    // an address we must not search on.
    const req = request();
    await sender().send(req);

    const [message] = sentPayload(fetchMock).messages;
    expect(message.custom_string).toBe(req.ledgerId);
    expect(message.from).toBe(FROM);
    expect(message.to).toBe(req.to.address);
    expect(message.source).toBe('backdesk');
  });

  it('transmits a 220-character body byte-identical (no segment truncation)', async () => {
    const long = 'A'.repeat(219) + 'Z';
    expect(long).toHaveLength(220);

    await sender().send(request({ body: long }));

    expect(sentPayload(fetchMock).messages[0].body).toBe(long);
  });

  it('transmits a unicode/emoji body byte-identical (no charset transformation)', async () => {
    const unicode = 'G’day Dana 👍 — your quote’s ready. Café… ✅';

    await sender().send(request({ body: unicode }));

    expect(sentPayload(fetchMock).messages[0].body).toBe(unicode);
  });

  it('authenticates with HTTP Basic and posts to the documented endpoint', async () => {
    await sender().send(request());

    const [url, init] = fetchMock.mock.calls[0] as [string | URL, RequestInit];
    expect(String(url)).toBe('https://rest.clicksend.com/v3/sms/send');
    expect(init.method).toBe('POST');

    const headers = new Headers(init.headers);
    const expected = `Basic ${Buffer.from(`${CREDS.username}:${CREDS.apiKey}`).toString('base64')}`;
    expect(headers.get('authorization')).toBe(expected);
    expect(headers.get('content-type')).toContain('application/json');
  });
});

describe('ClickSendSender — the boundary is framework-free and database-free', () => {
  /**
   * The sender.ts rule, asserted rather than documented: a sender is handed
   * everything it needs, sends, and answers. An import of `next/*` would make
   * this unreachable from a script; an import of `src/db/*` would put a query
   * inside the loop dispatch deliberately runs OUTSIDE its transaction, holding
   * a pooled connection open across a third-party HTTP call.
   */
  it.each(['clicksend-sender', 'clicksend-client'])(
    '%s imports nothing from next/* or src/db/*',
    async (file) => {
      const { readFileSync } = await import('node:fs');
      const source = readFileSync(`src/core/messaging/${file}.ts`, 'utf8');

      const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);

      for (const specifier of imports) {
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(/^next\//);
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(/^@\/db\//);
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(/\/db\//);
      }
    },
  );

  /**
   * T-4-14, and the reason it is pinned rather than scanned for banned words.
   *
   * A deny-list catches only the spellings somebody thought of; the failure mode
   * is a future `${request.to.address}` added to a debug line during an incident,
   * which is when logging feels most justified. Pinning the SET of interpolated
   * expressions makes any new one a test failure that has to be argued for. The
   * pattern 04-02 established for `inbound.ts`.
   */
  it('interpolates ONLY ids, counts and outcome kinds into its log lines', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/core/messaging/clicksend-sender.ts', 'utf8');

    const interpolated = [...source.matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1].trim()).sort();

    expect(
      interpolated,
      'A new expression is interpolated into a clicksend-sender log line. If it ' +
        'can carry a phone number, a message body or a credential, it must not ' +
        'be there — platform logs have no tenant scoping and are not deletable ' +
        'per customer.',
    ).toEqual([
      'outcome.kind',
      'request.body.length',
      'request.cadenceId',
      'request.ledgerId',
      'request.touchNumber',
    ]);
  });
});

/* ------------------------------------------------------------------------- *
 * The inbound BACKSTOP poll — pinned to the endpoint that actually holds the
 * messages, because the obvious one is empty exactly when it is needed.
 * ------------------------------------------------------------------------- */
describe('listInboundSms — the T-4-28 backstop reads /sms/history', () => {
  /** A history page as ClickSend returns one: inbound and outbound together. */
  function historyPage(rows: unknown[]): Response {
    return jsonResponse({
      http_code: 200,
      response_code: 'SUCCESS',
      data: { data: rows, last_page: 1, total: rows.length },
    });
  }

  const REPLY = {
    direction: 'in',
    message_id: 'IN-REPLY-1',
    from: '+61491570199',
    to: FROM,
    body: 'sounds good',
    date: 1_788_023_145,
  };

  const STOP = {
    direction: 'in',
    message_id: 'IN-STOP-1',
    from: '+61491570199',
    to: FROM,
    body: 'STOP',
    date: 1_788_023_156,
  };

  const OUR_OWN_FOLLOW_UP = {
    direction: 'out',
    message_id: 'OUT-1',
    from: FROM,
    to: '+61491570199',
    body: 'follow-up. Reply STOP to opt out.',
    status: 'Sent',
    status_code: '201',
    custom_string: '11111111-1111-4111-8111-111111111111',
    date: 1_788_023_160,
  };

  /**
   * The finding this test exists for, measured on the live account 2026-08-30:
   * `GET /v3/sms/inbound` returned total 0 over an explicit three-day window
   * while both real inbound messages sat in `/v3/sms/history` with
   * `direction: 'in'`. The endpoints behave as pull queues an automation rule
   * drains — so the poll that exists to recover a STOP an automation rule
   * SWALLOWED was reading the one resource that is blank in that exact case.
   */
  it('polls /v3/sms/history, not the pull-queue /v3/sms/inbound', async () => {
    fetchMock.mockResolvedValue(historyPage([REPLY]));

    const { listInboundSms } = await import('../src/core/messaging/clicksend-client');
    await listInboundSms({ creds: CREDS, since: new Date(0), now: new Date(1_788_023_200_000) });

    const [url] = fetchMock.mock.calls[0] as [string | URL];
    expect(String(url)).toContain('https://rest.clicksend.com/v3/sms/history');
    expect(String(url)).not.toContain('/v3/sms/inbound');
  });

  it('returns the inbound rows and DROPS our own outbound follow-ups', async () => {
    fetchMock.mockResolvedValue(historyPage([OUR_OWN_FOLLOW_UP, REPLY, STOP]));

    const { listInboundSms } = await import('../src/core/messaging/clicksend-client');
    const result = await listInboundSms({
      creds: CREDS,
      since: new Date(0),
      now: new Date(1_788_023_200_000),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Replaying an outbound row would re-enter handleInboundSms with OUR
    // dedicated number as the sender: it threads to nothing and lands on the
    // operator's triage screen as an unattributed reply, once per sweep.
    expect(result.items.map((i) => i.messageId)).toEqual(['IN-REPLY-1', 'IN-STOP-1']);
    expect(result.items[1].body).toBe('STOP');
  });

  it('drops a row with NO direction rather than guessing (the resource is half outbound)', async () => {
    fetchMock.mockResolvedValue(historyPage([{ ...REPLY, direction: undefined }]));

    const { listInboundSms } = await import('../src/core/messaging/clicksend-client');
    const result = await listInboundSms({
      creds: CREDS,
      since: new Date(0),
      now: new Date(1_788_023_200_000),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items).toEqual([]);
  });
});
