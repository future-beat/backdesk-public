/**
 * D-07 at the database: `applyResumeRewindow`, the write every pause-lift path
 * shares.
 *
 * ── WHY THE PURE SUITE IS NOT ENOUGH ────────────────────────────────────────
 *
 * `tests/cadence-rewindow.test.ts` proves the RULE — first unsent touch at the
 * next allowed slot, later touches keeping their original relative gaps. It
 * cannot prove that the applier feeds the rule the right rows or writes its
 * answer back, and those are exactly the ways this function fails silently: a
 * status filter that matches nothing, a window read from the wrong columns, a
 * reschedule guarded into a no-op. Every one of them returns cleanly, reports
 * zero, and leaves a client resuming into the burst the rule exists to prevent.
 *
 * Only the applier is asserted here. The gap arithmetic, the boundary cases and
 * the determinism live in the pure suite, where they belong.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';

import { applyResumeRewindow } from '../src/core/cadence/resume';
import { isInsideWindow, type ContactWindow } from '../src/core/cadence/window';
import { closeDb, forTenant } from '../src/db/repository';

import {
  admin,
  seedCadence,
  seedCadenceSettings,
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

const MS_PER_DAY = 86_400_000;

let tenantId: string;
let cadenceId: string;
let pausedCadenceId: string;
/** The slots the paused cadence was seeded with, to prove they did not move. */
let pausedSlots: number[];

/**
 * The moment the pause lifts. Pinned an hour into the past so every seeded slot
 * is unambiguously overdue relative to it, and so the assertions are about the
 * placement rather than about when the suite happened to run.
 */
const resumeAt = new Date(Date.now() - 3_600_000);

/**
 * A cadence whose whole remaining schedule fell due during the pause.
 *
 * Anchored 25 days back, so all four of the 3/7/14/21 touches are in the past at
 * the resume moment — and still inside D-12's 42-day expiry, because a cadence
 * that expires is a different case with a different answer.
 */
async function seedPausedCadence(status: 'active' | 'paused'): Promise<string> {
  const [quote] = await seedQuotes(tenantId, [
    { job_description: `resume: ${status} cadence`, chase_eligibility: 'eligible' },
  ]);

  const anchorAt = new Date(resumeAt.getTime() - 25 * MS_PER_DAY);
  const id = await seedCadence(tenantId, quote.id, {
    sm8_job_uuid: quote.sm8_job_uuid,
    status,
    pause_reason: status === 'paused' ? 'customer_reply' : null,
    anchor_at: anchorAt.toISOString(),
    contact_mobile: '+61400121212',
  });

  // Touches 2..5 of the default 0/3/7/14/21 shape, every one of them in the
  // past — which is what a fortnight of silence actually leaves behind.
  await seedTouches(
    id,
    tenantId,
    [3, 7, 14, 21].map((offsetDays) => ({
      scheduled_at: new Date(anchorAt.getTime() + offsetDays * MS_PER_DAY).toISOString(),
      original_offset_days: offsetDays,
      status: 'scheduled',
    })),
  );

  return id;
}

beforeAll(async () => {
  tenantId = await seedTenant('Cadence Resume');
  await seedConnection(tenantId);
  // Paused at the client level, so the refusal below is a real state and not a
  // condition invented for the test.
  await seedCadenceSettings(tenantId, { paused_at: new Date().toISOString() });

  cadenceId = await seedPausedCadence('active');
  pausedCadenceId = await seedPausedCadence('paused');

  pausedSlots = (await forTenant(tenantId).touches.listForCadence(pausedCadenceId)).map((t) =>
    t.scheduledAt.getTime(),
  );
});

afterAll(async () => {
  await teardownTenants([tenantId]);
  await closeDb();
});

async function clearClientPause(): Promise<void> {
  const { error } = await admin
    .from('cadence_settings')
    .update({ paused_at: null })
    .eq('tenant_id', tenantId);
  if (error) throw new Error(`Clearing the client pause failed: ${error.message}`);
}

it('refuses to move anything while a pause is still in force', async () => {
  const before = await forTenant(tenantId).touches.listForCadence(cadenceId);

  const result = await applyResumeRewindow(tenantId, resumeAt, { jitterMinutes: () => 0 });

  // Re-windowing a client who is still paused would place their touches
  // relative to a moment that is not their resume, so by the time the real
  // resume arrived every slot would be in the past again — the burst arriving
  // through the door marked "we fixed it".
  expect(result.stillPaused).toBe(true);
  expect(result.touchesRescheduled).toBe(0);

  const after = await forTenant(tenantId).touches.listForCadence(cadenceId);
  expect(after.map((t) => t.scheduledAt.getTime())).toEqual(
    before.map((t) => t.scheduledAt.getTime()),
  );
});

