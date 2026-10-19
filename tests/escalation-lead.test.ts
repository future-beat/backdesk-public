/**
 * A HOT LEAD REACHES THE TRADIE — AT ONCE, OR WHEN THE SHOP OPENS — AND NEVER
 * TWICE, ON A REAL DATABASE (Phase 13, plan 13-06; D-08, D-09, LEAD-03).
 *
 * What this suite proves, through whole `runCadenceTick` runs at pinned clocks:
 *
 *   D-09 THE HOLD — a hot (`is_hot`) lead reply of urgency `this_week` at
 *          Tuesday 23:00 Perth for a client whose after-hours switch is OFF is
 *          CLAIMED with `hold_until` = Wednesday 08:00, outcome NULL,
 *          `released_at` NULL, nothing sent (`escalationHeld` 1). A tick at
 *          07:59 sends nothing; the tick at 08:00 sends exactly one SMS to the
 *          escalation phone with the reply's words, sets `released_at` and
 *          `outcome = 'sent'` (`escalationReleased` 1); a further tick sends
 *          nothing.
 *   D-09 THE SWITCH — the same reply for a client with the switch ON goes at
 *          23:00 with `hold_until` NULL.
 *   D-09 REGARDLESS — emergency urgency, and a `keyword_hot` row with no label
 *          and no model at all, go at 23:00 with the switch off; an emergency
 *          ten minutes after a held reply on the same lead is not cooled down
 *          by the hold, which has reached nobody yet.
 *   D-08 THE RELEASE IS GUARDED — a held row whose lead closed during the hold
 *          is released `lead_closed` with nothing sent
 *          (`escalationReleaseRefused` 1); a lead its own reply's
 *          high-confidence `complaint` label closed in the claiming tick is
 *          still told at 08:00 (closing never cancels the tradie hearing).
 *   WR-01 THE NUMBER AT RELEASE — the escalation phone is re-read at 08:00:
 *          changed overnight, the NEW number is texted and written to
 *          `to_address`; removed overnight, `no_escalation_number` and nothing
 *          sent.
 *   UNCHANGED — a hot lead reply inside hours goes at once.
 *   PITFALL 4 — holds are claims, so held rows leave the hot scan at once and
 *          cannot starve an emergency: 24 held + 1 emergency fill exactly
 *          `HOT_ESCALATION_CAP` in one tick; 25 held + 1 emergency take two
 *          ticks and the emergency goes on the second.
 *
 * ── DB-BACKED, AND CI IS THE ONLY PLACE IT RUNS ─────────────────────────────
 *
 * It refuses a non-local target through `tests/helpers/env.ts` and MUST NEVER
 * run through `npm run test:remote`: the hosted Sydney project is production,
 * and this suite arms tenant-scoped SMS identity rows (deleted BY ID in
 * `afterAll`, first). The escalation sender is the tick's injected seam and
 * dials nothing. The hot scan and the release are GLOBAL, so every row
 * assertion is keyed on this suite's own inbound and escalation ids; the tick
 * COUNTS are asserted exactly, on the footing every tick suite takes — files
 * run serially (`fileParallelism: false`) and each tears down its own rows, so
 * at this suite's clocks the only hot or held rows are its own. Reply bodies
 * are labelled fiction; every number is from ACMA's fiction block
 * (0491 570 8xx), a range no other suite uses.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { runCadenceTick } from '../src/core/cadence/run-tick';
import { closeLead } from '../src/core/leads/close';
import type { SendSmsInput, SendSmsResult } from '../src/core/messaging/clicksend-client';
import { closeDb, HOT_ESCALATION_CAP, upsertChannelConfig } from '../src/db/repository';

import {
  admin,
  seedConnection,
  seedInbound,
  seedLead,
  seedLeadCadence,
  seedTenant,
  setTenantAfterHoursEscalation,
  teardownTenants,
} from './helpers/seed';

const MS_PER_MINUTE = 60_000;

/** Tuesday 6 October 2026, 23:00 in Perth (UTC+8, no DST) — outside 08:00–17:00. */
const NIGHT = new Date('2026-10-06T15:00:00.000Z');
/** Wednesday 7 October 2026, 07:59 in Perth — one minute before the window opens. */
const BEFORE_OPEN = new Date('2026-10-06T23:59:00.000Z');
/** Wednesday 7 October 2026, 08:00 in Perth — the window's next opening from NIGHT. */
const OPEN = new Date('2026-10-07T00:00:00.000Z');
/** Wednesday 7 October 2026, 10:00 in Perth — inside the window. */
const DAY = new Date('2026-10-07T02:00:00.000Z');

