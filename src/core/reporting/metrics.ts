/**
 * The RPT-03 instrumentation metrics — five plus one, through ONE derivation.
 *
 * ── WHY ONE DERIVATION ──────────────────────────────────────────────────────
 *
 * Three surfaces read these numbers: the `/reports` overview (which client is
 * drifting), the `/reports/[client]` detail page, and the 06:30 digest line.
 * They get their INPUTS from different SQL — a cross-tenant grouped accessor
 * for the overview, per-tenant reads for the detail page — but they compute
 * through the functions in this file, so they cannot disagree. Two screens
 * showing a client a different opt-out rate is not a display bug; it is the
 * moment the operator stops believing either of them.
 *
 * `TenantMetricCounts` is declared HERE for the same reason: both SQL bodies
 * are typed against one contract, so a column added to one read and forgotten
 * in the other does not compile.
 *
 * ── NULL, NEVER A FABRICATED RATE ───────────────────────────────────────────
 *
 * Every rate returns `rateBp: null` when its denominator is zero. Not `0`,
 * which would read as "this client has a perfect first-touch record" for a
 * client who has had no quotes at all, and not a not-a-number value, which
 * would reach a page as a broken cell or a digest as gibberish. This is the
 * `computeBaseline` null-never-zero rule applied to every instrument. The guard
 * is STRUCTURAL — null is returned BEFORE any division happens — so there is
 * nothing left to sanitise downstream and no arithmetic guard anywhere in this
 * file.
 *
 * ── ONE THRESHOLD, ONE PREDICATE ────────────────────────────────────────────
 *
 * `isOptOutAlarming` is the only place the alarm threshold — and, since quick
 * 260913-ind, the minimum-sample floor underneath it — is applied, the way
 * `isAttestationStale` is for the Phase 6 stale-attestation rule. The badge on
 * the overview, the badge on the detail page and the digest heading all import
 * it; none of them carries a threshold or a floor of its own.
 */
import {
  FIRST_TOUCH_HOURS,
  OPT_OUT_ALARM_MIN_CONTACTS,
  OPT_OUT_ALARM_RATE,
} from '@/core/audit/constants';
import { multipleBasisPoints } from '@/core/attribution/money';

import { feesInForce, type FeeRow, type FeesInForce } from './fees';
import type { Period } from './period';

/** A rate, with the two numbers it came from — so a page can show "3 of 42". */
export interface Rate {
  numerator: number;
  denominator: number;
  /** Integer basis points, or null when there is no denominator. */
  rateBp: number | null;
}

/**
 * `n / d` as integer basis points — the ONE rounding step per rate.
 *
 * Rounded (not floored) because these are DIAGNOSTICS, not money: a first-touch
 * rate of 99.996% should read as 100.0%, and there is no client whose invoice
 * moves by a half basis point. The money in this phase floors; the instruments
 * round; the two rules live in different files on purpose.
 */
export function rateBasisPoints(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator * 10_000) / denominator);
}

function rate(numerator: number, denominator: number): Rate {
  return { numerator, denominator, rateBp: rateBasisPoints(numerator, denominator) };
}

/**
 * The D-15 rolling window, in days.
 *
 * Both instrumentation pages call `rollingWindow(now, LIVE_METRICS_WINDOW_DAYS)`
 * and print "last 30 days" FROM this constant. It is deliberately separate from
 * `ATTRIBUTION_WINDOW_DAYS`, which happens to hold the same number today and
 * answers a completely different question — one is "how long after a touch does
 * a win still count", the other is "how far back does this screen look". Fusing
 * them would make a screen-tuning change silently rewrite the billing rule.
 */
export const LIVE_METRICS_WINDOW_DAYS = 30;

/** The alarm threshold in integer basis points, DERIVED from the constant. */
export const OPT_OUT_ALARM_BP = Math.round(OPT_OUT_ALARM_RATE * 10_000);

