/**
 * A REPLY TO A MISSED-CALL TEXT-BACK, END TO END ON A LEAD CADENCE (Phase 12,
 * plan 12-05; D-18).
 *
 * A text-back starts a LEAD cadence: no quote, no job, no `sm8_job_uuid`.
 * When the caller writes back, every stage built for quote cadences must be
 * correct for a cadence with no quote — and a hot reply must reach the tradie
 * NOW, through today's classifier and the existing escalation pass, not wait
 * for Phase 13's lead rules:
 *
 *   inbound   — threads to the lead cadence (`lead_id` set, `quote_id` NULL)
 *               and pauses it through the existing reply pause;
 *   classify  — today's classifier labels it (it reads only the reply body);
 *   escalate  — a hot one is claimed with `quote_id` NULL and the lead id, and
 *               the tradie's SMS says "missed call" where a quote would go;
 *   STOP      — suppresses and stops the lead cadence exactly as a quote one;
 *   ambiguous — a number live at two clients is still recorded ambiguous and
 *               pauses nothing.
 *
 * 2026-10 (Phase 13, plan 13-04) extends it to the lead vocabulary and the
 * lead rules: the door's `keyword_hot` mark (D-06), the lead labels with an
 * urgency (D-05), the lead hot rule (D-07), the label-effects pass closing a
 * lead on a HIGH-confidence closing label (D-11), the single-tenant
 * quote-wins tie-break (D-10), and the operator opt-out in both orders. The
 * fake model answers BY A TOKEN IN THE BODY, so the global classification pass
 * labels this suite's rows as each case needs and every other row `other`/low
 * — never a closing label, never hot.
 *
 * `handleInboundSms` and `runCadenceTick` run FOR REAL against a migrated
 * database. Only the model client and the escalation sender are injected, so
 * nothing calls a model and nothing is dialled.
 *
 * ── DB-BACKED, AND CI IS THE ONLY PLACE IT RUNS ─────────────────────────────
 *
 * It refuses a non-local target through `tests/helpers/env.ts` and MUST NEVER
 * run through `npm run test:remote`: the hosted Sydney project is production,
 * and this suite arms text-back and SMS identity rows. Each armed tenant's
 * `text_back` and tenant-scoped `sms` rows are deleted BY ID in `afterAll`,
 * first. Every number is from ACMA's fiction block (0491 570 6xx).
 *
 * The classification and escalation passes are GLOBAL, so every assertion is
 * keyed on THIS suite's inbound and escalation ids, never on a total.
 */
import { readFileSync } from 'node:fs';

import type Anthropic from '@anthropic-ai/sdk';
import { afterAll, describe, expect, it, vi } from 'vitest';

import type { SendOutcome, SendRequest, TouchSender } from '../src/core/cadence/sender';
import { runCadenceTick } from '../src/core/cadence/run-tick';
import {
  LEAD_CLASSIFIER_INSTRUCTIONS,
  type ClassifyClient,
} from '../src/core/classification/classify-inbound';
import type { SendSmsInput, SendSmsResult } from '../src/core/messaging/clicksend-client';
import { handleInboundSms } from '../src/core/messaging/inbound';
import { sendTextBack } from '../src/core/leads/text-back';
import {
  closeDb,
  countColdLeadRepliesSince,
  listInboundNeedingTriage,
  markInboundTriaged,
  upsertChannelConfig,
} from '../src/db/repository';

import {
  admin,
  seedCadence,
  seedConnection,
  seedLead,
  seedLeadCadence,
  seedMissedCall,
  seedQuotes,
  seedTenant,
  seedTextBackArmed,
  seedTextBackTemplates,
  setTenantAfterHoursEscalation,
  teardownTenants,
} from './helpers/seed';

// ── THE OPERATOR'S SUPPRESS ACTION, REACHED THE WAY THE INBOX REACHES IT ─────
//
// `killContactAction` is a server action: its gate reads the session and the
// operator's tenant through `@/lib/supabase/server`, and it revalidates paths
// through `next/cache`. Both are stubbed exactly as
// `tests/quote-draft-approval.test.ts` stubs them — an operator who is a
// member of every tenant — so what runs for real is everything after the
// gate: `killContact`'s suppression and stop against this database.
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getClaims: async () => ({ data: { claims: { sub: 'operator-1' } } }) },
    from: () => ({
      select: () => ({
        eq: (_column: string, value: string) => ({
          maybeSingle: async () => ({
            data: { id: value, name: 'Lead Reply Test Co', timezone: 'Australia/Perth' },
            error: null,
          }),
        }),
      }),
    }),
  }),
}));

const { killContactAction } = await import('@/app/(console)/clients/[id]/quotes/[quoteId]/actions');
const { BLANK_CONTROL_STATE, KILL_ALREADY_STOPPED_MESSAGE, KILL_SUCCESS_MESSAGE } = await import(
  '@/app/(console)/clients/[id]/quotes/[quoteId]/action-state'
);