it('moves every overdue touch of a live cadence forward, inside the window, in one call', async () => {
  await clearClientPause();

  const result = await applyResumeRewindow(tenantId, resumeAt, { jitterMinutes: () => 0 });

  expect(result.stillPaused).toBe(false);
  expect(result.cadencesRewindowed).toBe(1);
  expect(result.touchesRescheduled).toBe(4);

  const touches = await forTenant(tenantId).touches.listForCadence(cadenceId);
  expect(touches.map((t) => t.touchNumber)).toEqual([1, 2, 3, 4]);

  for (const touch of touches) {
    // Never in the past, never out of hours — the two halves of D-07's promise.
    //
    // `>=`, NOT `>`: when this suite runs INSIDE Perth contact hours the first
    // rescheduled touch lands exactly on `resumeAt`, because 03-05 decided that
    // "'may we send now' is answered by asking nextAllowedSlot whether the next
    // allowed slot from now IS now". A strict `>` therefore failed on the clock
    // rather than on the behaviour. "Never in the past" is what D-07 promises
    // and what `>=` states.
    expect(touch.scheduledAt.getTime()).toBeGreaterThanOrEqual(resumeAt.getTime());
    expect(isInsideWindow(touch.scheduledAt, WINDOW)).toBe(true);
  }

  // The original 3/7/14/21 offsets are deltas of 4, 7 and 7 days, and they are
  // what survives the pause. Compared as strictly-increasing instants here; the
  // day arithmetic itself is asserted in the pure suite.
  for (let i = 1; i < touches.length; i += 1) {
    expect(touches[i].scheduledAt.getTime()).toBeGreaterThan(
      touches[i - 1].scheduledAt.getTime(),
    );
  }
});

it('leaves a cadence that is still paused for its own reason exactly where it was', async () => {
  // D-05: lifting the CLIENT's pause says nothing about a cadence paused because
  // the customer wrote back. Whoever resumes that one resumes it first, then
  // calls this — moving its touches here would quietly promise a resume nobody
  // authorized.
  const touches = await forTenant(tenantId).touches.listForCadence(pausedCadenceId);

  expect(touches.map((t) => t.scheduledAt.getTime())).toEqual(pausedSlots);
  expect(touches.every((t) => t.status === 'scheduled')).toBe(true);
  // Overdue, and deliberately left that way: the touches of a cadence paused for
  // its own reason are repaired by whoever lifts THAT pause.
  expect(touches.every((t) => t.scheduledAt.getTime() < resumeAt.getTime())).toBe(true);
});

it('is idempotent: a second call with the same moment moves nothing', async () => {
  const before = await forTenant(tenantId).touches.listForCadence(cadenceId);

  const result = await applyResumeRewindow(tenantId, resumeAt, { jitterMinutes: () => 0 });

  // A touch already sitting on its computed slot is left alone rather than
  // re-written with the same value: `updated_at` is how a refused write is told
  // apart from a repeated one elsewhere in this engine, and a no-op that bumps
  // it destroys that distinction.
  expect(result.touchesRescheduled).toBe(0);

  const after = await forTenant(tenantId).touches.listForCadence(cadenceId);
  expect(after.map((t) => t.scheduledAt.getTime())).toEqual(
    before.map((t) => t.scheduledAt.getTime()),
  );
  expect(after.map((t) => t.updatedAt.getTime())).toEqual(
    before.map((t) => t.updatedAt.getTime()),
  );
});

/**
 * A RESUME REPAIRS WHAT SLIPPED. Nothing slipped here, so nothing may move.
 *
 * Every fixture above seeds its touches in the PAST on purpose — that is the
 * case D-07 was written for, and it is why the early-move never showed up. This
 * one is the other half: an operator taps *Pause this client* and then *Resume
 * this client* half an hour later, with touch 1 already sent and touch 2 still
 * three days out. Unclamped, touch 2 is placed at the next allowed slot from the
 * resume moment — the customer gets their day-3 follow-up today, in the same
 * morning as the last one, and every touch behind it compresses by three days.
 */
it('never pulls a not-yet-due touch EARLIER, and does not even bump updated_at', async () => {
  const [quote] = await seedQuotes(tenantId, [
    { job_description: 'resume: nothing slipped', chase_eligibility: 'eligible' },
  ]);

  // Anchored half an hour before the resume: touch 1 went out, touch 2 is three
  // days away and has not slipped by so much as a minute.
  const anchorAt = new Date(resumeAt.getTime() - 1_800_000);
  const intactCadenceId = await seedCadence(tenantId, quote.id, {
    sm8_job_uuid: quote.sm8_job_uuid,
    status: 'active',
    anchor_at: anchorAt.toISOString(),
    contact_mobile: '+61400131313',
  });

  await seedTouches(intactCadenceId, tenantId, [
    { scheduled_at: anchorAt.toISOString(), original_offset_days: 0, status: 'sent' },
    {
      scheduled_at: new Date(anchorAt.getTime() + 3 * MS_PER_DAY).toISOString(),
      original_offset_days: 3,
      status: 'scheduled',
    },
  ]);

  const before = await forTenant(tenantId).touches.listForCadence(intactCadenceId);
  const unsentBefore = before.find((t) => t.status === 'scheduled')!;

  const result = await applyResumeRewindow(tenantId, resumeAt, {
    jitterMinutes: () => 0,
    onlyCadenceIds: [intactCadenceId],
  });

  expect(result.touchesRescheduled).toBe(0);

  const after = await forTenant(tenantId).touches.listForCadence(intactCadenceId);
  const unsentAfter = after.find((t) => t.status === 'scheduled')!;

  // To the millisecond, not merely "on or after the resume moment": an ordering
  // assertion passes on the three-days-early placement this test exists to
  // forbid. `updated_at` proves the applier's no-op guard held too — a write
  // that produced the same value would still have bumped it.
  expect(unsentAfter.scheduledAt.getTime()).toBe(unsentBefore.scheduledAt.getTime());
  expect(unsentAfter.updatedAt.getTime()).toBe(unsentBefore.updatedAt.getTime());
});
