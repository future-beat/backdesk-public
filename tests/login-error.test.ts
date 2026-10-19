/**
 * CR-01 regression: `/login?error=<prototype key>` must not crash the page.
 *
 * `/login` is excluded from the proxy matcher so unauthenticated users can reach
 * the form, which makes `?error=` the one attacker-controlled input on the
 * console's only authentication entry point. When the message was looked up on a
 * plain object literal, `?error=__proto__` returned `Object.prototype` — truthy,
 * so the `??` fallback never fired — and React threw "Objects are not valid as a
 * React child" on render. An unauthenticated 500.
 *
 * The assertions below are deliberately about the TYPE of the result, not just
 * its value: a `string` is the property React needs, and it is the property an
 * object-literal lookup silently loses.
 */
import { describe, expect, it } from 'vitest';

import {
  LOGIN_FALLBACK_MESSAGE,
  loginErrorMessage,
} from '@/core/shared/auth-messages';

/**
 * Keys that exist on `Object.prototype` and therefore resolve to something
 * truthy through an object-literal lookup. Each one 500s the page under the old
 * implementation; `__proto__` and `constructor` return an object and a function
 * respectively, which are the two shapes React refuses outright.
 */
const PROTOTYPE_KEYS = [
  '__proto__',
  'constructor',
  'toString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
];

describe('login error message resolution (CR-01)', () => {
  it('maps the codes signIn() actually redirects with', () => {
    expect(loginErrorMessage('missing')).toBe('Enter both your email and password.');
    expect(loginErrorMessage('invalid')).toBe(
      'That email and password combination did not work.',
    );
  });

  it('shows nothing when there is no error code', () => {
    expect(loginErrorMessage(undefined)).toBeNull();
    expect(loginErrorMessage(null)).toBeNull();
    expect(loginErrorMessage('')).toBeNull();
  });

  it('falls back to the generic message for an unknown code', () => {
    expect(loginErrorMessage('not-a-real-code')).toBe(LOGIN_FALLBACK_MESSAGE);
  });

  it.each(PROTOTYPE_KEYS)(
    'returns a renderable string for ?error=%s rather than a prototype value',
    (key) => {
      const message = loginErrorMessage(key);

      // The regression itself: an object or a function here is an unauthenticated
      // 500, because React refuses to render either.
      expect(typeof message).toBe('string');
      expect(message).toBe(LOGIN_FALLBACK_MESSAGE);
    },
  );

  it('never leaks the supplied code back into the page', () => {
    // Reflecting the raw query value would turn this into a reflected-content
    // sink on an unauthenticated page.
    const message = loginErrorMessage('<script>alert(1)</script>');

    expect(message).toBe(LOGIN_FALLBACK_MESSAGE);
    expect(message).not.toContain('script');
  });
});
