/**
 * D-08b — A REPEAT CALL WITHIN A DAY OF A CONVERSION IS NOT TEXTED AND OPENS NO
 * LEAD; PAST THE DAY, A NEW LEAD OPENS (Phase 15, plan 15-01; CON-06).
 *
 * ── THE RULES THIS PROVES ───────────────────────────────────────────────────
 *
 *   D-08b — a caller whose NEWEST lead at this client is `converted` with
 *           `closed_at` within LEAD_RECENT_CONVERSION_HOURS is skipped
 *           `recent_conversion` by the gate (rule 7): the missed call is
 *           `skipped` with that reason, no lead row is inserted and no ledger
 *           row is written for the tenant.
 *         — the same conversion 25 hours old is outside the window: the call
 *           is texted and a NEW open lead exists for the mobile
 *           (`leads_one_open_per_mobile` admits it, as the 0041 header says —
 *           a converted lead exits the arbiter like any close).
 *         — a lead CLOSED (not converted) an hour ago with reason `other` is
 *           not a conversion, and `other` is not one of the negative cool-off
 *           reasons either: the call is texted and a new lead opens.
 *
 * The pure half — the rule's position, its boundary (exactly 24 h is inside)
 * and every adjacent pair — is `tests/text-back-gate.test.ts`. This suite
 * proves the fact is assembled from the database the way the gate expects,
 * on a schema built from the journal through 0042 (the CHECK must admit the
 * new reason, or the skip write fails 23514).
 *
 * ── DB-BACKED, AND CI IS THE ONLY PLACE IT RUNS ─────────────────────────────
 *
 * It refuses a non-local target through `tests/helpers/env.ts` and MUST NEVER
 * run through `npm run test:remote`: the hosted Sydney project is production,
 * and this suite arms text-back and SMS identity rows. Those rows are
 * TENANT-SCOPED, carry fiction-block numbers and are deleted BY ID in
 * `afterAll`, first (`messaging_config` has no FK).
 *
 * The sender is a recording sender whose `provider` is a real provider name
 * (a stub send is recorded `failed`, D-15), so nothing is dialled. The clock
 * is pinned. Every assertion is keyed on this suite's own tenant and ids; the
 * suite reads reasons and counts rows and never prints a number. Every number
 * is from ACMA's fiction block, in the Phase 15 sub-block (0491 570 31x–39x)
 * no other suite uses (research Pitfall 10); every word is invented.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { SendOutcome, SendRequest, TouchSender } from '../src/core/cadence/sender';
import { LEAD_RECENT_CONVERSION_HOURS } from '../src/core/leads/constants';
import { sendTextBack } from '../src/core/leads/text-back';
import { closeDb, upsertChannelConfig } from '../src/db/repository';

import {
  admin,
  seedLead,
  seedMissedCall,
  seedTenant,
  seedTextBackArmed,
  seedTextBackTemplates,
  teardownTenants,
} from './helpers/seed';

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/** THE PINNED CLOCK: Tuesday 13 October 2026, 10:00 in Perth (02:00 UTC). */
const NOW = new Date('2026-10-13T02:00:00.000Z');

function at(base: Date, ms: number): Date {
  return new Date(base.getTime() + ms);
}

/** The SMS number the text-back leaves from — fiction block, Phase 15 sub-block. */
const SMS_FROM = '+61491570399';

/** One fiction-block mobile per scenario, so `leads_one_open_per_mobile` never meets itself. */
const CONVERTED_RECENT_CALLER = '+61491570311';
const CONVERTED_OLD_CALLER = '+61491570312';
const CLOSED_OTHER_CALLER = '+61491570313';

const tenantIds: string[] = [];
const configIds: string[] = [];

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

type Row = Record<string, unknown>;

async function rowById(table: string, id: string): Promise<Row> {
  const { data, error } = await admin.from(table).select('*').eq('id', id).single();
  if (error) throw new Error(`Reading ${table} failed: ${error.message}`);
  return data as Row;
}

