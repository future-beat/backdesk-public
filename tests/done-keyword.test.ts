/**
 * THE TRADIE'S DONE (Phase 14, plan 14-04; LEAD-04, D-08) — the matcher, the
 * branch's decisions over a mocked repository, the door's order pinned in
 * source, and the done_no_lead alert's words pinned verbatim.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A MEMBER OF THE PUBLIC'S WORDS REACH THIS RULE BEFORE ANY LOOKUP. So the │
 * │ rule is pinned three ways: what the matcher accepts, where the branch    │
 * │ sits in `handleInboundSms`, and what the branch may import (nothing that │
 * │ can put a text on anybody's phone).                                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * PURE. The repository barrel and the close wrapper are mocked by name; the
 * door's source is read, never run. The database proof is
 * `tests/lead-done-keyword.test.ts`, which runs in CI only.
 */
import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const tenantsOwningNumber = vi.fn();
const latestSentLeadEscalationTo = vi.fn();
const insertInboundMessage = vi.fn();
const tenantGet = vi.fn();
const forTenant = vi.fn((tenantId: string) => ({ tenantId, tenant: { get: tenantGet } }));
const closeLead = vi.fn();
const cadencesByContactMobile = vi.fn();
const pauseForReply = vi.fn();

vi.mock('@/db/repository', () => ({
  forAllTenants_cadencesByContactMobile: (e164: string) => cadencesByContactMobile(e164),
  forAllTenants_ids: async () => [],
  tenantsOwningNumber: (e164: string) => tenantsOwningNumber(e164),
  latestSentLeadEscalationTo: (ids: readonly string[], to: string, since: Date) =>
    latestSentLeadEscalationTo(ids, to, since),
  insertInboundMessage: (row: unknown) => insertInboundMessage(row),
  forTenant: (tenantId: string) => forTenant(tenantId),
}));
vi.mock('@/core/leads/close', () => ({
  closeLead: (tenantId: string, leadId: string, reason: string, now: Date) =>
    closeLead(tenantId, leadId, reason, now),
}));
// The door's own writes, for the WR-05 cases that run `handleInboundSms`.
vi.mock('@/core/cadence/controls', () => ({
  pauseForReply: (tenantId: string, cadenceId: string) => pauseForReply(tenantId, cadenceId),
  suppressBareContact: vi.fn(),
  suppressFromInbound: vi.fn(),
}));

const { isDoneKeyword, handleTradieDone } = await import('@/core/leads/done-keyword');
const { alertSubject, doneNoLeadAlertBody } = await import('@/core/alerts/operator-email');
const { DONE_LOOKBACK_HOURS } = await import('@/core/leads/constants');
const { handleInboundSms } = await import('@/core/messaging/inbound');

const ACME = '11111111-1111-4111-8111-111111111111';
const NORTH = '22222222-2222-4222-8222-222222222222';
const LEAD = '44444444-4444-4444-8444-444444444444';
const INBOUND = '55555555-5555-4555-8555-555555555555';

/** Wednesday 7 Oct 2026, 10:00 Perth. */
const NOW = new Date('2026-10-07T02:00:00.000Z');
const OWN = '+61491570641';

const BASE = {
  channel: 'sms' as const,
  fromAddress: '0491 570 641',
  normalizedFrom: OWN,
  toAddress: null,
  body: 'DONE',
  providerMessageId: null,
  isStop: false,
};

describe('isDoneKeyword — a whole word, anywhere, any case', () => {
  it.each([
    'DONE',
    'done',
    'Done thanks',
    'all done.',
    'done — booked them in',
    'DONE\n',
    // A hyphen is not a letter, so the word stands alone — the URGENT precedent.
    'well-done',
  ])('matches %j', (body) => {
    expect(isDoneKeyword(body)).toBe(true);
  });

  it.each(['undone', 'DONEish', 'd o n e', ''])('does not match %j', (body) => {
    expect(isDoneKeyword(body)).toBe(false);
  });

  it('answers false for a non-string rather than throwing', () => {
    expect(isDoneKeyword(undefined as unknown as string)).toBe(false);
    expect(isDoneKeyword(null as unknown as string)).toBe(false);
    expect(isDoneKeyword(42 as unknown as string)).toBe(false);
  });

  it('is not a global regex — identical calls answer identically', () => {
    expect(isDoneKeyword('DONE')).toBe(true);
    expect(isDoneKeyword('DONE')).toBe(true);
    expect(isDoneKeyword('DONE')).toBe(true);
  });
});

