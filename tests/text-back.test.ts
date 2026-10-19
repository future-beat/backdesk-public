/**
 * THE TEXT-BACK TRACER, PROVEN AT THE DATABASE (Phase 12, plan 12-01;
 * TXT-01/TXT-02/TXT-03).
 *
 * `sendTextBack` runs FOR REAL against a migrated database: the guarded claim,
 * every gate fact, the lead, the lead cadence, its touches, the approved draft,
 * the ledger claim and the outcome writes. Only the SENDER is injected — a
 * recording sender whose `provider` is a real provider name — so nothing is
 * dialled and every request the provider would have received is inspected.
 *
 * ── DB-BACKED, AND CI IS THE ONLY PLACE IT RUNS ─────────────────────────────
 *
 * Every assertion is a query, against `supabase start` on the runner (plan
 * 12-03). It refuses a non-local target through `tests/helpers/env.ts` and
 * MUST NEVER run through `npm run test:remote`: the hosted Sydney project is
 * production, and this suite arms text-back and SMS identity rows.
 *
 * ── THE BOUNDS ON THE ENABLED ROWS IT WRITES ────────────────────────────────
 *
 * Each armed tenant is seeded seconds earlier; its `text_back` row and its
 * enabled `sms` row are TENANT-SCOPED, carry ACMA fiction-block numbers, and
 * are deleted BY ID in `afterAll`, first (`messaging_config` has no FK, so
 * `teardownTenants` cannot reach them) — the `tests/escalation.test.ts` rule.
 *
 * Every number is from ACMA's fiction block (0491 570 1xx / 08 9157 01xx).
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { StubSender, type SendOutcome, type SendRequest, type TouchSender } from '../src/core/cadence/sender';
import { TEXT_BACK_DAILY_CAP } from '../src/core/audit/constants';
import { defaultTextBackBody } from '../src/core/leads/template';
import { sendTextBack, type TextBackKind } from '../src/core/leads/text-back';
import { closeDb, upsertChannelConfig } from '../src/db/repository';

import {
  admin,
  ensureOperatorExists,
  seedCadence,
  seedDivertNumber,
  seedLead,
  seedMessagingConfigOverride,
  seedMissedCall,
  seedNeverTextNumber,
  seedQuotes,
  seedSuppression,
  seedTenant,
  seedTextBackArmed,
  seedTextBackTemplates,
  teardownTenants,
} from './helpers/seed';

/** The shared SMS number the text leaves from — fiction block. */
const SMS_FROM = '+61491570150';
/** The client's own line (an own_line never-text entry) — a mobile. */
const OWN_LINE = '+61491570151';
/** The client's escalation phone, stored compact-local the way the form stores it. */
const ESCALATION_LOCAL = '0491570152';
const ESCALATION_E164 = '+61491570152';

const tenantIds: string[] = [];
const configIds: string[] = [];

/** A distinct fiction-block mobile per scenario, so the 24-hour rule never couples two tests. */
let callerSeq = 160;
function nextCaller(): string {
  callerSeq += 1;
  return `+61491570${String(callerSeq).padStart(3, '0')}`;
}

/** A sender that records what it was asked to send, as a real provider would receive it. */
class RecordingSender implements TouchSender {
  readonly sent: SendRequest[] = [];
  constructor(
    readonly provider: string = 'clicksend',
    private readonly answer: (request: SendRequest) => SendOutcome = (request) => ({
      kind: 'sent',
      provider: 'clicksend',
      providerMessageId: `cs-${request.ledgerId.slice(0, 8)}`,
    }),
  ) {}

  async send(request: SendRequest): Promise<SendOutcome> {
    this.sent.push(request);
    return this.answer(request);
  }
}

class ThrowingSender implements TouchSender {
  readonly provider = 'clicksend';
  calls = 0;
  async send(): Promise<SendOutcome> {
    this.calls += 1;
    throw new Error('socket hang up +61491570199');
  }
}

/** An ARMED client: text_back on, SMS identity resolving, templates attested, an own line, a divert number. */
async function armedTenant(prefix: string): Promise<{ tenantId: string; textBackConfigId: string; divert: string }> {
  const tenantId = await seedTenant(prefix);
  tenantIds.push(tenantId);

  const { error } = await admin
    .from('tenants')
    .update({ escalation_phone: ESCALATION_LOCAL })
    .eq('id', tenantId);
  if (error) throw new Error(`Setting the escalation phone failed: ${error.message}`);

  const textBackConfigId = await seedTextBackArmed(tenantId);
  configIds.push(textBackConfigId);

  // TENANT-SCOPED, fictional, deleted by id in afterAll. See the header.
  const sms = await upsertChannelConfig({
    channel: 'sms',
    tenantId,
    fromAddress: SMS_FROM,
    enabled: true,
  });
  configIds.push(sms.id);

  await seedTextBackTemplates(tenantId);
  await seedNeverTextNumber(tenantId, OWN_LINE, 'own_line');
  const divertId = await seedDivertNumber(tenantId);
  const { data: divertRow } = await admin
    .from('tenant_divert_numbers')
    .select('number_e164')
    .eq('id', divertId)
    .single();

  return { tenantId, textBackConfigId, divert: (divertRow as { number_e164: string }).number_e164 };
}

