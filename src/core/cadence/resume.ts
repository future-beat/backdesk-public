/**
 * D-07 — how a cadence starts again after a pause.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ONE RULE FOR EVERY PAUSE TYPE. The next unsent touch lands at the next    │
 * │ allowed slot from the moment of resume — OR WHERE IT ALREADY STOOD, IF    │
 * │ THAT IS LATER — and every later touch keeps its ORIGINAL relative gap.    │
 * │ Never a burst, never out of hours, never early.                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The clamp is not a special case bolted onto the rule; it is what makes the
 * rule a REPAIR. A resume fixes touches that fell due while nobody could send
 * them. A touch still sitting in the future did not fall due, so moving it is
 * not repair — it is rescheduling a customer's follow-up days early, off the
 * back of an operator tapping pause and resume a minute apart. See the clamp in
 * `computeResumeSchedule` for what that costs when it is missing.
 *
 * There are three ways a client's messaging stops — the customer wrote back
 * (D-05), the client asked us to pause (D-06), their ServiceM8 key stopped
 * working (D-08) — and exactly one way it starts again. That is not tidiness. A
 * pause of any kind leaves a pile of touches whose slots are in the past, and
 * the only thing separating "we're back" from "a machine just texted six of your
 * customers at once" is what happens in the seconds after the pause lifts. A
 * second implementation of this rule, written later for a resume path somebody
 * added, is a second answer to that question — and the first anyone would learn
 * of the disagreement is a design partner forwarding a screenshot.
 *
 * So every path that clears a pause calls `applyResumeRewindow`:
 *
 *   auth recovery      — `resumeConnection` (Phase 2's re-key), wired here
 *   client resume      — the D-06 console action (plan 03-05)
 *   operator resume    — lifting a `customer_reply` pause (plan 03-05, D-05)
 *
 * ── WHY THE GAPS ARE TAKEN FROM `original_offset_days` ──────────────────────
 *
 * The realized `scheduled_at` values have already been rolled past weekends and
 * jittered, so differencing them recovers a number that is nearly the intended
 * gap and occasionally two days off it. `original_offset_days` is the template's
 * own intention, carried on every touch by `materializeCadenceSchedule` for
 * exactly this moment. Day 3 → day 7 → day 14 → day 21 becomes gaps of 4, 7 and
 * 7 days, and those are what survive the pause.
 *
 * ── WHY A RESUME CAN NEVER BURST, AS A PROPERTY RATHER THAN A HOPE ──────────
 *
 * Only the FIRST unsent touch is placed relative to the resume moment; each
 * later one is placed relative to the touch before it. Every template gap in
 * this product (3, 4, 7, 7 days) is far larger than `MIN_GAP_HOURS`, so the
 * sequence is spread by construction — the min-gap rule has nothing to correct
 * here, and `tests/cadence-rewindow.test.ts` asserts the spacing directly rather
 * than trusting that sentence.
 *
 * ── THE SPLIT: A PURE RULE AND A THIN APPLIER ───────────────────────────────
 *
 * `computeResumeSchedule` is pure — no database, no clock, injected RNG — so
 * D-07 is provable with pinned inputs. `applyResumeRewindow` is the write, and
 * it does nothing a reader has to reason about: read the tenant's window, walk
 * the live cadences, apply the rule, move the touches. Everything it touches
 * goes through `forTenant(id)`.
 */
import { forTenant } from '@/db/repository';

import { DEFAULT_PREFERRED_SEND_TIME } from './constants';
import { randomJitterMinutes } from './jitter';
import { nextAllowedSlot, slotAtOffsetDays, type ContactWindow } from './window';

/** One unsent touch, as the resume rule needs to see it. */
export interface ResumeTouch {
  id: string;
  /** 1-based cadence position; the order the rule walks them in. */
  touchNumber: number;
  scheduledAt: Date;
  /** The template offset this touch was materialized from — D-07's basis. */
  originalOffsetDays: number;
}

/** Where one touch should go. `touchId` is what the caller writes against. */
export interface ResumePlacement {
  touchId: string;
  touchNumber: number;
  scheduledAt: Date;
}

export interface ComputeResumeScheduleInput {
  /** The cadence's unsent touches. Sorted here; the caller need not. */
  unsentTouches: readonly ResumeTouch[];
  window: ContactWindow;
  preferredSendTime: string;
  /** The moment the pause lifted. Pinned by the caller, never read here. */
  resumeAt: Date;
  /** Injected RNG, minutes. Drawn once per placement. */
  jitterMinutes: () => number;
  /** D-09 override for the first placement; defaults inside `nextAllowedSlot`. */
  sameDayMarginMinutes?: number;
}

