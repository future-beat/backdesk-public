/**
 * MSG-03 against the real database: the inbound-STOP compliance spine.
 *
 * ── WHAT THIS SUITE IS ACTUALLY PROVING ─────────────────────────────────────
 *
 * Not "handleInboundSms writes some rows". The one guarantee the whole phase is
 * built on, and the specific way it fails silently:
 *
 *   A STOP must be written in EXACTLY the spelling dispatch already probes.
 *
 * `dispatch.ts:381` asks `tx.suppression.existsFor([{channel, address}])` with
 * the cadence's snapshot address verbatim. A STOP handler that stored
 * `0412 345 678`, or re-normalized to some third form, or wrote only the mobile
 * and not the paired email, would produce a suppression row that LOOKS right in
 * the console and that no probe ever matches. Every unit test would pass. The
 * customer would keep being messaged after asking us to stop.
 *
 * So this suite does not assert the two halves separately and call it proof. It
 * asserts the STOP, and then drives a REAL DISPATCH TICK at a second live
 * cadence for the same human and requires it to refuse — which is the only
 * assertion that can tell "suppression written" from "suppression written in a
 * spelling that suppresses".
 *
 * ── ORDERED, AND THAT IS LOAD-BEARING ───────────────────────────────────────
 *
 * These `it` blocks share one tenant and run in file order (`vitest.config.mts`
 * disables file parallelism; a file's tests run sequentially). Each block
 * assumes the state the previous one left, and says so where it matters — the
 * repeat-STOP block in particular only means anything AFTER the first STOP has
 * moved the cadence out of live state.
 *
 * ── TEARDOWN DELETES INBOUND ROWS BY ID, NOT BY TENANT ──────────────────────
 *
 * `teardownTenants` keys on `tenant_id`, and the whole point of
 * `inbound_messages.tenant_id` being nullable is that an unplaced reply carries
 * NULL. The unmatched row this suite deliberately creates would therefore
 * survive a tenant teardown forever, in a table the operator's triage screen
 * reads. So every id this suite creates is tracked and deleted explicitly.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';

import { dispatchDueTouches } from '../src/core/cadence/dispatch';
import { StubSender, type SendOutcome, type SendRequest } from '../src/core/cadence/sender';
import { isInsideWindow, type ContactWindow } from '../src/core/cadence/window';
import { handleInboundSms } from '../src/core/messaging/inbound';
import { closeDb, forTenant } from '../src/db/repository';

import {
  admin,
  seedCadence,
  seedConnection,
  seedQuotes,
  seedTenant,
  seedTouches,
  teardownTenants,
} from './helpers/seed';

/** The window `seedTenant` creates: a Perth office week. */
const WINDOW: ContactWindow = {
  timezone: 'Australia/Perth',
  contactHoursStart: '08:00:00',
  contactHoursEnd: '17:00:00',
  contactDays: [1, 2, 3, 4, 5],
};

const MS_PER_HOUR = 3_600_000;

/**
 * The production stub, with a memory.
 *
 * EXTENDS `StubSender` rather than reimplementing `TouchSender`, so `provider`
 * stays the literal `'stub'` and every ledger row this suite writes remains
 * structurally indistinguishable from a real Phase 3 stub send — D-13 says a
 * stub row must be excludable from Phase 7 attribution forever, and a test
 * sender inventing its own provider name would be the one exception nobody
 * remembers. The recording exists only so the suite can assert that NOTHING was
 * sent to the suppressed address, which is a stronger claim than "the touch was
 * skipped".
 */
class RecordingStubSender extends StubSender {
  readonly sent: SendRequest[] = [];

  override async send(request: SendRequest): Promise<SendOutcome> {
    this.sent.push(request);
    return super.send(request);
  }
}

/**
 * ONE HUMAN, TWO ADDRESSES, THREE SPELLINGS — and MSG-04's encoding edge is the
 * gap between them.
 *
 * `SNAPSHOT_MOBILE` is what `selectPrimaryContact` stored on the cadence and
 * what dispatch probes with. `INBOUND_FROM` is how the provider hands us the
 * same number when that person texts back: local, with spaces. If the lookup
 * compared raw strings, a reply from the very customer we just texted would
 * match nothing — so this pair, deliberately different, is the test.
 */
const SNAPSHOT_MOBILE = '+61412345678';
const INBOUND_FROM = '0412 345 678';
const SNAPSHOT_EMAIL = 'quiet.please@example.com';

/** Our own inbound number, as the provider reports it. */
const INBOUND_TO = '+61480000000';

let tenantId: string;
let firstCadenceId: string;

