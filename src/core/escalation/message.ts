/**
 * The message a tradie actually reads when one of their customers replies
 * "yes" — assembled so the phone number at the end CANNOT be clipped.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A CLIPPED NUMBER IS A LEAD THE TRADIE CANNOT CALL. That single sentence  │
 * │ is the whole design of this file: the `Call them:` line and the mobile   │
 * │ are FIXED CONTENT, assembled AFTER truncation, so no amount of customer  │
 * │ prose can push them off the end of the message. Only the reply text —    │
 * │ and then the quote snippet — ever shrinks.                               │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * PURE, framework-free, dependency-free, and it does not log. It is handed a
 * customer's words and their mobile number, and T-2-02 says neither of those
 * ever reaches a platform log. The same discipline `gsm7.ts` and
 * `stop-keywords.ts` keep, for the same reason.
 *
 * ── THE TEMPLATE IS FIXED BY 06-UI-SPEC (D-07), BYTE FOR BYTE ───────────────
 *
 *   {CustomerFirst} replied about "{quote snippet}": {reply text}
 *   Call them: {customer mobile}
 *
 * Tradies never see a dashboard, so this SMS has to be self-contained: WHO
 * replied, WHAT quote it is about, WHAT they said, and the number to ring. It
 * is the tradie's own customer writing about the tradie's own quote — there is
 * no privacy barrier to forwarding it, and stripping it down to "you have a
 * reply, log in to read it" would delete the entire product moment.
 *
 * ── THE BUDGET IS DERIVED FROM THE SHARED COUNTER, NOT TYPED IN ─────────────
 *
 * Two concatenated segments. `ESCALATION_SEPTET_BUDGET` is computed by asking
 * `segmentCount` — the same function that populates `touch_drafts.segments` —
 * where the second segment ends, rather than by writing `306` down here. A
 * second copy of that arithmetic is how a message bills three segments while a
 * test asserts it bills two.
 *
 * ── AND THE ELLIPSIS IS `...`, NOT `…`, ON PURPOSE ─────────────────────────
 *
 * The spec writes the truncation marker as `…`. That character is not in the
 * GSM 03.38 table, so a single one of them flips the WHOLE message to UCS-2 —
 * where a segment holds 67 characters instead of 153, halving the budget and
 * roughly doubling the bill, silently. `normalizeForGsm7` already knows the
 * canonical form, so the marker is taken FROM the shared canonicalizer rather
 * than typed as three dots that could drift from it.
 *
 * ── WHY UCS-2 IS MODELLED HERE WHEN `gsm7.ts` DECLINES TO ──────────────────
 *
 * `countSeptets` reports UCS-2 as a VIOLATION (which characters made septets
 * inapplicable), because its caller — the drafting validator — wants the model
 * to rewrite the body. This caller cannot: the offending character is in a
 * stranger's SMS, and mutilating a customer's words to save a segment is the
 * transliteration `gsm7.ts` refuses by name. So a UCS-2 body is not an error
 * here; it is a smaller budget, and the smaller budget has to be written
 * somewhere. It is written here, once, and pinned by a test.
 */
import { countSeptets, normalizeForGsm7, segmentCount } from '@/core/drafting/gsm7';

/**
 * No second SMS about the same conversation inside half an hour (D-08,
 * discretion exercised).
 *
 * A customer who fires off three messages in a row — "yes", "when can you
 * start", "also the back gate" — is ONE hot lead, and three buzzes about it
 * teaches the tradie to ignore the fourth. Thirty minutes is long enough that
 * the burst is over and short enough that a genuinely new conversation later in
 * the afternoon still gets through.
 *
 * Suppressed escalations are still RECORDED (`cooldown_suppressed`), never
 * dropped, so Phase 7 can compute honest reach latency instead of reading a gap
 * it cannot explain.
 */
export const ESCALATION_COOLDOWN_MINUTES = 30;

/** Two concatenated segments. The one number a human chose in this file. */
export const ESCALATION_MAX_SEGMENTS = 2;

