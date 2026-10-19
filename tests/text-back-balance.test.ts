/**
 * THE TEXT-BACK ALARM'S PURE HALF (Phase 12, plan 12-04; D-07, D-10, TXT-06).
 *
 * What an operator email may carry, how the provider's insufficient-credit
 * code is recognised, and — for the balance probe — how ClickSend's decimal
 * string becomes integer cents, which floor each figure crosses, which Perth
 * day an alert belongs to, and that reading the balance never throws.
 *
 * PURE: no database, no network. `getAccountBalance` is given an injected
 * `fetch`; nothing here imports `tests/helpers/seed`.
 */
import { describe, expect, it } from 'vitest';

import {
  buildAutoDisarmAlert,
  buildBalanceLowAlert,
  buildBalanceUnreadableAlert,
  buildTextBackFailureAlert,
  formatAud,
} from '@/core/alerts/text-back-alerts';
import {
  CLICKSEND_BALANCE_ALERT_FLOOR_CENTS,
  CLICKSEND_BALANCE_DISARM_FLOOR_CENTS,
} from '@/core/audit/constants';
import {
  AUTO_DISARM_REASON,
  decideBalanceActions,
  parseBalanceCents,
  perthAlertDay,
} from '@/core/leads/balance';
import {
  codeOf,
  getAccountBalance,
  isInsufficientCreditCode,
} from '@/core/messaging/clicksend-client';

const AT = new Date('2026-10-06T02:30:00.000Z');
const URL_BASE = 'https://console.example.test/clients';

/** No phone number, no id: the T-12-07 check every builder's output passes. */
function expectNoIdentifiers(text: string): void {
  expect(text).not.toContain('+61');
  expect(text).not.toMatch(/\d{8,}/);
  // No uuid-shaped token either: a tenant, call or ledger id.
  expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
}

describe('buildTextBackFailureAlert (D-10, T-12-07)', () => {
  const alert = buildTextBackFailureAlert({
    perClient: [
      { tenantName: 'Acme Plumbing', failed: 1, unknown: 0 },
      { tenantName: 'Bright Sparks Electrical', failed: 2, unknown: 1 },
    ],
    at: AT,
    clientsUrl: URL_BASE,
  });

  it('subject carries the total', () => {
    expect(alert.subject).toBe('4 missed-call texts did not go through');
  });

  it('one line per client with failed and unknown counted separately, largest first', () => {
    const lines = alert.body.split('\n');
    const first = lines.indexOf('Bright Sparks Electrical: 2 failed, 1 outcome unknown');
    const second = lines.indexOf('Acme Plumbing: 1 failed, 0 outcome unknown');
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
  });

  it('says nothing is re-sent, and points at the client list', () => {
    expect(alert.body).toContain('Nothing is re-sent automatically');
    expect(alert.body).toContain(`Open the clients: ${URL_BASE}`);
    expect(alert.body).toContain('Detected: 2026-10-06 02:30:00 UTC');
  });

  it('carries no number, no id and no body text', () => {
    expectNoIdentifiers(alert.subject);
    expectNoIdentifiers(alert.body);
  });

  it('singular agreement for one text', () => {
    const one = buildTextBackFailureAlert({
      perClient: [{ tenantName: 'Acme Plumbing', failed: 0, unknown: 1 }],
      at: AT,
      clientsUrl: URL_BASE,
    });
    expect(one.subject).toBe('1 missed-call text did not go through');
    expect(one.body.startsWith('1 missed-call text failed or has no confirmed outcome.')).toBe(true);
  });

  it('never throws on an empty input', () => {
    expect(() => buildTextBackFailureAlert({ perClient: [], clientsUrl: URL_BASE })).not.toThrow();
  });

  describe('the fourth category: an armed client cannot send (12-REVIEW WR-02)', () => {
    it('alone: its own subject and sentence, a remedy per reason, no failure sentence and no identifiers', () => {
      const only = buildTextBackFailureAlert({
        perClient: [{ tenantName: 'Acme Plumbing', failed: 0, unknown: 0, noTemplate: 1, smsNotArmed: 2 }],
        at: AT,
        clientsUrl: URL_BASE,
      });
      expect(only.subject).toBe('3 missed callers not texted: text-back cannot send for an armed client');
      expect(only.body.startsWith('3 missed callers were not texted because a client armed')).toBe(true);
      expect(only.body).toContain('Acme Plumbing: 1 not texted — the attested wording no longer validates');
      expect(only.body).toContain('Acme Plumbing: 2 not texted — SMS is not armed for this client');
      expect(only.body).not.toContain('did not go through');
      expect(only.body).not.toContain('Acme Plumbing: 0 failed');
      expect(only.body).toContain(`Open the clients: ${URL_BASE}`);
      expectNoIdentifiers(only.subject);
      expectNoIdentifiers(only.body);
    });

    it('singular agreement for one caller', () => {
      const one = buildTextBackFailureAlert({
        perClient: [{ tenantName: 'Acme Plumbing', failed: 0, unknown: 0, noTemplate: 1 }],
        at: AT,
        clientsUrl: URL_BASE,
      });
      expect(one.subject).toBe('1 missed caller not texted: text-back cannot send for an armed client');
      expect(one.body.startsWith('1 missed caller was not texted')).toBe(true);
    });
  });

  describe('the third category: sent, but the quote cadence did not pause (12-05, D-08)', () => {
    it('alone: the subject and body say the text went out and what to do, and no failure sentence', () => {
      const only = buildTextBackFailureAlert({
        perClient: [{ tenantName: 'Acme Plumbing', failed: 0, unknown: 0, pauseFailed: 1 }],
        at: AT,
        clientsUrl: URL_BASE,
      });
      expect(only.subject).toBe('1 quote cadence not paused after a missed call');
      expect(only.body).toContain(
        'Acme Plumbing: 1 sent, but the quote cadence could not be paused — pause it on the quote page',
      );
      expect(only.body).toContain('Pause the cadence on the quote page');
      expect(only.body).not.toContain('did not go through');
      expect(only.body).not.toContain('failed or');
      expect(only.body).toContain(`Open the clients: ${URL_BASE}`);
      expectNoIdentifiers(only.body);
      expectNoIdentifiers(only.subject);
    });

    it('beside failures: both sections, the subject names both, each client under its own heading', () => {
      const both = buildTextBackFailureAlert({
        perClient: [
          { tenantName: 'Acme Plumbing', failed: 0, unknown: 0, pauseFailed: 2 },
          { tenantName: 'Bright Sparks Electrical', failed: 1, unknown: 0 },
        ],
        at: AT,
        clientsUrl: URL_BASE,
      });
      expect(both.subject).toBe(
        '1 missed-call text did not go through; 2 quote cadences not paused after a missed call',
      );
      expect(both.body).toContain('Bright Sparks Electrical: 1 failed, 0 outcome unknown');
      expect(both.body).toContain('Acme Plumbing: 2 sent, but the quote cadence could not be paused');
      // A pause-only client is not listed as "0 failed".
      expect(both.body).not.toContain('Acme Plumbing: 0 failed');
      expectNoIdentifiers(both.body);
    });
  });
});

