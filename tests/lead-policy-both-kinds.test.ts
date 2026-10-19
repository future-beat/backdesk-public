/**
 * D-03 (LEAD-05) — A LEAD AND A QUOTE, SIDE BY SIDE IN ONE TENANT AND ONE TICK,
 * EACH DECIDED BY ITS OWN KIND'S POLICY (Phase 13, plan 13-02).
 *
 * ── THE SEAM THIS PINS ON A REAL DATABASE ───────────────────────────────────
 *
 * `tests/cadence-policy.test.ts` proves the numbers; this proves the TICK picks
 * them by `cadences.kind`. Two cadences of identical shape — touch 1 sent the
 * day before, touch 2 approved but missed (nobody approved it before the
 * window closed), touch 3 twenty-four hours after touch 2's next slot — and one
 * tick after hours. Each touch 2 has to be re-windowed to the next morning,
 * and the only thing that differs is how much room each kind demands before
 * the touch that follows:
 *
 *   - the LEAD's touch 2 is 24 h clear of touch 3, which the lead's 12-hour
 *     minimum gap allows: it is rescheduled, and sent the next morning;
 *   - the QUOTE's touch 2 is the same 24 h clear, which the quote's 48-hour
 *     minimum gap does not allow: it is skipped `min_gap`, and its touch 3
 *     stands and carries the conversation.
 *
 * A second pair with touch 3 forty-nine hours clear sends both — so the first
 * pair's split is the policy deciding, not the clock or the data.
 *
 * WHY THE TICK IS AFTER HOURS (corrected from the plan's draft, 13-02): the
 * minimum gap is judged only on the RESCHEDULE arm of `rewindowTouch`. A due
 * touch inside the window with time to spare is `send_now` whatever the next
 * touch's slot, for either kind — so a tick at 11:30 would send both touch 2s
 * and prove nothing about the gap. The window closing at 17:00 is what forces
 * both to be re-placed, which is where the two policies part.
 *
 * ── DB-BACKED, AND CI IS THE ONLY PLACE IT RUNS ─────────────────────────────
 *
 * It refuses a non-local target through `tests/helpers/env.ts` and MUST NEVER
 * run through `npm run test:remote`: the hosted Sydney project is production.
 * The sender is a recording stub; no model client is built. Clocks are pinned.
 * Every assertion is keyed on this suite's own ids; every number is from ACMA's
 * fiction block (0491 570 2xx).
 */
import { TZDate } from '@date-fns/tz';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CADENCE_CONSUMER } from '../src/core/cadence/constants';
import { runCadenceTick, type CadenceTickResult } from '../src/core/cadence/run-tick';
import type { SendOutcome, SendRequest, TouchSender } from '../src/core/cadence/sender';
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

const ZONE = 'Australia/Perth';

function perth(year: number, month: number, day: number, hours: number, minutes = 0): Date {
  return new Date(new TZDate(year, month - 1, day, hours, minutes, 0, ZONE).getTime());
}

/** Touch 1: Monday 5 October 2026, 16:30 — the call, and the text-back. */
const TOUCH_ONE = perth(2026, 10, 5, 16, 30);
/** Touch 2's slot: Tuesday 16:30 — approved, and missed. */
const TOUCH_TWO = perth(2026, 10, 6, 16, 30);
/** THE TICK: Tuesday 17:30, half an hour after the 17:00 close. */
const AFTER_HOURS = perth(2026, 10, 6, 17, 30);
/** Where both touch 2s would go: Wednesday 09:30, the preferred slot. */
const NEXT_MORNING = perth(2026, 10, 7, 9, 30);
/** The morning tick: Wednesday 09:31. */
const MORNING = perth(2026, 10, 7, 9, 31);

class RecordingSender implements TouchSender {
  readonly provider = 'stub';
  readonly sent: SendRequest[] = [];

  async send(request: SendRequest): Promise<SendOutcome> {
    this.sent.push(request);
    return { kind: 'sent', provider: this.provider, providerMessageId: null };
  }
}

