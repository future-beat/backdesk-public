/**
 * THE TEXT-BACK GUARANTEE, ITS ALARM AND THE BALANCE PROBE, PROVEN AT THE
 * DATABASE (Phase 12, plan 12-04; TXT-02, TXT-06; D-01, D-04, D-10, D-20, D-21).
 *
 * `runTextBackSweep` and `runCadenceTick` run FOR REAL against a migrated
 * database: the window read, the one `sendTextBack`, its guarded claim and the
 * stale marks. Only the SENDER is injected — a recording sender whose
 * `provider` is a real provider name — so nothing is dialled.
 *
 * ── WHAT THE SWEEP GUARANTEES ───────────────────────────────────────────────
 *
 * Only text-backs that were NEVER CLAIMED. A provider-refused or
 * unknown-outcome text-back is alerted to the operator and never re-sent; the
 * "claimed, outcome unknown" case below is that promise as an assertion.
 *
 * ── DB-BACKED, AND CI IS THE ONLY PLACE IT RUNS ─────────────────────────────
 *
 * It refuses a non-local target through `tests/helpers/env.ts` and MUST NEVER
 * run through `npm run test:remote`: the hosted Sydney project is production,
 * and this suite arms text-back and SMS identity rows.
 *
 * ── PINNED 2019 CLOCKS, AND WHY ─────────────────────────────────────────────
 *
 * The sweep's read and its stale UPDATE are GLOBAL (a pending call is found by
 * age, not by tenant). Every case passes its own clock in 2019 and seeds its
 * calls relative to it, so the window can only ever contain this suite's rows,
 * and the stale mark (strictly before the clock minus ten minutes) reaches
 * nothing another suite seeded at real time or on the 2020 clocks of
 * `tests/text-back-repository.test.ts`. Assertions are on this suite's own
 * rows. Files run serially (`fileParallelism: false`).
 *
 * ── THE BOUNDS ON THE ENABLED ROWS IT WRITES ────────────────────────────────
 *
 * Each armed tenant's `text_back` and tenant-scoped `sms` rows are deleted BY
 * ID in `afterAll`, first (`messaging_config` has no FK). Every number is from
 * ACMA's fiction block (0491 570 1xx).
 */
import { afterAll, describe, expect, it } from 'vitest';

import type { SendOutcome, SendRequest, TouchSender } from '../src/core/cadence/sender';
import { runCadenceTick } from '../src/core/cadence/run-tick';
import type { StalledEmailSender } from '../src/core/alerts/stalled-drafts';
import { AUTO_DISARM_REASON, perthAlertDay, runBalanceProbe } from '../src/core/leads/balance';
import { runTextBackAlertPass, runTextBackSweep } from '../src/core/leads/sweep';
import { sendTextBack } from '../src/core/leads/text-back';
import { closeDb, upsertChannelConfig } from '../src/db/repository';

import {
  admin,
  seedCadence,
  seedMissedCall,
  seedQuotes,
  seedTenant,
  seedTextBackArmed,
  seedTextBackTemplates,
  teardownTenants,
} from './helpers/seed';

/** The shared SMS number the text leaves from — fiction block. */
const SMS_FROM = '+61491570150';

const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60_000;

const tenantIds: string[] = [];
const configIds: string[] = [];

/**
 * The `operator_alert_log` keys this suite can write: (kind, Perth day) on its
 * own 2019 clocks. Deleted by key in `afterAll`; the latch has no tenant, so
 * teardown cannot reach them.
 */
const ALERT_KINDS = ['clicksend_balance_low', 'text_back_auto_disarmed', 'clicksend_balance_unreadable'] as const;
const alertDays = new Set<string>(['2019-07-03']);

/** A distinct fiction-block mobile per call, so the 24-hour rule never couples two cases. */
let callerSeq = 400;
function nextCaller(): string {
  callerSeq += 1;
  return `+61491570${String(callerSeq).padStart(3, '0')}`;
}

