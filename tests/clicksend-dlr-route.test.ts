/**
 * The delivery-receipt door: the gate in front of `applyDeliveryReceipt`, and
 * the shape of what comes back out (T-4-15, T-4-16, T-4-17).
 *
 * Deliberately the same file shape as `tests/clicksend-inbound-route.test.ts`,
 * because the route is deliberately the same route shape — token compared in
 * constant time before a byte of the body is read, tolerant parse, one uniform
 * 200. What differs is the SECRET and what a forgery can reach, and both of
 * those are what this file pins.
 *
 * ── THE PER-ENDPOINT SECRET IS THE POINT OF THE 401 TESTS ───────────────────
 *
 * There are four bearers in this system precisely so that rotating one 401s one
 * endpoint. A DLR route that accepted `CLICKSEND_WEBHOOK_SECRET` would pass
 * every behavioural test below and quietly make the two webhooks one endpoint
 * with two URLs — so the inbound secret is asserted to be REJECTED here, not
 * merely absent from the source.
 *
 * ── AND WHY AN UNREADABLE BODY WRITES NOTHING AT ALL ────────────────────────
 *
 * The inbound route dead-letters an unparseable payload because a customer's
 * reply is irreplaceable. A delivery receipt is not: it is a HINT, and the daily
 * reconciliation poll is the guarantee behind it (SYNC-03's split). So an
 * unparseable DLR is a counted log line and no row anywhere — which also means
 * a token holder cannot use this endpoint as a notepad.
 *
 * The handler is invoked directly with `Request` objects — no dev server, no
 * database.
 */
import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A known token, so the suite can send a WRONG VALUE OF THE SAME LENGTH — the
 * only input that exercises `timingSafeEqual` rather than short-circuiting on
 * the length check.
 */
const DLR_TOKEN = 'dlr-token-of-exactly-forty-characters!!!';
/** DERIVED, so "same length" cannot drift when the token above is edited. */
const WRONG_SAME_LENGTH = `W${DLR_TOKEN.slice(1)}`;
/** The OTHER webhook's secret. It must not open this door. */
const INBOUND_TOKEN = 'inbound-token-of-exactly-forty-chars!!!!';

vi.mock('@/core/shared/env', () => ({
  getServerEnv: () => ({
    CLICKSEND_DLR_SECRET: DLR_TOKEN,
    CLICKSEND_WEBHOOK_SECRET: INBOUND_TOKEN,
  }),
}));

const applyDeliveryReceipt = vi.fn();
vi.mock('@/core/messaging/receipts', () => ({
  applyDeliveryReceipt: (...args: unknown[]) => applyDeliveryReceipt(...args),
}));

const { POST, maxDuration, runtime } = await import('@/app/api/webhooks/clicksend/dlr/route');

const ROUTE_SOURCE = readFileSync('src/app/api/webhooks/clicksend/dlr/route.ts', 'utf8');
const PROXY_SOURCE = readFileSync('src/proxy.ts', 'utf8');

const VALID_PAYLOAD = {
  custom_string: '4f1b1e2c-0000-4000-8000-000000000001',
  message_id: 'CS-1',
  status_code: '201',
  status_text: 'Delivered',
  timestamp: 1_756_351_200,
  unknown_future_field: true,
};

