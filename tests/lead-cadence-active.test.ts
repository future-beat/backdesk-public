/**
 * D-01/D-03/D-04/D-15 — A LEAD CADENCE'S TOUCHES 2 AND 3 ARE LIVE: DRAFTED,
 * APPROVABLE, DISPATCHED INSIDE HOURS, AND THE LEAD CLOSED AFTER TOUCH 3
 * (Phase 13, plan 13-02 — the tracer; LEAD-01, LEAD-05).
 *
 * ── THE RULE THIS PROVES ────────────────────────────────────────────────────
 *
 * This file REPLACES `lead-cadence-inert.test.ts` (D-17: replaced, not deleted
 * silently). Phase 12 held a lead's touches 2 and 3 inert behind `kind =
 * 'quote'` predicates (D-19). Plan 13-02 flipped them: the touches are now
 * promoted, drafted from the client's approved LEAD wording (seeded at first
 * use) with prompt version `p5`, parked for a human, approved through the same
 * core the /queue actions call, and dispatched by the same dispatch path — whose
 * FIRST statement is now the lead branch. The REAL `runCadenceTick` runs over:
 *
 *   - THE TRACER: a texted caller whose touch 2 is due inside the window —
 *     drafted on tick 1, approved, dispatched on tick 2 with its ledger row
 *     owned by the lead (`lead_id` set, `quote_id` NULL);
 *   - touch 3 sent, the cadence completed and the lead closed
 *     `touches_exhausted` — and never texted again;
 *   - the 02:00 fallback slot moved into the window's morning (D-04);
 *   - a lead anchored 8 days ago expired under `LEAD_EXPIRY_DAYS`, its lead
 *     expired in the same transaction; one anchored 6 days ago untouched (D-15);
 *   - the dispatch lead branch refusing `lead_closed` for a closed lead, a
 *     failed text-back and a caller who is also on a live quote cadence
 *     (`quote_cadence_wins`) (D-10, D-14);
 *   - and, carried verbatim, the D-19 CONTROL: a quote cadence in the same
 *     tenant and tick dispatched exactly as before.
 *
 * ── THE IRREVERSIBLE STOP IT STILL GUARDS AGAINST ───────────────────────────
 *
 * A lead touch that reached the QUOTE branch of `dispatchOne` would be looked
 * up by its NULL `sm8_job_uuid`, find no mirrored quote, and be STOPPED as
 * `mirror_missing` — a stop no resume path can undo. The kind switch is the
 * first statement of `dispatchOne` precisely so that cannot happen, and every
 * tick in this file asserts `refusals.mirror_missing` is 0.
 *
 * A tick that never returns is the symptom of a close opening a transaction
 * inside the expiry or dispatch transaction (checker B1). Every tick here runs
 * inside a hook with a bounded timeout, so a hang fails the suite loudly.
 *
 * ── DB-BACKED, AND CI IS THE ONLY PLACE IT RUNS ─────────────────────────────
 *
 * It refuses a non-local target through `tests/helpers/env.ts` and MUST NEVER
 * run through `npm run test:remote`: the hosted Sydney project is production.
 * The sender is a recording stub and the drafting model is a fake that answers
 * with the shipped lead wording (`classifyClient` is `null`, `attribution` is
 * left at its `'skip'` default, and no escalation sender is passed), so nothing
 * leaves the runner. Clocks are pinned and passed through the tick's `now`.
 *
 * The passes are global, so every assertion is keyed on this suite's own ids.
 * Every number is from ACMA's fiction block (0491 570 1xx).
 */
import { TZDate } from '@date-fns/tz';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { approveUnchanged } from '../src/core/approval/approve-draft';
import { CADENCE_CONSUMER } from '../src/core/cadence/constants';
import { runCadenceTick } from '../src/core/cadence/run-tick';
import type { SendOutcome, SendRequest, TouchSender } from '../src/core/cadence/sender';
import type { CadenceTickResult } from '../src/core/cadence/run-tick';
import type { DraftClient } from '../src/core/drafting/draft-touches';
import { DEFAULT_LEAD_TEMPLATE_BODIES } from '../src/core/leads/lead-templates';
import { closeDb } from '../src/db/repository';

import {
  admin,
  seedApprovedDraft,
  seedCadence,
  seedCadenceSettings,
  seedConnection,
  seedLead,
  seedLeadCadence,
  seedLedgerRow,
  seedQuotes,
  seedTenant,
  seedTouches,
  teardownTenants,
} from './helpers/seed';

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const MS_PER_MINUTE = 60_000;

const ZONE = 'Australia/Perth';

/** A Perth wall-clock moment. The seeded window is 08:00–17:00, Monday to Friday. */
function perth(year: number, month: number, day: number, hours: number, minutes = 0): Date {
  return new Date(new TZDate(year, month - 1, day, hours, minutes, 0, ZONE).getTime());
}

