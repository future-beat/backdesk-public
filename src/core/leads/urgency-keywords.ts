/**
 * The deterministic emergency rule at the door (Phase 13, D-06; LEAD-03).
 *
 * A reply to a LEAD cadence whose body contains one of `URGENT_KEYWORDS` — as
 * a whole word, or a whole phrase with any whitespace between its words,
 * case-insensitively, ANYWHERE in the message — is hot the moment it arrives.
 * The hot decision for a burst pipe does not wait on a model being reachable,
 * fast or right. The reply is still classified afterwards; this rule only
 * decides that the tradie hears about it now.
 *
 * ── STOP IS ANCHORED, THIS IS NOT, AND THEY RUN IN THAT ORDER ───────────────
 *
 * `isStopMessage` (src/core/messaging/stop-keywords.ts) matches the WHOLE
 * trimmed message: "STOP" is an opt-out, "stop flooding me with texts" is not.
 * This rule matches anywhere, bounded by `\b` on both sides so "urgently",
 * "sparky" and "spark plug" are cold. The door (`handleInboundSms`) decides
 * STOP first, before any lookup, and calls this only for a non-STOP reply that
 * threaded to a lead cadence — a STOP body never reaches it, and a quote reply
 * is never keyword-scanned.
 *
 * ── THE LIST IS PINNED, THE REGEX IS DERIVED ────────────────────────────────
 *
 * `URGENT_KEYWORDS` is D-06's list as research finalised it. The pattern below
 * is built from it at module load, so `tests/urgency-keywords.test.ts` pins the
 * LIST (every member hot in a sentence) rather than a regex literal that could
 * drift from it. There is no negation guard: "not urgent" is hot, by the locked
 * rule (research Open Question 4) — the cost is one extra SMS to the tradie,
 * and the model's `flexible` urgency then sits on the row.
 *
 * PURE AND SILENT. No repository, no clock, no `next/*`, and no log: this
 * function is handed a member of the public's message body, and T-4-02 says
 * that string never reaches a platform log.
 */
import { URGENT_KEYWORDS } from './constants';

/**
 * One alternation, `\b(?:urgent|…|gas\s+leak|…)\b`, case-insensitive.
 *
 * Each keyword is regex-escaped (none needs it today; the next one might), and
 * each run of spaces inside a phrase becomes `\s+`, so "no  power" and
 * "gas\nleak" are the phrases a person meant.
 *
 * NOT a global regex, deliberately: `/g` carries `lastIndex` between calls, so
 * a module-level constant would answer alternately for identical inputs — the
 * same note `stop-keywords.ts` carries.
 */
function phrasePattern(keyword: string): string {
  return keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ +/g, '\\s+');
}

const URGENT_PATTERN = new RegExp(`\\b(?:${URGENT_KEYWORDS.map(phrasePattern).join('|')})\\b`, 'i');

/**
 * True when the body contains an emergency keyword or phrase anywhere.
 *
 * Non-strings answer `false` rather than throwing, the `isStopMessage`
 * convention: this sits one step from an untrusted provider payload, and a
 * throw there becomes a non-2xx the provider retries for 72 hours.
 */
export function isUrgentKeyword(body: string): boolean {
  if (typeof body !== 'string') return false;
  return URGENT_PATTERN.test(body);
}