function at(base: Date, ms: number): Date {
  return new Date(base.getTime() + ms);
}

/** The shared SMS number the alert leaves from — fiction block. */
const SMS_FROM = '+61491570898';
/** The client's escalation phone, stored compact-local the way the form stores it. */
const ESCALATION_LOCAL = '0491570899';
const ESCALATION_E164 = '+61491570899';

const tenantIds: string[] = [];
const configIds: string[] = [];

/**
 * The tradie's NEW escalation phone, for the WR-01 case (an operator edits the
 * number overnight). Fiction block; never a lead.
 */
const NEW_ESCALATION_LOCAL = '0491570896';
const NEW_ESCALATION_E164 = '+61491570896';

/**
 * A distinct fiction-block mobile per lead, so `leads_one_open_per_mobile`
 * never meets itself: 0491 570 801 upward. The suite opens 61 leads; 896, 898
 * and 899 are the new tradie phone, the from-number and the tradie's phone,
 * never a lead.
 */
let callerSeq = 800;
function nextCaller(): string {
  callerSeq += 1;
  if (callerSeq >= 896) throw new Error('the caller sequence ran into the fixed numbers');
  return `+61491570${String(callerSeq)}`;
}

/** The escalation seam: records every SMS the tradie's phone would have received. */
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
type Sender = ReturnType<typeof recordingEscalationSender>;

async function rowById(table: string, id: string): Promise<Row> {
  const { data, error } = await admin.from(table).select('*').eq('id', id).single();
  if (error) throw new Error(`Reading ${table} failed: ${error.message}`);
  return data as Row;
}

/** The escalation for one reply — `null` before any claim (the unique index allows one). */
async function escalationFor(inboundId: string): Promise<Row | null> {
  const { data, error } = await admin
    .from('escalations')
    .select('*')
    .eq('inbound_message_id', inboundId)
    .maybeSingle();
  if (error) throw new Error(`Reading escalations failed: ${error.message}`);
  return (data as Row | null) ?? null;
}

function ms(value: unknown): number {
  return new Date(String(value)).getTime();
}

/** The SMS this sender sent for one escalation row. */
function sentFor(sender: Sender, escalationId: unknown): SendSmsInput[] {
  return sender.sent.filter((s) => s.customString === escalationId);
}

/**
 * A client the tick visits (a connection row, so the label-effects pass sees
 * it), with an escalation phone and an enabled tenant-scoped SMS identity.
 * The schema's default switch is OFF; `afterHours` turns it on.
 */
async function client(prefix: string, afterHours = false): Promise<string> {
  const tenantId = await seedTenant(prefix);
  tenantIds.push(tenantId);
  await seedConnection(tenantId);
  const { error } = await admin.from('tenants').update({ escalation_phone: ESCALATION_LOCAL }).eq('id', tenantId);
  if (error) throw new Error(`Setting the escalation phone failed: ${error.message}`);
  // TENANT-SCOPED, fictional, deleted by id in afterAll. See the header.
  const sms = await upsertChannelConfig({ channel: 'sms', tenantId, fromAddress: SMS_FROM, enabled: true });
  configIds.push(sms.id);
  if (afterHours) await setTenantAfterHoursEscalation(tenantId, true);
  return tenantId;
}

interface OpenLead {
  leadId: string;
  cadenceId: string;
  caller: string;
}

