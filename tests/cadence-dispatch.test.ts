/**
 * CAD-04 and CAD-05 against the real database: the concurrent-tick race, and
 * the four just-in-time refusals.
 *
 * ── WHY THE RACE HAS TO BE REAL ─────────────────────────────────────────────
 *
 * "A customer is never messaged twice for the same touch" is the guarantee this
 * whole phase is built around, and it is enforced by a Postgres unique index
 * rather than by anything TypeScript can see. A test that called dispatch twice
 * in sequence would prove only that the second call read a row the first one
 * wrote — the interesting case is two transactions that are open AT THE SAME
 * TIME on DIFFERENT CONNECTIONS, because that is the one where an
 * application-level "have we sent this?" check would pass twice.
 *
 * So the race is asserted from both ends, because the two interleavings exercise
 * different mechanisms:
 *
 *   THROUGH THE PRODUCTION PATH — two overlapping `dispatchDueTouches` calls in
 *   one `Promise.all`. The repository's pool holds five connections, so the two
 *   claim transactions genuinely run side by side. Here `FOR UPDATE SKIP LOCKED`
 *   usually settles it before the ledger is ever reached: the loser skips the
 *   locked row and claims nothing. That is LIVENESS, and it is what stops two
 *   ticks from blocking on each other — but on its own it proves nothing about
 *   correctness, because SKIP LOCKED can be bypassed entirely by a second
 *   deployment, a manual invocation or a cron that fired twice.
 *
 *   THROUGH TWO SEPARATE CLIENTS — two `postgres()` connections of this suite's
 *   own, racing the same `ON CONFLICT … DO NOTHING` insert with no lock between
 *   them. That is CORRECTNESS, and it is the interleaving the first assertion
 *   cannot reach. Exactly one row exists afterwards, and the loser learns so
 *   from zero returned rows rather than from an error.
 *
 * ── DUE-NESS IS THE ISOLATION MECHANISM ─────────────────────────────────────
 *
 * `dispatchDueTouches` walks EVERY tenant, so seeding one tenant per scenario
 * would not keep the scenarios apart — every call would sweep them all. What
 * keeps them apart is the pinned clock: each scenario's touch is scheduled into
 * its own in-window hour, so only that scenario's touch is due at the moment its
 * test dispatches. The hours are found by asking `isInsideWindow` rather than by
 * hand, so a suite run on a Saturday evening behaves exactly like one run on a
 * Tuesday morning.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import postgres, { type Sql } from 'postgres';

import { CADENCE_CONSUMER } from '../src/core/cadence/constants';
import { dispatchDueTouches } from '../src/core/cadence/dispatch';
import { runCadenceTick } from '../src/core/cadence/run-tick';
import type { SendOutcome, SendRequest, TouchSender } from '../src/core/cadence/sender';
import { isInsideWindow, type ContactWindow } from '../src/core/cadence/window';
import { closeDb, forTenant } from '../src/db/repository';

import { testEnv } from './helpers/env';
import {
  admin,
  seedCadence,
  seedConnection,
  seedQuotes,
  seedSuppression,
  seedTenant,
  seedApprovedDraft,
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
 * A sender that answers exactly like the stub and remembers what it was asked.
 *
 * `provider` is the literal `'stub'` so the ledger rows this suite writes stay
 * structurally indistinguishable from every other Phase 3 send — the D-13 rule
 * is that a stub row is excludable from attribution forever, and a test sender
 * inventing its own provider name would be the one exception nobody remembers.
 */
class CountingSender implements TouchSender {
  readonly provider = 'stub';
  readonly sent: SendRequest[] = [];

  async send(request: SendRequest): Promise<SendOutcome> {
    this.sent.push(request);
    return { kind: 'sent', provider: this.provider, providerMessageId: null };
  }
}

/**
 * `count` successive whole hours that fall inside the tenant's contact window.
 *
 * Found by asking the production predicate rather than by constructing a
 * "Tuesday at 10am": a hand-picked instant is a date that is inside the window
 * on the day it was written and, once a weekend or a public holiday moves under
 * it, a suite that fails for a reason unrelated to what it asserts.
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

/** The first whole hour after `from` at which the window is SHUT. */
function firstClosedHour(from: number): Date {
  for (let step = 1; step <= 24 * 14; step += 1) {
    const candidate = new Date(from + step * MS_PER_HOUR);
    if (!isInsideWindow(candidate, WINDOW)) return candidate;
  }
  throw new Error('The contact window never closes within a fortnight.');
}

