/**
 * The missed-call log's words: the text-back outcome chip, the skip reasons
 * and the caller kinds (Phase 15, CON-06 / D-02; UI-SPEC §2).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A LEAF. IT IMPORTS NOTHING. The vocabularies these maps are keyed by     │
 * │ live in `@/db/schema` (missed-calls, send-ledger), and a VALUE import    │
 * │ from there drags Postgres into any `'use client'` bundle that reaches    │
 * │ this file (research Pitfall 9; `tests/lint-ban.test.ts`                  │
 * │ CLIENT_REACHABLE). So the keys are string literals and the TEST imports  │
 * │ the vocabularies and checks every member has a word.                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * MAPS, NEVER STRING SURGERY on a snake_case value: a reason added to the
 * schema later must fail the pin (`tests/text-back-outcome-labels.test.ts`),
 * not ship to the operator's phone as `daily_cap`.
 *
 * THE STUCK THRESHOLD IS AN ARGUMENT, in milliseconds. The caller passes
 * `TEXT_BACK_STUCK_MINUTES * 60_000` from `@/core/leads/constants`; importing
 * it here would break the "imports nothing" rule for one number.
 */

/** Every word the outcome chip can show. */
export const TEXT_BACK_OUTCOME_LABELS = {
  deciding: 'deciding…',
  undecided: 'undecided',
  sending: 'sending…',
  stuck: 'stuck',
  delivered: 'delivered',
  undelivered: 'undelivered',
  sent: 'sent',
  failed: 'failed',
  stale: 'stale',
  skipped: 'skipped',
} as const;

/** One entry per `TEXT_BACK_SKIP_REASONS` member — pinned, exhaustive. */
export const TEXT_BACK_SKIP_REASON_LABELS: Record<string, string> = {
  not_armed: 'text-back not armed',
  own_number: "the client's own number",
  withheld: 'withheld number',
  not_mobile: 'not a mobile',
  suppressed: 'opted out',
  recent_negative_close: 'recent negative close',
  // 2026-10 (Phase 15, D-08b): the caller converted to a job recently.
  recent_conversion: 'booked recently',
  recent_text: 'texted recently',
  daily_cap: 'daily cap reached',
  // `stale` has its own chip (below); the entry keeps the map exhaustive.
  stale: 'stale',
  sms_not_armed: 'SMS not armed',
  no_template: 'no attested template',
  lead_open: 'lead already open',
  quote_open: 'quote already open',
};

/** The caller line for a non-mobile row. A mobile renders its number instead (D-02). */
export const CALLER_KIND_LABELS = {
  other_number: 'Landline or other number',
  withheld: 'Withheld number',
} as const;

export const AFTER_HOURS_LABEL = 'after hours';

/** A row whose number was pseudonymised (D-06) — the hash is never rendered. */
export const NUMBER_RETIRED_LABEL = 'Mobile · number retired';

/** The three facts a row carries that decide its chip, plus when the call arrived. */
export interface TextBackOutcomeFacts {
  textBackStatus: string | null;
  textBackSkipReason: string | null;
  /** The send-ledger delivery status for the text-back, when one was sent. */
  deliveryStatus: string | null;
  startedAt: Date;
}

export type TextBackOutcomeTone = 'ok' | 'warn' | 'error' | 'neutral';

export interface TextBackOutcome {
  word: string;
  tone: TextBackOutcomeTone;
}

/**
 * The §2 chip table. `now` and the threshold are arguments so the function is
 * pure and the boundary is testable without waiting.
 */
export function resolveTextBackOutcome(
  facts: TextBackOutcomeFacts,
  now: Date,
  stuckAfterMs: number,
): TextBackOutcome {
  const young = now.getTime() - facts.startedAt.getTime() < stuckAfterMs;
  const L = TEXT_BACK_OUTCOME_LABELS;

  switch (facts.textBackStatus) {
    case null:
      return young ? { word: L.deciding, tone: 'neutral' } : { word: L.undecided, tone: 'warn' };
    case 'claimed':
      return young ? { word: L.sending, tone: 'neutral' } : { word: L.stuck, tone: 'warn' };
    case 'sent':
      if (facts.deliveryStatus === 'delivered') return { word: L.delivered, tone: 'ok' };
      if (facts.deliveryStatus === 'undelivered') return { word: L.undelivered, tone: 'error' };
      return { word: L.sent, tone: 'neutral' };
    case 'failed':
      return { word: L.failed, tone: 'error' };
    case 'skipped': {
      const reason = facts.textBackSkipReason;
      if (reason === 'stale') return { word: L.stale, tone: 'warn' };
      if (reason === null) return { word: L.skipped, tone: 'neutral' };
      // The raw reason is a fallback the pin forbids ever reaching: every
      // vocabulary member has an entry.
      return { word: `${L.skipped} — ${TEXT_BACK_SKIP_REASON_LABELS[reason] ?? reason}`, tone: 'neutral' };
    }
    default:
      // A status the schema does not have: nothing decided it, so say so.
      return { word: L.undecided, tone: 'warn' };
  }
}
