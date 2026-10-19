/**
 * D-04: which human a cadence talks to.
 *
 * FRAMEWORK-FREE ON PURPOSE. Nothing here imports from `next/*` and nothing
 * here reads the database — the caller hands over the job's mirrored contacts
 * and gets back one snapshot or `null`.
 *
 * ── THE RULE, WHICH IS ALSO THE DOCUMENTATION D-04 ASKS FOR ─────────────────
 *
 * Among contacts that are still active upstream and have at least one usable
 * address, pick the first by:
 *
 *   1. CONTACT TYPE, matched case- and space-insensitively:
 *        JOB  >  BILLING  >  Property Manager  >  anything else (incl. absent)
 *      JOB first because it is the person who asked for the work; BILLING next
 *      because on a domestic job it is usually the same household; a property
 *      manager third because they are a real recipient but an intermediary; and
 *      an untyped contact last rather than excluded, since a one-contact job
 *      with a blank type is common and has an obvious right answer.
 *
 *   2. CHANNEL USABILITY: a usable mobile beats email-only. SMS is the walking
 *      skeleton's only live channel, and it is the one a tradie's customer
 *      actually reads.
 *
 *   3. LOWEST `sm8_contact_uuid`. A tie-break that exists purely so the answer
 *      cannot depend on row order: a query without ORDER BY has no order, so
 *      without this the recipient could change between two ticks — and a
 *      cadence whose recipient changes mid-flight breaks reply threading,
 *      opt-out matching and Phase 7 attribution at once.
 *
 * NOTE STEP 2 IS SUBORDINATE TO STEP 1. A BILLING contact with a mobile does
 * not outrank a JOB contact we can only email. Type is a statement about WHO;
 * channel is a statement about HOW, and reaching the wrong person quickly is
 * not an improvement.
 *
 * ── NULL IS AN ANSWER, AND IT IS THE POINT ──────────────────────────────────
 *
 * A job whose contacts are all unusable returns `null` and goes to operator
 * triage. D-04 says "never a guess", and every guess available here is
 * expensive: an SMS to a landline is silently discarded by the carrier, an
 * email to a malformed address bounces against the CLIENT's own sending domain
 * and damages their deliverability, and a message to the property manager of a
 * job the homeowner commissioned is the kind of mistake a design partner tells
 * other tradies about.
 *
 * ── WHAT IS DELIBERATELY NOT READ ───────────────────────────────────────────
 *
 * `is_primary_contact`. ServiceM8's job-contact reference marks it deprecated
 * and `src/db/schema/quote-contacts.ts` records the decision not to mirror it,
 * precisely so that recipient selection could not be built on a field upstream
 * has stopped maintaining. Selection is on `contact_type` only.
 */

/**
 * The contact fields selection needs — structurally a `quote_contacts` row.
 *
 * Declared as an interface rather than importing `QuoteContact` so that this
 * module stays free of the database layer, and so a caller can pass a
 * hypothetical contact (the console's "who would this go to?" preview).
 */
export interface SelectableContact {
  sm8ContactUuid: string;
  first?: string | null;
  last?: string | null;
  mobile?: string | null;
  phone?: string | null;
  email?: string | null;
  /** 'JOB' | 'BILLING' | 'Property Manager' — free text upstream, case varies. */
  contactType?: string | null;
  /** false means DELETED upstream. Absent is treated as active: the column defaults true. */
  sm8Active?: boolean | null;
}

/** The snapshot a cadence stores and sends to. Addresses are normalized, never raw. */
export interface PrimaryContact {
  sm8ContactUuid: string;
  name: string | null;
  /** E.164, or null when no usable mobile exists. */
  mobile: string | null;
  /** Trimmed and lowercased, or null when no usable email exists. */
  email: string | null;
}

/**
 * Contact-type precedence. Lower sorts first; anything unlisted falls to
 * `OTHER_TIER`, so the function is TOTAL over the free text upstream sends.
 */
const TYPE_TIERS: ReadonlyMap<string, number> = new Map([
  ['job', 0],
  ['billing', 1],
  ['property manager', 2],
]);

const OTHER_TIER = 3;

/** Everything that is not a digit or a leading plus. */
const PUNCTUATION = /[\s()\-.]/g;

