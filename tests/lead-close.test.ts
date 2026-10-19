/**
 * D-11/D-12/D-14 — CLOSING A LEAD IS FINAL AND IDEMPOTENT, EVERY EXIT MAPS TO A
 * REASON, AND A REPEAT CALLER GETS A NEW LEAD EXCEPT AFTER A NEGATIVE CLOSE
 * (Phase 13, plan 13-03; LEAD-01, LEAD-03).
 *
 * ── THE RULES THIS PROVES ───────────────────────────────────────────────────
 *
 *   D-14 — `closeLead` is final and idempotent AT THE DATABASE. Called twice
 *          for one lead it closes once: the lead's status, `closed_reason` and
 *          `closed_at` are written once, the live cadence is stopped
 *          `lead_closed` once and its unsent touches skipped `cadence_stopped`
 *          once. The second call answers `already_closed` and changes no
 *          column — full rows are compared before and after, `updated_at`
 *          included. An `expired` close expires the cadence instead.
 *   D-11 — the reconciling sweep (`closeLeadsWithEndedCadences`) maps every
 *          terminal cadence state onto a reason: completed → touches_exhausted,
 *          stopped by a STOP through `handleInboundSms` → opt_out, stopped
 *          `operator_closed` → operator; an active cadence is untouched. No
 *          edit to controls.ts or the completion sweep was needed for it.
 *   D-12 — after a touches_exhausted close the same mobile gets a NEW lead,
 *          a new lead cadence and a text-back. After a spam, not_a_lead,
 *          complaint or opt_out close within LEAD_NEGATIVE_COOL_OFF_DAYS the
 *          call is skipped `recent_negative_close` with no lead and no send;
 *          at exactly 90 days it is still refused, and one millisecond past
 *          it a new lead opens. `already_sorted` is not negative.
 *   D-07 — a second call from a number with an open lead, skipped
 *          `recent_text` or `lead_open`, carries the lead's id and its live
 *          cadence's id on the skipped row (Task 1 of this plan), and the
 *          ring-twice list finds it by those ids.
 *
 * ── THE TWO PARTIAL INDEXES WHOSE RELEASE IT DEMONSTRATES ───────────────────
 *
 *   `leads_one_open_per_mobile` — a closed lead no longer holds its mobile:
 *     the repeat caller's `openOrCreate` inserts a second lead row.
 *   `cadences_one_live_per_lead` — a closed lead's cadence is no longer live:
 *     a live lead cadence for the same lead is admitted again (inserted, then
 *     deleted by id).
 *
 * ── DB-BACKED, AND CI IS THE ONLY PLACE IT RUNS ─────────────────────────────
 *
 * It refuses a non-local target through `tests/helpers/env.ts` and MUST NEVER
 * run through `npm run test:remote`: the hosted Sydney project is production,
 * and this suite arms text-back and SMS identity rows. Those rows are
 * TENANT-SCOPED, carry fiction-block numbers and are deleted BY ID in
 * `afterAll`, first (`messaging_config` has no FK). The STOP's inbound row is
 * deleted by id too (an unplaced reply would carry no tenant).
 *
 * The sender is a recording sender whose `provider` is a real provider name
 * (a stub send is recorded `failed`, D-15), so nothing is dialled. Clocks are
 * pinned. The passes and reads below are global where the code is global, so
 * every assertion is keyed on this suite's own ids. Every number is from
 * ACMA's fiction block (0491 570 4xx), a range no other suite uses.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { SendOutcome, SendRequest, TouchSender } from '../src/core/cadence/sender';
import { closeLead, closeLeadsWithEndedCadences } from '../src/core/leads/close';
import { LEAD_NEGATIVE_COOL_OFF_DAYS, RING_TWICE_WINDOW_MINUTES } from '../src/core/leads/constants';
import { sendTextBack } from '../src/core/leads/text-back';
import { handleInboundSms } from '../src/core/messaging/inbound';
import {
  closeDb,
  forTenant,
  listUnescalatedRingTwiceCalls,
  upsertChannelConfig,
} from '../src/db/repository';

import {
  admin,
  seedLead,
  seedLeadCadence,
  seedLedgerRow,
  seedMissedCall,
  seedTenant,
  seedTextBackArmed,
  seedTextBackTemplates,
  seedTouches,
  teardownTenants,
} from './helpers/seed';

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const COOL_OFF_MS = LEAD_NEGATIVE_COOL_OFF_DAYS * MS_PER_DAY;

/** THE PINNED CLOCK: Wednesday 7 October 2026, 10:00 in Perth (02:00 UTC). */
const NOW = new Date('2026-10-07T02:00:00.000Z');

