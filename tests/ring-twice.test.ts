/**
 * RING-TWICE, ON A REAL DATABASE (Phase 13, plan 13-06; D-07, D-08, D-09).
 *
 * A caller with an open lead who rings the tradie a second time inside
 * `RING_TWICE_WINDOW_MINUTES` and is missed again is a model-free hot trigger.
 * What this suite proves, end to end through `sendTextBack` and
 * `runCadenceTick`:
 *
 *   D-07 — call 1 is texted back and opens a lead; call 2 ten minutes later is
 *          skipped `recent_text` (NO second text) and carries the lead and its
 *          live cadence; the tick escalates it once, on call 2's
 *          `missed_call_id`, to the tradie's own phone.
 *   NEVER TWICE — call 3 five minutes later is claimed on ITS id and recorded
 *          `cooldown_suppressed` (the per-cadence 30-minute cooldown, asked
 *          before the claim, sees call 2's alert): one send across three calls.
 *   D-08 — the tradie is never texted for a single miss: a second call 31
 *          minutes after the first is not a ring-twice and produces no row.
 *   D-09 — after hours with the switch off, a ring-twice is held like any
 *          non-emergency trigger (research Open Question 6): claimed with
 *          `hold_until` = the window's next opening, nothing sent, and the
 *          release at 08:00 sends it once. With the switch on it goes at once.
 *
 * ── DB-BACKED, AND CI IS THE ONLY PLACE IT RUNS ─────────────────────────────
 *
 * It refuses a non-local target through `tests/helpers/env.ts` and MUST NEVER
 * run through `npm run test:remote`: the hosted Sydney project is production,
 * and this suite arms text-back and SMS identity rows. Those rows are
 * TENANT-SCOPED, carry fiction-block numbers and are deleted BY ID in
 * `afterAll`, first (`messaging_config` has no FK).
 *
 * Both senders record and never dial: the text-back sender is a `TouchSender`
 * with a real provider name (a stub send is recorded `failed`, D-15), and the
 * escalation sender is the tick's injected seam. Clocks are pinned. The
 * ring-twice list and the release are GLOBAL, so every assertion is keyed on
 * this suite's own call and escalation ids. Every number is from ACMA's
 * fiction block (0491 570 7xx), a range no other suite uses.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { SendOutcome, SendRequest, TouchSender } from '../src/core/cadence/sender';
import { runCadenceTick } from '../src/core/cadence/run-tick';
import { buildRingTwiceEscalationSms, ESCALATION_COOLDOWN_MINUTES } from '../src/core/escalation/message';
import { RING_TWICE_WINDOW_MINUTES } from '../src/core/leads/constants';
import { sendTextBack } from '../src/core/leads/text-back';
import type { SendSmsInput, SendSmsResult } from '../src/core/messaging/clicksend-client';
import { closeDb, listUnescalatedRingTwiceCalls, upsertChannelConfig } from '../src/db/repository';

import {
  admin,
  seedMissedCall,
  seedTenant,
  seedTextBackArmed,
  seedTextBackTemplates,
  setTenantAfterHoursEscalation,
  teardownTenants,
} from './helpers/seed';

const MS_PER_MINUTE = 60_000;

/** Wednesday 7 October 2026, 10:00 in Perth (UTC+8, no DST) — inside 08:00–17:00. */
const DAY = new Date('2026-10-07T02:00:00.000Z');
/** Tuesday 6 October 2026, 23:00 in Perth — outside the window. */
const NIGHT = new Date('2026-10-06T15:00:00.000Z');
/** Wednesday 7 October 2026, 08:00 in Perth — the window's next opening from NIGHT. */
const OPEN = new Date('2026-10-07T00:00:00.000Z');

function at(base: Date, ms: number): Date {
  return new Date(base.getTime() + ms);
}

/** The shared SMS number everything leaves from — fiction block. */
const SMS_FROM = '+61491570750';
/** The client's escalation phone, stored compact-local the way the form stores it. */
const ESCALATION_LOCAL = '0491570751';
const ESCALATION_E164 = '+61491570751';

/** One fiction-block mobile per scenario, so `leads_one_open_per_mobile` never meets itself. */
const TWICE_CALLER = '+61491570701';
const SLOW_CALLER = '+61491570702';
const NIGHT_CALLER = '+61491570703';
const SWITCH_ON_CALLER = '+61491570704';

const tenantIds: string[] = [];
const configIds: string[] = [];

/** The text-back sender: records what the CALLER would have received. */
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