/**
 * The largest septet count that still fits `ESCALATION_MAX_SEGMENTS`, ASKED of
 * the shared counter rather than written down.
 *
 * Walks upward until `segmentCount` says the next septet would start a third
 * segment. That is ~306 iterations, once, at module load — and it means the day
 * the GSM table or the concatenation header changes, this constant follows
 * instead of disagreeing.
 */
function largestSeptetsWithin(maxSegments: number): number {
  let septets = 1;
  while (segmentCount(septets + 1) <= maxSegments) septets += 1;
  return septets;
}

export const ESCALATION_SEPTET_BUDGET = largestSeptetsWithin(ESCALATION_MAX_SEGMENTS);

/**
 * A UCS-2 segment holds 70 code units alone, 67 when concatenated — the same
 * user-data-header arithmetic `gsm7.ts` documents for GSM-7's 160/153, one
 * encoding over. Stated here because `gsm7.ts` deliberately models only GSM-7;
 * see this file's header.
 */
const UCS2_SINGLE_SEGMENT_UNITS = 70;
const UCS2_CONCATENATED_SEGMENT_UNITS = 67;

export const ESCALATION_UCS2_BUDGET =
  ESCALATION_MAX_SEGMENTS * UCS2_CONCATENATED_SEGMENT_UNITS;

/** `segmentCount`'s shape for the other encoding, including its vacuous floor. */
function ucs2SegmentCount(units: number): number {
  if (units <= 0) return 1;
  if (units <= UCS2_SINGLE_SEGMENT_UNITS) return 1;
  return Math.ceil(units / UCS2_CONCATENATED_SEGMENT_UNITS);
}

/**
 * The truncation marker, taken from the shared canonicalizer.
 *
 * `normalizeForGsm7('…')` is `'...'`. Writing the three dots directly would be
 * the same value with no rule behind it; this way the marker is whatever the
 * one canonical form says it is.
 */
const ELLIPSIS = normalizeForGsm7('…');

/**
 * When the cadence snapshot has no contact name at all.
 *
 * NOT an empty string and not "Customer": the tradie is reading this on a
 * lock screen and needs the sentence to parse as English at a glance.
 */
const NO_NAME = 'Your customer';

/**
 * A first name is a first name. Capped so a pathological `contact_name` — the
 * mirror is somebody else's free-text field — cannot push the fixed skeleton
 * past the budget on its own, which is the one way the number could otherwise
 * be squeezed.
 *
 * Capped BLUNTLY, with no ellipsis: a name ending in `...` reads as a bug
 * rather than as a truncation, and no real first name is 32 characters.
 */
const CUSTOMER_NAME_MAX = 32;

/**
 * A SNIPPET, per the template's own word. The job description is often a
 * paragraph, and quoting all of it would leave no room for the thing the tradie
 * actually needs to read — what the customer just said.
 */
const SNIPPET_MAX = 60;

/**
 * Nothing longer than this can fit in two segments under any encoding, so a
 * reply is cut to it before the shrink loop starts. Bounds the work for a
 * pathological body without changing any outcome.
 */
const REPLY_HARD_CAP = 640;

/** Belt for the shrink loop. Each pass strictly reduces a limit, so it is slack. */
const MAX_SHRINK_STEPS = 4096;

export interface EscalationSmsInput {
  /**
   * The cadence's SNAPSHOT contact name, whole — the builder takes the first
   * whitespace-delimited token itself.
   *
   * The derivation lives here rather than at the call site so there is one
   * answer to "what is their first name" in the system, and so a caller cannot
   * accidentally pass the full name into a template that says `{CustomerFirst}`.
   */
  customerName: string | null;
  /** `quotes.job_description`, or null when the quote has left our mirror. */
  quoteSnippet: string | null;
  /** The customer's inbound SMS, verbatim. */
  replyText: string | null;
  /** NORMALIZED E.164, or null when the cadence snapshot holds no mobile. */
  customerMobile: string | null;
}

