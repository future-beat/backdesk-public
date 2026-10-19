/**
 * The merge facts, and the whitelist derived from them. ONE DEFINITION.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE VALIDATOR'S WHITELIST IS BUILT HERE, AND ONLY HERE. Two callers now  │
 * │ need it — the drafting pass that writes a draft, and the console action  │
 * │ that re-validates an operator's EDIT of that draft — and if they built   │
 * │ it separately they could disagree.                                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── WHY A DISAGREEMENT HERE IS WORSE THAN A BUG ─────────────────────────────
 *
 * `validate.ts` refuses any digit-bearing token the caller did not supply. Which
 * tokens were "supplied" is decided by this file. So a second implementation
 * that rendered `$2450` where this one renders `$2,450`, or that formatted the
 * quote date in the server's zone rather than the tenant's, would not fail
 * loudly — it would make the re-validation of an operator's edit REFUSE the
 * exact price the draft was written with, or (the expensive direction) ACCEPT a
 * number the drafting pass never gave the model. The whole point of re-running
 * the validator over an edited body is that it is the SAME validator with the
 * SAME whitelist; one copy of these four functions is what makes that true.
 *
 * `draft-touches.ts` held these privately until 05-07 needed them at the
 * approval boundary. Nothing about the rendering changed in the move.
 *
 * ── EVERY FACT COMES FROM OUR OWN MIRROR (D-02) ─────────────────────────────
 *
 * The inputs are columns of `quotes` and `cadences`, never a live ServiceM8
 * read and never anything the model produced. A fact that is absent stays
 * absent: `null` in, `null` out, and the prompt is written to compose around a
 * missing value rather than to guess one.
 *
 * PURE — no I/O, no clock of its own (`now` is passed), no logging. It is handed
 * a customer's name and their price, and per T-2-02 it does not log them.
 */

/**
 * `'$2,450'` from `'2450.00'`, and `'$2,437.50'` from `'2437.50'`.
 *
 * ── THE CENTS ARE PART OF THE PRICE ─────────────────────────────────────────
 *
 * An earlier version of this function did `Math.trunc(cents / 100)` and rendered
 * `'2437.50'` as `$2,437`. That is not a formatting preference: the string goes
 * straight into `allowedDisplayStrings`, so `validateDraft` PERMITS it by
 * construction — the validator's contract is "the model may only reproduce what
 * the caller supplied", and the caller supplied a figure the tradie never quoted.
 * The human gate does not catch it either, because `$2,437` is a plausible price
 * for a job the operator has never seen. Whole dollars are rendered bare only
 * when the quote really is whole dollars.
 *
 * ── AN ABSENT FACT STAYS ABSENT (D-02) ──────────────────────────────────────
 *
 * `Number('')` is `0`, so a blank or whitespace-only column would otherwise
 * render `$0` — a quote that reads as free. Empty in, `null` out; the prompt is
 * written to compose around a missing value rather than around a wrong one.
 *
 * The `* 100` is a float multiply. At Australian quote magnitudes (cents well
 * inside `Number.MAX_SAFE_INTEGER`) `Math.round` recovers the exact cent, and
 * the alternative — a hand-rolled decimal-string parser — is more surface than
 * the problem deserves. The rounding is what makes it safe, not the type.
 */
export function renderMoney(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;

  const cents = Math.round(value * 100);
  const whole = Math.trunc(cents / 100);
  const remainder = Math.abs(cents % 100);
  const dollars = whole.toLocaleString('en-AU');
  return remainder === 0
    ? `$${dollars}`
    : `$${dollars}.${String(remainder).padStart(2, '0')}`;
}

/**
 * `'12 August'` in the TENANT's zone — never the server's.
 *
 * An unusable zone is a tenant-configuration problem, not a reason to render a
 * date in the wrong timezone. The fact is omitted; both the prompt and the
 * whitelist are written to cope with an absent value, and a date shifted by
 * eight hours would be a WRONG fact rather than a missing one.
 */
export function renderQuoteDate(at: Date | null, timeZone: string): string | null {
  if (at === null) return null;
  try {
    return new Intl.DateTimeFormat('en-AU', {
      day: 'numeric',
      month: 'long',
      timeZone,
    }).format(at);
  } catch {
    return null;
  }
}

/**
 * Whole days since the cadence anchor, as a display string.
 *
 * FLOORED AND CLAMPED AT ZERO. A clock skew that put `now` before the anchor
 * would otherwise render `-1`, and the validator would see a token nobody
 * supplied — a draft refused for a reason no regeneration can fix.
 */
export function renderDaysSince(anchorAt: Date | null, now: Date): string | null {
  if (anchorAt === null) return null;
  const days = Math.floor((now.getTime() - anchorAt.getTime()) / 86_400_000);
  return String(Math.max(0, days));
}

/** The first word of a contact name, or `null` when there is nothing to use. */
export function firstName(full: string | null): string | null {
  const trimmed = (full ?? '').trim();
  if (trimmed === '') return null;
  return trimmed.split(/\s+/)[0] ?? null;
}

/** The mirror columns these facts are rendered from. */
export interface MergeFactSources {
  /** `quotes.total_invoice_amount` — `numeric`, so a string. */
  totalInvoiceAmount: string | null;
  /** `quotes.quote_date_utc`. */
  quoteDateUtc: Date | null;
  /** `cadences.anchor_at` — what "days since" counts from. */
  anchorAt: Date | null;
  /** `cadences.contact_name` — the D-04 snapshot, not a live lookup. */
  contactName: string | null;
  /** The TENANT's IANA zone. The date is rendered in it, never the server's. */
  timezone: string;
  /** Injected, never `new Date()` here — the same rule the cadence rules follow. */
  now: Date;
}

export interface MergeFacts {
  contactFirstName: string | null;
  totalDisplay: string | null;
  quoteDateDisplay: string | null;
  daysSinceDisplay: string | null;
  /**
   * Every number-bearing string the model was permitted to reproduce — the
   * validator's whitelist AND the prompt's permitted list, which are ONE list
   * by construction rather than by two callers agreeing.
   *
   * The contact's first name is deliberately NOT in it: it carries no digits,
   * so it is not what this list is for, and adding it would whitelist any digit
   * run inside a name like "24/7 Bob".
   */
  allowedDisplayStrings: string[];
}

export function buildMergeFacts(sources: MergeFactSources): MergeFacts {
  const totalDisplay = renderMoney(sources.totalInvoiceAmount);
  const quoteDateDisplay = renderQuoteDate(sources.quoteDateUtc, sources.timezone);
  const daysSinceDisplay = renderDaysSince(sources.anchorAt, sources.now);

  return {
    contactFirstName: firstName(sources.contactName),
    totalDisplay,
    quoteDateDisplay,
    daysSinceDisplay,
    allowedDisplayStrings: [totalDisplay, quoteDateDisplay, daysSinceDisplay].filter(
      (value): value is string => value !== null,
    ),
  };
}