function at(base: Date, ms: number): Date {
  return new Date(base.getTime() + ms);
}

/** THE PINNED CLOCK: Wednesday 7 October 2026, 10:00 in Perth — inside the window. */
const T = perth(2026, 10, 7, 10);

/** Fiction-block mobiles, one per caller so `leads_one_open_per_mobile` never meets itself. */
const LEAD_CALLER = '+61491570171';
const QUOTE_CUSTOMER = '+61491570173';
const EXHAUSTED_CALLER = '+61491570174';
const NIGHT_CALLER = '+61491570175';
const EXPIRED_CALLER = '+61491570176';
const RECENT_CALLER = '+61491570177';
const CLOSED_CALLER = '+61491570178';
const FAILED_CALLER = '+61491570179';
const BOTH_CALLER = '+61491570180';

/** A sender that records every request and answers `sent`. */
class RecordingSender implements TouchSender {
  readonly provider = 'stub';
  readonly sent: SendRequest[] = [];

  async send(request: SendRequest): Promise<SendOutcome> {
    this.sent.push(request);
    return { kind: 'sent', provider: this.provider, providerMessageId: null };
  }
}

/**
 * The drafting model, faked in the `tests/cadence-tick.test.ts` shape: it
 * answers each call with the shipped lead wording for the touch the user turn
 * names — the client's voice, as far as a fake can — and records every
 * request so the suite can see which instructions it was given.
 */
function fakeLeadDraftClient(): DraftClient & { systems: string[]; users: string[] } {
  const client = {
    systems: [] as string[],
    users: [] as string[],
    messages: {
      parse: async (body: unknown) => {
        const request = body as { system: Array<{ text: string }>; messages: Array<{ content: string }> };
        client.systems.push(request.system.map((block) => block.text).join('\n'));
        const user = request.messages[0]?.content ?? '';
        client.users.push(user);
        const touch = user.includes('Write touch 3') ? 3 : 2;
        return {
          parsed_output: { body: DEFAULT_LEAD_TEMPLATE_BODIES[touch] },
          stop_reason: 'end_turn',
          usage: { input_tokens: 900, output_tokens: 30, cache_read_input_tokens: 0 },
        };
      },
    },
  };
  return client;
}

interface TouchRow {
  id: string;
  touch_number: number;
  status: string;
  scheduled_at: string;
  skip_reason: string | null;
}

interface LeadRow {
  status: string;
  closed_reason: string | null;
  closed_at: string | null;
}

async function touchesOf(cadenceId: string): Promise<TouchRow[]> {
  const { data, error } = await admin
    .from('cadence_touches')
    .select('id, touch_number, status, scheduled_at, skip_reason')
    .eq('cadence_id', cadenceId)
    .order('touch_number', { ascending: true });
  if (error) throw new Error(`Reading touches failed: ${error.message}`);
  return (data ?? []) as TouchRow[];
}

async function cadenceStatus(cadenceId: string): Promise<{ status: string; stop_reason: string | null }> {
  const { data, error } = await admin
    .from('cadences')
    .select('status, stop_reason')
    .eq('id', cadenceId)
    .single();
  if (error) throw new Error(`Reading the cadence failed: ${error.message}`);
  return data as { status: string; stop_reason: string | null };
}

async function ledgerTouchNumbers(cadenceId: string): Promise<number[]> {
  const { data, error } = await admin
    .from('send_ledger')
    .select('touch_number')
    .eq('cadence_id', cadenceId)
    .order('touch_number', { ascending: true });
  if (error) throw new Error(`Reading the ledger failed: ${error.message}`);
  return ((data ?? []) as Array<{ touch_number: number }>).map((r) => r.touch_number);
}

async function ledgerRow(
  cadenceId: string,
  touchNumber: number,
): Promise<{ lead_id: string | null; quote_id: string | null } | null> {
  const { data, error } = await admin
    .from('send_ledger')
    .select('lead_id, quote_id')
    .eq('cadence_id', cadenceId)
    .eq('touch_number', touchNumber)
    .maybeSingle();
  if (error) throw new Error(`Reading a ledger row failed: ${error.message}`);
  return data as { lead_id: string | null; quote_id: string | null } | null;
}

async function leadOf(leadId: string): Promise<LeadRow> {
  const { data, error } = await admin
    .from('leads')
    .select('status, closed_reason, closed_at')
    .eq('id', leadId)
    .single();
  if (error) throw new Error(`Reading the lead failed: ${error.message}`);
  return data as LeadRow;
}

