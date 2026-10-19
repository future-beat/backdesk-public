/**
 * Is this request really from Twilio? (Phase 11, D-05, CAP-04.)
 *
 * A THIN WRAPPER OVER THE SDK'S `validateRequest`, and deliberately not a
 * hand-rolled HMAC. Twilio's backend has been observed to sign the configured
 * URL in more than one spelling (with and without the default port, with the
 * query string in legacy encoding), and `validateRequest` tries all four
 * variants with a constant-time compare. That knowledge lives in the SDK; a
 * single-variant `createHmac('sha1')` here would reject real calls the day
 * Twilio signs the other spelling.
 *
 * The DEEP IMPORT (`twilio/lib/webhooks/webhooks`) is deliberate: the package
 * root pulls in the whole REST client, and the voice route needs one pure
 * function. `twilio` ships no `exports` map, so the path resolves as a plain
 * file and is pinned by the exact `6.1.1` version in package.json.
 *
 * ── THE URL IS AN ARGUMENT, NEVER THE REQUEST'S ─────────────────────────────
 *
 * The caller passes the canonical URL from `twilioWebhookUrl()` — built from
 * `APP_BASE_URL`, never from the incoming request, which Vercel's proxy
 * rewrites. And `params` are the DECODED form fields
 * (`Object.fromEntries(new URLSearchParams(body))`): the algorithm appends each
 * key and its decoded value, so re-encoding them would fail every signature.
 *
 * ── IT NEVER THROWS ─────────────────────────────────────────────────────────
 *
 * `validateRequest` parses the URL and could throw on a malformed one. A throw
 * here would become a 500, and a 500 on the voice route is Twilio's own error
 * message played to a tradie's customer. So every failure is `false`, and the
 * caught value is discarded — it could carry the URL, which carries the token.
 */
import { validateRequest } from 'twilio/lib/webhooks/webhooks';

export interface TwilioSignatureCheck {
  /** The account auth token — the SIGNING KEY, not a bearer. */
  authToken: string;
  /** The `X-Twilio-Signature` header, as received. Absent or empty is `false`. */
  signature: string | null;
  /** The canonical URL from `twilioWebhookUrl()`. */
  url: string;
  /** The decoded form fields. */
  params: Record<string, string>;
}

export function verifyTwilioSignature(check: TwilioSignatureCheck): boolean {
  if (!check.signature) return false;

  try {
    return validateRequest(check.authToken, check.signature, check.url, check.params);
  } catch {
    // Discarded deliberately — see the header.
    return false;
  }
}