let tenantId: string;
let pausedTenantId: string;
let closedWindowTenantId: string;

/** Every scenario's fixtures, resolved in `beforeAll`. */
interface Scenario {
  quoteId: string;
  cadenceId: string;
  touchId: string;
  /** The moment at which this scenario's touch — and only this one — is due. */
  dueAt: Date;
  address: string;
  /**
   * The exact bytes of this scenario's approved draft (05-01).
   *
   * Dispatch no longer composes a body — it sends `touch_drafts.final_body`
   * verbatim — so this is what a `SendRequest.body` assertion compares against.
   */
  finalBody: string;
}

let race: Scenario;
let suppressed: Scenario;
let closedQuote: Scenario;
let paused: Scenario;
let outsideWindow: Scenario;

/** Park the shared consumer cursor at the newest event, i.e. "caught up". */
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
  if (upsertError) {
    throw new Error(`Parking the cadence cursor failed: ${upsertError.message}`);
  }
}

/** One quote + one active cadence + one approved touch, due at `dueAt`. */
async function seedScenario(
  ownerTenantId: string,
  description: string,
  dueAt: Date,
  address: string,
): Promise<Scenario> {
  const [quote] = await seedQuotes(ownerTenantId, [
    { job_description: description, chase_eligibility: 'eligible' },
  ]);

  const cadenceId = await seedCadence(ownerTenantId, quote.id, {
    sm8_job_uuid: quote.sm8_job_uuid,
    contact_name: 'Robin Vasquez',
    contact_mobile: address,
  });

  // Five minutes before the moment the scenario dispatches at, so the touch is
  // due but nowhere near D-11's staleness cap.
  const [touch] = await seedTouches(cadenceId, ownerTenantId, [
    {
      status: 'approved',
      scheduled_at: new Date(dueAt.getTime() - 5 * 60_000).toISOString(),
      original_offset_days: 0,
    },
  ]);

  // 05-01: an `approved` touch is no longer sufficient. Dispatch reads the
  // approved draft inside the claim transaction and refuses `no_approved_draft`
  // when there is none, so a scenario that expects to be EVALUATED at all needs
  // one — including the scenarios that then refuse for another reason, since a
  // missing draft would mask the refusal actually under test.
  const finalBody = await seedApprovedDraft(
    ownerTenantId,
    cadenceId,
    touch.id,
    touch.touch_number,
    { final_body: `Approved draft for ${description}. Reply STOP to opt out.` },
  );

  return { quoteId: quote.id, cadenceId, touchId: touch.id, dueAt, address, finalBody };
}

let clientA: Sql;
let clientB: Sql;

beforeAll(async () => {
  await parkCursorAtHead();

  tenantId = await seedTenant('Cadence Dispatch');
  pausedTenantId = await seedTenant('Cadence Dispatch Paused');
  closedWindowTenantId = await seedTenant('Cadence Dispatch Closed Window');

  await seedConnection(tenantId);
  await seedConnection(closedWindowTenantId);
  // D-08: the key stopped working. Dispatch must not reach this client at all.
  await seedConnection(pausedTenantId, {
    paused_at: new Date().toISOString(),
    status_reason: 'auth_failed',
  });

  const hours = inWindowHours(3, Date.now());

  race = await seedScenario(tenantId, 'dispatch: the race', hours[0], '+61400111222');
  suppressed = await seedScenario(
    tenantId,
    'dispatch: suppressed after approval',
    hours[1],
    '+61400333444',
  );
  closedQuote = await seedScenario(
    tenantId,
    'dispatch: quote closed after approval',
    hours[2],
    '+61400555666',
  );

  // The paused client's touch comes due at the same moment as the race, which is
  // the point: it is skipped for who it belongs to, not for when it is due.
  paused = await seedScenario(
    pausedTenantId,
    'dispatch: paused connection',
    hours[0],
    '+61400777888',
  );

  // Deliberately after every in-window scenario, so it is not due while they run.
  outsideWindow = await seedScenario(
    closedWindowTenantId,
    'dispatch: outside the contact window',
    new Date(firstClosedHour(hours[2].getTime()).getTime()),
    '+61400999000',
  );

  // TWO CONNECTIONS OF THIS SUITE'S OWN, for the ledger race below. `prepare:
  // false` is mandatory on Supabase's transaction pooler, which does not support
  // prepared statements — the same setting `src/db/repository/client.ts` uses.
  clientA = postgres(testEnv.databaseUrl, { prepare: false, max: 1 });
  clientB = postgres(testEnv.databaseUrl, { prepare: false, max: 1 });
});