/** A completed call that ended `agoMs` before `now`, from `caller` (null = withheld). */
async function call(
  tenantId: string,
  caller: string | null,
  now: Date,
  extra: { agoMs?: number; forwardedFrom?: string | null; afterHours?: boolean } = {},
): Promise<string> {
  const endedAt = new Date(now.getTime() - (extra.agoMs ?? 15_000));
  return seedMissedCall(
    tenantId,
    {},
    {
      caller,
      forwardedFrom: extra.forwardedFrom ?? null,
      afterHours: extra.afterHours ?? false,
      startedAt: new Date(endedAt.getTime() - 20_000),
      endedAt,
    },
  );
}

async function missedCall(id: string): Promise<Record<string, unknown>> {
  const { data, error } = await admin.from('missed_calls').select('*').eq('id', id).single();
  if (error) throw new Error(`Reading the missed call failed: ${error.message}`);
  return data as Record<string, unknown>;
}

async function countRows(table: string, tenantId: string, filter: Record<string, unknown> = {}): Promise<number> {
  let query = admin.from(table).select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId);
  for (const [column, value] of Object.entries(filter)) query = query.eq(column, value as string);
  const { count, error } = await query;
  if (error) throw new Error(`Counting ${table} failed: ${error.message}`);
  return count ?? 0;
}

/** Prior text-backs for a tenant, decided at `decidedAt`, each to a distinct other caller. */
async function priorTextBacks(
  tenantId: string,
  count: number,
  decidedAt: Date,
  status: 'claimed' | 'sent' | 'failed' = 'sent',
  caller?: string,
): Promise<void> {
  const rows = Array.from({ length: count }, (_, i) => ({
    tenant_id: tenantId,
    provider_call_id: `CA${randomUUID().replace(/-/g, '')}`,
    called_number_e164: '+61891570156',
    // Fiction block 0491 570 300+, clear of the scenario callers (161+).
    caller_e164: caller ?? `+61491570${String(300 + i)}`,
    caller_kind: 'mobile',
    started_at: new Date(decidedAt.getTime() - 60_000).toISOString(),
    after_hours: false,
    source: 'webhook',
    text_back_status: status,
    text_back_decided_at: decidedAt.toISOString(),
  }));
  const { error } = await admin.from('missed_calls').insert(rows);
  if (error) throw new Error(`Seeding prior text-backs failed: ${error.message}`);
}