/**
 * THE opt-out alarm predicate (D-16). One threshold, three surfaces.
 *
 * At the threshold is ALARMING — the same at-the-boundary-is-inside convention
 * as every other rule in this codebase. A null rate is NOT alarming: a client
 * we have messaged nobody for has not upset anybody, and a badge on that row
 * would be a false accusation on the screen the operator triages from.
 *
 * ── IT TAKES THE WHOLE RATE, NOT JUST `rateBp` (quick 260913-ind) ───────────
 *
 * Because the rule has TWO halves and the second one is the denominator. A rate
 * over fewer than `OPT_OUT_ALARM_MIN_CONTACTS` contacts is not evidence of
 * anything: the test tenant's single opted-out handset read 100.0% and put the
 * same line in the operator's digest every morning for a rolling thirty days.
 * Passing the figures rather than the percentage is what makes it IMPOSSIBLE
 * for a caller to ask the old, rate-only question — the signature change is the
 * enforcement, not a comment asking callers to remember.
 *
 * The floor is checked FIRST and structurally, before the threshold comparison,
 * so a thin client cannot alarm by any route. It can only ever silence, never
 * raise — see the constant for why that direction is the safe one.
 *
 * It NAGS, it never pauses (Phase 6 D-15). Nothing in this module returns an
 * action.
 */
export function isOptOutAlarming(optOut: Rate): boolean {
  if (optOut.denominator < OPT_OUT_ALARM_MIN_CONTACTS) return false;
  return optOut.rateBp !== null && optOut.rateBp >= OPT_OUT_ALARM_BP;
}

/** The first-touch service level in elapsed milliseconds, DERIVED from the constant. */
export const FIRST_TOUCH_MS = FIRST_TOUCH_HOURS * 3_600_000;

/**
 * Whether touch 1 landed inside the first-touch window (D-18).
 *
 * Exactly 24 hours counts as within. A touch claimed BEFORE the quote was
 * detected does not count at all — that is a clock problem or a replay, not a
 * fast follow-up, and counting it would let a data bug flatter the one metric
 * that says whether the service is actually being delivered.
 */
export function withinFirstTouchWindow(openedDetectedAt: Date, claimedAt: Date): boolean {
  const elapsed = claimedAt.getTime() - openedDetectedAt.getTime();
  return elapsed >= 0 && elapsed <= FIRST_TOUCH_MS;
}

/**
 * When the service became responsible for a client's quotes — the D-18
 * onboarding exclusion, as ONE rule (A5).
 *
 * The later of "the client's message templates were first approved" (ONB-03)
 * and "the client first attested" (ONB-04): the instant BOTH gate conditions
 * held, which is the instant a cadence could first send. Quotes opened before
 * it were born paused for onboarding, and counting them against the first-touch
 * rate would blame the service for not sending messages it was forbidden to
 * send.
 *
 * `null` when either is null — a client who has not cleared both gates has no
 * onboarding instant, and every quote is excluded rather than defaulted in.
 * D-18's exclusion is stated once here and footnoted on the detail page from
 * this same definition, because `cadences.pause_reason` is not historical: it
 * is overwritten when the pause lifts, so "was this cadence born paused" cannot
 * be recovered from the row afterwards.
 */
export function onboardedAt(
  templatesFirstApprovedAt: Date | null,
  firstAttestedAt: Date | null,
): Date | null {
  if (templatesFirstApprovedAt === null || firstAttestedAt === null) return null;
  return templatesFirstApprovedAt.getTime() >= firstAttestedAt.getTime()
    ? templatesFirstApprovedAt
    : firstAttestedAt;
}

/**
 * One tenant's window counts — the contract BOTH reads satisfy.
 *
 * Counts and sums only. The cross-tenant accessor returns these grouped in SQL
 * with no `tenants` join, no names and no addresses; the tenant name and zone
 * are attached by the caller from the operator's own session, exactly as the
 * inbox does.
 */
export interface TenantMetricCounts {
  tenantId: string;
  tenantName: string;
  /** IANA identifier — the fee schedule pro-rates by LOCAL day. */
  timezone: string;