/** The escalation seam: records every SMS the TRADIE's phone would have received. */
function recordingEscalationSender(): ((input: SendSmsInput) => Promise<SendSmsResult>) & {
  sent: SendSmsInput[];
} {
  const sent: SendSmsInput[] = [];
  const send = (async (input: SendSmsInput) => {
    sent.push(input);
    return { ok: true, messageId: `esc-${input.customString.slice(0, 8)}`, status: 'SUCCESS' } as const;
  }) as ((input: SendSmsInput) => Promise<SendSmsResult>) & { sent: SendSmsInput[] };
  send.sent = sent;
  return send;
}

type Row = Record<string, unknown>;

async function rowById(table: string, id: string): Promise<Row> {
  const { data, error } = await admin.from(table).select('*').eq('id', id).single();
  if (error) throw new Error(`Reading ${table} failed: ${error.message}`);
  return data as Row;
}

/** Every escalation keyed on one missed call — zero or one, by the unique index. */
async function escalationsForCall(missedCallId: string): Promise<Row[]> {
  const { data, error } = await admin.from('escalations').select('*').eq('missed_call_id', missedCallId);
  if (error) throw new Error(`Reading escalations failed: ${error.message}`);
  return (data ?? []) as Row[];
}

/** Every escalation on one cadence. */
async function escalationsForCadence(cadenceId: string): Promise<Row[]> {
  const { data, error } = await admin.from('escalations').select('*').eq('cadence_id', cadenceId);
  if (error) throw new Error(`Reading escalations failed: ${error.message}`);
  return (data ?? []) as Row[];
}

function ms(value: unknown): number {
  return new Date(String(value)).getTime();
}

/**
 * A completed call from `caller` that ended 15 s before `now` — the shape the
 * status callback leaves, so `sendTextBack` at `now` is inside its window.
 */
async function call(tenantId: string, caller: string, now: Date, afterHours = false): Promise<string> {
  const endedAt = at(now, -15_000);
  return seedMissedCall(
    tenantId,
    {},
    { caller, afterHours, startedAt: at(endedAt, -20_000), endedAt },
  );
}

/** An ARMED client with an escalation phone: text-back on, SMS identity, attested wording. */
async function armedTenant(prefix: string): Promise<string> {
  const tenantId = await seedTenant(prefix);
  tenantIds.push(tenantId);
  const { error } = await admin.from('tenants').update({ escalation_phone: ESCALATION_LOCAL }).eq('id', tenantId);
  if (error) throw new Error(`Setting the escalation phone failed: ${error.message}`);
  configIds.push(await seedTextBackArmed(tenantId));
  // TENANT-SCOPED, fictional, deleted by id in afterAll. See the header.
  const sms = await upsertChannelConfig({ channel: 'sms', tenantId, fromAddress: SMS_FROM, enabled: true });
  configIds.push(sms.id);
  await seedTextBackTemplates(tenantId);
  return tenantId;
}

