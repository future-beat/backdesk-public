/**
 * The two operator notifications for a public audit request (Phase 9, D-13).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THREE THINGS ARE BEING PROVEN, AND EACH IS A THREAT WITH A NUMBER.       │
 * │                                                                          │
 * │ T-9-07 (spoofing): the SMS can only ever reach OPERATOR_ALERT_PHONE.     │
 * │ T-9-08 (tampering): a prospect's own strings go into an email body, so   │
 * │   control characters are stripped before they can forge a header or a    │
 * │   second fact.                                                           │
 * │ T-9-13 (denial of service): the tenant ARMING flag must not silence the  │
 * │   operator's own alert — with `enabled: false`, the send still happens.  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * PURE. The environment, the repository and the ClickSend client are mocked;
 * NO SUITE EVER TEXTS ANYONE. The one-segment budget is measured with the
 * shared GSM-7 counter rather than by counting characters here, so a change to
 * the septet tables cannot leave this assertion agreeing with itself.
 *
 * AND IT IS MEASURED ON THE RAW RETURN VALUE (WR-03). These cases used to count
 * `normalizeForGsm7(body)` while `sendSms` sent `body` — the suite proved the
 * budget on a string that never left the process, so a curly apostrophe in a
 * name tripled the real cost with every assertion still green. The normalise
 * now happens inside the builder; nothing in this file may re-introduce it on
 * the measuring side.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { countSeptets, segmentCount } from '../src/core/drafting/gsm7';

const BASE_URL = 'https://app.backdesk.com.au';
const OPERATOR_PHONE = '+61491578888';
const FROM_NUMBER = '+61491579212';
const REQUEST_ID = '2f1c8f8e-0000-4000-8000-000000000000';

/** Mutable so a test can take the ClickSend credentials away. */
const env: Record<string, string | undefined> = {
  APP_BASE_URL: BASE_URL,
  OPERATOR_ALERT_PHONE: OPERATOR_PHONE,
  CLICKSEND_USERNAME: 'ci-user',
  CLICKSEND_API_KEY: 'ci-key',
};

/** Mutable so a test can remove the global messaging_config row entirely. */
let channelRow: { enabled: boolean; fromAddress: string | null } | null = {
  // DISARMED ON PURPOSE — the current production state, and the whole point of
  // the T-9-13 assertion below.
  enabled: false,
  fromAddress: FROM_NUMBER,
};

const getChannelConfig = vi.fn(async () => channelRow);
const sendSms = vi.fn(async () => ({ ok: true as const, messageId: 'msg_1', status: 'SUCCESS' }));

vi.mock('@/core/shared/env', () => ({ getServerEnv: () => env }));
vi.mock('@/db/repository', () => ({
  getChannelConfig: (...args: unknown[]) => getChannelConfig(...(args as [])),
}));
vi.mock('@/core/messaging/clicksend-client', () => ({
  sendSms: (...args: unknown[]) => sendSms(...(args as [])),
}));

const { alertSubject, auditRequestAlertBody, auditRequestUrl, consoleBaseUrl } = await import(
  '../src/core/alerts/operator-email'
);
const { auditRequestSmsBody, sendOperatorSms } = await import(
  '../src/core/alerts/operator-sms'
);

const AT = new Date('2026-09-09T09:14:03.000Z');

beforeEach(() => {
  vi.clearAllMocks();
  env.CLICKSEND_USERNAME = 'ci-user';
  env.CLICKSEND_API_KEY = 'ci-key';
  channelRow = { enabled: false, fromAddress: FROM_NUMBER };
});

describe('the email subject (UI-SPEC Operator notifications)', () => {
  it('names the service and the business', () => {
    expect(alertSubject('audit_request', 'Acme Plumbing')).toBe(
      'Backdesk · Audit request: Acme Plumbing',
    );
  });

  /** The two sync kinds are load-bearing elsewhere; widening must not move them. */
  it('leaves the two sync subjects exactly as they were', () => {
    expect(alertSubject('auth_failed', 'Acme Plumbing')).toBe(
      'ServiceM8 connection failed — follow-ups paused for Acme Plumbing',
    );
    expect(alertSubject('degraded', 'Acme Plumbing')).toBe(
      'ServiceM8 sync degraded for Acme Plumbing',
    );
  });

  /**
   * ONE RULE, ALL THREE KINDS (WR-02). The sync names are operator-typed and
   * carry no controls in practice; the strip is applied to them anyway so
   * there is no conditional here for a future reader to have to justify.
   */
  it('strips controls from the sync subjects as well', () => {
    expect(alertSubject('degraded', 'Acme\u0000 Plumbing\u0085')).toBe(
      'ServiceM8 sync degraded for Acme Plumbing',
    );
  });
});

