/**
 * The per-kind cadence policy (Phase 13, D-03; LEAD-05).
 *
 * A cadence's timing magnitudes — the minimum gap between two touches, how
 * late a touch may still be sent, how old the whole cadence may grow, and the
 * day offsets of its touches — are chosen by `cadences.kind`, never scattered
 * as `if (kind === 'lead')` at call sites. A scattered value is four values;
 * one object per kind is one decision per kind.
 *
 * THE QUOTE OBJECT IS BUILT FROM THE QUOTE CONSTANTS, UNCHANGED. Nothing here
 * re-states a quote number: `QUOTE_POLICY` reads `MIN_GAP_HOURS`,
 * `STALENESS_CAP_HOURS`, `CADENCE_EXPIRY_DAYS` and `DEFAULT_TOUCH_OFFSET_DAYS`
 * from the module that has always owned them (D-17 — quote behaviour does not
 * move). The lead object reads the lead twins from `src/core/leads/constants`,
 * which say why each lead number is what it is.
 *
 * WHY THE LEAD NUMBERS MUST NEVER MEET THE QUOTE RULE: a lead's touches 2 and
 * 3 are one calendar day apart. Under the quote's 48-hour gap every touch 2
 * that slipped would be retired `min_gap`, and a lead cadence would sit live
 * for six weeks. `tests/cadence-policy.test.ts` pins both objects at their
 * boundaries; `tests/lead-policy-both-kinds.test.ts` proves the tick picks
 * the object by kind on a real database.
 *
 * Pure: the import list is two constants modules and one type. The repository
 * stays ignorant of magnitudes — the policy is passed in by the tick.
 */
import {
  CADENCE_EXPIRY_DAYS,
  DEFAULT_TOUCH_OFFSET_DAYS,
  MIN_GAP_HOURS,
  STALENESS_CAP_HOURS,
} from './constants';
import {
  LEAD_EXPIRY_DAYS,
  LEAD_MIN_GAP_HOURS,
  LEAD_STALENESS_CAP_HOURS,
  LEAD_TOUCH_OFFSET_DAYS,
} from '@/core/leads/constants';
import type { CadenceKind } from '@/db/schema/cadences';

/** The four magnitudes a cadence kind decides. */
export interface CadencePolicy {
  /** The smallest gap, in hours, a rescheduled touch may leave before the next one. */
  minGapHours: number;
  /** How late, in hours, a touch may still be sent (exactly this late is still sendable). */
  stalenessCapHours: number;
  /** The age, in days from the anchor, at which the cadence expires (exactly this old is still live). */
  expiryDays: number;
  /** The day offsets of the cadence's touches, from the anchor. */
  touchOffsetDays: readonly number[];
}

/** The quote cadence's policy — the same four numbers the engine has always read. */
export const QUOTE_POLICY: CadencePolicy = {
  minGapHours: MIN_GAP_HOURS,
  stalenessCapHours: STALENESS_CAP_HOURS,
  expiryDays: CADENCE_EXPIRY_DAYS,
  touchOffsetDays: DEFAULT_TOUCH_OFFSET_DAYS,
};

/** The lead cadence's policy (Phase 13, D-01/D-03/D-15). */
export const LEAD_POLICY: CadencePolicy = {
  minGapHours: LEAD_MIN_GAP_HOURS,
  stalenessCapHours: LEAD_STALENESS_CAP_HOURS,
  expiryDays: LEAD_EXPIRY_DAYS,
  touchOffsetDays: LEAD_TOUCH_OFFSET_DAYS,
};

/**
 * Keyed by every member of `CADENCE_KINDS`: a third kind is a type error here
 * until somebody decides its numbers (the `ARMING_GATES` shape).
 */
const POLICIES = {
  quote: QUOTE_POLICY,
  lead: LEAD_POLICY,
} as const satisfies Record<CadenceKind, CadencePolicy>;

/** The policy for a cadence of this kind. */
export function policyFor(kind: CadenceKind): CadencePolicy {
  return POLICIES[kind];
}