/**
 * An open lead with a live lead cadence carrying the caller's mobile, opened
 * the evening before the pinned clocks. No touches: a touchless cadence is
 * never "done" (`completeWhereAllTouchesDone`), so no sweep closes the lead
 * under the case.
 */
async function openLead(tenantId: string): Promise<OpenLead> {
  const caller = nextCaller();
  const openedAt = at(NIGHT, -60 * MS_PER_MINUTE).toISOString();
  const leadId = await seedLead(tenantId, {
    contact_mobile: caller,
    first_missed_at: openedAt,
    last_missed_at: openedAt,
  });
  const cadenceId = await seedLeadCadence(tenantId, leadId, {
    contact_mobile: caller,
    anchor_at: openedAt,
  });
  return { leadId, cadenceId, caller };
}

/**
 * A hot reply on a lead cadence, as the inbound door and the classifier leave
 * it. A LABELLED row is written label-less and then labelled in one UPDATE
 * with its urgency, confidence and `is_hot` together — 0040's
 * `inbound_messages_lead_label_has_urgency` refuses a label without an
 * urgency on a lead row, which is exactly what `writeClassification` writes.
 */
async function hotReply(
  tenantId: string,
  lead: OpenLead,
  reply: {
    body: string;
    receivedAt: Date;
    label?: string;
    urgency?: string;
    confidence?: string;
    keywordHot?: boolean;
  },
): Promise<string> {
  const id = await seedInbound(tenantId, {
    cadenceId: lead.cadenceId,
    quoteId: null,
    leadId: lead.leadId,
    receivedAt: reply.receivedAt.toISOString(),
    fromAddress: lead.caller,
    body: reply.body,
    keywordHot: reply.keywordHot ?? false,
  });
  if (reply.label !== undefined) {
    const { error } = await admin
      .from('inbound_messages')
      .update({
        label: reply.label,
        urgency: reply.urgency ?? 'this_week',
        label_confidence: reply.confidence ?? 'high',
        is_hot: true,
      })
      .eq('id', id);
    if (error) throw new Error(`Labelling the reply failed: ${error.message}`);
  }
  return id;
}

/** A whole tick at a pinned clock, with only the escalation seam wired and no model. */
function tick(now: Date, escalationSender: Sender) {
  return runCadenceTick({ now, draftClient: null, classifyClient: null, escalationSender });
}

afterAll(async () => {
  // BY ID and FIRST: an enabled sms row must not outlive the suite.
  if (configIds.length > 0) {
    const { error } = await admin.from('messaging_config').delete().in('id', configIds);
    if (error) throw new Error(`Teardown failed, messaging_config rows left: ${error.message}`);
  }
  if (tenantIds.length > 0) await teardownTenants(tenantIds);
  await closeDb();
}, 60_000);

