/**
 * MSG-03 through the email door: one click, both channels, against the real
 * database.
 *
 * ── WHAT THIS SUITE IS ACTUALLY PROVING ─────────────────────────────────────
 *
 * Not "the route returns 200". The same guarantee `tests/inbound-stop.test.ts`
 * makes for SMS, one channel over, and the same silent failure it exists to
 * catch:
 *
 *   AN UNSUBSCRIBE MUST BE WRITTEN IN EXACTLY THE SPELLING DISPATCH PROBES.
 *
 * `dispatch.ts` asks `tx.suppression.existsFor([{channel, address}])` with the
 * cadence's snapshot address verbatim. An unsubscribe handler that stored a
 * re-lowercased address, or wrote only the email and not the paired mobile,
 * would produce a suppression row that looks right in the console and that no
 * probe ever matches. Every unit test would pass. The customer would keep being
 * chased after clicking the one link the Spam Act requires us to honour.
 *
 * So this suite asserts the suppression, and then drives a REAL DISPATCH TICK at
 * a second live cadence for the same human — with an EMAIL touch, because that
 * is the channel this plan opens — and requires it to refuse.
 *
 * ── THE PURE HALF IS `tests/unsubscribe.test.ts` ────────────────────────────
 *
 * The token algebra, the uniform responses and the route's disclosure rules are
 * asserted there with `suppressFromInbound` mocked. This file mocks nothing: the
 * route, `controls.ts`, the repository and the hosted Sydney database are all
 * real, because the question here is what actually lands in a table.
 *
 * ── ORDERED, AND THAT IS LOAD-BEARING ───────────────────────────────────────
 *
 * These `it` blocks share one tenant and run in file order. The replay block
 * only means anything AFTER the first click has already suppressed, and the
 * gate-chain block only after both.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';

import { dispatchDueTouches } from '@/core/cadence/dispatch';
import { StubSender, type SendOutcome, type SendRequest } from '@/core/cadence/sender';
import { isInsideWindow, type ContactWindow } from '@/core/cadence/window';
import { mintUnsubscribeToken } from '@/core/messaging/unsubscribe-token';
import { getServerEnv } from '@/core/shared/env';
import { closeDb, forTenant } from '@/db/repository';

import { POST } from '@/app/api/unsubscribe/route';

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
 * ONE HUMAN, TWO ADDRESSES. The mobile is an ACMA fiction number
 * (`0491 570 1xx`), which is guaranteed never to be allocated to a real
 * subscriber — this suite writes suppression rows to a database shared with
 * production, and a real number seeded here would be a real person silently
 * suppressed if a teardown ever failed.
 */
const SNAPSHOT_MOBILE = '+61491570153';
const SNAPSHOT_EMAIL = 'unsubscribe.proof@example.test';

const BASE = 'https://quotes.example.test';

let tenantId: string;
let firstCadenceId: string;
let secondCadenceId: string;
let secondTouchId: string;

/** A sender that remembers, so "nothing was sent" is assertable rather than inferred. */
class RecordingStubSender extends StubSender {
  readonly sent: SendRequest[] = [];

  override async send(request: SendRequest): Promise<SendOutcome> {
    this.sent.push(request);
    return super.send(request);
  }
}

function unsubscribeRequest(token: string): Request {
  const url = new URL('/api/unsubscribe', BASE);
  url.searchParams.set('token', token);
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'List-Unsubscribe=One-Click',
  });
}

/** The real signing secret, from the same validated env the route reads. */
function tokenFor(cadenceId: string): string {
  return mintUnsubscribeToken(
    { tenantId, cadenceId },
    getServerEnv().UNSUBSCRIBE_SIGNING_SECRET,
  );
}

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

/** One quote + one live cadence carrying BOTH snapshot addresses. */
async function seedThreadableCadence(description: string): Promise<string> {
  const [quote] = await seedQuotes(tenantId, [
    { job_description: description, chase_eligibility: 'eligible' },
  ]);

  return seedCadence(tenantId, quote.id, {
    sm8_job_uuid: quote.sm8_job_uuid,
    contact_name: 'Unsubscribe Proof',
    contact_mobile: SNAPSHOT_MOBILE,
    contact_email: SNAPSHOT_EMAIL,
  });
}

/** `count` successive whole hours inside the tenant's contact window. */
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

beforeAll(async () => {
  tenantId = await seedTenant('Email Unsubscribe');
  // Unpaused: dispatch skips a paused tenant before it opens a claim
  // transaction, so the gate-chain block would refuse for the wrong reason.
  await seedConnection(tenantId);

  firstCadenceId = await seedThreadableCadence('unsubscribe: the click target');

  await seedTouches(
    firstCadenceId,
    tenantId,
    [1, 2, 3].map((n) => ({
      channel: 'email',
      status: n === 1 ? 'approved' : 'scheduled',
      scheduled_at: new Date(Date.now() + n * MS_PER_HOUR).toISOString(),
      original_offset_days: n,
    })),
  );
});