export interface EscalationSms {
  /** What goes on the wire, verbatim. */
  body: string;
  /** As the shared counter measured it — written to `escalations.body_segments`. */
  segments: number;
  encoding: 'gsm7' | 'ucs2';
  /** Whether anything had to shrink. Evidence, not a control. */
  truncated: boolean;
}

/** Code points, never UTF-16 units: slicing a surrogate pair produces mojibake. */
function pointsOf(text: string): string[] {
  return Array.from(text);
}

/**
 * Untrusted text made safe for a plain SMS, in the drafting sanitizer's shape.
 *
 * THE INJECTION HERE IS A NEWLINE, NOT CODE. There is no parser downstream —
 * the reader is a human holding a phone — so the attack is FORGING STRUCTURE:
 * a blank line followed by `Call them: 0400 000 000` in the reply text would
 * render as a second, attacker-chosen call-to-action under the real one. C0/C1
 * control characters go to spaces (invisible on a handset, meaningful to
 * anything that lays text out), runs of whitespace collapse to one, and the
 * result is trimmed — so the body this file assembles is exactly as many lines
 * as this file decided to write.
 *
 * `normalizeForGsm7` runs on the way through. It repairs the five predictable
 * lookalikes and NOTHING ELSE — an accent survives (and is free in GSM-7
 * anyway), an emoji survives and costs a UCS-2 budget. Repairing a curly
 * apostrophe is meaning-preserving and saves a segment; anything more would be
 * editing a customer's words behind everybody's back.
 */
