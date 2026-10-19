/**
 * CAD-03: the two cadence state machines, enumerated rather than sampled.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE TABLE BELOW IS WRITTEN BY HAND, CELL BY CELL, ON PURPOSE.            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Phase 2's won/lost gap was not a bug in a rule — it was a cell nobody had
 * looked at. The research skeleton returned null for `Unsuccessful → Work Order`
 * and for `Work Order → Unsuccessful`, and nothing anywhere went red; the only
 * symptom would have been a recovered-revenue figure that looked slightly low.
 * `tests/transitions.test.ts` fixed that by making the TEST the table, and this
 * suite applies the same discipline to the machine CAD-03 is stated about.
 *
 * So every expectation here is a LITERAL, decided by a human, with the reason
 * written beside it. Nothing is computed from a rule — a table generated from
 * the same rule the implementation uses proves only that the rule is
 * self-consistent, which is precisely the property a missing cell already has.
 *
 * Three assertions guard the table itself:
 *
 *   1. COMPLETENESS — the declared state rows × the full event vocabulary must
 *      all be present, so deleting a row shrinks coverage loudly rather than
 *      silently.
 *   2. TOTALITY — every (status, pauseReason, event) triple returns a
 *      well-formed outcome and never throws, including the combinations the
 *      matrix does not enumerate because the database cannot hold them.
 *   3. DECIDED-QUOTE DOMINANCE — the four closing events give the SAME stop
 *      reason from `active` and from both pauses. `consume-events.ts` relies on
 *      that identity: its guarded UPDATE covers every live cadence at once and
 *      cannot know each row's status, so it derives the reason from `active`.
 *
 * NO DATABASE. These are pure functions over closed vocabularies, exactly as
 * CLAUDE.md requires ("test it exhaustively, no mocks of Postgres needed for
 * pure transition logic"), so this suite runs on a bare `npm test`.
 */
import { describe, expect, it } from 'vitest';

import {
  CADENCE_EVENTS,
  TOUCH_EVENTS,
  cadenceTransition,
  touchTransition,
  type CadenceEvent,
  type CadenceState,
  type TouchEvent,
  type TouchEventInput,
} from '@/core/cadence/transitions';
import {
  CADENCE_PAUSE_REASONS,
  CADENCE_STATUSES,
  CADENCE_STOP_REASONS,
  type CadencePauseReason,
  type CadenceStatus,
  type CadenceStopReason,
} from '@/db/schema/cadences';
import {
  TOUCH_SKIP_REASONS,
  TOUCH_STATUSES,
  type TouchSkipReason,
  type TouchStatus,
} from '@/db/schema/cadence-touches';

// ─────────────────────────────────────────────────────────────────────────────
// The cadence machine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A `noop` expectation asserts the KIND and that a reason string was supplied —
 * never the exact wording. The wording is documentation for whoever reads a log;
 * pinning it here would make rephrasing a comment a test failure, and a suite
 * that is expensive to keep green is a suite people stop keeping green.
 */
type ExpectedCadence =
  | {
      kind: 'move';
      status: CadenceStatus;
      pauseReason: CadencePauseReason | null;
      stopReason: CadenceStopReason | null;
    }
  | { kind: 'noop' };

interface CadenceCell {
  from: CadenceState;
  event: CadenceEvent;
  expect: ExpectedCadence;
  why: string;
}

