/**
 * THE TRUST BOUNDARY. Model output crosses into a customer's phone here.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ MECHANICAL, NOT PERSUASIVE. The prompt ASKS the model not to invent a    │
 * │ price. This function is what makes asking unnecessary.                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * T-5-01/T-5-06 is the threat: a fabricated price or date reaching a customer in
 * a tradie's name. There are two defences and they are not redundant. The human
 * approval gate (D-12) catches what a person notices; this catches what a person
 * skims past. `$2,450` misread as `$2,540` at 7am on a phone is exactly the
 * error a human gate does not reliably stop, and it is the error a string
 * comparison stops every time.
 *
 * So the rule is not "does the number look plausible" — it is: EVERY
 * DIGIT-BEARING TOKEN IN THE BODY MUST BE ONE THE CALLER SUPPLIED. A model that
 * writes a number nobody gave it has failed, whatever the number says.
 *
 * PURE, framework-free, no I/O — the discipline `stop-keywords.ts` set. The
 * whole point of this file is that it can be exhaustively tested without a
 * database, a network or a model. Its only imports are `gsm7.ts` (the septet
 * arithmetic), `edit-distance.ts` (to name the nearest allowed value in a
 * refusal, so the D-11 regeneration has something actionable to work from) and
 * the import-free `@/core/shared/link-pattern` leaf (Rule 5, 13-REVIEW WR-02).
 *
 * ── ONE CANONICAL FORM (Pitfall 6) ──────────────────────────────────────────
 *
 * The body is NORMALIZED FIRST, and `normalizedBody` comes back on both arms of
 * the result. Every violation reported describes those bytes, and those are the
 * bytes the caller must store, show the operator, and hand to the provider. The
 * alternative — validating one form and sending another — means an operator
 * approves a message that is not the message that goes out, which is the whole
 * point of the approval gate defeated by a whitespace detail.
 *
 * ── FAILING CONSERVATIVELY IS THE DESIGN, NOT A LIMITATION (D-11) ───────────
 *
 * Every rule below is tuned to over-refuse rather than under-refuse. A false
 * refusal costs one regeneration and, at worst, a human writing the message
 * themselves. A false pass costs a wrong price on a customer's phone, sent in a
 * tradie's name, which is the failure this product cannot have.
 */
// Relative on purpose: scripts/verify-drafting.mjs loads this module through
// scripts/lib/ts-resolve-hooks.mjs, which resolves relative specifiers only.
import { LINK_PATTERN } from '../shared/link-pattern';

import { normalizedEditDistance } from './edit-distance';
import { countSeptets, normalizeForGsm7, segmentCount } from './gsm7';

/**
 * A machine-readable refusal. Stored in `touch_drafts.validator_failures` as an
 * array so the question anybody asks of that column — "how often does rule X
 * fire" — is a GROUP BY rather than a substring search over sentences.
 */
export interface DraftViolation {
  /** The rule that fired. A closed set; see the emitters below. */
  rule:
    | 'empty_body'
    | 'unlisted_number'
    | 'unlisted_date_word'
    | 'non_gsm_character'
    | 'too_many_segments'
    | 'missing_suffix'
    | 'link';
  /**
   * The offending fragment — the token, the character, the segment count.
   *
   * SAFE TO STORE: it is a fragment of a body that is itself stored in the same
   * row. It is NOT safe to log, for the same reason the body is not — see the
   * touch-drafts schema header (T-5-03).
   */
  detail?: string;
  /**
   * For `unlisted_number`: the supplied display string this token most
   * resembles.
   *
   * This exists for D-11. "Your draft contained $2,540, which is not a provided
   * value; the provided value is $2,450" is an instruction a model can follow on
   * the second attempt. "Invalid number" is not, and a regeneration loop whose
   * feedback the model cannot act on is a loop that burns two calls and fails
   * twice.
   */
  nearest?: string;
}

export type ValidateDraftResult =
  | { ok: true; segments: number; normalizedBody: string }
  | { ok: false; violations: DraftViolation[]; normalizedBody: string };

