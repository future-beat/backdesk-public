/**
 * The one-click unsubscribe door: the token, and the endpoint that cannot be
 * asked a question (MSG-02, MSG-03, T-4-19, T-4-20, T-4-21).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS ENDPOINT IS PUBLIC AND MUST NOT BE AN ORACLE.                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `/api/unsubscribe` has no authentication beyond a token that arrives in a
 * customer's inbox. Two properties make that safe, and both are asserted here
 * rather than reasoned about:
 *
 *   1. POSSESSION IMPLIES RECEIPT (T-4-19). The token is an HMAC over
 *      (tenantId, cadenceId) minted at SEND time. There is no address-keyed,
 *      id-keyed or enumerable path into this endpoint, so "suppress an arbitrary
 *      victim" has no expression — you can only unsubscribe a conversation you
 *      were sent an email about.
 *
 *   2. EVERY ANSWER IS THE SAME ANSWER (T-4-20). A valid token, a forged one, a
 *      malformed one and a replay after suppression all produce a BYTE-IDENTICAL
 *      200. A body that differed would let anyone holding a list of guessed
 *      tokens — or, worse, anyone probing the shape of a real one — learn which
 *      ones name a live cadence. So the assertions below do not check that each
 *      path returns 200; they check that the bodies are indistinguishable
 *      strings, with `toBe`.
 *
 * ── PURE. THE REMOTE HALF IS `tests/unsubscribe-suppression.test.ts` ────────
 *
 * `suppressFromInbound` is mocked here because what is under test is the token,
 * the gate and the response. Whether a real POST writes both channels verbatim
 * to `suppressed_contacts` and stops the cadence is a question only the hosted
 * database can answer, and `helpers/seed` reaches for its credentials at module
 * scope — so a single file holding both halves would be refused by the WR-09
 * guard on a bare `npm test` and the pure assertions would become unrunnable.
 * Same split 04-02 made between `clicksend-inbound-route.test.ts` and
 * `inbound-threading.test.ts`, and 04-03 between `routing-sender` and
 * `routing-dispatch`.
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A known signing secret, so this suite can forge a MAC of the RIGHT LENGTH
 * under the WRONG KEY — the only input that exercises `timingSafeEqual` instead
 * of short-circuiting on the length guard. Injected, so this file never needs
 * the production value: it asserts the comparison, not the secret.
 */
const SECRET = 'unsubscribe-signing-secret-of-at-least-32-chars';
const OTHER_SECRET = 'a-completely-different-secret-of-32-plus-chars';

vi.mock('@/core/shared/env', () => ({
  getServerEnv: () => ({ UNSUBSCRIBE_SIGNING_SECRET: SECRET }),
}));

const suppressFromInbound = vi.fn();
vi.mock('@/core/cadence/controls', () => ({
  suppressFromInbound: (...args: unknown[]) => suppressFromInbound(...args),
}));

const { mintUnsubscribeToken, verifyUnsubscribeToken, unsubscribeUrl } = await import(
  '@/core/messaging/unsubscribe-token'
);
const { GET, POST, runtime } = await import('@/app/api/unsubscribe/route');

const ROUTE_SOURCE = readFileSync('src/app/api/unsubscribe/route.ts', 'utf8');
const PROXY_SOURCE = readFileSync('src/proxy.ts', 'utf8');

const TENANT = '11111111-1111-4111-8111-111111111111';
const CADENCE = '44444444-4444-4444-8444-444444444444';
const SUBJECT = { tenantId: TENANT, cadenceId: CADENCE };

const BASE = 'https://quotes.example.test';

function url(token?: string): URL {
  const target = new URL('/api/unsubscribe', BASE);
  if (token !== undefined) target.searchParams.set('token', token);
  return target;
}

/** The form our own confirmation page submits: token in the query, empty body. */
function post(token?: string): Request {
  return new Request(url(token), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: '',
  });
}

/** What an RFC 8058 one-click sender POSTs: a fixed body, token in the URL. */
function oneClick(token?: string): Request {
  return new Request(url(token), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'List-Unsubscribe=One-Click',
  });
}

/** A form POST carrying the token in the BODY rather than the query string. */
function postBodyToken(token: string): Request {
  return new Request(new URL('/api/unsubscribe', BASE), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }).toString(),
  });
}

beforeEach(() => {
  suppressFromInbound.mockReset();
  suppressFromInbound.mockResolvedValue({
    kind: 'killed',
    addressesSuppressed: 2,
    touchesSkipped: 3,
  });
});

