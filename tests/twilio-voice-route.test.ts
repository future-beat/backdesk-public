/**
 * THE TRACER'S PROOF (Phase 11, plan 11-01): a Twilio-signed POST to the voice
 * webhook, for a number the schema says belongs to a tenant, answers the D-03
 * greeting as TwiML and lands exactly ONE `missed_calls` insert — and every way
 * that can go wrong still answers a 200 greeting with the same element shape.
 *
 * The dlr-suite mould: the handler is invoked directly with `Request` objects —
 * no dev server, no database, no Twilio. The repository is mocked at the barrel
 * (`forAllTenants_divertNumberByE164`, `insertMissedCallArrival`), and the core
 * between the route and those two mocks runs FOR REAL, so this suite exercises
 * the whole seam: token gate → canonical URL → signature → parse → one read →
 * classification → after-hours → insert → TwiML.
 *
 * ── THE SIGNATURE ORACLE IS INDEPENDENT OF THE SDK ─────────────────────────
 *
 * `sign()` below is Twilio's documented algorithm written out with node:crypto
 * (HMAC-SHA1 over the URL followed by each sorted key and its DECODED value,
 * base64). The route verifies with the SDK's `validateRequest`. If the two ever
 * disagree, the valid-request tests fail — and the encoding test at the bottom
 * pins that they agree on the case that bites: a value with a space and a plus.
 *
 * ── THE PER-ENDPOINT RULE IS ASSERTED, NOT MERELY ABSENT ────────────────────
 *
 * The status route's secret must NOT open this door. A voice route that
 * accepted both would make the two Twilio webhooks one endpoint with two URLs,
 * and every behavioural test here would still pass — so it is asserted
 * rejected.
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** 40 characters, so a WRONG VALUE OF THE SAME LENGTH exercises timingSafeEqual. */
const VOICE_TOKEN = 'voice-token-of-exactly-forty-characters!';
/** DERIVED, so "same length" cannot drift when the token above is edited. */
const WRONG_SAME_LENGTH = `W${VOICE_TOKEN.slice(1)}`;
/** The OTHER Twilio door's secret. It must not open this one. */
const STATUS_TOKEN = 'status-token-of-exactly-forty-characters';
const AUTH_TOKEN = 'test-auth-token-of-thirty-two-plus-characters';
const BASE = 'https://app.backdesk.com.au';
const PATH = '/api/webhooks/twilio/voice';
/** What Twilio signs: the URL configured on the number, token included. */
const SIGNED_URL = `${BASE}${PATH}?token=${VOICE_TOKEN}`;

vi.mock('@/core/shared/env', () => ({
  getServerEnv: () => ({
    APP_BASE_URL: 'https://app.backdesk.com.au',
    TWILIO_AUTH_TOKEN: 'test-auth-token-of-thirty-two-plus-characters',
    TWILIO_VOICE_WEBHOOK_SECRET: 'voice-token-of-exactly-forty-characters!',
    TWILIO_VOICE_STATUS_WEBHOOK_SECRET: 'status-token-of-exactly-forty-characters',
  }),
}));

const lookup = vi.fn();
const insert = vi.fn();
vi.mock('@/db/repository', () => ({
  forAllTenants_divertNumberByE164: (...args: unknown[]) => lookup(...args),
  insertMissedCallArrival: (...args: unknown[]) => insert(...args),
}));

const { POST, maxDuration, runtime } = await import('@/app/api/webhooks/twilio/voice/route');
const { GREETING_GENERIC_LEAD } = await import('@/core/telephony/greeting');

const ROUTE_SOURCE = readFileSync('src/app/api/webhooks/twilio/voice/route.ts', 'utf8');
const PROXY_SOURCE = readFileSync('src/proxy.ts', 'utf8');

/** Twilio's documented algorithm, with no SDK on the test side. */
function sign(url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac('sha1', AUTH_TOKEN).update(Buffer.from(data, 'utf8')).digest('base64');
}

interface PostOptions {
  /** `undefined` → the right token; `null` → no token at all. */
  token?: string | null;
  /** `undefined` → a valid signature; `null` → no header at all. */
  signature?: string | null;
}