/** Every inbound row this suite wrote — deleted by id in afterAll. See header. */
const inboundIds: string[] = [];

/** The second cadence and its touch, for the gate-chain block. */
let secondCadenceId: string;
let secondTouchId: string;
let secondDueAt: Date;

/**
 * `count` successive whole hours that fall inside the tenant's contact window.
 *
 * Found by asking the production predicate rather than hand-picking a "Tuesday
 * at 10am": a fixed instant is inside the window on the day it is written and,
 * once a weekend moves under it, produces a failure unrelated to what the suite
 * asserts. (The same helper `tests/cadence-dispatch.test.ts` uses, for the same
 * reason.)
 */
function inWindowHours(count: number, from: number): Date[] {
  const found: Date[] = [];

  for (let step = 1; step <= 24 * 14 && found.length < count; step += 1) {
    const candidate = new Date(from + step * MS_PER_HOUR);
    if (isInsideWindow(candidate, WINDOW)) found.push(candidate);
  }

  if (found.length < count) {
    throw new Error(`Found only ${found.length} in-window hours within a fortnight.`);
  }
  return found;
}

/** Every suppression row this tenant holds, read with the admin client. */
async function suppressionRows(): Promise<
  Array<{ channel: string; address: string; source: string; reason: string }>
> {
  const { data, error } = await admin
    .from('suppressed_contacts')
    .select('channel, address, source, reason')
    .eq('tenant_id', tenantId)
    .order('channel', { ascending: true });
  if (error) throw new Error(`Reading suppression failed: ${error.message}`);
  return (data ?? []) as Array<{
    channel: string;
    address: string;
    source: string;
    reason: string;
  }>;
}

/** One inbound row by id, read with the admin client (service role, no RLS). */
async function inboundRow(id: string): Promise<Record<string, unknown>> {
  const { data, error } = await admin
    .from('inbound_messages')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw new Error(`Reading inbound_messages failed: ${error.message}`);
  return data as Record<string, unknown>;
}

/** One quote + one live cadence carrying BOTH snapshot addresses. */
async function seedThreadableCadence(
  description: string,
): Promise<{ cadenceId: string; quoteId: string; sm8JobUuid: string }> {
  const [quote] = await seedQuotes(tenantId, [
    { job_description: description, chase_eligibility: 'eligible' },
  ]);

  const cadenceId = await seedCadence(tenantId, quote.id, {
    sm8_job_uuid: quote.sm8_job_uuid,
    contact_name: 'Quiet Please',
    contact_mobile: SNAPSHOT_MOBILE,
    contact_email: SNAPSHOT_EMAIL,
  });

  return { cadenceId, quoteId: quote.id, sm8JobUuid: quote.sm8_job_uuid };
}

beforeAll(async () => {
  tenantId = await seedTenant('Inbound Stop');
  // Unpaused: dispatch skips a tenant whose connection is paused before it ever
  // opens a claim transaction, so the gate-chain block would refuse for the
  // wrong reason and prove nothing about suppression.
  await seedConnection(tenantId);

  const first = await seedThreadableCadence('inbound: the stop target');
  firstCadenceId = first.cadenceId;

  // Three scheduled touches. `skipUnsentForCadences` must retire all of them —
  // a stopped cadence whose touches are still `scheduled` is exactly the state
  // that makes a killed cadence keep sending.
  await seedTouches(
    firstCadenceId,
    tenantId,
    [1, 2, 3].map((n) => ({
      status: n === 1 ? 'approved' : 'scheduled',
      scheduled_at: new Date(Date.now() + n * MS_PER_HOUR).toISOString(),
      original_offset_days: n,
    })),
  );
});

afterAll(async () => {
  // BY ID, and before the tenant teardown: the unmatched row carries
  // `tenant_id = NULL` and no tenant-keyed delete can reach it (see header).
  if (inboundIds.length > 0) {
    const { error } = await admin.from('inbound_messages').delete().in('id', inboundIds);
    if (error) {
      throw new Error(`Teardown failed, inbound_messages left behind: ${error.message}`);
    }
  }
  // ACROSS EVERY TENANT (04-02). The repeat-STOP block takes the unmatched
  // branch, which now suppresses the bare mobile for every client on the
  // database (D-03) — including tenants this suite did not create and
  // `teardownTenants` cannot reach. Leaving those behind would mean a seeded
  // test number silently suppressed forever on a database shared with
  // production.
  const stray = await admin
    .from('suppressed_contacts')
    .delete()
    .in('address', [SNAPSHOT_MOBILE, SNAPSHOT_EMAIL]);
  if (stray.error) {
    throw new Error(`Teardown failed, suppressed_contacts left behind: ${stray.error.message}`);
  }

  await teardownTenants([tenantId]);
  await closeDb();
});

