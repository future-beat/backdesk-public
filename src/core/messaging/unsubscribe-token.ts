/**
 * The one-click unsubscribe token (MSG-02, MSG-03, T-4-19, T-4-21).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ POSSESSION OF A TOKEN IS PROOF THAT WE EMAILED THIS CONVERSATION.        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `/api/unsubscribe` is a fully public endpoint whose only credential is this
 * string, and what it authorises is IRREVERSIBLE: a both-channel suppression
 * that no grant in this database can undo (see `suppressed_contacts`). So the
 * design question is not "how do we identify the clicker" — it is "how do we
 * make suppressing a stranger inexpressible".
 *
 * The answer is that the token IS the subject. It is an HMAC over
 * (tenantId, cadenceId), minted at SEND time and delivered only inside the email
 * that conversation produced. There is no address-keyed path, no id-keyed path
 * and nothing enumerable: an attacker who wants to suppress a specific victim
 * must forge a MAC under a 32+ byte secret, and an attacker who cannot do that
 * learns nothing by trying, because the endpoint answers every request
 * identically (T-4-20, see the route).
 *
 * ── FORMAT ──────────────────────────────────────────────────────────────────
 *
 *   v1.<base64url(JSON {t: tenantId, c: cadenceId})>.<base64url(HMAC-SHA256)>
 *
 * The MAC covers `v1.<payload>` — the VERSION IS INSIDE THE SIGNED MATERIAL, so
 * a future v2 scheme cannot have its tokens replayed as v1 (or the reverse) by
 * editing three characters. The version prefix is the same rule
 * `src/core/shared/crypto.ts` states for stored credentials: every value says
 * which scheme produced it, and reading an unknown one refuses rather than
 * guessing.
 *
 * base64url rather than base64: the value travels as a query parameter through
 * mail clients, link scanners and one-click senders, and `+` / `/` / `=` are
 * exactly the characters one of them will re-encode and another will not.
 *
 * ── NO EXPIRY, AND THAT IS A DECISION ───────────────────────────────────────
 *
 * The Spam Act requires an unsubscribe facility to remain functional for at
 * least 30 days after the message is sent, and there is no upper bound on when
 * somebody may reasonably click a link in an email they kept. The operation
 * behind it is one-way and idempotent — clicking twice, or clicking a year
 * later, writes the same rows. An expiry could therefore only ever break a right
 * somebody still holds, in exchange for shortening a window in which the worst
 * available outcome is that a customer stops being contacted.
 *
 * ── FAIL CLOSED ON A WEAK SECRET ────────────────────────────────────────────
 *
 * `getServerEnv()` requires `UNSUBSCRIBE_SIGNING_SECRET` to be at least 32
 * characters, so a short one is a deployment that should not have booted. If one
 * ever reaches here: `mint` THROWS (a caller is about to put a forgeable link in
 * a customer's inbox) and `verify` returns null for every token (a request has
 * already arrived, and refusing it is the safe direction — it costs one
 * unsubscribe click, where accepting would let anybody suppress anybody).
 *
 * `src/core` is framework-free by contract: `node:crypto` only, no dependency.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const VERSION = 'v1';
const ALGORITHM = 'sha256';

/** Matches `getServerEnv()`'s `z.string().min(32)` on the same variable. */
const MIN_SECRET_CHARS = 32;

/**
 * An upper bound on what we are willing to hash.
 *
 * A real token is ~150 characters. Nothing stops a caller POSTing a megabyte in
 * the `token` parameter, and this is a public endpoint — the cap is what makes
 * "spend our CPU" not a thing an unauthenticated request can ask for.
 */
const MAX_TOKEN_CHARS = 512;

export interface UnsubscribeSubject {
  tenantId: string;
  cadenceId: string;
}

/**
 * The wire shape. Single-letter keys because this string is repeated in every
 * email footer and every `List-Unsubscribe` header, and base64 pays 4 bytes for
 * every 3 — `tenantId`/`cadenceId` would cost ~20 characters per link to say
 * something only this file needs to know.
 */
interface TokenPayload {
  t: string;
  c: string;
}

