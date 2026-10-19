/**
 * Phase 13 (plan 13-06): the three escalation passes that can now hold, ring
 * twice, or release — asserted per row with the repository mocked.
 *
 * ── WHY MOCKED ─────────────────────────────────────────────────────────────
 *
 * The properties here are about ORDER and ARGUMENTS: the hold is decided
 * before the claim and rides on it; the caller's number is read only after
 * the claim; the release asks no cooldown and never releases a row twice; one
 * throwing row does not strand the next. The DB-backed suites
 * (`tests/escalation-lead.test.ts`, `tests/ring-twice.test.ts`) prove the same
 * passes against real rows in CI; this one runs locally and pins the seams.
 * The `cadence-tick-isolation` mould: recorders that THROW unless a case
 * gives them an answer, so a pass reaching a read nobody planned fails loudly.
 *
 * Fixed clocks, Perth (UTC+8, no DST), 08:00–17:00 Monday to Friday:
 *   NIGHT  Tue 6 Oct 2026 23:00  — outside the window
 *   OPEN   Wed 7 Oct 2026 08:00  — the window's next opening from NIGHT
 *   DAY    Wed 7 Oct 2026 10:00  — inside the window
 * Numbers are ACMA fiction-range mobiles; nothing here is a real person.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { escalateHotLeads, LEAD_REPLY_SNIPPET } from '@/core/escalation/escalate-hot-leads';
import {
  buildEscalationSms,
  buildRingTwiceEscalationSms,
  ESCALATION_COOLDOWN_MINUTES,
} from '@/core/escalation/message';
import { releaseHeldEscalations } from '@/core/escalation/release-held';
import { escalateRingTwiceCalls, RING_TWICE_ESCALATION_CAP } from '@/core/escalation/ring-twice';
import {
  QUOTE_CALL_ESCALATION_MAX_AGE_HOURS,
  RING_TWICE_WINDOW_MINUTES,
} from '@/core/leads/constants';
import type { SendSmsInput, SendSmsResult } from '@/core/messaging/clicksend-client';

const unplanned = (name: string) => () => {
  throw new Error(`${name} was not planned by this case`);
};

const repo = vi.hoisted(() => ({
  forAllTenants_hotUnescalated: vi.fn(),
  claimEscalation: vi.fn(),
  claimEscalationForMissedCall: vi.fn(),
  recentEscalationForCadence: vi.fn(),
  recordEscalationOutcome: vi.fn(),
  listUnescalatedRingTwiceCalls: vi.fn(),
  claimHeldEscalationRelease: vi.fn(),
  getMissedCallForTextBack: vi.fn(),
  tenantGet: vi.fn(),
  leadsById: vi.fn(),
  byIdForEscalation: vi.fn(),
  cadencesGetById: vi.fn(),
  quotesById: vi.fn(),
}));

const resolveSmsFrom = vi.hoisted(() => vi.fn());

vi.mock('@/db/repository', () => ({
  HOT_ESCALATION_CAP: 25,
  forAllTenants_hotUnescalated: (...args: unknown[]) => repo.forAllTenants_hotUnescalated(...args),
  claimEscalation: (...args: unknown[]) => repo.claimEscalation(...args),
  claimEscalationForMissedCall: (...args: unknown[]) => repo.claimEscalationForMissedCall(...args),
  recentEscalationForCadence: (...args: unknown[]) => repo.recentEscalationForCadence(...args),
  recordEscalationOutcome: (...args: unknown[]) => repo.recordEscalationOutcome(...args),
  listUnescalatedRingTwiceCalls: (...args: unknown[]) =>
    repo.listUnescalatedRingTwiceCalls(...args),
  claimHeldEscalationRelease: (...args: unknown[]) => repo.claimHeldEscalationRelease(...args),
  getMissedCallForTextBack: (...args: unknown[]) => repo.getMissedCallForTextBack(...args),
  forTenant: (tenantId: string) => ({
    tenant: { get: () => repo.tenantGet(tenantId) },
    leads: { byId: (id: string) => repo.leadsById(tenantId, id) },
    inbound: { byIdForEscalation: (id: string) => repo.byIdForEscalation(tenantId, id) },
    cadences: { getById: (id: string) => repo.cadencesGetById(tenantId, id) },
    quotes: { byId: (id: string) => repo.quotesById(tenantId, id) },
  }),
}));

vi.mock('@/core/messaging/routing-sender', () => ({
  resolveSmsFrom: (...args: unknown[]) => resolveSmsFrom(...args),
}));

/** A Perth wall clock as a UTC instant (Perth = UTC+8, no DST). */
function perth(day: number, hh: number, mm: number): Date {
  return new Date(Date.UTC(2026, 9, day, hh - 8, mm));
}

