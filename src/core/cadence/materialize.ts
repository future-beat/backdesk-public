/**
 * D-01/D-02/D-03: the schedule a cadence is born with.
 *
 * FRAMEWORK-FREE ON PURPOSE. Nothing here imports from `next/*`, and nothing
 * here touches the database. In goes an anchor, a tenant's template rows and
 * their contact window; out comes an array of touches the caller inserts. That
 * separation is what lets the whole of CAD-02's timing contract be proven by
 * unit tests with pinned inputs rather than inferred from an integration run
 * that happened to take one path.
 *
 * ── THE ANCHOR IS THE ELIGIBILITY MOMENT, NOT THE QUOTE DATE ────────────────
 *
 * This is D-01, and it is the single most consequential line in the file. A
 * newly connected client's 90-day backfill contains quotes issued months ago.
 * Anchoring on the ServiceM8 issue date materializes five touches that are all
 * already in the past; the D-11 staleness cap then skips every one of them and
 * the cadence expires under D-12 without sending a single message — silently,
 * and looking from the outside exactly like a cadence that ran.
 *
 * So the caller passes the moment the quote became chase-eligible: the
 * `quote_opened` event's `detected_at`, or `now()` at consumption, which are
 * minutes apart. Note that `quote_status_events.occurred_at` carries the issue
 * date and MUST NOT be used here (RESEARCH Pitfall 1; the superseded comment in
 * `src/core/sync/eligibility.ts` predates D-01).
 *
 * ── JITTER IS DRAWN HERE AND STORED, NEVER AT DISPATCH ──────────────────────
 *
 * RESEARCH Pitfall 4. If jitter were applied when a touch is sent, `scheduled_at`
 * would stop being the thing that happens: min-gap (D-10) and staleness (D-11)
 * comparisons would be made against a number that moves, and CAD-02's
 * "materialized send times" would be quietly false. The RNG is injected so a
 * test can pin it, and because reaching for the global random source would be a
 * dependency this function's signature does not admit to having. Neither this
 * module nor `window.ts` contains a call to it, and a standing grep in the test
 * suite is what keeps that true.
 *
 * ── WHAT THIS FUNCTION DOES NOT DECIDE ──────────────────────────────────────
 *
 * Whether the tenant is paused, whether the contact is suppressed, whether the
 * quote is still open, whether a ledger claim succeeds. All of those are
 * dispatch-time refusals (CAD-05), re-checked inside the send transaction
 * because anything decided here is minutes-to-weeks stale by then.
 */
import type { TouchChannel } from '@/db/schema/cadence-templates';

import { nextAllowedSlot, slotAtOffsetDays, type ContactWindow } from './window';

/**
 * One row of the tenant's cadence shape (`cadence_touch_templates`).
 *
 * A structural type rather than the drizzle row: materialization needs three
 * columns, and taking the whole row would make this function un-callable from a
 * console preview that is describing a shape the tenant does not have yet.
 */
export interface MaterializeTemplate {
  /** 1-based position in the cadence. Unique within the input. */
  touchNumber: number;
  /** Calendar days from the ANCHOR, not from the previous touch. */
  offsetDays: number;
  channel: TouchChannel;
}

/** One materialized touch, ready to become a `cadence_touches` row. */
export interface MaterializedTouch {
  touchNumber: number;
  /** Snapshotted from the template — editing the template later must not reshape this. */
  channel: TouchChannel;
  /** The stored UTC instant. Jitter is already baked in. */
  scheduledAt: Date;
  /**
   * The template offset this touch came from, carried through unchanged.
   *
   * D-07's basis: when a cadence resumes after a pause, later touches keep
   * their original RELATIVE gaps, which can only be recovered from the
   * intended offsets — the realized `scheduled_at` values have already been
   * rolled past weekends and jittered.
   */
  originalOffsetDays: number;
}

export interface MaterializeInput {
  /** D-01: the eligibility moment. NEVER the ServiceM8 quote date. */
  anchor: Date;
  templates: readonly MaterializeTemplate[];
  window: ContactWindow;
  /** Tenant's preferred wall-clock send time, 'HH:MM[:SS]', clamped into the window. */
  preferredSendTime: string;
  /** Injected RNG, called once per touch. Minutes, expected in [0, JITTER_MAX_MINUTES]. */
  jitterMinutes: () => number;
  /** D-09 override; defaults to SAME_DAY_MARGIN_MINUTES inside `nextAllowedSlot`. */
  sameDayMarginMinutes?: number;
}

/**
 * Templates → the touches a cadence starts life with.
 *
 * Ordered strictly by `touch_number`, which is the order the touches are
 * inserted, displayed and dispatched in. Two templates sharing an offset get
 * the same instant and stay in touch-number order — the cadence's sequence is
 * a property of its numbering, never of a sort by time that ties arbitrarily.
 *
 * Placement, per touch:
 *   offset 0  → `nextAllowedSlot(anchor)`   — D-09: later today if the window
 *               is still open with margin, else the next allowed day. This is
 *               the branch that makes "can never be born overdue" true.
 *   offset N  → the anchor's tenant-zone DATE plus N calendar days, at the
 *               preferred time + jitter, rolled forward past days the tenant
 *               does not contact, clamped inside the window.
 *
 * THROWS on input this cannot honestly schedule — an unusable anchor, a
 * duplicated touch number (which the `cadence_touches` unique index would
 * reject anyway, several layers further from the cause), or a negative offset
 * (which is a request to schedule into the past). Every silent alternative
 * produces a cadence that looks correct and is not.
 */
export function materializeCadenceSchedule(input: MaterializeInput): MaterializedTouch[] {
  const { anchor, templates, window: win, preferredSendTime, jitterMinutes } = input;

  if (!(anchor instanceof Date) || Number.isNaN(anchor.getTime())) {
    throw new TypeError(
      `materializeCadenceSchedule: anchor must be a real Date; got ${String(anchor)}. ` +
        'An Invalid Date would make every scheduled_at Invalid, and an Invalid ' +
        'scheduled_at is never due — the cadence would sit inert forever.',
    );
  }

  if (templates.length === 0) return [];

  const seen = new Set<number>();
  for (const template of templates) {
    if (seen.has(template.touchNumber)) {
      throw new RangeError(
        `materializeCadenceSchedule: duplicate touch_number ${template.touchNumber}. ` +
          'Touch numbers are the cadence sequence and are unique per tenant upstream.',
      );
    }
    seen.add(template.touchNumber);

    if (!Number.isInteger(template.offsetDays) || template.offsetDays < 0) {
      throw new RangeError(
        `materializeCadenceSchedule: touch ${template.touchNumber} has offsetDays ` +
          `${template.offsetDays}. Offsets are whole calendar days from the anchor and ` +
          'a negative offset is a request to schedule into the past (D-01).',
      );
    }
  }

  // Sorted on a copy: the caller's array is theirs, and a repository result is
  // sometimes reused for a second purpose in the same tick.
  const ordered = [...templates].sort((a, b) => a.touchNumber - b.touchNumber);

  return ordered.map((template) => ({
    touchNumber: template.touchNumber,
    channel: template.channel,
    scheduledAt:
      template.offsetDays === 0
        ? nextAllowedSlot(anchor, win, preferredSendTime, jitterMinutes, {
            sameDayMarginMinutes: input.sameDayMarginMinutes,
          })
        : slotAtOffsetDays(anchor, template.offsetDays, win, preferredSendTime, jitterMinutes),
    originalOffsetDays: template.offsetDays,
  }));
}
