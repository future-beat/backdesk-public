/**
 * The D-02 predicate and the D-01 window (RPT-01).
 *
 * PURE — no database, no network, no clock. These two functions decide whether
 * a won job appears on a client's invoice, so the test that matters is not
 * "does it run" but "is it exactly this, at the boundary, in both directions".
 *
 * Two properties are load-bearing enough to state out loud:
 *
 *  1. **NULL `delivery_status` QUALIFIES.** Every email touch is NULL there
 *     forever and every SMS is NULL until a receipt arrives, so the NULL branch
 *     is the common case. An implementation that used `<> 'undelivered'` — the
 *     SQL form that is NULL-false — would drop most of the qualifying rows in
 *     the table and understate every report, silently.
 *  2. **Both sides of every boundary.** A window test that only checks "a touch
 *     29 days before the win qualifies" passes for an implementation with no
 *     window at all. The 30-days-plus-1ms case is what makes the assertion mean
 *     anything.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ATTRIBUTION_WINDOW_DAYS } from '@/core/audit/constants';
import { qualifiesAsTouch, qualifyingTouches, type LedgerTouchFields } from '@/core/attribution/qualify';
import { ABOUT_QUOTE_TOUCH_NUMBER } from '@/core/leads/constants';

const DAY_MS = 86_400_000;

/** A fixed instant, so no assertion here depends on when the suite runs. */
const DETECTED_AT = new Date('2026-08-26T00:00:00.000Z');

function touch(over: Partial<LedgerTouchFields> = {}): LedgerTouchFields {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    cadenceId: '22222222-2222-4222-8222-222222222222',
    touchNumber: 1,
    channel: 'sms',
    sender: 'clicksend',
    outcome: 'sent',
    claimedAt: new Date(DETECTED_AT.getTime() - DAY_MS),
    deliveryStatus: null,
    ...over,
  };
}

describe('qualifiesAsTouch — D-02', () => {
  it('excludes the Phase 3 stub sender, forever, by the column', () => {
    // Phase 3 D-13: `sender = 'stub'` logged instead of sending. Those rows are
    // excluded by WHAT THEY ARE, not by a date cutoff somebody has to maintain.
    expect(qualifiesAsTouch(touch({ sender: 'stub', outcome: 'sent' }))).toBe(false);
  });

  it('excludes a failed send and an unanswered one', () => {
    expect(qualifiesAsTouch(touch({ outcome: 'failed' }))).toBe(false);
    expect(qualifiesAsTouch(touch({ outcome: 'stub_sent' }))).toBe(false);
    // NULL outcome is "we do not know whether the provider took it" — not a
    // fourth value, and certainly not a yes.
    expect(qualifiesAsTouch(touch({ outcome: null }))).toBe(false);
  });

  it('excludes an SMS the carrier reported undelivered', () => {
    expect(qualifiesAsTouch(touch({ deliveryStatus: 'undelivered' }))).toBe(false);
  });

  it('counts a pending receipt, a delivered one and an unmappable one', () => {
    // D-02: "an SMS with a pending receipt counts". NULL is the ABSENCE of a
    // receipt, not a negative answer.
    expect(qualifiesAsTouch(touch({ deliveryStatus: null }))).toBe(true);
    expect(qualifiesAsTouch(touch({ deliveryStatus: 'delivered' }))).toBe(true);
    // 'unknown' means a receipt CAME and could not be mapped to a verdict. That
    // is not evidence of non-delivery.
    expect(qualifiesAsTouch(touch({ deliveryStatus: 'unknown' }))).toBe(true);
  });

  it('counts an email, which has no receipt to wait for', () => {
    expect(
      qualifiesAsTouch(touch({ channel: 'email', sender: 'resend', deliveryStatus: null })),
    ).toBe(true);
  });

  it('documents the SQL form beside the TypeScript one', () => {
    // `delivery_status <> 'undelivered'` is NULL — and therefore false — for
    // every email and every pending SMS. The SQL bodies in 07-03 and 07-05 copy
    // the form from this file's comment, so the comment is load-bearing.
    const source = readFileSync('src/core/attribution/qualify.ts', 'utf8');

    expect(source).toContain('IS DISTINCT FROM');
  });
});