/* ------------------------------------------------------------------------- *
 * The door: after STOP and the normalisation, before the cadence lookup
 * ------------------------------------------------------------------------- */

describe('the branch sits where D-08 puts it', () => {
  const inbound = readFileSync('src/core/messaging/inbound.ts', 'utf8');

  it('is after the normalisation and the cadence lookup, and before any threading branch (WR-05)', () => {
    const normalise = inbound.indexOf('normalizeAuMobile(input.from)');
    const lookup = inbound.indexOf('forAllTenants_cadencesByContactMobile(');
    const done = inbound.indexOf('isDoneKeyword(');
    const threading = inbound.indexOf('handleSingleMatch(base');

    expect(normalise).toBeGreaterThan(-1);
    expect(lookup).toBeGreaterThan(normalise);
    expect(done).toBeGreaterThan(lookup);
    expect(threading).toBeGreaterThan(done);
    // The STOP decision comes before all of it.
    expect(inbound.indexOf('isStopMessage(input.body)')).toBeLessThan(normalise);
  });

  it('is guarded by !isStop and by NO candidate cadence — a STOP is still a STOP, a reply still threads', () => {
    const condition = inbound.slice(inbound.indexOf('if (!isStop && candidates.length === 0'));
    expect(
      condition.startsWith('if (!isStop && candidates.length === 0 && isDoneKeyword(input.body))'),
    ).toBe(true);
    expect(inbound.match(/isDoneKeyword\(/g)).toHaveLength(1);
    expect(inbound.match(/handleTradieDone\(/g)).toHaveLength(1);
  });
});

describe('done-keyword.ts can never text anybody back', () => {
  const source = readFileSync('src/core/leads/done-keyword.ts', 'utf8');
  const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]!);

  it('imports no module that sends', () => {
    expect(imports.length).toBeGreaterThan(0);
    for (const path of imports) {
      expect(path).not.toMatch(/send/i);
      expect(path).not.toBe('@/core/cadence/sender');
      expect(path).not.toBe('@/core/messaging/dispatch');
      expect(path.startsWith('@/core/sms')).toBe(false);
      expect(path).not.toMatch(/clicksend/i);
    }
  });

  it('interpolates ids and kinds only into its log lines', () => {
    const calls = [...source.matchAll(/console\.\w+\(([\s\S]*?)\);/g)];
    expect(calls.length).toBeGreaterThan(0);
    const interpolations = calls.flatMap((call) =>
      [...call[1]!.matchAll(/\$\{([^}]*)\}/g)].map((match) => match[1]!.trim()),
    );
    expect(interpolations.length).toBeGreaterThan(0);
    for (const interpolation of interpolations) {
      expect(interpolation).toMatch(/^[A-Za-z_.]*(Id|kind)$/);
    }
  });
});

/* ------------------------------------------------------------------------- *
 * The branch's decisions, over a mocked repository
 * ------------------------------------------------------------------------- */

/* ------------------------------------------------------------------------- *
 * 14-REVIEW WR-05: a tradie who is ANOTHER client's customer
 * ------------------------------------------------------------------------- */