function twilioPost(params: Record<string, string>, opts: PostOptions = {}): Request {
  const url = new URL(`${BASE}${PATH}`);
  const token = opts.token === undefined ? VOICE_TOKEN : opts.token;
  if (token !== null) url.searchParams.set('token', token);

  const headers = new Headers({ 'content-type': 'application/x-www-form-urlencoded' });
  const signature = opts.signature === undefined ? sign(SIGNED_URL, params) : opts.signature;
  if (signature !== null) headers.set('x-twilio-signature', signature);

  return new Request(url, {
    method: 'POST',
    headers,
    body: new URLSearchParams(params).toString(),
  });
}

/** A request whose body must never be touched — reading it fails the test. */
function untouchableRequest(token: string | null): { request: Request; text: ReturnType<typeof vi.fn> } {
  const url = new URL(`${BASE}${PATH}`);
  if (token !== null) url.searchParams.set('token', token);
  const text = vi.fn(async () => {
    throw new Error('the body was read before the token was checked');
  });
  const request = { url: url.toString(), headers: new Headers(), text } as unknown as Request;
  return { request, text };
}

/** ACMA fiction-block numbers: a mobile caller, a WA landline divert number. */
const CALL: Record<string, string> = {
  CallSid: `CA${'f'.repeat(32)}`,
  AccountSid: `AC${'0'.repeat(32)}`,
  From: '+61491570156',
  To: '+61891570156',
  CallStatus: 'ringing',
  Direction: 'inbound',
  ApiVersion: '2010-04-01',
};

const OWNER = {
  tenantId: '4f1b1e2c-0000-4000-8000-000000000001',
  divertNumberId: '4f1b1e2c-0000-4000-8000-000000000002',
  spokenName: 'Smith & Sons',
  timezone: 'Australia/Perth',
  contactHoursStart: '08:00:00',
  contactHoursEnd: '18:00:00',
  contactDays: [1, 2, 3, 4, 5],
};

/** Every element name in a TwiML document. */
function elements(xml: string): Set<string> {
  return new Set([...xml.replace(/^<\?xml[^>]*\?>/, '').matchAll(/<([A-Za-z]+)[\s/>]/g)].map((m) => m[1]));
}

let warn: ReturnType<typeof vi.spyOn>;
let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  lookup.mockReset();
  insert.mockReset();
  lookup.mockResolvedValue(OWNER);
  insert.mockResolvedValue({ id: '4f1b1e2c-0000-4000-8000-0000000000aa' });
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function warned(fragment: string): boolean {
  return warn.mock.calls.some((call: unknown[]) => String(call[0]).includes(fragment));
}

/* ------------------------------------------------------------------------- *
 * The token gate — 401, before the body is read
 * ------------------------------------------------------------------------- */

