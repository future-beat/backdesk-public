/**
 * The two cadence state machines (CAD-03), as pure TOTAL functions.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE STATE MACHINE IS THE PRODUCT. This file is the whole of it.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * FRAMEWORK-FREE ON PURPOSE, and database-free too. Nothing here imports from
 * `next/*` or from the repository; it takes a status and an event and returns
 * what should happen. That is what lets `tests/cadence-transitions.test.ts`
 * enumerate every cell without a Postgres connection, which is the only way a
 * matrix this size gets asserted at all.
 *
 * ── WHY THE MATRIX IS CLOSED, AND WHY THERE IS NO `default: throw` ──────────
 *
 * Five cadence statuses × twelve events, and six touch statuses × five events.
 * Both vocabularies are `as const` arrays that also back CHECK constraints in
 * migration 0017, so the products are finite and known. Every pair is
 * enumerated below and every branch RETURNS.
 *
 * A `default` that throws would turn an unconsidered cell into a runtime crash
 * inside a tick; a `default` that returns null would turn it into silence.
 * Phase 2 already paid for the second one: the research skeleton's transition
 * classifier returned null for `Unsuccessful → Work Order`, the single most
 * valuable event this product can detect, and nothing anywhere went red. So
 * there is no default of either kind. If a member is added to a vocabulary,
 * TypeScript stops compiling this file — which is the failure mode we want.
 *
 * ── CELLS THAT DELIBERATELY DIFFER FROM THE NAIVE EXPECTATION ───────────────
 *
 *   1. `won`/`lost`/`removed`/`reopened` STOP A PAUSED CADENCE, not just an
 *      active one. Decided-quote dominance: a pause is about a conversation, a
 *      stop is about the quote. If a pause protected a cadence from its own
 *      quote being decided, then lifting the pause weeks later would revive a
 *      chase for a job the tradie already won — the single worst message this
 *      product can send.
 *
 *   2. `client_resumed` CANNOT LIFT A `customer_reply` PAUSE (D-05). Only
 *      `operator_resumed` can. A tradie tapping "resume messaging" must not
 *      silently restart a cadence aimed at somebody who is mid-conversation
 *      with them; that reads as the service ignoring the reply.
 *
 *   3. `client_paused` ARRIVING AT A `customer_reply` PAUSE IS A NO-OP, and
 *      `customer_reply` arriving at a `client_paused` pause UPGRADES the reason.
 *      Both directions preserve the same invariant: once a customer has
 *      replied, only a human resumes. Downgrading the reason would hand the
 *      client a lever D-05 reserves for the operator.
 *
 *   4. `reopened` STOPS the cadence rather than restarting it (D-08). A reopen
 *      means the tradie is back in ServiceM8 renegotiating; the quote returns to
 *      the operator's triage queue and only a fresh human decision starts a NEW
 *      cadence. This cell is defensive in practice — an earlier `won`/`lost`
 *      usually stopped the cadence already — and it is enumerated because
 *      "usually" is not a guarantee.
 *
 *   5. `all_touches_done` AT A PAUSED CADENCE IS A NO-OP. Completing it would
 *      clear it off the operator's queue and discard the fact that a human still
 *      owes it an answer.
 *
 *   6. A `paused` row with NO recorded reason resumes only for an operator. The
 *      schema permits that row and no writer in this codebase produces one; the
 *      two readings are not equally safe, and the cheap mistake is making a
 *      human click.
 *
 *   7. THE PAUSE REASONS ARE ORDERED BY STICKINESS (D-07, Phase 5):
 *
 *          customer_reply  >  client_paused  >  onboarding
 *
 *      An event that lands a stickier reason at a weaker pause UPGRADES it; the
 *      reverse never happens, and NOTHING may ever be written INTO `onboarding`
 *      as an upgrade target. Note 3 is the first two terms of this order; the
 *      third is the ONB-03 activation gate.
 *
 *      `onboarding` is weakest because its unlock is the BROADEST AUTOMATIC one:
 *      approving the template set resumes every onboarding-paused cadence the
 *      tenant has, in one write, with no human looking at any individual
 *      conversation. The other two reasons carry a specific human signal about a
 *      specific cadence — this customer wrote back, this client pulled the
 *      handbrake — and a bulk approval must not be able to override either.
 *
 *      So `customer_reply` at an onboarding pause upgrades (a later approval
 *      cannot revive a live conversation), and `client_paused` upgrades too (a
 *      later approval cannot restart a client who explicitly asked to stop).
 *      The survivable failure of the second upgrade is that a client who resumes
 *      while templates are STILL unapproved gets an active cadence — and nothing
 *      unreviewed can send from it, because the drafting pass refuses without an
 *      approved template and every touch parks in `needs_draft` (D-10).
 *
 *      AND THE GATE HOLDS AGAINST AN OPERATOR RESUME. `operator_resumed` is a
 *      no-op at an onboarding pause — the only cell in this file where a human's
 *      explicit resume does not move a paused cadence. D-05 reserves the resume
 *      to a human because a pause records a JUDGEMENT somebody should be allowed
 *      to overrule; this pause records a MISSING FACT (no client-approved words
 *      exist), and no amount of authority conjures the words. Approval is the
 *      one unlock, which is ONB-03 stated as a matrix cell rather than as a
 *      disabled button.
 *
 * ── WHAT THIS FILE DOES NOT DECIDE ──────────────────────────────────────────
 *
 * Everything about the world. It does not read the database, does not know
 * whether a cadence exists, does not check suppression, contact hours, pause
 * flags or quote status, and NEVER WRITES ANYTHING. Callers own all of that:
 * `consume-events.ts` applies an outcome as a guarded UPDATE whose WHERE clause
 * is the idempotence mechanism, and `dispatch.ts` re-asks every permission
 * question inside its claim transaction. Keeping the gates in the callers is
 * what lets these two functions stay pure and total.
 */
