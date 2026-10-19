/**
 * THE STATUS DOOR'S PROOF (Phase 11, plan 11-02): a Twilio-signed status
 * callback completes the `missed_calls` row it names by EXACT match — status,
 * duration, end time — and every other input is the same `{ received: true }`
 * with a fixed-string log and no write.
 *
 * The dlr-suite mould with the voice suite's oracle: the handler is invoked
 * directly with `Request` objects — no dev server, no database, no Twilio. The
 * repository is mocked at the barrel (`completeMissedCall`), and the core
 * between the route and that mock (`applyVoiceStatus`) runs FOR REAL, so this
 * suite exercises token gate → canonical URL → signature → parse → Timestamp
 * and CallDuration handling → the one UPDATE.
 *
 * ── THE HINT HALF: NOTHING HERE CAN CREATE A ROW ───────────────────────────
 *
 * The only repository function the mock offers the status path is the UPDATE.
 * The arrival insert is mocked too (the core module imports it) and asserted
 * NEVER CALLED on every path — so a regression that "helpfully" created a row
 * for an unknown CallSid fails here, not in production.
 *
 * ── PHASE 12: THE TEXT-BACK TRIGGER (D-01) ──────────────────────────────────
 *
 * `sendTextBack` and `buildRoutingSender` are mocked at their modules. The
 * route must call `sendTextBack` exactly once, with the ROW ID the completion
 * returned, for a completed callback whose status is final — and never on any
 * other path. No value from the callback's parameters may reach it (T-12-01),
 * and a throwing `sendTextBack` must still answer the byte-identical 200.
 *
 * ── THE PER-ENDPOINT RULE IS ASSERTED, NOT MERELY ABSENT ────────────────────
 *
 * The voice door's secret must NOT open this one. It is the same length as
 * this route's token on purpose, so the rejection is the comparison and not the
 * length check.
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** 40 characters, so a WRONG VALUE OF THE SAME LENGTH exercises timingSafeEqual. */
const STATUS_TOKEN = 'status-token-of-exactly-forty-characters';
/** DERIVED, so "same length" cannot drift when the token above is edited. */
const WRONG_SAME_LENGTH = `W${STATUS_TOKEN.slice(1)}`;
/** The OTHER Twilio door's secret — a DIFFERENT value. It must not open this one. */
const VOICE_TOKEN = 'voice-token-of-exactly-forty-characters!';
const AUTH_TOKEN = 'test-auth-token-of-thirty-two-plus-characters';
const BASE = 'https://app.backdesk.com.au';
const PATH = '/api/webhooks/twilio/voice-status';
/** What Twilio signs: the status callback URL configured on the number. */
const SIGNED_URL = `${BASE}${PATH}?token=${STATUS_TOKEN}`;

vi.mock('@/core/shared/env', () => ({
  getServerEnv: () => ({
    APP_BASE_URL: 'https://app.backdesk.com.au',
    TWILIO_AUTH_TOKEN: 'test-auth-token-of-thirty-two-plus-characters',
    TWILIO_VOICE_WEBHOOK_SECRET: 'voice-token-of-exactly-forty-characters!',
    TWILIO_VOICE_STATUS_WEBHOOK_SECRET: 'status-token-of-exactly-forty-characters',
  }),
}));

const complete = vi.fn();
const insert = vi.fn();
const lookup = vi.fn();
vi.mock('@/db/repository', () => ({
  completeMissedCall: (...args: unknown[]) => complete(...args),
  insertMissedCallArrival: (...args: unknown[]) => insert(...args),
  forAllTenants_divertNumberByE164: (...args: unknown[]) => lookup(...args),
}));

const textBack = vi.fn();
vi.mock('@/core/leads/text-back', () => ({
  sendTextBack: (...args: unknown[]) => textBack(...args),
}));

const buildRoutingSender = vi.fn();
vi.mock('@/core/messaging/routing-sender', () => ({
  buildRoutingSender: (...args: unknown[]) => buildRoutingSender(...args),
}));

/** The row the completion UPDATE matched — what RETURNING gives the route. */
const ROW_ID = '7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a';
const TENANT_ID = '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b';

const { POST, maxDuration, runtime } = await import('@/app/api/webhooks/twilio/voice-status/route');
const { applyVoiceStatus } = await import('@/core/telephony/missed-call');

