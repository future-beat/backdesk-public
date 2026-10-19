/**
 * WHAT "STALLED" MEANS — ONCE, FOR EVERY SURFACE THAT ASKS (CON-04, D-09..D-12).
 *
 * The first-touch-within-24h promise is the product's only hard deadline, and it
 * is kept by a human tapping Approve before a send slot arrives. This file is
 * the alarm on that: it decides, from a touch row and a clock, whether the
 * operator is about to miss one.
 *
 * ── ONE DERIVATION, FOUR CONSUMERS (D-12, the `deriveHealth` rule) ──────────
 *
 * The queue card's urgency badge, the nav count badge's stalled subset, the
 * client-list Drafts column and the stall alert email all read THIS module.
 * They are four renderings of one question, and the failure mode of four
 * answers is not a crash: it is a badge that reads red beside a list of three
 * cards that all read `scheduled`, which teaches an operator that the colour
 * means nothing. `STALL_THRESHOLD_HOURS` is the only threshold; nothing
 * downstream may re-spell the number 4 next to a `scheduled_at` comparison.
 *
 * ── KEYED ON THE TOUCH, NEVER ON DRAFT ROWS (D-09 — THE 05-04 BACKSTOP) ─────
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `isStalled` takes a status and a slot. It does not take a draft, it      │
 * │ cannot be given one, and that is the entire point of the signature.      │
 * │                                                                          │
 * │ 05-04 decided that a deterministic drafting failure (a 400/401/403)      │
 * │ records NO `touch_drafts` row, because there was no model output to be   │
 * │ evidence of. So a touch whose job description makes every request a 400  │
 * │ sits in `needs_draft` with nothing attached to it, silently, until the   │
 * │ cadence expires six weeks later. A stall predicate that joined to drafts │
 * │ would be blind to exactly the touches most worth alerting about.         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── FRAMEWORK-FREE, AND DB-FREE (source-asserted) ──────────────────────────
 *
 * No `next/*`, no `@/db/*`, no driver. The consumers are a Postgres UPDATE, a
 * React server layout, a server component and an email builder; a predicate
 * that could only be exercised through any one of them is a predicate whose
 * boundaries get decided by whichever caller was written first.
 */

/**
 * How close to its send slot an unapproved touch may get before the operator is
 * told. FOUR HOURS, and the number is a decision rather than a default.
 *
 * Short enough that the alert lands while there is still a working morning in
 * which to act; long enough that a draft written at 9am for a 4pm slot does not
 * page anybody at 9am. The 06-UI-SPEC fixed the `due soon` urgency tier to this
 * SAME constant deliberately — the tier badge and the alert must never disagree
 * about which touches are at risk, and two rules that must always agree are
 * safer as one rule asked twice (the D-09 `nextAllowedSlot` precedent).
 */
export const STALL_THRESHOLD_HOURS = 4;

const MS_PER_HOUR = 3_600_000;

/**
 * THE ONE POPULATION RULE — the touch statuses that are waiting on a human.
 *
 * `src/db/repository/for-all-tenants.ts` defines `APPROVAL_QUEUE_STATUSES` AS
 * this constant rather than beside it. Two array literals spelling one rule is
 * how a nav badge comes to read 4 next to a queue of 3; 06-01's summary named
 * this exact risk ("do not re-spell it") and the import direction is what makes
 * re-spelling impossible rather than merely discouraged.
 *
 * Typed as strings, not as `TouchStatus`, because that type lives in the schema
 * module and this file imports no DB module. The equality with the repository's
 * export is asserted in `tests/stall-policy.test.ts`, where both may be seen.
 */
export const STALLABLE_TOUCH_STATUSES = ['needs_draft', 'pending_approval'] as const;
export type StallableTouchStatus = (typeof STALLABLE_TOUCH_STATUSES)[number];

/**
 * The only thing this module needs to know about a touch.
 *
 * Deliberately structural and deliberately tiny: a `CadenceTouch` row would
 * work, and so does a two-field object built by a test, a SQL projection or the
 * digest route's capped read. Nothing here may grow a field that carries
 * customer content — this shape feeds an email builder.
 */
export interface StallableTouch {
  /** One of `TOUCH_STATUSES`; only the two members above can stall. */
  status: string;
  /** The stored send instant. Never recomputed — see `cadence-touches.ts`. */
  scheduledAt: Date;
}

/**
 * THE INSTANT AT OR BEFORE WHICH A SLOT COUNTS AS AT RISK.
 *
 * EXPORTED, and every consumer that needs the boundary as a value — the tick's
 * guarded UPDATE, the digest's grouped read, the nav badge's count query, the
 * client list's Drafts column — asks for it here rather than writing
 * `now + 4 * 3_600_000` locally. Four copies of one arithmetic expression is
 * the same defect as four copies of the predicate, one level down: they agree
 * until somebody changes the threshold and finds three of them.
 */
export function stallBoundary(now: Date): Date {
  return new Date(now.getTime() + STALL_THRESHOLD_HOURS * MS_PER_HOUR);
}