  /** Quotes opened in the window, after the onboarding exclusion. */
  quotesOpened: number;
  /** Of those, the ones whose touch 1 qualified inside the first-touch window. */
  quotesFirstTouch24h: number;

  /** Cadences with at least one qualifying sent touch in the window. */
  cadencesTouched: number;
  /** Of those, the ones with at least one threaded inbound reply in the window. */
  cadencesReplied: number;

  /** Distinct (channel, address) pairs we messaged in the window. */
  contactsTouched: number;
  /** Of those, the ones suppressed in the window — every source counts (D-16). */
  contactsOptedOut: number;

  /** Drafts approved in the window — the D-17 denominator. */
  draftsApproved: number;
  /** Of those, the ones with a non-zero edit distance. Validator-forced edits count. */
  draftsEdited: number;
  /** `numeric` as postgres.js returns it: a STRING, converted ONCE, here. */
  editDistanceSum: string;

  /** Sum of conservative cents attributed in the window. */
  conservativeCents: number;

  /** Reply-to-escalation latencies in whole minutes, for the median. */
  escalationLatencyMinutes: number[];

  /** The append-only fee schedule, pro-rated over the window by `computeTenantMetrics`. */
  fees: FeeRow[];

  // ── 2026-10 (Phase 15, 15-03; RPT-04): the `/reports` overview's calls column ──

  /** Diverted calls that arrived in the window (`missed_calls.started_at`). */
  missedCalls: number;
  /** Of those, the ones that arrived outside the client's contact hours. */
  missedCallsAfterHours: number;
  /**
   * Whether the client has an ACTIVE divert number. What makes a zero above a
   * measurement ("diverting, nobody rang") rather than an absence ("not set
   * up") — the column renders the two differently (UI-SPEC §3a).
   */
  hasDivertNumber: boolean;
}

export function firstTouchRate(counts: TenantMetricCounts): Rate {
  return rate(counts.quotesFirstTouch24h, counts.quotesOpened);
}

export function replyRate(counts: TenantMetricCounts): Rate {
  return rate(counts.cadencesReplied, counts.cadencesTouched);
}

/**
 * D-16, and it is labelled "opt-out rate" everywhere — never "complaint rate".
 *
 * No complaint signal exists in this system. Presenting one would be a claim we
 * cannot support, on a screen the operator uses to decide whether to ring a
 * client about their message copy.
 *
 * The numerator is restricted UPSTREAM to addresses that are in the denominator
 * (A6), which keeps the rate a rate. Without that restriction the Phase 4 D-03
 * STOP fan-out — which writes a bare STOP into every tenant's suppression list
 * — would push every client past the alarm threshold in the same minute because
 * one stranger texted STOP to the shared number.
 */
export function optOutRate(counts: TenantMetricCounts): Rate {
  return rate(counts.contactsOptedOut, counts.contactsTouched);
}

export function humanEditRate(counts: TenantMetricCounts): Rate {
  return rate(counts.draftsEdited, counts.draftsApproved);
}

/**
 * Mean normalized edit distance as integer basis points (D-17).
 *
 * ONE `Number()` on the numeric string and ONE round, here — the sum arrives
 * from postgres.js as text and must not be converted twice on the way to a
 * screen. `null` when nothing was approved, for the same reason every other
 * denominator does.
 */
export function meanEditDistanceBp(counts: TenantMetricCounts): number | null {
  return rateBasisPoints(Number(counts.editDistanceSum), counts.draftsApproved);
}

export interface RecoveryMultiple {
  conservativeCents: number;
  feesCents: number | null;
  multipleBp: number | null;
}

/** D-13's multiple, live. `null` fee gives `null` multiple — never an infinity. */
export function recoveryMultiple(conservativeCents: number, fees: FeesInForce): RecoveryMultiple {
  return {
    conservativeCents,
    feesCents: fees.monthlyCents,
    multipleBp: multipleBasisPoints(conservativeCents, fees.monthlyCents),
  };
}