/** Park the shared cadence cursor at the outbox head: this tick consumes nothing. */
async function parkCursorAtHead(): Promise<void> {
  const { data, error } = await admin
    .from('quote_status_events')
    .select('id')
    .order('id', { ascending: false })
    .limit(1);
  if (error) throw new Error(`Reading the outbox head failed: ${error.message}`);

  const { error: upsertError } = await admin
    .from('event_consumer_cursors')
    .upsert(
      { consumer: CADENCE_CONSUMER, last_event_id: (data?.[0]?.id as number | undefined) ?? 0 },
      { onConflict: 'consumer' },
    );
  if (upsertError) throw new Error(`Parking the cursor failed: ${upsertError.message}`);
}

/**
 * A tenant the tick can see: the seeded 08:00–17:00 Monday–Friday Perth
 * window, a ServiceM8 connection (`forAllTenants_cadenceTick` INNER JOINs it)
 * and a voice profile (drafting refuses a tenant with none).
 */
async function tickableTenant(prefix: string): Promise<string> {
  const id = await seedTenant(prefix);
  await seedConnection(id);
  await seedCadenceSettings(id, { greeting_style: 'No name', sign_off: 'None' });
  return id;
}

/**
 * A texted caller: an OPEN lead (unless overridden), a lead cadence, the
 * touches given, and touch 1's ledger row — the text-back as Phase 12 records
 * it, owned by the lead (`quote_id` NULL).
 */
async function textedCaller(
  tenantId: string,
  options: {
    mobile: string;
    anchorAt: Date;
    touches: Array<Record<string, unknown>>;
    leadOverrides?: Record<string, unknown>;
    touchOneOutcome?: string;
  },
): Promise<{ leadId: string; cadenceId: string; touches: Array<{ id: string; touch_number: number }> }> {
  const leadId = await seedLead(tenantId, {
    contact_mobile: options.mobile,
    first_missed_at: options.anchorAt.toISOString(),
    last_missed_at: options.anchorAt.toISOString(),
    ...options.leadOverrides,
  });
  const cadenceId = await seedLeadCadence(tenantId, leadId, {
    contact_mobile: options.mobile,
    anchor_at: options.anchorAt.toISOString(),
  });
  const touches = await seedTouches(cadenceId, tenantId, options.touches);
  await seedLedgerRow(tenantId, {
    cadenceId,
    quoteId: null,
    leadId,
    touchNumber: 1,
    claimedAt: options.anchorAt.toISOString(),
    toAddress: options.mobile,
    outcome: options.touchOneOutcome ?? 'sent',
  });
  return { leadId, cadenceId, touches };
}

// ── THE TRACER ──────────────────────────────────────────────────────────────

let tenantId: string;

/** The tracer's lead, cadence and touch 2. */
let leadId: string;
let leadCadenceId: string;
let leadTouchTwoId: string;

/** The control. */
let quoteCadenceId: string;
let quoteTouchId: string;
let quoteBody: string;

const sender = new RecordingSender();
const draftClient = fakeLeadDraftClient();
/** Tick 1, at T: the lead's touch 2 is drafted; the quote control is dispatched. */
let result: CadenceTickResult;
/** Tick 2, at T + 1 min: the approved lead touch 2 is dispatched. */
let secondResult: CadenceTickResult;

/** What tick 1 left behind, read before anything else moved it. */
let afterTickOne: {
  touches: TouchRow[];
  draft: { id: string; prompt_version: string; quote_id: string | null; status: string; final_body: string } | null;
  leadTemplates: Array<{ touch_number: number; kind: string; approved_at: string | null }>;
  sentToLead: number;
};
let approval: Awaited<ReturnType<typeof approveUnchanged>>;