describe('isInsufficientCreditCode (D-10)', () => {
  it('recognises the provider spelling the first live SMS failed with', () => {
    expect(isInsufficientCreditCode('INSUFFICIENT_CREDIT')).toBe(true);
    // What `sendTextBack` records is the `codeOf` token, so it round-trips.
    expect(isInsufficientCreditCode(codeOf('INSUFFICIENT_CREDIT'))).toBe(true);
  });

  it('casing and separators cannot matter', () => {
    expect(isInsufficientCreditCode('insufficient credit')).toBe(true);
    expect(isInsufficientCreditCode('Insufficient-Credit')).toBe(true);
  });

  it('other refusals are not it', () => {
    for (const code of ['INVALID_RECIPIENT', 'http_401', 'stub', 'unknown', 'CREDIT', 'INSUFFICIENT']) {
      expect(isInsufficientCreditCode(code), code).toBe(false);
    }
  });
});

describe('formatAud', () => {
  it('formats whole cents with integer arithmetic', () => {
    expect(formatAud(0)).toBe('A$0.00');
    expect(formatAud(2)).toBe('A$0.02');
    expect(formatAud(499)).toBe('A$4.99');
    expect(formatAud(2000)).toBe('A$20.00');
    expect(formatAud(123456)).toBe('A$1234.56');
  });

  it('an overdraft carries its sign before the currency, never a mangled fraction (CR-01)', () => {
    expect(formatAud(-2087)).toBe('-A$20.87');
    expect(formatAud(-1)).toBe('-A$0.01');
    expect(formatAud(-300)).toBe('-A$3.00');
  });
});

/* -------------------------------------------------------------------------- *
 * The balance (D-07, D-10, TXT-06)
 * -------------------------------------------------------------------------- */