export interface EscalationSpeed {
  count: number;
  /** Whole minutes. `null` for no escalations — an absence, not a zero-minute response. */
  medianMinutes: number | null;
}

/**
 * The median reply-to-escalation latency.
 *
 * MEDIAN, not mean, deliberately: one escalation that fired six hours late
 * because the tradie's phone was off would drag a mean far enough to hide a
 * week of two-minute responses, and this metric exists to answer "is the hot
 * lead reaching a human quickly", which is a question about the typical case.
 */
export function escalationSpeed(minutes: readonly number[]): EscalationSpeed {
  if (minutes.length === 0) return { count: 0, medianMinutes: null };

  const sorted = [...minutes].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? sorted[middle]!
      : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);

  return { count: sorted.length, medianMinutes: median };
}

export interface TenantMetrics {
  tenantId: string;
  tenantName: string;
  timezone: string;
  firstTouch: Rate;
  reply: Rate;
  optOut: Rate & { alarming: boolean };
  humanEdit: Rate & { meanEditDistanceBp: number | null };
  recovery: RecoveryMultiple;
  escalation: EscalationSpeed;
  /**
   * 2026-10 (Phase 15, RPT-04): the window's diverted calls, passed through
   * unchanged. Counts, not rates — a zero with a divert number is a
   * measurement, never `null`.
   */
  missedCalls: {
    count: TenantMetricCounts['missedCalls'];
    afterHours: TenantMetricCounts['missedCallsAfterHours'];
    hasDivertNumber: TenantMetricCounts['hasDivertNumber'];
  };
}

/**
 * The SINGLE derivation both instrumentation pages and the digest call.
 *
 * `now` is not redundant with `window.end`. A caller may hand in a period that
 * has not finished yet — a month-to-date view of the current month — and
 * charging a full month of fees against a fortnight of recovered revenue would
 * report a failing multiple for a service that is doing fine. The fee period is
 * therefore clamped to `now`: elapsed revenue over elapsed fees, both sides of
 * the ratio measuring the same stretch of calendar. For the D-15 rolling window
 * the clamp is a no-op, because that window already ends at `now`.
 */
export function computeTenantMetrics(
  counts: TenantMetricCounts,
  window: Period,
  now: Date,
): TenantMetrics {
  const feePeriod: Period = {
    start: window.start,
    end: now.getTime() < window.end.getTime() ? now : window.end,
  };
  const fees = feesInForce(counts.fees, feePeriod, counts.timezone);
  const optOut = optOutRate(counts);

  return {
    tenantId: counts.tenantId,
    tenantName: counts.tenantName,
    timezone: counts.timezone,
    firstTouch: firstTouchRate(counts),
    reply: replyRate(counts),
    optOut: { ...optOut, alarming: isOptOutAlarming(optOut) },
    humanEdit: { ...humanEditRate(counts), meanEditDistanceBp: meanEditDistanceBp(counts) },
    recovery: recoveryMultiple(counts.conservativeCents, fees),
    escalation: escalationSpeed(counts.escalationLatencyMinutes),
    missedCalls: {
      count: counts.missedCalls,
      afterHours: counts.missedCallsAfterHours,
      hasDivertNumber: counts.hasDivertNumber,
    },
  };
}

/** Locale-aware, so 'Ålesund Electrical' sorts where an operator expects it. */
const COLLATOR = new Intl.Collator('en-AU');

/**
 * The `/reports` overview order (U-6): alarmed clients first, then by name.
 *
 * TOTALLY ORDERED, ending in `tenantId`, so the list does not reshuffle between
 * renders for two clients with the same name. A screen whose rows move under
 * the operator's cursor is a screen they misclick on.
 */
export function sortForOverview(rows: readonly TenantMetrics[]): TenantMetrics[] {
  return [...rows].sort((a, b) => {
    if (a.optOut.alarming !== b.optOut.alarming) return a.optOut.alarming ? -1 : 1;
    return COLLATOR.compare(a.tenantName, b.tenantName) || COLLATOR.compare(a.tenantId, b.tenantId);
  });
}