describe('qualifyingTouches — the D-01 window', () => {
  const floor = DETECTED_AT.getTime() - ATTRIBUTION_WINDOW_DAYS * DAY_MS;

  it('counts a touch sent exactly 30 days before detection', () => {
    // Exactly-at-the-threshold is INSIDE — the same convention the Phase 2
    // grace period and the Phase 3 contact window use. A rule whose boundary
    // behaviour varies by module is a rule nobody can state in a footnote.
    const row = touch({ claimedAt: new Date(floor) });

    expect(qualifyingTouches([row], DETECTED_AT)).toHaveLength(1);
  });

  it('does NOT count a touch one millisecond older than the window', () => {
    const row = touch({ claimedAt: new Date(floor - 1) });

    expect(qualifyingTouches([row], DETECTED_AT)).toHaveLength(0);
  });

  it('counts a touch sent in the same millisecond the win was detected', () => {
    const row = touch({ claimedAt: new Date(DETECTED_AT.getTime()) });

    expect(qualifyingTouches([row], DETECTED_AT)).toHaveLength(1);
  });

  it('never counts a touch claimed AFTER the win was detected', () => {
    // A message sent after the job was already won cannot have caused it, and
    // attributing it is exactly the overreach D-01 exists to prevent.
    const row = touch({ claimedAt: new Date(DETECTED_AT.getTime() + 1) });

    expect(qualifyingTouches([row], DETECTED_AT)).toHaveLength(0);
  });

  it('applies the predicate and the window together', () => {
    const rows = [
      touch({ id: '33333333-3333-4333-8333-333333333333', sender: 'stub' }),
      touch({ id: '44444444-4444-4444-8444-444444444444', claimedAt: new Date(floor - DAY_MS) }),
      touch({ id: '55555555-5555-4555-8555-555555555555' }),
    ];

    expect(qualifyingTouches(rows, DETECTED_AT).map((r) => r.id)).toEqual([
      '55555555-5555-4555-8555-555555555555',
    ]);
  });

  it('orders by claimed instant, then touch number — so evidence is reproducible', () => {
    const shared = new Date(DETECTED_AT.getTime() - 2 * DAY_MS);
    const rows = [
      touch({ id: '55555555-5555-4555-8555-555555555555', touchNumber: 3, claimedAt: shared }),
      touch({ id: '44444444-4444-4444-8444-444444444444', touchNumber: 1, claimedAt: new Date(DETECTED_AT.getTime() - 5 * DAY_MS) }),
      touch({ id: '33333333-3333-4333-8333-333333333333', touchNumber: 2, claimedAt: shared }),
    ];

    expect(qualifyingTouches(rows, DETECTED_AT).map((r) => r.touchNumber)).toEqual([1, 2, 3]);
  });

  it('reads no timestamp other than claimed_at — send_ledger has no sent_at', () => {
    // RESEARCH Pitfall 1. `claimed_at` is "when the claim was won", written
    // BEFORE the provider call; `outcome` is set after. The methodology text on
    // the report says "sent (claimed) at" rather than pretending to a precision
    // the ledger does not have.
    const source = readFileSync('src/core/attribution/qualify.ts', 'utf8');

    expect(source).not.toContain('sentAt');
    expect(source).not.toContain('deliveredAt');
  });
});

describe('qualifyingTouches — the about-quote text never qualifies (12-05, D-17)', () => {
  it('touch 0 is the reserved about-quote touch number', () => {
    expect(ABOUT_QUOTE_TOUCH_NUMBER).toBe(0);
  });

  it('drops a touch-0 row that otherwise qualifies, and keeps touches 1..5', () => {
    const rows = [0, 1, 2, 3, 4, 5].map((touchNumber, i) =>
      touch({
        id: `${String(i + 1).repeat(8)}-1111-4111-8111-111111111111`,
        touchNumber,
        claimedAt: new Date(DETECTED_AT.getTime() - (10 - i) * DAY_MS),
      }),
    );

    // The row itself passes the D-02 predicate — it is a real, sent SMS …
    expect(qualifiesAsTouch(rows[0]!)).toBe(true);
    // … and still claims nothing: the customer rang, this was the reply.
    expect(qualifyingTouches(rows, DETECTED_AT).map((r) => r.touchNumber)).toEqual([1, 2, 3, 4, 5]);
  });

  it('a window holding ONLY a touch-0 row qualifies nothing', () => {
    expect(qualifyingTouches([touch({ touchNumber: 0 })], DETECTED_AT)).toEqual([]);
  });

  it('the D-02 predicate itself is untouched — its SQL twins must stay byte-equivalent', () => {
    // `qualifiesAsTouch` has two SQL copies feeding live metrics; the touch-0
    // exclusion lives only in `qualifyingTouches`.
    const source = readFileSync('src/core/attribution/qualify.ts', 'utf8');
    const start = source.indexOf('export function qualifiesAsTouch');
    const predicate = source.slice(start, source.indexOf('\n}\n', start));
    expect(predicate).not.toContain('ABOUT_QUOTE_TOUCH_NUMBER');
    expect(predicate).not.toContain('touchNumber');
  });
});
