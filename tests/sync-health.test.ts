/**
 * `deriveHealth` — the single source of the badge (D-07), including the
 * STALENESS rule that closes CR-02.
 *
 * ── WHY THIS SUITE IS SEPARATE FROM rekey-resume.test.ts ────────────────────
 *
 * These assertions are pure: one function, four scalar inputs, no database and
 * no ServiceM8 account. They previously lived inside the re-key integration
 * suite, which cannot run without a live Supabase stack — so the rules that
 * decide what every operator sees on every page were only provable in an
 * environment that has Docker. Moving them here makes them provable everywhere,
 * which matters most for the one rule below that is about the system having
 * stopped.
 */
import { describe, expect, it } from 'vitest';

import {
  deriveHealth,
  DEGRADED_AFTER_FAILURES,
  HEALTH_BADGE_CLASS,
  HEALTH_LABELS,
  STALE_AFTER_MS,
} from '@/core/sync/health';

/** The moment every case below is judged against. Fixed, so nothing drifts. */
const NOW = new Date('2026-08-26T01:05:00Z');

const HEALTHY = {
  pausedAt: null,
  statusReason: null,
  consecutiveFailures: 0,
  // Five minutes before NOW: one tick ago, comfortably inside the window.
  lastSuccessAt: new Date('2026-08-26T01:00:00Z'),
};

describe('deriveHealth — the single source of the badge (D-07)', () => {
  it('a client with no connection row has never synced', () => {
    expect(deriveHealth(null, NOW)).toBe('never-synced');
  });

  it('a connection that has never succeeded has never synced', () => {
    expect(deriveHealth({ ...HEALTHY, lastSuccessAt: null }, NOW)).toBe('never-synced');
  });

  it('an auth pause outranks everything else', () => {
    // Ordering matters: a paused client with three failures must not render as
    // `degraded`, which is the less alarming word for the more alarming state.
    expect(
      deriveHealth(
        {
          pausedAt: new Date(),
          statusReason: 'auth_failed',
          consecutiveFailures: 9,
          lastSuccessAt: null,
        },
        NOW,
      ),
    ).toBe('auth-failed');
  });

  it('a pause for any OTHER reason is degraded, not auth-failed', () => {
    // The banner tells the operator to paste a new key. Raising it for a pause
    // a key cannot fix would send them to do exactly the wrong thing.
    expect(
      deriveHealth({ ...HEALTHY, pausedAt: new Date(), statusReason: 'suspended' }, NOW),
    ).toBe('degraded');
  });

  it('three consecutive failures without a pause is degraded', () => {
    expect(deriveHealth({ ...HEALTHY, consecutiveFailures: 3 }, NOW)).toBe('degraded');
    expect(deriveHealth({ ...HEALTHY, consecutiveFailures: 2 }, NOW)).toBe('healthy');
  });

  it('accepts ISO strings as well as Dates', () => {
    // The console reads through PostgREST (strings); the server reads through
    // drizzle (Dates). Both must reach the same verdict from the same row.
    expect(
      deriveHealth(
        {
          pausedAt: '2026-08-25T02:00:00Z',
          statusReason: 'auth_failed',
          consecutiveFailures: 4,
          lastSuccessAt: '2026-08-24T22:00:00Z',
        },
        NOW,
      ),
    ).toBe('auth-failed');
  });

  it('every state has a label containing the state word and a badge class', () => {
    // WCAG 1.4.1: colour is reinforcement, never the sole signal.
    for (const [state, label] of Object.entries(HEALTH_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
      expect(label).toBe(state.replace('-', ' '));
      expect(HEALTH_BADGE_CLASS[state as keyof typeof HEALTH_BADGE_CLASS]).toMatch(/^badge/);
    }
  });
});

/**
 * CR-02. Every case here has `consecutiveFailures: 0` and `pausedAt: null` — the
 * exact state a client is left in when the TICK stops rather than when a cycle
 * fails. No cycle ran, so nothing incremented and nothing paused; before this
 * rule existed, all of them rendered `healthy`.
 */
describe('deriveHealth — staleness (CR-02)', () => {
  const stale = (msAgo: number) => ({
    ...HEALTHY,
    lastSuccessAt: new Date(NOW.getTime() - msAgo),
  });

  it('a success inside the window is healthy', () => {
    expect(deriveHealth(stale(STALE_AFTER_MS - 1_000), NOW)).toBe('healthy');
  });

  it('a success exactly at the window is still healthy', () => {
    // The boundary is `>`, not `>=`: a tick that lands precisely on the limit is
    // punctual, not late, and flapping a badge on the boundary teaches the
    // operator to ignore it.
    expect(deriveHealth(stale(STALE_AFTER_MS), NOW)).toBe('healthy');
  });

  it('a success past the window is degraded even with zero failures', () => {
    expect(deriveHealth(stale(STALE_AFTER_MS + 1_000), NOW)).toBe('degraded');
  });

  it('the four-hour case from the module header is degraded, not healthy', () => {
    // The header promised derivation "cannot lie in that direction". This is the
    // case it named, and it is the regression this suite exists to prevent.
    expect(deriveHealth(stale(4 * 60 * 60_000), NOW)).toBe('degraded');
  });

  it('holds for the ISO-string form the console passes', () => {
    expect(
      deriveHealth(
        { ...HEALTHY, lastSuccessAt: new Date(NOW.getTime() - 60 * 60_000).toISOString() },
        NOW,
      ),
    ).toBe('degraded');
  });

  it('an unparseable timestamp is degraded, never healthy', () => {
    // NaN comparisons are all false, so an arithmetic-only check would fall
    // through to `healthy` — the one answer a corrupt row must not produce.
    expect(deriveHealth({ ...HEALTHY, lastSuccessAt: 'not-a-date' }, NOW)).toBe('degraded');
  });

  it('a stale success does not outrank an auth pause', () => {
    // Staleness is checked last on purpose: `auth-failed` is the state with an
    // action attached, and a paused client is stale BY CONSTRUCTION.
    expect(
      deriveHealth(
        { ...stale(4 * 60 * 60_000), pausedAt: new Date(), statusReason: 'auth_failed' },
        NOW,
      ),
    ).toBe('auth-failed');
  });

  it('a never-synced client is not reported as merely stale', () => {
    // `never-synced` is actionable ("connect ServiceM8"); `degraded` is not.
    expect(deriveHealth({ ...HEALTHY, lastSuccessAt: null }, NOW)).toBe('never-synced');
  });

  it('defaults `now` to the current time so no call site has to pass it', () => {
    expect(deriveHealth({ ...HEALTHY, lastSuccessAt: new Date() })).toBe('healthy');
    expect(deriveHealth({ ...HEALTHY, lastSuccessAt: new Date(Date.now() - 60 * 60_000) })).toBe(
      'degraded',
    );
  });

  it('the window is three ticks of the five-minute cron (D-13)', () => {
    // Pinned so a change to the tick interval has to be reflected here rather
    // than silently making the badge either deaf or twitchy.
    expect(STALE_AFTER_MS).toBe(15 * 60_000);
    expect(DEGRADED_AFTER_FAILURES).toBe(3);
  });
});