beforeAll(async () => {
  tenantId = await tickableTenant('Lead Active');
  await parkCursorAtHead();

  // ── THE TEXTED CALLER: touch 1 sent 25 h ago, touch 2 due 30 min ago ──
  // No lead template rows are seeded: the drafting pass's belt must seed them.
  const caller = await textedCaller(tenantId, {
    mobile: LEAD_CALLER,
    anchorAt: at(T, -25 * MS_PER_HOUR),
    touches: [
      { status: 'sent', scheduled_at: at(T, -25 * MS_PER_HOUR).toISOString(), original_offset_days: 0 },
      { status: 'scheduled', scheduled_at: at(T, -30 * MS_PER_MINUTE).toISOString(), original_offset_days: 1 },
      { status: 'scheduled', scheduled_at: at(T, 23.5 * MS_PER_HOUR).toISOString(), original_offset_days: 2 },
    ],
  });
  leadId = caller.leadId;
  leadCadenceId = caller.cadenceId;
  leadTouchTwoId = caller.touches[1].id;
  // Touch 1's stored body, as the text-back writes it: "what touch 1 said" (D-13).
  await seedApprovedDraft(tenantId, leadCadenceId, caller.touches[0].id, 1, {
    final_body: 'Sorry we missed your call. We will get back to you shortly. Reply STOP to opt out.',
    model: 'template',
    prompt_version: 'text-back-template-1',
  });

  // ── THE CONTROL: a quote cadence of the SAME tenant, approved and due ──
  const [quote] = await seedQuotes(tenantId, [
    { job_description: 'lead-active: the quote control', chase_eligibility: 'eligible' },
  ]);
  quoteCadenceId = await seedCadence(tenantId, quote.id, {
    sm8_job_uuid: quote.sm8_job_uuid,
    contact_name: 'Robin Vasquez',
    contact_mobile: QUOTE_CUSTOMER,
    anchor_at: at(T, -MS_PER_DAY).toISOString(),
  });
  const [quoteTouch] = await seedTouches(quoteCadenceId, tenantId, [
    {
      status: 'approved',
      scheduled_at: at(T, -5 * MS_PER_MINUTE).toISOString(),
      original_offset_days: 0,
    },
  ]);
  quoteTouchId = quoteTouch.id;
  quoteBody = await seedApprovedDraft(tenantId, quoteCadenceId, quoteTouch.id, 1, {
    final_body: 'Quote control follow-up. Reply STOP to opt out.',
  });

  // ── TICK 1, at T ──
  result = await runCadenceTick({
    draftClient,
    classifyClient: null,
    now: T,
    jitterMinutes: () => 0,
    sender,
  });

  const { data: drafts, error: draftError } = await admin
    .from('touch_drafts')
    .select('id, prompt_version, quote_id, status, final_body')
    .eq('touch_id', leadTouchTwoId)
    .order('attempt', { ascending: false });
  if (draftError) throw new Error(`Reading the draft failed: ${draftError.message}`);
  const { data: templates, error: templateError } = await admin
    .from('message_templates')
    .select('touch_number, kind, approved_at')
    .eq('tenant_id', tenantId)
    .eq('kind', 'lead')
    .order('touch_number', { ascending: true });
  if (templateError) throw new Error(`Reading the templates failed: ${templateError.message}`);

  afterTickOne = {
    touches: await touchesOf(leadCadenceId),
    draft: (drafts?.[0] as typeof afterTickOne.draft) ?? null,
    leadTemplates: (templates ?? []) as typeof afterTickOne.leadTemplates,
    sentToLead: sender.sent.filter((r) => r.cadenceId === leadCadenceId).length,
  };

  // ── THE HUMAN: approved through the core the /queue actions call ──
  approval = await approveUnchanged({
    tenantId,
    touchId: leadTouchTwoId,
    draftId: afterTickOne.draft?.id ?? '',
  });

  // ── TICK 2, at T + 1 min ──
  secondResult = await runCadenceTick({
    draftClient,
    classifyClient: null,
    now: at(T, MS_PER_MINUTE),
    jitterMinutes: () => 0,
    sender,
  });
}, 120_000);

afterAll(async () => {
  await teardownTenants([tenantId]);
  await closeDb();
}, 60_000);

describe('the tracer: a lead touch 2 is promoted and drafted from the lead wording (D-02, D-13)', () => {
  it('promotes and drafts touch 2 on tick 1 — p5, no quote, waiting on a human — and sends nothing', () => {
    expect(afterTickOne.draft).not.toBeNull();
    expect(afterTickOne.draft?.prompt_version).toBe('p5');
    expect(afterTickOne.draft?.quote_id).toBeNull();
    expect(afterTickOne.draft?.status).toBe('generated');
    expect(afterTickOne.touches[1].status).toBe('pending_approval');
    expect(afterTickOne.sentToLead).toBe(0);
  });

  it('the draft is the lead wording plus the mechanical compliance line (identity + STOP)', () => {
    expect(afterTickOne.draft?.final_body.startsWith(DEFAULT_LEAD_TEMPLATE_BODIES[2])).toBe(true);
    expect(afterTickOne.draft?.final_body).toMatch(/Reply STOP to opt out\.$/);
  });

  it('was drafted under the LEAD instructions, with the missed-call facts in the user turn', () => {
    const forTouchTwo = draftClient.users.findIndex((u) => u.includes('Write touch 2'));
    expect(forTouchTwo).toBeGreaterThanOrEqual(0);
    expect(draftClient.systems[forTouchTwo]).toContain('after a missed call');
    expect(draftClient.systems[forTouchTwo]).not.toContain('chasing an open quote');
    expect(draftClient.users[forTouchTwo]).toContain('Kind of message: follow-up after a missed call');
    expect(draftClient.users[forTouchTwo]).toContain('Days since the call: 1');
  });

  it('seeded the client\'s lead wording at first use: two approved kind-lead rows, touches 2 and 3', () => {
    expect(afterTickOne.leadTemplates.map((t) => t.touch_number)).toEqual([2, 3]);
    expect(afterTickOne.leadTemplates.every((t) => t.kind === 'lead' && t.approved_at !== null)).toBe(
      true,
    );
  });

  it('is approvable through approveUnchanged, the core the queue actions call', () => {
    expect(approval).toEqual({ kind: 'approved', edited: false });
  });
});