/* ------------------------------------------------------------------------- *
 * The spine: STOP in → suppression + stop + skip + evidence out
 * ------------------------------------------------------------------------- */

it('threads a STOP from a differently-spelled mobile and suppresses BOTH channels', async () => {
  const result = await handleInboundSms({
    // LOCAL AND SPACED, deliberately unlike the `+614…` on the cadence. This is
    // MSG-04's encoding edge: both sides go through `normalizeAuMobile`, so one
    // human is one key however their provider spells it.
    from: INBOUND_FROM,
    to: INBOUND_TO,
    body: 'STOP',
    providerMessageId: 'test-inbound-stop-1',
  });

  expect(result.kind).toBe('stop_threaded');
  if (result.kind !== 'stop_threaded') throw new Error('unreachable');
  inboundIds.push(result.inboundId);

  expect(result.tenantId).toBe(tenantId);
  expect(result.cadenceId).toBe(firstCadenceId);
  expect(result.addressesSuppressed).toBe(2);
  expect(result.touchesSkipped).toBe(3);
  expect(result.cadenceStopped).toBe(true);

  // ── BOTH CHANNELS, BYTE-EQUAL TO THE SNAPSHOT ──────────────────────────────
  //
  // The addresses are asserted against the CADENCE SNAPSHOT constants, not
  // against anything derived from the inbound message. Those exact strings are
  // what dispatch and the creation gate probe with, so a suppression stored
  // under any other spelling is a suppression that suppresses nobody — and the
  // email is here because honouring "stop contacting me" on SMS while emailing
  // them anyway is a loophole, not compliance.
  expect(await suppressionRows()).toEqual([
    {
      channel: 'email',
      address: SNAPSHOT_EMAIL,
      source: 'sms_stop',
      reason: 'The customer replied STOP to a follow-up SMS.',
    },
    {
      channel: 'sms',
      address: SNAPSHOT_MOBILE,
      source: 'sms_stop',
      reason: 'The customer replied STOP to a follow-up SMS.',
    },
  ]);

  const repo = forTenant(tenantId);
  const [cadence] = await repo.cadences.getById(firstCadenceId);
  expect(cadence.status).toBe('stopped');
  // From the matrix's `contact_killed` arm, not a literal in the Phase 4 code —
  // there is no `opt_out` event, and Phase 7 attributes revenue on this column.
  expect(cadence.stopReason).toBe('contact_suppressed');
  expect(cadence.pauseReason).toBeNull();

  const touches = await repo.touches.listForCadence(firstCadenceId);
  expect(touches.map((touch) => touch.status)).toEqual(['skipped', 'skipped', 'skipped']);
  expect(touches.map((touch) => touch.skipReason)).toEqual([
    'suppressed',
    'suppressed',
    'suppressed',
  ]);

  // ── THE EVIDENCE ROW ───────────────────────────────────────────────────────
  const row = await inboundRow(result.inboundId);
  expect(row.attribution).toBe('threaded');
  expect(row.is_stop).toBe(true);
  expect(row.matched_cadence_count).toBe(1);
  expect(row.tenant_id).toBe(tenantId);
  expect(row.cadence_id).toBe(firstCadenceId);
  // The MATCHING KEY, stored: `+614…` from a `0412 345 678` that arrived.
  expect(row.normalized_from).toBe(SNAPSHOT_MOBILE);
  // And the RAW form beside it, untouched — the only thing an operator has to
  // triage with when normalization fails.
  expect(row.from_address).toBe(INBOUND_FROM);
  expect(row.to_address).toBe(INBOUND_TO);
  expect(row.body).toBe('STOP');
  expect(row.candidate_tenant_ids).toBeNull();
});

/**
 * The flagged assumption from the plan, resolved rather than left for UAT.
 *
 * A second STOP from an already-suppressed human finds NO live cadence (the
 * first one stopped it), so it takes the unmatched branch. Two things must be
 * true and neither is obvious: THIS tenant gains no duplicate suppression row,
 * and the message is STILL RECORDED — a customer repeating themselves must not
 * vanish just because we already agree with them.
 *
 * UPDATED IN 04-02. When this suite was written, the unmatched branch recorded
 * and did nothing, and `inbound.ts`'s header named that as a real Spam Act gap.
 * 04-02 closed it: an unthreadable STOP now suppresses the bare mobile for
 * EVERY client (D-03). For this block that changes nothing observable at this
 * tenant — the pair is already suppressed and the insert is idempotent at the
 * unique index — but it DOES write a row at every other tenant on the database,
 * which is why `afterAll` now deletes by address across tenants.
 *
 * DEPENDS ON THE BLOCK ABOVE having run.
 */