/** Records what it was asked to send, as a real provider would receive it. */
class RecordingSender implements TouchSender {
  readonly provider = 'clicksend';
  readonly sent: SendRequest[] = [];
  constructor(
    private readonly answer: (request: SendRequest, call: number) => SendOutcome = (request) => ({
      kind: 'sent',
      provider: 'clicksend',
      providerMessageId: `cs-${request.ledgerId.slice(0, 8)}`,
    }),
  ) {}

  async send(request: SendRequest): Promise<SendOutcome> {
    this.sent.push(request);
    return this.answer(request, this.sent.length);
  }
}

/** Throws on its first send (an unknown outcome), records every later one. */
class ThrowOnceSender extends RecordingSender {
  private thrown = false;
  override async send(request: SendRequest): Promise<SendOutcome> {
    if (!this.thrown) {
      this.thrown = true;
      throw new Error('socket hang up');
    }
    return super.send(request);
  }
}

/** An ARMED client: text_back on, SMS identity resolving, templates attested. */
async function armedTenant(prefix: string): Promise<string> {
  const tenantId = await seedTenant(prefix);
  tenantIds.push(tenantId);

  configIds.push(await seedTextBackArmed(tenantId));
  // TENANT-SCOPED, fictional, deleted by id in afterAll. See the header.
  const sms = await upsertChannelConfig({
    channel: 'sms',
    tenantId,
    fromAddress: SMS_FROM,
    enabled: true,
  });
  configIds.push(sms.id);

  await seedTextBackTemplates(tenantId);
  return tenantId;
}

/** A completed mobile call that ENDED `agoMs` before `now`. */
async function call(tenantId: string, now: Date, agoMs: number): Promise<string> {
  const endedAt = new Date(now.getTime() - agoMs);
  return seedMissedCall(
    tenantId,
    {},
    {
      caller: nextCaller(),
      afterHours: false,
      startedAt: new Date(endedAt.getTime() - 20 * MS_PER_SECOND),
      endedAt,
    },
  );
}

async function missedCall(id: string): Promise<Record<string, unknown>> {
  const { data, error } = await admin.from('missed_calls').select('*').eq('id', id).single();
  if (error) throw new Error(`Reading the missed call failed: ${error.message}`);
  return data as Record<string, unknown>;
}

async function ledgerCount(tenantId: string): Promise<number> {
  const { count, error } = await admin
    .from('send_ledger')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);
  if (error) throw new Error(`Counting send_ledger failed: ${error.message}`);
  return count ?? 0;
}

/** A sender whose provider REFUSES the text with `reason`. */
function refusingSender(reason: string): RecordingSender {
  return new RecordingSender(() => ({
    kind: 'failed',
    provider: 'clicksend',
    reason,
    retryable: false,
  }));
}

/** An email sink that records what the operator would have received. */
function recordingEmail(ok = true): StalledEmailSender & { sent: Array<{ subject: string; body: string }> } {
  const sent: Array<{ subject: string; body: string }> = [];
  const sink = (async (message: { subject: string; body: string }) => {
    sent.push(message);
    return ok
      ? ({ ok: true, id: 'em_test' } as const)
      : ({ ok: false, kind: 'send_failed', detail: 'test' } as const);
  }) as StalledEmailSender & { sent: typeof sent };
  sink.sent = sent;
  return sink;
}

async function tenantName(tenantId: string): Promise<string> {
  const { data, error } = await admin.from('tenants').select('name').eq('id', tenantId).single();
  if (error) throw new Error(`Reading the tenant name failed: ${error.message}`);
  return (data as { name: string }).name;
}

/** The ledger id each request carried, which is how a send is tied back to its call. */
async function ledgerIdOf(id: string): Promise<string | null> {
  return (await missedCall(id)).text_back_ledger_id as string | null;
}