describe('the email body carries every fact the operator needs to act', () => {
  const body = () =>
    auditRequestAlertBody({
      requestId: REQUEST_ID,
      businessName: 'Northbridge Electrical',
      contactName: 'Dave Rowley',
      phone: '+61412345678',
      email: 'dave@example.com',
      trade: 'Electrical',
      quotesBand: '8–15',
      servicem8: true,
      hasCsv: false,
      at: AT,
      url: auditRequestUrl(REQUEST_ID),
    });

  it('contains the business, contact, phone, trade, band and the ServiceM8 answer', () => {
    const text = body();
    expect(text).toContain('Business: Northbridge Electrical');
    expect(text).toContain('Contact: Dave Rowley');
    expect(text).toContain('Mobile: +61412345678');
    expect(text).toContain('Email: dave@example.com');
    expect(text).toContain('Trade: Electrical');
    expect(text).toContain('Quotes a month: 8–15');
    expect(text).toContain('On ServiceM8: yes');
    expect(text).toContain('Job List export attached: no');
  });

  it('links the console detail page for this request', () => {
    expect(consoleBaseUrl()).toBe(BASE_URL);
    expect(body()).toContain(`${BASE_URL}/audits/requests/${REQUEST_ID}`);
  });

  /**
   * T-9-08. `\r\n` inside a name is how a form field becomes a forged header in
   * a mail body. The name still reads, minus the structure it tried to add.
   */
  it('strips control characters out of a header-injection attempt', () => {
    // THE SUBJECT IS THE ACTUAL HEADER (WR-02). The body assertion below is the
    // older one; this line is the field where a surviving `\r\n` would be a
    // forged header rather than a fabricated second fact in a plain-text body.
    const subject = alertSubject('audit_request', 'Acme\r\nBcc: x@evil.test');
    expect(subject).toBe('Backdesk · Audit request: AcmeBcc: x@evil.test');
    expect(subject).not.toMatch(/[\r\n]/);

    const text = auditRequestAlertBody({
      requestId: REQUEST_ID,
      businessName: 'Acme\r\nBcc: x@evil.test',
      contactName: 'Dave',
      phone: '+61412345678',
      email: 'dave@example.com',
      trade: 'Electrical',
      quotesBand: '8–15',
      servicem8: false,
      hasCsv: false,
      at: AT,
      url: auditRequestUrl(REQUEST_ID),
    });

    expect(text).toContain('Business: AcmeBcc: x@evil.test');
    expect(text).not.toMatch(/^Bcc:/m);
    expect(text).not.toContain('\r');
  });
});

