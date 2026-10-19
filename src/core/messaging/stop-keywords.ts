/**
 * "Is this entire message an opt-out?" — one regex, one answer, no substrings.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ANCHORED TO THE WHOLE TRIMMED MESSAGE. A KEYWORD IS AN OPT-OUT ONLY WHEN │
 * │ IT IS THE ENTIRE MESSAGE.                                                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The obvious implementation — `body.toLowerCase().includes('stop')` — is wrong
 * in the expensive direction, and it is worth saying exactly how expensive.
 * A match here leads to `suppressFromInbound`, which writes `suppressed_contacts`
 * rows that D-06 makes IRREVERSIBLE: no unsuppress function, no repository
 * mutator, no grant for one (see src/db/schema/suppressed-contacts.ts). So a
 * substring match on "can't stop thinking about the quote" — a customer saying
 * YES — ends that cadence forever, silently, and the tradie's first clue is that
 * their hottest lead went quiet.
 *
 * The opposite error is a Spam Act breach, so the keyword LIST is generous:
 * every word a person plausibly sends when they mean "leave me alone" is here,
 * in every casing, with the punctuation a phone keyboard adds. What is strict is
 * the SHAPE, not the vocabulary.
 *
 * ── WHAT DOES NOT MATCH, AND WHY THAT IS SAFE ───────────────────────────────
 *
 * A body that fails this test is NOT discarded. `handleInboundSms` still writes
 * an `inbound_messages` row with an honest attribution, so the outcome of a
 * near-miss ("STOP?", "unsubscribe me from the newsletter please") is that an
 * operator reads it — never that we ignored somebody. That asymmetry is what
 * makes it safe to be strict here: a false negative costs a human a few minutes,
 * a false positive costs a customer permanently.
 *
 * FRAMEWORK-FREE AND DEPENDENCY-FREE, the shape `primary-contact.ts` follows.
 * Nothing here imports from `next/*`, touches the database, or logs: this
 * function is handed a customer's message body, and T-4-02 (the T-2-02 rule
 * applied at the inbound boundary) says that string never reaches a platform log.
 */

/**
 * The opt-out vocabulary, as one anchored, case-insensitive pattern.
 *
 * Reading it left to right:
 *
 *   ^\s*          leading whitespace — providers wrap bodies, keyboards add
 *                 trailing spaces, and " stop " is a person opting out.
 *   stop\s*all    BEFORE the bare `stop` alternative, because alternation is
 *                 ordered and first-match-wins: with `stop` first, "STOP ALL"
 *                 would match `stop` and then fail on the leftover " ALL",
 *                 making a MORE emphatic opt-out the one that does not register.
 *                 `\s*` covers "stopall", "stop all" and "stop  all".
 *   opt[\s-]?out  "opt out", "opt-out" and "optout" are one word to the person
 *                 typing them.
 *   \s*[.!]?\s*$  ONE optional terminal `.` or `!`, and nothing else. `?` is
 *                 deliberately absent: it turns the same word into a question,
 *                 and a question is for a human to answer, not for an
 *                 irreversible write to assume.
 *
 * The `$` anchor is what makes "stop by tomorrow?" a non-match, and the fact
 * that every alternative is followed immediately by that tail is what makes
 * "stopper", "ended" and "cancelled" non-matches — a longer word beginning with
 * a keyword has characters where the pattern requires the end of the string.
 *
 * NOT a global regex, deliberately: `/g` carries `lastIndex` between calls, so a
 * module-level constant would return alternating answers for identical inputs.
 */
const STOP_PATTERN =
  /^\s*(?:stop\s*all|stop|unsubscribe|cancel|end|quit|opt[\s-]?out)\s*[.!]?\s*$/i;

/**
 * True when the whole message is an opt-out.
 *
 * Non-strings answer `false` rather than throwing. This function sits one step
 * from an untrusted provider payload, and a throw at that boundary is not a
 * safety measure — it becomes a non-2xx response, which ClickSend retries for 72
 * hours and then abandons. `false` keeps the message on the honest path, where
 * it is recorded and an operator sees it.
 */
export function isStopMessage(body: string): boolean {
  if (typeof body !== 'string') return false;
  return STOP_PATTERN.test(body);
}
