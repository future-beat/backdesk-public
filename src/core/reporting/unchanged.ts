/**
 * DID THIS PRESS OF GENERATE ACTUALLY CHANGE ANYTHING? (RPT-02, D-11)
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A LEAF MODULE. It imports NOTHING — no database, no generator, no zod.   │
 * │ That is the whole reason it exists as its own file rather than as a      │
 * │ section of `generate.ts`: this function decides whether a write happens, │
 * │ and a decision that expensive has to be testable by asserting bytes.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * D-11 says a correction is a NEW VERSION, never an edit — so the generator's
 * only move was to write version N+1 every time. During Phase 7 UAT the operator
 * pressed Generate three times on one fixture month and got three byte-identical
 * versions, and a list where a merely re-pressed month reads exactly like a
 * corrected one. The answer is not deletion (a frozen version may already be
 * stapled to an invoice) — it is not creating the duplicate.
 *
 * ── WHY BYTES, AND NOT A FIELD LIST ─────────────────────────────────────────
 *
 * A comparator that enumerated `figures.grossCents`, `figures.replies`, … would
 * silently start passing the day a document gains a figure: the new field would
 * differ, the comparator would not look at it, and a real correction would be
 * swallowed with the operator told the month is already up to date. Comparing
 * the whole document means a new field is compared the moment it exists.
 *
 * ── THE TWO FACTS `canonicalJson` EXISTS FOR ────────────────────────────────
 *
 *   1. jsonb REORDERS OBJECT KEYS. What comes back out of the column is not the
 *      key order that went in, so a plain `JSON.stringify` equality would call
 *      every stored row "changed" and leave this feature silently inert.
 *   2. A STORED ROW NEVER CARRIES `undefined`. jsonb has no such value: a
 *      property that was `undefined` on the way in simply has no key on the way
 *      out. `null`, by contrast, is stored and comes back — so `null` and absent
 *      are genuinely different documents and must compare unequal.
 *
 * ── WHY `generatedAt` IS NOT MENTIONED ANYWHERE BELOW ───────────────────────
 *
 * Because it cannot reach this function. `FrozenDocuments` has five keys, and
 * the exclusion of `id`, `version`, `generatedAt` and the period fields is a
 * property of the SIGNATURE rather than of a filter inside it — a filter is a
 * line somebody can delete, and comparing `generatedAt` would make the answer
 * "changed" on every press forever, which is the bug this module replaces.
 */

/**
 * The five frozen documents, from either side of the column.
 *
 * `unknown` ON PURPOSE. One side is the generator's typed objects on their way
 * into the insert; the other is `StoredReportRow`'s jsonb columns on their way
 * back out, typed `Record<string, unknown>` / `unknown[]` because 07-01 left
 * those columns deliberately unconstrained. Casting either side to meet the
 * other would assert a shape neither caller can promise, and the comparison
 * does not need one: it reads bytes, not fields.
 */
export interface FrozenDocuments {
  figures: unknown;
  lines: unknown;
  baseline: unknown;
  constants: unknown;
  fees: unknown;
}

/** The five keys, written once so the comparator cannot drift from the type. */
const DOCUMENT_KEYS = ['figures', 'lines', 'baseline', 'constants', 'fees'] as const;

/**
 * One value as the string jsonb would compare it by.
 *
 * Arrays keep their order — the per-job lines are stored in `won_detected_at`
 * order because that is the order the printed table prints in, so a reorder IS a
 * different document. Plain objects are emitted with their keys SORTED and their
 * `undefined`-valued entries DROPPED, which is exactly the pair of
 * normalisations a jsonb round trip performs. Everything else goes through
 * `JSON.stringify`, whose output for a string, number, boolean or null is
 * already canonical.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }

  // `typeof null === 'object'`, and a Date (or anything else with a `toJSON`)
  // is not a plain object — both fall through to `JSON.stringify`, which
  // renders them the way the column would.
  if (value !== null && typeof value === 'object' && isPlainObject(value)) {
    const entries = Object.keys(value)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`);

    return `{${entries.join(',')}}`;
  }

  // `undefined` inside an array serialises as `null` here, exactly as
  // `JSON.stringify` does — and therefore exactly as the column stores it.
  return JSON.stringify(value) ?? 'null';
}

/** A `{}`-literal object, as opposed to a Date, a Map or a class instance. */
function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Would writing `next` produce a document identical to `previous`?
 *
 * TRUE means the press writes nothing and the operator is pointed at the version
 * that already says this. FALSE means version N+1, keeping N — D-11, unchanged.
 *
 * The comparison is over the five documents and nothing else; see the header for
 * why that exclusion lives in the signature.
 */
export function reportDocumentsUnchanged(
  next: FrozenDocuments,
  previous: FrozenDocuments,
): boolean {
  return DOCUMENT_KEYS.every((key) => canonicalJson(next[key]) === canonicalJson(previous[key]));
}