describe('the SMS fits one GSM-7 segment at its worst case (Pitfall 6)', () => {
  /** 40 code points — the cap, so this is the widest a business name can be. */
  const BUSINESS_40 = 'Northbridge Electrical and Air Condit';
  const CONTACT_30 = 'Bartholomew Higginbotham-Ross';
  const PHONE_12 = '+61412345678';

  it('the fixtures really are the caps', () => {
    expect(Array.from(`${BUSINESS_40}xxx`).length).toBe(40);
    expect(Array.from(`${CONTACT_30}x`).length).toBe(30);
    expect(Array.from(PHONE_12).length).toBe(12);
  });

  it('renders the locked shape and stays inside one segment', () => {
    const business = `${BUSINESS_40}xxx`;
    const contact = `${CONTACT_30}x`;
    const body = auditRequestSmsBody({
      businessName: business,
      contactName: contact,
      phone: PHONE_12,
    });

    expect(body).toBe(
      `Backdesk: audit request from ${business}. ${contact} ${PHONE_12}. ` +
        'app.backdesk.com.au/audits/requests',
    );

    // THE RAW RETURN VALUE, not a normalised copy of it (WR-03). `sendSms`
    // sends this string verbatim, so counting `normalizeForGsm7(body)` here
    // proved the budget on a production that never leaves the process.
    const counted = countSeptets(body);
    expect(counted).toEqual({ encoding: 'gsm7', septets: 151 });
    expect(segmentCount(151)).toBe(1);
  });

  /** Cut, not ellipsised: an ellipsis costs a septet to say nothing. */
  it('cuts an over-long business name to 40 and contact to 30, with no ellipsis', () => {
    const body = auditRequestSmsBody({
      businessName: 'B'.repeat(60),
      contactName: 'C'.repeat(50),
      phone: PHONE_12,
    });

    expect(body).toContain(`from ${'B'.repeat(40)}. `);
    expect(body).toContain(`${'C'.repeat(30)} ${PHONE_12}`);
    expect(body).not.toContain('…');
    expect(body).not.toContain('...');

    const counted = countSeptets(body);
    if (counted.encoding !== 'gsm7') throw new Error('the body must be GSM-7');
    expect(segmentCount(counted.septets)).toBe(1);
  });

  /**
   * THE COMMON CASE, WHICH USED TO COST 3x (WR-03).
   *
   * An iPhone keyboard types `’` rather than `'` by default, so `O’Brien` is
   * what a real contact name looks like — and one of those characters flips the
   * whole body to UCS-2 at 67 septets a segment. The builder now normalises
   * before it cuts, so the body that is SENT is GSM-7.
   */
  it('repairs smart punctuation so a real name still costs one segment', () => {
    const body = auditRequestSmsBody({
      businessName: 'Zoe’s Electrical – Perth…',
      contactName: 'O’Brien',
      phone: PHONE_12,
    });

    expect(body).toContain("from Zoe's Electrical - Perth...");
    expect(body).toContain("O'Brien");
    expect(body).not.toMatch(/[’–…]/);

    const counted = countSeptets(body);
    if (counted.encoding !== 'gsm7') throw new Error('the body must be GSM-7');
    expect(segmentCount(counted.septets)).toBe(1);
  });

  /**
   * WR-04. The email body strips C0/C1 controls (T-9-08); the SMS took them
   * verbatim, so a `\n` in a business name pushed the contact, the phone
   * number and the console link onto lines of their own, and a `\r` could hide
   * the tail of the message on some handsets. Not a routing risk — there is no
   * recipient parameter (T-9-07) — but the operator's callback number is the
   * point of this message.
   *
   * The SAME function the email uses, imported from the intake boundary: one
   * spelling of the rule is the fix, not a second regex that agrees today.
   */
  it('takes no newlines or control characters from a name (WR-04)', () => {
    const body = auditRequestSmsBody({
      businessName: 'Acme\r\nPlumbing\u0085',
      contactName: 'Dave\tRowley\u0000',
      phone: PHONE_12,
    });

    expect(body).toBe(
      `Backdesk: audit request from AcmePlumbing. DaveRowley ${PHONE_12}. ` +
        'app.backdesk.com.au/audits/requests',
    );
    expect(body).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);

    const counted = countSeptets(body);
    if (counted.encoding !== 'gsm7') throw new Error('the body must be GSM-7');
    expect(segmentCount(counted.septets)).toBe(1);
  });

  /**
   * A name made only of controls and whitespace cuts to nothing rather than to
   * a run of invisible characters that spends the budget saying nothing.
   */
  it('collapses a control-only name to empty', () => {
    const body = auditRequestSmsBody({
      businessName: '\r\n\u0000\u0085',
      contactName: 'Dave',
      phone: PHONE_12,
    });

    expect(body).toContain('audit request from . Dave ');
  });

  /**
   * THE HONEST RESIDUAL, STATED RATHER THAN CLAIMED AWAY.
   *
   * `normalizeForGsm7` repairs LOOKALIKES; it does not transliterate. `ë` is
   * not on the GSM 03.38 basic table and has no lookalike, so a name carrying
   * one is still a UCS-2 body — and that is the right answer, because the
   * alternative is showing the operator a name the prospect did not give.
   * At one alert per request the extra segments are noise.
   *
   * Pinned so the residual is a known number rather than a surprise on an
   * invoice, and so nobody "fixes" it by stripping accents out of a name.
   */
  it('still flips to UCS-2 for a character with no GSM-7 lookalike', () => {
    const body = auditRequestSmsBody({
      businessName: 'Zoë’s Electrical',
      contactName: 'O’Brien',
      phone: PHONE_12,
    });

    // The smart quotes were still repaired — only the `ë` survives.
    expect(body).toContain("from Zoë's Electrical");
    expect(countSeptets(body)).toEqual({ encoding: 'ucs2', unsupported: ['ë'] });
  });

  /**
   * The uuid, the trade and the band live in the EMAIL. A uuid is a quarter of
   * the segment to save one tap on a list sorted newest-first.
   */
  it('carries no request id, trade or band', () => {
    const body = auditRequestSmsBody({
      businessName: 'Northbridge Electrical',
      contactName: 'Dave Rowley',
      phone: PHONE_12,
    });

    expect(body).not.toContain(REQUEST_ID);
    expect(body).not.toContain('Electrical,');
    expect(body).not.toContain('8-15');
    expect(body).toContain('app.backdesk.com.au/audits/requests');
    expect(body).not.toMatch(/audits\/requests\/\S/);
  });
});