export interface ValidateDraftInput {
  /** The FINAL body — generated text plus the mechanical compliance suffix. */
  body: string;
  /**
   * Every number-bearing string the model was permitted to reproduce, exactly
   * as it was given them (`'$2,450'`, `'12 August'`, `'14'`).
   */
  allowedDisplayStrings: readonly string[];
  /**
   * The exact compliance line the caller appended — `complianceSuffix(name)`.
   *
   * Checked for PRESENCE, not composed here. The Spam Act sentence is written
   * mechanically by the caller and this is the belt on that brace: a body that
   * reaches the provider without sender identification and an opt-out facility
   * is a breach, and "the caller definitely appended it" is a claim worth
   * verifying at the boundary rather than trusting across one.
   */
  expectedSuffix: string;
  /**
   * Phase 13 (D-13; 13-REVIEW WR-02): refuse link-shaped text in the MODEL'S
   * text (Rule 5). OPT-IN, so the quote path is byte-for-byte unchanged (D-17):
   * a lead draft passes `true`, at drafting and again at edit-then-approve.
   */
  forbidLinks?: boolean;
}

/**
 * D-03 caps a follow-up at two segments. THE CAP IS "OVER TWO", so exactly two
 * passes. Three segments is three times the cost and reads as a wall of text on
 * a handset.
 */
const MAX_SEGMENTS = 2;

/**
 * Every MAXIMAL run of digits with the punctuation that binds to them.
 *
 * ── WHY MAXIMAL IS THE LOAD-BEARING WORD ────────────────────────────────────
 *
 * `[\d,.]*` is greedy, so a run swallows every digit-ish character that follows
 * it. That is what makes the ADJACENCY ATTACK fail: a model that writes the
 * amount and the day-count with nothing between them produces `$2,45014`, ONE
 * run, which is not a supplied value and is refused. A non-greedy or
 * per-character scan would see `$2,450` followed by `14`, find both on the
 * whitelist, and pass a number that was never given to it.
 *
 * The optional leading `$` is part of the run so `'$2,450'` is one token
 * matching one display string, rather than a stray dollar sign next to a number.
 */
const NUMBER_TOKEN = /\$?\d[\d,.]*/g;

/**
 * Month and weekday names in CANONICAL CAPITALIZATION, matched case-sensitively.
 *
 * ── WHY CASE-SENSITIVE, WHICH LOOKS LIKE A BUG ──────────────────────────────
 *
 * Case-insensitive matching is the obvious choice and it is wrong here, because
 * five of these words are ordinary English: "you MAY want to", "we SAT down",
 * "in the SUN", "MARCH". A case-insensitive rule refuses those drafts, and a
 * validator that refuses correct output teaches an operator to click past
 * refusals — which costs far more than it saves.
 *
 * A date written to a customer is capitalized, because that is how English
 * writes proper nouns and it is how every example message and every template is
 * written. So the capitalized forms are the ones that carry date meaning, and
 * they are the ones checked. The residue — a model writing "next august" in
 * lower case — is covered by the fact that a date it fabricates almost always
 * carries a digit the number rule catches, and by the human approval gate behind
 * this one.
 */
const DATE_WORD = new RegExp(
  '\\b(?:' +
    'January|February|March|April|May|June|July|August|September|October|November|December' +
    '|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec' +
    '|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday' +
    '|Mon|Tue|Tues|Wed|Thu|Thurs|Fri|Sat|Sun' +
    ')\\b',
  'g',
);

/** Trailing sentence punctuation on a number — `'…$2,450.'` ends a clause. */
function trimNumberPunctuation(token: string): string {
  return token.replace(/[.,]+$/, '');
}

/**
 * The digit runs a supplied display string actually contains.
 *
 * ── WHY THE WHITELIST IS RUNS AND NOT SUBSTRINGS ────────────────────────────
 *
 * The obvious membership test is "the token is a substring of some supplied
 * string". It has a hole big enough to drive the whole threat through: `45` is a
 * substring of `$2,450`, so a model writing "I'll be there in 45 minutes" — a
 * number nobody supplied, about an appointment nobody booked — passes.
 *
 * Comparing RUN TO RUN closes it. `$2,450` contributes exactly one run,
 * `$2,450`, so `45` matches nothing. A sentence-long display string like
 * `quote from 12 August for $2,450` still contributes both `12` and `$2,450`,
 * so a model quoting either part of it is still accepted — which was the reason
 * the substring arm existed in the first place.
 */