describe('a hot lead reply at 23:00, switch off: held as a claim, released once at 08:00 (D-09)', () => {
  const sender = recordingEscalationSender();
  const words = 'fiction: can you quote a new side fence this week';
  let inboundId: string;
  let escalationId: string;

  it('is claimed with hold_until = Wednesday 08:00, outcome NULL, released_at NULL, and nothing is sent', async () => {
    const tenantId = await client('Escalation Lead Held');
    const lead = await openLead(tenantId);
    inboundId = await hotReply(tenantId, lead, {
      body: words,
      receivedAt: at(NIGHT, -MS_PER_MINUTE),
      label: 'new_enquiry',
      urgency: 'this_week',
    });

    const result = await tick(NIGHT, sender);

    const row = await escalationFor(inboundId);
    expect(row).not.toBeNull();
    escalationId = String(row!.id);
    expect(row).toMatchObject({
      tenant_id: tenantId,
      cadence_id: lead.cadenceId,
      lead_id: lead.leadId,
      quote_id: null,
      to_address: ESCALATION_E164,
      outcome: null,
      released_at: null,
      sent_at: null,
    });
    expect(ms(row!.hold_until)).toBe(OPEN.getTime());
    expect(result.escalationHeld).toBe(1);
    expect(result.hotEscalated).toBe(0);
    expect(sentFor(sender, escalationId)).toHaveLength(0);
  });

  it('a tick at 07:59 sends nothing and releases nothing', async () => {
    const result = await tick(BEFORE_OPEN, sender);
    const row = await rowById('escalations', escalationId);
    expect(row.released_at).toBeNull();
    expect(row.outcome).toBeNull();
    expect(result.escalationReleased).toBe(0);
    expect(sentFor(sender, escalationId)).toHaveLength(0);
  });

  it('the tick at 08:00 sends exactly one SMS to the escalation phone with the reply’s words, released_at set, outcome sent', async () => {
    const result = await tick(OPEN, sender);
    const row = await rowById('escalations', escalationId);
    expect(row.outcome).toBe('sent');
    expect(ms(row.released_at)).toBe(OPEN.getTime());
    expect(ms(row.sent_at)).toBe(OPEN.getTime());
    expect(result.escalationReleased).toBe(1);

    const mine = sentFor(sender, escalationId);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.to).toBe(ESCALATION_E164);
    expect(mine[0]!.from).toBe(SMS_FROM);
    expect(mine[0]!.body).toContain(words);
    expect(mine[0]!.body).toContain('missed call');
  });

  it('a further tick sends nothing: the release is never repeated', async () => {
    const result = await tick(at(OPEN, MS_PER_MINUTE), sender);
    expect(result.escalationReleased).toBe(0);
    expect(sentFor(sender, escalationId)).toHaveLength(1);
    expect(ms((await rowById('escalations', escalationId)).released_at)).toBe(OPEN.getTime());
  });
});

describe('the switch, emergencies and keywords at 23:00 (D-09)', () => {
  it('the same reply for a client with the switch ON goes at 23:00 with hold_until NULL', async () => {
    const sender = recordingEscalationSender();
    const tenantId = await client('Escalation Lead Switch On', true);
    const lead = await openLead(tenantId);
    const inboundId = await hotReply(tenantId, lead, {
      body: 'fiction: can you quote a new side fence this week',
      receivedAt: at(NIGHT, -MS_PER_MINUTE),
      label: 'new_enquiry',
      urgency: 'this_week',
    });

    const result = await tick(NIGHT, sender);

    const row = await escalationFor(inboundId);
    expect(row).toMatchObject({ hold_until: null, outcome: 'sent', released_at: null });
    expect(result.escalationHeld).toBe(0);
    expect(result.hotEscalated).toBe(1);
    expect(sentFor(sender, row!.id)).toHaveLength(1);
  });

  it('an emergency-urgency reply goes at 23:00 with the switch off', async () => {
    const sender = recordingEscalationSender();
    const tenantId = await client('Escalation Lead Emergency');
    const lead = await openLead(tenantId);
    const inboundId = await hotReply(tenantId, lead, {
      body: 'fiction: water pouring through the ceiling',
      receivedAt: at(NIGHT, -MS_PER_MINUTE),
      label: 'new_enquiry',
      urgency: 'emergency',
      // `isHotLeadReply` puts emergency on is_hot at ANY confidence.
      confidence: 'medium',
    });

    const result = await tick(NIGHT, sender);

    const row = await escalationFor(inboundId);
    expect(row).toMatchObject({ hold_until: null, outcome: 'sent' });
    expect(result.escalationHeld).toBe(0);
    expect(sentFor(sender, row!.id)).toHaveLength(1);
  });

  it('a keyword_hot row with label NULL and no model at all goes at 23:00 — the hot scan read the OR', async () => {
    const sender = recordingEscalationSender();
    const tenantId = await client('Escalation Lead Keyword');
    const lead = await openLead(tenantId);
    const inboundId = await hotReply(tenantId, lead, {
      body: 'fiction: URGENT burst pipe',
      receivedAt: at(NIGHT, -MS_PER_MINUTE),
      keywordHot: true,
    });
    const before = await rowById('inbound_messages', inboundId);
    expect(before).toMatchObject({ keyword_hot: true, is_hot: false, label: null, urgency: null });

    // `classifyClient: null` in `tick`: no model runs before the escalation.
    const result = await tick(NIGHT, sender);

    const row = await escalationFor(inboundId);
    expect(row).toMatchObject({ hold_until: null, outcome: 'sent', lead_id: lead.leadId });
    expect(result.escalationHeld).toBe(0);
    expect(sentFor(sender, row!.id)).toHaveLength(1);
    expect((await rowById('inbound_messages', inboundId)).label).toBeNull();
  });

  it('an emergency ten minutes after a HELD reply on the same lead is not cooled down by the hold; both are told', async () => {
    const sender = recordingEscalationSender();
    const tenantId = await client('Escalation Lead Held Then Emergency');
    const lead = await openLead(tenantId);
    const heldId = await hotReply(tenantId, lead, {
      body: 'fiction: can someone look at the gate this week',
      receivedAt: at(NIGHT, -MS_PER_MINUTE),
      label: 'callback_request',
      urgency: 'this_week',
    });
    await tick(NIGHT, sender);
    const held = await escalationFor(heldId);
    expect(ms(held!.hold_until)).toBe(OPEN.getTime());

    const emergencyAt = at(NIGHT, 10 * MS_PER_MINUTE);
    const emergencyId = await hotReply(tenantId, lead, {
      body: 'fiction: now the gas meter is hissing',
      receivedAt: at(emergencyAt, -30_000),
      label: 'callback_request',
      urgency: 'emergency',
    });
    await tick(emergencyAt, sender);

    const emergency = await escalationFor(emergencyId);
    expect(emergency).toMatchObject({ hold_until: null, outcome: 'sent' });
    expect(sentFor(sender, emergency!.id)).toHaveLength(1);

    // The held one still goes when the window opens: two texts, both true.
    await tick(OPEN, sender);
    expect((await rowById('escalations', String(held!.id))).outcome).toBe('sent');
    expect(sentFor(sender, held!.id)).toHaveLength(1);
  });
});