describe('the door: DONE from one client’s own number that is another client’s customer (WR-05)', () => {
  const CADENCE = '66666666-6666-4666-8666-666666666666';
  const OTHER_LEAD = '77777777-7777-4777-8777-777777777777';
  const alert = vi.fn();
  const input = { from: '0491 570 641', to: null, body: 'all done, thanks', providerMessageId: null };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    insertInboundMessage.mockResolvedValue({ id: INBOUND });
    tenantGet.mockResolvedValue([{ id: ACME, name: 'Acme Plumbing' }]);
    alert.mockResolvedValue({ ok: true, id: null });
    pauseForReply.mockResolvedValue({ kind: 'paused' });
    // The number is ACME's own (its escalation phone), and ACME escalated a lead to it.
    tenantsOwningNumber.mockResolvedValue([ACME]);
    latestSentLeadEscalationTo.mockResolvedValue({ tenantId: ACME, leadId: LEAD });
  });

  it('threads to NORTH’s live cadence and pauses it; ACME’s lead is not closed, no alert', async () => {
    cadencesByContactMobile.mockResolvedValue([
      { tenantId: NORTH, cadenceId: CADENCE, quoteId: null, leadId: OTHER_LEAD },
    ]);

    const result = await handleInboundSms(input, { now: NOW, alert });

    expect(result).toMatchObject({ kind: 'reply_threaded', tenantId: NORTH, cadenceId: CADENCE });
    expect(pauseForReply).toHaveBeenCalledWith(NORTH, CADENCE);
    expect(tenantsOwningNumber).not.toHaveBeenCalled();
    expect(latestSentLeadEscalationTo).not.toHaveBeenCalled();
    expect(closeLead).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
    expect(insertInboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: NORTH, cadenceId: CADENCE, attribution: 'threaded' }),
    );
  });

  it('with no live cadence for the number, the DONE branch runs and closes ACME’s lead', async () => {
    cadencesByContactMobile.mockResolvedValue([]);
    closeLead.mockResolvedValue({ kind: 'closed' });

    const result = await handleInboundSms(input, { now: NOW, alert });

    expect(result).toMatchObject({ kind: 'done_closed', tenantId: ACME, leadId: LEAD });
    expect(closeLead).toHaveBeenCalledWith(ACME, LEAD, 'closed_by_tradie', NOW);
    expect(pauseForReply).not.toHaveBeenCalled();
  });
});

describe('handleTradieDone', () => {
  const alert = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    insertInboundMessage.mockResolvedValue({ id: INBOUND });
    tenantGet.mockResolvedValue([{ id: ACME, name: 'Acme Plumbing' }]);
    alert.mockResolvedValue({ ok: true, id: null });
  });

  it('falls through (null) for a number that is no client’s own — and writes nothing', async () => {
    tenantsOwningNumber.mockResolvedValue([]);

    const result = await handleTradieDone(BASE, OWN, NOW, { alert });

    expect(result).toBeNull();
    expect(tenantsOwningNumber).toHaveBeenCalledWith(OWN);
    expect(latestSentLeadEscalationTo).not.toHaveBeenCalled();
    expect(insertInboundMessage).not.toHaveBeenCalled();
    expect(closeLead).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });

  it('closes the escalated lead closed_by_tradie FIRST, then records the row pre-triaged', async () => {
    tenantsOwningNumber.mockResolvedValue([ACME]);
    latestSentLeadEscalationTo.mockResolvedValue({ tenantId: ACME, leadId: LEAD });
    const order: string[] = [];
    closeLead.mockImplementation(async () => {
      order.push('close');
      return { kind: 'closed' };
    });
    insertInboundMessage.mockImplementation(async () => {
      order.push('row');
      return { id: INBOUND };
    });

    const result = await handleTradieDone(BASE, OWN, NOW, { alert });

    expect(result).toEqual({
      kind: 'done_closed',
      inboundId: INBOUND,
      tenantId: ACME,
      leadId: LEAD,
      close: 'closed',
    });
    expect(order).toEqual(['close', 'row']);
    expect(latestSentLeadEscalationTo).toHaveBeenCalledWith(
      [ACME],
      OWN,
      new Date(NOW.getTime() - DONE_LOOKBACK_HOURS * 3_600_000),
    );
    expect(closeLead).toHaveBeenCalledWith(ACME, LEAD, 'closed_by_tradie', NOW);
    expect(insertInboundMessage).toHaveBeenCalledWith({
      ...BASE,
      tenantId: ACME,
      attribution: 'unmatched',
      matchedCadenceCount: 0,
      triagedAt: NOW,
    });
    expect(alert).not.toHaveBeenCalled();
  });

  it('honours an already-closed lead silently — the word was already acted on', async () => {
    tenantsOwningNumber.mockResolvedValue([ACME]);
    latestSentLeadEscalationTo.mockResolvedValue({ tenantId: ACME, leadId: LEAD });
    closeLead.mockResolvedValue({ kind: 'already_closed' });

    const result = await handleTradieDone(BASE, OWN, NOW, { alert });

    expect(result).toMatchObject({ kind: 'done_closed', close: 'already_closed' });
    expect(alert).not.toHaveBeenCalled();
  });

  it('with no lead to close: records the row UNTRIAGED and alerts the operator exactly once', async () => {
    tenantsOwningNumber.mockResolvedValue([ACME]);
    latestSentLeadEscalationTo.mockResolvedValue(null);

    const result = await handleTradieDone(BASE, OWN, NOW, { alert });

    expect(result).toEqual({ kind: 'done_no_lead', inboundId: INBOUND, tenantId: ACME });
    expect(closeLead).not.toHaveBeenCalled();
    expect(insertInboundMessage).toHaveBeenCalledWith({
      ...BASE,
      tenantId: ACME,
      attribution: 'unmatched',
      matchedCadenceCount: 0,
    });
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith({
      kind: 'done_no_lead',
      tenantId: ACME,
      tenantName: 'Acme Plumbing',
      at: NOW,
    });
  });

  it('a failed alert is logged by kind and the reply is still recorded', async () => {
    tenantsOwningNumber.mockResolvedValue([ACME]);
    latestSentLeadEscalationTo.mockResolvedValue(null);
    alert.mockResolvedValue({ ok: false, kind: 'send_failed', detail: 'x' });

    const result = await handleTradieDone(BASE, OWN, NOW, { alert });

    expect(result).toEqual({ kind: 'done_no_lead', inboundId: INBOUND, tenantId: ACME });
  });

  it('a number owned by two clients: the escalation read takes both, the row and the alert the lowest id', async () => {
    tenantsOwningNumber.mockResolvedValue([ACME, NORTH]);
    latestSentLeadEscalationTo.mockResolvedValue(null);

    const result = await handleTradieDone(BASE, OWN, NOW, { alert });

    expect(latestSentLeadEscalationTo.mock.calls[0]![0]).toEqual([ACME, NORTH]);
    expect(result).toEqual({ kind: 'done_no_lead', inboundId: INBOUND, tenantId: ACME });
    expect(forTenant).toHaveBeenCalledWith(ACME);
    expect(alert.mock.calls[0]![0]).toMatchObject({ tenantId: ACME });
  });

  it('a number owned by two clients closes the lead at whichever client escalated it', async () => {
    tenantsOwningNumber.mockResolvedValue([ACME, NORTH]);
    latestSentLeadEscalationTo.mockResolvedValue({ tenantId: NORTH, leadId: LEAD });
    closeLead.mockResolvedValue({ kind: 'closed' });

    const result = await handleTradieDone(BASE, OWN, NOW, { alert });

    expect(closeLead).toHaveBeenCalledWith(NORTH, LEAD, 'closed_by_tradie', NOW);
    expect(result).toMatchObject({ kind: 'done_closed', tenantId: NORTH });
  });
});