/**
 * The D-07 rule, as a pure function.
 *
 * Returns one placement per unsent touch, in `touch_number` order. An empty
 * input is an empty result — a cadence with nothing left to send is not an
 * error, it is the normal state of one whose last touch just went out.
 */
export function computeResumeSchedule(
  input: ComputeResumeScheduleInput,
): ResumePlacement[] {
  const { window: win, preferredSendTime, resumeAt, jitterMinutes } = input;

  if (input.unsentTouches.length === 0) return [];

  if (!(resumeAt instanceof Date) || Number.isNaN(resumeAt.getTime())) {
    throw new TypeError(
      `computeResumeSchedule: resumeAt must be a real Date; got ${String(resumeAt)}. ` +
        'Every placement is relative to it, so an Invalid Date would silently ' +
        'produce a cadence of touches that are never due.',
    );
  }

  // Sorted on a COPY: the caller's array is theirs, and a repository result is
  // sometimes reused for a second purpose in the same tick.
  const ordered = [...input.unsentTouches].sort((a, b) => a.touchNumber - b.touchNumber);

  const placements: ResumePlacement[] = [];
  let previous: { at: Date; offsetDays: number } | null = null;

  for (const touch of ordered) {
    let at: Date;

    if (previous === null) {
      // THE ONLY PLACEMENT THAT LOOKS AT THE RESUME MOMENT. Everything after
      // this one is measured from its predecessor, which is what preserves the
      // shape of the cadence rather than merely its compliance.
      const slot = nextAllowedSlot(resumeAt, win, preferredSendTime, jitterMinutes, {
        sameDayMarginMinutes: input.sameDayMarginMinutes,
      });

      // A RESUME REPAIRS OVERDUE TOUCHES; IT NEVER PROMOTES A FUTURE ONE.
      //
      // This clamp is the whole reason the rule is safe to call from a path that
      // does not know how long the pause lasted. A pause of fifteen minutes
      // leaves the next touch exactly where it was — still days out, still
      // correct — and placing it at the next allowed slot from the resume moment
      // would send the customer their day-3 follow-up on day 0, then re-derive
      // every touch behind it from that pulled-forward slot and compress the
      // whole tail permanently. Worse, the min-gap chaining below only compares
      // UNSENT touches, so a touch sent an hour before the pause is invisible to
      // it: the customer gets two chases in one morning, which is precisely the
      // burst D-07 exists to prevent, arriving from the opposite direction.
      //
      // A touch whose slot is still ahead of the resume moment did not slip, so
      // there is nothing to repair. `applyResumeRewindow`'s no-op guard then
      // leaves the row — and its `updated_at` — untouched.
      at = slot.getTime() < touch.scheduledAt.getTime() ? touch.scheduledAt : slot;
    } else {
      // A NON-NEGATIVE DELTA, CLAMPED RATHER THAN TRUSTED. Template offsets
      // ascend with touch number in every shape this product ships, but the
      // column permits otherwise, and a negative delta is a request to schedule
      // backwards — the exact thing D-01 exists to make impossible.
      const delta = Math.max(0, touch.originalOffsetDays - previous.offsetDays);
      const candidate = slotAtOffsetDays(
        previous.at,
        delta,
        win,
        preferredSendTime,
        jitterMinutes,
      );

      // Two touches that shared an offset collapse onto one instant and stay in
      // touch-number order — the same answer `materializeCadenceSchedule` gives
      // them at birth. Never earlier than the touch before it.
      at =
        candidate.getTime() < previous.at.getTime()
          ? new Date(previous.at.getTime())
          : candidate;
    }

    placements.push({ touchId: touch.id, touchNumber: touch.touchNumber, scheduledAt: at });
    previous = { at, offsetDays: touch.originalOffsetDays };
  }

  return placements;
}

export interface ResumeRewindowResult {
  /**
   * True when a pause was STILL IN FORCE and nothing was moved.
   *
   * Re-windowing a tenant who is still paused would place their touches
   * relative to a moment that is not their resume — so by the time the real
   * resume happened, every one of those slots would be in the past again, and
   * the burst this function exists to prevent would arrive anyway. Callers
   * clear the pause first; this is the guard that says so out loud.
   */
  stillPaused: boolean;
  cadencesRewindowed: number;
  touchesRescheduled: number;
}