/** The shared SMS number the text leaves from — fiction block. */
const SMS_FROM = '+61491570150';
/** The client's escalation phone, stored compact-local the way the form stores it. */
const ESCALATION_LOCAL = '0491570152';
const ESCALATION_E164 = '+61491570152';

const tenantIds: string[] = [];
const configIds: string[] = [];

/** A distinct fiction-block mobile per scenario. */
let callerSeq = 600;
function nextCaller(): string {
  callerSeq += 1;
  return `+61491570${String(callerSeq).padStart(3, '0')}`;
}

class RecordingSender implements TouchSender {
  readonly provider = 'clicksend';
  readonly sent: SendRequest[] = [];
  async send(request: SendRequest): Promise<SendOutcome> {
    this.sent.push(request);
    return { kind: 'sent', provider: 'clicksend', providerMessageId: `cs-${request.ledgerId.slice(0, 8)}` };
  }
}

/**
 * The classifier's model, faked BY BODY (2026-10, plan 13-04).
 *
 * The classification pass is GLOBAL: it labels every unlabelled row in the
 * database, not just this suite's. So the fake answers by a token in the
 * fenced body — a row carrying `token` gets `answers[token]` — and every other
 * row gets the cold, non-closing default for its vocabulary (lead or quote,
 * read off the system block the classifier chose). No row this suite does not
 * own can be labelled hot or closing by it.
 */
function classifyingByBody(
  answers: Record<string, Record<string, string>>,
): ClassifyClient & { calls: number } {
  const client = {
    calls: 0,
    messages: {
      parse: async (request: Anthropic.MessageCreateParamsNonStreaming) => {
        client.calls += 1;
        const [turn] = request.messages;
        const text = typeof turn?.content === 'string' ? turn.content : JSON.stringify(turn?.content);
        for (const [token, answer] of Object.entries(answers)) {
          if (text.includes(token)) return { parsed_output: answer };
        }
        return {
          parsed_output:
            request.system === LEAD_CLASSIFIER_INSTRUCTIONS
              ? { label: 'other', urgency: 'unknown', confidence: 'low' }
              : { label: 'other', confidence: 'low' },
        };
      },
    },
  };
  return client;
}

/** A per-case token, so the fake model can tell this suite's rows apart. */
let tokenSeq = 0;
function token(name: string): string {
  tokenSeq += 1;
  return `zz${name}${tokenSeq}zz`;
}

/**
 * Tick until every one of `inboundIds` carries a label (at most ten ticks).
 *
 * The classification pass takes the oldest twenty unlabelled rows a minute,
 * so on a CI database other suites' rows can be ahead of ours. Returns every
 * tick's result so a case can sum a count across them.
 */