function at(base: Date, ms: number): Date {
  return new Date(base.getTime() + ms);
}

/** The shared SMS number the text-back leaves from — fiction block. */
const SMS_FROM = '+61491570450';
/** Our inbound number, as the provider reports it on the STOP. */
const INBOUND_TO = '+61480000000';

/** One fiction-block mobile per scenario, so `leads_one_open_per_mobile` never meets itself. */
const COMPLAINT_CALLER = '+61491570401';
const EXPIRED_CALLER = '+61491570402';
const COMPLETED_CALLER = '+61491570403';
const STOP_CALLER = '+61491570404';
/** The same STOP_CALLER, spelled the way a provider hands it over. */
const STOP_FROM = '0491 570 404';
const OPERATOR_CALLER = '+61491570405';
const ACTIVE_CALLER = '+61491570406';
const EXHAUSTED_CALLER = '+61491570410';
const SPAM_CALLER = '+61491570411';
const BOUNDARY_CALLER = '+61491570412';
const PAST_BOUNDARY_CALLER = '+61491570413';
const NEGATIVE_CALLERS = {
  complaint: '+61491570414',
  opt_out: '+61491570415',
  not_a_lead: '+61491570417',
} as const;
const SORTED_CALLER = '+61491570416';
const RING_TWICE_CALLER = '+61491570420';
const LEAD_OPEN_CALLER = '+61491570421';

const tenantIds: string[] = [];
const configIds: string[] = [];
const inboundIds: string[] = [];

/** A sender that records what it was asked to send, as a real provider would receive it. */
class RecordingSender implements TouchSender {
  readonly provider = 'clicksend';
  readonly sent: SendRequest[] = [];

  async send(request: SendRequest): Promise<SendOutcome> {
    this.sent.push(request);
    return {
      kind: 'sent',
      provider: 'clicksend',
      providerMessageId: `cs-${request.ledgerId.slice(0, 8)}`,
    };
  }
}

/* -------------------------------------------------------------------------- *
 * Reads, all keyed on this suite's ids
 * -------------------------------------------------------------------------- */

type Row = Record<string, unknown>;

async function rowById(table: string, id: string): Promise<Row> {
  const { data, error } = await admin.from(table).select('*').eq('id', id).single();
  if (error) throw new Error(`Reading ${table} failed: ${error.message}`);
  return data as Row;
}

async function touchesOf(cadenceId: string): Promise<Row[]> {
  const { data, error } = await admin
    .from('cadence_touches')
    .select('*')
    .eq('cadence_id', cadenceId)
    .order('touch_number', { ascending: true });
  if (error) throw new Error(`Reading touches failed: ${error.message}`);
  return (data ?? []) as Row[];
}

async function ledgerCount(tenantId: string): Promise<number> {
  const { count, error } = await admin
    .from('send_ledger')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);
  if (error) throw new Error(`Counting the ledger failed: ${error.message}`);
  return count ?? 0;
}