afterAll(async () => {
  await Promise.all([clientA?.end({ timeout: 5 }), clientB?.end({ timeout: 5 })]);
  await teardownTenants([tenantId, pausedTenantId, closedWindowTenantId]);
  await closeDb();
});

/** Ledger rows for one cadence — the record of what was actually sent. */
async function ledgerFor(scenario: Scenario, owner = tenantId) {
  return forTenant(owner).ledger.listForCadence(scenario.cadenceId);
}

/** The single touch of a scenario, re-read. */
async function touchOf(scenario: Scenario, owner = tenantId) {
  const [touch] = await forTenant(owner).touches.listForCadence(scenario.cadenceId);
  return touch;
}

async function cadenceOf(scenario: Scenario, owner = tenantId) {
  const [cadence] = await forTenant(owner).cadences.getByQuoteId(scenario.quoteId);
  return cadence;
}

describe('CAD-04 — two ticks racing one due touch', () => {
  it('produces exactly one ledger row and exactly one send under a genuine two-connection race', async () => {
    const sender = new CountingSender();

    // ONE `Promise.all`, not two awaits: the two claim transactions must overlap
    // in time. `vitest.config.mts` disables file parallelism, so the only way to
    // get real concurrency in this repository is within a single test.
    const [first, second] = await Promise.all([
      dispatchDueTouches({ sender, now: race.dueAt }),
      dispatchDueTouches({ sender, now: race.dueAt }),
    ]);

    // Neither call throws. A refusal is an answer here, never an exception —
    // if losing the race raised, one tick's failure would abort every other
    // client's sends in the same invocation.
    expect(first.dispatched + second.dispatched).toBe(1);
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].to.address).toBe(race.address);
    // 05-01 / D-10: the bytes are the APPROVED DRAFT's, not something dispatch
    // composed. Asserted here as well as in draft-pipeline because this is the
    // path a real race takes, and a stub fallback would still pass every other
    // assertion in this test.
    expect(sender.sent[0].body).toBe(race.finalBody);

    const ledger = await ledgerFor(race);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].touchNumber).toBe(1);
    expect(ledger[0].sender).toBe('stub');
    expect(ledger[0].outcome).toBe('stub_sent');

    const touch = await touchOf(race);
    expect(touch.status).toBe('sent');
    expect(touch.skipReason).toBeNull();
  });

  it('refuses the second claim of the same touch with zero rows, not an error', async () => {
    // The other interleaving: SKIP LOCKED bypassed entirely, both claimants
    // reaching the INSERT. This is the arm that still holds for a second
    // deployment, a manual invocation or a cron that fired twice.
    const cadenceId = randomUUID();
    const repo = forTenant(tenantId);

    const claim = () =>
      repo.ledger.insertClaim({
        cadenceId,
        quoteId: race.quoteId,
        touchNumber: 1,
        channel: 'sms',
        toAddress: race.address,
        sender: 'stub',
      });

    const won = await claim();
    expect(won).toHaveLength(1);

    const lost = await claim();
    expect(lost).toEqual([]);
  });

  it('lets exactly one of two SEPARATE database connections win the same claim', async () => {
    const cadenceId = randomUUID();

    const insert = (client: Sql) => client`
      insert into send_ledger
        (tenant_id, cadence_id, quote_id, touch_number, channel, to_address, sender)
      values
        (${tenantId}, ${cadenceId}, ${race.quoteId}, 1, 'sms', ${race.address}, 'stub')
      on conflict (cadence_id, touch_number) do nothing
      returning id
    `;

    const [a, b] = await Promise.all([insert(clientA), insert(clientB)]);

    // One row returned, one empty result — never two, and never an error on the
    // losing side. Postgres decided, which is the entire argument for putting
    // the guarantee in an index instead of in application code.
    expect(a.length + b.length).toBe(1);

    const rows = await forTenant(tenantId).ledger.listForCadence(cadenceId);
    expect(rows).toHaveLength(1);
  });
});

