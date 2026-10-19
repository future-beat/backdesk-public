/**
 * D-08 — THE TRADIE'S DONE, END TO END AT THE INBOUND DOOR (Phase 14, plan
 * 14-04; LEAD-04).
 *
 * ── THE RULES THIS PROVES ───────────────────────────────────────────────────
 *
 *   Closed  — a DONE from the client's escalation phone closes the lead whose
 *             escalation was most recently SENT to that number inside
 *             DONE_LOOKBACK_HOURS: the lead `closed / closed_by_tradie`, its
 *             cadence `stopped / lead_closed`, the inbound row carrying the
 *             tenant, `unmatched`, not a STOP and already triaged. No alert,
 *             and nothing is sent to anybody (the door holds no sender).
 *   Window  — 47 h and exactly 48 h are inside (`sent_at >= since`), 49 h is
 *             outside: the 49 h DONE closes nothing, its row waits untriaged
 *             and the operator alert fires exactly once.
 *   Own line — a DONE from a number on the never-text list with no escalation
 *             ever sent to it: `done_no_lead` and one alert.
 *   Again   — a second DONE for an already-closed lead answers
 *             `already_closed`, alerts nobody and is still recorded.
 *   Stranger — a DONE from a number that is no client's own is an ordinary
 *             reply: threaded (and the lead stays open) when it has a live
 *             cadence, unmatched when it has none. No alert either way.
 *   STOP    — a STOP from the escalation phone is a STOP: `stop_unmatched`,
 *             DONE never consulted, the lead untouched.
 *   Case    — "done thanks" closes.
 *   Held    — a held-then-released escalation, whose `to_address` the release
 *             wrote, is found by its send time like any other.
 *
 * ── ISOLATION BY CLOCK ──────────────────────────────────────────────────────
 *
 * Every scenario texts from the same escalation phone, and the read takes the
 * NEWEST send to that number. So each scenario runs at its own pinned clock, a
 * week after the last one, and seeds its escalation relative to it: an earlier
 * scenario's send is always more than 48 h before a later scenario's clock and
 * can never be the one found.
 *
 * ── DB-BACKED, AND CI IS THE ONLY PLACE IT RUNS ─────────────────────────────
 *
 * It refuses a non-local target through `tests/helpers/env.ts` and MUST NEVER
 * run through `npm run test:remote`: the hosted Sydney project is production.
 * Nothing is armed and nothing is dialled — the alert is a spy, and the door
 * texts nobody. Every number is from ACMA's fiction block (0491 570 64x), a
 * range no other suite uses. Rows that carry no tenant (the stranger's
 * unmatched reply, the unplaced STOP) are deleted BY ID, and the STOP's
 * bare-mobile suppressions BY ADDRESS; everything else is swept by
 * `teardownTenants`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { OperatorAlertInput, OperatorAlertResult } from '../src/core/alerts/operator-email';
import { DONE_LOOKBACK_HOURS } from '../src/core/leads/constants';
import { handleInboundSms } from '../src/core/messaging/inbound';
import { closeDb } from '../src/db/repository';

import {
  admin,
  seedEscalationSent,
  seedLead,
  seedLeadCadence,
  seedNeverTextNumber,
  seedTenant,
  teardownTenants,
} from './helpers/seed';

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/** THE FIRST PINNED CLOCK: Wednesday 7 October 2026, 10:00 in Perth. */
const BASE_NOW = new Date('2026-10-07T02:00:00.000Z');

/** Scenario k runs a week after scenario k − 1 — see the header. */
function clock(k: number): Date {
  return new Date(BASE_NOW.getTime() + k * 7 * MS_PER_DAY);
}

function hoursBefore(now: Date, hours: number): Date {
  return new Date(now.getTime() - hours * MS_PER_HOUR);
}

/** The client's escalation phone, stored spaced the way an operator types it. */
const TRADIE_TYPED = '0491 570 641';
const TRADIE = '+61491570641';
/** A line on the client's never-text list (`own_line`). */
const OWN_LINE = '+61491570642';
/** A stranger with a live lead cadence at the client. */
const STRANGER_WITH_CADENCE = '+61491570643';
/** A stranger with nothing at all. */
const STRANGER_NO_CADENCE = '+61491570640';
/** The callers whose leads the scenarios close — one per open lead. */
const CALLERS = [
  '+61491570644',
  '+61491570645',
  '+61491570646',
  '+61491570647',
  '+61491570648',
  '+61491570649',
] as const;

const SMS_TO = '+61480000000';

const tenantIds: string[] = [];
/** Inbound rows that carry no tenant — deleted by id. */
const untenantedInboundIds: string[] = [];

let tenantId: string;
let tenantName: string;

type Row = Record<string, unknown>;

async function row(table: string, id: string): Promise<Row> {
  const { data, error } = await admin.from(table).select('*').eq('id', id).single();
  if (error) throw new Error(`Reading ${table} ${id} failed: ${error.message}`);
  return data as Row;
}