const NIGHT = perth(6, 23, 0);
const OPEN = perth(7, 8, 0);
const DAY = perth(7, 10, 0);

const TENANT_ID = 'tenant-a';
const TRADIE_LOCAL = '0491570156';
const TRADIE = '+61491570156';
const CALLER = '+61491570110';
const SMS_FROM = '+61491570999';

function tenantRow(afterHoursEscalation = false, escalationPhone: string | null = TRADIE_LOCAL) {
  return {
    id: TENANT_ID,
    name: 'Fiction Plumbing',
    timezone: 'Australia/Perth',
    contactHoursStart: '08:00:00',
    contactHoursEnd: '17:00:00',
    contactDays: [1, 2, 3, 4, 5],
    escalationPhone,
    afterHoursEscalation,
  };
}

/** A recording sender: every input kept, every send accepted. */
function recordingSender() {
  const sent: SendSmsInput[] = [];
  const fn = vi.fn(async (input: SendSmsInput): Promise<SendSmsResult> => {
    sent.push(input);
    return { ok: true, messageId: `msg-${sent.length}`, status: 'SUCCESS' };
  });
  return { fn, sent };
}

beforeEach(() => {
  for (const mock of Object.values(repo)) {
    mock.mockReset();
  }
  resolveSmsFrom.mockReset();
  repo.forAllTenants_hotUnescalated.mockImplementation(unplanned('forAllTenants_hotUnescalated'));
  repo.claimEscalation.mockImplementation(unplanned('claimEscalation'));
  repo.claimEscalationForMissedCall.mockImplementation(unplanned('claimEscalationForMissedCall'));
  repo.recentEscalationForCadence.mockResolvedValue(null);
  repo.recordEscalationOutcome.mockResolvedValue({ recorded: true });
  repo.listUnescalatedRingTwiceCalls.mockImplementation(unplanned('listUnescalatedRingTwiceCalls'));
  repo.claimHeldEscalationRelease.mockImplementation(unplanned('claimHeldEscalationRelease'));
  repo.getMissedCallForTextBack.mockImplementation(unplanned('getMissedCallForTextBack'));
  repo.tenantGet.mockResolvedValue([tenantRow()]);
  repo.leadsById.mockResolvedValue([{ id: 'lead-1', status: 'open', closedAt: null }]);
  repo.byIdForEscalation.mockImplementation(unplanned('byIdForEscalation'));
  repo.cadencesGetById.mockImplementation(unplanned('cadences.getById'));
  repo.quotesById.mockImplementation(unplanned('quotes.byId'));
  resolveSmsFrom.mockResolvedValue(SMS_FROM);
});

/* ------------------------------------------------------------------------- *
 * The hot-lead pass: the D-09 hold on a LEAD reply, never on a quote reply
 * ------------------------------------------------------------------------- */

function hotRow(overrides: Record<string, unknown> = {}) {
  return {
    inboundMessageId: 'inbound-1',
    tenantId: TENANT_ID,
    cadenceId: 'cadence-lead-1',
    quoteId: null,
    body: 'Can you come and look at the fence this week?',
    receivedAt: NIGHT,
    contactName: null,
    contactMobile: CALLER,
    quoteDescription: null,
    urgency: 'this_week',
    keywordHot: false,
    leadId: 'lead-1',
    ...overrides,
  };
}

