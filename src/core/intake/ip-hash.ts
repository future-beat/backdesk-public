/**
 * The client address, as a throttle key and nothing else (Phase 9, LAND-03,
 * D-12, threat T-9-05).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE ADDRESS IS NEVER STORED, LOGGED OR RETURNED. It enters this module   │
 * │ and a salted digest leaves it. `audit_requests.ip_hash` holds that       │
 * │ digest, the hourly counter is keyed on it, and the console's list query  │
 * │ does not select the column at all — a hashed address is still a stable   │
 * │ identifier for a person, and there is no reason for one to reach a       │
 * │ browser.                                                                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * PURE, and framework-free in the sense this directory means it: `node:crypto`
 * is a Node API, not a framework, and `src/core/credential-crypto.ts` already
 * reads it. No `next/*`, no repository, no environment — the SALT is passed in,
 * because a module that read `AUDIT_IP_HASH_SALT` itself could not be tested
 * without one.
 *
 * ── WHY A SALT AT ALL ───────────────────────────────────────────────────────
 *
 * There are about four billion IPv4 addresses. An unsalted SHA-256 of one is a
 * lookup table anybody can build in an afternoon, so an unsalted column would
 * let a holder of a database dump confirm exactly which address submitted the
 * form — which is the thing not storing the address was for. The salt is a
 * required secret (≥ 32 chars) and rotating it resets every counter, which is
 * harmless: the window is an hour.
 */
import { createHash } from 'node:crypto';

/**
 * The client address from a `headers()`-shaped reader, or `null`.
 *
 * ── THE FIRST VALUE, NOT THE LAST ───────────────────────────────────────────
 *
 * On Vercel `x-forwarded-for` is "the public IP address of the client" and the
 * platform "currently overwrite[s] the X-Forwarded-For header and do[es] not
 * forward external IPs … to prevent IP spoofing" [vercel.com/docs/headers/
 * request-headers]. So the first comma-separated value is the client and the
 * rest are hops. Reading the LAST value — the other common habit, and the right
 * one behind a proxy you control — would key the counter on a load balancer
 * here, throttling every visitor at once after five submissions between them.
 *
 * `null` locally and for any server-side call: there is no address, and
 * inventing a placeholder would collide every such request into one bucket.
 */
export function clientIpFromHeaders(get: (name: string) => string | null): string | null {
  const forwarded = get('x-forwarded-for');
  if (!forwarded) return null;

  const first = forwarded.split(',')[0]?.trim() ?? '';
  return first === '' ? null : first;
}

/**
 * `sha256(salt:key)` as hex, or `null` for no address.
 *
 * ── IPv6 IS KEYED ON THE /64, AND THAT IS THE POINT ─────────────────────────
 *
 * A residential IPv6 allocation is commonly a whole /64, so a submitter can
 * present a fresh full address on every single request without changing
 * networks — a limit keyed on the full address would hand them a new counter
 * per submission, which is a limit that does not limit. The first four hextets
 * put the whole allocation in one bucket.
 *
 * Rotation ACROSS allocations is still possible and is accepted (T-9-03): a
 * WAF sits in CONTEXT as a Deferred Idea for the day abuse actually appears,
 * and the cost of guessing at it now is throttling real prospects.
 *
 * IPv4 is hashed whole — there is no equivalent prefix a single household
 * controls.
 */
export function hashClientIp(ip: string | null, salt: string): string | null {
  if (!ip) return null;

  const key = ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip;

  return createHash('sha256').update(`${salt}:${key}`).digest('hex');
}