const ROUTE_SOURCE = readFileSync('src/app/api/webhooks/twilio/voice-status/route.ts', 'utf8');
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
  /** A raw body instead of the encoded params (the signature is still over `params`). */
  rawBody?: string;
}

function twilioPost(params: Record<string, string>, opts: PostOptions = {}): Request {
  const url = new URL(`${BASE}${PATH}`);
  const token = opts.token === undefined ? STATUS_TOKEN : opts.token;
  if (token !== null) url.searchParams.set('token', token);

  const headers = new Headers({ 'content-type': 'application/x-www-form-urlencoded' });
  const signature = opts.signature === undefined ? sign(SIGNED_URL, params) : opts.signature;
  if (signature !== null) headers.set('x-twilio-signature', signature);

  return new Request(url, {
    method: 'POST',
    headers,
    body: opts.rawBody ?? new URLSearchParams(params).toString(),
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

/** A completed-call callback, as Twilio sends it (ACMA fiction-block numbers). */
const CALLBACK: Record<string, string> = {
  CallSid: `CA${'e'.repeat(32)}`,
  AccountSid: `AC${'0'.repeat(32)}`,
  From: '+61491570156',
  To: '+61891570156',
  CallStatus: 'completed',
  CallDuration: '11',
  Timestamp: 'Tue, 29 Sep 2026 03:14:15 +0000',
  CallbackSource: 'call-progress-events',
  SequenceNumber: '0',
  Direction: 'inbound',
  ApiVersion: '2010-04-01',
};

let warn: ReturnType<typeof vi.spyOn>;
let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  complete.mockReset();
  insert.mockReset();
  lookup.mockReset();
  textBack.mockReset();
  buildRoutingSender.mockReset();
  complete.mockResolvedValue({ completed: true, id: ROW_ID, tenantId: TENANT_ID });
  textBack.mockResolvedValue({ kind: 'skipped' });
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

/** The callback with one parameter removed — the way Twilio omits an optional one. */
function without(key: string): Record<string, string> {
  return Object.fromEntries(Object.entries(CALLBACK).filter(([k]) => k !== key));
}

/** Nothing on any path may create a row or look a tenant up. */
function assertNoArrivalWrite(): void {
  expect(insert).not.toHaveBeenCalled();
  expect(lookup).not.toHaveBeenCalled();
}

/* ------------------------------------------------------------------------- *
 * The token gate — 401, before the body is read
 * ------------------------------------------------------------------------- */

describe('voice-status webhook: the token gate', () => {
  it.each([
    ['no token at all', null],
    ['a wrong token of IDENTICAL length', WRONG_SAME_LENGTH],
    ['a TRUNCATED token (length check, not a throw)', STATUS_TOKEN.slice(0, 8)],
    ["THE VOICE ROUTE'S token — the per-endpoint rule", VOICE_TOKEN],
  ])('returns 401 for %s — and never reads the body', async (_label, token) => {
    const { request, text } = untouchableRequest(token);

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(await response.text()).toBe('unauthorized');
    expect(text).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    assertNoArrivalWrite();
  });

  it('proves the fixture: the wrong tokens really are the same length, and different', () => {
    expect(WRONG_SAME_LENGTH.length).toBe(STATUS_TOKEN.length);
    expect(VOICE_TOKEN.length).toBe(STATUS_TOKEN.length);
    expect(VOICE_TOKEN).not.toBe(STATUS_TOKEN);
  });

  it('a request SIGNED correctly but carrying the voice token is still a 401', async () => {
    const response = await POST(twilioPost(CALLBACK, { token: VOICE_TOKEN }));

    expect(response.status).toBe(401);
    expect(complete).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------- *
 * The signature — uniform 200, and no write
 * ------------------------------------------------------------------------- */

describe('voice-status webhook: the signature', () => {
  it.each([
    ['a signature that does not match', 'bm90LXRoZS1yaWdodC1zaWduYXR1cmU='],
    ['no X-Twilio-Signature header at all', null],
    ['an empty signature header', ''],
  ])('%s → 200 { received: true }, NO write, logs signature_rejected', async (_label, signature) => {
    const response = await POST(twilioPost(CALLBACK, { signature }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(complete).not.toHaveBeenCalled();
    assertNoArrivalWrite();
    expect(warned('[twilio] status signature_rejected')).toBe(true);
  });

  it("a signature over the VOICE route's URL is rejected — each door signs its own URL", async () => {
    const voiceSigned = sign(`${BASE}/api/webhooks/twilio/voice?token=${VOICE_TOKEN}`, CALLBACK);

    const response = await POST(twilioPost(CALLBACK, { signature: voiceSigned }));

    expect(response.status).toBe(200);
    expect(complete).not.toHaveBeenCalled();
    expect(warned('signature_rejected')).toBe(true);
  });

  it('a signature over TAMPERED params is rejected — the body is inside the signature', async () => {
    const signature = sign(SIGNED_URL, CALLBACK);

    await POST(twilioPost({ ...CALLBACK, CallDuration: '9999' }, { signature }));

    expect(complete).not.toHaveBeenCalled();
    expect(warned('signature_rejected')).toBe(true);
  });
});

/* ------------------------------------------------------------------------- *
 * The completion — exact match, the three facts, nothing else
 * ------------------------------------------------------------------------- */

describe('voice-status webhook: a signed completed callback', () => {
  it('completes the row by CallSid with status, integer duration and the RFC 2822 end time', async () => {
    const response = await POST(twilioPost(CALLBACK));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });

    expect(complete).toHaveBeenCalledTimes(1);
    const input = complete.mock.calls[0][0];
    expect(input).toEqual({
      providerCallId: CALLBACK.CallSid,
      callStatus: 'completed',
      durationSeconds: 11,
      endedAt: new Date('2026-09-29T03:14:15Z'),
    });
    expect(input.endedAt.getTime()).toBe(Date.parse('2026-09-29T03:14:15Z'));
    // The completion carries NO caller or tenant data — only the four facts.
    expect(Object.keys(input).sort()).toEqual(['callStatus', 'durationSeconds', 'endedAt', 'providerCallId']);

    assertNoArrivalWrite();
    expect(log).toHaveBeenCalledWith('[twilio] status handled: completed.');
  });

  it('a missing Timestamp falls back to the receipt time — the callback is never failed on it', async () => {
    const params = without('Timestamp');

    const before = Date.now();
    await POST(twilioPost(params));
    const after = Date.now();

    const endedAt: Date = complete.mock.calls[0][0].endedAt;
    expect(endedAt).toBeInstanceOf(Date);
    expect(endedAt.getTime()).toBeGreaterThanOrEqual(before - 1_000);
    expect(endedAt.getTime()).toBeLessThanOrEqual(after + 1_000);
  });

  it('an UNREADABLE Timestamp falls back to the receipt time too', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T01:30:00Z'));

    await POST(twilioPost({ ...CALLBACK, Timestamp: 'not a date at all' }));

    expect(complete.mock.calls[0][0].endedAt.toISOString()).toBe('2026-10-05T01:30:00.000Z');
    expect(log).toHaveBeenCalledWith('[twilio] status handled: completed.');
  });

  it('a missing CallDuration stores durationSeconds NULL', async () => {
    const params = without('CallDuration');

    await POST(twilioPost(params));

    expect(complete.mock.calls[0][0].durationSeconds).toBeNull();
  });

  it('a zero-second call stores 0, not NULL', async () => {
    await POST(twilioPost({ ...CALLBACK, CallDuration: '0' }));

    expect(complete.mock.calls[0][0].durationSeconds).toBe(0);
  });

  it.each(['busy', 'no-answer', 'failed', 'canceled'])(
    'a final status of %s is passed through from the closed vocabulary',
    async (status) => {
      await POST(twilioPost({ ...CALLBACK, CallStatus: status }));

      expect(complete.mock.calls[0][0].callStatus).toBe(status);
    },
  );
});

/* ------------------------------------------------------------------------- *
 * The hint half — unmatched, unparseable, database down: 200 and no row
 * ------------------------------------------------------------------------- */

describe('voice-status webhook: never a 5xx, never a new row', () => {
  it('a CallSid no row carries updates nothing, creates nothing, logs unmatched', async () => {
    complete.mockResolvedValue({ completed: false, id: null, tenantId: null });

    const response = await POST(twilioPost(CALLBACK));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(complete).toHaveBeenCalledTimes(1);
    assertNoArrivalWrite();
    expect(log).toHaveBeenCalledWith('[twilio] status handled: unmatched.');
  });

  it('an UPDATE that THROWS answers 200 and logs db_failed with the caught value discarded', async () => {
    complete.mockRejectedValue(new Error(`connection terminated: ${CALLBACK.CallSid} +61491570156`));

    const response = await POST(twilioPost(CALLBACK));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(warned('[telephony] status db_failed')).toBe(true);
    expect(log).toHaveBeenCalledWith('[twilio] status handled: db_failed.');
    for (const call of [...warn.mock.calls, ...log.mock.calls]) {
      expect(String(call[0])).not.toContain('+614');
      expect(String(call[0])).not.toContain(CALLBACK.CallSid);
    }
  });

  it('a body that is not a form at all is unparseable: 200, no UPDATE, no row', async () => {
    // decodeFormBody yields nothing, so the signature Twilio would send is over
    // the URL alone — signed that way to reach the parse step.
    const response = await POST(
      twilioPost({}, { rawBody: 'not a form at all', signature: sign(SIGNED_URL, {}) }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(complete).not.toHaveBeenCalled();
    assertNoArrivalWrite();
    expect(log).toHaveBeenCalledWith('[twilio] status handled: unparseable.');
  });

  it.each([
    ['no CallSid', { CallStatus: 'completed', CallDuration: '11' }],
    ['a malformed CallSid', { ...CALLBACK, CallSid: 'CA-not-a-sid' }],
    ['a CallStatus outside the vocabulary', { ...CALLBACK, CallStatus: 'exploded' }],
    ['a non-numeric CallDuration', { ...CALLBACK, CallDuration: '11s' }],
  ])('%s is unparseable — no UPDATE', async (_label, params) => {
    const response = await POST(twilioPost(params as Record<string, string>));

    expect(response.status).toBe(200);
    expect(complete).not.toHaveBeenCalled();
    assertNoArrivalWrite();
    expect(log).toHaveBeenCalledWith('[twilio] status handled: unparseable.');
  });

  it('an unreadable body answers 200 and logs body_unreadable', async () => {
    const request = {
      url: SIGNED_URL,
      headers: new Headers(),
      text: async () => {
        throw new Error('aborted');
      },
    } as unknown as Request;

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(warned('[twilio] status body_unreadable')).toBe(true);
    expect(complete).not.toHaveBeenCalled();
  });

  it('answers a BYTE-IDENTICAL body for every outcome after the token gate', async () => {
    const bodies: string[] = [];

    complete.mockResolvedValue({ completed: true, id: ROW_ID, tenantId: TENANT_ID });
    bodies.push(await (await POST(twilioPost(CALLBACK))).text());

    complete.mockResolvedValue({ completed: false, id: null, tenantId: null });
    bodies.push(await (await POST(twilioPost(CALLBACK))).text());

    complete.mockRejectedValue(new Error('down'));
    bodies.push(await (await POST(twilioPost(CALLBACK))).text());

    bodies.push(await (await POST(twilioPost(CALLBACK, { signature: null }))).text());
    bodies.push(
      await (
        await POST(twilioPost({}, { rawBody: 'not a form at all', signature: sign(SIGNED_URL, {}) }))
      ).text(),
    );

    expect(bodies).toHaveLength(5);
    expect(new Set(bodies)).toEqual(new Set([JSON.stringify({ received: true })]));
  });
});

describe('voice-status webhook: APP_BASE_URL unset fails CLOSED', () => {
  it('answers 200, completes nothing, logs base_url_unset', async () => {
    vi.resetModules();
    vi.doMock('@/core/shared/env', () => ({
      getServerEnv: () => ({
        APP_BASE_URL: undefined,
        TWILIO_AUTH_TOKEN: AUTH_TOKEN,
        TWILIO_VOICE_WEBHOOK_SECRET: VOICE_TOKEN,
        TWILIO_VOICE_STATUS_WEBHOOK_SECRET: STATUS_TOKEN,
      }),
    }));
    const unset = await import('@/app/api/webhooks/twilio/voice-status/route');

    const response = await unset.POST(twilioPost(CALLBACK));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(warned('[twilio] status base_url_unset')).toBe(true);
    expect(complete).not.toHaveBeenCalled();

    vi.doUnmock('@/core/shared/env');
  });
});

describe('voice-status webhook: an env that will not parse is NEVER a 500 (WR-03)', () => {
  it('answers {received:true} with 200, completes nothing, logs a fixed line', async () => {
    vi.resetModules();
    const getServerEnv = vi.fn(() => {
      throw new Error('Invalid server environment: AUDIT_IP_HASH_SALT');
    });
    vi.doMock('@/core/shared/env', () => ({ getServerEnv }));
    const broken = await import('@/app/api/webhooks/twilio/voice-status/route');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await broken.POST(twilioPost(CALLBACK));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(error).toHaveBeenCalledWith('[twilio] status env_unreadable; acknowledged 200.');
    expect(error.mock.calls.flat().join(' ')).not.toContain('AUDIT_IP_HASH_SALT');
    expect(complete).not.toHaveBeenCalled();

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
    const fresh = await import('@/app/api/webhooks/twilio/voice-status/route');

    await fresh.POST(twilioPost(CALLBACK));

    expect(getServerEnv).toHaveBeenCalledTimes(1);
    vi.doUnmock('@/core/shared/env');
  });
});

/* ------------------------------------------------------------------------- *
 * applyVoiceStatus directly — injected deps, never throws
 * ------------------------------------------------------------------------- */

describe('applyVoiceStatus', () => {
  const NOW = new Date('2026-10-01T00:00:00Z');

  it('uses the injected completion and returns completed, with the ROW\'s ids', async () => {
    const injected = vi.fn().mockResolvedValue({ completed: true, id: ROW_ID, tenantId: TENANT_ID });

    const result = await applyVoiceStatus(CALLBACK, { complete: injected, now: NOW });

    // Phase 12: the ids are RETURNING's, and `callEnded` is the final-status
    // fact the route reads before it triggers a text-back.
    expect(result).toEqual({
      kind: 'completed',
      missedCallId: ROW_ID,
      tenantId: TENANT_ID,
      callEnded: true,
    });
    expect(injected).toHaveBeenCalledTimes(1);
    expect(complete).not.toHaveBeenCalled();
  });

  it('uses deps.now as the fallback end time', async () => {
    const injected = vi.fn().mockResolvedValue({ completed: true, id: ROW_ID, tenantId: TENANT_ID });
    const params = without('Timestamp');

    await applyVoiceStatus(params, { complete: injected, now: NOW });

    expect(injected.mock.calls[0][0].endedAt).toEqual(NOW);
  });

  it('never throws: a rejecting completion is db_failed', async () => {
    const injected = vi.fn().mockRejectedValue(new Error('boom'));

    await expect(applyVoiceStatus(CALLBACK, { complete: injected, now: NOW })).resolves.toEqual({
      kind: 'db_failed',
      missedCallId: null,
      tenantId: null,
      callEnded: true,
    });
  });

  it('an empty map is unparseable and calls nothing', async () => {
    const injected = vi.fn();

    expect(await applyVoiceStatus({}, { complete: injected })).toEqual({
      kind: 'unparseable',
      missedCallId: null,
      tenantId: null,
      callEnded: false,
    });
    expect(injected).not.toHaveBeenCalled();
  });

  it('an unmatched completion carries no ids', async () => {
    const injected = vi.fn().mockResolvedValue({ completed: false, id: null, tenantId: null });

    expect(await applyVoiceStatus(CALLBACK, { complete: injected, now: NOW })).toEqual({
      kind: 'unmatched',
      missedCallId: null,
      tenantId: null,
      callEnded: true,
    });
  });

  it.each(['completed', 'busy', 'failed', 'no-answer', 'canceled'])(
    '%s is a FINAL status: callEnded is true',
    async (status) => {
      const injected = vi.fn().mockResolvedValue({ completed: true, id: ROW_ID, tenantId: TENANT_ID });
      const result = await applyVoiceStatus({ ...CALLBACK, CallStatus: status }, { complete: injected });
      expect(result.callEnded).toBe(true);
    },
  );

  it.each(['queued', 'initiated', 'ringing', 'in-progress'])(
    '%s is NOT final: callEnded is false — a ringing call has not been missed yet',
    async (status) => {
      const injected = vi.fn().mockResolvedValue({ completed: true, id: ROW_ID, tenantId: TENANT_ID });
      const result = await applyVoiceStatus({ ...CALLBACK, CallStatus: status }, { complete: injected });
      expect(result.callEnded).toBe(false);
    },
  );
});

/* ------------------------------------------------------------------------- *
 * Phase 12 — the text-back trigger (D-01, T-12-01)
 * ------------------------------------------------------------------------- */

describe('voice-status webhook: the text-back trigger', () => {
  it('calls sendTextBack EXACTLY ONCE with the row id the completion returned', async () => {
    textBack.mockResolvedValue({ kind: 'sent' });

    const response = await POST(twilioPost(CALLBACK));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(textBack).toHaveBeenCalledTimes(1);
    const [id, deps] = textBack.mock.calls[0] as [string, Record<string, unknown>];
    expect(id).toBe(ROW_ID);
    expect(Object.keys(deps).sort()).toEqual(['getSender', 'now']);
    expect(deps.now).toBeInstanceOf(Date);
    // The sender is BUILT by the text-back path when it needs one, not here.
    expect(typeof deps.getSender).toBe('function');
    expect(buildRoutingSender).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('[twilio] status text_back: sent.');
  });

  it('passes NO value from the callback parameters into the send path (T-12-01)', async () => {
    await POST(twilioPost(CALLBACK));

    const [id, deps] = textBack.mock.calls[0] as [string, Record<string, unknown>];
    // The id, and the deps' NON-clock values (the clock is the server's own
    // receipt time — its digits would collide with short values like '11').
    const carried = JSON.stringify([id, { ...deps, now: undefined, getSender: undefined }]);
    for (const value of Object.values(CALLBACK)) {
      expect(carried).not.toContain(value);
    }
    expect(carried).not.toContain('+614');
    // And the clock is NOT the callback's Timestamp: it is the server's.
    expect((deps.now as Date).getTime()).not.toBe(Date.parse(CALLBACK.Timestamp));
  });

  it.each(['busy', 'no-answer', 'failed', 'canceled'])(
    'a final status of %s triggers it too',
    async (status) => {
      await POST(twilioPost({ ...CALLBACK, CallStatus: status }));
      expect(textBack).toHaveBeenCalledTimes(1);
      expect(textBack.mock.calls[0][0]).toBe(ROW_ID);
    },
  );

  it.each(['queued', 'initiated', 'ringing', 'in-progress'])(
    'a NON-final status of %s never triggers it',
    async (status) => {
      await POST(twilioPost({ ...CALLBACK, CallStatus: status }));
      expect(complete).toHaveBeenCalledTimes(1);
      expect(textBack).not.toHaveBeenCalled();
    },
  );

  it('an unmatched CallSid never triggers it', async () => {
    complete.mockResolvedValue({ completed: false, id: null, tenantId: null });
    await POST(twilioPost(CALLBACK));
    expect(textBack).not.toHaveBeenCalled();
  });

  it('a matched DEAD LETTER (no tenant) never triggers it', async () => {
    complete.mockResolvedValue({ completed: true, id: ROW_ID, tenantId: null });
    await POST(twilioPost(CALLBACK));
    expect(textBack).not.toHaveBeenCalled();
  });

  it('a completion that THROWS (db_failed) never triggers it', async () => {
    complete.mockRejectedValue(new Error('down'));
    await POST(twilioPost(CALLBACK));
    expect(textBack).not.toHaveBeenCalled();
  });

  it('an unparseable body never triggers it', async () => {
    await POST(twilioPost({}, { rawBody: 'not a form at all', signature: sign(SIGNED_URL, {}) }));
    expect(textBack).not.toHaveBeenCalled();
  });

  it('a rejected signature never triggers it', async () => {
    await POST(twilioPost(CALLBACK, { signature: null }));
    expect(textBack).not.toHaveBeenCalled();
  });

  it('a 401 never triggers it', async () => {
    const { request } = untouchableRequest(null);
    expect((await POST(request)).status).toBe(401);
    expect(textBack).not.toHaveBeenCalled();
  });

  it('a REJECTING sendTextBack still answers the byte-identical 200, with a fixed log', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    textBack.mockRejectedValue(new Error(`boom ${CALLBACK.From} ${CALLBACK.CallSid}`));

    const response = await POST(twilioPost(CALLBACK));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(JSON.stringify({ received: true }));
    expect(error).toHaveBeenCalledWith('[twilio] status text_back threw; acknowledged 200.');
    for (const call of [...error.mock.calls, ...warn.mock.calls, ...log.mock.calls]) {
      expect(String(call[0])).not.toContain('+614');
      expect(String(call[0])).not.toContain(CALLBACK.CallSid);
    }
  });

  it.each(['sent', 'failed', 'skipped', 'claim_lost', 'pre_claim_failed', 'outcome_unknown'])(
    'a text-back kind of %s answers the byte-identical 200',
    async (kind) => {
      textBack.mockResolvedValue({ kind });
      const response = await POST(twilioPost(CALLBACK));
      expect(await response.text()).toBe(JSON.stringify({ received: true }));
      expect(log).toHaveBeenCalledWith(`[twilio] status text_back: ${kind}.`);
    },
  );
});

/* ------------------------------------------------------------------------- *
 * Configuration and disclosure — source pins
 * ------------------------------------------------------------------------- */

describe('voice-status route configuration', () => {
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

  it('reads its OWN secret and none of the sibling bearers — not even in a comment', () => {
    expect(ROUTE_SOURCE).toContain('env.TWILIO_VOICE_STATUS_WEBHOOK_SECRET');
    for (const other of [
      'TWILIO_VOICE_WEBHOOK_SECRET',
      'CADENCE_TICK_SECRET',
      'SYNC_TICK_SECRET',
      'CLICKSEND_WEBHOOK_SECRET',
      'UNSUBSCRIBE_SIGNING_SECRET',
      'MESSAGING_RECONCILE_SECRET',
      'STALLED_DIGEST_SECRET',
      'CLICKSEND_DLR_SECRET',
    ]) {
      expect(ROUTE_SOURCE).not.toContain(other);
    }
  });

  it('takes the token from the QUERY STRING, not an Authorization header', () => {
    expect(ROUTE_SOURCE).toContain("searchParams.get('token')");
    expect(ROUTE_SOURCE).not.toMatch(/headers\.get\(\s*'authorization'/i);
  });

  it('builds the signed URL from configuration and verifies before the completion', () => {
    expect(ROUTE_SOURCE).toContain("twilioWebhookUrl('voice-status', env)");
    expect(ROUTE_SOURCE).toContain('verifyTwilioSignature(');
    expect(ROUTE_SOURCE.indexOf('verifyTwilioSignature(')).toBeLessThan(
      ROUTE_SOURCE.indexOf('applyVoiceStatus(params'),
    );
    expect(ROUTE_SOURCE).not.toMatch(/url:\s*request\.url/);
  });

  it('interpolates ONLY the two closed-union kinds into its logs (T-11-04, Phase 12)', () => {
    const interpolations = new Set(
      [...ROUTE_SOURCE.matchAll(/console\.\w+\(([\s\S]*?)\);/g)].flatMap((call) =>
        [...call[1].matchAll(/\$\{([^}]*)\}/g)].map((match) => match[1].trim()),
      ),
    );

    // 2026-10 (Phase 12, D-01): the text-back kind joins the result kind —
    // both members of closed unions, neither an id nor a number.
    expect(interpolations).toEqual(new Set(['result.kind', 'textBack.kind']));
  });

  it('never mentions the token in a log call', () => {
    for (const call of ROUTE_SOURCE.matchAll(/console\.\w+\(([\s\S]*?)\);/g)) {
      expect(call[1].toLowerCase()).not.toContain('token');
    }
  });

  it('does not use waitUntil — an acknowledged callback is never re-delivered', () => {
    expect(ROUTE_SOURCE).not.toMatch(/\bwaitUntil\b\s*\(/);
    expect(ROUTE_SOURCE).toContain('await applyVoiceStatus(');
    // The text-back is awaited inside the request too (D-01: no waitUntil).
    expect(ROUTE_SOURCE).toContain('await sendTextBack(');
  });

  it('hands sendTextBack the completion\'s row id and makes no repository call itself', () => {
    expect(ROUTE_SOURCE).toContain('sendTextBack(result.missedCallId,');
    expect(ROUTE_SOURCE).not.toMatch(/from '@\/db\/repository'/);
    expect(ROUTE_SOURCE).not.toMatch(/params\.\w+|params\[/);
  });

  it('contains no insert call of any kind — a hint never creates a row (D-06)', () => {
    expect(ROUTE_SOURCE).not.toMatch(/insert\w*\s*\(/i);
    expect(ROUTE_SOURCE).not.toMatch(/\.insert\b/);
    expect(ROUTE_SOURCE).not.toContain('recordMissedCallArrival');
  });

  it('is EXCLUDED from the proxy matcher', () => {
    const found = PROXY_SOURCE.match(/matcher:\s*\['([^']+)'\]/);
    if (!found) throw new Error('proxy.ts no longer exposes a single-string matcher');

    const matches = (pathname: string) => new RegExp(`^${found[1]}$`).test(pathname);

    expect(matches('/api/webhooks/twilio/voice-status')).toBe(false);
    expect(matches('/')).toBe(true);
  });
});
