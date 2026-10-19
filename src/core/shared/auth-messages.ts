/**
 * Login error codes and their operator-facing messages (CR-01).
 *
 * `src/core` is framework-free by contract, so this resolver is reachable from
 * the login page, a future API route, and a unit test alike — which is the
 * point: the lookup below is security-relevant and must be testable without
 * standing up Next.
 *
 * WHY A `Map` AND NOT AN OBJECT LITERAL:
 * `/login` is deliberately excluded from the proxy matcher, so `?error=` is
 * attacker-controlled input from an unauthenticated caller. Indexing a plain
 * object literal with that string walks the prototype chain — `ERRORS['__proto__']`
 * returns `Object.prototype`, `ERRORS['constructor']` returns a function, and
 * both are truthy, so a `??` default never fires. Handing either to React throws
 * "Objects are not valid as a React child" and 500s the console's only
 * authentication entry point.
 *
 * A `Map` has no prototype chain to walk: `.get()` returns `undefined` for every
 * key that was not explicitly set. Any future lookup table keyed by user-supplied
 * input should use a `Map` (or `Object.hasOwn`) for the same reason.
 */

/** The codes `signIn()` redirects with. Anything else falls back to `invalid`. */
export const LOGIN_ERROR_MESSAGES = new Map<string, string>([
  ['missing', 'Enter both your email and password.'],
  ['invalid', 'That email and password combination did not work.'],
]);

/** The message shown for an unrecognised code — deliberately the generic one. */
export const LOGIN_FALLBACK_MESSAGE = LOGIN_ERROR_MESSAGES.get('invalid')!;

/**
 * Resolve a `?error=` query value to a message.
 *
 * Returns `null` when there is no error to show, and always a plain string
 * otherwise — never an object, never a function, whatever the caller supplies.
 */
export function loginErrorMessage(code: string | undefined | null): string | null {
  if (!code) return null;
  return LOGIN_ERROR_MESSAGES.get(code) ?? LOGIN_FALLBACK_MESSAGE;
}