async function leadsFor(tenantId: string, mobile: string): Promise<Row[]> {
  const { data, error } = await admin
    .from('leads')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('contact_mobile', mobile)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Reading leads failed: ${error.message}`);
  return (data ?? []) as Row[];
}

async function liveLeadCadences(leadId: string): Promise<Row[]> {
  const { data, error } = await admin
    .from('cadences')
    .select('*')
    .eq('lead_id', leadId)
    .eq('kind', 'lead')
    .in('status', ['active', 'paused']);
  if (error) throw new Error(`Reading lead cadences failed: ${error.message}`);
  return (data ?? []) as Row[];
}

function ms(value: unknown): number {
  return new Date(String(value)).getTime();
}

/* -------------------------------------------------------------------------- *
 * Seeds
 * -------------------------------------------------------------------------- */

/**
 * An OPEN lead with a live lead cadence: touch 1 sent (with its ledger row,
 * as the text-back writes it), touches 2 and 3 as given.
 */
async function openLeadWithCadence(
  tenantId: string,
  mobile: string,
  options: { anchorAt?: Date; laterTouches?: 'scheduled' | 'sent' } = {},
): Promise<{ leadId: string; cadenceId: string }> {
  const anchorAt = options.anchorAt ?? at(NOW, -26 * MS_PER_HOUR);
  const later = options.laterTouches ?? 'scheduled';
  const leadId = await seedLead(tenantId, {
    contact_mobile: mobile,
    first_missed_at: anchorAt.toISOString(),
    last_missed_at: anchorAt.toISOString(),
  });
  const cadenceId = await seedLeadCadence(tenantId, leadId, {
    contact_mobile: mobile,
    anchor_at: anchorAt.toISOString(),
  });
  await seedTouches(cadenceId, tenantId, [
    { status: 'sent', scheduled_at: anchorAt.toISOString(), original_offset_days: 0 },
    { status: later, scheduled_at: at(anchorAt, 24 * MS_PER_HOUR).toISOString(), original_offset_days: 1 },
    { status: later, scheduled_at: at(anchorAt, 48 * MS_PER_HOUR).toISOString(), original_offset_days: 2 },
  ]);
  await seedLedgerRow(tenantId, {
    cadenceId,
    quoteId: null,
    leadId,
    touchNumber: 1,
    claimedAt: anchorAt.toISOString(),
    toAddress: mobile,
    outcome: 'sent',
  });
  return { leadId, cadenceId };
}

/** A lead CLOSED with `reason` at `closedAt` — the shape `leads.close` writes. */
async function closedLead(tenantId: string, mobile: string, reason: string, closedAt: Date): Promise<string> {
  const openedAt = at(closedAt, -2 * MS_PER_DAY);
  return seedLead(tenantId, {
    contact_mobile: mobile,
    first_missed_at: openedAt.toISOString(),
    last_missed_at: openedAt.toISOString(),
    status: reason === 'expired' ? 'expired' : 'closed',
    closed_reason: reason,
    closed_at: closedAt.toISOString(),
  });
}

/** A completed call from `caller` that ended `agoMs` before `now`. */
async function call(tenantId: string, caller: string, now: Date, agoMs = 15_000): Promise<string> {
  const endedAt = at(now, -agoMs);
  return seedMissedCall(
    tenantId,
    {},
    { caller, afterHours: false, startedAt: at(endedAt, -20_000), endedAt },
  );
}

/** An ARMED client: text_back on, an SMS identity that resolves, attested wording. */
async function armedTenant(prefix: string): Promise<string> {
  const tenantId = await seedTenant(prefix);
  tenantIds.push(tenantId);
  configIds.push(await seedTextBackArmed(tenantId));
  // TENANT-SCOPED, fictional, deleted by id in afterAll. See the header.
  const sms = await upsertChannelConfig({ channel: 'sms', tenantId, fromAddress: SMS_FROM, enabled: true });
  configIds.push(sms.id);
  await seedTextBackTemplates(tenantId);
  return tenantId;
}

afterAll(async () => {
  // BY ID and FIRST: an enabled text_back or sms row must not outlive the suite.
  if (configIds.length > 0) {
    const { error } = await admin.from('messaging_config').delete().in('id', configIds);
    if (error) throw new Error(`Teardown failed, messaging_config rows left: ${error.message}`);
  }
  if (inboundIds.length > 0) {
    const { error } = await admin.from('inbound_messages').delete().in('id', inboundIds);
    if (error) throw new Error(`Teardown failed, inbound rows left: ${error.message}`);
  }
  if (tenantIds.length > 0) await teardownTenants(tenantIds);
  await closeDb();
}, 60_000);

/* -------------------------------------------------------------------------- *
 * D-14 — closeLead is final and idempotent
 * -------------------------------------------------------------------------- */

describe('closeLead closes once, and a second close changes nothing (D-14)', () => {
  let tenantId: string;
  let leadId: string;
  let cadenceId: string;
  let ledgerBefore: number;
  let first: Awaited<ReturnType<typeof closeLead>>;
  let lead: Row;
  let cadence: Row;
  let touches: Row[];

  beforeAll(async () => {
    tenantId = await seedTenant('Lead Close Idempotent');
    tenantIds.push(tenantId);
    ({ leadId, cadenceId } = await openLeadWithCadence(tenantId, COMPLAINT_CALLER));
    ledgerBefore = await ledgerCount(tenantId);

    first = await closeLead(tenantId, leadId, 'complaint', NOW);
    lead = await rowById('leads', leadId);
    cadence = await rowById('cadences', cadenceId);
    touches = await touchesOf(cadenceId);
  }, 60_000);

  it('the first close returns closed and writes the lead once: closed, complaint, closed_at = now', () => {
    expect(first).toEqual({ kind: 'closed' });
    expect(lead.status).toBe('closed');
    expect(lead.closed_reason).toBe('complaint');
    expect(ms(lead.closed_at)).toBe(NOW.getTime());
  });

  it('stops the live cadence lead_closed and skips every unsent touch cadence_stopped', () => {
    expect(cadence.status).toBe('stopped');
    expect(cadence.stop_reason).toBe('lead_closed');
    expect(touches.map((t) => t.status)).toEqual(['sent', 'skipped', 'skipped']);
    expect(touches.slice(1).map((t) => t.skip_reason)).toEqual(['cadence_stopped', 'cadence_stopped']);
  });

  it('sends nothing: the ledger has no new row', async () => {
    expect(await ledgerCount(tenantId)).toBe(ledgerBefore);
  });

  it('a second identical close returns already_closed and changes no column of the lead, cadence or touches', async () => {
    const again = await closeLead(tenantId, leadId, 'complaint', at(NOW, MS_PER_HOUR));
    expect(again).toEqual({ kind: 'already_closed' });

    expect(await rowById('leads', leadId)).toEqual(lead);
    expect(await rowById('cadences', cadenceId)).toEqual(cadence);
    expect(await touchesOf(cadenceId)).toEqual(touches);
    expect(await ledgerCount(tenantId)).toBe(ledgerBefore);
  });

  it('a later close with a DIFFERENT reason never overwrites the first (no reopen, no re-reason)', async () => {
    const differently = await closeLead(tenantId, leadId, 'spam', at(NOW, 2 * MS_PER_HOUR));
    expect(differently).toEqual({ kind: 'already_closed' });

    const after = await rowById('leads', leadId);
    expect(after).toEqual(lead);
    expect(after.closed_reason).toBe('complaint');
  });

  it('releases cadences_one_live_per_lead: a live lead cadence for the closed lead is admitted again', async () => {
    expect(await liveLeadCadences(leadId)).toHaveLength(0);

    // The index admits the insert because the old cadence is no longer live.
    // Inserted only to prove the release, then deleted by id.
    const probe = await seedLeadCadence(tenantId, leadId, {
      contact_mobile: COMPLAINT_CALLER,
      anchor_at: NOW.toISOString(),
    });
    try {
      expect(await liveLeadCadences(leadId)).toHaveLength(1);
    } finally {
      const { error } = await admin.from('cadences').delete().eq('id', probe);
      if (error) throw new Error(`Deleting the probe cadence failed: ${error.message}`);
    }
  });
});

describe('an expired close EXPIRES the cadence rather than stopping it (D-15, D-14)', () => {
  let tenantId: string;
  let leadId: string;
  let cadenceId: string;
  let result: Awaited<ReturnType<typeof closeLead>>;

  beforeAll(async () => {
    tenantId = await seedTenant('Lead Close Expired');
    tenantIds.push(tenantId);
    ({ leadId, cadenceId } = await openLeadWithCadence(tenantId, EXPIRED_CALLER));
    result = await closeLead(tenantId, leadId, 'expired', NOW);
  }, 60_000);

  it('the cadence reads expired and its unsent touches cadence_expired', async () => {
    expect(result).toEqual({ kind: 'closed' });
    const cadence = await rowById('cadences', cadenceId);
    expect(cadence.status).toBe('expired');
    expect(cadence.stop_reason).toBeNull();

    const touches = await touchesOf(cadenceId);
    expect(touches.map((t) => t.status)).toEqual(['sent', 'skipped', 'skipped']);
    expect(touches.slice(1).map((t) => t.skip_reason)).toEqual(['cadence_expired', 'cadence_expired']);
  });

  it('the lead reads status expired with closed_reason expired', async () => {
    const lead = await rowById('leads', leadId);
    expect(lead.status).toBe('expired');
    expect(lead.closed_reason).toBe('expired');
    expect(ms(lead.closed_at)).toBe(NOW.getTime());
  });

  it('a second expired close is already_closed', async () => {
    const before = await rowById('leads', leadId);
    expect(await closeLead(tenantId, leadId, 'expired', at(NOW, MS_PER_HOUR))).toEqual({
      kind: 'already_closed',
    });
    expect(await rowById('leads', leadId)).toEqual(before);
  });
});

/* -------------------------------------------------------------------------- *
 * D-11 — the reconciling sweep maps every exit onto a reason
 * -------------------------------------------------------------------------- */

describe('the sweep closes every lead whose cadence ended, with the reason the end implies (D-11)', () => {
  let tenantId: string;
  let completed: { leadId: string; cadenceId: string };
  let stopped: { leadId: string; cadenceId: string };
  let operator: { leadId: string; cadenceId: string };
  let active: { leadId: string; cadenceId: string };
  let completedCount: string[];
  let stopCadence: Row;
  let swept: number;
  let sweptAgain: number;

  beforeAll(async () => {
    tenantId = await seedTenant('Lead Close Sweep');
    tenantIds.push(tenantId);

    // COMPLETED: touch 3 sent; the completion sweep closes the cadence.
    completed = await openLeadWithCadence(tenantId, COMPLETED_CALLER, { laterTouches: 'sent' });
    // STOP: a STOP reply through the real inbound path kills the cadence.
    stopped = await openLeadWithCadence(tenantId, STOP_CALLER);
    // OPERATOR: an operator close, written the way the console's close writes it.
    operator = await openLeadWithCadence(tenantId, OPERATOR_CALLER);
    // ACTIVE: nothing ended; the sweep must leave it alone.
    active = await openLeadWithCadence(tenantId, ACTIVE_CALLER);

    const done = await forTenant(tenantId).cadences.completeWhereAllTouchesDone();
    completedCount = done.map((c) => c.id);

    const stop = await handleInboundSms({
      from: STOP_FROM,
      to: INBOUND_TO,
      body: 'STOP',
      providerMessageId: `lead-close-stop-${randomUUID()}`,
    });
    if ('inboundId' in stop) inboundIds.push(stop.inboundId);
    expect(stop.kind).toBe('stop_threaded');
    stopCadence = await rowById('cadences', stopped.cadenceId);

    const { error } = await admin
      .from('cadences')
      .update({ status: 'stopped', stop_reason: 'operator_closed' })
      .eq('id', operator.cadenceId);
    if (error) throw new Error(`Stopping the operator cadence failed: ${error.message}`);

    swept = await closeLeadsWithEndedCadences(tenantId, NOW);
    sweptAgain = await closeLeadsWithEndedCadences(tenantId, at(NOW, MS_PER_MINUTE));
  }, 60_000);

  it('the completion sweep completed exactly the cadence whose three touches went', () => {
    expect(completedCount).toEqual([completed.cadenceId]);
  });

  it('a STOP reaches the lead cadence as contact_suppressed (the kill path is kind-agnostic)', () => {
    expect(stopCadence.status).toBe('stopped');
    expect(stopCadence.stop_reason).toBe('contact_suppressed');
  });

  it('closes three leads, and a second sweep closes none', () => {
    expect(swept).toBe(3);
    expect(sweptAgain).toBe(0);
  });

  it.each([
    ['completed', () => completed, 'touches_exhausted'],
    ['stopped by a STOP', () => stopped, 'opt_out'],
    ['stopped operator_closed', () => operator, 'operator'],
  ] as const)('a cadence %s closes its lead %s', async (_label, pick, reason) => {
    const lead = await rowById('leads', pick().leadId);
    expect(lead.status).toBe('closed');
    expect(lead.closed_reason).toBe(reason);
    expect(ms(lead.closed_at)).toBe(NOW.getTime());
  });

  it('an active cadence leaves its lead open and its cadence active', async () => {
    const lead = await rowById('leads', active.leadId);
    expect(lead.status).toBe('open');
    expect(lead.closed_reason).toBeNull();
    expect(lead.closed_at).toBeNull();
    expect((await rowById('cadences', active.cadenceId)).status).toBe('active');
  });
});

/* -------------------------------------------------------------------------- *
 * D-12 — a repeat caller: a new lead, except after a negative close
 * -------------------------------------------------------------------------- */

describe('a repeat caller gets a new lead, except within 90 days of a negative close (D-12)', () => {
  let tenantId: string;
  const sender = new RecordingSender();

  /** Send for a fresh call from `caller` at NOW; returns the result and the call id. */
  async function ring(caller: string): Promise<{ kind: string; callId: string }> {
    const callId = await call(tenantId, caller, NOW);
    const result = await sendTextBack(callId, { now: NOW, getSender: async () => sender });
    return { kind: result.kind, callId };
  }

  function sentTo(mobile: string): number {
    return sender.sent.filter((request) => request.to.address === mobile).length;
  }

  /** A refused call: skipped recent_negative_close, no lead, no ids on the row, nothing sent. */
  async function expectNegativeSkip(mobile: string, priorLeads: number): Promise<void> {
    const { kind, callId } = await ring(mobile);
    expect(kind).toBe('skipped');
    const row = await rowById('missed_calls', callId);
    expect(row.text_back_status).toBe('skipped');
    expect(row.text_back_skip_reason).toBe('recent_negative_close');
    // No open lead, so the skip carries neither ring-twice id (Task 1).
    expect(row.lead_id).toBeNull();
    expect(row.cadence_id).toBeNull();
    expect(await leadsFor(tenantId, mobile)).toHaveLength(priorLeads);
    expect(sentTo(mobile)).toBe(0);
  }

  /** An admitted call: sent, a NEW open lead with a live lead cadence. */
  async function expectNewLead(mobile: string, oldLeadId: string): Promise<void> {
    const { kind, callId } = await ring(mobile);
    expect(kind).toBe('sent');

    const leads = await leadsFor(tenantId, mobile);
    expect(leads).toHaveLength(2);
    const fresh = leads.find((lead) => lead.id !== oldLeadId);
    expect(fresh?.status).toBe('open');
    // The old lead is untouched: never reopened, its reason kept.
    expect(leads.find((lead) => lead.id === oldLeadId)?.status).not.toBe('open');

    const row = await rowById('missed_calls', callId);
    expect(row.text_back_status).toBe('sent');
    expect(row.lead_id).toBe(fresh?.id);
    expect(await liveLeadCadences(String(fresh?.id))).toHaveLength(1);
    expect(sentTo(mobile)).toBe(1);
  }

  beforeAll(async () => {
    tenantId = await armedTenant('Lead Close Repeat');
  }, 60_000);

  it('the cool-off is the 90 days the boundary cases below are written against', () => {
    expect(LEAD_NEGATIVE_COOL_OFF_DAYS).toBe(90);
  });

  it('after a touches_exhausted close the same mobile gets a NEW lead, a new cadence and a text-back (leads_one_open_per_mobile released)', async () => {
    const old = await openLeadWithCadence(tenantId, EXHAUSTED_CALLER, {
      anchorAt: at(NOW, -3 * MS_PER_DAY),
      laterTouches: 'sent',
    });
    const done = await forTenant(tenantId).cadences.completeWhereAllTouchesDone();
    expect(done.map((c) => c.id)).toContain(old.cadenceId);
    expect(await closeLeadsWithEndedCadences(tenantId, at(NOW, -2 * MS_PER_HOUR))).toBe(1);
    expect((await rowById('leads', old.leadId)).closed_reason).toBe('touches_exhausted');

    await expectNewLead(EXHAUSTED_CALLER, old.leadId);
  });

  it('after a spam close 10 days ago the call is skipped recent_negative_close, with no lead and no send', async () => {
    await closedLead(tenantId, SPAM_CALLER, 'spam', at(NOW, -10 * MS_PER_DAY));
    await expectNegativeSkip(SPAM_CALLER, 1);
  });

  it('closed_at EXACTLY now − 90 days is still refused recent_negative_close', async () => {
    await closedLead(tenantId, BOUNDARY_CALLER, 'spam', at(NOW, -COOL_OFF_MS));
    await expectNegativeSkip(BOUNDARY_CALLER, 1);
  });

  it('closed_at now − 90 days − 1 ms opens a new lead', async () => {
    const old = await closedLead(tenantId, PAST_BOUNDARY_CALLER, 'spam', at(NOW, -COOL_OFF_MS - 1));
    await expectNewLead(PAST_BOUNDARY_CALLER, old);
  });

  it.each(Object.entries(NEGATIVE_CALLERS))(
    'a %s close 10 days ago also refuses the call recent_negative_close',
    async (reason, mobile) => {
      await closedLead(tenantId, mobile, reason, at(NOW, -10 * MS_PER_DAY));
      await expectNegativeSkip(mobile, 1);
    },
  );

  it('an already_sorted close 10 days ago is NOT negative: a new lead opens', async () => {
    const old = await closedLead(tenantId, SORTED_CALLER, 'already_sorted', at(NOW, -10 * MS_PER_DAY));
    await expectNewLead(SORTED_CALLER, old);
  });
});

/* -------------------------------------------------------------------------- *
 * D-07 — the ring-twice ids on a skipped second call (Task 1)
 * -------------------------------------------------------------------------- */

describe('a second call joining an open lead records the lead and its live cadence (D-07)', () => {
  let tenantId: string;
  const sender = new RecordingSender();
  const windowMs = RING_TWICE_WINDOW_MINUTES * MS_PER_MINUTE;

  beforeAll(async () => {
    tenantId = await armedTenant('Lead Close Ring Twice');
  }, 60_000);

  it('recent_text: the second call within 24 h carries the open lead id and its live cadence id, and the ring-twice list finds it', async () => {
    const firstAt = at(NOW, -10 * MS_PER_MINUTE);
    const firstCall = await call(tenantId, RING_TWICE_CALLER, firstAt);
    expect((await sendTextBack(firstCall, { now: firstAt, getSender: async () => sender })).kind).toBe('sent');

    const [lead] = await leadsFor(tenantId, RING_TWICE_CALLER);
    expect(lead?.status).toBe('open');
    const [cadence] = await liveLeadCadences(String(lead?.id));
    expect(cadence).toBeDefined();

    const secondCall = await call(tenantId, RING_TWICE_CALLER, NOW);
    expect((await sendTextBack(secondCall, { now: NOW, getSender: async () => sender })).kind).toBe('skipped');

    const row = await rowById('missed_calls', secondCall);
    expect(row.text_back_status).toBe('skipped');
    expect(row.text_back_skip_reason).toBe('recent_text');
    expect(row.text_back_route).toBeNull();
    expect(row.lead_id).toBe(lead?.id);
    expect(row.cadence_id).toBe(cadence?.id);
    // One text, never two: the second call sent nothing.
    expect(sender.sent.filter((r) => r.to.address === RING_TWICE_CALLER)).toHaveLength(1);
    // The repeat call joined the lead (D-22).
    expect((await rowById('leads', String(lead?.id))).missed_call_count).toBe(2);

    const listed = await listUnescalatedRingTwiceCalls(1_000, {
      notBefore: at(NOW, -MS_PER_HOUR),
      windowMs,
    });
    expect(listed.filter((r) => r.tenantId === tenantId)).toEqual([
      { missedCallId: secondCall, tenantId, leadId: lead?.id, cadenceId: cadence?.id },
    ]);
  });

  it('lead_open: a call from a caller with an open lead and no recent text carries the lead and cadence ids — but with no earlier call it is not a ring-twice', async () => {
    const seeded = await openLeadWithCadence(tenantId, LEAD_OPEN_CALLER, {
      anchorAt: at(NOW, -3 * MS_PER_DAY),
    });
    const callId = await call(tenantId, LEAD_OPEN_CALLER, NOW);
    expect((await sendTextBack(callId, { now: NOW, getSender: async () => sender })).kind).toBe('skipped');

    const row = await rowById('missed_calls', callId);
    expect(row.text_back_skip_reason).toBe('lead_open');
    expect(row.lead_id).toBe(seeded.leadId);
    expect(row.cadence_id).toBe(seeded.cadenceId);
    expect(sender.sent.filter((r) => r.to.address === LEAD_OPEN_CALLER)).toHaveLength(0);

    const listed = await listUnescalatedRingTwiceCalls(1_000, {
      notBefore: at(NOW, -MS_PER_HOUR),
      windowMs,
    });
    expect(listed.some((r) => r.missedCallId === callId)).toBe(false);
  });
});