describe('escalateHotLeads — the D-09 hold on a lead reply', () => {
  it('outside hours, switch off, not immediate: claimed with hold_until = the window opening, nothing sent', async () => {
    repo.forAllTenants_hotUnescalated.mockResolvedValue([hotRow()]);
    repo.claimEscalation.mockResolvedValue({ id: 'esc-1' });
    const sender = recordingSender();

    const counts = await escalateHotLeads({ sender: sender.fn, now: NIGHT });

    expect(repo.claimEscalation).toHaveBeenCalledTimes(1);
    expect(repo.claimEscalation).toHaveBeenCalledWith({
      inboundMessageId: 'inbound-1',
      tenantId: TENANT_ID,
      cadenceId: 'cadence-lead-1',
      quoteId: null,
      leadId: 'lead-1',
      toAddress: TRADIE,
      holdUntil: OPEN,
      at: NIGHT,
    });
    expect(counts.held).toBe(1);
    expect(counts.hotEscalated).toBe(0);
    expect(sender.sent).toHaveLength(0);
    // Outcome stays NULL until the release pass.
    expect(repo.recordEscalationOutcome).not.toHaveBeenCalled();
  });

  it('the same reply with the switch ON is sent at once, hold_until NULL', async () => {
    repo.tenantGet.mockResolvedValue([tenantRow(true)]);
    repo.forAllTenants_hotUnescalated.mockResolvedValue([hotRow()]);
    repo.claimEscalation.mockResolvedValue({ id: 'esc-1' });
    const sender = recordingSender();

    const counts = await escalateHotLeads({ sender: sender.fn, now: NIGHT });

    expect(repo.claimEscalation.mock.calls[0]![0]).toMatchObject({ holdUntil: null });
    expect(counts).toMatchObject({ held: 0, hotEscalated: 1 });
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]!.to).toBe(TRADIE);
  });

  it.each([
    ['emergency urgency', { urgency: 'emergency' }],
    ['a keyword hit with no label yet', { urgency: null, keywordHot: true }],
  ])('%s at 23:00 with the switch off is sent at once (D-09 regardless)', async (_name, overrides) => {
    repo.forAllTenants_hotUnescalated.mockResolvedValue([hotRow(overrides)]);
    repo.claimEscalation.mockResolvedValue({ id: 'esc-1' });
    const sender = recordingSender();

    const counts = await escalateHotLeads({ sender: sender.fn, now: NIGHT });

    expect(repo.claimEscalation.mock.calls[0]![0]).toMatchObject({ holdUntil: null });
    expect(counts).toMatchObject({ held: 0, hotEscalated: 1 });
    // An immediate reply's cooldown does not count a still-held row.
    expect(repo.recentEscalationForCadence).toHaveBeenCalledWith(
      'cadence-lead-1',
      new Date(NIGHT.getTime() - ESCALATION_COOLDOWN_MINUTES * 60_000),
      { ignoreUnreleasedHolds: true },
    );
  });

  it('inside the window a non-emergency lead reply is sent at once', async () => {
    repo.forAllTenants_hotUnescalated.mockResolvedValue([hotRow()]);
    repo.claimEscalation.mockResolvedValue({ id: 'esc-1' });
    const sender = recordingSender();

    const counts = await escalateHotLeads({ sender: sender.fn, now: DAY });

    expect(repo.claimEscalation.mock.calls[0]![0]).toMatchObject({ holdUntil: null });
    expect(counts).toMatchObject({ held: 0, hotEscalated: 1 });
    expect(sender.sent[0]!.body).toBe(
      buildEscalationSms({
        customerName: null,
        quoteSnippet: LEAD_REPLY_SNIPPET,
        replyText: hotRow().body,
        customerMobile: CALLER,
      }).body,
    );
  });

  it('a QUOTE reply at 23:00 with the switch off is never held, and its cooldown read is unchanged', async () => {
    repo.forAllTenants_hotUnescalated.mockResolvedValue([
      hotRow({
        cadenceId: 'cadence-quote-1',
        quoteId: 'quote-1',
        quoteDescription: 'Replace hot water system',
        urgency: null,
        leadId: null,
      }),
    ]);
    repo.claimEscalation.mockResolvedValue({ id: 'esc-1' });
    const sender = recordingSender();

    const counts = await escalateHotLeads({ sender: sender.fn, now: NIGHT });

    expect(repo.claimEscalation.mock.calls[0]![0]).toMatchObject({
      quoteId: 'quote-1',
      leadId: null,
      holdUntil: null,
    });
    expect(repo.recentEscalationForCadence).toHaveBeenCalledWith(
      'cadence-quote-1',
      expect.any(Date),
      undefined,
    );
    expect(counts).toMatchObject({ held: 0, hotEscalated: 1 });
  });

  it('a cooling lead reply at 23:00 is recorded cooldown_suppressed at once, not held', async () => {
    repo.forAllTenants_hotUnescalated.mockResolvedValue([hotRow()]);
    repo.recentEscalationForCadence.mockResolvedValue({ id: 'esc-earlier' });
    repo.claimEscalation.mockResolvedValue({ id: 'esc-1' });
    const sender = recordingSender();

    const counts = await escalateHotLeads({ sender: sender.fn, now: NIGHT });

    expect(repo.claimEscalation.mock.calls[0]![0]).toMatchObject({ holdUntil: null });
    expect(repo.recordEscalationOutcome).toHaveBeenCalledWith('esc-1', {
      outcome: 'cooldown_suppressed',
      at: NIGHT,
    });
    expect(counts).toMatchObject({ held: 0, cooldownSuppressed: 1, hotEscalated: 0 });
    expect(sender.sent).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------------- *
 * Ring-twice (D-07)
 * ------------------------------------------------------------------------- */

function ringRow(n = 2) {
  return {
    missedCallId: `call-${n}`,
    tenantId: TENANT_ID,
    leadId: 'lead-1',
    cadenceId: 'cadence-lead-1',
  };
}

describe('escalateRingTwiceCalls', () => {
  it('pins the ring-twice window at thirty minutes', () => {
    expect(RING_TWICE_WINDOW_MINUTES).toBe(30);
  });

  it('no escalation sender means no scan and no claim', async () => {
    const counts = await escalateRingTwiceCalls({ sender: undefined, now: DAY });
    expect(counts.unconfigured).toBe(1);
    expect(repo.listUnescalatedRingTwiceCalls).not.toHaveBeenCalled();
    expect(repo.claimEscalationForMissedCall).not.toHaveBeenCalled();
  });

  it('asks the list for the age bound and the ring-twice window', async () => {
    repo.listUnescalatedRingTwiceCalls.mockResolvedValue([]);
    await escalateRingTwiceCalls({ sender: recordingSender().fn, now: DAY });
    expect(repo.listUnescalatedRingTwiceCalls).toHaveBeenCalledWith(RING_TWICE_ESCALATION_CAP, {
      notBefore: new Date(DAY.getTime() - QUOTE_CALL_ESCALATION_MAX_AGE_HOURS * 3_600_000),
      windowMs: RING_TWICE_WINDOW_MINUTES * 60_000,
    });
  });

  it('inside hours: claims on the SECOND call’s id, reads the number after the claim, sends once', async () => {
    repo.listUnescalatedRingTwiceCalls.mockResolvedValue([ringRow(2)]);
    repo.claimEscalationForMissedCall.mockResolvedValue({ id: 'esc-ring' });
    repo.getMissedCallForTextBack.mockImplementation(async () => {
      // The number is read only once the claim is ours.
      expect(repo.claimEscalationForMissedCall).toHaveBeenCalledTimes(1);
      return { id: 'call-2', tenantId: TENANT_ID, callerE164: CALLER };
    });
    const sender = recordingSender();

    const counts = await escalateRingTwiceCalls({ sender: sender.fn, now: DAY });

    expect(repo.claimEscalationForMissedCall).toHaveBeenCalledWith({
      missedCallId: 'call-2',
      tenantId: TENANT_ID,
      cadenceId: 'cadence-lead-1',
      quoteId: null,
      leadId: 'lead-1',
      toAddress: TRADIE,
      holdUntil: null,
      at: DAY,
    });
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]).toMatchObject({
      to: TRADIE,
      from: SMS_FROM,
      customString: 'esc-ring',
      body: buildRingTwiceEscalationSms({ customerMobile: CALLER, minutes: 30 }).body,
    });
    expect(repo.recordEscalationOutcome).toHaveBeenCalledWith(
      'esc-ring',
      expect.objectContaining({ outcome: 'sent', sentAt: DAY }),
    );
    expect(counts).toMatchObject({ escalated: 1, held: 0, refused: 0, sendFailed: 0 });
  });

  it('outside hours with the switch off: held with hold_until, nothing sent, no number read', async () => {
    repo.listUnescalatedRingTwiceCalls.mockResolvedValue([ringRow(2)]);
    repo.claimEscalationForMissedCall.mockResolvedValue({ id: 'esc-ring' });
    const sender = recordingSender();

    const counts = await escalateRingTwiceCalls({ sender: sender.fn, now: NIGHT });

    expect(repo.claimEscalationForMissedCall.mock.calls[0]![0]).toMatchObject({
      missedCallId: 'call-2',
      holdUntil: OPEN,
    });
    expect(counts).toMatchObject({ held: 1, escalated: 0 });
    expect(sender.sent).toHaveLength(0);
    expect(repo.getMissedCallForTextBack).not.toHaveBeenCalled();
    expect(repo.recordEscalationOutcome).not.toHaveBeenCalled();
  });

  it('outside hours with the switch ON: sent at once', async () => {
    repo.tenantGet.mockResolvedValue([tenantRow(true)]);
    repo.listUnescalatedRingTwiceCalls.mockResolvedValue([ringRow(2)]);
    repo.claimEscalationForMissedCall.mockResolvedValue({ id: 'esc-ring' });
    repo.getMissedCallForTextBack.mockResolvedValue({ id: 'call-2', tenantId: TENANT_ID, callerE164: CALLER });
    const sender = recordingSender();

    const counts = await escalateRingTwiceCalls({ sender: sender.fn, now: NIGHT });

    expect(repo.claimEscalationForMissedCall.mock.calls[0]![0]).toMatchObject({ holdUntil: null });
    expect(counts).toMatchObject({ escalated: 1, held: 0 });
  });

  it('a missing escalation phone records no_escalation_number with zero provider calls', async () => {
    repo.tenantGet.mockResolvedValue([tenantRow(false, null)]);
    repo.listUnescalatedRingTwiceCalls.mockResolvedValue([ringRow(2)]);
    repo.claimEscalationForMissedCall.mockResolvedValue({ id: 'esc-ring' });
    const sender = recordingSender();

    const counts = await escalateRingTwiceCalls({ sender: sender.fn, now: DAY });

    expect(repo.claimEscalationForMissedCall.mock.calls[0]![0]).toMatchObject({
      toAddress: '',
      holdUntil: null,
    });
    expect(repo.recordEscalationOutcome).toHaveBeenCalledWith('esc-ring', {
      outcome: 'no_escalation_number',
      at: DAY,
    });
    expect(resolveSmsFrom).not.toHaveBeenCalled();
    expect(counts).toMatchObject({ refused: 1, escalated: 0 });
    expect(sender.sent).toHaveLength(0);
  });

  it('a disarmed client records sms_not_configured with zero provider calls', async () => {
    resolveSmsFrom.mockResolvedValue(null);
    repo.listUnescalatedRingTwiceCalls.mockResolvedValue([ringRow(2)]);
    repo.claimEscalationForMissedCall.mockResolvedValue({ id: 'esc-ring' });
    const sender = recordingSender();

    const counts = await escalateRingTwiceCalls({ sender: sender.fn, now: NIGHT });

    expect(repo.recordEscalationOutcome).toHaveBeenCalledWith('esc-ring', {
      outcome: 'sms_not_configured',
      at: NIGHT,
    });
    expect(counts).toMatchObject({ refused: 1, held: 0 });
    expect(sender.sent).toHaveLength(0);
  });

  it('a recent escalation on the lead cadence: claimed and recorded cooldown_suppressed (call 3)', async () => {
    repo.listUnescalatedRingTwiceCalls.mockResolvedValue([ringRow(3)]);
    repo.recentEscalationForCadence.mockResolvedValue({ id: 'esc-call-2' });
    repo.claimEscalationForMissedCall.mockResolvedValue({ id: 'esc-call-3' });
    const sender = recordingSender();

    const counts = await escalateRingTwiceCalls({ sender: sender.fn, now: DAY });

    // Asked BEFORE the claim, on the lead's cadence, with no hold exemption.
    expect(repo.recentEscalationForCadence).toHaveBeenCalledWith(
      'cadence-lead-1',
      new Date(DAY.getTime() - ESCALATION_COOLDOWN_MINUTES * 60_000),
    );
    expect(repo.claimEscalationForMissedCall.mock.calls[0]![0]).toMatchObject({
      missedCallId: 'call-3',
      holdUntil: null,
    });
    expect(repo.recordEscalationOutcome).toHaveBeenCalledWith('esc-call-3', {
      outcome: 'cooldown_suppressed',
      at: DAY,
    });
    expect(counts).toMatchObject({ cooldownSuppressed: 1, escalated: 0 });
    expect(sender.sent).toHaveLength(0);
  });

  it('a null claim (another tick owns it) is skipped silently', async () => {
    repo.listUnescalatedRingTwiceCalls.mockResolvedValue([ringRow(2)]);
    repo.claimEscalationForMissedCall.mockResolvedValue(null);
    const sender = recordingSender();

    const counts = await escalateRingTwiceCalls({ sender: sender.fn, now: DAY });

    expect(counts).toEqual({
      escalated: 0,
      held: 0,
      cooldownSuppressed: 0,
      refused: 0,
      sendFailed: 0,
      unconfigured: 0,
    });
    expect(repo.recordEscalationOutcome).not.toHaveBeenCalled();
    expect(sender.sent).toHaveLength(0);
  });

  it('one row throwing does not stop the next', async () => {
    repo.listUnescalatedRingTwiceCalls.mockResolvedValue([
      { ...ringRow(2), tenantId: 'tenant-broken' },
      ringRow(4),
    ]);
    repo.tenantGet.mockImplementation(async (tenantId: string) => {
      if (tenantId === 'tenant-broken') throw new Error('driver hiccup with parameters');
      return [tenantRow()];
    });
    repo.claimEscalationForMissedCall.mockResolvedValue({ id: 'esc-ring' });
    repo.getMissedCallForTextBack.mockResolvedValue({ id: 'call-4', tenantId: TENANT_ID, callerE164: CALLER });
    const sender = recordingSender();

    const counts = await escalateRingTwiceCalls({ sender: sender.fn, now: DAY });

    expect(counts).toMatchObject({ sendFailed: 1, escalated: 1 });
    expect(sender.sent).toHaveLength(1);
  });

  it('a call row from another client reads as no number: the call line is omitted, never borrowed', async () => {
    repo.listUnescalatedRingTwiceCalls.mockResolvedValue([ringRow(2)]);
    repo.claimEscalationForMissedCall.mockResolvedValue({ id: 'esc-ring' });
    repo.getMissedCallForTextBack.mockResolvedValue({ id: 'call-2', tenantId: 'tenant-b', callerE164: CALLER });
    const sender = recordingSender();

    await escalateRingTwiceCalls({ sender: sender.fn, now: DAY });

    expect(sender.sent[0]!.body).not.toContain('Call them');
  });
});

