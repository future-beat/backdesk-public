/**
 * "WHAT NEEDS ME, FOR THIS CLIENT?" — ANSWERED ONCE (CON-02, D-18/D-19/D-20).
 *
 * The client page is the pipeline view (D-17). Its ordering is the whole
 * product of that page: an operator opening a client on a phone between two
 * jobs gets one screenful, and what lands in it decides whether they act on the
 * right quote. So the ordering is DATA and the rank is a FUNCTION, both
 * exported, both asserted in `tests/pipeline-grouping.test.ts` — a grouping
 * that can only be checked by rendering a page and reading it is a grouping
 * nobody checks.
 *
 * ── THE STALLED FACET IS NOT A SECOND OPINION (D-12) ────────────────────────
 *
 * `needs attention` includes "a draft is about to miss its send slot", and that
 * question already has an answer: `isStalled` in `src/core/aging/stall-policy`.
 * It is IMPORTED, never re-derived. The number 4 does not appear in this file
 * and must not: the nav badge, the queue's urgency tier, the stall alert email
 * and this group heading are five renderings of one predicate, and five answers
 * would teach an operator that none of them mean anything.
 *
 * ── FRAMEWORK-FREE AND DB-FREE (source-asserted) ────────────────────────────
 *
 * No `next/*`, no `@/db/*`. The inputs are plain snapshots a page builds from
 * its RLS-scoped reads, a fixture builds from three literals, and a future
 * report builds from a service-role read. A derivation reachable only through a
 * React server component is a derivation whose edges get decided by whichever
 * caller was written first.
 *
 * ── NOTHING HERE CARRIES A MESSAGE BODY, EXCEPT WHERE IT MUST (T-6-21) ──────
 *
 * `ReplyEvidence` has a `body`, because the quote page's conversation section —
 * inside the operator gate — renders it verbatim. `lastActivity`, which feeds
 * the pipeline's compact chips, returns a shape WITH NO BODY FIELD AT ALL. A
 * chip cannot leak a customer's words because the value it is handed does not
 * contain any; that is a stronger guarantee than a convention asking a `.map()`
 * not to reach for one.
 */
import { isStalled } from '@/core/aging/stall-policy';

/* ------------------------------------------------------------------------- *
 * The vocabulary this module reads
 * ------------------------------------------------------------------------- */

/**
 * The one ServiceM8 status that means "still open, still chaseable".
 *
 * Written as the OPEN member rather than as a list of the closed three, so a
 * status ServiceM8 adds later reads as closed rather than silently joining the
 * chaseable groups. Closed is the safe default; chasing a job we do not
 * understand the state of is the failure that embarrasses a client.
 */
export const OPEN_QUOTE_STATUS = 'Quote';

/** Awaiting an operator's triage decision — `quotes.chase_eligibility`. */
const NEEDS_TRIAGE_ELIGIBILITY = 'needs_review';

/** Cadence lifecycle members that mean this quote's chasing is over. */
const CLOSED_CADENCE_STATUSES = ['stopped', 'completed', 'expired'] as const;

/** A touch that has already resolved — nothing further will happen to it. */
const TERMINAL_TOUCH_STATUSES = ['sent', 'skipped'] as const;

/**
 * The touch statuses that mean somebody — the operator or the dispatch pass —
 * has near-term work on this quote. A touch only reaches any of them once
 * `promoteDue` has moved it off `scheduled`, so these are due-or-past by
 * construction rather than by a second time comparison here.
 */
const IN_FLIGHT_TOUCH_STATUSES = ['needs_draft', 'pending_approval', 'approved'] as const;

/* ------------------------------------------------------------------------- *
 * Snapshots — the smallest shapes that answer the question
 * ------------------------------------------------------------------------- */

/** The touch facts the pipeline reads. Deliberately no draft, no body. */
export interface TouchSnapshot {
  touchNumber: number;
  /** One of `TOUCH_STATUSES`. Typed as a string — this module imports no schema. */
  status: string;
  /** The stored send instant, never recomputed. */
  scheduledAt: Date;
}