/* ------------------------------------------------------------------------- *
 * The done_no_lead alert — the client's name, fixed sentences, no number
 * ------------------------------------------------------------------------- */

describe('the done_no_lead alert', () => {
  it('has a subject naming the client, control characters stripped', () => {
    expect(alertSubject('done_no_lead', 'Acme Plumbing')).toBe(
      'DONE received for Acme Plumbing — no lead to close',
    );
    expect(alertSubject('done_no_lead', 'Acme \r\nBcc: x')).toBe(
      'DONE received for Acme Bcc: x — no lead to close',
    );
  });

  it('has a body pinned verbatim, with no number in it', () => {
    const body = doneNoLeadAlertBody({
      tenantName: 'Acme Plumbing',
      url: 'https://console.example.test/clients/abc',
      at: NOW,
    });

    expect(body).toBe(
      [
        'A DONE reply arrived from one of this client’s own numbers, but no lead',
        `was escalated to that number in the last ${DONE_LOOKBACK_HOURS} hours, so nothing was closed.`,
        '',
        'Client: Acme Plumbing',
        'Received: 2026-10-07 02:00:00 UTC',
        '',
        'The reply is waiting in the inbox. Find the lead the tradie meant and',
        'close it there, or mark the reply handled.',
        '',
        'https://console.example.test/clients/abc',
        '',
      ].join('\n'),
    );
    expect(body).not.toContain('+61');
    expect(body).not.toMatch(/\d{9}/);
  });

  it('strips control characters from the client name in the body too', () => {
    const body = doneNoLeadAlertBody({ tenantName: 'Acme\r\nBcc: x', url: 'u', at: NOW });
    expect(body).toContain('Client: AcmeBcc: x\n');
  });
});
