/**
 * SYNC-04 / D-06: what a failed cycle is allowed to do to a client.
 *
 * The two mistakes this policy exists to prevent point in opposite directions,
 * and both are expensive:
 *
 *   OVER-REACTING — pausing a client's cadence because ServiceM8 returned a 429
 *   or dropped a connection. The client's quotes stop being chased for a reason
 *   that had nothing to do with them, and nobody notices until the monthly
 *   report is short.
 *
 *   UNDER-REACTING — treating a revoked API key as a transient blip. The mirror
 *   silently freezes, the console still shows quotes, and the cadence keeps
 *   sending follow-ups computed from state that stopped being true days ago.
 *
 * Keeping this a PURE function is the point of the file: the decision is
 * separable from the effects (writing paused_at, incrementing a counter, sending
 * an email), so every branch is asserted here rather than inferred from an
 * integration test that happened to take one path.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { Sm8FailureKind } from '@/core/servicem8/types';
import { applyFailurePolicy } from '@/core/sync/failure-policy';

const TRANSIENT: Sm8FailureKind[] = [
  'rate_limited',
  'server_error',
  'network_error',
  'parse_error',
];

describe('applyFailurePolicy — authentication failure (D-06)', () => {
  it('pauses on the FIRST occurrence and alerts immediately', () => {
    // Keys do not un-revoke. There is nothing to wait for, and every cycle spent
    // waiting is a cycle of follow-ups sent from a mirror that has stopped
    // updating.
    const decision = applyFailurePolicy({
      kind: 'auth_failed',
      consecutiveFailures: 0,
      alertedAt: null,
    });

    expect(decision.pauseReason).toBe('auth_failed');
    expect(decision.alertKind).toBe('auth');
    expect(decision.incrementFailures).toBe(true);
  });

  it('does not wait for a third strike the way transient failures do', () => {
    const transient = applyFailurePolicy({
      kind: 'server_error',
      consecutiveFailures: 0,
      alertedAt: null,
    });

    expect(transient.pauseReason).toBeNull();
    expect(transient.alertKind).toBeNull();
  });
});

describe('applyFailurePolicy — transient failures never pause (D-06)', () => {
  it.each(TRANSIENT)('a single %s failure records and moves on', (kind) => {
    const decision = applyFailurePolicy({
      kind,
      consecutiveFailures: 0,
      alertedAt: null,
    });

    expect(
      decision.pauseReason,
      `${kind} paused the connection. ServiceM8's outage, our own malformed ` +
        "filter, or a dropped socket is not the client's fault and must never " +
        'stop their cadence.',
    ).toBeNull();
    expect(decision.alertKind).toBeNull();
    expect(decision.incrementFailures).toBe(true);
  });

  it.each(TRANSIENT)('a SECOND consecutive %s failure still does not alert', (kind) => {
    const decision = applyFailurePolicy({
      kind,
      consecutiveFailures: 1,
      alertedAt: null,
    });

    expect(decision.pauseReason).toBeNull();
    expect(decision.alertKind).toBeNull();
  });

  it.each(TRANSIENT)('the THIRD consecutive %s failure alerts as degraded', (kind) => {
    // consecutiveFailures is the count BEFORE this cycle, so 2 means this one
    // is the third. Ten minutes of failure is noise; fifteen is a pattern.
    const decision = applyFailurePolicy({
      kind,
      consecutiveFailures: 2,
      alertedAt: null,
    });

    expect(decision.alertKind).toBe('degraded');
    expect(
      decision.pauseReason,
      'degraded is an alert, not a pause — the cadence keeps running on the ' +
        'state we already have while somebody looks at it',
    ).toBeNull();
  });

  it('alerts ONCE per episode, not once every five minutes', () => {
    // The dedupe that decides whether the operator reads the alert or filters
    // the sender. At a 5-minute tick, an un-deduped degraded alert is 288
    // emails a day about one problem.
    const decision = applyFailurePolicy({
      kind: 'server_error',
      consecutiveFailures: 5,
      alertedAt: new Date('2026-08-26T09:00:00Z'),
    });

    expect(decision.alertKind).toBeNull();
    expect(decision.incrementFailures).toBe(true);
  });

  it('alerts again if the episode was never alerted, however deep it is', () => {
    // Guards the inverse bug: an alert send that failed, or a counter that ran
    // past 3 while alerted_at stayed null, must not mean the operator is never
    // told.
    const decision = applyFailurePolicy({
      kind: 'network_error',
      consecutiveFailures: 9,
      alertedAt: null,
    });

    expect(decision.alertKind).toBe('degraded');
  });
});

describe('applyFailurePolicy — parse_error is drift, not a credential problem', () => {
  it('does not pause on schema drift', () => {
    // T-2-09. A ServiceM8 field that changes type on a Tuesday is our problem to
    // fix, not the client's key to re-enter. Pausing here would send the
    // operator chasing a re-key that changes nothing.
    const decision = applyFailurePolicy({
      kind: 'parse_error',
      consecutiveFailures: 0,
      alertedAt: null,
    });

    expect(decision.pauseReason).toBeNull();
    expect(decision.alertKind).toBeNull();
  });

  it('still escalates to degraded when it keeps happening', () => {
    const decision = applyFailurePolicy({
      kind: 'parse_error',
      consecutiveFailures: 2,
      alertedAt: null,
    });

    expect(decision.alertKind).toBe('degraded');
  });
});

describe('applyFailurePolicy — totality', () => {
  it('returns a decision for every failure kind', () => {
    const kinds: Sm8FailureKind[] = ['auth_failed', ...TRANSIENT];

    for (const kind of kinds) {
      for (const consecutiveFailures of [0, 1, 2, 3]) {
        for (const alertedAt of [null, new Date()]) {
          const decision = applyFailurePolicy({ kind, consecutiveFailures, alertedAt });

          expect([null, 'auth_failed']).toContain(decision.pauseReason);
          expect([null, 'auth', 'degraded']).toContain(decision.alertKind);
          expect(typeof decision.incrementFailures).toBe('boolean');
        }
      }
    }
  });

  it('is pure — the same input yields the same decision', () => {
    const input = {
      kind: 'rate_limited' as const,
      consecutiveFailures: 2,
      alertedAt: null,
    };

    expect(applyFailurePolicy(input)).toEqual(applyFailurePolicy(input));
  });
});

/**
 * WR-07: every field of the decision is READ by the effects.
 *
 * `incrementFailures` was computed on both branches, documented as "Whether to
 * bump `consecutive_failures`", and then ignored — `recordFailure` wrote
 * `locked.consecutiveFailures + 1` unconditionally. A third of the decision was
 * decorative, so a future `incrementFailures: false` branch would have been
 * written, tested above, and silently dropped in production.
 *
 * This module's header argues that the pure/effectful split exists so the
 * policy's branches "get tested" rather than being reached by whichever path an
 * integration test happened to take. That argument only holds if the effectful
 * side actually consults what the pure side returned, which is a property of
 * `run-sync.ts` and is therefore asserted against its source.
 */