function assertSigningSecret(secret: string): void {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_CHARS) {
    // Reports the requirement and the LENGTH, never the value — the same rule
    // `decodeEncryptionKey` follows one module over.
    throw new Error(
      `UNSUBSCRIBE_SIGNING_SECRET must be at least ${MIN_SECRET_CHARS} characters; ` +
        `got ${typeof secret === 'string' ? secret.length : 'a non-string'}. ` +
        'An unsubscribe link signed with a weak key is a suppression anybody can forge.',
    );
  }
}

/** The bytes the MAC covers: the version and the payload, never one alone. */
function signedMaterial(payload: string): string {
  return `${VERSION}.${payload}`;
}

function macFor(payload: string, secret: string): string {
  return createHmac(ALGORITHM, secret).update(signedMaterial(payload)).digest('base64url');
}

/**
 * The link for one cadence's recipient. Deterministic: the same subject and
 * secret always produce the same token, so a customer with two copies of the
 * same email has one unsubscribe identity rather than two.
 */
export function mintUnsubscribeToken(subject: UnsubscribeSubject, secret: string): string {
  assertSigningSecret(secret);

  const payload = Buffer.from(
    JSON.stringify({ t: subject.tenantId, c: subject.cadenceId } satisfies TokenPayload),
    'utf8',
  ).toString('base64url');

  return `${VERSION}.${payload}.${macFor(payload, secret)}`;
}

/**
 * The subject a token names, or `null` for ANY token we did not mint.
 *
 * NULL FOR EVERYTHING, NEVER A THROW. This runs inside a public POST handler
 * whose whole security property is that every request gets the same answer; an
 * exception escaping here would be a 500, which is a response an attacker can
 * distinguish from a 200 — an oracle built out of the one code path that was
 * supposed to have none.
 *
 * ── THE ORDER OF THE CHECKS IS THE FUNCTION ─────────────────────────────────
 *
 * The MAC is verified BEFORE the payload is parsed. `JSON.parse` on an
 * attacker-controlled string is cheap but it is still work performed on
 * unauthenticated input, and the shape check that follows it is what stands
 * between a signed `{"t":""}` and a `forTenant('')` one layer down.
 */
export function verifyUnsubscribeToken(
  token: string,
  secret: string,
): UnsubscribeSubject | null {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_CHARS) return null;
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_CHARS) {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [version, payload, mac] = parts;
  if (version !== VERSION || payload === '' || mac === '') return null;

  const expected = Buffer.from(macFor(payload, secret), 'utf8');
  const provided = Buffer.from(mac, 'utf8');
  // `timingSafeEqual` THROWS on unequal lengths, so this is not an optimisation:
  // it is what stops a truncated MAC from becoming an exception instead of a
  // refusal. It leaks the MAC's length, which is a constant of the format.
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  // Authenticated, but still checked: a payload WE signed can be malformed if a
  // future caller passes the wrong thing, and the failure would be silent
  // (`forTenant(undefined)`), not loud.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const { t, c } = parsed as Partial<TokenPayload>;
  if (typeof t !== 'string' || typeof c !== 'string' || t === '' || c === '') return null;

  return { tenantId: t, cadenceId: c };
}

/** The path both the link and the route agree on. Changing it is one edit. */
export const UNSUBSCRIBE_PATH = '/api/unsubscribe';

/**
 * THE ONE SPELLING OF THE LINK.
 *
 * Lives beside the token rather than in the sender for the reason
 * `domainOfAddress` lives beside the domains wrapper: the URL in the
 * `List-Unsubscribe` header, the URL in the visible footer and the route that
 * receives them must be the same string. Two spellings is a footer link that
 * 404s while the header one works — and the footer link is the one a human
 * clicks.
 *
 * The base URL is passed in, never read from env here: this module is pure, and
 * the caller (`ResendSender`) is the one that must REFUSE to send at all when no
 * base URL is configured. A relative or localhost unsubscribe link in a real
 * email is a Spam Act breach wearing a working-code disguise.
 */
export function unsubscribeUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${UNSUBSCRIBE_PATH}?token=${encodeURIComponent(token)}`;
}
