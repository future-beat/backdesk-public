/**
 * Normalized Levenshtein distance — the AI-04 measurement, owned outright.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS NUMBER IS EVIDENCE, NOT A FEATURE. "How much do operators edit our  │
 * │ drafts?" is answered by a column full of these, so the definition behind │
 * │ them has to be stable for as long as the answer matters.                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── WHY THIS IS HAND-WRITTEN WHEN "DON'T HAND-ROLL" IS THE HOUSE RULE ───────
 *
 * The rule exists because hand-rolled crypto, date maths and HTML escaping are
 * where subtle bugs hide behind confident code. Wagner-Fischer is the opposite
 * case: a 1974 algorithm, twenty lines, with published known-answer pairs to
 * pin it against (`kitten`/`sitting` = 3 appears in the original literature).
 *
 * What tips it is that the METRIC IS THE RECORD. A dependency bump that changed
 * `fastest-levenshtein`'s tie-breaking or its Unicode handling would silently
 * redefine every historical measurement in the drafts table — and because these
 * are stored numbers, not recomputed ones, old and new rows would be
 * incomparable with nothing to indicate it. Owning ~25 lines means the
 * definition changes only when a diff in this file says so, which is a thing a
 * reviewer can see. That trade is recorded as T-5-09 (accepted, low).
 *
 * PURE, dependency-free, no I/O. It is handed message bodies, and per T-2-02 it
 * does not log them.
 */

/**
 * Split into CODE POINTS, never UTF-16 units.
 *
 * `'👍'.length` is 2. Counting it as two characters makes a one-emoji edit look
 * like two edits and inflates every normalized distance on a body containing
 * one — and an operator adding a thumbs-up to a draft is a real, common edit.
 * The spread operator iterates code points, which is the unit a person means by
 * "character".
 */
function codePoints(value: string): string[] {
  return [...value];
}

/**
 * Raw Levenshtein distance: the minimum number of single-code-point
 * insertions, deletions or substitutions turning `a` into `b`.
 *
 * TWO ROWS, not a full matrix. The recurrence only ever reads the previous row,
 * so an n x m matrix allocates memory to hold values nothing will read again.
 * At SMS lengths this is not a performance argument — it is that the shorter
 * implementation has fewer places to be wrong.
 *
 * INTEGER-EXACT by construction: every value is a sum of 0s and 1s, so no
 * floating point enters until the normalization step below.
 */
export function editDistance(a: string, b: string): number {
  const source = codePoints(a);
  const target = codePoints(b);

  // Cheap exits that are also the correct answers: distance from anything to
  // the empty string is its length (delete every character).
  if (source.length === 0) return target.length;
  if (target.length === 0) return source.length;

  // previous[j] = distance between source[0..i-1] and target[0..j]
  let previous = Array.from({ length: target.length + 1 }, (_, j) => j);
  let current = new Array<number>(target.length + 1);

  for (let i = 1; i <= source.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= target.length; j += 1) {
      const substitutionCost = source[i - 1] === target[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] as number) + 1, // insertion
        (previous[j] as number) + 1, // deletion
        (previous[j - 1] as number) + substitutionCost, // substitution
      );
    }
    // Swap rather than copy: `current` is fully overwritten next iteration.
    const swap = previous;
    previous = current;
    current = swap;
  }

  return previous[target.length] as number;
}

/**
 * Distance as a fraction of the longer string: 0 = untouched, 1 = rewritten.
 *
 * Dividing by `max(len(a), len(b))` — rather than by either operand — is what
 * makes the number comparable across drafts of different lengths, and what
 * bounds it in [0, 1]: the raw distance can never exceed the longer length.
 * "The operator changed 4% of this draft" means the same thing on a 90-
 * character message as on a 300-character one, which is the only reason a
 * column of these can be averaged.
 *
 * BOTH EMPTY IS 0, guarded explicitly. The formula would divide by zero and
 * yield `NaN`, and a `NaN` written to a numeric column either throws at the
 * driver or poisons every average computed over it afterwards. Two empty
 * strings are identical, so 0 is also the honest answer.
 *
 * ── THE ROUNDING CONTRACT ───────────────────────────────────────────────────
 *
 * This returns FULL PRECISION and rounds nothing. Storage must preserve at
 * least four decimal places: a single-character edit to a 300-character SMS is
 * 0.0033, which two decimal places records as 0.00 — indistinguishable from an
 * untouched draft, which is precisely the signal AI-04 exists to measure.
 * `numeric(6,4)` or wider; never `real`, never two places.
 */
export function normalizedEditDistance(a: string, b: string): number {
  const longer = Math.max(codePoints(a).length, codePoints(b).length);
  if (longer === 0) return 0;
  return editDistance(a, b) / longer;
}