/** Expect a recorded skip with `reason`, and nothing else created. */
async function expectSkip(
  tenantId: string,
  id: string,
  result: { kind: TextBackKind },
  reason: string,
  sender?: RecordingSender,
): Promise<void> {
  expect(result.kind).toBe('skipped');
  const row = await missedCall(id);
  expect(row.text_back_status).toBe('skipped');
  expect(row.text_back_skip_reason).toBe(reason);
  expect(row.lead_id).toBeNull();
  expect(row.cadence_id).toBeNull();
  expect(row.text_back_ledger_id).toBeNull();
  expect(await countRows('send_ledger', tenantId)).toBe(0);
  expect(await countRows('cadences', tenantId, { kind: 'lead' })).toBe(0);
  if (sender) expect(sender.sent).toHaveLength(0);
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
 * The tracer: one armed call → one ledger text-back and one request
 * -------------------------------------------------------------------------- */

describe('an armed client, a completed mobile call (TXT-01, TXT-02, D-01, D-04)', () => {
  it('sends ONE text-back through the ledger, as touch 1 of a lead cadence', async () => {
    const { tenantId } = await armedTenant('Text-back Tracer');
    const caller = nextCaller();
    const now = new Date();
    const id = await call(tenantId, caller, now);
    const sender = new RecordingSender('clicksend');

    const result = await sendTextBack(id, { now, getSender: async () => sender });
    expect(result.kind).toBe('sent');

    // One lead, open, for this caller.
    const { data: leads } = await admin.from('leads').select('*').eq('tenant_id', tenantId);
    expect(leads).toHaveLength(1);
    const lead = leads![0] as Record<string, unknown>;
    expect(lead.contact_mobile).toBe(caller);
    expect(lead.status).toBe('open');
    expect(lead.first_missed_call_id).toBe(id);
    expect(lead.missed_call_count).toBe(1);

    // One LEAD cadence.
    const { data: cadences } = await admin.from('cadences').select('*').eq('tenant_id', tenantId);
    expect(cadences).toHaveLength(1);
    const cadence = cadences![0] as Record<string, unknown>;
    expect(cadence.kind).toBe('lead');
    expect(cadence.lead_id).toBe(lead.id);
    expect(cadence.quote_id).toBeNull();
    expect(cadence.sm8_job_uuid).toBeNull();
    expect(cadence.created_by_event_id).toBeNull();
    expect(cadence.contact_mobile).toBe(caller);

    // Three touches: 1 sent at `now`, 2 and 3 scheduled (INERT until Phase 13).
    const { data: touches } = await admin
      .from('cadence_touches')
      .select('*')
      .eq('cadence_id', cadence.id as string)
      .order('touch_number');
    expect((touches ?? []).map((t) => [t.touch_number, t.status])).toEqual([
      [1, 'sent'],
      [2, 'scheduled'],
      [3, 'scheduled'],
    ]);
    expect(new Date(touches![0].scheduled_at as string).getTime()).toBe(now.getTime());

    // One APPROVED draft holding the attested bytes.
    const { data: tenantRow } = await admin.from('tenants').select('name').eq('id', tenantId).single();
    const attested = defaultTextBackBody('business_hours', (tenantRow as { name: string }).name);
    const { data: drafts } = await admin.from('touch_drafts').select('*').eq('tenant_id', tenantId);
    expect(drafts).toHaveLength(1);
    expect(drafts![0].status).toBe('approved');
    expect(drafts![0].final_body).toBe(attested);
    expect(drafts![0].generated_body).toBe(attested);
    expect(drafts![0].model).toBe('template');
    expect(drafts![0].quote_id).toBeNull();

    // One ledger row: touch 1, lead set, quote NULL, the DELEGATE's name, sent.
    const { data: ledger } = await admin.from('send_ledger').select('*').eq('tenant_id', tenantId);
    expect(ledger).toHaveLength(1);
    const claim = ledger![0] as Record<string, unknown>;
    expect(claim.touch_number).toBe(1);
    expect(claim.lead_id).toBe(lead.id);
    expect(claim.quote_id).toBeNull();
    expect(claim.cadence_id).toBe(cadence.id);
    expect(claim.channel).toBe('sms');
    expect(claim.to_address).toBe(caller);
    expect(claim.sender).toBe('clicksend');
    expect(claim.outcome).toBe('sent');
    expect(claim.provider_message_id).toBe(`cs-${(claim.id as string).slice(0, 8)}`);

    // Exactly ONE provider request, carrying the ledger id (ClickSend's
    // customString) and the attested bytes.
    expect(sender.sent).toHaveLength(1);
    const request = sender.sent[0];
    expect(request.ledgerId).toBe(claim.id);
    expect(request.quoteId).toBeNull();
    expect(request.leadId).toBe(lead.id);
    expect(request.touchNumber).toBe(1);
    expect(request.to.address).toBe(caller);
    expect(request.body).toBe(attested);

    // The missed call reads sent, route lead, with the three ids.
    const row = await missedCall(id);
    expect(row.text_back_status).toBe('sent');
    expect(row.text_back_skip_reason).toBeNull();
    expect(row.text_back_route).toBe('lead');
    expect(row.lead_id).toBe(lead.id);
    expect(row.cadence_id).toBe(cadence.id);
    expect(row.text_back_ledger_id).toBe(claim.id);
    expect(row.text_back_decided_at).not.toBeNull();
  });

  it('an after-hours call sends the after-hours wording', async () => {
    const { tenantId } = await armedTenant('Text-back After Hours');
    const now = new Date();
    const id = await call(tenantId, nextCaller(), now, { afterHours: true });
    const sender = new RecordingSender();

    expect((await sendTextBack(id, { now, getSender: async () => sender })).kind).toBe('sent');
    expect(sender.sent[0].body).toContain('We read replies in the morning');
  });
});

/* -------------------------------------------------------------------------- *
 * Idempotency and the claim arbiter (TXT-02, T-12-02)
 * -------------------------------------------------------------------------- */

describe('one call is decided once (TXT-02)', () => {
  it('a second sendTextBack for the same call is already_decided and sends nothing', async () => {
    const { tenantId } = await armedTenant('Text-back Replay');
    const now = new Date();
    const id = await call(tenantId, nextCaller(), now);
    const sender = new RecordingSender();

    expect((await sendTextBack(id, { now, getSender: async () => sender })).kind).toBe('sent');
    expect((await sendTextBack(id, { now, getSender: async () => sender })).kind).toBe(
      'already_decided',
    );
    expect(sender.sent).toHaveLength(1);
    expect(await countRows('send_ledger', tenantId)).toBe(1);
  });

  it('two CONCURRENT calls for one fresh row yield exactly one send', async () => {
    const { tenantId } = await armedTenant('Text-back Race');
    const now = new Date();
    const id = await call(tenantId, nextCaller(), now);
    const sender = new RecordingSender();

    const results = await Promise.all([
      sendTextBack(id, { now, getSender: async () => sender }),
      sendTextBack(id, { now, getSender: async () => sender }),
    ]);
    const kinds = results.map((r) => r.kind).sort();

    expect(kinds.filter((k) => k === 'sent')).toHaveLength(1);
    expect(['claim_lost', 'already_decided']).toContain(kinds.find((k) => k !== 'sent'));
    expect(sender.sent).toHaveLength(1);
    expect(await countRows('send_ledger', tenantId)).toBe(1);
    expect(await countRows('leads', tenantId)).toBe(1);
  });

  it('an unknown id is not_found; a dead letter is dead_letter — nothing written', async () => {
    const sender = new RecordingSender();
    expect((await sendTextBack(randomUUID(), { now: new Date(), getSender: async () => sender })).kind).toBe(
      'not_found',
    );

    const deadId = await seedMissedCall(null, {}, { caller: null });
    try {
      expect((await sendTextBack(deadId, { now: new Date(), getSender: async () => sender })).kind).toBe(
        'dead_letter',
      );
      expect((await missedCall(deadId)).text_back_status).toBeNull();
    } finally {
      await admin.from('missed_calls').delete().eq('id', deadId);
    }
    expect(sender.sent).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- *
 * Every recorded skip (TXT-03, D-06, D-15, D-20, D-02, D-08, D-22)
 * -------------------------------------------------------------------------- */

describe('every refusal is recorded and creates nothing else (TXT-03)', () => {
  it('not_armed: no enabled text_back row for the client', async () => {
    const tenantId = await seedTenant('Text-back Unarmed');
    tenantIds.push(tenantId);
    const now = new Date();
    const id = await call(tenantId, nextCaller(), now);
    const sender = new RecordingSender();
    let built = 0;

    const result = await sendTextBack(id, {
      now,
      getSender: async () => {
        built += 1;
        return sender;
      },
    });
    await expectSkip(tenantId, id, result, 'not_armed', sender);
    // An unarmed client costs no sender build at all.
    expect(built).toBe(0);
  });

  it.each([
    ['a never-text own-line entry', 'own_line'],
    ["the client's escalation phone", 'escalation'],
    ["the client's divert number", 'divert'],
    ['ForwardedFrom equal to the caller', 'forwarded'],
  ])('own_number: the caller is %s', async (_label, source) => {
    const { tenantId, divert } = await armedTenant(`Text-back Own ${source}`);
    const now = new Date();
    const caller =
      source === 'own_line'
        ? OWN_LINE
        : source === 'escalation'
          ? ESCALATION_E164
          : source === 'divert'
            ? divert
            : nextCaller();
    const id = await call(tenantId, caller, now, {
      forwardedFrom: source === 'forwarded' ? caller : null,
    });
    const sender = new RecordingSender();

    await expectSkip(tenantId, id, await sendTextBack(id, { now, getSender: async () => sender }), 'own_number', sender);
  });

  it('withheld: no caller number', async () => {
    const { tenantId } = await armedTenant('Text-back Withheld');
    const now = new Date();
    const id = await call(tenantId, null, now);
    const sender = new RecordingSender();
    await expectSkip(tenantId, id, await sendTextBack(id, { now, getSender: async () => sender }), 'withheld', sender);
  });

  it('not_mobile: a landline caller', async () => {
    const { tenantId } = await armedTenant('Text-back Landline');
    const now = new Date();
    const id = await call(tenantId, '+61891570190', now);
    const sender = new RecordingSender();
    await expectSkip(tenantId, id, await sendTextBack(id, { now, getSender: async () => sender }), 'not_mobile', sender);
  });

  it('suppressed: the caller texted STOP to this client', async () => {
    const { tenantId } = await armedTenant('Text-back Suppressed');
    const caller = nextCaller();
    await seedSuppression(tenantId, [{ channel: 'sms', address: caller, source: 'sms_stop' }]);
    const now = new Date();
    const id = await call(tenantId, caller, now);
    const sender = new RecordingSender();
    await expectSkip(tenantId, id, await sendTextBack(id, { now, getSender: async () => sender }), 'suppressed', sender);
  });

  it('recent_text: a prior text decided EXACTLY 24 hours ago still blocks', async () => {
    const { tenantId } = await armedTenant('Text-back Recent');
    const caller = nextCaller();
    const now = new Date();
    await priorTextBacks(tenantId, 1, new Date(now.getTime() - 24 * 3_600_000), 'sent', caller);
    const id = await call(tenantId, caller, now);
    const sender = new RecordingSender();

    const result = await sendTextBack(id, { now, getSender: async () => sender });
    expect(result.kind).toBe('skipped');
    expect((await missedCall(id)).text_back_skip_reason).toBe('recent_text');
    expect(sender.sent).toHaveLength(0);
  });

  it('recent_text: one millisecond older than 24 hours does NOT block', async () => {
    const { tenantId } = await armedTenant('Text-back Recent Edge');
    const caller = nextCaller();
    const now = new Date();
    await priorTextBacks(tenantId, 1, new Date(now.getTime() - 24 * 3_600_000 - 1), 'sent', caller);
    const id = await call(tenantId, caller, now);
    const sender = new RecordingSender();

    expect((await sendTextBack(id, { now, getSender: async () => sender })).kind).toBe('sent');
  });

  it(`daily_cap: ${TEXT_BACK_DAILY_CAP} prior text-backs in the rolling window blocks`, async () => {
    const { tenantId } = await armedTenant('Text-back Cap');
    const now = new Date();
    await priorTextBacks(tenantId, TEXT_BACK_DAILY_CAP, new Date(now.getTime() - 3_600_000));
    const id = await call(tenantId, nextCaller(), now);
    const sender = new RecordingSender();

    const result = await sendTextBack(id, { now, getSender: async () => sender });
    expect(result.kind).toBe('skipped');
    expect((await missedCall(id)).text_back_skip_reason).toBe('daily_cap');
    expect(sender.sent).toHaveLength(0);
  });

  it(`daily_cap: ${TEXT_BACK_DAILY_CAP - 1} prior sends — this call is the ${TEXT_BACK_DAILY_CAP}th and is sent; failed priors do not count`, async () => {
    const { tenantId } = await armedTenant('Text-back Cap Edge');
    const now = new Date();
    await priorTextBacks(tenantId, TEXT_BACK_DAILY_CAP - 1, new Date(now.getTime() - 3_600_000));
    // Failed sends consume neither rule.
    await priorTextBacks(tenantId, 5, new Date(now.getTime() - 3_600_000), 'failed');
    const id = await call(tenantId, nextCaller(), now);
    const sender = new RecordingSender();

    expect((await sendTextBack(id, { now, getSender: async () => sender })).kind).toBe('sent');
  });

  it('stale: a call that ended ten minutes and one second ago is never texted', async () => {
    const { tenantId } = await armedTenant('Text-back Stale');
    const now = new Date();
    const id = await call(tenantId, nextCaller(), now, { agoMs: 10 * 60_000 + 1_000 });
    const sender = new RecordingSender();
    await expectSkip(tenantId, id, await sendTextBack(id, { now, getSender: async () => sender }), 'stale', sender);
  });

  it('sms_not_armed: the client\'s SMS row is disabled', async () => {
    const tenantId = await seedTenant('Text-back No SMS');
    tenantIds.push(tenantId);
    configIds.push(await seedTextBackArmed(tenantId));
    configIds.push(await seedMessagingConfigOverride(tenantId, 'sms', { from_address: SMS_FROM }));
    await seedTextBackTemplates(tenantId);
    const now = new Date();
    const id = await call(tenantId, nextCaller(), now);
    const sender = new RecordingSender();

    await expectSkip(tenantId, id, await sendTextBack(id, { now, getSender: async () => sender }), 'sms_not_armed', sender);
  });

  it('sms_not_armed: the delegate provider is the STUB — a stub send is never a text-back (D-15)', async () => {
    const { tenantId } = await armedTenant('Text-back Stub');
    const now = new Date();
    const id = await call(tenantId, nextCaller(), now);
    const stub = new StubSender();

    const result = await sendTextBack(id, { now, getSender: async () => stub });
    await expectSkip(tenantId, id, result, 'sms_not_armed');
  });

  it('no_template: no attested wording for the variant', async () => {
    const tenantId = await seedTenant('Text-back No Template');
    tenantIds.push(tenantId);
    configIds.push(await seedTextBackArmed(tenantId));
    const sms = await upsertChannelConfig({ channel: 'sms', tenantId, fromAddress: SMS_FROM, enabled: true });
    configIds.push(sms.id);
    // Only an UNATTESTED version exists.
    await seedTextBackTemplates(tenantId, { attested: false });
    const now = new Date();
    const id = await call(tenantId, nextCaller(), now);
    const sender = new RecordingSender();

    await expectSkip(tenantId, id, await sendTextBack(id, { now, getSender: async () => sender }), 'no_template', sender);
  });

  it('an attested row edited by a NEWER UNATTESTED version still sends the attested bytes', async () => {
    const { tenantId } = await armedTenant('Text-back Attested Wins');
    const { data: tenantRow } = await admin.from('tenants').select('name').eq('id', tenantId).single();
    const name = (tenantRow as { name: string }).name;
    await seedTextBackTemplates(tenantId, {
      version: 2,
      attested: false,
      variants: ['business_hours'],
      bodies: {
        business_hours: `Hi, it's ${name}. Edited and never attested. Reply STOP to opt out. Privacy: backdesk.com.au/privacy`,
      },
    });
    const now = new Date();
    const id = await call(tenantId, nextCaller(), now);
    const sender = new RecordingSender();

    expect((await sendTextBack(id, { now, getSender: async () => sender })).kind).toBe('sent');
    expect(sender.sent[0].body).toBe(defaultTextBackBody('business_hours', name));
  });

  it('a caller with a live QUOTE cadence at this client gets the about-quote text on that cadence, and no lead (D-08, 12-05)', async () => {
    const { tenantId } = await armedTenant('Text-back Quote Open');
    const caller = nextCaller();
    const [quote] = await seedQuotes(tenantId, [{ job_description: 'hot water' }]);
    const cadenceId = await seedCadence(tenantId, quote.id, { contact_mobile: caller });
    const now = new Date();
    const id = await call(tenantId, caller, now);
    const sender = new RecordingSender();

    const result = await sendTextBack(id, { now, getSender: async () => sender });
    expect(result.kind).toBe('sent');
    const row = await missedCall(id);
    expect(row.text_back_route).toBe('quote');
    expect(row.cadence_id).toBe(cadenceId);
    expect(await countRows('leads', tenantId)).toBe(0);
    expect(await countRows('cadences', tenantId, { kind: 'lead' })).toBe(0);
    expect(await countRows('send_ledger', tenantId, { touch_number: 0 })).toBe(1);
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].touchNumber).toBe(0);
    expect(sender.sent[0].quoteId).toBe(quote.id);
    // The whole branch — pause, repeat call, alerting — is tests/text-back-quote.test.ts.
  });

  it('quote_open: a REPEAT call from that customer gets no second text, and stays on the quote cadence', async () => {
    const { tenantId } = await armedTenant('Text-back Quote Repeat');
    const caller = nextCaller();
    const [quote] = await seedQuotes(tenantId, [{ job_description: 'hot water' }]);
    const cadenceId = await seedCadence(tenantId, quote.id, { contact_mobile: caller });
    const now = new Date();
    const sender = new RecordingSender();
    expect((await sendTextBack(await call(tenantId, caller, now), { now, getSender: async () => sender })).kind).toBe(
      'sent',
    );

    // Past the 24-hour rule, so only the once-per-cadence touch-0 claim refuses it.
    const later = new Date(now.getTime() + 24 * 3_600_000 + 1);
    const id = await call(tenantId, caller, later);
    const result = await sendTextBack(id, { now: later, getSender: async () => sender });
    expect(result.kind).toBe('skipped');
    const row = await missedCall(id);
    expect(row.text_back_skip_reason).toBe('quote_open');
    expect(row.text_back_route).toBe('quote');
    expect(row.cadence_id).toBe(cadenceId);
    expect(await countRows('leads', tenantId)).toBe(0);
    expect(await countRows('send_ledger', tenantId)).toBe(1);
    expect(sender.sent).toHaveLength(1);
  });

  it('lead_open: a caller with an OPEN lead is skipped, and the lead counts the repeat call (D-22)', async () => {
    const { tenantId } = await armedTenant('Text-back Lead Open');
    const caller = nextCaller();
    const leadId = await seedLead(tenantId, { contact_mobile: caller });
    const now = new Date();
    const id = await call(tenantId, caller, now);
    const sender = new RecordingSender();

    const result = await sendTextBack(id, { now, getSender: async () => sender });
    expect(result.kind).toBe('skipped');
    expect((await missedCall(id)).text_back_skip_reason).toBe('lead_open');
    expect(sender.sent).toHaveLength(0);
    expect(await countRows('send_ledger', tenantId)).toBe(0);

    const { data: lead } = await admin.from('leads').select('*').eq('id', leadId).single();
    expect((lead as { missed_call_count: number }).missed_call_count).toBe(2);
    expect(new Date((lead as { last_missed_at: string }).last_missed_at).getTime()).toBe(now.getTime());
  });
});

/* -------------------------------------------------------------------------- *
 * Unknown and failed outcomes (D-04)
 * -------------------------------------------------------------------------- */

describe('an outcome is recorded once, and an unknown one is never resent (D-04)', () => {
  it('a sender that THROWS leaves the ledger outcome NULL and the call claimed: outcome_unknown', async () => {
    const { tenantId } = await armedTenant('Text-back Throws');
    const now = new Date();
    const id = await call(tenantId, nextCaller(), now);
    const sender = new ThrowingSender();

    expect((await sendTextBack(id, { now, getSender: async () => sender })).kind).toBe('outcome_unknown');
    expect(sender.calls).toBe(1);

    const { data: ledger } = await admin.from('send_ledger').select('*').eq('tenant_id', tenantId);
    expect(ledger).toHaveLength(1);
    expect(ledger![0].outcome).toBeNull();
    expect((await missedCall(id)).text_back_status).toBe('claimed');

    // And nothing re-sends it: a second attempt is already_decided.
    expect((await sendTextBack(id, { now, getSender: async () => sender })).kind).toBe('already_decided');
    expect(sender.calls).toBe(1);
  });

  it('a FAILED outcome is recorded failed with a CHECK-safe code, and does not block a later call', async () => {
    const { tenantId } = await armedTenant('Text-back Failed');
    const caller = nextCaller();
    const now = new Date();
    const id = await call(tenantId, caller, now);
    const failing = new RecordingSender('clicksend', () => ({
      kind: 'failed',
      provider: 'clicksend',
      reason: 'Insufficient credit for +61491570199',
      retryable: false,
    }));

    expect((await sendTextBack(id, { now, getSender: async () => failing })).kind).toBe('failed');
    const row = await missedCall(id);
    expect(row.text_back_status).toBe('failed');
    expect(row.text_back_detail).toMatch(/^[A-Za-z0-9_]{1,48}$/);
    expect(String(row.text_back_detail)).not.toContain('614');
    const { data: ledger } = await admin.from('send_ledger').select('outcome').eq('tenant_id', tenantId);
    expect(ledger![0].outcome).toBe('failed');

    // The 24-hour rule and the cap ignore failed sends. (Nothing in Phase 12
    // closes a lead — D-22 — so the open lead is closed here by hand to let the
    // later call reach the sender rather than the lead arbiter.)
    //
    // 2026-10 (Phase 13, found by 13-02's CI): migration 0040's
    // `leads_closed_iff_reason` requires a closed lead to carry its reason and
    // `leads_closed_at_with_reason` its time, so a bare `status: 'closed'` is
    // now refused — and this unchecked update used to leave the lead OPEN, the
    // later call skipped `lead_open`. Closed the way `closeLead` closes it, by
    // the operator, and the write is now checked so a refusal cannot hide again.
    const { error: closeError } = await admin
      .from('leads')
      .update({ status: 'closed', closed_reason: 'operator', closed_at: now.toISOString() })
      .eq('tenant_id', tenantId);
    expect(closeError).toBeNull();
    await admin
      .from('cadences')
      .update({ status: 'stopped', stop_reason: 'operator_closed' })
      .eq('tenant_id', tenantId);
    const later = new Date(now.getTime() + 60_000);
    const secondId = await call(tenantId, caller, later);
    const sender = new RecordingSender();
    expect((await sendTextBack(secondId, { now: later, getSender: async () => sender })).kind).toBe('sent');
  });

  it('a stub that somehow sends is recorded FAILED, never sent (D-15 second belt)', async () => {
    // A sender that claims to be ClickSend at claim time but answers as the
    // stub: the gate cannot see it, so the outcome mapping must.
    const { tenantId } = await armedTenant('Text-back Stub Outcome');
    const now = new Date();
    const id = await call(tenantId, nextCaller(), now);
    const liar = new RecordingSender('clicksend', () => ({
      kind: 'sent',
      provider: 'stub',
      providerMessageId: null,
    }));

    expect((await sendTextBack(id, { now, getSender: async () => liar })).kind).toBe('failed');
    expect((await missedCall(id)).text_back_status).toBe('failed');
    const { data: ledger } = await admin.from('send_ledger').select('outcome').eq('tenant_id', tenantId);
    expect(ledger![0].outcome).toBe('failed');
  });
});

/* -------------------------------------------------------------------------- *
 * Disarm is honoured on the next call (D-09)
 * -------------------------------------------------------------------------- */

describe('a disarm takes effect on the next call (D-09)', () => {
  it('the second call after the switch goes off is skipped not_armed', async () => {
    const { tenantId, textBackConfigId } = await armedTenant('Text-back Disarm');
    const now = new Date();
    const sender = new RecordingSender();

    const first = await call(tenantId, nextCaller(), now);
    expect((await sendTextBack(first, { now, getSender: async () => sender })).kind).toBe('sent');

    await admin.from('messaging_config').update({ enabled: false }).eq('id', textBackConfigId);

    const second = await call(tenantId, nextCaller(), now);
    expect((await sendTextBack(second, { now, getSender: async () => sender })).kind).toBe('skipped');
    expect((await missedCall(second)).text_back_skip_reason).toBe('not_armed');
    expect(sender.sent).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- *
 * What the DATABASE refuses (0039)
 * -------------------------------------------------------------------------- */

describe('the 0039 constraints refuse what the code must never write', () => {
  let tenantId: string;

  beforeAll(async () => {
    tenantId = await seedTenant('Text-back Constraints');
    tenantIds.push(tenantId);
  });

  it('a ledger row with BOTH owners, or NEITHER, is refused (send_ledger_one_owner)', async () => {
    const base = {
      tenant_id: tenantId,
      cadence_id: randomUUID(),
      touch_number: 1,
      channel: 'sms',
      to_address: '+61491570198',
      sender: 'clicksend',
    };
    const both = await admin.from('send_ledger').insert({ ...base, quote_id: randomUUID(), lead_id: randomUUID() });
    expect(both.error?.message).toContain('send_ledger_one_owner');
    const neither = await admin.from('send_ledger').insert({ ...base, cadence_id: randomUUID() });
    expect(neither.error?.message).toContain('send_ledger_one_owner');
  });

  it('an escalation with BOTH triggers, or NEITHER, is refused (escalations_one_trigger)', async () => {
    const base = {
      tenant_id: tenantId,
      cadence_id: randomUUID(),
      quote_id: randomUUID(),
      to_address: '',
    };
    const both = await admin
      .from('escalations')
      .insert({ ...base, inbound_message_id: randomUUID(), missed_call_id: randomUUID() });
    expect(both.error?.message).toContain('escalations_one_trigger');
    const neither = await admin.from('escalations').insert(base);
    expect(neither.error?.message).toContain('escalations_one_trigger');
  });

  it('a tenant-less text_back row is refused (messaging_config_text_back_per_tenant)', async () => {
    const { error } = await admin
      .from('messaging_config')
      .insert({ channel: 'text_back', tenant_id: null, enabled: false });
    expect(error?.message).toContain('messaging_config_text_back_per_tenant');
  });

  it('a missed call with a skip reason and a non-skipped status is refused', async () => {
    const { error } = await admin.from('missed_calls').insert({
      tenant_id: tenantId,
      provider_call_id: `CA${randomUUID().replace(/-/g, '')}`,
      called_number_e164: '+61891570156',
      caller_e164: '+61491570197',
      caller_kind: 'mobile',
      started_at: new Date().toISOString(),
      after_hours: false,
      source: 'webhook',
      text_back_status: 'sent',
      text_back_skip_reason: 'not_armed',
    });
    expect(error?.message).toContain('missed_calls_skip_reason_iff_skipped');
  });

  it('tenant_proofs refuses kind text_back and accepts text_back_proof', async () => {
    const recordedBy = await ensureOperatorExists();
    const refused = await admin.from('tenant_proofs').insert({
      tenant_id: tenantId,
      kind: 'text_back',
      artefact_id: 'long-enough-to-pass',
      note: 'must be refused',
      recorded_by: recordedBy,
    });
    expect(refused.error?.message).toContain('tenant_proofs_kind_known');

    const accepted = await admin.from('tenant_proofs').insert({
      tenant_id: tenantId,
      kind: 'text_back_proof',
      artefact_id: randomUUID(),
      note: 'a delivered text-back',
      recorded_by: recordedBy,
    });
    expect(accepted.error).toBeNull();
  });

  it('a lead cadence carrying a quote is refused (cadences_kind_identity)', async () => {
    const { error } = await admin.from('cadences').insert({
      tenant_id: tenantId,
      kind: 'lead',
      lead_id: randomUUID(),
      quote_id: randomUUID(),
      status: 'stopped',
      stop_reason: 'operator_closed',
      anchor_at: new Date().toISOString(),
    });
    expect(error?.message).toContain('cadences_kind_identity');
  });
});
