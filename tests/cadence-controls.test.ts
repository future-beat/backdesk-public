/**
 * CAD-03 against the real database: the D-16 operator control surface.
 *
 * ── WHAT THIS SUITE IS ACTUALLY PROVING ─────────────────────────────────────
 *
 * Not "the buttons call the functions". The three guarantees a kill switch is
 * bought for, each of which fails silently if it is wrong:
 *
 *   1. A per-contact kill is TERMINAL AND CROSS-CHANNEL, and it reaches quotes
 *      that do not exist yet. The last clause is the one that is easy to ship
 *      broken: stopping the cadence in front of the operator looks exactly like
 *      success, and the failure surfaces weeks later as the same customer being
 *      chased on their next job — which is the complaint, again, from the person
 *      who already made it. So the kill is asserted, and then a BRAND NEW quote
 *      for the same human is driven through the real creation path.
 *
 *   2. A reply pause SURVIVES a client-level resume (D-05). A test that only
 *      checked the resumed cadences would pass just as happily if the resume
 *      lifted everything, and the consequence of that bug is a machine walking
 *      back into a live conversation.
 *
 *   3. A resume REPAIRS the schedule the pause broke (D-07). Clearing the flag
 *      and reporting success while leaving four overdue touches where they are
 *      is a resume that texts a customer four times inside a minute.
 *
 * ── ORDERED, AND THAT IS LOAD-BEARING ───────────────────────────────────────
 *
 * These `it` blocks share one tenant and run in file order — `vitest.config.mts`
 * disables file parallelism and vitest runs a file's tests sequentially. Each
 * block may assume the state the previous one left. Where a block depends on
 * that, it says so.
 *
 * ── THE CONSUMER CURSOR IS GLOBAL, SO THIS SUITE PARKS IT ───────────────────
 *
 * `event_consumer_cursors` holds ONE row for the cadence engine across every
 * client. It is parked at the outbox head in `beforeAll` so the one consumption
 * this suite performs acts on its own event and no other suite's leftovers.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, expect, it } from 'vitest';

import { CADENCE_CONSUMER } from '../src/core/cadence/constants';
import { consumeQuoteEvents } from '../src/core/cadence/consume-events';
import {
  killContact,
  pauseClient,
  pauseForReply,
  resumeCadence,
  resumeClient,
} from '../src/core/cadence/controls';
import { isInsideWindow, type ContactWindow } from '../src/core/cadence/window';
import { markChaseEligible } from '../src/core/sync/eligibility';
import { closeDb, forTenant } from '../src/db/repository';

import {
  admin,
  seedCadence,
  seedConnection,
  seedQuoteContacts,
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

const MS_PER_DAY = 86_400_000;

/**
 * ONE HUMAN, TWO ADDRESSES — and the whole cross-channel rule rides on them.
 *
 * The normalized forms are written out here because they are what the
 * suppression rows must contain: `dispatch.ts` and the creation gate probe the
 * list with the cadence's snapshot verbatim, so a kill that stored any other
 * spelling would suppress nobody. The RAW forms below are what ServiceM8 would
 * actually hand us for the same person on a later job.
 */
const KILLED_MOBILE = '+61400555555';
const KILLED_EMAIL = 'gone.away@example.com';
const KILLED_MOBILE_RAW = '0400 555 555';
const KILLED_EMAIL_RAW = '  Gone.Away@Example.com ';

let tenantId: string;

/** The kill target, and the new quote its suppression must reach. */
let killedCadenceId: string;
let newQuote: { id: string; sm8_job_uuid: string };

/** Two cadences a client pause freezes, and one it must not touch (D-05). */
let clientCadenceIds: string[];
let replyPausedCadenceId: string;
/** The reply-paused cadence's slots, to prove a client resume left them alone. */
let replyPausedSlots: number[];

const now = new Date();

/**
 * A cadence whose remaining touches all fell due in the past.
 *
 * Anchored 25 days back so the 3/7/14 touches are unambiguously overdue and the
 * cadence is still inside D-12's 42-day expiry — an expiring cadence is a
 * different case with a different answer, and it is 03-04's.
 */