afterAll(async () => {
  // BY ID and FIRST: an enabled text_back or sms row must not outlive the suite.
  if (configIds.length > 0) {
    const { error } = await admin.from('messaging_config').delete().in('id', configIds);
    if (error) throw new Error(`Teardown failed, messaging_config rows left: ${error.message}`);
  }
  // The SYSTEM disarm rows the balance probe wrote for this suite's tenants.
  if (tenantIds.length > 0) {
    const { error } = await admin.from('messaging_config_audit').delete().in('tenant_id', tenantIds);
    if (error) throw new Error(`Teardown failed, messaging_config_audit rows left: ${error.message}`);
  }
  for (const day of alertDays) {
    const { error } = await admin
      .from('operator_alert_log')
      .delete()
      .in('kind', [...ALERT_KINDS])
      .eq('alert_day', day);
    if (error) throw new Error(`Teardown failed, operator_alert_log rows left: ${error.message}`);
  }
  if (tenantIds.length > 0) await teardownTenants(tenantIds);
  await closeDb();
});

/* -------------------------------------------------------------------------- *
 * The sweep (D-01, D-20, TXT-02)
 * -------------------------------------------------------------------------- */

describe('the tick sweep sends what the callback did not, inside 45 s – 10 min (D-20)', () => {
  it('sweeps 45 s, 46 s and exactly 10 min; leaves 44 s; marks 10 min + 1 s stale', async () => {
    const NOW = new Date('2019-06-12T03:00:00.000Z');
    const tenantId = await armedTenant('Sweep Window');

    const at44s = await call(tenantId, NOW, 44 * MS_PER_SECOND);
    const at45s = await call(tenantId, NOW, 45 * MS_PER_SECOND);
    const at46s = await call(tenantId, NOW, 46 * MS_PER_SECOND);
    const at10m = await call(tenantId, NOW, 10 * MS_PER_MINUTE);
    const past10m = await call(tenantId, NOW, 10 * MS_PER_MINUTE + MS_PER_SECOND);
    const at11m = await call(tenantId, NOW, 11 * MS_PER_MINUTE);

    const sender = new RecordingSender();
    // THROUGH THE TICK, so the seam is proven wired, not just the function.
    const result = await runCadenceTick({
      now: NOW,
      textBackSender: sender,
      draftClient: null,
      classifyClient: null,
    });

    expect(result.textBackUnconfigured).toBe(0);
    expect(result.textBackSwept).toBeGreaterThanOrEqual(3);
    expect(result.textBackSent).toBeGreaterThanOrEqual(3);
    expect(result.textBackStale).toBeGreaterThanOrEqual(2);

    // The three inside the window were texted, once each.
    for (const id of [at45s, at46s, at10m]) {
      const row = await missedCall(id);
      expect(row.text_back_status).toBe('sent');
      expect(row.text_back_route).toBe('lead');
    }
    const sentLedgers = await Promise.all([at45s, at46s, at10m].map(ledgerIdOf));
    expect(sender.sent.map((r) => r.ledgerId).sort()).toEqual([...sentLedgers].sort());
    expect(await ledgerCount(tenantId)).toBe(3);

    // 44 s is left for the callback: undecided, nothing written.
    const young = await missedCall(at44s);
    expect(young.text_back_status).toBeNull();
    expect(young.text_back_decided_at).toBeNull();

    // Past the ceiling: skipped / stale, decided at the tick's clock, NEVER texted.
    for (const id of [past10m, at11m]) {
      const row = await missedCall(id);
      expect(row.text_back_status).toBe('skipped');
      expect(row.text_back_skip_reason).toBe('stale');
      expect(row.text_back_ledger_id).toBeNull();
      expect(new Date(row.text_back_decided_at as string).getTime()).toBe(NOW.getTime());
    }
  });

  it('a call the reconcile inserts hours late is marked stale and produces no text (T-12-20)', async () => {
    const NOW = new Date('2019-06-13T19:30:00.000Z');
    const tenantId = await armedTenant('Sweep Reconcile Late');
    const late = await call(tenantId, NOW, 5 * 60 * MS_PER_MINUTE);

    const sender = new RecordingSender();
    const counts = await runTextBackSweep({ now: NOW, sender });

    expect(counts.stale).toBeGreaterThanOrEqual(1);
    expect((await missedCall(late)).text_back_skip_reason).toBe('stale');
    expect(sender.sent).toHaveLength(0);
    expect(await ledgerCount(tenantId)).toBe(0);
  });
});