/** The current cadence for a quote, or `null` when none was ever created. */
export interface CadenceSnapshot {
  /** One of `CADENCE_STATUSES`. */
  status: string;
  pauseReason: string | null;
  stopReason: string | null;
}

export interface QuoteSnapshot {
  /** One of `QUOTE_STATUSES` — the mirrored ServiceM8 status. */
  quoteStatus: string;
  /** One of `CHASE_ELIGIBILITIES`. */
  chaseEligibility: string;
  cadence: CadenceSnapshot | null;
  touches: readonly TouchSnapshot[];
}

/* ------------------------------------------------------------------------- *
 * D-18: the groups, in action order
 * ------------------------------------------------------------------------- */

/**
 * THE ORDER IS DATA, AND THE RENDER AND THE TESTS SHARE IT.
 *
 * A page that spelled the order out in JSX and a suite that spelled it out in
 * an `expect` would be two statements of one decision, and the pair stays
 * correct exactly until somebody reorders one of them. `groupRank` evaluates
 * its cases in THIS order and returns the first match, so the array is the rule
 * rather than a description of it.
 */
export const PIPELINE_GROUPS = ['needs_attention', 'chasing', 'waiting', 'closed'] as const;
export type PipelineGroup = (typeof PIPELINE_GROUPS)[number];

/**
 * Headings, 06-UI-SPEC Copywriting Contract verbatim, as a `Record` over the
 * union — a fifth group added later is a compile error here rather than a
 * snake_case h3 on an operator's phone (the house map rule).
 */
export const PIPELINE_GROUP_HEADINGS: Record<PipelineGroup, string> = {
  needs_attention: 'Needs attention',
  chasing: 'Chasing',
  waiting: 'Waiting',
  closed: 'Closed',
};

function isTerminalTouch(touch: TouchSnapshot): boolean {
  return (TERMINAL_TOUCH_STATUSES as readonly string[]).includes(touch.status);
}

/**
 * THE THREE FACETS OF "NEEDS ATTENTION", and they are unrelated problems.
 *
 *  - a PAUSED cadence, for any reason: onboarding-gated, client-paused, or a
 *    customer reply that only a human may restart (D-05). All three are a
 *    sequence that has stopped moving and is waiting on a person.
 *  - a quote still AWAITING TRIAGE: the operator has not yet said whether this
 *    one may be chased at all, and the triage checklist further down the page
 *    is where they say so.
 *  - a STALLED touch, via the shared predicate: a draft is inside its threshold
 *    and nobody has approved it.
 *
 * The triage facet is asked only of an OPEN quote, matching the existing page
 * rule: `needs review` beside a job won in June reads as an outstanding task
 * and is not one.
 *
 * The stalled facet is NOT filtered on cadence state, exactly as `isStalled`
 * itself is not. An unapproved touch on a stopped cadence still produced a
 * stall alert, and that alert points the operator at this page — the quote must
 * be findable in the group the email sent them to look in.
 */
function needsAttention(snapshot: QuoteSnapshot, now: Date): boolean {
  if (snapshot.cadence?.status === 'paused') return true;

  if (
    snapshot.quoteStatus === OPEN_QUOTE_STATUS &&
    snapshot.chaseEligibility === NEEDS_TRIAGE_ELIGIBILITY
  ) {
    return true;
  }

  return snapshot.touches.some((touch) => isStalled(touch, now));
}

/**
 * Closed = the quote left the open state upstream, OR the cadence reached one
 * of its terminal lifecycle members.
 *
 * Both halves are needed and neither implies the other. A won job's cadence is
 * stopped by the next tick and not before, so a quote marked `Work Order`
 * thirty seconds ago still carries a live cadence — reading it as `Chasing`
 * would put a finished job in the group the operator scans for work. And a
 * cadence stopped for `contact_suppressed` sits on a quote that is still
 * `Quote` upstream and will stay that way.
 */