function alertSpy() {
  return vi.fn<(input: OperatorAlertInput) => Promise<OperatorAlertResult>>(async () => ({
    ok: true,
    id: null,
  }));
}

/** An open lead for `caller` with a live lead cadence, at the suite's client. */
async function openLead(caller: string): Promise<{ leadId: string; cadenceId: string }> {
  const leadId = await seedLead(tenantId, { contact_mobile: caller });
  const cadenceId = await seedLeadCadence(tenantId, leadId, { contact_mobile: caller });
  return { leadId, cadenceId };
}

/** An open lead whose escalation was SENT to the tradie `hours` before `now`. */
async function escalatedLead(
  caller: string,
  now: Date,
  hours: number,
  held?: { holdUntil: Date; releasedAt: Date },
): Promise<{ leadId: string; cadenceId: string }> {
  const lead = await openLead(caller);
  await seedEscalationSent(tenantId, {
    ...lead,
    toAddress: TRADIE,
    sentAt: hoursBefore(now, hours),
    ...(held ?? {}),
  });
  return lead;
}

function done(from: string, body = 'DONE') {
  return { from, to: SMS_TO, body, providerMessageId: null };
}

beforeAll(async () => {
  tenantId = await seedTenant('Lead Done Keyword');
  tenantIds.push(tenantId);

  const { error } = await admin
    .from('tenants')
    .update({ escalation_phone: TRADIE_TYPED })
    .eq('id', tenantId);
  if (error) throw new Error(`Setting the escalation phone failed: ${error.message}`);

  await seedNeverTextNumber(tenantId, OWN_LINE, 'own_line');
  tenantName = String((await row('tenants', tenantId)).name);
});

afterAll(async () => {
  try {
    if (untenantedInboundIds.length > 0) {
      const { error } = await admin.from('inbound_messages').delete().in('id', untenantedInboundIds);
      if (error) throw new Error(`Teardown failed, inbound rows left behind: ${error.message}`);
    }
    // The unplaced STOP fanned a bare-mobile suppression out to every client.
    const { error } = await admin.from('suppressed_contacts').delete().eq('address', TRADIE);
    if (error) throw new Error(`Teardown failed, suppressions left behind: ${error.message}`);
    await teardownTenants(tenantIds);
  } finally {
    await closeDb();
  }
});

describe('a DONE from the escalation phone closes the lead it answers', () => {
  const now = clock(0);
  let first: { leadId: string; cadenceId: string };

  it('(1) closes the lead closed_by_tradie, stops its cadence, records the row triaged, alerts nobody', async () => {
    first = await escalatedLead(CALLERS[0], now, 1);
    const alert = alertSpy();

    const result = await handleInboundSms(done(TRADIE_TYPED), { now, alert });

    expect(result).toMatchObject({
      kind: 'done_closed',
      tenantId,
      leadId: first.leadId,
      close: 'closed',
    });
    expect(await row('leads', first.leadId)).toMatchObject({
      status: 'closed',
      closed_reason: 'closed_by_tradie',
    });
    expect(await row('cadences', first.cadenceId)).toMatchObject({
      status: 'stopped',
      stop_reason: 'lead_closed',
    });
    const inbound = await row('inbound_messages', result.inboundId);
    expect(inbound).toMatchObject({
      tenant_id: tenantId,
      attribution: 'unmatched',
      matched_cadence_count: 0,
      is_stop: false,
      cadence_id: null,
    });
    expect(inbound.triaged_at).not.toBeNull();
    expect(alert).not.toHaveBeenCalled();
  });

  it('(4) a second DONE for the same lead answers already_closed, alerts nobody, and is still recorded triaged', async () => {
    const alert = alertSpy();

    const result = await handleInboundSms(done(TRADIE), { now, alert });

    expect(result).toMatchObject({
      kind: 'done_closed',
      leadId: first.leadId,
      close: 'already_closed',
    });
    expect((await row('inbound_messages', result.inboundId)).triaged_at).not.toBeNull();
    expect(await row('leads', first.leadId)).toMatchObject({ closed_reason: 'closed_by_tradie' });
    expect(alert).not.toHaveBeenCalled();
  });
});

