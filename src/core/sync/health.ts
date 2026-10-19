/**
 * Sync health, DERIVED — never stored (D-07, RESEARCH Pattern 5).
 *
 * ── WHY A FUNCTION AND NOT A COLUMN ─────────────────────────────────────────
 *
 * A stored `health` column goes stale the instant the process that maintains it
 * stops, and "the process stopped" is precisely the failure this badge exists
 * to make visible. A connection whose stored health says `healthy` and whose
 * last successful sync was four hours ago looks fine and is not.
 *
 * DERIVATION ALONE DOES NOT PREVENT THAT LIE (CR-02). An earlier revision of
 * this header claimed it did — "the inputs ARE the state" — but derivation only
 * guarantees the answer is a fresh function of the inputs; it says nothing about
 * whether the inputs themselves are still moving. `consecutive_failures` is
 * incremented by a cycle that RAN and failed, so a tick that stops running
 * increments nothing, and every rule keyed to it reports health forever. What
 * closes the gap is reading `last_success_at` as a CLOCK rather than as a
 * presence check — see `STALE_AFTER_MS`.
 *
 * ── WHY IT TAKES ONE ARGUMENT ───────────────────────────────────────────────
 *
 * Every rule below reads a field of `sm8_connections` and nothing else. The
 * plan's sketch passed the latest `sync_runs` row alongside, but none of the
 * four rules consult it — and a parameter a function ignores is worse than no
 * parameter: it advertises a dependency the badge does not have, and invites a
 * caller to pass a DIFFERENT run than the banner's caller passed.
 *
 * That is the point. The must-have is "badge and banner can never disagree",
 * and the strongest available guarantee of that is not discipline at two call
 * sites — it is a function whose entire input is one row that both call sites
 * already hold.
 *
 * `sync_runs` is still what the operator READS (the recent-runs table); it is
 * just not what the badge is COMPUTED from. `last_success_at` on the connection
 * is written by the same transaction that writes an `ok` run row, so "has this
 * client ever synced" is answerable without a second query.
 *
 * `src/core` is framework-free — nothing here imports from `next/*`.
 */

/**
 * The closed health vocabulary (D-07).
 *
 * Four values, and no fifth: an `unknown` state would be a badge that tells the
 * operator nothing while occupying the space where something true could go.
 */
export const SYNC_HEALTH_STATES = [
  'healthy',
  'degraded',
  'auth-failed',
  'never-synced',
] as const;

export type SyncHealth = (typeof SYNC_HEALTH_STATES)[number];

/** The failures-in-a-row that make a pattern rather than weather (mirrors D-06). */
export const DEGRADED_AFTER_FAILURES = 3;

/**
 * How old a "last success" may get before the connection is degraded (CR-02).
 *
 * Ticks run every five minutes (D-13). Three missed ticks is not weather — it
 * means the tick itself is not reaching this client, and THAT is the failure
 * mode `consecutive_failures` structurally cannot see: no cycle ran, so nothing
 * incremented, so nothing paused and nothing alerted.
 *
 * The reachable ways to get here all share that signature — no `sync_runs` row
 * at all:
 *
 *   1. Secret rotation. `scripts/apply-cron-schedules.mjs` documents the window:
 *      update the Vercel env, redeploy, re-run the script — and in between, the
 *      tick 401s before `runSyncTick()` is ever called. `net.http_post` got a
 *      response, so `cron.job_run_details` reads green (RESEARCH Pitfall 7,
 *      re-entered through a different door).
 *   2. The cron job unscheduled or misapplied. Same signature.
 *   3. Tick starvation (WR-03): clients the tick never reaches keep
 *      `consecutive_failures = 0` and a `last_success_at` that stops moving.
 *
 * In all three the phase's "no silent dead client" criterion fails silently
 * unless staleness is checked. Staleness is the only observable.
 */
export const STALE_AFTER_MS = 15 * 60_000;

/**
 * The connection fields health is computed from.
 *
 * Structurally typed and tolerant of `string` timestamps so the console (which
 * reads through PostgREST, where a `timestamptz` arrives as an ISO string) and
 * the server (which reads through drizzle, where it arrives as a `Date`) can
 * both pass their row without a conversion step whose only purpose would be to
 * satisfy this signature.
 */
