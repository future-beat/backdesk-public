/**
 * What to do with a touch that missed its slot (D-09, D-10, D-11, D-12).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE PRODUCT PRINCIPLE, ENCODED AS A FUNCTION: A LATE TOUCH IS WORSE THAN │
 * │ A SKIPPED TOUCH.                                                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The whole proposition of this service is that a tradie's customers hear from
 * them like a person who is on top of things. A follow-up that arrives three
 * days after it was due does not say "we are chasing you"; it says nobody was
 * watching. A backlog that fires all at once when a client resumes does not say
 * "we are back"; it says machine. So every arm below either sends the touch at a
 * moment that reads as deliberate, or declines to send it at all — and the
 * cadence carries on to the next one, which was going to arrive anyway.
 *
 * FRAMEWORK-FREE AND DATABASE-FREE ON PURPOSE. Nothing here imports from the
 * web framework, the ORM or the repository — the file's whole import list is
 * two sibling modules. (The absences are spelled out in prose rather than named
 * literally, because the standing check for them is a grep, and a header that
 * names what it forbids fails the rule it is explaining.) In goes a touch, its
 * successor, its cadence's anchor, the tenant's window and a moment; out comes
 * one of five actions. That is what lets every threshold be asserted at its exact boundary
 * by a unit test rather than inferred from whichever path an integration run
 * happened to take (`tests/cadence-rewindow.test.ts`).
 *
 * ── THE ORDER OF EVALUATION IS PART OF THE POLICY ───────────────────────────
 *
 *   1. EXPIRY (D-12) — is the whole cadence over? Asked first, because an
 *      expired cadence's touches are never judged individually: deciding the
 *      fate of one touch on a cadence that should have ended a fortnight ago
 *      leaves four more for the next tick to reach the same conclusion about,
 *      and every one of those decisions gets written to the record as though it
 *      meant something.
 *   2. STALENESS (D-11) — is this touch too late to be a follow-up at all?
 *      Asked before any reschedule, because moving a three-day-late touch
 *      forward is how it arrives four days late.
 *   3. SEND NOW — may this go, right now? Only if the slot has arrived, the
 *      tenant's window is open with enough of it left to be worth starting a
 *      conversation in, and the touch is inside the staleness cap.
 *   4. RESCHEDULE vs SKIP(min_gap) — where would it go instead, and would going
 *      there crowd the touch that comes after it?
 *
 * ── EVERY BOUNDARY FALLS ON THE SIDE THAT KEEPS THE CADENCE ALIVE ───────────
 *
 * Exactly `STALENESS_CAP_HOURS` late is still sendable. Exactly
 * `CADENCE_EXPIRY_DAYS` old is still live. Exactly `MIN_GAP_HOURS` before the
 * next touch is far enough away. A magnitude somebody chose is the LAST
 * ACCEPTABLE value, not the first unacceptable one — "no more than 72 hours
 * late" includes 72 — and deciding each of the three independently is how three
 * defensible choices add up to one arbitrary policy.
 *
 * ── UTC MILLISECONDS FOR EVERY DURATION; ZONE MATH ONLY TO CHOOSE A SLOT ────
 *
 * "Is this touch 72 hours late" is a question about two stored instants and has
 * nothing to do with anybody's wall clock. Only the reschedule arm re-enters
 * zone math, and it does so by delegating to `nextAllowedSlot` rather than
 * placing a slot of its own — there is ONE slot chooser in this engine, and
 * `tests/cadence-window.test.ts` is where its DST behaviour is proven.
 *
 * ── THE MAGNITUDES ARE THE CALLER'S POLICY (Phase 13, D-03) ─────────────────
 *
 * The three thresholds above — the expiry age, the staleness cap and the
 * minimum gap — are read from `input.policy`, the caller's per-kind object
 * (`policyFor(kind)` in `./policy`). When the caller passes none, the default
 * is `QUOTE_POLICY`, which is built from the same three quote constants this
 * function has always read, so every existing quote call and every existing
 * pure case holds unchanged. A lead cadence passes `LEAD_POLICY` (12 h / 24 h /
 * 7 days); the boundary rules — exactly the magnitude is still on the side
 * that keeps the cadence alive — are identical for both kinds.
 */
