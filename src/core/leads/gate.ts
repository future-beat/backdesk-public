/**
 * THE TEXT-BACK GATE — pure, ordered, first refusal wins (Phase 12, D-06).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A MEMBER OF THE PUBLIC RECEIVES THIS TEXT. Every rule below is a reason  │
 * │ NOT to send, walked in a FIXED ORDER, and the first one that fails is    │
 * │ the reason recorded on the missed call. An absent fact is a refusal,     │
 * │ never a pass: the caller assembles every fact inside the claim           │
 * │ transaction, and a read that fails rolls the transaction back (the       │
 * │ `firstUnmetGate` rule, src/core/onboarding/arming.ts).                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * THE ORDER IS D-06's, then Phase 12's three additions after it so D-06's
 * order is untouched, with Phase 13's one rule (D-12) inserted at 6 and Phase
 * 15's one rule (D-08b) at 7:
 *
 *   1  not_armed      — this client's text-back switch is off
 *   2  own_number     — the caller is one of the client's own numbers (the
 *                       never-text list, the escalation phone, the divert
 *                       number, the SMS from-number) or equals the normalised
 *                       ForwardedFrom — a carrier that substituted the
 *                       diverting line as the caller ID (11-08 override)
 *   3  withheld       — no number to text (withheld, or absent)
 *   4  not_mobile     — not an Australian mobile (`+614…`)
 *   5  suppressed     — the caller texted STOP to this client
 *   6  recent_negative_close
 *                     — the caller's newest lead at this client closed as
 *                       not_a_lead / spam / complaint / opt_out within
 *                       LEAD_NEGATIVE_COOL_OFF_DAYS (Phase 13, D-12)
 *   7  recent_conversion
 *                     — the caller's newest lead at this client CONVERTED
 *                       within LEAD_RECENT_CONVERSION_HOURS (Phase 15, D-08b)
 *   8  recent_text    — already texted for this client in the rolling window
 *   9  daily_cap      — the client's rolling-window cap is reached (D-07)
 *  10  stale          — the call is too old to text (D-20)
 *  11  sms_not_armed  — no SMS identity for the client, or the provider is the
 *                       stub (D-15): a stub send is never a text-back
 *  12  no_template    — no attested wording that still validates (D-02)
 *
 * WHY recent_negative_close SITS BESIDE suppressed: it is the same kind of
 * fact — a per-caller "must not text" decided by what this caller did before,
 * not by this call or this client's configuration — so it walks immediately
 * after suppression. A caller both suppressed and negatively closed records
 * `suppressed`, the permanent and stronger reason. D-06's relative order among
 * every other rule is untouched, and TEXT_BACK_SKIP_REASONS carries the new
 * member at the same position. `recent_conversion` (Phase 15) walks directly
 * after it for the same reason: it too is decided by what this caller's newest
 * lead here became, so the per-caller "must not text" facts stay contiguous.
 *
 * THE OWN-NUMBER RULE IS NULL-GUARDED, explicitly. A withheld caller has no
 * number, and a call with no ForwardedFrom has none either; a bare
 * `caller === forwardedFrom` would be `null === null` → TRUE and record a
 * withheld caller as `own_number`. Rule 2 only fires on a NON-NULL caller.
 * ForwardedFrom is EVIDENCE, never required: its absence changes nothing.
 *
 * Pure: no repository, no clock read (`now` is passed), no `next/*`. It imports
 * only types and the two constants modules, so the whole input space is
 * provable by `tests/text-back-gate.test.ts` without a database. The same goes
 * for `isRecentNegativeClose` and `isRecentConversion`, which turn the
 * caller's newest lead into rules 6 and 7's facts.
 */
import { TEXT_BACK_DAILY_CAP } from '@/core/audit/constants';
import type { LeadClosedReason, TextBackSkipReason, TextBackVariant } from '@/db/schema';