async function seedOverdueCadence(
  label: string,
  overrides: Record<string, unknown> = {},
): Promise<{ cadenceId: string; quoteId: string }> {
  const [quote] = await seedQuotes(tenantId, [
    { job_description: `controls: ${label}`, chase_eligibility: 'eligible' },
  ]);

  const anchorAt = new Date(now.getTime() - 25 * MS_PER_DAY);
  const cadenceId = await seedCadence(tenantId, quote.id, {
    sm8_job_uuid: quote.sm8_job_uuid,
    anchor_at: anchorAt.toISOString(),
    ...overrides,
  });

  await seedTouches(
    cadenceId,
    tenantId,
    [3, 7, 14].map((offsetDays) => ({
      scheduled_at: new Date(anchorAt.getTime() + offsetDays * MS_PER_DAY).toISOString(),
      original_offset_days: offsetDays,
      status: 'scheduled',
    })),
  );

  return { cadenceId, quoteId: quote.id };
}

/** Every suppression row this tenant holds, read with the admin client. */
async function suppressionRows(): Promise<Array<{ channel: string; address: string; source: string }>> {
  const { data, error } = await admin
    .from('suppressed_contacts')
    .select('channel, address, source')
    .eq('tenant_id', tenantId)
    .order('channel', { ascending: true });
  if (error) throw new Error(`Reading suppression failed: ${error.message}`);
  return (data ?? []) as Array<{ channel: string; address: string; source: string }>;
}

/** The client-level pause flag, read with the admin client. */
async function clientPausedAt(): Promise<string | null> {
  const { data, error } = await admin
    .from('cadence_settings')
    .select('paused_at')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) throw new Error(`Reading cadence settings failed: ${error.message}`);
  return (data as { paused_at: string | null } | null)?.paused_at ?? null;
}

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
  if (upsertError) throw new Error(`Parking the cursor failed: ${upsertError.message}`);
}

beforeAll(async () => {
  tenantId = await seedTenant('Cadence Controls');
  // Unpaused, because `applyResumeRewindow` refuses while EITHER pause is in
  // force — a suite with no connection row would watch every resume defer and
  // could not tell that from a resume that worked.
  await seedConnection(tenantId);
  await parkCursorAtHead();

  const killed = await seedOverdueCadence('kill target', {
    contact_name: 'Gone Away',
    contact_mobile: KILLED_MOBILE,
    contact_email: KILLED_EMAIL,
  });
  killedCadenceId = killed.cadenceId;

  // The SAME human, on a job that did not exist when they asked us to stop.
  [newQuote] = await seedQuotes(tenantId, [
    { job_description: 'controls: the next job', chase_eligibility: 'needs_review' },
  ]);
  await seedQuoteContacts(tenantId, [
    {
      sm8_job_uuid: newQuote.sm8_job_uuid,
      first: 'Gone',
      last: 'Away',
      // Raw, exactly as the mirror would hold it. The creation gate normalizes.
      mobile: KILLED_MOBILE_RAW,
      email: KILLED_EMAIL_RAW,
      contact_type: 'JOB',
    },
  ]);

  const first = await seedOverdueCadence('client pause A');
  const second = await seedOverdueCadence('client pause B');
  clientCadenceIds = [first.cadenceId, second.cadenceId];

  const reply = await seedOverdueCadence('reply paused', {
    status: 'paused',
    pause_reason: 'customer_reply',
  });
  replyPausedCadenceId = reply.cadenceId;
  replyPausedSlots = (
    await forTenant(tenantId).touches.listForCadence(replyPausedCadenceId)
  ).map((touch) => touch.scheduledAt.getTime());

  // NOTE WHAT IS *NOT* SEEDED HERE: the two `pauseForReply` fixtures. They are
  // created inside their own blocks, at the end, because an extra active or
  // `client_paused` cadence sitting in the tenant would be swept up by
  // `pauseClient` and `resumeClient` — and the counts those blocks assert are
  // the whole point of them.
});

afterAll(async () => {
  await teardownTenants([tenantId]);
  await closeDb();
});

/* ------------------------------------------------------------------------- *
 * killContact — D-06/D-15
 * ------------------------------------------------------------------------- */

it('suppresses BOTH channels of one human and stops the cadence terminally', async () => {
  const result = await killContact(tenantId, killedCadenceId);

  expect(result).toEqual({ kind: 'killed', addressesSuppressed: 2, touchesSkipped: 3 });

  // One person, both channels. Honouring "stop contacting me" on SMS while
  // emailing them anyway is a loophole, not compliance.
  expect(await suppressionRows()).toEqual([
    { channel: 'email', address: KILLED_EMAIL, source: 'operator_kill' },
    { channel: 'sms', address: KILLED_MOBILE, source: 'operator_kill' },
  ]);

  const repo = forTenant(tenantId);
  const [cadence] = await repo.cadences.getById(killedCadenceId);
  expect(cadence.status).toBe('stopped');
  // TERMINAL, never a pause: the human asked us to stop, and a pause is a thing
  // that can be resumed.
  expect(cadence.stopReason).toBe('contact_suppressed');
  expect(cadence.pauseReason).toBeNull();

  // Inseparable from the stop. A stopped cadence whose touches are still
  // `scheduled` is the state that makes a killed cadence keep sending.
  const touches = await repo.touches.listForCadence(killedCadenceId);
  expect(touches.map((touch) => touch.status)).toEqual(['skipped', 'skipped', 'skipped']);
  // `suppressed` rather than `cadence_stopped`: the skip reason states what is
  // TRUE, and the recipient being on the list is the cause, not the consequence.
  expect(touches.map((touch) => touch.skipReason)).toEqual([
    'suppressed',
    'suppressed',
    'suppressed',
  ]);
});