function isClosed(snapshot: QuoteSnapshot): boolean {
  if (snapshot.quoteStatus !== OPEN_QUOTE_STATUS) return true;
  const status = snapshot.cadence?.status;
  return status !== undefined && (CLOSED_CADENCE_STATUSES as readonly string[]).includes(status);
}

/** An active cadence with a promoted touch — somebody has work on it now. */
function isChasing(snapshot: QuoteSnapshot): boolean {
  if (snapshot.cadence?.status !== 'active') return false;
  return snapshot.touches.some((touch) =>
    (IN_FLIGHT_TOUCH_STATUSES as readonly string[]).includes(touch.status),
  );
}

/**
 * WHICH GROUP THIS QUOTE BELONGS IN (D-18).
 *
 * Cases are evaluated in `PIPELINE_GROUPS` order and the FIRST match wins, so
 * the action order and the rank cannot come apart. `waiting` is the fall-through
 * rather than a fourth test: an open quote with no cadence yet is waiting (the
 * consumer creates one on the next tick), and an active cadence with nothing
 * promoted is waiting too — both are "we are on it, nothing for you to do".
 */
export function groupRank(snapshot: QuoteSnapshot, now: Date): PipelineGroup {
  if (needsAttention(snapshot, now)) return 'needs_attention';
  if (isClosed(snapshot)) return 'closed';
  if (isChasing(snapshot)) return 'chasing';
  return 'waiting';
}

/* ------------------------------------------------------------------------- *
 * D-20: the next touch, and the week's load
 * ------------------------------------------------------------------------- */

/**
 * The states a next touch can be in, as the operator reads them.
 *
 * `stalled` is not a touch status — it is the shared predicate's answer, and it
 * WINS over the underlying status. That mirrors `deriveUrgency` testing
 * `overdue` before `due_soon`: when two readings are both true, the more urgent
 * one is the honest one. An operator who needs to know the difference between a
 * stalled `needs_draft` and a stalled `pending_approval` is one tap from the
 * quote page, which says.
 *
 * `scheduled` is the fifth member and the 06-UI-SPEC copy row lists four. It is
 * here because it is the MAJORITY state of everything in `Waiting` — a touch the
 * engine has not promoted yet — and the alternative to naming it is a next-touch
 * line that renders a bare separator or a raw column value.
 */
export const NEXT_TOUCH_STATES = [
  'stalled',
  'pending_approval',
  'needs_draft',
  'approved',
  'scheduled',
] as const;
export type NextTouchState = (typeof NEXT_TOUCH_STATES)[number];

/** 06-UI-SPEC Copywriting, verbatim. `Record`-typed for the house map rule. */
export const NEXT_TOUCH_STATE_LABELS: Record<NextTouchState, string> = {
  stalled: 'stalled',
  pending_approval: 'awaiting approval',
  needs_draft: 'no draft yet',
  approved: 'approved',
  scheduled: 'scheduled',
};

export interface NextTouch {
  touchNumber: number;
  scheduledAt: Date;
  state: NextTouchState;
}

function stateOf(touch: TouchSnapshot, now: Date): NextTouchState {
  if (isStalled(touch, now)) return 'stalled';
  if (touch.status === 'pending_approval') return 'pending_approval';
  if (touch.status === 'needs_draft') return 'needs_draft';
  if (touch.status === 'approved') return 'approved';
  return 'scheduled';
}

/**
 * THE EARLIEST TOUCH THAT HAS NOT RESOLVED — what happens next on this quote.
 *
 * Terminal touches are excluded rather than sorted past: a cadence whose first
 * three touches sent is asking "and then what", and the answer is touch four.
 * `null` when nothing is left, which is a real state (an exhausted cadence the
 * completion sweep has not closed yet) and renders as no next-touch line rather
 * than as an em-dash pretending to be one.
 *
 * Ties break on `touchNumber` ascending. Two touches CAN share a slot — the
 * D-10 re-window pass moves several at once — and a next-touch line that swaps
 * between two renders is one an operator cannot trust.
 */