describe('CAD-05 — the just-in-time refusals', () => {
  it('refuses a due, approved touch whose recipient was suppressed after approval', async () => {
    await seedSuppression(tenantId, [
      { channel: 'sms', address: suppressed.address, reason: 'replied STOP', source: 'sms_stop' },
    ]);

    const sender = new CountingSender();
    const result = await dispatchDueTouches({ sender, now: suppressed.dueAt });

    expect(sender.sent).toEqual([]);
    expect(result.refusals.suppressed).toBe(1);

    // NOTHING WAS CLAIMED. The ledger is the record of what was sent, and a
    // refused touch must leave no trace in it at all.
    expect(await ledgerFor(suppressed)).toEqual([]);

    const touch = await touchOf(suppressed);
    expect(touch.status).toBe('skipped');
    expect(touch.skipReason).toBe('suppressed');

    const cadence = await cadenceOf(suppressed);
    expect(cadence.status).toBe('stopped');
    expect(cadence.stopReason).toBe('contact_suppressed');
  });

  it('leaves a paused client\'s touch completely untouched', async () => {
    const before = await touchOf(paused, pausedTenantId);

    const sender = new CountingSender();
    await dispatchDueTouches({ sender, now: paused.dueAt });

    expect(sender.sent).toEqual([]);
    expect(await ledgerFor(paused, pausedTenantId)).toEqual([]);

    // A pause is REVERSIBLE, so consuming the touch would destroy work the
    // resume is supposed to restore. Same status, same slot, same row.
    const after = await touchOf(paused, pausedTenantId);
    expect(after.status).toBe('approved');
    expect(after.skipReason).toBeNull();
    expect(after.scheduledAt.getTime()).toBe(before.scheduledAt.getTime());
  });

  it('refuses a touch whose quote closed after approval, and stops the cadence', async () => {
    const { error } = await admin
      .from('quotes')
      .update({ status: 'Work Order' })
      .eq('id', closedQuote.quoteId);
    if (error) throw new Error(`Closing the quote failed: ${error.message}`);

    const sender = new CountingSender();
    const result = await dispatchDueTouches({ sender, now: closedQuote.dueAt });

    expect(sender.sent).toEqual([]);
    expect(result.refusals.quote_closed).toBe(1);
    expect(await ledgerFor(closedQuote)).toEqual([]);

    const touch = await touchOf(closedQuote);
    expect(touch.status).toBe('skipped');
    expect(touch.skipReason).toBe('quote_closed');

    // The stop reason is read off the quote's own state, never a generic
    // "closed": Phase 7 attributes revenue on this column and one bucket for a
    // won job, a lost job and a deleted job destroys the distinction.
    const cadence = await cadenceOf(closedQuote);
    expect(cadence.status).toBe('stopped');
    expect(cadence.stopReason).toBe('won');
  });

  /**
   * WR-01 — THE CORRUPTED ROW MUST TERMINATE.
   *
   * A cadence with no address on the touch's channel is unreachable by
   * construction, and the previous behaviour of refusing without writing was
   * correct about not borrowing a false skip reason and wrong about everything
   * else: the touch stayed `approved` with its slot in the past, so every tick
   * re-claimed it, burning one of the tenant's 50 claim slots and one identical
   * log line a minute for the six weeks until D-12 expired the cadence — and
   * `claimDue` orders by `scheduled_at`, so the corrupted row sat AHEAD of every
   * sendable touch behind it.
   *
   * The second dispatch is the assertion that matters: it must find nothing.
   */
  it('retires a touch with no address on its channel instead of re-claiming it forever', async () => {
    const [quote] = await seedQuotes(tenantId, [
      { job_description: 'dispatch: no address on the channel', chase_eligibility: 'eligible' },
    ]);

    const cadenceId = await seedCadence(tenantId, quote.id, {
      sm8_job_uuid: quote.sm8_job_uuid,
      contact_name: 'Robin Vasquez',
      contact_mobile: null,
      contact_email: null,
    });

    const now = closedQuote.dueAt;
    await seedTouches(cadenceId, tenantId, [
      {
        status: 'approved',
        scheduled_at: new Date(now.getTime() - 5 * 60_000).toISOString(),
        original_offset_days: 0,
      },
    ]);

    const sender = new CountingSender();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const first = await dispatchDueTouches({ sender, now });
    expect(first.refusals.no_address).toBe(1);

    const [touch] = await forTenant(tenantId).touches.listForCadence(cadenceId);
    expect(touch.status).toBe('skipped');
    expect(touch.skipReason).toBe('no_address');

    // Retired, so the next tick does not see it at all — the loop terminates
    // rather than running for six weeks.
    const second = await dispatchDueTouches({ sender, now });
    expect(second.refusals.no_address).toBe(0);
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();

    // Nothing was claimed, and nothing was sent, either time.
    expect(sender.sent).toEqual([]);
    expect(await forTenant(tenantId).ledger.listForCadence(cadenceId)).toEqual([]);
  });

  /**
   * WR-07 / G-3-5 — A MISSING MIRROR ROW IS NOT "the quote closed", AND IT IS
   * NOT "the job was removed" EITHER.
   *
   * `cadences` carries no FK to `quotes` (attribution survives a disconnect), so
   * a cadence whose quote row is gone is a reachable state. The cadence used to
   * be left LIVE in that case, because `stopReasonForQuote` genuinely cannot
   * answer from a missing row — so every subsequent tick claimed the next touch
   * and wrote another `quote_closed` skip, one per tick, until the completion
   * sweep closed the cadence as `all_touches_done`. Phase 7 then read a cadence
   * that "ran its course" with a handful of skips, not one of them true. WR-07
   * fixed that by stopping the cadence once, as `removed`.
   *
   * G-3-5 corrected the WORD. `removed` is a claim about ServiceM8 — it told us
   * the job is gone — and this path has no such evidence: the row could be
   * missing from a purge, a bug in our own sync, or a deletion we never saw.
   * Phase 7 attributes revenue on this column and cannot rebuild the
   * distinction later, so the two facts get two words. THIS TEST AND THE ONE
   * BELOW ARE A PAIR: together they assert the distinction rather than a
   * rename, and re-conflating either direction turns one of them red.
   */
  it('stops the cadence as `mirror_missing` when the quote row is gone, not one false skip per tick', async () => {
    const [quote] = await seedQuotes(tenantId, [
      { job_description: 'dispatch: quote row deleted', chase_eligibility: 'eligible' },
    ]);

    const cadenceId = await seedCadence(tenantId, quote.id, {
      sm8_job_uuid: quote.sm8_job_uuid,
      contact_name: 'Robin Vasquez',
      contact_mobile: '+61400222333',
    });

    const now = closedQuote.dueAt;
    await seedTouches(cadenceId, tenantId, [
      {
        status: 'approved',
        scheduled_at: new Date(now.getTime() - 5 * 60_000).toISOString(),
        original_offset_days: 0,
      },
      // The touch behind it. Under the old behaviour this one was still live
      // after the tick and collected the second false `quote_closed`.
      {
        status: 'scheduled',
        scheduled_at: new Date(now.getTime() + 3 * 86_400_000).toISOString(),
        original_offset_days: 3,
      },
    ]);

    const { error } = await admin.from('quotes').delete().eq('id', quote.id);
    if (error) throw new Error(`Deleting the mirrored quote failed: ${error.message}`);

    const sender = new CountingSender();
    const result = await dispatchDueTouches({ sender, now });

    expect(sender.sent).toEqual([]);
    // WR-01 — THE COUNTER SPLITS TOO, not just the stop reason. The tick
    // response body is the operator's only near-real-time view: under one shared
    // `quote_closed` label this refusal is indistinguishable from a customer who
    // bought or declined, and "a bug in our own sync" is one of the three
    // documented causes of this branch.
    expect(result.refusals.mirror_missing).toBe(1);
    expect(
      result.refusals.quote_closed,
      'a missing mirror row must not be counted as a closed quote',
    ).toBe(0);
    expect(await forTenant(tenantId).ledger.listForCadence(cadenceId)).toEqual([]);

    // NOT `quote_closed` (the quote did not close) and NOT `removed` (nobody
    // told us the job was deleted — we simply have no row). `mirror_missing` is
    // the only one of the three that is true from here.
    const [cadence] = await forTenant(tenantId).cadences.getByQuoteId(quote.id);
    expect(cadence.status).toBe('stopped');
    expect(cadence.stopReason).toBe('mirror_missing');

    // Both touches terminal, both under a reason that is true: the cadence
    // reached a terminal state first.
    const touches = await forTenant(tenantId).touches.listForCadence(cadenceId);
    expect(touches.map((t) => t.status)).toEqual(['skipped', 'skipped']);
    expect(touches.map((t) => t.skipReason)).toEqual(['cadence_stopped', 'cadence_stopped']);
  });

  /**
   * G-3-5, THE OTHER HALF — `removed` STILL MEANS AN OBSERVED DELETION.
   *
   * The sibling of the test above, and the reason the pair exists rather than a
   * single renamed assertion. Here the mirrored row IS present and carries
   * `sm8_active = false`, which is ServiceM8 telling us through the poll that
   * the job is gone. That is evidence, `stopReasonForQuote` reads it directly,
   * and the word stays `removed`.
   *
   * Delete the distinction in either direction — write `removed` for a missing
   * row again, or rename this path to `mirror_missing` — and one of these two
   * tests goes red. That is the whole point: G-3-5 is a claim about two buckets
   * being distinguishable, which no single assertion can hold on its own.
   */
  it('stops the cadence as `removed` when the row is PRESENT but ServiceM8 deactivated the job', async () => {
    const [quote] = await seedQuotes(tenantId, [
      { job_description: 'dispatch: job deleted upstream', chase_eligibility: 'eligible' },
    ]);

    const cadenceId = await seedCadence(tenantId, quote.id, {
      sm8_job_uuid: quote.sm8_job_uuid,
      contact_name: 'Robin Vasquez',
      contact_mobile: '+61400444555',
    });

    const now = closedQuote.dueAt;
    await seedTouches(cadenceId, tenantId, [
      {
        status: 'approved',
        scheduled_at: new Date(now.getTime() - 5 * 60_000).toISOString(),
        original_offset_days: 0,
      },
      {
        status: 'scheduled',
        scheduled_at: new Date(now.getTime() + 3 * 86_400_000).toISOString(),
        original_offset_days: 3,
      },
    ]);

    // The row STAYS — this is the difference from the test above. Phase 2's
    // deletion detection flips this flag on the true→false edge.
    const { error } = await admin
      .from('quotes')
      .update({ sm8_active: false })
      .eq('id', quote.id);
    if (error) throw new Error(`Deactivating the mirrored quote failed: ${error.message}`);

    const sender = new CountingSender();
    const result = await dispatchDueTouches({ sender, now });

    expect(sender.sent).toEqual([]);
    expect(result.refusals.quote_closed).toBe(1);
    expect(await forTenant(tenantId).ledger.listForCadence(cadenceId)).toEqual([]);

    const [cadence] = await forTenant(tenantId).cadences.getByQuoteId(quote.id);
    expect(cadence.status).toBe('stopped');
    expect(cadence.stopReason).toBe('removed');

    // The due touch is skipped under the tick's own reading (`quote_closed` —
    // there IS a row and it is no longer chaseable); the one behind it is
    // retired because the cadence stopped.
    const touches = await forTenant(tenantId).touches.listForCadence(cadenceId);
    expect(touches.map((t) => t.status)).toEqual(['skipped', 'skipped']);
    expect(touches.map((t) => t.skipReason)).toEqual(['quote_closed', 'cadence_stopped']);
  });
});

describe('CAD-02 — a touch that comes due outside contact hours is moved, never sent', () => {
  it('re-windows it to a future slot inside the window and claims nothing', async () => {
    const before = await touchOf(outsideWindow, closedWindowTenantId);
    const now = outsideWindow.dueAt;

    expect(isInsideWindow(now, WINDOW)).toBe(false);
    expect(before.scheduledAt.getTime()).toBeLessThanOrEqual(now.getTime());

    // THE WHOLE TICK, not just dispatch: the re-window pass is what moves it,
    // and the point of the case is that the two passes agree — one declines to
    // send, the other places it somewhere it can be.
    const sender = new CountingSender();
    await runCadenceTick({ draftClient: null, classifyClient: null, now, sender, jitterMinutes: () => 0 });

    expect(sender.sent).toEqual([]);
    expect(await ledgerFor(outsideWindow, closedWindowTenantId)).toEqual([]);

    const after = await touchOf(outsideWindow, closedWindowTenantId);
    expect(after.status).not.toBe('sent');
    expect(after.skipReason).toBeNull();
    expect(after.scheduledAt.getTime()).toBeGreaterThan(now.getTime());
    expect(isInsideWindow(after.scheduledAt, WINDOW)).toBe(true);
  });
});
