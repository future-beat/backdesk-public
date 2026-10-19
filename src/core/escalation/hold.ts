/**
 * D-09, the after-hours rule for a hot LEAD (Phase 13, LEAD-03), in the
 * founder's words: a tradie who does not do call-outs must not be woken at
 * 23:00 by an enquiry about a fence — that alert waits for the shop to open.
 * But a caller in an emergency at 11 pm is precisely who rang, so an
 * emergency-urgency reply or an emergency-keyword hit goes to the tradie's
 * phone at once, whatever the hour and whatever the switch says. Emergency
 * trades (plumbing, electrical, locksmiths) turn the switch on at onboarding
 * and hear about every hot lead as it happens.
 *
 * ── THE WHOLE RULE ─────────────────────────────────────────────────────────
 *
 *   immediate (emergency urgency, or a keyword hit)  → send now
 *   inside the client's contact window               → send now
 *   outside it, `after_hours_escalation` ON          → send now
 *   outside it, switch OFF, not immediate            → HOLD until the window
 *                                                      next opens
 *
 * ── A HOLD IS A CLAIM, NOT A SKIP ──────────────────────────────────────────
 *
 * The caller claims the escalation row with `hold_until` set and sends
 * nothing; the release pass sends it once the window opens. Holding by
 * skipping the claim would leave the row in the hot scan every minute until
 * morning, where a held backlog fills `HOT_ESCALATION_CAP` and starves an
 * emergency trade's hot row (research Pitfall 4).
 *
 * PURE. The window arithmetic is `window.ts`'s, which is framework-free; no
 * database, no clock of its own, no log line.
 */
import { isInsideWindow, nextWindowOpen, type ContactWindow } from '@/core/cadence/window';

/** The three facts the D-09 decision reads, and nothing else. */
export interface HoldDecisionInput {
  /** Emergency urgency or a keyword hit — escalated regardless (D-09). */
  immediate: boolean;
  /** The decision instant is inside the client's contact window. */
  inside: boolean;
  /** `tenants.after_hours_escalation` — the per-client switch, default OFF. */
  afterHoursEscalation: boolean;
}

/** D-09: hold only when not immediate, outside the window, and the switch is off. */
export function shouldHoldEscalation(input: HoldDecisionInput): boolean {
  return !input.immediate && !input.inside && !input.afterHoursEscalation;
}

/**
 * Is this hot reply one D-09 sends REGARDLESS of the hour and the switch?
 *
 * `urgency === 'emergency'` is the classifier's word (which `isHotLeadReply`
 * puts on `is_hot` at any confidence); `keywordHot` is the inbound door's
 * deterministic hit, written before any model runs. Either alone is enough.
 * A ring-twice call has no body, so it is never immediate (Open Question 6).
 */
export function isImmediateEscalation(row: {
  urgency: string | null;
  keywordHot: boolean;
}): boolean {
  return row.urgency === 'emergency' || row.keywordHot;
}

/**
 * The `hold_until` an escalation claim carries: the window's next opening
 * instant when D-09 holds it, else `null` (send at once).
 *
 * SHORT-CIRCUITS before any window arithmetic when the row is immediate or the
 * switch is on: an emergency must never wait on — or fail on — a reading of
 * the contact hours it does not need.
 */
export function escalationHoldUntil(input: {
  now: Date;
  window: ContactWindow;
  immediate: boolean;
  afterHoursEscalation: boolean;
}): Date | null {
  const { now, window, immediate, afterHoursEscalation } = input;
  if (immediate || afterHoursEscalation) return null;

  const inside = isInsideWindow(now, window);
  return shouldHoldEscalation({ immediate, inside, afterHoursEscalation })
    ? nextWindowOpen(now, window)
    : null;
}
