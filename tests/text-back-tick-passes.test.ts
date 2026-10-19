/**
 * THE TEXT-BACK TICK PASSES, PROVEN WITHOUT A DATABASE (Phase 12, plan 12-04).
 *
 * `tests/text-back-sweep.test.ts` proves the passes against a migrated database
 * and runs only in CI. This suite proves the ORCHESTRATION locally, with the
 * repository and `sendTextBack` replaced by recorders: which bounds the sweep
 * asks for, that no seam means no scan, that one row throwing does not stop the
 * next, that a lost alert email is reported as lost, and that an unreadable
 * balance never disarms anybody.
 *
 * PURE: it imports neither `tests/helpers/seed` nor a database client, and
 * every repository name the passes import is a `vi.fn` here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TouchSender } from '@/core/cadence/sender';

const listPendingTextBacks = vi.fn();
const markStaleTextBacks = vi.fn();
const claimTextBackAlerts = vi.fn();
const tenantGet = vi.fn();
const listArmedTextBackTenantIds = vi.fn();
const disarmChannelBySystem = vi.fn();
const claimOperatorAlert = vi.fn();

vi.mock('@/db/repository', () => ({
  listPendingTextBacks: (...args: unknown[]) => listPendingTextBacks(...args),
  markStaleTextBacks: (...args: unknown[]) => markStaleTextBacks(...args),
  claimTextBackAlerts: (...args: unknown[]) => claimTextBackAlerts(...args),
  forTenant: (tenantId: string) => ({ tenant: { get: () => tenantGet(tenantId) } }),
  listArmedTextBackTenantIds: (...args: unknown[]) => listArmedTextBackTenantIds(...args),
  disarmChannelBySystem: (...args: unknown[]) => disarmChannelBySystem(...args),
  claimOperatorAlert: (...args: unknown[]) => claimOperatorAlert(...args),
}));

/** The console URL is read from the environment; a throwing read is a case below. */
const getServerEnv = vi.fn();
vi.mock('@/core/shared/env', () => ({ getServerEnv: () => getServerEnv() }));

const sendTextBack = vi.fn();
vi.mock('@/core/leads/text-back', () => ({
  sendTextBack: (...args: unknown[]) => sendTextBack(...args),
}));

const { runTextBackAlertPass, runTextBackSweep, TEXT_BACK_SWEEP_LIMIT } = await import(
  '@/core/leads/sweep'
);
const { runBalanceProbe, AUTO_DISARM_REASON } = await import('@/core/leads/balance');

const NOW = new Date('2026-10-06T02:30:00.000Z');
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const NAMES: Record<string, string> = { [TENANT_A]: 'Acme Plumbing', [TENANT_B]: 'Bright Sparks' };
const SENDER: TouchSender = {
  provider: 'clicksend',
  send: async () => ({ kind: 'sent', provider: 'clicksend', providerMessageId: null }),
};

