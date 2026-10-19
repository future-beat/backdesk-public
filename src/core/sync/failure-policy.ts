/**
 * What a failed sync cycle is allowed to do to a client (SYNC-04, D-06,
 * RESEARCH Pattern 5).
 *
 * A PURE DECISION, SEPARATE FROM ITS EFFECTS. This function returns what should
 * happen; `run-sync` writes `paused_at`, bumps the counter and fires the alert.
 * The split exists because the effects need a database and a mail provider,
 * and a policy that can only be exercised through both is a policy whose
 * branches get tested by whichever path an integration test happened to take.
 *
 * THE TWO MISTAKES IT PREVENTS POINT IN OPPOSITE DIRECTIONS.
 *
 *   Over-reacting: pausing a client because ServiceM8 returned 429 or a socket
 *   dropped. Their quotes stop being chased for a reason that had nothing to do
 *   with them, and the first anyone notices is a thin monthly report.
 *
 *   Under-reacting: treating a revoked key as a blip. The mirror silently
 *   freezes while the console still shows quotes, and the cadence keeps sending
 *   follow-ups computed from state that stopped being true days ago.
 *
 * So the classification the ServiceM8 client already made is honoured exactly:
 * `auth_failed` is terminal until a human acts, everything else is weather.
 */
import type { Sm8FailureKind } from '@/core/servicem8/types';

/** The number of consecutive failed cycles that constitutes a pattern, not noise. */
export const DEGRADED_AFTER_FAILURES = 3;

export interface FailurePolicyInput {
  kind: Sm8FailureKind;
  /**
   * The count BEFORE this cycle, straight off `sm8_connections`. A value of 2
   * therefore means the cycle being classified is the third.
   */
  consecutiveFailures: number;
  /** `sm8_connections.alerted_at` — the per-episode alert dedupe. */
  alertedAt: Date | null;
}

export interface FailurePolicyDecision {
  /**
   * Written to `sm8_connections.status_reason` alongside `paused_at` when
   * non-null. A paused connection is skipped by the tick and blocks Phase 3
   * dispatch.
   */
  pauseReason: 'auth_failed' | null;
  /** Whether to bump `consecutive_failures`. */
  incrementFailures: boolean;
  /** What the operator should be told, if anything. `run-sync` sends it. */
  alertKind: 'auth' | 'degraded' | null;
}

export function applyFailurePolicy(input: FailurePolicyInput): FailurePolicyDecision {
  const { kind, consecutiveFailures, alertedAt } = input;

  if (kind === 'auth_failed') {
    // First occurrence, no grace period, no backoff. A 401 means the key was
    // revoked, rotated or mistyped, and none of those un-revoke themselves
    // while we wait — every cycle spent waiting is a cycle of follow-ups sent
    // from a mirror that stopped updating.
    //
    // THE PAUSE IS UNCONDITIONAL; THE ALERT IS DEDUPED (D-05).
    //
    // Re-asserting `paused_at` on an already-paused connection is a no-op that
    // costs nothing and keeps the decision honest for any caller — a second
    // auth failure must never resolve to "not paused".
    //
    // The alert is a different matter. An earlier revision reasoned that an
    // auth alert cannot repeat, because this same decision pauses the
    // connection and the tick skips paused connections from then on. That is
    // true of the TICK, and it is true of the webhook adapter, and it is not a
    // property of this function — it is a property of two callers that happen
    // to filter first. "Exactly one email per episode" is the guarantee D-05
    // actually makes, and a guarantee that holds because of what the callers
    // do today is one that breaks the first time a third caller is written.
    // `alerted_at` is cleared by the next successful cycle, so a NEW episode
    // alerts again.
    return {
      pauseReason: 'auth_failed',
      incrementFailures: true,
      alertKind: alertedAt === null ? 'auth' : null,
    };
  }

  // rate_limited | server_error | network_error | parse_error.
  //
  // parse_error sits here deliberately (T-2-09): ServiceM8 changing a field's
  // type on a Tuesday is our bug to fix, not the client's key to re-enter.
  // Pausing would send the operator chasing a re-key that changes nothing.
  //
  // The 5-minute tick IS the outer backoff — there is no sleep here, because
  // the next cycle is the retry.
  const failuresAfterThisCycle = consecutiveFailures + 1;
  const degraded = failuresAfterThisCycle >= DEGRADED_AFTER_FAILURES;

  return {
    pauseReason: null,
    incrementFailures: true,
    // Once per EPISODE, not once per cycle. At a 5-minute tick an un-deduped
    // degraded alert is 288 emails a day about one problem, which is how an
    // operator learns to filter the sender that also sends the auth alerts.
    // `alerted_at` is cleared on the next success, so a new episode alerts again.
    alertKind: degraded && alertedAt === null ? 'degraded' : null,
  };
}