import { SAME_DAY_MARGIN_MINUTES } from './constants';
import { QUOTE_POLICY, type CadencePolicy } from './policy';
import { nextAllowedSlot, type ContactWindow } from './window';

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/** For the may-we-send-now probe below, which must not consume a real draw. */
const NO_JITTER = () => 0;

/**
 * The five things that can happen to an unsent touch.
 *
 * A CLOSED UNION THE CALLER SWITCHES ON, not a boolean beside a nullable date.
 * Each arm is a different write — leave it, move it, retire it with a reason,
 * end the cadence — and a shape that let two of them be confused is a shape in
 * which "skipped because it went stale" and "skipped because the next touch was
 * too close" become the same row in Phase 7's evidence.
 */
export type RewindowAction =
  /** The slot stands: dispatch may claim this touch when its moment arrives. */
  | { kind: 'send_now' }
  /** Move it. `at` is the new stored instant, jitter already baked in. */
  | { kind: 'reschedule'; at: Date }
  /** Retire it unsent, with the rule that decided — never a borrowed reason. */
  | { kind: 'skip'; reason: 'min_gap' | 'stale' }
  /** D-12: the cadence itself is over. The caller expires it and retires the rest. */
  | { kind: 'expire_cadence' };

export interface RewindowInput {
  /** The unsent touch being judged. Only its slot matters. */
  touch: { scheduledAt: Date };
  /**
   * The next unsent touch of the same cadence, or `null` if this is the last.
   *
   * D-10 is a statement about the CUSTOMER's experience rather than about the
   * queue: the question is whether that person would receive two messages in
   * quick succession, so the comparison is against the next thing they are due
   * to receive — never against this touch's own original slot.
   */
  nextTouch: { scheduledAt: Date } | null;
  /** `cadences.anchor_at` — D-01's eligibility moment, and D-12's clock. */
  cadenceAnchorAt: Date;
  window: ContactWindow;
  /** The tenant's preferred wall-clock send time, 'HH:MM[:SS]'. */
  preferredSendTime: string;
  /** The tick's pinned moment. Never read off the clock in here. */
  now: Date;
  /** Injected RNG, minutes. Drawn on the reschedule path. */
  jitterMinutes: () => number;
  /** D-09 override; defaults to SAME_DAY_MARGIN_MINUTES. */
  sameDayMarginMinutes?: number;
  /**
   * The cadence kind's three magnitudes (Phase 13, D-03). Absent means the
   * quote policy, so a caller written before kinds existed decides exactly as
   * it always did.
   */
  policy?: Pick<CadencePolicy, 'minGapHours' | 'stalenessCapHours' | 'expiryDays'>;
}

/**
 * May this tenant be contacted at this exact moment?
 *
 * ASKED BY ASKING THE SLOT CHOOSER, deliberately, rather than by re-deriving the
 * condition from `isInsideWindow` plus a margin comparison. `nextAllowedSlot`'s
 * same-day branch returns `from` unchanged when the window is open on an allowed
 * day with at least the margin remaining and the jitter draw is zero — so "we
 * may send now" is exactly "the next allowed slot from now IS now".
 *
 * Two rules that must never disagree are better expressed as one rule asked
 * twice. Written the other way, a touch could be refused by the send test and
 * immediately re-placed at the same minute by the reschedule test, one tick
 * apart, forever.
 */
function mayContactNow(
  now: Date,
  win: ContactWindow,
  preferredSendTime: string,
  marginMinutes: number,
): boolean {
  const slot = nextAllowedSlot(now, win, preferredSendTime, NO_JITTER, {
    sameDayMarginMinutes: marginMinutes,
  });
  return slot.getTime() === now.getTime();
}

function assertUsable(value: Date, label: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError(
      `rewindowTouch: ${label} must be a real Date; got ${String(value)}. An Invalid ` +
        'Date compares false to everything, which reads as "not overdue" forever.',
    );
  }
}