describe('the lookback: 47 h and 48 h are inside, 49 h is outside', () => {
  it(`(2a) a send 47 h before closes the lead (DONE_LOOKBACK_HOURS = ${DONE_LOOKBACK_HOURS})`, async () => {
    const now = clock(1);
    const lead = await escalatedLead(CALLERS[1], now, 47);
    const alert = alertSpy();

    const result = await handleInboundSms(done(TRADIE), { now, alert });

    expect(result).toMatchObject({ kind: 'done_closed', leadId: lead.leadId, close: 'closed' });
    expect(alert).not.toHaveBeenCalled();
  });

  it('(2a) a send exactly 48 h before is inside — at the boundary is inside', async () => {
    const now = clock(2);
    const lead = await escalatedLead(CALLERS[2], now, 48);
    const alert = alertSpy();

    const result = await handleInboundSms(done(TRADIE), { now, alert });

    expect(result).toMatchObject({ kind: 'done_closed', leadId: lead.leadId, close: 'closed' });
    expect(await row('leads', lead.leadId)).toMatchObject({ closed_reason: 'closed_by_tradie' });
  });

  it('(2b) a send 49 h before is outside: nothing closed, the row untriaged, ONE done_no_lead alert', async () => {
    const now = clock(3);
    const lead = await escalatedLead(CALLERS[3], now, 49);
    const alert = alertSpy();

    const result = await handleInboundSms(done(TRADIE), { now, alert });

    expect(result).toMatchObject({ kind: 'done_no_lead', tenantId });
    expect(await row('leads', lead.leadId)).toMatchObject({ status: 'open', closed_reason: null });
    expect((await row('cadences', lead.cadenceId)).status).toBe('active');
    const inbound = await row('inbound_messages', result.inboundId);
    expect(inbound).toMatchObject({ tenant_id: tenantId, attribution: 'unmatched', triaged_at: null });
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith({ kind: 'done_no_lead', tenantId, tenantName, at: now });
  });
});

describe('a DONE from another of the client’s own numbers', () => {
  it('(3) the own line, never escalated to: done_no_lead and exactly one alert', async () => {
    const now = clock(4);
    const alert = alertSpy();

    const result = await handleInboundSms(done(OWN_LINE, 'done'), { now, alert });

    expect(result).toMatchObject({ kind: 'done_no_lead', tenantId });
    expect((await row('inbound_messages', result.inboundId)).triaged_at).toBeNull();
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0]![0]).toMatchObject({ kind: 'done_no_lead', tenantId });
  });

  it('(7) lowercase "done thanks" closes', async () => {
    const now = clock(5);
    const lead = await escalatedLead(CALLERS[4], now, 2);
    const alert = alertSpy();

    const result = await handleInboundSms(done(TRADIE, 'done thanks'), { now, alert });

    expect(result).toMatchObject({ kind: 'done_closed', leadId: lead.leadId, close: 'closed' });
    expect(alert).not.toHaveBeenCalled();
  });

  it('(8) a held-then-released escalation is found by its release-time send', async () => {
    const now = clock(6);
    const lead = await escalatedLead(CALLERS[5], now, 3, {
      holdUntil: hoursBefore(now, 3),
      releasedAt: hoursBefore(now, 3),
    });
    const alert = alertSpy();

    const result = await handleInboundSms(done(TRADIE), { now, alert });

    expect(result).toMatchObject({ kind: 'done_closed', leadId: lead.leadId, close: 'closed' });
    expect(await row('leads', lead.leadId)).toMatchObject({ closed_reason: 'closed_by_tradie' });
  });
});

describe('a DONE from a stranger is an ordinary reply; a STOP is a STOP', () => {
  it('(5) a stranger with a live lead cadence texting DONE is threaded exactly as before', async () => {
    const now = clock(7);
    const lead = await openLead(STRANGER_WITH_CADENCE);
    const alert = alertSpy();

    const result = await handleInboundSms(done(STRANGER_WITH_CADENCE), { now, alert });

    expect(result).toMatchObject({ kind: 'reply_threaded', tenantId, cadenceId: lead.cadenceId });
    expect(await row('leads', lead.leadId)).toMatchObject({ status: 'open', closed_reason: null });
    expect(await row('inbound_messages', result.inboundId)).toMatchObject({
      attribution: 'threaded',
      lead_id: lead.leadId,
    });
    expect(alert).not.toHaveBeenCalled();
  });

  it('(5) a stranger with nothing texting DONE is an unmatched reply', async () => {
    const alert = alertSpy();

    const result = await handleInboundSms(done(STRANGER_NO_CADENCE), { now: clock(7), alert });
    untenantedInboundIds.push(result.inboundId);

    expect(result.kind).toBe('reply_unmatched');
    expect((await row('inbound_messages', result.inboundId)).tenant_id).toBeNull();
    expect(alert).not.toHaveBeenCalled();
  });

  it('(6) STOP from the escalation phone is the existing STOP path; DONE is never consulted', async () => {
    const now = clock(8);
    const lead = await escalatedLead(CALLERS[0], now, 1);
    const alert = alertSpy();

    const result = await handleInboundSms(done(TRADIE, 'STOP'), { now, alert });
    untenantedInboundIds.push(result.inboundId);

    expect(result.kind).toBe('stop_unmatched');
    expect(await row('leads', lead.leadId)).toMatchObject({ status: 'open', closed_reason: null });
    expect(await row('inbound_messages', result.inboundId)).toMatchObject({
      is_stop: true,
      tenant_id: null,
    });
    expect(alert).not.toHaveBeenCalled();
  });
});