it('is idempotent: a second kill writes no duplicate row and re-stops nothing', async () => {
  const repo = forTenant(tenantId);
  const [before] = await repo.cadences.getById(killedCadenceId);

  const result = await killContact(tenantId, killedCadenceId);

  expect(result).toEqual({
    kind: 'already_stopped',
    addressesSuppressed: 2,
    stopReason: 'contact_suppressed',
  });

  // Still two rows: the unique index made the repeat a no-op rather than an
  // error, which is what lets an operator tap twice on a phone.
  expect(await suppressionRows()).toHaveLength(2);

  // The proof the stop was REFUSED rather than repeated. A guarded UPDATE
  // matching zero rows cannot move `updated_at`; an unguarded one would rewrite
  // it even when setting identical values.
  const [after] = await repo.cadences.getById(killedCadenceId);
  expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  expect(after.stopReason).toBe('contact_suppressed');
});

it('blocks a BRAND NEW quote for the same human at cadence creation (D-15)', async () => {
  // The whole reason `suppressed_contacts` is keyed on the address and not on a
  // contact uuid: this quote has its own fresh `quote_contacts` row, with its
  // own `sm8_contact_uuid`, spelling the number the way ServiceM8 does.
  const flip = await markChaseEligible(tenantId, [newQuote.id]);
  expect(flip).toEqual({ flipped: 1, eventsEmitted: 1 });

  const consumed = await consumeQuoteEvents({ jitterMinutes: () => 0 });
  // COUNTED AS STOPPED, NOT CREATED, and that is the honest reading: a cadence
  // born already stopped never chased anybody, so counting it as a creation
  // would make a tick that suppressed five people look like a tick that started
  // five conversations.
  expect(consumed.cadencesCreated).toBe(0);
  expect(consumed.cadencesStopped).toBe(1);

  const repo = forTenant(tenantId);
  const [cadence] = await repo.cadences.getByQuoteId(newQuote.id);
  expect(cadence.status).toBe('stopped');
  expect(cadence.stopReason).toBe('contact_suppressed');

  // Zero touches, not skipped touches: nothing was ever scheduled, so there is
  // no send this cadence could have made even if the stop were later undone.
  expect(await repo.touches.listForCadence(cadence.id)).toHaveLength(0);
});

it('refuses a cadence that does not exist, and one belonging to another tenant', async () => {
  // Indistinguishable on purpose — this is the read a forged POST hits, and
  // "no such cadence" must be true for both cases without saying which.
  expect(await killContact(tenantId, randomUUID())).toEqual({ kind: 'no_cadence' });
  expect(await resumeCadence(tenantId, randomUUID(), now)).toEqual({ kind: 'no_cadence' });
});

it('writes nothing for a cadence with no address to suppress', async () => {
  // A D-04 `no_contact` cadence. Stopping it under `contact_suppressed` would
  // put a false statement in the column Phase 7 reads — there is no address on
  // the row, so there is nobody this call could promise never to chase.
  const [quote] = await seedQuotes(tenantId, [
    { job_description: 'controls: no contact', chase_eligibility: 'eligible' },
  ]);
  const cadenceId = await seedCadence(tenantId, quote.id, {
    sm8_job_uuid: quote.sm8_job_uuid,
    status: 'stopped',
    stop_reason: 'no_contact',
    contact_name: null,
    contact_mobile: null,
    contact_email: null,
  });

  const before = await suppressionRows();
  expect(await killContact(tenantId, cadenceId)).toEqual({ kind: 'no_addresses' });
  expect(await suppressionRows()).toEqual(before);
});

/* ------------------------------------------------------------------------- *
 * pauseClient / resumeClient — D-06, and the D-05 asymmetry
 * ------------------------------------------------------------------------- */