describe('sendOperatorSms — the recipient and the arming flag (T-9-07, T-9-13)', () => {
  it('sends from the global row even when that row is DISARMED', async () => {
    const result = await sendOperatorSms({ requestId: REQUEST_ID, body: 'hello' });

    expect(result).toEqual({ ok: true });
    expect(getChannelConfig).toHaveBeenCalledWith('sms');
    expect(sendSms).toHaveBeenCalledTimes(1);

    const [input, creds] = sendSms.mock.calls[0] as unknown as [
      { to: string; from: string; body: string; customString: string },
      { username: string; apiKey: string },
    ];
    // THE RECIPIENT IS THE ENVIRONMENT'S, never an argument and never a form
    // value — there is no parameter through which it could be one.
    expect(input.to).toBe(OPERATOR_PHONE);
    expect(input.from).toBe(FROM_NUMBER);
    expect(input.body).toBe('hello');
    expect(creds).toEqual({ username: 'ci-user', apiKey: 'ci-key' });
  });

  /** So a delivery receipt can never match a `send_ledger` row id. */
  it('prefixes the custom string with the request kind', async () => {
    await sendOperatorSms({ requestId: REQUEST_ID, body: 'hello' });
    const [input] = sendSms.mock.calls[0] as unknown as [{ customString: string }];
    expect(input.customString).toBe(`audit-request:${REQUEST_ID}`);
  });

  it('reports not_configured when there is no global sms row', async () => {
    channelRow = null;
    const result = await sendOperatorSms({ requestId: REQUEST_ID, body: 'hello' });

    expect(result).toEqual({
      ok: false,
      kind: 'not_configured',
      detail: 'no global sms from-number',
    });
    expect(sendSms).not.toHaveBeenCalled();
  });

  it('reports not_configured when the row carries no from-number', async () => {
    channelRow = { enabled: true, fromAddress: null };
    const result = await sendOperatorSms({ requestId: REQUEST_ID, body: 'hello' });

    expect(result).toMatchObject({ ok: false, kind: 'not_configured' });
    expect(sendSms).not.toHaveBeenCalled();
  });

  it('reports not_configured when the ClickSend credentials are absent', async () => {
    env.CLICKSEND_USERNAME = undefined;
    env.CLICKSEND_API_KEY = undefined;

    const result = await sendOperatorSms({ requestId: REQUEST_ID, body: 'hello' });

    expect(result).toEqual({
      ok: false,
      kind: 'not_configured',
      detail: 'clicksend credentials absent',
    });
    // Not even the config read happens: nothing can be sent, so nothing is asked.
    expect(getChannelConfig).not.toHaveBeenCalled();
    expect(sendSms).not.toHaveBeenCalled();
  });

  it('maps a provider refusal to send_failed with the reason CODE only', async () => {
    sendSms.mockResolvedValueOnce({
      ok: false,
      reason: 'http_429',
      retryable: true,
      optedOut: false,
    } as never);

    const result = await sendOperatorSms({ requestId: REQUEST_ID, body: 'hello' });
    expect(result).toEqual({ ok: false, kind: 'send_failed', detail: 'http_429' });
  });
});