describe('the tracer: the approved lead touch 2 is dispatched inside hours, owned by the lead (D-01)', () => {
  it('sends exactly one request for this cadence, with leadId set and quoteId null, carrying the approved bytes', async () => {
    const mine = sender.sent.filter((r) => r.cadenceId === leadCadenceId);
    expect(mine).toHaveLength(1);
    expect(mine[0].leadId).toBe(leadId);
    expect(mine[0].quoteId).toBeNull();
    expect(mine[0].touchNumber).toBe(2);
    expect(mine[0].to.address).toBe(LEAD_CALLER);
    expect(mine[0].body).toBe(afterTickOne.draft?.final_body);
  });

  it('writes the touch 2 ledger row with lead_id set and quote_id NULL', async () => {
    expect(await ledgerRow(leadCadenceId, 2)).toEqual({ lead_id: leadId, quote_id: null });
    expect((await touchesOf(leadCadenceId))[1].status).toBe('sent');
  });

  it('never reaches the quote branch — no mirror_missing stop, no lead_closed refusal, on either tick', () => {
    expect(result.refusals.mirror_missing).toBe(0);
    expect(secondResult.refusals.mirror_missing).toBe(0);
    expect(result.refusals.lead_closed).toBe(0);
    expect(secondResult.refusals.lead_closed).toBe(0);
  });

  it('leaves the cadence active and the lead open — touch 3 is still to come', async () => {
    expect(await cadenceStatus(leadCadenceId)).toEqual({ status: 'active', stop_reason: null });
    expect((await leadOf(leadId)).status).toBe('open');
  });
});

// ── AFTER TOUCH 3: the cadence completes and the lead closes for good (D-01, D-14)

describe('after touch 3 is sent the lead is closed touches_exhausted and never texted again', () => {
  let exhaustedTenant = '';
  let exhaustedLeadId = '';
  let exhaustedCadenceId = '';
  const exhaustedSender = new RecordingSender();
  let first: CadenceTickResult;
  let second: CadenceTickResult;
  let leadAfterFirst: LeadRow;

  beforeAll(async () => {
    exhaustedTenant = await tickableTenant('Lead Exhausted');
    const caller = await textedCaller(exhaustedTenant, {
      mobile: EXHAUSTED_CALLER,
      anchorAt: at(T, -49 * MS_PER_HOUR),
      touches: [
        { status: 'sent', scheduled_at: at(T, -49 * MS_PER_HOUR).toISOString(), original_offset_days: 0 },
        { status: 'sent', scheduled_at: at(T, -25 * MS_PER_HOUR).toISOString(), original_offset_days: 1 },
        { status: 'approved', scheduled_at: at(T, -30 * MS_PER_MINUTE).toISOString(), original_offset_days: 2 },
      ],
    });
    exhaustedLeadId = caller.leadId;
    exhaustedCadenceId = caller.cadenceId;
    await seedLedgerRow(exhaustedTenant, {
      cadenceId: exhaustedCadenceId,
      quoteId: null,
      leadId: exhaustedLeadId,
      touchNumber: 2,
      claimedAt: at(T, -25 * MS_PER_HOUR).toISOString(),
      toAddress: EXHAUSTED_CALLER,
    });
    await seedApprovedDraft(exhaustedTenant, exhaustedCadenceId, caller.touches[2].id, 3, {
      final_body: 'Last one from us. Lead Exhausted. Reply STOP to opt out.',
    });

    first = await runCadenceTick({
      draftClient: null,
      classifyClient: null,
      now: T,
      jitterMinutes: () => 0,
      sender: exhaustedSender,
    });
    leadAfterFirst = await leadOf(exhaustedLeadId);
    second = await runCadenceTick({
      draftClient: null,
      classifyClient: null,
      now: at(T, MS_PER_MINUTE),
      jitterMinutes: () => 0,
      sender: exhaustedSender,
    });
  }, 120_000);

  afterAll(async () => {
    await teardownTenants([exhaustedTenant]);
  }, 60_000);

  it('sends touch 3 and the completion sweep completes the cadence', async () => {
    expect(exhaustedSender.sent.filter((r) => r.cadenceId === exhaustedCadenceId)).toHaveLength(1);
    expect((await touchesOf(exhaustedCadenceId)).map((t) => t.status)).toEqual(['sent', 'sent', 'sent']);
    expect((await cadenceStatus(exhaustedCadenceId)).status).toBe('completed');
    expect(first.refusals.mirror_missing).toBe(0);
  });

  it('closes the lead touches_exhausted, with closed_at set, in the same tick', () => {
    expect(leadAfterFirst.status).toBe('closed');
    expect(leadAfterFirst.closed_reason).toBe('touches_exhausted');
    expect(leadAfterFirst.closed_at).not.toBeNull();
    expect(first.leadsClosed).toBeGreaterThanOrEqual(1);
  });

  it('a further tick sends nothing for that lead and closes nothing again', async () => {
    expect(exhaustedSender.sent.filter((r) => r.cadenceId === exhaustedCadenceId)).toHaveLength(1);
    expect(await ledgerTouchNumbers(exhaustedCadenceId)).toEqual([1, 2, 3]);
    expect(second.leadsClosed).toBe(0);
    expect(await leadOf(exhaustedLeadId)).toEqual(leadAfterFirst);
  });
});

