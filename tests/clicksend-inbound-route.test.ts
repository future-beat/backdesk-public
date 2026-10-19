/**
 * The inbound webhook door: the gate in front of `handleInboundSms`, and the
 * shape of what comes back out (T-4-05, T-4-07, T-4-08, T-4-09).
 *
 * ── WHY THE 200s ARE COMPARED BYTE FOR BYTE ─────────────────────────────────
 *
 * This endpoint's authentication is a token in a URL, which means "anyone who
 * learns it can POST" is a real state, not a hypothetical. What stops that from
 * being useful is that every parseable request gets the SAME answer: a body
 * that distinguished "threaded to a live cadence" from "matched nothing" would
 * let a holder of the token sort a list of phone numbers into "currently being
 * chased by a client of this service" and "not". So the assertions below do not
 * check that each path returns 200 — they check that the four 200 bodies are
 * indistinguishable strings.
 *
 * ── AND WHY AN UNPARSEABLE BODY IS ALSO A 200 ───────────────────────────────
 *
 * The honest HTTP answer to a payload we cannot read is 400. The right product
 * answer is 200 plus a `dead_letter` row: ClickSend re-delivers on an error for
 * up to 72 hours and throttles the rule after repeated failures, so answering
 * 4xx to a shape change would degrade delivery of every OTHER customer's
 * replies as well. The row is the record; the status code is a flow-control
 * signal to a third party.
 *
 * The handler is invoked directly with `Request` objects — no dev server, no
 * database. `handleInboundSms` and `insertInboundMessage` are stubbed because
 * what is under test is the gate, the parser and the response; the threading
 * decisions have their own remote suite.
 */
import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A known token, so the suite can send a WRONG VALUE OF THE SAME LENGTH — the
 * only input that exercises `timingSafeEqual` rather than short-circuiting on
 * the length check. Injected, so this file never needs the production value: it
 * asserts the comparison, not the secret.
 */
const TOKEN = 'clicksend-token-of-exactly-forty-chars!!!';
const WRONG_SAME_LENGTH = 'WRONG-token-of-exactly-forty-chars-here!!';

vi.mock('@/core/shared/env', () => ({
  getServerEnv: () => ({ CLICKSEND_WEBHOOK_SECRET: TOKEN }),
}));

const handleInboundSms = vi.fn();
vi.mock('@/core/messaging/inbound', () => ({
  handleInboundSms: (...args: unknown[]) => handleInboundSms(...args),
}));

const insertInboundMessage = vi.fn();
vi.mock('@/db/repository', () => ({
  insertInboundMessage: (...args: unknown[]) => insertInboundMessage(...args),
}));

const { POST, maxDuration, runtime } = await import(
  '@/app/api/webhooks/clicksend/inbound/route'
);

const ROUTE_SOURCE = readFileSync(
  'src/app/api/webhooks/clicksend/inbound/route.ts',
  'utf8',
);
const PROXY_SOURCE = readFileSync('src/proxy.ts', 'utf8');

const VALID_PAYLOAD = { from: '0412345678', body: 'hi', extra_field: 1 };