interface TouchRow {
  id: string;
  touch_number: number;
  status: string;
  scheduled_at: string;
  skip_reason: string | null;
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

async function ledgerTouchNumbers(cadenceId: string): Promise<number[]> {
  const { data, error } = await admin
    .from('send_ledger')
    .select('touch_number')
    .eq('cadence_id', cadenceId)
    .order('touch_number', { ascending: true });
  if (error) throw new Error(`Reading the ledger failed: ${error.message}`);
  return ((data ?? []) as Array<{ touch_number: number }>).map((r) => r.touch_number);
}

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

/** The three-touch shape both kinds share; only touch 3's slot is a parameter. */
function shape(touchThreeAt: Date): Array<Record<string, unknown>> {
  return [
    { status: 'sent', scheduled_at: TOUCH_ONE.toISOString(), original_offset_days: 0 },
    { status: 'approved', scheduled_at: TOUCH_TWO.toISOString(), original_offset_days: 1 },
    { status: 'scheduled', scheduled_at: touchThreeAt.toISOString(), original_offset_days: 2 },
  ];
}

/**
 * One tenant with one lead cadence and one quote cadence of the given shape,
 * both touch 2s approved with bytes behind them, then the after-hours tick and
 * the morning tick.
 */
async function sideBySide(prefix: string, mobiles: { lead: string; quote: string }, touchThreeAt: Date) {
  const tenantId = await seedTenant(prefix);
  await seedConnection(tenantId);
  await seedCadenceSettings(tenantId);

  const leadId = await seedLead(tenantId, {
    contact_mobile: mobiles.lead,
    first_missed_at: TOUCH_ONE.toISOString(),
    last_missed_at: TOUCH_ONE.toISOString(),
  });
  const leadCadenceId = await seedLeadCadence(tenantId, leadId, {
    contact_mobile: mobiles.lead,
    anchor_at: TOUCH_ONE.toISOString(),
  });
  const leadTouches = await seedTouches(leadCadenceId, tenantId, shape(touchThreeAt));
  await seedLedgerRow(tenantId, {
    cadenceId: leadCadenceId,
    quoteId: null,
    leadId,
    touchNumber: 1,
    claimedAt: TOUCH_ONE.toISOString(),
    toAddress: mobiles.lead,
  });
  await seedApprovedDraft(tenantId, leadCadenceId, leadTouches[1].id, 2, {
    final_body: 'Still need a hand? Side By Side. Reply STOP to opt out.',
  });

  const [quote] = await seedQuotes(tenantId, [
    { job_description: 'lead-policy-both-kinds: the quote', chase_eligibility: 'eligible' },
  ]);
  const quoteCadenceId = await seedCadence(tenantId, quote.id, {
    sm8_job_uuid: quote.sm8_job_uuid,
    contact_name: 'Robin Vasquez',
    contact_mobile: mobiles.quote,
    anchor_at: TOUCH_ONE.toISOString(),
  });
  const quoteTouches = await seedTouches(quoteCadenceId, tenantId, shape(touchThreeAt));
  await seedLedgerRow(tenantId, {
    cadenceId: quoteCadenceId,
    quoteId: quote.id,
    touchNumber: 1,
    claimedAt: TOUCH_ONE.toISOString(),
    toAddress: mobiles.quote,
  });
  await seedApprovedDraft(tenantId, quoteCadenceId, quoteTouches[1].id, 2, {
    final_body: 'Any questions on the quote? Side By Side. Reply STOP to opt out.',
  });

  const sender = new RecordingSender();
  const afterHours = await runCadenceTick({
    draftClient: null,
    classifyClient: null,
    now: AFTER_HOURS,
    jitterMinutes: () => 0,
    sender,
  });
  const afterHoursState = {
    lead: await touchesOf(leadCadenceId),
    quote: await touchesOf(quoteCadenceId),
    sent: sender.sent.length,
  };
  const morning = await runCadenceTick({
    draftClient: null,
    classifyClient: null,
    now: MORNING,
    jitterMinutes: () => 0,
    sender,
  });

  return {
    tenantId,
    leadCadenceId,
    quoteCadenceId,
    sender,
    afterHours,
    afterHoursState,
    morning,
  };
}

beforeAll(async () => {
  await parkCursorAtHead();
});

afterAll(async () => {
  await closeDb();
});

describe('touch 3 twenty-four hours after the next morning: the lead sends, the quote is held (D-03)', () => {
  let run: Awaited<ReturnType<typeof sideBySide>>;

  beforeAll(async () => {
    // Touch 3 on Thursday 09:30 — 24 hours after Wednesday's 09:30 slot.
    run = await sideBySide(
      'Policy Both Kinds',
      { lead: '+61491570201', quote: '+61491570202' },
      perth(2026, 10, 8, 9, 30),
    );
  }, 120_000);

  afterAll(async () => {
    await teardownTenants([run.tenantId]);
  }, 60_000);

  it('after hours: the lead touch 2 is RESCHEDULED to the next morning (24 h clear of touch 3 >= 12 h)', () => {
    const [, touchTwo] = run.afterHoursState.lead;
    expect(touchTwo.status).toBe('approved');
    expect(new Date(touchTwo.scheduled_at).getTime()).toBe(NEXT_MORNING.getTime());
    expect(touchTwo.skip_reason).toBeNull();
  });

  it('after hours: the quote touch 2 is SKIPPED min_gap (24 h clear of touch 3 < 48 h), and its touch 3 stands', () => {
    const [, touchTwo, touchThree] = run.afterHoursState.quote;
    expect(touchTwo).toMatchObject({ status: 'skipped', skip_reason: 'min_gap' });
    expect(touchThree.status).toBe('scheduled');
    expect(touchThree.skip_reason).toBeNull();
    // Nothing goes out after hours, for either kind.
    expect(run.afterHoursState.sent).toBe(0);
  });

  it('next morning: the lead touch 2 is sent with its ledger row; the quote sends nothing but keeps touch 3', async () => {
    const leadSends = run.sender.sent.filter((r) => r.cadenceId === run.leadCadenceId);
    expect(leadSends).toHaveLength(1);
    expect(leadSends[0].touchNumber).toBe(2);
    expect(leadSends[0].quoteId).toBeNull();
    expect(await ledgerTouchNumbers(run.leadCadenceId)).toEqual([1, 2]);

    expect(run.sender.sent.filter((r) => r.cadenceId === run.quoteCadenceId)).toEqual([]);
    expect(await ledgerTouchNumbers(run.quoteCadenceId)).toEqual([1]);
    const quoteTouches = await touchesOf(run.quoteCadenceId);
    expect(quoteTouches[2].status).not.toBe('skipped');
    expect(quoteTouches[2].status).not.toBe('sent');
  });

  it('no tick stopped either cadence mirror_missing or refused the lead lead_closed', () => {
    for (const tick of [run.afterHours, run.morning] as CadenceTickResult[]) {
      expect(tick.refusals.mirror_missing).toBe(0);
      expect(tick.refusals.lead_closed).toBe(0);
    }
  });
});

describe('touch 3 forty-nine hours after the next morning: both kinds send (the control)', () => {
  let run: Awaited<ReturnType<typeof sideBySide>>;

  beforeAll(async () => {
    // Touch 3 on Friday 10:30 — 49 hours after Wednesday's 09:30 slot, clear of
    // both the lead's 12 hours and the quote's 48.
    run = await sideBySide(
      'Policy Both Send',
      { lead: '+61491570203', quote: '+61491570204' },
      perth(2026, 10, 9, 10, 30),
    );
  }, 120_000);

  afterAll(async () => {
    await teardownTenants([run.tenantId]);
  }, 60_000);

  it('after hours: both touch 2s are rescheduled to the next morning, neither skipped', () => {
    for (const touches of [run.afterHoursState.lead, run.afterHoursState.quote]) {
      expect(touches[1].status).toBe('approved');
      expect(new Date(touches[1].scheduled_at).getTime()).toBe(NEXT_MORNING.getTime());
    }
  });

  it('next morning: both touch 2s are sent, each with its ledger row', async () => {
    for (const cadenceId of [run.leadCadenceId, run.quoteCadenceId]) {
      const sends = run.sender.sent.filter((r) => r.cadenceId === cadenceId);
      expect(sends).toHaveLength(1);
      expect(sends[0].touchNumber).toBe(2);
      expect(await ledgerTouchNumbers(cadenceId)).toEqual([1, 2]);
    }
  });
});