// ── D-04: a 02:00 fallback slot is moved into the window, never sent at 02:00

describe('a lead touch 2 scheduled at 02:00 is re-windowed into the morning, never sent at 02:00 (D-04)', () => {
  let nightTenant = '';
  let nightCadenceId = '';
  let nightTouchTwoId = '';
  const nightSender = new RecordingSender();
  let tick: CadenceTickResult;

  /** The call: Wednesday 02:00. The fallback shape is plain day offsets from it. */
  const CALL = perth(2026, 10, 7, 2);
  /** The tick: Thursday 02:05, before the window opens at 08:00. */
  const NIGHT = perth(2026, 10, 8, 2, 5);

  beforeAll(async () => {
    nightTenant = await tickableTenant('Lead Night');
    const caller = await textedCaller(nightTenant, {
      mobile: NIGHT_CALLER,
      anchorAt: CALL,
      leadOverrides: { after_hours: true },
      touches: [
        { status: 'sent', scheduled_at: CALL.toISOString(), original_offset_days: 0 },
        // `leadSchedule`'s catch fallback: now + 1 day, i.e. 02:00 Thursday.
        { status: 'approved', scheduled_at: at(CALL, MS_PER_DAY).toISOString(), original_offset_days: 1 },
        { status: 'scheduled', scheduled_at: at(CALL, 2 * MS_PER_DAY).toISOString(), original_offset_days: 2 },
      ],
    });
    nightCadenceId = caller.cadenceId;
    nightTouchTwoId = caller.touches[1].id;
    // Approved bytes behind it, so that if anything let it through at 02:00 the
    // failure would be a real send rather than a refusal for want of a body.
    await seedApprovedDraft(nightTenant, nightCadenceId, nightTouchTwoId, 2, {
      final_body: 'Following up on your call. Lead Night. Reply STOP to opt out.',
    });

    tick = await runCadenceTick({
      draftClient: null,
      classifyClient: null,
      now: NIGHT,
      jitterMinutes: () => 0,
      sender: nightSender,
    });
  }, 120_000);

  afterAll(async () => {
    await teardownTenants([nightTenant]);
  }, 60_000);

  it('moves touch 2 to the window\'s preferred slot that morning (Thursday 09:30)', async () => {
    const touch = (await touchesOf(nightCadenceId)).find((t) => t.id === nightTouchTwoId);
    expect(new Date(touch?.scheduled_at ?? 0).getTime()).toBe(perth(2026, 10, 8, 9, 30).getTime());
    expect(touch?.status).toBe('approved');
    expect(touch?.skip_reason).toBeNull();
  });

  it('writes no ledger row for touch 2 and sends nothing', async () => {
    expect(await ledgerTouchNumbers(nightCadenceId)).toEqual([1]);
    expect(nightSender.sent.filter((r) => r.cadenceId === nightCadenceId)).toEqual([]);
    expect(tick.refusals.mirror_missing).toBe(0);
  });
});

// ── D-15: a lead expires under the LEAD expiry, and its lead with it ────────