export interface HealthInputs {
  pausedAt: Date | string | null;
  statusReason: string | null;
  consecutiveFailures: number;
  lastSuccessAt: Date | string | null;
}

/**
 * Derive one client's sync health.
 *
 * `null` means there is no connection row at all — the client was created but
 * ServiceM8 was never connected. That is `never-synced`, which is exactly what
 * the operator needs to see and act on.
 *
 * ORDER IS THE DESIGN. Each rule is checked before the ones it would otherwise
 * be masked by:
 *
 *   1. `auth-failed` FIRST, because it is the only state with a specific
 *      action attached (paste a new key) and the only one that means nothing is
 *      going out for this client right now. A paused client that also happens
 *      to have three failures must not render as `degraded` — degraded is the
 *      strictly less alarming word for the strictly more alarming situation.
 *   2. `never-synced` next, so a client who has never connected is not reported
 *      as `healthy` on the strength of having no failures yet. Zero failures
 *      and zero successes is not health, it is silence.
 *   3. `degraded` — repeatedly failing, but NOT paused: follow-ups continue
 *      from data that has stopped being refreshed.
 *   4. `degraded` again, for STALENESS (CR-02). Checked separately from the
 *      failure count because it catches the opposite kind of failure: not
 *      "cycles are running and failing" but "cycles are not running at all".
 *      See `STALE_AFTER_MS`.
 *   5. `healthy` last, and only by elimination. Nothing returns `healthy`
 *      because a check passed; it returns `healthy` because every way of being
 *      unhealthy was ruled out. A future sixth failure mode added above this
 *      line cannot be silently absorbed into the good state.
 *
 * `now` IS A PARAMETER so the staleness rule is testable without moving the
 * system clock, and defaulted so neither call site has to care.
 */
export function deriveHealth(
  connection: HealthInputs | null | undefined,
  now: Date = new Date(),
): SyncHealth {
  if (!connection) return 'never-synced';

  const { pausedAt, statusReason, consecutiveFailures, lastSuccessAt } = connection;

  if (pausedAt) {
    // Only an auth pause is re-keyable. Any other pause reason is abnormal but
    // is not fixed by pasting a credential, so it must not raise a banner that
    // tells the operator to do exactly that.
    return statusReason === 'auth_failed' ? 'auth-failed' : 'degraded';
  }

  if (!lastSuccessAt) return 'never-synced';

  if (consecutiveFailures >= DEGRADED_AFTER_FAILURES) return 'degraded';

  // The tick itself stopping is invisible to `consecutive_failures` — no cycle
  // ran, so nothing incremented. Without this the module header's claim that
  // "derivation cannot lie in that direction" is exactly backwards: a client
  // whose sync stopped four hours ago renders `healthy`.
  const last = lastSuccessAt instanceof Date ? lastSuccessAt : new Date(lastSuccessAt);
  // An unparseable timestamp is not evidence of health. NaN comparisons are
  // false, so this must be tested explicitly rather than left to the subtraction.
  if (Number.isNaN(last.getTime())) return 'degraded';
  if (now.getTime() - last.getTime() > STALE_AFTER_MS) return 'degraded';

  return 'healthy';
}

/**
 * The badge TEXT for a health state.
 *
 * WCAG 1.4.1: every state is spelled out. Color is reinforcement and never the
 * sole signal — a red badge and an amber badge are the same badge to a
 * colour-blind operator reading a phone in a van in daylight.
 */
export const HEALTH_LABELS: Readonly<Record<SyncHealth, string>> = {
  healthy: 'healthy',
  degraded: 'degraded',
  'auth-failed': 'auth failed',
  'never-synced': 'never synced',
};

/**
 * The badge CLASSES for a health state (02-UI-SPEC "Badge state mapping").
 *
 * Returned as a complete `class` value rather than just the modifier so a call
 * site cannot render a modifier without its base and get an unstyled word.
 */
export const HEALTH_BADGE_CLASS: Readonly<Record<SyncHealth, string>> = {
  healthy: 'badge badge--ok',
  degraded: 'badge badge--warn',
  'auth-failed': 'badge badge--error',
  // Neutral base — "never synced" is a state of affairs, not a fault.
  'never-synced': 'badge',
};