import {
  type CadencePauseReason,
  type CadenceStatus,
  type CadenceStopReason,
} from '@/db/schema/cadences';
import { type TouchSkipReason, type TouchStatus } from '@/db/schema/cadence-touches';

// ─────────────────────────────────────────────────────────────────────────────
// Vocabularies
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Everything that can happen TO a cadence. Closed, and ordered by origin:
 *
 *  customer_reply    — the customer wrote back (Phase 4 inbound)
 *  won / lost /
 *  removed / reopened— the Phase 2 outbox, `quote_status_events.event_type`.
 *                      These four names are deliberately IDENTICAL to their
 *                      `QUOTE_EVENT_TYPES` members so the mapping in
 *                      `consume-events.ts` is a statement of fact rather than a
 *                      translation. (`quote_opened` has no member here: it
 *                      CREATES a cadence rather than transitioning one.)
 *  contact_killed    — D-06/D-15 per-contact suppression, terminal
 *  client_paused /
 *  client_resumed    — D-06's reversible per-client kill switch
 *  operator_resumed  — the explicit human resume D-05 reserves
 *  operator_closed   — the D-16 operator kill switch
 *  expired_deadline  — D-12, raised by the tick rather than by anybody
 *  all_touches_done  — every touch reached a terminal state
 */
export const CADENCE_EVENTS = [
  'customer_reply',
  'won',
  'lost',
  'removed',
  'reopened',
  'contact_killed',
  'client_paused',
  'client_resumed',
  'operator_resumed',
  'operator_closed',
  'expired_deadline',
  'all_touches_done',
] as const;
export type CadenceEvent = (typeof CADENCE_EVENTS)[number];

/**
 * Everything that can happen to a TOUCH — the D-14 lifecycle, one step per
 * event.
 *
 *  draft_due        — the draft lead window opened (scheduled → needs_draft)
 *  drafted          — Phase 5 wrote copy (needs_draft → pending_approval)
 *  approval_granted — a human said yes (pending_approval → approved)
 *  send_recorded    — the ledger claim was won and the sender invoked
 *  skip             — carries the TOUCH_SKIP_REASON that decided it
 *
 * The event names are distinct from the STATUS names on purpose: `approved` is
 * a place a touch is, `approval_granted` is a thing that happened to it, and a
 * matrix whose rows and columns share names is one nobody can read.
 *
 * PHASE 3 DOES NOT DRIVE THESE ONE AT A TIME. `touches.promoteDue` compresses
 * `scheduled → approved` into a single statement because both gates auto-pass
 * (D-14, stubbed). This machine is the specification Phases 5 and 6 implement
 * against; shipping it now is what makes those phases a replacement of one
 * repository method rather than a migration of live cadences.
 */