/** A whole tick at a pinned clock, with only the escalation seam wired. */
function tick(now: Date, escalationSender: ReturnType<typeof recordingEscalationSender>) {
  return runCadenceTick({ now, draftClient: null, classifyClient: null, escalationSender });
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

describe('the ring-twice constants', () => {
  it('the window is thirty minutes, and the cooldown that makes call 3 silent is thirty too', () => {
    expect(RING_TWICE_WINDOW_MINUTES).toBe(30);
    expect(ESCALATION_COOLDOWN_MINUTES).toBe(30);
  });
});

describe('inside hours: call 2 escalates once on its own id, call 3 is cooled, a slow second call is nothing (D-07, D-08)', () => {
  let tenantId: string;
  const textBack = new RecordingSender();
  const escalation = recordingEscalationSender();
  let call2: string;
  let call3: string;
  let leadId: string;
  let cadenceId: string;
  let tick2: Awaited<ReturnType<typeof tick>>;
  let tick3: Awaited<ReturnType<typeof tick>>;

  beforeAll(async () => {
    tenantId = await armedTenant('Ring Twice Day');
  }, 60_000);

  it('call 1 is texted back and opens a lead with a live lead cadence', async () => {
    const call1 = await call(tenantId, TWICE_CALLER, DAY);
    expect((await sendTextBack(call1, { now: DAY, getSender: async () => textBack })).kind).toBe('sent');

    const missed = await rowById('missed_calls', call1);
    expect(missed.text_back_route).toBe('lead');
    leadId = String(missed.lead_id);
    cadenceId = String(missed.cadence_id);
    expect((await rowById('leads', leadId)).status).toBe('open');

    // A single miss is never escalated (D-08): call 1 is not on the list.
    const listed = await listUnescalatedRingTwiceCalls(1_000, {
      notBefore: at(DAY, -60 * MS_PER_MINUTE),
      windowMs: RING_TWICE_WINDOW_MINUTES * MS_PER_MINUTE,
    });
    expect(listed.some((r) => r.missedCallId === call1)).toBe(false);
  });

  it('call 2 ten minutes later gets NO second text, and carries the lead and its live cadence', async () => {
    const now = at(DAY, 10 * MS_PER_MINUTE);
    call2 = await call(tenantId, TWICE_CALLER, now);
    expect((await sendTextBack(call2, { now, getSender: async () => textBack })).kind).toBe('skipped');

    const missed = await rowById('missed_calls', call2);
    expect(missed.text_back_skip_reason).toBe('recent_text');
    expect(missed.lead_id).toBe(leadId);
    expect(missed.cadence_id).toBe(cadenceId);
    expect(textBack.sent.filter((r) => r.to.address === TWICE_CALLER)).toHaveLength(1);
  });

  it('the tick escalates call 2 once, keyed on call 2’s missed_call_id, to the tradie’s own phone', async () => {
    tick2 = await tick(at(DAY, 11 * MS_PER_MINUTE), escalation);

    const rows = await escalationsForCall(call2);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_id: tenantId,
      missed_call_id: call2,
      inbound_message_id: null,
      cadence_id: cadenceId,
      lead_id: leadId,
      quote_id: null,
      to_address: ESCALATION_E164,
      hold_until: null,
      released_at: null,
      outcome: 'sent',
    });
    expect(tick2.ringTwiceEscalated).toBe(1);
    expect(tick2.ringTwiceHeld).toBe(0);

    const mine = escalation.sent.filter((s) => s.customString === rows[0]!.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.to).toBe(ESCALATION_E164);
    expect(mine[0]!.body).toBe(
      buildRingTwiceEscalationSms({ customerMobile: TWICE_CALLER, minutes: RING_TWICE_WINDOW_MINUTES }).body,
    );
    // The CALLER was sent nothing by the escalation: its only recipient is the tradie.
    expect(escalation.sent.some((s) => s.to === TWICE_CALLER)).toBe(false);
  });

  it('call 3 five minutes later: claimed on call 3’s id, recorded cooldown_suppressed — one send across three calls', async () => {
    const now = at(DAY, 15 * MS_PER_MINUTE);
    call3 = await call(tenantId, TWICE_CALLER, now);
    expect((await sendTextBack(call3, { now, getSender: async () => textBack })).kind).toBe('skipped');
    expect((await rowById('missed_calls', call3)).text_back_skip_reason).toBe('recent_text');

    tick3 = await tick(at(DAY, 16 * MS_PER_MINUTE), escalation);

    const rows = await escalationsForCall(call3);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      missed_call_id: call3,
      cadence_id: cadenceId,
      lead_id: leadId,
      hold_until: null,
      outcome: 'cooldown_suppressed',
      sent_at: null,
    });
    expect(tick3.ringTwiceSuppressed).toBe(1);
    expect(tick3.ringTwiceEscalated).toBe(0);

    // NEVER TWICE: across the three calls, exactly one row was sent.
    const onCadence = await escalationsForCadence(cadenceId);
    expect(onCadence.filter((r) => r.outcome === 'sent')).toHaveLength(1);
    const ids = new Set(onCadence.map((r) => String(r.id)));
    expect(escalation.sent.filter((s) => ids.has(s.customString))).toHaveLength(1);
    // And the caller still got exactly one text, from call 1.
    expect(textBack.sent.filter((r) => r.to.address === TWICE_CALLER)).toHaveLength(1);
  });

  it('a further tick finds nothing new for these calls', async () => {
    await tick(at(DAY, 17 * MS_PER_MINUTE), escalation);
    expect(await escalationsForCall(call2)).toHaveLength(1);
    expect(await escalationsForCall(call3)).toHaveLength(1);
    const ids = new Set((await escalationsForCadence(cadenceId)).map((r) => String(r.id)));
    expect(escalation.sent.filter((s) => ids.has(s.customString))).toHaveLength(1);
  });

  it('a different mobile’s second call 31 minutes after its first produces no row (D-08)', async () => {
    const firstAt = at(DAY, 20 * MS_PER_MINUTE);
    const first = await call(tenantId, SLOW_CALLER, firstAt);
    expect((await sendTextBack(first, { now: firstAt, getSender: async () => textBack })).kind).toBe('sent');

    const secondAt = at(firstAt, 31 * MS_PER_MINUTE);
    const second = await call(tenantId, SLOW_CALLER, secondAt);
    expect((await sendTextBack(second, { now: secondAt, getSender: async () => textBack })).kind).toBe('skipped');
    const missed = await rowById('missed_calls', second);
    // It joined the open lead — the ids are there — but it is not a ring-twice.
    expect(missed.lead_id).not.toBeNull();
    expect(missed.cadence_id).not.toBeNull();

    const result = await tick(at(secondAt, MS_PER_MINUTE), escalation);
    expect(await escalationsForCall(second)).toHaveLength(0);
    expect(await escalationsForCall(first)).toHaveLength(0);
    expect(result.ringTwiceEscalated).toBe(0);
    expect(escalation.sent.some((s) => s.body.includes(SLOW_CALLER))).toBe(false);
  });
});