/**
 * IS THIS TOUCH AT RISK OF MISSING ITS SLOT? (D-09)
 *
 * True when the touch is still waiting on a human AND its send slot is inside
 * the threshold or already past it. Both comparisons are INCLUSIVE, decided
 * once here rather than three times at three call sites:
 *
 *   - exactly at the boundary (`scheduled_at === now + 4h`) is STALLED. The
 *     alternative reserves the alert for the tick after, which on a per-minute
 *     tick is a distinction with no operational meaning and one more edge for a
 *     future reader to get wrong.
 *   - already past the slot is stalled too, and emphatically: a touch whose
 *     slot was yesterday is the worst case this predicate exists to catch, not
 *     an expired one to be excluded. (The engine's own D-10/D-11 re-window pass
 *     is what eventually retires it; until it does, it is still waiting on a
 *     human and still counted.)
 *
 * NOT filtered on cadence state, matching the queue's population rule: a paused
 * cadence's unapproved draft is still unapproved, and hiding it would make
 * "nothing is wrong" and "nothing is visible" render identically.
 */
export function isStalled(touch: StallableTouch, now: Date): boolean {
  if (!(STALLABLE_TOUCH_STATUSES as readonly string[]).includes(touch.status)) {
    return false;
  }
  return touch.scheduledAt.getTime() <= stallBoundary(now).getTime();
}

/*
 * `selectStalled` USED TO SIT HERE, AND ONLY ITS OWN TEST CALLED IT (WR-09).
 *
 * It was `touches.filter(isStalled)` under a header arguing that the digest set
 * must NOT be filtered on `stall_alerted_at` — the once-only guard belongs to
 * the IMMEDIATE alert (D-11), and applying it to the 06:30 digest would mail an
 * empty digest every morning while the queue grew.
 *
 * That argument is real and it is still written down; it is written down where
 * the rule is actually ENFORCED, on `forAllTenants_stalledTally`, which is a
 * read-only SQL predicate with no alert-state term. The digest never had rows
 * in memory to filter. A helper whose only caller is its own test does not
 * cover a rule — it describes one, in a second place, which is how the two
 * eventually disagree.
 */

/**
 * The 06-UI-SPEC tier table, as a function (D-12).
 *
 *   overdue   — the slot has arrived or passed        → `.badge--error`
 *   due_soon  — inside `STALL_THRESHOLD_HOURS`        → `.badge--warn`
 *   scheduled — otherwise                             → neutral `.badge`
 *
 * `overdue` is tested FIRST, so a slot exactly at `now` is overdue rather than
 * due-soon: both branches match at that instant and the more urgent reading is
 * the honest one. The `due_soon` boundary is the same inclusive comparison
 * `isStalled` makes, via the same helper — the tier and the predicate agree by
 * construction, not by two authors having read the same table.
 *
 * Takes a slot rather than a touch because the tier is a property of TIME
 * alone: an `approved` touch has an urgency too (the queue does not show it,
 * the pipeline in 06-05 does), while `isStalled` is about work waiting on a
 * person.
 */
export type UrgencyTier = 'overdue' | 'due_soon' | 'scheduled';

export function deriveUrgency(scheduledAt: Date, now: Date): UrgencyTier {
  const slot = scheduledAt.getTime();
  if (slot <= now.getTime()) return 'overdue';
  if (slot <= stallBoundary(now).getTime()) return 'due_soon';
  return 'scheduled';
}

/**
 * The tier labels, as a MAP — never `.replace('_', ' ')` (house rule, 06-UI-SPEC
 * §Typography). A member added to `UrgencyTier` without a label here is a
 * compile error rather than a `due_soon` rendered at an operator in snake_case.
 */
export const URGENCY_LABELS: Record<UrgencyTier, string> = {
  overdue: 'overdue',
  due_soon: 'due soon',
  scheduled: 'scheduled',
};

/**
 * HOW FAR AWAY THE SLOT IS, IN WORDS, WITH NO TIMEZONE IN IT.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS LIVES BESIDE `deriveUrgency` BECAUSE THE TWO MUST AGREE (WR-05).    │
 * │ It used to live in `queue/page.tsx`, whose header claimed the badge and  │
 * │ this sentence "cannot say different things about one slot" because both  │
 * │ come from the same clock. One clock was never enough: the sentence       │
 * │ rounded the difference to whole MINUTES before testing its sign, so a    │
 * │ slot twenty seconds in the FUTURE printed `overdue` beside an amber      │
 * │ `due_soon` badge. Same clock, different question.                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * A comment asking two functions in two files to agree is what this module
 * exists to replace with a compiler and a test. So the sign test below is the
 * IDENTICAL comparison `deriveUrgency` makes, on raw milliseconds, and it
 * happens before any coarsening — and both are now one `readFileSync` away from
 * each other in the suite that pins them.
 *
 * ── COARSE ON PURPOSE, AND EVERY DIVISION FLOORS ────────────────────────────
 *
 * Minutes below an hour, hours below a day, then days. The decision this
 * supports is "which of these do I read first"; a queue reporting "due in 2h
 * 47m" would invite an operator to believe a precision the schedule's jitter
 * does not have.
 *
 * `Math.round` on the hour branch rounded UP — a slot 91 minutes away rendered
 * "due in 2h", overstating the time the operator has, on the one screen whose
 * purpose is deciding what to do first. Flooring understates it instead, which
 * is the safe direction. `Math.max(1, …)` keeps the minute branch off "due in
 * 0m", which is not a thing to tell anybody.
 */
export function relativeToSlot(scheduledAt: Date, now: Date): string {
  const ms = scheduledAt.getTime() - now.getTime();
  // CHARACTER FOR CHARACTER `deriveUrgency`'s first line. A slot exactly at
  // `now` is overdue in both, and neither rounds before asking.
  if (ms <= 0) return 'overdue';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `due in ${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `due in ${hours}h`;
  return `due in ${Math.floor(hours / 24)}d`;
}