describe('no sender, no scan (T-12-22)', () => {
  it('claims nothing, marks nothing stale, and reports textBackUnconfigured 1', async () => {
    const NOW = new Date('2019-06-14T03:00:00.000Z');
    const tenantId = await armedTenant('Sweep Unconfigured');
    const pending = await call(tenantId, NOW, 60 * MS_PER_SECOND);
    const old = await call(tenantId, NOW, 30 * MS_PER_MINUTE);

    const result = await runCadenceTick({ now: NOW, draftClient: null, classifyClient: null });

    expect(result.textBackUnconfigured).toBe(1);
    expect(result.textBackSwept).toBe(0);
    expect(result.textBackSent).toBe(0);
    expect(result.textBackSkipped).toBe(0);
    expect(result.textBackFailed).toBe(0);
    expect(result.textBackStale).toBe(0);

    for (const id of [pending, old]) {
      const row = await missedCall(id);
      expect(row.text_back_status).toBeNull();
      expect(row.text_back_decided_at).toBeNull();
    }
    expect(await ledgerCount(tenantId)).toBe(0);

    // Leave nothing pending for a later case's clock to find.
    await admin.from('missed_calls').delete().in('id', [pending, old]);
  });
});

describe('the sweep and the callback send exactly one text (T-12-02, TXT-02)', () => {
  it('a call the callback already decided is not offered again', async () => {
    const NOW = new Date('2019-06-15T03:00:00.000Z');
    const tenantId = await armedTenant('Sweep After Callback');
    const id = await call(tenantId, NOW, 60 * MS_PER_SECOND);
    const sender = new RecordingSender();

    // The status door got there first.
    expect((await sendTextBack(id, { now: NOW, getSender: async () => sender })).kind).toBe('sent');

    const counts = await runTextBackSweep({ now: new Date(NOW.getTime() + MS_PER_MINUTE), sender });

    expect(sender.sent).toHaveLength(1);
    expect(await ledgerCount(tenantId)).toBe(1);
    expect(counts.sent).toBe(0);
  });

  it('racing for one pending call, the callback and the sweep send ONE text', async () => {
    const NOW = new Date('2019-06-16T03:00:00.000Z');
    const tenantId = await armedTenant('Sweep Race');
    const id = await call(tenantId, NOW, 60 * MS_PER_SECOND);
    const sender = new RecordingSender();

    const [door, sweep] = await Promise.all([
      sendTextBack(id, { now: NOW, getSender: async () => sender }),
      runTextBackSweep({ now: NOW, sender }),
    ]);

    expect(sender.sent).toHaveLength(1);
    expect(await ledgerCount(tenantId)).toBe(1);
    expect((await missedCall(id)).text_back_status).toBe('sent');
    // Exactly one of the two sent; the loser lost the claim or found it decided.
    const doorSent = door.kind === 'sent' ? 1 : 0;
    expect(doorSent + sweep.sent).toBe(1);
    if (door.kind !== 'sent') expect(['claim_lost', 'already_decided']).toContain(door.kind);
  });

  it('a call claimed with an unknown outcome is NEVER re-sent by the sweep (D-04)', async () => {
    const NOW = new Date('2019-06-17T03:00:00.000Z');
    const tenantId = await armedTenant('Sweep Unknown Outcome');
    const id = await call(tenantId, NOW, 50 * MS_PER_SECOND);

    // The door's send threw after the claim: the outcome is unknown.
    const throwing = new ThrowOnceSender();
    expect((await sendTextBack(id, { now: NOW, getSender: async () => throwing })).kind).toBe(
      'outcome_unknown',
    );
    expect((await missedCall(id)).text_back_status).toBe('claimed');

    const sender = new RecordingSender();
    await runTextBackSweep({ now: new Date(NOW.getTime() + MS_PER_MINUTE), sender });
    await runTextBackSweep({ now: new Date(NOW.getTime() + 3 * MS_PER_MINUTE), sender });

    expect(sender.sent).toHaveLength(0);
    expect((await missedCall(id)).text_back_status).toBe('claimed');
    expect(await ledgerCount(tenantId)).toBe(1);
  });

  it('one call failing does not stop the next', async () => {
    const NOW = new Date('2019-06-18T03:00:00.000Z');
    const tenantId = await armedTenant('Sweep Isolation');
    const first = await call(tenantId, NOW, 90 * MS_PER_SECOND);
    const second = await call(tenantId, NOW, 60 * MS_PER_SECOND);

    // The first send throws (an unknown outcome); the second is recorded.
    const sender = new ThrowOnceSender();
    const counts = await runTextBackSweep({ now: NOW, sender });

    expect(counts.swept).toBeGreaterThanOrEqual(2);
    expect(counts.failed).toBeGreaterThanOrEqual(1);
    expect(counts.sent).toBeGreaterThanOrEqual(1);
    const statuses = [(await missedCall(first)).text_back_status, (await missedCall(second)).text_back_status];
    expect(statuses.sort()).toEqual(['claimed', 'sent']);
    expect(sender.sent).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- *
 * The failed / stuck alert (D-10, TXT-06)
 * -------------------------------------------------------------------------- */

describe('failed and stuck text-backs reach the operator within the tick (D-10)', () => {
  it('with no ops seam the tick claims nothing for alerting', async () => {
    const NOW = new Date('2019-07-01T03:00:00.000Z');
    const tenantId = await armedTenant('Alert Unconfigured');
    const id = await call(tenantId, NOW, 20 * MS_PER_SECOND);
    expect(
      (await sendTextBack(id, { now: NOW, getSender: async () => refusingSender('INVALID_RECIPIENT') })).kind,
    ).toBe('failed');

    const result = await runCadenceTick({
      now: new Date(NOW.getTime() + MS_PER_MINUTE),
      draftClient: null,
      classifyClient: null,
    });

    expect(result.textBackAlerted).toBe(0);
    expect(result.textBackAlertFailed).toBe(0);
    expect((await missedCall(id)).text_back_alerted_at).toBeNull();
  });

  it('a failed row and a row stuck 3 min are alerted once; a row claimed 1 min ago is not yet', async () => {
    const NOW = new Date('2019-07-02T03:00:00.000Z');
    const tenantId = await armedTenant('Alert Once');
    const name = await tenantName(tenantId);

    // Refused by the provider, for want of credit.
    const failedCall = await call(tenantId, NOW, 30 * MS_PER_SECOND);
    await sendTextBack(failedCall, {
      now: new Date(NOW.getTime() - 10 * MS_PER_SECOND),
      getSender: async () => refusingSender('INSUFFICIENT_CREDIT'),
    });
    // Claimed 3 minutes ago, outcome unknown.
    const stuckAt = new Date(NOW.getTime() - 3 * MS_PER_MINUTE);
    const stuckCall = await call(tenantId, stuckAt, 20 * MS_PER_SECOND);
    await sendTextBack(stuckCall, { now: stuckAt, getSender: async () => new ThrowOnceSender() });
    // Claimed 1 minute ago, outcome unknown: not stuck yet.
    const recentAt = new Date(NOW.getTime() - MS_PER_MINUTE);
    const recentCall = await call(tenantId, recentAt, 20 * MS_PER_SECOND);
    await sendTextBack(recentCall, { now: recentAt, getSender: async () => new ThrowOnceSender() });

    expect((await missedCall(failedCall)).text_back_status).toBe('failed');
    expect((await missedCall(failedCall)).text_back_detail).toBe('INSUFFICIENT_CREDIT');

    const email = recordingEmail();
    const counts = await runTextBackAlertPass({ now: NOW, sendEmail: email });

    expect(counts.alerted).toBeGreaterThanOrEqual(2);
    expect(counts.alertFailed).toBe(0);
    expect(counts.insufficientCreditSeen).toBe(1);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0].body).toContain(`${name}: 1 failed, 1 outcome unknown`);
    // Counts and names only: no caller number, no body text.
    expect(email.sent[0].body).not.toContain('+61');
    expect(email.sent[0].body).not.toContain('INSUFFICIENT_CREDIT');

    expect(new Date((await missedCall(failedCall)).text_back_alerted_at as string).getTime()).toBe(NOW.getTime());
    expect(new Date((await missedCall(stuckCall)).text_back_alerted_at as string).getTime()).toBe(NOW.getTime());
    expect((await missedCall(recentCall)).text_back_alerted_at).toBeNull();

    // A minute later: the two are never alerted again; the recent one is now stuck.
    const later = recordingEmail();
    await runTextBackAlertPass({ now: new Date(NOW.getTime() + 2 * MS_PER_MINUTE), sendEmail: later });
    const body = later.sent.map((m) => m.body).join('\n');
    expect(body).toContain(`${name}: 0 failed, 1 outcome unknown`);
    expect(new Date((await missedCall(failedCall)).text_back_alerted_at as string).getTime()).toBe(NOW.getTime());
  });

  it('a SENT about-quote text whose quote cadence did not pause is alerted once, in its own words (12-05)', async () => {
    const NOW = new Date('2019-07-04T03:01:00.000Z');
    const tenantId = await armedTenant('Alert Pause Failed');
    const name = await tenantName(tenantId);
    const caller = nextCaller();
    const [quote] = await seedQuotes(tenantId, [{ job_description: 'Leaking roof' }]);
    await seedCadence(tenantId, quote!.id, { contact_mobile: caller });
    const endedAt = new Date(NOW.getTime() - 30 * MS_PER_SECOND);
    const id = await seedMissedCall(
      tenantId,
      {},
      { caller, afterHours: false, startedAt: new Date(endedAt.getTime() - 20 * MS_PER_SECOND), endedAt },
    );

    const result = await sendTextBack(id, {
      now: new Date(NOW.getTime() - 10 * MS_PER_SECOND),
      getSender: async () => new RecordingSender(),
      pauseForReply: async () => {
        throw new Error('pause failed');
      },
    });
    expect(result.kind).toBe('sent_pause_failed');
    expect(await missedCall(id)).toMatchObject({ text_back_status: 'sent', text_back_detail: 'pause_failed' });

    const email = recordingEmail();
    const counts = await runTextBackAlertPass({ now: NOW, sendEmail: email });
    expect(counts.pauseFailed).toBe(1);
    expect(counts.alertFailed).toBe(0);
    const body = email.sent.map((m) => m.body).join('\n');
    expect(body).toContain(`${name}: 1 sent, but the quote cadence could not be paused — pause it on the quote page`);
    // Sent, so never listed as a failure, and no number in the email.
    expect(body).not.toContain(`${name}: 0 failed`);
    expect(body).not.toContain('+61');
    expect(new Date((await missedCall(id)).text_back_alerted_at as string).getTime()).toBe(NOW.getTime());

    // Claimed once: the next pass does not report it again.
    const later = recordingEmail();
    expect((await runTextBackAlertPass({ now: new Date(NOW.getTime() + MS_PER_MINUTE), sendEmail: later })).pauseFailed).toBe(0);
    expect(later.sent.map((m) => m.body).join('\n')).not.toContain(name);
  });

  it('a lost email is reported as textBackAlertFailed, and the rows are not alerted again', async () => {
    // OFF the quarter hour, so the balance probe behind the same seam does not
    // run unforced in this tick (its own cases are below).
    const NOW = new Date('2019-07-03T03:01:00.000Z');
    const tenantId = await armedTenant('Alert Lost Email');
    const name = await tenantName(tenantId);
    const id = await call(tenantId, NOW, 30 * MS_PER_SECOND);
    await sendTextBack(id, {
      now: new Date(NOW.getTime() - 10 * MS_PER_SECOND),
      getSender: async () => refusingSender('INVALID_RECIPIENT'),
    });

    // THROUGH THE TICK, so the seam and the two fields are proven wired.
    const result = await runCadenceTick({
      now: NOW,
      draftClient: null,
      classifyClient: null,
      textBackOps: {
        alertSender: recordingEmail(false),
        clicksend: { username: undefined, apiKey: undefined },
      },
    });

    // At least 1: the alert email was lost. (A forced balance probe whose
    // email is lost too would add to it; that is the same signal.)
    expect(result.textBackAlertFailed).toBeGreaterThanOrEqual(1);
    expect(result.textBackAlerted).toBe(0);
    const stamped = (await missedCall(id)).text_back_alerted_at;
    expect(stamped).not.toBeNull();

    // The claim was not undone: a later pass does not report it again.
    const later = recordingEmail();
    await runTextBackAlertPass({ now: new Date(NOW.getTime() + MS_PER_MINUTE), sendEmail: later });
    expect(later.sent.map((m) => m.body).join('\n')).not.toContain(name);
    expect((await missedCall(id)).text_back_alerted_at).toBe(stamped);
  });
});

/* -------------------------------------------------------------------------- *
 * The balance probe (D-07, D-10, D-21, TXT-06). LAST in the file: the armed
 * list is global, so a disarm here reaches every tenant this suite armed.
 * -------------------------------------------------------------------------- */

/** A ClickSend `/v3/account` answer, injected — nothing is dialled. */
function accountAnswer(balance: string, currency = 'AUD'): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({ data: { balance, _currency: { currency_name_short: currency } } }),
      { status: 200 },
    )) as unknown as typeof fetch;
}