const CADENCE_MATRIX: CadenceCell[] = [
  // ══ active ════════════════════════════════════════════════════════════════
  //
  // The ordinary live cadence. Everything that can happen to a quote arrives
  // here first, and this row is the one a naive implementation gets right.
  {
    from: { status: 'active', pauseReason: null },
    event: 'customer_reply',
    expect: { kind: 'move', status: 'paused', pauseReason: 'customer_reply', stopReason: null },
    why: 'D-05: a human is mid-conversation with the tradie; the machine stands down',
  },
  {
    from: { status: 'active', pauseReason: null },
    event: 'won',
    expect: { kind: 'move', status: 'stopped', pauseReason: null, stopReason: 'won' },
    why: 'the job was awarded — chasing it again is the worst message this product can send',
  },
  {
    from: { status: 'active', pauseReason: null },
    event: 'lost',
    expect: { kind: 'move', status: 'stopped', pauseReason: null, stopReason: 'lost' },
    why: 'the quote was declined; the reason is kept distinct from won because Phase 7 attributes on it',
  },
  {
    from: { status: 'active', pauseReason: null },
    event: 'removed',
    expect: { kind: 'move', status: 'stopped', pauseReason: null, stopReason: 'removed' },
    why: 'D-08: the job no longer exists upstream, so there is nothing left to chase',
  },
  {
    from: { status: 'active', pauseReason: null },
    event: 'reopened',
    expect: { kind: 'move', status: 'stopped', pauseReason: null, stopReason: 'reopened' },
    why: 'D-08: a reopen is a renegotiation, not a restart — the operator re-triages it',
  },
  {
    from: { status: 'active', pauseReason: null },
    event: 'contact_killed',
    expect: {
      kind: 'move',
      status: 'stopped',
      pauseReason: null,
      stopReason: 'contact_suppressed',
    },
    why: 'D-06/D-15: suppression is terminal, never a pause — the human asked us to stop, full stop',
  },
  {
    from: { status: 'active', pauseReason: null },
    event: 'client_paused',
    expect: { kind: 'move', status: 'paused', pauseReason: 'client_paused', stopReason: null },
    why: 'D-06: the reversible per-client kill switch',
  },
  {
    from: { status: 'active', pauseReason: null },
    event: 'client_resumed',
    expect: { kind: 'noop' },
    why: 'nothing to resume; a resume that reset an active cadence would re-window a schedule that never slipped',
  },
  {
    from: { status: 'active', pauseReason: null },
    event: 'operator_resumed',
    expect: { kind: 'noop' },
    why: 'same — an operator resuming a cadence that is already running changes nothing',
  },
  {
    from: { status: 'active', pauseReason: null },
    event: 'operator_closed',
    expect: {
      kind: 'move',
      status: 'stopped',
      pauseReason: null,
      stopReason: 'operator_closed',
    },
    why: 'the D-16 kill switch; terminal, and recorded as a human decision',
  },
  {
    from: { status: 'active', pauseReason: null },
    event: 'expired_deadline',
    expect: { kind: 'move', status: 'expired', pauseReason: null, stopReason: null },
    why: 'D-12: expiry is its own terminal status, not a stop reason — nobody decided this, time did',
  },
  {
    from: { status: 'active', pauseReason: null },
    event: 'all_touches_done',
    expect: { kind: 'move', status: 'completed', pauseReason: null, stopReason: null },
    why: 'the cadence ran its course; completed is distinguishable from stopped for the report',
  },

  // ══ paused (customer_reply) ═══════════════════════════════════════════════
  //
  // THE STICKY PAUSE. D-05 is explicit that only a human lifts it, and this row
  // is where that promise is actually kept. Read it against the `client_paused`
  // row below: the two differ in exactly two cells, and those two cells are the
  // whole of D-05.
  {
    from: { status: 'paused', pauseReason: 'customer_reply' },
    event: 'customer_reply',
    expect: { kind: 'noop' },
    why: 'a second reply in the same conversation changes nothing — already paused for this reason',
  },
  {
    from: { status: 'paused', pauseReason: 'customer_reply' },
    event: 'won',
    expect: { kind: 'move', status: 'stopped', pauseReason: null, stopReason: 'won' },
    why: 'DECIDED-QUOTE DOMINANCE: a decided quote stops mid-pause, or a later resume revives a dead chase',
  },
  {
    from: { status: 'paused', pauseReason: 'customer_reply' },
    event: 'lost',
    expect: { kind: 'move', status: 'stopped', pauseReason: null, stopReason: 'lost' },
    why: 'same dominance — the pause is about the conversation, the stop is about the quote',
  },
  {
    from: { status: 'paused', pauseReason: 'customer_reply' },
    event: 'removed',
    expect: { kind: 'move', status: 'stopped', pauseReason: null, stopReason: 'removed' },
    why: 'a deleted job cannot be chased whether or not somebody replied',
  },
  {
    from: { status: 'paused', pauseReason: 'customer_reply' },
    event: 'reopened',
    expect: { kind: 'move', status: 'stopped', pauseReason: null, stopReason: 'reopened' },
    why: 'D-08 triage outranks the pause; the operator decides what happens next',
  },
  {
    from: { status: 'paused', pauseReason: 'customer_reply' },
    event: 'contact_killed',
    expect: {
      kind: 'move',
      status: 'stopped',
      pauseReason: null,
      stopReason: 'contact_suppressed',
    },
    why: 'suppression is terminal from every live state — a pause is still a cadence that could resume',
  },
  {
    from: { status: 'paused', pauseReason: 'customer_reply' },
    event: 'client_paused',
    expect: { kind: 'noop' },
    why: 'THE STICKIER REASON WINS: overwriting with client_paused would make a client resume able to lift it',
  },
  {
    from: { status: 'paused', pauseReason: 'customer_reply' },
    event: 'client_resumed',
    expect: { kind: 'noop' },
    why: 'D-05 verbatim: no automated resume after a live conversation — a client-level resume cannot lift this',
  },
  {
    from: { status: 'paused', pauseReason: 'customer_reply' },
    event: 'operator_resumed',
    expect: { kind: 'move', status: 'active', pauseReason: null, stopReason: null },
    why: 'the explicit human action D-05 reserves this to; callers then re-window (D-07)',
  },
  {
    from: { status: 'paused', pauseReason: 'customer_reply' },
    event: 'operator_closed',
    expect: {
      kind: 'move',
      status: 'stopped',
      pauseReason: null,
      stopReason: 'operator_closed',
    },
    why: 'the kill switch reaches a paused cadence too, or a pause would be a hiding place',
  },
  {
    from: { status: 'paused', pauseReason: 'customer_reply' },
    event: 'expired_deadline',
    expect: { kind: 'move', status: 'expired', pauseReason: null, stopReason: null },
    why: 'D-12: a cadence parked in a pause for six weeks is not a conversation any more',
  },
  {
    from: { status: 'paused', pauseReason: 'customer_reply' },
    event: 'all_touches_done',
    expect: { kind: 'noop' },
    why:
      'DELIBERATE: completing a paused cadence would clear it off the operator queue and discard the ' +
      'reason a human still owes it an answer',
  },

  // ══ paused (client_paused) ════════════════════════════════════════════════
  //
  // D-06's reversible kill switch. Differs from the row above ONLY in
  // `customer_reply` (which upgrades the reason) and `client_resumed` (which is
  // allowed to lift this one).
  {
    from: { status: 'paused', pauseReason: 'client_paused' },
    event: 'customer_reply',
    expect: { kind: 'move', status: 'paused', pauseReason: 'customer_reply', stopReason: null },
    why:
      'UPGRADE, not a no-op: leaving client_paused here would let the client resume and restart ' +
      'messaging at somebody mid-conversation, which is the exact thing D-05 forbids',
  },
  {
    from: { status: 'paused', pauseReason: 'client_paused' },
    event: 'won',
    expect: { kind: 'move', status: 'stopped', pauseReason: null, stopReason: 'won' },
    why: 'decided-quote dominance again — a pause never protects a cadence from its quote being decided',
  },
  {
    from: { status: 'paused', pauseReason: 'client_paused' },
    event: 'lost',
    expect: { kind: 'move', status: 'stopped', pauseReason: null, stopReason: 'lost' },
    why: 'same',
  },
  {
    from: { status: 'paused', pauseReason: 'client_paused' },
    event: 'removed',
    expect: { kind: 'move', status: 'stopped', pauseReason: null, stopReason: 'removed' },
    why: 'same',
  },
  {
    from: { status: 'paused', pauseReason: 'client_paused' },
    event: 'reopened',
    expect: { kind: 'move', status: 'stopped', pauseReason: null, stopReason: 'reopened' },
    why: 'same — and the quote goes back to triage, which is a caller write, not this function',
  },
  {
    from: { status: 'paused', pauseReason: 'client_paused' },
    event: 'contact_killed',
    expect: {
      kind: 'move',
      status: 'stopped',
      pauseReason: null,
      stopReason: 'contact_suppressed',
    },
    why: 'terminal from every live state',
  },
  {
    from: { status: 'paused', pauseReason: 'client_paused' },
    event: 'client_paused',
    expect: { kind: 'noop' },
    why: 'already paused for this reason; a second flip of the switch is not a state change',
  },
  {
    from: { status: 'paused', pauseReason: 'client_paused' },
    event: 'client_resumed',
    expect: { kind: 'move', status: 'active', pauseReason: null, stopReason: null },
    why: 'D-06: the client pause is the reversible one, and the client may reverse it',
  },
  {
    from: { status: 'paused', pauseReason: 'client_paused' },
    event: 'operator_resumed',
    expect: { kind: 'move', status: 'active', pauseReason: null, stopReason: null },
    why: 'an operator may lift either pause (D-07); the asymmetry runs the other way',
  },
  {
    from: { status: 'paused', pauseReason: 'client_paused' },
    event: 'operator_closed',
    expect: {
      kind: 'move',
      status: 'stopped',
      pauseReason: null,
      stopReason: 'operator_closed',
    },
    why: 'the kill switch reaches a paused cadence',
  },
  {
    from: { status: 'paused', pauseReason: 'client_paused' },
    event: 'expired_deadline',
    expect: { kind: 'move', status: 'expired', pauseReason: null, stopReason: null },
    why: 'D-12 does not stop running because a client paused; the quote still goes cold',
  },
  {
    from: { status: 'paused', pauseReason: 'client_paused' },
    event: 'all_touches_done',
    expect: { kind: 'noop' },
    why: 'as above: a paused cadence stays visible as paused until somebody resumes or closes it',
  },

  // ══ paused (onboarding) ═══════════════════════════════════════════════════
  //
  // THE ONB-03 ACTIVATION GATE (D-07). A cadence born paused because its client
  // has no approved template set: nothing went wrong, nobody chose it, and the
  // only thing missing is words. Read it against the two rows above — it differs
  // in exactly THREE cells, and those three cells are the whole of the gate:
  //
  //   client_paused    upgrades here, and is a no-op at the other two pauses
  //   client_resumed   no-ops here for a DIFFERENT reason than at the reply pause
  //   operator_resumed NO-OPS HERE, and moves at every other paused row in this
  //                    file. That single cell is ONB-03: approval is the one
  //                    unlock, and not even the operator is an exception.
  {
    from: { status: 'paused', pauseReason: 'onboarding' },
    event: 'customer_reply',
    expect: { kind: 'move', status: 'paused', pauseReason: 'customer_reply', stopReason: null },
    why:
      'UPGRADE: a template approval resumes every onboarding-paused cadence in one write, and ' +
      'must not be able to revive a conversation a customer is in the middle of',
  },
  {
    from: { status: 'paused', pauseReason: 'onboarding' },
    event: 'won',
    expect: { kind: 'move', status: 'stopped', pauseReason: null, stopReason: 'won' },
    why: 'decided-quote dominance reaches the third pause too — the gate is not a hiding place',
  },
  {
    from: { status: 'paused', pauseReason: 'onboarding' },
    event: 'lost',
    expect: { kind: 'move', status: 'stopped', pauseReason: null, stopReason: 'lost' },
    why: 'same',
  },
  {
    from: { status: 'paused', pauseReason: 'onboarding' },
    event: 'removed',
    expect: { kind: 'move', status: 'stopped', pauseReason: null, stopReason: 'removed' },
    why: 'same — a deleted job is not waiting for anybody to approve a template',
  },
  {
    from: { status: 'paused', pauseReason: 'onboarding' },
    event: 'reopened',
    expect: { kind: 'move', status: 'stopped', pauseReason: null, stopReason: 'reopened' },
    why: 'same; the quote returns to triage and may earn a NEW cadence once the words exist',
  },
  {
    from: { status: 'paused', pauseReason: 'onboarding' },
    event: 'contact_killed',
    expect: {
      kind: 'move',
      status: 'stopped',
      pauseReason: null,
      stopReason: 'contact_suppressed',
    },
    why:
      'terminal from every live state — a human who asked us to stop before we ever sent them ' +
      'anything must not be reached by the approval that lifts this pause',
  },
  {
    from: { status: 'paused', pauseReason: 'onboarding' },
    event: 'client_paused',
    expect: { kind: 'move', status: 'paused', pauseReason: 'client_paused', stopReason: null },
    why:
      'THE ONE PLACE A CLIENT PAUSE UPGRADES ANYTHING (note 7): leaving `onboarding` here would ' +
      'let a template approval release a handbrake the client pulled themselves',
  },
  {
    from: { status: 'paused', pauseReason: 'onboarding' },
    event: 'client_resumed',
    expect: { kind: 'noop' },
    why: 'a client resume cannot open the activation gate; there are still no approved words',
  },
  {
    from: { status: 'paused', pauseReason: 'onboarding' },
    event: 'operator_resumed',
    expect: { kind: 'noop' },
    why:
      'ONB-03 / T-5-10, AND THE ONLY PAUSED CELL IN THIS FILE WHERE AN OPERATOR RESUME DOES ' +
      'NOTHING: the other pauses record a judgement a human may overrule, this one records that ' +
      'no client-approved words exist, and authority does not conjure words',
  },
  {
    from: { status: 'paused', pauseReason: 'onboarding' },
    event: 'operator_closed',
    expect: {
      kind: 'move',
      status: 'stopped',
      pauseReason: null,
      stopReason: 'operator_closed',
    },
    why:
      'THE KILL SWITCH IS NOT GATED. An operator may always stop a chase; what they may not do ' +
      'is start one. Refusing both would be symmetry bought at the price of a kill switch',
  },
  {
    from: { status: 'paused', pauseReason: 'onboarding' },
    event: 'expired_deadline',
    expect: { kind: 'move', status: 'expired', pauseReason: null, stopReason: null },
    why:
      'D-12 keeps running: a quote that sat six weeks waiting for its client to approve a ' +
      'template is cold, and pretending otherwise would chase it the day approval lands',
  },
  {
    from: { status: 'paused', pauseReason: 'onboarding' },
    event: 'all_touches_done',
    expect: { kind: 'noop' },
    why: 'as with the other pauses — and its touches cannot terminate by being sent anyway',
  },

  // ══ paused (no recorded reason) ═══════════════════════════════════════════
  //
  // A row the schema permits and no writer in this codebase produces. It is
  // enumerated anyway because "uninterpretable" has two readings and only one of
  // them is safe: resume it and we may message somebody mid-conversation;
  // refuse to resume it automatically and the worst case is an operator has to
  // click. The row below is that choice, made once, here.
  {
    from: { status: 'paused', pauseReason: null },
    event: 'customer_reply',
    expect: { kind: 'move', status: 'paused', pauseReason: 'customer_reply', stopReason: null },
    why: 'records the reason we actually know, turning an uninterpretable row into an auditable one',
  },
  {
    from: { status: 'paused', pauseReason: null },
    event: 'won',
    expect: { kind: 'move', status: 'stopped', pauseReason: null, stopReason: 'won' },
    why: 'a stop needs no interpretation of why the cadence was paused',
  },
  {
    from: { status: 'paused', pauseReason: null },
    event: 'lost',
    expect: { kind: 'move', status: 'stopped', pauseReason: null, stopReason: 'lost' },
    why: 'same',
  },
  {
    from: { status: 'paused', pauseReason: null },
    event: 'removed',
    expect: { kind: 'move', status: 'stopped', pauseReason: null, stopReason: 'removed' },
    why: 'same',
  },
  {
    from: { status: 'paused', pauseReason: null },
    event: 'reopened',
    expect: { kind: 'move', status: 'stopped', pauseReason: null, stopReason: 'reopened' },
    why: 'same',
  },
  {
    from: { status: 'paused', pauseReason: null },
    event: 'contact_killed',
    expect: {
      kind: 'move',
      status: 'stopped',
      pauseReason: null,
      stopReason: 'contact_suppressed',
    },
    why: 'same',
  },
  {
    from: { status: 'paused', pauseReason: null },
    event: 'client_paused',
    expect: { kind: 'noop' },
    why: 'refuses to DOWNGRADE an unreadable pause into one a client can lift',
  },
  {
    from: { status: 'paused', pauseReason: null },
    event: 'client_resumed',
    expect: { kind: 'noop' },
    why: 'the safe reading: we cannot prove this was a client pause, so a client may not lift it',
  },
  {
    from: { status: 'paused', pauseReason: null },
    event: 'operator_resumed',
    expect: { kind: 'move', status: 'active', pauseReason: null, stopReason: null },
    why: 'a human looking at the row can always resume it — that is what makes the safe reading cheap',
  },
  {
    from: { status: 'paused', pauseReason: null },
    event: 'operator_closed',
    expect: {
      kind: 'move',
      status: 'stopped',
      pauseReason: null,
      stopReason: 'operator_closed',
    },
    why: 'same',
  },
  {
    from: { status: 'paused', pauseReason: null },
    event: 'expired_deadline',
    expect: { kind: 'move', status: 'expired', pauseReason: null, stopReason: null },
    why: 'same',
  },
  {
    from: { status: 'paused', pauseReason: null },
    event: 'all_touches_done',
    expect: { kind: 'noop' },
    why: 'same as the other pauses',
  },

  // ══ stopped ═══════════════════════════════════════════════════════════════
  //
  // TERMINAL MEANS TERMINAL. Every cell here is a no-op, and each one is worth a
  // line because the tempting exception — "surely a `won` should overwrite a
  // `lost`?" — is exactly how a replayed event rewrites the reason Phase 7
  // computes recovered revenue from.
  {
    from: { status: 'stopped', pauseReason: null },
    event: 'customer_reply',
    expect: { kind: 'noop' },
    why: 'D-05: a reply to a stopped cadence changes nothing — Phase 4 records it, the machine does not move',
  },
  {
    from: { status: 'stopped', pauseReason: null },
    event: 'won',
    expect: { kind: 'noop' },
    why: 'a replayed win must not overwrite the reason a cadence actually stopped for',
  },
  {
    from: { status: 'stopped', pauseReason: null },
    event: 'lost',
    expect: { kind: 'noop' },
    why: 'same, and the direction that matters most: a lost must never overwrite a recorded won',
  },
  {
    from: { status: 'stopped', pauseReason: null },
    event: 'removed',
    expect: { kind: 'noop' },
    why: 'a job deleted after it was won is still a win as far as this cadence is concerned',
  },
  {
    from: { status: 'stopped', pauseReason: null },
    event: 'reopened',
    expect: { kind: 'noop' },
    why: 'the reopen triage is a QUOTE write; the already-stopped cadence stays as it is',
  },
  {
    from: { status: 'stopped', pauseReason: null },
    event: 'contact_killed',
    expect: { kind: 'noop' },
    why: 'suppression still writes its own row; this cadence is already sending nothing',
  },
  {
    from: { status: 'stopped', pauseReason: null },
    event: 'client_paused',
    expect: { kind: 'noop' },
    why: 'pausing something terminal is meaningless',
  },
  {
    from: { status: 'stopped', pauseReason: null },
    event: 'client_resumed',
    expect: { kind: 'noop' },
    why: 'A STOP IS NOT REVERSIBLE — a resume that revived it would chase a decided quote',
  },
  {
    from: { status: 'stopped', pauseReason: null },
    event: 'operator_resumed',
    expect: { kind: 'noop' },
    why: 'not even an operator: restarting a stopped cadence is a NEW cadence, created by re-triage',
  },
  {
    from: { status: 'stopped', pauseReason: null },
    event: 'operator_closed',
    expect: { kind: 'noop' },
    why: 'already closed; re-closing would replace the real reason with operator_closed',
  },
  {
    from: { status: 'stopped', pauseReason: null },
    event: 'expired_deadline',
    expect: { kind: 'noop' },
    why: 'a stopped cadence cannot later expire — the stop already explains why nothing is sent',
  },
  {
    from: { status: 'stopped', pauseReason: null },
    event: 'all_touches_done',
    expect: { kind: 'noop' },
    why: 'the touches were skipped by the stop; that is not the cadence running its course',
  },

  // ══ completed ═════════════════════════════════════════════════════════════
  {
    from: { status: 'completed', pauseReason: null },
    event: 'customer_reply',
    expect: { kind: 'noop' },
    why: 'a reply after the last touch is a Phase 4 conversation, not a cadence transition',
  },
  {
    from: { status: 'completed', pauseReason: null },
    event: 'won',
    expect: { kind: 'noop' },
    why: 'the win is attributed from the ledger and the quote, not by re-stopping a finished cadence',
  },
  {
    from: { status: 'completed', pauseReason: null },
    event: 'lost',
    expect: { kind: 'noop' },
    why: 'same',
  },
  {
    from: { status: 'completed', pauseReason: null },
    event: 'removed',
    expect: { kind: 'noop' },
    why: 'same',
  },
  {
    from: { status: 'completed', pauseReason: null },
    event: 'reopened',
    expect: { kind: 'noop' },
    why: 'the quote returns to triage; the finished cadence keeps its history',
  },
  {
    from: { status: 'completed', pauseReason: null },
    event: 'contact_killed',
    expect: { kind: 'noop' },
    why: 'nothing left to suppress here — the suppression row governs future cadences',
  },
  {
    from: { status: 'completed', pauseReason: null },
    event: 'client_paused',
    expect: { kind: 'noop' },
    why: 'terminal',
  },
  {
    from: { status: 'completed', pauseReason: null },
    event: 'client_resumed',
    expect: { kind: 'noop' },
    why: 'terminal',
  },
  {
    from: { status: 'completed', pauseReason: null },
    event: 'operator_resumed',
    expect: { kind: 'noop' },
    why: 'terminal — re-chasing means a new cadence from a new anchor',
  },
  {
    from: { status: 'completed', pauseReason: null },
    event: 'operator_closed',
    expect: { kind: 'noop' },
    why: 'closing a completed cadence would relabel a cadence that ran as one somebody killed',
  },
  {
    from: { status: 'completed', pauseReason: null },
    event: 'expired_deadline',
    expect: { kind: 'noop' },
    why: 'it finished before the deadline; expiry cannot retro-apply',
  },
  {
    from: { status: 'completed', pauseReason: null },
    event: 'all_touches_done',
    expect: { kind: 'noop' },
    why: 'already completed — the idempotence cell for the completion pass itself',
  },

  // ══ expired ═══════════════════════════════════════════════════════════════
  {
    from: { status: 'expired', pauseReason: null },
    event: 'customer_reply',
    expect: { kind: 'noop' },
    why: 'D-12 is terminal; a late reply is a Phase 4 conversation, not a revival',
  },
  {
    from: { status: 'expired', pauseReason: null },
    event: 'won',
    expect: { kind: 'noop' },
    why: 'a quote won after expiry is still attributable from the ledger; the cadence stays expired',
  },
  {
    from: { status: 'expired', pauseReason: null },
    event: 'lost',
    expect: { kind: 'noop' },
    why: 'same',
  },
  {
    from: { status: 'expired', pauseReason: null },
    event: 'removed',
    expect: { kind: 'noop' },
    why: 'same',
  },
  {
    from: { status: 'expired', pauseReason: null },
    event: 'reopened',
    expect: { kind: 'noop' },
    why: 'the quote goes back to triage and may earn a NEW cadence; this one is finished',
  },
  {
    from: { status: 'expired', pauseReason: null },
    event: 'contact_killed',
    expect: { kind: 'noop' },
    why: 'terminal',
  },
  {
    from: { status: 'expired', pauseReason: null },
    event: 'client_paused',
    expect: { kind: 'noop' },
    why: 'terminal',
  },
  {
    from: { status: 'expired', pauseReason: null },
    event: 'client_resumed',
    expect: { kind: 'noop' },
    why: 'terminal — an expired cadence is six weeks stale and must never burst back to life',
  },
  {
    from: { status: 'expired', pauseReason: null },
    event: 'operator_resumed',
    expect: { kind: 'noop' },
    why: 'terminal; re-chasing is a new cadence from a new anchor',
  },
  {
    from: { status: 'expired', pauseReason: null },
    event: 'operator_closed',
    expect: { kind: 'noop' },
    why: 'relabelling an expiry as a human decision would tell Phase 7 somebody chose this',
  },
  {
    from: { status: 'expired', pauseReason: null },
    event: 'expired_deadline',
    expect: { kind: 'noop' },
    why: 'already expired — the idempotence cell for the expiry sweep',
  },
  {
    from: { status: 'expired', pauseReason: null },
    event: 'all_touches_done',
    expect: { kind: 'noop' },
    why: 'the touches were skipped by expiry; that is not the cadence running its course',
  },
];

