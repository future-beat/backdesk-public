/**
 * The caller pseudonym: a keyed hash that replaces a caller's number once the
 * retention window has passed (Phase 15, COMP-02 / D-06, threat T-15-05).
 *
 * PURE, in the sense `src/core/intake/ip-hash.ts` means it: `node:crypto` is a
 * Node API, not a framework. No `next/*`, no repository, no environment — the
 * PEPPER is passed in, exactly as `hashClientIp(ip, salt)` takes its salt,
 * because a module that read the secret itself could not be tested without
 * one. The pepper is read ONCE, at the edge (the messaging-reconcile route
 * that runs the retention pass, plan 15-07), and handed down as an argument.
 *
 * ── WHY A KEYED HASH, NOT A SALTED DIGEST ───────────────────────────────────
 *
 * The Australian mobile space is about 10^8 numbers. A digest of a number with
 * a salt stored beside it (or a salt anybody can learn) is a lookup table that
 * builds in minutes, so the "hash" would simply BE the number. HMAC-SHA-256
 * under a 32+ character server-held pepper is the standard answer: without
 * the key there is no table to build. Concatenating a secret onto the input
 * and digesting that is the hand-rolled version of the same idea, with the
 * length-extension and construction caveats HMAC exists to remove.
 *
 * ── SAME INPUT, SAME HASH ───────────────────────────────────────────────────
 *
 * Deterministic by construction. That is the point, not a weakness: two rows
 * for the same caller hash to the same value, so repeat-caller identity (the
 * "rang before" fact, the per-caller counts) survives pseudonymisation. It is
 * also why rotating the pepper is a recorded decision and never a routine —
 * every hash written after a rotation stops matching every hash written
 * before it.
 *
 * ── THE SHAPE ───────────────────────────────────────────────────────────────
 *
 * 64 lower-case hex characters. That is exactly what migration 0042's widened
 * `leads_contact_mobile_e164` CHECK admits on a row stamped `pseudonymised_at`,
 * and `isPseudonym` recognises that shape and nothing else. Nothing anywhere
 * reads a number back from a hash — there is no inverse, and none is wanted.
 */
import { createHmac } from 'node:crypto';

/** The pepper floor — the `openssl rand -hex 32` shape is 64 characters. */
export const PEPPER_MIN_CHARS = 32;

/** Exactly 64 lower-case hex characters: an HMAC-SHA-256 hex digest. */
export const PSEUDONYM_PATTERN = /^[0-9a-f]{64}$/;

/**
 * HMAC-SHA-256 of `value` under `pepper`, as 64 lower-case hex. Throws when the
 * pepper is under the floor — a short key is a configuration bug, and a hash
 * written with it would be permanent.
 */
export function pseudonymiseCaller(value: string, pepper: string): string {
  if (pepper.length < PEPPER_MIN_CHARS) throw new Error('pseudonym: pepper too short');
  return createHmac('sha256', pepper).update(value, 'utf8').digest('hex');
}

/** True for exactly the shape `pseudonymiseCaller` returns. */
export const isPseudonym = (value: string): boolean => PSEUDONYM_PATTERN.test(value);