it('pauses every ACTIVE cadence and sets the client flag, in one transaction', async () => {
  const result = await pauseClient(tenantId, now);

  // The killed cadence and the suppressed new one are terminal, so two.
  expect(result).toEqual({ kind: 'paused', cadencesPaused: 2 });
  expect(await clientPausedAt()).not.toBeNull();

  const repo = forTenant(tenantId);
  for (const id of clientCadenceIds) {
    const [cadence] = await repo.cadences.getById(id);
    expect(cadence.status).toBe('paused');
    expect(cadence.pauseReason).toBe('client_paused');
  }

  // NOT downgraded. `pauseWhereActive` refuses a cadence already paused for a
  // customer reply, because rewriting that reason would hand the client a lever
  // D-05 reserves for the operator.
  const [reply] = await repo.cadences.getById(replyPausedCadenceId);
  expect(reply.pauseReason).toBe('customer_reply');
});

it('is idempotent: a second pause moves neither the flag nor a cadence', async () => {
  const pausedAt = await clientPausedAt();
  const repo = forTenant(tenantId);
  const [before] = await repo.cadences.getById(clientCadenceIds[0]);

  expect(await pauseClient(tenantId, new Date(now.getTime() + 60_000))).toEqual({
    kind: 'already_paused',
  });

  // The ORIGINAL pause moment survives. Overwriting it would move the fact the
  // operator reads as "paused since", for a tap that changed nothing.
  expect(await clientPausedAt()).toBe(pausedAt);
  const [after] = await repo.cadences.getById(clientCadenceIds[0]);
  expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
});

it('resumes ONLY client-paused cadences and re-windows exactly those (D-05, D-07)', async () => {
  const result = await resumeClient(tenantId, now);

  expect(result.kind).toBe('resumed');
  if (result.kind !== 'resumed') throw new Error('unreachable');
  expect(result.cadencesResumed).toBe(2);
  expect(result.rewindowDeferred).toBe(false);
  // Three overdue touches on each of the two resumed cadences.
  expect(result.touchesRescheduled).toBe(6);

  expect(await clientPausedAt()).toBeNull();

  const repo = forTenant(tenantId);
  for (const id of clientCadenceIds) {
    const [cadence] = await repo.cadences.getById(id);
    expect(cadence.status).toBe('active');
    expect(cadence.pauseReason).toBeNull();

    // The repair, not merely the flag. A resume that clears the pause and leaves
    // three overdue touches where they were is a resume that texts a customer
    // three times inside a minute.
    //
    // `>=`, NOT `>`, for the same reason the resumeCadence block below says so:
    // this resume runs with the PRODUCTION jitter draw, and when the suite runs
    // inside Perth contact hours a zero-minute draw lands the first rescheduled
    // touch exactly on `now` — which is what 03-05 prescribes. The guarantee is
    // "never in the past", and `>=` states exactly that.
    for (const touch of await repo.touches.listForCadence(id)) {
      expect(touch.scheduledAt.getTime()).toBeGreaterThanOrEqual(now.getTime());
      expect(isInsideWindow(touch.scheduledAt, WINDOW)).toBe(true);
    }
  }

  // D-05, THE ASSERTION THIS SUITE EXISTS FOR. A tradie tapping "resume
  // messaging" must not restart a cadence aimed at somebody who is mid-
  // conversation with them; that reads as the service ignoring the reply.
  const [reply] = await repo.cadences.getById(replyPausedCadenceId);
  expect(reply.status).toBe('paused');
  expect(reply.pauseReason).toBe('customer_reply');

  // And its touches were not re-windowed either — the repair belongs to whoever
  // lifts THAT pause, and doing it here would quietly promise a resume nobody
  // authorized.
  const replyTouches = await repo.touches.listForCadence(replyPausedCadenceId);
  expect(replyTouches.map((touch) => touch.scheduledAt.getTime())).toEqual(replyPausedSlots);
});

it('reports not_paused when the client is not paused', async () => {
  expect(await resumeClient(tenantId, now)).toEqual({ kind: 'not_paused' });
});

/* ------------------------------------------------------------------------- *
 * resumeCadence — the explicit human act D-05 reserves
 * ------------------------------------------------------------------------- */