/* ------------------------------------------------------------------------- *
 * The release of held escalations (D-09)
 * ------------------------------------------------------------------------- */

function releasedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'esc-held-1',
    tenantId: TENANT_ID,
    cadenceId: 'cadence-lead-1',
    leadId: 'lead-1',
    inboundMessageId: 'inbound-1',
    missedCallId: null,
    toAddress: TRADIE,
    claimedAt: NIGHT,
    ...overrides,
  };
}

function leadCadence() {
  return [{ id: 'cadence-lead-1', quoteId: null, leadId: 'lead-1', contactName: null, contactMobile: CALLER }];
}

describe('releaseHeldEscalations', () => {
  it('no escalation sender means nothing is released', async () => {
    const counts = await releaseHeldEscalations({ sender: undefined, now: OPEN });
    expect(counts.unconfigured).toBe(1);
    expect(repo.claimHeldEscalationRelease).not.toHaveBeenCalled();
  });

  it('asks the guarded release with now and the hot cap — once per pass, never twice', async () => {
    repo.claimHeldEscalationRelease.mockResolvedValue([]);
    await releaseHeldEscalations({ sender: recordingSender().fn, now: OPEN });
    expect(repo.claimHeldEscalationRelease).toHaveBeenCalledTimes(1);
    expect(repo.claimHeldEscalationRelease).toHaveBeenCalledWith(OPEN, 25);
  });

  it('a held reply: the words read after the release, built as the hot-lead pass builds them, sent once', async () => {
    const body = 'Can you come and look at the fence this week?';
    repo.claimHeldEscalationRelease.mockResolvedValue([releasedRow()]);
    repo.byIdForEscalation.mockResolvedValue([
      { body, fromAddress: CALLER, cadenceId: 'cadence-lead-1', leadId: 'lead-1' },
    ]);
    repo.cadencesGetById.mockResolvedValue(leadCadence());
    const sender = recordingSender();

    const counts = await releaseHeldEscalations({ sender: sender.fn, now: OPEN });

    expect(repo.byIdForEscalation).toHaveBeenCalledWith(TENANT_ID, 'inbound-1');
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]).toMatchObject({
      to: TRADIE,
      from: SMS_FROM,
      customString: 'esc-held-1',
      body: buildEscalationSms({
        customerName: null,
        quoteSnippet: LEAD_REPLY_SNIPPET,
        replyText: body,
        customerMobile: CALLER,
      }).body,
    });
    expect(repo.recordEscalationOutcome).toHaveBeenCalledWith(
      'esc-held-1',
      expect.objectContaining({ outcome: 'sent', sentAt: OPEN }),
    );
    expect(counts).toMatchObject({ released: 1, refused: 0, sendFailed: 0 });
    // NO COOLDOWN AT RELEASE: the held row already holds the claim.
    expect(repo.recentEscalationForCadence).not.toHaveBeenCalled();
  });

  it('a held ring-twice: the caller’s number read after the release, the ring-twice message sent', async () => {
    repo.claimHeldEscalationRelease.mockResolvedValue([
      releasedRow({ inboundMessageId: null, missedCallId: 'call-2' }),
    ]);
    repo.getMissedCallForTextBack.mockResolvedValue({ id: 'call-2', tenantId: TENANT_ID, callerE164: CALLER });
    const sender = recordingSender();

    const counts = await releaseHeldEscalations({ sender: sender.fn, now: OPEN });

    expect(sender.sent[0]!.body).toBe(
      buildRingTwiceEscalationSms({ customerMobile: CALLER, minutes: RING_TWICE_WINDOW_MINUTES }).body,
    );
    expect(counts.released).toBe(1);
  });

  it('a lead that closed DURING the hold: lead_closed, nothing sent, nothing read', async () => {
    repo.claimHeldEscalationRelease.mockResolvedValue([releasedRow()]);
    repo.leadsById.mockResolvedValue([
      { id: 'lead-1', status: 'closed', closedAt: new Date(NIGHT.getTime() + 60 * 60_000) },
    ]);
    const sender = recordingSender();

    const counts = await releaseHeldEscalations({ sender: sender.fn, now: OPEN });

    expect(repo.recordEscalationOutcome).toHaveBeenCalledWith('esc-held-1', {
      outcome: 'lead_closed',
      at: OPEN,
    });
    expect(counts).toMatchObject({ refused: 1, released: 0 });
    expect(sender.sent).toHaveLength(0);
    expect(repo.byIdForEscalation).not.toHaveBeenCalled();
  });

  it('a converted lead (closed, no closed_at) is lead_closed too', async () => {
    repo.claimHeldEscalationRelease.mockResolvedValue([releasedRow()]);
    repo.leadsById.mockResolvedValue([{ id: 'lead-1', status: 'converted', closedAt: null }]);
    const counts = await releaseHeldEscalations({ sender: recordingSender().fn, now: OPEN });
    expect(counts).toMatchObject({ refused: 1, released: 0 });
  });

  it('a lead its own reply’s label closed in the claiming tick is still told', async () => {
    repo.claimHeldEscalationRelease.mockResolvedValue([releasedRow()]);
    repo.leadsById.mockResolvedValue([{ id: 'lead-1', status: 'closed', closedAt: NIGHT }]);
    repo.byIdForEscalation.mockResolvedValue([
      { body: 'The tap you fixed is leaking again', fromAddress: CALLER, cadenceId: 'cadence-lead-1', leadId: 'lead-1' },
    ]);
    repo.cadencesGetById.mockResolvedValue(leadCadence());
    const sender = recordingSender();

    const counts = await releaseHeldEscalations({ sender: sender.fn, now: OPEN });

    expect(counts).toMatchObject({ released: 1, refused: 0 });
    expect(sender.sent).toHaveLength(1);
  });

  // 2026-10-09 (13-REVIEW WR-01): the release texts the tenant's escalation
  // phone as it stands AT RELEASE, never the number the hold recorded at 23:00
  // — the operator's one reason to edit it overnight is that it was wrong.
  it('the tradie’s phone changed overnight: the CURRENT number is texted and written back as to_address', async () => {
    const OLD_TRADIE = '+61491570157';
    repo.claimHeldEscalationRelease.mockResolvedValue([
      releasedRow({ toAddress: OLD_TRADIE, inboundMessageId: null, missedCallId: 'call-2' }),
    ]);
    repo.tenantGet.mockResolvedValue([tenantRow(false, TRADIE_LOCAL)]);
    repo.getMissedCallForTextBack.mockResolvedValue({ id: 'call-2', tenantId: TENANT_ID, callerE164: CALLER });
    const sender = recordingSender();

    const counts = await releaseHeldEscalations({ sender: sender.fn, now: OPEN });

    expect(repo.tenantGet).toHaveBeenCalledWith(TENANT_ID);
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]!.to).toBe(TRADIE);
    expect(sender.sent.some((s) => s.to === OLD_TRADIE)).toBe(false);
    expect(repo.recordEscalationOutcome).toHaveBeenCalledWith(
      'esc-held-1',
      expect.objectContaining({ outcome: 'sent', toAddress: TRADIE }),
    );
    expect(counts).toMatchObject({ released: 1, refused: 0 });
  });

  it.each([
    ['removed', [tenantRow(false, null)]],
    ['unrepairable', [tenantRow(false, '491570156')]],
    ['on a tenant row that is gone', []],
  ])(
    'the tradie’s phone %s overnight: no_escalation_number, zero provider calls, the recorded number never used',
    async (_case, tenantRows) => {
      repo.claimHeldEscalationRelease.mockResolvedValue([releasedRow({ toAddress: TRADIE })]);
      repo.tenantGet.mockResolvedValue(tenantRows);
      const sender = recordingSender();

      const counts = await releaseHeldEscalations({ sender: sender.fn, now: OPEN });

      expect(repo.recordEscalationOutcome).toHaveBeenCalledWith('esc-held-1', {
        outcome: 'no_escalation_number',
        at: OPEN,
      });
      expect(counts).toMatchObject({ refused: 1, released: 0, sendFailed: 0 });
      expect(sender.sent).toHaveLength(0);
      expect(resolveSmsFrom).not.toHaveBeenCalled();
    },
  );

  it('a client disarmed overnight: sms_not_configured, zero provider calls', async () => {
    resolveSmsFrom.mockResolvedValue(null);
    repo.claimHeldEscalationRelease.mockResolvedValue([releasedRow()]);
    const sender = recordingSender();

    const counts = await releaseHeldEscalations({ sender: sender.fn, now: OPEN });

    expect(repo.recordEscalationOutcome).toHaveBeenCalledWith('esc-held-1', {
      outcome: 'sms_not_configured',
      at: OPEN,
    });
    expect(counts.refused).toBe(1);
    expect(sender.sent).toHaveLength(0);
  });

  it('a throw after the release is counted failed, leaves the outcome NULL, and the next row still goes', async () => {
    repo.claimHeldEscalationRelease.mockResolvedValue([
      releasedRow({ id: 'esc-held-1' }),
      releasedRow({ id: 'esc-held-2', inboundMessageId: null, missedCallId: 'call-2' }),
    ]);
    repo.byIdForEscalation.mockRejectedValue(new Error('driver hiccup carrying a body'));
    repo.getMissedCallForTextBack.mockResolvedValue({ id: 'call-2', tenantId: TENANT_ID, callerE164: CALLER });
    const sender = recordingSender();

    const counts = await releaseHeldEscalations({ sender: sender.fn, now: OPEN });

    expect(counts).toMatchObject({ sendFailed: 1, released: 1 });
    // The failed row's outcome is never written — "released, outcome unknown".
    expect(repo.recordEscalationOutcome.mock.calls.map((call) => call[0])).toEqual(['esc-held-2']);
    // And no second release is ever attempted inside the pass.
    expect(repo.claimHeldEscalationRelease).toHaveBeenCalledTimes(1);
  });

  it('a provider refusal records its code and is never retried', async () => {
    repo.claimHeldEscalationRelease.mockResolvedValue([
      releasedRow({ inboundMessageId: null, missedCallId: 'call-2' }),
    ]);
    repo.getMissedCallForTextBack.mockResolvedValue({ id: 'call-2', tenantId: TENANT_ID, callerE164: CALLER });
    const refusing = vi.fn(
      async (): Promise<SendSmsResult> => ({
        ok: false,
        reason: 'INVALID_RECIPIENT',
        retryable: false,
        optedOut: false,
      }),
    );

    const counts = await releaseHeldEscalations({ sender: refusing, now: OPEN });

    expect(refusing).toHaveBeenCalledTimes(1);
    expect(repo.recordEscalationOutcome).toHaveBeenCalledWith(
      'esc-held-1',
      expect.objectContaining({ outcome: 'INVALID_RECIPIENT' }),
    );
    expect(counts).toMatchObject({ sendFailed: 1, released: 0 });
  });
});