/** The state rows the matrix enumerates, as keys. */
const DECLARED_STATE_ROWS = [
  'active|null',
  'paused|customer_reply',
  'paused|client_paused',
  'paused|onboarding',
  'paused|null',
  'stopped|null',
  'completed|null',
  'expired|null',
] as const;

function stateKey(state: CadenceState): string {
  return `${state.status}|${state.pauseReason ?? 'null'}`;
}

function label(cell: CadenceCell): string {
  const to =
    cell.expect.kind === 'noop'
      ? 'noop'
      : `${cell.expect.status}` +
        (cell.expect.pauseReason ? `(${cell.expect.pauseReason})` : '') +
        (cell.expect.stopReason ? `(${cell.expect.stopReason})` : '');

  return `${stateKey(cell.from)} + ${cell.event} -> ${to}`;
}

describe('cadenceTransition — the full (status x event) matrix (CAD-03)', () => {
  for (const cell of CADENCE_MATRIX) {
    it(`${label(cell)} — ${cell.why}`, () => {
      const actual = cadenceTransition(cell.from, cell.event);

      if (cell.expect.kind === 'noop') {
        expect(actual.kind).toBe('noop');
        // A no-op must still SAY why. This is the string that ends up in an
        // operator-facing explanation of "nothing happened".
        if (actual.kind === 'noop') expect(actual.noop.length).toBeGreaterThan(0);
        return;
      }

      expect(actual).toEqual(cell.expect);
    });
  }

  it('enumerates every declared state row against every event — no cell is unasserted', () => {
    // Without this, deleting a block above would silently shrink coverage and
    // every remaining test would still pass — the blind spot this suite exists
    // to remove, reintroduced by an editor rather than by an author.
    const covered = new Set(CADENCE_MATRIX.map((c) => `${stateKey(c.from)}::${c.event}`));

    expect(CADENCE_EVENTS.length).toBe(12);
    expect(CADENCE_MATRIX.length).toBe(DECLARED_STATE_ROWS.length * CADENCE_EVENTS.length);

    for (const row of DECLARED_STATE_ROWS) {
      for (const event of CADENCE_EVENTS) {
        expect(covered, `matrix cell ${row}::${event} is not asserted`).toContain(
          `${row}::${event}`,
        );
      }
    }

    // Every status in the vocabulary appears in at least one declared row, so a
    // status added to CADENCE_STATUSES without a row here fails immediately.
    for (const status of CADENCE_STATUSES) {
      expect(
        DECLARED_STATE_ROWS.some((row) => row.startsWith(`${status}|`)),
        `status '${status}' has no row in the matrix`,
      ).toBe(true);
    }

    // AND EVERY PAUSE REASON, for the reason 05-01 demonstrated: a member was
    // appended to CADENCE_PAUSE_REASONS and this suite stayed green, because the
    // totality test below asserts only that every triple RETURNS — which a
    // vocabulary member with no hand-decided row satisfies trivially by falling
    // through somebody else's branch. Totality is not coverage. This is the
    // assertion that makes adding a reason without deciding its twelve cells a
    // failure at the moment the vocabulary changes.
    for (const reason of CADENCE_PAUSE_REASONS) {
      expect(
        DECLARED_STATE_ROWS.some((row) => row === `paused|${reason}`),
        `pause reason '${reason}' has no row in the matrix`,
      ).toBe(true);
    }
  });

  it('is TOTAL — every (status, pauseReason, event) triple returns a well-formed outcome', () => {
    // Including the combinations the matrix does not enumerate because the
    // database cannot hold them (an `active` row carrying a pause reason, a
    // `stopped` row that still remembers one). A total function has no inputs it
    // was not designed for; that is what makes "no default: throw" safe.
    const pauseReasons: Array<CadencePauseReason | null> = [null, ...CADENCE_PAUSE_REASONS];

    for (const status of CADENCE_STATUSES) {
      for (const pauseReason of pauseReasons) {
        for (const event of CADENCE_EVENTS) {
          const outcome = cadenceTransition({ status, pauseReason }, event);

          expect(
            outcome,
            `cadenceTransition({${status}, ${pauseReason}}, ${event}) returned nothing`,
          ).toBeDefined();

          if (outcome.kind === 'noop') {
            expect(typeof outcome.noop).toBe('string');
            expect(outcome.noop.length).toBeGreaterThan(0);
            continue;
          }

          // Every field must be a member of the vocabulary the CHECK constraints
          // in migration 0017 enforce — a value outside them produces a row no
          // `status = …` predicate ever matches, and nothing goes red.
          expect(CADENCE_STATUSES).toContain(outcome.status);
          if (outcome.pauseReason !== null) {
            expect(CADENCE_PAUSE_REASONS).toContain(outcome.pauseReason);
          }
          if (outcome.stopReason !== null) {
            expect(CADENCE_STOP_REASONS).toContain(outcome.stopReason);
          }

          // The two reason columns are mutually exclusive by construction: a row
          // that is both "paused because" and "stopped because" has two answers
          // to the only question either column exists to answer.
          expect(outcome.pauseReason === null || outcome.stopReason === null).toBe(true);
          if (outcome.status === 'paused') expect(outcome.pauseReason).not.toBeNull();
          if (outcome.status === 'stopped') expect(outcome.stopReason).not.toBeNull();
          if (outcome.status === 'active' || outcome.status === 'completed') {
            expect(outcome.pauseReason).toBeNull();
            expect(outcome.stopReason).toBeNull();
          }
        }
      }
    }
  });

  it('NEVER prescribes `onboarding` as an outcome — the gate is entered by birth, not by event', () => {
    // ONB-03 / note 7, asserted over the WHOLE input space rather than over the
    // cells somebody remembered to write down. `onboarding` means "this client
    // has never had an approved template set", which is a fact about the tenant
    // that no event happening to one cadence can create. The only writer is
    // `consume-events.ts`, at creation, before the cadence has any history.
    //
    // This is also the downgrade-impossibility half of the stickiness order:
    // if nothing can MOVE to `onboarding`, then no path exists from the two
    // stickier reasons back down into the one a template approval can lift.
    for (const status of CADENCE_STATUSES) {
      for (const pauseReason of [null, ...CADENCE_PAUSE_REASONS]) {
        for (const event of CADENCE_EVENTS) {
          const outcome = cadenceTransition({ status, pauseReason }, event);
          if (outcome.kind !== 'move') continue;

          expect(
            outcome.pauseReason,
            `cadenceTransition({${status}, ${pauseReason}}, ${event}) prescribes a move INTO ` +
              "'onboarding' — nothing may ever downgrade into the activation gate",
          ).not.toBe('onboarding');
        }
      }
    }
  });

  it('never throws, for any input in the closed vocabularies', () => {
    for (const status of CADENCE_STATUSES) {
      for (const pauseReason of [null, ...CADENCE_PAUSE_REASONS]) {
        for (const event of CADENCE_EVENTS) {
          expect(() => cadenceTransition({ status, pauseReason }, event)).not.toThrow();
        }
      }
    }
  });
});

