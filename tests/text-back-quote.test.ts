/**
 * THE OPEN-QUOTE BRANCH, PROVEN AT THE DATABASE (Phase 12, plan 12-05; TXT-04;
 * D-08, D-16, D-17).
 *
 * A missed caller whose mobile is the contact snapshot of a LIVE quote cadence
 * at the same client is already in a conversation about a quote. So: no lead,
 * no lead cadence; the "about your quote" wording ONCE, as the reserved touch
 * 0 on the quote cadence, through the ledger; the quote cadence paused through
 * the existing reply pause; and (Task 2's cases, below) the tradie told on
 * their own escalation phone, keyed on the missed call.
 *
 * `sendTextBack` and `runCadenceTick` run FOR REAL against a migrated
 * database. Only the senders are injected — a recording SMS sender whose
 * `provider` is a real provider name, and a recording escalation sender — so
 * nothing is dialled, and every request a provider would have received is
 * inspected.
 *
 * ── DB-BACKED, AND CI IS THE ONLY PLACE IT RUNS ─────────────────────────────
 *
 * It refuses a non-local target through `tests/helpers/env.ts` and MUST NEVER
 * run through `npm run test:remote`: the hosted Sydney project is production,
 * and this suite arms text-back and SMS identity rows.
 *
 * ── THE BOUNDS ON THE ENABLED ROWS IT WRITES ────────────────────────────────
 *
 * Each armed tenant's `text_back` row and tenant-scoped `sms` row are deleted
 * BY ID in `afterAll`, first (`messaging_config` has no FK). Every number is
 * from ACMA's fiction block (0491 570 5xx / 08 9157 01xx).
 *
 * ── TICKS RUN ON A PINNED 2019 CLOCK, OFF THE QUARTER HOUR ─────────────────
 *
 * The alert claim is GLOBAL, so the ticks here pass a 2019 clock at minute :01
 * — the balance probe behind the same ops seam runs only on the quarter hour
 * (or when forced by a credit refusal, which nothing here produces), so it
 * neither runs nor latches a Perth-day alert row. Files run serially.
 */
import { afterAll, describe, expect, it } from 'vitest';

import type { SendOutcome, SendRequest, TouchSender } from '../src/core/cadence/sender';
import { runCadenceTick } from '../src/core/cadence/run-tick';
import type { StalledEmailSender } from '../src/core/alerts/stalled-drafts';
import { escalateQuoteCalls } from '../src/core/escalation/quote-call';
import type { SendSmsInput, SendSmsResult } from '../src/core/messaging/clicksend-client';
import { ABOUT_QUOTE_TOUCH_NUMBER } from '../src/core/leads/constants';
import { runTextBackAlertPass } from '../src/core/leads/sweep';
import { defaultTextBackBody } from '../src/core/leads/template';
import { sendTextBack } from '../src/core/leads/text-back';
import { closeDb, upsertChannelConfig } from '../src/db/repository';

import {
  admin,
  seedCadence,
  seedInbound,
  seedMissedCall,
  seedQuotes,
  seedTenant,
  seedTextBackArmed,
  seedTextBackTemplates,
  seedTouches,
  teardownTenants,
} from './helpers/seed';

/** The shared SMS number the text leaves from — fiction block. */
const SMS_FROM = '+61491570150';
/** The client's escalation phone, stored compact-local the way the form stores it. */
const ESCALATION_LOCAL = '0491570152';
const ESCALATION_E164 = '+61491570152';

const MS_PER_HOUR = 3_600_000;

/** A tick clock in 2019, at minute :01 — see the header. */
const TICK_AT = new Date('2019-09-03T03:01:00.000Z');

const tenantIds: string[] = [];
const configIds: string[] = [];

/** A distinct fiction-block mobile per scenario, so the 24-hour rule never couples two cases. */
let callerSeq = 500;
function nextCaller(): string {
  callerSeq += 1;
  return `+61491570${String(callerSeq).padStart(3, '0')}`;
}