import {
  LEAD_NEGATIVE_COOL_OFF_DAYS,
  LEAD_RECENT_CONVERSION_HOURS,
  TEXT_BACK_MAX_AGE_MINUTES,
} from './constants';

/** The reasons the GATE can give. `lead_open` / `quote_open` are the send path's. */
export type TextBackGateReason = Exclude<TextBackSkipReason, 'lead_open' | 'quote_open'>;

/** Every fact the gate reads. None optional: an absent fact cannot pass. */
export interface TextBackFacts {
  /** This client's own `text_back` row exists and is enabled. */
  armed: boolean;
  /** The caller's E.164 as the arrival door stored it, or `null`. */
  callerE164: string | null;
  /** One of CALLER_KINDS: `mobile` / `other_number` / `withheld`. */
  callerKind: string;
  /** `classifyCaller(forwarded_from_raw).e164`, or `null`. Evidence only. */
  forwardedFromE164: string | null;
  /**
   * The client's own numbers, normalised: the never-text list (own lines and
   * never-text entries), the escalation phone, the divert number and the SMS
   * from-number.
   */
  ownNumbers: readonly string[];
  /** The caller is on this client's SMS suppression list. */
  suppressed: boolean;
  /**
   * The caller's NEWEST lead at this client closed as not_a_lead, spam,
   * complaint or opt_out no more than LEAD_NEGATIVE_COOL_OFF_DAYS ago
   * (Phase 13, D-12). Assembled on the claim transaction beside `suppressed`.
   */
  recentNegativeClose: boolean;
  /**
   * The caller's NEWEST lead at this client CONVERTED no more than
   * LEAD_RECENT_CONVERSION_HOURS ago (Phase 15, D-08b). Derived from the same
   * `latestForMobile` row as `recentNegativeClose` — no read of its own.
   */
  recentConversion: boolean;
  /** This caller was texted (claimed or sent) for this client in the window. */
  textedSince24h: boolean;
  /** Text-backs (claimed or sent) for this client in the window, this call excluded. */
  sentSince24h: number;
  /** `coalesce(ended_at, started_at)` — when the call is treated as missed. */
  referenceAt: Date;
  /** `resolveSmsFrom(tenantId)` — the number the text would leave from. */
  smsFrom: string | null;
  /** `claimedProviderFor(sender, 'sms')` — the delegate that would send it. */
  provider: string;
  /** A live quote cadence at this client has this caller's mobile (D-08). */
  openQuoteCadence: boolean;
  /** The variant's newest attested template exists AND re-validates. */
  templateOk: boolean;
  /** Which wording this call would use. */
  variant: TextBackVariant;
}

export type TextBackDecision =
  | { send: true; variant: TextBackVariant }
  | { send: false; reason: TextBackGateReason };

const MAX_AGE_MS = TEXT_BACK_MAX_AGE_MINUTES * 60_000;
const COOL_OFF_MS = LEAD_NEGATIVE_COOL_OFF_DAYS * 86_400_000;
const CONVERSION_WINDOW_MS = LEAD_RECENT_CONVERSION_HOURS * 3_600_000;

/**
 * The lead closes that keep a caller from being texted by this client for
 * LEAD_NEGATIVE_COOL_OFF_DAYS (Phase 13, D-12): a wrong number, a robocaller,
 * an unhappy customer, someone who asked to be left alone. Every other close
 * — `touches_exhausted`, `expired`, `operator`, a label that kept the
 * conversation alive — lets a fresh call open a new lead and a new text-back.
 */
export const NEGATIVE_CLOSE_REASONS = [
  'not_a_lead',
  'spam',
  'complaint',
  'opt_out',
] as const satisfies readonly LeadClosedReason[];

const NEGATIVE: ReadonlySet<string> = new Set<string>(NEGATIVE_CLOSE_REASONS);