const CREDS = { username: 'probe@example.test', apiKey: 'not-a-real-key' };

async function textBackEnabled(tenantId: string): Promise<boolean | null> {
  const { data, error } = await admin
    .from('messaging_config')
    .select('enabled')
    .eq('channel', 'text_back')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw new Error(`Reading the text_back row failed: ${error.message}`);
  return data ? (data as { enabled: boolean }).enabled : null;
}

async function auditRows(tenantId: string): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await admin
    .from('messaging_config_audit')
    .select('*')
    .eq('channel', 'text_back')
    .eq('tenant_id', tenantId);
  if (error) throw new Error(`Reading messaging_config_audit failed: ${error.message}`);
  return (data ?? []) as Array<Record<string, unknown>>;
}

async function alertLatched(kind: string, day: string): Promise<boolean> {
  const { data, error } = await admin
    .from('operator_alert_log')
    .select('kind')
    .eq('kind', kind)
    .eq('alert_day', day);
  if (error) throw new Error(`Reading operator_alert_log failed: ${error.message}`);
  return (data ?? []).length === 1;
}

describe('the ClickSend balance probe (D-07, D-10, D-21)', () => {
  it('an unreadable balance disarms nobody and sends the unreadable email once per Perth day', async () => {
    const NOW = new Date('2019-08-01T02:00:00.000Z');
    const day = perthAlertDay(NOW);
    alertDays.add(day);
    const tenantId = await armedTenant('Probe Unreadable');

    const email = recordingEmail();
    const failing = (async () => new Response('', { status: 503 })) as unknown as typeof fetch;
    const first = await runBalanceProbe({ now: NOW, force: false, clicksend: CREDS, fetchImpl: failing, sendEmail: email });
    const second = await runBalanceProbe({
      now: new Date(NOW.getTime() + 15 * MS_PER_MINUTE),
      force: false,
      clicksend: CREDS,
      fetchImpl: accountAnswer('0.00', 'USD'),
      sendEmail: email,
    });

    expect(first).toMatchObject({ probed: 1, probeFailed: 1, lowAlerted: 0, autoDisarmed: 0 });
    expect(second).toMatchObject({ probed: 1, probeFailed: 1, lowAlerted: 0, autoDisarmed: 0 });
    expect(await textBackEnabled(tenantId)).toBe(true);
    expect(await auditRows(tenantId)).toHaveLength(0);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0].subject).toBe('ClickSend balance could not be read');
    expect(await alertLatched('clicksend_balance_unreadable', day)).toBe(true);
    expect(await alertLatched('clicksend_balance_low', day)).toBe(false);
  });

  it('at 1500 cents the low-balance email goes once per day and nobody is disarmed', async () => {
    const NOW = new Date('2019-08-02T02:00:00.000Z');
    const day = perthAlertDay(NOW);
    alertDays.add(day);
    const tenantId = await armedTenant('Probe Low');

    const email = recordingEmail();
    const first = await runBalanceProbe({ now: NOW, force: false, clicksend: CREDS, fetchImpl: accountAnswer('15.00'), sendEmail: email });
    const second = await runBalanceProbe({ now: NOW, force: true, clicksend: CREDS, fetchImpl: accountAnswer('15.00'), sendEmail: email });

    expect(first).toMatchObject({ probed: 1, probeFailed: 0, lowAlerted: 1, autoDisarmed: 0 });
    expect(second.lowAlerted).toBe(0);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0].subject).toBe('ClickSend balance low: A$15.00');
    expect(await textBackEnabled(tenantId)).toBe(true);
    expect(await auditRows(tenantId)).toHaveLength(0);
    expect(await alertLatched('clicksend_balance_low', day)).toBe(true);
  });

  it('at 450 cents every armed client is disarmed with one SYSTEM audit row each, and one email per day', async () => {
    const NOW = new Date('2019-08-03T02:00:00.000Z');
    const day = perthAlertDay(NOW);
    alertDays.add(day);
    const tenantA = await armedTenant('Probe Disarm A');
    const tenantB = await armedTenant('Probe Disarm B');

    // THROUGH THE TICK, on the quarter hour, so the seam and the field are proven wired.
    const email = recordingEmail();
    const result = await runCadenceTick({
      now: NOW,
      draftClient: null,
      classifyClient: null,
      textBackOps: { alertSender: email, clicksend: CREDS, fetchImpl: accountAnswer('4.50') },
    });

    expect(result.balanceProbed).toBe(1);
    expect(result.balanceProbeFailed).toBe(0);
    expect(result.textBackAutoDisarmed).toBeGreaterThanOrEqual(2);

    for (const tenantId of [tenantA, tenantB]) {
      expect(await textBackEnabled(tenantId)).toBe(false);
      const rows = await auditRows(tenantId);
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe('disarm');
      expect(rows[0].actor).toBe('system');
      expect(rows[0].operator_user_id).toBeNull();
      expect(rows[0].reason).toBe(AUTO_DISARM_REASON);
    }

    const disarmEmails = email.sent.filter((m) => m.subject.startsWith('Missed-call texts switched off'));
    expect(disarmEmails).toHaveLength(1);
    expect(disarmEmails[0].body).toContain('A$4.50');
    expect(await alertLatched('text_back_auto_disarmed', day)).toBe(true);

    // Fifteen minutes later nobody is armed: no call, no write, no email.
    const later = await runBalanceProbe({
      now: new Date(NOW.getTime() + 15 * MS_PER_MINUTE),
      force: false,
      clicksend: CREDS,
      fetchImpl: accountAnswer('4.50'),
      sendEmail: email,
    });
    expect(later.autoDisarmed).toBe(0);
    for (const tenantId of [tenantA, tenantB]) expect(await auditRows(tenantId)).toHaveLength(1);
    expect(email.sent.filter((m) => m.subject.startsWith('Missed-call texts switched off'))).toHaveLength(1);
  });
});
