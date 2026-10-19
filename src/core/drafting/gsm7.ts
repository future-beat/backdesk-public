/**
 * GSM 03.38 septet arithmetic — what an SMS actually costs, as opposed to what
 * `String.length` guesses it costs.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ONE CURLY APOSTROPHE TRIPLES THE BILL. That is the whole reason this     │
 * │ file exists, and it is not an exaggeration.                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * A 150-character follow-up sent as GSM-7 is one segment. The same message with
 * `it’s` instead of `it's` cannot be encoded in GSM-7 at all, so the WHOLE
 * message flips to UCS-2, where a segment holds 67 characters instead of 153 —
 * 150 characters becomes three segments at ClickSend's ~7.9c each. Nothing
 * errors, nothing warns; the invoice is just 3x. D-03's segment cap is therefore
 * meaningless unless the count behind it is septet-true, and `body.length / 153`
 * (the tracer's interim arm, which this file replaces) is not.
 *
 * ── WHY A HARDCODED TABLE AND NOT A LIBRARY ─────────────────────────────────
 *
 * GSM 03.38 was frozen in 2003 and has not moved since. The table below cannot
 * go stale, which makes it the rare case where copying the data in beats taking
 * a dependency: an npm package for this is ~40 lines of table plus a supply
 * chain. The counting rules are pinned by known-answer tests in
 * `tests/gsm7.test.ts` against the published limits, so a typo in the table
 * fails a test rather than a customer's invoice.
 *
 * PURE, framework-free, dependency-free, and it does not log — the discipline
 * `stop-keywords.ts` set. It is handed message bodies, and T-2-02 says those
 * never reach a platform log.
 */

/**
 * The GSM 03.38 basic character table — 127 characters, one septet each.
 *
 * Written in code-point order (0x00–0x7F) so it can be checked against the
 * published table by eye, with ONE deliberate omission: 0x1B is ESC, the
 * escape byte that introduces an extension character, and it is not a character
 * anybody types. Its absence is why the length below is 127 and not 128.
 *
 * The non-ASCII members are not decoration. `£`, `¥`, `§`, `¿` and the accented
 * vowels are genuinely free in GSM-7 while `’` and `–` are not, which is
 * counter-intuitive enough that treating "non-ASCII" as a proxy for "expensive"
 * — the tracer's interim rule — was both wrong and, usefully, wrong in the
 * over-strict direction.
 */
const GSM_BASIC_CHARS =
  '@£$¥èéùìòÇ' + // 0x00–0x09
  '\n' + // 0x0A  LF
  'Øø' + // 0x0B–0x0C
  '\r' + // 0x0D  CR
  'Åå' + // 0x0E–0x0F
  'Δ_ΦΓΛΩΠΨΣΘΞ' + // 0x10–0x1A  (0x1B = ESC, omitted)
  'ÆæßÉ' + // 0x1C–0x1F
  ' !"#¤%&\'()*+,-./' + // 0x20–0x2F
  '0123456789' + // 0x30–0x39
  ':;<=>?' + // 0x3A–0x3F
  '¡' + // 0x40
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ' + // 0x41–0x5A
  'ÄÖÑÜ§' + // 0x5B–0x5F
  '¿' + // 0x60
  'abcdefghijklmnopqrstuvwxyz' + // 0x61–0x7A
  'äöñüà'; // 0x7B–0x7F

/** Membership set. Built once; the string above is the reviewable artifact. */
const GSM_BASIC = new Set([...GSM_BASIC_CHARS]);

/**
 * The extension table — EXACTLY NINE characters, each costing TWO septets
 * because each is transmitted as ESC followed by its code.
 *
 * The count is asserted in the tests. Nine is the number every published table
 * agrees on, and a tenth member appearing here would mean somebody added a
 * character that is not actually free-standing in the extension plane — which
 * would under-count a message and let a three-segment body bill as two.
 *
 * `€` is the one that shows up in practice; the brackets and braces are the ones
 * a model emits when it decides to be helpful with formatting.
 */
const GSM_EXTENDED = new Set(['^', '{', '}', '\\', '[', ']', '~', '|', '€']);

/** Number of members in the extension table. Exported for the test that pins it. */
export const GSM_EXTENDED_SIZE = GSM_EXTENDED.size;

/** Number of members in the basic table. Exported for the same reason. */
export const GSM_BASIC_SIZE = GSM_BASIC.size;

/**
 * The result of counting — DISCRIMINATED, not a number.
 *
 * "Too long" and "encoded differently" are different failures with different
 * fixes, and collapsing them into one integer is exactly how a UCS-2 flip
 * becomes invisible. A caller that receives `{ encoding: 'ucs2' }` knows the
 * body must be REWRITTEN (a character has to go), not merely SHORTENED.
 *
 * The `ucs2` arm carries the offending characters so the validator can name them
 * in a violation the model can act on — "your draft contained ’" is a fixable
 * instruction; "your draft was too long" is not.
 */
