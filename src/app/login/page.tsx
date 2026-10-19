import type { Metadata } from 'next';

import { SERVICE_NAME } from '@/core/brand';
import { loginErrorMessage } from '@/core/shared/auth-messages';

import { signIn } from './actions';

/**
 * `noindex` beside the title (D-18, T-9-29): `robots.txt` already disallows
 * `/login`, but a robots file is a request a crawler may ignore and a meta tag
 * is an instruction it may not. An operator sign-in has no reason to be a
 * search result, and the two controls fail independently.
 */
export const metadata: Metadata = { title: 'Sign in', robots: { index: false, follow: false } };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  // Resolved through a Map, never an object literal: `?error=` is unauthenticated
  // attacker input and an object-literal lookup would return Object.prototype for
  // `__proto__`, which React cannot render (CR-01).
  const message = loginErrorMessage(error);

  return (
    <main className="auth">
      <h1>{SERVICE_NAME}</h1>
      <p className="muted">Operator sign in</p>

      {message ? (
        <p className="error" role="alert">
          {message}
        </p>
      ) : null}

      <form action={signIn}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          autoFocus
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />

        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