export function nextTouchForQuote(
  touches: readonly TouchSnapshot[],
  now: Date,
): NextTouch | null {
  let best: TouchSnapshot | null = null;

  for (const touch of touches) {
    if (isTerminalTouch(touch)) continue;
    if (best === null) {
      best = touch;
      continue;
    }
    const delta = touch.scheduledAt.getTime() - best.scheduledAt.getTime();
    if (delta < 0 || (delta === 0 && touch.touchNumber < best.touchNumber)) {
      best = touch;
    }
  }

  if (best === null) return null;
  return {
    touchNumber: best.touchNumber,
    scheduledAt: best.scheduledAt,
    state: stateOf(best, now),
  };
}

/**
 * The horizon "this week" means, and the same horizon the next-touch line
 * switches from a relative label to a wall-clock slot at. One constant asked
 * twice rather than two sevens that agree until one of them changes.
 */
export const WEEK_HORIZON_DAYS = 7;

const MS_PER_DAY = 86_400_000;

/** `now + 7 days`, exported so the boundary is computed in exactly one place. */
export function weekHorizon(now: Date): Date {
  return new Date(now.getTime() + WEEK_HORIZON_DAYS * MS_PER_DAY);
}

/**
 * "{n} touches scheduled this week" (D-20).
 *
 * INCLUSIVE at exactly seven days, and it counts OVERDUE touches too. An
 * overdue unapproved touch is still work this week — it is the work most in
 * need of a person — and a summary line that excluded it would shrink on
 * exactly the morning it should grow. Same argument `isStalled` makes about a
 * slot that was yesterday, one level up.
 */
export function weeklyTouchCount(touches: readonly TouchSnapshot[], now: Date): number {
  const horizon = weekHorizon(now).getTime();
  return touches.filter(
    (touch) => !isTerminalTouch(touch) && touch.scheduledAt.getTime() <= horizon,
  ).length;
}

/* ------------------------------------------------------------------------- *
 * Relative time — one clock, computed on the server
 * ------------------------------------------------------------------------- */

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

/**
 * "in 3 hours" / "2 days ago", from the render's single `now`.
 *
 * PURE AND SERVER-SIDE, for 06-03's reason: a label computed in a client
 * component uses the browser's clock at hydration, and a row rendered at 3:59
 * that hydrates at 4:01 would disagree with the stall alert that was sent about
 * it. The page derives this once and passes the string down.
 *
 * No zone is involved and none is needed — a difference between two instants is
 * the same number of hours in Perth and in Sydney. Absolute times on these
 * surfaces go through `formatInTenantZone` and are covered by the zone-note.
 */
export function formatRelative(at: Date, now: Date): string {
  const delta = at.getTime() - now.getTime();
  const ahead = delta >= 0;
  const magnitude = Math.abs(delta);

  const label =
    magnitude < MS_PER_MINUTE
      ? null
      : magnitude < MS_PER_HOUR
        ? plural(Math.floor(magnitude / MS_PER_MINUTE), 'minute')
        : magnitude < MS_PER_DAY
          ? plural(Math.floor(magnitude / MS_PER_HOUR), 'hour')
          : plural(Math.floor(magnitude / MS_PER_DAY), 'day');

  if (label === null) return ahead ? 'in under a minute' : 'just now';
  return ahead ? `in ${label}` : `${label} ago`;
}

/* ------------------------------------------------------------------------- *
 * D-19: the conversation, merged
 * ------------------------------------------------------------------------- */

/**
 * One message WE sent, from the send ledger.
 *
 * No body: the ledger does not store one and this shape must not grow one. What
 * was sent is the frozen `final_body` on the draft, and the quote page renders
 * the schedule beside this thread.
 */