describe('the release is guarded by the lead (D-08)', () => {
  it('a held row whose lead closed during the hold is released lead_closed, nothing sent', async () => {
    const sender = recordingEscalationSender();
    const tenantId = await client('Escalation Lead Closed In Hold');
    const lead = await openLead(tenantId);
    const inboundId = await hotReply(tenantId, lead, {
      body: 'fiction: please call about a carport',
      receivedAt: at(NIGHT, -MS_PER_MINUTE),
      label: 'callback_request',
      urgency: 'this_week',
    });
    await tick(NIGHT, sender);
    const held = await escalationFor(inboundId);
    expect(ms(held!.hold_until)).toBe(OPEN.getTime());

    // The operator closes it overnight — an hour AFTER the hold was claimed.
    expect((await closeLead(tenantId, lead.leadId, 'operator', at(NIGHT, 60 * MS_PER_MINUTE))).kind).toBe(
      'closed',
    );

    const result = await tick(OPEN, sender);

    const row = await rowById('escalations', String(held!.id));
    expect(row.outcome).toBe('lead_closed');
    expect(ms(row.released_at)).toBe(OPEN.getTime());
    expect(row.sent_at).toBeNull();
    expect(result.escalationReleaseRefused).toBe(1);
    expect(result.escalationReleased).toBe(0);
    expect(sentFor(sender, held!.id)).toHaveLength(0);
  });

  it('a lead its own complaint closed in the claiming tick is still told at 08:00', async () => {
    const sender = recordingEscalationSender();
    const tenantId = await client('Escalation Lead Complaint');
    const lead = await openLead(tenantId);
    const inboundId = await hotReply(tenantId, lead, {
      body: 'fiction: the tap you fitted is leaking again',
      receivedAt: at(NIGHT, -MS_PER_MINUTE),
      label: 'complaint',
      urgency: 'this_week',
      confidence: 'high',
    });

    // The label-effects pass closes the lead THIS tick, ahead of the escalation
    // pass (D-11); the escalation pass still claims the reply — held.
    const night = await tick(NIGHT, sender);
    expect(night.leadsClosedByLabel).toBeGreaterThanOrEqual(1);
    const lead_ = await rowById('leads', lead.leadId);
    expect(lead_).toMatchObject({ status: 'closed', closed_reason: 'complaint' });
    const held = await escalationFor(inboundId);
    expect(ms(held!.hold_until)).toBe(OPEN.getTime());
    expect(ms(lead_.closed_at)).toBe(ms(held!.created_at));

    await tick(OPEN, sender);
    const row = await rowById('escalations', String(held!.id));
    expect(row.outcome).toBe('sent');
    expect(sentFor(sender, held!.id)).toHaveLength(1);
  });
});