function inbound(body: string, token?: string): Request {
  const url = new URL('https://example.test/api/webhooks/clicksend/inbound');
  if (token !== undefined) url.searchParams.set('token', token);

  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

beforeEach(() => {
  handleInboundSms.mockReset();
  handleInboundSms.mockResolvedValue({ kind: 'reply_unmatched', inboundId: 'inbound-1' });
  insertInboundMessage.mockReset();
  insertInboundMessage.mockResolvedValue({ id: 'dead-letter-1' });
});

/* ------------------------------------------------------------------------- *
 * The gate (T-4-05)
 * ------------------------------------------------------------------------- */

describe('inbound webhook authentication', () => {
  it('returns 401 with no token at all — and never reads the body', async () => {
    const response = await POST(inbound(JSON.stringify(VALID_PAYLOAD)));

    expect(response.status).toBe(401);
    expect(await response.text()).toBe('unauthorized');
    expect(handleInboundSms).not.toHaveBeenCalled();
    // Not even a dead letter: an unauthenticated caller must not be able to
    // make this process write a row, or the table is a free notepad.
    expect(insertInboundMessage).not.toHaveBeenCalled();
  });

  it('returns 401 for a wrong token of IDENTICAL length', async () => {
    // Same length on purpose: a length mismatch is rejected before
    // `timingSafeEqual` is reached, so an equal-length wrong value is the only
    // input that proves the comparison itself rejects.
    expect(WRONG_SAME_LENGTH.length).toBe(TOKEN.length);

    const response = await POST(
      inbound(JSON.stringify(VALID_PAYLOAD), WRONG_SAME_LENGTH),
    );

    expect(response.status).toBe(401);
    expect(handleInboundSms).not.toHaveBeenCalled();
  });

  it('returns 401 rather than throwing on a TRUNCATED token', async () => {
    // `timingSafeEqual` throws on unequal lengths. Without the pre-check this
    // is a 500 — which a monitor, and an attacker, read very differently from
    // a 401.
    const response = await POST(
      inbound(JSON.stringify(VALID_PAYLOAD), TOKEN.slice(0, 10)),
    );

    expect(response.status).toBe(401);
    expect(handleInboundSms).not.toHaveBeenCalled();
  });

  it('returns 401 for an empty token parameter', async () => {
    const response = await POST(inbound(JSON.stringify(VALID_PAYLOAD), ''));

    expect(response.status).toBe(401);
    expect(handleInboundSms).not.toHaveBeenCalled();
  });

  it('gives the same 401 body however the token is wrong', async () => {
    const bodies = await Promise.all(
      [undefined, '', TOKEN.slice(0, 10), WRONG_SAME_LENGTH].map(async (token) =>
        (await POST(inbound(JSON.stringify(VALID_PAYLOAD), token))).text(),
      ),
    );

    // "Wrong length" and "wrong value" must not be separable from outside, or
    // the 401 becomes a slow oracle over the secret's shape.
    expect(new Set(bodies).size).toBe(1);
  });

  it('never echoes the token, in any response or log', () => {
    // Read from the source rather than from a captured response: the failure
    // this guards is a debug line somebody adds later, not one that exists now.
    expect(ROUTE_SOURCE).not.toMatch(/console\.[a-z]+\([^)]*token/i);
    expect(ROUTE_SOURCE).not.toMatch(/Response\.json\([^)]*token/i);
  });
});

/* ------------------------------------------------------------------------- *
 * The happy path
 * ------------------------------------------------------------------------- */

describe('inbound webhook parsing', () => {
  it('accepts a payload with unknown fields and reaches the handler', async () => {
    const response = await POST(inbound(JSON.stringify(VALID_PAYLOAD), TOKEN));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });

    // TOLERANT: `extra_field` is not an error. ClickSend's push shape is
    // under-documented, and a strict schema would turn "they added a field"
    // into "every reply becomes a dead letter".
    expect(handleInboundSms).toHaveBeenCalledTimes(1);
    expect(handleInboundSms).toHaveBeenCalledWith({
      from: '0412345678',
      to: null,
      body: 'hi',
      providerMessageId: null,
    });
    expect(insertInboundMessage).not.toHaveBeenCalled();
  });

  it('passes through the optional fields when the provider sends them', async () => {
    await POST(
      inbound(
        JSON.stringify({
          from: '+61412345678',
          body: 'STOP',
          to: '+61480000000',
          message_id: 'CS-99',
        }),
        TOKEN,
      ),
    );

    expect(handleInboundSms).toHaveBeenCalledWith({
      from: '+61412345678',
      to: '+61480000000',
      body: 'STOP',
      providerMessageId: 'CS-99',
    });
  });

  it('accepts an EMPTY body — a blank SMS is a message, not a malformed request', async () => {
    await POST(inbound(JSON.stringify({ from: '0412345678', body: '' }), TOKEN));

    expect(handleInboundSms).toHaveBeenCalledWith(
      expect.objectContaining({ body: '' }),
    );
    expect(insertInboundMessage).not.toHaveBeenCalled();
  });

  it('awaits the handler inside the request — an opt-out is must-happen work', async () => {
    // Fire-and-forget would return 200 for suppression that never ran, and
    // ClickSend would never re-deliver it because we said we had it.
    let settled = false;
    handleInboundSms.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            settled = true;
            resolve({ kind: 'stop_unmatched', inboundId: 'x', tenantsSuppressed: 1 });
          }, 20),
        ),
    );

    await POST(inbound(JSON.stringify(VALID_PAYLOAD), TOKEN));

    expect(settled).toBe(true);
  });
});