describe('parseBalanceCents — decimal dollars to whole cents, rounded down, no float', () => {
  it.each([
    ['20', 2000],
    ['20.00', 2000],
    ['19.999', 1999],
    ['0.029806', 2],
    ['5', 500],
    ['4.99', 499],
    ['0', 0],
    [' 12.3 ', 1230],
    [20, 2000],
    [19.999, 1999],
    [0.1, 10],
    // An overdraft is a readable balance, below both floors (12-REVIEW CR-01).
    ['-20.87', -2087],
    ['-1', -100],
    [-1, -100],
    [-20.87, -2087],
    // Rounded DOWN is towards minus infinity: an overdraft never rounds up to zero.
    ['-20.871', -2088],
    ['-0.001', -1],
    ['-0.00', 0],
    ['-0', 0],
  ] as const)('%j → %i', (raw, cents) => {
    expect(parseBalanceCents(raw)).toBe(cents);
  });

  it.each<[unknown]>([
    [''],
    ['abc'],
    ['-'],
    ['--1'],
    ['- 1'],
    ['-.5'],
    ['1e3'],
    ['5.'],
    ['.5'],
    ['+5'],
    ['1,000.00'],
    [null],
    [undefined],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [{}],
  ])('%j is unreadable', (raw) => {
    expect(parseBalanceCents(raw)).toBeNull();
  });
});

describe('decideBalanceActions — strict floors (D-07)', () => {
  it('the floors are the D-07 constants', () => {
    expect(CLICKSEND_BALANCE_ALERT_FLOOR_CENTS).toBe(2000);
    expect(CLICKSEND_BALANCE_DISARM_FLOOR_CENTS).toBe(500);
  });

  it.each([
    [2000, false, false],
    [1999, true, false],
    [500, true, false],
    [499, true, true],
    [0, true, true],
    [-2087, true, true],
  ])('%i cents → alertLow %s, disarm %s', (cents, alertLow, disarm) => {
    expect(decideBalanceActions(cents)).toEqual({ alertLow, disarm });
  });

  it('the audit reason names the floor', () => {
    expect(AUTO_DISARM_REASON).toBe('auto: ClickSend balance below A$5');
  });
});

describe('perthAlertDay — the latch key rolls at Perth midnight (16:00 UTC)', () => {
  it('15:59:59 UTC and 16:00:00 UTC on one UTC date are two consecutive Perth dates', () => {
    expect(perthAlertDay(new Date('2026-10-06T15:59:59.000Z'))).toBe('2026-10-06');
    expect(perthAlertDay(new Date('2026-10-06T16:00:00.000Z'))).toBe('2026-10-07');
  });

  it('the Perth morning is the same Perth day as the previous UTC evening', () => {
    expect(perthAlertDay(new Date('2026-12-31T16:30:00.000Z'))).toBe('2027-01-01');
    expect(perthAlertDay(new Date('2026-01-01T00:00:00.000Z'))).toBe('2026-01-01');
  });
});