describe('after hours with the switch off, a ring-twice is held and released once (D-09, Open Question 6)', () => {
  let tenantId: string;
  const textBack = new RecordingSender();
  const escalation = recordingEscalationSender();
  let call2: string;
  let escalationId: string;

  beforeAll(async () => {
    tenantId = await armedTenant('Ring Twice Night');
  }, 60_000);

  it('call 2 at 23:00 is claimed with hold_until = Wednesday 08:00 and nothing is sent', async () => {
    const firstAt = at(NIGHT, -10 * MS_PER_MINUTE);
    const call1 = await call(tenantId, NIGHT_CALLER, firstAt, true);
    expect((await sendTextBack(call1, { now: firstAt, getSender: async () => textBack })).kind).toBe('sent');
    call2 = await call(tenantId, NIGHT_CALLER, NIGHT, true);
    expect((await sendTextBack(call2, { now: NIGHT, getSender: async () => textBack })).kind).toBe('skipped');

    const result = await tick(at(NIGHT, MS_PER_MINUTE), escalation);

    const rows = await escalationsForCall(call2);
    expect(rows).toHaveLength(1);
    escalationId = String(rows[0]!.id);
    expect(rows[0]).toMatchObject({ outcome: null, released_at: null, sent_at: null });
    expect(ms(rows[0]!.hold_until)).toBe(OPEN.getTime());
    expect(result.ringTwiceHeld).toBe(1);
    expect(result.ringTwiceEscalated).toBe(0);
    expect(escalation.sent.filter((s) => s.customString === escalationId)).toHaveLength(0);
  });

  it('the release at 08:00 sends it once, sets released_at, and a further tick sends nothing', async () => {
    const released = await tick(OPEN, escalation);
    const row = await rowById('escalations', escalationId);
    expect(row.outcome).toBe('sent');
    expect(ms(row.released_at)).toBe(OPEN.getTime());
    expect(released.escalationReleased).toBe(1);

    const mine = escalation.sent.filter((s) => s.customString === escalationId);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.to).toBe(ESCALATION_E164);
    expect(mine[0]!.body).toContain(`Call them: ${NIGHT_CALLER}`);

    const again = await tick(at(OPEN, MS_PER_MINUTE), escalation);
    expect(again.escalationReleased).toBe(0);
    expect(escalation.sent.filter((s) => s.customString === escalationId)).toHaveLength(1);
  });
});

describe('after hours with the switch ON, a ring-twice goes at once (D-09)', () => {
  it('claimed with hold_until NULL and sent at 23:01', async () => {
    const tenantId = await armedTenant('Ring Twice Switch On');
    await setTenantAfterHoursEscalation(tenantId, true);
    const textBack = new RecordingSender();
    const escalation = recordingEscalationSender();

    const firstAt = at(NIGHT, -10 * MS_PER_MINUTE);
    const call1 = await call(tenantId, SWITCH_ON_CALLER, firstAt, true);
    expect((await sendTextBack(call1, { now: firstAt, getSender: async () => textBack })).kind).toBe('sent');
    const call2 = await call(tenantId, SWITCH_ON_CALLER, NIGHT, true);
    expect((await sendTextBack(call2, { now: NIGHT, getSender: async () => textBack })).kind).toBe('skipped');

    const result = await tick(at(NIGHT, MS_PER_MINUTE), escalation);

    const rows = await escalationsForCall(call2);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ hold_until: null, outcome: 'sent' });
    expect(result.ringTwiceEscalated).toBe(1);
    expect(result.ringTwiceHeld).toBe(0);
    expect(escalation.sent.filter((s) => s.customString === rows[0]!.id)).toHaveLength(1);
  });
});