afterAll(async () => {
  // ACROSS EVERY TENANT and BY ADDRESS, before the tenant teardown. Nothing in
  // this suite fans out today, but the address pair is the key `suppressed_
  // contacts` is probed by and this database is shared with production — a
  // seeded address left suppressed anywhere is a customer nobody may contact,
  // with no grant that can undo it (D-06 is irreversible by design).
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
 * The spine: one click → suppression + stop + skip
 * ------------------------------------------------------------------------- */

it('suppresses BOTH channels verbatim and stops the cadence on one click', async () => {
  const response = await POST(unsubscribeRequest(tokenFor(firstCadenceId)));

  expect(response.status).toBe(200);

  // ── BOTH CHANNELS, BYTE-EQUAL TO THE SNAPSHOT ─────────────────────────────
  //
  // Asserted against the CADENCE SNAPSHOT constants, not against anything
  // derived from the request: those exact strings are what dispatch and the
  // creation gate probe with. And the MOBILE is here because honouring "stop
  // emailing me" while continuing to text them is a loophole, not compliance —
  // one human asked to be left alone.
  expect(await suppressionRows()).toEqual([
    {
      channel: 'email',
      address: SNAPSHOT_EMAIL,
      source: 'email_unsubscribe',
      reason: 'The customer used the unsubscribe link in a follow-up email.',
    },
    {
      channel: 'sms',
      address: SNAPSHOT_MOBILE,
      source: 'email_unsubscribe',
      reason: 'The customer used the unsubscribe link in a follow-up email.',
    },
  ]);

  const repo = forTenant(tenantId);
  const [cadence] = await repo.cadences.getById(firstCadenceId);
  expect(cadence.status).toBe('stopped');
  // From the matrix's `contact_killed` arm, not a literal in any Phase 4 file —
  // Phase 7 attributes recovered revenue on this column.
  expect(cadence.stopReason).toBe('contact_suppressed');

  const touches = await repo.touches.listForCadence(firstCadenceId);
  expect(touches.map((touch) => touch.status)).toEqual(['skipped', 'skipped', 'skipped']);
  expect(touches.map((touch) => touch.skipReason)).toEqual([
    'suppressed',
    'suppressed',
    'suppressed',
  ]);
});

it('is idempotent on a replay, and indistinguishable from a forgery (T-4-20)', async () => {
  const before = await suppressionRows();

  // A second click — the ordinary case: two devices, a forwarded email, or a
  // mail scanner following the one-click POST after the human already did.
  const replay = await POST(unsubscribeRequest(tokenFor(firstCadenceId)));
  const replayBody = await replay.text();

  expect(await suppressionRows()).toEqual(before);

  // A token signed with the wrong key, against the same live database.
  const forged = await POST(
    unsubscribeRequest(
      mintUnsubscribeToken(
        { tenantId, cadenceId: firstCadenceId },
        'a-forgers-secret-that-is-also-32-plus-chars',
      ),
    ),
  );

  expect(await replay.status).toBe(forged.status);
  expect(replayBody).toBe(await forged.text());
  // The forgery wrote nothing — the rows are still exactly what the real click
  // left behind.
  expect(await suppressionRows()).toEqual(before);
});

/* ------------------------------------------------------------------------- *
 * The gate chain — the assertion the halves above cannot make alone
 * ------------------------------------------------------------------------- */

it('makes dispatch refuse a live approved EMAIL touch for the unsubscribed address', async () => {
  const [dueAt] = inWindowHours(1, Date.now());

  // Seeded directly rather than through the creation path: the creation gate
  // would refuse this cadence outright (correctly, and that is covered
  // elsewhere). What is NOT covered anywhere else is the just-in-time refusal —
  // a touch APPROVED BEFORE the unsubscribe arrived, which is exactly what
  // MSG-03 means by "immediate at the send gate".
  secondCadenceId = await seedThreadableCadence('unsubscribe: approved before the click');

  const [touch] = await seedTouches(secondCadenceId, tenantId, [
    {
      channel: 'email',
      status: 'approved',
      scheduled_at: new Date(dueAt.getTime() - 5 * 60_000).toISOString(),
      original_offset_days: 0,
    },
  ]);
  secondTouchId = touch.id;

  const sender = new RecordingStubSender();
  const result = await dispatchDueTouches({ sender, now: dueAt });

  // THE ASSERTION THIS SUITE EXISTS FOR. `refusals.suppressed` can only be
  // non-zero if the unsubscribe stored the EMAIL address in the exact spelling
  // dispatch asks about, on the email channel. Any other spelling scores zero
  // here while every other assertion in this file still passes.
  expect(result.refusals.suppressed).toBeGreaterThanOrEqual(1);

  const repo = forTenant(tenantId);
  const [refused] = (await repo.touches.listForCadence(secondCadenceId)).filter(
    (t) => t.id === secondTouchId,
  );
  expect(refused.status).toBe('skipped');
  expect(refused.skipReason).toBe('suppressed');

  const [cadence] = await repo.cadences.getById(secondCadenceId);
  expect(cadence.status).toBe('stopped');
  expect(cadence.stopReason).toBe('contact_suppressed');

  // NOTHING WAS SENT to the address. A ledger row would mean the claim ran
  // before the suppression probe — the ordering bug the JIT gate prevents.
  expect(sender.sent.filter((request) => request.to.address === SNAPSHOT_EMAIL)).toEqual([]);
});