/**
 * Rule 6's fact (D-12), from the caller's NEWEST lead at this client
 * (`leads.latestForMobile`), or `undefined` when they have never been a lead
 * here. TRUE only when that lead closed with a negative reason no more than
 * LEAD_NEGATIVE_COOL_OFF_DAYS before `now` — at the boundary is inside:
 * closed exactly ninety days ago is still refused, one millisecond more is
 * not. An open newest lead carries no reason and is never negative, whatever
 * an older lead closed as; a converted one (Phase 14) carries a conversion
 * reason — `booked_by_tradie` or `job_created` — which is not negative, so a
 * booked customer is still texted back next time. `closed_by_tradie` is not
 * negative either.
 */
export function isRecentNegativeClose(
  newestLead: { closedReason: string | null; closedAt: Date | null } | undefined,
  now: Date,
): boolean {
  if (newestLead === undefined) return false;
  const { closedReason, closedAt } = newestLead;
  if (closedReason === null || closedAt === null) return false;
  if (!NEGATIVE.has(closedReason)) return false;
  return now.getTime() - closedAt.getTime() <= COOL_OFF_MS;
}

/**
 * Rule 7's fact (Phase 15, D-08b), from the same newest lead as rule 6's.
 * TRUE only when that lead's status is `converted` and it closed no more than
 * LEAD_RECENT_CONVERSION_HOURS before `now` — at the boundary is inside, like
 * the cool-off: converted exactly a day ago is still refused, one millisecond
 * more is not. An open, closed or expired newest lead is never a conversion,
 * and a converted one with no close time is not trusted as one.
 */
export function isRecentConversion(
  newestLead: { status: string; closedAt: Date | null } | undefined,
  now: Date,
): boolean {
  if (newestLead === undefined) return false;
  if (newestLead.status !== 'converted' || newestLead.closedAt === null) return false;
  return now.getTime() - newestLead.closedAt.getTime() <= CONVERSION_WINDOW_MS;
}

/** The ordered walk. See the header — the order IS the specification. */
export function decideTextBack(facts: TextBackFacts, now: Date): TextBackDecision {
  const refuse = (reason: TextBackGateReason): TextBackDecision => ({ send: false, reason });
  const caller = facts.callerE164;

  // 1
  if (!facts.armed) return refuse('not_armed');

  // 2 — NULL-GUARDED: only a caller WITH a number can be one of ours.
  if (
    caller !== null &&
    (facts.ownNumbers.includes(caller) ||
      (facts.forwardedFromE164 !== null && caller === facts.forwardedFromE164))
  ) {
    return refuse('own_number');
  }

  // 3
  if (facts.callerKind === 'withheld' || caller === null) return refuse('withheld');

  // 4
  if (facts.callerKind !== 'mobile') return refuse('not_mobile');

  // 5
  if (facts.suppressed) return refuse('suppressed');

  // 6 — Phase 13, D-12: a per-caller "must not text" fact, like 5.
  if (facts.recentNegativeClose) return refuse('recent_negative_close');

  // 7 — Phase 15, D-08b: a caller whose lead here CONVERTED within
  // LEAD_RECENT_CONVERSION_HOURS is not re-opened; sits with the per-caller
  // must-not-text facts.
  if (facts.recentConversion) return refuse('recent_conversion');

  // 8
  if (facts.textedSince24h) return refuse('recent_text');

  // 9 — 29 prior passes (this is the 30th); 30 prior refuses.
  if (facts.sentSince24h >= TEXT_BACK_DAILY_CAP) return refuse('daily_cap');

  // 10 — exactly the maximum age is still sendable.
  if (now.getTime() - facts.referenceAt.getTime() > MAX_AGE_MS) return refuse('stale');

  // 11 — D-15: a stub is never a text-back.
  if (facts.smsFrom === null || facts.provider === 'stub') return refuse('sms_not_armed');

  // 12
  if (!facts.templateOk) return refuse('no_template');

  return { send: true, variant: facts.variant };
}