/**
 * The property `consume-events.ts` is built on, asserted where it is decided.
 *
 * The consumer's stop is ONE guarded UPDATE covering every live cadence for a
 * quote (`WHERE status IN ('active','paused')`). It therefore cannot know each
 * matched row's status, and derives the stop reason by asking this machine what
 * an ACTIVE cadence does. That is only sound because the answer is the same for
 * a paused one — which is the decided-quote dominance rule, and is checked here
 * rather than assumed at the call site.
 */
describe('cadenceTransition — decided-quote dominance (the consumer depends on this)', () => {
  const CLOSING: Array<{ event: CadenceEvent; stopReason: CadenceStopReason }> = [
    { event: 'won', stopReason: 'won' },
    { event: 'lost', stopReason: 'lost' },
    { event: 'removed', stopReason: 'removed' },
    { event: 'reopened', stopReason: 'reopened' },
  ];

  for (const { event, stopReason } of CLOSING) {
    it(`'${event}' stops every LIVE cadence as '${stopReason}', whatever its pause`, () => {
      const live: CadenceState[] = [
        { status: 'active', pauseReason: null },
        { status: 'paused', pauseReason: 'customer_reply' },
        { status: 'paused', pauseReason: 'client_paused' },
        // The ONB-03 gate does NOT protect a cadence from its quote being
        // decided. A client whose templates land a week after they won the job
        // must not have that quote chased the moment they approve.
        { status: 'paused', pauseReason: 'onboarding' },
        { status: 'paused', pauseReason: null },
      ];

      for (const state of live) {
        expect(cadenceTransition(state, event)).toEqual({
          kind: 'move',
          status: 'stopped',
          pauseReason: null,
          stopReason,
        });
      }
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// The touch machine
// ─────────────────────────────────────────────────────────────────────────────

type ExpectedTouch =
  | { kind: 'move'; status: TouchStatus; skipReason: TouchSkipReason | null }
  | { kind: 'noop' };

interface TouchCell {
  from: TouchStatus;
  event: TouchEvent;
  expect: ExpectedTouch;
  why: string;
}

/** The reason every `skip` cell in the matrix carries. */
const SKIP_REASON: TouchSkipReason = 'cadence_stopped';

const TOUCH_MATRIX: TouchCell[] = [
  // ══ scheduled ═════════════════════════════════════════════════════════════
  //
  // D-14's lifecycle is walked ONE STEP AT A TIME by this function. Phase 3's
  // `touches.promoteDue` compresses `scheduled → approved` into a single
  // statement because both gates auto-pass; that is the stub, and it does not go
  // through here. Phases 5 and 6 drive the steps individually, against this.
  {
    from: 'scheduled',
    event: 'draft_due',
    expect: { kind: 'move', status: 'needs_draft', skipReason: null },
    why: 'the draft lead window opened; the touch surfaces for drafting (Phase 5)',
  },
  {
    from: 'scheduled',
    event: 'drafted',
    expect: { kind: 'noop' },
    why: 'a draft for a touch that never surfaced skipped the step CON-04 measures aging from',
  },
  {
    from: 'scheduled',
    event: 'approval_granted',
    expect: { kind: 'noop' },
    why: 'nothing has been drafted, so there is nothing a human could have approved',
  },
  {
    from: 'scheduled',
    event: 'send_recorded',
    expect: { kind: 'noop' },
    why: 'THE GATE: a touch that was never approved must not be recordable as sent',
  },
  {
    from: 'scheduled',
    event: 'skip',
    expect: { kind: 'move', status: 'skipped', skipReason: SKIP_REASON },
    why: 'any unsent touch can be skipped, with the reason that decided it',
  },

  // ══ needs_draft ═══════════════════════════════════════════════════════════
  {
    from: 'needs_draft',
    event: 'draft_due',
    expect: { kind: 'noop' },
    why: 'already surfaced; re-surfacing would reset the draft-aging clock',
  },
  {
    from: 'needs_draft',
    event: 'drafted',
    expect: { kind: 'move', status: 'pending_approval', skipReason: null },
    why: 'Phase 5 wrote a draft; it now waits for a human (D-14)',
  },
  {
    from: 'needs_draft',
    event: 'approval_granted',
    expect: { kind: 'noop' },
    why: 'approving a message that does not exist yet is the one thing the approval gate must refuse',
  },
  {
    from: 'needs_draft',
    event: 'send_recorded',
    expect: { kind: 'noop' },
    why: 'ungated send; refused',
  },
  {
    from: 'needs_draft',
    event: 'skip',
    expect: { kind: 'move', status: 'skipped', skipReason: SKIP_REASON },
    why: 'still unsent',
  },

  // ══ pending_approval ══════════════════════════════════════════════════════
  {
    from: 'pending_approval',
    event: 'draft_due',
    expect: { kind: 'noop' },
    why: 'already past that step',
  },
  {
    from: 'pending_approval',
    event: 'drafted',
    expect: { kind: 'noop' },
    why: 'DELIBERATE: a second draft would silently replace the text a human is looking at right now',
  },
  {
    from: 'pending_approval',
    event: 'approval_granted',
    expect: { kind: 'move', status: 'approved', skipReason: null },
    why: 'the human said yes — the only path to `approved`, and the only path to a send',
  },
  {
    from: 'pending_approval',
    event: 'send_recorded',
    expect: { kind: 'noop' },
    why: 'ungated send; refused even one step short of approval',
  },
  {
    from: 'pending_approval',
    event: 'skip',
    expect: { kind: 'move', status: 'skipped', skipReason: SKIP_REASON },
    why: 'still unsent',
  },

  // ══ approved ══════════════════════════════════════════════════════════════
  {
    from: 'approved',
    event: 'draft_due',
    expect: { kind: 'noop' },
    why: 'already past that step',
  },
  {
    from: 'approved',
    event: 'drafted',
    expect: { kind: 'noop' },
    why: 'a redraft after approval would send text nobody approved',
  },
  {
    from: 'approved',
    event: 'approval_granted',
    expect: { kind: 'noop' },
    why: 'already approved; the idempotence cell for a double-clicked approve button',
  },
  {
    from: 'approved',
    event: 'send_recorded',
    expect: { kind: 'move', status: 'sent', skipReason: null },
    why: 'the ledger claim was won and the sender invoked — the one legal route to `sent`',
  },
  {
    from: 'approved',
    event: 'skip',
    expect: { kind: 'move', status: 'skipped', skipReason: SKIP_REASON },
    why: 'CAD-05: an approved touch is exactly what the just-in-time refusal skips',
  },

  // ══ sent (terminal) ═══════════════════════════════════════════════════════
  {
    from: 'sent',
    event: 'draft_due',
    expect: { kind: 'noop' },
    why: 'terminal',
  },
  {
    from: 'sent',
    event: 'drafted',
    expect: { kind: 'noop' },
    why: 'terminal',
  },
  {
    from: 'sent',
    event: 'approval_granted',
    expect: { kind: 'noop' },
    why: 'terminal',
  },
  {
    from: 'sent',
    event: 'send_recorded',
    expect: { kind: 'noop' },
    why: 'CAD-04 from the state machine end: a second send is not a state this row can reach',
  },
  {
    from: 'sent',
    event: 'skip',
    expect: { kind: 'noop' },
    why: 'SKIPPING A SENT TOUCH WOULD CLAIM A MESSAGE THAT WENT OUT NEVER DID',
  },

  // ══ skipped (terminal) ════════════════════════════════════════════════════
  {
    from: 'skipped',
    event: 'draft_due',
    expect: { kind: 'noop' },
    why: 'terminal',
  },
  {
    from: 'skipped',
    event: 'drafted',
    expect: { kind: 'noop' },
    why: 'terminal',
  },
  {
    from: 'skipped',
    event: 'approval_granted',
    expect: { kind: 'noop' },
    why: 'terminal',
  },
  {
    from: 'skipped',
    event: 'send_recorded',
    expect: { kind: 'noop' },
    why: 'a skipped touch must never become sent — the skip reason is Phase 7 evidence',
  },
  {
    from: 'skipped',
    event: 'skip',
    expect: { kind: 'noop' },
    why: 'already skipped; a re-skip would overwrite the reason that actually decided it',
  },
];

function touchInput(event: TouchEvent, reason: TouchSkipReason = SKIP_REASON): TouchEventInput {
  return event === 'skip' ? { event, reason } : { event };
}

describe('touchTransition — the full (status x event) matrix (D-14)', () => {
  for (const cell of TOUCH_MATRIX) {
    it(`${cell.from} + ${cell.event} — ${cell.why}`, () => {
      const actual = touchTransition(cell.from, touchInput(cell.event));

      if (cell.expect.kind === 'noop') {
        expect(actual.kind).toBe('noop');
        if (actual.kind === 'noop') expect(actual.noop.length).toBeGreaterThan(0);
        return;
      }

      expect(actual).toEqual(cell.expect);
    });
  }

  it('enumerates every (status x event) cell — no pair is unasserted', () => {
    const covered = new Set(TOUCH_MATRIX.map((c) => `${c.from}::${c.event}`));

    expect(TOUCH_STATUSES.length).toBe(6);
    expect(TOUCH_EVENTS.length).toBe(5);
    expect(TOUCH_MATRIX.length).toBe(TOUCH_STATUSES.length * TOUCH_EVENTS.length);

    for (const status of TOUCH_STATUSES) {
      for (const event of TOUCH_EVENTS) {
        expect(covered, `touch cell ${status}::${event} is not asserted`).toContain(
          `${status}::${event}`,
        );
      }
    }
  });

  it('is TOTAL — every cell returns a well-formed outcome and never throws', () => {
    for (const status of TOUCH_STATUSES) {
      for (const event of TOUCH_EVENTS) {
        for (const reason of TOUCH_SKIP_REASONS) {
          const outcome = touchTransition(status, touchInput(event, reason));

          expect(outcome).toBeDefined();
          expect(() => touchTransition(status, touchInput(event, reason))).not.toThrow();

          if (outcome.kind === 'noop') {
            expect(outcome.noop.length).toBeGreaterThan(0);
            continue;
          }

          expect(TOUCH_STATUSES).toContain(outcome.status);
          if (outcome.skipReason !== null) {
            expect(TOUCH_SKIP_REASONS).toContain(outcome.skipReason);
          }
          // A skip reason exists on `skipped` rows and NOWHERE else: every
          // member of the vocabulary is a rule that decided something, and Phase
          // 7 reads them as evidence.
          expect(outcome.status === 'skipped').toBe(outcome.skipReason !== null);
        }
      }
    }
  });

  it('carries THE GIVEN skip reason through, never a substituted one', () => {
    // The reason is passed in because the rule that decided the skip lives at
    // the call site (min_gap, stale, suppressed, …). A machine that picked its
    // own would put a false statement in Phase 7's evidence.
    for (const reason of TOUCH_SKIP_REASONS) {
      expect(touchTransition('approved', { event: 'skip', reason })).toEqual({
        kind: 'move',
        status: 'skipped',
        skipReason: reason,
      });
    }
  });
});