function dlr(body: string, token?: string): Request {
  const url = new URL('https://example.test/api/webhooks/clicksend/dlr');
  if (token !== undefined) url.searchParams.set('token', token);

  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

beforeEach(() => {
  applyDeliveryReceipt.mockReset();
  applyDeliveryReceipt.mockResolvedValue({ kind: 'unmatched' });
});

/* ------------------------------------------------------------------------- *
 * The gate
 * ------------------------------------------------------------------------- */

describe('dlr webhook authentication', () => {
  it('returns 401 with no token at all — and never reads the body', async () => {
    const response = await POST(dlr(JSON.stringify(VALID_PAYLOAD)));

    expect(response.status).toBe(401);
    expect(await response.text()).toBe('unauthorized');
    expect(applyDeliveryReceipt).not.toHaveBeenCalled();
  });

  it('returns 401 for a wrong token of IDENTICAL length', async () => {
    expect(WRONG_SAME_LENGTH.length).toBe(DLR_TOKEN.length);

    const response = await POST(dlr(JSON.stringify(VALID_PAYLOAD), WRONG_SAME_LENGTH));

    expect(response.status).toBe(401);
    expect(applyDeliveryReceipt).not.toHaveBeenCalled();
  });

  it('returns 401 rather than throwing on a TRUNCATED token', async () => {
    const response = await POST(dlr(JSON.stringify(VALID_PAYLOAD), DLR_TOKEN.slice(0, 8)));

    expect(response.status).toBe(401);
  });

  it('THE PER-ENDPOINT RULE: the INBOUND webhook secret does not open this door', async () => {
    // Four bearers exist so that rotating one 401s one endpoint. A route that
    // also accepted the inbound token would make the two webhooks one endpoint
    // with two URLs — and every other assertion in this file would still pass.
    const response = await POST(dlr(JSON.stringify(VALID_PAYLOAD), INBOUND_TOKEN));

    expect(response.status).toBe(401);
    expect(applyDeliveryReceipt).not.toHaveBeenCalled();
  });

  it('gives the same 401 body however the token is wrong', async () => {
    const bodies = await Promise.all(
      [undefined, '', DLR_TOKEN.slice(0, 8), WRONG_SAME_LENGTH, INBOUND_TOKEN].map(
        async (token) => (await POST(dlr(JSON.stringify(VALID_PAYLOAD), token))).text(),
      ),
    );

    expect(new Set(bodies).size).toBe(1);
  });
});

/* ------------------------------------------------------------------------- *
 * The happy path
 * ------------------------------------------------------------------------- */

describe('dlr webhook parsing', () => {
  it('hands the whole payload to applyDeliveryReceipt and answers 200', async () => {
    applyDeliveryReceipt.mockResolvedValue({ kind: 'applied', ledgerId: 'led-1' });

    const response = await POST(dlr(JSON.stringify(VALID_PAYLOAD), DLR_TOKEN));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });

    // The route decides NOTHING. It authenticates, parses JSON, and delegates —
    // including the unknown field, because the payload shape is LOW-confidence
    // research and the tolerant schema lives one layer down.
    expect(applyDeliveryReceipt).toHaveBeenCalledTimes(1);
    expect(applyDeliveryReceipt).toHaveBeenCalledWith(VALID_PAYLOAD);
  });

  it('awaits the receipt inside the request — a 200 must mean it was recorded', async () => {
    // Fire-and-forget would acknowledge a receipt that never landed, and
    // ClickSend would never re-deliver it because we said we had it.
    let settled = false;
    applyDeliveryReceipt.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            settled = true;
            resolve({ kind: 'applied', ledgerId: 'led-1' });
          }, 20),
        ),
    );

    await POST(dlr(JSON.stringify(VALID_PAYLOAD), DLR_TOKEN));

    expect(settled).toBe(true);
  });

  it('answers 200 for a payload that matched nothing — and writes nothing', async () => {
    applyDeliveryReceipt.mockResolvedValue({ kind: 'unmatched' });

    const response = await POST(dlr(JSON.stringify(VALID_PAYLOAD), DLR_TOKEN));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
  });
});

/* ------------------------------------------------------------------------- *
 * Unparseable bodies
 * ------------------------------------------------------------------------- */

describe('dlr webhook unparseable bodies', () => {
  it('answers 200 to a NON-JSON body and never reaches the core', async () => {
    const response = await POST(dlr('this is not json at all', DLR_TOKEN));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(applyDeliveryReceipt).not.toHaveBeenCalled();
  });

  it('answers 200 to JSON with no usable key, via the core', async () => {
    applyDeliveryReceipt.mockResolvedValue({ kind: 'unparseable' });

    const response = await POST(dlr(JSON.stringify({ event: 'something_else' }), DLR_TOKEN));

    expect(response.status).toBe(200);
    expect(applyDeliveryReceipt).toHaveBeenCalledTimes(1);
  });

  it('gives the SAME 200 body on every path (T-4-16)', async () => {
    applyDeliveryReceipt.mockResolvedValue({ kind: 'applied', ledgerId: 'led-1' });
    const applied = await (await POST(dlr(JSON.stringify(VALID_PAYLOAD), DLR_TOKEN))).text();

    applyDeliveryReceipt.mockResolvedValue({ kind: 'unmatched' });
    const unmatched = await (await POST(dlr(JSON.stringify(VALID_PAYLOAD), DLR_TOKEN))).text();

    applyDeliveryReceipt.mockResolvedValue({ kind: 'unparseable' });
    const unparseable = await (await POST(dlr(JSON.stringify({ x: 1 }), DLR_TOKEN))).text();

    const garbage = await (await POST(dlr('nope', DLR_TOKEN))).text();

    // "This id belongs to a real send" is exactly the fact a token holder must
    // not be able to learn one 200 at a time.
    expect(new Set([applied, unmatched, unparseable, garbage])).toEqual(
      new Set(['{"received":true}']),
    );
  });

  it('THE TRANSPORT WE CANNOT CHOOSE: a FORM-ENCODED receipt reaches the core', async () => {
    // A receipts rule has no `webhook_type` property (the inbound rule does), so
    // ClickSend's default `post` transport applies and the body arrives
    // form-encoded. Before this branch existed, every real receipt was a
    // console.warn and four columns that stayed NULL — with a healthy-looking
    // rule in their dashboard.
    const response = await POST(
      dlr('custom_string=4f1b1e2c-0000-4000-8000-000000000001&status_text=Delivered&timestamp=1756351200', DLR_TOKEN),
    );

    expect(response.status).toBe(200);
    expect(applyDeliveryReceipt).toHaveBeenCalledWith({
      custom_string: '4f1b1e2c-0000-4000-8000-000000000001',
      status_text: 'Delivered',
      // A STRING, not a number — which the receipt schema unions for.
      timestamp: '1756351200',
    });
  });

  it('decodes percent- and plus-escapes, so a status text survives its spaces', async () => {
    await POST(dlr('message_id=CS-1&status_text=Message+not+delivered%3A+expired', DLR_TOKEN));

    expect(applyDeliveryReceipt).toHaveBeenCalledWith({
      message_id: 'CS-1',
      status_text: 'Message not delivered: expired',
    });
  });

  it('does NOT treat prose as a form — the guard that keeps garbage garbage', async () => {
    // `new URLSearchParams('this is not json at all')` yields one entry whose
    // KEY is the whole sentence. An unguarded fallback would hand that to the
    // core as a well-formed object and destroy the only signal that says
    // "ClickSend changed their format".
    await POST(dlr('this is not json at all', DLR_TOKEN));
    await POST(dlr('', DLR_TOKEN));
    await POST(dlr('   ', DLR_TOKEN));

    expect(applyDeliveryReceipt).not.toHaveBeenCalled();
  });

  it('never consults content-type — the body decides, not the sender’s claim', () => {
    // A receipt discarded for being LABELLED wrong is the expensive direction of
    // this error, and the label is a claim about a body we read regardless.
    expect(ROUTE_SOURCE).not.toContain("headers.get('content-type')");
  });

  it('records no row anywhere — this route has no write surface at all', () => {
    // Unlike the inbound route, which dead-letters. A customer's reply is
    // irreplaceable; a delivery receipt is a hint whose guarantee is the daily
    // poll, so there is nothing here worth giving a token holder a notepad for.
    expect(ROUTE_SOURCE).not.toContain('insertInboundMessage');
    expect(ROUTE_SOURCE).not.toContain('@/db/repository');
  });
});