describe('voice webhook: the token gate', () => {
  it.each([
    ['no token at all', null],
    ['a wrong token of IDENTICAL length', WRONG_SAME_LENGTH],
    ['a TRUNCATED token (length check, not a throw)', VOICE_TOKEN.slice(0, 8)],
    ["THE STATUS ROUTE'S token — the per-endpoint rule", STATUS_TOKEN],
  ])('returns 401 for %s — and never reads the body', async (_label, token) => {
    const { request, text } = untouchableRequest(token);

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(await response.text()).toBe('unauthorized');
    expect(text).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('proves the fixture: the wrong token really is the same length', () => {
    expect(WRONG_SAME_LENGTH.length).toBe(VOICE_TOKEN.length);
    expect(STATUS_TOKEN.length).toBe(VOICE_TOKEN.length);
  });

  it('gives a byte-identical 401 body however the token is wrong', async () => {
    const bodies = await Promise.all(
      [null, '', VOICE_TOKEN.slice(0, 8), WRONG_SAME_LENGTH, STATUS_TOKEN].map(async (token) =>
        (await POST(twilioPost(CALL, { token }))).text(),
      ),
    );

    expect(new Set(bodies)).toEqual(new Set(['unauthorized']));
  });
});

/* ------------------------------------------------------------------------- *
 * The signature — a 200 generic greeting, and no write
 * ------------------------------------------------------------------------- */

describe('voice webhook: the signature', () => {
  it.each([
    ['a signature that does not match', 'bm90LXRoZS1yaWdodC1zaWduYXR1cmU='],
    ['no X-Twilio-Signature header at all', null],
    ['an empty signature header', ''],
  ])('%s → 200 generic greeting, NO write, logs signature_rejected', async (_label, signature) => {
    const response = await POST(twilioPost(CALL, { signature }));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/xml; charset=utf-8');
    const body = await response.text();
    expect(body).toContain('<Say');
    expect(body).toContain('<Hangup/>');
    expect(body).toContain(GREETING_GENERIC_LEAD);
    expect(body).not.toContain('Smith');

    expect(lookup).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(warned('[twilio] voice signature_rejected')).toBe(true);
  });

  it('a signature over the SAME params but a DIFFERENT host is rejected (URL drift)', async () => {
    const drifted = sign(`https://backdesk.com.au${PATH}?token=${VOICE_TOKEN}`, CALL);

    const response = await POST(twilioPost(CALL, { signature: drifted }));

    expect(response.status).toBe(200);
    expect(insert).not.toHaveBeenCalled();
    expect(warned('signature_rejected')).toBe(true);
  });

  it('a signature over TAMPERED params is rejected — the body is inside the signature', async () => {
    const signature = sign(SIGNED_URL, CALL);

    const response = await POST(
      twilioPost({ ...CALL, To: '+61891570157' }, { signature }),
    );

    expect(response.status).toBe(200);
    expect(lookup).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------- *
 * The tracer path — named greeting, exactly one insert
 * ------------------------------------------------------------------------- */

describe('voice webhook: a signed call for a known number', () => {
  it('answers 200 text/xml naming the tenant and inserts exactly ONE row', async () => {
    const response = await POST(twilioPost(CALL));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/xml; charset=utf-8');
    const body = await response.text();
    expect(body).toContain('Smith &amp; Sons');
    expect(elements(body)).toEqual(new Set(['Response', 'Pause', 'Say', 'Hangup']));

    expect(insert).toHaveBeenCalledTimes(1);
    const row = insert.mock.calls[0][0];
    expect(row).toMatchObject({
      tenantId: OWNER.tenantId,
      divertNumberId: OWNER.divertNumberId,
      provider: 'twilio',
      providerCallId: CALL.CallSid,
      calledNumberE164: '+61891570156',
      callerKind: 'mobile',
      callerE164: '+61491570156',
      callerWithheld: false,
      callStatus: 'ringing',
      source: 'webhook',
      deadLetterReason: null,
      rawPayload: null,
    });
    expect(row.startedAt).toBeInstanceOf(Date);
    expect(log).toHaveBeenCalledWith('[twilio] voice handled: recorded.');
  });

  it('looks the tenant up by `To` ONLY — ForwardedFrom is stored, never routed on (D-02)', async () => {
    await POST(twilioPost({ ...CALL, ForwardedFrom: '+61891570199' }));

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith('+61891570156');
    expect(insert.mock.calls[0][0].forwardedFromRaw).toBe('+61891570199');
  });

  it('does not fall back to ForwardedFrom when `To` is unknown', async () => {
    lookup.mockResolvedValue(undefined);

    await POST(twilioPost({ ...CALL, ForwardedFrom: '+61891570199' }));

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith('+61891570156');
  });

  it('stores started_at in UTC as a Date, never local wall-clock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T09:30:00+08:00'));

    await POST(twilioPost(CALL));

    expect(insert.mock.calls[0][0].startedAt.toISOString()).toBe('2026-10-05T01:30:00.000Z');
  });

  it('classifies a withheld caller as withheld with no number', async () => {
    await POST(twilioPost({ ...CALL, From: 'anonymous' }));

    expect(insert.mock.calls[0][0]).toMatchObject({
      callerKind: 'withheld',
      callerE164: null,
      callerWithheld: true,
      callerRaw: 'anonymous',
    });
  });

  it('stores a landline caller as other_number (capture records; Phase 12 decides)', async () => {
    await POST(twilioPost({ ...CALL, From: '+61892345678' }));

    expect(insert.mock.calls[0][0]).toMatchObject({
      callerKind: 'other_number',
      callerE164: '+61892345678',
    });
  });
});

/* ------------------------------------------------------------------------- *
 * After hours — half-open [start, end), computed at arrival
 * ------------------------------------------------------------------------- */

describe('voice webhook: the after-hours flag', () => {
  const TEN_AM_CLOSE = { ...OWNER, contactHoursEnd: '10:00:00' };

  it('one second BEFORE contact_hours_end is inside the window', async () => {
    lookup.mockResolvedValue(TEN_AM_CLOSE);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T09:59:59+08:00')); // a Monday in Perth

    await POST(twilioPost(CALL));

    expect(insert.mock.calls[0][0].afterHours).toBe(false);
  });

  it('contact_hours_end EXACTLY is after-hours', async () => {
    lookup.mockResolvedValue(TEN_AM_CLOSE);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T10:00:00+08:00'));

    await POST(twilioPost(CALL));

    expect(insert.mock.calls[0][0].afterHours).toBe(true);
  });

  it('a day the client does not work is after-hours', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-04T11:00:00+08:00')); // a Sunday

    await POST(twilioPost(CALL));

    expect(insert.mock.calls[0][0].afterHours).toBe(true);
  });

  it('an uninterpretable window stores TRUE and still records the call', async () => {
    lookup.mockResolvedValue({ ...OWNER, contactHoursStart: '18:00:00', contactHoursEnd: '08:00:00' });

    const response = await POST(twilioPost(CALL));

    expect(response.status).toBe(200);
    expect(insert.mock.calls[0][0].afterHours).toBe(true);
    expect(warned('[telephony] arrival window_invalid')).toBe(true);
  });
});

/* ------------------------------------------------------------------------- *
 * Every failure after the gate: 200, the same shape, a fixed log
 * ------------------------------------------------------------------------- */

describe('voice webhook: never a 5xx', () => {
  it('an unknown `To` is a tenant-less dead letter and the GENERIC greeting', async () => {
    lookup.mockResolvedValue(undefined);

    const response = await POST(twilioPost(CALL));

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain(GREETING_GENERIC_LEAD);
    expect(elements(body)).toEqual(new Set(['Response', 'Pause', 'Say', 'Hangup']));

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toMatchObject({
      tenantId: null,
      divertNumberId: null,
      providerCallId: CALL.CallSid,
      calledNumberE164: '+61891570156',
      deadLetterReason: 'unknown_number',
      // A dead letter carries no caller data at all.
      callerE164: null,
      callerRaw: null,
      forwardedFromRaw: null,
    });
    expect(log).toHaveBeenCalledWith('[twilio] voice handled: unknown_number.');
  });

  it('a DUPLICATE delivery inserts nothing new and answers the same named greeting', async () => {
    insert.mockResolvedValue(null);

    const first = await (await POST(twilioPost(CALL))).text();
    const second = await (await POST(twilioPost(CALL))).text();

    expect(second).toBe(first);
    expect(second).toContain('Smith &amp; Sons');
    expect(log).toHaveBeenCalledWith('[twilio] voice handled: duplicate.');
  });

  it('an insert that THROWS still answers 200 TwiML, named, and logs db_failed', async () => {
    insert.mockRejectedValue(new Error('connection terminated: +61491570156'));

    const response = await POST(twilioPost(CALL));

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('Smith &amp; Sons');
    expect(warned('[telephony] arrival db_failed')).toBe(true);
    // The caught value is discarded: nothing logged carries the number.
    for (const call of [...warn.mock.calls, ...log.mock.calls]) {
      expect(String(call[0])).not.toContain('+614');
    }
  });

  it('a lookup that THROWS answers the generic greeting and writes nothing', async () => {
    lookup.mockRejectedValue(new Error('pool exhausted'));

    const response = await POST(twilioPost(CALL));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain(GREETING_GENERIC_LEAD);
    expect(insert).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('[twilio] voice handled: db_failed.');
  });

  it('a lookup that HANGS is abandoned at the deadline — the greeting is not held', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    lookup.mockReturnValue(new Promise(() => {}));

    const pending = POST(twilioPost(CALL));
    await vi.advanceTimersByTimeAsync(6_000);
    const response = await pending;

    expect(response.status).toBe(200);
    expect(await response.text()).toContain(GREETING_GENERIC_LEAD);
    expect(warned('[telephony] arrival db_timeout')).toBe(true);
    expect(insert).not.toHaveBeenCalled();
  });

  it('a signed request with no CallSid is an `unparseable` dead letter, raw kept', async () => {
    const params = { To: CALL.To, From: CALL.From, Direction: 'inbound' };

    const response = await POST(twilioPost(params));

    expect(response.status).toBe(200);
    expect(lookup).not.toHaveBeenCalled();
    expect(insert.mock.calls[0][0]).toMatchObject({
      tenantId: null,
      providerCallId: null,
      deadLetterReason: 'unparseable',
      callerE164: null,
    });
    expect(typeof insert.mock.calls[0][0].rawPayload).toBe('string');
  });

  it('an outbound-direction request is a `not_inbound` dead letter', async () => {
    await POST(twilioPost({ ...CALL, Direction: 'outbound-api' }));

    expect(lookup).not.toHaveBeenCalled();
    expect(insert.mock.calls[0][0]).toMatchObject({ tenantId: null, deadLetterReason: 'not_inbound' });
  });

  it('an unreadable body answers the generic greeting and logs body_unreadable', async () => {
    const url = `${BASE}${PATH}?token=${VOICE_TOKEN}`;
    const request = {
      url,
      headers: new Headers(),
      text: async () => {
        throw new Error('aborted');
      },
    } as unknown as Request;

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain(GREETING_GENERIC_LEAD);
    expect(warned('[twilio] voice body_unreadable')).toBe(true);
    expect(insert).not.toHaveBeenCalled();
  });
});

describe('voice webhook: APP_BASE_URL unset fails CLOSED', () => {
  it('answers the generic greeting, writes nothing, logs base_url_unset', async () => {
    vi.resetModules();
    vi.doMock('@/core/shared/env', () => ({
      getServerEnv: () => ({
        APP_BASE_URL: undefined,
        TWILIO_AUTH_TOKEN: AUTH_TOKEN,
        TWILIO_VOICE_WEBHOOK_SECRET: VOICE_TOKEN,
        TWILIO_VOICE_STATUS_WEBHOOK_SECRET: STATUS_TOKEN,
      }),
    }));
    const unset = await import('@/app/api/webhooks/twilio/voice/route');

    // Even a request signed over the would-be canonical URL is not accepted:
    // there is no canonical URL to check it against, and the request's own URL
    // is never a substitute.
    const response = await unset.POST(twilioPost(CALL));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain(GREETING_GENERIC_LEAD);
    expect(warned('[twilio] voice base_url_unset')).toBe(true);
    expect(lookup).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();

    vi.doUnmock('@/core/shared/env');
  });
});

describe('voice webhook: an env that will not parse is NEVER a 500 (WR-03)', () => {
  it('answers the generic greeting with 200, writes nothing, logs a fixed line', async () => {
    vi.resetModules();
    const getServerEnv = vi.fn(() => {
      throw new Error('Invalid server environment: AUDIT_IP_HASH_SALT');
    });
    vi.doMock('@/core/shared/env', () => ({ getServerEnv }));
    const broken = await import('@/app/api/webhooks/twilio/voice/route');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await broken.POST(twilioPost(CALL));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/xml');
    expect(await response.text()).toContain(GREETING_GENERIC_LEAD);
    expect(error).toHaveBeenCalledWith('[twilio] voice env_unreadable; served generic greeting.');
    // The zod report is discarded — the key it names never reaches the log.
    expect(error.mock.calls.flat().join(' ')).not.toContain('AUDIT_IP_HASH_SALT');
    expect(lookup).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();

    vi.doUnmock('@/core/shared/env');
  });

  it('reads the env exactly ONCE per request', async () => {
    vi.resetModules();
    const getServerEnv = vi.fn(() => ({
      APP_BASE_URL: BASE,
      TWILIO_AUTH_TOKEN: AUTH_TOKEN,
      TWILIO_VOICE_WEBHOOK_SECRET: VOICE_TOKEN,
      TWILIO_VOICE_STATUS_WEBHOOK_SECRET: STATUS_TOKEN,
    }));
    vi.doMock('@/core/shared/env', () => ({ getServerEnv }));
    const fresh = await import('@/app/api/webhooks/twilio/voice/route');

    await fresh.POST(twilioPost(CALL));

    expect(getServerEnv).toHaveBeenCalledTimes(1);
    vi.doUnmock('@/core/shared/env');
  });
});

/* ------------------------------------------------------------------------- *
 * Encoding — the oracle and the SDK agree on decoded values
 * ------------------------------------------------------------------------- */

describe('voice webhook: form encoding and the signature', () => {
  it("the node:crypto oracle equals the SDK's getExpectedTwilioSignature for a space and a plus", async () => {
    const { getExpectedTwilioSignature } = await import('twilio/lib/webhooks/webhooks');
    const params = { a: 'x y', b: 'p+q' };

    expect(sign(SIGNED_URL, params)).toBe(getExpectedTwilioSignature(AUTH_TOKEN, SIGNED_URL, params));
  });

  it('a value with a space and a plus survives the form round trip and verifies', async () => {
    // `+` on the wire means SPACE and `%2B` means PLUS. The signature is over
    // the DECODED values, so a route that verified the raw bytes — or decoded
    // `+` as a plus — would reject this real-shaped call.
    const params = { ...CALL, FromCity: 'PERTH CBD', CallerName: 'A+B Plumbing' };

    const response = await POST(twilioPost(params));

    expect(response.status).toBe(200);
    expect(warned('signature_rejected')).toBe(false);
    expect(insert).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------------- *
 * Configuration and disclosure — source pins
 * ------------------------------------------------------------------------- */

describe('voice route configuration', () => {
  it('pins the Node runtime and an explicit maxDuration', () => {
    expect(runtime).toBe('nodejs');
    expect(maxDuration).toBe(60);
    expect(ROUTE_SOURCE).toContain("runtime = 'nodejs'");
    expect(ROUTE_SOURCE).toContain('maxDuration = 60');
  });

  it('compares the token with timingSafeEqual, not ===', () => {
    expect(ROUTE_SOURCE).toContain('timingSafeEqual');
    expect(ROUTE_SOURCE).not.toMatch(/provided\s*===\s*expected/);
  });

  it('reads its OWN secret and none of the other bearers', () => {
    expect(ROUTE_SOURCE).toContain('env.TWILIO_VOICE_WEBHOOK_SECRET');
    for (const other of [
      'TWILIO_VOICE_STATUS_WEBHOOK_SECRET',
      'CLICKSEND_WEBHOOK_SECRET',
      'CLICKSEND_DLR_SECRET',
      'MESSAGING_RECONCILE_SECRET',
      'CADENCE_TICK_SECRET',
      'SYNC_TICK_SECRET',
      'STALLED_DIGEST_SECRET',
    ]) {
      expect(ROUTE_SOURCE).not.toContain(other);
    }
  });

  it('takes the token from the QUERY STRING, not an Authorization header', () => {
    expect(ROUTE_SOURCE).toContain("searchParams.get('token')");
    expect(ROUTE_SOURCE).not.toMatch(/headers\.get\(\s*'authorization'/i);
  });

  it('builds the signed URL from configuration and verifies before any write', () => {
    expect(ROUTE_SOURCE).toContain("twilioWebhookUrl('voice', env)");
    expect(ROUTE_SOURCE).toContain('verifyTwilioSignature(');
    expect(ROUTE_SOURCE.indexOf('verifyTwilioSignature(')).toBeLessThan(
      ROUTE_SOURCE.indexOf('recordMissedCallArrival(params'),
    );
    // The request's own URL is read for the TOKEN only — never passed as the
    // URL the signature is checked against.
    expect(ROUTE_SOURCE).not.toMatch(/url:\s*request\.url/);
  });

  it('interpolates ONLY the result kind into its logs (T-11-04)', () => {
    const interpolations = new Set(
      [...ROUTE_SOURCE.matchAll(/console\.\w+\(([\s\S]*?)\);/g)].flatMap((call) =>
        [...call[1].matchAll(/\$\{([^}]*)\}/g)].map((match) => match[1].trim()),
      ),
    );

    expect(interpolations).toEqual(new Set(['result.kind']));
  });

  it('never mentions the token in a log call', () => {
    for (const call of ROUTE_SOURCE.matchAll(/console\.\w+\(([\s\S]*?)\);/g)) {
      expect(call[1].toLowerCase()).not.toContain('token');
    }
  });

  it('does not use waitUntil — the greeting never waits on deferred work', () => {
    expect(ROUTE_SOURCE).not.toMatch(/\bwaitUntil\b\s*\(/);
    expect(ROUTE_SOURCE).toContain('await recordMissedCallArrival(');
  });

  it('never reads the body as formData — the raw bytes are what a dead letter keeps', () => {
    expect(ROUTE_SOURCE).not.toMatch(/request\.formData\(/);
    expect(ROUTE_SOURCE).toContain('request.text()');
  });

  it('is EXCLUDED from the proxy matcher', () => {
    const found = PROXY_SOURCE.match(/matcher:\s*\['([^']+)'\]/);
    if (!found) throw new Error('proxy.ts no longer exposes a single-string matcher');

    const matches = (pathname: string) => new RegExp(`^${found[1]}$`).test(pathname);

    expect(matches('/api/webhooks/twilio/voice')).toBe(false);
    expect(matches('/')).toBe(true);
  });
});