// 2026-10-09 (13-REVIEW WR-01): the release used to text the `to_address`
// the hold recorded at 23:00. The operator's one reason to change the number
// overnight is that it was wrong, so the release re-reads it.
describe('the release texts the escalation phone as it stands at 08:00 (WR-01)', () => {
  async function heldAtNight(prefix: string, sender: Sender): Promise<{ tenantId: string; escalationId: string }> {
    const tenantId = await client(prefix);
    const lead = await openLead(tenantId);
    const inboundId = await hotReply(tenantId, lead, {
      body: 'fiction: could you price a pergola',
      receivedAt: at(NIGHT, -MS_PER_MINUTE),
      label: 'new_enquiry',
      urgency: 'this_week',
    });
    await tick(NIGHT, sender);
    const held = await escalationFor(inboundId);
    expect(held).toMatchObject({ to_address: ESCALATION_E164, outcome: null });
    expect(ms(held!.hold_until)).toBe(OPEN.getTime());
    return { tenantId, escalationId: String(held!.id) };
  }

  async function setPhone(tenantId: string, phone: string | null): Promise<void> {
    const { error } = await admin.from('tenants').update({ escalation_phone: phone }).eq('id', tenantId);
    if (error) throw new Error(`Changing the escalation phone failed: ${error.message}`);
  }

  it('changed at 00:00: the 08:00 release texts the NEW number and records it as to_address', async () => {
    const sender = recordingEscalationSender();
    const { tenantId, escalationId } = await heldAtNight('Escalation Lead Phone Changed', sender);

    await setPhone(tenantId, NEW_ESCALATION_LOCAL);
    const result = await tick(OPEN, sender);

    const row = await rowById('escalations', escalationId);
    expect(row).toMatchObject({ outcome: 'sent', to_address: NEW_ESCALATION_E164 });
    expect(result.escalationReleased).toBe(1);
    const mine = sentFor(sender, escalationId);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.to).toBe(NEW_ESCALATION_E164);
    expect(sender.sent.some((s) => s.to === ESCALATION_E164)).toBe(false);
  });

  it('removed at 00:00: released no_escalation_number, nothing sent', async () => {
    const sender = recordingEscalationSender();
    const { tenantId, escalationId } = await heldAtNight('Escalation Lead Phone Removed', sender);

    await setPhone(tenantId, null);
    const result = await tick(OPEN, sender);

    const row = await rowById('escalations', escalationId);
    expect(row.outcome).toBe('no_escalation_number');
    expect(ms(row.released_at)).toBe(OPEN.getTime());
    expect(row.sent_at).toBeNull();
    expect(result.escalationReleaseRefused).toBe(1);
    expect(result.escalationReleased).toBe(0);
    expect(sentFor(sender, escalationId)).toHaveLength(0);
  });
});

describe('inside hours nothing changes', () => {
  it('a hot lead reply at 10:00 goes at once, hold_until NULL', async () => {
    const sender = recordingEscalationSender();
    const tenantId = await client('Escalation Lead Day');
    const lead = await openLead(tenantId);
    const inboundId = await hotReply(tenantId, lead, {
      body: 'fiction: yes please, Thursday works',
      receivedAt: at(DAY, -MS_PER_MINUTE),
      label: 'new_enquiry',
      urgency: 'flexible',
    });

    const result = await tick(DAY, sender);

    const row = await escalationFor(inboundId);
    expect(row).toMatchObject({ hold_until: null, released_at: null, outcome: 'sent' });
    expect(result.escalationHeld).toBe(0);
    expect(sentFor(sender, row!.id)).toHaveLength(1);
  });
});