describe('getAccountBalance — never throws, closed reasons (T-12-21)', () => {
  const CREDS = { username: 'user@example.test', apiKey: 'SECRET-KEY-123' };

  function respond(status: number, body: unknown): typeof fetch {
    return (async () =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
  }

  const AUD = (balance: unknown) => ({
    http_code: 200,
    data: { balance, _currency: { currency_name_short: 'AUD' }, low_credit_amount: 0.5 },
  });

  it('a 200 with an AUD balance gives ok with whole cents', async () => {
    expect(await getAccountBalance(CREDS, { fetchImpl: respond(200, AUD('19.999')) })).toEqual({
      ok: true,
      balanceCents: 1999,
      currency: 'AUD',
    });
    expect(await getAccountBalance(CREDS, { fetchImpl: respond(200, AUD(0.029806)) })).toEqual({
      ok: true,
      balanceCents: 2,
      currency: 'AUD',
    });
  });

  it('a negative balance is READ, not unreadable: an overdraft is the lowest balance there is (CR-01)', async () => {
    expect(await getAccountBalance(CREDS, { fetchImpl: respond(200, AUD('-3.00')) })).toEqual({
      ok: true,
      balanceCents: -300,
      currency: 'AUD',
    });
    expect(await getAccountBalance(CREDS, { fetchImpl: respond(200, AUD(-20.87)) })).toEqual({
      ok: true,
      balanceCents: -2087,
      currency: 'AUD',
    });
  });

  it('GETs /v3/account with Basic auth and an abort signal', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url: String(url), init };
      return new Response(JSON.stringify(AUD('20')), { status: 200 });
    }) as unknown as typeof fetch;

    await getAccountBalance(CREDS, { fetchImpl });

    expect(seen!.url).toBe('https://rest.clicksend.com/v3/account');
    expect(seen!.init.method).toBe('GET');
    expect((seen!.init.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from('user@example.test:SECRET-KEY-123').toString('base64')}`,
    );
    expect(seen!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ['a 401', respond(401, { response_code: 'UNAUTHORIZED' }), 'http_401'],
    ['a 503', respond(503, 'oops'), 'http_503'],
    ['no balance field', respond(200, { data: { _currency: { currency_name_short: 'AUD' } } }), 'unparseable'],
    ['prose for a balance', respond(200, AUD('lots')), 'unparseable'],
    ['an object for a balance', respond(200, AUD({ amount: 5 })), 'unparseable'],
    ['a body that is not JSON', respond(200, '<html>'), 'unparseable'],
    ['a currency other than AUD', respond(200, { data: { balance: '3.00', _currency: { currency_name_short: 'USD' } } }), 'not_aud'],
    ['no currency at all', respond(200, { data: { balance: '3.00' } }), 'not_aud'],
  ])('%s → ok false (%s)', async (_label, fetchImpl, reason) => {
    expect(await getAccountBalance(CREDS, { fetchImpl })).toEqual({ ok: false, reason });
  });

  it('a thrown fetch is network, a timeout is timeout — and the error text never escapes', async () => {
    const thrown = (async () => {
      throw new TypeError('fetch failed for https://user@example.test:SECRET-KEY-123@rest.clicksend.com');
    }) as unknown as typeof fetch;
    const timedOut = (async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    }) as unknown as typeof fetch;

    const network = await getAccountBalance(CREDS, { fetchImpl: thrown });
    expect(network).toEqual({ ok: false, reason: 'network' });
    expect(JSON.stringify(network)).not.toContain('SECRET');
    expect(await getAccountBalance(CREDS, { fetchImpl: timedOut })).toEqual({ ok: false, reason: 'timeout' });
  });

  it('a real abort after the budget is a timeout', async () => {
    const hang = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;

    expect(await getAccountBalance(CREDS, { fetchImpl: hang, timeoutMs: 10 })).toEqual({
      ok: false,
      reason: 'timeout',
    });
  });
});

describe('the balance emails — balance, floors and counts only (T-12-07)', () => {
  const low = buildBalanceLowAlert({
    balanceCents: 1500,
    alertFloorCents: 2000,
    disarmFloorCents: 500,
    armedClients: 3,
    at: AT,
    clientsUrl: URL_BASE,
  });
  const disarmed = buildAutoDisarmAlert({
    balanceCents: 450,
    disarmFloorCents: 500,
    disarmedClients: 2,
    at: AT,
    clientsUrl: URL_BASE,
  });
  const unreadable = buildBalanceUnreadableAlert({
    reason: 'http_401',
    armedClients: 1,
    at: AT,
    clientsUrl: URL_BASE,
  });

  it('the low-balance email names the balance, the floor and the armed count', () => {
    expect(low.subject).toBe('ClickSend balance low: A$15.00');
    expect(low.body).toContain('The ClickSend balance is A$15.00, below the A$20.00 alert floor.');
    expect(low.body).toContain('3 clients are armed for missed-call texts.');
    expect(low.body).toContain('Below A$5.00');
  });

  it('the auto-disarm email says how many were switched off and how to undo it', () => {
    expect(disarmed.subject).toBe(
      'Missed-call texts switched off for 2 clients: ClickSend balance A$4.50',
    );
    expect(disarmed.body).toContain('switched off for 2 clients');
    expect(disarmed.body).toContain('as a system action');
    expect(disarmed.body).toContain('re-arm each client');
  });

  it('the unreadable email says nobody was switched off', () => {
    expect(unreadable.subject).toBe('ClickSend balance could not be read');
    expect(unreadable.body).toContain('(http_401). Nobody was switched off');
    expect(unreadable.body).toContain('1 client is armed');
  });

  it('an overdraft reaches the auto-disarm email with its sign (CR-01)', () => {
    const overdrawn = buildAutoDisarmAlert({
      balanceCents: -2087,
      disarmFloorCents: 500,
      disarmedClients: 1,
      at: AT,
      clientsUrl: URL_BASE,
    });
    expect(overdrawn.subject).toBe('Missed-call texts switched off for 1 client: ClickSend balance -A$20.87');
    expect(overdrawn.body).toContain('The ClickSend balance is -A$20.87, below the A$5.00 floor');
    expectNoIdentifiers(overdrawn.body);
  });

  it('none carries a number, an id or a credential', () => {
    for (const email of [low, disarmed, unreadable]) {
      expectNoIdentifiers(email.subject);
      expectNoIdentifiers(email.body);
      expect(email.body).not.toMatch(/api.?key|password|username/i);
    }
  });
});