export type SeptetCount =
  | { encoding: 'gsm7'; septets: number }
  | { encoding: 'ucs2'; unsupported: string[] };

/**
 * Septets for a body, or the characters that make septets inapplicable.
 *
 * Iterates CODE POINTS, not UTF-16 units: an emoji is one unsupported character
 * to report, not two lone surrogates that mean nothing to anybody reading the
 * violation.
 *
 * `countSeptets('')` is `{ encoding: 'gsm7', septets: 0 }` — an empty body is
 * not an encoding problem. It is a separate, harder failure that
 * `validateDraft` reports on its own.
 */
export function countSeptets(body: string): SeptetCount {
  let septets = 0;
  const unsupported: string[] = [];
  const seen = new Set<string>();

  for (const ch of body) {
    if (GSM_BASIC.has(ch)) {
      septets += 1;
    } else if (GSM_EXTENDED.has(ch)) {
      septets += 2;
    } else if (!seen.has(ch)) {
      seen.add(ch);
      unsupported.push(ch);
    }
  }

  // Reported in first-appearance order and de-duplicated: the same smart quote
  // eight times is one thing to fix, not eight violations.
  if (unsupported.length > 0) return { encoding: 'ucs2', unsupported };
  return { encoding: 'gsm7', septets };
}

/** A single (non-concatenated) GSM-7 message. No UDH, so the full 160. */
const SINGLE_SEGMENT_SEPTETS = 160;

/**
 * A segment of a CONCATENATED message. The 7 missing septets are the
 * user-data header that tells the handset how to reassemble the parts — which
 * is why 161 septets costs two segments of 153 rather than 160 + 1.
 */
const CONCATENATED_SEGMENT_SEPTETS = 153;

/**
 * Segments for a septet count.
 *
 * `segmentCount(0) === 1` is a documented VACUOUS FLOOR, not a real message. No
 * carrier bills a zero-length send because no such send exists; returning 0
 * would make an empty body look like the cheapest possible draft to any caller
 * that only reads this number. The empty body is caught upstream as its own
 * violation, so this floor is never the thing that decides anything — it is
 * just refusing to describe nothing as free.
 */
export function segmentCount(septets: number): number {
  if (septets <= 0) return 1;
  if (septets <= SINGLE_SEGMENT_SEPTETS) return 1;
  return Math.ceil(septets / CONCATENATED_SEGMENT_SEPTETS);
}

/**
 * Repair the predictable lookalikes, AND NOTHING ELSE.
 *
 * These five substitutions are the characters Claude emits when writing prose
 * that a person would type with a plain keyboard: smart quotes, a dash it
 * thinks is typographically correct, an ellipsis glyph, and the non-breaking
 * space that arrives with a copied phrase. Each has an exact, meaning-preserving
 * ASCII equivalent, so repairing them costs nothing and saves a regeneration
 * round trip on the single most common way a draft fails.
 *
 * ── WHY THIS IS NOT A TRANSLITERATOR ────────────────────────────────────────
 *
 * The tempting next step is stripping accents, mapping `é → e`, or dropping
 * anything unrecognised. That would be silent MUTILATION of a customer's name
 * (and `é` is free in GSM-7 anyway — see the basic table). Worse, it would mean
 * the validator never sees the character that caused the problem, so a model
 * that keeps emitting emoji would keep "passing" while its output was quietly
 * edited on the way to a customer's phone.
 *
 * So: anything not on this list SURVIVES normalization and becomes the
 * validator's violation to report. Repair what is unambiguous; refuse the rest;
 * never edit a body behind an operator's back.
 */
const LOOKALIKES: ReadonlyArray<readonly [RegExp, string]> = [
  [/[‘’‚‛]/g, "'"], // curly / low / reversed single quotes
  [/[“”„‟]/g, '"'], // curly / low / reversed double quotes
  [/[–—−]/g, '-'], // en dash, em dash, minus sign
  [/…/g, '...'], // horizontal ellipsis
  [/[  ]/g, ' '], // non-breaking / narrow no-break space
];

/**
 * The canonical form of a body: lookalikes repaired, everything else untouched.
 *
 * ONE CANONICAL FORM IS THE POINT. The bytes an operator approves and the bytes
 * ClickSend sends must be identical, so normalization happens once, before the
 * body is stored, and never again on the way out (Pitfall 6: approval covering
 * different bytes than dispatch sends). This function is idempotent, so calling
 * it defensively at the validator is safe.
 */
export function normalizeForGsm7(body: string): string {
  let out = body;
  for (const [pattern, replacement] of LOOKALIKES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