beforeEach(() => {
  vi.clearAllMocks();
  listPendingTextBacks.mockResolvedValue([]);
  markStaleTextBacks.mockResolvedValue(0);
  claimTextBackAlerts.mockResolvedValue([]);
  tenantGet.mockImplementation(async (tenantId: string) => [{ name: NAMES[tenantId] ?? 'Unknown' }]);
  getServerEnv.mockReturnValue({ APP_BASE_URL: 'https://console.example.test' });
  listArmedTextBackTenantIds.mockResolvedValue([TENANT_A, TENANT_B]);
  disarmChannelBySystem.mockResolvedValue({ kind: 'disarmed', config: {}, auditId: 'x' });
  // A real latch: true once per (kind, day), false after.
  const latched = new Set<string>();
  claimOperatorAlert.mockImplementation(async (kind: string, day: string) => {
    const key = `${kind}/${day}`;
    if (latched.has(key)) return false;
    latched.add(key);
    return true;
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('runTextBackSweep (D-01, D-20)', () => {
  it('with no sender, scans nothing, marks nothing and reports unconfigured', async () => {
    const counts = await runTextBackSweep({ now: NOW, sender: undefined });

    expect(counts).toEqual({ swept: 0, sent: 0, skipped: 0, failed: 0, stale: 0, unconfigured: 1 });
    expect(listPendingTextBacks).not.toHaveBeenCalled();
    expect(markStaleTextBacks).not.toHaveBeenCalled();
    expect(sendTextBack).not.toHaveBeenCalled();
  });

  it('asks for the 45 s – 10 min window and marks strictly older calls stale at the tick clock', async () => {
    await runTextBackSweep({ now: NOW, sender: SENDER });

    expect(listPendingTextBacks).toHaveBeenCalledWith({
      olderThan: new Date(NOW.getTime() - 45_000),
      newerThan: new Date(NOW.getTime() - 600_000),
      limit: TEXT_BACK_SWEEP_LIMIT,
    });
    expect(markStaleTextBacks).toHaveBeenCalledWith(new Date(NOW.getTime() - 600_000), NOW);
  });

  it('hands every id to the one sendTextBack with the tick clock and the route sender', async () => {
    listPendingTextBacks.mockResolvedValue([{ id: 'a' }]);
    sendTextBack.mockResolvedValue({ kind: 'sent' });

    await runTextBackSweep({ now: NOW, sender: SENDER });

    expect(sendTextBack).toHaveBeenCalledTimes(1);
    const [id, deps] = sendTextBack.mock.calls[0] as [string, { now: Date; getSender: () => Promise<TouchSender> }];
    expect(id).toBe('a');
    expect(deps.now).toBe(NOW);
    expect(await deps.getSender()).toBe(SENDER);
  });

  it('tallies by result kind; a lost race is swept and nothing else', async () => {
    listPendingTextBacks.mockResolvedValue(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => ({ id })),
    );
    sendTextBack
      .mockResolvedValueOnce({ kind: 'sent' })
      .mockResolvedValueOnce({ kind: 'skipped' })
      .mockResolvedValueOnce({ kind: 'failed' })
      .mockResolvedValueOnce({ kind: 'outcome_unknown' })
      .mockResolvedValueOnce({ kind: 'pre_claim_failed' })
      .mockResolvedValueOnce({ kind: 'claim_lost' })
      .mockResolvedValueOnce({ kind: 'already_decided' });
    markStaleTextBacks.mockResolvedValue(2);

    const counts = await runTextBackSweep({ now: NOW, sender: SENDER });

    expect(counts).toEqual({ swept: 7, sent: 1, skipped: 1, failed: 3, stale: 2, unconfigured: 0 });
  });

  it('one sendTextBack throwing does not stop the next row', async () => {
    listPendingTextBacks.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    sendTextBack.mockRejectedValueOnce(new Error('+61491570156 boom')).mockResolvedValueOnce({ kind: 'sent' });

    const counts = await runTextBackSweep({ now: NOW, sender: SENDER });

    expect(sendTextBack).toHaveBeenCalledTimes(2);
    expect(counts).toMatchObject({ swept: 2, sent: 1, failed: 1 });
    // The caught value is never logged: it may carry a caller's number.
    for (const call of vi.mocked(console.error).mock.calls) {
      expect(JSON.stringify(call)).not.toContain('+61');
    }
  });

  it('a failed pending read still marks the stale; a failed stale mark still reports the sends', async () => {
    listPendingTextBacks.mockRejectedValue(new Error('read failed'));
    markStaleTextBacks.mockResolvedValue(3);
    expect(await runTextBackSweep({ now: NOW, sender: SENDER })).toMatchObject({ swept: 0, stale: 3 });

    listPendingTextBacks.mockResolvedValue([{ id: 'a' }]);
    sendTextBack.mockResolvedValue({ kind: 'sent' });
    markStaleTextBacks.mockRejectedValue(new Error('update failed'));
    expect(await runTextBackSweep({ now: NOW, sender: SENDER })).toMatchObject({
      swept: 1,
      sent: 1,
      stale: 0,
    });
  });
});

describe('runTextBackAlertPass (D-10, TXT-06)', () => {
  type Email = { subject: string; body: string };
  const okSender = () =>
    vi.fn<(email: Email) => Promise<{ ok: true; id: string }>>(async () => ({ ok: true, id: 'em_1' }));

  it('claims with the two-minute stuck bound at the tick clock, and the configuration arm (WR-02)', async () => {
    await runTextBackAlertPass({ now: NOW, sendEmail: okSender() });
    expect(claimTextBackAlerts).toHaveBeenCalledWith(NOW, new Date(NOW.getTime() - 120_000), {
      // A day of calls back from the tick clock…
      since: new Date(NOW.getTime() - 24 * 3_600_000),
      // …and "today" is the Perth day: 10:30 AWST on 6 Oct began at 16:00 UTC on 5 Oct.
      dayStart: new Date('2026-10-05T16:00:00.000Z'),
    });
  });

  describe('an ARMED client whose callers go untexted for a configuration reason (12-REVIEW WR-02)', () => {
    it('no_template and sms_not_armed reach the operator, each with its remedy, and are not failures', async () => {
      claimTextBackAlerts.mockResolvedValue([
        { tenantId: TENANT_A, status: 'skipped', detail: null, skipReason: 'no_template', repeatToday: false },
        { tenantId: TENANT_A, status: 'skipped', detail: null, skipReason: 'no_template', repeatToday: false },
        { tenantId: TENANT_B, status: 'skipped', detail: null, skipReason: 'sms_not_armed', repeatToday: false },
      ]);
      const send = okSender();

      expect(await runTextBackAlertPass({ now: NOW, sendEmail: send })).toEqual({
        alerted: 3,
        alertFailed: 0,
        insufficientCreditSeen: 0,
        pauseFailed: 0,
      });
      expect(send).toHaveBeenCalledTimes(1);
      const email = send.mock.calls[0][0];
      expect(email.subject).toBe('3 missed callers not texted: text-back cannot send for an armed client');
      expect(email.body).toContain(
        'Acme Plumbing: 2 not texted — the attested wording no longer validates against the business name; save and attest it again on the Text-back page',
      );
      expect(email.body).toContain(
        'Bright Sparks: 1 not texted — SMS is not armed for this client; re-arm SMS, or disarm text-back',
      );
      expect(email.body).toContain('reported at most once a day per client');
      // Not a failure: nothing was sent, so no "outcome unknown" sentence.
      expect(email.body).not.toContain('did not go through');
      expect(email.body).not.toContain('outcome unknown');
      expect(email.body).not.toContain(TENANT_A);
    });

    it('a client already told today is stamped but not re-emailed; all repeats means no email at all', async () => {
      claimTextBackAlerts.mockResolvedValue([
        { tenantId: TENANT_A, status: 'skipped', detail: null, skipReason: 'no_template', repeatToday: true },
      ]);
      const send = okSender();

      expect(await runTextBackAlertPass({ now: NOW, sendEmail: send })).toEqual({
        alerted: 0,
        alertFailed: 0,
        insufficientCreditSeen: 0,
        pauseFailed: 0,
      });
      expect(send).not.toHaveBeenCalled();
    });

    it('beside a failure, a repeat is dropped and a first-today client is named in its own section', async () => {
      claimTextBackAlerts.mockResolvedValue([
        { tenantId: TENANT_A, status: 'failed', detail: 'INVALID_RECIPIENT', skipReason: null, repeatToday: false },
        { tenantId: TENANT_A, status: 'skipped', detail: null, skipReason: 'no_template', repeatToday: true },
        { tenantId: TENANT_B, status: 'skipped', detail: null, skipReason: 'sms_not_armed', repeatToday: false },
      ]);
      const send = okSender();

      const counts = await runTextBackAlertPass({ now: NOW, sendEmail: send });
      expect(counts.alerted).toBe(2);
      const email = send.mock.calls[0][0];
      expect(email.subject).toBe(
        '1 missed-call text did not go through; 1 missed caller not texted: text-back cannot send for an armed client',
      );
      expect(email.body).toContain('Acme Plumbing: 1 failed, 0 outcome unknown');
      expect(email.body).not.toContain('Acme Plumbing: 1 not texted');
      expect(email.body).toContain('Bright Sparks: 1 not texted — SMS is not armed');
    });

    it('a configuration alert lost after its claim is a lost alert, not zero', async () => {
      claimTextBackAlerts.mockResolvedValue([
        { tenantId: TENANT_A, status: 'skipped', detail: null, skipReason: 'no_template', repeatToday: false },
      ]);
      const send = vi.fn(async () => ({ ok: false as const, kind: 'send_failed' as const, detail: 'x' }));
      expect(await runTextBackAlertPass({ now: NOW, sendEmail: send })).toMatchObject({
        alerted: 0,
        alertFailed: 1,
      });
    });
  });

  it('nothing claimed: no email, all zeros', async () => {
    const send = okSender();
    expect(await runTextBackAlertPass({ now: NOW, sendEmail: send })).toEqual({
      alerted: 0,
      alertFailed: 0,
      insufficientCreditSeen: 0,
      pauseFailed: 0,
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('one email naming each client with its counts, and no id in it', async () => {
    claimTextBackAlerts.mockResolvedValue([
      { tenantId: TENANT_A, status: 'failed', detail: 'INVALID_RECIPIENT' },
      { tenantId: TENANT_A, status: 'claimed', detail: null },
      { tenantId: TENANT_B, status: 'failed', detail: 'INSUFFICIENT_CREDIT' },
    ]);
    const send = okSender();

    const counts = await runTextBackAlertPass({ now: NOW, sendEmail: send });

    expect(counts).toEqual({ alerted: 3, alertFailed: 0, insufficientCreditSeen: 1, pauseFailed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    const email = send.mock.calls[0][0];
    expect(email.body).toContain('Acme Plumbing: 1 failed, 1 outcome unknown');
    expect(email.body).toContain('Bright Sparks: 1 failed, 0 outcome unknown');
    expect(email.body).toContain('https://console.example.test/clients');
    expect(email.body).not.toContain(TENANT_A);
    expect(email.body).not.toContain('INSUFFICIENT_CREDIT');
  });

  it('a SENT row with detail pause_failed is its own category: counted, named, never a failure (12-05)', async () => {
    claimTextBackAlerts.mockResolvedValue([
      { tenantId: TENANT_A, status: 'sent', detail: 'pause_failed' },
      { tenantId: TENANT_B, status: 'failed', detail: 'INVALID_RECIPIENT' },
    ]);
    const send = okSender();

    expect(await runTextBackAlertPass({ now: NOW, sendEmail: send })).toEqual({
      alerted: 2,
      alertFailed: 0,
      insufficientCreditSeen: 0,
      pauseFailed: 1,
    });
    const email = send.mock.calls[0][0];
    expect(email.body).toContain(
      'Acme Plumbing: 1 sent, but the quote cadence could not be paused — pause it on the quote page',
    );
    expect(email.body).toContain('Bright Sparks: 1 failed, 0 outcome unknown');
    expect(email.body).not.toContain('Acme Plumbing: 0 failed');
  });

  it('a pause_failed count survives a lost email: the claim happened', async () => {
    claimTextBackAlerts.mockResolvedValue([{ tenantId: TENANT_A, status: 'sent', detail: 'pause_failed' }]);
    const send = vi.fn(async () => ({ ok: false as const, kind: 'send_failed' as const, detail: 'x' }));
    expect(await runTextBackAlertPass({ now: NOW, sendEmail: send })).toEqual({
      alerted: 0,
      alertFailed: 1,
      insufficientCreditSeen: 0,
      pauseFailed: 1,
    });
  });

  it('a stuck claimed row carrying the credit code does not force the probe; only a refusal does', async () => {
    claimTextBackAlerts.mockResolvedValue([
      { tenantId: TENANT_A, status: 'claimed', detail: 'INSUFFICIENT_CREDIT' },
    ]);
    expect((await runTextBackAlertPass({ now: NOW, sendEmail: okSender() })).insufficientCreditSeen).toBe(0);
  });

  it('a send reporting failure is a LOST alert, not zero — and the claim is not undone', async () => {
    claimTextBackAlerts.mockResolvedValue([{ tenantId: TENANT_A, status: 'failed', detail: 'INSUFFICIENT_CREDIT' }]);
    const send = vi.fn(async () => ({ ok: false as const, kind: 'send_failed' as const, detail: 'x' }));

    expect(await runTextBackAlertPass({ now: NOW, sendEmail: send })).toEqual({
      alerted: 0,
      alertFailed: 1,
      insufficientCreditSeen: 1,
      pauseFailed: 0,
    });
    expect(claimTextBackAlerts).toHaveBeenCalledTimes(1);
  });

  it('a throw AFTER the claim (the console URL read) is reported as a lost alert', async () => {
    claimTextBackAlerts.mockResolvedValue([{ tenantId: TENANT_A, status: 'failed', detail: null }]);
    getServerEnv.mockImplementation(() => {
      throw new Error('env invalid');
    });

    expect(await runTextBackAlertPass({ now: NOW, sendEmail: okSender() })).toEqual({
      alerted: 0,
      alertFailed: 1,
      insufficientCreditSeen: 0,
      pauseFailed: 0,
    });
  });

  it('a claim that throws wrote nothing: zeros are the truth there', async () => {
    claimTextBackAlerts.mockRejectedValue(new Error('db down'));
    const send = okSender();
    expect(await runTextBackAlertPass({ now: NOW, sendEmail: send })).toEqual({
      alerted: 0,
      alertFailed: 0,
      insufficientCreditSeen: 0,
      pauseFailed: 0,
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('an unreadable client name is a placeholder, not a lost alert', async () => {
    claimTextBackAlerts.mockResolvedValue([{ tenantId: TENANT_A, status: 'failed', detail: null }]);
    tenantGet.mockRejectedValue(new Error('read failed'));
    const send = okSender();

    expect((await runTextBackAlertPass({ now: NOW, sendEmail: send })).alerted).toBe(1);
    expect(send.mock.calls[0][0].body).toContain('A client (name unavailable): 1 failed');
  });
});

describe('runBalanceProbe (D-07, D-10, D-21, TXT-06)', () => {
  type Email = { subject: string; body: string };
  const QUARTER = new Date('2026-10-06T02:30:00.000Z');
  const OFF_QUARTER = new Date('2026-10-06T02:31:00.000Z');
  const CREDS = { username: 'user@example.test', apiKey: 'key' };

  function balance(value: string, currency = 'AUD'): typeof fetch {
    return vi.fn(async () =>
      new Response(JSON.stringify({ data: { balance: value, _currency: { currency_name_short: currency } } }), {
        status: 200,
      }),
    ) as unknown as typeof fetch;
  }
  const emails = () =>
    vi.fn<(email: Email) => Promise<{ ok: true; id: string }>>(async () => ({ ok: true, id: 'em' }));

  it('does nothing off the quarter hour unless forced', async () => {
    const fetchImpl = balance('1.00');
    const send = emails();
    const counts = await runBalanceProbe({ now: OFF_QUARTER, force: false, clicksend: CREDS, fetchImpl, sendEmail: send });

    expect(counts).toEqual({ probed: 0, probeFailed: 0, lowAlerted: 0, autoDisarmed: 0, emailFailed: 0 });
    expect(listArmedTextBackTenantIds).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();

    const forced = await runBalanceProbe({ now: OFF_QUARTER, force: true, clicksend: CREDS, fetchImpl, sendEmail: send });
    expect(forced.probed).toBe(1);
  });

  it('does nothing — not even the ClickSend call — when nobody is armed', async () => {
    listArmedTextBackTenantIds.mockResolvedValue([]);
    const fetchImpl = balance('1.00');
    const counts = await runBalanceProbe({ now: QUARTER, force: true, clicksend: CREDS, fetchImpl, sendEmail: emails() });

    expect(counts.probed).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(disarmChannelBySystem).not.toHaveBeenCalled();
  });

  it('at 450 cents disarms every armed client with the named reason, and emails once per Perth day', async () => {
    const send = emails();
    const counts = await runBalanceProbe({ now: QUARTER, force: false, clicksend: CREDS, fetchImpl: balance('4.50'), sendEmail: send });

    expect(counts).toEqual({ probed: 1, probeFailed: 0, lowAlerted: 0, autoDisarmed: 2, emailFailed: 0 });
    expect(disarmChannelBySystem.mock.calls.map((c) => c[0])).toEqual([
      { channel: 'text_back', tenantId: TENANT_A, reason: AUTO_DISARM_REASON },
      { channel: 'text_back', tenantId: TENANT_B, reason: AUTO_DISARM_REASON },
    ]);
    expect(claimOperatorAlert).toHaveBeenCalledWith('text_back_auto_disarmed', '2026-10-06', {
      disarmed: 2,
      balance_cents: 450,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].subject).toContain('switched off for 2 clients');

    // Fifteen minutes later, someone re-armed: disarmed again, no second email today.
    listArmedTextBackTenantIds.mockResolvedValue([TENANT_A]);
    const again = await runBalanceProbe({
      now: new Date(QUARTER.getTime() + 15 * 60_000),
      force: false,
      clicksend: CREDS,
      fetchImpl: balance('4.50'),
      sendEmail: send,
    });
    expect(again.autoDisarmed).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('an overdrawn account (−A$20.87, production on 6 Oct) disarms every armed client and alerts — never "unreadable" (CR-01)', async () => {
    const send = emails();
    const counts = await runBalanceProbe({ now: QUARTER, force: false, clicksend: CREDS, fetchImpl: balance('-20.87'), sendEmail: send });

    expect(counts).toEqual({ probed: 1, probeFailed: 0, lowAlerted: 0, autoDisarmed: 2, emailFailed: 0 });
    expect(disarmChannelBySystem.mock.calls.map((c) => c[0])).toEqual([
      { channel: 'text_back', tenantId: TENANT_A, reason: AUTO_DISARM_REASON },
      { channel: 'text_back', tenantId: TENANT_B, reason: AUTO_DISARM_REASON },
    ]);
    expect(claimOperatorAlert).toHaveBeenCalledWith('text_back_auto_disarmed', '2026-10-06', {
      disarmed: 2,
      balance_cents: -2087,
    });
    expect(claimOperatorAlert).not.toHaveBeenCalledWith('clicksend_balance_unreadable', expect.anything(), expect.anything());
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].subject).toBe(
      'Missed-call texts switched off for 2 clients: ClickSend balance -A$20.87',
    );
  });

  it('one client failing to disarm does not leave the next one armed', async () => {
    disarmChannelBySystem.mockRejectedValueOnce(new Error('tx failed'));
    const counts = await runBalanceProbe({ now: QUARTER, force: false, clicksend: CREDS, fetchImpl: balance('0.02'), sendEmail: emails() });

    expect(disarmChannelBySystem).toHaveBeenCalledTimes(2);
    expect(counts.autoDisarmed).toBe(1);
  });

  it('at 1500 cents sends the low-balance email once per day and disarms nobody', async () => {
    const send = emails();
    const first = await runBalanceProbe({ now: QUARTER, force: false, clicksend: CREDS, fetchImpl: balance('15.00'), sendEmail: send });
    const second = await runBalanceProbe({
      now: new Date(QUARTER.getTime() + 15 * 60_000),
      force: false,
      clicksend: CREDS,
      fetchImpl: balance('15.00'),
      sendEmail: send,
    });

    expect(first).toEqual({ probed: 1, probeFailed: 0, lowAlerted: 1, autoDisarmed: 0, emailFailed: 0 });
    expect(second.lowAlerted).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].subject).toBe('ClickSend balance low: A$15.00');
    expect(disarmChannelBySystem).not.toHaveBeenCalled();
  });

  it('at exactly A$20.00 and A$5.00 the stricter action does not fire', async () => {
    const at20 = await runBalanceProbe({ now: QUARTER, force: false, clicksend: CREDS, fetchImpl: balance('20.00'), sendEmail: emails() });
    expect(at20).toMatchObject({ probed: 1, lowAlerted: 0, autoDisarmed: 0 });

    const at5 = await runBalanceProbe({ now: QUARTER, force: false, clicksend: CREDS, fetchImpl: balance('5.00'), sendEmail: emails() });
    expect(at5).toMatchObject({ probed: 1, lowAlerted: 1, autoDisarmed: 0 });
    expect(disarmChannelBySystem).not.toHaveBeenCalled();
  });

  it.each([
    ['credentials absent', { username: undefined, apiKey: 'key' }, balance('0.00'), 'no_credentials'],
    ['an HTTP failure', CREDS, (async () => new Response('', { status: 401 })) as unknown as typeof fetch, 'http_401'],
    ['a balance in another currency', CREDS, balance('0.00', 'USD'), 'not_aud'],
    ['an unparseable balance', CREDS, balance('n/a'), 'unparseable'],
  ])('%s: never disarms, never says low, one unreadable email per day', async (_label, clicksend, fetchImpl, reason) => {
    const send = emails();
    const first = await runBalanceProbe({ now: QUARTER, force: false, clicksend, fetchImpl, sendEmail: send });
    const second = await runBalanceProbe({ now: QUARTER, force: true, clicksend, fetchImpl, sendEmail: send });

    expect(first).toEqual({ probed: 1, probeFailed: 1, lowAlerted: 0, autoDisarmed: 0, emailFailed: 0 });
    expect(second.probeFailed).toBe(1);
    expect(disarmChannelBySystem).not.toHaveBeenCalled();
    expect(claimOperatorAlert).toHaveBeenCalledWith('clicksend_balance_unreadable', '2026-10-06', { reason });
    expect(claimOperatorAlert).not.toHaveBeenCalledWith('clicksend_balance_low', expect.anything(), expect.anything());
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].subject).toBe('ClickSend balance could not be read');
  });

  it('absent credentials make no ClickSend call at all', async () => {
    const fetchImpl = balance('1.00');
    await runBalanceProbe({ now: QUARTER, force: false, clicksend: { username: undefined, apiKey: undefined }, fetchImpl, sendEmail: emails() });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('an email lost after its claim is counted, and not re-sent that day', async () => {
    const send = vi.fn(async () => ({ ok: false as const, kind: 'send_failed' as const, detail: 'x' }));
    const first = await runBalanceProbe({ now: QUARTER, force: false, clicksend: CREDS, fetchImpl: balance('15.00'), sendEmail: send });
    const second = await runBalanceProbe({ now: QUARTER, force: true, clicksend: CREDS, fetchImpl: balance('15.00'), sendEmail: send });

    expect(first).toMatchObject({ lowAlerted: 0, emailFailed: 1 });
    expect(second).toMatchObject({ lowAlerted: 0, emailFailed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