describe('a lead cadence older than LEAD_EXPIRY_DAYS is expired, and its lead expired in the same transaction (D-15)', () => {
  let expiryTenant = '';
  let oldLeadId = '';
  let oldCadenceId = '';
  let recentLeadId = '';
  let recentCadenceId = '';
  let recentBefore: TouchRow[] = [];
  let tick: CadenceTickResult;

  beforeAll(async () => {
    expiryTenant = await tickableTenant('Lead Expiry');
    // The same shape for both: touch 1 sent, touches 2 and 3 still ahead and
    // outside the draft lead time, so only the anchor's age differs.
    const shape = (anchorAt: Date) => [
      { status: 'sent', scheduled_at: anchorAt.toISOString(), original_offset_days: 0 },
      { status: 'scheduled', scheduled_at: at(T, 29 * MS_PER_HOUR).toISOString(), original_offset_days: 1 },
      { status: 'scheduled', scheduled_at: at(T, 30 * MS_PER_HOUR).toISOString(), original_offset_days: 2 },
    ];
    const old = await textedCaller(expiryTenant, {
      mobile: EXPIRED_CALLER,
      anchorAt: at(T, -8 * MS_PER_DAY),
      touches: shape(at(T, -8 * MS_PER_DAY)),
    });
    oldLeadId = old.leadId;
    oldCadenceId = old.cadenceId;
    const recent = await textedCaller(expiryTenant, {
      mobile: RECENT_CALLER,
      anchorAt: at(T, -6 * MS_PER_DAY),
      touches: shape(at(T, -6 * MS_PER_DAY)),
    });
    recentLeadId = recent.leadId;
    recentCadenceId = recent.cadenceId;
    recentBefore = await touchesOf(recentCadenceId);

    tick = await runCadenceTick({
      draftClient: null,
      classifyClient: null,
      now: T,
      jitterMinutes: () => 0,
      sender: new RecordingSender(),
    });
  }, 120_000);

  afterAll(async () => {
    await teardownTenants([expiryTenant]);
  }, 60_000);

  it('expires the 8-day-old cadence and retires its unsent touches cadence_expired', async () => {
    expect((await cadenceStatus(oldCadenceId)).status).toBe('expired');
    const touches = await touchesOf(oldCadenceId);
    expect(touches.map((t) => t.status)).toEqual(['sent', 'skipped', 'skipped']);
    expect(touches.slice(1).every((t) => t.skip_reason === 'cadence_expired')).toBe(true);
    expect(tick.cadencesExpired).toBeGreaterThanOrEqual(1);
  });

  it('expires its lead — status expired, closed_reason expired, closed_at set', async () => {
    const lead = await leadOf(oldLeadId);
    expect(lead.status).toBe('expired');
    expect(lead.closed_reason).toBe('expired');
    expect(lead.closed_at).not.toBeNull();
  });

  it('leaves a lead anchored 6 days ago untouched — the quote\'s 42 days never applied, nor the lead\'s 7 early', async () => {
    expect(await cadenceStatus(recentCadenceId)).toEqual({ status: 'active', stop_reason: null });
    expect(await touchesOf(recentCadenceId)).toEqual(recentBefore);
    expect((await leadOf(recentLeadId)).status).toBe('open');
  });
});

// ── D-10/D-14: the dispatch lead branch refuses an unchaseable lead ─────────