describe('the decision is fully honoured by the effects (WR-07)', () => {
  const RUN_SYNC = readFileSync('src/core/sync/run-sync.ts', 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('consecutive_failures is written from decision.incrementFailures', () => {
    expect(RUN_SYNC).toMatch(/consecutiveFailures:\s*decision\.incrementFailures/);
  });

  it('does not bump the counter unconditionally', () => {
    // The exact shape of the defect: an increment that never consults the policy.
    expect(RUN_SYNC).not.toMatch(
      /consecutiveFailures:\s*locked\.consecutiveFailures \+ 1\s*,/,
    );
  });

  it('the other two fields are still honoured', () => {
    expect(RUN_SYNC).toMatch(/decision\.pauseReason/);
    expect(RUN_SYNC).toMatch(/decision\.alertKind/);
  });

  it('every field of FailurePolicyDecision is read somewhere in run-sync', () => {
    // Exhaustive against the type, so a field added to the decision and then
    // never consumed fails here rather than becoming the next WR-07.
    const decision = applyFailurePolicy({
      kind: 'rate_limited',
      consecutiveFailures: 0,
      alertedAt: null,
    });

    for (const field of Object.keys(decision)) {
      expect(RUN_SYNC, `decision.${field} is computed but never read`).toContain(
        `decision.${field}`,
      );
    }
  });
});