/* ------------------------------------------------------------------------- *
 * The token (T-4-21)
 * ------------------------------------------------------------------------- */

describe('mint / verify round trip', () => {
  it('returns exactly the subject it was minted for', () => {
    const token = mintUnsubscribeToken(SUBJECT, SECRET);

    expect(verifyUnsubscribeToken(token, SECRET)).toEqual(SUBJECT);
  });

  it('mints a URL-safe opaque string with the version in front', () => {
    const token = mintUnsubscribeToken(SUBJECT, SECRET);

    // Three dot-separated base64url segments. Anything requiring percent-
    // encoding would be re-encoded by one mail client and not another, and the
    // difference is a dead unsubscribe link in somebody's inbox.
    expect(token).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('produces the SAME token for the same subject — no nonce, no expiry', () => {
    // Deterministic on purpose. The Spam Act requires the unsubscribe to keep
    // working for at least 30 days after the send, and the operation behind it
    // is a one-way idempotent suppression — so an expiry would only ever break
    // a right somebody still holds.
    expect(mintUnsubscribeToken(SUBJECT, SECRET)).toBe(mintUnsubscribeToken(SUBJECT, SECRET));
  });

  it('distinguishes tenant from cadence — the pair is the subject', () => {
    const swapped = mintUnsubscribeToken(
      { tenantId: CADENCE, cadenceId: TENANT },
      SECRET,
    );

    expect(verifyUnsubscribeToken(swapped, SECRET)).toEqual({
      tenantId: CADENCE,
      cadenceId: TENANT,
    });
    expect(swapped).not.toBe(mintUnsubscribeToken(SUBJECT, SECRET));
  });
});

describe('verify refuses everything that is not a token we minted', () => {
  it('refuses a token minted under a DIFFERENT secret', () => {
    const foreign = mintUnsubscribeToken(SUBJECT, OTHER_SECRET);

    // The MAC is the right length and the right shape; only the key differs.
    // This is the input that proves the comparison rejects rather than the
    // length guard rejecting for it.
    expect(verifyUnsubscribeToken(foreign, SECRET)).toBeNull();
  });

  it('refuses a token whose PAYLOAD was edited, MAC left alone', () => {
    const token = mintUnsubscribeToken(SUBJECT, SECRET);
    const [version, , mac] = token.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({ t: 'victim-tenant', c: 'victim-cadence' }),
      'utf8',
    ).toString('base64url');

    // T-4-19 in one assertion: editing whose cadence this is must not survive.
    expect(verifyUnsubscribeToken(`${version}.${forgedPayload}.${mac}`, SECRET)).toBeNull();
  });

  it('refuses a single-byte tamper anywhere in the token', () => {
    const token = mintUnsubscribeToken(SUBJECT, SECRET);

    for (let index = 0; index < token.length; index += 1) {
      if (token[index] === '.') continue;
      const flipped = token[index] === 'a' ? 'b' : 'a';
      const tampered = `${token.slice(0, index)}${flipped}${token.slice(index + 1)}`;
      if (tampered === token) continue;

      expect(verifyUnsubscribeToken(tampered, SECRET)).toBeNull();
    }
  });

  it('refuses a MAC of the wrong LENGTH without throwing', () => {
    // `timingSafeEqual` throws on unequal lengths. Without the length guard this
    // is an unhandled exception inside a public POST handler — a 500 that an
    // attacker reads very differently from the uniform 200.
    const token = mintUnsubscribeToken(SUBJECT, SECRET);
    const [version, payload, mac] = token.split('.');

    expect(verifyUnsubscribeToken(`${version}.${payload}.${mac.slice(0, 8)}`, SECRET)).toBeNull();
    expect(verifyUnsubscribeToken(`${version}.${payload}.${mac}AAAA`, SECRET)).toBeNull();
  });

  it('refuses a MAC computed over the payload WITHOUT the version prefix', () => {
    // The version travels inside the signed material, so a `v2` reader added
    // later cannot have its tokens replayed as `v1` (or the reverse).
    const payload = Buffer.from(JSON.stringify({ t: TENANT, c: CADENCE }), 'utf8').toString(
      'base64url',
    );
    const macWithoutVersion = createHmac('sha256', SECRET).update(payload).digest('base64url');

    expect(verifyUnsubscribeToken(`v1.${payload}.${macWithoutVersion}`, SECRET)).toBeNull();
  });

  it.each([
    ['an empty string', ''],
    ['a bare version', 'v1'],
    ['two segments', 'v1.abc'],
    ['four segments', 'v1.abc.def.ghi'],
    ['an unknown version', 'v2.abc.def'],
    ['no version at all', 'abc.def'],
    ['dots only', '..'],
    ['a JWT-shaped string', 'eyJhbGciOiJIUzI1NiJ9.eyJ0IjoiMSJ9.c2ln'],
    ['whitespace', '   '],
  ])('returns null (never throws) for %s', (_name, value) => {
    expect(verifyUnsubscribeToken(value, SECRET)).toBeNull();
  });

  it.each([
    ['a non-JSON payload', 'not json at all'],
    ['a JSON array', '["t","c"]'],
    ['JSON null', 'null'],
    ['a missing cadence', '{"t":"tenant"}'],
    ['a missing tenant', '{"c":"cadence"}'],
    ['a non-string tenant', '{"t":1,"c":"cadence"}'],
    ['an empty tenant', '{"t":"","c":"cadence"}'],
  ])('returns null for a CORRECTLY SIGNED but unusable payload: %s', (_name, json) => {
    // Signed by us, so it passes the MAC — the shape check is the only thing
    // between it and a `forTenant('')` call one layer down.
    const payload = Buffer.from(json, 'utf8').toString('base64url');
    const mac = createHmac('sha256', SECRET).update(`v1.${payload}`).digest('base64url');

    expect(verifyUnsubscribeToken(`v1.${payload}.${mac}`, SECRET)).toBeNull();
  });

  it('refuses an absurdly long token rather than hashing it', () => {
    const huge = `v1.${'A'.repeat(50_000)}.${'B'.repeat(50_000)}`;

    expect(verifyUnsubscribeToken(huge, SECRET)).toBeNull();
  });

  it('FAILS CLOSED on a secret too short to be a signing key', () => {
    // A weak or absent secret must make every token invalid, not make every
    // token valid. Minting under one is a deployment error and throws; verifying
    // under one is a request that has already arrived, and it is refused.
    const token = mintUnsubscribeToken(SUBJECT, SECRET);

    expect(verifyUnsubscribeToken(token, 'short')).toBeNull();
    expect(verifyUnsubscribeToken(token, '')).toBeNull();
    expect(() => mintUnsubscribeToken(SUBJECT, 'short')).toThrow();
  });
});

describe('unsubscribeUrl — the one spelling of the link', () => {
  it('carries the token and NOTHING else', () => {
    const token = mintUnsubscribeToken(SUBJECT, SECRET);
    const link = unsubscribeUrl(BASE, token);

    expect(link).toBe(`${BASE}/api/unsubscribe?token=${token}`);

    // THE ASSERTION MSG-02 NEEDS. No address, no tenant slug, no readable uuid
    // in the path or the query — a link forwarded to a colleague, quoted in a
    // support ticket or captured in a proxy log discloses nothing about who it
    // was sent to.
    expect(link).not.toContain(TENANT);
    expect(link).not.toContain(CADENCE);
    expect(link).not.toContain('@');
  });

  it('tolerates a base URL with a trailing slash', () => {
    const token = mintUnsubscribeToken(SUBJECT, SECRET);

    expect(unsubscribeUrl(`${BASE}/`, token)).toBe(unsubscribeUrl(BASE, token));
  });

  it('round-trips through URL parsing — the token survives being a query value', () => {
    const token = mintUnsubscribeToken(SUBJECT, SECRET);
    const parsed = new URL(unsubscribeUrl(BASE, token));

    expect(parsed.searchParams.get('token')).toBe(token);
    expect(verifyUnsubscribeToken(parsed.searchParams.get('token') ?? '', SECRET)).toEqual(
      SUBJECT,
    );
  });
});

/* ------------------------------------------------------------------------- *
 * GET — the confirmation page, identical for every token (T-4-20)
 * ------------------------------------------------------------------------- */

describe('GET /api/unsubscribe', () => {
  it('CANNOT vary by token — the handler takes no request at all', async () => {
    // The strongest available form of "identical for every token": there is no
    // input this handler could branch on. A signature that accepted the request
    // would make the property a promise about the body; this makes it a fact
    // about the function, and the assertion below is what stops a later edit
    // from quietly reintroducing the parameter.
    expect(GET.length).toBe(0);

    const first = await (await GET()).text();
    const second = await (await GET()).text();

    // `toBe`, not `toEqual` on a set: the page must not vary by so much as a
    // whitespace character.
    expect(second).toBe(first);
  });

  it('never echoes the token into the markup', async () => {
    const token = mintUnsubscribeToken(SUBJECT, SECRET);
    const body = await (await GET()).text();

    // The form posts to the CURRENT URL (no `action`), so the token stays in the
    // query string where it arrived. Echoing it into a hidden input would make
    // the page vary by token and put the token in any cache or screenshot of it.
    expect(body).not.toContain(token);
    expect(body).toMatch(/<form[^>]*method="post"/i);
    expect(body).not.toMatch(/<form[^>]*action=/i);
  });

  it('SUPPRESSES NOTHING — a mail scanner prefetching the link must be harmless', async () => {
    await GET();

    // The single most common way a working unsubscribe link becomes a bug
    // report: a corporate scanner follows every link in an inbound email and
    // silently opts the recipient out of a conversation they wanted.
    expect(suppressFromInbound).not.toHaveBeenCalled();
  });

  it('answers 200 HTML with no-store', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^text\/html/);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
});

/* ------------------------------------------------------------------------- *
 * POST — the write, and the answer that never varies (T-4-19, T-4-20)
 * ------------------------------------------------------------------------- */

describe('POST /api/unsubscribe', () => {
  it('suppresses BOTH channels of the cadence the token names', async () => {
    const response = await POST(post(mintUnsubscribeToken(SUBJECT, SECRET)));

    expect(response.status).toBe(200);
    // THROUGH controls.ts, not through a write of its own. Every "never chase
    // this human again" path in this codebase runs one transaction, because the
    // second expression of it is the one that gets a condition wrong — and the
    // failure is an email sent after somebody clicked unsubscribe.
    expect(suppressFromInbound).toHaveBeenCalledTimes(1);
    expect(suppressFromInbound).toHaveBeenCalledWith(TENANT, CADENCE, 'email_unsubscribe');
  });

  it('accepts an RFC 8058 one-click POST with no form of ours behind it', async () => {
    await POST(oneClick(mintUnsubscribeToken(SUBJECT, SECRET)));

    expect(suppressFromInbound).toHaveBeenCalledWith(TENANT, CADENCE, 'email_unsubscribe');
  });

  it('accepts the token from the form BODY when the query string has none', async () => {
    await POST(postBodyToken(mintUnsubscribeToken(SUBJECT, SECRET)));

    expect(suppressFromInbound).toHaveBeenCalledWith(TENANT, CADENCE, 'email_unsubscribe');
  });

  it('writes NOTHING for a forged, malformed or absent token', async () => {
    await POST(post(mintUnsubscribeToken(SUBJECT, OTHER_SECRET)));
    await POST(post('not-a-token'));
    await POST(post(''));
    await POST(post());

    expect(suppressFromInbound).not.toHaveBeenCalled();
  });

  it('THE ORACLE ASSERTION: every outcome returns the identical body (T-4-20)', async () => {
    const valid = await (await POST(post(mintUnsubscribeToken(SUBJECT, SECRET)))).text();

    // A replay after the cadence has already stopped — the ordinary case when
    // somebody clicks the link twice, or clicks it a week after the chase ended.
    suppressFromInbound.mockResolvedValue({
      kind: 'already_stopped',
      addressesSuppressed: 2,
      stopReason: 'contact_suppressed',
    });
    const replayed = await (await POST(post(mintUnsubscribeToken(SUBJECT, SECRET)))).text();

    // A token naming a cadence that does not exist, or belongs to another
    // tenant. Signed by us, so it verifies; `suppressFromInbound` decides.
    suppressFromInbound.mockResolvedValue({ kind: 'no_cadence' });
    const missing = await (await POST(post(mintUnsubscribeToken(SUBJECT, SECRET)))).text();

    const forged = await (await POST(post(mintUnsubscribeToken(SUBJECT, OTHER_SECRET)))).text();
    const junk = await (await POST(post('not-a-token'))).text();
    const absent = await (await POST(post())).text();

    // FIVE VERY DIFFERENT OUTCOMES, ONE STRING. Nobody holding a token — or
    // guessing at one — can tell a real suppression from a rejected forgery.
    expect(replayed).toBe(valid);
    expect(missing).toBe(valid);
    expect(forged).toBe(valid);
    expect(junk).toBe(valid);
    expect(absent).toBe(valid);
  });

  it('returns the same 200 status and headers on every path', async () => {
    const valid = await POST(post(mintUnsubscribeToken(SUBJECT, SECRET)));
    const forged = await POST(post('nope'));

    expect(valid.status).toBe(200);
    expect(forged.status).toBe(valid.status);
    expect(forged.headers.get('content-type')).toBe(valid.headers.get('content-type'));
    expect(forged.headers.get('cache-control')).toBe(valid.headers.get('cache-control'));
  });

  it('answers 200 even when the suppression itself throws', async () => {
    // A database outage must not turn a compliance endpoint into a 500 that a
    // one-click sender retries in a loop — and must not become the one response
    // that differs from all the others.
    suppressFromInbound.mockRejectedValue(new Error('connection terminated unexpectedly'));

    const response = await POST(post(mintUnsubscribeToken(SUBJECT, SECRET)));
    const body = await response.text();

    expect(response.status).toBe(200);

    suppressFromInbound.mockResolvedValue({ kind: 'no_cadence' });
    const normal = await (await POST(post(mintUnsubscribeToken(SUBJECT, SECRET)))).text();
    expect(body).toBe(normal);
  });

  it('awaits the suppression inside the request — an opt-out is must-happen work', async () => {
    let settled = false;
    suppressFromInbound.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            settled = true;
            resolve({ kind: 'killed', addressesSuppressed: 2, touchesSkipped: 0 });
          }, 20),
        ),
    );

    await POST(post(mintUnsubscribeToken(SUBJECT, SECRET)));

    expect(settled).toBe(true);
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

  it('verifies through the shared token module rather than comparing here', () => {
    expect(ROUTE_SOURCE).toContain('verifyUnsubscribeToken');
    // A second verification written in the route is a second answer to "is this
    // token ours", and the two would drift the first time the format changed.
    expect(ROUTE_SOURCE).not.toContain('createHmac');
  });

  it('reads its OWN secret and none of the other bearers', () => {
    expect(ROUTE_SOURCE).toContain('getServerEnv().UNSUBSCRIBE_SIGNING_SECRET');
    for (const other of [
      'CADENCE_TICK_SECRET',
      'SYNC_TICK_SECRET',
      'CLICKSEND_WEBHOOK_SECRET',
      'CLICKSEND_DLR_SECRET',
      'MESSAGING_RECONCILE_SECRET',
      // The sixth bearer (06-02). Listed for the same reason as the five above:
      // the whole point of separate bearers is independent rotation.
      'STALLED_DIGEST_SECRET',
    ]) {
      expect(ROUTE_SOURCE).not.toContain(other);
    }
  });

  it('never logs the token or an address', () => {
    // A platform log is readable by anyone with project access, forever, and
    // this route holds a signing token on every call. The set of things that may
    // reach a log line is PINNED rather than scanned for banned words — a
    // deny-list only catches the spellings somebody thought of.
    const interpolations = new Set(
      [...ROUTE_SOURCE.matchAll(/console\.\w+\(([\s\S]*?)\n\s*\);/g)].flatMap((call) =>
        [...call[1].matchAll(/\$\{([^}]*)\}/g)].map((match) => match[1].trim()),
      ),
    );

    expect(interpolations).toEqual(new Set(['result.kind']));
    expect(ROUTE_SOURCE).not.toMatch(/console\.[a-z]+\([^)]*token/i);
  });

  it('does not use waitUntil — an opt-out is must-happen work', () => {
    expect(ROUTE_SOURCE).not.toMatch(/\bwaitUntil\b\s*\(/);
    expect(ROUTE_SOURCE).toContain('await suppressFromInbound(');
  });

  it('is EXCLUDED from the proxy matcher — a 307 to /login is not an unsubscribe', () => {
    const found = PROXY_SOURCE.match(/matcher:\s*\['([^']+)'\]/);
    if (!found) throw new Error('proxy.ts no longer exposes a single-string matcher');

    const matches = (pathname: string) => new RegExp(`^${found[1]}$`).test(pathname);

    // A customer clicking unsubscribe has no session and never will. Behind the
    // proxy they would be redirected to an operator login page, which is both a
    // broken opt-out and a Spam Act problem.
    expect(matches('/api/unsubscribe')).toBe(false);
    expect(matches('/')).toBe(true);
  });
});