/**
 * The policy. Total over its inputs, and it decides nothing about the world:
 * suppression, both pause flags, quote status and the ledger claim are
 * dispatch-time refusals (CAD-05) that this function must not second-guess.
 */
export function rewindowTouch(input: RewindowInput): RewindowAction {
  const { touch, nextTouch, cadenceAnchorAt, window: win, now } = input;

  assertUsable(touch.scheduledAt, 'touch.scheduledAt');
  assertUsable(cadenceAnchorAt, 'cadenceAnchorAt');
  assertUsable(now, 'now');

  const policy = input.policy ?? QUOTE_POLICY;

  // ── 1. D-12 — the cadence, not the touch. ─────────────────────────────────
  //
  // A quote nobody has answered in six weeks is not being considered, and a
  // cadence that outlives its own schedule is how a customer hears about a
  // bathroom somebody else finished for them in March.
  if (now.getTime() - cadenceAnchorAt.getTime() > policy.expiryDays * MS_PER_DAY) {
    return { kind: 'expire_cadence' };
  }

  const lateBy = now.getTime() - touch.scheduledAt.getTime();

  // ── 2. D-11 — judged BEFORE any reschedule. ───────────────────────────────
  //
  // Rescheduling a touch that is already three days late is how it arrives four
  // days late. The alternative — sending everything that queued up during an
  // outage — is precisely the burst CAD-02 exists to prevent.
  if (lateBy > policy.stalenessCapHours * MS_PER_HOUR) {
    return { kind: 'skip', reason: 'stale' };
  }

  // ── 3. Nothing to repair: THE SLOT STANDS. ────────────────────────────────
  //
  // Two cases share this arm and share that meaning:
  //
  //   the touch is not due yet, so there is nothing to move; or
  //   the touch is due, the window is open with margin, and it is inside the
  //   cap — so it goes, and the tick's dispatch pass is what sends it.
  //
  // The margin is why a touch coming due at 16:55 against a 17:00 close does
  // NOT take this arm. That send is technically compliant and practically an
  // ambush at knock-off: the reply lands after hours and sits unread until the
  // following week. D-09 already decided that question for placement, and this
  // is the same question.
  const margin = input.sameDayMarginMinutes ?? SAME_DAY_MARGIN_MINUTES;

  if (lateBy < 0) return { kind: 'send_now' };
  if (mayContactNow(now, win, input.preferredSendTime, margin)) return { kind: 'send_now' };

  // ── 4. Where it would go instead. ─────────────────────────────────────────
  //
  // Delegated to `nextAllowedSlot`: one slot chooser, whose same-day /
  // preferred-slot / next-allowed-day branches and whose DST behaviour are
  // proven once. Its same-day branch cannot fire from this call site, and that
  // is a property rather than an oversight — it tests the identical condition
  // the `send_now` arm just tested, so a touch we may send is SENT, never
  // re-placed a few minutes later for no reason a customer could perceive.
  const candidate = nextAllowedSlot(now, win, input.preferredSendTime, input.jitterMinutes, {
    sameDayMarginMinutes: margin,
  });

  // ── D-10 — would landing there crowd the touch that follows? ──────────────
  //
  // The gap is signed on purpose. A candidate landing AFTER the next touch's
  // slot produces a negative gap, which is not "plenty of room": it is the
  // missed touch overtaking the one that was meant to follow it. Both readings
  // are "within the gap" and both get the same answer — let the next touch
  // carry the conversation. One missed follow-up is cheaper than looking like a
  // machine having a malfunction.
  if (nextTouch !== null) {
    assertUsable(nextTouch.scheduledAt, 'nextTouch.scheduledAt');

    const gap = nextTouch.scheduledAt.getTime() - candidate.getTime();
    if (gap < policy.minGapHours * MS_PER_HOUR) {
      return { kind: 'skip', reason: 'min_gap' };
    }
  }

  return { kind: 'reschedule', at: candidate };
}