/**
 * LAST IN THE FILE, ON PURPOSE: these leave held rows behind (hold_until
 * Wednesday 08:00) for the teardown, and any earlier tick at 08:00 or later
 * would release them.
 */
describe('holds are claims, so a held backlog cannot starve an emergency (research Pitfall 4)', () => {
  /** `count` held-eligible replies, then one emergency received LAST, each on its own lead. */
  async function backlog(prefix: string, count: number): Promise<{ held: string[]; emergency: string }> {
    const tenantId = await client(prefix);
    const held: string[] = [];
    for (let i = 0; i < count; i += 1) {
      // Their own leads, so the per-cadence cooldown never touches them.
      const lead = await openLead(tenantId);
      held.push(
        await hotReply(tenantId, lead, {
          body: `fiction: quote for retaining wall ${i}`,
          receivedAt: at(NIGHT, -(count + 1 - i) * 1_000),
          label: 'new_enquiry',
          urgency: 'this_week',
        }),
      );
    }
    const lead = await openLead(tenantId);
    const emergency = await hotReply(tenantId, lead, {
      body: 'fiction: sparks from the switchboard',
      receivedAt: at(NIGHT, -500),
      label: 'new_enquiry',
      urgency: 'emergency',
    });
    return { held, emergency };
  }

  it('the cap is twenty-five', () => {
    expect(HOT_ESCALATION_CAP).toBe(25);
  });

  it('24 held + 1 emergency received last: one tick holds the 24 and sends the emergency — exactly HOT_ESCALATION_CAP rows', async () => {
    const sender = recordingEscalationSender();
    const { held, emergency } = await backlog('Escalation Lead Cap 24', HOT_ESCALATION_CAP - 1);
    expect(held.length + 1).toBe(HOT_ESCALATION_CAP);

    const result = await tick(NIGHT, sender);

    expect(result.escalationHeld).toBe(HOT_ESCALATION_CAP - 1);
    expect(result.hotEscalated).toBe(1);
    for (const id of held) {
      const row = await escalationFor(id);
      expect(row).toMatchObject({ outcome: null, released_at: null });
      expect(ms(row!.hold_until)).toBe(OPEN.getTime());
      expect(sentFor(sender, row!.id)).toHaveLength(0);
    }
    const sent = await escalationFor(emergency);
    expect(sent).toMatchObject({ hold_until: null, outcome: 'sent' });
    expect(sentFor(sender, sent!.id)).toHaveLength(1);
  });

  it('25 held + 1 emergency: tick 1 holds 25 and sends nothing (the cap is full); tick 2 at 23:01 reaches the emergency', async () => {
    const sender = recordingEscalationSender();
    const { held, emergency } = await backlog('Escalation Lead Cap 25', HOT_ESCALATION_CAP);

    const first = await tick(NIGHT, sender);
    expect(first.escalationHeld).toBe(HOT_ESCALATION_CAP);
    expect(first.hotEscalated).toBe(0);
    expect(await escalationFor(emergency)).toBeNull();
    for (const id of held) {
      expect(ms((await escalationFor(id))!.hold_until)).toBe(OPEN.getTime());
    }

    // The 25 held rows are no longer unescalated — the hold was a claim — so
    // the next tick's scan reaches the emergency. Recomputing "is it held?"
    // every tick would have left them in front of it until morning.
    const second = await tick(at(NIGHT, MS_PER_MINUTE), sender);
    expect(second.hotEscalated).toBe(1);
    expect(second.escalationHeld).toBe(0);
    const sent = await escalationFor(emergency);
    expect(sent).toMatchObject({ hold_until: null, outcome: 'sent' });
    expect(sentFor(sender, sent!.id)).toHaveLength(1);
    expect(sender.sent).toHaveLength(1);
  });
});