export interface SentEvidence {
  kind: 'sent';
  id: string;
  touchNumber: number;
  at: Date;
  channel: string;
  /** `SEND_LEDGER_OUTCOMES` member, or `null` when nothing was recorded. */
  outcome: string | null;
  /** `DELIVERY_STATUSES` member, or `null` when no receipt has arrived. */
  deliveryStatus: string | null;
}

/**
 * One reply FROM the customer.
 *
 * `body` IS carried, and this is the one shape in the module that carries one.
 * Its only consumer is the quote-detail page, which is inside the operator gate
 * — the same argument the inbox's header makes for the same bytes. It must
 * never reach a chip, a log line or an email (T-2-02, T-6-21).
 */
export interface ReplyEvidence {
  kind: 'reply';
  id: string;
  at: Date;
  channel: string;
  body: string;
  /** `INBOUND_LABELS` member, or `null` when not yet classified. */
  label: string | null;
}

export type ConversationEntry = SentEvidence | ReplyEvidence;

/**
 * SENT AND REPLIED, INTERLEAVED, OLDEST FIRST (D-19).
 *
 * A conversation read newest-first is a conversation nobody can follow: the
 * reply arrives above the message it answers. Oldest-first is how every
 * messaging surface a tradie has ever used renders, and it is what makes the
 * thread legible without labels saying which way time runs.
 *
 * TIEBREAK, in order: same instant → the SENT row first, because a reply cannot
 * precede the message it answers and a provider timestamp rounded to the second
 * can make it look like it did; then by `id`, so two rows written in one
 * transaction do not swap places between renders.
 */
export function mergeConversation(
  sent: readonly SentEvidence[],
  replies: readonly ReplyEvidence[],
): ConversationEntry[] {
  const entries: ConversationEntry[] = [...sent, ...replies];

  return entries.sort((a, b) => {
    const delta = a.at.getTime() - b.at.getTime();
    if (delta !== 0) return delta;
    if (a.kind !== b.kind) return a.kind === 'sent' ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * The pipeline's compact chips (D-19) — INDICATORS, NEVER CONTENT.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE RETURN TYPE HAS NO BODY FIELD. That is the mitigation for T-6-21,    │
 * │ not the comment above it: a chip cannot render a customer's words        │
 * │ because the value the row is handed does not contain any.                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Both halves are `null` when the fact does not exist, and the page renders no
 * chip for a `null`. A placeholder chip ("no replies yet") on every row is
 * noise that trains the eye past the rows that DO carry one — the opposite of
 * what an indicator is for. This is the same call the nav badge makes by hiding
 * its zero, and the opposite of the one `Needs attention` makes by always
 * rendering: a heading that vanishes loses the "done" reading, a chip that
 * vanishes does not.
 */
export interface LastActivity {
  lastSentAt: Date | null;
  lastReply: { at: Date; label: string | null } | null;
}

/**
 * ITS PARAMETERS ARE STRUCTURAL, AND DELIBERATELY NARROWER THAN THE EVIDENCE
 * TYPES ABOVE.
 *
 * `{ at }` and `{ at, label }` — no `body`, no `id`, no address. `SentEvidence`
 * and `ReplyEvidence` satisfy them, so the quote page can pass its merged thread
 * straight in; but the CLIENT page does not build those at all. Its reads never
 * name the `body` column, and this signature is why they do not have to: there
 * is nowhere for a body to go.
 */
export function lastActivity(
  sent: readonly { at: Date }[],
  replies: readonly { at: Date; label: string | null }[],
): LastActivity {
  let lastSentAt: Date | null = null;
  let lastReply: { at: Date; label: string | null } | null = null;

  for (const row of sent) {
    if (lastSentAt === null || row.at.getTime() >= lastSentAt.getTime()) {
      lastSentAt = row.at;
    }
  }

  for (const row of replies) {
    if (lastReply === null || row.at.getTime() >= lastReply.at.getTime()) {
      lastReply = { at: row.at, label: row.label };
    }
  }

  return { lastSentAt, lastReply };
}