async function tickUntilLabelled(
  inboundIds: string[],
  options: Parameters<typeof runCadenceTick>[0],
): Promise<Array<Awaited<ReturnType<typeof runCadenceTick>>>> {
  const results: Array<Awaited<ReturnType<typeof runCadenceTick>>> = [];
  for (let attempt = 0; attempt < 10; attempt += 1) {
    results.push(await runCadenceTick({ now: new Date(), draftClient: null, ...options }));
    const { data, error } = await admin.from('inbound_messages').select('id, label').in('id', inboundIds);
    if (error) throw new Error(`Reading inbound_messages failed: ${error.message}`);
    if ((data ?? []).length === inboundIds.length && (data ?? []).every((r) => r.label !== null)) {
      return results;
    }
  }
  throw new Error('This suite\'s replies were not labelled within ten ticks.');
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

/**
 * An ARMED client with an escalation phone.
 *
 * 2026-10-08 (13-07 CI gate): and a ServiceM8 connection row. Arming is gated
 * on `sm8Connected` (src/core/onboarding/arming.ts), so every armed client in
 * production has one, and `forAllTenants_cadenceTick` INNER JOINs it: without
 * it the label-effects pass and the lead-close sweep never visit this client,
 * and the closing-label cases saw an open lead. Same fixture as
 * escalation-lead's `client` and lead-cadence-active's `tickableTenant`.
 */
async function armedTenant(prefix: string): Promise<string> {
  const tenantId = await seedTenant(prefix);
  tenantIds.push(tenantId);
  await seedConnection(tenantId);
  const { error } = await admin.from('tenants').update({ escalation_phone: ESCALATION_LOCAL }).eq('id', tenantId);
  if (error) throw new Error(`Setting the escalation phone failed: ${error.message}`);
  configIds.push(await seedTextBackArmed(tenantId));
  const sms = await upsertChannelConfig({ channel: 'sms', tenantId, fromAddress: SMS_FROM, enabled: true });
  configIds.push(sms.id);
  await seedTextBackTemplates(tenantId);
  return tenantId;
}

/**
 * A real text-back: an armed client, a missed call, `sendTextBack` — so the
 * lead, the lead cadence and its three touches are the ones production makes.
 */
async function textedBack(prefix: string): Promise<{
  tenantId: string;
  caller: string;
  leadId: string;
  cadenceId: string;
}> {
  const tenantId = await armedTenant(prefix);
  const caller = nextCaller();
  const now = new Date();
  const endedAt = new Date(now.getTime() - 15_000);
  const missedCallId = await seedMissedCall(
    tenantId,
    {},
    { caller, afterHours: false, startedAt: new Date(endedAt.getTime() - 20_000), endedAt },
  );
  expect((await sendTextBack(missedCallId, { now, getSender: async () => new RecordingSender() })).kind).toBe('sent');
  const missed = await row('missed_calls', missedCallId);
  expect(missed.text_back_route).toBe('lead');
  return {
    tenantId,
    caller,
    leadId: missed.lead_id as string,
    cadenceId: missed.cadence_id as string,
  };
}

async function row(table: string, id: string): Promise<Record<string, unknown>> {
  const { data, error } = await admin.from(table).select('*').eq('id', id).single();
  if (error) throw new Error(`Reading ${table} failed: ${error.message}`);
  return data as Record<string, unknown>;
}

async function rows(table: string, column: string, value: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await admin.from(table).select('*').eq(column, value);
  if (error) throw new Error(`Reading ${table} failed: ${error.message}`);
  return (data ?? []) as Array<Record<string, unknown>>;
}

afterAll(async () => {
  // BY ID and FIRST: an enabled text_back or sms row must not outlive the suite.
  if (configIds.length > 0) {
    const { error } = await admin.from('messaging_config').delete().in('id', configIds);
    if (error) throw new Error(`Teardown failed, messaging_config rows left: ${error.message}`);
  }
  if (tenantIds.length > 0) await teardownTenants(tenantIds);
  await closeDb();
});

describe('a reply to a text-back on a lead cadence (D-18)', () => {
  it('threads to the lead cadence with lead_id set and quote_id NULL, and pauses it (customer_reply)', async () => {
    const { tenantId, caller, leadId, cadenceId } = await textedBack('Lead Reply Thread');

    const result = await handleInboundSms({
      from: caller,
      to: SMS_FROM,
      body: 'Yes please, can you come Thursday?',
      providerMessageId: null,
    });

    expect(result.kind).toBe('reply_threaded');
    const inbound = await row('inbound_messages', result.inboundId);
    expect(inbound).toMatchObject({
      attribution: 'threaded',
      tenant_id: tenantId,
      cadence_id: cadenceId,
      lead_id: leadId,
      quote_id: null,
      is_stop: false,
    });
    if (result.kind === 'reply_threaded') expect(result.pause).toBe('paused');

    const cadence = await row('cadences', cadenceId);
    expect(cadence.kind).toBe('lead');
    expect(cadence.status).toBe('paused');
    expect(cadence.pause_reason).toBe('customer_reply');
  });

  // 2026-10 (Phase 13, 13-02 → 13-04): RESTORED. 13-02 skipped this case
  // because 0040's by-kind `inbound_messages_label_known` refuses a QUOTE label
  // on a row with `lead_id` set, and the classifier had no lead arm. 13-04
  // gave it one: the same case, in the lead vocabulary — `callback_request`,
  // `this_week`, high confidence, which D-07 makes hot. The escalation
  // assertions are unchanged in intent. The client's after-hours switch is ON
  // so the case does not depend on the CI clock once 13-06's D-09 hold lands.
  it('a full tick classifies it in the lead vocabulary and escalates a hot one: quote_id NULL, lead_id set, "missed call" in the SMS', async () => {
    const { tenantId, caller, leadId, cadenceId } = await textedBack('Lead Reply Hot');
    await setTenantAfterHoursEscalation(tenantId, true);
    const marker = token('hot');
    const reply = await handleInboundSms({
      from: caller,
      to: SMS_FROM,
      body: `Yes please call me back today ${marker}`,
      providerMessageId: null,
    });
    expect(reply.kind).toBe('reply_threaded');

    const classify = classifyingByBody({
      [marker]: { label: 'callback_request', urgency: 'this_week', confidence: 'high' },
    });
    const sender = recordingEscalationSender();

    // Whole ticks, not the two passes alone: nothing in them may throw on a
    // cadence with no quote.
    const results = await tickUntilLabelled([reply.inboundId], {
      classifyClient: classify,
      escalationSender: sender,
    });
    expect(results.reduce((sum, r) => sum + r.hotEscalated, 0)).toBeGreaterThanOrEqual(1);
    expect(classify.calls).toBeGreaterThanOrEqual(1);

    // Classified in the LEAD vocabulary, with its urgency.
    const inbound = await row('inbound_messages', reply.inboundId);
    expect(inbound).toMatchObject({
      label: 'callback_request',
      urgency: 'this_week',
      label_confidence: 'high',
      is_hot: true,
      keyword_hot: false,
    });

    // An open label: the lead stays open, its cadence paused by the reply.
    expect(await row('leads', leadId)).toMatchObject({ status: 'open', closed_reason: null });
    expect(await row('cadences', cadenceId)).toMatchObject({ status: 'paused', pause_reason: 'customer_reply' });

    // One escalation, on the lead, with no quote.
    const escalations = await rows('escalations', 'inbound_message_id', reply.inboundId);
    expect(escalations).toHaveLength(1);
    expect(escalations[0]).toMatchObject({
      tenant_id: tenantId,
      cadence_id: cadenceId,
      quote_id: null,
      lead_id: leadId,
      missed_call_id: null,
      inbound_message_id: reply.inboundId,
      to_address: ESCALATION_E164,
      outcome: 'sent',
    });

    // Exactly one SMS for it, to the tradie, naming the missed call.
    const mine = sender.sent.filter((input) => input.customString === escalations[0]!.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.to).toBe(ESCALATION_E164);
    expect(mine[0]!.body).toContain('"missed call"');
    expect(mine[0]!.body).toContain('Yes please call me back today');
    expect(mine[0]!.body.endsWith(`Call them: ${caller}`)).toBe(true);
  });

  it('STOP on a lead cadence suppresses the caller and stops the cadence, skipping touches 2 and 3', async () => {
    const { tenantId, caller, cadenceId } = await textedBack('Lead Reply Stop');

    const result = await handleInboundSms({ from: caller, to: SMS_FROM, body: 'STOP', providerMessageId: null });

    expect(result.kind).toBe('stop_threaded');
    const inbound = await row('inbound_messages', result.inboundId);
    expect(inbound).toMatchObject({ is_stop: true, attribution: 'threaded', quote_id: null, cadence_id: cadenceId });

    const { data: suppressed, error } = await admin
      .from('suppressed_contacts')
      .select('channel, address')
      .eq('tenant_id', tenantId)
      .eq('channel', 'sms');
    if (error) throw new Error(`Reading suppressed_contacts failed: ${error.message}`);
    expect(suppressed).toEqual([{ channel: 'sms', address: caller }]);

    const cadence = await row('cadences', cadenceId);
    expect(cadence.status).toBe('stopped');

    const { data: touches, error: touchError } = await admin
      .from('cadence_touches')
      .select('touch_number, status')
      .eq('cadence_id', cadenceId)
      .order('touch_number');
    if (touchError) throw new Error(`Reading touches failed: ${touchError.message}`);
    expect(touches).toEqual([
      { touch_number: 1, status: 'sent' },
      { touch_number: 2, status: 'skipped' },
      { touch_number: 3, status: 'skipped' },
    ]);
  });

  it('a number live on a quote at one client and a lead at another is still ambiguous, and nothing pauses', async () => {
    const quoteTenant = await seedTenant('Lead Reply Ambiguous Quote');
    const leadTenant = await seedTenant('Lead Reply Ambiguous Lead');
    tenantIds.push(quoteTenant, leadTenant);
    const caller = nextCaller();
    const [quote] = await seedQuotes(quoteTenant, [{ job_description: 'Fence' }]);
    const quoteCadence = await seedCadence(quoteTenant, quote!.id, { contact_mobile: caller });
    const leadId = await seedLead(leadTenant, { contact_mobile: caller });
    const leadCadence = await seedLeadCadence(leadTenant, leadId, { contact_mobile: caller });

    const result = await handleInboundSms({ from: caller, to: SMS_FROM, body: 'Hi, who is this?', providerMessageId: null });

    expect(result.kind).toBe('reply_ambiguous');
    const inbound = await row('inbound_messages', result.inboundId);
    expect(inbound.attribution).toBe('ambiguous');
    expect(inbound.cadence_id).toBeNull();
    expect((await row('cadences', quoteCadence)).status).toBe('active');
    expect((await row('cadences', leadCadence)).status).toBe('active');
    // 2026-10 (Phase 13, 13-04, D-10): the quote-wins tie-break never reaches
    // across tenants — the lead at the other client stays open.
    expect(await row('leads', leadId)).toMatchObject({ status: 'open', closed_reason: null });
  });
});

/* ------------------------------------------------------------------------- *
 * Phase 13 (plan 13-04): STOP first, the keyword rule, the lead vocabulary,
 * the label effects, the quote-wins tie-break and the operator opt-out
 * ------------------------------------------------------------------------- */

/** A quote cadence for `caller` at `tenantId`, live (`active`). */
async function liveQuoteCadence(tenantId: string, caller: string): Promise<string> {
  const [quote] = await seedQuotes(tenantId, [{ job_description: 'Hot water unit' }]);
  return seedCadence(tenantId, quote!.id, { contact_mobile: caller });
}

describe('the door: STOP first, then the keyword rule, lead replies only (D-06)', () => {
  it('"URGENT no power" on a lead cadence is written keyword_hot, is_hot false, before any model', async () => {
    const { leadId, caller } = await textedBack('Lead Reply Keyword');

    const result = await handleInboundSms({
      from: caller,
      to: SMS_FROM,
      body: 'URGENT no power at the shop',
      providerMessageId: null,
    });

    expect(result.kind).toBe('reply_threaded');
    expect(await row('inbound_messages', result.inboundId)).toMatchObject({
      lead_id: leadId,
      keyword_hot: true,
      is_hot: false,
      label: null,
      urgency: null,
    });
  });

  it('a keyword-hot lead reply escalates in a tick with NO model at all', async () => {
    const { tenantId, caller, leadId, cadenceId } = await textedBack('Lead Reply Keyword Tick');
    const reply = await handleInboundSms({
      from: caller,
      to: SMS_FROM,
      body: 'burst pipe in the laundry, water everywhere',
      providerMessageId: null,
    });
    const sender = recordingEscalationSender();

    // `classifyClient: null` — the classification pass does not run at all, so
    // the escalation below is the door's keyword mark and nothing else. The
    // hot scan is global and oldest-first, so tick until ours is claimed.
    let escalations: Array<Record<string, unknown>> = [];
    for (let attempt = 0; attempt < 5 && escalations.length === 0; attempt += 1) {
      await runCadenceTick({ now: new Date(), draftClient: null, classifyClient: null, escalationSender: sender });
      escalations = await rows('escalations', 'inbound_message_id', reply.inboundId);
    }

    expect(await row('inbound_messages', reply.inboundId)).toMatchObject({ keyword_hot: true, label: null });
    expect(escalations).toHaveLength(1);
    expect(escalations[0]).toMatchObject({
      tenant_id: tenantId,
      cadence_id: cadenceId,
      lead_id: leadId,
      quote_id: null,
      outcome: 'sent',
    });
    expect(sender.sent.filter((input) => input.customString === escalations[0]!.id)).toHaveLength(1);
  });

  it('the same body on a QUOTE cadence is never keyword-scanned', async () => {
    const tenantId = await seedTenant('Lead Reply Keyword Quote');
    tenantIds.push(tenantId);
    const caller = nextCaller();
    const cadenceId = await liveQuoteCadence(tenantId, caller);

    const result = await handleInboundSms({
      from: caller,
      to: SMS_FROM,
      body: 'URGENT no power at the shop',
      providerMessageId: null,
    });

    expect(result.kind).toBe('reply_threaded');
    expect(await row('inbound_messages', result.inboundId)).toMatchObject({
      cadence_id: cadenceId,
      lead_id: null,
      keyword_hot: false,
    });
  });

  it('"STOP" on a lead cadence suppresses, and the keyword rule never wrote anything', async () => {
    const { caller, cadenceId } = await textedBack('Lead Reply Keyword Stop');

    const result = await handleInboundSms({ from: caller, to: SMS_FROM, body: 'STOP', providerMessageId: null });

    expect(result.kind).toBe('stop_threaded');
    expect(await row('inbound_messages', result.inboundId)).toMatchObject({
      is_stop: true,
      keyword_hot: false,
      is_hot: false,
    });
    expect((await row('cadences', cadenceId)).status).toBe('stopped');
  });
});

describe('a lead reply is labelled in the lead vocabulary, and a closing label closes the lead (D-05/D-07/D-11)', () => {
  it('complaint / this_week / HIGH: labelled hot, and the label pass closes the lead complaint, cadence stopped lead_closed', async () => {
    const { leadId, caller, cadenceId } = await textedBack('Lead Reply Complaint High');
    const marker = token('complaint');
    const reply = await handleInboundSms({
      from: caller,
      to: SMS_FROM,
      body: `You never turned up last time ${marker}`,
      providerMessageId: null,
    });

    const results = await tickUntilLabelled([reply.inboundId], {
      classifyClient: classifyingByBody({
        [marker]: { label: 'complaint', urgency: 'this_week', confidence: 'high' },
      }),
    });

    expect(await row('inbound_messages', reply.inboundId)).toMatchObject({
      label: 'complaint',
      urgency: 'this_week',
      label_confidence: 'high',
      is_hot: true,
    });
    const lead = await row('leads', leadId);
    expect(lead).toMatchObject({ status: 'closed', closed_reason: 'complaint' });
    expect(lead.closed_at).not.toBeNull();
    expect(await row('cadences', cadenceId)).toMatchObject({ status: 'stopped', stop_reason: 'lead_closed' });
    expect(results.reduce((sum, r) => sum + r.leadsClosedByLabel, 0)).toBeGreaterThanOrEqual(1);
  });

  it('complaint at MEDIUM confidence leaves the lead open and paused, for the operator', async () => {
    const { leadId, caller, cadenceId } = await textedBack('Lead Reply Complaint Medium');
    const marker = token('complaintmedium');
    const reply = await handleInboundSms({
      from: caller,
      to: SMS_FROM,
      body: `not happy I think ${marker}`,
      providerMessageId: null,
    });

    await tickUntilLabelled([reply.inboundId], {
      classifyClient: classifyingByBody({
        [marker]: { label: 'complaint', urgency: 'this_week', confidence: 'medium' },
      }),
    });

    expect(await row('inbound_messages', reply.inboundId)).toMatchObject({
      label: 'complaint',
      label_confidence: 'medium',
      is_hot: false,
    });
    expect(await row('leads', leadId)).toMatchObject({ status: 'open', closed_reason: null });
    expect(await row('cadences', cadenceId)).toMatchObject({ status: 'paused', pause_reason: 'customer_reply' });
  });

  it('new_enquiry / flexible / HIGH stays open and hot, and a quote reply in the SAME tick keeps the quote vocabulary with NULL urgency', async () => {
    const { leadId, caller, cadenceId } = await textedBack('Lead Reply Enquiry');
    const leadMarker = token('enquiry');
    const leadReply = await handleInboundSms({
      from: caller,
      to: SMS_FROM,
      body: `Can you quote a new downlight ${leadMarker}`,
      providerMessageId: null,
    });

    const quoteTenant = await seedTenant('Lead Reply Enquiry Quote');
    tenantIds.push(quoteTenant);
    const quoteCaller = nextCaller();
    const quoteCadence = await liveQuoteCadence(quoteTenant, quoteCaller);
    const quoteMarker = token('quote');
    const quoteReply = await handleInboundSms({
      from: quoteCaller,
      to: SMS_FROM,
      body: `Sounds good, go ahead ${quoteMarker}`,
      providerMessageId: null,
    });
    expect(quoteReply.kind).toBe('reply_threaded');

    await tickUntilLabelled([leadReply.inboundId, quoteReply.inboundId], {
      classifyClient: classifyingByBody({
        [leadMarker]: { label: 'new_enquiry', urgency: 'flexible', confidence: 'high' },
        [quoteMarker]: { label: 'interested', confidence: 'high' },
      }),
    });

    expect(await row('inbound_messages', leadReply.inboundId)).toMatchObject({
      lead_id: leadId,
      label: 'new_enquiry',
      urgency: 'flexible',
      is_hot: true,
    });
    expect(await row('leads', leadId)).toMatchObject({ status: 'open', closed_reason: null });
    expect((await row('cadences', cadenceId)).status).toBe('paused');

    expect(await row('inbound_messages', quoteReply.inboundId)).toMatchObject({
      cadence_id: quoteCadence,
      lead_id: null,
      label: 'interested',
      label_confidence: 'high',
      urgency: null,
      is_hot: true,
      keyword_hot: false,
    });
  });
});

// 2026-10-09 (13-REVIEW CR-01): a confident COLD lead reply had no operator
// surface — no quote page, and the inbox only admitted unsure labels — while
// the digest called it "waiting in the inbox". The inbox's lead arm admits
// every cold lead reply (labelled or not), and the digest counts exactly the
// untriaged ones. The read is called with a cap far above the page size so a
// CI backlog of other suites' rows cannot push this one off the page.
describe('a cold lead reply is the inbox\'s, at any confidence (CR-01, D-08/D-11)', () => {
  const inInbox = async (inboundId: string): Promise<boolean> =>
    (await listInboundNeedingTriage(100_000)).some((r) => r.id === inboundId);
  const coldCount = async (tenantId: string, since: Date): Promise<number> =>
    (await countColdLeadRepliesSince(since)).find((r) => r.tenantId === tenantId)?.count ?? 0;

  it('question / flexible / HIGH: paused, not hot, listed in the inbox, counted by the digest until triaged', async () => {
    const { tenantId, leadId, caller, cadenceId } = await textedBack('Lead Reply Question High');
    const since = new Date(Date.now() - 60_000);
    const marker = token('question');
    const reply = await handleInboundSms({
      from: caller,
      to: SMS_FROM,
      body: `What area do you cover? ${marker}`,
      providerMessageId: null,
    });
    expect(reply.kind).toBe('reply_threaded');

    // Unlabelled — the shape a reply the classifier gave up on keeps for
    // good — and already the operator's: the arm does not wait for a label.
    expect(await inInbox(reply.inboundId)).toBe(true);
    expect(await coldCount(tenantId, since)).toBe(0);

    await tickUntilLabelled([reply.inboundId], {
      classifyClient: classifyingByBody({
        [marker]: { label: 'question', urgency: 'flexible', confidence: 'high' },
      }),
    });

    expect(await row('inbound_messages', reply.inboundId)).toMatchObject({
      lead_id: leadId,
      quote_id: null,
      label: 'question',
      urgency: 'flexible',
      label_confidence: 'high',
      is_hot: false,
      keyword_hot: false,
    });
    expect(await row('leads', leadId)).toMatchObject({ status: 'open', closed_reason: null });
    expect(await row('cadences', cadenceId)).toMatchObject({ status: 'paused', pause_reason: 'customer_reply' });

    const listed = (await listInboundNeedingTriage(100_000)).find((r) => r.id === reply.inboundId);
    expect(listed).toMatchObject({ leadId, quoteId: null, tenantId, label: 'question' });
    expect(await coldCount(tenantId, since)).toBe(1);

    // Handled: off the screen, and off the morning's count with it.
    expect(await markInboundTriaged(reply.inboundId)).toEqual({ triaged: true });
    expect(await inInbox(reply.inboundId)).toBe(false);
    expect(await coldCount(tenantId, since)).toBe(0);
  });

  it('a HOT lead reply is not listed: escalation told the tradie', async () => {
    const { caller } = await textedBack('Lead Reply Keyword Not Listed');
    const reply = await handleInboundSms({
      from: caller,
      to: SMS_FROM,
      body: 'URGENT burst pipe in the laundry',
      providerMessageId: null,
    });
    expect(await row('inbound_messages', reply.inboundId)).toMatchObject({ keyword_hot: true, is_hot: false });
    expect(await inInbox(reply.inboundId)).toBe(false);
  });
});

describe('one mobile, a quote and a lead at ONE client: the quote wins (D-10)', () => {
  it('threads the reply to the quote cadence and closes the lead quote_cadence_wins', async () => {
    const tenantId = await seedTenant('Lead Reply Quote Wins');
    tenantIds.push(tenantId);
    const caller = nextCaller();
    const quoteCadence = await liveQuoteCadence(tenantId, caller);
    const leadId = await seedLead(tenantId, { contact_mobile: caller });
    const leadCadence = await seedLeadCadence(tenantId, leadId, { contact_mobile: caller });

    // URGENT in the body: the reply is the QUOTE's, and a quote reply is never
    // keyword-scanned — the lead's keyword rule must not ride the tie-break.
    const result = await handleInboundSms({
      from: caller,
      to: SMS_FROM,
      body: 'URGENT can you ring me about the quote',
      providerMessageId: null,
    });

    expect(result.kind).toBe('reply_threaded');
    if (result.kind === 'reply_threaded') {
      expect(result.cadenceId).toBe(quoteCadence);
      expect(result.pause).toBe('paused');
    }
    expect(await row('inbound_messages', result.inboundId)).toMatchObject({
      attribution: 'threaded',
      tenant_id: tenantId,
      cadence_id: quoteCadence,
      lead_id: null,
      keyword_hot: false,
      matched_cadence_count: 1,
    });
    expect(await row('cadences', quoteCadence)).toMatchObject({ status: 'paused', pause_reason: 'customer_reply' });

    const lead = await row('leads', leadId);
    expect(lead).toMatchObject({ status: 'closed', closed_reason: 'quote_cadence_wins' });
    expect(await row('cadences', leadCadence)).toMatchObject({ status: 'stopped', stop_reason: 'lead_closed' });
  });

  it('two LEAD cadences at one client (no quote) is still ambiguous, and nothing pauses or closes', async () => {
    // Impossible through the text-back (one open lead per mobile per client),
    // so seeded directly: two leads whose cadences snapshot the same mobile.
    const tenantId = await seedTenant('Lead Reply Two Leads');
    tenantIds.push(tenantId);
    const caller = nextCaller();
    const leadA = await seedLead(tenantId, { contact_mobile: nextCaller() });
    const leadB = await seedLead(tenantId, { contact_mobile: nextCaller() });
    const cadenceA = await seedLeadCadence(tenantId, leadA, { contact_mobile: caller });
    const cadenceB = await seedLeadCadence(tenantId, leadB, { contact_mobile: caller });

    const result = await handleInboundSms({ from: caller, to: SMS_FROM, body: 'who is this', providerMessageId: null });

    expect(result.kind).toBe('reply_ambiguous');
    for (const leadId of [leadA, leadB]) {
      expect(await row('leads', leadId)).toMatchObject({ status: 'open', closed_reason: null });
    }
    for (const cadenceId of [cadenceA, cadenceB]) {
      expect((await row('cadences', cadenceId)).status).toBe('active');
    }
  });
});

describe('the operator opt-out on a lead reply, in both orders (D-11)', () => {
  /** The inbox's suppress action for a lead row: bound with a NULL quote id. */
  async function operatorSuppresses(tenantId: string, cadenceId: string) {
    const form = new FormData();
    form.set('cadence_id', cadenceId);
    return killContactAction(tenantId, null, BLANK_CONTROL_STATE, form);
  }

  async function smsSuppressions(tenantId: string): Promise<string[]> {
    const { data, error } = await admin
      .from('suppressed_contacts')
      .select('address')
      .eq('tenant_id', tenantId)
      .eq('channel', 'sms');
    if (error) throw new Error(`Reading suppressed_contacts failed: ${error.message}`);
    return (data ?? []).map((r) => r.address as string);
  }

  it('(a) label pass first: a HIGH-confidence opt_out closes the lead opt_out; the operator then suppresses the number, cadence already stopped', async () => {
    const { tenantId, caller, leadId, cadenceId } = await textedBack('Lead Reply Opt Out Pass First');
    const marker = token('optouta');
    const reply = await handleInboundSms({
      from: caller,
      to: SMS_FROM,
      body: `please do not text me again ${marker}`,
      providerMessageId: null,
    });
    // Not the STOP regex — a soft opt-out in words, for the model to read.
    expect(reply.kind).toBe('reply_threaded');

    await tickUntilLabelled([reply.inboundId], {
      classifyClient: classifyingByBody({
        [marker]: { label: 'opt_out', urgency: 'unknown', confidence: 'high' },
      }),
    });

    expect(await row('inbound_messages', reply.inboundId)).toMatchObject({ label: 'opt_out', is_hot: false });
    expect(await row('leads', leadId)).toMatchObject({ status: 'closed', closed_reason: 'opt_out' });
    expect(await row('cadences', cadenceId)).toMatchObject({ status: 'stopped', stop_reason: 'lead_closed' });
    // The model closed the lead; it suppressed NOBODY (D-13).
    expect(await smsSuppressions(tenantId)).toEqual([]);

    const state = await operatorSuppresses(tenantId, cadenceId);

    expect(state.success).toBe(KILL_ALREADY_STOPPED_MESSAGE);
    expect(await smsSuppressions(tenantId)).toEqual([caller]);
    // The first reason stands: a closed lead is never re-closed.
    expect(await row('leads', leadId)).toMatchObject({ status: 'closed', closed_reason: 'opt_out' });
  });

  it('(b) operator first: the action suppresses and stops the cadence contact_suppressed, and the sweep closes the lead opt_out', async () => {
    const { tenantId, caller, leadId, cadenceId } = await textedBack('Lead Reply Opt Out Operator First');
    const marker = token('optoutb');
    const reply = await handleInboundSms({
      from: caller,
      to: SMS_FROM,
      body: `leave me alone thanks ${marker}`,
      providerMessageId: null,
    });

    const state = await operatorSuppresses(tenantId, cadenceId);

    expect(state.success).toBe(KILL_SUCCESS_MESSAGE);
    expect(await smsSuppressions(tenantId)).toEqual([caller]);
    expect(await row('cadences', cadenceId)).toMatchObject({ status: 'stopped', stop_reason: 'contact_suppressed' });

    // The tick's reconciling sweep runs BEFORE classification and the label
    // pass: it closes the lead `opt_out` from the stopped cadence, and the
    // label pass then finds no open lead to close.
    await tickUntilLabelled([reply.inboundId], {
      classifyClient: classifyingByBody({
        [marker]: { label: 'opt_out', urgency: 'unknown', confidence: 'high' },
      }),
    });

    expect(await row('leads', leadId)).toMatchObject({ status: 'closed', closed_reason: 'opt_out' });
    expect(await row('cadences', cadenceId)).toMatchObject({ status: 'stopped', stop_reason: 'contact_suppressed' });
  });
});

describe('no console surface links to a quote that does not exist (D-18)', () => {
  /** Source with comments stripped. */
  const code = (path: string): string =>
    readFileSync(path, 'utf8')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('the inbox renders its quote link only when the row carries a quote id', () => {
    const inbox = code('src/app/(console)/inbox/page.tsx');
    const link = inbox.indexOf('/quotes/${row.quoteId}');
    expect(link).toBeGreaterThan(-1);
    // The nearest guard before the link names the quote id.
    const guard = inbox.lastIndexOf('row.quoteId ?', link);
    expect(guard).toBeGreaterThan(-1);
    expect(inbox.slice(guard, link)).not.toContain(') : null}');
  });

  // 2026-10 (Phase 13, 13-02): MOVED BY DESIGN (research Pitfall 1). The pin
  // was "the queue hands its cards only rows whose quote id is present" — the
  // narrowing that would now hide every drafted lead follow-up. The queue
  // keeps lead rows; the D-18 property this describe guards (no link to a
  // quote that does not exist) moves to the card, whose one quote href is
  // built only for a quote row. tests/queue-lead-rows.test.ts pins the rest.
  it('the approval queue keeps lead rows, and its card links a quote only on a quote row', () => {
    const page = code('src/app/(console)/queue/page.tsx');
    expect(page).not.toMatch(/row\.quoteId !== null/);
    const card = code('src/app/(console)/queue/queue-card.tsx');
    expect(card).toMatch(/row\.kind !== 'lead' && row\.quoteId !== null/);
    expect(card).not.toContain('/quotes/${row.quoteId}`}');
  });
});