function allowedRuns(allowed: readonly string[]): Set<string> {
  const runs = new Set<string>();
  for (const member of allowed) {
    for (const raw of member.match(NUMBER_TOKEN) ?? []) {
      const run = trimNumberPunctuation(raw);
      if (run === '') continue;
      runs.add(run);
      // The dollar sign is OURS, not the model's: we render `$2,450` and a
      // sentence sometimes reads better as "the 2,450 quote". Dropping a
      // currency marker we supplied is faithful reproduction. ADDING one is
      // not — `$14` where `14` was supplied turns a day count into a price —
      // so the relaxation runs one way only.
      if (run.startsWith('$')) runs.add(run.slice(1));
    }
  }
  return runs;
}

/**
 * The supplied display string a rejected token most resembles, for D-11.
 * `undefined` when nothing was supplied — there is no nearest value to name.
 */
function nearestAllowed(token: string, allowed: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const member of allowed) {
    const distance = normalizedEditDistance(token, member);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = member;
    }
  }
  return best;
}

export function validateDraft(input: ValidateDraftInput): ValidateDraftResult {
  const { allowedDisplayStrings, expectedSuffix } = input;

  // ── Canonical form FIRST. Everything below describes these bytes. ────────
  //
  // The suffix is normalized too, and not defensively: `tenants.name` is
  // operator-typed, so "Mick’s Plumbing" with a smart apostrophe is a realistic
  // row. Un-normalized, that character would arrive in OUR OWN appended text,
  // fail the charset rule, and produce a draft the model cannot fix however many
  // times it regenerates.
  const normalizedBody = normalizeForGsm7(input.body).trim();
  const normalizedSuffix = normalizeForGsm7(expectedSuffix).trim();

  const violations: DraftViolation[] = [];

  // An empty body is a HARD failure and is checked first. It is also the shape
  // a silently-failed parse takes, so treating it as "a very short message"
  // would send the compliance suffix on its own to a customer.
  if (normalizedBody === '') {
    return { ok: false, violations: [{ rule: 'empty_body' }], normalizedBody };
  }

  // ┌──────────────────────────────────────────────────────────────────────────┐
  // │ RULES 1 AND 2 JUDGE THE MODEL'S TEXT, NOT OUR OWN APPENDED SUFFIX.       │
  // └──────────────────────────────────────────────────────────────────────────┘
  //
  // `complianceSuffix(tenants.name)` is mechanical text WE compose, and
  // `tenants.name` is a real Australian business name: "A1 Plumbing",
  // "24/7 Electrical", "March Electrical". Scanning it for fabricated numbers
  // and date words asks whether the model invented a value that the model never
  // wrote — and the answer is a violation no regeneration can fix, because the
  // offending characters are reappended to every attempt. That is a permanently
  // undraftable client whose only symptom is drafts that always need authoring
  // by hand.
  //
  // This is the same failure 05-02 closed for the smart apostrophe in a tenant
  // name, one rule over: our own text must not be judged by rules written for
  // the model's.
  //
  // The exclusion is exactly the trailing region that IS the expected suffix,
  // and only when the body genuinely ends with it — a body that does not gets
  // `missing_suffix` below AND is scanned whole, so nothing can be smuggled in
  // by imitating the line. Rules 3 and 4 still cover the entire body: the
  // suffix's characters and length are sent to the customer either way.
  const modelText = normalizedBody.endsWith(normalizedSuffix)
    ? normalizedBody.slice(0, normalizedBody.length - normalizedSuffix.length)
    : normalizedBody;

  // ── Rule 1: no number the caller did not supply (T-5-06). ────────────────
  //
  // ┌──────────────────────────────────────────────────────────────────────┐
  // │ WHAT THIS RULE DOES NOT COVER, stated here rather than in a header   │
  // │ nobody re-reads: A NUMBER WRITTEN IN WORDS CARRIES NO DIGIT AND IS   │
  // │ THEREFORE INVISIBLE TO IT.                                           │
  // └──────────────────────────────────────────────────────────────────────┘
  //
  // `NUMBER_TOKEN` only matches runs containing an ASCII digit, so "the job
  // comes to about two and a half grand" or "a shade under twenty-five hundred"
  // passes Rule 1 cleanly — and Rule 2 does not help, because `DATE_WORD` lists
  // only month and weekday names ("next Tuesday fortnight" is caught, "in about
  // a fortnight" is not). Rules 3 and 4 are about characters and length.
  //
  // This file's framing — "MECHANICAL, NOT PERSUASIVE... this catches what a
  // person skims past" — invites a reader to believe the mechanical layer is
  // TOTAL, and that belief is what makes an operator click through. It is not
  // total. The digits are covered; a spelled-out figure is a real gap and the
  // human approval gate is the only defence against it.
  //
  // Mitigated on the prompt side, where `INSTRUCTIONS` now names the words
  // explicitly. The residue is ACCEPTED: extending the scan to English numerals
  // means a numeral parser, which is precisely the hand-rolled component this
  // file exists in order not to be — and one whose own bugs would refuse
  // correct drafts, teaching operators to click past refusals, which costs far
  // more than it saves.
  const runs = allowedRuns(allowedDisplayStrings);
  for (const raw of modelText.match(NUMBER_TOKEN) ?? []) {
    const token = trimNumberPunctuation(raw);
    if (token === '') continue;
    if (runs.has(token)) continue;
    const nearest = nearestAllowed(token, allowedDisplayStrings);
    violations.push({
      rule: 'unlisted_number',
      detail: token,
      ...(nearest === undefined ? {} : { nearest }),
    });
  }

  // ── Rule 2: no date word the caller did not supply. ──────────────────────
  //
  // Membership is checked case-INSENSITIVELY against the supplied strings even
  // though the scan is case-sensitive: a caller who renders `'12 august'` has
  // still supplied August, and refusing the model for matching the caller's own
  // casing would be refusing correct output.
  const allowedLower = allowedDisplayStrings.map((s) => s.toLowerCase());
  for (const word of new Set(modelText.match(DATE_WORD) ?? [])) {
    const needle = word.toLowerCase();
    if (allowedLower.some((member) => member.includes(needle))) continue;
    violations.push({ rule: 'unlisted_date_word', detail: word });
  }

  // ── Rule 3: charset and length, in septets (D-03). ───────────────────────
  const counted = countSeptets(normalizedBody);
  if (counted.encoding === 'ucs2') {
    // A HARD failure regardless of length. One of these characters flips the
    // WHOLE message to UCS-2 — 67 characters per segment instead of 153 — so a
    // short body carrying one is not "fine, just unusual"; it is up to three
    // times the price of the message an operator thinks they are approving.
    // Segments are deliberately not reported: septet arithmetic does not apply
    // to a message that is not being sent as septets.
    for (const ch of counted.unsupported) {
      violations.push({ rule: 'non_gsm_character', detail: ch });
    }
  } else {
    const segments = segmentCount(counted.septets);
    if (segments > MAX_SEGMENTS) {
      violations.push({ rule: 'too_many_segments', detail: String(segments) });
    }
  }

  // ── Rule 4: the compliance line is present, at the end. ──────────────────
  //
  // `endsWith`, not `includes`: the identification and opt-out belong where a
  // recipient looks for them, and a suffix buried mid-message is a model that
  // rewrote our text rather than one that left it alone.
  if (!normalizedBody.endsWith(normalizedSuffix)) {
    violations.push({ rule: 'missing_suffix', detail: normalizedSuffix });
  }

  // ── Rule 5 (lead drafts only): no link (D-13; 13-REVIEW WR-02). ──────────
  //
  // The prompt ASKS a lead draft for "no links"; this is what makes asking
  // unnecessary, as Rule 1 is for prices. A web address in a follow-up to a
  // stranger who rang once is a phishing shape whoever wrote it. Judged on the
  // model's text, like Rules 1 and 2, so a business name in our own suffix
  // that happens to look like a host cannot make a client undraftable. Opt-in:
  // a quote draft never reaches this rule.
  if (input.forbidLinks === true) {
    const link = modelText.match(LINK_PATTERN);
    if (link !== null) violations.push({ rule: 'link', detail: link[0] });
  }

  if (violations.length > 0) return { ok: false, violations, normalizedBody };

  // Unreachable as anything but gsm7 — a ucs2 body always pushed a violation
  // above — but computed from the same counted value rather than re-derived, so
  // the number reported is provably the number checked.
  const septets = counted.encoding === 'gsm7' ? counted.septets : 0;
  return { ok: true, segments: segmentCount(septets), normalizedBody };
}