/**
 * Australian mobile, in the two shapes that are unambiguous, plus the
 * country-coded form without its plus.
 *
 * Local: `04` + 8 digits. International: `+614` + 8 digits.
 *
 * `412345678` — a mobile whose leading zero was lost to a spreadsheet — is
 * DELIBERATELY REFUSED. Restoring the zero is a guess, and the cost of a wrong
 * guess is a message to a stranger in the client's name; the cost of refusing
 * is one quote on the operator's triage list with a visibly odd number.
 */
const LOCAL_MOBILE = /^04\d{8}$/;
const INTERNATIONAL_MOBILE = /^\+?614\d{8}$/;

/**
 * A deliberately conservative address shape: something, an @, something with a
 * dot in it, and no whitespace anywhere. This is not RFC 5322 and does not try
 * to be — it exists to catch the three things the mirror actually contains
 * (empty strings, 'n/a', a name where an address should be) before they reach
 * a send that would bounce against the client's own domain.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A raw ServiceM8 phone string → E.164, or null.
 *
 * Null means "not a number we can text", and that includes every landline,
 * every 13/1300/1800 number and every non-Australian mobile. Nothing here
 * infers a country or a missing digit.
 */
export function normalizeAuMobile(raw: string | null | undefined): string | null {
  if (raw == null) return null;

  const cleaned = raw.replace(PUNCTUATION, '');
  if (cleaned === '') return null;

  if (LOCAL_MOBILE.test(cleaned)) return `+61${cleaned.slice(1)}`;
  if (INTERNATIONAL_MOBILE.test(cleaned)) {
    return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
  }

  return null;
}

/** A raw email → trimmed, lowercased, and shape-checked; or null. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (raw == null) return null;

  const cleaned = raw.trim().toLowerCase();
  return EMAIL_SHAPE.test(cleaned) ? cleaned : null;
}

/**
 * The mobile of a contact, reading `mobile` first and falling back to `phone`.
 *
 * THE FALLBACK IS NOT A GUESS, and it is worth being explicit about why:
 * ServiceM8 does not police which column a tradie types a number into, and
 * `normalizeAuMobile` accepts ONLY mobile shapes — a landline sitting in
 * `phone` still normalizes to null. So the fallback can only ever recover a
 * number that is unambiguously a mobile, and its absence would send a
 * perfectly reachable customer to triage over a data-entry habit.
 */
function usableMobile(contact: SelectableContact): string | null {
  return normalizeAuMobile(contact.mobile) ?? normalizeAuMobile(contact.phone);
}

function tierOf(contactType: string | null | undefined): number {
  if (contactType == null) return OTHER_TIER;
  const key = contactType.trim().toLowerCase().replace(/\s+/g, ' ');
  return TYPE_TIERS.get(key) ?? OTHER_TIER;
}

function nameOf(contact: SelectableContact): string | null {
  const parts = [contact.first, contact.last]
    .map((part) => part?.trim() ?? '')
    .filter((part) => part !== '');

  return parts.length === 0 ? null : parts.join(' ');
}

/**
 * The one contact this cadence will chase, or null for operator triage.
 *
 * Total and deterministic: the same input set produces the same answer in any
 * order, and an input with no reachable human produces `null` rather than a
 * best effort.
 */
export function selectPrimaryContact(
  contacts: readonly SelectableContact[],
): PrimaryContact | null {
  const candidates = contacts
    .filter((contact) => contact.sm8Active !== false)
    .map((contact) => ({
      contact,
      mobile: usableMobile(contact),
      email: normalizeEmail(contact.email),
    }))
    .filter((candidate) => candidate.mobile !== null || candidate.email !== null);

  if (candidates.length === 0) return null;

  const ranked = candidates
    .map((candidate) => ({
      ...candidate,
      tier: tierOf(candidate.contact.contactType),
      // 0 = we can text them, 1 = email only. Sorts after tier, never before it.
      channelRank: candidate.mobile !== null ? 0 : 1,
    }))
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        a.channelRank - b.channelRank ||
        // The order-independence tie-break. Plain lexical comparison: ServiceM8
        // uuids are fixed-width lowercase hex, so this is a total order with no
        // locale in it.
        (a.contact.sm8ContactUuid < b.contact.sm8ContactUuid ? -1 : 1),
    );

  const chosen = ranked[0];

  return {
    sm8ContactUuid: chosen.contact.sm8ContactUuid,
    name: nameOf(chosen.contact),
    mobile: chosen.mobile,
    email: chosen.email,
  };
}