async function leadsFor(tenantId: string, mobile: string): Promise<Row[]> {
  const { data, error } = await admin
    .from('leads')
    .select('id, status')
    .eq('tenant_id', tenantId)
    .eq('contact_mobile', mobile)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Reading leads failed: ${error.message}`);
  return (data ?? []) as Row[];
}

async function count(table: 'leads' | 'send_ledger', tenantId: string): Promise<number> {
  const { count: n, error } = await admin
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);
  if (error) throw new Error(`Counting ${table} failed: ${error.message}`);
  return n ?? 0;
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

/**
 * A lead CONVERTED by the operator's job creation at `closedAt` — the shape
 * `createJobForLead` leaves: `converted` / `job_created`, the job `created`
 * and linked.
 */
async function convertedLead(tenantId: string, mobile: string, closedAt: Date): Promise<string> {
  const openedAt = at(closedAt, -2 * MS_PER_DAY);
  return seedLead(tenantId, {
    contact_mobile: mobile,
    first_missed_at: openedAt.toISOString(),
    last_missed_at: openedAt.toISOString(),
    status: 'converted',
    closed_reason: 'job_created',
    closed_at: closedAt.toISOString(),
    sm8_job_state: 'created',
    sm8_job_uuid: randomUUID(),
    sm8_job_created_at: closedAt.toISOString(),
  });
}

/** A lead CLOSED (not converted) with `reason` at `closedAt`. */
async function closedLead(tenantId: string, mobile: string, reason: string, closedAt: Date): Promise<string> {
  const openedAt = at(closedAt, -2 * MS_PER_DAY);
  return seedLead(tenantId, {
    contact_mobile: mobile,
    first_missed_at: openedAt.toISOString(),
    last_missed_at: openedAt.toISOString(),
    status: 'closed',
    closed_reason: reason,
    closed_at: closedAt.toISOString(),
  });
}

/** A completed call from `caller` that ended 15 seconds before NOW. */
async function call(tenantId: string, caller: string): Promise<string> {
  const endedAt = at(NOW, -15_000);
  return seedMissedCall(
    tenantId,
    {},
    { caller, afterHours: false, startedAt: at(endedAt, -20_000), endedAt },
  );
}

afterAll(async () => {
  // BY ID and FIRST: an enabled text_back or sms row must not outlive the suite.
  if (configIds.length > 0) {
    const { error } = await admin.from('messaging_config').delete().in('id', configIds);
    if (error) throw new Error(`Teardown failed, messaging_config rows left: ${error.message}`);
  }
  if (tenantIds.length > 0) await teardownTenants(tenantIds);
  await closeDb();
}, 60_000);

describe('a repeat call after a conversion (Phase 15, D-08b)', () => {
  const sender = new RecordingSender();

  function sentTo(mobile: string): number {
    return sender.sent.filter((request) => request.to.address === mobile).length;
  }

  it('the window is the 24 hours the cases below are written against', () => {
    expect(LEAD_RECENT_CONVERSION_HOURS).toBe(24);
  });

  describe('converted an hour ago', () => {
    let tenantId: string;

    beforeAll(async () => {
      tenantId = await armedTenant('Recent Conversion Skip');
    }, 60_000);

    it('is skipped recent_conversion, opens no lead and writes no ledger row', async () => {
      await convertedLead(tenantId, CONVERTED_RECENT_CALLER, at(NOW, -1 * MS_PER_HOUR));
      const leadsBefore = await count('leads', tenantId);
      const ledgerBefore = await count('send_ledger', tenantId);

      const callId = await call(tenantId, CONVERTED_RECENT_CALLER);
      const result = await sendTextBack(callId, { now: NOW, getSender: async () => sender });

      expect(result.kind).toBe('skipped');
      const row = await rowById('missed_calls', callId);
      expect(row.text_back_status).toBe('skipped');
      expect(row.text_back_skip_reason).toBe('recent_conversion');
      expect(row.lead_id).toBeNull();
      expect(await count('leads', tenantId)).toBe(leadsBefore);
      expect(await count('send_ledger', tenantId)).toBe(ledgerBefore);
      expect(ledgerBefore).toBe(0);
      expect(sentTo(CONVERTED_RECENT_CALLER)).toBe(0);
    });
  });

  describe('converted 25 hours ago', () => {
    let tenantId: string;

    beforeAll(async () => {
      tenantId = await armedTenant('Old Conversion Texted');
    }, 60_000);

    it('is texted, and a NEW open lead exists for the mobile', async () => {
      const old = await convertedLead(tenantId, CONVERTED_OLD_CALLER, at(NOW, -25 * MS_PER_HOUR));

      const callId = await call(tenantId, CONVERTED_OLD_CALLER);
      const result = await sendTextBack(callId, { now: NOW, getSender: async () => sender });

      expect(result.kind).toBe('sent');
      const row = await rowById('missed_calls', callId);
      expect(row.text_back_status).toBe('sent');
      expect(row.text_back_skip_reason).toBeNull();

      const leads = await leadsFor(tenantId, CONVERTED_OLD_CALLER);
      expect(leads).toHaveLength(2);
      const fresh = leads.find((lead) => lead.id !== old);
      expect(fresh?.status).toBe('open');
      expect(row.lead_id).toBe(fresh?.id);
      // The converted lead is untouched: never reopened.
      expect(leads.find((lead) => lead.id === old)?.status).toBe('converted');
      expect(sentTo(CONVERTED_OLD_CALLER)).toBe(1);
    });
  });

  describe('closed (not converted) an hour ago with reason other', () => {
    let tenantId: string;

    beforeAll(async () => {
      tenantId = await armedTenant('Closed Other Texted');
    }, 60_000);

    it('is NOT recent_conversion — and other is not a cool-off reason, so a new lead opens', async () => {
      const old = await closedLead(tenantId, CLOSED_OTHER_CALLER, 'other', at(NOW, -1 * MS_PER_HOUR));

      const callId = await call(tenantId, CLOSED_OTHER_CALLER);
      const result = await sendTextBack(callId, { now: NOW, getSender: async () => sender });

      const row = await rowById('missed_calls', callId);
      expect(row.text_back_skip_reason).not.toBe('recent_conversion');
      expect(result.kind).toBe('sent');
      expect(row.text_back_status).toBe('sent');

      const leads = await leadsFor(tenantId, CLOSED_OTHER_CALLER);
      expect(leads).toHaveLength(2);
      expect(leads.find((lead) => lead.id !== old)?.status).toBe('open');
      expect(sentTo(CLOSED_OTHER_CALLER)).toBe(1);
    });
  });
});