export interface ApplyResumeRewindowOptions {
  /** Injected RNG, minutes. Defaults to the single production draw. */
  jitterMinutes?: () => number;
  /**
   * Re-window ONLY these cadences, rather than every active one.
   *
   * WHY A SCOPE EXISTS AT ALL. Auth recovery (`resumeConnection`) resumes the
   * whole tenant: a dead key froze dispatch for every cadence at once, so every
   * one of them slipped and every one needs repairing. The console's two resumes
   * do not have that property. A client-level resume reactivates exactly the
   * cadences its pause froze — and a tenant may have gained brand new cadences
   * DURING the pause, created by event consumption, which deliberately keeps
   * running for paused tenants. Those were materialized from a fresh anchor and
   * their slots are already correct and in the future; re-windowing them would
   * drag touch one forward to the resume moment and send a customer their first
   * message days early. The operator's single-cadence resume has the same
   * property four cadences over.
   *
   * So the caller passes the ids the resume write actually returned, which is
   * the set whose schedules the pause is responsible for. Omitted means every
   * active cadence — the auth-recovery reading, unchanged.
   *
   * An EMPTY array is not the same as omitted: it means "nothing was resumed",
   * and re-windowing everything would be the opposite of what the caller asked.
   */
  onlyCadenceIds?: readonly string[];
}

/**
 * Apply D-07 to every live cadence of one tenant. THE SHARED RESUME PATH.
 *
 * ONE TRANSACTION PER CADENCE. A cadence's touches are one schedule: leaving
 * half of them moved and half where they were is a shape neither the old plan
 * nor the new one describes, and it is the shape a customer would receive.
 * Across cadences, independence is correct — one broken cadence must not strand
 * the other four.
 *
 * ONLY `active` CADENCES ARE MOVED. A cadence paused for its own reason
 * (`customer_reply`) is not resumed by a tenant-level un-pause; whoever lifts
 * that pause resumes the cadence first and then calls this. Moving a still-
 * paused cadence's touches would quietly promise a resume nobody authorized.
 */
export async function applyResumeRewindow(
  tenantId: string,
  now: Date,
  options: ApplyResumeRewindowOptions = {},
): Promise<ResumeRewindowResult> {
  const { jitterMinutes = randomJitterMinutes, onlyCadenceIds } = options;
  const scope = onlyCadenceIds === undefined ? null : new Set(onlyCadenceIds);

  const repo = forTenant(tenantId);
  const nothing: ResumeRewindowResult = {
    stillPaused: false,
    cadencesRewindowed: 0,
    touchesRescheduled: 0,
  };

  const [tenant] = await repo.tenant.get();
  if (!tenant) return nothing;

  const [connection] = await repo.connection.get();
  const [settings] = await repo.settings.get();

  // BOTH pauses, and neither implies the other: a successful re-key says nothing
  // about whether the client wants messaging resumed, and an operator un-pause
  // says nothing about whether the key works.
  if (!connection || connection.pausedAt !== null || settings?.pausedAt != null) {
    return { ...nothing, stillPaused: true };
  }

  const win: ContactWindow = {
    timezone: tenant.timezone,
    contactHoursStart: tenant.contactHoursStart,
    contactHoursEnd: tenant.contactHoursEnd,
    contactDays: tenant.contactDays,
  };
  // D-03: the settings row is seeded lazily, so its absence is the normal state
  // for a client whose first cadence has not been created yet.
  const preferredSendTime = settings?.preferredSendTime ?? DEFAULT_PREFERRED_SEND_TIME;

  const result: ResumeRewindowResult = { ...nothing };

  for (const cadence of await repo.cadences.listLive()) {
    if (cadence.status !== 'active') continue;
    if (scope !== null && !scope.has(cadence.id)) continue;

    const moved = await repo.transaction(async (tx) => {
      const unsent = await tx.touches.listUnsentForCadence(cadence.id);
      if (unsent.length === 0) return 0;

      const placements = computeResumeSchedule({
        unsentTouches: unsent.map((touch) => ({
          id: touch.id,
          touchNumber: touch.touchNumber,
          scheduledAt: touch.scheduledAt,
          originalOffsetDays: touch.originalOffsetDays,
        })),
        window: win,
        preferredSendTime,
        resumeAt: now,
        jitterMinutes,
      });

      const current = new Map(unsent.map((touch) => [touch.id, touch.scheduledAt.getTime()]));
      let rescheduled = 0;

      for (const placement of placements) {
        // A touch already sitting on its computed slot is left alone: the write
        // would bump `updated_at` for no change, and that column is how a replay
        // is told apart from a repeat elsewhere in this engine.
        if (current.get(placement.touchId) === placement.scheduledAt.getTime()) continue;

        const rows = await tx.touches.reschedule(placement.touchId, placement.scheduledAt);
        rescheduled += rows.length;
      }

      return rescheduled;
    });

    if (moved > 0) {
      result.cadencesRewindowed += 1;
      result.touchesRescheduled += moved;
    }
  }

  return result;
}