/** Records what it was asked to send, as a real provider would receive it. */
class RecordingSender implements TouchSender {
  readonly provider = 'clicksend';
  readonly sent: SendRequest[] = [];
  async send(request: SendRequest): Promise<SendOutcome> {
    this.sent.push(request);
    return { kind: 'sent', provider: 'clicksend', providerMessageId: `cs-${request.ledgerId.slice(0, 8)}` };
  }
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

/** Every escalation row about one missed call (the never-twice key). */
async function escalationsFor(missedCallId: string): Promise<Array<Record<string, unknown>>> {
  return rows('escalations', 'missed_call_id', missedCallId);
}

/** An email sink that records what the operator would have received. */
function recordingEmail(): StalledEmailSender & { sent: Array<{ subject: string; body: string }> } {
  const sent: Array<{ subject: string; body: string }> = [];
  const sink = (async (message: { subject: string; body: string }) => {
    sent.push(message);
    return { ok: true, id: 'em_test' } as const;
  }) as StalledEmailSender & { sent: typeof sent };
  sink.sent = sent;
  return sink;
}

/** An ARMED client: text_back on, SMS identity resolving, all three wordings attested. */
async function armedTenant(
  prefix: string,
  options: { escalationPhone?: string | null; templates?: boolean } = {},
): Promise<string> {
  const tenantId = await seedTenant(prefix);
  tenantIds.push(tenantId);

  const escalationPhone = options.escalationPhone === undefined ? ESCALATION_LOCAL : options.escalationPhone;
  const { error } = await admin.from('tenants').update({ escalation_phone: escalationPhone }).eq('id', tenantId);
  if (error) throw new Error(`Setting the escalation phone failed: ${error.message}`);

  configIds.push(await seedTextBackArmed(tenantId));
  // TENANT-SCOPED, fictional, deleted by id in afterAll. See the header.
  const sms = await upsertChannelConfig({ channel: 'sms', tenantId, fromAddress: SMS_FROM, enabled: true });
  configIds.push(sms.id);

  if (options.templates !== false) await seedTextBackTemplates(tenantId);
  return tenantId;
}

/** A live QUOTE cadence for `caller` with its own five touches, all in the future. */
async function liveQuote(
  tenantId: string,
  caller: string,
  overrides: Record<string, unknown> = {},
): Promise<{ quoteId: string; cadenceId: string }> {
  const [quote] = await seedQuotes(tenantId, [{ job_description: 'Hot water system replacement, Scarborough' }]);
  const cadenceId = await seedCadence(tenantId, quote!.id, {
    contact_mobile: caller,
    contact_name: 'Jordan Example',
    ...overrides,
  });
  await seedTouches(cadenceId, tenantId, [{}, {}, {}, {}, {}]);
  return { quoteId: quote!.id, cadenceId };
}

/** A completed call from `caller` that ended 15 s before `now`. */
async function call(tenantId: string, caller: string, now: Date): Promise<string> {
  const endedAt = new Date(now.getTime() - 15_000);
  return seedMissedCall(
    tenantId,
    {},
    { caller, afterHours: false, startedAt: new Date(endedAt.getTime() - 20_000), endedAt },
  );
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

async function touchesOf(cadenceId: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await admin
    .from('cadence_touches')
    .select('touch_number, status, scheduled_at')
    .eq('cadence_id', cadenceId)
    .order('touch_number');
  if (error) throw new Error(`Reading touches failed: ${error.message}`);
  return (data ?? []) as Array<Record<string, unknown>>;
}

async function tenantName(tenantId: string): Promise<string> {
  return (await row('tenants', tenantId)).name as string;
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

/* -------------------------------------------------------------------------- *
 * D-08 / D-17: the about-quote text as touch 0, the reply pause, no lead
 * -------------------------------------------------------------------------- */

describe('a caller with a live quote cadence (D-08, D-17, TXT-04)', () => {
  it('gets the about-quote text ONCE as touch 0 of the quote cadence, which pauses; no lead exists', async () => {
    const tenantId = await armedTenant('Quote Branch');
    const caller = nextCaller();
    const { quoteId, cadenceId } = await liveQuote(tenantId, caller);
    const before = await touchesOf(cadenceId);
    const now = new Date();
    const id = await call(tenantId, caller, now);
    const sender = new RecordingSender();

    expect((await sendTextBack(id, { now, getSender: async () => sender })).kind).toBe('sent');

    // NO lead, NO lead cadence.
    expect(await rows('leads', 'tenant_id', tenantId)).toHaveLength(0);
    const cadences = await rows('cadences', 'tenant_id', tenantId);
    expect(cadences.map((c) => c.kind)).toEqual(['quote']);

    // Touch 0 sent; touches 1..5 exactly as they were (status AND schedule).
    const after = await touchesOf(cadenceId);
    expect(after[0]).toMatchObject({ touch_number: ABOUT_QUOTE_TOUCH_NUMBER, status: 'sent' });
    expect(new Date(after[0]!.scheduled_at as string).getTime()).toBe(now.getTime());
    expect(after.slice(1)).toEqual(before);

    // One approved draft holding the attested about-quote bytes.
    const attested = defaultTextBackBody('about_quote', await tenantName(tenantId));
    const drafts = await rows('touch_drafts', 'cadence_id', cadenceId);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      touch_number: 0,
      status: 'approved',
      final_body: attested,
      generated_body: attested,
      model: 'template',
      quote_id: quoteId,
    });

    // One ledger row: touch 0, quote set, lead NULL, sent.
    const ledger = await rows('send_ledger', 'tenant_id', tenantId);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      touch_number: 0,
      cadence_id: cadenceId,
      quote_id: quoteId,
      lead_id: null,
      channel: 'sms',
      to_address: caller,
      sender: 'clicksend',
      outcome: 'sent',
    });

    // Exactly one provider request, carrying the ledger id and the bytes.
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]).toMatchObject({
      ledgerId: ledger[0]!.id,
      quoteId,
      leadId: null,
      cadenceId,
      touchNumber: 0,
      body: attested,
    });
    expect(sender.sent[0]!.to.address).toBe(caller);

