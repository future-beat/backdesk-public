/**
 * Who called? — `withheld`, `mobile` or `other_number` (Phase 11, D-06/D-07).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CAPTURE CLASSIFIES; IT DOES NOT DECIDE. Every diverted call is stored,   │
 * │ landlines and international callers included. Whether a caller is ever  │
 * │ texted is Phase 12's gate, which calls `normalizeAuMobile` itself. This  │
 * │ module does NOT replace that normaliser — it wraps it, adding only the   │
 * │ two things a voice `From` needs that a ServiceM8 contact never did.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── "WITHHELD" IS A SET WITH UNKNOWN MEMBERS ────────────────────────────────
 *
 * Twilio reports a withheld caller as `anonymous` (and, historically,
 * `unknown`, `restricted`, `unavailable`), and some carriers deliver keypad
 * spellings of those words as if they were numbers — `+266696687` is
 * "ANONYMOUS". Those sentinel numbers PARSE AS E.164, and one of them stored as
 * an international caller is a number Phase 12 might text. The sentinel list is
 * non-exhaustive by nature, so the rule that makes it non-load-bearing is the
 * last one below: ANYTHING that is not a recognisable number is withheld.
 *
 * ── THE ORDER IS THE CONTRACT ───────────────────────────────────────────────
 *
 *   1. empty / absent               → withheld
 *   2. a known sentinel, as a word or in digits (bare, `+`, or `+1`)
 *                                   → withheld (before anything parses it)
 *   3. `normalizeAuMobile` accepts  → mobile, its E.164
 *   4. E.164 (`+` and 7–15 digits)  → other_number, as given
 *   5. an AU local 02/03/07/08      → other_number, `+61` + the nine digits
 *   6. anything else                → withheld
 *
 * `412345678` (a mobile that lost its leading zero) lands in 6, on purpose:
 * `normalizeAuMobile` refuses to restore the zero because a wrong guess is a
 * message to a stranger, and this module inherits that refusal rather than
 * second-guessing it.
 *
 * Every `withheld` result has `e164: null`. The raw `From` is kept on the row
 * (`caller_raw`) as evidence for the divert spike, never here.
 */
import { normalizeAuMobile } from '@/core/cadence/primary-contact';

export type CallerClassification =
  | { kind: 'withheld'; e164: null }
  | { kind: 'mobile'; e164: string }
  | { kind: 'other_number'; e164: string };

/**
 * Known withheld spellings, compared lower-cased after trimming — the words
 * Twilio has delivered historically, and the keypad spellings it substitutes
 * when a carrier passes one of those words as the caller.
 *
 * THE DIGIT LIST IS TWILIO'S OWN, verified 2026-10-05 against
 * https://help.twilio.com/articles/223179988-Why-am-I-getting-calls-from-these-strange-numbers
 * ("Twilio converts this word to digits and uses those digits as the From
 * parameter"):
 *
 *   RESTRICTED   737 874-2833  → 7378742833
 *   BLOCKED      256-2533      → 2562533
 *   UNKNOWN      865-6696      → 8656696      (missing before WR-01)
 *   ANONYMOUS    266696687     → 266696687
 *   UNAVAILABLE  86282452253   → 86282452253
 *   EMPTY / No Caller ID  464  → 464          (also caught by rule 6 below)
 */
export const WITHHELD_SENTINELS: ReadonlySet<string> = new Set([
  'anonymous',
  'unknown',
  'restricted',
  'unavailable',
  'blocked',
  '+266696687',
  '+7378742833',
  '+86282452253',
  '+2562533',
  '+8656696',
  '+464',
]);

/**
 * The same sentinels as BARE DIGITS (WR-01). A carrier or an intermediate hop
 * may deliver one without its `+`, with a NANP `+1` in front (`+1266696687` has
 * been seen in the wild), or with punctuation — all of which still spell a
 * withheld caller and would otherwise parse as somebody's number.
 */
const SENTINEL_DIGITS: ReadonlySet<string> = new Set([
  '7378742833',
  '2562533',
  '8656696',
  '266696687',
  '86282452253',
  '464',
]);

/**
 * Does this `From` spell one of Twilio's withheld words in digits? Only a value
 * made of nothing but digits, `+`, spaces, dots, dashes and parentheses is
 * considered, and a leading NANP `1` is tried both ways.
 */
function isSentinelDigits(value: string): boolean {
  if (!/^[+\d\s().-]+$/.test(value)) return false;
  const digits = value.replace(/\D/g, '');
  if (SENTINEL_DIGITS.has(digits)) return true;
  return digits.startsWith('1') && SENTINEL_DIGITS.has(digits.slice(1));
}

const E164 = /^\+[1-9]\d{6,14}$/;
const AU_LOCAL_LANDLINE = /^0[2378]\d{8}$/;
const LANDLINE_PUNCTUATION = /[\s()-]/g;

const WITHHELD: CallerClassification = { kind: 'withheld', e164: null };

export function classifyCaller(from: string | null | undefined): CallerClassification {
  if (from == null) return WITHHELD;

  const trimmed = from.trim();
  if (trimmed === '') return WITHHELD;
  if (WITHHELD_SENTINELS.has(trimmed.toLowerCase())) return WITHHELD;
  if (isSentinelDigits(trimmed)) return WITHHELD;

  const mobile = normalizeAuMobile(trimmed);
  if (mobile !== null) return { kind: 'mobile', e164: mobile };

  if (E164.test(trimmed)) return { kind: 'other_number', e164: trimmed };

  const local = trimmed.replace(LANDLINE_PUNCTUATION, '');
  if (AU_LOCAL_LANDLINE.test(local)) return { kind: 'other_number', e164: `+61${local.slice(1)}` };

  return WITHHELD;
}