function sanitize(value: string | null | undefined): string {
  if (value == null) return '';
  return normalizeForGsm7(value)
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cut to `limit` code points, bluntly. No marker — see `CUSTOMER_NAME_MAX`. */
function capPoints(text: string, limit: number): string {
  const points = pointsOf(text);
  return points.length <= limit ? text : points.slice(0, limit).join('');
}

/**
 * `text` cut to `limit` code points with the ellipsis appended, or dropped
 * entirely at zero.
 *
 * `trimEnd` before the marker so a cut landing on a space produces `three ...`
 * rather than `three  ...`.
 */
function clip(text: string, limit: number): string {
  const points = pointsOf(text);
  if (limit >= points.length) return text;
  if (limit <= 0) return '';
  return `${points.slice(0, limit).join('').trimEnd()}${ELLIPSIS}`;
}

/** The first whitespace-delimited token, capped, or the neutral fallback. */
function firstNameOf(raw: string | null, fallback: string = NO_NAME): string {
  const first = sanitize(raw).split(' ')[0] ?? '';
  const capped = capPoints(first, CUSTOMER_NAME_MAX);
  return capped === '' ? fallback : capped;
}

/**
 * THE TEMPLATE, and the three graceful degradations of it.
 *
 * The first branch is the 06-UI-SPEC line byte for byte. The others exist
 * because a missing snippet must not render as `about ""` and a missing reply
 * must not render as a dangling colon — a message that looks broken is one a
 * tradie distrusts, and distrust of the alert channel is the failure this whole
 * mechanism is built to avoid.
 *
 * The call line is appended LAST, always, and never participates in truncation.
 */
function assemble(first: string, snippet: string, reply: string, callLine: string): string {
  let head: string;
  if (snippet !== '' && reply !== '') {
    head = `${first} replied about "${snippet}": ${reply}`;
  } else if (snippet !== '') {
    head = `${first} replied about "${snippet}".`;
  } else if (reply !== '') {
    head = `${first} replied: ${reply}`;
  } else {
    head = `${first} replied.`;
  }

  return callLine === '' ? head : `${head}\n${callLine}`;
}

interface Cost {
  encoding: 'gsm7' | 'ucs2';
  units: number;
  budget: number;
  segments: number;
}

/** What this body costs, MEASURED BY THE SHARED COUNTER. See the header. */
function costOf(body: string): Cost {
  const counted = countSeptets(body);
  if (counted.encoding === 'gsm7') {
    return {
      encoding: 'gsm7',
      units: counted.septets,
      budget: ESCALATION_SEPTET_BUDGET,
      segments: segmentCount(counted.septets),
    };
  }

  const units = pointsOf(body).length;
  return {
    encoding: 'ucs2',
    units,
    budget: ESCALATION_UCS2_BUDGET,
    segments: ucs2SegmentCount(units),
  };
}

/**
 * The hot-lead SMS, complete and bounded.
 *
 * ── FIXED PARTS FIRST (research A3, made physical) ─────────────────────────
 *
 * The name, the frame, the `Call them:` line and the number are measured as
 * given; only the REPLY shrinks, and only when the reply has been shrunk to
 * nothing does the SNIPPET start to. That order is the priority order of the
 * message: the tradie needs the number, then who and what, then as much of the
 * words as fits.
 *
 * The one case where the budget is deliberately exceeded rather than honoured
 * is a fixed skeleton that cannot fit on its own — a caller that passed a
 * 400-character "mobile", say. Costing an extra segment is the right failure;
 * cutting the number is not. With a normalized E.164 mobile and the name cap
 * above, that case cannot arise, which is what makes the property assertable.
 */
export function buildEscalationSms(input: EscalationSmsInput): EscalationSms {
  const first = firstNameOf(input.customerName);
  const snippetFull = capPoints(sanitize(input.quoteSnippet), SNIPPET_MAX);
  const replyFull = capPoints(sanitize(input.replyText), REPLY_HARD_CAP);

  const mobile = (input.customerMobile ?? '').trim();
  const callLine = mobile === '' ? '' : `Call them: ${mobile}`;

  let replyLimit = pointsOf(replyFull).length;
  let snippetLimit = pointsOf(snippetFull).length;
  let truncated =
    replyLimit < pointsOf(sanitize(input.replyText)).length ||
    snippetLimit < pointsOf(sanitize(input.quoteSnippet)).length;

  let body = assemble(first, snippetFull, replyFull, callLine);
  let cost = costOf(body);

  for (let step = 0; cost.units > cost.budget && step < MAX_SHRINK_STEPS; step += 1) {
    // At least one code point per pass, so the loop always terminates; more
    // when we already know how far over we are. The re-measure below is what
    // absorbs the ellipsis the cut adds back.
    const over = Math.max(1, cost.units - cost.budget);

    if (replyLimit > 0) {
      replyLimit = Math.max(0, replyLimit - over);
    } else if (snippetLimit > 0) {
      snippetLimit = Math.max(0, snippetLimit - over);
    } else {
      // Nothing left that MAY shrink. The number stays whole — see the header.
      break;
    }

    truncated = true;
    body = assemble(first, clip(snippetFull, snippetLimit), clip(replyFull, replyLimit), callLine);
    cost = costOf(body);
  }

  return { body, segments: cost.segments, encoding: cost.encoding, truncated };
}

/* ------------------------------------------------------------------------- *
 * The quote-call escalation (Phase 12, 12-05, D-16)
 * ------------------------------------------------------------------------- */

/**
 * When the quote cadence's snapshot has no contact name. Says WHICH kind of
 * customer it is, because the trigger is a call from a number on an open
 * quote — the one thing the tradie can act on without a name.
 */
const NO_QUOTE_CALL_NAME = 'A quote customer';

export interface QuoteCallEscalationSmsInput {
  /** The quote cadence's SNAPSHOT contact name, whole (first token taken here). */
  customerName: string | null;
  /** `quotes.job_description`, or null when the quote has left our mirror. */
  quoteSnippet: string | null;
  /** NORMALIZED E.164 — the number that rang, from the cadence snapshot. */
  customerMobile: string | null;
  /**
   * The about-quote text to this customer was accepted by the provider
   * (`send_ledger` touch 0, outcome `sent`). False covers a refusal AND an
   * outcome nobody knows yet — neither may be told to the tradie as "texted".
   */
  textSent: boolean;
}

/** The fixed sentence that says whether the customer was texted. */
function textSentence(textSent: boolean): string {
  return textSent
    ? 'We texted them back about their quote.'
    : 'Our text back to them is not confirmed.';
}

/**
 * The quote-call SMS: a quote customer rang the tradie and was missed (D-16).
 *
 *   {First} rang about "{quote snippet}" and was missed. {text sentence}
 *   Call them: {customer mobile}
 *
 * A SIBLING of `buildEscalationSms`, sharing everything that makes that one
 * safe: the same sanitizer (no forged lines), the same first-name derivation
 * and cap, the same snippet cap and ellipsis, the same budget derived from the
 * shared counter (`ESCALATION_SEPTET_BUDGET` — no number typed here), and the
 * same rule that the `Call them:` line is fixed content assembled LAST and
 * never truncated. There is no customer prose in this one, so the SNIPPET is
 * the only part that can shrink; with the name and snippet caps it fits two
 * segments with room to spare, and the loop is the belt for a pathological
 * UCS-2 name.
 */
export function buildQuoteCallEscalationSms(input: QuoteCallEscalationSmsInput): EscalationSms {
  const first = firstNameOf(input.customerName, NO_QUOTE_CALL_NAME);
  const snippetFull = capPoints(sanitize(input.quoteSnippet), SNIPPET_MAX);
  const mobile = (input.customerMobile ?? '').trim();
  const callLine = mobile === '' ? '' : `Call them: ${mobile}`;
  const sentence = textSentence(input.textSent);

  const assembleCall = (snippet: string): string => {
    const head =
      snippet === ''
        ? `${first} rang and was missed. ${sentence}`
        : `${first} rang about "${snippet}" and was missed. ${sentence}`;
    return callLine === '' ? head : `${head}\n${callLine}`;
  };

  let snippetLimit = pointsOf(snippetFull).length;
  let truncated = snippetLimit < pointsOf(sanitize(input.quoteSnippet)).length;
  let body = assembleCall(snippetFull);
  let cost = costOf(body);

  for (let step = 0; cost.units > cost.budget && step < MAX_SHRINK_STEPS; step += 1) {
    if (snippetLimit === 0) break; // Nothing left that MAY shrink; the number stays whole.
    snippetLimit = Math.max(0, snippetLimit - Math.max(1, cost.units - cost.budget));
    truncated = true;
    body = assembleCall(clip(snippetFull, snippetLimit));
    cost = costOf(body);
  }

  return { body, segments: cost.segments, encoding: cost.encoding, truncated };
}

/* ------------------------------------------------------------------------- *
 * The ring-twice escalation (Phase 13, plan 13-06, D-07)
 * ------------------------------------------------------------------------- */

export interface RingTwiceEscalationSmsInput {
  /** NORMALIZED E.164 — the number that rang twice, read after the claim. */
  customerMobile: string | null;
  /**
   * The ring-twice window the second call fell inside —
   * `RING_TWICE_WINDOW_MINUTES`, passed by the caller so this module keeps
   * importing nothing but the shared counter.
   */
  minutes: number;
}

/**
 * The ring-twice SMS: a caller with an open lead rang the tradie a second time
 * inside the window and was missed again (D-07).
 *
 *   A caller rang twice in {N} minutes and was missed.
 *   Call them: {customer mobile}
 *
 * The caller got NO second text (the Phase 12 gate decided that) — this alert
 * is the only thing the second call produces, and it goes to the tradie. A
 * FIXED SENTENCE: there is no reply text and no quote, and a lead has no name
 * we could trust, so nothing in the body is customer prose and nothing needs
 * the sanitizer. The `Call them:` line is assembled last and never truncated,
 * as in its siblings; the cost is measured by the same shared counter, and a
 * fixed sentence plus an E.164 number fits one segment with room to spare.
 */
export function buildRingTwiceEscalationSms(input: RingTwiceEscalationSmsInput): EscalationSms {
  const mobile = (input.customerMobile ?? '').trim();
  const head = `A caller rang twice in ${input.minutes} minutes and was missed.`;
  const body = mobile === '' ? head : `${head}\nCall them: ${mobile}`;
  const cost = costOf(body);

  return { body, segments: cost.segments, encoding: cost.encoding, truncated: false };
}