    // The EXISTING reply pause: paused, customer_reply.
    const cadence = await row('cadences', cadenceId);
    expect(cadence.status).toBe('paused');
    expect(cadence.pause_reason).toBe('customer_reply');

    // The call reads sent, route quote, on the quote cadence, no detail.
    const missed = await row('missed_calls', id);
    expect(missed).toMatchObject({
      text_back_status: 'sent',
      text_back_route: 'quote',
      text_back_skip_reason: null,
      text_back_detail: null,
      cadence_id: cadenceId,
      lead_id: null,
      text_back_ledger_id: ledger[0]!.id,
    });
  });

  it('the same caller ringing again after 24 hours gets no second text: skipped quote_open, route quote', async () => {
    const tenantId = await armedTenant('Quote Repeat');
    const caller = nextCaller();
    const { cadenceId } = await liveQuote(tenantId, caller);
    const now = new Date();
    const sender = new RecordingSender();
    expect((await sendTextBack(await call(tenantId, caller, now), { now, getSender: async () => sender })).kind).toBe(
      'sent',
    );

    // Past the one-text-per-caller window, so only the touch-0 claim can refuse it.
    const later = new Date(now.getTime() + 24 * MS_PER_HOUR + 1);
    const second = await call(tenantId, caller, later);
    expect((await sendTextBack(second, { now: later, getSender: async () => sender })).kind).toBe('skipped');

    expect(sender.sent).toHaveLength(1);
    expect(await rows('send_ledger', 'tenant_id', tenantId)).toHaveLength(1);
    expect((await touchesOf(cadenceId)).filter((t) => t.touch_number === 0)).toHaveLength(1);
    expect(await rows('leads', 'tenant_id', tenantId)).toHaveLength(0);
    expect(await row('missed_calls', second)).toMatchObject({
      text_back_status: 'skipped',
      text_back_skip_reason: 'quote_open',
      text_back_route: 'quote',
      cadence_id: cadenceId,
      text_back_ledger_id: null,
    });
  });

  it('a client_paused quote cadence is UPGRADED to customer_reply by the call', async () => {
    const tenantId = await armedTenant('Quote Upgrade');
    const caller = nextCaller();
    const { cadenceId } = await liveQuote(tenantId, caller, { status: 'paused', pause_reason: 'client_paused' });
    const now = new Date();

    const result = await sendTextBack(await call(tenantId, caller, now), {
      now,
      getSender: async () => new RecordingSender(),
    });

    expect(result.kind).toBe('sent');
    const cadence = await row('cadences', cadenceId);
    expect(cadence.status).toBe('paused');
    expect(cadence.pause_reason).toBe('customer_reply');
  });

  it('no attested about-quote wording: skipped no_template, no touch 0, no pause', async () => {
    const tenantId = await armedTenant('Quote No Template', { templates: false });
    // The two lead wordings are attested; the about-quote one is not.
    await seedTextBackTemplates(tenantId, { variants: ['business_hours', 'after_hours'] });
    const caller = nextCaller();
    const { cadenceId } = await liveQuote(tenantId, caller);
    const now = new Date();
    const id = await call(tenantId, caller, now);
    const sender = new RecordingSender();

    expect((await sendTextBack(id, { now, getSender: async () => sender })).kind).toBe('skipped');
    expect((await row('missed_calls', id)).text_back_skip_reason).toBe('no_template');
    expect(sender.sent).toHaveLength(0);
    expect((await touchesOf(cadenceId)).some((t) => t.touch_number === 0)).toBe(false);
    expect((await row('cadences', cadenceId)).status).toBe('active');
    expect(await rows('leads', 'tenant_id', tenantId)).toHaveLength(0);
  });

  it("a quote cadence at ANOTHER client does not make this caller a quote customer here: they get a lead", async () => {
    const other = await armedTenant('Quote Other Client');
    const tenantId = await armedTenant('Quote This Client');
    const caller = nextCaller();
    const { cadenceId: otherCadence } = await liveQuote(other, caller);
    const now = new Date();
    const id = await call(tenantId, caller, now);
    const sender = new RecordingSender();

    expect((await sendTextBack(id, { now, getSender: async () => sender })).kind).toBe('sent');
    expect((await row('missed_calls', id)).text_back_route).toBe('lead');
    expect(await rows('leads', 'tenant_id', tenantId)).toHaveLength(1);
    expect(sender.sent[0]!.touchNumber).toBe(1);
    expect(sender.sent[0]!.body).toBe(defaultTextBackBody('business_hours', await tenantName(tenantId)));
    // The other client's quote cadence is untouched.
    expect((await row('cadences', otherCadence)).status).toBe('active');
    expect((await touchesOf(otherCadence)).some((t) => t.touch_number === 0)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- *
 * A pause that fails is never silent (D-08, D-10)
 * -------------------------------------------------------------------------- */

describe('a quote-cadence pause that fails is sent, recorded and alerted once', () => {
  it('a THROWING pause: sent_pause_failed, detail pause_failed, one tick alerts it, the next reports 0', async () => {
    const tenantId = await armedTenant('Quote Pause Throws');
    const name = await tenantName(tenantId);
    const caller = nextCaller();
    const { cadenceId } = await liveQuote(tenantId, caller);
    const now = new Date();
    const id = await call(tenantId, caller, now);
    const sender = new RecordingSender();

    const result = await sendTextBack(id, {
      now,
      getSender: async () => sender,
      pauseForReply: async () => {
        throw new Error('pause failed for +61491570501');
      },
    });

    expect(result.kind).toBe('sent_pause_failed');
    expect(sender.sent).toHaveLength(1);
    expect(await row('missed_calls', id)).toMatchObject({
      text_back_status: 'sent',
      text_back_detail: 'pause_failed',
      text_back_route: 'quote',
      text_back_alerted_at: null,
    });
    // The pause really did not happen; the operator must do it.
    expect((await row('cadences', cadenceId)).status).toBe('active');

    // THROUGH THE TICK, with the ops seam, so the third alert arm and the
    // tick field are proven wired.
    const email = recordingEmail();
    const first = await runCadenceTick({
      now: TICK_AT,
      draftClient: null,
      classifyClient: null,
      textBackOps: { alertSender: email, clicksend: { username: undefined, apiKey: undefined } },
    });
    expect(first.textBackPauseFailed).toBe(1);
    expect(first.textBackAlertFailed).toBe(0);
    const body = email.sent.map((m) => m.body).join('\n');
    expect(body).toContain(`${name}: 1 sent, but the quote cadence could not be paused`);
    expect(body).not.toContain(caller);
    expect(body).not.toContain('+61');
    expect((await row('missed_calls', id)).text_back_alerted_at).not.toBeNull();

    const second = await runCadenceTick({
      now: new Date(TICK_AT.getTime() + 60_000),
      draftClient: null,
      classifyClient: null,
      textBackOps: { alertSender: recordingEmail(), clicksend: { username: undefined, apiKey: undefined } },
    });
    expect(second.textBackPauseFailed).toBe(0);
  });

  it('a pause that RETURNS a refusal kind is the same named failure, claimed once by the alert pass', async () => {
    const tenantId = await armedTenant('Quote Pause Refused');
    const name = await tenantName(tenantId);
    const caller = nextCaller();
    await liveQuote(tenantId, caller);
    const now = new Date();
    const id = await call(tenantId, caller, now);

    const result = await sendTextBack(id, {
      now,
      getSender: async () => new RecordingSender(),
      pauseForReply: async () => ({ kind: 'not_active', status: 'stopped' }),
    });

    expect(result.kind).toBe('sent_pause_failed');
    expect((await row('missed_calls', id)).text_back_detail).toBe('pause_failed');

    const email = recordingEmail();
    const counts = await runTextBackAlertPass({ now: TICK_AT, sendEmail: email });
    expect(counts.pauseFailed).toBe(1);
    expect(email.sent[0]!.body).toContain(`${name}: 1 sent, but the quote cadence could not be paused`);
    expect((await runTextBackAlertPass({ now: TICK_AT, sendEmail: recordingEmail() })).pauseFailed).toBe(0);
  });

  it('a pause that lands is NOT a failure: no detail, nothing to alert', async () => {
    const tenantId = await armedTenant('Quote Pause Lands');
    const caller = nextCaller();
    await liveQuote(tenantId, caller);
    const now = new Date();
    const id = await call(tenantId, caller, now);

    const result = await sendTextBack(id, {
      now,
      getSender: async () => new RecordingSender(),
      pauseForReply: async () => ({ kind: 'upgraded' }),
    });

    expect(result.kind).toBe('sent');
    expect((await row('missed_calls', id)).text_back_detail).toBeNull();
    expect((await runTextBackAlertPass({ now: TICK_AT, sendEmail: recordingEmail() })).pauseFailed).toBe(0);
  });
});

/* -------------------------------------------------------------------------- *
 * D-16: tell the tradie, on their own phone, once per missed call
 *
 * The pass is GLOBAL (it lists every route-quote call with no escalation row),
 * so it also escalates the calls the cases above left behind — every
 * assertion here is keyed on THIS case's missed call id and its escalation
 * row id (the provider's customString), never on a total.
 * -------------------------------------------------------------------------- */

describe('the quote-call escalation (D-16, TXT-04)', () => {
  /** A route-quote call: an armed client, a live quote, a call, the about-quote text sent. */
  async function quoteCall(
    prefix: string,
    options: { escalationPhone?: string | null } = {},
  ): Promise<{ tenantId: string; caller: string; quoteId: string; cadenceId: string; missedCallId: string; now: Date }> {
    const tenantId = await armedTenant(prefix, options);
    const caller = nextCaller();
    const { quoteId, cadenceId } = await liveQuote(tenantId, caller);
    const now = new Date();
    const missedCallId = await call(tenantId, caller, now);
    expect((await sendTextBack(missedCallId, { now, getSender: async () => new RecordingSender() })).kind).toBe('sent');
    return { tenantId, caller, quoteId, cadenceId, missedCallId, now };
  }

  it('with NO sender the pass does not scan and claims nothing', async () => {
    const { missedCallId, now } = await quoteCall('Quote Esc No Sender');

    const counts = await escalateQuoteCalls({ sender: undefined, now });

    expect(counts).toEqual({ escalated: 0, cooldownSuppressed: 0, refused: 0, sendFailed: 0, unconfigured: 1 });
    expect(await escalationsFor(missedCallId)).toHaveLength(0);
  });

  it('escalates once to the client\'s own escalation phone, keyed on missed_call_id; a second pass sends nothing', async () => {
    const { missedCallId, caller, quoteId, cadenceId, now } = await quoteCall('Quote Esc Once');
    const sender = recordingEscalationSender();

    const counts = await escalateQuoteCalls({ sender, now });
    expect(counts.escalated).toBeGreaterThanOrEqual(1);

    const [escalation, ...extra] = await escalationsFor(missedCallId);
    expect(extra).toHaveLength(0);
    expect(escalation).toMatchObject({
      missed_call_id: missedCallId,
      inbound_message_id: null,
      cadence_id: cadenceId,
      quote_id: quoteId,
      to_address: ESCALATION_E164,
      outcome: 'sent',
    });

    // Exactly one SMS for THIS call: to the tradie, from the client's number,
    // carrying the escalation row id, naming the customer, the quote and the text.
    const mine = sender.sent.filter((input) => input.customString === escalation!.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.to).toBe(ESCALATION_E164);
    expect(mine[0]!.from).toBe(SMS_FROM);
    expect(mine[0]!.body).toBe(
      'Jordan rang about "Hot water system replacement, Scarborough" and was missed. ' +
        `We texted them back about their quote.\nCall them: ${caller}`,
    );
    // Never to the customer.
    expect(sender.sent.some((input) => input.to === caller)).toBe(false);

    // The never-twice key: a later pass neither claims nor sends for this call.
    const again = recordingEscalationSender();
    await escalateQuoteCalls({ sender: again, now: new Date(now.getTime() + 60_000) });
    expect(await escalationsFor(missedCallId)).toHaveLength(1);
    expect(again.sent.some((input) => input.customString === escalation!.id)).toBe(false);
  });

  it('a call inside the cooldown is claimed and recorded cooldown_suppressed, with no provider call', async () => {
    // 12-REVIEW WR-05 retired this case's old shape — two calls a day apart,
    // escalated in ONE pass — because a call over a day old is no longer owed
    // an escalation at all (the tick escalates the first within the minute).
    // The cooldown is asked the same way whichever escalation came first; here
    // it is the tradie having been told about a HOT REPLY on this very quote a
    // minute before the customer rang.
    const { tenantId, quoteId, cadenceId, missedCallId, now } = await quoteCall('Quote Esc Cooldown');
    const inboundId = await seedInbound(tenantId, {
      cadenceId,
      quoteId,
      receivedAt: new Date(now.getTime() - 2 * 60_000).toISOString(),
      isHot: true,
    });
    const prior = await admin.from('escalations').insert({
      tenant_id: tenantId,
      inbound_message_id: inboundId,
      cadence_id: cadenceId,
      quote_id: quoteId,
      to_address: ESCALATION_E164,
      outcome: 'sent',
      created_at: new Date(now.getTime() - 60_000).toISOString(),
    });
    if (prior.error) throw new Error(`Seeding the hot-reply escalation failed: ${prior.error.message}`);

    const sender = recordingEscalationSender();
    const counts = await escalateQuoteCalls({ sender, now });
    expect(counts.cooldownSuppressed).toBeGreaterThanOrEqual(1);

    const [suppressedRow, ...extra] = await escalationsFor(missedCallId);
    expect(extra).toHaveLength(0);
    expect(suppressedRow).toMatchObject({ outcome: 'cooldown_suppressed', cadence_id: cadenceId });
    expect(sender.sent.some((input) => input.customString === suppressedRow!.id)).toBe(false);
  });

  it('a missed quote call older than the bound is not escalated at all (12-REVIEW WR-05)', async () => {
    const tenantId = await armedTenant('Quote Esc Too Old');
    const caller = nextCaller();
    await liveQuote(tenantId, caller);
    // A backlog: the call was decided a day and an hour before this pass.
    const callAt = new Date(Date.now() - 25 * MS_PER_HOUR);
    const missedCallId = await call(tenantId, caller, callAt);
    expect((await sendTextBack(missedCallId, { now: callAt, getSender: async () => new RecordingSender() })).kind).toBe(
      'sent',
    );

    const sender = recordingEscalationSender();
    await escalateQuoteCalls({ sender, now: new Date() });

    expect(await escalationsFor(missedCallId)).toHaveLength(0);
  });

  it('no escalation phone: recorded no_escalation_number, zero provider calls', async () => {
    const { missedCallId, now } = await quoteCall('Quote Esc No Number', { escalationPhone: null });
    const sender = recordingEscalationSender();

    await escalateQuoteCalls({ sender, now });

    const [escalation] = await escalationsFor(missedCallId);
    expect(escalation).toMatchObject({ outcome: 'no_escalation_number', to_address: '' });
    expect(sender.sent.some((input) => input.customString === escalation!.id)).toBe(false);
  });

  it('SMS not armed for the client: recorded sms_not_configured, zero provider calls', async () => {
    const { tenantId, missedCallId, now } = await quoteCall('Quote Esc Not Armed');
    // Disarm the client's SMS identity after the text-back went out.
    await upsertChannelConfig({ channel: 'sms', tenantId, fromAddress: SMS_FROM, enabled: false });
    const sender = recordingEscalationSender();

    await escalateQuoteCalls({ sender, now });

    const [escalation] = await escalationsFor(missedCallId);
    expect(escalation).toMatchObject({ outcome: 'sms_not_configured', to_address: ESCALATION_E164 });
    expect(sender.sent.some((input) => input.customString === escalation!.id)).toBe(false);
  });
});