it('lifts a customer_reply pause, which nothing else in this file could', async () => {
  const result = await resumeCadence(tenantId, replyPausedCadenceId, now);

  expect(result.kind).toBe('resumed');
  if (result.kind !== 'resumed') throw new Error('unreachable');
  expect(result.touchesRescheduled).toBe(3);
  expect(result.rewindowDeferred).toBe(false);

  const repo = forTenant(tenantId);
  const [cadence] = await repo.cadences.getById(replyPausedCadenceId);
  expect(cadence.status).toBe('active');
  expect(cadence.pauseReason).toBeNull();

  for (const touch of await repo.touches.listForCadence(replyPausedCadenceId)) {
    // `>=`, NOT `>`, and the difference is a decision this phase already made:
    // "'may we send now' is answered by asking nextAllowedSlot whether the next
    // allowed slot from now IS now" (03-05). When this suite runs INSIDE Perth
    // contact hours, the first rescheduled touch therefore lands exactly on
    // `now`, and a strict `>` failed — not because the resume was wrong, but
    // because the assertion contradicted the rule the resume implements. The
    // guarantee being defended here is "a resume must not leave touches in the
    // PAST", which `>=` states exactly.
    expect(touch.scheduledAt.getTime()).toBeGreaterThanOrEqual(now.getTime());
    expect(isInsideWindow(touch.scheduledAt, WINDOW)).toBe(true);
  }
});

it('refuses to resume a cadence that is not paused', async () => {
  // Treating this as a move would re-window a schedule that never slipped, i.e.
  // rewrite send times for no reason a customer could perceive.
  expect(await resumeCadence(tenantId, replyPausedCadenceId, now)).toEqual({
    kind: 'not_paused',
    status: 'active',
  });

  // And a terminal cadence is never revived.
  expect(await resumeCadence(tenantId, killedCadenceId, now)).toEqual({
    kind: 'not_paused',
    status: 'stopped',
  });
});

/* ------------------------------------------------------------------------- *
 * pauseForReply — Phase 4's entry point, tested before Phase 4 exists
 * ------------------------------------------------------------------------- */

it('pauses an active cadence for a customer reply, and a repeat changes nothing', async () => {
  const { cadenceId: activeForReplyId } = await seedOverdueCadence('reply target');

  expect(await pauseForReply(tenantId, activeForReplyId)).toEqual({ kind: 'paused' });

  const repo = forTenant(tenantId);
  const [cadence] = await repo.cadences.getById(activeForReplyId);
  expect(cadence.status).toBe('paused');
  expect(cadence.pauseReason).toBe('customer_reply');

  // Already the stickiest pause; a further reply changes nothing.
  //
  // CHANGED IN 04-02, DELIBERATELY, AND THIS COMMENT IS THE RECORD. This block
  // previously asserted `{kind: 'not_active', status: 'paused'}`. Both spellings
  // describe the same absence of a write, but they are opposite claims about the
  // cadence: `not_active` means there was nothing to stand down, and this
  // cadence is standing down for exactly this reason. `handleInboundSms` records
  // the kind on the inbound row's result, so the misnomer would have reached an
  // operator's triage screen as "we did not pause" beside a paused cadence.
  expect(await pauseForReply(tenantId, activeForReplyId)).toEqual({ kind: 'paused' });
});

it('UPGRADES a client pause to a customer-reply pause rather than reporting a no-op', async () => {
  const { cadenceId: clientPausedForReplyId } = await seedOverdueCadence('reply upgrade', {
    status: 'paused',
    pause_reason: 'client_paused',
  });

  // THE PHASE 3 GAP, CLOSED IN 04-02. The matrix prescribes
  // paused(client_paused) + customer_reply → paused(customer_reply), and until
  // `upgradePauseReason` existed no repository method could write it —
  // `pauseWhereActive` pauses only from `active`, deliberately, so that
  // re-pausing cannot downgrade a reply pause. The upgrade got its own guarded
  // statement instead of a widened one.
  //
  // What the gap was costing, and why this is not a cosmetic result rename: the
  // cadence stayed `client_paused`, so the CLIENT's own resume could restart
  // messaging at somebody mid-conversation — D-05 from the other direction. The
  // resume half of that is asserted in `tests/pause-upgrade.test.ts`, which is
  // the only place it can be proven.
  expect(await pauseForReply(tenantId, clientPausedForReplyId)).toEqual({
    kind: 'upgraded',
  });

  // The REASON moved and the STATUS did not. A reply may never make a cadence
  // active; it may only ever change why it is standing down.
  const [cadence] = await forTenant(tenantId).cadences.getById(clientPausedForReplyId);
  expect(cadence.status).toBe('paused');
  expect(cadence.pauseReason).toBe('customer_reply');
});

it('refuses a reply pause on a terminal cadence', async () => {
  expect(await pauseForReply(tenantId, killedCadenceId)).toEqual({
    kind: 'not_active',
    status: 'stopped',
  });
});