/* ------------------------------------------------------------------------- *
 * Dead letters (T-4-07, T-4-09)
 * ------------------------------------------------------------------------- */

describe('inbound webhook dead-letter path', () => {
  it('records a NON-JSON body as a dead letter and still answers 200', async () => {
    const response = await POST(inbound('this is not json at all', TOKEN));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(handleInboundSms).not.toHaveBeenCalled();

    expect(insertInboundMessage).toHaveBeenCalledTimes(1);
    const row = insertInboundMessage.mock.calls[0][0] as Record<string, unknown>;
    expect(row.attribution).toBe('dead_letter');
    // THE BYTES ARE KEPT. This is the row somebody reads when ClickSend changes
    // their callback format; without the payload it is a tally, not a
    // diagnosis.
    expect(row.rawPayload).toEqual({ unparseable_body: 'this is not json at all' });
    // NULL, so a dead letter can never be matched by the threading lookup.
    expect(row.normalizedFrom).toBeNull();
    // Empty rather than a guess: the column is NOT NULL and a fabricated
    // address on the triage screen is worse than an obviously absent one.
    expect(row.fromAddress).toBe('');
  });

  it('records VALID JSON of an unknown shape as a dead letter, verbatim', async () => {
    const foreign = { event: 'delivery_report', payload: { id: 7 } };

    const response = await POST(inbound(JSON.stringify(foreign), TOKEN));

    expect(response.status).toBe(200);
    expect(handleInboundSms).not.toHaveBeenCalled();

    const row = insertInboundMessage.mock.calls[0][0] as Record<string, unknown>;
    expect(row.attribution).toBe('dead_letter');
    expect(row.rawPayload).toEqual(foreign);
  });

  it('dead-letters a payload missing the one field every decision needs', async () => {
    // `body` is optional-shaped in the sense that "" is legal, but `from` is
    // not: with no sender there is nobody to thread to and no address to
    // suppress, so acting on it is impossible and recording it is all there is.
    await POST(inbound(JSON.stringify({ body: 'STOP' }), TOKEN));

    expect(handleInboundSms).not.toHaveBeenCalled();
    expect(insertInboundMessage).toHaveBeenCalledTimes(1);
  });

  it('TRUNCATES an oversized payload rather than storing what the caller chose', async () => {
    const huge = { from: 12345, note: 'x'.repeat(20_000) };

    await POST(inbound(JSON.stringify(huge), TOKEN));

    const row = insertInboundMessage.mock.calls[0][0] as Record<string, unknown>;
    const stored = row.rawPayload as { oversized_payload: string };
    expect(typeof stored.oversized_payload).toBe('string');
    expect(stored.oversized_payload.length).toBe(8_000);
  });

  it('gives the SAME 200 body on every path — no attribution oracle (T-4-08)', async () => {
    handleInboundSms.mockResolvedValue({
      kind: 'stop_threaded',
      inboundId: 'i',
      tenantId: 't',
      cadenceId: 'c',
      addressesSuppressed: 2,
      touchesSkipped: 3,
      cadenceStopped: true,
    });
    const threaded = await (await POST(inbound(JSON.stringify(VALID_PAYLOAD), TOKEN))).text();

    handleInboundSms.mockResolvedValue({ kind: 'reply_unmatched', inboundId: 'i' });
    const unmatched = await (await POST(inbound(JSON.stringify(VALID_PAYLOAD), TOKEN))).text();

    handleInboundSms.mockResolvedValue({
      kind: 'reply_ambiguous',
      inboundId: 'i',
      candidateCount: 4,
    });
    const ambiguous = await (await POST(inbound(JSON.stringify(VALID_PAYLOAD), TOKEN))).text();

    const dead = await (await POST(inbound('nope', TOKEN))).text();

    // FOUR VERY DIFFERENT OUTCOMES, ONE STRING. A holder of the token learns
    // nothing about whether a given number is being chased.
    expect(new Set([threaded, unmatched, ambiguous, dead])).toEqual(
      new Set(['{"received":true}']),
    );
  });
});