export const TOUCH_EVENTS = [
  'draft_due',
  'drafted',
  'approval_granted',
  'send_recorded',
  'skip',
] as const;
export type TouchEvent = (typeof TOUCH_EVENTS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Result shapes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The two columns the cadence machine reasons over, exactly as the row holds
 * them. `pauseReason` is `null` whenever the cadence is not paused — and the
 * caller passes the row, so an impossible combination (an `active` row still
 * carrying a pause reason) reaches here rather than being sanitized away. Both
 * functions are total over those too.
 */
export interface CadenceState {
  status: CadenceStatus;
  pauseReason: CadencePauseReason | null;
}

/**
 * A discriminated union, per the house rule ("result unions, never throws,
 * closed vocabularies" — every caller switches on `kind`).
 *
 * `noop` IS NOT AN ERROR. It is the machine saying "this event reached a state
 * where it changes nothing", which is the ordinary outcome of a replayed event
 * and of a terminal cadence. It carries a sentence because that sentence is
 * what an operator reads when they ask why nothing happened.
 *
 * `move` always states BOTH reason columns explicitly, including the nulls: a
 * stop clears the pause, because "paused, and also stopped" is a row with two
 * answers to "why is nothing being sent".
 */
export type CadenceOutcome =
  | {
      kind: 'move';
      status: CadenceStatus;
      pauseReason: CadencePauseReason | null;
      stopReason: CadenceStopReason | null;
    }
  | { kind: 'noop'; noop: string };

/**
 * A touch event, with its reason where the reason decides something.
 *
 * THE SKIP REASON IS REQUIRED AND IS NEVER DEFAULTED. Every member of
 * `TOUCH_SKIP_REASONS` is a rule that decided a skip, and Phase 7 reads the
 * column as evidence; a machine that supplied its own fallback would write a
 * true-looking statement that no rule actually made. So `skip` cannot be
 * constructed without naming the rule, and the type system is what enforces it.
 */
export type TouchEventInput =
  | { event: Exclude<TouchEvent, 'skip'>; reason?: undefined }
  | { event: 'skip'; reason: TouchSkipReason };

export type TouchOutcome =
  | { kind: 'move'; status: TouchStatus; skipReason: TouchSkipReason | null }
  | { kind: 'noop'; noop: string };

// ─────────────────────────────────────────────────────────────────────────────
// The cadence machine
// ─────────────────────────────────────────────────────────────────────────────

function move(
  status: CadenceStatus,
  pauseReason: CadencePauseReason | null,
  stopReason: CadenceStopReason | null,
): CadenceOutcome {
  return { kind: 'move', status, pauseReason, stopReason };
}

function noop(why: string): CadenceOutcome {
  return { kind: 'noop', noop: why };
}

/** Stops that reach a live cadence from ANY live state. See header note 1. */
function stop(reason: CadenceStopReason): CadenceOutcome {
  return move('stopped', null, reason);
}

/** The row for `status = 'active'`. */
function fromActive(event: CadenceEvent): CadenceOutcome {
  switch (event) {
    case 'customer_reply':
      // D-05. A human is mid-conversation with the tradie; the machine stands
      // down and only a human starts it again.
      return move('paused', 'customer_reply', null);

    case 'won':
      return stop('won');
    case 'lost':
      return stop('lost');
    case 'removed':
      // D-08. The job no longer exists upstream.
      return stop('removed');
    case 'reopened':
      // D-08. A reopen is a renegotiation, not a restart — see header note 4.
      return stop('reopened');
    case 'contact_killed':
      // D-06/D-15. Suppression is TERMINAL, never a pause: the human asked us
      // to stop, and a pause is a thing that can be resumed.
      return stop('contact_suppressed');
    case 'operator_closed':
      return stop('operator_closed');

    case 'client_paused':
      return move('paused', 'client_paused', null);

    case 'client_resumed':
    case 'operator_resumed':
      // Nothing to resume. Treating this as a move would re-window a schedule
      // that never slipped, i.e. rewrite send times for no reason.
      return noop('the cadence is already active; there is no pause to lift');

    case 'expired_deadline':
      // D-12. Expiry is its own terminal status and NOT a stop reason: nobody
      // decided this, time did, and the report should be able to tell.
      return move('expired', null, null);

    case 'all_touches_done':
      return move('completed', null, null);
  }
}

/**
 * The rows for `status = 'paused'` — all three reasons and the unreadable one.
 *
 * Every branch below reads `pauseReason` directly rather than through a
 * normalizing default, because the null case has a DIFFERENT safe answer for
 * different events: `customer_reply` should record the reason it now knows,
 * while `client_resumed` should refuse. A single fallback could only get one of
 * those right (header note 6).
 */
function fromPaused(
  pauseReason: CadencePauseReason | null,
  event: CadenceEvent,
): CadenceOutcome {
  switch (event) {
    case 'won':
      return stop('won');
    case 'lost':
      return stop('lost');
    case 'removed':
      return stop('removed');
    case 'reopened':
      return stop('reopened');
    case 'contact_killed':
      return stop('contact_suppressed');
    case 'operator_closed':
      // The kill switch reaches a paused cadence, or a pause is a hiding place.
      return stop('operator_closed');

    case 'customer_reply':
      // Already the stickiest pause → nothing changes. Otherwise UPGRADE: see
      // header notes 3 and 7. Leaving `client_paused` in place here would let the
      // client's own resume restart messaging at somebody mid-conversation, and
      // leaving `onboarding` in place would let a TEMPLATE APPROVAL do the same
      // — a bulk write nobody performed while looking at this conversation.
      return pauseReason === 'customer_reply'
        ? noop('already paused for a customer reply; a further reply changes nothing')
        : move('paused', 'customer_reply', null);

    case 'client_paused':
      // UPGRADES ONLY FROM `onboarding`, never downgrades (header note 7). At a
      // `customer_reply` pause the reason is stickier; at an unreadable pause we
      // cannot prove it is safe to make it liftable; at a `client_paused` pause
      // it is already this.
      //
      // The onboarding arm exists because the two pauses have DIFFERENT unlocks
      // and leaving the weaker one in place loses the client's instruction: a
      // template approval would auto-resume a cadence its client explicitly
      // asked to stop, and the client would never learn their handbrake had been
      // released by somebody else's paperwork.
      return pauseReason === 'onboarding'
        ? move('paused', 'client_paused', null)
        : noop(
            'the cadence is already paused, and a client pause never replaces an existing reason',
          );

    case 'client_resumed':
      // D-05 VERBATIM: no automated resume after a live conversation. And a
      // client resume must not open the ONB-03 activation gate either — the
      // reason it stays shut is different, so the sentence is different.
      if (pauseReason === 'client_paused') return move('active', null, null);
      return noop(
        pauseReason === 'onboarding'
          ? 'this client has no approved template set yet, so there is nothing to send; ' +
              'approving the templates is what resumes this cadence (ONB-03)'
          : 'only an operator may lift this pause: a client-level resume cannot end a ' +
              'conversation the customer started (D-05)',
      );

    case 'operator_resumed':
      // The explicit human action D-05 reserves. Callers then re-window (D-07),
      // because every touch that fell due during the pause is now overdue.
      //
      // THE ONE EXCEPTION IS THE ACTIVATION GATE (header note 7). An operator
      // resume cannot lift an `onboarding` pause: the other pauses record a
      // judgement a human may overrule, this one records that no client-approved
      // words exist, and resuming would activate a cadence whose every touch
      // would then park unsent in `needs_draft` anyway — with the console
      // showing "running". Approval is the only unlock (ONB-03, T-5-10).
      return pauseReason === 'onboarding'
        ? noop(
            'an operator resume cannot open the onboarding gate: this client has no ' +
              'approved template set, and approving it is the one thing that resumes ' +
              'these cadences (ONB-03)',
          )
        : move('active', null, null);

    case 'expired_deadline':
      // D-12 keeps running through a pause: a cadence parked for six weeks is
      // not a conversation any more.
      return move('expired', null, null);

    case 'all_touches_done':
      // Header note 5.
      return noop(
        'a paused cadence stays paused: completing it would clear it off the operator ' +
          'queue and discard the fact that a human still owes it an answer',
      );
  }
}

/**
 * What a cadence in `state` does when `event` reaches it.
 *
 * TOTAL: every (status, pauseReason, event) triple returns. Never throws.
 *
 * @param state the row's two columns, as stored — including combinations the
 *              schema permits and no writer produces
 * @param event a member of `CADENCE_EVENTS`
 */
export function cadenceTransition(state: CadenceState, event: CadenceEvent): CadenceOutcome {
  switch (state.status) {
    case 'active':
      return fromActive(event);

    case 'paused':
      return fromPaused(state.pauseReason, event);

    case 'stopped':
    case 'completed':
    case 'expired':
      // TERMINAL MEANS TERMINAL, and the tempting exceptions are the dangerous
      // ones. A replayed `won` must not overwrite the reason a cadence actually
      // stopped for — Phase 7 computes recovered revenue from that column. A
      // resume must not revive a decided quote. Re-chasing a stopped cadence is
      // a NEW cadence from a NEW anchor, created by operator re-triage, which
      // the partial unique index on `cadences` explicitly permits.
      return noop(
        `a ${state.status} cadence is terminal; '${event}' is recorded elsewhere but moves nothing here`,
      );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The touch machine
// ─────────────────────────────────────────────────────────────────────────────

function touchMove(status: TouchStatus, skipReason: TouchSkipReason | null): TouchOutcome {
  return { kind: 'move', status, skipReason };
}

function touchNoop(why: string): TouchOutcome {
  return { kind: 'noop', noop: why };
}

/**
 * What a touch in `status` does when `input` reaches it.
 *
 * TOTAL over `TOUCH_STATUSES × TOUCH_EVENTS`. Never throws.
 *
 * THE PROMOTION EVENTS ADVANCE EXACTLY ONE STEP EACH, from their immediate
 * predecessor only. `send_recorded` is accepted from `approved` and from
 * nowhere else, which is the whole of the D-14 gate expressed as a matrix cell:
 * a touch that was never approved cannot be recorded as sent, so the ledger can
 * never claim a message went out through a gate it did not pass.
 *
 * `sent` and `skipped` are terminal. Skipping a `sent` touch would assert that a
 * message which went out never did, and un-skipping one would overwrite the
 * reason that actually decided it.
 */
export function touchTransition(status: TouchStatus, input: TouchEventInput): TouchOutcome {
  // Terminal first, so the promotion rows below only ever describe live touches.
  if (status === 'sent' || status === 'skipped') {
    return touchNoop(
      `a ${status} touch is terminal; '${input.event}' cannot change what the ledger already records`,
    );
  }

  if (input.event === 'skip') {
    // Any UNSENT touch may be skipped, carrying the caller's reason verbatim.
    return touchMove('skipped', input.reason);
  }

  switch (input.event) {
    case 'draft_due':
      return status === 'scheduled'
        ? touchMove('needs_draft', null)
        : touchNoop(
            'the touch has already surfaced for drafting; re-surfacing would reset the ' +
              'draft-aging clock CON-04 is measured from',
          );

    case 'drafted':
      return status === 'needs_draft'
        ? touchMove('pending_approval', null)
        : touchNoop(
            status === 'scheduled'
              ? 'the draft lead window has not opened; a draft here would skip the step that ' +
                'makes the touch visible to a human'
              : 'the touch is already drafted; a second draft would silently replace text a ' +
                'human is looking at or has already approved',
          );

    case 'approval_granted':
      return status === 'pending_approval'
        ? touchMove('approved', null)
        : touchNoop(
            status === 'approved'
              ? 'already approved'
              : 'there is no draft to approve yet — approving a message that does not exist is ' +
                'the one thing the approval gate must refuse',
          );

    case 'send_recorded':
      return status === 'approved'
        ? touchMove('sent', null)
        : touchNoop(
            'only an approved touch may be recorded as sent; anything else would put a message ' +
              'in the ledger that passed no gate',
          );
  }
}
