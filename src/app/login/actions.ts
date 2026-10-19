'use server';

import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

/**
 * Sign the operator in.
 *
 * Failure redirects back to /login with an error code rather than returning
 * state, which keeps the page a pure server render with zero client JS — the
 * console has to open fast on a phone between sales meetings.
 *
 * The message is deliberately generic: distinguishing "no such user" from
 * "wrong password" would confirm which email addresses exist on the project.
 */
export async function signIn(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    redirect('/login?error=missing');
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect('/login?error=invalid');
  }

  // redirect() signals by throwing, so it must sit outside any try/catch.
  redirect('/');
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