/* ------------------------------------------------------------------------- *
 * Configuration and disclosure
 * ------------------------------------------------------------------------- */

describe('route configuration', () => {
  it('pins the Node runtime — node:crypto is not available on edge', () => {
    expect(runtime).toBe('nodejs');
    expect(ROUTE_SOURCE).toContain("runtime = 'nodejs'");
  });

  it('declares an explicit maxDuration', () => {
    expect(maxDuration).toBe(60);
    expect(ROUTE_SOURCE).toContain('maxDuration = 60');
  });

  it('compares the token with timingSafeEqual, not ===', () => {
    expect(ROUTE_SOURCE).toContain('timingSafeEqual');
    // A plain equality check would pass every behavioural test above while
    // leaking the token one byte at a time.
    expect(ROUTE_SOURCE).not.toMatch(/provided\s*===\s*expected/);
  });

  it('reads its OWN secret and none of the other three', () => {
    expect(ROUTE_SOURCE).toContain('getServerEnv().CLICKSEND_WEBHOOK_SECRET');
    for (const other of [
      'CADENCE_TICK_SECRET',
      'SYNC_TICK_SECRET',
      'CLICKSEND_DLR_SECRET',
      'UNSUBSCRIBE_SIGNING_SECRET',
      'MESSAGING_RECONCILE_SECRET',
      // The sixth bearer (06-02). Listed for the same reason as the five above:
      // the whole point of separate bearers is independent rotation.
      'STALLED_DIGEST_SECRET',
    ]) {
      // The whole point of four bearers is independent rotation. If this route
      // ever accepted a second value, rotating one would leave the door open.
      expect(ROUTE_SOURCE).not.toContain(other);
    }
  });

  it('interpolates ONLY ids, result kinds and lengths into its logs (T-4-08)', () => {
    // A platform log is readable by anyone with project access, forever. This
    // route holds a customer's number, their message and the webhook token on
    // every call, so the set of things that may reach a log line is pinned
    // rather than scanned for banned words — a deny-list only catches the
    // spellings somebody thought of.
    const interpolations = new Set(
      [...ROUTE_SOURCE.matchAll(/console\.\w+\(([\s\S]*?)\n\s*\);/g)].flatMap((call) =>
        [...call[1].matchAll(/\$\{([^}]*)\}/g)].map((match) => match[1].trim()),
      ),
    );

    expect(interpolations).toEqual(new Set(['result.kind', 'id', 'size']));
  });

  it('does not use waitUntil — an opt-out is must-happen work', () => {
    expect(ROUTE_SOURCE).not.toMatch(/\bwaitUntil\b\s*\(/);
    expect(ROUTE_SOURCE).toContain('await handleInboundSms(');
  });

  it('is EXCLUDED from the proxy matcher (RESEARCH Pitfall 7)', () => {
    // If the proxy stood in front of this route, an unauthenticated POST would
    // get a 307 to /login — which ClickSend records as a successful delivery.
    // Every customer's STOP would be answered "OK" and land nowhere.
    const found = PROXY_SOURCE.match(/matcher:\s*\['([^']+)'\]/);
    if (!found) throw new Error('proxy.ts no longer exposes a single-string matcher');

    const matches = (pathname: string) => new RegExp(`^${found[1]}$`).test(pathname);

    expect(matches('/api/webhooks/clicksend/inbound')).toBe(false);
    // Still guarding the console — the exclusion is API-only.
    expect(matches('/')).toBe(true);
  });
});