describe('the dispatch lead branch refuses lead_closed and closes on its own transaction (D-10, D-14)', () => {
  let branchTenant = '';
  const branchSender = new RecordingSender();
  let tick: CadenceTickResult;

  let closedLead = { leadId: '', cadenceId: '', touchTwoId: '' };
  let failedLead = { leadId: '', cadenceId: '', touchTwoId: '' };
  let bothLead = { leadId: '', cadenceId: '', touchTwoId: '' };
  let liveQuoteCadenceId = '';
  let liveQuoteTouchesBefore: TouchRow[] = [];

  /** Touch 1 sent 25 h ago, touch 2 approved and due, touch 3 tomorrow. */
  const dueShape = () => [
    { status: 'sent', scheduled_at: at(T, -25 * MS_PER_HOUR).toISOString(), original_offset_days: 0 },
    { status: 'approved', scheduled_at: at(T, -30 * MS_PER_MINUTE).toISOString(), original_offset_days: 1 },
    { status: 'scheduled', scheduled_at: at(T, 23.5 * MS_PER_HOUR).toISOString(), original_offset_days: 2 },
  ];

  async function dueCaller(
    mobile: string,
    options: { leadOverrides?: Record<string, unknown>; touchOneOutcome?: string } = {},
  ) {
    const caller = await textedCaller(branchTenant, {
      mobile,
      anchorAt: at(T, -25 * MS_PER_HOUR),
      touches: dueShape(),
      ...options,
    });
    await seedApprovedDraft(branchTenant, caller.cadenceId, caller.touches[1].id, 2, {
      final_body: 'Still need a hand? Lead Branch. Reply STOP to opt out.',
    });
    return { leadId: caller.leadId, cadenceId: caller.cadenceId, touchTwoId: caller.touches[1].id };
  }

  beforeAll(async () => {
    branchTenant = await tickableTenant('Lead Branch');

    // A lead the operator already closed, whose cadence somehow still runs.
    closedLead = await dueCaller(CLOSED_CALLER, {
      leadOverrides: {
        status: 'closed',
        closed_reason: 'operator',
        closed_at: at(T, -MS_PER_HOUR).toISOString(),
      },
    });
    // A lead whose text-back FAILED: "still need a hand?" must not follow it.
    failedLead = await dueCaller(FAILED_CALLER, { touchOneOutcome: 'failed' });
    // A caller who is ALSO on a live quote cadence at this client.
    bothLead = await dueCaller(BOTH_CALLER);
    const [quote] = await seedQuotes(branchTenant, [
      { job_description: 'lead-active: the quote that wins', chase_eligibility: 'eligible' },
    ]);
    liveQuoteCadenceId = await seedCadence(branchTenant, quote.id, {
      sm8_job_uuid: quote.sm8_job_uuid,
      contact_name: 'Sam Ortiz',
      contact_mobile: BOTH_CALLER,
      anchor_at: at(T, -2 * MS_PER_DAY).toISOString(),
    });
    await seedTouches(liveQuoteCadenceId, branchTenant, [
      { status: 'scheduled', scheduled_at: at(T, 5 * MS_PER_DAY).toISOString(), original_offset_days: 7 },
    ]);
    liveQuoteTouchesBefore = await touchesOf(liveQuoteCadenceId);

    tick = await runCadenceTick({
      draftClient: null,
      classifyClient: null,
      now: T,
      jitterMinutes: () => 0,
      sender: branchSender,
    });
  }, 120_000);

  afterAll(async () => {
    await teardownTenants([branchTenant]);
  }, 60_000);

  it('refuses all three lead_closed, sends nothing to any of them, and never stops one mirror_missing', () => {
    expect(tick.refusals.lead_closed).toBe(3);
    expect(tick.refusals.mirror_missing).toBe(0);
    for (const lead of [closedLead, failedLead, bothLead]) {
      expect(branchSender.sent.filter((r) => r.cadenceId === lead.cadenceId)).toEqual([]);
    }
  });

  it('a closed lead: touch skipped cadence_stopped, cadence stopped lead_closed, the lead left as it was', async () => {
    const touch = (await touchesOf(closedLead.cadenceId)).find((t) => t.id === closedLead.touchTwoId);
    expect(touch).toMatchObject({ status: 'skipped', skip_reason: 'cadence_stopped' });
    expect(await cadenceStatus(closedLead.cadenceId)).toEqual({
      status: 'stopped',
      stop_reason: 'lead_closed',
    });
    expect(await ledgerTouchNumbers(closedLead.cadenceId)).toEqual([1]);
    const lead = await leadOf(closedLead.leadId);
    expect(lead.status).toBe('closed');
    expect(lead.closed_reason).toBe('operator');
  });

  it('a failed text-back: refused, every unsent touch retired, the lead expired', async () => {
    expect(await cadenceStatus(failedLead.cadenceId)).toEqual({
      status: 'stopped',
      stop_reason: 'lead_closed',
    });
    const touches = await touchesOf(failedLead.cadenceId);
    expect(touches.slice(1).map((t) => [t.status, t.skip_reason])).toEqual([
      ['skipped', 'cadence_stopped'],
      ['skipped', 'cadence_stopped'],
    ]);
    const lead = await leadOf(failedLead.leadId);
    expect(lead.status).toBe('expired');
    expect(lead.closed_reason).toBe('expired');
    expect(lead.closed_at).not.toBeNull();
  });

  it('a caller on a live quote cadence: the lead closed quote_cadence_wins, the quote cadence untouched', async () => {
    expect(await cadenceStatus(bothLead.cadenceId)).toEqual({
      status: 'stopped',
      stop_reason: 'lead_closed',
    });
    const lead = await leadOf(bothLead.leadId);
    expect(lead.status).toBe('closed');
    expect(lead.closed_reason).toBe('quote_cadence_wins');

    expect(await cadenceStatus(liveQuoteCadenceId)).toEqual({ status: 'active', stop_reason: null });
    expect(await touchesOf(liveQuoteCadenceId)).toEqual(liveQuoteTouchesBefore);
  });
});

describe('D-19 control: the quote cadence in the same tick is dispatched exactly as before', () => {
  it('sends the approved quote touch to the stub and writes its ledger row', async () => {
    const toCustomer = sender.sent.filter((r) => r.cadenceId === quoteCadenceId);
    expect(toCustomer).toHaveLength(1);
    expect(toCustomer[0].to.address).toBe(QUOTE_CUSTOMER);
    expect(toCustomer[0].body).toBe(quoteBody);
    expect(toCustomer[0].touchNumber).toBe(1);

    expect(await ledgerTouchNumbers(quoteCadenceId)).toEqual([1]);

    const [touch] = await touchesOf(quoteCadenceId);
    expect(touch.id).toBe(quoteTouchId);
    expect(touch.status).toBe('sent');

    // The tick saw this tenant — so the lead assertions above are about the
    // predicates, not about an invisible tenant.
    expect(result.dispatched).toBeGreaterThanOrEqual(1);
  });
});