/* ------------------------------------------------------------------------- *
 * Configuration and disclosure
 * ------------------------------------------------------------------------- */

describe('dlr route configuration', () => {
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
    expect(ROUTE_SOURCE).not.toMatch(/provided\s*===\s*expected/);
  });

  it('reads its OWN secret and none of the other four', () => {
    expect(ROUTE_SOURCE).toContain('getServerEnv().CLICKSEND_DLR_SECRET');
    for (const other of [
      'CADENCE_TICK_SECRET',
      'SYNC_TICK_SECRET',
      'CLICKSEND_WEBHOOK_SECRET',
      'UNSUBSCRIBE_SIGNING_SECRET',
      'MESSAGING_RECONCILE_SECRET',
      // The sixth bearer (06-02). Listed for the same reason as the five above:
      // the whole point of separate bearers is independent rotation.
      'STALLED_DIGEST_SECRET',
    ]) {
      expect(ROUTE_SOURCE).not.toContain(other);
    }
  });

  it('takes the token from the QUERY STRING, not an Authorization header', () => {
    // ClickSend's callback rules POST to a URL we configure and offer no way to
    // set request headers — the same correction 04-02 had to make to the
    // inbound secret's documentation. A route reading a Bearer here would 401
    // every real receipt, silently, forever.
    expect(ROUTE_SOURCE).toContain("searchParams.get('token')");
    expect(ROUTE_SOURCE).not.toMatch(/headers\.get\(\s*'authorization'/i);
  });

  it('interpolates ONLY ids and result kinds into its logs (T-4-17)', () => {
    const interpolations = new Set(
      // Matches both the single-line and the wrapped call shape — the inbound
      // route's version of this assertion only matched wrapped calls, which a
      // one-line `console.log` would have slipped past entirely.
      [...ROUTE_SOURCE.matchAll(/console\.\w+\(([\s\S]*?)\);/g)].flatMap((call) =>
        [...call[1].matchAll(/\$\{([^}]*)\}/g)].map((match) => match[1].trim()),
      ),
    );

    // A deny-list catches only the spellings somebody thought of. Pinning the
    // set makes a future `${payload.to}` a test failure rather than a customer's
    // number in a platform log.
    expect(interpolations).toEqual(new Set(['result.kind']));
  });

  it('does not use waitUntil — an acknowledged receipt is never re-delivered', () => {
    expect(ROUTE_SOURCE).not.toMatch(/\bwaitUntil\b\s*\(/);
    expect(ROUTE_SOURCE).toContain('await applyDeliveryReceipt(');
  });

  it('is EXCLUDED from the proxy matcher (RESEARCH Pitfall 7)', () => {
    const found = PROXY_SOURCE.match(/matcher:\s*\['([^']+)'\]/);
    if (!found) throw new Error('proxy.ts no longer exposes a single-string matcher');

    const matches = (pathname: string) => new RegExp(`^${found[1]}$`).test(pathname);

    expect(matches('/api/webhooks/clicksend/dlr')).toBe(false);
    expect(matches('/')).toBe(true);
  });
});