it('records a repeat STOP without duplicating the suppression', async () => {
  const before = await suppressionRows();

  const result = await handleInboundSms({
    from: INBOUND_FROM,
    to: INBOUND_TO,
    body: 'stop',
    providerMessageId: 'test-inbound-stop-2',
  });

  // UNMATCHED, not threaded: there is no live cadence left to stop. The
  // attribution states our CONFIDENCE about whose conversation this is, which
  // is independent of what was done about it — and what is now done about it is
  // a fan-out.
  expect(result.kind).toBe('stop_unmatched');
  if (result.kind !== 'stop_unmatched') throw new Error('unreachable');
  inboundIds.push(result.inboundId);
  expect(result.tenantsSuppressed).toBeGreaterThanOrEqual(1);

  // IDEMPOTENT HERE. The fan-out included this tenant, whose mobile+email pair
  // the first STOP already wrote; the unique index absorbed it and the original
  // rows keep their original reason.
  expect(await suppressionRows()).toEqual(before);

  const row = await inboundRow(result.inboundId);
  expect(row.attribution).toBe('unmatched');
  expect(row.is_stop).toBe(true);
  expect(row.matched_cadence_count).toBe(0);
  // NULL tenant — nobody owns it, so only `is_operator()` may read it (T-4-04),
  // and only an id-keyed delete can tear it down.
  expect(row.tenant_id).toBeNull();
  expect(row.normalized_from).toBe(SNAPSHOT_MOBILE);
});

/* ------------------------------------------------------------------------- *
 * The gate chain — the assertion the two halves above cannot make alone
 * ------------------------------------------------------------------------- */

/**
 * A BRAND NEW live cadence for the same human, and a real dispatch tick.
 *
 * Seeded directly through the repository seeders rather than through the
 * creation path on purpose: the creation gate would refuse it outright (which is
 * correct, and is what `tests/cadence-controls.test.ts` already proves). What is
 * NOT proven anywhere else is the just-in-time refusal — the enqueue → suppress
 * → refuse case, where a touch was approved BEFORE the STOP arrived. That is the
 * case MSG-03 means by "immediate at the send gate", and bypassing the creation
 * gate is the only way to construct it.
 */
it('makes dispatch refuse a live approved touch for the suppressed address', async () => {
  const [dueAt] = inWindowHours(1, Date.now());
  secondDueAt = dueAt;

  const second = await seedThreadableCadence('inbound: approved before the stop');
  secondCadenceId = second.cadenceId;

  const [touch] = await seedTouches(secondCadenceId, tenantId, [
    {
      status: 'approved',
      // Five minutes before the dispatch moment: due, and nowhere near D-11's
      // staleness cap.
      scheduled_at: new Date(dueAt.getTime() - 5 * 60_000).toISOString(),
      original_offset_days: 0,
    },
  ]);
  secondTouchId = touch.id;

  const sender = new RecordingStubSender();
  const result = await dispatchDueTouches({ sender, now: secondDueAt });

  // THE ASSERTION THIS SUITE EXISTS FOR. `refusals.suppressed` is incremented by
  // `tx.suppression.existsFor([{channel, address}])` finding the row the STOP
  // wrote — so it can only be non-zero if the STOP stored the address in the
  // exact spelling dispatch asks about. Any other spelling scores zero here
  // while every other assertion in this file still passes.
  expect(result.refusals.suppressed).toBeGreaterThanOrEqual(1);

  const repo = forTenant(tenantId);
  const [refused] = (await repo.touches.listForCadence(secondCadenceId)).filter(
    (t) => t.id === secondTouchId,
  );
  expect(refused.status).toBe('skipped');
  expect(refused.skipReason).toBe('suppressed');

  // And the cadence behind it is stopped terminally, by dispatch itself.
  const [cadence] = await repo.cadences.getById(secondCadenceId);
  expect(cadence.status).toBe('stopped');
  expect(cadence.stopReason).toBe('contact_suppressed');

  // NOTHING WAS SENT to this address. A ledger row would mean the claim ran
  // before the suppression probe, which is the ordering bug the JIT gate exists
  // to prevent.
  expect(
    sender.sent.filter((request) => request.to.address === SNAPSHOT_MOBILE),
  ).toEqual([]);
});
